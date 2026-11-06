/* ============================================================
 * sim-card-carrier-imsi-switcher.js
 * [v4.137.0 · V20 史诗级双计划 · R20-12]
 * 双卡双待、国际漫游与伪基站 IMSI 嗅探防御机 (SIM Carrier & IMSI Catcher Guard)
 *
 * 核心机制：
 * 1. 模拟现实手机真实双卡/eSIM国际漫游槽位（MCC/MNC 真实电信网络识别）；
 * 2. 国际漫游时差、漫游资费与境外接入专线（Roaming APN）；
 * 3. 攻防反谍：检测未加密 2G GSM 强制降级攻击（典型 IMSI Catcher 伪基站攻击）；
 * 4. 触发安全警报并向提示词管线注入通话遭窃听风险与更换安全频道指令。
 * ============================================================ */

export function createInitialSimCarrierState() {
  return {
    activeSlot: 1, // 1 | 2
    slots: {
      1: {
        slotId: 1,
        carrierName: '中国移动',
        mccMnc: '46000',
        imsi: '460001889201923',
        phoneNumber: '+86 138****0192',
        roamingActive: false,
        encryptedChannel: true
      },
      2: {
        slotId: 2,
        carrierName: '境外虚拟eSIM (Global Roam)',
        mccMnc: '310410',
        imsi: '310410992817263',
        phoneNumber: '+1 415****8821',
        roamingActive: true,
        encryptedChannel: true
      }
    },
    imsiCatcherAttacksDetected: []
  };
}

/**
 * 切换活跃数据卡槽
 */
export function switchActiveSimSlot(state, slotId) {
  if (!state || (slotId !== 1 && slotId !== 2)) return;
  state.activeSlot = slotId;
}

/**
 * 检测当前蜂窝环境是否存在伪基站嗅探
 */
export function inspectBaseStationEnvironment(state, { cellTowerId, signalProtocol = '5G-SA', encryptionEnabled = true, forced2GDowngrade = false }) {
  if (!state) return null;

  // 伪基站典型特征：将终端强制降级到毫无鉴权保护的 2G GSM 频段
  const isSuspicious = forced2GDowngrade || (!encryptionEnabled && signalProtocol.includes('2G'));
  if (isSuspicious) {
    const attackRecord = {
      detectedAt: new Date().toISOString(),
      cellTowerId: cellTowerId || 'fake_bts_' + Math.random().toString(36).slice(2, 6),
      protocol: signalProtocol,
      attackType: 'IMSI_CATCHER_INTERCEPTION',
      riskLevel: 'CRITICAL'
    };
    state.imsiCatcherAttacksDetected.push(attackRecord);
    return attackRecord;
  }
  return null;
}

/**
 * 生成通信安全与基站监听警报指令
 */
export function generateSimSecurityDirectives(state) {
  if (!state) return '';

  if (state.imsiCatcherAttacksDetected.length > 0) {
    const latest = state.imsiCatcherAttacksDetected[state.imsiCatcherAttacksDetected.length - 1];
    return `【手机射频安全警报 · 检出伪基站 IMSI 嗅探监听】\n` +
           `手机基带芯片警告：当前网络被强制降级至无加密基站（协议：${latest.protocol}，基站ID：${latest.cellTowerId}）！\n` +
           `指令要求：发话角色的常规电话与普通短信已被外部特工设备/监听车完全截获！严禁在当前通话中透露任何真实姓名、代号与位置，立即挂断或切换至加密通讯。`;
  }

  const currentSim = state.slots[state.activeSlot];
  if (currentSim && currentSim.roamingActive) {
    return `【手机网络状态 · 国际漫游网络接入中】\n` +
           `当前使用卡槽 ${currentSim.slotId}（${currentSim.carrierName}，号码：${currentSim.phoneNumber}），处于境外跨国漫游通信中。`;
  }

  return '';
}

const SimCardCarrierImsiSwitcher = {
  createInitialSimCarrierState,
  switchActiveSimSlot,
  inspectBaseStationEnvironment,
  generateSimSecurityDirectives
};

export default SimCardCarrierImsiSwitcher;