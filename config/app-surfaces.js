/* ============================================================
 * config/app-surfaces.js — [v4.87.0] App 表面色（唯一真源）
 * ------------------------------------------------------------
 * 为什么存在（真机实测报障，不是整洁性偏好）：
 *   用户实测截图里「约会大作战」整页**透出桌面壁纸、状态栏时钟与电池**——
 *   应用内容底下根本没有底色。查证后是两层原因叠加：
 *     ① `phone/phone-shell.js` 的 `layerHost()` 建层时硬编码 `background: transparent`；
 *     ② 大量 App 自身 CSS 从未声明根容器背景（根容器只声明 padding）——
 *        它们的文字色是**浅色的**（标题色是 #f0f0f0 一类的浅灰），
 *        本来就是按「深色底」设计的，只是没人给它铺那张底。
 *   于是「给图层补一个背景」不能一律补白：浅色底 + 浅色字 = 字直接消失
 *   （比透底更糟）。必须按 App 的字色倾向分别铺深/浅两种表面。
 *
 * 判据怎么来的（实测，非推演）：
 *   对 `apps/<id>/*.css` 全量统计 `color:#rrggbb` 的亮度分布
 *   （0.2126R+0.7152G+0.0722B）：亮字显著多于暗字 ⇒ 该 App 是深底设计。
 *   统计口径与本文表格一一对应，`tests/system-v4920.test.mjs` 会复核表格
 *   与本文件的一致性（不允许出现「登记了但语义相反」的条目）。
 *
 * 为什么是常量表而不是运行时算 CSS：
 *   运行时要把 89 个 App 的样式表全读进来才能算，得不偿失；且这是**设计决定**
 *   （App 作者已定好的配色意图），不是可推导量。表 + 自证测试是最省的落法。
 * ============================================================ */

/** 深色表面 App（浅色文字为主色、需要深底才可读）。 */
export const DARK_SURFACE_APP_IDS = Object.freeze([
    'honey', 'wangxiang', 'calendar', 'playbook', 'achievement', 'tieba', 'health',
    'bilibili', 'place', 'cheat', 'dirtytalk', 'wallet', 'profile', 'plotline',
    'chars', 'clock', 'ledger', 'asset', 'usage', 'diagnose', 'focus', 'accounting',
    'piggy', 'regexfilter', 'punchcard', 'avatarframe', 'shop', 'block', 'weather',
    'taobao', 'loverspace', 'date', 'lofter', 'pixiv', 'sourcebook', 'widget',
    'affairs', 'comms'
]);

/** 两种表面色（与 phone.css 的 `--phone-app-bg-*` 保持同一字面量）。 */
export const APP_SURFACE_COLORS = Object.freeze({
    dark: '#0f1319',
    light: '#f8fafc'
});

/** 把图层名（`view-date` / `date` / `home`）归一成 appId。 */
export function normalizeSurfaceAppId(viewOrAppId) {
    const raw = String(viewOrAppId === undefined || viewOrAppId === null ? '' : viewOrAppId).trim();
    if (!raw) return '';
    return raw.startsWith('view-') ? raw.slice(5) : raw;
}

/** 该 App 用哪种表面：'dark' | 'light'。未知一律按 light（与历史行为一致，不会更糟）。 */
export function appSurface(viewOrAppId) {
    const id = normalizeSurfaceAppId(viewOrAppId);
    if (!id) return 'light';
    return DARK_SURFACE_APP_IDS.includes(id) ? 'dark' : 'light';
}

/** 该 App 的表面底色（十六进制）。 */
export function appSurfaceColor(viewOrAppId) {
    return APP_SURFACE_COLORS[appSurface(viewOrAppId)];
}