/* ============================================================
 * cross-device-forensic-timeline-reconstructor.js
 * [v4.137.0 · V20 史诗级双计划 · R20-8]
 * 跨设备电子取证与时序行为拓扑重构器 (Cross-Device Forensic Reconstructor)
 *
 * 核心机制：
 * 1. 模拟多终端（手机、便携平板、车载中控、智能手表）之间的协同行为取证；
 * 2. 交叉对比心率传感器尖峰（智能手表）、行驶轨迹与蓝牙连接断开（车载）、锁屏解锁（手机）；
 * 3. 自动生成毫秒级时序事实拓扑链（Forensic Timeline），并对谎报言行生成雷达对质断言。
 * ============================================================ */

export function createInitialForensicState() {
  return {
    devices: ['smartphone', 'smartwatch', 'vehicle_infotainment'],
    timelineLogs: [], // Array<{ timestamp: number, device: string, eventType: string, detail: string, biometricHeartRate?: number }>
    inferredAnomalies: []
  };
}

/**
 * 录入一条跨设备行为事件
 */
export function recordForensicEvent(state, { timestamp = Date.now(), device = 'smartphone', eventType, detail, biometricHeartRate }) {
  if (!state || !eventType) return;
  state.timelineLogs.push({
    timestamp,
    device,
    eventType,
    detail: detail || '',
    biometricHeartRate: typeof biometricHeartRate === 'number' ? biometricHeartRate : null
  });

  // 按时间严格升序排序
  state.timelineLogs.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 重构犯罪/突发时序并检测生理与物理行为矛盾
 */
export function reconstructForensicTimeline(state) {
  if (!state || state.timelineLogs.length === 0) return [];

  const anomalies = [];

  for (let i = 0; i < state.timelineLogs.length; i++) {
    const log = state.timelineLogs[i];

    // 检测智能手表心率暴增（>140）但手机声称在“安稳熟睡”
    if (log.device === 'smartwatch' && log.biometricHeartRate && log.biometricHeartRate > 140) {
      anomalies.push({
        timestamp: log.timestamp,
        type: 'STRESS_SPIKE',
        description: `智能手表在 [${new Date(log.timestamp).toLocaleTimeString()}] 检测到异常生理应激心率（${log.biometricHeartRate} BPM），与安眠假象产生剧烈生理冲突。`
      });
    }

    // 检测车载系统急刹停车后手机瞬间关机
    if (log.device === 'vehicle_infotainment' && log.eventType === 'EMERGENCY_BRAKE') {
      const nextPhoneOff = state.timelineLogs.find(l => l.device === 'smartphone' && l.eventType === 'POWER_OFF' && Math.abs(l.timestamp - log.timestamp) < 60000);
      if (nextPhoneOff) {
        anomalies.push({
          timestamp: log.timestamp,
          type: 'FLIGHT_OR_CRASH',
          description: `车载黑匣子记录紧急制动后，手机在60秒内被强制关机，存在潜逃或毁证重大嫌疑。`
        });
      }
    }
  }

  state.inferredAnomalies = anomalies;
  return anomalies;
}

/**
 * 生成取证报告提示词指令
 */
export function generateForensicDirectives(state) {
  if (!state || !state.inferredAnomalies || state.inferredAnomalies.length === 0) return '';

  const issues = state.inferredAnomalies.map(a => `- [${a.type}] ${a.description}`).join('\n');

  return `【跨设备数字取证与行为链铁证】\n` +
         `多终端物联网取证重构出不可篡改的时空生理破绽：\n` +
         `${issues}\n` +
         `要求：面对上述物理行为与生理指标铁证，当事人无法自圆其说，审讯与对质将直击心理防线。`;
}

const CrossDeviceForensicTimelineReconstructor = {
  createInitialForensicState,
  recordForensicEvent,
  reconstructForensicTimeline,
  generateForensicDirectives
};

export default CrossDeviceForensicTimelineReconstructor;