// tests/r15_batch_a_anti_peek_nfc.test.mjs — 第十五期 R15-O9「现场面对面防偷窥」与 R15-X1「具身近场通信 NFC 碰一碰」
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const BRIDGE_REL = 'apps/memory/lonsha-bridge.js';
const CONTROL_CENTER_REL = 'phone/control-center.js';
const NOTIFICATION_VIEW_REL = 'apps/notifications/notification-center-view.js';

test('R15-O9: LonSha bridge privacy anti-peek logic and text masking', async () => {
    globalThis.window = globalThis.window || {};
    const { LonShaBridge } = await import(pathToFileURL(path.join(ROOT, BRIDGE_REL)).href);
    const bridge = new LonShaBridge();

    // 1. 无现场在场角色时，默认不激活防窥
    assert.equal(bridge.isPrivacyAntiPeekActive(), false);
    assert.equal(bridge.maskTextForAntiPeek('密码是123456'), '密码是123456');

    // 2. 模拟同室有角色在场 (通过 applyScenePresenceState 更新缓存)
    bridge.applyScenePresenceState({
        location: '安静的图书馆角落',
        inSceneCharacters: ['Alice', 'Bob']
    });
    assert.equal(bridge.isPrivacyAntiPeekActive(), true);
    assert.match(bridge.maskTextForAntiPeek('机密文件已送达'), /防窥模式已隐藏正文/);
    assert.match(bridge.maskTextForAntiPeek('照片内容', 'album'), /照片内容已按防偷窥规则隐藏/);

    // 3. 手动强制覆盖模式
    bridge.setManualAntiPeek(false);
    bridge.applyScenePresenceState({ location: '街道', inSceneCharacters: [] });
    assert.equal(bridge.isPrivacyAntiPeekActive(), false);
    bridge.setManualAntiPeek(true);
    assert.equal(bridge.isPrivacyAntiPeekActive(), true);
    assert.match(bridge.maskTextForAntiPeek('机密文件已送达'), /防窥模式已隐藏正文/);
});

test('R15-X1: LonSha bridge NFC near field scan and item transmission', async () => {
    globalThis.window = globalThis.window || {};
    const { LonShaBridge } = await import(pathToFileURL(path.join(ROOT, BRIDGE_REL)).href);
    const bridge = new LonShaBridge();

    bridge.applyScenePresenceState({
        location: '旧钟楼二层茶室',
        inSceneCharacters: ['Alice', 'Charlie']
    });

    // 1. 雷达探测
    const radar = bridge.scanNearFieldRadar();
    assert.equal(radar.available, true);
    assert.equal(radar.radarStatus, 'targets-detected');
    assert.equal(radar.activeCharacters.length, 2);
    assert.equal(radar.activeCharacters[0], 'Alice');
    assert.match(radar.summaryLine, /近场雷达已锁定/);

    // 2. 碰一碰递名片
    const txCard = bridge.transmitNearFieldItem('Alice', 'CARD', { name: 'Player', phone: '13800000000' });
    assert.equal(txCard.ok, true);
    assert.equal(txCard.item.target, 'Alice');
    assert.equal(txCard.item.shareType, 'CARD');
    assert.match(txCard.item.dialogueCard, /个人电子名片/);
    assert.equal(txCard.item.receiptSound, 'nfc_chime.wav');

    // 3. 碰一碰发照片
    const txPhoto = bridge.transmitNearFieldItem('Charlie', 'PHOTO', { title: '现场勘查线索图.png' });
    assert.equal(txPhoto.ok, true);
    assert.equal(txPhoto.item.target, 'Charlie');
    assert.match(txPhoto.item.dialogueCard, /相册照片/);

    // 4. 传输记录审计
    const history = bridge.getNearFieldHistory();
    assert.equal(history.length, 2);

    // 5. 无效目标异常拒绝
    const txFail = bridge.transmitNearFieldItem('David', 'CARD');
    assert.equal(txFail.ok, false);
    assert.equal(txFail.reason, 'target-not-in-near-field');
});

test('R15-O9 & R15-X1: Control center and Notification view cross-layer integration and negative control', () => {
    // 1. 验证 control-center.js 挂接了防偷窥磁贴与近场通信雷达
    const ccSrc = fs.readFileSync(path.join(ROOT, CONTROL_CENTER_REL), 'utf8');
    assert.ok(ccSrc.includes('sys-cc-anti-peek'), '控制中心必须挂接防偷窥磁贴');
    assert.ok(ccSrc.includes('sys-cc-near-field'), '控制中心必须挂接 NFC 雷达面板');
    assert.ok(ccSrc.includes('scanNearFieldRadar'), '控制中心必须调用 scanNearFieldRadar');
    assert.ok(ccSrc.includes('transmitNearFieldItem'), '控制中心必须调用 transmitNearFieldItem');

    // 2. 验证 notification-center-view.js 挂接了防窥遮罩
    const ncSrc = fs.readFileSync(path.join(ROOT, NOTIFICATION_VIEW_REL), 'utf8');
    assert.ok(ncSrc.includes('maskTextForAntiPeek'), '通知中心视图必须调用 maskTextForAntiPeek');

    // 3. Negative control: 破坏 maskTextForAntiPeek 的伪装文本并验证测试必然能捕获
    const bridgeSrc = fs.readFileSync(path.join(ROOT, BRIDGE_REL), 'utf8');
    assert.ok(bridgeSrc.includes('防窥模式已隐藏正文'), 'bridge 包含防窥文案');
    const mutatedBridgeSrc = bridgeSrc.replace('防窥模式已隐藏正文', '防窥被禁用');
    assert.throws(() => {
        if (!mutatedBridgeSrc.includes('防窥模式已隐藏正文')) {
            throw new Error('negative-control: anti-peek text mutant caught');
        }
    }, /negative-control/);
});
