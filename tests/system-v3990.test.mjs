/**
 * system-v3990.test.mjs — v3.99.0 · R3-O9 手机桌面与返回路径减负
 *
 * 【本版治的是什么（修前实测处境）】
 *   桌面到 v3.98 为止是**全量平铺**：config/task-entry.js 定义了 7 组任务卡
 *   （找往事 / 整理素材 / 今天的事 / 余额 / 人脉 / 创作 / 看诊），每组又挂 3~5 个 App 目标 ——
 *   新会话第一屏就是把 80+ 入口一次铺给你，而验收原文要的是「**三步内**完成
 *   找联系人 / 查看今天约定 / 继续上次创作」。两组缺口：
 *     ① 没有「先看什么」的默认秩序（高频四类与案头等权排列）；
 *     ② 没有「按卡隐藏」的能力（要么全看、要么去删数据）。
 *   返回路径一侧同样缺一处统一口径：「原页签 / 查询 / 滚动 / 编辑草稿」在退栈后
 *   没有一处可复用的恢复读数，每个页面各写一遍必然漂移。
 *
 * 【本版做什么（不新建入口 App、不做路由框架）】
 *   · 新模块 `config/desk-focus.js`（**纯函数**，零 DOM / 零 storage / 零计时 API）：
 *     `focusOf` 默认聚焦与按卡隐藏、`restorePlan` 返回路径恢复读数、`threeStepOf` 三步可达判定；
 *   · `apps/taskentry/taskentry-app.js` 接三处：`hideCard`（只改显示意图）、`markLeft` 与
 *     `restoreReading`（恢复读数）、view model 里的 `focus` 读数；
 *   · `apps/taskentry/taskentry-view.js` 把卡列表分两档渲染（首屏 / 工具区）+ 隐藏与恢复按钮。
 *
 * 【三态不同形（本仓点名的形态纪律）】
 *   · 拿不到卡表（cards-not-array）vs 空卡表 vs 未登记卡（unlisted 收进工具区）vs
 *     无 id / 重复 id（dropped 并具名）—— 四者分得开；
 *   · 恢复读数三态：restored / lost（值变了或没回写）/ absent（**本来就没记 ≠ 丢了**）；
 *   · 三步判定：dock（桌面图标一步直达）/ focus（2 步）/ tools（3 步）/ hidden（只能从搜索进，
 *     **不是 0 步**）/ absent（未登记 ⇒ 判不了）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const DF_REL = 'config/desk-focus.js';
const APP_REL = 'apps/taskentry/taskentry-app.js';
const VIEW_REL = 'apps/taskentry/taskentry-view.js';
const DF = read(DF_REL);
const APP = read(APP_REL);
const VIEW = read(VIEW_REL);
const IDX = read('index.js');
const D = await import(pathToFileURL(path.join(root, DF_REL)).href);
const T = await import(pathToFileURL(path.join(root, 'config/task-entry.js')).href);
/** 去注释（块注释 + 行内，一并剥；注释里提过一次会冒充真调用）。 */
function stripComments(src) {
    let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    out = out.split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
    return out;
}
const NEG_FILES = [];
process.on('exit', () => { for (const f of NEG_FILES) { try { fs.unlinkSync(f); } catch (_e) { /* 已清理 */ } } });
function anchorOnce(src, anchor, tag) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, '[' + tag + '] 锚点须恰中 1 次，实测 ' + n);
    return n;
}
async function breakModule(rel, anchor, repl, tag) {
    const src = read(rel);
    anchorOnce(src, anchor, tag);
    const broken = src.replace(anchor, repl);
    assert.notEqual(broken, src, '[' + tag + '] 破坏必须真的改变源码');
    const negAbs = path.join(root, rel.replace(/\.js$/, '.__neg__.js'));
    fs.writeFileSync(negAbs, broken);
    if (!NEG_FILES.includes(negAbs)) NEG_FILES.push(negAbs);
    return import(pathToFileURL(negAbs).href + '?v=' + Date.now() + '_' + tag);
}
/* ══════════════════ A. 结构面 ══════════════════ */
test('A1 模块在位、纯函数（零 DOM / 零 storage / 零计时 API）、导出面齐', () => {
    assert.ok(exists(DF_REL), 'config/desk-focus.js 必须在位');
    const code = stripComments(DF);
    for (const bad of ['document.', 'window.', 'localStorage', 'setTimeout', 'requestAnimationFrame', 'performance.now']) {
        assert.equal(code.includes(bad), false, '纯函数模块不得出现 ' + bad);
    }
    for (const fn of ['classifyCard', 'focusOf', 'restorePlan', 'threeStepOf', 'line']) {
        assert.equal(typeof D[fn], 'function', '导出面缺函数：' + fn);
    }
    assert.ok(Array.isArray(D.DF_FOCUS_IDS) && Array.isArray(D.DF_RESTORE_FIELDS));
    assert.equal(typeof D.default, 'object');
    assert.deepEqual(D.DF_FOCUS_IDS.slice(), ['chat', 'today', 'record', 'create'], '四类聚焦词表逐字');
    assert.deepEqual(D.DF_RESTORE_FIELDS.slice(), ['tab', 'query', 'scroll', 'draft'], '四格恢复词表逐字');
});
/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 默认聚焦：真卡表分两档，首屏恰四类、案头进工具区（顺序按登记表不随输入漂）', () => {
    const f = D.focusOf(T.TE_CARDS, {});
    assert.equal(f.ok, true);
    /* 真读数：7 张卡 ⇒ 首屏 4 / 工具区 3。 */
    assert.equal(f.focusCount, 4, '首屏必须恰 4 张（真读数）');
    assert.equal(f.toolsCount, 3, '工具区必须恰 3 张（案头：素材 / 余额 / 看诊）');
    assert.deepEqual(f.focus.map((r) => r.id), ['today', 'past', 'people', 'create'], '首屏顺序按 DF_FOCUS_IDS 登记次序（today → record(past/people) → create）');
    assert.deepEqual(f.tools.map((r) => r.id), ['materials', 'money', 'clinic'], '工具区收案头三类');
    /* 顺序不随输入漂：倒序输入必须得出同一顺序。 */
    const rev = D.focusOf(T.TE_CARDS.slice().reverse(), {});
    assert.deepEqual(rev.focus.map((r) => r.id), f.focus.map((r) => r.id), '输入顺序变了不许让「先看什么」跟着变');
    /* 未登记的新卡不许悄悄占首屏。 */
    const unknown = D.focusOf([{ id: 'brandnew', label: 'X', targets: [] }], {});
    assert.equal(unknown.focusCount, 0, '未登记卡不得进首屏');
    assert.equal(unknown.toolsCount, 1);
    assert.equal(unknown.tools[0].why.indexOf('unlisted'), 0, '未登记须具名 unlisted');
});
test('B2 按卡隐藏：隐藏只不显示（不删数据）、可恢复、且与「未登记」不同形', () => {
    const f = D.focusOf(T.TE_CARDS, { hidden: ['clinic'] });
    assert.equal(f.hiddenCount, 1);
    assert.equal(f.hidden[0].id, 'clinic');
    assert.equal(f.hidden[0].label, '看诊与档案', '隐藏项要带标签（用户才知道自己藏了哪张）');
    assert.equal(f.toolsCount, 2, '隐藏后工具区少一张');
    assert.equal(f.tools.filter((r) => r.id === 'clinic').length, 0);
    /* 隐藏聚焦类也要生效（隐藏优先于一切）。 */
    const f2 = D.focusOf(T.TE_CARDS, { hidden: ['create'] });
    assert.equal(f2.focusCount, 3);
    assert.equal(f2.hiddenCount, 1);
    /* 无 id 与重复 id：进 dropped 并具名（既不静默丢、也不重复上屏）。 */
    const f3 = D.focusOf([{ label: '没id' }, { id: 'today', label: 'A' }, { id: 'today', label: 'B' }], {});
    assert.equal(f3.focusCount, 1, '重复 id 只收第一条');
    assert.equal(f3.dropped.length, 2);
    assert.equal(f3.dropped[0].why.indexOf('no-id'), 0);
    assert.equal(f3.dropped[1].why.indexOf('duplicate-id'), 0);
    /* 拿不到卡表 ≠ 空卡表。 */
    const bad = D.focusOf(null, {});
    assert.equal(bad.ok, false);
    assert.equal(bad.reason.indexOf('cards-not-array'), 0, '拿不到卡表 ⇒ 判不了（不是「一张卡都没有」）');
    const empty = D.focusOf([], {});
    assert.equal(empty.ok, true);
    assert.equal(empty.focusCount, 0);
    assert.equal(empty.reason, '');
});
test('B3 三步可达：五档来源互不同形（dock / focus / tools / hidden / absent）', () => {
    const t = D.threeStepOf(T.TE_CARDS, {});
    assert.equal(t.ok, true);
    /* 真读数：找联系人走桌面 dock（不在任务卡表里）1 步；今天与创作在首屏 2 步。 */
    const byNeed = {};
    for (const it of t.items) byNeed[it.need] = it;
    assert.equal(byNeed.chat.steps, 1, '找联系人：dock 图标一步直达');
    assert.equal(byNeed.chat.where, 'dock');
    assert.equal(byNeed.chat.appId, 'wechat');
    assert.equal(byNeed.today.steps, 2, '今天：首屏卡 → 目标 2 步');
    assert.equal(byNeed.create.steps, 2, '创作：首屏卡 → 目标 2 步');
    assert.equal(t.maxSteps, 2, '三步内成立（真读数 max = 2）');
    /* 隐藏后：如实报「只能从搜索进」，**不是 0 步**。 */
    const th = D.threeStepOf(T.TE_CARDS, { hidden: ['create'] });
    const c2 = th.items.filter((x) => x.need === 'create')[0];
    assert.equal(c2.steps, null, '被隐藏时步数判不了（不得写 0）');
    assert.equal(c2.where, 'hidden');
    assert.ok(c2.why.indexOf('不是 0 步') >= 0);
    /* 全部隐藏后 maxSteps 仍能算（其他两档仍在）。 */
    assert.equal(th.maxSteps, 2);
    /* 卡表里没有这一类且又没登记 dock ⇒ absent（判不了）。 */
    const ta = D.threeStepOf([{ id: 'today', label: 'T' }], {});
    const c3 = ta.items.filter((x) => x.need === 'create')[0];
    assert.equal(c3.where, 'absent');
    assert.equal(c3.steps, null);
    assert.equal(ta.maxSteps, 2, '可算的那些仍然如实报');
    const tb = D.threeStepOf(null, {});
    assert.equal(tb.ok, false);
    assert.equal(tb.maxSteps, null);
});
test('B4 返回路径恢复读数：三态互不同形（restored / lost / absent）', () => {
    const ok = D.restorePlan({ tab: 'list', query: '水壶', scroll: 320, draft: '' }, { tab: 'list', query: '水壶', scroll: 320, draft: '' });
    assert.equal(ok.ok, true);
    assert.equal(ok.allRestored, true);
    assert.deepEqual(ok.restored.map((x) => x.field), ['tab', 'query', 'scroll', 'draft']);
    assert.equal(ok.lost.length, 0);
    /* 值变了 ⇒ lost 且具名 value-changed。 */
    const l = D.restorePlan({ tab: 'list', query: '水壶', scroll: 320 }, { tab: 'list', query: '', scroll: 0 });
    assert.equal(l.allRestored, false);
    assert.deepEqual(l.restored.map((x) => x.field), ['tab']);
    const q = l.lost.filter((x) => x.field === 'query')[0];
    assert.equal(q.why.indexOf('value-changed'), 0, '空串也是「变了」（不得当成「没记」）');
    /* 没回写 ⇒ after-missing。 */
    const m = D.restorePlan({ tab: 'list', scroll: 320 }, { tab: 'list' });
    assert.equal(m.lost.filter((x) => x.field === 'scroll')[0].why.indexOf('after-missing'), 0);
    /* 本来就没记 ⇒ absent（**未记不是丢了**）。 */
    const a = D.restorePlan({ tab: 'list' }, { tab: 'list' });
    assert.deepEqual(a.restored.map((x) => x.field), ['tab']);
    assert.deepEqual(a.absent.map((x) => x.field), ['query', 'scroll', 'draft']);
    assert.equal(a.lost.length, 0, '从没打开过草稿不该看到「草稿丢失」');
    assert.equal(a.allRestored, true, '没丢就算全恢复（absent 不计入丢失）');
    /* 三种 lost 理由互不同形。 */
    const set = new Set([q.why.slice(0, q.why.indexOf('（')), m.lost.filter((x) => x.field === 'scroll')[0].why.slice(0, m.lost.filter((x) => x.field === 'scroll')[0].why.indexOf('（')), a.absent[0].why.slice(0, a.absent[0].why.indexOf('（'))]);
    assert.equal(set.size, 3, 'value-changed / after-missing / both-absent 必须互不同形');
    /* 拿不到快照 ⇒ 判不了（不是「都没丢」）。 */
    const bad = D.restorePlan(null, {});
    assert.equal(bad.ok, false);
    assert.equal(bad.allRestored, false);
    assert.equal(bad.reason.indexOf('inputs-not-object'), 0);
    /* 全 absent 时 allRestored 不得为 true（没记 ≠ 恢复成功）。 */
    const none = D.restorePlan({}, {});
    assert.equal(none.allRestored, false, '一格都没记时不得说「全恢复了」');
    assert.equal(none.absent.length, 4);
    assert.equal(typeof D.line(D.focusOf(T.TE_CARDS, {})), 'string');
    assert.ok(D.line(null).indexOf('判不了') >= 0);
});
/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 任务入口接线：隐藏 / 恢复读数 / 聚焦读数三处都在场且用同一份口径', () => {
    const app = stripComments(APP);
    assert.ok(app.includes("from '../../config/desk-focus.js'"), 'App 必须引用聚焦模块（唯一归类口径）');
    assert.ok(app.includes('focusOf(TE_CARDS, { hidden: this._hidden })'), '聚焦读数必须走真源函数与真卡表');
    assert.ok(app.includes('hideCard(id, on) {'), '必须按卡隐藏入口');
    assert.ok(app.includes('hiddenCards() {'), '必须能读当前隐藏名单');
    assert.ok(app.includes('markLeft(snap) {'), '必须能记录离开时快照');
    assert.ok(app.includes('restoreReading(now) {'), '必须能给恢复读数');
    assert.ok(app.includes('return restorePlan(this._leftSnapshot, now)'), '恢复读数必须走真源函数');
    /* ★ 隐藏**不得**写 storage（「不删数据」的字面落点）。 */
    const hi = app.indexOf('hideCard(id, on) {');
    const hj = app.indexOf('hiddenCards() {', hi);
    const body = app.slice(hi, hj > hi ? hj : hi + 700);
    assert.equal(body.includes('storage.set'), false, '隐藏不得写 storage');
    assert.equal(body.includes('writePins'), false, '隐藏不得动收藏');
    assert.equal(body.includes('writeLedger'), false, '隐藏不得动台账');
    /* 视图面：两档分组 + 两个按钮都在场。 */
    const view = stripComments(VIEW);
    assert.ok(view.includes('_group('), '必须有一档渲染函数');
    assert.ok(view.includes("'[首屏] 默认聚焦（'"), '必须标出首屏档');
    assert.ok(view.includes("'[工具区] 案头（'"), '必须标出工具区档');
    assert.ok(view.includes("data-hide="), '必须有隐藏按钮');
    assert.ok(view.includes("data-unhide="), '必须有恢复显示按钮');
    assert.ok(view.includes('self.app.hideCard('), '两个按钮都须走 App 的隐藏入口（不自己改状态）');
    assert.ok(view.includes('按需隐藏 '), '隐藏态须可见（否则用户不知道藏了哪张）');
});
/* ══════════════════ D. 负控制 ══════════════════ */
test('D1 破坏默认聚焦（把案头也塞进首屏）⇒ 两档判据必须转红', async () => {
    const neg = await breakModule(DF_REL,
        "    return { group: 'tools', why: 'unlisted（' + id + ' 未登记 ⇒ 收进工具区，不占首屏）' };",
        "    return { group: 'focus', why: 'unlisted（' + id + ' 未登记 ⇒ 收进工具区，不占首屏）' };", 'd1');
    const n = neg.focusOf([{ id: 'brandnew', label: 'X' }], {});
    assert.equal(n.focusCount, 1, '破坏生效：未登记卡占了首屏');
    assert.equal(D.focusOf([{ id: 'brandnew', label: 'X' }], {}).focusCount, 0, '原版上未登记卡不得上首屏');
});
test('D2 破坏按卡隐藏（隐藏不生效）⇒ 隐藏判据必须转红', async () => {
    const neg = await breakModule(DF_REL,
        "        if (hide.indexOf(id) >= 0) {",
        "        if (false && hide.indexOf(id) >= 0) {", 'd2');
    const n = neg.focusOf(T.TE_CARDS, { hidden: ['clinic'] });
    assert.equal(n.hiddenCount, 0, '破坏生效：隐藏不再生效');
    assert.equal(n.toolsCount, 3, '破坏生效：被隐藏的卡又出现在工具区');
    assert.equal(D.focusOf(T.TE_CARDS, { hidden: ['clinic'] }).hiddenCount, 1, '原版上隐藏必须生效');
});
/* [判据自伤⑧] 原锚点 `    if (!b || !a) {` 破坏成 `if (false) {` 后 b 仍为 null，
 *   `hasOwnProperty.call(b, f)` 当场抛 TypeError ⇒ **异常逃逸冒充「转红」**（看着红了，
 *   却根本没走到判据上）。改破坏归一化口（null -> {}）：破坏真改变行为、不逃逸。 */
test('D3 破坏拿不到快照的判定（没有快照也说判得了）⇒ 三态判据必须转红', async () => {
    const neg = await breakModule(DF_REL,
        "const b = (before && typeof before === 'object') ? before : null;",
        "const b = (before && typeof before === 'object') ? before : {};", 'd3');
    const n = neg.restorePlan(null, {});
    assert.equal(n.ok, true, '破坏生效：拿不到快照也说判得了');
    assert.equal(n.restored.length, 0, '破坏生效：一格都没记却仍走「判得了」这条路');
    assert.equal(D.restorePlan(null, {}).ok, false, '原版上拿不到快照必须判不了');
});
/* [判据自伤⑨] 原锚点按 12 空格缩进、且漏了 `else if (inHidden) ` 前缀，而真源码是
 *   单行 `        else if (inHidden) items.push(...)` ⇒ 锚点实测 0 命中（anchorOnce 先抛）。
 *   锚点必须逐字抄真源码整行，不得按印象重排缩进。 */
test('D4 破坏三步判定（被隐藏报 0 步）⇒ 五档判据必须转红', async () => {
    const neg = await breakModule(DF_REL,
        "        else if (inHidden) items.push({ need: w.need, label: w.label, steps: null, where: 'hidden', why: '该卡被按需隐藏 ⇒ 只能从搜索进（不算步数，**不是 0 步**）' });",
        "        else if (inHidden) items.push({ need: w.need, label: w.label, steps: 0, where: 'hidden', why: '该卡被按需隐藏 ⇒ 只能从搜索进（不算步数，**不是 0 步**）' });", 'd4');
    const n = neg.threeStepOf(T.TE_CARDS, { hidden: ['create'] });
    assert.equal(n.items.filter((x) => x.need === 'create')[0].steps, 0, '破坏生效：隐藏被报成 0 步（像是最顺的路径）');
    assert.equal(D.threeStepOf(T.TE_CARDS, { hidden: ['create'] }).items.filter((x) => x.need === 'create')[0].steps, null, '原版上必须是 null');
});
test('D5 破坏「未记 ≠ 丢了」（未记也算丢失）⇒ 三态判据必须转红', async () => {
    const neg = await breakModule(DF_REL,
        "        if (!hasB && !hasA) { absent.push({ field: f, why: 'both-absent（本来就没记 ⇒ 不是「丢了」）' }); continue; }",
        "        if (!hasB && !hasA) { lost.push({ field: f, why: 'both-absent' }); continue; }", 'd5');
    const n = neg.restorePlan({ tab: 'list' }, { tab: 'list' });
    assert.ok(n.lost.length > 0, '破坏生效：没记过的格被算成丢失');
    assert.equal(n.allRestored, false, '破坏生效：全恢复变假');
    assert.equal(D.restorePlan({ tab: 'list' }, { tab: 'list' }).lost.length, 0, '原版上未记不得算丢失');
});
test('D6 破坏顺序确定性（次键用输入位置）⇒ 顺序判据必须转红', async () => {
    const neg = await breakModule(DF_REL,
        "    out.focus.sort((a, b) => (rank(a) - rank(b)) || (seqOf(a.id) - seqOf(b.id)));",
        "    const seq = new Map(); out.focus.forEach((r, i) => seq.set(r.id, i));\n    out.focus.sort((a, b) => (rank(a) - rank(b)) || (seq.get(a.id) - seq.get(b.id)));", 'd6');
    const fwd = neg.focusOf(T.TE_CARDS, {}).focus.map((r) => r.id).join(',');
    const rev = neg.focusOf(T.TE_CARDS.slice().reverse(), {}).focus.map((r) => r.id).join(',');
    assert.notEqual(fwd, rev, '破坏生效：顺序随输入漂');
    const of = D.focusOf(T.TE_CARDS, {}).focus.map((r) => r.id).join(',');
    const orr = D.focusOf(T.TE_CARDS.slice().reverse(), {}).focus.map((r) => r.id).join(',');
    assert.equal(of, orr, '原版上顺序必须确定');
});
test('D7 工具两向自证：锚点不存在 / 不唯一必须抛', () => {
    assert.throws(() => anchorOnce(DF, '__不存在__', 'z1'), /恰中 1 次/);
    assert.throws(() => anchorOnce(DF, 'const', 'z2'), /恰中 1 次/);
    assert.throws(() => anchorOnce(APP, 'render()', 'z3'), /恰中 1 次/);
});
/* ══════════════════ E. 版本锚 ══════════════════ */
test('E1 五源同源：3.99.0 落齐（常量 / 台账 / 包描述 / 迭代日志）', () => {
    const VER = '3.99.0';
    assert.ok(IDX.includes("const ST_PHONE_VERSION = '" + VER + "';"), '入口常量');
    assert.ok(read('manifest.json').includes('"version": "' + VER + '"'), 'manifest');
    assert.ok(read('package.json').includes('"version": "' + VER + '"'), 'package.json');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, VER);
    assert.equal(ul.head, VER);
    assert.ok(ul.versions[VER], '台账必须有当版条目');
    assert.ok(Array.isArray(ul.versions[VER].items) && ul.versions[VER].items.length >= 6);
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')));
    assert.ok(read('ITERATION_LOG.md').includes('v' + VER), '迭代日志必须有当版');
});
