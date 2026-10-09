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
    /* ── [v3.74.0 · 计划 R-O4] 相位与回读确认面：病灶是「读数把三阶段压成一格」，
     *   故破坏全部落在**相位推演与回读比对**上 —— 每一条都能让界面照报已保存。 ── */
    /* D12：相位推演把「没回读」推成「已确认」⇒ 写了就算成（真宿主上写调用落了多半如此） */
    ['R6 未回读被推成已确认', RECEIPT_REL,
        '    if (stated.length < list.length) return PHASE_WRITTEN;',
        '    if (false) return PHASE_WRITTEN;', 'phase'],
    /* D13：回读值不比对 ⇒ 说谎存储（set 报成功、盘上没变）也报 confirmed。
     *   锚点取**原值比对那一格**（结构比较的最后一道：同形不同值的出口）。 */
    ['R6 回读不比对', RECEIPT_REL,
        '    if (!aObj) return false;',
        '    if (!aObj) return true;', 'phase'],
    /* D14：读不回来被当成已确认（「读不到东西」与「读到了同一份」合成一格）。
     *   注意：只把「读空了」那一格分支改掉**不足以**完整观测 —— 比对口径本身（readbackSame）
     *   还必须有它的负控（见 D13）。本条的靶子是**读回空那一格**的相位回话。 */
    ['R6 读不回被当成已确认', RECEIPT_REL,
        '    if (readThrew) {' + NL + '        /* 读不出来',
        '    if (readThrew && false) {' + NL + '        /* 读不出来', 'phase-empty'],
    /* D15：「没做回读」被标成「做了但读不回」（两种失真合成一格 —— 全仓每次普通写都会假报） */
    ['R6 没做回读被标成读不回', RECEIPT_REL,
        '        if (!hasReader || row.ok !== true || !hasWanted) {',
        '        if (row.ok !== true || !hasWanted) {', 'phase'],
    /* D16：判据的相位门被摘 ⇒ partial / not_confirmed 照报成了（R-O4 验收四情形当场失效）。
     *   注意锚点必须是**主门那一行**（只拿 written/confirmed）：上一行的 `isReceiptPhase`
     *   是「自造相位」的闸，摘它不会让 partial 过关 —— 首版锚错在这上面，判据不响（假绿）。 */
    ['R6 判据相位门被摘', RECEIPT_REL,
        '        if (r.phase !== PHASE_WRITTEN && r.phase !== PHASE_CONFIRMED) return false;',
        '        if (false) return false;', 'acceptFour'],
    /* D23：相位话术的「读不出」那一格被摘 ⇒ 一个没定义的字符串会被说成「落下去了且读回一致」
     *   （phaseText 的兜底是**判定**，不是 default 兜底 —— 摘它就没人在读不出的格上说话了）。 */
    ['R6 相位话术兜底被摘', RECEIPT_REL,
        '    if (!isReceiptPhase(p)) return PHASE_UNKNOWN_TEXT;',
        '    if (false) return PHASE_UNKNOWN_TEXT;', 'phase'],
    /* D17/D18：渲染层退回裸写（那一格从此有两个 owner，回执读数一概不经过它） */
    ['R6 渲染层退回裸写', 'apps/music/music-view.js',
        "                const w = writeConfirmed(this.app.storage, 'music_show_floating', newVal);",
        '                this.app.storage.set(' + Q + 'music_show_floating' + Q + ', newVal);', 'viewWrite'],
    ['R6 电话页退回裸写', 'apps/phone/phone-view.js',
        "            const w = writeConfirmed(this.app.storage, 'phone-call-auto-tts', e.target.checked);",
        '            this.app.storage.set(' + Q + 'phone-call-auto-tts' + Q + ', e.target.checked);', 'viewWrite'],
    /* D20：删除语义被抹 ⇒ **写空·读回非空**（没删掉）也算一致：删除失败照报删掉了。
     *   （D19 就是上面 D14 那条：读抛错那一格被抹后，删除语义下会「读都读不出来却报已确认」。） */
    ['R6 删没删掉不分面', RECEIPT_REL,
        '    if (aEmpty) return bEmpty;',
        '    if (aEmpty) return true;', 'phase'],
    /* D22：结构比较的「逐键比」被抹 ⇒ 同长不同值的对象被判同一份（回读形同虚设）。
     *   锚点取**对象逐键那一处**：数组那条（i 索引）与它不同行，唯一天然成立。 */
    ['R6 结构比较被抹', RECEIPT_REL,
        '        if (!sameValue(a[k], b[k], depth + 1)) return false;',
        '        if (!sameValue(a[k], b[k], depth + 1)) return true;', 'phase'],
    /* D21：形态史台账的键名写错（台账与真源码脱钩 ⇒ 空挂）必须转红（R-O4 第 5 条）。
     *   为什么不动「条数」：改条数要动数组结构，破坏点会跨行、锚点不唯一；
     *   键名这一格才是台账的价值所在 —— 它一旦对不上，台账就只是文档。 */
    ['R6 形态史台账空挂', RECEIPT_REL,
        Q + 'diary_entries' + Q + ', shape: ' + Q + 'raw' + Q,
        Q + 'diary_entries_typo' + Q + ', shape: ' + Q + 'raw' + Q, 'mixedShape'],
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
    /* [v3.74.0 · 计划 R-O4] 相位 + 回读确认面：四条真行为破坏各自的最短可观测面。
     *   每条都只问「这一处坏了，读数还能不能分得开」—— 不是重跑整套。 */
    phase: async (root) => {
        const box = await import(pathToFileURL(path.join(root, RECEIPT_REL)).href + '?p=' + String(seq));
        const bad = [];
        /* ① 说谎存储：set 说成了、盘上没变 ⇒ 必须 not_confirmed（不许 confirmed） */
        const liar = { get: () => 'old', set: () => Promise.resolve(true) };
        const r1 = box.writeConfirmed(liar, 'k', 'new');
        if (r1.phase !== box.PHASE_NOT_CONFIRMED) bad.push('说谎存储未报 not_confirmed：' + r1.phase);
        /* ② 真写存储 ⇒ confirmed */
        const truth = { _v: 'old', get(k) { return this._v; }, set(k, v) { this._v = v; return Promise.resolve(true); } };
        const r2 = box.writeConfirmed(truth, 'k', 'new');
        if (r2.phase !== box.PHASE_CONFIRMED || r2.confirmed !== true) bad.push('真写存储未报 confirmed：' + r2.phase);
        /* ③ 未回读（rows 只给 ok）⇒ 止于 written，不得冒充 confirmed */
        if (box.phaseOf([{ key: 'a', ok: true }]) !== box.PHASE_WRITTEN) bad.push('未回读的行未止于 written');
        /* ③b 读回空位 / 读抛错两条路径都不得 confirmed（「读不到东西」不许当读到了） */
        const empty = box.writeConfirmed({ get: () => undefined, set: () => Promise.resolve(true) }, 'k', 'new');
        if (empty.phase !== box.PHASE_NOT_CONFIRMED || empty.confirmed !== false) bad.push('读回空位竟报 confirmed');
        const getBad = box.writeConfirmed({ get: () => { throw new Error('x'); }, set: () => Promise.resolve(true) }, 'k', 'new');
        if (getBad.phase !== box.PHASE_NOT_CONFIRMED || getBad.confirmed !== false) bad.push('读抛错竟报 confirmed');
        /* ③c **删这一格**的两向：真删掉了 ⇒ confirmed；没删掉（读回旧值）⇒ not_confirmed。
         *   这一对是「写空」这一形的正负控 —— 少了它，「删除失败照报删掉了」与
         *   「删除成功照报失败」两种失真都测不出来。 */
        const del = { _v: '有东西', get() { return this._v; }, set(k, v) { if (v === null || v === undefined) this._v = undefined; else this._v = v; return Promise.resolve(true); } };
        const rDel = box.writeConfirmed(del, 'k', null);
        if (rDel.phase !== box.PHASE_CONFIRMED || rDel.confirmed !== true) bad.push('删除成功竟未报 confirmed：' + JSON.stringify(rDel));
        const delFail = { get: () => '旧的还在', set: () => Promise.resolve(true) };
        const rDelFail = box.writeConfirmed(delFail, 'k', null);
        if (rDelFail.phase !== box.PHASE_NOT_CONFIRMED) bad.push('删没删掉不分面：' + JSON.stringify(rDelFail));
        /* ③d 行集面同一条口径：写空读空 = confirmed，写空读非空 = not_confirmed */
        const rowsDel = box.confirmRows([{ key: 'k', ok: true, value: null }], () => null);
        if (rowsDel[0].confirmed !== true) bad.push('行集面：删除成功未标 confirmed');
        const rowsDelFail = box.confirmRows([{ key: 'k', ok: true, value: null }], () => '旧的还在');
        if (rowsDelFail[0].confirmed !== false) bad.push('行集面：删没删掉不分面');
        /* ③e **结构相等 ≠ 引用相等**：真宿主写对象时读回来必然是新对象
         *    （本仓有一族键写 JSON 文本；写对象树时宿主也可能深拷贝）。
         *    比引用会把「每一次正常落对象」显示成失败 —— 本版自己抓到的第二处缺陷。 */
        const objRt = { raw: '正文', at: 1 };
        const rt = { _v: null, get() { return this._v === null ? null : JSON.parse(this._v); }, set(k, v) { this._v = JSON.stringify(v); return Promise.resolve(true); } };
        const rRt = box.writeConfirmed(rt, 'k', objRt);
        if (rRt.phase !== box.PHASE_CONFIRMED || rRt.confirmed !== true) bad.push('对象 JSON 往返未报 confirmed：' + String(rRt.phase));
        /* 反向：结构**真的不同**必须仍报 not_confirmed（不许为了过上一关把比对放宽成恒真） */
        const diff = { get: () => ({ raw: '旧的', at: 0 }), set: () => Promise.resolve(true) };
        if (box.writeConfirmed(diff, 'k', objRt).phase !== box.PHASE_NOT_CONFIRMED) bad.push('结构不同被放过');
        /* 原值不许因「长得像」被判相等：1 与 '1' 是两回事 */
        if (box.writeConfirmed({ get: () => '1', set: () => Promise.resolve(true) }, 'k', 1).phase !== box.PHASE_NOT_CONFIRMED) bad.push('数字 1 与字符串 1 被判相等');
        /* 深度有界：超深判不等而不是死循环（证明比较有上限） */
        let deep = { v: 1 };
        for (let i = 0; i < box.SHAPE_DEPTH_MAX + 3; i += 1) deep = { n: deep };
        const deepCopy = JSON.parse(JSON.stringify(deep));
        if (box.readbackSame(deep, deepCopy) !== false) bad.push('超深结构未被判不等（深度上限失效）');
        if (box.readbackSame({ a: 1 }, { a: 1 }) !== true) bad.push('浅结构相同未判相等');
        /* ④ 没传读者 ⇒ 一个都不许标「读不回」（两种失真必须可分） */
        const rowsNoReader = box.confirmRows([{ key: 'a', ok: true, value: 1 }], undefined);
        if (Object.prototype.hasOwnProperty.call(rowsNoReader[0], 'confirmed')) bad.push('没做回读竟被标了 confirmed');
        /* ⑤ 传了读者但读不回 ⇒ false + notReadBack */
        const rowsLost = box.confirmRows([{ key: 'a', ok: true, value: 1 }], () => undefined);
        if (rowsLost[0].confirmed !== false || rowsLost[0].notReadBack !== true) bad.push('读不回未被标成 notReadBack');
        /* ⑥ 话术面：八态各有各的话，且「读不出的相位」不许与任何一格已知相位同话
         *    （自造字符串被说成「落下去了且读回一致」= 把读不出伪装成已确认）。 */
        const texts = box.RECEIPT_PHASES.map((p) => box.phaseText(p));
        for (let i = 0; i < box.RECEIPT_PHASES.length; i += 1) {
            if (!texts[i] || typeof texts[i] !== 'string') bad.push('相位缺话术：' + box.RECEIPT_PHASES[i]);
        }
        if (new Set(texts).size !== box.RECEIPT_PHASES.length) bad.push('相位话术有重（八态被压成同一句话）');
        const unk = box.phaseText('confirmed!');
        if (texts.indexOf(unk) >= 0) bad.push('读不出的相位与某一格已知相位同话');
        /* ⑦ 判据面：only written/confirmed 能过门，自造相位一律不成 */
        if (box.phaseSettled(box.PHASE_CONFIRMED) !== true) bad.push('phaseSettled 把已确认判成没落');
        for (const p of [box.PHASE_WRITTEN, box.PHASE_PARTIAL, box.PHASE_NOT_CONFIRMED, box.PHASE_FAILED, box.PHASE_THREW, box.PHASE_GATE_FAILED, box.PHASE_PREPARED, 'confirmed!']) {
            if (box.phaseSettled(p) !== false) bad.push('phaseSettled 放过了未确认相位：' + p);
        }
        return bad;
    },
    /* R-O4 **验收原文**那四种情形：都不得判成「可以显示已保存」。 */
    acceptFour: async (root) => {
        const box = await import(pathToFileURL(path.join(root, RECEIPT_REL)).href + '?f=' + String(seq));
        const bad = [];
        if (box.writeLanded({ ok: true, saved: true, phase: box.PHASE_NOT_CONFIRMED }) !== false) bad.push('not_confirmed 照报成了');
        if (box.writeLanded({ ok: true, saved: true, phase: box.PHASE_PARTIAL }) !== false) bad.push('partial 照报成了');
        /* 另外两种靠 saved 口径，同样必须挡住 */
        if (box.writeLanded({ ok: true, saved: false }) !== false) bad.push('set 返回假照报成了');
        if (box.writeLanded({ ok: true, saved: false, phase: box.PHASE_THREW }) !== false) bad.push('抛错照报成了');
        if (box.writeLanded({ ok: true, saved: true, phase: box.PHASE_CONFIRMED }) !== true) bad.push('已确认竟被判不成');
        /* 自造相位不许冒充已确认（`isReceiptPhase` 那一格被摘时这条会响） */
        if (box.writeLanded({ ok: true, saved: true, phase: 'confirmed!' }) !== false) bad.push('自造相位照报成了');
        return bad;
    },
    /* 读抛错 + 写空（删这一格）⇒ 必须 not_confirmed。
     *   为什么专挑这一格：它是「读抛了」与「读回空」两条路径**唯一能分开**的地方 ——
     *   若把读抛错那一格分支摘掉，删除语义会让 readbackSame(null, undefined) 判成一致
     *   ⇒ 读都读不出来却报「已确认」。这正是「看起来没坏但显示不对」。 */
    'phase-empty': async (root) => {
        const box = await import(pathToFileURL(path.join(root, RECEIPT_REL)).href + '?e=' + String(seq));
        const bad = [];
        const getThrows = { get: () => { throw new Error('x'); }, set: () => Promise.resolve(true) };
        const r = box.writeConfirmed(getThrows, 'k', null);
        if (r.phase !== box.PHASE_NOT_CONFIRMED || r.confirmed !== false) {
            bad.push('读抛错未报 not_confirmed：' + JSON.stringify(r));
        }
        return bad;
    },
    /* 渲染层唯一写入 owner：裸写（两个 owner）必须转红。 */
    viewWrite: (root) => Promise.resolve(viewWriteProblems(root)),
    /* 混用史台账：掏空 ⇒ 台账自洽判据必须转红（R-O4 第 5 条）。 */
    mixedShape: async (root) => {
        const box = await import(pathToFileURL(path.join(root, RECEIPT_REL)).href + '?m=' + String(seq));
        const bad = [];
        const led = box.STORAGE_SHAPE_LEDGER;
        if (!Array.isArray(led) || led.length < 5) bad.push('形态史台账条数不足：' + String(led && led.length));
        /* 台账每条必须真在源码里找得到那条容错分支（防「空挂」） */
        for (const row of (led || [])) {
            let src = '';
            try { src = readFrom(root, row.rel); } catch (_e) { bad.push('台账载体不在场：' + row.rel); continue; }
            if (src.indexOf('JSON.parse') < 0) bad.push('台账载体没有历史兼容读：' + row.rel);
            if (src.indexOf(row.key) < 0) bad.push('台账键名在载体里找不到：' + row.rel + ' :: ' + row.key);
        }
        return bad;
    },
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

/* ── [v3.74.0 · 计划 R-O4 第 4 条] 渲染层不得顺手修数据：一格数据只许一个写主 ──
 * 治的是「同一格有两个 owner」：渲染层顺手 `storage.set(...)` 时，那一格的回执读数
 *   **一概不经过它**（写了没写、读不读得回，全都读不出来），而数据侧还以为自己独占该键。
 * 三处**都是真扫出来的**（不是推演）：音乐悬浮窗开关 / 电话自动朗读开关 / 微信贴纸缓存。
 * 判据用剥注释剥字符串后的代码面 —— 否则改注释里的旧写法示例会被误判成复发。
 * ★ 台账第三格记的是「参数形态」而不是「哪个出口」：两个开关从 writeReceipt 升级成
 *   writeConfirmed（写 + 回读一次）是**同一件事做深了一步**，不是换实现；
 *   若把台账钉死成某个出口名，这次升级就会被判成「owner 声明与代码不符」——
 *   那是**判据钉错了格**（该钉「经过唯一实现」而钉成了「经过哪一支」）。 */
const VIEW_WRITE_LEDGER = [
    ['apps/music/music-view.js', 'music_show_floating', "this.app.storage, 'music_show_floating'"],
    ['apps/phone/phone-view.js', 'phone-call-auto-tts', "this.app.storage, 'phone-call-auto-tts'"],
    ['apps/wechat/chat-view.js', 'phone_wechat_alapi_sticker_cache_v1', 'writeReceipt(storage, WECHAT_STICKER_ALAPI_CACHE_KEY'],
];
const BARE_SET_RE = /\bstorage\s*\??\.\s*set\s*\(/;
function viewWriteProblems(root) {
    const bad = [];
    /* ① 渲染层全扫：`*-view.js` 里一处裸写都不许剩（新写的也不许） */
    const stack = [path.join(root, 'apps')];
    while (stack.length) {
        const d = stack.pop();
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { stack.push(p); continue; }
            if (!e.name.endsWith('-view.js')) continue;
            const code = codeOnly(readFrom(root, path.relative(root, p).split(path.sep).join('/')));
            const m = BARE_SET_RE.exec(code);
            if (m) {
                const rel = path.relative(root, p).split(path.sep).join('/');
                bad.push('R6 ' + rel + ' 渲染层仍有裸写（那一格有两个 owner）：'
                    + code.slice(Math.max(0, m.index - 30), m.index + 50).split(NL).join(' '));
            }
        }
    }
    /* ② 三个已知口必须走唯一实现（唯一 owner 是**读数**，不是声明） */
    for (const [rel, key, mark] of VIEW_WRITE_LEDGER) {
        const code = codeKeepStr(readFrom(root, rel));
        if (hits(code, mark) < 1) bad.push('R6 ' + rel + ' 的 ' + key + ' 未走唯一实现（owner 声明与代码不符）');
    }
    return bad;
}
/* ── [v3.74.0 · 计划 R-O4 第 2/3 条] 回读确认面的**真行为**（带真 storage 往返） ── */
async function readbackSurface() {
    const bad = [];
    const box = await import(pathToFileURL(path.join(ROOT, RECEIPT_REL)).href + '?R=' + String(seq));
    /* ① 说谎存储（写调用成了、盘上没变）⇒ not_confirmed；真写存储 ⇒ confirmed。
     *   这一对是本版最贵的形态：旧读数两格同形，界面照报「已保存」。 */
    const liar = { get: () => 'old', set: () => Promise.resolve(true), remove: () => Promise.resolve(true) };
    const rl = box.writeConfirmed(liar, 'k', 'new');
    if (rl.phase !== box.PHASE_NOT_CONFIRMED) bad.push('R7 说谎存储未报 not_confirmed：' + rl.phase);
    if (rl.confirmed !== false) bad.push('R7 说谎存储竟标 confirmed');
    const truth = { _v: 'old', get() { return this._v; }, set(k, v) { this._v = v; return Promise.resolve(true); }, remove() { this._v = undefined; return Promise.resolve(true); } };
    const rt = box.writeConfirmed(truth, 'k', 'new');
    if (rt.phase !== box.PHASE_CONFIRMED || rt.confirmed !== true) bad.push('R7 真写存储未报 confirmed：' + JSON.stringify(rt));
    /* ② 读抛错 ⇒ 不许 confirmed，且不许与「明确没落」同形 */
    const getThrows = { get: () => { throw new Error('get boom'); }, set: () => Promise.resolve(true), remove: () => Promise.resolve(true) };
    const rg = box.writeConfirmed(getThrows, 'k', 'new');
    if (rg.phase !== box.PHASE_NOT_CONFIRMED || rg.saved !== true) bad.push('R7 get 抛错未如实报：' + JSON.stringify(rg));
    /* 读得回来但读不到东西（get 回 undefined）⇒ 同样是 not_confirmed ——
     *   与「读抛了」合成一格可以，与 confirmed 合成一格不行：界面上都「不能报成」。 */
    const emptyRead = { get: () => undefined, set: () => Promise.resolve(true) };
    const re = box.writeConfirmed(emptyRead, 'k', 'new');
    if (re.phase !== box.PHASE_NOT_CONFIRMED || re.confirmed !== false) bad.push('R7 读不到东西未报 not_confirmed：' + JSON.stringify(re));
    if (box.writeConfirmed(null, 'k', 1).phase !== box.PHASE_GATE_FAILED) bad.push('R7 无存储接口未报 gate_failed');
    if (box.writeConfirmed({ set: () => { throw new Error('x'); } }, 'k', 1).phase !== box.PHASE_THREW) bad.push('R7 写抛错未报 threw');
    /* ③ 多键：三键里第二键没落 ⇒ partial，且完成范围如实（kept/lost） */
    const st = accStorage({ failKeys: ['b'] });
    const scope = box.writeScopeReceipt([
        { key: 'a', ok: true, value: 1 }, { key: 'b', ok: false, value: 2 }, { key: 'c', ok: true, value: 3 },
    ], (k) => st.get(k, undefined));
    if (scope.phase !== box.PHASE_PARTIAL) bad.push('R7 多键中途失败未报 partial：' + scope.phase);
    if (scope.saved !== false) bad.push('R7 多键中途失败竟报 saved');
    if (String(scope.kept) !== 'a,c' || String(scope.lost) !== 'b') bad.push('R7 完成范围不符：' + JSON.stringify(scope.kept) + '/' + JSON.stringify(scope.lost));
    /* ④ 重开往返：写 → 等落队 → 新实例装回来，逐字一致（真 async 契约 + 真模块） */
    {
        const M = await import(pathToFileURL(path.join(ROOT, 'apps/cotdesk/cotdesk-app.js')).href + '?R=' + String(seq));
        const st2 = accStorage();
        const text = JSON.stringify([{ id: 'z1', kind: 'pair', prompt: 'p', reply: 'r' }]);
        const app = new M.CotdeskApp({ getContentContainer: () => null }, st2);
        app.ingestItems(text);
        await CY();
        const app2 = new M.CotdeskApp({ getContentContainer: () => null }, st2);
        app2.probe();
        if (app2.rawLen() !== text.length) bad.push('R7 重开往返长度不符：' + String(app2.rawLen()));
    }
    return bad;
}

test('R6 渲染层唯一写入 owner：三处直写全部走上唯一实现，全仓渲染层零裸写', () => {
    const bad = viewWriteProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
    assert.equal(VIEW_WRITE_LEDGER.length, 3, '台账三条（三处真扫出来的直写点）');
});
test('R7 回读确认面真行为：说谎存储必须读得出、真假两态不同形、多键部分落 = partial', async () => {
    const bad = await readbackSurface();
    assert.deepEqual(bad, [], bad.join(' | '));
});
/* ── [v3.74.0 · 计划 R-O4 第 5 条] 对象值与 JSON 文本混用的历史兼容路径 ── */
/** 解码口径的真行为：**三分面**不许塌（原值 / 没写过 / 读不懂）。 */
async function decodeSurface() {
    const bad = [];
    const box = await import(pathToFileURL(path.join(ROOT, RECEIPT_REL)).href + '?D=' + String(seq));
    const d = box.decodeStored;
    if (typeof d !== 'function') { bad.push('R8 缺解码唯一口径 decodeStored'); return bad; }
    /* ① 旧形态：裸对象（宿主直接存引用）—— 原样交回，**不许**再 JSON.parse 一次 */
    const obj = { a: 1 };
    const r1 = d(obj);
    if (r1.ok !== true || r1.value !== obj) bad.push('R8 旧形态（裸对象）未原样交回');
    /* ② 新形态：JSON 文本 —— 解回对象 */
    const r2 = d(JSON.stringify(obj));
    if (r2.ok !== true || JSON.stringify(r2.value) !== JSON.stringify(obj)) bad.push('R8 JSON 文本未解回');
    /* ③ 没写过（空串 / 全空白）与 ④ 读不懂（坏 JSON）**必须不同形**：
     *   前者是「这一格是空的」，后者是「这一格坏了」。合成一格就是把坏数据静默当空。 */
    const e1 = d('');
    const e2 = d('   ');
    const m1 = d('{坏');
    if (e1.ok !== true || e1.why !== 'empty' || e1.value !== null) bad.push('R8 空串未报 empty：' + JSON.stringify(e1));
    if (e2.ok !== true || e2.why !== 'empty') bad.push('R8 全空白未报 empty：' + JSON.stringify(e2));
    if (m1.ok !== false || m1.why !== 'json') bad.push('R8 坏 JSON 未报 json：' + JSON.stringify(m1));
    if (m1.why === e1.why) bad.push('R8 「读不懂」与「没写过」同形');
    /* ⑤ 数字 / 布尔等原值也要走原值形态（不是字符串就不解） */
    if (d(0).value !== 0 || d(false).value !== false) bad.push('R8 原值被误当文本解');
    return bad;
}
/** 形态史台账：与真源码对得上（防空挂）。 */
function mixedShapeProblems(root) {
    const bad = [];
    const code = codeKeepStr(readFrom(root, RECEIPT_REL));
    if (code.indexOf('export const STORAGE_SHAPE_LEDGER = Object.freeze([') < 0) {
        bad.push('R8 形态史台账不在场');
        return bad;
    }
    const starts = code.split('{ rel: ').slice(1);
    if (starts.length < 5) bad.push('R8 台账条数不足：' + String(starts.length));
    for (const chunk of starts) {
        const body = chunk.split('}')[0];
        /* 注意：split 已经把 `{ rel: ` 吃掉，故载体名是**这一段的第一个引号串**。 */
        const mRel = body.match(/^'([^']+)'/);
        const mKey = body.match(/key: '([^']+)'/);
        const mShape = body.match(/shape: '([^']+)'/);
        if (!mRel || !mKey || !mShape) { bad.push('R8 台账条目字段不齐：' + body.slice(0, 60)); continue; }
        if (['raw', 'json'].indexOf(mShape[1]) < 0) bad.push('R8 台账形态取值不认识：' + mShape[1]);
        let src = '';
        try { src = readFrom(root, mRel[1]); }
        catch (_e) { bad.push('R8 台账载体不在场：' + mRel[1]); continue; }
        if (src.indexOf(mKey[1]) < 0) bad.push('R8 台账键名在载体里找不到（台账已脱钩）：' + mRel[1] + ' :: ' + mKey[1]);
        if (src.indexOf('JSON.parse') < 0) bad.push('R8 台账载体没有历史兼容读：' + mRel[1]);
    }
    return bad;
}
test('R8 混用史的兼容读：解码三分面不许塌 + 台账与真源码对得上（R-O4 第 5 条）', async () => {
    const bad = await decodeSurface();
    assert.deepEqual(bad, [], bad.join(' | '));
    const bad2 = mixedShapeProblems(ROOT);
    assert.deepEqual(bad2, [], bad2.join(' | '));
});

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