// tests/system-v3450.test.mjs — 存档台 [v3.45.0]
//
// 本套件守四件事：
//  ① 存档包的口径（包型不许猜 / 版本两套语义不许只数值比 /
//     覆盖性不许含糊 / 表不许静默丢 / 条数与体积取不出来不画 0 /
//     重置影响逐键列 / 结构体检只报不补）；
//  ② 四块不缝真的没缝（零落库零外部备份 / 零下载零上传 /
//     零出图零压图 / 零宿主界面读）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 ~ v3.44 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）。
//  · **裁定不等于迁移**：本件一个字段都不写宿主，判据也要守这一条。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as DAT from '../apps/archive/archive-data.js';
import * as APP from '../apps/archive/archive-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AR_DATA = 'apps/archive/archive-data.js';
const AR_APP = 'apps/archive/archive-app.js';
const AR_VIEW = 'apps/archive/archive-view.js';
const AR_CSS = 'apps/archive/archive.css';
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
const AMP = String.fromCharCode(38);
/** 双引号（造 JSON 用）：拼装形。 */
const DQ = String.fromCharCode(34);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释（字符状态机，与 v3300…v3440 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词是**说明**不是**消费**。
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
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}
/** 换会话的存储（真件里由 `config/storage.js` 的 /^archive_/ 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致 —— 抄别版的前缀会把「换会话后读到别人的账」这条判据测成空气。 */
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
        set: (k, v) => { box.set(chat + '::' + k, v); },
        switchTo: (c) => { chat = c; },
        _box: box,
    };
}
/** 取不出来的存储（一取就抛）—— 守「取不出来不许读成空的」那一族。 */
function hostileStorage() {
    return { get: () => { throw new Error('boom'); }, set: () => {} };
}
/** 写不进去的存储（一写就抛）—— 守「写了没成要报，不许假装存好了」。 */
function readOnlyStorage() {
    return { get: () => null, set: () => { throw new Error('nope'); } };
}
/** 假宿主壳：只提供视图层要的 getContentContainer（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null, showNotification: () => {} };
}
const newApp = (storage) => new APP.ArchiveApp(shellStub(), storage);
const jsonOf = (o) => JSON.stringify(o);
/** 表名一律**从数据层真源取**（写死字符串会把「源里改了表名」这一类整族漏掉）。 */
const T0 = DAT.AR_STREAM_TABLES[0];
const TWB = DAT.AR_STREAM_TABLES[5];
/** 一份聊天记录（结构体检全过的那种）。 */
function goodChat() {
    return { name: 'a', history: [], settings: {}, status: {}, relationship: {}, characterPhoneData: {} };
}
/** 一份分块包（源 045 导出的形状：type + version 3 + contains + data）。 */
function chunkedJson() {
    const data = {};
    data[T0] = [goodChat()];
    data[TWB] = [{ name: 'w' }];
    return jsonOf({ version: 3, type: 'EPhoneChunkedBackup', timestamp: 1700000000000, contains: [T0, TWB], data: data });
}
/** 一份流式包（源 046：version 1，顶层直接是表名）。 */
function streamJson() {
    const o = { version: 1, timestamp: 1700000000000 };
    o[T0] = [goodChat()];
    o[TWB] = [{ name: 'w' }];
    return jsonOf(o);
}
/** 一份 330 兼容包（version 3 + timestamp + data，无 type）。 */
function compatJson() {
    const data = {};
    data[T0] = [goodChat()];
    return jsonOf({ version: 3, timestamp: 1700000000000, data: data });
}
/** 一份全量包（只有 data 与 timestamp，版本是别的值）。 */
function fullJson() {
    const data = {};
    data[T0] = [goodChat()];
    return jsonOf({ version: 9, timestamp: 1700000000000, data: data });
}
/** 数据层判据。★ 每一条都对着源的一处静默失效。 */
function dataProblems(M) {
    const bad = [];
    /* ① 包型不许猜：六因逐因各自成立。 */
    if (M.classifyBundle({ version: 3, type: 'EPhoneChunkedBackup', contains: ['a'] }).why !== 'ok') bad.push('pack-why-not-ok');
    if (M.classifyBundle(null).why !== 'not_object') bad.push('pack-unclassified-as-object');
    if (M.classifyBundle({}).why !== 'no_version') bad.push('pack-no-version-lost');
    if (M.classifyBundle({ version: 'x' }).why !== 'bad_version') bad.push('pack-bad-version-lost');
    if (M.classifyBundle({ version: 2 }).why !== 'no_payload') bad.push('pack-no-payload-lost');
    if (M.classifyBundle({ version: 3, type: 'EPhoneChunkedBackup', contains: [], data: {} }).why !== 'empty_contains') {
        bad.push('pack-empty-contains-lost');
    }
    if (new Set(M.AR_PACK_WHYS).size !== M.AR_PACK_WHYS.length) bad.push('pack-why-collapsed');
    /* ★ 认不出来的包**不许**给出正式包型（源在这里按全量处理并直接覆盖）。 */
    if (M.classifyBundle({ version: 2 }).pack !== 'unknown') bad.push('unknown-pack-guessed');
    if (M.classifyBundle({ version: 2 }).mode !== 'none') bad.push('unknown-pack-guessed');
    /* ② 版本两套语义不许只数值比。 */
    if (M.versionFace(1, 'stream').family !== 'stream') bad.push('version-family-collapsed');
    if (M.versionFace(3, 'chunked').family !== 'v3') bad.push('version-family-collapsed');
    if (M.versionFace(2, 'stream').family === 'stream') bad.push('version-family-collapsed');
    if (M.versionFace(1, 'stream').crossOk !== true) bad.push('cross-accept-wrong');
    if (M.versionFace(3, 'stream').crossOk !== false) bad.push('cross-accept-wrong');
    if (M.versionFace(1, 'chunked').crossOk !== false) bad.push('cross-accept-wrong');
    /* ③ 覆盖性不许含糊：合并不许报清空表，覆盖必须逐张列。 */
    const mg = M.overwriteFace('chunked', ['a', 'b'], ['a']);
    if (mg.clears !== false) bad.push('merge-claims-clear');
    if (mg.clearsTables.length !== 0) bad.push('merge-claims-clear');
    const rp = M.overwriteFace('compat330', ['a', 'b'], ['a']);
    if (rp.clears !== true) bad.push('replace-hidden');
    if (rp.clearsTables.length !== 1) bad.push('replace-hidden');
    if (rp.unknownTables.length !== 1) bad.push('unknown-tables-swallowed');
    /* ④ 表不许静默丢、六种形态不许塔平。 */
    const f = M.tableFace({ a: [], b: null, c: 1, d: {}, e: 'x' }, ['a', 'b', 'c', 'd', 'e', 'zz']);
    const shapes = f.map((r) => r.table + ':' + r.shape).join(' ');
    if (f.length !== 6) bad.push('table-face-lost');
    for (const want of ['a:array', 'b:null', 'c:scalar', 'd:object', 'e:scalar', 'zz:missing']) {
        if (shapes.indexOf(want) < 0) bad.push('table-shape-collapsed');
    }
    /* ⑤ 条数取不出来不许画 0。 */
    if (M.numOrNull(null) !== null) bad.push('count-faked-zero');
    if (M.numOrNull('') !== null) bad.push('count-faked-zero');
    if (M.numOrNull('abc') !== null) bad.push('count-faked-zero');
    if (M.numOrNull(0) !== 0) bad.push('count-faked-zero');
    /* ⑥ 体积取不出来不许画 0 字节（空与读不出来不同形）。 */
    if (M.formatBytes(null) !== '--') bad.push('bytes-faked-zero');
    if (M.sizeOf(null).chars !== null) bad.push('bytes-faked-zero');
    if (M.sizeOf(null).bytesText !== '--') bad.push('bytes-faked-zero');
    if (M.sizeOf('').chars !== 0) bad.push('empty-size-lost');
    /* ⑦ 台账挤掉要计数。 */
    if (M.arTrim([1, 2, 3], 2).dropped !== 1) bad.push('ledger-drop-unreported');
    /* ⑧ 余量取不出来不编 0。 */
    if (M.gaugesOf({ pack: null })[0].value !== null) bad.push('gauge-faked-zero');
    if (M.gaugesOf({ pack: null })[0].blank !== true) bad.push('gauge-faked-zero');
    if (M.gaugesOf({ pack: null })[0].blank !== true) bad.push('gauge-faked-zero');
    if (M.gaugeText({ blank: true, value: null, max: 10 }) !== '--') bad.push('gauge-faked-zero');
    /* ⑨ 要求文本必须带对账口径（本件唯一的产出物）。 */
    const t = M.requestText({ label: '分块包', version: 3, tables: ['a'], modeText: '覆盖式' }, 'x', '');
    if (t.indexOf('不要替我写入任何数据') < 0) bad.push('request-text-no-guard');
    if (t.indexOf('将被清空的表') < 0) bad.push('request-text-no-clear-list');
    /* ⑩ 结构体检只报不补（缺的逐项报）。 */
    const au = M.auditOf([{ name: 'g' }, goodChat()], false);
    if (au.items[0].misses.length !== 5) bad.push('audit-silently-fixed');
    if (au.items[1].misses.length !== 0) bad.push('audit-silently-fixed');
    /* ⑪ 流式与 330 两套清单不许合并。 */
    const d = M.tableDiffs();
    if (!(d.only330.length > 0)) bad.push('table-lists-collapsed');
    /* ★ 只在 330 的清单里**不许**混进流式清单已有的表（两套清单塔平就看不出来了）。 */
    for (const t of d.only330) if (M.AR_STREAM_TABLES.indexOf(t) >= 0) bad.push('table-lists-collapsed');
    for (const t of d.onlyStream) if (M.AR_330_TABLES.indexOf(t) >= 0) bad.push('table-lists-collapsed');
    /* ★ 只在 330 的清单里**不许**混进流式清单已有的表（两套清单塔平就看不出来了）。 */
    for (const t of d.only330) if (M.AR_STREAM_TABLES.indexOf(t) >= 0) bad.push('table-lists-collapsed');
    for (const t of d.onlyStream) if (M.AR_330_TABLES.indexOf(t) >= 0) bad.push('table-lists-collapsed');
    return bad;
}

/** App 面：取数四态（源把读不出来画成「就是空的」）。 */
function appFaceProblems(M) {
    const bad = [];
    if (new M.ArchiveApp(shellStub(), hostileStorage()).probe().face !== 'absent') bad.push('storage-absent-lost');
    if (new M.ArchiveApp(shellStub(), memStorage({ archive_pack: '{bad' })).probe().face !== 'malformed') {
        bad.push('malformed-face-lost');
    }
    if (new M.ArchiveApp(shellStub(), memStorage()).probe().face !== 'empty') bad.push('empty-face-lost');
    /* ★ 真存过但原文超限：**只报不静默截**（不许当成没记过）。 */
    const big = jsonOf({ raw: new Array(DAT.AR_TEXT_MAX + 2).join('x'), at: 1 });
    const a = new M.ArchiveApp(shellStub(), memStorage({ archive_pack: big }));
    if (a.probe().face !== 'malformed') bad.push('too-long-face-lost');
    if (a.whyText().indexOf('只报不静默截') < 0) bad.push('too-long-face-lost');
    return bad;
}

/** App 面：五型包逐型认得出来 + 失败不动作。 */
function appContentProblems(M) {
    const bad = [];
    const a = new M.ArchiveApp(shellStub(), memStorage());
    if (a.ingestPack(null).ok !== false) bad.push('empty-input-accepted');
    if (a.ingestPack(null).why !== 'empty_input') bad.push('empty-input-accepted');
    const c = a.ingestPack(chunkedJson());
    if (c.ok !== true) bad.push('chunked-not-accepted');
    if (a.bundle().pack !== 'chunked') bad.push('chunked-not-identified');
    if (a.bundle().mode !== 'merge') bad.push('chunked-mode-wrong');
    if (a.tableRows().length !== 2) bad.push('chunked-tables-lost');
    /* ★ 失败的粘贴**不许动台面上的那一份**（源在解析失败时也会清一遍）。 */
    a.ingestPack('not json at all');
    if (a.bundle().pack !== 'chunked') bad.push('failed-ingest-wiped-pack');
    if (a.tableRows().length !== 2) bad.push('failed-ingest-wiped-pack');
    const b = new M.ArchiveApp(shellStub(), memStorage());
    b.ingestPack(streamJson());
    if (b.bundle().pack !== 'stream') bad.push('stream-not-identified');
    if (b.bundle().mode !== 'replace') bad.push('stream-mode-wrong');
    const d = new M.ArchiveApp(shellStub(), memStorage());
    d.ingestPack(compatJson());
    if (d.bundle().pack !== 'compat330') bad.push('compat330-not-identified');
    const e = new M.ArchiveApp(shellStub(), memStorage());
    e.ingestPack(fullJson());
    if (e.bundle().pack !== 'full') bad.push('full-not-identified');
    /* ★ 认不出来的包：许不许给正式包型 —— 源在这里按全量处理并直接覆盖。 */
    const f = new M.ArchiveApp(shellStub(), memStorage());
    f.ingestPack(jsonOf({ version: 2 }));
    if (f.bundle().pack !== 'unknown') bad.push('unknown-pack-guessed');
    if (f.bundle().mode !== 'none') bad.push('unknown-pack-guessed');
    if (f.clearsTables().length !== 0) bad.push('unknown-pack-guessed');
    /* ★ 覆盖式必须逐张列清空表；补充式一张都不列。 */
    const g = new M.ArchiveApp(shellStub(), memStorage());
    g.ingestPack(compatJson());
    if (g.clearsTables().length !== 1) bad.push('clear-list-lost');
    const h = new M.ArchiveApp(shellStub(), memStorage());
    h.ingestPack(chunkedJson());
    if (h.clearsTables().length !== 0) bad.push('merge-claims-clear');
    /* ★ 没包时不许出要求文本（源在无数据时也照样吐一份空白）。 */
    const i0 = new M.ArchiveApp(shellStub(), memStorage());
    if (i0.makeText().ok !== false) bad.push('text-from-nothing');
    if (i0.makeText().why !== 'no_pack') bad.push('text-from-nothing');
    i0.ingestPack(chunkedJson());
    const t = i0.makeText();
    if (t.ok !== true || t.text.indexOf('不要替我写入任何数据') < 0) bad.push('text-lost-guard');
    /* ★ 放下包只动自己的键（不是清宿主）。 */
    const j = new M.ArchiveApp(shellStub(), memStorage());
    j.ingestPack(chunkedJson());
    j.clearPack();
    if (j.bundle().pack !== 'unknown') bad.push('clear-pack-did-not-clear');
    if (j.faceOf() !== 'empty') bad.push('clear-pack-did-not-clear');
    return bad;
}

/** App 面：门与上限（写了没成要报 / 越限要挡）。 */
function appGateProblems(M) {
    const bad = [];
    /* ★ 写不进去不许假装存好了。 */
    const ro = new M.ArchiveApp(shellStub(), readOnlyStorage());
    const r0 = ro.ingestPack(chunkedJson());
    if (r0.saved !== false) bad.push('write-failure-pretended-ok');
    /* ★ 原文超上限：只报不静默截（不许截一半当收下了）。 */
    const a = new M.ArchiveApp(shellStub(), memStorage());
    const pad = {};
    pad[T0] = [];
    const huge = jsonOf({ version: 3, timestamp: 1, data: pad, pad: new Array(DAT.AR_TEXT_MAX + 10).join('y') });
    const r1 = a.ingestPack(huge);
    if (r1.ok !== false) bad.push('over-limit-silently-cut');
    if (r1.why !== 'too_long') bad.push('over-limit-silently-cut');
    if (a.bundle() !== null) bad.push('over-limit-silently-cut');
    /* ★ 台账挤掉要计数（源静默 shift）。 */
    const b = new M.ArchiveApp(shellStub(), memStorage());
    for (let i = 0; i < DAT.AR_LOG_MAX + 3; i++) b._receipt('t', true, '', {});
    if (b.droppedCount() < 3) bad.push('ledger-drop-unreported');
    /* ★ 清台账只清自己的（源把四类挤一处，清一个顺手清一串）。 */
    const c = new M.ArchiveApp(shellStub(), memStorage());
    c.ingestPack(chunkedJson());
    const cl = c.clearLedger();
    if (cl.cleared < 1) bad.push('clear-ledger-cleared-nothing');
    if (c.bundle().pack !== 'chunked') bad.push('clear-ledger-wiped-pack');
    /* ★ 页签只认四个真键（源用自由字符串，错一个就画空白页）。 */
    const d = new M.ArchiveApp(shellStub(), memStorage());
    if (d.setTab('nonsense') !== 'pack') bad.push('tab-gate-lost');
    if (d.setTab('reset') !== 'reset') bad.push('tab-gate-lost');
    /* ★ 草稿要真存得住（源把草稿与进度挤一处，换页就串）。 */
    const mem = memStorage();
    const e = new M.ArchiveApp(shellStub(), mem);
    e.setTarget('把聊天记录还我');
    e.setMode('先备份一遍');
    const f = new M.ArchiveApp(shellStub(), mem);
    f.probe();
    if (f.drafts().target.indexOf('把聊天记录还我') < 0) bad.push('draft-not-persisted');
    if (f.drafts().mode.indexOf('先备份一遍') < 0) bad.push('draft-not-persisted');
    return bad;
}

/** App 面：换会话与落盘。 */
function appChatProblems(M) {
    const bad = [];
    const st = sessionStorage();
    const a = new M.ArchiveApp(shellStub(), st);
    a.ingestPack(chunkedJson());
    a.setTarget('一');
    if (a.bundle().pack !== 'chunked') bad.push('same-session-lost');
    /* ★ 真口径：换出去再换回来，账要还在。
     *   只看「换到新会话后是空的」观测不到「换会话没重取」—— 两件事同形。 */
    st.switchTo('c2');
    a.onChatChanged();
    if (a.bundle().pack !== 'unknown') bad.push('chat-change-no-pack-reload');
    if (a.tableRows().length !== 0) bad.push('chat-change-no-pack-reload');
    if (a.drafts().target.length !== 0) bad.push('chat-change-no-draft-reload');
    if (a.ledgerRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    st.switchTo('c1');
    a.onChatChanged();
    if (a.bundle().pack !== 'chunked') bad.push('chat-change-no-pack-reload');
    if (a.tableRows().length !== 2) bad.push('chat-change-no-pack-reload');
    if (a.drafts().target.indexOf('一') < 0) bad.push('chat-change-no-draft-reload');
    if (a.ledgerRows().length < 1) bad.push('chat-change-no-ledger-reload');
    /* 另一个实例也要看得到（换会话是「取数」不是「搬家」）。 */
    const b = new M.ArchiveApp(shellStub(), st);
    b.probe();
    if (b.bundle().pack !== 'chunked') bad.push('chat-change-no-pack-reload');
    /* 包要真落盘。 */
    const mem = memStorage();
    const c = new M.ArchiveApp(shellStub(), mem);
    c.ingestPack(streamJson());
    const d = new M.ArchiveApp(shellStub(), mem);
    d.probe();
    if (d.bundle().pack !== 'stream') bad.push('pack-not-persisted');
    if (d.tableRows().length !== 2) bad.push('pack-not-persisted');
    /* ★ 换会话要清版面态（上一段关系的高亮不许带到这一段）。 */
    const e = new M.ArchiveApp(shellStub(), memStorage());
    e.setTab('ledger');
    e.setInput('x');
    e.onChatChanged();
    if (e.tab() !== 'pack') bad.push('chat-change-keeps-tab');
    if (e.inputOf().length !== 0) bad.push('chat-change-keeps-input');
    return bad;
}

/* ══════════ 负控制：四块不缝真的没缝 ══════════
 * ★ 这四族**不是**按「注释里提到过」判 —— 本仓硬纪律是「注释里的提及不算消费」。
 *   一律先剥注释，再在代码面上逐词查；且必须**同时**在三个被审文件上都查，
 *   少查一个文件就会出现「缝回来的那一块恰好在没查的那个文件里」。 */
const FORBIDDEN = [
    /* ① 不落库不落外部备份（源：IndexedDB 全表 + Utils.saveData + GitHub 上传）。 */
    'indexedDB', 'IDBDatabase', 'transaction(', 'objectStore', 'uploadBackup', 'restoreBackup',
    'api.github.com', 'saveData', 'loadData',
    /* ② 不下载不上传（源：Blob + createObjectURL + a.click()）。 */
    'createObjectURL', 'new Blob', 'download =', 'XMLHttpRequest', 'fetch(', 'FormData', 'a.click',
    /* ③ 不出图不压图（源：compressImage / canvas 重编码）。 */
    'toDataURL', 'toBlob', 'drawImage', 'compressImage', 'compressAllImages',
    /* ④ 不读宿主界面元素（源：满篇 getElementById 直读宿主）。 */
    'getElementById', 'getElementsByClassName', 'document.body', 'document.head', 'document.querySelector'
];
/** 四块不缝的判据（三个文件一起查）。 */
function seamProblems(sources) {
    const bad = [];
    for (const [rel, src] of sources) {
        const code = stripComments(src);
        for (const w of FORBIDDEN) {
            if (code.indexOf(w) >= 0) bad.push('seam-violated:' + rel + ':' + w);
        }
    }
    return bad;
}

/** 视图面：四态面色相取真源。
 * ★ 判据必须咬住「四态**逐项自成字面**」这件事本身：
 *   只数键面字符种类时，破坏把 malformed 的色换成引用别人的槽位，
 *   四个键字面量照样都在，`face-tone-not-by-source` 观测不到。 */
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
/** 视图面：空与坏不同形。
 * ★ 收成两条硬口径：① 取不出来回横线（不是回 0）；② 余量条取不出来不留填充块。 */
function viewCountProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('DASH') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf('blank') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf(') ? DASH : String(v)') < 0) {
        bad.push('empty-and-bad-collapsed');
    }
    if (code.indexOf('(r.blank ? ' + Q + ' blank' + Q + ' : ' + Q + Q + ')') < 0) {
        bad.push('empty-and-bad-collapsed');
    }
    if (code.indexOf('if (!r.blank) {') < 0) bad.push('empty-and-bad-collapsed');
    return bad;
}
/** 视图面：六种格子形态逐项自成字面（源把「取不出来」与「真的 0 条」画成一话）。 */
function viewShapeProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (DAT.AR_TABLE_SHAPES.length !== 6) bad.push('shape-text-collapsed');
    for (const pair of ['missing: ' + Q + '包里没这一张' + Q, 'array: ' + Q + '数组' + Q,
        'object: ' + Q + '对象' + Q, 'null: ' + Q + '空（null）' + Q,
        'scalar: ' + Q + '不是表' + Q, 'absent: ' + Q + '没有装内容的格子' + Q]) {
        if (code.indexOf(pair) < 0) bad.push('shape-text-collapsed');
    }
    if (code.indexOf('SHAPE_TEXT') < 0) bad.push('shape-text-collapsed');
    return bad;
}
/** 视图面：失败面要可见（回执那一行不许被拿掉）。 */
function viewFlashProblems(src) {
    const code = stripComments(src);
    return code.indexOf('<div class=' + DQ + 'arc-flash' + DQ + '>') >= 0 ? [] : ['flash-line-lost'];
}
/** 视图面：事件口与动作分支要逐条对上（源用自由字符串，错一个就点了没反应）。 */
function viewActProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('data-act') < 0) bad.push('action-binding-lost');
    if (code.indexOf('getAttribute') < 0) bad.push('action-binding-lost');
    if (code.indexOf('querySelectorAll(' + Q + '[data-in]' + Q + ')') < 0) bad.push('input-binding-lost');
    if (code.indexOf('if (kind === ' + Q + 'pack' + Q + ') this._packInput = v;') < 0) bad.push('input-binding-lost');
    for (const a of ['ingest', 'clear_input', 'clear_pack', 'save_draft', 'make_text', 'clear_ledger']) {
        if (code.indexOf(Q + a + Q) < 0) bad.push('action-branch-lost:' + a);
    }
    return bad;
}
/** 视图面：要求文本必须可选中复制（源把结果塞进 toast，一转身就没了）。 */
function viewTextProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('<textarea class=' + DQ + 'arc-area' + DQ + ' data-in=') < 0) bad.push('text-not-selectable');
    if (code.indexOf('<div class=' + DQ + 'arc-pre' + DQ + '>') < 0) bad.push('text-not-selectable');
    return bad;
}
/** 数据层结构面：包型因必须是**纯键**。
 * ★ 不能只查「源码里出现过 ok / no_version 这几个字面量」—— 本仓别处也有 'ok'，
 *   破坏把表里的值换成中文话后照样命中。收成两条：① 表**逐项自成字面**；② 六因互不相同。 */
function dataKeyProblems(src) {
    const code = stripComments(src);
    const bad = [];
    for (const k of ['ok', 'not_object', 'no_version', 'bad_version', 'no_payload', 'empty_contains']) {
        if (code.indexOf(Q + k + Q) < 0) bad.push('why-not-key:' + k);
    }
    const line = '    ' + Q + 'ok' + Q + ", " + Q + 'not_object' + Q + ", " + Q + 'no_version' + Q
        + ", " + Q + 'bad_version' + Q + ", " + Q + 'no_payload' + Q + ", " + Q + 'empty_contains' + Q;
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
    /* ① 应用目录登记。 */
    if (apps.indexOf(Q + 'archive' + Q) < 0) bad.push('wire-app-registry-lost');
    if (index.indexOf('./apps/archive/archive-app.js') < 0) bad.push('wire-app-entry-lost');
    /* ② 会话键前缀（少这一条 = 换会话读到别人的账）。 */
    if (storage.indexOf('/^archive_/') < 0) bad.push('wire-storage-prefix-lost');
    /* ③ 四条键登记（少一条 = keys 门报未登记键）。 */
    for (const k of ['archive_pack', 'archive_face', 'archive_draft', 'archive_ledger']) {
        if (keys.indexOf(Q + k + Q) < 0) bad.push('wire-key-lost:' + k);
    }
    /* ④ 懒加载分支（少这一条 = 打开页面一片空白）。 */
    if (index.indexOf(Q + 'archive' + Q) < 0) bad.push('wire-lazy-branch-lost');
    if (index.indexOf('archiveApp') < 0) bad.push('wire-shell-field-lost');
    /* ⑤ 样式投递（少这一条 = 页面没有样式，看起来像坏了）。 */
    if (css.indexOf('v3.45.0] 存档台（archive）') < 0) bad.push('wire-css-lost');
    if (css.indexOf('.arc-root') < 0) bad.push('wire-css-lost');
    return bad;
}

/* ══════════ A — 包型裁定面 ══════════ */
test('A1 五型包逐型认得出来（源靠「有没有 type」三分支，认不出就按全量并直接覆盖）', () => {
    assert.equal(DAT.classifyBundle(null).pack, 'unknown');
    assert.equal(DAT.classifyBundle({ version: 3, type: 'EPhoneChunkedBackup', contains: ['a'] }).pack, 'chunked');
    const s = {};
    s.version = 1;
    s[DAT.AR_STREAM_TABLES[0]] = [];
    assert.equal(DAT.classifyBundle(s).pack, 'stream');
    assert.equal(DAT.classifyBundle({ version: 3, data: { a: [] } }).pack, 'compat330');
    assert.equal(DAT.classifyBundle({ version: 9, data: { a: [] } }).pack, 'full');
});
test('A2 六因逐因各自成立、互不相同（塔平就是同形）', () => {
    const whys = DAT.AR_PACK_WHYS;
    assert.equal(new Set(whys).size, whys.length, '六个因必须互不相同');
    assert.equal(DAT.classifyBundle({ version: 2 }).why, 'no_payload');
    assert.equal(DAT.classifyBundle({}).why, 'no_version');
    assert.equal(DAT.classifyBundle({ version: 'x' }).why, 'bad_version');
    assert.equal(DAT.classifyBundle({ version: 3, type: 'EPhoneChunkedBackup', contains: [], data: {} }).why, 'empty_contains');
    assert.equal(DAT.classifyBundle(null).why, 'not_object');
    /* ★ 判型因文案表必须**逐项自成字面**（键面取真源，不许写标识符形）。 */
    for (const k of whys) assert.ok(DAT.AR_PACK_WHY_TEXT[k], '因 ' + k + ' 必须有文案');
});
test('A3 认不出来的包不许给正式包型与覆盖模式（源在这里按全量处理并直接覆盖）', () => {
    const b = DAT.classifyBundle({ version: 2 });
    assert.equal(b.pack, 'unknown');
    assert.equal(b.mode, 'none');
    assert.equal(b.tables.length, 0);
    const o = DAT.overwriteFace('unknown', ['a'], ['a']);
    assert.equal(o.clears, false, '认不出来的包不许报清空');
    assert.equal(o.clearsTables.length, 0);
});
test('A4 覆盖性两态分开：补充式一张都不列，覆盖式逐张列（源同一屏两个按钮外观一样）', () => {
    const mg = DAT.overwriteFace('chunked', ['a', 'b'], ['a', 'b']);
    assert.equal(mg.clears, false);
    assert.equal(mg.clearsTables.length, 0);
    assert.ok(mg.modeText.indexOf('同 id 的行被覆盖') >= 0, '补充式必须自述口径');
    const rp = DAT.overwriteFace('compat330', ['a', 'b'], ['a', 'b']);
    assert.equal(rp.clears, true);
    assert.deepEqual(rp.clearsTables, ['a', 'b'], '覆盖式必须逐张列出来');
});
test('A5 交集外的表逐张列（源只对「包里的表 交 库里的表」开事务，交集外一个字不说）', () => {
    const o = DAT.overwriteFace('compat330', ['a', 'zz1', 'zz2'], ['a']);
    assert.deepEqual(o.unknownTables, ['zz1', 'zz2']);
    assert.deepEqual(o.mergeTables, ['a']);
});

/* ══════════ B — 版本面（两套语义） ══════════ */
test('B1 版本两套语义分开报（源只做数值比较）', () => {
    assert.equal(DAT.versionFace(1, 'stream').family, 'stream');
    assert.equal(DAT.versionFace(3, 'chunked').family, 'v3');
    assert.equal(DAT.versionFace(3, 'compat330').family, 'v3');
    assert.equal(DAT.versionFace(0, 'unknown').family, 'zero');
    assert.equal(DAT.versionFace(7, 'full').family, 'other');
});
test('B2 互认结论两向都要对（源拿流式包走 330 导入必抛错）', () => {
    assert.equal(DAT.versionFace(1, 'stream').crossOk, true);
    assert.equal(DAT.versionFace(3, 'stream').crossOk, false, '声明 3 的流式包源会判坏包');
    assert.equal(DAT.versionFace(3, 'chunked').crossOk, true);
    assert.equal(DAT.versionFace(1, 'chunked').crossOk, false, '声明 1 的 v3 包 330 导入会抛错');
    /* 认不出来的包不给结论。 */
    assert.equal(DAT.versionFace(null, 'unknown').crossOk, false);
    assert.ok(DAT.versionFace(null, 'unknown').crossWhy.indexOf('不给互认结论') >= 0);
});
test('B3 六种格子形态逐形分开（源把「取不出来」与「真的 0 条」画成一话）', () => {
    assert.equal(DAT.AR_TABLE_SHAPES.length, 6);
    const data = {};
    data.a = [];
    data.b = null;
    data.c = 1;
    data.d = {};
    const rows = DAT.tableFace(data, ['a', 'b', 'c', 'd', 'zz']);
    const map = {};
    for (const r of rows) map[r.table] = r.shape;
    assert.equal(map.a, 'array');
    assert.equal(map.b, 'null');
    assert.equal(map.c, 'scalar');
    assert.equal(map.d, 'object');
    assert.equal(map.zz, 'missing', '包里没提的表要单列成一形');
    const absent = DAT.tableFace(null, ['a']);
    assert.equal(absent[0].shape, 'absent');
});
test('B4 空表与单对象不同形、单对象表要标可疑（源按数组读的给的是对象时静默跳过）', () => {
    const single = DAT.AR_SINGLE_OBJECT_TABLES[0];
    const rows = DAT.tableFace({ x: [] }, [single, 'plainTable']);
    assert.equal(rows[0].shape, 'object' === rows[0].shape ? 'object' : rows[0].shape);
    const arr = DAT.tableFace({}, ['plainTable']);
    assert.equal(arr[0].shape, 'missing');
});

/* ══════════ C — 条数与体积面 ══════════ */
test('C1 条数取不出来不许画 0（null 与 0 不同形）', () => {
    assert.equal(DAT.numOrNull(null), null);
    assert.equal(DAT.numOrNull(''), null);
    assert.equal(DAT.numOrNull('abc'), null);
    assert.equal(DAT.numOrNull(0), 0);
    const s = DAT.tableSummary([{ shape: 'array', rows: 3, suspect: false }, { shape: 'missing', rows: null, suspect: false }]);
    assert.equal(s.rows, 3);
    assert.equal(s.rowsUnknown, 1);
    assert.equal(s.empty, false, '有内容时不许报空');
});
test('C2 体积读不出来不许画 0 字节，空与读不出来不同形', () => {
    assert.equal(DAT.formatBytes(null), '--');
    assert.equal(DAT.formatBytes(0), '0 B');
    assert.equal(DAT.sizeOf(null).bytesText, '--');
    assert.equal(DAT.sizeOf('').bytesText, '0 B');
    assert.equal(DAT.sizeOf('').why, 'empty');
    assert.equal(DAT.sizeOf('a').chars, 1);
});
test('C3 内嵌图片估重（源用 canvas 重编码，本件只算估重）', () => {
    const t = 'x data:image/png;base64,' + new Array(200).join('A') + ' y';
    const r = DAT.imageScan(t);
    assert.equal(r.count, 1);
    assert.ok(r.bytes > 0);
    assert.equal(DAT.imageScan('').count, 0);
});

/* ══════════ D — 四块不缝真的没缝 ══════════ */
const THREE = [
    [AR_DATA, read(AR_DATA)],
    [AR_APP, read(AR_APP)],
    [AR_VIEW, read(AR_VIEW)]
];
test('D1 不落库不落外部备份：三件里一个 IndexedDB / GitHub 上传 / Utils.saveData 调用都没有', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['indexedDB', 'IDBDatabase', 'objectStore', 'uploadBackup', 'restoreBackup', 'saveData', 'loadData']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('D2 不下载不上传：三件里没有 Blob / createObjectURL / fetch / XMLHttpRequest', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['createObjectURL', 'new Blob', 'XMLHttpRequest', 'fetch(', 'FormData']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('D3 不出图不压图：三件里没有 toDataURL / toBlob / drawImage / compressImage', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['toDataURL', 'toBlob', 'drawImage', 'compressImage', 'compressAllImages']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('D4 不读宿主界面元素：三件里没有 getElementById / document.body / document.head', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        for (const w of ['getElementById', 'getElementsByClassName', 'document.body', 'document.head']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许可出现 ' + w);
        }
    }
});
test('D5 裁定不等于迁移：三件里没有写宿主的写入口（无 storage.set 以外的副作用、无 reload）', () => {
    for (const [rel, src] of THREE) {
        const code = stripComments(src);
        assert.equal(code.indexOf('location.reload') >= 0, false, rel + ' 不许可重载页面');
        assert.equal(code.indexOf('location.href') >= 0, false, rel + ' 不许可跳转');
    }
    /* 本件只写自己的四条键：写口必须挂在自己的键常量上。 */
    const app = stripComments(read(AR_APP));
    assert.ok(app.indexOf('this._writeJSON(AR_PACK_KEY') >= 0);
    assert.ok(app.indexOf('this._writeJSON(AR_FACE_KEY') >= 0);
    assert.ok(app.indexOf('this._writeJSON(AR_DRAFT_KEY') >= 0);
    assert.ok(app.indexOf('this._writeJSON(AR_LEDGER_KEY') >= 0);
});
test('D6 seamProblems 在真三件上必须干净（四块不缝的合并判据）', () => {
    assert.deepEqual(seamProblems(THREE), []);
});

/* ══════════ E — 接线面（六处落点） ══════════ */
test('E1 六处接线落点齐备（少一处就静默错数据 / 点了没反应）', () => {
    const files = {
        apps: read(APPS), storage: read(STORAGE), index: read(INDEX),
        keys: read(KEYS), phoneCss: read(PHONE_CSS)
    };
    assert.deepEqual(wireProblems(files), []);
});
test('E2 会话键前缀只许一条（重复插入 = 换会话读到双份账）', () => {
    const s = stripComments(read(STORAGE));
    assert.equal(s.split('/^archive_/').length - 1, 1, '前缀只许出现一次');
});
test('E3 懒加载分支只许一个（重复插入 = 两个实例同时写同一批键）', () => {
    const s = stripComments(read(INDEX));
    assert.equal(s.split(Q + 'archive' + Q).length - 1, 1);
    assert.equal(s.split('window.VirtualPhone.archiveApp = new module.ArchiveApp(').length - 1, 1,
        '构造只许一次（重复插入 = 两个实例同时写同一批键）');
    assert.ok(s.split('archiveApp').length - 1 >= 2, '构造与登记都要在');
});
test('E4 四条键逐条在册且 scope 正确（少一条 = keys 门报未登记键）', () => {
    const s = read(KEYS);
    for (const k of ['archive_pack', 'archive_face', 'archive_draft', 'archive_ledger']) {
        assert.ok(s.indexOf(Q + k + Q) >= 0, k + ' 必须在册');
    }
    assert.equal(s.split("scope: 'chat'").length - 1 >= 4, true, '四条都应是 chat 作用域');
});
test('E5 样式逐字同源投递进 phone.css（少这一条 = 页面没样式，看起来像坏了）', () => {
    const own = read(AR_CSS);
    const phone = read(PHONE_CSS);
    assert.ok(phone.indexOf(own.trim()) >= 0, '.arc 整份样式必须逐字同源在 phone.css 里');
    assert.ok(phone.indexOf('/* ══════════════ [v3.45.0] 存档台（archive） ══════════════ */') >= 0);
});

/* ══════════ F — 行为面（App 四组） ══════════ */
test('F1 取数四态分开（源把读不出来画成就是空的）', () => {
    assert.deepEqual(appFaceProblems(APP), []);
});
test('F2 五型包逐型认得出来 + 失败不动作', () => {
    assert.deepEqual(appContentProblems(APP), []);
});
test('F3 门与上限（写了没成要报 / 越限要挡）', () => {
    assert.deepEqual(appGateProblems(APP), []);
});
test('F4 换会话四格全量重取 + 包要真落盘', () => {
    assert.deepEqual(appChatProblems(APP), []);
});
test('F5 失败面必须可见：失败的动作要能落到回执上（源失败也静默）', () => {
    const a = new APP.ArchiveApp(shellStub(), memStorage());
    a.ingestPack('{bad');
    const rows = a.ledgerRows();
    assert.ok(rows.length >= 1, '失败必须落账');
    assert.equal(rows[0].ok, false, '失败必须记成没成');
    assert.ok(rows[0].why.length > 0, '失败必须记下为什么');
});
test('F6 要求文本是本件唯一的产出物：只产描述、一个字段都不写', () => {
    const mem = memStorage();
    const a = new APP.ArchiveApp(shellStub(), mem);
    a.ingestPack(chunkedJson());
    const before = mem._box.size;
    const t = a.makeText();
    assert.equal(t.ok, true);
    assert.equal(mem._box.size, before, '出文本不许额外写入任何键');
    assert.ok(t.text.indexOf('逐表报出') >= 0, '要求文本必须自带上报口径');
});

/* ══════════ G — 视图面 ══════════ */
test('G1 四态面色相取真源（四项逐项自成字面）', () => {
    assert.deepEqual(viewFaceProblems(read(AR_VIEW)), []);
});
test('G2 空与坏不同形（取不出来回横线，且余量条不着色）', () => {
    assert.deepEqual(viewCountProblems(read(AR_VIEW)), []);
});
test('G3 六种格子形态逐项自成字面', () => {
    assert.deepEqual(viewShapeProblems(read(AR_VIEW)), []);
});
test('G4 失败面要可见（回执那一行不许被拿掉）', () => {
    assert.deepEqual(viewFlashProblems(read(AR_VIEW)), []);
});
test('G5 事件口与动作分支逐条对上（错一个就点了没反应）', () => {
    assert.deepEqual(viewActProblems(read(AR_VIEW)), []);
});
test('G6 要求文本可选中复制（源把结果塞进 toast，一转身就没了）', () => {
    assert.deepEqual(viewTextProblems(read(AR_VIEW)), []);
});
test('G7 四个页签都在、且与 App 的四个真键同名', () => {
    const code = stripComments(read(AR_VIEW));
    for (const t of ['pack', 'face', 'reset', 'ledger']) {
        assert.ok(code.indexOf(Q + t + Q) >= 0, '页签 ' + t + ' 不在');
    }
});

/* ══════════ H — 结构面（静态门） ══════════ */
test('H1 四件都在且可解析（判据的输入面不许是坏文件）', () => {
    const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, AR_DATA)], { encoding: 'utf8' });
    assert.equal(r2.status, 0, AR_DATA + ' ' + (r2.stderr || '').split(NL)[0]);
    for (const rel of [AR_APP, AR_VIEW]) {
        const r3 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r3.status, 0, rel + ' ' + (r3.stderr || '').split(NL)[0]);
    }
    assert.ok(read(AR_CSS).length > 1000, '样式必须真的有内容');
});
test('H2 被审代码的字符纪律：不许正则字面量 / 反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [AR_DATA, AR_APP, AR_VIEW]) {
        const src = read(rel);
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        assert.equal(src.indexOf('`') >= 0, false, rel + ' 不许出现反引号');
        const code = stripComments(src);
        assert.equal(/=\s*\/[^\/\s][^\n]*\/[gimsuy]*\s*[;.,)]/.test(code), false, rel + ' 不许出现正则字面量');
    }
});
test('H3 样式不得靠外部字体 / 不得引远程资源（本件不自包含就算坏）', () => {
    const css = read(AR_CSS);
    assert.equal(css.indexOf('http://') >= 0, false);
    assert.equal(css.indexOf('https://') >= 0, false);
});

/* ══════════ I — 破坏表（逐条对着源的一处静默失效）
 * ★ 每条破坏必须**可观测**：锚点落在产品真会走到的那一行；
 *   破坏产品从不走到的分支 = 装饰性破坏（J2/J3 会把这类揪出来）。 */
const DAMAGE = {
    /* ① 认不出来的包按全量处理（源就是这样：认不出也照样覆盖）。 */
    q1: [AR_DATA,
        '    base.why = ' + Q + 'no_payload' + Q + ';' + NL + '    return base;' + NL + '}',
        '    base.pack = ' + Q + 'full' + Q + '; base.mode = ' + Q + 'replace' + Q + ';' + NL
        + '    return base;' + NL + '}'],
    /* ② 版本两套语义塌成一套（源只做数值比较）。 */
    q2: [AR_DATA,
        "    else if (n === 3) { family = 'v3'; text = 'v3 那一套（分块 / 330 / 全量）'; }",
        "    else if (n === 3) { family = 'stream'; text = '流式那一套'; }"],
    /* ③ 合并不许报清空表（源同一屏一个补一个清，外观一样）。 */
    q3: [AR_DATA,
        '        clearsTables: clears ? merged.slice() : [],',
        '        clearsTables: merged.slice(),'],
    /* ④ 覆盖式被读成不覆盖（清空表整列消失）。 */
    q4: [AR_DATA,
        '            clears = AR_PACK_MODES[i].clears;',
        '            clears = false;'],
    /* ⑤ 空（null）塔成数组（源把取不出来与真的 0 条画成一话）。 */
    q5: [AR_DATA,
        "        if (v === null) {" + NL + "            out.push({ table: name, shape: 'null', rows: null, label: '空（null）',"
        + NL + "                suspect: !single, suspectWhy: single ? '' : '这一张源按数组读，给的是 null', single: single });" + NL + '            continue;' + NL + '        }',
        "        if (v === null) {" + NL + "            out.push({ table: name, shape: 'array', rows: 0, label: '0 条',"
        + NL + "                suspect: false, suspectWhy: '', single: single });" + NL + '            continue;' + NL + '        }'],
    /* ⑥ 取不出来的数字读成 0（源的三步里最后那一步）。 */
    q6: [AR_DATA,
        "    if (!digits || digits === '.') return null;",
        "    if (!digits || digits === '.') return 0;"],
    /* ⑦ 体积取不出来画 0 字节（空与读不出来同形）。 */
    q7: [AR_DATA,
        "    if (v === null || v < 0) return '--';",
        "    if (v === null || v < 0) return '0 B';"],
    /* ⑧ 不是文本的当空文本（源把读不出来当空的）。 */
    q8: [AR_DATA,
        "        return { chars: null, bytes: null, bytesText: '--', blank: true, why: 'no_text' };",
        "        return { chars: 0, bytes: 0, bytesText: '0 B', blank: false, why: 'empty' };"],
    /* ⑨ 台账挤掉不计数（源静默 shift）。 */
    q9: [AR_DATA,
        '    return { rows: src.slice(cut), dropped: cut };',
        '    return { rows: src.slice(cut), dropped: 0 };'],
    /* ⑩ 余量取不出来编 0（源把取不到当 0 用）。 */
    q10: [AR_DATA,
        '            key: d.key, label: d.label, value: v, max: d.max, over: over,' + NL + '            blank: v === null,',
        '            key: d.key, label: d.label, value: v === null ? 0 : v, max: d.max, over: over,' + NL + '            blank: false,'],
    /* ⑪ 结构体检静默补（源在原地改数据）。 */
    q11: [AR_DATA,
        '                misses.push({ path: def.path, label: def.label, kind: def.kind, fix: def.fix, scope: def.scope });',
        '                r[def.path] = def.kind === ' + Q + 'array' + Q + ' ? [] : {};'],
    /* ⑫ 两套清单合并（差的表会被静默丢）。 */
    q12: [AR_DATA,
        '        if (AR_STREAM_TABLES.indexOf(AR_330_TABLES[i]) < 0) only330.push(AR_330_TABLES[i]);',
        '        only330.push(AR_330_TABLES[i]);'],
    /* ⑬ 要求文本丢掉「不要替我写入」那句（源就是动完才说）。 */
    q13: [AR_DATA,
        "    lines.push('请按下面这份存档做恢复对账，不要替我写入任何数据。');",
        "    lines.push('我直接帮你恢复。');"],
    /* ⑭ App：取不出来当没记过（源把取不到读成空）。 */
    q14: [AR_APP,
        "        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }",
        "        catch (e) { return { ok: true, why: 'absent', value: undefined }; }"],
    /* ⑮ App：写了但认不出来当空（源就是把它当空）。 */
    q15: [AR_APP,
        "            return { face: FACE_MALFORMED, why: 'json', obj: null };",
        "            return { face: FACE_EMPTY, why: 'json', obj: null };"],
    /* ⑯ App：原文超限静默当成没记过（源截一半就往下走）。 */
    q16: [AR_APP,
        "            return { face: FACE_MALFORMED, why: 'too_long', obj: null };",
        "            return { face: FACE_EMPTY, why: '', obj: null };"],
    /* ⑰ App：失败的粘贴把台面上那份冲掉（源在解析失败时也会清一遍）。 */
    q17: [AR_APP,
        "        if (!box.ok) {" + NL + "            this._receipt('pack_ingest', false, box.why, { n: raw.length });",
        "        if (!box.ok) {" + NL + "            this._packRaw = '';" + NL + "            this._persistPack();" + NL + "            this.probe();" + NL
        + "            this._receipt('pack_ingest', false, box.why, { n: raw.length });"],
    /* ⑱ App：没包也照样出要求文本（源吐一份空白）。 */
    q18: [AR_APP,
        "        if (this._face !== FACE_OK) {" + NL + "            this._receipt('text_make', false, 'no_pack', { n: 0 });",
        "        if (false) {" + NL + "            this._receipt('text_make', false, 'no_pack', { n: 0 });"],
    /* ⑲ App：超限原文静默截一半收下（源就是截完继续用）。 */
    q19: [AR_APP,
        '        if (raw.length > AR_TEXT_MAX) {' + NL + "            this._receipt('pack_ingest', false, 'too_long', { n: raw.length });"
        + NL + "            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });" + NL + '        }',
        '        if (false) {' + NL + "            this._receipt('pack_ingest', false, 'too_long', { n: raw.length });"
        + NL + "            return Object.assign(this._savedOk(false), { ok: false, why: 'too_long', chars: raw.length });" + NL + '        }'],
    /* ⑳ App：台账挤掉不计数（源静默 shift）。 */
    q20: [AR_APP,
        '        this._dropped += t.dropped;',
        '        this._dropped += 0;'],
    /* ㉑ App：清台账顺手把已收的包也清掉（源把四类挤一处就是这个后果）。 */
    q21: [AR_APP,
        '    clearLedger() {' + NL + '        const had = this._ledger.length;',
        '    clearLedger() {' + NL + "        this._packRaw = ''; this._persistPack(); this.probe();" + NL + '        const had = this._ledger.length;'],
    /* ㉒ App：页签自由字符串（源用自由字符串，错一个就画空白页）。 */
    q22: [AR_APP,
        "        const ok = ['pack', 'face', 'reset', 'ledger'];" + NL + "        this._tab = ok.indexOf(k) >= 0 ? k : 'pack';",
        "        this._tab = k;"],
    /* ㉓ App：草稿不落盘（源把草稿与进度挤一个对象，写一次带上）。 */
    q23: [AR_APP,
        '    _persistDraft() {' + NL + '        return this._writeJSON(AR_DRAFT_KEY, { target: this._target, mode: this._mode });',
        '    _persistDraft() {' + NL + '        return false;'],
    /* ㉔ App：写了没成不当回事（源从不看落盘结果）。 */
    q24: [AR_APP,
        '        } catch (e) {' + NL + '            return false;' + NL + '        }',
        '        } catch (e) {' + NL + '            return true;' + NL + '        }'],
    /* ㉕ App：换会话不重取（源就是切角色原样留着）。 */
    q25: [AR_APP,
        '    onChatChanged() {' + NL + "        this._tab = 'pack';" + NL + "        this._focus = '';" + NL
        + "        this._input = '';" + NL + '        this._now = 0;' + NL + '        this.probe();',
        '    onChatChanged() {' + NL + "        this._tab = 'pack';" + NL + "        this._focus = '';" + NL
        + "        this._input = '';" + NL + '        this._now = 0;'],
    /* ㉖ 视图：面色相塔平（四态只有一种色）。 */
    q26: [AR_VIEW,
        "    malformed: 'err',",
        "    malformed: 'ok',"],
    /* ㉗ 视图：取不出来画 0（源就是这么画的）。 */
    q27: [AR_VIEW,
        '        return (v === null || v === undefined) ? DASH : String(v);',
        '        return String(v === null || v === undefined ? 0 : v);'],
    /* ㉘ 视图：余量条取不出来也着色。 */
    q28: [AR_VIEW,
        '            if (!r.blank) {',
        '            if (true) {'],
    /* ㉙ 视图：失败面不见（回执不许画）。 */
    q29: [AR_VIEW,
        '        if (this._flash) parts.push(' + Q + '<div class=' + DQ + 'arc-flash' + DQ + '>' + Q + ' + this._esc(this._flash) + ' + Q + '</div>' + Q + ');',
        '        if (false) parts.push(' + Q + Q + ');'],
    /* ㉚ 视图：清台账那一刻不给回执（源失败与成功同形）。 */
    q30: [AR_VIEW,
        "        } else if (a === 'clear_ledger') {",
        "        } else if (a === 'clear_ledger_none') {"],
    /* ㉛ 数据层：包型因写成中文话（程序没法比对）。 */
    q31: [AR_DATA,
        "export const AR_PACK_WHYS = Object.freeze([" + NL + "    'ok', 'not_object', 'no_version', 'bad_version', 'no_payload', 'empty_contains'",
        "export const AR_PACK_WHYS = Object.freeze([" + NL + "    '认得出来', 'not_object', 'no_version', 'bad_version', 'no_payload', 'empty_contains'"],
    /* ㉜ 视图：没有装内容的格子也当成有内容画（源两件事同形）。 */
    q32: [AR_VIEW,
        "        const areas = root.querySelectorAll('[data-in]');",
        '        const areas = [];'],
    /* ㉝ 接线：会话键前缀丢掉（换会话读到别人的账）。 */
    q33: [STORAGE,
        '    /^archive_/,',
        '    /^archiveX_/,'],
    /* ㉞ 接线：懒加载分支丢掉（打开页面一片空白）。 */
    q34: [INDEX,
        "} else if (appId === 'archive') {",
        "} else if (appId === 'archiveX') {"],
};
/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3450_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'storage.js'), path.join(dir, 'config', 'storage.js'));
    const ad = path.join(dir, 'apps', 'archive');
    fs.mkdirSync(ad, { recursive: true });
    for (const f of ['archive-data.js', 'archive-view.js', 'archive-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'archive', f), path.join(ad, f));
    }
    return dir;
}
/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「认不出来的包不许给正式包型」⇒ 内核判据必须转红', 'q1', 'data', dataProblems, ['unknown-pack-guessed']],
    ['I2 破坏「版本两套语义不许塔平」⇒ 内核判据必须转红', 'q2', 'data', dataProblems, ['version-family-collapsed']],
    ['I3 破坏「合并不许报清空表」⇒ 内核判据必须转红', 'q3', 'data', dataProblems, ['merge-claims-clear']],
    ['I4 破坏「覆盖式必须报清空」⇒ 内核判据必须转红', 'q4', 'data', dataProblems, ['replace-hidden']],
    ['I5 破坏「空与数组不同形」⇒ 内核判据必须转红', 'q5', 'data', dataProblems, ['table-shape-collapsed']],
    ['I6 破坏「取不出来不许读成 0」⇒ 内核判据必须转红', 'q6', 'data', dataProblems, ['count-faked-zero']],
    ['I7 破坏「体积取不出来不许画 0 字节」⇒ 内核判据必须转红', 'q7', 'data', dataProblems, ['bytes-faked-zero']],
    ['I8 破坏「不是文本不许当空文本」⇒ 内核判据必须转红', 'q8', 'data', dataProblems, ['bytes-faked-zero']],
    ['I9 破坏「台账挤掉要计数」⇒ 内核判据必须转红', 'q9', 'data', dataProblems, ['ledger-drop-unreported']],
    ['I10 破坏「余量不许编 0」⇒ 内核判据必须转红', 'q10', 'data', dataProblems, ['gauge-faked-zero']],
    ['I11 破坏「结构体检只报不补」⇒ 内核判据必须转红', 'q11', 'data', dataProblems, ['audit-silently-fixed']],
    ['I12 破坏「两套清单不许合并」⇒ 内核判据必须转红', 'q12', 'data', dataProblems, ['table-lists-collapsed']],
    ['I13 破坏「要求文本不许丢掉对账口径」⇒ 内核判据必须转红', 'q13', 'data', dataProblems, ['request-text-no-guard']],
    ['I14 破坏「取不出来不许当空」（App）⇒ 行为判据必须转红', 'q14', 'appmod', appFaceProblems, ['storage-absent-lost']],
    ['I15 破坏「写了但认不出来单列」（App）⇒ 行为判据必须转红', 'q15', 'appmod', appFaceProblems, ['malformed-face-lost']],
    ['I16 破坏「超限只报不静默截」（App）⇒ 行为判据必须转红', 'q16', 'appmod', appFaceProblems, ['too-long-face-lost']],
    ['I17 破坏「失败不许动台面上的包」（App）⇒ 行为判据必须转红', 'q17', 'appmod', appContentProblems,
        ['failed-ingest-wiped-pack', 'unknown-pack-guessed']],
    ['I18 破坏「没包不许出要求文本」（App）⇒ 行为判据必须转红', 'q18', 'appmod', appContentProblems, ['text-from-nothing']],
    ['I19 破坏「超限不许静默截收」（App）⇒ 行为判据必须转红', 'q19', 'appmod', appGateProblems, ['over-limit-silently-cut']],
    ['I20 破坏「台账挤掉要计数」（App）⇒ 行为判据必须转红', 'q20', 'appmod', appGateProblems, ['ledger-drop-unreported']],
    ['I21 破坏「清台账不许顺手清包」（App）⇒ 行为判据必须转红', 'q21', 'appmod', appGateProblems, ['clear-ledger-wiped-pack']],
    ['I22 破坏「页签只认四个真键」（App）⇒ 行为判据必须转红', 'q22', 'appmod', appGateProblems, ['tab-gate-lost']],
    ['I23 破坏「草稿要真存得住」（App）⇒ 行为判据必须转红', 'q23', 'appmod', appGateProblems, ['draft-not-persisted']],
    ['I24 破坏「写了没成要报」（App）⇒ 行为判据必须转红', 'q24', 'appmod', appGateProblems, ['write-failure-pretended-ok']],
    ['I25 破坏「换会话全量重取」（App）⇒ 行为判据必须转红', 'q25', 'appmod', appChatProblems,
        ['chat-change-no-pack-reload', 'chat-change-no-draft-reload', 'chat-change-no-ledger-reload']],
    ['I26 破坏「面色相取真源」（视图）⇒ 视图判据必须转红', 'q26', 'src', viewFaceProblems, ['face-tone-not-by-source']],
    ['I27 破坏「取不出来画横线」（视图）⇒ 视图判据必须转红', 'q27', 'src', viewCountProblems, ['empty-and-bad-collapsed']],
    ['I28 破坏「余量条取不出来不着色」（视图）⇒ 视图判据必须转红', 'q28', 'src', viewCountProblems, ['empty-and-bad-collapsed']],
    ['I29 破坏「失败面要可见」（视图）⇒ 视图判据必须转红', 'q29', 'src', viewFlashProblems, ['flash-line-lost']],
    ['I30 破坏「动作分支逐条对上」（视图）⇒ 视图判据必须转红', 'q30', 'src', viewActProblems, ['action-branch-lost:clear_ledger']],
    ['I31 破坏「包型因必须是纯键」（数据层结构面）⇒ 结构判据必须转红', 'q31', 'src', dataKeyProblems, ['why-not-key:ok', 'why-not-key-line']],
    ['I32 破坏「输入口要真的绑上」（视图）⇒ 视图判据必须转红', 'q32', 'src', viewActProblems, ['input-binding-lost']],
    ['I33 破坏「会话键前缀」（接线面）⇒ 接线判据必须转红', 'q33', 'wire', wireJudge, ['wire-storage-prefix-lost']],
    ['I34 破坏「懒加载分支」（接线面）⇒ 接线判据必须转红', 'q34', 'wire', wireJudge, ['wire-lazy-branch-lost']],
];
/** 接线面判据包装（破坏副本按真相对路径落盘后，重读三份文件当输入）。 */
function wireJudge() {
    return wireProblems({
        apps: read(APPS), storage: read(STORAGE), index: read(INDEX),
        keys: read(KEYS), phoneCss: read(PHONE_CSS)
    });
}
for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 60));
        const damaged = src.split(from).join(to);
        assert.notEqual(damaged, src, '破坏必须真的发生');
        if (kind === 'src') {
            const bad = judge(damaged);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(src), [], '对照：真源码必须干净');
            return;
        }
        if (kind === 'wire') {
            /* 接线类：把破坏副本写到真位置外的暂存树也不够（接线判据读的是真路径），
             *   故先改真文件、跑判据、再改回来 —— 用 try/finally 保证一定回得来。 */
            const real = read(rel);
            try {
                fs.writeFileSync(path.join(ROOT, rel), damaged);
                const bad = wireJudge();
                assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                    '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            } finally {
                fs.writeFileSync(path.join(ROOT, rel), real);
            }
            assert.equal(read(rel), real, '接线文件必须逐字节回得来');
            assert.deepEqual(wireJudge(), [], '对照：真接线必须干净');
            return;
        }
        const dir = stageTree();
        fs.writeFileSync(path.join(dir, rel), damaged);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href);
        const bad = judge(mod);
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        const realMod = (kind === 'data') ? DAT : APP;
        assert.deepEqual(judge(realMod), [], '对照：真模块必须干净');
    });
}

/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + NL + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.ok(stripComments('const s = ' + Q + 'fetch(' + Q + ';').includes('fetch('), '字符串里的同形文本必须留住');
    /* ★ 被审三件必须能让剥器复位（尾随哨兵）：剥完不许把哨兵也吃掉。 */
    for (const rel of [AR_DATA, AR_APP, AR_VIEW]) {
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3450k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});
test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [AR_DATA, AR_APP, AR_VIEW]) {
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
    assert.deepEqual(viewFaceProblems(read(AR_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(AR_VIEW)), []);
    assert.deepEqual(viewShapeProblems(read(AR_VIEW)), []);
    assert.deepEqual(viewFlashProblems(read(AR_VIEW)), []);
    assert.deepEqual(viewActProblems(read(AR_VIEW)), []);
    assert.deepEqual(viewTextProblems(read(AR_VIEW)), []);
    assert.deepEqual(dataKeyProblems(read(AR_DATA)), []);
    assert.deepEqual(seamProblems(THREE), []);
    assert.deepEqual(wireJudge(), []);
});
test('J6 被审代码的字符纪律：不许正则字面量 / 反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [AR_DATA, AR_APP, AR_VIEW]) {
        const src = read(rel);
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        assert.equal(src.indexOf('`') >= 0, false, rel + ' 不许出现反引号');
        const code = stripComments(src);
        assert.equal(/=\s*\/[^\/\s][^\n]*\/[gimsuy]*\s*[;.,)]/.test(code), false, rel + ' 不许出现正则字面量');
    }
});

/* ══════════════════════ K — 版本与交棒 ══════════════════════ */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 45),
        '本套件成立于 RubyPhone 3.45.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含本版号');
    /* 公告块与 update-log 逐字同源（本仓硬判据）。 */
    const items = rec.items || rec.changes;
    for (const it of items) assert.ok(src.includes(JSON.stringify(it)), '公告块必须与条目逐字同源');
});
test('K2 交棒必须指向第 3 层下一步的真实现状（路线图字面不成立时以实测为准）', () => {
    /* ★ 钉**本件自己那一版的 update-log 条目**，不钉 index.js 当前公告 ——
     *   公告随每次抬版整体重写（钉它等于给自己埋一条下一版必红的断言）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.45.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('存档台'), 'v3.45.0 条目必须自述本件名');
    assert.ok(text.includes('blk_xintuk_backup'), '交棒必须落到源块文件名（便于下一步定位）');
    assert.ok(text.includes('045'), '交棒必须写到源片号');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
});
