/* ========================================================
 * config/open-ref.js — [v3.66.0 · 拓展计划 X2 第一切片] 跨 App「定位引用」归一（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   全局搜索的引擎侧**早就有** `meta` 管线：`global-search-engine.js` 有 6 处
 *   在条目上写 `meta`（`:593 meta:{floor}` / `:828 meta:{achievementId}` /
 *   `:885 meta:{id}` / `:901 meta:{id}` / `:1026 meta:{floor}` /
 *   `:1110 meta:{ref,ledger,floor}`）。而 `apps/search/*.js` 对 `.meta` 的消费是
 *   **零命中** —— 视图不读它、`_row()` 不渲染它、打开只发 `{ appId }`。
 *   于是「找到了一条旅行费用」和「打开旅行记账」之间**没有任何桥**：用户点结果
 *   只会落在 App 的首屏，还得自己再翻一遍。这不是索引不够，是**结果没有靶心**。
 *
 * 【为什么要单独一件，而不是让每个 App 自己认 ref】
 *   目标侧会继续长（本切片接 6 个桶，后续还有）。若各 App 自己判 ref 形态：
 *     · 字段名会漂（`id` / `itemId` / `ref` 三种写法迟早同时存在）；
 *     · kind 会漂（同一桶出现 `expense` / `cost` / `费用`，两侧各写一份，永不对账）；
 *     · **错配会静默**：`pixiv` 的 `novel` 被投到 `lofter`，那边 `novelById` 返回 null，
 *       报「这篇作品找不到了」——用户以为文章被删了，其实是投错了 App。
 *   本件把这三类在**投递前**一次判死，并把「为什么不投 / 投了但没命中」说成一个词。
 *
 * 【口径三条】
 *   ① `kind` 必须登记在表里，且 `ref.appId` 必须与登记的 appId **一致**
 *      （不一致即 `ref-app-mismatch`，绝不蒙着投）；
 *   ② `id` 一律收成 **字符串** 再比 —— 本仓 id 有数字形（曲库按下标）与
 *      字符串形（`tv_e_1` / `sm_m_...`）两种，两处各判一次形态必然分岔；
 *   ③ `applyOpenRef` 的返回值要**如实**：目标 App 的 `openRef` 返回 `{ok:false,reason}`
 *      时归为 `target-missed:<reason>`，**不**报成功 —— 这正是 X2 验收里那句
 *      「不声称已跳到」在代码上的落地形式。
 * ======================================================== */
'use strict';

/** 已登记的 ref 类型表：kind → 唯一归属 App。未登记的 kind 一律不投。 */
export const OPEN_REF_KINDS = Object.freeze({
    expense: Object.freeze({ appId: 'traveldesk', label: '旅行费用' }),
    memory: Object.freeze({ appId: 'summdesk', label: '总结记忆' }),
    item: Object.freeze({ appId: 'annidate', label: '纪念日条目' }),
    song: Object.freeze({ appId: 'musicdesk', label: '曲库曲目' }),
    novel: Object.freeze({ appId: 'pixiv', label: 'Pixiv 小说' }),
    illust: Object.freeze({ appId: 'pixiv', label: 'Pixiv 插画' }),
    article: Object.freeze({ appId: 'lofter', label: '老福特文章' })
});

/** ref 归一的归因词表（判据按此表逐词核，防随口新词）。 */
export const OPEN_REF_REASONS = Object.freeze({
    OK: '',
    NOT_OBJECT: 'ref-not-object',
    KIND_UNKNOWN: 'ref-kind-unknown',
    NO_APP: 'ref-no-app',
    APP_MISMATCH: 'ref-app-mismatch',
    NO_ID: 'ref-no-id'
});

export function refStr(v) { return (typeof v === 'string') ? v : ''; }

/** 该 kind 登记的归属 App（未登记返回 ''）。 */
export function kindAppOf(kind) {
    const rec = OPEN_REF_KINDS[refStr(kind)];
    return rec ? rec.appId : '';
}

/**
 * 把任意来源的 `ref` 收成结构恒定的一条。
 * @param raw 任意值（源条目上的 meta.ref / 视图 data-ref 解出的对象 / undefined）
 * @returns {{appId:string, kind:string, id:string, ok:boolean, why:string}}
 *   · ok 只说「四个字段都成立且归属一致」；不 ok 时 appId/kind/id 尽量带回可读值，
 *     便于调用方把「哪儿不对」报出来，而不是只丢一句「坏了」。
 */
export function normalizeOpenRef(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { appId: '', kind: '', id: '', ok: false, why: OPEN_REF_REASONS.NOT_OBJECT };
    }
    const kind = refStr(raw.kind);
    const idRaw = (typeof raw.id === 'string') ? raw.id : (typeof raw.id === 'number' && Number.isFinite(raw.id) ? String(raw.id) : '');
    /* ★ 纯空白 id 不算 id：本仓已有「收藏开关对纯空白 id 当变更、落成永远消不掉的孤儿」
     *   这条实测缺陷，同款形态在这里会变成「投了一条永远找不到的靶心」——
     *   投递回报 not_found，用户以为那条内容被删了。 */
    const id = idRaw.trim() ? idRaw : '';
    const appId = refStr(raw.appId);
    const owner = kindAppOf(kind);
    if (!owner) return { appId: appId, kind: kind, id: id, ok: false, why: OPEN_REF_REASONS.KIND_UNKNOWN };
    if (!appId) return { appId: '', kind: kind, id: id, ok: false, why: OPEN_REF_REASONS.NO_APP };
    if (appId !== owner) return { appId: appId, kind: kind, id: id, ok: false, why: OPEN_REF_REASONS.APP_MISMATCH };
    if (!id) return { appId: appId, kind: kind, id: '', ok: false, why: OPEN_REF_REASONS.NO_ID };
    return { appId: appId, kind: kind, id: id, ok: true, why: '' };
}

/**
 * 拼一条 ref（供源侧用**同一支笔**写字，而不是各处手写对象字面量）。
 * 刻意**不做**归一：源侧写出坏值是本仓要能看见的形态（由测试的「源侧逐条归一必须 ok」
 *   判据当场抓住），在这里悄悄修好反而把缺陷藏起来。
 */
export function buildOpenRef(kind, id, appId) {
    return { appId: refStr(appId) || kindAppOf(kind), kind: refStr(kind), id: (typeof id === 'string') ? id : String(id === undefined || id === null ? '' : id) };
}

/** 两条 ref 是否指向同一条。任一侧不成立即 false（不把「两条坏 ref」判成相等）。 */
export function sameRef(a, b) {
    const x = normalizeOpenRef(a), y = normalizeOpenRef(b);
    return !!(x.ok && y.ok && x.kind === y.kind && x.id === y.id);
}

/**
 * 把 ref 投到 App 实例上（消费侧唯一一处）。
 * 顺序由调用方保证：**先 setTab（若有）再投 ref 再 render** —— 目标 App 的 openRef
 *   会把详情态点亮，但它自己不渲染（本仓有一族 setTab/openX 只改状态不渲染），
 *   故必须在 render 之前投，否则详情态**画不出来**（不是报错，是空白）。
 * 归因五态：''（投了且目标命中）/ no-instance / no-open-ref（如实报，不假装投过）/
 *   open-ref-threw / `target-missed:<reason>`（投了但这个 id 在目标里找不到）。
 * @param inst   App 实例（懒加载装配器 new 出来的那个）
 * @param ref    normalizeOpenRef 的结果（或任意 {appId,kind,id}）
 * @returns {{applied:boolean, why:string}}
 */
export function applyOpenRef(inst, ref) {
    const norm = (ref && typeof ref === 'object' && 'ok' in ref) ? ref : normalizeOpenRef(ref);
    if (!norm.ok) return { applied: false, why: '' };
    if (!inst || typeof inst !== 'object') return { applied: false, why: 'no-instance' };
    if (typeof inst.openRef !== 'function') return { applied: false, why: 'no-open-ref' };
    let r;
    try {
        r = inst.openRef(norm);
    } catch (_e) {
        return { applied: false, why: 'open-ref-threw' };
    }
    /* 目标 App 必须回报结果。**不回报**也算没成 —— 「函数没抛」不等于「定位到了」，
     *   本仓最贵的缺陷形态正是「不报错、只是默默没生效」。 */
    if (r && typeof r === 'object' && r.ok === false) {
        return { applied: false, why: 'target-missed:' + refStr(r.reason || 'unknown') };
    }
    if (!(r && typeof r === 'object' && r.ok === true)) {
        return { applied: false, why: 'target-silent' };
    }
    return { applied: true, why: '' };
}

/** 表自检（供门禁调用，不读磁盘；磁盘侧由测试独立复算）。 */
export function openRefSelfCheck() {
    const problems = [];
    for (const [kind, rec] of Object.entries(OPEN_REF_KINDS)) {
        if (!kind) problems.push('kind 为空');
        if (!rec || typeof rec.appId !== 'string' || !rec.appId) problems.push(kind + ' 缺 appId');
        if (!rec || typeof rec.label !== 'string' || !rec.label) problems.push(kind + ' 缺 label');
    }
    /* 同一 App 可以拥有多个 kind（pixiv 有 novel/illust），但**同一个 kind 不得有两个归属** ——
     *   对象字面量天然去重，这里只钉「appId 必须是大写小写都对的裸 id 形」这条（防写成中文名）。 */
    for (const [kind, rec] of Object.entries(OPEN_REF_KINDS)) {
        if (!/^[a-z][a-z0-9]*$/.test(String(rec.appId))) problems.push(kind + ' 的 appId 不是裸 id 形：' + rec.appId);
    }
    return { problems: problems };
}
