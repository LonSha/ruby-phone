// tests/v211_status_tracker.test.mjs — [v2.11.0] u4d-panel 状态追踪引擎缝合测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    defaultParser as parser,
    makeParser,
    parseChineseInteger,
    getStoryDayKey,
    isStoryDayChange,
    normalizeKey,
} from '../apps/phone/status-tracker.js';

test('normalizeKey 归一化（trim+小写+去_-空格）', () => {
    assert.equal(normalizeKey('  Mood_State '), 'moodstate');
    assert.equal(normalizeKey('Date-Time'), 'datetime');
    assert.equal(normalizeKey('心情'), '心情');
});

test('parseChineseInteger 中文数字解析', () => {
    assert.equal(parseChineseInteger('三'), 3);
    assert.equal(parseChineseInteger('二十三'), 23);
    assert.equal(parseChineseInteger('一百零五'), 105);
    assert.equal(parseChineseInteger('两千'), 2000);
    assert.equal(parseChineseInteger('abc'), null);
    assert.equal(parseChineseInteger(''), null);
});

test('getStoryDayKey 剧情日识别（日历/第N天/Day N）', () => {
    assert.equal(getStoryDayKey('2024年3月5日'), 'calendar:2024-3-5');
    assert.equal(getStoryDayKey('2024-03-05'), 'calendar:2024-3-5');
    assert.equal(getStoryDayKey('第三十五天'), 'story:35');
    assert.equal(getStoryDayKey('第10天'), 'story:10');
    assert.equal(getStoryDayKey('Day 12'), 'story:12');
    assert.equal(getStoryDayKey('未记录'), null);
    assert.equal(getStoryDayKey(''), null);
});

test('isStoryDayChange 跨天检测', () => {
    assert.equal(isStoryDayChange('第1天', '第2天'), true);
    assert.equal(isStoryDayChange('第1天', '第1天'), false);
    assert.equal(isStoryDayChange('2024年3月5日', '2024年3月6日'), true);
    assert.equal(isStoryDayChange('第1天', ''), false); // 一方无 key 不判跨天
});

test('parseStatusPayload keyed 载荷（别名规范化+增量记录）', () => {
    const r = parser.parseStatusPayload('日期=第1天|心情=高兴|体力=充沛|记录+=买了杯子');
    assert.equal(r.updates.date, '第1天');
    assert.equal(r.updates.mood, '高兴');       // 心情→mood
    assert.equal(r.updates.energy, '充沛');     // 体力→energy
    assert.deepEqual(r.records, ['买了杯子']);
});

test('parseStatusPayload 忽略未识别字段与空值', () => {
    const r = parser.parseStatusPayload('未知字段=x|心情=开心|=');
    assert.equal(r.updates.mood, '开心');
    assert.equal(r.updates.未知字段, undefined);
});

test('parseStatusPayload legacy 定位置载荷', () => {
    // date|growth|num|num|drive|form|因果
    const r = parser.parseStatusPayload('第3天|成长期|10|20|探索|人形|获得关键道具');
    assert.equal(r.legacy, true);
    assert.equal(r.updates.date, '第3天');
    assert.equal(r.updates.growth, '成长期');
    assert.deepEqual(r.records, ['因果：获得关键道具']);
});

test('parseStatusPayload legacy 数值校验失败回退 null', () => {
    const r = parser.parseStatusPayload('第3天|成长期|非数值|20|探索|人形|x');
    assert.equal(r, null); // 第3段非数值 → legacy 不成立，keyed 也无有效字段
});

test('applyStatusUpdate 应用与 records 去重保序', () => {
    let st = parser.applyStatusUpdate(null, parser.parseStatusPayload('心情=高兴|记录+=A|记录+=B|记录+=A'));
    assert.equal(st.mood, '高兴');
    assert.deepEqual(st.records, ['A', 'B']); // A 重复被去重
});

test('applyStatusUpdate 跨天滚动（携带 growth/form，重置其余，保留 records）', () => {
    let st = parser.applyStatusUpdate(null, parser.parseStatusPayload('日期=第1天|心情=高兴|体力=充沛|成长=幼年|形态=初始|记录+=R1'));
    assert.equal(st.energy, '充沛');
    // 跨到第2天
    st = parser.applyStatusUpdate(st, parser.parseStatusPayload('日期=第2天|心情=平静'));
    assert.equal(st.date, '第2天');
    assert.equal(st.mood, '平静');
    assert.equal(st.energy, '');          // 非携带字段被重置
    assert.equal(st.growth, '幼年');      // 携带字段保留
    assert.equal(st.form, '初始');        // 携带字段保留
    assert.deepEqual(st.records, ['R1']); // records 跨天保留
});

test('findStatusUpdates / findLatestStatus 文本提取', () => {
    const text = '剧情[STATUS:心情=开心]继续[STATUS:心情=难过|记录+=哭了]结尾';
    const all = parser.findStatusUpdates(text);
    assert.equal(all.length, 2);
    const latest = parser.findLatestStatus(text);
    assert.equal(latest.updates.mood, '难过');
    assert.deepEqual(latest.records, ['哭了']);
});

test('makeParser 自定义字段别名注入', () => {
    const custom = makeParser({
        fieldAliases: new Map([
            ['好感度', 'affection'], ['affection', 'affection'],
            ['记录', 'record'], ['record', 'record'],
        ]),
    });
    const r = custom.parseStatusPayload('好感度=80|心情=开心');
    assert.equal(r.updates.affection, '80'); // 值为字符串（保持原始文本）
    assert.equal(r.updates.mood, undefined); // 自定义别名表不含心情
});
