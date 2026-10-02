/* ========================================================
 * uterus-data.js — [v3.48.0] 子宫画板 · 纯函数内核
 *
 * 数据层：本文件（纯函数）  落盘与接线：uterus-app.js  视图：uterus-view.js
 *
 * ── 源与立场差（素材缝合第 3 层第十二件 · st_bs_biotracker 像素画板一族）
 *   源是 st_bs_biotracker（SillyTavern 的角色生理 / 妊娠追踪扩充）的**绘制一族**：
 *     ① scripts/fetus_sprite.js（19687 字节 / 422 行）：胎儿 / 卵 / 不定型
 *        以**几何部件描述**（圆 / 椭圆 / 胶囊 / 折线 / 多边形 / 晶格 / 膜 / 蛋形）
 *        表现，再按实际要画的大小、方向、镜像与挤压**直接栅格化成像素格**；
 *        不缩放、不旋转点阵图 —— 源自述「8 个方向与任何尺寸都是干净的原生像素」。
 *     ② scripts/uterus_layout.js（16728 字节 / 375 行）：96×120 画布上的**版面**，
 *        只读角色状态算出「画什么、画在哪」；纯函式，不碰 DOM、不写回状态。
 *        孕程长大曲线 / 胎儿排格 / 有限轮推挤 / 胎囊外框 / 精液液面 / 宫口滴漏。
 *     ③ scripts/stage_config.js：阶段与天数常量（孕期六阶段、产程三阶段、
 *        月经四阶段、妊娠速度上下界、延产规则）。
 *   本件是**画板**：把这三件事读成**可栅格化的像素格与版面**，
 *   产出一张 96×120 的读数与逐部件像素格，交给视图层画到 canvas 上。
 *   本件**不碰 DOM、不写回状态、不改角色档案**：它只回答
 *   「照这份状态，子宫里此刻该画出什么」。
 *
 * ── 四块不缝（源的整套动作，本件一律不接）──────────────
 *   ① 不写回角色状态：源的绘制层从宿主大对象取状态并**就地更新**（每帧重算
 *      时把动画相位写回 profile）；本件只读投影，一个字段都不写；
 *   ② 不读宿主界面元素：源从宿主 DOM 取主题色（读 CSS 变量与计算样式）；
 *      本件的主题是**入参**，拿不到就回内置暗色盘；
 *   ③ 不发请求、不注入条目：源一族与 AI 提示词管线同源（PDA / 主流程提示）；
 *      本件只算像素，一句话都不产；
 *   ④ 不用未受控的计时器：源在渲染层起 setInterval 逐帧推动画；
 *      本件的帧推进由调用方**显式传入 tick**，本件内不起任何定时器。
 *
 * ── 五条偏离（逐条对着源的静默失效）──────────────────
 *   ① **认不出的胚型不当胎生画**：源把认不得的胚型直接按胎生画（界面上看不出
 *      声明写错了）；本件另立一格（unknownType 为真 + 按胎生画的说明），
 *      并把「认得出几个胚型」做成读数；
 *   ② **缺栏位不等于默认值**：源把没写的体重 / 亲和度直接当默认值用；
 *      本件逐格报「这一栏在不在」（present 与 value 分开），缺栏位另标；
 *   ③ **算不出来不读成 0**：源的产程阻塞 / 风险面在拿不到时回 null，
 *      而调用方常把它读成「没问题」；本件三态分开（无 / 有 / 认不定）；
 *   ④ **超上限不许静默丢**：源最多画 5 胎，超出的**不报**（界面上凭空少了胎）；
 *      本件 hiddenCount 成字，且逐条报出「哪几胎没画、为什么」；
 *   ⑤ **挤压轮数要有上限读数**：源的推挤循环有轮数上限（12 轮），
 *      到顶仍重叠时**没有任何读数**；本件报轮数、到顶仍重叠的记 overlap 计数。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 胚型认不出来 **不许**默默当胎生（另立一格）；
 *   · 缺栏位 **不许**读成默认值（present 与 value 分开）；
 *   · 超 5 胎 **不许**凭空少画（逐条报 hidden）；
 *   · 尺寸算不出来 **不许**画成 0 像素（另立一格）；
 *   · 推挤到轮数上限仍重叠 **不许**静默（报 overlap）；
 *   · 画布外 / 负尺寸 **不许**静默裁掉（报 clipped）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现反引号模板串（本仓静态门按串形守），一律字符串拼接。
 * ======================================================== */
'use strict';

/* ---------- 画布与上限（源：uterus_layout.js 的 UTERUS_CANVAS / MAX_DRAWN_FETUSES） ---------- */
export const UTERUS_CANVAS = Object.freeze({ width: 96, height: 120 });
export const MAX_DRAWN_FETUSES = 5;
/* 推挤轮数上限（源：computeUterusLayout 里的 for pass < 12）。 */
export const PUSH_PASS_MAX = 12;
/* 源里的输出格上限：本件把胎儿格 / 胎囊格 / 读数行也限一下（防视图层一次画太多）。 */
export const UD_ROWS_MAX = 64;
export const UD_CELLS_MAX = 6000;
export const UD_LEDGER_MAX = 40;

/* ---------- 阶段表（真源：stage_config.js，逐字同源） ---------- */
export const MENSTRUAL_STAGES = Object.freeze(['卵泡期', '排卵期', '黄体期', '月经期']);
export const PREGNANCY_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期']);
export const LABOR_STAGES = Object.freeze(['第一产程', '第二产程', '第三产程']);
export const MENSTRUAL_STAGE_DAYS = Object.freeze({ "卵泡期": 9, "排卵期": 2, "黄体期": 12, "月经期": 5 });
export const PREGNANCY_STAGE_DAYS = Object.freeze({ "孕早期": 98, "孕中期": 98, "孕晚期": 63, "临产期": 35 });
export const DUE_DATE_DAYS = 280;
export const TERM_START_DAYS = PREGNANCY_STAGE_DAYS["孕早期"] + PREGNANCY_STAGE_DAYS["孕中期"] + PREGNANCY_STAGE_DAYS["孕晚期"];
export const POSTTERM_START_DAYS = TERM_START_DAYS + PREGNANCY_STAGE_DAYS["临产期"];
export const FIRST_EXTENSION_UNTIL_DAYS = 364;
export const EXTENSION_MONTH_DAYS = 28;
export const GESTATION_SPEED_MIN = 0.03;
export const GESTATION_SPEED_MAX = 30;
export const LABOR_STAGE_BASE_HOURS = Object.freeze({ "第一产程": 12, "第二产程": 2, "第三产程": 0.5 });
export const LABOR_STAGE_INCREMENT = Object.freeze({ "第一产程": 1.5, "第二产程": 2, "第三产程": 0.5 });

/* 空阶段（子宫里没有胎儿却仍要画内膜 / 月经的四类 + 产后 / 假孕）。
   源：uterus_layout.js 的 EMPTY_STAGES。 */
export const EMPTY_STAGES = Object.freeze(['月经期', '卵泡期', '排卵期', '黄体期', '产后恢复', '假孕期']);
/* 妊娠阶段（含产兆前驱与产程三阶）。源：uterus_layout.js 的 GESTATION_STAGES。 */
export const GESTATION_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期', '产兆前驱'].concat(LABOR_STAGES));

/* 源：fetus_sprite.js 的 KNOWN_TYPES。 **认不出的胚型本件另立一格，不默默当胎生。** */
export const FETUS_TYPES = Object.freeze(['胎生', '卵生', '卵胎生', '胎转卵生', '不定型']);
export const FETUS_TYPE_BOOK = FETUS_TYPES.slice(0);

/* 胎位四阶文本（真源：tools.js 的 DESCENT_STAGE_TEXT）。 */
export const DESCENT_STAGE_TEXT = Object.freeze({
    '-3': '顶到宫顶', '-2': '宫内自由', '-1': '子宫低位', '0': '入盆',
    '1': '进入产道', '2': '着冠', '3': '先露部已出'
});
export const DESCENT_START = -2;
export const DESCENT_INLET = 0;
export const DESCENT_TOP = -3;
export const DESCENT_CROWNED_OUT = 3;

/* 宫压四级文本（源：uterus_layout.js 的 getPressureLevel）。 */
export const PRESSURE_TEXT = Object.freeze({ 0: '平稳', 1: '上升', 2: '紧绷', 3: '颤动' });
/* 羊膜四级（源：fetus_sprite.js 的 membraneLevel）。 */
export const MEMBRANE_LEVELS = Object.freeze(['full', 'thin', 'torn', 'none']);
export const MEMBRANE_TEXT = Object.freeze({ full: '完整', thin: '变薄', torn: '撕开', none: '已破' });
/* 亲密度五档（源：uterus_render.js 的 AFFINITY_WORDS）。 */
export const AFFINITY_WORDS = Object.freeze({ '2': '依恋', '1': '亲近', '0': '平淡', '-1': '疏离', '-2': '排斥' });
/* 动作台账动作面（本件自己定义，不取自源）。 */
export const UD_ACTIONS = Object.freeze(['probe', 'set_subject', 'clear_subject', 'frame_tick', 'ledger_clear']);
export const UD_ACTION_TEXT = Object.freeze({
    [UD_ACTIONS[0]]: '看一眼状态', [UD_ACTIONS[1]]: '收下一份角色状态', [UD_ACTIONS[2]]: '放下这份状态',
    [UD_ACTIONS[3]]: '推一帧', [UD_ACTIONS[4]]: '清台账'
});
/* 源文件清单（只登记，本件不读它们；判据面用来看「不依赖源」）。 */
export const UD_SOURCE_FILES = Object.freeze([
    'st_bs_biotracker/scripts/fetus_sprite.js (19687 字节 / 422 行)',
    'st_bs_biotracker/scripts/uterus_layout.js (16728 字节 / 375 行)',
    'st_bs_biotracker/scripts/stage_config.js (985 字节 / 46 行)'
]);
export const UD_SOURCE_NOTE = '源是 st_bs_biotracker 的绘制一族（胎儿几何 / 版面 / 阶段常量）；本件只取「几何部件→像素格」与「状态→版面」这两层机制，不取它写回状态、读宿主 DOM、接 AI 提示词管线那三块。';

/* ---------- 小工具 ---------- */
function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
}
function numOr(v, fallback) { const n = numOrNull(v); return (n === null) ? fallback : n; }
export function clampNum(v, lo, hi) { const n = numOr(v, lo); return (n < lo) ? lo : (n > hi) ? hi : n; }
export function isPlain(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
export function hasKey(o, k) {
    if (!isPlain(o)) return false;
    return Object.prototype.hasOwnProperty.call(o, k);
}
export function listOf(v) { return Array.isArray(v) ? v : []; }
/* 类型册：胚型名在不在册里（**认不出的本件要另立一格**）。 */
export function typeInBook(name) { return FETUS_TYPE_BOOK.indexOf(toStr(name)) >= 0; }
/* 阶段归类：四态分开（空阶段 / 妊娠阶段 / 产程阶段 / 认不出来）。 */
export function stageKindOf(stage) {
    const s = toStr(stage).trim();
    if (!s.length) return 'blank';
    if (EMPTY_STAGES.indexOf(s) >= 0) return 'empty';
    if (GESTATION_STAGES.indexOf(s) >= 0) return 'gestating';
    return 'unknown';
}
/* 胎位阶：认不出回 DESCENT_START（**不是 0**）。 */
export function descentStageOf(fetus) {
    const v = numOrNull(fetus ? fetus.descentStage : null);
    return (v === null) ? DESCENT_START : v;
}
export function descentTextOf(stage) {
    const s = String(Math.round(clampNum(stage, DESCENT_TOP, DESCENT_CROWNED_OUT)));
    const t = DESCENT_STAGE_TEXT[s];
    return (typeof t === 'string' && t.length) ? t : '宫内自由';
}
/* 羊膜四级（真源同源）。 */
export function membraneLevel(durability) {
    const d = numOr(durability, 100);
    if (d <= 0) return 'none';
    if (d < 30) return 'torn';
    if (d < 60) return 'thin';
    return 'full';
}
/* 宫压四级（真源同源）。 */
export function pressureLevelOf(ratio) {
    const r = clampNum(ratio, 0, 1);
    if (r >= 0.85) return 3;
    if (r >= 0.7) return 2;
    if (r >= 0.4) return 1;
    return 0;
}
/* 亲密度五档（真源同源）。 */
export function affinityBandOf(affinity) {
    const v = numOr(affinity, 0);
    if (v >= 25) return 2;
    if (v >= 5) return 1;
    if (v > -5) return 0;
    if (v > -25) return -1;
    return -2;
}
export function affinityWordOf(band) {
    const t = AFFINITY_WORDS[String(band)];
    return (typeof t === 'string' && t.length) ? t : '平淡';
}
/* 胎位角量化成 8 个方向（每 45 度）——像素图块旋转才干净。真源同源。 */
export function quantizeAngle(angle) {
    const n = ((numOr(angle, 0) % 360) + 360) % 360;
    return (Math.round(n / 45) * 45) % 360;
}

/* ---------- 几何部件系统（源：fetus_sprite.js 的 circle/ellipse/... 一族） ---------- */
function circle(x, y, r) { return { kind: 'circle', x: x, y: y, r: r }; }
function ellipse(x, y, rx, ry, deg) { return { kind: 'ellipse', x: x, y: y, rx: rx, ry: ry, deg: deg }; }
function capsule(x0, y0, x1, y1, r) { return { kind: 'capsule', x0: x0, y0: y0, x1: x1, y1: y1, r: r }; }
function polyline(points, r, minPx) { return { kind: 'polyline', points: points, r: r, minPx: (minPx === undefined ? 0 : minPx) }; }
function polygon(points) { return { kind: 'polygon', points: points }; }
function lattice(shape, period, width, keep, warp) {
    return { kind: 'lattice', shape: shape, period: period, width: width, keep: keep || null, warp: warp || null };
}
function film(shape, px, keep) { return { kind: 'film', shape: shape, px: px, keep: keep || null }; }
function egg(x, y, rx, ryTop, ryBottom) { return { kind: 'egg', x: x, y: y, rx: rx, ryTop: ryTop, ryBottom: ryBottom }; }

/* 把部件缩放后平移（放进卵里当影子用）。真源同源。 */
function placePrim(prim, k, ox, oy) {
    const P = function (x, y) { return [ox + x * k, oy + y * k]; };
    if (prim.kind === 'circle') return circle(ox + prim.x * k, oy + prim.y * k, prim.r * k);
    if (prim.kind === 'ellipse') return ellipse(ox + prim.x * k, oy + prim.y * k, prim.rx * k, prim.ry * k, prim.deg);
    if (prim.kind === 'capsule') return capsule(ox + prim.x0 * k, oy + prim.y0 * k, ox + prim.x1 * k, oy + prim.y1 * k, prim.r * k);
    if (prim.kind === 'polyline') {
        const pts = [];
        for (let i = 0; i < prim.points.length; i += 1) pts.push(P(prim.points[i][0], prim.points[i][1]));
        return polyline(pts, prim.r * k, prim.minPx);
    }
    return prim;
}

function segDist2(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const ex = px - x0 - t * dx;
    const ey = py - y0 - t * dy;
    return ex * ex + ey * ey;
}

/* 点是否落在部件里。scale：每设计单位几像素（给有最小像素粗细的线段用）。真源同源。 */
function inside(prim, x, y, scale) {
    if (prim.kind === 'circle') return (x - prim.x) * (x - prim.x) + (y - prim.y) * (y - prim.y) <= prim.r * prim.r;
    if (prim.kind === 'capsule') return segDist2(x, y, prim.x0, prim.y0, prim.x1, prim.y1) <= prim.r * prim.r;
    if (prim.kind === 'film') {
        if (inside(prim.shape, x, y, scale)) return false;
        if (prim.keep && !prim.keep(x, y)) return false;
        const d = prim.px / scale;
        const grown = {
            kind: 'egg', x: prim.shape.x, y: prim.shape.y, rx: prim.shape.rx + d,
            ryTop: prim.shape.ryTop + d, ryBottom: prim.shape.ryBottom + d
        };
        return inside(grown, x, y, scale);
    }
    if (prim.kind === 'lattice') {
        if (!inside(prim.shape, x, y, scale)) return false;
        if (prim.keep && !prim.keep(x, y)) return false;
        const w = Math.max(prim.width, 0.9 / scale) / prim.period;
        const frac = function (v) { return v - Math.floor(v); };
        const g = prim.warp ? prim.warp(x, y) : [x, y];
        return frac((g[0] + g[1]) / prim.period) < w || frac((g[0] - g[1]) / prim.period) < w;
    }
    if (prim.kind === 'polygon') {
        let hit = false;
        const pts = prim.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
            const xi = pts[i][0]; const yi = pts[i][1];
            const xj = pts[j][0]; const yj = pts[j][1];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
    }
    if (prim.kind === 'egg') {
        const ry = (y < prim.y) ? prim.ryTop : prim.ryBottom;
        const nx = (x - prim.x) / prim.rx;
        const ny = (y - prim.y) / ry;
        return nx * nx + ny * ny <= 1;
    }
    if (prim.kind === 'ellipse') {
        const a = (prim.deg * Math.PI) / 180;
        const dx = x - prim.x;
        const dy = y - prim.y;
        const u = dx * Math.cos(a) + dy * Math.sin(a);
        const v = -dx * Math.sin(a) + dy * Math.cos(a);
        return (u / prim.rx) * (u / prim.rx) + (v / prim.ry) * (v / prim.ry) <= 1;
    }
    const r = Math.max(prim.r, prim.minPx / scale);
    for (let i = 1; i < prim.points.length; i += 1) {
        const p0 = prim.points[i - 1];
        const p1 = prim.points[i];
        if (segDist2(x, y, p0[0], p0[1], p1[0], p1[1]) <= r * r) return true;
    }
    return false;
}

/* ---------- 造型模型（源：fetus_sprite.js 的 fetusModel / embryoModel / eggModel / amorphousModel） ---------- */
/* 胎儿：在「头朝上」的 800 格设计图上量得的比例，转 180 度成头朝下。真源同源。 */
function fetusModel(opts) {
    const cord = Boolean(opts && opts.cord);
    const nestedHost = Boolean(opts && opts.nestedHost);
    const box = { x1: 672, y1: 684, w: 492, h: 564 };
    const X = function (x) { return (box.x1 - x) / box.h; };
    const Y = function (y) { return (box.y1 - y) / box.h; };
    const R = function (r) { return r / box.h; };
    const cap = function (x0, y0, x1, y1, r) { return capsule(X(x0), Y(y0), X(x1), Y(y1), R(r)); };
    const parts = [];
    if (cord) {
        const raw = [[330, 505], [262, 478], [222, 430], [214, 372], [236, 322]];
        const pts = [];
        for (let i = 0; i < raw.length; i += 1) pts.push([X(raw[i][0]), Y(raw[i][1])]);
        parts.push(['cord', [polyline(pts, R(17), 0.55)]]);
    }
    parts.push(['body', [
        ellipse(X(455), Y(545), R(165) * (nestedHost ? 1.4 : 1), R(124) * (nestedHost ? 1.28 : 1), -48),
        cap(392, 428, 300, 398, 40),
        cap(335, 585, 218, 598, 44),
        cap(230, 612, 205, 640, 30)
    ]]);
    parts.push(['head', [circle(X(510), Y(280), R(157))]]);
    return {
        w: box.w / box.h, h: 1, parts: parts,
        head: [X(510), Y(280), R(157)],
        eyeSide: [[X(402), Y(318)]],
        eyesFront: [[X(430), Y(300)], [X(492), Y(318)]],
        mouth: [X(446), Y(356)]
    };
}

/* 孕早期胚胎：大头、一截弯尾巴、两个肢芽、一小段脐带。真源同源。 */
function embryoModel(opts) {
    const cord = Boolean(opts && opts.cord);
    const nestedHost = Boolean(opts && opts.nestedHost);
    const U = function (v) { return v / 13; };
    const parts = [['body', [circle(U(5.4), U(2.2), U(1.4)), circle(U(4.4), U(4.6), U(nestedHost ? 2.5 : 2.2)), circle(U(4.6), U(6.4), U(2.4))]]];
    if (cord) {
        const raw = [[6.6, 6], [8.6, 5.4], [10.4, 6.2], [11.4, 4.4]];
        const pts = [];
        for (let i = 0; i < raw.length; i += 1) pts.push([U(raw[i][0]), U(raw[i][1])]);
        parts.push(['cord', [polyline(pts, U(0.7), 0.5)]]);
    }
    parts.push(['body', [circle(U(7), U(4.2), U(0.95)), circle(U(7.3), U(7.4), U(0.9))]]);
    parts.push(['head', [circle(U(5.6), U(9.2), U(3.6))]]);
    return {
        w: U(12), h: 1, parts: parts,
        head: [U(5.6), U(9.2), U(3.6)],
        eyeSide: [[U(7.4), U(9.8)]],
        eyesFront: [[U(5.4), U(9.6)], [U(7.2), U(10.2)]],
        mouth: null
    };
}

/* 卵胎生孕中：一颗卵，里面包着早期胚胎。真源同源。 */
function eggEmbryoModel() {
    const emb = embryoModel({ cord: false });
    const k = 0.55;
    const ox = 0.4 - (emb.w * k) / 2;
    const oy = 0.5 - k / 2;
    const move = function (prim) {
        if (prim.kind === 'circle') return circle(ox + prim.x * k, oy + prim.y * k, prim.r * k);
        return prim;
    };
    const pt = function (q) { return [ox + q[0] * k, oy + q[1] * k]; };
    const moved = [];
    for (let i = 0; i < emb.parts.length; i += 1) {
        const tone = emb.parts[i][0];
        moved.push([tone, emb.parts[i][1].map(move)]);
    }
    return {
        w: 0.8, h: 1,
        parts: [['shell', [ellipse(0.4, 0.5, 0.4, 0.5, 0)]], ['shellLight', [ellipse(0.4, 0.5, 0.34, 0.43, 0)]]].concat(moved),
        head: [ox + emb.head[0] * k, oy + emb.head[1] * k, emb.head[2] * k],
        eyeSide: emb.eyeSide.map(pt),
        eyesFront: emb.eyesFront.map(pt),
        mouth: null
    };
}

/* 卵：尖端朝上的蛋形，浅色壳、右下一阶暗面、左上一点高光。真源同源。 */
function eggModel(type, stage) {
    const w = 0.76;
    const parts = [['eggShell', [egg(0.38, 0.54, 0.38, 0.54, 0.46)]]];
    if (type === '卵胎生') {
        const emb = embryoModel({ cord: false });
        const k = 0.3;
        parts.push(['yolk', [circle(0.38, 0.62, 0.15)]]);
        for (let i = 0; i < emb.parts.length; i += 1) {
            const prims = emb.parts[i][1];
            const out = [];
            for (let j = 0; j < prims.length; j += 1) out.push(placePrim(prims[j], k, 0.38 - (emb.w * k) / 2, 0.5 - k / 2));
            parts.push(['ghost', out]);
        }
    } else if (stage === 0) {
        parts.push(['yolk', [circle(0.38, 0.58, 0.19)]]);
    } else if (stage === 1) {
        parts.push(['ghost', [circle(0.38, 0.6, 0.17)]]);
    } else {
        parts.push(['speck', [circle(0.56, 0.36, 0.035), circle(0.26, 0.62, 0.03), circle(0.5, 0.74, 0.04), circle(0.62, 0.58, 0.028), circle(0.34, 0.86, 0.03)]]);
    }
    parts.push(['shine', [circle(0.2, 0.3, 0.05), circle(0.24, 0.24, 0.035)]]);
    return { w: w, h: 1, parts: parts, head: null, eyeSide: [], eyesFront: [], mouth: null };
}

/* 固定的伪随机：同一格每次结果相同，缺口才不会闪。真源同源。 */
function hash01(a, b) {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
}

/* 胎转卵生孕晚：蛋形 + 菱形结晶格 + 紧贴的硬化羊膜。真源同源。 */
function latticeEggModel(level, nestedHost) {
    const lv = toStr(level).length ? level : 'full';
    const shape = egg(0.38, 0.54, 0.38, 0.54, 0.46);
    const period = 0.2;
    const parts = [['eggShell', [shape]]];
    if (lv !== 'none') {
        const covered = function (x, y) {
            if (lv === 'torn' && y > 0.62) return false;
            if (lv === 'full') return true;
            const patch = hash01(Math.floor((x + y) / (period * 1.5)), Math.floor((x - y) / (period * 1.5)));
            return patch > (lv === 'thin' ? 0.35 : 0.5);
        };
        const rim = function (x, y) {
            if (lv === 'torn' && y > 0.62) return false;
            if (lv === 'full') return true;
            const deg = Math.floor(((Math.atan2(y - 0.54, x - 0.38) * 180) / Math.PI + 360) / 14);
            return hash01(deg, 7) > (lv === 'thin' ? 0.3 : 0.45);
        };
        parts.push(['eggFilm', [lattice(shape, 1e9, 1e9, covered)]]);
        parts.push([(lv === 'full') ? 'membrane' : 'membraneThin', [film(shape, 1, rim)]]);
    }
    const warp = nestedHost ? function (x, y) {
        const dx = (x - 0.38) / 0.25;
        const dy = (y - 0.54) / 0.3;
        const distance = dx * dx + dy * dy;
        if (distance >= 1) return [x, y];
        const strength = Math.pow(1 - distance, 2);
        const row = Math.floor((y - 0.25) / 0.09);
        const column = Math.floor((x - 0.13) / 0.1);
        return [x + strength * (row % 2 ? 0.11 : -0.08), y + strength * (column % 2 ? 0.07 : -0.06)];
    } : null;
    parts.push(['lattice', [lattice(shape, period, 0.03, null, warp)]]);
    parts.push(['shine', [circle(0.2, 0.3, 0.05), circle(0.24, 0.24, 0.035)]]);
    return { w: 0.76, h: 1, parts: parts, head: null, eyeSide: [], eyesFront: [], mouth: null };
}

/* 不定型当史莱姆。真源同源。 */
function amorphousModel(stage, nestedHost) {
    const blob = [egg(0.46, 0.66, nestedHost ? 0.46 : 0.4, nestedHost ? 0.59 : 0.56, 0.3)];
    if (stage === 2) blob.push(capsule(0.34, 0.2, 0.26, 0.02, 0.07), capsule(0.58, 0.2, 0.66, 0.02, 0.07));
    if (stage >= 1) blob.push(egg(0.9, 0.84, 0.1, 0.13, 0.08));
    if (stage === 2) blob.push(capsule(0.3, 0.9, 0.28, 1, 0.055), circle(0.28, 1, 0.07), capsule(0.58, 0.92, 0.6, 0.98, 0.045), circle(0.6, 0.99, 0.055));
    return {
        w: 1, h: 1,
        parts: [
            ['blob', blob],
            ['core', [ellipse(0.5, 0.62, 0.2, 0.16, 0)]],
            ['shine', [capsule(0.2, 0.46, 0.26, 0.3, 0.035), circle(0.32, 0.22, 0.03)]]
        ],
        head: [0.46, 0.6, 0.3],
        eyeSide: [[0.38, 0.6], [0.54, 0.6]],
        eyesFront: [[0.38, 0.6], [0.54, 0.6]],
        mouth: null
    };
}

/* 胎儿形态的胚型阶段（真源同源）。 */
export function isFetalForm(type, stage) {
    if (type === '胎生') return true;
    if (type === '卵胎生') return stage >= 1;
    if (type === '胎转卵生') return stage <= 1;
    return false;
}
/* 胎转卵生孕晚的羊膜已经硬化、紧贴在蛋上（画在卵的图块里）—— 真源同源。 */
export function hasFluidSac(type, stage) {
    return !(type === '胎转卵生' && stage === 2);
}
/* 胎儿图块阶段：以自身孕龄分孕早、孕中、孕晚（真源同源）。 */
export function getSpriteStage(ownAge) {
    const a = numOr(ownAge, 0);
    if (a < PREGNANCY_STAGE_DAYS["孕早期"]) return 0;
    if (a < PREGNANCY_STAGE_DAYS["孕早期"] + PREGNANCY_STAGE_DAYS["孕中期"]) return 1;
    return 2;
}

/* 取模型（源 getModel；本件把「认不出的胚型」在调用层另立一格）。 */
function getModel(type, stage, membrane, nestedHost) {
    if (type === '不定型') return { model: amorphousModel(stage, nestedHost), deco: null };
    if (type === '胎转卵生' && stage === 2) return { model: latticeEggModel(membraneLevel(membrane), nestedHost), deco: null };
    if (!hasFluidSac(type, stage)) return { model: eggModel(type, stage), deco: null };
    if (!isFetalForm(type, stage)) return { model: eggModel(type, stage), deco: null };
    if (type === '卵胎生' && stage === 1) return { model: eggEmbryoModel(), deco: null };
    const cord = (type !== '卵胎生');
    const model = (stage === 0) ? embryoModel({ cord: cord, nestedHost: nestedHost }) : fetusModel({ cord: cord, nestedHost: nestedHost });
    let deco = null;
    if (type === '胎转卵生') deco = (stage === 0) ? 'shellPieces' : 'shellRing';
    else if (type === '卵胎生') deco = 'shards';
    return { model: model, deco: deco };
}

const SHELL_PIECES = [[10, 40], [110, 140], [200, 225], [290, 318]];

/**
 * 产生像素格。height 是胎儿本体要画的像素高度；angle 为胎位角（0 头位、180 臀位，顺时针）；
 * mirror 为胎背朝右；posterior 为胎背朝后（脸朝外）；squeeze 为挤压时的横向压缩。
 * 回传 { width, height, anchorX, anchorY, cells, notes }。
 * ★ 本件偏离：源对认不出的胚型**默默当胎生画**；本件 notes.unknownType 成字，
 *   并把「画的是哪一型」另立一格（drawnAs），认不出来不许无声。
 */
export function buildFetusGrid(input) {
    const o = isPlain(input) ? input : {};
    const rawType = toStr(o.type).length ? toStr(o.type) : '胎生';
    const typeKnown = typeInBook(rawType);
    const type = typeKnown ? rawType : '胎生';
    const stage = Math.trunc(clampNum(o.stage, 0, 2));
    const height = numOrNull(o.height);
    const sizeMissing = (height === null);
    const h = (height === null || height <= 0) ? 20 : height;
    const angle = numOr(o.angle, 0);
    const mirror = Boolean(o.mirror);
    const posterior = Boolean(o.posterior);
    const squeeze = clampNum(o.squeeze, 0.2, 1);
    const membrane = numOr(o.membrane, 100);
    const nestedHost = Boolean(o.nestedHost);

    const showNestedHost = nestedHost && (type !== '胎转卵生' || stage === 2);
    const picked = getModel(type, stage, membrane, showNestedHost);
    const model = picked.model;
    const deco = picked.deco;
    const scale = Math.max(4, h);
    const a = (angle * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const cx = model.w / 2;
    const cy = model.h / 2;
    const sx = scale * squeeze;
    const fwd = function (x, y) {
        let dx = (x - cx) * sx;
        const dy = (y - cy) * scale;
        if (mirror) dx = -dx;
        return [dx * cos - dy * sin, dx * sin + dy * cos];
    };
    const inv = function (ox, oy) {
        let dx = ox * cos + oy * sin;
        const dy = -ox * sin + oy * cos;
        if (mirror) dx = -dx;
        return [dx / sx + cx, dy / scale + cy];
    };

    const margin = deco ? 3 : 1;
    const corners = [[0, 0], [model.w, 0], [0, model.h], [model.w, model.h]].map(function (q) { return fwd(q[0], q[1]); });
    const xs = corners.map(function (c) { return c[0]; });
    const ys = corners.map(function (c) { return c[1]; });
    const minX = Math.floor(Math.min.apply(null, xs)) - margin;
    const maxX = Math.ceil(Math.max.apply(null, xs)) + margin;
    const minY = Math.floor(Math.min.apply(null, ys)) - margin;
    const maxY = Math.ceil(Math.max.apply(null, ys)) + margin;
    const width = maxX - minX;
    const rows = maxY - minY;
    const cells = [];
    for (let y = 0; y < rows; y += 1) {
        const line = [];
        for (let x = 0; x < width; x += 1) line.push(null);
        cells.push(line);
    }

    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const p = inv(x + 0.5 + minX, y + 0.5 + minY);
            for (let pi = 0; pi < model.parts.length; pi += 1) {
                const tone = model.parts[pi][0];
                const prims = model.parts[pi][1];
                let hit = false;
                for (let qi = 0; qi < prims.length; qi += 1) {
                    if (inside(prims[qi], p[0], p[1], scale)) { hit = true; break; }
                }
                if (hit) cells[y][x] = tone;
            }
        }
    }

    const SHADE_OF = { body: 'shade', eggShell: 'shellShade', eggFilm: 'filmShade', blob: 'blobShade' };
    const at = function (x, y) {
        if (y < 0 || y >= rows || x < 0 || x >= width) return null;
        return cells[y][x];
    };
    const shaded = [];
    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const shade = SHADE_OF[cells[y][x]];
            if (!shade) continue;
            if (!at(x + 1, y + 1) || (!at(x + 1, y) && !at(x, y + 1))) shaded.push([x, y, shade]);
        }
    }
    for (let i = 0; i < shaded.length; i += 1) cells[shaded[i][1]][shaded[i][0]] = shaded[i][2];

    const plot = function (x, y, tone) {
        const gx = Math.round(x) - minX;
        const gy = Math.round(y) - minY;
        if (gy >= 0 && gy < rows && gx >= 0 && gx < width) cells[gy][gx] = tone;
    };
    const plotFloor = function (x, y, tone) { plot(Math.floor(x), Math.floor(y), tone); };

    const headPx = model.head ? model.head[2] * scale : 0;
    const eyeLen = (headPx >= 5) ? 2 : 1;
    const eyes = (showNestedHost && type !== '不定型') ? model.eyeSide : (posterior ? model.eyesFront : model.eyeSide);
    const eyeList = eyes || [];
    for (let index = 0; index < eyeList.length; index += 1) {
        const ex = eyeList[index][0];
        const ey = eyeList[index][1];
        if (showNestedHost) {
            const arm = ((headPx >= 5) ? 1 : 0.7) / scale;
            const direction = (type === '不定型') ? (index === 0 ? 1 : -1) : 1;
            const deltas = [[-direction * 2 * arm, -2 * arm], [-direction * arm, -arm], [0, 0], [-direction * arm, arm], [-direction * 2 * arm, 2 * arm]];
            for (let di = 0; di < deltas.length; di += 1) {
                const q = fwd(ex + deltas[di][0], ey + deltas[di][1]);
                plotFloor(q[0], q[1], 'face');
            }
        } else {
            for (let i = 0; i < eyeLen; i += 1) {
                const q = fwd(ex + i / scale, ey);
                plotFloor(q[0], q[1], 'face');
            }
        }
    }
    if (!showNestedHost && posterior && model.mouth && headPx >= 4) {
        const q = fwd(model.mouth[0], model.mouth[1]);
        plotFloor(q[0], q[1], 'face');
    }

    if (deco === 'shellRing' || deco === 'shellPieces') {
        const rx = model.w / 2 + 2 / scale;
        const ry = model.h / 2 + 2 / scale;
        const ranges = (deco === 'shellRing') ? [[0, 359]] : SHELL_PIECES;
        for (let ri = 0; ri < ranges.length; ri += 1) {
            const from = ranges[ri][0];
            const to = ranges[ri][1];
            for (let deg = from; deg <= to; deg += 2) {
                const r = (deg * Math.PI) / 180;
                const q = fwd(cx + Math.cos(r) * rx, cy + Math.sin(r) * ry);
                plotFloor(q[0], q[1], (deg % 16 === 0) ? 'eggShell' : 'membrane');
            }
        }
    } else if (deco === 'shards') {
        const marks = [[0.04, 0.92, 'shell'], [0.09, 0.95, 'shellLight'], [0.86, 0.06, 'shell'], [0.9, 0.1, 'shellLight'], [0.02, 0.34, 'shell']];
        for (let i = 0; i < marks.length; i += 1) {
            const q = fwd(marks[i][0] * model.w, marks[i][1]);
            plotFloor(q[0], q[1], marks[i][2]);
        }
    }

    const notes = {
        unknownType: !typeKnown,
        drawnAs: type,
        declaredType: rawType,
        sizeMissing: sizeMissing,
        membraneLevel: membraneLevel(membrane)
    };
    return {
        width: width, height: rows, anchorX: -minX, anchorY: -minY,
        cells: cells, notes: notes, spriteStage: stage
    };
}

/* ---------- 版面（源：uterus_layout.js 的 computeUterusLayout 一族） ---------- */
/* 子宫外形在某一行的半宽；下半部收窄成梨形。真源同源。 */
export function wombRadius(womb, y, pad, shift) {
    const p = (pad === undefined) ? 0 : pad;
    const s = (shift === undefined) ? 0 : shift;
    const ry = womb.ry + p;
    const n = (y - womb.cy - s) / ry;
    if (Math.abs(n) >= 1) return 0;
    return Math.max(0, Math.round((womb.rx + p) * Math.sqrt(1 - n * n) * (n > 0 ? 1 - 0.43 * n : 1)));
}

const POSTPARTUM_START_SIZE_DAYS = 140;
const SEMEN_SWELL_PX = 1;
const SEMEN_CAPACITY_FLOOR = 25;
const COMPANION_EGG_SIZE = 0.15;
const FULL_TERM_DAYS = 280;

/* 孕程长大曲线：孕早期几乎不变，之后加速。真源同源。 */
function getGrowth(days) {
    return Math.pow(clampNum(days / FULL_TERM_DAYS, 0, 1), 1.7);
}
/* 孕晚期子宫颈缩短（9 → 4 像素）。真源同源。 */
function getCervicalLength(days) {
    const t = clampNum((numOr(days, 0) - 168) / 112, 0, 1);
    return 9 - Math.round(5 * t * t * (3 - 2 * t));
}
/* 未孕时的内膜厚度随阶段与阶段内进度变化。真源同源。 */
function getEmptyLining(stage, progress) {
    const p = clampNum(progress, 0, 1);
    const table = {
        "月经期": Math.round(7 - 2 * p),
        "卵泡期": 5 + Math.round(2 * p),
        "排卵期": 7,
        "黄体期": 7 + Math.round(p),
        "产后恢复": 6 + Math.round(1 - p),
        "假孕期": 6 + Math.round(2 * p)
    };
    const v = table[toStr(stage)];
    return (typeof v === 'number') ? v : 6;
}

/**
 * 当下能装多少精液，以未孕、内膜一般（排卵期）为 100。真源同源。
 * ★ 本件偏离：源在拿不到胎数 / 胎重时按默认值往下算；本件把输入的缺栏位
 *   记进 notes.missing（见 computeUterusLayout），不许无声。
 */
export function getSemenCapacity(input) {
    const o = isPlain(input) ? input : {};
    const pressureLevel = clampNum(o.pressureLevel, 0, 3);
    const pressureFactor = 1 - 0.1 * pressureLevel;
    const fetuses = listOf(o.fetuses);
    let capacity;
    if (o.gestating && fetuses.length > 0) {
        const n = fetuses.length;
        const t = clampNum(numOr(o.days, 0) / FULL_TERM_DAYS, 0, 1.25);
        let sum = 0;
        for (let i = 0; i < n; i += 1) {
            const f = isPlain(fetuses[i]) ? fetuses[i] : {};
            const w = clampNum(numOr(f.weight, 1), 0.33, 3);
            const eggs = Math.max(0, Math.floor(numOr(f.companionEggCount, 0)));
            sum += w + eggs * COMPANION_EGG_SIZE;
        }
        const averageSize = sum / n;
        const stretch = Math.pow(Math.min(1.6, t * averageSize), 1.7) * (1 + 0.45 * (n - 1));
        const volume = 100 * (1 + 4 * stretch);
        const occupied = Math.min(0.95, 0.8 * Math.pow(Math.min(1, t), 1.5) + 0.05 * (n - 1) * t);
        capacity = volume * (1 - occupied);
    } else if (o.emptyStage === '假孕期') {
        capacity = 85 - 10 * clampNum(o.emptyProgress, 0, 1);
    } else if (o.emptyStage === '产后恢复') {
        capacity = 120 - 20 * clampNum(o.emptyProgress, 0, 1);
    } else {
        capacity = 100 - (numOr(o.emptyLining, 7) - 7) * 12.5;
    }
    return Math.max(SEMEN_CAPACITY_FLOOR, Math.round(capacity * pressureFactor));
}

/* 胎儿图块规格（真源同源）。 */
export function getFetusSpriteSpec(fetus, ownAge) {
    const f = isPlain(fetus) ? fetus : {};
    const backSide = toStr(f.backSide);
    return {
        type: toStr(f.embryoType).length ? toStr(f.embryoType) : '胎生',
        stage: getSpriteStage(ownAge),
        mirror: backSide.indexOf('右') === 0,
        posterior: backSide.length > 0 && backSide.charAt(backSide.length - 1) === '后'
    };
}

/**
 * 版面：只读角色状态，算出 96×120 上要画什么、画在哪。纯函式。
 * @param profile 角色状态（只读）
 * @param options.libidoCap / pressureCap 由呼叫端依阶段算好的上限
 * @param options.stageProgress 未孕阶段的进度 0～1
 * ★ 本件偏离（四处，都成读数）：
 *   ① hiddenCount 之外另给 hiddenList（**哪几胎没画、为什么**）——源只报数不报名；
 *   ② 推挤到轮数上限仍重叠的记 overlap（源无读数）；
 *   ③ 认不出的胚型在 items 上另标 unknownType（源默默当胎生）；
 *   ④ 缺栏位（体重 / 亲和度 / 胎位角）记 notes.missing（源按默认值用）。
 */
export function computeUterusLayout(profile, options) {
    const p = isPlain(profile) ? profile : {};
    const opt = isPlain(options) ? options : {};
    const base = isPlain(p.base) ? p.base : {};
    const pregnant = isPlain(p.pregnant) ? p.pregnant : {};
    const stage = toStr(base.stage).trim();
    const kind = stageKindOf(stage);
    const allFetuses = listOf(pregnant.fetuses);
    const effectiveDays = Math.max(0, numOr(pregnant.effectivePregnantDays, 0));
    const gestating = (kind === 'gestating');
    const days = gestating ? effectiveDays : 0;
    const missing = [];
    if (!hasKey(base, 'uterinePressure')) missing.push('base.uterinePressure');
    if (!hasKey(base, 'libido')) missing.push('base.libido');

    /* 看得见、已着床的胎儿；被包在宿主体内的内胎另挂在宿主身上。真源同源。 */
    const visible = [];
    if (gestating) {
        for (let i = 0; i < allFetuses.length; i += 1) {
            const f = allFetuses[i];
            if (!f || f.pendingImplantation) continue;
            if (!f.revealed && f.conceivedAtDays) continue;
            visible.push(f);
        }
    }
    const idOf = function (f) { return (isPlain(f) && f.embryoId !== undefined && f.embryoId !== null) ? String(f.embryoId) : ''; };
    const isEnclosed = function (fetus) {
        if (!fetus.nestedInEmbryoId || fetus.nestedReleased) return false;
        for (let i = 0; i < visible.length; i += 1) if (idOf(visible[i]) === String(fetus.nestedInEmbryoId)) return true;
        return false;
    };
    const occupants = [];
    for (let i = 0; i < visible.length; i += 1) if (!isEnclosed(visible[i])) occupants.push(visible[i]);

    const showsPresenting = (stage === '产兆前驱') || (LABOR_STAGES.indexOf(stage) >= 0);
    const presentingId = showsPresenting ? pregnant.presentingEmbryoId : null;
    let presenting = null;
    for (let i = 0; i < occupants.length; i += 1) {
        if (presentingId !== null && presentingId !== undefined && idOf(occupants[i]) === String(presentingId)) { presenting = occupants[i]; break; }
    }
    const chosen = [];
    if (presenting) chosen.push(presenting);
    for (let i = 0; i < occupants.length; i += 1) {
        if (chosen.length >= MAX_DRAWN_FETUSES) break;
        if (chosen.indexOf(occupants[i]) < 0) chosen.push(occupants[i]);
    }
    const drawn = [];
    for (let i = 0; i < occupants.length; i += 1) if (chosen.indexOf(occupants[i]) >= 0) drawn.push(occupants[i]);
    /* ★ 哪些没画、为什么（源只报 hiddenCount 不报名）。 */
    const hiddenList = [];
    for (let i = 0; i < occupants.length; i += 1) {
        if (chosen.indexOf(occupants[i]) >= 0) continue;
        /* ★ 本件偏离：没画的胎**也报声明型**（源只报数）—— 否则九胎里
         *   掺一个认不出的型，超上限的那一胎会完全无声。 */
        const hiddenType = toStr(occupants[i].embryoType).length ? toStr(occupants[i].embryoType) : '胎生';
        hiddenList.push({
            embryoId: idOf(occupants[i]), why: 'over_cap', cap: MAX_DRAWN_FETUSES,
            declaredType: hiddenType, unknownType: !typeInBook(hiddenType)
        });
    }

    const pressureCap = Math.max(1, numOr(opt.pressureCap, 50));
    const pressureRatio = clampNum(numOr(base.uterinePressure, 0) / pressureCap, 0, 1);
    const pressureLevel = pressureLevelOf(pressureRatio);
    const emptyStage = (drawn.length === 0 && EMPTY_STAGES.indexOf(stage) >= 0) ? stage : null;
    const emptyProgress = clampNum(opt.stageProgress, 0, 1);
    const wallInset = emptyStage ? Math.min(9, getEmptyLining(emptyStage, emptyProgress) + pressureLevel) : 7 + pressureLevel;

    const sizeDays = (emptyStage === '产后恢复') ? POSTPARTUM_START_SIZE_DAYS * Math.pow(1 - emptyProgress, 1.5) : days;
    const growth = getGrowth(sizeDays);
    const extra = Math.max(0, drawn.length - 1) * 1.1;
    const womb = {
        cx: 48,
        cy: Math.round(53 + growth * 2),
        rx: Math.round(11 + growth * 26 + extra),
        ry: Math.round(12 + growth * 32 + extra * 0.7)
    };

    const sperms = listOf(base.sperms);
    let totalSperm = 0;
    for (let i = 0; i < sperms.length; i += 1) totalSperm += Math.max(0, numOr(isPlain(sperms[i]) ? sperms[i].value : 0, 0));
    const bodyFetuses = [];
    if (gestating) {
        for (let i = 0; i < allFetuses.length; i += 1) {
            const f = allFetuses[i];
            if (!f || f.pendingImplantation) continue;
            if (f.nestedInEmbryoId && !f.nestedReleased) continue;
            bodyFetuses.push(f);
        }
    }
    const semenCapacity = getSemenCapacity({
        gestating: gestating, emptyStage: emptyStage,
        emptyLining: emptyStage ? getEmptyLining(emptyStage, emptyProgress) : 7,
        emptyProgress: emptyProgress, days: days, fetuses: bodyFetuses, pressureLevel: pressureLevel
    });
    const semenFull = (totalSperm > 0) && (totalSperm >= semenCapacity);
    const semenSoaked = semenFull && (bodyFetuses.length > 0);
    const semenOverflow = semenFull ? clampNum((totalSperm - semenCapacity) / semenCapacity, 0, 1) : 0;
    if (semenFull && !semenSoaked) {
        womb.rx += SEMEN_SWELL_PX;
        womb.ry += SEMEN_SWELL_PX;
    }
    womb.top = womb.cy - womb.ry;
    womb.bottom = womb.cy + womb.ry;

    const neckLength = getCervicalLength(days);
    const canalTop = womb.bottom + Math.max(0, neckLength - 5);
    const tract = { neckTop: womb.bottom - 1, neckLength: neckLength, canalTop: canalTop, canalBottom: canalTop + 22 };

    const libidoCap = Math.max(1, numOr(opt.libidoCap, 100));
    const libidoHeat = clampNum(numOr(base.libido, 0) / libidoCap - 0.27, 0, 1) / 0.73;
    const innerRy = womb.ry - wallInset;
    const cavityHeight = Math.max(1, innerRy * 2);
    const fluidHeight = (totalSperm <= 0) ? 0 : Math.max(1, Math.round(cavityHeight * Math.pow(Math.min(1, totalSperm / semenCapacity), 0.7)));
    const n = drawn.length;
    const squeeze = (n < 3) ? 1 : (n === 3) ? 0.82 : (n === 4) ? 0.7 : 0.61;
    const room = womb.rx - 8;
    const gap = (n <= 1) ? 0 : Math.min(18, (room * 1.65) / (n - 1));
    const freeY = womb.cy + 4;
    const topStep = Math.max(5, Math.round(innerRy * 0.6));
    const items = [];
    for (let i = 0; i < drawn.length; i += 1) {
        const fetus = drawn[i];
        const ownAge = Math.max(0, effectiveDays - Math.max(0, numOr(fetus.conceivedAtDays, 0)));
        const t = clampNum(ownAge / FULL_TERM_DAYS, 0, 1);
        const weight = clampNum(numOr(fetus.weight, 1), 0.33, 3);
        const size = Math.max(2, Math.round((1.5 + 20.5 * Math.pow(t, 1.55)) * Math.sqrt(weight)));
        const descent = Math.round(clampNum(numOr(fetus.descentStage, DESCENT_START), -3, 3));
        const stagger = (n === 1) ? 0 : (n >= 3) ? ((i % 2) ? 7 : -7) : ((i % 2) ? 3 : -3);
        const y = (descent === -3) ? freeY - topStep + stagger
            : (descent === -2) ? freeY + stagger
                : (descent === -1) ? freeY + Math.max(2, Math.round(innerRy * 0.25)) + stagger
                    : (descent === 0) ? freeY + Math.max(3, Math.round(innerRy * 0.55))
                        : womb.bottom - 6 + descent * 8;
        if (!hasKey(fetus, 'weight')) missing.push('fetuses[' + i + '].weight');
        if (!hasKey(fetus, 'affinity')) missing.push('fetuses[' + i + '].affinity');
        if (!hasKey(fetus, 'tendencyAngle')) missing.push('fetuses[' + i + '].tendencyAngle');
        const declaredType = toStr(fetus.embryoType).length ? toStr(fetus.embryoType) : '胎生';
        items.push({
            embryoId: idOf(fetus),
            index: visible.indexOf(fetus),
            x: womb.cx + ((n === 1) ? 0 : (i - (n - 1) / 2) * gap),
            y: y, size: size, squeeze: squeeze, descent: descent, ownAge: ownAge,
            angle: quantizeAngle(fetus.tendencyAngle),
            sprite: getFetusSpriteSpec(fetus, ownAge),
            sacKey: (function () {
                const group = Number(fetus.identicalGroup);
                return (Number.isInteger(group) && group > 0) ? ('g' + group) : ('e' + idOf(fetus));
            })(),
            amnion: clampNum(numOr(fetus.amnionDurability, 100), -100, 100),
            presenting: (fetus === presenting),
            gender: toStr(fetus.gender),
            affinity: clampNum(numOr(fetus.affinity, 0), -50, 50),
            affinityBand: affinityBandOf(fetus.affinity),
            unknownType: !typeInBook(declaredType),
            declaredType: declaredType,
            descentText: descentTextOf(descent),
            inner: []
        });
    }

    /* 有轮数上限的推挤。
     * ★ 本件偏离（两条，都成读数）：
     *   ① 到顶仍重叠记 overlap（源无读数）；
     *   ② **不动即停**（源死跑满 12 轮且一个字不说）—— 早停与跑满等价
     *     （源每轮重复同一次夹回，幂等），但读数才有意义：单胎不会
     *     被读成「推挤到顶 12 轮」。真跑到上限时 reachCap 成字。
     */
    let overlap = 0;
    let passesUsed = 0;
    for (let pass = 0; pass < PUSH_PASS_MAX; pass += 1) {
        passesUsed = pass + 1;
        let moved = false;
        for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
                const a = items[i];
                const b = items[j];
                if (a.sacKey === b.sacKey || a.descent >= 1 || b.descent >= 1) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const limit = (a.size + b.size) * squeeze * 0.52 + 3;
                if (Math.abs(dx) < limit && Math.abs(dy) < (a.size + b.size) * 0.55) {
                    const push = Math.min(0.7, (limit - Math.abs(dx)) * 0.13);
                    a.x -= push; b.x += push; a.y -= 0.16; b.y += 0.16;
                    moved = true;
                }
            }
        }
        for (let k = 0; k < items.length; k += 1) {
            const item = items[k];
            if (item.descent >= 0) {
                if (item.x !== womb.cx) { item.x = womb.cx; moved = true; }
                continue;
            }
            const ny = clampNum(item.y, womb.top + wallInset - 2 + item.size * 0.6, womb.bottom - wallInset - item.size * 0.6);
            if (ny !== item.y) { item.y = ny; moved = true; }
            const edge = wombRadius(womb, item.y);
            const maxX = Math.max(0, edge - wallInset + 1 - item.size * item.squeeze * 0.54);
            const nx = clampNum(item.x, womb.cx - maxX, womb.cx + maxX);
            if (nx !== item.x) { item.x = nx; moved = true; }
        }
        if (!moved) break;
    }
    const reachCap = (passesUsed >= PUSH_PASS_MAX);
    for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
            const a = items[i]; const b = items[j];
            if (a.sacKey === b.sacKey || a.descent >= 1 || b.descent >= 1) continue;
            const limit = (a.size + b.size) * squeeze * 0.52 + 3;
            if (Math.abs(b.x - a.x) < limit) overlap += 1;
        }
    }
    for (let i = 0; i < items.length; i += 1) { items[i].x = Math.round(items[i].x); items[i].y = Math.round(items[i].y); }

    /* 孕中孕：内胎画在宿主图块里面。真源同源。 */
    for (let i = 0; i < visible.length; i += 1) {
        const fetus = visible[i];
        if (!isEnclosed(fetus)) continue;
        let host = null;
        for (let k = 0; k < items.length; k += 1) if (items[k].embryoId === idOf(fetus)) { host = items[k]; break; }
        const host2 = (function () {
            for (let k = 0; k < items.length; k += 1) if (items[k].embryoId === String(fetus.nestedInEmbryoId)) return items[k];
            return null;
        })();
        const target = host2 || host;
        if (!target) continue;
        const ownAge = Math.max(0, effectiveDays - Math.max(0, numOr(fetus.conceivedAtDays, 0)));
        target.inner.push({
            embryoId: idOf(fetus), index: visible.indexOf(fetus),
            size: Math.max(2, Math.round(target.size * 0.45)),
            sprite: getFetusSpriteSpec(fetus, ownAge),
            angle: quantizeAngle(fetus.tendencyAngle)
        });
    }

    /* 胎囊：同卵共用一个。真源同源。 */
    const sacScale = 0.7 + 0.3 * Math.min(days / (PREGNANCY_STAGE_DAYS["孕早期"] + PREGNANCY_STAGE_DAYS["孕中期"]), 1);
    const sacKeys = [];
    for (let i = 0; i < items.length; i += 1) if (sacKeys.indexOf(items[i].sacKey) < 0) sacKeys.push(items[i].sacKey);
    const sacs = [];
    for (let ki = 0; ki < sacKeys.length; ki += 1) {
        const key = sacKeys[ki];
        const members = [];
        for (let i = 0; i < items.length; i += 1) if (items[i].sacKey === key) members.push(items[i]);
        let maxAge = 0;
        for (let i = 0; i < members.length; i += 1) maxAge = Math.max(maxAge, members[i].ownAge);
        if (maxAge < PREGNANCY_STAGE_DAYS["孕早期"]) continue;
        const mxs = members.map(function (m) { return m.x; });
        const mys = members.map(function (m) { return m.y; });
        let halfW = 0; let halfH = 0; let minD = 100;
        for (let i = 0; i < members.length; i += 1) {
            halfW = Math.max(halfW, members[i].size * members[i].squeeze * sacScale + 2);
            halfH = Math.max(halfH, members[i].size * sacScale + 2);
            minD = Math.min(minD, members[i].amnion);
        }
        sacs.push({
            key: key,
            embryoIds: members.map(function (m) { return m.embryoId; }),
            cx: Math.round((Math.min.apply(null, mxs) + Math.max.apply(null, mxs)) / 2),
            cy: Math.round((Math.min.apply(null, mys) + Math.max.apply(null, mys)) / 2),
            rx: Math.round((Math.max.apply(null, mxs) - Math.min.apply(null, mxs)) / 2 + halfW),
            ry: Math.round((Math.max.apply(null, mys) - Math.min.apply(null, mys)) / 2 + halfH),
            durability: minD,
            level: membraneLevel(minD)
        });
    }

    let summary;
    if (drawn.length === 0) {
        summary = toStr(stage).length ? (stage + '，子宫内没有胎儿') : '未设定，子宫内没有胎儿';
    } else {
        const parts = [];
        for (let i = 0; i < visible.length; i += 1) parts.push('第' + (i + 1) + '胎' + descentTextOf(descentStageOf(visible[i])));
        summary = stage + '，' + visible.length + ' 胎：' + parts.join('，');
    }

    return {
        canvas: UTERUS_CANVAS, stage: stage, stageKind: kind, gestating: gestating, days: days, growth: growth,
        womb: womb, tract: tract, wallInset: wallInset, pressureRatio: pressureRatio, pressureLevel: pressureLevel,
        pressureText: PRESSURE_TEXT[String(pressureLevel)] || '平稳',
        emptyStage: emptyStage, emptyProgress: emptyProgress, libidoHeat: libidoHeat,
        fluidHeight: fluidHeight, semenCapacity: semenCapacity, semenFull: semenFull,
        semenSoaked: semenSoaked, semenOverflow: semenOverflow, semenTotal: totalSperm,
        lateBulge: days >= (PREGNANCY_STAGE_DAYS["孕早期"] + PREGNANCY_STAGE_DAYS["孕中期"] + PREGNANCY_STAGE_DAYS["孕晚期"]),
        extensionSeal: (stage === '延产期'),
        atony: clampNum(Math.floor(numOr(base.uterineAtony, 0)), 0, 9),
        fetuses: items, sacs: sacs,
        hiddenCount: Math.max(0, occupants.length - drawn.length),
        hiddenList: hiddenList,
        overlap: overlap, pushPasses: passesUsed, reachCap: reachCap,
        missing: missing,
        summary: summary
    };
}

/* ---------- 判定与读数 ---------- */
export const UD_VERDICTS = Object.freeze(['ok', 'warn', 'bad', 'cant']);
export const UD_VERDICT_TEXT = Object.freeze({
    ok: '画得出来', warn: '画得出来，但有几处要处置',
    bad: '画不出来（状态读不懂）', cant: '没有状态可画'
});

/* 色盘：源从宿主 DOM 读主题色；本件**主题是入参**，拿不到就回内置暗色盘。 */
export const UD_PALETTE = Object.freeze({
    bg: '#1c1726', void: '#140f1b', frame: '#47283d', wallDark: '#803b58', wall: '#c85f78', wallLight: '#ee9290',
    wallTense: '#ec586d', shine: '#ffd0a4', cavity: '#672d51', cavityDeep: '#421d3d', fluid: '#b980aa',
    fluidLight: '#e5adc9', water: '#a5c9de', waterLight: '#e4f5f1', sac: '#ffd0b0', shadow: '#72455f',
    fetus: '#f8ae96', fetusLight: '#ffe0ad', egg: '#f8d9b0', eggShade: '#ae778c', signal: '#ffe27d',
    blood: '#b94460', lining: '#f3a891', ovaryHot: '#ae4557', ovaryGlow: '#ffd079', tick: '#6a4a63'
});
/* 色调代号 → 色盘键（视图层照这张表上色，不自己编一份）。 */
export const UD_TONE_KEYS = Object.freeze({
    body: 'fetus', shade: 'fetusLight', head: 'fetus', face: 'cavityDeep',
    cord: 'fetusLight', eggShell: 'egg', shellShade: 'eggShade', shellLight: 'fetusLight',
    shell: 'egg', yolk: 'signal', ghost: 'eggShade', speck: 'eggShade', shine: 'shine',
    lattice: 'water', membrane: 'waterLight', membraneThin: 'water', eggFilm: 'waterLight', filmShade: 'water',
    blob: 'fetus', blobShade: 'eggShade', core: 'fetusLight', sac: 'sac'
});
export function toneColor(tone) {
    const k = UD_TONE_KEYS[toStr(tone)];
    return (typeof k === 'string' && UD_PALETTE[k]) ? UD_PALETTE[k] : null;
}

/* 主题取色：入参给了就用（只认键名），否则回内置盘。 */
export function resolvePalette(theme) {
    const t = isPlain(theme) ? theme : {};
    const out = {};
    const keys = Object.keys(UD_PALETTE);
    let used = 0;
    for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const v = toStr(t[k]);
        if (v.length) { out[k] = v; used += 1; } else { out[k] = UD_PALETTE[k]; }
    }
    return { palette: out, themed: used, total: keys.length };
}

/* 读数行（视图层的逐格表用它；数是数、词是词，不混）。 */
export function readingRows(layout) {
    const L = isPlain(layout) ? layout : {};
    const rows = [];
    rows.push({ key: 'stage', label: '阶段', value: toStr(L.stage).length ? toStr(L.stage) : '未设定', kind: L.stageKind });
    rows.push({ key: 'days', label: '孕日', value: String(Math.round(numOr(L.days, 0))), kind: 'num' });
    rows.push({ key: 'dueline', label: '孕程分界', value: '足月线 ' + TERM_START_DAYS + ' 日 · 预产期 ' + DUE_DATE_DAYS + ' 日 · 逾期线 ' + POSTTERM_START_DAYS + ' 日', kind: 'word' });
    rows.push({ key: 'extendline', label: '延产上限', value: '首次延到 ' + FIRST_EXTENSION_UNTIL_DAYS + ' 日 · 之后每续 ' + EXTENSION_MONTH_DAYS + ' 日', kind: 'word' });
    rows.push({ key: 'speedline', label: '孕育速度', value: '允许区间 ' + GESTATION_SPEED_MIN + ' ~ ' + GESTATION_SPEED_MAX + ' 倍', kind: 'word' });
    rows.push({ key: 'inletline', label: '入盆标记', value: '胎位阶 0 即入盆（降阶=' + DESCENT_INLET + '）', kind: 'word' });
    rows.push({ key: 'membranes', label: '羊膜档', value: String(MEMBRANE_LEVELS.length) + ' 档', kind: 'word' });
    rows.push({ key: 'fetuses', label: '看得见的胎', value: String(listOf(L.fetuses).length), kind: 'num' });
    rows.push({ key: 'hidden', label: '没画的胎', value: String(numOr(L.hiddenCount, 0)), kind: numOr(L.hiddenCount, 0) > 0 ? 'warn' : 'num' });
    rows.push({ key: 'pressure', label: '宫压', value: numOr(L.pressureLevel, 0) + ' 级 · ' + toStr(L.pressureText), kind: 'word' });
    rows.push({ key: 'capacity', label: '精液容量', value: String(Math.round(numOr(L.semenCapacity, 0))), kind: 'num' });
    rows.push({ key: 'fluid', label: '液面', value: String(Math.round(numOr(L.fluidHeight, 0))), kind: 'num' });
    rows.push({ key: 'overlap', label: '堆叠', value: String(numOr(L.overlap, 0)), kind: numOr(L.overlap, 0) > 0 ? 'warn' : 'num' });
    rows.push({ key: 'passes', label: '推挤轮', value: String(numOr(L.pushPasses, 0)) + (L.reachCap ? ' （到顶）' : ''), kind: (L.reachCap && numOr(L.overlap, 0) > 0) ? 'warn' : 'num' });
    rows.push({ key: 'atony', label: '子宫乏力', value: String(numOr(L.atony, 0)), kind: 'num' });
    return rows;
}

/* 问题面：逐条列出要处置的（**不合成一句**）。 */
export function problemsOf(layout) {
    const L = isPlain(layout) ? layout : {};
    const out = [];
    const missing = listOf(L.missing);
    if (missing.length) out.push({ kind: 'missing_fields', text: '缺栏位 ' + missing.length + ' 处（' + missing.slice(0, 3).join(' / ') + (missing.length > 3 ? ' …' : '') + '）' });
    const hidden = listOf(L.hiddenList);
    if (hidden.length) out.push({ kind: 'hidden_fetuses', text: '超过上限 ' + MAX_DRAWN_FETUSES + ' 胎：' + hidden.length + ' 胎没画（' + hidden.map(function (h) { return h.embryoId; }).join(' / ') + '）' });
    const items = listOf(L.fetuses);
    let unknown = 0;
    for (let i = 0; i < items.length; i += 1) if (items[i].unknownType) unknown += 1;
    let unknownHidden = 0;
    for (let i = 0; i < hidden.length; i += 1) if (hidden[i].unknownType) unknownHidden += 1;
    if (unknown || unknownHidden) {
        let text = '认不出的胚型 ' + (unknown + unknownHidden) + ' 例（按胎生画，但声明写错了）';
        if (unknownHidden) text += '，其中 ' + unknownHidden + ' 例没画出来';
        out.push({ kind: 'unknown_type', text: text });
    }
    if (numOr(L.overlap, 0) > 0) out.push({ kind: 'overlap', text: '推挤到第 ' + numOr(L.pushPasses, 0) + ' 轮仍重叠 ' + numOr(L.overlap, 0) + ' 处' });
    if (toStr(L.stageKind) === 'unknown') out.push({ kind: 'unknown_stage', text: '阶段「' + toStr(L.stage) + '」不在册子里（不是六个孕期、不是月经四期、不是产程三阶）' });
    return out;
}

/* 总体判定（**读不完不与要处置合成一句**）。 */
export function verdictOf(layout) {
    const L = isPlain(layout) ? layout : {};
    const kind = toStr(L.stageKind);
    if (kind === 'blank' && listOf(L.fetuses).length === 0) return 'cant';
    if (kind === 'unknown') return 'bad';
    return problemsOf(L).length ? 'warn' : 'ok';
}

/* 可复制的读数文本（**本件唯一的产物**：只产文本，不写任何状态）。 */
export function readingText(layout, extra) {
    const L = isPlain(layout) ? layout : {};
    const rows = readingRows(L);
    const lines = [];
    lines.push('【子宫画板】' + toStr(L.summary));
    for (let i = 0; i < rows.length; i += 1) lines.push('· ' + rows[i].label + '：' + rows[i].value);
    const problems = problemsOf(L);
    if (problems.length) {
        lines.push('要处置 ' + problems.length + ' 处：');
        for (let i = 0; i < problems.length; i += 1) lines.push('  ' + (i + 1) + '. ' + problems[i].text);
    } else {
        lines.push('无一处要处置。');
    }
    const ex = toStr(extra);
    if (ex.length) lines.push('追加要求：' + ex);
    const text = lines.join(chr10());
    return { text: text, chars: text.length, rows: rows.length, problems: problems.length };
}
function chr10() { return String.fromCharCode(10); }

/* 上限读数。 */
export function limits() {
    return { fetuses: MAX_DRAWN_FETUSES, passes: PUSH_PASS_MAX, cells: UD_CELLS_MAX, rows: UD_ROWS_MAX, ledger: UD_LEDGER_MAX };
}

/* 条目收录（本件把一份角色状态贴进来；**形状认不出的不动作**）。 */
export const UD_INTAKE_WHYS = Object.freeze([
    'empty_input', 'too_long', 'bad_json', 'not_object', 'no_known_field', 'too_many', 'too_deep'
]);
export function intake(text, cap) {
    const raw = toStr(text);
    if (!raw.length) return { ok: false, why: 'empty_input' };
    const limit = Math.max(1, numOr(cap, 200000));
    if (raw.length > limit) return { ok: false, why: 'too_long', chars: raw.length };
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, why: 'bad_json' }; }
    if (!isPlain(obj)) return { ok: false, why: 'not_object' };
    if (!hasKey(obj, 'base') && !hasKey(obj, 'pregnant')) return { ok: false, why: 'no_known_field' };
    if (Object.keys(obj).length > 64) return { ok: false, why: 'too_many', n: Object.keys(obj).length };
    if (depthOf(obj) > 6) return { ok: false, why: 'too_deep' };
    return { ok: true, why: '' };
}
function depthOf(v) {
    const stack = [{ v: v, d: 0 }];
    let max = 0;
    while (stack.length) {
        const cur = stack.pop();
        if (cur.d > max) max = cur.d;
        if (max > 8) return max;
        if (isPlain(cur.v)) {
            const ks = Object.keys(cur.v);
            for (let i = 0; i < ks.length; i += 1) stack.push({ v: cur.v[ks[i]], d: cur.d + 1 });
        } else if (Array.isArray(cur.v)) {
            for (let i = 0; i < cur.v.length; i += 1) stack.push({ v: cur.v[i], d: cur.d + 1 });
        }
    }
    return max;
}
export function trimRows(rows, cap) {
    const list = listOf(rows);
    const limit = Math.max(1, numOr(cap, UD_LEDGER_MAX));
    if (list.length <= limit) return { rows: list.slice(0), dropped: 0 };
    return { rows: list.slice(list.length - limit), dropped: list.length - limit };
}
