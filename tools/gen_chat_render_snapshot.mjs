#!/usr/bin/env node
/* ============================================================
 * tools/gen_chat_render_snapshot.mjs — 重落 R22-O1 渲染快照基线
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   基线不许手抄。上一次漂移（`bubble.emojiToken` / `emojiPanel` 两键）
 *   查下来是**采集层把检出根绝对路径也 hash 进去了**，
 *   换一个目录检出就必红 —— 那不是产品变了，是判据耦合了环境。
 *   现在 `tests/_chat_render_snapshot.mjs` 里先把检出根折成 `<repo-root>`，
 *   这份工具就用同一套采集函数重算，避免「工具算一套、测试算另一套」。
 *
 * 三条自我约束（都是本仓反复踩过的坑）：
 *   1. **确定性自检**：同一份代码连跑两次，12 个键必须逐字节相同；
 *      任何一键抖了就 exit 2，不把抖动读数落账。
 *   2. **`__error` 不许落账**：抛错形态进了基线，等于把「跑不通」当通过。
 *   3. **写后复读复算**：写进文件的 hash 必须与再次计算的结果一致，否则 exit 2。
 *
 * 用法：
 *   node tools/gen_chat_render_snapshot.mjs           # 只算不写（默认，安全）
 *   node tools/gen_chat_render_snapshot.mjs --write   # 真正落账
 * ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SNAPSHOT_REL = 'tests/audit/chat_render_snapshot.json';
const SNAPSHOT_ABS = path.join(ROOT, SNAPSHOT_REL);
const EXPECT_KEYS = 12;
const write = process.argv.includes('--write');

const die = (msg) => {
  console.error('[gen-chat-render-snapshot] 失败：' + msg);
  process.exit(2);
};

const { captureChatRenderSnapshot } = await import(path.join(ROOT, 'tests/_chat_render_snapshot.mjs'));
const { ChatView } = await import(path.join(ROOT, 'apps/wechat/chat-view.js'));

/* ---- 1. 采两次，验确定性 ---- */
const first = captureChatRenderSnapshot(ChatView);
const second = captureChatRenderSnapshot(ChatView);

const keys = Object.keys(first);
if (keys.length !== EXPECT_KEYS) die('快照键数应为 ' + EXPECT_KEYS + '，实得 ' + keys.length + '：' + keys.join(','));

const unstable = keys.filter((k) => first[k] !== second[k]);
if (unstable.length) {
  die('同一份代码连跑两次结果不一致（读数本身在抖，先查量法）：' + unstable.join(','));
}

const errKeys = Object.entries(first).filter(([, v]) => String(v).startsWith('__error:'));
if (errKeys.length) die('出现 __error 形态，不许落账：' + JSON.stringify(errKeys));

/* ---- 2. 读旧账，做变更摘要 ---- */
const old = existsSync(SNAPSHOT_ABS) ? JSON.parse(readFileSync(SNAPSHOT_ABS, 'utf8')) : null;
const oldSnap = (old && old.snapshots) || {};

const changed = [];
const added = [];
for (const k of keys) {
  if (!(k in oldSnap)) { added.push(k); continue; }
  if (oldSnap[k] !== first[k]) changed.push(k);
}
const removed = Object.keys(oldSnap).filter((k) => !(k in first));

console.log('[gen-chat-render-snapshot] 确定性自检通过（连跑两次 ' + keys.length + ' 键逐字节相同）');
console.log('  新增 ' + (added.length ? added.join(',') : '无'));
console.log('  变更 ' + (changed.length ? changed.join(',') : '无'));
console.log('  消失 ' + (removed.length ? removed.join(',') : '无'));
for (const k of changed) console.log('    ' + k + '\n      旧 ' + oldSnap[k] + '\n      新 ' + first[k]);

/* 没有任何实质变化 ⇒ 不动 generated_at，免得每次跑都产生一串无意义 diff */
const noRealChange = !added.length && !changed.length && !removed.length;
const generatedAt = noRealChange && old && old.generated_at
  ? old.generated_at
  : new Date().toISOString();

const next = {
  schema: (old && old.schema) || 'chat-render-snapshot@1',
  plan: (old && old.plan) || 'R22-O1',
  plan_note: (old && old.plan_note) || '抽 chat-render-core.js 之前捕获的渲染输出 sha256；抽之后必须逐键相同（__error 形态也算一项，不许把抛错当通过）。',
  generated_at: generatedAt,
  snapshots: first,
};

if (!write) {
  console.log('[gen-chat-render-snapshot] 未加 --write，只算不写。');
  process.exit(0);
}

writeFileSync(SNAPSHOT_ABS, JSON.stringify(next, null, 2) + '\n', 'utf8');

/* ---- 3. 写后复读复算 ---- */
const back = JSON.parse(readFileSync(SNAPSHOT_ABS, 'utf8'));
const mismatch = keys.filter((k) => back.snapshots[k] !== first[k]);
if (!back.snapshots || mismatch.length) die('写后复读对不上：' + mismatch.join(','));
const third = captureChatRenderSnapshot(ChatView);
const drift = keys.filter((k) => third[k] !== back.snapshots[k]);
if (drift.length) die('写后再算一次就漂了：' + drift.join(','));

console.log('[gen-chat-render-snapshot] 已写入 ' + SNAPSHOT_REL + '（写后复读 + 复算双检通过）');
