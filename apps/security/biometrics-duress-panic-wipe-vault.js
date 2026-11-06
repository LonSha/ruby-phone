/* ============================================================
 * biometrics-duress-panic-wipe-vault.js
 * [v4.137.0 · V20 史诗级双计划 · R20-17]
 * 胁迫指纹密码、紧急恐慌自毁与熔断擦除保险库 (Biometrics Duress & Panic Wipe Vault)
 *
 * 核心机制：
 * 1. 模拟现实高度安防系统的“胁迫密码/胁迫指纹”（Duress PIN / Duress Fingerprint）；
 * 2. 正常解锁展示平静界面；一旦输入预设的胁迫指纹（如特定手指）或胁迫PIN，系统立即静默向紧急联络人发送求救坐标；
 * 3. 恐慌熔断自毁（Panic Self-Destruct Wipe）：多次强行暴力破解或连续三次输错胁迫码，彻底粉碎敏感相册、聊天记录并回写为出厂假象；
 * 4. 向提示词管线注入遭枪口抵住或敌人搜查时假意顺从解锁、内心冷笑期待自毁触发的高张力指令。
 * ============================================================ */

export function createInitialDuressVaultState() {
  return {
    normalPin: '1234',
    duressPin: '9999',
    duressFingerprintIndex: 4, // 比如无名指为胁迫指纹
    duressTriggeredCount: 0,
    emergencyDistressDispatched: false,
    systemWiped: false,
    wipeHistory: []
  };
}

/**
 * 校验用户输入的指纹或 PIN 码
 */
export function authenticateWithDuressDetection(state, { inputPin, fingerprintIndex, currentGps = '31.2304,121.4737' }) {
  if (!state) return { success: false, isDuress: false };

  // 1. 命中胁迫密码或胁迫指纹
  const isDuress = (inputPin === state.duressPin) || (fingerprintIndex === state.duressFingerprintIndex);

  if (isDuress) {
    state.duressTriggeredCount += 1;
    state.emergencyDistressDispatched = true;

    return {
      success: true, // 表面上正常解锁，不引起施暴者/敌方怀疑
      isDuress: true,
      silentDistressPayload: {
        timestamp: new Date().toISOString(),
        gps: currentGps,
        alert: 'DURESS_UNLOCK_TRIGGERED_HOSTAGE_SITUATION'
      }
    };
  }

  // 2. 正常解锁
  if (inputPin === state.normalPin || fingerprintIndex === 1) {
    return { success: true, isDuress: false };
  }

  return { success: false, isDuress: false };
}

/**
 * 触发不可逆的恐慌自毁熔断
 */
export function triggerPanicWipe(state, { reason = 'HOSTILE_SEIZURE' } = {}) {
  if (!state) return;

  state.systemWiped = true;
  state.wipeHistory.push({
    wipedAt: new Date().toISOString(),
    reason,
    overwrittenSectors: 2048
  });
}

/**
 * 生成胁迫解锁与自毁求救提示词指令
 */
export function generateDuressDirectives(state) {
  if (!state) return '';

  if (state.systemWiped) {
    return `【手机硬件级安全熔断 · 绝密数据彻底自毁】\n` +
           `手机存储芯片核心扇区已执行不可逆覆盖擦除，所有加密相册、特工通讯录与机密账本已化为虚无！\n` +
           `指令要求：发话角色神色彻底放松或带着嘲讽，手机即便被敌人抢走也绝不可能恢复任何蛛丝马迹。`;
  }

  if (state.emergencyDistressDispatched) {
    return `【手机底层静默求救 · 胁迫解锁已生效】\n` +
           `发话角色刚才在被胁迫状态下输入了 [胁迫密码/指纹]，手机表面如常解锁，但后台已静默向救援组织发送了当前经纬度与遇险信标！\n` +
           `指令要求：发话角色在敌人面前装作温顺交出手机，内心冷静拖延时间，等待支援破门而入。`;
  }

  return '';
}

const BiometricsDuressPanicWipeVault = {
  createInitialDuressVaultState,
  authenticateWithDuressDetection,
  triggerPanicWipe,
  generateDuressDirectives
};

export default BiometricsDuressPanicWipeVault;