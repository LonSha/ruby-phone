/* ========================================================
 * system-v4157.test.mjs — v4.156.0 · R21-X6/X7/X8/X9 批次 F 收官四座
 * 判据面：四条验收旅程逐句（正反两面都判）/ 四座桥的面分形与 fail-closed /
 *         纯读零写 / 计数不被上限污染 / 真接线（消费端逐处钉死）/ 版本锚。
 * 纪律：判据只验「实现有没有兑现验收语」，不替实现挑写法。
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DIGEST_FACES, DIGEST_REASONS, DIGEST_LIMITS, DIGEST_KINDS,
    inAbsenceWindow, digestItems, appChangeDigest, digestNote, appChangeDigestSelfCheck
} from '../config/app-change-digest.js';
import {
    PHYSICAL_TIERS, PHYSICAL_FACES, PHYSICAL_REASONS, PHYSICAL_LIMITS,
    physicalTierOf, physicalCandidates, physicalFrequencyGate,
    devicePhysicalNarrative, physicalNote, devicePhysicalNarrativeSelfCheck
} from '../config/device-physical-narrative.js';
import {
    DIFF_FACES, DIFF_REASONS, DIFF_LIMITS, DIFF_KEY_APP,
    splitDiffKey, diffKeyLabel, backupDiffPreview, diffNote, diffDefaultSelection,
    backupDiffPreviewSelfCheck
} from '../config/backup-diff-view.js';
import {
    WEEKLY_RECAP_FACES, WEEKLY_RECAP_REASONS, WEEKLY_RECAP_LIMITS, WEEKLY_RECAP_KINDS,
    weekWindowOf, weeklyRecap, weeklyRecapNote, weeklyRecapSelfCheck
} from '../config/weekly-recap.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const DAY = 86400000;
const T0 = 1731600000000;

/* ========================================================
 * A 组 · X6 变动摘要：验收语「离开 2 小时回来准确说出新消息数 / 一直待着不动不出现」
 * ======================================================== */

test('v4157 A1. 验收正半边：离开 2 小时回来，变动条准确说出新消息数', () => {
    const LEFT = T0;
    const RET = T0 + 2 * 3600000;
    const events = [
        { id: 'm1', kind: 'message', storyMs: T0 + 600000 },
        { id: 'm2', kind: 'message', storyMs: T0 + 1200000 },
        { id: 'm3', kind: 'message', storyMs: T0 + 1800000 },
        /* 离开前的那条**不许算进来**（窗口开在离开时刻） */
        { id: 'old', kind: 'message', storyMs: T0 - 60000 }
    ];
    const r = appChangeDigest({ appId: 'wechat', leftAt: LEFT, returnAt: RET, events });
    assert.equal(r.face, DIGEST_FACES.DIGEST, '窗口内有新消息 ⇒ digest');
    assert.equal(r.reason, 'ok');
    assert.equal(r.hit, 3, '准确说出 3 条（不多算离开前那条，不少算）');
    const msg = r.items.find(i => i.kind === 'message');
    assert.ok(msg, '必须有一条 message 归并项');
    assert.equal(msg.count, 3, '归并后的条数必须是 3');
    assert.match(r.line, /3 条消息/, '人话里必须出现「3 条消息」');
    assert.match(r.line, /你不在时/, '变动条必须以「你不在时」开头（读者要知道这是间隙而非实时）');
});

test('v4157 A2. 验收反半边：一直待着不动，不出现变动条', () => {
    const r = appChangeDigest({
        appId: 'wechat', leftAt: T0, returnAt: T0,   /* 两端相同 = 没离开过 */
        events: [{ id: 'm1', kind: 'message', storyMs: T0 }]
    });
    assert.equal(r.face, DIGEST_FACES.NOTHING, '没离开 ⇒ nothing');
    assert.equal(r.reason, 'stayed', '归因必须是 stayed，不是 quiet_gap');
    assert.equal(r.items.length, 0, 'nothing 面不许带条目');
});

test('v4157 A3. 读不到 / 没离开 / 真没新事 三种 nothing 归因必须不同形', () => {
    const neverLeft = appChangeDigest({ appId: 'wechat', returnAt: T0 + 1000, events: [] });
    const noClock = appChangeDigest({ appId: 'wechat', leftAt: undefined, returnAt: undefined, events: [] });
    const noLedger = appChangeDigest({ appId: 'wechat', leftAt: T0, returnAt: T0 + 1000, events: undefined });
    const quiet = appChangeDigest({ appId: 'wechat', leftAt: T0, returnAt: T0 + 1000, events: [] });
    assert.equal(neverLeft.reason, 'never_left', '没离开锚点 ⇒ never_left');
    assert.equal(quiet.reason, 'quiet_gap', '真没新事 ⇒ quiet_gap');
    const shapes = new Set([neverLeft.reason, quiet.reason, noLedger.reason]);
    assert.equal(shapes.size, 3, '三种「没事」不许塌成同一个形状：' + [...shapes].join(','));
    assert.equal(noLedger.face, DIGEST_FACES.UNAVAILABLE, '账读不到必须是 unavailable（不是「没事」）');
    assert.equal(noLedger.reason, 'no_ledger');
    assert.notEqual(noLedger.line, quiet.line, '「账坏了」与「真没新事」文案不许一样');
});

test('v4157 A4. leftAt = 0 是合法时刻（不许用 !leftAt 判）', () => {
    const r = appChangeDigest({
        appId: 'wechat', leftAt: 0, returnAt: 1000,
        events: [{ id: 'm1', kind: 'message', storyMs: 500 }]
    });
    assert.notEqual(r.reason, 'never_left', '剧情毫秒 0 被误判成「没离开过」');
    assert.equal(r.hit, 1, '窗口 [0,1000] 内那条必须算进来');
});

test('v4157 A5. 窗口两端都含、窗外一拍都不算', () => {
    assert.equal(inAbsenceWindow(T0, T0, T0 + 100), true, '左端含');
    assert.equal(inAbsenceWindow(T0 + 100, T0, T0 + 100), true, '右端含');
    assert.equal(inAbsenceWindow(T0 - 1, T0, T0 + 100), false, '左端外一拍不算');
    assert.equal(inAbsenceWindow(T0 + 101, T0, T0 + 100), false, '右端外一拍不算');
    assert.equal(inAbsenceWindow(T0, null, T0 + 100), false, '读不到一律不算（不猜）');
});

test('v4157 A6. 未登记 kind 不编名字，标 registered:false', () => {
    const r = appChangeDigest({
        appId: 'wechat', leftAt: T0, returnAt: T0 + 1000,
        events: [{ id: 'x', kind: 'quantum_leap', storyMs: T0 + 1 }]
    });
    const it = r.items[0];
    assert.equal(it.registered, false, '未登记 kind 必须标 registered:false');
    assert.equal(it.kind, 'quantum_leap', '必须如实给原名');
    assert.match(String(it.noun), /quantum_leap/, '未登记 kind 的量词必须含原名（如实），不许编一个像中文的名字');
});

test('v4157 A7. 事件上限截断时如实记 dropped', () => {
    const events = [];
    for (let i = 0; i < 20; i++) events.push({ id: 'm' + i, kind: Object.keys(DIGEST_KINDS)[i % Object.keys(DIGEST_KINDS).length], storyMs: T0 + i });
    const r = appChangeDigest({ appId: 'wechat', leftAt: T0, returnAt: T0 + 100000, events });
    assert.ok(r.items.length <= DIGEST_LIMITS.maxItems, '条目数不许超过上限');
    if (r.dropped > 0) assert.match(r.line, /另有.*类未显示/, '截断要在文案里如实告知');
});

test('v4157 A8. X6 自检绿', () => {
    const r = appChangeDigestSelfCheck();
    assert.equal(r.ok, true, 'X6 自检红：' + JSON.stringify(r.bad));
});

/* ========================================================
 * B 组 · X7 设备物理叙事：验收语「5% 提醒充电 / 90% 一句都不提」
 * ======================================================== */

const mkFace = (level, temp, charging) => ({
    ok: true, why: '',
    battery: { level, temperature: temp, charging: !!charging, throttling: false, powerState: '', criticalAlert: null }
});

test('v4157 B1. 验收正半边：电量 5% 时角色会提醒充电（给候选）', () => {
    const r = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: T0, weight: 1 });
    assert.equal(r.face, PHYSICAL_FACES.CANDIDATES, '5% 必须给候选');
    assert.equal(r.tier, PHYSICAL_TIERS.CRITICAL);
    assert.ok(r.candidates.length > 0, '必须给素材');
    const texts = r.candidates.map(c => c.text).join(' ');
    assert.match(texts, /充/, '候选里必须出现「充」（提醒充电）');
    assert.match(r.line, /由角色挑/, '文案要点明「候选由角色挑，本桥不选」');
});

test('v4157 B2. 验收反半边：电量 90% 时一句都不提，且不是「被门挡了」', () => {
    const r = devicePhysicalNarrative({ face: mkFace(90, 36.5, false), nowStoryMs: T0, weight: 1 });
    assert.equal(r.face, PHYSICAL_FACES.NORMAL, '常态必须是 normal');
    assert.equal(r.reason, 'normal_band', '常态归因是 normal_band（不是 gate_closed）');
    assert.equal(r.candidates.length, 0, '常态零候选 —— 验收语对照半边');
    assert.match(r.line, /一句都不提/, '常态文案要明说一句都不提');
});

test('v4157 B3. 电量档压过温度档：又低又烫只说电量', () => {
    const r = devicePhysicalNarrative({ face: mkFace(4, 46, false), nowStoryMs: T0, weight: 1 });
    assert.equal(r.tier, PHYSICAL_TIERS.LOW === undefined ? PHYSICAL_TIERS.CRITICAL : PHYSICAL_TIERS.CRITICAL,
        '又低又烫必须归电量档（电量不可逆优先）');
    const texts = r.candidates.map(c => c.text).join(' ');
    assert.ok(!/拔/.test(texts), '低电量候选里不许出现「拔」（与「去充电」自相矛盾）');
});

test('v4157 B4. 频率门：刚说过不许再说，隔久了才许', () => {
    const soon = physicalFrequencyGate({ weight: 1, lastToldStoryMs: T0, nowStoryMs: T0 + 60000 });
    assert.equal(soon.allowed, false, '刚说过 1 分钟必须挡');
    assert.equal(soon.why, 'too-soon');
    const later = physicalFrequencyGate({ weight: 1, lastToldStoryMs: T0, nowStoryMs: T0 + 3 * 3600000 });
    assert.equal(later.allowed, true, '隔 3 小时必须放行');
    const firstTime = physicalFrequencyGate({ weight: 1, lastToldStoryMs: null, nowStoryMs: T0 });
    assert.equal(firstTime.allowed, true, '从没说过 ⇒ 放行（不许挡首谈）');
    assert.equal(firstTime.why, 'never-told');
});

test('v4157 B5. 频率门 fail-closed：权重读不到 ⇒ 不许提', () => {
    const noWeight = physicalFrequencyGate({ weight: undefined, lastToldStoryMs: null, nowStoryMs: T0 });
    assert.equal(noWeight.allowed, false, '权重读不到必须 fail-closed');
    assert.equal(noWeight.why, 'no-weight');
    const absent = physicalFrequencyGate({ weight: 0, lastToldStoryMs: null, nowStoryMs: T0 });
    assert.equal(absent.allowed, false, '权重低于阈值必须挡');
    assert.equal(absent.why, 'absent');
    assert.notEqual(noWeight.why, absent.why, '「读不到」与「不在场」必须不同因');
});

test('v4157 B6. 剧情回拨不许被当成「隔了很久」', () => {
    const g = physicalFrequencyGate({ weight: 1, lastToldStoryMs: T0, nowStoryMs: T0 - 1000 });
    assert.equal(g.allowed, false, '回拨必须挡（否则回拨后每句都提）');
    assert.equal(g.why, 'clock-rewound');
});

test('v4157 B7. 读数坏了与一切正常必须不同形', () => {
    const broken = devicePhysicalNarrative({ face: { ok: false, why: 'read_threw' }, nowStoryMs: T0, weight: 1 });
    const healthy = devicePhysicalNarrative({ face: mkFace(90, 36.5, false), nowStoryMs: T0, weight: 1 });
    assert.equal(broken.face, PHYSICAL_FACES.UNAVAILABLE, '读坏了必须 unavailable');
    assert.notEqual(broken.face, healthy.face, '「读坏了」与「一切正常」不许同形');
    const noFace = devicePhysicalNarrative({ nowStoryMs: T0, weight: 1 });
    assert.equal(noFace.face, PHYSICAL_FACES.UNAVAILABLE, '没传读数必须 unavailable');
});

test('v4157 B8. 边充边烫归 HOT_CHARGING（不是 LOW）', () => {
    const t = physicalTierOf(mkFace(80, 45, true));
    assert.equal(t, PHYSICAL_TIERS.HOT_CHARGING, '边充边烫必须归 HOT_CHARGING，实得 ' + t);
});

test('v4157 B9. 只读：实现函数体零写路径、不碰电量状态', () => {
    /* 只扫实现函数体：全文含自检文本（自检里引用了写路径字面量做靶子），扫全文会误伤。 */
    const body = [physicalTierOf, physicalCandidates, physicalFrequencyGate, devicePhysicalNarrative, physicalNote]
        .map(f => String(f)).join('\n');
    assert.ok(!/storage\s*\.\s*set|localStorage|sessionStorage/.test(body), '实现里不许出现写路径');
    assert.ok(!/battery_thermo_state/.test(body), '实现不许碰电量状态键');
    assert.ok(!/consume\(|drain\(|\.level\s*=(?!=)/.test(body), '实现不许改电量');
});

test('v4157 B10. X7 自检绿', () => {
    const r = devicePhysicalNarrativeSelfCheck();
    assert.equal(r.ok, true, 'X7 自检红：' + JSON.stringify(r.bad));
});

/* ========================================================
 * C 组 · X8 备份差异预览：验收语「预览说将恢复 N 个 app、覆盖 M 项 / 取消后字节级不变」
 * ======================================================== */

test('v4157 C1. 验收正半边：预览说出「将恢复 N 个 app、覆盖 M 项」', () => {
    const diff = {
        diffCount: 3,
        added: ['global::new_key'],
        modified: ['wechat_data', 'chat::c1'],
        removed: []
    };
    const r = backupDiffPreview({ diff, label: '早八点' });
    assert.equal(r.face, DIFF_FACES.PREVIEW, '有差异 ⇒ preview');
    assert.match(r.line, /将恢复/, '必须说「将恢复」');
    assert.match(r.line, /个 app/, '必须说涉及几个 app');
    assert.match(r.line, /覆盖\s*2\s*项/, '覆盖数必须准（modified 有 2 条）');
    assert.match(r.line, /确认前存档不会变/, '必须重申「确认前存档不会变」');
});

test('v4157 C2. 覆盖必须排在新增前面（不可逆的先说）', () => {
    const r = backupDiffPreview({
        diff: { diffCount: 2, added: ['global::a'], modified: ['wechat_data'], removed: [] }
    });
    const iCover = r.line.indexOf('覆盖');
    const iAdd = r.line.indexOf('新增');
    assert.ok(iCover >= 0 && iAdd >= 0, '两者都要在文案里');
    assert.ok(iCover < iAdd, '「覆盖」（不可逆）必须排在「新增」之前');
});

test('v4157 C3. 计数不许被列表上限污染（appsTotal vs apps）', () => {
    const added = [];
    for (let i = 0; i < 30; i++) added.push('app' + i + '_data');
    const r = backupDiffPreview({ diff: { diffCount: 30, added, modified: [], removed: [] } });
    assert.equal(r.appsTotal, 30, '全量计数必须是 30，实得 ' + r.appsTotal);
    assert.ok(r.apps.length <= DIFF_LIMITS.maxAppsListed, '可截列表受上限约束');
    assert.match(r.line, /30 个 app/, '文案里的 app 数必须是全量 30（不许被截成 12）');
});

test('v4157 C4. 差异没传进来 ≠ 没有变化', () => {
    const none = backupDiffPreview({});
    assert.equal(none.face, DIFF_FACES.UNAVAILABLE, '没传差异必须 unavailable');
    assert.notEqual(none.face, DIFF_FACES.NO_CHANGE, '「读不到差异」不许冒充「没变化」');
    const same = backupDiffPreview({ diff: { diffCount: 0, added: [], modified: [], removed: [] } });
    assert.equal(same.face, DIFF_FACES.NO_CHANGE, '逐键相同才是 no-change');
});

test('v4157 C5. 形状不对（缺三个数组之一）判 unavailable，不冒充空', () => {
    const r = backupDiffPreview({ diff: { diffCount: 2, added: ['x'] } });
    assert.equal(r.face, DIFF_FACES.UNAVAILABLE, '缺 modified/removed 是坏形状');
});

test('v4157 C6. 默认勾选只勾新增，绝不默勾覆盖', () => {
    const r = backupDiffPreview({
        diff: { diffCount: 3, added: ['global::a', 'global::b'], modified: ['wechat_data'], removed: [] }
    });
    const sel = diffDefaultSelection(r);
    assert.deepEqual(sel.sort(), ['global::a', 'global::b'], '默认只勾新增两条');
    assert.ok(!sel.includes('wechat_data'), '不许默勾覆盖项（一次误触就不可逆）');
});

test('v4157 C7. 未登记键如实给原名，不编中文名', () => {
    const r = backupDiffPreview({ diff: { diffCount: 1, added: ['global::weird_unknown_key'], modified: [], removed: [] } });
    const names = r.names.added.join(' ');
    assert.match(names, /weird_unknown_key/, '未登记键必须保留原名');
});

test('v4157 C8. 键前缀拆分与已登记映射', () => {
    const chat = splitDiffKey('chat::k');
    assert.equal(chat.scope, 'chat');
    assert.equal(chat.key, 'k');
    const glob = splitDiffKey('global::k');
    assert.equal(glob.scope, 'global');
    assert.equal(glob.key, 'k');
    const bare = splitDiffKey('naked');
    assert.equal(bare.scope, '');
    assert.equal(bare.key, 'naked');
    const lbl = diffKeyLabel('wechat_data');
    assert.equal(lbl.app, '微信', '已登记键必须映射到人话名，实得 ' + lbl.app);
    assert.equal(lbl.labelled, true, '已登记键必须标 labelled:true');
    const odd = diffKeyLabel('global::mystery_key');
    assert.equal(odd.app, 'mystery_key', '未登记键如实给原键名');
    assert.equal(odd.labelled, false);
});

test('v4157 C9. 验收反半边：桥本身没有任何写能力（取消预览必然字节不变）', () => {
    const body = [backupDiffPreview, diffNote, diffDefaultSelection, splitDiffKey, diffKeyLabel]
        .map(f => String(f)).join('\n');
    assert.ok(!/restoreSnapshot|restoreSnapshotKeys|writeReceipt|storage\s*\.\s*set|localStorage/.test(body),
        '预览桥实现里出现写路径 ⇒ 「取消后字节不变」这条验收语不成立');
    const r = backupDiffPreview({ diff: { diffCount: 1, added: ['a'], modified: [], removed: [] } });
    assert.equal(r.writesNothing, true, '返回值必须自证 writesNothing');
});

test('v4157 C10. X8 自检绿', () => {
    const r = backupDiffPreviewSelfCheck();
    assert.equal(r.ok, true, 'X8 自检红：' + JSON.stringify(r.bad));
});

/* ========================================================
 * D 组 · X9 剧情周回顾：验收语「≤5 条且可回源 / 空周说没什么特别的事」
 * ======================================================== */

test('v4157 D1. 验收正半边：一周回顾最多 5 条，每条都点得回原位置', () => {
    const events = [];
    const apps = ['wechat', 'diary', 'album', 'calendar', 'notes', 'orders'];
    for (let i = 0; i < 18; i++) {
        events.push({
            appId: apps[i % apps.length], appName: '应用' + (i % apps.length),
            kind: 'message', title: '事件' + i,
            storyMs: T0 + i * 3600000, recordId: 'r-' + i
        });
    }
    const r = weeklyRecap({ startMs: T0, endMs: T0 + 7 * DAY, events });
    assert.equal(r.face, WEEKLY_RECAP_FACES.RECAP, '有货 ⇒ recap');
    assert.ok(r.items.length <= WEEKLY_RECAP_LIMITS.maxItems, '条目数必须 ≤ 5');
    for (const it of r.items) {
        assert.ok(it.source && it.source.appId, '每条必须带 appId');
        assert.ok(it.source && it.source.recordId, '每条必须带 recordId（点得回去）');
    }
    assert.ok(r.dropped > 0, '超出部分要如实记 dropped');
});

test('v4157 D2. 验收反半边：空周必须说「本周没什么特别的事」，不编条目', () => {
    const r = weeklyRecap({ startMs: T0, endMs: T0 + 7 * DAY, events: [] });
    assert.equal(r.face, WEEKLY_RECAP_FACES.EMPTY, '空周 ⇒ empty');
    assert.equal(r.items.length, 0, '空周不许编条目');
    assert.match(r.line, /本周没什么特别的事/, '文案必须逐字含验收语');
});

test('v4157 D3. 「账没接上」与「空周」不同因不同文案', () => {
    const noLedger = weeklyRecap({ startMs: T0, endMs: T0 + 7 * DAY });
    const empty = weeklyRecap({ startMs: T0, endMs: T0 + 7 * DAY, events: [] });
    assert.equal(noLedger.reason, WEEKLY_RECAP_REASONS.NO_LEDGER);
    assert.notEqual(noLedger.line, empty.line, '两种坏法文案不许一样');
});

test('v4157 D4. 有事但都点不回去：说「点不回去」，不说「没什么事」', () => {
    const r = weeklyRecap({
        startMs: T0, endMs: T0 + 7 * DAY,
        events: [
            { appId: 'wechat', kind: 'message', storyMs: T0 + 100, recordId: '' },
            { appId: 'diary', kind: 'diary_written', storyMs: T0 + 200 }
        ]
    });
    assert.equal(r.face, WEEKLY_RECAP_FACES.UNLINKED, '全无来源 ⇒ unlinked');
    assert.equal(r.reason, WEEKLY_RECAP_REASONS.ALL_UNSOURCED);
    assert.match(r.line, /点不回去/, '必须点明原因');
    assert.ok(!/没什么特别的事/.test(r.line), '不许说成「没什么事」（那是另一种坏法）');
});

test('v4157 D5. 剧情钟读不到 / 回拨：不回落墙钟，也不说成「没什么事」', () => {
    const noClock = weeklyRecap({ events: [{ appId: 'wechat', kind: 'message', storyMs: T0, recordId: 'x' }] });
    assert.equal(noClock.face, WEEKLY_RECAP_FACES.UNAVAILABLE, '无周窗 ⇒ unavailable');
    assert.equal(noClock.reason, WEEKLY_RECAP_REASONS.NO_CLOCK);
    const rewound = weeklyRecap({ startMs: T0 + 7 * DAY, endMs: T0, events: [] });
    assert.equal(rewound.reason, WEEKLY_RECAP_REASONS.CLOCK_REWOUND, '倒流窗必须单独归因');
});

test('v4157 D6. 周窗是 7 个剧情日，读不到时刻就不给窗', () => {
    const w = weekWindowOf(T0);
    assert.equal(w.ok, true);
    assert.equal(w.endMs - w.startMs, 7 * DAY, '剧情周 = 7 天');
    assert.equal(weekWindowOf(undefined).ok, false, '读不到时刻不许回落墙钟');
});

test('v4157 D7. 周窗两端都含；storyMs=0 是合法时刻', () => {
    const edge = weeklyRecap({
        startMs: T0, endMs: T0 + DAY,
        events: [
            { appId: 'a', kind: 'message', storyMs: T0, recordId: 'e1' },
            { appId: 'b', kind: 'message', storyMs: T0 + DAY, recordId: 'e2' },
            { appId: 'c', kind: 'message', storyMs: T0 - 1, recordId: 'e3' }
        ]
    });
    assert.equal(edge.counts.inWindow, 2, '两端都含');
    assert.equal(edge.counts.outside, 1);
    const zero = weeklyRecap({ startMs: 0, endMs: DAY, events: [{ appId: 'a', kind: 'message', storyMs: 0, recordId: 'z' }] });
    assert.equal(zero.counts.undated, 0, 'storyMs=0 不是缺失');
    assert.equal(zero.items.length, 1);
});

test('v4157 D8. 单个话痨 app 不许独吞五条', () => {
    const events = [];
    for (let i = 0; i < 12; i++) events.push({ appId: 'wechat', appName: '微信', kind: 'message', storyMs: T0 + i * 60000, recordId: 'w' + i });
    events.push({ appId: 'diary', appName: '日记', kind: 'diary_written', storyMs: T0 + 7200000, recordId: 'd1' });
    const r = weeklyRecap({ startMs: T0, endMs: T0 + DAY, events });
    const apps = new Set(r.items.map(i => i.appId));
    assert.ok(apps.size >= 2, '必须跨 app（否则周刊没有跨 app 意义）');
    const wc = r.items.filter(i => i.appId === 'wechat').length;
    assert.ok(wc <= WEEKLY_RECAP_LIMITS.perAppCap, '单 app 不许超过 perAppCap');
});

test('v4157 D9. 未登记 kind 不编名字；数字 recordId 归一成字符串', () => {
    const odd = weeklyRecap({ startMs: T0, endMs: T0 + DAY, events: [{ appId: 'x', kind: 'quantum', storyMs: T0 + 1, recordId: 123 }] });
    assert.equal(odd.items[0].registered, false);
    assert.equal(odd.items[0].kindLabel, 'quantum', '未登记给原名');
    assert.equal(odd.items[0].source.recordId, '123', '数字 id 必须归一成字符串');
});

test('v4157 D10. X9 自检绿', () => {
    const r = weeklyRecapSelfCheck();
    assert.equal(r.ok, true, 'X9 自检红：' + JSON.stringify(r.bad));
});

/* ========================================================
 * E 组 · 真接线（每处消费点逐处钉死；接线缺失 = 桥是孤岛）
 * ======================================================== */

test('v4157 E1. X6 真接线：goHome 记离开锚点、openApp 记回锚点并判读、微信列表顶部画变动条', () => {
    const idx = read('index.js');
    assert.match(idx, /X6_LEFT_KEY/, 'index.js 必须定义离开锚点键');
    assert.match(idx, /X6_RETURN_KEY/, 'index.js 必须定义回到锚点键');
    assert.match(idx, /appChangeDigest\(/, 'index.js 必须真调桥主入口');
    assert.match(idx, /window\.VirtualPhone\._x6\s*=/, '判读结果必须挂 _x6 面');
    const wechat = read('apps/wechat/wechat-app.js');
    assert.match(wechat, /wechat-change-digest/, '微信列表必须画出变动条容器');
    assert.match(wechat, /_x6/, '变动条必须读 _x6 面');
    assert.match(wechat, /face === 'digest'/, '只有 digest 面才画（nothing/unavailable 一律不画）');
});

test('v4157 E2. X7 真接线：生活流推进后判一次、候选挂 _x7、记账走宿主', () => {
    const idx = read('index.js');
    assert.match(idx, /devicePhysicalNarrative\(/, 'index.js 必须真调桥主入口');
    assert.match(idx, /window\.VirtualPhone\._x7\s*=/, '候选必须挂 _x7 面（不塞上下文）');
    assert.match(idx, /X7_TOLD_KEY/, '必须有「上次说过」的宿主记账键');
    assert.match(idx, /sub7\.battery\.face\(\)|battery\?\.face/, 'face 必须走中枢唯一读数口（不另读）');
    assert.match(idx, /readPresence\(\)/, 'weight 必须来自在场仲裁读数');
});

test('v4157 E3. X8 真接线：backupdesk 的 diff 面走桥，App 层不再自拼文案', () => {
    const app = read('apps/backupdesk/backupdesk-app.js');
    assert.match(app, /backupDiffPreview/, '备份台必须 import 并调用桥');
    assert.ok(!/差异 ' \+ String\(d\.diff\.diffCount\)/.test(app), 'App 层原先自拼「差异 N 键」的文案必须已移除（文案唯一实现）');
    const view = read('apps/backupdesk/backupdesk-view.js');
    assert.match(view, /s\.diff\.line/, '视图必须画桥给的 line');
    assert.match(view, /s\.diff\.names/, '名单必须用桥翻好的人话');
});

test('v4157 E4. X9 真接线：日记封面画回顾块、宿主聚合四源', () => {
    const view = read('apps/diary/diary-view.js');
    assert.match(view, /weeklyRecap\(/, '日记视图必须真调桥');
    assert.match(view, /diary-weekly-recap/, '封面必须有回顾块容器');
    assert.match(view, /weekWindowOf\(/, '周窗必须走桥的算术（不在视图里自己减 7 天）');
    const idx = read('index.js');
    assert.match(idx, /_x9Events/, '宿主必须聚合事件账并挂 _x9Events');
    assert.match(idx, /refreshWeeklyRecapLedger/, '聚合口必须存在');
    for (const src of ['wechatApp', 'diaryApp', 'albumApp', 'calendarApp']) {
        assert.match(idx, new RegExp(src), '聚合必须覆盖 ' + src + ' 这一个源');
    }
});

test('v4157 E5. 四桥在装配点都跑自检（坏了一眼能看出来）', () => {
    const idx = read('index.js');
    for (const ck of ['_x6SelfCheck', '_x7SelfCheck', '_x8SelfCheck', '_x9SelfCheck']) {
        assert.match(idx, new RegExp(ck), '装配点必须留 ' + ck);
    }
    assert.match(idx, /appChangeDigestSelfCheck/, 'X6 自检必须真被引用');
    assert.match(idx, /devicePhysicalNarrativeSelfCheck/, 'X7 自检必须真被引用');
    assert.match(idx, /backupDiffPreviewSelfCheck/, 'X8 自检必须真被引用');
    assert.match(idx, /weeklyRecapSelfCheck/, 'X9 自检必须真被引用');
});

test('v4157 E6. 四桥都是零依赖叶子（只许 import num-gate）', () => {
    for (const f of ['config/app-change-digest.js', 'config/device-physical-narrative.js', 'config/backup-diff-view.js', 'config/weekly-recap.js']) {
        const src = read(f);
        const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1]);
        for (const imp of imports) {
            assert.match(imp, /^\.\/num-gate\.js$/, f + ' 出现了非 num-gate 依赖：' + imp);
        }
    }
});

/* ========================================================
 * F 组 · 面分形总表 + 版本锚
 * ======================================================== */

test('v4157 F1. 四座桥的面闭集互不塌陷（每座至少三态，且值各不相同）', () => {
    const groups = [DIGEST_FACES, PHYSICAL_FACES, DIFF_FACES, WEEKLY_RECAP_FACES];
    for (const g of groups) {
        const vals = Object.values(g);
        assert.ok(vals.length >= 3, '面闭集至少三态：' + JSON.stringify(g));
        assert.equal(new Set(vals).size, vals.length, '面闭集内部不许重复');
    }
    /* 每座的归因码表都必须比面表更细（否则「为什么是这个面」说不出来） */
    assert.ok(Object.keys(DIGEST_REASONS).length >= Object.keys(DIGEST_FACES).length);
    assert.ok(Object.keys(PHYSICAL_REASONS).length >= Object.keys(PHYSICAL_FACES).length);
    assert.ok(Object.keys(WEEKLY_RECAP_REASONS).length >= Object.keys(WEEKLY_RECAP_FACES).length);
});

test('v4157 F2. 四座桥都是纯函数：同一输入两次调用结果逐位相同，且不改入参', () => {
    const digestIn = { appId: 'wechat', leftAt: T0, returnAt: T0 + 1000, events: [{ id: 'a', kind: 'message', storyMs: T0 + 1 }] };
    const digestSnapshot = JSON.stringify(digestIn);
    const d1 = appChangeDigest(digestIn);
    const d2 = appChangeDigest(digestIn);
    assert.deepEqual(d1, d2, 'X6 同输入两次结果必须相同');
    assert.equal(JSON.stringify(digestIn), digestSnapshot, 'X6 不许改入参');

    const recapIn = { startMs: T0, endMs: T0 + DAY, events: [{ appId: 'a', kind: 'message', storyMs: T0 + 1, recordId: 'r' }] };
    const recapSnapshot = JSON.stringify(recapIn);
    const r1 = weeklyRecap(recapIn);
    const r2 = weeklyRecap(recapIn);
    assert.deepEqual(r1, r2, 'X9 同输入两次结果必须相同');
    assert.equal(JSON.stringify(recapIn), recapSnapshot, 'X9 不许改入参');

    const face = mkFace(5, 36.5, false);
    const faceSnapshot = JSON.stringify(face);
    const p1 = devicePhysicalNarrative({ face, nowStoryMs: T0, weight: 1 });
    const p2 = devicePhysicalNarrative({ face, nowStoryMs: T0, weight: 1 });
    assert.deepEqual(p1, p2, 'X7 同输入两次结果必须相同');
    assert.equal(JSON.stringify(face), faceSnapshot, 'X7 不许改读数');
});

test('v4157 F3. 版本锚：五源同源到 4.156.0', () => {
    const idx = read('index.js');
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    assert.match(idx, /4\.156\.0/, 'index.js 里必须出现 4.156.0');
    assert.equal(manifest.version, '4.156.0', 'manifest 版本必须 4.156.0');
    assert.equal(pkg.version, '4.156.0', 'package.json 版本必须 4.156.0');
});

test('v4157 F4. 四座桥文件都在册且非空（含头部纪律注释）', () => {
    const files = {
        'config/app-change-digest.js': /你不在时/,
        'config/device-physical-narrative.js': /一句都不提|设备可感/,
        'config/backup-diff-view.js': /确认前存档不会变|覆盖/,
        'config/weekly-recap.js': /本周没什么特别的事/
    };
    for (const [f, re] of Object.entries(files)) {
        const src = read(f);
        assert.ok(src.length > 4000, f + ' 太短，疑似空壳：' + src.length);
        assert.match(src, re, f + ' 缺少验收语锚点文案');
    }
});
