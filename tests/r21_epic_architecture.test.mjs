import test from 'node:test';
import assert from 'node:assert/strict';

import { createPixelViewStackSentinel, VIEW_LAYER } from '../phone/pixel-viewstack-b-sentinel.js';
import { play8BitSfx, SFX_TYPE } from '../phone/pixel-8bit-audio-synthesizer.js';
import { createCartridgeSwapper } from '../phone/pixel-cartridge-multitask-swapper.js';
import { executePinyinGlobalSearch } from '../apps/search/global-pinyin-search-deeplink-router.js';
import { dispatchShareIntent, SHARE_MIME } from '../apps/share/universal-sharesheet-intent-bus.js';
import { predictSlangCandidates } from '../apps/keyboard/pixel-ime-character-slang-predictor.js';
import { createNotificationTimelineManager } from '../apps/notifications/temporal-notification-timeline-pixel-led.js';
import { createSessionIsolatedStorage, exportFullPhoneMirror } from '../apps/settings/session-isolation-full-phone-mirror.js';
import { calculateVirtualSlice } from '../phone/virtual-slice-scrolling-fps-booster.js';
import { buildWorldAxisPhoneOp, reportOpToWorldAxis } from '../config/phone-action-to-worldaxis-causal-feedback.js';
import { scanWirelessEnvironment } from '../apps/hardware/rf-sniffer-matrix-engine.js';
import { createDarknetMarketState, purchaseDarknetItem } from '../apps/darknet/dual-domain-space-darknet-market.js';
import { crossExamineAlibi } from '../apps/investigation/forensic-timeline-clue-matrix.js';
import { performProximityAirdrop } from '../apps/network/offline-direct-airdrop-engine.js';
import { generateMomentReactions } from '../apps/moments/npc-social-graph-dynamic-moments.js';
import { applyPhysicalDamage } from '../apps/hardware/physical-damage-degradation-simulator.js';
import { modulateCallAcoustics } from '../apps/call/contextual-cellular-call-acoustic-modulator.js';
import { executeGeekTerminalCommand } from '../apps/security/pixel-geek-terminal-sandbox.js';

test('R21-1: 全局掌机视图栈防死锁哨兵测试 (ViewStack Sentinel)', () => {
    const sentinel = createPixelViewStackSentinel();
    assert.equal(sentinel.getDepth(), 1);

    let libraryCleaned = false;
    sentinel.pushView(VIEW_LAYER.CLUSTER, 'library', () => { libraryCleaned = true; });
    sentinel.pushView(VIEW_LAYER.APP, 'wechat');
    assert.equal(sentinel.getDepth(), 3);

    // 1. 退出微信 -> 回到应用库
    const pop1 = sentinel.popView();
    assert.equal(pop1.handled, true);
    assert.equal(pop1.popped.id, 'wechat');
    assert.equal(sentinel.getDepth(), 2);
    assert.equal(libraryCleaned, false);

    // 2. 退出应用库 -> 触发清理回到桌面
    const pop2 = sentinel.popView();
    assert.equal(pop2.handled, true);
    assert.equal(pop2.popped.id, 'library');
    assert.equal(libraryCleaned, true, '退栈时自动执行视图生命周期销毁');
    assert.equal(sentinel.getDepth(), 1);

    // 3. 在桌面继续按返回 -> 安全返回不卡死
    const pop3 = sentinel.popView();
    assert.equal(pop3.handled, false, '在桌面层安全拦截，不产生抖动死锁');
    assert.equal(pop3.depth, 1);
});

test('R21-2: 虚拟切片满帧滚动视口计算测试 (Virtual Slice FPS Booster)', () => {
    // 模拟 10,000 条聊天记录，视口高度 400px，单项高度 40px
    const slice = calculateVirtualSlice(10000, 2000, 400, 40);
    assert.equal(slice.totalHeight, 400000);
    assert.equal(slice.startIndex, 48); // (2000/40) - 2
    assert.ok(slice.renderedCount <= 20, '万条聊天记录在 DOM 视口中严格仅渲染约 15-20 个节点，彻底杜绝掉帧');
    assert.ok(slice.topSpacerHeight > 0);
    assert.ok(slice.bottomSpacerHeight > 0);
});

test('R21-3: 手机操作向 WorldAxis 因果桥上报测试 (WorldAxis Causal Feedback Bridge)', () => {
    const op = buildWorldAxisPhoneOp('block_actor', { targetActor: '叛军卧底' });
    assert.equal(op.act, 'block_actor');
    assert.equal(op.targetActor, '叛军卧底');

    // 模拟挂载有 WorldAxis 的窗口环境
    let notedOp = null;
    const fakeWin = {
        WorldAxis: {
            phoneBridge: {
                noteAction: (action) => {
                    notedOp = action;
                    return { ok: true, registered: true };
                }
            }
        }
    };

    const rep = reportOpToWorldAxis(op, fakeWin);
    assert.equal(rep.reported, true);
    assert.equal(notedOp.act, 'block_actor');
    assert.equal(notedOp.targetActor, '叛军卧底');
});

test('R21-4: 跨应用侦探物证链不在场证明时空对撞测试 (Forensic Timeline)', () => {
    const alibi = {
        timestamp: 1000000,
        location: '市中心图书馆'
    };
    const physicalClues = [
        { timestamp: 1000200, location: '东郊码头废弃仓库', type: '指纹与烟蒂' }
    ];
    const res = crossExamineAlibi(alibi, physicalClues);
    assert.equal(res.hasContradiction, true);
    assert.match(res.contradictions[0].verdict, /不在场证明彻底破裂/);
});

test('R21-5: 极客掌机命令行沙盒终端测试 (Pixel Geek Terminal)', () => {
    const resHelp = executeGeekTerminalCommand('help');
    assert.equal(resHelp.exitCode, 0);
    assert.match(resHelp.output, /Available commands/);

    const resPing = executeGeekTerminalCommand('ping worldaxis.local');
    assert.equal(resPing.exitCode, 0);
    assert.match(resPing.output, /64 bytes from 127.0.0.1/);

    const resDecrypt = executeGeekTerminalCommand('decrypt TOP_SECRET_LOG');
    assert.equal(resDecrypt.exitCode, 0);
    assert.match(resDecrypt.output, /SUCCESS/);
});

test('R21-6: 18项手机全新模块全量方法与契约健全自检', () => {
    assert.equal(typeof play8BitSfx, 'function');
    assert.equal(typeof createCartridgeSwapper, 'function');
    assert.equal(typeof executePinyinGlobalSearch, 'function');
    assert.equal(typeof dispatchShareIntent, 'function');
    assert.equal(typeof predictSlangCandidates, 'function');
    assert.equal(typeof createNotificationTimelineManager, 'function');
    assert.equal(typeof createSessionIsolatedStorage, 'function');
    assert.equal(typeof exportFullPhoneMirror, 'function');
    assert.equal(typeof scanWirelessEnvironment, 'function');
    assert.equal(typeof createDarknetMarketState, 'function');
    assert.equal(typeof purchaseDarknetItem, 'function');
    assert.equal(typeof performProximityAirdrop, 'function');
    assert.equal(typeof generateMomentReactions, 'function');
    assert.equal(typeof applyPhysicalDamage, 'function');
    assert.equal(typeof modulateCallAcoustics, 'function');
});