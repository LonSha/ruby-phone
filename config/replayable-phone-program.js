/* ============================================================
 * config/replayable-phone-program.js — [R9-X7 · 第九期规划]
 * 可复演的手机经历节目单与多重视角重播器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   将手机经历（聊天、动态、事件记录）凝结为可复演的节目单：
 *     - 保存每个节点的参与者、当时可见材料、选择分支与错失机会
 *     - 支持不同角色视角 (perspective) 复演比对
 *     - 决不因复演修改底层的真实生活账本
 * ============================================================ */
export function createReplayableProgram(programTitle, steps = []) {
    const list = Array.isArray(steps) ? steps : [];
    return {
        programId: `prog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: String(programTitle || '').trim(),
        totalSteps: list.length,
        steps: list.map((s, idx) => ({
            stepIndex: idx,
            actorId: s.actorId || 'narrator',
            actionDescription: String(s.actionDescription || '').trim(),
            visibleData: s.visibleData || {},
            chosenOption: s.chosenOption || null,
            alternativeOptions: Array.isArray(s.alternativeOptions) ? s.alternativeOptions : []
        })),
        createdAt: Date.now()
    };
}

export function replayProgramStepByPerspective(program, stepIndex, perspectiveActorId) {
    if (!program || !Array.isArray(program.steps)) {
        return { success: false, reason: 'invalid_program' };
    }
    const step = program.steps[stepIndex];
    if (!step) {
        return { success: false, reason: 'step_out_of_bound' };
    }

    const isDirectActor = step.actorId === perspectiveActorId;
    const isPublicData = !step.visibleData.isPrivate;

    return {
        success: true,
        stepIndex,
        actorId: step.actorId,
        canObserveDetails: isDirectActor || isPublicData,
        observedData: (isDirectActor || isPublicData) ? step.visibleData : { summary: '未公开的动作' },
        missedOpportunities: step.alternativeOptions
    };
}