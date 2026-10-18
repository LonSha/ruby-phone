/* ============================================================
 * config/story-annual-contract.js — [v4.25.0 · 第四期 R4-X3 可阅读、可编辑的故事年鉴]
 * ------------------------------------------------------------
 * 【本件是纯契约：只搬上游读数、只排人读面，零 DOM 零存储零联网零时钟】
 *   上游 story-annual.js(M3-X7 + M4-X2) 已实现：按章提取四要素 / 两版可分 /
 *   编辑草稿不反写事实 / 原文改动指出对应段过期 / 成稿面；八个 storyAnnual* 出口
 *   在 `window.LonShaMemory` 上齐全。手机侧此前**零消费**（读码可复算：
 *   `grep -RIn 'storyAnnual' apps config` 零命中）—— 本件补的正是这一格：
 *   「从真实会话生成三章年鉴，按卷章读发生什么、人物怎样变化、留下哪些问题、
 *     值得记住的原话；编辑文稿、导出本地可读文件」（计划 R4-X3 原文）。
 *
 * 【跨仓分工（计划 audit 原文）】上游持有事实、来源、时态与确认写入；
 *   手机持有交互、文稿与本地阅读。故本件**不自己判秘密**：去剧透一律经上游
 *   `storyAnnualForPlayer`（它的 gate 由宿主 `_o9Gate()` 装配）；手机只做两件
 *   上游没有的事 ——
 *     ① **按当前进度裁阅读版**（进度是本机 rd 概念）：读到第几章，其后的章
 *        在封面 / 目录 / 导出文本里一律只留占位，正文与摘要**不出现**；
 *     ② **封面与目录摘要不得含未读章的痕迹**（验收原文点名的最后一格）。
 *
 * 【四条不可让步的口径（本面的全部价值在这里）】
 *   1 **未判 ≠ 没有**：`build` 无 chapters ⇒ `chaptersChecked:false`（章面未判），
 *     不报「没有章节」；`forPlayer` 去剧透未成立 ⇒ `ok:false`，**绝不回退作者版**
 *     （把作者面当兜底正是直接剧透，上游 M4-O9 治过多轮）。
 *   2 **草稿 ≠ 事实**：编辑只走上游 `edit`/`applyEdits`，事实位一律被拒（`draft-only`）；
 *     手机**不自己判哪些字段是事实**，只如实搬上游的 `changed`/`rejected`。
 *   3 **截断 ≠ 空**：封面 / 目录 / 导出里「未读章」与「空章」不同形 —— 前者是
 *     进度挡住的（可解锁），后者是这一章确实没内容。
 *   4 **成稿 ≠ 过模型**：`compose` 未给 `polish`（真模型）⇒ `structure-only` 且
 *     `styleChecked:false`，本件不许把它读成「文风通过」。
 *
 * 【为什么另立一套面状态】五格基座与 lore-import 同形，但本面多一格 `locked`
 *   （读出来了，但这一章按当前进度**不能给你看**）—— 复用要去改那套词表，会波及无关面。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
/** 面状态六格（三对**不同形**：未判≠没有 / 被进度挡住≠真没内容 / 没有这一面≠插件不在场）。 */
export const SA_FACE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',   // 插件不在场：没有年鉴这回事
    FACE_ABSENT: 'face-absent',       // 插件在场但没有年鉴面（旧版）：如实说
    UNUSABLE: 'unusable',             // 出口在、调用抛错或回执畸形：本机读不出
    UNCHECKED: 'unchecked',           // 章面**未判**（上游没拿到卷章结构）—— 不等于「没有章」
    LOCKED: 'locked',                 // 读出来了，但按当前进度这一章暂不能看
    EMPTY: 'empty',                   // 读了，确实没有章（真读数）
    OK: 'ok'
});
/** 派发相：有编辑口走完整旅程；只有读口则**只能读不能改**（必须当面说清）。 */
export const SA_OUTLETS = Object.freeze({
    FULL: 'build+edit',       // 建章册 + 编辑草稿都在
    READ_ONLY: 'read-only',   // 只能读，改不了（旧版插件）
    NONE: 'none'
});
/** 两版（**不得合流**）：作者全知版 / 按当前进度阅读版。 */
export const SA_VERSIONS = Object.freeze({
    AUTHOR: 'authorial',      // 作者全知版：含全部人物线与未了事项，不得直接给玩家
    PLAYER: 'player'          // 按当前进度 + 事实可知性裁剪后的阅读版
});
export const SA_LIMITS = Object.freeze({
    chapters: 40,    // 章册最多渲染几章（再多只是把浏览器拖慢）
    items: 60,       // 单章四要素最多渲染几条
    snippet: 90,     // 转为本地可读文件时，每条文本的截断上限
    coverChars: 200  // 封面摘要上限
});
const PLUGIN_GLOBAL = 'LonShaMemory';
/** 上游出口名（**只在本件出现**：两处写名字，上游改名时必有一处悄悄落空）。 */
const SA_OUTLET_NAMES = Object.freeze({
    build: 'storyAnnualBuild',
    review: 'storyAnnualReview',
    twoVersions: 'storyAnnualTwoVersions',
    forPlayer: 'storyAnnualForPlayer',
    edit: 'storyAnnualEdit',
    applyEdits: 'storyAnnualApplyEdits',
    stale: 'storyAnnualStale',
    compose: 'storyAnnualCompose',
    composePlayer: 'storyAnnualComposeForPlayer',
    drafts: 'storyAnnualDrafts',
});
function winOf(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}
/** 安全取上游插件实例（宿主怪异 getter 一律降级成 null，绝不外抛）。 */
function pluginOf(win) {
    try {
        const w = winOf(win);
        if (!w) return null;
        const p = w[PLUGIN_GLOBAL];
        return (p && typeof p === 'object') ? p : null;
    } catch (_e) { return null; }
}
function txt(v) { return String(v == null ? '' : v).trim(); }
function raw(v) { return String(v == null ? '' : v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function bool(v) { return v === true; }
/** 归一取数：走全仓唯一取数门（`num-gate`），取不到再回落默认值（强形态，不编 0）。 */
function readNum(v, d) {
    const n = numOrNull(v);
    return n === null ? d : n;
}
/** 出口探测（**只认函数出口，不认自述**）。 */
export function saOutletProbe(win) {
    const p = pluginOf(win);
    const has = function (name) {
        try { return !!(p && typeof p[name] === 'function'); } catch (_e) { return false; }
    };
    return {
        present: !!p,
        hasBuild: has(SA_OUTLET_NAMES.build),
        hasEdit: has(SA_OUTLET_NAMES.edit) || has(SA_OUTLET_NAMES.applyEdits)
    };
}
/** 派发相：严格判 true（宽松判会把 1 / 'yes' 读成「有出口」，用户会点到走不通的按钮）。 */
export function planSaOutlet(hasBuild, hasEdit) {
    if (hasBuild !== true) return SA_OUTLETS.NONE;
    if (hasEdit === true) return SA_OUTLETS.FULL;
    return SA_OUTLETS.READ_ONLY;
}
/* ────────────────────────── ① 章册归一 ────────────────────────── */
/** 缺席形态的恒定键面（读者不必再判 undefined）。 */
function blankBook(reason, state) {
    return {
        state: state || SA_FACE_STATES.UNUSABLE, faceReason: reason,
        ok: false, kind: 'story_annual', chaptersChecked: false,
        chapters: [], counts: { events: 0, changes: 0, unfinished: 0, quotes: 0 }, why: []
    };
}
/** 一章的四要素（穷尽；缺一栏就给空栏，不省键）。 */
function elementsOf(src) {
    const s = (src && typeof src === 'object') ? src : {};
    const els = (s.elements && typeof s.elements === 'object') ? s.elements : s;
    return {
        events: arr(els.events).slice(0, SA_LIMITS.items),
        changes: arr(els.changes).slice(0, SA_LIMITS.items),
        unfinished: arr(els.unfinished).slice(0, SA_LIMITS.items),
        quotes: arr(els.quotes).slice(0, SA_LIMITS.items)
    };
}
/** 一章归一（ref 的章号、层号、卷号一律如实搬运，不自己拼不自己算）。 */
function chapterOf(rawCh, i) {
    const c = (rawCh && typeof rawCh === 'object') ? rawCh : {};
    const ref = (c.ref && typeof c.ref === 'object') ? c.ref : {};
    const no = readNum(ref.chapter, i + 1);
    return {
        no: no, index: i,
        volumeLabel: txt(ref.volume), projectLabel: txt(ref.project),
        title: txt(c.title),
        summary: raw(c.summary),
        floorFrom: readNum(c.floorFrom, 0), floorTo: readNum(c.floorTo, 0),
        elements: elementsOf(c),
        evidence: arr(c.evidence).map(function (e) {
            const x = (e && typeof e === 'object') ? e : {};
            return { kind: txt(x.kind), floor: readNum(x.floor, 0), ref: txt(x.ref), hash: txt(x.hash) };
        }),
        evidenceCount: arr(c.evidence).length
    };
}
/**
 * 建章册（**只读**；未给 chapters ⇒ 章面未判，不报「没有章节」）。
 * @returns {object} 与上游 build 回执同形（多一层归一后的 chapters）
 */
export function readAnnualBuild(win, payload, opts) {
    const p = pluginOf(win);
    if (!p) return blankBook('plugin-absent', SA_FACE_STATES.ENGINE_ABSENT);
    if (typeof p.storyAnnualBuild !== 'function') {
        return blankBook('face-absent', SA_FACE_STATES.FACE_ABSENT);
    }
    try {
        const r = p.storyAnnualBuild(payload, opts || {});
        if (!r || typeof r !== 'object') return blankBook('malformed', SA_FACE_STATES.UNUSABLE);
        const list = arr(r.chapters).slice(0, SA_LIMITS.chapters).map(chapterOf);
        const checked = bool(r.chaptersChecked);
        const counts = (r.counts && typeof r.counts === 'object') ? r.counts : {};
        const why = arr(r.why).map(txt).filter(Boolean);
        /* ★ `chaptersChecked:false` 是**章面未判**（上游没拿到卷章结构），不是「没有章节」。
         *   未判**单独占一格**：写成 `empty` 就是把「没拿到结构」读成「确实没有章」——
         *   本仓治过多次的那类静默错读（用户会以为这一会话没故事，而其实只是没读到）。 */
        let state = SA_FACE_STATES.UNUSABLE;
        if (!checked) state = SA_FACE_STATES.UNCHECKED;
        else if (list.length) state = SA_FACE_STATES.OK;
        else state = SA_FACE_STATES.EMPTY;
        return {
            state: state, faceReason: checked ? (list.length ? 'ok' : 'no-chapters') : 'chapters-absent',
            ok: bool(r.ok), kind: 'story_annual', chaptersChecked: checked,
            chapters: list,
            /* ★ **上游原形章册**原样带走一份：过期判定（`staleRefs`）吃的是原形载荷
             *   （它按 `events`/`changes`/`open`/`quotes` 现算证据位），而归一后的章册是
             *   `elements.*` 形状 —— 拿归一形去比对，证据位一条都算不出来，结果是
             *   「全都新鲜」这种**静默假通过**。本件不自己重算指纹，只把原形转交。 */
            rawChapters: arr(r.chapters),
            counts: {
                events: readNum(counts.events, 0), changes: readNum(counts.changes, 0),
                unfinished: readNum(counts.unfinished, 0), quotes: readNum(counts.quotes, 0)
            }, why: why
        };
    } catch (_e) { return blankBook('thrown', SA_FACE_STATES.UNUSABLE); }
}
/* ────────────────────────── ② 两版（作者 / 阅读） ────────────────────────── */
/**
 * 两版归一（**不得合流**）。玩家版一律走上游 `storyAnnualForPlayer`（它自带铁律：
 *   去剧透未成立就 `ok:false`、**绝不回退作者版**）；作者版取 `twoVersions` 的全知面。
 */
export function readAnnualTwoVersions(win, rev, opts) {
    const p = pluginOf(win);
    const empty = {
        state: SA_FACE_STATES.UNUSABLE, faceReason: 'plugin-absent',
        ok: false, gated: false, authorial: null, player: null,
        playerOk: false, playerReason: '', leakedChars: [], versionsDistinct: false, why: []
    };
    if (!p) return empty;
    if (typeof p.storyAnnualTwoVersions !== 'function') {
        return Object.assign({}, empty, { state: SA_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    }
    try {
        const r = p.storyAnnualTwoVersions(rev, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { faceReason: 'malformed' });
        const authorial = (r.authorial && typeof r.authorial === 'object') ? r.authorial : null;
        const gated = bool(r.gated);
        let player = null;
        let playerOk = false;
        let playerReason = '';
        /* ★ 玩家版走**同一上游出口** forPlayer：它不拿 twoVersions 的 spoilerFree 兜底，
         *   而是自己再判一次「去剧透是否成立」——本件不替它判。 */
        if (typeof p.storyAnnualForPlayer === 'function') {
            try {
                const fp = p.storyAnnualForPlayer(rev, opts || {});
                playerOk = bool(fp && fp.ok);
                playerReason = txt(fp && fp.reason);
                player = (fp && fp.version && typeof fp.version === 'object') ? fp.version : null;
            } catch (_e) { playerOk = false; playerReason = 'thrown'; player = null; }
        } else { playerReason = 'face-absent'; }
        return {
            state: SA_FACE_STATES.OK, faceReason: gated ? 'gated' : 'no-gate',
            ok: !!authorial, gated: gated, authorial: authorial, player: player,
            playerOk: playerOk, playerReason: playerReason,
            leakedChars: arr(r.leakedChars).map(txt).filter(Boolean),
            versionsDistinct: bool(r.versionsDistinct),
            why: arr(r.why).map(txt).filter(Boolean)
        };
    } catch (_e) { return Object.assign({}, empty, { faceReason: 'thrown' }); }
}
/* ────────────────────────── ③ 编辑草稿（事实位拒） ────────────────────────── */
/**
 * 编辑草稿归一（**手机不判字段**：只搬上游的 changed / rejected）。
 *   上游 `edit`/`applyEdits` 的事实位一律 `draft-only` 拒收 —— 本件如实显示，
 *   不把它改写成「改不动」也不改写「改好了」。
 */
export function readAnnualEdit(win, state, patch) {
    const p = pluginOf(win);
    const empty = { state: SA_FACE_STATES.UNUSABLE, faceReason: 'plugin-absent', ok: false, changed: [], rejected: [], reason: '' };
    if (!p) return empty;
    const fn = (typeof p.storyAnnualApplyEdits === 'function') ? 'storyAnnualApplyEdits'
        : ((typeof p.storyAnnualEdit === 'function') ? 'storyAnnualEdit' : '');
    if (!fn) return Object.assign({}, empty, { state: SA_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = p[fn](state, patch);
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { faceReason: 'malformed' });
        return {
            state: SA_FACE_STATES.OK, faceReason: 'ok', ok: bool(r.ok),
            next: (r.state && typeof r.state === 'object') ? r.state : null,
            changed: arr(r.changed).map(txt).filter(Boolean),
            rejected: arr(r.rejected).map(function (x) {
                const o = (x && typeof x === 'object') ? x : { key: x };
                return { key: txt(o.key), why: txt(o.why), note: txt(o.note) };
            }),
            reason: txt(r.reason)
        };
    } catch (_e) { return Object.assign({}, empty, { faceReason: 'thrown' }); }
}
/* ────────────────────────── ④ 过期判定（原文改动 ⇒ 需重建） ────────────────────────── */
/** 过期判定归一（过期 ≠ 删除：逐条具名 staleRefs）。 */
export function readAnnualStale(win, oldChapters, newPayload) {
    const p = pluginOf(win);
    const empty = { state: SA_FACE_STATES.UNUSABLE, faceReason: 'plugin-absent', judged: false, stale: 0, fresh: 0, missingChapters: 0, staleRefs: [], needRebuild: false };
    if (!p) return empty;
    if (typeof p.storyAnnualStale !== 'function') return Object.assign({}, empty, { state: SA_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = p.storyAnnualStale(oldChapters, newPayload);
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { faceReason: 'malformed' });
        const stale = readNum(r.stale, 0);
        const missing = readNum(r.missingChapters, 0);
        const why = arr(r.why).map(txt).filter(Boolean);
        /* ★ **判不了 ≠ 全都新鲜**：上游把「没拿到旧章册 / 没拿到新载荷」写在 `why` 里
         *   （`no-old-chapters` / `no-new-payload`）—— 那种情形下 `stale` 是 0 只因为**没比**，
         *   若照报「没有段过期」，用户会把「判不了」读成「原稿没变」（本仓同族的静默假通过）。 */
        const judged = why.length === 0;
        return {
            state: judged ? SA_FACE_STATES.OK : SA_FACE_STATES.UNUSABLE,
            faceReason: judged ? 'ok' : (why[0] || 'unjudged'),
            judged: judged,
            stale: stale, fresh: readNum(r.fresh, 0), missingChapters: missing,
            staleRefs: arr(r.staleRefs).map(function (x) {
                const o = (x && typeof x === 'object') ? x : {};
                return { chapter: txt(o.chapter), ref: txt(o.ref), why: txt(o.why) };
            }),
            /* 「需重建」= 有段变了或整章没了（两者都要重建），空数组 ⇒ 不提示。 */
            needRebuild: (stale + missing) > 0
        };
    } catch (_e) { return Object.assign({}, empty, { faceReason: 'thrown' }); }
}
/* ────────────────────────── ⑤ 成稿（未过模型只报结构成稿） ────────────────────────── */
export function readAnnualCompose(win, rev, opts) {
    const p = pluginOf(win);
    const empty = {
        state: SA_FACE_STATES.UNUSABLE, faceReason: 'plugin-absent', ok: false, text: '', sections: 0,
        source: 'structure-only', modelUsed: false, styleChecked: false, styleNote: '',
        evidenceBound: 0, evidenceMissing: 0, evidenceUndecided: 0
    };
    if (!p) return empty;
    if (typeof p.storyAnnualCompose !== 'function') return Object.assign({}, empty, { state: SA_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = p.storyAnnualCompose(rev, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { faceReason: 'malformed' });
        return {
            state: SA_FACE_STATES.OK, faceReason: 'ok', ok: bool(r.ok),
            text: raw(r.text), sections: arr(r.sections).length,
            source: txt(r.source) || 'structure-only',
            modelUsed: bool(r.modelUsed), styleChecked: bool(r.styleChecked), styleNote: txt(r.styleNote),
            evidenceBound: readNum(r.evidenceBound, 0),
            evidenceMissing: readNum(r.evidenceMissing, 0),
            evidenceUndecided: readNum(r.evidenceUndecided, 0)
        };
    } catch (_e) { return Object.assign({}, empty, { faceReason: 'thrown' }); }
}
/* ────────────────────────── ⑥ 按当前进度裁阅读版（本件独有） ────────────────────────── */
/**
 * 按当前进度裁阅读版（**手机侧唯一自持的判定**）。
 *   进度 `readThrough` = 已读到第几章（**章号口径**，与章册 `no` 同源；不自己换算下标）。
 *   读到第 k 章 ⇒ 章号 > k 的章是**未读**：标题 / 摘要 / 四要素 / 证据**一律不上明面**，
 *   只留 `locked:true` 与章号。封面与目录也不例外（验收原文最后一格）。
 * @returns {{ok:boolean, readThrough:number, chapters:Array, lockedCount:number, readCount:number}}
 */
export function readingVersionOf(chapters, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const through = readNum(o.readThrough, 0);
    const list = arr(chapters);
    const out = [];
    let locked = 0;
    for (const c of list) {
        const ch = (c && typeof c === 'object') ? c : {};
        const no = readNum(ch.no, 0);
        /* 进度未给（through 为 null）⇒ **不裁**（宁可言多，不静默藏掉用户自己的文稿）。 */
        const isLocked = (o.readThrough === null || o.readThrough === undefined) ? false : (no > through);
        if (isLocked) {
            locked += 1;
            out.push({
                no: no, index: readNum(ch.index, out.length), locked: true,
                title: '', summary: '', volumeLabel: '', projectLabel: '',
                floorFrom: null, floorTo: null, elements: null, evidence: [], evidenceCount: 0
            });
        } else {
            out.push(Object.assign({}, ch, { locked: false }));
        }
    }
    return { ok: list.length > 0, readThrough: through, chapters: out, lockedCount: locked, readCount: out.length - locked };
}
/**
 * 版归一（**接受两种形态**：`{chapters}` 版对象，或**裸章数组**）。
 *   ★ 为什么必须容忍：调用方把 `cut.chapters`（数组）直接递给封面 / 目录 / 导出是**极自然**的写法，
 *     而数组也是 object ⇒ 旧写法 `v.chapters` 读出 `undefined`，于是封面报「已读 0 章」、
 *     导出只剩一句「离线可读」的**空文件** —— 一个字符都不报错，用户拿到的是空稿。
 *     本仓治过的同族病（形状不对 ⇒ 静默空结果）在这里再治一次：形状只认这两种，其余照旧空。
 */
function verOf(v) {
    if (Array.isArray(v)) return { chapters: v };
    return (v && typeof v === 'object') ? v : { chapters: [] };
}
/**
 * 封面（**只从已读章取**：未读章的标题 / 摘要 / 要素一个都不出现）。
 *   与目录分开两处：封面要的是「读到哪儿了」的一句话，目录要的是逐章导航。
 */
export function coverOf(version, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const v = verOf(version);
    const list = arr(v.chapters);
    const read = list.filter(function (c) { return !c.locked; });
    const locked = list.filter(function (c) { return !!c.locked; });
    const totals = { events: 0, changes: 0, unfinished: 0, quotes: 0 };
    for (const c of read) {
        const e = (c.elements && typeof c.elements === 'object') ? c.elements : {};
        totals.events += arr(e.events).length;
        totals.changes += arr(e.changes).length;
        totals.unfinished += arr(e.unfinished).length;
        totals.quotes += arr(e.quotes).length;
    }
    const title = txt(o.bookTitle) || '故事年鉴';
    let text = '《' + title + '》已读 ' + String(read.length) + ' 章';
    if (locked.length) text += ' · 还有 ' + String(locked.length) + ' 章未读（内容不在这里展开）';
    return {
        title: title, readCount: read.length, lockedCount: locked.length,
        totals: totals, text: text
    };
}
/** 目录（未读章只留章号占位；**标题不出现在未读行**）。 */
export function tocOf(version) {
    const v = verOf(version);
    return arr(v.chapters).map(function (c) {
        const no = readNum(c.no, 0);
        if (c && c.locked) return { no: no, label: '第 ' + String(no) + ' 章（未读）', locked: true };
        return { no: no, label: txt(c.title) || ('第 ' + String(no) + ' 章'), locked: false };
    });
}
/* ────────────────────────── ⑦ 导出本地可读文件 ────────────────────────── */
/**
 * 导出为**离线可读**的纯文本（本地文件；**不联网、不上传**）。
 *   ★ 与 `coverOf`/`tocOf` 同口径：未读章只占位，正文与摘要**不进导出**。
 * @returns {string} 可直接落成 .txt 的文本
 */
export function exportTextOf(version, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const v = verOf(version);
    const list = arr(v.chapters);
    const cover = coverOf(v, opts);
    const lines = [];
    lines.push(cover.text);
    if (txt(o.versionLabel)) lines.push(txt(o.versionLabel));
    lines.push('');
    lines.push('— 目录 —');
    for (const r of tocOf(v)) lines.push('  ' + r.label);
    lines.push('');
    for (const c of list) {
        if (c && c.locked) {
            lines.push('【第 ' + String(readNum(c.no, 0)) + ' 章】未读 —— 内容未展开（读到这一章后再看）');
            lines.push('');
            continue;
        }
        lines.push('【第 ' + String(readNum(c.no, 0)) + ' 章】' + (txt(c.title) || ''));
        if (txt(c.summary)) lines.push(txt(c.summary));
        const e = (c.elements && typeof c.elements === 'object') ? c.elements : {};
        const clip = function (s) {
            const t = raw(s);
            return t.length <= SA_LIMITS.snippet ? t : (t.slice(0, SA_LIMITS.snippet - 1) + '…');
        };
        const block = function (label, items, render) {
            if (!arr(items).length) return;
            lines.push('· ' + label);
            for (const it of arr(items)) {
                /* ★ **回源凭证随文本一起落盘**：离线文件也要能说清「这一条出自哪一楼」。
                 *   只搬不重拼：`evidenceRef` 是上游按章号与楼层算出来的，本件不自己造 id
                 *   （自造 id 的后果是「回源」跳到一个不存在的位置，且不报错）。 */
                const rf = txt(it && it.evidenceRef);
                lines.push('    ' + clip(render(it)) + (rf ? '  〔回源 ' + rf + '〕' : ''));
            }
        };
        block('关键事件', e.events, function (x) { return txt(x && x.text); });
        block('人物变化', e.changes, function (x) {
            const from = txt(x && x.from), to = txt(x && x.to);
            return txt(x && x.char) + (from || to ? '：' + (from || '？') + ' → ' + (to || '？') : '');
        });
        block('未了事项', e.unfinished, function (x) { return txt(x && x.text); });
        block('精选原话', e.quotes, function (x) {
            const sp = txt(x && x.speaker);
            return (sp ? sp + '：' : '') + txt(x && x.text);
        });
        lines.push('');
    }
    lines.push('—— 故事年鉴 · 本地导出（离线可读）');
    return lines.join(String.fromCharCode(10));
}
/* ────────────────────────── ⑧ 一行读数 ────────────────────────── */
/** 章册一行读数（四态分开：未判 / 读不到 / 空 / 有章）。 */
export function bookLine(book) {
    const r = (book && typeof book === 'object') ? book : {};
    if (r.state === SA_FACE_STATES.ENGINE_ABSENT) return '年鉴：插件不在场（装上游记忆插件后才有）';
    if (r.state === SA_FACE_STATES.FACE_ABSENT) return '年鉴：插件在，但这一版没有年鉴面';
    if (r.state === SA_FACE_STATES.UNUSABLE) return '年鉴：读不出来（' + txt(r.faceReason) + '）—— 不是「没有章节」';
    if (r.state === SA_FACE_STATES.UNCHECKED) return '年鉴：章面未判（未拿到卷章结构，不猜章界）—— 不是「没有章节」';
    if (!r.chaptersChecked) return '年鉴：章面未判（未拿到卷章结构，不猜章界）';
    if (!arr(r.chapters).length) return '年鉴：确实没有章';
    const c = r.counts || {};
    return '年鉴：' + String(arr(r.chapters).length) + ' 章 · 关键事件 ' + String(readNum(c.events, 0))
        + ' · 人物变化 ' + String(readNum(c.changes, 0))
        + ' · 未了事项 ' + String(readNum(c.unfinished, 0))
        + ' · 原话 ' + String(readNum(c.quotes, 0));
}
/** 两版一行读数（去剧透未成立时**说清为何不给玩家版**，不假装成作者版）。 */
export function versionsLine(tv) {
    const r = (tv && typeof tv === 'object') ? tv : {};
    if (!r.authorial && !r.gated) return '两版：读不到（' + txt(r.faceReason) + '）';
    const parts = [];
    parts.push(r.gated ? '可知性面在场' : '可知性面缺席（去剧透无法成立）');
    if (r.playerOk) parts.push('阅读版可用');
    else parts.push('阅读版被挡' + (r.playerReason ? '（' + r.playerReason + '）' : '') + ' —— 不回退作者版');
    if (arr(r.leakedChars).length) parts.push('⚠ 泄漏 ' + String(r.leakedChars.length) + ' 人');
    return '两版：' + parts.join(' · ');
}
/** 自检（**真跑判据**，不是数常量）。 */
export function saSelfCheck() {
    const problems = [];
    const states = Object.keys(SA_FACE_STATES).map(function (k) { return SA_FACE_STATES[k]; });
    if (new Set(states).size !== states.length) problems.push('面状态各格必须互不相同');
    if (SA_FACE_STATES.LOCKED === SA_FACE_STATES.EMPTY) problems.push('「被进度挡住」与「真没内容」必须不同形');
    if (SA_FACE_STATES.FACE_ABSENT === SA_FACE_STATES.ENGINE_ABSENT) problems.push('「没有这一面」与「插件不在场」必须不同形');
    /* 一 派发相：严格判 true，三种组合三种结果。 */
    if (planSaOutlet(true, true) !== SA_OUTLETS.FULL) problems.push('读写都在应给完整旅程');
    if (planSaOutlet(true, false) !== SA_OUTLETS.READ_ONLY) problems.push('只有读口应给「只能读不能改」');
    if (planSaOutlet(false, true) !== SA_OUTLETS.NONE) problems.push('没有建章口时编辑口无从谈起');
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        if (planSaOutlet(bad, true) !== SA_OUTLETS.NONE) problems.push('派发相必须严格判 true:' + String(bad));
    }
    const pNone = saOutletProbe(null);
    if (pNone.hasBuild !== false || pNone.hasEdit !== false) problems.push('没有插件时两个探测口都必须是 false');
    const pFull = saOutletProbe({ LonShaMemory: { storyAnnualBuild: function () {}, storyAnnualEdit: function () {} } });
    if (planSaOutlet(pFull.hasBuild, pFull.hasEdit) !== SA_OUTLETS.FULL) problems.push('两面在场时派发相应是完整旅程');
    const pRead = saOutletProbe({ LonShaMemory: { storyAnnualBuild: function () {} } });
    if (planSaOutlet(pRead.hasBuild, pRead.hasEdit) !== SA_OUTLETS.READ_ONLY) problems.push('只有建章口时应是「只能读不能改」');
    /* 二 未判 ≠ 没有。 */
    const notChecked = readAnnualBuild(null, null, {});
    if (notChecked.state !== SA_FACE_STATES.ENGINE_ABSENT) problems.push('没有插件必须报「插件不在场」');
    /* 三 进度裁：未读章的标题 / 摘要 / 要素一个都不能漏出来。 */
    const book = { chapters: [
        { no: 1, title: '甲章', summary: '甲述', elements: { events: [{ text: '甲事' }], changes: [], unfinished: [], quotes: [] }, evidence: [{ ref: 'ch1#event@1' }] },
        { no: 2, title: '乙章', summary: '乙述', elements: { events: [{ text: '乙事' }], changes: [], unfinished: [], quotes: [] }, evidence: [{ ref: 'ch2#event@9' }] }
    ] };
    const v1 = readingVersionOf(book.chapters, { readThrough: 1 });
    if (v1.lockedCount !== 1) problems.push('读到第 1 章时第 2 章必须判未读');
    if (v1.chapters[1].title !== '' || v1.chapters[1].summary !== '' || v1.chapters[1].elements !== null) {
        problems.push('未读章的标题 / 摘要 / 要素必须清空（否则秘密会从这里漏出）');
    }
    if (arr(v1.chapters[1].evidence).length !== 0) problems.push('未读章的证据位必须清空');
    const cov = coverOf(v1, { bookTitle: '书' });
    if (cov.text.indexOf('乙') >= 0) problems.push('封面不得含未读章的痕迹');
    const toc = tocOf(v1);
    if (toc[1].locked !== true || toc[1].label.indexOf('乙') >= 0) problems.push('目录未读行不得含标题');
    const txtOut = exportTextOf(v1, { bookTitle: '书' });
    if (txtOut.indexOf('乙事') >= 0 || txtOut.indexOf('乙述') >= 0) problems.push('导出文本不得含未读章正文 / 摘要');
    if (txtOut.indexOf('甲事') < 0) problems.push('导出文本必须含已读章内容（否则「裁」把整篇都裁没了）');
    /* 三点五 未判 ≠ 没有：**单独一格**，且读数说清。 */
    if (SA_FACE_STATES.UNCHECKED === SA_FACE_STATES.EMPTY) problems.push('「章面未判」与「确实没有章」必须不同形');
    const pUn = { LonShaMemory: {
        storyAnnualBuild: function () {
            return { kind: 'story_annual', ok: false, chapters: [], chaptersChecked: false, counts: {}, why: ['chapters-absent'] };
        }
    } };
    const bUn = readAnnualBuild(pUn, null, {});
    if (bUn.state !== SA_FACE_STATES.UNCHECKED) problems.push('未拿到卷章结构时必须报「章面未判」');
    if (bookLine(bUn).indexOf('章面未判') < 0) problems.push('章面未判的读数必须说清这不是「没有章节」');
    /* 三点六 回源凭证：**原样搬运**，且导出里也带着（离线也要能回源）。 */
    const pOk = { LonShaMemory: {
        storyAnnualBuild: function () {
            return { kind: 'story_annual', ok: true, chaptersChecked: true, counts: { events: 1, changes: 0, unfinished: 0, quotes: 0 },
                chapters: [{ ref: { project: 'p', volume: 'v', chapter: 1 }, title: '甲章', summary: '甲述', floorFrom: 3, floorTo: 5,
                    events: [{ floor: 4, text: '甲事', evidenceRef: 'ch1#event@4' }], changes: [], open: [], quotes: [] }] };
        }
    } };
    const bOk = readAnnualBuild(pOk, null, {});
    if (bOk.state !== SA_FACE_STATES.OK) problems.push('有章时必须报 ok');
    if (txt(arr(bOk.chapters[0].elements.events)[0].evidenceRef) !== 'ch1#event@4') {
        problems.push('回源凭证必须原样搬运（不许自己重拼 id）');
    }
    const vOne = readingVersionOf(bOk.chapters, { readThrough: 1 });
    if (exportTextOf(vOne, { bookTitle: '书' }).indexOf('ch1#event@4') < 0) {
        problems.push('导出必须带每条的回源凭证（离线文件也要能回源）');
    }
    const vZero = readingVersionOf(bOk.chapters, { readThrough: 0 });
    if (vZero.lockedCount !== 1) problems.push('读到第 0 章时第 1 章必须判未读');
    if (exportTextOf(vZero, { bookTitle: '书' }).indexOf('甲事') >= 0) problems.push('未读章的正文不得进导出');
    /* 三点七 判不了 ≠ 全都新鲜（过期判定的未判态）。 */
    const pStaleUn = { LonShaMemory: {
        storyAnnualStale: function () { return { stale: 0, fresh: 0, missingChapters: 0, staleRefs: [], why: ['no-new-payload'] }; }
    } };
    const stUn = readAnnualStale(pStaleUn, [], null);
    if (stUn.judged !== false) problems.push('拿不到新载荷时不得报「已判」');
    if (stUn.state === SA_FACE_STATES.OK) problems.push('判不了的过期判定不得与「没有段过期」同形');
    const pStaleOk = { LonShaMemory: {
        storyAnnualStale: function () { return { stale: 0, fresh: 2, missingChapters: 0, staleRefs: [], why: [] }; }
    } };
    const stOk = readAnnualStale(pStaleOk, [], null);
    if (stOk.judged !== true || stOk.needRebuild !== false) problems.push('真比过且没变时才可报「没有段过期」');
    /* 三点八 **版形状只认两种**：裸章数组与 `{chapters}` 版对象。 */
    const chsArr = [{ no: 1, title: '甲章', elements: { events: [{ text: '甲事', evidenceRef: 'ch1#event@1' }], changes: [], unfinished: [], quotes: [] } }];
    const fromArr = exportTextOf(chsArr, { bookTitle: '书' });
    if (fromArr.indexOf('甲事') < 0) problems.push('传裸章数组时导出不得成为空稿（形状不对不许静默空）');
    if (coverOf(chsArr, {}).readCount !== 1) problems.push('传裸章数组时封面必须读得到章');
    if (tocOf(chsArr).length !== 1) problems.push('传裸章数组时目录必须读得到章');
    if (exportTextOf(null, {}).indexOf('离线可读') < 0) problems.push('没有版时仍要给一份可读的空稿（不是空字符串）');
    /* 四 进度未给 ⇒ 不裁（宁可言多，不静默藏）。 */
    const vAll = readingVersionOf(book.chapters, {});
    if (vAll.lockedCount !== 0) problems.push('进度未给时不得裁章');
    if (readingVersionOf(book.chapters, { readThrough: null }).lockedCount !== 0) problems.push('readThrough 为 null 时不得裁章');
    /* 五 去剧透未成立：绝不给作者版兜底。 */
    const tvBad = { gated: false, authorial: { elements: {} }, playerOk: false, playerReason: 'no-gate' };
    if (versionsLine(tvBad).indexOf('不回退作者版') < 0) problems.push('去剧透未成立时必须说清「不回退作者版」');
    return { problems: problems, states: states.length, outlets: Object.keys(SA_OUTLETS).length, limits: Object.keys(SA_LIMITS).length };
}
export default {
    SA_FACE_STATES, SA_OUTLETS, SA_VERSIONS, SA_LIMITS,
    saOutletProbe, planSaOutlet,
    readAnnualBuild, readAnnualTwoVersions, readAnnualEdit, readAnnualStale, readAnnualCompose,
    readingVersionOf, coverOf, tocOf, exportTextOf,
    bookLine, versionsLine, saSelfCheck
};
