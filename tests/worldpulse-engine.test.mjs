// worldpulse-engine.js 单元测试（纯函数）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WP_STYLES, defaultSettings, shouldTrigger, enqueue,
    buildEventPrompt, sanitizeEvent, pushHistory, recentStoryDigest
} from '../apps/worldpulse/worldpulse-engine.js';

test('wp: defaultSettings 完整', () => {
    const s = defaultSettings();
    assert.equal(s.enabled, true);
    assert.equal(s.autoGenerate, true);
    assert.equal(s.threshold, 5);
    assert.equal(s.maxQueueSize, 10);
    assert.ok(s.style in WP_STYLES);
});

test('wp: shouldTrigger 阈值判定', () => {
    assert.equal(shouldTrigger(0, 5, 5), true);
    assert.equal(shouldTrigger(0, 4, 5), false);
    assert.equal(shouldTrigger(10, 16, 5), true);
    assert.equal(shouldTrigger(10, 12, 5), false);
    assert.equal(shouldTrigger(10, 8, 5), false, '楼层回退不触发');
    assert.equal(shouldTrigger(0, 3, 0), false, '非法阈值回退默认5，delta3<5不触发');
    assert.equal(shouldTrigger(0, 6, 0), true, '非法阈值回退默认5，delta6>=5触发');
});

test('wp: enqueue 容量上限丢最旧', () => {
    let q = [];
    for (let i = 0; i < 12; i++) q = enqueue(q, { style: '都市日常', floorCount: i }, 10);
    assert.equal(q.length, 10);
    assert.equal(q[0].floorCount, 2, '最旧的(0,1)应被丢弃');
    assert.equal(q[9].floorCount, 11);
});

test('wp: buildEventPrompt 预设风格含风格基调与硬规则', () => {
    const p = buildEventPrompt('财经头条', '', '用户：买了股票');
    assert.ok(p.includes('财经头条'));
    assert.ok(p.includes('商业'));
    assert.ok(p.includes('手机推送'));
    assert.ok(p.includes('买了股票'), '应带剧情参考');
});

test('wp: buildEventPrompt 自定义风格前缀直通', () => {
    const p = buildEventPrompt('自定义', '只写一句猫的日常', '');
    assert.equal(p, '只写一句猫的日常');
    const p2 = buildEventPrompt('自定义', '', '');
    assert.ok(p2.includes('平行事件生成器'), '空前缀回退默认');
});

test('wp: sanitizeEvent 剥 think/前缀/引号/截断', () => {
    const raw = '<think>思考中</think>快讯：「某公司发布新品，引发热议」';
    const out = sanitizeEvent(raw);
    assert.ok(!out.includes('think'), '剥 think');
    assert.ok(!out.startsWith('快讯：'), '剥前缀');
    assert.ok(!/^["'「『]/.test(out), '剥引号');
    const long = sanitizeEvent('字'.repeat(300));
    assert.ok(long.length <= 201, '截断上限');
});

test('wp: sanitizeEvent 多段只留首段', () => {
    const out = sanitizeEvent('第一条动态。\n\n第二条不该出现。');
    assert.ok(!out.includes('第二条'), '只留首段');
});

test('wp: pushHistory 入册+上限截断', () => {
    let h = [];
    h = pushHistory(h, { style: '都市日常', content: '事件A', floorCount: 1 });
    assert.equal(h.length, 1);
    assert.equal(h[0].content, '事件A');
    for (let i = 0; i < 70; i++) h = pushHistory(h, { style: 'x', content: 'e' + i });
    assert.equal(h.length, 60, '历史上限60');
    h = pushHistory(h, { style: 'x', content: '' });
    assert.equal(h.length, 60, '空内容不入册');
});

test('wp: recentStoryDigest 剥标签+截长', () => {
    const ctx = {
        name1: '用户', name2: '角色',
        chat: [
            { is_user: true, mes: '<b>今天</b>去公园' },
            { is_user: false, name: '角色', mes: '好啊' + '长'.repeat(200) }
        ]
    };
    const out = recentStoryDigest(ctx, 5);
    assert.ok(out.includes('用户：今天去公园'), '剥标签');
    const roleLine = out.split('\n').find(l => l.startsWith('角色：'));
    assert.ok(roleLine.length <= 130, '单条内容截长');
});

test('wp: recentStoryDigest 异常容错', () => {
    assert.equal(recentStoryDigest(null), '');
    assert.equal(recentStoryDigest({ chat: 'not-array' }), '');
});