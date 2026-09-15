import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs
    .readFileSync(new URL('../config/image-generation-manager.js', import.meta.url), 'utf8')
    .replace(
        "import { decompress as decompressZstd } from '../assets/vendor/fzstd.js';",
        'const decompressZstd = () => new Uint8Array();'
    );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { ImageGenerationManager } = await import(moduleUrl);

const createManager = (storageData = {}) => {
    const storage = {
        data: { ...storageData },
        get(key) { return this.data[key]; },
        async set(key, value) { this.data[key] = value; }
    };
    return new ImageGenerationManager(storage);
};

// 简易 fetch 拦截：按 URL 前缀分派到处理器
const installFetch = (handlers) => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input?.url || input || '');
        calls.push({ url, init });
        for (const [pattern, handler] of handlers) {
            if (url.includes(pattern)) {
                return handler({ url, init });
            }
        }
        return new Response(JSON.stringify({ error: 'no handler' }), { status: 404 });
    };
    return {
        calls,
        restore() { globalThis.fetch = original; }
    };
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

test('manager 允许 runninghub 作为 provider', () => {
    const m = createManager({ 'phone-image-provider': 'runninghub' });
    assert.equal(m.resolveProvider({ provider: 'runninghub' }), 'runninghub');
    assert.equal(m.resolveProvider({}), 'runninghub');
    assert.equal(m.resolveProvider({ provider: 'novelai' }), 'novelai');
});

test('runninghub 出现在 app 绑定白名单中', () => {
    const m = createManager({ 'phone-image-provider-app-bindings': JSON.stringify({ wechat: 'runninghub' }) });
    assert.equal(m.getBoundProviderForApp('wechat'), 'runninghub');
    assert.equal(m.getBoundProviderForApp('honey'), '');
    // 非法 provider 仍被拒绝
    const m2 = createManager({ 'phone-image-provider-app-bindings': JSON.stringify({ wechat: 'foo' }) });
    assert.equal(m2.getBoundProviderForApp('wechat'), '');
});

test('getConfig 解析 runninghub 相关字段与默认值', () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid-1',
        'phone-image-runninghub-instance-type': 'gpu_4090',
        'phone-image-runninghub-duration': 10,
        'phone-image-runninghub-steps': 25
    });
    const cfg = m.getConfig({ provider: 'runninghub', app: 'wechat' });
    assert.equal(cfg.provider, 'runninghub');
    assert.equal(cfg.apiKey, 'rh-secret');
    assert.equal(cfg.runninghubWorkflowId, 'wf-uuid-1');
    assert.equal(cfg.runninghubInstanceType, 'gpu_4090');
    assert.equal(cfg.runninghubDuration, 10);
    assert.equal(cfg.runninghubSteps, 25);
});

test('getConfig runninghub 字段缺失时回落到默认值', () => {
    const m = createManager({});
    const cfg = m.getConfig({ provider: 'runninghub', app: 'wechat' });
    assert.equal(cfg.runninghubWorkflowId, '');
    assert.equal(cfg.runninghubInstanceType, 'default');
    assert.equal(cfg.runninghubDuration, 5);
    assert.equal(cfg.runninghubSteps, 30);
});

test('getConfig apiKey 走 phone-image-runninghub-key', () => {
    const m = createManager({ 'phone-image-runninghub-key': 'rh-from-storage' });
    const cfg = m.getConfig({ provider: 'runninghub' });
    assert.equal(cfg.apiKey, 'rh-from-storage');
});

test('_normalizeRunningHubWorkflow 解析 JSON 字符串', () => {
    const m = createManager({});
    const nodes = m._normalizeRunningHubWorkflow('{"6":{"class_type":"LoadImage","inputs":{"image":"x.png"}}}');
    assert.equal(nodes['6'].class_type, 'LoadImage');
});

test('_normalizeRunningHubWorkflow 对象直通', () => {
    const m = createManager({});
    const obj = { 6: { class_type: 'LoadImage', inputs: { image: 'x.png' } } };
    assert.deepEqual(m._normalizeRunningHubWorkflow(obj), obj);
});

test('_normalizeRunningHubWorkflow 空串返回空对象', () => {
    const m = createManager({});
    assert.deepEqual(m._normalizeRunningHubWorkflow(''), {});
});

test('_normalizeRunningHubWorkflow 非法 JSON 抛错', () => {
    const m = createManager({});
    assert.throws(() => m._normalizeRunningHubWorkflow('{invalid json'), /不是合法的 JSON/);
});

test('_extractRunningHubNodeInfoList 提取可覆盖的文本参数', () => {
    const m = createManager({});
    const nodes = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece' } },
        '2': { class_type: 'LoadImage', inputs: { image: 'sample.png' } },
        '3': { class_type: 'KSampler', inputs: { seed: 12345, steps: 20, cfg: 7 } }
    };
    const list = m._extractRunningHubNodeInfoList(nodes);
    const keys = list.map(item => `${item.nodeId}.${item.fieldName}`).sort();
    assert.deepEqual(keys, ['1.text', '2.image', '3.seed', '3.steps'].sort());
});

test('_extractRunningHubNodeInfoList 跳过连接引用', () => {
    const m = createManager({});
    const nodes = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: ['2', 0] } }
    };
    assert.equal(m._extractRunningHubNodeInfoList(nodes).length, 0);
});

test('_extractRunningHubNodeInfoList 无 inputs 节点被忽略', () => {
    const m = createManager({});
    assert.equal(m._extractRunningHubNodeInfoList({ '1': { class_type: 'X' } }).length, 0);
});

test('_resolveRunningHubNodeInfoList 优先使用显式传入', () => {
    const m = createManager({
        'phone-image-runninghub-node-info-list': JSON.stringify([{ nodeId: 'stored', fieldName: 'text', value: 'stored-v' }])
    });
    const list = m._resolveRunningHubNodeInfoList({
        runninghubNodeInfoList: [{ nodeId: 'live', fieldName: 'text', value: 'live-v' }]
    });
    assert.equal(list.length, 1);
    assert.equal(list[0].nodeId, 'live');
    assert.equal(list[0].value, 'live-v');
});

test('_resolveRunningHubNodeInfoList 回落到持久化表', () => {
    const m = createManager({
        'phone-image-runninghub-node-info-list': JSON.stringify([
            { nodeId: 'stored', fieldName: 'text', value: 'stored-v' },
            { nodeId: '', fieldName: 'text', value: 'bad' }
        ])
    });
    const list = m._resolveRunningHubNodeInfoList({});
    assert.equal(list.length, 1);
    assert.equal(list[0].nodeId, 'stored');
});

test('_resolveRunningHubNodeInfoList 持久化表非法时回落空数组', () => {
    const m = createManager({ 'phone-image-runninghub-node-info-list': '{not-json' });
    assert.deepEqual(m._resolveRunningHubNodeInfoList({}), []);
});

test('_resolveRunningHubNodeInfoList 容忍非数组持久化值', () => {
    const m = createManager({ 'phone-image-runninghub-node-info-list': JSON.stringify({ a: 1 }) });
    assert.deepEqual(m._resolveRunningHubNodeInfoList({}), []);
});

test('_buildRunningHubPayload 生成任务请求体', () => {
    const m = createManager({});
    const { workflowId, payload } = m._buildRunningHubPayload({
        workflowId: 'wf-1',
        nodeInfoList: [{ nodeId: '1', fieldName: 'text', value: 'hello' }],
        instanceType: 'gpu_4090'
    });
    assert.equal(workflowId, 'wf-1');
    assert.equal(payload.instanceType, 'gpu_4090');
    assert.equal(payload.addMetadata, true);
    assert.equal(payload.usePersonalQueue, false);
    assert.equal(payload.nodeInfoList.length, 1);
    assert.equal(payload.nodeInfoList[0].value, 'hello');
});

test('_buildRunningHubPayload instanceType 空值回落 default', () => {
    const m = createManager({});
    const { payload } = m._buildRunningHubPayload({
        workflowId: 'wf-1',
        nodeInfoList: [],
        instanceType: ''
    });
    assert.equal(payload.instanceType, 'default');
});

test('_buildRunningHubPayload nodeInfoList 非数组时容错', () => {
    const m = createManager({});
    const { payload } = m._buildRunningHubPayload({ workflowId: 'wf-1', nodeInfoList: null });
    assert.deepEqual(payload.nodeInfoList, []);
});

test('_extractRunningHubOutputUrl 取首个结果 url', () => {
    const m = createManager({});
    assert.equal(m._extractRunningHubOutputUrl({ results: [{ url: 'https://a.com/1.mp4' }, { url: 'https://b.com/2.mp4' }] }), 'https://a.com/1.mp4');
});

test('_extractRunningHubOutputUrl 无结果返回空串', () => {
    const m = createManager({});
    assert.equal(m._extractRunningHubOutputUrl({ results: [] }), '');
    assert.equal(m._extractRunningHubOutputUrl({}), '');
});

test('generate 缺 key 抛错', async () => {
    const m = createManager({
        'phone-image-runninghub-workflow-id': 'wf-1',
        'phone-image-enabled': true
    });
    await assert.rejects(
        () => m.generate({ provider: 'runninghub', prompt: 'x', ignoreEnabled: true }),
        /API Key/
    );
});

test('generate 缺 workflowId 抛错', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-enabled': true
    });
    await assert.rejects(
        () => m.generate({ provider: 'runninghub', prompt: 'x', ignoreEnabled: true }),
        /请先填写 RunningHub Workflow ID/
    );
});

test('generate 走通建任务→轮询→下载视频链路', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid',
        'phone-image-runninghub-seed': 42,
        'phone-image-runninghub-steps': 20
    });
    let queryCount = 0;
    const ctx = installFetch([
        ['run/workflow', () => json({ taskId: 'task-1' })],
        ['openapi/v2/query', () => {
            queryCount += 1;
            if (queryCount < 2) return json({ status: 'QUEUED' });
            return json({ status: 'SUCCESS', results: [{ url: 'https://cdn.runninghub.ai/out/1.mp4' }] });
        }],
        ['cdn.runninghub.ai', () => new Response('fake-mp4-body', { status: 200, headers: { 'Content-Type': 'video/mp4' } })]
    ]);
    try {
        // 轮询间隔为 3000ms，测试中临时改小
        Object.defineProperty(m, 'RUNNINGHUB_POLL_INTERVAL_MS', { value: 1, writable: true, configurable: true });
        const result = await m.generate({ provider: 'runninghub', prompt: 'a girl', ignoreEnabled: true });
        assert.equal(result.provider, 'runninghub');
        assert.equal(result.mediaType, 'video');
        assert.equal(result.model, 'wf-uuid');
        assert.equal(result.seed, 42);
        assert.equal(result.steps, 20);
        assert.ok(Number(result.videoBlob?.size || 0) > 0);
        assert.equal(result.videoUrl, 'https://cdn.runninghub.ai/out/1.mp4');
        // 建任务请求携带 Bearer 鉴权
        const createCall = ctx.calls.find(c => c.url.includes('run/workflow'));
        assert.equal(createCall.init.headers.Authorization, 'Bearer rh-secret');
        const queryCall = ctx.calls.find(c => c.url.includes('openapi/v2/query'));
        assert.equal(queryCall.init.headers.Authorization, 'Bearer rh-secret');
        assert.ok(queryCount >= 2);
    } finally {
        ctx.restore();
    }
});

test('generate 任务失败时抛错', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid'
    });
    const ctx = installFetch([
        ['run/workflow', () => json({ taskId: 'task-2' })],
        ['openapi/v2/query', () => json({ status: 'FAILED', errorMessage: 'GPU 繁忙' })]
    ]);
    try {
        Object.defineProperty(m, 'RUNNINGHUB_POLL_INTERVAL_MS', { value: 1, writable: true, configurable: true });
        await assert.rejects(
            () => m.generate({ provider: 'runninghub', prompt: 'a girl', ignoreEnabled: true }),
            /RunningHub 任务失败：GPU 繁忙/
        );
    } finally {
        ctx.restore();
    }
});

test('generate 建任务无 taskId 时抛错', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid'
    });
    const ctx = installFetch([
        ['run/workflow', () => json({ errorMessage: 'workflow not found' })]
    ]);
    try {
        await assert.rejects(
            () => m.generate({ provider: 'runninghub', prompt: 'a girl', ignoreEnabled: true }),
            /创建任务失败/
        );
    } finally {
        ctx.restore();
    }
});

test('generate 成功但无输出 url 时抛错', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid'
    });
    const ctx = installFetch([
        ['run/workflow', () => json({ taskId: 'task-3' })],
        ['openapi/v2/query', () => json({ status: 'SUCCESS', results: [] })]
    ]);
    try {
        Object.defineProperty(m, 'RUNNINGHUB_POLL_INTERVAL_MS', { value: 1, writable: true, configurable: true });
        await assert.rejects(
            () => m.generate({ provider: 'runninghub', prompt: 'a girl', ignoreEnabled: true }),
            /任务成功但未返回输出文件/
        );
    } finally {
        ctx.restore();
    }
});

test('generate seed 为 -1 时随机生成', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid',
        'phone-image-runninghub-seed': -1
    });
    const seeds = new Set();
    const ctx = installFetch([
        ['run/workflow', () => json({ taskId: 'task-4' })],
        ['openapi/v2/query', () => json({ status: 'SUCCESS', results: [{ url: 'https://cdn.runninghub.ai/out/x.mp4' }] })],
        ['cdn.runninghub.ai', () => new Response('mp4', { status: 200, headers: { 'Content-Type': 'video/mp4' } })]
    ]);
    try {
        Object.defineProperty(m, 'RUNNINGHUB_POLL_INTERVAL_MS', { value: 1, writable: true, configurable: true });
        for (let i = 0; i < 5; i++) {
            const r = await m.generate({ provider: 'runninghub', prompt: 'a', ignoreEnabled: true });
            seeds.add(r.seed);
        }
        assert.ok(seeds.size > 1, '随机 seed 应产生多个不同值');
    } finally {
        ctx.restore();
    }
});

test('generate 图片类结果走 imageData 分支', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid'
    });
    const ctx = installFetch([
        ['run/workflow', () => json({ taskId: 'task-5' })],
        ['openapi/v2/query', () => json({ status: 'SUCCESS', results: [{ url: 'https://cdn.runninghub.ai/out/pic.png' }] })],
        ['cdn.runninghub.ai', () => new Response('png-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } })]
    ]);
    try {
        Object.defineProperty(m, 'RUNNINGHUB_POLL_INTERVAL_MS', { value: 1, writable: true, configurable: true });
        const r = await m.generate({ provider: 'runninghub', prompt: 'a', ignoreEnabled: true });
        assert.equal(r.mediaType, 'image');
        assert.equal(r.imageUrl, r.imageData);
    } finally {
        ctx.restore();
    }
});

test('prompt 注入到节点覆盖表', async () => {
    const m = createManager({
        'phone-image-runninghub-key': 'rh-secret',
        'phone-image-runninghub-workflow-id': 'wf-uuid',
        'phone-image-runninghub-node-info-list': JSON.stringify([
            { nodeId: '1', fieldName: 'text', value: 'original' },
            { nodeId: '3', fieldName: 'seed', value: 999 }
        ])
    });
    let capturedPayload = null;
    const ctx = installFetch([
        ['run/workflow', ({ init }) => {
            capturedPayload = JSON.parse(init.body);
            return json({ taskId: 'task-6' });
        }],
        ['openapi/v2/query', () => json({ status: 'SUCCESS', results: [{ url: 'https://cdn.runninghub.ai/out/v.mp4' }] })],
        ['cdn.runninghub.ai', () => new Response('mp4', { status: 200, headers: { 'Content-Type': 'video/mp4' } })]
    ]);
    try {
        Object.defineProperty(m, 'RUNNINGHUB_POLL_INTERVAL_MS', { value: 1, writable: true, configurable: true });
        await m.generate({ provider: 'runninghub', prompt: 'beautiful sky', ignoreEnabled: true });
        const textNode = capturedPayload.nodeInfoList.find(i => i.nodeId === '1');
        const seedNode = capturedPayload.nodeInfoList.find(i => i.nodeId === '3');
        assert.equal(textNode.value, 'beautiful sky');
        assert.equal(seedNode.value, 999); // 未配置覆盖的字段保持原值
    } finally {
        ctx.restore();
    }
});

test('未实现的 provider 仍抛不支持', async () => {
    const m = createManager({ 'phone-image-provider': 'foo', 'phone-image-enabled': true });
    await assert.rejects(
        () => m.generate({ prompt: 'x', ignoreEnabled: true }),
        /暂不支持的生图服务商/
    );
});

test('settings-app 与 chat-view 含 runninghub 接线', () => {
    const settingsSource = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
    assert.ok(settingsSource.includes('phone-image-runninghub-key'), 'settings 应有 runninghub key 输入框');
    assert.ok(settingsSource.includes('phone-image-runninghub-workflow-id'), 'settings 应有 workflow id 输入框');
    assert.ok(settingsSource.includes('phone-image-test-runninghub'), 'settings 应有测试按钮');
    assert.ok(/allowedProviders = new Set\(\[[^\]]*'runninghub'/.test(settingsSource), 'settings 白名单应含 runninghub');

    const chatSource = fs.readFileSync(new URL('../apps/wechat/chat-view.js', import.meta.url), 'utf8');
    assert.ok(chatSource.includes('_persistWechatGeneratedVideo'), 'chat-view 应有视频持久化方法');
    assert.ok(/mediaType: '视频'/.test(chatSource), 'chat-view 应标记视频媒体类型');
});

test('RunningHub 常量与基础 URL', () => {
    assert.equal(ImageGenerationManager.RUNNINGHUB_BASE, 'https://www.runninghub.ai');
    assert.equal(ImageGenerationManager.RUNNINGHUB_MAX_POLL_ATTEMPTS, 300);
    assert.equal(ImageGenerationManager.RUNNINGHUB_POLL_INTERVAL_MS, 3000);
});
