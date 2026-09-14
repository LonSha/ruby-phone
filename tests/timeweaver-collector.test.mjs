// 织光机数据收集器单测（mock storage）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSources, buildNarrative } from '../apps/timeweaver/timeweaver-collector.js';

function mockStorage(map = {}, ctx = null) {
  return {
    get: (k) => map[k] ?? null,
    getContext: () => ctx
  };
}

test('collectSources 读取日记+成就，缺失源静默为空', () => {
  const s = mockStorage({
    diary_entries: JSON.stringify([{ content: '今天开心', createdAt: 1000, author: '珞珈' }]),
    ruby_unlocked_achievements: [{ name: '初心', unlockedAt: 2000 }]
  });
  const raw = collectSources(s);
  assert.equal(raw.diary.length, 1);
  assert.equal(raw.achievements.length, 1);
  assert.equal(raw.photos.length, 0); // 缺失源 → 空
  assert.equal(raw.honey.length, 0);
});

test('collectSources 容错：脏 JSON 不抛异常', () => {
  const s = mockStorage({ diary_entries: '{broken json' });
  const raw = collectSources(s);
  assert.equal(raw.diary.length, 0); // 容错为空
});

test('collectSources 消费 life_events_v1 作为 generic 源', () => {
  const s = mockStorage({
    life_events_v1: [{ app: 'wechat', type: 'chat', title: '深聊', summary: '很重要的谈话', createdAt: 1000, importance: 4 }]
  });
  const raw = collectSources(s);
  assert.equal(raw.generic.length, 1);
  assert.equal(raw.generic[0].title, '深聊');
  assert.equal(raw.generic[0].weight, 4);
});

test('collectSources 从 chatMetadata 兜底收集 st_virtual_phone_* 数组', () => {
  const ctx = { chatMetadata: { 'st_virtual_phone_drives': { events: [{ title: '情绪峰值', createdAt: 1000 }] } } };
  const s = mockStorage({}, ctx);
  const raw = collectSources(s);
  assert.ok(raw.generic.some(e => e.title === '情绪峰值'));
});

test('buildNarrative 空数据返回 empty 标记', () => {
  const s = mockStorage({});
  const n = buildNarrative(s);
  assert.equal(n.empty, true);
  assert.equal(n.events.length, 0);
});

test('buildNarrative 多源聚合成完整叙事模型', () => {
  const s = mockStorage({
    diary_entries: [{ content: '开心的一天', createdAt: 1700000000000, author: '珞珈' }],
    honey_records: [{ character: '珞珈', content: '温暖陪伴', createdAt: 1700000100000 }],
    ruby_unlocked_achievements: [{ name: '初心', unlockedAt: 1700000200000 }]
  });
  const n = buildNarrative(s);
  assert.equal(n.empty, false);
  assert.equal(n.events.length, 3);
  assert.ok(n.timeline.length > 0);
  assert.ok(n.milestones.length > 0);
  assert.ok(n.board.length > 0);
  assert.ok(n.letter);
  assert.equal(n.letter.stats.topPerson, '珞珈');
});

test('buildNarrative 单源脏数据不毁其它源', () => {
  const s = mockStorage({
    diary_entries: '{broken',
    honey_records: [{ character: 'A', content: '正常蜜语', createdAt: 1000 }]
  });
  const n = buildNarrative(s);
  assert.equal(n.empty, false);
  assert.equal(n.events.length, 1); // 仅 honey 存活
  assert.equal(n.events[0].kind, 'intimate');
});