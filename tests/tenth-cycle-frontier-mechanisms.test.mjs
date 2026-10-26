/* ========================================================
 * tests/tenth-cycle-frontier-mechanisms.test.mjs
 * RubyPhone 第十期 (R10) 前沿机制与深度优化测试套件
 * 
 * 验证 6 大核心模块：
 * 1. R10-O1 微信拟真通信引擎 (MimicCommEngine)
 * 2. R10-O2 系统级常驻通知中心 (SystemNotificationDispatcher)
 * 3. R10-O3 全天候环境光影与动态壁纸自适应系统 (DynamicAtmosphereLighting)
 * 4. R10-O4 跨应用全局统一搜索与快捷意图路由 (SpotlightUniversalSearch)
 * 5. R10-X3 全景社交朋友圈与角色自驱动画卷 (DynamicMomentsFeed)
 * 6. R10-X9 记忆引擎深层反哺之手机潜意识梦境镜像 (SubconsciousDreamscapeMirror)
 * ======================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MimicCommEngine, TYPING_STATES, RECALL_NUANCES } from '../config/mimic-comm-engine.js';
import { SystemNotificationDispatcher, NOTIFICATION_PRIORITY, NOTIFICATION_CHANNELS } from '../config/system-notification-dispatcher.js';
import { DynamicAtmosphereLighting, ATMOSPHERE_PHASES, WEATHER_CONDITIONS } from '../config/dynamic-atmosphere-lighting.js';
import { SpotlightUniversalSearch, SEARCH_DOMAINS } from '../config/spotlight-universal-search.js';
import { DynamicMomentsFeed, MOMENT_VISIBILITY } from '../config/dynamic-moments-feed.js';
import { SubconsciousDreamscapeMirror, DREAM_ARCHETYPES } from '../config/subconscious-dreamscape-mirror.js';

test('R10-O1 · 微信拟真打字、语音条波形与撤回反悔意图分析', () => {
    const engine = new MimicCommEngine({ baseWpm: 50 });

    // 1. 打字调度计划
    const plan = engine.planTypingSchedule('你好呀，今天天气真不错！我们待会儿去散步吧。', { hesitant: true });
    assert.ok(plan.totalDurationMs > 1000, '犹豫状态下长文本打字应有拟真耗时');
    assert.equal(plan.hasPause, true, '含标点符号应产生拟真停顿');
    assert.equal(plan.steps[plan.steps.length - 1].state, TYPING_STATES.SENT, '最终状态应为发送完成');

    // 2. 语音波形合成
    const voice = engine.synthesizeVoiceWaveform('这是一段长约五秒钟的拟真语音留言。');
    assert.equal(voice.type, 'VOICE_MESSAGE');
    assert.ok(voice.durationSec >= 1 && voice.durationSec <= 60, '语音秒数应处于合理范围');
    assert.equal(voice.waveform.length, 24, '振幅柱应为24格');
    assert.ok(voice.waveform.every(a => a >= 0.1 && a <= 1.0), '振幅应规整在 0.1~1.0');

    // 3. 拟真撤回留痕
    const recallConfess = engine.generateRecallTrace({ text: '其实我一直很喜欢你...' }, 'Alice');
    assert.equal(recallConfess.nuance, RECALL_NUANCES.CONFESSION_REGRET);
    assert.match(recallConfess.hint, /告白/);

    const recallSecret = engine.generateRecallTrace({ text: '地下室的门禁密码是9821，千万别告诉别人' }, 'Bob');
    assert.equal(recallSecret.nuance, RECALL_NUANCES.SECRET_RETRACT);
    assert.match(recallSecret.hint, /涉密/);
});

test('R10-O2 · 系统通知中心优先级调度、免打扰穿透与按应用折叠', () => {
    const fakeStorage = new Map();
    const dispatcher = new SystemNotificationDispatcher({
        storage: {
            get: (k, d) => fakeStorage.has(k) ? fakeStorage.get(k) : d,
            set: (k, v) => fakeStorage.set(k, v)
        },
        maxNotifications: 10
    });

    // 1. 发送普通微信通知与紧急来电通知
    const n1 = dispatcher.post({ appId: NOTIFICATION_CHANNELS.WECHAT, title: '微信消息', body: 'Alice: 到了吗？' });
    const n2 = dispatcher.post({ appId: NOTIFICATION_CHANNELS.WECHAT, title: '微信消息', body: 'Bob: 文件已发送' });
    const nUrgent = dispatcher.post({
        appId: NOTIFICATION_CHANNELS.PHONE_CALL,
        title: '紧急来电',
        body: '未知号码呼叫中',
        priority: NOTIFICATION_PRIORITY.URGENT,
        deepLink: { targetApp: 'phone', view: 'incoming' }
    });

    assert.ok(n1 && n2 && nUrgent, '正常通知应全部成功派发');

    // 2. 验证折叠聚合
    const clusters = dispatcher.getClusteredNotifications();
    const wechatCluster = clusters.find(c => c.appId === NOTIFICATION_CHANNELS.WECHAT);
    assert.ok(wechatCluster, '微信通知应自动聚合成一个簇');
    assert.equal(wechatCluster.items.length, 2, '簇内应包含2条微信');
    assert.equal(wechatCluster.unreadCount, 2, '未读数应准确为2');

    // 3. 免打扰过滤测试
    dispatcher.setDnd(true);
    const nSilentBlocked = dispatcher.post({ appId: NOTIFICATION_CHANNELS.SYSTEM, title: '静默更新', priority: NOTIFICATION_PRIORITY.SILENT });
    const nUrgentThrough = dispatcher.post({ appId: NOTIFICATION_CHANNELS.SYSTEM, title: '电量告急', priority: NOTIFICATION_PRIORITY.URGENT });
    assert.equal(nSilentBlocked, null, '免打扰下非紧急通知应被拦截');
    assert.ok(nUrgentThrough !== null, '免打扰下紧急通知应成功穿透');

    // 4. 点击唤醒
    const link = dispatcher.acknowledge(nUrgent.id);
    assert.deepEqual(link, { targetApp: 'phone', view: 'incoming' });
});

test('R10-O3 · 全天候四时光影色温演化与恶劣天气粒子滤镜', () => {
    const lighting = new DynamicAtmosphereLighting();

    // 1. 晨曦阶段
    const dawn = lighting.computeAtmosphere({ hour: 6, weather: WEATHER_CONDITIONS.CLEAR });
    assert.equal(dawn.phase, ATMOSPHERE_PHASES.DAWN);
    assert.equal(dawn.colorTemp, 3600);
    assert.equal(dawn.isNightMode, false);

    // 2. 正午晴天
    const day = lighting.computeAtmosphere({ hour: 13, weather: WEATHER_CONDITIONS.CLEAR });
    assert.equal(day.phase, ATMOSPHERE_PHASES.DAY);
    assert.equal(day.colorTemp, 5500);

    // 3. 黄昏与雨天
    const duskRain = lighting.computeAtmosphere({ hour: 18, weather: WEATHER_CONDITIONS.RAINY });
    assert.equal(duskRain.phase, ATMOSPHERE_PHASES.DUSK);
    assert.equal(duskRain.cssVariables['--phone-mist-intensity'], '0.45', '雨天水雾浓度应为 0.45');

    // 4. 深夜与雪天
    const nightSnow = lighting.computeAtmosphere({ hour: 23, weather: WEATHER_CONDITIONS.SNOWY });
    assert.equal(nightSnow.phase, ATMOSPHERE_PHASES.NIGHT);
    assert.equal(nightSnow.isNightMode, true);
    assert.equal(nightSnow.cssVariables['--phone-frost-intensity'], '0.55', '雪天霜化晶体应显现');
});

test('R10-O4 · 跨应用全局倒排搜索与快捷指令意图解析', () => {
    const searcher = new SpotlightUniversalSearch();

    // 1. 索引多应用实体
    searcher.indexEntities(SEARCH_DOMAINS.CONTACTS, [
        { id: 'c1', title: 'Alice 林安安', subtitle: '好友', content: '安安 县城同学' },
        { id: 'c2', title: 'Bob 孙翌童', subtitle: '同事', content: '软件工程师' }
    ]);
    searcher.indexEntities(SEARCH_DOMAINS.WECHAT, [
        { id: 'm1', title: '聊天记录: Alice', content: '晚上去图书馆吗？', deepLink: { targetApp: 'wechat', view: 'chat', params: { id: 'c1' } } }
    ]);

    // 2. 关键词检索
    const res = searcher.search('图书馆');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].title, '聊天记录: Alice');

    // 3. 意图解析
    const intentWechat = searcher.search('发微信:Alice:明天见');
    assert.ok(intentWechat.intentAction, '应识别发微信意图');
    assert.equal(intentWechat.intentAction.target, 'Alice');
    assert.equal(intentWechat.intentAction.message, '明天见');

    const intentTransfer = searcher.search('转账:Bob:200');
    assert.ok(intentTransfer.intentAction, '应识别转账意图');
    assert.equal(intentTransfer.intentAction.target, 'Bob');
    assert.equal(intentTransfer.intentAction.amount, 200);
});

test('R10-X3 · 朋友圈 2.0 图文发布、角色自驱动点赞与性格回复', () => {
    const feed = new DynamicMomentsFeed();

    // 1. 用户发布图文动态
    const post = feed.publishPost({
        authorName: '你',
        text: '终于下班了，路过买了杯奶茶，今天太累了~',
        mediaUrls: ['url1.jpg', 'url2.jpg'],
        location: '街角星巴克'
    });
    assert.ok(post.id);
    assert.equal(post.mediaUrls.length, 2);

    // 2. 模拟角色自驱动社交反应
    const reactions = feed.simulateAutonomousReactions(post.id, [
        { actorId: 'alice', actorName: '林安安', intimacy: 75, relationType: 'FRIEND' },
        { actorId: 'boss', actorName: '主管', intimacy: 10, relationType: 'WORK' }
    ]);

    assert.ok(reactions.length > 0, '高好感角色应触发自驱动互动');
    const updatedPost = feed.getTimeline('user')[0];
    assert.ok(updatedPost.likes.some(l => l.actorName === '林安安'), '林安安应给动态点赞');
    assert.ok(updatedPost.comments.some(c => c.authorName === '林安安'), '林安安应针对奶茶发表评论');
});

test('R10-X9 · 记忆引擎深层反哺之潜意识梦境镜像与物化草稿', () => {
    const mirror = new SubconsciousDreamscapeMirror();

    // 1. 创伤与暗涌传入
    const cognitivePayload = {
        unconsciousDrive: {
            coreUrge: '逃跑与保护自我',
            suppressedDesire: '希望能一直留在那个夏天'
        },
        traumaDissociation: {
            defenseStage: 'DISSOCIATION',
            panicLevel: 0.8
        },
        sensoryTraces: ['海潮微风', '雨水打湿的衣领']
    };

    /* [v4.88.0 交棒改写] mirrorCognitiveState 自本版起先过 config/dream-guard.js 的
     *   空梦拦截（正文不足 80 字判 too-short 并返回 `{ok:false, retry:true}` 不落库，
     *   这是**新行为**、不是回归）。本条夹具给的素材只有 29 字，首轮必然被挡；
     *   故把 `attempt` 取到上限（2 = DREAM_MAX_RETRIES），让它走 give-up 那条
     *   「不再重试但仍产出记录」的路径 —— 本条要钉的是**原型映射与物化产物**，
     *   不是拦截时机（拦截时机由 dream-guard 自己的判据守）。
     *   首轮被挡那一形态也一并钉住：不传 attempt 时必须拿不到 archetype。 */
    const blocked = mirror.mirrorCognitiveState(cognitivePayload, '林安安');
    assert.equal(blocked.retry, true, '素材 29 字首轮必须被空梦拦截退回（新行为）');
    assert.equal(blocked.record, null, '被挡的那轮不得落库');
    const dream = mirror.mirrorCognitiveState(cognitivePayload, '林安安', { attempt: 2 });
    assert.equal(dream.retry, undefined, '重试用完即产出记录（give-up 不是「什么都别存」）');
    assert.equal(dream.archetype, DREAM_ARCHETYPES.ABYSS_CONFRONTATION, '创伤高解离应映射为深渊对质梦境');
    assert.ok(dream.tensionScore >= 0.8, '紧张度应处于高位');

    // 2. 检查手机备忘录与未发草稿物化
    assert.match(dream.artifacts.memoFragment.title, /梦境断片/);
    assert.match(dream.artifacts.memoFragment.content, /林安安/);
    assert.ok(dream.artifacts.unsentDraft !== null, '应自动生成深夜未发告白草稿');
    assert.match(dream.artifacts.unsentDraft.text, /一直留在那个夏天/);
});