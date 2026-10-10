/* ========================================================
 * config/finance-commit.js — [v3.87.0 · 拓展计划 R-X3 第一切片] 财务与事件的确认提交向导（纯函数）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   config/finance-overview.js（v3.68.0 · X4）已经把七源归一、结算草稿、幂等提交账本建齐了 ——
 *   来源登记表 / 幂等键 / 归一化 / diff / apply 四件都在，**但全仓没有一个写入点**：
 *     · `finance_ledger` 这一格在 config/storage.js 里有前缀（^finance_）、在 keys 台账里有登记、
 *       在 index.js 的咽喉里被**读**出来挂上 `_financeLedgerCache` —— 然后就没有然后了；
 *     · `travelSettlementDraft` 产出的是一份**空壳**：`balances / internal / external` 三个字段
 *       逐字写死为 null（注释说「由调用方填入」），而 `fillSettlementDraft` 全仓零调用。
 *   后果是一族「看起来没坏但显示不对」的错读数：
 *     ① 「建议」与「已发生」在界面上同形 —— 旅行分摊算出来的「谁该转给谁多少」是**建议**，
 *        用户看一眼就以为那笔钱已经转过了（这是本仓最贵的一类财务错读数）；
 *     ② 提交账本永远是空的 ⇒ 诊断页永远报「账本 0 条（提交 0）」—— 那是**假读数**：
 *        不是「没人提交过」，是「根本没有提交这个动作」；
 *     ③ 没有预览这一步 ⇒ 用户点下去之前看不到这笔交易会动谁的余额、动多少；
 *     ④ 写失败没有回读 ⇒ 「调用落了」被当成「钱动了」。
 *
 * 【本模块只做四件事（与 finance-overview / action-center 同范式）】
 *   ① **四态表 `FC_STATES`**：已发生 / 待确认 / 模拟报价 / 结算建议，四态互不同形。
 *      每一态给一个明确处置（报价永不落账、建议需确认、待确认等确认、已发生才是账）。
 *   ② **预览 `previewCommit`**：来源 / 币种 / 参与者 / 重复风险 / 跨币种检查。
 *      **纯读，零写** —— 「预览不修改余额」不是承诺，是这一层根本不碰账本。
 *   ③ **提交计划 `planCommit`**：把「要写什么」算清楚（幂等键已在账本 ⇒ replay，**不重复扣款**），
 *      产出**写意图**而不写 —— 真正的写由心跳里唯一那个 owner 口执行。
 *   ④ **落账与回读 `applyCommitPlan` / `readbackCommit` / `revokeCommit`**：写进去、读回来比、撤回。
 *
 * 【不做什么】
 *   · 不写存储、不取数、不带计时器：纯函数，调用方把账本与草稿传进来。
 *   · **不动任何真实余额**：本模块只维护「本机确认过哪些提交」这一本账；
 *     真实余额永远由各来源自己的 owner（accounting / wallet / piggy…）写。
 *   · 不跨币种求和：不同币种的数字相加没有语义，混合币种一律拒绝求总额。
 *
 * 【四条口径纪律（每条都有判据钉住）】
 *   · **建议 ≠ 已发生**：certainty 为 suggestion 的草稿落账后仍是「本机确认的提交」，
 *     绝不改写成「用户付过钱了」（两件事，且后者只有真实账本能回答）。
 *   · **重复确认不重复扣款**：幂等键 = <source>:<draftId>:<dayKey>，已在账本即 replay。
 *   · **预览不落账**：previewCommit 是纯读函数，返回值里带 willWrite:false。
 *   · **读不到 ≠ 没有**：账本读不出来（不是空数组）与「确实零条提交」必须分得开。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';
import {
    FINANCE_SOURCES,
    FINANCE_LEDGER_LIMIT,
    settlementIdemKey,
    normalizeFinanceLedger,
    normalizeFinanceLedgerEntry,
    applyFinanceLedger,
} from './finance-overview.js';

/* --------- ① 四态表（互不同形，每态一个明确处置） --------- */

/**
 * 提交向导的四态。顺序有意义：越靠前越「硬」（已发生是账，报价永不落账）。
 * key 用于判据与视图匹配；label 用于上屏；text 是该态的处置说明（**不许两态写同一句**）。
 */
export const FC_STATES = Object.freeze({
    settled: Object.freeze({
        key: 'settled', label: '已发生',
        text: '已落账（本机确认过的提交，账本里有这一条）',
    }),
    pending: Object.freeze({
        key: 'pending', label: '待确认',
        text: '等你确认（还没落账，此时撤掉没有任何东西要回滚）',
    }),
    quoted: Object.freeze({
        key: 'quoted', label: '模拟报价',
        text: '试算结果（不落账，也永不落账 —— 报价不是交易）',
    }),
    suggested: Object.freeze({
        key: 'suggested', label: '结算建议',
        text: '建议转账（未获确认；确认后也只是本机记一笔，不代表对方收到钱）',
    }),
});

/** 四态的键集合（判据据此核对「四态确实互不同值」）。 */
export const FC_STATE_KEYS = Object.freeze(Object.keys(FC_STATES));

/** 提交向导的四个动作。 */
export const FC_ACTIONS = Object.freeze({
    preview: Object.freeze({ key: 'preview', label: '预览', writes: false }),
    commit: Object.freeze({ key: 'commit', label: '确认提交', writes: true }),
    revoke: Object.freeze({ key: 'revoke', label: '撤销', writes: true }),
});

/** 提交计划的三种结果（不是所有草稿都能提交）。 */
export const FC_PLANS = Object.freeze({
    fresh: 'fresh',      // 新提交（账本里没有）
    replay: 'replay',    // 已提交过（幂等命中，不重复扣款）
    reject: 'reject',    // 不可提交（附 why）
});

/* --------- ② 来源与 owner --------- */

/** 来源名 → 登记行（只读 FINANCE_SOURCES，不重写一份）。 */
const SOURCE_MAP = Object.freeze(
    Object.fromEntries(FINANCE_SOURCES.map((s) => [s.source, s]))
);

/**
 * 这一笔交易/建议的账本 owner 是谁。
 *   · 有本仓写权的来源（ownerWrite:true）→ 返回它自己；
 *   · 上游写的来源（如 wallet：上游记忆插件写）→ owner 是 '' 并附归因（本机不能代它写）。
 * @returns {{owner:string, writable:boolean, why:string}}
 */
export function fcOwnerOf(source) {
    const reg = SOURCE_MAP[String(source || '')];
    if (!reg) return { owner: '', writable: false, why: 'unknown-source' };
    if (reg.ownerWrite !== true) return { owner: '', writable: false, why: 'owner-is-upstream' };
    return { owner: reg.source, writable: true, why: '' };
}

/* --------- ③ 四态判定 --------- */

/**
 * 判定一条草稿此刻处于哪一态。
 *
 * 判定的两个维：
 *   · kind —— 这份数据本身是什么：'fact' 真实交易 / 'suggestion' 建议 / 'quote' 报价；
 *   · committed —— 幂等键是否已在账本里（只对能落账的 kind 有意义）。
 *
 * 钉死的映射（四态互不同值，判据逐条钉）：
 *   quote            → quoted（报价永不落账，committed 对它没有意义）
 *   suggestion + 未落 → suggested（建议，等你确认）
 *   fact + 未落       → pending（待确认）
 *   (fact|suggestion) + 已落 → settled（已发生）
 *
 * @returns {string} FC_STATES 的键
 */
export function fcStateOf(kind, committed) {
    const k = String(kind || '');
    if (k === 'quote') return 'quoted';
    if (committed === true) return 'settled';
    if (k === 'suggestion') return 'suggested';
    return 'pending';
}

/* --------- ③b 账本键（复用 X4 已登记的那一格，不另开新键） --------- */

/**
 * 提交账本的 storage 键 —— 与 X4 建的那一格**同一个**（`finance_ledger`，
 *   在 config/storage.js 有前缀 ^finance_、在 scripts/keys-audit.mjs 已登记 scope=chat）。
 *   本模块把这一格的**写入口**补上 —— 此前它只被读、从未被写（见文件头【修前实测后果】②）。
 *   写成常量导出，是为了让咽喉与视图都引同一份，不各自写字面量。
 */
export const FINANCE_COMMIT_LEDGER_KEY = 'finance_ledger';

/* --------- ③c 结算草稿（把 traveldesk 的 settle 输出变成一份可提交的草稿） --------- */

/**
 * 把 traveldesk 的 `settle()` 输出（transfers + external）拆成结算行。
 *   · 两族都是 CNY 折算后的金额（finalCNY），故币种固定 'CNY'；
 *   · 每行给一个稳定 id（族 + 起点 + 终点），作为草稿内的行标识（不跨轮）。
 * @param {object} summary —— traveldesk.settle() 的输出
 * @returns {{lines:Array, internalCount:number, externalCount:number, balanced:boolean}}
 */
export function fcSettlementLines(summary) {
    const s = (summary && typeof summary === 'object') ? summary : {};
    const lines = [];
    const transfers = Array.isArray(s.transfers) ? s.transfers : [];
    const external = Array.isArray(s.external) ? s.external : [];
    for (const t of transfers) {
        if (!t || typeof t !== 'object') continue;
        const from = String(t.from || ''); const to = String(t.to || '');
        if (!from || !to) continue;
        lines.push({
            id: 'in:' + from + '>' + to,
            kind: 'internal', from: from, to: to,
            amount: numOrNull(t.amount), currency: 'CNY',
            title: '内部转付：' + from + ' → ' + to,
        });
    }
    for (const e of external) {
        if (!e || typeof e !== 'object') continue;
        const from = String(e.from || ''); const to = String(e.to || '');
        if (!from || !to) continue;
        lines.push({
            id: 'ext:' + from + '>' + to,
            kind: 'external', from: from, to: to,
            amount: numOrNull(e.amount), currency: 'CNY',
            title: '对外结算：' + from + ' → ' + to,
        });
    }
    return {
        lines: lines,
        internalCount: transfers.length,
        externalCount: external.length,
        balanced: s.balanced === true && external.length === 0,
    };
}

/**
 * 从 traveldesk 的 settle 输出构建一份结算提交草稿。
 *
 * kind 固定 'suggestion' —— 旅行分摊算出来的「谁该转给谁多少」是**建议**，
 *   不是已发生的交易。确认之后它也只是「本机记了一笔确认」，**绝不**被改写成
 *   「用户付过钱了」（那只有真实账本能回答）。
 *
 * `draftId` 与 `dayKey` 一起决定幂等键：同一天的同一份结算草稿重复确认不重复扣款；
 *   换一天（dayKey 变）是**另一笔**结算，故次日可以再确认一次（这是有意的）。
 *
 * @param {object} summary —— traveldesk.settle() 输出
 * @param {object} [opts] —— { dayKey, draftId }
 * @returns {object} 可直接交给 previewCommit / planCommit 的草稿
 */
export function fcSettlementDraft(summary, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const built = fcSettlementLines(summary);
    const source = 'traveldesk';
    const dayKey = String(o.dayKey || '');
    const draftId = String(o.draftId || (built.internalCount ? 'internal' : 'external')) + ':' + String(dayKey || '');
    const owner = fcOwnerOf(source);
    return {
        source: source,
        draftId: draftId,
        dayKey: dayKey,
        kind: 'suggestion',
        currency: 'CNY',
        lines: built.lines,
        participants: draftParticipants({}, built.lines),
        internalCount: built.internalCount,
        externalCount: built.externalCount,
        balanced: built.balanced,
        owner: owner.owner,
        ownerWritable: owner.writable,
        note: '旅行分摊结算建议（确认后本机记一笔，不代表对方收到钱）',
    };
}

/* --------- ④ 多币种守卫 --------- */

/**
 * 按币种分组求和 —— **绝不**产出跨币种总额。
 *
 * 为什么单列：混合币种相加是财务面上最容易被写出来、也最没有语义的一个数
 *   （¥3000 与 2000 日元相加得到 5000？那是 5000 什么？）。
 * 故本函数的 `total` 只在**单一币种**时给数，混合时一律 null 并说明归因。
 *
 * @param {Array<{amount:number, currency:string}>} rows
 * @returns {{byCurrency:object, currencies:string[], mixed:boolean, total:number|null, note:string}}
 */
export function fcSumGuard(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const by = {};
    for (const r of list) {
        if (!r || typeof r !== 'object') continue;
        const c = String(r.currency || '');
        if (!c) continue;
        const a = numOrNull(r.amount);
        if (a === null) continue;
        by[c] = Math.round(((by[c] || 0) + a) * 100) / 100;
    }
    const currencies = Object.keys(by).sort();
    const mixed = currencies.length > 1;
    return {
        byCurrency: by,
        currencies: currencies,
        mixed: mixed,
        total: mixed ? null : (currencies.length === 1 ? by[currencies[0]] : 0),
        note: mixed
            ? '混合 ' + String(currencies.length) + ' 种币种，不给总额（相加没有语义）'
            : (currencies.length === 0 ? '没有可求和的金额' : '单一币种 ' + currencies[0]),
    };
}

/* --------- ⑤ 预览（纯读，零写） --------- */

function draftLines(draft) {
    const d = (draft && typeof draft === 'object') ? draft : {};
    if (Array.isArray(d.lines)) return d.lines;
    if (Array.isArray(d.transfers)) return d.transfers;
    if (Array.isArray(d.external)) return d.external;
    return [];
}

function draftParticipants(draft, lines) {
    const d = (draft && typeof draft === 'object') ? draft : {};
    if (Array.isArray(d.participants)) return d.participants.map(String);
    const seen = [];
    for (const l of lines) {
        if (!l || typeof l !== 'object') continue;
        for (const k of ['from', 'to']) {
            const n = String(l[k] || '');
            if (n && seen.indexOf(n) < 0) seen.push(n);
        }
    }
    return seen;
}

function ledgerKeysOf(ledger) {
    const norm = normalizeFinanceLedger(Array.isArray(ledger) ? ledger : []);
    const set = new Set();
    for (const e of norm.entries) if (e.action === 'commit') set.add(e.idemKey);
    return { norm: norm, commitKeys: set };
}

/**
 * 预览一笔提交 —— **纯读，零写**。
 *
 * 给用户看四样：这笔交易从哪来（来源 + 币种）、会动谁（参与者）、有没有重复风险（幂等键）、
 * 以及它现在是什么态（四态之一）。返回值里带 `willWrite:false` —— 预览这一层不碰账本，
 * 故「预览不修改余额」不需要靠承诺，它没有别的可能。
 *
 * @param {object} draft —— { source, draftId, dayKey, kind, currency, participants, lines, note }
 * @param {Array} ledger —— 已有提交账本（或 null=读不到）
 * @returns {object}
 */
export function previewCommit(draft, ledger) {
    const d = (draft && typeof draft === 'object') ? draft : {};
    const source = String(d.source || '');
    const draftId = String(d.draftId || '');
    const dayKey = String(d.dayKey || '');
    const kind = String(d.kind || 'fact');
    const lines = draftLines(d);
    const participants = draftParticipants(d, lines);
    const owner = fcOwnerOf(source);

    const problems = [];
    if (!source) problems.push('missing-source');
    if (!draftId) problems.push('missing-draft-id');
    if (ledger === null || ledger === undefined) problems.push('ledger-not-read');

    const idemKey = (source || draftId) ? settlementIdemKey(source, draftId, dayKey) : '';
    let existing = null;
    let duplicate = false;
    let readOk = (ledger !== null && ledger !== undefined);
    if (readOk && idemKey) {
        const idx = ledgerKeysOf(ledger);
        duplicate = idx.commitKeys.has(idemKey);
        if (duplicate) {
            const hit = idx.norm.entries.filter((e) => e.idemKey === idemKey && e.action === 'commit');
            existing = hit.length ? hit[hit.length - 1] : null;
        }
    }

    /* 结算行的币种分布：一笔结算里可能有多种币种（旅行本就有）。 */
    const amountRows = lines.map((l) => ({
        amount: (l && typeof l === 'object') ? numOrNull(l.amount) : null,
        currency: (l && typeof l === 'object') ? String(l.currency || d.currency || 'CNY') : '',
    }));
    const sum = fcSumGuard(amountRows);

    const state = fcStateOf(kind, duplicate);

    return {
        ok: problems.indexOf('missing-source') < 0 && problems.indexOf('missing-draft-id') < 0,
        willWrite: false,
        source: source,
        sourceLabel: (SOURCE_MAP[source] && SOURCE_MAP[source].label) || '',
        draftId: draftId,
        dayKey: dayKey,
        kind: kind,
        idemKey: idemKey,
        state: state,
        stateLabel: FC_STATES[state].label,
        stateText: FC_STATES[state].text,
        owner: owner.owner,
        ownerWritable: owner.writable,
        ownerWhy: owner.why,
        participants: participants,
        lineCount: lines.length,
        currencies: sum.currencies,
        amountByCurrency: sum.byCurrency,
        mixedCurrency: sum.mixed,
        amountTotal: sum.total,
        amountNote: sum.note,
        duplicate: { isDuplicate: duplicate, existing: existing },
        ledgerRead: readOk,
        problems: problems,
    };
}

/* --------- ⑥ 提交计划（算清楚要写什么，但不写） --------- */

/**
 * 把一笔草稿算成一个提交计划。**产出写意图，不写。**
 *
 * 三种结果：
 *   · fresh   —— 账本里没有 ⇒ 给一条待写条目；
 *   · replay  —— 账本里已有同幂等键 ⇒ **不重复扣款**，如愿回报（这不是错误，是幂等生效）；
 *   · reject  —— 不可提交，附可读 why（报价永不落账 / owner 是上游 / 缺键 / 余额相符无需提交）。
 *
 * @param {object} draft
 * @param {Array} ledger
 * @param {object} [opts] —— { at, amountCents, note }
 * @returns {{plan:string, why:string, idemKey:string, entry:object|null, preview:object}}
 */
export function planCommit(draft, ledger, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const pv = previewCommit(draft, ledger);

    const base = { plan: FC_PLANS.reject, why: '', idemKey: pv.idemKey, entry: null, preview: pv };

    if (!pv.idemKey) return Object.assign({}, base, { why: 'no-idem-key' });
    if (pv.kind === 'quote') return Object.assign({}, base, { why: 'quote-never-commits' });
    if (!pv.ownerWritable) return Object.assign({}, base, { why: pv.ownerWhy || 'owner-not-writable' });
    if (pv.duplicate.isDuplicate) return Object.assign({}, base, { plan: FC_PLANS.replay, why: 'already-committed' });

    const d = (draft && typeof draft === 'object') ? draft : {};
    const entry = normalizeFinanceLedgerEntry({
        idemKey: pv.idemKey,
        source: pv.source,
        draftId: pv.draftId,
        dayKey: pv.dayKey,
        owner: pv.owner,
        action: 'commit',
        at: (typeof o.at === 'number' && Number.isFinite(o.at)) ? o.at : 0,
        amountCents: (typeof o.amountCents === 'number' && Number.isFinite(o.amountCents))
            ? o.amountCents
            : Math.round((numOrNull(d.amountCents) || 0)),
        note: String(o.note || d.note || ''),
    });
    if (!entry) return Object.assign({}, base, { why: 'entry-not-normalizable' });

    return Object.assign({}, base, { plan: FC_PLANS.fresh, why: '', entry: entry });
}

/* --------- ⑦ 落账 / 回读 / 撤销 --------- */

/**
 * 把提交计划落进账本。**纯函数：返回新账本，不改入参、不碰 storage。**
 * 真实写由咽喉里唯一那个 owner 口执行（它拿到这里的 entries 再去写）。
 * @returns {{ok:boolean, why:string, entries:Array, count:number, dropped:number}}
 */
export function applyCommitPlan(ledger, plan) {
    const p = (plan && typeof plan === 'object') ? plan : {};
    const prev = Array.isArray(ledger) ? ledger : [];
    if (p.plan === FC_PLANS.replay) {
        const n = normalizeFinanceLedger(prev);
        return { ok: true, why: 'replay-noop', entries: n.entries, count: n.entries.length, dropped: n.dropped };
    }
    if (p.plan !== FC_PLANS.fresh || !p.entry) {
        const n = normalizeFinanceLedger(prev);
        return { ok: false, why: p.why || 'nothing-to-write', entries: n.entries, count: n.entries.length, dropped: n.dropped };
    }
    const next = applyFinanceLedger(prev, [p.entry], []);
    return { ok: true, why: '', entries: next.entries, count: next.count, dropped: next.dropped };
}

/**
 * 写后回读比对：写下去的那一份与读回来的那一份是不是同一份。
 *
 * 【相位止于 confirmed，不叫 durable】回读一致**不证明**字节进了宿主存储
 *   （写落盘可能在防抖之后）。与 config/write-receipt.js 的 writeConfirmed 同口径，
 *   此处只做「同一份」比对，不自己发明一把更硬的词。
 * @returns {{confirmed:boolean, phase:string, why:string, gotCount:number, sawKey:boolean}}
 */
export function readbackCommit(plan, gotLedger) {
    const p = (plan && typeof plan === 'object') ? plan : {};
    if (gotLedger === null || gotLedger === undefined) {
        return { confirmed: false, phase: 'not_confirmed', why: 'read-backed-nothing', gotCount: 0, sawKey: false };
    }
    const n = normalizeFinanceLedger(Array.isArray(gotLedger) ? gotLedger : []);
    if (p.plan === FC_PLANS.replay) {
        return { confirmed: true, phase: 'confirmed', why: 'replay-already-there', gotCount: n.entries.length, sawKey: true };
    }
    const key = String(p.idemKey || '');
    const saw = key ? n.entries.some((e) => e.idemKey === key && e.action === 'commit') : false;
    return {
        confirmed: saw,
        phase: saw ? 'confirmed' : 'not_confirmed',
        why: saw ? '' : 'written-key-not-in-readback',
        gotCount: n.entries.length,
        sawKey: saw,
    };
}

/**
 * 撤销一条已提交。**纯函数：返回新账本。**
 *   · 账本里没有这一条 ⇒ 如实拒绝（不假装撤掉了）；
 *   · 撤的是**本机的那一笔确认**，不是任何真实余额 —— 真实余额只能由 owner 自己回滚。
 * @returns {{ok:boolean, why:string, entries:Array, count:number, dropped:number}}
 */
export function revokeCommit(ledger, idemKey) {
    const key = String(idemKey || '');
    const prev = Array.isArray(ledger) ? ledger : [];
    if (!key) { const n = normalizeFinanceLedger(prev); return { ok: false, why: 'no-idem-key', entries: n.entries, count: n.entries.length, dropped: n.dropped }; }
    const has = normalizeFinanceLedger(prev).entries.some((e) => e.idemKey === key && e.action === 'commit');
    if (!has) { const n = normalizeFinanceLedger(prev); return { ok: false, why: 'no-such-commit', entries: n.entries, count: n.entries.length, dropped: n.dropped }; }
    const next = applyFinanceLedger(prev, [], [key]);
    return { ok: true, why: '', entries: next.entries, count: next.count, dropped: next.dropped };
}

/* --------- ⑧ 一行读数（三态不同形） --------- */

/**
 * 财务提交账本的一行读数。三态互不同形：
 *   · 账本读不到（不是空数组）→ 说「读不到」并说明这不是「没有提交」；
 *   · 读到且零条 → 说「本机还没有确认过任何提交」；
 *   · 读到有 N 条 → 报总数 + 提交/撤回分列 + 上限。
 * @param {Array|null} ledger
 * @param {object} [counts] —— 可选的外部计数（如各态分布）
 */
export function fcSummaryLine(ledger, counts) {
    if (ledger === null || ledger === undefined) {
        return '财务提交：读不到（这一轮还没取数）—— 这不是「本机没有提交记录」';
    }
    const n = normalizeFinanceLedger(Array.isArray(ledger) ? ledger : []);
    if (!n.entries.length) return '财务提交：本机还没有确认过任何提交';
    let committed = 0;
    for (const e of n.entries) if (e.action === 'commit') committed++;
    const c = (counts && typeof counts === 'object') ? counts : {};
    const statePart = (typeof c.settled === 'number' || typeof c.pending === 'number')
        ? '；态分布 已发生 ' + String(c.settled || 0) + ' · 待确认 ' + String(c.pending || 0)
            + ' · 报价 ' + String(c.quoted || 0) + ' · 建议 ' + String(c.suggested || 0)
        : '';
    return '财务提交：' + String(n.entries.length) + ' 条（提交 ' + String(committed)
        + ' / 上限 ' + String(FINANCE_LEDGER_LIMIT) + '）' + statePart + '。';
}

/* --------- ⑨ 自检（真 + 假两侧都跑） --------- */

/**
 * 自检：四态互不同值、幂等、预览不写、多币种不求和、报价拒落账。
 * 每一条都**真 + 假两侧都跑**（只测真侧等于没测——判据只会说「是」）。
 * @returns {{problems:Array<string>}}
 */
export function financeCommitSelfCheck() {
    const problems = [];

    /* ① 四态互不同值：四态的 key 与 label 与 text 都不许两两相同。 */
    const seenKey = new Set(); const seenLabel = new Set(); const seenText = new Set();
    for (const k of FC_STATE_KEYS) {
        const s = FC_STATES[k];
        if (seenKey.has(s.key)) problems.push('四态 key 重复: ' + s.key);
        if (seenLabel.has(s.label)) problems.push('四态 label 重复: ' + s.label);
        if (seenText.has(s.text)) problems.push('四态 text 重复: ' + s.text);
        seenKey.add(s.key); seenLabel.add(s.label); seenText.add(s.text);
    }
    if (FC_STATE_KEYS.length !== 4) problems.push('四态应为 4，实际 ' + FC_STATE_KEYS.length);

    /* ② 态判定：真 + 假两侧。 */
    if (fcStateOf('quote', true) !== 'quoted') problems.push('报价即使是已落账也必须判 quoted');
    if (fcStateOf('quote', false) !== 'quoted') problems.push('报价未落账判 quoted');
    if (fcStateOf('suggestion', false) !== 'suggested') problems.push('建议未落账判 suggested');
    if (fcStateOf('fact', false) !== 'pending') problems.push('真实交易未落账判 pending');
    if (fcStateOf('fact', true) !== 'settled') problems.push('真实交易已落账判 settled');
    if (fcStateOf('suggestion', true) !== 'settled') problems.push('建议已落账判 settled');

    /* ③ 多币种守卫：混合不给总额，单一给总额。 */
    const mixed = fcSumGuard([{ amount: 3000, currency: 'CNY' }, { amount: 2000, currency: 'JPY' }]);
    if (mixed.mixed !== true) problems.push('混合币种应判 mixed');
    if (mixed.total !== null) problems.push('混合币种不许给总额，实际 ' + String(mixed.total));
    const single = fcSumGuard([{ amount: 100, currency: 'CNY' }, { amount: 200, currency: 'CNY' }]);
    if (single.mixed !== false) problems.push('单一币种不应判 mixed');
    if (single.total !== 300) problems.push('单一币种总额应为 300，实际 ' + String(single.total));

    /* ④ 预览不写：返回值里 willWrite 必须为 false。 */
    const pv = previewCommit({ source: 'traveldesk', draftId: 'd1', dayKey: 'k', kind: 'suggestion' }, []);
    if (pv.willWrite !== false) problems.push('预览必须声明 willWrite:false');

    /* ⑤ 报价拒落账；建议可落账；重复 ⇒ replay 且不重复扣款。 */
    const qPlan = planCommit({ source: 'traveldesk', draftId: 'q1', dayKey: 'k', kind: 'quote' }, []);
    if (qPlan.plan !== FC_PLANS.reject || qPlan.why !== 'quote-never-commits') problems.push('报价必须拒绝落账');
    const sPlan = planCommit({ source: 'traveldesk', draftId: 's1', dayKey: 'k', kind: 'suggestion' }, []);
    if (sPlan.plan !== FC_PLANS.fresh) problems.push('建议应可落账，实际 ' + sPlan.plan);
    const after = applyCommitPlan([], sPlan);
    if (after.count !== 1) problems.push('落账后应 1 条，实际 ' + after.count);
    const again = planCommit({ source: 'traveldesk', draftId: 's1', dayKey: 'k', kind: 'suggestion' }, after.entries);
    if (again.plan !== FC_PLANS.replay) problems.push('同草稿再提交应 replay，实际 ' + again.plan);
    const after2 = applyCommitPlan(after.entries, again);
    if (after2.count !== 1) problems.push('replay 后账本仍应 1 条（不重复扣款），实际 ' + after2.count);

    /* ⑥ 上游写的来源不可代它写（wallet）。 */
    const wPlan = planCommit({ source: 'wallet', draftId: 'w1', dayKey: 'k', kind: 'fact' }, []);
    if (wPlan.plan !== FC_PLANS.reject || wPlan.why !== 'owner-is-upstream') problems.push('上游 owner 的来源必须拒绝代写');

    /* ⑦ 回读：写下去了读得回来 → confirmed；读不回来 → not_confirmed。 */
    const rbOk = readbackCommit(sPlan, after.entries);
    if (rbOk.confirmed !== true) problems.push('写后回读应 confirmed');
    const rbBad = readbackCommit(sPlan, []);
    if (rbBad.confirmed !== false) problems.push('回读不到应 not_confirmed');

    /* ⑧ 撤销：有这一条才撤得掉；撤后是真没了。 */
    const revOk = revokeCommit(after.entries, sPlan.idemKey);
    if (revOk.ok !== true || revOk.count !== 0) problems.push('撤销应成功且清空');
    const revBad = revokeCommit(after.entries, 'no:such:key');
    if (revBad.ok !== false) problems.push('撤不存在的提交应如实拒绝');

    /* ⑨ 一行读数的三态必须不同形。 */
    const t1 = fcSummaryLine(null);
    const t2 = fcSummaryLine([]);
    const t3 = fcSummaryLine(after.entries);
    if (t1 === t2 || t2 === t3 || t1 === t3) problems.push('提交读数的三态不许同形');

    return { problems: problems };
}

/* --------- ⑩ 导出清单 --------- */

export default {
    FC_STATES,
    FINANCE_COMMIT_LEDGER_KEY,
    fcSettlementLines,
    fcSettlementDraft,
    FC_STATE_KEYS,
    FC_ACTIONS,
    FC_PLANS,
    fcOwnerOf,
    fcStateOf,
    fcSumGuard,
    previewCommit,
    planCommit,
    applyCommitPlan,
    readbackCommit,
    revokeCommit,
    fcSummaryLine,
    financeCommitSelfCheck,
};
