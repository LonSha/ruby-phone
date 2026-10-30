/* ============================================================
 * tests/system-v4960.test.mjs — v4.96.0 中枢清账第二批次判据档（计划 R11-O3）
 * ------------------------------------------------------------
 * 本批次处置两条链：
 *   ① recovery-hub / portable-recovery-hub → 接进 apps/backupdesk（拍点 / 差异 / 选择性还原 / 包体体检）
 *   ② rule-theatre                          → 接进 apps/theater（规则面板，独立于小剧场生成流）
 * 另有两条 orchestrator 包装方法（manageRecoverySnapshot / theatreRule）判为「假驱动」退役：
 *   它们把载荷当台账状态、把 id 字符串当快照对象、registerRule 少 state 参数，
 *   返回四个非空对象、看着全对，实际 keyCount=0。
 *
 * **本档最重要的那条负控制**：B2「键面读不到时不许拍空点」。
 *   上一批假驱动的失效形态就是「形状对、内容空」—— ok:true 且 keyCount=0。
 *   若本档只断言「拍得成功」，本档自己就会复制那个缺陷。故必须同时钉住：
 *   有数据时必须 keyCount > 0，读不到时必须 ok:false（而不是拍一个 0 键的点）。
 *
 * 判据分六面：
 *   A 键单一真源（App 与内核读同一个键，且字面量只有一处）
 *   B 拍点真的拍到东西（+ 读不到时拒绝拍空点）
 *   C 差异逐键分档（新增 / 变更 / 移除各归各位）
 *   D 选择性还原只写选定键（未选的一个字节都不动）+ 空选拒绝
 *   E 规则白名单：非法规格不落盘、合法规格可回读、回放只显示不代发
 *   F 接线自证与账本清账（源码面 + 两张账本）
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupdeskApp, RH_KEY } from '../apps/backupdesk/backupdesk-app.js';
import { TheaterApp, RT_KEY } from '../apps/theater/theater-app.js';
import { RH_MAX_SNAPSHOTS, createSnapshot, normalizeRecoveryState } from '../config/recovery-hub.js';
import { RULE_TRIGGERS, RULE_ACTIONS, RULE_OPERATORS, RT_MAX_RULES } from '../config/rule-theatre.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 内存存储：与真 PhoneStorage 同口径 —— 存的是**字符串**（这一条决定了回读必须解码）。 */
function makeStorage(init = {}) {
    const map = new Map();
    for (const [k, v] of Object.entries(init)) map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    return {
        map,
        get(k) { return map.has(k) ? map.get(k) : null; },
        set(k, v) { map.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; },
    };
}
/** 键面读得到的宿主（与 index.js 的 backupFace() 同形状）。 */
function makeHost(chatKeys, globalKeys) {
    return {
        readable: true,
        scope: { chatId: 'c1', branchKey: '' },
        scopeState: 'ok',
        keys: { readable: true, chat: chatKeys, global: globalKeys, why: '' },
        keysText: '会话面 ' + String(chatKeys.length) + ' 键',
        dimValues: {}, ledger: { readable: true, entries: [] },
        pack: null, plan: null, commit: null, undo: null,
    };
}
/** 把宿主挂上 window.VirtualPhone（本 App 的 host() 只认这一处）。 */
function mountHost(host) {
    globalThis.window = { VirtualPhone: { backupFace: () => host } };
}
/** 小剧场的壳：足够让 render() 跑过（不跑真 DOM）。 */
function makeTheaterShell() {
    const box = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    return { layerHost: () => box, screen: box };
}

/* ══════════════════════════════════════════════════════════════
 * A 键单一真源
 * ══════════════════════════════════════════════════════════════ */
test('A1: 快照键与规则键各只有一个字面量（App 侧不许有第二份手写副本）', () => {
    assert.equal(RH_KEY, 'rh_recovery_hub_v1');
    assert.equal(RT_KEY, 'rt_rules_state_v1');
    const bkSrc = read('apps/backupdesk/backupdesk-app.js');
    const countOf = (src, lit) => src.split(lit).length - 1;
    assert.equal(countOf(bkSrc, "'rh_recovery_hub_v1'"), 1,
        '快照键字面量在 backupdesk-app.js 里必须只有一处（RH_KEY 的声明处）');
    const thSrc = read('apps/theater/theater-app.js');
    assert.equal(countOf(thSrc, "'rt_rules_state_v1'"), 1,
        '规则键字面量在 theater-app.js 里必须只有一处（RT_KEY 的声明处）');
});

test('A2: 两个键都在 keys-audit 里登记过（未登记的键会在 keys 门被判红）', () => {
    const audit = read('scripts/keys-audit.mjs');
    for (const k of [RH_KEY, RT_KEY]) {
        assert.ok(audit.includes(k), 'keys-audit.mjs 必须登记 ' + k);
    }
});

test('A3: App 读写的是键常量而不是各自拼字符串（改动键名只改一处）', () => {
    const bkSrc = read('apps/backupdesk/backupdesk-app.js');
    // storage.get(RH_KEY) / writeReceipt(this.storage, RH_KEY, ...) 两种取法都算
    assert.ok(/storage\.get\(RH_KEY\)/.test(bkSrc), '读快照台账必须走 RH_KEY');
    assert.ok(/writeReceipt\(this\.storage,\s*RH_KEY/.test(bkSrc), '写快照台账必须走 RH_KEY');
    const thSrc = read('apps/theater/theater-app.js');
    assert.ok(/storage\.get\(RT_KEY\)/.test(thSrc), '读规则台账必须走 RT_KEY');
    assert.ok(/storage\.set\(RT_KEY/.test(thSrc), '写规则台账必须走 RT_KEY');
});

/* ══════════════════════════════════════════════════════════════
 * B 拍点真的拍到东西
 * ══════════════════════════════════════════════════════════════ */
test('B1: 拍点 keyCount 必须大于 0（这是上一批假驱动的直接反面）', () => {
    const st = makeStorage({ a: '1', b: '2', c: '3', g: '4' });
    mountHost(makeHost(['a', 'b', 'c'], ['g']));
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const r = app.captureSnapshot('第一次');
    assert.equal(r.ok, true, '应当拍得下去，实得 ' + r.note);
    assert.equal(r.snapshot.keyCount, 4, '4 个键都必须进包（会话 3 + 全局 1），实得 ' + r.snapshot.keyCount);
    // 负控制：把键面收窄到 1 个，keyCount 必须跟着变 —— 证明它真读了键面，不是写死常数
    mountHost(makeHost(['a'], []));
    const app2 = new BackupdeskApp(makeTheaterShell(), st);
    const r2 = app2.captureSnapshot('窄面');
    assert.equal(r2.snapshot.keyCount, 1, '窄键面必须只拍到 1 键，实得 ' + r2.snapshot.keyCount);
});

test('B2: 键面读不到时**拒绝拍空点**（不许交出一个 ok:true 且 keyCount=0 的点）', () => {
    const st = makeStorage({ a: '1' });
    // 未挂宿主：host() 返回 null
    globalThis.window = {};
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const r = app.captureSnapshot('无宿主');
    assert.equal(r.ok, false, '没有键面时不得报成功');
    assert.ok(/键面读不到/.test(r.note), '原因必须可读，实得 ' + r.note);
    assert.equal(st.map.has(RH_KEY), false, '拒绝时不得顺手写台账');

    // 宿主在、但键面自己说 readable:false —— 同样不许拍
    mountHost({
        readable: true, scope: {}, scopeState: 'ok',
        keys: { readable: false, chat: [], global: [], why: '存储层没有枚举口' },
    });
    const app2 = new BackupdeskApp(makeTheaterShell(), st);
    const r2 = app2.captureSnapshot('键面不可读');
    assert.equal(r2.ok, false, '键面 readable:false 时不得报成功');
});

test('B3: 拍点上限按 RH_MAX_SNAPSHOTS 挤掉最老的（不无限堆积）', () => {
    /* 内核的 id 是 `snap_${Date.now()}`：同一毫秒连拍会撞同一个 id 而互相覆盖
     *   （实测：13 次连拍只剩 3 条）。这是内核既有的 id 生成方式，本档不改它，
     *   但判据必须先把时间轴推起来 —— 否则测的是「id 碰撞」而不是「上限裁剪」，
     *   而且这条判据自己会变成假的（3 !== 10 的失败与上限毫无关系）。 */
    const realNow = Date.now;
    let t = realNow();
    Date.now = () => (t += 1000);
    try {
        const st = makeStorage({ a: '1' });
        mountHost(makeHost(['a'], []));
        const app = new BackupdeskApp(makeTheaterShell(), st);
        const made = [];
        for (let i = 0; i < RH_MAX_SNAPSHOTS + 3; i += 1) made.push(app.captureSnapshot('第' + String(i)).snapshot);
        const state = app._readSnapState().state;
        const ids = Object.keys(state.snapshots);
        assert.equal(ids.length, RH_MAX_SNAPSHOTS, '最多留 ' + String(RH_MAX_SNAPSHOTS) + ' 个，实得 ' + String(ids.length));
        assert.equal(RH_MAX_SNAPSHOTS, 10, '常量口径变了要回来看这条');
        // 「挤掉最老的」不是「随机丢一个」：最新的必须在，最早的必须不在
        assert.equal(state.snapshots[made[made.length - 1].id] !== undefined, true, '最新那一个必须在台账里');
        assert.equal(state.snapshots[made[0].id], undefined, '最老那一个必须已被挤掉');
        assert.equal(state.lastSnapshotId, made[made.length - 1].id, 'lastSnapshotId 必须指向最新');
    } finally {
        Date.now = realNow;
    }
});

/* ══════════════════════════════════════════════════════════════
 * C 差异逐键分档
 * ══════════════════════════════════════════════════════════════ */
test('C1: 差异把新增 / 变更 / 移除各归各位（不是「有差异」一句话）', () => {
    const st = makeStorage({ keep: 'K', gone: 'G', mod: 'old' });
    mountHost(makeHost(['keep', 'gone', 'mod'], []));
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const r = app.captureSnapshot('基线');
    assert.equal(r.ok, true);
    // 拍完之后改三件事：值变了、键没了、键多了
    st.set('mod', 'new');
    st.map.delete('gone');
    st.set('added', 'A');
    mountHost(makeHost(['keep', 'mod', 'added'], []));
    const app2 = new BackupdeskApp(makeTheaterShell(), st);
    const d = app2.diffSnapshot(r.snapshot.id);
    assert.equal(d.ok, true, '应当比得出来，实得 ' + d.note);
    assert.deepEqual(d.diff.modified, ['chat::mod'], '变更只能是 mod');
    assert.deepEqual(d.diff.added, ['chat::added'], '新增只能是 added');
    assert.deepEqual(d.diff.removed, ['chat::gone'], '移除只能是 gone');
    assert.equal(d.diff.diffCount, 3);
});

test('C2: 没有这个恢复点时如实报错，不返回空差异冒充「无差异」', () => {
    const st = makeStorage();
    mountHost(makeHost([], []));
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const d = app.diffSnapshot('snap_不存在');
    assert.equal(d.ok, false);
    assert.ok(/没有这个恢复点/.test(d.note), '实得 ' + d.note);
});

/* ══════════════════════════════════════════════════════════════
 * D 选择性还原
 * ══════════════════════════════════════════════════════════════ */
test('D1: 只写选定键 —— 未选的键一个字节都不动', () => {
    const st = makeStorage({ a: 'A0', b: 'B0', c: 'C0' });
    mountHost(makeHost(['a', 'b', 'c'], []));
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const snap = app.captureSnapshot('基线').snapshot;
    // 三个都改成新值
    st.set('a', 'A1'); st.set('b', 'B1'); st.set('c', 'C1');
    const res = app.restoreSnapshotKeys(snap.id, ['chat::a']);
    assert.equal(res.ok, true, '应当还原成功，实得 ' + res.note);
    assert.equal(res.wrote, 1, '只该写 1 键，实得 ' + String(res.wrote));
    assert.equal(app._decode(st.get('a')), 'A0', 'a 必须回到快照值');
    assert.equal(app._decode(st.get('b')), 'B1', 'b 未选中，必须保持新值');
    assert.equal(app._decode(st.get('c')), 'C1', 'c 未选中，必须保持新值');
    // 负控制：把 b 也选上，它才该被改回去（否则上面那条断言会因「谁都不写」自我实现）
    const res2 = app.restoreSnapshotKeys(snap.id, ['chat::b']);
    assert.equal(res2.ok, true);
    assert.equal(app._decode(st.get('b')), 'B0', '选中 b 后 b 必须回到快照值');
});

test('D2: 一个键都没选 → 拒绝还原（不许把「没选」当「全量」）', () => {
    const st = makeStorage({ a: 'A0' });
    mountHost(makeHost(['a'], []));
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const snap = app.captureSnapshot('基线').snapshot;
    st.set('a', 'A1');
    const r1 = app.restoreSnapshotKeys(snap.id, []);
    assert.equal(r1.ok, false, '空选必须拒绝');
    assert.ok(/一个键都没选/.test(r1.note), '实得 ' + r1.note);
    assert.equal(app._decode(st.get('a')), 'A1', '拒绝时不得改任何键');
    // 负控制：非数组 / 全是空串也要被挡
    assert.equal(app.restoreSnapshotKeys(snap.id, 'chat::a').ok, false, '字符串不是选择集');
    assert.equal(app.restoreSnapshotKeys(snap.id, ['', null, 3]).ok, false, '全非法键等于没选');
});

/* ══════════════════════════════════════════════════════════════
 * E 读不出 ≠ 空台账（两件事处置相反）
 * ══════════════════════════════════════════════════════════════ */
test('E1: 三条读失败路径各自点名（no_storage / bad_json / read_threw）', () => {
    const noStore = new BackupdeskApp(makeTheaterShell(), null);
    assert.equal(noStore._readSnapState().why, 'no_storage');
    assert.equal(noStore._readSnapState().readable, false);

    const badJson = makeStorage();
    badJson.map.set(RH_KEY, '{不是JSON');
    const appBad = new BackupdeskApp(makeTheaterShell(), badJson);
    assert.equal(appBad._readSnapState().why, 'bad_json');
    assert.equal(appBad._readSnapState().readable, false);
    // 读不出时拍点必须被拒（不是在坏台账上硬加一条）
    mountHost(makeHost(['a'], []));
    assert.equal(appBad.captureSnapshot('坏台账').ok, false);

    const threw = {
        get() { throw new Error('boom'); },
        set() { return true; },
    };
    const appThrew = new BackupdeskApp(makeTheaterShell(), threw);
    assert.equal(appThrew._readSnapState().why, 'read_threw');
});

test('E2: 空台账是可读的（readable:true + 0 条），与读不出分两句文案', () => {
    const st = makeStorage();
    const app = new BackupdeskApp(makeTheaterShell(), st);
    const read1 = app._readSnapState();
    assert.equal(read1.readable, true, '没拍过 ≠ 读不出');
    assert.equal(Object.keys(read1.state.snapshots).length, 0);
    const vm = app._snapVm();
    assert.equal(vm.empty, true, '空台账必须在视图模型里标 empty');
    assert.ok(/恢复点 0 个/.test(vm.text), '空台账文案，实得 ' + vm.text);
    // 读不出时文案必须不同形（否则用户无从分辨该重试还是该重建）
    const appNo = new BackupdeskApp(makeTheaterShell(), null);
    const vmNo = appNo._snapVm();
    assert.ok(/读不到/.test(vmNo.text), '读不出文案，实得 ' + vmNo.text);
    assert.notEqual(vm.text, vmNo.text);
});

/* ══════════════════════════════════════════════════════════════
 * F 规则剧场
 * ══════════════════════════════════════════════════════════════ */
test('F1: 非法规格不落盘且原因可读（合法的那一条作负控制）', () => {
    const st = makeStorage();
    const app = new TheaterApp(makeTheaterShell(), st);
    // 非法规格：name 空
    app.setRuleDraft({ name: '', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
    const bad = app.submitRule();
    assert.equal(bad.ok, false, 'name 空必须被拒');
    assert.equal(bad.reason, 'missing-id-or-name');
    assert.equal(st.map.has(RT_KEY), false, '被拒的规则不得落盘');

    // 非法规格：触发器不在白名单
    app.setRuleDraft({ name: 'x', trigger: 'not-a-trigger' });
    const bad2 = app.submitRule();
    assert.equal(bad2.ok, false);
    assert.equal(bad2.reason, 'invalid-trigger');

    // 负控制：合法规格必须真的收下并落盘
    app.setRuleDraft({ name: '心情低落时递一段日常', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low', actionType: RULE_ACTIONS.SUGGEST_DIALOGUE });
    const ok = app.submitRule();
    assert.equal(ok.ok, true, '合法规格必须收下，实得 ' + String(ok.why));
    assert.equal(st.map.has(RT_KEY), true, '合法规则必须落盘');
    const rows = app.ruleVm().rows;
    assert.equal(rows.length, 1, '台账里应当有 1 条规则');
    assert.equal(rows[0].trigger, RULE_TRIGGERS.MESSAGE_RECEIVED);
    assert.deepEqual(rows[0].actions, [RULE_ACTIONS.SUGGEST_DIALOGUE]);
});

test('F2: 同 id 覆盖不堆积（同 id 是更新，不占新名额）', () => {
    const st = makeStorage();
    const app = new TheaterApp(makeTheaterShell(), st);
    /* ★ 必须显式给 id：表单默认 id 为空时 App 会生成 `rule_${Date.now()}`，
     *   同一毫秒连提会撞同一个 id（看似覆盖、实则测的是撞号），跨毫秒则会变成多条。
     *   判据要测「同 id 覆盖」，就得自己钉住那个 id。 */
    for (let i = 0; i < 3; i += 1) {
        app.setRuleDraft({ id: 'r1', name: '规则甲', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
        const r = app.submitRule();
        assert.equal(r.ok, true, '第 ' + String(i) + ' 次提交应当成功，实得 ' + String(r.why));
    }
    assert.equal(app.ruleVm().rows.length, 1, '同 id 重复提交只能留 1 条，实得 ' + String(app.ruleVm().rows.length));
    // 负控制：换一个 id 就必须变成 2 条（否则「只留 1 条」可能是「谁都不收」）
    app.setRuleDraft({ id: 'r2', name: '规则乙', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
    assert.equal(app.submitRule().ok, true);
    assert.equal(app.ruleVm().rows.length, 2, '换 id 必须新增一条');
});

test('F2b: 上限 30 条是真守卫（不是文案）—— 超限拒收且台账不变', () => {
    /* 这条对应本版顺手修掉的一处「文案说、代码不做」：内核里 RT_MAX_RULES 此前
     *   从未被读过，而 App 文案已经写着「上限 30 条」。现在它被 registerRule 守卫取用。 */
    const st = makeStorage();
    const app = new TheaterApp(makeTheaterShell(), st);
    for (let i = 0; i < RT_MAX_RULES; i += 1) {
        app.setRuleDraft({ id: 'r' + String(i), name: '规则' + String(i), trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
        assert.equal(app.submitRule().ok, true, '第 ' + String(i) + ' 条应当收下');
    }
    assert.equal(app.ruleVm().rows.length, RT_MAX_RULES);
    app.setRuleDraft({ id: 'overflow', name: '超限', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
    const over = app.submitRule();
    assert.equal(over.ok, false, '超限必须拒收');
    assert.equal(over.reason, 'too-many-rules', '原因必须可读，实得 ' + String(over.reason));
    assert.equal(app.ruleVm().rows.length, RT_MAX_RULES, '拒收后台账条数必须不变');
    // 负控制：同 id 覆盖在满额时仍必须允许（否则用户再也改不了已有规则）
    app.setRuleDraft({ id: 'r0', name: '规则0改名', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
    assert.equal(app.submitRule().ok, true, '满额时同 id 更新必须仍然放行');
    assert.equal(app.ruleVm().rows.length, RT_MAX_RULES);
});

test('F3: 回放只返回触发了哪些动作，不代发、不碰别的键', () => {
    const st = makeStorage();
    const app = new TheaterApp(makeTheaterShell(), st);
    app.setRuleDraft({ name: '低落递台词', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low', actionType: RULE_ACTIONS.SUGGEST_DIALOGUE });
    assert.equal(app.submitRule().ok, true);
    const before = new Set(st.map.keys());
    const hit = app.evaluateRuleEvent(RULE_TRIGGERS.MESSAGE_RECEIVED, { mood: 'low' });
    assert.equal(hit.ok, true);
    assert.equal(hit.fired.length, 1, '条件成立必须命中 1 个动作，实得 ' + String(hit.fired.length));
    assert.equal(hit.fired[0].action.type, RULE_ACTIONS.SUGGEST_DIALOGUE);
    // 不代发：没有 toastr、没有 dispatchEvent、没有新增键
    assert.equal(globalThis.window.toastr, undefined, '回放不得弹出任何提示（代发就是第二份 owner）');
    const after = new Set(st.map.keys());
    for (const k of after) assert.ok(before.has(k), '回放不得新增存储键，实得 ' + k);
    // 负控制：条件不成立时必须 0 命中（否则上面那条「命中 1 个」是自我实现）
    const miss = app.evaluateRuleEvent(RULE_TRIGGERS.MESSAGE_RECEIVED, { mood: 'high' });
    assert.equal(miss.fired.length, 0, '条件不成立不得命中');
    // 触发器不同也不得命中
    assert.equal(app.evaluateRuleEvent(RULE_TRIGGERS.CALENDAR_DUE, { mood: 'low' }).fired.length, 0);
});

test('F4: 表单值只把「看起来是数字」的转数字（不猜类型）', () => {
    assert.equal(TheaterApp._coerce('30'), 30);
    assert.equal(TheaterApp._coerce('-1.5'), -1.5);
    assert.equal(TheaterApp._coerce('abc'), 'abc');
    assert.equal(TheaterApp._coerce(''), '');
    assert.equal(TheaterApp._coerce(' 7 '), 7, '首尾空格不该让数字认不出来');
    assert.ok(Number.isNaN(TheaterApp._coerce('12abc')) === false, '12abc 必须原样成字符串');
    assert.equal(TheaterApp._coerce('12abc'), '12abc');
});

test('F5: 规则台账读不出时拒收且不改盘（读不出 ≠ 空台账）', () => {
    const threw = { get() { throw new Error('boom'); }, set() { return true; } };
    const app = new TheaterApp(makeTheaterShell(), threw);
    assert.equal(app.readRuleState().why, 'read_threw');
    app.setRuleDraft({ name: '甲', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
    const r = app.submitRule();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'state-unreadable', '读不出时必须走 state-unreadable，实得 ' + String(r.reason));
    // 空台账（可读、0 条）走的是完全不同的路径：必须能收下
    const app2 = new TheaterApp(makeTheaterShell(), makeStorage());
    app2.setRuleDraft({ name: '乙', trigger: RULE_TRIGGERS.MESSAGE_RECEIVED, field: 'mood', operator: RULE_OPERATORS.EQUALS, value: 'low' });
    assert.equal(app2.submitRule().ok, true);
});

/* ══════════════════════════════════════════════════════════════
 * G 接线自证与账本清账
 * ══════════════════════════════════════════════════════════════ */
test('G1: 两个 App 都真 import 了对应内核的具名导出（漏一行会被 try/catch 吞掉）', () => {
    const bkSrc = read('apps/backupdesk/backupdesk-app.js');
    const bkImp = bkSrc.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/recovery-hub\.js'/);
    assert.ok(bkImp, 'backupdesk-app.js 必须从 config/recovery-hub.js 具名导入');
    for (const n of ['createSnapshot', 'computeSnapshotDiff', 'restoreSnapshot', 'normalizeRecoveryState', 'RH_MAX_SNAPSHOTS']) {
        assert.ok(new RegExp('\\b' + n + '\\b').test(bkImp[0]), '导入列表必须含 ' + n);
    }
    assert.ok(/from\s*'\.\.\/\.\.\/config\/portable-recovery-hub\.js'/.test(bkSrc), '必须导入便携恢复内核');
    const thSrc = read('apps/theater/theater-app.js');
    const thImp = thSrc.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/rule-theatre\.js'/);
    assert.ok(thImp, 'theater-app.js 必须从 config/rule-theatre.js 具名导入');
    for (const n of ['registerRule', 'evaluateEvent', 'validateRuleSpec', 'RULE_TRIGGERS']) {
        assert.ok(new RegExp('\\b' + n + '\\b').test(thImp[0]), '导入列表必须含 ' + n);
    }
    // 负控制：把导入名挖掉，正则必须看得见（否则本条是自我实现）
    const broken = bkSrc.replace(/(\bimport\s*\{[^}]*\b)(createSnapshot\b)/, '$1');
    assert.notEqual(broken, bkSrc, '负控制必须真的改到源码');
    assert.ok(!/\bcreateSnapshot\b/.test(broken.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/recovery-hub\.js'/)[0]),
        '去掉后判据必须看得见');
});

test('G2: orchestrator 里两条假驱动方法已退役（不许留方法声明与错参调用）', () => {
    const src = read('config/subsystem-orchestrator.js');
    /* ★ 剥注释再判：退役说明里**必须**写清当年错在哪（`createSnapshot(payload)` 这类原文），
     *   若不剥注释，本判据就会把「解释缺陷的那句话」当成「缺陷还在」而恒红。
     *   这也是本仓「公告块/注释属于原文面」那条纪律的另一面：判据要分得开
     *   「代码里这么写」与「注释里说当年这么写」。 */
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
    for (const name of ['manageRecoverySnapshot', 'theatreRule']) {
        assert.ok(!new RegExp('(^|\\n)[ \\t]*' + name + '\\s*\\(').test(code),
            name + ' 不得再以方法声明形式存在');
    }
    const BAD_CALLS = [
        'createSnapshot(payload)', 'restoreSnapshot(snap.id)',
        'registerRule(rule)', 'evaluateEvent(event)',
    ];
    for (const bad of BAD_CALLS) {
        assert.ok(!code.includes(bad), '错参调用形态不得留在代码里：' + bad);
    }
    // 负控制：这些错参形态在**原文**里必须真的还在（说明上面剥注释不是把整段删了导致恒绿）
    assert.ok(src.includes('createSnapshot(payload)'), '退役说明必须原文保留当年的错参形态（否则剥注释后本条是空的）');
    // 退役理由必须写在代码里（不写等于后人再踩一次）
    assert.ok(/退役/.test(src), '退役说明必须留在代码里');
});

test('G3: 两张账本都已清账（本版处置的 5 条不得还在账上）', () => {
    /* 判据自己踩过一次坑，如实记：字段名是 `rel` 而不是 `module`/`file`，
     * 首版写成 `e.module || e.file` 会恒 false ⇒ 「账本里明明还有也照样绿」。 */
    const mBase = JSON.parse(read('scripts/dead-method-baseline.json'));
    const mList = mBase.entries;
    assert.ok(Array.isArray(mList) && mList.length > 0, '方法账本必须可读且非空（空账本会让本条空转）');
    assert.equal(mList.filter((e) => !e || typeof e.rel !== 'string').length, 0, '每条都必须有 rel 字段');
    for (const name of ['manageRecoverySnapshot', 'theatreRule']) {
        const hit = mList.filter((e) => e && e.name === name && e.rel === 'config/subsystem-orchestrator.js');
        assert.equal(hit.length, 0, '方法账本里不得再有 ' + name);
    }
    const dBase = JSON.parse(read('scripts/dead-module-baseline.json'));
    const dList = dBase.entries;
    assert.ok(Array.isArray(dList) && dList.length > 0, '模块账本必须可读且非空');
    assert.equal(dList.filter((e) => !e || typeof e.rel !== 'string').length, 0, '每条都必须有 rel 字段');
    for (const rel of ['config/recovery-hub.js', 'config/portable-recovery-hub.js', 'config/rule-theatre.js']) {
        assert.equal(dList.filter((e) => e && e.rel === rel).length, 0, '模块账本里不得再有 ' + rel);
    }
    // 负控制：账本里其它条目必须还在（防止「清账=清空」这种假通过）
    assert.ok(dList.length > 50, '模块账本不该被清空，实得 ' + String(dList.length) + ' 条');
    assert.ok(mList.length > 200, '方法账本不该被清空，实得 ' + String(mList.length) + ' 条');
});

test('G4: 内核纯函数仍可独立使用（App 只是消费者，不是唯一入口）', () => {
    /* 若 App 侧把内核语义重写了一遍，本档与内核单测就各测各的。
     * 这条用内核自己的口径再走一遍最短路径，确认两边读的是同一份语义。 */
    const st = normalizeRecoveryState(null);
    const made = createSnapshot(st, 'L', { 'chat::a': '1', 'global::g': '2' });
    assert.equal(made.snapshot.keyCount, 2);
    assert.equal(made.state.lastSnapshotId, made.snapshot.id);
    assert.equal(typeof RULE_OPERATORS.CONTAINS, 'string');
});
