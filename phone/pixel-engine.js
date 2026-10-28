/* ============================================================
 * phone/pixel-engine.js — RubyPhone 复古像素 OS 渲染引擎（v4.92.0）
 * ------------------------------------------------------------
 * 为什么存在（真机四条病灶，见用户反馈与本仓头注）：
 *   ① 三套视觉混杂（PNG 拟物 / imageManager 自定义 / 「彩色底+emoji」）；
 *   ② 双返回键：外壳一枚 + 各 App 私有返回（wechat-back-btn/ach-back-btn…）叠一起；
 *   ③ 居中灵动岛（phone-punch-hole, z-index:15）悬浮压在所有视图正文上 ——
 *      「摄像头挡文字」的病根；
 *   ④ 没有自己的设计语言（--iphone-island-* token 名直接暴露它在抄苹果）。
 *
 * 本引擎的统一答案（规格 = 本模块唯一实现，CSS 只消费它注入的变量）：
 *   · 16 色盘铁律 —— 所有 UI 只许用 16 个 --px-* 变量，禁盘外 HEX；
 *   · 零圆角 —— 切角一律 .pxcorner 的 clip-path 阶梯（2px/4px 两档）；
 *   · 硬边光影 —— box-shadow blur 恒 0，立体感只靠 .pxbox/.pxinset 明暗双线；
 *   · 整数几何 —— 像素 SVG 只用整数坐标，禁 <circle>/平滑曲线，圆用 rect 拼；
 *   · 帧进动画 —— 一律 steps() 或瞬切（0s），禁平滑缓动；
 *   · 排版双轨 —— 外壳用等宽像素字体(8/10/12px)+硬投影，正文面板用清晰无衬线。
 *
 * 掌机 B 键路由栈（VIEW_STACK）：
 *   本模块持有唯一返回栈：desktop → cluster(聚合壳) → app → detail。
 *   左下「◀ 退」是唯一返回入口，点击出栈一级；桌面根层级点击触发轻微抖动
 *   （无响应比乱跳更接近掌机直觉）。它**不替换**既有手势/返回守卫
 *   （config/back-guard.js 的物理返回、SWIPE_BACK 右滑仍走原链路），
 *   只负责「像素 B 键这一枚」的语义与视觉反馈。
 *
 * 边界（刻意不做）：不改任何 App 的数据模型 / 路由 / 存储键；不动正文内容区
 *   （聊天气泡/日记/阅读正文保持高可读，见 Q1=B「框架像素+内容可读」）。
 *   R1 双向覆盖（scripts/registry-audit.mjs）不破：89 个 App id 全保留，
 *   本引擎只改呈现层与返回入口。
 * ============================================================ */

/** 16 色盘（唯一真源；CSS 变量注入与 SVG 着色共用）。禁盘外色。 */
export const PX_PALETTE = Object.freeze({
    black: '#1a1c2c', dkblue: '#333c57', blue: '#5d7fa6', ltblue: '#8fd3ff',
    white: '#f4f4f4', cream: '#ffedd0', red: '#d93744', pink: '#f77b8f',
    orange: '#f9a03f', yellow: '#f9e14e', green: '#3fae49', ltgreen: '#9de64e',
    dkgreen: '#27613b', brown: '#8a5636', dkbrown: '#5a3d28', gray: '#7d8590'
});

/** 视图路由栈层级（掌机 B 键逐层出栈的顺序）。 */
export const VIEW_LEVEL = Object.freeze({
    DESKTOP: 'desktop', CLUSTER: 'cluster', APP: 'app', DETAIL: 'detail'
});

/* ---------------- 几何校验（像素纪律的机器判据） ---------------- */
/** 一个数是否为「合法像素坐标」（整数；允许 0）。 */
export function isPixelInt(n) {
    return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n;
}

/** 校验一段 SVG 文本是否守住像素纪律。返回 {ok, violations[]}。
 *  判据：① 必须声明 shape-rendering="crispEdges"；② 禁 <circle>；
 *  ③ 禁 stroke-width 小数 / x,y,width,height 小数。tests/system-v4920 消费。 */
export function lintPixelSvg(svgText) {
    const src = String(svgText || '');
    const violations = [];
    if (!/shape-rendering="crispEdges"/.test(src)) violations.push('missing-crispEdges');
    if (/<circle[\s>]/.test(src)) violations.push('no-circle-allowed');
    const numAttr = /(?:^|\s)(?:x|y|width|height|stroke-width)="(-?\d+(?:\.\d+)?)"/g;
    let m;
    while ((m = numAttr.exec(src)) !== null) {
        if (!isPixelInt(parseFloat(m[1]))) violations.push(`non-integer-attr:${m[0].trim()}`);
    }
    return { ok: violations.length === 0, violations };
}

/* ---------------- 掌机 B 键视图路由栈 ---------------- */
/** 创建一个像素 B 键返回栈。
 *  栈帧：{ level, id, onExit? }。push 入栈，back() 出栈顶并调其 onExit。
 *  返回 { push, back, depth, top, reset, _frames }（_frames 仅供测试内省）。 */
export function createViewStack() {
    const frames = [{ level: VIEW_LEVEL.DESKTOP, id: 'desktop' }];
    const api = {
        _frames: frames,
        depth() { return frames.length; },
        top() { return frames[frames.length - 1]; },
        reset() { frames.length = 1; return api; },
        push(level, id, onExit) {
            frames.push({ level: String(level || VIEW_LEVEL.APP), id: String(id || ''), onExit });
            return api;
        },
        /** 出栈一级。根层级（desktop）不可再退 → 返回 {shook:true} 让 UI 抖动。 */
        back() {
            if (frames.length <= 1) return { shook: true, level: VIEW_LEVEL.DESKTOP };
            const top = frames.pop();
            try { top.onExit && top.onExit(); } catch (_e) { /* 出栈回调不抛 */ }
            return { shook: false, level: api.top().level, popped: top };
        }
    };
    return api;
}

/** B 键按下的位移反馈时长档（帧进，非平滑）。1px 抖动。 */
export const PX_BACK_NUDGE_MS = 90;

/** 桌面根层级抖动序列（translateX 像素步进，steps 帧进）。 */
export const PX_DESKTOP_SHAKE = Object.freeze([0, -2, 2, -2, 0]);

/* ---------------- 聚合壳微缩预览 ---------------- */
/** 生成聚合文件夹的 2×2 像素微缩色块阵列（取类目内前 4 个 App 的品牌色）。
 *  返回 SVG 片段字符串（不含外层 <svg>），供像素图标生成器拼装。 */
export function folderMiniSwatches(colors) {
    const c = (Array.isArray(colors) ? colors : []).slice(0, 4);
    const pad = [PX_PALETTE.pink, PX_PALETTE.orange, PX_PALETTE.ltgreen, PX_PALETTE.ltblue];
    while (c.length < 4) c.push(pad[c.length]);
    const pos = [[7, 11], [11, 11], [7, 15], [11, 15]];
    return pos.map(([x, y], i) =>
        `<rect x="${x}" y="${y}" width="3" height="3" fill="${c[i]}"/>`
    ).join('');
}

/** 生成一枚完整的聚合文件夹像素 SVG（含底色方框 + 2×2 微缩预览）。
 *  返回**完整 SVG 字符串**（24×24、整数坐标、crispEdges）。 */
export function folderIconSvg(bgColor, memberColors) {
    const bg = bgColor || PX_PALETTE.blue;
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">'
        + `<rect x="1" y="1" width="22" height="22" fill="${bg}" stroke="${PX_PALETTE.black}" stroke-width="2"/>`
        + `<rect x="3" y="6" width="7" height="3" fill="${PX_PALETTE.cream}" stroke="${PX_PALETTE.black}" stroke-width="2"/>`
        + `<rect x="3" y="7" width="18" height="13" fill="${PX_PALETTE.cream}" stroke="${PX_PALETTE.black}" stroke-width="2"/>`
        + folderMiniSwatches(memberColors)
        + '</svg>');
}

/** 把 SVG 字符串转成可注入 background-image 的 data URI。 */
export function svgToDataUri(svgText) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(String(svgText || ''));
}
