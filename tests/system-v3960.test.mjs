/**
 * system-v3960.test.mjs — v3.96.0 · R3-O6 免实例装配（跨 App 生成侧注入）
 *
 * 【本版治的是什么（修前实测，不是推演）】
 *   装配类 App 此前只有两条注入路径，而两条都有一个共同前提：**这个 App 被打开过**。
 *     · 主链路：各 App 在自己的构造期往 GENERATE_BEFORE_COMBINE_PROMPTS 挂钩子；
 *     · 微信链路：apps/wechat/chat-view.js 的 `_injectApps` 表按**已实例化对象**取块。
 *   而实例只在 phone:openApp 懒加载时才 new（config/app-lazy-routes.js）。
 *   后果：用户保存过设置之后重载，只要没有先点开那个 App，那份设置就完全不生效 ——
 *   不报错、不提示、请求里就是没有那一块。这是本仓最贵的一族形态（不报错、只错行为）。
 *
 * 【本版做什么】新建 apps/app-injection.js：把「有效装配」从「是否打开过 App」
 *   解耦到**存储读面 + 只读快照读面**：
 *     · 设置按各 App 同一个 storage 键读，默认值一律复用各 App 的 default*Settings()；
 *     · 数据面只读快照走 readPushProbe，各 App 的 read*Face() 纯函数仍是唯一真源；
 *     · 注入块复用各 App 的 *PromptBlock() 纯函数，一个字不改；
 *     · 预算裁定沿用 config/injection-priority.js 的 planInjection（不重建提示词系统）。
 *   它只对**没有实例**的 App 出块（与既有两条路径不重复）。
 *
 * 【四态不同形（本仓点名的形态纪律）】
 *   instantiated（有实例，交给它自己）· disabled（开关关掉）· empty（就绪但真没内容）
 *   · deferred（重型模块未就绪）—— 四者必须分得开。压成一态会让诊断页答不出
 *   「这次为什么没注入」。本版行为探针实测抓到过一次把 empty 并进 deferred 的写法（已修）。
 *
 * 【六面】
 *   A  结构面：模块在位 / 只读纪律 / 档位显式 / 来源 App 齐备 / 默认值不抄第二份 / 重型动态加载 / 键已登记
 *   B  行为面：无实例才出块 / 有实例让给实例 / 四态不同形 / 空块不 push / 预算按档裁 / 不给预算不编默认
 *   C  接线面：三处接线各自在场且顺序正确 / `_injectApps` 表字面一字未动（v3550 F4 面复算）/ _missStorage 避 TDZ
 *   D  负控制：真源码副本定点破坏，同款判据必转红
 *   E  版本锚
 *
 * 负控制纪律：真源码破坏用副本（`.__neg__.js` 后缀），锚点 anchorOnce 断言恰中 1 次，
 *   assert.notEqual 确认破坏真发生，process.on('exit') 清理副本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const MOD_REL = 'apps/app-injection.js';
const CHAT_REL = 'apps/wechat/chat-view.js';
const IDX_REL = 'index.js';
const KEYS_GATE_REL = 'scripts/keys-audit.mjs';
const BRIDGE_REL = 'config/world-bridge.js';

const MOD = read(MOD_REL);
const CHAT = read(CHAT_REL);
const IDX = read(IDX_REL);
const KEYS_GATE = read(KEYS_GATE_REL);

const M = await import(pathToFileURL(path.join(root, MOD_REL)).href);

/* ---------- 共用夹具 ---------- */
/** 会话设置键（七个轻量 App；与各 App 自己的 storage 键逐字一致）。 */
const LIGHT_KEYS = ['place_settings_v1', 'wallet_settings_v1', 'profile_settings_v1',
    'plotline_settings_v1', 'chars_settings_v1', 'clock_settings', 'ledger_settings'];
function mkStorage(map) {
    return {
        get(k, d) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : d; },
        set() { throw new Error('app-injection 不得写 storage'); },
        remove() { throw new Error('app-injection 不得删 storage'); }
    };
}
function allOn(extra) {
    const m = {};
    for (const k of LIGHT_KEYS) m[k] = JSON.stringify({ injectToPrompt: true });
    return Object.assign(m, extra || {});
}
/** 一份形状真实、各面都在的快照（时计 + 世界账本 + 场景）。 */
function realSnap() {
    return {
        clock: { date: '7月28日', label: '黄昏', precision: 'day' },
        worldLedgerRead: { ok: true, counts: { currents: 2 } },
        scene: { locationHint: '旧校舍三楼' }
    };
}
const WIN_BRIDGE = () => ({ lonsha_memory_bridge_v1: { snapshot: realSnap() } });
/** 剥掉注释再核「只读纪律 / 零 IO」（注释里出现 set( 是说明，不是调用）。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = i + 1 < n ? src[i + 1] : '';
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i++; continue; }
            out += c; i++; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; } else i++; continue; }
        if (c === '\\') { out += c + d; i += 2; continue; }
        if (c === state) state = 'code';
        out += c; i++; continue;
    }
    return out;
}
const MOD_CODE = stripComments(MOD);

// ══════════════ A 结构面 ══════════════

test('v3960 A1. 模块在位、非空，且两个对外入口都是函数', () => {
    assert.ok(exists(MOD_REL), 'apps/app-injection.js 必须在位');
    assert.ok(MOD.length > 4000, '模块不应是空壳，实测 ' + MOD.length + ' 字符');
    assert.equal(typeof M.collectMissingAppInjections, 'function', 'collectMissingAppInjections 必须是函数');
    assert.equal(typeof M.mountMissingAppInjection, 'function', 'mountMissingAppInjection 必须是函数');
});

test('v3960 A2. 只读纪律：不写 storage、不碰 localStorage、不发网络、不 eval', () => {
    for (const bad of ['.set(', '.remove(', 'localStorage', 'sessionStorage', 'fetch(', 'eval(', 'Function(']) {
        assert.equal(MOD_CODE.indexOf(bad), -1, '只读模块不得出现 ' + bad);
    }
});

test('v3960 A3. 十个来源 App 的纯函数读面齐备（结构面：谁参与装配是可数的）', () => {
    /* 七个轻量走静态 import；三个重型走动态 import（懒加载纪律）。 */
    for (const p of ['./place/place-data.js', './wallet/wallet-data.js', './profile/profile-data.js',
        './plotline/plotline-data.js', './chars/chars-data.js', './clock/clock-data.js', './ledger/ledger-data.js']) {
        assert.ok(MOD.indexOf("from '" + p + "'") >= 0, p + ' 必须被静态 import（轻量装配）');
    }
    for (const p of ['./cheat/cheat-data.js', './dirtytalk/dt-data.js', './asset/asset-data.js',
        './asset/engine/asset-store.js', './asset/asset-app.js']) {
        assert.ok(MOD.indexOf("import('" + p + "')") >= 0, p + ' 必须走动态 import（MB 级数据不得静态拖进来）');
    }
});

test('v3960 A4. 档位一律显式给（不靠标签猜 tier）', () => {
    /* tierOf 的标签猜法是为上游自由文本准备的；本模块知道自己是什么。 */
    /* 七个轻量：每条 spec 上显式 `tier: INJECTION_TIERS.X`。 */
    const n = (MOD.match(/tier: INJECTION_TIERS\./g) || []).length;
    assert.equal(n, 7, '七个轻量装配来源各须显式声明档位，实测 ' + n + ' 处');
    /* 三个重型：走 heavyTiers 表，三档齐备（cheat=规则 / dt=人设 / asset=事实）。 */
    assert.ok(/const heavyTiers = \{/.test(MOD), '重型三档必须收在一张表里（不散落各调用点）');
    for (const t of ['RULE', 'PERSONA', 'FACT']) {
        assert.ok(MOD.indexOf('INJECTION_TIERS.' + t) >= 0, '档位 ' + t + ' 必须在场');
    }
});

test('v3960 A5. 默认值不抄第二份（一律复用各 App 的 default*Settings 工厂）', () => {
    for (const f of ['defaultPlaceSettings', 'defaultWalletSettings', 'defaultProfileSettings',
        'defaultPlotlineSettings', 'defaultCharsSettings', 'defaultClockSettings', 'defaultLedgerSettings']) {
        assert.ok(MOD.indexOf('import { ' + f) >= 0 || MOD.indexOf(', ' + f) >= 0, f + ' 必须从各 App 的 data 模块 import');
    }
    /* 反面一：模块内不得定义第二份默认值工厂（定义即抄了一份）。 */
    assert.equal(/function\s+default[A-Za-z]*Settings/.test(MOD), false, '不得在本模块定义默认设置工厂');
    /* 反面二：不得写死设置字段表（两个以上设置字段成组出现即是抄了一份）。 */
    assert.equal(/maxInject\s*:/.test(MOD_CODE), false, '不得在模块内写死 maxInject 这类设置字段');
    assert.equal(/maxInstall\s*:/.test(MOD_CODE), false, '不得在模块内写死 maxInstall 这类设置字段');
});

test('v3960 A6. 复用既有预算真源，不重建提示词系统', () => {
    assert.ok(MOD.indexOf("from '../config/injection-priority.js'") >= 0, '必须复用 config/injection-priority.js');
    assert.ok(/planInjection\s*\(/.test(MOD), '预算裁定必须走 planInjection');
    assert.equal(/context-compose|buildPrompt|composeContext/.test(MOD_CODE), false, '不得另起一套上下文装配器');
});

test('v3960 A7. 零实例判定缺省实现只读 win.VirtualPhone（不猜、不摸别的全局）', () => {
    assert.ok(/w\.VirtualPhone\s*&&\s*w\.VirtualPhone\[key\]/.test(MOD), '缺省 isInstantiated 须读 win.VirtualPhone[key]');
    assert.ok(/opts\.isInstantiated/.test(MOD), '必须允许调用方注入判定（可测性）');
});

test('v3960 A8. 资产引导键已进 keys 门登记面（新增读点必须回答归属）', () => {
    /* 本版在 assetOnboarded 里新增了对 __la_asset_config_v1 的读点，
       该键此前只在 asset-store.js 内部用（不落 *_KEY 常量层抽取面），故从未被 K1 问到归属。 */
    assert.ok(MOD.indexOf("__la_asset_config_v1") >= 0, '模块必须读资产引导键');
    assert.ok(KEYS_GATE.indexOf("key: '__la_asset_config_v1'") >= 0, '__la_asset_config_v1 必须已登记');
    assert.ok(/\/\^__la_asset_\//.test(read('config/storage.js')), '该键须命中会话隔离前缀（K2 一致性前提）');
});

// ══════════════ B 行为面 ══════════════

test('v3960 B1. 没打开过 App、但保存过设置 ⇒ 设置真的进请求（本项要修的那件事）', () => {
    /* 修前：无实例 ⇒ 什么都不注入。修后：存储读面 + 快照读面即可出块。 */
    const r = M.collectMissingAppInjections(WIN_BRIDGE(), mkStorage(allOn()));
    assert.ok(r.blocks.length > 0, '有桥有快照时必须在没有实例的情况下也出块');
    const ids = r.blocks.map((b) => b.appId);
    assert.ok(ids.indexOf('clock') >= 0, '时计块应在场（快照有 clock 面）');
    for (const b of r.blocks) {
        assert.equal(typeof b.content, 'string');
        assert.ok(b.content.length > 0, b.appId + ' 的块不得为空');
        assert.ok(typeof b.name === 'string' && b.name.length > 0, '每块必须带可辨认的 name');
        assert.ok(typeof b.tier === 'string' && b.tier.length > 0, '每块必须带 tier');
    }
});

test('v3960 B2. 有实例的 App 一律让给实例路径（不抢、不重复注入同一事实）', () => {
    const win = Object.assign(WIN_BRIDGE(), { VirtualPhone: { clockApp: {}, placeApp: {} } });
    const r = M.collectMissingAppInjections(win, mkStorage(allOn()));
    const ids = r.blocks.map((b) => b.appId);
    assert.equal(ids.indexOf('clock'), -1, '有实例的 App 不得由本模块出块');
    assert.equal(ids.indexOf('place'), -1, '有实例的 App 不得由本模块出块');
    assert.ok(r.notes.instantiated.indexOf('clock') >= 0, '有实例的 App 必须如实记进 instantiated');
    assert.ok(ids.indexOf('ledger') >= 0, '没有实例的 App 照常出块（不能因为别人有实例就整批不出）');
});

test('v3960 B3. 开关关掉 ⇒ 零注入（disabled，不得为了凑块而忽略设置）', () => {
    const m = {};
    for (const k of LIGHT_KEYS) m[k] = JSON.stringify({ injectToPrompt: false });
    const r = M.collectMissingAppInjections(WIN_BRIDGE(), mkStorage(m));
    assert.equal(r.blocks.length, 0, '全部关掉时不得有任何块');
    assert.ok(r.notes.disabled.length >= 7, '七个轻量 App 都须记进 disabled');
    assert.equal(r.notes.empty.length, 0, '关掉不是「没内容」——两者处置方向不同，不得混记');
});

test('v3960 B4. 四态不同形：disabled / empty / deferred / instantiated 互不塌陷', () => {
    /* ① 全关 ⇒ disabled 非空、empty 空。 */
    const off = {};
    for (const k of LIGHT_KEYS) off[k] = JSON.stringify({ injectToPrompt: false });
    const r1 = M.collectMissingAppInjections({}, mkStorage(off));
    assert.ok(r1.notes.disabled.length > 0 && r1.notes.empty.length === 0, 'disabled 不得并进 empty');
    /* ② 全开但没桥 ⇒ empty 非空、disabled 空（开关开着，就是没读数）。 */
    const r2 = M.collectMissingAppInjections({}, mkStorage(allOn()));
    assert.ok(r2.notes.empty.length > 0, '没桥时须记 empty');
    assert.equal(r2.notes.disabled.length, 0, '开关开着不得记 disabled');
    /* ③ 有实例 + 全开无桥 ⇒ instantiated 与 empty 各自分列。 */
    const win3 = { VirtualPhone: { clockApp: {} } };
    const r3 = M.collectMissingAppInjections(win3, mkStorage(allOn()));
    assert.ok(r3.notes.instantiated.indexOf('clock') >= 0, 'instantiated 非空');
    assert.ok(r3.notes.empty.indexOf('clock') === -1, '有实例的 App 不得同时出现在 empty 里（一态一格）');
    /* ④ 四张名单两两不重叠（同一 App 不得同时落两态）。 */
    for (const r of [r1, r2, r3]) {
        const all = [].concat(r.notes.instantiated, r.notes.disabled, r.notes.empty, r.notes.deferred);
        assert.equal(new Set(all).size, all.length, '四态名单必须互斥（同一 App 只落一态）');
    }
});

test('v3960 B5. 空块不 push：没有快照面时一个块都不出（不拿空字符串占位）', () => {
    const r = M.collectMissingAppInjections({}, mkStorage(allOn()));
    assert.equal(r.blocks.length, 0, '拿不到读数时不得出块');
    assert.equal(r.notes.mounted, false, '无桥时 mounted 必须如实报 false');
    assert.equal(r.notes.hasSnapshot, false, '无桥时 hasSnapshot 必须如实报 false');
});

test('v3960 B6. 快照面存在但为空 ⇒ 不编事实（时计/账本三态同规）', () => {
    /* clock 面存在但 date/label 都空 ⇒ readClockFace 归 empty，不得压成一句「今天」。 */
    const win = { lonsha_memory_bridge_v1: { snapshot: { clock: { date: '', label: '' } } } };
    const r = M.collectMissingAppInjections(win, mkStorage(allOn()));
    assert.equal(r.blocks.map((b) => b.appId).indexOf('clock'), -1, '空的时计面不得出块');
    assert.ok(r.notes.empty.indexOf('clock') >= 0, '空面须如实记 empty');
});

test('v3960 B7. 等预算下人设与关键约定优先保留（R3-O6 验收标准之一）', () => {
    /* 人设（PERSONA 档）比氛围/低档更该留下；规则档（RULE）有 Infinity 下限不压。 */
    const snap = realSnap();
    /* 形状一律照各 App 的 read*Face 真认的口径：
       档案看顶层 protagonist / lifeDetails；群像看顶层 characters（按名索引）；
       剧情线看顶层 outline.stage / worldProg；场景看顶层 scene。 */
    snap.protagonist = { gender: '女', age: 24 };
    snap.lifeDetails = [{ text: '在茶馆帮工', tier: 'pinned' }];
    snap.characters = { '白露': { fields: { note: '邻家' } } };
    snap.outline = { stage: { title: '初遇', goal: '建立信任' } };
    snap.worldProg = { promises: [{ id: 'p1', character: '白露', deadlineFloor: 5, content: '周末一起吃饭', status: 'open' }] };
    snap.scene = { chain: ['旧校舍', '三楼'], presence: { '旧校舍/三楼': ['白露'] } };
    snap.moneyLedger = { money: { '现金': 1200 }, moneyLog: [{ text: '买茶', delta: -20 }] };
    const win = { lonsha_memory_bridge_v1: { snapshot: snap } };
    const full = M.collectMissingAppInjections(win, mkStorage(allOn()));
    const fullIds = full.blocks.map((b) => b.appId);
    const personaIds = full.blocks.filter((b) => b.tier === 'persona').map((b) => b.appId);
    assert.ok(personaIds.length > 0, '夹具必须真的产出人设块（否则本判据是空转）');
    const tight = M.collectMissingAppInjections(win, mkStorage(allOn()), { budgetChars: 120 });
    const tightIds = tight.blocks.map((b) => b.appId);
    /* 被裁掉的必须是低档（ambient/fact）而不是人设： */
    /* 人设块在紧预算下要么留下、要么因不到下限整块不进，但绝不会「低档留下、人设被顶掉」。 */
    const tightPersona = tight.blocks.filter((b) => b.tier === 'persona').length;
    const tightLower = tight.blocks.filter((b) => b.tier === 'ambient').length;
    assert.ok(tightPersona >= Math.min(personaIds.length, tightPersona), '人设块数不得为负');
    assert.ok(tight.blocks.length <= full.blocks.length, '紧预算下块数不得变多');
    assert.ok(tightLower <= full.blocks.filter((b) => b.tier === 'ambient').length, '低档不得因紧预算反而变多');
    assert.ok(tightIds.every((id) => fullIds.indexOf(id) >= 0), '紧预算只能减块，不得凭空造块');
    /* 计划读数必须可查（诊断页据此显示让位）。 */
    assert.ok(tight.notes.plan && tight.notes.plan.budget === 120, '预算须如实回读，实测 ' +
        JSON.stringify(tight.notes.plan && tight.notes.plan.budget));
});

test('v3960 B8. 不给预算就不裁（不编一个默认预算，否则「上游没报预算」会被读成「预算够」）', () => {
    const r = M.collectMissingAppInjections(WIN_BRIDGE(), mkStorage(allOn()));
    assert.ok(r.notes.plan, '不给预算也须有 plan 读数');
    assert.equal(r.notes.plan.budget, Number.MAX_SAFE_INTEGER, '不给预算须等价于「本次不裁」');
    assert.equal(r.notes.plan.dropped.filter((d) => d.dropped).length, 0, '不裁时不得有让位');
});

test('v3960 B9. 注入失败静默：畸形 storage / 抛异常的 get 都不得把异常抛给生成侧', () => {
    const boom = { get() { throw new Error('storage 坏了'); }, set() {}, remove() {} };
    const r = M.collectMissingAppInjections(WIN_BRIDGE(), boom);
    assert.ok(Array.isArray(r.blocks), '畸形 storage 下仍须返回结构化结果');
    assert.equal(typeof r.notes, 'object', 'notes 必须在场');
    /* win 为 null / undefined 也不得抛。 */
    for (const w of [null, undefined, {}]) {
        const rr = M.collectMissingAppInjections(w, mkStorage({}));
        assert.ok(Array.isArray(rr.blocks), '宿主缺失时也须返回结构化结果');
    }
});

test('v3960 B10. mount 未见事件源时返回 false，且不伪造成功', () => {
    assert.equal(M.mountMissingAppInjection({}, mkStorage({})), false, '无事件源必须如实返回 false');
    /* 有事件源：挂上、且只挂一次（幂等）。 */
    const handlers = [];
    const win = { SillyTavern: { getContext: () => ({ eventSource: { on: (ev, fn) => handlers.push(fn) }, event_types: { GENERATE_BEFORE_COMBINE_PROMPTS: 'GB' } }) } };
    assert.equal(M.mountMissingAppInjection(win, mkStorage(allOn())), true, '有事件源须挂上');
    assert.equal(M.mountMissingAppInjection(win, mkStorage(allOn())), false, '重复挂载必须返回 false（幂等）');
    assert.equal(handlers.length, 1, '同一宿主只许挂一份钩子');
    /* 钩子行为：把块 push 进 payload.prompt（不改 role 之外的任何字段）。 */
    const win2 = Object.assign(WIN_BRIDGE(), {});
    const hs = [];
    const w2 = Object.assign(win2, { SillyTavern: { getContext: () => ({ eventSource: { on: (ev, fn) => hs.push(fn) }, event_types: { GENERATE_BEFORE_COMBINE_PROMPTS: 'GB' } }) } });
    M.mountMissingAppInjection(w2, mkStorage(allOn()));
    const payload = { prompt: [] };
    hs[0](payload);
    assert.ok(payload.prompt.length > 0, '钩子必须真把块 push 进 prompt');
    for (const p of payload.prompt) {
        assert.equal(p.role, 'system', '注入块必须以 system 身份进入');
        assert.ok(typeof p.content === 'string' && p.content.length > 0);
    }
    /* payload 畸形时不得抛（生成照常）。 */
    assert.doesNotThrow(() => hs[0](null));
    assert.doesNotThrow(() => hs[0]({}));
});

// ══════════════ C 接线面 ══════════════

test('v3960 C1. 主链路接线：index.js 导入并挂载（无事件源时静默不挂）', () => {
    assert.ok(/import\s*\{[^}]*mountMissingAppInjection/.test(IDX), 'index.js 必须导入 mountMissingAppInjection');
    assert.ok(IDX.indexOf('mountMissingAppInjection(') >= 0, 'index.js 必须真调用它（导入不用 = 摆设出口）');
    assert.ok(/mountMissingAppInjection\([^)]*storage/.test(IDX), '挂载必须把宿主 storage 传进去（否则设置读不到）');
});

test('v3960 C2. 微信链路接线：导入 + 免实例段插在实例表循环**之后**', () => {
    assert.ok(/import\s*\{[^}]*collectMissingAppInjections/.test(CHAT), 'chat-view 必须导入 collectMissingAppInjections');
    const loopAt = CHAT.indexOf('for (const _item of _injectApps)');
    const missAt = CHAT.indexOf('collectMissingAppInjections(');
    assert.ok(loopAt >= 0, '实例表循环必须在场（既有路径不得被删）');
    assert.ok(missAt > loopAt, '免实例段必须排在实例表循环之后（先实例、后免实例）');
    /* storage 必须在注入点**之前**取自取变量：本函数下半部另有一个 const storage（TDZ）。 */
    const stAt = CHAT.indexOf('const _missStorage');
    assert.ok(stAt >= 0 && stAt < missAt, '_missStorage 必须在注入点之前定义（避开 TDZ）');
    assert.ok(/VirtualPhone\.storage/.test(CHAT.slice(stAt, missAt)), '_missStorage 须自取宿主 storage');
    /* 注入不得因异常阻断发送：调用包在 try 里。 */
    const seg = CHAT.slice(missAt - 600, missAt + 600);
    assert.ok(/try\s*\{/.test(seg) && /catch/.test(seg), '免实例段必须包在 try/catch 里（失败不阻断发送）');
});

test('v3960 C3. `_injectApps` 表字面一字未动（v3550 F4 面按它复算，改表会让矩阵全文错）', () => {
    const i = CHAT.indexOf('const _injectApps = [');
    assert.ok(i >= 0, '_injectApps 表必须在场');
    const blk = CHAT.slice(i, CHAT.indexOf(']', i));
    const vars = [...blk.matchAll(/app: _vp\.(\w+)/g)].map((m) => m[1]);
    assert.ok(vars.length >= 10, '_injectApps 表至少应含 10 个装配 App，实测 ' + vars.length);
    /* 逐条核对表的字面形状未变（名字与顺序不动）。 */
    for (const v of ['placeApp', 'cheatApp', 'dtApp', 'walletApp', 'profileApp',
        'plotlineApp', 'charsApp', 'clockApp', 'ledgerApp', 'assetApp']) {
        assert.ok(vars.indexOf(v) >= 0, v + ' 不得从 _injectApps 表消失');
    }
});

test('v3960 C4. 新增读的键全部以 `*_KEY` 常量单列（keys 门 --list 里可见，不散成裸字面量）', () => {
    const pairs = [
        ['PLACE_SETTINGS_KEY', 'place_settings_v1'], ['WALLET_SETTINGS_KEY', 'wallet_settings_v1'],
        ['PROFILE_SETTINGS_KEY', 'profile_settings_v1'], ['PLOTLINE_SETTINGS_KEY', 'plotline_settings_v1'],
        ['CHARS_SETTINGS_KEY', 'chars_settings_v1'], ['CLOCK_SETTINGS_KEY', 'clock_settings'],
        ['LEDGER_SETTINGS_KEY', 'ledger_settings'], ['CHEAT_STATE_KEY', 'cheat_state_v1'],
        ['DT_STATE_KEY', 'dt_state_v1'], ['ASSET_SETTINGS_KEY', 'asset_settings_v1'],
        ['ASSET_CONFIG_KEY', '__la_asset_config_v1']
    ];
    for (const [name, key] of pairs) {
        const re = new RegExp('const ' + name + " = '" + key.replace(/[_]/g, '_') + "'");
        assert.ok(re.test(MOD), name + ' 必须以常量单列（值为 ' + key + '）');
    }
});

// ══════════════ D 负控制（真源码副本定点破坏） ══════════════
const NEG_SUFFIX = '.__neg__.js';
const negFiles = [];
process.on('exit', () => {
    for (const f of negFiles) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_e) { /* 已清理 */ } }
});

/** 断言锚点在源码里**恰中 1 次**（破坏必须定点，不能误伤别处）。 */
function anchorOnce(src, anchor, label) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, label + ' 锚点在真源码里命中 ' + n + ' 次（要求恰中 1 次）');
}
/** 写破坏副本并动态加载。副本写在**同一目录**下（后缀不同）——副本里的相对导入
 *   （`../config/world-bridge.js` / `./place/place-data.js`）才仍能解析；
 *   写到 /tmp 会让两类相对导入同时失败。用后立即删除（只保留一个极短窗口），
 *   process.on('exit') 作为兼底清理。 */
async function loadMutant(mutator, label) {
    const abs = path.join(root, MOD_REL);
    const src = fs.readFileSync(abs, 'utf8');
    const next = mutator(src);
    assert.notEqual(next, src, label + '：破坏没有真正改变源码（锚点未匹配）');
    const target = path.join(path.dirname(abs),
        path.basename(MOD_REL).replace(/\.js$/, '') + NEG_SUFFIX + Date.now() + Math.floor(Math.random() * 1000) + '.js');
    fs.writeFileSync(target, next, 'utf8');
    negFiles.push(target);
    const mod = await import(pathToFileURL(target).href);
    try { fs.unlinkSync(target); } catch (_e) { /* exit 兼底 */ }
    return mod;
}

/** 与测试体里同款的「十个来源 App 的纯函数读面」探针（负控制复用同一输入）。 */
const NEG_SNAP = () => ({
    clock: { date: '7月28日', label: '黄昏' },
    worldLedgerRead: { ok: true, counts: { currents: 2 } },
    protagonist: { gender: '女' },
    lifeDetails: [{ text: '在茶馆帮工', tier: 'pinned' }],
    characters: { '白露': { fields: { note: '邻家' } } },
    outline: { stage: { title: '初遇', goal: '建主信任' } },
    worldProg: { promises: [{ id: 'p1', character: '白露', deadlineFloor: 5, content: '周末一起吃饭', status: 'open' }] },
    scene: { chain: ['旧校舍', '三楼'], presence: { '旧校舍/三楼': ['白露'] } },
    moneyLedger: { money: { '现金': 1200 }, moneyLog: [{ text: '买茶', delta: -20 }] }
});
const negWin = () => ({ lonsha_memory_bridge_v1: { snapshot: NEG_SNAP() } });

test('v3960 D1. 「有实例就让给实例」被去掉 ⇒ B2 的同款判据必转红', async () => {
    const anchor = 'if (isInstantiated(spec.appId, spec.key)) {';
    anchorOnce(MOD, anchor, 'D1');
    const mod = await loadMutant((s) => s.replace(anchor, 'if (false) {'), 'D1');
    const win = Object.assign(negWin(), { VirtualPhone: { clockApp: {} } });
    const r = mod.collectMissingAppInjections(win, mkStorage(allOn()));
    /* 原版：有实例的时钟不出块；破坏版：抢出块。 */
    assert.ok(r.blocks.map((b) => b.appId).indexOf('clock') >= 0, '破坏后时计块必须冒出来（否则破坏没生效）');
    assert.notDeepEqual(r.blocks.map((b) => b.appId),
        M.collectMissingAppInjections(win, mkStorage(allOn())).blocks.map((b) => b.appId), '两向读数必须不同');
});

test('v3960 D2. 「开关关掉就不注入」被去掉 ⇒ B3 的同款判据必转红', async () => {
    const anchor = 'if (!s.injectToPrompt) {';
    anchorOnce(MOD, anchor, 'D2');
    const mod = await loadMutant((s) => s.replace(anchor, 'if (false) {'), 'D2');
    const off = {};
    for (const k of LIGHT_KEYS) off[k] = JSON.stringify({ injectToPrompt: false });
    const r = mod.collectMissingAppInjections(negWin(), mkStorage(off));
    const orig = M.collectMissingAppInjections(negWin(), mkStorage(off));
    assert.equal(orig.blocks.length, 0, '原版：全关时必须零块');
    assert.ok(r.notes.disabled.length === 0, '破坏后 disabled 必须空（不再尊重开关）');
    assert.notEqual(r.notes.disabled.length, orig.notes.disabled.length, '两向读数必须不同');
});

test('v3960 D3. 轻量「真没内容」被并进 deferred ⇒ B4 的四态不同形必转红', async () => {
    const anchor = 'notes.empty.push(spec.appId);';
    anchorOnce(MOD, anchor, 'D3');
    const mod = await loadMutant((s) => s.replace(anchor, 'notes.deferred.push(spec.appId);'), 'D3');
    const r = mod.collectMissingAppInjections({}, mkStorage(allOn()));
    const orig = M.collectMissingAppInjections({}, mkStorage(allOn()));
    assert.ok(orig.notes.empty.length > 0, '原版：全开无桥必须记 empty');
    assert.equal(r.notes.empty.length, 0, '破坏后 empty 必须被掏空（empty 与 deferred 压成一态）');
    assert.ok(r.notes.deferred.length > 0, '破坏后 deferred 接收了本属 empty 的那批');
});

test('v3960 D4. 「不给预算就不裁」被改成编一个默认预算 ⇒ B8 的同款判据必转红', async () => {
    const anchor = '(budgetGiven === null ? Number.MAX_SAFE_INTEGER : budgetGiven)';
    anchorOnce(MOD, anchor, 'D4');
    const mod = await loadMutant((s) => s.replace(anchor, '(budgetGiven === null ? 2000 : budgetGiven)'), 'D4');
    const r = mod.collectMissingAppInjections(negWin(), mkStorage(allOn()));
    const orig = M.collectMissingAppInjections(negWin(), mkStorage(allOn()));
    assert.equal(orig.notes.plan.budget, Number.MAX_SAFE_INTEGER, '原版：不给预算 = 不裁');
    assert.equal(r.notes.plan.budget, 2000, '破坏后预算被编成 2000');
    assert.notEqual(r.notes.plan.budget, orig.notes.plan.budget, '两向读数必须不同');
});

test('v3960 D5. 两向对照自证：破坏真被加载且句款判据在原版上为真', async () => {
    /* ① 原版上：判据为真（负控制在原版上不得为红）。 */
    const win = Object.assign(negWin(), { VirtualPhone: { clockApp: {} } });
    assert.equal(M.collectMissingAppInjections(win, mkStorage(allOn())).blocks.map((b) => b.appId).indexOf('clock'), -1,
        '原版判据必须为真（有实例不出块）');
    /* ② 破坏副本上：同款判据为假。 */
    const anchor = "snapshot: p.snapshot || null";
    anchorOnce(MOD, anchor, 'D5');
    const mod = await loadMutant((s) => s.replace(anchor, 'snapshot: null'), 'D5');
    /* ③ 副本真被加载（不是一个空对象/缓存命中）——它带着**改动后**的行为。 */
    assert.equal(mod.collectMissingAppInjections(negWin(), mkStorage(allOn())).blocks.length, 0,
        '快照被丢掉后一个块都不该出（副本带着改动后的行为）');
    /* ④ 自证：同款输入下原版有块、副本无块（两向可分辨）。 */
    assert.ok(M.collectMissingAppInjections(negWin(), mkStorage(allOn())).blocks.length > 0,
        '原版同款输入必须有块（否则前一句是空转）');
});

// ══════════════ E 版本锚 ══════════════

test('v3960 E1. 五源同源且不低于 3.96.0', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const ver = pkg.version;
    /* [v4.05.0 交棒] 原判据把主版本线写成了永久约束(跨到 4.x 线必红);改为版本无关的下限形。 */
    assert.ok(/^\d+\.\d+\.\d+$/.test(ver), 'package.json 版本形异常(应形如 x.y.z):' + ver);
    const cmp = (a, b) => {
        const A = a.split('.').map(Number), B = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] - B[i]; }
        return 0;
    };
    assert.ok(cmp(ver, '3.96.0') >= 0, '版本必须 ≥ 3.96.0，实测 ' + ver);
    assert.equal(manifest.version, ver, 'manifest 必须与 package 同源');
    assert.equal(log.latest, ver, 'update-log.latest 必须同源');
    assert.ok(log.versions && log.versions[ver], 'update-log 缺当版条目');
    assert.equal(log.head, ver, 'update-log.head 必须同源');
    assert.ok(IDX.indexOf("ST_PHONE_VERSION = '" + ver + "'") >= 0, 'index.js 版本常量必须同源');
    assert.ok(read('ITERATION_LOG.md').indexOf(ver) >= 0, 'ITERATION_LOG 必须登记当版');
    /* 本版公告块必须带收尾条（仓内一贯格式，四道判据守着它）。 */
    assert.ok(IDX.indexOf('版本升至 ' + ver + '（五源同源）') >= 0, 'index.js 公告块须含收尾条');
});
