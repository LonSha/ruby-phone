/* ============================================================
 * tests/system-v4250.test.mjs -- [v4.25.0 · 第四期 R4-X3 可阅读、可编辑的故事年鉴]
 *
 * 验收口径（计划原文 R4-X3）：
 *   从真实会话生成三章年鉴，每条关键事件可回源；改标题不改事实；
 *   正文被编辑后相关段提示需重建；导出后离线可读，未读章节秘密不出现在封面/目录摘要。
 *   不做：不新增摘要引擎、不以关键词去八股计数声称文风优秀、不自动外网发布。
 *   落点原文：「reading + creationdesk，接 M4-O6/O9、M4-X2；文稿是草稿，事实修改交上游；
 *   复用 R4-O5/O9 保存与迁移。提供作者版/按当前进度阅读版。」
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   上游 `story-annual.js`（M3-X7 四要素章册 + M4-X2 成稿面）八个 `storyAnnual*` 出口
 *   在 `window.LonShaMemory` 上早已齐全，而手机侧 `grep -RIn 'storyAnnual' apps config`
 *   **零命中** —— 建好了没人用（同族第十五例）。后果三件，都不是报错：
 *     ① 读者回看一章，只能一页页翻正文，没有「按卷章读发生什么」的入口；
 *     ② 年鉴里那些**回源凭证**（`ch1#event@2` 这种逐条指回楼层的 ref）在手机侧不存在，
 *        于是「这一条出自哪一楼」无从核对；
 *     ③ 「未读的章」与「空章」在版面上**同形**，读到第几章与能看到什么无关。
 *   验收点名的正是这四条：三章年鉴、每条关键事件可回源、改题不改事实、
 *   正文改动提示需重建、导出离线可读、未读章的秘密不出现在封面与目录。
 *
 * 【跨仓分工（本版全部判据都建立在这条上）】
 *   去剧透**一律走上游** `storyAnnualForPlayer`（它的 gate 由宿主 `_o9Gate()` 装配），
 *   手机**不自己判秘密**；手机只做上游没有的两件事 ——
 *     ① 按**本机阅读进度**裁阅读版（读到第几章）；② 封面与目录不得含未读章的痕迹。
 *   故本套件里「两版」那几条测的是**搬运**（上游说不能给就报不能给），不是手机自己判。
 *
 * 判据面（五组）：
 *   A 口径：状态互不同形 / 纯契约零副作用 / 出口名与状态字面量唯一出现点 / 视图不直呼内核
 *   B 内核行为：未判≠没有 / 回源凭证保真 / 两版不合流 / 事实位拒收 / 过期需重建 /
 *              成稿只报结构成稿 / 裁章四情形 / 封面与目录与导出的未读痕迹 / 自检真跑
 *   C 接线行为：真 App + 假存储走完整旅程（建章册 → 记进度 → 裁阅读版 → 导出）、
 *              进度键三态、视图默认阅读版、改章题只改题、换会话作废现场、创作台只取材
 *   D 负控制：真源码定点破坏 ⇒ 同款判据必转红（每条配原版必真的反向对照）
 *   E 版本锚：五源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么自检里也要真跑判据】数常量只能证明表在，不能证明**判得对** ——
 *   本仓被点过多次的「表都在、行为不对」正是靠真跑一次才现形的。
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
const KERNEL_REL = 'config/story-annual-contract.js';
const APP_REL = 'apps/reading/reading-app.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const CD_APP_REL = 'apps/creationdesk/creationdesk-app.js';
const CD_VIEW_REL = 'apps/creationdesk/creationdesk-view.js';
const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const APP = await import(pathToFileURL(path.join(ROOT, APP_REL)).href);
const VIEW = await import(pathToFileURL(path.join(ROOT, VIEW_REL)).href);
const CD = await import(pathToFileURL(path.join(ROOT, CD_APP_REL)).href);
const kernelSrc = read(KERNEL_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const cdAppSrc = read(CD_APP_REL);
const cdViewSrc = read(CD_VIEW_REL);
const S = K.SA_FACE_STATES;
const O = K.SA_OUTLETS;
const V = K.SA_VERSIONS;
/* 出口名（十个）：**只在契约件里出现**，这里只用来核对「没有第二份」。 */
const OUTLET_NAMES = ['storyAnnualBuild', 'storyAnnualReview', 'storyAnnualTwoVersions',
    'storyAnnualForPlayer', 'storyAnnualEdit', 'storyAnnualApplyEdits', 'storyAnnualStale',
    'storyAnnualCompose', 'storyAnnualComposeForPlayer', 'storyAnnualDrafts'];
/* 本面独有的面状态字面量：契约件里各出现一次；接线层零命中（不许再写第二份判定词）。
 *   ★ `empty` 不进「接线层零命中」那一档：它与创作台一个**无关的**流程状态类名同字
 *     （`cwb-st-empty`，属 R-X6 的素材步骤面）—— 把它算进来是**误报**，不是漏检。
 *     它在契约件里「只出现一次」这一档照查（本面自己的词表仍受约束）。 */
const KERNEL_ONCE = ['engine-absent', 'unusable', 'unchecked', 'locked', 'empty'];
const WIRING_ZERO = ['engine-absent', 'unusable', 'unchecked', 'locked'];
const countOf = (hay, needle) => hay.split(needle).length - 1;
/* ══════════ 假件 ══════════ */
/** storage 假件：只实现数据层用到的 get/set/has。 */
function mkStorage() {
    const mem = new Map();
    return {
        _mem: mem,
        get: (k, d) => (mem.has(k) ? mem.get(k) : d),
        set: (k, v) => { mem.set(k, v); },
        has: (k) => mem.has(k),
        version: '1.19.0'
    };
}
/** 上游假件的哈希：与真件的 hash32 同口径（FNV-1a，稳定可复算）。 */
function hash32(s) {
    const t = String(s == null ? '' : s);
    let h = 2166136261;
    for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
}
/** 三章裸载荷（**原形**：事件叫 events、未了事项叫 open —— 与上游 build 的吃法一致）。 */
function mkPayload() {
    return {
        chapters: [
            {
                ref: { project: 'P', volume: '第一卷', chapter: 1 }, title: '相遇', summary: '两人第一次见面',
                floorFrom: 1, floorTo: 6,
                events: [{ floor: 2, text: '甲在门口遇见了乙', chars: ['甲', '乙'] }],
                changes: [{ char: '甲', from: '戒备', to: '好奇', floor: 4 }],
                open: [{ key: 'k1', text: '那封信还没拆', floor: 5 }],
                quotes: [{ floor: 3, text: '你来得比我想的早', speaker: '乙' }]
            },
            {
                ref: { project: 'P', volume: '第一卷', chapter: 2 }, title: '试探', summary: '互相试探',
                floorFrom: 7, floorTo: 14,
                events: [{ floor: 9, text: '乙独自去了旧仓库', chars: ['乙'] }],
                changes: [], open: [], quotes: []
            },
            {
                ref: { project: 'P', volume: '第一卷', chapter: 3 }, title: '揭底', summary: '秘密被揭开',
                floorFrom: 15, floorTo: 22,
                events: [{ floor: 17, text: '丙的真实身份曝光', chars: ['丙'] }],
                changes: [{ char: '丙', from: '路人', to: '旧识', floor: 18 }], open: [], quotes: []
            }
        ]
    };
}
/** 裸章 → 归一章（逐条钉上 `evidenceRef`：这就是「可回源」的载体）。 */
function buildChapter(raw) {
    const ref = (raw && raw.ref) || {};
    const mk = (it, kind) => Object.assign({}, it, { evidenceRef: 'ch' + ref.chapter + '#' + kind + '@' + (it.floor || 0) });
    const events = (raw.events || []).map((it) => mk(it, 'event'));
    const changes = (raw.changes || []).map((it) => mk(it, 'change'));
    const unfinished = (raw.open || []).map((it) => mk(it, 'unfinished'));
    const quotes = (raw.quotes || []).map((it) => mk(it, 'quote'));
    return {
        ref: ref, title: raw.title, summary: raw.summary, floorFrom: raw.floorFrom, floorTo: raw.floorTo,
        events: events, changes: changes, unfinished: unfinished, quotes: quotes,
        evidence: events.concat(changes, unfinished, quotes).map((it) => ({
            kind: it.evidenceRef.split('#')[1].split('@')[0], floor: it.floor, ref: it.evidenceRef,
            hash: hash32(it.text !== undefined ? it.text : it.to)
        }))
    };
}
const DRAFT_FIELDS = ['title', 'summary', 'highlights', 'quotes', 'style', 'note', 'sections'];
const FACT_FIELDS = ['state', 'facts', 'floor', 'floorFrom', 'floorTo', 'ref', 'evidenceRef', 'chars'];
/**
 * 假上游：按 `story-annual.js` 的口径缩微（建章册 / 两版 / 编辑 / 过期 / 成稿）。
 *   ★ 只缩微**被本面用到的**语义；判据不测上游，测的是手机侧搬运得对不对。
 */
function mkUpstream(opts = {}) {
    const o = Object.assign({
        payload: mkPayload(), gate: { resolve: () => ({ verdict: 'known' }) }, playerBlocked: false
    }, opts);
    const api = {
        storyAnnualBuild(payload) {
            const src = payload || o.payload;
            if (!src || !Array.isArray(src.chapters)) {
                return { kind: 'story_annual', ok: false, chapters: [], counts: {}, chaptersChecked: false, why: ['chapters-absent'] };
            }
            const chapters = src.chapters.map(buildChapter);
            const counts = { events: 0, changes: 0, unfinished: 0, quotes: 0 };
            for (const c of chapters) {
                counts.events += c.events.length; counts.changes += c.changes.length;
                counts.unfinished += c.unfinished.length; counts.quotes += c.quotes.length;
            }
            return { kind: 'story_annual', ok: chapters.length > 0, chapters: chapters, counts: counts, chaptersChecked: true, why: chapters.length ? [] : ['no-chapters'] };
        },
        storyAnnualReview(ref, payload) {
            const src = payload || o.payload;
            const want = String((ref && ref.chapter !== undefined) ? ref.chapter : ref);
            const raw = (src && Array.isArray(src.chapters) ? src.chapters : [])
                .filter((c) => String((c.ref || {}).chapter) === want)[0];
            if (!raw) return { ok: false, why: ['no-such-chapter'] };
            const c = buildChapter(raw);
            return {
                ok: true, ref: c.ref, title: c.title, summary: c.summary,
                elements: { events: c.events, changes: c.changes, unfinished: c.unfinished, quotes: c.quotes },
                evidence: c.evidence, evidenceChecked: true, evidenceBound: c.evidence.length, evidenceMissing: 0, why: []
            };
        },
        storyAnnualTwoVersions(rev, opts2) {
            const oo = opts2 || {};
            const g = oo.gate !== undefined ? oo.gate : o.gate;
            const r = (rev && typeof rev === 'object') ? rev : null;
            const out = { spoilerFree: null, authorial: null, leakedChars: [], versionsDistinct: false, why: [], gated: !!g };
            if (!r || !r.ok) { out.why.push('no-review'); return out; }
            const pick = (deep) => ({
                version: deep ? 'authorial' : 'spoiler-free', title: r.title, ref: Object.assign({}, r.ref),
                elements: {
                    events: (r.elements.events || []).slice(),
                    changes: deep ? (r.elements.changes || []).slice() : [],
                    unfinished: deep ? (r.elements.unfinished || []).slice() : [],
                    quotes: (r.elements.quotes || []).slice()
                },
                evidence: (r.evidence || []).slice()
            });
            out.spoilerFree = pick(false);
            out.authorial = pick(true);
            out.versionsDistinct = true;
            if (!g) out.why.push('no-gate');
            return out;
        },
        storyAnnualForPlayer(rev, opts2) {
            const bad = (why) => ({ ok: false, version: null, reason: why, spoilerFree: null, authorial: null, note: '不接作者版:去剧透未成立(' + why + ')', writesNothing: true });
            if (o.playerBlocked) return bad('over-redacted');
            const tv = api.storyAnnualTwoVersions(rev, opts2 || {});
            if (!tv.spoilerFree) return bad('no-review');
            if (tv.gated !== true) return bad('knowledge-face-absent');
            return { ok: true, version: tv.spoilerFree, reason: '', gated: true, note: '按事实可知性裁剪后的玩家版', writesNothing: true };
        },
        storyAnnualEdit(state, patch) {
            const out = { ok: false, state: null, changed: [], rejected: [], reason: '' };
            const s = (state && typeof state === 'object') ? state : null;
            const p = (patch && typeof patch === 'object') ? patch : null;
            if (!s) return Object.assign(out, { reason: 'no-state' });
            if (!p) return Object.assign(out, { reason: 'no-patch' });
            const next = Object.assign({}, s);
            for (const k of Object.keys(p)) {
                if (FACT_FIELDS.indexOf(k) >= 0) { out.rejected.push({ key: k, why: 'draft-only', note: '事实位不属于草稿' }); continue; }
                if (DRAFT_FIELDS.indexOf(k) < 0) { out.rejected.push({ key: k, why: 'unknown-field', note: '未登记字段不得静默丢弃' }); continue; }
                if (next[k] !== p[k]) { next[k] = p[k]; out.changed.push(k); }
            }
            out.state = next;
            out.ok = out.changed.length > 0 || out.rejected.length > 0;
            out.reason = out.changed.length ? 'edited' : (out.rejected.length ? 'rejected-only' : 'no-change');
            return out;
        },
        storyAnnualApplyEdits(draft, patch) {
            const out = { ok: false, state: null, changed: [], rejected: [], reason: '', memoryUntouched: true, evidenceIntact: true };
            const d = (draft && typeof draft === 'object') ? draft : null;
            const p = (patch && typeof patch === 'object') ? patch : null;
            if (!d) return Object.assign(out, { reason: 'no-draft' });
            if (!p) return Object.assign(out, { reason: 'no-patch' });
            const next = {};
            for (const k of Object.keys(d)) {
                if (FACT_FIELDS.indexOf(k) >= 0) { out.rejected.push({ key: k, why: 'draft-only', note: '入参草稿夹带的事实位不随编辑流传' }); continue; }
                next[k] = d[k];
            }
            for (const k of Object.keys(p)) {
                if (FACT_FIELDS.indexOf(k) >= 0) { out.rejected.push({ key: k, why: 'draft-only', note: '事实位不属于草稿' }); continue; }
                if (DRAFT_FIELDS.indexOf(k) < 0) { out.rejected.push({ key: k, why: 'unknown-field', note: '未登记字段不得静默丢弃' }); continue; }
                if (JSON.stringify(next[k]) !== JSON.stringify(p[k])) { next[k] = p[k]; out.changed.push(k); }
            }
            out.state = next;
            out.ok = out.changed.length > 0 || out.rejected.length > 0;
            out.reason = out.changed.length ? 'edited' : (out.rejected.length ? 'rejected-only' : 'no-change');
            return out;
        },
        storyAnnualStale(oldChapters, newPayload) {
            const out = { stale: 0, fresh: 0, missingChapters: 0, staleRefs: [], why: [] };
            const olds = Array.isArray(oldChapters) ? oldChapters : null;
            if (!olds) { out.why.push('no-old-chapters'); return out; }
            const np = (newPayload && typeof newPayload === 'object') ? newPayload : null;
            if (!np || !Array.isArray(np.chapters)) { out.why.push('no-new-payload'); return out; }
            const now = new Map();
            for (const c of np.chapters) { const b = buildChapter(c); now.set(String(b.ref.chapter), b); }
            for (const c of olds) {
                const key = String(((c && c.ref) || {}).chapter);
                if (!now.has(key)) { out.missingChapters += 1; continue; }
                const nb = now.get(key);
                const byRef = new Map();
                for (const it of nb.events.concat(nb.changes, nb.unfinished, nb.quotes)) {
                    byRef.set(it.evidenceRef, hash32(it.text !== undefined ? it.text : it.to));
                }
                for (const it of (c.events || []).concat(c.changes || [], c.unfinished || [], c.quotes || [])) {
                    const rf = it.evidenceRef;
                    const hv = hash32(it.text !== undefined ? it.text : it.to);
                    if (!byRef.has(rf)) { out.stale += 1; out.staleRefs.push({ chapter: key, ref: rf, why: 'gone' }); continue; }
                    if (byRef.get(rf) !== hv) { out.stale += 1; out.staleRefs.push({ chapter: key, ref: rf, why: 'hash-changed' }); }
                    else out.fresh += 1;
                }
            }
            return out;
        },
        storyAnnualCompose(rev, opts2) {
            const oo = opts2 || {};
            const pol = typeof oo.polish === 'function';
            return {
                ok: true, text: '【第 1 章】相遇\n甲在门口遇见了乙', sections: [{ kind: 'event', evidenceRef: 'ch1#event@2' }],
                source: pol ? 'polished' : 'structure-only', modelUsed: pol, styleChecked: false,
                styleNote: pol ? '文风未结论' : '未调用真实模型 ⇒ 只报结构成稿',
                evidenceBound: 1, evidenceMissing: 0, evidenceUndecided: 0
            };
        }
    };
    return api;
}
const winOf = (up) => ({ LonShaMemory: up });
const revOf = (up) => up.storyAnnualReview({ chapter: 1 }, null);
/** 真 App + 假存储（宿主 window 由参数给）。 */
function appOf(m, win, shell) {
    const sh = shell || { showNotification: () => {}, screen: null };
    const a = new m.ReadingApp(sh, mkStorage());
    a._hostWin = () => win;
    return a;
}
/* ══════════ A ── 口径 ══════════ */
test('A1 面状态两两不同形（未判 ≠ 没有 / 被进度挡住 ≠ 真没内容 / 没有这一面 ≠ 插件不在场）', () => {
    const vals = Object.keys(S).map((k) => S[k]);
    assert.equal(new Set(vals).size, vals.length, '状态各格必须互不相同');
    assert.notEqual(S.UNCHECKED, S.EMPTY, '「章面未判」与「确实没有章」必须不同形');
    assert.notEqual(S.LOCKED, S.EMPTY, '「被进度挡住」与「真没内容」必须不同形');
    assert.notEqual(S.FACE_ABSENT, S.ENGINE_ABSENT, '「没有这一面」与「插件不在场」必须不同形');
    assert.notEqual(S.UNUSABLE, S.ENGINE_ABSENT, '「本机读不出」与「插件不在场」必须不同形');
    assert.deepEqual(Object.keys(O).map((k) => O[k]).sort(), ['build+edit', 'none', 'read-only']);
    assert.deepEqual(Object.keys(V).map((k) => V[k]).sort(), ['authorial', 'player']);
    assert.equal(K.SA_LIMITS.chapters > 0 && K.SA_LIMITS.items > 0 && K.SA_LIMITS.snippet > 0 && K.SA_LIMITS.coverChars > 0, true);
});
test('A2 纯契约零副作用：不碰 DOM / 存储 / 网络 / 时钟，且只依赖唯一取数门', () => {
    for (const bad of ['document', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'fetch(', 'Date.now', 'new Date', 'setTimeout', 'setInterval', 'Math.random']) {
        assert.equal(countOf(kernelSrc, bad), 0, '契约件不得出现：' + bad);
    }
    assert.equal(countOf(kernelSrc, "from './num-gate.js'"), 1, '取数必须走全仓唯一取数门');
    assert.equal(countOf(kernelSrc, 'numOrNull(') >= 1, true);
    /* 插件句柄只从宿主 window 上读，且怪异 getter 一律降级（不外抛）。 */
    assert.ok(kernelSrc.indexOf('LonShaMemory') >= 0);
    const weird = { get LonShaMemory() { throw new Error('boom'); } };
    assert.equal(K.saOutletProbe(weird).present, false, '宿主 getter 抛错必须降级成「不在场」');
});
test('A3 出口名与面状态字面量唯一出现点：改一处即全仓同改（防改名后静默退化）', () => {
    const surfaces = [appSrc, viewSrc, cdAppSrc, cdViewSrc];
    for (const n of OUTLET_NAMES) {
        assert.ok(countOf(kernelSrc, "'" + n + "'") >= 1, '出口名必须在契约件里出现：' + n);
        for (const s of surfaces) assert.equal(countOf(s, "'" + n + "'"), 0, '出口名不得在接线层再写一份：' + n);
    }
    for (const lit of KERNEL_ONCE) {
        assert.equal(countOf(kernelSrc, "'" + lit + "'"), 1, '面状态字面量在契约件里只许出现一次：' + lit);
    }
    for (const lit of WIRING_ZERO) {
        for (const s of surfaces) assert.equal(countOf(s, "'" + lit + "'"), 0, '面状态字面量不得出现在接线层：' + lit);
    }
    assert.equal(countOf(kernelSrc, "'face-absent'") >= 1, true);
    for (const s of surfaces) assert.equal(countOf(s, "'face-absent'"), 0, '理由串也不得在接线层再写一份');
});
test('A4 视图不直呼内核：判定全由 App 转交（同一口径只许一份实现）', () => {
    assert.equal(countOf(viewSrc, 'story-annual-contract'), 0, '视图不得直接 import 契约件');
    assert.equal(countOf(cdViewSrc, 'story-annual-contract'), 0, '创作台视图同样不直呼内核');
    for (const m of ['annualBook()', 'annualBookLine()', 'annualReadingVersion(', 'annualExportText(', 'annualEdit(', 'annualStale(']) {
        assert.ok(viewSrc.indexOf('this.app.' + m) >= 0, '视图必须经 App 转交：' + m);
    }
    assert.ok(appSrc.indexOf('story-annual-contract') >= 0, 'App 才是接线点');
});
/* ══════════ B ── 内核行为 ══════════ */
test('B1 未判 ≠ 没有：没拿到卷章结构报「章面未判」，拿到了但没有章才报「确实没有章」', () => {
    const b = K.readAnnualBuild(winOf(mkUpstream({ payload: null })), null, {});
    assert.equal(b.chaptersChecked, false);
    assert.equal(b.state, S.UNCHECKED, '★ 未判必须单独一格，不许读成 empty');
    assert.equal(K.bookLine(b).indexOf('章面未判') >= 0, true);
    assert.equal(K.bookLine(b).indexOf('确实没有章'), -1, '★ 未判不得说成「没有章」');
    const empty = K.readAnnualBuild(winOf(mkUpstream({ payload: { chapters: [] } })), null, {});
    assert.equal(empty.chaptersChecked, true);
    assert.equal(empty.state, S.EMPTY);
    assert.equal(K.bookLine(empty).indexOf('确实没有章') >= 0, true);
});
test('B2 三章年鉴：章数 / 四要素计数 / 回源凭证与楼层原样搬运（不自己重拼 id）', () => {
    const b = K.readAnnualBuild(winOf(mkUpstream()), null, {});
    assert.equal(b.state, S.OK);
    assert.equal(b.ok, true);
    assert.equal(b.chapters.length, 3);
    assert.deepEqual(b.counts, { events: 3, changes: 2, unfinished: 1, quotes: 1 });
    const c1 = b.chapters[0];
    assert.equal(c1.no, 1);
    assert.equal(c1.title, '相遇');
    assert.equal(c1.floorFrom, 1);
    assert.equal(c1.floorTo, 6);
    assert.equal(c1.elements.events[0].evidenceRef, 'ch1#event@2', '★ 回源凭证必须原样搬');
    assert.equal(c1.elements.unfinished[0].evidenceRef, 'ch1#unfinished@5');
    assert.equal(c1.evidence.length, 4);
    assert.equal(c1.evidenceCount, 4);
    assert.equal(c1.evidence[0].ref, 'ch1#event@2');
    assert.equal(c1.evidence[0].hash.length > 0, true);
    assert.equal(K.bookLine(b).indexOf('3 章 · 关键事件 3') >= 0, true);
    /* 章数上限：多给的只渲染前 N 章（不把浏览器拖慢）。 */
    const many = { chapters: Array.from({ length: 60 }, (_, i) => ({ ref: { chapter: i + 1 }, title: 'T' + (i + 1), events: [], changes: [], open: [], quotes: [] })) };
    assert.equal(K.readAnnualBuild(winOf(mkUpstream({ payload: many })), null, {}).chapters.length, K.SA_LIMITS.chapters);
});
test('B3 四种读不到各给各的话：插件不在场 / 没有这一面 / 抛错 / 回执畸形', () => {
    const noPlugin = K.readAnnualBuild({}, null, {});
    assert.equal(noPlugin.state, S.ENGINE_ABSENT);
    assert.equal(K.bookLine(noPlugin).indexOf('插件不在场') >= 0, true);
    const faceAbsent = K.readAnnualBuild({ LonShaMemory: {} }, null, {});
    assert.equal(faceAbsent.state, S.FACE_ABSENT);
    assert.equal(K.bookLine(faceAbsent).indexOf('没有年鉴面') >= 0, true);
    const thrown = K.readAnnualBuild({ LonShaMemory: { storyAnnualBuild() { throw new Error('x'); } } }, null, {});
    assert.equal(thrown.state, S.UNUSABLE);
    assert.equal(K.bookLine(thrown).indexOf('不是「没有章节」') >= 0, true);
    const malformed = K.readAnnualBuild({ LonShaMemory: { storyAnnualBuild() { return null; } } }, null, {});
    assert.equal(malformed.state, S.UNUSABLE);
    /* 派发相：严格判 true（宽松判会让用户点到走不通的按钮）。 */
    assert.equal(K.planSaOutlet(true, true), O.FULL);
    assert.equal(K.planSaOutlet(true, false), O.READ_ONLY);
    assert.equal(K.planSaOutlet(false, true), O.NONE);
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) assert.equal(K.planSaOutlet(bad, true), O.NONE, '严格判 true:' + String(bad));
});
test('B4 两版不得合流：去剧透未成立 ⇒ 不给玩家版（绝不回退作者版）', () => {
    const blocked = mkUpstream({ playerBlocked: true });
    const tv = K.readAnnualTwoVersions(winOf(blocked), revOf(blocked), {});
    assert.equal(tv.authorial !== null, true, '作者版读得到（它只是不许当兜底）');
    assert.equal(tv.player, null, '★ 玩家版被挡时必须给 null');
    assert.equal(tv.playerOk, false);
    assert.equal(tv.playerReason, 'over-redacted');
    assert.equal(K.versionsLine(tv).indexOf('不回退作者版') >= 0, true);
    assert.equal(K.versionsLine(tv).indexOf('阅读版被挡') >= 0, true);
    const ok = mkUpstream();
    const tv2 = K.readAnnualTwoVersions(winOf(ok), revOf(ok), {});
    assert.equal(tv2.playerOk, true);
    assert.equal(tv2.player.version, 'spoiler-free');
    assert.equal(tv2.player.elements.unfinished.length, 0, '★ 玩家版不含未了事项（那是作者面）');
    assert.equal(tv2.authorial.elements.unfinished.length, 1);
    assert.equal(tv2.gated, true);
    /* 没有可知性面 ⇒ 照样不给玩家版（旧口径不假装已去剧透）。 */
    const noGate = mkUpstream({ gate: null });
    const tv3 = K.readAnnualTwoVersions(winOf(noGate), revOf(noGate), {});
    assert.equal(tv3.playerOk, false);
    assert.equal(tv3.playerReason, 'knowledge-face-absent');
    assert.equal(K.versionsLine(tv3).indexOf('可知性面缺席') >= 0, true);
});
test('B5 草稿 ≠ 事实：改标题只改标题，事实位逐条被拒且不得进草稿', () => {
    const up = mkUpstream();
    const w = winOf(up);
    const okEdit = K.readAnnualEdit(w, { title: '旧题' }, { title: '新题' });
    assert.equal(okEdit.ok, true);
    assert.deepEqual(okEdit.changed, ['title']);
    assert.deepEqual(okEdit.rejected, []);
    assert.equal(okEdit.next.title, '新题');
    const mixed = K.readAnnualEdit(w, { title: '旧题' }, { title: '新题', facts: '伪造的事实', floorFrom: 1 });
    assert.deepEqual(mixed.changed, ['title']);
    assert.equal(mixed.rejected.length, 2);
    assert.equal(mixed.rejected.every((r) => r.why === 'draft-only'), true, '事实位一律 draft-only');
    assert.equal(mixed.next.facts, undefined, '★ 被拒 = 不进草稿');
    assert.equal(mixed.next.floorFrom, undefined);
    const only = K.readAnnualEdit(w, { title: '旧题' }, { facts: 'x' });
    assert.deepEqual(only.changed, []);
    assert.equal(only.next.title, '旧题', '★ 一个字都没改');
    /* 编辑口缺席：如实说「没有这一面」，不假装改好了。 */
    const noEdit = K.readAnnualEdit({ LonShaMemory: { storyAnnualBuild() {} } }, {}, {});
    assert.equal(noEdit.state, S.FACE_ABSENT);
    assert.deepEqual(noEdit.changed, []);
});
test('B6 正文被编辑后相关段提示需重建：逐条具名 staleRefs；整章不在 ≠ 被删', () => {
    const up = mkUpstream();
    const w = winOf(up);
    const b = K.readAnnualBuild(w, null, {});
    const same = K.readAnnualStale(w, b.rawChapters, mkPayload());
    assert.equal(same.judged, true);
    assert.equal(same.needRebuild, false);
    assert.equal(same.stale, 0);
    assert.equal(same.fresh, 7, '7 条证据位全新鲜');
    const p2 = mkPayload();
    p2.chapters[0].events[0].text = '甲在门口遇见了乙（改过）';
    const changed = K.readAnnualStale(w, b.rawChapters, p2);
    assert.equal(changed.needRebuild, true);
    assert.equal(changed.stale, 1);
    assert.equal(changed.staleRefs.length, 1);
    assert.equal(changed.staleRefs[0].ref, 'ch1#event@2', '★ 具名到条');
    assert.equal(changed.staleRefs[0].why, 'hash-changed');
    const p3 = mkPayload();
    p3.chapters = p3.chapters.slice(0, 2);
    const gone = K.readAnnualStale(w, b.rawChapters, p3);
    assert.equal(gone.missingChapters, 1);
    assert.equal(gone.needRebuild, true, '整章不在也要重建（过期 ≠ 删除）');
    /* ★ 判不了 ≠ 全都新鲜：没拿到新载荷时不许报「原稿未变」。 */
    const un = K.readAnnualStale(w, b.rawChapters, null);
    assert.equal(un.judged, false);
    assert.equal(un.state, S.UNUSABLE);
    assert.notEqual(un.state, S.OK);
    assert.equal(un.faceReason, 'no-new-payload');
});
test('B7 成稿 ≠ 过模型：未给真模型通道只报结构成稿，且不谎称文风通过', () => {
    const up = mkUpstream();
    const w = winOf(up);
    const rev = revOf(up);
    const c = K.readAnnualCompose(w, rev, {});
    assert.equal(c.source, 'structure-only');
    assert.equal(c.modelUsed, false);
    assert.equal(c.styleChecked, false);
    assert.equal(c.styleNote.indexOf('只报结构成稿') >= 0, true);
    assert.equal(c.sections, 1);
    assert.equal(c.text.length > 0, true);
    const p = K.readAnnualCompose(w, rev, { polish: () => 'x' });
    assert.equal(p.source, 'polished');
    assert.equal(p.styleChecked, false, '过了模型也不许替它宣称「文风通过」');
    const absent = K.readAnnualCompose({ LonShaMemory: {} }, rev, {});
    assert.equal(absent.state, S.FACE_ABSENT);
    assert.equal(absent.source, 'structure-only', '读不到时不许默认成已过模型');
});
test('B8 按当前进度裁阅读版：四种情形（未给进度不裁 / 读到 0 / 读到中途 / 全读完）', () => {
    const b = K.readAnnualBuild(winOf(mkUpstream()), null, {});
    const chs = b.chapters;
    const none = K.readingVersionOf(chs, {});
    assert.equal(none.lockedCount, 0, '★ 进度未给 ⇒ 不裁（宁可言多，不静默藏用户自己的文稿）');
    assert.equal(K.readingVersionOf(chs, { readThrough: null }).lockedCount, 0);
    const zero = K.readingVersionOf(chs, { readThrough: 0 });
    assert.equal(zero.lockedCount, 3);
    assert.equal(zero.readCount, 0);
    const mid = K.readingVersionOf(chs, { readThrough: 1 });
    assert.equal(mid.lockedCount, 2);
    assert.equal(mid.readThrough, 1);
    assert.equal(mid.chapters[0].locked, false);
    assert.equal(mid.chapters[0].title, '相遇');
    const all = K.readingVersionOf(chs, { readThrough: 3 });
    assert.equal(all.lockedCount, 0);
    assert.equal(all.readCount, 3);
    /* 未读章的标题 / 摘要 / 四要素 / 证据一律清空，只留章号与占位。 */
    const lock = mid.chapters[2];
    assert.equal(lock.locked, true);
    assert.equal(lock.title, '');
    assert.equal(lock.summary, '');
    assert.equal(lock.volumeLabel, '');
    assert.equal(lock.projectLabel, '');
    assert.equal(lock.elements, null);
    assert.deepEqual(lock.evidence, []);
    assert.equal(lock.no, 3);
    /* 越界进度不越权：读到第 99 章不得把没有的章变出来。 */
    assert.equal(K.readingVersionOf(chs, { readThrough: 99 }).readCount, 3);
});
test('B9 封面 / 目录 / 导出：未读章的标题与正文一个都不出现，已读章的还带得回源凭证', () => {
    const b = K.readAnnualBuild(winOf(mkUpstream()), null, {});
    const v = K.readingVersionOf(b.chapters, { readThrough: 1 });
    const cov = K.coverOf(v, { bookTitle: '故事年鉴' });
    assert.equal(cov.readCount, 1);
    assert.equal(cov.lockedCount, 2);
    assert.deepEqual(cov.totals, { events: 1, changes: 1, unfinished: 1, quotes: 1 }, '封面只统计已读章');
    assert.equal(cov.text.indexOf('已读 1 章') >= 0, true);
    assert.equal(cov.text.indexOf('还有 2 章未读') >= 0, true);
    for (const leak of ['试探', '揭底', '乙独自去了旧仓库', '丙的真实身份曝光']) {
        assert.equal(cov.text.indexOf(leak), -1, '★ 封面不得含未读章痕迹：' + leak);
    }
    const toc = K.tocOf(v);
    assert.deepEqual(toc.map((r) => r.label), ['相遇', '第 2 章（未读）', '第 3 章（未读）']);
    assert.equal(toc[1].locked, true);
    assert.equal(toc[2].label.indexOf('揭底'), -1);
    const out = K.exportTextOf(v, { bookTitle: '故事年鉴', versionLabel: '（按当前进度阅读版）' });
    assert.equal(out.indexOf('甲在门口遇见了乙') >= 0, true, '已读章正文要在');
    assert.equal(out.indexOf('ch1#event@2') >= 0, true, '★ 回源凭证随文本落盘（离线也要能回源）');
    assert.equal(out.indexOf('未读 —— 内容未展开') >= 0, true);
    assert.equal(out.indexOf('离线可读') >= 0, true);
    for (const leak of ['试探', '揭底', '乙独自去了旧仓库', '丙的真实身份曝光']) {
        assert.equal(out.indexOf(leak), -1, '★ 导出不得含未读章正文 / 标题：' + leak);
    }
    /* 长条截断到上限：一条上千字的摘录不该把导出撑成整本正文（只算正文那一段，不含回源括注）。 */
    const long = { chapters: [{ no: 1, title: '长', elements: { events: [{ text: '字'.repeat(400), evidenceRef: 'ch1#event@1' }], changes: [], unfinished: [], quotes: [] } }] };
    const longOut = K.exportTextOf(K.readingVersionOf(long.chapters, {}), {});
    const line = longOut.split(String.fromCharCode(10)).filter((l) => l.indexOf('字字') >= 0)[0];
    const body = line.split('〔')[0].trim();
    assert.equal(body.length <= K.SA_LIMITS.snippet, true, '每条正文按上限截断（实测 ' + body.length + '）');
    assert.equal(line.indexOf('…') >= 0, true, '被截断的条目要有省略号（不假装它是全文）');
    /* ★ 形状只认两种：裸章数组与 `{chapters}` 版对象 —— 传数组时导出不许静默变空稿。 */
    const fromArr = K.exportTextOf(K.readingVersionOf(long.chapters, {}).chapters, {});
    assert.equal(fromArr.indexOf('字字') >= 0, true, '传裸章数组时导出必须照常出稿（形状不对不许静默空）');
    assert.equal(K.coverOf(long.chapters, {}).readCount, 1);
    assert.equal(K.tocOf(long.chapters).length, 1);
    assert.equal(K.exportTextOf(null, {}).indexOf('离线可读') >= 0, true, '没有版时也要给一份可读的空稿');
});
test('B10 内核自检真跑判据（不是数常量）：真跑一遍建章册 / 裁章 / 回源 / 未判四组行为断言', () => {
    const sc = K.saSelfCheck();
    assert.deepEqual(sc.problems, [], '自检不得有问题');
    assert.equal(sc.states >= 6, true);
    assert.equal(sc.outlets, 3);
    assert.equal(sc.limits, 4);
    const app = appOf(APP, winOf(mkUpstream()));
    assert.deepEqual(app.annualSelfCheck().problems, [], 'App 侧真消费点读到同一份自检');
});
/* ══════════ C ── 接线行为（真 App + 假存储） ══════════ */
test('C1 派发相三态：没有插件 / 只有建章口（只能读不能改）/ 读写都在', () => {
    assert.deepEqual(appOf(APP, {}).annualFace().outlet, O.NONE);
    assert.deepEqual(appOf(APP, { LonShaMemory: {} }).annualFace().outlet, O.NONE);
    const readOnly = appOf(APP, { LonShaMemory: { storyAnnualBuild() {} } });
    assert.equal(readOnly.annualFace().outlet, O.READ_ONLY);
    assert.equal(readOnly.annualFace().probe.hasEdit, false);
    assert.equal(appOf(APP, winOf(mkUpstream())).annualFace().outlet, O.FULL);
});
test('C2 未接插件：如实报「插件不在场」，不编一章空章册冒充', () => {
    const app = appOf(APP, {});
    const b = app.annualBook();
    assert.equal(b.state, S.ENGINE_ABSENT);
    assert.deepEqual(b.chapters, []);
    assert.equal(app.annualBookLine().indexOf('插件不在场') >= 0, true);
    assert.equal(app.annualReadingVersion([], null).lockedCount, 0);
    assert.equal(app.annualExportText(app.annualReadingVersion([], null), {}).indexOf('离线可读') >= 0, true);
});
test('C3 完整旅程：真 App 从会话建三章年鉴 → 记进度 → 裁阅读版 → 导出离线文件', () => {
    const app = appOf(APP, winOf(mkUpstream()));
    assert.equal(app.annualFace().outlet, O.FULL);
    const book = app.annualBook();
    assert.equal(book.state, S.OK);
    assert.equal(book.chapters.length, 3);
    assert.equal(app.annualBookLine().indexOf('3 章') >= 0, true);
    assert.deepEqual(app.setAnnualReadThrough(1), { ok: true, readThrough: 1 });
    assert.equal(app.annualReadThrough(), 1);
    const ver = app.annualReadingVersion(book.chapters, app.annualReadThrough());
    assert.equal(ver.lockedCount, 2);
    const cov = app.annualCover(ver, { bookTitle: '故事年鉴' });
    assert.equal(cov.readCount, 1);
    assert.equal(cov.text.indexOf('试探'), -1);
    assert.deepEqual(app.annualToc(ver).map((r) => r.label), ['相遇', '第 2 章（未读）', '第 3 章（未读）']);
    const out = app.annualExportText(ver, { bookTitle: '故事年鉴' });
    assert.equal(out.indexOf('甲在门口遇见了乙') >= 0, true);
    assert.equal(out.indexOf('ch1#event@2') >= 0, true);
    assert.equal(out.indexOf('乙独自去了旧仓库'), -1);
    /* 两版读数也走同一批出口（去剧透由上游判，手机只搬）。 */
    const up = mkUpstream();
    const app2 = appOf(APP, winOf(up));
    const tv = app2.annualTwoVersions(revOf(up), {});
    assert.equal(tv.playerOk, true);
    assert.equal(app2.annualVersionsLine(tv).indexOf('阅读版可用') >= 0, true);
    const blocked = mkUpstream({ playerBlocked: true });
    const app3 = appOf(APP, winOf(blocked));
    const tv3 = app3.annualTwoVersions(revOf(blocked), {});
    assert.equal(tv3.player, null);
    assert.equal(app3.annualVersionsLine(tv3).indexOf('不回退作者版') >= 0, true);
});
test('C4 阅读进度键：0 是合法值 / 读不出不编 0 / 非法输入不抹掉已记的进度 / 键已登记', () => {
    const app = appOf(APP, winOf(mkUpstream()));
    assert.equal(app.annualReadThrough(), null, '★ 没记过必须是 null（0 是「读到第 0 章」这个真读数）');
    assert.deepEqual(app.setAnnualReadThrough(0), { ok: true, readThrough: 0 });
    assert.equal(app.annualReadThrough(), 0);
    assert.equal(app.setAnnualReadThrough(-1).ok, false);
    assert.equal(app.setAnnualReadThrough('x').ok, false);
    assert.equal(app.setAnnualReadThrough(NaN).ok, false);
    assert.equal(app.annualReadThrough(), 0, '★ 非法输入不得把已记的进度抹掉');
    assert.deepEqual(app.setAnnualReadThrough(2.7), { ok: true, readThrough: 2 });
    assert.equal(app.storage.get('ruby_reading_annual_readthrough', null), '2');
    /* 键名逐字常量在 App 顶部（keys 门抽取器认这一形态），且两处登记都在。 */
    assert.ok(appSrc.indexOf("const READING_ANNUAL_PROGRESS_KEY = 'ruby_reading_annual_readthrough';") >= 0);
    assert.ok(read('config/storage.js').indexOf('ruby_reading_annual_readthrough') >= 0, '会话隔离键必须登记');
    assert.ok(read('scripts/keys-audit.mjs').indexOf('ruby_reading_annual_readthrough') >= 0);
});
test('C5 视图默认给阅读版：作者全知版必须显式切，且阅读版版面上不出现未读章标题', () => {
    const app = appOf(APP, winOf(mkUpstream()));
    const view = new VIEW.ReadingView(app);
    assert.equal(view._annualVersion, 'player', '★ 默认阅读版（作者版含未了事项，不得当默认）');
    app.setAnnualReadThrough(1);
    const shown = view._annualShown();
    assert.equal(shown.cut.lockedCount, 2);
    assert.equal(shown.cut.readThrough, 1);
    assert.equal(shown.chapters[2].locked, true);
    view.setAnnualVersion('authorial');
    const full = view._annualShown();
    assert.equal(full.cut, null, '作者版不裁');
    assert.equal(full.chapters.length, 3);
    assert.equal(full.chapters[2].title, '揭底');
    view.setAnnualVersion('player');
    assert.equal(view._annualShown().chapters[2].locked, true);
    const html = view._annualHtml('');
    assert.equal(html.indexOf('第 3 章（未读）') >= 0, true);
    assert.equal(html.indexOf('读到这一章后再看') >= 0, true);
    assert.equal(html.indexOf('揭底'), -1, '★ 阅读版版面上不得出现未读章的标题');
    assert.equal(html.indexOf('试探'), -1);
    assert.equal(html.indexOf('ch1#event@2') >= 0, true, '已读章的关键事件要带得出回源凭证');
    /* 切版按钮与进度输入都有事件落点（不留下点不动的按钮）。 */
    for (const sel of ['[data-annual-ver]', '[data-annual-edit]', '[data-annual-save]', '[data-annual-cancel]', '#rd-annual-set', '#rd-annual-refresh', '#rd-annual-export']) {
        assert.ok(viewSrc.indexOf(sel) >= 0, '按钮必须有事件落点：' + sel);
    }
});
test('C6 视图导出：返回文本（无宿主 DOM 也不抛、不假装成空文件），作者版与阅读版各标各的', () => {
    const app = appOf(APP, winOf(mkUpstream()));
    app.setAnnualReadThrough(1);
    const view = new VIEW.ReadingView(app);
    const text = view.exportAnnual();
    assert.equal(text.length > 0, true);
    assert.equal(text.indexOf('（按当前进度阅读版）') >= 0, true);
    assert.equal(text.indexOf('乙独自去了旧仓库'), -1);
    assert.equal(view._annualLine.indexOf('离线可读') >= 0, true);
    view.setAnnualVersion('authorial');
    const full = view.exportAnnual();
    assert.equal(full.indexOf('（作者全知版）') >= 0, true);
    assert.equal(full.indexOf('丙的真实身份曝光') >= 0, true, '作者版含全部三章');
    /* 视图只调 App 的导出出口，自己不算一份文本。 */
    assert.equal(countOf(viewSrc, 'coverOf('), 0);
    assert.equal(countOf(viewSrc, 'tocOf('), 0);
});
test('C7 视图改章题：只走上游编辑口，改的是题、事实位被拒原样显示', () => {
    let msg = '';
    const app = appOf(APP, winOf(mkUpstream()), { showNotification: (_t, m) => { msg = m; }, screen: null });
    const view = new VIEW.ReadingView(app);
    view._annualEditDraft = '新的章题';
    const r = view.saveAnnualTitle(1);
    assert.equal(r.ok, true);
    assert.deepEqual(r.changed, ['title']);
    assert.equal(r.next.title, '新的章题');
    assert.equal(r.next.chapter, 1, '章号只是位置，不是事实位，原样留着');
    assert.equal(msg.indexOf('章题已改') >= 0, true);
    assert.equal(view._annualEditNo, null, '存完就收草稿');
    assert.equal(view._annualEditDraft, '');
    /* 事实位塞进补丁：逐条被拒，且不流传。 */
    const bad = app.annualEdit({ title: 'x' }, { title: 'y', facts: '伪造', floorFrom: 1 });
    assert.deepEqual(bad.changed, ['title']);
    assert.equal(bad.rejected.length, 2);
    assert.equal(bad.next.facts, undefined);
});
test('C8 过期核对：真 App 走一遍原稿改动 ⇒ 需重建；判不了时不许说成「全都新鲜」', () => {
    const up = mkUpstream();
    let msg = '';
    const app = appOf(APP, winOf(up), { showNotification: (_t, m) => { msg = m; }, screen: null });
    const view = new VIEW.ReadingView(app);
    view._annualOf();
    const clean = view.checkAnnualStale(mkPayload());
    assert.equal(clean.needRebuild, false);
    assert.equal(msg.indexOf('没有段过期') >= 0, true);
    const p2 = mkPayload();
    p2.chapters[1].events[0].text = '乙独自去了旧仓库（改过）';
    const dirty = view.checkAnnualStale(p2);
    assert.equal(dirty.needRebuild, true);
    assert.equal(dirty.staleRefs[0].ref, 'ch2#event@9');
    assert.equal(msg.indexOf('相关段需重建') >= 0, true);
    const un = view.checkAnnualStale(null);
    assert.equal(un.judged, false);
    assert.equal(msg.indexOf('不假装成「全都新鲜」') >= 0, true);
});
test('C9 换会话作废年鉴现场（章册缓存 / 选中的版 / 编辑草稿 / 过期读数都指着上一会话）', () => {
    const app = appOf(APP, winOf(mkUpstream()));
    const view = app.view;
    view._annualOf();
    assert.notEqual(view._annualBook, null);
    view._annualEditNo = 2;
    view._annualEditDraft = '半截草稿';
    view._annualLine = '旧读数';
    view._annualStale = { needRebuild: true };
    app.onChatChanged();
    assert.equal(view._annualBook, null, '★ 章册缓存必须作废');
    assert.equal(view._annualEditNo, null);
    assert.equal(view._annualEditDraft, '');
    assert.equal(view._annualLine, '');
    assert.equal(view._annualStale, null);
    assert.equal(view._annualVersion, 'player', '版选回默认阅读版');
});
test('C10 创作台只取材不写事实：取稿不落盘 / 不发布 / 不加新按钮，只多一行读数', () => {
    const storage = mkStorage();
    const cd = new CD.CreationdeskApp({ showNotification: () => {}, screen: null }, storage);
    cd._hostWin = () => winOf(mkUpstream());
    const before = Array.from(storage._mem.keys()).sort();
    const m = cd.annualDraftMaterial({ readThrough: 1, bookTitle: '故事年鉴' });
    assert.equal(m.ok, true);
    assert.equal(m.text.indexOf('甲在门口遇见了乙') >= 0, true);
    assert.equal(m.text.indexOf('乙独自去了旧仓库'), -1, '★ 按进度裁：未读章不进稿');
    assert.equal(m.line.indexOf('3 章') >= 0, true);
    assert.deepEqual(Array.from(storage._mem.keys()).sort(), before, '★ 取稿不得写任何键');
    assert.equal(cd.annualFace().outlet, O.FULL);
    assert.equal(cd.annualLine().indexOf('3 章') >= 0, true);
    /* 未接插件时如实报「读不到」，不编一份空稿。 */
    cd._hostWin = () => ({});
    const none = cd.annualDraftMaterial({});
    assert.equal(none.ok, false);
    assert.equal(none.text, '');
    assert.equal(none.line.indexOf('插件不在场') >= 0, true);
    /* 视图只多一行读数（不新建 App、不新建入口）。 */
    assert.ok(cdAppSrc.indexOf('annualText: this.annualLine()') >= 0);
    assert.ok(cdViewSrc.indexOf('vm.annualText') >= 0);
    assert.equal(countOf(cdAppSrc, 'fetch('), 0, '不自动外网发布');
    assert.equal(countOf(cdAppSrc, 'createObjectURL'), 0, '创作台侧不另开一条下载路');
});
/* ══════════ D ── 负控制（真源码破坏 ⇒ 同一判据必转红） ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4250_'));
    temps.push(dir);
    /* 只镜像判据真正碰到的两棵子树（apps 侧只取阅读与创作台两个 App）。 */
    copyTreeSafe(path.join(ROOT, 'apps', 'reading'), path.join(dir, 'apps', 'reading'));
    copyTreeSafe(path.join(ROOT, 'apps', 'creationdesk'), path.join(dir, 'apps', 'creationdesk'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
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
async function loadKernel(dir, tag) {
    return await import(pathToFileURL(path.join(dir, KERNEL_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadApp(dir, tag) {
    return await import(pathToFileURL(path.join(dir, APP_REL)).href + '?' + tag + '=' + Date.now());
}
async function loadView(dir, tag) {
    return await import(pathToFileURL(path.join(dir, VIEW_REL)).href + '?' + tag + '=' + Date.now());
}
test('D0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真（否则 D 组是假绿）', () => {
    const b = K.readAnnualBuild(winOf(mkUpstream()), null, {});
    const v = K.readingVersionOf(b.chapters, { readThrough: 1 });
    assert.equal(v.chapters[2].title, '', '原版：未读章清空');
    assert.equal(K.readAnnualBuild(winOf(mkUpstream({ payload: null })), null, {}).state, S.UNCHECKED, '原版：未判单独一格');
    const blocked = mkUpstream({ playerBlocked: true });
    assert.equal(K.readAnnualTwoVersions(winOf(blocked), revOf(blocked), {}).player, null, '原版：玩家版不兜底');
    assert.equal(K.readAnnualEdit(winOf(mkUpstream()), {}, { facts: 'x' }).rejected.length, 1, '原版：事实位被拒');
    assert.equal(K.readAnnualStale(winOf(mkUpstream()), b.rawChapters, mkPayload()).needRebuild, false, '原版：没变不提示');
    assert.equal(K.readAnnualStale(winOf(mkUpstream()), b.rawChapters, null).judged, false, '原版：判不了单独一格');
    assert.equal(K.coverOf(v, {}).readCount, 1, '原版：封面只从已读章取');
    assert.equal(K.tocOf(v)[1].label, '第 2 章（未读）', '原版：目录未读行固定文案');
    assert.equal(K.exportTextOf(v, {}).indexOf('ch1#event@2') >= 0, true, '原版：导出带回源凭证');
    const app = appOf(APP, winOf(mkUpstream()));
    const view = app.view;
    view._annualOf();
    view._annualLine = 'x';
    app.onChatChanged();
    assert.equal(view._annualBook, null, '原版：换会话作废现场');
});
test('D1 ★★★ 破坏「未读章清空」⇒ B8 同款判据必转红（秘密从标题与摘要漏出）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "                title: '', summary: '', volumeLabel: '', projectLabel: '',",
        '                title: ch.title, summary: ch.summary, volumeLabel: ch.volumeLabel, projectLabel: ch.projectLabel,');
    const M = await loadKernel(dir, 'd1');
    const b = M.readAnnualBuild(winOf(mkUpstream()), null, {});
    const v = M.readingVersionOf(b.chapters, { readThrough: 1 });
    assert.equal(v.lockedCount, 2, '破坏副本：章照样被标未读（转红不是因为这条）');
    assert.equal(v.chapters[2].title, '揭底',
        '★★★ 破坏副本：未读章的标题没清 ⇒ 读者还没读到就看见了下一章的题与述（不报错，只是剧透）');
    assert.equal(v.chapters[2].summary, '秘密被揭开');
    assert.equal(K.readingVersionOf(K.readAnnualBuild(winOf(mkUpstream()), null, {}).chapters, { readThrough: 1 }).chapters[2].title, '', '原版必须清空');
});
test('D2 ★★★ 破坏「未判单独一格」⇒ B1 同款判据必转红（没拿到结构被读成没有章）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '        if (!checked) state = SA_FACE_STATES.UNCHECKED;',
        '        if (!checked) state = SA_FACE_STATES.EMPTY;');
    const M = await loadKernel(dir, 'd2');
    const b = M.readAnnualBuild(winOf(mkUpstream({ payload: null })), null, {});
    assert.equal(b.chaptersChecked, false, '破坏副本：未判这个事实还在');
    assert.equal(b.state, M.SA_FACE_STATES.EMPTY,
        '★★★ 破坏副本：未判与「确实没有章」同形 ⇒ 用户以为这一会话没故事，其实只是没读到');
    assert.equal(K.readAnnualBuild(winOf(mkUpstream({ payload: null })), null, {}).state, S.UNCHECKED, '原版必须单独一格');
});
test('D3 ★★★ 破坏「玩家版不兜底」⇒ B4 同款判据必转红（去剧透没成立也把作者面交出去）', async () => {
    const dir = breakCopy(KERNEL_REL,
        '                player = (fp && fp.version && typeof fp.version === \'object\') ? fp.version : null;',
        '                player = (fp && fp.version && typeof fp.version === \'object\') ? fp.version : authorial;');
    const M = await loadKernel(dir, 'd3');
    const up = mkUpstream({ playerBlocked: true });
    const tv = M.readAnnualTwoVersions(winOf(up), revOf(up), {});
    assert.equal(tv.playerOk, false, '破坏副本：上游仍然说「不给」');
    assert.notEqual(tv.player, null,
        '★★★ 破坏副本：玩家版位置被作者版顶上 ⇒ 界面会把全知面当阅读版给出去（直接剧透）');
    assert.equal(tv.player.elements.unfinished.length, 1);
    const up0 = mkUpstream({ playerBlocked: true });
    assert.equal(K.readAnnualTwoVersions(winOf(up0), revOf(up0), {}).player, null, '原版必须给 null');
});
test('D4 ★★★ 破坏「事实位拒收如实搬运」⇒ B5 同款判据必转红（用户以为改成了）', async () => {
    const dir = breakCopy(KERNEL_REL, '            rejected: arr(r.rejected).map(function (x) {', '            rejected: arr([]).map(function (x) {');
    const M = await loadKernel(dir, 'd4');
    const r = M.readAnnualEdit(winOf(mkUpstream()), { title: '旧题' }, { title: '新题', facts: '伪造' });
    assert.deepEqual(r.changed, ['title'], '破坏副本：能改的照样改');
    assert.deepEqual(r.rejected, [],
        '★★★ 破坏副本：被拒字段不显示 ⇒ 用户以为「事实也一起改了」，而事实其实没动（改稿的边界消失）');
    assert.equal(K.readAnnualEdit(winOf(mkUpstream()), { title: '旧题' }, { title: '新题', facts: '伪造' }).rejected.length, 1, '原版必须逐条报');
});
test('D5 ★★★ 破坏「过期需重建」⇒ B6 同款判据必转红（正文改了却不提示）', async () => {
    const dir = breakCopy(KERNEL_REL, '            needRebuild: (stale + missing) > 0', '            needRebuild: false');
    const M = await loadKernel(dir, 'd5');
    const up = mkUpstream();
    const b = M.readAnnualBuild(winOf(up), null, {});
    const p2 = mkPayload();
    p2.chapters[0].events[0].text = '甲在门口遇见了乙（改过）';
    const r = M.readAnnualStale(winOf(up), b.rawChapters, p2);
    assert.equal(r.stale, 1, '破坏副本：过期这件事还判出来了');
    assert.equal(r.needRebuild, false,
        '★★★ 破坏副本：过期不再提示 ⇒ 用户改完正文，年鉴里那一段照旧显示（回源凭证已对不上）');
    assert.equal(K.readAnnualStale(winOf(mkUpstream()), b.rawChapters, p2).needRebuild, true, '原版必须提示');
});
test('D6 ★★★ 破坏「判不了 ≠ 全都新鲜」⇒ B6/C8 同款判据必转红（没比也报原稿未变）', async () => {
    const dir = breakCopy(KERNEL_REL, '        const judged = why.length === 0;', '        const judged = true;');
    const M = await loadKernel(dir, 'd6');
    const up = mkUpstream();
    const b = M.readAnnualBuild(winOf(up), null, {});
    const un = M.readAnnualStale(winOf(up), b.rawChapters, null);
    assert.equal(un.needRebuild, false, '破坏副本：没比当然不提示');
    assert.equal(un.judged, true,
        '★★★ 破坏副本：判不了被当成「已判」⇒ 界面会说「没有段过期（原稿未变）」，而其实一条都没比');
    assert.equal(K.readAnnualStale(winOf(mkUpstream()), b.rawChapters, null).judged, false, '原版必须分开');
});
test('D7 ★★★ 破坏「封面只从已读章取」⇒ B9 同款判据必转红（未读章被算成已读）', async () => {
    const dir = breakCopy(KERNEL_REL, '    const read = list.filter(function (c) { return !c.locked; });', '    const read = list.filter(function (c) { return true; });');
    const M = await loadKernel(dir, 'd7');
    const b = M.readAnnualBuild(winOf(mkUpstream()), null, {});
    const v = M.readingVersionOf(b.chapters, { readThrough: 1 });
    const cov = M.coverOf(v, { bookTitle: '故事年鉴' });
    assert.equal(cov.lockedCount, 2, '破坏副本：未读这件事还标着（转红不是因为这条）');
    assert.equal(cov.readCount, 3,
        '★★★ 破坏副本：封面把未读章算成已读 ⇒ 用户以为整本都看过了（进度读数失真）');
    /* 四要素计数**看不出**这条破坏：未读章在裁的那一步就把 elements 清成 null 了
     *   （两道防线各自成立）—— 所以「已读章数」才是这条的判据，本行如实记下这一点。 */
    assert.equal(cov.totals.events, 1, '破坏副本：未读章的四要素早已被清空，故计数看不出来');
    /* 版面上还会自相矛盾（已读 3 章却说还有 2 章未读）—— 用户看到的就是这句。 */
    assert.equal(cov.text.indexOf('已读 3 章') >= 0 && cov.text.indexOf('还有 2 章未读') >= 0, true,
        '破坏副本：封面一句话里自相矛盾（3 + 2 > 3 章）');
    assert.equal(K.coverOf(K.readingVersionOf(b.chapters, { readThrough: 1 }), {}).readCount, 1, '原版必须只算已读');
});
test('D8 ★★★ 破坏「目录未读行固定文案」⇒ B9 同款判据必转红（未读与空章同形）', async () => {
    const dir = breakCopy(KERNEL_REL,
        "        if (c && c.locked) return { no: no, label: '第 ' + String(no) + ' 章（未读）', locked: true };",
        "        if (c && c.locked) return { no: no, label: txt(c.title) || ('第 ' + String(no) + ' 章'), locked: true };");
    const M = await loadKernel(dir, 'd8');
    const b = M.readAnnualBuild(winOf(mkUpstream()), null, {});
    const toc = M.tocOf(M.readingVersionOf(b.chapters, { readThrough: 1 }));
    assert.equal(toc[1].locked, true, '破坏副本：未读这件事还标着');
    assert.equal(toc[1].label,
        '第 2 章',
        '★★★ 破坏副本：未读行不再说「未读」⇒ 读者分不清「这一章按进度还不能看」与「这一章是空的」');
    assert.equal(K.tocOf(K.readingVersionOf(b.chapters, { readThrough: 1 }))[1].label, '第 2 章（未读）', '原版必须说清');
});
test('D9 ★★★ 破坏「导出带回源凭证」⇒ B9/C3 同款判据必转红（离线稿回不了源）', async () => {
    const dir = breakCopy(KERNEL_REL, '                const rf = txt(it && it.evidenceRef);', "                const rf = '';");
    const M = await loadKernel(dir, 'd9');
    const b = M.readAnnualBuild(winOf(mkUpstream()), null, {});
    const out = M.exportTextOf(M.readingVersionOf(b.chapters, { readThrough: 1 }), { bookTitle: '故事年鉴' });
    assert.equal(out.indexOf('甲在门口遇见了乙') >= 0, true, '破坏副本：正文还在（转红不是因为这条）');
    assert.equal(out.indexOf('ch1#event@2'),
        -1,
        '★★★ 破坏副本：导出不再带逐条回源凭证 ⇒ 验收第一条「每条关键事件可回源」在离线文件里落空');
    assert.equal(K.exportTextOf(K.readingVersionOf(b.chapters, { readThrough: 1 }), {}).indexOf('ch1#event@2') >= 0, true, '原版必须带');
});
test('D10 ★★★ 破坏「换会话作废年鉴现场」⇒ C9 同款判据必转红（旧读数画进新会话）', async () => {
    const anchor = [
        '        this._annualBook = null;',
        "        this._annualEditNo = null;",
        "        this._annualEditDraft = '';",
        "        this._annualLine = '';",
        '        this._annualStale = null;',
        '        if (this.app.phoneShell?.screen) this.render();'
    ].join(String.fromCharCode(10));
    const dir = breakCopy(VIEW_REL, anchor, '        void 0;');
    const m = await loadApp(dir, 'd10');
    const Vm = await loadView(dir, 'd10v');
    const app = appOf(m, winOf(mkUpstream()));
    const view = new Vm.ReadingView(app);
    view._annualOf();
    view._annualEditDraft = '半截草稿';
    view._annualLine = '旧读数';
    app.onChatChanged();
    assert.equal(view._annualEditDraft, '半截草稿',
        '★★★ 破坏副本：换会话不作废 ⇒ 新会话首屏画着上一会话的章册读数与半截草稿（不报错，只是错数据）');
    assert.equal(view._annualBook !== null, true);
    const app0 = appOf(APP, winOf(mkUpstream()));
    const v0 = app0.view;
    v0._annualOf();
    v0._annualEditDraft = '半截草稿';
    app0.onChatChanged();
    assert.equal(v0._annualEditDraft, '', '原版必须作废');
    assert.equal(v0._annualBook, null);
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
    assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0, 'ITERATION_LOG 必须记这一版');
});
