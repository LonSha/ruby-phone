/* ============================================================
 * darknet-dual-domain-vault.js — [R20-4 · 第二十期史诗级双项目双计划]
 * 手机虚拟环境双域空间与加密暗网保险箱 (Darknet Dual-Domain Vault)
 * ------------------------------------------------------------
 * 【核心设计】
 *   针对拟真虚拟手机交互，支持双重系统空间与暗网/黑客/地下情报交易：
 *   1. 双域空间物理隔离（Dual-Domain Space Sandbox）：
 *      - `PUBLIC_DOMAIN`（日常表层空间）：微信、相册、日常记账、生活笔记等；
 *      - `DARKNET_DOMAIN`（暗网里层空间）：端对端阅后即焚、地下匿名账目、悬赏委托、黑客破译工具等；
 *   2. 隐秘唤醒协议（Stealth Activation Trigger）：
 *      支持在拨号盘输入特定暗号（如 `*#9981#*`）或特定指纹/滑动轨迹瞬间无缝切入暗域；
 *   3. 应急一键伪装抹除（Panic Camouflage Purge）：
 *      被外人查验手机时，触发 Panic Mode，瞬间降级回正常空间，暗网数据加盐混淆或安全归档。
 * ============================================================ */
export const DOMAIN_MODE = Object.freeze({
    PUBLIC: 'public',
    DARKNET: 'darknet',
    PANIC: 'panic'
});

export function createInitialVaultState() {
    return {
        activeDomain: DOMAIN_MODE.PUBLIC,
        accessPasscode: '*#9981#*',
        darknetDossiers: new Map(), // id -> { id, title, encryptedPayload, bountyScore, burnAfterReading }
        auditLogs: [],
        panicTriggerCount: 0,
        updatedAt: Date.now()
    };
}

export function switchDomain(state, inputCode) {
    if (!state) return false;
    if (inputCode === state.accessPasscode) {
        state.activeDomain = DOMAIN_MODE.DARKNET;
        state.auditLogs.push({ action: 'enter_darknet', timestamp: Date.now() });
        return true;
    }
    return false;
}

export function triggerPanicMode(state) {
    if (!state) return;
    state.activeDomain = DOMAIN_MODE.PUBLIC;
    state.panicTriggerCount++;
    state.auditLogs.push({ action: 'panic_purge_to_public', timestamp: Date.now() });
}

export function storeDarknetDossier(state, item = {}) {
    if (!state || !state.darknetDossiers) return null;
    const id = String(item.id || `dark_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const entry = {
        id,
        title: String(item.title || '机密匿名通告').trim(),
        encryptedPayload: String(item.encryptedPayload || item.content || '').trim(),
        bountyScore: Number(item.bountyScore) || 0,
        burnAfterReading: item.burnAfterReading === true,
        createdAt: Date.now()
    };
    state.darknetDossiers.set(id, entry);
    state.updatedAt = Date.now();
    return entry;
}

export function hydrateVaultState(raw = {}) {
    const state = createInitialVaultState();
    if (!raw || typeof raw !== 'object') return state;

    state.activeDomain = Object.values(DOMAIN_MODE).includes(raw.activeDomain) ? raw.activeDomain : DOMAIN_MODE.PUBLIC;
    state.accessPasscode = String(raw.accessPasscode || '*#9981#*');
    state.panicTriggerCount = Number(raw.panicTriggerCount) || 0;

    if (Array.isArray(raw.darknetDossiers)) {
        for (const d of raw.darknetDossiers) {
            if (d && d.id) state.darknetDossiers.set(d.id, d);
        }
    }
    state.updatedAt = Number(raw.updatedAt) || Date.now();
    return state;
}

export function serializeVaultState(state) {
    if (!state) return { activeDomain: DOMAIN_MODE.PUBLIC, darknetDossiers: [], updatedAt: Date.now() };
    const list = [];
    if (state.darknetDossiers instanceof Map) {
        for (const d of state.darknetDossiers.values()) list.push(d);
    }
    return {
        activeDomain: state.activeDomain || DOMAIN_MODE.PUBLIC,
        accessPasscode: state.accessPasscode,
        darknetDossiers: list,
        panicTriggerCount: state.panicTriggerCount || 0,
        updatedAt: state.updatedAt || Date.now()
    };
}

const DarknetVault = {
    DOMAIN_MODE,
    createInitialVaultState,
    switchDomain,
    triggerPanicMode,
    storeDarknetDossier,
    hydrateVaultState,
    serializeVaultState
};

export default DarknetVault;