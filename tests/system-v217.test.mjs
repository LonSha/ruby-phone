/* ============================================================
 * [v2.17.0] 通知交互补全回归测试：横幅点击 / 锁屏单条直达 / 角标消费 / chips 未读对齐。
 * ------------------------------------------------------------
 * 分工（对齐本仓库测试约定）：
 *  1) 真实运行时：NotificationLog.unreadByApp 聚合与已读语义、_guessAppId 回退链、
 *     NotificationCenterView._filterChips 未读对齐、_syncBadge 宿主钩子。
 *  2) 接线断言（源码文本）：横幅回调注入点、兜底横幅可点击、锁屏单条 bind、
 *     角标同步调用点 —— 防止「方法写好没人调」的假交付（v2.16 踩过）。
 * 不硬编码版本号（版本跨源自洽由 entry-integrity 锁定）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotificationLog } from '../config/system-notifications.js';
import { NotificationCenterView } from '../apps/notifications/notification-center-view.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
/** 内存 storage 替身：本文件只用到 get/set */
function mkStorage(seed = {}) {
    const d = { ...seed };
    return {
        d,
        get(k, dflt = null) { return (k in d) ? d[k] : dflt; },
        set(k, v) { d[k] = v; }
    };
}

// ========== 1. unreadByApp：真实运行时聚合（本批次角标消费的单一真源） ==========
{
    const log = new NotificationLog(mkStorage(), { limit: 200 });
    const r1 = log.push({ title: '微信', message: '在吗', icon: '💬', senderKey: 'wechat:c1:1' });
    log.push({ title: '微信', message: '再问一句', icon: '💬', senderKey: 'wechat:c1:2' });
    const r3 = log.push({ title: '微博', message: '热搜更新', icon: '👁️‍🗨️', senderKey: 'weibo:hot:1' });
    log.push({ title: '系统提示', message: '无关来源', icon: '📢', senderKey: 'misc:1' });

    const agg = log.unreadByApp();
    ok('unreadByApp 按 appId 聚合（推断 wechat）', agg.wechat === 2, JSON.stringify(agg));
    ok('unreadByApp 聚合 weibo', agg.weibo === 1, JSON.stringify(agg));
    ok('unreadByApp 未知来源落 __sys__', agg.__sys__ === 1, JSON.stringify(agg));
    ok('unreadByApp 总数与 unreadCount 一致', Object.values(agg).reduce((s, n) => s + n, 0) === log.unreadCount());

    // 已读后从未读聚合中消失
    log.markRead(r3.id);
    const agg2 = log.unreadByApp();
    ok('markRead 后该 App 从未读聚合消失', !agg2.weibo, JSON.stringify(agg2));
    ok('markRead 后 __sys__/wechat 不受影响', agg2.wechat === 2 && agg2.__sys__ === 1);

    // 合并语义（真实契约：与列表头比较，连续同源才合并）：合并条目在角标口径中只计一次
    const rA = log.push({ title: '微信', message: '第三条', icon: '💬', senderKey: 'wechat:c9:1' });
    const rB = log.push({ title: '微信', message: '第四条', icon: '💬', senderKey: 'wechat:c9:1' });
    ok('同 senderKey 连续到达合并（返回同一 id）', rB.merged === true && rA.id === rB.id, `merged=${rB.merged}`);
    ok('合并条目在未读聚合中只计 1 次', log.unreadByApp().wechat === 3, JSON.stringify(log.unreadByApp()));
    log.markRead(r1.id);
    const head = log.list()[0];
    ok('合并语义与已读口径稳定（无未读回涨）', typeof head.read === 'boolean' && log.unreadByApp().wechat === 2, JSON.stringify(log.unreadByApp()));
}

// ========== 2. _guessAppId：横幅/兜底点击的 appId 回退链（消费端） ==========
{
    const log = new NotificationLog(mkStorage(), { limit: 50 });
    ok('_guessAppId 短信来源 → phone', log._guessAppId('sms:123456', '') === 'phone', log._guessAppId('sms:123456', ''));
    ok('_guessAppId 微信来源 → wechat', log._guessAppId('wechat:abc', '') === 'wechat');
    ok('_guessAppId 音乐图标回退', log._guessAppId('unknown:1', '🎵') === 'music');
    ok('_guessAppId 未知来源兜底 __sys__', log._guessAppId('unknown:1', '🦄') === '__sys__');
}

// ========== 3. _filterChips：未读对齐（消费 unreadByApp，v2.17.0 接线点） ==========
{
    const items = [
        { id: 'n1', appId: 'wechat', read: false, title: 'A', message: 'a', meta: {} },
        { id: 'n2', appId: 'wechat', read: false, title: 'B', message: 'b', meta: {} },
        { id: 'n3', appId: '__sys__', read: false, title: 'C', message: 'c', meta: {} },
        { id: 'n4', appId: 'weibo', read: true, title: 'D', message: 'd', meta: {} }
    ];
    const mockApp = {
        log: {
            list: () => items.slice(),
            unreadByApp: () => ({ wechat: 2, __sys__: 1 })
        }
    };
    const view = new NotificationCenterView(mockApp);
    const html = view._filterChips(items);

    ok('chips 消费 unreadByApp（含全部项）', html.includes('全部<span class="nc-chip-num">3</span>'), html.slice(0, 260));
    ok('chips 微信显示未读数 2', html.includes('微信<span class="nc-chip-num">2</span>'));
    ok('chips 系统显示未读数 1', html.includes('系统<span class="nc-chip-num">1</span>'));
    ok('chips 无未读分组回落总数', html.includes('微博<span class="nc-chip-num">1</span>'));
    ok('chips 排序未读优先（微信在系统前）', html.indexOf('微信') < html.indexOf('系统'));
    ok('chips 排序未读优先（系统在微博前）', html.indexOf('系统') < html.indexOf('微博'));

    // 全部已读：回落总数口径（不为 0 空洞）
    const viewed = new NotificationCenterView({ log: { list: () => items.slice(), unreadByApp: () => ({}) } });
    const html2 = viewed._filterChips(items);
    ok('全已读时「全部」回落总数 4', html2.includes('全部<span class="nc-chip-num">4</span>'), html2.slice(0, 160));
    ok('全已读时微信回落总数 2', html2.includes('微信<span class="nc-chip-num">2</span>'));

    // 落账层缺 unreadByApp 时不抛（旧宿主/降级）
    const legacy = new NotificationCenterView({ log: { list: () => items.slice() } });
    let threw = false;
    try { legacy._filterChips(items); } catch (_e) { threw = true; }
    ok('落账层无 unreadByApp 时优雅降级', threw === false);
}

// ========== 4. _syncBadge：已读变化回同步宿主角标 ==========
{
    const view = new NotificationCenterView({ log: { list: () => [] } });
    let called = 0;
    globalThis.window = { VirtualPhone: { syncNotificationsBadge: () => { called++; } } };
    view._syncBadge();
    ok('_syncBadge 调用宿主钩子', called === 1, `called=${called}`);
    delete globalThis.window;
    let threw = false;
    try { view._syncBadge(); } catch (_e) { threw = true; }
    ok('宿主缺失时 _syncBadge 安全（不抛）', threw === false);
}

// ========== 5. 接线断言：横幅交互（phone-shell.js） ==========
{
    const shell = fs.readFileSync(path.join(root, 'phone', 'phone-shell.js'), 'utf8');
    ok('shell 构造器声明 onBannerAction', /this\.onBannerAction = null;/.test(shell));
    ok('shell 构造器声明 onBannerDismiss', /this\.onBannerDismiss = null;/.test(shell));
    ok('shell 横幅点击绑定 dismissBanner(true)', /notification\.addEventListener\('click', \(\) => dismissBanner\(true\)\)/.test(shell));
    ok('shell 超时路径复用 dismissBanner(false)', /setTimeout\(\(\) => dismissBanner\(false\), 4000\)/.test(shell));
    ok('shell 收起幂等守卫', /_bannerDone/.test(shell));
    ok('shell 横幅挂可点击类', /phone-notification-tappable/.test(shell));
    ok('shell appId 三级回退（meta → 推断 → __sys__）',
        /data\.meta\?\.appId/.test(shell) && /_guessAppId\?\.\(data\.senderKey/.test(shell) && /'__sys__'/.test(shell));

    const css = fs.readFileSync(path.join(root, 'phone.css'), 'utf8');
    ok('CSS 可点击横幅光标样式', /\.phone-notification-tappable\s*\{/.test(css));
    ok('CSS 横幅按压反馈', /\.phone-notification-tappable:active/.test(css));
    ok('CSS 锁屏单条按压反馈', /\.phone-lockscreen \.pls-note:active/.test(css));

    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('index 定义 bindBannerInteractions', /function bindBannerInteractions\(shell\)/.test(idx));
    ok('index 实例化后立即注入横幅回调', /bindBannerInteractions\(phoneShell\)/.test(idx));
    ok('index 注入 onBannerDismiss（标已读）', /shell\.onBannerDismiss = \(notif\) =>/.test(idx));
    ok('index 注入 onBannerAction（跳 App）', /shell\.onBannerAction = \(appId\) =>/.test(idx));
    ok('CSS 缓存版本号已更新', /ST_PHONE_CSS_REVISION = '20260917-v2170-notification-interactions'/.test(idx));
}

// ========== 6. 接线断言：角标消费（index.js） ==========
{
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('index 定义 syncNotificationsBadge', /function syncNotificationsBadge\(\)/.test(idx));
    ok('syncNotificationsBadge 消费 unreadCount', /log\.unreadCount\(\)/.test(idx));
    ok('角标同步挂到 VirtualPhone（供视图/锁屏调用）', /window\.VirtualPhone\.syncNotificationsBadge = syncNotificationsBadge/.test(idx));
    ok('启动即对齐历史未读', /syncNotificationsBadge\(\); \/\/ \[v2\.17\.0\] 启动即对齐/.test(idx));
    ok('落账后同步角标（含免打扰静默通知）', /落账后同步通知中心角标/.test(idx));
    ok('打开 App 时通知中心不清零', /appId !== 'wechat' && appId !== 'notifications'/.test(idx));
    const excludes = idx.split("id === 'notifications'").length - 1;
    ok('总角标重算统一排除通知中心（防双计）', excludes >= 4, `excludes=${excludes}`);
    ok('通知中心开着时实时刷新', /currentApp === 'notifications' && window\.VirtualPhone\?\.notificationsApp\?\.render/.test(idx));
    ok('刷新避开搜索框聚焦', /const typing = ncInput && document\.activeElement === ncInput;/.test(idx));
}

// ========== 7. 接线断言：页面兜底横幅可点击（index.js） ==========
{
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('兜底横幅放开点击（pointerEvents auto）', /notification\.style\.pointerEvents = 'auto'/.test(idx));
    ok('兜底横幅入队带 appId', /appId: String\(meta\.appId \|\| ''\)/.test(idx));
    ok('兜底点击打开面板并跳转（_openPhoneAndJump）', /async function _openPhoneAndJump\(appId\)/.test(idx));
    ok('兜底收起幂等守卫', /_fallbackDone/.test(idx));
    ok('兜底点击绑定 dismissFallback(true)', /notification\.addEventListener\('click', \(\) => dismissFallback\(true\)\)/.test(idx));
    ok('兜底超时复用 dismissFallback(false)', /setTimeout\(\(\) => dismissFallback\(false\), FALLBACK_NOTIFICATION_VISIBLE_MS\)/.test(idx));
}

// ========== 8. 接线断言：锁屏单条直达（lock-screen.js） ==========
{
    const lock = fs.readFileSync(path.join(root, 'phone', 'lock-screen.js'), 'utf8');
    ok('锁屏每条通知挂 data-id/data-app', /data-id="\$\{_esc\(n\.id \|\| ''\)\}" data-app="\$\{_esc\(n\.appId \|\| ''\)\}"/.test(lock));
    ok('锁屏逐条绑定点击', /root\.querySelectorAll\('\.pls-note'\)\.forEach/.test(lock));
    ok('锁屏单条标记已读', /notificationLog\?\.markRead\?\.\(nid\)/.test(lock));
    ok('锁屏单条同步宿主角标', /window\.VirtualPhone\?\.syncNotificationsBadge\?\.\(\)/.test(lock));
    ok('锁屏 __sys__ 回落通知中心', /appId && appId !== '__sys__' \? appId : 'notifications'/.test(lock));
    ok('锁屏保留整块点击兜底', /root\.querySelector\('#pls-notes'\)\?\.addEventListener\('click'/.test(lock));
}

// ========== 9. 接线断言：通知中心视图（notification-center-view.js） ==========
{
    const view = fs.readFileSync(path.join(root, 'apps', 'notifications', 'notification-center-view.js'), 'utf8');
    ok('view 消费 unreadByApp', /typeof log\.unreadByApp === 'function'/.test(view));
    ok('view 定义 _syncBadge', /_syncBadge\(\) \{/.test(view));
    const syncs = view.split('this._syncBadge();').length - 1;
    ok('view 已读/删除/清空/单条点击均回同步', syncs >= 4, `syncs=${syncs}`);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
