#!/usr/bin/env node
/* ============================================================
 * RubyPhone 注册联动门禁（registry gate）
 * ------------------------------------------------------------
 * 为什么存在（本仓反复出现的病）：
 *   新增一个 App 要动的地方分布在三个文件里，且**没有任何一处能回答「配齐了吗」**：
 *     ① `config/apps.js` 的 APPS 数组（桌面图标 / 默认色 / 徽标）；
 *     ② `index.js` 的 `phone:openApp` 懒加载分支（`appId === 'xxx'`）；
 *     ③ `config/storage.js` 的 CHAT_DATA_PATTERNS（会话隔离键前缀）。
 *   漏 ① → 桌面无图标；漏 ② → 点击无反应；漏 ③ → **数据落全局串味**（不报错、不崩溃，只错数据）。
 *   v2.63.0 / v2.64.0 两轮审计证明这类「静默错数据」是本仓最贵的缺陷形态；
 *   而注册三件套的漏配一直是靠人肉 review 发现的。
 *
 * 判据：
 *   R1（双向覆盖）APPS id 集合与 `appId === '...'` 分支集合必须**互为子集**。
 *      任一侧出现孤儿即红灯：有 App 无分支 = 点了没反应；有分支无 App = 死代码或改名漏改。
 *      —— 这是本门禁唯一「零豁免」的硬判据（真仓库当前 40 ↔ 40，完全干净）。
 *   R2（宽匹配登记）CHAT_DATA_PATTERNS 里带正则元字符的条目（`\d` / `(` / `*` / `[]` 等）
 *      必须登记在 REGEX_WIDE_ALLOWLIST 并写明理由。
 *      为什么单列这一条：宽匹配会**吞掉一批键**，使「某 App 有没有自己的隔离前缀」无法逐项核对
 *      （例如 `/^games_poker_(a|b|c)$/` 一次覆盖四个键）。新增宽匹配必须是有意识的决定，
 *      不能作为「省一条正则」的顺手写法。
 *      —— 注意：本条**不**判定「某 App 是否缺前缀」。理由见下方 R2-NOTE。
 *   R3（结构自证）扫描面低于下限即视为探测器失效（exit 2，拒判）。
 *   R4（夹具）`RP_REGISTRY_FIXTURE=1` 只放宽 R3 的最低计数闸，**不放宽 R1/R2**。
 *
 * R2-NOTE（为什么不判「App 缺前缀」）：
 *   实测有 19 个 App 在 CHAT_DATA_PATTERNS 中「无自己的前缀」，但它们**并非缺陷**——
 *   分两类：① 读侧聚合器 / 派生投影（mood、graph、peek、timeweaver、search 等不写会话数据）；
 *   ② 走 `^ruby_` 共享桶（achievement、xhs、tieba、health、gacha、tarot、reading、playlist…）。
 *   静态判据无法区分「设计内」与「漏配」，硬判会产生大量假阳性 ⇒ **只报告，不判定**。
 *
 * 用法：
 *   node scripts/registry-audit.mjs              # 校验（CI/发布门）
 *   node scripts/registry-audit.mjs --list       # 列出三方对账明细（含未直接命中前缀的 App）
 *   node scripts/registry-audit.mjs --root <dir> # 校验指定目录（负控制测试用）
 * 退出码：0=通过  1=存在孤儿分支/未登记宽匹配  2=结构漂移（探测器失效）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0
  ? path.resolve(args[rootIdx + 1] || '.')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listMode = args.includes('--list');
const FIXTURE_MODE = process.env.RP_REGISTRY_FIXTURE === '1';

if (rootIdx >= 0 && !fs.existsSync(root)) {
  console.error(`✗ --root 指向不存在的路径: ${root}`);
  process.exit(2);
}
const read = (rel) => {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
};

/* ---------- R2 白名单：真正「能匹配多个字面键」的宽匹配条目（新增必须登记理由）----------
 * 口径：只看**量词 / 字符类 / 分组 / 或 / 通配**（`\d` `[...]` `(...)` `|` `*` `+` `?` `.`）。
 *   `^` 与 `$` 只是锚定，不扩大匹配面 —— 例如 `/^games_board_state$/` 是**一个精确键**，不算宽匹配。
 *   （首版把 `$` 也当元字符，导致四个锚定精确键被误判为「未登记宽匹配」，实测修正。） */
const REGEX_WIDE_ALLOWLIST = [
  { prefix: 'pending[_-]contacts', why: '兼容历史两种写法（pending_contacts / pending-contacts），字符类覆盖两个固定键；两键同义，保留兼容。' },
  { prefix: 'games_\\d+_state', why: '2048 按棋盘尺寸动态生成键名（键名含数字），无法写成固定前缀。' },
  { prefix: 'games_poker_(', why: '扑克存档的一组固定键（user_chips / player_count / chips_mode / selected_contact_ids），一次覆盖四键。' }
];
// 白名单按**源码片段前缀**比对，而不是拿正则去测另一段正则源码文本。
//   踩坑记录：首版让 allowlist 用 `new RegExp` 去 `test(条目源码字符串)`，
//   目标是字符串 `pending[_-]contacts$`、判据是「以 pending+[_-]之一+contacts 开头」——
//   源码里的字面 `[` 不在字符类内，于是永远不匹配（实测：登记了却仍报未登记）。
const isRegisteredWide = (src) => REGEX_WIDE_ALLOWLIST.some((a) => src.startsWith(a.prefix));
const WIDE_META = /[\\()[\]{}|*+?.]/;

/* ---------- 三方读取 ---------- */
const appsSrc = read('config/apps.js');
const idxSrc = read('index.js');
const storSrc = read('config/storage.js');
for (const [name, src] of [['config/apps.js', appsSrc], ['index.js', idxSrc], ['config/storage.js', storSrc]]) {
  if (typeof src !== 'string' || !src.length) {
    console.error(`[registry] 读不到 ${name}（缺失或为空）—— fail-closed 拒判`);
    process.exit(2);
  }
}

// ① APPS id（只在 `export const APPS` 之后的数组体内取 `id: 'xxx'`）
const apssStart = appsSrc.indexOf('export const APPS');
if (apssStart < 0) {
  console.error('[registry] config/apps.js 未找到 `export const APPS` —— 结构已变，fail-closed 拒判');
  process.exit(2);
}
const appIds = [...new Set(
  [...appsSrc.slice(apssStart).matchAll(/^\s{4,12}id:\s*'([\w-]+)'/gm)].map((m) => m[1])
)];

// ② 懒加载分支（`appId === 'xxx'`，大小写不敏感）
const branchIds = [...new Set(
  [...idxSrc.matchAll(/appId\s*===\s*'([\w-]+)'/g)].map((m) => m[1].toLowerCase())
)];

// ③ 会话键前缀（CHAT_DATA_PATTERNS 数组体）
const patStart = storSrc.indexOf('CHAT_DATA_PATTERNS');
const patEnd = patStart >= 0 ? storSrc.indexOf('];', patStart) : -1;
if (patStart < 0 || patEnd < 0) {
  console.error('[registry] config/storage.js 未找到 CHAT_DATA_PATTERNS 数组 —— fail-closed 拒判');
  process.exit(2);
}
const prefixBody = storSrc.slice(patStart, patEnd);
const prefixes = [...prefixBody.matchAll(/\/\^([^/]+)\//g)].map((m) => m[1]);

/* ---------- R3：结构自证 ---------- */
if (!FIXTURE_MODE) {
  if (appIds.length < 30) {
    console.error(`[registry] 只解析到 ${appIds.length} 个 APPS id（低于下限 30）—— 枚举器或数组结构已失效，fail-closed 拒判`);
    process.exit(2);
  }
  if (branchIds.length < 30) {
    console.error(`[registry] 只解析到 ${branchIds.length} 个懒加载分支（低于下限 30）—— fail-closed 拒判`);
    process.exit(2);
  }
  if (prefixes.length < 20) {
    console.error(`[registry] 只解析到 ${prefixes.length} 条会话键前缀（低于下限 20）—— fail-closed 拒判`);
    process.exit(2);
  }
}

/* ---------- R1：双向覆盖 ---------- */
const A = new Set(appIds);
const B = new Set(branchIds);
const appsWithoutBranch = [...A].filter((x) => !B.has(x));
const branchesWithoutApp = [...B].filter((x) => !A.has(x));

/* ---------- R2：宽匹配登记 ---------- */
const unregisteredWide = prefixes.filter((p) => WIDE_META.test(p) && !isRegisteredWide(p));

/* ---------- 输出 ---------- */
const bucketPrefixes = prefixes.filter((p) => !WIDE_META.test(p));
console.log(`[registry] APPS id ${appIds.length} · 懒加载分支 ${branchIds.length} · 会话键前缀 ${prefixes.length}` +
  `（其中宽匹配 ${prefixes.filter((p) => WIDE_META.test(p)).length} 条，已登记 ${REGEX_WIDE_ALLOWLIST.length} 类）`);

if (listMode) {
  console.log('\n── R1 双向覆盖 ──');
  console.log('  有 App 无分支:', appsWithoutBranch.length ? appsWithoutBranch.join(', ') : '（无）');
  console.log('  有分支无 App:', branchesWithoutApp.length ? branchesWithoutApp.join(', ') : '（无）');
  console.log('\n── 单 token 前缀（可用于逐 App 对账） ──');
  console.log('  ' + bucketPrefixes.join(' '));
  console.log('\n── 宽匹配前缀（吞多键，逐项对账不适用） ──');
  for (const p of prefixes.filter((x) => WIDE_META.test(x))) {
    const hit = isRegisteredWide(p);
    console.log(`  ${p} ${hit ? '（已登记）' : '✗ 未登记'}`);
  }
  console.log('\n── 报告（不判定）：未直接命中自有前缀的 App ──');
  const noOwn = appIds.filter((id) => !bucketPrefixes.some((p) => p.startsWith(id + '_')));
  console.log('  ' + (noOwn.join(' ') || '（无）'));
  console.log('  说明：读侧聚合器 / 派生投影（不写会话数据）与 `ruby_` 共享桶成员均在列，属设计内。');
  process.exit(0);
}

let fail = 0;
if (appsWithoutBranch.length) {
  fail = 1;
  console.error(`[registry] ✗ R1 有 ${appsWithoutBranch.length} 个 App 定义了桌面图标却没有懒加载分支` +
    '（点击无反应）：');
  for (const x of appsWithoutBranch) console.error(`    ${x}`);
}
if (branchesWithoutApp.length) {
  fail = 1;
  console.error(`[registry] ✗ R1 有 ${branchesWithoutApp.length} 个懒加载分支找不到对应 APPS id` +
    '（死代码或改名漏改）：');
  for (const x of branchesWithoutApp) console.error(`    ${x}`);
}
if (unregisteredWide.length) {
  fail = 1;
  console.error(`[registry] ✗ R2 有 ${unregisteredWide.length} 条未登记的宽匹配会话键前缀：`);
  for (const p of unregisteredWide) console.error(`    /^${p}/`);
  console.error('  修法二选一：① 若可写成固定前缀（单 App 的键族），就改成固定前缀；' +
    '② 确需宽匹配，登记进 REGEX_WIDE_ALLOWLIST 并写明「为什么无法逐键列举」。');
}
console.log(fail === 0
  ? '[registry] ✓ 注册三方对账无孤儿 / 宽匹配前缀均已登记'
  : '[registry] ✗ 门禁未通过');
process.exit(fail);