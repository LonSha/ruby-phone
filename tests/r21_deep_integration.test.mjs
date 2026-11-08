import test from 'node:test';
import assert from 'node:assert/strict';

import { SpotlightUniversalSearch } from '../config/spotlight-universal-search.js';
import { calculateVirtualSlice } from '../phone/virtual-slice-scrolling-fps-booster.js';
import { reportOpToWorldAxis } from '../config/phone-action-to-worldaxis-causal-feedback.js';
import { executeGeekTerminalCommand } from '../apps/security/pixel-geek-terminal-sandbox.js';

test('E2E-R1: 全局拼音穿透检索与玩家直观体验测试', () => {
    const searcher = new SpotlightUniversalSearch();
    searcher.indexEntities('WECHAT', [
        { id: 'msg_1', title: '小林', subtitle: '今天一起去吃火锅吗？', content: '火锅店见' },
        { id: 'msg_2', title: '工作群', subtitle: '下周项目方案评审', content: '请准时参会' }
    ]);
    searcher.indexEntities('DIARY', [
        { id: 'diary_1', title: '晴天日记', subtitle: '心情不错', content: '下午在咖啡馆看了一下午的书' }
    ]);

    // 1. 玩家输入简拼/汉字片段进行直观搜索
    const res1 = searcher.search('火锅');
    assert.ok(res1.results.length > 0, '搜索火锅应该能直接命中微信');
    assert.equal(res1.results[0].title, '小林');

    // 2. 玩家搜索日记片段
    const res2 = searcher.search('咖啡馆');
    assert.ok(res2.results.length > 0, '搜索咖啡馆应该直接命中日记');
    assert.equal(res2.results[0].title, '晴天日记');
});

test('E2E-R2: 万级长历史消息列表虚拟切片流畅度与视口守卫测试', () => {
    // 模拟玩家拥有 12,000 条历史聊天记录
    const totalMessages = 12000;
    const itemHeight = 45;
    const viewportHeight = 450;
    const currentScrollTop = 5400; // 滚动到中部

    const slice = calculateVirtualSlice(totalMessages, currentScrollTop, viewportHeight, itemHeight);
    
    // 验证视口切片渲染条数恒定在 ~15 条左右，彻底阻断 12000 个 DOM 节点挤爆内存
    assert.ok(slice.renderedCount <= 20, `实际渲染条数应控制在20条以内，当前为 ${slice.renderedCount}`);
    assert.ok(slice.startIndex > 0, '切片起始索引起点必须根据滚动位精确偏移');
    assert.equal(slice.topSpacerHeight + slice.bottomSpacerHeight + (slice.renderedCount * itemHeight), slice.totalHeight, '上下占位高度与切片总高必须完全守恒');
});

test('E2E-R3: 玩家关键手机动作捕获、极客沙盒与客观世界因果反馈闭环测试', () => {
    // 1. 极客终端玩家友好指令测试
    const termRes = executeGeekTerminalCommand('help');
    assert.equal(termRes.exitCode, 0);
    assert.match(termRes.output, /Available commands:/);
    
    // 2. 玩家在手机端触发拉黑、报警或转账，因果反馈桥安全收集动作
    const targetBridge = {
        WorldAxis: {
            phoneBridge: {
                dispatchedOps: [],
                noteAction(op) {
                    this.dispatchedOps.push(op);
                    return { ok: true, opId: op.opId };
                }
            }
        }
    };

    const phoneOp = { actionType: 'BLOCK_CONTACT', targetActor: 'char_villain_9', params: { reason: '骚扰短信' } };
    const feedback = reportOpToWorldAxis(phoneOp, targetBridge);

    assert.equal(feedback.reported, true, '因果动作上报应成功');
    assert.equal(targetBridge.WorldAxis.phoneBridge.dispatchedOps.length, 1);
    assert.equal(targetBridge.WorldAxis.phoneBridge.dispatchedOps[0].targetActor, 'char_villain_9');
});