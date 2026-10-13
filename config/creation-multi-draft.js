/* ========================================================
 * config/creation-multi-draft.js — [v4.01.0 · 计划 R3-O8]
 *   创作工作台：多素材编排 / 逐目标文案 / 草稿自动保留 /
 *   替图不丢文字 / 版本比较 / 仅重做所选段（纯内核）
 *
 * 【修前的真实缺口（实测读码，非推测）】
 *   v3.90.0 交付的工作台是 **单素材 + 单目标**：一次只能选一条素材、
 *   只能朝一个目标预览，动作白名单只有 plan / publish / refresh 三个。
 *   由此三件用户看得见的事做不到：
 *     ① **一段剧情做不了三种社媒稿**（微博 / 老福特 / 杂志各一份，
 *        分别编辑互不覆盖）—— 当前换目标就是覆盖上一份预览；
 *     ② **关了就没了**：草稿只活在实例内存（onChatChanged 一律清空），
 *        没有任何落盘面；
 *     ③ **改一张图要重跑全部**：编辑面只有 pick/target 两个选择器，
 *        没有「只改素材、文字保留」，也没有版本比较与分段重做。
 *
 * 【本模块只做六件事（纯函数，与 creation-workbench.js 同范式）】
 *   ① **多目标编排**：同一素材（+同一段剧情文字）一次生成 N 个目标的草稿，
 *      每份独立持 note / tags / 版本号，互不覆盖。
 *   ② **逐目标文案预览**：每份草稿自带可预览文案（标题 + 正文 + 话题），
 *      由来源素材与用户在注释里写的那一段合成，**不由本模块编内容**。
 *   ③ **草稿自动保留**：归一 + 上限 + 范围（scope）标记，落盘由调用方做；
 *      本模块只给「可安全落盘」的形状（**读不出与空是两件事**）。
 *   ④ **替图不丢文字**：换素材只改素材引用与版本号，note / tags 原样保留。
 *   ⑤ **版本比较**：字段级 diff（哪些字段变了、从什么变成什么），
 *      不说「有变化」这种没用的话。
 *   ⑥ **仅重做所选段**：只重跑选中的目标，未选中的草稿与编辑原样留着。
 *
 * 【不做（验收①③④的落点）】
 *   · **不发布**：本模块**不 import 任何 owner 表**，也不碰 storage / window / 计时器；
 *     发布仍必须逐目标走目标 App 的 owner（cwInvokeOwner），一次都不代发。
 *   · **不重做素材库与发布执行器**：草稿仍由 creation-pipeline 的
 *     buildCreationDraft 与 creationIdemKey 产（**引用，不复制**）。
 *   · **不把「发布到虚拟社媒」说成外网发布**：文案里不出现「已发布到微博」这类
 *     无凭据说法，只报「已委托（回读一致）」。
 * ========================================================= */
'use strict';

import {
    buildCreationDraft,
    creationIdemKey,
} from './creation-pipeline.js';

/* ───────── ⓪ 上限与常量 ───────── */
/** 草稿保留上限（随会话隔离；超出按最早先出，与既有多本账上限同范式）。 */
export const CMD_LIMITS = Object.freeze({
    drafts: 24,
    targetsPerCompose: 6,
    textMax: 2000,
    tagsMax: 12,
});
/** 草稿四态：编辑中 / 待发 / 已发 / 已过时（素材换过但还没重新生成）。 */
export const CMD_DRAFT_STATES = Object.freeze(['editing', 'ready', 'published', 'stale']);

/* ───────── ① 多目标编排 ───────── */
/**
 * 同一素材一次编排到多个目标。
 *   targets 是目标 id 数组（去重后逐目标建草稿）；每个目标各自可用 opts.per[target]
 *   覆盖 note / tags —— 这正是「分别编辑互不覆盖」的机制面。
 * @returns {{ok:boolean, drafts:Array, rejected:Array, reason:string}}
 *   ok=false 时 drafts 为空、rejected 列出逐目标被拒的原因（不静默丢）。
 */
export function composeDrafts(source, materialId, targets, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const per = (o.per && typeof o.per === 'object') ? o.per : {};
    const list = Array.isArray(targets) ? targets.map(function (t) { return String(t || '').trim(); }).filter(Boolean) : [];
    const uniq = [];
    for (const t of list) if (uniq.indexOf(t) < 0) uniq.push(t);
    if (!uniq.length) return { ok: false, drafts: [], rejected: [], reason: 'no-target' };
    if (uniq.length > CMD_LIMITS.targetsPerCompose) {
        return { ok: false, drafts: [], rejected: [], reason: 'too-many-targets:' + String(uniq.length) };
    }
    const drafts = [];
    const rejected = [];
    for (const t of uniq) {
        const p = (per[t] && typeof per[t] === 'object') ? per[t] : {};
        const r = buildCreationDraft(source, materialId, t, {
            tags: Array.isArray(p.tags) ? p.tags : (Array.isArray(o.tags) ? o.tags : []),
            note: String(p.note || o.note || ''),
            version: 1,
        });
        if (!r.valid) { rejected.push({ target: t, reason: String(r.reason) }); continue; }
        /* 窄口归一；**必须取 .draft** —— 早期版本把包装对象 push 进去，
         * 于是草稿本里躺的是 {ok,reason,draft} 而不是草稿本身（本模块自检当场抓到）。 */
        const nd = normalizeDraft({
            key: creationIdemKey(source, materialId, t),
            source: source, materialId: String(materialId || ''), target: t,
            note: String(p.note || o.note || ''),
            tags: Array.isArray(p.tags) ? p.tags : (Array.isArray(o.tags) ? o.tags : []),
            version: 1, state: 'ready', at: (typeof o.at === 'number') ? o.at : 0,
        });
        if (!nd.ok) { rejected.push({ target: t, reason: 'normalize:' + nd.reason }); continue; }
        drafts.push(nd.draft);
    }
    return { ok: drafts.length > 0, drafts: drafts, rejected: rejected, reason: drafts.length ? 'ok' : 'all-rejected' };
}
/** 草稿键：直接沿用 creation-pipeline 的幂等键（**不另造一套键形**）。 */
export function draftKeyOf(source, materialId, target) {
    return creationIdemKey(source, materialId, target);
}

/* ───────── ② 草稿归一与草稿本 ───────── */
/**
 * 归一一份草稿。**窄口**：缺键（key/source/target）或 state 不在四态里一律拒。
 * note 裁到 textMax、tags 去重裁到 tagsMax（超出的**如实计数**，不静默丢）。
 * @returns {{ok:boolean, draft:object|null, reason:string}}
 */
export function normalizeDraft(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const key = String(r.key || '').trim();
    const source = String(r.source || '').trim();
    const target = String(r.target || '').trim();
    if (!key) return { ok: false, draft: null, reason: 'no-key' };
    if (!source) return { ok: false, draft: null, reason: 'no-source' };
    if (!target) return { ok: false, draft: null, reason: 'no-target' };
    const state = String(r.state || 'editing');
    if (CMD_DRAFT_STATES.indexOf(state) < 0) return { ok: false, draft: null, reason: 'bad-state:' + state };
    const rawNote = String(r.note || '');
    const note = rawNote.length > CMD_LIMITS.textMax ? rawNote.slice(0, CMD_LIMITS.textMax) : rawNote;
    const rawTags = Array.isArray(r.tags) ? r.tags.map(function (t) { return String(t || '').trim(); }).filter(Boolean) : [];
    const tags = [];
    for (const t of rawTags) if (tags.indexOf(t) < 0) tags.push(t);
    const droppedTags = tags.length > CMD_LIMITS.tagsMax ? tags.length - CMD_LIMITS.tagsMax : 0;
    return {
        ok: true, reason: 'ok',
        draft: {
            key: key, source: source,
            materialId: String(r.materialId || ''),
            target: target,
            note: note, noteTrimmed: rawNote.length > note.length,
            tags: droppedTags ? tags.slice(0, CMD_LIMITS.tagsMax) : tags,
            droppedTags: droppedTags,
            version: (typeof r.version === 'number' && r.version > 0) ? Math.floor(r.version) : 1,
            state: state,
            at: (typeof r.at === 'number') ? r.at : 0,
        },
    };
}
/**
 * 草稿本归一。**读不出与空分得开**：非数组一律 readError（不是空草稿本）。
 * @returns {{readable:boolean, drafts:Array, dropped:number, reason:string}}
 */
export function normalizeDraftBook(raw) {
    if (raw === null || raw === undefined) return { readable: false, drafts: [], dropped: 0, reason: 'read-error' };
    if (!Array.isArray(raw)) return { readable: false, drafts: [], dropped: 0, reason: 'not-an-array' };
    const drafts = [];
    let dropped = 0;
    for (const row of raw) {
        const n = normalizeDraft(row);
        if (!n.ok) { dropped += 1; continue; }
        drafts.push(n.draft);
    }
    if (drafts.length > CMD_LIMITS.drafts) {
        dropped += drafts.length - CMD_LIMITS.drafts;
        drafts.splice(0, drafts.length - CMD_LIMITS.drafts);
    }
    return { readable: true, drafts: drafts, dropped: dropped, reason: 'ok' };
}
/**
 * 草稿插入/更新：**同键后到覆盖先到**（用户再编辑一次就是新的那份）。
 * 这一条直接支撑验收③「关闭重开保留草稿」与「分别编辑互不覆盖」。
 */
export function upsertDraft(book, draft) {
    const norm = normalizeDraftBook(book);
    const n = normalizeDraft(draft);
    if (!n.ok) return { readable: norm.readable, drafts: norm.drafts, dropped: norm.dropped, changed: false, reason: n.reason };
    const out = norm.drafts.filter(function (d) { return d.key !== n.draft.key; });
    out.push(n.draft);
    const again = normalizeDraftBook(out);
    return { readable: true, drafts: again.drafts, dropped: norm.dropped + again.dropped, changed: true, reason: 'ok' };
}

/* ───────── ③ 替图不丢文字 ───────── */
/**
 * 换素材、保文字：只改 source / materialId / key / version，note 与 tags **原样保留**。
 * 素材换过的草稿置 state='stale'（待重生成）—— 不假装还是 ready。
 * 这正是验收③「改一张图不重跑全部」的机制面：文字部分不因换图而丢。
 */
export function replaceMaterialKeepText(draft, newSource, newMaterialId) {
    const n = normalizeDraft(draft);
    if (!n.ok) return { ok: false, draft: null, reason: 'draft-invalid:' + n.reason };
    const src = String(newSource || '').trim();
    const mid = String(newMaterialId || '').trim();
    if (!src || !mid) return { ok: false, draft: n.draft, reason: 'no-material' };
    const next = Object.assign({}, n.draft, {
        source: src, materialId: mid,
        key: draftKeyOf(src, mid, n.draft.target),
        version: n.draft.version + 1,
        state: 'stale',
    });
    const nn = normalizeDraft(next);
    /* previousKey 必给：换素材会改键，调用方需要知道该把**旧的哪一行**撤掉，
     * 否则草稿本里会留下一行同目标的旧稿（重复行）。 */
    return nn.ok
        ? { ok: true, draft: nn.draft, previousKey: n.draft.key, reason: 'ok' }
        : { ok: false, draft: n.draft, previousKey: n.draft.key, reason: nn.reason };
}
/**
 * 用一份新草稿替换草稿本里的**指定旧行**（按旧键撤、按新键存）。
 * 替图不丢文字只有这一条路：否则新旧两行会同时在，用户看到两份同一目标的稿。
 */
export function replaceDraftInBook(book, previousKey, draft) {
    const norm = normalizeDraftBook(book);
    const prev = String(previousKey || '');
    const without = prev ? norm.drafts.filter(function (d) { return d.key !== prev; }) : norm.drafts.slice();
    return upsertDraft(without, draft);
}

/* ───────── ④ 版本比较（字段级，不说「有变化」这种没用的话） ───────── */
/** 比较两份草稿，给出逐字段的旧值/新值。keys 不同时先报键变（**不当同一份比**）。 */
export function diffDrafts(a, b) {
    const na = normalizeDraft(a);
    const nb = normalizeDraft(b);
    if (!na.ok || !nb.ok) {
        return { comparable: false, keyChanged: false, fields: [], reason: 'invalid-draft' };
    }
    const A = na.draft;
    const B = nb.draft;
    if (A.key !== B.key) {
        return { comparable: false, keyChanged: true, fields: [], reason: 'key-changed', from: A.key, to: B.key };
    }
    const fields = [];
    const push = function (name, from, to) {
        const fs = JSON.stringify(from === undefined ? null : from);
        const ts = JSON.stringify(to === undefined ? null : to);
        if (fs !== ts) fields.push({ field: name, from: from, to: to });
    };
    push('note', A.note, B.note);
    push('tags', A.tags, B.tags);
    push('materialId', A.materialId, B.materialId);
    push('source', A.source, B.source);
    push('version', A.version, B.version);
    push('state', A.state, B.state);
    return { comparable: true, keyChanged: false, fields: fields, reason: fields.length ? 'changed' : 'identical', from: A.key, to: B.key };
}
/** diff 行文案（视图与台账共用一份口径）。 */
export function diffLine(diff) {
    const d = diff || {};
    if (d.comparable === false) return d.keyChanged ? '不是同一份草稿（键变了）' : '两份草稿有一份认不出，无法比较';
    if (!d.fields || !d.fields.length) return '与上一版一致（' + String(d.from || '') + '）';
    return String(d.fields.length) + ' 处不同：' + d.fields.map(function (f) { return f.field; }).join(' / ');
}

/* ───────── ⑤ 仅重做所选段 ───────── */
/**
 * 只重做选中的目标：未选中的草稿**原样留着**（含它们的编辑与版本号）。
 * @returns {{drafts:Array, redone:Array, kept:number, dropped:number}}
 */
export function recomposeTargets(book, targets, source, materialId, opts) {
    const norm = normalizeDraftBook(book);
    const list = Array.isArray(targets) ? targets.map(function (t) { return String(t || '').trim(); }).filter(Boolean) : [];
    const uniq = [];
    for (const t of list) if (uniq.indexOf(t) < 0) uniq.push(t);
    const c = composeDrafts(source, materialId, uniq, opts);
    /* 按**目标**替换，不按键：换素材会改键，按键留旧行会多出一份同目标的旧稿。
     * 「仅重做所选段」的用户语义就是「这几个目标重来，其它别动」。 */
    const kept = norm.drafts.filter(function (d) { return uniq.indexOf(d.target) < 0; });
    /* 重做的草稿要继承**同目标旧那份的文字**（只重做 = 素材换，不是文字丢）。 */
    const inherited = c.drafts.map(function (d) {
        const old = norm.drafts.filter(function (o) { return o.target === d.target; })[0];
        if (!old) return d;
        return Object.assign({}, d, { note: d.note || old.note, tags: d.tags.length ? d.tags : old.tags, version: old.version + 1 });
    });
    const merged = kept.concat(inherited);
    const again = normalizeDraftBook(merged);
    return { drafts: again.drafts, redone: inherited, kept: kept.length, dropped: norm.dropped + again.dropped };
}

/* ───────── ⑥ 逐目标文案预览 ───────── */
/**
 * 逐目标文案预览。
 *   ★ 本函数**不编内容**：正文只由（素材标签 + 用户写的那段 note）拼成；
 *     note 为空时如实报「还没写正文」，不拿素材标签假装正文。
 *   ★ 文案里**不出现「已发布到 XX」**这类无凭据说法（验收④）。
 * @returns {{target:string, title:string, body:string, tags:Array, tagLine:string, readyToPublish:boolean, note:string}}
 */
export function previewOf(draft, material) {
    const n = normalizeDraft(draft);
    if (!n.ok) {
        return { target: '', title: '', body: '', tags: [], tagLine: '', readyToPublish: false, note: '草稿认不出：' + n.reason };
    }
    const d = n.draft;
    const m = (material && typeof material === 'object') ? material : {};
    const label = String(m.label || d.materialId || '未命名素材');
    const kind = String(m.kindLabel || '');
    const title = label + ' → ' + d.target;
    const body = d.note ? d.note : '还没有正文（先在注释里写一段剧情）';
    const tagLine = d.tags.length ? ('#' + d.tags.join(' #')) : '（没话题标签）';
    return {
        target: d.target, title: title, body: body,
        tags: d.tags.slice(), tagLine: tagLine,
        readyToPublish: !!(d.note && m.present !== false),
        note: kind ? ('素材类：' + kind) : '素材类：未给出',
    };
}

/* ───────── ⑦ 自检 ───────── */
export function cmdSelfCheck() {
    const problems = [];
    if (CMD_DRAFT_STATES.length !== 4) problems.push('草稿态应四态，实际 ' + String(CMD_DRAFT_STATES.length));
    /* 多目标样本用 wechat + weibo：两者都收 track（magazine 不收曲目，不能当样本）。 */
    const c = composeDrafts('musicdesk', 't1', ['wechat', 'weibo'], { per: { weibo: { note: '一段剧情' }, wechat: { note: '另一段' } } });
    if (!c.ok || c.drafts.length !== 2) problems.push('两目标编排应得 2 份草稿，实际 ' + String(c.drafts.length));
    const weibo = c.drafts.filter(function (d) { return d.target === 'weibo'; })[0];
    const wchat = c.drafts.filter(function (d) { return d.target === 'wechat'; })[0];
    if (!weibo || weibo.note !== '一段剧情') problems.push('逐目标注释未落到 weibo 那一份');
    if (!wchat || wchat.note !== '另一段') problems.push('逐目标注释未落到 wechat 那一份（两份被覆盖了）');
    if (weibo && wchat && weibo.note === wchat.note) problems.push('两份注释不应相等（说明没分开持）');
    if (weibo && wchat && weibo.key === wchat.key) problems.push('不同目标的草稿键不得相同');
    if (composeDrafts('musicdesk', 't1', ['lofter'], {}).ok) problems.push('曲目→老福特（不收曲目）应被逐目标拒');
    if (!composeDrafts('musicdesk', 't1', ['lofter'], {}).rejected.length) problems.push('被拒目标必须进 rejected（不静默丢）');
    if (composeDrafts('musicdesk', 't1', [], {}).ok) problems.push('零目标不得当作成功');
    if (composeDrafts('musicdesk', 't1', ['wechat', 'weibo', 'magazine', 'pixiv', 'doujin', 'lofter', 'weibo'], {}).ok !== true) problems.push('去重后 6 个目标（上限内）应可编排');
    if (composeDrafts('musicdesk', 't1', ['wechat', 'weibo', 'magazine', 'pixiv', 'doujin', 'lofter', 'nowhere'], {}).reason.indexOf('too-many') !== 0) problems.push('去重后 7 项（含未登记目标）应超上限被拒');
    /* 替图不丢文字 */
    const sw = replaceMaterialKeepText(weibo, 'musicdesk', 't9');
    if (!sw.ok || sw.draft.note !== '一段剧情') problems.push('替图不得丢掉注释');
    if (sw.ok && sw.draft.state !== 'stale') problems.push('换过素材的草稿必须置 stale（不得假装 ready）');
    if (sw.ok && sw.draft.tags.join() !== weibo.tags.join()) problems.push('替图不得丢掉话题标签');
    if (sw.ok && sw.draft.version !== weibo.version + 1) problems.push('替图应把版本号 +1');
    if (replaceMaterialKeepText(weibo, '', 'x').ok) problems.push('缺素材不得当作替图成功');
    if (sw.ok && sw.previousKey !== weibo.key) problems.push('替图必须给出 previousKey（否则旧行撤不掉）');
    const rbook = replaceDraftInBook(c.drafts, sw.ok ? sw.previousKey : '', sw.ok ? sw.draft : weibo);
    if (rbook.drafts.length !== 2) problems.push('替图后草稿本应仍为 2 行（旧行撤掉、新行存入），实际 ' + String(rbook.drafts.length));
    if (rbook.drafts.filter(function (d) { return d.target === 'weibo'; }).length !== 1) problems.push('同一目标不得留两行（重复行）');
    /* 版本比较 */
    const same = diffDrafts(weibo, weibo);
    if (same.reason !== 'identical' || same.fields.length) problems.push('同一份草稿自比必须 identical 且零字段');
    const df = diffDrafts(wchat, Object.assign({}, wchat, { note: '改过的正文' }));
    if (!df.comparable || df.fields.length !== 1 || df.fields[0].field !== 'note') problems.push('改正文应只报 note 一处不同');
    if (diffLine(df).indexOf('1 处不同') !== 0) problems.push('diffLine 应如实报处数');
    if (diffDrafts(weibo, wchat).reason !== 'key-changed') problems.push('不同键的两份必须报键变（不得当同一份比）');
    /* 仅重做所选段 */
    const book = c.drafts;
    const rc = recomposeTargets(book, ['weibo'], 'musicdesk', 't2', {});
    if (rc.kept !== 1) problems.push('只重做 1 个目标时应保留 1 份，实际 ' + String(rc.kept));
    if (rc.drafts.length !== 2) problems.push('重做后总数应仍为 2，实际 ' + String(rc.drafts.length));
    if (rc.drafts.filter(function (d) { return d.target === 'weibo'; }).length !== 1) problems.push('重做后同一目标只得一行（换素材改键不得留旧行）');
    const keptW = rc.drafts.filter(function (d) { return d.target === 'wechat'; })[0];
    if (!keptW || keptW.note !== '另一段') problems.push('未选中的目标必须原样保留其编辑');
    const redoneW = rc.drafts.filter(function (d) { return d.target === 'weibo'; })[0];
    if (!redoneW || redoneW.note !== '一段剧情') problems.push('重做的目标必须继承旧那份的文字（只重做 = 换素材，不是丢文字）');
    /* 草稿本：读不出与空分得开 */
    if (normalizeDraftBook(null).readable !== false) problems.push('读不出必须 readable:false');
    if (normalizeDraftBook('x').readable !== false) problems.push('非数组必须 readable:false');
    if (normalizeDraftBook([]).readable !== true) problems.push('空数组必须 readable:true（与读不出是两件事）');
    if (normalizeDraftBook([{ key: 'x' }, null]).dropped !== 2) problems.push('认不出的行应如实计数');
    if (normalizeDraft({}).ok) problems.push('缺键的草稿必须被窄口拒');
    if (normalizeDraft({ key: 'k', source: 's', target: 't', state: 'zzz' }).ok) problems.push('非法态必须被拒');
    /* 文案预览不编内容 */
    const pv = previewOf(weibo, { label: '曲目甲', kindLabel: '曲目', present: true });
    if (pv.readyToPublish !== true) problems.push('有正文且在场的素材应可发');
    const pvEmpty = previewOf(normalizeDraft({ key: 'k', source: 'musicdesk', target: 'wechat' }).draft, { label: '曲目甲' });
    if (pvEmpty.readyToPublish !== false) problems.push('没写正文不得报可发');
    if (/已发布/.test(pv.title + pv.body + pv.tagLine)) problems.push('文案不得出现「已发布」这类无凭据说法');
    /* 幂等：同一键 upsert 两次只留一份（后到覆盖） */
    const up1 = upsertDraft([], weibo);
    const up2 = upsertDraft(up1.drafts, Object.assign({}, weibo, { note: '改过的正文' }));
    if (up2.drafts.length !== 1) problems.push('同键 upsert 两次应只留一份，实际 ' + String(up2.drafts.length));
    if (up2.drafts[0].note !== '改过的正文') problems.push('upsert 必须后到覆盖先到');
    if (upsertDraft([], null).changed !== false) problems.push('非法草稿 upsert 不得改草稿本');
    return { ok: problems.length === 0, problems: problems, limits: CMD_LIMITS.drafts, states: CMD_DRAFT_STATES.length };
}

/* ───────── ⑧ 导出清单 ───────── */
export default {
    CMD_LIMITS,
    CMD_DRAFT_STATES,
    composeDrafts,
    draftKeyOf,
    normalizeDraft,
    normalizeDraftBook,
    upsertDraft,
    replaceMaterialKeepText,
    replaceDraftInBook,
    diffDrafts,
    diffLine,
    recomposeTargets,
    previewOf,
    cmdSelfCheck,
};
