/**
 * r25_x6_notify_tiers.test.mjs — R25-X6 通知语义分级（重要 / 普通 / 静默）+ 免打扰时段 + 挡下回执
 *
 * 【咬点】
 *   1. 三档行为**不同形**：静默永不弹横幅但进中心；普通弹横幅；重要弹横幅；
 *   2. 免打扰期间「零打扰」优先：一律只进中心（除非上游**显式**要求穿透）；
 *   3. 「挡下」与「没这个通知」不同形：回执账 `empty` ≠ `unreadable`；
 *   4. 时段配置非法 ⇒ `invalid` 并点名，不许拿默认时段冒充已生效；
 *   5. 时段判据只有一处实现（复用 dnd-schedule 的 dndFace），本模块不另算一遍；
 *   6. 装配点自检：咽喉真按判决走、通知中心真有档位标签与回执行、设置页真能改。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NOTIFY_TIERS, TIER_TABLE, DELIVERY, DND_SCHEDULE_KEY, DEFAULT_DND_WINDOW, SCHEDULE_STATES,
    tierOf, decideDelivery, readDndSchedule, writeDndSchedule,
    createDeliveryLedger, summarizeReceipts, notifyTierFace, notifyTierText
} from '../config/notify-tiers.js';
import { dndSelfCheck } from '../config/dnd-schedule.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** 只读 storage：`value` 为 null 表示键不存在。 */
function fakeStorage(value, opts) {
    return {
        get: (k) => {
            if (opts && opts.throwing) throw new Error('boom');
            return k === DND_SCHEDULE_KEY ? value : undefined;
        }
    };
}
/** 可写 storage（记下最后一次写入）。 */
function writableStorage(initial) {
    const box = { value: initial === undefined ? null : initial, sets: 0 };
    return {
        get: (k) => (k === DND_SCHEDULE_KEY ? box.value : undefined),
        set: async (k, v) => { if (k === DND_SCHEDULE_KEY) { box.value = v; box.sets += 1; } },
        _box: box
    };
}

test('X6-1 三档闭集与行为表：静默永不弹横幅，重要/普通弹', () => {
    assert.deepEqual([...NOTIFY_TIERS], ['urgent', 'normal', 'silent']);
    assert.equal(TIER_TABLE.urgent.banner, true);
    assert.equal(TIER_TABLE.normal.banner, true);
    assert.equal(TIER_TABLE.silent.banner, false);
    for (const t of NOTIFY_TIERS) {
        assert.equal(TIER_TABLE[t].center, true, '三档都必须进中心（不能丢消息）');
        assert.ok(String(TIER_TABLE[t].note || '').length > 10, '每档都要有人话说明');
    }
    /* 三档行为不是同一张表：静默与另外两档在「弹不弹」上必须不同。 */
    assert.notEqual(TIER_TABLE.silent.banner, TIER_TABLE.normal.banner);
});

test('X6-2 档位归一：认字符串/数字/对象，认不出的回落普通并留痕', () => {
    assert.equal(tierOf('urgent').tier, 'urgent');
    assert.equal(tierOf('URGENT').tier, 'urgent');
    assert.equal(tierOf(3).tier, 'urgent');
    assert.equal(tierOf(1).tier, 'silent');
    assert.equal(tierOf('silent').tier, 'silent');
    assert.equal(tierOf({ priorityName: 'SILENT' }).tier, 'silent');
    /* 认不出：当普通，但 known=false（不许静默掉用户没标过的通知）。 */
    const unknown = tierOf('随便写的');
    assert.equal(unknown.tier, 'normal');
    assert.equal(unknown.known, false);
    assert.equal(tierOf(0).known, false);
    assert.equal(tierOf(null).known, false);
});

test('X6-3 判决：普通弹横幅；静默只进中心；重要弹横幅', () => {
    const n = decideDelivery({ tier: 'normal', dndEnabled: false });
    assert.equal(n.deliver, DELIVERY.banner);
    assert.equal(n.banner, true);
    assert.equal(n.center, true);
    assert.deepEqual(n.reasons, []);

    const s = decideDelivery({ tier: 'silent', dndEnabled: false });
    assert.equal(s.deliver, DELIVERY.center);
    assert.equal(s.banner, false, '静默永不弹横幅');
    assert.equal(s.center, true, '但必须进中心');
    assert.ok(s.reasons.includes('silent'));

    const u = decideDelivery({ tier: 'urgent', dndEnabled: false });
    assert.equal(u.deliver, DELIVERY.banner);
    assert.equal(u.banner, true);
});

test('X6-4 免打扰期间零打扰：非重要一律只进中心，且原因点名', () => {
    /* 23:00–07:00 跨零点，hour=2 在窗内 */
    const inWin = { start: 23, end: 7 };
    for (const tier of ['normal', 'silent']) {
        const d = decideDelivery({ tier: tier, dndEnabled: true, hour: 2, window: inWin });
        assert.equal(d.deliver, DELIVERY.center, tier + ' 免打扰期间必须只进中心');
        assert.equal(d.banner, false);
        assert.ok(d.reasons.includes('dnd'), '必须点名「因为免打扰」');
        assert.equal(d.dnd.face, 'inside');
    }
    /* 重要档默认也不穿透（零打扰优先），并与「显式要求穿透」不同形。 */
    const u = decideDelivery({ tier: 'urgent', dndEnabled: true, hour: 2, window: inWin });
    assert.equal(u.deliver, DELIVERY.center, '免打扰期间连重要档也先只进中心（零打扰优先）');
    const pierced = decideDelivery({ tier: 'urgent', dndEnabled: true, hour: 2, window: inWin, pierceUrgent: true });
    assert.equal(pierced.deliver, DELIVERY.banner, '上游显式要求穿透时才弹');
    assert.ok(pierced.reasons.includes('pierced-dnd'));
    /* 负控制：普通档即使显式要求穿透也不穿（穿透不是全档通杀）。 */
    const n = decideDelivery({ tier: 'normal', dndEnabled: true, hour: 2, window: inWin, pierceUrgent: true });
    assert.equal(n.deliver, DELIVERY.center);
    /* 窗口之外照常弹，并把「不在时段内」说清楚。 */
    const out = decideDelivery({ tier: 'normal', dndEnabled: true, hour: 12, window: inWin });
    assert.equal(out.deliver, DELIVERY.banner);
    assert.ok(out.reasons.includes('outside-window'));
});

test('X6-5 时段判据只有一处实现：与 dnd-schedule 同结论', () => {
    /* dnd-schedule 自己的自检也要全绿（本模块复用它，不复用就会两处漂）。 */
    const self = dndSelfCheck();
    assert.equal(self.ok, true, 'dnd-schedule 自检：' + (self.bad || []).join('、'));
    const cases = [
        { hour: 2, window: { start: 23, end: 7 }, quiet: true },
        { hour: 12, window: { start: 23, end: 7 }, quiet: false },
        { hour: 10, window: { start: 9, end: 18 }, quiet: true },
        { hour: 8, window: { start: 9, end: 18 }, quiet: false }
    ];
    for (const c of cases) {
        const d = decideDelivery({ tier: 'normal', dndEnabled: true, hour: c.hour, window: c.window });
        assert.equal(d.dnd.quiet, c.quiet, 'hour=' + c.hour);
        assert.equal(d.banner, !c.quiet);
    }
    /* 时刻读不到 ⇒ 不许当成「不在时段内」判：面为 invalid，且原因点名。 */
    const bad = decideDelivery({ tier: 'normal', dndEnabled: true, hour: null, window: { start: 'x', end: 7 } });
    assert.equal(bad.dnd.face, 'invalid');
    assert.ok(bad.reasons.includes('dnd-window-invalid'));
});

test('X6-6 时段读写：四态不同形，非法逐项点名', () => {
    assert.equal(readDndSchedule(null).state, SCHEDULE_STATES.unreadable);
    assert.equal(readDndSchedule(fakeStorage(null, { throwing: true })).reason, 'read-threw');
    assert.equal(readDndSchedule(fakeStorage(null)).state, SCHEDULE_STATES.absent);
    assert.equal(readDndSchedule(fakeStorage('{oops')).reason, 'unparsable');
    assert.equal(readDndSchedule(fakeStorage('[]')).reason, 'not-object');

    const good = readDndSchedule(fakeStorage(JSON.stringify({ enabled: true, window: { start: 1, end: 5 } })));
    assert.equal(good.state, SCHEDULE_STATES.stored);
    assert.equal(good.enabled, true);
    assert.deepEqual(good.window, { start: 1, end: 5 });

    /* 非法：字段点名，且不把坏值当默认值用。 */
    const bad = readDndSchedule(fakeStorage(JSON.stringify({ enabled: 'yes', window: { start: 99, end: null } })));
    assert.equal(bad.state, SCHEDULE_STATES.invalid);
    assert.deepEqual(bad.rejected.sort(), ['enabled', 'window.end', 'window.start']);
    assert.deepEqual(bad.window, { ...DEFAULT_DND_WINDOW });

    /* 三份文案不同形：读不到 / 没设置过 / 非法 */
    const tUnread = notifyTierText({ schedule: readDndSchedule(null), rows: [] });
    const tAbsent = notifyTierText({ schedule: readDndSchedule(fakeStorage(null)), rows: [] });
    const tBad = notifyTierText({ schedule: bad, rows: [] });
    assert.notEqual(tUnread, tAbsent);
    assert.notEqual(tAbsent, tBad);
    assert.ok(tUnread.includes('读不到'));
    assert.ok(tAbsent.includes('还没设置过'));
    assert.ok(tBad.includes('不合法'));
});

test('X6-7 写入口：合法写入往返一致；非法拒收；写失败不静默', async () => {
    const st = writableStorage(null);
    const r = await writeDndSchedule(st, { enabled: true, start: 23, end: 7 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.saved, { enabled: true, window: { start: 23, end: 7 } });
    const back = readDndSchedule(st);
    assert.deepEqual(back.window, { start: 23, end: 7 });
    assert.equal(back.enabled, true);

    const bad = await writeDndSchedule(st, { start: 24 });
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.rejected, ['window.start']);

    const noStore = await writeDndSchedule(null, { start: 1, end: 2 });
    assert.equal(noStore.ok, false);
    assert.deepEqual(noStore.rejected, ['no-storage']);
});

test('X6-8 回执账：只记「被挡下」的，banner 不算；环形上限生效', () => {
    const ledger = createDeliveryLedger({ limit: 3 });
    assert.equal(ledger.record(decideDelivery({ tier: 'normal', dndEnabled: false }), { title: 'x' }), null,
        '弹了横幅的不叫挡下，不许记账');
    const row = ledger.record(decideDelivery({ tier: 'silent', dndEnabled: false }), { title: '后台同步', at: 1000 });
    assert.ok(row);
    assert.equal(row.tier, 'silent');
    assert.ok(row.reasons.includes('silent'));
    ledger.record(decideDelivery({ tier: 'normal', dndEnabled: true, hour: 2 }), { title: 'b', at: 2000 });
    ledger.record(decideDelivery({ tier: 'normal', dndEnabled: true, hour: 2 }), { title: 'c', at: 3000 });
    ledger.record(decideDelivery({ tier: 'normal', dndEnabled: true, hour: 2 }), { title: 'd', at: 4000 });
    assert.equal(ledger.list().length, 3, '环形上限必须生效');
    assert.deepEqual(ledger.list().map((r) => r.title), ['b', 'c', 'd']);
});

test('X6-9 回执汇总：empty 与 unreadable 不同形，逐原因计数', () => {
    const empty = summarizeReceipts([], { nowMs: 1000 });
    assert.equal(empty.face, 'empty');
    assert.equal(empty.total, 0);
    const unread = summarizeReceipts(null, { nowMs: 1000 });
    assert.equal(unread.face, 'unreadable');
    assert.equal(unread.total, null);
    assert.notEqual(empty.line, unread.line, '「什么都没挡」与「读不到账」不许同一句话');

    const nowMs = 10 * 3600 * 1000;
    const rows = [
        { at: nowMs - 1000, tier: 'silent', reasons: ['silent'], title: 'a' },
        { at: nowMs - 2000, tier: 'normal', reasons: ['dnd'], title: 'b' },
        { at: nowMs - 3000, tier: 'silent', reasons: ['silent', 'dnd'], title: 'c' },
        { at: nowMs - 40 * 3600 * 1000, tier: 'normal', reasons: ['dnd'], title: 'too-old' }
    ];
    const sum = summarizeReceipts(rows, { hours: 24, nowMs });
    assert.equal(sum.face, 'holds');
    assert.equal(sum.total, 3, '超出窗口的不计入');
    assert.equal(sum.byReason.silent, 2);
    assert.equal(sum.byReason.dnd, 2);
    assert.ok(sum.line.includes('挡下 3 条'));
});

test('X6-10 诊断面：三档逐档真算（不是把表复述一遍）', () => {
    const st = fakeStorage(JSON.stringify({ enabled: true, window: { start: 23, end: 7 } }));
    const inWin = notifyTierFace(st, { hour: 2 });
    assert.equal(inWin.rows.length, 3);
    assert.deepEqual(inWin.rows.map((r) => r.tier), ['urgent', 'normal', 'silent']);
    /* 窗内：三档全部只进中心（零打扰优先），且静默档的原因里有 silent。 */
    assert.equal(inWin.rows.every((r) => r.deliver === DELIVERY.center), true);
    assert.equal(inWin.rows.find((r) => r.tier === 'silent').reasons.includes('silent'), true);

    const outside = notifyTierFace(st, { hour: 12 });
    assert.equal(outside.rows.find((r) => r.tier === 'normal').deliver, DELIVERY.banner);
    assert.equal(outside.rows.find((r) => r.tier === 'silent').deliver, DELIVERY.center);

    /* 换 hour 之后读数必须变（说明是算出来的，不是写死的文案）。 */
    assert.notDeepEqual(inWin.rows.map((r) => r.deliver), outside.rows.map((r) => r.deliver));

    /* 宿主没给回执账 ⇒ receipts 面是 unreadable，不是「没挡下」。 */
    assert.equal(inWin.receipts.face, 'unreadable');

    const ledger = createDeliveryLedger();
    ledger.record(decideDelivery({ tier: 'silent', dndEnabled: false }), { title: 'x', at: Date.now() });
    const withLedger = notifyTierFace(st, { hour: 12, ledger: ledger });
    assert.equal(withLedger.receipts.face, 'holds');
});

test('X6-11 咽喉真按判决走：静默不弹横幅、回执记账、档位随落账', () => {
    const idx = read('index.js');
    assert.ok(idx.includes('decideDelivery'), '咽喉必须走唯一判决口');
    assert.ok(idx.includes("from './config/notify-tiers.js'"), '必须引同一内核');
    assert.ok(/if \(!_tierDecision\.banner\) \{/.test(idx), '咽喉必须按判决决定弹不弹（而不是只看 dnd 布尔）');
    assert.ok(idx.includes('notifyLedgerOf()'), '挡下必须记账（回执）');
    assert.ok(idx.includes('_notifyReceipts'), '回执必须挂到宿主面供通知中心/设置页读');
    assert.ok(/tier: \(meta\.tier !== undefined \? meta\.tier : meta\.priority\)/.test(idx),
        '档位必须随落账写进去（否则行上没有档位标签）');
    /* 落账层真的把 tier 存下来（否则上面那行等于写了个没人读的字段）。 */
    const log = read('config/system-notifications.js');
    assert.ok(/const tier = String\(rec\.tier/.test(log), '落账层必须接 tier');
    assert.ok(/\.\.\.\(tier \? \{ tier: tier \} : \{\}\)/.test(log), '行上必须真的带 tier');
});

test('X6-12 通知中心：档位标签与回执行都是真的（不是只定义方法）', () => {
    const view = read('apps/notifications/notification-center-view.js');
    assert.ok(view.includes('tierOf'), '档位判定必须走内核');
    assert.ok(view.includes('TIER_TABLE'), '标签文案必须来自行为表');
    assert.ok(view.includes('${tierTag}'), '行上必须真的渲染档位标签');
    assert.ok(view.includes('_receiptNote'), '必须有回执行');
    assert.ok(/\$\{this\._receiptNote\(\)\}/.test(view), '回执行必须真进 render 流程（不是死方法）');
    /* 回执三态不同形：读不到 ≠ 没挡下（后者直接不占位）。 */
    assert.ok(view.includes('这不等于「什么都没挡」'));
});

test('X6-13 设置页真能改：开关 + 时段 + 回执读数，且登记表补齐', () => {
    const settings = read('apps/settings/settings-app.js');
    assert.ok(settings.includes('renderNotifyTierSection'));
    assert.ok(settings.includes('bindNotifyTierEvents'));
    assert.ok(settings.includes('id="setting-notify-dnd-enabled"'));
    assert.ok(settings.includes('id="setting-notify-dnd-start"'));
    assert.ok(settings.includes('id="setting-notify-dnd-end"'));
    /* 绑定必须真挂在 bindEvents 里。 */
    const bindIdx = settings.indexOf('bindEvents() {');
    assert.ok(settings.indexOf('this.bindNotifyTierEvents(settingsRoot);') > bindIdx);
    /* 开关必须走 system-controls 的唯一写口（不许自己 storage.set('sys_dnd')）。 */
    assert.ok(settings.includes('writeFlag(this.storage, SYS_KEYS.DND'));
    /* 时段必须走 notify-tiers 的唯一写口。 */
    assert.ok(settings.includes('writeDndSchedule(this.storage'));

    const effect = read('config/setting-effect.js');
    for (const id of ['setting-notify-dnd-enabled', 'setting-notify-dnd-start', 'setting-notify-dnd-end']) {
        assert.ok(effect.includes("'" + id + "'"), '设置生效时机未登记：' + id);
    }
    const keys = read('scripts/keys-audit.mjs');
    assert.ok(keys.includes("key: 'rp22_dnd_schedule'"), '时段键必须仍登记（复用既有真源，不新开一份）');
});

test('X6-14 诊断页有卡且真进渲染流程', () => {
    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('notifyTierFaceOf'), '诊断数据必须有这一面');
    assert.ok(data.includes('notifyTier'), '必须打包进 pkg');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_notifyTierHtml'));
    assert.ok(/h\.push\([^\n]*_notifyTierHtml/.test(view), '卡片必须真进渲染流程');
    assert.ok(view.includes('notifyTierText'), '结论行必须走内核文案');
});
