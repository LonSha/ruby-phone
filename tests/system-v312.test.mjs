// tests/system-v312.test.mjs — 删楼回滚族的楼层取值门（O-2 下游侧）[v3.3.0]
//   上游记忆插件 v3.224.0（O-2）把「用 `Number()` 结果当门」这条根因在**回放/前移层**收干净，
//   并新增 `skipped: 'floor-not-given'` 读数。按跨仓纪律逐条判定后，本仓在本轮**同族**里
//   实测到同一根因的**下游面**（不是「上游给了就照抄」，是本仓自己的真缺陷）：
//
//   ① index.js MESSAGE_DELETED：
//        const deletedFloor = Number(eventData?.messageId ?? eventData?.id ?? eventData);
//        if (Number.isFinite(deletedFloor)) { … onFloorRollback(deletedFloor); }
//      **半收口**：只挡 `undefined` / `NaN` / 非数字串，而
//      `Number('') === Number('  ') === Number([]) === 0`、`Number(true) === 1` 全部通关。
//      0 在本仓是**合法楼层**（SillyTavern 楼层 0 基；本文件同族写法
//      `rollbackPhoneSmsToFloor(index, …)` 收到的正是 0 基 index）。
//   ② apps/memory/memory-data.js `invalidateFloorAt(floor)`：
//        const hit = (f) => f !== null && f !== undefined && Number(f) >= Number(floor);
//      `floor` 取 0 / '' / [] 时 `Number(f) >= 0` **恒真**。实测（真模块原型方法）：
//      `invalidateFloorAt('')` 把 longTerm 5 条 + shortTerm 2 条**全清**（n=6），
//      只剩 `floor === null` 那条 —— 一次误调用清空整份记忆。
//   ③ apps/memory/lonsha-bridge.js `onFloorRollback(floor)`：`Number(floor)` 直通 memoryCore，
//      是同一半收口的第一道。
//
//   修法（与上游 O-2 及本仓既有先例同口径）：三处各持一份本地 `floorOrNull`，只认数字与
//   非空数字字符串，其余如实 null（「没给」）；**真给 0 照常动手**（判开是双向的）。
//
//   层次：A 门本体（三份实现逐条同口径）
//         B 数据层行为（★ 真模块：没给 ⇒ 一条不清；真给 0 ⇒ 照常清）
//         C 桥层行为（★ 真模块：没给 ⇒ memoryCore 不被调用）
//         D 宿主入口形态（★ index.js 的删楼路径必须走门，不得退回 Number()+isFinite）
//         E 版本与文档同源
//         F 负控制（真源码破坏 → **整仓镜像** → 同款真判据必须转红）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const IDX = 'index.js';
const BR = 'apps/memory/lonsha-bridge.js';
const MD = 'apps/memory/memory-data.js';

const BR_MOD = await import(at(BR));
const MD_MOD = await import(at(MD));
const IDX_SRC = read(IDX);
const BR_SRC = read(BR);
const MD_SRC = read(MD);
const pkg = JSON.parse(read('package.json'));

/** 本仓既有强口径先例（只认数字与非空数字字符串）。 */
const STRONG = 'if (typeof v === \'number\') return Number.isFinite(v) ? v : null;';
const GIVEN = [['null', null], ['undefined', undefined], ["''", ''], ["'  '", '  '], ['[]', []], ['[5]', [5]], ['{}', {}], ['true', true], ['false', false], ['NaN', NaN], ["'甲'", '甲'], ["'1a'", '1a']];
const REAL = [['0', 0], ["'0'", '0'], ["'5'", '5'], ['5', 5], ["' 5 '", ' 5 '], ['3.5', 3.5]];

const mkStore = () => ({ longTerm: [{ floor: 0 }, { floor: 1 }, { floor: 5 }, { floor: 12 }, { floor: null }], shortTerm: [{ floor: 0 }, { floor: 3 }] });
/** 复用真模块的原型方法（绕过构造器，只测这段判据；pool 置 null）。 */
/** 接收者：原型方法是在 `this` 上重写 `this.longTerm` / `this.shortTerm` 的，
 *  所以判据必须读**同一个对象**。首稿把临时接收者丢进去、回头读原 store ——
 *  那个数组从头到尾没被碰过：「没给 ⇒ 一条不清」恒绿（假绿），
 *  「真给 0 ⇒ 清 6 条」永远看不到。观测点必须对准被改写的对象。 */
function mkReceiver(store) {
    return { longTerm: store.longTerm, shortTerm: store.shortTerm, pool: null, _save() { }, n: null };
}
function callInvalidate(recv, floor) {
    recv.n = MD_MOD.MemoryCore.prototype.invalidateFloorAt.call(recv, floor);
    return recv.n;
}
const totalOf = (s) => s.longTerm.length + s.shortTerm.length;

// ══════════ A 门本体：三份实现同口径 ══════════
test('v312 A1. ★ 三处入口都有取值门，且都是「先看类型」（不是 Number() 兜底）', () => {
    assert.ok(/function stFloorOrNull\(v\)/.test(IDX_SRC), '★ index.js 必须有 stFloorOrNull');
    assert.ok(/function floorOrNull\(v\)/.test(BR_SRC), '★ lonsha-bridge.js 必须有 floorOrNull');
    assert.ok(/function floorOrNull\(v\)/.test(MD_SRC), '★ memory-data.js 必须有 floorOrNull');
    for (const [name, src] of [['index.js', IDX_SRC], ['lonsha-bridge.js', BR_SRC], ['memory-data.js', MD_SRC]]) {
        assert.ok(src.includes(STRONG), '★ ' + name + ' 的门须先看类型（与 config/* 的 numOrNull 同口径）');
        assert.ok(/typeof v === 'string'/.test(src), '★ ' + name + ' 须认非空数字字符串');
    }
});

test('v312 A2. ★ 门本体行为：怪值一律 null，真给 0 仍是 0（双向）', () => {
    // 从源码里提门本体出来跑（三份都跑，防某一份悄悄演化）
    for (const [name, src] of [['index.js', IDX_SRC], ['lonsha-bridge.js', BR_SRC], ['memory-data.js', MD_SRC]]) {
        const fn = /function (?:st)?[fF]loorOrNull\(v\) \{[\s\S]*?\n\}/.exec(src);
        assert.ok(fn, name + ' 门本体可提取');
        const gate = new Function('return (' + fn[0].replace(/function (?:st)?[fF]loorOrNull/, 'function') + ')')();
        for (const [label, v] of GIVEN) assert.equal(gate(v), null, name + ' 对 ' + label + ' 须判「没给」');
        for (const [label, v] of REAL) assert.equal(gate(v), Number(v), name + ' 对 ' + label + ' 须如实给数');
    }
});

// ══════════ B 数据层行为（真模块） ══════════
test('v312 B1. ★★ 没给楼层 ⇒ 一条记忆都不清（修前全清）', () => {
    for (const [label, v] of GIVEN) {
        const r = mkReceiver(mkStore());
        const before = totalOf(r);
        const n = callInvalidate(r, v);
        assert.equal(n, 0, '★ ' + label + ' 不得清任何条目，实得 ' + n);
        assert.equal(totalOf(r), before, '★ ' + label + ' 之后记忆条数必须不变');
    }
});

test('v312 B2. ★★ 反坐实：真给 0 照常动手（门不得关成「谁都清不动」）', () => {
    const r0 = mkReceiver(mkStore());
    const n = callInvalidate(r0, 0);
    assert.equal(n, 6, '★ 真给第 0 楼须清掉 >= 0 的全部条目，实得 ' + n);
    assert.deepEqual(r0.longTerm.map((x) => x.floor), [null], '★ floor=null 那条不参与（它没有楼层锚点）');

    const r5 = mkReceiver(mkStore());
    assert.equal(callInvalidate(r5, 5), 2, '★ 真给 5 只清 5/12 与 shortTerm 里 >= 5 的');
    assert.deepEqual(r5.longTerm.map((x) => x.floor), [0, 1, null]);
});

test('v312 B3. ★ 逐条锚点判据自身也过门：脏 floor 不得造成「恒真」命中', () => {
    // 修前 hit 里也写着 `Number(f)`，`f = ''` 的条目会被算成第 0 楼而卷入
    const r = mkReceiver({ longTerm: [{ floor: '' }, { floor: 5 }, { floor: null }, { floor: undefined }], shortTerm: [] });
    const n = callInvalidate(r, 9);
    assert.equal(n, 0, '★ 脏 floor 条目不得被当成第 0 楼卷入，实得 ' + n);
    assert.equal(r.longTerm.length, 4, '★ 一条都不该少');
});

// ══════════ C 桥层行为（真模块） ══════════
test('v312 C1. ★★ 没给楼层 ⇒ 桥不得调用 memoryCore（修前会传 0 进去）', () => {
    for (const [label, v] of GIVEN) {
        const b = new BR_MOD.LonShaBridge();
        const calls = [];
        b.memoryCore = { invalidateFloorAt: (f) => { calls.push(f); return 1; } };
        b.onFloorRollback(v);
        assert.deepEqual(calls, [], '★ ' + label + ' 不得下传 memoryCore，实得 ' + JSON.stringify(calls));
    }
});

test('v312 C2. ★ 反坐实：真给 0 / \'5\' / \' 5 \' 照常下传，且下传的是门后的数值', () => {
    for (const [label, v] of REAL) {
        const b = new BR_MOD.LonShaBridge();
        const calls = [];
        b.memoryCore = { invalidateFloorAt: (f) => { calls.push(f); return 1; } };
        b.onFloorRollback(v);
        assert.deepEqual(calls, [Number(v)], '★ ' + label + ' 须下传 ' + Number(v) + '，实得 ' + JSON.stringify(calls));
    }
});

// ══════════ D 宿主入口形态 ══════════
test('v312 D1. ★★ index.js 的删楼路径必须走门，不得退回 Number()+isFinite', () => {
    const seg = IDX_SRC.slice(IDX_SRC.indexOf('context.event_types.MESSAGE_DELETED'), IDX_SRC.indexOf('context.event_types.MESSAGE_DELETED') + 900);
    assert.ok(/stFloorOrNull\(eventData\?\.messageId/.test(seg), '★ 删楼路径须走 stFloorOrNull');
    assert.ok(!/Number\.isFinite\(deletedFloor\)/.test(seg), '★ 不得保留 Number()+isFinite 的半收口');
    assert.ok(/deletedFloor !== null/.test(seg), '★ 判据须是「没给 ⇒ 跳过」');
    assert.ok(/lonshaBridge\?\.onFloorRollback\(deletedFloor\)/.test(seg), '★ 桥调用契约不变（既有判据锁着这一行）');
});

test('v312 D2. ★ 三处门位置互不串味：宿主门不叫 floorOrNull，模块门不定义 stFloorOrNull', () => {
    assert.ok(!/function floorOrNull\(v\)/.test(IDX_SRC), '★ index.js 用 stFloorOrNull 前缀，避免与 apps/* 的门混同');
    // 只管**定义**，不管**提及**：模块注释里写「与 index.js 的 stFloorOrNull 同因同法」是好事
    //（读者顺着名字就能找到同族）。首稿把它一起禁掉属于判据过严 —— 该挡的是重名实现。
    assert.ok(!/function stFloorOrNull/.test(MD_SRC) && !/function stFloorOrNull/.test(BR_SRC),
        '★ 两个模块不得**定义**宿主专用名（提及不受限）');
});

// ══════════ E 版本与文档同源 ══════════
test('v312 E1. ★ 版本四源同源（入口 / manifest / update-log.latest / update-log 条目）', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(IDX_SRC) || [])[1];
    assert.ok(codeVer, '入口版本常量在场');
    assert.equal(codeVer, manifest.version, '入口 == manifest');
    assert.equal(log.latest, manifest.version, 'update-log.latest == manifest');
    assert.ok((log.versions || {})[manifest.version], 'update-log 含当前版本条目');
    // 本轮捐到并修掉的真缺陷立成常驻判据：`versions` 的**首键必须即当前版本**。
    // 抬版脚本把新版本块 append 到末尾时，版本同源族 30+ 条既有判据会一起翻红
    //（它们全在读 `Object.keys(versions)[0]`）；键序也是契约，不只是 JSON 语义。
    assert.equal(Object.keys(log.versions)[0], manifest.version,
        '★ update-log.versions 首键必须是当版（抬版须插首位，不是追加末尾）');
    assert.ok(vnum(codeVer) >= vnum('3.3.0'), '★ 本套件只在 3.3.0 及以后成立，当前 ' + codeVer);
});
const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));

test('v312 E2. ★ 当版读数如实：CURRENT_UPDATE 记的是本版这件事', () => {
    // [v3.3.2] 当版锚交棒：本条原拿 log.latest 的条目比「取值门|没给|第 0 楼」
    //   —— 那是本套件出生版本 v3.3.0 的**当版精确判定**；抬版后 log.latest 指向新版本，
    //   其说明自然不重复这三个词。改为仓内既定口径（同 v311-E2 / v310-E2 等）：
    //   事件关键词锚**本套件出生版本**，「弹窗逐字同源」那半仍锚**当版**。
    //   当版精确判定由当版 frontier 套件接管（本版即 v314）。
    const log = JSON.parse(read('update-log.json'));
    const own = log.versions['3.3.0'];
    assert.ok(own && Array.isArray(own.items), 'v3.3.0 条目必须仍在（本判据钉的是历史事实）');
    assert.ok(own.items.join('\n').match(/取值门|没给|第 0 楼/), '★ 出生版本的条目须点名那次收的是什么');
    const seg = IDX_SRC.slice(IDX_SRC.indexOf('const ST_PHONE_CURRENT_UPDATE'));
    const head = seg.slice(0, seg.indexOf(']') + 1);
    assert.ok(/version: ST_PHONE_VERSION/.test(head), '版本键指向常量（当版）');
    for (const it of log.versions[log.latest].items) {
        assert.ok(head.includes(JSON.stringify(it)), '弹窗 items 逐字同源（当版）：' + it.slice(0, 20));
    }
});

// ══════════ F 负控制（真源码破坏 → 整仓镜像 → 同款真判据转红） ══════════
const ORIG = new Map();
for (const f of [IDX, BR, MD]) ORIG.set(f, read(f));

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v312-mir-'));
    fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('.git') });
    for (const [rel, fn] of Object.entries(mut)) {
        const body = fn(read(rel));
        assert.notEqual(body, read(rel), '破坏未发生（锚点没命中）：' + rel);
        fs.writeFileSync(path.join(dir, rel), body);
    }
    for (const [g, src] of ORIG) {
        if (Object.prototype.hasOwnProperty.call(mut, g)) continue;
        fs.writeFileSync(path.join(dir, g), src);
    }
    return dir;
}
async function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** J1 数据层：没给 ⇒ 一条不清；真给 0 ⇒ 照常清（用**副本**里的模块跑，判据与 A/B 同款）。 */
function dataJudge(mod) {
    for (const [, v] of GIVEN) {
        const r = mkReceiver(mkStore());
        const before = totalOf(r);
        const n = mod.MemoryCore.prototype.invalidateFloorAt.call(r, v);
        if (n !== 0 || totalOf(r) !== before) return false;
    }
    const r0 = mkReceiver(mkStore());
    const n0 = mod.MemoryCore.prototype.invalidateFloorAt.call(r0, 0);
    return n0 === 6 && r0.longTerm.length === 1;
}
/** J2 桥层：没给 ⇒ 不下传；真给 ⇒ 下传门后的数。 */
function bridgeJudge(mod) {
    for (const [, v] of GIVEN) {
        const b = new mod.LonShaBridge();
        const calls = [];
        b.memoryCore = { invalidateFloorAt: (f) => { calls.push(f); return 1; } };
        b.onFloorRollback(v);
        if (calls.length !== 0) return false;
    }
    const b = new mod.LonShaBridge();
    const calls = [];
    b.memoryCore = { invalidateFloorAt: (f) => { calls.push(f); return 1; } };
    b.onFloorRollback(' 5 ');
    return calls.length === 1 && calls[0] === 5;
}
/** J3 宿主入口形态（纯文本判据，跑在副本源码上）。 */
function hostJudge(idxSrc) {
    const i = idxSrc.indexOf('context.event_types.MESSAGE_DELETED');
    if (i < 0) return false;
    const seg = idxSrc.slice(i, i + 900);
    return /stFloorOrNull\(eventData\?\.messageId/.test(seg) && !/Number\.isFinite\(deletedFloor\)/.test(seg);
}

test('v312 N0. 镜像树自证 + 阳性对照：未破坏时三条判据全真（否则 N 组是假绿）', () => {
    assert.equal(dataJudge(MD_MOD), true, 'J1 在原件上必须为真');
    assert.equal(bridgeJudge(BR_MOD), true, 'J2 在原件上必须为真');
    assert.equal(hostJudge(IDX_SRC), true, 'J3 在原件上必须为真');
    const dir = mirror({});
    try {
        assert.ok(fs.existsSync(path.join(dir, MD)), '镜像里必须带上数据层本体');
        assert.ok(fs.existsSync(path.join(dir, BR)), '镜像里必须带上桥本体');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v312 N1. ★★★ 负控制·数据层门退化：invalidateFloorAt 退回 `Number(floor)` ⇒ J1 转红', async () => {
    await withMirror({
        [MD]: (s) => mutateOnce(s,
            "            const d0 = floorOrNull(floor);\n            if (d0 === null) return 0;",
            "            const d0 = Number(floor);")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, MD)).href + '?m=' + Date.now());
        assert.equal(dataJudge(broken), false, '★ 同款判据 J1 在副本上必须为 false');
        assert.equal(dataJudge(MD_MOD), true, '对照：原件上仍为真');
    });
});

test('v312 N2. ★★★ 负控制·桥层门退化：onFloorRollback 退回 `Number(floor)` ⇒ J2 转红（半收口形态复现）', async () => {
    await withMirror({
        [BR]: (s) => mutateOnce(s,
            "            const f0 = floorOrNull(floor);\n            if (f0 === null) return;\n            const n = this.memoryCore?.invalidateFloorAt?.(f0);",
            "            const n = this.memoryCore?.invalidateFloorAt?.(Number(floor));")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, BR)).href + '?m=' + Date.now());
        assert.equal(bridgeJudge(broken), false, "★ J2 必须转红（`Number('') === 0` 复活）");
    });
});

test('v312 N3. ★★ 负控制·宿主入口退回半收口 ⇒ J3 转红', async () => {
    await withMirror({
        [IDX]: (s) => mutateOnce(s,
            "                        const deletedFloor = stFloorOrNull(eventData?.messageId ?? eventData?.id ?? eventData);\n                        if (deletedFloor !== null) {",
            "                        const deletedFloor = Number(eventData?.messageId ?? eventData?.id ?? eventData);\n                        if (Number.isFinite(deletedFloor)) {")
    }, async (dir) => {
        const brokenSrc = fs.readFileSync(path.join(dir, IDX), 'utf8');
        assert.equal(hostJudge(brokenSrc), false, '★ J3 在副本上必须为 false');
        assert.equal(hostJudge(IDX_SRC), true, '对照：原件上仍为 true');
    });
});

test('v312 N4. ★★ 负控制·互不掩护：数据层门退化只打掉「没给」面，真给 0 面必须仍成立', async () => {
    await withMirror({
        [MD]: (s) => mutateOnce(s,
            "            const d0 = floorOrNull(floor);\n            if (d0 === null) return 0;",
            "            const d0 = Number(floor);")
    }, async (dir) => {
        const broken = await import(pathToFileURL(path.join(dir, MD)).href + '?m=' + Date.now());
        assert.equal(dataJudge(broken), false, '★ 怪值面必须转红');
        // 真给面仍须成立 —— 否则说明判据只是「什么都判 false」，不是挂在门上
        const r0 = mkReceiver(mkStore());
        const n = broken.MemoryCore.prototype.invalidateFloorAt.call(r0, 0);
        assert.equal(n, 6, '★ 真给 0 仍须照常清（门只管没给）');
        assert.equal(r0.longTerm.length, 1, '★ 真给 0 面上接收者确实被改写（观测点对准了同一个对象）');
    });
});
