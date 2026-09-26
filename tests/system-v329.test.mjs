// tests/system-v329.test.mjs — 世界书「干跑取数」层（v3.9.3）
//
//   本版把「App 侧只能凭**用户手选的设定集**说话」这个缺口补上：新增
//   `config/worldbook-dryrun.js`，调酒馆 `getWorldInfoPrompt()` 干跑一次，
//   取出**此刻真正会被触发**的世界书条目。只落取数层：不改 App 请求、不动选书面。
//
//   ★ 本仓的老账（写进判据，防止再犯）：
//     ① 「没给」与「给了 0」必须**不同形** —— `unsupported` 的 `entries` 是 `null`，
//        `ok` 且 0 条的 `entries` 是 `[]`。同形正是 O-1 / R3-D 抓过的缺陷。
//     ② 降级必须**留名** —— 干跑失败退回 `WORLD_INFO_ACTIVATED` 兜底时记
//        `activated-fallback`，不得记 `ok`（兜底是「上一次生成时」不是「此刻」）。
//     ③ 取数**不是注入** —— 跑完不得动 `extensionSettings` / `chatMetadata` / `localStorage`。
//     ④ 干跑必须**真的按干跑调** —— `isDryRun` 位不得写死 `false`。
//
//   覆盖：
//     A 模块面（四态文案齐备 / 导出在场 / 无裸 window / 默认口现取不缓存）
//     B ok 路径真跑（入参契约：chatForWI 顺序 / maxContext / isDryRun=true）
//     C 三态分形（unsupported=null / ok 空=[] / unavailable=null）
//     D 降级留名（兜底 ⇒ activated-fallback，不得冒充 ok）
//     E 取数不污染（三次调用后全局与存储逐字节不变）
//     F 负控制三条（真源码破坏 → 加载破坏副本 → 同款真判据必须转红）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';
import * as DR from '../config/worldbook-dryrun.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'config', 'worldbook-dryrun.js');
const SRC_TXT = fs.readFileSync(SRC, 'utf8');

const ENTRY = { world: '主世界书', uid: 7, comment: '咖啡馆设定', content: '老城区那家咖啡馆只在下午开。', key: ['咖啡馆', '下午', '老城区', 'x4', 'x5', 'x6', 'x7'] };

/* ══════════ A ── 模块面 ══════════ */
test('A1 四态文案表齐备且与 DRYRUN_STATES 一一对应（缺项即静默）', () => {
  assert.ok(Array.isArray(DR.DRYRUN_STATES), 'DRYRUN_STATES 必须是数组');
  assert.deepEqual([...DR.DRYRUN_STATES].sort(), ['activated-fallback', 'ok', 'unavailable', 'unsupported'],
    '四态必须恰好这四个（多一个少一个都要显式改判据）');
  for (const s of DR.DRYRUN_STATES) {
    assert.ok(typeof DR.DRYRUN_REASONS[s] === 'string' && DR.DRYRUN_REASONS[s].length > 4,
      '态 ' + s + ' 必须有自己的文案（不得留空/复用）');
  }
  /* 「读不到」的文案不得说成「没有条目」—— 这是本仓同族缺陷的措辞面 */
  assert.ok(/不是「没有条目」|不是「0 条」/.test(DR.DRYRUN_REASONS.unsupported),
    'unsupported 文案必须点明「不是没有条目」');
  assert.ok(/上一次/.test(DR.DRYRUN_REASONS['activated-fallback']),
    '兜底文案必须点明是「上一次」而非「此刻」');
});

test('A2 导出面在场；模块不裸用 window，默认口走 globalThis 现取', () => {
  for (const fn of ['collectDryRunEntries', 'normalizeDryRunResult', 'normalizeLoreEntry',
    'dryRunSupport', 'recordActivated', 'dryRunLoreBlock', 'dryRunFace', 'defaultLoreApi', 'defaultLoreCtx']) {
    assert.equal(typeof DR[fn], 'function', '缺导出：' + fn);
  }
  /* 剥掉注释后再查裸 window（注释里出现「window 依赖」是允许的） */
  const code = SRC_TXT.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  assert.equal(/\bwindow\s*\./.test(code), false, '模块不得裸用 window（一律走注入的 ctx / globalThis）');
  assert.ok(/globalThis\?\.SillyTavern\?\.getContext\?\.\(\)/.test(code), '默认口必须现取上下文（不得把 ctx 缓存在模块级）');
  /* 纪律 ②：默认口必须**每次调用**都去取，不是模块加载时取一次 */
  const before = SRC_TXT.includes('let cachedCtx') || SRC_TXT.includes('const cachedCtx');
  assert.equal(before, false, '不得缓存 ctx/api 到模块级变量');
});

test('A3 归一：key 截断到 6 个 / 空正文条目被丢弃并计数（不静默当一条）', () => {
  const n = DR.normalizeLoreEntry(ENTRY);
  assert.ok(n && Array.isArray(n.key), '归一结果必须带 key 数组');
  assert.equal(n.key.length, 6, 'key 只留前 6 个（实测 ' + n.key.length + '）');
  assert.equal(DR.normalizeLoreEntry(null), null, '非对象必须返回 null');
  assert.equal(DR.normalizeLoreEntry({ content: '   ' }), null, '空正文必须不算一条');
  const r = DR.normalizeDryRunResult({
    worldInfoBefore: 'BEFORE',
    worldInfoAfter: 'AFTER',
    worldInfoDepth: [{ entries: [ENTRY, { uid: 8, content: '   ' }, { uid: 9, comment: '第二条', content: '正文二' }] }]
  });
  assert.equal(r.entries.length, 2, '两条有效条目必须全部收下');
  assert.equal(r.dropped, 1, '空正文必须记进 dropped（不得静默）');
  assert.deepEqual(Object.keys(r.sections), ['before', 'after', 'depth'], '三段面必须都在');
  assert.ok(r.sections.depth.includes('老城区'), '深度段文本必须来自条目正文');
  /* 同一 uid 在三处出现只算一次 */
  const dup = DR.normalizeDryRunResult({ entries: [ENTRY], anBefore: [ENTRY], worldInfoDepth: [{ entries: [ENTRY] }] });
  assert.equal(dup.entries.length, 1, '同一 uid 多处出现必须去重');
});

/* ══════════ B ── ok 路径真跑 ══════════ */
test('B1 入参契约：chatForWI 最近楼层在前 / maxContext 透传 / isDryRun=true', async () => {
  const host = installRuntimeHost({
    chatLength: 3,
    worldInfo: { worldInfoDepth: [{ entries: [ENTRY] }], worldInfoBefore: 'B', worldInfoAfter: 'A' }
  });
  try {
    const snap = await DR.collectDryRunEntries({ ctx: host.context, api: host.context, maxContext: 4096, at: 111 });
    assert.equal(snap.state, 'ok', '有接口 + 有返回 ⇒ ok');
    assert.equal(snap.entries.length, 1, 'ok 时须真取到条目');
    assert.equal(snap.floorCount, 3, '楼层数须如实记录');
    const calls = host.worldInfoCalls();
    assert.equal(calls.length, 1, '必须恰好干跑一次');
    assert.equal(calls[0].isDryRun, true, '★ 必须以干跑位调用（写死 false 会把「取数」变成「注入」）');
    assert.equal(calls[0].maxContext, 4096, 'maxContext 必须透传调用方给的值');
    assert.ok(Array.isArray(calls[0].chatForWI) && calls[0].chatForWI.length === 3, 'chatForWI 须按非系统楼层构造');
    assert.ok(/楼层 2/.test(calls[0].chatForWI[0]), '★ 最近楼层必须在最前（与酒馆惯例一致）：' + calls[0].chatForWI[0]);
    assert.ok(/楼层 0/.test(calls[0].chatForWI[2]), '最远楼层必须在最后：' + calls[0].chatForWI[2]);
    assert.ok(typeof calls[0].scanData === 'object' && calls[0].scanData.trigger === 'normal',
      'scanData 必须带 trigger:normal（扫描形态不得缺）');
  } finally { host.uninstall(); resetHostFlags(); }
});

test('B2 无 maxContext 入参时回退到 ctx.maxContext，再回退 8192（不得传 undefined）', async () => {
  const host = installRuntimeHost({ chatLength: 1, worldInfo: {} });
  try {
    host.context.maxContext = 2048;
    await DR.collectDryRunEntries({ ctx: host.context, api: host.context });
    assert.equal(host.worldInfoCalls()[0].maxContext, 2048, '须回退到 ctx.maxContext');
    delete host.context.maxContext;
    await DR.collectDryRunEntries({ ctx: host.context, api: host.context });
    assert.equal(host.worldInfoCalls()[1].maxContext, 8192, '再回退必须是 8192（绝不允许 undefined 透传）');
  } finally { host.uninstall(); resetHostFlags(); }
});

/* ══════════ C ── 三态分形 ══════════ */
test('C1 「没给」与「给了 0」必须不同形（unsupported=null / ok 空=[] / unavailable=null）', async () => {
  const a = await DR.collectDryRunEntries({ ctx: {}, api: null });
  assert.equal(a.state, 'unsupported', '无接口 ⇒ unsupported');
  assert.equal(a.entries, null, '★ unsupported 时 entries 必须是 null，不能是 []');
  const host = installRuntimeHost({ chatLength: 1, worldInfo: {} });
  try {
    const b = await DR.collectDryRunEntries({ ctx: host.context, api: host.context });
    assert.equal(b.state, 'ok', '有接口且返回空对象 ⇒ ok');
    assert.ok(Array.isArray(b.entries) && b.entries.length === 0, '★ ok 且 0 条 ⇒ entries 是空数组（与 unsupported 不同形）');
    const c = await DR.collectDryRunEntries({
      ctx: host.context,
      api: { getWorldInfoPrompt: async () => { throw new Error('boom'); } }
    });
    assert.equal(c.state, 'unavailable', '接口在但调用抛错 ⇒ unavailable');
    assert.equal(c.entries, null, '★ unavailable 时 entries 也是 null（「条目未知」不是 0 条）');
  } finally { host.uninstall(); resetHostFlags(); }
});

test('C2 干跑失败但有事件记录 ⇒ activated-fallback（★ 不得记成 ok）', async () => {
  const host = installRuntimeHost({ chatLength: 2 });
  try {
    const fb = DR.recordActivated([], [ENTRY, { uid: 8, content: '二' }]);
    assert.equal(fb.length, 2, '事件载荷须归一并留存');
    const snap = await DR.collectDryRunEntries({
      ctx: host.context,
      api: { getWorldInfoPrompt: async () => { throw new Error('boom'); } },
      activated: fb
    });
    assert.equal(snap.state, 'activated-fallback', '★ 兜底必须留名，不得冒充 ok');
    assert.equal(snap.entries.length, 2, '兜底条目须可用');
    assert.ok(/上一次/.test(snap.reason), '兜底理由须说明「是上一次」');
    /* 没有兜底数据时仍是 unavailable（不得因为「有 activated 字段」就变成兜底态） */
    const none = await DR.collectDryRunEntries({
      ctx: host.context,
      api: { getWorldInfoPrompt: async () => { throw new Error('boom'); } },
      activated: []
    });
    assert.equal(none.state, 'unavailable', '空兜底 ⇒ unavailable');
    /* recordActivated 收到垃圾载荷时保持原值（不改入参、不塌成空） */
    const keep = DR.recordActivated(fb, 'not-an-array');
    assert.equal(keep.length, 2, '垃圾载荷不得把已有记录抹掉');
  } finally { host.uninstall(); resetHostFlags(); }
});

/* ══════════ D ── 投影与一句话 ══════════ */
test('D1 投影块：空/不可读返回空串；超预算如实截断且不得超预算', () => {
  assert.equal(DR.dryRunLoreBlock(null), '', 'null ⇒ 空串');
  assert.equal(DR.dryRunLoreBlock({ entries: null }), '', '不可读 ⇒ 空串');
  const long = { entries: [{ comment: 'A', content: 'x'.repeat(400) }, { comment: 'B', content: 'y'.repeat(400) }] };
  const out = DR.dryRunLoreBlock(long, { maxChars: 500 });
  assert.ok(out.length <= 500, '★ 必须守住预算（实测 ' + out.length + '）');
  assert.ok(out.includes('【A】'), '须带条目标注');
  assert.equal(out.includes('【B】'), false, '超预算的第二条不得整条塞入');
});

test('D2 一句话面：四态各有各的话，读不到时绝不说「没有条目」', () => {
  const ok = DR.dryRunFace({ state: 'ok', entries: new Array(3), dropped: 1, reason: DR.DRYRUN_REASONS.ok });
  assert.equal(ok.label, '3 条', 'ok 须报条数');
  assert.ok(/丢弃/.test(ok.detail), '有丢弃须在细节里如实报出');
  const un = DR.dryRunFace({ state: 'unsupported' });
  assert.equal(un.label, '取不到', 'unsupported 的标签必须是「取不到」');
  /* ★ 判据必须匹配**真实书写**（本类第 6 例）：模块自己的文案里就有
   *   「不是「没有条目」，是「读不到」」这种**否定语境**引用，裸 token 一查就假红。
   *   修法：先把否定语境的引用剥掉，再看还有没有**肯定式**结论。 */
  const stripNeg = (s) => String(s)
    .split('不是「没有条目」').join('').split('不是「0 条」').join('')
    .split('不是没有条目').join('').split('不是 0 条').join('');
  assert.ok(/不是|未知|读不到/.test(un.detail), 'unsupported 必须用否定式表述边界');
  assert.equal(/没有条目|0 条/.test(stripNeg(un.label + un.detail)), false,
    '★ 剥掉否定语境后，读不到时不得出现肯定式的「0 条 / 没有条目」');
  const fb = DR.dryRunFace({ state: 'activated-fallback', entries: new Array(2) });
  assert.ok(/兜底/.test(fb.label), '兜底态标签须自报「兜底」');
  assert.equal(DR.dryRunFace({}).state, 'unsupported', '空快照按 unsupported 处理（不猜）');
});

test('D3 支持探测：无接口 ⇒ false（先探形态再取数，不靠异常兜）', () => {
  assert.equal(DR.dryRunSupport(null), false, 'null ⇒ false');
  assert.equal(DR.dryRunSupport({}), false, '无该方法 ⇒ false');
  assert.equal(DR.dryRunSupport({ getWorldInfoPrompt: 1 }), false, '非函数 ⇒ false');
  assert.equal(DR.dryRunSupport({ getWorldInfoPrompt: () => {} }), true, '有函数 ⇒ true');
});

/* ══════════ E ── 取数不污染 ══════════ */
test('E1 取数不是注入：三次调用后全局与存储逐字节不变', async () => {
  const host = installRuntimeHost({
    chatLength: 2,
    worldInfo: { worldInfoBefore: 'B', worldInfoDepth: [{ entries: [ENTRY] }] }
  });
  try {
    const snap = () => JSON.stringify({
      chat: host.context.chat,
      chatMetadata: host.context.chatMetadata,
      ext: host.context.extensionSettings,
      ls: [...Array(host.localStorage.length).keys()].map((i) => [host.localStorage.key(i), host.localStorage.getItem(host.localStorage.key(i))]),
      listeners: host.listenerCount()
    });
    const before = snap();
    await DR.collectDryRunEntries({ ctx: host.context, api: host.context, at: 1 });
    await DR.collectDryRunEntries({ ctx: host.context, api: host.context, at: 2 });
    await DR.collectDryRunEntries({ ctx: host.context, api: { getWorldInfoPrompt: async () => { throw new Error('x'); } }, at: 3 });
    assert.equal(snap(), before, '★ 取数必须零副作用（chatMetadata / 设置 / localStorage / 监听器一律不动）');
  } finally { host.uninstall(); resetHostFlags(); }
});

/* ══════════ F ── 负控制（真源码破坏 → 同款真判据转红） ══════════ */
/** 把真源码里的一处锚点换掉，落到临时文件后动态 import —— 破坏的是**真源码**，
 *   判据也是同一套函数，避免「拿模拟常量当破坏」的假绿（本仓 v324/v327 的三形）。 */
async function loadDamaged(anchor, replacement) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_dryrun_'));
  const hits = SRC_TXT.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  fs.writeFileSync(path.join(dir, 'worldbook-dryrun.mjs'), SRC_TXT.split(anchor).join(replacement));
  return import(pathToFileURL(path.join(dir, 'worldbook-dryrun.mjs')).href + '?t=' + Date.now());
}

test('F1 把 unsupported 的 entries:null 改成 [] ⇒ 「不同形」判据必须转红', async () => {
  const M = await loadDamaged("state: 'unsupported', reason: DRYRUN_REASONS.unsupported, entries: null",
    "state: 'unsupported', reason: DRYRUN_REASONS.unsupported, entries: []");
  const d = await M.collectDryRunEntries({ ctx: {}, api: null });
  assert.equal(d.state, 'unsupported', '（破坏后仍是 unsupported —— 说明这条判据只盯形状）');
  assert.equal(d.entries === null, false, '★ 破坏后 entries 不再是 null ⇒ 同款判据转红（真判据有效）');
  const live = await DR.collectDryRunEntries({ ctx: {}, api: null });
  assert.equal(live.entries, null, '对照：真源码下 entries 仍是 null');
});

test('F2 把 isDryRun 位的 true 改成 false ⇒ 干跑位判据必须转红', async () => {
  const M = await loadDamaged('api.getWorldInfoPrompt(chatForWI, maxContext, true, scanData)',
    'api.getWorldInfoPrompt(chatForWI, maxContext, false, scanData)');
  const calls = [];
  const api = { getWorldInfoPrompt: async (...a) => { calls.push(a); return {}; } };
  await M.collectDryRunEntries({ ctx: { chat: [] }, api });
  assert.equal(calls[0][2], false, '★ 破坏后干跑位变 false ⇒ 同款判据转红');
  const calls2 = [];
  const api2 = { getWorldInfoPrompt: async (...a) => { calls2.push(a); return {}; } };
  await DR.collectDryRunEntries({ ctx: { chat: [] }, api: api2 });
  assert.equal(calls2[0][2], true, '对照：真源码下干跑位是 true');
});

test('F3 把兜底的 activated-fallback 改成 ok ⇒ 「降级不得冒充 ok」判据必须转红', async () => {
  const M = await loadDamaged("state: 'activated-fallback',", "state: 'ok',");
  const snap = await M.collectDryRunEntries({
    ctx: { chat: [] },
    api: { getWorldInfoPrompt: async () => { throw new Error('boom'); } },
    activated: [ENTRY]
  });
  assert.notEqual(snap.state, 'activated-fallback', '★ 破坏后不再留名 ⇒ 同款判据转红');
  assert.equal(snap.state, 'ok', '破坏把兜底冒充成 ok（正是本仓要挡的那类错误）');
  const live = await DR.collectDryRunEntries({
    ctx: { chat: [] },
    api: { getWorldInfoPrompt: async () => { throw new Error('boom'); } },
    activated: [ENTRY]
  });
  assert.equal(live.state, 'activated-fallback', '对照：真源码下兜底留名');
});
