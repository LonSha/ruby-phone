// tests/system-v3590.test.mjs — O5 写入成功与真实落盘一致 [v3.58.0]
//
// 本套件守四件事（一面唯一实现 + 一面**真契约**行为 + 一面接线台账 + 版本锚与破坏表）：
//   ① R1 唯一实现结构契约：`config/write-receipt.js` 的裁决面（Promise 不当布尔读 /
//      明确假报 set_false / 抛错报 write_threw / 拿不到 API 报 no_api，四态互不相同）；
//   ② R2 **真契约**行为面：把真 `PhoneStorage.set` 的 async 契约搬进夹具
//      （返回 Promise 的假 storage），两族写回执必须给得出真值 ——
//      这一面是本版缺陷的**唯一可复现路径**：夹具同步化就会得到「假绿」；
//   ③ R3 接线台账：A 族 11 件 / B 族 6 件全部接到唯一实现，且旧读数形态**一处不剩**
//      （`const wrote = this.storage.set(` 与无条件的 `this.storage.set(k, JSON.stringify(v)); return true;`）；
//   ④ V 面版本锚 + D 面真源码定点破坏表（每条破坏必须让对应判据转红）；
//   ⑤ R4 验收补面（多键完成范围 / 重开往返 / 不连坐 / 不新增数据库）；
//   ⑥ R5 界面播报面（结构：一律走唯一判据；行为：只读盘上不许显示「已保存」）——
//      本条在 v3.58.0 是**读数**，本版收口界面后升级为判据（读数只证明有人看过）。
//
// 判据纪律（本仓硬纪律，逐条沿用）：
//   · 破坏只落副本树，真仓全程只读；破坏锚点必须恰中 1 次（不唯一即抛）；
//   · 夹具必须**比被测契约更弱或相等**，不得比它更强 —— 本版缺陷之所以长期潜伏，
//     正是因为同步夹具比真 async 契约「更强」（`wrote === true` 在夹具里恰好成立）；
//   · 每条破坏两侧都断言：破坏后必须红，原版上同款判据必须真（否则「恒红」也能骗过破坏表）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const RECEIPT_REL = 'config/write-receipt.js';
const MIN_VERSION = '3.58.0';
/* 修复台账（与 tools/wire_v3580_receipt.py 同一份清单，双向对账） */
const FAMILY_A = ['memtable', 'socialguard', 'freehome', 'stickerdesk', 'lexiscore', 'periodmath',
    'annidate', 'cardtable', 'summdesk', 'sullydesk', 'traveldesk'];
const FAMILY_B = ['archive', 'cotdesk', 'diagdesk', 'doujin', 'pvdesk', 'uterus'];
const A_RELS = FAMILY_A.map((k) => 'apps/' + k + '/' + k + '-app.js');
const B_RELS = FAMILY_B.map((k) => 'apps/' + k + '/' + k + '-app.js');
/* 界面播报面的载体：**视图**文件（与 B 族的 App 同名单、不同文件）。 */
const VIEW_RELS = FAMILY_B.map((k) => 'apps/' + k + '/' + k + '-view.js');
const ALL_RELS = A_RELS.concat(B_RELS);
const temps = [];
let seq = 0;
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function readFrom(root, rel) {
    const p = path.join(root, rel);
    if (root !== ROOT && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return readRel(rel);
}
const hits = (s, sub) => s.split(sub).length - 1;
/* 两个输入面（与 system-v3580 同款纪律）：锚点含字面量时必须用保留字符串的那一面，
 *   否则 `'set_false'` / `from '../../config/...'` 这类锚点在剥字符串后必然失配（假红）。
 *   本套件首跑正是在这上面红过一轮 —— 与 v3580 是同一个坑，说明它值得写进纪律而不是靠记忆。 */
function codeKeepStr(src) {
    const out = new Array(src.length);
    let i = 0; const n = src.length;
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '*') {
            const end = src.indexOf('*/', i + 2); const stop = end < 0 ? n : end + 2;
            for (let k = i; k < stop; k++) out[k] = src[k] === NL ? NL : ' ';
            i = stop; continue;
        }
        if (c === '/' && c2 === '/') {
            const end = src.indexOf(NL, i + 2); const stop = end < 0 ? n : end;
            for (let k = i; k < stop; k++) out[k] = ' ';
            i = stop; continue;
        }
        out[i] = c; i += 1;
    }
    return out.join('');
}
function codeOnly(src) {
    const out = new Array(src.length);
    let i = 0; const n = src.length;
    const blank = (a, b) => { for (let k = a; k < b; k++) out[k] = src[k] === NL ? NL : ' '; };
    const tick = String.fromCharCode(96);
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '*') { const end = src.indexOf('*/', i + 2); const stop = end < 0 ? n : end + 2; blank(i, stop); i = stop; continue; }
        if (c === '/' && c2 === '/') { const end = src.indexOf(NL, i + 2); const stop = end < 0 ? n : end; blank(i, stop); i = stop; continue; }
        if (c === Q || c === String.fromCharCode(34) || c === tick) {
            let j = i + 1;
            while (j < n) {
                if (src[j] === String.fromCharCode(92)) { j += 2; continue; }
                if (src[j] === c) { j += 1; break; }
                j += 1;
            }
            const stop = Math.min(j, n);
            blank(i, stop); i = stop; continue;
        }
        out[i] = c; i += 1;
    }
    return out.join('');
}

/* ============================================================
 * R1 面：唯一实现的结构契约
 * ============================================================ */
const RECEIPT_ANCHORS = [
    ['内核（唯一裁决处）', 'function decideReceipt(out, threw) {'],
    ['同步出口', 'export function writeReceipt(storage, key, value) {'],
    ['异步出口', 'export async function writeReceiptAsync(storage, key, value) {'],
    ['Thenable 分流', "    if (out && typeof out.then === " + Q + "function" + Q + ") {"],
    ['抛错先判', "    if (threw) return { saved: false, why: " + Q + "write_threw" + Q + " };"],
    ['真布尔走同步分支', "    if (out === true) return { saved: true, why: " + Q + Q + " };"],
    ['余者报 set_false', "    return { saved: false, why: " + Q + "set_false" + Q + " };"],
    ['无 API 报 no_api', "return { saved: false, why: " + Q + "no_api" + Q + " };", 2],
];
function receiptProblems(root) {
    const bad = [];
    const code = codeKeepStr(readFrom(root, RECEIPT_REL));
    for (const [label, anchor, want] of RECEIPT_ANCHORS) {
        const n = hits(code, anchor);
        const expect = (typeof want === 'number') ? want : 1;
        if (n !== expect) bad.push('R1 「' + label + '」锚点命中 ' + String(n) + ' 次（应 ' + String(expect) + '）');
    }
    /* 三种失败成因必须各自分面（同形等于没有归因） */
    for (const w of ['no_api', 'write_threw', 'set_false']) {
        if (hits(code, Q + w + Q) < 1) bad.push('R1 缺失败成因：' + w);
    }
    /* 同一口径只许一份实现：内核只定义一次，两出口都必须**只调它**、不得各自再判一遍 */
    const n = hits(code, 'return decideReceipt(out, threw);');
    if (n !== 2) bad.push('R1 两出口未共用唯一内核（调决定口 ' + String(n) + ' 次，应 2）');
    return bad;
}

/* ============================================================
 * R2 面：真契约行为 —— **async 假 storage**（真 PhoneStorage.set 的契约）
 *   为什么必须 async：本版治的正是「同步夹具比真契约更强」这一形态。夹具若写成同步，
 *   两族旧读数都会「恰好正确」⇒ 判据全绿、缺陷在位。
 * ============================================================ */
/** 真契约假件：set/remove 返回 Promise（真 PhoneStorage 二者都是 async）。 */
function asyncStorage(opts) {
    const o = opts || {};
    const map = new Map();
    return {
        _map: map,
        get: (k, d) => (map.has(k) ? map.get(k) : d),
        set: (k, v) => {
            if (o.throwOnSet) return Promise.reject(new Error('boom'));
            return Promise.resolve().then(() => { map.set(k, JSON.parse(JSON.stringify(v))); return true; });
        },
        remove: (k) => Promise.resolve().then(() => { map.delete(k); return true; }),
    };
}
async function receiptBehavior() {
    const bad = [];
    /* ① 唯一实现本体：真 Promise 必须报 saved（旧写法恒假），且 why 为空 */
    {
        const box = await import(pathToFileURL(path.join(ROOT, RECEIPT_REL)).href + '?t=1');
        const st = asyncStorage();
        const r = box.writeReceipt(st, 'k1', { a: 1 });
        if (r.saved !== true) bad.push('R2 真 async storage 上唯一实现未报 saved：' + JSON.stringify(r));
        if (r.why !== '') bad.push('R2 成功路径 why 必须为空串：' + JSON.stringify(r.why));
        /* 同步契约（旧实现 / 夹具）两侧都要真：true 报成功，false/undefined 报 set_false */
        if (box.writeReceipt({ set: () => true }, 'k', 1).saved !== true) bad.push('R2 同步 true 未报成功');
        for (const v of [false, undefined, null, 0]) {
            const rr = box.writeReceipt({ set: () => v }, 'k', 1);
            if (rr.saved !== false || rr.why !== 'set_false') bad.push('R2 同步假值未报 set_false：' + JSON.stringify([v, rr]));
        }
        /* 抛错与「明确的假」必须分面 */
        const threw = box.writeReceipt({ set: () => { throw new Error('x'); } }, 'k', 1);
        if (threw.saved !== false || threw.why !== 'write_threw') bad.push('R2 抛错未报 write_threw：' + JSON.stringify(threw));
        if (box.writeReceipt(null, 'k', 1).why !== 'no_api') bad.push('R2 无 API 未报 no_api');
        if (box.writeReceipt({}, 'k', 1).why !== 'no_api') bad.push('R2 缺 set 未报 no_api');
        /* 异步版：等落队后仍是同一结论 */
        const ra = await box.writeReceiptAsync(asyncStorage(), 'k2', 1);
        if (ra.saved !== true || ra.why !== '') bad.push('R2 异步版成功路径异常：' + JSON.stringify(ra));
    }
    /* ② 真契约驱动**真 App**：A 族与 B 族各取一件，写回执必须报得出真值。
     *   A 族（memtable）：intakeTemplates 的 saved 必须为 true（旧写法恒 false）。 */
    {
        const M = await import(pathToFileURL(path.join(ROOT, 'apps/memtable/memtable-app.js')).href + '?t=2');
        const app = new M.MemtableApp({ getContentContainer: () => null }, asyncStorage());
        const tpl = { id: 't1', name: 'X', tables: [{ id: 'b', name: 'B', mode: 'keyValue', extractPrompt: 'p', columns: [{ id: 'f1', key: 'k', type: 'text' }] }] };
        const r = app.intakeTemplates(JSON.stringify([tpl]));
        if (r.saved !== true) bad.push('R2 A 族（memtable）在真 async 契约上未报 saved：' + JSON.stringify(r));
        /* 反向：只读盘（set 抛）必须报 false —— 不许把「写不进去」报成写下去了 */
        const ro = { get: () => null, set: () => { throw new Error('ro'); }, remove: () => { throw new Error('ro'); } };
        const appRO = new M.MemtableApp({ getContentContainer: () => null }, ro);
        if (appRO.intakeTemplates(JSON.stringify([tpl])).saved !== false) bad.push('R2 A 族只读盘竟报 saved');
    }
    /* B 族（archive）：_writeJSON 必须跟着真契约走 —— 写成功 true / 写抛错 false */
    {
        const A = await import(pathToFileURL(path.join(ROOT, 'apps/archive/archive-app.js')).href + '?t=3');
        const cls = A.ArchiveApp || A.default;
        if (typeof cls !== 'function') { bad.push('R2 取不到 ArchiveApp 构造器'); return bad; }
        const ok = new cls({ getContentContainer: () => null }, asyncStorage());
        if (ok._writeJSON('probe_key', { a: 1 }) !== true) bad.push('R2 B 族（archive）在真 async 契约上未报写成功');
        const bad2 = new cls({ getContentContainer: () => null }, { get: () => null, set: () => { throw new Error('ro'); }, remove: () => { throw new Error('ro'); } });
        if (bad2._writeJSON('probe_key', { a: 1 }) !== false) bad.push('R2 B 族在只读盘上未报写失败');
    }
    return bad;
}

/* ============================================================
 * R3 面：接线台账 —— 两族全部接到唯一实现，旧读数形态一处不剩
 * ============================================================ */
const OLD_A = 'const wrote = this.storage.set(';
const OLD_B = 'this.storage.set(key, JSON.stringify(value));';
function wiringProblems(root) {
    const bad = [];
    const importMark = 'from ' + Q + '../../config/write-receipt.js' + Q;
    for (const rel of ALL_RELS) {
        const code = codeKeepStr(readFrom(root, rel));
        if (hits(code, importMark) !== 1) bad.push('R3 ' + rel + ' 未引用唯一实现');
        if (hits(code, 'writeReceipt(this.storage, key') < 1) bad.push('R3 ' + rel + ' 未把写调用接到唯一实现');
        /* 旧读数形态：A 族「把 set 的返回值当布尔」一处不许剩（只需 codeOnly，锚点无字面量） */
        if (codeOnly(readFrom(root, rel)).indexOf(OLD_A) >= 0) bad.push('R3 ' + rel + ' 仍把 storage.set 的返回值当同步布尔读');
    }
    /* 全仓面：旧形态不许在**任何**产品文件里复活（本版收口的不只是这份台账） */
    for (const rel of ALL_RELS) {
        if (readFrom(root, rel).indexOf(OLD_B) >= 0) bad.push('R3 ' + rel + ' 仍有无条件报成功的写体');
    }
    return bad;
}
/** 全仓扫描：A 族旧形态在扫面内一旦出现即报（防止新 App 照抄旧写法）。 */
function repoScanProblems(root) {
    const bad = [];
    const skip = new Set(['node_modules', '.git', 'tests', 'assets', 'workers']);
    const stack = [root];
    while (stack.length) {
        const d = stack.pop();
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
            if (skip.has(e.name) || e.name.startsWith('.')) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) { stack.push(p); continue; }
            if (!/\.(js|mjs)$/.test(e.name)) continue;
            let src = '';
            try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
            if (src.indexOf('write-receipt.js') >= 0) continue;   // 唯一实现自身（头注里正当地引用了旧形态）
            const code = codeOnly(src);
            const rel = path.relative(root, p).split(path.sep).join('/');
            if (code.indexOf(OLD_A) >= 0) bad.push('R3 全仓仍有旧读数形态：' + rel);
        }
    }
    return bad;
}

/* ============================================================
 * V 面：版本锚（下限 + 四源自洽）
 * ============================================================ */
function versionProblems(root) {
    const bad = [];
    const man = JSON.parse(readFrom(root, 'manifest.json'));
    const pkg = JSON.parse(readFrom(root, 'package.json'));
    const log = JSON.parse(readFrom(root, 'update-log.json'));
    const idx = readFrom(root, 'index.js');
    const vnum = (v) => String(v).split('.').map((x) => Number(x)).reduce((a, b) => a * 1000 + b, 0);
    if (vnum(man.version) < vnum(MIN_VERSION)) bad.push('V1 manifest 版本低于本套件出生版：' + man.version);
    for (const [name, v] of [['package', pkg.version], ['update-log.latest', log.latest], ['update-log.head', log.head]]) {
        if (v !== man.version) bad.push('V1 ' + name + ' = ' + String(v) + '（应与 manifest ' + man.version + ' 同源）');
    }
    if (hits(idx, 'const ST_PHONE_VERSION = ' + Q + man.version + Q + ';') !== 1) bad.push('V1 index.js 版本常量不同源');
    if (!log.versions || !log.versions[man.version]) bad.push('V1 update-log 缺当版条目');
    return bad;
}

/* ============================================================
 * 破坏面：单文件副本树（真源码定点破坏 → 在副本上重跑同款真判据）
 * ============================================================ */
function breakIn(rel, from, to, extraRels) {
    const src = readRel(rel);
    const n = hits(src, from);
    /* 0 与 >1 必须分开报：前者是「锚点已漂走」（判据在测一个不存在的东西），
     *   后者才是「锚点不唯一」（破坏点指不清）。合成一句话会把两种故障混成一格。 */
    if (n === 0) throw new Error('破坏锚点不存在（已漂走）：' + rel + ' <- ' + from);
    if (n > 1) throw new Error('破坏锚点不唯一：' + rel + ' -> ' + String(n) + ' 次：' + from);
    seq += 1;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3590-b-' + String(seq) + '-'));
    temps.push(d);
    for (const dep of (extraRels || [])) {
        const p = path.join(d, dep);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.copyFileSync(path.join(ROOT, dep), p);
    }
    const target = path.join(d, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src.split(from).join(to), 'utf8');
    return d;
}
/** 只建副本树、不做任何破坏（D7 用：原版上同款判据必须真，否则「恒红」也能骗过破坏表）。
 *   用空操作破坏（from === to）是错的 —— 那只是在测「锚点还在不在」，不是在测原版行为。 */
function copyTree(rel, extraRels) {
    seq += 1;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3590-c-' + String(seq) + '-'));
    temps.push(d);
    for (const dep of [rel].concat(extraRels || [])) {
        const p = path.join(d, dep);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.copyFileSync(path.join(ROOT, dep), p);
    }
    return d;
}

/* ============================================================
 * 顶层用例
 * ============================================================ */
test('R1 唯一实现面：两出口 / Thenable 分流 / 三种失败成因各自分面', () => {
    const bad = receiptProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R2 真契约行为面：async 假 storage 上两族写回执必须给得出真值', async () => {
    const bad = await receiptBehavior();
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R3 接线台账：两族 17 件全接唯一实现，旧读数形态一处不剩', () => {
    const bad = wiringProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
    const bad2 = repoScanProblems(ROOT);
    assert.deepEqual(bad2, [], bad2.join(' | '));
});
test('V1 ★ 版本下限锚：本套件只在 3.58.0 及以后成立', () => {
    const bad = versionProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('V2 台账自证：两族清单与自己声明的条数一致，且文件都真在仓里', () => {
    assert.equal(A_RELS.length, 11, 'A 族台账条数');
    assert.equal(B_RELS.length, 6, 'B 族台账条数');
    for (const rel of ALL_RELS) assert.ok(readRel(rel).length > 0, '载体不在场：' + rel);
});

/* ============================================================
 * D 面：破坏表
 * ============================================================ */
const D = [
    /* D1：Thenable 分支失效 ⇒ 真 async 契约上的写被报成「没写下去」（本版病灶原形）。
     *   锚点必须带上下文：裸的 `out && typeof out.then === 'function'` 在异步出口里也出现一次，
     *   用裸行会命中 2 次（首跑即因此红过 —— 这条纪律值得写进文件而不是靠记忆）。 */
    ['R2 真 async 写被报成没写下去', RECEIPT_REL,
        "    if (out && typeof out.then === " + Q + "function" + Q + ") {" + NL + "        /* 已排队的写",
        "    if (false) {" + NL + "        /* 已排队的写", 'behavior'],
    /* D2：兜底分支被抹 ⇒「明确的假」也被报成成功（读不清 = 写成功）。
     *   首版写法把 `if (out === true)` 改成 `out !== false` 是**无效破坏**：那反而把 false 排除在外，
     *   判据不会响（假绿）。真破坏必须动**兜底那一行**本身。 */
    ['R2 明确假值被报成功', RECEIPT_REL,
        "    return { saved: false, why: " + Q + "set_false" + Q + " };",
        "    return { saved: true, why: " + Q + Q + " };", 'behavior'],
    /* D3：抛错与「明确的假」合并（抛异常也算写下去了） */
    ['R2 抛错被报成功', RECEIPT_REL,
        "    if (threw) return { saved: false, why: " + Q + "write_threw" + Q + " };",
        "    if (false) return { saved: false, why: " + Q + "write_threw" + Q + " };", 'behavior'],
    /* D4：A 族退回旧读数（把 Promise 当布尔） */
    ['R3 A 族退回旧读数', 'apps/memtable/memtable-app.js',
        'return writeReceipt(this.storage, key, value);',
        'return { saved: this.storage.set(key, value) === true, why: ' + Q + 'set_false' + Q + ' };', 'wiring'],
    /* D5：B 族退回无条件报成功 */
    ['R3 B 族退回无条件报成功', 'apps/archive/archive-app.js',
        'return writeReceipt(this.storage, key, JSON.stringify(value)).saved === true;',
        'this.storage.set(key, JSON.stringify(value));' + NL + '            return true;', 'wiring'],
    /* D6：只摘掉一件的 import（接线漏一件） */
    ['R3 某件摘掉唯一实现接线', 'apps/uterus/uterus-app.js',
        "import { writeReceipt } from '../../config/write-receipt.js';", '/* 摘 */', 'wiring'],
    /* D9：判据把「落盘结论」这一格抹掉 —— 只读盘上动作成立就照报成功（本版病灶原形）。 */
    ['R5b 判据不再看落盘结论', RECEIPT_REL,
        "    return (typeof r.saved === " + Q + "boolean" + Q + ") ? (r.saved === true) : true;",
        "    return true;", 'landed'],
    /* D10：某件视图退回「拿 ok 当落盘判据」（界面照报已保存） */
    ['R5a 视图退回 ok 判据', 'apps/archive/archive-view.js',
        "this._flash = writeLanded(r) ? '' : ('没收下（'",
        "this._flash = r.ok ? '' : ('没收下（'", 'landedStruct'],
    /* D11：某件视图把「成因空缺」那一格删掉（失败理由画成空括号） */
    ['R5a 缺口短语被删', 'apps/archive/archive-view.js',
        "this._flash = writeLanded(r) ? '' : ('没收下（' + (r.why ? r.why : '没落下去')",
        "this._flash = writeLanded(r) ? '' : ('没收下（' + (r.why ? r.why : '')", 'landedStruct'],
];
const JUDGES = {
    wiring: (root) => Promise.resolve(wiringProblems(root)),
    landed: async (root) => {
        const box = await import(pathToFileURL(path.join(root, RECEIPT_REL)).href + '?d=' + String(seq));
        const bad = [];
        if (box.writeLanded({ ok: true, saved: false }) !== false) bad.push('有落盘结论时未看落盘');
        return bad;
    },
    landedStruct: (root) => Promise.resolve(writeLandedStructure(root)),
    behavior: async (root) => {
        const box = await import(pathToFileURL(path.join(root, RECEIPT_REL)).href + '?b=' + String(seq));
        const bad = [];
        const st = asyncStorage();
        const r = box.writeReceipt(st, 'k', 1);
        if (r.saved !== true) bad.push('真 async 报失败');
        if (box.writeReceipt({ set: () => false }, 'k', 1).why !== 'set_false') bad.push('明确假未报 set_false');
        if (box.writeReceipt({ set: () => { throw new Error('x'); } }, 'k', 1).why !== 'write_threw') bad.push('抛错未报 write_threw');
        if (box.writeReceipt(null, 'k', 1).why !== 'no_api') bad.push('无 API 未报 no_api');
        return bad;
    },
};
async function runBreak(row) {
    const [label, rel, from, to, judgeName] = row;
    const judge = JUDGES[judgeName];
    if (typeof judge !== 'function') throw new Error('判据名不存在：' + judgeName);
    /* 结构面判据读的是**六件视图**：破坏只落一件时，其余五件也得在副本树里，
     *   否则判据会因为「文件不在」而报红 —— 那是假红，不是被破坏的后果。 */
    const deps = (judgeName === 'landedStruct') ? VIEW_RELS : [];
    const ws = breakIn(rel, from, to, deps);
    try { return await judge(ws); } catch (_e) { return [judgeName]; }
}
test('D1~D11 破坏表：每条真源码定点破坏都必须让对应判据转红', async () => {
    for (const row of D) {
        const bad = await runBreak(row);
        assert.ok(Array.isArray(bad) && bad.length >= 1, row[0] + ' 破坏未被观测到（判据没响）');
    }
});
test('D7 原版真：未破坏的副本树上，同款行为判据必须真（否则「恒红」也能骗过破坏表）', async () => {
    const ws = copyTree(RECEIPT_REL, []);
    const bad = await JUDGES.behavior(ws);
    assert.deepEqual(bad, [], '原版上行为判据不真：' + bad.join(' | '));
});
/* ============================================================
 * R5 面：界面播报不许与写回执相左（v3.59.0 交棒改写，不是放宽）
 *   v3.58.0 把这一面记成「可复算读数、不作红」—— 因为当时写回执做到了、界面还没有。
 *   本版把界面收口之后，读数升级为判据：**读数只证明有人看过，判据才能拦住复发**。
 * ============================================================ */
/** 旧形态：拿「动作成不成」当「盘上有没有」播报。 */
const OLD_FLASH = 'this._flash = r.ok ?';
/** 缺口短语：成因空缺 ≠ 没有原因（真实原因是「这一刀没落下去」）。 */
const GAP_PHRASE = '没落下去';
function writeLandedStructure(root) {
    const bad = [];
    const importMark = "from '../../config/write-receipt.js';";
    let gapTotal = 0;
    for (const rel of VIEW_RELS) {
        const raw = readFrom(root, rel);
        const code = codeKeepStr(raw);
        /* ① 一律走唯一判据（不许各件自己判一遍 ok） */
        if (hits(code, importMark) !== 1) bad.push('R5 ' + rel + ' 未引用播报判据的唯一实现');
        if (hits(code, 'writeLanded(r)') < 1) bad.push('R5 ' + rel + ' 未用唯一判据播报');
        /* ② 旧形态一处不剩：拿 ok 当落盘判据 */
        if (hits(code, OLD_FLASH) !== 0) {
            bad.push('R5 ' + rel + ' 仍把 ok 当落盘判据播报 ' + String(hits(code, OLD_FLASH)) + ' 处');
        }
        if (hits(code, 'if (r && r.ok === true) return okText;') !== 0) {
            bad.push('R5 ' + rel + ' 的自持播报助手仍以 ok 为判据');
        }
        /* ③ 失败播报必须给得出成因；成因空缺时不许画一对空括号 */
        const gap = hits(code, GAP_PHRASE);
        gapTotal += gap;
        if (gap < 1) bad.push('R5 ' + rel + ' 失败播报未覆盖「成因空缺」这一格');
        if (hits(code, "'）')") > 0 && hits(code, "? r.why :") === 0 && gap === 0) {
            bad.push('R5 ' + rel + ' 仍是「没收下（）」那种空括号形态');
        }
    }
    if (gapTotal !== 18) bad.push('R5 缺口短语总处数应为 18，实得 ' + String(gapTotal));
    return bad;
}
/** 只读盘：写调用一律抛错 —— 动作**算得出**、但一个字节也落不下去。 */
function readOnlyStorage() {
    return {
        get: () => null,
        set: () => { throw new Error('ro'); },
        remove: () => { throw new Error('ro'); },
    };
}
/**
 * 真行为面：六件 App 各做一次「放下」（clearXxx），在**只读盘**上必须给出
 * `ok: true`（动作成立）与 `saved: false`（这一刀没落下去）这一对读数，
 * 而界面判据 `writeLanded` 必须为假 —— 这正是计划 O5 验收原文那一句：
 * 「多键中途失败时**不显示**已保存」。
 *
 * 【为什么用「放下」而不是「收下」】收下口先过**输入形状门**：形状不对时动作压根不成立
 *   （`ok: false`），那测的是形状门、不是落盘口径 —— 本面首版正是在这上面红过一轮
 *   （四件按自己编的形状被拒）。「放下」口不需要输入，语义就是「写一次」：
 *   只读盘上它必须照样 `ok`（认得出这个动作）、但 `saved` 为假。
 */
async function writeLandedBehaviour() {
    const bad = [];
    const box = await import(pathToFileURL(path.join(ROOT, RECEIPT_REL)).href + '?L=' + String(seq));
    const L = box.writeLanded;
    /* 判据自身三态：不带 saved 的读法沿用 ok 口径；带了就以 saved 为准 */
    if (L({ ok: true }) !== true) bad.push('R5 判据把「不带 saved 的读法」判成了没落下去');
    if (L({ ok: true, saved: false }) !== false) bad.push('R5 判据未把「动作成立但没落下去」判成不成');
    if (L({ ok: false, saved: true }) !== false) bad.push('R5 判据把「动作不成」判成了成');
    if (L(null) !== false) bad.push('R5 判据对空返回体未判不成');
    const ro = readOnlyStorage();
    /* 六件的「放下」口：放下一份册子 / 包 / 存档 / 店头 / 题面 / 受试体。 */
    const cases = [
        ['archive', 'clearPack'],
        ['cotdesk', 'clearItems'],
        ['diagdesk', 'clearArchive'],
        ['doujin', 'clearShop'],
        ['pvdesk', 'clearBrief'],
        ['uterus', 'clearSubject'],
    ];
    for (const [name, method] of cases) {
        const mod = await import(pathToFileURL(path.join(ROOT, 'apps/' + name + '/' + name + '-app.js')).href + '?L=' + String(seq));
        const cls = mod.default || mod[name.charAt(0).toUpperCase() + name.slice(1) + 'App'];
        if (typeof cls !== 'function') { bad.push('R5 取不到 ' + name + ' 的构造器'); continue; }
        const app = new cls({ getContentContainer: () => null }, ro);
        if (typeof app[method] !== 'function') { bad.push('R5 ' + name + ' 缺写动作口 ' + method); continue; }
        let r = null;
        try { r = app[method](); } catch (e) { bad.push('R5 ' + name + '.' + method + ' 在只读盘上抛了：' + String(e && e.message)); continue; }
        if (!r || r.ok !== true) { bad.push('R5 ' + name + ' 只读盘上写口未如实报「认得出」（ok=' + JSON.stringify(r && r.ok) + '）'); continue; }
        if (r.saved !== false) bad.push('R5 ' + name + ' 只读盘上竟报写下去了：' + JSON.stringify(r && r.saved));
        if (L(r) !== false) bad.push('R5 ' + name + ' 界面判据仍会显示「已保存」：' + JSON.stringify(r));
    }
    return bad;
}

/* ============================================================
 * R4 面：计划 O5 验收里**此前没有断言覆盖**的三条（真模块 + 真 async 契约）
 *   · 多键中途失败 ⇒ 不显示「已保存」（写回执层：collectReceipt 的完成范围）
 *   · 重开往返可验证（写后等落队 → 新实例装回来）
 *   · 清除一个 App 不连坐其他桶（只清自己的键）
 * ============================================================ */
/** 真契约假件：与真 PhoneStorage 同形（返回 Promise / 可抛 / 可判假），并**同步落盘**。 */
function accStorage(opts) {
    const o = opts || {};
    const map = new Map();
    return {
        _map: map,
        get: (k, d) => { if (o.throwOnGet) throw new Error('get boom'); return map.has(k) ? map.get(k) : d; },
        set: (k, v) => {
            if (o.throwKeys && o.throwKeys.includes(k)) throw new Error('sync boom');
            if (o.failKeys && o.failKeys.includes(k)) return false;
            map.set(k, JSON.parse(JSON.stringify(v)));
            return Promise.resolve(true);
        },
        remove: (k) => { map.delete(k); return Promise.resolve(true); },
    };
}
const CY = () => new Promise((r) => setTimeout(r, 0));
async function acceptanceSurface() {
    const bad = [];
    const M = await import(pathToFileURL(path.join(ROOT, 'apps/cotdesk/cotdesk-app.js')).href + '?a=1');
    const K = { items: M.CD_ITEMS_KEY, ledger: M.CD_LEDGER_KEY };
    const text = JSON.stringify([{ id: 'a1', kind: 'pair', prompt: 'p', reply: 'r' }]);
    const mk = (st) => new M.CotdeskApp({ getContentContainer: () => null }, st);
    /* ① 多键中途失败：第二条键（台账）抛错 ⇒ saved 必须为假。
     *   ★ 这条正是「只报最后一条键」的对照面：源代在此处丢掉前一次结果。
     *   夹具必须**同步抛**（真实调用点把整个写调用包在 try 里），否则写回执看不到失败。 */
    {
        const st = accStorage({ throwKeys: [K.ledger] });
        const r = mk(st).ingestItems(text);
        await CY();
        if (r.saved !== false) bad.push('R4 多键中途失败竟报已保存（' + JSON.stringify(r) + '）');
        if (st._map.get(K.ledger) !== undefined) bad.push('R4 台账键本不该落下去');
    }
    /* ② 第二键返回同步假值 ⇒ 同上（两条失败路径都要真） */
    {
        const st = accStorage({ failKeys: [K.ledger] });
        const r = mk(st).ingestItems(text);
        await CY();
        if (r.saved !== false) bad.push('R4 第二键报假竟算成功（' + JSON.stringify(r) + '）');
    }
    /* ③ 重开往返：写成功 → 等落队 → 新实例装回来，读数必须与写进去的一致 */
    {
        const st = accStorage();
        const r = mk(st).ingestItems(text);
        await CY();
        if (r.saved !== true) bad.push('R4 正常盘上写竟报失败：' + JSON.stringify(r));
        const app2 = mk(st);
        app2.probe();
        if (app2.rawLen() !== text.length) bad.push('R4 重开往返长度不符：' + String(app2.rawLen()));
        if (app2.faceOf() !== 'ok') bad.push('R4 重开往返面不对：' + String(app2.faceOf()));
        if (String(app2.faceText()).indexOf('没') >= 0) bad.push('R4 重开往返仍报「没记过」：' + String(app2.faceText()));
    }
    /* ④ 清一个 App 不连坐其他桶：只清自己的键，别人的键一字不动 */
    {
        const st = accStorage();
        st._map.set('other_bucket_key', { keep: 1 });
        const app = mk(st);
        app.ingestItems(text);
        await CY();
        app.clearItems();
        await CY();
        if (st._map.has('other_bucket_key') !== true) bad.push('R4 清本 App 连坐了别的桶');
        if (JSON.stringify(st._map.get('other_bucket_key')) !== '{"keep":1}') bad.push('R4 别的桶内容被改动');
        /* 本 App 自己的键被清：落盘形态是 JSON 文本（`{raw, at}`），必须**按真形态解析**后再判 ——
         *   首版直接拿它当对象比 `.raw`，当场被这条判据自己抓出来（夹具读法错，不是产品缺陷）。 */
        const raw = st._map.get(K.items);
        if (typeof raw !== 'string') bad.push('R4 本 App 落盘形态变了（应为 JSON 文本）：' + typeof raw);
        else {
            let obj = null;
            try { obj = JSON.parse(raw); } catch (_e) { obj = null; }
            if (!obj || obj.raw !== '') bad.push('R4 本 App 自己的键未被清：' + raw);
        }
    }
    /* ⑤ 不新增另一套数据库：写回执路径上只出现 storage 一处宿主出口 */
    {
        const code = codeKeepStr(readRel(RECEIPT_REL));
        for (const banned of ['indexedDB', 'localStorage', 'sessionStorage']) {
            if (code.indexOf(banned) >= 0) bad.push('R4 写回执自行引入第二套存储：' + banned);
        }
        if (hits(code, 'storage.set(') !== 2) {
            bad.push('R4 写回执的宿主出口不唯一（storage.set 调用 ' + String(hits(code, 'storage.set(')) + ' 处）');
        }
    }
    return bad;
}

test('R4 验收未覆盖面：多键完成范围 + 重开往返 + 清一个 App 不连坐（真模块真契约）', async () => {
    const bad = await acceptanceSurface();
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R5a 界面播报结构面：六件视图一律走唯一判据，旧形态一处不剩', () => {
    const bad = writeLandedStructure(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R5b 界面播报真行为面：只读盘上六件都必须给出「动作成立 · 没落下去」', async () => {
    const bad = await writeLandedBehaviour();
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('D8 真仓只读：全部破坏跑完后，真仓三面判据必须仍然干净', async () => {
    const rounds = [
        ['R1', receiptProblems(ROOT)],
        ['R3', wiringProblems(ROOT)],
        ['R3-scan', repoScanProblems(ROOT)],
        ['R2', await receiptBehavior()],
    ];
    for (const [name, bad] of rounds) assert.deepEqual(bad, [], name + '：' + bad.join(' | '));
});