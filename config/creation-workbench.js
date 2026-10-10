/* ========================================================
 * config/creation-workbench.js — [v3.90.0 · 拓展计划 R-X6]
 *   素材到发布的完整创作工作台（纯内核）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   v3.70.0 的 X6 交付了 config/creation-pipeline.js（八来源 / 六目标 /
 *   草稿构建 / 幂等账本），但**产品端只消费了其中一个导出**
 *   （normalizeCreationLedger，在 index.js 的缓存段里）。其余七个
 *   —— buildCreationDraft / verifyMaterialExists / creationIdemKey /
 *   applyCreationLedger / diffCreationLedger / CREATION_SOURCES /
 *   CREATION_TARGETS —— 全仓零调用（本版实测，非推测）。
 *   这正是本仓被点过六次的同一形态：「内核建好了、导出挂出来了、产品端零消费」。
 *   后果不是「少一个页面」，是三件用户看得见的事：
 *     ① 素材**选不了**：曲目 / 图片 / 文本 / 角色 / 事件散在五个 App 里，
 *        没有一个地方能「从任意来源挑一个素材」；
 *     ② 发布前**没人查**：缺图 / 坏链接 / 目标 App 不收这种素材 / 没有播放器，
 *        四类问题都要等用户在目标 App 里真发出去才发现；
 *     ③ 草稿与**已发布**塌成一件事：creation_ledger 里 status 只有
 *        draft / published 两个字符串，而 published 从未被任何代码写过。
 *
 * 【本模块只做四件事（纯函数，与 workflow.js 同范式）】
 *   ① **统一素材五类**（角色 / 事件 / 图片 / 曲目 / 文本）：把各来源清单
 *      归一成同一种条目，每条带 ref = <source>:<sourceId>（可回溯到来源 ID）。
 *   ② **读不到与空分开**：每个来源各有自己的状态（ok / empty / unreadable），
 *      不把「取不出来」当成「没有素材」—— 这两件事处置相反。
 *   ③ **发布前检查四类**：缺素材（含坏图 / 缺播放器）、坏链接、
 *      目标权限（目标 App 不收这种素材）、敏感标记。前三类是 **blocker**
 *      （不得显示发布成功），敏感类是 **warn**（需显式确认）。
 *   ④ **发布计划**：把「选素材 → 生成草稿 → 检查 → 委托 owner」写成数据行；
 *      默认 dry-run，写步只能委托真实 owner（owner 表在本模块里是数据）。
 *
 * 【不做什么】
 *   · 不发布：本模块是纯函数，不碰 storage、不碰 window、不带计时器。
 *   · 不造第二份草稿状态：草稿一律走 creation-pipeline 的 buildCreationDraft
 *     与幂等键；本模块只**引用**它们（这正是修「零消费」的方式）。
 *   · 不复制素材状态：同一素材在五个来源里各存一份，本模块只做**引用归一**，
 *     不落任何素材副本。
 * ======================================================== */
'use strict';

import {
    CREATION_SOURCES,
    CREATION_TARGETS,
    buildCreationDraft,
    creationIdemKey,
    normalizeCreationLedger,
} from './creation-pipeline.js';

/* ───────── ① 统一素材五类 ───────── */

/**
 * 统一素材五类。publishable 说明「这一类能不能当发布载荷」：
 *   角色 / 事件是**上下文素材**（随草稿一起看，但不作为发布载荷）；
 *   图片 / 曲目 / 文本是**载荷素材**。
 * acceptsKey 是曲目/文本类在 creation-pipeline 里的 materialType（用于目标权限判定）；
 * 上下文素材没有对应物，取 null（权限检查按 warn 处置，不当 blocker）。
 */
export const CW_KINDS = Object.freeze([
    Object.freeze({ key: 'character', label: '角色', idKey: 'characterId', ownerApp: 'chars', publishable: false, acceptsKey: null, note: '群像 / 角色槽位（上下文素材）' }),
    Object.freeze({ key: 'event', label: '事件', idKey: 'eventId', ownerApp: 'calendar', publishable: false, acceptsKey: null, note: '剧情事件 / 日历项（上下文素材）' }),
    Object.freeze({ key: 'image', label: '图片', idKey: 'imageId', ownerApp: 'image-generation', publishable: true, acceptsKey: 'sticker', note: '生图队列产出（含多角色生图）' }),
    Object.freeze({ key: 'track', label: '曲目', idKey: 'trackId', ownerApp: 'musicdesk', publishable: true, acceptsKey: 'track', note: '曲库案头；播放委托 MusicApp' }),
    Object.freeze({ key: 'text', label: '文本', idKey: 'textId', ownerApp: 'lofter', publishable: true, acceptsKey: 'article', note: '稿子 / 作品 / 稿件 / 分镜脚本' }),
]);

export const CW_KIND_KEYS = Object.freeze(CW_KINDS.map(function (k) { return k.key; }));

/** 按 key 取素材类（取不到返回 null —— 不编一个默认类）。 */
export function cwKindOf(kind) {
    const k = String(kind || '');
    for (const it of CW_KINDS) if (it.key === k) return it;
    return null;
}

/** 素材类中文名；未知类**如实报未知**，不塌成第一类。 */
export function cwKindText(kind) {
    const it = cwKindOf(kind);
    return it ? it.label : ('未知素材类：' + String(kind || ''));
}

/* ───────── ② 素材引用与归一 ───────── */

/** 素材引用键：<source>:<sourceId> —— 验收①「素材可回溯到来源 ID」的落点。 */
export function cwMaterialRef(source, sourceId) {
    return String(source || '') + ':' + String(sourceId || '');
}

/** 拆引用键；形态不合法（缺冒号 / 冒号在首）返回 null，不猜。 */
export function cwRefParts(ref) {
    const s = String(ref || '');
    const i = s.indexOf(':');
    if (i <= 0 || i === s.length - 1) return null;
    return { source: s.slice(0, i), sourceId: s.slice(i + 1) };
}

/**
 * 链接形态：本地资源路径或 http(s) 才算合法。
 *   这一格量与「坏链接」而不是「有没有网」—— 本仓**不引入新的网络前置**，
 *   故 data: / blob: / 相对路径都算本地可用形态。
 */
export function cwLinkOk(link) {
    const s = String(link || '').trim();
    if (!s) return true;                       // 没有链接 = 本地素材，不算坏
    if (s.indexOf('data:') === 0 || s.indexOf('blob:') === 0) return true;
    if (s.indexOf('/') === 0 || s.indexOf('./') === 0 || s.indexOf('../') === 0) return true;
    return /^https?:\/\/[^\s]+$/i.test(s);
}

/**
 * 归一一条素材。raw 形状（各来源清单归一到这一种）：
 *   { source, sourceId, label, licNote, version, link, present, why }
 * 返回 null 表示**认不出**（没有 source 或没有 sourceId）—— 计入 dropped，不静默丢。
 */
export function cwNormalizeMaterial(raw, kind) {
    if (!raw || typeof raw !== 'object') return null;
    const src = String(raw.source || '').trim();
    const sid = String(raw.sourceId || raw.id || '').trim();
    if (!src || !sid) return null;
    const k = cwKindOf(kind);
    if (!k) return null;
    const link = String(raw.link || '');
    const present = raw.present !== false;      // 缺省视为在场（来源没报缺失就是没有缺失）
    const problems = [];
    if (!cwLinkOk(link)) problems.push('坏链接：' + link.slice(0, 60));
    if (!present) problems.push('资源不在场：' + String(raw.why || '来源未说明原因'));
    return {
        ref: cwMaterialRef(src, sid),
        kind: k.key,
        kindLabel: k.label,
        source: src,
        sourceId: sid,
        label: String(raw.label || sid),
        licNote: String(raw.licNote || ''),
        version: (typeof raw.version === 'number') ? raw.version : 0,
        link: link,
        linkOk: cwLinkOk(link),
        present: present,
        missing: !present,
        missingWhy: present ? '' : String(raw.why || '来源未说明原因'),
        publishable: k.publishable,
        problems: problems,
    };
}

/** 来源登记查询：八个创作来源之外一律 null（**不编一条默认来源**）。 */
export function cwSourceOf(source) {
    const s = String(source || '');
    for (const it of CREATION_SOURCES) if (it.source === s) return it;
    return null;
}

/**
 * 素材清单归一。reads 形状：
 *   { faces: { character: {ok:boolean, rows:[]}, event: {...}, image, track, text } }
 * 返回 { items, states, unreadable, dropped, readable }。
 *   · 某一类 faces 缺席或 ok !== true ⇒ 该类记 unreadable（**不是 empty**）；
 *   · 读到但零条 ⇒ empty；
 *   · 认不出的行 ⇒ dropped（如实计数，不静默丢）。
 */
export function cwCollectMaterials(reads) {
    const r = (reads && typeof reads === 'object') ? reads : {};
    const faces = (r.faces && typeof r.faces === 'object') ? r.faces : {};
    const items = [];
    const states = [];
    let dropped = 0;
    for (const k of CW_KINDS) {
        const f = faces[k.key];
        if (!f || typeof f !== 'object' || f.ok !== true) {
            states.push({
                kind: k.key, label: k.label, state: 'unreadable', count: 0,
                note: '这一类的清单**读不到**（不是「没有素材」—— 这两件事处置相反）',
            });
            continue;
        }
        const rows = Array.isArray(f.rows) ? f.rows : [];
        let kept = 0;
        for (const row of rows) {
            const it = cwNormalizeMaterial(row, k.key);
            if (!it) { dropped += 1; continue; }
            items.push(it);
            kept += 1;
        }
        states.push({
            kind: k.key, label: k.label,
            state: kept === 0 ? 'empty' : 'ok',
            count: kept,
            note: kept === 0 ? '这一类的清单读到了，但一条素材也没有' : ('读到 ' + kept + ' 条素材'),
        });
    }
    const unreadable = states.filter(function (s) { return s.state === 'unreadable'; }).map(function (s) { return s.kind; });
    return { items: items, states: states, unreadable: unreadable, dropped: dropped, readable: unreadable.length === 0 };
}

/** 按引用键取素材；取不到返回 null（**不按 label 模糊匹配**）。 */
export function cwFindMaterial(items, ref) {
    const want = String(ref || '');
    if (!want) return null;
    const list = Array.isArray(items) ? items : [];
    for (const it of list) if (it && it.ref === want) return it;
    return null;
}

/* ───────── ③ 发布前检查四类 ───────── */

export const CW_CHECK_CODES = Object.freeze([
    Object.freeze({ code: 'missing-material', level: 'blocker', label: '缺素材 / 坏图 / 缺播放器' }),
    Object.freeze({ code: 'bad-link', level: 'blocker', label: '坏链接' }),
    Object.freeze({ code: 'permission', level: 'blocker', label: '目标权限' }),
    Object.freeze({ code: 'sensitive', level: 'warn', label: '敏感标记' }),
]);

export function cwCheckOf(code) {
    const c = String(code || '');
    for (const it of CW_CHECK_CODES) if (it.code === c) return it;
    return null;
}

/** 检查行文案：通过 / 不通过两形**不同**（不通过必须带原因）。 */
export function cwCheckLine(c) {
    if (!c) return '（无这项检查）';
    const meta = cwCheckOf(c.code);
    const name = meta ? meta.label : c.code;
    if (c.ok === true) return name + '：通过';
    if (c.level === 'warn') return name + '：需确认（' + String(c.note || '') + '）';
    return name + '：**不通过**（' + String(c.note || '') + '）';
}

/**
 * 发布前四类检查。
 * @param {object|null} item — 选中素材（cwNormalizeMaterial 的产物）
 * @param {string} target — 目标 App id
 * @param {object} [opts] — { sensitive:boolean, why:string }
 * @returns {{checks:Array, blockers:Array, warnings:Array, ok:boolean}}
 */
export function cwPublishChecks(item, target, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const checks = [];
    const t = String(target || '');

    /* ① 缺素材 / 坏图 / 缺播放器 */
    if (!item) {
        checks.push({ code: 'missing-material', level: 'blocker', ok: false, note: '没有选中素材' });
    } else if (item.present !== true) {
        checks.push({ code: 'missing-material', level: 'blocker', ok: false, note: item.missingWhy || '资源不在场' });
    } else {
        checks.push({ code: 'missing-material', level: 'blocker', ok: true, note: item.publishable ? '素材在场' : '上下文素材在场（不作为发布载荷）' });
    }

    /* ② 坏链接 */
    if (item && item.link && item.linkOk !== true) {
        checks.push({ code: 'bad-link', level: 'blocker', ok: false, note: '链接形态不合法：' + String(item.link).slice(0, 60) });
    } else {
        checks.push({ code: 'bad-link', level: 'blocker', ok: true, note: (item && item.link) ? '链接形态合法' : '无外链（本地素材）' });
    }

    /* ③ 目标权限 */
    const tgt = (function () { for (const x of CREATION_TARGETS) if (x.target === t) return x; return null; })();
    if (!tgt) {
        checks.push({ code: 'permission', level: 'blocker', ok: false, note: '目标 App 未登记：' + t });
    } else if (!item) {
        checks.push({ code: 'permission', level: 'blocker', ok: false, note: '缺素材，无法判目标权限' });
    } else {
        const kind = cwKindOf(item.kind);
        const key = kind ? kind.acceptsKey : null;
        if (!item.publishable || !key) {
            checks.push({ code: 'permission', level: 'warn', ok: false, note: cwKindText(item.kind) + '是上下文素材（' + tgt.label + ' 只当背景看，不接收它作发布载荷）' });
        } else if (!Array.isArray(tgt.accepts) || tgt.accepts.indexOf(key) < 0) {
            checks.push({ code: 'permission', level: 'blocker', ok: false, note: tgt.label + ' 不收这种素材（' + cwKindText(item.kind) + '）' });
        } else {
            checks.push({ code: 'permission', level: 'blocker', ok: true, note: tgt.label + ' 接受' + cwKindText(item.kind) });
        }
    }

    /* ④ 敏感标记 */
    if (o.sensitive === true) {
        checks.push({ code: 'sensitive', level: 'warn', ok: false, note: String(o.why || '素材或草稿带敏感标记，发布前需显式确认') });
    } else {
        checks.push({ code: 'sensitive', level: 'warn', ok: true, note: '无敏感标记' });
    }

    const blockers = checks.filter(function (c) { return c.level === 'blocker' && c.ok !== true; });
    const warnings = checks.filter(function (c) { return c.level === 'warn' && c.ok !== true; });
    return { checks: checks, blockers: blockers, warnings: warnings, ok: blockers.length === 0 };
}

/* ───────── ④ 发布计划 ───────── */

/** 权限档：只读 / 需确认 / 委托真实 owner（三档**不同形**）。 */
export const CW_LEVELS = Object.freeze({
    read: Object.freeze({ key: 'read', label: '只读', writes: false }),
    confirm: Object.freeze({ key: 'confirm', label: '需确认', writes: false }),
    write: Object.freeze({ key: 'write', label: '委托 owner 写入', writes: true }),
});
export const CW_LEVEL_KEYS = Object.freeze(['read', 'confirm', 'write']);

/** 目标 App 与真实 owner 的对照表（**数据**；本模块不持有任何写入函数）。 */
export const CW_TARGET_OWNERS = Object.freeze({
    wechat: Object.freeze({ target: 'wechat', owner: 'wechat-moment', ownerWhat: '微信朋友圈（wechatData.addMoment）', instKey: 'wechatApp' }),
    weibo: Object.freeze({ target: 'weibo', owner: 'weibo-post', ownerWhat: '微博正文（weiboData.publishUserPost）', instKey: 'weiboApp' }),
    pixiv: Object.freeze({ target: 'pixiv', owner: 'pixiv-novel', ownerWhat: 'Pixiv 作品（PixivApp.createNovel）', instKey: 'pixivApp' }),
    magazine: Object.freeze({ target: 'magazine', owner: 'magazine-article', ownerWhat: '杂志稿（MagazineApp.addArticle）', instKey: 'magazineApp' }),
    doujin: Object.freeze({ target: 'doujin', owner: 'doujin-shelf', ownerWhat: '同人货架（DoujinApp.saveToShelf）', instKey: 'doujinApp' }),
});

/** 目标是否有真实 owner（没有 ⇒ 计划里报「目标 App 无发布口」，不当成功）。 */
export function cwTargetOwnerOf(target) {
    const t = String(target || '');
    return Object.prototype.hasOwnProperty.call(CW_TARGET_OWNERS, t) ? CW_TARGET_OWNERS[t] : null;
}

/** 四个步骤（声明式固定，没有步骤编辑器）。 */
export const CW_STEPS = Object.freeze([
    Object.freeze({ id: 'pick', label: '选素材', level: 'read', writes: false, owner: '', ownerWhat: '读取五个来源清单', out: '素材引用（<source>:<sourceId>）' }),
    Object.freeze({ id: 'draft', label: '生成草稿', level: 'read', writes: false, owner: '', ownerWhat: '引用 creation-pipeline 的草稿构建', out: '草稿（status=draft）' }),
    Object.freeze({ id: 'check', label: '发布前检查', level: 'read', writes: false, owner: '', ownerWhat: '四类检查（缺素材 / 坏链接 / 权限 / 敏感）', out: '检查行 + blocker 名单' }),
    Object.freeze({ id: 'publish', label: '委托 owner 发布', level: 'write', writes: true, owner: '(目标 App)', ownerWhat: '(由目标 App 的 owner 执行)', out: '发布回执' }),
]);

/** 步骤行文案。 */
export function cwStepLine(st) {
    if (!st) return '（无此步骤）';
    const lv = CW_LEVELS[st.level] || { label: st.level };
    return String(st.label) + ' · ' + lv.label + ' · ' + (st.writes ? '写入' : '不写') + ' · 产出 ' + String(st.out || '');
}

/**
 * 发布计划（默认 dry-run）。
 * @returns {{steps:Array, blocked:boolean, blockers:Array, warnings:Array,
 *            needsConfirm:boolean, willWrite:boolean, draft:object|null,
 *            idemKey:string, problems:Array, kind:string}}
 * 口径：
 *   · 默认 dry-run ⇒ willWrite 恒 false，步骤表照常给出（预览也要看得到写步）；
 *   · blocked 由**检查的 blocker** 与**计划自身的问题**共同决定；
 *   · 草稿由 buildCreationDraft 产（引用，不自己拼）。
 */
export function cwPlanPublish(input) {
    const it = (input && typeof input === 'object') ? input : {};
    const item = it.item || null;
    const target = String(it.target || '');
    const opts = (it.opts && typeof it.opts === 'object') ? it.opts : {};
    const problems = [];

    const chk = cwPublishChecks(item, target, opts);

    /* 草稿：只对**载荷素材**构建（上下文素材不做发布载荷，也就不生成草稿）。 */
    let draft = null;
    let idemKey = '';
    let kind = '';
    if (item && item.publishable) {
        const kindMeta = cwKindOf(item.kind);
        const srcMeta = cwSourceOf(item.source);
        kind = kindMeta ? kindMeta.key : '';
        const draftTarget = target;
        const r = buildCreationDraft(item.source, item.sourceId, draftTarget, {
            tags: Array.isArray(opts.tags) ? opts.tags : [],
            note: String(opts.note || ''),
            version: item.version || 1,
        });
        if (r.valid) draft = r.draft;
        else problems.push('草稿构建失败：' + String(r.reason));
        if (!srcMeta) problems.push('素材来源未登记进创作来源表：' + item.source);
        idemKey = creationIdemKey(item.source, item.sourceId, draftTarget);
    } else if (item) {
        problems.push(cwKindText(item.kind) + '不参与发布（上下文素材）');
    } else {
        problems.push('还没选素材');
    }

    const owner = cwTargetOwnerOf(target);
    if (!owner) problems.push('目标 App 无发布口：' + (target || '(未选)'));

    const steps = CW_STEPS.map(function (s) {
        const out = Object.assign({}, s);
        if (s.id === 'publish' && owner) {
            out.owner = owner.owner;
            out.ownerWhat = owner.ownerWhat;
        }
        out.writes = s.writes;
        return out;
    });

    const blockers = chk.blockers.slice();
    const warnings = chk.warnings.slice();
    for (const p of problems) blockers.push({ code: 'plan', level: 'blocker', ok: false, note: p });

    return {
        kind: kind,
        steps: steps,
        draft: draft,
        idemKey: idemKey,
        checks: chk.checks,
        blockers: blockers,
        warnings: warnings,
        blocked: blockers.length > 0,
        needsConfirm: blockers.length === 0,
        willWrite: false,
        dryRun: true,
        problems: problems,
        owner: owner,
    };
}

/** 计划总括行；一节都不省。 */
export function cwPlanLine(plan) {
    if (!plan) return '还没有计划（先选素材与目标）';
    if (plan.blocked) return '开不了工：' + plan.blockers.map(function (b) { return String(b.note || b.code); }).join(' / ');
    const dn = plan.dryRun ? '默认 dry-run（不点头一个字节都不写）' : '';
    return '可以开工：' + String(plan.steps.length) + ' 步 · ' + dn
        + (plan.warnings.length ? ' · 待确认 ' + String(plan.warnings.length) + ' 项' : '');
}

/** 发布回执归一：ok===true 才算成功（owner 返回 null / 抛错都不算）。 */
export function cwReceiptOf(raw, idemKey) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const ok = r.ok === true;
    return {
        ok: ok,
        idemKey: String(idemKey || ''),
        id: String(r.id || ''),
        reason: ok ? 'ok' : String(r.reason || r.note || 'no-result'),
        at: (typeof r.at === 'number') ? r.at : 0,
    };
}

/** 发布台账追加：同一幂等键只记一次（**不复制出多个状态源**）。 */
export function cwAppendPublished(ledger, receipt) {
    const norm = normalizeCreationLedger(ledger);
    const e = receipt || {};
    if (e.ok !== true || !e.idemKey) {
        return { entries: norm.entries, dropped: norm.dropped, appended: false, count: norm.entries.length };
    }
    const exists = norm.entries.some(function (x) { return x.idemKey === e.idemKey && x.status === 'published'; });
    if (exists) return { entries: norm.entries, dropped: norm.dropped, appended: false, count: norm.entries.length };
    const rows = norm.entries.concat([{ idemKey: e.idemKey, status: 'published', at: e.at || 0, note: '工作台发布' }]);
    const again = normalizeCreationLedger(rows);
    return { entries: again.entries, dropped: again.dropped, appended: true, count: again.entries.length };
}

/* ───────── ⑤ 自检 ───────── */

export function cwSelfCheck(targets) {
    const problems = [];
    const tgt = Object.prototype.hasOwnProperty.call(CW_TARGET_OWNERS, String(targets || '')) ? CW_TARGET_OWNERS[String(targets || '')] : null;
    for (const k of CW_KINDS) {
        if (!k.label || !k.idKey) problems.push('素材类 ' + k.key + ' 缺 label / idKey');
        if (typeof k.publishable !== 'boolean') problems.push('素材类 ' + k.key + ' publishable 非布尔');
        if (k.publishable && !k.acceptsKey) problems.push('素材类 ' + k.key + ' 可发布却没有 acceptsKey');
    }
    if (CW_KIND_KEYS.length !== 5) problems.push('素材类应五类，实际 ' + CW_KIND_KEYS.length);
    for (const t of CREATION_TARGETS) {
        const canPublish = CW_KINDS.some(function (k) { return k.publishable && k.acceptsKey && t.accepts.indexOf(k.acceptsKey) >= 0; });
        if (!canPublish) problems.push('目标 ' + t.target + ' 收不到任何可发布素材类');
    }
    /* 计划表自证：正常素材应挡得住「有 owner 但坏图」的情形。 */
    const bag = cwCollectMaterials({ faces: { character: { ok: true, rows: [{ source: 'chars', sourceId: 'c1', label: '角色甲' }] }, track: { ok: true, rows: [{ source: 'musicdesk', sourceId: 't1', label: '曲目甲' }] } } });
    if (bag.items.length !== 2) problems.push('归一应得 2 条素材，实际 ' + bag.items.length);
    if (bag.states.length !== 5) problems.push('五类状态应齐（含 unreadable），实际 ' + bag.states.length);
    const p1 = cwPlanPublish({ item: cwFindMaterial(bag.items, 'musicdesk:t1'), target: 'wechat' });
    if (p1.blocked) problems.push('正常曲目→朋友圈不应被挡：' + JSON.stringify(p1.blockers.map(function (b) { return b.code; })));
    if (p1.willWrite !== false) problems.push('默认必须 dry-run');
    const bad = cwNormalizeMaterial({ source: 'musicdesk', sourceId: 't2', label: '坏图曲目', present: false, why: '本地资源文件不在场' }, 'track');
    const p2 = cwPlanPublish({ item: bad, target: 'wechat' });
    if (!p2.blocked) problems.push('坏图素材必须被挡（不得显示发布成功）');
    const p3 = cwPlanPublish({ item: cwFindMaterial(bag.items, 'musicdesk:t1'), target: 'lofter' });
    if (!p3.blocked) problems.push('曲目→老福特（不收曲目）必须被挡');
    const p4 = cwPlanPublish({ item: cwFindMaterial(bag.items, 'musicdesk:t1'), target: 'nowhere' });
    if (!p4.blocked) problems.push('未登记目标必须被挡');
    const ap = cwAppendPublished([], { ok: true, idemKey: 'musicdesk:t1:wechat', at: 1 });
    if (ap.appended !== true || ap.count !== 1) problems.push('发布回执应追加 1 条');
    const ap2 = cwAppendPublished(ap.entries, { ok: true, idemKey: 'musicdesk:t1:wechat', at: 2 });
    if (ap2.appended !== false) problems.push('同幂等键不得重复追加（不复制第二个状态源）');
    const ap3 = cwAppendPublished([], { ok: false, idemKey: 'x' });
    if (ap3.count !== 0) problems.push('失败回执不得进台账');
    if (tgt && !tgt.owner) problems.push('目标 owner 表条目缺 owner 名');
    return { problems: problems, kinds: CW_KIND_KEYS.length, steps: CW_STEPS.length, owners: Object.keys(CW_TARGET_OWNERS).length };
}

/* ───────── ⑥ 导出清单 ───────── */

export default {
    CW_KINDS,
    CW_KIND_KEYS,
    CW_CHECK_CODES,
    CW_LEVELS,
    CW_LEVEL_KEYS,
    CW_TARGET_OWNERS,
    CW_STEPS,
    cwKindOf,
    cwKindText,
    cwMaterialRef,
    cwRefParts,
    cwLinkOk,
    cwNormalizeMaterial,
    cwSourceOf,
    cwCollectMaterials,
    cwFindMaterial,
    cwCheckOf,
    cwCheckLine,
    cwPublishChecks,
    cwTargetOwnerOf,
    cwStepLine,
    cwPlanPublish,
    cwPlanLine,
    cwReceiptOf,
    cwAppendPublished,
    cwSelfCheck,
};
