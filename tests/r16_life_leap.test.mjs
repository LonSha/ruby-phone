import test from 'node:test';
import assert from 'node:assert/strict';

// 导入 RubyPhone 第十六期全新手机生活引擎
import RubySmartReplyChips from '../apps/wechat/smart-reply-chips-engine.js';
import RubyMomentsNetwork from '../apps/moments/moments-dynamic-interaction-network.js';
import RubyAmbientLockscreen from '../apps/settings/ambient-lockscreen-wallpaper-engine.js';
import { crossExamineAlibi } from '../apps/investigation/forensic-timeline-clue-matrix.js';
import { performProximityAirdrop } from '../apps/network/offline-direct-airdrop-engine.js';
import { createDarknetMarketState, purchaseDarknetItem } from '../apps/darknet/dual-domain-space-darknet-market.js';
import { scanWirelessEnvironment } from '../apps/hardware/rf-sniffer-matrix-engine.js';
import { AmbientCallSimulator } from '../phone/ambient-call-simulator.js';
import { DigitalRelicsVault } from '../phone/digital-relics-vault.js';
import { SpotlightUniversalSearch } from '../config/spotlight-universal-search.js';

test('R16-1: 微信直觉回复气泡与自然心意引擎 (Smart Reply Chips)', () => {
    // 场景 A: 对方发来疲惫消息
    const chipsTired = RubySmartReplyChips.generateReplyChips('今天加班到好晚，真的好累啊……');
    assert.equal(chipsTired.length, 3);
    assert.ok(chipsTired.some(c => c.text.includes('辛苦啦') || c.text.includes('温水')));

    // 场景 B: 对方发来开心好消息
    const chipsHappy = RubySmartReplyChips.generateReplyChips('告诉你个好消息，我通过考核啦！哈哈太棒了！');
    assert.equal(chipsHappy.length, 3);
    assert.ok(chipsHappy.some(c => c.text.includes('开心') || c.text.includes('高兴')));
});

test('R16-2: 朋友圈时空漫游与分组互动网络 (Moments Dynamic Interaction Network)', () => {
    let state = RubyMomentsNetwork.createState();

    // 发布动态
    const { state: s1, post } = RubyMomentsNetwork.createPost(state, {
        author: '林雨晴',
        text: '下班路上的晚霞像极了橘子汽水 🍊',
        group: '所有人'
    });
    assert.equal(s1.posts.length, 1);

    // 点赞
    const { state: s2, liked } = RubyMomentsNetwork.toggleLike(s1, post.id, '我');
    assert.equal(liked, true);
    assert.equal(s2.posts[0].likes.length, 1);

    // 评论
    const { state: s3, comment } = RubyMomentsNetwork.addComment(s2, post.id, '我', '拍得真好看，下次一起去看！');
    assert.ok(comment);
    assert.equal(s3.posts[0].comments.length, 1);
    assert.equal(s3.posts[0].comments[0].content, '拍得真好看，下次一起去看！');
});

test('R16-3: 锁屏情境动态壁纸与呼吸氛围投影 (Ambient Lockscreen Wallpaper & Atmosphere)', () => {
    // 晨曦
    const dawn = RubyAmbientLockscreen.deriveWallpaperTheme({ hour: 7, mood: '温暖' });
    assert.equal(dawn.timePeriod, 'dawn');
    assert.ok(dawn.motto.includes('喜欢的人') || dawn.motto.includes('晨光'));

    // 夜晚
    const night = RubyAmbientLockscreen.deriveWallpaperTheme({ hour: 23, mood: '平稳' });
    assert.equal(night.timePeriod, 'night');
    assert.ok(night.motto.includes('夜幕') || dawn.motto.includes('星'));
});

test('R16-4: 跨应用物证链与不在场证明时空对撞机 (Forensic Timeline)', () => {
    const suspectClaim = { timestamp: 1000000, location: '家中' };
    const physicalClues = [
        { timestamp: 1050000, location: '城东仓库', type: '监控录像' }
    ];
    const report = crossExamineAlibi(suspectClaim, physicalClues);
    assert.ok(report);
    assert.equal(report.hasContradiction, true);
    assert.ok(report.contradictions.length > 0);
});

test('R16-5: 近场通信名片碰一碰与快传通道 (Offline Direct Airdrop)', () => {
    const file = { name: '机密图纸.png', size: 1024 };
    const target = { name: '同伴手机' };
    const res = performProximityAirdrop(file, target);
    assert.ok(res);
    assert.equal(res.transmitted, true);
    assert.equal(res.fileName, '机密图纸.png');
});

test('R16-6: 暗网双域交易市场与匿名加密通讯 (Darknet Market)', () => {
    let state = createDarknetMarketState();
    assert.ok(state);
    assert.equal(state.cryptoBalance, 15.5);
    const purchase = purchaseDarknetItem(state, 'item_dossier');
    assert.ok(purchase);
    assert.equal(purchase.success, true);
    assert.equal(purchase.remainingBalance, 10.5);
});

test('R16-7: 信号基站嗅探与射频三角定位矩阵 (RF Sniffer Matrix)', () => {
    const scan = scanWirelessEnvironment('downtown_cafe');
    assert.ok(scan);
    assert.ok(Array.isArray(scan.accessPoints));
    assert.ok(scan.accessPoints.length > 0);
});

test('R16-8: 沉浸式情境通话与实时环境声场模拟 (Ambient Call Simulator)', () => {
    const atmosphere = AmbientCallSimulator.formatCallAtmosphere({ weather: '雨天', signalStrength: 2 });
    assert.ok(atmosphere);
    assert.ok(atmosphere.noiseTag.includes('雨声'));
    assert.ok(atmosphere.atmosphericDesc.includes('雨声'));
});

test('R16-9: 随身数字遗物与机密自毁保险箱 (Digital Relics Vault)', () => {
    const vault = new DigitalRelicsVault();
    assert.ok(vault);
    vault.registerRelic({ id: 'relic_1', title: '绝密遗书', passcode: '1314', plainText: '这是唯一的真相' });
    const unlocked = vault.attemptUnlock('relic_1', '1314');
    assert.equal(unlocked.success, true);
    assert.equal(unlocked.decryptedContent, '这是唯一的真相');
});

test('R16-10: Spotlight 全局拼音穿透与语义深度索引 (Spotlight Search Engine)', () => {
    const search = new SpotlightUniversalSearch();
    assert.ok(search);
    search.indexEntities('WECHAT', [{ id: 'msg_1', title: '火锅聚餐', content: '今天晚上六点见' }]);
    const results = search.search('火锅');
    assert.ok(Array.isArray(results.results));
    assert.ok(results.results.length > 0);
});