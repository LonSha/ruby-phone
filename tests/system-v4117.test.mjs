/* ========================================================
 * system-v4117.test.mjs — [v4.116.0 · 第十三期 R13-X5] 同一件事，两种说法：谁看见了什么
 * --------------------------------------------------------
 * 本套件把守的是 R13-X5 的验收契约：
 *   A 口径与真源同构：类型别名闭集、名单去重、坏规则降级为 public；
 *   B 核心验收（双向）：屏蔽 A 后，A 视角必须不可见且给出原因，B 视角必须可见；
 *       把 A 从屏蔽名单删掉，A 视角必须立刻变可见 —— 两个方向都要真响；
 *   C 零写面：内核剥注释后不许出现任何写词（setItem / save / push / remove / splice）；
 *   D 不改入参：投影过程对传入规则与名册逐字未变；
 *   E 视图接线：发布页有预览开关与挂载点，规则一变预览重算的钩子在位；
 *   F 负控制（真源码破坏）：
 *       F1 破坏 exclude 分支结论（visible 取反）⇒ 核心验收必须翻红；
 *       F2 破坏 include 分支结论（visible 取反）⇒ 核心验收必须翻红；
 *       F3 破坏发布页预览重算钩子 ⇒ 接线断言必须翻红。
 * ======================================================== */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} } });
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4117_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'audience-projection.js'), path.join(dir, 'config', 'audience-projection.js'));
    return dir;
}
function damage(from, to) {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'audience-projection.js'), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, 'config', 'audience-projection.js'), src.split(from).join(to), 'utf8');
    return dir;
}
async function loadKernel(dir) {
    return await import(path.join(dir, 'config', 'audience-projection.js'));
}
const ROSTER = [
    { id: 'c1', name: 'Alpha' },
    { id: 'c2', name: 'Beta' },
    { id: 'c3', name: 'Gamma' }
];
/* ---------- A 口径与真源同构 ---------- */
test('A1 类型别名闭集：exclude/hidden/deny、include/only/allow、读不出一律 public', async () => {
    const k = await loadKernel(ROOT);
    for (const t of ['exclude', 'hidden', 'deny']) {
        assert.equal(k.normalizeAudienceRules({ type: t }).type, 'exclude', t);
    }
    for (const t of ['include', 'only', 'allow']) {
        assert.equal(k.normalizeAudienceRules({ type: t }).type, 'include', t);
    }
    assert.equal(k.normalizeAudienceRules({ type: 'whatever' }).type, 'public');
    assert.equal(k.normalizeAudienceRules(null).type, 'public', 'null 规则降级 public');
    assert.equal(k.normalizeAudienceRules(null).degraded, true, '降级必须显式标记');
});
test('A2 名单归一：去重、去空白、ids/names 别名收口', async () => {
    const k = await loadKernel(ROOT);
    const r = k.normalizeAudienceRules({ type: 'include', ids: ['c1', 'c1', ' ', 'c2'], names: ['Alpha', 'Alpha', ''] });
    assert.deepEqual(r.contactIds, ['c1', 'c2']);
    assert.deepEqual(r.contactNames, ['Alpha']);
});
/* ---------- B 核心验收（双向） ---------- */
test('B1 屏蔽 A：A 视角必须不可见且给出原因，B 视角必须可见', async () => {
    const k = await loadKernel(ROOT);
    const rules = { type: 'exclude', contactIds: ['c1'] };
    const { entries, summary } = k.projectAudienceForRoster({ audienceRules: rules, contacts: ROSTER });
    const alpha = entries.find(e => e.id === 'c1');
    const beta = entries.find(e => e.id === 'c2');
    assert.equal(alpha.visible, false, '被屏蔽的 A 必须不可见');
    assert.equal(alpha.reasonKind, 'exclude-blocked');
    assert.ok(alpha.reasonText.length > 0, '不可见必须给出原因');
    assert.equal(beta.visible, true, '未屏蔽的 B 必须可见');
    assert.equal(summary.hiddenCount, 1);
    assert.equal(summary.visibleCount, 2);
});
test('B2 双向：把 A 从屏蔽名单删掉，A 视角必须立刻变可见', async () => {
    const k = await loadKernel(ROOT);
    const withA = k.projectAudienceForContact({ audienceRules: { type: 'exclude', contactIds: ['c1'] }, contact: ROSTER[0] });
    const withoutA = k.projectAudienceForContact({ audienceRules: { type: 'exclude', contactIds: [] }, contact: ROSTER[0] });
    assert.equal(withA.visible, false, '第一个方向：屏蔽时不可见');
    assert.equal(withoutA.visible, true, '第二个方向：删掉屏蔽后立刻可见');
    assert.equal(withoutA.reasonKind, 'exclude-not-blocked');
});
test('B3 仅给谁看：名单内可见，名单外不可见且给原因', async () => {
    const k = await loadKernel(ROOT);
    const { entries } = k.projectAudienceForRoster({ audienceRules: { type: 'include', contactIds: ['c2'] }, contacts: ROSTER });
    assert.equal(entries.find(e => e.id === 'c2').visible, true);
    const out = entries.find(e => e.id === 'c1');
    assert.equal(out.visible, false);
    assert.equal(out.reasonKind, 'include-not-selected');
});
test('B4 名字兜底命中：名单只有名字时按归一化名字命中', async () => {
    const k = await loadKernel(ROOT);
    const hit = k.projectAudienceForContact({ audienceRules: { type: 'exclude', contactNames: ['alpha'] }, contact: ROSTER[0] });
    assert.equal(hit.visible, false, '名字兜底必须大小写归一命中');
});
test('B5 空名册：entries 为空、不造人，摘要计数为零', async () => {
    const k = await loadKernel(ROOT);
    const { entries, summary } = k.projectAudienceForRoster({ audienceRules: { type: 'exclude', contactIds: ['c1'] }, contacts: [] });
    assert.equal(entries.length, 0);
    assert.equal(summary.totalCount, 0);
    assert.equal(summary.visibleCount, 0);
    assert.equal(summary.hiddenCount, 0);
});
/* ---------- C 零写面 ---------- */
test('C1 零写面：内核剥注释后不许出现任何写词', async () => {
    const raw = fs.readFileSync(path.join(ROOT, 'config', 'audience-projection.js'), 'utf8');
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const w of ['setItem', 'removeItem', 'localStorage', 'indexedDB', 'fetch(', 'XMLHttp', '.push(', '.splice(', '.sort(', 'postMessage']) {
        assert.equal(stripped.includes(w), false, '纯计算内核不许出现写词：' + w);
    }
});
/* ---------- D 不改入参 ---------- */
test('D1 投影过程不改入参：规则与名册逐字未变', async () => {
    const k = await loadKernel(ROOT);
    const rules = { type: 'exclude', contactIds: ['c1'], contactNames: ['Alpha'] };
    const contacts = [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }];
    const snapshot = JSON.stringify({ rules, contacts });
    k.projectAudienceForRoster({ audienceRules: rules, contacts });
    assert.equal(JSON.stringify({ rules, contacts }), snapshot, '纯函数不许动入参');
});
/* ---------- E 视图接线 ---------- */
test('E1 发布页接线：预览开关、挂载点、重算钩子、导入均在位', () => {
    const mv = fs.readFileSync(path.join(ROOT, 'apps', 'wechat', 'moments-view.js'), 'utf8');
    assert.ok(mv.includes("from '../../config/audience-projection.js'"), '必须有内核导入');
    assert.equal(mv.split("id=\"audience-preview-toggle\"").length - 1, 1, '预览开关恰一个');
    assert.equal(mv.split("id=\"wechat-audience-preview\"").length - 1, 1, '挂载点恰一个');
    assert.ok(mv.includes('_refreshAudiencePreview();'), '规则变化必须挂上重算钩子');
    assert.ok(mv.includes('预览基于当前规则，实际以发送时规则为准'), '诚实边界那句话必须在界面上');
});
/* ---------- F 负控制（真源码破坏） ---------- */
test('F1 真源码破坏：exclude 分支结论取反 ⇒ 核心验收必须翻红', async () => {
    const dir = damage('return { visible: !isSelected, reasonKind: kind, reasonText: REASON_TEXT[kind] };',
        'return { visible: isSelected, reasonKind: kind, reasonText: REASON_TEXT[kind] };');
    const k = await loadKernel(dir);
    const hit = k.projectAudienceForContact({ audienceRules: { type: 'exclude', contactIds: ['c1'] }, contact: ROSTER[0] });
    assert.throws(() => {
        assert.equal(hit.visible, false, '被屏蔽的 A 必须不可见');
    }, assert.AssertionError, '破坏 exclude 结论后必然翻红');
});
test('F2 真源码破坏：include 分支结论取反 ⇒ 核心验收必须翻红', async () => {
    const dir = damage('return { visible: isSelected, reasonKind: kind, reasonText: REASON_TEXT[kind] };',
        'return { visible: !isSelected, reasonKind: kind, reasonText: REASON_TEXT[kind] };');
    const k = await loadKernel(dir);
    const hit = k.projectAudienceForContact({ audienceRules: { type: 'include', contactIds: ['c2'] }, contact: ROSTER[1] });
    assert.throws(() => {
        assert.equal(hit.visible, true, '名单内的 B 必须可见');
    }, assert.AssertionError, '破坏 include 结论后必然翻红');
});
test('F3 真源码破坏：摘掉发布页重算钩子 ⇒ 接线断言必须翻红', () => {
    const rel = path.join('apps', 'wechat', 'moments-view.js');
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const anchor = 'this._refreshAudiencePreview();';
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, '重算钩子锚点必须恰中一次：' + String(n) + ' 次');
    const broke = src.replace(anchor, '/* removed */', 1);
    assert.throws(() => {
        assert.ok(broke.includes('_refreshAudiencePreview();'), '规则变化必须挂上重算钩子');
    }, assert.AssertionError, '破坏接线后必然翻红');
});