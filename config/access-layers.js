/* ============================================================
 * config/access-layers.js — 无障碍 / 窄屏 / 个性化「操作层」内核 [v3.93.0 · 拓展计划 R-X9]
 * ------------------------------------------------------------
 * 【计划出处】R-X9 无障碍、窄屏与个性化操作层（P2，规模 M）：
 *   功能点 ① 任务入口、收藏、最近使用与键盘 / 触摸可达性统一；
 *          ② 字体缩放、紧凑列表、低动画、深色模式；
 *          ③ 重要状态不只依赖颜色；
 *          ④ 320px 窄屏专门布局。
 *   验收：核心操作可通过键盘与触摸完成；放大字体后不遮挡按钮与状态；
 *        空 / 未知 / 失败 / 成功有文字或图标辅助；设置重开后保留，且按会话正确隔离。
 *
 * 【修前实测处境（不是推演）】
 *   · 键盘可达性没有统一出口：全仓 focus-visible 只在 5 个文件里有（phone.css 10 处 +
 *     diary / honey / music / wangxiang 各几处），且全部写在具体控件 ID 上
 *     （.yzp-frame-color-picker-close 这类）。桌面图标（renderAppIcon）与任务入口卡片
 *     一处都没有 —— 键盘用户在这两处看不见焦点，也 Tab 不过去。
 *   · aria-label 270 处、但没有任何地方统一回答「这个控件叫什么」：逐个控件手写，
 *     漏了不在运行时发现；而桌面图标的可读名（app.name）本来就在数据里，只是没接出来。
 *   · 窄屏只有 360px / 320px 两条零散规则：@media (max-width: 360px) 在 phone.css 有
 *     一条（只调颜色选择器）、honey.css 三条；320px 只有两条 max-width: 320px（那是
 *     宽度取值，不是媒体查询）。没有一条是「320px 专门布局」。
 *   · 字体缩放最大 130%：设置页与 font-scale 各有一份归一（Math.max(70, Math.min(130, …))），
 *     而设置页没有「放大后会不会遮挡」的任何判据 —— 计划验收那句「放大字体后不遮挡按钮
 *     与状态」在修前无法回答。
 *   · 「只用颜色表达状态」：全仓 .app-badge / .badge-notification / .phone-call-status-dot
 *     等 10+ 处状态标记只有色块，没有文字或图形辅助 —— 色觉障碍用户读到的是「有一个点」。
 *
 * 【本模块回答四个问题，只回答这四个】
 *   ① 这台机器该用哪一档「操作层」？resolveAccessLevel（用户显式档 > 系统政策 > 默认）。
 *   ② 一个控件该被念成什么？a11yNameOf（显式 aria-label > 文本 > 图形 > 如实空串，不编）。
 *   ③ 320px 窄屏上哪些布局要换？narrowPlan（列数 / 图标尺寸 / 是否保留 dock 标签）。
 *   ④ 状态能不能只靠颜色？markOf（四态各带文字与符号，颜色是附加不是唯一载体）。
 *
 * 【与既有真源的关系（不建第二份实现）】
 *   · 动效档位沿用 config/motion.js 的 MOTION_LEVELS（本模块只读它，不重定义）；
 *     个性化层的「低动画」直接落到那个键（sys_motion_level），不新开一个。
 *   · 字体缩放沿用 phone-font-scale 的既有归一（本模块只回答「放大到这一档会不会挤」，
 *     不重写归一）。
 *   · 深色模式不新定义颜色表：落成 data-theme 属性 + CSS 变量覆盖（见 phone.css）。
 *
 * 【零 IO / 零 DOM / 零 import 之外的依赖】
 *   不读时钟、不读存储、不联网、不碰 DOM；一切观测与环境由调用方注入。
 * ============================================================ */
'use strict';

/* ---------- ① 三档操作层 ---------- */
/** 操作层档位（互不相同、不得塌成两态）。 */
export const AX_LEVELS = Object.freeze({
    /** 标准：既有观感，不替用户加东西。 */
    STANDARD: 'standard',
    /** 增强：焦点环常显、状态带文字与符号、点击目标放大到 44px。 */
    ENHANCED: 'enhanced',
    /** 大字号：在增强之上把基准字号抬到最大档并加大行距。 */
    LARGE: 'large'
});
export const AX_LEVEL_LIST = Object.freeze(['standard', 'enhanced', 'large']);
/** 档位 storage 键（随会话隔离：命中 config/storage.js 的 /^sys_/）。 */
export const AX_LEVEL_KEY = 'sys_access_level';

/** 窄屏断点（单一真源：产品 CSS 与判据读同一份，禁止两处各写一遍）。 */
export const AX_NARROW_WIDTH = 320;
/** 窄屏「专门布局」生效的媒体串。 */
export const AX_NARROW_QUERY = '(max-width: ' + AX_NARROW_WIDTH + 'px)';

/** 点击目标最小边长（WCAG 2.2 AA 的 24px 是下限；本仓取 44px 为「增强档」目标）。 */
export const AX_TOUCH_MIN = 44;

/** 状态标记的四态（空 / 未知 / 失败 / 成功 —— 计划验收第三句的四项）。 */
export const AX_MARK_STATES = Object.freeze(['empty', 'unknown', 'fail', 'ok']);

/** 归一档位：未知输入一律回落标准（不猜用户想要什么）。 */
export function normalizeAccessLevel(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    return AX_LEVEL_LIST.indexOf(s) >= 0 ? s : AX_LEVELS.STANDARD;
}

/**
 * 问系统政策：是否要求更高对比 / 更少动效。
 * 无 matchMedia 或无该查询时返回 null（未知不报 false —— 与 motion.js 同规：
 *   「系统说不用」与「这里问不到」处置相反，塌成同形会让现场读数说谎）。
 * @returns {{moreContrast: (boolean|null), reducedMotion: (boolean|null)}}
 */
export function readAccessEnv(win) {
    const out = { moreContrast: null, reducedMotion: null };
    try {
        const w = win || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!w || typeof w.matchMedia !== 'function') return out;
        const pick = (q) => {
            const mq = w.matchMedia(q);
            return (mq && typeof mq.matches === 'boolean') ? mq.matches : null;
        };
        out.moreContrast = pick('(prefers-contrast: more)');
        out.reducedMotion = pick('(prefers-reduced-motion: reduce)');
    } catch (_e) { /* 无宿主 / 查询抛错 ⇒ 全 null（未知） */ }
    return out;
}

/**
 * 解析「本机现在该用哪一档操作层」。
 * 判据顺序本身就是口径：用户显式选择 > 系统政策 > 既有默认。
 * @param {string} userLevel storage 里存的档位
 * @param {{moreContrast?: (boolean|null)}} [env]
 * @returns {{level: string, source: string, contrast: (boolean|null)}} source ∈ user | policy | default
 */
export function resolveAccessLevel(userLevel, env) {
    const user = normalizeAccessLevel(userLevel);
    const e = env || {};
    if (user !== AX_LEVELS.STANDARD) return { level: user, source: 'user', contrast: (e.moreContrast === true ? true : null) };
    if (e.moreContrast === true) return { level: AX_LEVELS.ENHANCED, source: 'policy', contrast: true };
    return { level: AX_LEVELS.STANDARD, source: 'default', contrast: (e.moreContrast === true) };
}

/** 该档是否要把点击目标放大到 AX_TOUCH_MIN。 */
export function wantsLargeTargets(level) {
    const l = normalizeAccessLevel(level);
    return l === AX_LEVELS.ENHANCED || l === AX_LEVELS.LARGE;
}

/* ---------- ② 控件可读名（不让「没名字」与「名字是空」同形） ---------- */
/**
 * 求一个控件的可读名。按优先级取真源，取不到就如实返回空串 + 原因。
 * 为什么不自动兜底成「按钮」：那会把「这里没名字」变成「这里叫按钮」，
 *   读屏用户听到一串同样的「按钮」，而问题在读数上消失了。
 * @param {{ariaLabel?:*, label?:*, text?:*, icon?:*}} src
 * @returns {{name: string, from: string}} from ∈ aria | label | text | icon | none
 */
export function a11yNameOf(src) {
    const s = src || {};
    const pick = (v) => String(v === null || v === undefined ? '' : v).trim();
    const aria = pick(s.ariaLabel);
    if (aria) return { name: aria, from: 'aria' };
    const label = pick(s.label);
    if (label) return { name: label, from: 'label' };
    const text = pick(s.text);
    if (text) return { name: text, from: 'text' };
    const icon = pick(s.icon);
    if (icon) return { name: icon, from: 'icon' };
    return { name: '', from: 'none' };
}

/** 可读名是否算「够用」（够用才允许上屏做 aria-label）。 */
export function a11yNameUsable(res) {
    const r = res || {};
    return typeof r.name === 'string' && r.name.length > 0 && r.from !== 'none';
}

/**
 * 桌面图标的可读名（唯一实现，桌面视图与判据共用）。
 * 真源优先级：显式 aria-label > 自定义显示名 > App 名（不再加「图标」后缀 ——
 *   后缀会让「名字」与「角色」混在一起，读屏用户听到的是「微信图标 按钮」）。
 * @param {{ariaLabel?:*, displayName?:*, name?:*}} app
 */
export function iconA11yName(app) {
    const a = app || {};
    return a11yNameOf({ ariaLabel: a.ariaLabel, label: a.displayName, text: a.name });
}

/* ---------- ③ 320px 窄屏专门布局 ---------- */
/** 图标尺寸档（窄屏要换的就是这个与列数）。 */
export const AX_ICON_SIZES = Object.freeze({ normal: 58, narrow: 46, large: 68 });

/**
 * 生成窄屏布局方案（纯读数：调用方按它加类名，本模块不碰 DOM）。
 * 为什么要有这个函数而不是直接在 CSS 里写媒体查询：
 *   320px 上要改的不只是 CSS —— 列数变化会影响分页容量（home-screen.js 的每页张数），
 *   而分页容量是 JS 算的。两边各自写一个 320 就必然漂移（本仓「同一口径两份实现」的老账）。
 * @param {{width?:number, level?:string}} input 视口宽度与操作层档位
 * @returns {{narrow:boolean, cols:number, iconSize:number, showDockLabels:boolean, reason:string}}
 */
export function narrowPlan(input) {
    const i = input || {};
    const w = Number(i.width);
    const level = normalizeAccessLevel(i.level);
    const known = Number.isFinite(w) && w > 0;
    /* 宽度读不出 ⇒ 不判窄屏（如实退回标准列数），不猜。
     *   猜成窄屏会让桌面用户看到 320 布局；猜成宽屏会让 320 用户挤成一团。 */
    const narrow = known && w <= AX_NARROW_WIDTH;
    const big = level === AX_LEVELS.LARGE || level === AX_LEVELS.ENHANCED;
    const cols = narrow ? (big ? 3 : 4) : (big ? 3 : 4);
    const iconSize = narrow ? (big ? AX_ICON_SIZES.narrow + 6 : AX_ICON_SIZES.narrow)
        : (big ? AX_ICON_SIZES.large : AX_ICON_SIZES.normal);
    return {
        narrow: narrow,
        cols: cols,
        iconSize: iconSize,
        /* 窄屏保留 dock 文字：去掉文字会让 dock 变成一排无标签色块（验收③的反面）。 */
        showDockLabels: true,
        reason: !known ? '宽度读不出 ⇒ 不判窄屏（如实退回标准布局）'
            : (narrow ? ('视口 ' + String(w) + 'px ≤ ' + String(AX_NARROW_WIDTH) + 'px ⇒ 窄屏专门布局') : '标准布局')
    };
}

/* ---------- ③-b 字体档与「放大后不遮挡」守卫 ----------
 * 【为什么这一格必须在核心里，而不是散在 CSS 里】
 *   计划验收写的是「放大字体后不遮挡按钮与状态」。这是一句布局断言，
 *   而它能不能成立取决于两件事一起：字号放大到哪一档 × 这些行是「挤一挤」还是「换行」。
 *   若只在 CSS 里写死一个 130%，核心里算出来的档位与 CSS 认得的那一档就会漂移
 *   （本仓「同一口径两份实现」的老账），而漂移的后果恰恰是「用户以为放大了、
 *   界面却按小字号排」—— 不报错、只错观感。
 *   故：档位判定与守卫清单都在核心里，CSS 只按 data-font-band 落实。
 */
/** 字体档（单一真源：阈值 115% 与 phone-font-scale 的最大 130% 对齐）。 */
export const AX_FONT_BANDS = Object.freeze({ normal: 'normal', large: 'large' });
/** 进入「大字体档」的阈值（含）。 */
export const AX_FONT_LARGE_AT = 115;

/**
 * 归一字体百分比并给出档位。
 * 百分比读不出 ⇒ 归 normal 档（不判大：判大会让没设置过的人看到换行布局）。
 * @returns {{percent:number|null, band:string, known:boolean}}
 */
export function fontBandOf(percent) {
    let n = null;
    if (typeof percent === 'number' && isFinite(percent)) n = percent;
    else if (typeof percent === 'string' && percent.trim() !== '' && isFinite(Number(percent))) n = Number(percent);
    if (n === null) return { percent: null, band: AX_FONT_BANDS.normal, known: false };
    return { percent: n, band: n >= AX_FONT_LARGE_AT ? AX_FONT_BANDS.large : AX_FONT_BANDS.normal, known: true };
}

/**
 * 「放大后不遮挡」的守卫清单（调用方按它给容器加类，本模块不碰 DOM）。
 * 三件守卫各自回答一个具体的挤压面：
 *   · wrapActions  —— 按钮行溢出（放大后一行放不下两个按钮）；
 *   · growRows     —— 定高行（状态条 / 提示行）被文字顶破后压住下一行；
 *   · keepLabels   —— 放大时不许把文字标签换成图标（换了就只剩颜色/形状，验收③的反面）。
 * @param {{width?:number, level?:string}} plan narrowPlan 的结果
 * @param {number|string} fontPercent
 * @returns {{band:string, large:boolean, wrapActions:boolean, growRows:boolean, keepLabels:boolean, note:string}}
 */
export function overlapGuardOf(plan, fontPercent) {
    const p = plan || {};
    const f = fontBandOf(fontPercent);
    const large = f.band === AX_FONT_BANDS.large;
    const narrow = p.narrow === true;
    return {
        band: f.band,
        large: large,
        /* 大字体档或窄屏都要换行：两个条件各自独立成立（窄屏 + 标准字号一样会挤）。 */
        wrapActions: large || narrow,
        growRows: large,
        /* 任何档位都不许用图标替掉文字标签 —— 这一格刻意与档位无关。 */
        keepLabels: true,
        note: (f.known ? ('字号 ' + String(f.percent) + '% ⇒ ' + f.band + ' 档')
            : '字号读不出 ⇒ 按 normal 档排版（不判大）')
            + (narrow ? ' · 窄屏' : '')
            + (large ? ' · 按钮行换行、定高行改自适应' : '')
    };
}

/* ---------- ④ 状态标记：不只依赖颜色 ---------- */
/** 四态各一的文字与符号。互不相同且符号不撞（自检直接断言）。 */
export const AX_MARK_TEXT = Object.freeze({
    empty: '空',
    unknown: '未知',
    fail: '失败',
    ok: '成功'
});
export const AX_MARK_SYMBOL = Object.freeze({
    empty: '○',
    unknown: '？',
    fail: '×',
    ok: '✓'
});
/** 颜色是附加（色觉障碍下仍靠文字与符号可读），故单列且不参与判定。 */
export const AX_MARK_TONE = Object.freeze({
    empty: 'muted',
    unknown: 'muted',
    fail: 'bad',
    ok: 'good'
});

/**
 * 把任意状态读数归到四态之一。
 * 口径：认不出的状态归「未知」，不得归「成功」（把读不清说成好，是本仓最贵的形态）。
 * @param {string} raw
 * @returns {string} AX_MARK_STATES 之一
 */
export function normalizeMarkState(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    if (s === 'empty' || s === 'none' || s === 'zero') return 'empty';
    if (s === 'ok' || s === 'success' || s === 'done' || s === 'ready') return 'ok';
    if (s === 'fail' || s === 'failed' || s === 'error' || s === 'threw') return 'fail';
    if (s === 'unknown' || s === 'unreadable' || s === 'absent' || s === 'stale') return 'unknown';
    /* 空串单独成「空」而不是「未知」：本仓一直在治「没记过」与「记了但读不出」同形。 */
    if (s === '') return 'empty';
    return 'unknown';
}

/**
 * 生成一组状态标记（文字 + 符号 + 色调）。视图只能渲染这个结果，不得自己拼文案。
 * @param {string} raw 原始状态读数
 * @param {string} [detail] 附注（可为空）
 * @returns {{state:string, text:string, symbol:string, tone:string, detail:string, textFirst:string}}
 *   textFirst 是给 aria 用的纯文字形（「成功 ✓」）—— 色觉障碍与读屏都读得到这一格。
 */
export function markOf(raw, detail) {
    const st = normalizeMarkState(raw);
    const text = AX_MARK_TEXT[st];
    const symbol = AX_MARK_SYMBOL[st];
    return {
        state: st,
        text: text,
        symbol: symbol,
        tone: AX_MARK_TONE[st],
        detail: String(detail === null || detail === undefined ? '' : detail),
        textFirst: text + ' ' + symbol
    };
}

/** 一批状态标记：四态各一的计数（守恒面）。 */
export function markCountsOf(rows) {
    const out = { empty: 0, unknown: 0, fail: 0, ok: 0 };
    const list = Array.isArray(rows) ? rows : [];
    for (const r of list) out[normalizeMarkState(r)] += 1;
    return out;
}

/* ---------- 个性化：三件开关（紧凑列表 / 深色 / 低动画） ---------- */
/**
 * 个性化档的键面。键名刻意与既有真源一致：
 *   · 低动画不新开键 —— 它就是 sys_motion_level（写 still 即「低动画」）；
 *   · 字体缩放不新开键 —— 它就是 phone-font-scale。
 * 新开键 = 同一件事两个存储位 = 必然漂移（本仓治过多次）。
 *
 * ★ 三个键各自单列成 `*_KEY` 常量（而不是只藏在 AX_PREF_KEYS 里）：
 *   keys 门的抽键口径认的是「字面量出现在**键常量赋值**这类命名位置」（CONST_RE），
 *   或 storage 调用实参位置（CALL_RE）。只写在对象字面量里（`compact: '...'` 这种形）
 *   **两处都不认** ⇒ K3 会把登记判成幽灵放行条（本版实测踩到：K3 报了 compact / theme 两条）。
 *   AX_PREF_KEYS 由这三个常量组合而成，字面量仍只有一份。
 *   另注：本条注释**刻意不写键常量赋值的样例字面量** —— 写了会被 CONST_RE 当证据
 *   （本版实测踩到：注释里那三行样例让门禁多认出一个假键）。
 */
export const AX_COMPACT_KEY = 'sys_access_compact';
export const AX_THEME_KEY = 'sys_access_theme';
export const AX_PREF_KEYS = Object.freeze({
    compact: AX_COMPACT_KEY,
    theme: AX_THEME_KEY,
    level: AX_LEVEL_KEY
});
export const AX_THEMES = Object.freeze(['auto', 'light', 'dark']);

/** 归一主题档：未知回落 auto。 */
export function normalizeTheme(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    return AX_THEMES.indexOf(s) >= 0 ? s : 'auto';
}

/**
 * 解析主题（用户显式 > 系统政策 > 亮色）。
 * @returns {{theme: string, source: string, systemDark: (boolean|null)}}
 */
export function resolveTheme(userTheme, env) {
    const t = normalizeTheme(userTheme);
    const dark = (env && typeof env.dark === 'boolean') ? env.dark : null;
    if (t !== 'auto') return { theme: t, source: 'user', systemDark: dark };
    if (dark === true) return { theme: 'dark', source: 'policy', systemDark: dark };
    return { theme: 'light', source: 'default', systemDark: dark };
}

/** 读系统深色政策（无 matchMedia ⇒ null，未知不报 false）。 */
export function readDarkEnv(win) {
    try {
        const w = win || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!w || typeof w.matchMedia !== 'function') return null;
        const mq = w.matchMedia('(prefers-color-scheme: dark)');
        return (mq && typeof mq.matches === 'boolean') ? mq.matches : null;
    } catch (_e) { return null; }
}

/** 紧凑列表开关归一（只认 true/false；读不出 ⇒ false，因为它是「额外加的东西」）。 */
export function normalizeCompact(raw) {
    return raw === true || raw === 'true' || raw === 1 ? true : false;
}

/* ---------- 自检 ---------- */
/**
 * 结构自检（判据套件与诊断面共用）。
 * 断言的是四态 / 三档 / 三开关互不相同这类结构事实 —— 压平任何两态都会造出
 * 「两种处置相反的处境长得一模一样」，那正是本模块存在的理由。
 */
export function accessSelfCheck() {
    const problems = [];
    const texts = AX_MARK_STATES.map((k) => AX_MARK_TEXT[k]);
    if (new Set(texts).size !== AX_MARK_STATES.length) problems.push('四态文字必须互不相同');
    const syms = AX_MARK_STATES.map((k) => AX_MARK_SYMBOL[k]);
    if (new Set(syms).size !== AX_MARK_STATES.length) problems.push('四态符号必须互不相同');
    if (new Set(AX_MARK_STATES.map((k) => AX_MARK_TONE[k])).size < 2) problems.push('色调至少分两档');
    /* 认不出归未知（不得归成功）—— 这是本模块最容易被后人改坏的一格。 */
    if (normalizeMarkState('some-brand-new-state') !== 'unknown') problems.push('认不出的状态必须归未知');
    if (normalizeMarkState('') !== 'empty') problems.push('空串必须归空');
    if (new Set(AX_LEVEL_LIST).size !== 3) problems.push('三档操作层必须互不相同');
    if (AX_LEVEL_LIST.indexOf('standard') < 0) problems.push('默认档必须存在');
    /* 宽读不出不得判窄屏 */
    if (narrowPlan({ width: NaN }).narrow !== false) problems.push('宽度读不出不得判窄屏');
    if (narrowPlan({ width: 320 }).narrow !== true) problems.push('320px 必须判窄屏');
    if (narrowPlan({ width: 321 }).narrow !== false) problems.push('321px 不得判窄屏（断点是闭区间）');
    /* 名字取不到必须如实空串（不得编「按钮」） */
    if (a11yNameOf({}).name !== '') problems.push('名字取不到必须如实空串');
    if (a11yNameOf({}).from !== 'none') problems.push('名字取不到必须报 none');
    /* 主题与动效键不得与既有真源重名（重名就是把同一件事存在两处） */
    if (AX_PREF_KEYS.level === 'sys_motion_level') problems.push('操作层档位不得占用动效键');
    if (normalizeTheme('brand-new') !== 'auto') problems.push('认不出的主题必须回落 auto');
    /* 字体档：读不出不得判大（判大会让没设过的人看到换行布局） */
    if (fontBandOf(null).band !== AX_FONT_BANDS.normal) problems.push('字号读不出必须按 normal 档');
    if (fontBandOf(null).known !== false) problems.push('字号读不出必须报 known=false');
    if (fontBandOf(114).band !== AX_FONT_BANDS.normal) problems.push('114% 必须还在 normal 档');
    if (fontBandOf(AX_FONT_LARGE_AT).band !== AX_FONT_BANDS.large) problems.push('阈值处必须进 large 档');
    /* 遮挡守卫三格各自独立：不得塌成「全开」或「全关」 */
    const g0 = overlapGuardOf({ narrow: false }, 100);
    const g1 = overlapGuardOf({ narrow: false }, 130);
    const g2 = overlapGuardOf({ narrow: true }, 100);
    if (g0.wrapActions !== false || g0.growRows !== false) problems.push('标准档不得开守卫');
    if (g1.growRows !== true) problems.push('大字号必须开定高行守卫');
    if (g2.wrapActions !== true) problems.push('窄屏必须开按钮行换行守卫');
    if (g2.growRows !== false) problems.push('窄屏 + 标准字号不得开定高行守卫（两格独立）');
    if (g0.keepLabels !== true || g1.keepLabels !== true) problems.push('任何档位都不许用图标替掉文字标签');
    return {
        problems: problems,
        states: AX_MARK_STATES.length,
        levels: AX_LEVEL_LIST.length,
        bands: Object.keys(AX_FONT_BANDS).length,
        msgs: problems.length
    };
}

export default {
    AX_LEVELS, AX_LEVEL_LIST, AX_LEVEL_KEY, AX_NARROW_WIDTH, AX_NARROW_QUERY,
    AX_TOUCH_MIN, AX_MARK_STATES, AX_MARK_TEXT, AX_MARK_SYMBOL, AX_MARK_TONE,
    AX_ICON_SIZES, AX_PREF_KEYS, AX_THEMES, AX_FONT_BANDS, AX_FONT_LARGE_AT,
    normalizeAccessLevel, readAccessEnv, resolveAccessLevel, wantsLargeTargets,
    a11yNameOf, a11yNameUsable, iconA11yName,
    narrowPlan, fontBandOf, overlapGuardOf, normalizeMarkState, markOf, markCountsOf,
    normalizeTheme, resolveTheme, readDarkEnv, normalizeCompact,
    accessSelfCheck
};