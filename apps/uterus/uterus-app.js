/* ========================================================
 * uterus-app.js — [v3.48.0] 子宫画板 · 落盘与接线
 *
 * 数据层：uterus-data.js（纯函数内核）  视图层：uterus-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：栅格化 / 版面 / 判定 / 读数 / 文本 —— 都不碰存储；
 *   ③ 落盘（PhoneStorage）：两条会话键，全走 uterus_ 前缀。
 *
 * ── 两条会话键 ──────────────────────────────────────────
 *   · uterus_subject —— 收下的角色状态原文 + 收下时刻；
 *   · uterus_ledger  —— 动作台账（每一次看一眼 / 收档 / 放下 / 推帧的回执）。
 *   ★ 为什么两条分开：源把「角色状态」与「绘制进度」都挂在宿主大对象上
 *     （换角色后一起串味）。本件两类各自一条键。
 *
 * ── 本件与源的根本分别（**只算像素，不动手**）────────────
 *   本件**不写回角色状态、不读宿主界面元素、不发请求、不起定时器**：
 *   帧推进由调用方显式传 tick，本件内不出现 setInterval / setTimeout。
 *
 * ── 不缝的那四块（源的整套动作，本件一律不接）──────────
 *   ① 源从宿主大对象取状态并**就地更新**（动画相位写回 profile）—— 本件只读投影；
 *   ② 源从宿主 DOM 取主题色（读 CSS 变量与计算样式）—— 本件主题是入参；
 *   ③ 源与 AI 提示词管线同源（PDA / 主流程提示）—— 本件只算像素，不产提示词；
 *   ④ 源在渲染层起 setInterval 逐帧推 —— 本件帧推进显式传入。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 状态读不出来 **不许**读成「空状态」（四态面分开判）；
 *   · 原文超上限 **不许**静默截（只报）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）；
 *   · 换会话后旧状态与旧台账 **不许**留着（onChatChanged 两格全量重取）；
 *   · 画不出来 **不许**回空对象冒充（sum 回 null，视图另立一格画）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现反引号模板串（本仓静态门按串形守），一律字符串拼接。
 * ======================================================== */
'use strict';
import {
    UD_LEDGER_MAX, UD_ROWS_MAX, UD_CELLS_MAX, UD_INTAKE_WHYS,
    UD_ACTIONS, UD_ACTION_TEXT, UD_SOURCE_NOTE, UD_SOURCE_FILES, UD_VERDICTS, UD_VERDICT_TEXT,
    isPlain, hasKey, numOrNull, listOf, trimRows, intake,
    buildFetusGrid, computeUterusLayout, getSpriteStage, getFetusSpriteSpec,
    readingRows, problemsOf, verdictOf, readingText, resolvePalette, limits, typeInBook
} from './uterus-data.js';
import { UterusView } from './uterus-view.js';
export const UD_SUBJECT_KEY = 'uterus_subject';
export const UD_LEDGER_KEY = 'uterus_ledger';

/* 四态（与数据层读数一一对应；**键面取真源**，不写标识符形）。 */
const FACE_OK = 'ok';
const FACE_EMPTY = 'empty';
const FACE_MALFORMED = 'malformed';
const FACE_ABSENT = 'absent';
const FACE_TEXT = Object.freeze({
    [FACE_OK]: '状态已收下',
    [FACE_EMPTY]: '还没收过状态',
    [FACE_MALFORMED]: '收下的东西读不懂',
    [FACE_ABSENT]: '还没看过一眼'
});
const FACE_TONE = Object.freeze({ [FACE_OK]: 'ok', [FACE_EMPTY]: 'warn', [FACE_MALFORMED]: 'err', [FACE_ABSENT]: 'off' });
const DASH_UNIT = '--';
/* 收录失败因文案（键面**取数据层真源**，本件不重列 —— 本仓 J7 形态）。 */
const INTAKE_WHY_TEXT = Object.freeze({
    [UD_INTAKE_WHYS[0]]: '什么都没贴',
    [UD_INTAKE_WHYS[1]]: '贴进来的原文超过本件上限（只报，不截）',
    [UD_INTAKE_WHYS[2]]: '贴进来的东西不是合法 JSON',
    [UD_INTAKE_WHYS[3]]: '是一份 JSON，但不是一张表',
    [UD_INTAKE_WHYS[4]]: '是一张表，但里面没有本件认得的栏位（既没有 base 也没有 pregnant）',
    [UD_INTAKE_WHYS[5]]: '栏位太多，超过本件上限（只报，不截）',
    [UD_INTAKE_WHYS[6]]: '贴进来的东西嵌套太深'
});
const UD_TEXT_MAX = 400000;
const UD_SUBJECT_MAX = 400000;

function toStr(v) { return (typeof v === 'string') ? v : ''; }
function dash() { return DASH_UNIT; }
function stampOf(ms) {
    const n = numOrNull(ms);
    if (n === null || n <= 0) return dash();
    const d = new Date(n);
    if (!isFinite(d.getTime())) return dash();
    const pad = function (v) { return (v < 10 ? '0' : '') + v; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function textIn(table, key, fallback) {
    const k = toStr(key);
    const t = table[k];
    if (typeof t === 'string' && t.length) return t;
    return fallback ? fallback : (k.length ? k : dash());
}

export class UterusApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'board';
        this._raw = '';
        this._rawAt = 0;
        this._ledger = [];
        this._dropped = 0;
        this._theme = {};
        this._tick = 0;
        this._input = '';
        this._extra = '';
        this._now = 0;
        this._face = FACE_ABSENT;
        this._why = '';
        this._layout = null;
        this._verdict = 'cant';
    }
    /* ---------- storage 三态（本仓纪律：抛异常不等于「没记过」） ---------- */
    _storageUsable() {
        if (!this.storage) return { ok: false, why: 'no_storage' };
        if (typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, why: 'no_api' };
        }
        return { ok: true, why: '' };
    }
    _savedOk(wrote) { return { saved: wrote === true, storage: this._storageUsable().ok }; }
    /** 读一格。三种回报：ok / absent。抛异常**不是**「没记过」。 */
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        let v = null;
        try { v = this.storage.get(key, null); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }
    _writeJSON(key, value) {
        const gate = this._storageUsable();
        if (!gate.ok) return false;
        try { this.storage.set(key, JSON.stringify(value)); return true; }
        catch (e) { return false; }
    }
    _parse(key) {
        const r = this._readRaw(key);
        if (!r.ok) return { face: FACE_ABSENT, why: r.why, obj: null };
        if (r.why === 'absent') return { face: FACE_EMPTY, why: '', obj: null };
        let obj = null;
        try { obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value; }
        catch (e) { return { face: FACE_MALFORMED, why: 'json', obj: null }; }
        if (!obj || typeof obj !== 'object') return { face: FACE_MALFORMED, why: 'shape', obj: null };
        return { face: FACE_OK, why: '', obj: obj };
    }
    /* ---------- 装载（单一装载路径） ---------- */
    _loadSubject() {
        this._raw = '';
        this._rawAt = 0;
        const st = this._parse(UD_SUBJECT_KEY);
        if (st.face === FACE_ABSENT) return { face: FACE_ABSENT, why: st.why };
        if (st.face === FACE_EMPTY) return { face: FACE_EMPTY, why: '' };
        if (st.face === FACE_MALFORMED) return { face: FACE_MALFORMED, why: st.why };
        const o = st.obj;
        const raw = toStr(o.raw);
        this._raw = raw;
        const at = numOrNull(o.at);
        this._rawAt = (at === null || at < 0) ? 0 : at;
        if (!raw.length) return { face: FACE_EMPTY, why: '' };
        if (raw.length > UD_SUBJECT_MAX) return { face: FACE_MALFORMED, why: 'too_long' };
        return { face: FACE_OK, why: '' };
    }
    _loadLedger() {
        const st = this._parse(UD_LEDGER_KEY);
        if (st.face !== FACE_OK) { this._ledger = []; this._dropped = 0; return; }
        this._ledger = listOf(st.obj.ledger).slice(0, UD_LEDGER_MAX);
        const dp = numOrNull(st.obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? Math.trunc(dp) : 0;
    }
    _persistSubject() { return this._writeJSON(UD_SUBJECT_KEY, { raw: this._raw, at: this._rawAt }); }
    _persistLedger() { return this._writeJSON(UD_LEDGER_KEY, { ledger: this._ledger, dropped: this._dropped }); }
    /* ---------- 取数 ---------- */
    probe() {
        const st = this._loadSubject();
        this._face = st.face;
        this._why = st.why || '';
        this._loadLedger();
        this._recompute();
        return { face: this._face, why: this._why };
    }
    /** 投影（**唯一一处**算账：本件不产第二份版面）。
     *  ★ 读不出来就回 null（不当作空状态），视图另立一格画。 */
    _recompute() {
        if (this._face !== FACE_OK) { this._layout = null; this._verdict = 'cant'; return; }
        let obj = null;
        try { obj = JSON.parse(this._raw); }
        catch (e) { obj = null; }
        if (!isPlain(obj)) { this._layout = null; this._verdict = 'cant'; return; }
        this._layout = computeUterusLayout(obj, { stageProgress: 0.5 });
        this._verdict = verdictOf(this._layout);
    }
    /* ---------- 对外读数（视图只读这些） ---------- */
    faceOf() { return this._face; }
    faceText() { return FACE_TEXT[this._face] || dash(); }
    toneOf() { return FACE_TONE[this._face] || 'off'; }
    layoutOf() { return this._layout; }
    verdictOf() { return this._verdict; }
    verdictText() { return UD_VERDICT_TEXT[this._verdict] || dash(); }
    whyOf() { return this._why; }
    subjectAt() { return this._rawAt; }
    subjectStamp() { return stampOf(this._rawAt); }
    nowStamp() { return stampOf(this._now); }
    rawLen() { return this._raw.length; }
    ledgerRows() { return this._ledger.slice(0); }
    droppedOf() { return this._dropped; }
    themeOf() { return this._theme; }
    /* ---------- 动作台账 ---------- */
    _receipt(action, ok, why, extra) {
        const ex = isPlain(extra) ? extra : {};
        const n = numOrNull(ex.n);
        const row = { at: this._now, action: String(action), ok: ok === true, why: String(why || ''), n: (n === null) ? 0 : Math.trunc(n) };
        this._ledger.push(row);
        const t = trimRows(this._ledger, UD_LEDGER_MAX);
        this._ledger = t.rows;
        this._dropped += t.dropped;
        this._persistLedger();
        return row;
    }
    /* ---------- 动作口（只写自己的两条键） ---------- */
    /** 收下一份角色状态：只把原文存进自己的键，**不动宿主任何数据**。 */
    ingestSubject(text) {
        const raw = toStr(text);
        if (!raw.length) {
            this._receipt('set_subject', false, 'empty_input', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty_input' });
        }
        if (raw.length > UD_TEXT_MAX) {
            this._receipt('set_subject', false, 'too_long', { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });
        }
        const r = intake(raw, UD_TEXT_MAX);
        if (!r.ok) {
            this._receipt('set_subject', false, r.why, { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: r.why, chars: raw.length });
        }
        this._raw = raw;
        this._rawAt = this._now;
        const savedS = this._persistSubject();
        this.probe();
        this._receipt('set_subject', true, '', { n: raw.length });
        return Object.assign(this._savedOk(savedS), { ok: true, chars: raw.length });
    }
    /** 放下一份状态（只清自己的键）。 */
    clearSubject() {
        const had = this._raw.length;
        this._raw = '';
        this._rawAt = 0;
        const savedC = this._persistSubject();
        this.probe();
        this._receipt('clear_subject', true, '', { n: had });
        return Object.assign(this._savedOk(savedC), { ok: true, cleared: had });
    }
    /** 推一帧（帧推进**显式传入**：本件内不起定时器）。 */
    frameTick(tick) {
        const t = numOrNull(tick);
        this._tick = (t === null) ? (this._tick + 1) : t;
        this._receipt('frame_tick', true, '', { n: Math.trunc(this._tick) });
        return this._tick;
    }
    /** 出一份读数文本（**本件唯一的产物**：只产文本）。 */
    readNow(extra) {
        if (this._face !== FACE_OK || !this._layout) {
            this._receipt('probe', false, 'no_subject', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'no_subject', text: '', chars: 0 });
        }
        const ex = (typeof extra === 'string') ? extra : this._extra;
        const out = readingText(this._layout, ex);
        this._receipt('probe', true, '', { n: out.chars });
        return Object.assign(this._savedOk(true), { ok: true, text: out.text, chars: out.chars, rows: out.rows, problems: out.problems });
    }
    /** 清台账：**只清自己那条键**，状态不许跟着没。 */
    clearLedger() {
        const had = this._ledger.length + this._dropped;
        this._ledger = [];
        this._dropped = 0;
        const savedL = this._persistLedger();
        this._receipt('ledger_clear', true, '', { n: had });
        return Object.assign(this._savedOk(savedL), { ok: true, cleared: had, subjectKept: this._raw.length });
    }
    /* ---------- 主题（**入参**，不读宿主 DOM） ---------- */
    setTheme(theme) {
        this._theme = isPlain(theme) ? theme : {};
        return this._theme;
    }
    paletteNow() { return resolvePalette(this._theme); }
    /* ---------- 渲染与换会话 ---------- */
    render() {
        this.probe();
        if (!this._view) this._view = new UterusView(this, this.shell, this.storage);
        this._view.render();
    }
    refresh() {
        this.probe();
        if (this._view) this._view.refresh();
    }
    /** 换会话：**两格全量重取**（旧状态 / 旧台账不许留着）。 */
    onChatChanged() {
        this._raw = '';
        this._rawAt = 0;
        this._ledger = [];
        this._dropped = 0;
        this._face = FACE_ABSENT;
        this._layout = null;
        this._verdict = 'cant';
        this._input = '';
        this._extra = '';
        this._tick = 0;
        this.probe();
        if (this._view) this._view.refresh();
        return { face: this._face };
    }
    /* ---------- 读侧：把真源表原样交给视图（**视图不再手抄一份**） ---------- */
    readingCells() { return this._layout ? readingRows(this._layout) : []; }
    problemCells() { return this._layout ? problemsOf(this._layout) : []; }
    fetusCells() {
        const L = this._layout;
        if (!L) return [];
        const rows = [];
        const items = listOf(L.fetuses);
        for (let i = 0; i < items.length; i += 1) {
            const f = items[i];
            rows.push({
                embryoId: f.embryoId, index: f.index, size: f.size, descent: f.descent, descentText: f.descentText,
                angle: f.angle, type: f.sprite.type, stage: f.sprite.stage, mirror: f.sprite.mirror,
                posterior: f.sprite.posterior, unknownType: f.unknownType, declaredType: f.declaredType,
                affinityText: textIn({ '2': '依恋', '1': '亲近', '0': '平淡', '-1': '疏离', '-2': '排斥' }, String(f.affinityBand), dash()),
                gender: f.gender, amnion: f.amnion, amnionText: textIn({ full: '完整', thin: '变薄', torn: '撕开', none: '已破' }, (function () { return f.amnion <= 0 ? 'none' : (f.amnion < 30 ? 'torn' : (f.amnion < 60 ? 'thin' : 'full')); })(), dash())
            });
        }
        return rows;
    }
    sacCells() {
        const L = this._layout;
        if (!L) return [];
        return listOf(L.sacs).map(function (s) { return { key: s.key, cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry, level: s.level }; });
    }
    actionTextOf(key) { return textIn(UD_ACTION_TEXT, key, dash()); }
    intakeWhyText(why) { return textIn(INTAKE_WHY_TEXT, why, dash()); }
    intakeWhys() { return UD_INTAKE_WHYS.slice(0); }
    actionList() { return UD_ACTIONS.slice(0); }
    sourceNote() { return UD_SOURCE_NOTE; }
    sourceFiles() { return UD_SOURCE_FILES.slice(0); }
    limits() { return limits(); }
    verdictList() { return UD_VERDICTS.slice(0); }
    typeInBook(name) { return typeInBook(name); }
    now() { return this._now; }
    tick(now) { this._now = (typeof now === 'number' && isFinite(now)) ? now : Date.now(); return this._now; }
}

/* 追加读数口：视图只读这些（避免视图自己算账）。 */
Object.assign(UterusApp.prototype, {
    tab() { return this._tab; },
    setTab(k) {
        const s = toStr(k);
        if (s === 'board' || s === 'fetuses' || s === 'readings' || s === 'ledger') this._tab = s;
        return this._tab;
    },
    setInput(v) { this._input = toStr(v); return this._input; },
    inputOf() { return this._input; },
    setExtra(v) { this._extra = toStr(v); return this._extra; },
    extraOf() { return this._extra; },
    tickCount() { return this._tick; },
    gridOf(spec) { return buildFetusGrid(spec); },
    spriteStageOf(age) { return getSpriteStage(age); },
    spriteSpecOf(fetus, age) { return getFetusSpriteSpec(fetus, age); },
    cellsCap() { return UD_CELLS_MAX; },
    rowsCap() { return UD_ROWS_MAX; }
});
