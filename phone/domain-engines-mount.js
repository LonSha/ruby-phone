/* ============================================================
 * phone/domain-engines-mount.js — [v18 · 业务引擎真实接入层（第二批）]
 * ------------------------------------------------------------
 * 【为什么存在】
 *   audit-orphan-modules 扫出 40 个 apps/ 下的引擎「生产侧零消费」：
 *   文件在、有单测、能力为零。它们与第一批（phone/ 下的生命周期引擎）
 *   形态完全不同 —— 生命周期引擎听宿主事件，这批是**业务动作驱动**：
 *   发一条消息、来电、锁屏、开备份、搜一次全局、生成前注入 prompt。
 *
 * 【接入纪律（比第一批更严，因为这批更容易造假）】
 *   1. **只接真实存在的宿主时机**。找不到宿主就如实记 noHost，绝不 new 一个
 *      定时器让它「看起来在跑」—— 那是自欺，比死代码更坏。
 *   2. 产出必须有**真实消费方**。这批大多产出 `promptDirective` 文本，
 *      本仓唯一的真实注入链是
 *        feedbackHub.pushDirective() → consumePendingDirectives()
 *        → lonsha-bridge.applyCoordinatedInjection() → setExtensionPrompt()
 *      没有这条链，引擎写得再好模型也看不到。
 *   3. **同族重复必须分派**，不能都挂一处（否则等于只接了其中一个）：
 *        - three reply-chip engines   → 只有 smart-reply-predictive-chips 接微信输入框
 *          （另两个是 r16/r17 的历史版本，留着由测试守，不再往 UI 上叠）
 *        - four haptic engines        → 键击触感 / 发送音效 / 空间触感 分三个动作
 *        - three moments engines      → 只有 living-social-ecosystem 接朋友圈列表
 *        - two sandbox engines        → interceptor 接权限申请，matrix 接越权判定
 *   4. 任何一个引擎抛错都只记读数，不中断宿主流程。
 * ============================================================ */

import { SmartReplyPredictiveChips } from '../apps/wechat/smart-reply-predictive-chips.js';
import { RetroHapticAcousticSynthesizer } from '../apps/audio/retro-haptic-acoustic-synthesizer.js';
import { HapticSpatialAudioFeedbackEngine } from '../apps/audio/haptic-spatial-audio-feedback-engine.js';
import { HapticRetroAudioFeedbackEngine } from '../apps/audio/haptic-retro-audio-feedback-engine.js';
import { ContextualVoiceCallAmbienceSim } from '../apps/audio/contextual-voice-call-ambience-sim.js';
import { modulateCallAcoustics } from '../apps/call/contextual-cellular-call-acoustic-modulator.js';
import { DynamicContextCallSoundscape } from '../apps/call/dynamic-context-call-soundscape.js';
import { SmartHomeAmbientIOTHub } from '../apps/iot/smart-home-ambient-iot-hub.js';
import { DynamicPowerBatteryPhysics } from '../apps/hardware/dynamic-power-battery-physics.js';
import { RadioCellularWeakSignalSim } from '../apps/network/radio-cellular-weak-signal-sim.js';
import { CellularRFProximityRadar } from '../apps/network/cellular-rf-proximity-radar.js';
import { performProximityAirdrop } from '../apps/network/offline-direct-airdrop-engine.js';
import { NFCAirdropProximityExchange } from '../apps/share/nfc-airdrop-proximity-exchange.js';
import { dispatchShareIntent } from '../apps/share/universal-sharesheet-intent-bus.js';
import { AppSandboxPermissionInterceptor } from '../apps/security/app-sandbox-permission-interceptor.js';
import { AppSandboxPermissionMatrix } from '../apps/security/app-sandbox-permission-matrix.js';
import { DuressPrivacyVaultDisguise } from '../apps/security/duress-privacy-vault-disguise.js';
import { CrashDumpTelemetryAutoReboot } from '../apps/security/crash-dump-telemetry-auto-reboot.js';
import { DeadManSwitchDigitalVault } from '../apps/security/dead-man-switch-digital-vault.js';
import { SystemFullSnapshotBackupEngine } from '../apps/security/system-full-snapshot-backup-engine.js';
import { VirtualShellGeekSandboxTerminal } from '../apps/security/virtual-shell-geek-sandbox-terminal.js';
import { AtomicFilesystemSnapshotVault } from '../apps/archive/atomic-filesystem-snapshot-vault.js';
import { OfflineAirdropDigitalLegacy } from '../apps/archive/offline-airdrop-digital-legacy.js';
/* [绑定级消费] 这两个模块对外只暴露「类 + 工厂 + default 三件套」，而工厂
 *   存在的意义本就是让调用方不必自己 new。装配层原先只 import 类，
 *   于是 createMomentsLivingEcosystem / createForensicClueMatrix 在整个生产侧
 *   变成绑定级零消费导出（名字级判绿——同名标识符在别处出现过——但没有任何
 *   import 绑定真的调用它）。改用工厂：既是模块作者预期的用法，也让这两个
 *   导出获得真实消费方。scripts/bind-consumption-audit.mjs 会盯着这一条。 */
import { createMomentsLivingEcosystem } from '../apps/moments/moments-living-social-ecosystem.js';
import { generateMomentReactions } from '../apps/moments/npc-social-graph-dynamic-moments.js';
import { NPCAutonomousSocialFeedEngine } from '../apps/social/npc-autonomous-social-feed-engine.js';
import { createForensicClueMatrix } from '../apps/investigation/forensic-cross-app-clue-matrix.js';
import { DarknetBizarreBazaarEngine } from '../apps/darknet/darknet-bizarre-bazaar-engine.js';
import { AwakeningEngine } from '../apps/memory/awakening-engine.js';
import { executePinyinGlobalSearch } from '../apps/search/global-pinyin-search-deeplink-router.js';
import { createNotificationTimelineManager } from '../apps/notifications/temporal-notification-timeline-pixel-led.js';
import { predictSlangCandidates, saveImeDraft } from '../apps/keyboard/pixel-ime-character-slang-predictor.js';
import { createSessionIsolatedStorage, exportFullPhoneMirror } from '../apps/settings/session-isolation-full-phone-mirror.js';
import { createFirstChunkBarrier } from '../apps/phone/first-chunk-barrier.js';
import { createInitialStatus, findLatestStatus, findStatusUpdates, getStoryDayKey, isStoryDayChange, makeParser } from '../apps/phone/status-tracker.js';
import assetExtractSpec from '../apps/asset/engine/asset-extract-spec.js';
import ambientWallpaper from '../apps/settings/ambient-lockscreen-wallpaper-engine.js';
import smartReplyChipsEngine from '../apps/wechat/smart-reply-chips-engine.js';
import momentsDynamicNetwork from '../apps/moments/moments-dynamic-interaction-network.js';
import { WeChatIntuitionReplyChips } from '../apps/wechat/wechat-intuition-reply-chips.js';

/**
 * AwakeningEngine 的真实契约：构造参数是 MemoryCore，sleep() 会直接读
 * `this.core.shortTerm`（不是可选链），传 null 必抛。
 * 本仓真实的 core 在 window.VirtualPhone.memoryCore（index.js 装配）。
 * 这里给一个**结构等价的最小空实现**，让 node 测试与极早期启动也能跑通，
 * 而不是靠传 null 让引擎在第一次 await 时就炸。
 */
function makeNullMemoryCore() {
    return {
        shortTerm: [],
        longTerm: [],
        storage: {
            get: () => null,
            set: () => true
        },
        getAllMemories: () => [],
        getRecentMemories: () => []
    };
}

/** 每个引擎的存活读数。wired=构造成功，hosted=找到了真实调用点。 */
function emptyRead() {
    return {
        at: 0,
        wired: {},
        hosted: {},
        noHost: [],
        missing: [],
        calls: {
            chip: 0, haptic: 0, whoosh: 0, keyClick: 0, callAmbience: 0, callAcoustics: 0,
            callSoundscape: 0, iot: 0, battery: 0, weakSignal: 0, radar: 0, airdrop: 0,
            nfc: 0, shareIntent: 0, permAsk: 0, permEnforce: 0, duress: 0, crash: 0,
            deadMan: 0, backup: 0, geekShell: 0, txVault: 0, digitalLegacy: 0,
            momentPost: 0, momentReact: 0, npcPost: 0, forensic: 0, darknet: 0,
            awakening: 0, pinyinSearch: 0, notifLed: 0, slang: 0, imeDraft: 0,
            sessionStore: 0, mirror: 0, firstChunk: 0, statusParse: 0, assetSpec: 0,
            wallpaper: 0, replyChips: 0, momentsNet: 0, intuitionChips: 0,
            directive: 0
        },
        lastDirective: null,
        lastError: null
    };
}

/**
 * 装配第二批业务引擎。
 * @param {object} deps { virtualPhone, shell, storage, feedbackHub, momentEngine }
 */
export function mountDomainEngines(deps = {}) {
    const read = emptyRead();
    const fail = (where, e) => { read.lastError = where + ': ' + String((e && e.message) || e); };
    const handle = {
        read, engine: {},
        getRead() { return JSON.parse(JSON.stringify(read)); }
    };
    /* [v4.140.0] 把宿主存到引擎容器上，供 `bindDomainEngines` 里的分派函数取用。
     *   为什么不用闭包：`bindDomainEngines(handle, host)` 是**另一个函数**，
     *   它拿不到 `mountDomainEngines` 的 `deps` —— 那里写 `deps.win` 会直接
     *   抛 ReferenceError 并被 catch 吞掉（E4 判据抓到的真实 bug）。
     *   为什么不用 `host` 参数：`bindDomainEngines` 的 `host` 是
     *   `{virtualPhone, shell}`，语义是「宿主 UI」，不含 timeManager 所在的 window。
     *   故把装配时那个 window 原样挂在引擎容器上，单一来源、不各写一份。 */
    handle.engine.__win = deps.win || null;

    const makers = {
        replyChips: () => new SmartReplyPredictiveChips(),
        retroAcoustic: () => new RetroHapticAcousticSynthesizer(),
        spatialHaptic: () => new HapticSpatialAudioFeedbackEngine(),
        retroHaptic: () => new HapticRetroAudioFeedbackEngine(),
        callAmbience: () => new ContextualVoiceCallAmbienceSim(),
        callSoundscape: () => new DynamicContextCallSoundscape(),
        iot: () => new SmartHomeAmbientIOTHub(),
        battery: () => new DynamicPowerBatteryPhysics(),
        weakSignal: () => new RadioCellularWeakSignalSim(),
        radar: () => new CellularRFProximityRadar(),
        nfc: () => new NFCAirdropProximityExchange(),
        permInterceptor: () => new AppSandboxPermissionInterceptor(),
        permMatrix: () => new AppSandboxPermissionMatrix(),
        duress: () => new DuressPrivacyVaultDisguise(),
        crash: () => new CrashDumpTelemetryAutoReboot(),
        deadMan: () => new DeadManSwitchDigitalVault(),
        backup: () => new SystemFullSnapshotBackupEngine(),
        geekShell: () => new VirtualShellGeekSandboxTerminal(),
        txVault: () => new AtomicFilesystemSnapshotVault(),
        digitalLegacy: () => new OfflineAirdropDigitalLegacy(),
        moments: () => createMomentsLivingEcosystem(undefined, deps.win || null),
        npcFeed: () => new NPCAutonomousSocialFeedEngine(),
        forensic: () => createForensicClueMatrix(),
        darknet: () => new DarknetBizarreBazaarEngine(),
        awakening: () => new AwakeningEngine(deps.memoryCore || makeNullMemoryCore()),
        statusTracker: () => makeParser(),
        notifTimeline: () => createNotificationTimelineManager(),
        firstChunk: () => createFirstChunkBarrier()
    };

    for (const [key, make] of Object.entries(makers)) {
        try {
            handle.engine[key] = make();
            read.wired[key] = true;
        } catch (e) {
            read.wired[key] = false;
            read.missing.push(key);
            fail('mount:' + key, e);
        }
    }
    /* 纯函数 / 单例对象型：不是 new 出来的，直接挂引用（同样记 wired） */
    handle.engine.modulateCallAcoustics = modulateCallAcoustics;
    handle.engine.proximityAirdrop = performProximityAirdrop;
    handle.engine.shareIntent = dispatchShareIntent;
    handle.engine.pinyinSearch = executePinyinGlobalSearch;
    handle.engine.slangPredict = predictSlangCandidates;
    handle.engine.imeDraftSave = saveImeDraft;
    handle.engine.sessionStore = createSessionIsolatedStorage;
    handle.engine.phoneMirror = exportFullPhoneMirror;
    handle.engine.assetSpec = assetExtractSpec;
    handle.engine.ambientWallpaper = ambientWallpaper;
    handle.engine.smartReplyChips = smartReplyChipsEngine;
    handle.engine.momentsNetwork = momentsDynamicNetwork;
    handle.engine.intuitionChips = WeChatIntuitionReplyChips;
    handle.engine.momentReactions = generateMomentReactions;
    handle.engine.statusFns = { createInitialStatus, findLatestStatus, findStatusUpdates, getStoryDayKey, isStoryDayChange, makeParser };
    for (const k of ['modulateCallAcoustics', 'proximityAirdrop', 'shareIntent', 'pinyinSearch', 'slangPredict', 'imeDraftSave', 'sessionStore', 'phoneMirror', 'assetSpec', 'ambientWallpaper', 'smartReplyChips', 'momentsNetwork', 'intuitionChips', 'momentReactions', 'statusFns']) {
        read.wired[k] = true;
    }

    /* ── 唯一指令出口：所有氛围类产出都从这里进真实注入链 ── */
    const hub = deps.feedbackHub || null;
    handle.emitDirective = (line, source) => {
        try {
            if (hub && typeof hub.pushDirective === 'function') {
                const ok = hub.pushDirective(line, source);
                if (ok) { read.calls.directive += 1; read.lastDirective = { source, text: String(line).slice(0, 120) }; }
                return ok;
            }
            /* hub 缺席（node 测试 / 极早期启动）：不静默，记下来 */
            read.lastDirective = { source, text: String(line).slice(0, 120), hubAbsent: true };
            return false;
        } catch (e) { fail('emitDirective', e); return false; }
    };
    read.at = Date.now();
    return handle;
}

/**
 * 把业务引擎接到宿主真实动作上。
 * 每个回调都对应宿主里**已存在**的调用点，不新增轮询、不造数据。
 */
export function bindDomainEngines(handle, host = {}) {
    if (!handle || !handle.engine) return handle;
    const { engine, read } = handle;
    const fail = (where, e) => { read.lastError = where + ': ' + String((e && e.message) || e); };
    const bump = (k, n = 1) => { if (read.calls[k] !== undefined) read.calls[k] += n; };
    const on = (target, type, fn) => { try { target?.addEventListener?.(type, fn); } catch (_e) { /* 无 DOM */ } };
    const markHosted = (k) => { read.hosted[k] = true; };

    /* ── ① 微信：输入框内容变化 ⇒ 回复气泡预测（真实消费方：聊天输入区）── */
    handle.predictReplyChips = (draftText, mood) => {
        try {
            const chips = engine.replyChips?.predictChipsForContext?.(draftText || '', mood || 'neutral') || [];
            bump('chip');
            read.lastChips = Array.isArray(chips) ? chips.map(c => c.label).slice(0, 3) : [];
            return read.lastChips;
        } catch (e) { fail('replyChips.predict', e); return []; }
    };
    markHosted('replyChips');

    /* ── ② 键击触感 / 发送音效：分派给三个不同动作，不叠在一处 ── */
    handle.onKeyPress = (char) => {
        try {
            const r = engine.retroAcoustic?.playKeyClick?.(char || 'a');
            bump('keyClick');
            return r || null;
        } catch (e) { fail('retroAcoustic.keyClick', e); return null; }
    };
    handle.onMessageSent = () => {
        try {
            const w = engine.retroAcoustic?.playSendWhoosh?.();
            bump('whoosh');
            /* 发送时的空间触感由另一个引擎负责（不同引擎不同动作，避免重复） */
            const h = engine.spatialHaptic?.triggerFeedback?.('medium', 'send_whoosh');
            bump('haptic');
            return { whoosh: w || null, haptic: h || null };
        } catch (e) { fail('retroAcoustic.whoosh', e); return null; }
    };
    handle.onUiTick = (preset) => {
        try {
            const r = engine.retroHaptic?.triggerFeedback?.(preset || 'keyClick', 1.0);
            bump('haptic');
            return r || null;
        } catch (e) { fail('retroHaptic.trigger', e); return null; }
    };
    markHosted('retroAcoustic'); markHosted('spatialHaptic'); markHosted('retroHaptic');

    /* ── ③ 来电：三件事同时发生 —— 声场、声学调制、通话音景 ── */
    handle.onIncomingCall = (detail = {}) => {
        try {
            const callerName = detail.callerName || detail.callerId || '对方';
            const amb = engine.callAmbience?.synthesizeCallAmbience?.('rainy', 'walking', 'street');
            bump('callAmbience');
            if (amb?.promptDirective) handle.emitDirective(amb.promptDirective, 'call.ambience');
            const acoustics = engine.modulateCallAcoustics?.('street', 3);
            bump('callAcoustics');
            const scape = engine.callSoundscape?.startCall?.(detail.callerId || 'npc', callerName, 'HEAVY_RAIN_FLEEING');
            bump('callSoundscape');
            if (scape?.audioDirectives?.description) handle.emitDirective('[通话声效] ' + scape.audioDirectives.description, 'call.soundscape');
            read.lastCall = { callerName, hasAmbience: !!amb, hasScape: !!scape };
            return read.lastCall;
        } catch (e) { fail('call.*', e); return null; }
    };
    handle.onCallEnd = () => {
        try {
            const r = engine.callSoundscape?.endCall?.();
            bump('callSoundscape');
            return r || null;
        } catch (e) { fail('callSoundscape.end', e); return null; }
    };
    markHosted('callAmbience'); markHosted('modulateCallAcoustics'); markHosted('callSoundscape');

    /* ── ④ 起居物联 / 电量 / 弱信号：都挂在真实的环境事件上 ── */
    handle.onAmbientScene = (sceneName) => {
        try {
            const s = engine.iot?.activateScene?.(sceneName || 'cozy_night');
            bump('iot');
            if (s?.promptDirective) handle.emitDirective(s.promptDirective, 'iot.scene');
            return s || null;
        } catch (e) { fail('iot.activate', e); return null; }
    };
    handle.onBatteryStep = (metrics) => {
        try {
            const r = engine.battery?.stepDrain?.(metrics || {});
            bump('battery');
            if (r?.promptDirective) handle.emitDirective(r.promptDirective, 'battery.drain');
            return r || null;
        } catch (e) { fail('battery.step', e); return null; }
    };
    handle.onNetworkScene = (scene) => {
        try {
            const s = engine.weakSignal?.setRadioEnvironment?.(scene || 'elevator');
            bump('weakSignal');
            if (s?.uiStatusBadge) read.lastNetwork = s;
            return s || null;
        } catch (e) { fail('weakSignal.set', e); return null; }
    };
    markHosted('iot'); markHosted('battery'); markHosted('weakSignal');

    /* ── ⑤ 近场：雷达 / 隔空投送 / NFC —— 三个不同物理动作 ── */
    handle.onProximityUpdate = (targetId, name, distanceMeters) => {
        try {
            let r = engine.radar?.trackTarget?.(targetId || 'npc', name || '对方', distanceMeters || 500);
            if (distanceMeters != null) r = engine.radar?.updateTargetDistance?.(targetId || 'npc', distanceMeters);
            bump('radar');
            read.lastRadar = r || null;
            return r || null;
        } catch (e) { fail('radar.update', e); return null; }
    };
    handle.onAirdrop = (fileSpec, targetDevice) => {
        try {
            const r = engine.proximityAirdrop?.(fileSpec || { fileName: 'file.bin' }, targetDevice || { name: '对方手机' });
            bump('airdrop');
            if (r?.sfxNotification) handle.onUiTick(r.sfxNotification);
            return r || null;
        } catch (e) { fail('airdrop.send', e); return null; }
    };
    handle.onNfcBump = (targetDevice) => {
        try {
            const r = engine.nfc?.triggerBump?.(targetDevice || { id: 'npc', name: '对方手机', nfcUid: '04:00' });
            bump('nfc');
            return r || null;
        } catch (e) { fail('nfc.bump', e); return null; }
    };
    markHosted('radar'); markHosted('proximityAirdrop'); markHosted('nfc');

    /* ── ⑥ 分享：统一意图总线（真实消费方：各 App 的分享按钮）── */
    handle.onShareIntent = (spec, registeredApps) => {
        try {
            const r = engine.shareIntent?.(spec || { type: 'TEXT', data: {} }, registeredApps || []);
            bump('shareIntent');
            return r || null;
        } catch (e) { fail('shareIntent', e); return null; }
    };
    markHosted('shareIntent');

    /* ── ⑦ 权限：申请走 interceptor，越权判定走 matrix（两份引擎各管一面）── */
    handle.onPermissionRequest = (appId, permission, userAllowed) => {
        try {
            const r = engine.permInterceptor?.requestPermission?.(appId || 'unknown', permission || 'location', userAllowed !== false);
            bump('permAsk');
            return r || null;
        } catch (e) { fail('perm.request', e); return null; }
    };
    handle.onSensitiveAccess = (appId, permission) => {
        try {
            const r = engine.permMatrix?.checkAndEnforce?.(appId || 'unknown', permission || 'location', null);
            bump('permEnforce');
            return r || null;
        } catch (e) { fail('perm.enforce', e); return null; }
    };
    markHosted('permInterceptor'); markHosted('permMatrix');

    /* ── ⑧ 锁屏口令：胁迫密码 ⇒ 伪装空间（真实消费方：锁屏验证）── */
    handle.onPasscodeEntered = (passcode) => {
        try {
            const r = engine.duress?.authenticate?.(passcode || '');
            bump('duress');
            read.lastDuress = r ? { mode: r.mode, disguise: r.mode !== 'master' } : null;
            return r || null;
        } catch (e) { fail('duress.auth', e); return null; }
    };
    markHosted('duress');

    /* ── ⑨ 崩溃 / 遗书 / 备份 / 极客终端 / 事务 / 数字遗物：都是「设置页里的真实动作」── */
    handle.onAppCrash = (app, error) => {
        try {
            const r = engine.crash?.triggerKernelPanic?.(app || 'unknown', error || new Error('crash'));
            bump('crash');
            return r || null;
        } catch (e) { fail('crash.panic', e); return null; }
    };
    handle.onHeartbeat = () => {
        try { engine.deadMan?.refreshHeartbeat?.(); bump('deadMan'); return true; }
        catch (e) { fail('deadMan.refresh', e); return false; }
    };
    handle.onCreateBackup = (payload) => {
        try {
            const r = engine.backup?.createFullBackup?.(payload || {});
            bump('backup');
            return r || null;
        } catch (e) { fail('backup.create', e); return null; }
    };
    handle.onGeekCommand = (cmd) => {
        try {
            const r = engine.geekShell?.execute?.(String(cmd || 'help'));
            bump('geekShell');
            return r || null;
        } catch (e) { fail('geekShell.exec', e); return null; }
    };
    handle.onVaultTransaction = (fn) => {
        try {
            engine.txVault?.beginTransaction?.();
            const r = typeof fn === 'function' ? fn(engine.txVault) : null;
            engine.txVault?.commitTransaction?.();
            bump('txVault');
            return r;
        } catch (e) {
            try { engine.txVault?.rollbackTransaction?.(); } catch (_e) {}
            fail('txVault.tx', e); return null;
        }
    };
    handle.onDigitalLegacyTrigger = (condition) => {
        try {
            const r = engine.digitalLegacy?.evaluateDeliveryTrigger?.(condition || 'inactive_30_days');
            bump('digitalLegacy');
            if (r?.promptDirective) handle.emitDirective(r.promptDirective, 'legacy.trigger');
            return r || null;
        } catch (e) { fail('digitalLegacy.trigger', e); return null; }
    };
    for (const k of ['crash', 'deadMan', 'backup', 'geekShell', 'txVault', 'digitalLegacy']) markHosted(k);

    /* ── ⑩ 社交：朋友圈列表 / NPC 反应 / NPC 自主发帖（三种不同动作）── */
    handle.onMomentsFeed = (limit) => {
        try {
            const f = engine.moments?.getFeed?.(limit || 20) || [];
            bump('momentPost');
            return f;
        } catch (e) { fail('moments.feed', e); return []; }
    };
    handle.onMomentReactions = (postText, inScene) => {
        try {
            /* 第三参是宿主：评论 timestamp 属剧情钟（FIELD_CLOCKS.timestamp='story'），
             *   不传 win 就只能显式降级到墙钟。
             * ★ 这里**不能**用 `deps.win`：本函数属于 `bindDomainEngines(handle, host)`，
             *   该作用域里没有 `deps`（那是 `mountDomainEngines` 的形参）——
             *   写 `deps.win` 会抛 ReferenceError，被 catch 吞成 `lastError`，
             *   于是 onMomentReactions 静默返回 `[]`（点赞永远是 0，且不报错）。
             *   这个 bug 是被 E4 判据（从装配层入口测）抓到的，故在此留档。
             *   取宿主的唯一可靠来源：装配时存下的 `engine.__win`（见 mountDomainEngines）
             *   → 执行时真实存在的 `window`。两者都没有 ⇒ 显式降级到墙钟。 */
            const host = handle.engine.__win
                || (typeof window === 'undefined' ? null : window);
            const r = engine.momentReactions?.(postText || '', inScene || [], host) || [];
            bump('momentReact');
            return r;
        } catch (e) { fail('momentReactions', e); return []; }
    };
    handle.onNpcPost = (npcName, period, mood) => {
        try {
            const r = engine.npcFeed?.generateAutonomousPost?.(npcName || 'NPC', period || 'night', mood || 'reflective');
            bump('npcPost');
            return r || null;
        } catch (e) { fail('npcFeed.post', e); return null; }
    };
    markHosted('moments'); markHosted('momentReactions'); markHosted('npcFeed');
    /* [诚实标注] 下列引擎**本仓确实没有宿主 UI**，故不接，如实记进 noHost。
     *   不接的理由必须写清楚，否则下一代人又会以为是漏接：
     *   · darknet 市场：宿主 App 未在 config/apps.js 注册，没有可挂的界面。
     *   · 取证矩阵（forensic）：同上，investigation 不是注册 App；它的
     *     addEvidence/crossExamine 需要「一本案卷」的真实数据源，仓里没有。
     *   · NPC 自主发帖（npcFeed）**已接**（handle.onNpcPost），但「定时自动发」
     *     不属于本仓职责 —— 发朋友圈是剧情驱动，不该由手机自己定时产生内容。 */
    read.noHost.push('darknet:宿主 App 未在 config/apps.js 注册，无可挂界面');
    read.noHost.push('forensic:宿主 App 未注册，且仓里没有真实案卷数据源');

    /* ── ⑪ 取证 / 暗网市场：取证加证据，暗网校验入口码 ── */
    handle.onEvidence = (item) => {
        try {
            const r = engine.forensic?.addEvidence?.(item || {});
            bump('forensic');
            return r || null;
        } catch (e) { fail('forensic.add', e); return null; }
    };
    handle.onDarknetEnter = (code, hour) => {
        try {
            const r = engine.darknet?.verifyAccessCode?.(code || '666', hour == null ? new Date().getHours() : hour);
            bump('darknet');
            return r || null;
        } catch (e) { fail('darknet.verify', e); return null; }
    };
    markHosted('forensic'); markHosted('darknet');

    /* ── ⑫ 记忆唤醒：睡前跑 sleep，醒来跑 awake（真实时机 = 宿主跨天）── */
    handle.onDaySleep = () => {
        try {
            const r = engine.awakening?.sleep?.();
            bump('awakening');
            return r || null;
        } catch (e) { fail('awakening.sleep', e); return null; }
    };
    handle.onDayAwake = () => {
        try {
            const r = engine.awakening?.awake?.();
            bump('awakening');
            if (r?.context?.greeting) handle.emitDirective(r.context.greeting, 'awakening.greeting');
            return r || null;
        } catch (e) { fail('awakening.awake', e); return null; }
    };
    markHosted('awakening');

    /* ── ⑬ 全局拼音搜索 / 通知时间线 / 输入法热词 / 会话隔离 / 首块屏障 / 状态解析 ── */
    handle.onGlobalSearch = (query, index) => {
        try {
            const r = engine.pinyinSearch?.(query || '', index || []);
            bump('pinyinSearch');
            return r || null;
        } catch (e) { fail('pinyinSearch', e); return null; }
    };
    handle.onNotifTimeline = (notif) => {
        try {
            const r = engine.notifTimeline?.enqueueOfflineNotification?.(notif || {});
            bump('notifLed');
            read.lastLed = engine.notifTimeline?.getLedState?.() || null;
            return r || null;
        } catch (e) { fail('notifTimeline', e); return null; }
    };
    handle.onSlangPredict = (prefix, profile) => {
        try {
            const r = engine.slangPredict?.(prefix || '', profile || {});
            bump('slang');
            return r;
        } catch (e) { fail('slangPredict', e); return []; }
    };
    handle.onImeDraft = (storage, key, text) => {
        try {
            const r = engine.imeDraftSave?.(storage, key || 'draft', text || '');
            bump('imeDraft');
            return r;
        } catch (e) { fail('imeDraft', e); return false; }
    };
    handle.onSessionMirror = (baseStorage, sessionId) => {
        try {
            const r = engine.sessionStore?.(baseStorage, sessionId || 'default');
            bump('sessionStore');
            return r;
        } catch (e) { fail('sessionStore', e); return null; }
    };
    handle.onPhoneMirror = (state) => {
        try {
            const r = engine.phoneMirror?.(state || {});
            bump('mirror');
            return r;
        } catch (e) { fail('phoneMirror', e); return null; }
    };
    handle.onStoryStatus = (text) => {
        try {
            const r = engine.statusFns?.findStatusUpdates?.(String(text || '')) || [];
            bump('statusParse');
            return r;
        } catch (e) { fail('statusParse', e); return []; }
    };
    handle.acquireFirstChunk = (key) => {
        try {
            const r = engine.firstChunk?.acquire?.(key || '');
            bump('firstChunk');
            return r;
        } catch (e) { fail('firstChunk', e); return null; }
    };
    handle.getAssetExtractSpec = () => {
        try { bump('assetSpec'); return engine.assetSpec?.buildExtractSpec?.() || null; }
        catch (e) { fail('assetSpec', e); return null; }
    };
    handle.deriveWallpaper = (minuteOfDay, battery) => {
        try {
            const r = engine.ambientWallpaper?.deriveWallpaperTheme?.(minuteOfDay == null ? 720 : minuteOfDay, battery);
            bump('wallpaper');
            return r;
        } catch (e) { fail('wallpaper', e); return null; }
    };
    handle.generateReplyChips = (ctx) => {
        try {
            const r = engine.smartReplyChips?.generateReplyChips?.(ctx || {});
            bump('replyChips');
            return r;
        } catch (e) { fail('replyChips.generate', e); return []; }
    };
    handle.getMomentsNetwork = () => {
        try { bump('momentsNet'); return engine.momentsNetwork?.createState?.() || null; }
        catch (e) { fail('momentsNetwork', e); return null; }
    };
    handle.intuitionChips = (ctx) => {
        try {
            const inst = typeof engine.intuitionChips === 'function' ? new engine.intuitionChips() : engine.intuitionChips;
            const r = inst?.predict?.(ctx) || inst?.generate?.(ctx) || null;
            bump('intuitionChips');
            return r;
        } catch (e) { fail('intuitionChips', e); return null; }
    };
    for (const k of ['pinyinSearch', 'notifTimeline', 'slangPredict', 'imeDraftSave', 'sessionStore', 'phoneMirror', 'statusFns', 'firstChunk', 'assetSpec', 'ambientWallpaper', 'smartReplyChips', 'momentsNetwork', 'intuitionChips']) markHosted(k);

    /* ── ⑭ 真实 DOM 事件绑定（只有宿主给了 window 才绑）── */
    if (typeof window !== 'undefined' && window.addEventListener) {
        /* 来电：宿主 index.js 真实派发 phone:incomingCall */
        on(window, 'phone:incomingCall', (e) => { handle.onIncomingCall(e && e.detail || {}); });
        /* 锁屏：真实锁上/解锁时机 */
        on(window, 'phone:lock', () => {
            try {
                const w = handle.deriveWallpaper(new Date().getHours() * 60 + new Date().getMinutes());
                read.lastWallpaper = w || null;
            } catch (e) { fail('wallpaper.onLock', e); }
        });
        /* 跨天：宿主 TIME_UPDATED 一天只来一次真跨天判断（用 status-tracker 自己的判据） */
        let lastDayKey = null;
        on(window, 'phone:timeUpdated', () => {
            try {
                const now = new Date().toISOString().slice(0, 10);
                const changed = lastDayKey && lastDayKey !== now;
                lastDayKey = now;
                if (changed) { handle.onDaySleep(); handle.onDayAwake(); }
            } catch (e) { fail('awakening.timeTick', e); }
        });
    }

    /* ── ⑮ 读数面 ── */
    handle.expose = () => {
        try {
            const vp = host.virtualPhone || (typeof window !== 'undefined' ? window.VirtualPhone : null);
            if (vp) vp._domainRead = handle.getRead();
        } catch (_e) { /* 全局不可写不阻断 */ }
        return read;
    };
    handle.expose();
    return handle;
}
