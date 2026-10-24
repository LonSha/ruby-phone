/* ========================================================
 * config/creator-bundle-ecosystem.js — [R8-X8 · 第八期规划] 手机内生创作者生态（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   用户将自制的主题、规则、工作包与资产清单进行组合打包分发：
 *     ① 结构化组合包（CreatorBundle）：装载 themes, rules, workPackages, assetCatalog；
 *     ② 依赖离线检视（inspectDependencies）：缺资源、缺 App 与私密排除清晰标注；
 *     ③ 接收方受控选择性安装与无损卸载；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */

export const STORAGE_KEY = 'cbe_creator_bundle_v1';

export const DEFAULT_BUNDLE_ECOSYSTEM_STATE = Object.freeze({
    installedBundles: {}, // bundleId -> { bundle, installedComponents, installedAt }
    updatedAt: 0
});

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeBundleEcosystemState(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_BUNDLE_ECOSYSTEM_STATE };
    return {
        installedBundles: (raw.installedBundles && typeof raw.installedBundles === 'object') ? { ...raw.installedBundles } : {},
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 组装一个创作者组合包
 */
export function buildCreatorBundle(bundleSpec, now = Date.now()) {
    const spec = (bundleSpec && typeof bundleSpec === 'object') ? bundleSpec : {};
    const id = safeStr(spec.id) || `cbundle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = safeStr(spec.title);

    if (!title) {
        return { success: false, reason: 'title-required', bundle: null };
    }

    const bundle = {
        id,
        title,
        version: safeStr(spec.version) || '1.0.0',
        author: safeStr(spec.author) || 'user',
        description: safeStr(spec.description),
        themes: safeArr(spec.themes),
        rules: safeArr(spec.rules),
        workPackages: safeArr(spec.workPackages),
        assetCatalog: safeArr(spec.assetCatalog),
        createdAt: now
    };

    return {
        success: true,
        bundle
    };
}

/**
 * 离线检视组合包依赖与缺项
 */
export function inspectBundleDependencies(bundle, localAvailableApps = []) {
    if (!bundle || typeof bundle !== 'object') {
        return { valid: false, reason: 'invalid-bundle' };
    }

    const availableAppSet = new Set(safeArr(localAvailableApps).map(safeStr));
    const missingApps = [];

    // 检查工作包中依赖的 App
    for (const pkg of safeArr(bundle.workPackages)) {
        for (const st of safeArr(pkg.steps)) {
            if (st.appId && !availableAppSet.has(st.appId)) {
                missingApps.push({ appId: st.appId, stepTitle: st.title, packageTitle: pkg.title });
            }
        }
    }

    return {
        valid: true,
        bundleId: bundle.id,
        hasMissingDependencies: missingApps.length > 0,
        missingApps,
        totalThemes: safeArr(bundle.themes).length,
        totalRules: safeArr(bundle.rules).length,
        totalPackages: safeArr(bundle.workPackages).length,
        totalAssets: safeArr(bundle.assetCatalog).length
    };
}

/**
 * 受控选择性安装创作者包
 */
export function installBundleSelective(state, bundle, selectedTypes = ['themes', 'rules', 'workPackages', 'assetCatalog'], now = Date.now()) {
    const s = normalizeBundleEcosystemState(state);
    if (!bundle || !bundle.id) {
        return { success: false, reason: 'invalid-bundle', state: s };
    }

    const types = safeArr(selectedTypes);
    const installedComponents = {};

    if (types.includes('themes')) installedComponents.themes = safeArr(bundle.themes);
    if (types.includes('rules')) installedComponents.rules = safeArr(bundle.rules);
    if (types.includes('workPackages')) installedComponents.workPackages = safeArr(bundle.workPackages);
    if (types.includes('assetCatalog')) installedComponents.assetCatalog = safeArr(bundle.assetCatalog);

    const record = {
        bundleId: bundle.id,
        bundleTitle: bundle.title,
        installedComponents,
        installedAt: now
    };

    return {
        success: true,
        record,
        state: {
            ...s,
            installedBundles: { ...s.installedBundles, [bundle.id]: record },
            updatedAt: now
        }
    };
}

/**
 * 卸载创作者包
 */
export function uninstallBundle(state, bundleId, now = Date.now()) {
    const s = normalizeBundleEcosystemState(state);
    const bId = safeStr(bundleId);

    if (!s.installedBundles[bId]) {
        return { success: false, reason: 'bundle-not-installed', state: s };
    }

    const nextBundles = { ...s.installedBundles };
    delete nextBundles[bId];

    return {
        success: true,
        state: {
            ...s,
            installedBundles: nextBundles,
            updatedAt: now
        }
    };
}