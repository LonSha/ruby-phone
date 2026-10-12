/* ========================================================
 * config/search-facets.js — [v3.97.0 · R3-O4] 检索「从字面命中到找对那件事」（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   `apps/memory/global-search-engine.js::scoreHit` 的评分只有三种关系：
 *   标题**全等 / 前缀 / 包含**、正文包含。于是「找上次林安安谈还款」这类
 *   **有筛选意图**的问法只能整串当关键词：用户随手打「上次林安安谈还款」，
 *   引擎拿这 9 个字去比字面 —— 一条都命不中（正文里不会有「上次」这个词）。
 *   用户于是被迫自己拆词、反复试，**找到目标所需的操作数**高得离谱。
 *   这不是索引不够，是**问句没有被理解成一个筛选条件**。
 *
 * 【本模块只做三件事（不做第三套检索）】
 *   ① **问句 → 受控条件**：抽出人名（只从调用方给的 `knownActors` 认原名，
 *      不猜别名、不做模糊匹配 —— 本仓「认不出人名不编」纪律）、时间区间、内容类型；
 *   ② **词序容错与中文别名**：把关键词切成 bigram 集合，命中只要**集合覆盖**
 *      （不必连续、不必同序），故「林安安 还款」与「还款 林安安」等价；
 *   ③ **命中落点**：给出行内**精确位置**（哪一段、第几个字），供上层渲染前后文。
 *
 * 【刻意不做的事（边界，逐条对齐计划原文）】
 *   · **不新建索引、不新建性能守卫**：本模块是纯函数，输入是既有引擎已经检出的行；
 *   · **不重算相关性**：排序仍由既有 `scoreHit` 决定，本模块只做**过滤**与落点；
 *   · **不猜人名**：`knownActors` 缺席或问句里认不出人名时，人名筛选**整条不参与**
 *     （并在 `gaps` 里明说），绝不按一个不存在的人名筛出空结果 ——
 *     「按不存在的人名筛」返回空，会与「这人确实没谈过」同形（本仓最贵的老账）。
 * ======================================================== */
'use strict';

/** 抽不出条件时的空条件（恒定键面；读者不必再判 undefined） */
function emptyFacets(raw) {
    return {
        raw: String(raw == null ? '' : raw),
        keyword: '', person: '', known: false,
        from: null, to: null, kinds: [],
        gaps: [], ok: false
    };
}

/** 内容类型词表（kind → 触发词）。未登记的触发词不进条件（不猜类型）。 */
export const FACET_KINDS = Object.freeze({
    finance: Object.freeze(['花费', '支出', '付款', '花了', '账', '还款', '借款', '转账']),
    calendar: Object.freeze(['约定', '约会', '日程', '见面', '履约', '取消']),
    story: Object.freeze(['剧情', '事件', '发生', '经过']),
    memory: Object.freeze(['记忆', '往事', '之前', '上次', '曾经'])
});

/** 时间意图词（相对区间；只认这些，不猜别的）。 */
export const FACET_TIME_WORDS = Object.freeze({
    '今天': 0, '昨天': 1, '前天': 2, '上周': 7, '上个月': 30, '上月': 30, '最近': 7, '上次': null
});

/** 规范化：去首尾空白、全角空格归一。 */
function norm(s) { return String(s == null ? '' : s).replace(/\u3000/g, ' ').trim(); }

/** 数值取值走**全仓唯一实现**（`config/num-gate.js`）：`Number(null)`/`Number('')`/`Number([])`
 *   都是 0，把它们当「给了 0」与「没给」压成一态正是本仓最贵的假绿形态（W1 门禁点名的那一族）。 */
import { numOrNull } from './num-gate.js';

/** 中文 bigram 集合（长度 1 的词退化为单字集）。**词序无关**正是靠它。 */
export function bigramsOf(s) {
    const t = norm(s).replace(/\s+/g, '');
    const out = [];
    if (!t) return out;
    if (t.length === 1) return [t];
    for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
    return out;
}

/**
 * 词序容错的包含判定：把查询切成 token（空格分隔），每个 token 的 bigram 集合
 * 必须**全部**出现在正文 bigram 集合里（覆盖，而非连续）。
 *
 * 【为什么不直接用 `includes`】`includes` 要求连续同序 ——「还款 林安安」就搜不到
 *   「林安安还没还款」。计划原文点名「中文别名与词序容错」，这是它的可机检形态。
 *
 * @param {string} body 被检文本
 * @param {string} query 查询串
 * @returns {{hit:boolean, covered:number, total:number, missing:string[]}}
 */
export function tokenCoverage(body, query) {
    const q = norm(query);
    const b = norm(body);
    if (!q) return { hit: false, covered: 0, total: 0, missing: [] };
    const bodySet = new Set(bigramsOf(b));
    const tokens = q.split(/\s+/).filter(Boolean);
    let covered = 0;
    let total = 0;
    const missing = [];
    for (const tk of tokens) {
        const grams = bigramsOf(tk);
        total += grams.length;
        let okAll = grams.length > 0;
        for (const g of grams) {
            if (bodySet.has(g)) covered++;
            else { okAll = false; missing.push(g); }
        }
        /* 单 token 全 gram 命中即算这条 token 命中；全部 token 都命中才算整句命中。 */
        if (!okAll) {
            return { hit: false, covered, total, missing: missing.slice(0, 6) };
        }
    }
    return { hit: true, covered, total, missing: [] };
}

/**
 * 从问句抽出受控筛选条件。
 *
 * @param {string} query 用户问句
 * @param {{knownActors?:string[], now?:number}} [opts]
 *   `knownActors` —— **唯一**认人名来源（宿主给的原名清单）。缺席即人名筛选不参与。
 *   `now` —— 相对时间的基准（毫秒）；缺省取当前时刻。显式传入便于判据确定性复跑。
 * @returns 恒定键面（见 emptyFacets）：facet 结果 + gaps 具名「哪一条没抽出、为什么」
 */
export function facetsOf(query, opts) {
    const out = emptyFacets(query);
    const o = opts || {};
    const q = norm(query);
    /* [v3.97.0 · 自抓缺陷] 初版这里有一句 `if (!q) return out;` —— 早返回让空问句落到
     *   `facetsOf('')` 的恒定键面（ok 字段存在但**恒为初始值**），既不说「抽不出条件」，
     *   也不给一条「为什么」。删掉早返回，让末段统一落 `no-condition`：**空问句也要说自己抽不出来**。
     *   下面的循环对空串自然全不命中，故 `kw` 仍为空、条件仍全空。 */
    const actors = Array.isArray(o.knownActors) ? o.knownActors.map(norm).filter(Boolean) : [];
    /* ① 人名：只认原名，**最长优先**（「林安安」先于「林安」）。
     *   认不出 ⇒ 不留人名条件并在 gaps 明说（不猜、不按不存在的人名筛）。 */
    let person = '';
    const sorted = actors.slice().sort((a, b) => b.length - a.length);
    for (const a of sorted) {
        if (a && q.indexOf(a) >= 0) { person = a; break; }
    }
    if (!person && actors.length) {
        out.gaps.push({ kind: 'actor-unrecognized', why: '问句里没认出在场人名 —— **不按人名筛**（按不存在的人名筛出的空，会与「这人确实没谈过」同形）' });
    } else if (!person) {
        out.gaps.push({ kind: 'no-actors', why: '没有可认的人名清单（宿主未提供 knownActors）⇒ 人名筛选整条不参与' });
    }
    out.person = person;
    out.known = !!person;

    /* ② 时间区间：显式 `@起..止`（ISO 日期）或相对词（今天/昨天/上周/上个月…）。 */
    const iso = /@(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?/.exec(q);
    const nowMs = numOrNull(o.now) ?? Date.now();
    if (iso) {
        out.from = iso[1];
        out.to = iso[2] || iso[1];
    } else {
        for (const [word, days] of Object.entries(FACET_TIME_WORDS)) {
            if (q.indexOf(word) < 0) continue;
            if (days === null) {
                /* 「上次」这类：**不设区间**，只当弱提示（区间拿不准就不筛时间 —— 见 gaps）。 */
                out.gaps.push({ kind: 'time-vague', why: '「' + word + '」是相对指代，不给具体区间（不猜时间）' });
                break;
            }
            const from = new Date(nowMs - days * 86400000);
            out.from = isoOf(from);
            out.to = isoOf(new Date(nowMs));
            break;
        }
    }

    /* ③ 内容类型：命中触发词即收 kind；未登记触发词不进条件。 */
    const kinds = [];
    for (const [kind, words] of Object.entries(FACET_KINDS)) {
        if (words.some((w) => q.indexOf(w) >= 0)) kinds.push(kind);
    }
    out.kinds = kinds;

    /* ④ 关键词：去掉已识别的人名与时间/类型提示词，其余当字面关键词（**词序容错**）。 */
    let kw = q;
    if (person) kw = kw.split(person).join(' ');
    for (const words of Object.values(FACET_KINDS)) for (const w of words) kw = kw.split(w).join(' ');
    for (const w of Object.keys(FACET_TIME_WORDS)) kw = kw.split(w).join(' ');
    kw = kw.replace(/@\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?/g, ' ');
    out.keyword = norm(kw).replace(/\s+/g, ' ');

    /* ⑤ 可判性：**至少一条**条件成立才算 ok（否则如实报「没抽出条件」）。
     *   为什么这一格必要：全空条件若当「全通过」，会把「没听懂」显示成「都匹配」。 */
    out.ok = !!(out.keyword || out.person || out.from || out.kinds.length);
    if (!out.ok) out.gaps.push({ kind: 'no-condition', why: '没抽出任何可用条件（不把「没听懂」当「全通过」）' });
    return out;
}

/** 毫秒 → `YYYY-MM-DD`（本地时区；判据用显式 now 保证可复跑）。 */
export function isoOf(d) {
    try {
        const t = (d instanceof Date) ? d : new Date(d);
        if (Number.isNaN(t.getTime())) return null;
        const p = (n) => String(n).padStart(2, '0');
        return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    } catch (_e) { return null; }
}

/** 行的时间取毫秒（`ts` 或 `createdAt`；读不出即 null —— **不给 0**）。 */
function tsOf(row) {
    if (!row || typeof row !== 'object') return null;
    const n = Number(row.ts);
    if (Number.isFinite(n) && n > 0) return n;
    const c = Date.parse(String(row.createdAt || ''));
    return Number.isFinite(c) ? c : null;
}

/**
 * 一行是否满足条件（**逐条各自可达、各自可归因**）。
 *
 * 【为什么不把条件折成一个布尔】「因为人名不符被筛掉」与「因为时间不符被筛掉」
 *   处置完全不同（前者说明认错了人，后者说明时间范围窄了）。折成一个 false
 *   会让用户无从下手 —— 本仓反复治理的形态。
 *
 * @returns {{pass:boolean, reasons:string[]}}
 */
export function matchFacets(row, facets) {
    const f = (facets && typeof facets === 'object') ? facets : emptyFacets('');
    const r = (row && typeof row === 'object') ? row : {};
    const reasons = [];
    const hay = String(r.title || '') + ' ' + String(r.body || '') + ' ' + String(r.snippet || '');
    /* ① 人名：正文或标题里出现过（**不按角色字段筛** —— 记忆行未必带角色字段）。 */
    if (f.person && hay.indexOf(f.person) < 0) reasons.push('person');
    /* ② 关键词：词序容错覆盖（bigram 集合）。 */
    if (f.keyword) {
        const cov = tokenCoverage(hay, f.keyword);
        if (!cov.hit) reasons.push('keyword');
    }
    /* ③ 时间：读不出时间的行**不因时间被筛掉**（不拿 null 当 0 判掉真命中的行）。 */
    if (f.from || f.to) {
        const ts = tsOf(r);
        if (ts !== null) {
            const day = isoOf(new Date(ts));
            if (f.from && day && day < f.from) reasons.push('time');
            if (f.to && day && day > f.to) reasons.push('time');
        }
    }
    return { pass: reasons.length === 0, reasons };
}

/**
 * 在正文里给出行内**精确落点**（前后文 + 命中下标），供渲染「前后文与精确落点」。
 * 未命中时返回 `hit:false` 且 `at:-1`（**不返回 0** —— 0 是合法下标，与「没命中」同形）。
 *
 * @param {string} body
 * @param {string} keyword
 * @param {number} [width] 前文/后文各取多少字
 */
export function locate(body, keyword, width = 24) {
    const b = norm(body);
    const k = norm(keyword);
    if (!b || !k) return { hit: false, at: -1, before: '', match: '', after: '' };
    const at = b.indexOf(k);
    if (at < 0) {
        /* 连续未命中时退回 bigram 覆盖的首个 gram 位置（词序容错路径也要有落点）。 */
        const grams = bigramsOf(k);
        for (const g of grams) {
            const i = b.indexOf(g);
            if (i >= 0) return { hit: true, at: i, before: b.slice(Math.max(0, i - width), i), match: g, after: b.slice(i + g.length, i + g.length + width) };
        }
        return { hit: false, at: -1, before: '', match: '', after: '' };
    }
    return {
        hit: true, at,
        before: b.slice(Math.max(0, at - width), at),
        match: b.slice(at, at + k.length),
        after: b.slice(at + k.length, at + k.length + width)
    };
}

/**
 * 对一组已检出的行应用条件筛选（**不排序** —— 排序仍归既有 `scoreHit`）。
 *
 * @returns {{rows:Array, kept:number, dropped:number, byReason:object, conditions:object}}
 *   `dropped` 与 `byReason` 让「筛掉了多少、为什么」可见（不静默丢弃）。
 */
export function applyFacets(rows, facets) {
    const list = Array.isArray(rows) ? rows : [];
    const byReason = {};
    const kept = [];
    for (const row of list) {
        const m = matchFacets(row, facets);
        if (m.pass) { kept.push(row); continue; }
        for (const why of m.reasons) byReason[why] = (byReason[why] || 0) + 1;
    }
    const f = (facets && typeof facets === 'object') ? facets : emptyFacets('');
    return {
        rows: kept,
        kept: kept.length,
        dropped: list.length - kept.length,
        byReason,
        conditions: {
            keyword: f.keyword || '', person: f.person || '',
            from: f.from || null, to: f.to || null, kinds: Array.isArray(f.kinds) ? f.kinds.slice() : []
        }
    };
}

export default {
    FACET_KINDS,
    FACET_TIME_WORDS,
    bigramsOf,
    tokenCoverage,
    facetsOf,
    matchFacets,
    locate,
    applyFacets,
    isoOf
};