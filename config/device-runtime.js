// Narrative device simulation only: no physical hardware, crypto, network or shell access.
import Vault from '../apps/darknet/darknet-dual-domain-vault.js';
import Hardware from '../apps/hardware/hardware-signal-sensor-simulator.js';
import Push from '../apps/notifications/npc-autonomous-notification-synthesizer.js';
import Evidence from '../apps/investigation/cross-app-evidence-chain-matrix.js';
import Mesh from '../apps/network/offline-mesh-beacon-transceiver.js';
import Forensic from '../apps/investigation/cross-device-forensic-timeline-reconstructor.js';
import Security from '../apps/security/sandbox-file-encryption-leak-tracer.js';
import Voice from '../apps/audio/ai-voice-deepfake-tamper-detector.js';
import Power from '../apps/hardware/device-power-sleep-scheduler.js';
import Sim from '../apps/network/sim-card-carrier-imsi-switcher.js';
import Ble from '../apps/hardware/bluetooth-iot-peripheral-matrix.js';
import Shell from '../apps/security/local-sandbox-reverse-shell-executor.js';
import Damage from '../apps/hardware/physical-damage-touch-degradation-simulator.js';
import Airdrop from '../apps/network/offline-direct-p2p-file-airdrop-transceiver.js';
import Duress from '../apps/security/biometrics-duress-panic-wipe-vault.js';
import Orchestrator from '../apps/settings/virtual-device-contextual-orchestrator.js';
/* [v4.138.0 · V21 史诗级双计划] 新增 8 项拟真生活与极客子系统对接 */
import { scanWirelessEnvironment } from '../apps/hardware/rf-sniffer-matrix-engine.js';
import { createDarknetMarketState, purchaseDarknetItem } from '../apps/darknet/dual-domain-space-darknet-market.js';
import { crossExamineAlibi } from '../apps/investigation/forensic-timeline-clue-matrix.js';
import { simulatePhysicalDegradation } from '../apps/hardware/physical-damage-degradation-simulator.js';
import { executeGeekTerminalCommand } from '../apps/security/pixel-geek-terminal-sandbox.js';

export const DEVICE_RUNTIME_KEY = 'device_runtime_v1';
const LIMIT = 50;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const factories = {
    vault: Vault.createInitialVaultState, hardware: Hardware.createInitialHardwareState,
    push: Push.createInitialNotificationEngineState, evidence: Evidence.createInitialEvidenceMatrixState,
    mesh: Mesh.createInitialMeshState, forensic: Forensic.createInitialForensicState,
    security: Security.createInitialFileSecurityState, voice: Voice.createInitialVoiceDetectorState,
    power: Power.createInitialPowerState, sim: Sim.createInitialSimCarrierState,
    ble: Ble.createInitialBleMatrixState, shell: Shell.createInitialShellSandboxState,
    damage: Damage.createInitialDamageState, airdrop: Airdrop.createInitialP2PAirdropState,
    duress: Duress.createInitialDuressVaultState,
    darknetMarket: createDarknetMarketState
};
function initial() {
    return { version: 1, enabled: false, injectToPrompt: false, revision: 0,
        lastTickAt: null, npcProfiles: [], active: [], modules: {} };
}
function decode(raw) {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
    if (!plain(obj) || obj.version !== 1 || !plain(obj.modules) || !Array.isArray(obj.active)) throw new Error('设备状态格式不兼容');
    return obj;
}
function read(storage) {
    const raw = storage?.get?.(DEVICE_RUNTIME_KEY, null);
    return raw == null ? initial() : decode(raw);
}
function moduleOf(state, id) {
    if (!factories[id]) throw new Error('未知子系统');
    if (!state.active.includes(id)) state.active.push(id);
    if (!state.modules[id]) state.modules[id] = factories[id]();
    const m = state.modules[id];
    if (id === 'vault' && !(m.darknetDossiers instanceof Map)) state.modules[id] = Vault.hydrateVaultState(m);
    if (id === 'evidence' && !(m.evidenceNodes instanceof Map)) {
        if (!Array.isArray(m.evidenceNodes)) throw new Error('证据档损坏');
        m.evidenceNodes = new Map(m.evidenceNodes.map(n => [n.id, n]));
    }
    return state.modules[id];
}
function pack(state) {
    const copy = { ...state, modules: { ...state.modules } };
    if (copy.modules.vault?.darknetDossiers instanceof Map) copy.modules.vault = Vault.serializeVaultState(copy.modules.vault);
    if (copy.modules.evidence?.evidenceNodes instanceof Map) copy.modules.evidence = { ...copy.modules.evidence, evidenceNodes: [...copy.modules.evidence.evidenceNodes.values()] };
    return clone(copy);
}
function trim(value) {
    if (value instanceof Map) {
        while (value.size > LIMIT) value.delete(value.keys().next().value);
    } else if (Array.isArray(value)) {
        if (value.length > LIMIT) value.splice(0, value.length - LIMIT);
        value.forEach(trim);
    } else if (plain(value)) {
        // Dictionaries in kernels are bounded as well as append-only logs.
        const keys = Object.keys(value);
        if (keys.length > 100) keys.slice(0, keys.length - 100).forEach(k => delete value[k]);
        Object.values(value).forEach(trim);
    }
}
function save(storage, state) {
    if (typeof storage?.set !== 'function') throw new Error('会话存储不可用');
    trim(state.modules);
    state.revision = (Number.isSafeInteger(state.revision) ? state.revision : 0) + 1;
    const packed = pack(state);
    if (storage.set(DEVICE_RUNTIME_KEY, packed) === false) throw new Error('设备状态保存失败');
    // PhoneStorage may signal a refused write by returning no value; verify its read face.
    if (JSON.stringify(read(storage)) !== JSON.stringify(packed)) throw new Error('设备状态写入未确认');
}
function required(p, key) {
    if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 2000) throw new Error(`需要有效字段 ${key}`);
}
function checkArgs(p, example) {
    if (!plain(p)) throw new Error('参数必须是 JSON 对象');
    if (JSON.stringify(p).length > 12000) throw new Error('操作参数过长');
    for (const [k, v] of Object.entries(p)) {
        if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('非法字段');
        if (!(k in example)) throw new Error(`未知字段 ${k}`);
        if (typeof v !== typeof example[k]) throw new Error(`字段类型错误 ${k}`);
        if (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 1e15)) throw new Error(`无效数字 ${k}`);
        if (typeof v === 'string' && (v.length > 2000 || ['__proto__', 'constructor', 'prototype'].includes(v))) throw new Error(`无效文本 ${k}`);
    }
}
// UI examples and dispatch use the same table. Each action executes an existing kernel.
const actions = {};
function action(id, module, label, example, requiredKeys, run) { actions[id] = { module, label, example, requiredKeys, run }; }
action('environment', 'hardware', '无线环境', { signalBars: 0, networkType: 'No_Service', batteryDelta: 0, impactDetected: false, isMoving: false }, [], (s,p) => Hardware.applyEnvironmentConditions(s,p));
action('power', 'power', '耗电/充电', { activityType: 'VIDEO_CALL', elapsedMinutes: 60, charging: false, chargerWatts: 30 }, [], (s,p) => { if (p.elapsedMinutes < 0 || p.elapsedMinutes > 1440 || p.chargerWatts < 0 || p.chargerWatts > 240) throw new Error('电源参数越界'); if (p.elapsedMinutes !== 0) Power.updateBatteryDrain(s,p); });
action('rtc', 'power', '剧情唤醒计划（不设系统闹钟）', { eventId: 'wake-1', wakeupTimestampMs: 1800000000000, purpose: '会面' }, ['eventId'], (s,p) => Power.scheduleRtcWakeup(s,p));
action('sim', 'sim', '切换 SIM', { slotId: 2 }, [], (s,p) => { if (![1,2].includes(p.slotId)) throw new Error('卡槽仅支持1或2'); Sim.switchActiveSimSlot(s,p.slotId); });
action('baseStation', 'sim', '模拟基站检测', { cellTowerId: 'scene-tower', signalProtocol: '2G', encryptionEnabled: false, forced2GDowngrade: true }, ['cellTowerId'], (s,p) => Sim.inspectBaseStationEnvironment(s,p));
action('peripheral', 'ble', '登记蓝牙外设', { deviceId: 'ear-1', name: '剧情耳机', deviceType: 'EARPHONE', rssi: -55, battery: 90 }, ['deviceId','name'], (s,p) => Ble.registerPeripheralDevice(s,p));
action('rssi', 'ble', '更新外设信号', { deviceId: 'ear-1', rssi: -90 }, ['deviceId'], (s,p) => { if (!Object.hasOwn(s.pairedDevices,p.deviceId)) throw new Error('请先登记外设'); Ble.updatePeripheralRssi(s,p.deviceId,p.rssi); });
action('shell', 'shell', '模拟终端（不运行真实命令）', { command: 'ping example.test' }, ['command'], (s,p) => Shell.executeSandboxCommand(s,p.command));
action('impact', 'damage', '模拟物理损伤', { impactJoules: 22, damageType: 'DROP_ON_CONCRETE' }, [], (s,p) => { if (p.impactJoules < 0 || p.impactJoules > 1000) throw new Error('撞击能量越界'); Damage.applyPhysicalImpact(s,p); });
action('peer', 'airdrop', '发现近场投送节点', { peerId: 'peer-1', peerName: '剧情节点', rssi: -48 }, ['peerId','peerName'], (s,p) => Airdrop.discoverP2PPeer(s,p));
action('airdrop', 'airdrop', '接收剧情文件', { transferId: 'transfer-1', senderPeerName: '剧情节点', fileName: '线索.txt', fileSizeMB: 2 }, ['transferId','senderPeerName','fileName'], (s,p) => { if (!s.nearbyDirectPeers.some(n => n.peerName === p.senderPeerName)) throw new Error('发送节点未发现'); if (s.incomingTransfers.some(t => t.transferId === p.transferId)) throw new Error('投送已接收'); if (p.fileSizeMB < 0 || p.fileSizeMB > 10000) throw new Error('文件大小越界'); return Airdrop.initiateIncomingP2PTransfer(s,p); });
action('authenticate', 'duress', '模拟 PIN/胁迫鉴权', { inputPin: '9999', fingerprintIndex: 0, currentGps: '未知（剧情未登记）' }, [], (s,p) => { const r = Duress.authenticateWithDuressDetection(s,p); if (!r.success) throw new Error('鉴权失败'); return { success: r.success, isDuress: r.isDuress }; });
action('wipe', 'duress', '清除本模拟器敏感条目（不可恢复）', { confirm: false, reason: '剧情恐慌擦除' }, [], (s,p,state) => { if (p.confirm !== true) throw new Error('必须显式确认'); Duress.triggerPanicWipe(s,p); for (const k of ['vault','security','shell','evidence','forensic','voice','airdrop']) { delete state.modules[k]; state.active = state.active.filter(id => id !== k); } });
action('domain', 'vault', '进入模拟暗域', { inputCode: '*#9981#*' }, ['inputCode'], (s,p) => { if (!Vault.switchDomain(s,p.inputCode)) throw new Error('暗域口令不匹配'); });
action('publicDomain', 'vault', '回到公开域', {}, [], s => Vault.triggerPanicMode(s));
action('dossier', 'vault', '写入模拟暗域档案（明文存储）', { id: 'dossier-1', title: '剧情线索', content: '仅存虚构内容', bountyScore: 0, burnAfterReading: false }, ['id','title'], (s,p) => { if (s.activeDomain !== 'darknet') throw new Error('请先进入暗域'); return Vault.storeDarknetDossier(s,p); });
action('evidence', 'evidence', '登记跨应用物证', { id: 'evidence-1', source: 'memo', actor: '角色甲', timestamp: 1800000000000, location: '钟楼', content: '剧情记录', isAlibi: true }, ['id','actor','location'], (s,p) => Evidence.registerEvidenceNode(s,p));
action('meshPeer', 'mesh', '发现 Mesh 邻居', { peerId: 'mesh-1', character: '角色乙', distanceMeters: 20 }, ['peerId','character'], (s,p) => { if (p.distanceMeters < 0 || p.distanceMeters > 10000) throw new Error('距离越界'); Mesh.registerNearPeer(s,p); });
action('meshSend', 'mesh', '发送剧情 Mesh 包', { sender: '我', recipient: '角色乙', message: '收到线索', hops: 3 }, ['sender','recipient','message'], (s,p) => { if (!s.meshEnabled) throw new Error('Mesh未开启'); return Mesh.transmitMeshPacket(s,p); });
action('forensic', 'forensic', '登记跨设备时序事件', { timestamp: 1800000000000, device: 'smartwatch', eventType: 'HEART_RATE', detail: '剧情测量', biometricHeartRate: 150 }, ['device','eventType'], (s,p) => Forensic.recordForensicEvent(s,p));
action('secureFile', 'security', '登记剧情敏感文件（无真实加密）', { fileId: 'file-1', name: '线索文件', classification: 'SECRET', isEncrypted: true }, ['fileId','name'], (s,p) => Security.registerSecureFile(s,p));
action('leak', 'security', '登记文件违规操作', { fileId: 'file-1', actor: '角色乙', action: 'SCREENSHOT_OR_TRANSFER' }, ['fileId','actor'], (s,p) => { if (!Object.hasOwn(s.vaultFiles,p.fileId)) throw new Error('文件未登记'); return Security.recordUnauthorizedAccess(s,p.fileId,p); });
action('voice', 'voice', '模拟音频特征审计', { clipId: 'clip-1', callerName: '角色甲', durationSec: 10, frequencyJitter: 0.001, phaseDiscontinuity: 0.8, spectralArtifactNoise: 0.9 }, ['clipId','callerName'], (s,p) => { for (const k of ['frequencyJitter','phaseDiscontinuity','spectralArtifactNoise']) if (p[k] < 0 || p[k] > 1) throw new Error('音频特征须在0..1'); return Voice.auditIncomingAudio(s,p); });
action('npc', 'push', '登记离线演化角色', { name: '角色甲', affinity: 85, role: 'friend' }, ['name'], (_s,p,state) => { state.npcProfiles = state.npcProfiles.filter(n => n.name !== p.name).concat(p).slice(-20); });
/* [v4.138.0 · V21 史诗级双计划] 新增 4 个高级极客与侦探物证操作接入 */
action('geekCmd', 'shell', '执行原生极客掌机终端命令', { command: 'help' }, ['command'], (_s, p) => executeGeekTerminalCommand(p.command));
action('rfScan', 'hardware', '嗅探无线电与环境 Wi-Fi 频谱', { rangeMeters: 50 }, [], (_s, p) => scanWirelessEnvironment(p.rangeMeters));
action('alibiCheck', 'evidence', '跨应用侦探物证链不在场证明对撞', { actor: '嫌疑人', targetTime: 1800000000000, marginMs: 300000 }, ['actor'], (_s, p, state) => crossExamineAlibi(p.actor, p.targetTime, Array.from(state.modules.evidence?.evidenceNodes?.values() || []), p.marginMs));
action('buyDarknet', 'darknetMarket', '在暗网黑市采购虚构情报', { itemId: 'item_zero_day' }, ['itemId'], (s, p) => purchaseDarknetItem(s, p.itemId));

export function deviceActionCatalog() {
    return Object.entries(actions).map(([id,a]) => ({ id, module: a.module, label: a.label, example: { ...a.example } }));
}
/** Re-read on every operation: no cached state can survive a chat switch. */
export function dispatchDeviceAction(storage, id, params = {}, win = null) {
    try {
        const state = read(storage);
        if (id === 'configure') {
            checkArgs(params, { enabled: false, injectToPrompt: false });
            if (typeof params.enabled === 'boolean') state.enabled = params.enabled;
            if (typeof params.injectToPrompt === 'boolean') state.injectToPrompt = params.injectToPrompt;
            state.lastTickAt = Date.now();
        } else if (id === 'reset') {
            if (params.confirm !== true) throw new Error('必须显式确认');
            const clean = initial(); save(storage,clean); return { ok: true };
        } else {
            if (!state.enabled) throw new Error('请先开启剧情设备模拟');
            const entry = Object.hasOwn(actions,id) ? actions[id] : null;
            if (!entry) throw new Error('未知设备操作');
            checkArgs(params,entry.example);
            const p = { ...entry.example, ...params };
            // Wipes never inherit confirmation from defaults or saved state.
            entry.requiredKeys.forEach(k => required(p,k));
            if (state.modules.duress?.systemWiped && ['vault','security','shell','evidence','forensic','voice','airdrop'].includes(entry.module)) throw new Error('模拟敏感区已擦除，请先重置模拟器');
            entry.run(moduleOf(state,entry.module),p,state);
            if (entry.module === 'power' && state.modules.hardware) state.modules.hardware.batteryLevel = state.modules.power.batteryLevel;
        }
        save(storage,state);
        // Metadata only. Never publish PINs, dossier text, file names, or voiceprints.
        try { win?.VirtualPhone?.lonshaBridge?.emitHolographicEvent?.('DEVICE_STATE_CHANGED', { action: id, revision: state.revision, source: 'narrative-device-simulation' }); } catch (_e) { /* queue belongs to bridge */ }
        return { ok: true, revision: state.revision };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
export function deviceRuntimeSummary(storage) {
    try { const s = read(storage); return { ok: true, enabled: s.enabled === true, injectToPrompt: s.injectToPrompt === true, revision: s.revision, active: s.active.filter(k => Object.hasOwn(factories,k)), pendingPushes: s.modules.push?.pendingNotifications?.length || 0 }; }
    catch (e) { return { ok: false, error: String(e.message || e), enabled: false, active: [] }; }
}
/** Generation is read-only; absent/disabled state yields no invented device telemetry. */
export function buildDeviceRuntimePrompt(storage) {
    try {
        const s = read(storage);
        if (s.enabled !== true || s.injectToPrompt !== true) return '';
        const get = id => s.active.includes(id) ? moduleOf(s,id) : null;
        const call = (id,fn) => { const m = get(id); return m ? fn(m) : ''; };
        const directives = {
            powerDirective: call('power',Power.generatePowerDirectives), simDirective: call('sim',Sim.generateSimSecurityDirectives),
            bleDirective: call('ble',Ble.generateBleMatrixDirectives), shellDirective: call('shell',Shell.generateShellSandboxDirectives),
            damageDirective: call('damage',Damage.generatePhysicalDamageDirectives), airdropDirective: call('airdrop',Airdrop.generateP2PAirdropDirectives),
            duressDirective: call('duress',Duress.generateDuressDirectives), voiceTamperDirective: call('voice',Voice.generateVoiceTamperDirectives),
            hardwareDirective: call('hardware',Hardware.resolveHardwarePromptDirectives),
            meshDirective: s.modules.hardware?.networkType === Hardware.NETWORK_TYPE.NO_SERVICE ? call('mesh',Mesh.generateMeshNetworkDirective) : '',
            evidenceDirective: call('evidence',m => Evidence.resolveInvestigationDirectives(m).join('\n')),
            forensicDirective: call('forensic',m => { Forensic.reconstructForensicTimeline(m); return Forensic.generateForensicDirectives(m); }),
            leakDirective: call('security',Security.generateSecurityLeakDirectives),
            vaultDirective: call('vault',m => m.activeDomain === 'darknet' ? `【模拟暗域已开启】当前有${m.darknetDossiers.size}条档案；不向公开提示词披露档案正文。` : ''),
            notificationDirective: call('push',m => m.pendingNotifications.length ? `【剧情离线通知待审阅】${m.pendingNotifications.length}条；不等于对方已收到回复。` : '')
        };
        const block = Orchestrator.arbitrateDeviceDirectives(directives);
        return block ? '【剧情设备模拟边界】以下仅为本会话的虚构设备状态，不代表真实硬件检测、加密、网络发送或磁盘擦除；只影响已知该设备状态的角色。\n' + block : '';
    } catch (_e) { return ''; }
}
/** Advance on a real host generation tick, never during read-only prompt collection. */
export function advanceDeviceRuntime(storage, now = Date.now()) {
    try {
        const s = read(storage);
        if (!s.enabled || !s.npcProfiles.length || !Number.isFinite(now)) return { ok: true, generated: 0 };
        const elapsed = s.lastTickAt == null ? 0 : Math.floor((now - s.lastTickAt) / 60000);
        if (elapsed < 5) return { ok: true, generated: 0 };
        const push = moduleOf(s,'push');
        const generated = Push.synthesizeAutonomousPushes(push,s.npcProfiles,Math.min(elapsed,1440));
        s.lastTickAt = now;
        save(storage,s);
        return { ok: true, generated: generated.length };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
/** Explicit review, not a claim that a real IM was sent. */
export function reviewDeviceNotifications(storage) {
    try { const s = read(storage); const m = moduleOf(s,'push'); const items = Push.drainPendingNotifications(m); save(storage,s); return { ok: true, items }; }
    catch (e) { return { ok: false, error: String(e.message || e), items: [] }; }
}
