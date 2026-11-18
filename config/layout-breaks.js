/* ============================================================
 * config/layout-breaks.js — [R25-X5] 多设备布局的**唯一断点真源**
 * ------------------------------------------------------------
 * 【修之前的现场】
 *   1. `phone.css` 里 22593 行 CSS 中，阈值各写各的：310 / 359 / 360 / 420 / 500 / 501 / 520 / 600 / 768 / 900。
 *      「窄屏」「手机」「宽屏」三档**没有语义**，同一块界面在不同段里被当成不同档位。
 *   2. `phone/screen-adaptive-layout-engine.js` 在盘（53 行）自带一套 768 / 480 / 360，
 *      但 `calculateAdaptiveMetrics` 全仓**零调用点** ⇒ 算出来的 `cssProperties` 没人贴，
 *      宽屏至今是一列巨宽。
 *   3. 全仓零 `resize` / `orientationchange` 处理 ⇒ 横竖切换只能靠 CSS 媒体查询自己重排，
 *      脚本面拿不到「现在是哪一档」，也就无法保证「切换不丢状态」（有些地方会走重建路径）。
 *
 * 【本模块的职责边界】
 *   只做三件事：**判档**、**给属性**、**判读回**。不碰 DOM、不碰 CSS、不碰 storage。
 *   于是它可以在 node 里被逐格真算（判据就是这么验的），也让引擎与外壳共用同一组数字。
 *
 * 【三态纪律】
 *   读不到宽高 ⇒ `state:'unreadable'`，`tier:null`。**绝不**回落到 `standard`：
 *   「量不出来」与「量出来是标准档」是两件事，前者不该冒充后者（旧引擎的
 *   `Number(w) || 375` 正是这个塌陷 —— 它把「没量到」写成了「375 像素」）。
 * ============================================================ */
import { numOrNull } from './num-gate.js';

/** 三档闭集（顺序即从窄到宽，别处按索引比较）。 */
export const LAYOUT_TIERS = Object.freeze(['compact', 'standard', 'wide']);

/**
 * 断点（**唯一真源**）。
 *   compact  : width ≤ 479
 *   standard : 480 ≤ width ≤ 899
 *   wide     : width ≥ 900
 * 边界取整数、闭区间，避免「479.5 落在哪一档」这类没人能记住的悬空值。
 */
export const BREAKPOINTS = Object.freeze({ compactMax: 479, wideMin: 900 });

/** 两个朝向（闭集）。`width > height` ⇒ landscape，其余（含相等）⇒ portrait。 */
export const ORIENTATIONS = Object.freeze(['portrait', 'landscape']);

/**
 * 每档的布局语义（真源）。**三档必须有明确不同的布局**，否则「断点」只是数字游戏：
 *   · compact  ：单列 + 压缩边距（窄屏优先保住可点面积）
 *   · standard ：单列 + 内容最大宽度（手机一眼能扫完，不让单行文字横跨整块）
 *   · wide     ：**双列**（左侧导航栏 + 右侧内容区）—— 直接修掉「宽屏一列巨宽」
 */
export const TIER_TABLE = Object.freeze({
    compact: Object.freeze({
        id: 'compact',
        label: '紧凑（窄屏）',
        grid: 'single',
        navRailPx: 0,
        maxContentWidthPx: null,
        paddingScale: 0.85,
        homeGridColumns: 3,
        iconSizePx: 42,
        fontScale: 0.90,
        legacyFormFactor: 'compact-phone-narrow',
        note: '单列；边距 ×0.85 保住可点面积；桌面图标 3 列'
    }),
    standard: Object.freeze({
        id: 'standard',
        label: '标准（手机）',
        grid: 'single',
        navRailPx: 0,
        maxContentWidthPx: 560,
        paddingScale: 1,
        homeGridColumns: 4,
        iconSizePx: 48,
        fontScale: 1.0,
        legacyFormFactor: 'phone-portrait',
        note: '单列；内容限宽 560px，避免长行难读；桌面图标 4 列'
    }),
    wide: Object.freeze({
        id: 'wide',
        label: '宽屏（平板 / 横屏）',
        /* 诚实写明：本档**没有**左侧导航栏——那条导航栏现在不存在，凭空给它排一个空列
         * 只是把「一列巨宽」换成「左边空一条」。宽屏真正的问题是行太长、桌面太空，
         * 所以本档做两件实事：内容区**限宽 960 居中**（不再拉满屏）+ 桌面 **6 列** 放大。 */
        grid: 'single',
        navRailPx: 0,
        maxContentWidthPx: 960,
        paddingScale: 1.15,
        homeGridColumns: 6,
        iconSizePx: 64,
        fontScale: 1.15,
        legacyFormFactor: 'tablet-landscape',
        note: '单列但内容限宽 960px 居中；桌面图标 6 列、字号 ×1.15（不是把手机那一列拉宽）'
    })
});

/** 量测状态（三态里的两态；第三态是「量到了」）。 */
export const FACE_STATES = Object.freeze({ measured: 'measured', unreadable: 'unreadable' });

/** 属性名（外壳与 CSS 共用同一对名字，别处不许自起一个）。 */
export const LAYOUT_ATTRS = Object.freeze({ layout: 'data-layout', orientation: 'data-orientation' });

function unreadable(reason, detail) {
    return Object.freeze({
        state: FACE_STATES.unreadable,
        reason: reason,
        detail: detail === undefined ? null : String(detail),
        tier: null, tierLabel: null, orientation: null,
        width: null, height: null,
        grid: null, navRailPx: null, maxContentWidthPx: null, paddingScale: null,
        attributes: Object.freeze({})
    });
}

/** 只判档位：宽度读不到 ⇒ null（不回落 standard）。 */
export function tierOfWidth(width) {
    const w = numOrNull(width);
    if (w === null || w <= 0) return null;
    if (w <= BREAKPOINTS.compactMax) return 'compact';
    if (w < BREAKPOINTS.wideMin) return 'standard';
    return 'wide';
}

/** 只判朝向：任一读不到 ⇒ null。 */
export function orientationOf(width, height) {
    const w = numOrNull(width);
    const h = numOrNull(height);
    if (w === null || h === null || w <= 0 || h <= 0) return null;
    return w > h ? 'landscape' : 'portrait';
}

/**
 * 量测面：唯一的判档入口。
 * @param {{width?:*, height?:*}} input
 * @returns {{state:string, tier:?string, orientation:?string, attributes:object, ...}}
 */
export function layoutFace(input) {
    const i = (input && typeof input === 'object') ? input : {};
    const w = numOrNull(i.width);
    const h = numOrNull(i.height);
    /* 分开点名：宽读不到 ≠ 高读不到 ≠ 两者都读不到。合成一句「参数非法」会让人查错方向。 */
    if (w === null || w <= 0) return unreadable('no-width', i.width);
    if (h === null || h <= 0) return unreadable('no-height', i.height);
    const tier = tierOfWidth(w);
    const orientation = orientationOf(w, h);
    if (tier === null || orientation === null) return unreadable('no-tier', w + 'x' + h);
    const row = TIER_TABLE[tier];
    return Object.freeze({
        state: FACE_STATES.measured,
        reason: null,
        detail: null,
        tier: tier,
        tierLabel: row.label,
        orientation: orientation,
        width: w,
        height: h,
        grid: row.grid,
        navRailPx: row.navRailPx,
        maxContentWidthPx: row.maxContentWidthPx,
        paddingScale: row.paddingScale,
        homeGridColumns: row.homeGridColumns,
        iconSizePx: row.iconSizePx,
        fontScale: row.fontScale,
        note: row.note,
        breakpoints: BREAKPOINTS,
        /* 量测面没到 measured 时这里是空对象 —— 外壳据此**不写属性**，
         * 而不是写一个「标准档」让界面假装正常。 */
        attributes: Object.freeze({
            [LAYOUT_ATTRS.layout]: tier,
            [LAYOUT_ATTRS.orientation]: orientation
        })
    });
}

/** 由测量面得出「该往根节点写什么属性」；未量到 ⇒ 空对象（不写、也不清空别人写的）。 */
export function layoutAttributes(face) {
    if (!face || face.state !== FACE_STATES.measured) return {};
    return { [LAYOUT_ATTRS.layout]: face.tier, [LAYOUT_ATTRS.orientation]: face.orientation };
}

/**
 * 读回对拍（三态）：`same` / `mismatch` / `unknown`。
 * `unknown` 覆盖两种「没法判」：面没量到、或读回来的属性根本读不到（不是''，也不是猜的档）。
 */
export function judgeLayoutApplied(face, observed) {
    if (!face || face.state !== FACE_STATES.measured) return 'unknown';
    if (!observed || typeof observed !== 'object') return 'unknown';
    const wantTier = face.tier;
    const wantOri = face.orientation;
    const gotTier = typeof observed.layout === 'string' ? observed.layout.trim() : '';
    const gotOri = typeof observed.orientation === 'string' ? observed.orientation.trim() : '';
    if (!gotTier || !gotOri) return 'unknown';
    return (gotTier === wantTier && gotOri === wantOri) ? 'same' : 'mismatch';
}

/** 人话一行（设置页/诊断页共用，避免两处各写一句）。 */
export function layoutText(face) {
    if (!face || face.state !== FACE_STATES.measured) {
        const why = face && face.reason ? face.reason : 'no-face';
        return '布局档位：量不到窗口尺寸（' + why + '）—— 这不等于「标准档」';
    }
    const grid = face.grid === 'two-column'
        ? ('双列（导航 ' + face.navRailPx + 'px + 内容）')
        : ('单列' + (face.maxContentWidthPx ? '（内容限宽 ' + face.maxContentWidthPx + 'px 居中）' : '（内容拉满）'));
    return '布局档位：' + face.tierLabel + ' · ' + face.width + '×' + face.height
        + ' · ' + (face.orientation === 'landscape' ? '横屏' : '竖屏') + ' · ' + grid;
}

export default {
    LAYOUT_TIERS, BREAKPOINTS, ORIENTATIONS, TIER_TABLE, FACE_STATES, LAYOUT_ATTRS,
    tierOfWidth, orientationOf, layoutFace, layoutAttributes, judgeLayoutApplied, layoutText
};
