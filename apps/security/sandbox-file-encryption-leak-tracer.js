/* ============================================================
 * sandbox-file-encryption-leak-tracer.js
 * [v4.137.0 · V20 史诗级双计划 · R20-9]
 * 沙盒绝密文件分级加密与泄露溯源机 (Sandbox File Encryption Leak Tracer)
 *
 * 核心机制：
 * 1. 虚拟手机内部绝密文件管理（Top Secret Files）；
 * 2. 支持分级权限加密（AES-256 / 密码保护 / 生物识别解锁限制）；
 * 3. 当文件被非法转存、第三方截图或蓝牙私自传出时，计算文件泄露指数（Leak Index: 0.0..1.0），
 *    自动植入数字水印并向提示词管线注入机密泄露后果与恐慌追责指令。
 * ============================================================ */

export function createInitialFileSecurityState() {
  return {
    vaultFiles: {}, // fileId -> { name, classification: 'CONFIDENTIAL'|'SECRET'|'TOP_SECRET', isEncrypted: boolean, accessLog: string[], leakIndex: number }
    auditEvents: []
  };
}

/**
 * 录入或加密绝密文件
 */
export function registerSecureFile(state, { fileId, name, classification = 'SECRET', isEncrypted = true }) {
  if (!state || !fileId) return;
  state.vaultFiles[fileId] = {
    fileId,
    name: name || fileId,
    classification,
    isEncrypted: !!isEncrypted,
    accessLog: [],
    leakIndex: 0.0
  };
}

/**
 * 记录非合规外发或截图
 */
export function recordUnauthorizedAccess(state, fileId, { actor, action = 'SCREENSHOT_OR_TRANSFER' }) {
  if (!state || !state.vaultFiles[fileId]) return null;
  const file = state.vaultFiles[fileId];

  file.accessLog.push(`[${new Date().toISOString()}] ${actor} 执行了高危操作: ${action}`);
  file.leakIndex = Math.min(1.0, +(file.leakIndex + 0.45).toFixed(2));

  return file;
}

/**
 * 生成绝密外泄警报提示词指令
 */
export function generateSecurityLeakDirectives(state) {
  if (!state || !state.vaultFiles) return '';

  const leaking = Object.values(state.vaultFiles).filter(f => f.leakIndex >= 0.4);
  if (leaking.length === 0) return '';

  const issues = leaking.map(f => `- 绝密档案【${f.name}】（密级：${f.classification}）泄露指数达到 ${Math.round(f.leakIndex * 100)}%！已有违规转存与隐蔽截屏外泄迹象。`).join('\n');

  return `【手机绝密档案泄露溯源警报】\n` +
         `底层安全审计系统检测到绝密资料发生外泄：\n` +
         `${issues}\n` +
         `要求：发话中必须渗透出机密走漏的风声、反谍部门调查即将逼近的惊恐与紧急清理痕迹行动。`;
}

const SandboxFileEncryptionLeakTracer = {
  createInitialFileSecurityState,
  registerSecureFile,
  recordUnauthorizedAccess,
  generateSecurityLeakDirectives
};

export default SandboxFileEncryptionLeakTracer;