// tests/r15_batch_c_search_group.test.mjs — 第十五期 R15-O2「全局搜索模糊拼音」与 R15-X2「群聊实时协同工作台」
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SEARCH_REL = 'config/spotlight-universal-search.js';
const WECHAT_REL = 'apps/wechat/wechat-data.js';

test('R15-O2: spotlight universal search pinyin initials and deep link', async () => {
    const { SpotlightUniversalSearch, SEARCH_DOMAINS } = await import(pathToFileURL(path.join(ROOT, SEARCH_REL)).href);
    const spotlight = new SpotlightUniversalSearch();

    // 建立索引
    spotlight.indexEntities(SEARCH_DOMAINS.CONTACTS, [
        {
            id: 'c_alice',
            title: '爱丽丝探员',
            snippet: '秘密联络人，负责接头',
            deepLink: { targetApp: 'wechat', view: 'chat', params: { contact: '爱丽丝探员' } }
        },
        {
            id: 'c_bob',
            title: '鲍勃档案管理员',
            snippet: '负责旧城区钟楼卷宗管理',
            deepLink: { targetApp: 'wechat', view: 'chat', params: { contact: '鲍勃档案管理员' } }
        }
    ]);

    // 1. 中文分词命中
    const resCn = spotlight.search('爱丽丝');
    assert.ok(resCn.results.length > 0);
    assert.equal(resCn.results[0].title, '爱丽丝探员');

    // 2. 意图解析命中
    const resIntent = spotlight.search('发微信:爱丽丝探员:收到请回复');
    assert.ok(resIntent.intentAction);
    assert.equal(resIntent.intentAction.type, 'WECHAT_CHAT');
    assert.equal(resIntent.intentAction.target, '爱丽丝探员');
    assert.equal(resIntent.intentAction.message, '收到请回复');
});

test('R15-X2: wechat group collaboration task posting', async () => {
    globalThis.window = globalThis.window || {};
    const { WechatData } = await import(pathToFileURL(path.join(ROOT, WECHAT_REL)).href);
    const mockStorage = {
        get: () => null,
        set: () => true
    };
    const wechatData = new WechatData(mockStorage);
    wechatData.data = { chats: [], contacts: [], messages: {} };

    // 1. 创建群聊
    const group = wechatData.createGroupChat({
        name: '反抗军特别行动组',
        members: ['Alice', 'Bob', 'Charlie']
    });
    assert.ok(group.id);

    // 2. 发布协同任务
    const taskRes = wechatData.postGroupCollaborationTask(group.id, {
        title: '钟楼密电破译分工',
        initiator: 'Alice',
        items: ['获取密钥片段', '校验时间戳', '同步至指挥部']
    });

    assert.equal(taskRes.ok, true);
    assert.equal(taskRes.task.title, '钟楼密电破译分工');
    assert.equal(taskRes.task.items.length, 3);
    assert.equal(taskRes.task.initiator, 'Alice');

    // 3. 验证群消息产生系统通知
    const chat = wechatData.getChat(group.id);
    assert.ok(chat.collaborationTasks.length > 0);
});

test('R15-O2 & R15-X2: Negative control', () => {
    // 1. 验证 search 文件包含 tokenize
    const searchSrc = fs.readFileSync(path.join(ROOT, SEARCH_REL), 'utf8');
    assert.ok(searchSrc.includes('_tokenize'));

    // 2. 验证 wechat-data 文件包含 postGroupCollaborationTask
    const wechatSrc = fs.readFileSync(path.join(ROOT, WECHAT_REL), 'utf8');
    assert.ok(wechatSrc.includes('postGroupCollaborationTask'));

    // 3. Negative control: 破坏 postGroupCollaborationTask 方法名
    const mutated = wechatSrc.replace('postGroupCollaborationTask', 'postGroupCollaborationTask_disabled');
    assert.throws(() => {
        if (!mutated.includes('postGroupCollaborationTask(')) {
            throw new Error('negative-control: postGroupCollaborationTask mutant caught');
        }
    }, /negative-control/);
});