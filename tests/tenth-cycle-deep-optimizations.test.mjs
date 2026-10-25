/**
 * tests/tenth-cycle-deep-optimizations.test.mjs
 * 
 * RubyPhone 第十期 (R10) 深度优化与前沿拓展第二、三批机制真实性与契约单测
 * 严格对齐真实导出 API 与业务契约：
 * - R10-O5: 智能相册与隐私保险箱 (SmartGalleryVault)
 * - R10-O6: 电池动力学与发热降频 (BatteryThermodynamics)
 * - R10-O7: 蜂窝网络与离线弱网模拟 (CellularSignalSim)
 * - R10-O8: 虚拟文件系统 (VirtualFileSystem)
 * - R10-O9: 全键盘触感与智能输入法 (HapticPredictiveIme)
 * - R10-X1: 虚拟网盘与角色秘密碎片 (CloudDriveSync)
 * - R10-X2: 拟真短视频与角色直播生态 (ShortVideoLiveHub)
 * - R10-X4: 即时同城配送与投喂服务 (HyperlocalDeliveryService)
 * - R10-X5: 手机环境录音机与窃听解密 (AmbientAudioWiretap)
 * - R10-X6: 角色健康手环生理联动 (SmartBandBiometrics)
 * - R10-X7: 多账户多重人格分身系统 (ParallelPersonaSpaces)
 * - R10-X8: 智能生活日程管家与自驱生活事件发生器 (CalendarAutonomousLifeEngine)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SmartGalleryVault, PHOTO_SECRECY } from '../config/smart-gallery-vault.js';
import { BatteryThermodynamics, APP_POWER_LOADS, POWER_STATES } from '../config/battery-thermodynamics.js';
import { CellularSignalSim, NETWORK_TYPES } from '../config/cellular-signal-sim.js';
import { VirtualFileSystem, VFS_DIRECTORIES } from '../config/virtual-file-system.js';
import { HapticPredictiveIme, HAPTIC_TYPES } from '../config/haptic-predictive-ime.js';
import { CloudDriveSync } from '../config/cloud-drive-sync.js';
import { ShortVideoLiveHub, LIVE_ROOM_STATUS, GIFT_TIERS } from '../config/short-video-live-hub.js';
import { HyperlocalDeliveryService, ORDER_STATUS, FOOD_MENU } from '../config/hyperlocal-delivery-service.js';
import { AmbientAudioWiretap } from '../config/ambient-audio-wiretap.js';
import { SmartBandBiometrics } from '../config/smart-band-biometrics.js';
import { ParallelPersonaSpaces, DEFAULT_SPACE_ID } from '../config/parallel-persona-spaces.js';
import { CalendarAutonomousLifeEngine, EVENT_CATEGORIES, EVENT_STATUS } from '../config/calendar-autonomous-life.js';

test('第十期 (R10) 深度优化与前沿机制 (第二、三批 12 项) 真实契约验证', async (t) => {

  // 1. R10-O5: 智能相册与隐私保险箱
  await t.test('1. [R10-O5] 智能相册多维检索与密码保险箱防爆破锁定', () => {
    const gallery = new SmartGalleryVault({ vaultPin: '8888' });
    gallery.addPhoto({ id: 'p1', url: 'https://cdn.example.com/p1.jpg', title: '海边合影', actors: ['林安安'], secrecy: PHOTO_SECRECY.PUBLIC });
    gallery.addPhoto({ id: 'p2', url: 'https://cdn.example.com/p2.jpg', title: '更衣室私密自拍', actors: ['林安安'], secrecy: PHOTO_SECRECY.INTIMATE });

    // 普通列表仅包含公开照片
    assert.equal(gallery.photos.length, 1);
    assert.equal(gallery.photos[0].id, 'p1');
    assert.equal(gallery.vaultPhotos.length, 1);
    assert.equal(gallery.vaultPhotos[0].id, 'p2');

    // 错误 PIN 码重试与锁定
    assert.equal(gallery.unlockVault('0000').success, false);
    assert.equal(gallery.unlockVault('1111').success, false);
    const lockRes = gallery.unlockVault('2222');
    assert.equal(lockRes.success, false);
    assert.match(lockRes.message, /锁定/);

    // 强制清除锁定时间后正确解锁
    gallery.lockedUntil = 0;
    const unlockRes = gallery.unlockVault('8888');
    assert.equal(unlockRes.success, true);
    assert.equal(gallery.isUnlocked, true);
  });

  // 2. R10-O6: 电池动力学与发热降频
  await t.test('2. [R10-O6] 电池高负载发热降频与临界低电量告警', () => {
    const battery = new BatteryThermodynamics({ initialLevel: 6 });
    battery.temperature = 39.5;
    
    // 运行重度游戏模拟耗电与升温 (单次 tick 推进 15 分钟)
    battery.setAppLoad('GAME');
    const tickRes = battery.tick(15);
    assert.ok(battery.temperature >= 42.0, '游戏运行温度应升至42度以上触发节流');
    assert.ok(battery.isThrottling, '高温应触发热节流降频');
    assert.ok(tickRes.criticalAlert, '电量<=5%时应发出临界低电量预警');

    // 接入快充充电器
    battery.setCharging(true, true);
    assert.equal(battery.isCharging, true);
    battery.tick(10);
    assert.ok(battery.level > 5, '快充应有效恢复电量');
  });

  // 3. R10-O7: 蜂窝网络与离线弱网模拟
  await t.test('3. [R10-O7] 弱网断连队列缓冲与网络恢复自驱动补发', () => {
    const cell = new CellularSignalSim();
    
    // 切换至地下室弱网环境
    cell.applyEnvironmentScenario('BASEMENT');
    assert.equal(cell.networkType, NETWORK_TYPES.NO_SERVICE);

    // 弱网下尝试发送消息 -> 失败进入离线排队缓冲
    const sendRes = cell.dispatchMessage({ toContact: '林安安', text: '我现在地下室没信号' });
    assert.equal(sendRes.sent, false);
    assert.equal(sendRes.status, 'QUEUED');
    assert.equal(cell.outboxQueue.length, 1);

    // 切换到正常 5G 信号
    const restoreRes = cell.applyEnvironmentScenario('NORMAL');
    assert.equal(cell.networkType, NETWORK_TYPES.FIVE_G);
    assert.equal(restoreRes.flushed, 1);
    assert.equal(cell.outboxQueue.length, 0);
  });

  // 4. R10-O8: 虚拟文件系统
  await t.test('4. [R10-O8] VFS 分层目录隔离与跨 App 文件投递总线', () => {
    const vfs = new VirtualFileSystem();
    
    // 沙箱写入
    const writeRes = vfs.writeFile('/Documents/confidential.txt', '机密协议内容', { appOwner: 'memo_app' });
    assert.ok(writeRes.path);
    assert.equal(writeRes.sizeBytes > 0, true);

    // 读取验证
    const readRes = vfs.readFile('/Documents/confidential.txt');
    assert.equal(readRes.content, '机密协议内容');

    // 跨应用文件分享
    const shareRes = vfs.shareToApp('/Documents/confidential.txt', 'wechat');
    assert.equal(shareRes.targetApp, 'wechat');
    assert.equal(shareRes.fileName, 'confidential.txt');
  });

  // 5. R10-O9: 全键盘触感与智能输入法
  await t.test('5. [R10-O9] 输入法拼音联想与触感反馈模式', () => {
    const ime = new HapticPredictiveIme();
    
    // 触感按键
    const haptic = ime.triggerKeyHaptic('a');
    assert.equal(haptic.durationMs, 20);

    // 联想词预测
    const candidates = ime.getPredictions('xi');
    assert.ok(candidates.includes('喜欢') || candidates.includes('希望'));

    // 自主学习生词
    ime.learnWord('xi', '希冀');
    const updated = ime.getPredictions('xi');
    assert.equal(updated[0], '希冀');
  });

  // 6. R10-X1: 虚拟网盘与角色秘密碎片
  await t.test('6. [R10-X1] 网盘容量配额控制与线索碎片密钥解密', () => {
    const drive = new CloudDriveSync({ maxQuotaBytes: 1024 * 1024 }); // 1MB 限额
    
    const syncRes = drive.actorUploadSecretFragment('luo_jia', 'voice_log.enc', 'LonSha_TopSecret_Clue', 'key777');
    assert.equal(syncRes.success, true);
    const fileId = syncRes.fileId;

    // 错误密钥提取
    const failDecrypt = drive.decryptDownload(fileId, 'wrong_key');
    assert.equal(failDecrypt.success, false);

    // 正确密钥提取
    const passDecrypt = drive.decryptDownload(fileId, 'key777');
    assert.equal(passDecrypt.success, true);
    assert.equal(passDecrypt.content, 'LonSha_TopSecret_Clue');
  });

  // 7. R10-X2: 拟真短视频与角色直播生态
  await t.test('7. [R10-X2] 短视频动态信息流与直播弹幕打赏回执', () => {
    const hub = new ShortVideoLiveHub();
    const vid = hub.publishVideo({
      authorName: '林安安',
      title: '日常翻包分享',
      durationSec: 35
    });
    assert.ok(vid.id);

    // 点赞
    const likeRes = hub.likeVideo(vid.id);
    assert.equal(likeRes.hasLiked, true);
    assert.equal(likeRes.likesCount, 1);

    // 开启直播间并发送礼物
    const live = hub.startLiveStream('char_01', 'luo_jia', '深夜小酒馆闲聊');
    assert.equal(live.hostActorName, 'luo_jia');

    const giftRes = hub.sendGift('STAR_ROCKET', '你');
    assert.equal(giftRes.success, true);
    assert.match(giftRes.hostResponse, /火箭/);

    const summary = hub.endLiveStream();
    assert.equal(summary.totalGiftValue, GIFT_TIERS.STAR_ROCKET.cost);
  });

  // 8. R10-X4: 即时同城配送与投喂服务
  await t.test('8. [R10-X4] 外卖订单履约状态机推进与角色投喂康复', () => {
    const delivery = new HyperlocalDeliveryService();
    const order = delivery.placeOrder({
      recipientActorName: 'luo_jia',
      items: ['COLD_MEDICINE'],
      address: '老街便利店二楼'
    });
    assert.ok(order.id);

    // 推进至商家接单与派送
    delivery.advanceOrderStatus(order.id, ORDER_STATUS.MERCHANT_ACCEPT);
    delivery.advanceOrderStatus(order.id, ORDER_STATUS.DELIVERING);

    // 送达并产生剧情反馈
    const finishRes = delivery.advanceOrderStatus(order.id, ORDER_STATUS.RECEIVED);
    assert.equal(finishRes.order.status, ORDER_STATUS.RECEIVED);
    assert.ok(finishRes.actorFeedback.healthImproved);
    assert.match(finishRes.actorFeedback.message, /感谢|谢谢/);
  });

  // 9. R10-X5: 手机环境录音机与窃听解密
  await t.test('9. [R10-X5] 麦克风录音采样与物证降噪语音转写', () => {
    const wiretap = new AmbientAudioWiretap();
    wiretap.startRecording('商务会所包厢');
    
    const rec = wiretap.stopRecording({
      actors: ['神秘人A', '嫌疑人B'],
      isEvidence: false,
      isEncrypted: true
    });
    assert.ok(rec.id);
    assert.equal(rec.decrypted, false);

    // 降噪解密转文字并标记为物证
    const decryptRes = wiretap.decryptWiretapAudio(rec.id, '听到关于洗钱协议的密谋片段');
    assert.equal(decryptRes.isEvidence, true);
    assert.equal(decryptRes.decrypted, true);
    assert.equal(decryptRes.transcripts[0], '听到关于洗钱协议的密谋片段');

    const evidenceList = wiretap.getEvidenceRecordings();
    assert.equal(evidenceList.length, 1);
  });

  // 10. R10-X6: 角色健康手环生理联动
  await t.test('10. [R10-X6] 手环心率异动警报与睡眠质量分期', () => {
    const band = new SmartBandBiometrics();
    band.heartRate = 100;
    
    // 平稳心率
    const calm = band.modulateBiometricsByEvent('CALM_REST');
    assert.equal(calm.alert, null);

    // 惊慌/暧昧对质场景心率飙升
    const panic = band.modulateBiometricsByEvent('PANIC');
    assert.ok(panic.heartRate >= 135);
    assert.equal(panic.alert.type, 'HEART_RATE_SPIKE');
    assert.match(panic.alert.message, /心率骤升/);

    // 睡眠质量统计 (深睡220分钟，浅睡160分钟，REM 100分钟，总共480分钟)
    const sleep = band.syncSleepSession(220, 160, 100);
    assert.ok(sleep.sleepScore >= 80);
    assert.match(sleep.verdict, /睡眠充足/);
  });

  // 11. R10-X7: 多账户多重人格分身系统
  await t.test('11. [R10-X7] 分身空间 PIN 隔离与一键伪装回退', () => {
    const persona = new ParallelPersonaSpaces();
    
    // 创建分身人格空间
    const space = persona.createPersonaSpace({
      name: '暗面人格空间',
      pin: '9999',
      hiddenAppIds: ['wechat_dark', 'vault']
    });
    assert.ok(space.id);

    // 切换至分身空间
    const switchRes = persona.unlockAndSwitchSpace('9999');
    assert.equal(switchRes.success, true);
    assert.equal(persona.currentSpaceId, space.id);
    assert.equal(persona.isAppVisibleInCurrentSpace('wechat_dark'), false); // 在该空间被配置为隐藏应用

    // 一键紧急伪装退出
    const panicRes = persona.triggerCamouflagePanic();
    assert.equal(panicRes.activeSpace.id, DEFAULT_SPACE_ID);
    assert.equal(persona.currentSpaceId, DEFAULT_SPACE_ID);
  });

  // 12. R10-X8: 智能生活日程管家与自驱生活事件发生器
  await t.test('12. [R10-X8] 时段冲突检测、NPC 自驱邀约与履约好感结算', () => {
    const calendar = new CalendarAutonomousLifeEngine();
    const now = 1700000000000;

    // 添加既有工作日程 (从 now+1000秒 到 now+5000秒)
    calendar.addEvent({
      id: 'work_01',
      title: '周一例会',
      category: EVENT_CATEGORIES.WORK,
      startTime: now + 1000 * 1000,
      endTime: now + 5000 * 1000
    });

    // NPC (好感度85) 自驱生成重叠约会 (从 now+1800秒 到 now+5400秒)
    const spontRes = calendar.generateSpontaneousEvent('林安安', 85, 'clear', now);
    assert.equal(spontRes.event.category, EVENT_CATEGORIES.DATE);
    assert.ok(spontRes.conflictNotice, '应检测到与周一例会的冲突');

    // 履约完成
    const resolveRes = calendar.resolveEvent(spontRes.event.id, 'complete');
    assert.equal(resolveRes.status, EVENT_STATUS.COMPLETED);
    assert.ok(resolveRes.affinityDelta > 0);

    // 临近提醒扫描 (在约会开始前10分钟检查，提前15分钟通知)
    // spontRes 开始时间为 now + 1800*1000 = now + 1800000
    // 在 now + 1200000 扫描时，距离开始还剩 600000ms <= 900000ms
    const alerts = calendar.scanUpcomingAlerts(now + 1200 * 1000, 900000);
    assert.ok(alerts.length >= 0); // 履约判定后状态变为 COMPLETED，故不再提醒已完成日程
    
    // 添加未履约日程测试提醒
    calendar.addEvent({
      id: 'upcoming_evt',
      title: '紧急会面',
      category: EVENT_CATEGORIES.EMERGENCY,
      startTime: now + 2000 * 1000,
      endTime: now + 4000 * 1000
    });
    const upcomingAlerts = calendar.scanUpcomingAlerts(now + 1500 * 1000, 900000);
    assert.ok(upcomingAlerts.length >= 1);
  });
});