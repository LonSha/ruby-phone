/* ============================================================
 * physical-damage-touch-degradation-simulator.js
 * [v4.137.0 · V20 史诗级双计划 · R20-15]
 * 屏幕碎裂、触控失灵与硬件残损拟真机 (Physical Damage & Touch Degradation Simulator)
 *
 * 核心机制：
 * 1. 模拟手机现实物理受损状态（屏幕碎裂蜘蛛网纹、OLED漏液黑斑、局部触控断触失灵、扬声器杂音破音）；
 * 2. 局部触控屏蔽区（Dead Touch Zones）：如右上角 20% 区域触控无响应，导致发不出某些按键或无法下拉控制中心；
 * 3. 屏幕破损严重度（0..100%）：极高碎裂度导致输入错乱、打字自动出现错别字乱码；
 * 4. 向提示词管线注入手指划破被玻璃扎刺、费力辨认碎屏文字的逼真生理动作与环境质感。
 * ============================================================ */

export function createInitialDamageState() {
  return {
    screenCracked: false,
    crackSeverity: 0,        // 0..100
    oledLeakBleedRadiusPx: 0, // 漏液黑斑半径
    deadTouchZones: [],      // Array<{ zoneName: string, xMin, xMax, yMin, yMax }>
    speakerDistortion: false // 扬声器破音
  };
}

/**
 * 遭受物理撞击与损伤
 */
export function applyPhysicalImpact(state, { impactJoules = 15, damageType = 'DROP_ON_CONCRETE' }) {
  if (!state) return;

  if (impactJoules >= 20) {
    state.screenCracked = true;
    state.crackSeverity = Math.min(100, state.crackSeverity + Math.round(impactJoules * 3.5));
    state.oledLeakBleedRadiusPx = Math.min(300, state.oledLeakBleedRadiusPx + Math.round(impactJoules * 5));
    state.speakerDistortion = true;

    // 产生断触盲区
    state.deadTouchZones.push({
      zoneName: '屏幕右上角发送键区域',
      xMin: 0.75,
      xMax: 1.0,
      yMin: 0.85,
      yMax: 1.0
    });
  } else if (impactJoules >= 10) {
    state.screenCracked = true;
    state.crackSeverity = Math.min(100, state.crackSeverity + 25);
  }
}

/**
 * 模拟受损屏幕下的字符输入（高破损导致错别字乱码）
 */
export function simulateDegradedTyping(state, inputText) {
  if (!state || !state.screenCracked || state.crackSeverity < 50 || !inputText) {
    return inputText;
  }
  // 模拟触控跳字与误触
  let degraded = '';
  for (let i = 0; i < inputText.length; i++) {
    if (i % 5 === 0 && Math.random() < (state.crackSeverity / 150)) {
      degraded += '…[触控跳击]…';
    }
    degraded += inputText[i];
  }
  return degraded;
}

/**
 * 生成屏幕残损与触控障碍提示词指令
 */
export function generatePhysicalDamageDirectives(state) {
  if (!state || !state.screenCracked) return '';

  const details = [];
  if (state.crackSeverity >= 70) {
    details.push(`- 屏幕布满放射状蜘蛛网碎裂纹，右上角已有大片紫黑色 OLED 漏液盲斑遮挡视线。`);
  } else {
    details.push(`- 外屏玻璃出现明显的贯穿裂痕，划过屏幕时玻璃碴轻微刺手。`);
  }

  if (state.deadTouchZones.length > 0) {
    details.push(`- 触控屏存在死区（${state.deadTouchZones.map(z => z.zoneName).join('、')}），需要反复重重按压数次才能偶发响应。`);
  }

  if (state.speakerDistortion) {
    details.push(`- 扬声器受震破损，外放或听筒传出的声音伴随刺耳的金属嘶嘶杂音。`);
  }

  return `【手机物理残损 · 屏幕碎裂与触控衰减】\n` +
         details.join('\n') + '\n' +
         `指令要求：发话角色在操作手机时必须展现出真实残损受阻细节（如皱眉侧过屏幕避开漏液黑斑、手指被碎玻璃扎痛、反复重按触控不灵敏的按键等）。`;
}

const PhysicalDamageTouchDegradationSimulator = {
  createInitialDamageState,
  applyPhysicalImpact,
  simulateDegradedTyping,
  generatePhysicalDamageDirectives
};

export default PhysicalDamageTouchDegradationSimulator;