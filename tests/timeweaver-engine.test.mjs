// 织光机数字生活叙事引擎单测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import TW from '../apps/timeweaver/timeweaver-engine.js';

test('scoreMood 正向/负向/中性', () => {
  assert.ok(TW.scoreMood('开心 幸福 温暖') > 0);
  assert.ok(TW.scoreMood('绝望 心碎 悲伤') < 0);
  assert.equal(TW.scoreMood('今天天气'), 0);
  assert.equal(TW.scoreMood(''), 0);
});

test('parseMaybe 容错解析', () => {
  assert.deepEqual(TW.parseMaybe('{"a":1}', null), { a: 1 });
  assert.deepEqual(TW.parseMaybe({ b: 2 }, null), { b: 2 });
  assert.equal(TW.parseMaybe('not json', 'fb'), 'fb');
  assert.equal(TW.parseMaybe(null, 'fb'), 'fb');
});

test('normalizeEvents 归一日记+成就+照片，按时间排序', () => {
  const events = TW.normalizeEvents({
    diary: [{ content: '今天很开心', createdAt: 2000, author: '珞珈', title: '晴' }],
    achievements: [{ name: '初心者', unlockedAt: 1000, desc: '第一个成就' }],
    photos: [{ desc: '自拍', createdAt: 3000, author: '珞珈' }]
  });
  assert.equal(events.length, 3);
  assert.equal(events[0].kind, 'achievement'); // ts 1000 最早
  assert.equal(events[1].kind, 'diary');
  assert.equal(events[2].kind, 'photo');
  assert.equal(events[1].actors[0], '珞珈');
});

test('normalizeEvents 容错跳过脏数据，不毁整部', () => {
  const events = TW.normalizeEvents({
    diary: [null, { content: '正常日记', createdAt: 1000 }, { noContent: true }, 'broken'],
    achievements: [{ /* 无 name */ }, { name: '有效成就', unlockedAt: 2000 }]
  });
  // 只有正常日记 + 有效成就
  assert.equal(events.length, 2);
  assert.ok(events.some(e => e.kind === 'diary'));
  assert.ok(events.some(e => e.kind === 'achievement'));
});

test('normalizeEvents 楼号回退为排序键（无 ms 时间戳时）', () => {
  const events = TW.normalizeEvents({
    diary: [{ content: '日记', floor: 42 }]
  });
  assert.equal(events[0].ts, 42);
  assert.equal(events[0].floor, 42);
});

test('buildTimeline 按日分桶并算 topEvent', () => {
  const day = 24 * 3600 * 1000;
  const base = 1700000000000;
  const events = TW.normalizeEvents({
    diary: [
      { content: '第一天', createdAt: base },
      { content: '第二天', createdAt: base + day }
    ],
    achievements: [{ name: '成就', unlockedAt: base }]
  });
  const tl = TW.buildTimeline(events, 'day');
  assert.ok(tl.length >= 2);
  assert.ok(tl[0].topEvent); // 成就 weight 3 > 日记 2
  assert.equal(tl[0].topEvent.kind, 'achievement');
});

test('detectMilestones 检测各类第一次', () => {
  const events = TW.normalizeEvents({
    photos: [{ desc: '自拍', createdAt: 1000 }],
    diary: [{ content: '日记', createdAt: 2000 }],
    achievements: [{ name: '成就', unlockedAt: 3000 }]
  });
  const ms = TW.detectMilestones(events);
  const labels = ms.map(m => m.label);
  assert.ok(labels.includes('第一张照片'));
  assert.ok(labels.includes('第一篇日记'));
  assert.ok(labels.includes('第一个成就'));
});

test('buildMoodCurve 滑窗平均', () => {
  const events = TW.normalizeEvents({
    weibo: [
      { content: '开心', createdAt: 1000 },
      { content: '难过', createdAt: 2000 },
      { content: '开心', createdAt: 3000 }
    ]
  });
  const curve = TW.buildMoodCurve(events, 2);
  assert.equal(curve.length, 3);
  assert.ok(Math.abs(curve[1].mood) <= 1);
});

test('buildAffinityBoard 亲密度排序', () => {
  const events = TW.normalizeEvents({
    honey: [
      { character: '珞珈', content: '温暖', createdAt: 1000 },
      { character: '珞珈', content: '陪伴', createdAt: 2000 },
      { character: '配角', content: '点头', createdAt: 3000 }
    ]
  });
  const board = TW.buildAffinityBoard(events);
  assert.equal(board[0].name, '珞珈');
  assert.ok(board[0].score > board[1].score);
  assert.equal(board[0].interactions, 2);
});

test('composeLetter 生成叙事信含统计与段落', () => {
  const events = TW.normalizeEvents({
    diary: [{ content: '开心的一天', createdAt: 1700000000000, author: '珞珈' }],
    honey: [{ character: '珞珈', content: '温暖陪伴', createdAt: 1700000100000 }],
    achievements: [{ name: '初心', unlockedAt: 1700000200000 }]
  });
  const letter = TW.composeLetter(events);
  assert.ok(letter);
  assert.ok(letter.paragraphs.length >= 3);
  assert.equal(letter.stats.total, 3);
  assert.equal(letter.stats.topPerson, '珞珈');
  assert.ok(letter.paragraphs.some(p => p.includes('织光机')));
  assert.ok(letter.milestones.length > 0);
  assert.ok(letter.timeline.length > 0);
});

test('composeLetter 空数据返回 null', () => {
  assert.equal(TW.composeLetter([]), null);
});

test('多源混合聚合（容错 + 广度）', () => {
  const events = TW.normalizeEvents({
    diary: [{ content: '日记', createdAt: 1000, author: 'A' }],
    photos: [{ desc: '照', createdAt: 2000, author: 'A' }],
    honey: [{ character: 'A', content: '蜜', createdAt: 3000 }],
    theater: [{ title: '剧场', createdAt: 4000, actors: ['A'] }],
    weibo: [{ content: '动态', createdAt: 5000, author: 'A' }]
  });
  const board = TW.buildAffinityBoard(events);
  const a = board.find(b => b.name === 'A');
  assert.equal(a.breadth, 5); // 横跨 5 源
  assert.equal(a.interactions, 5);
});