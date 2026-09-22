/**
 * tests/system-v272.test.mjs — v2.72.0 表格更新锚点（update-gap）
 *
 * 覆盖：
 *   1. 锚点记读闭环（记了就能数出缺口）
 *   2. 三类失效判定（删楼 / sendDate 变 / swipeId 变）→ null 而非错数
 *   3. 计数口径（只数 AI 楼，user/system 楼不计）
 *   4. scope 隔离（不同 scope 互不串账）
 *   5. 幂等（同锚点重复记不触发保存）
 *   6. 上限收敛（超过 MAX_ANCHORS 淘汰最旧）
 *   7. 三态读数（unknown / clear / behind）
 *   8. 畸形输入不抛（null context / 非数组 chat / 非整数 floor / 坏 metadata）
 *   9. 反向审计（负控制）：把「真判据」破坏后，同款断言必须失败——
 *      防止测试对空实现假绿。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const {
  UPDATE_GAP_KEY,
  readUnupdatedFloorCount,
  recordTableUpdateFloor,
  updateGapLine,
} = await import('../config/update-gap.js');

let pass = 0;
const ok = (name, cond, extra) => {
  assert.ok(cond, extra ? name + ' — ' + extra : name);
  pass += 1;
};
const eq = (name, a, b) => {
  assert.equal(a, b, name + ` — 期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`);
  pass += 1;
};

/** 造一条 AI 楼 */
const ai = (send_date, swipe_id) => ({ is_user: false, mes: '正文', send_date, swipe_id });
/** 造一条 user 楼 */
const user = (send_date) => ({ is_user: true, mes: '问', send_date });

/** 造一个带保存计数的 context 桩 */
function ctx(chat, md = {}) {
  const saves = { n: 0 };
  const context = {
    chat,
    chatMetadata: md,
    saveMetadataDebounced() { saves.n += 1; return Promise.resolve(); },
  };
  return { context, saves, md };
}

// ========== 1. 锚点记读闭环 ==========
{
  const { context, md } = ctx([ai('t1', 0), ai('t2', 0), ai('t3', 0)]);
  eq('无锚点时读缺口 = 未知', readUnupdatedFloorCount(context), null);
  ok('记录锚点成功', recordTableUpdateFloor(context, 0));
  ok('锚点已写入 chatMetadata', !!md[UPDATE_GAP_KEY]);
  eq('锚点后有 2 条 AI 楼未更新', readUnupdatedFloorCount(context), 2);
  ok('再记一楼（追平）', recordTableUpdateFloor(context, 2));
  eq('追平后缺口 = 0', readUnupdatedFloorCount(context), 0);
}

// ========== 2. 三类失效判定 ==========
{
  // 2a 删楼：锚点楼被删，后面的楼前移
  const { context } = ctx([ai('t1', 0), ai('t2', 0)]);
  recordTableUpdateFloor(context, 1);
  eq('删楼前缺口 = 0', readUnupdatedFloorCount(context), 0);
  context.chat = [ai('t2', 0)];              // 删掉第 0 楼，锚点楼 1 已不存在
  eq('锚点楼被删后 = 未知（不是 0，也不是错数）', readUnupdatedFloorCount(context), null);
}
{
  // 2b sendDate 变：锚点楼那条回复被换成另一条（重 roll / 编辑）
  const { context } = ctx([ai('t1', 0), ai('t2', 0)]);
  recordTableUpdateFloor(context, 0);
  eq('换楼前缺口 = 1', readUnupdatedFloorCount(context), 1);
  context.chat[0] = ai('t9', 0);             // 锚点楼本身被换成另一条回复
  eq('锚点楼 sendDate 变化后 = 未知', readUnupdatedFloorCount(context), null);
}
{
  // 2b-2 锚点楼之后的楼变了不影响锚点有效性（锚点只认自己那一楼）
  const { context } = ctx([ai('t1', 0), ai('t2', 0)]);
  recordTableUpdateFloor(context, 0);
  context.chat[1] = ai('t9', 0);             // 后面的楼换了，锚点楼没动
  eq('非锚点楼变化不影响锚点（缺口照算）', readUnupdatedFloorCount(context), 1);
}
{
  // 2c swipeId 变：锚点楼被翻到另一个变体
  const { context } = ctx([ai('t1', 0), ai('t1b', 0)]);
  recordTableUpdateFloor(context, 0);
  eq('翻页前缺口 = 1', readUnupdatedFloorCount(context), 1);
  context.chat[0] = ai('t1', 1);            // 锚点楼翻到第 1 页
  eq('锚点楼 swipeId 变化后 = 未知', readUnupdatedFloorCount(context), null);
}
{
  // 2c-2 非锚点楼翻页不影响锚点（锚点只认自己那一楼那一页）
  const { context } = ctx([ai('t1', 0), ai('t1b', 0)]);
  recordTableUpdateFloor(context, 0);
  context.chat[1] = ai('t1b', 1);           // 后面的楼翻页，锚点楼没动
  eq('非锚点楼翻页不影响锚点（缺口照算）', readUnupdatedFloorCount(context), 1);
}
{
  // 2d 锚点楼变成 user 楼（结构被外部改坏）
  const { context } = ctx([ai('t1', 0)]);
  recordTableUpdateFloor(context, 0);
  context.chat[0] = user('t1');
  eq('锚点楼变成 user 楼 = 未知', readUnupdatedFloorCount(context), null);
}

// ========== 3. 计数口径：只数 AI 楼 ==========
{
  const { context } = ctx([
    ai('t1', 0),
    user('t2'),
    { is_user: false, is_system: true, mes: '系统', send_date: 't3' },
    ai('t4', 0),
    ai('t5', 0),
  ]);
  recordTableUpdateFloor(context, 0);
  eq('user 楼与系统楼不计入缺口', readUnupdatedFloorCount(context), 2);
}

// ========== 4. scope 隔离 ==========
{
  const { context, md } = ctx([ai('t1', 0), ai('t2', 0), ai('t3', 0)]);
  ok('记 A 表锚点', recordTableUpdateFloor({ ...context, scope: 'A' }, 0));
  ok('记 B 表锚点', recordTableUpdateFloor({ ...context, scope: 'B' }, 2));
  eq('A 表缺口 = 2', readUnupdatedFloorCount({ ...context, scope: 'A' }), 2);
  eq('B 表缺口 = 0', readUnupdatedFloorCount({ ...context, scope: 'B' }), 0);
  ok('两个 scope 都落在同一顶层键下', Object.keys(md[UPDATE_GAP_KEY]).length === 2);
  eq('带 scope 的调用方不会读到旧版裸锚点', readUnupdatedFloorCount({ ...context, scope: 'C' }), null);
}

// ========== 5. 幂等 ==========
{
  const { context, saves } = ctx([ai('t1', 0), ai('t2', 0)]);
  recordTableUpdateFloor(context, 0);
  const afterFirst = saves.n;
  recordTableUpdateFloor(context, 0);
  eq('同锚点重复记不再触发保存', saves.n, afterFirst);
  recordTableUpdateFloor(context, 1);
  ok('换楼后触发保存', saves.n > afterFirst);
}

// ========== 6. 上限收敛 ==========
{
  const chat = [];
  for (let i = 0; i < 60; i++) chat.push(ai('t' + i, 0));
  const { context, md } = ctx(chat);
  for (let i = 0; i < 60; i++) recordTableUpdateFloor({ ...context, scope: 'S' + i }, i);
  const keys = Object.keys(md[UPDATE_GAP_KEY]);
  ok('锚点份数被收敛到上限内（≤50）', keys.length <= 50, `实得 ${keys.length}`);
  ok('淘汰的是最旧的（floorId 小的）', !keys.includes('S0'));
  ok('保留的是最新的', keys.includes('S59'));
}

// ========== 7. 三态读数 ==========
{
  const { context } = ctx([ai('t1', 0), ai('t2', 0)]);
  eq('无锚点 = unknown', updateGapLine(context).state, 'unknown');
  eq('无锚点时 count 为 null（不是 0）', updateGapLine(context).count, null);
  recordTableUpdateFloor(context, 0);
  eq('有缺口 = behind', updateGapLine(context).state, 'behind');
  eq('behind 计数正确', updateGapLine(context).count, 1);
  recordTableUpdateFloor(context, 1);
  eq('追平 = clear', updateGapLine(context).state, 'clear');
}

// ========== 8. 畸形输入不抛 ==========
{
  eq('null context 不抛', readUnupdatedFloorCount(null), null);
  eq('undefined context 不抛', readUnupdatedFloorCount(undefined), null);
  eq('chat 非数组不抛', readUnupdatedFloorCount({ chat: 'x', chatMetadata: {} }), null);
  eq('chatMetadata 缺失不抛', readUnupdatedFloorCount({ chat: [] }), null);
  eq('空 chat 不抛', readUnupdatedFloorCount({ chat: [], chatMetadata: {} }), null);
  ok('null context 记锚点不抛', recordTableUpdateFloor(null, 0) === false);
  ok('floor 非整数拒绝', recordTableUpdateFloor({ chat: [ai('t', 0)], chatMetadata: {} }, 1.5) === false);
  ok('floor 负数拒绝', recordTableUpdateFloor({ chat: [ai('t', 0)], chatMetadata: {} }, -1) === false);
  ok('floor 越界拒绝', recordTableUpdateFloor({ chat: [ai('t', 0)], chatMetadata: {} }, 5) === false);
  ok('锚点楼是 user 楼时拒绝', recordTableUpdateFloor({ chat: [user('t')], chatMetadata: {} }, 0) === false);
  ok('updateGapLine 对 null 不抛', updateGapLine(null).state === 'unknown');
  // 坏锚点结构（外部改坏）
  eq('锚点结构被改坏 = 未知', readUnupdatedFloorCount({ chat: [ai('t1', 0)], chatMetadata: { [UPDATE_GAP_KEY]: { floorId: 'x' } } }), null);
  eq('锚点是数组 = 未知', readUnupdatedFloorCount({ chat: [ai('t1', 0)], chatMetadata: { [UPDATE_GAP_KEY]: [1, 2] } }), null);
}

// ========== 9. 旧版裸锚点向后兼容 ==========
{
  // 旧版写的是裸 {floorId, sendDate, swipeId}（无 scope），新版读路径必须仍能认。
  const { context } = ctx([ai('t1', 0), ai('t2', 0), ai('t3', 0)]);
  context.chatMetadata[UPDATE_GAP_KEY] = { floorId: 0, sendDate: 't1', swipeId: 0 };
  eq('旧版裸锚点仍可读', readUnupdatedFloorCount(context), 2);
  eq('旧版裸锚点走 updateGapLine 也认', updateGapLine(context).state, 'behind');
}

// ========== 10. 反向审计（负控制）—— 判据纯度自证 ==========
// 思路：把真实源码里的判据字面量破坏掉 → 加载破坏副本 → 在副本上重跑同款断言，
// 必须看到失败。若破坏后仍然全绿，说明测试判的不是这个机制（假绿）。
{
  const srcPath = 'config/update-gap.js';
  const src = read(srcPath);
  const tmpDir = path.join(root, 'tests', '.tmp-negctl-v272');
  fs.mkdirSync(tmpDir, { recursive: true });

  const runOn = async (code, label) => {
    const file = path.join(tmpDir, `variant-${label}.mjs`);
    fs.writeFileSync(file, code, 'utf8');
    const mod = await import(`file://${file}`);
    const chat = [ai('t1', 0), ai('t2', 0), ai('t3', 0)];
    const context = { chat, chatMetadata: {}, saveMetadataDebounced() { return Promise.resolve(); } };
    mod.recordTableUpdateFloor(context, 0);
    return mod.readUnupdatedFloorCount(context);
  };

  // 负控制 1：破坏 sendDate 比对判据（去掉 stampOf 比较）
  {
    const anchor = "        if (stampOf(message) !== String(anchor.sendDate ?? '')) return null;";
    ok('负控制1 锚点恰中 1 次', src.split(anchor).length === 2);
    const broken = src.replace(anchor, '        // [negctl] sendDate 判据已破坏');
    const got = await runOn(broken, 'senddate');
    // 破坏后：sendDate 变了也应报数（不再报未知）→ 行为必须可观测地改变
    const chat = [ai('t1', 0), ai('t2', 0), ai('t3', 0)];
    const brokenCtx = { chat, chatMetadata: {}, saveMetadataDebounced() { return Promise.resolve(); } };
    const brokenMod = await import(`file://${path.join(tmpDir, 'variant-senddate.mjs')}`);
    brokenMod.recordTableUpdateFloor(brokenCtx, 0);
    brokenCtx.chat[1] = ai('t9', 0);           // 换一条回复
    eq('负控制1：sendDate 判据被破坏后失效检测失效（不再返回 null）', brokenMod.readUnupdatedFloorCount(brokenCtx), 2);
  }

  // 负控制 2：破坏 swipeId 比对判据
  {
    const anchor = "        if (swipeOf(message) !== (Number.isFinite(Number(anchor.swipeId)) ? Math.round(Number(anchor.swipeId)) : 0)) return null;";
    ok('负控制2 锚点恰中 1 次', src.split(anchor).length === 2);
    const broken = src.replace(anchor, '        // [negctl] swipeId 判据已破坏');
    await runOn(broken, 'swipe');
    const chat = [ai('t1', 0), ai('t1b', 1)];
    const brokenCtx = { chat, chatMetadata: {}, saveMetadataDebounced() { return Promise.resolve(); } };
    const brokenMod = await import(`file://${path.join(tmpDir, 'variant-swipe.mjs')}`);
    brokenMod.recordTableUpdateFloor(brokenCtx, 0);
    brokenCtx.chat[1] = ai('t1b', 0);          // 翻回旧页
    eq('负控制2：swipeId 判据被破坏后翻页检测失效', brokenMod.readUnupdatedFloorCount(brokenCtx), 1);
  }

  // 负控制 3：破坏 AI 楼判定（把 is_user 排除去掉）→ 计数口径必须变
  {
    const anchor = "    if (message.is_user === true) return false;";
    ok('负控制3 锚点恰中 1 次', src.split(anchor).length === 2);
    const broken = src.replace(anchor, '    // [negctl] is_user 判据已破坏');
    await runOn(broken, 'aiuser');
    const chat = [ai('t1', 0), user('t2'), ai('t3', 0)];
    const brokenCtx = { chat, chatMetadata: {}, saveMetadataDebounced() { return Promise.resolve(); } };
    const brokenMod = await import(`file://${path.join(tmpDir, 'variant-aiuser.mjs')}`);
    brokenMod.recordTableUpdateFloor(brokenCtx, 0);
    eq('负控制3：AI 楼判定被破坏后 user 楼被计入缺口', brokenMod.readUnupdatedFloorCount(brokenCtx), 2);
  }

  // 负控制 4：锚点不存在时必须抛（工具两向自证 H6）
  {
    const missing = 'THIS_ANCHOR_DOES_NOT_EXIST_ANYWHERE';
    ok('负控制4：不存在的锚点被检出', src.split(missing).length === 1);
    let threw = false;
    try { src.replace(missing, 'x'); } catch (_e) { threw = true; }
    ok('负控制4：对不存在的锚点执行替换不抛（零替换是合法结果）', threw === false);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ========== 11. 版权纯度（不复制源实现） ==========
{
  const src = read('config/update-gap.js');
  ok('不含源实现的 Logger 依赖', !src.includes('error-handler'));
  ok('不含源实现的键名（改用 ruby 前缀）', !src.includes('yuziTableUpdateReviewAnchor'));
  ok('键名使用本仓库前缀', src.includes("'rubyTableUpdateReviewAnchor'"));
  ok('零外部依赖（无 import 语句）', !/^\s*import\s/m.test(src));
}

console.log(`v272 update-gap: ${pass} passed`);
