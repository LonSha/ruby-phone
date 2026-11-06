/* ============================================================
 * bluetooth-iot-peripheral-matrix.js
 * [v4.137.0 · V20 史诗级双计划 · R20-13]
 * 蓝牙外设物联网拓扑感知机 (Bluetooth BLE Peripheral IoT Matrix)
 *
 * 核心机制：
 * 1. 扫描与配对现实物理近场智能穿戴与物联网硬件（Smartwatch、耳机、车载HUD、智能门锁）；
 * 2. 实时追踪外设连接/断开状态、信号场强（RSSI -30dBm ~ -95dBm）与设备脱手距离预警；
 * 3. 蓝牙耳机私密窃听模式、智能门锁近场近距离感应解锁；
 * 4. 向提示词管线注入耳机私密耳语、门锁感应开启、智能手表脱离手腕的心虚动作。
 * ============================================================ */

export function createInitialBleMatrixState() {
  return {
    isBluetoothEnabled: true,
    pairedDevices: {}, // deviceId -> { name, deviceType, rssi: number, connected: boolean, battery: number }
    proximityAlerts: []
  };
}

/**
 * 注册或连接一个蓝牙外设
 */
export function registerPeripheralDevice(state, { deviceId, name, deviceType = 'EARPHONE', rssi = -55, battery = 90 }) {
  if (!state || !deviceId) return;
  state.pairedDevices[deviceId] = {
    deviceId,
    name: name || '未知蓝牙设备',
    deviceType, // 'EARPHONE' | 'SMARTWATCH' | 'SMART_LOCK' | 'CAR_HUD'
    rssi,
    connected: true,
    battery
  };
}

/**
 * 更新外设信号距离 (RSSI)
 */
export function updatePeripheralRssi(state, deviceId, newRssi) {
  if (!state || !state.pairedDevices[deviceId]) return;
  const dev = state.pairedDevices[deviceId];
  dev.rssi = newRssi;

  // 信号衰减到 -85dBm 以下，判定为即将断连脱离
  if (newRssi <= -85 && dev.connected) {
    state.proximityAlerts.push({
      deviceId,
      name: dev.name,
      alert: 'DEVICE_OUT_OF_RANGE',
      rssi: newRssi
    });
  }
}

/**
 * 生成蓝牙外设交互提示词指令
 */
export function generateBleMatrixDirectives(state) {
  if (!state || !state.isBluetoothEnabled) return '';

  const directives = [];
  const devices = Object.values(state.pairedDevices).filter(d => d.connected);

  for (const d of devices) {
    if (d.deviceType === 'EARPHONE') {
      directives.push(`- 骨传导私密耳机已连接（设备：[${d.name}]，电量 ${d.battery}%）。角色所有通话与语音播放均为私密耳语，旁人完全听不到声音。`);
    } else if (d.deviceType === 'SMART_LOCK' && d.rssi >= -60) {
      directives.push(`- 智能感应门锁 [${d.name}] 进入极近距离（信号强），手机 NFC/BLE 鉴权成功，门锁已发出清脆解锁蜂鸣。`);
    }
  }

  if (state.proximityAlerts.length > 0) {
    const lastAlert = state.proximityAlerts[state.proximityAlerts.length - 1];
    directives.push(`- 距离告警：智能外设 [${lastAlert.name}] 信号微弱（${lastAlert.rssi} dBm），正脱离安全感应范围！`);
  }

  if (directives.length === 0) return '';

  return `【手机外设物联网拓扑 · 近场硬件感知】\n` +
         directives.join('\n') + '\n' +
         `指令要求：结合上述近场硬件状态演绎发话细节（如轻按耳机悄声低语、随手推开解锁的门扉等）。`;
}

const BluetoothIotPeripheralMatrix = {
  createInitialBleMatrixState,
  registerPeripheralDevice,
  updatePeripheralRssi,
  generateBleMatrixDirectives
};

export default BluetoothIotPeripheralMatrix;