/* ========================================================
 * config/app-open-detail.js — [v3.65.0 · 拓展计划 X1 第一切片] 开 App 载荷归一（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   `phone:openApp` 的 detail 此前**恒为 `{ appId }`**（全仓实测 9 处派发点：
 *   honey-view / settings-app / wangxiang-app / wechat chat-view / weibo-app /
 *   notification-center-view / search-view / home-screen / lock-screen。
 *   settings-app 那处多带一个 `icon` 字段，仍无页签）。
 *   ⇒ 「打开曲库」只能落在曲库的**首个页签**上，哪怕用户要的是歌词页。
 *   这不是入口不够多，是**入口没有靶心**。
 *
 * 【为什么归一要单独一件（而不是在 9 处各写一遍）】
 *   派发点会继续长（X2 跨 App 检索、X3 日程提醒都要派发）。若每处各自拼 detail：
 *     · 字段名会漂（`tab` / `page` / `pane` 三种写法迟早同时存在）；
 *     · 空串与缺字段会被混为一谈（`tab: ''` 到底算「不去页签」还是「去空页签」）；
 *     · 非字符串（数字 / 对象 / 数组）会带着走到 App 的 setTab 里，
 *       那里的 `toStr` 会把它变成 '' 或 '[object Object]' —— 一个**看起来有值**的坏值。
 *   本件把这些在**入口处**一次判死，并把「为什么不投」说成一个词（`why`）。
 *
 * 【口径：`tab` 只在「是个非空字符串」时才算数】
 *   其余一律归 null（= 只到 App，一个字都不多声称），且**不悄悄丢弃**原因：
 *   `why` 分 `''`（无 tab，正常）/ `bad-tab-shape`（给了但形态不对）/
 *   `bad-app-id`（连 appId 都不成立）三态。调用方按需报出。
 * ======================================================== */
'use strict';

/** 载荷归一的归因词表（判据按此表逐词核，防随口新词）。 */
export const OPEN_DETAIL_REASONS = Object.freeze({
    OK: '',
    NOT_OBJECT: 'detail-not-object',
    BAD_APP_ID: 'bad-app-id',
    BAD_TAB_SHAPE: 'bad-tab-shape'
});

export function toStrOf(v) { return (typeof v === 'string') ? v : ''; }

/**
 * 把任意来源的 `e.detail` 收成结构恒定的一条。
 * @param detail 任意值（事件 detail / 调用方自拼对象 / undefined）
 * @returns {{appId:string, tab:string|null, ok:boolean, why:string}}
 *   · ok 只说「appId 成立」；tab 是 null 不算不 ok（只到 App 是合法诉求）
 *   · `tab` 为 null 的三种情形在 why 里分开：无字段（''）/ 形态不对（bad-tab-shape）
 */
export function normalizeOpenDetail(detail) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        return { appId: '', tab: null, ok: false, why: OPEN_DETAIL_REASONS.NOT_OBJECT };
    }
    const appId = toStrOf(detail.appId);
    if (!appId) return { appId: '', tab: null, ok: false, why: OPEN_DETAIL_REASONS.BAD_APP_ID };
    const raw = detail.tab;
    if (raw === undefined || raw === null) return { appId: appId, tab: null, ok: true, why: '' };
    if (typeof raw !== 'string') return { appId: appId, tab: null, ok: true, why: OPEN_DETAIL_REASONS.BAD_TAB_SHAPE };
    if (!raw) return { appId: appId, tab: null, ok: true, why: OPEN_DETAIL_REASONS.BAD_TAB_SHAPE };
    return { appId: appId, tab: raw, ok: true, why: '' };
}

/**
 * 拼一条派发载荷（供派发点用**同一支笔**写字，而不是各处手写对象字面量）。
 * `tab` 为 null 时**不写这个字段**（保持与修前 detail 逐字节一致 —— 既有 9 处
 *   派发点改成走本函数后，事件载荷不该发生任何变化，那是白改）。
 */
export function buildOpenDetail(appId, tab) {
    const id = toStrOf(appId);
    const t = (typeof tab === 'string' && tab) ? tab : null;
    return t ? { appId: id, tab: t } : { appId: id };
}

/**
 * 把归一后的载荷**投到 App 实例上**（消费侧唯一一处）。
 * 为什么顺序是「先 setTab 再 render」：
 *   · 本仓有两族 setTab —— 一族只改 `_tab` 不渲染（musicdesk / pixiv / lofter /
 *     kettle / needsim / sourcebook / recall / magazine / soundkit / doujin /
 *     cotdesk / archive / diagdesk / uterus，视图点击处由视图自己 `refresh()`）；
 *     另一族自带 `render()`（freehome / lexiscore / stickerdesk / sullydesk /
 *     memtable / socialguard）。
 *   先 setTab 再 render 对两族**都正确**：前一族靠我们这次 render 吃到新页签，
 *   后一族多渲染一次（幂等、代价可忽略）。反过来（先 render 再 setTab）前一族会
 *   停在兜底页 —— 那正是本次要治的形态，绝不能在新路径里复现。
 * 拒投的口径：`tab` 为 null 直接不做（只到 App 是合法诉求，不是失败）；
 *   实例没有 `setTab` 口 ⇒ `no-set-tab`（如实报，不假装投过）。
 * @param inst   App 实例（懒加载装配器 new 出来的那个）
 * @param detail normalizeOpenDetail 的结果（或任意 {appId, tab}）
 * @returns {{applied:boolean, why:string}}
 */
export function applyOpenDetail(inst, detail) {
    const norm = (detail && typeof detail === 'object' && 'ok' in detail) ? detail : normalizeOpenDetail(detail);
    if (!norm.tab) return { applied: false, why: '' };
    if (!inst || typeof inst !== 'object') return { applied: false, why: 'no-instance' };
    if (typeof inst.setTab !== 'function') return { applied: false, why: 'no-set-tab' };
    try {
        inst.setTab(norm.tab);
        return { applied: true, why: '' };
    } catch (_e) {
        return { applied: false, why: 'set-tab-threw' };
    }
}
