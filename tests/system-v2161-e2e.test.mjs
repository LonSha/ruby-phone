/**
 * v2.16.1 全链路正向审计：用真实形态 seed 数据端到端驱动
 *   NotificationLog → index 落账 → 搜索索引 17 源 → 控制内核 → 锁屏
 * 目标：不是断言源码文本，而是断言「真数据进来 → 真条数出去」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotificationLog } from '../config/system-notifications.js';
import { GlobalSearchEngine, buildDefaultSources } from '../apps/memory/global-search-engine.js';
import {
    isDndOn, writeFlag, readShellScale, applyShellScale,
    musicControl, currentTrack, SYS_KEYS
} from '../config/system-controls.js';

// ============ 内存 storage（真实 shape：chatMetadata 域的字符串/对象混存）============
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        _map: map,
        get(k, d = null) { return map.has(k) ? map.get(k) : d; },
        set(k, v) { map.set(k, v); },
        remove(k) { map.delete(k); },
        keys() { return [...map.keys()]; }
    };
}

/** 真实形态 seed：每个键的存储形态都与写入端一致（字符串/对象/数组） */
function realSeed() {
    return {
        // 微信：主数据是 JSON 字符串；消息在独立分片键，也是 JSON 字符串
        wechat_data: JSON.stringify({
            userInfo: { name: '我' },
            contacts: [{ name: '林晚照', nickname: '晚照', remark: '大学同窗' }],
            chats: [
                { id: 'c1', name: '林晚照', type: 'single', timestamp: 1758000000000 },
                { id: 'c2', name: '大厅角色', type: 'single', timestamp: 1758000050000 }
            ],
            moments: [{
                name: '林晚照', text: '今天的云像糖', timestamp: 1758000100000,
                commentList: [{ name: '我', text: '确实甜' }]
            }]
        }),
        wechat_msg_c1: JSON.stringify([
            { from: '林晚照', content: '在吗，帮我看看这个', time: '10:00' }
        ]),
        // 大厅模式回落到 phone_wechat_msg_lobby_<chatId>
        wechat_msg_c2_lobby_placeholder: null,
        'phone_wechat_msg_lobby_c2': JSON.stringify([
            { from: '大厅角色', content: '大厅里的悄悄话', time: '11:00' }
        ]),
        // 日记
        diary_entries: [{ title: '雨天', date: '9月17日', content: '写了很久', author: '我', createdAt: 1758000200000 }],
        // 短信 / 通话
        phone_call_sms_conversations: [{
            name: '林晚照', updatedAt: 1758000300000,
            messages: [{ text: '短信正文', createdAt: 1758000300000 }]
        }],
        phone_call_history: [{
            id: 'r1', caller: '林晚照', time: '21:04', date: '9月17日', status: 'answered',
            transcript: [{ role: 'caller', content: '通话里的台词' }]
        }],
        // 织光机 / 日历 / 音乐
        tw_letters: [{ title: '第一封信', paragraphs: ['段一', '段二'], ts: 1758000400000 }],
        calendar_memos: [{ title: '体检', dateKey: '2026-09-20', time: '08:30', source: '手动', createdAt: 1758000500000 }],
        music_playlist: [{ name: '菊花台', artist: '周杰伦', album: '依然范特西' }],
        // 世界脉搏
        worldpulse_history_v1: [{ style: '温柔日常', content: '世界脉搏正文', floorCount: 128, createdAt: 1758000600000 }],
        // 微博
        weibo_hot_searches: [{ title: '热搜词条', tag: '爆' }],
        weibo_recommend_posts: [{ blogger: '某博主', content: '推荐帖正文', ts: 1758000700000 }],
        // 记忆（对象，非字符串）
        memory_core_v1: { longTerm: [{ content: '记忆正文', role: 'user', place: '图书馆' }] },
        // 阅读 / 成就 / 小红书 / 贴吧
        ruby_reading_shelf: [{ title: '书名', author: '作者', addedAt: 1758000800000, chapterCount: 42 }],
        ruby_unlocked_achievements: { ach_first: 1758000900000 },
        ruby_xhs_notes: [{ title: '笔记标题', content: '笔记正文', author: '我', ts: 1758001000000 }],
        ruby_tieba_posts: [{ title: '帖子标题', content: '帖子正文', author: '我', ts: 1758001100000 }],
        sys_notifs: [{ id: 'n1', title: '微信', message: '通知正文', ts: 1758001200000, meta: { name: '林晚照' }, appId: 'wechat' }]
    };
}

// ============================================================================
// 块 1：每个索引源在真实形态 seed 下必须产出 ≥1 条（防「键对了但字段错」）
// ============================================================================
test('v2161: 17 个索引源在真实形态 seed 下全部产出条目', () => {
    const gw = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    try {
        const storage = makeStorage(realSeed());
        const sources = buildDefaultSources(storage);
        const got = new Map();
        for (const s of sources) {
            let n = 0;
            try { n = (s.items() || []).length; } catch (e) { n = -1; }
            got.set(s.id, n);
        }
        // 期望有产出的源（tavern 需注入 chatContext，单独测）
        const mustNonEmpty = [
            'wechat-chat', 'wechat-moments', 'diary', 'phone-sms', 'phone-call',
            'timeweaver', 'calendar', 'music', 'worldpulse', 'weibo',
            'memory', 'reading', 'achievement', 'xhs', 'tieba', 'notifications'
        ];
        const empty = mustNonEmpty.filter(id => !(got.get(id) > 0));
        assert.deepEqual(empty, [], '以下源在真实数据下读空（死代码）：' + JSON.stringify(empty) +
            ' 实测条数=' + JSON.stringify([...got]));
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
});

// ============================================================================
// 块 2：端到端检索——真实数据能被搜到，且命中挑对源
// ============================================================================
test('v2161: 端到端检索命中真实数据（跨源）', () => {
    const gw = globalThis.window;
    globalThis.window = { VirtualPhone: {} };
    try {
        const storage = makeStorage(realSeed());
        const eng = new GlobalSearchEngine({ sources: buildDefaultSources(storage) });
        const cases = [
            ['帮我看看这个', 'wechat-chat'],       // 微信消息分片
            ['大厅里的悄悄话', 'wechat-chat'],      // 大厅分片回落
            ['今天的云像糖', 'wechat-moments'],    // 朋友圈正文
            ['确实甜', 'wechat-moments'],          // 朋友圈评论
            ['写了很久', 'diary'],
            ['短信正文', 'phone-sms'],
            ['通话里的台词', 'phone-call'],        // transcript 元素
            ['段一', 'timeweaver'],
            ['体检', 'calendar'],
            ['菊花台', 'music'],
            ['世界脉搏正文', 'worldpulse'],
            ['热搜词条', 'weibo'],
            ['推荐帖正文', 'weibo'],
            ['记忆正文', 'memory'],
            ['书名', 'reading'],
            ['笔记正文', 'xhs'],
            ['帖子正文', 'tieba'],
            ['通知正文', 'notifications']
        ];
        for (const [q, expectSrc] of cases) {
            const { results } = eng.query(q);
            assert.ok(results.length > 0, `查询「${q}」零命中`);
            const srcs = results.map(h => h.sourceId);
            assert.ok(srcs.includes(expectSrc),
                `查询「${q}」未命中预期源 ${expectSrc}，实际源=${JSON.stringify([...new Set(srcs)])}`);
        }
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
});

// ============================================================================
// 块 3：成就目录（id → 名称）经 window.VirtualPhone.achievementApp 补全
// ============================================================================
test('v2161: 成就映射经目录补全名称，缺目录时回落只索引 id', () => {
    const gw = globalThis.window;
    try {
        // 有目录
        globalThis.window = {
            VirtualPhone: {
                achievementApp: { data: { achievementsCatalog: [{ id: 'ach_first', name: '初见', cat: '剧情', intro: '第一次见面' }] } }
            }
        };
        let storage = makeStorage(realSeed());
        let src = buildDefaultSources(storage).find(s => s.id === 'achievement');
        let items = src.items();
        assert.equal(items.length, 1);
        assert.equal(items[0].title, '初见');
        assert.ok(items[0].body.includes('剧情'));

        // 无目录：只索引 id，且不能崩
        globalThis.window = { VirtualPhone: {} };
        storage = makeStorage(realSeed());
        src = buildDefaultSources(storage).find(s => s.id === 'achievement');
        items = src.items();
        assert.equal(items.length, 1);
        assert.equal(items[0].title, 'ach_first');
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
});

// ============================================================================
// 块 4：酒馆楼层注入（chatContext）才出现 tavern 源，且楼号从 1 起
// ============================================================================
test('v2161: 注入 chatContext 才出现酒馆正文源', () => {
    const storage = makeStorage(realSeed());
    const noCtx = buildDefaultSources(storage).map(s => s.id);
    assert.ok(!noCtx.includes('tavern'));

    const withCtx = buildDefaultSources(storage, {
        chatContext: { chat: [{ is_user: true, mes: '第一楼正文' }, { name: '林晚照', mes: '第二楼正文' }] }
    });
    const src = withCtx.find(s => s.id === 'tavern');
    assert.ok(src, '注入 chatContext 后应有 tavern 源');
    const items = src.items();
    assert.equal(items.length, 2);
    assert.ok(items[0].title.includes('第 1 楼'));
    assert.ok(items[1].title.includes('第 2 楼'));
    assert.equal(items[1].body, '第二楼正文');
});

// ============================================================================
// 块 5：坏源隔离——某源 items() 抛异常不得拖垮整体
// ============================================================================
test('v2161: 单个源抛异常时其余源仍可检索并上报 lastErrors', () => {
    const storage = makeStorage(realSeed());
    const sources = buildDefaultSources(storage);
    sources.push({ id: 'boom', label: '炸源', items: () => { throw new Error('boom'); } });
    const eng = new GlobalSearchEngine({ sources });
    const { results } = eng.query('菊花台');
    assert.ok(results.length > 0, '坏源存在时好源必须仍可用');
    const errs = eng.lastErrors();
    assert.ok(errs.some(e => String(e.id || e.sourceId || '').includes('boom') || String(e.error || e.message || '').includes('boom')),
        'lastErrors 应记录坏源：' + JSON.stringify(errs));
});

// ============================================================================
// 块 6：落账 + 控制内核 + 锁屏数据流的组合真实性
// ============================================================================
test('v2161: 通知落账后立即可被搜索源读到（同一 storage 真源）', () => {
    const storage = makeStorage({});
    const log = new NotificationLog(storage);   // 真实契约：第一参为 storage 本体
    log.push({ title: '微信', message: '落账后可检索的内容', senderKey: 'wechat:林晚照', icon: '💬' });
    log.flushNow();
    const raw = storage.get('sys_notifs');
    assert.ok(Array.isArray(raw) && raw.length === 1, '必须已落盘到 sys_notifs');

    const src = buildDefaultSources(storage).find(s => s.id === 'notifications');
    const items = src.items();
    assert.equal(items.length, 1);
    assert.ok(items[0].body.includes('落账后可检索的内容'));
});

test('v2161: DND 打开时落账仍入账（只拦横幅不丢历史）', async () => {
    const storage = makeStorage({});
    await writeFlag(storage, SYS_KEYS.DND, true);
    assert.equal(isDndOn(storage), true);
    const log = new NotificationLog(storage);
    log.push({ title: 'A', message: '免打扰期间的通知', senderKey: 'k1' });
    log.flushNow();
    assert.equal(log.list().length, 1, '免打扰不得阻断落账');
});

test('v2161: 缩放写入后 readShellScale 与 DOM 应用结果一致（状态与效果分离）', async () => {
    const storage = makeStorage({});
    const ret = await applyShellScale(storage, 120);
    assert.equal(ret.percent, 120, '返回 {percent, applied}，percent 为归一化值');
    assert.equal(readShellScale(storage), 120, '无论 DOM 是否可用都必须落盘');
    // 钳制边界
    const ret2 = await applyShellScale(storage, 999);
    assert.equal(ret2.percent, 120, '超出上限应钳到 120');
    assert.equal(readShellScale(storage), 120);
    await applyShellScale(storage, 1);
    assert.equal(readShellScale(storage), 80, '低于下限应钳到 80');
});

test('v2161: 控制中心音乐卡走真实 MusicData 接口序列', () => {
    const gw = globalThis.window;
    const calls = [];
    const fakeData = {
        isPlaying: false,
        audioPlayer: { paused: true },
        next() { calls.push('next'); },
        prev() { calls.push('prev'); },
        pause() { calls.push('pause'); this.isPlaying = false; },
        resume() { calls.push('resume'); this.isPlaying = true; },
        getCurrentSong() { return { name: '菊花台', artist: '周杰伦' }; },
        getActiveList() { return []; }
    };
    globalThis.window = { VirtualPhone: { musicApp: { musicData: fakeData } } };
    try {
        musicControl('next');
        musicControl('prev');
        musicControl('toggle');   // 当前未播放 → resume
        fakeData.isPlaying = true;
        musicControl('toggle');   // 正在播放 → pause
        assert.deepEqual(calls, ['next', 'prev', 'resume', 'pause']);
        const t = currentTrack();
        assert.equal(t.title, '菊花台');
        assert.equal(t.artist, '周杰伦');
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
});
