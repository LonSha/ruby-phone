/**
 * system-v262.test.mjs — v2.62.0 全局搜索补源回归
 *
 * 背景：v2.16.0 的全局搜索只接了 17 个源，29 个 App 里有 12 个（武库/撩语/幸运转盘/
 *   生理/相册 + 桥面 档案/剧情线/群像/时计/世界账本/钱袋/地点）各自为政、全库零搜索接入。
 *   本轮把这 12 个补进 buildDefaultSources 的注册表。
 *
 * 本测试断言「真数据进来 → 真条数出去」：
 *   1) 本地键源（cheat/dt/gacha/health/album）在真实形态 seed 下产出条目；
 *   2) 桥面源（profile/plotline/chars/clock/ledger/wallet/place）经只读桥快照 seed 后产出条目；
 *   3) 无桥 / 无快照时桥面源安全返回 []（不抛，且不得污染既有源）；
 *   4) cheat/dt 经纯函数补名（未知 id 如实丢弃，与 sanitize 口径一致）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultSources, GlobalSearchEngine } from '../apps/memory/global-search-engine.js';

function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        _map: map,
        get(k, d = null) { return map.has(k) ? map.get(k) : d; },
        set(k, v) { map.set(k, v); },
        keys() { return [...map.keys()]; }
    };
}

/** 本地键源真实形态 seed（与写入端一致） */
function localSeed() {
    return {
        // 武库装配清单：id 经纯函数补名
        cheat_state_v1: JSON.stringify({ installed: ['ch001'] }),
        // 撩语装配清单
        dt_state_v1: JSON.stringify({ installed: ['dt_e92119'] }),
        // 幸运转盘抽卡历史
        ruby_gacha_state: JSON.stringify({
            coins: 500, inventory: {}, pullCount: 1,
            history: [{ at: 1758000000000, poolId: 'all', cost: 100, got: [{ name: '夜风瓶', quality: '稀有' }] }]
        }),
        // 生理周期（独立会话键，对象形态）
        ruby_health_cycle: {
            cycleDay: 14, isPregnant: false, stage: '排卵期', race: '人类',
            conditions: [{ name: '轻度偏头痛', severity: '轻度' }], fetuses: []
        },
        // 相册本地上传索引
        phone_album_upload_index: JSON.stringify([
            { path: '/backgrounds/phone_upload_test.png', prefix: '本地上传', createdAt: 1758000010000 }
        ])
    };
}

/** 桥快照真实形态 seed（lonsha_memory_bridge_v1.snapshot） */
function bridgeSnapshotSeed() {
    return {
        protagonist: { 姓名: '林晚照', 年龄: 24, 身份: '大学同学' },
        lifeDetails: [{ text: '常在江边跑步', tier: 'active', topics: ['跑步', '晨跑'] }],
        outline: { stage: { title: '初遇', goal: '重建联系', nodes: [{ title: '重逢', goal: '在江边遇到' }] } },
        worldProg: {
            promises: [{ character: '林晚照', content: '周末一起吃饭', status: 'open', deadlineFloor: 40 }],
            plotArcs: [{ title: '旧友重逢', clue: '一张老照片', status: 'active' }]
        },
        characters: {
            '林晚照': { fields: { 好感: 72, 情绪: '温柔' }, todos: [{ text: '回复消息' }], floor: 33, updatedAt: 1758000020000 }
        },
        clock: { date: '9月17日', label: '傍晚', precision: 'day', turn: 35, lastFlashback: null },
        worldLedgerRead: { ok: true, describe: '世界账本就绪', counts: { currents: 3, facts: 12, people: 5, opinionCanon: 2, opinionForum: 1 }, at: 1758000030000 },
        moneyLedger: { money: { wallet: { name: '钱包', amount: 1200, floor: 20 } }, moneyLog: [{ name: '钱包', desc: '买晚餐', delta: -40, floor: 34, timestamp: 1758000040000 }] },
        scene: {
            empty: false, absent: false,
            currentLine: '老城 › 钟楼 › 顶层',
            presence: [{ name: '林晚照', key: '老城/钟楼', atFloor: 33 }]
        }
    };
}

function withBridge(snapshot, fn) {
    const gw = globalThis.window;
    globalThis.window = snapshot == null
        ? { VirtualPhone: {} }
        : { VirtualPhone: {}, lonsha_memory_bridge_v1: { snapshot } };
    try { return fn(); } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
}

test('v262: 本地键源在真实 seed 下产出条目且经纯函数补名', () => {
    const storage = makeStorage(localSeed());
    const sources = buildDefaultSources(storage);
    const ids = new Set(sources.map(s => s.id));
    // 12 个新源全部登记
    for (const id of ['cheat', 'dirtytalk', 'gacha', 'health', 'album', 'profile', 'plotline', 'chars', 'clock', 'ledger', 'wallet', 'place']) {
        assert.ok(ids.has(id), `缺新源 ${id}`);
    }
    const itemsOf = (id) => {
        const src = sources.find(s => s.id === id);
        assert.ok(src, `无源 ${id}`);
        return src.items();
    };
    // 武库：ch001 补名为「赋能」（纯函数命中，非原始 id）
    const cheat = itemsOf('cheat');
    assert.ok(cheat.length >= 1, '武库应产出至少一条');
    assert.ok(cheat.some(c => c.title === '赋能'), '武库 id 应经纯函数补名为「赋能」：' + JSON.stringify(cheat.map(c => c.title)));
    // 撩语：dt_e92119 补名为「甜撩」
    const dt = itemsOf('dirtytalk');
    assert.ok(dt.some(c => c.title === '甜撩'), '撩语 id 应经纯函数补名为「甜撩」：' + JSON.stringify(dt.map(c => c.title)));
    // 幸运转盘：抽卡记录含道具名（道具名在 title，poolId/花费在 body）
    const gacha = itemsOf('gacha');
    assert.ok(gacha.length >= 1, '幸运转盘应产出抽卡记录');
    assert.ok(gacha[0].title.includes('夜风瓶'), '抽卡 title 应含道具名：' + gacha[0].title);
    assert.ok(gacha[0].body.includes('花费 100'), '抽卡 body 应含花费：' + gacha[0].body);
    // 生理：阶段 + 病症
    const health = itemsOf('health');
    assert.ok(health.some(h => h.title === '生理状态' && h.body.includes('排卵期')), '生理状态应含阶段：' + JSON.stringify(health));
    assert.ok(health.some(h => h.title === '病症：轻度偏头痛'), '生理应含病症条目');
    // 相册：本地上传
    const album = itemsOf('album');
    assert.ok(album.length >= 1 && album[0].title === 'phone_upload_test.png', '相册应索引本地上传：' + JSON.stringify(album.map(a => a.title)));
    // 无桥时桥面源全部安全返回 []（不抛）
    for (const id of ['profile', 'plotline', 'chars', 'clock', 'ledger', 'wallet', 'place']) {
        assert.deepEqual(itemsOf(id), [], `无桥时 ${id} 应返回 []`);
    }
});

test('v262: 桥面源经只读快照 seed 后产出条目', () => {
    const storage = makeStorage(localSeed());
    withBridge(bridgeSnapshotSeed(), () => {
        const sources = buildDefaultSources(storage);
        const itemsOf = (id) => sources.find(s => s.id === id).items();
        assert.ok(itemsOf('profile').some(i => i.title === '主角档案' && i.body.includes('林晚照')), '档案主角面');
        assert.ok(itemsOf('profile').some(i => i.title.includes('常在江边跑步')), '档案生活细节面');
        assert.ok(itemsOf('plotline').some(i => i.title === '初遇'), '剧情线当前阶段');
        assert.ok(itemsOf('plotline').some(i => i.title === '承诺：周末一起吃饭'), '剧情线承诺');
        assert.ok(itemsOf('plotline').some(i => i.title === '旧友重逢'), '剧情线支线');
        assert.ok(itemsOf('chars').some(i => i.title === '林晚照' && i.body.includes('好感:72')), '群像角色状态');
        assert.ok(itemsOf('clock').some(i => i.title === '9月17日'), '时计剧情时间');
        assert.ok(itemsOf('ledger').some(i => i.title === '世界账本' && i.body.includes('暗流 3')), '世界账本读数');
        assert.ok(itemsOf('wallet').some(i => i.title === '钱包' && i.body.includes('1200 元')), '钱袋账户余额');
        assert.ok(itemsOf('wallet').some(i => i.body.includes('买晚餐')), '钱袋流水');
        assert.ok(itemsOf('place').some(i => i.title === '当前位置' && i.body.includes('钟楼')), '地点位置链');
        assert.ok(itemsOf('place').some(i => i.title === '林晚照'), '地点在场');
    });
});

test('v262: 跨源检索命中补源数据（端到端）', () => {
    const storage = makeStorage(localSeed());
    withBridge(bridgeSnapshotSeed(), () => {
        const eng = new GlobalSearchEngine({ sources: buildDefaultSources(storage) });
        const hit = (q, src) => {
            const r = eng.query(q).results;
            assert.ok(r.length > 0, `查询「${q}」零命中`);
            assert.ok(r.some(x => x.sourceId === src), `「${q}」未命中源 ${src}：实际=${[...new Set(r.map(x => x.sourceId))].join(',')}`);
        };
        hit('赋能', 'cheat');
        hit('甜撩', 'dirtytalk');
        hit('夜风瓶', 'gacha');
        hit('排卵期', 'health');
        hit('常在江边跑步', 'profile');
        hit('初遇', 'plotline');
        hit('好感', 'chars');
        hit('钟楼', 'place');
        hit('买晚餐', 'wallet');
    });
});

test('v262: cheat 未知 id 如实丢弃，不编造', () => {
    const storage = makeStorage({ cheat_state_v1: JSON.stringify({ installed: ['no_such_pack_12345'] }) });
    const src = buildDefaultSources(storage).find(s => s.id === 'cheat');
    assert.deepEqual(src.items(), [], '未知 id 不得产出条目（与 sanitize 口径一致）');
});

test('v262: 桥快照畸形时桥面源不抛、坏数据不拖垮', () => {
    const storage = makeStorage(localSeed());
    // 快照各面塞畸形值
    withBridge({
        protagonist: null, lifeDetails: 'not-array',
        outline: { stage: 'not-object' }, worldProg: null,
        characters: 'not-object', clock: null,
        worldLedgerRead: { ok: false, reason: 'reader-unavailable' },
        moneyLedger: { money: 'not-object', moneyLog: 'not-array' },
        scene: { empty: true }
    }, () => {
        const sources = buildDefaultSources(storage);
        const eng = new GlobalSearchEngine({ sources });
        const built = eng.build();
        assert.ok(Array.isArray(built) && built.length > 0, '畸形桥面下既有源仍应可构建');
        assert.ok(eng.lastErrors().length === 0, '畸形桥面不应产生源级错误（应安全返回 []）：' + JSON.stringify(eng.lastErrors()));
    });
});

// ============================================================
// v2.62.0 第二片：记忆 App 覆盖度分页（floor-ledger 现算读数）
//   数据源 = window.LonShaFloorLedger.coverage(chat, opts)（上游公开冻结 api，纯读），
//   口径与上游引擎 _floorLedgerCoverage 一致：只数 AI 楼、番外楼与空楼不计、缺口逐楼归因。
// ============================================================
import { coverageRows } from '../apps/memory/memory-insights.js';
import { MemoryApp } from '../apps/memory/memory-app.js';
import { MemoryView } from '../apps/memory/memory-view.js';

test('v262b: coverageRows 投影真实读数（计数/归因排序/一行读数）', () => {
    const r = coverageRows({
        complete: false, total: 10, stamped: 8,
        missing: [3, 5], byWhy: { 'fingerprint-mismatch': 1, absent: 1 }
    });
    assert.equal(r.state, 'ok');
    assert.equal(r.total, 10);
    assert.equal(r.stamped, 8);
    assert.equal(r.missingCount, 2);
    assert.equal(r.rate, 0.8);
    assert.equal(r.complete, false);
    assert.deepEqual(r.missing, [3, 5]);
    assert.deepEqual(r.byWhy.map(b => b.why), ['absent', 'fingerprint-mismatch'], 'byWhy 应按 count 降序');
    assert.ok(r.line.includes('8/10 楼已盖章') && r.line.includes('缺 2') && r.line.includes('第 3,5 楼'), '一行读数：' + r.line);
    // 完整覆盖：无缺口
    const ok = coverageRows({ complete: true, total: 4, stamped: 4, missing: [], byWhy: {} });
    assert.equal(ok.complete, true);
    assert.equal(ok.rate, 1);
    assert.ok(ok.line.includes('无缺口'), '完整行：' + ok.line);
    // total=0 是真值，不是降级
    const zero = coverageRows({ complete: true, total: 0, stamped: 0, missing: [], byWhy: {} });
    assert.equal(zero.state, 'ok');
    assert.equal(zero.rate, null, 'total=0 不得编造比率');
});

test('v262b: coverageRows 三态不混同（不猜）', () => {
    // absent：模块未挂载（null）
    const a = coverageRows(null);
    assert.equal(a.state, 'absent');
    assert.ok(a.reason, 'absent 必须给原因');
    // unavailable：引擎给出 enabled:false
    const u = coverageRows({ enabled: false, reason: 'module-unavailable' });
    assert.equal(u.state, 'unavailable');
    assert.equal(u.reason, 'module-unavailable');
    // 形状异常：读数缺 total/stamped → 仍 absent，不编数
    const bad = coverageRows({});
    assert.equal(bad.state, 'absent');
    assert.equal(bad.rate, null);
    // 畸形 missing（非数组/含非数）不抛，逐项清洗
    const dirty = coverageRows({ total: 3, stamped: 2, missing: [1, 'x', null, 2], byWhy: null });
    assert.equal(dirty.state, 'ok');
    assert.deepEqual(dirty.missing, [1, 2]);
    // 投影自身不抛（throw 变体）
    const t = coverageRows({ get total() { throw new Error('boom'); } });
    assert.equal(t.state, 'unavailable');
    assert.equal(t.reason, 'coverage-rows-thrown');
});

test('v262b: MemoryApp.coverage() 经公开模块现算且口径与上游一致', () => {
    // ① 模块缺席 → unavailable（module-unavailable），不抛
    withBridge(null, () => {
        const app = new MemoryApp(null, makeStorage());
        const r = app.coverage();
        assert.equal(r.state, 'unavailable');
        assert.equal(r.reason, 'module-unavailable');
    });
    // ② 模块在位：锁口径（opts 与上游 _floorLedgerCoverage 逐项一致）+ 真读数投影
    let seenOpts = null;
    const chat = [
        { is_user: false, mes: 'AI 一楼' },
        { is_user: true, mes: '用户楼' },                                  // 应被 assistantOnly 排除
        { is_user: false, mes: '' },                                        // 空楼应被 skip 排除
        { is_user: false, mes: '番外楼', extra: { lonsha_omit: true } },     // 应被 omit 排除
        { is_user: false, mes: 'AI 四楼' }
    ];
    const FAKE_COV = { complete: false, total: 2, stamped: 1, missing: [3], byWhy: { absent: 1 } };
    const w = {
        VirtualPhone: {},
        LonShaFloorLedger: {
            coverage(c, opts) {
                assert.deepEqual(c, chat);
                seenOpts = opts;
                return FAKE_COV;
            }
        },
        SillyTavern: { getContext: () => ({ chat }) }
    };
    const gw = globalThis.window;
    globalThis.window = w;
    try {
        const app = new MemoryApp(null, makeStorage());
        const r = app.coverage();
        assert.equal(r.state, 'ok');
        assert.ok(seenOpts, 'coverage 必须被真实调用');
        assert.equal(seenOpts.upTo, chat.length - 1, 'upTo 必须是末楼下标');
        assert.equal(seenOpts.assistantOnly, true, 'assistantOnly 必须为 true（只数 AI 楼）');
        assert.equal(typeof seenOpts.omitFunction, 'function', 'omitFunction 必须在位（番外楼不计）');
        assert.equal(typeof seenOpts.skipFunction, 'function', 'skipFunction 必须在位（空楼不计）');
        assert.equal(seenOpts.omitFunction(chat[3]), true, '番外楼必须被识别为 omit');
        assert.equal(seenOpts.skipFunction(chat[2]), true, '空楼必须被识别为 skip');
        assert.equal(r.cov.state, 'ok');
        assert.equal(r.cov.total, 2);
        assert.equal(r.cov.stamped, 1);
    } finally {
        if (gw === undefined) delete globalThis.window; else globalThis.window = gw;
    }
    // ③ 宿主上下文不可得（getContext 抛错）→ absent
    const gw2 = globalThis.window;
    globalThis.window = { VirtualPhone: {}, LonShaFloorLedger: { coverage() { return FAKE_COV; } }, SillyTavern: { getContext: () => { throw new Error('no ctx'); } } };
    try {
        const app = new MemoryApp(null, makeStorage());
        const r = app.coverage();
        assert.equal(r.state, 'absent');
        assert.equal(r.reason, 'chat-context-unavailable');
    } finally {
        if (gw2 === undefined) delete globalThis.window; else globalThis.window = gw2;
    }
    // ④ coverage 抛错 → unavailable(thrown:…) 且不外抛
    const gw3 = globalThis.window;
    globalThis.window = {
        VirtualPhone: {},
        LonShaFloorLedger: { coverage() { throw new Error('boom'); } },
        SillyTavern: { getContext: () => ({ chat: [] }) }
    };
    try {
        const app = new MemoryApp(null, makeStorage());
        const r = app.coverage();
        assert.equal(r.state, 'unavailable');
        assert.ok(r.reason.startsWith('thrown:'), '抛错必须留痕：' + r.reason);
    } finally {
        if (gw3 === undefined) delete globalThis.window; else globalThis.window = gw3;
    }
});

test('v262b: 视图覆盖度页分态渲染（不编数、逐楼列号）', () => {
    const view = new MemoryView({ coverage: () => null });
    // ok：真读数 → 覆盖率 + 归因 + 缺楼号
    const okHtml = view._coverageHtml({
        coverage: {
            state: 'ok', total: 10, stamped: 8, missingCount: 2, rate: 0.8,
            complete: false, missing: [3, 5], byWhy: [{ why: 'absent', count: 1, label: '未落笔', icon: 'fa-feather' }],
            line: '8/10 楼已盖章 · 缺 2（第 3,5 楼）· 未落笔×1'
        }
    });
    assert.ok(okHtml.includes('80%'), '应显示覆盖率大数');
    assert.ok(okHtml.includes('第3楼') && okHtml.includes('第5楼'), '缺口须逐楼列号');
    assert.ok(okHtml.includes('未落笔'), '归因须有因由名');
    assert.ok(okHtml.includes('8/10 楼已盖章'), '一行读数须透出');
    // 完整覆盖 → 无缺口提示
    const doneHtml = view._coverageHtml({
        coverage: { state: 'ok', total: 4, stamped: 4, missingCount: 0, rate: 1, complete: true, missing: [], byWhy: [], line: '4/4 楼已盖章（无缺口）' }
    });
    assert.ok(doneHtml.includes('无缺口'), '完整覆盖须明示');
    // unavailable / absent：如实分态，不编数
    const uHtml = view._coverageHtml({ coverage: { state: 'unavailable', reason: 'module-unavailable' } });
    assert.ok(uHtml.includes('模块未加载'), 'unavailable 须明示模块缺席');
    const aHtml = view._coverageHtml({ coverage: { state: 'absent', reason: 'chat-context-unavailable' } });
    assert.ok(aHtml.includes('上下文不可得'), 'absent 须明示宿主不可得');
    const nHtml = view._coverageHtml({});
    assert.ok(nHtml.includes('已降级'), '缺数须降级提示');
});
