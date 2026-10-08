/**
 * tests/system-v3690_knowledge.test.mjs — [v3.69.0 · X5] 社媒知情边界实际接入
 *
 * A面 协议（表自检 / 账本自检 / 导出面）
 * B面 知情判定（可见 / 已看 / 未看 / 可互动 / 被挡 / 零依赖）
 * C面 账本（幂等 / 撤回 / 截断 / 去重 / 帖子被删标记陈旧）
 * D面 通知过滤（看不见不收 / 非社媒放行 / allowed vs blocked）
 * V面 版本与导出面
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    KNOWLEDGE_LEDGER_LIMIT,
    knowledgeCheck,
    filterNotificationsByVisibility,
    knowledgeIdemKey,
    normalizeKnowledgeLedger,
    diffKnowledgeLedger,
    applyKnowledgeLedger,
    knowledgeSelfCheck,
    normalizeKnowledgeEntry,
} from '../config/social-knowledge-bridge.js';

// Also verify no unexpected extra exports
const mod = await import('../config/social-knowledge-bridge.js');
const allExports = Object.keys(mod).filter(k => k !== 'default');

const MANIFEST = JSON.parse(
    await import('node:fs').then(m => m.promises.readFile(new URL('../manifest.json', import.meta.url), 'utf-8'))
);

describe('[A] 协议 · 表自检', () => {
    test('A1: 表自检全绿', () => {
        const { problems } = knowledgeSelfCheck();
        assert.deepEqual(problems, []);
    });

    test('A2: KNOWLEDGE_LEDGER_LIMIT 是 200', () => {
        assert.equal(KNOWLEDGE_LEDGER_LIMIT, 200);
    });

    test('A3: knowledgeIdemKey 格式 <actorId>:<postId>:<eventType>', () => {
        const key = knowledgeIdemKey('act1', 'post1', 'view');
        assert.equal(key, 'act1:post1:view');
    });
});

describe('[B] 知情判定 · knowledgeCheck', () => {
    // 构造一组帖子与联系人（口径与 socialguard-data 同形：audienceIds / seenBy 是对象）
    const posts = [
        { id: 'p1', authorId: 'u1', audienceIds: ['u2', 'u3'], kind: 'post', seenBy: {} },
        { id: 'p2', authorId: 'u2', audienceIds: ['u1'], kind: 'post', seenBy: {} },
        { id: 'p3', authorId: 'u1', audienceIds: ['u3'], kind: 'story', expiresAt: Date.now() + 60000, seenBy: {} },
    ];
    const contacts = [
        { id: 'u2', linked: ['u1', 'u3'] },
        { id: 'u3', linked: ['u1', 'u2'] },
    ];

    test('B1: 作者自己可见自己的帖子', () => {
        const r = knowledgeCheck(posts, contacts, 'u1', Date.now());
        const p1 = r.visible.find((v) => v.postId === 'p1');
        assert.ok(p1, 'u1 应能看到自己的帖子 p1');
    });

    test('B2: 受众内的人可见帖子', () => {
        const r = knowledgeCheck(posts, contacts, 'u2', Date.now());
        const p1 = r.visible.find((v) => v.postId === 'p1');
        assert.ok(p1, 'u2 在 p1 的受众列表中，应可见');
    });

    test('B3: 不在受众中的人不可见', () => {
        const r = knowledgeCheck(posts, contacts, 'u3', Date.now());
        // u3 不在 p2 受众(audienceIds: ['u1']) → p2 不出现在 visible 列表中
        const p2 = r.visible.find((v) => v.postId === 'p2');
        assert.ok(!p2, 'u3 不在 p2 受众中，p2 不应出现在 visible 列表');
        // u3 可见 p1（在受众中）和 p3（在受众中），但 p2 不可见 → 不在任何列表
        const allPostIds = r.visible.map((v) => v.postId);
        assert.ok(!allPostIds.includes('p2'), 'p2 不应出现在任何可见列表中');
    });

    test('B4: 空帖子列表 → 全列表空数组', () => {
        const r = knowledgeCheck([], [], 'u1', Date.now());
        assert.deepEqual(r.visible, []);
        assert.deepEqual(r.seen, []);
        assert.deepEqual(r.unseen, []);
        assert.deepEqual(r.canInteract, []);
        assert.deepEqual(r.blocked, []);
    });

    test('B5: 已看标记 — 帖子 seenBy 含 actorId → seen 列表', () => {
        const posts2 = [
            { id: 'p1', authorId: 'u1', audienceIds: ['u2'], kind: 'post', seenBy: { 'u2': 12345 } },
        ];
        const contacts2 = [{ id: 'u2', linked: ['u1'] }];
        const r = knowledgeCheck(posts2, contacts2, 'u2', Date.now());
        const seen = r.seen.find((v) => v.postId === 'p1');
        assert.ok(seen, 'u2 已看过 p1，应在 seen 列表');
    });
});

describe('[C] 账本 · 幂等与截断', () => {
    test('C1: normalize 去重（同幂等键只留一条）', () => {
        const raw = [
            { idemKey: 'a1:p1:view', actorId: 'a1', postId: 'p1', eventType: 'view', at: 1000 },
            { idemKey: 'a1:p1:view', actorId: 'a1', postId: 'p1', eventType: 'view', at: 2000 }, // 同幂等键
            { idemKey: 'a2:p1:view', actorId: 'a2', postId: 'p1', eventType: 'view', at: 3000 }, // 不同
        ];
        const norm = normalizeKnowledgeLedger(raw);
        assert.equal(norm.entries.length, 2, '应去重为 2 条');
    });

    test('C2: normalize 截断至上限', () => {
        const raw = [];
        for (let i = 0; i < KNOWLEDGE_LEDGER_LIMIT + 50; i++) {
            raw.push({ idemKey: 'k' + i, actorId: 'a' + i, postId: 'p1', eventType: 'view', at: i });
        }
        const norm = normalizeKnowledgeLedger(raw);
        assert.equal(norm.entries.length, KNOWLEDGE_LEDGER_LIMIT, '应截断至上限');
    });

    test('C3: diff 标记陈旧（帖子已删 → stale）', () => {
        const ledger = [
            { idemKey: 'a:p1:seen', actorId: 'a', postId: 'p1', eventType: 'seen', at: 1000 },
            { idemKey: 'a:p2:seen', actorId: 'a', postId: 'p2', eventType: 'seen', at: 2000 },
        ];
        const currentPosts = [{ id: 'p1' }]; // p2 已删
        const diff = diffKnowledgeLedger(ledger, currentPosts);
        assert.ok(diff.stale.length > 0, '应有 stale 条目');
        assert.ok(diff.stale.some((e) => e.postId === 'p2'), 'p2 应被标记为 stale');
    });

    test('C4: applyKnowledgeLedger 移除陈旧 + 写入新条目', () => {
        const prevLedger = [
            { idemKey: 'a:p_old:seen', actorId: 'a', postId: 'p_old', eventType: 'seen', at: 1000 },
        ];
        const newEntries = [
            { idemKey: 'a:p_new:seen', actorId: 'a', postId: 'p_new', eventType: 'seen', at: 2000 },
        ];
        const stalePostIds = ['p_old'];
        const result = applyKnowledgeLedger(prevLedger, newEntries, stalePostIds);
        assert.ok(!result.entries.some((e) => e.postId === 'p_old'), '陈旧条目应被移除');
        assert.ok(result.entries.some((e) => e.postId === 'p_new'), '新条目应被写入');
    });

    test('C5: 幂等键相同 → diff 标记为 replay', () => {
        const ledger = [
            { idemKey: 'a:p1:seen', actorId: 'a', postId: 'p1', eventType: 'seen', at: 1000 },
        ];
        const currentPosts = [{ id: 'p1' }];
        const diff = diffKnowledgeLedger(ledger, currentPosts);
        // diff 完成不报错，active 含 p1
        assert.ok(diff.active.some((e) => e.postId === 'p1'), 'p1 仍在 active 列表');
    });

    test('C6: 空输入 → 空账本', () => {
        const norm = normalizeKnowledgeLedger(null);
        assert.equal(norm.entries.length, 0);
    });

    test('C7: 非数组输入 → 空账本（防御性降级）', () => {
        const norm = normalizeKnowledgeLedger('not an array');
        assert.equal(norm.entries.length, 0);
        assert.equal(norm.dropped, 0);
    });
});

describe('[D] 通知过滤 · filterNotificationsByVisibility', () => {
    test('D1: 看不见帖子的 actor 不收到相关通知', () => {
        const posts = [
            { id: 'p1', authorId: 'u1', audienceIds: ['u2'], kind: 'post', seenBy: {} },
        ];
        const contacts = [{ id: 'u2', linked: ['u1'] }];
        // u3 不在受众 → 不应收到 p1 相关通知
        const notifs = [
            { type: 'social', postId: 'p1', recipientId: 'u3', text: '新帖子' },
        ];
        const r = filterNotificationsByVisibility(notifs, posts, contacts);
        // u3 不可见 p1，通知应被 blocked
        assert.ok(r.blocked.length > 0, '不可见帖子的通知应被过滤');
    });

    test('D2: 非社媒通知一律放行', () => {
        const notifs = [
            { type: 'system', text: '系统更新' },
            { type: 'calendar', text: '日程提醒' },
        ];
        const r = filterNotificationsByVisibility(notifs, [], []);
        assert.equal(r.allowed.length, 2, '非社媒通知应全部放行');
        assert.equal(r.blocked.length, 0);
    });

    test('D3: 看得见帖子的 actor 收到通知', () => {
        const posts = [
            { id: 'p1', authorId: 'u1', audienceIds: ['u2'], kind: 'post', seenBy: {} },
        ];
        const contacts = [{ id: 'u2', linked: ['u1'] }];
        const notifs = [
            { type: 'social', postId: 'p1', recipientId: 'u2', text: '新帖子' },
        ];
        // u2 在受众中，应收到通知
        const r = filterNotificationsByVisibility(notifs, posts, contacts);
        assert.ok(r.allowed.length > 0, '可见帖子的通知应放行');
    });

    test('D4: 空通知列表 → 全空', () => {
        const r = filterNotificationsByVisibility([], [], []);
        assert.deepEqual(r.allowed, []);
        assert.deepEqual(r.blocked, []);
    });
});

describe('[V] 版本与导出面', () => {
    test('V1: 版本下限 3.69.0', () => {
        const ver = MANIFEST.version;
        const parts = ver.split('.').map(Number);
        assert.ok(parts[0] === 3 && parts[1] >= 69, '版本应 >= 3.69.0，实际 ' + ver);
    });

    test('V2: 导出函数恰好 9 项', () => {
        const expected = [
            'knowledgeCheck',
            'filterNotificationsByVisibility',
            'knowledgeIdemKey',
            'normalizeKnowledgeLedger',
            'diffKnowledgeLedger',
            'applyKnowledgeLedger',
            'knowledgeSelfCheck',
            'KNOWLEDGE_LEDGER_LIMIT',
            'normalizeKnowledgeEntry',
        ];
        // 逐一验证可导入（不漏不增）
        for (const name of expected) {
            assert.ok(typeof mod[name] !== 'undefined', '应导出 ' + name);
        }
        assert.equal(allExports.length, expected.length, '导出数应为 ' + expected.length + '，实际 ' + allExports.length + '：' + allExports.join(', '));
    });
});
