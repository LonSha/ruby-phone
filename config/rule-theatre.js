/* ========================================================
 * config/rule-theatre.js — [R8-X2 · 第八期规划] 规则剧场内核（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户不写代码也能编排会改变生活的条件规则：
 *     ① 声明式白名单触发器：message_received / calendar_due / idle_timeout / state_change；
 *     ② 白名单条件运算符：equals / greater_than / less_than / contains / in_list；
 *     ③ 白名单安全动作：propose_notification / create_memo / flag_calendar / suggest_dialogue；
 *     ④ 零动态求值、零外部脚本求值，纯数据驱动规则评估；
 *     ⑤ 会话隔离，支持单条规则暂停、执行计数与测试回放。
 * ======================================================== */
'use strict';

export const RT_STORAGE_KEY = 'rt_rules_state_v1';
export const RT_MAX_RULES = 30;

export const RULE_TRIGGERS = Object.freeze({
    MESSAGE_RECEIVED: 'message_received',
    CALENDAR_DUE: 'calendar_due',
    TIME_PASSED: 'time_passed',
    TASK_COMPLETED: 'task_completed',
    MOOD_CHANGED: 'mood_changed'
});

export const RULE_OPERATORS = Object.freeze({
    EQUALS: 'equals',
    CONTAINS: 'contains',
    GREATER_THAN: 'greater_than',
    LESS_THAN: 'less_than',
    IN_LIST: 'in_list'
});

export const RULE_ACTIONS = Object.freeze({
    PROPOSE_NOTIFICATION: 'propose_notification',
    CREATE_MEMO: 'create_memo',
    FLAG_CALENDAR: 'flag_calendar',
    SUGGEST_DIALOGUE: 'suggest_dialogue',
    TAG_RELATION: 'tag_relation'
});

function safeStr(v) { return (typeof v === 'string') ? v.trim() : ''; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

/**
 * 校验规则规格（纯声明式白名单）
 */
export function validateRuleSpec(spec) {
    if (!spec || typeof spec !== 'object') {
        return { valid: false, reason: 'rule-must-be-object' };
    }
    const id = safeStr(spec.id);
    const name = safeStr(spec.name);
    const trigger = safeStr(spec.trigger);
    if (!id || !name) {
        return { valid: false, reason: 'missing-id-or-name' };
    }
    if (!Object.values(RULE_TRIGGERS).includes(trigger)) {
        return { valid: false, reason: 'invalid-trigger' };
    }
    // 校验 actions
    const actions = safeArr(spec.actions);
    if (!actions.length) {
        return { valid: false, reason: 'actions-must-not-be-empty' };
    }
    for (const act of actions) {
        if (!act || !Object.values(RULE_ACTIONS).includes(safeStr(act.type))) {
            return { valid: false, reason: `unauthorized-action-${safeStr(act && act.type)}` };
        }
    }
    return { valid: true };
}

/**
 * 规格化规则状态
 */
export function normalizeRuleState(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            rules: {},
            executionLog: [],
            updatedAt: Date.now()
        };
    }
    const rules = {};
    if (raw.rules && typeof raw.rules === 'object') {
        for (const [id, r] of Object.entries(raw.rules)) {
            if (!r || typeof r !== 'object') continue;
            const rid = safeStr(r.id) || id;
            rules[rid] = {
                id: rid,
                name: safeStr(r.name) || '未命名规则',
                enabled: r.enabled !== false,
                trigger: Object.values(RULE_TRIGGERS).includes(r.trigger) ? r.trigger : RULE_TRIGGERS.MESSAGE_RECEIVED,
                conditions: safeArr(r.conditions),
                actions: safeArr(r.actions),
                fireCount: typeof r.fireCount === 'number' ? r.fireCount : 0,
                lastFiredAt: typeof r.lastFiredAt === 'number' ? r.lastFiredAt : null
            };
        }
    }
    return {
        rules,
        executionLog: safeArr(raw.executionLog).slice(-50),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 添加或更新规则
 */
export function registerRule(state, spec) {
    const s = normalizeRuleState(state);
    const check = validateRuleSpec(spec);
    if (!check.valid) {
        return { success: false, reason: check.reason, state: s };
    }
    const id = safeStr(spec.id);
    const rule = {
        id,
        name: safeStr(spec.name),
        enabled: spec.enabled !== false,
        trigger: spec.trigger,
        conditions: safeArr(spec.conditions),
        actions: safeArr(spec.actions),
        fireCount: 0,
        lastFiredAt: null
    };

    const nextRules = { ...s.rules, [id]: rule };
    return {
        success: true,
        rule,
        state: {
            ...s,
            rules: nextRules,
            updatedAt: Date.now()
        }
    };
}

/**
 * 评估单条条件
 */
function evaluateCondition(cond, context) {
    if (!cond || typeof cond !== 'object') return false;
    const field = safeStr(cond.field);
    const op = safeStr(cond.operator);
    const expected = cond.value;
    const actual = context ? context[field] : undefined;

    switch (op) {
        case RULE_OPERATORS.EQUALS:
            return actual === expected;
        case RULE_OPERATORS.CONTAINS:
            if (typeof actual === 'string' && typeof expected === 'string') {
                return actual.includes(expected);
            }
            if (Array.isArray(actual)) {
                return actual.includes(expected);
            }
            return false;
        case RULE_OPERATORS.GREATER_THAN:
            return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
        case RULE_OPERATORS.LESS_THAN:
            return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
        case RULE_OPERATORS.IN_LIST:
            return Array.isArray(expected) && expected.includes(actual);
        default:
            return false;
    }
}

/**
 * 评估环境事件触发的所有规则（返回待执行的动作清单，纯数据返回）
 */
export function evaluateEvent(state, event) {
    const s = normalizeRuleState(state);
    if (!event || typeof event !== 'object') {
        return { triggeredActions: [], state: s };
    }
    const trigger = safeStr(event.type);
    const payload = (event.payload && typeof event.payload === 'object') ? event.payload : {};

    const triggeredActions = [];
    const now = Date.now();
    let updatedRules = { ...s.rules };
    let hasChanges = false;

    for (const [rid, rule] of Object.entries(s.rules)) {
        if (!rule.enabled || rule.trigger !== trigger) continue;

        // 评估全部条件（AND 关系）
        let match = true;
        for (const cond of rule.conditions) {
            if (!evaluateCondition(cond, payload)) {
                match = false;
                break;
            }
        }

        if (match) {
            hasChanges = true;
            updatedRules[rid] = {
                ...rule,
                fireCount: rule.fireCount + 1,
                lastFiredAt: now
            };
            for (const act of rule.actions) {
                triggeredActions.push({
                    ruleId: rid,
                    ruleName: rule.name,
                    action: act,
                    timestamp: now
                });
            }
        }
    }

    const nextLog = hasChanges
        ? [...s.executionLog, ...triggeredActions.map(a => ({ ruleId: a.ruleId, actionType: a.action.type, at: now }))].slice(-50)
        : s.executionLog;

    return {
        triggeredActions,
        state: hasChanges ? { ...s, rules: updatedRules, executionLog: nextLog, updatedAt: now } : s
    };
}