// tests/system-v3280.test.mjs — 自定义组件：工作台，不是运行器 [v3.28.0]
//
//   本版接的是素材缝合路线图 L1 余下小件里的**最后一件**：
//     自定义组件 —— 源 EPhone·xINOVO `js/modules/custom-widgets.js`（236 行 / 17009 字节）
//     + `settings/widget-presets.js`（22547 字节）+ uwu `widget_market`。
//
//   缝合**不是搬运**。源有四块东西本仓一处都不能有，本套件守的就是「它们没被搬进来」：
//     ① 源**执行用户代码**：`(new Function(settings.js))()`、`sandbox="allow-scripts"`、
//        CSP 里的 `unsafe-eval`。本仓**零动态求值**（tests/audit.test.mjs 的那一面），
//        故本件**一行用户代码都不执行**：只登记 / 对账 / 产描述 / 导出设计稿。
//     ② 源**自建 iframe + postMessage 桥**：随机令牌、bootstrap 注入、120 秒超时 pending 表。
//        本仓没有这套宿主契约（组件不跑，自然不需要桥），整块不缝。
//     ③ 源用 **sessionStorage** 存编辑草稿。本仓持久化一律走 PhoneStorage，草稿单列一把会话键。
//     ④ 源导出走 **Blob 下载**（Blob + createObjectURL + 下载锚点）：本仓不碰这两个浏览器 API，
//        收敛成纯字符串往返。
//
//   与源最本质的一条偏离：**源是运行器，本件是工作台**。
//   四条附带偏离：代码上限 200000 收到 20000；js 段改名 notes（不制造「写进去就会跑」的误解）；
//   组件 / 实例 / 变量 / 名称均设上限（源存独立库，本仓随会话存档走）；变量值的类型跟着变量类型走。
//
//   本套件守五类会**静默失效**的形态（都不报错、不崩溃，只是结果不对）：
//     A 内核：**变量按标签配对**（分两趟按下标对齐会让类型整体错配一格 —— 本轮实测踩到）/
//       死值必须留在对账里（否则 orphanDefaults 恒空、半条对账成摆设）/ 导出剔图片值 /
//       模板被删时宿主出口如实报 null（不编一个空模板）/ 注入只带文字变量的值（图片不该进上下文）；
//     B 接线：四处注册齐备 / 视图调用面必须闭合在 App 上（调了不存在的方法＝点到才炸）/
//       样式与 phone.css 逐字同源且每个产出的类名都有落点 / 前缀不与他人撞 /
//       data 层保持纯函数（不碰 window / DOM / 网络）；
//     F 键归属：四条新键在门禁账本里且 scope=chat；
//     G 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红（八条）；
//     H 判据工具自证：剥注释器两向、破坏表锚点在场且替换保真、副本目录结构可解析。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。副本按**真目录结构**建（<tmp>/apps/widget/widget-data.js
//   + <tmp>/config/num-gate.js），否则 `../../config/num-gate.js` 会解析到 /config/num-gate.js。
//
//   取段纪律（同 v3260 C3 / v3270 E3）：phone.css 是追加式产物，本段是**当前末段**，
//   故取段**取到文件尾**，但必须先自证「本段之后没有别的段头」（下版往后接段时这条会报红，
//   提醒把取法改成按下一个段头截断）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    WGT_REASONS, WGT_SIZES, WGT_VAR_TYPES, WGT_LIMITS,
    defaultWgtSettings, normalizeWgtSettings, extractVars, normalizeTemplate, normalizeTemplates,
    normalizeInstance, normalizeInstances, reconcileVars, upsertTemplate, removeTemplate,
    addInstance, removeInstance, setInstanceVar, toHostPayload, shareTemplate, toExportText,
    fromImportText, aiPrompt, projectWidget, readWidgetFace, widgetPromptBlock,
} from '../apps/widget/widget-data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WGT_REL = 'apps/widget/widget-data.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 固定「现在」：实例创建时间是时间逻辑，判据必须与真实时钟解耦。 */
const NOW = 1759000000000;

/** 剥注释（字符状态机，与 v3200 / v3201 / v3250 / v3260 / v3270 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（new Function、iframe、sessionStorage、
 *    Blob、postMessage…）是**说明**不是**消费**。判据必须自己实现一遍：不许用被审对象
 *    自己的实现来审它自己。 */
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
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A1 变量按标签配对：类型不得整体错配一格；去重 / 封顶 / 禁名 ── */
function wgtVarProblems(api) {
    const bad = [];
    const L = api.WGT_LIMITS;
    /* ★ 本轮实测踩到的形态：第一个变量不写 type、第二个写了 image。
     *   分两趟各扫一遍再按下标对齐 ⇒ 类型整体错配一格（把 image 判给第一个变量）。 */
    const pair = api.extractVars('<span data-widget-var="a"></span><img data-widget-var="b" data-widget-type="image"><i data-widget-var="c" data-widget-type="bogus"></i>');
    const want = [{ name: 'a', type: 'text' }, { name: 'b', type: 'image' }, { name: 'c', type: 'text' }];
    if (JSON.stringify(pair) !== JSON.stringify(want)) bad.push('pair:' + JSON.stringify(pair));
    /* 单引号属性、属性顺序颠倒都要认。 */
    const flex = api.extractVars("<i data-widget-type='image' data-widget-var='p'></i>");
    if (flex.length !== 1 || flex[0].name !== 'p' || flex[0].type !== 'image') bad.push('flex:' + JSON.stringify(flex));
    /* 同名去重按**首次出现**（后一条的 type 不得覆盖前一条）。 */
    const dup = api.extractVars('<i data-widget-var="x" data-widget-type="text"></i><i data-widget-var="x" data-widget-type="image"></i>');
    if (dup.length !== 1 || dup[0].type !== 'text') bad.push('dup:' + JSON.stringify(dup));
    /* 只在**同一个标签内**配对：邻居的 type 不得被借过来。 */
    const cross = api.extractVars('<i data-widget-var="m"></i><b data-widget-type="image"></b>');
    if (cross.length !== 1 || cross[0].type !== 'text') bad.push('cross-tag:' + JSON.stringify(cross));
    /* 不在标签里的同形文本不算声明（本件不解析文本，只认标签属性）。 */
    if (api.extractVars('文本里说 data-widget-var="x" 但不在标签里').length !== 0) bad.push('text-not-decl');
    /* 禁名 / 空名 / 纯空白名一律不认。 */
    for (const n of ['__proto__', 'constructor', 'prototype']) {
        if (api.extractVars('<i data-widget-var="' + n + '"></i>').length !== 0) bad.push('forbidden-name:' + n);
    }
    if (api.extractVars('<i data-widget-var="   "></i>').length !== 0) bad.push('blank-name');
    /* 名字长度封顶（超长名不炸面板）。 */
    const longName = api.extractVars('<i data-widget-var="' + 'n'.repeat(30) + '"></i>');
    if (longName.length !== 1) bad.push('name-cap-len:' + longName.length);
    else if (longName[0].name.length !== L.maxVarNameLen) bad.push('name-cap:' + JSON.stringify(longName));
    /* 个数封顶：声明 30 个只收 maxVars 个（顺序保持）。 */
    let manyHtml = '';
    for (let i = 0; i < 30; i += 1) manyHtml += '<i data-widget-var="v' + i + '"></i>';
    const many = api.extractVars(manyHtml);
    if (many.length !== L.maxVars) bad.push('vars-cap:' + many.length);
    /* ★ 必须是 else-if：破坏副本下 many 可能是空表，`many[many.length - 1].name` 会抛，
     *   一抛就把「同款真判据」变成异常，负控制拿到的是崩溃而不是判据结论。 */
    else if (many[0].name !== 'v0' || many[many.length - 1].name !== 'v' + (many.length - 1)) bad.push('vars-order');
    /* 空输入如实成空表（不抛）。 */
    if (api.extractVars('').length !== 0 || api.extractVars(null).length !== 0 || api.extractVars(undefined).length !== 0) bad.push('empty-input');
    return bad;
}

/* ── A2 模板规范化：死值要留 / 上限截断不拒收 / 导出剔图片值 ── */
function wgtTemplateProblems(api) {
    const bad = [];
    const L = api.WGT_LIMITS;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    if (api.normalizeTemplate({}) !== null || api.normalizeTemplate(null) !== null) bad.push('no-name-null');
    /* 只有名称也允许（占位模板是合法起点 —— 源新建时给的默认 html 就是一小段）。 */
    const blank = api.normalizeTemplate({ name: '占位' });
    if (!blank || blank.html !== '' || blank.vars.length !== 0) bad.push('blank-ok');
    /* 四档尺寸与源同；非法档落回默认。 */
    if (api.WGT_SIZES.join(',') !== '1x1,2x2,4x2,4x4') bad.push('sizes:' + api.WGT_SIZES.join(','));
    if (api.normalizeTemplate({ name: 'x', size: '9x9' }).size !== '2x2') bad.push('size-fallback');
    /* 三段代码一律截到上限，**不因超长整条拒收**。 */
    const long = api.normalizeTemplate({ name: '长', html: 'h'.repeat(L.maxHtmlLen + 50), css: 'c'.repeat(L.maxCssLen + 50), notes: 'n'.repeat(L.maxNotesLen + 50) });
    if (long.html.length !== L.maxHtmlLen || long.css.length !== L.maxCssLen || long.notes.length !== L.maxNotesLen) bad.push('caps:' + [long.html.length, long.css.length, long.notes.length].join('/'));
    /* ★ 死值必须留在对账里：HTML 改过之后留下的旧默认值不能被静默丢掉
     *   （丢了 ⇒ reconcileVars 的 orphanDefaults 恒为空，那半条对账成摆设 —— 本轮实测踩到）。 */
    const dead = api.normalizeTemplate({ name: 'd', html: '<i data-widget-var="a"></i>', defaults: { a: '1', gone: '2' } });
    if (!has(dead.defaults, 'gone')) bad.push('dead-default-dropped');
    const rec = api.reconcileVars(dead);
    if (rec.orphanDefaults.join() !== 'gone') bad.push('orphan:' + rec.orphanDefaults.join());
    if (rec.missingDefaults.length !== 0) bad.push('missing-not-empty:' + rec.missingDefaults.join());
    /* 漏配默认值要**如实报**（不是「显示空白」，是「漏配」）。 */
    const miss = api.reconcileVars(api.normalizeTemplate({ name: 'm', html: '<i data-widget-var="z"></i>' }));
    if (miss.missingDefaults.join() !== 'z') bad.push('missing:' + miss.missingDefaults.join());
    /* 禁名键不进 defaults（防原型污染）。 */
    const forb = api.normalizeTemplate({ name: 'f', defaults: { ['__proto__']: 'p', constructor: 'c', prototype: 'z' } });
    if (Object.keys(forb.defaults).length !== 0) bad.push('forbidden-keys:' + Object.keys(forb.defaults).join());
    /* 值一律转字符串并截断；null/undefined 不收（那不是「默认值」）。 */
    const vals = api.normalizeTemplate({ name: 'v', defaults: { a: 12, b: null, c: undefined, d: 'x'.repeat(L.maxVarValueLen + 5) } });
    if (vals.defaults.a !== '12') bad.push('num-to-str:' + vals.defaults.a);
    if (has(vals.defaults, 'b') || has(vals.defaults, 'c')) bad.push('null-kept');
    const dv = String(vals.defaults.d === undefined ? '' : vals.defaults.d);
    if (dv.length !== L.maxVarValueLen) bad.push('val-cap:' + dv.length);
    /* 条数封顶。 */
    const manyDefs = {};
    for (let i = 0; i < L.maxDefaults + 10; i += 1) manyDefs['k' + i] = 'x';
    if (Object.keys(api.normalizeTemplate({ name: 'md', defaults: manyDefs }).defaults).length !== L.maxDefaults) bad.push('defaults-cap');
    /* 导出：剔图片值、留文本默认值与备注；导出的东西里**不得出现图片值**。 */
    const t = api.normalizeTemplate({ name: '便签', html: '<i data-widget-var="title"></i><img data-widget-var="pic" data-widget-type="image">', notes: '备注', defaults: { title: 'T', pic: 'blob:x' } });
    const sh = api.shareTemplate(t);
    if (has(sh.defaults, 'pic')) bad.push('share-strips-image');
    if (sh.defaults.title !== 'T' || sh.notes !== '备注') bad.push('share-keeps-text');
    const txt = api.toExportText([t]);
    if (!txt.includes('ruby-phone.widget')) bad.push('export-kind');
    if (txt.includes('blob:x')) bad.push('export-leaks-image-value');
    const back = api.fromImportText(txt);
    if (!back.ok || back.templates.length !== 1) bad.push('roundtrip:' + JSON.stringify(back && back.reason));
    if (has(back.templates[0].defaults, 'pic')) bad.push('roundtrip-image-default');
    /* 裸数组也收（用户手写的 [{...}]）；坏输入如实报原因，**不抛**。 */
    if (api.fromImportText('[{"name":"裸"}]').templates.length !== 1) bad.push('bare-array');
    const reasons = [['', 'empty'], ['{', 'bad-json'], ['{"a":1}', 'bad-shape'], ['[{"x":1}]', 'no-valid-template'], ['[]', 'no-valid-template']];
    for (const [s, wantReason] of reasons) {
        const r = api.fromImportText(s);
        if (r.ok !== false || r.reason !== wantReason) bad.push('import-reason:' + JSON.stringify(s) + '=' + r.ok + '/' + r.reason);
    }
    /* 给 AI 的说明：形态是产物，且**必须写明本仓不执行代码**（写成「会执行」是骗用户）。 */
    const ap = api.aiPrompt('做个时钟', null);
    if (!ap.includes('做个时钟')) bad.push('ai-request');
    if (!ap.includes('不执行')) bad.push('ai-honest');
    const ap2 = api.aiPrompt('改改', { html: '<i></i>', css: 'x', notes: 'y' });
    if (!ap2.includes('<i></i>')) bad.push('ai-current-code');
    /* 空需求也要给出可复制的骨架（不能返回空串）。 */
    if (api.aiPrompt('', null).length < 80) bad.push('ai-empty');
    return bad;
}

/* ── A3 实例 / 桌面对账：主组件被删要如实计数、改值拒收幽灵变量 ── */
function wgtInstanceProblems(api) {
    const bad = [];
    const L = api.WGT_LIMITS;
    const ts = api.normalizeTemplates([
        { id: 't1', name: '便签', size: '2x2', html: '<i data-widget-var="title"></i><img data-widget-var="pic" data-widget-type="image">', defaults: { title: 'T' } },
        { id: 't2', name: '相框', size: '4x4', html: '<img data-widget-var="photo" data-widget-type="image">' },
    ]);
    if (ts.length !== 2) bad.push('templates:' + ts.length);
    /* 摆一个：变量初始值照模板默认值走（漏配的就是空串，不编值）。 */
    const a1 = api.addInstance(ts, [], 't1', NOW);
    if (!a1.ok || a1.instances.length !== 1) bad.push('add:' + JSON.stringify(a1.error));
    const inst = a1.instances[0];
    /* 变量初始值照模板默认值走：有默认值的带键、没默认值的**不编空串键**（缺就是缺）。 */
    if (inst.vars.title !== 'T' || ('pic' in inst.vars)) bad.push('init-vars:' + JSON.stringify(inst.vars));
    if (inst.size !== '2x2' || inst.createdAt !== NOW) bad.push('inst-meta');
    /* 模板不存在 ⇒ 拒收（不摆一个指向空气的实例）。 */
    if (api.addInstance(ts, [], 'nope', NOW).ok !== false) bad.push('add-ghost');
    /* 去掉 templateId 的输入一律不认。 */
    if (api.normalizeInstance({ name: 'x' }) !== null) bad.push('inst-no-tpl');
    /* 改值：变量名不在模板声明里 ⇒ 拒收（防手滑写出死键）。 */
    const okSet = api.setInstanceVar(ts, a1.instances, inst.id, 'title', '改了');
    if (!okSet.ok || okSet.instances[0].vars.title !== '改了') bad.push('set-var');
    const badSet = api.setInstanceVar(ts, a1.instances, inst.id, 'nosuch', 'x');
    if (badSet.ok !== false) bad.push('set-ghost-var');
    const badSet2 = api.setInstanceVar(ts, a1.instances, 'noid', 'title', 'x');
    if (badSet2.ok !== false) bad.push('set-ghost-inst');
    /* 值一律转字符串并截断。 */
    const big = api.setInstanceVar(ts, a1.instances, inst.id, 'title', 'y'.repeat(L.maxVarValueLen + 9));
    if (big.instances[0].vars.title.length !== L.maxVarValueLen) bad.push('inst-val-cap');
    /* ★ 主组件被删 ⇒ 实例**不静默消失**，而是计成 orphan（界面要说得出「原组件已删」）。 */
    const two = api.addInstance(ts, a1.instances, 't2', NOW + 1);
    const del = api.removeTemplate(ts, 't2');
    if (!del.ok || del.templates.length !== 1) bad.push('del-tpl');
    const p = api.projectWidget(del.templates, two.instances);
    if (p.orphanCount !== 1) bad.push('orphan:' + p.orphanCount);
    if (p.instanceCount !== 2) bad.push('orphan-not-deleted:' + p.instanceCount);
    /* 模板数 / 实例数封顶（源存独立库无上限，本仓随会话存档走）。 */
    let manyT = [];
    for (let i = 0; i < L.maxTemplates + 5; i += 1) manyT = api.upsertTemplate(manyT, { name: 't' + i }).templates;
    if (manyT.length !== L.maxTemplates) bad.push('tpl-cap:' + manyT.length);
    const full = api.upsertTemplate(manyT, { name: '多出来的' });
    if (full.ok !== false || !full.error) bad.push('tpl-cap-error');
    /* 更新（同 id）不占新坑位。 */
    const upd = api.upsertTemplate(manyT, { id: manyT[0].id, name: '改名' });
    if (!upd.ok || upd.templates.length !== L.maxTemplates || upd.templates[0].name !== '改名') bad.push('tpl-update');
    return bad;
}

/* ── A4 宿主出口 / 归因 / 注入：只产描述、不执行；注入只带文字值 ── */
function wgtProjectProblems(api) {
    const bad = [];
    if (api.readWidgetFace(null) !== api.WGT_REASONS.storage_absent) bad.push('face-null');
    if (api.readWidgetFace({ storageOk: false, hasAny: true }) !== api.WGT_REASONS.storage_absent) bad.push('face-absent-first');
    if (api.readWidgetFace({ storageOk: true, hasAny: false }) !== api.WGT_REASONS.empty) bad.push('face-empty');
    if (api.readWidgetFace({ storageOk: true, hasAny: true }) !== api.WGT_REASONS.ready) bad.push('face-ready');
    const ts = api.normalizeTemplates([
        { id: 't1', name: '便签', size: '2x2', html: '<i data-widget-var="title" data-widget-type="text"></i><i data-widget-var="body" data-widget-type="text"></i><img data-widget-var="pic" data-widget-type="image">', css: '.a{}', notes: 'n', defaults: { title: '今天' } },
    ]);
    const a1 = api.addInstance(ts, [], 't1', NOW);
    const inst = a1.instances[0];
    const withPic = api.setInstanceVar(ts, a1.instances, inst.id, 'pic', 'data:image/png;base64,ZZZ');
    const ins = api.setInstanceVar(ts, withPic.instances, inst.id, 'body', '写点什么');
    /* 宿主出口：纯数据、带代码、如实报 renderable。 */
    const hp = api.toHostPayload(ts, ins.instances);
    if (hp.length !== 1) bad.push('hp-len');
    if (!hp[0].renderable || !hp[0].template || hp[0].template.html !== ts[0].html) bad.push('hp-template');
    if (hp[0].template.css !== '.a{}') bad.push('hp-css');
    if (hp[0].vars.pic.indexOf('data:image') !== 0) bad.push('hp-vars');
    /* ★ 模板被删 ⇒ 如实报 null、renderable=false（不编一个空模板出来）。 */
    const orphan = api.toHostPayload(api.removeTemplate(ts, 't1').templates, ins.instances);
    if (orphan[0].template !== null || orphan[0].renderable !== false) bad.push('hp-orphan:' + JSON.stringify(orphan[0].template));
    /* 投影读数：每一格都能手算出来。 */
    const p = api.projectWidget(ts, ins.instances);
    if (p.templateCount !== 1 || p.instanceCount !== 1) bad.push('proj-count');
    if (p.varCount !== 3 || p.imageVarCount !== 1) bad.push('proj-vars:' + p.varCount + '/' + p.imageVarCount);
    if (p.missingDefaultCount !== 2) bad.push('proj-missing:' + p.missingDefaultCount);
    if (p.orphanCount !== 0 || p.hasAny !== true) bad.push('proj-orphan');
    if (p.bySize['2x2'] !== 1 || p.bySize['1x1'] !== 0) bad.push('proj-bysize:' + JSON.stringify(p.bySize));
    /* 注入：一个实例都没有 ⇒ 空串（不产生空块）。 */
    const set = api.defaultWgtSettings();
    if (api.widgetPromptBlock(ts, [], set) !== '') bad.push('inject-none');
    if (api.widgetPromptBlock(ts, ins.instances, { ...set, injectToPrompt: false }) !== '') bad.push('inject-off');
    if (api.widgetPromptBlock(ts, ins.instances, { ...set, maxInjectLines: 0 }) !== '') bad.push('inject-max0');
    const txt = api.widgetPromptBlock(ts, ins.instances, set);
    if (!txt.includes('便签')) bad.push('inject-name:' + txt);
    if (!txt.includes('title=今天')) bad.push('inject-text-val:' + txt);
    if (txt.includes('data:image')) bad.push('inject-leaks-image');
    if (txt.includes('.a{}')) bad.push('inject-leaks-code');
    /* 主组件被删之后，注入里必须**说得出**这一格「原组件已删除」（不静默少一行）。
     *   ★ 不能用上面那串（ts 完整）判这件事 —— 那样只有「已删除」这四个字写进模板名才碰巧绿。 */
    const orphanTpl = api.removeTemplate(ts, 't1').templates;
    const orphanTxt = api.widgetPromptBlock(orphanTpl, ins.instances, set);
    if (!orphanTxt.includes('原组件已被删除')) bad.push('inject-orphan-label:' + orphanTxt);
    /* maxInjectLines 只影响条数，不影响单个实例里的变量条数（没在注入里的实例不数）。 */
    const t3 = api.normalizeTemplates([
        { id: 'a', name: '甲', html: '<i data-widget-var="v"></i>' },
        { id: 'b', name: '乙', html: '<i data-widget-var="v"></i>' },
        { id: 'c', name: '丙', html: '<i data-widget-var="v"></i>' },
    ]);
    let many = [];
    for (const id of ['a', 'b', 'c']) many = api.addInstance(t3, many, id, NOW).instances;
    const t2txt = api.widgetPromptBlock(t3, many, { ...set, maxInjectLines: 2 });
    /* 一个块头 + 最多 maxInjectLines 行（块头那行不算注入条数）。 */
    if (t2txt.split('\n').length - 1 !== 2) bad.push('inject-lines:' + t2txt);
    /* 设置钳制：读不出回落默认、越界夹住、非布尔按布尔处理。 */
    const s = api.normalizeWgtSettings({ maxInjectLines: 999, defaultSize: '9x9', injectToPrompt: 'yes' });
    if (s.maxInjectLines !== 12) bad.push('clamp-lines:' + s.maxInjectLines);
    if (s.defaultSize !== '2x2') bad.push('clamp-size:' + s.defaultSize);
    if (s.injectToPrompt !== true) bad.push('inject-strict-true');
    const s2 = api.normalizeWgtSettings({ maxInjectLines: '' });
    if (s2.maxInjectLines !== api.defaultWgtSettings().maxInjectLines) bad.push('empty-not-zero:' + s2.maxInjectLines);
    if (api.normalizeWgtSettings({ injectToPrompt: false }).injectToPrompt !== false) bad.push('inject-false-kept');
    return bad;
}

/* ══════════════════════ 用例 ══════════════════════ */
test('A1 变量按标签配对：第一个变量不写 type 也不得让类型整体错配一格', () => {
    const bad = wgtVarProblems({ WGT_LIMITS, extractVars });
    assert.deepEqual(bad, [], '变量提取口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.deepEqual(WGT_VAR_TYPES.slice(), ['text', 'image'], '源 data-widget-type 只认这两种');
    assert.equal(WGT_LIMITS.maxVars, 24, '单模板变量数上限（源无上限，本仓随会话存档走）');
    assert.equal(WGT_LIMITS.maxHtmlLen, 20000, '代码上限（源 200000 存在独立 IndexedDB 库，本仓随会话存档走）');
});

test('A2 模板规范化：死值必须留在对账里（否则 orphanDefaults 恒空）、导出剔图片值', () => {
    const bad = wgtTemplateProblems({
        WGT_LIMITS, WGT_SIZES, extractVars, normalizeTemplate, reconcileVars,
        shareTemplate, toExportText, fromImportText, aiPrompt,
    });
    assert.deepEqual(bad, [], '模板与导入导出口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(WGT_LIMITS.maxDefaults, 48, '默认值条数上限（含死值）');
});

test('A3 实例与桌面对账：主组件被删不静默消失、改值拒收幽灵变量', () => {
    const bad = wgtInstanceProblems({
        WGT_LIMITS, normalizeTemplates, normalizeInstance, upsertTemplate, addInstance, removeTemplate,
        setInstanceVar, projectWidget,
    });
    assert.deepEqual(bad, [], '实例口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(WGT_LIMITS.maxTemplates, 60, '组件数上限');
    assert.equal(WGT_LIMITS.maxInstances, 60, '桌面实例数上限');
});

test('A4 宿主出口只产描述（不执行）、归因先判可读、注入只带文字值', () => {
    const bad = wgtProjectProblems({
        WGT_REASONS, defaultWgtSettings, normalizeWgtSettings, normalizeTemplates, addInstance,
        setInstanceVar, removeTemplate, toHostPayload, projectWidget, readWidgetFace, widgetPromptBlock,
    });
    assert.deepEqual(bad, [], '投影与注入口径必须与设计一致，实测问题：' + bad.join(' , '));
    /* 视图文案表的键必须取归因常量的**值**（连字符形），不另写一套下划线形。 */
    const view = read('apps/widget/widget-view.js');
    assert.ok(view.includes('[WGT_REASONS.'), '视图文案表必须由归因常量计算键');
    assert.ok(read(WGT_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ══════════════════════ E ── 接线（四处注册 + 调用面 + 样式 + 前缀 + 纯函数） ══════════════════════ */
const WID = 'widget';
const WCLS = 'WidgetApp';
const WSLOT = 'widgetApp';
const WPREF = '.wgt-';
const WBARE = 'wgt-';
/** 本版段的段头（E3 靠它取段）。 */
const WSEG = '/* ---------- [v3.28.0] 自定义组件 App（.wgt-*） ---------- */';

test('E1 四处注册齐备：APPS / 懒加载分支 / REBIND 表 / 会话键前缀', () => {
    const idx = read('index.js');
    const apps = read('config/apps.js');
    const storage = read('config/storage.js');
    const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(tbl.length > 0, 'index.js 必须有 ST_PHONE_REBIND_APP_KEYS 表');
    assert.ok(apps.includes("id: '" + WID + "'"), 'config/apps.js 必须登记 id: ' + WID);
    assert.ok(apps.includes("'自定义组件'"), 'APPS 条目必须带中文名（设置页/桌面读的就是它）');
    assert.ok(idx.includes("appId === '" + WID + "'"), 'index.js 必须有懒加载分支 ' + WID);
    assert.ok(idx.includes("import('./apps/" + WID + "/" + WID + "-app.js')"), '分支必须指向真实路径 apps/' + WID);
    assert.ok(idx.includes('new module.' + WCLS + '('), WCLS + ' 必须被构造');
    /* ★ 槽位名是**驼峰**（window.VirtualPhone.widgetApp），不是 `<前缀>App`（前缀是小写）。
     *   REBIND 表与换会话清理按的就是这个**槽位**：名字对不上时换会话不会重绑，而门禁不报错。 */
    assert.ok(idx.includes('window.VirtualPhone.' + WSLOT + ' = new module.' + WCLS + '('),
        'index.js 必须把 ' + WCLS + ' 留在 window.VirtualPhone.' + WSLOT);
    assert.ok(tbl.includes("'" + WSLOT + "'"), 'REBIND 表必须含 ' + WSLOT + ' 槽位');
    assert.ok(storage.includes('/^' + WID + '_/'), '会话隔离表必须有 /^' + WID + '_/');
    /* 换会话必须丢草稿：本 App 自己实现了 onChatChanged（否则 REBIND 重绑会调到 undefined）。 */
    assert.ok(read('apps/' + WID + '/' + WID + '-app.js').includes('onChatChanged()'), 'App 必须实现 onChatChanged');
});

test('E2 视图调用面必须闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* 本仓记过的形态（v3250 修正过两处）：视图 `this.app.xxx()` 而 App 上根本没有 xxx，
     * 界面在**用户真的点到那个按钮时**才炸，平时完全看不出来。这里做成静态契约检查。 */
    const FIELDS = new Set(['settings', 'face', 'storage', 'shell', 'limits', 'proj', 'projection',
        'view', '_view', 'app', 'state', 'draft', 'templates', 'instances', 'faceReason']);
    const appRel = 'apps/' + WID + '/' + WID + '-app.js';
    const viewRel = 'apps/' + WID + '/' + WID + '-view.js';
    const appSrc = read(appRel);
    const methods = new Set();
    for (const m of appSrc.matchAll(/^[ \t]+(?:get |set )?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) methods.add(m[1]);
    const viewSrc = read(viewRel);
    const called = new Set();
    for (const m of viewSrc.matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
    const missing = [...called].filter((n) => !methods.has(n) && !FIELDS.has(n));
    assert.deepEqual(missing, [], viewRel + ' 调了 App 上不存在的东西：' + missing.join(' , '));
    assert.ok(methods.size >= 15, appRel + ' 的方法面异常小（' + methods.size + '）');
    assert.ok(called.size >= 8, viewRel + ' 的调用面异常小（' + called.size + '）');
    /* 反向：App 的公开面里必须真有几个视图真在调（否则上面的「闭合」可能是两边都空）。 */
    const used = [...methods].filter((n) => called.has(n));
    assert.ok(used.length >= 6, 'App 方法面与视图调用面的交集异常小：' + used.join(' , '));
});

test('E3 样式与 phone.css 逐字同源，且视图产出的每个类名都有落点', () => {
    const phone = read('phone.css');
    const at = phone.indexOf(WSEG);
    assert.equal(phone.split(WSEG).length - 1, 1, 'phone.css 必须恰好带一次本段段头');
    /* ★ 取段纪律：本段是**当前末段**，故取到文件尾；但必须先自证「本段之后没有别的段头」。
     *   下版往后接段时这条会报红（提醒改成按下一个段头截断）—— 见文件头「取段纪律」。 */
    const rest = phone.slice(at);
    assert.equal(rest.indexOf('/* ---------- [', 1), -1, '本段必须是 phone.css 的末段（下版接段后请改成按下一个段头截断）');
    const norm = (x) => x.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
    const cssRel = 'apps/' + WID + '/' + WID + '.css';
    assert.equal(norm(rest), norm(read(cssRel)), 'phone.css 的本版段必须与 ' + cssRel + ' 逐字同源');
    assert.ok(rest.split(WPREF).length - 1 >= 20, '本段必须真的带样式（实测 ' + (rest.split(WPREF).length - 1) + '）');
    /* 视图产出的每个类名都要有**样式落点**：自己有条规则 / 是 JS 选择器锚点。 */
    const view = read('apps/' + WID + '/' + WID + '-view.js');
    const js = view + read('apps/' + WID + '/' + WID + '-app.js');
    const css = read(cssRel);
    const cssNames = new Set(css.match(new RegExp('[.]' + WBARE + '[a-z0-9-]+', 'g')) || []);
    const anchors = new Set();
    /* 本仓的取值助手是 `const q = (id) => this._root.querySelector('#' + id);`，视图多数用 `#id`；
     * 两种形态一起收（类名选择器 / classList 操作）。 */
    for (const m of js.matchAll(/(?:querySelector(?:All)?|\bq)\s*\(\s*['"]([^'"]*)['"]/g)) {
        for (const tok of m[1].match(/\.[A-Za-z0-9_-]+/g) || []) anchors.add(tok.slice(1));
    }
    for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
    const produced = new Set();
    for (const m of view.matchAll(/class=["']([^"']+)/g)) {
        for (const tok of m[1].split(/\s+/)) if (tok.startsWith(WBARE) && !tok.endsWith('-')) produced.add(tok);
    }
    for (const m of view.matchAll(/className\s*=\s*'([^']+)'/g)) {
        for (const tok of m[1].split(/\s+/)) if (tok.startsWith(WBARE) && !tok.endsWith('-')) produced.add(tok);
    }
    /* 容器类名豁免：样式落在子元素上的纯布局容器。**必须非空洞**：
     * 容器要真被视图产出，且它的兄弟规则必须在场（否则是空口豁免）。 */
    const containerHooks = new Map([['wgt-insts', '.wgt-inst'], ['wgt-list', '.wgt-card']]);
    const missing = [...produced].filter((x) =>
        !cssNames.has('.' + x) && !anchors.has(x) && !containerHooks.has(x));
    assert.deepEqual(missing, [], WID + '-view.js 这些类名既无样式规则也不是锚点：' + missing.join(' , '));
    for (const [hook, sibling] of containerHooks) {
        assert.ok(produced.has(hook), hook + ' 被豁免为容器，但它根本没被视图产出（空口豁免）');
        assert.ok(cssNames.has(sibling), hook + ' 声明样式落在 ' + sibling + ' 上，该规则必须存在');
    }
    assert.ok(produced.size >= 20, '产出的类名异常少（' + produced.size + '）');
    /* ★ 本视图一律用 `#id` 取元素，不用类名选择器 ⇒ anchors 可以是 0。
     *   但「0」必须是被理解的那种 0：类名落点全由 cssNames 承担，故这里只钉住类名面与 id 面。 */
    /* ★ 本视图一律用 `#id` 取元素：有的写成 `'#wgt-out'`，多数经 `const q = (id) =>
     *   this._root.querySelector('#' + id)` 走 `q('wgt-edit-name')`。两种形态一起收，
     *   否则 id 面只剩 2 个 ⇒ 以「取值面异常小」假红（本轮踩到的坑）。 */
    const idRefs = new Set();
    for (const m of js.matchAll(/['"]#([a-z0-9-]+)['"]/g)) idRefs.add(m[1]);
    for (const m of js.matchAll(/\bq\(\s*'([a-z0-9-]+)'/g)) idRefs.add(m[1]);
    for (const m of js.matchAll(/'wgt-[a-z-]+'/g)) idRefs.add(m[0].slice(1, -1));
    assert.ok(idRefs.size >= 10, '视图的 #id 取值面异常小（' + idRefs.size + '）');
});

test('E4 前缀不与他人撞：.wgt- 全仓唯一（本 App 目录与 phone.css；公告块也被扫）+ 条目不写前缀', () => {
    const walk = (dir, out) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === '.git' || e.name === 'node_modules') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, out);
            else if (/\.(js|css)$/.test(e.name)) out.push(full);
        }
        return out;
    };
    const files = walk(ROOT, []);
    assert.ok(files.length > 200, '扫描面异常小（' + files.length + '）');
    const owner = '/apps/' + WID + '/';
    /* ★ 扫描面含 index.js —— 抬版会把本版条目**逐字内嵌**进公告块，那是本仓体积最大的一块 js 文本。
     *   本版抬版后当场踩到过：条目正文里写下前缀字面量 ⇒ 「前缀全仓唯一」转红（公告块被当文本扫）。
     *   处置是**条目不写前缀字面量**、这条判据保持全强度，**不**给 index.js 开豁免 ——
     *   「扫到就说」比「提前豁免」更值钱：豁免一旦开了，真正漂进源码的同名前缀也扫不出来了。 */
    const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes(WPREF));
    assert.ok(users.length > 0, WPREF + ' 必须在仓里被用到');
    for (const f of users) {
        assert.ok(f.includes(owner) || f.endsWith('phone.css'),
            WPREF + ' 只应出现在 ' + owner + ' 与 phone.css，实测还有：' + f.replace(ROOT, ''));
    }
});

test('E5 四件套齐备，且 data 层保持纯函数（不碰 window / DOM / 网络 / 数据库）', () => {
    for (const f of ['-data.js', '-app.js', '-view.js', '.css']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'apps', WID, WID + f)), 'apps/' + WID + '/' + WID + f + ' 必须存在');
    }
    const data = read(WGT_REL);
    const code = stripComments(data);
    for (const banned of ['document', 'window', 'localStorage', 'sessionStorage',
        'fetch(', 'XMLHttpRequest', 'indexedDB', 'Dexie', 'openDB',
        'getChatMessages', 'setChatMessages', 'chatMetadata', 'geolocation',
        'new Function', 'eval(', 'Blob', 'createObjectURL', 'postMessage', 'iframe', 'srcdoc']) {
        assert.equal(code.includes(banned), false, WID + ' 的 data 层**代码**里不得出现：' + banned);
    }
    assert.ok(data.includes("from '../../config/num-gate.js'"), WID + ' 的 data 层应走共享取数门');
    assert.ok(read('apps/' + WID + '/' + WID + '.css').includes(WPREF), 'apps/' + WID + '/' + WID + '.css 必须用 ' + WPREF + ' 前缀');
    /* ★ 本件是**工作台不是运行器**：全文件（含注释）都不该出现执行入口 ——
     *   注释里提到 `new Function` 是「说明源有什么」，故只看**代码**（上面已剥注释）。 */
    assert.equal(code.includes('Function('), false, 'data 层代码不得有任何动态求值入口');
    assert.equal(code.includes('unsafe-eval'), false, 'data 层代码不得提 CSP 放松');
});

/* ══════════════════════ F ── 键归属 ══════════════════════ */
test('F1 四条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const src = read('apps/' + WID + '/' + WID + '-app.js');
    const hits = [...src.matchAll(new RegExp("'(" + WID + "_[a-z_]+)'", 'g'))].map((m) => m[1]);
    const keys = [...new Set(hits)];
    assert.equal(keys.length, 4, '四把键（设置 / 组件库 / 桌面实例 / 草稿），实测 ' + keys.join(','));
    assert.deepEqual(keys.slice().sort(), ['widget_draft', 'widget_instances', 'widget_settings', 'widget_templates']);
    for (const key of keys) {
        assert.equal(audit.split("key: '" + key + "'").length - 1, 1, '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次');
        assert.ok(new RegExp("{ key: '" + key + "', scope: 'chat'").test(audit), '键 ' + key + ' 必须是会话隔离（scope: chat）');
    }
    /* 会话隔离表必须真能匹配到这四个键（前缀与键名对不上的话上面全绿也白搭）。 */
    const storage = read('config/storage.js');
    const mm = storage.match(/\/\^widget_\//);
    assert.ok(mm, 'config/storage.js 必须有 /^widget_/ 前缀');
    for (const key of keys) assert.ok(key.startsWith('widget_'), '键 ' + key + ' 必须落在 ^widget_ 前缀下');
});

/* ══════════════════════ G ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════════════════ */
/** 破坏表集中在一处：H2 会拿它做「锚点在场性 + 替换保真」的批量自证。 */
const DAMAGE = {
    /* 变量不再按标签配对（退化成「拿整串的首个匹配」）⇒ 「首变量无 type 不得整体错配」必须转红。 */
    d1: [WGT_REL,
        '        const mv = RE_VAR_ATTR.exec(tag);\n        if (!mv) continue;',
        '        const mv = RE_VAR_ATTR.exec(s);\n        if (!mv) continue;'],
    /* 默认值只收「声明过的」⇒ 「死值要留在对账里」必须转红（orphanDefaults 恒空）。 */
    d2: [WGT_REL,
        "        const key = safeName(k, WGT_LIMITS.maxVarNameLen);\n"
        + "        if (!key || v === undefined || v === null) continue;\n"
        + "        defaults[key] = String(v).slice(0, WGT_LIMITS.maxVarValueLen);",
        "        const key = safeName(k, WGT_LIMITS.maxVarNameLen);\n"
        + "        if (!key || v === undefined || v === null) continue;\n"
        + "        if (!declared.some((dv) => dv.name === key)) continue;\n"
        + "        defaults[key] = String(v).slice(0, WGT_LIMITS.maxVarValueLen);"],
    /* 导出不再剔图片值 ⇒ 「导出不得渗漏图片值」必须转红。 */
    d3: [WGT_REL,
        "        if (v.type === 'image') continue;",
        '        if (false) continue;'],
    /* 宿主出口一律声称可渲染 ⇒ 「主组件被删要如实报 null」必须转红。 */
    d4: [WGT_REL,
        '            renderable: !!tmpl,',
        '            renderable: true,'],
    /* 注入不再只带文字值 ⇒ 「图片值不得进上下文」必须转红。 */
    d5: [WGT_REL,
        "            if (v.type !== 'text') continue;",
        '            if (false) continue;'],
    /* 改值不再校验变量名 ⇒ 「拒收幽灵变量」必须转红。 */
    d6: [WGT_REL,
        '    if (tmpl && !tmpl.vars.some((v) => v.name === key)) {',
        '    if (false) {'],
    /* 归因不再先判「能不能读」⇒ 「存储不可用优先于内容」必须转红。 */
    d7: [WGT_REL,
        '    if (!probe || probe.storageOk === false) return WGT_REASONS.storage_absent;',
        '    if (!probe) return WGT_REASONS.storage_absent;'],
    /* 组件数上限失效 ⇒ 「到上限必须拒收并说明」必须转红。 */
    d8: [WGT_REL,
        '    if (list.length >= WGT_LIMITS.maxTemplates) {',
        '    if (false) {'],
};

/** num-gate 的**等价桩**（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v === 'number') return Number.isFinite(v) ? v : null;\n"
    + "    if (typeof v !== 'string') return null;\n"
    + '    if (!v.trim()) return null;\n'
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

/**
 * 造一份破坏副本并加载。
 * ★ 副本按**真目录结构**建：data 层写的是 `../../config/num-gate.js`，
 *   若把副本摊在 <tmp> 根下，那条相对路径会解析成 `/config/num-gate.js`（差两级，
 *   首跑即 ERR_MODULE_NOT_FOUND —— 与破坏本身无关的假红）。
 */
function loadDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v328_'));
    const target = path.join(dir, 'apps', path.basename(path.dirname(rel)), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    const gateDir = path.join(dir, 'config');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(target).href);
}

const VAR_API = () => ({ WGT_LIMITS, extractVars });
const TPL_API = (m) => ({
    WGT_LIMITS, WGT_SIZES, extractVars: m.extractVars, normalizeTemplate: m.normalizeTemplate,
    reconcileVars: m.reconcileVars, shareTemplate: m.shareTemplate, toExportText: m.toExportText,
    fromImportText: m.fromImportText, aiPrompt: m.aiPrompt,
});
const INST_API = (m) => ({
    WGT_LIMITS, normalizeTemplates: m.normalizeTemplates, normalizeInstance: m.normalizeInstance,
    upsertTemplate: m.upsertTemplate, addInstance: m.addInstance,
    removeTemplate: m.removeTemplate, setInstanceVar: m.setInstanceVar, projectWidget: m.projectWidget,
});
const PROJ_API = (m) => ({
    WGT_REASONS: m.WGT_REASONS, defaultWgtSettings: m.defaultWgtSettings,
    normalizeWgtSettings: m.normalizeWgtSettings, normalizeTemplates: m.normalizeTemplates,
    addInstance: m.addInstance, setInstanceVar: m.setInstanceVar, removeTemplate: m.removeTemplate,
    toHostPayload: m.toHostPayload, projectWidget: m.projectWidget, readWidgetFace: m.readWidgetFace,
    widgetPromptBlock: m.widgetPromptBlock,
});

test('G1 破坏「按标签配对」⇒ A1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d1;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtVarProblems(VAR_API());
    const bad2 = wgtVarProblems({ WGT_LIMITS, extractVars: mod.extractVars });
    assert.ok(bad2.some((x) => x.startsWith('pair')), '不再按标签配对后必须报出，实测：' + bad2.join(' , '));
    assert.deepEqual(bad, [], '对照：真实现必须按标签配对');
});

test('G2 破坏「死值也收进 defaults」⇒ A2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d2;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtTemplateProblems(TPL_API(mod));
    assert.ok(bad.some((x) => x.startsWith('dead-default-dropped') || x.startsWith('orphan')), '死值被丢掉后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(wgtTemplateProblems(TPL_API({ normalizeTemplate, reconcileVars, shareTemplate, toExportText, fromImportText, aiPrompt, extractVars, WGT_SIZES, WGT_LIMITS })), [], '对照：真实现必须留住死值');
});

test('G3 破坏「导出剔图片值」⇒ A2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d3;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtTemplateProblems(TPL_API(mod));
    assert.ok(bad.some((x) => x.startsWith('share-strips-image') || x.startsWith('export-leaks-image-value')), '不剔图片值后必须报出，实测：' + bad.join(' , '));
});

test('G4 破坏「主组件被删如实报 null」⇒ A4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d4;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtProjectProblems(PROJ_API(mod));
    assert.ok(bad.some((x) => x.startsWith('hp-orphan')), '声称一律可渲染后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(wgtProjectProblems(PROJ_API({
        WGT_REASONS, defaultWgtSettings, normalizeWgtSettings, normalizeTemplates, addInstance,
        setInstanceVar, removeTemplate, toHostPayload, projectWidget, readWidgetFace, widgetPromptBlock,
    })), [], '对照：真实现必须如实报 null');
});

test('G5 破坏「注入只带文字值」⇒ A4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d5;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtProjectProblems(PROJ_API(mod));
    assert.ok(bad.some((x) => x.startsWith('inject-leaks-image')), '图片值进上下文后必须报出，实测：' + bad.join(' , '));
});

test('G6 破坏「改值拒收幽灵变量」⇒ A3 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d6;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtInstanceProblems(INST_API(mod));
    assert.ok(bad.some((x) => x.startsWith('set-ghost-var')), '写进幽灵变量后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(wgtInstanceProblems(INST_API({
        WGT_LIMITS, normalizeTemplates, normalizeInstance, upsertTemplate, addInstance, removeTemplate,
        setInstanceVar, projectWidget,
    })), [], '对照：真实现必须拒收幽灵变量');
});

test('G7 破坏「归因先判能不能读」⇒ A4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d7;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtProjectProblems(PROJ_API(mod));
    assert.ok(bad.some((x) => x.startsWith('face-absent-first')), '不先判可读后必须报出，实测：' + bad.join(' , '));
});

test('G8 破坏「组件数上限」⇒ A3 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d8;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = wgtInstanceProblems(INST_API(mod));
    assert.ok(bad.some((x) => x.startsWith('tpl-cap')), '上限失效后必须报出，实测：' + bad.join(' , '));
});

/* ══════════════════════ H ── 判据工具自证 ══════════════════════ */
test('H1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：E5 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，那些断言只会**更绿** —— 工具被削成空闸属本仓记过的「假绿」族。 */
    const raw = '// 注释里写 new Function\n'
        + 'const a = "postMessage";\n'
        + '/* 块注释 indexedDB */\n'
        + 'const b = 1;\n'
        + "const c = 'x//not-a-comment';";
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"postMessage"'), '字符串字面量必须留住');
    assert.ok(stripped.includes("'x//not-a-comment'"), '字符串里的 // 不是注释起头');
    assert.equal(stripped.includes('注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.ok(stripped.includes('const b = 1;'), '普通代码必须原样留下');
    assert.equal(stripComments('const t = `a${"//"}b`; // 真注释').includes('真注释'), false, '模板串后的注释必须剥掉');
    assert.ok(stripComments("const s = 'a\\'//b';").includes("a\\'//b"), '转义引号不得让状态机提前收尾');
    /* 本件 data 层剥注释后必须真的变短（否则 E5 的「不出现」是空闸）。 */
    assert.ok(read(WGT_REL).length > stripComments(read(WGT_REL)).length, WGT_REL + ' 剥注释后必须真的变短');
});

test('H2 破坏表自证：锚点必须在场（恰 1 次）、不落在注释里、替换必须保真', () => {
    /* ★ 负控制自身最隐蔽的失效形态是**锚点漂移** —— 产品改动让锚点失配，
     *   split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿。故「在场性」必须与「保真」一起被自证。 */
    assert.ok(Object.keys(DAMAGE).length >= 8, '破坏表异常小（' + Object.keys(DAMAGE).length + '）');
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
        assert.ok(out.includes(to), name + ' 替换后新串必须在场');
        assert.notEqual(from, to, name + ' 的 from/to 不得相同（那样不是破坏）');
        const at = src.indexOf(from);
        const before = src.slice(0, at);
        const opens = (before.match(/\/\*/g) || []).length;
        const closes = (before.match(/\*\//g) || []).length;
        assert.equal(opens, closes, name + ' 的锚点不得落在块注释里');
        const lineStart = src.lastIndexOf('\n', at) + 1;
        const lineEnd = src.indexOf('\n', at);
        const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
        assert.ok(!line.startsWith('//') && !line.startsWith('*'), name + ' 的锚点不得落在注释行里：' + line.slice(0, 60));
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace：替换串里一旦出现 `$`，
     *   `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
    /* 副本的结构自证：`../../config/num-gate.js` 必须真能解析到桩。 */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v328_selfcheck_'));
    fs.mkdirSync(path.join(tmp, 'apps', 'x'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'num-gate.js'), NUM_GATE_STUB);
    fs.writeFileSync(path.join(tmp, 'apps', 'x', 'm.mjs'),
        "import { numOrNull } from '../../config/num-gate.js';\nexport const v = [numOrNull(0), numOrNull(''), numOrNull('3')];\n");
    return import(pathToFileURL(path.join(tmp, 'apps', 'x', 'm.mjs')).href).then((m) => {
        assert.deepEqual(m.v, [0, null, 3], 'num-gate 桩必须与真件同口径（0 是合法读数、空串是没给）');
    });
});

/* ══════════════════════ V ── 版本锚 ══════════════════════ */
test('V1 版本锚（下限形）+ 四源同源 + update-log 条目', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 28),
        '本套件成立于 RubyPhone 3.28.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ update-log 的键序约定：新版本插**首位**（v3.23.0 踩过「追加末尾」的坑 —— 版本列表倒着读）。 */
    const firstKey = Object.keys(log.versions)[0];
    assert.equal(firstKey, man.version, '当前版本必须插在 versions **首位**（版本列表倒着读）');
    const cur = (log.versions || {})[man.version];
    assert.ok(cur, 'update-log 必须含当前版本 ' + man.version + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 3, '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['自定义组件', '不执行', '工作台']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* ★ 公告块必须与该版条目**逐字同源**（由 items 逐条 json.dumps 生成，不做字符串拼贴）。 */
    const bm = src.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(bm, '公告块的形状必须是对象（与抬版脚本同源）');
    const block = bm[0];
    assert.ok(block.length > 0, 'index.js 必须有 ST_PHONE_CURRENT_UPDATE 公告块');
    for (const it of cur.items) {
        assert.ok(block.includes(JSON.stringify(it)), '公告块里找不到这一条（必须与条目逐字同源）：' + it.slice(0, 40));
    }
    /* 迭代日志必须带上本版那一段。 */
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含当前版本段');
});
