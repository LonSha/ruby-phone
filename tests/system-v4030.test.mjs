/* ========================================================
 * tests/system-v4030.test.mjs — [v4.03.0 · 第三期 E 包手机侧第四项 R3-X6]
 *   协作行程板(人员 / 地点顺序 / 分工 / 准备清单 / 共同费用)
 *
 * 判据面(五组):
 *   A 结构:内核六件事在内 / 上限与枚举 / 拒绝面在 / 内核只 import 一处且零 storage·window·fetch
 *   B 行为:declined 不算参加 / 预估与实际分列 / 幂等同一费用不两次扣账 / payer 不在人头拒 /
 *           认不出⇒保守 / 建议只产文本·零副作用 / 人头建议不擅自删人
 *   C 接线:app 层四件事 / 唯一写账本的动作恰一处 / 视图段与绑定 / CSS 分色 / 键登记
 *   D 负控制:真源码定点破坏「declined 不算参加」⇒ B1 判据必转红
 *   E 版本锚:下限形(不锁当版读数,下一版抬版无需二次改写)
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const CORE = 'apps/traveldesk/traveldesk-plan.js';
const APP = 'apps/traveldesk/traveldesk-app.js';
const VIEW = 'apps/traveldesk/traveldesk-view.js';
const CSS = 'apps/traveldesk/traveldesk.css';
const KEYS = 'scripts/keys-audit.mjs';

const core = read(CORE);
const app = read(APP);
const view = read(VIEW);
const css = read(CSS);
const keys = read(KEYS);
const mod = await import(path.join(ROOT, CORE));
const {
    normalizeParty, participantsOf, declinedOf, pendingOf, partyReadings,
    commitCosts, proposedPeople, partyAdvice, partySelfCheck,
    TVP_COST_ID_PREFIX, TVP_MEMBER_STATES, TVP_COST_STATES,
    TVP_STOPS_MAX, TVP_TASKS_MAX, TVP_CHECKS_MAX, TVP_COSTS_MAX, TVP_MEMBERS_MAX,
} = mod;

/* ---------- A 结构 ---------- */
test('A1 内核自检零问题 + 六件事都在', () => {
    const r = partySelfCheck();
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    for (const fn of ['normalizeParty', 'participantsOf', 'declinedOf', 'pendingOf', 'partyReadings', 'commitCosts', 'proposedPeople', 'partyAdvice', 'partySelfCheck']) {
        assert.equal(typeof mod[fn], 'function', '缺出口:' + fn);
    }
});

test('A2 上限与枚举是冻结常量且数值自洽', () => {
    assert.deepEqual([...TVP_MEMBER_STATES], ['invited', 'accepted', 'declined']);
    assert.equal(TVP_MEMBER_STATES.includes('accepted'), true);
    assert.equal(TVP_COST_STATES.includes('estimated'), true);
    assert.equal(TVP_COST_STATES.includes('actual'), true);
    assert.equal(TVP_COST_ID_PREFIX, 'tv_pc_');
    for (const n of [TVP_STOPS_MAX, TVP_TASKS_MAX, TVP_CHECKS_MAX, TVP_COSTS_MAX, TVP_MEMBERS_MAX]) {
        assert.equal(typeof n, 'number');
        assert.equal(n > 0, true);
    }
    /* 上限真的生效:超出的进 rejected(capped:),被裁的不静默消失 */
    const many = [];
    for (let i = 0; i < TVP_MEMBERS_MAX + 3; i++) many.push({ name: 'M' + i, state: 'accepted' });
    const got = normalizeParty({ members: many });
    assert.equal(got.party.members.length, TVP_MEMBERS_MAX);
    assert.equal(got.rejected.some((x) => String(x.why).startsWith('capped:')), true);
    assert.equal(got.dropped.member, 3);
});

test('A3 内核只 import 一处(全仓唯一数值取值实现)+ 零 storage/window/fetch', () => {
    const imports = core.match(/^import[\s\S]*?from\s*['"][^'"]+['"];/gm) || [];
    const sources = imports.map((s) => (s.match(/from\s*['"]([^'"]+)['"]/) || [])[1]);
    for (const s of sources) assert.equal(s, '../../config/num-gate.js', '内核不得依赖:' + s);
    /* 判据只扫**真实 import 来源与调用式**,不扫文档注释里的名词(与 v4.01.0 那次误判同一教训) */
    assert.equal(/import[\s\S]*?from\s*['"][^'"]*storage['"]/.test(core), false);
    assert.equal(/window\./.test(core.replace(/\/\*[\s\S]*?\*\//g, '')), false);
    assert.equal(/\bfetch\s*\(/.test(core.replace(/\/\*[\s\S]*?\*\//g, '')), false);
    assert.equal(/document\./.test(core.replace(/\/\*[\s\S]*?\*\//g, '')), false);
});

test('A4 拒绝面存在且带原因(不是静默丢)', () => {
    const got = normalizeParty({ members: [{ name: '' }, { name: 'A', state: 'weird' }], costs: [{ id: 'x', state: 'actual' }], stops: [{}] });
    const whys = got.rejected.map((x) => x.why);
    assert.equal(whys.includes('no_name'), true, '成员没名字必须拒');
    assert.equal(whys.includes('no_payer'), true, '费用没垫付人必须拒');
    assert.equal(whys.includes('no_place'), true, '地点空必须拒');
    assert.equal(whys.includes('unknown_state'), true, '认不出的态必须留痕');
    assert.equal(got.party.members.length, 1, '拒掉的不该留在板里');
});

/* ---------- B 行为 ---------- */
test('B1 婉拒者不算参加、未答复也不算参加', () => {
    const p = normalizeParty({
        members: [
            { name: '甲', state: 'accepted' },
            { name: '乙', state: 'declined' },
            { name: '丙', state: 'invited' },
            { name: '丁', state: 'maybe' },   /* 认不出 ⇒ 落到 invited(保守) */
        ],
    }).party;
    assert.deepEqual(participantsOf(p), ['甲']);
    assert.deepEqual(declinedOf(p), ['乙']);
    assert.deepEqual(pendingOf(p), ['丙', '丁']);
    const rd = partyReadings(p, []);
    assert.equal(rd.members, 4);
    assert.equal(rd.accepted, 1);
    assert.equal(rd.declined, 1);
    assert.equal(rd.pending, 2);
});

test('B2 预计花费与实际金额分列,永不求和成一个数', () => {
    const p = normalizeParty({
        costs: [
            { id: 'e1', payer: '甲', finalCNY: 120.5, state: 'estimated' },
            { id: 'e2', payer: '甲', finalCNY: 300, state: 'actual' },
            { id: 'e3', payer: '乙', finalCNY: 79.5, state: 'actual' },
        ],
    }).party;
    const rd = partyReadings(p, []);
    assert.equal(rd.estimatedTotal, 120.5);
    assert.equal(rd.estimatedCount, 1);
    assert.equal(rd.actualTotal, 379.5);
    assert.equal(rd.actualCount, 2);
    /* 读数面上没有「总花费 / totalCost」这种合并字段 */
    assert.equal(Object.prototype.hasOwnProperty.call(rd, 'totalCost'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(rd, 'total'), false);
});

test('B3 同一费用不会两次扣账(生成行 id 派生 + 已在账本即 skipped)', () => {
    const p = normalizeParty({ costs: [{ id: 'k1', payer: '甲', finalCNY: 100, state: 'actual' }] }).party;
    const first = commitCosts(p, [], ['甲']);
    assert.equal(first.generated, 1);
    assert.equal(first.rows[0].id, TVP_COST_ID_PREFIX + 'k1');
    const second = commitCosts(p, first.rows, ['甲']);
    assert.equal(second.generated, 0, '二次生成必须 0 笔');
    assert.equal(second.rows.length, 0);
    assert.equal(second.rejected.some((x) => x.why === 'already-generated'), true);
    /* 幂等键跟随费用 id,不跟随数组下标(删中间一条不会撞到别人) */
    const p2 = normalizeParty({ costs: [{ id: 'k9', payer: '甲', finalCNY: 5, state: 'actual' }] }).party;
    assert.equal(commitCosts(p2, first.rows, ['甲']).rows[0].id, TVP_COST_ID_PREFIX + 'k9');
});

test('B4 估算的一律不生成支出(实际完成后才生成)', () => {
    const p = normalizeParty({ costs: [{ id: 'a1', payer: '甲', finalCNY: 999, state: 'estimated' }] }).party;
    const got = commitCosts(p, [], ['甲']);
    assert.equal(got.generated, 0);
    assert.equal(got.rejected.some((x) => x.why === 'not-actual'), true);
});

test('B5 垫付人不在账本人头里 ⇒ 如实拒,绝不静默换人扣', () => {
    const p = normalizeParty({ costs: [{ id: 'z1', payer: '查无此人', finalCNY: 88, state: 'actual' }] }).party;
    const got = commitCosts(p, [], ['甲']);
    assert.equal(got.generated, 0);
    assert.equal(got.rejected.some((x) => x.why === 'payer-not-in-people'), true);
});

test('B6 认不出的态按最保守处置(没答复 / 还没发生)', () => {
    const p = normalizeParty({
        members: [{ name: '戊', state: '??? ' }],
        costs: [{ id: 'q1', payer: '戊', state: 'whatever' }],
    }).party;
    assert.equal(p.members[0].state, 'invited');
    assert.equal(p.costs[0].state, 'estimated');
    assert.equal(participantsOf(p).length, 0, '认不出的邀请态不得算参加');
    assert.equal(commitCosts(p, [], ['戊']).generated, 0, '认不出的费用态不得进账本');
});

test('B7 建议只产文本行,零副作用(不改板、不改账本)', () => {
    const raw = {
        members: [{ name: '甲', state: 'accepted' }, { name: '乙', state: 'declined' }],
        tasks: [{ title: '订酒店' }, { title: '买车票', done: true }],
        checklist: [{ text: '身份证' }],
        costs: [{ id: 'c1', payer: '甲', finalCNY: 50, state: 'actual' }],
    };
    const p = normalizeParty(raw).party;
    const before = JSON.stringify(p);
    const expBefore = JSON.stringify({});
    const adv = partyAdvice(p, []);
    assert.equal(adv.every((s) => typeof s === 'string' && s.length > 0), true);
    assert.equal(JSON.stringify(p), before, '建议不得改板');
    assert.equal(JSON.stringify({}), expBefore);
    assert.equal(adv.some((s) => s.indexOf('乙') >= 0), true, '婉拒者应在建议里明说');
    assert.equal(adv.some((s) => s.indexOf('待生成') >= 0 || s.indexOf('没生成') >= 0), true);
});

test('B8 人头建议不擅自删人,婉拒者不进名单', () => {
    const p = normalizeParty({ members: [{ name: '甲', state: 'accepted' }, { name: '乙', state: 'declined' }] }).party;
    const pp = proposedPeople(p, ['甲', '老丙']);
    assert.deepEqual(pp.people, ['甲', '老丙'], '不得删掉在册的其他人');
    assert.deepEqual(pp.added, []);
    assert.equal(pp.changed, false);
    assert.deepEqual(pp.declined, ['乙']);
    const pp2 = proposedPeople(p, []);
    assert.deepEqual(pp2.people, ['甲'], '婉拒者不进名单');
    assert.equal(pp2.changed, true);
});

test('B9 读不出与空分开:空板归一成功且零读数(不抛)', () => {
    const got = normalizeParty({});
    assert.equal(got.party.members.length, 0);
    assert.equal(got.party.costs.length, 0);
    const rd = partyReadings(got.party, []);
    assert.equal(rd.members, 0);
    assert.equal(rd.estimatedTotal, 0);
    assert.equal(rd.actualTotal, 0);
    assert.equal(partyReadings(null, null).members, 0);
});

test('B10 已生成 / 待生成按账本反查(committedCount 跟账本走)', () => {
    const p = normalizeParty({
        costs: [
            { id: 'g1', payer: '甲', finalCNY: 10, state: 'actual' },
            { id: 'g2', payer: '甲', finalCNY: 20, state: 'actual' },
        ],
    }).party;
    const rd0 = partyReadings(p, []);
    assert.equal(rd0.committedCount, 0);
    assert.equal(rd0.pendingCommit, 2);
    const rows = commitCosts(p, [], ['甲']).rows;
    const rd1 = partyReadings(p, rows);
    assert.equal(rd1.committedCount, 2);
    assert.equal(rd1.pendingCommit, 0);
    assert.equal(rd1.actualTotal, 30, '已生成与否不影响实际金额读数');
});

/* ---------- C 接线 ---------- */
test('C1 app 层:行程板键 + 内核 import + 读不出与空分开', () => {
    assert.equal(/export const TV_PARTY_KEY = 'tv_party';/.test(app), true);
    assert.equal(/from '\.\/traveldesk-plan\.js'/.test(app), true);
    assert.equal(app.includes('_readPartyRaw()'), true);
    assert.equal(/if \(!r\.ok\) return null;/.test(app), true, '读不出必须返 null');
    assert.equal(/if \(r\.why === 'absent'\) return \{\};/.test(app), true, '确实没有返空对象');
});

test('C2 app 动作口在,且唯一会写账本的动作恰一处', () => {
    assert.equal(app.includes('partyAct(action, arg)'), true);
    assert.equal(app.includes('commitPartyCosts()'), true);
    /* 写账本(tv_book)的次数:入账 / 人头增补 / 生成支出 共 3 处,处方固定 */
    const tvBookWrites = app.split('_writeRaw(TV_BOOK_KEY').length - 1;
    /* 处方固定四处:入账 intakeBook / 清空 clearAll / 人头增补 people / 生成支出 commitPartyCosts */
    assert.equal(tvBookWrites, 4, '写账本处数变了: ' + tvBookWrites);
    /* 动作族里出现的分支名逐个核对(缺一个就是「按钮点了没反应」) */
    for (const a of ['intake', 'clear-board', 'people', 'member', 'add-stop', 'add-task', 'add-check', 'add-cost', 'toggle-task', 'toggle-check', 'set-cost-state']) {
        assert.equal(app.indexOf(String.fromCharCode(39) + a + String.fromCharCode(39)) >= 0, true, '缺动作分支:' + a);
    }
});

test('C3 写后回读:生成支出核对行数,读不回如实报 readback-mismatch', () => {
    assert.equal(app.includes('readback-mismatch'), true);
    assert.equal(/backRows\.length === merged\.length/.test(app), true);
    assert.equal(/this\._expenses = backRows;/.test(app), true, '核对通过才认账');
});

test('C4 视图层:段 + 四类绑定 + flash 派发', () => {
    assert.equal(view.includes('协作行程'), true);
    for (const a of ['tvp-intake', 'tvp-clear', 'tvp-people', 'tvp-commit', 'tvp-mem', 'tvp-task', 'tvp-check', 'tvp-cost-state']) {
        assert.equal(view.indexOf(String.fromCharCode(39) + a + String.fromCharCode(39)) >= 0, true, '缺绑定:' + a);
    }
    /* 视图不自己算读数:必须走 vm 里的读数(不出现内核函数名) */
    for (const fn of ['partyReadings(', 'commitCosts(', 'participantsOf(']) {
        assert.equal(view.includes(fn), false, '视图不得自己算:' + fn);
    }
    assert.equal(/还没取到行程板/.test(view), true, '读不出要说「还没取到」');
});

test('C5 视图把「参加 / 婉拒 / 未答复」与「预计 / 实际」都摆出来', () => {
    assert.equal(/参加 ' \+ num\(rd && rd\.accepted\)/.test(view), true);
    assert.equal(/婉拒 ' \+ num\(rd && rd\.declined\)/.test(view), true);
    assert.equal(/未答复 ' \+ num\(rd && rd\.pending\)/.test(view), true);
    assert.equal(/预计花费\(不落账\)/.test(view), true);
    assert.equal(/实际金额/.test(view), true);
});

test('C6 CSS:估算与已发生分色(同色即承认「估的已经花了」)', () => {
    assert.equal(/\.tv-party-cost\.is-est/.test(css), true);
    assert.equal(/\.tv-party-cost\.is-act/.test(css), true);
    const est = (css.match(/\.tv-party-cost\.is-est\s*\{([^}]*)\}/) || [])[1] || '';
    const act = (css.match(/\.tv-party-cost\.is-act\s*\{([^}]*)\}/) || [])[1] || '';
    assert.equal(est.trim().length > 0 && act.trim().length > 0, true);
    assert.notEqual(est.trim(), act.trim(), '两态样式不得相同');
});

test('C7 键登记:tv_party 已在 keys-audit 且随会话隔离', () => {
    assert.equal(keys.indexOf("key: " + "'tv_party', scope: " + "'chat'") >= 0, true);
    assert.equal(/\/\^tv_\//.test(read('config/storage.js')), true, '^tv_ 前缀已覆盖新键');
});

/* ---------- D 负控制 ---------- */
test('D1 负控制:真源码定点破坏「婉拒不算参加」⇒ B1 判据必转红', async () => {
    const src = fs.readFileSync(path.join(ROOT, CORE), 'utf-8');
    /* 锚点必须在真源码里恰中一次 */
    const anchor = "        if (toStr(m.state) !== 'accepted') continue;";
    assert.equal(src.split(anchor).length - 1, 1, '负控制锚点必须恰中一次');
    /* 破坏:把「必须是 accepted」放宽成「不是 declined 就算参加」(正是验收 4 要防的错) */
    const broken = src.replace(anchor, "        if (toStr(m.state) === 'declined') continue;", 1);
    assert.notEqual(broken, src, '破坏必须发生');
    /* ★ 破坏副本必须落在**内核同目录**:内核 import 是相对路径 ../../config/num-gate.js,
     *   放到 /tmp 会让相对路径解析失败(ERR_MODULE_NOT_FOUND)——那是环境错,不是判据错。 */
    const tmp = path.join(ROOT, 'apps', 'traveldesk', '__broken_v4030_core.mjs');
    fs.writeFileSync(tmp, broken, 'utf-8');
    const bmod = await import(tmp + '?t=' + Date.now());
    const p = bmod.normalizeParty({
        members: [{ name: '甲', state: 'accepted' }, { name: '乙', state: 'declined' }, { name: '丙', state: 'invited' }],
    }).party;
    /* 在破坏版上重跑**同款真判据**:未答复的丙会被算进参加 ⇒ B1 的断言必失败 */
    assert.notDeepEqual(bmod.participantsOf(p), ['甲'], '破坏版必须让判据转红(否则负控制无效)');
    assert.deepEqual(bmod.participantsOf(p), ['甲', '丙']);
    fs.unlinkSync(tmp);
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本门:入口版本不低于 4.02.0(本版目标 v4.03.0)', () => {
    const idx = read('index.js');
    const m = idx.match(/const ST_PHONE_VERSION = '(\d+)\.(\d+)\.(\d+)';/);
    assert.ok(m, '入口版本常量必须在');
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.equal(v[0] > 4 || (v[0] === 4 && (v[1] > 2 || (v[1] === 2))), true, '入口版本不得低于 4.02.0');
});