// tests/timeweaver-v215.test.mjs
// RubyPhone v2.15.0 —— 织光机三件套 + 跨端记忆注入扩张 契约测试
// 覆盖：① 收藏册（saveLetter/listLetters 幂等 + 载荷裁剪）② 定期织信间隔门
//       ③ 朋友圈分享（结构对齐 moments-view 用户帖形状）④ 回望面板读 lonsha 召回自检
//       ⑤ 三处注入共用 bridge.recallBlock 单一真源（微信单聊 / 微信群聊 / 蜜语）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLonshaRecall } from '../apps/timeweaver/timeweaver-collector.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf-8');
const appSrc = read('apps/timeweaver/timeweaver-app.js');
const viewSrc = read('apps/timeweaver/timeweaver-view.js');
const colSrc = read('apps/timeweaver/timeweaver-collector.js');
const bridgeSrc = read('apps/memory/lonsha-bridge.js');
const chatSrc = read('apps/wechat/chat-view.js');
const honeySrc = read('apps/honey/honey-data.js');
const storageSrc = read('config/storage.js');
const ok = (c, m) => assert.ok(c, m);

// ── 1. 桥的格式化真源在位 ──
test('bridge.recallBlock 是原型方法（单一真源）', async () => {
    const mod = await import('../apps/memory/lonsha-bridge.js');
    ok(typeof mod.LonShaBridge.prototype.recallBlock === 'function', 'recallBlock 原型方法');
    // 桥禁用 → recall 返回 [] → recallBlock 返回 ''（不发空块）
    const b = new mod.LonShaBridge();
    b.enabled = false; b.memoryCore = null;
    assert.equal(b.recallBlock('Query', { label: '角色' }), '', '禁用时返回空串');
    ok(bridgeSrc.includes('【角色记忆 · 来自剧情】'), '统一块头在桥内');
});

test('bridge.recallBlock 去重 / 裁剪 / 严格模式 / 空态', () => {
    // 用提取执行验证纯逻辑（不依赖 ST 环境）
    const start = bridgeSrc.indexOf('    recallBlock(queryText, opts = {}) {\n');
    ok(start > 0, '找到 recallBlock');
    const sigEnd = bridgeSrc.indexOf(') {', start);
    ok(sigEnd > start, '定位方法体起点（避开默认参数 {}）');
    const bodyOpen = sigEnd + 2;
    let depth = 0, end = -1;
    for (let i = bodyOpen; i < bridgeSrc.length; i++) {
        if (bridgeSrc[i] === '{') depth++;
        else if (bridgeSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const mSrc = bridgeSrc.slice(start, end + 1);
    const proto = new Function('errLog', `return ({ ${mSrc} });`)(() => {});
    const run = (mems, q, opts) => proto.recallBlock.call({ recall: () => mems }, q, opts);

    // 空召回 → 空串（不产生空块）
    assert.equal(run([], 'q', {}), '', '无召回返回空串');
    // 去重 + 裁剪：首 24 字相同的两条只留一条；每条 80 字上限；最多 3 条
    const long = '甲'.repeat(200);
    const out = run([
        { content: long }, { content: long },
        { content: '第二条' }, { content: '第三条' }, { content: '第四条' }
    ], 'q', { label: '珞珈', userName: '我' });
    assert.ok(out.startsWith('【角色记忆 · 来自剧情】珞珈记得这些往事：'), '块头带角色名');
    assert.equal(out.split('\n').filter(l => l.startsWith('- ')).length, 3, '最多 3 条');
    assert.ok(!out.includes('甲'.repeat(81)), '单条裁剪到 80 字内');
    assert.ok(out.includes('这些是 珞珈 和 我 在剧情里共同经历的'), '尾注带双方名');
    // 严格模式：只保留提到在场人物的记忆
    const strict = run([
        { content: '珞珈和我在天台看星星' },
        { content: '阿珍和我在厨房做饭' }
    ], 'q', { actors: ['珞珈'], strictActors: true, label: '群聊' });
    assert.ok(strict.includes('天台'), '在场人物相关记忆保留');
    assert.ok(!strict.includes('阿珍'), '不在场人物记忆被过滤');
    // 严格模式下无命中 → 空串（不注入喧宾夺主内容）
    assert.equal(run([{ content: '无关往事' }], 'q', { actors: ['珞珈'], strictActors: true }), '', '严格模式零命中→空串');
});

// ── 2. 三处注入共用单一真源 ──
test('微信单聊 / 微信群聊 / 蜜语 均走 bridge.recallBlock', () => {
    assert.equal((chatSrc.match(/_lb\.recallBlock\(/g) || []).length, 1, '微信单聊调 recallBlock');
    assert.equal((chatSrc.match(/_glb\.recallBlock\(/g) || []).length, 1, '微信群聊调 recallBlock');
    assert.equal((honeySrc.match(/_hb\.recallBlock\(/g) || []).length, 1, '蜜语调 recallBlock');
    // 群聊走严格模式（防串味）
    ok(chatSrc.includes('strictActors: true'), '群聊严格模式');
    ok(chatSrc.includes("targetChat?.type !== 'group'"), '单聊分支排除群聊');
    // 旧的逐字拼装块（v2.14 内联版）已收敛，扫残留
    ok(!chatSrc.includes('【角色记忆 · 来自剧情】${charName}'), '旧内联格式已移除');
});

// ── 3. 织光机收藏册 ──
test('收藏册：saveLetter/listLetters 幂等 + 载荷裁剪', async () => {
    const { TimeweaverApp } = await import('../apps/timeweaver/timeweaver-app.js');
    const store = {};
    const storage = { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; return Promise.resolve(); } };
    const app = new TimeweaverApp({ setContent(){}, element:null }, storage);

    // 空信不入册
    assert.equal((await app.saveLetter(null)).ok, false, 'null 不入册');
    assert.equal((await app.saveLetter({ paragraphs: [] })).ok, false, '空段落不入册');

    // 首封入库
    const r1 = await app.saveLetter({ title: '甲', paragraphs: ['第一段', '第二段'], ts: 111, source: 'ai' });
    assert.equal(r1.ok, true, '首封入库');
    assert.equal(r1.total, 1);
    // 幂等：同 ts + 同首段 → 不产生第二条
    const r2 = await app.saveLetter({ title: '甲', paragraphs: ['第一段'], ts: 111, source: 'ai' });
    assert.equal(r2.ok, false, '同封信重复收藏被拒');
    assert.equal(app.listLetters().length, 1, '册内仍 1 封');
    // 新 ts → 入册
    const r3 = await app.saveLetter({ title: '乙', paragraphs: ['另一封'], ts: 222 });
    assert.equal(r3.ok, true);
    assert.equal(app.listLetters().length, 2, '册内 2 封');
    assert.equal(app.listLetters()[0].ts, 222, '新信在前');
    // 载荷裁剪：超长段落截断、段落数上限 12
    const many = Array.from({ length: 30 }, (_, i) => '段' + i + '乙'.repeat(900));
    await app.saveLetter({ title: '丙', paragraphs: many, ts: 333 });
    const rec = app.listLetters()[0];
    assert.equal(rec.paragraphs.length, 12, '段落数裁到 12');
    assert.ok(rec.paragraphs.every(p => p.length <= 600), '单段裁到 600 字内');
    // 册上限 60
    for (let i = 0; i < 70; i++) await app.saveLetter({ title: 'T' + i, paragraphs: ['x' + i], ts: 1000 + i });
    assert.ok(app.listLetters().length <= 60, '册上限 60 封');
    // 脏数据容错
    store.tw_letters = '{broken';
    assert.deepEqual(app.listLetters(), [], '脏 JSON → 空册不炸');
});

test('定期织信：间隔门 + 游标 + 无碎片不触发', async () => {
    const { TimeweaverApp } = await import('../apps/timeweaver/timeweaver-app.js');
    const store = {};
    const storage = { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; return Promise.resolve(); } };
    const app = new TimeweaverApp({ setContent(){}, element:null }, storage);
    // 无任何源数据 → 不生成
    const r0 = await app.autoWeaveIfDue({ minGapDays: 7 });
    assert.equal(r0.generated, false, '无碎片不织信');
    assert.ok(!('tw_last_auto' in store), '未生成不写游标');
    // 有碎片：本地规则版入库（无 apiManager → 降级）
    store.diary_entries = JSON.stringify([{ content: '今天很开心 温暖', createdAt: 1000 }]);
    const r1 = await app.autoWeaveIfDue({ minGapDays: 7 });
    assert.equal(r1.generated, true, '有碎片则织信');
    assert.ok(Number(store.tw_last_auto) > 0, '成功后写游标');
    assert.equal(app.listLetters().length, 1, '自动织的信入册');
    // 刚织过 → 间隔门拦截
    const r2 = await app.autoWeaveIfDue({ minGapDays: 7 });
    assert.equal(r2.generated, false, '未到间隔不重复织');
    assert.ok(String(r2.reason).includes('还有'), '给出剩余天数');
    // force 绕过间隔
    const r3 = await app.autoWeaveIfDue({ minGapDays: 7, force: true });
    assert.equal(r3.generated, true, 'force 绕过间隔');
});

test('朋友圈分享：无微信时安全失败 + 结构对齐用户帖形状', async () => {
    const { TimeweaverApp } = await import('../apps/timeweaver/timeweaver-app.js');
    const store = {};
    const storage = { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; return Promise.resolve(); } };
    const app = new TimeweaverApp({ setContent(){}, element:null }, storage);
    // 微信未初始化 → 安全失败
    assert.equal(app.shareLetterToMoments({ paragraphs: ['x'] }).ok, false, '无微信时安全失败');
    // 注入伪 wechatData，校验帖结构
    let posted = null;
    globalThis.window = {
        VirtualPhone: {
            wechatApp: { wechatData: { addMoment: m => { posted = m; }, getUserInfo: () => ({ name: '我', avatar: '😊' }) } },
            timeManager: { getCurrentStoryTime: () => ({ time: '10:30', date: '3月2日', weekday: '周一', timestamp: 12345 }) }
        }
    };
    try {
        const res = app.shareLetterToMoments({ paragraphs: ['那年夏天我们在天台上看见流星'], title: 'x', source: 'ai' });
        assert.equal(res.ok, true, '有微信时分享成功');
        ok(posted && posted.isUserPost === true, '标记为用户帖');
        ok(posted.name === '我', '发帖人是本机用户');
        ok(String(posted.text).includes('织光机'), '署名织光机');
        ok(String(posted.text).includes('那年夏天'), '引用了信的首段');
        ok(Array.isArray(posted.images) && posted.images.length === 0, '无图分享结构完整');
        assert.deepEqual(posted.visibility, { type: 'public', contactIds: [], contactNames: [] }, '默认公开可见');
        ok(posted.time === '10:30' && posted.date === '3月2日', '采用手机剧情时间（非真实时钟）');
        // 空内容 → 拒发
        assert.equal(app.shareLetterToMoments({ paragraphs: [] }).ok, false, '空信不分享');
    } finally { delete globalThis.window; }
});

// ── 4. 回望面板：消费 lonsha 召回自检 ──
test('collectLonshaRecall：桥缺失/旧版/正常三态', () => {
    // 无 window → null
    assert.equal(collectLonshaRecall(), null, '无桥返回 null');
    globalThis.window = {};
    try {
        assert.equal(collectLonshaRecall(), null, '无 bridge 全局返回 null');
        // [v2.36.0 交棒] 夹具形态随单一真源更新：桥对象须自带 sourceState（lonsha v3.174 契约），
        //   否则来源态不可归因（旧夹具是裸 snapshot，真源不会把它当作可读快照）。
        // 旧版 lonsha（无 recallAudit 字段）→ null（向后兼容）
        globalThis.window.lonsha_memory_bridge_v1 = { sourceState: 'ready', snapshot: { pluginVersion: '3.150.0' } };
        assert.equal(collectLonshaRecall(), null, '旧版无 recallAudit 字段安全降级');
        // 正常态：字段透传 + 脏值过滤
        globalThis.window.lonsha_memory_bridge_v1 = {
            sourceState: 'ready',
            snapshot: {
                pluginVersion: '3.151.0',
                recallAudit: {
                    rounds: 12, emptyRounds: 3, avgHits: 4.25, lastQuery: '想起那场雨', lastTs: 999,
                    hotFloors: [{ floor: 7, count: 9 }, { floor: -1, count: 5 }, { floor: 22, count: 6 }, { floor: 'x', count: 1 }]
                }
            }
        };
        const r = collectLonshaRecall();
        assert.equal(r.rounds, 12);
        assert.equal(r.emptyRounds, 3);
        assert.equal(r.avgHits, 4.25);
        assert.equal(r.pluginVersion, '3.151.0');
        assert.deepEqual(r.hotFloors, [{ floor: 7, count: 9 }, { floor: 22, count: 6 }], '负数/非法楼层被过滤');
        assert.equal(r.lastQuery, '想起那场雨');
        // rounds=0 视为无观测
        globalThis.window.lonsha_memory_bridge_v1.snapshot.recallAudit = { rounds: 0 };
        assert.equal(collectLonshaRecall(), null, 'rounds=0 视为无观测');
    } finally { delete globalThis.window; }
});

test('回望面板接线 + 存储分域 + 视图 tab', () => {
    ok(colSrc.includes('export function collectLonshaRecall'), 'collector 导出采集器');
    // [v2.36.0 交棒] 原判据 `colSrc.includes('window.lonsha_memory_bridge_v1')` 现在只会命中注释
    //   （说明文字不该满足文本判据）。改为钉真正的契约：经 config/world-bridge.js **单一真源**读桥，
    //   且不在本文件里自己摸 window 全局（判据落在剥注释的代码行上）。
    // 剥注释要**两种都剥**：只剥行注释会漏掉 JSDoc 块注释里以 ` * ` 开头的内容行
    //   （原实现就因为漏了块注释，把文档里的全局名当成代码命中，判据假红）。
    const colCode = colSrc.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    ok(colCode.includes("from '../../config/world-bridge.js'"), '桥读取走单一真源（config/world-bridge.js）');
    ok(!/window\s*\.\s*lonsha_memory_bridge_v1/.test(colCode), '本文件不再自己摸桥全局（桥怎么读由真源决定）');
    ok(colSrc.includes('opts.withRecall === false') || colSrc.includes('recall,'), 'buildNarrative 模型带 recall');
    ok(viewSrc.includes("this._tab === 'recall'"), '回望 tab 路由在位');
    ok(viewSrc.includes('你最常回望的时光'), '回望面板渲染热点楼层');
    ok(viewSrc.includes('空召回'), '回望面板暴露空召回比例（召回质量信号）');
    // 存储分域：tw_* 必须落 chatMetadata（随会话隔离，防串味）
    ok(storageSrc.includes('/^tw_/'), 'tw_ 前缀已登记为会话数据');
    // 收藏册/分享按钮 + 自动织信接线
    ok(viewSrc.includes('id="tw-save"') && viewSrc.includes('id="tw-share"'), '收藏/分享按钮在位');
    ok(viewSrc.includes("this._tab === 'album'"), '收藏册 tab 路由在位');
    ok(appSrc.includes('_maybeAutoWeave()'), '打开 App 触发定期织信检查');
});
