/* ============================================================
 * [v2.16.0] 系统层补强回归测试：通知落账层 / 全局搜索内核 / 系统控制内核 / 接线。
 * ------------------------------------------------------------
 * 设计原则（对齐本仓库既有测试约定）：
 *  1) 只测「真实契约」：纯函数与类行为用真实实现跑，不做 mock 式自证。
 *  2) 接线断言读源码文本，防止「模块写好了但没接上」的假交付
 *     （本轮实测踩过：控制中心类写完却无人 new、幂等 esc 退化为 no-op）。
 *  3) 不硬编码版本号（版本跨源自洽由 entry-integrity 锁定）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotificationLog } from '../config/system-notifications.js';
import { GlobalSearchEngine, scoreHit, makeSnippet, buildDefaultSources } from '../apps/memory/global-search-engine.js';
import {
    SYS_KEYS, SCALE_MIN, SCALE_MAX, SCALE_DEFAULT,
    normalizeScale, readFlag, writeFlag, isDndOn, isWifiOn, isFlashlightOn,
    readShellScale, applyShellScale, lockNow, musicControl, currentTrack
} from '../config/system-controls.js';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
/** 内存 storage 替身：只实现本层真正用到的 get/set */
function mkStorage(seed = {}) {
    const d = { ...seed };
    const writes = [];
    return {
        d, writes,
        get(k, dflt = null) { return (k in d) ? d[k] : dflt; },
        set(k, v) { d[k] = v; writes.push({ key: k, value: v }); }
    };
}

// ========== 1. NotificationLog：落账 / 合并 / 上限 / 已读 / 检索 / 容错 ==========
{
    const st = mkStorage();
    const log = new NotificationLog(st, { limit: 200 });
    const r1 = log.push({ title: '微信', message: '在吗', icon: '💬', senderKey: 'wechat:c1:1', appId: 'wechat' });
    ok('push 返回条目 id 且未合并', !!r1.id && r1.merged === false && r1.total === 1);
    ok('push 后未读数为 1', log.unreadCount() === 1);
    // 同 senderKey 窗口内合并：更新末条，不新增、不重置已读
    log.markRead(r1.id);
    const r2 = log.push({ title: '微信', message: '在吗（又发一条）', icon: '💬', senderKey: 'wechat:c1:1', appId: 'wechat' });
    ok('同 senderKey 3 分钟内合并为一条', r2.merged === true && log.list().length === 1, `len=${log.list().length}`);
    ok('合并会累加 count', Number(log.list()[0].count) === 2);
    ok('合并更新正文', log.list()[0].message.includes('又发一条'));
    ok('合并不重置已读', log.list()[0].read === true);
    // 不同 senderKey 新增
    log.push({ title: '微博', message: '热搜更新', icon: '👁️‍🗨️', senderKey: 'weibo:hot:1' });
    ok('不同 senderKey 新增条目', log.list().length === 2);
    // 新 → 旧
    ok('list 按时间倒序（新在前）', log.list()[0].senderKey === 'weibo:hot:1');
    // 归属推断：按 senderKey 关键字
    ok('_guessAppId 由 senderKey 推断 App', log.list()[0].appId === 'weibo', log.list()[0].appId);
    // 搜索
    ok('search 命中正文', log.search('热搜').length === 1);
    ok('search 空关键词返回全部', log.search('').length === 2);
    // markAllRead
    const all = log.markAllRead();
    ok('markAllRead 标记剩余未读', all.count === 1 && log.unreadCount() === 0, `count=${all.count}`);
    // remove / clear
    const rm = log.remove(log.list()[0].id);
    ok('remove 删除单条', rm.removed === true && log.list().length === 1);
    const cl = log.clear();
    ok('clear 清空全部', cl.removed === 1 && log.list().length === 0);
    // 落盘：防抖 + flushNow
    log.push({ title: '系统', message: '测试落盘', icon: '📱' });
    const flushed = log.flushNow();
    ok('flushNow 把缓存写入 storage[sys_notifs]', flushed === true && Array.isArray(st.d.sys_notifs));
    ok('落盘键名固定为 sys_notifs', st.writes.some(w => w.key === 'sys_notifs'));
    // 脏数据容错
    const st2 = mkStorage({ sys_notifs: [null, 3, { title: 'x', ts: 5 }, { message: 'y' }] });
    const log2 = new NotificationLog(st2);
    const normed = log2.list();
    ok('脏数据被净化（跳过非对象）', normed.length === 2, `len=${normed.length}`);
    ok('缺 id 的条目自动补号', normed.every(n => !!n.id));
    ok('归一化后仍按时间倒序', Number(normed[0].ts) >= Number(normed[1].ts));
    // 上限：环形裁剪
    const st3 = mkStorage();
    const log3 = new NotificationLog(st3, { limit: 20 });
    for (let i = 0; i < 60; i++) {
        log3.push({ title: `T${i}`, message: `M${i}`, senderKey: `k${i}`, ts: 1000000000000 + i * 1000 });
    }
    ok('超出上限时按上限环形裁剪', log3.list().length === 20, `len=${log3.list().length}`);
    ok('裁剪保留最新（头部）', log3.list()[0].title === 'T59', log3.list()[0].title);
    // 容错：push 绝不抛
    const bad = new NotificationLog(null);
    let threw = false;
    try { bad.push({ title: 'a' }); } catch (_e) { threw = true; }
    ok('storage 为 null 时 push 不抛（降级内存态）', threw === false);
    const weird = new NotificationLog({ get() { throw new Error('boom'); }, set() { throw new Error('boom'); } });
    let threw2 = false;
    try { weird.push({ title: 'b' }); } catch (_e) { threw2 = true; }
    ok('storage 抛异常时 push 仍不抛', threw2 === false);
    ok('storage 抛异常时 list 返回数组', Array.isArray(weird.list()));
}

// ========== 2. 搜索内核：评分 / 摘要 / 索引 / 分组 / 坏源隔离 ==========
{
    ok('标题精确命中分最高', scoreHit('在吗', '', '在吗') > scoreHit('你在吗', '', '在吗'));
    ok('标题命中 > 仅正文命中', scoreHit('日记', '', '日记') > scoreHit('今天', '写了一篇日记', '日记'));
    ok('未命中返回负分', scoreHit('abc', 'def', 'zzz') < 0);
    ok('空查询返回负分', scoreHit('a', 'b', '') < 0);
    // makeSnippet
    const sn = makeSnippet('前面一些无关的文字' + '目标关键词' + '后面还有很多文字需要被截断掉', '目标关键词', 20);
    ok('makeSnippet 命中时居中开窗并标注', sn.hit === true && sn.text.includes('目标关键词'));
    ok('makeSnippet 两侧补省略号', sn.text.startsWith('…') && sn.text.endsWith('…'));
    ok('makeSnippet 未命中回退头部截断', makeSnippet('abc', 'zzz', 2).hit === false);
    ok('makeSnippet 空正文安全', makeSnippet('', 'x').text === '');
    // 引擎
    const eng = new GlobalSearchEngine({
        sources: [
            { id: 'a', label: '源A', icon: '🅰️', weight: 2, items: () => [{ title: '苹果', body: '红苹果真甜', ts: 2000 }] },
            { id: 'b', label: '源B', icon: '🅱️', weight: 1, items: () => [{ title: '苹果派', body: '烤苹果派', ts: 1000 }] },
            { id: 'bad', label: '坏源', icon: '💥', items: () => { throw new Error('源读取失败'); } },
            { id: 'notarray', label: '非数组', icon: '🚫', items: () => '不是数组' }
        ]
    });
    const built = eng.build();
    ok('坏源被跳过且记录错误', built.length === 2 && eng.lastErrors().some(e => e.sourceId === 'bad'));
    ok('返回非数组的源被安全忽略', !built.some(x => x.sourceId === 'notarray'));
    const q = eng.query('苹果');
    ok('query 命中两条', q.results.length === 2, `len=${q.results.length}`);
    ok('权重高的源排在前面', q.results[0].sourceId === 'a', q.results[0].sourceId);
    ok('结果按源分组', q.groups.length === 2);
    ok('分组内条目数正确', q.groups.every(g => g.items.length === 1));
    ok('scanned 报告已索引条数', q.scanned === 2);
    ok('空查询返回空结果但不报错', eng.query('').results.length === 0);
    ok('sourceIds 限定检索范围', eng.query('苹果', { sourceIds: ['b'] }).results.every(r => r.sourceId === 'b'));
    // 缓存与失效
    const eng2 = new GlobalSearchEngine({ sources: [{ id: 'c', label: 'C', items: () => [{ title: 'x', body: 'x' }] }] });
    eng2.build();
    eng2.invalidate();
    ok('invalidate 后可重建', eng2.build().length === 1);
    // 超长正文截断（截断安全）
    const eng3 = new GlobalSearchEngine({
        sources: [{ id: 'd', label: 'D', items: () => [{ title: 'x'.repeat(500), body: 'y'.repeat(5000) }] }]
    });
    const big = eng3.build()[0];
    ok('标题截断到 120 字', big.title.length === 120, String(big.title.length));
    ok('正文截断到 600 字', big.body.length === 600, String(big.body.length));
    // listSources
    ok('listSources 暴露来源元信息', eng.listSources().length === 4);
    ok('registerSource 拒绝非函数 items', eng.registerSource({ id: 'z' }) === false);
}

// ========== 3. 索引源与真实存储键/字段对齐（防死代码） ==========
{
    const seed = {
        wechat_data: {
            contacts: [{ name: '顾海棠', remark: '海棠', relation: '蜜语主播' }],
            chats: [{ id: 'c1', name: '顾海棠', type: 'single', timestamp: 1700000000000 }],
            moments: [{ name: '顾海棠', text: '今晚风很好', timestamp: 1700000001000, commentList: [{ name: '我', text: '是啊' }] }]
        },
        // 微信消息真实落点：独立分片键（不在 chats[].messages）
        wechat_msg_c1: [{ content: '在吗', timestamp: 1 }, { content: '睡了没', timestamp: 2 }],
        // 存储形态与真实一致：日记/短信/通话/记忆为字符串或原生值
        diary_entries: JSON.stringify([{ title: '雨夜', content: '窗外下雨了', createdAt: 1700000002000 }]),
        phone_call_sms_conversations: [{ name: '顾海棠', messages: [{ text: '到家了吗' }], updatedAt: 1700000003000 }],
        phone_call_history: [{ caller: '顾海棠', status: 'answered', date: '2026-09-16' }],
        tw_letters: [{ title: '给三年后的你', paragraphs: ['愿你还记得今晚的风'], ts: 1700000004000 }],
        calendar_memos: [{ title: '体检', dateKey: '2026-09-20', time: '09:00', createdAt: 1700000005000 }],
        music_playlist: [{ name: '晚风', artist: '陈某' }],
        // 世界脉搏真实键名是 worldpulse_history_v1，元素 {style,content,floorCount,createdAt}
        worldpulse_history_v1: [{ style: '都市日常', content: '江边亮起了灯', floorCount: 12, createdAt: 1700000006000 }],
        // 阅读真实键名是 ruby_reading_shelf
        ruby_reading_shelf: JSON.stringify([{ title: '长夜', author: '某人', addedAt: 1700000007000 }]),
        // 成就存的是 {id: 时间戳} 映射（非数组）
        ruby_unlocked_achievements: { energy_gained_50: 1700000008000 },
        ruby_xhs_notes: [{ title: '舒芙蕾', content: '像云朵', author: '顾海棠' }],
        ruby_tieba_posts: [{ title: '夜跑求伴', content: '江边风很舒服', author: '江城夜归人' }],
        sys_notifs: [{ title: '微信', message: '在吗', ts: 1700000009000 }]
    };
    const st = mkStorage(seed);
    const sources = buildDefaultSources(st, {});
    const ids = sources.map(s => s.id);
    ok('索引源数量 ≥ 15', sources.length >= 15, String(sources.length));
    ok('纳入微信会话源', ids.includes('wechat-chat'));
    ok('纳入通知源', ids.includes('notifications'));
    ok('未注入 chatContext 时不纳入酒馆正文源', !ids.includes('tavern'));
    const eng = new GlobalSearchEngine({ sources });
    eng.build();
    ok('全部真实源可无错构建', eng.lastErrors().length === 0, JSON.stringify(eng.lastErrors()));
    // 微信消息来自分片键
    const wechatHits = eng.query('睡了没');
    ok('微信消息经分片键被索引', wechatHits.results.some(r => r.sourceId === 'wechat-chat'), '分片键未读到');
    // 世界脉搏（旧键名会 0 命中 → 本条即防死代码门）
    ok('世界脉搏历史可被检索', eng.query('亮起了灯').results.some(r => r.sourceId === 'worldpulse'));
    // 阅读（旧键名会 0 命中）
    ok('阅读书架可被检索', eng.query('长夜').results.some(r => r.sourceId === 'reading'));
    // 成就（映射形态）
    ok('成就映射被索引', eng.query('energy_gained_50').results.some(r => r.sourceId === 'achievement'));
    // 通知
    ok('通知历史可被检索', eng.query('在吗').results.some(r => r.sourceId === 'notifications'));
    // 注入 chatContext 后纳入酒馆正文
    const withCtx = buildDefaultSources(st, { chatContext: { chat: [{ mes: '第一楼正文', name: '她', is_user: false }] } });
    ok('注入 chatContext 后纳入酒馆正文源', withCtx.some(s => s.id === 'tavern'));
    // 存储空白的极端情况：不得抛
    let threw = false;
    try { buildDefaultSources(mkStorage(), {}).forEach(s => s.items()); } catch (_e) { threw = true; }
    ok('空存储下所有源 items() 不抛', threw === false);
    let threw2 = false;
    try { buildDefaultSources(null, {}).forEach(s => s.items()); } catch (_e) { threw2 = true; }
    ok('storage 为 null 时所有源 items() 不抛', threw2 === false);
}

// ========== 4. 系统控制内核：归一化 / 开关 / 缩放回落 / 锁屏 / 音乐 ==========
{
    ok('缩放常量区间为 80-120', SCALE_MIN === 80 && SCALE_MAX === 120 && SCALE_DEFAULT === 100);
    ok('normalizeScale 下界钳制', normalizeScale(10) === 80);
    ok('normalizeScale 上界钳制', normalizeScale(500) === 120);
    ok('normalizeScale 非数字回落默认', normalizeScale('abc') === 100);
    ok('normalizeScale 取整', normalizeScale(95.7) === 95);
    // 布尔兼容
    const st = mkStorage();
    writeFlag(st, SYS_KEYS.DND, true);
    ok('writeFlag/isDndOn 往返一致', isDndOn(st) === true);
    st.d[SYS_KEYS.DND] = '1';
    ok("readFlag 兼容字符串 '1'", readFlag(st, SYS_KEYS.DND) === true);
    st.d[SYS_KEYS.DND] = 'off';
    ok("readFlag 兼容字符串 'off'", readFlag(st, SYS_KEYS.DND) === false);
    delete st.d[SYS_KEYS.DND];
    ok('isDndOn 缺省为关（不打断默认关）', isDndOn(st) === false);
    ok('isWifiOn 缺省为开', isWifiOn(mkStorage()) === true);
    ok('isFlashlightOn 缺省为关', isFlashlightOn(mkStorage()) === false);
    // 缩放读取：新键优先，回落旧键（与设置页双向一致）
    ok('无任何键时返回默认 100', readShellScale(mkStorage()) === 100);
    ok('回落既有 phone-shell-scale', readShellScale(mkStorage({ 'phone-shell-scale': 110 })) === 110);
    ok('sys_shell_scale 优先于旧键',
        readShellScale(mkStorage({ sys_shell_scale: 90, 'phone-shell-scale': 110 })) === 90);
    // applyShellScale 无 DOM 环境：至少把状态落盘
    const st2 = mkStorage();
    const res = applyShellScale(st2, 105);
    ok('applyShellScale 返回归一化结果', res.percent === 105);
    ok('applyShellScale 落盘状态键', st2.d[SYS_KEYS.SCALE] === 105);
    // 键名域（会话隔离依赖 /^sys_/ 命中 chatMetadata）
    ok('全部系统键以 sys_ 前缀命名', Object.values(SYS_KEYS).every(k => k.startsWith('sys_')));
    // 锁屏回落链
    let locked = false;
    const fakeShell = { lockScreen: { lock() { locked = true; } } };
    ok('lockNow 走 PhoneShell.lockScreen.lock', lockNow(fakeShell) === true && locked === true);
    let toggled = false;
    ok('lockNow 无锁屏对象时回落 toggleScreen',
        lockNow({ toggleScreen() { toggled = true; } }) === true && toggled === true);
    ok('lockNow 无宿主时返回 false 不抛', lockNow(null) === false);
    // 音乐：无宿主时安全降级
    ok('musicControl 无宿主时返回不可用', musicControl('toggle').available === false);
    ok('currentTrack 无宿主时返回 null', currentTrack() === null);
    // 音乐真实接口（musicData + getCurrentSong + next/prev/resume/pause）
    const calls = [];
    const fakeData = {
        isPlaying: true,
        audioPlayer: { paused: false },
        getCurrentSong() { return { name: '晚风', artist: '陈某' }; },
        next() { calls.push('next'); },
        prev() { calls.push('prev'); },
        pause() { calls.push('pause'); this.isPlaying = false; },
        resume() { calls.push('resume'); this.isPlaying = true; }
    };
    globalThis.window = { VirtualPhone: { musicApp: { musicData: fakeData } } };
    const t = currentTrack();
    ok('currentTrack 读真实曲目字段 name/artist', t && t.title === '晚风' && t.artist === '陈某');
    ok('currentTrack 反映播放态', t.playing === true);
    ok('musicControl(next) 调 MusicData.next', (musicControl('next'), calls.includes('next')));
    ok('musicControl(prev) 调 MusicData.prev', (musicControl('prev'), calls.includes('prev')));
    ok('musicControl(toggle) 播放中调 pause', (musicControl('toggle'), calls.includes('pause')));
    fakeData.audioPlayer.paused = true;
    ok('musicControl(toggle) 暂停中调 resume', (musicControl('toggle'), calls.includes('resume')));
    ok('musicControl 返回 available=true', musicControl('toggle').available === true);
    delete globalThis.window;
}

// ========== 5. 接线门：模块必须真的被装配（防假交付） ==========
{
    const idx = routeSurface(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), readRepoTable());
    const storageSrc = fs.readFileSync(path.join(root, 'config/storage.js'), 'utf8');
    const appsSrc = fs.readFileSync(path.join(root, 'config/apps.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(root, 'phone.css'), 'utf8');
    // 存储分域：sys_ 必须命中 chatMetadata
    ok('CHAT_DATA_PATTERNS 收录 /^sys_/', /\/\^sys_\//.test(storageSrc));
    const { PhoneStorage } = await import('../config/storage.js');
    const pstore = new PhoneStorage();
    ok('sys_notifs 路由到 chatMetadata', pstore._isChatData('sys_notifs') === true);
    ok('sys_dnd 路由到 chatMetadata', pstore._isChatData('sys_dnd') === true);
    ok('phone-shell-scale 仍为全局配置（未被 sys_ 误伤）', pstore._isChatData('phone-shell-scale') === false);
    // 两个新 App 已注册且有路由
    ok('桌面注册 notifications App', /id: 'notifications'/.test(appsSrc));
    ok('桌面注册 search App', /id: 'search'/.test(appsSrc));
    ok('index 有 notifications 路由分支', /appId === 'notifications'/.test(idx));
    ok('index 有 search 路由分支', /appId === 'search'/.test(idx));
    // 落账层装配
    ok('index 静态导入 NotificationLog', /import \{ NotificationLog \}/.test(idx));
    ok('createInPanel 后实例化 NotificationLog', /new NotificationLog\(storage/.test(idx));
    ok('落账层挂到 window.VirtualPhone', /VirtualPhone\.notificationLog = notificationLog/.test(idx));
    ok('通知咽喉调用落账 push', /notificationLog\?\.push\?\.\(/.test(idx));
    ok('落账在展示分支之前（先记账再展示）',
        idx.indexOf('notificationLog?.push?.(') < idx.indexOf('if (isPhoneOpen && phoneShell?.showNotification'));
    // 免打扰门
    ok('index 导入系统控制内核', /from '\.\/config\/system-controls\.js'/.test(idx));
    ok('通知咽喉接免打扰门', /if \(isDndOnState\(storage\)\) return;/.test(idx));
    // 控制中心装配（本轮回归点：类写完必须有人 new）
    ok('index 静态导入 ControlCenter', /import \{ ControlCenter \}/.test(idx));
    ok('index 实例化 ControlCenter', /new ControlCenter\(phoneShell, storage\)/.test(idx));
    ok('控制中心挂到 window.VirtualPhone', /VirtualPhone\.controlCenter = controlCenter/.test(idx));
    ok('顶部下拉可呼出控制中心', /function openControlCenter\(\)/.test(idx));
    ok('控制中心已从 VirtualPhone 导出', /controlCenter,\s*\/\/ \[v2\.16\.0\]/.test(idx));
    // 手势：点按不触发下拉（位移阈值），且绑定带幂等守卫
    ok('下拉手势有幂等守卫', /ncPullBound === '1'/.test(idx));
    ok('下拉以位移阈值触发（点按不误触）', /- startY > 46/.test(idx));
    // 锁屏速览 / 音乐卡 / 时段问候
    const lockSrc = fs.readFileSync(path.join(root, 'phone', 'lock-screen.js'), 'utf8');
    ok('锁屏读通知落账层', /notificationLog/.test(lockSrc) && /\.list\(\)/.test(lockSrc));
    ok('锁屏有通知速览块', /pls-notes/.test(lockSrc));
    ok('锁屏有音乐卡', /pls-track/.test(lockSrc));
    ok('锁屏有时段问候', /_greeting\(/.test(lockSrc) && /pls-hello/.test(lockSrc));
    ok('锁屏音乐复用系统控制真源（不重复实现）', /currentTrack as _currentTrack/.test(lockSrc));
    ok('锁屏保留上滑解锁阈值', /dy > 72/.test(lockSrc));
    // 控制中心面板内容落在真实能力上
    const ccSrc = fs.readFileSync(path.join(root, 'phone', 'control-center.js'), 'utf8');
    ok('控制中心含免打扰开关', /SYS_KEYS\.DND/.test(ccSrc));
    ok('控制中心含 Wi-Fi 开关', /SYS_KEYS\.WIFI/.test(ccSrc));
    ok('控制中心含手电筒开关', /SYS_KEYS\.FLASHLIGHT/.test(ccSrc));
    ok('控制中心含显示缩放', /readShellScale/.test(ccSrc) && /applyShellScale/.test(ccSrc));
    ok('控制中心含立即锁屏', /lockNow\(/.test(ccSrc));
    ok('控制中心含音乐控制', /musicControl\(/.test(ccSrc));
    // CSS：系统层样式必须真的存在（否则呈现为裸 DOM）
    ok('CSS 含锁屏通知速览样式', /\.pls-notes\s*\{/.test(cssSrc));
    ok('CSS 含锁屏问候样式', /\.pls-hello\s*\{/.test(cssSrc));
    ok('CSS 含锁屏音乐条样式', /\.pls-track\s*\{/.test(cssSrc));
    ok('CSS 含控制中心面板样式', /\.sys-cc-panel\s*\{/.test(cssSrc));
    ok('CSS 含控制中心瓦片样式', /\.sys-cc-tile\s*\{/.test(cssSrc));
    ok('CSS 含手电筒样式', /\.phone-in-panel\.sys-flashlight-on/.test(cssSrc));
    // 通知中心 / 搜索 样式随视图内联注入
    const ncApp = fs.readFileSync(path.join(root, 'apps', 'notifications', 'notifications-app.js'), 'utf8');
    const gsApp = fs.readFileSync(path.join(root, 'apps', 'search', 'search-app.js'), 'utf8');
    ok('通知中心样式内联注入（含 .nc- 命名域）', /\.nc-wrap/.test(ncApp) && /css\(\)/.test(ncApp));
    ok('搜索样式内联注入（含 .gs- 命名域）', /\.gs-wrap/.test(gsApp) && /css\(\)/.test(gsApp));
    // 转义 no-op 回归门：esc() 的双引号替换必须是实体（本轮踩过 \u0022 → 裸引号）
    const escFiles = [
        'phone/lock-screen.js', 'phone/control-center.js',
        'apps/search/search-view.js', 'apps/notifications/notification-center-view.js'
    ];
    // 判据用「no-op 签名」本身（替换成裸引号 = 等于没转义），
    // 不绑定具体实体写法（" 与 &#34; 等价，避免测试比实现更苛刻）。
    const NOOP = "replace(/\\u0022/g, " + "'" + '"' + "'" + ")";
    const badEsc = escFiles.filter(f => {
        const s = fs.readFileSync(path.join(root, f), 'utf8');
        return s.includes(NOOP);
    });
    ok('全部 esc() 的双引号转义非 no-op', badEsc.length === 0, badEsc.join(','));
    // 反向确保：四处 esc 仍在（防止整段被误删后测试假绿）
    ok('四处 esc() 均存在', escFiles.every(f =>
        fs.readFileSync(path.join(root, f), 'utf8').includes('\\u0022')));
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
