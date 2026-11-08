import test from 'node:test';
import assert from 'node:assert/strict';

import WeChatIntuitionReplyChips from '../apps/wechat/wechat-intuition-reply-chips.js';
import { createForensicClueMatrix } from '../apps/investigation/forensic-cross-app-clue-matrix.js';
import { SpotlightUniversalSearch } from '../config/spotlight-universal-search.js';
import { createMomentsLivingEcosystem } from '../apps/moments/moments-living-social-ecosystem.js';
import { calculateVirtualSlice, VirtualSliceScrollingFPSBooster } from '../phone/virtual-slice-scrolling-fps-booster.js';
import NFCAirdropProximityExchange from '../apps/share/nfc-airdrop-proximity-exchange.js';
import DarknetBizarreBazaarEngine from '../apps/darknet/darknet-bizarre-bazaar-engine.js';
import CellularRFProximityRadar from '../apps/network/cellular-rf-proximity-radar.js';
import AmbientBiorhythmLockscreen from '../phone/ambient-biorhythm-lockscreen.js';
import DynamicContextCallSoundscape from '../apps/call/dynamic-context-call-soundscape.js';
import DeadManSwitchDigitalVault from '../apps/security/dead-man-switch-digital-vault.js';
import MultitaskViewstackResumptionEngine from '../phone/multitask-viewstack-resumption-engine.js';
import ScreenPrivacyCloakEngine from '../phone/screen-privacy-cloak-engine.js';
import SystemFullSnapshotBackupEngine from '../apps/security/system-full-snapshot-backup-engine.js';
import VirtualShellGeekSandboxTerminal from '../apps/security/virtual-shell-geek-sandbox-terminal.js';
import { applyPhysicalDamage } from '../apps/hardware/physical-damage-degradation-simulator.js';
import RetroHapticAcousticSynthesizer from '../apps/audio/retro-haptic-acoustic-synthesizer.js';
import RubyPhoneLonShaBidirectionalFeedbackHub from '../apps/memory/ruby-phone-lonsha-bidirectional-feedback-hub.js';

test('R17-X1: 微信直觉回复气泡推导 (WeChat Intuition Reply Chips)', () => {
    // 疲惫场景
    const tiredChips = WeChatIntuitionReplyChips.generateIntuitionChips('今天加班加到快虚脱了，好累……');
    assert.equal(tiredChips.length, 3);
    assert.ok(tiredChips.some(c => c.text.includes('辛苦啦') || c.text.includes('休息') || c.text.includes('休眠')));

    // 庆祝场景
    const happyChips = WeChatIntuitionReplyChips.generateIntuitionChips('哈哈太棒了，面试顺利通过啦！');
    assert.equal(happyChips.length, 3);
    assert.ok(happyChips.some(c => c.text.includes('太棒啦') || c.text.includes('庆祝')));
});

test('R17-X2: 跨 App 刑侦物证链与不在场证明时空对撞机 (Forensic Clue Matrix)', () => {
    const matrix = createForensicClueMatrix();
    const now = Date.now();

    // 录入口供: 微信声称 22:00 已经睡下
    matrix.addEvidence({
        id: 'claim_1',
        sourceApp: 'wechat',
        timestamp: now - 3600 * 1000,
        claimType: 'claim',
        content: '我太困了，先睡在床上啦，晚安',
        location: '卧室'
    });

    // 录入实证: 钱包在 22:30 便利店买提神咖啡
    matrix.addEvidence({
        id: 'phys_1',
        sourceApp: 'wallet',
        timestamp: now - 1800 * 1000,
        claimType: 'physical',
        content: '购买热美式咖啡消费支出',
        location: '24小时便利店'
    });

    const report = matrix.crossExamine();
    assert.equal(report.inconsistenciesFound, 1);
    assert.equal(report.details[0].type, 'ALIBI_CONTRADICTION');
    assert.ok(report.details[0].description.includes('不在场证明破绽'));
});

test('R17-O1: Spotlight 全局拼音穿透与跨 App 语义穿透检索', () => {
    const spotlight = new SpotlightUniversalSearch();
    spotlight.indexEntities('WECHAT', [
        { id: 'msg_1', title: '爱丽丝 (Alice)', content: '今晚天台秘密据点见，下雨了注意带伞' },
        { id: 'msg_2', title: '工作群', content: '明天早上9点开例会' }
    ]);
    spotlight.indexEntities('DIARY', [
        { id: 'diary_1', title: '关于火灾的回忆', content: '那场大火彻底带走了一切' }
    ]);

    // 检索关键词与全拼
    const res1 = spotlight.search('秘密据点');
    assert.ok(res1.results.length > 0);
    assert.equal(res1.results[0].title, '爱丽丝 (Alice)');

    // 检索火灾
    const res2 = spotlight.search('火灾');
    assert.ok(res2.results.length > 0);
    assert.equal(res2.results[0].domain, 'DIARY');
});

test('R17-X3: 朋友圈 24 小时动态生态圈与多角色互动 (Moments Living Social Ecosystem)', () => {
    const ecosystem = createMomentsLivingEcosystem();

    // 发布动态
    const post = ecosystem.postMoment({
        author: '夏洛特 (Charlotte)',
        content: '新研制的红茶点心出炉啦，谁要来尝尝？🍪'
    });
    assert.ok(post && post.id);

    // 点赞
    const liked = ecosystem.likeMoment(post.id, '玩家');
    assert.equal(liked, true);

    // 玩家评论触发 NPC 互动回复
    ecosystem.addComment(post.id, '玩家', '看起来太香了，留一块给我！');
    const feed = ecosystem.getFeed();
    const targetPost = feed.find(m => m.id === post.id);
    assert.equal(targetPost.comments.length, 2);
    assert.ok(targetPost.comments[1].text.includes('收到你的评论啦'));
});

test('R17-O2: 超长微信/社区消息流 60fps 虚拟滚动切片渲染 (Virtual Slice Scrolling)', () => {
    const booster = new VirtualSliceScrollingFPSBooster({
        itemHeight: 50,
        viewportHeight: 500,
        bufferCount: 4
    });

    // 模拟 1000 条长消息流，滚动到第 2000px 高度处
    const slice = booster.computeSlice(2000, 1000);
    assert.ok(slice.startIndex > 0);
    assert.ok(slice.endIndex > slice.startIndex);
    // 渲染节点数恒定在 20 左右，绝不全量渲染
    assert.ok(slice.renderedCount <= 25);
    assert.ok(slice.topSpacerHeight > 0);
    assert.ok(slice.bottomSpacerHeight > 0);
});

test('R17-X4: 近场 NFC 碰一碰名片与快传通道 (NFC Airdrop Proximity)', () => {
    const nfc = new NFCAirdropProximityExchange();
    const bumpRes = nfc.triggerBump({
        id: 'npc_phone_99',
        name: '林深的时空终端',
        nfcUid: '04:77:88:99:AA'
    });
    assert.equal(bumpRes.success, true);
    assert.equal(bumpRes.status, 'CONNECTED');
    assert.equal(bumpRes.hapticPattern, 'bump_double_vibrate');

    // 发送名片
    const tx = nfc.exchangePayload('npc_phone_99', {
        type: 'SECRET_DOCUMENT',
        title: '老城档案馆绝密平面图.pdf',
        data: { size: '4.2MB' }
    });
    assert.equal(tx.success, true);
    assert.equal(tx.record.status, 'COMPLETED');
    assert.equal(nfc.getHistory().length, 1);
});

test('R17-X5: 深夜暗网双域集市与匿名加密信道 (Darknet Bizarre Bazaar)', () => {
    const bazaar = new DarknetBizarreBazaarEngine();
    
    // 白天无暗号拒绝访问
    const failRes = bazaar.verifyAccessCode('123456', 14);
    assert.equal(failRes.unlocked, false);

    // 拨号暗号 *#0666# 解锁
    const authRes = bazaar.verifyAccessCode('*#0666#', 14);
    assert.equal(authRes.unlocked, true);
    assert.ok(authRes.portalBanner.includes('ONION BAZAAR'));

    // 查看货架与购买
    const items = bazaar.getMarketListing();
    assert.ok(items.length >= 3);
    const target = items.find(i => i.id === 'item_surveillance_log');
    assert.ok(target !== undefined);

    const buyRes = bazaar.purchaseItem(target.id, 2500);
    assert.equal(buyRes.success, true);
    assert.ok(buyRes.order.lockerPickupCode.startsWith('CAB_'));
    assert.ok(buyRes.smsReceiptPrompt.includes('提货码已投递'));
});

test('R17-X6: 射频基站嗅探与 NPC 手机信号三角接近雷达 (Cellular RF Proximity Radar)', () => {
    const radar = new CellularRFProximityRadar();
    const target = radar.trackTarget('npc_stalker', '跟踪者X', 300);
    assert.equal(target.proximityLevel, 'FAR');

    // 逼近到 40 米
    const closeRes = radar.updateTargetDistance('npc_stalker', 40);
    assert.equal(closeRes.proximityLevel, 'CLOSE');
    assert.ok(closeRes.radarWarning.includes('快速靠近'));

    // 逼近到 8 米高危红区
    const dangerRes = radar.updateTargetDistance('npc_stalker', 8);
    assert.equal(dangerRes.proximityLevel, 'DANGER_PROXIMITY');
    assert.ok(dangerRes.radarWarning.includes('绝对近身圈'));
});

test('R17-X7: 呼吸氛围情境动态锁屏与心率微光投影 (Ambient Biorhythm Lockscreen)', () => {
    const lockscreen = new AmbientBiorhythmLockscreen();
    
    // 正常温和陪伴状态
    const normalState = lockscreen.updateBiorhythm({ weather: 'RAINY', bpm: 72, intimacyLevel: 60 });
    assert.equal(normalState.heartRateBpm, 72);
    assert.equal(normalState.auraGlowHex, '#4CC9F0');

    // 剧情紧张心跳激增 (BPM 135)
    const panicState = lockscreen.updateBiorhythm({ weather: 'RAINY', bpm: 135, intimacyLevel: 60 });
    assert.equal(panicState.particleSpeed, 2.5);
    assert.equal(panicState.auraGlowHex, '#FF4D6D');
    assert.equal(panicState.weatherMood, 'RACING_PULSE_ALERT');
    assert.ok(panicState.renderSpecs.cssFilter.includes('#FF4D6D'));
});

test('R17-X8: 沉浸式情境通话与实时环境声场模拟器 (Dynamic Context Call Soundscape)', () => {
    const soundscape = new DynamicContextCallSoundscape();
    
    // 暴雨逃亡情境通话
    const callRes = soundscape.startCall('npc_suli', '苏离', 'HEAVY_RAIN_FLEEING');
    assert.ok(callRes.call && callRes.call.callId);
    assert.equal(callRes.call.profile.pantingAudioLoop, true);
    assert.ok(callRes.audioDirectives.description.includes('密集的雨点与急促的喘息声'));
    assert.equal(callRes.audioDirectives.filters.lowPass, 3500);

    const ended = soundscape.endCall();
    assert.ok(ended && ended.callId);
});

test('R17-X9: 随身数字遗物保险箱与死人开关定时密信 (Dead Man Switch Digital Vault)', () => {
    const vault = new DeadManSwitchDigitalVault(1000); // 1秒超时测试
    vault.depositSealedLetter(
        'player',
        '绝笔：若我未能从今夜的拍卖行归来',
        '当你看到这封信时，我大概已经不在了。所有的证据我都藏在老洋房书房的第三块地板下……'
    );

    // 尚未超时，开关处于密封安全状态
    const safeCheck = vault.checkSwitchState(Date.now() + 200);
    assert.equal(safeCheck.deadManSwitchTriggered, false);

    // 模拟超时 2 秒（失联）
    const triggeredCheck = vault.checkSwitchState(Date.now() + 2500);
    assert.equal(triggeredCheck.deadManSwitchTriggered, true);
    assert.equal(triggeredCheck.unsealedLetters.length, 1);
    assert.equal(triggeredCheck.unsealedLetters[0].status, 'UNSEALED');
    assert.ok(triggeredCheck.alert.includes('死人开关已激活'));
});

test('R17-O3: 多任务悬浮窗、原位续办与掌机视图栈防死锁回收器 (Multitask Resumption)', () => {
    const engine = new MultitaskViewstackResumptionEngine();
    
    // 在微信中编辑长消息
    engine.switchApp('wechat');
    // 突然被相册切换打断
    engine.switchApp('album', { draftText: '我其实一直想对你说……', cursorPosition: 11 });
    assert.equal(engine.activeApp, 'album');

    // 强行来电打断相册
    const interruptRes = engine.handleInterrupt({ photoId: 'pic_102' });
    assert.equal(interruptRes.interruptedApp, 'album');

    // 返回微信，草稿与视口原位精准恢复
    const popRes = engine.popApp();
    assert.equal(popRes.activeApp, 'wechat');
    assert.equal(popRes.restoredDraft.draftText, '我其实一直想对你说……');
});

test('R17-O6: 同室近距离防偷窥隐私罩与屏幕遮蔽模式 (Screen Privacy Cloak)', () => {
    const cloak = new ScreenPrivacyCloakEngine();
    
    // 激活伪装闹钟壁纸
    const activeRes = cloak.activateCloak('DISGUISE_CLOCK');
    assert.equal(activeRes.active, true);
    assert.equal(activeRes.displayOverlay.view, 'RETRO_ALARM_CLOCK_FACE');

    // 物理反扣手机秒级黑屏
    const flipRes = cloak.handleFlipDown();
    assert.equal(flipRes.screenState, 'DEEP_SLEEP');
    assert.equal(flipRes.audioMuted, true);

    // 翻正解除
    const deactRes = cloak.deactivateCloak();
    assert.equal(deactRes.active, false);
});

test('R17-O7: 整机全量数据秒级冷备份与版本迁移 (System Full Snapshot Backup)', () => {
    const backupEngine = new SystemFullSnapshotBackupEngine();
    
    // 生成整机快照
    const backupRes = backupEngine.createFullBackup({
        chats: [{ id: 1, text: '今夜老地方见' }],
        contacts: [{ name: '苏离', phone: '13800000000' }],
        photos: [{ id: 'p1', title: '绝密档案相片' }],
        memos: [{ title: '秘密钥匙密码', content: '9527' }]
    });
    assert.equal(backupRes.success, true);
    assert.equal(backupRes.itemCounts.chats, 1);
    assert.equal(backupRes.itemCounts.contacts, 1);

    // 模拟新环境冷还原
    const restoreRes = backupEngine.restoreFromBackup(backupRes.exportJson);
    assert.equal(restoreRes.success, true);
    assert.equal(restoreRes.data.wechatStream.length, 1);
    assert.equal(restoreRes.data.notes[0].content, '9527');
});

test('R17-O8: 虚拟硬件物理损耗、电量衰减与屏幕裂痕模拟器 (Physical Damage Simulator)', () => {
    // 模拟剧烈碰撞导致屏幕严重残损
    const damagedState = applyPhysicalDamage({}, 'severe');
    assert.equal(damagedState.healthStatus, 'severe');
    assert.equal(damagedState.cracksOverlayActive, true);
    assert.ok(damagedState.cracksCount >= 5);
    assert.equal(damagedState.hasDeadZone, true);
    assert.ok(damagedState.batteryDrainFactor >= 2.0);
});

test('R17-O9: 掌机底层虚拟沙盒终端与极客开发者调试台 (Virtual Shell Terminal)', () => {
    const term = new VirtualShellGeekSandboxTerminal();
    
    // 执行 pwd / ls / ps
    const pwdRes = term.execute('pwd');
    assert.equal(pwdRes.exitCode, 0);
    assert.equal(pwdRes.output, '/');

    const lsRes = term.execute('ls /data');
    assert.equal(lsRes.exitCode, 0);
    assert.ok(lsRes.output.includes('wechat_chats.db'));

    const psRes = term.execute('ps');
    assert.equal(psRes.exitCode, 0);
    assert.ok(psRes.output.includes('com.ruby.wechat'));

    const memRes = term.execute('mem');
    assert.equal(memRes.exitCode, 0);
    assert.ok(memRes.output.includes('60fps_virtual_slice'));
});

test('R17-O5: 沉浸式场景声学环境音与复古触觉/音效合成器 (Retro Haptic Synthesizer)', () => {
    const synth = new RetroHapticAcousticSynthesizer();
    
    // 打字音效
    const click = synth.playKeyClick('w');
    assert.equal(click.name, 'KEY_MECHANICAL_CLICK');
    assert.equal(click.haptic, 'micro_tick_5ms');

    // 消息嗖声发出
    const whoosh = synth.playSendWhoosh();
    assert.equal(whoosh.name, 'MESSAGE_WHOOSH_OUT');
    assert.ok(whoosh.durationMs > 100);

    // 微雨环境声场
    const ambient = synth.setAmbientScene('DRIZZLE_WINDOW');
    assert.equal(ambient.ambientActive, true);
    assert.ok(ambient.description.includes('微雨背景底噪'));
});

test('R17-O4: 手机日常全息操作向 LonSha 记忆心智因果双向反哺闭环 (Bidirectional Feedback Hub)', () => {
    const feedbackHub = new RubyPhoneLonShaBidirectionalFeedbackHub();
    
    // 玩家在手机通讯录修改角色备注为“小笨蛋”
    const remarkRes = feedbackHub.onContactRemarkChanged('苏离', '苏离', '小笨蛋');
    assert.equal(remarkRes.success, true);
    assert.equal(remarkRes.event.emotionalTone, 'TEASING');
    assert.ok(remarkRes.lonshaDirectives.includes('小笨蛋'));
    assert.ok(remarkRes.lonshaDirectives.includes('娇嗔'));

    // 玩家通过手机钱包给角色转账 520 元
    const transferRes = feedbackHub.onFinancialTransfer('苏离', 520, '买奶茶的零花钱');
    assert.equal(transferRes.success, true);
    assert.equal(transferRes.event.amount, 520);
    assert.ok(transferRes.lonshaDirectives.includes('520 元'));
    assert.equal(feedbackHub.getEvents().length, 2);
});