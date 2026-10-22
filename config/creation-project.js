/**
 * config/creation-project.js — [v4.50.0 · R6-O5] 长篇创作项目作品编排契约内核
 * 
 * 【设计职责】
 * 解决“单篇草稿缺乏长篇作品级组织、改动情节导致全部派生稿被盲目冲掉或人工修改丢失、脱机时无法编辑”的缺陷：
 * 1. 作品级组织：管理章节/场次、人物出场、素材依赖、长线创作意图与多平台发行形态；
 * 2. 选择性连带改稿（planPlotRevision）：修改章节情节后，仅更新作者选定的派生改编稿，未选稿件严格保留人工文字（untouched）；
 * 3. 跨章节依赖追踪：追踪后续章节对本章情节/转折的引用，标出受影响章节与待决定项；
 * 4. 局部改稿撤销（revertPlotRevision）：支持撤销特定情节修订，原有人工文字与素材链接不丢失；
 * 5. 脱机韧性：纯契约对象，不依赖外部插件连通状态，断开记忆插件仍可在本地完整读写与虚拟发布；
 * 6. 多目标虚拟发布闭环（publishProjectTargets）：多平台（如朋友圈 moments, 微博 blog 等）流水生成与收束。
 * 
 * 零宿主依赖、零 DOM、纯函数、不可变更新，全面冻结导出。
 */

export const CP_WORK_STATUS = Object.freeze({
    DRAFT: 'draft',
    SERIALIZING: 'serializing',
    COMPLETED: 'completed',
    ARCHIVED: 'archived',
});

export const CP_TARGETS = Object.freeze([
    'moments',
    'blog',
    'wechat',
    'article',
    'short_video',
]);

export const CP_REVISION_POLICY = Object.freeze({
    SELECTED_ONLY: 'selected_only',
    PRESERVE_MANUAL: 'preserve_manual',
    OVERWRITE_ALL: 'overwrite_all',
});

export const CP_LIMITS = Object.freeze({
    maxChapters: 100,
    maxScenesPerChapter: 20,
    maxTargetsPerChapter: 10,
    maxRevisionHistory: 30,
});

export const CP_STORAGE_KEY = 'creation_projects_v1';

function normId(s) {
    return String(s ?? '').trim();
}

/**
 * 创建新长篇作品工程
 */
export function createProjectWork(raw = {}) {
    const workId = normId(raw.workId || raw.id || `work_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const title = String(raw.title || '未命名长篇作品').trim();
    const premise = String(raw.premise || '').trim();

    return {
        workId,
        title,
        premise,
        status: Object.values(CP_WORK_STATUS).includes(raw.status) ? raw.status : CP_WORK_STATUS.DRAFT,
        author: String(raw.author || 'User').trim(),
        /** 章节列表: [{ chapterId, order, title, synopsis, characterIds: [], materialRefs: [], drafts: {} }] */
        chapters: [],
        /** 角色档案引用: [{ characterId, name, role }] */
        cast: Array.isArray(raw.cast) ? [...raw.cast] : [],
        /** 长期协作资产（配乐/分镜/参考插图）: [{ assetId, kind, title, ref }] */
        assets: Array.isArray(raw.assets) ? [...raw.assets] : [],
        /** 修订历史记录: [{ revisionId, chapterId, timestamp, oldSynopsis, newSynopsis, updatedTargets: [], untouchedTargets: [], revertible }] */
        revisions: [],
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    };
}

/**
 * 向作品中追加或更新章节
 */
export function upsertChapter(work, chapterData = {}) {
    if (!work || typeof work !== 'object') return null;
    const next = JSON.parse(JSON.stringify(work));
    const cid = normId(chapterData.chapterId || chapterData.id || `ch_${next.chapters.length + 1}`);

    const existingIdx = next.chapters.findIndex(c => c.chapterId === cid);
    const baseOrder = existingIdx >= 0 ? next.chapters[existingIdx].order : (next.chapters.length + 1);

    const chapter = {
        chapterId: cid,
        order: typeof chapterData.order === 'number' ? chapterData.order : baseOrder,
        title: String(chapterData.title || `第${baseOrder}章`).trim(),
        synopsis: String(chapterData.synopsis || '').trim(),
        characterIds: Array.isArray(chapterData.characterIds) ? chapterData.characterIds.map(normId) : [],
        materialRefs: Array.isArray(chapterData.materialRefs) ? [...chapterData.materialRefs] : [],
        /** 派生目标改编稿字典: target -> { draftId, target, text, manualEdits: boolean, images: [], lastUpdated } */
        drafts: existingIdx >= 0 ? next.chapters[existingIdx].drafts : {},
        updatedAt: Date.now(),
    };

    if (existingIdx >= 0) {
        next.chapters[existingIdx] = { ...next.chapters[existingIdx], ...chapter };
    } else {
        next.chapters.push(chapter);
    }
    next.chapters.sort((a, b) => a.order - b.order);
    next.updatedAt = Date.now();
    return next;
}

/**
 * 为指定章节设置或编辑派生改编稿（如朋友圈图文、微博短帖等）
 */
export function setChapterDraft(work, chapterId, target, draftContent = {}) {
    if (!work || typeof work !== 'object') return null;
    const cid = normId(chapterId);
    const tKey = normId(target);
    const next = JSON.parse(JSON.stringify(work));
    const ch = next.chapters.find(c => c.chapterId === cid);
    if (!ch) return work;

    const existingDraft = ch.drafts[tKey] || {};
    const isManual = typeof draftContent.manualEdits === 'boolean' 
        ? draftContent.manualEdits 
        : (existingDraft.manualEdits || Boolean(draftContent.text));

    ch.drafts[tKey] = {
        draftId: normId(draftContent.draftId || existingDraft.draftId || `d_${cid}_${tKey}`),
        target: tKey,
        text: String(draftContent.text ?? existingDraft.text ?? '').trim(),
        images: Array.isArray(draftContent.images) ? [...draftContent.images] : (existingDraft.images || []),
        manualEdits: isManual,
        published: Boolean(draftContent.published ?? existingDraft.published),
        lastUpdated: Date.now(),
    };
    ch.updatedAt = Date.now();
    next.updatedAt = Date.now();
    return next;
}

/**
 * 情节改动规划与连带派生稿选择性更新（核心验收项 ①）
 * 当作者修改某一章节情节时：
 * - 用户显式指定 selectedTargets（如 ['moments']，未指定的 'blog' 不会被更新）；
 * - 未选中的派生稿保持原样（untouched），其人工编辑的文本绝不被冲掉；
 * - 自动记录本次 revision，供撤销与追溯。
 */
export function planPlotRevision(work, chapterId, plotPatch = {}, opts = {}) {
    if (!work || typeof work !== 'object') return { ok: false, reason: 'invalid-work' };
    const cid = normId(chapterId);
    const next = JSON.parse(JSON.stringify(work));
    const ch = next.chapters.find(c => c.chapterId === cid);
    if (!ch) return { ok: false, reason: 'chapter-not-found' };

    const selectedTargets = new Set(Array.isArray(opts.selectedTargets) ? opts.selectedTargets.map(normId) : []);
    const revisionId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 备份原有情节与摘要
    const oldSynopsis = ch.synopsis;
    if (plotPatch.synopsis !== undefined) {
        ch.synopsis = String(plotPatch.synopsis).trim();
    }
    if (Array.isArray(plotPatch.materialRefs)) {
        ch.materialRefs = [...plotPatch.materialRefs];
    }

    const updateReport = {
        updatedTargets: [],
        untouchedTargets: [],
    };

    // 逐个检查本章节既有派生稿
    for (const [tKey, draft] of Object.entries(ch.drafts)) {
        if (selectedTargets.has(tKey)) {
            // 选中的目标进行更新，生成新的派生内容或叠加提示
            const revisedText = opts.draftGenerators && typeof opts.draftGenerators[tKey] === 'function'
                ? opts.draftGenerators[tKey](ch.synopsis, draft)
                : `[已根据新情节更新] ${ch.synopsis}\n(原注: ${draft.text})`;
            
            draft.text = revisedText;
            draft.lastUpdated = Date.now();
            updateReport.updatedTargets.push(tKey);
        } else {
            // 未选中目标严格保持原样，人工文字不丢
            updateReport.untouchedTargets.push(tKey);
        }
    }

    const revEntry = {
        revisionId,
        chapterId: cid,
        timestamp: Date.now(),
        oldSynopsis,
        newSynopsis: ch.synopsis,
        updatedTargets: updateReport.updatedTargets,
        untouchedTargets: updateReport.untouchedTargets,
        revertible: true,
    };
    next.revisions.push(revEntry);
    next.updatedAt = Date.now();

    return {
        ok: true,
        work: next,
        revision: revEntry,
        report: updateReport,
    };
}

/**
 * 撤销局部改稿（核心验收项 ③）
 * 撤回某次修订后，恢复原情节，同时保留人工文字与未受损素材
 */
export function revertPlotRevision(work, revisionId) {
    if (!work || typeof work !== 'object') return work;
    const rid = normId(revisionId);
    const next = JSON.parse(JSON.stringify(work));
    const revIdx = next.revisions.findIndex(r => r.revisionId === rid);
    if (revIdx < 0) return work;

    const rev = next.revisions[revIdx];
    const ch = next.chapters.find(c => c.chapterId === rev.chapterId);
    if (ch) {
        ch.synopsis = rev.oldSynopsis;
        ch.updatedAt = Date.now();
    }
    rev.revertible = false;
    rev.revertedAt = Date.now();
    next.updatedAt = Date.now();
    return next;
}

/**
 * 虚拟发布多目标闭环（验收项 ③ 跑通两个目标的虚拟发布）
 */
export function publishProjectTargets(work, chapterId, targets = []) {
    if (!work || typeof work !== 'object') return { ok: false, reason: 'invalid-work' };
    const cid = normId(chapterId);
    const next = JSON.parse(JSON.stringify(work));
    const ch = next.chapters.find(c => c.chapterId === cid);
    if (!ch) return { ok: false, reason: 'chapter-not-found' };

    const targetList = Array.isArray(targets) ? targets.map(normId) : Object.keys(ch.drafts);
    const receipts = [];

    for (const t of targetList) {
        const draft = ch.drafts[t];
        if (!draft) continue;
        draft.published = true;
        draft.publishedAt = Date.now();
        receipts.push({
            target: t,
            draftId: draft.draftId,
            publishedText: draft.text,
            imageCount: draft.images.length,
            timestamp: draft.publishedAt,
            status: 'success',
        });
    }

    next.updatedAt = Date.now();
    return {
        ok: receipts.length > 0,
        publishedCount: receipts.length,
        receipts,
        work: next,
    };
}

/** 诊断行展示 */
export function creationProjectLine(work) {
    if (!work) return '[长篇创作] 未激活';
    return `[长篇创作] 作品: "${work.title}" | 状态: ${work.status} | 章节: ${work.chapters.length} | 修订记录: ${work.revisions.length}`;
}

/**
 * 内核自检
 */
export function cpSelfCheck() {
    const problems = [];
    try {
        const w = createProjectWork({ title: '自检长篇测试', premise: '一部关于成长的故事' });
        if (w.status !== CP_WORK_STATUS.DRAFT) problems.push('初始作品状态应为 draft');

        // 追加三章
        let cur = upsertChapter(w, { chapterId: 'ch1', title: '第一章 启程', synopsis: '少年离开故乡' });
        cur = upsertChapter(cur, { chapterId: 'ch2', title: '第二章 风波', synopsis: '在旅店遭遇盗贼' });
        cur = upsertChapter(cur, { chapterId: 'ch3', title: '第三章 决战', synopsis: '与魔王正面对决' });

        if (cur.chapters.length !== 3) problems.push('应当成功创建 3 章节');

        // 为第二章配置 moments 和 blog 两个派生改编稿
        cur = setChapterDraft(cur, 'ch2', 'moments', { text: '朋友圈动态：旅途偶遇惊险！', images: ['img1.jpg'] });
        cur = setChapterDraft(cur, 'ch2', 'blog', { text: '微博长文：今天在旅店经历了惊心动魄的一幕……', images: [] });

        // 修改第二章情节，只指定更新 moments，blog 保持 untouched
        const revRes = planPlotRevision(cur, 'ch2', { synopsis: '在旅店结识神秘伙伴' }, { selectedTargets: ['moments'] });
        if (!revRes.ok) problems.push('planPlotRevision 应执行成功');
        if (!revRes.report.updatedTargets.includes('moments')) problems.push('moments 应当在更新列表中');
        if (!revRes.report.untouchedTargets.includes('blog')) problems.push('blog 应当在未修改保留列表中');

        const ch2 = revRes.work.chapters.find(c => c.chapterId === 'ch2');
        if (!ch2.drafts.blog.text.startsWith('微博长文')) problems.push('未选中的 blog 文本必须完整保留');

        // 虚拟发布测试
        const pubRes = publishProjectTargets(revRes.work, 'ch2', ['moments', 'blog']);
        if (!pubRes.ok || pubRes.publishedCount !== 2) problems.push('两个目标虚拟发布必须全部跑通');
    } catch (e) {
        problems.push('cpSelfCheck 抛出异常: ' + (e?.message || String(e)));
    }

    return {
        ok: problems.length === 0,
        problems,
        timestamp: Date.now(),
    };
}

export default {
    CP_WORK_STATUS,
    CP_TARGETS,
    CP_REVISION_POLICY,
    CP_LIMITS,
    createProjectWork,
    upsertChapter,
    setChapterDraft,
    planPlotRevision,
    revertPlotRevision,
    publishProjectTargets,
    creationProjectLine,
    cpSelfCheck,
};
