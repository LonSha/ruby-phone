/* ========================================================
 * config/spotlight-face-bridge.js — [v4.99.5 · R11-X5] 全局检索面（Spotlight）桥接层
 *
 * 【这一件存在的理由（修前实测）】`config/spotlight-universal-search.js` 是一个
 *   带域清单（SEARCH_DOMAINS 四域）、带倒排索引、还带快捷意图语法（「发微信:Alice:明天见」
 *   「转账:Bob:200」「便签:开会」）的**完整搜索内核**，但**产品端零 import** ——
 *   全仓实测：`SpotlightUniversalSearch` 只出现在 orchestrator（第 146 行 new 出来
 *   之后没人调）与 tests/ 一处，`apps/` 下零命中。
 *   ⇒ 用户一次也没见过这个内核；它写好的域清单与意图语法都停在模块里。
 *
 * 【本件只做两件事：纯映射 + 四域覆盖三态。取数与落盘都不在这里。】
 *   · 纯函数：(输入) => 输出。本件不含 storage、不写任何键、不 new 任何实例；
 *   · 真源仍是各 App 既有的落盘键（search-app 侧灌进内核），本件只把内核的输出
 *     映射成**可渲染 + 可派发**的形状。
 *
 * 【三态不同形（与 X1 / X2 / X6 同款纪律；X5 计划原文点名）】
 *   · 某个域有数据、但本关键词在该域零命中 → 「该域没有匹配」（域内正常空）；
 *   · 某个域**这次根本没索引到东西** → 「该域暂无数据」；
 *   · 整块**读不到**（宿主没装配 spotlight / 读抛错）→ 「全局检索没接上」
 *     且明写**这不是「没有结果」**。
 *   三者塌成一格，就等于把「系统坏了」与「没搜到」粉饰成同一句话。
 *
 * 【为什么 SETTINGS 域灌的是「应用注册表」而不是设置项】
 *   内核的域枚举是冻结的（CONTACTS / WECHAT / DIARY / SETTINGS），本件不新增域
 *   （「不开新机制」是本期总纪律）。本仓的 SETTINGS 域语义是「系统级可搜项」，
 *   而 89 个 App 的注册表正是其中最有用的一类 —— 搜 App 名直接开 App，
 *   也正是 X5 计划里「同时作为 R11-O7 应用库搜索的后端」那句话的落点。
 * ======================================================== */
'use strict';
import { numOrNull } from './num-gate.js';

/** 四域元信息（唯一的域→中文名/落点 真源；视图与 App 都读这里，不各写一份）。 */
export const SPOTLIGHT_DOMAIN_META = Object.freeze({
    CONTACTS: Object.freeze({ domain: 'CONTACTS', label: '通讯录', icon: '👤', appId: 'phone', emptyLine: '通讯录里还没有联系人' }),
    WECHAT: Object.freeze({ domain: 'WECHAT', label: '微信会话', icon: '💬', appId: 'wechat', emptyLine: '微信里还没有会话' }),
    DIARY: Object.freeze({ domain: 'DIARY', label: '日记', icon: '📔', appId: 'diary', emptyLine: '日记本还是空的' }),
    SETTINGS: Object.freeze({ domain: 'SETTINGS', label: '设置与应用', icon: '⚙️', appId: 'settings', emptyLine: '应用注册表还没读到' })
});

/** 归因词表（判据按此表逐词核，防随口新词）。 */
export const SPOTLIGHT_FEED_REASONS = Object.freeze({
    OK: '',
    NO_HOST: 'no_host',
    NO_SUBSYSTEMS: 'no_subsystems',
    NO_SPOTLIGHT: 'no_spotlight',
    NO_SEARCH: 'no_search_method',
    READ_THREW: 'read_threw',
    BAD_RESULT: 'bad_result'
});

/** 一次联动最多渲染多少行（与引擎默认 limit 同口径；超出交给分页说明）。 */
export const SPOTLIGHT_FACE_LIMIT = 60;

/** 域 meta 的安全取值（未知域如实回落，不凭空造一个域）。 */
export function domainMetaOf(domain) {
    const key = String(domain || '').trim();
    return SPOTLIGHT_DOMAIN_META[key] || Object.freeze({ domain: key, label: key || '未知域', icon: '🔎', appId: '', emptyLine: '这一域没有登记' });
}

/**
 * 一域「可搜内容覆盖」的三态判定（**纯函数**：只数入参，不摸 storage）。
 *   · `empty`   —— 灌进去 0 条（该域暂无数据）；
 *   · `ready`   —— 灌进去 ≥1 条（该域可搜，本次零命中就是「没有匹配」）；
 *   · `missing` —— 调用方根本没取到这一域的数据源（与 empty 不同形）。
 * @param {Array<{domain:string,count:number,ok:boolean,why?:string}>} perDomain
 */
export function mapDomainCoverage(perDomain) {
    const list = Array.isArray(perDomain) ? perDomain : [];
    const out = [];
    for (const d of list) {
        const meta = domainMetaOf(d && d.domain);
        const ok = !!(d && d.ok !== false);
        const n = numOrNull(d && d.count);
        const count = n === null ? 0 : n;
        out.push(Object.freeze({
            domain: meta.domain,
            label: meta.label,
            icon: meta.icon,
            state: !ok ? 'missing' : (count > 0 ? 'ready' : 'empty'),
            count: count,
            emptyLine: meta.emptyLine,
            why: String((d && d.why) || '')
        }));
    }
    return out;
}

/**
 * 把内核 `search()` 的返回映射成可渲染的行 + 计数 + 域覆盖。
 *   · **只读不改入参**（不改内核那四个 Map 里的任何一条）；
 *   · 每行带 `openDetail`（走 config/app-open-detail.js 的同一支笔拼的载荷，
 *     本件不手写对象字面量 —— 字段名漂开正是 X1 那一刀治的病）；
 *   · 不给行伪造 `meta.ref`：靶心 kind 必须在 config/open-ref.js 登记表里才算数，
 *     本件没有登记过任何 kind ⇒ 不声称能定位到某一条（只到 App / 到页签）。
 * @param {{query?:string,intentAction?:object,results?:Array}} raw
 * @param {{coverage?:Array, limit?:number, buildOpenDetail?:Function}} [opts]
 */
export function mapSpotlightRows(raw, opts = {}) {
    const r = (raw && typeof raw === 'object') ? raw : null;
    if (!r) {
        return { ok: false, why: SPOTLIGHT_FEED_REASONS.BAD_RESULT, rows: [], counts: { total: 0, byDomain: {} }, domains: mapDomainCoverage(opts.coverage), intentAction: null };
    }
    const build = (typeof opts.buildOpenDetail === 'function') ? opts.buildOpenDetail : null;
    const res = Array.isArray(r.results) ? r.results : [];
    const lim = Math.max(1, Number(opts.limit) || SPOTLIGHT_FACE_LIMIT);
    const rows = [];
    const byDomain = {};
    for (const it of res) {
        if (!it || typeof it !== 'object') continue;
        const meta = domainMetaOf(it.domain);
        byDomain[meta.domain] = (numOrNull(byDomain[meta.domain]) || 0) + 1;
        if (rows.length >= lim) continue;
        const link = (it.deepLink && typeof it.deepLink === 'object') ? it.deepLink : null;
        const appId = String((link && link.targetApp) || meta.appId || '');
        /* 页签只在 deepLink 明写 view 时投（内核那三门意图语法各带一个 view）；
         *   其余一律只到 App —— 「只到 App」是合法诉求，不是失败。 */
        const tab = (link && typeof link.view === 'string' && link.view) ? link.view : null;
        const score = numOrNull(it.relevanceScore);
        rows.push({
            sourceId: 'spotlight-' + meta.domain.toLowerCase(),
            sourceLabel: meta.label + ' · 全局检索',
            icon: meta.icon,
            appId: appId,
            domain: meta.domain,
            domainLabel: meta.label,
            title: String(it.title || it.subtitle || it.rawId || '（未命名）'),
            subtitle: String(it.subtitle || ''),
            snippet: String(it.content || it.subtitle || ''),
            score: score === null ? 0 : score,
            openDetail: build ? build(appId, tab, null) : { appId: appId }
        });
    }
    const intent = (r.intentAction && typeof r.intentAction === 'object') ? r.intentAction : null;
    let intentRow = null;
    if (intent) {
        const link = (intent.deepLink && typeof intent.deepLink === 'object') ? intent.deepLink : null;
        const appId = String((link && link.targetApp) || '');
        const tab = (link && typeof link.view === 'string' && link.view) ? link.view : null;
        intentRow = {
            type: String(intent.type || ''),
            target: String(intent.target || ''),
            message: String(intent.message || ''),
            amount: numOrNull(intent.amount),
            appId: appId,
            tab: tab,
            openDetail: build ? build(appId, tab, null) : { appId: appId }
        };
    }
    return {
        ok: true,
        why: SPOTLIGHT_FEED_REASONS.OK,
        rows: rows,
        counts: { total: res.length, byDomain: byDomain },
        domains: mapDomainCoverage(opts.coverage),
        intentAction: intentRow
    };
}

/**
 * 一句读数（状态栏式短句；**只描述这次真发生了什么**，不夸也不瞒）。
 * @returns {string}
 */
export function spotlightLine(feed) {
    const f = (feed && typeof feed === 'object') ? feed : null;
    if (!f) return '';
    if (f.ok !== true) {
        const why = String(f.why || '');
        if (why === SPOTLIGHT_FEED_REASONS.NO_HOST) return '全局检索：宿主还没就绪（不是「没有结果」）';
        if (why === SPOTLIGHT_FEED_REASONS.NO_SUBSYSTEMS) return '全局检索：中枢还没装配（不是「没有结果」）';
        if (why === SPOTLIGHT_FEED_REASONS.NO_SPOTLIGHT) return '全局检索：内核没挂上（不是「没有结果」）';
        if (why === SPOTLIGHT_FEED_REASONS.READ_THREW) return '全局检索：读取时抛错（不是「没有结果」）';
        return '全局检索：这一面读不到（不是「没有结果」）';
    }
    const total = numOrNull(f.counts && f.counts.total);
    const n = total === null ? 0 : total;
    const domains = Array.isArray(f.domains) ? f.domains : [];
    const ready = domains.filter(d => d.state === 'ready').length;
    const missing = domains.filter(d => d.state === 'missing').length;
    const head = n > 0 ? ('全局检索命中 ' + String(n) + ' 条') : '全局检索没有命中';
    const tail = ready > 0 ? ('· 已接入 ' + String(ready) + '/4 域') : '· 四域都没读到内容';
    return head + ' ' + tail + (missing > 0 ? ('（' + String(missing) + ' 域的数据源没取到）') : '');
}

/**
 * 域覆盖数组 → 给视图的三行短注（每域一句，正因为「无匹配」与「域缺席」不同形）。
 */
export function domainNotes(domains) {
    const list = Array.isArray(domains) ? domains : [];
    const out = [];
    for (const d of list) {
        if (!d || typeof d !== 'object') continue;
        if (d.state === 'missing') out.push({ domain: d.domain, label: d.label, kind: 'missing', line: d.label + '：数据源没取到（不是没有内容）' });
        else if (d.state === 'empty') out.push({ domain: d.domain, label: d.label, kind: 'empty', line: d.label + '：' + String(d.emptyLine || '暂无数据') });
    }
    return out;
}
