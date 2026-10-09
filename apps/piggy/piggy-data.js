/* ========================================================
 * piggy-data.js — [v3.25.0] 存钱罐 App 纯函数内核
 *
 * 缝合自 EPhone·xINOVO（js/modules/piggy_bank.js，1135 行）的**本地储值模型**：
 *   存钱罐余额 + 收支流水 + 亲属卡（额度 / 周期刷新）。
 *
 * 【缝什么、不缝什么 —— 三处「源有本仓不能有」】
 *   ① 持久化：源把状态挂在全局 `db.piggyBank` 上并 `await saveData()` 落 IndexedDB。
 *      本仓没有 db / saveData —— 全书改走 PhoneStorage（键前缀 `piggy_`），
 *      且本文件保持**纯函数**：状态进、状态出，落盘由 App 层负责。
 *   ② 扣款仲裁：源里 `executeCharacterPurchase` 会改 chat 消息、写
 *      `character.walletLedger`、并做「订单失败整体回滚」（dbSnapshot 还原）。
 *      本仓**用户钱包的仲裁源是微信零钱**（`WechatData.getWalletBalance` /
 *      `spendWalletBalance`，catbox 与 honey 都从它扣钱）。
 *      故本件**不与微信争**：存钱罐记的是「用户自己攒的另一笔钱」，
 *      两者互不扣款、互不继承。本件零写微信数据、零发消息、零碰角色会话。
 *   ③ 封面图：源支持上传 2MB 封面（FileReader → dataURL）并写进卡面样式。
 *      本仓不引入外链 / 不落大体积二进制（L0 素材另有其口），故卡面只用色块。
 *
 * 【从源里取的两块规则（本件真正的存量价值）】
 *   · 流水与余额的**双向一致**：加一条要动余额，**删一条要反向调回**
 *     （源 `deletePiggyTransactions` 逐条反向加减）——单向记账是本仓
 *     「看起来没坏但显示不对」的典型形态，故这里把它做成纯函数并带往返判据。
 *   · 亲属卡的**周期刷新**：额度到期清零并顺延，且用
 *     `do { next = 下一期 } while (next <= now)` 一次性**追赶**到当下 ——
 *     用户离线三个月再打开时，额度要追到当月而不是只翻一期。
 *
 * 【与源的偏离（有意识的，逐条写明）】
 *   1. 金额一律以**分**整数存（源是元浮点 `Math.round(v*100)/100`）。
 *      理由与本仓 accounting 同款：浮点累加会出现 0.1+0.2 类读数。
 *      对照面：源 `formatMoney` 的显示口径原样保留（整数不带小数、否则两位）。
 *   2. 亲属卡只保留「用户发出的卡」这一半（源另有 `receivedFamilyCards`）。
 *      源那半的家务是「角色发卡给用户 → 用户消费 → 扣角色账」，
 *      扣的正是第 ② 条里本仓不能有的那套仲裁；本件不缝它。
 *   3. 追赶循环加 `PIGGY_MAX_CATCHUP` 上限（源没有）。理由是防畸形数据把
 *      主线程挂死；正常数据（每期至少 +1 天）永远到不了这个上限，
 *      故它只在「数据已坏」时生效 —— 坏数据宁可少追几期，不可锁死界面。
 *
 * 本文件零依赖叶子模块（只引 num-gate），无副作用、不碰 DOM、不碰 window。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';
import { boundedInt } from '../../config/num-clamp.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（与 focus-data 同纪律）。 */
export const PIGGY_REASONS = Object.freeze({
    ready: 'ready',                     // 有存钱罐数据
    empty: 'empty',                     // 存储可用，但这个会话还没开过罐
    storage_absent: 'storage-absent',   // 存储不可用（宿主没给或取数抛错）
});

/** 额度刷新周期。源 `getPeriodMs` 的四个取值，`custom` 走 refreshDays。 */
export const PIGGY_REFRESH_PERIODS = Object.freeze(['daily', 'weekly', 'monthly', 'custom']);

/** 源 `ensurePiggyBankState` 的默认余额（520 元）。新会话「开罐」时的起点。 */
export const DEFAULT_PIGGY_BALANCE_CENTS = 52000;

/** 内部数据形状版本（源同值 `Math.max(2, ...)`）。不导出：App 不需要，导出即为死面。 */
const SCHEMA_VERSION = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
/** 追赶上限（见文件头「与源的偏离」第 3 条）。 */
const PIGGY_MAX_CATCHUP = 4000;
/** 亲属卡用户名下卡面配色（源 FAMILY_CARD_COLORS 原样）。 */
const CARD_COLORS = Object.freeze(['#1a1a2e', '#16213e', '#0f3460', '#2d132c', '#1b262c', '#2c3e50']);

export const DEFAULT_PIGGY_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectTx: 4,
    maxTransactions: 500,
});

/** 全新一份默认设置（冻结，防被就地改）。 */
export function defaultPiggySettings() {
    return Object.freeze({ ...DEFAULT_PIGGY_SETTINGS });
}

/** 设置规范化：外部数据一律先过这里（读不出就如实回落默认，不把 NaN 混进运行时）。 */
export function normalizePiggySettings(raw) {
    const d = DEFAULT_PIGGY_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectTx: boundedInt(o.maxInjectTx, d.maxInjectTx, 0, 40),
        maxTransactions: boundedInt(o.maxTransactions, d.maxTransactions, 20, 5000),
    });
}

/** 元 → 分（强口径）。「没给」如实 null，**不落成 0 分**（0 分是合法金额）。 */
export function yuanToCents(v) {
    const n = numOrNull(v);
    return n === null ? null : Math.round(n * 100);
}

/** 分 → 显示串。源 `formatMoney` 口径原样：整数不带小数，否则两位。 */
export function formatMoney(cents) {
    const c = numOrNull(cents);
    const n = (c === null ? 0 : c) / 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** 本地月键（YYYY-MM）。用本地时区切月，与 focus-data.dayKey 同族（那里切天）。 */
function monthKeyOf(ts) {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    const m = d.getMonth() + 1;
    return d.getFullYear() + '-' + (m < 10 ? ('0' + m) : String(m));
}

/** 一条流水。金额非法（非数 / 0 / 负）即判无效返回 null，由调用方丢弃。 */
function normalizeTransaction(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const amountCents = numOrNull(o.amountCents);
    if (amountCents === null) return null;
    const cents = Math.abs(Math.round(amountCents));
    if (cents <= 0) return null;
    const t = numOrNull(o.time);
    const time = t === null ? 0 : Math.round(t);
    return {
        id: (typeof o.id === 'string' && o.id)
            ? o.id
            : ('pg_' + time + '_' + Math.random().toString(36).slice(2, 8)),
        kind: o.kind === 'expense' ? 'expense' : 'income',
        amountCents: cents,
        remark: String(o.remark || '').trim() || (o.kind === 'expense' ? '支出' : '收入'),
        source: String(o.source || '用户').trim() || '用户',
        time,
    };
}

/** 期长（毫秒）。源 `getPeriodMs` 原样。 */
function getPeriodMs(period, customDays) {
    if (period === 'daily') return DAY_MS;
    if (period === 'weekly') return 7 * DAY_MS;
    if (period === 'monthly') return 30 * DAY_MS;
    const d = numOrNull(customDays);
    if (period === 'custom' && d !== null && d > 0) return d * DAY_MS;
    return 30 * DAY_MS;
}

/**
 * 下一期刷新时刻。源 `getNextFamilyCardRefreshTime` 原样：
 *   `monthly` 走**日历月**而不是 30 天（并把日号钳到目标月的最后一天，
 *   故 1 月 31 日 + 1 期 = 2 月 28/29 日，不会溢出成 3 月 3 日）。
 */
function getNextRefreshTime(fromTime, period, customDays) {
    if (period === 'monthly') {
        const next = new Date(fromTime);
        if (!Number.isFinite(next.getTime())) return fromTime + getPeriodMs(period, customDays);
        const originalDay = next.getDate();
        next.setDate(1);
        next.setMonth(next.getMonth() + 1);
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(originalDay, lastDay));
        return next.getTime();
    }
    return fromTime + getPeriodMs(period, customDays);
}

/** 一张亲属卡（用户发出的那份）。 */
function normalizeFamilyCard(raw, now) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const limitRaw = numOrNull(o.limitCents);
    if (limitRaw === null) return null;
    const limitCents = Math.max(1, Math.round(limitRaw));
    const period = PIGGY_REFRESH_PERIODS.includes(o.refreshPeriod) ? o.refreshPeriod : 'monthly';
    const refreshDays = boundedInt(o.refreshDays, 30, 1, 3650);
    const cTime = numOrNull(o.createdTime);
    const createdTime = cTime === null ? now : Math.round(cTime);
    const used = numOrNull(o.usedAmountCents);
    const nextRaw = numOrNull(o.nextRefreshTime);
    const lastRaw = numOrNull(o.lastRefreshTime);
    const num4 = String(o.cardNumber || '');
    const txs = Array.isArray(o.transactions)
        ? o.transactions.map(normalizeTransaction).filter(Boolean)
        : [];
    return {
        id: (typeof o.id === 'string' && o.id)
            ? o.id
            : ('fc_' + createdTime + '_' + Math.random().toString(36).slice(2, 8)),
        bankName: String(o.bankName || '').trim() || '亲属卡',
        cardNumber: /^[0-9]{4}$/.test(num4) ? num4 : String(Math.floor(1000 + Math.random() * 9000)),
        cardHolder: String(o.cardHolder || '').trim(),
        cardColor: CARD_COLORS.includes(o.cardColor) ? o.cardColor : CARD_COLORS[0],
        targetCharName: String(o.targetCharName || '').trim(),
        limitCents,
        /* 已用额度不得越界：上限是额度，下限是 0（源同义：usedAmount 只增不清，除刷新） */
        usedAmountCents: Math.max(0, Math.min(limitCents, used === null ? 0 : Math.round(used))),
        refreshPeriod: period,
        refreshDays,
        lastRefreshTime: lastRaw === null ? createdTime : Math.round(lastRaw),
        nextRefreshTime: nextRaw === null
            ? getNextRefreshTime(createdTime, period, refreshDays)
            : Math.round(nextRaw),
        status: o.status === 'active' ? 'active' : 'draft',
        createdTime,
        transactions: txs,
    };
}

/**
 * 整罐状态规范化。源 `ensurePiggyBankState` 的对应物：
 *   缺字段就补、类型不对就回默认、余额钳在 ≥ 0。
 * 形状：`{ balanceCents, transactions[], cards[], schemaVersion }`。
 */
export function normalizePiggyState(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const now = Date.now();
    const bal = numOrNull(o.balanceCents);
    const txs = Array.isArray(o.transactions)
        ? o.transactions.map(normalizeTransaction).filter(Boolean)
        : [];
    const cards = Array.isArray(o.cards)
        ? o.cards.map((c) => normalizeFamilyCard(c, now)).filter(Boolean)
        : [];
    return {
        balanceCents: Math.max(0, bal === null ? DEFAULT_PIGGY_BALANCE_CENTS : Math.round(bal)),
        transactions: txs,
        cards,
        schemaVersion: SCHEMA_VERSION,
    };
}

/**
 * 记一笔（纯函数）。返回 `{ state, record }`；金额非法返回 null。
 * **双向一致**在此处一次写清：收入加余额、支出减余额，余额钳 ≥ 0。
 */
export function applyTransaction(state, tx) {
    const rec = normalizeTransaction(tx);
    if (!rec) return null;
    const base = normalizePiggyState(state);
    const delta = rec.kind === 'income' ? rec.amountCents : -rec.amountCents;
    return {
        state: {
            ...base,
            balanceCents: Math.max(0, base.balanceCents + delta),
            transactions: [rec, ...base.transactions],
        },
        record: rec,
    };
}

/**
 * 按 id 删多条流水，并**反向**调整余额（源 `deletePiggyTransactions` 的语义）。
 * 返回 `{ state, removed }`；removed 是实际删掉的条数（源也返回这个数）。
 * 注意方向：删掉一条**收入**要把余额减回去，删掉一条**支出**要把余额加回来。
 */
export function removeTransactions(state, ids) {
    const base = normalizePiggyState(state);
    const idSet = new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string'));
    if (!idSet.size) return { state: base, removed: 0 };
    let delta = 0;
    let removed = 0;
    const kept = [];
    for (const t of base.transactions) {
        if (idSet.has(t.id)) {
            delta += (t.kind === 'income' ? -t.amountCents : t.amountCents);
            removed += 1;
        } else {
            kept.push(t);
        }
    }
    return {
        state: { ...base, transactions: kept, balanceCents: Math.max(0, base.balanceCents + delta) },
        removed,
    };
}

/**
 * 开一张亲属卡（源 `createFamilyCard` 全字段）。
 * status 语义：给了 targetCharName ⇒ 'active'（在给某人用），否则 'draft'（还在草稿）。
 */
export function createFamilyCard(opts, now) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const limitRaw = numOrNull(o.limitCents);
    const limitCents = Math.max(1, limitRaw === null ? 500000 : Math.round(limitRaw));
    const period = PIGGY_REFRESH_PERIODS.includes(o.refreshPeriod) ? o.refreshPeriod : 'monthly';
    const refreshDays = boundedInt(o.refreshDays, 30, 1, 3650);
    const target = String(o.targetCharName || '').trim();
    return {
        id: 'fc_' + nowMs + '_' + Math.random().toString(36).slice(2, 8),
        bankName: String(o.bankName || '').trim() || '亲属卡',
        cardNumber: String(Math.floor(1000 + Math.random() * 9000)),
        cardHolder: String(o.cardHolder || '').trim(),
        cardColor: CARD_COLORS.includes(o.cardColor)
            ? o.cardColor
            : CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)],
        targetCharName: target,
        limitCents,
        usedAmountCents: 0,
        refreshPeriod: period,
        refreshDays,
        lastRefreshTime: nowMs,
        nextRefreshTime: getNextRefreshTime(nowMs, period, refreshDays),
        status: target ? 'active' : 'draft',
        createdTime: nowMs,
        transactions: [],
    };
}

/**
 * 额度周期刷新（源 `refreshFamilyCardLimits` 的语义）。
 * 返回 `{ state, refreshed }`：refreshed 是这一轮真正刷过的卡数（0 = 没到期的）。
 * 只有 active 卡参与；draft 卡还没给人用，不计期。
 */
export function refreshFamilyCards(state, now) {
    const base = normalizePiggyState(state);
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    let refreshed = 0;
    const cards = base.cards.map((c) => {
        if (c.status !== 'active') return c;
        if (!(c.nextRefreshTime > 0) || nowMs < c.nextRefreshTime) return c;
        let next = c.nextRefreshTime;
        let guard = 0;
        do {
            next = getNextRefreshTime(next, c.refreshPeriod, c.refreshDays);
            guard += 1;
        } while (next <= nowMs && guard < PIGGY_MAX_CATCHUP);
        refreshed += 1;
        return { ...c, usedAmountCents: 0, lastRefreshTime: nowMs, nextRefreshTime: next };
    });
    return { state: { ...base, cards }, refreshed };
}

/**
 * 投影（读数）。读不到就如实给 0 / null，**不编数**
 * （没有历史时 latest 给 null，而不是拿 0 冒充「最近一笔是 0 元」）。
 */
export function projectPiggy(state, now) {
    const base = normalizePiggyState(state);
    const t = numOrNull(now);
    const nowMs = t === null ? Date.now() : Math.round(t);
    const mk = monthKeyOf(nowMs);
    let income = 0;
    let expense = 0;
    let monthIncome = 0;
    let monthExpense = 0;
    for (const x of base.transactions) {
        const isIn = x.kind === 'income';
        if (isIn) income += x.amountCents; else expense += x.amountCents;
        if (monthKeyOf(x.time) === mk) {
            if (isIn) monthIncome += x.amountCents; else monthExpense += x.amountCents;
        }
    }
    const active = base.cards.filter((c) => c.status === 'active');
    let limit = 0;
    let used = 0;
    for (const c of active) { limit += c.limitCents; used += c.usedAmountCents; }
    return {
        balanceCents: base.balanceCents,
        incomeCents: income,
        expenseCents: expense,
        netCents: income - expense,
        monthIncomeCents: monthIncome,
        monthExpenseCents: monthExpense,
        txCount: base.transactions.length,
        latest: base.transactions.length ? base.transactions[0] : null,
        cardCount: base.cards.length,
        activeCardCount: active.length,
        cardLimitCents: limit,
        cardUsedCents: used,
        hasHistory: base.transactions.length > 0,
    };
}

/** 归因（storage 探针 → 三态）。先判能不能读，再判读到了什么（与 focus 同纪律）。 */
export function readPiggyFace(probe) {
    if (!probe || probe.storageOk === false) return PIGGY_REASONS.storage_absent;
    if (probe.hasState !== true) return PIGGY_REASONS.empty;
    return PIGGY_REASONS.ready;
}

/**
 * 生成侧注入块。只给**事实**（余额 / 本月收支 / 最近一笔 / 亲属卡），
 * 不给角色台词模板 —— 让模型自己决定要不要接话。
 */
export function piggyPromptBlock(proj, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj) return '';
    const parts = ['【余额】' + formatMoney(proj.balanceCents) + ' 元'];
    if (proj.monthIncomeCents !== 0 || proj.monthExpenseCents !== 0) {
        parts.push('【本月】收入 ' + formatMoney(proj.monthIncomeCents) + ' · 支出 ' + formatMoney(proj.monthExpenseCents) + ' 元');
    }
    const showTx = settings.maxInjectTx !== 0;
    if (showTx && proj.latest) {
        const sign = proj.latest.kind === 'expense' ? '-' : '+';
        parts.push('【最近一笔】' + proj.latest.remark + ' ' + sign + formatMoney(proj.latest.amountCents) + ' 元');
    }
    if (proj.activeCardCount > 0) {
        parts.push('【亲属卡】' + proj.activeCardCount + ' 张使用中 · 已用 '
            + formatMoney(proj.cardUsedCents) + '/' + formatMoney(proj.cardLimitCents) + ' 元');
    }
    return '【系统·存钱罐】\n' + parts.join('\n');
}
