// tests/system-v3250.test.mjs — 存钱罐 App：钱只认一处的账（纯函数内核 + 四处接线）[v3.25.0]
//
//   本版接的是素材缝合路线图 L1 波 1 的第一件：把 EPhone·xINOVO 的 piggy_bank.js
//   （1135 行 · 余额 / 收支流水 / 亲属卡额度周期）缝成 RubyPhone 的一个 App。
//
//   缝合**不是搬运**。源里有两块本仓不能有的东西，本套件守的就是「它们没被搬进来」：
//     ① **扣款仲裁**：源 `executeCharacterPurchase` 会改 chat 消息、写 character.walletLedger
//        并做整单回滚 —— 而本仓**用户钱包的仲裁源只有微信零钱一处**
//        (`WechatData.getWalletBalance` / `spendWalletBalance`，catbox 与 honey 都从它扣)。
//        同一笔钱有两个记账者，就是本仓最贵的形态：不报错、只错数据。
//        ⇒ 存钱罐是**另一笔钱**，它与零钱互不扣款。B2 守这条。
//     ② **全局 db + saveData**：源把状态挂在全局 `db.piggyBank` 上。本仓没有 db，
//        一切落盘走 PhoneStorage 且键必须进会话隔离表。C1 守这条。
//
//   本套件守三类会**静默失效**的形态（都不报错、不崩溃，只是数不对）：
//     A 纯函数内核：金额口径（分整数）/ 余额与流水的**双向一致** / 额度周期的**追赶** /
//       投影不编数 / 归因三态 / 注入只给事实；
//     B 接线：四处注册齐备、不与零钱争（先剥注释再判）、样式源与 phone.css 逐字同源、换会话只重取读数；
//     C 键归属：两条新键在门禁账本里且 scope=chat。
//
//   负控制纪律（本仓统一口径）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url
//   （副本在 /tmp 下，那条路径必然解析不到 —— 会造出与破坏无关的假红）；
//   副本按**真目录结构**建（`<tmp>/apps/piggy/piggy-data.js` + `<tmp>/config/num-gate.js`），
//   否则 `../../config/num-gate.js` 会解析到 `/config/num-gate.js`（差两级，首跑即
//   ERR_MODULE_NOT_FOUND）；判据函数仍只吃**数据对象**，不吃模块内部实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    PIGGY_REASONS, PIGGY_REFRESH_PERIODS, DEFAULT_PIGGY_BALANCE_CENTS, DEFAULT_PIGGY_SETTINGS,
    defaultPiggySettings, normalizePiggySettings, yuanToCents, formatMoney,
    normalizePiggyState, applyTransaction, removeTransactions, createFamilyCard,
    refreshFamilyCards, projectPiggy, readPiggyFace, piggyPromptBlock,
} from '../apps/piggy/piggy-data.js';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_REL = 'apps/piggy/piggy-data.js';
const DATA_SRC = fs.readFileSync(path.join(ROOT, DATA_REL), 'utf8');
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
/**
 * 剥注释（字符状态机，与 v3200 / v3201 同款）。
 * ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」（E6 / v299 A4 / v3190 A4 /
 *   v3200 D1 同一口径）。B2 首跑就是被 `piggy-app.js` 文件头那句「为什么罐不接微信零钱
 *   （`spendWalletBalance`）」撞红的 —— 那是**说明**，不是**消费**。
 *   判据必须自己实现一遍：不许用被审对象自己的实现来审它自己。
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

const DAY = 24 * 60 * 60 * 1000;
/**
 * 固定「现在」：额度周期是日历逻辑，判据必须与真实时钟解耦。
 *
 * ★ 时间口径（A4 首跑的一条假红换来的）：数据层**不持有时钟** ——
 *   `normalizeTransaction` 在 `tx.time` 缺省时把它落成 **0**（即 1970-01），
 *   真实时刻由调用方传入（App 层 `addTransaction` 传的就是 `Date.now()`）。
 *   所以凡是要判「本月」的用例，夹具必须**显式把 time 传进来**：初版没传，
 *   那笔流水的月键是 1970-01，`monthExpenseCents` 必然读成 0。
 *   这不是产品缺陷（把时钟塞进纯函数才是缺陷），是判据少写了一个入参。
 */
const NOW = new Date('2026-09-30T12:00:00').getTime();

const emptyPot = () => ({ balanceCents: 100000, transactions: [], cards: [], schemaVersion: 2 });

/* ── 判据本体（纯函数，可对真模块或破坏副本跑） ── */

/** ① 金额口径：元 → 分强口径；非法一律拒绝，**不落成 0 分**。 */
function amountProblems(api) {
    const bad = [];
    if (api.yuanToCents('12.34') !== 1234) bad.push('yuanToCents-decimal');
    if (api.yuanToCents(20) !== 2000) bad.push('yuanToCents-int');
    if (api.yuanToCents('') !== null) bad.push('yuanToCents-empty');
    if (api.yuanToCents(null) !== null) bad.push('yuanToCents-null');
    if (api.yuanToCents(undefined) !== null) bad.push('yuanToCents-undefined');
    if (api.yuanToCents('abc') !== null) bad.push('yuanToCents-nan');
    /* 0 分是**非法金额**：一条金额为 0 的流水没有任何信息，却会把条数与本月支出算歪。 */
    if (api.applyTransaction(emptyPot(), { amountCents: 0, kind: 'expense' }) !== null) bad.push('accept-zero');
    if (api.applyTransaction(emptyPot(), { amountCents: 'abc', kind: 'expense' }) !== null) bad.push('accept-nan');
    /* 对照面：合法金额必须真记上（防上面几条把闸关成「谁都记不上」）。 */
    const ok = api.applyTransaction(emptyPot(), { amountCents: 500, kind: 'expense' });
    if (!ok || ok.state.balanceCents !== 99500) bad.push('legal-rejected');
    return bad;
}

/** ② 余额与流水**双向一致**：记一笔再删它，状态必须逐字段回到原值。 */
function roundTripProblems(api) {
    const bad = [];
    const base = emptyPot();
    const in1 = api.applyTransaction(base, { id: 't_in', amountCents: 5000, kind: 'income', remark: '收入' });
    if (!in1 || in1.state.balanceCents !== 105000) { bad.push('income-not-applied'); return bad; }
    const out1 = api.applyTransaction(in1.state, { id: 't_out', amountCents: 3000, kind: 'expense', remark: '支出' });
    if (!out1 || out1.state.balanceCents !== 102000) { bad.push('expense-not-applied'); return bad; }
    const del1 = api.removeTransactions(out1.state, ['t_out']);
    if (del1.removed !== 1) bad.push('removed-count:' + del1.removed);
    if (del1.removed === 1 && del1.state.balanceCents !== 105000) bad.push('expense-not-refunded:' + del1.state.balanceCents);
    const del2 = api.removeTransactions(del1.state, ['t_in']);
    if (del2.removed !== 1) bad.push('removed-count2:' + del2.removed);
    if (del2.removed === 1 && del2.state.balanceCents !== 100000) bad.push('income-not-reversed:' + del2.state.balanceCents);
    if (del2.removed === 1 && del2.state.transactions.length !== 0) bad.push('tx-not-emptied:' + del2.state.transactions.length);
    /* 幂等：删一个不存在的 id 不得改动余额。 */
    const del3 = api.removeTransactions(del2.state, ['nope']);
    if (del3.removed !== 0) bad.push('phantom-removed:' + del3.removed);
    if (del3.state.balanceCents !== del2.state.balanceCents) bad.push('phantom-changed-balance');
    return bad;
}

/** ③ 额度周期：到期清零 + 顺延；**离线多期必须一次追到当下**。 */
function refreshProblems(api) {
    const bad = [];
    const card = api.createFamilyCard({ limitCents: 500000, targetCharName: '某人', refreshPeriod: 'monthly' }, NOW);
    if (card.status !== 'active') bad.push('target-card-not-active');
    const draft = api.createFamilyCard({ limitCents: 500000 }, NOW);
    if (draft.status !== 'draft') bad.push('no-target-card-not-draft');
    /* 一张 active 卡，已过 1 期：必须清零并顺延到「下一个到期的未来时刻」。 */
    const once = api.refreshFamilyCards({
        balanceCents: 0, transactions: [], schemaVersion: 2,
        cards: [{ ...card, usedAmountCents: 12345, nextRefreshTime: NOW - DAY }],
    }, NOW);
    if (once.refreshed !== 1) bad.push('not-refreshed:' + once.refreshed);
    if (once.state.cards[0].usedAmountCents !== 0) bad.push('used-not-cleared:' + once.state.cards[0].usedAmountCents);
    if (!(once.state.cards[0].nextRefreshTime > NOW)) bad.push('not-advanced:' + once.state.cards[0].nextRefreshTime);
    /* ★ 追赶：离线三期（每期都恰好过期）必须一次追到 > NOW，而不是只翻一期。 */
    const far = api.refreshFamilyCards({
        balanceCents: 0, transactions: [], schemaVersion: 2,
        cards: [{ ...card, usedAmountCents: 999, nextRefreshTime: NOW - 100 * DAY }],
    }, NOW);
    if (far.refreshed !== 1) bad.push('catchup-not-refreshed:' + far.refreshed);
    if (!(far.state.cards[0].nextRefreshTime > NOW)) bad.push('catchup-fell-short:' + (far.state.cards[0].nextRefreshTime - NOW));
    /* draft 卡不计期（还没给人用）。 */
    const skip = api.refreshFamilyCards({
        balanceCents: 0, transactions: [], schemaVersion: 2,
        cards: [{ ...draft, nextRefreshTime: NOW - DAY }],
    }, NOW);
    if (skip.refreshed !== 0) bad.push('draft-refreshed:' + skip.refreshed);
    return bad;
}

/** ④ 投影不编数：没有历史时 latest 必须是 null，不是「0 元的那一笔」。 */
function projectionProblems(api) {
    const bad = [];
    const fresh = api.projectPiggy(emptyPot(), NOW);
    if (fresh.latest !== null) bad.push('latest-invented:' + JSON.stringify(fresh.latest));
    if (fresh.hasHistory !== false) bad.push('hasHistory-true');
    if (fresh.txCount !== 0) bad.push('txCount:' + fresh.txCount);
    if (fresh.balanceCents !== 100000) bad.push('balance:' + fresh.balanceCents);
    /* 显式传 time：数据层不持有时钟（缺省落 0）—— 见上方 NOW 的口径说明。 */
    const one = api.applyTransaction(emptyPot(), {
        id: 'x', amountCents: 250, kind: 'expense', remark: '买菜', time: NOW,
    });
    const proj = api.projectPiggy(one.state, NOW);
    if (!proj.latest || proj.latest.remark !== '买菜') bad.push('latest-missing');
    if (proj.expenseCents !== 250 || proj.incomeCents !== 0 || proj.netCents !== -250) {
        bad.push('totals:' + [proj.incomeCents, proj.expenseCents, proj.netCents].join(','));
    }
    if (proj.monthExpenseCents !== 250) bad.push('month-expense:' + proj.monthExpenseCents);
    if (proj.hasHistory !== true) bad.push('hasHistory-false');
    return bad;
}

/** ⑤ 归因三态：先判能不能读，再判读到了什么。 */
function faceProblems(api) {
    const bad = [];
    const R = api.PIGGY_REASONS;
    if (R.storage_absent !== 'storage-absent') bad.push('reason-form:' + R.storage_absent);
    if (R.empty !== 'empty' || R.ready !== 'ready') bad.push('reason-names');
    if (api.readPiggyFace({ storageOk: false, hasState: true }) !== R.storage_absent) bad.push('absent-not-first');
    if (api.readPiggyFace({ storageOk: true, hasState: false }) !== R.empty) bad.push('empty');
    if (api.readPiggyFace({ storageOk: true, hasState: true }) !== R.ready) bad.push('ready');
    if (api.readPiggyFace(null) !== R.storage_absent) bad.push('null-probe');
    return bad;
}

/** ⑥ 注入块只给**事实**，且开关真生效。 */
function promptProblems(api) {
    const bad = [];
    const proj = api.projectPiggy(emptyPot(), NOW);
    if (api.piggyPromptBlock(proj, { ...DEFAULT_PIGGY_SETTINGS, injectToPrompt: false }) !== '') bad.push('off-not-empty');
    const on = api.piggyPromptBlock(proj, { ...DEFAULT_PIGGY_SETTINGS, injectToPrompt: true, maxInjectTx: 0 });
    if (!on.includes('【余额】')) bad.push('no-balance');
    if (on.includes('【最近一笔】')) bad.push('maxInjectTx-ignored');
    if (api.piggyPromptBlock(null, DEFAULT_PIGGY_SETTINGS) !== '') bad.push('null-proj');
    const withCard = api.projectPiggy({
        balanceCents: 100000, transactions: [], schemaVersion: 2,
        cards: [api.createFamilyCard({ limitCents: 500000, targetCharName: '某人' }, NOW)],
    }, NOW);
    const blk = api.piggyPromptBlock(withCard, DEFAULT_PIGGY_SETTINGS);
    if (!blk.includes('【亲属卡】')) bad.push('no-card-line');
    if (withCard.activeCardCount !== 1 || withCard.cardLimitCents !== 500000) bad.push('card-projection');
    return bad;
}

/* ══════════ A ── 纯函数内核 ══════════ */
test('A1 金额口径：元 → 分强口径，非法金额一律拒绝（不落成 0 分）', () => {
    const api = { yuanToCents, applyTransaction };
    const bad = amountProblems(api);
    assert.deepEqual(bad, [], '金额口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(DEFAULT_PIGGY_BALANCE_CENTS, 52000, '默认余额（源 ensurePiggyBankState 同值）');
    assert.equal(formatMoney(52000), '520', '整数金额显示不带小数');
    assert.equal(formatMoney(1234), '12.34', '非整数金额显示两位');
});

test('A2 余额与流水双向一致：记一笔再删它必须回到原值（幂等：删不存在的 id 不动账）', () => {
    const bad = roundTripProblems({ applyTransaction, removeTransactions });
    assert.deepEqual(bad, [], '账必须双向一致，实测问题：' + bad.join(' , '));
});

test('A3 亲属卡额度周期：到期清零顺延，离线多期必须一次追到当下，草稿卡不计期', () => {
    const bad = refreshProblems({ createFamilyCard, refreshFamilyCards });
    assert.deepEqual(bad, [], '额度周期必须与设计一致，实测问题：' + bad.join(' , '));
    assert.deepEqual([...PIGGY_REFRESH_PERIODS], ['daily', 'weekly', 'monthly', 'custom'], '周期取值必须与源一致');
});

test('A4 投影不编数：没有历史时 latest 为 null（不是「0 元的那一笔」）', () => {
    const bad = projectionProblems({ projectPiggy, applyTransaction });
    assert.deepEqual(bad, [], '投影口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('A5 归因三态：先判能不能读，再判读到了什么（值的形态是连字符形）', () => {
    const bad = faceProblems({ PIGGY_REASONS, readPiggyFace });
    assert.deepEqual(bad, [], '归因必须与设计一致，实测问题：' + bad.join(' , '));
    /* 视图文案表的键必须取这里的**值**（连字符形），不另写一套下划线形 —— 否则查不到会静默走兜底。 */
    const view = read('apps/piggy/piggy-view.js');
    assert.ok(view.includes('[PIGGY_REASONS.'), '视图文案表必须由归因常量计算键');
    assert.equal(view.includes('storage_absent:'), false, '视图不得另写一套下划线形键');
    assert.ok(read(DATA_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

test('A6 注入块只给事实：开关真生效、maxInjectTx 真被尊重、读不到就不产块', () => {
    const bad = promptProblems({ projectPiggy, createFamilyCard, piggyPromptBlock });
    assert.deepEqual(bad, [], '注入口径必须与设计一致，实测问题：' + bad.join(' , '));
});

/* ══════════ B ── 接线（四处注册 + 不与零钱争 + 样式 + 换会话） ══════════ */
test('B1 四处注册齐备：APPS / 懒加载分支 / REBIND 表 / 会话键前缀', () => {
    const idx = read('index.js');
    const apps = read('config/apps.js');
    const storage = read('config/storage.js');
    assert.ok(apps.includes("id: 'piggy'"), 'config/apps.js 必须登记 id: piggy');
    assert.ok(idx.includes("appId === 'piggy'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/piggy/piggy-app.js')"), '分支必须指向真实路径');
    assert.match(idx, /window\.VirtualPhone\.piggyApp\s*=\s*new\s+module\.PiggyApp\(/, '必须构造单例');
    const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(/'piggyApp'/.test(tbl), 'REBIND 表必须含 piggyApp（换会话重取）');
    assert.ok(/\/\^piggy_\//.test(storage), '会话隔离表必须有 /^piggy_/ 前缀');
});

test('B2 钱只认一处账：扣款口必须真不在代码里，而界面文案必须真说给用户（先剥注释再判）', () => {
    const S = (rel) => stripComments(read(rel));
    /* ① 代码里不得出现零钱扣款口。★ 先剥注释：文件头那段「为什么罐不接微信零钱
     *    （`spendWalletBalance`）」是**说明**不是**消费**（本仓 E6 口径）。 */
    for (const [tag, rel] of [['app', 'apps/piggy/piggy-app.js'],
        ['data', DATA_REL], ['view', 'apps/piggy/piggy-view.js']]) {
        const src = S(rel);
        for (const bad of ['spendWalletBalance', 'updateWalletBalance', 'resetWalletBalance',
            'WechatData', 'getWalletBalance']) {
            assert.equal(src.includes(bad), false, tag + ' 不得出现零钱扣款口：' + bad);
        }
    }
    /* ② 也不得改 chat 消息 / 碰角色会话数据（源 executeCharacterPurchase 的行为）。 */
    const appCode = S('apps/piggy/piggy-app.js');
    for (const bad of ['setChatMessages', 'saveChat', 'chatMetadata', 'walletLedger']) {
        assert.equal(appCode.includes(bad), false, 'App 不得改会话数据：' + bad);
    }
    /* ③ 反向面：界面文案必须把「两笔钱互不干涉」说给用户听 —— 它是**给用户的字符串**，
     *    所以剥注释后仍须命中（若只写在注释里，这一条就会红）。 */
    assert.ok(S('apps/piggy/piggy-view.js').includes('零钱'), '界面必须明说与零钱的关系');
    /* ④ 两向自证：剥注释必须真的剥掉了东西，否则 ① 的「不出现」可能只是剥函数坏了。 */
    const rawApp = read('apps/piggy/piggy-app.js');
    assert.ok(rawApp.includes('spendWalletBalance'),
        '对照：原文里确有该串（在注释里）—— 否则说明剥注释根本没起作用，① 是假绿');
});

test('B3 样式族真在 phone.css 里：源与产物逐字同源 + 视图产出的类名都有样式落点', () => {
    const phone = read('phone.css');
    const piggy = read('apps/piggy/piggy.css');
    const view = read('apps/piggy/piggy-view.js');
    const at = phone.indexOf('/* ---------- [v3.25.0]');
    assert.ok(at >= 0, 'phone.css 必须带本版段注释（打包口）');
    /* ★ [v3.26.0 交棒] 段尾按**下一个段头**截断，不取文件尾：phone.css 是追加式产物，
     *   后版本往后接段时，取到文件尾会把别人的段并进来 ⇒ 本条会以「逐字同源失败」假红
     *   （红的原因不是样式漂移，是取段口径没跟上传送带）。找不到下一个段头才取到文件尾。 */
    const rest = phone.slice(at);
    const nxt = rest.indexOf('/* ---------- [', 1);
    const seg = (nxt >= 0 ? rest.slice(0, nxt) : rest).trim();
    const norm = (x) => x.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
    /* ★ 源 vs 产物**逐字同源**：本仓样式投递走「打包进 phone.css」，两份手抄必然漂移；
     *   这一条同时把「机制 A 的类前缀族能被 registry 门找到」锚在真内容上。 */
    assert.equal(norm(seg), norm(piggy),
        'phone.css 的本版段必须与 apps/piggy/piggy.css 逐字同源');
    const count = (seg.match(/[.]pg-/g) || []).length;
    assert.ok(count >= 5, '本版段必须真的带样式，实测 .pg- ' + count + ' 次');
    /* 每个产出的类名都要有**样式落点**：自己有条规则 / 是 JS 选择器锚点 /
     * 是显式声明的「继承型语义 hook」（继承来源本身也要被检查）。
     * 首跑报的三个「无规则」类名里，两个是选择器锚点（样式由兄弟类 .pg-mini 提供），
     * 一个是纯语义 hook（字号配色从 .pg-face 继承）—— **改判据，不改产品**。 */
    const cssNames = new Set(seg.match(/[.]pg-[a-z0-9-]+/g) || []);
    const js = view + read('apps/piggy/piggy-app.js');
    const anchors = new Set();
    for (const m of js.matchAll(/querySelector(?:All)?[(]\s*['"]?[.]([a-z0-9-]+)/g)) anchors.add(m[1]);
    for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
    const inheritHooks = new Map([['pg-face-label', '.pg-face']]);
    const produced = new Set();
    for (const m of view.matchAll(/class=["']([^"']+)/g)) {
        for (const tok of m[1].split(/\s+/)) {
            if (tok.startsWith('pg-') && !tok.endsWith('-')) produced.add(tok);
        }
    }
    const missing = [...produced].filter((n) =>
        !cssNames.has('.' + n) && !anchors.has(n) && !inheritHooks.has(n));
    assert.deepEqual(missing, [], '这些类名既无样式规则也不是已知锚点：' + missing.join(' , '));
    /* 豁免自证（防名单变成空口豁免）：声明的锚点必须真被 JS 当选择器用；
     * 声明的继承 hook 必须真有那个父规则。 */
    for (const h of ['pg-del', 'pg-card-del']) {
        assert.ok(anchors.has(h), h + ' 必须真被 JS 当选择器用（否则它只是没样式的死类名）');
    }
    for (const [hook, parent] of inheritHooks) {
        assert.ok(cssNames.has(parent), hook + ' 声明继承自 ' + parent + '，该规则必须存在');
    }
});

test('B4 换会话只重取读数：onChatChanged 走 probe，且不持跨轮副本', () => {
    const app = read('apps/piggy/piggy-app.js');
    const m = app.match(/onChatChanged\(\)\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, 'onChatChanged 必须存在（REBIND 表要调它）');
    assert.ok(m[1].includes('this.probe()'), '换会话必须重取读数');
    assert.ok(m[1].includes('_loadSettings'), '换会话必须重取设置');
    /* 幂等哨兵：宿主钩子只挂一次（与 focus/accounting 同纪律）。 */
    assert.ok(app.includes('if (this._hookBound) return;'), '宿主钩子必须有幂等哨兵');
    assert.ok(app.includes('this._hookBound = true;'), '哨兵必须真被置位');
});

/* ══════════ C ── 键归属 ══════════ */
test('C1 两条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const app = read('apps/piggy/piggy-app.js');
    /* 键名从产品代码里取（不手抄），再要求账本里有它。 */
    const hits = [...app.matchAll(/'(piggy_[a-z_]+)'/g)].map((mm) => mm[1]);
    const uniq = [...new Set(hits)];
    assert.equal(uniq.length, 2, '必须恰好两条键（settings / state），实测 ' + uniq.join(','));
    for (const key of uniq) {
        const reg = new RegExp("\\{ key: '" + key + "', scope: '(chat|global|legacy)'");
        assert.ok(reg.test(audit), '键 ' + key + ' 必须在 KEY_REGISTRY 登记并声明 scope');
    }
    /* 两条键必须同为 chat 域：一个罐的状态与设置不该一个跟会话走、一个不跟。 */
    for (const key of uniq) {
        const reg = new RegExp("\\{ key: '" + key + "', scope: 'chat'");
        assert.ok(reg.test(audit), '键 ' + key + ' 必须是会话隔离（scope: chat）');
    }
});

/* ══════════ D ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════ */
function loadDamagedCopy(splitFrom, splitTo) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_piggy_'));
    /* ★ 副本必须按**真目录结构**建：piggy-data.js 里写的是 `../../config/num-gate.js`，
     *   若把副本摊在 <tmp> 根下，那条相对路径会解析成 `/config/num-gate.js`（差两级，
     *   首跑即 ERR_MODULE_NOT_FOUND —— 与破坏本身无关的假红）。 */
    const target = path.join(dir, 'apps', 'piggy', 'piggy-data.js');
    const hits = DATA_SRC.split(splitFrom).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + splitFrom.slice(0, 70));
    const damaged = DATA_SRC.split(splitFrom).join(splitTo);
    assert.notEqual(damaged, DATA_SRC, '破坏必须真的发生');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    /* 副本同目录补一份 num-gate 桩（真模块零依赖叶子，口径与真件一致）。 */
    const gateDir = path.join(dir, 'config');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'num-gate.js'),
        'export function numOrNull(v) {\n' +
        "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n" +
        "    if (typeof v === 'string' && !v.trim()) return null;\n" +
        '    const n = Number(v);\n' +
        '    return Number.isFinite(n) ? n : null;\n' +
        '}\n');
    /* [v3.84.0 · R-O8] 副本里也要有 num-clamp 的**真件字节副本**（被加载模块现在从它取有界取数）。 */
    fs.copyFileSync(new URL('../config/num-clamp.js', import.meta.url), path.join(gateDir, 'num-clamp.js'));
    return import(pathToFileURL(target).href);
}

test('D1 破坏「删一笔必须反向调回」⇒ A2 同款判据必须转红', async () => {
    const mod = await loadDamagedCopy(
        "delta += (t.kind === 'income' ? -t.amountCents : t.amountCents);",
        "delta += (t.kind === 'income' ? t.amountCents : t.amountCents);"
    );
    const bad = roundTripProblems({ applyTransaction: mod.applyTransaction, removeTransactions: mod.removeTransactions });
    assert.ok(bad.some((x) => x.startsWith('income-not-reversed') || x.startsWith('expense-not-refunded')),
        '反向调回被破坏后必须报出余额不对，实测：' + bad.join(' , '));
    assert.deepEqual(roundTripProblems({ applyTransaction, removeTransactions }), [], '对照：真实现必须往返一致');
});

test('D2 破坏追赶循环（只翻一期）⇒ A3 同款判据必须转红', async () => {
    const mod = await loadDamagedCopy(
        '        do {\n            next = getNextRefreshTime(next, c.refreshPeriod, c.refreshDays);\n            guard += 1;\n        } while (next <= nowMs && guard < PIGGY_MAX_CATCHUP);',
        '        do {\n            next = getNextRefreshTime(next, c.refreshPeriod, c.refreshDays);\n            guard += 1;\n        } while (false);'
    );
    const bad = refreshProblems({ createFamilyCard: mod.createFamilyCard, refreshFamilyCards: mod.refreshFamilyCards });
    assert.ok(bad.some((x) => x.startsWith('catchup-fell-short')),
        '只翻一期时离线多期必须追不到当下，实测：' + bad.join(' , '));
    assert.deepEqual(refreshProblems({ createFamilyCard, refreshFamilyCards }), [], '对照：真实现必须追得上');
});

test('D3 破坏金额闸（允许 0 分流水）⇒ A1 同款判据必须转红', async () => {
    const mod = await loadDamagedCopy(
        '    if (cents <= 0) return null;',
        '    if (cents < 0) return null;'
    );
    const bad = amountProblems({ yuanToCents: mod.yuanToCents, applyTransaction: mod.applyTransaction });
    assert.ok(bad.includes('accept-zero'), '闸被放宽后 0 分流水必须被接住，实测：' + bad.join(' , '));
    assert.deepEqual(amountProblems({ yuanToCents, applyTransaction }), [], '对照：真实现必须拒绝 0 分');
});

test('D4 破坏索引上限（把下界抬到 2000）⇒ 新判据必须转红（对照：真实现落在 20）', async () => {
    const mod = await loadDamagedCopy(
        '        maxTransactions: boundedInt(o.maxTransactions, d.maxTransactions, 20, 5000),',
        '        maxTransactions: boundedInt(o.maxTransactions, d.maxTransactions, 2000, 5000),'
    );
    const mine = mod.normalizePiggySettings({ maxTransactions: 5 });
    assert.equal(mine.maxTransactions, 2000, '下界被抬到 2000 后，小值必须被抬到 2000');
    assert.equal(normalizePiggySettings({ maxTransactions: 5 }).maxTransactions, 20, '对照：真实现的下界是 20');
    assert.equal(defaultPiggySettings().maxTransactions, DEFAULT_PIGGY_SETTINGS.maxTransactions, '默认设置必须与常量同源');
    assert.equal(normalizePiggySettings(null).injectToPrompt, true, '读不到时如实回落默认（而不是关掉注入）');
});

/* ══════════ G ── 判据工具自证（负控制的**下段**：工具坏了也必须有人知道） ══════════ */
test('G1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：B2 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，B2 只会**更绿** —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「假绿」族（对原文件断言 / 破坏写死成常量 / 判据自我指涉之外的第四形：
     *   工具被削成空闸）。故必须两向自证。 */
    const raw = '// 注释里写 spendWalletBalance\n'
        + 'const a = "spendWalletBalance";\n'
        + '/* 块注释 spendWalletBalance */\n'
        + 'const b = 1;';
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"spendWalletBalance"'),
        '字符串字面量必须留住（剥器不得把字符串里的同形文本一起吃掉）');
    assert.equal(stripped.includes('// 注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.equal(stripped.includes('const b = 1;'), true, '普通代码必须原样留下');
    /* 对照：真产品文件上剥注释必须真的变短 —— 否则 B2 是空闸。 */
    const rawApp = read('apps/piggy/piggy-app.js');
    assert.ok(rawApp.length > stripComments(rawApp).length,
        '真产品文件上剥注释必须真的变短（否则剥器根本没在工作）');
});

test('G2 负控制的替换必须保真：字面 split/join 之后旧锚点归零、新串恰一次', () => {
    const pairs = [
        ["delta += (t.kind === 'income' ? -t.amountCents : t.amountCents);",
         "delta += (t.kind === 'income' ? t.amountCents : t.amountCents);"],
        ['    if (cents <= 0) return null;', '    if (cents < 0) return null;'],
        ['        maxTransactions: boundedInt(o.maxTransactions, d.maxTransactions, 20, 5000),',
         '        maxTransactions: boundedInt(o.maxTransactions, d.maxTransactions, 2000, 5000),'],
    ];
    for (const [a, b] of pairs) {
        assert.equal(DATA_SRC.split(a).length - 1, 1, '真源码里旧锚点必须恰 1 次：' + a.slice(0, 46));
        const out = DATA_SRC.split(a).join(b);
        assert.notEqual(out, DATA_SRC, '替换必须真的发生');
        assert.equal(out.split(a).length - 1, 0, '替换后旧锚点必须归零');
        assert.ok(out.includes(b), '替换后新串必须在场');
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace：替换串里一旦出现 `$`，
     *   `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形、负控制失去
     *   判别力。下面这条把「为什么」钉成可复现的事实。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（下限形）+ 三源同源', () => {
    const manV = JSON.parse(read('manifest.json')).version;
    const pkgV = JSON.parse(read('package.json')).version;
    const src = read('index.js');
    const parts = manV.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 25),
        '本套件成立于 RubyPhone 3.25.0 及以后，当前 ' + manV);
    assert.equal(pkgV, manV, 'package.json 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + manV + "';"), '入口版本常量必须与 manifest 同版');
});
