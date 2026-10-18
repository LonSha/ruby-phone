/* ============================================================
 * tests/system-v4230.test.mjs -- [v4.23.0 · 第四期 R4-X2 设定资料导入向导]
 *
 * 验收口径（计划原文 R4-X2）：
 *   完整长文含尾章事实、同名角色、混合规则与前史；逐段可改类、可取消；
 *   确认后能查询且重启保留；拒绝项不入库、重复提交不重复导入。
 *   不做：不抓取网络小说、不默认上传整本书、不新增事实数据库。
 *   落点原文：「手机负责文件/选区/预览，最终写入在记忆插件原生确认页完成，
 *   现有跨仓桥仍只读；没有经评审的交接能力时不得私开写桥。」
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游 v3.327.0（M3-X5）起了分层导入面、v3.339.0（M4-X1）把它闭合到真写入，
 *   十二个 loreImport 出口齐全；而本仓实测 grep -RIn loreImport apps config
 *   **零命中** —— 同族「建好不消费」的第十五例。手机侧当时只有「导入为书读」一条路：
 *   那份资料进了书架，于是「世界观规则」与「前史事件」在读数上同形，
 *   而作者真正要的正是「哪几段是约束、哪几段是已经发生过的过去」。
 *
 * 【本版落的四件】（一）纯契约内核 config/lore-import-contract.js：六态面状态、
 *   三派发相、六阶段旅程、五态判定词翻译，**不自己装配**任何证据（实体名单 /
 *   已确认事实 / 来源账一律由上游持有）。（二）控制器二十一具名 import + 全套取数
 *   与旅程编排（含异步读文件，解码复用阅读 App 唯一实现）。
 *   （三）视图「资料导入（设定 / 前史分层）」分区 + 容器级委托三处点选。
 *   （四）本期自己抓到并修掉的**真缺陷**两处：窗口解析被读成「资料被截断」；
 *   四处弱口径取数写法（被 weak-coercion 门实测抓到）。
 *
 * 判据面（五组）：
 *   A 口径：六态互不同形 / 三派发相互不同 / 严格判 true / 纯内核零副作用 / 上游出口名逐字对齐
 *   B 内核行为：六态归一 / 窗口读不是截断（本版缺陷判据）/ 未判≠没有 / 重复≠没写 /
 *             没尝试≠失败 / 五态翻译认不出给空 / 自检十三项
 *   C 接线行为：真 App + 假插件走完整旅程（读→逐段→预览→计划→落笔→账）、
 *             只有预览口、插件不在场、截断源、未预览不落笔、换会话作废现场
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源
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
/* 本套件全程不用反斜杠转义（跨层搬运易被吃掉一次）：换行/回车/反斜杠一律走字符码。 */
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

/** 去注释后的源码：判据只认代码，不认注释里的自述（本仓旧病：注释里的名字被当成代码）。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}
const kernelCode = stripComments(kernelSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);
const S = K.LORE_FACE_STATES;
const O = K.LORE_OUTLETS;
const A = K.LORE_ADMIT;
/* ══════════ 假件 ══════════ */
/** storage 假件：只实现本面用到的 get/set。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k)
    };
}
const CLASS_LABEL = {
    'setting-rule': '设定规则', 'backstory-event': '前史事件',
    'character-bg': '角色背景', 'reference-only': '仅供参考'
};
const KNOWN = [
    { name: '甲', owner: '甲·A宇宙' },
    { name: '甲', owner: '甲·B宇宙' },
    { name: '乙', owner: '乙' }
];
/** 一份真能切出段的资料（三个类目 + 同名角色 + 单主实体，覆盖验收原文那几样）。 */
const SAMPLE = [
    '# 世界观规则', '魔法受规则约束，时间线性。', '',
    '# 前史事件', '十年前北街那场火，是甲先看见的。', '',
    '# 角色背景', '乙出身书香门第。'
].join(NL);
const MAXSRC = 400000;
/** 上游十二口里真正的**取数内核**：形态照 lore-import.js 抄，逐条能对上。 */
function makeLib(st) {
    const c = st.counters;
    /* 真实上游的名单来自 deps(装配好的常量表);deps 未装配 ⇒ 如实报未判。 */
    const deps = st.deps;
    const seen = st.seen;
    const clsOf = (t) => {
        if (/规则|设定/.test(t)) return 'setting-rule';
        if (/前史|事件|过去/.test(t)) return 'backstory-event';
        return 'character-bg';
    };
    const parse = (raw) => {
        const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { text: raw };
        const file = String(input.file || '');
        const full = String(input.text == null ? '' : input.text).split(CR + NL).join(NL);
        const totalChars = full.length;
        const truncated = full.length > MAXSRC;
        const body = truncated ? full.slice(0, MAXSRC) : full;
        const lines = body.split(NL);
        const sections = [];
        let openSec = -1;
        /* 段正文必须取**真正文**:首版把 text 合成成「标题 的正文」,
         *   于是任何正文里出现的人名都命不中(实体面恒报零命中)——
         *   假件自己把待测行为抹掉了,判据看着绿而其实没判。 */
        for (const ln of lines) {
            if (ln.slice(0, 2) === '# ') {
                const title = ln.slice(2).trim();
                sections.push({ index: sections.length + 1, title: title, cls: clsOf(title), buf: [ln],
                    sourceRef: { file: file, section: sections.length + 1, title: title } });
                openSec = sections.length - 1;
                continue;
            }
            if (openSec >= 0) sections[openSec].buf.push(ln);
        }
        const items = [];
        for (const sec of sections) {
            sec.text = sec.buf.join(NL).trim();
            delete sec.buf;
            items.push({
                key: 'L' + sec.index + '#' + sec.cls + '#000' + sec.index, cls: sec.cls, clsLabel: CLASS_LABEL[sec.cls],
                title: sec.title, text: sec.text.slice(0, 80), textHash: '000' + sec.index,
                origin: 'imported', settingAsHappened: false, sensitive: false
            });
        }
        const why = [];
        if (!body.trim()) why.push('empty-source');
        if (!items.length && body.trim()) why.push('no-sections');
        if (truncated) why.push('source-truncated');
        const classes = {};
        for (const it of items) classes[it.cls] = (classes[it.cls] || 0) + 1;
        return {
            ok: items.length > 0 && !truncated,
            source: { file: file, chars: body.length, lines: lines.length, truncated: truncated },
            completeness: {
                state: truncated ? 'partial' : 'complete', totalChars: totalChars,
                readChars: body.length, truncated: truncated, nextCursor: truncated ? MAXSRC : null
            },
            sections: sections, items: items, classes: classes, why: why
        };
    };
    const parseWindow = (raw, opts) => {
        const o = opts || {};
        const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { text: raw };
        const file = String(input.file || '');
        const full = String(input.text == null ? '' : input.text).split(CR + NL).join(NL);
        const totalChars = full.length;
        const fromRaw = (o.range && o.range.from !== undefined && o.range.from !== null) ? o.range.from : 0;
        const from = Math.max(0, Number.isFinite(Number(fromRaw)) ? Number(fromRaw) : 0);
        const toRaw = (o.range && o.range.to !== undefined && o.range.to !== null) ? o.range.to : totalChars;
        const to = Math.min(totalChars, Math.max(from, Number.isFinite(Number(toRaw)) ? Number(toRaw) : totalChars));
        let start = from;
        if (start > 0 && full.charAt(start - 1) !== NL) start = full.lastIndexOf(NL, start - 1) + 1;
        let end = to;
        if (end < totalChars && full.charAt(end - 1) !== NL) {
            const fwd = full.indexOf(NL + NL, Math.max(0, end - 1));
            end = fwd < 0 ? totalChars : fwd + 1;
        }
        const aligned = full.slice(start, end);
        const res = parse({ text: aligned, file: file });
        const hasNext = end < totalChars;
        res.completeness = {
            state: hasNext ? 'partial' : 'complete', totalChars: totalChars,
            readChars: end, windowFrom: start, windowTo: end,
            truncated: false, nextCursor: hasNext ? end : null
        };
        res.window = { from: start, to: end, chars: aligned.length, hasNext: hasNext };
        return res;
    };
    const entities = (parsed, opts) => {
        const o = opts || {};
        const out = { checked: false, exact: 0, needsConfirm: 0, unresolved: 0, entries: [], why: [] };
        const known = (o.knownEntities !== undefined) ? o.knownEntities : deps;
        if (known === undefined || known === null) { out.why.push('known-entities-absent'); return out; }
        out.checked = true;
        const index = new Map();
        for (const rawE of (Array.isArray(known) ? known : [])) {
            const e = (rawE && typeof rawE === 'object') ? rawE : { name: rawE };
            const nm = String(e.name == null ? '' : e.name).trim();
            if (!nm) continue;
            if (!index.has(nm)) index.set(nm, []);
            const owner = String(e.owner == null ? e.name : e.owner).trim();
            if (index.get(nm).indexOf(owner) < 0) index.get(nm).push(owner);
        }
        for (const it of ((parsed && parsed.items) || [])) {
            const hay = String(it.title || '') + ' ' + String(it.text || '');
            const hits = [];
            for (const pair of index) if (pair[0] && hay.indexOf(pair[0]) >= 0) hits.push({ name: pair[0], owners: pair[1].slice() });
            if (!hits.length) { out.unresolved += 1; continue; }
            const multi = hits.filter((h) => h.owners.length > 1);
            if (multi.length) {
                out.needsConfirm += 1;
                out.entries.push({ itemKey: String(it.key || ''), verdict: 'needs-confirm', hits: multi, why: '同名多主(不同宇宙 / 同名异人)不得合并' });
            } else {
                out.exact += 1;
                out.entries.push({ itemKey: String(it.key || ''), verdict: 'exact', hits: hits, why: '' });
            }
        }
        return out;
    };
    const preview = (parsed, target, opts) => {
        const o = opts || {};
        const out = {
            verdict: 'ok', entries: [], add: 0, same: 0, conflict: 0, mapping: 0, dangling: 0,
            skipped: 0, total: 0, confirmedChecked: false, knownRefsChecked: false, why: []
        };
        if (!parsed || !Array.isArray(parsed.items)) return Object.assign(out, { verdict: 'blocked', why: ['no-parsed-source'] });
        const tgt = (target && typeof target === 'object') ? target : null;
        const facts = [];
        if (tgt && Array.isArray(tgt.facts)) { out.confirmedChecked = true; for (const f of tgt.facts) facts.push(f); }
        const knownRefs = Array.isArray(o.knownRefs) ? o.knownRefs.map(String) : null;
        out.knownRefsChecked = !!knownRefs;
        const mappingNeeds = Array.isArray(o.mappingNeedsConfirm) ? o.mappingNeedsConfirm.map(String) : [];
        for (const it of parsed.items) {
            const key = String(it.key || '');
            const rec = { key: key, cls: String(it.cls || ''), title: String(it.title || ''), action: 'add', why: 'target-absent', sensitive: it.sensitive === true };
            if (mappingNeeds.indexOf(key) >= 0) { rec.action = 'skip'; rec.why = 'mapping-needs-confirm'; out.mapping += 1; out.skipped += 1; }
            else if (facts.some((f) => String(f.key || '') === key)) {
                if (facts.some((f) => String(f.key || '') === key && String(f.value || '') === String(it.text || ''))) {
                    rec.action = 'skip'; rec.why = 'already-same'; out.same += 1; out.skipped += 1;
                } else {
                    rec.action = 'skip'; rec.why = 'undecided'; out.conflict += 1; out.skipped += 1;
                }
            } else out.add += 1;
            if (knownRefs && knownRefs.indexOf(key) < 0) { rec.why = 'dangling-source'; out.dangling += 1; }
            out.entries.push(rec);
        }
        out.total = out.entries.length;
        if (!out.confirmedChecked) out.why.push('confirmed-face-absent');
        if (!out.knownRefsChecked) out.why.push('known-refs-absent');
        out.verdict = (out.conflict || out.dangling || out.mapping || out.why.length) ? 'warn' : 'ok';
        return out;
    };
    const plan = (parsed, pv, opts) => {
        const o = opts || {};
        const out = { ok: false, importId: '', duplicate: false, applied: [], count: 0, total: 0, skipped: [], reason: '', writesNothing: true, nextCursor: null };
        if (!parsed) return Object.assign(out, { reason: 'no-parsed-source' });
        if (!pv) return Object.assign(out, { reason: 'no-preview' });
        const secs = Array.isArray(parsed.sections) ? parsed.sections : [];
        const importId = 'li_' + String((parsed.source && parsed.source.file) || '') + '#' + secs.length + '#' + secs.map((s) => String(s.index)).join('');
        out.importId = importId;
        if (Array.isArray(o.seen) && o.seen.map(String).indexOf(importId) >= 0) {
            return Object.assign(out, { ok: true, duplicate: true, reason: 'duplicate-import', count: 0 });
        }
        const entries = Array.isArray(pv.entries) ? pv.entries : [];
        out.total = entries.length;
        const selected = Array.isArray(o.selected) ? o.selected.map(String) : null;
        for (const e of entries) {
            const ek = String(e.key || '');
            if (selected && selected.indexOf(ek) < 0) { out.skipped.push({ key: ek, why: 'not-selected' }); continue; }
            if (e.action === 'skip') { out.skipped.push({ key: ek, why: String(e.why || '') }); continue; }
            out.applied.push({ key: ek, cls: String(e.cls || ''), action: String(e.action || ''), sensitive: e.sensitive === true });
        }
        out.count = out.applied.length;
        out.ok = true;
        out.reason = out.count ? 'ok' : 'nothing-to-apply';
        return out;
    };
    const override = (parsed, ovs) => {
        const out = { ok: false, items: [], applied: 0, rejected: [], counts: {}, why: [] };
        const p = (parsed && typeof parsed === 'object') ? parsed : null;
        if (!p || !Array.isArray(p.items)) return out;
        const list = Array.isArray(ovs) ? ovs : [];
        const byKey = new Map();
        for (const it of p.items) byKey.set(String(it.key || ''), it);
        for (const e of list) {
            const k = String((e && e.key) || '').trim();
            const want = String((e && e.cls) || '').trim();
            const it = byKey.get(k);
            if (!it) { out.rejected.push({ key: k, why: 'no-such-item', got: want }); continue; }
            if (!CLASS_LABEL[want]) { out.rejected.push({ key: k, why: 'unknown-class', got: want }); continue; }
            byKey.set(k, Object.assign({}, it, {
                clsRule: String(it.clsRule || it.cls), cls: want, clsLabel: CLASS_LABEL[want], manual: true
            }));
            out.applied += 1;
        }
        out.items = p.items.map((it) => byKey.get(String(it.key || '')) || it);
        out.ok = out.rejected.length === 0;
        for (const it of out.items) out.counts[it.cls] = (out.counts[it.cls] || 0) + 1;
        return out;
    };
    const confirmMapping = (parsed, mapping, opts) => {
        const o = opts || {};
        const cand = entities(parsed, o);
        const pick = (mapping && typeof mapping === 'object') ? mapping : {};
        const needsConfirm = [], resolved = [];
        for (const e of cand.entries) {
            if (e.verdict !== 'needs-confirm') continue;
            const chosen = String(pick[e.itemKey] == null ? '' : pick[e.itemKey]).trim();
            if (chosen) resolved.push({ itemKey: e.itemKey, owner: chosen, hits: e.hits });
            else needsConfirm.push({ itemKey: e.itemKey, hits: e.hits, why: e.why });
        }
        return {
            checked: cand.checked === true, needsConfirm: needsConfirm, resolved: resolved,
            unresolved: cand.unresolved, mappingNeedsConfirm: needsConfirm.map((x) => x.itemKey), why: []
        };
    };
    const apply = async (parsed, pv, opts) => {
        const o = opts || {};
        const blank = (why) => ({
            ok: false, reason: why, importId: '', duplicate: false, selected: 0, applied: 0,
            verified: 0, persisted: null, readback: null, items: [], rejected: [],
            writes: 0, zeroWrite: true, stale: false, undo: null
        });
        if (!parsed) return blank('no-parsed-source');
        if (!pv) return blank('no-preview');
        const pl = plan(parsed, pv, Object.assign({}, o, { seen: seen }));
        if (pl.duplicate) {
            const b = blank('duplicate-import');
            b.ok = true; b.duplicate = true; b.importId = pl.importId; b.reason = 'duplicate-import';
            return b;
        }
        if (!pl.ok) { const b = blank(pl.reason || 'plan-failed'); b.importId = pl.importId; return b; }
        const byKey = new Map();
        for (const it of parsed.items) byKey.set(String(it.key || ''), it);
        const items = [];
        const rejected = [];
        for (const a of pl.applied) {
            const it = byKey.get(a.key);
            if (it && it.sensitive === true) { rejected.push({ key: a.key, why: 'sensitive-body' }); continue; }
            items.push({ key: a.key, cls: a.cls, action: a.action });
        }
        if (!items.length) { const b = blank('nothing-selected'); b.importId = pl.importId; b.rejected = rejected; return b; }
        seen.push(pl.importId);
        return {
            ok: true, reason: 'ok', importId: pl.importId, duplicate: false,
            selected: items.length, applied: items.length, verified: items.length,
            persisted: true, readback: true, items: items, rejected: rejected,
            writes: items.length, zeroWrite: false, stale: false,
            undo: { separate: true, token: 'tk1', note: '撤前情不动事实' }
        };
    };
    const changed = (oldP, newP) => {
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
    };
    return {
        parse: (raw, opts) => { c.parse += 1; return parse(raw, opts); },
        parseWindow: (raw, opts) => { c.window += 1; return parseWindow(raw, opts); },
        entities: (parsed, opts) => { c.entities += 1; return entities(parsed, opts); },
        preview: (parsed, target, opts) => { c.preview += 1; return preview(parsed, target, opts); },
        plan: (parsed, pv, opts) => { c.plan += 1; return plan(parsed, pv, opts); },
        override: (parsed, ovs, opts) => { c.override += 1; return override(parsed, ovs, opts); },
        confirmMapping: (parsed, mapping, opts) => { c.confirm += 1; return confirmMapping(parsed, mapping, opts); },
        changed: (a, b) => { c.changed += 1; return changed(a, b); },
        apply: async (parsed, pv, opts) => { c.apply += 1; return apply(parsed, pv, opts); }
    };
}
/**
 * 上游插件假身。**三态各造一个**（十二口齐全 / 只有预览口 / 不在场）——
 *   压平任意两态都会造出处置相反的处境长得一样（能落 vs 只能看 vs 等装插件）。
 */
function mkPlugin(kind, over) {
    const st = {
        counters: { parse: 0, window: 0, entities: 0, preview: 0, plan: 0, override: 0, confirm: 0, changed: 0, apply: 0, ledger: 0 },
        seen: [], deps: (kind === 'no-deps') ? undefined : KNOWN
    };
    const lib = makeLib(st);
    const p = {};
    if (kind !== 'no-plugin') {
        p.loreImportDescribe = () => ({
            present: 11, total: 11, missing: [],
            classes: ['setting-rule', 'backstory-event', 'character-bg', 'reference-only'],
            classLabels: ['设定规则', '前史事件', '角色背景', '仅供参考'],
            classesExhaustive: true, settingVsHappenedSplit: true, maskFixedLength: true,
            secretBodyKeys: [], maxSourceChars: MAXSRC, offline: true, writesNothing: true
        });
        p.loreImportParse = (raw, opts) => lib.parse(raw, opts);
        p.loreImportParseWindow = (raw, opts) => lib.parseWindow(raw, opts);
        p.loreImportEntities = (parsed, opts) => lib.entities(parsed, opts);
        p.loreImportPreview = (parsed, target, opts) => lib.preview(parsed, target, opts);
        p.loreImportPlan = (parsed, pv, opts) => lib.plan(parsed, pv, opts);
        p.loreImportOverride = (parsed, ovs, opts) => lib.override(parsed, ovs, opts);
        p.loreImportConfirmMapping = (parsed, mapping, opts) => lib.confirmMapping(parsed, mapping, opts);
        p.loreImportChanged = (a, b) => lib.changed(a, b);
        p.loreImportApply = async (parsed, pv, opts) => { st.counters.apply += 1; return lib.apply(parsed, pv, opts); };
        p.loreImportLedger = () => {
            st.counters.ledger += 1;
            const last = st.seen.length ? st.seen[st.seen.length - 1] : null;
            return {
                version: 1, seen: st.seen.length, chars: st.seen.length ? 88 : 0,
                decisions: 0, mappings: 0,
                lastApply: last ? { importId: last, applied: 2, verified: 2, readback: true } : null
            };
        };
    }
    if (kind === 'preview-only') delete p.loreImportApply;
    p.__c = st.counters;
    p.__st = st;
    return { LonShaMemory: p };
}
/** 造一个 App 实例并把 window 换成给定形态（假插件挂在 window.LonShaMemory 上）。 */
function mkApp(plugin, kind) {
    globalThis.window = Object.assign({ VirtualPhone: {} },
        (kind === 'no-plugin' || !plugin) ? {} : { LonShaMemory: plugin.LonShaMemory });
    return new APP.MemoryApp(null, mkStorage());
}
function clearWin() { delete globalThis.window; }
/* ══════════ A ── 口径面 ══════════ */
test('A1 导入面六态互不同形，三派发相互不同形，上游出口名逐字对齐', () => {
    const states = Object.values(S);
    assert.equal(states.length, 6, '六态：' + states.join(' / '));
    assert.equal(new Set(states).size, 6, '★ 六态值必须唯一（压平即造出处置相反的处境长得一样）');
    assert.notEqual(S.ENGINE_ABSENT, S.FACE_ABSENT, '「插件不在场」与「本版没有导入面」处置相反：等装 vs 等升级');
    assert.notEqual(S.UNUSABLE, S.BLOCKED, '★「本机读不出」与「读得出但不能落」必须不同形');
    assert.notEqual(S.EMPTY, S.BLOCKED, '★「确实没有可用段」与「空源 / 截断」必须不同形');
    const outs = Object.values(O);
    assert.equal(outs.length, 3);
    assert.equal(new Set(outs).size, 3);
    assert.equal(O.FULL, 'parse+apply');
    assert.equal(O.PREVIEW_ONLY, 'preview-only');
    for (const nm of ['loreImportDescribe', 'loreImportParse', 'loreImportParseWindow',
        'loreImportEntities', 'loreImportPreview', 'loreImportPlan', 'loreImportOverride',
        'loreImportConfirmMapping', 'loreImportChanged', 'loreImportApply', 'loreImportLedger']) {
        assert.ok(kernelCode.indexOf("'" + nm + "'") >= 0, '内核必须调上游那一个名字：' + nm);
    }
    assert.equal(K.LORE_LIMITS.rows, 80, '逐段表渲染上限（再多只是把浏览器拖慢）');
    assert.equal(K.LORE_LIMITS.candidates, 6, '单个条目的同名候选上限');
    assert.deepEqual(K.LORE_STAGES, ['parse', 'entities', 'preview', 'plan', 'apply', 'ledger']);
});
test('A2 派发相严格判 true（宽松判会把 1 / yes 读成「有落笔口」）', () => {
    assert.equal(K.planLoreOutlet(true, true), O.FULL);
    assert.equal(K.planLoreOutlet(true, false), O.PREVIEW_ONLY, '只有预览口 ⇒ 只能看不能落（必须当面说清）');
    assert.equal(K.planLoreOutlet(false, true), O.NONE, '没有解析面时落笔口无从谈起');
    for (const bad of [undefined, null, 0, 1, 'yes', {}, []]) {
        assert.equal(K.planLoreOutlet(bad, true), O.NONE, '★ 非 true 一律当「没有」：' + JSON.stringify(bad));
        assert.equal(K.planLoreOutlet(true, bad), O.PREVIEW_ONLY, '落笔口同样严格判：' + JSON.stringify(bad));
    }
    assert.ok(kernelCode.indexOf('hasParse !== true') >= 0, '严格判必须写在代码里（不是注释里）');
    assert.ok(kernelCode.indexOf('hasApply === true') >= 0);
});
test('A3 纯内核：零 DOM / 零存储 / 零联网 / 零时钟（判据扫去注释后的代码）', () => {
    for (const bad of ['document.', 'window.', 'localStorage', 'sessionStorage', 'indexedDB',
        'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'new Date(', 'dispatchEvent']) {
        assert.equal(kernelCode.indexOf(bad), -1, '★ 纯契约件不得出现 ' + bad);
    }
    assert.ok(kernelCode.indexOf('readLoreEntities(win, parsed, opts)') >= 0, '实体名单必须从 opts 来');
    assert.ok(kernelCode.indexOf('readLorePreview(win, parsed, target, opts)') >= 0, '已确认事实必须由调用方给');
    assert.equal(kernelCode.indexOf('KNOWN_ENTITIES'), -1, '内核不得内置一份已登记实体名单');
});
test('A4 手机不直呼上游出口名：取数只在契约件一处，视图不摸 window、不自己解码', () => {
    /* 出口名只许在**契约件**出现:App 直呼出口名等于把名字写两处（上游改名时
     *   那一份会静默落空）。判据看**标识符取用形态**,不看注释里的说明文字——
     *   按裸串扫会把注释里提一嘴上游名字判成违规(本仓治过多轮的假红形态)。 */
    const codeOnly = (src) => src.split(NL).filter((l) => l.indexOf('/*') < 0 && l.indexOf('* ') < 0 && l.indexOf('//') < 0).join(NL);
    const appCodeStrict = codeOnly(appCode);
    for (const bad of ['plugin.loreImport', 'win.loreImport', '.loreImportParse', '.loreImportApply']) {
        assert.equal(appCodeStrict.indexOf(bad), -1, '控制器不直呼上游出口（一律经契约件）：' + bad);
    }
    assert.equal(viewCode.indexOf('.loreImport'), -1, '视图不得取用上游出口');
    /* 视图**本来就**用 window（toastr / dispatchEvent 是既有惯例），故这里钉的是“不得摸上游句柄”，不是“不许出现 window.”。 */
    assert.equal(viewCode.indexOf('LonShaMemory'), -1, '★ 视图不得摸上游句柄（取数全在控制器）');
    assert.equal(viewCode.indexOf('decodeTxtArrayBuffer'), -1, '★ 解码只有一份实现（阅读 App），视图不掺一脚');
    assert.ok(appCode.indexOf('decodeTxtArrayBuffer') >= 0, '控制器复用阅读 App 的多编码解码唯一实现');
    assert.equal(kernelCode.indexOf("'gb18030'"), -1, '内核不得内置编码候选表');
    assert.equal(appCode.indexOf("'gb18030'"), -1, '控制器也不得内置编码候选表');
});
/* ══════════ B ── 内核行为面 ══════════ */
test('B1 六态归一：插件不在场 / 没有这一面 / 回执畸形 / 截断 / 空源 / 无可用段', () => {
    const p = mkPlugin('full').LonShaMemory;
    assert.equal(K.readLoreParse(null, { text: 'x' }, {}).state, S.ENGINE_ABSENT);
    assert.equal(K.readLoreDescribe(null).state, S.ENGINE_ABSENT);
    const noFace = { LonShaMemory: {} };
    assert.equal(K.readLoreParse(noFace, { text: 'x' }, {}).state, S.FACE_ABSENT);
    assert.equal(K.readLoreDescribe(noFace).state, S.FACE_ABSENT);
    const bad = { LonShaMemory: Object.assign({}, p, { loreImportParse: () => null }) };
    assert.equal(K.readLoreParse(bad, { text: 'x' }, {}).state, S.UNUSABLE);
    const thrown = { LonShaMemory: Object.assign({}, p, { loreImportParse: () => { throw new Error('boom'); } }) };
    assert.equal(K.readLoreParse(thrown, { text: 'x' }, {}).state, S.UNUSABLE, '抛错如实报读不出，不外抛');
    const long = '# 标题' + NL + '字'.repeat(MAXSRC + 9000);
    const t = K.readLoreParse({ LonShaMemory: p }, { text: long, file: 'big.txt' }, {});
    assert.equal(t.state, S.BLOCKED);
    assert.equal(t.faceReason, 'source-truncated');
    const e = K.readLoreParse({ LonShaMemory: p }, { text: '   ' + NL + '  ', file: 'empty.txt' }, {});
    assert.equal(e.state, S.BLOCKED);
    assert.equal(e.faceReason, 'empty-source');
    const n = K.readLoreParse({ LonShaMemory: p }, { text: '只有正文没有标题', file: 'nosect.txt' }, {});
    assert.equal(n.state, S.EMPTY);
    assert.equal(n.faceReason, 'no-sections');
    const ok = K.readLoreParse({ LonShaMemory: p }, { text: SAMPLE, file: 'ok.txt' }, {});
    assert.equal(ok.state, S.OK);
    assert.equal(ok.items.length, 3);
});
test('B2 ★★★ 窗口读不得被读成截断（本版自己抓到的真缺陷的判据落点）', () => {
    const p = mkPlugin('full').LonShaMemory;
    /* 三个约束同时成立才测得到本版缺陷:
     *   ① 整篇超上限(否则整篇读不被拒);
     *   ② 窗口内**有段边界**(\n\n)—— 上游终点会对齐到段边界,没有边界就一路吃到尾、hasNext 变 false;
     *   ③ 每个窗口自身的切片**不超上限**(上游会给窗口内的切片再跑一次整篇解析,超了照样判截断)。
     *   首版数据只满足 ①,于是「还有下一段」在数据里根本不存在,判据转红是假的。 */
    const long = '# 段甲' + NL + '甲'.repeat(20000) + NL + NL + '# 段乙' + NL + '乙'.repeat(30000) + NL + NL
        + '# 段丙' + NL + '丙'.repeat(360000) + NL;
    const w = K.readLoreParseWindow({ LonShaMemory: p }, { text: long, file: 'big.txt' }, { range: { from: 0, to: 40000 } });
    assert.equal(w.state, S.OK,
        '★★★ 窗口读「还有下一段」是**正常读数**，不是失败：上游两种回执都带 completeness.partial，'
        + '但只有 source.truncated 才是真截断。压平的后果是——用户按提示点「选范围逐段读」时，'
        + '那一窗其实已经读进来了，而读数把他赶去重复一个刚做过的动作（不报错，只把成功说成失败）');
    assert.notEqual(w.faceReason, 'source-truncated');
    assert.equal(w.window.hasNext, true);
    assert.ok(K.loreStageLine('parse', w).indexOf('还有下一段') >= 0);
    const t = K.readLoreParse({ LonShaMemory: p }, { text: '# 标题' + NL + '字'.repeat(MAXSRC + 9000), file: 'big.txt' }, {});
    assert.equal(t.faceReason, 'source-truncated');
    assert.notEqual(K.loreStageLine('parse', w), K.loreStageLine('parse', t), '两者必须不同句');
    assert.equal(w.window.from, 0);
    assert.ok(w.window.to > 0);
    assert.equal(w.completeness.totalChars, long.length, '分母是全文件长，不是本窗口长');
    const last = K.readLoreParseWindow({ LonShaMemory: p }, { text: long, file: 'big.txt' }, { range: { from: 40000, to: long.length } });
    assert.equal(last.window.hasNext, false);
    assert.ok(K.loreStageLine('parse', last).indexOf('全文读完') >= 0);
});
test('B3 未判 ≠ 没有：实体面与冲突面各有自己的「未判」标志', () => {
    const p = mkPlugin('full').LonShaMemory;
    const parsed = K.readLoreParse({ LonShaMemory: p }, { text: SAMPLE, file: 'x.txt' }, {});
    /* 「未判」的成因是**依赖没装配**(deps 不在),不是「插件没这一面」—— 两者处置相反。 */
    const bare = mkPlugin('no-deps').LonShaMemory;
    const noList = K.readLoreEntities({ LonShaMemory: bare }, parsed, {});
    assert.equal(noList.checked, false, '★ 没给已登记名单 ⇒ 未判，不是「没有同名」');
    assert.equal(noList.state, S.EMPTY);
    const l1 = K.loreStageLine('entities', noList);
    assert.ok(l1.indexOf('未判') >= 0, l1);
    assert.ok(l1.indexOf('不是「没有同名」') >= 0, l1);
    const withList = K.readLoreEntities({ LonShaMemory: p }, parsed, { knownEntities: KNOWN });
    assert.equal(withList.checked, true);
    assert.equal(withList.needsConfirm, 1, '同名多主 ⇒ 待认（不得合并）');
    assert.notEqual(K.loreStageLine('entities', withList), l1, '「未判」与「查了」必须不同句');
    const pv = K.readLorePreview({ LonShaMemory: p }, parsed, null, {});
    assert.equal(pv.confirmedChecked, false);
    assert.equal(pv.knownRefsChecked, false);
    const s1 = K.loreStageLine('preview', pv);
    assert.ok(s1.indexOf('已确认面未判') >= 0, s1);
    assert.ok(s1.indexOf('来源账未判') >= 0, s1);
    const pv2 = K.readLorePreview({ LonShaMemory: p }, parsed,
        { facts: [{ key: parsed.items[0].key, value: parsed.items[0].text }] }, { knownRefs: ['x'] });
    assert.notEqual(K.loreStageLine('preview', pv2), s1, '「未判」与「查了」必须不同句');
    assert.equal(pv2.same, 1, '账里有一模一样的一条 ⇒ 同值');
});
test('B4 重复导入 ≠ 这次没写；没尝试 ≠ 试了失败', () => {
    const dup = K.loreStageLine('plan', { state: S.OK, ok: true, duplicate: true, count: 0, total: 4, importId: 'li_x', reason: 'duplicate-import' });
    const nothing = K.loreStageLine('plan', { state: S.OK, ok: true, duplicate: false, count: 0, total: 4, importId: 'li_y', reason: 'nothing-to-apply' });
    assert.notEqual(dup, nothing);
    assert.ok(dup.indexOf('不会重复导入') >= 0, dup);
    assert.ok(nothing.indexOf('没有可落') >= 0, nothing);
    const a1 = K.loreStageLine('apply', { state: S.OK, ok: true, duplicate: true, applied: 0, verified: 0, persisted: false, readback: false, reason: 'duplicate-import' });
    assert.ok(a1.indexOf('一个字都没写') >= 0, a1);
    const nullTry = K.loreStageLine('apply', { state: S.OK, ok: true, duplicate: false, applied: 2, verified: 2, persisted: null, readback: null });
    const failed = K.loreStageLine('apply', { state: S.OK, ok: true, duplicate: false, applied: 2, verified: 2, persisted: false, readback: false });
    assert.notEqual(nullTry, failed, '★「没尝试落盘」与「落盘失败」必须不同句');
    assert.ok(nullTry.indexOf('未尝试') >= 0, nullTry);
    assert.ok(failed.indexOf('落盘 否') >= 0, failed);
    const planLine = K.loreStageLine('plan', { state: S.OK, ok: true, duplicate: false, count: 3, total: 3, importId: 'li_z', reason: 'ok' });
    assert.ok(planLine.indexOf('只算不写') >= 0, planLine);
});
test('B5 五态翻译：认得出的逐字对上，认不出的一律给空且说未判', () => {
    assert.equal(K.admitOf('add', 'target-absent'), A.ADD);
    assert.equal(K.admitOf('skip', 'already-same'), A.SAME);
    assert.equal(K.admitOf('skip', 'undecided'), A.CONFLICT);
    assert.equal(K.admitOf('skip', 'confirmed-by-player'), A.CONFLICT);
    assert.equal(K.admitOf('skip', 'mapping-needs-confirm'), A.MAPPING);
    assert.equal(K.admitOf('dangling', 'dangling-source'), A.DANGLING);
    assert.equal(K.admitOf('', ''), '', '★ 认不出的组合必须如实给空（不许猜一态）');
    assert.equal(K.admitOf('zz', 'zz'), '');
    const five = [A.ADD, A.SAME, A.CONFLICT, A.MAPPING, A.DANGLING].map(K.admitLineOf);
    assert.equal(new Set(five).size, 5, '五态各句：' + five.join('|'));
    for (const l of five) assert.ok(l, '判定行不许为空');
    assert.ok(K.admitLineOf('whatever').indexOf('未判') >= 0, '认不出的判定必须说未判');
    assert.equal(five.indexOf(K.admitLineOf('whatever')), -1, '认不出的判定不许冒充任何一态');
});
test('B6 类目行是翻译不是重算：保序、求和等于上游段数、标签优先取上游给的', () => {
    const p = mkPlugin('full').LonShaMemory;
    const parsed = K.readLoreParse({ LonShaMemory: p }, { text: SAMPLE, file: 'x.txt' }, {});
    assert.equal(parsed.classTotal, 3);
    const sum = parsed.classRows.reduce((a, x) => a + Number(x.count || 0), 0);
    assert.equal(sum, 3, '★ 类目计数之和必须等于上游给的段数（本件不另算一份）');
    const merged = parsed.classRows.map((r) => r.label).join('|');
    assert.ok(merged.indexOf('设定规则') >= 0 && merged.indexOf('前史事件') >= 0, merged);
    assert.equal(parsed.classRows[0].cls, 'setting-rule', '保持上游给的顺序（不重排）');
    const many = Array.from({ length: 100 }, (_, i) => '# 段' + i + NL + '正文' + i).join(NL + NL);
    const big = K.readLoreParse({ LonShaMemory: p }, { text: many, file: 'many.txt' }, {});
    assert.equal(big.items.length, 100);
    assert.ok(big.items.length > K.LORE_LIMITS.rows, '上游给 100 段而渲染上限 80 ⇒ 截断要如实报');
});
test('B7 自检十四项零问题，且各态计数与词表同源', () => {
    const r = K.loreSelfCheck();
    assert.deepEqual(r.problems, [], '★ 内核自检必须零问题');
    assert.equal(r.states, 6);
    assert.equal(r.outlets, 3);
    assert.equal(r.stages, 6);
    assert.equal(Object.keys(K.LORE_FACE_STATES).length, 6);
    assert.ok(kernelSrc.indexOf('判据自证(十四项)') >= 0, '自检项数与实现同源（加了口径必须加自证）');
    assert.equal(K.loreStageLine('parse', null), 'parse:读不到');
    assert.deepEqual(K.pickableClassesOf(null), [], '没有自述时选项表应为空（不编一份类目表）');
    assert.deepEqual(K.pickableClassesOf({ classes: ['a'], classLabels: [] }).map((x) => x.label), ['a'],
        '上游没给标签时如实显示原始类名，不自己编一个中文');
    assert.deepEqual(K.loreJourneyLines({}), [], '缺哪一段就少一行，不补空行');
});
/* ══════════ C ── 接线面（真 App + 假插件） ══════════ */
test('C1 真 App：读→逐段→预览→计划→落笔→账走完整旅程，读数逐项说清', async () => {
    const plugin = mkPlugin('full');
    const app = mkApp(plugin, 'full');
    try {
        assert.equal(app.planLoreImportOutlet(), O.FULL);
        assert.ok(app.loreLine().indexOf('在位') >= 0, '面读数：' + app.loreLine());
        assert.deepEqual(app.loreClasses().map((c) => c.cls),
            ['setting-rule', 'backstory-event', 'character-bg', 'reference-only'], '选项表来自上游自述');
        const parsed = app.loreReadSource(SAMPLE, '设定集.txt', {});
        assert.equal(parsed.state, S.OK);
        assert.equal(parsed.items.length, 3);
        assert.deepEqual(app.loreImportSelfCheck().problems, []);
        const pv = app.lorePreview(null, {});
        assert.equal(pv.confirmedChecked, false);
        const w1 = app.loreWizard();
        assert.ok(w1.stages.some((l) => l.indexOf('已确认面未判') >= 0), JSON.stringify(w1.stages));
        assert.equal(w1.rows.length, 3);
        assert.ok(w1.rows.every((r) => r.verdict === 'add' && r.verdictLine.indexOf('可入') >= 0),
            '逐段行判定来自内核译文：' + JSON.stringify(w1.rows.map((r) => r.verdict)));
        assert.equal(w1.pickedCount, 3, '没点过时默认只选「可入」的段');
        /* 取消要**在预览还有效时**做:改类会作废预览(分类变了,diff 得重算),
         *   而那之后选中集回到「还没预览」——判据放在那种时点上测的不是同一件事。 */
        app.loreTogglePick('L1#setting-rule#0001', false);
        assert.equal(app.loreSelectedKeys().length, 2,
            '★ 取消一个只该退掉那一个:首点前的默认选择要先播种,否则界面上所有勾一起空掉');
        assert.ok(app.loreSelectedKeys().indexOf('L1#setting-rule#0001') < 0);
        app.loreTogglePick('L1#setting-rule#0001', true);
        assert.equal(app.loreSelectedKeys().length, 3, '再点回来 ⇒ 三个');
        /* 视图那一屏在用户点选前就会读一次选中集(逐段行要画勾选态)——
         *   这一步是真接口的首点触发,故判据也照真实顺序走。 */
        assert.equal(app.loreSelectedKeys().length, 3, '首点前：默认只选「可入」的段');
        const plan = app.loreMakePlan(null, {});
        assert.equal(plan.writesNothing, true, '计划恒零写（真读数，不是缺陷）');
        assert.equal(plan.count, 3);
        assert.ok(app.loreWizard().stages.some((l) => l.indexOf('只算不写') >= 0));
        const ap = await app.loreApplyNow({});
        assert.equal(ap.ok, true);
        assert.equal(ap.applied, 3);
        assert.equal(ap.verified, 3, '逐段核过真账（写进去了，不是「以为写了」）');
        assert.equal(ap.persisted, true);
        assert.equal(ap.readback, true);
        const w3 = app.loreWizard();
        assert.ok(w3.stages.some((l) => l.indexOf('落笔:已写 3 段') >= 0), JSON.stringify(w3.stages));
        assert.equal(app.loreLedger().seen, 1);
        assert.ok(w3.stages.some((l) => l.indexOf('导入账:已落 1 篇') >= 0), JSON.stringify(w3.stages));
        const ap2 = await app.loreApplyNow({});
        assert.equal(ap2.duplicate, true);
        assert.equal(ap2.applied, 0);
        assert.ok(app.loreWizard().stages.some((l) => l.indexOf('重复提交') >= 0));
        const bad = app.loreSetClass('L1#setting-rule#0001', '不存在的类');
        assert.equal(bad.ok, false);
        assert.ok(bad.rejected.length, '拒收必须具名');
        const good = app.loreSetClass('L1#setting-rule#0001', 'backstory-event');
        assert.equal(good.ok, true);
        const r1 = app.loreWizard().rows.find((r) => r.key === 'L1#setting-rule#0001');
        assert.equal(r1.cls, 'backstory-event');
        assert.equal(r1.manual, true, '人工改过要看得见');
        assert.equal(r1.clsRule, 'setting-rule', '规则原判不许丢（人工痕迹与规则痕迹分列）');
        app.loreEntities({ knownEntities: KNOWN });
        const w5 = app.loreWizard();
        assert.equal(w5.needs.length, 1, '同名多主必须留在待认里');
        assert.equal(w5.pendingCount, 1);
        assert.deepEqual(w5.needs[0].names.slice().sort(), ['甲·A宇宙', '甲·B宇宙']);
        const pick = app.loreConfirmPick(w5.needs[0].itemKey, '甲·A宇宙');
        assert.equal(pick.resolved.length, 1);
        assert.equal(pick.mappingNeedsConfirm.length, 0);
        assert.equal(app.loreWizard().pendingCount, 0);
    } finally { clearWin(); }
});
test('C2 只有预览口：派发相为「只能看不能落」，落笔口如实说，且不偷偷回落', async () => {
    const plugin = mkPlugin('preview-only');
    const app = mkApp(plugin, 'preview-only');
    try {
        assert.equal(app.planLoreImportOutlet(), O.PREVIEW_ONLY);
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        const pv = app.lorePreview(null, {});
        assert.equal(pv.state, S.OK, '预览面照样能用');
        const plan = app.loreMakePlan(null, {});
        assert.equal(plan.state, S.OK, '计划也能出（只算不写）');
        const ap = await app.loreApplyNow({});
        assert.equal(ap.ok, false);
        assert.equal(ap.reason, 'face-absent', '★ 没有落笔面 ⇒ 如实说这一面不在场，不回落成任何别的说法');
        assert.equal(plugin.LonShaMemory.__c.apply, 0, '没有落笔口时压根不该去调它');
    } finally { clearWin(); }
});
test('C3 插件不在场：如实说读不了，自检不依赖插件在场，且不抛', async () => {
    const app = mkApp(null, 'no-plugin');
    try {
        assert.equal(app.planLoreImportOutlet(), O.NONE);
        assert.equal(app.loreFace().source, 'no-plugin');
        assert.ok(app.loreLine().indexOf('不在场') >= 0, app.loreLine());
        assert.ok(app.loreLine().indexOf('不是') >= 0, '★ 不许报成「这份资料导不进去」：' + app.loreLine());
        assert.deepEqual(app.loreClasses(), [], '没自述时不编一份类目表');
        const r = app.loreReadSource(SAMPLE, 'x.txt', {});
        assert.equal(r.state, S.ENGINE_ABSENT);
        const l = app.loreReadWindow(null, {});
        assert.equal(l.state, S.ENGINE_ABSENT);
        const ap = await app.loreApplyNow({});
        assert.equal(ap.state, S.ENGINE_ABSENT);
        assert.equal(ap.reason, 'plugin-absent', '★ 缺件优先于流程：不许报成「没预览」（处置相反）');
        assert.equal(app.loreMakePlan(null, {}).state, S.ENGINE_ABSENT, '出计划同样缺件优先');
        const w = app.loreWizard();
        assert.equal(w.rows.length, 0);
        assert.ok(w.line.indexOf('不在场') >= 0);
        assert.deepEqual(app.loreImportSelfCheck().problems, [], '自检不依赖插件在场');
    } finally { clearWin(); }
});
test('C4 截断源：整篇被拒并给出「选范围」处置；走窗口后不再是失败', () => {
    const plugin = mkPlugin('full');
    const app = mkApp(plugin, 'full');
    try {
        /* 整篇超限 ⇒ 被拒;窗口内带段边界 ⇒ 对齐后停在边界、还有下一段
         *   (两者处置相反:一个叫你改用窗口读,一个叫你接着选下一段)。
         *   第二段正好落在 4 万字符窗口之外,终点才能对齐到它这一处段边界。 */
        const long = '# 段甲' + NL + '甲'.repeat(20000) + NL + NL
            + '# 段乙' + NL + '乙'.repeat(30000) + NL + NL
            + '# 段丙' + NL + '丙'.repeat(360000) + NL;
        const t = app.loreReadSource(long, 'big.txt', {});
        assert.equal(t.state, S.BLOCKED);
        assert.equal(t.faceReason, 'source-truncated', '★ 截断 ≠ 空：这一份读得出来，但被上游切短了');
        const line = app.loreWizard().stages.filter((l) => l.indexOf('解析:') === 0)[0];
        assert.ok(line.indexOf('选范围') >= 0, '★ 必须给出正确处置：' + line);
        const w = app.loreReadWindow({ from: 0, to: 40000 }, {});
        assert.equal(w.state, S.OK, '窗口读是「长资料局部导入的正规入口」，不是失败');
        const wl = app.loreWizard().stages.filter((l) => l.indexOf('解析:') === 0)[0];
        assert.ok(wl.indexOf('还有下一段') >= 0, wl);
        assert.ok(wl.indexOf(String(long.length)) >= 0, '分母是全文件长：' + wl);
        const next = app.loreReadWindow(null, {});
        assert.ok(Number(next.window.from) > 0, '续读从上一窗的终点开始，而不是从 0 重来');
    } finally { clearWin(); }
});
test('C5 ★★★ 未预览不落笔：本层不去调上游，也不把「没试」说成「试了失败」', async () => {
    const plugin = mkPlugin('full');
    const app = mkApp(plugin, 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        const early = await app.loreApplyNow({});
        assert.equal(early.ok, false);
        assert.equal(early.faceReason, 'no-preview');
        assert.equal(plugin.LonShaMemory.__c.apply, 0,
            '★★★ 没预览就落笔 ⇒ 本层直接说清，不去让上游自己拒一次（用户更需要的是一句人话）');
        const plan = app.loreMakePlan(null, {});
        assert.equal(plan.writesNothing, true);
        assert.equal(app.loreWizard().plan.duplicate, false);
    } finally { clearWin(); }
});
test('C6 ★★★ 换会话作废旅程现场：旧资料的段/预览/计划不许画进新会话那一屏', () => {
    const plugin = mkPlugin('full');
    const app = mkApp(plugin, 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        app.lorePreview(null, {});
        app.loreMakePlan(null, {});
        assert.equal(app.loreWizard().rows.length, 3, '本会话内读数在场');
        assert.equal(app.loreWizard().plan.count, 3);
        app.onChatChanged();
        const w = app.loreWizard();
        assert.equal(w.rows.length, 0,
            '★★★ 换会话必须作废旅程现场：不作废就会把上一段会话的资料逐段表画进这一屏'
            + '（用户看到「共 3 段」而这一段一次都没读过）—— 不报错，只是错数据');
        assert.equal(w.rowTotal, 0);
        assert.equal(w.pickedCount, 0);
        assert.equal(w.sourceChars, 0);
        assert.equal(w.cursor, 0);
        assert.equal(w.stages.length, 0, '阶段行也要回到「还没走到」');
        assert.ok(app.loreLine().indexOf('在位') >= 0, '但插件还在场，面读数不该跟着丢');
        assert.equal(app.loreLedger().seen, plugin.LonShaMemory.__st.seen.length,
            '★ 上游的账本层不越权代管：本层清的是自己那一份现场');
    } finally { clearWin(); }
});

/* ══════════ C7 ── 视图接线（这一屏真的接上了，不是只写了个方法） ══════════ */
test('C7 ★★★ 导入面真的接在问答页上：宿主在场且在问答面之前、事件有落点、点选走容器级委托、样式两侧投递一致', () => {
    const Q2 = String.fromCharCode(34);
    assert.ok(viewCode.indexOf('mem-lore-host') >= 0,
        '★★★ 这一屏必须真挂进 DOM：只写一屏 HTML 而没挂载点，读数再准用户也看不见');
    const iHost = viewCode.indexOf('id=' + Q2 + 'mem-lore-host' + Q2);
    const iQa = viewCode.indexOf('if (!qa) return');
    assert.ok(iHost >= 0 && iQa >= 0, '两个落点都要在场（挂载点 / 问答面提前返回）');
    assert.ok(iHost < iQa,
        '★★★ 导入面必须排在「问答面读不出就返回」**之前**：排后面的话问答面一读不出，'
        + '整块导入面跟着消失 —— 而「插件不在场」恰恰是导入面最该站出来说话的时刻（连坐）');
    assert.equal((viewCode.match(/id="mem-lore-host"/g) || []).length, 1,
        '★ 宿主只许挂一次（导入面并入问答页，不新增分页 —— v257 F4 钉死页清单集合相等）');
    assert.ok(viewCode.indexOf('导入口读不出') >= 0,
        '★ 读不出时必须如实说「本版 App 未接线」，不许静默留白（留白与「这份资料导不进去」同形）');
    for (const b of ['#mem-lore-file', '#mem-lore-pickfile', '#mem-lore-read', '#mem-lore-win',
        '#mem-lore-winnext', '#mem-lore-preview', '#mem-lore-plan', '#mem-lore-apply', '#mem-lore-reset']) {
        assert.ok(viewCode.indexOf("q('" + b + "')") >= 0, '少一处事件落点就会画出个点不动的按钮：' + b);
    }
    for (const cls of ['.mem-lore-cls', '.mem-lore-pick', '.mem-lore-owner']) {
        const i = viewCode.indexOf("e.target.closest('" + cls + "')");
        assert.ok(i >= 0, '三处点选必须有落点：' + cls);
        assert.ok(viewCode.slice(i, i + 300).indexOf('this.container.contains(') >= 0,
            '★★★ ' + cls + ' 必须走容器级委托并当场核实在容器内：'
            + '绑在行上的监听在整块重绘后失联 —— 用户点了没反应，也不报错');
    }
    const clsOf = (s) => Array.from(new Set((s.match(/\.mem-lore-[a-z-]+/g) || []))).sort();
    const a = clsOf(appCssSrc);
    const b = clsOf(bundleCssSrc);
    assert.ok(a.length >= 20, '导入面样式类至少 20 个（实测 ' + a.length + '）');
    assert.deepEqual(b, a, '两侧投递的类集合必须一致：' + a.join(','));
    const used = new Set();
    for (const m of (viewCode.match(/class="[^"]*"/g) || [])) {
        for (const x of m.slice(7, -1).split(/\s+/)) { if (x.indexOf('mem-lore-') === 0) used.add('.' + x); }
    }
    const usedArr = Array.from(used).sort();
    const orphan = a.filter((x) => usedArr.indexOf(x) < 0);
    assert.deepEqual(orphan, [], '样式里不许有没人用的孤儿类：' + orphan.join(','));
    const noStyle = usedArr.filter((x) => a.indexOf(x) < 0);
    assert.deepEqual(noStyle, ['.mem-lore-apply', '.mem-lore-pick'],
        '★ 只许这两个附加态没有专属样式（分别继承 mini 按钮与原生复选框）；'
        + '其余「用到了却没样式」都是漏投递：' + noStyle.join(','));
});
/* ══════════ D ── 负控制（真源码破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
/** v4230 的镜像：控制器复用阅读 App 的多编码解码唯一实现，故 reading-data.js 也得进镜像
 *   —— 漏了它，破坏副本根本加载不进来（不是环境抖动，是依赖漏项）。 */
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4230_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    copyTreeSafe(path.join(ROOT, 'apps', 'memory'), path.join(dir, 'apps', 'memory'));
    copyTreeSafe(path.join(ROOT, 'apps', 'reading', 'reading-data.js'),
        path.join(dir, 'apps', 'reading', 'reading-data.js'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏：锚点必须**恰中一次**；破坏的是**副本**（绝不动真仓）。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}
/** 造**指定类**的实例（D 组要用破坏副本里的那个 MemoryApp）。 */
function mkAppOf(Cls, plugin, kind) {
    globalThis.window = Object.assign({ VirtualPhone: {} },
        (kind === 'no-plugin' || !plugin) ? {} : { LonShaMemory: plugin.LonShaMemory });
    return new Cls(null, mkStorage());
}
/** 三段长文：整篇超上限 + 第二段落在 4 万字符窗口之外（终点才对得齐段边界）。 */
const BIG = '# 段甲' + NL + '甲'.repeat(20000) + NL + NL
    + '# 段乙' + NL + '乙'.repeat(30000) + NL + NL
    + '# 段丙' + NL + '丙'.repeat(360000) + NL;
/** 两段都提到同名角色：待认 2 条、而「一段都没命中」的段数恰好 0
 *   —— 这两格在别处的取值容易碰巧相等（相等则 D6 的破坏观测不到）。 */
const SAM2 = ['# 前史事件', '甲当年在北街。', '', '# 角色背景', '甲后来走了。'].join(NL);
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真（否则 D 组是假绿）', async () => {
    const p = mkPlugin('full').LonShaMemory;
    assert.equal(K.readLoreParseWindow({ LonShaMemory: p }, { text: BIG, file: 'big.txt' },
        { range: { from: 0, to: 40000 } }).faceReason, 'ok', '原版：窗口续读不是截断');
    assert.equal(K.planLoreOutlet('yes', false), O.NONE, '原版：严格判 true');
    assert.equal((await K.readLoreApply(null, {}, {})).state, S.ENGINE_ABSENT, '原版：缺件优先');
    const app0 = mkApp(null, 'no-plugin');
    try { assert.equal((await app0.loreApplyNow({})).reason, 'plugin-absent', '原版：面门缺件优先'); }
    finally { clearWin(); }
    const app = mkApp(mkPlugin('full'), 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        app.lorePreview(null, {});
        app.loreTogglePick('L1#setting-rule#0001', false);
        assert.equal(app.loreSelectedKeys().length, 2, '原版：首点先播种默认选择');
        app.loreReadSource(SAM2, 's2.txt', {});
        app.lorePreview(null, {});
        app.loreEntities({ knownEntities: KNOWN });
        const w = app.loreWizard();
        assert.equal(w.pendingCount, w.needs.length, '原版：待认数与待认清单同源');
        assert.equal(w.pendingCount, 2);
        assert.deepEqual(w.needs[0].names.slice().sort(), ['甲·A宇宙', '甲·B宇宙'], '原版：候选摆的是主人');
        app.loreConfirmPick(w.needs[0].itemKey, '甲·A宇宙');
        assert.equal(app.loreWizard().pendingCount, 1, '原版：认下一段就少一段');
        app.onChatChanged();
        assert.equal(app.loreWizard().rows.length, 0, '原版：换会话作废现场');
    } finally { clearWin(); }
    for (const bad of ['plugin.loreImportParse', 'plugin.loreImportApply']) {
        assert.equal(appCode.indexOf(bad), -1, '原版：出口名只许在契约件出现');
    }
    const Q2 = String.fromCharCode(34);
    assert.ok(viewCode.indexOf('id=' + Q2 + 'mem-lore-host' + Q2) >= 0, '原版：宿主在场');
    assert.ok(viewCode.indexOf("e.target.closest('.mem-lore-owner')") >= 0, '原版：认人有落点');
});
test('D1 ★★★ 破坏「窗口读不得被读成截断」⇒ B2/C4 同款判据必转红', async () => {
    const A1 = '    const truncated = bool(srco && srco.truncated)'
        + NL + '        || (bool(comp && comp.state === ' + String.fromCharCode(39) + 'partial' + String.fromCharCode(39) + ') && !hasWindow);';
    const R1 = '    const truncated = bool(srco && srco.truncated)'
        + NL + '        || (bool(comp && comp.state === ' + String.fromCharCode(39) + 'partial' + String.fromCharCode(39) + '));';
    const dir = breakCopy(KERNEL_REL, A1, R1);
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d1=' + Date.now());
    const p = mkPlugin('full').LonShaMemory;
    const w = mk.readLoreParseWindow({ LonShaMemory: p }, { text: BIG, file: 'big.txt' },
        { range: { from: 0, to: 40000 } });
    assert.equal(w.faceReason, 'source-truncated',
        '★★★ 破坏副本：一窗正常续读被报成「资料被截断」⇒ 用户被赶去重复一个刚做过的动作');
    assert.equal(K.readLoreParseWindow({ LonShaMemory: p }, { text: BIG, file: 'big.txt' },
        { range: { from: 0, to: 40000 } }).faceReason, 'ok', '原版必须不报截断（否则上面转红不算证据）');
});
test('D2 ★★★ 破坏「严格判 true」⇒ A2/C 同款判据必转红（非 true 被读成有出口）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '    if (hasParse !== true) return LORE_OUTLETS.NONE;',
        '    if (!hasParse) return LORE_OUTLETS.NONE;');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d2=' + Date.now());
    assert.equal(mk.planLoreOutlet('yes', false), mk.LORE_OUTLETS.PREVIEW_ONLY,
        '破坏副本：一个字符串被读成「有解析出口」⇒ 用户会点到一个走不通的按钮');
    assert.equal(K.planLoreOutlet('yes', false), O.NONE, '原版必须严格判 true');
});
test('D3 ★★★ 破坏「缺件优先于流程前置」⇒ C3 同款判据必转红（不在场被读成没这一面）', async () => {
    const O3 = "    const o = outletOf(win, 'loreImportApply');";
    const dir = breakCopy(KERNEL_REL, O3 + NL + '    if (!o.plugin) return empty;',
        O3 + NL + '    if (false) return empty;');
    const mk = await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?d3=' + Date.now());
    const r = await mk.readLoreApply(null, {}, {});
    assert.equal(r.state, mk.LORE_FACE_STATES.FACE_ABSENT,
        '★★★ 破坏副本：插件不在场被读成「本版插件没有落笔面」—— 处置相反（去装插件 vs 去升级）');
    assert.equal((await K.readLoreApply(null, {}, {})).state, S.ENGINE_ABSENT, '原版必须报不在场');
});
test('D4 ★★★ 破坏控制器的面门 ⇒ C3 同款判据必转红（不在场不再优先说清）', async () => {
    const A4 = "    if (face.source === 'no-plugin') return { ok: false, state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent', reason: 'plugin-absent' };";
    const R4 = "    if (false) return { ok: false, state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent', reason: 'plugin-absent' };";
    const dir = breakCopy(APP_REL, A4, R4);
    const m = await loadApp(dir, 'd4');
    const app = mkAppOf(m.MemoryApp, null, 'no-plugin');
    try {
        const ap = await app.loreApplyNow({});
        assert.notEqual(ap.reason, 'plugin-absent', '破坏副本：不在场不再优先说清');
        assert.equal(ap.reason, 'no-parsed-source',
            '★★★ 而它落成了「还没读进资料」—— 用户收到的处置是去读一份资料，而真实处置是去装插件');
    } finally { clearWin(); }
});
test('D5 ★★★ 破坏「首点先播种默认选择」⇒ C1 同款判据必转红（取消一行全部勾空掉）', async () => {
    const dir = breakCopy(APP_REL,
        '      for (const k of this._loreDefaultKeys()) L.sel[k] = true;', '      void 0;');
    const m = await loadApp(dir, 'd5');
    const app = mkAppOf(m.MemoryApp, mkPlugin('full'), 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        app.lorePreview(null, {});
        app.loreTogglePick('L1#setting-rule#0001', false);
        assert.equal(app.loreSelectedKeys().length, 0,
            '★★★ 破坏副本：只取消了一行，其余「没点过」的段被静默当成未选 ⇒ 界面上所有勾一起空掉');
    } finally { clearWin(); }
    const app0 = mkApp(mkPlugin('full'), 'full');
    try {
        app0.loreReadSource(SAMPLE, '设定集.txt', {});
        app0.lorePreview(null, {});
        app0.loreTogglePick('L1#setting-rule#0001', false);
        assert.equal(app0.loreSelectedKeys().length, 2, '原版必须只退掉那一个');
    } finally { clearWin(); }
});
test('D6 ★★★ 破坏「待认数与清单同源」⇒ C1 同款判据必转红（写着待认 0 段而下面有待认）', async () => {
    const dir = breakCopy(APP_REL, '      pendingCount: needs.length,',
        '      pendingCount: ent ? (Number(ent.unresolved) || 0) : 0,');
    const m = await loadApp(dir, 'd6');
    const app = mkAppOf(m.MemoryApp, mkPlugin('full'), 'full');
    try {
        app.loreReadSource(SAM2, 's2.txt', {});
        app.lorePreview(null, {});
        app.loreEntities({ knownEntities: KNOWN });
        const w = app.loreWizard();
        assert.equal(w.needs.length, 2, '两份都提到同名角色 ⇒ 待认 2 条');
        assert.equal(w.pendingCount, 0,
            '★★★ 破坏副本：这一格取的是「一段都没命中」的段数 ⇒ 段段都提到角色时恒为 0，'
            + '用户以为没有要认的东西，直接往里落 —— 「未认下不许合并」就断在这一格读数上');
    } finally { clearWin(); }
    const app0 = mkApp(mkPlugin('full'), 'full');
    try {
        app0.loreReadSource(SAM2, 's2.txt', {});
        app0.lorePreview(null, {});
        app0.loreEntities({ knownEntities: KNOWN });
        assert.equal(app0.loreWizard().pendingCount, app0.loreWizard().needs.length, '原版必须同源');
        assert.equal(app0.loreWizard().pendingCount, 2);
    } finally { clearWin(); }
});
test('D7 ★★★ 破坏「候选摆主人」⇒ C1 同款判据必转红（点了认人等于没裁决）', async () => {
    const dir = breakCopy(APP_REL,
        '            for (const o of (Array.isArray(h && h.owners) ? h.owners : [])) {',
        '            for (const o of []) {');
    const m = await loadApp(dir, 'd7');
    const app = mkAppOf(m.MemoryApp, mkPlugin('full'), 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        app.lorePreview(null, {});
        app.loreEntities({ knownEntities: KNOWN });
        const w = app.loreWizard();
        assert.equal(w.needs.length, 1);
        assert.deepEqual(w.needs[0].names, [],
            '★★★ 破坏副本：候选空了 ⇒ 用户没有任何主人可认，界面只剩一条认不掉的待认');
    } finally { clearWin(); }
    const app0 = mkApp(mkPlugin('full'), 'full');
    try {
        app0.loreReadSource(SAMPLE, '设定集.txt', {});
        app0.lorePreview(null, {});
        app0.loreEntities({ knownEntities: KNOWN });
        assert.deepEqual(app0.loreWizard().needs[0].names.slice().sort(), ['甲·A宇宙', '甲·B宇宙'],
            '原版必须给出主人（拿被命中的名字去认，认完仍是「甲」）');
    } finally { clearWin(); }
});
test('D8 ★★★ 破坏「已认下的当场移出待认」⇒ C1 同款判据必转红（被要求重复认人）', async () => {
    const dir = breakCopy(APP_REL,
        "        if (doneKeys[String(e.itemKey || '')] === true) continue;", '        if (false) continue;');
    const m = await loadApp(dir, 'd8');
    const app = mkAppOf(m.MemoryApp, mkPlugin('full'), 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        app.lorePreview(null, {});
        app.loreEntities({ knownEntities: KNOWN });
        const key = app.loreWizard().needs[0].itemKey;
        app.loreConfirmPick(key, '甲·A宇宙');
        assert.equal(app.loreWizard().pendingCount, 1,
            '★★★ 破坏副本：认下之后清单原样还在（清单读实体面、认人结果落映射面，两份分开算）'
            + '⇒ 用户被要求重复认同一个人');
    } finally { clearWin(); }
    const app0 = mkApp(mkPlugin('full'), 'full');
    try {
        app0.loreReadSource(SAMPLE, '设定集.txt', {});
        app0.lorePreview(null, {});
        app0.loreEntities({ knownEntities: KNOWN });
        app0.loreConfirmPick(app0.loreWizard().needs[0].itemKey, '甲·A宇宙');
        assert.equal(app0.loreWizard().pendingCount, 0, '原版必须在认下后当场移出');
    } finally { clearWin(); }
});
test('D9 ★★★ 破坏「出口名只许在契约件出现」⇒ A4 同款判据必转红（上游改名后静默退化）', async () => {
    const REP = '    const probe = { hasParse: typeof plugin.loreImportParse === ' + String.fromCharCode(39)
        + 'function' + String.fromCharCode(39) + ', hasApply: typeof plugin.loreImportApply === '
        + String.fromCharCode(39) + 'function' + String.fromCharCode(39) + ' };';
    const dir = breakCopy(APP_REL, '    const probe = loreOutletProbe(win);', REP);
    const broken = stripComments(fs.readFileSync(path.join(dir, APP_REL), 'utf8'));
    for (const bad of ['plugin.loreImportParse', 'plugin.loreImportApply']) {
        assert.ok(broken.indexOf(bad) >= 0,
            '★★★ 破坏副本：出口名被写在第二处（' + bad + '）—— 上游改名时契约件那份跟着改、'
            + '这一份悄悄落空，派发相静默退化成「只能看不能落」');
        assert.equal(appCode.indexOf(bad), -1, '原版必须只在契约件出现：' + bad);
    }
});
test('D10 ★★★ 破坏「换会话作废旅程现场」⇒ C6 同款判据必转红（旧资料画进新会话）', async () => {
    const dir = breakCopy(APP_REL, '    this._lore = null;', '    void 0;');
    const m = await loadApp(dir, 'd10');
    const app = mkAppOf(m.MemoryApp, mkPlugin('full'), 'full');
    try {
        app.loreReadSource(SAMPLE, '设定集.txt', {});
        app.lorePreview(null, {});
        assert.equal(app.loreWizard().rows.length, 3, '破坏副本：本会话内读数在场');
        app.onChatChanged();
        assert.equal(app.loreWizard().rows.length, 3,
            '★★★ 破坏副本：换会话后上一段的资料仍在 ⇒ 会画进新会话那一屏'
            + '（用户看到「共 3 段」而这一段一次都没读过）—— 不报错，只是错数据');
    } finally { clearWin(); }
    const app0 = mkApp(mkPlugin('full'), 'full');
    try {
        app0.loreReadSource(SAMPLE, '设定集.txt', {});
        app0.onChatChanged();
        assert.equal(app0.loreWizard().rows.length, 0, '原版必须当场作废');
    } finally { clearWin(); }
});
test('D11 ★★★ 破坏「导入面挂在问答页上」⇒ C7 同款判据必转红（整块导入面无处可挂）', async () => {
    const HOST = '    parts.push(' + String.fromCharCode(39) + '<div id="mem-lore-host">' + String.fromCharCode(39)
        + ' + this._loreHtml() + ' + String.fromCharCode(39) + '</div>' + String.fromCharCode(39) + ');';
    const dir = breakCopy(VIEW_REL, HOST, '    parts.push(' + String.fromCharCode(39) + String.fromCharCode(39) + ');');
    const broken = stripComments(fs.readFileSync(path.join(dir, VIEW_REL), 'utf8'));
    assert.equal(broken.indexOf('id=' + String.fromCharCode(34) + 'mem-lore-host' + String.fromCharCode(34)), -1,
        '★★★ 破坏副本：宿主被摘掉 ⇒ 这一屏永远进不了 DOM（读数再准也看不见）');
    assert.ok(viewCode.indexOf('mem-lore-host') >= 0, '原版必须在场（否则上面转红不算证据）');
});
test('D12 ★★★ 破坏「同名认人走容器级委托」⇒ C7 同款判据必转红（画了个点不动的按钮）', async () => {
    const SEL = "        const ownerBtn = e.target.closest('.mem-lore-owner');";
    const dir = breakCopy(VIEW_REL, SEL, "        const ownerBtn = e.target.closest('.mem-lore-owner-gone');");
    const broken = stripComments(fs.readFileSync(path.join(dir, VIEW_REL), 'utf8'));
    assert.equal(broken.indexOf("e.target.closest('.mem-lore-owner')"), -1,
        '★★★ 破坏副本：认人按钮没有落点 ⇒ 用户点了没反应，也不报错');
    assert.ok(viewCode.indexOf("e.target.closest('.mem-lore-owner')") >= 0, '原版必须有落点');
    for (const cls of ['.mem-lore-cls', '.mem-lore-pick']) {
        assert.ok(broken.indexOf("e.target.closest('" + cls + "')") >= 0,
            '另外两处委托不该被连坐：' + cls);
    }
});
/* ══════════ E ── 版本锚 ══════════ */
test('E1 五源同源（版本号不锁死具体值，但必须一致且当版条目存在）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    assert.match(ver, /^\d+\.\d+\.\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8,
        '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0,
        'index.js 版本常量必须同源');
});
