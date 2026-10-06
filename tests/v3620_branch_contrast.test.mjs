/* ============================================================
 * v3620_branch_contrast.test.mjs — [v3.62.0 · X8 第一切片] 分支对照的**成对判据**
 *
 * 【本档拦的是什么（逐条对应 X8 验收原文）】
 *   A 结构面     —— 出口在场、`applied` 恒 false（**只读**）、四组结构齐全
 *   B1 归组正确  —— 四组语义面各归其位，值变 / 单侧有 分别计数
 *   B2 不重算    —— 差异来自调用方 payload 或上游 `readDiff` 注入（**不自己比对上游口径**）
 *   C1 跨支隔离  —— 分支 A 的秘密不得进入 B（`a-secret-in-b` 真检出）
 *   C2 未核对≠通过 —— 未给秘密名单时 `checked:false`（不得报「无泄漏」）
 *   D1 三态      —— 缺席 / 空 / 正常各自成形，不得同形
 *   D2 半成功    —— 上游 `deep-unavailable`（键面给了、内容级没有）不得与「一样」同形
 *   E  不可测    —— 同支 / 缺名 / 无源三态各自归因
 *   F  真源码破坏 —— 摘掉「跨支泄漏判定」⇒ C1 场景不再成立（归因自证）
 *   G  自防护 + 当版锚点
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REL = 'config/branch-contrast.js';
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const src = () => readRoot(REL);
const ok = (m) => console.log('  OK ' + m);

/* 真源是 ESM：破坏副本要能**独立**载入 ⇒ 写临时文件再 import（带唯一后缀防缓存）。 */
let seq = 0;
async function loadFrom(source) {
    const tmp = path.join('/tmp', 'bc_probe_' + (++seq) + '_' + Date.now() + '.mjs');
    fs.writeFileSync(tmp, source, 'utf8');
    try {
        const m = await import(pathToFileURL(tmp).href);
        return m;
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 清理失败不影响判据 */ }
    }
}
const api = () => loadFrom(src());

/* ---- 破坏锚点（逐字取自真源，禁改；本档须逐字持有） ---- */
/* 锚点①：跨支泄漏判定（C1 的根据）。 */
const A_LEAK_AINB = "            if (row.owner === 'b' && isSecretKey(row.path, aList)) {";
/* 锚点②：未核对时不判定（C2 的根据）。 */
const A_UNCHECKED = "    if (!aList && !bList) {";
/* 锚点③：只读常量（A 结构面的根据）。 */
const A_APPLIED_FALSE = "        applied: false,";
/* 自防护锚点。 */
const A_SELF_HEAD = 'v3620_branch_contrast';

const payloadA = () => ({ charAlice: 'A', commitmentDinner: 'set', financeWallet: 100, clockDay: 3 });
const payloadB = () => ({ charAlice: 'B', financeWallet: 900, clockDay: 5, commitmentSecretRival: 'x' });
const opts = (over) => Object.assign({
    nameA: 'br-a', nameB: 'br-b', payloadA: payloadA(), payloadB: payloadB(), at: 7
}, over || {});

test('v3620 A. 出口在场、只读（applied 恒 false）、四组结构齐全', async () => {
    const m = await api();
    assert.equal(typeof m.branchContrast, 'function', 'branchContrast 必须在出口面');
    assert.equal(m.CONTRAST_VERSION, 1, '对照读数结构版本');
    assert.deepEqual([...m.CONTRAST_GROUPS], ['character', 'commitment', 'finance', 'storyTime'],
        '四组语义面（X8 原文点名）');
    /* 源码面：本模块**只读** —— applied 是结构常量 false。 */
    assert.equal(src().includes(A_APPLIED_FALSE), true, '真源须有 applied:false 落点');
    const r = m.branchContrast(opts());
    assert.equal(r.applied, false, '对照**不应用**任何方案');
    assert.equal(r.applyState, 'read-only');
    assert.ok(r.applyHint.length > 0, '须说明「恢复是显式动作，委托真实 owner」');
    for (const k of ['state', 'groups', 'crossLeak', 'names', 'sealed']) {
        assert.ok(Object.prototype.hasOwnProperty.call(r, k), '结构字段缺: ' + k);
    }
    ok('出口 + applied:false（只读）+ 四组结构齐全');
});

test('v3620 B1. 归组正确：四组各归其位，值变/单侧有分别计数', async () => {
    const m = await api();
    const r = m.branchContrast(opts());
    assert.equal(r.groups.character.counts.changed, 1, 'charAlice 值变 ⇒ character.changed=1');
    assert.equal(r.groups.finance.counts.changed, 1, 'financeWallet 值变 ⇒ finance.changed=1');
    assert.equal(r.groups.storyTime.counts.changed, 1, 'clockDay 值变 ⇒ storyTime.changed=1');
    assert.equal(r.groups.commitment.counts.onlyA, 1, 'commitmentDinner 只在 A ⇒ commitment.onlyA=1');
    assert.equal(r.groups.commitment.counts.onlyB, 1, 'commitmentSecretRival 只在 B ⇒ commitment.onlyB=1');
    /* 归组规则**唯一真源**：每个键的归属可由 groupOfKey 复算。 */
    assert.equal(m.groupOfKey('charAlice'), 'character');
    assert.equal(m.groupOfKey('a.b.commitmentDinner'), 'commitment', '叶子名归组（带路径前缀）');
    assert.equal(m.groupOfKey('financeWallet'), 'finance');
    assert.equal(m.groupOfKey('clockDay'), 'storyTime');
    assert.equal(m.groupOfKey('someUnknownKey'), null, '归不进四组 ⇒ null（不硬塞）');
    /* 未归组的键如实单列。 */
    const r2 = m.branchContrast(opts({ payloadA: { zzzUnknown: 1 }, payloadB: { zzzUnknown: 2 } }));
    assert.equal(r2.unknownRows, 1, '归不进的键进 unknownKeys（不硬塞）');
    ok('四组归组正确 + 未归组键如实单列');
});

test('v3620 B2. 差异来源：payload 直用 或 上游 readDiff 注入（不重算上游口径）', async () => {
    const m = await api();
    /* 上游注入路径：readDiff 返回 readable + deep。 */
    let called = 0;
    const r = m.branchContrast({
        nameA: 'p', nameB: 'q', chatId: 'c1',
        readDiff: (_w, a, b, c) => {
            called++;
            assert.equal(a, 'p'); assert.equal(b, 'q'); assert.equal(c, 'c1');
            return { state: 'readable', reason: 'ok', deep: { onlyInA: ['financeWallet'], onlyInB: [], shared: [], changes: [], sets: [] } };
        }
    });
    assert.equal(called, 1, 'readDiff 须恰被调用 1 次');
    assert.equal(r.groups.finance.counts.onlyA, 1, '上游 deep 的 onlyInA 归组');
    assert.equal(r.diffState, 'readable');
    ok('上游注入路径可用 + 参数透传正确');
});

test('v3620 C1. 跨支隔离：A 的秘密进入 B ⇒ 真检出', async () => {
    const m = await api();
    /* 源码面：判定落点在真源（C1 的根据）。 */
    assert.equal(src().includes(A_LEAK_AINB), true, '真源须有「A 的秘密出现在 B」判定落点');
    /* 合成 A 支的秘密键 `commitmentSecretRival` 只出现在 B ⇒ 泄漏。 */
    const r = m.branchContrast(opts({ secretKeysA: ['commitmentSecret'] }));
    assert.equal(r.crossLeak.checked, true, '给了名单 ⇒ 已核对');
    assert.equal(r.crossLeak.leaks, 1, 'A 的秘密出现在 B ⇒ 检出 1 处');
    assert.equal(r.crossLeak.items[0].kind, 'a-secret-in-b');
    /* 反向：B 的秘密出现在 A。 */
    const r2 = m.branchContrast(opts({
        payloadA: { commitmentSecretMine: 'x' }, payloadB: { commitmentOther: 'y' },
        secretKeysB: ['commitmentSecret']
    }));
    assert.equal(r2.crossLeak.leaks, 1, 'B 的秘密出现在 A ⇒ 检出');
    assert.equal(r2.crossLeak.items[0].kind, 'b-secret-in-a');
    /* 无泄漏时须报 0（真无泄漏，不是未核对）。 */
    const r3 = m.branchContrast(opts({ secretKeysA: ['financeWallet'], secretKeysB: [] }));
    assert.equal(r3.crossLeak.checked, true);
    assert.equal(r3.crossLeak.leaks, 0, '已核对、真无泄漏');
    ok('跨支泄漏真检出（双向）+ 真无泄漏报 0');
});

test('v3620 C2. 未核对≠已通过：未给名单时 checked:false', async () => {
    const m = await api();
    /* 源码面：未核对分支在真源（C2 的根据）。 */
    assert.equal(src().includes(A_UNCHECKED), true, '真源须有「未给名单则不判定」落点');
    const r = m.branchContrast(opts());
    assert.equal(r.crossLeak.checked, false, '未给名单 ⇒ 未核对（不得报「无泄漏」）');
    assert.ok(/未核对/.test(r.crossLeak.why), '原因须点明未核对（实：' + r.crossLeak.why + '）');
    ok('未给秘密名单 ⇒ 未核对（不与「已核对无泄漏」同形）');
});

test('v3620 D1. 三态：缺席 / 空 / 正常各自成形', async () => {
    const m = await api();
    /* 正常：有差异。 */
    assert.equal(m.branchContrast(opts()).state, 'ok');
    /* 空：比过了、确实无差异（真读数）。 */
    const same = m.branchContrast(opts({
        payloadA: { financeWallet: 100 }, payloadB: { financeWallet: 100 }
    }));
    assert.equal(same.state, 'empty', '无差异 ⇒ empty');
    assert.equal(same.reason, 'no-difference');
    /* 缺席：读不到来源。 */
    const absent = m.branchContrast({ nameA: 'x', nameB: 'y' });
    assert.equal(absent.state, 'face-absent', '无源 ⇒ face-absent（不是 empty）');
    assert.notEqual(absent.state, same.state, '缺席与空**必须不同形**');
    ok('三态不同形（ok / empty / face-absent）');
});

test('v3620 D2. 上游半成功（deep-unavailable）不得与「一样」同形', async () => {
    const m = await api();
    const r = m.branchContrast({
        nameA: 'p', nameB: 'q',
        readDiff: () => ({ state: 'readable', reason: 'deep-unavailable', deep: null })
    });
    assert.equal(r.state, 'empty', '半成功：键面给了、内容级没有');
    assert.equal(r.reason, 'deep-unavailable');
    assert.ok(/未知/.test(r.why), '须点明「值级差异未知」（实：' + r.why + '）');
    const line = (await api()).branchContrastLine(r);
    assert.ok(/未知/.test(line) && /不是「一样」/.test(line), '文案须把「未知」与「一样」分开');
    ok('deep-unavailable 单独成形（未知 ≠ 一样）');
});

test('v3620 E. 不可测 ⇒ 各自归因（同支 / 缺名 / 无源）', async () => {
    const m = await api();
    const samePair = m.branchContrast({ nameA: 'x', nameB: 'x' });
    assert.equal(samePair.reason, 'same-pair', '同支 ⇒ 比错了');
    assert.equal(samePair.state, 'empty');
    const missing = m.branchContrast({ nameA: '', nameB: 'y' });
    assert.equal(missing.state, 'unusable');
    assert.equal(missing.reason, 'missing-names');
    const noSrc = m.branchContrast({ nameA: 'x', nameB: 'y' });
    assert.equal(noSrc.reason, 'no-diff-source');
    const bad = m.branchContrast({
        nameA: 'p', nameB: 'q', readDiff: () => ({ state: 'engine-absent', reason: 'not-mounted' })
    });
    assert.equal(bad.state, 'engine-absent');
    assert.ok(/not-mounted/.test(bad.why), '上游归因须透传');
    ok('四态缺席各自归因（同支 / 缺名 / 无源 / 引擎缺席）');
});

test('v3620 F. 真源码破坏：摘掉跨支泄漏判定 ⇒ C1 场景实测失效', async () => {
    const s = src();
    assert.equal(s.split(A_LEAK_AINB).length - 1, 1, '锚点须在真源恰中 1 次');
    /* 破坏：把「A 的秘密出现在 B」判定抹掉（改成永不命中）。
     *   真判据（C1 的 leaks===1）在破坏副本上须**真的失败** ——
     *   这比「文本里锚点消失了」强：它证明判据真的在靠这行代码。 */
    const broken = s.replace(A_LEAK_AINB,
        "            if (false && row.owner === 'b' && isSecretKey(row.path, aList)) {");
    assert.notEqual(broken, s, '破坏须可观测改动');
    const B = await loadFrom(broken);
    const rb = B.branchContrast(opts({ secretKeysA: ['commitmentSecret'] }));
    const r0 = (await api()).branchContrast(opts({ secretKeysA: ['commitmentSecret'] }));
    assert.equal(r0.crossLeak.leaks, 1, '原版真判据须通过（破坏前不得已红）');
    assert.equal(rb.crossLeak.leaks, 0, '破坏版上真判据须失败（泄漏不再被检出）');
    assert.notEqual(r0.crossLeak.leaks, rb.crossLeak.leaks, '破坏须在读数面留下可见差异');
    /* 反向：另一向（b-secret-in-a）不受影响 ⇒ 证明破坏精确命中一侧。 */
    const r2b = B.branchContrast(opts({
        payloadA: { commitmentSecretMine: 'x' }, payloadB: { commitmentOther: 'y' },
        secretKeysB: ['commitmentSecret']
    }));
    assert.equal(r2b.crossLeak.leaks, 1, '反向判定须仍在（破坏只命中一侧）');
    ok('真源码破坏：摘掉一侧判定 ⇒ C1 真判据实测失败（另一侧不受影响）');
});

test('v3620 G. 自防护 + 当版锚点（V4 计数形态）', async () => {
    const self = readRoot(path.join('tests', 'v3620_branch_contrast.test.mjs'));
    assert.ok(self.includes(A_SELF_HEAD), '本档须持有自防护锚点');
    assert.ok(self.length > 4000, '本档自身不得被清空（实 ' + self.length + ' 字符）');
    const pkgRaw = JSON.parse(readRoot('package.json')).version;
    const vnum = (s) => String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0);
    assert.equal(vnum('3.62.0'), vnum(pkgRaw), '当版锚点须与 package.json 同源（V4 计数形态）');
    ok('自防护 + 当版锚点 ' + pkgRaw);
});