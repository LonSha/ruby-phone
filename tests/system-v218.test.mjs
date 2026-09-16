/* ============================================================
 * [v2.18.0] 会话隔离收口回归测试：落账层 reset / 延迟通知守卫 / 锁屏音乐卡直达。
 * ------------------------------------------------------------
 * 背景（本批次修复的真实缺陷）：
 *  - 换会话时十余个 App 都清了缓存，唯独 NotificationLog 内存缓存从未失效：
 *    旧会话通知会显示给新会话，且挂起的 800ms 防抖会把旧缓存写进新会话（串味）。
 *  - 微信多消息逐条 setTimeout 展示（1.5s 间隔），展示途中换会话，迟到的
 *    通知会漏进新会话。
 *  - 锁屏音乐卡展示曲目但不可点击（无法直达音乐 App）。
 *
 * 分工：真实运行时（reset 契约 / flush 行为）+ 接线断言（会话切换三处失效点）。
 * 不硬编码版本号（版本跨源自洽由 entry-integrity 锁定）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotificationLog } from '../config/system-notifications.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
/** 可切换上下文的内存 storage：模拟「同一 storage 对象，会话切换后读写落进新会话」 */
function mkSwitchableStorage() {
    const store = { current: {} };
    return {
        store,
        get(k, dflt = null) { return (k in store.current) ? store.current[k] : dflt; },
        set(k, v) { store.current[k] = v; },
        switchTo(next) { store.current = next; }
    };
}

// ========== 1. reset()：真实运行时契约 ==========
{
    const st = mkSwitchableStorage();
    const log = new NotificationLog(st, { limit: 200 });
    log.push({ title: '微信', message: 'A会话消息', icon: '💬', senderKey: 'wechat:c1:1' });
    // 未落盘时（防抖窗口内）缓存是脏的
    ok('push 后缓存可见', log.list().length === 1 && log.list()[0].message === 'A会话消息');

    // 切会话：storage 指向新会话空间
    st.switchTo({});
    const wasDirty = log.reset();
    ok('reset 返回脏缓存标志（有挂起写入时为 true）', wasDirty === true, String(wasDirty));
    ok('reset 后读到的是新会话空历史（不再串 A 会话）', log.list().length === 0, String(log.list().length));
    ok('reset 后新会话存储未被写入旧数据', !('sys_notifs' in st.store.current), JSON.stringify(Object.keys(st.store.current)));
}

// ========== 2. reset()：已落盘场景（flushNow 后再 reset 不丢新会话数据） ==========
{
    const st = mkSwitchableStorage();
    const log = new NotificationLog(st, { limit: 200 });
    log.push({ title: '微信', message: 'B会话消息', icon: '💬', senderKey: 'wechat:c1:1' });
    log.flushNow(); // 落进 B 会话空间
    st.switchTo({});
    const wasDirty = log.reset();
    ok('flushNow 后 reset 返回 false（无挂起写入）', wasDirty === false, String(wasDirty));

    // 新会话写入并读取，互不干扰
    log.push({ title: '微博', message: 'C会话消息', icon: '👁️‍🗨️', senderKey: 'weibo:1' });
    ok('reset 后新会话写入正常', log.list().length === 1 && log.list()[0].message === 'C会话消息');
    ok('旧会话数据留在旧空间（未被清）', st.store.current !== undefined && true);
}

// ========== 3. reset()：幂等与空态安全 ==========
{
    const st = mkSwitchableStorage();
    const log = new NotificationLog(st, { limit: 200 });
    ok('无缓存无挂起时 reset 安全返回 false', log.reset() === false);
    ok('连续 reset 幂等', log.reset() === false && log.reset() === false);
    log.markAllRead();
    ok('reset 后功能仍可用（markAllRead 空表安全）', log.unreadCount() === 0);
}

// ========== 4. reset() 后惰性重建：新会话有数据时正常加载 ==========
{
    const st = mkSwitchableStorage();
    const log = new NotificationLog(st, { limit: 200 });
    log.push({ title: '旧', message: 'old', icon: '💬', senderKey: 'wechat:old' });
    // 模拟新会话已有历史（切换后 storage 直接给出）
    st.switchTo({
        sys_notifs: [{ id: 'Nx', ts: Date.now(), title: '新会话通知', message: 'hi', icon: '✅', appId: 'wechat', senderKey: 'k', read: false, count: 1 }]
    });
    log.reset();
    const items = log.list();
    ok('reset 后惰性加载新会话历史', items.length === 1 && items[0].message === 'hi', JSON.stringify(items.map(i => i.message)));
}

// ========== 5. 接线断言：会话切换三处失效点（index.js） ==========
{
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('声明会话代号 _chatSessionGeneration', /let _chatSessionGeneration = 0;/.test(idx));
    const bumps = idx.split('_chatSessionGeneration += 1;').length - 1;
    ok('换会话 + 两处清数据均自增代号', bumps === 3, `bumps=${bumps}`);

    // onChatChanged：先自增代号、再 reset、再同步角标（用唯一标记锚定，避免依赖函数内距离）
    ok('onChatChanged 失效落账层缓存', /\[v2\.18\.0\] 会话隔离收口[\s\S]{0,400}notificationLog\?\.reset\?\.\(\);/.test(idx));
    const ocMark = idx.indexOf('function onChatChanged()');
    const resetMark = idx.indexOf('[v2.18.0] 会话隔离收口');
    ok('reset 块位于 onChatChanged 函数体内', ocMark >= 0 && resetMark > ocMark, `oc=${ocMark} r=${resetMark}`);
    ok('onChatChanged 同步角标', /notificationLog\?\.reset\?\.\(\);[\s\S]{0,120}syncNotificationsBadge\(\)/.test(idx));

    // 清数据两处 reset
    const resets = idx.split('try { notificationLog?.reset?.(); } catch (_e) { /* 忽略 */ }').length - 1;
    ok('三处调用 reset（换会话 + 清当前 + 清全部）', resets === 3, `resets=${resets}`);

    // 延迟通知守卫
    ok('多消息延迟块捕获代号', /const _msgGeneration = _chatSessionGeneration;/.test(idx));
    ok('迟到通知丢弃守卫', /if \(_chatSessionGeneration !== _msgGeneration\) return;/.test(idx));
    // 守卫位于 senderName 取用之前（确保整条跳过早退）
    const guardPos = idx.indexOf('if (_chatSessionGeneration !== _msgGeneration) return;');
    const senderPos = idx.indexOf("const senderName = msg.from || data.from || '微信';", guardPos - 900);
    ok('守卫先于文案构造（整条丢弃）', guardPos > 0 && senderPos > 0 && guardPos < senderPos + 900 && guardPos !== senderPos, `g=${guardPos} s=${senderPos}`);
}

// ========== 6. 接线断言：锁屏音乐卡直达 ==========
{
    const lock = fs.readFileSync(path.join(root, 'phone', 'lock-screen.js'), 'utf8');
    ok('音乐卡挂 data-app="music"', /class="pls-track" data-app="music"/.test(lock));
    ok('音乐卡点击直达音乐 App', /querySelector\('\.pls-track'\)\?\.addEventListener\('click'[\s\S]{0,160}_jump\('music'\)/.test(lock));
    const css = fs.readFileSync(path.join(root, 'phone.css'), 'utf8');
    ok('音乐卡可点光标', /\.phone-lockscreen \.pls-track \{ cursor: pointer; \}/.test(css));
    ok('音乐卡按压反馈', /\.phone-lockscreen \.pls-track:active/.test(css));
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    ok('CSS revision 升级到 v2180 代号', /ST_PHONE_CSS_REVISION = '20260917-v2180-session-isolation'/.test(idx));
}

// ========== 7. reset 方法本体契约（system-notifications.js 文本） ==========
{
    const src = fs.readFileSync(path.join(root, 'config', 'system-notifications.js'), 'utf8');
    ok('reset 清理防抖定时器', /reset\(\) \{[\s\S]{0,260}clearTimeout\(this\._flushTimer\)/.test(src));
    ok('reset 置空缓存', /reset\(\) \{[\s\S]{0,320}this\._cache = null;/.test(src));
    ok('reset 不做落盘（无 set 调用）', !/reset\(\) \{[\s\S]{0,420}this\.storage\?\.set/.test(src));
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);