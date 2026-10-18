/* ============================================================
 * tests/system-v4140.test.mjs -- [v4.14.0 · 第四期 R4-O2 问答与检索可取消、可继续操作]
 *   大库上问往事:仍可输入、可返回、可取消;快速连续提问只展示最新一次结果。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   `apps/memory/memory-app.js::askPast` → `config/memory-qa-contract.js::readMemoryQaAnswer`
 *   → 上游**同步** `askMemoryQuestion`。而上游 lonsha-memory-plugin **v3.332.0(M4-O4)**
 *   早已交付异步出口 `askMemoryQuestionAsync`(逐条计划走 `queryAsync`,片间让出主线程,
 *   自带 `taskId` / `shouldCancel()` / `onProgress(p)`),实测下游
 *   `grep askMemoryQuestionAsync apps config index.js` **零命中** —— 又一次「建好不消费」。
 *   于是大库上按一次「问」就是一次同步全量扫描:面板不动,连按两次只会得到两条
 *   串在一起的结果(旧的那条可能后回来、把新的覆盖掉)。
 *
 * 【本版落的三件】一 `config/ask-request.js`(纯函数:任务身份 / 代际 / 取消谓言 / 六态);
 *   二 `config/memory-qa-contract.js::readMemoryQaAnswerAsync`(异步读口,与同步版同一套五态);
 *   三 控制器 `askPastAsync` + 视图的进度行 / 取消按钮 / 旧回信不落面板。
 *
 * 判据面(五组):
 *   A 口径:六态互不同形 / 两张词表分开 / 纯函数零副作用
 *   B 行为:代际与最新一次胜出 / 取消谓言 / 任务身份 / 进度「未给」不塌成 0 / 异步读口五态
 *   C 接线:控制器派发相一处判 / 视图按钮与事件绑定 / 旧回信不画 / 样式两侧投递
 *   D 负控制:真源码定点破坏四条口径 ⇒ 同款判据必转红(配原版必真的反向对照)
 *   E 版本锚:下限形
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ASK_REL = 'config/ask-request.js';
const QA_REL = 'config/memory-qa-contract.js';
const APP_REL = 'apps/memory/memory-app.js';
const VIEW_REL = 'apps/memory/memory-view.js';
const IDX_REL = 'index.js';
const A = await import(pathToFileURL(path.join(ROOT, ASK_REL)).href);
const Q = await import(pathToFileURL(path.join(ROOT, QA_REL)).href);
const askSrc = read(ASK_REL);
const qaSrc = read(QA_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const idxSrc = read(IDX_REL);
const cssSrc = read('phone.css');
const appCssSrc = read('apps/memory/memory.css');
/** 去注释后的源码(**判据只认代码,不认注释里的自述**)。 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
    if (c === '\\') { out += c + (d || ''); i += 2; continue; }
    if (c === quote) { state = 'code'; out += c; i += 1; continue; }
    out += c; i += 1;
  }
  return out;
}
const askCode = stripComments(askSrc);
const qaCode = stripComments(qaSrc);
const appCode = stripComments(appSrc);
const viewCode = stripComments(viewSrc);

/** 造一个上游插件的假身(只带本面用到的两个出口)。 */
function makePlugin(opts = {}) {
  const o = opts;
  const p = {};
  if (o.async !== false) {
    p.askMemoryQuestionAsync = async (question, args) => {
      if (typeof o.impl === 'function') return o.impl(question, args);
      return {
        version: 1, question, intents: [], actor: null,
        answer: [{ kind: 'open', planId: 'p1', text: '答', ref: 'commit:1', floor: 3, ledger: '承诺' }],
        gaps: [], refs: [{ ref: 'commit:1', ledger: '承诺', floor: 3 }], plans: [],
        masked: 0, truncated: false, resourced: 1, total: 1, knownActors: 2,
        reason: '', writesNothing: true,
        async: true, taskId: String(args && args.taskId || ''), state: 'done', processed: { plans: 1, plansTotal: 1 }
      };
    };
  }
  if (o.sync === true) {
    p.askMemoryQuestion = (question) => ({
      version: 1, question, intents: [], actor: null,
      answer: [], gaps: [{ kind: 'nothing', why: 'no-hit' }], refs: [], plans: [],
      masked: 0, truncated: false, resourced: 0, total: 0, knownActors: 0,
      reason: '', writesNothing: true
    });
  }
  return { LonShaMemory: p };
}

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 运行态六态**互不同形**,六句归因文案也两两不同', () => {
  const vals = Object.values(A.ASK_RUN_STATES);
  assert.equal(vals.length, 6, vals.join(' / '));
  assert.equal(new Set(vals).size, 6, '六态值必须唯一');
  const lines = new Set(vals.map((s) => A.askRunLine(s, {})));
  assert.equal(lines.size, 6, '六句必须互不相同:' + Array.from(lines).join(' | '));
  /* 最关键的两对:取消 ≠ 被顶替;同步降级 ≠ 后台跑。 */
  assert.notEqual(A.askRunLine(A.ASK_RUN_STATES.CANCELED, {}),
    A.askRunLine(A.ASK_RUN_STATES.STALE_DROPPED, {}), '「我按了取消」与「旧回信被顶掉」处置相反');
  assert.notEqual(A.askRunLine(A.ASK_RUN_STATES.SYNC_FALLBACK, {}),
    A.askRunLine(A.ASK_RUN_STATES.RUNNING, {}), '「同步跑会卡」不得显示成「后台在跑」');
});

test('A2 「该去哪条出口」与「跑到什么状态」两张词表分开,不压成一张', () => {
  assert.equal(Object.keys(A.ASK_PHASES).length, 3);
  assert.equal(new Set(Object.values(A.ASK_PHASES)).size, 3);
  assert.equal(A.ASK_PHASES.ASYNC, 'async');
  assert.equal(A.ASK_PHASES.SYNC, 'sync');
  assert.equal(A.ASK_PHASES.ABSENT, 'absent');
  assert.equal(A.planAskPhase(true, true), 'async', '有异步口优先异步');
  assert.equal(A.planAskPhase(false, true), 'sync', '只有同步口回落同步');
  assert.equal(A.planAskPhase(false, false), 'absent');
  /* 严格:非 true 一律不当成有(防 undefined / 'yes' 被读成「有」)。 */
  for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
    assert.equal(A.planAskPhase(bad, true), 'sync', 'async 面必须严格 true:' + String(bad));
  }
});

test('A3 纯函数:零副作用(不碰 DOM / 不写存储 / 不联网 / 不建定时器)', () => {
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'setInterval', 'fetch', 'indexedDB']) {
    assert.equal(new RegExp('\\b' + bad + '\\b').test(askCode), false,
      ASK_REL + ' 不得出现 ' + bad);
  }
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 代际:最新一次胜出,旧回信一律判 stale', () => {
  const t = A.newAskTracker();
  assert.equal(A.isStale(t, 0), true, '从没问过时任何回信都不算当前');
  const g1 = A.advanceAsk(t);
  assert.equal(g1, 1);
  assert.equal(A.isStale(t, g1), false, '当前这一代不算 stale');
  const g2 = A.advanceAsk(t);
  assert.equal(g2, 2);
  assert.equal(A.isStale(t, g1), true, '问了新的之后,旧那一条必须判 stale');
  assert.equal(A.isStale(t, g2), false);
  assert.equal(A.isStale(null, g2), true, '跟踪器不在 ⇒ 无从判定 ⇒ 按旧处置(不许写进面板)');
  /* 畸形代际不得被读成当前。 */
  for (const bad of [0, -1, null, undefined, '', '2', NaN, Infinity, {}]) {
    assert.equal(A.isStale(t, bad), true, '畸形/缺失代际必须判 stale:' + String(bad));
  }
});

test('B2 取消:只对**当前**那一代生效,且查得到', () => {
  const t = A.newAskTracker();
  assert.deepEqual(A.cancelAsk(t), { ok: false, gen: 0 }, '没在问时如实返回没成');
  assert.equal(A.isCanceled(t), false);
  const g = A.advanceAsk(t);
  const r = A.cancelAsk(t);
  assert.equal(r.ok, true);
  assert.equal(r.gen, g);
  assert.equal(A.isCanceled(t), true, '当前代已取消');
  /* 再问一次 ⇒ 新的一代**没有被取消**(取消只对这一代生效)。 */
  const g2 = A.advanceAsk(t);
  assert.equal(A.isCanceled(t), false, '新问题不该继承上一次的取消标记');
  assert.notEqual(g2, g);
});

test('B3 取消谓言:交给上游 shouldCancel,语义收窄成「代际过了吗 / 这一代取消了吗」', () => {
  const t = A.newAskTracker();
  const g1 = A.advanceAsk(t);
  const sc1 = A.shouldCancelFn(t, g1);
  assert.equal(sc1(), false, '当前代未取消 ⇒ 不停');
  A.cancelAsk(t);
  assert.equal(sc1(), true, '用户取消这一代 ⇒ 停');
  const g2 = A.advanceAsk(t);
  const sc2 = A.shouldCancelFn(t, g2);
  assert.equal(sc2(), false, '新代不继承取消');
  const sc1b = A.shouldCancelFn(t, g1);
  assert.equal(sc1b(), true, '旧代的谓言必须说停(否则白扫)');
  assert.equal(A.shouldCancelFn(null, 1)(), true, '跟踪器不在 ⇒ 停(fail-closed)');
});

test('B4 任务身份:同一组输入恒得同一串,且**跨会话不同形**', () => {
  assert.equal(A.makeAskTaskId(1, 'chatA'), A.makeAskTaskId(1, 'chatA'), '纯函数');
  assert.notEqual(A.makeAskTaskId(1, 'chatA'), A.makeAskTaskId(1, 'chatB'),
    '两个会话各自的第 1 次是两件事,不得同形');
  assert.notEqual(A.makeAskTaskId(1, 'chatA'), A.makeAskTaskId(2, 'chatA'));
  /* 会话 id 取不到写 na,**不写空串**(空串会被上游读成一个合法身份)。 */
  for (const bad of [undefined, null, '', '   ', 123]) {
    const id = A.makeAskTaskId(3, bad);
    assert.equal(id, A.ASK_TASK_PREFIX + ':na:3', '会话取不到必须写 na:' + String(bad));
  }
  assert.equal(A.makeAskTaskId(-5, 'x'), A.ASK_TASK_PREFIX + ':x:0', '畸形代际写 0(不写成当前)');
  assert.ok(A.makeAskTaskId(1, 'c').startsWith(A.ASK_TASK_PREFIX + ':'));
});

test('B5 进度:「没给」与「给了 0」不塌成同一个数', () => {
  assert.equal(A.progressLine({ plan: 0, plans: 3, rows: 0 }), '第 1/3 条计划 · 已处理 0 行',
    '0 是合法值(第 0 条计划 / 0 行),必须如实出数');
  assert.equal(A.progressLine({ plans: 3 }), '共 3 条计划', 'plan 未给时只说总数');
  const unknown = A.progressLine({});
  assert.ok(unknown.includes('读不出'), '全读不出时必须明说读不出:' + unknown);
  assert.ok(unknown.includes('不是'), '必须点明「不是 0 行」');
  assert.equal(A.progressLine(null), '(没有进度读数)');
  /* 畸形值不得被读成 0。 */
  for (const bad of [undefined, null, '', 'a', NaN, -1, {}]) {
    const line = A.progressLine({ plan: bad, plans: bad, rows: bad });
    assert.ok(line.includes('读不出'), String(bad) + ' 必须读不出,实测:' + line);
  }
  assert.equal(A.progressLine({ plan: 1 }, true).includes('第 2/'), false, 'brief 时不给缺一半的段');
});

test('B6 runStateOf:上游读数 → 本件六态(取消与缺席分开,不压平)', () => {
  assert.equal(A.runStateOf(null, false), 'running');
  assert.equal(A.runStateOf({ state: 'done' }, false), 'done');
  assert.equal(A.runStateOf({ state: 'canceled' }, false), 'canceled');
  assert.equal(A.runStateOf({ state: 'absent' }, false), 'sync-fallback');
  assert.equal(A.runStateOf({ state: 'done' }, true), 'stale-dropped', 'stale 优先');
  assert.equal(A.runStateOf(undefined, true), 'stale-dropped');
});

test('B7 异步读口:五态与同步版同一套,且取消/缺席单列', async () => {
  /* 插件不在场 ⇒ engine-absent(**不是**「没查到」)。 */
  const absent = await Q.readMemoryQaAnswerAsync({}, 'q', {});
  assert.equal(absent.state, Q.MEMORY_QA_FACE_STATES.ENGINE_ABSENT);
  for (const k of Q.MEMORY_QA_KEYS) assert.ok(k in absent, '缺席也必须有键:' + k);
  /* 插件在场但没有异步出口 ⇒ face-absent,且 `async:false` 供调用方回落同步。 */
  const noAsync = await Q.readMemoryQaAnswerAsync(makePlugin({ async: false }), 'q', {});
  assert.equal(noAsync.state, Q.MEMORY_QA_FACE_STATES.FACE_ABSENT);
  assert.equal(noAsync.faceReason, 'async-face-absent');
  assert.equal(noAsync.async, false);
  /* 问到了 ⇒ ok,且 taskId 原样带回。 */
  const ok = await Q.readMemoryQaAnswerAsync(makePlugin(), 'q', { taskId: 'rp-ask:c:1' });
  assert.equal(ok.state, Q.MEMORY_QA_FACE_STATES.OK);
  assert.equal(ok.taskId, 'rp-ask:c:1');
  assert.equal(ok.async, true);
  assert.equal(ok.upstreamState, 'done');
  for (const k of Q.MEMORY_QA_KEYS) assert.ok(k in ok, '异步回执也必须有同步版那 15 键:' + k);
  /* 取消态:faceReason 单列成 'canceled'(与真·没命中分开)。 */
  const canceled = await Q.readMemoryQaAnswerAsync(makePlugin({
    impl: async (q, args) => ({
      version: 1, question: q, answer: [{ kind: 'open', text: '半份' }], gaps: [{ kind: 'canceled', why: 'x' }],
      refs: [], plans: [], masked: 0, truncated: false, resourced: 0, total: 1, knownActors: 0,
      reason: '', writesNothing: true, async: true, taskId: args.taskId, state: 'canceled', processed: { plans: 1, plansTotal: 3 }
    })
  }), 'q', {});
  assert.equal(canceled.faceReason, 'canceled');
  assert.equal(canceled.upstreamState, 'canceled');
  assert.notEqual(canceled.faceReason, 'no-answer', '取消与真·没命中不得同形');
  /* 抛错 ⇒ unusable(不冒泡)。 */
  const thrown = await Q.readMemoryQaAnswerAsync(makePlugin({ impl: async () => { throw new Error('boom'); } }), 'q', {});
  assert.equal(thrown.state, Q.MEMORY_QA_FACE_STATES.UNUSABLE);
  assert.equal(thrown.faceReason, 'thrown');
});

test('B8 异步读口把 shouldCancel 与 onProgress **原样**交给上游(本层不加逻辑)', async () => {
  const seen = { cancelFn: null, progressFn: null, taskId: '' };
  const plugin = makePlugin({
    impl: async (q, args) => {
      seen.cancelFn = typeof args.shouldCancel;
      seen.progressFn = typeof args.onProgress;
      seen.taskId = args.taskId;
      return {
        version: 1, question: q, answer: [], gaps: [], refs: [], plans: [],
        masked: 0, truncated: false, resourced: 0, total: 0, knownActors: 0,
        reason: '', writesNothing: true, async: true, taskId: args.taskId, state: 'done', processed: null
      };
    }
  });
  await Q.readMemoryQaAnswerAsync(plugin, 'q', { taskId: 't1', shouldCancel: () => false, onProgress: () => {} });
  assert.equal(seen.cancelFn, 'function', 'shouldCancel 必须原样传下去');
  assert.equal(seen.progressFn, 'function', 'onProgress 必须原样传下去');
  assert.equal(seen.taskId, 't1');
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 控制器:派发相一处判 + 代际一层管 + 同步版一行未改', () => {
  assert.match(appCode, /async askPastAsync\(question, hooks\) \{/, '必须有异步取数口');
  assert.match(appCode, /import \{[^}]*planAskPhase[^}]*\} from '\.\.\/\.\.\/config\/ask-request\.js';/,
    '派发相判定必须来自真源');
  assert.ok(appCode.includes('cancelAskNow()'), '必须有取消写口');
  assert.ok(appCode.includes('isAskingCanceled()'), '必须有取消读口');
  const body = appCode.slice(appCode.indexOf('async askPastAsync(question, hooks) {'));
  const fnBody = body.slice(0, body.indexOf('\n  }'));
  assert.ok(fnBody.includes('planAskPhase('), '派发相走真源');
  assert.ok(fnBody.includes('advanceAsk('), '代际走真源');
  assert.ok(fnBody.includes('isStale('), '旧回信判定走真源');
  assert.ok(fnBody.includes('shouldCancelFn('), '取消谓言走真源');
  assert.ok(fnBody.includes('makeAskTaskId('), '任务身份走真源');
  /* 同步版一行未改:仍直接调 readMemoryQaAnswer。 */
  assert.ok(appCode.includes('return readMemoryQaAnswer(typeof window !== \'undefined\' ? window : null, question, {});'),
    '同步兼容路径必须保留(上游明写不迁移不删除)');
  /* 换会话必须换掉 tracker(否则新会话的第 1 次会与上一段的第 1 次撞代际)。 */
  assert.ok(appCode.includes('this._askTracker = null;'), '换会话必须作废代际');
  const onChat = appCode.slice(appCode.indexOf('onChatChanged() {'));
  assert.ok(onChat.slice(0, 400).includes('this._askTracker = null;'), '作废必须落在 onChatChanged 里');
});

test('C2 视图:取消按钮真被绑定,运行态一行真被画', () => {
  assert.ok(viewCode.includes('id="mem-ask-cancel"'), '必须有取消按钮');
  assert.ok(viewCode.includes('id="mem-ask-run"'), '必须有运行态行');
  assert.ok(viewCode.includes("q('#mem-ask-cancel')?.addEventListener('click', () => this._cancelAsk());"),
    '按钮必须有事件落点');
  const go = viewCode.slice(viewCode.indexOf('_cancelAsk() {'));
  const goBody = go.slice(0, go.indexOf('\n  }'));
  assert.ok(goBody.includes('this.app.cancelAskNow?.()'), '落点必须真调控制器写口');
  assert.ok(goBody.includes("btn.hidden = true"), '按下后按钮必须收起(让用户看到已受理)');
});

test('C3 视图:旧回信**不画上面板**,取消态先声明「已处理部分」', () => {
  const doAsk = viewCode.slice(viewCode.indexOf('_doAsk() {'));
  const doAskBody = doAsk.slice(0, doAsk.indexOf('\n  /**'));
  assert.ok(doAskBody.includes('if (runState === ASK_RUN_STATES.STALE_DROPPED)'),
    '必须对 stale 单独分支');
  const staleBranch = doAskBody.slice(doAskBody.indexOf('if (runState === ASK_RUN_STATES.STALE_DROPPED)'));
  const branch = staleBranch.slice(0, staleBranch.indexOf('}'));
  assert.ok(branch.includes('return;'), 'stale 分支必须**不 paint**(直接返回)');
  assert.equal(/paint\(/.test(branch), false, 'stale 分支不得调 paint');
  /* 取消态:文案先说「已处理部分」再列答案。
   *   ★ 判据读的是**那一条 return 的拼接式**(输出次序的真证据),不是源码里两个名字谁先出现 ——
   *     首版按后者判,当场转红:源码里 `_askBodyHtml(r)` 是**先求值**再拼进 return 的,
   *     而输出里它是**后**出现的。又一次「判据自己错了,不是实现错了」。 */
  const face = viewCode.slice(viewCode.indexOf('_askFaceHtml(qa, runState) {'));
  const faceBody = face.slice(0, face.indexOf('\n  }'));
  assert.ok(faceBody.includes("runState === ASK_RUN_STATES.CANCELED"), '取消态必须单列');
  const ret = faceBody.slice(faceBody.indexOf('return '), faceBody.indexOf(';', faceBody.indexOf('return ')));
  const idxCanceled = ret.indexOf('已取消');
  const idxBody = ret.indexOf('+ body');
  assert.ok(idxCanceled >= 0 && idxBody > idxCanceled,
    '「已取消」必须排在答案主体**之前**(拼接式:' + ret.slice(0, 80) + ')');
});

test('C4 视图:进度回调也过代际(旧那一轮的进度不许刷进新问题)', () => {
  const doAsk = viewCode.slice(viewCode.indexOf('_doAsk() {'));
  const doAskBody = doAsk.slice(0, doAsk.indexOf('\n  /**'));
  assert.ok(doAskBody.includes('onProgress:'), '必须有进度回调');
  assert.ok(doAskBody.includes('onDone:'), '必须有完成回调');
  /* 进度守卫在控制器那一侧(视图不持 tracker)。 */
  const appBody = appCode.slice(appCode.indexOf('async askPastAsync(question, hooks) {'));
  const fnBody = appBody.slice(0, appBody.indexOf('\n  }'));
  const prog = fnBody.slice(fnBody.indexOf('onProgress: onProgress ?'));
  assert.ok(prog.slice(0, 300).includes('isStale(this._askTracker, gen)'),
    '进度回调必须先过代际守卫');
});

test('C5 样式两侧投递(源文件保留 + phone.css 打包)', () => {
  for (const [name, src] of [['phone.css', cssSrc], ['apps/memory/memory.css', appCssSrc]]) {
    for (const cls of ['.mem-ask-cancel', '.mem-ask-runline', '.mem-ask-canceled']) {
      assert.ok(src.includes(cls), name + ' 必须投递 ' + cls);
    }
  }
});

test('C6 上游异步出口名与键面:与 lonsha 侧逐字对齐(不各写一份)', () => {
  assert.ok(qaCode.includes('plugin.askMemoryQuestionAsync'), '必须调上游那一个名字');
  for (const k of ['async', 'taskId', 'upstreamState', 'processed']) {
    assert.ok(new RegExp('\\b' + k + ':').test(qaCode) || qaCode.includes(k), '异步面四键必须在场:' + k);
  }
  /* 同步版键面不得被改动。 */
  assert.equal(Q.MEMORY_QA_KEYS.length, 15);
  assert.ok(Q.MEMORY_QA_KEYS.includes('writesNothing'));
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时四条判据必须全为真(否则 D 组是假绿)', () => {
  assert.equal(/Number\.isFinite\(Number\(/.test(askCode), false, '纯函数件无弱口径');
  assert.ok(askCode.includes("if (st === 'canceled') return ASK_RUN_STATES.CANCELED;"));
  assert.ok(appCode.includes('this._askTracker = null;'));
  assert.ok(viewCode.includes('if (runState === ASK_RUN_STATES.STALE_DROPPED)'));
});

test('D1 ★★★ 破坏「取消与没命中不压平」⇒ 同款判据必转红', async () => {
  const broken = breakOnce(qaCode,
    "            state = MEMORY_QA_FACE_STATES.EMPTY; faceReason = 'canceled';",
    "            state = MEMORY_QA_FACE_STATES.EMPTY; faceReason = 'no-answer';",
    'd1');
  assert.equal(broken.includes("faceReason = 'canceled'"), false, '破坏副本:取消已与没命中同形');
  assert.ok(qaCode.includes("faceReason = 'canceled'"), '原版必须单列取消');
  /* 行为面同款判据(在原版模块上真跑):取消态必须报 canceled。 */
  const c = await Q.readMemoryQaAnswerAsync(makePlugin({
    impl: async (q, args) => ({
      version: 1, question: q, answer: [], gaps: [], refs: [], plans: [], masked: 0, truncated: false,
      resourced: 0, total: 0, knownActors: 0, reason: '', writesNothing: true,
      async: true, taskId: args.taskId, state: 'canceled', processed: null
    })
  }), 'q', {});
  assert.equal(c.faceReason, 'canceled', '原版必须把取消与「问了没命中」分开');
});

test('D2 ★★★ 破坏「旧回信不落面板」⇒ 同款判据必转红(旧覆盖新)', () => {
  const broken = breakOnce(viewCode,
    'if (runState === ASK_RUN_STATES.STALE_DROPPED) {',
    'if (false) {',
    'd2');
  assert.equal(broken.includes('ASK_RUN_STATES.STALE_DROPPED) {'), false, '破坏副本:已不再判 stale');
  assert.ok(viewCode.includes('ASK_RUN_STATES.STALE_DROPPED) {'), '原版必须判 stale');
  /* 行为面同款判据:代际一变,旧那一条必须判 stale。 */
  const t = A.newAskTracker();
  const g1 = A.advanceAsk(t);
  A.advanceAsk(t);
  assert.equal(A.isStale(t, g1), true, '原版必须判旧回信为 stale');
});

test('D3 ★★★ 破坏「换会话作废代际」⇒ 同款判据必转红(跨会话撞代际)', () => {
  const broken = breakOnce(appCode, '    this._askTracker = null;', '    /* removed */', 'd3');
  assert.equal(broken.includes('this._askTracker = null;'), false, '破坏副本:已不作废');
  assert.ok(appCode.includes('this._askTracker = null;'), '原版必须作废');
  /* 行为面同款判据:同一 tracker 不清 ⇒ 新的一段会与上一段撞代际。 */
  const t = A.newAskTracker();
  const a1 = A.advanceAsk(t);
  const b1 = A.advanceAsk(t);
  assert.notEqual(a1, b1, '不换 tracker 时两段必然串成同一条代际序列(故必须换)');
});

test('D4 ★★★ 破坏「派发相严格 true」⇒ 同款判据必转红(undefined 被读成「有异步口」)', () => {
  const broken = breakOnce(askCode,
    '    if (hasAsync === true) return ASK_PHASES.ASYNC;',
    '    if (hasAsync) return ASK_PHASES.ASYNC;',
    'd4');
  assert.equal(broken.includes('if (hasAsync === true)'), false, '破坏副本:已不再严格判');
  assert.ok(askCode.includes('if (hasAsync === true)'), '原版必须严格判');
  /* 行为面:严格版对 undefined 必须判「没有」。 */
  assert.equal(A.planAskPhase(undefined, true), 'sync');
  assert.equal(A.planAskPhase('yes', true), 'sync');
});

test('D5 ★★★ 破坏「任务身份带会话」⇒ 同款判据必转红(两会话撞同一身份)', () => {
  const broken = breakOnce(askCode,
    "    const c = (typeof chatId === 'string' && chatId.trim()) ? chatId.trim() : 'na';",
    "    const c = 'na';",
    'd5');
  assert.equal(broken.includes("chatId.trim()) ? chatId.trim()"), false, '破坏副本:已不带会话');
  assert.ok(askCode.includes("chatId.trim()) ? chatId.trim()"), '原版必须带会话');
  assert.notEqual(A.makeAskTaskId(1, 'A'), A.makeAskTaskId(1, 'B'), '两会话必须不同形');
});

/* ══════════════════ E. 版本锚(下限形) ══════════════════ */
test('E1 版本锚:三源一致且当版条目存在(不锁死具体版本号)', () => {
  const pkg = JSON.parse(read('package.json'));
  const man = JSON.parse(read('manifest.json'));
  const log = JSON.parse(read('update-log.json'));
  const ver = pkg.version;
  assert.match(ver, /^\d+\.\d+\.\d+$/);
  assert.equal(man.version, ver);
  assert.equal(log.latest, ver);
  assert.equal(log.head, ver);
  assert.ok(log.versions[ver], '当版条目必须存在');
  assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8);
  assert.ok(idxSrc.includes("const ST_PHONE_VERSION = '" + ver + "';"));
});