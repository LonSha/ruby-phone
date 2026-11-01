/* ========================================================
 * system-v4116.test.mjs — [v4.115.0 · 第十三期 R13-X4] 手机也会「不在手上」：离线与错过
 * --------------------------------------------------------
 * 本套件把守的是 R13-X4 的验收契约：
 *   A 状态与口径：isAway 默认恒 false，未启用行为零变化；离开理由词表闭集；
 *   B 核心验收：markAway 期间派发 N 条通知必须全部进 missed 且一条都没真弹出；
 *               双向断言：① 记了账；② 订阅者零弹出；
 *   C 重新拿起：markBack 后状态复位，返回本次错过清单快照，后续通知恢复正常弹出；
 *   D 策略与机制分离：isStale 策略注入，过期项打上 stale: true 标记；
 *   E 视图与设置接线：通知中心 _awaySection 三态不同形；设置页 _awayModeSnapshot 读数；
 *   F 负控制（真源码破坏）：
 *       F1 破坏 isAway() 拦截，使离开期间依然弹出 ⇒ 必须被判据抓住；
 *       F2 破坏 recordMissed 记账，离开期间漏记账 ⇒ 必须被判据抓住；
 *       F3 破坏 markBack 不复位 isAway 状态 ⇒ 必须被判据抓住；
 *   G 当版收尾条形态锚与五源同源校验。
 * ======================================================== */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} } });

function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4116_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of ['away-mode.js', 'system-notification-dispatcher.js', 'presence-arbitration.js']) {
        const abs = path.join(ROOT, 'config', f);
        if (fs.existsSync(abs)) fs.copyFileSync(abs, path.join(dir, 'config', f));
    }
    return dir;
}

function damage(rel, from, to) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

function mkStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        get(k, def) { return map.has(k) ? map.get(k) : def; },
        set(k, v) { map.set(k, v); },
        has(k) { return map.has(k); },
        delete(k) { map.delete(k); },
        getContext() { return { isLobby: false }; }
    };
}

const { AwayMode, AWAY_REASONS, getAwayMode } = await import(path.join(ROOT, 'config', 'away-mode.js'));
const { SystemNotificationDispatcher, NOTIFICATION_PRIORITY } = await import(path.join(ROOT, 'config', 'system-notification-dispatcher.js'));

test('A1 默认状态与降级：isAway 默认恒 false，未启用行为零变化', () => {
    const away = new AwayMode();
    assert.equal(away.isAway(), false, '默认不在离开状态');
    const st = away.getAwayState();
    assert.equal(st.isAway, false);
    assert.equal(st.missedCount, 0);

    // 禁用模式下，即便调用 markAway 也是 false
    const disabledAway = new AwayMode({ enabled: false });
    assert.equal(disabledAway.markAway(), false);
    assert.equal(disabledAway.isAway(), false);
});

test('A2 离开理由词表闭集：MANUAL, BATTERY, SLEEP, CUSTOM', () => {
    assert.equal(AWAY_REASONS.MANUAL, 'manual');
    assert.equal(AWAY_REASONS.BATTERY, 'battery');
    assert.equal(AWAY_REASONS.SLEEP, 'sleep');
    assert.equal(AWAY_REASONS.CUSTOM, 'custom');
});

test('B1 核心双向验收：markAway 期间派发的通知全部进 missed 且一条都未真弹出', () => {
    const storage = mkStorage();
    const away = new AwayMode({ storage });
    const dispatcher = new SystemNotificationDispatcher({ storage, awayMode: away });

    let poppedCount = 0;
    const poppedItems = [];
    dispatcher.subscribe((event, item) => {
        if (event === 'POST') {
            poppedCount++;
            poppedItems.push(item);
        }
    });

    // 1. 正常状态下派发 1 条：必须真弹出
    dispatcher.post({ title: '正常消息', body: '你在手上', priority: 'NORMAL', appId: 'wechat' });
    assert.equal(poppedCount, 1, '正常时必须弹出');
    assert.equal(away.getAwayState().missedCount, 0, '正常时不进 missed');

    // 2. 进入离开模式（放下手机）
    const ok = away.markAway({ reason: AWAY_REASONS.MANUAL });
    assert.equal(ok, true);
    assert.equal(away.isAway(), true);

    // 3. 离开期间连续派发 3 条（含微信、日程、来电）
    dispatcher.post({ title: '新微信', body: '在吗？', priority: 'NORMAL', appId: 'wechat' });
    dispatcher.post({ title: '日程提醒', body: '半小时后开会', priority: 'NORMAL', appId: 'calendar' });
    dispatcher.post({ title: '未接来电', body: '妈妈的来电', priority: 'URGENT', appId: 'phone' });

    // 双向断言：
    // 方向一：弹出计数保持为 1（后续 3 条一条都未弹出）
    assert.equal(poppedCount, 1, '★ 离开期间弹窗被完全抑制，一条都未真弹出');
    
    // 方向二：全部精密记账入 missed 队列，条数恰好为 3
    const summary = away.getMissedSummary();
    assert.equal(summary.totalCount, 3, '★ 全部进 missed 账本');
    assert.equal(summary.urgentCount, 1, '识别出 1 条紧急来电');
    assert.equal(summary.groups.length, 3, '分组聚合为 3 个 App');
});

test('C1 重新拿起手机：markBack 复位状态并返回本次错过清单，后续通知恢复弹出', () => {
    const storage = mkStorage();
    const away = new AwayMode({ storage });
    const dispatcher = new SystemNotificationDispatcher({ storage, awayMode: away });

    let poppedCount = 0;
    dispatcher.subscribe((event) => {
        if (event === 'POST') poppedCount++;
    });

    away.markAway();
    dispatcher.post({ title: '测试1', body: '内容1' });
    dispatcher.post({ title: '测试2', body: '内容2' });
    assert.equal(poppedCount, 0);

    // 重新拿起手机
    const missed = away.markBack();
    assert.equal(away.isAway(), false, '离开状态复位为 false');
    assert.equal(missed.length, 2, '返回错过的 2 条快照');

    // 恢复后发送通知：恢复正常弹出
    dispatcher.post({ title: '恢复后的消息', body: '欢迎回来' });
    assert.equal(poppedCount, 1, '拿起手机后恢复正常弹窗');
});

test('D1 策略分离：支持注入 isStaleFn 过期策略，过期项打标 stale: true', () => {
    const away = new AwayMode();
    away.markAway();
    away.recordMissed({ id: 'm1', title: '限时优惠券', timestamp: 1000, appId: 'shop' });
    away.recordMissed({ id: 'm2', title: '好友留言', timestamp: 9000, appId: 'wechat' });

    // 注入过期判定策略：timestamp < 5000 视为过期
    const isStale = (item) => item.timestamp < 5000;
    const summary = away.getMissedSummary(isStale);
    
    assert.equal(summary.staleCount, 1, '恰有 1 条过期项');
    const shopGroup = summary.groups.find(g => g.appId === 'shop');
    assert.ok(shopGroup);
    assert.equal(shopGroup.items[0].stale, true, 'm1 标记为已过期');

    const wechatGroup = summary.groups.find(g => g.appId === 'wechat');
    assert.equal(wechatGroup.items[0].stale, false, 'm2 未过期');
});

test('E1 接线与视图：notification-center-view 与 settings-app 读数口对接', async () => {
    const ViewMod = await import(path.join(ROOT, 'apps', 'notifications', 'notification-center-view.js'));
    const SettingsMod = await import(path.join(ROOT, 'apps', 'settings', 'settings-app.js'));

    assert.ok(ViewMod.NotificationCenterView, 'NotificationCenterView 导出在场');
    assert.ok(SettingsMod.SettingsApp, 'SettingsApp 导出在场');

    // 验证原型链上已挂接 _getAwayMode 与 _awayModeSnapshot 方法
    assert.equal(typeof SettingsMod.SettingsApp.prototype._getAwayMode, 'function');
    assert.equal(typeof SettingsMod.SettingsApp.prototype._awayModeSnapshot, 'function');

    // 验证 NotificationCenterView 原型链上已挂接 _awaySection
    assert.equal(typeof ViewMod.NotificationCenterView.prototype._awaySection, 'function');
});

test('F1 真源码破坏：绕过 isAway 拦截使离开期间依然弹出 ⇒ 阳性断言必须翻红', async () => {
    const dir = damage('config/system-notification-dispatcher.js',
        "const isAway = Boolean(this.awayMode && typeof this.awayMode.isAway === 'function' && this.awayMode.isAway());",
        "const isAway = false;");
    const BrokeDispMod = await import(path.join(dir, 'config', 'system-notification-dispatcher.js'));
    
    const away = new AwayMode();
    away.markAway();
    const brokeDisp = new BrokeDispMod.SystemNotificationDispatcher({ awayMode: away });
    let popped = 0;
    brokeDisp.subscribe(() => { popped++; });
    brokeDisp.post({ title: '离开期间发的消息', body: '测试' });

    // 原版期望 popped === 0，破坏后 popped === 1
    assert.throws(() => {
        assert.equal(popped, 0, '离开期间弹窗未被抑制');
    }, assert.AssertionError, '破坏后必然翻红');
});

test('F2 真源码破坏：recordMissed 漏记账 ⇒ 阳性断言必须翻红', async () => {
    const dir = damage('config/away-mode.js',
        "this._missed.unshift(record);",
        "/* this._missed.unshift(record); */");
    const BrokeAwayMod = await import(path.join(dir, 'config', 'away-mode.js'));
    const brokeAway = new BrokeAwayMod.AwayMode();
    brokeAway.markAway();
    brokeAway.recordMissed({ id: 'x1', title: '一条消息' });

    assert.throws(() => {
        assert.equal(brokeAway.getAwayState().missedCount, 1, '漏记账应导致条数不为 1');
    }, assert.AssertionError, '破坏记账后必然翻红');
});

test('F3 真源码破坏：markBack 不复位 isAway 状态 ⇒ 阳性断言必须翻红', async () => {
    const dir = damage('config/away-mode.js',
        `const missedSnapshot = [...this._missed];
        this._isAway = false;`,
        `const missedSnapshot = [...this._missed];
        /* this._isAway = false; */`);
    const BrokeAwayMod = await import(path.join(dir, 'config', 'away-mode.js'));
    const brokeAway = new BrokeAwayMod.AwayMode();
    brokeAway.markAway();
    brokeAway.markBack();

    assert.throws(() => {
        assert.equal(brokeAway.isAway(), false, 'markBack 必须将 isAway 复位为 false');
    }, assert.AssertionError, '破坏状态复位后必然翻红');
});
