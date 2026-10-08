/**
 * tests/system-v3680_finance.test.mjs — [v3.68.0 · X4] 财务总览与旅行结算交接
 *
 * A面 协议（来源登记表 / 表自检 / 账本自检）
 * B面 归一（没打开≠余额0 / 不盲目求和 / 建议≠事实 / 来源白名单）
 * C面 账本（幂等 / 撤回 / 截断 / 去重）
 * D面 草稿（suggestion 标记 / 不落账 / 填充）
 * V面 版本与导出面
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    FINANCE_SOURCES, FINANCE_LEDGER_LIMIT,
    financeSourceRow, buildFinanceOverview,
    travelSettlementDraft, fillSettlementDraft,
    settlementIdemKey, normalizeFinanceLedgerEntry, normalizeFinanceLedger,
    diffFinanceLedger, applyFinanceLedger,
    financeSourceSelfCheck, financeLedgerSelfCheck,
} from '../config/finance-overview.js';

const MANIFEST = JSON.parse(
    await import('node:fs').then(m => m.promises.readFile(new URL('../manifest.json', import.meta.url), 'utf-8'))
);

describe('[A] 协议 · 来源登记表', () => {
    test('A1: 来源表恰好 7 条且 source 键不重复', () => {
        assert.equal(FINANCE_SOURCES.length, 7);
        const keys = FINANCE_SOURCES.map(s => s.source);
        const unique = new Set(keys);
        assert.equal(keys.length, unique.size, 'source 键有重复');
    });

    test('A2: 每源字段完备', () => {
        for (const s of FINANCE_SOURCES) {
            assert.ok(s.source, s.source + ' 缺 source');
            assert.ok(s.label, s.source + ' 缺 label');
            assert.ok(s.currency, s.source + ' 缺 currency');
            assert.ok(['fact', 'prediction', 'suggestion'].includes(s.certainty), s.source + ' certainty 不合法');
            assert.ok(Array.isArray(s.provides) && s.provides.length > 0, s.source + ' provides 空');
            assert.equal(typeof s.openable, 'boolean', s.source + ' openable 非布尔');
            assert.equal(typeof s.ownerWrite, 'boolean', s.source + ' ownerWrite 非布尔');
        }
    });

    test('A3: 表自检全绿', () => {
        const { problems } = financeSourceSelfCheck();
        assert.deepEqual(problems, []);
    });

    test('A4: 账本自检全绿', () => {
        const { problems } = financeLedgerSelfCheck();
        assert.deepEqual(problems, []);
    });
});

describe('[B] 归一 · 只读总览', () => {
    test('B1: 没打开的来源记 not-opened，余额 null 而非 0', () => {
        const row = financeSourceRow('wallet', null);
        assert.equal(row.state, 'not-opened');
        assert.equal(row.balance, null);
        assert.equal(row.txCount, 0);
        assert.equal(row.summary, '未打开');
    });

    test('B2: 打开了但空数据的来源记 empty', () => {
        const row = financeSourceRow('wallet', { ok: true, state: 'empty', accounts: [], tx: [], count: 0, txCount: 0 });
        assert.equal(row.state, 'empty');
        assert.equal(row.balance, null);
    });

    test('B3: 打开了且有数据的来源记 ready', () => {
        const row = financeSourceRow('wallet', { ok: true, state: 'ready', accounts: [{ name: '微信', amount: 500 }], tx: [], count: 1, txCount: 1 });
        assert.equal(row.state, 'ready');
        assert.equal(row.balance, 500);
        assert.equal(row.txCount, 1);
    });

    test('B4: buildFinanceOverview 不产生跨来源总余额', () => {
        const overview = buildFinanceOverview({
            wallet: { ok: true, state: 'ready', accounts: [{ amount: 3000 }], tx: [], count: 1, txCount: 1 },
            piggy: null,  // not-opened
        });
        // 不应该有 total / totalBalance 等跨来源求和字段
        assert.equal(overview.totalBalance, undefined);
        assert.equal(overview.total, undefined);
        assert.equal(overview.rows.length, 7);
        assert.equal(overview.readyCount, 1);
        assert.equal(overview.notOpenedCount, 6);  // 其余 6 个都没打开
        assert.ok(overview.gaps.some(g => g.source === 'piggy' && g.reason === 'not-opened'));
    });

    test('B5: 全部未打开时 gaps 覆盖所有来源', () => {
        const overview = buildFinanceOverview({});
        assert.equal(overview.readyCount, 0);
        assert.equal(overview.notOpenedCount, 7);
        assert.equal(overview.gaps.length, 7);
    });
});

describe('[C] 账本 · 幂等/撤回/截断', () => {
    test('C1: 幂等键同参同值', () => {
        const k1 = settlementIdemKey('traveldesk', 'd1', '2026-01-01');
        const k2 = settlementIdemKey('traveldesk', 'd1', '2026-01-01');
        assert.equal(k1, k2);
        assert.equal(k1, 'traveldesk:d1:2026-01-01');
    });

    test('C2: 幂等键不同参不同值', () => {
        const k1 = settlementIdemKey('traveldesk', 'd1', '2026-01-01');
        const k2 = settlementIdemKey('traveldesk', 'd2', '2026-01-01');
        assert.notEqual(k1, k2);
    });

    test('C3: 去重 + 截断', () => {
        const big = [];
        for (let i = 0; i < FINANCE_LEDGER_LIMIT + 5; i++) {
            big.push({ idemKey: 'k' + i, source: 'traveldesk', action: 'commit', at: i });
        }
        // 插入重复
        big.push({ idemKey: 'k0', source: 'traveldesk', action: 'commit', at: 99 });
        const norm = normalizeFinanceLedger(big);
        assert.equal(norm.entries.length, FINANCE_LEDGER_LIMIT);
        assert.ok(norm.dropped >= 6);  // 5 个超限 + 1 个重复
    });

    test('C4: diff 新提交/重复/撤回三态分离', () => {
        const prev = [
            { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 1 },
        ];
        const curr = [
            { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 2 },  // replay
            { idemKey: 'x:y:z', source: 'traveldesk', action: 'commit', at: 3 },  // new
        ];
        const diff = diffFinanceLedger(prev, curr);
        assert.equal(diff.newCommits.length, 1);
        assert.equal(diff.replays.length, 1);
        assert.equal(diff.revoked.length, 0);
    });

    test('C5: apply 新提交写入账本', () => {
        const prev = [{ idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 1 }];
        const applied = applyFinanceLedger(prev, [{ idemKey: 'x:y:z', source: 'traveldesk', action: 'commit', at: 3 }], []);
        assert.equal(applied.count, 2);
    });

    test('C6: apply 撤回删除对应条目', () => {
        const prev = [
            { idemKey: 'a:b:c', source: 'traveldesk', action: 'commit', at: 1 },
            { idemKey: 'x:y:z', source: 'traveldesk', action: 'commit', at: 2 },
        ];
        const applied = applyFinanceLedger(prev, [], ['a:b:c']);
        assert.equal(applied.count, 1);
        assert.equal(applied.entries[0].idemKey, 'x:y:z');
    });

    test('C7: 归一化坏条目丢弃', () => {
        const raw = [null, {}, { idemKey: '', source: 'x' }, { idemKey: 'valid', source: 'x', action: 'commit', at: 1 }];
        const norm = normalizeFinanceLedger(raw);
        assert.equal(norm.entries.length, 1);
        assert.equal(norm.entries[0].idemKey, 'valid');
        assert.equal(norm.dropped, 3);
    });
});

describe('[D] 草稿 · suggestion ≠ fact', () => {
    test('D1: 草稿 certainty 为 suggestion', () => {
        const draft = travelSettlementDraft([], [], []);
        assert.equal(draft.certainty, 'suggestion');
        assert.equal(draft.committed, false);
        assert.ok(draft.note.includes('建议'));
    });

    test('D2: 草稿不落账（committed = false）', () => {
        const draft = travelSettlementDraft([{ amount: 100 }], ['Alice', 'Bob'], []);
        assert.equal(draft.committed, false);
        assert.equal(draft.balances, null);
        assert.equal(draft.internal, null);
    });

    test('D3: fillSettlementDraft 填充后草稿仍标 suggestion', () => {
        const draft = travelSettlementDraft([], [], []);
        const filled = fillSettlementDraft(draft, {
            balances: { Alice: 100, Bob: -100 },
            internal: { transfers: [{ from: 'Bob', to: 'Alice', amount: 100 }], balanced: true },
            external: [],
            readings: { expenses: 1, people: 2 }
        });
        assert.equal(filled.certainty, 'suggestion');
        assert.equal(filled.committed, false);
        assert.deepEqual(filled.balances, { Alice: 100, Bob: -100 });
        assert.equal(filled.internal.transfers.length, 1);
    });

    test('D4: fillSettlementDraft 不改原草稿', () => {
        const draft = travelSettlementDraft([], [], []);
        fillSettlementDraft(draft, { balances: { x: 1 } });
        assert.equal(draft.balances, null);  // 原始不变
    });
});

describe('[V] 版本与导出面', () => {
    test('V1: 版本下限 3.68.0', () => {
        const ver = MANIFEST.version;
        const [major, minor] = ver.split('.').map(Number);
        assert.ok(major === 3 && minor >= 68, '版本应 >= 3.68.0，实际 ' + ver);
    });

    test('V2: 导出面恒定 13 个（不含 default）', async () => {
        const mod = await import('../config/finance-overview.js');
        const keys = Object.keys(mod).filter(k => k !== 'default');
        assert.equal(keys.length, 13);
        // 核心导出必须在
        assert.ok(keys.includes('FINANCE_SOURCES'));
        assert.ok(keys.includes('buildFinanceOverview'));
        assert.ok(keys.includes('travelSettlementDraft'));
        assert.ok(keys.includes('financeSourceSelfCheck'));
        assert.ok(keys.includes('financeLedgerSelfCheck'));
    });
});
