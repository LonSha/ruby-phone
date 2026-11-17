// tests/r23_x_trace.test.mjs — R23-X1~X9「可回源拓展九项」判据
// 九项共用一个纪律：**三态不塌**。证据不足 = insufficient，读不出锚 = unknown，
// 不许用 false / 0 / 空串顶替；「没证据」与「是假的」是两个事实。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const M = await import(pathToFileURL(path.join(ROOT, 'config/v23-trace.js')));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('✓ ' + n); } else { fail++; console.log('✗ ' + n); } };

/* ── X1 跨 App 时间轴：三态 + 逐源列出读不到的源 ── */
const tlOk = M.crossAppTimeline([
    { app: 'wechat', items: [{ floor: 7, text: 'b' }, { floor: 3, text: 'a' }] },
    { app: 'diary', items: [{ floor: 5, text: 'c' }] }
]);
ok('X1 多源合并按楼层升序', tlOk.face === 'ok' && tlOk.items.map((i) => i.floor).join(',') === '3,5,7');
const tlPart = M.crossAppTimeline([{ app: 'wechat', items: [{ floor: 1 }] }, { app: 'wallet' }]);
ok('X1 读不到的源必须逐源点名（不是静默少一条）', tlPart.face === 'partial' && tlPart.unreadable[0] === 'wallet');
ok('X1 空面是 empty 不是 ok', M.crossAppTimeline([]).face === 'empty');

/* ── X2 角色沉默：窗口没走完不许判沉默 ── */
ok('X2 窗口未到 → insufficient', M.silenceReading({ messages: [], askFloor: 10, nowFloor: 12, window: 5 }).face === 'insufficient');
const silent = M.silenceReading({ messages: [{ floor: 11, from: '她' }], askFloor: 10, nowFloor: 20, window: 5, addressedTo: '他' });
ok('X2 只收到别人的话 → 仍算沉默（adressedTo 过滤生效）', silent.face === 'silent');
ok('X2 有回应 → answered', M.silenceReading({ messages: [{ floor: 11, from: '他' }], askFloor: 10, nowFloor: 20, addressedTo: '他' }).face === 'answered');

/* ── X3 话题挂起：三态 + 过期显形 ── */
ok('X3 未超时 suspended', M.topicSuspension({ floor: 10, nowFloor: 12, ttl: 5 }).face === 'suspended');
ok('X3 超时 expired 且带逾时量', (() => { const r = M.topicSuspension({ floor: 10, nowFloor: 20, ttl: 5 }); return r.face === 'expired' && r.overdueBy === 5; })());
ok('X3 已接回 resumed', M.topicSuspension({ floor: 10, nowFloor: 20, ttl: 5, resumedAt: 15 }).face === 'resumed');
ok('X3 缺锚 → invalid（不猜）', M.topicSuspension({ floor: 10 }).face === 'invalid');

/* ── X4 作息画像：样本不足不产结论 ── */
ok('X4 样本不足 → insufficient 且零分桶', (() => { const r = M.usageRhythm({ sessions: [{ startMs: 0, endMs: 60000 }] }); return r.face === 'insufficient' && r.buckets.length === 0; })());
const prof = M.usageRhythm({ sessions: [0, 1, 2, 3, 4].map((i) => ({ startMs: i * 3600000, endMs: i * 3600000 + 600000 })) });
ok('X4 样本足 → profile 且 24 桶', prof.face === 'profile' && prof.buckets.length === 24 && prof.samples === 5);

/* ── X5 撤回生命周期：unknown 不许说成「没看到」 ── */
ok('X5 撤回但收不到「看过」→ unknown', M.recallLifecycle({ msg: { sentAtFloor: 1, recalledAtFloor: 5 } }).face === 'unknown');
ok('X5 看过才判先后', M.recallLifecycle({ msg: { sentAtFloor: 1, recalledAtFloor: 5, seenAtFloor: 3 } }).face === 'seen-before-recall');
ok('X5 撤回在看之前', M.recallLifecycle({ msg: { sentAtFloor: 1, recalledAtFloor: 5, seenAtFloor: 6 } }).face === 'recalled-before-seen');
ok('X5 没有消息 → unknown（不是「没发过」）', M.recallLifecycle({}).face === 'unknown');

/* ── X6 多设备同步：三态不塌成一个布尔 ── */
ok('X6 一致 → synced', M.deviceSync({ devices: [{ id: 'a', lastFloor: 9 }, { id: 'b', lastFloor: 9 }] }).face === 'synced');
ok('X6 落后 → lagging 且点名设备', (() => { const r = M.deviceSync({ devices: [{ id: 'a', lastFloor: 9 }, { id: 'b', lastFloor: 4 }] }); return r.face === 'lagging' && r.lagging[0].id === 'b'; })());
ok('X6 全读不出 → unknown（不是 synced）', M.deviceSync({ devices: [{ id: 'a' }] }).face === 'unknown');

/* ── X7 年度回顾：每条可回源，空年要说话 ── */
const year = M.relationshipAnnual({ year: 2026, moments: [{ floor: 3, quote: '别走' }, { floor: null, quote: '无锚' }] });
ok('X7 回顾逐条带楼层，无锚的不计入', year.face === 'review' && year.moments.length === 1 && year.unreadable === 1);
ok('X7 空年逐字说「没怎么说过话」', M.relationshipAnnual({ year: 2026, moments: [] }).text === '这一年没怎么说过话');

/* ── X8 草稿跨轮：悄悄消失必须显形 ── */
ok('X8 草稿还在 → kept', M.draftRetention({ chatId: 'c', drafts: [{ chatId: 'c', text: '半句' }] }).face === 'kept');
ok('X8 上一轮有、这一轮没了 → dropped（不许静默）', M.draftRetention({ chatId: 'c', drafts: [], hadDraft: true, prevFloor: 4 }).face === 'dropped');
ok('X8 本来就没有 → none', M.draftRetention({ chatId: 'c', drafts: [] }).face === 'none');

/* ── X9 群聊谁在听：observed 必须有实测证据 ── */
ok('X9 无反应记录 → insufficient（不许画像冒充）', M.groupListening({ members: [{ id: 'm', reactions: [] }], msgFloor: 5 }).face === 'insufficient');
ok('X9 有实测反应 → observed 且带证据楼层', (() => { const r = M.groupListening({ members: [{ id: 'm', reactions: [4, 6] }], msgFloor: 5 }); return r.face === 'observed' && r.observed[0].evidence.length === 1 && r.observed[0].evidence[0] === 6; })());
ok('X9 无成员 → insufficient', M.groupListening({ members: [], msgFloor: 5 }).face === 'insufficient');

/* ── 负控制：把「没证据」顶替成「假」的实现必须能分出来 ── */
const cheatNull = (input) => (input.msg && input.msg.recalledAtFloor != null ? { face: 'recalled', seen: false } : { face: 'visible' });
ok('负控制 X5：把「没证据」当「没看过」会改判', cheatNull({ msg: { recalledAtFloor: 5 } }).face !== M.recallLifecycle({ msg: { sentAtFloor: 1, recalledAtFloor: 5 } }).face);
const cheatBool = (d) => ({ synced: d.every((x) => (x.lastFloor || 0) >= Math.max(...d.map((y) => y.lastFloor || 0))) });
ok('负控制 X6：布尔同步态会把 unknown 洗成 true', cheatBool([{ lastFloor: undefined }]).synced === true && M.deviceSync({ devices: [{}] }).face === 'unknown');

/* ── 装配点：index.js 必须真引入并真跑自检（不是登记名） ── */
const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
ok('接线：index.js 引入 v23TraceSelfCheck', idx.includes("from './config/v23-trace.js"));
ok('接线：自检真进了 _bridgeChecks 装配表', /\[ '_r23Trace'|\['_r23Trace', v23TraceSelfCheck\]/.test(idx));
ok('自检本体绿', M.v23TraceSelfCheck().ok === true);

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);