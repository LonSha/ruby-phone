/* ========================================================
 * system-v4115.test.mjs — [v4.114.0 · 第十三期 R13-X7] 「这个月要处理的」
 * --------------------------------------------------------
 * 本套件守的是 R13-X7 的验收（计划书 §1 该项原文 + §5 共同验收）：
 *   A 口径：四态闭集且两两不同形、因由闭集、四类后果、上限，键必须命中会话族；
 *   B 推进：到期才过期（当天不算）、终结态不被改写、判不了就不动手且如实记因由、
 *            **过期只挂一条后果事件、绝不出现金额格**；
 *   C 动作：办掉只从待办办、重复点不给第二条回执、过期的不许直接办掉、豁免与过期分开、
 *            承认后果只改一个布尔、新建必须同时给出到期日与去处；
 *   D 存取与本月行：写入→读回逐字一致、坏条目当场剔、已豁免不进本月行、排序稳定；
 *   E 接线：App 侧「现取现推」且读不出如实报、视图按状态分别给按钮、过期行必须写出后果；
 *   F 负控制（真源码破坏）：四处 —— 「自动 done」「终结态改写」「无到期日也推」「承认=办掉」，
 *            每一处都要**看得见行为变化**（判据不红，就说明那四条纪律只是注释）。
 *
 * 【本套件自己防的三种判据失真形】
 *   · 用「有到期日」的一条测「无到期日不推」—— 前提本身不成立，测不出任何东西；
 *     故 B3 造的是 dueAt 为空串的那一条，并且断言它**留在 pending** 且进 skipped；
 *   · 破坏只改返回值而不看副作用 —— 「自动 done」若只改返回，日历/存储里什么都没变，
 *     判据看不出差别；故 F1 断言**写回后的列表**里那一条真是 done；
 *   · 用 App 侧自述当结论 —— E 面真读 `apps/affairs/affairs-app.js` 的真源码取锚点，
 *     不读视图里自己写的「已支持」字样。
 * ============================================================ */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ } } });

const TM = await import(path.join(ROOT, 'config', 'errand-terms.js'));
const LC = await import(path.join(ROOT, 'config', 'errand-lifecycle.js'));
const AC = await import(path.join(ROOT, 'config', 'errand-actions.js'));
const ST = await import(path.join(ROOT, 'config', 'errand-store.js'));
const AppMod = await import(path.join(ROOT, 'apps', 'affairs', 'affairs-app.js'));
const ViewMod = await import(path.join(ROOT, 'apps', 'affairs', 'errand-view.js'));

/** 固定剧情当下：2026-10-15 10:00（本地构造，带 Z 会因时区漂）。 */
const NOW = new Date(2026, 9, 15, 10, 0, 0).getTime();

/** 一批典型条目：一条已过期、一条还没到、一条当天到期、一条没日期、两条终结态。 */
function sample() {
    return [
        { id: 'e1', title: '交房租', dueAt: '2026-10-10', app: 'accounting', state: 'pending' },
        { id: 'e2', title: '宽带续费', dueAt: '2026-10-20', app: 'accounting', state: 'pending' },
        { id: 'e3', title: '体检预约', dueAt: '2026-10-15', app: 'health', state: 'pending' },
        { id: 'e4', title: '没写日期', dueAt: '', app: 'accounting', state: 'pending' },
        { id: 'e5', title: '办完了', dueAt: '2026-10-01', app: 'shop', state: 'done' },
        { id: 'e6', title: '不办了', dueAt: '2026-10-02', app: 'shop', state: 'waived' }
    ];
}

function mkStorage(seed) {
    const map = new Map(Object.entries(seed || {}));
    const st = {
        writes: 0,
        get(k, d) { return map.has(k) ? map.get(k) : (d === undefined ? null : d); },
        set(k, v) { st.writes += 1; map.set(k, v); return true; },
        remove(k) { map.delete(k); return true; }
    };
    return st;
}

/** 装宿主：只给剧情钟（本项取时间的唯一来源）。 */
function withHost(ms, fn) {
    const prev = globalThis.VirtualPhone;
    const prevWin = globalThis.window;
    const vp = ms ? { timeManager: { getCurrentStoryTime: () => ({ date: '2026-10-15', time: '10:00', timestamp: ms }) } } : {};
    globalThis.VirtualPhone = vp;
    globalThis.window = { VirtualPhone: vp };
    try { return fn(); } finally {
        if (prev === undefined) delete globalThis.VirtualPhone; else globalThis.VirtualPhone = prev;
        if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
    }
}

/* ══════════ A 口径 ══════════ */

test('A1 四态闭集且两两不同形；unknown 是「不认识」而不是第五个正经状态', () => {
    const vals = Object.values(TM.ERRAND_STATES);
    assert.equal(vals.length, 5);
    assert.equal(new Set(vals).size, 5, '四态 + unknown 必须互不同名（重名就是塔缩的入口）');
    assert.deepEqual(vals.slice().sort(), ['done', 'expired', 'pending', 'unknown', 'waived']);
    /* 三种「离场」的原因必须分得开：办完 / 错过 / 决定不办。 */
    assert.notEqual(TM.ERRAND_STATES.done, TM.ERRAND_STATES.waived);
    assert.notEqual(TM.ERRAND_STATES.expired, TM.ERRAND_STATES.waived);
});

test('A2 因由闭集非空且互不重名；四条后果类别与四个上限都在', () => {
    const why = Object.values(TM.ERRAND_WHY);
    assert.equal(new Set(why).size, why.length, '因由不许重名');
    assert.ok(why.length >= 8, '因由太薄：不同拒法要能分开说');
    assert.equal(TM.ERRAND_WHY.ok, '', '成功必须是空串（界面据此不显示原因）');
    assert.equal(Object.keys(TM.ERRAND_CONSEQUENCE_KINDS).length, 4);
    assert.equal(TM.ERRAND_LIMITS.errands, 60);
    assert.equal(TM.ERRAND_LIMITS.titleChars, 40);
    assert.ok(TM.ERRAND_LIMITS.consequenceChars > 0);
    assert.ok(TM.ERRAND_LIMITS.monthRows > 0);
});

test('A3 后果事件**没有金额格**：没有金额格，就没有一条路能把过期悄悄变成已扣款', () => {
    const list = LC.advanceErrands(sample(), NOW).list;
    const expired = list.filter((e) => e.state === TM.ERRAND_STATES.expired);
    assert.ok(expired.length >= 1, '样本里必须有真过期的一条');
    for (const e of expired) {
        assert.deepEqual(Object.keys(e.consequence).sort(), ['acked', 'at', 'kind', 'text'],
            '★ 后果只许这四个字段；出现 amount / fee / charged 之类就是自动扣款的入口');
        assert.equal(Object.prototype.hasOwnProperty.call(e.consequence, 'amount'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(e.consequence, 'fee'), false);
    }
});

test('A4 存储键必须是独立常量，且命中会话族前缀（清单装的是这段对话欠着的事）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'config', 'errand-terms.js'), 'utf8');
    assert.ok(/export\s+const\s+ERRAND_KEY\s*=/.test(src), '键必须是独立常量（keys 门按常量声明抽键面）');
    assert.ok(TM.ERRAND_KEY.startsWith('aff'), '★ 必须命中 /^aff/ 会话族：与 affairs_v1 同族，换会话不许串');
});

/* ══════════ B 推进（时间往前走一格） ══════════ */

test('B1 到期才过期：过期日**当天**仍给一整天，严格早于今天才算错过', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const byId = new Map(adv.list.map((e) => [e.id, e]));
    assert.equal(byId.get('e1').state, TM.ERRAND_STATES.expired, '10-10 早于 10-15 ⇒ 过期');
    assert.equal(byId.get('e2').state, TM.ERRAND_STATES.pending, '10-20 还没到 ⇒ 仍是待办');
    assert.equal(byId.get('e3').state, TM.ERRAND_STATES.pending, '★ 当天到期不许当场判过期（用户还有一整天）');
    assert.deepEqual(adv.expired.map((e) => e.id), ['e1'], '这一轮只该新过期一条');
});

test('B2 终结态不被时间改写：办完的 / 决定不办的，推进不许把它们推成过期', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const byId = new Map(adv.list.map((e) => [e.id, e]));
    assert.equal(byId.get('e5').state, TM.ERRAND_STATES.done);
    assert.equal(byId.get('e6').state, TM.ERRAND_STATES.waived);
    assert.equal(adv.expired.some((e) => e.id === 'e5' || e.id === 'e6'), false);
});

test('B3 判不了就不动手：没写到期日的一条留在待办并**进 skipped**（不静默跳过）', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const one = adv.list.find((e) => e.id === 'e4');
    assert.equal(one.state, TM.ERRAND_STATES.pending, '★ 判不了必须不动手');
    const sk = adv.skipped.find((s) => s.id === 'e4');
    assert.ok(sk, '★ 判不了必须被记下来 —— 静默跳过会让用户以为「没事到点」');
    assert.equal(sk.why, TM.ERRAND_WHY.noDue);
    /* 到期日写了但不成形：另一种因由，不许与「没写」混成一格。 */
    const bad = LC.advanceErrands([{ id: 'x', title: 'x', dueAt: '2030/1/1', app: 'shop', state: 'pending' }], NOW);
    assert.equal(bad.skipped[0].why, TM.ERRAND_WHY.badDue);
    assert.notEqual(TM.ERRAND_WHY.noDue, TM.ERRAND_WHY.badDue);
});

test('B4 读不到当下就一条都不推：不许拿今天顶替（那会让还有三天的条目当场过期）', () => {
    const adv = LC.advanceErrands(sample(), 0);
    assert.equal(adv.expired.length, 0, '★ 没有当下 ⇒ 什么都没过期');
    assert.equal(adv.list.filter((e) => e.state === TM.ERRAND_STATES.expired).length, 0);
    assert.ok(adv.skipped.length >= 1, '待办的全部进 skipped（判不了要说出来）');
    const adv2 = LC.advanceErrands(sample(), NaN);
    assert.equal(adv2.expired.length, 0);
});

test('B5 纯函数：同一份输入两次跑，结果逐字相同（推进不许带随机/时间副作用）', () => {
    const a = LC.advanceErrands(sample(), NOW);
    const b = LC.advanceErrands(sample(), NOW);
    assert.deepEqual(a.list, b.list);
    assert.deepEqual(a.expired, b.expired);
    assert.deepEqual(a.skipped, b.skipped);
});

test('B6 坏条目当场剔：无 id / 无标题 / 不是对象 —— 不许自造一条顶上', () => {
    const adv = LC.advanceErrands([null, { id: '', title: 'x' }, { id: 'y', title: '' }], NOW);
    assert.equal(adv.list.length, 0, '★ 形状不对的一条都不留');
    assert.equal(adv.expired.length, 0);
});

/* ══════════ C 动作（人点了一下之后） ══════════ */

test('C1 办掉：从待办办成办完，并留一条回执（回执是「办完看得见」的全部凭据）', () => {
    const r = AC.markErrandDone(sample(), 'e2', NOW, '转账了');
    assert.equal(r.ok, true);
    const one = r.list.find((e) => e.id === 'e2');
    assert.equal(one.state, TM.ERRAND_STATES.done);
    assert.equal(one.receipts.length, 1, '★ 办完必须留回执');
    assert.ok(one.receipts[0].text.includes('转账了'));
    assert.equal(one.receipts[0].at, '2026-10-15');
});

test('C2 重复办不许给第二条回执：点两次不等于办两次', () => {
    const once = AC.markErrandDone(sample(), 'e2', NOW, '转账了');
    const twice = AC.markErrandDone(once.list, 'e2', NOW, '又点了一次');
    assert.equal(twice.ok, false);
    assert.equal(twice.why, TM.ERRAND_WHY.alreadyDone);
    assert.equal(twice.list.find((e) => e.id === 'e2').receipts.length, 1, '★ 回执不许变成两条');
});

test('C3 过期的条目不许直接办掉：错过与做完是两件事，得先承认后果', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const r = AC.markErrandDone(adv.list, 'e1', NOW, '补交');
    assert.equal(r.ok, false);
    assert.equal(r.why, TM.ERRAND_WHY.alreadyExpired);
    const one = r.list.find((e) => e.id === 'e1');
    assert.equal(one.state, TM.ERRAND_STATES.expired, '★ 拒了就必须一点没改');
    assert.equal(one.receipts.length, 0);
});

test('C4 豁免：待办与过期都能豁免；已办的不许豁免（把「办过」改成「不办」是改历史）', () => {
    const w1 = AC.waiveErrand(sample(), 'e2', NOW, '不再续了');
    assert.equal(w1.ok, true);
    assert.equal(w1.list.find((e) => e.id === 'e2').state, TM.ERRAND_STATES.waived);
    const adv = LC.advanceErrands(sample(), NOW);
    const w2 = AC.waiveErrand(adv.list, 'e1', NOW, '');
    assert.equal(w2.ok, true, '过期的也能豁免（我决定不补了）');
    const done = AC.markErrandDone(sample(), 'e2', NOW, 'ok');
    const w3 = AC.waiveErrand(done.list, 'e2', NOW, '');
    assert.equal(w3.ok, false);
    assert.equal(w3.why, TM.ERRAND_WHY.alreadyDone);
});

test('C5 承认后果只改一个布尔：不扣钱、不销条目、不改状态', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const before = adv.list.find((e) => e.id === 'e1');
    const r = AC.ackConsequence(adv.list, 'e1');
    assert.equal(r.ok, true);
    const after = r.list.find((e) => e.id === 'e1');
    assert.equal(after.state, TM.ERRAND_STATES.expired, '★ 承认不等于办掉');
    assert.equal(after.consequence.acked, true);
    assert.equal(after.consequence.kind, before.consequence.kind, '后果类别不许因为承认而改写');
    assert.equal(r.list.length, adv.list.length, '★ 承认不许销掉条目');
    /* 待办的条目不许「承认后果」——它还没有后果。 */
    assert.equal(AC.ackConsequence(sample(), 'e2').why, TM.ERRAND_WHY.notPending);
});

test('C6 新建：到期日与去处必须同时给齐，缺一个都不许生成条目', () => {
    const ok = AC.createErrand(sample(), { title: '水电费', dueAt: '2026-10-25', app: 'accounting' }, NOW);
    assert.equal(ok.ok, true);
    assert.equal(ok.list.length, sample().length + 1);
    assert.equal(ok.list[ok.list.length - 1].state, TM.ERRAND_STATES.pending);
    assert.equal(AC.createErrand(sample(), { title: '', dueAt: '2026-10-25', app: 'accounting' }, NOW).why, TM.ERRAND_WHY.noTitle);
    assert.equal(AC.createErrand(sample(), { title: 'x', dueAt: '', app: 'accounting' }, NOW).why, TM.ERRAND_WHY.noDue);
    assert.equal(AC.createErrand(sample(), { title: 'x', dueAt: '2026/10/25', app: 'accounting' }, NOW).why, TM.ERRAND_WHY.badDue);
    assert.equal(AC.createErrand(sample(), { title: 'x', dueAt: '2026-10-25', app: 'nope' }, NOW).why, TM.ERRAND_WHY.badShape);
});

test('C7 找不到 / 没 id 各自报因由，且**列表一字未动**', () => {
    const base = sample();
    const r1 = AC.markErrandDone(base, '', NOW, '');
    assert.equal(r1.why, TM.ERRAND_WHY.noId);
    assert.deepEqual(r1.list, LC.normalizeErrands(base));
    const r2 = AC.markErrandDone(base, 'nope', NOW, '');
    assert.equal(r2.why, TM.ERRAND_WHY.notFound);
    assert.deepEqual(r2.list, LC.normalizeErrands(base));
});

/* ══════════ D 存取与本月行 ══════════ */

test('D1 写入 → 读回逐字一致（含回执与后果），且坏条目在写入前就被剔掉', () => {
    const st = mkStorage();
    const done = AC.markErrandDone(sample(), 'e2', NOW, '转账了');
    assert.equal(ST.writeErrands(st, done.list), true);
    const back = ST.readErrands(st);
    assert.equal(back.length, LC.normalizeErrands(done.list).length);
    assert.deepEqual(back.find((e) => e.id === 'e2').receipts, done.list.find((e) => e.id === 'e2').receipts);
    /* 坏条目写前剔：写进去的永远是归一后的形状。 */
    assert.equal(ST.writeErrands(st, [null, { id: '', title: 'x' }, { id: 'z', title: '好' }]), true);
    assert.equal(ST.readErrands(st).length, 1);
});

test('D2 读不出就是 []（不抛）；写不进返回 false（不抛）', () => {
    const broken = { get() { throw new Error('boom'); }, set() { throw new Error('boom'); } };
    assert.deepEqual(ST.readErrands(broken), []);
    assert.equal(ST.writeErrands(broken, []), false);
    assert.deepEqual(ST.readErrands(null), []);
    assert.equal(ST.writeErrands(null, []), false);
});

test('D3 本月行：只收本月且未豁免；按到期日升序、同刻按 id（两次跑逐字相同）', () => {
    const rows1 = ST.monthRows(sample(), '2026-10');
    const ids = rows1.map((e) => e.id);
    assert.equal(ids.includes('e6'), false, '★ 已豁免的不进催人清单');
    /* 期望序：10-01 / 10-02 的 e6 被豁免排除，剩 10-01(e5) 10-10(e1) 10-15(e3) 10-20(e2)。 */
    assert.deepEqual(ids, ['e5', 'e1', 'e3', 'e2'], '按到期日升序，且豁免的不在清单上');
    const rows2 = ST.monthRows(sample(), '2026-10');
    assert.deepEqual(rows1, rows2);
    /* 换个整月：一条都不匹配。 */
    assert.equal(ST.monthRows(sample(), '2026-11').length, 0);
});

/* ══════════ E 接线（App 与视图） ══════════ */

/** 假宿主 + 假存储造一个真 AffairsApp（只给本项用到的那几口）。 */
function mkApp(seed) {
    const st = mkStorage(seed);
    const shell = { layerHost: () => null, screen: null, showNotification: () => { } };
    return { app: new AppMod.AffairsApp(shell, st), st: st };
}

test('E1 现取现推：读一次就把到点的条目推成过期并**写回**（不靠后台计时器）', () => {
    const seed = { [TM.ERRAND_KEY]: JSON.stringify(sample()) };
    const { app, st } = mkApp(seed);
    withHost(NOW, () => {
        const face = app.monthFace();
        assert.equal(face.state, 'ok');
        assert.ok(face.rows.length >= 1);
        assert.ok(st.writes >= 1, '★ 推进真改了状态就必须写回，否则下次进来又变回待办');
        const back = LC.normalizeErrands(JSON.parse(st.get(TM.ERRAND_KEY)));
        assert.equal(back.find((e) => e.id === 'e1').state, TM.ERRAND_STATES.expired);
    });
});

test('E2 没有真变化就不写盘（渲染一次刷一次盘是本仓治过的形态）', () => {
    const seed = { [TM.ERRAND_KEY]: JSON.stringify([{ id: 'a', title: '还没到', dueAt: '2026-12-01', app: 'shop', state: 'pending' }]) };
    const { app, st } = mkApp(seed);
    withHost(NOW, () => {
        app.monthFace();
        app.monthFace();
        assert.equal(st.writes, 0, '★ 没有过期发生，一次都不该写');
    });
});

test('E3 读不出就如实报「读不出来」，不冒充「这个月没事」', () => {
    const broken = { get() { throw new Error('boom'); }, set() { return true; } };
    const app = new AppMod.AffairsApp({ layerHost: () => null, screen: null }, broken);
    withHost(NOW, () => {
        const face = app.monthFace();
        assert.equal(face.state, 'unreadable');
        assert.ok(face.line.includes('读不出来'));
        assert.ok(face.warn.includes('不等于'));
        assert.deepEqual(face.rows, []);
    });
});

test('E4 剧情钟读不到：一行都不推，且读数句如实说「判不了」', () => {
    const seed = { [TM.ERRAND_KEY]: JSON.stringify(sample()) };
    const { app } = mkApp(seed);
    withHost(0, () => {
        const face = app.monthFace();
        assert.ok(face.line.includes('判不了'), '★ 时钟读不到必须说出来：' + face.line);
        assert.equal(face.rows.filter((e) => e.state === TM.ERRAND_STATES.expired).length, 0);
        assert.ok(face.warn.length > 0, '判不了的条目要被点名');
    });
});

test('E5 四个动作走 App 都真写盘：办掉 / 豁免 / 承认 / 新建', () => {
    const seed = { [TM.ERRAND_KEY]: JSON.stringify(sample()) };
    const { app, st } = mkApp(seed);
    withHost(NOW, () => {
        const d = app.doErrand('e2', '转账了');
        assert.equal(d.ok, true);
        const back1 = LC.normalizeErrands(JSON.parse(st.get(TM.ERRAND_KEY)));
        assert.equal(back1.find((e) => e.id === 'e2').state, TM.ERRAND_STATES.done);
        const w = app.waiveErrand('e3', '');
        assert.equal(w.ok, true);
        app.monthFace();
        const a = app.ackErrand('e1');
        assert.equal(a.ok, true);
        const c = app.createErrand({ title: '水电费', dueAt: '2026-10-25', app: 'accounting' });
        assert.equal(c.ok, true);
        const back2 = LC.normalizeErrands(JSON.parse(st.get(TM.ERRAND_KEY)));
        assert.equal(back2.filter((e) => e.title === '水电费').length, 1);
    });
});

test('E6 视图按状态分别给按钮：走不通的按钮不许亮（待办给办掉/不办，过期给知道了/不办，办完不给）', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const app = {
        monthFace: () => ({ rows: adv.list, line: '读数', warn: '', state: 'ok', nowMs: NOW }),
        createErrand: () => null, doErrand: () => null, waiveErrand: () => null, ackErrand: () => null
    };
    const view = new ViewMod.ErrandView(app);
    const html = view._row(adv.list.find((e) => e.id === 'e1'))
        + view._row(adv.list.find((e) => e.id === 'e2'))
        + view._row(adv.list.find((e) => e.id === 'e5'));
    /* 过期行：有 ack 没有 done。 */
    assert.ok(html.includes('data-op="ack"'));
    assert.equal(html.includes('data-op="done"'), true); /* 待办行 e2 给了 done */
    /* 已办行（e5）一个按钮都不给 —— 用整段 html 计数判：ack 只该出现在过期那一行。 */
    const rowE5 = view._row(adv.list.find((e) => e.id === 'e5'));
    assert.equal(rowE5.includes('data-op='), false, '★ 已办完的行不许给按钮（走不通的按钮比不给更贵）');
    const rowE1 = view._row(adv.list.find((e) => e.id === 'e1'));
    assert.equal(rowE1.includes('data-op="done"'), false, '★ 过期行不许给「办掉」');
});

test('E7 过期行必须把后果写出来（写「已过期」三个字等于那份数据白存）', () => {
    const adv = LC.advanceErrands(sample(), NOW);
    const app = { monthFace: () => ({ rows: adv.list, line: '', warn: '', state: 'ok', nowMs: NOW }) };
    const view = new ViewMod.ErrandView(app);
    const row = view._row(adv.list.find((e) => e.id === 'e1'));
    assert.ok(row.includes('er-consequence'), '必须画出后果那一块');
    assert.ok(row.includes('后果') || row.includes('已承认'), '必须写清这是后果 / 已承认');
    /* 承认过之后形态要变（不许与未承认画成一个样）。 */
    const acked = AC.ackConsequence(adv.list, 'e1').list.find((e) => e.id === 'e1');
    const row2 = view._row(acked);
    assert.ok(row2.includes('已承认'));
    assert.notEqual(row, row2, '★ 承认前后必须不同形');
});

/* ══════════ F 负控制（真源码破坏） ══════════ */

function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4115_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of ['num-gate.js', 'errand-terms.js', 'errand-lifecycle.js', 'errand-actions.js', 'errand-store.js']) {
        const abs = path.join(ROOT, 'config', f);
        if (fs.existsSync(abs)) fs.copyFileSync(abs, path.join(dir, 'config', f));
    }
    return dir;
}

/** 多锚破坏：同一文件里**逐对**替换，每一对都必须恰中一次。
 *   为何需要它：本仓有几处纪律是**两道门槛共同守着的**（例如「过期不许直接办掉」既由
 *   expired 那一支拒、又由「只从 pending 办」那一支拒）。只破坏一道，行为会落到另一道的
 *   因由上 —— 判据仍能看见变化，但看见的不是「纪律坏了」。要证明纪律真被判据钉住，
 *   得把两道一起拿掉。 */
function damageMany(rel, pairs) {
    let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const [from, to] of pairs) {
        const n = src.split(from).length - 1;
        assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次：' + from.slice(0, 50));
        src = src.split(from).join(to);
    }
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src, 'utf8');
    return dir;
}

function damage(rel, from, to) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

test('F1 破坏「当天不算过期」⇒ 当天到期的条目当场被判过期（用户少了整整一天）', async () => {
    const dir = damage('config/errand-lifecycle.js',
        'if (dueStart >= dayStartOf(todayKey)) { out.list.push(e); continue; }',
        'if (dueStart > dayStartOf(todayKey)) { out.list.push(e); continue; }');
    const broke = await import(path.join(dir, 'config', 'errand-lifecycle.js'));
    const one = [{ id: 'e3', title: '体检预约', dueAt: '2026-10-15', app: 'health', state: 'pending' }];
    /* 原版：当天仍待办。 */
    assert.equal(LC.advanceErrands(one, NOW).list[0].state, TM.ERRAND_STATES.pending);
    /* 破坏版：当场判过期 —— 这一条不红，就说明「当天给一整天」只是注释。 */
    assert.equal(broke.advanceErrands(one, NOW).list[0].state, TM.ERRAND_STATES.expired);
});

test('F2 破坏「终结态不被改写」⇒ 已经办完的条目会被推成过期（等于推翻用户已经做过的事）', async () => {
    /* ★ 锚点选「只推 pending」那一道，不是「终结态单列」那一道：
     *   实测发现后者是**双保险的上面一层** —— done / waived 天然不是 pending，
     *   拿掉它行为一点不变（判据会假装抓到破坏）。真正守着这条纪律的是
     *   `e.state !== pending` 那一支，故负控制必须打在那支上。 */
    const dir = damageMany('config/errand-lifecycle.js', [
        ['if (e.state === ERRAND_STATES.done || e.state === ERRAND_STATES.waived) {',
            'if (false) {'],
        ['if (e.state !== ERRAND_STATES.pending) { out.list.push(e); continue; }',
            'if (false) { out.list.push(e); continue; }']
    ]);
    const broke = await import(path.join(dir, 'config', 'errand-lifecycle.js'));
    const doneOne = [{ id: 'e5', title: '办完了', dueAt: '2026-10-01', app: 'shop', state: 'done' }];
    assert.equal(LC.advanceErrands(doneOne, NOW).list[0].state, TM.ERRAND_STATES.done);
    assert.equal(broke.advanceErrands(doneOne, NOW).list[0].state, TM.ERRAND_STATES.expired,
        '★ 这一条不红，就说明「终结态不被时间改写」没被判据钉住');
});

test('F3 破坏「判不了就不动手」⇒ 没写到期日的条目被当成过期（凭空造出一条错过）', async () => {
    const dir = damage('config/errand-lifecycle.js',
        'if (!e.dueAt || !dueStart) {',
        'if (false) {');
    const broke = await import(path.join(dir, 'config', 'errand-lifecycle.js'));
    const noDue = [{ id: 'e4', title: '没写日期', dueAt: '', app: 'accounting', state: 'pending' }];
    const ok = LC.advanceErrands(noDue, NOW);
    assert.equal(ok.list[0].state, TM.ERRAND_STATES.pending);
    assert.equal(ok.skipped.length, 1);
    const bad = broke.advanceErrands(noDue, NOW);
    assert.equal(bad.skipped.length, 0, '★ 破坏后「判不了」这条分支整个失效');
    assert.notEqual(bad.list[0].state, TM.ERRAND_STATES.pending, '破坏后它被当成到点处理了');
});

test('F4 破坏「过期不许直接办掉」⇒ 错过的一笔能直接被标成「办完了」（回执造假）', async () => {
    /* ★ 两道门槛一起拿掉：本件对「错过」有**双重**拒法（expired 单列 + 只从 pending 办），
     *   只破一道时另一道会以 not-pending 接手 —— 行为确实变了（因由变了），
     *   但那不是本 F 组要证的事（要证的是「错过能被直接标成办完」会不会发生）。 */
    const dir = damageMany('config/errand-actions.js', [
        ['if (one.state === ERRAND_STATES.expired) return { ok: false, why: ERRAND_WHY.alreadyExpired, list: src };',
            'if (false) return { ok: false, why: ERRAND_WHY.alreadyExpired, list: src };'],
        ['if (one.state !== ERRAND_STATES.pending) return { ok: false, why: ERRAND_WHY.notPending, list: src };',
            'if (false) return { ok: false, why: ERRAND_WHY.notPending, list: src };']
    ]);
    const broke = await import(path.join(dir, 'config', 'errand-actions.js'));
    const adv = LC.advanceErrands(sample(), NOW);
    assert.equal(AC.markErrandDone(adv.list, 'e1', NOW, '补交').ok, false);
    const r = broke.markErrandDone(adv.list, 'e1', NOW, '补交');
    assert.equal(r.ok, true, '★ 这一条不红，就说明「错过与做完是两件事」只是写在注释里');
    assert.equal(r.list.find((e) => e.id === 'e1').state, TM.ERRAND_STATES.done,
        '★ 错过的那条被直接改写成了办完（回执也随之多出一条）');
});

test('F5 破坏「承认只改一个布尔」⇒ 承认之后状态被改掉（承认=办掉）', async () => {
    const dir = damage('config/errand-actions.js',
        'consequence: Object.assign({}, one.consequence, { acked: true })',
        'consequence: Object.assign({}, one.consequence, { acked: true }), state: ERRAND_STATES.done');
    const broke = await import(path.join(dir, 'config', 'errand-actions.js'));
    const adv = LC.advanceErrands(sample(), NOW);
    assert.equal(AC.ackConsequence(adv.list, 'e1').list.find((e) => e.id === 'e1').state, TM.ERRAND_STATES.expired);
    assert.equal(broke.ackConsequence(adv.list, 'e1').list.find((e) => e.id === 'e1').state, TM.ERRAND_STATES.done,
        '★ 这一条不红，就说明「承认不等于办掉」没被钉住');
});

/* ============================================================
 * G. 版本条形态锚：当版收尾条必须带「（五源同源）」
 * ------------------------------------------------------------
 * 【为什么单列一组（这条是被复发打出来的）】
 *   全仓有 7 套历史判据（v285 / v286 / v287 / v3171 / v3201 / v3213 / v3960）
 *   都按「当版条目里有一条带 `版本升至 X（五源同源）`」这个**形态锚**判绿。
 *   而实测 v4.101.0 之后这条形态锚在生成侧被悄悄丢了 —— 于是从那时起
 *   那 7 条判据一直红着，没人把它当回事（它们分散在 7 个文件里，看起来像各自的陈旧断言）。
 *   本组把它钉在**当版**：新版的收尾条必须自己带这个锚，而不是让历史判据代自己喊。
 *
 * 【为什么不改那 7 套判据的期望】
 *   那个锚不是「上一版的专有词」，它是**五源同源的落地声明**：一个版本条目声称
 *   「本版把 5 份真源同步抬了」，就该在条目里说出来。把判据改成「不必说」等于
 *   把这条声明从产品里摘掉 —— 摘掉之后，五源同源就只剩工程侧一份 README 式的约定。
 * ============================================================ */

test('G1 当版收尾条带五源同源形态锚（7 套历史判据都靠它判绿）', () => {
    const log = JSON.parse(fs.readFileSync(path.join(ROOT, 'update-log.json'), 'utf8'));
    const live = log.latest;
    const items = (log.versions[live] || {}).items || [];
    assert.ok(items.length >= 8, '当版条目数不得塌缩（实测 ' + items.length + '）');
    /* 两种合法形态：版本号后直接闭合，或「（五源同源）」写在版本号后 —— 两者都算收尾条。
     *   不在判据里钉死括号位置：那是排版，不是纪律。 */
    const closing = items.filter((it) => it.startsWith('【版本升至 ' + live));
    assert.equal(closing.length, 1, '当版必须恰好一条收尾条（实测 ' + closing.length + '）');
    assert.ok(closing[0].includes('（五源同源）'),
        '收尾条必须带（五源同源）—— 丢了它，7 套历史判据会集体转红且各自看起来像陈旧断言');
    /* 三个形态锚（缺陷 / 交棒 / 边界）也要在 —— 它们同样被 7 套判据按形态判。 */
    assert.equal(items.some((it) => /自己抓到的缺陷|本版自己抓到|缺陷形态/.test(it)), true, '缺缺陷形态条');
    assert.equal(items.some((it) => /交棒改写|主动改写|下限形/.test(it)), true, '缺交棒改写条');
    assert.equal(items.some((it) => /运行时验证边界/.test(it)), true, '缺运行时验证边界条');
});

test('G2 弹窗逐字同源且带当版号（不是上一版号的残留）', () => {
    const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const log = JSON.parse(fs.readFileSync(path.join(ROOT, 'update-log.json'), 'utf8'));
    const entry = log.versions[log.latest];
    const m = idx.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(m, '公告块可提取');
    for (const it of entry.items) {
        assert.ok(m[0].includes(JSON.stringify(it)), '弹窗缺条目：' + String(it).slice(0, 24));
    }
    assert.ok(m[0].includes('版本升至 ' + log.latest + '（五源同源）'), '弹窗里的收尾条必须带当版号与形态锚');
});
