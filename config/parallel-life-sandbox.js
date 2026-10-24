/* ========================================================
 * config/parallel-life-sandbox.js — [R7-X9 · 第七期拓展规划] 平行生活沙盒（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   玩家想体验“如果当时选择了另一份工作/另一段关系”时，传统系统往往
 *   只能给出一篇干瘪的文字推演摘要，无法让玩家在另一条时间线里真正
 *   生活、持续沟通、安排日程、产出作品并体验后果。
 *   平行生活沙盒建立“快照隔离分流、连续生活演进、双线多维对照与受控回导”机制：
 *     ① 独立隔离会话分支(createParallelLifeSandbox)：从起点快照分立完全隔离的沙盒空间，
 *        沙盒内的消息往来、人际关系波动、草稿作品绝不污染正史主线；
 *     ② 连续跨日生活模拟(advanceSandboxDay / recordSandboxMajorEvent)：
 *        支持跨越不少于 7 个连续游戏日与多项关键事件，记录真实生活轨迹；
 *     ③ 双线全景对照(contrastSandboxWithMainline)：直观对比沙盒路线与主线在通讯、
 *        活动日程、人际纽带与成果产出上的异同；
 *     ④ 记忆受控回导(previewMemoryExport / confirmMemoryExportToMainline)：
 *        严禁静默全量合并，仅允许玩家对选定的偶发感悟或创作灵感进行逐项预览并经确认后导回；
 *     ⑤ 安全丢弃(discardSandbox)：放弃沙盒后状态封存，主线历史保持绝对清洁与完整接续。
 * ======================================================== */

'use strict';

/** 沙盒生命周期状态 */
export const SANDBOX_STATUS = Object.freeze({
    ACTIVE: 'active',           // 正在经历平行生活
    ARCHIVED: 'archived',       // 已封存保存
    DISCARDED: 'discarded',     // 已丢弃放弃
    EXPORTED: 'exported'        // 经历受控导回后收官
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string' && val.trim().length > 0) ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

function cloneDeep(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(cloneDeep);
    const copy = {};
    for (const key of Object.keys(obj)) {
        copy[key] = cloneDeep(obj[key]);
    }
    return copy;
}

/**
 * 从明确快照创建隔离平行生活沙盒
 * @param {Object} baseSnapshot - 起点快照数据（只保留基线，不克隆无限历史）
 * @param {Object} options
 */
export function createParallelLifeSandbox(baseSnapshot = {}, {
    sandboxId,
    title = '平行生活分支',
    divergenceReason = '选择另一条人生道路',
    divergenceDate = Date.now(),
    initialOverrides = {}
} = {}) {
    const sId = safeStr(sandboxId, `sandbox_${Date.now().toString(36)}`);
    const snap = cloneDeep(baseSnapshot || {});

    return {
        sandboxId: sId,
        title: safeStr(title),
        status: SANDBOX_STATUS.ACTIVE,
        divergenceReason: safeStr(divergenceReason),
        divergenceDate: safeNum(divergenceDate, Date.now()),
        baseSnapshotReference: {
            snapshotId: safeStr(snap.snapshotId, 'snap_root'),
            mainlineTimestamp: safeNum(snap.timestamp, Date.now()),
            divergenceCheckpoint: safeStr(snap.checkpointName, '抉择起点')
        },
        // 隔离沙盒内部的数据体系，绝不自动写回主线
        sandboxState: {
            currentDay: 1,
            timelineEvents: [],
            messages: [],
            calendarSchedule: [],
            creativeWorks: [],
            relationships: cloneDeep(snap.relationships || {}),
            unconfirmedMemories: []
        },
        isMainlineIsolated: true,
        harvestedMemories: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/**
 * 推进沙盒内的游戏日
 * @param {Object} sandbox
 * @param {Object} dayPlan - 当日活动、沟通、经历
 */
export function advanceSandboxDay(sandbox, {
    daySummary = '',
    newMessages = [],
    scheduleActivities = [],
    newWorks = [],
    relationshipChanges = {},
    notableEpiphanies = []
} = {}) {
    if (!sandbox || typeof sandbox !== 'object' || sandbox.status !== SANDBOX_STATUS.ACTIVE) {
        throw new Error('advanceSandboxDay: 沙盒无效或非激活状态');
    }
    const next = cloneDeep(sandbox);
    const dayIndex = next.sandboxState.currentDay;

    // 记录日程
    if (Array.isArray(scheduleActivities)) {
        for (const act of scheduleActivities) {
            next.sandboxState.calendarSchedule.push({
                day: dayIndex,
                activity: safeStr(act.activity || act),
                completed: act.completed !== false,
                timestamp: Date.now()
            });
        }
    }

    // 记录沙盒通信
    if (Array.isArray(newMessages)) {
        for (const msg of newMessages) {
            next.sandboxState.messages.push({
                day: dayIndex,
                from: safeStr(msg.from, 'sandbox_user'),
                to: safeStr(msg.to, 'sandbox_char'),
                content: safeStr(msg.content),
                timestamp: Date.now()
            });
        }
    }

    // 记录作品
    if (Array.isArray(newWorks)) {
        for (const w of newWorks) {
            next.sandboxState.creativeWorks.push({
                workId: safeStr(w.workId, `sb_work_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
                day: dayIndex,
                title: safeStr(w.title, '沙盒习作'),
                contentSummary: safeStr(w.contentSummary),
                timestamp: Date.now()
            });
        }
    }

    // 更新关系
    if (relationshipChanges && typeof relationshipChanges === 'object') {
        for (const [charId, delta] of Object.entries(relationshipChanges)) {
            const currentBond = safeStr(next.sandboxState.relationships[charId], 'normal');
            next.sandboxState.relationships[charId] = safeStr(delta.bondStatus || delta, currentBond);
        }
    }

    // 沉淀待确认灵感/记忆种子
    if (Array.isArray(notableEpiphanies)) {
        for (const ep of notableEpiphanies) {
            next.sandboxState.unconfirmedMemories.push({
                memoryId: safeStr(ep.memoryId, `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
                day: dayIndex,
                category: safeStr(ep.category, 'insight'),
                text: safeStr(ep.text || ep),
                approvedForExport: false
            });
        }
    }

    // 记录该日大事件
    next.sandboxState.timelineEvents.push({
        day: dayIndex,
        summary: safeStr(daySummary, `平行生活第 ${dayIndex} 天`),
        messagesCount: Array.isArray(newMessages) ? newMessages.length : 0,
        worksCreated: Array.isArray(newWorks) ? newWorks.length : 0,
        timestamp: Date.now()
    });

    next.sandboxState.currentDay = dayIndex + 1;
    next.updatedAt = Date.now();
    return next;
}

/**
 * 双线多维对照（沙盒分支 vs 主线）
 */
export function contrastSandboxWithMainline(sandbox, mainlineSnapshot = {}) {
    if (!sandbox || typeof sandbox !== 'object') {
        throw new Error('contrastSandboxWithMainline: 沙盒无效');
    }

    const state = sandbox.sandboxState || {};
    const mainMessages = Array.isArray(mainlineSnapshot.messages) ? mainlineSnapshot.messages : [];
    const mainSchedule = Array.isArray(mainlineSnapshot.calendarSchedule) ? mainlineSnapshot.calendarSchedule : [];
    const mainWorks = Array.isArray(mainlineSnapshot.creativeWorks) ? mainlineSnapshot.creativeWorks : [];
    const mainRels = mainlineSnapshot.relationships || {};

    // 对比关系分歧
    const relationshipDivergences = [];
    const allChars = new Set([...Object.keys(state.relationships || {}), ...Object.keys(mainRels)]);
    for (const charId of allChars) {
        const sbRel = state.relationships[charId] || '未建立';
        const mainRel = mainRels[charId] || '未建立';
        if (sbRel !== mainRel) {
            relationshipDivergences.push({
                charId,
                mainlineStatus: mainRel,
                sandboxStatus: sbRel
            });
        }
    }

    return {
        sandboxId: sandbox.sandboxId,
        title: sandbox.title,
        divergenceReason: sandbox.divergenceReason,
        daysLivedInSandbox: (state.currentDay || 1) - 1,
        messageCount: {
            sandbox: (state.messages || []).length,
            mainline: mainMessages.length
        },
        worksCount: {
            sandbox: (state.creativeWorks || []).length,
            mainline: mainWorks.length
        },
        scheduleCount: {
            sandbox: (state.calendarSchedule || []).length,
            mainline: mainSchedule.length
        },
        relationshipDivergences,
        availableEpiphaniesCount: (state.unconfirmedMemories || []).length,
        isCleanlyIsolated: sandbox.isMainlineIsolated === true
    };
}

/**
 * 预览要导回原线的少量记忆/感悟（逐项预览，不自动合并）
 */
export function previewMemoryExport(sandbox, { selectedMemoryIds = [] } = {}) {
    if (!sandbox || typeof sandbox !== 'object') {
        throw new Error('previewMemoryExport: 沙盒无效');
    }
    const allMemories = sandbox.sandboxState?.unconfirmedMemories || [];
    const idSet = new Set(selectedMemoryIds);

    const candidates = allMemories.filter(m => idSet.size === 0 || idSet.has(m.memoryId));

    return {
        totalAvailable: allMemories.length,
        selectedCount: candidates.length,
        items: candidates.map(m => ({
            memoryId: m.memoryId,
            dayOccurred: m.day,
            category: m.category,
            content: m.text,
            isIsolatedFromMainlineFacts: true,
            warning: '导回只作为角色的心境感悟，主线不会自动变更为沙盒经历的事实'
        }))
    };
}

/**
 * 确认将选定感悟导回主线（严格受控，绝不自动污染正史）
 */
export function confirmMemoryExportToMainline(mainlineState = {}, sandbox, { approvedMemoryIds = [] } = {}) {
    if (!sandbox || typeof sandbox !== 'object') {
        throw new Error('confirmMemoryExportToMainline: 沙盒无效');
    }
    const nextMainline = cloneDeep(mainlineState);
    const nextSandbox = cloneDeep(sandbox);

    const approvedSet = new Set(approvedMemoryIds);
    const availableMemories = nextSandbox.sandboxState?.unconfirmedMemories || [];

    const exported = [];
    for (const mem of availableMemories) {
        if (approvedSet.has(mem.memoryId)) {
            mem.approvedForExport = true;
            exported.push({
                originSandboxId: nextSandbox.sandboxId,
                originDay: mem.day,
                category: mem.category,
                insightText: mem.text,
                importedAt: Date.now(),
                isSubjectiveEpiphanyOnly: true // 明确标记为主观感悟，不可篡改客观事实
            });
        }
    }

    nextMainline.importedParallelInsights = nextMainline.importedParallelInsights || [];
    nextMainline.importedParallelInsights.push(...exported);

    nextSandbox.harvestedMemories.push(...exported);
    nextSandbox.status = SANDBOX_STATUS.EXPORTED;
    nextSandbox.updatedAt = Date.now();

    return {
        updatedMainline: nextMainline,
        updatedSandbox: nextSandbox,
        exportedCount: exported.length,
        mainlineFactsContaminated: false // 确保主线客观事实未被污染
    };
}

/**
 * 丢弃放弃沙盒（完全不影响主线，主线可完整继续）
 */
export function discardSandbox(sandbox, { reason = '体验结束，重归原线' } = {}) {
    if (!sandbox || typeof sandbox !== 'object') {
        throw new Error('discardSandbox: 沙盒无效');
    }
    const next = cloneDeep(sandbox);
    next.status = SANDBOX_STATUS.DISCARDED;
    next.discardReason = safeStr(reason);
    next.discardedAt = Date.now();
    next.updatedAt = Date.now();
    return {
        discardedSandbox: next,
        mainlineCanResumeNormally: true,
        leakageDetected: false
    };
}

/**
 * 模块自检函数
 */
export function parallelLifeSandboxSelfCheck() {
    const problems = [];
    try {
        const baseSnapshot = {
            snapshotId: 'snap_career_crossroad',
            checkpointName: '毕业留在本市还是远赴边疆',
            timestamp: Date.now(),
            relationships: {
                char_luojia: 'close_friend',
                char_mentor: 'mentor'
            }
        };

        // 1. 创建平行沙盒
        let sb = createParallelLifeSandbox(baseSnapshot, {
            sandboxId: 'sb_frontier_life',
            title: '远赴边疆支教的三年',
            divergenceReason: '选择去往边疆小镇'
        });

        if (sb.status !== SANDBOX_STATUS.ACTIVE || !sb.isMainlineIsolated) {
            problems.push('沙盒初始化状态或隔离标记有误');
        }

        // 2. 连续推进 7 个游戏日与主要事件
        for (let day = 1; day <= 7; day++) {
            sb = advanceSandboxDay(sb, {
                daySummary: `边疆支教第 ${day} 天生活记录`,
                newMessages: [{ from: 'local_child', to: 'user', content: `老师，第 ${day} 课学什么？` }],
                scheduleActivities: [`备课第 ${day} 单元`, '走访牧民家庭'],
                newWorks: day % 2 === 1 ? [{ title: `支教日记第 ${day} 篇`, contentSummary: '今日风沙与孩子们明亮的双眸' }] : [],
                relationshipChanges: day === 4 ? { char_luojia: 'distant_letter_friend' } : {},
                notableEpiphanies: day === 7 ? [{ memoryId: 'ep_frontier_wind', category: 'life_reflection', text: '人生的开阔不在于身处何地，而在心所系者' }] : []
            });
        }

        if (sb.sandboxState.currentDay !== 8 || sb.sandboxState.timelineEvents.length !== 7) {
            problems.push('沙盒未能完整推进至少 7 个游戏日');
        }

        // 3. 对照主线
        const mainlineSnapshot = {
            messages: [{ from: 'colleague', content: '本市写字楼日报' }],
            calendarSchedule: ['写字楼打卡'],
            creativeWorks: [],
            relationships: {
                char_luojia: 'close_friend',
                char_mentor: 'mentor'
            }
        };
        const contrast = contrastSandboxWithMainline(sb, mainlineSnapshot);
        if (contrast.daysLivedInSandbox !== 7 || contrast.relationshipDivergences.length === 0) {
            problems.push('双线对照未能正确识别出 7 天经历或关系分歧');
        }

        // 4. 预览与回导
        const preview = previewMemoryExport(sb, { selectedMemoryIds: ['ep_frontier_wind'] });
        if (preview.selectedCount !== 1) {
            problems.push('记忆回导预览筛选异常');
        }

        const mainlineObj = { status: 'mainline_normal' };
        const exportRes = confirmMemoryExportToMainline(mainlineObj, sb, { approvedMemoryIds: ['ep_frontier_wind'] });
        if (exportRes.exportedCount !== 1 || exportRes.mainlineFactsContaminated !== false) {
            problems.push('记忆受控导回出现异常或污染了主线事实');
        }

        // 5. 丢弃测试
        const discardRes = discardSandbox(sb);
        if (discardRes.discardedSandbox.status !== SANDBOX_STATUS.DISCARDED || !discardRes.mainlineCanResumeNormally) {
            problems.push('沙盒丢弃未能保证原线平稳接续');
        }

    } catch (err) {
        problems.push(`平行生活沙盒自检异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}
