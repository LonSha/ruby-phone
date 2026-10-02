/* ========================================================
 * diagdesk-app.js — [v3.47.0] 诊断案头 · 落盘与接线
 *
 * 数据层：diagdesk-data.js（纯函数内核）  视图层：diagdesk-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：版本面 / 六态计数 / 增量面 / 流水线面 / 栏位体检 /
 *      迁移计划 / 判定 / 摘要文本 —— 都不碰存储；
 *   ③ 落盘（PhoneStorage）：三条会话键，全走 diagdesk_ 前缀。
 *
 * ── 三条会话键 ──────────────────────────────────────────
 *   · diagdesk_archive —— 贴回的存档原文 + 收下时刻；
 *   · diagdesk_draft   —— 摘要草稿（目标 / 追加要求）；
 *   · diagdesk_ledger  —— 动作台账（每一次收档 / 放下 / 出文本的回执）。
 *   ★ 为什么三条分开：源把「存档本体」「诊断上下文」「迁移进度」全挂在
 *     宿主的大对象上 —— 换角色后三类一起串味。本件三类各自一条键。
 *
 * ── 本件与源的根本分别（**裁定不等于动手**）────────────
 *   本件**不挂错误对象、不改存档、不写宿主任何字段**：
 *   不往 Error 实例上挂旁路、不从堆栈里抠定位、不替上游编失败原因、
 *   不就地改存档、不改写宿主的任何键。它只回答一件事：
 *   「这份存档照上游的规矩读下来，会发生什么」。
 *
 * ── 不缝的那五块（源的整套动作，本件一律不接）──────────
 *   ① 源用 WeakMap 把步骤名挂在 Error 实例上 —— 本件只读回执字段；
 *   ② 源解析 stack 取文件 / 行 / 列 —— 本件只把已写明的定位原样列出；
 *   ③ 源按错误名硬编几行中文原因 —— 本件只报名字与码，不编原因；
 *   ④ 源就地改存档（迁移函数直接写对象）—— 本件只产计划；
 *   ⑤ 源写宿主的各类键 —— 本件只写自己那三条。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 存档读不出来 **不许**读成「空存档」（四态面分开判）；
 *   · 版本栏缺字段 **不许**替它读成 1（另立一格）；
 *   · 状态认不出来 **不许**当还没发生；
 *   · 缺栏位 **不许**读成 0；
 *   · 原文超上限 **不许**静默截（只报）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）；
 *   · 换会话后旧档与旧台账 **不许**留着（onChatChanged 三格全量重取）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量与反斜杠、也不许出现反引号。
 * ======================================================== */
'use strict';
import {
    DD_TEXT_MAX, DD_LEDGER_MAX, DD_ROWS_MAX, DD_INTAKE_WHYS,
    DD_STATUSES, DD_STATUS_TEXT, DD_DELTAS, DD_DELTA_TEXT,
    DD_FLOW, DD_FLOW_TEXT, DD_VERSIONS, DD_VERSION_LATEST,
    DD_FIELDS, DD_MIGRATIONS, DD_ACTIONS, DD_ACTION_TEXT,
    DD_VERDICTS, DD_VERDICT_TEXT, DD_SOURCE_NOTE, DD_SOURCE_FILES,
    cleanText, charCount, isPlain, hasKey, intOf, numOf, listOf, trimRows, stampOf, typeInBook,
    versionFace, statusFace, deltaFace, pipelineFace, fieldFace, migrationPlan,
    problemsOf, verdictOf, summarize, requestText, intake
} from './diagdesk-data.js';
import { DiagdeskView } from './diagdesk-view.js';
export const DD_ARCHIVE_KEY = 'diagdesk_archive';
export const DD_DRAFT_KEY = 'diagdesk_draft';
export const DD_LEDGER_KEY = 'diagdesk_ledger';
/* 四态（与数据层读数一一对应；**键面取真源**，不写标识符形）。 */
const FACE_OK = 'ok';
const FACE_EMPTY = 'empty';
const FACE_MALFORMED = 'malformed';
const FACE_ABSENT = 'absent';
const FACE_TEXT = Object.freeze({
    [FACE_OK]: '存档已收下',
    [FACE_EMPTY]: '还没收过存档',
    [FACE_MALFORMED]: '收下的东西读不懂',
    [FACE_ABSENT]: '还没建过体检'
});
const FACE_TONE = Object.freeze({
    [FACE_OK]: 'ok',
    [FACE_EMPTY]: 'warn',
    [FACE_MALFORMED]: 'err',
    [FACE_ABSENT]: 'off'
});
const DASH_UNIT = '--';
/* 收录失败因文案（键面**取数据层真源**，本件不再重列八键 —— 本仓 J7 形态）。 */
const INTAKE_WHY_TEXT = Object.freeze({
    [DD_INTAKE_WHYS[0]]: '什么都没贴',
    [DD_INTAKE_WHYS[1]]: '贴进来的原文超过本件上限（只报，不截）',
    [DD_INTAKE_WHYS[2]]: '贴进来的是空表',
    [DD_INTAKE_WHYS[3]]: '贴进来的东西不是合法 JSON',
    [DD_INTAKE_WHYS[4]]: '是一份 JSON，但不是一张表（不是对象）',
    [DD_INTAKE_WHYS[5]]: '是一张表，但里面没有本件认得的栏位',
    [DD_INTAKE_WHYS[6]]: '栏位太多，超过本件上限（只报，不截）',
    [DD_INTAKE_WHYS[7]]: '贴进来的东西嵌套太深'
});
function toStr(v) { return (typeof v === 'string') ? v : ''; }
function dash() { return DASH_UNIT; }
function meterText(v) {
    const n = numOf(v);
    return n === null ? dash() : String(n);
}
function textIn(table, key, fallback) {
    const k = toStr(key);
    const t = table[k];
    if (typeof t === 'string' && t.length) return t;
    return fallback ? fallback : (k.length ? k : dash());
}
export class DiagdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'overview';
        this._raw = '';
        this._rawAt = 0;
        this._target = '';
        this._extra = '';
        this._ledger = [];
        this._dropped = 0;
        this._input = '';
        this._focus = '';
        this._now = 0;
        this._face = FACE_ABSENT;
        this._malformed = false;
        this._why = '';
        this._sum = null;
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
    _savedOk(wrote) {
        return { saved: wrote === true, storage: this._storageUsable().ok };
    }
    /** 读一格。三种回报：ok / absent / malformed。抛异常**不是**「没记过」。 */
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
        try {
            this.storage.set(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }
    _parse(key) {
        const r = this._readRaw(key);
        if (!r.ok) return { face: FACE_ABSENT, why: r.why, obj: null };
        if (r.why === 'absent') return { face: FACE_EMPTY, why: '', obj: null };
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            return { face: FACE_MALFORMED, why: 'json', obj: null };
        }
        if (!obj || typeof obj !== 'object') return { face: FACE_MALFORMED, why: 'shape', obj: null };
        return { face: FACE_OK, why: '', obj };
    }
    /* ---------- 装载（单一装载路径：首次渲染与换会话都走这里） ---------- */
    _loadArchive() {
        this._raw = '';
        this._rawAt = 0;
        const st = this._parse(DD_ARCHIVE_KEY);
        if (st.face === FACE_ABSENT) return { face: FACE_ABSENT, why: st.why };
        if (st.face === FACE_EMPTY) return { face: FACE_EMPTY, why: '' };
        if (st.face === FACE_MALFORMED) return { face: FACE_MALFORMED, why: st.why };
        const o = st.obj;
        const raw = (typeof o.raw === 'string') ? o.raw : '';
        this._raw = raw;
        const at = numOf(o.at);
        this._rawAt = (at === null || at < 0) ? 0 : at;
        if (!raw.length) return { face: FACE_EMPTY, why: '' };
        if (raw.length > DD_TEXT_MAX) {
            /* 原文超上限：**只报不静默截**。 */
            return { face: FACE_MALFORMED, why: 'too_long' };
        }
        return { face: FACE_OK, why: '' };
    }
    _loadDraft() {
        this._target = '';
        this._extra = '';
        const st = this._parse(DD_DRAFT_KEY);
        if (st.face !== FACE_OK) return;
        this._target = cleanText(st.obj.target);
        this._extra = cleanText(st.obj.extra);
    }
    _loadLedger() {
        const st = this._parse(DD_LEDGER_KEY);
        if (st.face !== FACE_OK) { this._ledger = []; this._dropped = 0; return; }
        this._ledger = listOf(st.obj.ledger).slice(0, DD_LEDGER_MAX);
        const dp = numOf(st.obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? Math.trunc(dp) : 0;
    }
    _persistArchive() {
        return this._writeJSON(DD_ARCHIVE_KEY, { raw: this._raw, at: this._rawAt });
    }
    _persistDraft() {
        return this._writeJSON(DD_DRAFT_KEY, { target: this._target, extra: this._extra });
    }
    _persistLedger() {
        return this._writeJSON(DD_LEDGER_KEY, { ledger: this._ledger, dropped: this._dropped });
    }
    /* ---------- 取数（每次 render / 换会话都重取） ---------- */
    probe() {
        const ar = this._loadArchive();
        this._face = ar.face;
        this._why = ar.why || '';
        this._malformed = (ar.face === FACE_MALFORMED);
        this._loadDraft();
        this._loadLedger();
        this._recompute();
        return { face: this._face, why: this._why };
    }
    /** 投影（**唯一一处**算账：本件不产第二份体检单）。
     *  ★ 读不出来就回 null（不当作空存档），视图另立一格画。 */
    _recompute() {
        if (this._face !== FACE_OK) {
            this._sum = null;
            this._verdict = 'cant';
            return;
        }
        let obj = null;
        try { obj = JSON.parse(this._raw); }
        catch (e) { obj = null; }
        if (!isPlain(obj)) {
            this._sum = null;
            this._verdict = 'cant';
            return;
        }
        const statuses = listOf(obj.statuses);
        const detail = listOf(obj.pipeline);
        this._sum = summarize({
            archive: obj,
            statuses: statuses,
            delta: hasKey(obj, 'delta') ? obj.delta : null,
            pipeline: detail,
            now: this._now
        });
        this._verdict = this._sum.verdict;
    }
    /* ---------- 对外读数（视图只读这些） ---------- */
    faceOf() { return this._face; }
    faceText() { return FACE_TEXT[this._face] || dash(); }
    toneOf() { return FACE_TONE[this._face] || 'off'; }
    summaryOf() { return this._sum; }
    verdictOf() { return this._verdict; }
    verdictText() { return DD_VERDICT_TEXT[this._verdict] || dash(); }
    whyOf() { return this._why; }
    archiveAt() { return this._rawAt; }
    ledgers() { return this._ledger.slice(0); }
    droppedOf() { return this._dropped; }
    draftOf() { return { target: this._target, extra: this._extra }; }
    /* ---------- 动作台账 ---------- */
    _receipt(action, ok, why, extra) {
        const ex = isPlain(extra) ? extra : {};
        const n = numOf(ex.n);
        const row = {
            at: this._now, action: String(action), ok: ok === true,
            why: String(why || ''), n: (n === null) ? 0 : Math.trunc(n)
        };
        this._ledger.push(row);
        const t = trimRows(this._ledger, DD_LEDGER_MAX);
        this._ledger = t.rows;
        this._dropped += t.dropped;
        this._persistLedger();
        return row;
    }
    /* ---------- 动作口（只写自己的三条键） ---------- */
    /** 收下一份存档：只把原文存进自己的键，**不动宿主任何数据**。 */
    ingestArchive(text) {
        const raw = cleanText(text);
        if (!raw.length) {
            this._receipt('archive_ingest', false, 'empty_input', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty_input' });
        }
        if (raw.length > DD_TEXT_MAX) {
            this._receipt('archive_ingest', false, 'too_long', { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });
        }
        /* ★ 形状认不出来的粘贴 **不动作**：不许把台面上那份已收的存档冲掉。 */
        const r = intake(raw, DD_TEXT_MAX);
        if (!r.ok) {
            this._receipt('archive_ingest', false, r.why, { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: r.why, chars: raw.length });
        }
        this._raw = raw;
        this._rawAt = this._now;
        this._persistArchive();
        this.probe();
        this._receipt('archive_ingest', true, '', { n: raw.length });
        return Object.assign(this._savedOk(true), { ok: true, chars: raw.length });
    }
    /** 放下一份存档（只清自己的键；**不是**清宿主）。 */
    clearArchive() {
        const had = this._raw.length;
        this._raw = '';
        this._rawAt = 0;
        this._persistArchive();
        this.probe();
        this._receipt('archive_clear', true, '', { n: had });
        return Object.assign(this._savedOk(true), { ok: true, cleared: had });
    }
    /** 改摘要草稿（两格原样存，不替它补默认值）。 */
    setDraft(target, extra) {
        this._target = cleanText(target);
        this._extra = cleanText(extra);
        const wrote = this._persistDraft();
        this._receipt('draft_set', wrote, wrote ? '' : 'write_failed', { n: this._extra.length });
        return Object.assign(this._savedOk(wrote), { ok: wrote });
    }
    /** 出一份摘要文本（**本件唯一的产物**：只产文本，不动存档）。 */
    requestNow(extra) {
        if (this._face !== FACE_OK || !this._sum) {
            this._receipt('text_request', false, 'no_archive', { n: 0 });
            return Object.assign(this._savedOk(false), {
                ok: false, why: 'no_archive', text: '', chars: 0, over: false, overWhy: ''
            });
        }
        const ex = (typeof extra === 'string') ? extra : this._extra;
        const out = requestText(this._sum, ex);
        this._receipt('text_request', true, '', { n: out.chars });
        return Object.assign(this._savedOk(true), {
            ok: true, text: out.text, chars: out.chars, over: out.over, overWhy: out.overWhy
        });
    }
    /** 清台账：**只清自己那条键**，存档与草稿不许跟着没。 */
    clearLedger() {
        const had = this._ledger.length + this._dropped;
        this._ledger = [];
        this._dropped = 0;
        this._persistLedger();
        this._receipt('ledger_clear', true, '', { n: had });
        return Object.assign(this._savedOk(true), { ok: true, cleared: had, archiveKept: this._raw.length });
    }
    /* ---------- 渲染与换会话 ---------- */
    render() {
        this.probe();
        if (!this._view) this._view = new DiagdeskView(this, this.shell, this.storage);
        this._view.render();
    }
    refresh() {
        this.probe();
        if (this._view) this._view.refresh();
    }
    /** 换会话：**三格全量重取**（旧档 / 旧草稿 / 旧台账不许留着）。 */
    onChatChanged() {
        this._raw = '';
        this._rawAt = 0;
        this._target = '';
        this._extra = '';
        this._ledger = [];
        this._dropped = 0;
        this._face = FACE_ABSENT;
        this._sum = null;
        this._verdict = 'cant';
        this._input = '';
        this._focus = '';
        this.probe();
        if (this._view) this._view.refresh();
        return { face: this._face };
    }
    /* ---------- 读侧：把真源表原样交给视图（**视图不再手抄一份**） ---------- */
    statusCells() {
        const rows = [];
        for (let i = 0; i < DD_STATUSES.length; i += 1) {
            const k = DD_STATUSES[i];
            rows.push({ key: k, label: DD_STATUS_TEXT[k] });
        }
        return rows;
    }
    deltaCells() {
        const rows = [];
        for (let i = 0; i < DD_DELTAS.length; i += 1) {
            const k = DD_DELTAS[i];
            rows.push({ key: k, label: DD_DELTA_TEXT[k] });
        }
        return rows;
    }
    flowCells() {
        const rows = [];
        for (let i = 0; i < DD_FLOW.length; i += 1) {
            const k = DD_FLOW[i];
            rows.push({ key: k, label: DD_FLOW_TEXT[k], order: i + 1 });
        }
        return rows;
    }
    versionCells() {
        const rows = [];
        for (let i = 0; i < DD_VERSIONS.length; i += 1) rows.push(DD_VERSIONS[i]);
        return rows;
    }
    fieldCells() {
        const rows = [];
        for (let i = 0; i < DD_FIELDS.length; i += 1) {
            const f = DD_FIELDS[i];
            rows.push({ key: f.key, label: f.label, typeText: f.type, since: f.since, known: typeInBook(f.type) });
        }
        return rows;
    }
    stepCells() {
        const rows = [];
        for (let i = 0; i < DD_MIGRATIONS.length; i += 1) {
            const m = DD_MIGRATIONS[i];
            rows.push({ from: m.from, to: m.to, note: m.note });
        }
        return rows;
    }
    actionTextOf(key) { return textIn(DD_ACTION_TEXT, key, dash()); }
    intakeWhyText(why) { return textIn(INTAKE_WHY_TEXT, why, dash()); }
    intakeWhys() { return DD_INTAKE_WHYS.slice(0); }
    sourceNote() { return DD_SOURCE_NOTE; }
    sourceFiles() { return DD_SOURCE_FILES.slice(0); }
/** 类型册自证：一份栏位表里有几个类型是册子里没有的（不是 0 就说明声明写错了）。 */
    typeUnknownOf(fields) {
        const list = listOf(fields);
        let n = 0;
        for (let i = 0; i < list.length; i += 1) {
            const it = list[i];
            const t = isPlain(it) ? it.type : it;
            if (!typeInBook(t)) n += 1;
        }
        return n;
    }
    typeUnknownCount() { return this.typeUnknownOf(DD_FIELDS); }
    limits() {
        return { rows: DD_ROWS_MAX, text: DD_TEXT_MAX, ledger: DD_LEDGER_MAX, latest: DD_VERSION_LATEST };
    }
    verdictList() { return DD_VERDICTS.slice(0); }
    now() { return this._now; }
    tick(now) { this._now = (typeof now === 'number' && isFinite(now)) ? now : Date.now(); return this._now; }
}

/* 追加读数口：视图只读这些（避免视图自己算账）。 */
Object.assign(DiagdeskApp.prototype, {
    tab() { return this._tab; },
    setTab(k) {
        const s = toStr(k);
        if (s === 'overview' || s === 'fields' || s === 'pipeline' || s === 'ledger') this._tab = s;
        return this._tab;
    },
    setInput(v) { this._input = toStr(v); return this._input; },
    inputOf() { return this._input; },
    focusOf() { return this._focus; },
    setFocus(k) { this._focus = toStr(k); return this._focus; },
    rawLen() { return this._raw.length; },
    whyText() { return this._why; },
    faceTone() { return FACE_TONE[this._face] || 'off'; },
    ledgerRows() { return this._ledger.slice(0); },
    droppedCount() { return this._dropped; },
    archiveStamp() { return stampOf(this._rawAt); },
    nowStamp() { return stampOf(this._now); },
    versionFaceOf() { return this._sum ? this._sum.version : null; },
    statusFaceOf() { return this._sum ? this._sum.statuses : null; },
    deltaFaceOf() { return this._sum ? this._sum.delta : null; },
    pipelineFaceOf() { return this._sum ? this._sum.pipeline : null; },
    fieldFaceOf() { return this._sum ? this._sum.fields : null; },
    planFaceOf() { return this._sum ? this._sum.plan : null; },
    problemsOf() { return this._sum ? this._sum.problems : []; }
});
