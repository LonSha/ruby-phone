import test from 'node:test';
import assert from 'node:assert/strict';

import { reorderOfflineNotifications } from '../apps/notifications/notification-center-view.js';
import { ControlCenter } from '../phone/control-center.js';
import { PhoneShell } from '../phone/phone-shell.js';

test('R15-Batch-F: 离线通知重排与控制中心快捷指令宏 (R15-O5 / R15-O8)', () => {
    // 1. 离线通知时间轴重排
    const pending = [
        { id: 'n2', storyTimestamp: 200, title: '第二轮' },
        { id: 'n1', storyTimestamp: 100, title: '第一轮' },
        { id: 'n3', storyTimestamp: 300, title: '第三轮' }
    ];
    const ordered = reorderOfflineNotifications(pending);
    assert.equal(ordered[0].id, 'n1');
    assert.equal(ordered[1].id, 'n2');
    assert.equal(ordered[2].id, 'n3');

    // 2. 控制中心宏执行
    const mockStorage = {
        getItem: () => null,
        setItem: () => {}
    };
    const cc = new ControlCenter(null, mockStorage);
    const macroResults = cc.executeShortcutMacro([
        { type: 'toggleWifi', value: true },
        { type: 'setDnd', value: false }
    ]);
    assert.equal(macroResults.length, 2);
    assert.equal(macroResults[0].success, true);
    assert.equal(macroResults[1].success, true);
});

test('R15-Batch-F: PhoneShell 整机镜像与物理突发状态机 (R15-O6 / R15-X6)', () => {
    const shell = new PhoneShell();
    shell.personaSign = '保持热爱';
    shell.currentWeather = '多云';

    // 1. 整机镜像备份
    const backup = shell.createBackupImage();
    assert.equal(backup.version, '4.131.0');
    assert.equal(backup.settings.personaSign, '保持热爱');

    // 2. 低电量限制
    const lowPower = shell.evaluatePhysicalLimit({ battery: 3, signal: 4 });
    assert.equal(lowPower.isPowerCut, true);
    assert.equal(lowPower.canMakeCall, false);

    // 3. 无信号限制
    const noSignal = shell.evaluatePhysicalLimit({ battery: 80, signal: 0 });
    assert.equal(noSignal.isNetworkDisconnected, true);
    assert.equal(noSignal.canMakeCall, false);

    // 4. 正常状态
    const normal = shell.evaluatePhysicalLimit({ battery: 90, signal: 4 });
    assert.equal(normal.canMakeCall, true);
});

test('R15-Batch-F: 虚拟滚动切片、角色主题与数字遗物解密 (R15-O7 / R15-X7 / R15-X8)', () => {
    const shell = new PhoneShell();

    // 1. R15-O7 虚拟切片渲染器验证
    const scroller = shell.virtualScroller;
    assert.ok(scroller);
    // 模拟 10000 条长消息列表，当前 scrollTop 为 1200px
    const slice = scroller.computeSlice(10000, 1200);
    assert.equal(slice.startIndex, 15); // floor(1200/60) - buffer(5) = 20 - 5 = 15
    assert.equal(slice.endIndex, 35);   // 20 + ceil(600/60) + 5 = 20 + 10 + 5 = 35
    assert.equal(slice.visibleCount, 20);
    assert.equal(slice.topPadding, 15 * 60);
    assert.equal(slice.bottomPadding, (10000 - 35) * 60);

    // 负控制：空列表时安全切片
    const emptySlice = scroller.computeSlice(0, 500);
    assert.equal(emptySlice.visibleCount, 0);
    assert.equal(emptySlice.topPadding, 0);

    // 2. R15-X7 角色专属主题引擎验证
    const themeEngine = shell.themeEngine;
    assert.ok(themeEngine);
    const defaultTheme = themeEngine.getCurrentTheme();
    assert.equal(defaultTheme.id, 'default');
    assert.equal(defaultTheme.chatSendLabel, '发送');

    // 切换至凯瑟琳专属主题
    const frostApplied = themeEngine.applyTheme('catherine_frost');
    assert.equal(frostApplied.applied, true);
    assert.equal(frostApplied.theme.name, '凯瑟琳·冰霜守候');
    assert.equal(frostApplied.theme.chatSendLabel, '传递魔力');
    assert.equal(frostApplied.cssVariables['--phone-primary'], '#38bdf8');

    // 负控制：非法主题回退为 default
    const invalidTheme = themeEngine.applyTheme('non_existent_theme');
    assert.equal(invalidTheme.theme.id, 'default');

    // 3. R15-X8 随身数字遗物探索解密验证
    const vault = shell.relicsVault;
    assert.ok(vault);
    vault.registerRelic({
        id: 'old_relic_001',
        title: '上一周目的旧备忘录草稿',
        passcode: '1024',
        plainText: '如果有一天我忘记了，请记得在图书馆第三层找我。'
    });

    // 初始状态未解密
    const list = vault.listRelics();
    assert.equal(list.length, 1);
    assert.equal(list[0].isUnlocked, false);
    assert.equal(list[0].contentPreview, '【加密档案·需要密码】');

    // 尝试错误密码解密（负控制）
    const failedAttempt = vault.attemptUnlock('old_relic_001', '9999');
    assert.equal(failedAttempt.success, false);
    assert.equal(failedAttempt.reason, 'passcode_mismatch');

    // 正确密码解密
    const successAttempt = vault.attemptUnlock('old_relic_001', '1024');
    assert.equal(successAttempt.success, true);
    assert.match(successAttempt.decryptedContent, /如果有一天我忘记了/);
    assert.equal(vault.listRelics()[0].isUnlocked, true);
});