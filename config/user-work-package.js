/* ========================================================
 * config/user-work-package.js — [R8-O6 · 第八期规划] 用户工作包（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户常用的多 App 协作流程（如“约人-排期-采购-确认”或“资料-批注-创作-发布”）
 *   需要保存成属于自己的可复用工具箱：
 *     ① 声明式步骤链条：保存 appId、动作意图、默认参数与前置依赖；
 *     ② 运行时可变性：支持单步跳过、参数覆盖、失败分支与重新确认；
 *     ③ 无任意代码执行风险：仅基于白名单意图与数据映射；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */

export const WORK_PACKAGE_STEP_STATUS = Object.freeze({
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    SKIPPED: 'skipped',
    FAILED: 'failed'
});

export const STORAGE_KEY = 'uwp_work_packages_v1';

export const DEFAULT_WORK_PACKAGE_STATE = Object.freeze({
    packages: {}, // id -> packageTemplate
    instances: {}, // instanceId -> runtimeInstance
    updatedAt: 0
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeWorkPackageState(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_WORK_PACKAGE_STATE };
    return {
        packages: (raw.packages && typeof raw.packages === 'object') ? { ...raw.packages } : {},
        instances: (raw.instances && typeof raw.instances === 'object') ? { ...raw.instances } : {},
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 注册或更新用户工作包模板
 */
export function saveWorkPackage(state, packageSpec, now = Date.now()) {
    const s = normalizeWorkPackageState(state);
    const spec = (packageSpec && typeof packageSpec === 'object') ? packageSpec : {};
    const id = safeStr(spec.id) || `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = safeStr(spec.title);
    const steps = safeArr(spec.steps);

    if (!title || steps.length === 0) {
        return { success: false, reason: 'title-and-steps-required', state: s };
    }

    const normalizedSteps = steps.map((st, idx) => ({
        id: safeStr(st.id) || `step_${idx + 1}`,
        title: safeStr(st.title) || `步骤 ${idx + 1}`,
        appId: safeStr(st.appId),
        intent: safeStr(st.intent),
        defaultParams: (st.defaultParams && typeof st.defaultParams === 'object') ? { ...st.defaultParams } : {},
        optional: Boolean(st.optional)
    }));

    const pkg = {
        id,
        title,
        description: safeStr(spec.description),
        steps: normalizedSteps,
        createdAt: now,
        updatedAt: now
    };

    return {
        success: true,
        package: pkg,
        state: {
            ...s,
            packages: { ...s.packages, [id]: pkg },
            updatedAt: now
        }
    };
}

/**
 * 基于模板启动一次工作流实例
 */
export function startWorkPackageInstance(state, packageId, initialInputs = {}, now = Date.now()) {
    const s = normalizeWorkPackageState(state);
    const pkg = s.packages[safeStr(packageId)];

    if (!pkg) {
        return { success: false, reason: 'package-not-found', state: s };
    }

    const instanceId = `inst_${pkg.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const stepStates = pkg.steps.map((st, idx) => ({
        stepId: st.id,
        status: idx === 0 ? WORK_PACKAGE_STEP_STATUS.RUNNING : WORK_PACKAGE_STEP_STATUS.PENDING,
        params: { ...st.defaultParams, ...(initialInputs[st.id] || {}) },
        result: null,
        error: null
    }));

    const instance = {
        instanceId,
        packageId: pkg.id,
        packageTitle: pkg.title,
        currentStepIndex: 0,
        isCompleted: false,
        stepStates,
        createdAt: now,
        updatedAt: now
    };

    return {
        success: true,
        instance,
        state: {
            ...s,
            instances: { ...s.instances, [instanceId]: instance },
            updatedAt: now
        }
    };
}

/**
 * 推进当前步骤（完成或跳过）
 */
export function advanceInstanceStep(state, instanceId, action = 'complete', outcome = null, now = Date.now()) {
    const s = normalizeWorkPackageState(state);
    const inst = s.instances[safeStr(instanceId)];

    if (!inst) {
        return { success: false, reason: 'instance-not-found', state: s };
    }
    if (inst.isCompleted) {
        return { success: false, reason: 'instance-already-completed', state: s };
    }

    const currIdx = inst.currentStepIndex;
    const currentStep = inst.stepStates[currIdx];

    let newStatus = WORK_PACKAGE_STEP_STATUS.COMPLETED;
    if (action === 'skip') {
        newStatus = WORK_PACKAGE_STEP_STATUS.SKIPPED;
    } else if (action === 'fail') {
        newStatus = WORK_PACKAGE_STEP_STATUS.FAILED;
    }

    const nextStepStates = [...inst.stepStates];
    nextStepStates[currIdx] = {
        ...currentStep,
        status: newStatus,
        result: outcome,
        completedAt: now
    };

    const nextIdx = currIdx + 1;
    const isCompleted = nextIdx >= nextStepStates.length;

    if (!isCompleted) {
        nextStepStates[nextIdx] = {
            ...nextStepStates[nextIdx],
            status: WORK_PACKAGE_STEP_STATUS.RUNNING
        };
    }

    const updatedInstance = {
        ...inst,
        currentStepIndex: isCompleted ? currIdx : nextIdx,
        isCompleted,
        stepStates: nextStepStates,
        updatedAt: now
    };

    return {
        success: true,
        instance: updatedInstance,
        isCompleted,
        state: {
            ...s,
            instances: { ...s.instances, [inst.instanceId]: updatedInstance },
            updatedAt: now
        }
    };
}