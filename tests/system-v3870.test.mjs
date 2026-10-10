/* ============================================================
 * tests/system-v3870.test.mjs — 拓展计划 R-X3 财务与事件的确认提交向导 [v3.87.0]
 * ------------------------------------------------------------
 * 本版把「建议 → 落账」这条断了的路接上。修前的实测处境（逐条核对，不是推演）：
 *   · config/finance-overview.js（v3.68.0 · X4）已经把七源归一 / 结算草稿 / 幂等账本建齐，
 *     但 `finance_ledger` 这一格**全仓零写入点** —— 只在 index.js 里被读出来挂缓存；
 *   · `travelSettlementDraft` 产出的是空壳（balances / internal / external 逐字写死 null），
 *     `fillSettlementDraft` 全仓零调用 ⇒ 诊断页永远报「账本 0 条（提交 0）」是**假读数**：
 *     不是「没人提交过」，是「根本没有提交这个动作」；
 *   · 「建议」与「已发生」在界面上同形 —— 旅行分摊算出的「谁该转给谁多少」是**建议**，
 *     看一眼就以为是已经转过的钱（本仓最贵的一类财务错读数）；
 *   · 点下去之前看不到这笔交易动谁；写失败不回读 ⇒ 「调用落了」被当成「钱动了」。
 *
 * 本套件守五件事：
 *   A 结构面：四态 / 三动作 / 三计划 / 十七个出口齐备；纯函数不摸宿主、不写存储；
 *            复用 X4 已登记的那一格（不新增存储键）；派生面枚举面未命中；
 *   B 行为面：判据函数（负控制复用**同一份**）—— 四态不同形 / 报价永不落账 /
 *            预览零写 / 重复确认不重复扣款 / 上游 owner 不代写 / 混合币种不求和 /
 *            读不到≠零条 / 回读两向 / 撤销如实 / 建议仍是建议 / 自检两侧都跑；
 *   C 接线面：咽喉真调内核（读真源码 + 真跑内核链）、视图两面纯渲染只读宿主缓存；
 *   D 负控制：真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据；
 *   E 版本锚（下限形）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mod = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const M_FC = 'config/finance-commit.js';
const M_FO = 'config/finance-overview.js';
const IDX = 'index.js';
const D_DATA = 'apps/diagnose/diagnose-data.js';
const D_VIEW = 'apps/diagnose/diagnose-view.js';
const TV_VIEW = 'apps/traveldesk/traveldesk-view.js';
const CSS = 'phone.css';
const S_DERIV = 'scripts/source-derivation-audit.mjs';

const FC = await mod(M_FC);
const FO = await mod(M_FO);

const DAY = '2026-10-11';
/* 旅行记账 settle() 的典型输出（内部两笔 + 一笔对外）—— 腹胀数据，不跑真页面。 */
const SETTLE = { transfers: [{ from: 'A', to: 'B', amount: 10.5 }, { from: 'B', to: 'C', amount: 10 }], external: [], balanced: true };
const SETTLE_EXT = { transfers: [], external: [{ from: 'A', to: 'B', amount: 30 }], balanced: false };
function draftOf(summary, dayKey, draftId) {
    return FC.fcSettlementDraft(summary, { dayKey: dayKey || DAY, draftId: draftId || 'settle' });
}

/* ================== 判据函数（负控制必须复用**同一份**） ================== */

/** R-X3-① 四态互不同形：key / label / text 三样都不许两两相同；建议与已发生必须分得开。 */
function jFourStatesDistinct(m) {
    const keys = Object.keys(m.FC_STATES);
    if (keys.length !== 4) return { ok: false, why: '四态应为 4，实测 ' + keys.length };
    const seenLabel = []; const seenText = []; const seenKey = [];
    for (const k of keys) {
        const s = m.FC_STATES[k];
        if (!s || !s.key || !s.label || !s.text) return { ok: false, why: k + ' 登记不全' };
        if (seenKey.indexOf(s.key) >= 0) return { ok: false, why: '四态 key 重复：' + s.key };
        if (seenLabel.indexOf(s.label) >= 0) return { ok: false, why: '四态 label 重复：' + s.label };
        if (seenText.indexOf(s.text) >= 0) return { ok: false, why: '四态处置文案重复：' + s.text };
        seenKey.push(s.key); seenLabel.push(s.label); seenText.push(s.text);
    }
    if (m.FC_STATES.settled.label === m.FC_STATES.suggested.label) return { ok: false, why: '「已发生」与「结算建议」同形' };
    const s = m.FC_STATES.suggested.text;
    if (s.indexOf('不代表对方收到钱') < 0) return { ok: false, why: '建议态文案必须点明「不代表对方收到钱」' };
    return { ok: true, why: '' };
}

/** R-X3-② 报价永不落账：报价恒 quoted，且计提交被拒；反向：换成建议必须能落。 */
function jQuoteNeverCommits(m) {
    const d = { source: 'traveldesk', draftId: 'q1', dayKey: 'd', kind: 'quote' };
    const pv = m.previewCommit(d, []);
    if (pv.state !== 'quoted') return { ok: false, why: '报价应判 quoted，实测 ' + pv.state };
    if (m.fcStateOf('quote', true) !== 'quoted') return { ok: false, why: '报价即使已落账也必须判 quoted' };
    const q = m.planCommit(d, [], {});
    if (q.plan !== m.FC_PLANS.reject) return { ok: false, why: '报价必须拒绝落账，实测 ' + q.plan };
    if (q.why !== 'quote-never-commits') return { ok: false, why: '拒绝归因错：' + q.why };
    if (q.entry) return { ok: false, why: '被拒的报价竟然带了写意图' };
    /* 反向：同输入换成 suggestion 必须能落（否则这套判据对任何输入都拒，是恒真）。 */
    const s = m.planCommit({ source: 'traveldesk', draftId: 'q1', dayKey: 'd', kind: 'suggestion' }, [], {});
    if (s.plan !== m.FC_PLANS.fresh) return { ok: false, why: '同输入换 suggestion 应可落账，实测 ' + s.plan };
    return { ok: true, why: '' };
}

/** R-X3-③ 预览不修改余额：预览恒 willWrite:false 且不动入参账本；反向：真落账必须动账本。 */
function jPreviewZeroWrite(m) {
    const ledger = [];
    const before = JSON.stringify(ledger);
    const d = draftOf(SETTLE);
    const pv = m.previewCommit(d, ledger);
    if (pv.willWrite !== false) return { ok: false, why: '预览必须声明 willWrite:false' };
    if (JSON.stringify(ledger) !== before) return { ok: false, why: '预览改了入参账本' };
    if (pv.entry) return { ok: false, why: '预览带了写意图（那就不是预览）' };
    const plan = m.planCommit(d, ledger, { at: 1 });
    if (plan.plan !== m.FC_PLANS.fresh) return { ok: false, why: '这一步本该可落账，实测 ' + plan.plan };
    const after = m.applyCommitPlan([], plan);
    if (after.count !== 1) return { ok: false, why: '落账后账本应 1 条，实测 ' + after.count };
    return { ok: true, why: '' };
}

/** R-X3-④ 重复确认不重复扣款：同幂等键再确认 → replay 且账本不涨；反向：次日是新的一笔。 */
function jIdempotentNoDoubleCharge(m) {
    const d = draftOf(SETTLE);
    const p1 = m.planCommit(d, [], { at: 1 });
    const l1 = m.applyCommitPlan([], p1);
    if (l1.count !== 1) return { ok: false, why: '首次落账应 1 条，实测 ' + l1.count };
    const p2 = m.planCommit(d, l1.entries, { at: 2 });
    if (p2.plan !== m.FC_PLANS.replay) return { ok: false, why: '同草稿再确认应 replay，实测 ' + p2.plan };
    const l2 = m.applyCommitPlan(l1.entries, p2);
    if (l2.count !== 1) return { ok: false, why: 'replay 后账本不应涨，实测 ' + l2.count };
    /* 反向：换一天（dayKey 变）是**另一笔**结算，否则「幂等」会把正常的二次确认也吞掉。 */
    const d2 = draftOf(SETTLE, '2026-10-12', 'settle');
    const p3 = m.planCommit(d2, l2.entries, { at: 3 });
    if (p3.plan !== m.FC_PLANS.fresh) return { ok: false, why: '次日应可再确认一次，实测 ' + p3.plan };
    if (p3.idemKey === p1.idemKey) return { ok: false, why: '幂等键未含日键（跨日会被当成同一笔）' };
    return { ok: true, why: '' };
}

/** R-X3-⑤ 上游写的来源本机不代写（wallet）；反向：本仓写的来源必须可写。 */
function jUpstreamOwnerNotWritten(m) {
    const o = m.fcOwnerOf('wallet');
    if (o.writable !== false) return { ok: false, why: '上游写的来源竟判可写' };
    if (o.why !== 'owner-is-upstream') return { ok: false, why: '上游写的来源归因错：' + o.why };
    const p = m.planCommit({ source: 'wallet', draftId: 'w1', dayKey: 'd', kind: 'fact' }, [], {});
    if (p.plan !== m.FC_PLANS.reject || p.why !== 'owner-is-upstream') return { ok: false, why: '上游 owner 的来源计提交未拒：' + p.plan + '/' + p.why };
    const a = m.fcOwnerOf('accounting');
    if (a.writable !== true) return { ok: false, why: '本仓写的来源被误判不可写' };
    const ap = m.planCommit({ source: 'accounting', draftId: 'a1', dayKey: 'd', kind: 'fact' }, [], {});
    if (ap.plan !== m.FC_PLANS.fresh) return { ok: false, why: '本仓写的来源应可落账，实测 ' + ap.plan };
    const u = m.fcOwnerOf('not-a-source');
    if (u.writable !== false || u.why !== 'unknown-source') return { ok: false, why: '未登记来源应判 unknown-source' };
    return { ok: true, why: '' };
}

/** R-X3-⑥ 多币种不盲目相加：混合币种 total 恒 null；反向：单一币种必须给总额。 */
function jMixedCurrencyNoSum(m) {
    const mixed = m.fcSumGuard([{ amount: 3000, currency: 'CNY' }, { amount: 2000, currency: 'JPY' }]);
    if (mixed.mixed !== true) return { ok: false, why: '混合币种应判 mixed' };
    if (mixed.total !== null) return { ok: false, why: '混合币种不许给总额，实测 ' + String(mixed.total) };
    const one = m.fcSumGuard([{ amount: 100, currency: 'CNY' }, { amount: 200, currency: 'CNY' }]);
    if (one.mixed !== false) return { ok: false, why: '单一币种不应判 mixed' };
    if (one.total !== 300) return { ok: false, why: '单一币种总额应为 300，实测 ' + String(one.total) };
    /* 预览层也得守：混合币种的预览不许把两个数加起来。 */
    const d = {
        source: 'traveldesk', draftId: 'm1', dayKey: 'd', kind: 'fact',
        lines: [{ amount: 3000, currency: 'CNY' }, { amount: 2000, currency: 'JPY' }]
    };
    const pv = m.previewCommit(d, []);
    if (pv.mixedCurrency !== true) return { ok: false, why: '预览未识别混合币种' };
    if (pv.amountTotal !== null) return { ok: false, why: '预览层把混合币种加起来了：' + String(pv.amountTotal) };
    return { ok: true, why: '' };
}

/** R-X3-⑦ 读不到 ≠ 没有：账本读不出与空账本不许同形；反向：真读到空账本必须报「读到」。 */
function jLedgerUnreadNotZero(m) {
    const t1 = m.fcSummaryLine(null);
    const t2 = m.fcSummaryLine([]);
    if (t1 === t2) return { ok: false, why: '「读不到」与「零条提交」同形' };
    if (t1.indexOf('读不到') < 0) return { ok: false, why: '读不到时未说「读不到」' };
    if (t1.indexOf('这不是') < 0) return { ok: false, why: '读不到时未点明「这不是没有提交」' };
    const d = { source: 'traveldesk', draftId: 'x', dayKey: 'd', kind: 'fact' };
    const pv = m.previewCommit(d, null);
    if (pv.ledgerRead !== false) return { ok: false, why: '账本 null 时 ledgerRead 应为 false' };
    if (pv.problems.indexOf('ledger-not-read') < 0) return { ok: false, why: '账本未读到应记 ledger-not-read' };
    const pv2 = m.previewCommit(d, []);
    if (pv2.ledgerRead !== true) return { ok: false, why: '读了空账本被当成没读到' };
    if (pv2.duplicate.isDuplicate !== false) return { ok: false, why: '空账本被当成已提交过' };
    return { ok: true, why: '' };
}

/** R-X3-⑧ 写后回读两向：写下去的读得回来 → confirmed；读不回来 / 根本没读到 → not_confirmed。 */
function jReadbackBothWays(m) {
    const d = draftOf(SETTLE);
    const plan = m.planCommit(d, [], { at: 1 });
    const applied = m.applyCommitPlan([], plan);
    const ok = m.readbackCommit(plan, applied.entries);
    if (ok.confirmed !== true) return { ok: false, why: '写后回读应 confirmed' };
    if (ok.phase !== 'confirmed') return { ok: false, why: '回读相位应为 confirmed，实测 ' + ok.phase };
    const bad = m.readbackCommit(plan, []);
    if (bad.confirmed !== false) return { ok: false, why: '回读不到却报 confirmed' };
    if (bad.phase !== 'not_confirmed') return { ok: false, why: '回读失败相位应为 not_confirmed，实测 ' + bad.phase };
    const nul = m.readbackCommit(plan, null);
    if (nul.confirmed !== false) return { ok: false, why: '根本没读到（null）却报 confirmed' };
    if (nul.why !== 'read-backed-nothing') return { ok: false, why: 'null 回读归因错：' + nul.why };
    return { ok: true, why: '' };
}

/** R-X3-⑨ 撤销如实：有这一条才撤得掉；撤不存在的必须报失败，且不许动账本。 */
function jRevokeHonest(m) {
    const d = draftOf(SETTLE);
    const plan = m.planCommit(d, [], { at: 1 });
    const applied = m.applyCommitPlan([], plan);
    const rev = m.revokeCommit(applied.entries, plan.idemKey);
    if (rev.ok !== true || rev.count !== 0) return { ok: false, why: '撤销应有且清空，实测 ' + rev.ok + '/' + rev.count };
    const again = m.revokeCommit(applied.entries, 'traveldesk:never:d');
    if (again.ok !== false) return { ok: false, why: '撤不存在的提交竟报成功' };
    if (again.why !== 'no-such-commit') return { ok: false, why: '撤销失败归因错：' + again.why };
    if (again.count !== 1) return { ok: false, why: '失败的撤销动了账本，实测 ' + again.count };
    const empty = m.revokeCommit(applied.entries, '');
    if (empty.ok !== false) return { ok: false, why: '缺幂等键的撤销竟报成功' };
    return { ok: true, why: '' };
}

/** R-X3-⑩ 建议仍是建议：结算草稿恒 suggestion，落账后也只是「本机确认」，绝不写成「付过钱了」。 */
function jSuggestionStaysSuggestion(m) {
    const d = draftOf(SETTLE);
    if (d.kind !== 'suggestion') return { ok: false, why: '结算草稿必须标 suggestion，实测 ' + d.kind };
    if (d.ownerWritable !== true) return { ok: false, why: '旅行记账是本仓写的来源，草稿却标不可写' };
    const pv = m.previewCommit(d, []);
    if (pv.state !== 'suggested') return { ok: false, why: '未落账的建议应判 suggested，实测 ' + pv.state };
    const t = String(pv.stateText || '');
    if (t.indexOf('不代表对方收到钱') < 0) return { ok: false, why: '建议态文案未点明「不代表对方收到钱」' };
    if (t.indexOf('已落账') >= 0) return { ok: false, why: '建议态文案与已发生态同形' };
    const plan = m.planCommit(d, [], { at: 1 });
    const applied = m.applyCommitPlan([], plan);
    const pv2 = m.previewCommit(d, applied.entries);
    if (pv2.state !== 'settled') return { ok: false, why: '已落账的提交应判 settled，实测 ' + pv2.state };
    const t2 = String(m.FC_STATES.settled.text || '');
    if (t2.indexOf('本机确认') < 0) return { ok: false, why: '已发生态文案未点明「本机确认过的提交」' };
    if (d.note.indexOf('不代表对方收到钱') < 0) return { ok: false, why: '草稿备注必须点明不代表对方收到钱' };
    return { ok: true, why: '' };
}

/** R-X3-⑪ 自检两侧都跑：真侧零问题（假侧由 D 面负控制逐个钉住）。 */
function jSelfCheckBothSides(m) {
    const self = m.financeCommitSelfCheck();
    if (!self || !Array.isArray(self.problems)) return { ok: false, why: '自检未返回 problems 数组' };
    if (self.problems.length) return { ok: false, why: '自检有问题：' + self.problems.join(' | ') };
    return { ok: true, why: '' };
}

const CRITERIA = [jFourStatesDistinct, jQuoteNeverCommits, jPreviewZeroWrite, jIdempotentNoDoubleCharge,
    jUpstreamOwnerNotWritten, jMixedCurrencyNoSum, jLedgerUnreadNotZero, jReadbackBothWays, jRevokeHonest,
    jSuggestionStaysSuggestion, jSelfCheckBothSides];

/* ================== A 结构面 ================== */

test('v3870 A1. 提交向导真源在场：四态 / 三动作 / 三计划 / 十七个出口齐备；复用 X4 的那一格', () => {
    assert.ok(fs.existsSync(path.join(ROOT, M_FC)), '真源必须在场：' + M_FC);
    const src = read(M_FC);
    for (const name of ['FC_STATES', 'FC_STATE_KEYS', 'FC_ACTIONS', 'FC_PLANS', 'fcOwnerOf', 'fcStateOf',
        'fcSumGuard', 'fcSettlementLines', 'fcSettlementDraft', 'previewCommit', 'planCommit', 'applyCommitPlan',
        'readbackCommit', 'revokeCommit', 'fcSummaryLine', 'financeCommitSelfCheck', 'FINANCE_COMMIT_LEDGER_KEY']) {
        assert.ok(new RegExp('export (const|function) ' + name + '\\b').test(src), M_FC + ' 缺导出：' + name);
    }
    assert.equal(Object.keys(FC.FC_STATES).length, 4, '四态：已发生 / 待确认 / 模拟报价 / 结算建议');
    assert.equal(new Set(Object.values(FC.FC_STATES).map((s) => s.key)).size, 4, '四态 key 出现同值');
    assert.equal(Object.keys(FC.FC_ACTIONS).length, 3, '三动作：预览 / 确认提交 / 撤销');
    assert.equal(FC.FC_ACTIONS.preview.writes, false, '预览不写');
    assert.equal(FC.FC_ACTIONS.commit.writes, true, '确认提交要写');
    assert.equal(FC.FC_ACTIONS.revoke.writes, true, '撤销要写');
    assert.equal(new Set(Object.values(FC.FC_PLANS)).size, 3, '三计划互不同值');
    /* 复用 X4 已登记的那一格，不另开键。 */
    assert.equal(FC.FINANCE_COMMIT_LEDGER_KEY, 'finance_ledger', '账本键必须与 X4 同格');
    assert.ok(read('scripts/keys-audit.mjs').includes("key: 'finance_ledger'"), '账本键必须在 keys 台账里');
    assert.ok(read('config/storage.js').includes('/^finance_/'), '账本键必须在 storage 前缀表里');
});

test('v3870 A2. 本层是纯函数：不摸宿主、不写存储、不引第二份口径；派生面枚举面未命中', () => {
    const src = read(M_FC);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(',
        '.setItem(', 'storage.', 'VirtualPhone', 'window.']) {
        assert.ok(!code.includes(bad), '本模块不许出现 ' + bad + '（纯函数：不持存储、不带计时器、不碰 DOM）');
    }
    /* 唯一写入口不在本层：这里只算写意图，storage.set 只能在咽喉里。 */
    assert.ok(!code.includes('storage.set'), '本层不许自己落盘（写入口只有咽喉那一处）');
    for (const imp of [
        "import { numOrNull } from './num-gate.js'",
        "} from './finance-overview.js';"
    ]) assert.ok(src.includes(imp), M_FC + ' 缺导入：' + imp);
    /* 四态与幂等键不许写第二份（X4 已有一份口径）。 */
    for (const lit of ["':'", 'FINANCE_LEDGER_LIMIT', 'settlementIdemKey', 'normalizeFinanceLedger']) {
        assert.ok(src.includes(lit), M_FC + ' 缺复用：' + lit);
    }
    assert.ok(!code.includes('function settlementIdemKey'), '幂等键不得在本层重写一份');
    /* 派生面枚举面：不得在同一行同时出现「源身份字段 + 集合操作」（实测未命中，就也守住）。 */
    const ops = ['.filter(', '.find(', '.map(', '.flatMap(', '.reduce(', '.push(', '.unshift('];
    const hit = code.split(String.fromCharCode(10)).filter((l) => (l.includes('sourceId') || l.includes('sourceKey'))
        && ops.some((o) => l.includes(o)));
    assert.deepEqual(hit, [], '若命中派生面枚举面，必须先在 ' + S_DERIV + ' 登记：\n' + hit.join('\n'));
});

/* ================== B 行为面 ================== */

test('v3870 B1. 十一条判据在同源上一次通过（四态 / 报价 / 预览 / 幂等 / owner / 多币种 / 读不到 / 回读 / 撤销 / 建议 / 自检）', () => {
    const failures = [];
    for (const fn of CRITERIA) {
        let r;
        try { r = fn(FC); } catch (e) { r = { ok: false, why: '判据抛错：' + String((e && e.message) || e) }; }
        if (!r || r.ok !== true) failures.push(fn.name + ' -> ' + String((r && r.why) || '无返回'));
    }
    assert.deepEqual(failures, [], '判据未全过：\n' + failures.join('\n'));
});

test('v3870 B2. 真跑全链（照咽喉的取数口径复刻）：草稿 → 预览 → 计划 → 落账 → 回读 → 撤销', () => {
    const built = FC.fcSettlementDraft(SETTLE, { dayKey: DAY });
    assert.equal(built.lines.length, 2, '内部两笔应成 2 行，实测 ' + built.lines.length);
    assert.equal(built.kind, 'suggestion', '落地草稿的 kind 固定 suggestion');
    assert.deepEqual(built.participants, ['A', 'B', 'C'], '参与者应去重且保持出现序：' + JSON.stringify(built.participants));
    const pv = FC.previewCommit(built, []);
    assert.equal(pv.state, 'suggested');
    assert.equal(pv.mixedCurrency, false, '结算行同币种，总额才能给');
    assert.equal(pv.amountTotal, 20.5, '单一币种总额应 20.5，实测 ' + String(pv.amountTotal));
    const plan = FC.planCommit(built, [], { at: 1 });
    assert.equal(plan.plan, 'fresh');
    const applied = FC.applyCommitPlan([], plan);
    assert.equal(applied.count, 1);
    const rb = FC.readbackCommit(plan, applied.entries);
    assert.equal(rb.confirmed, true);
    const rev = FC.revokeCommit(applied.entries, plan.idemKey);
    assert.equal(rev.ok, true);
    assert.equal(rev.count, 0);
});

test('v3870 B3. 未登记来源不硬塞：预览记 missing-source 且 ok:false，但**不抛错**（认不出就不猜）', () => {
    const pv = FC.previewCommit({ draftId: 'd', dayKey: 'k', kind: 'suggestion' }, []);
    assert.equal(pv.ok, false);
    assert.ok(pv.problems.indexOf('missing-source') >= 0, '缺来源应记 missing-source：' + JSON.stringify(pv.problems));
    assert.equal(pv.ownerWritable, false, '缺来源不可写');
    const noDraft = FC.previewCommit({ source: 'traveldesk', dayKey: 'k' }, []);
    assert.equal(noDraft.ok, false);
    assert.ok(noDraft.problems.indexOf('missing-draft-id') >= 0, '缺草稿号应记 missing-draft-id：' + JSON.stringify(noDraft.problems));
});

test('v3870 B4. 账本上限裁剪：条目超过上限时只留最新的，且裁掉的数如实报出来', () => {
    const many = [];
    for (let i = 0; i < FO.FINANCE_LEDGER_LIMIT + 5; i += 1) {
        many.push({ idemKey: 'traveldesk:bulk-' + String(i) + ':d', source: 'traveldesk', action: 'commit' });
    }
    const n = FO.normalizeFinanceLedger(many);
    assert.equal(n.entries.length, FO.FINANCE_LEDGER_LIMIT, '应截到上限 ' + FO.FINANCE_LEDGER_LIMIT);
    assert.ok(n.dropped >= 5, '裁掉的数必须如实报出：' + n.dropped);
    assert.equal(n.entries[0].idemKey, 'traveldesk:bulk-5:d', '超上限应截掉最旧的（保留最新），实测首条 ' + n.entries[0].idemKey);
    assert.equal(n.entries[n.entries.length - 1].idemKey, 'traveldesk:bulk-' + String(FO.FINANCE_LEDGER_LIMIT + 4) + ':d', '末条应是最新的一条');
});

test('v3870 B5. 结算行的稳定 id 与族别：内部 / 对外两族各自可辨认，对外行也带币种', () => {
    const b1 = FC.fcSettlementLines(SETTLE);
    assert.equal(b1.internalCount, 2);
    assert.equal(b1.externalCount, 0);
    for (const l of b1.lines) assert.equal(l.kind, 'internal', '内部族行别错：' + l.kind);
    const b2 = FC.fcSettlementLines(SETTLE_EXT);
    assert.equal(b2.externalCount, 1);
    assert.equal(b2.lines[0].kind, 'external');
    assert.equal(b2.lines[0].currency, 'CNY', '对外行也必须带币种（不然汇总没法守多币种）');
    assert.equal(b2.balanced, false, '有对外结算就不算 balance 收尾');
    /* 肉数据不硬塞：缺 from / to 的行直接跳过，不导致崩溃。 */
    const junk = FC.fcSettlementLines({ transfers: [{ from: '', to: 'B' }, { from: 'A', to: 'B', amount: 'x' }] });
    assert.equal(junk.lines.length, 1, '缺身份的行应跳过，实测 ' + junk.lines.length);
    assert.equal(junk.lines[0].amount, null, '非数字金额应归一为 null（不抬成 0）');
});

/* ================== C 接线面（真跑内核链 + 读真源码） ================== */

test('v3870 C1. 咽喉接线：导入 / 刷新 / 动作 / 挂载四处都在，且账本写入口只有一处', () => {
    const idx = read(IDX);
    assert.ok(idx.includes("from './config/finance-commit.js';"), '咽喉必须引内核真源');
    for (const s of ['FC_STATES', 'FC_PLANS', 'fcSummaryLine', 'fcSettlementDraft', 'previewCommit',
        'planCommit', 'applyCommitPlan', 'readbackCommit', 'revokeCommit', 'FINANCE_COMMIT_LEDGER_KEY']) {
        assert.ok(idx.includes(s), '咽喉导入缺 ：' + s);
    }
    assert.ok(idx.includes('function refreshFinanceCommit() {'), '取数函数必须在场');
    assert.ok(idx.includes('function applyFinanceCommitAction(action) {'), '动作函数必须在场');
    assert.ok(idx.includes('applyFinanceCommitAction: applyFinanceCommitAction,'), '动作必须挂上唯一出口');
    assert.ok(idx.includes('financeCommitFace: function ()'), '面必须挂上（诊断与视图只读这一份）');
    /* 账本写入口只允许一处（视图与诊断都不许写）。 */
    assert.equal(idx.split('storage.set?.(FINANCE_COMMIT_LEDGER_KEY').length - 1, 2,
        '写入口应恰有 2 处（提交与撤销），实测 ' + (idx.split('storage.set?.(FINANCE_COMMIT_LEDGER_KEY').length - 1));
    for (const f of [TV_VIEW, D_DATA, D_VIEW]) {
        assert.ok(!read(f).includes('storage.set?.(FINANCE_COMMIT_LEDGER_KEY'), f + ' 自己写了账本（写入口只能有咽喉一处）');
    }
    /* 缓存必须完整挂上（三个名字各一次）。 */
    for (const k of ['_financeDraftCache', '_financeCommitPreview', '_financeCommitCache', '_financeCommitLine']) {
        assert.ok(idx.includes('vp.' + k + ' ='), '取数必须挂上 ' + k);
    }
    /* 读不到与空账本必须分得开：存的是 ledgerRead 而账本本体两名。 */
    assert.ok(idx.includes('ledgerRead: (ledger !== null)'), '读不到与空账本必须分得开');
});

test('v3870 C2. 刷新点排在日历早退之前 —— 否则与剧情时间无关的草稿源永远看不到', () => {
    const idx = read(IDX);
    const at = idx.indexOf('async function checkCalendarScheduleReminders(');
    assert.ok(at > 0, '日历权威函数必须在场');
    const refreshAt = idx.indexOf('refreshFinanceCommit();', at);
    const earlyAt = idx.indexOf('if (!storage) return;', at);
    assert.ok(refreshAt > 0, '刷新必须在这个函数里被调用');
    assert.ok(earlyAt > refreshAt, '刷新点必须排在早退之前（跟着早退会被一起吞掉）');
    assert.ok(!idx.includes('await refreshFinanceCommit()'), '刷新不许 await（不挡日历链）');
});

test('v3870 C3. 诊断协议面纯渲染：只读宿主缓存与内核口径，不自己算草稿、不自己判四态', () => {
    const data = read(D_DATA);
    assert.ok(data.includes('const financeCommitFace = (() => {'), '诊断内核必须取这一面');
    assert.ok(data.includes('VirtualPhone._financeCommitCache'), '诊断面必须从宿主缓存取数');
    assert.ok(data.includes('financeCommitSelfCheck()'), '诊断面必须读内核自检');
    assert.ok(data.includes("from '../../config/finance-commit.js'"), '协议口径必须来自内核');
    assert.ok(data.includes('provenanceFace, scheduleFace, financeFace, financeCommitFace,'), '必须收进返回值（不挂上去就没人看得见）');
    assert.ok(data.includes('export function financeCommitFaceText(face) {'), '面文案的唯一实现在诊断文件里');
    /* 三态不许压平：未取数 / 没取到草稿 / 有读数，三种话不同形。 */
    assert.ok(data.includes("'尚未取数'"), '取数未跑必须说「尚未取数」');
    assert.ok(data.includes('这一轮没取到结算草稿'), '草稿缺失必须与「没有待确认的提交」分开');
    assert.ok(data.includes('账本读不到（**不是「没有提交」**）'), '读不到账本必须点明不是「没有提交」');
    const view = read(D_VIEW);
    assert.ok(view.includes('_financeCommitHtml(pkg) {'), '诊断视图必须有这张卡');
    assert.ok(view.includes("financeCommitFaceText(face)"), '本卡文案必须走 diagnose-data 的唯一实现');
    assert.ok(!view.includes("from '../../config/finance-commit.js'"), '视图不许直连内核（走 diagnose-data 的转发）');
});

test('v3870 C4. 交易台面纯渲染：只读宿主缓存，四态与按钮都不自己算', () => {
    const view = read(TV_VIEW);
    assert.ok(view.includes('_commitHtml() {'), '结算提交区块必须由本件排版');
    assert.ok(view.includes('window.VirtualPhone?.financeCommitFace?.()'), '数据必须从宿主缓存读');
    assert.ok(view.includes('window.VirtualPhone?.applyFinanceCommitAction?.'), '动作必须交给宿主（视图不自己落账）');
    assert.ok(view.includes("data-act=\"fc-commit\"") && view.includes("data-act=\"fc-revoke\""), '两个动作按钮必须在场');
    assert.ok(!view.includes('FC_STATES'), '视图不许自己判四态（那是内核的活）');
    assert.ok(!view.includes('finance-commit.js'), '视图不许直连内核');
    assert.ok(view.includes('还没取到提交读数'), '缓存不在位时必须说「还没取到」而不是「没有待提交」');
    assert.ok(view.includes('还没取到结算草稿'), '草稿不在位必须单独一句');
    const css = read(CSS);
    for (const c of ['.tv-fc-state', '.tv-fc-warn', '.tv-fc-line', '.tv-note', '.tv-flash']) {
        assert.ok(css.includes(c), '样式缺：' + c);
    }
});

test('v3870 C5. 真跑取数口径：账本三种读数不同形（读不到 / 读到空 / 读到 N）', () => {
    /* 照 index.js 的 refreshFinanceCommit 复刻一份账本读取口径（桩 storage，不跑真页面）。 */
    function readLedger(raw) {
        if (raw === undefined || raw === null) return null;
        const parsed = (typeof raw === 'string') ? (() => { try { return JSON.parse(raw); } catch (_e) { return null; } })() : raw;
        return Array.isArray(parsed) ? parsed : null;
    }
    const notRead = readLedger(undefined);
    const empty = readLedger('[]');
    const one = readLedger(JSON.stringify([{ idemKey: 'traveldesk:settle:2026-10-11', source: 'traveldesk', action: 'commit' }]));
    assert.equal(notRead, null);
    assert.deepEqual(empty, []);
    assert.equal(one.length, 1);
    const t1 = FC.fcSummaryLine(notRead);
    const t2 = FC.fcSummaryLine(empty);
    const t3 = FC.fcSummaryLine(one);
    assert.equal(new Set([t1, t2, t3]).size, 3, '三种读数必须互不同形：\n' + [t1, t2, t3].join('\n'));
    assert.ok(t3.indexOf('1 条') >= 0, '有读数必须报条数：' + t3);
    assert.ok(t3.indexOf('提交 1') >= 0, '有读数必须报提交数：' + t3);
    /* 坏 JSON 不许抬成「已读到且零条」——那是最危险的假读数。 */
    assert.equal(readLedger('{oops'), null, '坏 JSON 必须归为「读不到」');
});

/* ================== D 负控制（真源码破坏 → 破坏副本 → 同款判据） ================== */

const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});

test('v3870 D1. 报价也能落账（去掉 quote 拦截）⇒ 报价判据必须转红', async () => {
    const neg = await negCopy(M_FC, (s) => {
        const anchor = "    if (pv.kind === 'quote') return Object.assign({}, base, { why: 'quote-never-commits' });\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = jQuoteNeverCommits(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
    assert.ok(/报价/.test(String(r.why)), '转红的理由必须指向被破坏的那条语义：' + r.why);
});

test('v3870 D2. 四态压平（建议也当已发生）⇒ 四态不同形判据必须转红', async () => {
    const neg = await negCopy(M_FC, (s) => {
        const anchor = "    if (committed === true) return 'settled';\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, "    if (committed === true) return 'settled';\n    if (k === 'suggestion') return 'settled';\n");
    });
    const r = jSuggestionStaysSuggestion(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3870 D3. 混合币种也相加（多币种守卫松掉）⇒ 多币种判据必须转红', async () => {
    const neg = await negCopy(M_FC, (s) => {
        const anchor = '        total: mixed ? null :';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '        total: (function () { let t = 0; for (const c of currencies) t += by[c]; return t; })(),\n    __unused: mixed ? null :');
    });
    const r = jMixedCurrencyNoSum(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3870 D4. 预览也声称要写（去掉 willWrite:false）⇒ 预览零写判据必须转红', async () => {
    const neg = await negCopy(M_FC, (s) => {
        const anchor = '        willWrite: false,';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '        willWrite: true,');
    });
    const r = jPreviewZeroWrite(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3870 D5. 幂等失效（重复确认当新提交）⇒ 不重复扣款判据必须转红', async () => {
    const neg = await negCopy(M_FC, (s) => {
        const anchor = "    if (pv.duplicate.isDuplicate) return Object.assign({}, base, { plan: FC_PLANS.replay, why: 'already-committed' });\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = jIdempotentNoDoubleCharge(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3870 D6. 读不到也说成「零条提交」（read 三态压平）⇒ 读不到判据必须转红', async () => {
    const neg = await negCopy(M_FC, (s) => {
        const anchor = 'export function fcSummaryLine(ledger, counts) {';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, 'export function fcSummaryLine(ledger, counts) { if (ledger === null || ledger === undefined) ledger = [];');
    });
    const r = jLedgerUnreadNotZero(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3870 D7. 负控制自身可证伪：破坏副本必须真被加载且与原版不同源', async () => {
    const neg = await negCopy(M_FC, (s) => s.replace(
        'export function financeCommitSelfCheck() {',
        'export function financeCommitSelfCheck() { return { problems: ["\u8d1f\u63a7\u5236\u63a2\u9488"] };'
    ));
    const got = neg.financeCommitSelfCheck();
    assert.equal(got.problems.length, 1, '破坏副本必须真的被加载且可跑');
    assert.notEqual(JSON.stringify(got), JSON.stringify(FC.financeCommitSelfCheck()), '破坏副本不得与真源同源');
    /* 第二向：未触及的那条判据在破坏副本上仍须成立（否则破坏过界）。 */
    const r = jPreviewZeroWrite(neg);
    assert.equal(r.ok, true, '未触及的那条判据在破坏副本上仍须成立（否则破坏过界）：' + JSON.stringify(r));
});

/* ================== E 版本锚（下限形） ================== */

test('v3870 E1. 版本锚（下限形）：五源同源且不低于 3.87.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read(IDX);
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
    assert.ok(m, 'index.js 必须仍有版本常量');
    const nums = [man.version, pkg.version, m[1], log.latest, log.head].map(String);
    assert.equal(new Set(nums).size, 1, '五源版本必须同源：' + nums.join(' / '));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
        return 0;
    };
    assert.ok(cmp(nums[0], '3.87.0') >= 0, '版本不得低于 3.87.0（本版是它的落地版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
    assert.ok(Array.isArray(entry.items) && entry.items.length >= 8,
        '当版条目数下限 8（计划交付至少八条）：' + (entry.items || []).length);
    for (const it of entry.items) {
        const s = String(it);
        assert.equal(s.indexOf('【'), 0, '条目须以【前缀】起：' + s.slice(0, 20));
        assert.ok(!/[\[\]\\]/.test(s), '条目内不许出现方括号与反斜杠：' + s.slice(0, 24));
        assert.ok(!s.includes(String.fromCharCode(34)), '条目内不许出现双引号：' + s.slice(0, 24));
    }
    /* 公告块与当版条目同源（App 内「本版更新」弹窗读的就是它）。 */
    const block = idx.slice(idx.indexOf('const ST_PHONE_CURRENT_UPDATE = {'));
    for (const it of entry.items) {
        assert.ok(block.includes(JSON.stringify(it)), '公告块缺当版条目：' + String(it).slice(0, 24));
    }
    /* 复校标记必须与当版同源（边界文档那条机器可读契约）。 */
    assert.ok(read('docs/runtime-verification-boundary.md').includes('**v3.87.0 复校**'), '边界文档复校标记未跟版');
});
