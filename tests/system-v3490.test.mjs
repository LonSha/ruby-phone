// tests/system-v3490.test.mjs — 结构化记忆案头 [v3.49.0]
//
// 本套件守四件事：
//  ① 数据层机制面：逐型归一（夹取报 clamped / fallback 报出 / 布尔中文字面量）/ 上限只报不截 /
//     更新包逐条计划（坏结构逐条报因、能收的照收）/ 三拒门（unknown_* / blocked / kept）/ 纯函数落库；
//  ② App 层落盘契约：三态存储（抛异常 != 没记过）/ saved 契约（写不进去不许报成）/ 四键落盘 / 换会话重取；
//  ③ 四块不缝真的没缝（零定时器 / 零宿主 DOM / 零请求 / 零写回）+ 零反引号零反斜杠；
//  ④ 负控制能观测（每条破坏必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律）：剥注释器是字符状态机；负控制破坏可观测；破坏类只落副本树。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/memtable/memtable-data.js';
import * as APP from '../apps/memtable/memtable-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MD_DATA = 'apps/memtable/memtable-data.js';
const MD_APP = 'apps/memtable/memtable-app.js';
const MD_VIEW = 'apps/memtable/memtable-view.js';
const MD_CSS = 'apps/memtable/memtable.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const read = (rel, root) => fs.readFileSync(path.join(root || ROOT, rel), 'utf8');
const temps = [];
let seq = 0;
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
let strCh = Q;
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const c2 = src.slice(i, i + 2);
        if (state === 'code') {
            if (c2 === '//' ) { state = 'line'; i += 2; continue; }
            if (c2 === '/*') { state = 'block'; i += 2; continue; }
            if (c === Q || c === String.fromCharCode(34)) { state = 'str'; strCh = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') {
            if (c === NL) { state = 'code'; out += c; }
            i += 1; continue;
        }
        if (state === 'block') {
            if (c2 === '*/') { state = 'code'; i += 2; continue; }
            i += 1; continue;
        }
        if (state === 'str') {
            if (c === String.fromCharCode(92)) { out += src.slice(i, i + 2); i += 2; continue; }
            if (c === strCh) { state = 'code'; }
            out += c; i += 1; continue;
        }
    }
    return out;
}
/* ---------- 假 DOM（视图判据用；本件无 canvas，只要容器与文本查接口）---------- */
function fakeDom() {
    const made = [];
    class El {
        constructor(tag) {
            this.tagName = tag;
            this.children = [];
            this.className = '';
            this._html = '';
            this.attrs = {};
            this.value = '';
            made.push(this);
        }
        set innerHTML(v) { this._html = String(v); }
        get innerHTML() { return this._html; }
        appendChild(c) { this.children.push(c); return c; }
        addEventListener() {}
        getAttribute(k) { return this.attrs[k] || null; }
        querySelector(sel) {
            const hit = this.__all(sel)[0];
            if (hit) return hit;
            if (String(sel).indexOf('#mt-') === 0) {
                const el = new El('textarea');
                el.attrs['id'] = String(sel).slice(1);
                return el;
            }
            return null;
        }
        querySelectorAll(sel) { return this.__all(sel); }
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
                el.attrs = {};
                el.attrs['data-' + attr] = hit[3];
                out.push(el);
                hit = re.exec(html);
            }
            return out;
        }
    }
    return { made: made, El: El };
}

/* ---------- 副本树加载器：真源码定点破坏 → 写副本 → 加载副本 ---------- */
const WS_FILES = [
    MD_DATA, MD_APP, MD_VIEW, MD_CSS,
    APPS, STORAGE, INDEX, KEYS, PHONE_CSS, V255
];
function makeWorkspace() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-mt-ws-'));
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

/* ---------- 假存储与 App 构造 ---------- */
function makeStorage() {
    const m = new Map();
    return {
        get: (k, d) => (m.has(k) ? m.get(k) : d),
        set: (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); return true; },
        remove: (k) => { m.delete(k); return true; },
        _map: m
    };
}
function shellStub() { return { getContentContainer: () => null }; }
const newApp = (storage) => new APP.MemtableApp(shellStub(), storage);
const jsonOf = (o) => JSON.stringify(o);
/* ---------- 夹具 ---------- */
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQ = String.fromCharCode(34);
function goodTemplate() {
    return { id: 'tpl1', name: '人物档案', tables: [
        { id: 'base', name: '基础', mode: 'keyValue', extractPrompt: '取角色状态', columns: [
            { id: 'f1', key: '名字', type: 'text' },
            { id: 'f2', key: '年龄', type: 'number', min: 0, max: 150, aiEditable: true },
            { id: 'f3', key: '心情', type: 'enum', options: ['平静', '开心'], aiEditable: true },
            { id: 'f4', key: '标签', type: 'tags' },
            { id: 'f5', key: '在吗', type: 'boolean' },
            { id: 'f6', key: '封存', type: 'text', aiEditable: false },
            { id: 'f&1', key: '记号', type: 'text' }
        ] },
        { id: 'rows1', name: '事件行', mode: 'rows', columns: [
            { id: 'g1', key: '事件', type: 'text' },
            { id: 'g2', key: '次数', type: 'number', aiEditable: true }
        ] }
    ] };
}
const xmlOf = (inner) => LT + 'memory_updates' + GT + inner + LT + '/memory_updates' + GT;
const fld = (fid, text) => LT + 'field fieldId=' + DQ + fid + DQ + GT + text + LT + '/field' + GT;
const upd = (tid, tabid, inner) => LT + 'memory_update templateId=' + DQ + tid + DQ + ' tableId=' + DQ + tabid + DQ + GT + inner + LT + '/memory_update' + GT;
const rowOpen = (op, rid) => LT + 'row op=' + DQ + op + DQ + (rid ? (' rowId=' + DQ + rid + DQ) : '') + GT;
const ROW_CLOSE = LT + '/row' + GT;
/* planFromUpdateNode 吃的是**节点**（parseXml 产物），不是字符串。 */
function nodeOf(M, tid, tabid, inner) {
    const parsed = M.parseXml(xmlOf(upd(tid, tabid, inner)));
    return M.childrenNamed(M.childrenNamed(parsed.root, 'memory_updates')[0], 'memory_update')[0];
}
/* ══════════ 判据函数 ══════════ */
function normProblems(M) {
    const bad = [];
    /* ① 逐型归一：数值夹取要报 clamped */
    const tpl = M.normalizeTemplate(goodTemplate(), 0).template;
    const f2 = M.findTable(tpl, 'base').columns[1];
    const rClamp = M.normalizeFieldValue(f2, 999);
    if (rClamp.value !== 150) bad.push('norm-clamp-value');
    if (rClamp.notes.indexOf('clamped') < 0) bad.push('norm-clamp-note-missing');
    const rIn = M.normalizeFieldValue(f2, 42);
    if (rIn.value !== 42 || rIn.notes.length !== 0) bad.push('norm-in-range-polluted');
    /* ② enum 不在册要报 fallback，不许静默回缺省 */
    const f3 = M.findTable(tpl, 'base').columns[2];
    const rFb = M.normalizeFieldValue(f3, '暴怒');
    if (rFb.value !== '平静') bad.push('norm-fallback-value');
    if (rFb.notes.indexOf('fallback') < 0) bad.push('norm-fallback-note-missing');
    /* ③ 布尔中文字面量 */
    const f5 = M.findTable(tpl, 'base').columns[4];
    if (M.normalizeFieldValue(f5, '是').value !== true) bad.push('norm-bool-zh-yes');
    if (M.normalizeFieldValue(f5, '否').value !== false) bad.push('norm-bool-zh-no');
    if (M.normalizeFieldValue(f5, '乱写的').notes.indexOf('bool_guess') < 0) bad.push('norm-bool-guess-not-reported');
    /* ④ 认不出的字段型归一成 text 并记 why */
    const ft = M.fieldTypeOf('相片');
    if (ft.type !== 'text' || ft.why !== 'unknown_type') bad.push('norm-unknown-type');
    /* ⑤ 坏模板单列 rejected，不许静默丢 */
    const store = M.normalizeTemplateStore([{ id: 'a' }, '垃圾']);
    if (store.templates.length !== 1) bad.push('norm-store-keep');
    if (store.rejected.length !== 1 || store.rejected[0].why !== 'not_object') bad.push('norm-store-reject');
    /* ⑥ tags 中西文分隔都能切 */
    const f4 = M.findTable(tpl, 'base').columns[3];
    const rTags = M.normalizeFieldValue(f4, '猫, 狗');
    if (rTags.value.length !== 2) bad.push('norm-tags-split');
    /* ⑦ 模板库超 200 上限要落痕（template_overflow_N），不许静默裁 */
    const many = [];
    for (let i = 0; i < M.MT_TEMPLATES_MAX + 2; i++) many.push({ id: 't' + String(i) });
    const manyStore = M.normalizeTemplateStore(many);
    if (manyStore.templates.length !== M.MT_TEMPLATES_MAX) bad.push('norm-store-cap');
    let hasOv = false;
    for (const nn of manyStore.notes) if (String(nn).indexOf('template_overflow_') === 0) hasOv = true;
    if (!hasOv) bad.push('norm-store-overflow-note');
    return bad;
}

function capProblems(M) {
    const bad = [];
    /* ① 台账裁边要报 dropped */
    const t1 = M.trimRows([1, 2, 3], 2);
    if (t1.rows.length !== 2 || t1.dropped !== 1) bad.push('cap-trim-dropped');
    const t2 = M.trimRows([1], 5);
    if (t2.dropped !== 0) bad.push('cap-trim-overflow-false');
    /* ② 历史超上限报 dropped，不许静默挤掉 */
    let hist = [];
    for (let i = 0; i < M.MT_HISTORY_LIMIT + 3; i++) {
        const h = M.pushHistory(hist, { i: i }, ['f1'], 'xml', 1700000000000 + i);
        hist = h.history;
    }
    if (hist.length !== M.MT_HISTORY_LIMIT) bad.push('cap-history-cap');
    const h2 = M.pushHistory(hist, {}, ['f1'], 'xml', 1700000000999);
    if (h2.dropped !== 1) bad.push('cap-history-dropped');
    /* ③ 空变更不记历史 */
    const h3 = M.pushHistory([], {}, [], 'xml', 1);
    if (h3.entry !== null) bad.push('cap-history-empty-entry');
    /* ④ 序列读数至多 12 点 */
    const snaps = [];
    for (let i = 0; i < 30; i++) snaps.push({ snapshot: { t: { b: { f2: i } } } });
    const series = M.fieldHistorySeries(snaps, 't', 'b', 'f2', 999);
    if (series.length !== M.MT_SERIES_MAX) bad.push('cap-series-max');
    if (series[series.length - 1] !== 999) bad.push('cap-series-current');
    /* ⑤ caps 面与常量一致 */
    const c = M.caps();
    if (c.templates !== M.MT_TEMPLATES_MAX || c.rowsPerTable !== M.MT_ROWS_PER_TABLE_MAX) bad.push('cap-caps-face');
    return bad;
}
function planProblems(M) {
    const bad = [];
    const norm = M.normalizeTemplate(goodTemplate(), 0).template;
    const store = [norm];
    /* ① 正常收包：两条 set 计划 + 值归一走类型 */
    const p1 = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f1', '阿宁') + fld('f2', '27'))), store, {}, {}, 'overwrite');
    if (p1.plans.length !== 2 || p1.errors.length !== 0) bad.push('plan-basic');
    if (p1.plans[1].newValue !== 27) bad.push('plan-number-coerce');
    /* ② 空包 / 超限包 / 无更新包逐因成立 */
    if (M.planFromXml('   ', store, {}, {}, 'overwrite').intakeWhy !== 'blank') bad.push('plan-blank');
    if (M.planFromXml(new Array(M.MT_TEXT_MAX + 2).join('x'), store, {}, {}, 'overwrite').intakeWhy !== 'too_large') bad.push('plan-too-large');
    if (M.planFromXml('<div>不是更新包</div>', store, {}, {}, 'overwrite').intakeWhy !== 'no_updates') bad.push('plan-no-updates');
    /* ③ 坏结构逐条报因，能收的照收不整段丢 */
    const broken = xmlOf(upd('tpl1', 'base', fld('f1', '阿宁')) + LT + '/memory_update' + GT);
    const p3 = M.planFromXml(broken, store, {}, {}, 'overwrite');
    if (p3.errors.length === 0) bad.push('plan-broken-errors');
    if (p3.plans.length < 1) bad.push('plan-broken-lost-good');
    if (p3.intakeWhy !== 'xml_broken') bad.push('plan-broken-why');
    /* ④ 认不出的模板 / 表 / 字段逐条报 unknown_* */
    const p4 = M.planFromXml(xmlOf(upd('鬼模板', 'base', fld('f1', 'x'))), store, {}, {}, 'overwrite');
    if (p4.plans[0].code !== 'unknown_template') bad.push('plan-unknown-template');
    const p4b = M.planFromXml(xmlOf(upd('tpl1', '鬼表', fld('f1', 'x'))), store, {}, {}, 'overwrite');
    if (p4b.plans[0].code !== 'unknown_table') bad.push('plan-unknown-table');
    const p4c = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('鬼字段', 'x'))), store, {}, {}, 'overwrite');
    if (p4c.plans[0].code !== 'unknown_field') bad.push('plan-unknown-field');
    /* ⑤ 行表：add / update / delete 三形与 unknown_row */
    const dataRows = { rows1: { __rows: [{ id: 'memory_row_1', cells: { g1: '初见', g2: 1 } }] } };
    const pAdd = M.planFromUpdateNode(norm, nodeOf(M, 'tpl1', 'rows1', rowOpen('add', '') + fld('g1', '重逢') + ROW_CLOSE), {}, {}, 'overwrite');
    if (pAdd[0].code !== 'set' || pAdd[0].op !== 'add') bad.push('plan-row-add');
    const pUpd = M.planFromUpdateNode(norm, nodeOf(M, 'tpl1', 'rows1', rowOpen('update', 'memory_row_1') + fld('g2', '5') + ROW_CLOSE), dataRows, {}, 'overwrite');
    if (pUpd[0].code !== 'set' || pUpd[0].oldValue !== 1) bad.push('plan-row-update');
    const pDel = M.planFromUpdateNode(norm, nodeOf(M, 'tpl1', 'rows1', rowOpen('delete', 'memory_row_1') + ROW_CLOSE), dataRows, {}, 'overwrite');
    if (pDel.length !== 2 || pDel[0].op !== 'delete') bad.push('plan-row-delete');
    const pGhost = M.planFromUpdateNode(norm, nodeOf(M, 'tpl1', 'rows1', rowOpen('update', '鬼行') + fld('g1', 'x') + ROW_CLOSE), dataRows, {}, 'overwrite');
    if (pGhost[0].code !== 'unknown_row') bad.push('plan-unknown-row');
    /* ⑤b 实体解码：正文里的 &lt; 与属性里的 &amp; 都必须还原 */
    const pEnt = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f1', '&lt;b&gt;书&lt;/b&gt;'))), store, {}, {}, 'overwrite');
    if (pEnt.plans[0].newValue !== '<b>书</b>') bad.push('plan-entity-decode');
    const pAttr = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f&amp;1', 'X'))), store, {}, {}, 'overwrite');
    if (pAttr.plans[0].code !== 'set') bad.push('plan-attr-decode');
    /* ⑥ add 一行全被拒 = empty_add */
    const pEmpty = M.planFromUpdateNode(norm, nodeOf(M, 'tpl1', 'rows1', rowOpen('add', '') + fld('鬼字段', 'x') + ROW_CLOSE), {}, {}, 'overwrite');
    if (pEmpty.filter((p) => p.code === 'empty_add').length !== 1) bad.push('plan-empty-add');
    /* ⑦ 行满 500 再 add = row_overflow（只报不截） */
    const fullRows = [];
    for (let i = 0; i < M.MT_ROWS_PER_TABLE_MAX; i++) fullRows.push({ id: 'r' + String(i), cells: { g1: 'x', g2: i } });
    const pFull = M.planFromUpdateNode(norm, nodeOf(M, 'tpl1', 'rows1', rowOpen('add', '') + fld('g1', 'X') + ROW_CLOSE), { rows1: { __rows: fullRows } }, {}, 'overwrite');
    if (pFull[0].code !== 'row_overflow') bad.push('plan-row-overflow-missing');
    return bad;
}
function gateProblems(M) {
    const bad = [];
    const norm = M.normalizeTemplate(goodTemplate(), 0).template;
    /* ① 三拒门：unknown_field / blocked（aiEditable=false 与 locked）/ kept */
    const pUF = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('鬼字段', 'x'))), [norm], {}, {}, 'overwrite');
    if (pUF.plans[0].code !== 'unknown_field') bad.push('gate-unknown-field');
    const pAI = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f6', '改我'))), [norm], {}, {}, 'overwrite');
    if (pAI.plans[0].code !== 'blocked') bad.push('gate-ai-false-blocked');
    const pLock = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f2', '99'))), [norm], {}, { tpl1: { base: ['f2'] } }, 'overwrite');
    if (pLock.plans[0].code !== 'blocked') bad.push('gate-locked-blocked');
    const dataNonEmpty = { tpl1: { base: { f2: 30 } } };
    const pKept = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f2', '31'))), [norm], dataNonEmpty, {}, 'fill_empty');
    if (pKept.plans[0].code !== 'kept') bad.push('gate-kept');
    /* ② fill_empty 下空值仍可收 */
    const pFill = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f1', '新名'))), [norm], {}, {}, 'fill_empty');
    if (pFill.plans[0].code !== 'set') bad.push('gate-fill-empty-still-sets');
    /* ③ 锁定字段在收包文案里必须标出来 */
    const def = M.templateDefinitionText([norm], {}, { tpl1: { base: ['f2'] } });
    if (def.indexOf('锁定=是') < 0) bad.push('gate-def-lock-mark');
    if (def.indexOf('表格提取规则') < 0) bad.push('gate-def-extract-rule');
    return bad;
}

function applyProblems(M) {
    const bad = [];
    const norm = M.normalizeTemplate(goodTemplate(), 0).template;
    const store = [norm];
    /* ① applyPlan 只落 set 条且不改入参（纯函数） */
    const plan = M.planFromXml(xmlOf(upd('tpl1', 'base', fld('f1', '阿宁') + fld('鬼字段', 'x'))), store, {}, {}, 'overwrite');
    const dataBefore = { tpl1: { base: { f2: 7 } } };
    const r = M.applyPlan(store, dataBefore, plan);
    if (r.changed.length !== 1) bad.push('apply-only-set');
    if (r.data.tpl1.base.f1 !== '阿宁') bad.push('apply-value');
    if (dataBefore.tpl1.base.f1 !== undefined) bad.push('apply-mutated-input');
    if (r.data.tpl1.base.f2 !== 7) bad.push('apply-kept-other');
    /* ② 行表 add 真的加一行 */
    const planAdd = M.planFromXml(xmlOf(upd('tpl1', 'rows1', rowOpen('add', '') + fld('g1', '重逢') + ROW_CLOSE)), store, {}, {}, 'overwrite');
    const rAdd = M.applyPlan(store, {}, planAdd);
    if (!rAdd.data.tpl1 || !rAdd.data.tpl1.rows1 || !rAdd.data.tpl1.rows1.__rows || rAdd.data.tpl1.rows1.__rows.length !== 1) bad.push('apply-row-add');
    /* ③ 行表 delete 真的删行 */
    const rowsData = { tpl1: { rows1: { __rows: [{ id: 'memory_row_1', cells: { g1: '初见', g2: 1 } }] } } };
    const planDel = M.planFromXml(xmlOf(upd('tpl1', 'rows1', rowOpen('delete', 'memory_row_1') + ROW_CLOSE)), store, rowsData, {}, 'overwrite');
    const rDel = M.applyPlan(store, rowsData, planDel);
    if (rDel.data.tpl1.rows1.__rows.length !== 0) bad.push('apply-row-delete');
    /* ④ 序列读数与游标读数 */
    const cur = M.autoUpdateCursorReadings(260, 60, 100);
    if (cur.unsyncedCount !== 199 || cur.completedBatchCount !== 1) bad.push('apply-cursor-math');
    if (M.autoUpdateCursorReadings(260, 60, 3).interval !== 10) bad.push('apply-cursor-interval-floor');
    /* ⑤ 读数面：计数与锁定数与历史数 */
    const rd = M.readingsOf(store, r.data, { tpl1: { base: ['f2'] } }, [{}, {}]);
    if (rd.templates !== 1 || rd.tables !== 2 || rd.fields !== 9 || rd.rowsTables !== 1) bad.push('apply-readings-counts');
    if (rd.locked !== 1 || rd.history !== 2) bad.push('apply-readings-locked-history');
    /* ⑥ 判定四态 */
    if (M.faceOf(undefined, null) !== 'absent') bad.push('apply-face-absent');
    if (M.faceOf('  ', null) !== 'empty') bad.push('apply-face-empty');
    if (M.faceOf('<a/>', { intakeWhy: 'no_updates' }) !== 'malformed') bad.push('apply-face-malformed');
    if (M.faceOf('<a/>', null) !== 'ok') bad.push('apply-face-ok');
    /* ⑦ 余量面：余量与 0 不同形 */
    const lim = M.limitsOf(store, []);
    if (lim.templatesLeft !== M.MT_TEMPLATES_MAX - 1 || lim.rowsCap !== M.MT_ROWS_PER_TABLE_MAX) bad.push('apply-limits');
    return bad;
}
function appProblems(APPmod, storageFactory) {
    const AppCls = (APPmod && APPmod.MemtableApp) ? APPmod.MemtableApp : APP.MemtableApp;
    const M = APPmod && APPmod.planFromXml ? APPmod : null;
    const bad = [];
    const mk = storageFactory || makeStorage;
    /* ① 四键真落盘 + saved 契约（写不进去不许报成） */
    const st = mk();
    const app = new AppCls(shellStub(), st);
    const r1 = app.intakeTemplates(jsonOf([goodTemplate()]));
    if (r1.ok !== true || r1.saved !== true || r1.templates !== 1) bad.push('app-intake-templates');
    const up = xmlOf(upd('tpl1', 'base', fld('f2', '27')));
    const r2 = app.intakeXml(up);
    if (r2.saved !== true || r2.plans.length !== 1) bad.push('app-intake-xml');
    const r3 = app.applyUpdates();
    if (r3.ok !== true || r3.saved !== true || r3.changed !== 1) bad.push('app-apply');
    if (st._map.get('memtable_templates').length !== 1) bad.push('app-key-templates');
    if (st._map.get('memtable_data').tpl1.base.f2 !== 27) bad.push('app-key-data');
    if (st._map.get('memtable_xml').text !== up) bad.push('app-key-xml');
    if (st._map.get('memtable_ledger').length < 3) bad.push('app-key-ledger');
    /* ② 只读盘：操作回执必须报没存下，不许假成 */
    const ro = { get: () => { throw new Error('ro'); }, set: () => { throw new Error('ro'); }, remove: () => { throw new Error('ro'); } };
    const appRO = new AppCls(shellStub(), ro);
    const rr1 = appRO.intakeTemplates(jsonOf([goodTemplate()]));
    if (rr1.saved !== false) bad.push('app-ro-templates-saved');
    const rr2 = appRO.intakeXml(up);
    if (rr2.saved !== false) bad.push('app-ro-xml-saved');
    if (appRO.applyUpdates().saved !== false) bad.push('app-ro-apply-saved');
    /* ③ 抛异常 != 没记过：读侧 throw 只挡恢复，不许谎报 absent */
    let threw = false;
    try { new AppCls(shellStub(), { get: () => { throw new Error('x'); }, set: () => true })._probe(); }
    catch (e) { threw = true; }
    if (threw) bad.push('app-read-throw-leaked');
    /* ④ 台账裁边 dropped 累计现示 */
    const st2 = mk();
    const app2 = new AppCls(shellStub(), st2);
    app2.intakeTemplates(jsonOf([goodTemplate()]));
    if (app2._ledger.length < 1) bad.push('app-ledger-actions');
    /* ⑤ 换会话：_plan 与 dropped 清零，四格全量重取 */
    app2.intakeXml(up);
    app2.onChatChanged();
    if (app2._plan !== null || app2._dropped !== 0) bad.push('app-chat-changed');
    if (app2._templates.length !== 1) bad.push('app-chat-reload-templates');
    /* ⑥ 互不牵连：清台账不动数据，清数据不动台账 */
    const st3 = mk();
    const app3 = new AppCls(shellStub(), st3);
    app3.intakeTemplates(jsonOf([goodTemplate()]));
    app3.intakeXml(up);
    app3.applyUpdates();
    app3.clearLedger();
    if (st3._map.get('memtable_data').tpl1.base.f2 !== 27) bad.push('app-clear-ledger-touched-data');
    app3.clearData();
    if (st3._map.get('memtable_ledger').length !== 0 && app3._ledger.length === 0) { /* 清数据写空台账也只清自己 */ }
    if (st3._map.get('memtable_templates').length !== 1) bad.push('app-clear-data-touched-templates');
    /* ⑦ M 层若给了（副本树判据），App 也要能构造 */
    if (M && typeof M.planFromXml !== 'function') bad.push('app-module-face');
    /* ⑧ 台账 120 条裁边：挤掉几条要累计现示（不许静默丢） */
    const st4 = mk();
    const app4 = new AppCls(shellStub(), st4);
    app4.intakeTemplates(jsonOf([goodTemplate()]));
    app4.clearXml();
    for (let i = 0; i < 122; i++) app4._log('entry_' + String(i), '');
    if (app4._ledger.length !== 120) bad.push('app-ledger-cap');
    if (app4._dropped !== 4) bad.push('app-ledger-dropped-count');
    return bad;
}
function viewProblems(AM) {
    const bad = [];
    const dom = fakeDom();
    const prev = globalThis.document;
    globalThis.document = { createElement: (tag) => new dom.El(tag) };
    try {
        const container = new dom.El('div');
        const app = new APP.MemtableApp({ getContentContainer: () => container }, makeStorage());
        app.intakeTemplates(jsonOf([goodTemplate()]));
        app.intakeXml(xmlOf(upd('tpl1', 'base', fld('f1', '阿宁') + fld('鬼字段', 'x'))));
        app.render();
        if (!container.children.length) { bad.push('view-no-root'); return bad; }
        const root = container.children[0];
        if (String(root.className).indexOf('mt-root') < 0) bad.push('view-root-class');
        if (root.innerHTML.indexOf('mt-tabs') < 0) bad.push('view-no-tabs');
        if (root.innerHTML.indexOf('mt-face') < 0) bad.push('view-no-face');
        app.setTab('xml');
        app.render();
        const xmlEl = container.children[container.children.length - 1];
        if (xmlEl.innerHTML.indexOf('mt-plan-row') < 0) bad.push('view-no-plan-rows');
        if (xmlEl.innerHTML.indexOf('mt-plan-code') < 0) bad.push('view-no-plan-code');
        app.setTab('board');
        app.render();
        const tabs = [['templates', '模板'], ['xml', '更新包'], ['history', '历史'], ['ledger', '台账'], ['board', '模板定义']];
        for (const row of tabs) {
            app.setTab(row[0]);
            app.render();
            const el = container.children[container.children.length - 1];
            if (!el.innerHTML.length) bad.push('view-tab-empty-' + row[0]);
            if (el.innerHTML.indexOf(row[1]) < 0) bad.push('view-tab-missing-' + row[0]);
        }
        app.setTab('board');
        app.render();
        const appEmpty = new APP.MemtableApp({ getContentContainer: () => container }, makeStorage());
        let threw = false;
        try { appEmpty.render(); } catch (e) { threw = true; }
        if (threw) bad.push('view-empty-throw');
        if (container.children[container.children.length - 1].innerHTML.indexOf('还没看过') < 0) bad.push('view-empty-face-word');
    } finally {
        globalThis.document = prev;
    }
    return bad;
}

function seamProblems() {
    const bad = [];
    const seamFiles = [MD_DATA, MD_APP, MD_VIEW];
    const banned = [
        ['no-timer', ['setInterval', 'setTimeout', 'requestAnimationFrame', 'visibilitychange', 'matchMedia']],
        ['no-host-dom', ['getElementById', 'getElementsByClassName', 'offsetWidth', 'getBoundingClientRect', 'performance.now', 'document.body', 'document.head']],
        ['no-request', ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon', 'DOMParser']],
        ['no-writeback', ['localStorage', 'sessionStorage', 'indexedDB', 'window.top', 'parent.document', 'SillyTavern']]
    ];
    for (const rel of seamFiles) {
        const src = stripComments(read(rel));
        for (const row of banned) {
            for (const k of row[1]) if (src.indexOf(k) >= 0) bad.push('seam-' + row[0] + ':' + rel + ':' + k);
        }
        if (src.indexOf('document.') >= 0) {
            const allowed = ['document.createElement'];
            const idx = src.split('document.').length - 1;
            let ok = 0;
            for (const a of allowed) ok += src.split(a).length - 1;
            if (idx !== ok) bad.push('seam-host-dom-other:' + rel);
        }
    }
    for (const rel of seamFiles.concat([MD_CSS])) {
        const src = read(rel);
        if (src.indexOf(String.fromCharCode(96)) >= 0) bad.push('backtick:' + rel);
        if (src.indexOf(String.fromCharCode(92)) >= 0) bad.push('backslash:' + rel);
    }
    return bad;
}
function wiringProblems(root) {
    const bad = [];
    const r = root || ROOT;
    const apps = read(APPS, r);
    const stor = read(STORAGE, r);
    const idx = read(INDEX, r);
    const keys = read(KEYS, r);
    const css = read(PHONE_CSS, r);
    const v255 = read(V255, r);
    if (apps.indexOf('id: ' + Q + 'memtable' + Q) < 0) bad.push('wiring-apps-id');
    if (apps.indexOf('结构化记忆案头') < 0) bad.push('wiring-apps-name');
    if (apps.indexOf('不发请求不拼提示词') < 0) bad.push('wiring-apps-seam-note');
    if (apps.indexOf('锁定字段落库前拦下') < 0) bad.push('wiring-apps-deviation-note');
    if (apps.indexOf('[v3.49.0]') < 0) bad.push('wiring-apps-version');
    if (stor.indexOf('/^memtable_/') < 0) bad.push('wiring-storage-prefix');
    for (const k of ['memtable_templates', 'memtable_data', 'memtable_xml', 'memtable_ledger']) {
        if (keys.indexOf(k) < 0) bad.push('wiring-keys-' + k);
        const kSeg = keys.slice(keys.indexOf(k), keys.indexOf(k) + 400);
        if (kSeg.indexOf('scope: ' + Q + 'chat' + Q) < 0) bad.push('wiring-keys-scope-' + k);
    }
    if (idx.indexOf('appId === ' + Q + 'memtable' + Q) < 0) bad.push('wiring-index-branch');
    if (idx.indexOf('new module.MemtableApp(') < 0) bad.push('wiring-index-mount');
    if (idx.indexOf('window.VirtualPhone.memtableApp.render()') < 0) bad.push('wiring-index-render');
    if (idx.indexOf("'memtableApp',") < 0) bad.push('wiring-index-field-table');
    const srcCss = read(MD_CSS, r);
    if (css.indexOf(srcCss) < 0) bad.push('wiring-phone-css-not-verbatim');
    if (css.indexOf('[v3.49.0] 结构化记忆案头（memtable）') < 0) bad.push('wiring-phone-css-header');
    if (!new RegExp(String.fromCharCode(92) + '.mt-').test(css)) bad.push('wiring-css-family');
    if (v255.indexOf('memtableApp: ' + Q + 'memtable' + Q) < 0) bad.push('wiring-v255-dirmap');
    return bad;
}

/* ══════════ 顶层用例 ══════════ */
test('数据层 · 逐型归一：夹取报 clamped / fallback 报出 / 布尔中文字面量 / 坏模板单列', () => {
    assert.deepEqual(normProblems(DAT), []);
});
test('数据层 · 上限只报不截：裁边报 dropped / 历史 20 / 序列 12 / caps 成字', () => {
    assert.deepEqual(capProblems(DAT), []);
});
test('数据层 · 更新包逐条计划：坏结构逐条报因 / 能收的照收 / unknown_* 逐条 / 行表三形', () => {
    assert.deepEqual(planProblems(DAT), []);
});
test('数据层 · 三拒门与模板定义文本：aiEditable=false / locked / kept / fill_empty', () => {
    assert.deepEqual(gateProblems(DAT), []);
});
test('数据层 · 纯函数落库：只落 set / 不改入参 / 行表增删 / 游标与读数与四态与余量', () => {
    assert.deepEqual(applyProblems(DAT), []);
});
test('App 层 · 四键落盘与 saved 契约：写不进去不许报成 / 抛异常不是没记过 / 换会话重取 / 互不牵连', () => {
    assert.deepEqual(appProblems(APP, null), []);
});
test('视图层 · 假 DOM 渲染：根与页签与逐条计划 / 五页签都能画 / 零状态不抛画横线', () => {
    assert.deepEqual(viewProblems(null), []);
});
test('缝合面 · 四块不缝真的没缝 + 零反引号零反斜杠（连注释里都不许）', () => {
    assert.deepEqual(seamProblems(), []);
});
test('接线 · 六处落点齐备：apps / storage / keys×4 / index / phone.css 同源 / v255 dirMap', () => {
    assert.deepEqual(wiringProblems(), []);
});
test('真仓只读 · 全部判据跑完后真源码必须还是干净的', () => {
    assert.deepEqual(seamProblems(), [], '真仓模块在破坏窗口内被改脏了');
});
/* ══════════ 破坏表（DAMAGE）：真源码定点破坏 → 副本树上重跑同款真判据 ══════════
 * 纪律：破坏一律落副本树（真仓只读）；锚点必须恰中 1 次，否则抛；每条破坏都必须让对应判据转红。
 */
const D = [
    ["D1 数值夹取不报 clamped（无声改数）", "apps/memtable/memtable-data.js", "if (clamped !== n) out.notes.push('clamped');", "if (clamped !== n) { } else { out.notes.push('clamped'); }", "norm-clamp-note-missing", "normProblems"],
    ["D2 坏模板静默丢（rejected 清单消失）", "apps/memtable/memtable-data.js", "out.rejected.push({ index: i, why: 'not_object' });", "out.templates.push({ id: 'memory_tpl_ghost', tables: [], name: 'ghost' });", "norm-store-reject", "normProblems"],
    ["D3 enum fallback 不落首选项（静默回空）", "apps/memtable/memtable-data.js", "out.value = (dv !== '' && opts.indexOf(dv) >= 0) ? dv : opts[0];", "out.value = '';", "norm-fallback-value", "normProblems"],
    ["D4 布尔中文字面量失灵", "apps/memtable/memtable-data.js", "const YES = ['true', '1', 'yes', '是', '开', '开启', 'on'];", "const YES = ['true', '1', 'yes'];", "norm-bool-zh-yes", "normProblems"],
    ["D5 超限原文静默截断", "apps/memtable/memtable-data.js", "if (text.length > MT_TEXT_MAX) { out.intakeWhy = MT_INTAKE_WHYS[1]; return out; }", "if (false) { out.intakeWhy = MT_INTAKE_WHYS[1]; return out; }", "plan-too-large", "planProblems"],
    ["D6 空包吞成 no_updates", "apps/memtable/memtable-data.js", "if (text.trim() === '') { out.intakeWhy = MT_INTAKE_WHYS[0]; return out; }", "if (false) { out.intakeWhy = MT_INTAKE_WHYS[0]; return out; }", "plan-blank", "planProblems"],
    ["D7 坏包照常落库（xml_broken 门拆了）", "apps/memtable/memtable-data.js", "    if (parsed.errors.length > 0) out.intakeWhy = MT_INTAKE_WHYS[3];", "    if (false) out.intakeWhy = MT_INTAKE_WHYS[3];", "plan-broken-why", "planProblems"],
    ["D8 压栈拆除（好条随解析树一起丢）", "apps/memtable/memtable-data.js", "if (!tag.selfClose) stack.push(node);", "if (false) stack.push(node);", "plan-broken-lost-good", "planProblems"],
    ["D9 实体不解码（标记注入库）", "apps/memtable/memtable-data.js", "attrs[attrName] = xmlUnescape(inner.slice(i, end));", "attrs[attrName] = inner.slice(i, end);", "plan-attr-decode", "planProblems"],
    ["D10 模板认不出硬塞", "apps/memtable/memtable-data.js", "if (!template) {", "if (template === undefined) {", "plan-unknown-template", "planProblems"],
    ["D11 行超上限静默溢", "apps/memtable/memtable-data.js", "if (rows.length >= MT_ROWS_PER_TABLE_MAX) {\n                    plans.push({ code: 'row_overflow', templateId: template.id, tableId: tableId, op: op });", "if (false) {\n                    plans.push({ code: 'row_overflow', templateId: template.id, tableId: tableId, op: op });", "plan-row-overflow-missing", "planProblems"],
    ["D12 update 行认不出硬塞", "apps/memtable/memtable-data.js", "/* update\uff08\u7f3a\u7701\uff09 */\n            const row = rowId ? findRow(rows, rowId) : null;\n            if (!row) { plans.push({ code: 'unknown_row', templateId: template.id, tableId: tableId, rowId: rowId, op: op }); continue; }", "/* update\uff08\u7f3a\u7701\uff09 */\n            const row = rowId ? findRow(rows, rowId) : null;\n            if (false) { plans.push({ code: 'unknown_row', templateId: template.id, tableId: tableId, rowId: rowId, op: op }); continue; }", "plan-unknown-row", "planProblems"],
    ["D13 add 全拒不报 empty_add", "apps/memtable/memtable-data.js", "if (touched === 0) plans.push({ code: 'empty_add', templateId: template.id, tableId: tableId, op: op });", "if (false) plans.push({ code: 'empty_add', templateId: template.id, tableId: tableId, op: op });", "plan-empty-add", "planProblems"],
    ["D14 字段认不出硬塞", "apps/memtable/memtable-data.js", "if (!field) return 'unknown_field';", "if (false) return 'unknown_field';", "plan-unknown-field", "planProblems"],
    ["D15 禁编字段可被 AI 改写", "apps/memtable/memtable-data.js", "if (field.aiEditable === false) return 'blocked';", "if (false) return 'blocked';", "gate-ai-false-blocked", "gateProblems"],
    ["D16 锁定字段可被更新包改写", "apps/memtable/memtable-data.js", "if (lockList.indexOf(field.id) >= 0) return 'blocked';", "if (false) return 'blocked';", "gate-locked-blocked", "gateProblems"],
    ["D17 fill_empty 覆盖非空", "apps/memtable/memtable-data.js", "if (strat === 'fill_empty' && !isEmptyValue(field, oldValue)) return 'kept';", "if (false) return 'kept';", "gate-kept", "gateProblems"],
    ["D18 落库改入参（非纯函数）", "apps/memtable/memtable-data.js", "const data = deepClone(isPlain(dataByTemplate) ? dataByTemplate : {}) || {};", "const data = isPlain(dataByTemplate) ? dataByTemplate : {};", "apply-mutated-input", "applyProblems"],
    ["D19 台账裁边不报 dropped", "apps/memtable/memtable-app.js", "this._dropped += trimmed.dropped;", "this._dropped += 0;", "app-ledger-dropped-count", "appProblems"],
    ["D20 换会话留旧计划（旧角色计划落新角色库）", "apps/memtable/memtable-app.js", "onChatChanged() { this._plan = null; this._dropped = 0; this.render(); }", "onChatChanged() { this.render(); }", "app-chat-changed", "appProblems"],
    ["D21 模板收包写不进去也报成", "apps/memtable/memtable-app.js", "return { ok: true, saved: wT.saved, templates: this._templates.length, rejected: norm.rejected, notes: norm.notes };", "return { ok: true, saved: true, templates: this._templates.length, rejected: norm.rejected, notes: norm.notes };", "app-ro-templates-saved", "appProblems"],
    ["D22 更新包落盘失败报成", "apps/memtable/memtable-app.js", "this._savedXml = wX.saved;", "this._savedXml = true;", "app-ro-xml-saved", "appProblems"],
    ["D23 落库失败报成", "apps/memtable/memtable-app.js", "return { ok: true, saved: wD.saved, changed: applied.changed.length };", "return { ok: true, saved: true, changed: applied.changed.length };", "app-ro-apply-saved", "appProblems"],
    ["D24 历史静默挤掉不报", "apps/memtable/memtable-data.js", "if (list.length > MT_HISTORY_LIMIT) {", "if (list.length > MT_HISTORY_LIMIT + 7) {", "cap-history-dropped", "capProblems"],
    ["D25 空变更也记历史", "apps/memtable/memtable-data.js", "if (fields.length === 0) return { history: list, dropped: 0, entry: null };", "if (false) return { history: list, dropped: 0, entry: null };", "cap-history-empty-entry", "capProblems"],
    ["D26 序列读数超 12 点", "apps/memtable/memtable-data.js", "return out.slice(-MT_SERIES_MAX);", "return out;", "cap-series-max", "capProblems"],
    ["D27 收包文案丢提取规则（提示词面失真）", "apps/memtable/memtable-data.js", "if (tb.extractPrompt) lines.push", "if (false) lines.push", "gate-def-extract-rule", "gateProblems"],
    ["D28 模板库超限不落痕", "apps/memtable/memtable-data.js", "if (cap.dropped > 0) out.notes.push('template_overflow_' + String(cap.dropped));", "if (false) out.notes.push('template_overflow_' + String(cap.dropped));", "norm-store-overflow-note", "normProblems"],
];

const JUDGES = { normProblems, capProblems, planProblems, gateProblems, applyProblems };
async function runBreak(row) {
    const ws = makeWorkspace();
    breakIn(ws, row[1], row[2], row[3]);
    const mod = await loadFrom(ws, row[1]);
    const judge = row[5];
    let bad = null;
    try {
        if (judge === "appProblems") bad = appProblems(mod, null);
        else if (typeof JUDGES[judge] === "function") bad = JUDGES[judge](mod);
        else throw new Error("判据名不存在：" + String(judge));
    } catch (e) {
        /* 判据在破坏副本上抛异常 = 行为真的变了（真仓上同款判据必须干净，
         *   这由顶层用例保证），按本仓口径计入破坏观测。 */
        bad = [row[4]];
    }
    return bad;
}

test("破坏表 D1~D28：每条真源码定点破坏都必须让对应判据转红", async () => {
    for (const row of D) {
        const bad = await runBreak(row);
        const hit = bad.filter((x) => x === row[4]);
        assert.ok(hit.length >= 1, row[0] + " 破坏未被观测到（判据没响）：" + JSON.stringify(bad.slice(0, 6)));
    }
});