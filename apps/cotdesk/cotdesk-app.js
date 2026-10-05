/* ========================================================
 * cotdesk-app.js — [v3.46.0] 思维链案头 · 落盘与接线
 *
 * 数据层：cotdesk-data.js（纯函数内核）  视图层：cotdesk-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：条目归一 / 落点裁定 / 深度钳位 / 接口判读 /
 *      预填裁决 / 原生字段 / 锁定面 / 正文体检 / 要求文本 —— 都不碰存储；
 *   ③ 落盘（PhoneStorage）：四条会话键，全走 cotdesk_ 前缀。
 *
 * ── 四条会话键 ──────────────────────────────────────────
 *   · cotdesk_items  —— 已收下的条目册（贴回的原文 + 收下时刻）；
 *   · cotdesk_config —— 册子上的配置（模式 / 接口 / 强度 / 预填 / 范围）；
 *   · cotdesk_draft  —— 要求文本草稿（目标 / 追加要求）；
 *   · cotdesk_ledger —— 动作台账（每一次收册 / 改配置 / 出文本的回执）。
 *   ★ 为什么四条分开：源把「开关」「预设」「条目册」「导入进度」全塞进
 *     宿主的一个大对象里 —— 换角色后四类一起串味，而且删一个预设顺手
 *     把当前激活的指向也一起改掉。本件四类各自一条键。
 *
 * ── 本件与源的根本分别（**裁定不等于注入**）────────────
 *   本件**不改写宿主提示词**：不拼系统提示、不 splice 消息数组、
 *   不写推理强度、不塞额外请求体、不抠回复正文、不读宿主界面元素。
 *   它只回答两件事：「照这份册子配下去会落在哪里」「照它做会发生什么」。
 *
 * ── 不缝的那四块（源的整套能力，本件一律不接）──────────
 *   ① 源自己拼系统提示与消息数组（injectItems 一族）—— 本件只算落点；
 *   ② 源往请求体写推理强度 / 思考预算 / 额外请求体 —— 本件零请求；
 *   ③ 源按起止标记从回复里抠思考段并从正文删掉 —— 本件只数标记对；
 *   ④ 源满篇直读宿主元素 —— 本件只读自己的根。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 条目册读不出来 **不许**读成「空册」（四态面分开判）；
 *   · 位置认不出来 **不许**当成中段落下去（落点报「认不出来」）；
 *   · 深度取不出来 **不许**读成 0 层（横线与 0 不同形）；
 *   · 开关缺字段 **不许**替它读成真（本件按关算并写明两边读法）；
 *   · 空条目册 **不许**静默换回默认册（源在这里换）；
 *   · 正文超上限 **不许**静默截（只报）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）；
 *   · 换会话后旧册与旧配置 **不许**留着（onChatChanged 四格全量重取）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量与反斜杠、也不许出现反引号：
 *   一切字符切分走 indexOf / slice / split。
 * ======================================================== */
'use strict';
import {
    CD_MODES, CD_PROVIDERS, CD_POSITIONS, CD_ROLES, CD_PREFILLS, CD_EFFORTS,
    CD_MODE_TEXT, CD_POSITION_TEXT, CD_ROLE_TEXT, CD_SIDES,
    CD_ITEM_MAX, CD_ITEM_TEXT_MAX, CD_TEXT_MAX, CD_CHARS_MAX, CD_LOG_MAX, CD_INTAKE_WHYS,
    CD_SOURCE_NOTE, CD_SOURCE_FILES,
    cleanText, charCount, numOrNull, isPlainObject, indexIn,
    normalizeItem, positionFace, depthFace, providerFace, prefillFace,
    nativeFace, lockFace, itemFace, itemSummary, textScan, extractItems,
    configFace, cdTrim, gaugesOf, gaugeText, requestText
} from './cotdesk-data.js';
import { CotdeskView } from './cotdesk-view.js';
import { writeReceipt, collectReceipt } from '../../config/write-receipt.js';
export const CD_ITEMS_KEY = 'cotdesk_items';
export const CD_CONFIG_KEY = 'cotdesk_config';
export const CD_DRAFT_KEY = 'cotdesk_draft';
export const CD_LEDGER_KEY = 'cotdesk_ledger';
/* 册四态（与数据层读数一一对应；**键面取真源**，不写标识符形）。 */
const FACE_OK = 'ok';
const FACE_EMPTY = 'empty';
const FACE_MALFORMED = 'malformed';
const FACE_ABSENT = 'absent';
const FACE_TEXT = Object.freeze({
    [FACE_OK]: '册子已收下',
    [FACE_EMPTY]: '还没收过册子',
    [FACE_MALFORMED]: '收下的东西读不懂',
    [FACE_ABSENT]: '还没建过对账'
});
const FACE_TONE = Object.freeze({
    [FACE_OK]: 'ok',
    [FACE_EMPTY]: 'warn',
    [FACE_MALFORMED]: 'err',
    [FACE_ABSENT]: 'off'
});
const DASH_UNIT = '--';
/* 收册失败因文案（键面**取数据层真源**，本件不再重列八键 —— 本仓 J7 形态）。 */
const INGEST_WHY_TEXT = Object.freeze({
    [CD_INTAKE_WHYS[0]]: '什么都没贴',
    [CD_INTAKE_WHYS[1]]: '贴进来的原文超过本件上限（只报，不截）',
    [CD_INTAKE_WHYS[2]]: '贴进来的是空字符串',
    [CD_INTAKE_WHYS[3]]: '贴进来的东西里没有括号，不像一份册子',
    [CD_INTAKE_WHYS[4]]: '贴进来的东西不是合法 JSON',
    [CD_INTAKE_WHYS[5]]: '是一份对象，但里面没有条目清单',
    [CD_INTAKE_WHYS[6]]: '条目清单是空的（**这是空册，不是默认册**）',
    [CD_INTAKE_WHYS[7]]: '条目数超过本件上限（只报，不截）'
});
/* 模式 / 接口 / 预填 / 强度 的文案（键面取真源值，不写标识符形）。 */
const MODE_TEXT = Object.freeze({
    [CD_MODES[0]]: CD_MODE_TEXT[CD_MODES[0]],
    [CD_MODES[1]]: CD_MODE_TEXT[CD_MODES[1]],
    [CD_MODES[2]]: CD_MODE_TEXT[CD_MODES[2]]
});
const POSITION_TEXT = Object.freeze({
    [CD_POSITIONS[0]]: CD_POSITION_TEXT[CD_POSITIONS[0]],
    [CD_POSITIONS[1]]: CD_POSITION_TEXT[CD_POSITIONS[1]],
    [CD_POSITIONS[2]]: CD_POSITION_TEXT[CD_POSITIONS[2]],
    [CD_POSITIONS[3]]: CD_POSITION_TEXT[CD_POSITIONS[3]],
    [CD_POSITIONS[4]]: CD_POSITION_TEXT[CD_POSITIONS[4]],
    [CD_POSITIONS[5]]: CD_POSITION_TEXT[CD_POSITIONS[5]]
});
const ROLE_TEXT = Object.freeze({
    [CD_ROLES[0]]: CD_ROLE_TEXT[CD_ROLES[0]],
    [CD_ROLES[1]]: CD_ROLE_TEXT[CD_ROLES[1]],
    [CD_ROLES[2]]: CD_ROLE_TEXT[CD_ROLES[2]]
});
function toStr(v) { return (typeof v === 'string') ? v : ''; }
function dash() { return DASH_UNIT; }
/** 读数取值：取不出来就画横线（**不画 0**）。 */
function meterText(v) {
    const n = numOrNull(v);
    return n === null ? dash() : String(n);
}
/** 枚举文案（键面查，查不到就如实报原文）。 */
function textIn(table, key, fallback) {
    const k = toStr(key);
    const t = table[k];
    if (typeof t === 'string' && t.length) return t;
    return fallback ? fallback : (k.length ? k : dash());
}
export class CotdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'items';
        /* 已收下的册子（原文 + 时刻） */
        this._raw = '';
        this._rawAt = 0;
        /* 册子上的配置（贴回的那份里的四格） */
        this._cfgRaw = '';
        this._cfgAt = 0;
        /* 草稿 */
        this._target = '';
        this._extra = '';
        /* 台账 */
        this._ledger = [];
        this._dropped = 0;
        /* 版面 */
        this._input = '';
        this._focus = '';
        this._now = 0;
        this._face = FACE_ABSENT;
        this._malformed = false;
        this._why = '';
        /* 投影（_recompute 产出；动作口改完内存字段必须紧跟一次） */
        this._cfg = null;
        this._mode = '';
        this._provider = null;
        this._prefill = null;
        this._native = null;
        this._items = [];
        this._sum = null;
        this._locks = null;
        this._scan = null;
        this._gauges = [];
        this._text = '';
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
        /* [v3.58.0 · 计划 O5] 既收单键布尔（writeReceipt 的 saved），也收多键**完成范围**
         *   （collectReceipt 的返回）：多键时 saved 表示「本动作落的那几条键全落了」。 */
        const ok = (wrote && typeof wrote === 'object') ? wrote.saved === true : wrote === true;
        return { saved: ok, storage: this._storageUsable().ok };
    }
    /** 把「本动作落的那几条键」收成一份**完成范围**回执（唯一实现见 config/write-receipt.js）。
     *  ★ 只报最后一条键是本版治的形态：前一条没落下去时界面照样显示成功，
     *    下次打开就出现「正文没了、投影还在」这种两边对不上的状态。 */
    _writeScope(rows) {
        return collectReceipt(rows);
    }
    /** 读一格。三种回报：ok / absent（这一格压根没写过）/ malformed（写了但读不懂）。
     *  ★ 抛异常**不是**「没记过」：本仓最贵的形态是「读不出来 ⇒ 画成空」。 */
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
        if (typeof this.storage.set !== 'function') return false;
        try {
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败也照报成功（与 A 族方向相反的同一类错）。 */
            return writeReceipt(this.storage, key, JSON.stringify(value)).saved === true;
        } catch (e) {
            return false;
        }
    }
    /** 解析一格 JSON。三种回报，**不把读不懂读成空**。 */
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
    _loadItems() {
        this._raw = '';
        this._rawAt = 0;
        const st = this._parse(CD_ITEMS_KEY);
        if (st.face === FACE_ABSENT) return { face: FACE_ABSENT, why: st.why };
        if (st.face === FACE_EMPTY) return { face: FACE_EMPTY, why: '' };
        if (st.face === FACE_MALFORMED) return { face: FACE_MALFORMED, why: st.why };
        const o = st.obj;
        const raw = (typeof o.raw === 'string') ? o.raw : '';
        this._raw = raw;
        const at = numOrNull(o.at);
        this._rawAt = (at === null || at < 0) ? 0 : at;
        if (!raw.length) return { face: FACE_EMPTY, why: '' };
        const cut = (raw.length > CD_TEXT_MAX);
        if (cut) {
            /* 原文超上限：**只报不静默截**。 */
            return { face: FACE_MALFORMED, why: 'too_long', obj: null };
        }
        return { face: FACE_OK, why: '' };
    }
    _loadConfig() {
        this._cfgRaw = '';
        this._cfgAt = 0;
        const st = this._parse(CD_CONFIG_KEY);
        if (st.face !== FACE_OK) return;
        this._cfgRaw = (typeof st.obj.raw === 'string') ? st.obj.raw : '';
        const at = numOrNull(st.obj.at);
        this._cfgAt = (at === null || at < 0) ? 0 : at;
    }
    _loadDraft() {
        this._target = '';
        this._extra = '';
        const st = this._parse(CD_DRAFT_KEY);
        if (st.face !== FACE_OK) return;
        this._target = cleanText(st.obj.target);
        this._extra = cleanText(st.obj.extra);
    }
    _loadLedger() {
        const st = this._parse(CD_LEDGER_KEY);
        if (st.face !== FACE_OK) { this._ledger = []; this._dropped = 0; return; }
        this._ledger = Array.isArray(st.obj.ledger) ? st.obj.ledger : [];
        const dp = numOrNull(st.obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? dp : 0;
    }
    _persistItems() {
        return this._writeJSON(CD_ITEMS_KEY, { raw: this._raw, at: this._rawAt });
    }
    _persistConfig() {
        return this._writeJSON(CD_CONFIG_KEY, { raw: this._cfgRaw, at: this._cfgAt });
    }
    _persistDraft() {
        return this._writeJSON(CD_DRAFT_KEY, { target: this._target, extra: this._extra });
    }
    _persistLedger() {
        return this._writeJSON(CD_LEDGER_KEY, { ledger: this._ledger, dropped: this._dropped });
    }
    /* ---------- 取数（每次 render / 换会话都重取） ---------- */
    probe() {
        const it = this._loadItems();
        this._face = it.face;
        this._why = it.why || '';
        this._malformed = (it.face === FACE_MALFORMED);
        this._loadConfig();
        this._loadDraft();
        this._loadLedger();
        this._recompute();
        return { face: this._face, why: this._why };
    }
    /** 投影（**唯一一处**算账：本件不产第二份清单）。 */
    _recompute() {
        this._cfg = configFace(this._cfgRaw);
        const mode = this._cfg.given ? this._cfg.mode : '';
        this._mode = mode;
        const provider = providerFace(this._cfg.given ? this._cfg.provider : '', '', '');
        this._provider = provider;
        this._prefill = prefillFace(this._cfg.given ? this._cfg.prefill : '', mode);
        this._native = nativeFace(provider.provider, this._cfg.given ? this._cfg.nativeEffort : '', mode);
        const ex = extractItems(this._raw);
        if (!ex.ok) {
            this._items = [];
            this._sum = itemSummary([]);
            this._locks = lockFace([]);
            this._scan = textScan('');
            this._gauges = gaugesOf({ items: 0, chars: 0, logs: this._ledger.length });
            this._text = '';
            return;
        }
        const rows = [];
        const list = ex.list.slice(0, CD_ITEM_MAX);
        for (let i = 0; i < list.length; i++) rows.push(itemFace(list[i], i));
        this._items = rows;
        this._sum = itemSummary(rows);
        const norm = [];
        for (let i = 0; i < list.length; i++) norm.push(normalizeItem(list[i], i));
        this._locks = lockFace(norm);
        let body = '';
        for (let i = 0; i < list.length; i++) {
            const c = cleanText(isPlainObject(list[i]) ? list[i].content : '');
            if (c.length) body += c + String.fromCharCode(10);
        }
        this._scan = textScan(body);
        this._gauges = gaugesOf({ items: rows.length, chars: this._sum.chars, logs: this._ledger.length });
        this._text = '';
    }
    /* ---------- 动作台账 ---------- */
    _receipt(action, ok, why, extra) {
        const ex = isPlainObject(extra) ? extra : {};
        const n = numOrNull(ex.n);
        const row = {
            at: this._now, action: String(action), ok: ok === true,
            why: String(why || ''), n: (n === null) ? 0 : Math.trunc(n)
        };
        this._ledger.push(row);
        const t = cdTrim(this._ledger, CD_LOG_MAX);
        this._ledger = t.rows;
        this._dropped += t.dropped;
        const wl = this._persistLedger();
        /* [v3.58.0 · 计划 O5] 台账那条键的落盘结果**必须回出去**：动作口的 saved 要算上它，
         *   此前台账落没落只有本函数知道，而调用方报的是字面 true。 */
        row.saved = wl === true;
        return row;
    }
    /* ---------- 动作口（只写自己的四条键） ---------- */
    /** 收下一份册子：只把原文存进自己的键，**不动宿主任何数据**。 */
    ingestItems(text) {
        const raw = cleanText(text);
        if (!raw.length) {
            this._receipt('items_ingest', false, 'empty_input', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty_input' });
        }
        if (raw.length > CD_TEXT_MAX) {
            this._receipt('items_ingest', false, 'too_long', { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });
        }
        /* ★ 形状认不出来的粘贴 **不动作**：不许把台面上那份已收的册子冲掉，
         *   也不许把它当成「收下了一份认不出来的册子」记进账里 —— 两类失败不同形。 */
        const ex = extractItems(raw);
        if (!ex.ok) {
            this._receipt('items_ingest', false, ex.why, { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: ex.why, chars: raw.length });
        }
        if (ex.total > CD_ITEM_MAX) {
            this._receipt('items_ingest', false, 'too_many', { n: ex.total });
            return Object.assign(this._savedOk(false), { ok: false, why: 'too_many', total: ex.total });
        }
        this._raw = raw;
        this._rawAt = this._now;
        const wItems = this._persistItems();
        this.probe();
        const rcI = this._receipt('items_ingest', true, '', { n: ex.total });
        /* 这一刀落两条键：册子原文 + 台账。**两条都算** —— 只报后者就是「原文丢了也报成功」。 */
        const wrI = this._writeScope([
            { key: 'items', ok: wItems === true, why: wItems === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcI.saved === true, why: rcI.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrI), { ok: true, items: ex.total });
    }
    /** 放下一份册子（只清自己的键；**不是**清宿主）。 */
    clearItems() {
        const had = this._raw.length;
        this._raw = '';
        this._rawAt = 0;
        const wItemsC = this._persistItems();
        this.probe();
        const rcIC = this._receipt('items_clear', true, '', { n: had });
        /* 清空同样落两条键（清原文 + 补一笔台账）。 */
        const wrIC = this._writeScope([
            { key: 'items', ok: wItemsC === true, why: wItemsC === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcIC.saved === true, why: rcIC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrIC), { ok: true, cleared: had });
    }
    /** 收下配置：四格（模式 / 接口 / 强度 / 预填）原样存，**不替它补默认值**。 */
    ingestConfig(text) {
        const raw = cleanText(text);
        if (!raw.length) {
            this._receipt('config_ingest', false, 'empty_input', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty_input' });
        }
        if (raw.length > CD_TEXT_MAX) {
            this._receipt('config_ingest', false, 'too_long', { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });
        }
        const cf = configFace(raw);
        if (!cf.given) {
            this._receipt('config_ingest', false, cf.why, { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: cf.why, chars: raw.length });
        }
        this._cfgRaw = raw;
        this._cfgAt = this._now;
        const wCfg = this._persistConfig();
        this.probe();
        const rcC = this._receipt('config_ingest', true, '', { n: 0 });
        const wrC = this._writeScope([
            { key: 'config', ok: wCfg === true, why: wCfg === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcC.saved === true, why: rcC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrC), { ok: true, mode: this._mode });
    }
    clearConfig() {
        const had = this._cfgRaw.length;
        this._cfgRaw = '';
        this._cfgAt = 0;
        const wCfgC = this._persistConfig();
        this.probe();
        const rcCC = this._receipt('config_clear', true, '', { n: had });
        const wrCC = this._writeScope([
            { key: 'config', ok: wCfgC === true, why: wCfgC === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcCC.saved === true, why: rcCC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrCC), { ok: true, cleared: had });
    }
    setTarget(text) {
        this._target = cleanText(text);
        const wrote = this._persistDraft();
        this._receipt('draft_target', true, '', { n: 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, chars: charCount(this._target) });
    }
    setExtra(text) {
        this._extra = cleanText(text);
        const wrote = this._persistDraft();
        this._receipt('draft_extra', true, '', { n: 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, chars: charCount(this._extra) });
    }
    /** 出一份要求文本（**本件唯一的产出物**）：只产描述，一个字段都不写。 */
    makeText() {
        if (this._face !== FACE_OK) {
            this._receipt('text_make', false, 'no_items', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'no_items', text: '' });
        }
        const t = this.textOf();
        this._receipt('text_make', true, '', { n: charCount(t) });
        return Object.assign(this._savedOk(false), { ok: true, text: t, chars: charCount(t) });
    }
    clearLedger() {
        const had = this._ledger.length;
        const wasDropped = this._dropped;
        this._ledger = [];
        this._dropped = 0;
        const wrote = this._persistLedger();
        return Object.assign(this._savedOk(wrote), { ok: true, cleared: had, wasDropped: wasDropped });
    }
    /* ---------- 页面投影（视图层只读这里，不持第二份清单） ---------- */
    faceOf() { return this._face; }
    faceText() { return FACE_TEXT[this._face] || FACE_TEXT[FACE_ABSENT]; }
    faceTone() { return FACE_TONE[this._face] || FACE_TONE[FACE_ABSENT]; }
    whyText() {
        const w = this._why;
        if (!w) return '';
        if (w === 'too_long') return '收下的原文超过本件上限（' + String(CD_TEXT_MAX) + ' 字符），只报不静默截';
        if (w === 'json') return '收下的这一格不是合法 JSON';
        if (w === 'shape') return '收下的这一格不是一份对象';
        if (w === 'read_threw') return 'storage 读这一格时抛了异常 —— 与「没记过」不同形';
        return w;
    }
    /** 收册失败因文案（本件自己的表，查不到就如实报键）。 */
    ingestWhyText(key) {
        const k = toStr(key);
        if (!k.length) return '';
        return INGEST_WHY_TEXT[k] || k;
    }
    configRow() { return this._cfg; }
    modeText() {
        const m = this._mode;
        if (!m.length) return dash();
        return textIn(MODE_TEXT, m, m + '（不在三个已知模式里）');
    }
    providerRow() { return this._provider; }
    prefillRow() { return this._prefill; }
    nativeRow() { return this._native; }
    itemRows() { return this._items; }
    itemSum() { return this._sum; }
    lockRow() { return this._locks; }
    scanRow() { return this._scan; }
    gaugeRows() {
        const gs = this._gauges;
        const out = [];
        for (let i = 0; i < gs.length; i++) {
            const g = gs[i];
            out.push({
                key: g.key, label: g.label, text: g.text, pct: g.pct,
                blank: g.blank, over: g.over,
                tone: g.blank ? 'off' : (g.over ? 'err' : (g.pct >= 80 ? 'warn' : 'ok'))
            });
        }
        return out;
    }
    sourceRows() {
        const out = [];
        for (let i = 0; i < CD_SOURCE_FILES.length; i++) {
            const f = CD_SOURCE_FILES[i];
            out.push({ key: f.key, file: f.file, role: f.role, bytesText: meterText(f.bytes) + ' 字节', linesText: meterText(f.lines) + ' 行' });
        }
        return out;
    }
    sourceNote() { return CD_SOURCE_NOTE; }
    sideRows() {
        const out = [];
        for (let i = 0; i < CD_SIDES.length; i++) {
            const s = CD_SIDES[i];
            const n = (this._sum && this._sum.sides && typeof this._sum.sides[s.key] === 'number') ? this._sum.sides[s.key] : 0;
            out.push({ key: s.key, label: s.label, where: s.where, n: n });
        }
        return out;
    }
    ledgerRows() {
        const out = [];
        const src = Array.isArray(this._ledger) ? this._ledger : [];
        const rev = src.slice().reverse();
        for (let i = 0; i < rev.length; i++) {
            const r = rev[i];
            out.push({ index: i, action: r.action, ok: r.ok, why: r.why, n: r.n, at: r.at });
        }
        return out;
    }
    droppedCount() { return this._dropped; }
    drafts() { return { target: this._target, extra: this._extra }; }
    rawLen() { return this._raw.length; }
    cfgLen() { return this._cfgRaw.length; }
    textOf() {
        const rows = [];
        const items = this._items;
        for (let i = 0; i < items.length; i++) {
            const r = items[i];
            rows.push({
                name: r.name, position: r.position, role: r.role,
                depthText: (r.depth && typeof r.depth.text === 'string') ? r.depth.text : dash()
            });
        }
        const face = {
            modeText: this.modeText(),
            providerText: (this._provider ? this._provider.text : dash()),
            prefillText: (this._prefill ? this._prefill.text : dash()),
            nativeText: (this._native ? this._native.text : dash()),
            rows: rows,
            flat: (this._sum ? this._sum.flattened : 0),
            unknown: (this._sum && this._sum.sides && typeof this._sum.sides.unknown === 'number') ? this._sum.sides.unknown : 0
        };
        return requestText(face, this._target, this._extra);
    }
    inputOf() { return this._input; }
    setInput(t) { this._input = (typeof t === 'string') ? t : ''; return this._input; }
    clearInput() { this._input = ''; return ''; }
    tab() { return this._tab; }
    setTab(t) {
        const k = toStr(t);
        const ok = ['items', 'config', 'sides', 'ledger'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'items';
        return this._tab;
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：册子 / 配置 / 草稿 / 台账 全是「这段关系的账」，故全部重取。
     *  ★ 四格的装载由 probe **一处**承担（单一装载路径）。 */
    onChatChanged() {
        this._tab = 'items';
        this._focus = '';
        this._input = '';
        this._now = 0;
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, face: this._face };
    }
    render() {
        this.probe();
        if (!this._view) this._view = new CotdeskView(this, this.shell, this.storage);
        this._view.render();
    }
}