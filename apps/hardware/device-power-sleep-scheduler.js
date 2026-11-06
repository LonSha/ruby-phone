/* ============================================================
 * device-power-sleep-scheduler.js
 * [v4.137.0 · V20 史诗级双计划 · R20-11]
 * 手机电源管理、动态放电曲线与超低功耗深度休眠唤醒调度器 (Device Power & Deep Sleep Scheduler)
 *
 * 核心机制：
 * 1. 模拟现实手机真实锂电池非线性放电模型（0%..100%），高负载计算/视频通话快速掉电；
 * 2. 电量临界危机控制：低电量模式（<20%）、极限省电黑白屏（<5%）、电量耗尽强制关机（0%）；
 * 3. 硬件级 RTC（实时时钟）深睡唤醒中断：断网关机下支持定时闹钟与硬件看门狗自动开机唤醒；
 * 4. 向提示词管线注入低电量危机感（借充电宝、寻找插座、关机失联前的紧急通话）。
 * ============================================================ */

export function createInitialPowerState() {
  return {
    batteryLevel: 85,          // 0..100
    isCharging: false,
    chargingPowerWatts: 0,     // 如 65W 快充
    powerSaveMode: false,
    ultraPowerSaveMode: false, // 极限省电模式
    temperatureCelsius: 32.5,  // 电池温度
    scheduledRtcWakeups: []    // Array<{ eventId, wakeupTimestampMs, purpose: string }>
  };
}

/**
 * 消耗电量或接入充电
 */
export function updateBatteryDrain(state, { activityType = 'STANDBY', elapsedMinutes = 10, charging = false, chargerWatts = 0 }) {
  if (!state) return;

  if (charging) {
    state.isCharging = true;
    state.chargingPowerWatts = chargerWatts || 30;
    // 充电增长
    const gain = Math.round((chargerWatts / 60) * elapsedMinutes * 1.5);
    state.batteryLevel = Math.min(100, state.batteryLevel + Math.max(1, gain));
    state.temperatureCelsius = Math.min(45, state.temperatureCelsius + 0.2 * elapsedMinutes);
  } else {
    state.isCharging = false;
    state.chargingPowerWatts = 0;
    let drainRate = 0.05; // 待机每分钟掉电

    switch (activityType) {
      case 'VIDEO_CALL':
      case '3D_GAMING':
        drainRate = 1.2;
        break;
      case 'FORENSIC_DECRYPT':
      case 'GPS_NAVIGATION':
        drainRate = 0.8;
        break;
      case 'CHAT_SCREEN_ON':
        drainRate = 0.3;
        break;
      default:
        drainRate = 0.05;
    }

    if (state.ultraPowerSaveMode) {
      drainRate *= 0.15;
    } else if (state.powerSaveMode) {
      drainRate *= 0.5;
    }

    const loss = Math.round(drainRate * elapsedMinutes);
    state.batteryLevel = Math.max(0, state.batteryLevel - Math.max(1, loss));
  }

  // 模式状态机切换
  if (state.batteryLevel <= 5 && !state.isCharging) {
    state.ultraPowerSaveMode = true;
    state.powerSaveMode = true;
  } else if (state.batteryLevel <= 20 && !state.isCharging) {
    state.powerSaveMode = true;
  } else if (state.batteryLevel > 30) {
    state.powerSaveMode = false;
    state.ultraPowerSaveMode = false;
  }
}

/**
 * 调度 RTC 硬件唤醒事件
 */
export function scheduleRtcWakeup(state, { eventId, wakeupTimestampMs, purpose }) {
  if (!state || !wakeupTimestampMs) return;
  state.scheduledRtcWakeups.push({
    eventId: eventId || 'rtc_' + Date.now(),
    wakeupTimestampMs,
    purpose: purpose || '硬件定时唤醒'
  });
}

/**
 * 生成低电量与断电危机提示词指令
 */
export function generatePowerDirectives(state) {
  if (!state) return '';

  if (state.batteryLevel === 0) {
    return `【手机电源严重耗尽 · 强制黑屏关机】\n` +
           `手机电量降为 0%，屏幕已强制黑屏熄灭并关机！\n` +
           `指令要求：角色无法再看手机屏幕或发送任何信息。必须将注意力转移到现实物理环境中（如急躁地四处寻找充电线、向路人借充电宝，或因突发断联而陷入不安）。`;
  }

  if (state.ultraPowerSaveMode) {
    return `【手机电池极限告警 · 濒临关机（剩余 ${state.batteryLevel}%）】\n` +
           `手机已强制进入黑白极限省电模式，所有后台通信已被切断，仅保留紧急电话功能！\n` +
           `指令要求：发话角色能感知到随时断电失联的紧迫感，讲话必须长话短说，快速交代核心关键信息，避免长篇大论。`;
  }

  if (state.batteryLevel <= 15 && !state.isCharging) {
    return `【手机低电量提示（剩余 ${state.batteryLevel}%）】\n` +
           `屏幕顶端电池图标呈红色闪烁，系统弹出低电量警告。角色可在对话或旁白中带出一句查看剩余电量或想要充电的动作细节。`;
  }

  return '';
}

const DevicePowerSleepScheduler = {
  createInitialPowerState,
  updateBatteryDrain,
  scheduleRtcWakeup,
  generatePowerDirectives
};

export default DevicePowerSleepScheduler;