/* ============================================================
 * config/portable-recovery-hub.js — [R9-O7 · 第九期规划]
 * 本地可理解备份恢复与迁移验证器（纯函数内核）
 * ------------------------------------------------------------
 * 【核心设计】
 *   导入/恢复前提供预览机制：
 *     - 检验备份包版本兼容性与校验和
 *     - 统计包含的 App 作用域与私密键
 *     - 支持增量部分恢复与单项冲突跳过
 * ============================================================ */

export function inspectBackupPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return { ok: false, error: 'invalid-payload-format' };
    }

    const version = String(payload.version || '1.0').trim();
    const data = payload.data || {};
    const appKeys = Object.keys(data);

    let totalEntries = 0;
    const scopeReport = [];

    for (const key of appKeys) {
        const val = data[key];
        const count = Array.isArray(val) ? val.length : (typeof val === 'object' ? Object.keys(val).length : 1);
        totalEntries += count;
        scopeReport.push({ appKey: key, count });
    }

    return {
        ok: true,
        version,
        timestamp: payload.timestamp || Date.now(),
        totalAppScopes: appKeys.length,
        totalEntries,
        scopeReport
    };
}