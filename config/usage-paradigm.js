/* ========================================================
 * config/usage-paradigm.js — [R8-O1 · 第八期规划] 手机使用范式内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   解决已有约80个App像孤立能力陈列的问题。
 *   让用户选择当前怎么使用 RubyPhone（如创作、生活、研究、沉浸、极简）：
 *     ① 预设与自定义范式：首页应用排序、优先级与折叠；
 *     ② 通知优先级阈值过滤；
 *     ③ 待办事项在特定范式下的专注筛选；
 *     ④ 会话隔离，状态可撤销与安全重置；
 *     ⑤ 绝不改动各业务 App 的实际底层数据与所有权。
 * ======================================================== */
'use strict';

export const UP_STORAGE_KEY = 'up_paradigm_state_v1';

export const PARADIGM_IDS = Object.freeze({
    CREATIVE: 'creative',     // 创作工坊：文字、长篇、媒体、设计优先
    LIFE: 'life',             // 日常生活：日历、微信、记账、出行、健康优先
    RESEARCH: 'research',     // 资料研读：研读、世界书、记忆、文献优先
    IMMERSIVE: 'immersive',   // 沉浸剧情：角色互动、居所、剧场、平行生活优先
    MINIMAL: 'minimal',       // 极简专注：仅保留核心通信与当前单个任务
    CUSTOM: 'custom'          // 用户自定义
});

export const DEFAULT_PARADIGMS = Object.freeze({
    [PARADIGM_IDS.LIFE]: {
        id: PARADIGM_IDS.LIFE,
        name: '日常生活',
        badge: '生活',
        description: '聚焦日程管理、人际联络、生活账目与健康追踪',
        priorityApps: ['wechat', 'calendar', 'accounting', 'focus', 'health'],
        deprioritizedApps: ['scenario-authoring-desk', 'reading-studio', 'multimedia-serial-studio'],
        noticeThreshold: 'all', // all | important | urgent_only
        quickActions: ['new_chat', 'check_calendar', 'quick_expense']
    },
    [PARADIGM_IDS.CREATIVE]: {
        id: PARADIGM_IDS.CREATIVE,
        name: '灵感创作',
        badge: '创作',
        description: '聚焦长篇写作、多媒体连载、角色立案与剧场设计',
        priorityApps: ['creation-project', 'multimedia-serial-studio', 'scenario-authoring-desk', 'memo'],
        deprioritizedApps: ['accounting', 'health', 'traveldesk'],
        noticeThreshold: 'important',
        quickActions: ['new_draft', 'open_project', 'record_inspiration']
    },
    [PARADIGM_IDS.RESEARCH]: {
        id: PARADIGM_IDS.RESEARCH,
        name: '资料研读',
        badge: '研读',
        description: '聚焦设定档案、世界书求证、口述史与关联推演',
        priorityApps: ['reading-studio', 'personal-dossier', 'relic-collection', 'worldbook'],
        deprioritizedApps: ['games', 'shop', 'wallet'],
        noticeThreshold: 'urgent_only',
        quickActions: ['search_archive', 'crosscheck_fact', 'open_dossier']
    },
    [PARADIGM_IDS.IMMERSIVE]: {
        id: PARADIGM_IDS.IMMERSIVE,
        name: '沉浸共处',
        badge: '沉浸',
        description: '聚焦角色居所、心绪共振、平行试玩与共同回忆',
        priorityApps: ['wechat', 'freehome', 'parallel-life-sandbox', 'festival-customs'],
        deprioritizedApps: ['accounting', 'reading-studio'],
        noticeThreshold: 'important',
        quickActions: ['visit_room', 'send_gift', 'open_sandbox']
    },
    [PARADIGM_IDS.MINIMAL]: {
        id: PARADIGM_IDS.MINIMAL,
        name: '极简专注',
        badge: '极简',
        description: '仅保留当前单项事务与紧急通知，减少干扰',
        priorityApps: ['wechat', 'focus'],
        deprioritizedApps: ['shop', 'games', 'traveldesk', 'multimedia-serial-studio', 'scenario-authoring-desk'],
        noticeThreshold: 'urgent_only',
        quickActions: ['focus_timer', 'return_last_task']
    }
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

/**
 * 状态规格化（纯函数）
 */
export function normalizeParadigmState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            activeId: PARADIGM_IDS.LIFE,
            customParadigms: {},
            lastSwitchedAt: Date.now(),
            history: []
        };
    }
    const activeId = safeStr(raw.activeId) || PARADIGM_IDS.LIFE;
    const custom = (raw.customParadigms && typeof raw.customParadigms === 'object') ? raw.customParadigms : {};
    return {
        activeId: Object.values(PARADIGM_IDS).includes(activeId) || custom[activeId] ? activeId : PARADIGM_IDS.LIFE,
        customParadigms: { ...custom },
        lastSwitchedAt: typeof raw.lastSwitchedAt === 'number' ? raw.lastSwitchedAt : Date.now(),
        history: safeArr(raw.history).slice(-20)
    };
}

/**
 * 获取当前活跃范式定义
 */
export function resolveActiveParadigm(state) {
    const s = normalizeParadigmState(state);
    if (s.customParadigms[s.activeId]) {
        return { ...s.customParadigms[s.activeId] };
    }
    if (DEFAULT_PARADIGMS[s.activeId]) {
        return { ...DEFAULT_PARADIGMS[s.activeId] };
    }
    return { ...DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE] };
}

/**
 * 切换使用范式
 */
export function switchParadigm(state, targetId, options = {}) {
    const s = normalizeParadigmState(state);
    const target = safeStr(targetId);
    const isValid = Object.values(PARADIGM_IDS).includes(target) || !!s.customParadigms[target];
    if (!isValid) {
        return {
            success: false,
            reason: 'unknown-paradigm-id',
            state: s
        };
    }
    const previous = s.activeId;
    if (previous === target) {
        return {
            success: true,
            noop: true,
            state: s
        };
    }
    const now = Date.now();
    const updated = {
        ...s,
        activeId: target,
        lastSwitchedAt: now,
        history: [
            ...s.history,
            {
                from: previous,
                to: target,
                timestamp: now,
                reason: safeStr(options.reason) || 'user-switch'
            }
        ].slice(-20)
    };
    return {
        success: true,
        previous,
        current: target,
        state: updated
    };
}

/**
 * 注册或更新自定义范式
 */
export function saveCustomParadigm(state, customSpec) {
    const s = normalizeParadigmState(state);
    if (!customSpec || typeof customSpec !== 'object') {
        return { success: false, reason: 'invalid-spec', state: s };
    }
    const id = safeStr(customSpec.id);
    const name = safeStr(customSpec.name);
    if (!id || !name) {
        return { success: false, reason: 'missing-id-or-name', state: s };
    }
    const paradigm = {
        id,
        name,
        badge: safeStr(customSpec.badge) || '自定',
        description: safeStr(customSpec.description) || '用户自定义范式',
        priorityApps: safeArr(customSpec.priorityApps).map(safeStr).filter(Boolean),
        deprioritizedApps: safeArr(customSpec.deprioritizedApps).map(safeStr).filter(Boolean),
        noticeThreshold: ['all', 'important', 'urgent_only'].includes(customSpec.noticeThreshold) ? customSpec.noticeThreshold : 'important',
        quickActions: safeArr(customSpec.quickActions).map(safeStr).filter(Boolean)
    };
    const updated = {
        ...s,
        customParadigms: {
            ...s.customParadigms,
            [id]: paradigm
        }
    };
    return {
        success: true,
        paradigm,
        state: updated
    };
}

/**
 * 根据当前范式计算应用主屏入口展示权重与排序
 */
export function resolveAppOrder(allApps, currentParadigm) {
    const list = safeArr(allApps);
    if (!list.length) return [];
    const p = currentParadigm || DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE];
    const priorities = new Set(safeArr(p.priorityApps));
    const deprioritized = new Set(safeArr(p.deprioritizedApps));

    const high = [];
    const normal = [];
    const low = [];

    for (const app of list) {
        const id = typeof app === 'string' ? app : (app && app.id);
        if (!id) continue;
        if (priorities.has(id)) {
            high.push(app);
        } else if (deprioritized.has(id)) {
            low.push(app);
        } else {
            normal.push(app);
        }
    }
    return [...high, ...normal, ...low];
}

/**
 * 根据当前范式过滤通知
 */
export function filterNoticesByParadigm(notices, currentParadigm) {
    const list = safeArr(notices);
    const p = currentParadigm || DEFAULT_PARADIGMS[PARADIGM_IDS.LIFE];
    const threshold = p.noticeThreshold || 'all';

    if (threshold === 'all') return [...list];
    return list.filter(item => {
        if (!item || typeof item !== 'object') return false;
        const level = safeStr(item.level) || 'normal';
        if (threshold === 'urgent_only') {
            return level === 'urgent' || item.isUrgent === true;
        }
        if (threshold === 'important') {
            return level === 'urgent' || level === 'important' || item.isImportant === true;
        }
        return true;
    });
}
