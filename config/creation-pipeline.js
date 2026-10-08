/* ========================================================
 * config/creation-pipeline.js — [v3.70.0 · 拓展计划 X6] 创作素材到发布草稿（纯函数）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   本仓有八个创作类 App（musicdesk / stickerdesk / soundkit / pixiv / lofter / magazine /
 *   pvdesk / doujin），各自管理自己的素材或读数，但它们之间没有任何一处回答同一个问题：
 *   「这个角色/这段对话里，从哪个素材出处选了什么、放进了哪个草稿、草稿最终发给了谁」。
 *
 *   代价是三类错读数与错流程：
 *   ① **素材 id 不可追溯** —— 从草稿到素材的链断了，坏链接不报、缺播放器仍显示成功；
 *   ② **同曲多份播放状态** —— 同一曲目在 musicdesk 和 MusicApp 各存一份播放状态，
 *      切换时游标不一致，暂停了 A 那边 B 还在放；
 *   ③ **草稿切聊串味** —— 草稿落全局，换角色后看到上一个角色的半成品。
 *
 * 【本模块只做三件事（与 schedule-bridge / finance-overview / social-knowledge-bridge 同范式）】
 *   ① **素材来源登记表 `CREATION_SOURCES`**：钉死八个来源各自提供的素材类型、
 *      id 键名、可追溯性（素材 id 能否反查到来源 App）。
 *   ② **草稿构建 `buildCreationDraft`**：选素材 → 预览 → 存草稿 → 选目标 App。
 *      草稿标 `status: 'draft'`（不落账、不发布），发布动作显式触发。
 *   ③ **幂等草稿账本 `creationIdemKey` + `normalizeCreationLedger` + `diffCreationLedger`
 *      + `applyCreationLedger`**：幂等键 `<source>:<materialId>:<targetApp>`，
 *      同素材同目标只记一次；上限 150 条，随会话隔离。
 *
 * 【不做什么】
 *   · 不取数：素材列表全由调用方取好传进来，本模块是纯函数。
 *   · 不发布：只构建草稿，发布动作只由目标 App 的 owner 做。
 *   · 不读存储、不带计时器：纯函数。
 *
 * 【三条口径纪律】
 *   · **坏链接如实报失败**：素材 id 在来源 App 中找不到 → draft 标 `valid: false`，不显示成功。
 *   · **缺播放器如实报**：musicdesk 素材引用的曲目在 MusicApp 中无对应 → 不显示「可播放」。
 *   · **草稿随会话隔离**：草稿账本走 `creation_ledger` 键（^creation_ 前缀），换角色不串。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

/* ───────── ① 素材来源登记表 ───────── */

/**
 * 八个创作 App 的素材来源登记。
 * 每条钉死：来源 App id、中文名、提供的素材类型、素材 id 键名、可追溯性。
 */
export const CREATION_SOURCES = Object.freeze([
    { source: 'musicdesk', label: '曲库案头', materialType: 'track', idKey: 'trackId', traceable: true, note: '零网络零音频元件，本身不是播放器；播放委托 MusicApp' },
    { source: 'stickerdesk', label: '表情包册', materialType: 'sticker', idKey: 'stickerId', traceable: true, note: 'URL 与分类' },
    { source: 'soundkit', label: '音效盒', materialType: 'recipe', idKey: 'recipeId', traceable: true, note: '合成配方 + 绑定表' },
    { source: 'pixiv', label: 'Pixiv', materialType: 'work', idKey: 'workId', traceable: true, note: '作品 + 章 + 评论 + 插画登记' },
    { source: 'lofter', label: '老福特', materialType: 'article', idKey: 'articleId', traceable: true, note: '稿子 + 合集' },
    { source: 'magazine', label: '杂志', materialType: 'feature', idKey: 'featureId', traceable: true, note: '稿件 + 译文 + 受访者' },
    { source: 'pvdesk', label: 'PV 案头', materialType: 'pv', idKey: 'pvId', traceable: true, note: '分镜脚本 + 歌词' },
    { source: 'doujin', label: '同人商店', materialType: 'product', idKey: 'productId', traceable: true, note: '社团 + 商品 + 即卖会' },
]);

/**
 * 目标 App 登记（草稿最终发布到哪个 App）。
 */
export const CREATION_TARGETS = Object.freeze([
    { target: 'wechat', label: '微信朋友圈', accepts: ['track', 'sticker', 'work', 'article'], note: '分享到朋友圈' },
    { target: 'weibo', label: '微博', accepts: ['track', 'sticker', 'work', 'article', 'feature'], note: '发微博' },
    { target: 'magazine', label: '杂志排版', accepts: ['article', 'work', 'feature', 'pv'], note: '杂志收录' },
    { target: 'doujin', label: '同人商店', accepts: ['work', 'article', 'pv', 'product'], note: '上架' },
    { target: 'lofter', label: '老福特', accepts: ['article', 'work', 'sticker'], note: '发稿' },
    { target: 'pixiv', label: 'Pixiv', accepts: ['work', 'article'], note: '发作品' },
]);

/* ───────── ② 草稿构建 ───────── */

/**
 * 构建一份创作草稿。
 *
 * @param {string} source — 来源 App id（必须在 CREATION_SOURCES 中）
 * @param {string} materialId — 素材 id（来源 App 内的唯一标识）
 * @param {string} targetApp — 目标 App id（必须在 CREATION_TARGETS 中）
 * @param {object} [opts] — 附加选项（tags / note / version）
 * @returns {{valid: boolean, draft: object|null, reason: string}}
 *   valid=false 时 draft=null，reason 说明原因（来源不存在 / 目标不存在 / 素材类型不匹配）
 */
export function buildCreationDraft(source, materialId, targetApp, opts) {
    const src = CREATION_SOURCES.find((s) => s.source === String(source || ''));
    if (!src) return { valid: false, draft: null, reason: 'source-not-found:' + String(source || '') };

    const tgt = CREATION_TARGETS.find((t) => t.target === String(targetApp || ''));
    if (!tgt) return { valid: false, draft: null, reason: 'target-not-found:' + String(targetApp || '') };

    // 素材类型必须被目标 App 接受
    if (!tgt.accepts.includes(src.materialType)) {
        return { valid: false, draft: null, reason: 'type-mismatch:' + src.materialType + '->' + tgt.target };
    }

    const o = (opts && typeof opts === 'object') ? opts : {};
    const draft = {
        id: 'draft:' + String(source) + ':' + String(materialId) + ':' + String(targetApp),
        source: String(source),
        materialId: String(materialId),
        materialType: String(src.materialType),
        targetApp: String(targetApp),
        targetLabel: String(tgt.label),
        tags: Array.isArray(o.tags) ? o.tags.map(String).filter(Boolean) : [],
        note: typeof o.note === 'string' ? o.note : '',
        version: typeof o.version === 'number' ? o.version : 1,
        status: 'draft',
        at: typeof o.at === 'number' ? o.at : 0,
    };
    return { valid: true, draft: draft, reason: 'ok' };
}

/**
 * 验证素材在来源 App 中是否存在（调用方传入素材列表）。
 *
 * @param {string} source — 来源 App id
 * @param {string} materialId — 素材 id
 * @param {Array} materials — 来源 App 的素材列表（每条含 id 字段）
 * @returns {{found: boolean, reason: string}}
 */
export function verifyMaterialExists(source, materialId, materials) {
    const src = CREATION_SOURCES.find((s) => s.source === String(source || ''));
    if (!src) return { found: false, reason: 'source-not-found' };
    const list = Array.isArray(materials) ? materials : [];
    const idField = src.idKey;
    const found = list.some((m) => m && String(m.id || m[idField] || '') === String(materialId));
    return { found: found, reason: found ? 'ok' : 'material-not-in-source' };
}

/* ───────── ③ 幂等草稿账本 ───────── */

/** 草稿账本上限（随会话隔离）。 */
export const CREATION_LEDGER_LIMIT = 150;

/**
 * 幂等键：来源 + 素材 id + 目标 App。
 * 同一素材发布到同一目标只记一次。
 */
export function creationIdemKey(source, materialId, targetApp) {
    return String(source || '') + ':' + String(materialId || '') + ':' + String(targetApp || '');
}

/**
 * 归一化草稿账本条目。
 */
export function normalizeCreationEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const idemKey = typeof raw.idemKey === 'string' ? raw.idemKey : '';
    if (!idemKey) return null;
    return {
        idemKey: idemKey,
        source: typeof raw.source === 'string' ? raw.source : '',
        materialId: typeof raw.materialId === 'string' ? raw.materialId : '',
        targetApp: typeof raw.targetApp === 'string' ? raw.targetApp : '',
        status: typeof raw.status === 'string' ? raw.status : 'draft',
        at: typeof raw.at === 'number' ? raw.at : 0,
        note: typeof raw.note === 'string' ? raw.note : ''
    };
}

/**
 * 归一化草稿账本（去重 + 截断）。
 */
export function normalizeCreationLedger(raw) {
    if (!Array.isArray(raw)) return { entries: [], dropped: 0 };
    const seen = new Set();
    const entries = [];
    let dropped = 0;
    for (const item of raw) {
        const e = normalizeCreationEntry(item);
        if (!e) { dropped++; continue; }
        if (seen.has(e.idemKey)) { dropped++; continue; }
        seen.add(e.idemKey);
        entries.push(e);
    }
    if (entries.length > CREATION_LEDGER_LIMIT) {
        dropped += entries.length - CREATION_LEDGER_LIMIT;
        entries.splice(0, entries.length - CREATION_LEDGER_LIMIT);
    }
    return { entries: entries, dropped: dropped };
}

/**
 * 对账：找出已发布但素材已不存在的条目（stale）。
 *
 * @param {Array} ledger — 已有草稿账本
 * @param {Array} currentMaterials — 当前素材列表（每条含 id 字段）
 * @param {string} source — 来源 App id（限定只查这个来源的条目）
 * @returns {{stale: Array, active: Array}}
 */
export function diffCreationLedger(ledger, currentMaterials, source) {
    const prev = Array.isArray(ledger) ? ledger : [];
    const src = String(source || '');
    const currentIds = new Set(
        (Array.isArray(currentMaterials) ? currentMaterials : [])
            .filter((m) => m && m.id)
            .map((m) => String(m.id))
    );

    const stale = [];
    const active = [];

    for (const e of prev) {
        if (!e || !e.materialId) continue;
        // 只对指定来源的条目做陈旧判定
        if (src && e.source !== src) {
            active.push(e);
            continue;
        }
        if (currentIds.has(e.materialId)) {
            active.push(e);
        } else {
            stale.push(e);
        }
    }

    return { stale, active };
}

/**
 * 应用账本更新：移除陈旧条目，写入新条目。
 */
export function applyCreationLedger(prevLedger, newEntries, staleMaterialIds) {
    const prev = Array.isArray(prevLedger) ? prevLedger : [];
    const stale = new Set((Array.isArray(staleMaterialIds) ? staleMaterialIds : []).map((k) => String(k)));

    const filtered = prev.filter((e) => e && e.materialId && !stale.has(e.materialId));
    const merged = filtered.concat(
        (Array.isArray(newEntries) ? newEntries : []).map((e) => normalizeCreationEntry(e)).filter(Boolean)
    );

    const normalized = normalizeCreationLedger(merged);
    return {
        entries: normalized.entries,
        dropped: normalized.dropped,
        count: normalized.entries.length
    };
}

/* ───────── ④ 自检 ───────── */

export function creationSelfCheck() {
    const problems = [];

    // 来源登记表
    if (CREATION_SOURCES.length !== 8) problems.push('来源表应 8 条，实际 ' + CREATION_SOURCES.length);
    const srcKeys = CREATION_SOURCES.map((s) => s.source);
    if (new Set(srcKeys).size !== srcKeys.length) problems.push('来源 source 键有重复');
    for (const s of CREATION_SOURCES) {
        if (!s.label) problems.push(s.source + ' 缺 label');
        if (!s.materialType) problems.push(s.source + ' 缺 materialType');
        if (!s.idKey) problems.push(s.source + ' 缺 idKey');
        if (typeof s.traceable !== 'boolean') problems.push(s.source + ' traceable 非布尔');
    }

    // 目标登记表
    if (CREATION_TARGETS.length < 4) problems.push('目标表应至少 4 条，实际 ' + CREATION_TARGETS.length);
    for (const t of CREATION_TARGETS) {
        if (!t.label) problems.push(t.target + ' 缺 label');
        if (!Array.isArray(t.accepts) || t.accepts.length === 0) problems.push(t.target + ' accepts 空');
    }

    // 草稿构建
    const r1 = buildCreationDraft('musicdesk', 't1', 'wechat', { tags: ['test'], note: 'hello' });
    if (!r1.valid) problems.push('正常草稿应 valid: ' + r1.reason);
    if (r1.draft && r1.draft.status !== 'draft') problems.push('草稿 status 应为 draft');
    if (r1.draft && r1.draft.tags.length !== 1) problems.push('tags 应 1 条');

    // 类型不匹配
    const r2 = buildCreationDraft('stickerdesk', 's1', 'magazine', {});
    if (r2.valid) problems.push('stickerdesk→magazine 类型不匹配应失败');
    if (!r2.reason.startsWith('type-mismatch')) problems.push('类型不匹配原因应 type-mismatch: ' + r2.reason);

    // 来源不存在
    const r3 = buildCreationDraft('nonexistent', 'x', 'wechat', {});
    if (r3.valid) problems.push('不存在来源应失败');
    if (!r3.reason.startsWith('source-not-found')) problems.push('原因应 source-not-found: ' + r3.reason);

    // 目标不存在
    const r4 = buildCreationDraft('musicdesk', 't1', 'nonexistent', {});
    if (r4.valid) problems.push('不存在目标应失败');

    // 素材验证
    const mats = [{ id: 't1' }, { id: 't2' }];
    const v1 = verifyMaterialExists('musicdesk', 't1', mats);
    if (!v1.found) problems.push('t1 应在素材列表中找到');
    const v2 = verifyMaterialExists('musicdesk', 't9', mats);
    if (v2.found) problems.push('t9 不应在素材列表中找到');

    // 幂等键
    const k1 = creationIdemKey('musicdesk', 't1', 'wechat');
    const k2 = creationIdemKey('musicdesk', 't1', 'wechat');
    if (k1 !== k2) problems.push('幂等键不稳定');
    if (k1 !== 'musicdesk:t1:wechat') problems.push('幂等键格式不符: ' + k1);

    // 账本去重
    const raw = [
        { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'draft', at: 1 },
        { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'draft', at: 2 },
        null,
    ];
    const norm = normalizeCreationLedger(raw);
    if (norm.entries.length !== 1) problems.push('去重后应 1 条，实际 ' + norm.entries.length);
    if (norm.dropped !== 2) problems.push('丢弃应 2 条，实际 ' + norm.dropped);

    // 截断
    const big = [];
    for (let i = 0; i < CREATION_LEDGER_LIMIT + 5; i++) {
        big.push({ idemKey: 'k' + i, source: 'musicdesk', materialId: 'm' + i, targetApp: 'wechat', status: 'draft', at: i });
    }
    const trunc = normalizeCreationLedger(big);
    if (trunc.entries.length !== CREATION_LEDGER_LIMIT) {
        problems.push('截断后应 ' + CREATION_LEDGER_LIMIT + ' 条，实际 ' + trunc.entries.length);
    }

    // diff
    const ledger = [
        { idemKey: 'musicdesk:t1:wechat', source: 'musicdesk', materialId: 't1', targetApp: 'wechat', status: 'published', at: 1 },
        { idemKey: 'musicdesk:t2:wechat', source: 'musicdesk', materialId: 't2', targetApp: 'wechat', status: 'published', at: 2 },
    ];
    const diff = diffCreationLedger(ledger, [{ id: 't1' }], 'musicdesk');  // t2 已删
    if (diff.stale.length !== 1) problems.push('陈旧应 1 条（t2 已删），实际 ' + diff.stale.length);
    if (diff.active.length !== 1) problems.push('有效应 1 条（t1 仍在），实际 ' + diff.active.length);

    // apply
    const applied = applyCreationLedger(ledger, [], ['t2']);
    if (applied.count !== 1) problems.push('应用后应 1 条，实际 ' + applied.count);

    return { problems: problems };
}

/* ───────── ⑤ 导出清单 ───────── */

export default {
    CREATION_SOURCES,
    CREATION_TARGETS,
    CREATION_LEDGER_LIMIT,
    buildCreationDraft,
    verifyMaterialExists,
    creationIdemKey,
    normalizeCreationEntry,
    normalizeCreationLedger,
    diffCreationLedger,
    applyCreationLedger,
    creationSelfCheck,
};