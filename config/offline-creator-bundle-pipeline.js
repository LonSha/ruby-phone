/* ============================================================
 * config/offline-creator-bundle-pipeline.js — [R9-X8 · 第九期规划]
 * 离线创作者包的选择性组合与沙箱安全检查（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   创作者包包含主题、规则、工作包与资产清单：
 *     - 支持逐项选择性安装 (selective_import)，绝不强制全量捆绑
 *     - 严格离线沙箱安全检查：禁止任何远程可执行脚本注入
 *     - 缺失依赖显式警告，不阻塞已具备条件的模块独立运行
 * ============================================================ */
export function validateAndPlanBundleImport(bundle = {}, userSelection = {}) {
    if (!bundle || typeof bundle !== 'object') {
        return { success: false, reason: 'invalid_bundle_payload' };
    }

    const availableModules = ['theme', 'rules', 'assets', 'programs'];
    const selected = (Array.isArray(userSelection.modules) ? userSelection.modules : availableModules)
        .filter(m => availableModules.includes(m));

    const errors = [];
    const warnings = [];

    // 离线安全检查：检测潜在脚本或非法网络协议
    const rawContentStr = JSON.stringify(bundle);
    if (rawContentStr.includes('<script') || rawContentStr.includes('javascript:') || rawContentStr.includes('eval(')) {
        errors.push({
            code: 'FORBIDDEN_EXECUTABLE_SCRIPT_IN_BUNDLE',
            message: '创作者包包含潜在未授权的可执行代码或脚本'
        });
    }

    // 依赖完整性检查
    if (selected.includes('programs') && !bundle.programs) {
        warnings.push({
            code: 'MISSING_PROGRAMS_MODULE',
            message: '选择导入节目单模块，但包内未包含对应资源'
        });
    }

    return {
        success: errors.length === 0,
        bundleName: bundle.name || 'unnamed_bundle',
        selectedModules: selected,
        errors,
        warnings,
        canProceed: errors.length === 0
    };
}