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
 *   R4（夹具）`RP_REGISTRY_FIXTURE=1` 只放宽 R3 的最低计数闸，**不放宽 R1/R2/R2b/R3b**。
 *
 * 准入清单的存活自证（v2.68.0，R2b / R3b）：
 *   本门禁有两张**准入清单**——REGEX_WIDE_ALLOWLIST（宽匹配登记）与 CSS_DELIVERY_EXEMPT
 *   （样式豁免）。二者此前都只做「准入校验」：新条目必须登记，否则红灯。但**没有任何东西
 *   检查登记的是否还活着**。条目所指的对象（那条宽匹配 / 那个 css 文件）一旦消失，
 *   条目就静默退化为「放行条」——为不存在的情形背书，而门禁永远不报警
 *   （R2 只看「有没有未登记的」，R3 只扫真实存在的 .css）。
 *   这与 v2.65.0 在 lifecycle 门立下的纪律同族（「白名单不得复活成放行条」，L3 的
 *   派生前提消失即 fail-closed）。v2.68.0 把该纪律从**文本**落成**机制**：
 *     · R2b —— 每条宽匹配白名单必须仍能在 CHAT_DATA_PATTERNS 里找到对应前缀；
 *     · R3b —— 每条样式豁免必须仍指向**存在的**文件，且其**豁免理由仍然成立**
 *       （文件若已被 phone.css 打包或已有 JS 引用，说明它本可进入正常判定，豁免应撤掉）。
 *   二者失败一律 exit 2（拒判），不是 exit 1：**这不是数据缺陷，是门禁自己的账目错了**。
 *
 * 证据面纯度（v2.68.0 修，实测踩到）：
 *   R3 的「机制 B（JS 自注入）」原用 `j.txt.includes(cf)` —— 正文里**提到过**文件名就算投递。
 *   两个后果同时发生：① `index.js` 里那句更新说明散文（"…apps/games/games.css 是转发壳…"）
 *   把**从未被任何 JS 引用**的文件伪装成「已投递」；② `scripts/` 下门禁自己的豁免清单字面量
 *   （`{ file: 'apps/games/games.css', … }`）被读成「有 JS 引用它」——**门禁自指伪证**。
 *   这与本仓 E6（v2.42.0）「注释/字符串里的提及不算消费」是同一族缺陷：证据面混入非证据。
 *   修法：判据收紧为**路径字面量**（文件名处在路径边界、后接 `?查询串` 或字面量结束），
 *   并把 `scripts/` 排除出引用面（那里的路径是**描述**，不是**引用**）。
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
/* ---------- R2b：宽匹配白名单的**条目存活自证**（v2.68.0）----------
 * 与 dead-export E10 同族：准入清单的合法性来自「它确实在放行某物」。
 *   若某条白名单在 CHAT_DATA_PATTERNS 里已找不到对应前缀（那条宽匹配被删/被改成固定前缀），
 *   它就从「准入闸」退化为「放行条」——静默留着、为不存在的情形背书，而 R2 永远不会报警
 *   （R2 只看「有没有未登记的」，不看「登记的是否还活着」）。
 * 夹具模式跳过（与 E9/E10 同款理由）：白名单是**内置**的、按真仓库的固定前缀写的，
 *   合成夹具天然不含这些前缀，不跳过会把每个夹具仓库都判死。存活自证的负控制因此改走
 *   「破坏门禁源码副本 + `--root` 指向真仓库」通道（只读真仓库，同 dead-export F 组）。 */
const deadWide = FIXTURE_MODE ? []
  : REGEX_WIDE_ALLOWLIST.filter((a) => !prefixes.some((p) => p.startsWith(a.prefix)));


/* ---------- R3：样式投递覆盖 ----------
 * 每个 App 的 `.css` 必须被**两种投递机制之一**覆盖，否则样式从不生效（界面裸奔，且不报错）：
 *   · 机制 A —— 被打包进全局 `phone.css`（类前缀族能在其中找到）；
 *   · 机制 B —— 由某 JS 文件按文件名引用（自注入 `<link>`，见 diary / honey / music / weibo）。
 * 口径说明（为什么用「两种机制之一」而不是「必须进 phone.css」）：
 *   实测本仓**并存两种投递机制**，且都是有意为之。若只认 phone.css，会把四个自注入 App
 *   判成缺口（假阳性）。判据必须覆盖真实存在的全部合法机制。
 * 豁免清单：仅收「有意识的转发壳 / 兼容壳」，逐条写明理由。 */
const CSS_DELIVERY_EXEMPT = [
  { file: 'apps/games/games.css', why: '转发壳：正文已拆到 poker/poker.css，本文件只留 @import 防旧缓存路径 404（见文件头注释）。它无需被引用即已生效。' }
];
const cssNotes = [];
{
  // 收集全仓 JS（排除 tests）用于「机制 B」判定
  const jsTexts = [];
  const walkJs = (dir, base = '') => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walkJs(abs, rel);
      else if (/\.(js|mjs)$/.test(e.name)) {
        /* 排除门禁自身（scripts/ 下的审计脚本）。理由（v2.68.0 实测踩到）：豁免/白名单清单里
         *   的路径字面量（如 `'apps/games/games.css'`）会被本判据读成「有 JS 引用了它」，
         *   于是**门禁自己的账本冒充了投递证据**——自指伪证。这类字面量是「描述」不是「引用」。 */
        if (/^scripts\//.test(rel)) continue;
        try { jsTexts.push({ rel, txt: fs.readFileSync(abs, 'utf8') }); } catch { /* 忽略 */ }
      }
    }
  };
  walkJs(root);
  /* 机制 B 的「引用」必须收紧为**路径字面量**，而不是「正文里提到过这个文件名」。
   *   为什么（v2.68.0 实测踩到）：首版用 `j.txt.includes(cf)`，于是任何一处提到文件名的
   *   散文串都算投递证据——`index.js` 里那句更新说明（"…apps/games/games.css 是转发壳…"）
   *   就把一个**根本没有被任何 JS 引用**的文件伪装成「已投递」。这与本仓 E6（v2.42.0）
   *   「注释/字符串里的提及不算消费」是同一族缺陷：**证据面混入了非证据**。
   *   修法：先把每个 JS 里的字符串/模板字面量抽出来，只认「内容本身就是一条 css 路径」的
   *   那些（文件名处在路径边界上，且后面紧跟 `?查询串` 或字面量结束），散文串因此不再命中。 */
  const cssLiteralRe = (base) => new RegExp('(^|/)' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?|$)');
  const jsRefIndex = jsTexts.map((j) => {
    const lits = [];
    for (const m of j.txt.matchAll(/['"`]([^'"`\n]*)['"`]/g)) lits.push(m[1]);
    return { rel: j.rel, lits };
  });
  const jsRefsCss = (base, excludedRel) => jsRefIndex.some((j) =>
    j.rel !== excludedRel && j.lits.some((s) => cssLiteralRe(base).test(s)));
  /* ---------- R3c：样式文件内部的**本地引用**必须指向真实存在的目标（v2.68.0）----------
   * 为什么必须有这一条：R3 只判「这个 .css 有没有被投递」，不判「它投递的内容是不是活的」。
   *   豁免文件尤其危险——它被 R3 直接 `continue` 掉，内容是**判定盲区**。
   *   实测形态：`apps/games/games.css`（豁免项）的全部内容就是一句
   *   `@import url('./poker/poker.css?v=1.0.2')`。若将来 poker 目录被改名/删除，
   *   这个壳会**静默指向虚空**（浏览器只会 404 掉那个 @import，界面裸奔、控制台之外没人知道），
   *   而 R3 因为豁免根本不会看它一眼 —— 属本仓最贵的「不报错、不崩溃、只错结果」形态。
   *   判据：每个 .css 里的本地 url() / @import 引用（去掉 ?query 与 #fragment）必须真实存在。
   *   外链（http(s):、//）、内联（data:）、锚点（#xxx）跳过——它们不是本地文件引用。 */
  var cssRefsLocal = [];   // var：判定段在本块之外，需模块作用域可见
  const checkCssRefs = (rel, abs) => {
    let src = '';
    try { src = fs.readFileSync(abs, 'utf8'); } catch { return; }
    const dirOf = path.dirname(abs);
    /* 收集本地引用。注意 `@import url('x.css')` 会被 url() 与 @import 两条正则各匹配一次，
     *   故用 Set 去重（判据关心的是「哪些目标不存在」，同一目标重复出现报两次无意义——
     *   实测踩到：poker.css 被改名时报了 2 条同样的问题）。 */
    const found = new Set();
    for (const m of src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) found.add(m[1]);
    for (const m of src.matchAll(/@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])/g)) {
      found.add(m[1] || m[2]);
    }
    for (const r of found) {
      if (/^(data:|https?:|\/\/|#)/.test(r)) continue;          // 外链 / 内联 / 锚点
      const clean = r.split('?')[0].split('#')[0];
      if (!clean) continue;
      // 只判「看起来是本地文件路径」的引用：跳过纯 CSS 片段（如 %23m 这类 URL 编码产物）
      if (!/\.(css|png|jpe?g|gif|webp|svg|woff2?|ttf|otf|mp3|ogg|wav|json)$/i.test(clean)) continue;
      if (!fs.existsSync(path.resolve(dirOf, clean))) {
        cssRefsLocal.push({ from: rel, ref: r });
      }
    }
  };
  const appsRoot = path.join(root, 'apps');
  if (!fs.existsSync(appsRoot)) {
    console.error('[registry] apps/ 目录不存在 —— fail-closed 拒判');
    process.exit(2);
  }
  let cssTotal = 0;
  for (const d of fs.readdirSync(appsRoot)) {
    const dirAbs = path.join(appsRoot, d);
    let isDir = false;
    try { isDir = fs.statSync(dirAbs).isDirectory(); } catch { /* 忽略 */ }
    if (!isDir) continue;
    for (const cf of fs.readdirSync(dirAbs).filter((f) => f.endsWith('.css'))) {
      cssTotal += 1;
      const rel = `apps/${d}/${cf}`;
      // R3c 对**所有**样式文件生效，豁免项也不例外（豁免的是「投递方式」，不是「内容健康度」）
      checkCssRefs(rel, path.join(dirAbs, cf));
      if (CSS_DELIVERY_EXEMPT.some((e) => e.file === rel)) { cssNotes.push({ rel, mode: 'exempt' }); continue; }
      let src = '';
      try { src = fs.readFileSync(path.join(dirAbs, cf), 'utf8'); } catch { continue; }
      // 机制 A：类前缀族是否能在 phone.css 里找到
      const counts = new Map();
      for (const m of src.matchAll(/\.([a-z][a-z0-9]{1,6})-[a-z0-9-]+/g)) {
        counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      }
      const fams = [...counts.entries()].filter(([, n]) => n >= 5).map(([k]) => k);
      const phoneCss = read('phone.css') || '';
      const viaBundle = fams.length > 0 && fams.every((k) => new RegExp('\\.' + k + '-').test(phoneCss));
      // 机制 B：有 JS 把该文件名当作**路径字面量**引用（收紧判据，见上方 jsRefsCss 说明）
      const viaLink = jsRefsCss(cf, rel);
      const mode = viaBundle ? 'bundle' : (viaLink ? 'link' : 'missing');
      cssNotes.push({ rel, mode, fams: fams.length });
    }
  }
  if (!FIXTURE_MODE && cssTotal < 15) {
    console.error(`[registry] 只枚举到 ${cssTotal} 个 App 样式文件（低于下限 15）—— fail-closed 拒判`);
    process.exit(2);
  }
  // 全局样式表也在 R3c 射程内（它是最可能积累旧路径的一份文件）
  if (fs.existsSync(path.join(root, 'phone.css'))) {
    checkCssRefs('phone.css', path.join(root, 'phone.css'));
  }
  var cssMissing = cssNotes.filter((c) => c.mode === 'missing');
  /* R3b：豁免清单条目存活自证（v2.68.0）。
   *   与 E10 / R2b 同族。CSS_DELIVERY_EXEMPT 是按**文件路径**登记的：判据就是「该文件还在不在」。
   *   文件已被删除/改名，而豁免条目留着 ⇒ 它在为一个不存在的文件背书，且 R3 永远不报警
   *   （R3 只扫真实存在的 .css，删掉的文件根本不会进入枚举面）。
   *   夹具模式跳过（理由同 R2b）：豁免清单是内置的、按真仓库固定路径写的，合成夹具不带它。 */
  var deadCssExempt = FIXTURE_MODE ? []
    : CSS_DELIVERY_EXEMPT.filter((e) => !fs.existsSync(path.join(root, e.file)));
  /* 反向：豁免的应当是「真存在但两种机制都不适用」的文件。若某豁免文件其实已被 phone.css 打包
   *   （或已被 JS 引用），说明豁免理由已失效，该条目应当撤掉——否则它掩盖了一个本可被判定的文件。 */
  var obsoleteCssExempt = [];
  if (!FIXTURE_MODE) {
    for (const e of CSS_DELIVERY_EXEMPT) {
      const abs = path.join(root, e.file);
      if (!fs.existsSync(abs)) continue;
      const src = (() => { try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; } })();
      const counts = new Map();
      for (const m of src.matchAll(/\.([a-z][a-z0-9]{1,6})-[a-z0-9-]+/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      const fams = [...counts.entries()].filter(([, n]) => n >= 5).map(([k]) => k);
      const phoneCss2 = read('phone.css') || '';
      const bundled = fams.length > 0 && fams.every((k) => new RegExp('\\.' + k + '-').test(phoneCss2));
      const base = e.file.split('/').pop();
      const linked = jsRefsCss(base, e.file);
      if (bundled || linked) obsoleteCssExempt.push(`${e.file}（${bundled ? '已进 phone.css' : '已有 JS 引用'}）`);
    }
  }
  var cssStats = {
    total: cssTotal,
    bundle: cssNotes.filter((c) => c.mode === 'bundle').length,
    link: cssNotes.filter((c) => c.mode === 'link').length,
    exempt: cssNotes.filter((c) => c.mode === 'exempt').length
  };
}

/* ---------- 输出 ---------- */
const bucketPrefixes = prefixes.filter((p) => !WIDE_META.test(p));
console.log(`[registry] APPS id ${appIds.length} · 懒加载分支 ${branchIds.length} · 会话键前缀 ${prefixes.length}` +
  `（其中宽匹配 ${prefixes.filter((p) => WIDE_META.test(p)).length} 条，已登记 ${REGEX_WIDE_ALLOWLIST.length} 类）`);
console.log(`[registry] 样式投递 ${cssStats.total} 个 · phone.css 打包 ${cssStats.bundle} · JS 自注入 ${cssStats.link} · 豁免 ${cssStats.exempt} · 未覆盖 ${cssMissing.length}` +
  ` · 样式内本地引用失效 ${cssRefsLocal.length}`);

if (listMode) {
  console.log('\n── R3 样式投递（未覆盖才是缺口） ──');
  for (const c of cssNotes) console.log(`  ${c.rel}  ${c.mode}`);
  console.log('\n── R3c 样式内本地引用（失效才是缺口） ──');
  console.log(cssRefsLocal.length
    ? cssRefsLocal.map((c) => `  ✗ ${c.from} -> ${c.ref}`).join('\n')
    : '  （全部指向真实存在的目标）');
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
if (cssMissing.length) {
  fail = 1;
  console.error(`[registry] ✗ R3 有 ${cssMissing.length} 个 App 样式文件从未被投递` +
    '（既不进 phone.css 也无 JS 引用 ⇒ 界面裸奔且不报错）：');
  for (const c of cssMissing) console.error(`    ${c.rel}`);
  console.error('  修法二选一：① 把类前缀族合并进 phone.css；② 在 App 内自注入 <link>（见 diary/weibo）。' +
    '确属兼容转发壳请登记进 CSS_DELIVERY_EXEMPT。');
}
/* R3c：样式内部的本地引用必须指向真实存在的目标（v2.68.0）。
 *   这是本仓最贵形态（不报错、不崩溃、只错结果）在样式面的入口：转发壳/子样式里写错一个
 *   路径，浏览器只会静默 404，界面裸奔而控制台之外无人察觉。豁免项同样在射程内。 */
if (cssRefsLocal.length) {
  fail = 1;
  console.error(`[registry] ✗ R3c 有 ${cssRefsLocal.length} 条样式内的本地引用指向不存在的目标` +
    '（浏览器只会静默 404，界面裸奔且不报错）：');
  for (const c of cssRefsLocal) console.error(`    ${c.from}  ->  ${c.ref}`);
  console.error('  修法：修正该 url()/@import 路径，或补回被引用的资源文件。' +
    '注意豁免项（CSS_DELIVERY_EXEMPT）也在射程内——豁免的是投递方式，不是内容健康度。');
}
/* R2b / R3b：两张准入清单的**存活自证**（v2.68.0）。
 *   这两项不是数据缺陷（fail=1），而是**门禁账目错了**（exit 2 拒判）——与 lifecycle L3
 *   「白名单不得复活成放行条」同一立场：一张指向不存在对象的清单，会让门禁在无人察觉的情况下
 *   放行越来愈多的东西。方向性说明：这里只会增加红灯，不会放行任何原本判死的东西。 */
let corrupt = 0;
if (deadWide.length) {
  corrupt = 1;
  console.error(`[registry] ✗ R2b 宽匹配白名单有 ${deadWide.length} 条已失效（CHAT_DATA_PATTERNS 里` +
    '已找不到对应前缀，它不再放行任何东西 ⇒ 幽灵放行条）—— fail-closed 拒判：');
  for (const a of deadWide) console.error(`    ${a.prefix}`);
  console.error('  修法：该宽匹配确已删除/改写成固定前缀 ⇒ 同步删掉这条白名单；否则修正登记内容。');
}
if (deadCssExempt.length) {
  corrupt = 1;
  console.error(`[registry] ✗ R3b 样式豁免清单有 ${deadCssExempt.length} 条指向不存在的文件 —— fail-closed 拒判：`);
  for (const e of deadCssExempt) console.error(`    ${e.file}`);
  console.error('  修法：被豁免的文件已删除/改名 ⇒ 同步删掉豁免条目（否则它在为不存在的文件背书）。');
}
if (obsoleteCssExempt.length) {
  corrupt = 1;
  console.error(`[registry] ✗ R3b 样式豁免清单有 ${obsoleteCssExempt.length} 条理由已失效` +
    '（该文件其实已被投递，本可进入正常判定）—— fail-closed 拒判：');
  for (const s of obsoleteCssExempt) console.error(`    ${s}`);
  console.error('  修法：撤掉该豁免条目，让这个文件回到 R3 的正常判定里。');
}
if (corrupt) process.exit(2);
console.log(fail === 0
  ? '[registry] ✓ 注册三方对账无孤儿 / 宽匹配前缀均已登记 / 样式投递无未覆盖 / 两张准入清单存活'
  : '[registry] ✗ 门禁未通过');
process.exit(fail);