/**
 * tests/tenth-cycle-orchestrator-integration.test.mjs
 * 
 * RubyPhone 第十期 (R10) 协调编排中枢 (SubsystemOrchestrator) 18 项机制集成与消费测试
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SubsystemOrchestrator } from '../config/subsystem-orchestrator.js';

test('第十期 (R10) 编排中枢全量挂载与协同流推进契约验证', async (t) => {
  const orchestrator = new SubsystemOrchestrator();

  await t.test('1. 验证 18 项核心机制全量挂载于 orchestrator 实例', () => {
    assert.ok(orchestrator.mimicComm, 'R10-O1 应挂载');
    assert.ok(orchestrator.notifications, 'R10-O2 应挂载');
    assert.ok(orchestrator.atmosphere, 'R10-O3 应挂载');
    assert.ok(orchestrator.spotlight, 'R10-O4 应挂载');
    assert.ok(orchestrator.galleryVault, 'R10-O5 应挂载');
    assert.ok(orchestrator.battery, 'R10-O6 应挂载');
    assert.ok(orchestrator.cellular, 'R10-O7 应挂载');
    assert.ok(orchestrator.vfs, 'R10-O8 应挂载');
    assert.ok(orchestrator.ime, 'R10-O9 应挂载');
    assert.ok(orchestrator.cloudDrive, 'R10-X1 应挂载');
    assert.ok(orchestrator.shortVideo, 'R10-X2 应挂载');
    assert.ok(orchestrator.moments, 'R10-X3 应挂载');
    assert.ok(orchestrator.delivery, 'R10-X4 应挂载');
    assert.ok(orchestrator.wiretap, 'R10-X5 应挂载');
    assert.ok(orchestrator.smartBand, 'R10-X6 应挂载');
    assert.ok(orchestrator.personaSpaces, 'R10-X7 应挂载');
    assert.ok(orchestrator.calendarLife, 'R10-X8 应挂载');
    assert.ok(orchestrator.subconscious, 'R10-X9 应挂载');
  });

  await t.test('2. 验证 advanceAutonomousLifeStep 生活流全局推进协同', () => {
    // 注入日程事件以验证跨模块警报投递至 notifications
    const now = Date.now();
    orchestrator.calendarLife.addEvent({
      id: 'urgent_meeting',
      title: '密谈会面',
      category: 'emergency',
      startTime: now + 600 * 1000,
      endTime: now + 3600 * 1000
    });

    // 模拟推进 15 分钟生活流，情境为 PANIC（应同时触发电池耗电、弱网离线挂起、手环心律告警并派发系统通知）
    const lifeRes = orchestrator.advanceAutonomousLifeStep(15, 'PANIC');

    assert.ok(lifeRes.battery, '电池报告应生成');
    assert.ok(lifeRes.biometrics, '生理报告应生成');
    assert.ok(lifeRes.atmosphere, '光影快照应输出');

    // 检查全局通知中心是否真实消费了手环与日程产生的警报
    const clusters = orchestrator.notifications.getClusteredNotifications();
    assert.ok(clusters.length >= 1, '通知中心应接收到紧急生命体征或日程通知');
    const allNotifs = orchestrator.notifications.notifications;
    /* [v4.99.1 交棒改写] 原判据 `n.priority === 'URGENT'`（字符串比较）依赖的是修前
     *  缺陷行为：post() 曾把字符串原样透传进落盘条目（数值比较全部退化为 NaN）。
     *  v4.99.1 入口归一后落盘统一为数字档 + priorityName 可读名，判据随之改写为
     *  「数字档达到 URGENT 或可读名为 URGENT」——量的是同一件事（紧急警报穿透免打扰），
     *  不再依赖「缺陷让字符串漏进来」这一形态。 */
    const hasEmergency = allNotifs.some(n => n.priority === 3 || n.priorityName === 'URGENT');
    assert.equal(hasEmergency, true, '应存在穿透免打扰的 URGENT 级警报');
  });
});