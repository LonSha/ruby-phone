/* ============================================================
 * config/app-icons.js — 像素图标集注册表（唯一真源）
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
 * [v4.98.0 · R11-O8] 从「手写 8 条」改成**按 APPS 全量派生**：
 *   v4.92.0 只登记了 8 个核心 + 文件夹，89 个 App 里 81 个落到 emoji/PNG 兜底 ——
 *   也就是说「统一像素」的声明在 91% 的图标上是假的。手动补 81 条不但贵，
 *   而且**下个新 App 必然又被漏掉**（漏掉是静默的：只是那张图不是像素风）。
 *   故改成「清单 = APPS ∩ 磁盘上有 SVG 的 id」，并导出 `unifiedIconCoverage()`
 *   供判据直接读覆盖率 —— 新增 App 若忘了生成图标，判据当场点名，而不是靠人记得。
 *
 * 三层回退（高 → 低）：
 *   L1 统一像素 SVG 集（本文件登记）—— 像素 OS 的默认视觉；
 *   L2 imageManager 自定义图（用户资产，显式覆盖时仍优先，由渲染层判断）；
 *   L3 中性像素兜底 —— 未登记的 App 用统一像素方块底，不再吃 app.color 彩色块。
 *
 * 判据来源：tests/system-v4920.test.mjs（每张 SVG 过 lintPixelSvg、桌面 8 核心在册）
 *   与 tests/system-v4990.test.mjs（覆盖率单调不减 / ≥50/89 / 无 emoji 冒充）。
 * ============================================================ */
import { PIXEL_ICON_IDS, PIXEL_ICON_FILES } from './pixel-icons.generated.js';
import { APPS } from './apps.js';
/** 像素图标集的 appId 清单。
 *  ★ 真源是**磁盘**（`phone/icons/pixel-icons.generated.js`，由 tools/gen_pixel_icons.py
 *    生成），不是本文件手写的数组 —— 手写清单必然会与磁盘漂移，而漂移是静默的
 *    （只表现为「那张图不是像素风」）。故这里只做**转写**，新增图标必须跑生成器。 */
export const UNIFIED_APP_ICON_IDS = Object.freeze([...PIXEL_ICON_IDS]);
/** 像素图标集：appId → 像素 SVG URL（按生成清单的 id → file 映射派生，不再手写）。
 *  ★ 为什么经 `PIXEL_ICON_FILES` 而不是直接拼 `id + '.svg'`：
 *    并非每个 id 都等于文件名 —— `__folder` 的图在 `folder.svg`（v4.92.0 起的既有约定）。
 *    v4.98.0 首版就是按 id 直接拼，结果 `__folder` 指向一个**不存在**的
 *    `__folder.svg`，而 `unifiedIconOf('__folder')` 照样返回一个字符串 URL、
 *    照样「有值」—— 这是**静默 404**，只有肉眼看图才会发现。
 *    故把映射放进生成清单（同一次生成写出，不可能对不上）。 */
export const UNIFIED_APP_ICONS = Object.freeze(
    UNIFIED_APP_ICON_IDS.reduce((acc, id) => {
        const file = PIXEL_ICON_FILES[id] || id;
        acc[id] = new URL('../phone/icons/' + file + '.svg', import.meta.url).href;
        return acc;
    }, Object.create(null))
);
/** 该 id 对应的磁盘 SVG 基名（供判据核对「URL 落点真的有文件」）。 */
export function unifiedIconFileOf(appId) {
    const id = String(appId || '');
    return Object.prototype.hasOwnProperty.call(PIXEL_ICON_FILES, id) ? PIXEL_ICON_FILES[id] : null;
}
/** 查像素图标：登记过返回 URL，未登记返回 null（调用方往 L3 兜底走）。 */
export function unifiedIconOf(appId) {
    return UNIFIED_APP_ICONS[String(appId || '')] || null;
}
/** 该 appId 是否已被像素集覆盖（门禁用：桌面 8 核心必须全覆盖）。 */
export function hasUnifiedIcon(appId) {
    return Object.prototype.hasOwnProperty.call(UNIFIED_APP_ICONS, String(appId || ''));
}
/** 覆盖率读数（R11-O8 的机器可读唯一真源）。
 *  返回 {total, covered, missing, unmapped, ratio}：
 *    `total`   只计真 App（不含 `__folder`）；
 *    `missing` 点名「APPS 里有、像素集里没有」—— 那正是会被静默 emoji 兜底的集合；
 *    `unmapped` 点名「已在册、但没有磁盘文件名映射」的 id —— 这一类**最阴**：
 *      它在册、`unifiedIconOf` 返回一个非空 URL、`hasUnifiedIcon` 为真，
 *      于是覆盖率显示 100%，而那个 URL 指向一个不存在的文件（v4.98.0 首版的
 *      `__folder` 就是这个形态）。**有值 ≠ 有图**，故本读数把两类分开点名。
 *  ★ 分子取自**磁盘生成清单**而非本文件的手写表，故「跑没跑生成器」当场可见。 */
export function unifiedIconCoverage() {
    const ids = (Array.isArray(APPS) ? APPS.map(a => (a && a.id) || '') : []).filter(Boolean);
    const missing = ids.filter(id => !hasUnifiedIcon(id));
    const covered = ids.length - missing.length;
    /* 在册但**没有文件名映射**的 id（经统一的映射查询走，不在这里再摸一次真源常量）。 */
    const unmapped = UNIFIED_APP_ICON_IDS.filter(id => !unifiedIconFileOf(id));
    return {
        total: ids.length,
        covered,
        missing,
        unmapped,
        ratio: ids.length ? covered / ids.length : 0,
        /* 一行读数：诊断中心直接陈列它，不再自己拼（本仓「同一读数不许两个来源」）。 */
        line: '图标覆盖率：' + String(covered) + '/' + String(ids.length)
            + '（' + String(Math.round((ids.length ? covered / ids.length : 0) * 100)) + '%）'
            + (missing.length ? '，缺 ' + String(missing.length) + ' 件：' + missing.join(' / ') : '，无缺件')
            + (unmapped.length ? '；⚠ 在册但无磁盘映射 ' + String(unmapped.length) + ' 件（URL 非空但落点不存在）：' + unmapped.join(' / ') : '')
    };
}