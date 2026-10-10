/* ========================================================
 * archive-app.js — [v3.45.0] 存档台 · 落盘与接线
 *
 * 数据层：archive-data.js（纯函数内核）  视图层：archive-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：包型裁定 / 版本互认 / 覆盖性 / 逐表读数 /
 *      结构体检 / 体积估重 / 重置影响 / 要求文本 —— 都不碰存储；
 *   ③ 落盘（PhoneStorage）：四条会话键，全走 /^archive_/ 前缀。
 *
 * ── 四条会话键 ──────────────────────────────────────────
 *   · archive_pack   —— 已收下的包（贴回的原文 + 收下时刻）；
 *   · archive_face   —— 对账面（逐表读数 + 结构可疑 + 重置影响）；
 *   · archive_draft  —— 要求文本草稿（目标 / 追加要求）；
 *   · archive_ledger —— 动作台账（每一次收包 / 改目标 / 出文本的回执）。
 *   ★ 为什么四条分开：源把「导出设置」「导入进度」「自动备份开关」「重置确认」
 *     四类全塞进一个 AppState 大对象里 —— 换角色后四类一起串味，
 *     而关掉自动备份顺手把已收包的记录也清了。本件四类各自一条键。
 *
 * ── 本件与源的根本分别（**裁定不等于迁移**）────────────
 *   本件**不写任何宿主数据**：一个字段都不写、一张表都不碰、
 *   不 reload、不清 storage、不建 Blob、不连 GitHub。
 *   它只回答两件事：「这份包是什么」「拿它做恢复会发生什么」。
 *   口径纪律与 config/storage.js 的 schemaFace() 同族：只描述，不动手。
 *
 * ── 不缝的那四块（源的整套能力，本件一律不接）──────────
 *   ① 源 Utils.saveData / IndexedDB 全表读写 / GitHub 上传恢复 —— 本件只走 PhoneStorage；
 *   ② 源 Blob + URL.createObjectURL + a.click() 造下载 —— 本件零下载零上传；
 *   ③ 源 compressImage / canvas 重编码 / compressAllImagesInDB —— 本件零出图，只估重；
 *   ④ 源满篇 document.getElementById 直读宿主元素 —— 本件只读自己的根。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 包读不出来 **不许**读成「空包」（四态面分开判）；
 *   · 包型认不出来 **不许**按全量处理（源在这里直接覆盖）；
 *   · 表条数取不出来 **不许**画成 0（null 与 0 不同形）；
 *   · 体积读不出来 **不许**画成 0 B；
 *   · 清空类操作 **不许**只说「会覆盖」（逐表列出会被清空的）；
 *   · 台账挤掉旧记录 **不许**静默（报被挤掉几条）；
 *   · 换会话后旧包与旧对账 **不许**留着（onChatChanged 四格全量重取）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量与反斜杠、也不许出现反引号：
 *   一切字符切分走 indexOf / slice / split。
 * ======================================================== */
'use strict';
import {
    AR_PACK_WHYS, AR_PACK_WHY_TEXT, AR_PACK_MODES, AR_APP_TABLES, AR_RELATED_TABLES,
    AR_STREAM_TABLES, AR_330_TABLES, AR_SINGLE_OBJECT_TABLES, AR_REQUIRED,
    AR_BUNDLE_MAX, AR_TEXT_MAX, AR_LOG_MAX, AR_TABLE_MAX, AR_ROWS_SHOWN, AR_GAUGE_KEYS,
    AR_SOURCE_NOTE, AR_SOURCE_FILES, AR_BLOCK_FILE,
    cleanText, charCount, numOrNull, isPlainObject, classifyBundle, versionFace,
    overwriteFace, tableFace, tableSummary, tableMembership, tableDiffs,
    formatBytes, sizeOf, imageScan, auditOf, resetPlan, resetSummary, arTrim,
    gaugesOf, gaugeText, requestText, extractObject
} from './archive-data.js';
import { ArchiveView } from './archive-view.js';
import { writeReceipt } from '../../config/write-receipt.js';
/* [v3.88.0 · 拓展计划 R-X4] 包 → 项目行的归一**唯一口径**（真源 config/resume-workbench.js）。
 *   本件是「项目清单」的取数源，咽喉是消费者；两处各写一套字段礼规会在改字段名时
 *   静默归一成一行空项目（不报错）—— 故归一只能有一份，这里只 import。 */
import { rwProjectsFromPack } from '../../config/resume-workbench.js';
export const AR_PACK_KEY = 'archive_pack';
export const AR_FACE_KEY = 'archive_face';
export const AR_DRAFT_KEY = 'archive_draft';
export const AR_LEDGER_KEY = 'archive_ledger';
/* 包四态（与数据层读数一一对应；**键面取真源**，不写标识符形）。 */
const FACE_OK = 'ok';
const FACE_EMPTY = 'empty';
const FACE_MALFORMED = 'malformed';
const FACE_ABSENT = 'absent';
const FACE_TEXT = Object.freeze({
    [FACE_OK]: '包已收下',
    [FACE_EMPTY]: '还没收过包',
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
/* 包型因文案（取真源值当键，不写标识符形）。 */
const PACK_WHY_TEXT = Object.freeze({
    [AR_PACK_WHYS[0]]: '认得出来',
    [AR_PACK_WHYS[1]]: '不是一份对象',
    [AR_PACK_WHYS[2]]: '没有版本号',
    [AR_PACK_WHYS[3]]: '版本号读不出整数',
    [AR_PACK_WHYS[4]]: '没有装着内容的格子',
    [AR_PACK_WHYS[5]]: '清单是空的'
});
/* 覆盖模式文案（键面取真源）。 */
const MODE_TEXT = Object.freeze({
    [AR_PACK_MODES[0].key]: '补充式：同 id 的行被覆盖，别的行留着',
    [AR_PACK_MODES[1].key]: '覆盖式：这些表先被清空再写入',
    [AR_PACK_MODES[2].key]: '不适用（认不出来）'
});
function toStr(v) { return (typeof v === 'string') ? v : ''; }
function dash() { return DASH_UNIT; }
/** 读数取值：取不出来就画横线（**不画 0**）。 */
function meterText(v) {
    const n = numOrNull(v);
    return n === null ? dash() : String(n);
}
/** 找真源表里的一项（键面查，不写死标识符）。 */
function pickIn(table, key) {
    const k = toStr(key);
    for (let i = 0; i < table.length; i++) {
        if (table[i].key === k || table[i].sourceKey === k) return table[i];
    }
    return null;
}
export class ArchiveApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'pack';
        /* 已收下的包（原文 + 时刻） */
        this._packRaw = '';
        this._packAt = 0;
        /* 对账草稿 */
        this._target = '';
        this._mode = '';
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
        this._bundle = null;
        this._ver = null;
        this._over = null;
        this._rows = [];
        this._sum = null;
        this._audit = null;
        this._reset = [];
        this._resetSum = null;
        this._size = null;
        this._img = null;
        this._gauges = [];
        this._text = '';
        /* [v3.88.0 · R-X4] 选中的项目（内存镜像；持久化在**自己的** AR_FACE_KEY 的 lastSelected 一格，
         *   与咽喉共用同一次落笔 —— 不给它另起第五条键）。 */
        this._sel = null;
        /* 项目清单读数（null = 读不到；[] = 认得出但没有项目身份）。
         *   ★ 两者**不同形**：读不到要如实说读不到，空清单是真的没有。 */
        this._proj = null;
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
    _loadPack() {
        this._packRaw = '';
        this._packAt = 0;
        const st = this._parse(AR_PACK_KEY);
        if (st.face === FACE_ABSENT) return { face: FACE_ABSENT, why: st.why };
        if (st.face === FACE_EMPTY) return { face: FACE_EMPTY, why: '' };
        if (st.face === FACE_MALFORMED) return { face: FACE_MALFORMED, why: st.why };
        const o = st.obj;
        const raw = (typeof o.raw === 'string') ? o.raw : '';
        this._packRaw = raw;
        const at = numOrNull(o.at);
        this._packAt = (at === null || at < 0) ? 0 : at;
        if (!raw.length) return { face: FACE_EMPTY, why: '' };
        const cut = (raw.length > AR_TEXT_MAX);
        if (cut) {
            /* 原文超上限：**只报不静默截**。 */
            return { face: FACE_MALFORMED, why: 'too_long', obj: null };
        }
        return { face: FACE_OK, why: '' };
    }
    _loadDraft() {
        this._target = '';
        this._mode = '';
        const st = this._parse(AR_DRAFT_KEY);
        if (st.face !== FACE_OK) return;
        this._target = cleanText(st.obj.target);
        this._mode = cleanText(st.obj.mode);
    }
    _loadLedger() {
        const st = this._parse(AR_LEDGER_KEY);
        if (st.face !== FACE_OK) { this._ledger = []; this._dropped = 0; return; }
        this._ledger = Array.isArray(st.obj.ledger) ? st.obj.ledger : [];
        const dp = numOrNull(st.obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? dp : 0;
    }
    /** _loadFace 与 _readRaw('archive_face') 同源（避免两处各取一次）。 */
    _faceSlot() {
        const st = this._parse(AR_FACE_KEY);
        if (st.face !== FACE_OK) return null;
        return st.obj;
    }
    /** [v3.88.0 · R-X4] 装载「选中项」：从**本件自己的**对账面读回来。
     *  ★ 认不出形状（老版本写的对账面没有这一格）⇒ 判「没选」而不是编一个默认项目。 */
    _loadFaceSel() {
        this._sel = null;
        const face = this._faceSlot();
        const raw = (face && typeof face === 'object') ? face.lastSelected : null;
        const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
        if (!o) return;
        const pid = toStr(o.projectId).trim();
        if (!pid) return;
        this._sel = {
            projectId: pid, title: toStr(o.title), volume: toStr(o.volume), chapter: toStr(o.chapter),
            volumeId: toStr(o.volumeId), navKey: toStr(o.navKey),
            lastFloor: (typeof o.lastFloor === 'number' && Number.isFinite(o.lastFloor) && o.lastFloor >= 0) ? o.lastFloor : null
        };
    }
    _persistPack() {
        return this._writeJSON(AR_PACK_KEY, { raw: this._packRaw, at: this._packAt });
    }
    _persistDraft() {
        return this._writeJSON(AR_DRAFT_KEY, { target: this._target, mode: this._mode });
    }
    _persistLedger() {
        return this._writeJSON(AR_LEDGER_KEY, { ledger: this._ledger, dropped: this._dropped });
    }
    /** 收下这一份包（**只写自己的四条键**，宿主一个字段都不碰）。 */
    _persistFace() {
        return this._writeJSON(AR_FACE_KEY, {
            face: this._face, pack: this._bundle ? this._bundle.pack : 'unknown',
            tables: this._rows.length, rows: this._sum ? this._sum.rows : null,
            /* [v3.88.0 · R-X4] 选中项与对账面**同一次落笔**（多写一格，不新增存储键）。
             *   ★ null 是合法值：没选就明写 null（咽喉据此维持会话隔离）。 */
            lastSelected: this._sel ? Object.assign({}, this._sel) : null,
            at: this._now
        });
    }
    /* ---------- 取数（每次 render / 换会话都重取） ---------- */
    probe() {
        const pk = this._loadPack();
        this._face = pk.face;
        this._why = pk.why || '';
        this._malformed = (pk.face === FACE_MALFORMED);
        this._loadDraft();
        this._loadLedger();
        this._loadFaceSel();
        this._loadProjects();
        this._recompute();
        return { face: this._face, why: this._why };
    }
    /** 投影（**唯一一处**算账：本件不产第二份清单）。 */
    _recompute() {
        const raw = this._packRaw;
        let parsed = { ok: false, why: 'empty', value: null };
        if (raw.length) parsed = extractObject(raw);
        if (!parsed.ok) {
            this._bundle = classifyBundle(null);
            this._bundle.why = (raw.length ? parsed.why : 'not_object');
            this._ver = versionFace(null, 'unknown');
            this._over = overwriteFace('unknown', [], []);
            this._rows = tableFace(null, []);
            this._sum = tableSummary(this._rows);
            this._audit = auditOf(this._records(), this._isGroup());
            this._reset = resetPlan(this._resetEntries());
            this._resetSum = resetSummary(this._reset);
            const sz = sizeOf(raw);
            this._size = sz;
            this._img = imageScan(raw);
            this._text = '';
            this._gauges = gaugesOf({ pack: 0, tables: 0, rows: null, logs: this._ledger.length });
            return;
        }
        const b = classifyBundle(parsed.value);
        this._bundle = b;
        this._ver = versionFace(b.version, b.pack);
        this._over = overwriteFace(b.pack, b.tables, AR_STREAM_TABLES);
        this._rows = tableFace(parsed.value.data, b.tables);
        this._sum = tableSummary(this._rows);
        this._audit = auditOf(this._records(), this._isGroup());
        this._reset = resetPlan(this._resetEntries());
        this._resetSum = resetSummary(this._reset);
        this._size = sizeOf(raw);
        this._img = imageScan(raw);
        this._text = '';
        this._gauges = gaugesOf({ pack: 1, tables: b.tables.length, rows: this._sum.rows, logs: this._ledger.length });
    }
    /** 从包里取聊天记录（只按真源表名取，不写字面量）。 */
    _records() {
        const raw = this._packRaw;
        if (!raw.length) return null;
        const p = extractObject(raw);
        if (!p.ok) return null;
        const b = classifyBundle(p.value);
        let bag = null;
        if (isPlainObject(p.value.data)) bag = p.value.data;
        else if (b.pack === 'stream') bag = p.value;
        if (!bag) return null;
        const v = bag[AR_STREAM_TABLES[0]];
        return Array.isArray(v) ? v : null;
    }
    _isGroup() {
        const rs = this._records();
        if (!rs) return false;
        for (let i = 0; i < rs.length; i++) {
            const r = rs[i];
            if (isPlainObject(r) && Array.isArray(r.members) && r.members.length) return true;
        }
        return false;
    }
    /** 重置影响面：逐表列出（源式全量重置会清掉的每一张）。
     *  ★ 不许只给一个总数 —— 逐键列，并对读不出来的键如实画横线。 */
    _resetEntries() {
        const rows = this._rows;
        const out = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const m = tableMembership(r.table);
            const tags = [];
            if (m.stream) tags.push('流式清单');
            if (m.t330) tags.push('330 清单');
            if (m.single) tags.push('单对象');
            out.push({
                key: r.table,
                label: r.table + (tags.length ? '（' + tags.join(' / ') + '）' : '（不在两套清单里）'),
                rows: r.rows
            });
        }
        return out;
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
        const t = arTrim(this._ledger, AR_LOG_MAX);
        this._ledger = t.rows;
        this._dropped += t.dropped;
        this._persistLedger();
        return row;
    }
    /* ---------- 动作口（只写自己的四条键） ---------- */
    /** 收下一份包：只把原文存进自己的键，**不动宿主任何数据**。 */
    ingestPack(text) {
        const raw = cleanText(text);
        if (!raw.length) {
            this._receipt('pack_ingest', false, 'empty_input', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'empty_input' });
        }
        if (raw.length > AR_TEXT_MAX) {
            this._receipt('pack_ingest', false, 'too_long', { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });
        }
        /* ★ 形状认不出来的粘贴 **不动作**：不许把台面上那份已收的包冲掉，
         *   也不许把它当成「收下了一份认不出来的包」记进账里 —— 两类失败不同形。 */
        const box = extractObject(raw);
        if (!box.ok) {
            this._receipt('pack_ingest', false, box.why, { n: raw.length });
            return Object.assign(this._savedOk(false), { ok: false, why: box.why, chars: raw.length });
        }
        this._packRaw = raw;
        this._packAt = this._now;
        this._persistPack();
        this.probe();
        const wrote = this._persistFace();
        this._receipt('pack_ingest', true, '', { n: this._rows.length });
        return Object.assign(this._savedOk(wrote), {
            ok: true, pack: this._bundle.pack, tables: this._rows.length
        });
    }
    /** 放下一份包（只清自己的键；**不是**清宿主）。 */
    clearPack() {
        this._packRaw = '';
        this._packAt = 0;
        /* 放下包 ⇒ 选中项一并清掉：清单都没了，还留着一个「选中的项目」就是把
         *   已经不存在的项目报成选好的（与「读不到 ≠ 没有」同一条纪律）。 */
        this._sel = null;
        this._persistPack();
        this.probe();
        const wrote = this._persistFace();
        this._receipt('pack_clear', true, '', { n: 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, kept: 0 });
    }
    setTarget(text) {
        this._target = cleanText(text);
        const wrote = this._persistDraft();
        this._receipt('draft_target', true, '', { n: 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, chars: charCount(this._target) });
    }
    setMode(text) {
        this._mode = cleanText(text);
        const wrote = this._persistDraft();
        this._receipt('draft_mode', true, '', { n: 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, chars: charCount(this._mode) });
    }
    /** 出一份要求文本（**本件唯一的产出物**）：只产描述，一个字段都不写。 */
    makeText() {
        if (this._face !== FACE_OK) {
            this._receipt('text_make', false, 'no_pack', { n: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: 'no_pack', text: '' });
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
    /** [v3.88.0 · R-X4] 项目清单读数：走**唯一归一实现**。
     *   读不到 ⇒ null；读得到但认不出项目身份 ⇒ []；认得出 ⇒ [项目行]。 */
    _loadProjects() {
        this._proj = null;
        /* 读这一格**抛了异常** ⇒ 清单是「读不到」（null），与「认得出但不带项目身份」（[]）不同形。
         *   ★ 本仓最贵的形态是「读不出来 ⇒ 画成空」：storage 异常必须一路如实传到项目块，
         *     否则 _projectBlock 的「读不到」分支永远走不到，用户会把取数失败当成「这份包没有项目」。 */
        if (this._why === 'read_threw') return;
        const raw = this._packRaw;
        /* 还没收过包 ⇒ 空清单（对账面另有「还没收过包」一态，看得到）。 */
        if (!raw.length) { this._proj = []; return; }
        /* 收下的东西**读不懂** ⇒ 清单同样不可判：它**不是**「这份包没有项目」。 */
        const box = extractObject(raw);
        if (!box.ok) return;
        this._proj = rwProjectsFromPack(box.value);
    }
    /* ---------- [v3.88.0 · R-X4] 项目清单与选中项（只动本件自己的格） ---------- */
    /** 清单是否读得到（null 与 [] 处置相反）。 */
    projectsReadable() { return this._proj !== null; }
    /** 清单**读不到**时的归因（取值只有三种；视图据此说人话，不自己猜）。
     *   · 'read_threw'         —— storage 读这一格时抛了异常（与「没记过」不同形）；
     *   · 'payload-unreadable' —— 收下的原文读不懂，项目身份无从取出；
     *   · ''                   —— 读得到（清单可能是空表，那是「真没有」）。 */
    projectsWhy() {
        if (this._why === 'read_threw') return 'read_threw';
        if (this._proj === null) return 'payload-unreadable';
        return '';
    }
    /** 项目行（读不到给空表 —— 调用方必须先看 projectsReadable）。 */
    projectRows() { return Array.isArray(this._proj) ? this._proj.slice() : []; }
    projectCount() { return Array.isArray(this._proj) ? this._proj.length : null; }
    /** 当前选中项（没选给 null，**不拿列表第一项顶上**）。 */
    selected() { return this._sel ? Object.assign({}, this._sel) : null; }
    selectedId() { return this._sel ? this._sel.projectId : ''; }
    /** 选一个项目（**只收清单里真有的那一个**；不在清单里一律不选，归因为 not-in-list）。
     *  为什么必须校验：咽喉按「选中项在场」决定要不要产出项目读数 —— 让它拿着一个
     *  清单里根本没有的 id，等于把「选错了」伪装成「选好了」。 */
    selectProject(pid) {
        const want = toStr(pid).trim();
        if (!want) return this.clearSelection();
        if (!this.projectsReadable()) {
            return Object.assign(this._savedOk(false), { ok: false, why: 'list-unreadable', selected: null });
        }
        const rows = this.projectRows();
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].projectId === want) return this.setSelected(rows[i]);
        }
        return Object.assign(this._savedOk(false), { ok: false, why: 'not-in-list', selected: null });
    }
    /** 直接落一个选中项（视图层已经拿到的项目行）。 */
    setSelected(row) {
        const o = (row && typeof row === 'object' && !Array.isArray(row)) ? row : null;
        const pid = toStr(o && o.projectId).trim();
        if (!pid) return this.clearSelection();
        const fl = numOrNull(o.lastFloor != null ? o.lastFloor : o.floor);
        this._sel = {
            projectId: pid, title: toStr(o.title), volume: toStr(o.volume), chapter: toStr(o.chapter),
            volumeId: toStr(o.volumeId), navKey: toStr(o.navKey),
            lastFloor: (fl !== null && fl >= 0) ? fl : null
        };
        const wrote = this._persistFace();
        this._receipt('project_select', true, '', { n: 1 });
        return Object.assign(this._savedOk(wrote), { ok: true, selected: this.selected() });
    }
    /** 取消选择（选择是可撤销的；取消后咽喉回到「维持隔离」）。 */
    clearSelection() {
        this._sel = null;
        const wrote = this._persistFace();
        this._receipt('project_clear', true, '', { n: 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, selected: null });
    }
    /* ---------- 页面投影（视图层只读这里，不持第二份清单） ---------- */
    faceOf() { return this._face; }
    faceText() { return FACE_TEXT[this._face] || FACE_TEXT[FACE_ABSENT]; }
    faceTone() { return FACE_TONE[this._face] || FACE_TONE[FACE_ABSENT]; }
    whyText() {
        const w = this._why;
        if (!w) return '';
        if (w === 'too_long') return '收下的原文超过本件上限（' + String(AR_TEXT_MAX) + ' 字符），只报不静默截';
        if (w === 'json') return '收下的这一格不是合法 JSON';
        if (w === 'shape') return '收下的这一格不是一份对象';
        if (w === 'read_threw') return 'storage 读这一格时抛了异常 —— 与「没记过」不同形';
        return w;
    }
    packWhyText() {
        const b = this._bundle;
        if (!b) return dash();
        return PACK_WHY_TEXT[b.why] || b.why || dash();
    }
    bundle() { return this._bundle; }
    versionRow() { return this._ver; }
    overwriteRow() { return this._over; }
    tableRows() { return this._rows; }
    tableSum() { return this._sum; }
    auditRows() {
        const a = this._audit;
        if (!a || !a.items || !a.items.length) return [];
        const out = [];
        for (let i = 0; i < a.items.length; i++) {
            const it = a.items[i];
            if (!it.misses.length) continue;
            out.push({ label: it.label, misses: it.misses });
        }
        return out;
    }
    resetRows() { return this._reset; }
    resetSum() { return this._resetSum; }
    sizeRow() { return this._size; }
    imageRow() { return this._img; }
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
        for (let i = 0; i < AR_SOURCE_FILES.length; i++) {
            const f = AR_SOURCE_FILES[i];
            out.push({ key: f.key, file: f.file, role: f.role, bytesText: formatBytes(f.bytes) });
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
    drafts() { return { target: this._target, mode: this._mode }; }
    textOf() {
        const b = this._bundle;
        const face = {
            label: b ? b.label : '认不出来', version: b ? b.version : null,
            tables: b ? b.tables : [], modeText: this.modeText()
        };
        return requestText(face, this._target, this._mode);
    }
    modeText() {
        const b = this._bundle;
        if (!b) return dash();
        const m = b.mode;
        let label = dash();
        for (let i = 0; i < AR_PACK_MODES.length; i++) {
            if (AR_PACK_MODES[i].key === m) { label = AR_PACK_MODES[i].label; break; }
        }
        let extra = MODE_TEXT[m] || '';
        let text = label;
        if (extra && extra !== label) text = label + ' —— ' + extra;
        return text;
    }
    clearsTables() {
        const o = this._over;
        if (!o || !Array.isArray(o.clearsTables)) return [];
        return o.clearsTables.slice();
    }
    unknownTables() {
        const o = this._over;
        if (!o || !Array.isArray(o.unknownTables)) return [];
        return o.unknownTables.slice();
    }
    listDiffs() { return tableDiffs(); }
    requiredRows() {
        const out = [];
        for (let i = 0; i < AR_REQUIRED.length; i++) {
            const r = AR_REQUIRED[i];
            out.push({ path: r.path, label: r.label, kind: r.kind, fix: r.fix, scope: r.scope });
        }
        return out;
    }
    inputOf() { return this._input; }
    setInput(t) { this._input = (typeof t === 'string') ? t : ''; return this._input; }
    clearInput() { this._input = ''; return ''; }
    tab() { return this._tab; }
    setTab(t) {
        const k = toStr(t);
        const ok = ['pack', 'face', 'reset', 'ledger'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'pack';
        return this._tab;
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：包 / 对账 / 草稿 / 台账 全是「这段关系的账」，故全部重取。
     *  ★ 四格的装载由 probe **一处**承担（单一装载路径）。 */
    onChatChanged() {
        this._tab = 'pack';
        this._sel = null;
        this._proj = null;
        this._focus = '';
        this._input = '';
        this._now = 0;
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, face: this._face };
    }
    render() {
        this.probe();
        if (!this._view) this._view = new ArchiveView(this, this.shell, this.storage);
        this._view.render();
    }
}
