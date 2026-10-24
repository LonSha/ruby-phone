/* ========================================================
 * config/lineage-versioning.js — [R7-O5 · 第七期规划] 作品版本与来源谱系内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   作者修改了某章核心角色设定或情节后，派生的短帖、宣传海报文案、配音稿等成稿
 *   往往静默过时，或者在重新生成时把用户人工润色的段落给粗暴覆盖。
 *   作品版本与来源谱系建立“作品内来源引用、派生版本与人工锁定段”闭环：
 *     ① 建立派生谱系映射：每个成稿关联明确的源章节/源段落（sourceRef）与版本指纹（fingerprint）；
 *     ② 影响清单分析（diffImpactedArtifacts）：当源文本或素材变动时，精准标出哪些下游受影响（stale），
 *        区分“来源已删除(missing_source)”与“版本滞后(stale_version)”；
 *     ③ 人工锁定段保护（lockedSegments）：作者精修锁定的段落在重新派生/更新时绝对保留，不予重写；
 *     ④ 用户处置裁决：支持更新(update)、保留现状(retain)或标记过期(mark_stale)；
 *     ⑤ 零写原则：纯函数计算受影响清单与合并结果，不直接修改数据库或跨层越权。
 * ======================================================== */

'use strict';

/** 派生成品媒介形态 */
export const ARTIFACT_MEDIA_TYPES = Object.freeze({
    SOCIAL_POST: 'social_post',     // 社交媒体短帖 (微博/推特/动态)
    PROMO_POSTER: 'promo_poster',   // 宣传海报文案
    VOICEOVER: 'voiceover_script',  // 配音/旁白脚本
    SYNOPSIS: 'synopsis_summary'    // 剧情提要/分集简介
});

/** 谱系节点滞后状态 */
export const LINEAGE_STALE_STATUS = Object.freeze({
    FRESH: 'fresh',                 // 源码版本完全一致
    STALE_VERSION: 'stale_version', // 来源内容改版，指纹不一致
    MISSING_SOURCE: 'missing_source', // 来源章节或段落已被删除
    UNPINNED: 'unpinned'            // 未锚定版本指纹
});

/** 处置动作 */
export const RESOLUTION_ACTIONS = Object.freeze({
    UPDATE: 'update',               // 重新派生更新（受保护段保留）
    RETAIN: 'retain',               // 认可差异，保留现状（更新基线指纹）
    MARK_STALE: 'mark_stale'        // 明确标示为已过期待重写
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

function clone(val) {
    return JSON.parse(JSON.stringify(val));
}

/** 简易字符串指纹计算（非加密哈希，用于内存 diff） */
export function computeContentFingerprint(text = '') {
    const s = safeStr(text);
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
    }
    return `fp_${Math.abs(hash).toString(36)}_${s.length}`;
}

/**
 * 规范化源段定义
 */
export function normalizeSourceSegment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const sourceId = safeStr(raw.sourceId || raw.id);
    if (!sourceId) return null;
    const title = safeStr(raw.title, '未命名章节');
    const content = safeStr(raw.content, '');
    const fingerprint = safeStr(raw.fingerprint, computeContentFingerprint(content));
    return Object.freeze({
        sourceId,
        title,
        content,
        fingerprint,
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 规范化派生成品条目
 */
export function normalizeArtifact(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const artifactId = safeStr(raw.artifactId || raw.id);
    if (!artifactId) return null;

    const mediaTypeValues = Object.values(ARTIFACT_MEDIA_TYPES);
    const mediaType = mediaTypeValues.includes(raw.mediaType)
        ? raw.mediaType
        : ARTIFACT_MEDIA_TYPES.SOCIAL_POST;

    const sourceRef = safeStr(raw.sourceRef || raw.sourceId);
    const baseFingerprint = safeStr(raw.baseFingerprint, '');
    const lockedSegments = Array.isArray(raw.lockedSegments)
        ? raw.lockedSegments.map(s => ({
            id: safeStr(s.id, `seg_${Math.random().toString(36).slice(2, 6)}`),
            key: safeStr(s.key),
            content: safeStr(s.content),
            userLocked: Boolean(s.userLocked)
        })).filter(s => s.key && s.content)
        : [];

    const generatedBody = safeStr(raw.generatedBody || raw.content, '');

    return Object.freeze({
        artifactId,
        title: safeStr(raw.title, '未命名成稿'),
        mediaType,
        sourceRef,
        baseFingerprint,
        generatedBody,
        lockedSegments: Object.freeze(lockedSegments),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 差异与受影响清单分析
 * @param {Array} artifacts 成品列表
 * @param {Array} currentSources 当前源章节列表
 * @returns {Array} 影响清单
 */
export function diffImpactedArtifacts(artifacts = [], currentSources = []) {
    const rawArtifacts = Array.isArray(artifacts) ? artifacts : [];
    const sourceMap = new Map();
    for (const src of (Array.isArray(currentSources) ? currentSources : [])) {
        const norm = normalizeSourceSegment(src);
        if (norm) sourceMap.set(norm.sourceId, norm);
    }

    const report = [];
    for (const a of rawArtifacts) {
        const norm = normalizeArtifact(a);
        if (!norm) continue;

        if (!norm.sourceRef) {
            report.push({
                artifactId: norm.artifactId,
                title: norm.title,
                mediaType: norm.mediaType,
                sourceRef: null,
                status: LINEAGE_STALE_STATUS.UNPINNED,
                reason: '成品未关联任何源章节'
            });
            continue;
        }

        const source = sourceMap.get(norm.sourceRef);
        if (!source) {
            report.push({
                artifactId: norm.artifactId,
                title: norm.title,
                mediaType: norm.mediaType,
                sourceRef: norm.sourceRef,
                status: LINEAGE_STALE_STATUS.MISSING_SOURCE,
                reason: `关联的源章节 [${norm.sourceRef}] 已不存在或被删除`
            });
            continue;
        }

        if (source.fingerprint !== norm.baseFingerprint) {
            report.push({
                artifactId: norm.artifactId,
                title: norm.title,
                mediaType: norm.mediaType,
                sourceRef: norm.sourceRef,
                sourceTitle: source.title,
                status: LINEAGE_STALE_STATUS.STALE_VERSION,
                currentSourceFingerprint: source.fingerprint,
                baseFingerprint: norm.baseFingerprint,
                lockedSegmentCount: norm.lockedSegments.length,
                reason: `源章节 [${source.title}] 已改动，指纹失配`
            });
            continue;
        }

        report.push({
            artifactId: norm.artifactId,
            title: norm.title,
            mediaType: norm.mediaType,
            sourceRef: norm.sourceRef,
            status: LINEAGE_STALE_STATUS.FRESH,
            reason: '版本完全一致'
        });
    }

    return Object.freeze(report);
}

/**
 * 应用更新并绝对保留人工锁定段
 * @param {Object} oldArtifact 旧成品
 * @param {string} newlyDerivedBody 新派生的正文
 * @param {string} newSourceFingerprint 新来源指纹
 * @returns {Object} 更新后的成品
 */
export function applyUpdateWithLockProtection(oldArtifact, newlyDerivedBody, newSourceFingerprint) {
    const norm = normalizeArtifact(oldArtifact);
    if (!norm) return null;

    let finalBody = safeStr(newlyDerivedBody, norm.generatedBody);
    // 对人工锁定段进行保护：若锁定的段落内容在新文本中不存在，强制置换或回填
    for (const locked of norm.lockedSegments) {
        if (!locked.userLocked) continue;
        // 如果锁定段带有锚定 key，且新文本不含该段内容，则确保锁定段留存
        if (!finalBody.includes(locked.content)) {
            finalBody += `\n[锁定段·${locked.key}]: ${locked.content}`;
        }
    }

    return Object.freeze({
        ...norm,
        baseFingerprint: safeStr(newSourceFingerprint, norm.baseFingerprint),
        generatedBody: finalBody,
        updatedAt: Date.now()
    });
}

/**
 * 模块自检函数
 */
export function lineageVersioningSelfCheck() {
    const problems = [];
    if (Object.keys(ARTIFACT_MEDIA_TYPES).length !== 4) {
        problems.push('ARTIFACT_MEDIA_TYPES 必须恰好为 4 种');
    }
    if (Object.keys(LINEAGE_STALE_STATUS).length !== 4) {
        problems.push('LINEAGE_STALE_STATUS 必须恰好为 4 态');
    }
    if (Object.keys(RESOLUTION_ACTIONS).length !== 3) {
        problems.push('RESOLUTION_ACTIONS 必须恰好为 3 种');
    }

    // 单元自测：源章节修改仅影响对应成稿
    const ch1 = normalizeSourceSegment({ sourceId: 'ch1', title: '第一章 偶遇', content: '林舟初次见到周姐。' });
    const ch2 = normalizeSourceSegment({ sourceId: 'ch2', title: '第二章 契约', content: '双方签署了合伙协议。' });

    const post1 = normalizeArtifact({
        artifactId: 'art_post1',
        title: '第一章社媒短文',
        mediaType: ARTIFACT_MEDIA_TYPES.SOCIAL_POST,
        sourceRef: 'ch1',
        baseFingerprint: ch1.fingerprint,
        generatedBody: '今天遇到了周姐，命运的齿轮开始转动。',
        lockedSegments: [{ key: 'hook', content: '命运的齿轮开始转动。', userLocked: true }]
    });

    const post2 = normalizeArtifact({
        artifactId: 'art_post2',
        title: '第二章配音文案',
        mediaType: ARTIFACT_MEDIA_TYPES.VOICEOVER,
        sourceRef: 'ch2',
        baseFingerprint: ch2.fingerprint,
        generatedBody: '合同条款严谨无懈可击。'
    });

    // 初始状态下全新鲜
    const diff1 = diffImpactedArtifacts([post1, post2], [ch1, ch2]);
    if (!diff1.every(x => x.status === LINEAGE_STALE_STATUS.FRESH)) {
        problems.push('初始同版本比对状态应全为 fresh');
    }

    // 修改第一章，第二章不变
    const ch1v2 = normalizeSourceSegment({ sourceId: 'ch1', title: '第一章 偶遇(修)', content: '林舟初次在咖啡馆遇到周姐。' });
    const diff2 = diffImpactedArtifacts([post1, post2], [ch1v2, ch2]);
    const p1Report = diff2.find(x => x.artifactId === 'art_post1');
    const p2Report = diff2.find(x => x.artifactId === 'art_post2');
    if (p1Report?.status !== LINEAGE_STALE_STATUS.STALE_VERSION) {
        problems.push('源章节改动后对应成稿状态应为 stale_version');
    }
    if (p2Report?.status !== LINEAGE_STALE_STATUS.FRESH) {
        problems.push('未改动源章节的成稿状态应保持 fresh');
    }

    // 锁定段保护测试
    const updatedPost = applyUpdateWithLockProtection(post1, '林舟在咖啡馆喝拿铁，遇到了周姐。', ch1v2.fingerprint);
    if (!updatedPost.generatedBody.includes('命运的齿轮开始转动。')) {
        problems.push('更新成稿时人工锁定段被遗漏或抹除');
    }

    return { problems };
}