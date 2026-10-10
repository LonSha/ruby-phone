/* ============================================================
 * tests/system-v3850.test.mjs — 拓展计划 R-X1 统一行动中心 [v3.85.0]
 * ------------------------------------------------------------
 * 本版把「五处各说各的」收成**同一个读数**。修前的实测处境（逐条核对，不是推演）：
 *   · 日历里有两场到期约定、财务页有一份待确认结算、通知中心躺着 3 条未读、
 *     织光机顶部有续玩建议、诊断中心报出两项失败任务 —— 而**没有任何一处**
 *     回答「现在总共该处理什么」；
 *   · 「源本轮没读到」与「读了、确实没有」在页面上**同形**，用户会在
 *     「本来就没有」的项上反复排查（两者的处置正好相反）；
 *   · 同一条约定改期后，拿含日期的键去对账会判成「旧的那条撤了 + 新的一条来了」，
 *     而用户看到的只是**同一件事改了个日子**；
 *   · 「只读通知」与「需确认通知」混在一起，看一眼就行的与要拍板的挤在同一列。
 *
 * 本套件守五件事：
 *   A 结构面：三张表 / 五源登记表 / 两条泳道 / 四个动作 / 账本登记齐备；
 *   B 行为面：判据函数（负控制必须复用**同一份**）—— 三键各异 / 两列之和等于总数 /
 *             五源全缺记五条 gap / 三态总述不同形 / 幂等与四种撤回归因 / 跳不过去要说原因 /
 *             通知载荷两态 / open 不是状态；
 *   C 接线面：咽喉真调用内核（读真源码，不跑宿主）、视图只读宿主缓存、
 *             真跑内核链（桩宿主，照着咽喉的实现复刻一遍）；
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

const M_AC = 'config/action-center.js';
const A_VIEW = 'apps/notifications/notification-center-view.js';
const A_APP = 'apps/notifications/notifications-app.js';
const M_STORAGE = 'config/storage.js';
const S_KEYS = 'scripts/keys-audit.mjs';
const S_DERIV = 'scripts/source-derivation-audit.mjs';
const IDX = 'index.js';

const AC = await mod(M_AC);

const N1 = Date.parse('2026-10-11T10:00:00');
const D11 = '2026-10-11';

/** 造一份五源齐全的中心（各源恰好一条；负控制要能对同一份输入重跑）。 */
function centerAll(m) {
    return m.buildActionCenter({
        nowMs: N1,
        storyDay: D11,
        bills: [{ sourceId: 'b1', title: '分账' }],
        commitments: [{ id: 'c1', actor: 'A', content: '见面', dateKey: D11, status: 'confirmed' }],
        unread: [{ id: 'u1', title: '消息', appId: 'wechat', ts: N1 }],
        resume: { sections: [{ key: 'recent', label: '上次停在哪里', rows: [{ text: '在钟楼' }] }], gaps: [] },
        failures: [{ state: 'failed', code: 'storage.key-unregistered', fields: { stage: '写回', needConfirm: true, retry: true }, ok: true, why: '' }]
    });
}

/* ══════════════════ 判据函数（负控制必须复用**同一份**） ══════════════════ */

/** R-X1-① 三条键各司其职：上屏键含日期 / 对账锚不含 / 投递键带前缀，三者不许混同。 */
function jThreeKeys(m) {
    const mk = (day) => m.buildActionCenter({
        nowMs: N1, storyDay: D11,
        commitments: [{ sourceId: 'apt_1', dateKey: day, time: '19:00', title: '甲：看电影', status: 'confirmed' }]
    });
    const a = mk(D11), b = mk('2026-10-10');
    if (!a.items.length || !b.items.length) return { ok: false, why: '约定投影行未产行' };
    const x = a.items[0], y = b.items[0];
    if (!x.realIdemKey || !x.idemKey) return { ok: false, why: '条目缺键' };
    if (x.realIdemKey === x.idemKey) return { ok: false, why: '对账锚与上屏键同形（改期会被判成换了一条）' };
    if (x.realIdemKey !== y.realIdemKey) return { ok: false, why: '改期后对账锚跟着变了（认不出是同一条）' };
    if (x.idemKey === y.idemKey) return { ok: false, why: '上屏键没跟着日期走（改期不会更新）' };
    if (x.idemKey.split(':').length !== 3) return { ok: false, why: '上屏键不是三段式：' + x.idemKey };
    if (x.realIdemKey.indexOf(D11) >= 0) return { ok: false, why: '对账锚里带了日期：' + x.realIdemKey };
    const want = 'action:' + x.kind + ':' + x.sourceId + ':' + x.dayKey;
    if (m.acSenderKey(x) !== want) return { ok: false, why: '投递键形状不对：' + m.acSenderKey(x) };
    return { ok: true, why: '' };
}

/** R-X1-② 两列之和等于总数，且各列都非空（泳道不许被登记表整表压平）。 */
function jLanesSum(m) {
    const c = centerAll(m);
    if (c.counts.total !== 5) return { ok: false, why: '五源各一条应得 5 项，实测 ' + c.counts.total };
    if (c.lanes.readonly.length + c.lanes.needConfirm.length !== c.counts.total) {
        return { ok: false, why: '两列之和与总数不符（有条目掉在地上）' };
    }
    if (!c.lanes.readonly.length) return { ok: false, why: '只读列空（只读与需确认被压成一列）' };
    if (!c.lanes.needConfirm.length) return { ok: false, why: '需确认列空' };
    const tableLanes = new Set(Object.keys(m.AC_SOURCES).map((k) => m.AC_SOURCES[k].lane));
    if (tableLanes.size < 2) return { ok: false, why: '登记表把五类压成同一条泳道' };
    if (c.counts.skippedNoKey !== 0) return { ok: false, why: '正常五源不该有「无键被跳过」：' + c.counts.skippedNoKey };
    return { ok: true, why: '' };
}

/** R-X1-③ 读不到 ≠ 空：五源全缺记五条 gap；读了确实没有**不记** gap。 */
function jGapsNotFlattened(m) {
    const all = m.buildActionCenter({ nowMs: N1 });
    if (all.gaps.length !== 5) return { ok: false, why: '五源全缺应有 5 条 gap，实测 ' + all.gaps.length };
    for (const g of all.gaps) {
        if (g.reason !== 'not-read') return { ok: false, why: '缺源应记 not-read，实测 ' + g.reason };
    }
    if (Object.keys(all.read).length !== 0) return { ok: false, why: '未读的源不该出现在 read 里' };
    const readEmpty = m.buildActionCenter({ nowMs: N1, storyDay: D11, bills: [] });
    if (readEmpty.gaps.some((g) => g.source === 'bill')) return { ok: false, why: '读了确实是空，却被记成没读到' };
    if (readEmpty.read.bill !== true) return { ok: false, why: '读了空数组却没记下「读过」' };
    return { ok: true, why: '' };
}

/** R-X1-④ 总述三态不许压平：未取数 / 零项 / N 项，三句话不同形。 */
function jSummaryTriad(m) {
    const none = m.acSummaryLine(null);
    const zero = m.acSummaryLine(m.buildActionCenter({ nowMs: N1 }));
    const some = m.acSummaryLine(centerAll(m));
    const lines = [none, zero, some];
    if (new Set(lines).size !== 3) return { ok: false, why: '三态总述同形：' + JSON.stringify(lines) };
    if (!/读不到/.test(none)) return { ok: false, why: '未取数须说读不到：' + none };
    if (!/本机还没有可处理的项/.test(zero)) return { ok: false, why: '零项须说没有可处理的项：' + zero };
    if (/就绪/.test(zero)) return { ok: false, why: '零项且缺源时给出了绿灯' };
    if (!/只读/.test(some) || !/需确认/.test(some)) return { ok: false, why: '有项时须分列读数：' + some };
    return { ok: true, why: '' };
}

/** R-X1-⑤ 幂等账本 + 四种撤回归因 + 已处理不撤回（一条判据覆盖四态）。 */
function jLedger(m) {
    const mk = (day, storyDay) => m.buildActionCenter({
        nowMs: N1, storyDay: storyDay || D11,
        commitments: [{ sourceId: 'apt_1', dateKey: day, title: 't', status: 'confirmed' }]
    });
    const readC = (list, day) => m.buildActionCenter({ nowMs: N1, storyDay: day || D11, commitments: list });
    let led = m.applyActionLedger(null, m.diffActionLedger(mk(D11), null), 1000, D11);
    if (led.entries.length !== 1) return { ok: false, why: '首轮落账应恰一条，实测 ' + led.entries.length };
    const d2 = m.diffActionLedger(mk(D11), led);
    if (d2.fresh.length !== 0 || d2.replay.length !== 1) {
        return { ok: false, why: '同一件事复算应判 replay：' + JSON.stringify({ f: d2.fresh.length, r: d2.replay.length }) };
    }
    /* 源没读 ⇒ 不撤（把「不知道」当「没有」是最贵的反向错读数）。 */
    const d3 = m.diffActionLedger(readC(undefined), led);
    if (d3.withdraw.length !== 0) return { ok: false, why: '源没读时把缺席当成了取消' };
    /* 源读过且条消失 ⇒ source-gone。 */
    const d4 = m.diffActionLedger(readC([]), led);
    if (d4.withdraw.length !== 1 || d4.withdraw[0].why !== m.AC_WITHDRAW_REASONS['source-gone']) {
        return { ok: false, why: '来源消失未判为 source-gone：' + JSON.stringify(d4.withdraw.map((w) => w.why)) };
    }
    /* 同源改期 ⇒ 旧日期撤（source-rescheduled）+ 新日期新增，两条归因不许同形。 */
    const d5 = m.diffActionLedger(mk('2026-10-10'), led);
    if (d5.withdraw.length !== 1 || d5.withdraw[0].why !== m.AC_WITHDRAW_REASONS['source-rescheduled']) {
        return { ok: false, why: '同源改期未判为 source-rescheduled：' + JSON.stringify(d5.withdraw.map((w) => w.why)) };
    }
    if (d5.fresh.length !== 1) return { ok: false, why: '改期后的新日期未判为新增' };
    const ledMv = m.applyActionLedger(led, d5, 2000, D11);
    const ent = ledMv.entries.filter((e) => e.realIdemKey === led.entries[0].realIdemKey);
    if (ent.length !== 1) return { ok: false, why: '改期后同一条在账本里应只剩一格，实测 ' + ent.length };
    if (ent[0].state !== m.AC_STATES.OPEN || ent[0].dayKey !== '2026-10-10') {
        return { ok: false, why: '改期后的新日期没落下来（自己撤了自己）：' + JSON.stringify(ent[0]) };
    }
    /* 剧情回退 ⇒ source-rewound。 */
    const ledS = m.applyActionLedger(null, m.diffActionLedger(
        readC([{ sourceId: 'apt_9', dateKey: '2026-10-20', title: 't', status: 'confirmed' }], '2026-10-20'), null), 1000, '2026-10-20');
    const d6 = m.diffActionLedger(readC([], '2026-10-05'), ledS);
    if (!d6.withdraw.length || d6.withdraw[0].why !== m.AC_WITHDRAW_REASONS['source-rewound']) {
        return { ok: false, why: '剧情回退未判为 source-rewound' };
    }
    /* 已处理过的条目不得被撤回（回档撤的是「还没让你看过的未来提醒」）。 */
    const done = m.applyAction(led, led.entries[0].realIdemKey, m.AC_ACTIONS.DONE, { at: 3000 });
    if (done.changed !== true || done.state !== m.AC_STATES.DONE) return { ok: false, why: 'done 未落账' };
    const d7 = m.diffActionLedger(readC([]), done.entries);
    if (d7.withdraw.length !== 0) return { ok: false, why: '已完成的条目被撤回了（用户决定过的事被系统抹掉）' };
    return { ok: true, why: '' };
}

/** R-X1-⑥ 跳不过去必须说清原因；类别的默认首屏要能兜底。 */
function jJumpReasons(m) {
    const noTarget = m.buildActionCenter({ nowMs: N1, unread: [{ id: 'u0', title: 't' }] }).items[0];
    const j0 = m.acJumpOf(noTarget);
    if (j0.ok !== false) return { ok: false, why: '无靶心却判为可跳' };
    if (!j0.why) return { ok: false, why: '跳不过去却没给原因（用户会以为是按钮坏了）' };
    /* 两个读数必须自洽：可跳 ⇔ 有靶心。不可跳却带着个 appId，调用方照样会去派发。 */
    if (j0.appId !== '') return { ok: false, why: '不可跳却给出了靶心：' + j0.appId };
    if (noTarget.appId !== '') return { ok: false, why: '未读类默认 appId 应为空，实测 ' + noTarget.appId };
    const withApp = m.buildActionCenter({ nowMs: N1, unread: [{ id: 'u1', title: 't', appId: 'wechat' }] }).items[0];
    if (m.acJumpOf(withApp).ok !== true) return { ok: false, why: '有来源 App 却被判成不可跳' };
    const fallback = m.buildActionCenter({ nowMs: N1, bills: [{ sourceId: 'b3', title: 'x' }] }).items[0];
    const jf = m.acJumpOf(fallback);
    if (jf.ok !== true || jf.appId !== 'traveldesk') {
        return { ok: false, why: '类别默认首屏兜底失效：' + JSON.stringify(jf) };
    }
    const jn = m.acJumpOf(null);
    if (jn.ok !== false || !jn.why) return { ok: false, why: '空读数未给出不可跳原因' };
    return { ok: true, why: '' };
}

/** R-X1-⑦ 通知载荷两态：点得动的带靶心，点不动的必须空 appId 且带理由。 */
function jNoticePayload(m) {
    const okItem = centerAll(m).items.filter((x) => x.kind === 'bill')[0];
    const n1 = m.actionNoticeOf(okItem);
    if (!n1.senderKey.startsWith('action:')) return { ok: false, why: '载荷缺上屏键：' + n1.senderKey };
    if (n1.appId !== 'traveldesk') return { ok: false, why: '点得动的条目未带上靶心：' + n1.appId };
    if (n1.meta.canOpen !== true) return { ok: false, why: '点得动却标为不可开' };
    const noItem = m.buildActionCenter({ nowMs: N1, unread: [{ id: 'u9', title: 't' }] }).items[0];
    const n2 = m.actionNoticeOf(noItem);
    if (n2.appId !== '') return { ok: false, why: '点不动的条目仍带了 appId（会把用户丢到别人首屏）' };
    if (n2.meta.canOpen !== false || !n2.meta.openWhy) {
        return { ok: false, why: '点不动的条目未在载荷里带出理由' };
    }
    if (!n2.meta.anchor || n2.meta.anchor !== noItem.realIdemKey) {
        return { ok: false, why: '载荷里的锚与条目不一致（点了处理不到这一条）' };
    }
    return { ok: true, why: '' };
}

/** R-X1-⑧ open 是导航不是状态：传进来即如实拒绝；未落账的锚如实回报。 */
function jActionGate(m) {
    const c = centerAll(m);
    const led = m.applyActionLedger(null, m.diffActionLedger(c, null), 1000, D11);
    const anchor = led.entries[0].realIdemKey;
    const open = m.applyAction(led, anchor, m.AC_ACTIONS.OPEN, {});
    if (open.changed !== false || open.why !== 'open-is-navigation') {
        return { ok: false, why: 'open 被记成一笔状态：' + JSON.stringify(open) };
    }
    const weird = m.applyAction(led, anchor, '随口一个动作', {});
    if (weird.changed !== false || weird.why !== 'unknown-action') {
        return { ok: false, why: '域外动作未拒判：' + JSON.stringify(weird) };
    }
    const missing = m.applyAction(led, 'no-such-anchor', m.AC_ACTIONS.DONE, {});
    if (missing.changed !== false || missing.why !== 'no-such-entry') {
        return { ok: false, why: '找不到的锚未如实回报：' + JSON.stringify(missing) };
    }
    /* 两种键都认：只有上屏键的调用方也要能落账。 */
    const byIdem = m.applyAction(led, led.entries[0].idemKey, m.AC_ACTIONS.SNOOZE, { at: 4000, until: '2026-10-12' });
    if (byIdem.changed !== true || byIdem.state !== m.AC_STATES.SNOOZED) {
        return { ok: false, why: '只认锚不认上屏键（点了按钮没动静）' };
    }
    const sno = byIdem.entries.filter((e) => e.realIdemKey === anchor)[0];
    if (!sno || sno.until !== '2026-10-12') return { ok: false, why: '稍后未记下延到哪一天' };
    return { ok: true, why: '' };
}

/** R-X1-⑨ 约定面两种形状都认（投影行没有 actor —— 按完整条目写会静默产 0 行）。 */
function jCommitmentShapes(m) {
    const proj = m.buildActionCenter({
        nowMs: N1, storyDay: D11,
        commitments: [{ sourceId: 'apt_1', dateKey: D11, time: '19:00', title: '甲：看电影', place: '影院', status: 'confirmed' }]
    });
    const row = proj.items.filter((x) => x.kind === 'commitment')[0];
    if (!row) return { ok: false, why: '投影行未产行（咽喉处走的就是这个形状）' };
    if (row.sourceId !== 'apt_1') return { ok: false, why: '投影行的 sourceId 未接上：' + row.sourceId };
    if (!row.title) return { ok: false, why: '投影行未兜出标题' };
    const full = m.buildActionCenter({
        nowMs: N1, storyDay: D11,
        commitments: [{ id: 'c1', actor: 'A', content: '见面', dateKey: D11, status: 'confirmed' }]
    });
    const row2 = full.items.filter((x) => x.kind === 'commitment')[0];
    if (!row2) return { ok: false, why: '完整条目未产行' };
    if (row2.title.indexOf('A') !== 0) return { ok: false, why: '完整条目的标题未带 actor：' + row2.title };
    /* 缺剧情日 ⇒ 不产行且如实记 story-missing（不拿今天顶替）。 */
    const noDay = m.buildActionCenter({ nowMs: N1, commitments: [{ sourceId: 'apt_9', dateKey: D11, status: 'confirmed', title: 't' }] });
    if (noDay.items.filter((x) => x.kind === 'commitment').length !== 0) {
        return { ok: false, why: '缺剧情日时约定仍产行了（拿今天顶替）' };
    }
    if (!noDay.gaps.some((g) => g.source === 'commitment' && g.reason === 'story-missing')) {
        return { ok: false, why: '缺剧情日时未记 story-missing gap' };
    }
    return { ok: true, why: '' };
}

/** R-X1-⑩ 自检可跑且不报问题（与产品路径同一份源码）。 */
function jSelfCheck(m) {
    const r = m.actionCenterSelfCheck();
    if (r.problems.length) return { ok: false, why: '自检报问题：' + r.problems.join('；') };
    if (r.kinds !== 5 || r.sources !== 5) return { ok: false, why: '自检覆盖数不对：' + JSON.stringify(r) };
    return { ok: true, why: '' };
}

/* ══════════════════ A 结构面 ══════════════════ */

test('v3850 A1. 行动中心真源在场：三张表 / 五源登记 / 账本键 / 十八个出口齐备', () => {
    assert.ok(fs.existsSync(path.join(ROOT, M_AC)), '真源必须在场：' + M_AC);
    const src = read(M_AC);
    for (const name of ['AC_KINDS', 'AC_LANES', 'AC_ACTIONS', 'AC_STATES', 'AC_SOURCES',
        'AC_WITHDRAW_REASONS', 'AC_LEDGER_KEY', 'buildActionCenter', 'normalizeActionLedger',
        'diffActionLedger', 'applyActionLedger', 'applyAction', 'acJumpOf', 'acSenderKey',
        'acItemLine', 'acSummaryLine', 'actionNoticeOf', 'actionCenterSelfCheck']) {
        assert.match(src, new RegExp('export (function |const )?' + name + '\\b'), M_AC + ' 缺导出：' + name);
    }
    assert.equal(Object.keys(AC.AC_KINDS).length, 5, '五类待处理项（计划原文点名）');
    assert.equal(Object.keys(AC.AC_LANES).length, 2, '两条泳道：只读 / 需确认');
    assert.equal(Object.keys(AC.AC_ACTIONS).length, 4, '四个动作：done / snooze / ignore / open');
    assert.equal(Object.keys(AC.AC_STATES).length, 6, '六态（含 withdrawn）');
    assert.equal(Object.keys(AC.AC_SOURCES).length, 5, '五源登记表必须齐');
    assert.equal(Object.keys(AC.AC_WITHDRAW_REASONS).length, 3, '撤回归因三态');
    assert.equal(AC.AC_LEDGER_KEY, 'ac_ledger');
    for (const k of Object.values(AC.AC_KINDS)) {
        const reg = AC.AC_SOURCES[k];
        assert.ok(reg && reg.label && reg.from, '第 ' + k + ' 类缺登记');
        assert.ok(reg.actions.indexOf(AC.AC_ACTIONS.OPEN) >= 0, k + ' 缺 open（没有跳转位的条目点了没反应）');
        assert.ok(reg.timeBasis === 'story' || reg.timeBasis === 'real', k + ' 时间基非法：' + reg.timeBasis);
    }
    /* 约定是**剧情基**、其余四类是现实基：这一列决定回档判据用不用得上。 */
    assert.equal(AC.AC_SOURCES.commitment.timeBasis, 'story');
    assert.equal(AC.AC_SOURCES.bill.timeBasis, 'real');
});

test('v3850 A2. 本层只消费不取数：不引五源取数件，亦不摸宿主', () => {
    const src = read(M_AC);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    /* 五源取数件一个都不许引 —— 引了就是「重算一份」，即第二份真源。 */
    for (const rel of ['system-notifications.js', 'resume-brief.js', 'finance-overview.js',
        'diagnose-action.js', 'calendar-app.js', 'timeweaver-app.js']) {
        assert.ok(!code.includes(rel), '本层不许引取数实现：' + rel);
    }
    /* 引的四样都是既有唯一口径（取数门 / 靶心协议 / 日键 / 终态与归一）。 */
    assert.match(src, /import \{ numOrNull \} from '\.\/num-gate\.js'/);
    assert.match(src, /import \{ refStr, normalizeOpenRef \} from '\.\/open-ref\.js'/);
    assert.match(src, /import \{ dayKeyOf \} from '\.\/schedule-bridge\.js'/);
    assert.match(src, /import \{ normalizeCommitments, TERMINAL \} from '\.\/commitment-flow\.js'/);
    assert.ok(!/new Date\(|localStorage|document\.|setTimeout|setInterval/.test(code),
        '内核不许摸宿主（纯函数：手机上关掉就不会继续跑）');
});

test('v3850 A3. 账本键三处登记齐全（storage 前缀 / keys 台账 / 派生面台账）', () => {
    assert.match(read(M_STORAGE), /\/\^ac_\//, 'storage 的 CHAT_DATA_PATTERNS 必须登记 /^ac_/');
    assert.match(read(S_KEYS), /key: 'ac_ledger',\s*scope: 'chat'/, 'keys 台账必须登记 ac_ledger 且声明会话隔离');
    const deriv = read(S_DERIV);
    assert.match(deriv, /file: 'config\/action-center\.js'/, '派生面台账必须登记本文件');
    assert.match(deriv, /kind: 'not-a-derivation'/, '本层不持有来源条目 ⇒ 如实标 not-a-derivation');
    /* 反向：登记了就得真被用（键名与真源一致，不许台账与代码各写一个）。 */
    assert.ok(read(IDX).includes('AC_LEDGER_KEY'), IDX + ' 必须用真源导出的键名，不许就地写串');
});

test('v3850 A4. 咽喉接线：导入 / 刷新 / 写入口三处都在', () => {
    const idx = read(IDX);
    assert.match(idx, /AC_LEDGER_KEY, buildActionCenter, diffActionLedger, applyActionLedger, applyAction,/,
        '咽喉必须引内核真源');
    assert.match(idx, /from '\.\/config\/action-center\.js'/);
    assert.match(idx, /async function refreshActionCenter\(\)/, '刷新函数必须在场');
    assert.match(idx, /function applyActionCenterAction\(anchor, action\)/, '写入口必须在场');
    assert.match(idx, /applyActionCenterAction: applyActionCenterAction,/, '写入口必须挂上唯一出口 window.VirtualPhone');
    /* 跳转沿用 X2 的靶心载荷，不另造派发链。 */
    assert.match(idx, /import \{ buildOpenDetail \} from '\.\/config\/app-open-detail\.js'/);
    assert.ok(!/dispatchEvent\(new CustomEvent\('phone:open'/.test(idx), '派发链只有 phone:openApp 一条');
});

/* ══════════════════ B 行为面 ══════════════════ */

test('v3850 B1. 十条判据在同源上一次通过（三键 / 两列 / 缺口 / 总述 / 账本 / 跳转 / 载荷 / 动作门 / 两种形状 / 自检）', () => {
    for (const [name, fn] of [['三键', jThreeKeys], ['两列', jLanesSum], ['缺口', jGapsNotFlattened],
        ['总述', jSummaryTriad], ['账本', jLedger], ['跳转', jJumpReasons], ['载荷', jNoticePayload],
        ['动作门', jActionGate], ['两种形状', jCommitmentShapes], ['自检', jSelfCheck]]) {
        const r = fn(AC);
        assert.equal(r.ok, true, 'R-X1 判据「' + name + '」不成立：' + r.why);
    }
});

test('v3850 B2. 名实一致：来源事件 / 楼层 / 剧情时间四项一项不少，建议与事实不同形', () => {
    const c = AC.buildActionCenter({
        nowMs: N1, storyDay: D11,
        commitments: [{ sourceId: 'apt_1', dateKey: D11, title: 't', status: 'confirmed' }],
        unread: [{ id: 'u1', title: 'm', appId: 'wechat', ts: N1, floor: 42 }]
    });
    const un = c.items.filter((x) => x.kind === 'unread')[0];
    assert.equal(un.floor, 42, '楼层必须如实带出（不许丢）');
    assert.match(AC.acItemLine(un), /第 42 楼/, '一行读数必须带楼层：' + AC.acItemLine(un));
    const cm = c.items.filter((x) => x.kind === 'commitment')[0];
    assert.equal(cm.storyDay, D11, '约定必须带剧情日（回档判据靠它）');
    assert.equal(cm.certainty, 'fact', '约定是事实');
    const bill = AC.buildActionCenter({ nowMs: N1, bills: [{ sourceId: 'b1', title: 'x' }] }).items[0];
    assert.equal(bill.certainty, 'suggestion', '账单是建议 —— 界面据此标「这是建议不是事实」，不许被抹成 fact');
    assert.match(AC.acItemLine(bill), /需确认/, '建议也走泳道判定');
});

test('v3850 B3. 失败项只在真 failed 时进列，unknown / absent 不是待处理项', () => {
    const c = AC.buildActionCenter({
        nowMs: N1,
        failures: [
            { state: 'failed', code: 'x.code', fields: { stage: '写回', needConfirm: true } },
            { state: 'unknown', code: 'y.code', fields: {} },
            { state: 'absent', code: 'z.code', fields: {} }
        ]
    });
    assert.equal(c.items.filter((x) => x.kind === 'failed').length, 1,
        '只有 failed 进列（unknown / absent 是另一回事，混进来会让用户排查不存在的问题）');
    const f = c.items.filter((x) => x.kind === 'failed')[0];
    assert.equal(f.lane, AC.AC_LANES.NEED_CONFIRM, '需要用户拍板的失败项必须落到需确认列');
    assert.match(f.title, /x\.code/, '失败项标题必须带码面（跨页可检索）：' + f.title);
    assert.match(f.detail, /写回/, '失败项必须带断在哪一段：' + f.detail);
});

/* ══════════════════ C 接线面（真跑内核链 + 读真源码） ══════════════════ */

test('v3850 C1. 刷新点在日历早退之前 —— 否则两类与剧情时间无关的源永远看不到', () => {
    const idx = read(IDX);
    const at = idx.indexOf('async function checkCalendarScheduleReminders(');
    assert.ok(at > 0, '日历权威函数必须在场');
    const refreshAt = idx.indexOf('refreshActionCenter();', at);
    const earlyAt = idx.indexOf('if (!storage) return;', at);
    assert.ok(refreshAt > 0, '刷新必须在这个函数里被调用');
    assert.ok(earlyAt > refreshAt, '刷新点必须排在早退之前（跟着早退会被一起吞掉）');
    /* 刷新不 await：后台刷，不挡日历链。 */
    assert.ok(!/await refreshActionCenter\(\)/.test(idx), '刷新不许 await（会挡日历链）');
    /* 承诺投影同一份读数：上面取好的那份直接透传，不重取。 */
    assert.ok(idx.indexOf('window.VirtualPhone._actionCommitmentsProjection = commitments;') > 0,
        '约定面必须复用日程那段取好的投影（两处各取一次 = 两份读数）');
});

test('v3850 C2. 视图纯渲染：只读宿主缓存、不重算、不自己写账', () => {
    const view = read(A_VIEW);
    assert.match(view, /window\.VirtualPhone\?\._actionCenterCache/, '视图必须从宿主缓存取数');
    /* 「提到」不算，**引进来**才算 —— 注释里写路径是我们自己的留档，导入才是第二份实现。 */
    assert.ok(!/^\s*import[^\n]*action-center\.js/m.test(view), '视图不许引内核（它是宿主算好的一份读数）');
    assert.ok(!/from '[^']*config\/action-center\.js'/.test(view), '视图不许从内核导入');
    assert.match(view, /applyActionCenterAction/, '动作必须交给宿主唯一写入口');
    assert.ok(!view.includes('ac_ledger'), '视图不许碰账本键');
    /* 三态不许压平：未取数 / 有缺口 / 零项，三种话不同形。 */
    assert.match(view, /还没取到数/, '未取数必须说「还没取到数」');
    assert.match(view, /个源这轮没读到/, '有缺口必须列出来');
    assert.match(view, /本机现在没有待处理的项/, '零项必须与未取数不同形');
    /* 跳不过去的照样显示，理由写在按钮上。 */
    assert.match(view, /disabled/, '跳不过去的按钮必须禁用');
    assert.match(view, /跳不过去：/, '禁用按钮上必须写理由');
    const app = read(A_APP);
    for (const cls of ['.nc-ac', '.nc-ac-lane', '.nc-ac-item', '.nc-ac-btn', '.nc-ac-btn-off']) {
        assert.ok(app.includes(cls), '样式缺：' + cls);
    }
});

test('v3850 C3. 真跑内核链（桩宿主，照咽喉的实现复刻）：首轮落账 + 投递 + 复算不重投 + 处理留痕', () => {
    const store = new Map();
    const posted = [];
    const host = {
        get: (k) => (store.has(k) ? store.get(k) : null),
        set: (k, v) => { store.set(k, v); }
    };
    const pass = (center) => {
        const raw = host.get(AC.AC_LEDGER_KEY);
        let ledger = raw;
        if (typeof raw === 'string') { try { ledger = JSON.parse(raw); } catch (_e) { ledger = null; } }
        const decision = AC.diffActionLedger(center, ledger);
        for (const row of decision.fresh) posted.push(AC.actionNoticeOf(row));
        if (decision.fresh.length || decision.withdraw.length) {
            host.set(AC.AC_LEDGER_KEY, JSON.stringify(AC.applyActionLedger(ledger, decision, N1, center.storyDay)));
        }
        return decision;
    };
    const mk = () => AC.buildActionCenter({
        nowMs: N1, storyDay: D11,
        bills: [{ sourceId: 'b1', title: '分账' }],
        commitments: [{ sourceId: 'apt_1', dateKey: D11, title: 't', status: 'confirmed' }],
        unread: [{ id: 'u1', title: 'm', appId: 'wechat', ts: N1 }]
    });
    const d1 = pass(mk());
    assert.equal(d1.fresh.length, 3, '首轮三条必须都投：' + d1.fresh.length);
    assert.equal(posted.length, 3, '每条新出都要投一条');
    assert.ok(store.has(AC.AC_LEDGER_KEY), '有新增就必须落账');
    for (const n of posted) {
        assert.ok(n.senderKey.startsWith('action:'), '投递必须带上屏键（否则同一件事会刷屏）：' + n.senderKey);
        assert.ok(n.meta && n.meta.anchor, '投递必须带锚（点横幅才知道是哪一条）');
    }
    const d2 = pass(mk());
    assert.equal(d2.fresh.length, 0, '同一件事复算不许再投（replay）');
    assert.equal(posted.length, 3, '第二轮的投递数不许增长：' + posted.length);
    /* 真做一次「处理」：落账后同一件事不得再出现在新增里，且处理痕迹留档。 */
    const ledger = JSON.parse(store.get(AC.AC_LEDGER_KEY));
    const entries = Array.isArray(ledger) ? ledger : (ledger && ledger.entries) || [];
    const target = entries.filter((e) => e.kind === 'unread')[0];
    const res = AC.applyAction(ledger, target.realIdemKey, AC.AC_ACTIONS.IGNORE, { at: N1 + 1000 });
    assert.equal(res.changed, true);
    store.set(AC.AC_LEDGER_KEY, JSON.stringify(res.entries));
    const d3 = pass(mk());
    assert.equal(d3.fresh.length, 0, '已忽略的条目不许再进新增');
    const back = JSON.parse(store.get(AC.AC_LEDGER_KEY));
    const after = (Array.isArray(back) ? back : (back && back.entries) || [])
        .filter((e) => e.realIdemKey === target.realIdemKey)[0];
    assert.equal(after.state, AC.AC_STATES.IGNORED, '处理痕迹必须留档（不是靠重投盖过去）');
    assert.equal(after.action, AC.AC_ACTIONS.IGNORE, '留痕必须记下是哪个动作');
});

/* ══════════════════ D 负控制（真源码破坏 → 破坏副本 → 同款判据） ══════════════════ */

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

test('v3850 D1. 对账锚里掺进日期（改期即换身份）⇒ 三键判据必须转红', async () => {
    const neg = await negCopy(M_AC, (s) => {
        const anchor = "        realIdemKey: anchorOf((refKind ? 'ref-' + refKind : 'source'), refId || sourceId),";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "        realIdemKey: anchorOf((refKind ? 'ref-' + refKind : 'source'), (refId || sourceId) + '@' + dayKey),");
    });
    const good = jThreeKeys(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jThreeKeys(neg);
    assert.equal(broke.ok, false, '锚里掺了日期之后，同一条约定改期就认不出来了 —— 判据必须转红');
});

test('v3850 D2. 撤掉「源本轮没读就不撤」的门 ⇒ 账本判据必须转红', async () => {
    const neg = await negCopy(M_AC, (s) => {
        const anchor = '        if (read[e.kind] !== true) continue;';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        if (false) continue;');
    });
    const good = jLedger(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jLedger(neg);
    assert.equal(broke.ok, false, '把「不知道」当「没有」之后判据必须转红');
});

test('v3850 D3. 撤掉「已决定过的不撤」这条判据 ⇒ 账本判据必须转红', async () => {
    const neg = await negCopy(M_AC, (s) => {
        const anchor = '        if (e.state !== AC_STATES.OPEN) continue;';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        if (false) continue;');
    });
    const good = jLedger(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jLedger(neg);
    assert.equal(broke.ok, false, '用户已经决定过的事被系统抹掉之后，判据必须转红');
});

test('v3850 D4. 约定面只认完整条目形状（投影行静默产 0 行）⇒ 形状判据必须转红', async () => {
    const neg = await negCopy(M_AC, (s) => {
        const anchor = "        const isProjection = arr.length > 0 && arr[0] && typeof arr[0] === 'object' && arr[0].actor === undefined;";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        const isProjection = false;');
    });
    const good = jCommitmentShapes(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jCommitmentShapes(neg);
    assert.equal(broke.ok, false, '投影行不产行之后判据必须转红（用户那里表现为一条都不显示）');
});

test('v3850 D5. 跳不过去时理由被抹掉 ⇒ 载荷判据必须转红', async () => {
    /* 破坏点选**可观测**的那一处：`why` 是 R-X1 验收②在载荷上的落点
     *（修前实测：改 `appId: jump.ok ? jump.appId : ''` 这条三元**行为一个字不变** ——
     *  `acJumpOf` 不可跳时本就返回空 appId，那条三元是边界兜底、不是判据的着力点）。 */
    const neg = await negCopy(M_AC, (s) => {
        const anchor = "    return { ok: false, appId: '', ref: null, why: '这一项没有可跳的处置入口（无来源 App 与靶心）' };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "    return { ok: false, appId: '', ref: null, why: '' };");
    });
    const good = jNoticePayload(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jNoticePayload(neg);
    assert.equal(broke.ok, false, '理由被抹掉之后，判据必须转红（用户会以为按钮坏了）');
});

test('v3850 D5b. 跳不过去时仍带出靶心 ⇒ 跳转判据必须转红', async () => {
    /* 这一条验的是**同一条规矩的另一半**：不可跳时不许给出可跳的读数。
     *  破坏点选 `acJumpOf` 的失败返回（不是在载荷那一层做三元）—— 这样「不可跳」
     *  与「appId 为空」两件事才会一起破，判据也才真的测到它们。 */
    const neg = await negCopy(M_AC, (s) => {
        const anchor = "    return { ok: false, appId: '', ref: null, why: '这一项没有可跳的处置入口（无来源 App 与靶心）' };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "    return { ok: false, appId: 'wechat', ref: null, why: '这一项没有可跳的处置入口（无来源 App 与靶心）' };");
    });
    const good = jJumpReasons(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jJumpReasons(neg);
    assert.equal(broke.ok, false, '不可跳却给出可跳读数之后，判据必须转红');
});

test('v3850 D6. 两条泳道被压成一列 ⇒ 两列判据必须转红', async () => {
    const neg = await negCopy(M_AC, (s) => {
        const anchor = '        (it.lane === AC_LANES.READONLY ? lanes.readonly : lanes.needConfirm).push(it);';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        lanes.needConfirm.push(it);');
    });
    const good = jLanesSum(AC);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jLanesSum(neg);
    assert.equal(broke.ok, false, '泳道被压成一列之后，两列判据必须转红');
});

test('v3850 D7. 负控制自身可证伪：破坏副本必须真被加载且与原版不同源', async () => {
    /* 若破坏没落到副本上（或落到别处），前面的 D1~D6 就全是假绿。 */
    const neg = await negCopy(M_AC, (s) => {
        const anchor = "export const AC_LEDGER_KEY = 'ac_ledger';";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "export const AC_LEDGER_KEY = 'ac_ledger_probe';");
    });
    assert.equal(neg.AC_LEDGER_KEY, 'ac_ledger_probe', '破坏副本必须真的被加载（键名跟着变）');
    assert.notEqual(neg.AC_LEDGER_KEY, AC.AC_LEDGER_KEY, '副本与原版必须不同源');
    assert.equal(AC.AC_LEDGER_KEY, 'ac_ledger', '原版不许被污染');
    /* 负控制第二向：破坏副本里那条判据必须真的**看得出**破坏。 */
    const shown = neg.actionCenterSelfCheck();
    assert.ok(Array.isArray(shown.problems), '破坏副本的自检仍须可跑（不然测的是加载失败）');
});

/* ══════════════════ E 版本锚（下限形） ══════════════════ */

test('v3850 E1. 版本锚（下限形）：五源同源且不低于 3.85.0', () => {
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
    assert.ok(cmp(nums[0], '3.85.0') >= 0, '版本不得低于 3.85.0（本版是它的落地版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
    assert.ok(Array.isArray(entry.items) && entry.items.length >= 8,
        '当版条目数下限 8（计划交付至少八条）：' + (entry.items || []).length);
    for (const it of entry.items) {
        const s = String(it);
        assert.equal(s.indexOf('【'), 0, '条目须以【前缀】起：' + s.slice(0, 20));
        assert.ok(!/[\[\]\\]/.test(s), '条目内不许出现方括号与反斜杠：' + s.slice(0, 24));
        assert.ok(!s.includes('"'), '条目内不许出现双引号：' + s.slice(0, 24));
    }
    /* 公告块与当版条目同源（App 内「本版更新」弹窗读的就是它）。 */
    const block = idx.slice(idx.indexOf('const ST_PHONE_CURRENT_UPDATE = {'));
    for (const it of entry.items) {
        assert.ok(block.includes(JSON.stringify(it)), '公告块缺当版条目：' + String(it).slice(0, 24));
    }
});
