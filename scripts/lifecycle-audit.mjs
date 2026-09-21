#!/usr/bin/env node
/* ============================================================
 * RubyPhone 会话生命周期接线门禁（lifecycle gate）
 * ------------------------------------------------------------
 * 为什么存在（本仓反复出现的病）：
 *   v2.23 / v2.24 / v2.25 / v2.30 / v2.33 / v2.34 / v2.46 / v2.53 / v2.55 连续九版
 *   都在治同一类形态 —— **会话生命周期接线漏一处**：
 *     ① 写了生命周期出口（onChatChanged / clearCache / destroy / deactivate）却没人调 → 换会话串味；
 *     ② 出口被调了，但只在三条会话路径中的**一条**上被调 → 另一条路径漏回收；
 *     ③ 槽位被顶替 / 实例被覆盖，旧实例的构造期监听器无人解绑 → 静默泄漏。
 *   三者共同点：**不报错、不崩溃、只错数据或只漏资源**。单元测试只测被调到的那个纯逻辑，
 *   于是 100% 覆盖、0 会话隔离。每次都是人肉侦察 + 事后补接线，**没有任何门禁能拦住新的一例**。
 *
 * 本门禁把这份「接线契约」变成发布前的硬约束：
 *   L1（方法出口）凡在 App 类里定义了生命周期出口、且能反查到 `VirtualPhone.X = new module.Class`
 *      单例槽位的，必须至少有一处接线路径：REBIND 表 / index.js 里的显式调用 / 泛化调用清单。
 *   L2（槽位覆盖）凡持有实例的 App 槽位，若在**换会话**路径被回收，则两条清数据路径必须有
 *      至少一处同样覆盖（或落在咽喉点收口清单里）—— 只覆盖一条路径是「漏一条」的典型形态。
 *   L3（结构自证）两类白名单都**从真源码派生**，不硬编码：
 *      · 泛化调用清单 ← 解析 `releasePhoneInactiveResources` 的 `appEntries` 数组；
 *      · 咽喉点清单   ← 解析 `retireSessionScopedSlots` 函数体。
 *      派生的前提模式若消失，立即 fail-closed（exit 2，拒判）—— 白名单不得复活成放行条。
 *   L4（枚举面自证）扫描面低于下限即视为探测器失效（exit 2），防「探测器坏了以全绿通过」。
 *
 * 为什么白名单必须从源码派生（而不是写死一份名字）：
 *   写死的白名单会在机制变更后继续放行 —— 例如某天 `retireSessionScopedSlots` 被删除，
 *   硬编码清单仍会把 gamesApp / worldpulseApp 判为「已收口」，门禁变成吉祥物。
 *   派生式白名单的语义是「因为这些名字**确实**出现在咽喉点的回收代码里，所以放行」。
 *
 * 负控制纪律（测试节遵守）：
 *   真源码破坏（锚点恰中 1 次）→ 写到临时副本 → **在副本上重跑同款真判据**。
 *   禁止「对原文件断言」（破坏没发生也绿）、禁止把破坏写成模拟常量（真判据没被调用）、
 *   禁止破坏把判据自己删掉（自我指涉）。
 *
 * 用法：
 *   node scripts/lifecycle-audit.mjs              # 校验（CI/发布门）
 *   node scripts/lifecycle-audit.mjs --list       # 列出全部槽位与判定明细
 *   node scripts/lifecycle-audit.mjs --root <dir> # 校验指定目录（负控制测试用）
 * 退出码：0=通过  1=存在未接线的生命周期出口/未覆盖槽位  2=结构漂移（探测器失效）
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
// 夹具通道：负控制测试塞合成小仓库时放宽结构下限
const FIXTURE_MODE = process.env.RP_LIFECYCLE_FIXTURE === '1';

if (rootIdx >= 0 && !fs.existsSync(root)) {
  console.error(`✗ --root 指向不存在的路径: ${root}`);
  process.exit(2);
}

const readFile = (rel) => {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
};
const idx = readFile('index.js');
if (typeof idx !== 'string' || !idx.length) {
  console.error('[lifecycle] 读不到 index.js（或被 r-- 空文件）—— fail-closed 拒判');
  process.exit(2);
}
const idxLines = idx.split('\n');
const lineOf = (re, from = 0) => {
  for (let i = from; i < idxLines.length; i++) if (re.test(idxLines[i])) return i;
  return -1;
};

/* ---------- 三条会话路径的区间（必须用函数/监听器边界精确划定）----------
 * 踩坑记录：首版探针用「以某个锚点为中轴、前后各取 N 行」的近似区间，
 *   结果 P2 的区间与 P1 尾部重叠，把 P1 的行误算成 P2 命中，真缺口差点被判为已覆盖。
 *   P1 的载体是一个**被调用的函数** onChatChanged()（不是事件监听器），锚点与另两条不同。 */
function detectPaths() {
  const p1s = lineOf(/^\s*function onChatChanged\(\)\s*\{/);
  const p1e = lineOf(/^\s*function getContext\(\)\s*\{/, p1s + 1);
  const p2s = lineOf(/addEventListener\(\s*'phone:clearCurrentData'/);
  const p3s = lineOf(/addEventListener\(\s*'phone:clearAllData'/);
  const p3e = p3s >= 0 ? lineOf(/addEventListener\(/, p3s + 1) : -1;
  return {
    P1: p1s >= 0 && p1e > p1s ? [p1s, p1e] : null,
    P2: p2s >= 0 && p3s > p2s ? [p2s, p3s] : null,
    P3: p3s >= 0 ? [p3s, p3e > p3s ? p3e : idxLines.length] : null
  };
}
const PATHS = detectPaths();
const pathMissing = Object.entries(PATHS).filter(([, v]) => !v).map(([k]) => k);
// 结构守卫**无条件** fail-closed（夹具模式也只放宽「最低计数」，不放宽锚点）：
//   锚点缺失时任何判定都不可信，若此时仍出口 0/1，就是在用坏探针发合格证。
if (pathMissing.length) {
  console.error(`[lifecycle] 三条会话路径锚点缺失: ${pathMissing.join(',')}` +
    '（index.js 结构已变，门禁判据失效）—— fail-closed 拒判');
  process.exit(2);
}

/* ---------- L3：白名单从真源码派生 ---------- */
/* 函数体抽取：按**花括号配平**定位函数末尾。
 *   为什么不用「找缩进 4 空格的收尾大括号」那种写法：那个假设只在函数嵌在 4 空格块内时成立
 *   （真仓库的这两个函数恰好如此），一旦函数挪到别处或缩进变化，抽取会静默返回 null，
 *   进而把白名单判为「无法派生」→ 拒判（fail-closed 生效，但误报为结构漂移）。
 *   实测：本门禁的夹具（顶格书写）就因此误判。配平式抽取与缩进无关。
 *   局限（已知）：不跳过字符串/注释里的花括号；这两个函数体内不含此类花括号，
 *   若将来出现在场，须升级为词法扫描（在此处留下提示）。 */
function extractFn(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index + m[0].length);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  return null;
}
// 泛化调用清单：releasePhoneInactiveResources 的 appEntries 数组 + 循环体对实例调 deactivate
function deriveArrayGeneralized() {
  const body = extractFn(idx, 'releasePhoneInactiveResources');
  if (!body) return null;
  const arr = body.match(/appEntries\s*=\s*\[([\s\S]*?)\];/) || [];
  if (!arr[1] || !/appEntries\.forEach/.test(body) || !/\.deactivate\?\.\(\)/.test(body)) return null;
  const names = [...arr[1].matchAll(/(?:phone|\w+)\.(\w+)/g)].map((m) => m[1]);
  return { names: new Set(names), body };
}
// 咽喉点清单：retireSessionScopedSlots 函数体里被回收的槽位
function deriveChokePoint() {
  const body = extractFn(idx, 'retireSessionScopedSlots');
  if (!body) return null;
  const names = [...body.matchAll(/phone\.(\w+)/g)].map((m) => m[1]);
  return { names: new Set(names), body };
}
const ARRAY_GEN = deriveArrayGeneralized();
const CHOKE = deriveChokePoint();
// 两类白名单的「派生前提」也**无条件** fail-closed：前提消失 ⇒ 白名单不可信 ⇒ 拒判。
//   注意这与「白名单为空」不同：派生成功但集合为空是合法的（确实没有泛化调用）。
if (!ARRAY_GEN) {
  console.error('[lifecycle] 无法从 releasePhoneInactiveResources 派生泛化调用清单' +
    '（appEntries / forEach / .deactivate?.() 三者须同时在场）—— 白名单前提消失，fail-closed 拒判');
  process.exit(2);
}
if (!CHOKE) {
  console.error('[lifecycle] 无法从 retireSessionScopedSlots 派生咽喉点清单 —— fail-closed 拒判');
  process.exit(2);
}

/* ---------- 扫描 apps 下的 App 类与生命周期出口 ---------- */
const EXITS = ['onChatChanged', 'clearCache', 'destroy', 'deactivate', 'reload'];
const appsDir = path.join(root, 'apps');
if (!fs.existsSync(appsDir)) {
  console.error('[lifecycle] apps/ 目录不存在 —— fail-closed 拒判');
  process.exit(2);
}
const classes = [];
for (const dir of fs.readdirSync(appsDir)) {
  const abs = path.join(appsDir, dir);
  let isDir = false;
  try { isDir = fs.statSync(abs).isDirectory(); } catch { /* 忽略 */ }
  if (!isDir) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('-app.js')) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(abs, f), 'utf8'); } catch { continue; }
    for (const cm of src.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) {
      const body = src.slice(cm.index);
      const defined = EXITS.filter((e) => new RegExp('\\n\\s*' + e + '\\s*\\(').test(body));
      if (!defined.length) continue;
      // 反查单例槽位：VirtualPhone.X = new (module.)?Class(
      const keys = [...idx.matchAll(
        new RegExp('VirtualPhone\\.(\\w+)\\s*=\\s*new\\s+(?:module\\.)?' + cm[1] + '\\b', 'g')
      )].map((m) => m[1]);
      classes.push({ dir, file: f, cls: cm[1], exits: defined, keys: [...new Set(keys)] });
    }
  }
}

/* ---------- L1：方法出口必须有接线路径 ---------- */
const REBIND = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
const REBIND_KEYS = new Set([...REBIND.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]));
// 显式调用：三种真实书写形态都要认（漏认 ⇒ 假阳性：
//   · `window.VirtualPhone.plotlineApp.render()`   —— 全限定名
//   · `phone.gamesApp.deactivate?.()`              —— 局部句柄（函数内 const phone = window.VirtualPhone）
//   · `phone.worldpulseApp.onChatChanged?.()`      —— 句柄 + 可选调用
//   踩坑记录两则：① 首版在括号前多写了一个必选点（`method + '\\??\\.\\('`），**所有显式调用都匹配不到**；
//   ② 只认 `VirtualPhone.` 前缀时，`phone.worldpulseApp.onChatChanged?.()` 被漏认 ⇒ 真仓库出现假阳性。
//   判据必须匹配真实书写，故这里同时收 `[\w$]*` 句柄前缀与可选调用括号。
const explicitCall = (key, method) => new RegExp(
  '(?:VirtualPhone|[A-Za-z_$][\\w$]*)\\??\\.' + key + '\\??\\.' + method + '\\s*\\??\\.?\\s*\\(').test(idx);

const l1 = [];
for (const c of classes) {
  if (!c.keys.length) continue;                       // 反查不到槽位（未以单例形式挂载）→ 不在本判据射程
  const wired = c.keys.some((k) => REBIND_KEYS.has(k)
    || c.exits.some((e) => explicitCall(k, e))
    || (ARRAY_GEN && ARRAY_GEN.names.has(k)));
  if (!wired) l1.push(c);
}

/* ---------- L2：槽位 × 三路径覆盖 ---------- */
const EXIT_CALL = /\.(clearCache|destroy|deactivate|onChatChanged|reload|clearCurrentChat|clear)\??\.?\(/;
const slots = new Set([...idx.matchAll(/VirtualPhone\.(\w+)\s*=\s*new\b/g)].map((m) => m[1]));
const regionHasExit = (range, name) => {
  if (!range) return false;
  for (let i = range[0]; i <= range[1] && i < idxLines.length; i++) {
    if (new RegExp('\\b' + name + '\\b').test(idxLines[i]) && EXIT_CALL.test(idxLines[i])) return true;
  }
  return false;
};
const l2 = [];
const matrix = [];
for (const s of [...slots].sort()) {
  const inP1 = regionHasExit(PATHS.P1, s);
  const inP2 = regionHasExit(PATHS.P2, s);
  const inP3 = regionHasExit(PATHS.P3, s);
  const viaChoke = !!(CHOKE && CHOKE.names.has(s));
  const covered = !inP1 || inP2 || inP3 || viaChoke;
  if (inP1 || inP2 || inP3 || viaChoke) matrix.push({ s, inP1, inP2, inP3, viaChoke, covered });
  if (!covered) l2.push({ slot: s, inP1, inP2, inP3 });
}

/* ---------- L4：枚举面自证 ---------- */
if (!FIXTURE_MODE) {
  if (slots.size < 20) {
    console.error(`[lifecycle] 只枚举到 ${slots.size} 个实例槽位（低于下限 20）——` +
      '槽位枚举器或 index.js 结构已失效，fail-closed 拒判');
    process.exit(2);
  }
  if (classes.length < 20) {
    console.error(`[lifecycle] 只枚举到 ${classes.length} 个含生命周期出口的 App 类（低于下限 20）——` +
      '类枚举器或 apps/ 结构已失效，fail-closed 拒判');
    process.exit(2);
  }
  if (REBIND_KEYS.size < 15) {
    console.error(`[lifecycle] REBIND 表只解析出 ${REBIND_KEYS.size} 个 key（低于下限 15）—— fail-closed 拒判`);
    process.exit(2);
  }
}

/* ---------- 输出 ---------- */
console.log(`[lifecycle] 扫描 ${classes.length} 个含生命周期出口的 App 类 / ${slots.size} 个实例槽位`);
console.log(`[lifecycle] REBIND 表 ${REBIND_KEYS.size} key · 泛化调用清单 ` +
  `${ARRAY_GEN ? ARRAY_GEN.names.size : 0} 项（源码派生）· 咽喉点清单 ${CHOKE ? CHOKE.names.size : 0} 项（源码派生）`);
console.log(`[lifecycle] 三路径区间：` +
  Object.entries(PATHS).map(([k, v]) => `${k}=${v ? (v[0] + 1) + '..' + (v[1] + 1) : '缺失'}`).join(' · '));

if (listMode) {
  console.log('\n── 槽位 × 三路径矩阵 ──');
  for (const m of matrix) {
    console.log(`  ${m.s.padEnd(24)} P1=${m.inP1 ? '✓' : '—'} P2=${m.inP2 ? '✓' : '—'} ` +
      `P3=${m.inP3 ? '✓' : '—'} ${m.viaChoke ? '咽喉点' : ''} ${m.covered ? '' : '✗ 未覆盖'}`);
  }
  console.log('\n── L1 方法出口接线 ──');
  for (const c of classes) {
    const k = c.keys.join(',') || '(无槽位)';
    const ok = !l1.includes(c);
    console.log(`  ${(c.dir + '/' + c.file).padEnd(38)} ${c.cls.padEnd(22)} key=${k.padEnd(20)} ` +
      `exits=${c.exits.join('|')} ${ok ? '' : '✗ 无接线路径'}`);
  }
  process.exit(0);
}

let fail = 0;
if (l1.length) {
  fail = 1;
  console.error(`[lifecycle] ✗ L1 发现 ${l1.length} 个「定义了生命周期出口但无任何接线路径」的 App：`);
  for (const c of l1) {
    console.error(`    ${c.dir}/${c.file}  ${c.cls}  槽位=[${c.keys.join(',')}]  出口=[${c.exits.join('|')}]`);
  }
  console.error('  修法二选一：① 接入 ST_PHONE_REBIND_APP_KEYS（推荐，三路自动覆盖）；' +
    '② 在 index.js 显式调用该出口。');
}
if (l2.length) {
  fail = 1;
  console.error(`[lifecycle] ✗ L2 发现 ${l2.length} 个「只在换会话路径被回收」的槽位：`);
  for (const r of l2) {
    console.error(`    ${r.slot}  P1=${r.inP1} P2=${r.inP2} P3=${r.inP3}`);
  }
  console.error('  修法：给该 App 补 onChatChanged 并接入 REBIND 表（三路自动覆盖），' +
    '而不是往两条路径各补一次手抄调用。');
}
console.log(fail === 0
  ? '[lifecycle] ✓ 无未接线的生命周期出口 / 无语会话槽位覆盖缺口'
  : '[lifecycle] ✗ 门禁未通过');
process.exit(fail);