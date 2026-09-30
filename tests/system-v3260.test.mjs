// tests/system-v3260.test.mjs — 正则过滤器 + 打卡：两件都不做「第二个权威」[v3.26.0]
//
//   本版接的是素材缝合路线图 L1 余下小件里的两件：
//     ① 正则过滤 —— 源 EPhone·xINOVO `js/modules/regex_filter.js`（432 行 · 15011 字符）
//     ② 打卡     —— 源 MyPhone `punchcard.js`（501 行 · 21396 字符）
//
//   缝合**不是搬运**。两件各有一块「源有本仓不能有」的东西，本套件守的就是「它们没被搬进来」：
//     ① 正则过滤器的禁区是 **第二个正文改写者**：源 `applyRegexFilter(content, charId)`
//        在渲染前**就地改写消息文本**。本仓正文的既有唯一仲裁者是 `config/tag-filter.js`
//        （生成前的标签级黑/白名单过滤）。同一块文本上放两个改写者，就是本仓最贵的形态：
//        不报错、只错结果 —— 与 v3.25.0 存钱罐「不与微信零钱争」同规（那里争的是钱，这里争的是正文）。
//        ⇒ 本件定位为**正则工作台**：写规则 → 实时预览 → 导出成 SillyTavern 正则脚本。
//        B6 守这条（且两向自证：文件头里必须真写着这个理由，否则说明「不缝」只是嘴上说说）。
//     ② 打卡的禁区是 **自建 IndexedDB + 自己调模型**：源 `const DB_NAME = 'PhoneSimPunchCard'`
//        + `indexedDB.open(DB_NAME)`（自建库，违本仓零数据库铁律），以及 `generateCard` 自己
//        `fetch` 角色 API、拼 system prompt、**首轮拿不满 8 条就再问一遍**（`charSchedule.length < 8`）、
//        再 `JSON.parse` 模型输出。前者换成本仓 PhoneStorage（键进会话隔离表），
//        后者**根本不缝** —— 那是生成侧的活；本件把聚合事实（连续几天 / 今天几项 / 还没做哪些）
//        交给生成侧，由角色在它自己的回合里回应。B5 守这条。
//
//   本套件守六类会**静默失效**的形态（都不报错、不崩溃，只是结果不对）：
//     A 正则过滤器内核：外壳保护（只改内部正文）/ 逐条顺序与全局替换 / 坏规则**上报而不吞文本** /
//       绑定角色的命中语义 / 导出导入往返 / replace 的 `$1` 语义保留；
//     B 打卡内核：同一天**并项**而非开第二张 / 删中间项后**按 id 定位**（按下标会串项）/
//       连续天数的缺口口径 / 投影不编数 / 设置钳制 / 注入块只给事实；
//     C 接线：四处注册齐备（两件各四处）/ **视图调用面必须闭合在 App 上**（v3250 记过的
//       「视图调了 App 上不存在的方法」静默断裂）/ 样式源与 phone.css 逐字同源 / 前缀不与他人撞；
//     D 键归属：四条新键在门禁账本里且 scope=chat；
//     E 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红（八条）；
//     G 判据工具自证：剥注释器两向、替换必须保真。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/<app>/<file>.js` + `<tmp>/config/num-gate.js`），否则
//   `../../config/num-gate.js` 会解析到 `/config/num-gate.js`（差两级，首跑即 ERR_MODULE_NOT_FOUND）；
//   判据函数仍只吃**数据对象**，不吃模块内部实现。
//
//   本版新增两条判据纪律（写在显眼处）：
//     E12 「**每个破坏锚点必须（也被）断言为在场**」：破坏表集中在一处（DAMAGE），
//          neg 用例用 from/to 之前先 split 计数。锚点漂移（产品改动让锚点失配）会让
//          neg 用例**静默失效**（split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿）—— 这是负控制自身
//          最隐蔽的失效形态，v3250 G2 只覆盖了「替换保真」，本版把「在场性」也钉进 G2。
//     G2 替换一律**字面 split/join**，不用 String.replace：替换串里一旦出现 `$`，
//        `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形、负控制失去判别力。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    RGX_REASONS, RGX_LIMITS, DEFAULT_RGX_SETTINGS,
    defaultRgxSettings, normalizeRgxSettings, normalizeRule, compileRule, isRuleValid,
    normalizePreset, normalizePresets, splitWrapper, tidyBlankLines,
    applyRulesToText, applyPresetsToText, toStileRegexScripts, toExportText,
    fromImportText, projectRgx, readRgxFace,
} from '../apps/regexfilter/regexfilter-data.js';

import {
    PUNCH_REASONS, PUNCH_ITEM_KINDS, PUNCH_LIMITS, DEFAULT_PUNCH_SETTINGS,
    defaultPunchSettings, normalizePunchSettings, dayKey, shiftDayKey,
    normalizeItem, normalizeCard, normalizeCards, createCard, patchItem, toggleItem,
    removeCard, removeItem, streakOf, projectPunch, readPunchFace, pendingItems,
    punchPromptBlock,
} from '../apps/punchcard/punchcard-data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RGX_REL = 'apps/regexfilter/regexfilter-data.js';
const PCH_REL = 'apps/punchcard/punchcard-data.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 固定「现在」：日键与连续天数是日历逻辑，判据必须与真实时钟解耦。
 *  `new Date('YYYY-MM-DDTHH:mm:ss')`（无 Z）按 ES2016+ 是**本地时间**，故日键在任何时区都稳定。 */
const NOW = new Date('2026-09-30T12:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;

/** 剥注释（字符状态机，与 v3200 / v3201 / v3250 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」（E6 / v299 A4 / v3190 A4 / v3200 D1 同口径）。
 *    本版两件的文件头都写明了「源里有什么、本仓为什么不能有」——那些词（`applyRegexFilter`、
 *    `indexedDB`、`charSchedule`…）是**说明**不是**消费**。判据必须自己实现一遍：不许用被审对象
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

/* ── 小夹具 ── */
/** 一条最简规则：X → Y。 */
const RW = { pattern: 'X', replace: 'Y' };
/** 造一张卡（给连续天数用例）：`mk('2026-09-30')`。 */
const mk = (date, labels) => normalizeCards([{
    id: 'c' + date + (Math.random().toString(36).slice(2, 5)),
    date,
    createdAt: NOW,
    items: (labels || ['x']).map((l, i) => ({ id: 'i' + date + i + Math.random().toString(36).slice(2, 5), label: l })),
}]);
const mkMany = (...dates) => dates.reduce((acc, d) => acc.concat(mk(d)), []);

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A1 外壳保护 + 逐条顺序 + 全局替换 + 删除 + 可重复调用 + 捕获组 ── */
function rgxCoreProblems(api) {
    const bad = [];
    /* ① 外壳保护：`[某某的消息：正文]` 只改**内部正文**，外壳一字不动。 */
    const one = api.splitWrapper('[张三的消息：确实如此]');
    if (one.prefix !== '[张三的消息：' || one.body !== '确实如此' || one.suffix !== ']') {
        bad.push('split:' + JSON.stringify(one));
    }
    const PW = { name: 'p', rules: [{ pattern: '确实如此', replace: '没有这种事' }], boundChars: [], enabled: true };
    const r1 = api.applyPresetsToText('[张三的消息：确实如此]', [PW], 'c1', {});
    if (r1.text !== '[张三的消息：没有这种事]') bad.push('wrapper:' + r1.text);
    /* 正文带换行也要保护得住（`[\s\S]+?` 跨行，前缀 `[^\]\n]{0,120}` 不跨行）。 */
    const r2 = api.applyPresetsToText('[张三的消息：确实如此\n第二行确实如此]', [PW], 'c1', {});
    if (r2.text !== '[张三的消息：没有这种事\n第二行没有这种事]') bad.push('wrapper-multiline:' + r2.text);
    /* 没有外壳时整段都是正文（不能因为"没有外壳"就什么都不做）。 */
    if (api.applyPresetsToText('确实如此', [PW], 'c1', {}).text !== '没有这种事') bad.push('plain');
    /* ② 逐条**顺序**生效：第一条的产物必须是第二条的输入。 */
    const seq = api.applyRulesToText('AB', [{ pattern: 'A', replace: 'B' }, { pattern: 'B', replace: 'C' }], {});
    if (seq.text !== 'CC') bad.push('order:' + seq.text);
    /* ③ 全局替换：不能只换第一个。 */
    const g = api.applyRulesToText('aaa', [{ pattern: 'a', replace: 'b' }], {});
    if (g.text !== 'bbb') bad.push('not-global:' + g.text);
    /* ④ 替换串留空 = 删除匹配。 */
    if (api.applyRulesToText('好的确实如此吧', [{ pattern: '确实如此', replace: '' }], {}).text !== '好的吧') bad.push('delete');
    /* ⑤ 可**重复**调用：带 `g` 的正则对象自带 lastIndex 状态，复用会产生
     *    「第一次命中、第二次不命中」。本件每条现建（compileRule 每次 new）。 */
    const rep1 = api.applyRulesToText('aaa', [{ pattern: 'a', replace: 'b' }], {});
    const rep2 = api.applyRulesToText('aaa', [{ pattern: 'a', replace: 'b' }], {});
    if (rep1.text !== 'bbb' || rep2.text !== 'bbb') bad.push('repeat:' + rep1.text + ',' + rep2.text);
    /* ⑥ replace 的 `$1` 捕获语义**保留**（这是正则替换的正当特性，不是缺陷）。 */
    if (api.applyRulesToText('ab', [{ pattern: '(a)(b)', replace: '$2$1' }], {}).text !== 'ba') bad.push('capture');
    return bad;
}

/* ── A2 坏规则上报而不吞文本 ── */
function rgxBadRuleProblems(api) {
    const bad = [];
    const badRule = { pattern: '(', replace: 'x' };
    if (api.compileRule(badRule).ok !== false) bad.push('bad-compiles');
    if (api.isRuleValid(badRule) !== false) bad.push('bad-valid');
    if (api.normalizeRule({ pattern: '   ', replace: '' }) !== null) bad.push('blank-rule-not-dropped');
    /* 坏规则不得吃掉文本，且必须**上报**。 */
    const r = api.applyRulesToText('原文', [badRule], {});
    if (r.text !== '原文') bad.push('bad-ate-text:' + JSON.stringify(r.text));
    if (r.errors.length !== 1) bad.push('bad-no-error:' + r.errors.length);
    if (r.errors[0] && !r.errors[0].pattern) bad.push('error-no-pattern');
    /* 好坏混在一起：好的照样生效，坏的照样上报。 */
    const mix = api.applyRulesToText('你好', [{ pattern: '(', replace: '' }, { pattern: '你好', replace: '哈' }], {});
    if (mix.text !== '哈') bad.push('mix-text:' + mix.text);
    if (mix.errors.length !== 1) bad.push('mix-errors:' + mix.errors.length);
    if (mix.applied !== 1) bad.push('mix-applied:' + mix.applied);
    /* 编译结果必须是**新实例**（同一实例会被 lastIndex 状态污染）。 */
    if (api.compileRule({ pattern: 'a', replace: '' }).regex === api.compileRule({ pattern: 'a', replace: '' }).regex) {
        bad.push('shared-regex-instance');
    }
    return bad;
}

/* ── A3 绑定角色的命中语义 ── */
function rgxBindingProblems(api) {
    const bad = [];
    const unbound = { id: 'u', name: 'u', rules: [RW], boundChars: [], enabled: true };
    const bound = { id: 'b', name: 'b', rules: [RW], boundChars: ['c1'], enabled: true };
    const off = { id: 'o', name: 'o', rules: [RW], boundChars: [], enabled: false };
    /* 空绑定 = 对所有角色生效。 */
    if (api.applyPresetsToText('X', [unbound], 'c9', {}).text !== 'Y') bad.push('unbound-not-applied');
    /* 有绑定：命中该角色才生效，别的角色不受影响。 */
    if (api.applyPresetsToText('X', [bound], 'c1', {}).text !== 'Y') bad.push('bound-hit');
    if (api.applyPresetsToText('X', [bound], 'c2', {}).text !== 'X') bad.push('bound-miss');
    /* 没给角色 id：只跑「不绑定」的方案（给了 id 才有得判，不能瞎套）。 */
    if (api.applyPresetsToText('X', [bound], '', {}).text !== 'X') bad.push('bound-empty-cid');
    if (api.applyPresetsToText('X', [unbound], '', {}).text !== 'Y') bad.push('unbound-empty-cid');
    /* enabled:false 一律不跑。 */
    if (api.applyPresetsToText('X', [off], 'c1', {}).text !== 'X') bad.push('disabled-ran');
    /* matchedPresets 如实报出跑了哪几个（给界面显示用，编数会让"启用了却看不到效果"无从排查）。 */
    const m = api.applyPresetsToText('X', [unbound, bound, off], 'c1', {});
    if (m.matchedPresets.length !== 2) bad.push('matched:' + JSON.stringify(m.matchedPresets));
    if (m.applied !== 2) bad.push('matched-applied:' + m.applied);
    return bad;
}

/* ── A4 设置与归因 ── */
function rgxSettingsProblems(api) {
    const bad = [];
    const R = api.RGX_REASONS;
    if (R.ready !== 'ready' || R.empty !== 'empty' || R.storage_absent !== 'storage-absent') bad.push('reason-form');
    if (api.defaultRgxSettings().tidy !== false) bad.push('default-tidy-on');
    /* tidy 必须是**显式开关**且默认关：它是对文本的隐式改写，默认开会污染"我只想看这条正则干了什么"。 */
    if (api.normalizeRgxSettings({}).tidy !== false) bad.push('tidy-default-on');
    if (api.normalizeRgxSettings({ tidy: 'yes' }).tidy !== false) bad.push('tidy-nonbool-taken');
    if (api.normalizeRgxSettings({ tidy: true }).tidy !== true) bad.push('tidy-on');
    if (api.tidyBlankLines('a\n\n\n\nb') !== 'a\n\nb') bad.push('tidy-fn');
    /* 预览上限钳制 + 读不出就如实回落默认。 */
    if (api.normalizeRgxSettings({ maxPreviewChars: 1 }).maxPreviewChars !== 200) bad.push('clamp-lo');
    if (api.normalizeRgxSettings({ maxPreviewChars: 999999 }).maxPreviewChars !== 20000) bad.push('clamp-hi');
    if (api.normalizeRgxSettings(null).maxPreviewChars !== DEFAULT_RGX_SETTINGS.maxPreviewChars) bad.push('fallback');
    if (api.normalizeRgxSettings({ maxPreviewChars: 'abc' }).maxPreviewChars !== DEFAULT_RGX_SETTINGS.maxPreviewChars) {
        bad.push('nan-fallback');
    }
    /* 归因三态：先判能不能读，再判读到了什么。 */
    if (api.readRgxFace({ storageOk: false, hasPresets: true }) !== R.storage_absent) bad.push('absent');
    if (api.readRgxFace({ storageOk: true, hasPresets: false }) !== R.empty) bad.push('empty');
    if (api.readRgxFace({ storageOk: true, hasPresets: true }) !== R.ready) bad.push('ready');
    if (api.readRgxFace(null) !== R.storage_absent) bad.push('null-probe');
    return bad;
}

/* ── A5 导出 / 导入往返 / 投影 / 原型污染闸 ── */
function rgxExportProblems(api) {
    const bad = [];
    const p = { id: 'pid', name: '去八股', rules: [RW], boundChars: [], enabled: true };
    const scripts = api.toStileRegexScripts(p);
    if (scripts.length !== 1) bad.push('scripts-count:' + scripts.length);
    const s = scripts[0] || {};
    if (s.findRegex !== '/X/g') bad.push('findRegex:' + s.findRegex);
    if (s.replaceString !== 'Y') bad.push('replaceString:' + s.replaceString);
    if (s.disabled !== false) bad.push('disabled-flag');
    if (!Array.isArray(s.placement) || !s.placement.includes(1)) bad.push('placement');
    /* 一条规则都没导出 = 空手交差：坏输入必须给空数组而不是半个对象。 */
    if (api.toStileRegexScripts(null).length !== 0) bad.push('scripts-null');
    /* 导出文本 → 原样导回（往返必须逐条对上）。 */
    const back = api.fromImportText(api.toExportText([p]));
    if (!back.ok || back.presets.length !== 1) bad.push('roundtrip:' + back.reason);
    if (back.ok && back.presets[0].rules[0].pattern !== 'X') bad.push('roundtrip-rule');
    if (!api.fromImportText(JSON.stringify([p])).ok) bad.push('bare-array');
    /* 坏输入一律不抛，只如实报原因（界面要能说清是哪一种坏）。 */
    if (api.fromImportText('').reason !== 'empty') bad.push('empty-reason');
    if (api.fromImportText('{{{').reason !== 'bad-json') bad.push('badjson-reason');
    if (api.fromImportText('{"a":1}').reason !== 'bad-shape') bad.push('badshape-reason');
    if (api.fromImportText('[{"name":"x"}]').reason !== 'no-valid-preset') bad.push('novalid-reason');
    if (api.fromImportText(null).ok !== false) bad.push('null-import');
    /* 原型污染闸：原型键不得进 boundChars。 */
    const pp = api.normalizePreset({ name: 'n', rules: [RW], boundChars: ['__proto__', '  c1  ', 'c1', 'constructor', 'prototype'] });
    if (!pp) { bad.push('preset-null'); return bad; }
    if (pp.boundChars.length !== 1 || pp.boundChars[0] !== 'c1') bad.push('bound-sanitize:' + JSON.stringify(pp.boundChars));
    /* 投影：坏规则必须被**计入**而不是被丢掉（否则"启用了一片规则却都不生效"在界面上看不出来）。 */
    const proj = api.projectRgx([p, { name: 'bad', rules: [{ pattern: '(', replace: '' }] }]);
    if (proj.presetCount !== 2) bad.push('proj-presets:' + proj.presetCount);
    if (proj.ruleCount !== 2) bad.push('proj-rules:' + proj.ruleCount);
    if (proj.invalidCount !== 1) bad.push('proj-invalid:' + proj.invalidCount);
    if (proj.enabledCount !== 2) bad.push('proj-enabled:' + proj.enabledCount);
    if (proj.hasAny !== true) bad.push('proj-hasAny');
    if (api.projectRgx([]).hasAny !== false) bad.push('proj-empty-hasAny');
    if (api.projectRgx(null).presetCount !== 0) bad.push('proj-null');
    return bad;
}

/* ── B1 打卡：同一天并项而不是开第二张 ── */
function punchCoreProblems(api) {
    const bad = [];
    /* 没有有效项就不建卡（空标签一律丢弃）。 */
    if (api.createCard([], { items: [] }, NOW).added !== 0) bad.push('empty-added');
    if (api.createCard([], { items: [{ label: '   ' }] }, NOW).cards.length !== 0) bad.push('blank-label-card');
    if (api.createCard([], { items: [{ label: 'x' }] }, NOW).cards.length !== 1) bad.push('normal-card');
    /* ★ 同一天再存必须**并项**，而不是开出第二张（界面承诺的原话）。 */
    const a = api.createCard([], { items: [{ label: '起床', at: '07:00' }] }, NOW);
    const b = api.createCard(a.cards, { items: [{ label: '跑步' }] }, NOW + 60000);
    if (b.cards.length !== 1) bad.push('second-card-not-merged:' + b.cards.length);
    if (b.cards[0].items.length !== 2) bad.push('merge-items:' + b.cards[0].items.length);
    if (b.added !== 1) bad.push('merge-added:' + b.added);
    /* 并项不得越过逐项上限。 */
    const many = [];
    for (let i = 0; i < PUNCH_LIMITS.maxItemsPerCard + 5; i += 1) many.push({ label: 'i' + i });
    const c = api.createCard([], { items: many }, NOW);
    if (c.cards[0].items.length !== PUNCH_LIMITS.maxItemsPerCard) bad.push('cap-items:' + c.cards[0].items.length);
    /* 不同天各自一张。 */
    const d = api.createCard(c.cards, { items: [{ label: '次日' }] }, NOW + DAY);
    if (d.cards.length !== 2) bad.push('next-day:' + d.cards.length);
    return bad;
}

/* ── B2 打卡：删中间项后必须**按 id 定位**（按下标实现会串项） ── */
function punchPatchProblems(api) {
    const bad = [];
    const t = api.createCard([], {
        items: [{ label: 'A', at: '1' }, { label: 'B', at: '2' }, { label: 'C', at: '3' }],
    }, NOW);
    const card = t.cards[0];
    const ids = card.items.map((x) => x.id);
    /* 删中间那项 —— 这一步会让后面的下标整体平移。 */
    const r = api.removeItem(t.cards, card.id, ids[1]);
    if (r.removed !== 1) bad.push('remove-count:' + r.removed);
    if (r.cards[0].items.length !== 2) bad.push('left-len:' + r.cards[0].items.length);
    if (r.cards[0].items.map((x) => x.label).join('') !== 'AC') bad.push('left-order:' + r.cards[0].items.map((x) => x.label).join(''));
    /* ★ 关键：下标平移后，按 id 写备注必须落到**原来那一项**上。
     *   按下标实现会写到"第 2 个位置"，而那里现在躺着的是 C 之后/之前的项 —— 静默串项。 */
    const w = api.patchItem(r.cards, card.id, ids[2], { remark: '给C的备注' });
    if (w.changed !== 1) bad.push('patch-changed:' + w.changed);
    const cItem = w.cards[0].items.find((x) => x.id === ids[2]);
    const aItem = w.cards[0].items.find((x) => x.id === ids[0]);
    if (!cItem || cItem.remark !== '给C的备注') bad.push('remark-landed-wrong:' + JSON.stringify(cItem && cItem.remark));
    if (aItem && aItem.remark) bad.push('remark-leaked-to-other:' + aItem.remark);
    /* 勾选同样按 id，且不得溅到别的项。 */
    const d = api.toggleItem(r.cards, card.id, ids[0], true);
    if (!d.cards[0].items.find((x) => x.id === ids[0]).done) bad.push('toggle-not-done');
    if (d.cards[0].items.find((x) => x.id === ids[2]).done) bad.push('toggle-leaked');
    /* 不存在的 id：改了 0 条，数据原样（不能"没找到就改第一个"）。 */
    if (api.patchItem(r.cards, card.id, 'nope', { done: true }).changed !== 0) bad.push('phantom-changed');
    if (api.patchItem(r.cards, 'no-card', ids[0], { done: true }).changed !== 0) bad.push('phantom-card');
    /* 删项：不存在就是 0 条。 */
    if (api.removeItem(r.cards, card.id, 'nope').removed !== 0) bad.push('phantom-removed');
    if (api.removeCard(r.cards, 'no-card').removed !== 0) bad.push('phantom-card-removed');
    if (api.removeCard(r.cards, card.id).removed !== 1) bad.push('card-removed:' + api.removeCard(r.cards, card.id).removed);
    return bad;
}

/* ── B3 打卡：连续天数口径 ── */
function punchStreakProblems(api) {
    const bad = [];
    /* 连着三天、最近一张是今天 ⇒ 3。 */
    if (api.streakOf(mkMany('2026-09-30', '2026-09-29', '2026-09-28'), NOW) !== 3) {
        bad.push('streak3:' + api.streakOf(mkMany('2026-09-30', '2026-09-29', '2026-09-28'), NOW));
    }
    /* 最近一张是昨天 ⇒ 仍算连（今天还没记不该把昨天之前的成绩一笔勾销）。 */
    if (api.streakOf(mkMany('2026-09-29', '2026-09-28'), NOW) !== 2) bad.push('streak2-yesterday');
    /* 最近一张距今已两天 ⇒ 断，0。 */
    if (api.streakOf(mkMany('2026-09-28', '2026-09-27'), NOW) !== 0) bad.push('streak-gap');
    /* 中间缺一天 ⇒ 只数到缺口（不能"有 N 天就算 N"）。 */
    if (api.streakOf(mkMany('2026-09-30', '2026-09-28'), NOW) !== 1) bad.push('streak-hole');
    /* 空 ⇒ 0。 */
    if (api.streakOf([], NOW) !== 0) bad.push('streak-empty');
    /* 手工数据里一天两张：按天去重，不得重复计数。 */
    if (api.streakOf(mkMany('2026-09-30', '2026-09-30'), NOW) !== 1) bad.push('streak-dup');
    return bad;
}

/* ── B4 打卡：投影不编数 / 注入只给事实 / 归因三态 ── */
function punchProjectProblems(api) {
    const bad = [];
    const empty = api.projectPunch([], NOW);
    if (empty.hasAny !== false) bad.push('hasAny');
    if (empty.cardCount !== 0 || empty.itemCount !== 0 || empty.doneCount !== 0) bad.push('counts');
    if (empty.todayCardId !== '') bad.push('todayCardId:' + JSON.stringify(empty.todayCardId));
    if (empty.latest !== null) bad.push('latest-invented:' + JSON.stringify(empty.latest));
    if (empty.todayKey !== '2026-09-30') bad.push('todayKey:' + empty.todayKey);
    if (empty.streak !== 0) bad.push('empty-streak');
    /* 一张今天的卡，两项一项完成。 */
    const t = api.createCard([], { items: [{ label: 'A' }, { label: 'B' }] }, NOW);
    const idA = t.cards[0].items[0].id;
    const done = api.toggleItem(t.cards, t.cards[0].id, idA, true);
    const proj = api.projectPunch(done.cards, NOW);
    if (proj.todayItemCount !== 2 || proj.todayDoneCount !== 1) bad.push('today:' + proj.todayItemCount + '/' + proj.todayDoneCount);
    if (proj.cardCount !== 1 || proj.itemCount !== 2 || proj.doneCount !== 1) bad.push('totals');
    if (proj.todayCardId !== t.cards[0].id) bad.push('todayCardId-mismatch');
    if (proj.hasAny !== true) bad.push('hasAny-true');
    /* pendingItems = 今天还没做的（不能把历史里没做的也算进"今天"）。 */
    const pend = api.pendingItems(done.cards, NOW);
    if (pend.length !== 1 || pend[0].label !== 'B') bad.push('pending:' + JSON.stringify(pend.map((x) => x.label)));
    if (api.pendingItems([], NOW).length !== 0) bad.push('pending-empty');
    /* 注入块只给**事实**。 */
    if (api.punchPromptBlock(proj, { ...DEFAULT_PUNCH_SETTINGS, injectToPrompt: false }, pend) !== '') bad.push('inject-off');
    const on = api.punchPromptBlock(proj, DEFAULT_PUNCH_SETTINGS, pend);
    if (!on.includes('【连续】1 天')) bad.push('inject-streak:' + JSON.stringify(on));
    if (!on.includes('【今天】2 项 · 已完成 1 项')) bad.push('inject-today:' + JSON.stringify(on));
    if (!on.includes('【还没做】') || !on.includes('B')) bad.push('inject-pending:' + JSON.stringify(on));
    if (on.includes('A')) bad.push('inject-includes-done-item');
    /* maxInjectItems 真被尊重：设成 0 就不出明细（不是"0 等于全给"）。 */
    if (api.punchPromptBlock(proj, { ...DEFAULT_PUNCH_SETTINGS, maxInjectItems: 0 }, pend).includes('【还没做】')) {
        bad.push('inject-maxignored');
    }
    /* 没数据 / 没投影就不产块（不给生成侧塞空壳）。 */
    if (api.punchPromptBlock(empty, DEFAULT_PUNCH_SETTINGS, []) !== '') bad.push('inject-empty');
    if (api.punchPromptBlock(null, DEFAULT_PUNCH_SETTINGS, []) !== '') bad.push('inject-nullproj');
    if (api.punchPromptBlock(proj, null, pend) !== '') bad.push('inject-nullsettings');
    /* 归因三态。 */
    const R = api.PUNCH_REASONS;
    if (R.ready !== 'ready' || R.empty !== 'empty' || R.storage_absent !== 'storage-absent') bad.push('reason-form');
    if (api.readPunchFace({ storageOk: false, hasCards: true }) !== R.storage_absent) bad.push('face-absent');
    if (api.readPunchFace({ storageOk: true, hasCards: false }) !== R.empty) bad.push('face-empty');
    if (api.readPunchFace({ storageOk: true, hasCards: true }) !== R.ready) bad.push('face-ready');
    return bad;
}

/* ── B5 打卡：设置钳制与常量表 ── */
function punchSettingsProblems(api) {
    const bad = [];
    const d = api.defaultPunchSettings();
    if (d.injectToPrompt !== true) bad.push('default-inject');
    if (d.maxInjectItems !== 4) bad.push('default-maxinject:' + d.maxInjectItems);
    if (d.maxCards !== 60) bad.push('default-maxcards:' + d.maxCards);
    /* injectToPrompt 是「非 false 即真」（读不出时如实开，而不是静默关掉注入）。 */
    if (api.normalizePunchSettings({}).injectToPrompt !== true) bad.push('inject-default');
    if (api.normalizePunchSettings({ injectToPrompt: false }).injectToPrompt !== false) bad.push('inject-off');
    if (api.normalizePunchSettings({ injectToPrompt: 'no' }).injectToPrompt !== true) bad.push('inject-truthy');
    /* 数值钳制：每一项边界都要真被夹住。 */
    if (api.normalizePunchSettings({ maxInjectItems: -5 }).maxInjectItems !== 0) bad.push('clamp-inject-lo');
    if (api.normalizePunchSettings({ maxInjectItems: 99 }).maxInjectItems !== 20) bad.push('clamp-inject-hi');
    if (api.normalizePunchSettings({ maxCards: 1 }).maxCards !== 7) bad.push('clamp-cards-lo');
    if (api.normalizePunchSettings({ maxCards: 9999 }).maxCards !== 400) bad.push('clamp-cards-hi');
    if (api.normalizePunchSettings(null).maxCards !== 60) bad.push('fallback');
    if (api.normalizePunchSettings({ maxCards: 'abc' }).maxCards !== 60) bad.push('nan-fallback');
    /* 常量表（作息项的两种形态与源 `toggleTimeInput` 同义）。 */
    if (api.PUNCH_ITEM_KINDS.join(',') !== 'time,duration') bad.push('kinds:' + api.PUNCH_ITEM_KINDS.join(','));
    return bad;
}

/* ── B6 打卡：日键与规范化 ── */
function punchDayProblems(api) {
    const bad = [];
    if (api.dayKey(NOW) !== '2026-09-30') bad.push('dayKey:' + api.dayKey(NOW));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(api.dayKey(null))) bad.push('dayKey-null:' + api.dayKey(null));
    if (api.shiftDayKey('2026-09-30', -1) !== '2026-09-29') bad.push('shift-1');
    /* 跨月：用本地日期构造器而不是毫秒减法（毫秒减法在夏令时切换日会歪）。 */
    if (api.shiftDayKey('2026-03-01', -1) !== '2026-02-28') bad.push('shift-month');
    if (api.shiftDayKey('2026-01-01', -1) !== '2025-12-31') bad.push('shift-year');
    if (api.shiftDayKey('bad', -1) !== '') bad.push('shift-bad');
    /* 项规范化：空标签丢弃、kind 收敛到白名单、长度截断。 */
    if (api.normalizeItem({ label: '' }, NOW) !== null) bad.push('item-blank');
    if (api.normalizeItem({ label: 'x', kind: 'weird' }, NOW).kind !== 'time') bad.push('item-kind');
    if (api.normalizeItem({ label: 'x', kind: 'duration' }, NOW).kind !== 'duration') bad.push('item-kind2');
    if (api.normalizeItem({ label: 'x'.repeat(200) }, NOW).label.length !== PUNCH_LIMITS.maxLabelLen) bad.push('item-label-cap');
    if (api.normalizeItem({ label: 'x', remark: 'y'.repeat(200) }, NOW).remark.length !== PUNCH_LIMITS.maxRemarkLen) bad.push('item-remark-cap');
    if (api.normalizeItem({ label: 'x', done: 'yes' }, NOW).done !== false) bad.push('item-done-strict');
    /* 卡规范化：无有效项即丢；排序新在前。 */
    if (api.normalizeCard({ items: [] }) !== null) bad.push('card-empty');
    const list = api.normalizeCards([
        { id: 'a', date: '2026-09-28', createdAt: NOW - 2 * DAY, items: [{ label: 'x' }] },
        { id: 'b', date: '2026-09-30', createdAt: NOW, items: [{ label: 'y' }] },
    ]);
    if (list[0].id !== 'b') bad.push('sort:' + list.map((x) => x.id).join(','));
    return bad;
}

/* ══════════════════════ A ── 正则过滤器内核 ══════════════════════ */
test('A1 外壳保护与替换语义：只改内部正文、逐条顺序、全局替换、可重复调用、保留 $1', () => {
    const bad = rgxCoreProblems({ splitWrapper, applyPresetsToText, applyRulesToText });
    assert.deepEqual(bad, [], '正则替换语义必须与设计一致，实测问题：' + bad.join(' , '));
});

test('A2 坏规则上报而不吞文本：一条坏规则不得吃掉整段，且必须留读数', () => {
    const bad = rgxBadRuleProblems({ compileRule, isRuleValid, normalizeRule, applyRulesToText });
    assert.deepEqual(bad, [], '坏规则处理必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(RGX_LIMITS.maxRulesPerPreset, 60, '每预设规则数上限（源无上限）');
    assert.equal(RGX_LIMITS.maxPresets, 40, '预设数上限');
});

test('A3 绑定角色：空绑定对所有人生效，有绑定只对命中者生效，没给 id 只跑不绑定的', () => {
    const bad = rgxBindingProblems({ applyPresetsToText });
    assert.deepEqual(bad, [], '绑定语义必须与设计一致，实测问题：' + bad.join(' , '));
});

test('A4 设置与归因：tidy 是显式开关且默认关，上限夹住，归因先判可读性', () => {
    const bad = rgxSettingsProblems({
        RGX_REASONS, defaultRgxSettings, normalizeRgxSettings, tidyBlankLines, readRgxFace,
    });
    assert.deepEqual(bad, [], '设置与归因必须与设计一致，实测问题：' + bad.join(' , '));
    /* 视图文案表的键必须取归因常量的**值**（连字符形），不另写一套下划线形 —— 否则查不到会静默走兜底。 */
    const view = read('apps/regexfilter/regexfilter-view.js');
    assert.ok(view.includes('[RGX_REASONS.'), '视图文案表必须由归因常量计算键');
    assert.equal(view.includes('storage_absent:'), false, '视图不得另写一套下划线形键');
    assert.ok(read(RGX_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

test('A5 导出/导入/投影：导出是 ST 正则可用的脚本、坏输入不抛、原型键不进绑定表', () => {
    const bad = rgxExportProblems({
        toStileRegexScripts, toExportText, fromImportText, normalizePreset, projectRgx,
    });
    assert.deepEqual(bad, [], '导出与投影必须与设计一致，实测问题：' + bad.join(' , '));
});

/* ══════════════════════ B ── 打卡内核 ══════════════════════ */
test('B1 同一天并项：再存一次并到当天那张卡里，不另开一张', () => {
    const bad = punchCoreProblems({ createCard });
    assert.deepEqual(bad, [], '并项语义必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(PUNCH_LIMITS.maxCards, 60, '卡数上限（源无上限，本仓存档随会话走）');
});

test('B2 删中间项后按 id 定位：备注与勾选不得串到别项上', () => {
    const bad = punchPatchProblems({ createCard, patchItem, toggleItem, removeItem, removeCard });
    assert.deepEqual(bad, [], '按 id 定位必须真做到，实测问题：' + bad.join(' , '));
    /* 视图必须用 data-id 而不是 data-index 定位勾选/备注（按下标回写＝数据层那条禁区的界面侧同形）。 */
    const view = read('apps/punchcard/punchcard-view.js');
    assert.ok(view.includes('data-id='), '视图必须用 data-id 定位');
    assert.equal(/data-index=/.test(view), false, '视图不得用 data-index 定位');
    assert.ok(view.includes('dataset.id'), '事件回读必须走 dataset.id');
});

test('B3 连续天数：最近一张距今超一天即断，中间缺口只数到缺口', () => {
    const bad = punchStreakProblems({ streakOf });
    assert.deepEqual(bad, [], '连续天数口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B4 投影与注入：没有卡时 latest 为 null，注入只给事实且开关真生效', () => {
    const bad = punchProjectProblems({
        PUNCH_REASONS, projectPunch, createCard, toggleItem, pendingItems, punchPromptBlock, readPunchFace,
    });
    assert.deepEqual(bad, [], '投影与注入口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B5 设置钳制：每一项边界都夹住，读不出时如实回落默认', () => {
    const bad = punchSettingsProblems({ PUNCH_ITEM_KINDS, defaultPunchSettings, normalizePunchSettings });
    assert.deepEqual(bad, [], '设置钳制必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B6 日键与规范化：跨月跨年顺延按本地日期算，空标签丢、kind 收敛', () => {
    const bad = punchDayProblems({ dayKey, shiftDayKey, normalizeItem, normalizeCard, normalizeCards });
    assert.deepEqual(bad, [], '日键与规范化必须与设计一致，实测问题：' + bad.join(' , '));
});

/* ══════════════════════ C ── 接线（两件各四处 + 调用面 + 样式 + 前缀） ══════════════════════ */
test('C1 两件各四处注册齐备：APPS / 懒加载分支 / REBIND 表 / 会话键前缀', () => {
    const idx = read('index.js');
    const apps = read('config/apps.js');
    const storage = read('config/storage.js');
    for (const [id, cls, rel] of [
        ['regexfilter', 'RegexFilterApp', "'./apps/regexfilter/regexfilter-app.js'"],
        ['punchcard', 'PunchcardApp', "'./apps/punchcard/punchcard-app.js'"],
    ]) {
        assert.ok(apps.includes("id: '" + id + "'"), 'config/apps.js 必须登记 id: ' + id);
        assert.ok(idx.includes("appId === '" + id + "'"), 'index.js 必须有懒加载分支 ' + id);
        assert.ok(idx.includes('import(' + rel + ')'), '分支必须指向真实路径 ' + rel);
        assert.ok(new RegExp('new\\s+module\\.' + cls + '\\(').test(idx), cls + ' 必须被构造');
    }
    const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(/'regexFilterApp'/.test(tbl), 'REBIND 表必须含 regexFilterApp');
    assert.ok(/'punchcardApp'/.test(tbl), 'REBIND 表必须含 punchcardApp');
    assert.match(storage, /\/\^regexfilter_\//, '会话隔离表必须有 /^regexfilter_/');
    assert.match(storage, /\/\^punchcard_\//, '会话隔离表必须有 /^punchcard_/');
});

test('C2 视图调用面必须闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* 本仓记过的形态（v3250 修正过两处）：视图 `this.app.xxx()` 而 App 上根本没有 xxx，
     * 界面在**用户真的点到那个按钮时**才炸，平时完全看不出来。这里做成静态契约检查。 */
    const FIELDS = new Set(['settings', 'presets', 'cards', 'face', 'storage', 'shell', 'limits',
        'projection', 'faceReason']);
    for (const [appRel, viewRel] of [
        ['apps/regexfilter/regexfilter-app.js', 'apps/regexfilter/regexfilter-view.js'],
        ['apps/punchcard/punchcard-app.js', 'apps/punchcard/punchcard-view.js'],
    ]) {
        const appSrc = read(appRel);
        const methods = new Set();
        for (const m of appSrc.matchAll(/^[ \t]+(?:get |set )?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) methods.add(m[1]);
        const viewSrc = read(viewRel);
        const called = new Set();
        for (const m of viewSrc.matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
        const missing = [...called].filter((n) => !methods.has(n) && !FIELDS.has(n));
        assert.deepEqual(missing, [], viewRel + ' 调了 App 上不存在的东西：' + missing.join(' , '));
        assert.ok(methods.size >= 5, appRel + ' 的方法面异常小（' + methods.size + '）');
        assert.ok(called.size >= 3, viewRel + ' 的调用面异常小（' + called.size + '）');
    }
});

test('C3 样式源与 phone.css 逐字同源，且视图产出的每个类名都有落点', () => {
    const phone = read('phone.css');
    const segs = [
        ['apps/regexfilter/regexfilter.css', 'rgx-',
            '/* ---------- [v3.26.0] 正则过滤器 App（.rgx-*） ---------- */',
            '/* ---------- [v3.26.0] 打卡 App（.pch-*） ---------- */'],
        ['apps/punchcard/punchcard.css', 'pch-',
            '/* ---------- [v3.26.0] 打卡 App（.pch-*） ---------- */', null],
    ];
    const norm = (x) => (x.startsWith('/*') ? x.slice(x.indexOf('\n') + 1).trim() : x.trim());
    for (const [cssRel, prefix, hdr, nextHdr] of segs) {
        const at = phone.indexOf(hdr);
        assert.ok(at >= 0, 'phone.css 必须带本版段注释：' + hdr);
        const seg = nextHdr ? phone.slice(at, phone.indexOf(nextHdr)) : phone.slice(at);
        /* ★ 源 vs 产物**逐字同源**：本仓样式投递走「打包进 phone.css」，两份手抄必然漂移。 */
        assert.equal(norm(seg), norm(read(cssRel)), 'phone.css 的本版段必须与 ' + cssRel + ' 逐字同源');
        const n = (seg.match(new RegExp('[.]' + prefix, 'g')) || []).length;
        assert.ok(n >= 5, hdr + ' 段必须真的带样式（实测 ' + n + '）');
    }
    /* 每个产出的类名都要有**样式落点**：自己有条规则 / 是 JS 选择器锚点。 */
    for (const [viewRel, appRel, prefix] of [
        ['apps/regexfilter/regexfilter-view.js', 'apps/regexfilter/regexfilter-app.js', 'rgx-'],
        ['apps/punchcard/punchcard-view.js', 'apps/punchcard/punchcard-app.js', 'pch-'],
    ]) {
        const view = read(viewRel);
        const js = view + read(appRel);
        const css = read(viewRel.replace('-view.js', '.css'));
        const cssNames = new Set(css.match(new RegExp('[.]' + prefix + '[a-z0-9-]+', 'g')) || []);
        const anchors = new Set();
        for (const m of js.matchAll(/querySelector(?:All)?\(\s*['"]?[.]([a-z0-9-]+)/g)) anchors.add(m[1]);
        for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
        const produced = new Set();
        for (const m of view.matchAll(/class=["']([^"']+)/g)) {
            for (const tok of m[1].split(/\s+/)) if (tok.startsWith(prefix) && !tok.endsWith('-')) produced.add(tok);
        }
        for (const m of view.matchAll(/className\s*=\s*'([^']+)'/g)) {
            for (const tok of m[1].split(/\s+/)) if (tok.startsWith(prefix)) produced.add(tok);
        }
        const missing = [...produced].filter((x) => !cssNames.has('.' + x) && !anchors.has(x));
        assert.deepEqual(missing, [], viewRel + ' 这些类名既无样式规则也不是锚点：' + missing.join(' , '));
        assert.ok(produced.size >= 5, viewRel + ' 产出的类名异常少（' + produced.size + '）');
    }
});

test('C4 换会话只重取读数，且两件都不碰会话数据 / 不自己调模型', () => {
    for (const [appRel, cls] of [['apps/regexfilter/regexfilter-app.js', 'RegexFilterApp'],
        ['apps/punchcard/punchcard-app.js', 'PunchcardApp']]) {
        const app = read(appRel);
        const m = app.match(/onChatChanged\(\)\s*\{([\s\S]*?)\n    \}/);
        assert.ok(m, appRel + ' 必须有 onChatChanged（REBIND 表要调它）');
        assert.ok(m[1].includes('this.probe()'), appRel + ' 换会话必须重取读数');
        assert.ok(m[1].includes('_loadSettings'), appRel + ' 换会话必须重取设置');
        /* 幂等哨兵：宿主钩子只挂一次（与 focus / piggy 同纪律）。
         * ★ 只有**真挂钩子**的 App 才需要哨兵置位（regexfilter 刻意不挂任何钩子 ——
         *   它就是「不争正文仲裁者」的落点）。字段本身两件都保留：防将来加缓存时漏重绑。 */
        assert.ok(app.includes('this._hookBound = false;'), cls + ' 必须保留幂等哨兵字段');
        if (/eventTypes?\.\w+/.test(app) || /\.on\(/.test(app)) {
            assert.ok(app.includes('this._hookBound = true;'), cls + ' 挂了钩子就必须真置位哨兵');
        }
    }
    /* 两件都不得改会话数据（正文归 tag-filter，消息归微信/日记/剧场）。 */
    for (const rel of ['apps/regexfilter/regexfilter-app.js', 'apps/regexfilter/regexfilter-data.js',
        'apps/regexfilter/regexfilter-view.js', 'apps/punchcard/punchcard-app.js',
        'apps/punchcard/punchcard-data.js', 'apps/punchcard/punchcard-view.js']) {
        const code = stripComments(read(rel));
        for (const bad of ['setChatMessages', 'saveChat', 'chatMetadata', 'messageFormatting',
            'saveData', 'indexedDB', 'openDB', 'IDBKeyRange', 'Dexie',
            'fetch(', 'XMLHttpRequest', 'getGlobalWbText', 'getCharWbText']) {
            assert.equal(code.includes(bad), false, rel + ' 的**代码**里不得出现：' + bad);
        }
    }
});

test('C5 两件的禁忌是真禁忌：正文不争仲裁者（正则）、不替用户叫模型（打卡）—— 先剥注释再判，并两向自证', () => {
    /* ① 正则过滤器不得 hook 生成/渲染（否则就成了第二个正文改写者）。 */
    const rgx = stripComments(read('apps/regexfilter/regexfilter-app.js'));
    for (const bad of ['GENERATE_BEFORE_COMBINE_PROMPTS', 'GENERATE_AFTER_COMBINE_PROMPTS',
        'eventSource', 'MESSAGE_RECEIVED', 'renderMessage', 'applyRegexFilter']) {
        assert.equal(rgx.includes(bad), false, '正则过滤器不得挂生成/渲染钩子：' + bad);
    }
    for (const rel of ['apps/regexfilter/regexfilter-data.js', 'apps/regexfilter/regexfilter-app.js',
        'apps/regexfilter/regexfilter-view.js']) {
        assert.equal(stripComments(read(rel)).includes('tag-filter'), false, rel + ' 不得引用正文仲裁者模块');
    }
    /* ② 打卡有且只有一处宿主钩子，且**只推事实**（不生成、不发消息）。
     *    数**注册点**（`es.on(et.…`）而不是事件名出现次数：本仓范式里事件名必然出现两次
     *    （先守卫 `if (!et.GENERATE_…) return;`、再注册）—— 与 piggy / focus 逐字同形。
     *    钉住「注册恰一次」才真正排除「同一块事实推两遍」。 */
    const pch = stripComments(read('apps/punchcard/punchcard-app.js'));
    const nOn = (pch.match(/\.on\(et\.GENERATE_BEFORE_COMBINE_PROMPTS/g) || []).length;
    assert.equal(nOn, 1, '生成钩子注册点必须恰一处（实测 ' + nOn + '）：挂两处＝同一块事实推两遍');
    assert.equal((pch.match(/\.on\(et\./g) || []).length, 1, '打卡只准挂一个宿主钩子');
    /* 对照：piggy / focus 是同形范式（守卫 + 注册），本件必须与它们一致而不是自创形态。 */
    for (const rel of ['apps/piggy/piggy-app.js', 'apps/focus/focus-app.js']) {
        const peer = stripComments(read(rel));
        assert.equal((peer.match(/\.on\(et\.GENERATE_BEFORE_COMBINE_PROMPTS/g) || []).length, 1,
            rel + ' 的注册点也是 1（同形范式）');
    }
    /* ③ 正则过滤器：一个宿主钩子都不准挂 —— 它就是「不争正文仲裁者」的落点。 */
    assert.equal((stripComments(read('apps/regexfilter/regexfilter-app.js')).match(/\.on\(et\./g) || []).length, 0,
        '正则过滤器不得注册任何宿主钩子');
    assert.equal(pch.includes('generateCard'), false, '不得搬源里那套自己调模型生成作息表的逻辑');
    assert.equal(pch.includes('charSchedule'), false, '`charSchedule` 是源的数据形状，不搬');
    /* ③ 两向自证：剥注释必须真的剥掉了东西，否则上面那些"不出现"可能只是剥器坏了。 */
    for (const rel of ['apps/regexfilter/regexfilter-app.js', 'apps/regexfilter/regexfilter-data.js',
        'apps/punchcard/punchcard-app.js', 'apps/punchcard/punchcard-data.js']) {
        const raw = read(rel);
        assert.ok(raw.length > stripComments(raw).length, rel + ' 剥注释后必须真的变短（否则是空闸）');
    }
    /* ④ 对照面：文件头必须真写着「为什么不能有」——不写就说明"不缝"只是嘴上说说。
     *    这几串是**注释**，故必须在 raw 上命中、在剥注释后消失。 */
    for (const [rel, marker] of [['apps/regexfilter/regexfilter-app.js', 'applyRegexFilter'],
        ['apps/regexfilter/regexfilter-data.js', 'db.regexFilterPresets'],
        ['apps/punchcard/punchcard-app.js', 'IndexedDB'],
        ['apps/punchcard/punchcard-data.js', 'DB_NAME']]) {
        assert.ok(read(rel).includes(marker), rel + ' 的文件头必须写明源的 ' + marker + ' 为何不搬');
        assert.equal(stripComments(read(rel)).includes(marker), false, rel + ' 的 ' + marker + ' 只准出现在注释里');
    }
});

test('C6 前缀不与他人撞：.rgx- / .pch- 全仓唯一，punchcard 不留 pk-（apps/peek 占着）', () => {
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
    for (const [prefix, owner] of [['.rgx-', '/apps/regexfilter/'], ['.pch-', '/apps/punchcard/']]) {
        const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes(prefix));
        assert.ok(users.length > 0, prefix + ' 必须在仓里被用到');
        for (const f of users) {
            const ok = f.includes(owner) || f.endsWith('phone.css');
            assert.ok(ok, prefix + ' 只应出现在 ' + owner + ' 与 phone.css，实测还有：' + f.replace(ROOT, ''));
        }
    }
    /* `.pk-` 已被 apps/peek 占用：punchcard 不得留下独立的 pk-（除 pch- 之外）。 */
    for (const rel of ['apps/punchcard/punchcard-view.js', 'apps/punchcard/punchcard.css',
        'apps/punchcard/punchcard-data.js', 'apps/punchcard/punchcard-app.js']) {
        const src = read(rel);
        assert.equal(/(?<!c)\bpk-/.test(src), false, rel + ' 不得残留独立 pk-（会被 peek 的样式接走）');
        assert.equal(/'pk_'/.test(src), false, rel + " 不得残留 'pk_' id 前缀（与 .pch- 同族化）");
    }
});

test('C7 App 文件四件套齐备，且 data 层保持纯函数（不碰 window / DOM）', () => {
    for (const [dir, prefix] of [['apps/regexfilter', 'rgx'], ['apps/punchcard', 'pch']]) {
        for (const f of ['-data.js', '-app.js', '-view.js', '.css']) {
            assert.ok(fs.existsSync(path.join(ROOT, dir, path.basename(dir) + f)), dir + '/' + path.basename(dir) + f + ' 必须存在');
        }
        const data = read(dir + '/' + path.basename(dir) + '-data.js');
        for (const bad of ['document', 'window', 'localStorage', 'sessionStorage']) {
            assert.equal(stripComments(data).includes(bad), false, dir + ' 的 data 层不得碰 ' + bad + '（纯函数叶子）');
        }
        assert.ok(data.includes("from '../../config/num-gate.js'"), dir + ' 的 data 层应走共享数值门');
        assert.ok(read(dir + '/' + path.basename(dir) + '.css').includes('.' + prefix + '-'), dir + ' 的样式必须用 ' + prefix + '- 前缀');
    }
});

/* ══════════════════════ D ── 键归属 ══════════════════════ */
test('D1 四条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const keys = [];
    for (const [appRel, prefix] of [['apps/regexfilter/regexfilter-app.js', 'regexfilter_'],
        ['apps/punchcard/punchcard-app.js', 'punchcard_']]) {
        const hits = [...read(appRel).matchAll(new RegExp("'(" + prefix + "[a-z_]+)'", 'g'))].map((m) => m[1]);
        const uniq = [...new Set(hits)];
        assert.equal(uniq.length, 2, appRel + ' 必须恰好两条键，实测 ' + uniq.join(','));
        keys.push(...uniq);
    }
    assert.equal(new Set(keys).size, 4, '两件共四条键，实测 ' + keys.join(','));
    for (const key of keys) {
        assert.equal(audit.split("key: '" + key + "'").length - 1, 1, '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次');
        assert.ok(new RegExp("\\{ key: '" + key + "', scope: 'chat'").test(audit), '键 ' + key + ' 必须是会话隔离（scope: chat）');
    }
});

/* ══════════════════════ E ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════════════════ */
/** 破坏表集中在一处：G2 会拿它做「锚点在场性 + 替换保真」的批量自证。 */
const DAMAGE = {
    d1: [RGX_REL,
        "        if (!c.ok) { errors.push({ pattern: norm.pattern, message: c.error }); continue; }",
        "        if (!c.ok) { out = ''; continue; }"],
    d2: [PCH_REL,
        '        const items = c.items.map((it) => {\n            if (it.id !== iid) return it;',
        '        const items = c.items.map((it, __i) => {\n            if (__i !== Number(iid)) return it;'],
    d3: [PCH_REL,
        '    const gapOk = newest === today || newest === shiftDayKey(today, -1);',
        '    const gapOk = newest === today;'],
    d4: [PCH_REL,
        '    const idx = base.findIndex((c) => c.date === date);\n    if (idx >= 0) {',
        '    const idx = -1;\n    if (idx >= 0) {'],
    d5: [PCH_REL,
        '        maxInjectItems: boundedInt(o.maxInjectItems, d.maxInjectItems, 0, 20),',
        '        maxInjectItems: boundedInt(o.maxInjectItems, d.maxInjectItems, 1, 20),'],
    d6: [RGX_REL,
        '    return compileRule(rule).ok;',
        '    return true;'],
    d7: [RGX_REL,
        '    if (!probe || probe.storageOk === false) return RGX_REASONS.storage_absent;\n    if (probe.hasPresets !== true) return RGX_REASONS.empty;',
        '    if (!probe || probe.hasPresets !== true) return RGX_REASONS.empty;'],
    d8: [PCH_REL,
        "    if (!settings || settings.injectToPrompt !== true) return '';",
        '    if (!settings) return \'\';'],
};

const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v326_'));
    const target = path.join(dir, 'apps', path.basename(path.dirname(rel)), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    const gateDir = path.join(dir, 'config');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(target).href);
}

test('E1 破坏「坏规则跳过」为「吞掉文本」⇒ A2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d1;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = rgxBadRuleProblems({
        compileRule: mod.compileRule, isRuleValid: mod.isRuleValid,
        normalizeRule: mod.normalizeRule, applyRulesToText: mod.applyRulesToText,
    });
    assert.ok(bad.some((x) => x.startsWith('bad-ate-text')), '文本被吞后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(rgxBadRuleProblems({ compileRule, isRuleValid, normalizeRule, applyRulesToText }), [],
        '对照：真实现必须不吞文本');
});

test('E2 破坏「按 id 定位」为「按下标」⇒ B2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d2;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = punchPatchProblems({
        createCard: mod.createCard, patchItem: mod.patchItem, toggleItem: mod.toggleItem,
        removeItem: mod.removeItem, removeCard: mod.removeCard,
    });
    assert.ok(bad.some((x) => x.startsWith('patch-changed') || x.startsWith('remark-landed-wrong')),
        '按下标定位后必须报出串项，实测：' + bad.join(' , '));
    assert.deepEqual(punchPatchProblems({ createCard, patchItem, toggleItem, removeItem, removeCard }), [],
        '对照：真实现必须按 id 落到同一项');
});

test('E3 破坏连续天数的「昨天也算连」⇒ B3 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d3;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = punchStreakProblems({ streakOf: mod.streakOf });
    assert.ok(bad.some((x) => x.startsWith('streak2-yesterday')), '昨天算断后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(punchStreakProblems({ streakOf }), [], '对照：真实现必须把昨天算进连续');
});

test('E4 破坏「同一天并项」为「总是新开一张」⇒ B1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d4;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = punchCoreProblems({ createCard: mod.createCard });
    assert.ok(bad.some((x) => x.startsWith('second-card-not-merged')), '不再并项后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(punchCoreProblems({ createCard }), [], '对照：真实现必须并项');
});

test('E5 破坏设置下界（0 → 1）⇒ B5 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d5;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = punchSettingsProblems({ PUNCH_ITEM_KINDS: mod.PUNCH_ITEM_KINDS, defaultPunchSettings: mod.defaultPunchSettings, normalizePunchSettings: mod.normalizePunchSettings });
    assert.ok(bad.some((x) => x.startsWith('clamp-inject-lo')), '下界被抬后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(punchSettingsProblems({ PUNCH_ITEM_KINDS, defaultPunchSettings, normalizePunchSettings }), [], '对照：真实现的下界是 0');
});

test('E6 破坏「规则可编译」判定（一律 true）⇒ A2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d6;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = rgxBadRuleProblems({
        compileRule: mod.compileRule, isRuleValid: mod.isRuleValid,
        normalizeRule: mod.normalizeRule, applyRulesToText: mod.applyRulesToText,
    });
    assert.ok(bad.some((x) => x.startsWith('bad-valid')), '判定恒真后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(rgxBadRuleProblems({ compileRule, isRuleValid, normalizeRule, applyRulesToText }), [], '对照：真实现必须判出坏规则');
});

test('E7 破坏归因顺序（丢掉「能不能读」那一判）⇒ A4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d7;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = rgxSettingsProblems({
        RGX_REASONS: mod.RGX_REASONS, defaultRgxSettings: mod.defaultRgxSettings,
        normalizeRgxSettings: mod.normalizeRgxSettings, tidyBlankLines: mod.tidyBlankLines,
        readRgxFace: mod.readRgxFace,
    });
    assert.ok(bad.some((x) => x.startsWith('absent') || x.startsWith('null-probe')),
        '丢掉可读性判定后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(rgxSettingsProblems({ RGX_REASONS, defaultRgxSettings, normalizeRgxSettings, tidyBlankLines, readRgxFace }), [],
        '对照：真实现必须先判可读性');
});

test('E8 破坏注入开关（不看 injectToPrompt）⇒ B4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d8;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = punchProjectProblems({
        PUNCH_REASONS: mod.PUNCH_REASONS,
        projectPunch: mod.projectPunch, createCard: mod.createCard, toggleItem: mod.toggleItem,
        pendingItems: mod.pendingItems, punchPromptBlock: mod.punchPromptBlock, readPunchFace: mod.readPunchFace,
    });
    assert.ok(bad.some((x) => x.startsWith('inject-off')), '开关被无视后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(punchProjectProblems({
        PUNCH_REASONS, projectPunch, createCard, toggleItem, pendingItems, punchPromptBlock, readPunchFace,
    }), [], '对照：真实现的开关必须真生效');
});

/* ══════════════════════ G ── 判据工具自证 ══════════════════════ */
test('G1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：C5 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，C5 只会**更绿** —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「假绿」族（对原文件断言 / 破坏写死成常量 / 判据自我指涉之外：工具被削成空闸）。
     *   故必须两向自证。 */
    const raw = '// 注释里写 applyRegexFilter\n'
        + 'const a = "applyRegexFilter";\n'
        + '/* 块注释 charSchedule */\n'
        + 'const b = 1;\n'
        + "const c = 'x//not-a-comment';";
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"applyRegexFilter"'), '字符串字面量必须留住（剥器不得把字符串里的同形文本一起吃掉）');
    assert.ok(stripped.includes("'x//not-a-comment'"), '字符串里的 // 不是注释起头（剥器不得在字符串内切换状态）');
    assert.equal(stripped.includes('注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.ok(stripped.includes('const b = 1;'), '普通代码必须原样留下');
    /* 模板串与转义引号也是状态机必须正确处理的两种输入。 */
    assert.equal(stripComments('const t = `a${"//"}b`; // 真注释').includes('真注释'), false, '模板串后的注释必须剥掉');
    assert.ok(stripComments("const s = 'a\\'//b';").includes("a\\'//b"), '转义引号不得让状态机提前收尾');
});

test('G2 破坏表自证：锚点必须在场（恰 1 次）、替换必须保真、替换后旧串归零', () => {
    /* ★ E12：负控制自身最隐蔽的失效形态是**锚点漂移**——产品改动让锚点失配，
     *   split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿。故「在场性」必须与「保真」一起被自证。 */
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
        assert.ok(out.includes(to), name + ' 替换后新串必须在场');
        assert.notEqual(from, to, name + ' 的 from/to 不得相同（那样不是破坏）');
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace：替换串里一旦出现 `$`，
     *   `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形、负控制失去判别力。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
    /* 破坏锚点必须真的落在**代码**里（不是注释里）—— 落在注释里的锚点破坏不了任何行为。 */
    for (const [name, [rel, from]] of Object.entries(DAMAGE)) {
        assert.ok(stripComments(read(rel)).includes(from.replace(/^[ \t]+/gm, (m) => m).split('\n')[0].trim().slice(0, 24)),
            name + ' 的锚点首行必须出现在剥注释后的代码里');
    }
});

/* ══════════════════════ V ── 版本锚 ══════════════════════ */
test('V1 版本锚（下限形）+ 三源同源', () => {
    const manV = JSON.parse(read('manifest.json')).version;
    const pkgV = JSON.parse(read('package.json')).version;
    const src = read('index.js');
    const parts = manV.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 26),
        '本套件成立于 RubyPhone 3.26.0 及以后，当前 ' + manV);
    assert.equal(pkgV, manV, 'package.json 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + manV + "';"), '入口版本常量必须与 manifest 同版');
});
