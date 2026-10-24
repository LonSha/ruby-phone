/* ============================================================
 * config/orchestrated-life-scenario.js — [R9-X2 · 第九期规划]
 * 可编排的生活事件剧本与分支演化引擎（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   将生活互动（旅行、争论、重大交付、庆典）编排为具备因果分支的剧本：
 *     - 每个节点定义入口条件、知情者、可感知细节与抉择分支
 *     - 记录用户与角色的真实抉择轨迹与错失机会 (missed_opportunities)
 *     - 纯快照机制运行，不篡改历史既成事实
 * ============================================================ */
export function advanceScenarioNode(scenario, currentNodeId, chosenBranchId) {
    if (!scenario || !Array.isArray(scenario.nodes)) {
        return { success: false, reason: 'invalid_scenario' };
    }

    const currentNode = scenario.nodes.find(n => n.id === currentNodeId);
    if (!currentNode) {
        return { success: false, reason: 'node_not_found' };
    }

    const branch = (currentNode.branches || []).find(b => b.id === chosenBranchId);
    if (!branch) {
        return { success: false, reason: 'branch_not_found' };
    }

    const nextNode = scenario.nodes.find(n => n.id === branch.targetNodeId);
    const missedBranches = (currentNode.branches || [])
        .filter(b => b.id !== chosenBranchId)
        .map(b => ({ branchId: b.id, label: b.label }));

    return {
        success: true,
        previousNodeId: currentNodeId,
        chosenBranchId,
        currentNodeId: nextNode ? nextNode.id : null,
        isCompleted: !nextNode,
        missedBranches,
        timestamp: Date.now()
    };
}