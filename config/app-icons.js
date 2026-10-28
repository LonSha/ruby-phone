/* ============================================================
 * config/app-icons.js — 像素图标集注册表（唯一真源）[v4.92.0]
 * ------------------------------------------------------------
 * 为什么存在（真机截图病灶）：同一桌面网格曾混三套互不相干的视觉 ——
 *   ① 16 张 PNG 拟物（DEFAULT_APP_ICONS）；② imageManager 自定义图；
 *   ③ 73 个无图 App 的「app.color 彩色底 + emoji」兜底（灵感工坊🔮/成就簿🏆…）。
 *   三套色温/材质/光感，网格观感直接散架。
 *
 * v4.92.0 像素化的取舍：像素 OS 要求**单一语言**，故桌面与聚合壳一律走
 *   本文件的像素 SVG 集（24×24、整数坐标、16 色盘、crispEdges，由
 *   tools/gen_pixel_icons.py 生成、tests/system-v4920 校验）。
 *
 * 三层回退（高 → 低）：
 *   L1 统一像素 SVG 集（本文件登记）—— 像素 OS 的默认视觉；
 *   L2 imageManager 自定义图（用户资产，显式覆盖时仍优先，由渲染层判断）；
 *   L3 中性像素兜底 —— 未登记的 App 用统一像素方块底，不再吃 app.color 彩色块。
 *
 * 判据来源：tests/system-v4920.test.mjs 校验
 *   ① 登记表每个 id 都有对应像素 SVG 且过 lintPixelSvg；
 *   ② 桌面 8 核心全部在册；③ 聚合壳占位 folder.svg 在场。
 * ============================================================ */

/** 像素图标集：appId → 像素 SVG URL。 */
export const UNIFIED_APP_ICONS = Object.freeze({
    wechat: new URL('../phone/icons/wechat.svg', import.meta.url).href,
    honey: new URL('../phone/icons/honey.svg', import.meta.url).href,
    phone: new URL('../phone/icons/phone.svg', import.meta.url).href,
    diary: new URL('../phone/icons/diary.svg', import.meta.url).href,
    album: new URL('../phone/icons/album.svg', import.meta.url).href,
    calendar: new URL('../phone/icons/calendar.svg', import.meta.url).href,
    games: new URL('../phone/icons/games.svg', import.meta.url).href,
    settings: new URL('../phone/icons/settings.svg', import.meta.url).href,
    /* 聚合壳的通用像素文件夹底（运行时被 pixel-engine.folderMiniSwatches
     *   按类目成员色覆盖，此处给一个可单独存在的形态）。 */
    __folder: new URL('../phone/icons/folder.svg', import.meta.url).href
});

/** 查像素图标：登记过返回 URL，未登记返回 null（调用方往 L3 兜底走）。 */
export function unifiedIconOf(appId) {
    return UNIFIED_APP_ICONS[String(appId || '')] || null;
}

/** 该 appId 是否已被像素集覆盖（门禁用：桌面 8 核心必须全覆盖）。 */
export function hasUnifiedIcon(appId) {
    return Object.prototype.hasOwnProperty.call(UNIFIED_APP_ICONS, String(appId || ''));
}