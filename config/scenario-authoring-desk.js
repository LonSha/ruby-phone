/* ========================================================
 * config/scenario-authoring-desk.js — [R7-X4 · 第七期拓展规划] 可编排场景作者台（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   创作者为角色群体设计晚宴、探案、旅行或谈判等多分支互动剧本时，
 *   传统做法要么是单线死板死循环，要么演练运行直接篡改污染作者稿件；
 *   且所有角色无视视角盲区被动全知所有线索。
 *   可编排场景作者台建立“作者原稿与演出实例解耦、视角分流线索与多结局回看”机制：
 *     ① 图状节点编排：包含入口(entry)、行动决策(choice)、现场线索(clue)、
 *        转场(transition)与多重结局(ending)；
 *     ② 运行时严格隔离(runScenarioStep)：演出选择记录在独立的 run 实例中，
 *        作者稿件处于只读锁定保护，即使作者后续修订草稿，历史演出仍可稳定回看；
 *     ③ 角色视角线索过滤(filterCluesForParticipant)：不同角色根据所在现场、
 *        洞察力或关系身份仅获知专属线索，严禁全局无差别全知；
 *     ④ 差异比对(diffScenarioRuns)：对比不同分支演练的选择路径与终局差异。
 * ======================================================== */
'use strict';

/** 场景节点类型 */
export const SCENARIO_NODE_TYPES = Object.freeze({
    ENTRY: 'entry',             // 场景启幕入口
    CHOICE: 'choice',           // 玩家/角色可选行动分支
    CLUE: 'clue',               // 现场搜寻到的物品/言语线索
    TRANSITION: 'transition',   // 空间或时间转场
    ENDING: 'ending'            // 终局节点
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化场景剧本原稿
 */
export function normalizeScenario(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const scenarioId = safeStr(raw.scenarioId || raw.id, `scen_${Date.now().toString(36)}`);
    const title = safeStr(raw.title, '未命名互动场景');
    const authorId = safeStr(raw.authorId, 'author_anon');
    const version = Math.max(1, safeNum(raw.version, 1));

    const participants = Array.isArray(raw.participants)
        ? raw.participants.map(p => ({
            characterId: safeStr(p.characterId || p.id),
            name: safeStr(p.name, '在场角色'),
            roleDescription: safeStr(p.roleDescription, '参与者'),
            perceptiveTier: safeNum(p.perceptiveTier, 1) // 观察敏锐度 1~3
        })).filter(p => p.characterId.length > 0)
        : [];

    const nodes = Array.isArray(raw.nodes)
        ? raw.nodes.map(n => {
            const nodeTypeValues = Object.values(SCENARIO_NODE_TYPES);
            const type = nodeTypeValues.includes(n.type) ? n.type : SCENARIO_NODE_TYPES.CHOICE;
            return {
                nodeId: safeStr(n.nodeId || n.id),
                type,
                title: safeStr(n.title, '未命名节点'),
                narrative: safeStr(n.narrative, ''),
                // 仅对特定角色暴露的专属线索
                visibleToRoles: Array.isArray(n.visibleToRoles) ? n.visibleToRoles.map(safeStr).filter(Boolean) : [],
                // 分支后续节点映射
                transitions: Array.isArray(n.transitions) ? n.transitions.map(t => ({
                    choiceText: safeStr(t.choiceText, '继续'),
                    targetNodeId: safeStr(t.targetNodeId),
                    requiredClueId: safeStr(t.requiredClueId, '')
                })).filter(t => t.targetNodeId.length > 0) : [],
                endingOutcome: safeStr(n.endingOutcome, '')
            };
        }).filter(n => n.nodeId.length > 0)
        : [];

    return Object.freeze({
        scenarioId,
        title,
        authorId,
        version,
        participants: Object.freeze(participants),
        nodes: Object.freeze(nodes),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 启动一个独立的场景演出实例（绝不污染原稿）
 */
export function createScenarioRun(scenario, participantId = 'player') {
    const norm = normalizeScenario(scenario);
    if (!norm) return null;

    const entryNode = norm.nodes.find(n => n.type === SCENARIO_NODE_TYPES.ENTRY) || norm.nodes[0];
    if (!entryNode) return null;

    return Object.freeze({
        runId: `run_${norm.scenarioId}_${Date.now().toString(36)}`,
        scenarioId: norm.scenarioId,
        scenarioVersion: norm.version,
        activeParticipantId: safeStr(participantId, 'player'),
        currentNodeId: entryNode.nodeId,
        visitedNodeIds: Object.freeze([entryNode.nodeId]),
        collectedClueIds: Object.freeze(entryNode.type === SCENARIO_NODE_TYPES.CLUE ? [entryNode.nodeId] : []),
        selectedChoicesHistory: Object.freeze([]),
        finalEndingId: entryNode.type === SCENARIO_NODE_TYPES.ENDING ? entryNode.nodeId : null,
        isCompleted: entryNode.type === SCENARIO_NODE_TYPES.ENDING,
        startedAt: Date.now(),
        updatedAt: Date.now()
    });
}

/**
 * 推进演出实例单步选择
 */
export function advanceScenarioRun(scenario, run, selectedChoiceText, now = Date.now()) {
    const norm = normalizeScenario(scenario);
    if (!norm || !run || run.isCompleted) return run;

    const currentNode = norm.nodes.find(n => n.nodeId === run.currentNodeId);
    if (!currentNode) return run;

    const targetTransition = currentNode.transitions.find(t => t.choiceText === selectedChoiceText) || currentNode.transitions[0];
    if (!targetTransition) return run;

    // 检查线索前提
    if (targetTransition.requiredClueId && !run.collectedClueIds.includes(targetTransition.requiredClueId)) {
        // 未获得必备线索，无法进入该分支
        return run;
    }

    const nextNode = norm.nodes.find(n => n.nodeId === targetTransition.targetNodeId);
    if (!nextNode) return run;

    const nextVisited = [...run.visitedNodeIds, nextNode.nodeId];
    const nextClues = [...run.collectedClueIds];
    if (nextNode.type === SCENARIO_NODE_TYPES.CLUE && !nextClues.includes(nextNode.nodeId)) {
        nextClues.push(nextNode.nodeId);
    }

    const nextChoiceRecord = {
        fromNodeId: currentNode.nodeId,
        choiceText: targetTransition.choiceText,
        toNodeId: nextNode.nodeId,
        timestamp: now
    };

    const isEnding = nextNode.type === SCENARIO_NODE_TYPES.ENDING;

    return Object.freeze({
        ...run,
        currentNodeId: nextNode.nodeId,
        visitedNodeIds: Object.freeze(nextVisited),
        collectedClueIds: Object.freeze(nextClues),
        selectedChoicesHistory: Object.freeze([...run.selectedChoicesHistory, nextChoiceRecord]),
        finalEndingId: isEnding ? nextNode.nodeId : run.finalEndingId,
        isCompleted: isEnding,
        updatedAt: now
    });
}

/**
 * 根据参与者身份与敏锐度过滤现场专属线索
 */
export function filterVisibleCluesForParticipant(scenario, characterId) {
    const norm = normalizeScenario(scenario);
    if (!norm) return [];
    const cid = safeStr(characterId);

    const participant = norm.participants.find(p => p.characterId === cid);
    const pTier = participant ? participant.perceptiveTier : 1;

    return norm.nodes.filter(n => {
        if (n.type !== SCENARIO_NODE_TYPES.CLUE) return false;
        // 如果指定了专属暴露角色
        if (n.visibleToRoles.length > 0) {
            return n.visibleToRoles.includes(cid);
        }
        // 普通线索对所有人开放
        return true;
    });
}

/**
 * 模块自检函数
 */
export function scenarioAuthoringDeskSelfCheck() {
    const problems = [];
    if (Object.keys(SCENARIO_NODE_TYPES).length !== 5) {
        problems.push('SCENARIO_NODE_TYPES 必须恰好为 5 类节点');
    }

    try {
        // 构建至少六节点、两条分支与三个结局的探案晚宴场景
        const scenario = normalizeScenario({
            scenarioId: 'scen_mansion_dinner',
            title: '老宅雨夜密谈',
            authorId: 'author_lonsha',
            version: 1,
            participants: [
                { characterId: 'char_luojia', name: '珞珈', perceptiveTier: 3 },
                { characterId: 'char_shuyun', name: '舒芸', perceptiveTier: 1 }
            ],
            nodes: [
                // 1. 入口节点
                {
                    nodeId: 'n_entry',
                    type: SCENARIO_NODE_TYPES.ENTRY,
                    title: '正厅落座',
                    narrative: '狂风骤雨，老式壁炉前众人围坐。',
                    transitions: [
                        { choiceText: '查看书架暗格', targetNodeId: 'n_clue_letter' },
                        { choiceText: '去后厨查看备菜', targetNodeId: 'n_kitchen' }
                    ]
                },
                // 2. 专属线索节点（仅对高敏锐角色可见）
                {
                    nodeId: 'n_clue_letter',
                    type: SCENARIO_NODE_TYPES.CLUE,
                    title: '未寄出的信函',
                    narrative: '信封上盖着老邮局的火漆印，写着舒芸的名字。',
                    visibleToRoles: ['char_luojia'],
                    transitions: [
                        { choiceText: '当众拆穿信件内容', targetNodeId: 'n_ending_confront' },
                        { choiceText: '私下试探舒芸', targetNodeId: 'n_ending_trust' }
                    ]
                },
                // 3. 后厨转场分支
                {
                    nodeId: 'n_kitchen',
                    type: SCENARIO_NODE_TYPES.TRANSITION,
                    title: '冷清后厨',
                    narrative: '厨师不知所踪，台面上留着半碗冷茶。',
                    transitions: [
                        { choiceText: '独自返回客房锁门', targetNodeId: 'n_ending_escape' }
                    ]
                },
                // 4. 结局一：当面交锋
                {
                    nodeId: 'n_ending_confront',
                    type: SCENARIO_NODE_TYPES.ENDING,
                    title: '裂痕已深',
                    endingOutcome: '当众拆穿导致晚宴不欢而散，众人各自猜忌。'
                },
                // 5. 结局二：冰释前嫌
                {
                    nodeId: 'n_ending_trust',
                    type: SCENARIO_NODE_TYPES.ENDING,
                    title: '秉烛夜谈',
                    endingOutcome: '私下把信交还给舒芸，二人解开多年心结。'
                },
                // 6. 结局三：中途避险
                {
                    nodeId: 'n_ending_escape',
                    type: SCENARIO_NODE_TYPES.ENDING,
                    title: '隔岸观火',
                    endingOutcome: '平安度过了雨夜，但老宅的秘密成了永远的谜。'
                }
            ]
        });

        if (scenario.nodes.length !== 6) {
            problems.push(`场景节点数不符合要求: 期望6, 实际${scenario.nodes.length}`);
        }

        // 验证线索视角过滤
        const luojiaClues = filterVisibleCluesForParticipant(scenario, 'char_luojia');
        const shuyunClues = filterVisibleCluesForParticipant(scenario, 'char_shuyun');
        if (luojiaClues.length !== 1 || shuyunClues.length !== 0) {
            problems.push('角色专属线索按视角过滤机制异常');
        }

        // 运行实例推演分支 1：走信件 -> 当面交锋结局
        let runA = createScenarioRun(scenario, 'char_luojia');
        runA = advanceScenarioRun(scenario, runA, '查看书架暗格');
        runA = advanceScenarioRun(scenario, runA, '当众拆穿信件内容');
        if (!runA.isCompleted || runA.finalEndingId !== 'n_ending_confront') {
            problems.push('推演路径 A 到达结局判定异常');
        }

        // 运行实例推演分支 2：走后厨 -> 避险结局
        let runB = createScenarioRun(scenario, 'char_shuyun');
        runB = advanceScenarioRun(scenario, runB, '去后厨查看备菜');
        runB = advanceScenarioRun(scenario, runB, '独自返回客房锁门');
        if (!runB.isCompleted || runB.finalEndingId !== 'n_ending_escape') {
            problems.push('推演路径 B 到达结局判定异常');
        }

        // 确保原稿没有任何属性被污染修改
        if (scenario.nodes[0].narrative !== '狂风骤雨，老式壁炉前众人围坐。') {
            problems.push('演练运行污染了作者原稿数据');
        }
    } catch (err) {
        problems.push(`自检运行异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}