// tests/system-v3470.test.mjs — 诊断案头 [v3.47.0]
//
// 本套件守四件事：
//  ① 存档的读法口径（版本读不出来不许读成 1 / 状态认不出不许当还没发生 /
//     增量状态与条数要互相成立 / 缺栏位不许读成 0 / 迁移逐版排 / 自订值不动 /
//     十一步逐格不硬塞 / 空与读不懂不同形 / 超限只报不截 / 台账挤掉要计数）；
//  ② 五块不缝真的没缝（零挂错误对象 / 零抠堆栈 / 零编原因 / 零就地改存档 / 零写宿主键）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · **裁定不等于动作**：本件不发请求、不改宿主、不就地改存档，判据也要守这一条。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as DAT from '../apps/diagdesk/diagdesk-data.js';
import * as APP from '../apps/diagdesk/diagdesk-app.js';
import { LAZY_ROUTE_TABLE_REL, readRepoTable, routeSurface, withRouteSurface } from './_lazy_routes.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DD_DATA = 'apps/diagdesk/diagdesk-data.js';
const DD_APP = 'apps/diagdesk/diagdesk-app.js';
const DD_VIEW = 'apps/diagdesk/diagdesk-view.js';
const DD_CSS = 'apps/diagdesk/diagdesk.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const BS = String.fromCharCode(92);
const DQ = String.fromCharCode(34);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
/** 副本树登记表（跑完必删）。★ 本套件对真仓**只读**：任何破坏类负控制只准落在副本上。 */
const temps = [];
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
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); return true; },
        _box: box,
    };
}
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => { const kk = chat + ':' + k; return box.has(kk) ? box.get(kk) : null; },
        set: (k, v) => { box.set(chat + ':' + k, v); },
        switchChat: (c) => { chat = c; },
        _box: box,
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
const newApp = (storage) => new APP.DiagdeskApp(shellStub(), storage);
const toApp = (mod, storage) => new mod.DiagdeskApp(shellStub(), storage);
const jsonOf = (o) => JSON.stringify(o);
function baseState(over) {
    const s = {
        version: 1,
        角色档案: { 生理读数: { 承载耐受: 1, 产后恢复天数: 30 }, 基础: { 阶段: '孕期' } },
        角色运行时: {}
    };
    const o = over || {};
    for (const k of Object.keys(o)) s[k] = o[k];
    return s;
}

/* ══════════ 判据函数（数据层） ══════════ */
function dataVersionProblems(M) {
    const bad = [];
    const v2 = M.versionFace({ version: 2 });
    if (v2.withinRange !== true || v2.value !== 2) bad.push('version-read-lost');
    const blank = M.versionFace({});
    if (blank.blank !== true) bad.push('version-blank-lost');
    if (blank.value !== null) bad.push('version-blank-read-as-one');
    if (blank.unrecognized !== false) bad.push('version-blank-lost');
    const un = M.versionFace({ version: 9 });
    if (un.unrecognized !== true) bad.push('version-unrecognized-read-as-one');
    if (un.value !== null) bad.push('version-unrecognized-read-as-one');
    const bad2 = M.versionFace({ version: 'zzz' });
    if (bad2.value !== null) bad.push('version-unrecognized-read-as-one');
    return bad;
}
function dataStatusProblems(M) {
    const bad = [];
    const s = M.statusFace(['planned', 'zzz', 'unknown', null]);
    if (s.total !== 4) bad.push('status-total-lost');
    if (s.unrecognized !== 2) bad.push('status-unrecognized-as-planned');
    if (s.blank !== 1) bad.push('status-blank-lost');
    const cell = (k) => { for (const c of s.cells) if (c.key === k) return c.count; return -1; };
    if (cell('planned') !== 1) bad.push('status-unrecognized-as-planned');
    if (cell('unknown') !== 3) bad.push('status-unrecognized-as-planned');
    return bad;
}
function dataDeltaProblems(M) {
    const bad = [];
    const c1 = M.deltaFace({ status: 'empty', events: [{}] });
    if (c1.conflict !== true) bad.push('delta-conflict-hidden');
    if (c1.count !== 1) bad.push('delta-count-lost');
    const c2 = M.deltaFace({ status: 'ready', events: [] });
    if (c2.conflict !== true) bad.push('delta-conflict-hidden');
    const ok = M.deltaFace({ status: 'ready', events: [{}] });
    if (ok.conflict !== false) bad.push('delta-conflict-invented');
    const un = M.deltaFace({ status: 'zzz', events: [] });
    if (un.known !== false) bad.push('delta-unknown-read-as-ready');
    if (un.conflict !== true) bad.push('delta-unknown-read-as-ready');
    const noCount = M.deltaFace({ status: 'ready' });
    if (noCount.countKnown !== false) bad.push('delta-count-blank-read-as-zero');
    if (noCount.count !== null) bad.push('delta-count-blank-read-as-zero');
    return bad;
}
function dataFlowProblems(M) {
    const bad = [];
    const p = M.pipelineFace([{ step: 'synchronizing' }, { step: 'rootCheck', failed: true }, { step: 'zzz' }]);
    if (p.total !== 3) bad.push('flow-total-lost');
    if (p.unnamed !== 1) bad.push('flow-unnamed-collapsed');
    if (p.cells.length !== DAT.DD_FLOW.length) bad.push('flow-step-count-lost');
    const c0 = p.cells[0];
    if (c0.known !== 1) bad.push('flow-known-lost');
    const c9 = p.cells[9];
    if (c9.failed !== 1) bad.push('flow-failed-not-counted');
    const d = p.detail[2];
    if (d.known !== false) bad.push('flow-unnamed-collapsed');
    if (d.order !== 0) bad.push('flow-unnamed-collapsed');
    return bad;
}
function dataFieldProblems(M) {
    const bad = [];
    const f = M.fieldFace(baseState({ version: 2 }), 2);
    if (f.unknownTypes !== 0) bad.push('field-type-book-not-consulted');
    if (M.typeInBook('weird') !== false) bad.push('field-type-book-not-consulted');
    if (f.missing !== 2) bad.push('field-missing-read-as-zero');
    const byKey = (k) => { for (const r of f.rows) if (r.key === k) return r; return null; };
    const notYet = byKey('extensionCount');
    if (notYet === null || notYet.state !== 'notYet') bad.push('field-notyet-folded-into-missing');
    const miss = byKey('fetuses');
    if (miss === null || miss.state !== 'missing') bad.push('field-missing-read-as-zero');
    if (miss !== null && miss.fill === '0') bad.push('field-missing-read-as-zero');
    if (miss !== null && miss.present !== false) bad.push('field-missing-read-as-zero');
    return bad;
}
function dataPlanProblems(M) {
    const bad = [];
    const p1 = M.migrationPlan(baseState({ version: 1 }));
    if (p1.halted !== false) bad.push('plan-halted-invented');
    if (p1.steps.length !== DAT.DD_MIGRATIONS.length) bad.push('plan-skip-step');
    if (p1.steps[0].needed !== true) bad.push('plan-skip-step');
    if (p1.steps[0].actions[0].action !== 'now') bad.push('plan-custom-overwritten');
    const p2 = M.migrationPlan(baseState({ version: 2 }));
    if (p2.steps[0].needed !== false) bad.push('plan-skip-step');
    if (p2.steps[1].actions.length !== 3) bad.push('plan-missing-fill-lost');
    let fills = 0;
    for (const a of p2.steps[1].actions) if (a.action === 'fill') fills += 1;
    if (fills !== 3) bad.push('plan-missing-fill-lost');
    const custom = baseState({ version: 1 });
    custom.角色档案.生理读数.承载耐受 = 0.5;
    const pc = M.migrationPlan(custom);
    if (pc.steps[0].actions[0].action !== 'keep') bad.push('plan-custom-overwritten');
    const rec = baseState({ version: 1 });
    rec.角色档案.生理读数.承载耐受 = 3;
    rec.角色档案.基础.阶段 = '产后恢复';
    const pr = M.migrationPlan(rec);
    if (pr.steps[0].actions[1].action !== 'keep') bad.push('plan-recovery-interrupted');
    const halted = M.migrationPlan({ version: 'zzz' });
    if (halted.halted !== true) bad.push('plan-halted-ignored');
    if (halted.steps.length !== 0) bad.push('plan-halted-ignored');
    return bad;
}
function dataProblemsOfProblems(M) {
    const bad = [];
    const cant = M.summarize({ archive: baseState({ version: 9 }) });
    if (cant.verdict !== 'cant') bad.push('verdict-cant-hidden');
    const warn = M.summarize({ archive: baseState({ version: 2 }) });
    if (warn.verdict !== 'warn') bad.push('verdict-warn-hidden');
    if (warn.problems.length === 0) bad.push('problems-merged');
    const blankArc = M.summarize({ archive: {} });
    let hasBlank = false;
    for (const t of blankArc.problems) if (t.indexOf('版本：') === 0) hasBlank = true;
    if (!hasBlank) bad.push('version-blank-lost');
    const dUn = M.summarize({ archive: baseState({ version: 2 }), delta: { status: 'zzz' } });
    if (dUn.verdict !== 'cant') bad.push('delta-unknown-read-as-ready');
    return bad;
}
function dataGaugeProblems(M) {
    const bad = [];
    const t = M.trimRows([1, 2, 3], 2);
    if (t.rows.length !== 2) bad.push('trim-over-not-reported');
    if (t.dropped !== 1) bad.push('trim-over-not-reported');
    if (t.over !== true) bad.push('trim-over-not-reported');
    const none = M.trimRows([1], 2);
    if (none.over !== false || none.dropped !== 0) bad.push('trim-over-invented');
    const s = M.summarize({ archive: baseState({ version: 2 }) });
    const txt = M.requestText(s, '额外要求');
    if (txt.text.indexOf('追加要求') < 0) bad.push('request-text-extra-lost');
    if (txt.text.indexOf('要处置的') < 0) bad.push('request-text-lost');
    if (txt.chars !== txt.text.length) bad.push('request-text-lost');
    return bad;
}
function dataIntakeProblems(M) {
    const bad = [];
    const r = (t) => M.intake(t);
    if (r('').why !== 'empty_input') bad.push('intake-why-collapsed:empty_input');
    if (r('x'.repeat(20000)).why !== 'too_long') bad.push('intake-why-collapsed:too_long');
    if (r('{}').why !== 'empty') bad.push('intake-why-collapsed:empty');
    if (r('{').why !== 'bad_json') bad.push('intake-why-collapsed:bad_json');
    if (r('[1]').why !== 'no_object') bad.push('intake-why-collapsed:no_object');
    if (r(jsonOf({ zzz: 1 })).why !== 'no_fields') bad.push('intake-why-collapsed:no_fields');
    const many = { version: 1 };
    for (let i = 0; i < 80; i += 1) many['k' + String(i)] = i;
    if (r(jsonOf(many)).why !== 'too_many') bad.push('intake-why-collapsed:too_many');
    let deep = '1';
    for (let i = 0; i < 20; i += 1) deep = '[' + deep + ']';
    if (r('{"version":1,"x":' + deep + '}').why !== 'too_deep') bad.push('intake-why-collapsed:too_deep');
    if (r(jsonOf(baseState({ version: 1 }))).ok !== true) bad.push('intake-ok-lost');
    if (r(jsonOf({ 角色档案: {} })).ok !== true) bad.push('intake-known-key-lost');
    return bad;
}
function dataKeyProblems(src) {
    const code = stripComments(src);
    const bad = [];
    const keys = ['empty_input', 'too_long', 'empty', 'bad_json', 'no_object', 'no_fields', 'too_many', 'too_deep'];
    for (const k of keys) if (code.indexOf(Q + k + Q) < 0) bad.push('why-not-key:' + k);
    const line = '    ' + Q + keys.join(Q + ', ' + Q) + Q;
    if (code.indexOf(line) < 0) bad.push('why-not-key-line');
    return bad;
}

/* ══════════ 判据函数（App 层） ══════════ */
function appFaceProblems(M) {
    const bad = [];
    const empty = toApp(M, memStorage());
    empty.probe();
    if (empty.faceOf() !== 'empty') bad.push('face-empty-collapsed');
    if (empty.toneOf() !== 'warn') bad.push('malformed-face-lost');
    if (empty.verdictOf() !== 'cant') bad.push('face-empty-collapsed');
    const mal = toApp(M, memStorage({ diagdesk_archive: '{oops' }));
    mal.probe();
    if (mal.faceOf() !== 'malformed') bad.push('malformed-face-lost');
    if (mal.toneOf() !== 'err') bad.push('malformed-face-lost');
    if (mal.faceOf() === 'empty') bad.push('malformed-face-lost');
    const ok = toApp(M, memStorage());
    ok.ingestArchive(jsonOf(baseState({ version: 2 })));
    if (ok.faceOf() !== 'ok') bad.push('face-ok-lost');
    if (ok.toneOf() !== 'ok') bad.push('face-tone-not-by-source');
    const host = toApp(M, hostileStorage());
    host.probe();
    if (host.faceOf() !== 'absent') bad.push('storage-throw-read-as-absent');
    const nos = new M.DiagdeskApp(shellStub(), null);
    nos.probe();
    if (nos.faceOf() !== 'absent') bad.push('no-storage-read-as-empty');
    return bad;
}
function appIngestProblems(M) {
    const bad = [];
    const a = toApp(M, memStorage());
    const r1 = a.ingestArchive('');
    if (r1.ok !== false || r1.why !== 'empty_input') bad.push('empty-input-taken');
    const r2 = a.ingestArchive('x'.repeat(20000));
    if (r2.ok !== false || r2.why !== 'too_long') bad.push('over-limit-silently-taken');
    const rows = a.ledgerRows();
    const last = rows.length ? rows[rows.length - 1] : null;
    if (!last || last.n !== 20000) bad.push('over-limit-silently-taken');
    const r3 = a.ingestArchive('{oops');
    if (r3.ok !== false || r3.why !== 'bad_json') bad.push('bad-json-taken');
    const good = a.ingestArchive(jsonOf(baseState({ version: 2 })));
    if (good.ok !== true) bad.push('ingest-ok-lost');
    const before = a.rawLen();
    const r4 = a.ingestArchive('[1,2]');
    if (r4.ok !== false) bad.push('no-object-taken');
    if (a.rawLen() !== before) bad.push('failed-ingest-wiped-archive');
    if (a.faceOf() !== 'ok') bad.push('failed-ingest-wiped-archive');
    return bad;
}
function appGateProblems(M) {
    const bad = [];
    const a = toApp(M, memStorage());
    if (a.tab() !== 'overview') bad.push('tab-default-lost');
    a.setTab('zzz');
    if (a.tab() !== 'overview') bad.push('tab-gate-lost');
    a.setTab('ledger');
    if (a.tab() !== 'ledger') bad.push('tab-gate-lost');
    const rows = a.statusCells();
    if (rows.length !== DAT.DD_STATUSES.length) bad.push('status-cells-not-by-source');
    if (rows[0].label !== DAT.DD_STATUS_TEXT[DAT.DD_STATUSES[0]]) bad.push('status-cells-not-by-source');
    const fl = a.flowCells();
    if (fl.length !== DAT.DD_FLOW.length) bad.push('flow-cells-not-by-source');
    if (fl[fl.length - 1].order !== DAT.DD_FLOW.length) bad.push('flow-cells-not-by-source');
    const lim = a.limits();
    if (lim.text !== DAT.DD_TEXT_MAX) bad.push('limits-not-by-source');
    if (lim.rows !== DAT.DD_ROWS_MAX) bad.push('limits-not-by-source');
    if (lim.ledger !== DAT.DD_LEDGER_MAX) bad.push('limits-not-by-source');
    if (lim.latest !== DAT.DD_VERSION_LATEST) bad.push('limits-not-by-source');
    const why = a.intakeWhyText(DAT.DD_INTAKE_WHYS[0]);
    if (why.length === 0 || why === '--') bad.push('intake-why-text-not-by-source');
    if (a.intakeWhyText('zzz') !== '--') bad.push('intake-why-text-not-by-source');
    return bad;
}
function appLedgerProblems(M) {
    const bad = [];
    const a = toApp(M, memStorage());
    a.tick(1000);
    a.ingestArchive(jsonOf(baseState({ version: 2 })));
    a.setDraft('', '要求');
    if (a.ledgerRows().length < 2) bad.push('ledger-not-recorded');
    const kept = a.rawLen();
    const hadRows = a.ledgerRows().length;
    a.clearArchive();
    if (hadRows > 0 && a.ledgerRows().length < 2) bad.push('clear-ledger-wiped-archive');
    a.ingestArchive(jsonOf(baseState({ version: 2 })));
    const cleared = a.clearLedger();
    if (a.ledgerRows().length !== 1) bad.push('clear-ledger-lost-receipt');
    if (a.rawLen() !== kept) bad.push('clear-ledger-wiped-archive');
    if (cleared.cleared < 2) bad.push('clear-ledger-count-lost');
    const many = toApp(M, memStorage());
    for (let i = 0; i < DAT.DD_LEDGER_MAX + 8; i += 1) many.setDraft('', 'x');
    if (many.droppedCount() === 0) bad.push('ledger-drop-unreported');
    if (many.ledgerRows().length > DAT.DD_LEDGER_MAX) bad.push('ledger-not-trimmed');
    const ro = toApp(M, readOnlyStorage());
    const w = ro.setDraft('', 'y');
    if (w.ok !== false) bad.push('write-failure-read-as-ok');
    return bad;
}
function appChatProblems(M) {
    const bad = [];
    const st = sessionStorage();
    const a = new M.DiagdeskApp(shellStub(), st);
    a.tick(1000);
    a.ingestArchive(jsonOf(baseState({ version: 2 })));
    a.setDraft('', '要求A');
    if (a.rawLen() === 0) bad.push('ingest-ok-lost');
    if (a.draftOf().extra !== '要求A') bad.push('draft-not-persisted');
    st.switchChat('c2');
    a.onChatChanged();
    if (a.rawLen() !== 0) bad.push('chat-change-kept-old-archive');
    if (a.draftOf().extra !== '') bad.push('chat-change-kept-old-draft');
    if (a.faceOf() !== 'empty') bad.push('chat-change-kept-old-archive');
    if (a.ledgerRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    st.switchChat('c1');
    a.onChatChanged();
    if (a.rawLen() === 0) bad.push('chat-change-no-archive-reload');
    if (a.faceOf() !== 'ok') bad.push('chat-change-no-archive-reload');
    return bad;
}
/* ══════════ 五块不缝（合并判据） ══════════ */
const SEAM_WORDS = [
    'WeakMap', 'WeakSet', '.stack', 'captureStackTrace',
    'fetch(', 'XMLHttpRequest', 'sendBeacon', 'new Blob', 'new FormData',
    'localStorage', 'sessionStorage', 'indexedDB',
    'window.parent', 'window.top', 'location.reload', 'location.href',
    'getElementById', 'document.body', 'document.head', 'removeFromBody',
    'injectItems', 'new Error', 'eval(', 'Function('
];
function seamProblems(sources) {
    const bad = [];
    for (const [rel, src] of sources) {
        const code = stripComments(src);
        for (const w of SEAM_WORDS) {
            if (code.indexOf(w) >= 0) bad.push('seam:' + rel + ':' + w);
        }
    }
    return bad;
}
/* ══════════ 视图面判据 ══════════ */
function viewFaceProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('FACE_TONE') < 0) bad.push('face-tone-not-by-source');
    for (const pair of ['ok: ' + Q + 'ok' + Q, 'empty: ' + Q + 'warn' + Q, 'malformed: ' + Q + 'err' + Q, 'absent: ' + Q + 'off' + Q]) {
        if (code.indexOf(pair) < 0) bad.push('face-tone-not-by-source');
    }
    return bad;
}
function viewCountProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('DASH') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf(') ? DASH : String(v)') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf('d.countKnown ? String(d.count) : DASH') < 0) bad.push('empty-and-bad-collapsed');
    return bad;
}
function viewSplitProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('r.typeKnown === false') < 0) bad.push('typebook-silently-ignored');
    if (code.indexOf('声明的类型不在类型册') < 0) bad.push('typebook-silently-ignored');
    if (code.indexOf('不许读成 ') < 0) bad.push('missing-read-as-zero');
    return bad;
}
function viewActProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('data-act') < 0) bad.push('action-binding-lost');
    if (code.indexOf('getAttribute') < 0) bad.push('action-binding-lost');
    if (code.indexOf('querySelectorAll(' + Q + '[data-in]' + Q + ')') < 0) bad.push('input-binding-lost');
    if (code.indexOf('if (kind === ' + Q + 'archive' + Q + ') this._archiveInput = v;') < 0) bad.push('input-binding-lost');
    for (const a of ['tab', 'ingest_archive', 'clear_archive_input', 'clear_archive', 'make_text', 'save_draft', 'clear_ledger']) {
        if (code.indexOf('(a === ' + Q + a + Q + ')') < 0 && code.indexOf('(act === ' + Q + a + Q + ')') < 0) {
            bad.push('action-branch-lost:' + a);
        }
    }
    return bad;
}
function viewTextProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('data-in=' + DQ + 'archive' + DQ) < 0) bad.push('text-not-selectable');
    if (code.indexOf('data-in=' + DQ + 'extra' + DQ) < 0) bad.push('text-not-selectable');
    if (code.indexOf('本件唯一的产物') < 0) bad.push('text-not-selectable');
    return bad;
}
function viewTabProblems(src) {
    const code = stripComments(src);
    const bad = [];
    for (const t of ['overview', 'fields', 'pipeline', 'ledger']) {
        if (code.indexOf('key: ' + Q + t + Q) < 0) bad.push('tab-lost:' + t);
    }
    return bad;
}
function viewScanProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('不硬塞进某一格') < 0) bad.push('flow-unnamed-collapsed');
    if (code.indexOf('不当还没发生') < 0) bad.push('status-unrecognized-as-planned');
    if (code.indexOf('缺栏位逐格列') < 0) bad.push('missing-read-as-zero');
    if (code.indexOf('只报') < 0) bad.push('trim-over-not-reported');
    return bad;
}
/** 接线面：六处落点齐备。★ 少一处就静默错数据 / 点了没反应。 */
function wireProblems(files) {
    const bad = [];
    const apps = stripComments(files.apps);
    const storage = stripComments(files.storage);
    const index = stripComments(files.index);
    const keys = stripComments(files.keys);
    const css = files.phoneCss;
    if (apps.indexOf(Q + 'diagdesk' + Q) < 0) bad.push('wire-app-registry-lost');
    if (index.indexOf('./apps/diagdesk/diagdesk-app.js') < 0) bad.push('wire-app-entry-lost');
    if (storage.indexOf('/^diagdesk_/') < 0) bad.push('wire-storage-prefix-lost');
    for (const k of ['diagdesk_archive', 'diagdesk_draft', 'diagdesk_ledger']) {
        if (keys.indexOf(Q + k + Q) < 0) bad.push('wire-key-lost:' + k);
    }
    if (index.indexOf(Q + 'diagdesk' + Q) < 0) bad.push('wire-lazy-branch-lost');
    if (index.indexOf('window.VirtualPhone.diagdeskApp = new module.DiagdeskApp') < 0) bad.push('wire-shell-field-lost');
    if (css.indexOf('v3.47.0] 诊断案头（diagdesk）') < 0) bad.push('wire-css-lost');
    if (css.indexOf('.dd-root') < 0) bad.push('wire-css-lost');
    return bad;
}
/** 接线面的取数口。★ root 可指向副本树 —— 破坏类负控制只准写副本，
 *  绝不写真仓：`node --test` 是文件级并行，写真仓会在破坏窗口内被别的套件读到，
 *  且一旦跑批被中断（finally 来不及执行）会把破坏**永久留在仓里**（本版真踩过）。 */
const TABLE_IN = (dir) => {
    const p = path.join(dir, LAZY_ROUTE_TABLE_REL);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : readRepoTable();
};
function wireJudgeAt(root) {
    const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    return wireProblems({
        apps: rd(APPS), storage: rd(STORAGE), index: routeSurface(rd(INDEX), TABLE_IN(root)),
        keys: rd(KEYS), phoneCss: rd(PHONE_CSS)
    });
}
function wireJudge() { return wireJudgeAt(ROOT); }
/** 接线面副本树：六处落点所在文件按真相对路径各一份，供破坏类负控制用。 */
function stageWire() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3470w_'));
    temps.push(dir);
    for (const rel of [APPS, STORAGE, INDEX, KEYS, PHONE_CSS, LAZY_ROUTE_TABLE_REL]) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    return dir;
}

/* ══════════ 合并判据与取用（负控制按族取用） ══════════ */
function dataProblems(M) {
    return [].concat(
        dataVersionProblems(M), dataStatusProblems(M), dataDeltaProblems(M),
        dataFlowProblems(M), dataFieldProblems(M), dataPlanProblems(M),
        dataProblemsOfProblems(M), dataGaugeProblems(M), dataIntakeProblems(M)
    );
}
function appProblems(M) {
    return [].concat(
        appFaceProblems(M), appIngestProblems(M), appGateProblems(M),
        appLedgerProblems(M), appChatProblems(M)
    );
}
function viewProblems(src) {
    return [].concat(
        viewFaceProblems(src), viewCountProblems(src), viewSplitProblems(src),
        viewActProblems(src), viewTextProblems(src), viewTabProblems(src), viewScanProblems(src)
    );
}
function judgeOf(key, subject) {
    const n = Number(key.slice(1));
    if (n <= 7) return dataProblems(subject);
    if (n <= 15) return appProblems(subject);
    if (n <= 19) return viewProblems(subject);
    return [];
}

/* ══════════════════════ A — 版本面 ══════════════════════ */
test('A1 版本读不出来不许读成 1：另立「读不出来 / 版本认不出来」两格', () => {
    const blank = DAT.versionFace({});
    assert.equal(blank.value, null, '没这一栏不许读成 1');
    assert.equal(blank.blank, true);
    assert.equal(blank.unrecognized, false, '「没这一栏」与「认不出来」是两件事');
    const un = DAT.versionFace({ version: 9 });
    assert.equal(un.value, null);
    assert.equal(un.unrecognized, true);
    const s = DAT.versionFace({ version: 2 });
    assert.equal(s.value, 2);
    assert.equal(s.withinRange, true);
});

/* ══════════════════════ B — 六态面 ══════════════════════ */
test('B1 状态认不出来并入「说不清」，不当还没发生；没写状态的也入说不清', () => {
    const s = DAT.statusFace(['planned', 'zzz', 'unknown', null]);
    assert.equal(s.total, 4);
    assert.equal(s.unrecognized, 2);
    assert.equal(s.blank, 1);
    const cell = (k) => { for (const c of s.cells) if (c.key === k) return c.count; return -1; };
    assert.equal(cell('planned'), 1);
    assert.equal(cell('unknown'), 3, '认不出的与没写状态的一律并入说不清');
});

/* ══════════════════════ C — 增量面 ══════════════════════ */
test('C1 增量状态与条数要互相成立：矛盾逐格标，不抛异常也不静默', () => {
    assert.equal(DAT.deltaFace({ status: 'empty', events: [{}] }).conflict, true);
    assert.equal(DAT.deltaFace({ status: 'ready', events: [] }).conflict, true);
    assert.equal(DAT.deltaFace({ status: 'ready', events: [{}] }).conflict, false);
    const un = DAT.deltaFace({ status: 'zzz', events: [] });
    assert.equal(un.known, false);
    assert.equal(un.conflict, true, '认不出的状态不当作就绪');
    const noCount = DAT.deltaFace({ status: 'ready' });
    assert.equal(noCount.countKnown, false);
    assert.equal(noCount.count, null, '条数读不出来不许读成 0');
});

/* ══════════════════════ D — 流水线面 ══════════════════════ */
test('D1 十一步逐格计数：认不出的步骤另立一格，不硬塞进某一格', () => {
    const p = DAT.pipelineFace([{ step: 'synchronizing' }, { step: 'rootCheck', failed: true }, { step: 'zzz' }]);
    assert.equal(p.cells.length, DAT.DD_FLOW.length);
    assert.equal(p.unnamed, 1);
    assert.equal(p.cells[0].known, 1);
    assert.equal(p.cells[9].failed, 1);
    assert.equal(p.detail[2].known, false);
    assert.equal(p.detail[2].order, 0, '认不出的步骤不给序号');
});

/* ══════════════════════ E — 栏位体检面 ══════════════════════ */
test('E1 缺栏位不许读成 0：缺栏位与「这一版还没有这一栏」两格分开', () => {
    const f = DAT.fieldFace(baseState({ version: 2 }), 2);
    assert.equal(f.unknownTypes, 0, '类型册必须被真读（自证）');
    assert.equal(DAT.typeInBook(DAT.DD_TYPES[0]), true);
    assert.equal(f.missing, 2);
    const byKey = (k) => { for (const r of f.rows) if (r.key === k) return r; return null; };
    assert.equal(byKey('extensionCount').state, 'notYet');
    assert.equal(byKey('fetuses').state, 'missing');
    assert.equal(byKey('fetuses').fill, '空列表');
    assert.equal(byKey('fetuses').present, false);
});
test('E2 类型册两向自证：册里有的判在场、册里没有的判不在场', () => {
    assert.equal(DAT.typeInBook(DAT.DD_TYPES[0]), true, '册里有的类型必须判在场');
    assert.equal(DAT.typeInBook('weird'), false, '册里没有的类型必须判不在场');
    const a = newApp(memStorage());
    const rows = a.fieldCells();
    assert.equal(rows.length, DAT.DD_FIELDS.length);
    let allKnown = true;
    for (const r of rows) if (r.known !== true) allKnown = false;
    assert.ok(allKnown, '真栏位册里的每个类型都该在类型册里');
});

/* ══════════════════════ F — 迁移计划面 ══════════════════════ */
test('F1 迁移逐版列，一跳就是错；自订过的值一律不动', () => {
    const p1 = DAT.migrationPlan(baseState({ version: 1 }));
    assert.equal(p1.halted, false);
    assert.equal(p1.steps.length, DAT.DD_MIGRATIONS.length);
    assert.equal(p1.steps[0].needed, true);
    assert.equal(p1.steps[0].actions[0].action, 'now', '仍等于旧内置值就换新内置值');
    const p2 = DAT.migrationPlan(baseState({ version: 2 }));
    assert.equal(p2.steps[0].needed, false, '已经过的版本不许再列成要做');
    let fills = 0;
    for (const a of p2.steps[1].actions) if (a.action === 'fill') fills += 1;
    assert.equal(fills, 3, '第 2 版到第 3 版要补三栏');
    const custom = baseState({ version: 1 });
    custom.角色档案.生理读数.承载耐受 = 0.5;
    assert.equal(DAT.migrationPlan(custom).steps[0].actions[0].action, 'keep', '自订过的一律不动');
    const rec = baseState({ version: 1 });
    rec.角色档案.生理读数.承载耐受 = 3;
    rec.角色档案.基础.阶段 = '产后恢复';
    assert.equal(DAT.migrationPlan(rec).steps[0].actions[1].action, 'keep', '正在产后恢复的不打断');
    const halted = DAT.migrationPlan({ version: 'zzz' });
    assert.equal(halted.halted, true, '版本认不出来就不敢往下排');
    assert.equal(halted.steps.length, 0);
});

/* ══════════════════════ G — 判定与摘要面 ══════════════════════ */
test('G1 判定三态：读不完不与「有几处要处置」合成一句', () => {
    assert.equal(DAT.summarize({ archive: baseState({ version: 9 }) }).verdict, 'cant');
    assert.equal(DAT.summarize({ archive: baseState({ version: 2 }) }).verdict, 'warn');
    assert.equal(DAT.summarize({ archive: {} }).verdict, 'warn');
    assert.equal(DAT.summarize({ archive: baseState({ version: 2 }), delta: { status: 'zzz' } }).verdict, 'cant');
});
test('G2 摘要文本是本件唯一产物：逐条列，不合成一句', () => {
    const s = DAT.summarize({ archive: baseState({ version: 2 }) });
    const t = DAT.requestText(s, '额外要求');
    assert.ok(t.text.indexOf('要处置的') >= 0);
    assert.ok(t.text.indexOf('追加要求') >= 0);
    assert.equal(t.chars, t.text.length);
    assert.equal(t.over, false);
});

/* ══════════════════════ H — 上限与裁边面 ══════════════════════ */
test('H1 裁边只报不截：挤掉几条要成数', () => {
    const t = DAT.trimRows([1, 2, 3], 2);
    assert.equal(t.rows.length, 2);
    assert.equal(t.dropped, 1);
    assert.equal(t.over, true);
    const none = DAT.trimRows([1], 2);
    assert.equal(none.over, false);
    assert.equal(none.dropped, 0);
});

/* ══════════════════════ I — 收录面（八个失败因逐因成立） ══════════════════════ */
test('I1 八个失败因各自成立（空册不许静默换默认册）', () => {
    assert.equal(DAT.intake('').why, 'empty_input');
    assert.equal(DAT.intake('x'.repeat(20000)).why, 'too_long');
    assert.equal(DAT.intake('{}').why, 'empty');
    assert.equal(DAT.intake('{').why, 'bad_json');
    assert.equal(DAT.intake('[1]').why, 'no_object');
    assert.equal(DAT.intake(jsonOf({ zzz: 1 })).why, 'no_fields');
    const many = { version: 1 };
    for (let i = 0; i < 80; i += 1) many['k' + String(i)] = i;
    assert.equal(DAT.intake(jsonOf(many)).why, 'too_many');
    let deep = '1';
    for (let i = 0; i < 20; i += 1) deep = '[' + deep + ']';
    assert.equal(DAT.intake('{"version":1,"x":' + deep + '}').why, 'too_deep');
    assert.equal(DAT.intake(jsonOf(baseState({ version: 1 }))).ok, true);
    assert.equal(DAT.intake(jsonOf({ 角色档案: {} })).ok, true);
});

/* ══════════════════════ J — App 面：四态 / 收录 / 门 / 台账 / 换会话 ══════════════════════ */
test('J1 四态分开判：取不出来不是「没记过」，读不懂不是「空」', () => {
    const empty = newApp(memStorage());
    empty.probe();
    assert.equal(empty.faceOf(), 'empty');
    assert.equal(empty.verdictOf(), 'cant');
    const mal = newApp(memStorage({ diagdesk_archive: '{oops' }));
    mal.probe();
    assert.equal(mal.faceOf(), 'malformed');
    assert.equal(mal.toneOf(), 'err');
    const host = newApp(hostileStorage());
    host.probe();
    assert.equal(host.faceOf(), 'absent', '取数抛异常不许读成「就是没记过」');
    const nos = new APP.DiagdeskApp(shellStub(), null);
    nos.probe();
    assert.equal(nos.faceOf(), 'absent');
});
test('J2 收档口：认不出来的粘贴不许冲掉台面上那份', () => {
    const a = newApp(memStorage());
    assert.equal(a.ingestArchive('').why, 'empty_input');
    assert.equal(a.ingestArchive('x'.repeat(20000)).why, 'too_long');
    assert.equal(a.ingestArchive('{oops').why, 'bad_json');
    assert.equal(a.ingestArchive(jsonOf(baseState({ version: 2 }))).ok, true);
    const before = a.rawLen();
    assert.equal(a.ingestArchive('[1,2]').ok, false);
    assert.equal(a.rawLen(), before, '失败的那一次不许动台面');
    assert.equal(a.faceOf(), 'ok');
});
test('J3 页签门与读数口一律取真源（不手抄词表）', () => {
    const a = newApp(memStorage());
    assert.equal(a.tab(), 'overview');
    a.setTab('zzz');
    assert.equal(a.tab(), 'overview', '页签只认四个真键');
    a.setTab('ledger');
    assert.equal(a.tab(), 'ledger');
    assert.equal(a.statusCells().length, DAT.DD_STATUSES.length);
    assert.equal(a.flowCells().length, DAT.DD_FLOW.length);
    assert.equal(a.limits().text, DAT.DD_TEXT_MAX);
    assert.ok(a.intakeWhyText(DAT.DD_INTAKE_WHYS[0]) !== '--');
    assert.equal(a.typeUnknownCount(), 0, '真栏位册里的类型都该在类型册里');
    assert.ok(a.typeUnknownOf([{ type: 'weird' }]) > 0, '册子里没有的类型必须被数出来');
    assert.equal(a.intakeWhyText('zzz'), '--');
});
test('J4 台账裁边计数；清台账只清自己那条键', () => {
    const a = newApp(memStorage());
    a.tick(1000);
    a.ingestArchive(jsonOf(baseState({ version: 2 })));
    a.setDraft('', '要求');
    const kept = a.rawLen();
    const hadRows = a.ledgerRows().length;
    a.clearArchive();
    if (hadRows > 0 && a.ledgerRows().length < 2) bad.push('clear-ledger-wiped-archive');
    a.ingestArchive(jsonOf(baseState({ version: 2 })));
    const cleared = a.clearLedger();
    assert.ok(cleared.cleared >= 2);
    assert.equal(a.rawLen(), kept, '清台账不许把存档也清了');
    const many = newApp(memStorage());
    for (let i = 0; i < DAT.DD_LEDGER_MAX + 8; i += 1) many.setDraft('', 'x');
    assert.ok(many.droppedCount() > 0, '台账挤掉旧记录要报数');
    assert.ok(many.ledgerRows().length <= DAT.DD_LEDGER_MAX);
    const ro = newApp(readOnlyStorage());
    assert.equal(ro.setDraft('', 'y').ok, false, '写不进去要报，不许假装存好了');
});
test('J5 换会话三格全量重取（旧档 / 旧草稿 / 旧台账都不许留着）', () => {
    const st = sessionStorage();
    const a = new APP.DiagdeskApp(shellStub(), st);
    a.tick(1000);
    a.ingestArchive(jsonOf(baseState({ version: 2 })));
    a.setDraft('', '要求A');
    assert.equal(a.draftOf().extra, '要求A');
    st.switchChat('c2');
    a.onChatChanged();
    assert.equal(a.rawLen(), 0);
    assert.equal(a.draftOf().extra, '');
    assert.equal(a.ledgerRows().length, 0);
    assert.equal(a.faceOf(), 'empty');
    st.switchChat('c1');
    a.onChatChanged();
    assert.equal(a.faceOf(), 'ok', '回到原会话要能把存档读回来');
});

/* ══════════════════════ K — 五块不缝真的没缝 ══════════════════════ */
const THREE = [[DD_DATA, read(DD_DATA)], [DD_APP, read(DD_APP)], [DD_VIEW, read(DD_VIEW)]];
test('K1 五块不缝：零挂错误对象 / 零抠堆栈 / 零编原因 / 零就地改存档 / 零写宿主键', () => {
    assert.deepEqual(seamProblems(THREE), []);
});
test('K2 本件只写自己那三条键（不写宿主任何键）', () => {
    const code = stripComments(read(DD_APP));
    assert.ok(code.indexOf(APP.DD_ARCHIVE_KEY) >= 0);
    assert.ok(code.indexOf(APP.DD_DRAFT_KEY) >= 0);
    assert.ok(code.indexOf(APP.DD_LEDGER_KEY) >= 0);
    assert.equal(code.indexOf('localStorage'), -1);
    assert.equal(code.indexOf('sessionStorage'), -1);
});

/* ══════════════════════ L — 视图面 ══════════════════════ */
test('L1 四态面色相取真源；取不出来画横线不画 0', () => {
    assert.deepEqual(viewFaceProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(DD_VIEW)), []);
});
test('L2 缺栏位与类型认不出要单独画；十一步不硬塞；只报不截', () => {
    assert.deepEqual(viewSplitProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewScanProblems(read(DD_VIEW)), []);
});
test('L3 动作分支与输入口逐条对上（少一个分支 = 点了没反应）', () => {
    assert.deepEqual(viewActProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewTextProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewTabProblems(read(DD_VIEW)), []);
});
test('L4 样式段头独立成行，选择器挂在 .dd-root 下（不外泄也不吃宿主）', () => {
    const css = read(DD_CSS);
    const lines = css.split(NL);
    let headAlone = false;
    for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i].trim();
        if (t.indexOf('diagdesk.css') >= 0 && t.indexOf('*/') < 0) headAlone = true;
    }
    assert.ok(css.indexOf('.dd-root') >= 0);
    assert.ok(headAlone, '段头必须独立成行');
    const phoneCss = read(PHONE_CSS);
    assert.ok(phoneCss.indexOf('v3.47.0] 诊断案头（diagdesk）') >= 0);
    assert.ok(phoneCss.indexOf('.dd-root') >= 0);
});

/* ══════════════════════ M — 接线面（六处落点） ══════════════════════ */
test('M1 六处接线落点齐备（少一处就静默错数据 / 点了没反应）', () => {
    assert.deepEqual(wireJudge(), []);
    assert.deepEqual(wireProblems({
        apps: read(APPS), storage: read(STORAGE).split('/^diagdesk_/,').join('x'),
        index: read(INDEX), keys: read(KEYS), phoneCss: read(PHONE_CSS)
    }).some((x) => x.indexOf('wire-storage-prefix-lost') === 0), true);
});

/* ══════════ Q — 破坏表（负控制用：每一条都对着本件的一条静默失效形态） ══════════ */
/** ★ 破坏表纪律（本仓硬纪律）：
 *  · 锚点必须**在代码里**（不许落在注释里）—— 注释里的提及不算消费；
 *  · 锚点必须**恰中 1 次** —— 多一次就会连带破坏别的路径，破坏就不再单一；
 *  · 替换后必须**仍是合法 JS** —— 否则测到的是语法错而不是判据；
 *  · 每一条都对着「源里的一个静默失效形态」，不许有装饰性破坏。 */
const DAMAGE = {
    /* ① 版本认不出来当成第 1 版读下去（源就是这么读的）。 */
    q1: [DD_DATA, 'const known = (v !== null) && DD_VERSIONS.indexOf(v) >= 0;', 'const known = (v !== null);'],
    /* ② 状态认不出来当成「还没发生」落下去（源的读法）。 */
    q2: [DD_DATA, '        } else {' + NL + '            unrecognized += 1;' + NL + '            counts[DD_STATUSES[5]] += 1;',
        '        } else {' + NL + '            unrecognized += 1;' + NL + '            counts[DD_STATUSES[0]] += 1;'],
    /* ③ 增量状态与条数不互相校验（源在这里直接抛，本件必须逐格标）。 */
    q3: [DD_DATA, '        conflict = true;' + NL + "        conflictWhy = '状态是空，却带着 '",
        '        conflict = false;' + NL + "        conflictWhy = '状态是空，却带着 '"],
    /* ④ 认不出的步骤静默丢掉（源整块扔）。 */
    q4: [DD_DATA, '            if (entry.step !== step) continue;', '            if (false) continue;'],
    /* ⑤ 缺栏位读成「在场」（源把缺栏位与真值 0 同形）。 */
    q5: [DD_DATA, "        else if (supported) state = 'missing';", "        else if (supported) state = 'present';"],
    /* ⑥ 裁边不报（源一直涨、不报挤掉几条）。 */
    q6: [DD_DATA, '    if (list.length <= cap) return Object.freeze({ rows: list, dropped: 0, over: false });',
        '    if (true) return Object.freeze({ rows: list, dropped: 0, over: false });'],
    /* ⑦ 类型册不被真读（视图里那句「类型认不出」就永远不亮）。 */
    q7: [DD_DATA, '    return DD_TYPES.indexOf(type) >= 0;', '    return true;'],
    /* ⑧ 原文超上限静默收下（源把超了当成没超）。 */
    q8: [DD_APP, "            this._receipt('archive_ingest', false, 'too_long', { n: raw.length });",
        "            this._receipt('archive_ingest', false, 'too_long', { n: 0 });"],
    /* ⑨ 形状认不出来的粘贴冲掉台面上那份（源把读不出来画成「就是空的」）。 */
    q9: [DD_APP, '        const r = intake(raw, DD_TEXT_MAX);' + NL + '        if (!r.ok) {',
        '        const r = intake(raw, DD_TEXT_MAX);' + NL + '        if (false) {'],
    /* ⑩ 清台账顺手清存档（源把几类挤一处就是这个后果）。 */
    q10: [DD_APP, '    clearArchive() {' + NL + '        const had = this._raw.length;',
        '    clearArchive() {' + NL + '        this._ledger = []; this._persistLedger();' + NL + '        const had = this._raw.length;'],
    /* ⑪ 换会话不重取（源就是切角色原样留着）。 */
    q11: [DD_APP, "        this._input = '';" + NL + "        this._focus = '';" + NL + '        this.probe();',
        "        this._input = '';" + NL + "        this._focus = '';"],
    /* ⑫ 抛异常读成「没记过」（源的读法）。 */
    q12: [DD_APP, "        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }",
        "        catch (e) { return { ok: true, why: 'absent', value: undefined }; }"],
    /* ⑬ 台账挤掉不计数（源静默挤）。 */
    q13: [DD_APP, '        this._dropped += t.dropped;', '        this._dropped += 0;'],
    /* ⑭ 台账本体不裁边（源不裁）。 */
    q14: [DD_APP, '        this._ledger = t.rows;', '        this._ledger = this._ledger.slice(0);'],
    /* ⑮ 上限读数不取真源（视图那条「只报不截」就成摆设）。 */
    q15: [DD_APP, '        return { rows: DD_ROWS_MAX, text: DD_TEXT_MAX, ledger: DD_LEDGER_MAX, latest: DD_VERSION_LATEST };',
        '        return { rows: 0, text: DD_TEXT_MAX, ledger: DD_LEDGER_MAX, latest: DD_VERSION_LATEST };'],
    /* ⑯ 页面底色相不取真源（源把告警与错同色）。 */
    q16: [DD_VIEW, "    malformed: 'err',", "    malformed: 'ok',"],
    /* ⑰ 条数取不出来画 0（源就是这么画的）。 */
    q17: [DD_VIEW, "                { k: '条数', v: d.countKnown ? String(d.count) : DASH },",
        "                { k: '条数', v: String(d.count) },"],
    /* ⑱ 类型认不出不单独标（与「在场」合成一句）。 */
    q18: [DD_VIEW, "                if (r.typeKnown === false) { tone = 'warn'; stateText += '（声明的类型不在类型册）'; }",
        '                if (false) { }'],
    /* ⑲ 页签丢一个（点了没反应）。 */
    q19: [DD_VIEW, "    { key: 'pipeline', label: '流水线' }", "    { key: 'pipelineX', label: '流水线' }"],
    /* ⑳ 接线：会话键前缀丢掉（换会话读到别人的账）。 */
    q20: [STORAGE, '    /^diagdesk_/,', '    /^diagdeskX_/,'],
    /* ㉑ 接线：懒加载分支丢掉（打开页面一片空白）。 */
    q21: [LAZY_ROUTE_TABLE_REL,
        '    { id: "diagdesk", module: "./apps/diagdesk/diagdesk-app.js", key: "diagdeskApp", cls: "DiagdeskApp", errTitle: "诊断案头App" },',
        '    { id: "diagdeskX", module: "./apps/diagdeskX/diagdesk-app.js", key: "diagdeskApp", cls: "DiagdeskApp", errTitle: "诊断案头App" },'],
    /* ㉒ 接线：挂载丢掉（实例建不起来）。 */
    q22: [LAZY_ROUTE_TABLE_REL,
        '    { id: "diagdesk", module: "./apps/diagdesk/diagdesk-app.js", key: "diagdeskApp", cls: "DiagdeskApp", errTitle: "诊断案头App" },',
        '    { id: "diagdesk", module: "./apps/diagdesk/diagdesk-app.js", key: "diagdeskAppX", cls: "DiagdeskApp", errTitle: "诊断案头App" },'],
};
/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3470_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'storage.js'), path.join(dir, 'config', 'storage.js'));
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    /* [v3.58.0 · 计划 O5] diagdesk 已把写回执接进唯一实现，副本树必须带上它。 */
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    const ad = path.join(dir, 'apps', 'diagdesk');
    fs.mkdirSync(ad, { recursive: true });
    for (const f of ['diagdesk-data.js', 'diagdesk-app.js', 'diagdesk-view.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'diagdesk', f), path.join(ad, f));
    }
    return dir;
}
/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。
 *  ★ 类别四样：data（数据层模块副本）/ appmod（App 模块副本）/ src（源码文本判据）/ wire（接线真文件）。 */
const NEG = [
    ['I1 破坏「版本读不出来不许读成 1」⇒ 内核判据必须转红', 'q1', 'data', ['version-unrecognized-read-as-one', 'version-blank-read-as-one']],
    ['I2 破坏「状态认不出来并入说不清」⇒ 内核判据必须转红', 'q2', 'data', ['status-unrecognized-as-planned']],
    ['I3 破坏「增量状态与条数互相成立」⇒ 内核判据必须转红', 'q3', 'data', ['delta-conflict-hidden']],
    ['I4 破坏「认不出的步骤另立一格」⇒ 内核判据必须转红', 'q4', 'data', ['flow-unnamed-collapsed', 'flow-known-lost']],
    ['I5 破坏「缺栏位不许读成 0」⇒ 内核判据必须转红', 'q5', 'data', ['field-missing-read-as-zero']],
    ['I6 破坏「裁边只报不截」⇒ 内核判据必须转红', 'q6', 'data', ['trim-over-not-reported']],
    ['I7 破坏「类型册要真读」⇒ 内核判据必须转红', 'q7', 'data', ['field-type-book-not-consulted']],
    ['I8 破坏「收档口超限不许静默收」⇒ 行为判据必须转红', 'q8', 'appmod', ['over-limit-silently-taken']],
    ['I9 破坏「认不出来的粘贴不许冲掉台面」⇒ 行为判据必须转红', 'q9', 'appmod', ['no-object-taken', 'failed-ingest-wiped-archive']],
    ['I10 破坏「清台账不许顺手清存档」⇒ 行为判据必须转红', 'q10', 'appmod', ['clear-ledger-wiped-archive']],
    ['I11 破坏「换会话三格全量重取」⇒ 行为判据必须转红', 'q11', 'appmod', ['chat-change-no-archive-reload', 'chat-change-kept-old-archive']],
    ['I12 破坏「抛异常不许读成没记过」⇒ 行为判据必须转红', 'q12', 'appmod', ['storage-throw-read-as-absent']],
    ['I13 破坏「台账挤掉要计数」⇒ 行为判据必须转红', 'q13', 'appmod', ['ledger-drop-unreported']],
    ['I14 破坏「台账本体也不许超上限」⇒ 行为判据必须转红', 'q14', 'appmod', ['ledger-not-trimmed']],
    ['I15 破坏「上限读数取真源」⇒ 行为判据必须转红', 'q15', 'appmod', ['limits-not-by-source']],
    ['I16 破坏「面色相取真源」⇒ 视图判据必须转红', 'q16', 'src', ['face-tone-not-by-source']],
    ['I17 破坏「取不出来画横线」⇒ 视图判据必须转红', 'q17', 'src', ['empty-and-bad-collapsed']],
    ['I18 破坏「类型认不出单独标」⇒ 视图判据必须转红', 'q18', 'src', ['typebook-silently-ignored']],
    ['I19 破坏「页签四个真键」⇒ 视图判据必须转红', 'q19', 'src', ['tab-lost:pipeline']],
    ['I20 破坏「会话键前缀」⇒ 接线判据必须转红', 'q20', 'wire', ['wire-storage-prefix-lost']],
    ['I21 破坏「懒加载分支」⇒ 接线判据必须转红', 'q21', 'wire', ['wire-lazy-branch-lost']],
    ['I22 破坏「挂载」⇒ 接线判据必须转红', 'q22', 'wire', ['wire-shell-field-lost']],
];
for (const [title, key, kind, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
        const damaged = src.split(from).join(to);
        assert.notEqual(damaged, src, '破坏必须真的发生');
        if (kind === 'src') {
            const bad = judgeOf(key, damaged);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judgeOf(key, src), [], '对照：真源码必须干净');
            return;
        }
        if (kind === 'wire') {
            /* ★ 只写副本：写真仓会在并行窗口里被别的套件读到，中断还会留下永久破坏。 */
            const dir = stageWire();
            const real = fs.readFileSync(path.join(dir, rel), 'utf8');
            assert.deepEqual(wireJudgeAt(dir), [], '对照：副本未破坏时必须干净');
            fs.writeFileSync(path.join(dir, rel), damaged);
            const bad = wireJudgeAt(dir);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            fs.writeFileSync(path.join(dir, rel), real);
            assert.deepEqual(wireJudgeAt(dir), [], '对照：还原后副本必须干净');
            assert.deepEqual(wireJudge(), [], '对照：真接线必须干净');
            return;
        }
        const dir = stageTree();
        fs.writeFileSync(path.join(dir, rel), damaged);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href);
        const bad = judgeOf(key, mod);
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        assert.deepEqual(judgeOf(key, (kind === 'data') ? DAT : APP), [], '对照：真模块必须干净');
    });
}

/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    assert.equal(stripComments('a /* 注释里的 diagdesk_archive */ b').indexOf('diagdesk_archive'), -1, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 diagdesk_archive' + NL + 'b').indexOf('diagdesk_archive'), -1, '行注释必须剥掉');
    assert.ok(stripComments('const s = ' + Q + 'diagdesk_archive' + Q + ';').indexOf('diagdesk_archive') >= 0, '字符串里的同形文本必须留住');
    for (const rel of [DD_DATA, DD_APP, DD_VIEW]) {
        const src = read(rel) + NL + 'const SENTINEL_TAIL = 1;' + NL;
        assert.ok(stripComments(src).trimEnd().endsWith('const SENTINEL_TAIL = 1;'),
            rel + ' 必须能让剥器复位（否则说明代码里有裸引号骗住了状态机）');
    }
});
test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, key + ' 的锚点必须恰中 1 次');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).indexOf(from) >= 0, key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3470k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});
test('J3 主线三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [DD_DATA, DD_APP, DD_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' 必须语法正确：' + (r2.stderr || '').split(NL)[0]);
    }
});
test('J4 十一道静态门必须在场（含本版缺陷所属的那几道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts.check.includes(g), 'check 链必须含 ' + g + ' 门');
    }
});
test('J5 判据两向自证：真模块上每一条行为判据都必须干净（且真的会跑）', () => {
    assert.deepEqual(dataProblems(DAT), [], '数据层判据在真模块上必须干净');
    assert.deepEqual(appFaceProblems(APP), []);
    assert.deepEqual(appIngestProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appLedgerProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(viewFaceProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewSplitProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewActProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewTextProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewTabProblems(read(DD_VIEW)), []);
    assert.deepEqual(viewScanProblems(read(DD_VIEW)), []);
    assert.deepEqual(dataKeyProblems(read(DD_DATA)), []);
    assert.deepEqual(seamProblems(THREE), []);
    assert.deepEqual(wireJudge(), []);
});
test('J6 被审代码的字符纪律：不许反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [DD_DATA, DD_APP, DD_VIEW]) {
        const src = read(rel);
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        assert.equal(src.indexOf(String.fromCharCode(96)) >= 0, false, rel + ' 不许出现反引号');
    }
});
test('J7 八个收录失败因在数据层是真源，App 的文案表按真源键取（不手抄一份八键）', () => {
    const dCode = stripComments(read(DD_DATA));
    const aCode = stripComments(read(DD_APP));
    assert.ok(dCode.indexOf('export const DD_INTAKE_WHYS') >= 0, '数据层必须有八因真源');
    assert.ok(aCode.indexOf('DD_INTAKE_WHYS') >= 0, 'App 必须按真源键取文案');
    assert.ok(aCode.indexOf('export const DD_INTAKE_WHYS') < 0, 'App 不许自己再声明一份八因');
});
test('J8 三条会话键在 App 里各只有一个真源（判据不许手抄键名）', () => {
    const aCode = stripComments(read(DD_APP));
    for (const k of ['diagdesk_archive', 'diagdesk_draft', 'diagdesk_ledger']) {
        assert.equal(aCode.split(Q + k + Q).length - 1, 1, k + ' 只在声明处出现一次');
    }
});
test('J9 数据层导出的真源表都真的被读到（零消费导出不许留）', () => {
    const aCode = stripComments(read(DD_APP));
    for (const t of ['DD_STATUSES', 'DD_STATUS_TEXT', 'DD_DELTAS', 'DD_DELTA_TEXT', 'DD_FLOW',
        'DD_FLOW_TEXT', 'DD_FIELDS', 'DD_MIGRATIONS', 'DD_ACTIONS', 'DD_ACTION_TEXT',
        'DD_VERDICTS', 'DD_INTAKE_WHYS', 'typeInBook']) {
        assert.ok(aCode.indexOf(t) >= 0, t + ' 必须被 App 层真消费');
    }
});

/* ══════════════════════ K — 版本与交棒 ══════════════════════ */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 47),
        '本套件成立于 RubyPhone 3.47.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes('const ST_PHONE_VERSION = ' + Q + man.version + Q), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含本版号');
    const items = rec.items || rec.changes;
    for (const it of items) assert.ok(src.includes(JSON.stringify(it)), '公告块必须与条目逐字同源');
});
test('K2 交棒必须指向本件自己那一版的真实现状（钉自己的条目，不钉公告）', () => {
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.47.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('诊断案头'), 'v3.47.0 条目必须自述本件名');
    assert.ok(text.includes('preparation-diagnostic.js'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('state_migration.js'), '交棒必须写到第二片源文件');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
});
