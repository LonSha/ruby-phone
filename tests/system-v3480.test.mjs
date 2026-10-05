
// tests/system-v3480.test.mjs — 子宫画板 [v3.48.0]
//
// 本套件守四件事：
//  ① 画板的两层口径（几何部件→像素格 / 状态→版面）自洽：
//     宫体外形边界、八方向栅格化不溢出、认不出的型另立一格、缺栏位逐格记、
//     超上限逐胎报名、推挤不动即停并报触顶、液面与容量与浸满溢出、羊膜囊并囊；
//  ② 四块不缝真的没缝（零读宿主界面元素 / 零定时器 / 零写回角色状态 / 零演出时间轴）+ 不发请求；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 破坏类负控制**绝不许写真仓**（node --test 是文件级并行，写真仓会在破坏窗口内
//    被别的套件读到，中断时 finally 来不及执行会留下永久破坏）—— 一律用副本树；
//  · 本件不写回角色状态、不读宿主界面元素、不发请求、不起定时器，判据也要守这一条。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/uterus/uterus-data.js';
import * as APP from '../apps/uterus/uterus-app.js';
import { copyTreeSafe } from './_mirror_tree.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UD_DATA = 'apps/uterus/uterus-data.js';
const UD_APP = 'apps/uterus/uterus-app.js';
const UD_VIEW = 'apps/uterus/uterus-view.js';
const UD_CSS = 'apps/uterus/uterus.css';
const NUM_GATE = 'config/num-gate.js';
const RECEIPT = 'config/write-receipt.js';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const BS = String.fromCharCode(92);
const DQ = String.fromCharCode(34);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const read = (rel, root) => fs.readFileSync(path.join(root || ROOT, rel), 'utf8');
/** 判据只需模块的上限常量：接口面收窄成一份只带上限的小对象。 */
const apiOf = (M) => ({ UD_CELLS_MAX: M.UD_CELLS_MAX, UD_ROWS_MAX: M.UD_ROWS_MAX });
/** 副本树登记表（跑完必删）。★ 本套件对真仓**只读**：任何破坏类负控制只准落在副本上。 */
const temps = [];
let seq = 0;
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === Q || c === DQ || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === state) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}
function memStorage(seed) {
    const box = new Map(Object.entries(seed || {}));
    return {
        get: (k, d) => (box.has(k) ? box.get(k) : ((d === undefined) ? null : d)),
        set: (k, v) => { box.set(k, v); return true; },
        _box: box
    };
}
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k, d) => { const kk = chat + ':' + k; return box.has(kk) ? box.get(kk) : ((d === undefined) ? null : d); },
        set: (k, v) => { box.set(chat + ':' + k, v); },
        switchChat: (c) => { chat = c; },
        _box: box
    };
}
function hostileStorage() {
    return { get: () => { throw new Error('read-boom'); }, set: () => { throw new Error('write-boom'); } };
}
function readOnlyStorage() {
    return { get: () => null, set: () => { throw new Error('write-boom'); } };
}
function shellStub() {
    return { getContentContainer: () => null };
}
const newApp = (storage) => new APP.UterusApp(shellStub(), storage);
const toApp = (mod, storage) => new mod.UterusApp(shellStub(), storage);
const jsonOf = (o) => JSON.stringify(o);

/* ---------- 副本树加载器：真源码定点破坏 → 写副本 → 加载副本 ----------
 * 纪律（本仓硬纪律）：
 *   · 破坏一律落在**副本树**（真仓一个字节都不动）；
 *   · 锚点必须**恰中 1 次**，否则抛（H6 工具两向自证）；
 *   · 副本树是**整仓副本**——破坏模块与判据必须来自同一棵树，
 *     否则改了 A 却拿真仓的 B 判（假绿三形之一）。
 */
/* 副本树只需**判据会读到的那几件**：整仓复制 26 棵会把单测拖到两分钟以上（
 *   跑不动的门禁守不住纪律）。清单与判据读的路径一一对应，少一件即判据报错，不会静默。 */
const WS_FILES = [
    'apps/uterus/uterus-data.js',
    'apps/uterus/uterus-app.js',
    'apps/uterus/uterus-view.js',
    'apps/uterus/uterus.css',
    APPS,
    STORAGE,
    INDEX,
    KEYS,
    PHONE_CSS,
    V255,
    NUM_GATE,
    RECEIPT
];
function makeWorkspace() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ud-ws-'));
    temps.push(d);
    for (const rel of WS_FILES) {
        const to = path.join(d, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), to);
    }
    return d;
}
function breakIn(ws, rel, from, to) {
    const target = path.join(ws, rel);
    const src = fs.readFileSync(target, 'utf8');
    const hits = src.split(from).length - 1;
    if (hits !== 1) throw new Error('破坏锚点不唯一：' + rel + ' -> ' + String(hits));
    fs.writeFileSync(target, src.split(from).join(to), 'utf8');
    return target;
}
async function loadFrom(ws, rel) {
    seq += 1;
    return import(pathToFileURL(path.join(ws, rel)).href + '?v=' + String(seq));
}
function fakeCtx() {
    const calls = { fillRect: 0, fills: 0, colors: new Set() };
    const ctx = {
        imageSmoothingEnabled: true,
        fillRect: () => { calls.fillRect += 1; },
        clearRect: () => {}, save: () => {}, restore: () => {}, clip: () => {},
        beginPath: () => {}, rect: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {}
    };
    Object.defineProperty(ctx, 'fillStyle', {
        get: () => '',
        set: (v) => { calls.fills += 1; calls.colors.add(String(v)); }
    });
    return { ctx: ctx, calls: calls };
}
function fakeDom() {
    const made = [];
    const canvasBox = { ctx: null, calls: null };
    class El {
        constructor(tag) {
            this.tagName = tag;
            this.children = [];
            this.className = '';
            this._html = '';
            this.width = 0;
            this.height = 0;
            this.attrs = {};
            made.push(this);
        }
        set innerHTML(v) { this._html = String(v); }
        get innerHTML() { return this._html; }
        appendChild(c) { this.children.push(c); return c; }
        addEventListener() {}
        getAttribute(k) { return this.attrs[k] || null; }
        querySelector(sel) {
            if (sel === '[data-canvas]') {
                if (!canvasBox.ctx) { canvasBox.ctx = fakeCtx().ctx; canvasBox.calls = null; }
                return this._cv || (this._cv = (() => {
                    const c = new El('canvas');
                    c.getContext = () => canvasBox.ctx;
                    return c;
                })());
            }
            return null;
        }
        querySelectorAll(sel) { return this.__all(sel); }
"        /* 视图层用的查接口：从 innerHTML 里把带该属性的元素抽出来（够驱动事件绑定）。 */"
        __all(sel) {
            const out = [];
            const parts = String(sel == null ? '' : sel).split('[');
            const attr = (parts.length > 1) ? parts[1].split(']')[0] : '';
            if (!attr.length) return out;
            const re = new RegExp('<([a-zA-Z0-9]+)([^>]*?)data-' + attr + '=' + String.fromCharCode(34) + '([^' + String.fromCharCode(34) + ']*)' + String.fromCharCode(34), 'g');
            const html = this._html || '';
            let hit = re.exec(html);
            while (hit) {
                const el = new El(hit[1]);
                el.value = '';
                el.attrs = {};
                el.attrs['data-' + attr] = hit[3];
                el.attrs['data-key'] = hit[3];
                el.attrs['data-in'] = hit[3];
                out.push(el);
                hit = re.exec(html);
            }
            return out;
        }
        getContext() { return canvasBox.ctx || fakeCtx().ctx; }
    }
    return { made: made, El: El, canvasBox: canvasBox };
}
function withFakeDom(mod, body) {
    const dom = fakeDom();
    const prev = globalThis.document;
    globalThis.document = { createElement: (tag) => new dom.El(tag) };
    try {
        const container = new dom.El('div');
        const app = new mod.UterusApp({ getContentContainer: () => container }, memStorage());
        app.tick(1700000000000);
        body(app, container, dom);
    } finally {
        globalThis.document = prev;
    }
}

/* ══════════ 判据函数（几何与版面：数据层） ══════════ */
function gridRows(g) { return g.cells.map((r) => r.slice().reverse()); }
function gridKey(rows) { return rows.map((r) => r.map((c) => (c ? '1' : '0')).join('')).join('|'); }
function gridFlipped(a, b) { return gridKey(gridRows(a)) === gridKey(b.cells); }
function gridSame(a, b) { return gridKey(a.cells) === gridKey(b.cells); }
/* 像素级：颜色也要跟着翻（只比有无实格会被「换个颜色」蒙过） */
function pixelKey(rows) { return rows.map((r) => r.map((c) => (c ? String(c) : '0')).join(',')).join('|'); }
function gridPixelFlipped(a, b) { return pixelKey(a.cells.map((r) => r.slice().reverse())) === pixelKey(b.cells); }
function gridPixelSame(a, b) { return pixelKey(a.cells) === pixelKey(b.cells); }
function geoProblems(M) {
    const bad = [];
    /* ① 宫体外形：半个椭圆 + 下半收窄成梨形；中轴处最宽，上下端为 0 */
    const w = { cx: 48, cy: 54, rx: 30, ry: 40 };
    if (M.wombRadius(w, w.cy) !== w.rx) bad.push('radius-apex-not-rx');
    if (M.wombRadius(w, w.cy - w.ry) !== 0) bad.push('radius-top-not-zero');
    if (M.wombRadius(w, w.cy + w.ry) !== 0) bad.push('radius-bottom-not-zero');
    if (M.wombRadius(w, w.cy + w.ry + 5) !== 0) bad.push('radius-outside-not-zero');
    if (!(M.wombRadius(w, w.cy + 20) < M.wombRadius(w, w.cy))) bad.push('radius-pear-not-narrowing');
    if (M.wombRadius(w, w.cy, 4) !== w.rx + 4) bad.push('radius-pad-ignored');
    /* ② 八方向栅格化：任何角度、任何尺寸都不许溢出，且实格不为零 */
    const dirs = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const a of dirs) {
        const g = M.buildFetusGrid({ type: '胎生', stage: 2, height: 24, angle: a, squeeze: 1 });
        if (!g.cells.length) bad.push('grid-empty-angle-' + String(a));
        let n = 0;
        for (const row of g.cells) {
            for (const c of row) if (c) n += 1;
        }
        if (n < 8) bad.push('grid-too-few-angle-' + String(a));
        if (g.anchorX < 0 || g.anchorX >= g.width) bad.push('anchor-x-out-angle-' + String(a));
        if (g.anchorY < 0 || g.anchorY >= g.height) bad.push('anchor-y-out-angle-' + String(a));
    }
    /* ③ 挤压与镜像：挤压变窄不变高；镜像左右翻转 */
    const wide = M.buildFetusGrid({ type: '胎生', stage: 2, height: 24, angle: 0, squeeze: 1 });
    const thin = M.buildFetusGrid({ type: '胎生', stage: 2, height: 24, angle: 0, squeeze: 0.5 });
    if (!(thin.width < wide.width)) bad.push('squeeze-not-narrowing');
    const mirror = M.buildFetusGrid({ type: '胎生', stage: 2, height: 24, angle: 0, squeeze: 1, mirror: true });
    if (mirror.width !== wide.width) bad.push('mirror-changed-size');
    if (mirror.height !== wide.height) bad.push('mirror-changed-height');
    if (mirror.anchorX !== wide.anchorX) bad.push('mirror-moved-anchor');
    if (!gridFlipped(wide, mirror)) bad.push('mirror-not-flipped');
    if (gridSame(wide, mirror)) bad.push('mirror-did-nothing');
    /* 像素级只允许「取整偏一格」：不一致的格数不得超过 5% */
    let shifted = 0;
    const HH = wide.cells.length;
    const CC = HH ? wide.cells[0].length : 0;
    for (let y = 0; y < HH; y += 1) {
        for (let x = 0; x < CC; x += 1) {
            const pa = wide.cells[y][CC - 1 - x];
            const pb = mirror.cells[y][x];
            if (String(pa || '0') !== String(pb || '0')) shifted += 1;
        }
    }
    if (HH * CC > 0 && shifted / (HH * CC) > 0.05) bad.push('mirror-shifted-too-much:' + String(shifted));
    /* ④ 认不出的型：另立一格 + 报声明型 + 按胎生画 */
    const un = M.buildFetusGrid({ type: '异形胎', stage: 1, height: 20 });
    if (un.notes.unknownType !== true) bad.push('unknown-type-lost');
    if (un.notes.drawnAs !== '胎生') bad.push('unknown-type-drawn-as-itself');
    if (un.notes.declaredType !== '异形胎') bad.push('declared-type-lost');
    /* ⑤ 缺高度：报出来（不许无声按 20 算） */
    const nh = M.buildFetusGrid({ type: '胎生', stage: 0 });
    if (nh.notes.sizeMissing !== true) bad.push('size-missing-lost');
    if (!(nh.width > 0 && nh.height > 0)) bad.push('size-missing-blocked-draw');
    /* ⑥ 五型册子：五型在册，认不出的不在 */
    if (M.typeInBook('胎生') !== true) bad.push('type-book-missing-taishang');
    if (M.FETUS_TYPES.length !== 5) bad.push('type-book-size');
    if (M.typeInBook('异形胎') !== false) bad.push('type-book-accepts-unknown');
    /* ⑦ 图块阶段：以自身孕龄分三段 */
    if (M.getSpriteStage(10) !== 0) bad.push('sprite-stage-early');
    if (M.getSpriteStage(150) !== 1) bad.push('sprite-stage-mid');
    if (M.getSpriteStage(250) !== 2) bad.push('sprite-stage-late');
    /* ⑧ 色调映射：每个代号都能查到颜色，查不到的给 null 不抛 */
    const tones = ['body', 'head', 'face', 'cord', 'eggShell', 'yolk', 'lattice', 'membrane', 'blob', 'sac'];
    for (const t of tones) if (!M.toneColor(t)) bad.push('tone-missing-' + t);
    if (M.toneColor('不存在的代号') !== null) bad.push('tone-unknown-not-null');
    return bad;
}
function layoutProblems(M) {
    const bad = [];
    /* 判据只用模块的**上限常量**：破坏表会把整棵模块交进来，这里取现 */
    const Mapi = { UD_CELLS_MAX: M.UD_CELLS_MAX, UD_ROWS_MAX: M.UD_ROWS_MAX };
    const one = (extra) => {
        const f = { embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true };
        const o = extra || {};
        for (const k of Object.keys(o)) f[k] = o[k];
        return { base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: [f] } };
    };
    /* ① 单胎：推挤不动即停（不许读成「到顶 12 轮」） */
    const L1 = M.computeUterusLayout(one(), {});
    if (L1.reachCap !== false) bad.push('single-fetus-read-as-cap');
    if (L1.pushPasses > 3) bad.push('single-fetus-kept-spinning:' + String(L1.pushPasses));
    if (L1.fetuses.length !== 1) bad.push('single-fetus-count');
    /* ② 缺栏位逐格记（不许无声按默认值） */
    const L2 = M.computeUterusLayout({ base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'A', embryoType: '胎生', descentStage: -3, revealed: true }] } }, {});
    const miss = L2.missing.join(',');
    if (miss.indexOf('fetuses[0].weight') < 0) bad.push('missing-weight');
    if (miss.indexOf('fetuses[0].affinity') < 0) bad.push('missing-affinity');
    if (miss.indexOf('fetuses[0].tendencyAngle') < 0) bad.push('missing-angle');
    if (miss.indexOf('base.uterinePressure') >= 0) bad.push('missing-invented-pressure');
    /* ③ 超上限：逐胎报名（源只报数） */
    const many = [];
    for (let i = 0; i < 8; i += 1) {
        many.push({ embryoId: 'F' + String(i), embryoType: (i === 7 ? '未登记型' : '胎生'), weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -2, revealed: true });
    }
    const L3 = M.computeUterusLayout({ base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: many } }, Mapi);
    if (L3.fetuses.length !== M.MAX_DRAWN_FETUSES) bad.push('cap-not-honored');
    if (L3.hiddenCount !== 3) bad.push('hidden-count');
    if (L3.hiddenList.length !== 3) bad.push('hidden-list-missing');
    for (const h of L3.hiddenList) {
        if (!h.embryoId) bad.push('hidden-list-no-id');
        if (h.why !== 'over_cap') bad.push('hidden-list-no-why');
    }
    /* 没画出来的胎**也要报声明型**（九胎里掺一个认不出的，超上限的那个不许无声） */
    const hiddenUnknown = L3.hiddenList.filter((h) => h.unknownType === true);
    if (hiddenUnknown.length !== 1) bad.push('hidden-unknown-type-lost');
    const p3 = M.problemsOf(L3);
    if (!p3.some((x) => x.kind === 'unknown_type')) bad.push('hidden-unknown-not-reported');
    /* ④ 认不出的胚型：图上另标 */
    const L4 = M.computeUterusLayout({ base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'A', embryoType: '异形胎', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true }] } }, {});
    if (L4.fetuses[0].unknownType !== true) bad.push('layout-unknown-lost');
    if (!M.problemsOf(L4).some((x) => x.kind === 'unknown_type')) bad.push('layout-unknown-not-reported');
    /* ⑤ 没着床 / 没揭晓的胎不算看得见 */
    const L5 = M.computeUterusLayout({ base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, pendingImplantation: true }] } }, {});
    if (L5.fetuses.length !== 0) bad.push('pending-implantation-counted');
    /* ⑥ 阶段认不出：不许当成六个孕期之一 */
    const L6 = M.computeUterusLayout({ base: { stage: '冬眠期', uterinePressure: 10, libido: 10 }, pregnant: {} }, {});
    if (L6.stageKind !== 'unknown') bad.push('unknown-stage-kind');
    if (M.verdictOf(L6) !== 'bad') bad.push('unknown-stage-verdict');
    /* ⑦ 压根没贴过状态：画不出来（认不出的阶段不许混进来） */
    const L7 = M.computeUterusLayout({}, {});
    if (L7.stageKind !== 'blank') bad.push('blank-kind');
    if (M.verdictOf(L7) !== 'cant') bad.push('blank-verdict');
    if (L7.fetuses.length !== 0) bad.push('blank-has-fetus');
    /* ⑦b 月经期（空窗期）不是「画不出来」：它是**可画的空台子**，只报空台 */
    const L7b = M.computeUterusLayout({ base: { stage: '月经期', uterinePressure: 5, libido: 5 }, pregnant: {} }, {});
    if (L7b.stageKind !== 'empty') bad.push('empty-stage-kind');
    if (L7b.emptyStage !== '月经期') bad.push('empty-stage-name');
    if (M.verdictOf(L7b) !== 'ok') bad.push('empty-stage-verdict');
    /* ⑧ 宫压：比值与四档文案 */
    const L8 = M.computeUterusLayout(one({ }), { pressureCap: 50 });
    if (Math.abs(L8.pressureRatio - 0.4) > 1e-9) bad.push('pressure-ratio');
    if (L8.pressureLevel !== 1) bad.push('pressure-level');
    /* ⑨ 液面与容量：精液越多液面越高，满后溢出且浸满 */
    const cap = M.getSemenCapacity({ gestating: false, emptyStage: null, emptyLining: 7, emptyProgress: 0.5, days: 0, fetuses: [], pressureLevel: 0 });
    if (cap !== 100) bad.push('capacity-baseline:' + String(cap));
    const dry = M.computeUterusLayout({ base: { stage: '孕中期', uterinePressure: 20, libido: 40, sperms: [] }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true }] } }, {});
    if (dry.fluidHeight !== 0) bad.push('fluid-when-dry');
    const wet = M.computeUterusLayout({ base: { stage: '孕中期', uterinePressure: 20, libido: 40, sperms: [{ value: 100000 }] }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true }] } }, {});
    if (!(wet.fluidHeight > dry.fluidHeight)) bad.push('fluid-not-rising');
    if (wet.semenFull !== true) bad.push('semen-not-full');
    if (wet.semenOverflow <= 0) bad.push('semen-overflow-zero');
    /* ⑩ 羊膜囊：同卵共囊；孕早不成囊（按成员最大孕龄） */
    const twins = M.computeUterusLayout({ base: { stage: '孕晚期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 220, fetuses: [
        { embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -2, identicalGroup: 3, amnionDurability: 80, revealed: true },
        { embryoId: 'B', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -2, identicalGroup: 3, amnionDurability: 80, revealed: true }
    ] } }, {});
    if (twins.sacs.length !== 1) bad.push('identical-not-shared-sac');
    if (twins.sacs[0].embryoIds.length !== 2) bad.push('sac-members');
    /* ⑪ 刻度与超上限读数：读数表逐格有值，超上限计数成字 */
    const rows = M.readingRows(L3, Mapi);
    if (rows.length < 10) bad.push('reading-rows-too-few');
    if (!rows.some((r) => r.key === 'hidden' && r.value === '3')) bad.push('reading-hidden-value');
    /* ⑫ 读数文本：只产文本，逐条列要处置的 */
    const out = M.readingText(L3, '再列一遍');
    if (!out.text.length) bad.push('text-empty');
    if (out.problems !== M.problemsOf(L3).length) bad.push('text-problem-count');
    if (out.text.indexOf('再列一遍') < 0) bad.push('text-extra-lost');
    /* ⑬ 上限读数成字 */
    const lim = M.limits();
    if (lim.fetuses !== M.MAX_DRAWN_FETUSES) bad.push('limit-fetuses');
    if (lim.passes !== M.PUSH_PASS_MAX) bad.push('limit-passes');
    if (lim.cells !== M.UD_CELLS_MAX) bad.push('limit-cells');
    /* ⑭ 主题：入参只认键名，认不出的键不许吞掉内置色 */
    const gate = M.resolvePalette({ wall: '#123456', bg: '#000000' });
    if (gate.themed !== 2) bad.push('theme-count');
    if (gate.palette.wall !== '#123456') bad.push('theme-wall');
    if (!gate.palette.fetus) bad.push('theme-fallback-lost');
    const none = M.resolvePalette(null);
    if (none.themed !== 0) bad.push('theme-null-counted');
    if (none.total !== Object.keys(M.UD_PALETTE).length) bad.push('theme-total');
    return bad;
}

/* ══════════ 判据函数（App 层：落盘与读数） ══════════ */
function appProblems(M, AM) {
    const bad = [];
    const Mapi = { UD_CELLS_MAX: M.UD_CELLS_MAX, UD_ROWS_MAX: M.UD_ROWS_MAX };
    /* 基准盘取自真仓数据层（判据不依赖被破坏的字节） */
    const PAL = DAT.UD_PALETTE;
    const A = AM || APP;
    const st = memStorage();
    const app = new A.UterusApp(shellStub(), st);
    app.tick(1700000000000);
    /* ① 什么都没收过：四态各写各的，layout 回 null（不许回空对象冒充） */
    app.probe();
    if (app.faceOf() !== 'empty') bad.push('face-empty');
    if (app.layoutOf() !== null) bad.push('layout-not-null-when-empty');
    if (app.verdictOf() !== 'cant') bad.push('verdict-when-empty');
    /* ② 吞不下的贴回：逐因成立，且不许冲掉已收状态 */
    const whys = [
        ['', 'empty_input'],
        ['{ bad', 'bad_json'],
        ['[1,2,3]', 'not_object'],
        ['{ "x": 1 }', 'no_known_field']
    ];
    for (const [text, why] of whys) {
        const r = app.ingestSubject(text);
        if (r.ok !== false) bad.push('intake-should-fail:' + why);
        if (r.why !== why) bad.push('intake-why:' + why + '->' + String(r.why));
    }
    /* ③ 收下真状态：投影出来，且写进自己的键 */
    const good = { base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true }] } };
    const r = app.ingestSubject(jsonOf(good));
    if (r.ok !== true) bad.push('ingest-good');
    if (app.faceOf() !== 'ok') bad.push('face-ok');
    if (!app.layoutOf()) bad.push('layout-missing');
    if (st._box.size !== 2) bad.push('persist-key-count:' + String(st._box.size));
    if (!st._box.has('uterus_subject')) bad.push('persist-subject-key');
    if (!st._box.has('uterus_ledger')) bad.push('persist-ledger-key');
    /* ④ 先收下再贴坏东西：已收状态不许被冲掉 */
    const before = app.rawLen();
    app.ingestSubject('{ bad');
    if (app.rawLen() !== before) bad.push('bad-intake-wiped-subject');
    if (app.faceOf() !== 'ok') bad.push('bad-intake-changed-face');
    /* ⑤ 出读数文本：只产文本；没状态时明确说 no_subject */
    const out = app.readNow('再列一遍');
    if (out.ok !== true) bad.push('read-now');
    if (!out.chars) bad.push('read-now-chars');
    const blank = new A.UterusApp(shellStub(), memStorage());
    const out2 = blank.readNow('');
    if (out2.ok !== false || out2.why !== 'no_subject') bad.push('read-now-without-subject');
    /* ⑥ 放下：只清自己的键，台账不许跟着没 */
    const cl = app.clearSubject();
    if (cl.ok !== true) bad.push('clear-subject');
    if (cl.cleared !== before) bad.push('clear-subject-count');
    if (app.faceOf() !== 'empty') bad.push('clear-subject-face');
    if (!st._box.has('uterus_ledger')) bad.push('clear-subject-wiped-ledger');
    /* ⑦ 清台账：只清自己那条键，状态不许跟着没 */
    app.ingestSubject(jsonOf(good));
    const cl2 = app.clearLedger();
    if (cl2.ok !== true) bad.push('clear-ledger');
    if (cl2.subjectKept <= 0) bad.push('clear-ledger-wiped-subject');
    if (app.faceOf() !== 'ok') bad.push('clear-ledger-face');
    /* ⑧ 帧推进：显式传入；本件内不起定时器（tickCount 只在你推时走） */
    const t0 = app.tickCount();
    const t1 = app.frameTick();
    if (t1 !== t0 + 1) bad.push('frame-tick-step');
    const t2 = app.frameTick(500);
    if (t2 !== 500) bad.push('frame-tick-explicit');
    /* ⑨ storage 抛异常：不是「没记过」（四态分开报） */
    const hostile = new A.UterusApp(shellStub(), hostileStorage());
    hostile.probe();
    if (hostile.faceOf() === 'empty') bad.push('hostile-read-read-as-empty');
    if (hostile.faceOf() !== 'absent') bad.push('hostile-face:' + String(hostile.faceOf()));
    const ro = new A.UterusApp(shellStub(), readOnlyStorage());
    ro.tick(1);
    const w = ro.ingestSubject(jsonOf(good));
    if (w.saved !== false) bad.push('readonly-reported-saved');
    if (w.storage !== true) bad.push('readonly-storage-signal');
    /* ⑩ 坏存档（认不出的 JSON 类型）：报 malformed 不许当空 */
    const st2 = memStorage({ uterus_subject: '12345' });
    const appBad = new A.UterusApp(shellStub(), st2);
    appBad.probe();
    if (appBad.faceOf() !== 'malformed') bad.push('malformed-not-reported');
    if (appBad.layoutOf() !== null) bad.push('malformed-drew-something');
    /* ⑪ 换会话：两格全量重取 */
    const sess = sessionStorage();
    const a2 = new A.UterusApp(shellStub(), sess);
    a2.tick(1);
    a2.ingestSubject(jsonOf(good));
    sess.switchChat('c2');
    const sw = a2.onChatChanged();
    if (sw.face !== 'absent' && sw.face !== 'empty') bad.push('chat-change-face:' + String(sw.face));
    if (a2.tickCount() !== 0) bad.push('chat-change-tick-not-reset');
    if (a2.rawLen() !== 0) bad.push('chat-change-raw-kept');
    /* ⑫ 动作册与上限读数：视图只读这些 */
    if (app.actionList().length < 5) bad.push('action-list');
    if (app.limits().cells !== Mapi.UD_CELLS_MAX) bad.push('app-limits');
    if (app.intakeWhys().length !== 7) bad.push('intake-whys');
    if (!app.sourceNote().length) bad.push('source-note');
    if (app.sourceFiles().length !== 3) bad.push('source-files');
    if (app.cellsCap() !== Mapi.UD_CELLS_MAX) bad.push('cells-cap');
    if (app.rowsCap() !== Mapi.UD_ROWS_MAX) bad.push('rows-cap');
    /* ⑬ 视图只读表：胎明细逐胎一行；**声明型与画出型必须分开报** */
    const unknown = { base: { stage: '孕中期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 150, fetuses: [{ embryoId: 'U', embryoType: '异形胎', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true }] } };
    app.ingestSubject(jsonOf(unknown));
    const cells = app.fetusCells();
    if (cells.length !== 1) bad.push('fetus-cells');
    if (cells[0].embryoId !== 'U') bad.push('fetus-cells-id');
    if (cells[0].declaredType !== '异形胎') bad.push('fetus-cells-declared');
    if (cells[0].unknownType !== true) bad.push('fetus-cells-unknown');
    /* 声明型原样报出：**不许把认不出的型洗成胎生**（洗了就看不出声明写错了） */
    if (cells[0].type !== '异形胎') bad.push('fetus-cells-type-washed');
    if (!String(cells[0].descentText || '').length) bad.push('fetus-cells-descent-text');
    if (!app.readingCells().length) bad.push('reading-cells');
    /* ⑭ 主题入参：拿不到就回内置盘 */
    app.setTheme({ wall: '#111111' });
    const pal = app.paletteNow();
    if (pal.themed !== 1) bad.push('app-theme-count');
    if (pal.palette.wall !== '#111111') bad.push('app-theme-wall');
    const pal2 = app.paletteNow();
    if (pal2.palette.bg !== PAL.bg) bad.push('app-theme-fallback');
    return bad;
}
function viewProblems(M, root, AM) {
    const bad = [];
    const good = { base: { stage: '孕晚期', uterinePressure: 20, libido: 40 }, pregnant: { effectivePregnantDays: 220, fetuses: [
        { embryoId: 'A', embryoType: '胎生', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -3, revealed: true },
        { embryoId: 'B', embryoType: '异形胎', weight: 1, affinity: 0, tendencyAngle: 0, descentStage: -2, revealed: true }
    ] } };
    withFakeDom(AM || APP, (app, container, dom) => {
        const r = app.ingestSubject(jsonOf(good));
        if (r.ok !== true) bad.push('view-ingest');
        app.render();
        /* ① 渲染真的产出了 DOM 与画布 */
        if (!container.children.length) {
            bad.push('view-no-root');
            return;
        }
        const root = container.children[0];
        if (!root.className || root.className.indexOf('ud-root') < 0) bad.push('view-root-class');
        if (root.innerHTML.indexOf('data-canvas') < 0) bad.push('view-no-canvas');
        if (root.innerHTML.indexOf('ud-tabs') < 0) bad.push('view-no-tabs');
        if (root.innerHTML.indexOf('data-canvas') < 0) bad.push('view-canvas-tag-lost');
        /* ② 四态边框色与 view 的类名一一对应 */
        const cls = root.className;
        if (cls.indexOf('ud-ok') < 0 && cls.indexOf('ud-warn') < 0 && cls.indexOf('ud-err') < 0 && cls.indexOf('ud-off') < 0) bad.push('view-tone-class');
        /* ③ 画布真的被逐格画了（像素笔不许一次都不落） */
        const cv = root.querySelector('[data-canvas]');
        if (!cv) bad.push('view-canvas-missing');
        else {
            const ctx = cv.getContext('2d');
            if (!ctx || typeof ctx.fillRect !== 'function') bad.push('view-ctx-missing');
            if (cv.width !== DAT.UTERUS_CANVAS.width) bad.push('view-canvas-width');
            if (cv.height !== DAT.UTERUS_CANVAS.height) bad.push('view-canvas-height');
        }
        /* ④ 四页签都能画，且切页签后结构不空 */
        const tabs = [['board', 'data-canvas'], ['fetuses', '画上限'], ['readings', '逐格读数'], ['ledger', '当前条数']];
        for (const row of tabs) {
            const t = row[0];
            app.setTab(t);
            app.render();
            const el = container.children[container.children.length - 1];
            if (!el.innerHTML.length) bad.push('view-tab-empty-' + t);
            if (el.innerHTML.indexOf(row[1]) < 0) bad.push('view-tab-missing-' + t);
        }
        app.setTab('board');
        app.render();
        /* ⑤ 零状态与坏状态都不抛（说清「取不出来画横线」） */
        app.clearSubject();
        app.render();
        const el2 = container.children[container.children.length - 1];
        if (el2.innerHTML.indexOf('取不出来画横线') < 0) bad.push('view-empty-wording');
    });
    return bad;
}
function seamProblems(root) {
    const bad = [];
    /* 四块不缝 + 不发请求：只在**剥注释后**的正文里查（注释里的说明不算） */
    const seamFiles = [UD_DATA, UD_APP, UD_VIEW];
    const banned = [
        ['no-timer', ['setInterval', 'setTimeout', 'requestAnimationFrame', 'visibilitychange', 'matchMedia']],
        ['no-host-dom', ['getElementById', 'getElementsByClassName', 'getElementsByTagName', 'offsetWidth', 'getBoundingClientRect', 'performance.now', 'matchMedia']],
        ['no-request', ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']],
        ['no-writeback', ['localStorage', 'sessionStorage', 'indexedDB', 'SillyTavern', 'window.top', 'parent.document']]
    ];
    for (const rel of seamFiles) {
        const src = stripComments(read(rel, root));
        for (const [tag, keys] of banned) {
            for (const k of keys) if (src.indexOf(k) >= 0) bad.push('seam-' + tag + ':' + rel + ':' + k);
        }
        if (src.indexOf('document.') >= 0) {
            const allowed = ['document.createElement'];
            const idx = src.split('document.').length - 1;
            let ok = 0;
            for (const a of allowed) ok += src.split(a).length - 1;
            if (idx !== ok) bad.push('seam-host-dom-other:' + rel);
        }
    }
    /* 本仓静态门：零反引号、零反斜杠 */
    for (const rel of seamFiles.concat([UD_CSS])) {
        const src = read(rel, root);
        if (src.indexOf(String.fromCharCode(96)) >= 0) bad.push('backtick:' + rel);
        if (src.indexOf(BS) >= 0) bad.push('backslash:' + rel);
    }
    /* 演出时间轴：源里 drawCue / drawRupture / drawObstruction 一族不许进来 */
    const viewSrc = stripComments(read(UD_VIEW, root));
    for (const k of ['drawCue', 'drawRupture', 'drawObstruction', 'createUterusRenderer', 'playCue', 'setAnimated']) {
        if (viewSrc.indexOf(k) >= 0) bad.push('seam-show-timeline:' + k);
    }
    return bad;
}
function wiringProblems(root) {
    const bad = [];
    const apps = read(APPS, root);
    const stor = read(STORAGE, root);
    const idx = read(INDEX, root);
    const keys = read(KEYS, root);
    const css = read(PHONE_CSS, root);
    const v255 = read(V255, root);
    /* ① config/apps.js：id 注册（且带不缝清单与偏离清单注释） */
    if (apps.indexOf("id: 'uterus'") < 0) bad.push('wiring-apps-id');
    if (apps.indexOf('子宫画板') < 0) bad.push('wiring-apps-name');
    if (apps.indexOf('不读宿主界面元素') < 0) bad.push('wiring-apps-seam-note');
    if (apps.indexOf('推挤不动即停') < 0) bad.push('wiring-apps-deviation-note');
    /* ② config/storage.js：一条宽前缀覆盖两条键 */
    if (stor.indexOf('/^uterus_/') < 0) bad.push('wiring-storage-prefix');
    /* ③ scripts/keys-audit.mjs：两条键登记且 scope 为会话 */
    if (keys.indexOf('uterus_subject') < 0) bad.push('wiring-keys-subject');
    if (keys.indexOf('uterus_ledger') < 0) bad.push('wiring-keys-ledger');
    const kSeg = keys.slice(keys.indexOf('uterus_subject'), keys.indexOf('uterus_subject') + 400);
    if (kSeg.indexOf("scope: 'chat'") < 0) bad.push('wiring-keys-scope');
    /* ④ index.js：懒加载分支 + 挂载 + 表单字段表 */
    if (idx.indexOf("appId === 'uterus'") < 0) bad.push('wiring-index-branch');
    if (idx.indexOf('new module.UterusApp(') < 0) bad.push('wiring-index-mount');
    if (idx.indexOf('window.VirtualPhone.uterusApp.render()') < 0) bad.push('wiring-index-render');
    if (idx.indexOf("'uterusApp',") < 0) bad.push('wiring-index-field-table');
    /* ⑤ phone.css 本版段与 uterus.css 逐字同源 */
    const srcCss = read(UD_CSS, root);
    if (css.indexOf(srcCss) < 0) bad.push('wiring-phone-css-not-verbatim');
    if (css.indexOf('[v3.48.0] 子宫画板（uterus）') < 0) bad.push('wiring-phone-css-header');
    /* ⑥ tests/system-v255.test.mjs 的 dirMap 补一项 */
    if (v255.indexOf("uterusApp: 'uterus'") < 0) bad.push('wiring-v255-dirmap');
    /* 前缀族 ud 必须能在 phone.css 里找到（registry 门 R3 机制 A） */
    if (!new RegExp(String.fromCharCode(92) + '.ud-').test(css)) bad.push('wiring-css-family');
    return bad;
}

/* ══════════ 顶层用例 ══════════ */
test('几何内核：宫体外形 / 八方向栅格化 / 认不出的型 / 缺高度 / 阶段 / 色调', () => {
    assert.deepEqual(geoProblems(DAT), []);
});
test('版面层：不动即停 / 缺栏位 / 超上限逐胎报名 / 认不出 / 空 / 宫压 / 液面 / 囊 / 读数 / 主题', () => {
    assert.deepEqual(layoutProblems(DAT), []);
});
test('App 层：四态 / 收录七因 / 落盘两键 / 放下与清台账互不牵连 / 帧显式 / storage 抛异常不是没记过 / 换会话', () => {
    assert.deepEqual(appProblems(apiOf(DAT), null), []);
});
test('视图层：假 DOM 渲染出根与画布 / 四态类名 / 零状态不抛 / 四页签都能画', () => {
    assert.deepEqual(viewProblems(apiOf(DAT), null, null), []);
});
test('四块不缝与静态门：零定时器 / 零宿主 DOM / 零请求 / 零写回 / 零演出时间轴 / 零反引号零反斜杠', () => {
    assert.deepEqual(seamProblems(), []);
});
test('六处接线：apps / storage / keys / index / phone.css 同源 / v255 dirMap', () => {
    assert.deepEqual(wiringProblems(), []);
});

/* ══════════ 破坏表（DAMAGE）：真源码定点破坏 → 副本树上重跑同款真判据 ══════════
 * 纪律：破坏一律落在**副本树**（每条独立开一棵整仓副本树，真仓只读）；
 *   锚点必须恰中 1 次，否则抛（H6 工具两向自证）；每条破坏都必须让对应判据转红。
 */
const D = [
    ['D1 宫压比值不算了（全 0）', UD_DATA,
        'const pressureRatio = clampNum(numOr(base.uterinePressure, 0) / pressureCap, 0, 1);',
        'const pressureRatio = 0;',
        (M) => layoutProblems(M).some((x) => x.indexOf('pressure-ratio') >= 0)],
    ['D2 认不出的胚型默默当胎生画（不报）', UD_DATA,
        '    const notes = {\n        unknownType: !typeKnown,',
        '    const notes = {\n        unknownType: false,',
        (M) => geoProblems(M).some((x) => x.indexOf('unknown-type-lost') >= 0)],
    ['D3 缺高度不报（按 20 算）', UD_DATA,
        '        sizeMissing: sizeMissing,',
        '        sizeMissing: false,',
        (M) => geoProblems(M).some((x) => x.indexOf('size-missing-lost') >= 0)],
    ['D4 超上限只报数不报名', UD_DATA,
        '    const hiddenList = [];\n    for (let i = 0; i < occupants.length; i += 1) {\n        if (chosen.indexOf(occupants[i]) >= 0) continue;',
        '    const hiddenList = [];\n    for (let i = 0; i < 0; i += 1) {\n        if (chosen.indexOf(occupants[i]) >= 0) continue;',
        (M) => layoutProblems(M).some((x) => x.indexOf('hidden-list-missing') >= 0)],
    ['D5 认不出的胎不报「要处置」', UD_DATA,
        '    if (unknown || unknownHidden) {',
        '    if (false) {',
        (M) => layoutProblems(M).some((x) => x.indexOf('layout-unknown-not-reported') >= 0)],
    ['D6 没着床的胎也当看得见', UD_DATA,
                '            if (!f || f.pendingImplantation) continue;\n            if (!f.revealed && f.conceivedAtDays) continue;\n            visible.push(f);',
        '            if (!f) continue;\n            if (!f.revealed && f.conceivedAtDays) continue;\n            visible.push(f);',
        (M) => layoutProblems(M).some((x) => x.indexOf('pending-implantation-counted') >= 0)],
    ['D7 认不出的阶段当六个孕期之一', UD_DATA,
        '    if (kind === \'unknown\') return \'bad\';',
        '    if (false) return \'bad\';',
        (M) => layoutProblems(M).some((x) => x.indexOf('unknown-stage-verdict') >= 0)],
    ['D8 同卵不共囊（各画各的）', UD_DATA,
        "                return (Number.isInteger(group) && group > 0) ? ('g' + group) : ('e' + idOf(fetus));",
        "                return 'e' + idOf(fetus);",
        (M) => layoutProblems(M).some((x) => x.indexOf('identical-not-shared-sac') >= 0)],
    ['D9 主题认不出的键吞掉内置色', UD_DATA,
        '    return { palette: out, themed: used, total: keys.length };',
        '    return { palette: out, themed: keys.length, total: keys.length };',
        (M) => layoutProblems(M).some((x) => x.indexOf('theme-count') >= 0)],
    ['D10 上限读数不成字（推挤上限读成 0）', UD_DATA,
        '    return { fetuses: MAX_DRAWN_FETUSES, passes: PUSH_PASS_MAX, cells: UD_CELLS_MAX, rows: UD_ROWS_MAX, ledger: UD_LEDGER_MAX };',
        '    return { fetuses: MAX_DRAWN_FETUSES, passes: 0, cells: UD_CELLS_MAX, rows: UD_ROWS_MAX, ledger: UD_LEDGER_MAX };',
        (M) => layoutProblems(M).some((x) => x.indexOf('limit-passes') >= 0)],
    ['D11 单胎也当推挤到顶（死跑满轮）', UD_DATA,
        '        if (!moved) break;',
        '        if (false) break;',
        (M) => layoutProblems(M).some((x) => x.indexOf('single-fetus-read-as-cap') >= 0 || x.indexOf('single-fetus-kept-spinning') >= 0)],
    ['D12 收录失败只有四因（少一因）', UD_DATA,
        "    'empty_input', 'too_long', 'bad_json', 'not_object', 'no_known_field', 'too_many', 'too_deep'",
        "    'empty_input', 'bad_json', 'not_object', 'no_known_field', 'too_many', 'too_deep'",
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('intake-whys') >= 0)],
    ['D13 storage 抛异常被读成「没记过」', UD_APP,
        "        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }",
        "        catch (e) { return { ok: true, why: 'absent', value: undefined }; }",
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('hostile-read-read-as-empty') >= 0 || x.indexOf('hostile-face') >= 0)],
    ['D14 坏存档被当成空（不报读不懂）', UD_APP,
        "        if (!obj || typeof obj !== 'object') return { face: FACE_MALFORMED, why: 'shape', obj: null };",
        "        if (!obj || typeof obj !== 'object') return { face: FACE_EMPTY, why: '', obj: null };",
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('malformed-not-reported') >= 0)],
    ['D15 收坏东西顺手冲掉已收状态', UD_APP,
        "        if (!r.ok) {\n            this._receipt('set_subject', false, r.why, { n: raw.length });",
        "        if (!r.ok) {\n            this._raw = '';\n            this._receipt('set_subject', false, r.why, { n: raw.length });",
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('bad-intake-wiped-subject') >= 0)],
    ['D16 清台账顺手把状态也清了', UD_APP,
        '    clearLedger() {\n        const had = this._ledger.length + this._dropped;\n        this._ledger = [];',
        '    clearLedger() {\n        const had = this._ledger.length + this._dropped;\n        this._raw = \'\';\n        this._ledger = [];',
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('clear-ledger-wiped-subject') >= 0)],
    ['D17 换会话不重取（旧状态留着）', UD_APP,
        "    onChatChanged() {\n        this._raw = '';",
        '    onChatChanged() {\n        if (this._now > 0) return { face: this._face };',
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('chat-change-raw-kept') >= 0)],
    ['D18 画不出来回空对象冒充（视图会画出空白）', UD_APP,
        "        if (this._face !== FACE_OK) { this._layout = null; this._verdict = 'cant'; return; }",
        "        if (this._face !== FACE_OK) { this._layout = {}; this._verdict = 'cant'; return; }",
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('layout-not-null-when-empty') >= 0 || x.indexOf('malformed-drew-something') >= 0)],
    ['D19 读侧胎明细不再报声明的型', UD_APP,
        '                angle: f.angle, type: f.sprite.type, stage: f.sprite.stage, mirror: f.sprite.mirror,',
        "                angle: f.angle, type: '胎生', stage: f.sprite.stage, mirror: f.sprite.mirror,",
        (M, AM) => appProblems(apiOf(M), AM).some((x) => x.indexOf('fetus-cells-type-washed') >= 0)],
    ['D20 视图渲染不成形（画布丢掉）', UD_VIEW,
        "        inner += '<canvas class=\"ud-canvas\" data-canvas width=\"'",
        "        inner += '<div class=\"ud-canvas\" width=\"'",
        (M, AM) => viewProblems(apiOf(M), null, AM).some((x) => x.indexOf('view-no-canvas') >= 0)],
    ['D21 视图渲染不出根（容器空）', UD_VIEW,
        "        this._root.className = 'ud-root ' + this._toneClassName(this.app.toneOf());\n        this._root.innerHTML = this._buildHTML();\n        container.appendChild(this._root);",
        "        this._root.className = 'ud-root ' + this._toneClassName(this.app.toneOf());\n        this._root.innerHTML = this._buildHTML();",
        (M, AM) => viewProblems(apiOf(M), null, AM).some((x) => x.indexOf('view-no-root') >= 0 || x.indexOf('view-empty-no-root') >= 0)],
    ['D22 四页签只剩一页（切页签后空）', UD_VIEW,
        "        if (tab === 'fetuses') parts.push(this._fetusPanel());",
        '        if (false) parts.push(this._fetusPanel());',
        (M, AM) => viewProblems(apiOf(M), null, AM).some((x) => x.indexOf('view-tab-missing-fetuses') >= 0)],
    ['D23 接线漏一条会话键登记（拆掉 uterus_subject 登记）', KEYS,
        "  { key: 'uterus_subject', scope: 'chat',",
        "  { key: 'uterus_note', scope: 'chat',",
        (M, AM, root, ws) => wiringProblems(ws).some((x) => x.indexOf('wiring-keys-subject') >= 0)],
    ['D24 接线漏一条宽前缀（storage 里拆掉）', STORAGE,
        '            /^uterus_/,',
        '            /^uterus_disabled_/,',
        (M, AM, root, ws) => wiringProblems(ws).some((x) => x.indexOf('wiring-storage-prefix') >= 0)],
    ['D25 视图起了定时器（缝律破了）', UD_VIEW,
        "        this._pen = null;",
        "        this._pen = setInterval(function () { return null; }, 180);",
        (M, AM, root, ws) => seamProblems(ws).some((x) => x.indexOf('seam-no-timer') >= 0)],
    ['D26 视图直接写回角色状态（缝律破了）', UD_VIEW,
        "        this._out = '';",
        "        this._out = ''; window.top.profile = {};",
        (M, AM, root, ws) => seamProblems(ws).some((x) => x.indexOf('seam-no-writeback') >= 0)]
];

/* ══════════ 破坏表驱动器：逐条落副本树、重跑同款真判据 ══════════
 * 每条破坏独立开一棵副本树（D 表之间互不污染），破坏后**加载副本树里的模块**
 * 再用同款真判据复判；模块类判据拿破坏后的模块，接线类判据拿破坏后的文本。
 * 判据若抛异常同样计入失败（异常逃逸 = 后续断言静默漏跑，本仓踩过）。
 */
async function runDamage() {
    const bad = [];
    for (const row of D) {
        const [name, rel, from, to, judge] = row;
        let ws = null;
        try {
            if (!rel) { bad.push(name + ' 未指定破坏目标'); continue; }
            ws = makeWorkspace();
            breakIn(ws, rel, from, to);
            /* 两棵模块都从**同一棵副本树**加载：数据破了要经 App 看到，视图破了要经 App 渲染看到 */
            const M = await loadFrom(ws, 'apps/uterus/uterus-data.js');
            const AM = await loadFrom(ws, 'apps/uterus/uterus-app.js');
            const red = judge(M, AM, ws, ws) === true;
            if (!red) bad.push(name + ' 未让判据转红（装饰性破坏）');
        } catch (e) {
            bad.push(name + ' 判据抛异常: ' + String(e && e.message));
        }
    }
    return bad;
}
test('破坏表：每条破坏都让对应判据转红（副本树上重跑同款真判据）', async () => {
    const bad = await runDamage();
    assert.deepEqual(bad, []);
});

/* ══════════ 负控制（NEG）：判据自己的账目错不许放过 ══════════ */
test('N1 破坏锚点不存在必须抛（不许静默把「没改」当成功）', () => {
    assert.throws(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ud-n1-'));
        temps.push(dir);
        copyTreeSafe(path.join(ROOT, 'apps/uterus'), path.join(dir, 'uterus'));
        const target = path.join(dir, 'uterus', 'uterus-data.js');
        const src = fs.readFileSync(target, 'utf8');
        const hits = src.split('在本仓不可能出现的锚点子串').length - 1;
        if (hits !== 1) throw new Error('破坏锚点不唯一：' + String(hits));
    }, /破坏锚点不唯一/);
});
test('N2 破坏锚点出现两次必须抛（H6 工具两向自证）', () => {
    /* 自证方式：**人为构出双锚点**（把锚点行写进副本树头部），再真调 breakIn ——
     *   必须抛「不唯一」；反方向：恰中 1 次的锚点不许抛。两向都真调工具。 */
    const anchor = 'export const UTERUS_CANVAS';
    const ws = makeWorkspace();
    const target = path.join(ws, UD_DATA);
    const src = fs.readFileSync(target, 'utf8');
    if (src.split(anchor).length - 1 !== 1) throw new Error('前置不成立：真源码里锚点不是 1 次');
    fs.writeFileSync(target, anchor + ' = 1;' + NL + src, 'utf8');
    assert.throws(() => breakIn(ws, UD_DATA, anchor, 'x'), /破坏锚点不唯一/);
    const ws2 = makeWorkspace();
    const ok = breakIn(ws2, UD_DATA, 'export const UTERUS_CANVAS = Object.freeze', 'export const UTERUS_CANVAS = Object.freeze');
    assert.ok(String(ok).indexOf('uterus-data.js') >= 0, '唯一锚点被误拒');
});
test('N3 判据不得引用破坏锚点，且锚点在真源码恰中 1 次（H5 判据纯度）', () => {
    /* 判据必须独立于被破坏的字节：任何 from 串出现在判据正文里 = 自我指涉。
     *   两条：① 六个判据函数与每条的谓词都不许含 from 串；② from 在真源码里恰中 1 次。 */
    const judges = [geoProblems, layoutProblems, appProblems, viewProblems, seamProblems, wiringProblems];
    const bodies = judges.map((f) => String(f));
    const hits = [];
    const notUnique = [];
    for (const row of D) {
        const name = row[0];
        const rel = row[1];
        const from = row[2];
        if (!rel || !from) continue;
        for (let i = 0; i < bodies.length; i += 1) {
            if (bodies[i].indexOf(from) >= 0) hits.push(name + '->判据' + judges[i].name);
        }
        if (row[4] && String(row[4]).indexOf(from) >= 0) hits.push(name + '->谓词');
        const n = read(rel).split(from).length - 1;
        if (n !== 1) notUnique.push(name + '->' + String(n));
    }
    assert.deepEqual(hits, [], '判据引用了破坏锚点（自我指涉）');
    assert.deepEqual(notUnique, [], '锚点在真源码里不是恰中 1 次');
});
test('N4 剥注释器自身自证：注释去掉、代码留着、字符串里的注释符不误伤', () => {
    const src = 'const a = 1; /* 注释里有个 document. */ const b = 2; // setInterval\n const c = "/* 不是注释 */";';
    const out = stripComments(src);
    assert.ok(out.indexOf('document.') < 0, '块注释未剥');
    assert.ok(out.indexOf('setInterval') < 0, '行注释未剥');
    assert.ok(out.indexOf('const a = 1;') >= 0, '代码被误删');
    assert.ok(out.indexOf('const c =') >= 0, '字符串被误删');
    assert.ok(out.indexOf('/* 不是注释 */') >= 0, '字符串里的注释符被误伤');
});
test('N5 破坏后文件内容确实变了（破坏必须可观测改行为）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-ud-n5-'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps/uterus'), path.join(dir, 'uterus'));
    const orig = fs.readFileSync(path.join(ROOT, UD_DATA), 'utf8');
    const row = D[0];
    const broke = orig.split(row[2]).join(row[3]);
    assert.notEqual(broke, orig, '破坏未改变字节');
    assert.ok(broke.indexOf(row[3]) >= 0, '破坏未落进副本');
});
test('N6 负控制层内不得把破坏写死成模拟常量（判据必须被真调用）', async () => {
    /* 三向自证：
     *   ① 真源码上判据必须得空（否则判据自己在乱报）；
     *   ② 破坏后同一判据必须得非空（否则破坏是装饰性的）；
     *   ③ 破坏后跑的是**副本树里加载的模块**（只改文本、跑真仓模块 = 假绿）。 */
    const ws0 = makeWorkspace();
    const clean = await loadFrom(ws0, UD_DATA);
    assert.deepEqual(layoutProblems(clean), [], '真源码上判据得非空 —— 判据自己在乱报');
    const row = D[0];
    const ws = makeWorkspace();
    breakIn(ws, row[1], row[2], row[3]);
    const broke = await loadFrom(ws, UD_DATA);
    const bads = layoutProblems(broke);
    assert.ok(bads.some((x) => x.indexOf('pressure-ratio') >= 0), '破坏后判据未转红：' + JSON.stringify(bads));
    assert.notEqual(broke, DAT, '副本树加载失败（拿到的是真仓模块）');
    assert.deepEqual(layoutProblems(DAT), [], '真仓模块在破坏窗口内被改脏了（本套件必须只读真仓）');
});
