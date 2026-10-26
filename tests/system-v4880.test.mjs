/* ============================================================
 * tests/system-v4880.test.mjs — v4.88.0 第七批缝入（十一件纯函数内核）
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚（四源同源 + update-log 条目）与结构自证
 *   B 面 写目标守卫（write-guard）与 VFS 接线
 *   C 面 正文净化三件（去重 / 剥回声 / 完成断言门）
 *   D 面 上下文与在场（话题沉醉 / 附件合并 / 在场仲裁）
 *   E 面 后台与通话（停滞告警 / 快照保留 / 重绘代次 / 脱敏）
 *   F 面 负控制：真源码破坏 → 同款判据必须翻红
 *
 * 【负控制的形式纪律（本仓三形假绿，逐条避开）】
 *   ① 对**原文件**断言 —— 破坏没发生也绿；
 *   ② 破坏写死成模拟常量 —— 真判据根本没被调用；
 *   ③ 破坏把判据自己删了 —— 自我指涉。
 *   统一修法：**真源码破坏（锚点恰中 1 次）→ 动态加载破坏副本 → 在副本上重跑同款判据**。
 *   十一件内核都是零 import 的自包含模块，故可直接用 data: URL 装载破坏副本。
 *   每个负控制都跑**两向**：同一判据在原版上必须真、在破坏副本上必须假。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
/* 本套件诞生版 = **下限**，不是当版等值锚。
   原写法 `assert.equal(man.version, BORN_V)` 是「当版等值锚」—— 抬版即三红
   （v4.89.0 实测 A1 三处），而 v3750 G3 早把这种写法点名为坏形态。
   改为：五源必须**彼此一致**，且都不得低于诞生版。 */
const BORN_V = '4.88.0';

const vnumCmp = (a, b) => {
  const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0); }
  return 0;
};

/* 内核（全部零 import，可 data: URL 装载副本） */
import * as WG from '../config/write-guard.js';
import * as CG from '../config/completion-claim-gate.js';
import * as SR from '../config/secret-redaction.js';
import * as DD from '../config/turn-claim-dedup.js';
import * as TS from '../config/topic-saturation-guard.js';
import * as PA from '../config/presence-arbitration.js';
import * as EP from '../config/echo-prose-strip.js';
import * as SW from '../config/stall-watch.js';
import * as SN from '../config/snapshot-retention.js';
import * as AM from '../config/attachment-merge.js';
import * as RG from '../config/redraw-generation.js';

/* ============================================================ */
/* A 面：版本锚与结构自证                                        */
/* ============================================================ */
test('A1: 四源版本同源于 BORN_V（manifest / package / index 常量 / update-log latest）', () => {
  const man = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const log = JSON.parse(read('update-log.json'));
  const idx = read('index.js');
  const idxVer = (idx.match(/ST_PHONE_VERSION = '([^']+)'/) || [])[1];
  assert.equal(new Set([man.version, pkg.version, log.latest, idxVer]).size, 1,
    '四源版本必须彼此一致：' + JSON.stringify([man.version, pkg.version, log.latest, idxVer]));
  assert.ok(vnumCmp(man.version, BORN_V) >= 0, '版本不得低于本套件诞生版 ' + BORN_V + '，实得 ' + man.version);
});

test('A2: update-log 本版条目存在、items 非空且与 index.js 版本项逐字同源', () => {
  const log = JSON.parse(read('update-log.json'));
  /* 条目锚读**当版**而不是诞生版：本判据还要求条目逐字出现在 index.js 里，
    而 index.js 只有当版公告块 —— 钉诞生版时抬一版就必然红（本版实测 A2 红）。 */
  const entry = log.versions[String(log.latest)];
  assert.ok(entry, '必须存在当版条目：' + log.latest);
  assert.ok(Array.isArray(entry.items) && entry.items.length >= 8, '本版 items 至少 8 项');
  const idx = read('index.js');
  /* 每条都要在 index.js 里逐字出现（两处各写一份必然漂移）。 */
  for (const item of entry.items) {
    assert.ok(idx.includes(item), 'index.js 版本项缺少：' + item.slice(0, 40));
  }
});

test('A3: 十一件内核文件全部在场且零 import（自包含，可被 data: URL 装载）', () => {
  const files = [
    'completion-claim-gate', 'write-guard', 'secret-redaction', 'turn-claim-dedup',
    'topic-saturation-guard', 'presence-arbitration', 'echo-prose-strip', 'stall-watch',
    'snapshot-retention', 'attachment-merge', 'redraw-generation'
  ];
  for (const f of files) {
    const src = read('config/' + f + '.js');
    assert.ok(src.length > 2000, f + ' 过短');
    assert.equal((src.match(/^import\s/gm) || []).length, 0, f + ' 不得有 import');
  }
});

test('A4: 十一件内核的自检全部自通（子系统中枢里 28 项全绿）', () => {
  const checks = [CG.completionGateSelfCheck, WG.writeGuardSelfCheck, SR.redactionSelfCheck,
    DD.dedupSelfCheck, TS.saturationSelfCheck, PA.presenceSelfCheck, EP.echoStripSelfCheck,
    SW.stallSelfCheck, SN.retentionSelfCheck, AM.mergeSelfCheck, RG.redrawSelfCheck];
  assert.equal(checks.length, 11);
  for (const run of checks) {
    const r = run();
    assert.equal(r.ok, true, '自检红：' + JSON.stringify(r.bad));
  }
});

/* ============================================================ */
/* B 面：写目标守卫                                              */
/* ============================================================ */
test('B1: 三条保留目录硬拒、一级路径拒、未知语义拒', () => {
  const base = { op: 'create', bytes: 10 };
  const call = (p, extra = {}) => WG.checkWriteTarget({ ...base, path: p, ...extra });
  assert.equal(call('/Documents/a.txt').ok, true);
  for (const p of WG.DENY_PREFIXES) {
    const r = call(p + 'x.txt');
    assert.equal(r.ok, false, p + ' 应拒');
    assert.equal(r.reason, WG.WRITE_REJECT_REASONS.DENIED);
  }
  assert.equal(call('/a.txt').reason, WG.WRITE_REJECT_REASONS.BAD_PATH);
  assert.equal(WG.checkWriteTarget({ path: '/Documents/a.txt', op: 'backup' }).reason,
    WG.WRITE_REJECT_REASONS.UNKNOWN_OP);
});

test('B2: create / append / overwrite 三态互斥，字节帽文本与媒体分档', () => {
  const exists = () => true;
  const isFile = () => true;
  assert.equal(WG.checkWriteTarget({ path: '/Documents/a.txt', op: 'create', existsOf: exists }).reason,
    WG.WRITE_REJECT_REASONS.EXISTS);
  assert.equal(WG.checkWriteTarget({ path: '/Documents/b.txt', op: 'append', existsOf: () => false }).reason,
    WG.WRITE_REJECT_REASONS.MISSING);
  assert.equal(WG.checkWriteTarget({ path: '/Documents/c', op: 'append', existsOf: exists, isFileOf: () => false }).reason,
    WG.WRITE_REJECT_REASONS.NOT_A_FILE);
  assert.equal(WG.checkWriteTarget({ path: '/Documents/d', op: 'overwrite', existsOf: exists }).ok, true);
  /* 文本 1MB 帽、媒体 24MB 帽（误把图片按文本判会拒掉正常图）。 */
  assert.equal(WG.checkWriteTarget({ path: '/Documents/e.txt', op: 'overwrite', bytes: WG.BYTE_CAPS.text.write + 1 }).reason,
    WG.WRITE_REJECT_REASONS.TOO_LARGE);
  assert.equal(WG.checkWriteTarget({ path: '/Documents/f.png', op: 'overwrite', bytes: WG.BYTE_CAPS.text.write + 1, mimeType: 'image/png' }).ok, true);
});

test('B3: 路径归一与大小写同一性（`..` 折叠、两侧都归一后再比）', () => {
  assert.equal(WG.normalizeVirtualPath('/Documents/./a/../b.txt'), '/Documents/b.txt');
  assert.equal(WG.sameVirtualPath('/Documents/A.TXT', '/documents/a.txt'), true);
  assert.equal(WG.sameVirtualPath('/Documents/a.txt', '/Pictures/a.txt'), false);
});

test('B4: VFS 接线：create 二次必拒、append 拼接、别名归一后读得出、超帽拒', async () => {
  const { VirtualFileSystem } = await import('../config/virtual-file-system.js');
  const vfs = new VirtualFileSystem({ storage: { get() { return null; }, set() {} } });
  vfs.writeFile('/Documents/a.txt', 'hello', { op: 'create' });
  assert.throws(() => vfs.writeFile('/Documents/a.txt', 'x', { op: 'create' }), /exists/);
  vfs.writeFile('/documents/A.TXT', ' world', { op: 'append' });
  const keys = Array.from(vfs.files.keys()).filter((k) => /a\.txt$/i.test(k));
  assert.equal(keys.length, 1, '大小写别名必须归一成一份');
  assert.equal(vfs.readFile('/documents/A.TXT').content, 'hello world');
  assert.equal(vfs.listFiles('/documents').length, 1);
  assert.throws(() => vfs.writeFile('/Documents/big.txt', 'z'.repeat(2000000)), /too-large/);
  assert.throws(() => vfs.writeFile('/Documents/none.txt', 'q', { op: 'append' }), /missing/);
});

/* ============================================================ */
/* C 面：正文净化三件                                            */
/* ============================================================ */
test('C1: 完成断言门——强断言放行、条件句与判定标准句不放行、无证据即降级', () => {
  assert.equal(CG.classifySentence('我已经把文件改好了。', CG.createScanState()).kind, 'claim');
  assert.equal(CG.classifySentence('应该已经改好了。', CG.createScanState()).kind, 'not-claim');
  assert.equal(CG.classifySentence('「已完成」是标准。', CG.createScanState()).kind, 'not-claim');
  assert.equal(CG.classifySentence('> 我已经改好了。', CG.createScanState()).reason, CG.GATE_REASONS.QUOTED);
  const noEv = CG.guardCompletion('我已经把日程改好了。', { status: 'succeeded', runId: 'r', receipt: {} });
  assert.equal(noEv.demoted, 1);
  const okEv = CG.guardCompletion('我已经写好文件了。', { status: 'succeeded', runId: 'r', receipt: { file: 'a.txt' } });
  assert.equal(okEv.evidenced, 1);
  /* 请求没成功、或没 runId ⇒ 一律降级（回执可能是上一轮的）。 */
  assert.equal(CG.guardCompletion('我已经改好了。', { status: 'running', runId: 'r', receipt: { file: 'a' } }).demoted, 1);
  assert.equal(CG.guardCompletion('我已经改好了。', { status: 'succeeded', receipt: { file: 'a' } }).demoted, 1);
});

test('C2: 逐句去重——同句/短句包含/长句近似都丢，无关句放行，孤儿句丢', () => {
  const st = DD.createDedupState();
  DD.recordShownSentence(st, '她低下头，把杯子推过来。');
  assert.equal(DD.shouldEmitSentence('——', st).reason, DD.DEDUP_REASONS.ORPHAN);
  assert.equal(DD.shouldEmitSentence('她低下头 把杯子推过来', st).reason, DD.DEDUP_REASONS.SAME);
  assert.equal(DD.shouldEmitSentence('把杯子推过来。', st).reason, DD.DEDUP_REASONS.SUBSUMED);
  assert.equal(DD.shouldEmitSentence('窗外的雨忽然大了。', st).emit, true);
  assert.equal(DD.similarityOf('', ''), 0);
});

test('C3: 语音回声剥离——回声行剥掉、语音块原样还原、短行与结构行保留、结构块跳过', () => {
  const src = '<语音>今天我们去海边吧</语音>\n今天我们去海边吧\n海边风大吗';
  const r = EP.stripVoiceEcho(src);
  assert.equal(r.removed.length, 1);
  assert.ok(r.text.includes('<语音>今天我们去海边吧</语音>'), '语音块必须原样留下');
  assert.ok(!/\n今天我们去海边吧\n/.test(r.text), '回声行必须剥掉');
  assert.ok(r.text.includes('海边风大吗'));
  assert.equal(EP.stripVoiceEcho('没有语音块').skipped, 'no-voice');
  assert.equal(EP.stripVoiceEcho('<语音>a</语音>\n```\ncode\n```').skipped, 'structured');
});

/* ============================================================ */
/* D 面：上下文与在场                                            */
/* ============================================================ */
test('D1: 话题沉醉——第 5 轮触发、冷却只触发一次、换话题归零、空键不动状态', () => {
  let st = TS.defaultSaturationState();
  const key = '项目推进';
  let triggered = 0;
  for (let i = 1; i <= 8; i++) {
    const r = TS.advanceSaturation(st, key, i);
    if (r.guardTriggered) triggered += 1;
    st = TS.normalizeSaturationState(r);
  }
  assert.equal(triggered, 1, '冷却期内不得重复触发');
  assert.equal(st.state, TS.SATURATION_STATES.GUARD_COOLDOWN);
  assert.equal(st.cooldownUntilTurn, 5 + TS.GUARD_COOLDOWN_TURNS);
  const switched = TS.advanceSaturation(st, '另一个话题', 6);
  const kept = TS.advanceSaturation(TS.defaultSaturationState(), '', 1);
  assert.equal(kept.state, TS.SATURATION_STATES.NORMAL, '空键不得推进状态');
  assert.ok(switched);
});

test('D2: 附件合并——同路径高优先级胜、超预算只标 omitted 且带 ref、合并计数如实', () => {
  const m = AM.mergeByTarget([
    { path: '/a.txt', source: 'recall', body: '短' },
    { path: '/a.txt', source: 'core', body: '长一点的正文' },
    { path: '/b.txt', source: 'ambient', body: 'x'.repeat(50) }
  ]);
  assert.equal(m.merged, 1);
  assert.equal(m.items.filter((i) => i.path === '/a.txt').length, 1);
  assert.equal(m.items.find((i) => i.path === '/a.txt').source, 'core');
  const fin = AM.finalizeAttachments([{ path: '/c', ref: '/Doc/c.txt', source: 'other', body: 'y'.repeat(100) }], { cap: 10 });
  assert.equal(fin.omitted, 1);
  assert.match(fin.items[0].body, /\/Doc\/c\.txt/, '省略句必须指路');
  /* 平级取长者、同级等长保先到（稳定，不随机）。 */
  const tie = AM.mergeByTarget([{ path: '/d', source: 'fact', body: 'aa' }, { path: '/d', source: 'fact', body: 'bbbb' }]);
  assert.equal(tie.items[0].body, 'bbbb');
});

test('D3: 在场仲裁——高优先级胜、URGENT 穿透、全 headless 回落 idle（但错误穿透）、表外状态记账', () => {
  const r = PA.resolvePresence(new Map([['a', { state: 'thinking' }], ['b', { state: 'error' }]]));
  assert.equal(r.winner, 'error');
  const headless = PA.resolvePresence(new Map([['a', { state: 'sleeping', headless: true }]]));
  assert.equal(headless.winner, 'idle');
  assert.equal(headless.headless, true);
  const errHeadless = PA.resolvePresence(new Map([['a', { state: 'error', headless: true }]]));
  assert.equal(errHeadless.winner, 'error', '没人看着也得出错');
  const unknown = PA.resolvePresence(new Map([['a', { state: '念念有词' }]]));
  assert.deepEqual(unknown.unknown, ['念念有词']);
  assert.equal(PA.priorityOf('error') > PA.priorityOf('idle'), true);
  assert.equal(PA.isOneShotState('notice'), true);
  assert.equal(PA.isOneShotState('working'), false);
});

test('D4: 通知中心接线——低态被高态压住标 suppressedBy、URGENT 不压、排序按在场优先级', async () => {
  const { SystemNotificationDispatcher } = await import('../config/system-notification-dispatcher.js');
  const d = new SystemNotificationDispatcher({ storage: null });
  d.notePresence('wechat', 'thinking');
  const low = d.post({ appId: 'sys', title: '同步', priority: 1, presenceState: 'sleeping', presenceId: 'bg' });
  assert.equal(low.suppressedBy, 'thinking');
  const urgent = d.post({ appId: 'band', title: '预警', priority: 3, presenceState: 'alertError', presenceId: 'band' });
  assert.equal(urgent.suppressedBy, '');
  assert.equal(d.getClusteredNotifications()[0].appId, 'band', '高态必须排在前');
});

/* ============================================================ */
/* E 面：后台与通话                                              */
/* ============================================================ */
test('E1: 停滞告警——越线只告一次、恢复擦告警、无界/非 running 豁免、时钟回拨不告', () => {
  const st = { status: 'running', last_progress: Date.now() - 400000 };
  assert.equal(SW.checkStall({ name: 'a', state: st, now: Date.now() }).verdict, SW.STALL_VERDICTS.STALLED);
  assert.equal(SW.checkStall({ name: 'a', state: st, now: Date.now() }).verdict, SW.STALL_VERDICTS.STILL_STALLED);
  const rec = { status: 'running', last_progress: Date.now() };
  SW.checkStall({ name: 'b', state: { status: 'running', last_progress: Date.now() - 999999, stalled: true }, now: Date.now() });
  assert.equal(SW.checkStall({ name: 'b', state: rec, now: Date.now() }).verdict, SW.STALL_VERDICTS.ON_TIME);
  assert.equal(SW.checkStall({ name: 'v:video', state: rec, now: Date.now() + 1e9, unbounded: ['v:video'] }).reason,
    SW.STALL_REASONS.UNBOUNDED);
  assert.equal(SW.checkStall({ name: 'c', state: { status: 'done' }, now: Date.now() }).reason, SW.STALL_REASONS.NOT_RUNNING);
  const back = SW.checkStall({ name: 'd', state: { status: 'running', last_progress: Date.now() + 600000 }, now: Date.now() });
  assert.equal(back.reason, SW.STALL_REASONS.CLOCK_WENT_BACK);
});

test('E2: 快照保留——只留最近 N 张、只清引用不删消息、补占位、跨会话不误伤', () => {
  const mk = (id, ts, sid, ref) => ({ id, timestamp: ts, content: '画面', metadata: { source: 'call', callSessionId: sid, cameraSnapshotRef: ref } });
  const list = [mk(1, 100, 's1', 'a'), mk(2, 200, 's1', 'b'), mk(3, 300, 's1', 'c'),
    mk(4, 400, 's1', 'd'), mk(5, 500, 's2', 'e')];
  const applied = SN.applySnapshotRetention(list, 's1', 3);
  assert.equal(applied.cleared, 1);
  assert.equal(applied.messages[0].metadata.cameraSnapshotRef, '');
  assert.ok(applied.messages[0].content.includes(SN.SNAPSHOT_PLACEHOLDER), '必须补占位');
  assert.equal(applied.messages[4].metadata.cameraSnapshotRef, 'e', '跨会话不得误伤');
  assert.equal(list[0].metadata.cameraSnapshotRef, 'a', '原数组不得被改');
});

test('E3: 重绘代次——钉住后作废即弃、未变即过、空 owner 恒过、戳带代次', () => {
  RG.resetEpochs();
  const check = RG.captureWriteCheck(['wechat:img:s:1']);
  assert.equal(check().ok, true);
  RG.invalidateOwner('wechat:img:s:1');
  const after = check();
  assert.equal(after.ok, false);
  assert.deepEqual(after.bad, ['wechat:img:s:1']);
  assert.equal(RG.captureWriteCheck([])().ok, true);
  const env = RG.stampEnvelope({ a: 1 }, 'wechat:img:s:1');
  assert.equal(typeof env.ownerGeneration, 'number');
  assert.match(RG.epochLine(3, 1), /已从/);
});

test('E4: 脱敏——敏感键遮、非敏感不动、数字不动、前缀 token 不看键名也遮、循环不炸、不误伤 tokenizer', () => {
  const r = SR.redact({ apiKey: 'sk-abcdefghijklmnopqrstuvwx', port: 8080, name: 'RubyPhone', proxy_password: 'hunter2hunter2' });
  assert.ok(r.value.apiKey.includes(SR.REDACT_MASK));
  assert.ok(r.value.proxy_password.includes(SR.REDACT_MASK));
  assert.equal(r.value.port, 8080);
  assert.equal(r.value.name, 'RubyPhone');
  assert.ok(SR.redact({ note: '见 ghp_abcdefghijklmnopqrstuvwxyz0123 这条' }).value.note.includes(SR.REDACT_MASK));
  const cyc = { a: 1 }; cyc.self = cyc;
  assert.equal(SR.redact(cyc).value.self, '[circular]');
  assert.equal(SR.redact({ tokenizer: 'sentencepiece' }).hits.length, 0);
  assert.equal(SR.redactSummaryLine([]), '未遮（无敏感字段）');
});

test('E5: 脱敏接线——api-manager 的脱敏投影给出真源合并后的那一套，空配置如实归因', async () => {
  const { ApiManager } = await import('../config/api-manager.js');
  const st = {
    get(k) {
      return k === 'phone_api_config'
        ? JSON.stringify({ apiKey: 'sk-abcdefghijklmnopqrstuvwxyz', provider: 'openai', profiles: [], useIndependentAPI: true })
        : null;
    },
    set() {}
  };
  const r = new ApiManager(st).redactedActiveProfile('wechat');
  assert.equal(r.ok, true);
  assert.ok(r.value.apiKey.includes(SR.REDACT_MASK));
  assert.deepEqual(r.hits, ['apiKey']);
  const empty = new ApiManager({ get() { return null; }, set() {} }).redactedActiveProfile();
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'no-api-config');
});

test('E6: 诊断中心挂上了脱敏面（三态：遮了 / 未遮 / 读不到）', async () => {
  const { collectDiagnose, secretFaceText } = await import('../apps/diagnose/diagnose-data.js');
  const win = {
    VirtualPhone: {
      apiManager: { redactedActiveProfile: () => ({ ok: true, source: 'api-manager', value: { apiKey: '***' }, hits: ['apiKey'], line: '已遮 1 处：apiKey' }) }
    }
  };
  const r = collectDiagnose(win, null);
  assert.equal(r.secretFace.ok, true);
  assert.match(secretFaceText(r.secretFace), /已遮 1 处/);
  assert.match(secretFaceText({ ok: false, reason: 'storage-absent' }), /读不到/);
  assert.match(secretFaceText(null), /读不到/);
});

/* ============================================================ */
/* F 面：负控制（真源码破坏 → 同款判据必须翻红）                   */
/* ============================================================ */
/** 真源码破坏：锚点必须恰中 1 次、必改字节，否则抛（H6 工具两向自证）。 */
function breakSrc(src, anchor, repl) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（要求恰 1 次）：' + anchor.slice(0, 40));
  const out = src.split(anchor).join(repl);
  if (out === src) throw new Error('破坏未改字节');
  return out;
}
let seq = 0;
const loadBroken = async (src) => import(
  'data:text/javascript;charset=utf-8;base64,' + Buffer.from(src, 'utf8').toString('base64') + '#nc' + (++seq));

/** 两向：同一判据在原版上必须真、在破坏副本上必须假。 */
async function negative(file, anchor, repl, judge, label) {
  const src = read('config/' + file + '.js');
  /* H5 判据纯度：锚点字面量在**这一层**只出现一次（判据不得引用锚点串）。 */
  const brokenSrc = breakSrc(src, anchor, repl);
  const broken = await loadBroken(brokenSrc);
  const real = await judge(await import('../config/' + file + '.js'));
  const fake = await judge(broken);
  assert.equal(real, true, label + ' 原版判据不为真（判据写歪了）');
  assert.equal(fake, false, label + ' 破坏副本仍为真（负控制失效＝判据自我指涉）');
}

test('F1: 去掉保留目录硬拒 ⇒ 保留目录能被写入', async () => {
  await negative('write-guard', 'if (isUnderDenied(norm)) return fail(', 'if (false) return fail(',
    (m) => m.checkWriteTarget({ path: m.DENY_PREFIXES[0] + 'x.txt', op: 'create', bytes: 1 }).reason === m.WRITE_REJECT_REASONS.DENIED, 'F1');
});

test('F2: 去掉 create 已存在判据 ⇒ 二次 create 放行', async () => {
  await negative('write-guard', "if (op === 'create' && exists)", 'if (false)',
    (m) => m.checkWriteTarget({ path: '/Documents/a.txt', op: 'create', existsOf: () => true }).ok === false, 'F2');
});

test('F3: 把硬条件标记表掏空 ⇒ 条件句被当成断言', async () => {
  await negative('completion-claim-gate', 'const HARD_CONDITION_RE = /应该|', 'const HARD_CONDITION_RE = /(?!)/;const _DROP = /',
    (m) => m.classifySentence('应该已经改好了。', m.createScanState()).kind !== 'claim', 'F3');
});

test('F4: 把掩码串换成空串 ⇒ 敏感值不再被遮', async () => {
  await negative('secret-redaction', "export const REDACT_MASK = '***';", "export const REDACT_MASK = '';",
    (m) => m.redact({ apiKey: 'sk-abcdefghijklmnopqrstuvwx' }).value.apiKey.includes('***'), 'F4');
});

test('F5: 砍掉语音块还原 ⇒ 语音块被占位符吞掉', async () => {
  await negative('echo-prose-strip', 'PLACEHOLDER_RE, (_, i) => blocks[Number(i)] ||', 'PLACEHOLDER_RE, () => \'\' ||',
    (m) => m.stripVoiceEcho('<语音>今天去海边吧</语音>\n今天去海边吧').text.includes('<语音>'), 'F5');
});

test('F6: 把冷却长度改成 0 ⇒ 守卫每轮都触发', async () => {
  await negative('topic-saturation-guard', 'export const GUARD_COOLDOWN_TURNS = 8;', 'export const GUARD_COOLDOWN_TURNS = 0;',
    (m) => {
      let st = m.defaultSaturationState();
      let n = 0;
      for (let i = 1; i <= 12; i += 1) {
        const r = m.advanceSaturation(st, '同一话题', i);
        if (r.guardTriggered) n += 1;
        st = m.normalizeSaturationState(r);
      }
      return n === 1;
    }, 'F6');
});

test('F7: 去掉 headless 的错误穿透 ⇒ 后台崩溃被压成 idle', async () => {
  await negative('presence-arbitration',
    "best = (bestHeadless === 'error' || bestHeadless === 'alertError') ? bestHeadless : 'idle';",
    "best = 'idle';",
    (m) => m.resolvePresence(new Map([['a', { state: 'error', headless: true }]])).winner === 'error', 'F7');
});

test('F8: 去掉「已告过」短路 ⇒ 同一段停滞被反复告', async () => {
  await negative('stall-watch', 'if (state.stalled === true) {\n        return { verdict: STALL_VERDICTS.STILL_STALLED',
    'if (false) {\n        return { verdict: STALL_VERDICTS.STILL_STALLED',
    (m) => {
      const st = { status: 'running', last_progress: Date.now() - 400000 };
      m.checkStall({ name: 'a', state: st, now: Date.now() });
      return m.checkStall({ name: 'a', state: st, now: Date.now() }).verdict !== m.STALL_VERDICTS.STALLED;
    }, 'F8');
});

test('F9: 去掉占位符补写 ⇒ 过期快照变成无字空白', async () => {
  await negative('snapshot-retention',
    "const withMark = (text && text.indexOf(SNAPSHOT_PLACEHOLDER) >= 0) ? text : (text + SNAPSHOT_PLACEHOLDER);",
    'const withMark = text;',
    (m) => {
      const mk = (id, ts, ref) => ({ id, timestamp: ts, content: '画面', metadata: { source: 'call', callSessionId: 's1', cameraSnapshotRef: ref } });
      return m.applySnapshotRetention([mk(1, 1, 'a'), mk(2, 2, 'b')], 's1', 1).messages[0].content.includes('[图片]');
    }, 'F9');
});

test('F10: 去掉同键去重 ⇒ 同路径两条都留下', async () => {
  await negative('attachment-merge', 'if (!prev) { byKey.set(key, item); continue; }', 'if (true) { byKey.set(key, item); continue; }',
    (m) => m.mergeByTarget([{ path: '/a', source: 'core', body: 'x' }, { path: '/a', source: 'recall', body: 'y' }]).merged === 1, 'F10');
});

test('F11: 去掉代次比对 ⇒ 旧写入照样通过', async () => {
  await negative('redraw-generation', 'const bad = frozen.filter(([k, e]) => currentEpoch(k) !== e)',
    'const bad = frozen.filter(() => false)',
    (m) => {
      m.resetEpochs();
      const check = m.captureWriteCheck(['k']);
      m.invalidateOwner('k');
      return check().ok === false;
    }, 'F11');
});

test('F12: 破坏锚点两向自证（锚点不存在必抛 / 不唯一必抛 / 破坏必须改字节）', () => {
  assert.throws(() => breakSrc('abc', 'zzz', 'y'), /锚点命中 0 次/);
  assert.throws(() => breakSrc('aa', 'a', 'b'), /锚点命中 2 次/);
  assert.throws(() => breakSrc('abc', 'abc', 'abc'), /破坏未改字节/);
});
