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