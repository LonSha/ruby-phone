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
    /* [v4.93.0] 3px 无描边 → 5px 带黑描边：42px 图标下每颗迷你格≈15px，四色可辨。 */
    const pos = [[6, 11], [13, 11], [6, 16], [13, 16]];
    return pos.map(([x, y], i) =>
        `<rect x="${x}" y="${y}" width="5" height="5" fill="${c[i]}" stroke="${PX_PALETTE.black}" stroke-width="1"/>`
    ).join('');
}

/** 生成一枚完整的聚合文件夹像素 SVG（含底色方框 + 2×2 微缩预览）。
 *  返回**完整 SVG 字符串**（24×24、整数坐标、crispEdges）。 */
export function folderIconSvg(bgColor, memberColors) {
    const bg = bgColor || PX_PALETTE.blue;
    /* [v4.93.0] 真机反馈「桌面聚合壳只有一块空白米色方块」。
     *   旧版：分类色只做 1px 外框 + 主体是 cream 大矩形 + 迷你格 3px 无描边
     *   ⇒ 图标缩到 42px 时（每像素≈1.75px）cream 主体占满视野、4 个 3px 色块糊成一片，
     *   看起来就是「没有图标」。本版按**分类色做主体**重排：
     *     · 外层分类色实心方块（黑描边 2px）—— 一眼分辨是哪个类目；
     *     · 上部 tab 与下部卡片双线分层，卡片用 cream 内衬制造「文件夹」形；
     *     · 2×2 迷你格放大到 5px 并各自黑描边 —— 缩到桌面尺寸仍是四颗清楚的色点。
     *   像素纪律不变：整数坐标 / crispEdges / 无 <circle> / 无小数描边（B4 判据消费）。 */
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">'
        + `<rect x="1" y="2" width="22" height="20" fill="${bg}" stroke="${PX_PALETTE.black}" stroke-width="2"/>`
        + `<rect x="2" y="3" width="9" height="4" fill="${PX_PALETTE.black}"/>`
        + `<rect x="3" y="9" width="18" height="12" fill="${PX_PALETTE.cream}" stroke="${PX_PALETTE.black}" stroke-width="2"/>`
        + folderMiniSwatches(memberColors)
        + '</svg>');
}

/* ---------------- 像素 App 图标（dock / 通用小图标） ---------------- */
/** 各 App 的像素图案（24×24 整数坐标，只用 16 色盘）。
 *  真机反馈「dock 四个图标不是像素风」——它们原取 phone/*.png 512×512 拟物位图，
 *  与像素引擎的桌面/图形语言割裂。本表按 App 语义手绘像素图案，渲染层优先取它。
 *  每项 = [底色, 图案片段函数(颜色)]。图案一律整数坐标、crispEdges、无 <circle>。 */
const PX_GLYPHS = {
    /* 微信：绿底 + 双气泡 */
    wechat: [PX_PALETTE.green, () =>
        '<rect x="4" y="7" width="12" height="9" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="7" y="10" width="2" height="2" fill="' + PX_PALETTE.black + '"/>'
        + '<rect x="11" y="10" width="2" height="2" fill="' + PX_PALETTE.black + '"/>'
        + '<rect x="13" y="12" width="7" height="6" fill="' + PX_PALETTE.ltgreen + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'],
    /* 微博：橙底 + 喇叭/广播 */
    weibo: [PX_PALETTE.orange, () =>
        '<rect x="5" y="9" width="5" height="6" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="10" y="7" width="4" height="10" fill="' + PX_PALETTE.yellow + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="16" y="9" width="2" height="2" fill="' + PX_PALETTE.white + '"/>'
        + '<rect x="16" y="13" width="2" height="2" fill="' + PX_PALETTE.white + '"/>'],
    /* 通话：绿底 + 电话听筒 */
    phone: [PX_PALETTE.dkgreen, () =>
        '<rect x="6" y="5" width="4" height="6" fill="' + PX_PALETTE.ltgreen + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="14" y="13" width="4" height="6" fill="' + PX_PALETTE.ltgreen + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="8" y="9" width="4" height="3" fill="' + PX_PALETTE.ltgreen + '"/>'
        + '<rect x="12" y="11" width="4" height="3" fill="' + PX_PALETTE.ltgreen + '"/>'],
    /* 设置：灰底 + 齿轮（rect 拼齿，禁 circle） */
    settings: [PX_PALETTE.gray, () =>
        '<rect x="9" y="4" width="6" height="16" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="4" y="9" width="16" height="6" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="10" y="10" width="4" height="4" fill="' + PX_PALETTE.dkblue + '"/>'],
    /* 备忘录 / 日记：米色底 + 横线 */
    diary: [PX_PALETTE.brown, () =>
        '<rect x="6" y="4" width="12" height="16" fill="' + PX_PALETTE.cream + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="8" y="8" width="8" height="1" fill="' + PX_PALETTE.gray + '"/>'
        + '<rect x="8" y="11" width="8" height="1" fill="' + PX_PALETTE.gray + '"/>'
        + '<rect x="8" y="14" width="5" height="1" fill="' + PX_PALETTE.gray + '"/>'],
    /* 音乐：紫蓝底 + 音符 */
    music: [PX_PALETTE.dkblue, () =>
        '<rect x="14" y="5" width="2" height="10" fill="' + PX_PALETTE.white + '"/>'
        + '<rect x="10" y="7" width="6" height="2" fill="' + PX_PALETTE.white + '"/>'
        + '<rect x="8" y="13" width="5" height="5" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'],
    /* 相册：蓝底 + 风景 */
    album: [PX_PALETTE.ltblue, () =>
        '<rect x="4" y="6" width="16" height="12" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="6" y="12" width="5" height="4" fill="' + PX_PALETTE.green + '"/>'
        + '<rect x="12" y="10" width="6" height="6" fill="' + PX_PALETTE.blue + '"/>'
        + '<rect x="7" y="8" width="3" height="3" fill="' + PX_PALETTE.yellow + '"/>'],
    /* 日历：红底 + 网格 */
    calendar: [PX_PALETTE.red, () =>
        '<rect x="4" y="6" width="16" height="14" fill="' + PX_PALETTE.white + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="4" y="6" width="16" height="4" fill="' + PX_PALETTE.dkblue + '"/>'
        + '<rect x="7" y="12" width="3" height="3" fill="' + PX_PALETTE.gray + '"/>'
        + '<rect x="12" y="12" width="3" height="3" fill="' + PX_PALETTE.gray + '"/>'
        + '<rect x="7" y="16" width="3" height="2" fill="' + PX_PALETTE.gray + '"/>'],
    /* 游戏：红底 + 掌机方向键 */
    games: [PX_PALETTE.pink, () =>
        '<rect x="4" y="8" width="16" height="9" fill="' + PX_PALETTE.dkblue + '" stroke="' + PX_PALETTE.black + '" stroke-width="1"/>'
        + '<rect x="7" y="11" width="4" height="1" fill="' + PX_PALETTE.white + '"/>'
        + '<rect x="8" y="10" width="1" height="4" fill="' + PX_PALETTE.white + '"/>'
        + '<rect x="15" y="11" width="2" height="2" fill="' + PX_PALETTE.red + '"/>'
        + '<rect x="13" y="13" width="2" height="2" fill="' + PX_PALETTE.yellow + '"/>']
};

/** 取某 App 的像素图标 SVG（完整字符串，24×24）。未登记的 App 返回 null，
 *  由调用方回退到原有 defaultIcon / emoji 路径 —— 不改变能力面，只换呈现。 */
export function appIconSvg(appId) {
    const key = String(appId || '');
    const hit = PX_GLYPHS[key];
    if (!hit) return null;
    const [bg, glyph] = hit;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">'
        + '<rect x="1" y="1" width="22" height="22" fill="' + bg + '" stroke="' + PX_PALETTE.black + '" stroke-width="2"/>'
        + glyph()
        + '</svg>';
}


/** 把 SVG 字符串转成可注入 background-image 的 data URI。 */
export function svgToDataUri(svgText) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(String(svgText || ''));
}
