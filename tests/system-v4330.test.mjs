/* ============================================================
 * tests/system-v4330.test.mjs -- [v4.33.0 · 第五期 R5-O6 资料更新：保住旧版再比较新版]
 *
 * 验收口径（计划原文 R5-O6）：
 *   区分「已应用源版本 / 正在读的候选版本 / 当前阅读窗口」；选新文件**不覆盖旧比较基线**；
 *   可比较、保留映射、确认应用或取消；重开后仍知道当前采用哪个版本。
 *   不做：不默认永久复制两个全文到 PhoneStorage（只保存版本引用）。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `_blankLore()` 只有一份 `base`/`parsed`，而「已应用版本」当时就是这两个字段本身：
 *   `loreReadSource` 一读新文件就把它们换掉 ⇒ 基线被候选顶掉。后果：
 *     · `loreCompareSource` 的 `oldParsed` 传的是 `L.base`（刚被覆盖过的那一份），
 *       等于「拿候选与自己比」——读数恒为「全部同值」；
 *     · 界面写着「什么都没变」，而用户手上明明是一份改过的资料。**不报错，只是错读数**。
 *   这类「两件不同的事共用一个字段」正是本仓反复治的那一格：状态一旦压平，
 *   处置相反的处境就长得一样了（放心 vs 去确认应用）。
 *
 * 【本版落的四件】（一）契约件 `config/lore-import-contract.js` 新增纯算术的
 *   `loreVersionRef`（只出引用：文件名 + 字符数 + 段键与指纹，**不带正文**）与
 *   `loreChangedLine`（版本/变更读数的**唯一实现**，视图只排版不许重拼）；
 *   `readLoreChanged` 的 `removedTrusted` 收严为「有基线 **且** 候选是整篇读」。
 *   （二）控制器把基线面与候选面分开：`appliedBase`/`appliedRef`/`appliedFile`/`appliedSource`
 *   vs `base`/`parsed`/`candidateRef`/`candidatePartial`；基线**唯一更新点**在
 *   `loreApplyNow` 的 `ok === true` 分支；新增 `loreDiscardCandidate()`（取消候选回到已应用）
 *   与 `loreVersions()`（三份版本一句读数）。（三）视图三行版本 + 变更读数行 + 「对账」
 *   「取消候选」两按钮，样式两侧同投。（四）自检扩到十八项，把「只剩引用」「窗口候选」
 *   「移除清单不可采信」三条真判据钉进内核自证。
 *
 * 判据面（五组）：
 *   A 口径：版本引用三性（可复算 / 改字即变 / 不带正文）、变更读数四态不同句、
 *           窗口候选不可采信、自检十八项、纯内核零副作用
 *   B 内核行为：partialCandidate 严格透传、oldChecked 真假两面、无插件如实报、计数与清单齐
 *   C 接线行为：A→应用→选B→真差异→取消仍是A→再选B并确认才更新基线；
 *           窗口读不把窗口外当「已删除」；重开后只剩引用「比不了也回不去」；
 *           落笔失败不动基线；引用按会话分键
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源 + 当版条目条数
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/lore-import-contract.js';
const APP_REL = 'apps/memory/memory-app.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const VIEW_CSS_REL = 'apps/memory/memory.css';
const BUNDLE_CSS_REL = 'phone.css';
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BS = String.fromCharCode(92);
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const appCssSrc = read(VIEW_CSS_REL);
const bundleCssSrc = read(BUNDLE_CSS_REL);
/**
 * 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。
 *
 * 【必须认识正则字面量 —— 本套件首跑实测到的**判据自身纯度缺陷**】
 *   视图里 `_esc` 有一句 `s.replace(/"/g, '"')`。第一版助手把 `/` 后面的 `"`
 *   当成字符串起头，于是从那一行起整份文件被错位吞掉：注释没被剥掉、代码被吃掉，
 *   后面所有 `indexOf` 断言都在**一段错位的文本**上量 —— 判据看着绿或红都不可信。
 *   修法：认出正则字面量并整段跳过（`[...]` 字符类与转义都要认）。
 *   判据的助手本身出错，与「被测代码写错」是两件事，必须分开记账。
 */
function stripComments(src) {
    const RX_PREV = '([{=,;:!&|?+-*%~^<>';
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    let prev = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            /* 正则字面量：`/` 前面是运算符 / 开括号 / 行首时才可能是正则（不是除法）。 */
            if (c === '/' && (prev === '' || RX_PREV.indexOf(prev) >= 0)) {
                let j = i + 1;
                let inCls = false;
                while (j < src.length) {
                    const e = src[j];
                    if (e === BS) { j += 2; continue; }
                    if (e === NL) break;
                    if (inCls) { if (e === ']') inCls = false; j += 1; continue; }
                    if (e === '[') { inCls = true; j += 1; continue; }
                    if (e === '/') { j += 1; break; }
                    j += 1;
                }
                out += src.slice(i, j);
                prev = '/';
                i = j;
                continue;
            }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; prev = c; i += 1; continue; }
            out += c;
            if (c.trim()) prev = c;
            i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; prev = ''; } i += 1; continue; }
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; prev = c; i += 1; continue; }
        if (c === NL) { state = 'code'; out += c; prev = ''; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const S = K.LORE_FACE_STATES;
/* ══════════ 假件 ══════════ */
/** 纯算术指纹（与内核同款算法，仅用于假件造 textHash）。 */
function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
}
const CLASS_LABEL = {
    'setting-rule': '设定规则', 'backstory-event': '前史事件',
    'character-bg': '角色背景', 'reference-only': '仅供参考'
};
function clsOf(t) {
    if (/规则|设定/.test(t)) return 'setting-rule';
    if (/前史|事件|过去/.test(t)) return 'backstory-event';
    return 'character-bg';
}
/** storage 假件：三件齐（get/set/remove）并带 currentConversationId（引用按会话分键）。 */
function mkStorage(cid) {
    const mem = new Map();
    return {
        _mem: mem,
        currentConversationId: cid || '',
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        remove: (k) => { mem.delete(k); },
        has: (k) => mem.has(k)
    };
}
/**
 * 一份资料切成段（首行 `# 标题` 起一段）。**正文取真正文**：首版把 text 合成成
 *   「标题 的正文」，于是任何正文里的差异都命不中 —— 假件自己把待测行为抹掉了。
 */
function parseDoc(text, file) {
    const full = String(text == null ? '' : text).split(CR + NL).join(NL);
    const lines = full.split(NL);
    const sections = [];
    let openSec = -1;
    for (const ln of lines) {
        if (ln.slice(0, 2) === '# ') {
            const title = ln.slice(2).trim();
            sections.push({ index: sections.length + 1, title: title, cls: clsOf(title), buf: [ln] });
            openSec = sections.length - 1;
            continue;
        }
        if (openSec >= 0) sections[openSec].buf.push(ln);
    }
    const items = [];
    const secs = [];
    for (const sec of sections) {
        const body = sec.buf.join(NL).trim();
        secs.push({ index: sec.index, title: sec.title, cls: sec.cls, text: body, sourceRef: { file: file, section: sec.index, title: sec.title } });
        items.push({
            key: 'L' + sec.index + '#' + sec.cls, cls: sec.cls, clsLabel: CLASS_LABEL[sec.cls],
            title: sec.title, text: body.slice(0, 80), textHash: fnv(body),
            origin: 'imported', settingAsHappened: false, sensitive: false
        });
    }
    const classes = {};
    for (const it of items) classes[it.cls] = (classes[it.cls] || 0) + 1;
    return {
        ok: items.length > 0,
        source: { file: file, chars: full.length, lines: lines.length, truncated: false },
        completeness: { state: 'complete', totalChars: full.length, readChars: full.length, truncated: false, nextCursor: null },
        sections: secs, items: items, classes: classes, why: []
    };
}
/** 逐段 diff（上游 loreImportChanged 的形态）：按 title 配对 + textHash 判同值。 */
function diffDoc(oldP, newP) {
    const out = { added: [], removed: [], changed: [], same: [], counts: { added: 0, removed: 0, changed: 0, same: 0 }, oldChecked: false, why: [] };
    const oi = (oldP && Array.isArray(oldP.items)) ? oldP.items : null;
    if (!oi) { out.why.push('old-source-absent'); return out; }
    out.oldChecked = true;
    const ni = (newP && Array.isArray(newP.items)) ? newP.items : [];
    const oldHash = new Map();
    for (const it of oi) oldHash.set(String(it.title || ''), String(it.textHash || ''));
    const newTitles = new Set(ni.map((x) => String(x.title || '')));
    for (const it of ni) {
        const t = String(it.title || '');
        if (!oldHash.has(t)) { out.added.push(t); out.counts.added += 1; continue; }
        if (oldHash.get(t) === String(it.textHash || '')) { out.same.push(t); out.counts.same += 1; }
        else { out.changed.push(t); out.counts.changed += 1; }
    }
    for (const it of oi) {
        const t = String(it.title || '');
        if (!newTitles.has(t)) { out.removed.push(t); out.counts.removed += 1; }
    }
    return out;
}
/**
 * 上游插件假身（十一口齐全）。`ctl` 是**可变控制台**：
 *   `ctl.reject = true` 让落笔口返回被拒 —— 用来验证「落笔失败不动基线」。
 */
function mkPlugin(ctl) {
    const c = ctl || {};
    const st = { apply: 0, changed: 0, parse: 0, window: 0, applied: [] };
    const p = {
        loreImportDescribe: () => ({
            present: 11, total: 11, missing: [],
            classes: ['setting-rule', 'backstory-event', 'character-bg', 'reference-only'],
            classLabels: ['设定规则', '前史事件', '角色背景', '仅供参考'],
            classesExhaustive: true, settingVsHappenedSplit: true, maskFixedLength: true,
            secretBodyKeys: [], maxSourceChars: 400000, offline: true, writesNothing: true
        }),
        loreImportParse: (raw) => {
            st.parse += 1;
            const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { text: raw };
            return parseDoc(String(input.text == null ? '' : input.text), String(input.file || ''));
        },
        loreImportParseWindow: (raw, opts) => {
            st.window += 1;
            const o = opts || {};
            const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { text: raw };
            const full = String(input.text == null ? '' : input.text).split(CR + NL).join(NL);
            const from = Number((o.range && o.range.from) || 0);
            const to = Math.min(full.length, Number((o.range && o.range.to) || full.length));
            const aligned = full.slice(from, to);
            const res = parseDoc(aligned, String(input.file || ''));
            const hasNext = to < full.length;
            res.completeness = {
                state: hasNext ? 'partial' : 'complete', totalChars: full.length,
                readChars: to, windowFrom: from, windowTo: to, truncated: false,
                nextCursor: hasNext ? to : null
            };
            res.window = { from: from, to: to, chars: aligned.length, hasNext: hasNext };
            return res;
        },
        loreImportEntities: () => ({ checked: true, exact: 0, needsConfirm: 0, unresolved: 0, entries: [], why: [] }),
        loreImportPreview: (parsed) => {
            const items = (parsed && Array.isArray(parsed.items)) ? parsed.items : [];
            const entries = items.map((it) => ({ key: String(it.key || ''), cls: String(it.cls || ''), title: String(it.title || ''), action: 'add', why: 'target-absent', sensitive: false }));
            return {
                verdict: 'ok', entries: entries, add: entries.length, same: 0, conflict: 0,
                mapping: 0, dangling: 0, skipped: 0, total: entries.length,
                confirmedChecked: true, knownRefsChecked: true, why: []
            };
        },
        loreImportPlan: (parsed, pv) => {
            const entries = (pv && Array.isArray(pv.entries)) ? pv.entries : [];
            return {
                ok: entries.length > 0, importId: 'li_' + String((parsed && parsed.source && parsed.source.file) || '') + '#' + entries.length,
                duplicate: false, applied: entries.map((e) => ({ key: e.key, cls: e.cls, action: e.action })),
                count: entries.length, total: entries.length, skipped: [], reason: 'ok',
                writesNothing: true, nextCursor: null
            };
        },
        loreImportOverride: (parsed) => ({ ok: true, items: (parsed && parsed.items) || [], applied: 0, rejected: [], counts: {}, why: [] }),
        loreImportConfirmMapping: () => ({ checked: true, needsConfirm: [], resolved: [], unresolved: 0, mappingNeedsConfirm: [], why: [] }),
        loreImportChanged: (a, b) => { st.changed += 1; return diffDoc(a, b); },
        loreImportApply: async (parsed) => {
            st.apply += 1;
            const items = ((parsed && parsed.items) || []).map((it) => ({ key: String(it.key || ''), cls: String(it.cls || ''), action: 'add' }));
            if (c.reject === true) {
                return {
                    ok: false, reason: 'apply-rejected', importId: 'li_r', duplicate: false,
                    selected: 0, applied: 0, verified: 0, persisted: false, readback: false,
                    items: [], rejected: [{ key: items.length ? items[0].key : '', why: 'owner-refused' }],
                    writes: 0, zeroWrite: true, stale: false, undo: null
                };
            }
            st.applied.push(items.length);
            return {
                ok: true, reason: 'ok', importId: 'li_ok_' + String(items.length), duplicate: false,
                selected: items.length, applied: items.length, verified: items.length,
                persisted: true, readback: true, items: items, rejected: [],
                writes: items.length, zeroWrite: false, stale: false,
                undo: { separate: true, token: 'tk1', note: '撤前情不动事实' }
            };
        },
        loreImportLedger: () => ({
            version: 1, seen: st.applied.length, chars: 0, decisions: 0, mappings: 0,
            lastApply: st.applied.length ? { importId: 'li_ok_' + st.applied[st.applied.length - 1], applied: st.applied[st.applied.length - 1], verified: 1, readback: true } : null
        })
    };
    p.__st = st;
    return { LonShaMemory: p };
}
function mkApp(plugin, storage) {
    globalThis.window = Object.assign({ VirtualPhone: {} }, plugin ? { LonShaMemory: plugin.LonShaMemory } : {});
    return new APP.MemoryApp(null, storage || mkStorage());
}
/* 两份真能切段的资料：A 三段；B = 同一段 A + 改一段 + 增一段（A→B 恰 added 1 / changed 1 / same 2）。 */
const SRC_A = [
    '# 世界观规则', '魔法受规则约束，时间线性。', '',
    '# 前史事件', '十年前北街那场火，是甲先看见的。', '',
    '# 角色背景', '乙出身书香门第。'
].join(NL);
const SRC_B = [
    '# 世界观规则', '魔法受规则约束，时间线性。', '',
    '# 前史事件', '十年前北街那场火，是丙先看见的。', '',
    '# 角色背景', '乙出身书香门第。', '',
    '# 规则补录', '夜市三更收摊，不许点灯。'
].join(NL);
/** 把「落笔成功」这一件事做完（读→预览→计划→落笔），返回落笔读数。 */
async function applyFrom(app, text, file) {
    app.loreReadSource(text, file, {});
    app.lorePreview(null, {});
    app.loreMakePlan(null, {});
    return app.loreApplyNow({});
}
/* ══════════ A ── 口径面 ══════════ */
test('A1 版本引用三性：同一份复算不变 / 改一个字就变 / 引用不带正文', () => {
    const pA = parseDoc(SRC_A, 'a.txt');
    const pB = parseDoc(SRC_B, 'b.txt');
    const r1 = K.loreVersionRef('a.txt', pA);
    const r2 = K.loreVersionRef('a.txt', parseDoc(SRC_A, 'a.txt'));
    assert.equal(r1.key, r2.key, '同一份资料重读一次，版本键必须不变（否则「还是不是同一版」判不出来）');
    assert.ok(r1.key.startsWith('lv_'), '引用键必须带可辨认前缀：' + r1.key);
    assert.equal(r1.chars, SRC_A.length, '引用必须带字符数');
    assert.equal(r1.sections, 3, '引用必须带段数');
    const rMut = K.loreVersionRef('a.txt', parseDoc(SRC_A.split('甲').join('丁'), 'a.txt'));
    assert.notEqual(rMut.key, r1.key, '★ 改一个字版本键必须变');
    assert.notEqual(K.loreVersionRef('b.txt', pA).key, r1.key, '★ 换文件名版本键同样必须变');
    /* 引用**不许**夹带正文：计划原文的「不做」是不默认永久复制两个全文到 PhoneStorage。 */
    const dump = JSON.stringify(r1);
    assert.equal(dump.indexOf('魔法受规则'), -1, '★ 版本引用不得夹带正文');
    assert.equal(dump.indexOf('世界观规则'), -1, '★ 版本引用不得夹带段标题清单（那等于半个副本）');
    assert.ok(dump.length < 200, '引用必须是「一把键 + 三个数」，实测 ' + dump.length + ' 字符');
    /* 空资料也要给出一把键：空串冒充「有版本」是另一种压平。 */
    assert.notEqual(K.loreVersionRef('', null).key, '', '空资料也要给出明确的键（不许空串）');
    assert.equal(K.loreVersionRef('', null).sections, 0);
    /* 纯算术：同一输入在任何时刻结果相同（无时钟、无随机）。 */
    assert.ok(kernelCode.indexOf('Math.random') < 0, '版本键不得掺随机');
    assert.ok(kernelCode.indexOf('Date.now') < 0, '版本键不得掺时钟');
    /* B 与 A 的段数不同也要能反映出来。 */
    assert.equal(K.loreVersionRef('b.txt', pB).sections, 4);
});
test('A2 变更读数四态必须四句：还没比过 / 没有已应用版本 / 只剩引用比不了 / 已比较', () => {
    const refA = K.loreVersionRef('a.txt', parseDoc(SRC_A, 'a.txt'));
    const never = K.loreChangedLine(null, {});
    const noBase = K.loreChangedLine({ state: S.EMPTY, faceReason: 'no-old-source', oldChecked: false, counts: { added: 0, removed: 0, changed: 0, same: 0 }, partialCandidate: false, removedTrusted: false }, {});
    const refOnly = K.loreChangedLine({ state: S.BLOCKED, faceReason: 'baseline-body-absent', oldChecked: false, counts: { added: 0, removed: 0, changed: 0, same: 0 }, partialCandidate: false, removedTrusted: false }, { applied: refA });
    const done = K.loreChangedLine({ state: S.OK, oldChecked: true, counts: { added: 1, removed: 0, changed: 1, same: 2 }, partialCandidate: false, removedTrusted: true }, { applied: refA, candidate: refA });
    const all = [never, noBase, refOnly, done];
    assert.equal(new Set(all).size, 4, '★ 四态必须四句不同形：' + all.join(' || '));
    assert.ok(never.indexOf('还没比过') >= 0, '没比过要说清是「还没比」：' + never);
    assert.ok(noBase.indexOf('没有已应用版本') >= 0, '没有基线要说清「没有已应用版本」：' + noBase);
    assert.ok(refOnly.indexOf('只剩引用') >= 0, '★ 只剩引用必须写在读数里：' + refOnly);
    assert.ok(refOnly.indexOf('比不了') >= 0, '★ 只剩引用时是「比不了」，不是「没有变化」：' + refOnly);
    assert.equal(noBase.indexOf('只剩引用'), -1, '★「没有应用过」与「只剩引用」不许互相冒充');
    assert.equal(done.indexOf('没有已应用版本'), -1, '已比较却说没基线 = 读数自相矛盾');
    assert.ok(done.indexOf('新增 1') >= 0 && done.indexOf('变更 1') >= 0 && done.indexOf('同值 2') >= 0, '已比较必须四项计数齐全：' + done);
    /* 读数只许有一份实现：视图不许自己拼句子（拼出来迟早与内核分叉）。 */
    assert.ok(kernelCode.indexOf('export function loreChangedLine') >= 0);
    assert.equal(viewCode.indexOf("'新增 '"), -1, '★ 视图不许自己拼「新增 n」');
    assert.equal(viewCode.indexOf('变更:'), -1, '★ 视图不许重拼变更句');
    /* 判据助手的**纯度自证**：本套件首跑时 stripComments 不认识正则字面量，
     *   从 `_esc` 里那句 `/"/g` 起整份视图被错位吞掉 —— 上面两条断言当时量的是
     *   一段错位文本，结论不可信。助手出错与代码出错必须分开记账，故这里钉住它。 */
    const rxProbe = stripComments('const a = s.replace(/"/g, "x");' + NL + "const b = '变更:';" + NL);
    assert.ok(rxProbe.indexOf('replace') >= 0, '★ 去注释助手必须认识正则字面量（否则整份文件会被错位吞掉）');
    assert.ok(rxProbe.indexOf('const b') >= 0, '★ 正则之后的行必须仍在（错位吞掉的形态就是这一行没了）');
    assert.equal(stripComments('/* 变更: */' + NL + 'const c = 1;' + NL).indexOf('变更:'), -1, '注释里的字面量必须真被剥掉');
});
test('A3 窗口候选必须与整篇候选不同句，且移除清单不可采信', () => {
    const winC = { state: S.OK, oldChecked: true, counts: { added: 0, removed: 2, changed: 0, same: 1 }, partialCandidate: true, removedTrusted: false };
    const fullC = { state: S.OK, oldChecked: true, counts: { added: 0, removed: 2, changed: 0, same: 1 }, partialCandidate: false, removedTrusted: true };
    const lw = K.loreChangedLine(winC, { window: { from: 0, to: 40000 } });
    const lf = K.loreChangedLine(fullC, {});
    assert.notEqual(lw, lf, '★ 窗口候选与整篇候选必须不同句（否则「没读到」被读成「已删除」）');
    assert.ok(lw.indexOf('窗口读') >= 0, '窗口候选必须写在读数里：' + lw);
    assert.ok(lw.indexOf('不得据此判「已删除」') >= 0, '窗口候选必须给出正确处置：' + lw);
    assert.ok(lw.indexOf('0-40000') >= 0, '窗口候选要给出读到哪儿了：' + lw);
});
test('A4 移除清单可采信性三重分形：无基线 / 窗口候选 / 整篇候选', () => {
    const win = mkPlugin({});
    globalThis.window = { LonShaMemory: win.LonShaMemory };
    const pA = parseDoc(SRC_A, 'a.txt');
    const pB = parseDoc(SRC_B, 'b.txt');
    const noBase = K.readLoreChanged(globalThis.window, null, pB, {});
    const winCand = K.readLoreChanged(globalThis.window, pA, pB, { partialCandidate: true });
    const fullCand = K.readLoreChanged(globalThis.window, pA, pB, { partialCandidate: false });
    assert.equal(noBase.removedTrusted, false, '没有基线时移除清单不可采信');
    assert.equal(winCand.removedTrusted, false, '★ 窗口候选的移除清单不可采信');
    assert.equal(fullCand.removedTrusted, true, '整篇候选 + 有基线时移除清单可采信（否则上两条是假绿）');
    assert.equal(fullCand.counts.added, 1);
    assert.equal(fullCand.counts.changed, 1);
    assert.equal(fullCand.counts.same, 2);
    assert.equal(fullCand.counts.removed, 0);
    /* 严格判 true：非 true 的 partialCandidate 一律当「整篇」（不是当窗口，也不是当未给）。 */
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        assert.equal(K.readLoreChanged(globalThis.window, pA, pB, { partialCandidate: bad }).partialCandidate, false, '★ 非 true 一律当「不是窗口」：' + JSON.stringify(bad));
    }
    delete globalThis.window;
});
test('A5 内核自检十八项且零问题（加了口径必须加自证）', () => {
    const r = K.loreSelfCheck();
    assert.deepEqual(r.problems, [], '自检必须零问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 6);
    assert.equal(r.outlets, 3);
    assert.equal(r.stages, 6);
    assert.ok(kernelSrc.indexOf('判据自证(十八项)') >= 0, '★ 自检项数必须写在档头（本版新增四条：版本引用/只剩引用/窗口候选/移除可采信）');
    assert.equal(kernelSrc.indexOf('判据自证(十四项)'), -1, '旧计数必须已被换掉（否则档头在说谎）');
    const pushes = kernelSrc.split('problems.push').length - 1;
    assert.ok(pushes >= 60, '自证点数实测应不少于 60（当前 ' + pushes + '）—— 少了说明有口径只加不证');
    /* 本版新增的三条判据必须真在自检里（不是只写在注释里）。 */
    for (const needle of ['同一份资料重读一次版本键必须不变', '改一个字版本键必须变', '「只剩引用」与「没有应用过」必须不同句', '窗口候选必须写在读数里', '窗口候选的移除清单不可采信']) {
        assert.ok(kernelCode.indexOf(needle) >= 0, '自检必须真判这一条：' + needle);
    }
});
test('A6 纯内核：版本引用与读数行零 DOM / 零存储 / 零联网 / 零时钟', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'setTimeout', 'new Date(']) {
        assert.equal(kernelCode.indexOf(bad), -1, '★ 纯契约件不得出现 ' + bad);
    }
    const refFn = kernelCode.slice(kernelCode.indexOf('export function loreVersionRef'), kernelCode.indexOf('export function loreChangedLine'));
    assert.ok(refFn.length > 100, '必须真的切到版本引用那一段');
    assert.equal(refFn.indexOf('items.push'), -1, '版本引用不得把正文搬进结果');
    assert.ok(refFn.indexOf('textHash') >= 0, '指纹必须取自上游段指纹（本层不自己算正文哈希）');
});
/* ══════════ B ── 内核行为面 ══════════ */
test('B1 partialCandidate 透传：窗口候选一路传到读数与可采信性', () => {
    const win = { LonShaMemory: mkPlugin({}).LonShaMemory };
    const pA = parseDoc(SRC_A, 'a.txt');
    const pB = parseDoc(SRC_B, 'b.txt');
    const r = K.readLoreChanged(win, pA, pB, { partialCandidate: true });
    assert.equal(r.partialCandidate, true, '★ 窗口标记必须透传（压平即把「没读到」说成「已删除」）');
    assert.equal(r.removedTrusted, false);
    assert.equal(r.state, S.OK, '窗口候选仍是「比出来了」，不是「比不了」');
    assert.equal(r.faceReason, 'compared');
});
test('B2 oldChecked 真假两面：没给旧稿 ≠ 旧稿与新稿一样', () => {
    const win = { LonShaMemory: mkPlugin({}).LonShaMemory };
    const pB = parseDoc(SRC_B, 'b.txt');
    const noOld = K.readLoreChanged(win, null, pB, {});
    assert.equal(noOld.oldChecked, false);
    assert.equal(noOld.state, S.EMPTY, '★ 没有旧稿必须与「有旧稿且全同」不同形');
    assert.equal(noOld.faceReason, 'no-old-source');
    assert.deepEqual(noOld.why, ['old-source-absent']);
    const withOld = K.readLoreChanged(win, parseDoc(SRC_A, 'a.txt'), pB, {});
    assert.equal(withOld.oldChecked, true);
    assert.equal(withOld.state, S.OK);
    assert.equal(withOld.faceReason, 'compared');
    assert.notEqual(K.loreChangedLine(noOld, {}), K.loreChangedLine(withOld, {}));
});
test('B3 插件不在场 / 没有这一面 / 回执畸形 / 抛错：如实报而不抛', () => {
    const pB = parseDoc(SRC_B, 'b.txt');
    const absent = K.readLoreChanged(null, {}, pB, {});
    assert.equal(absent.state, S.ENGINE_ABSENT);
    assert.equal(absent.faceReason, 'plugin-absent');
    assert.equal(absent.removedTrusted, false, '没有插件时移除清单同样不可采信');
    const noFace = K.readLoreChanged({ LonShaMemory: {} }, {}, pB, {});
    assert.equal(noFace.state, S.FACE_ABSENT);
    const malformed = K.readLoreChanged({ LonShaMemory: { loreImportChanged: () => null } }, {}, pB, {});
    assert.equal(malformed.state, S.UNUSABLE);
    assert.equal(malformed.faceReason, 'malformed');
    const thrown = K.readLoreChanged({ LonShaMemory: { loreImportChanged: () => { throw new Error('boom'); } } }, {}, pB, {});
    assert.equal(thrown.state, S.UNUSABLE);
    assert.equal(thrown.faceReason, 'thrown');
});
/* ══════════ C ── 接线行为面（真 App + 假插件） ══════════ */
test('C1 保住旧版再比较新版：A→应用→选B→真差异→取消仍是A→再选B并确认才换基线', async () => {
    const sto = mkStorage('c1');
    const ctl = {};
    const app = mkApp(mkPlugin(ctl), sto);
    /* 先应用 A：落笔成功那一刻基线才确立。 */
    const resA = await applyFrom(app, SRC_A, 'a.txt');
    assert.equal(resA.ok, true, '样例资料必须能落笔（否则后面的对账判据是空转）');
    const vA = app.loreVersions();
    assert.equal(vA.applied.has, true);
    assert.equal(vA.applied.bodyInHand, true);
    assert.equal(vA.applied.file, 'a.txt');
    const refAKey = vA.applied.key;
    assert.ok(refAKey.startsWith('lv_'));
    /* 引用落盘，但**正文不许**落盘（本版「不做」条款）。 */
    assert.equal(app._loreLoadAppliedRef().key, refAKey, '重开要答得出「采用哪一版」⇒ 引用必须落存储');
    const rawStored = sto._mem.get('ruby_lore_applied_ref_v1:c1');
    assert.ok(typeof rawStored === 'string' && rawStored.length < 200, '存储里只许有一把引用，实测 ' + String(rawStored && rawStored.length));
    assert.equal(rawStored.indexOf('魔法受规则'), -1, '★ 存储里不得出现正文（计划原文「不做」）');
    /* 选新文件 B：候选换了，但基线**不许**跟着换。 */
    app.loreReadSource(SRC_B, 'b.txt', {});
    const vB = app.loreVersions();
    assert.equal(vB.candidate.file, 'b.txt', '候选面必须如实指向正在读的那一份');
    assert.equal(vB.applied.file, 'a.txt', '★ 已应用面必须还是 a.txt（修前这里被候选顶掉）');
    assert.equal(vB.applied.key, refAKey, '★ 基线引用不许因「选新文件」而变');
    const ch = app.loreCompareSource({});
    assert.equal(ch.oldChecked, true, '★ 选新文件后仍然比得了（修前是「拿候选与自己比」）');
    assert.equal(ch.counts.added, 1, '★ 真实差异必须报出来（修前恒为 0）');
    assert.equal(ch.counts.changed, 1);
    assert.equal(ch.counts.same, 2);
    assert.equal(ch.counts.removed, 0);
    const line = app.loreWizard().changedLine;
    assert.ok(line.indexOf('新增 1') >= 0 && line.indexOf('变更 1') >= 0, '读数必须与真差异一致：' + line);
    assert.ok(line.indexOf('a.txt') >= 0 && line.indexOf('b.txt') >= 0, '读数必须点名两边各是哪一版：' + line);
    /* 取消候选：回到已应用的那一版。 */
    const d = app.loreDiscardCandidate();
    assert.equal(d.ok, true, '取消候选必须能回：' + String(d.note));
    const vBack = app.loreVersions();
    assert.equal(vBack.candidate.file, 'a.txt', '★ 取消候选后候选面必须回到 a.txt');
    assert.equal(vBack.applied.key, refAKey, '取消候选不许动基线');
    assert.equal(app.loreWizard().changedLine.indexOf('还没比过') >= 0, true, '取消后对账读数必须当场作废（旧读数比的是上一版基线）');
    /* 再选 B 并**真的确认**：这一刻基线才换。 */
    const resB = await applyFrom(app, SRC_B, 'b.txt');
    assert.equal(resB.ok, true);
    const vAfter = app.loreVersions();
    assert.notEqual(vAfter.applied.key, refAKey, '★ 确认应用之后基线才换');
    assert.equal(vAfter.applied.file, 'b.txt');
    assert.equal(app._loreLoadAppliedRef().key, vAfter.applied.key, '换基线必须同步落存储');
    assert.equal(app.loreWizard().changedLine.indexOf('还没比过') >= 0, true, '基线刚换过，旧对账读数必须作废');
});
test('C2 窗口读：窗口外的段不许被读成「已删除」', async () => {
    const ctl = {};
    const app = mkApp(mkPlugin(ctl), mkStorage('c1'));
    await applyFrom(app, SRC_A, 'a.txt');
    const w = app.loreReadWindow({ from: 0, to: 20 }, {});
    assert.equal(w.window.hasNext, true, '假件必须真的只给一段窗口（否则这条判据空转）');
    const v = app.loreVersions();
    assert.equal(v.candidate.partial, true, '★ 窗口读必须被标成「部分候选」');
    assert.equal(v.window.has, true);
    assert.equal(v.window.from, 0);
    const ch = app.loreCompareSource({});
    assert.equal(ch.oldChecked, true);
    assert.equal(ch.partialCandidate, true, '窗口标记必须透传到读数');
    assert.equal(ch.removedTrusted, false, '★ 窗口候选的移除清单不可采信');
    const line = app.loreWizard().changedLine;
    assert.ok(line.indexOf('窗口读') >= 0, '读数必须说清这是窗口读：' + line);
    assert.ok(line.indexOf('不得据此判「已删除」') >= 0, '★ 读数必须挡住「窗口外 = 已删除」这个误判：' + line);
    /* 候选形态的**唯一装配点**：没有第二处手写这个判定。
     *   注意锚点要带右值 —— `L.candidatePartial === true`（读）与 `= (isWindow…`（写）
     *   前缀相同，按裸「=」数会把读点一起数进来（本套件首跑实测 6 处，其中 5 处是读）。 */
    assert.equal((appCode.split('L.candidatePartial = (isWindow === true)').length - 1), 1, '★ 候选部分性只许有一个装配点');
    assert.equal((appCode.split('L.candidatePartial === true').length - 1) >= 2, true, '读点必须存在（否则上面那条只是数了个孤零零的写点）');
});
test('C3 重开后只剩引用：比不了，也回不去，但「采用哪一版」答得出', async () => {
    const sto = mkStorage('c1');
    const ctl = {};
    const app1 = mkApp(mkPlugin(ctl), sto);
    await applyFrom(app1, SRC_A, 'a.txt');
    const key1 = app1.loreVersions().applied.key;
    /* 「重开」：新实例 + 同一份存储（正文不在手上，只剩引用）。 */
    const app2 = mkApp(mkPlugin({}), sto);
    app2.loreReadSource(SRC_B, 'b.txt', {});
    const v = app2.loreVersions();
    assert.equal(v.applied.has, true, '重开后仍要知道「当前采用哪一版」');
    assert.equal(v.applied.bodyInHand, false, '★ 正文不许被复制到存储里 ⇒ 重开后是「只剩引用」');
    assert.equal(v.applied.key, key1, '重开后引用必须能复算出同一把键');
    assert.equal(v.applied.file, 'a.txt');
    const ch = app2.loreCompareSource({});
    assert.equal(ch.faceReason, 'baseline-body-absent', '★ 只剩引用时必须单独一态（不是「没有应用过」）');
    assert.equal(ch.oldChecked, false);
    const line = app2.loreWizard().changedLine;
    assert.ok(line.indexOf('只剩引用') >= 0, '读数必须说清是只剩引用：' + line);
    assert.equal(line.indexOf('没有已应用版本'), -1, '★ 上一行刚写「已应用 a.txt（只剩引用）」，这一行不许说没有');
    /* 回不去就如实说，不许假装回得去。 */
    const d = app2.loreDiscardCandidate();
    assert.equal(d.ok, false);
    assert.equal(d.reason, 'baseline-body-absent');
    assert.ok(d.note.indexOf('回不去') >= 0, '读数必须说清回不去：' + String(d.note));
    /* 从没应用过的另一条路必须与上面不同一句。 */
    const app3 = mkApp(mkPlugin({}), mkStorage('c9'));
    app3.loreReadSource(SRC_B, 'b.txt', {});
    const d3 = app3.loreDiscardCandidate();
    assert.equal(d3.ok, false);
    assert.equal(d3.reason, 'no-applied-source', '★「从没应用过」与「只剩引用回不去」处置相反，不许压平');
    assert.notEqual(d3.note, d.note);
    app3.loreCompareSource({});
    assert.equal(app3.loreWizard().changedLine.indexOf('没有已应用版本') >= 0, true, '从没应用过 ⇒ 对账后如实说「没有已应用版本」');
});
test('C4 落笔失败不许动基线（否则读数会假装落过了）', async () => {
    const ctl = {};
    const app = mkApp(mkPlugin(ctl), mkStorage('c1'));
    await applyFrom(app, SRC_A, 'a.txt');
    const key1 = app.loreVersions().applied.key;
    app.loreReadSource(SRC_B, 'b.txt', {});
    app.lorePreview(null, {});
    app.loreMakePlan(null, {});
    ctl.reject = true;
    const res = await app.loreApplyNow({});
    assert.equal(res.ok, false, '假件必须真的拒收（否则这条判据空转）');
    assert.equal(res.reason, 'apply-rejected');
    const v = app.loreVersions();
    assert.equal(v.applied.key, key1, '★ 落笔失败时基线一字不动');
    assert.equal(v.applied.file, 'a.txt');
    assert.equal(app._loreLoadAppliedRef().key, key1, '存储里的引用同样不许动');
    const ch = app.loreCompareSource({});
    assert.equal(ch.oldChecked, true, '基线仍在手上 ⇒ 仍然比得了');
    assert.equal(ch.counts.added, 1, '落笔失败不影响「新旧差在哪」的读数');
    ctl.reject = false;
    const d = app.loreDiscardCandidate();
    assert.equal(d.ok, true, '基线没被动过 ⇒ 取消候选回得去');
    assert.equal(app.loreVersions().candidate.file, 'a.txt');
});
test('C5 引用按会话分键：换会话不带走别人的「已应用」', async () => {
    const sto1 = mkStorage('c1');
    const ctl = {};
    const app1 = mkApp(mkPlugin(ctl), sto1);
    await applyFrom(app1, SRC_A, 'a.txt');
    const key1 = app1.loreVersions().applied.key;
    assert.equal(app1._loreRefKey(), 'ruby_lore_applied_ref_v1:c1');
    assert.ok(sto1._mem.has('ruby_lore_applied_ref_v1:c1'));
    const sto2 = mkStorage('c2');
    const app2 = mkApp(mkPlugin(ctl), sto2);
    app2.loreReadSource(SRC_B, 'b.txt', {});
    assert.equal(app2.loreVersions().applied.has, false, '★ 另一个会话不许继承别人的已应用版本');
    app2.loreCompareSource({});
    assert.equal(app2.loreWizard().changedLine.indexOf('没有已应用版本') >= 0, true, '对账一次之后才谈得上「有没有基线」');
    /* 同一实例换会话：候选现场整块丢掉，已应用的那把引用**按会话重读**。 */
    app1.onChatChanged();
    const v = app1.loreVersions();
    assert.equal(v.candidate.has, false, '换会话必须丢掉候选现场');
    assert.equal(v.applied.key, key1, '还在同一个会话 ⇒ 引用从存储重读，答得出「采用哪一版」');
    /* 真换到另一个会话：内存里那把引用**不许**被当成当前会话的（按会话分键的意义就在这一格）。 */
    sto1.currentConversationId = 'c2';
    assert.equal(app1._loreLoadAppliedRef(), null, '★ 换到另一个会话后按新键读不出别人的「已应用」');
    assert.equal(app1._loreRefKey(), 'ruby_lore_applied_ref_v1:c2');
    sto1.currentConversationId = 'c1';
    assert.equal(app1._loreLoadAppliedRef().key, key1, '换回来仍读得出自己那一份（上一条不是「键坏了」的假绿）');
});
test('C6 视图投影：三份版本与读数行都来自一处，两侧样式同投', async () => {
    const ctl = {};
    const app = mkApp(mkPlugin(ctl), mkStorage('c1'));
    await applyFrom(app, SRC_A, 'a.txt');
    app.loreReadSource(SRC_B, 'b.txt', {});
    app.loreCompareSource({});
    const w = app.loreWizard();
    assert.equal(typeof w.versions, 'object');
    assert.equal(w.versions.applied.file, 'a.txt');
    assert.equal(w.versions.candidate.file, 'b.txt');
    assert.equal(w.versions.window.has, false);
    const L = app._loreState();
    assert.equal(w.changedLine, K.loreChangedLine(L.changed, { applied: L.appliedRef, candidate: L.candidateRef }), '★ 视图读数是契约件那一份，不是自己拼的');
    /* 视图必须真渲染这几格：三行版本与读数行按 `id="…"` 落 HTML，
     *   两个按钮另在事件绑定里按 `#…` 出现（没绑事件的格子自然不会有 `#` 形式）。 */
    for (const id of ['mem-lore-versions', 'mem-lore-changed']) {
        assert.ok(viewCode.indexOf('id="' + id + '"') >= 0, '视图必须真渲染这一格：' + id);
    }
    for (const id of ['#mem-lore-compare', '#mem-lore-discard']) {
        assert.ok(viewCode.indexOf(id) >= 0, '按钮必须既在 HTML 里又在事件绑定里：' + id);
    }
    assert.ok(appCode.indexOf('loreVersions') >= 0 && appCode.indexOf('loreDiscardCandidate') >= 0);
    /* 两侧样式类集合必须相等（本仓治过「只改一边」）。 */
    const clsOf = (src) => new Set((src.match(/\.mem-lore-(?:versions|verline|changed)/g) || []));
    const aSet = clsOf(appCssSrc);
    const bSet = clsOf(bundleCssSrc);
    assert.equal(aSet.size, 3, '三个新样式类都要在 app css 里：' + Array.from(aSet).join(','));
    assert.deepEqual(Array.from(aSet).sort(), Array.from(bSet).sort(), '★ phone.css 与 memory.css 必须同投');
    /* 存储键只许写在一处（写两处 = 两个真源）。 */
    assert.equal((appCode.split('ruby_lore_applied_ref_v1').length - 1), 1, '★ 引用键只许有一个装配点');
});
/* ══════════ D ── 负控制（破坏副本，不动真仓） ══════════ */
/** 定点替换：锚点必须**恰中 1 次**（中 0 次或多次都算破坏本身失效）。 */
function smashOnce(src, anchor, to) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中 1 次（当前 ' + n + ' 次）：' + anchor);
    return src.split(anchor).join(to);
}
function mkTmpTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp4330-'));
    copyTreeSafe(ROOT, dir, { filter: (s) => !s.split(path.sep).includes('.git') && !s.split(path.sep).includes('node_modules') });
    return dir;
}
test('D1 负控制：把 removedTrusted 放宽成「只要比过就采信」⇒ A4 同款判据必转红', async () => {
    /* 原版必真（反向对照）：窗口候选不可采信。 */
    const win = { LonShaMemory: mkPlugin({}).LonShaMemory };
    const pA = parseDoc(SRC_A, 'a.txt');
    const pB = parseDoc(SRC_B, 'b.txt');
    assert.equal(K.readLoreChanged(win, pA, pB, { partialCandidate: true }).removedTrusted, false, '原版必须为 false（否则下面这条负控制是假绿）');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'), 'removedTrusted: oldChecked && !partial,', 'removedTrusted: oldChecked,');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        const rb = KB.readLoreChanged(win, pA, pB, { partialCandidate: true });
        assert.equal(rb.removedTrusted, true, '★ 破坏副本上「窗口候选」的移除清单变成了可采信 —— 同款判据必须抓住它');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D2 负控制：把对账基线换回候选自己 ⇒ C1 的「真差异」判据必转红', async () => {
    const ctl = {};
    const app = mkApp(mkPlugin(ctl), mkStorage('c1'));
    await applyFrom(app, SRC_A, 'a.txt');
    app.loreReadSource(SRC_B, 'b.txt', {});
    assert.equal(app.loreCompareSource({}).counts.added, 1, '原版必须报得出真差异（否则下面这条负控制是假绿）');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, APP_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'), 'const baseline = L.appliedBase;', 'const baseline = L.parsed;');
        fs.writeFileSync(p, broken);
        const APPB = await import(pathToFileURL(p).href);
        const ctl2 = {};
        const app2 = new APPB.MemoryApp(null, mkStorage('c1'));
        globalThis.window = { VirtualPhone: {}, LonShaMemory: mkPlugin(ctl2).LonShaMemory };
        await applyFrom(app2, SRC_A, 'a.txt');
        app2.loreReadSource(SRC_B, 'b.txt', {});
        const ch = app2.loreCompareSource({});
        assert.equal(ch.counts.added, 0, '★ 破坏副本上「拿候选与自己比」⇒ 恒等读数，判据必须抓住它');
        assert.equal(ch.counts.same, 4, '★ 恒等读数的样子：全部同值');
        assert.notEqual(app2.loreWizard().changedLine, '变更:还没比过(选一份新版本再比)');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('D3 负控制：把「只有引用」压回「没有已应用版本」⇒ A2 的同款判据必转红', async () => {
    const refA = K.loreVersionRef('a.txt', parseDoc(SRC_A, 'a.txt'));
    const refOnlyShape = { state: S.BLOCKED, faceReason: 'baseline-body-absent', oldChecked: false, counts: { added: 0, removed: 0, changed: 0, same: 0 }, partialCandidate: false, removedTrusted: false };
    assert.ok(K.loreChangedLine(refOnlyShape, { applied: refA }).indexOf('只剩引用') >= 0, '原版必须分出「只剩引用」这一态');
    const dir = mkTmpTree();
    try {
        const p = path.join(dir, KERNEL_REL);
        const broken = smashOnce(fs.readFileSync(p, 'utf8'), "if (txt(c.faceReason) === 'baseline-body-absent') {", 'if (false) {');
        fs.writeFileSync(p, broken);
        const KB = await import(pathToFileURL(p).href);
        const lb = KB.loreChangedLine(refOnlyShape, { applied: refA });
        assert.equal(lb.indexOf('只剩引用'), -1, '★ 破坏副本上「只剩引用」被压回「没有应用过」—— 判据必须抓住自相矛盾');
        assert.ok(lb.indexOf('没有已应用版本') >= 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本五源同源 + 当版条目齐全', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idx = read('index.js');
    const m = idx.match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'index.js 必须声明版本常量');
    const ver = '4.33.0';
    assert.equal(pkg.version, ver, 'package.json');
    assert.equal(man.version, ver, 'manifest.json');
    assert.equal(log.latest, ver, 'update-log.latest');
    assert.equal(log.head, ver, 'update-log.head');
    assert.equal(m[1], ver, 'index.js 版本常量必须同源');
    const entry = log.versions[ver];
    assert.ok(entry, 'update-log.versions 必须有当版条目');
    assert.ok(Array.isArray(entry.items) && entry.items.length >= 8, '当版条目实测 ' + (entry.items ? entry.items.length : 0) + ' 条，应不少于 8');
    assert.ok(JSON.stringify(entry).indexOf('R5-O6') >= 0, '当版条目必须点名 R5-O6');
});
