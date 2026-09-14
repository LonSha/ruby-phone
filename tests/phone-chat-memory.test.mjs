// phone-chat-memory.js 单元测试（mock storage / apiManager）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getAllMemories, getMemory, setMemory,
    recentPhoneHistory, recentStoryContext,
    phoneReplySystemPrompt, buildReplyPrompt, updateMemory
} from '../config/phone-chat-memory.js';

class MockStorage {
    constructor() { this.d = {}; }
    get(k) { return this.d[k] ?? null; }
    set(k, v) { this.d[k] = v; }
}

test('pcm: set/get 记忆，空串删除', () => {
    const s = new MockStorage();
    assert.equal(getMemory(s, 'c1'), '');
    setMemory(s, 'c1', '喜欢吃辣，叫我阿May');
    assert.equal(getMemory(s, 'c1'), '喜欢吃辣，叫我阿May');
    setMemory(s, 'c1', '');
    assert.equal(getMemory(s, 'c1'), '');
});

test('pcm: getAllMemories 容错脏数据', () => {
    const s = new MockStorage();
    s.d['wechat_contact_memory_v1'] = '{broken json';
    assert.deepEqual(getAllMemories(s), {});
    s.d['wechat_contact_memory_v1'] = JSON.stringify(['not object']);
    assert.deepEqual(getAllMemories(s), {});
});

test('pcm: recentPhoneHistory 只留 send/recv 并格式化', () => {
    const logs = [
        { role: 'send', name: 'x', content: '你好' },
        { role: 'system', name: '', content: '对方撤回' },
        { role: 'recv', name: '张三', content: '你好呀' }
    ];
    const out = recentPhoneHistory(logs, '我');
    assert.ok(!out.includes('系统：'), 'system 行应被过滤');
    assert.ok(out.includes('我：你好'));
    assert.ok(out.includes('张三：你好呀'));
});

test('pcm: recentStoryContext 剥标签拼接', () => {
    const ctx = {
        name1: '用户', name2: '角色',
        chat: [
            { is_user: true, mes: '<pyq>动态</pyq>今天天气好' },
            { is_user: false, name: '角色', mes: '[char消息: 在忙]嗯嗯' }
        ]
    };
    const out = recentStoryContext(ctx, 5);
    // <[^>]*> 只剥尖括号标签本身，<pyq>动态</pyq> 的内容「动态」会保留并拼接进正文
    assert.ok(out.includes('用户：动态今天天气好'), '剥标签保留内容拼接');
    assert.ok(!out.includes('<pyq>'), 'HTML 尖括号标签应剥除');
    // 角色消息 [char消息: 在忙]嗯嗯 剥标签后只剩「嗯嗯」（2字），被 length>3 过滤
    assert.ok(!out.includes('嗯嗯'), '过短消息应被过滤');
});

test('pcm: systemPrompt 含硬规则', () => {
    const p = phoneReplySystemPrompt();
    assert.ok(p.includes('手机聊天'));
    assert.ok(p.includes('1-3 句'));
});

test('pcm: buildReplyPrompt 单聊模式', () => {
    const s = new MockStorage();
    setMemory(s, 'c1', '上次约好周末看电影');
    const prompt = buildReplyPrompt({
        storage: s, contactId: 'c1', contactName: '阿May', isGroup: false,
        logs: [{ role: 'recv', name: '阿May', content: '记得带票' }],
        userName: '我', newText: '买好票了', storyCtx: ''
    });
    assert.ok(prompt.includes('周末看电影'), '应注入长期记忆');
    assert.ok(prompt.includes('记得带票'));
    assert.ok(prompt.includes('买好票了'));
    assert.ok(prompt.includes('阿May'));
});

test('pcm: buildReplyPrompt 群聊模式带成员', () => {
    const s = new MockStorage();
    const prompt = buildReplyPrompt({
        storage: s, contactId: 'group:1', isGroup: true,
        groupName: '周末局', groupMembers: ['A', 'B'],
        logs: [], userName: '我', newText: 'hi', storyCtx: ''
    });
    assert.ok(prompt.includes('周末局'));
    assert.ok(prompt.includes('A, B'));
    assert.ok(prompt.includes('角色名：回复内容'));
});

test('pcm: updateMemory 走 API 成功路径', async () => {
    const s = new MockStorage();
    const am = { callAI: async () => ({ success: true, summary: '关系升温，约定下周见' }) };
    const out = await updateMemory({
        storage: s, apiManager: am, contactId: 'c1',
        logs: [], userName: '我', userText: '见个面？', replyText: '好啊下周'
    });
    assert.equal(out, '关系升温，约定下周见');
    assert.equal(getMemory(s, 'c1'), '关系升温，约定下周见');
});

test('pcm: updateMemory API 失败降级拼接截断', async () => {
    const s = new MockStorage();
    setMemory(s, 'c1', '旧记忆');
    const am = { callAI: async () => ({ success: false, error: 'x' }) };
    const out = await updateMemory({
        storage: s, apiManager: am, contactId: 'c1',
        logs: [], userName: '我', userText: '在吗', replyText: '在'
    });
    assert.ok(out.includes('旧记忆'), '降级应保留旧摘要');
    assert.ok(out.includes('在吗'), '降级应拼最近一轮');
    assert.ok(out.length <= 1200, '降级应截断上限');
});

test('pcm: updateMemory 无 API 直接降级', async () => {
    const s = new MockStorage();
    const out = await updateMemory({
        storage: s, apiManager: null, contactId: 'c1',
        logs: [], userName: '我', userText: 'hi', replyText: 'hello'
    });
    assert.ok(out.includes('hi'));
});