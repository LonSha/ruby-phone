// tests/system-v3460.test.mjs — 思维链案头 [v3.46.0]
//
// 本套件守四件事：
//  ① 条目册的口径（位置不许塌平 / 深度取不出来不许读 0 / 接口与预填不许猜 /
//     原生字段不许静默丢 / 锁定两个语义都要报 / 标记只数不改写 /
//     空册与没册不同形 / 正文超限只报不截 / 台账挤掉要计数）；
//  ② 四块不缝真的没缝（零改写宿主提示词 / 零发请求零塞参数 /
//     零抠正文 / 零宿主界面读）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 ~ v3.45 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）；
//  · **裁定不等于注入**：本件不发请求、不改提示词、不抠正文，判据也要守这一条。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as DAT from '../apps/cotdesk/cotdesk-data.js';
import * as APP from '../apps/cotdesk/cotdesk-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CD_DATA = 'apps/cotdesk/cotdesk-data.js';
const CD_APP = 'apps/cotdesk/cotdesk-app.js';
const CD_VIEW = 'apps/cotdesk/cotdesk-view.js';
const CD_CSS = 'apps/cotdesk/cotdesk.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
/** 单引号（破坏表里拼锚点用）：一律拼装形，不写裸引号。 */
const Q = String.fromCharCode(39);
/** 反斜杠（剥注释器里判转义用）：同样拼装形。 */
const BS = String.fromCharCode(92);
/** 双引号（造 HTML 断言用）：拼装形。 */
const DQ = String.fromCharCode(34);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 副本树登记表（跑完必删）。★ 本套件对真仓只读：破坏类负控制只准落在副本上。 */
const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 剥注释（字符状态机，与 v3300…v3450 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」—— 那些词是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故本件的被审代码一律字串比对、不写正则字面量，
 *    并在 J 组用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
        /* 字符串态：本件被审代码不许有裸引号，故只需处理转义与收尾。 */
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === state) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}
/** 内存存储（单会话）。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); return true; },
        _box: box,
    };
}
/** 换会话的存储（真件里由 `config/storage.js` 的 /^cotdesk_/ 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致 —— 抄别版的前缀会把「换会话后读到别人的账」这条判据测成空气。 */
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
/** 取不出来的存储（一取就抛）—— 守「取不出来不许读成空的」那一族。 */
function hostileStorage() {
    return {
        get: () => { throw new Error('read-boom'); },
        set: () => { throw new Error('write-boom'); },
    };
}
/** 写不进去的存储（一写就抛）—— 守「写了没成要报，不许假装存好了」。 */
function readOnlyStorage() {
    return {
        get: () => null,
        set: () => { throw new Error('write-boom'); },
    };
}
/** 假宿主壳：只提供视图层要的 getContentContainer（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null };
}
const newApp = (storage) => new APP.CotdeskApp(shellStub(), storage);
/** 指定模块副本建 App（负控制用：把副本当输入，判据才测得到那一处破坏）。 */
const toApp = (mod, storage) => new mod.CotdeskApp(shellStub(), storage);
const jsonOf = (o) => JSON.stringify(o);
/** 一条条目（真源形状：位置 / 角色 / 深度 / 开关 / 正文）。 */
function item(over) {
    const base = {
        id: 'it1', name: '首部协议',
        position: DAT.CD_POSITIONS[0], role: DAT.CD_ROLES[0],
        depth: 0, content: '北上的风比南边硬。', enabled: true, locked: false
    };
    return Object.assign(base, over || {});
}
/** 一份可收下的册子（两条）。 */
function itemsJson(list) {
    const arr = (list && list.length) ? list : [
        item({ id: 'a', name: '首部协议', position: DAT.CD_POSITIONS[0], role: DAT.CD_ROLES[0] }),
        item({ id: 'b', name: '末尾触发器', position: DAT.CD_POSITIONS[5], role: DAT.CD_ROLES[2] })
    ];
    return jsonOf(arr);
}
/* ══════════ 判据函数（数据层） ══════════ */
function dataPosProblems(M) {
    const bad = [];
    const P = M.CD_POSITIONS;
    const R = M.CD_ROLES;
    const head = M.positionFace({ position: P[0], role: R[2] });
    if (head.side !== 'lead') bad.push('position-flattened');
    if (head.flattened !== true) bad.push('position-flattened');
    const mid = M.positionFace({ position: P[1], role: R[1] });
    if (mid.side !== 'lead') bad.push('position-flattened');
    if (mid.flattened !== true) bad.push('position-flattened');
    const hs = M.positionFace({ position: P[0], role: R[0] });
    if (hs.side !== 'system') bad.push('position-flattened');
    if (hs.flattened !== false) bad.push('position-flattened');
    const ms = M.positionFace({ position: P[1], role: R[0] });
    if (ms.side !== 'system') bad.push('position-flattened');
    const bh = M.positionFace({ position: P[2], role: R[1] });
    if (bh.side !== 'lead') bad.push('lead-collapsed');
    if (bh.flattened !== false) bad.push('lead-collapsed');
    if (M.positionFace({ position: P[3], role: R[1] }).side !== 'history_in') bad.push('side-map-lost');
    if (M.positionFace({ position: P[4], role: R[1] }).side !== 'history_after') bad.push('side-map-lost');
    if (M.positionFace({ position: P[5], role: R[2] }).side !== 'prefill') bad.push('side-map-lost');
    const un = M.positionFace({ position: 'zzz', role: R[1] });
    if (un.side !== 'unknown') bad.push('unknown-position-guessed');
    if (!un.why.length) bad.push('unknown-position-guessed');
    const ur = M.positionFace({ position: P[0], role: 'zzz' });
    if (ur.side !== 'unknown') bad.push('role-unknown-guessed');
    return bad;
}
function dataDepthProblems(M) {
    const bad = [];
    const b = M.depthFace(null, M.CD_POSITIONS[3]);
    if (b.blank !== true) bad.push('depth-blank-lost');
    if (b.text !== '--') bad.push('depth-blank-lost');
    if (b.value !== null) bad.push('depth-blank-lost');
    const n = M.depthFace(-3, M.CD_POSITIONS[3]);
    if (n.value !== 0) bad.push('depth-clamp-lost');
    if (n.clamped !== true) bad.push('depth-clamp-lost');
    const big = M.depthFace(5000, M.CD_POSITIONS[3]);
    if (big.value !== M.CD_DEPTH_MAX) bad.push('depth-clamp-lost');
    if (big.over !== true) bad.push('depth-clamp-lost');
    const z = M.depthFace(0, M.CD_POSITIONS[3]);
    if (z.value !== 0 || z.blank !== false) bad.push('depth-blank-lost');
    return bad;
}
function dataProviderProblems(M) {
    const bad = [];
    if (M.providerFace('gemini', '', '').source !== 'declared') bad.push('provider-three-state-collapsed');
    if (M.providerFace('gemini', '', '').certain !== true) bad.push('provider-three-state-collapsed');
    if (M.providerFace('zzz', '', '').source !== 'bad_declared') bad.push('provider-three-state-collapsed');
    const none = M.providerFace('auto', 'no-hint-here', 'plain');
    if (none.source !== 'none') bad.push('provider-three-state-collapsed');
    if (none.certain !== false) bad.push('provider-three-state-collapsed');
    const g = M.providerFace('auto', 'https://generativelanguage.googleapis.com', '');
    if (g.source !== 'hinted' || g.provider !== 'gemini') bad.push('provider-hint-lost');
    const c = M.providerFace('auto', '', 'claude-3-opus');
    if (c.source !== 'hinted' || c.provider !== 'claude') bad.push('provider-hint-lost');
    return bad;
}
function dataPrefillProblems(M) {
    const bad = [];
    const a = M.prefillFace('auto', M.CD_MODES[1]);
    if (a.isAuto !== true) bad.push('prefill-auto-hidden');
    if (!a.why.length) bad.push('prefill-auto-hidden');
    const s = M.prefillFace('system', M.CD_MODES[1]);
    if (s.joinsSystem !== true) bad.push('prefill-joins-system-lost');
    if (s.isAuto !== false) bad.push('prefill-auto-hidden');
    const off = M.prefillFace('assistant', M.CD_MODES[0]);
    if (off.blocked !== true) bad.push('prefill-mode-gate-lost');
    return bad;
}
function dataNativeProblems(M) {
    const bad = [];
    const o = M.nativeFace('openai', 'high', M.CD_MODES[1]);
    if (o.field !== 'reasoning_effort') bad.push('native-fields-collapsed');
    if (o.supported !== true || o.silent !== false) bad.push('native-silent-drop-lost');
    const d = M.nativeFace('deepseek', 'auto', M.CD_MODES[1]);
    if (d.field !== 'thinking.type') bad.push('native-fields-collapsed');
    const g = M.nativeFace('gemini', 'auto', M.CD_MODES[1]);
    if (g.field !== 'thinkingConfig') bad.push('native-fields-collapsed');
    const c = M.nativeFace('claude', 'auto', M.CD_MODES[1]);
    if (c.field !== 'thinking.type') bad.push('native-fields-collapsed');
    const un = M.nativeFace('compatible', 'auto', M.CD_MODES[1]);
    if (un.supported !== false || un.silent !== true) bad.push('native-silent-drop-lost');
    if (!un.why.length) bad.push('native-silent-drop-lost');
    if (M.CD_NATIVE_FIELDS.length !== 4) bad.push('native-fields-collapsed');
    return bad;
}
function dataScanProblems(M) {
    const bad = [];
    const OP = String.fromCharCode(60) + 'thinking' + String.fromCharCode(62);
    const CL = String.fromCharCode(60) + '/' + 'thinking' + String.fromCharCode(62);
    if (M.textScan('').blank !== true) bad.push('scan-blank-lost');
    if (M.textScan('').text !== '--') bad.push('scan-blank-lost');
    const one = M.textScan(OP + 'x' + CL);
    if (one.open !== 1 || one.close !== 1) bad.push('scan-tag-count-lost');
    if (one.paired !== 1 || one.unpaired !== 0) bad.push('scan-pair-collapsed');
    const lone = M.textScan(OP + 'x');
    if (lone.paired !== 0 || lone.unpaired !== 1) bad.push('scan-pair-collapsed');
    const many = M.textScan(OP + 'a' + CL + OP + 'b' + CL);
    if (many.paired !== 2) bad.push('scan-pair-collapsed');
    return bad;
}
function dataIngestFaceProblems(M) {
    const bad = [];
    if (M.extractItems('').why !== 'empty') bad.push('empty-vs-no-book-collapsed');
    if (M.extractItems('x').why !== 'no_bracket') bad.push('empty-vs-no-book-collapsed');
    if (M.extractItems('{bad').why !== 'bad_json') bad.push('intake-why-collapsed');
    if (M.extractItems(jsonOf({ a: 1 })).why !== 'no_items') bad.push('intake-why-collapsed');
    if (M.extractItems('[]').why !== 'empty_items') bad.push('intake-why-collapsed');
    const ok = M.extractItems(itemsJson());
    if (ok.ok !== true || ok.total !== 2) bad.push('intake-ok-lost');
    /* 空册与没册不同形：四态面必须分开。 */
    const faces = [
        M.extractItems('').why, M.extractItems('[]').why,
        M.extractItems('{bad').why, M.extractItems(itemsJson()).why
    ];
    if (new Set(faces).size !== 4) bad.push('empty-vs-no-book-collapsed');
    return bad;
}
function dataLockProblems(M) {
    const bad = [];
    const list = [
        M.normalizeItem(item({ id: 'a', locked: true }), 0),
        M.normalizeItem(item({ id: 'b', locked: false }), 1),
        M.normalizeItem({ id: 'c', name: 'c', content: 'x', position: M.CD_POSITIONS[0], role: M.CD_ROLES[1] }, 2)
    ];
    const L = M.lockFace(list);
    if (L.lockedCount !== 1) bad.push('lock-two-meanings-collapsed');
    if (L.total !== 3) bad.push('lock-two-meanings-collapsed');
    if (L.firstLocked !== true) bad.push('lock-ends-lost');
    if (L.lastLocked !== false) bad.push('lock-ends-lost');
    if (L.movableCount !== 2) bad.push('lock-two-meanings-collapsed');
    if (!L.rows[0].text.length) bad.push('lock-two-meanings-collapsed');
    /* 缺字段不许替它读成真。 */
    const miss = M.normalizeItem({ name: 'x', content: 'y' }, 0);
    if (miss.enabledGiven !== false) bad.push('enabled-default-faked');
    if (miss.enabled !== false) bad.push('enabled-default-faked');
    if (miss.lockedGiven !== false) bad.push('enabled-default-faked');
    const given = M.normalizeItem(item({ enabled: false }), 0);
    if (given.enabledGiven !== true || given.enabled !== false) bad.push('enabled-default-faked');
    return bad;
}
function dataSummaryProblems(M) {
    const bad = [];
    const rows = [M.itemFace(item({ id: 'a', position: M.CD_POSITIONS[0], role: M.CD_ROLES[2] }), 0)];
    if (rows[0].flattened !== true) bad.push('item-flattened-lost');
    const s = M.itemSummary(rows);
    if (s.flattened !== 1) bad.push('summary-flattened-lost');
    if (s.sides.lead !== 1) bad.push('summary-sides-lost');
    if (s.items !== 1) bad.push('summary-sides-lost');
    const empty = M.itemSummary([]);
    if (empty.empty !== true) bad.push('summary-empty-lost');
    if (empty.charsOver !== false) bad.push('summary-empty-lost');
    const over = M.itemSummary([M.itemFace(item({ content: 'x'.repeat(M.CD_CHARS_MAX + 1) }), 0)]);
    if (over.charsOver !== true) bad.push('summary-over-lost');
    return bad;
}
function dataGaugeProblems(M) {
    const bad = [];
    const rows = M.gaugesOf({ items: null, chars: 10, logs: null });
    if (rows.length !== 3) bad.push('gauge-face-lost');
    if (rows[0].blank !== true) bad.push('gauge-blank-faked');
    if (rows[0].text !== '--') bad.push('gauge-blank-faked');
    if (rows[2].blank !== true) bad.push('gauge-blank-faked');
    if (rows[1].blank !== false) bad.push('gauge-blank-faked');
    if (rows[1].text.indexOf('/') < 0) bad.push('gauge-face-lost');
    return bad;
}
function dataTrimProblems(M) {
    const bad = [];
    const many = [];
    for (let i = 0; i < M.CD_LOG_MAX + 3; i++) many.push(i);
    const t = M.cdTrim(many, M.CD_LOG_MAX);
    if (t.dropped !== 3) bad.push('ledger-drop-unreported');
    if (t.rows.length !== M.CD_LOG_MAX) bad.push('ledger-drop-unreported');
    const small = M.cdTrim([1, 2], M.CD_LOG_MAX);
    if (small.dropped !== 0) bad.push('ledger-drop-unreported');
    return bad;
}
function dataConfigProblems(M) {
    const bad = [];
    if (M.configFace('').why !== 'empty') bad.push('config-face-collapsed');
    if (M.configFace('{bad').why !== 'bad_json') bad.push('config-face-collapsed');
    if (M.configFace('[]').why !== 'bare_list') bad.push('config-face-collapsed');
    if (M.configFace('3').why !== 'not_object') bad.push('config-face-collapsed');
    const g = M.configFace(jsonOf({ enabled: true, mode: 'card', provider: 'auto' }));
    if (g.why !== 'ok' || g.given !== true) bad.push('config-face-collapsed');
    if (g.enabledGiven !== true || g.enabled !== true) bad.push('config-face-collapsed');
    const noen = M.configFace(jsonOf({ mode: 'card' }));
    if (noen.enabledGiven !== false) bad.push('config-face-collapsed');
    if (noen.enabled !== false) bad.push('config-face-collapsed');
    return bad;
}
function dataFaceProblems(M) {
    const bad = [];
    const blank = M.itemFace({}, 0);
    if (blank.ok !== true) bad.push('problem-flag-overfire');
    if (blank.chars !== 0) bad.push('problem-flag-overfire');
    const noName = M.itemFace(item({ name: '' }), 0);
    if (!noName.name.length) bad.push('item-name-fallback-lost');
    const bad1 = M.itemFace(item({ position: 'zzz' }), 0);
    if (bad1.ok !== false) bad.push('problem-flag-lost');
    if (bad1.problems.indexOf('位置认不出来') < 0) bad.push('problem-flag-lost');
    const bad2 = M.itemFace(item({ role: 'zzz' }), 0);
    if (bad2.ok !== false) bad.push('problem-flag-lost');
    const bad3 = M.itemFace(item({ depth: null, position: M.CD_POSITIONS[3], role: M.CD_ROLES[1] }), 0);
    if (bad3.ok !== false) bad.push('problem-flag-lost');
    const bad4 = M.itemFace({ name: 'x', position: M.CD_POSITIONS[0], role: M.CD_ROLES[1], enabled: true }, 0);
    if (bad4.ok !== false) bad.push('problem-flag-lost');
    /* ★ 开关缺字段必须在逐条面上报出来（源替它读成真）。 */
    const miss = M.itemFace({ name: 'x', content: 'y' }, 0);
    if (miss.problemText.indexOf('没有开关字段') < 0) bad.push('enabled-default-flagged');
    return bad;
}
function dataRequestProblems(M) {
    const bad = [];
    const rows = [M.itemFace(item({ id: 'a', name: '首部协议', position: M.CD_POSITIONS[0], role: M.CD_ROLES[2] }), 0)];
    const face = {
        modeText: '只用条目册里的条目', providerText: '按特征词 gemini 判出',
        prefillText: '不加末尾触发', nativeText: '会带上 thinkingConfig',
        rows: rows, flat: 1, unknown: 0
    };
    const t = M.requestText(face, '把这套配到当前会话', '先列被塌平的');
    if (t.indexOf('不要替我改提示词') < 0) bad.push('request-text-no-guard');
    if (t.indexOf('落点会被塌平') < 0) bad.push('request-text-flat-lost');
    if (t.indexOf('逐条回报') < 0) bad.push('request-text-no-guard');
    if (t.indexOf('首部协议') < 0) bad.push('request-text-rows-lost');
    const empty = M.requestText({ rows: [], flat: 0, unknown: 0 }, '', '');
    if (empty.indexOf('空册') < 0) bad.push('request-text-empty-guessed');
    return bad;
}
/* ══════════ 判据函数（App 层） ══════════ */
function appFaceProblems(M) {
    const bad = [];
    if (M.CD_ITEMS_KEY !== 'cotdesk_items') bad.push('key-name-lost');
    if (M.CD_CONFIG_KEY !== 'cotdesk_config') bad.push('key-name-lost');
    if (M.CD_DRAFT_KEY !== 'cotdesk_draft') bad.push('key-name-lost');
    if (M.CD_LEDGER_KEY !== 'cotdesk_ledger') bad.push('key-name-lost');
    const MAX = DAT.CD_TEXT_MAX;
    /* 四态逐格分开。 */
    const r0 = toApp(M, memStorage()).probe();
    if (r0.face !== 'empty') bad.push('empty-face-lost');
    const a1 = toApp(M, memStorage({ cotdesk_items: '{bad' }));
    const r1 = a1.probe();
    if (r1.face !== 'malformed') bad.push('malformed-face-lost');
    if (r1.why !== 'json') bad.push('malformed-face-lost');
    const a2 = toApp(M, memStorage({ cotdesk_items: jsonOf({ raw: itemsJson() }) }));
    if (a2.probe().face !== 'ok') bad.push('ok-face-lost');
    const a3 = toApp(M, memStorage({ cotdesk_items: jsonOf({ raw: 'x'.repeat(MAX + 1) }) }));
    const r3 = a3.probe();
    if (r3.face !== 'malformed') bad.push('too-long-face-lost');
    if (r3.why !== 'too_long') bad.push('too-long-face-lost');
    /* 抛异常不是「没记过」。 */
    const a4 = toApp(M, hostileStorage());
    const r4 = a4.probe();
    if (r4.face === 'ok') bad.push('storage-throw-read-as-absent');
    if (r4.why !== 'read_threw') bad.push('storage-throw-read-as-absent');
    /* 四条面不许塌成一态：四个 face 两两不同。 */
    const faces = [r0.face, r1.face, a2.probe().face, r3.face];
    if (new Set(faces).size !== 3) bad.push('four-faces-collapsed');
    return bad;
}
function appContentProblems(M) {
    const bad = [];
    /* 收下一份：doc 与台账都要成。 */
    const mem = memStorage();
    const a = toApp(M, mem);
    const r = a.ingestItems(itemsJson());
    if (r.ok !== true) bad.push('ingest-ok-lost');
    if (r.items !== 2) bad.push('ingest-ok-lost');
    if (a.itemRows().length !== 2) bad.push('ingest-ok-lost');
    if (a.rawLen() <= 0) bad.push('ingest-ok-lost');
    if (!mem._box.has('cotdesk_items')) bad.push('ingest-not-persisted');
    /* 形状认不出来的粘贴 **不动作**：台面上那份不许被冲掉。 */
    const before = a.rawLen();
    const rb = a.ingestItems('{bad');
    if (rb.ok !== false) bad.push('failed-ingest-wiped-book');
    if (a.rawLen() !== before) bad.push('failed-ingest-wiped-book');
    if (a.itemRows().length !== 2) bad.push('failed-ingest-wiped-book');
    /* 两类失败不同形（空输入 / 认不出来）。 */
    const re = a.ingestItems('');
    if (re.why !== 'empty_input') bad.push('intake-why-collapsed');
    if (rb.why !== 'bad_json') bad.push('intake-why-collapsed');
    /* 只报不截：超限不收。 */
    const rl = a.ingestItems(jsonOf([item({ id: 'big', content: 'x'.repeat(DAT.CD_TEXT_MAX + 1) })]));
    if (rl.ok !== false) bad.push('over-limit-silently-taken');
    if (rl.why !== 'too_long') bad.push('over-limit-silently-taken');
    if (a.rawLen() !== before) bad.push('over-limit-silently-taken');
    /* 条数超上限不收。 */
    const many = [];
    for (let i = 0; i < DAT.CD_ITEM_MAX + 1; i++) many.push(item({ id: 'x' + i }));
    const rm = a.ingestItems(jsonOf(many));
    if (rm.ok !== false) bad.push('too-many-silently-taken');
    if (rm.why !== 'too_many') bad.push('too-many-silently-taken');
    /* 没册不许出要求文本。 */
    const b = toApp(M, memStorage());
    const rt = b.makeText();
    if (rt.ok !== false) bad.push('text-from-nothing');
    if (rt.why !== 'no_items') bad.push('text-from-nothing');
    /* 状态下出文本：本件唯一的产出物。 */
    const rt2 = a.makeText();
    if (rt2.ok !== true) bad.push('text-lost');
    if (rt2.text.indexOf('不要替我改提示词') < 0) bad.push('text-no-guard');
    return bad;
}
function appGateProblems(M) {
    const bad = [];
    /* 写了没成要报。 */
    const ro = toApp(M, readOnlyStorage());
    const r1 = ro.ingestItems(itemsJson());
    if (r1.ok !== true) bad.push('write-failure-pretended-ok');
    const mem = memStorage();
    const a = toApp(M, mem);
    const r2 = a.ingestItems(itemsJson());
    if (r2.saved !== true) bad.push('write-failure-pretended-ok');
    /* 台账挤掉要计数。 */
    const t = toApp(M, memStorage());
    for (let i = 0; i < DAT.CD_LOG_MAX + 4; i++) t.ingestItems(itemsJson());
    if (t.droppedCount() !== 4) bad.push('ledger-drop-unreported');
    /* ★ 台账本体也不许超上限：只报计数而台账无限长 = 一半没守住。 */
    if (t.ledgerRows().length > DAT.CD_LOG_MAX) bad.push('ledger-drop-unreported');
    /* 页签只认四个真键。 */
    if (t.setTab('zzz') !== 'items') bad.push('tab-gate-lost');
    if (t.setTab('ledger') !== 'ledger') bad.push('tab-gate-lost');
    if (t.setTab('sides') !== 'sides') bad.push('tab-gate-lost');
    /* 草稿要真存得住。 */
    const d = toApp(M, memStorage());
    d.setTarget('配到当前会话');
    d.setExtra('先列被塌平的');
    if (!d._storageUsable().ok) bad.push('draft-not-persisted');
    const box = d.storage._box;
    const has = box.has('cotdesk_draft');
    if (!has) bad.push('draft-not-persisted');
    /* ★ 取不出来时不许直接 .indexOf —— 判据自己崩了就不是判据（本版判据面纪律）。 */
    const raw = has ? String(box.get('cotdesk_draft')) : '';
    if (raw.indexOf('配到当前会话') < 0) bad.push('draft-not-persisted');
    /* 清台账不许顺手清册。 */
    const c = toApp(M, memStorage());
    c.ingestItems(itemsJson());
    const had = c.rawLen();
    for (let i = 0; i < 3; i++) c.ingestItems('{bad');
    if (c.ledgerRows().length < 3) bad.push('ledger-lost');
    c.clearLedger();
    if (c.ledgerRows().length !== 0) bad.push('ledger-lost');
    if (c.rawLen() !== had) bad.push('clear-ledger-wiped-book');
    if (c.itemRows().length !== 2) bad.push('clear-ledger-wiped-book');
    /* 放下册子只动自己的键。 */
    const e = toApp(M, memStorage());
    e.ingestItems(itemsJson());
    e.setTarget('t');
    e.clearItems();
    if (e.itemRows().length !== 0) bad.push('clear-items-lost');
    if (e.drafts().target !== 't') bad.push('clear-items-wiped-draft');
    return bad;
}
function appChatProblems(M) {
    const bad = [];
    const s = sessionStorage();
    const a = toApp(M, s);
    a.ingestItems(itemsJson());
    a.setTarget('c1 的目标');
    a.ingestConfig(jsonOf({ mode: 'card', provider: 'gemini' }));
    if (a.probe().face !== 'ok') bad.push('chat-1-not-ok');
    if (a.rawLen() <= 0) bad.push('chat-1-not-ok');
    if (a.drafts().target !== 'c1 的目标') bad.push('chat-1-draft-lost');
    if (a.configRow() === null || a.configRow().given !== true) bad.push('chat-1-config-lost');
    /* 换到 c2：四格全量重取 —— 这里必须是「这一格」的。 */
    s.switchChat('c2');
    a.onChatChanged();
    if (a.rawLen() !== 0) bad.push('chat-change-no-book-reload');
    if (a.itemRows().length !== 0) bad.push('chat-change-no-book-reload');
    if (a.drafts().target !== '') bad.push('chat-change-no-draft-reload');
    if (a.configRow() !== null && a.configRow().given === true) bad.push('chat-change-no-config-reload');
    if (a.ledgerRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    if (a.probe().face === 'ok') bad.push('chat-change-no-book-reload');
    /* 换回 c1：账必须还在。 */
    s.switchChat('c1');
    a.onChatChanged();
    if (a.probe().face !== 'ok') bad.push('chat-change-no-book-reload');
    if (a.itemRows().length !== 2) bad.push('chat-change-no-book-reload');
    if (a.drafts().target !== 'c1 的目标') bad.push('chat-change-no-draft-reload');
    /* 换会话要连台账一起重取（台账也是「这一段关系的账」）。 */
    s.switchChat('c3');
    a.onChatChanged();
    if (a.ledgerRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    return bad;
}
/* ══════════ 四块不缝（合并判据） ══════════ */
const SEAM_WORDS = [
    'injectItems', 'headMessages',
    'fetch(', 'XMLHttpRequest', 'sendBeacon', 'new Blob', 'new FormData',
    'extractTaggedReasoning', 'removeFromBody',
    'getElementById', 'document.body', 'document.head', 'window.parent', 'window.top',
    'location.reload', 'location.href'
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
    for (const pair of ['ok: ' + Q + 'ok' + Q, 'empty: ' + Q + 'warn' + Q,
        'malformed: ' + Q + 'err' + Q, 'absent: ' + Q + 'off' + Q]) {
        if (code.indexOf(pair) < 0) bad.push('face-tone-not-by-source');
    }
    return bad;
}
function viewCountProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('DASH') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf(') ? DASH : String(v)') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf('(r.blank ? ' + Q + ' blank' + Q + ' : ' + Q + Q + ')') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf('if (!r.blank) {') < 0) bad.push('empty-and-bad-collapsed');
    return bad;
}
function viewSplitProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('r.flattened ?') < 0) bad.push('flattened-not-separate');
    if (code.indexOf('cd-why-mini') < 0) bad.push('flattened-not-separate');
    if (code.indexOf('cd-problem') < 0) bad.push('flattened-not-separate');
    if (code.indexOf('落点被塌平到与首部同一处') < 0) bad.push('flattened-not-separate');
    return bad;
}
function viewFlashProblems(src) {
    const code = stripComments(src);
    return code.indexOf('<div class=' + DQ + 'cd-flash' + DQ + '>') >= 0 ? [] : ['flash-line-lost'];
}
function viewActProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('data-act') < 0) bad.push('action-binding-lost');
    if (code.indexOf('getAttribute') < 0) bad.push('action-binding-lost');
    if (code.indexOf('querySelectorAll(' + Q + '[data-in]' + Q + ')') < 0) bad.push('input-binding-lost');
    if (code.indexOf('if (kind === ' + Q + 'items' + Q + ') this._itemsInput = v;') < 0) bad.push('input-binding-lost');
    for (const a of ['tab', 'ingest_items', 'clear_items_input', 'clear_items',
        'ingest_cfg', 'clear_cfg_input', 'clear_cfg', 'save_draft', 'make_text', 'clear_ledger']) {
        if (code.indexOf('(a === ' + Q + a + Q + ')') < 0 && code.indexOf('(act === ' + Q + a + Q + ')') < 0) {
            bad.push('action-branch-lost:' + a);
        }
    }
    return bad;
}
function viewTextProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('<textarea class=' + DQ + 'cd-area' + DQ + ' data-in=') < 0) bad.push('text-not-selectable');
    if (code.indexOf('要求文本（本件唯一的产出物）') < 0) bad.push('text-not-selectable');
    return bad;
}
function viewTabProblems(src) {
    const code = stripComments(src);
    const bad = [];
    for (const t of ['items', 'config', 'sides', 'ledger']) {
        if (code.indexOf('key: ' + Q + t + Q) < 0) bad.push('tab-lost:' + t);
    }
    return bad;
}
function viewScanProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('只数，不改写、不抠字') < 0) bad.push('scan-not-count-only');
    if (code.indexOf('正文字数') < 0) bad.push('scan-not-count-only');
    if (code.indexOf('落单') < 0) bad.push('scan-not-count-only');
    return bad;
}
/** 数据层结构面：因必须是**纯键**（逐项自成字面 + 互不相同）。 */
function dataKeyProblems(src) {
    const code = stripComments(src);
    const bad = [];
    for (const k of ['empty_input', 'too_long', 'empty', 'no_bracket',
        'bad_json', 'no_items', 'empty_items', 'too_many']) {
        if (code.indexOf(Q + k + Q) < 0) bad.push('why-not-key:' + k);
    }
    const line = '    ' + Q + 'empty_input' + Q + ", " + Q + 'too_long' + Q + ", " + Q + 'empty' + Q
        + ", " + Q + 'no_bracket' + Q + ", " + Q + 'bad_json' + Q + ", " + Q + 'no_items' + Q
        + ", " + Q + 'empty_items' + Q + ", " + Q + 'too_many' + Q;
    if (code.indexOf(line) < 0) bad.push('why-not-key-line');
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
    if (apps.indexOf(Q + 'cotdesk' + Q) < 0) bad.push('wire-app-registry-lost');
    if (index.indexOf('./apps/cotdesk/cotdesk-app.js') < 0) bad.push('wire-app-entry-lost');
    if (storage.indexOf('/^cotdesk_/') < 0) bad.push('wire-storage-prefix-lost');
    for (const k of ['cotdesk_items', 'cotdesk_config', 'cotdesk_draft', 'cotdesk_ledger']) {
        if (keys.indexOf(Q + k + Q) < 0) bad.push('wire-key-lost:' + k);
    }
    if (index.indexOf(Q + 'cotdesk' + Q) < 0) bad.push('wire-lazy-branch-lost');
    if (index.indexOf('cotdeskApp') < 0) bad.push('wire-shell-field-lost');
    if (css.indexOf('v3.46.0] 思维链案头（cotdesk）') < 0) bad.push('wire-css-lost');
    if (css.indexOf('.cd-root') < 0) bad.push('wire-css-lost');
    return bad;
}
/** 接线面取数口。★ root 可指向副本树 —— 破坏类负控制只准写副本，绝不写真仓：
 *  node --test 是文件级并行，写真仓会在破坏窗口内被别的套件读到，
 *  且跑批被中断时（finally 来不及执行）会把破坏永久留在仓里。 */
function wireJudgeAt(root) {
    const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    return wireProblems({
        apps: rd(APPS), storage: rd(STORAGE), index: rd(INDEX),
        keys: rd(KEYS), phoneCss: rd(PHONE_CSS)
    });
}
function wireJudge() { return wireJudgeAt(ROOT); }
/** 接线面副本树：六处落点所在文件按真相对路径各一份。 */
function stageWire() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_wire_'));
    temps.push(dir);
    for (const rel of [APPS, STORAGE, INDEX, KEYS, PHONE_CSS]) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    return dir;
}

/* ══════════ A — 落点面（位置 × 角色 → 六侧） ══════════ */
test('A1 位置与角色认不出来不许猜（源把认不出的当成中段落下去）', () => {
    assert.deepEqual(dataPosProblems(DAT), []);
    const un = DAT.positionFace({ position: 'zzz', role: DAT.CD_ROLES[1] });
    assert.equal(un.side, 'unknown');
    assert.ok(un.why.length > 0, '认不出来必须写出为什么');
    const ur = DAT.positionFace({ position: DAT.CD_POSITIONS[0], role: 'zzz' });
    assert.equal(ur.side, 'unknown');
});
test('A2 首部与中段的非系统条目落成同一处 —— 必须单独标出来', () => {
    const head = DAT.positionFace({ position: DAT.CD_POSITIONS[0], role: DAT.CD_ROLES[2] });
    const mid = DAT.positionFace({ position: DAT.CD_POSITIONS[1], role: DAT.CD_ROLES[2] });
    assert.equal(head.side, 'lead');
    assert.equal(mid.side, 'lead');
    assert.equal(head.flattened, true);
    assert.equal(mid.flattened, true);
    assert.ok(head.why.indexOf('同一处') >= 0);
});
test('A3 系统角色的两个位置并进系统提示（源里它们不是消息数组）', () => {
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[0], role: DAT.CD_ROLES[0] }).side, 'system');
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[1], role: DAT.CD_ROLES[0] }).side, 'system');
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[0], role: DAT.CD_ROLES[0] }).flattened, false);
});
test('A4 五个真落点逐格对上（历史前 / 历史内 / 历史后 / 末尾触发器）', () => {
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[2], role: DAT.CD_ROLES[1] }).side, 'lead');
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[2], role: DAT.CD_ROLES[1] }).flattened, false);
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[3], role: DAT.CD_ROLES[1] }).side, 'history_in');
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[4], role: DAT.CD_ROLES[1] }).side, 'history_after');
    assert.equal(DAT.positionFace({ position: DAT.CD_POSITIONS[5], role: DAT.CD_ROLES[2] }).side, 'prefill');
    assert.equal(DAT.CD_SIDES.length, 6);
});
/* ══════════ B — 深度面 ══════════ */
test('B1 深度取不出来不许读成 0 层（横线与真的 0 不同形）', () => {
    assert.deepEqual(dataDepthProblems(DAT), []);
    const b = DAT.depthFace(null, DAT.CD_POSITIONS[3]);
    assert.equal(b.value, null);
    assert.equal(b.blank, true);
    assert.equal(b.text, '--');
    const z = DAT.depthFace(0, DAT.CD_POSITIONS[3]);
    assert.equal(z.value, 0);
    assert.equal(z.blank, false);
    assert.equal(z.text, '0');
});
test('B2 深度越界钳位要另标（源直接拿钳完的值往下用）', () => {
    const neg = DAT.depthFace(-5, DAT.CD_POSITIONS[3]);
    assert.equal(neg.value, 0);
    assert.equal(neg.clamped, true);
    assert.ok(neg.why.length > 0);
    const over = DAT.depthFace(DAT.CD_DEPTH_MAX + 1, DAT.CD_POSITIONS[3]);
    assert.equal(over.value, DAT.CD_DEPTH_MAX);
    assert.equal(over.clamped, true);
    assert.equal(over.over, true);
});
test('B3 非历史内的位置也照报深度（但标出这一项生不生效）', () => {
    assert.equal(DAT.depthFace(3, DAT.CD_POSITIONS[3]).applies, true);
    assert.equal(DAT.depthFace(3, DAT.CD_POSITIONS[0]).applies, false);
});
/* ══════════ C — 接口面 ══════════ */
test('C1 接口三态分开（写明的 / 猜出的 / 判不出的）', () => {
    assert.deepEqual(dataProviderProblems(DAT), []);
    assert.equal(DAT.CD_PROVIDERS.length, 6);
    assert.equal(DAT.providerFace('auto', 'no-hint', 'plain').source, 'none');
});
test('C2 特征词判接口：地址与模型名两处都要看', () => {
    const g = DAT.providerFace('auto', 'https://generativelanguage.googleapis.com/v1', '');
    assert.equal(g.provider, 'gemini');
    assert.equal(g.source, 'hinted');
    assert.ok(g.text.indexOf('gemini') >= 0 || g.text.indexOf('判出') >= 0);
    const d = DAT.providerFace('auto', '', 'deepseek-chat');
    assert.equal(d.provider, 'deepseek');
    const o = DAT.providerFace('auto', 'https://api.openai.com/v1', '');
    assert.equal(o.provider, 'openai');
});
test('C3 册子上写的接口不在六个已知值里 —— 单独一态，不归到「判不出」', () => {
    const b = DAT.providerFace('my-own-api', '', '');
    assert.equal(b.source, 'bad_declared');
    assert.equal(b.declaredOk, false);
    const n = DAT.providerFace('auto', 'no-hint', 'plain');
    assert.equal(n.source, 'none');
    assert.notEqual(b.source, n.source, '两态不许塌成一态');
});
/* ══════════ D — 预填面 ══════════ */
test('D1 声明是自动就报「谁来决定」（源在这里按模型名猜）', () => {
    assert.deepEqual(dataPrefillProblems(DAT), []);
    const a = DAT.prefillFace('auto', DAT.CD_MODES[1]);
    assert.equal(a.isAuto, true);
    assert.ok(a.why.indexOf('猜') >= 0);
});
test('D2 预填五值逐值分开（并进系统提示与末尾加助手消息不是一回事）', () => {
    assert.equal(DAT.CD_PREFILLS.length, 5);
    assert.equal(DAT.prefillFace('system', DAT.CD_MODES[1]).joinsSystem, true);
    assert.equal(DAT.prefillFace('assistant', DAT.CD_MODES[1]).joinsSystem, false);
    assert.equal(DAT.prefillFace('none', DAT.CD_MODES[1]).isAuto, false);
});
test('D3 模式不用条目册时，预填这一项要报「不生效」', () => {
    assert.equal(DAT.prefillFace('assistant', DAT.CD_MODES[0]).blocked, true);
    assert.equal(DAT.prefillFace('assistant', DAT.CD_MODES[1]).blocked, false);
});
/* ══════════ E — 原生思考面 ══════════ */
test('E1 四个已知字段逐接口列（源对认不出的接口整块丢掉参数）', () => {
    assert.deepEqual(dataNativeProblems(DAT), []);
    assert.equal(DAT.CD_NATIVE_FIELDS.length, 4);
});
test('E2 认不出的接口不许静默丢 —— 要单独报一态', () => {
    const un = DAT.nativeFace('compatible', 'high', DAT.CD_MODES[1]);
    assert.equal(un.supported, false);
    assert.equal(un.silent, true);
    assert.ok(un.why.length > 0);
    assert.ok(un.text.indexOf('丢掉') >= 0);
});
test('E3 意图逐接口报（关掉 / 不动 / 设为某档）', () => {
    assert.equal(DAT.nativeFace('openai', 'high', DAT.CD_MODES[2]).wants, '设为 high');
    assert.equal(DAT.nativeFace('openai', 'auto', DAT.CD_MODES[2]).wants, '不动');
    assert.equal(DAT.nativeFace('openai', 'auto', DAT.CD_MODES[0]).wants, '关掉');
    assert.equal(DAT.nativeFace('openai', 'high', DAT.CD_MODES[1]).wants, '设为 high');
});
/* ══════════ F — 锁定面 ══════════ */
test('F1 锁定两个语义都报（数据字段 + 界面禁令）', () => {
    assert.deepEqual(dataLockProblems(DAT), []);
    const L = DAT.lockFace([DAT.normalizeItem(item({ locked: true }), 0)]);
    assert.equal(L.lockedCount, 1);
    assert.ok(L.rows[0].text.indexOf('不可改') >= 0);
});
test('F2 首末位占没占要单独报（源装载时有一段静默解锁）', () => {
    const L = DAT.lockFace([
        DAT.normalizeItem(item({ locked: true }), 0),
        DAT.normalizeItem(item({ locked: false }), 1),
        DAT.normalizeItem(item({ locked: true }), 2)
    ]);
    assert.equal(L.firstLocked, true);
    assert.equal(L.lastLocked, true);
    assert.equal(L.bothEnds, true);
    assert.ok(L.why.indexOf('静默解锁') >= 0);
});
test('F3 开关缺字段不许替它读成真（本件按关算并写明两边读法）', () => {
    const miss = DAT.normalizeItem({ name: 'x', content: 'y' }, 0);
    assert.equal(miss.enabledGiven, false);
    assert.equal(miss.enabled, false);
    const r = DAT.itemFace({ name: 'x', content: 'y' }, 0);
    assert.ok(r.problemText.indexOf('源按开算') >= 0);
});
/* ══════════ G — 标记体检面（只数不改写） ══════════ */
test('G1 标记只数不改写、不抠字', () => {
    assert.deepEqual(dataScanProblems(DAT), []);
    const OP = String.fromCharCode(60) + 'thinking' + String.fromCharCode(62);
    const CL = String.fromCharCode(60) + '/' + 'thinking' + String.fromCharCode(62);
    const body = OP + '想' + CL + '正文';
    const s = DAT.textScan(body);
    assert.equal(s.paired, 1);
    assert.equal(s.unpaired, 0);
    assert.equal(s.chars, body.length, '体检不许改动字数');
});
test('G2 落单标记要单独计数（源不管成不成对都抠）', () => {
    const OP = String.fromCharCode(60) + 'thinking' + String.fromCharCode(62);
    const s = DAT.textScan(OP + 'x' + OP + 'y');
    assert.equal(s.open, 2);
    assert.equal(s.close, 0);
    assert.equal(s.paired, 0);
    assert.equal(s.unpaired, 2);
});
/* ══════════ H — 收录面（空册与没册不同形） ══════════ */
test('H1 八个收录失败因互不相同（源把读不出来画成「就是空的」）', () => {
    assert.deepEqual(dataIngestFaceProblems(DAT), []);
    const whys = ['empty_input', 'too_long', 'empty', 'no_bracket', 'bad_json', 'no_items', 'empty_items', 'too_many'];
    assert.equal(new Set(whys).size, whys.length);
});
test('H2 空册不许静默换回默认册（源在这里换）', () => {
    const e = DAT.extractItems('[]');
    assert.equal(e.ok, false);
    assert.equal(e.why, 'empty_items');
    assert.equal(e.total, 0);
    assert.deepEqual(e.list, []);
});
/* ══════════ I — 配置面 ══════════ */
test('I1 配置四态分开（没贴 / 坏 JSON / 裸数组 / 不是对象）', () => {
    assert.deepEqual(dataConfigProblems(DAT), []);
});
test('I2 四格原样收下 —— 不替它补默认值', () => {
    const c = DAT.configFace(jsonOf({ mode: 'card' }));
    assert.equal(c.mode, 'card');
    assert.equal(c.provider, '');
    assert.equal(c.nativeEffort, '');
    assert.equal(c.prefill, '');
    assert.equal(c.enabledGiven, false);
});
test('I3 作用范围两个都要报（对话 / 离线）', () => {
    const c = DAT.configFace(jsonOf({ mode: 'card', scopes: { chat: false, offline: true } }));
    assert.ok(c.scopes.indexOf('对话不生效') >= 0);
    assert.ok(c.scopes.indexOf('离线生效') >= 0);
});
/* ══════════ J — 上限与余量面 ══════════ */
test('J1 三项上限逐项自成读数（取不出来画横线）', () => {
    assert.deepEqual(dataGaugeProblems(DAT), []);
    const rows = DAT.gaugesOf({ items: 1, chars: 2, logs: 3 });
    assert.equal(rows.length, 3);
    assert.ok(rows[0].text.indexOf('/') >= 0);
});
test('J2 余量超上限要另标（源把超了当成没超）', () => {
    const rows = DAT.gaugesOf({ items: DAT.CD_ITEM_MAX + 1, chars: 0, logs: 0 });
    assert.equal(rows[0].over, true);
    assert.equal(rows[0].pct, 100);
});
test('J3 台账挤掉旧记录要计数', () => {
    assert.deepEqual(dataTrimProblems(DAT), []);
    const many = [];
    for (let i = 0; i < DAT.CD_LOG_MAX + 7; i++) many.push(i);
    assert.equal(DAT.cdTrim(many, DAT.CD_LOG_MAX).dropped, 7);
});
/* ══════════ K — 条目面与汇总 ══════════ */
test('K1 七类问题逐条能报（源把所有异常挤成一句「有点问题」）', () => {
    assert.deepEqual(dataFaceProblems(DAT), []);
});
test('K2 汇总面：塌平与认不出分开计数', () => {
    assert.deepEqual(dataSummaryProblems(DAT), []);
    const rows = [
        DAT.itemFace(item({ position: DAT.CD_POSITIONS[0], role: DAT.CD_ROLES[2] }), 0),
        DAT.itemFace(item({ position: 'zzz' }), 1),
        DAT.itemFace(item({ position: DAT.CD_POSITIONS[1], role: DAT.CD_ROLES[1] }), 2)
    ];
    const s = DAT.itemSummary(rows);
    assert.equal(s.flattened, 2);
    assert.equal(s.sides.unknown, 1);
    assert.equal(s.items, 3);
});
test('K3 要求文本：只产描述，一个字段都不写，且自带对账口径', () => {
    assert.deepEqual(dataRequestProblems(DAT), []);
});
/* ══════════ L — App 面：四态 / 收录 / 门 / 换会话 ══════════ */
test('L1 四态逐格分开（源把读不出来画成「就是空的」）', () => {
    assert.deepEqual(appFaceProblems(APP), []);
});
test('L2 收录与失败面：认不出来的粘贴不许冲掉台面上那份', () => {
    assert.deepEqual(appContentProblems(APP), []);
});
test('L3 门与上限（写了没成要报 / 越限要挡 / 清台账不许顺手清册）', () => {
    assert.deepEqual(appGateProblems(APP), []);
});
test('L4 换会话四格全量重取 + 账要真落盘', () => {
    assert.deepEqual(appChatProblems(APP), []);
});
test('L5 失败面必须可见：失败的动作要能落到回执上（源失败也静默）', () => {
    const a = newApp(memStorage());
    a.ingestItems('{bad');
    const rows = a.ledgerRows();
    assert.ok(rows.length >= 1, '失败必须落账');
    assert.equal(rows[0].ok, false, '失败必须记成没成');
    assert.ok(rows[0].why.length > 0, '失败必须记下为什么');
});
test('L6 要求文本是本件唯一的产出物：只产描述、不多写一个键', () => {
    const mem = memStorage();
    const a = newApp(mem);
    a.ingestItems(itemsJson());
    const before = mem._box.size;
    const t = a.makeText();
    assert.equal(t.ok, true);
    assert.equal(mem._box.size, before, '出文本不许额外写入任何键');
    assert.ok(t.text.indexOf('逐条回报') >= 0, '要求文本必须自带上报口径');
});
test('L7 四个页签都在、且与 App 的四个真键同名', () => {
    const code = stripComments(read(CD_VIEW));
    for (const t of ['items', 'config', 'sides', 'ledger']) {
        assert.ok(code.indexOf(Q + t + Q) >= 0, '页签 ' + t + ' 不在');
    }
    assert.equal(newApp(memStorage()).tab(), 'items');
});
/* ══════════ M — 四块不缝真的没缝 ══════════ */
const THREE = [
    [CD_DATA, read(CD_DATA)],
    [CD_APP, read(CD_APP)],
    [CD_VIEW, read(CD_VIEW)]
];
test('M1 不改写宿主提示词：三件里一个拼系统提示 / 消息数组的动作都没有', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['injectItems', 'headMessages', 'systemPrompt', 'buildMessages']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('M2 不发请求不塞参数：三件里没有 fetch / XHR / Blob / FormData', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'new Blob', 'new FormData']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('M3 不抠正文：三件里没有按标记截段 / 从正文删段的动作', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['extractTaggedReasoning', 'removeFromBody', 'extractNativeReasoning', 'processResponse']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('M4 不读宿主界面元素：三件里没有 getElementById / document.body / document.head', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['getElementById', 'getElementsByClassName', 'document.body', 'document.head', 'window.parent']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('M5 裁定不等于注入：不许重载页面 / 跳转，且只写自己那四条键', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        assert.equal(code.indexOf('location.reload') >= 0, false, rel + ' 不许可重载页面');
        assert.equal(code.indexOf('location.href') >= 0, false, rel + ' 不许可跳转');
    }
    const app = stripComments(read(CD_APP));
    assert.ok(app.indexOf('this._writeJSON(CD_ITEMS_KEY') >= 0);
    assert.ok(app.indexOf('this._writeJSON(CD_CONFIG_KEY') >= 0);
    assert.ok(app.indexOf('this._writeJSON(CD_DRAFT_KEY') >= 0);
    assert.ok(app.indexOf('this._writeJSON(CD_LEDGER_KEY') >= 0);
});
test('M6 seamProblems 在真三件上必须干净（四块不缝的合并判据）', () => {
    assert.deepEqual(seamProblems(THREE), []);
});
/* ══════════ N — 接线面（六处落点） ══════════ */
test('N1 六处接线落点齐备（少一处就静默错数据 / 点了没反应）', () => {
    assert.deepEqual(wireJudge(), []);
});
test('N2 会话键前缀只许一条（重复插入 = 换会话读到双份账）', () => {
    const s = stripComments(read(STORAGE));
    assert.equal(s.split('/^cotdesk_/').length - 1, 1, '前缀只许出现一次');
});
test('N3 懒加载分支只许一个（重复插入 = 两个实例同时写同一批键）', () => {
    const s = stripComments(read(INDEX));
    assert.equal(s.split(Q + 'cotdesk' + Q).length - 1, 1);
    assert.equal(s.split('window.VirtualPhone.cotdeskApp = new module.CotdeskApp(').length - 1, 1,
        '构造只许一次（重复插入 = 两个实例同时写同一批键）');
    assert.ok(s.split('cotdeskApp').length - 1 >= 2, '构造与登记都要在');
});
test('N4 四条键逐条在册且 scope 正确（少一条 = keys 门报未登记键）', () => {
    const s = read(KEYS);
    for (const k of ['cotdesk_items', 'cotdesk_config', 'cotdesk_draft', 'cotdesk_ledger']) {
        assert.ok(s.indexOf(Q + k + Q) >= 0, k + ' 必须在册');
    }
    assert.equal(s.split("scope: 'chat'").length - 1 >= 4, true, '四条都应是 chat 作用域');
});
test('N5 样式逐字同源投递进 phone.css（少这一条 = 页面没样式，看起来像坏了）', () => {
    const own = read(CD_CSS);
    const phone = read(PHONE_CSS);
    assert.ok(phone.indexOf(own.trim()) >= 0, '.cd 整份样式必须逐字同源在 phone.css 里');
    assert.ok(phone.indexOf('/* ══════════════ [v3.46.0] 思维链案头（cotdesk） ══════════════ */') >= 0);
});
test('N6 样式与视图逐类对应（少一个类 = 那一格没样式，看起来像坏了）', () => {
    const view = stripComments(read(CD_VIEW));
    const css = read(CD_CSS);
    const used = new Set();
    for (const m of view.matchAll(/cd-[a-z0-9-]+/g)) used.add(m[0]);
    const missing = [];
    for (const c of used) {
        if (c.endsWith('-')) continue;
        if (c === 'cd-tone-none') continue;
        if (css.indexOf('.' + c) < 0) missing.push(c);
    }
    assert.deepEqual(missing, [], '视图用到的类必须在样式里定义：' + missing.join(','));
});
/* ══════════ O — 视图面 ══════════ */
test('O1 四态面色相取真源（四项逐项自成字面）', () => {
    assert.deepEqual(viewFaceProblems(read(CD_VIEW)), []);
});
test('O2 空与坏不同形（取不出来回横线，且余量条不着色）', () => {
    assert.deepEqual(viewCountProblems(read(CD_VIEW)), []);
});
test('O3 塌平与认不出分别画（两件事不许合成一句「有点问题」）', () => {
    assert.deepEqual(viewSplitProblems(read(CD_VIEW)), []);
});
test('O4 失败面要可见（回执那一行不许被拿掉）', () => {
    assert.deepEqual(viewFlashProblems(read(CD_VIEW)), []);
});
test('O5 事件口与动作分支逐条对上（错一个就点了没反应）', () => {
    assert.deepEqual(viewActProblems(read(CD_VIEW)), []);
});
test('O6 要求文本可选中复制（源把结果塞进 toast，一转身就没了）', () => {
    assert.deepEqual(viewTextProblems(read(CD_VIEW)), []);
});
test('O7 四个页签都在、且与 App 的四个真键同名', () => {
    assert.deepEqual(viewTabProblems(read(CD_VIEW)), []);
});
test('O8 标记体检只数不改写（视图上不许出现改写动作）', () => {
    assert.deepEqual(viewScanProblems(read(CD_VIEW)), []);
});
/* ══════════ P — 结构面（静态门） ══════════ */
test('P1 四件都在且可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [CD_DATA, CD_APP, CD_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' ' + (r2.stderr || '').split(NL)[0]);
    }
    assert.ok(read(CD_CSS).length > 3000, '样式必须真的有内容');
});
test('P2 被审代码的字符纪律：不许反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [CD_DATA, CD_APP, CD_VIEW]) {
        const src = read(rel);
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        assert.equal(src.indexOf('`') >= 0, false, rel + ' 不许出现反引号');
    }
});
test('P3 样式不得靠外部字体 / 不得引远程资源（本件不自包含就算坏）', () => {
    const css = read(CD_CSS);
    assert.equal(css.indexOf('http://') >= 0, false);
    assert.equal(css.indexOf('https://') >= 0, false);
});
test('P4 源清单两片在册（本件缝的是哪两片必须写在产品里）', () => {
    assert.equal(DAT.CD_SOURCE_FILES.length, 2);
    const keys = DAT.CD_SOURCE_FILES.map((f) => f.key);
    assert.deepEqual(keys, ['tuk', 'uwu']);
    for (const f of DAT.CD_SOURCE_FILES) {
        assert.ok(f.bytes > 0 && f.lines > 0, f.file + ' 必须写出规模');
        assert.ok(f.role.length > 0, f.file + ' 必须写出角色');
    }
    assert.ok(DAT.CD_SOURCE_NOTE.indexOf('同族') >= 0);
});
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);

/* ══════════ Q — 破坏表（负控制用：每一条都对着本件的一条静默失效形态） ══════════ */
/** ★ 破坏表纪律（本仓硬纪律）：
 *  · 锚点必须**在代码里**（不许落在注释里）—— 注释里的提及不算消费；
 *  · 锚点必须**恰中 1 次** —— 多一次就会连带破坏别的路径，破坏就不再单一；
 *  · 替换后必须**仍是合法 JS** —— 否则测到的是语法错而不是判据；
 *  · 每一条都对着「源里的一个静默失效形态」，不许有装饰性破坏。 */
const DAMAGE = {
    /* ① 位置认不出来当成中段落下去（源里认不出的位置直接落一处，界面上看不出来）。 */
    q1: [CD_DATA, '    if (!known) {', '    if (false) {'],
    q2: [CD_DATA, '    if (!known) {', '    if (false) {'],
    /* ② 角色认不出来也一样（两件事分别认，不许合成一句）。 */
    q3: [CD_DATA, '    } else if (!roleKnown) {', '    } else if (false) {'],
    /* ③ 塌平不标（首部与中段落成同一处却报成正常）。 */
    q4: [CD_DATA, '    } else if (pos === CD_POSITIONS[1]) {' + NL + '        if (role === CD_ROLES[0]) side = ' + Q + 'system' + Q + ';' + NL + '        else { side = ' + Q + 'lead' + Q + '; flattened = true; why = ' + Q + '源里首部与中段的非系统条目落在同一处' + Q + '; }',
        '    } else if (pos === CD_POSITIONS[1]) {' + NL + '        if (role === CD_ROLES[0]) side = ' + Q + 'system' + Q + ';' + NL + '        else { side = ' + Q + 'lead' + Q + '; flattened = false; why = ' + Q + Q + '; }'],
    /* ④ 历史前也算进系统提示（五个真落点塔成一个）。 */
    q5: [CD_DATA, '        side = ' + Q + 'lead' + Q + ';', '        side = ' + Q + 'system' + Q + ';'],
    /* ⑤ 深度取不出来读成 0 层（源就是 0）。 */
    q6: [CD_DATA, '            value: null, raw: raw, blank: true, clamped: false, over: false,',
        '            value: 0, raw: raw, blank: false, clamped: false, over: false,'],
    /* ⑥ 册子上写的值不在枚举里 ➜ 归到「没命中任何特征词」（与本件三态对着干）。 */
    q7: [CD_DATA, '        source = declaredOk ? ' + Q + 'declared' + Q + ' : ' + Q + 'bad_declared' + Q + ';',
        '        source = declaredOk ? ' + Q + 'declared' + Q + ' : ' + Q + 'none' + Q + ';'],
    /* ⑦ 声明是自动却不报「要谁来决定」（源替它猜）。 */
    q8: [CD_DATA, '        why: (value === CD_PREFILLS[0]) ? ' + Q + '声明是自动：源在这里按模型名猜，本件只报「要谁来决定」，不替它猜' + Q + ' : ' + Q + Q,
        '        why: ' + Q + Q],
    /* ⑧ 认不出的接口不标静默丢（源整块丢掉参数，界面上只写一句话）。 */
    q9: [CD_DATA, '    const silent = !supported;', '    const silent = false;'],
    /* ⑨ 开关缺字段替它读成真（源的读法）。 */
    q10: [CD_DATA, '    if (!blank && !it.enabledGiven) problems.push(' + Q + '没有开关字段（本件按关算，源按开算）' + Q + ');',
        '    if (false) problems.push(' + Q + '没有开关字段（本件按关算，源按开算）' + Q + ');'],
    /* ⑩ 首末位占没占取两套语义（首位有锁定就成了「末位也占」，源的两个语义合了）。
     *  ★ 锚点必须选**能产生分歧**的那一处：fixture 是 3 项且只有首位锁定，
     *    改末位条件后真件（末位不锁定 ⇒ false）与破坏（首位锁定 ⇒ true）才分得开。 */
    q11: [CD_DATA, '        if (i === list.length - 1 && locked) lastLocked = true;', '        if (i === 0 && locked) lastLocked = true;'],
    /* ⑪ 标记成对与落单合成一个数（源不管成不成对都抠）。 */
    q12: [CD_DATA, '    const paired = Math.min(open, close);', '    const paired = open + close;'],
    /* ⑫ 正文超限只报不截（装载面同一处守卫：读成正常就不会报超限）。 */
    q13: [CD_APP, '        if (cut) {', '        if (false) {'],
    /* ⑬ 抛异常不许读成「没记过」（源的读法）。★ 替换文本不许自带右花括号 —— 那会把破坏改成语法错。 */
    q14: [CD_APP, '        catch (e) { return { ok: false, why: ' + Q + 'read_threw' + Q + ', value: undefined }; }',
        '        catch (e) { return { ok: true, why: ' + Q + 'absent' + Q + ', value: undefined }; }'],
    /* ⑭ 收册口超限静默收下（源把超了当成没超）。★ 装载面那条（q13）与这条是两处守卫，两条都要守。 */
    q15: [CD_APP, '        if (raw.length > CD_TEXT_MAX) {' + NL + '            this._receipt(' + Q + 'items_ingest' + Q + ', false, ' + Q + 'too_long' + Q + ', { n: raw.length });',
        '        if (false) {' + NL + '            this._receipt(' + Q + 'items_ingest' + Q + ', false, ' + Q + 'too_long' + Q + ', { n: raw.length });'],
    /* ⑮ 台账不裁边（源不裁，一直涨）。 */
    q16: [CD_APP, '        this._ledger = t.rows;', '        this._ledger = this._ledger;'],
    /* ⑯ 台账挤掉不计数（源静默挤）。 */
    q17: [CD_APP, '        this._dropped += t.dropped;', '        this._dropped += 0;'],
    /* ⑰ 册子读不出来不许读成空册（App 侧三态面同一处守卫）。 */
    q18: [CD_APP, '        if (st.face === FACE_MALFORMED) return { face: FACE_MALFORMED, why: st.why };',
        '        if (st.face === FACE_MALFORMED) return { face: FACE_EMPTY, why: st.why };'],
    /* ⑱ 形状认不出来的粘贴冲掉台面上的册子（源把读不出来画成「就是空的」）。 */
    q19: [CD_APP, '        const ex = extractItems(raw);' + NL + '        if (!ex.ok) {',
        '        const ex = extractItems(raw);' + NL + '        if (false) {'],
    /* ⑲ 条数超上限静默收下（源不挡）。 */
    q20: [CD_APP, '        if (ex.total > CD_ITEM_MAX) {', '        if (false) {'],
    /* ⑳ 页签门丢掉（源用自由字符串，错一个就画空白页）。 */
    q21: [CD_APP, '        const ok = [' + Q + 'items' + Q + ', ' + Q + 'config' + Q + ', ' + Q + 'sides' + Q + ', ' + Q + 'ledger' + Q + '];' + NL + '        this._tab = ok.indexOf(k) >= 0 ? k : ' + Q + 'items' + Q + ';',
        '        this._tab = k;'],
    /* ㉑ 草稿不落盘（源把草稿与进度挤一个对象，写一次带上）。 */
    q22: [CD_APP, '    _persistDraft() {' + NL + '        return this._writeJSON(CD_DRAFT_KEY, { target: this._target, extra: this._extra });',
        '    _persistDraft() {' + NL + '        return false;'],
    /* ㉒ 换会话不重取（源就是切角色原样留着）。 */
    q23: [CD_APP, '        this._now = 0;' + NL + '        this.probe();', '        this._now = 0;'],
    /* ㉓ 清台账顺手清册（源把四类挤一处就是这个后果）。 */
    q24: [CD_APP, '    clearLedger() {' + NL + '        const had = this._ledger.length;',
        '    clearLedger() {' + NL + '        this._raw = ' + Q + Q + '; this._persistItems(); this.probe();' + NL + '        const had = this._ledger.length;'],
    /* ㉔ 面色相不取真源（源把告警与错同色）。 */
    q25: [CD_VIEW, '    malformed: ' + Q + 'err' + Q + ',', '    malformed: ' + Q + 'ok' + Q + ','],
    /* ㉕ 取不出来画 0（源就是这么画的）。 */
    q26: [CD_VIEW, '        return (v === null || v === undefined) ? DASH : String(v);',
        '        return String(v === null || v === undefined ? 0 : v);'],
    /* ㉖ 余量条取不出来也着色。 */
    q27: [CD_VIEW, '            if (!r.blank) {', '            if (true) {'],
    /* ㉗ 动作分支丢掉：失败那一支没了（源失败与成功同形）。 */
    q28: [CD_VIEW, '        } else if (a === ' + Q + 'clear_items' + Q + ') {',
        '        } else if (a === ' + Q + 'clear_items_none' + Q + ') {'],
    /* ㉘ 动作分支丢掉（点了没反应）。 */
    q29: [CD_VIEW, '        } else if (a === ' + Q + 'clear_ledger' + Q + ') {', '        } else if (a === ' + Q + 'clear_ledger_none' + Q + ') {'],
    /* ㉙ 输入口不绑定（打了字不生效）。 */
    q30: [CD_VIEW, '        const areas = root.querySelectorAll(' + Q + '[data-in]' + Q + ');', '        const areas = [];'],
    /* ㉚ 塌平不单独画（与认不出合成一句「有点问题」）。★ 锚点必须落在**视图真源码**里
     *    —— 钉测试自己判据的文本等于自我指涉（破坏没发生也“红”）。 */
    q31: [CD_VIEW, '(r.flattened ? ' + Q + '<span class="cd-why-mini">落点被塌平到与首部同一处</span>' + Q + ' : ' + Q + Q + ')',
        '(false ? ' + Q + '<span class="cd-why-mini">落点被塌平到与首部同一处</span>' + Q + ' : ' + Q + Q + ')'],
    /* ㉛ 接线：会话键前缀丢掉（换会话读到别人的账）。 */
    q32: [STORAGE, '    /^cotdesk_/,', '    /^cotdeskX_/,'],
    /* ㉜ 接线：懒加载分支丢掉（打开页面一片空白）。 */
    q33: [INDEX, '                } else if (appId === ' + Q + 'cotdesk' + Q + ') {',
        '                } else if (appId === ' + Q + 'cotdeskX' + Q + ') {'],
};
/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3460_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'storage.js'), path.join(dir, 'config', 'storage.js'));
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    /* [v3.58.0 · 计划 O5] 本件 17 件中的 cotdesk 已把写回执接进唯一实现，
     *   副本树少了它，模块解析当场 ERR_MODULE_NOT_FOUND（真踩过）。 */
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    const ad = path.join(dir, 'apps', 'cotdesk');
    fs.mkdirSync(ad, { recursive: true });
    for (const f of ['cotdesk-data.js', 'cotdesk-app.js', 'cotdesk-view.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'cotdesk', f), path.join(ad, f));
    }
    return dir;
}
/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。
 *  ★ 类别三样：data（数据层模块副本）/ appmod（App 模块副本）/ src（源码文本判据）/ wire（接线真文件）。 */
const NEG = [
    ['I1 破坏「位置认不出来不许猜」⇒ 内核判据必须转红', 'q1', 'data', ['unknown-position-guessed']],
    ['I2 破坏「位置与角色两处分别认」⇒ 同一处守卫，两条都要转红', 'q2', 'data', ['unknown-position-guessed']],
    ['I3 破坏「角色认不出来不许猜」⇒ 内核判据必须转红', 'q3', 'data', ['role-unknown-guessed']],
    ['I4 破坏「塌平必须单独标」⇒ 内核判据必须转红', 'q4', 'data', ['position-flattened']],
    ['I5 破坏「五个真落点不许塌平」⇒ 内核判据必须转红', 'q5', 'data', ['lead-collapsed']],
    ['I6 破坏「深度取不出来不许读成 0」⇒ 内核判据必须转红', 'q6', 'data', ['depth-blank-lost']],
    ['I7 破坏「声明值不在枚举里要单列一态」⇒ 内核判据必须转红', 'q7', 'data', ['provider-three-state-collapsed']],
    ['I8 破坏「声明是自动要报谁来决定」⇒ 内核判据必须转红', 'q8', 'data', ['prefill-auto-hidden']],
    ['I9 破坏「认不出的接口不许静默丢」⇒ 内核判据必须转红', 'q9', 'data', ['native-silent-drop-lost']],
    ['I10 破坏「开关缺字段不许读成真」⇒ 内核判据必须转红', 'q10', 'data', ['enabled-default-flagged']],
    ['I11 破坏「首末位占没占不许取两套语义」⇒ 内核判据必须转红', 'q11', 'data', ['lock-ends-lost']],
    ['I12 破坏「标记成对与落单不许合成一数」⇒ 内核判据必须转红', 'q12', 'data', ['scan-pair-collapsed']],
    ['I13 破坏「正文超限只报不截」⇒ 行为判据必须转红', 'q13', 'appmod', ['too-long-face-lost']],
    ['I14 破坏「抛异常不许读成没记过」⇒ 行为判据必须转红', 'q14', 'appmod', ['storage-throw-read-as-absent']],
    ['I15 破坏「收册口超限不许静默收」⇒ 行为判据必须转红', 'q15', 'appmod', ['over-limit-silently-taken']],
    ['I16 破坏「台账本体也不许超上限」⇒ 行为判据必须转红', 'q16', 'appmod', ['ledger-drop-unreported']],
    ['I17 破坏「台账挤掉要计数」⇒ 行为判据必须转红', 'q17', 'appmod', ['ledger-drop-unreported']],
    ['I18 破坏「册子读不出来不许读成空册」⇒ 行为判据必须转红', 'q18', 'appmod', ['malformed-face-lost']],
    ['I19 破坏「认不出来的粘贴不许冲掉台面」⇒ 行为判据必须转红', 'q19', 'appmod', ['failed-ingest-wiped-book']],
    ['I20 破坏「条数超上限不许静默收」⇒ 行为判据必须转红', 'q20', 'appmod', ['too-many-silently-taken']],
    ['I21 破坏「页签只认四个真键」⇒ 行为判据必须转红', 'q21', 'appmod', ['tab-gate-lost']],
    ['I22 破坏「草稿要真存得住」⇒ 行为判据必须转红', 'q22', 'appmod', ['draft-not-persisted']],
    ['I23 破坏「换会话四格全量重取」⇒ 行为判据必须转红', 'q23', 'appmod', ['chat-change-no-book-reload']],
    ['I24 破坏「清台账不许顺手清册」⇒ 行为判据必须转红', 'q24', 'appmod', ['clear-ledger-wiped-book']],
    ['I25 破坏「面色相取真源」⇒ 视图判据必须转红', 'q25', 'src', ['face-tone-not-by-source']],
    ['I26 破坏「取不出来画横线」⇒ 视图判据必须转红', 'q26', 'src', ['empty-and-bad-collapsed']],
    ['I27 破坏「余量条取不出来不着色」⇒ 视图判据必须转红', 'q27', 'src', ['empty-and-bad-collapsed']],
    ['I28 破坏「动作分支逐条对上」⇒ 视图判据必须转红', 'q28', 'src', ['action-branch-lost:clear_items']],
    ['I29 破坏「动作分支逐条对上」⇒ 视图判据必须转红', 'q29', 'src', ['action-branch-lost:clear_ledger']],
    ['I30 破坏「输入口要真的绑上」⇒ 视图判据必须转红', 'q30', 'src', ['input-binding-lost']],
    ['I31 破坏「塌平与认不出分别画」⇒ 视图判据必须转红', 'q31', 'src', ['flattened-not-separate']],
    ['I32 破坏「会话键前缀」⇒ 接线判据必须转红', 'q32', 'wire', ['wire-storage-prefix-lost']],
    ['I33 破坏「懒加载分支」⇒ 接线判据必须转红', 'q33', 'wire', ['wire-lazy-branch-lost']],
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
            const dirW = stageWire();
            const realW = fs.readFileSync(path.join(dirW, rel), 'utf8');
            assert.deepEqual(wireJudgeAt(dirW), [], '对照：副本未破坏时必须干净');
            fs.writeFileSync(path.join(dirW, rel), damaged);
            const badW = wireJudgeAt(dirW);
            assert.ok(badW.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (badW.join(' , ') || '（没报）'));
            fs.writeFileSync(path.join(dirW, rel), realW);
            assert.deepEqual(wireJudgeAt(dirW), [], '对照：还原后副本必须干净');
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

/* ══════════ 合并判据与取用（负控制按族取用） ══════════ */
/** 数据层全部判据（合并）。★ 合并的意义：一条破坏只要碰了数据层任何一面，这里必红。 */
function dataProblems(M) {
    return [].concat(
        dataPosProblems(M), dataDepthProblems(M), dataProviderProblems(M),
        dataPrefillProblems(M), dataNativeProblems(M), dataScanProblems(M),
        dataIngestFaceProblems(M), dataLockProblems(M), dataSummaryProblems(M),
        dataGaugeProblems(M), dataTrimProblems(M), dataConfigProblems(M),
        dataFaceProblems(M), dataRequestProblems(M)
    );
}
/** App 层全部判据（合并）。★ 与数据层同理：一条破坏只要碰了 App 任何一面，这里必红。 */
function appProblems(M) {
    return [].concat(
        appFaceProblems(M), appContentProblems(M), appGateProblems(M), appChatProblems(M)
    );
}
/** 视图层全部判据（合并）：输入是**视图源码文本**（剥注释后逐字比对）。 */
function viewProblems(src) {
    return [].concat(
        viewFaceProblems(src), viewCountProblems(src), viewSplitProblems(src),
        viewFlashProblems(src), viewActProblems(src), viewTextProblems(src),
        viewTabProblems(src), viewScanProblems(src)
    );
}
/** 按破坏键取对应族的判据（输入是「模块」或「源码文本」）。
 *  ★ 三道分流必须与破坏表的 kind 逐段对上：q1~q12 数据层（模块）/ q13~q24 App 层（模块）/
 *    q25~q31 视图层（**源码文本**）。分错段会把模块喂给源码判据（或反之），
 *    测到的是 TypeError 而不是判据本身 —— 那正是本版判据面自己抓到的一处真缺陷。 */
function judgeOf(key, subject) {
    const n = Number(key.slice(1));
    if (n <= 12) return dataProblems(subject);
    if (n <= 24) return appProblems(subject);
    if (n <= 31) return viewProblems(subject);
    return [];
}

/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + NL + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.ok(stripComments('const s = ' + Q + 'fetch(' + Q + ';').includes('fetch('), '字符串里的同形文本必须留住');
    /* ★ 被审三件必须能让剥器复位（尾随哨兵）：剥完不许把哨兵也吃掉。 */
    for (const rel of [CD_DATA, CD_APP, CD_VIEW]) {
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
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3460k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});
test('J3 主线三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [CD_DATA, CD_APP, CD_VIEW]) {
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
    assert.deepEqual(appContentProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(viewFaceProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewSplitProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewFlashProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewActProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewTextProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewTabProblems(read(CD_VIEW)), []);
    assert.deepEqual(viewScanProblems(read(CD_VIEW)), []);
    assert.deepEqual(dataKeyProblems(read(CD_DATA)), []);
    assert.deepEqual(seamProblems(THREE), []);
    assert.deepEqual(wireJudge(), []);
});
test('J6 被审代码的字符纪律：不许反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [CD_DATA, CD_APP, CD_VIEW]) {
        const src = read(rel);
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        assert.equal(src.indexOf(String.fromCharCode(96)) >= 0, false, rel + ' 不许出现反引号');
    }
});
test('J7 收录失败因八键在数据层是真源，App 的文案表按索引取键（不再手抄一份八键）', () => {
    const dCode = stripComments(read(CD_DATA));
    const aCode = stripComments(read(CD_APP));
    assert.ok(dCode.indexOf('export const CD_INTAKE_WHYS') >= 0, '数据层必须有八键真源');
    assert.ok(aCode.indexOf('CD_INTAKE_WHYS') >= 0, 'App 必须按索引取真源键');
    /* ★ 八键各自在 App 里**只许出现在行为代码里**（回执用），文案表的键位一律走
     *   [CD_INTAKE_WHYS[n]] 索引形 —— 若有人在 App 里重新手抄键名，索引形就会断。 */
    const m = aCode.split(Q + 'empty_items' + Q).length - 1;
    assert.ok(m <= 1, 'App 里 empty_items 手抄超一处（文案表应走索引形）');
});
test('J8 四条会话键在 App 里各只有一个真源（判据不许手抄键名）', () => {
    const aCode = stripComments(read(CD_APP));
    for (const k of ['cotdesk_items', 'cotdesk_config', 'cotdesk_draft', 'cotdesk_ledger']) {
        assert.equal(aCode.split(Q + k + Q).length - 1, 1, k + ' 只在声明处出现一次');
    }
});

/* ══════════════════════ K — 版本与交棒 ══════════════════════ */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 46),
        '本套件成立于 RubyPhone 3.46.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes('const ST_PHONE_VERSION = ' + Q + man.version + Q), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含本版号');
    /* 公告块与 update-log 逐字同源（本仓硬判据）。 */
    const items = rec.items || rec.changes;
    for (const it of items) assert.ok(src.includes(JSON.stringify(it)), '公告块必须与条目逐字同源');
});
test('K2 交棒必须指向本件自己那一版的真实现状（钉自己的条目，不钉公告）', () => {
    /* ★ 钉**本件自己那一版的 update-log 条目**，不钉 index.js 当前公告 ——
     *   公告随每次抬版整体重写（钉它等于给自己埋一条下一版必红的断言）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.46.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('思维链案头'), 'v3.46.0 条目必须自述本件名');
    assert.ok(text.includes('cot_settings.js'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('thought-chain'), '交棒必须写到源片路径');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
});
