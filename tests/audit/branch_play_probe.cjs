#!/usr/bin/env node
/* ============================================================
 * tests/audit/branch_play_probe.cjs
 * 探针：F-1「分支与玩法（持久检查点 / 回滚预览 / 分支只读对照）」可行性取证 —— 只量，不拆。
 * ------------------------------------------------------------
 * 【要回答的问题】（F-1 三件各自的「要接的面」到底存不存在、拿不拿得到）
 *   ① 持久检查点：上游的「分支 / 回滚」状态能不能跨实例 / 跨会话留存？
 *   ② 回滚预览：**分支 / 回滚域**里的面给不给「先算后改」的预演？
 *   ③ 分支只读对照：上游的分支 / 回放面在运行时**可达吗**？（能不能读、读到什么）
 *   ④ 下游现在有什么（增量基础 + 是不是「接自己」）
 *
 * 【口径纪律】（与 lifecycle_declarative_probe / schedule_conflict_probe 同款）
 *   · 只读：不写任何文件、不写宿主；
 *   · 可复算：同一份树跑两次读数逐字节相同（套件 A3）；
 *   · **位置无关**：不得把兄弟仓绝对路径写死在断言里（上游 v3.204.0 的跨仓纪律：
 *     路径依赖的绿只在一台机器上成立）。上游复核走 `--upstream <dir>` 或环境变量
 *     `RP_UPSTREAM_ROOT`，**不传就不复核**（冻结证据以基线为准，且未复核 ⇏ 通过）；
 *   · 读不到就 fail-closed（exit 2）。
 *
 * 【★ 本探针的三条形态纪律（v1→v3 三次口径事故的修法，全部固化在代码里）】
 *   ① **迭代搜索**：上游模块名单由**目录枚举**得出，判据在全模块上搜。
 *      v1 把上游面写死成两个文件（branch-guard / ledger-replay），于是漏掉
 *      `restoreFromPayload` 的 dryRun 预检面与 chatMetadata 嵌入快照面 ⇒ 三条判据假阴性。
 *   ② **域限定**：搜「预检」时必须限定在**分支/回滚域**（域由文件名模式派生）。
 *      对全模块裸搜会把注入链路的诊断 dry-run 读成「回滚预览」——那是另一个域的东西。
 *   ③ **可达性实测（而非猜）**：上游外供方式有三条（bridge 快照 / 模块全局 / 都不给）。
 *      探针不猜「只有快照才算外供」，而是把模块源码在隔离沙箱里**真加载、真调用**，
 *      量出「能不能读到、读到什么、状态跨不跨实例」。v2 把「外供」等同于「进快照」，
 *      得出 R3=0 的结论 —— 那是**口径错**，不是事实（下游本来就在直读模块全局）。
 *   ④ **块注释也算注释**（v3.64.0 复校，与 `schedule_conflict_probe.cjs` 的 v3.22.0 同款）：
 *     本探针此前只跳过 `//` 行，**块注释散文照进读数** —— 而块注释恰恰是「写规格」的地方，
 *     于是「本模块绝不碰 X」这类声明会被算成「X 已实施」。实测四族都吃过这一口：
 *       checkpoint 1->0（唯一命中在 config/checkpoint-content-contract.js 文件头，
 *         那几行写的是「绝不碰 saveCheckpoint / dropCheckpoint 这类写面」）；
 *       preview 43->34；branchFace 2->0（两处全在 config/branch-contrast.js 文件头）；
 *       globalRead 8->4（config/world-bridge.js 那处注释写着「不摸 window.LonShaEvidenceWorkbench」）。
 *     回滚覆盖面 41 点 / 4 文件 / 12 入口定义**一格未动**（同一口径下实测） ⇒ D3 负控制不受影响。
 *     剥离实现保留换行（行号仍指向真实文件），与姊妹探针逐字同款。
 *   另守两条 token 纪律：不认裸词（下游 `preview` 是图片预览、`checkpoint` 是 SD 模型名、
 *   中文「检查点」撞 step-pipeline 的「取消检查点」）；查快照只查 buildBridgeSnapshot()
 *   函数体（配平抽取），不查整文件（整文件必然命中内部取库口 `_branchGuardLib()`）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const NL = String.fromCharCode(10);
const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const UPSTREAM = argVal('--upstream') || process.env.RP_UPSTREAM_ROOT || null;
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const idxPath = path.join(ROOT, 'index.js');
const appsDir = path.join(ROOT, 'apps');
if (!fs.existsSync(idxPath) || !fs.existsSync(appsDir)) {
  console.error('[branch] 读不到 index.js 或 apps/ —— fail-closed 拒判');
  process.exit(2);
}
const IDX = fs.readFileSync(idxPath, 'utf8');
if (!IDX.length) { console.error('[branch] index.js 为空 —— fail-closed 拒判'); process.exit(2); }

function walk(absDir, out) {
  let names = [];
  try { names = fs.readdirSync(absDir); } catch (_e) { return out; }
  for (const n of names) {
    const abs = path.join(absDir, n);
    let st = null;
    try { st = fs.statSync(abs); } catch (_e) { continue; }
    if (st.isDirectory()) walk(abs, out);
    else if (n.slice(-3) === '.js') out.push(abs);
  }
  return out;
}
const files = walk(appsDir, []).concat(walk(path.join(ROOT, 'config'), []));
if (files.length < 40) {
  console.error('[branch] 枚举面只扫到 ' + files.length + ' 个文件（低于下限 40）—— fail-closed 拒判');
  process.exit(2);
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
/* ★ 性能纪律：只切一次（f4 探针首版写在 for 条件与体内 ⇒ O(n²)、单次 24 秒） */
/* ★ 判据面纪律（本轮新增）：查「下游有没有实现某个面」只能看**产品代码**，不能看面向用户的
 *   本版公告。F-1 这类取证版的公告会**描述**该面（「持久检查点 / 回滚预览 / 分支只读对照」），
 *   若不剥离，公告一写、下游三读数就变非 0 ⇒ 判据被散文侵入（同族：判据必须匹配真实书写）。
 *   剥离方式：把 ST_PHONE_CURRENT_UPDATE 整块的行内容清空，**保留行数** ⇒ 行号仍指向真实文件。 */
function stripAnnouncements(src) {
  const at = src.indexOf('const ST_PHONE_CURRENT_UPDATE');
  if (at < 0) return src;
  const end = src.indexOf('};', at);
  if (end < 0) return src;
  const mid = src.slice(at, end + 2).split(NL).map((l) => (l.trim() ? '' : l)).join(NL);
  return src.slice(0, at) + mid + src.slice(end + 2);
}
/* ★ 块注释也算注释（v3.64.0 复校）。与 `schedule_conflict_probe.cjs` 的 `stripBlockComments`
 *   逐字同款（v3.22.0 立）：匹配前先把块注释整段抹白、**保留换行** ⇒ 行号不变。
 *   为什么必须做：本探针全部 token 族都是**子串匹配**，而块注释是写规格的地方 ——
 *   「本模块绝不碰 X」会被算成「X 已实施」（实测四族都吃过这一口，见头部 ④）。 */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}
const readCode = (abs) => stripBlockComments(fs.readFileSync(abs, 'utf8'));
const IDX_CODE = stripBlockComments(stripAnnouncements(IDX));
const idxLines = IDX_CODE.split(NL);

/* ══════════ 一、下游读数 ══════════ */
/* ① 回滚族覆盖面（增量基础） */
const ROLLBACK_TOKENS = [
  'rollbackPhoneSmsToFloor', 'rollbackToFloor', 'rollbackSmsToFloor',
  'rollbackWangxiangTaskProgress', 'rollbackTaskProgressAtFloor', 'rollbackTaskProgressToFloor',
  'rollbackWechatAssignmentsToFloor', 'rollbackWechatAssignmentsAtFloor',
  '_rollbackTaskProgressHistory', '_rollbackWalletTransactions'
];
const defRe = new RegExp('^[ \\t]*(?:async[ \\t]+)?(?:function[ \\t]+)?[A-Za-z_$][A-Za-z0-9_$]*[ \\t]*\\([^)]*\\)[ \\t]*\\{');
const rollbackPoints = [];
const rollbackEntryDefs = [];
function scanRollback(src, file) {
  const lines = src.split(NL);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.slice(0, 2) === '//') continue;
    for (const tok of ROLLBACK_TOKENS) {
      if (lines[i].indexOf(tok) >= 0) { rollbackPoints.push({ file: file, line: i + 1, token: tok }); break; }
    }
  }
}
scanRollback(IDX_CODE, 'index.js');
for (const f of files) scanRollback(readCode(f), rel(f));
for (const f of files) {
  const lines = readCode(f).split(NL);
  for (let i = 0; i < lines.length; i++) {
    if (!defRe.test(lines[i])) continue;
    for (const tok of ROLLBACK_TOKENS) {
      if (lines[i].indexOf(tok) >= 0) { rollbackEntryDefs.push({ file: rel(f), line: i + 1, token: tok }); break; }
    }
  }
}
for (let i = 0; i < idxLines.length; i++) {
  if (!defRe.test(idxLines[i])) continue;
  for (const tok of ROLLBACK_TOKENS) {
    if (idxLines[i].indexOf(tok) >= 0) { rollbackEntryDefs.push({ file: 'index.js', line: i + 1, token: tok }); break; }
  }
}
const rollbackFiles = [...new Set(rollbackPoints.map((p) => p.file))].sort();

/* ② F-1 三件在**下游**的现状（规格化复合 token，不认裸词） */
const downLines = [['index.js', idxLines]];
for (const f of files) downLines.push([rel(f), readCode(f).split(NL)]);
function countTokens(tokens) {
  const hits = [];
  for (const [file, lines] of downLines) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || t.slice(0, 2) === '//') continue;
      for (const tok of tokens) if (lines[i].indexOf(tok) >= 0) { hits.push({ file: file, line: i + 1, token: tok }); break; }
    }
  }
  return hits;
}
const CHECKPOINT_TOKENS = ['phoneCheckpoint', 'branchCheckpoint', 'saveCheckpoint', 'restoreCheckpoint',
  'PHONE_CHECKPOINT', 'BRANCH_CHECKPOINT', '存档点'];
/* 只把**回滚域的**干跑算数：裸 dryRun 命中的是宿主生成参数与注入链路注释，不是回滚预览 */
const PREVIEW_TOKENS = ['previewRollback', 'rollbackPreview', 'dryRunRollback', 'RollbackPreview', '回滚预览'];
const BRANCHFACE_TOKENS = ['branchFace', '分支对照', '分支只读', 'branchCompare', 'branchGuardFace',
  'LonShaBranchGuard'];
const checkpointHits = countTokens(CHECKPOINT_TOKENS);
const previewHits = countTokens(PREVIEW_TOKENS);
const branchFaceHits = countTokens(BRANCHFACE_TOKENS);
const globalReadSites = countTokens(['window.LonShaFloorLedger', 'window.LonShaMemory', 'window.LonShaEvidenceWorkbench']);

/* ③ 存储分域自证 */
const storageSrc = (() => { try { return fs.readFileSync(path.join(ROOT, 'config', 'storage.js'), 'utf8'); } catch (_e) { return ''; } })();
let chatDataPatterns = 0;
if (storageSrc) {
  const at = storageSrc.indexOf('CHAT_DATA_PATTERNS = [');
  if (at >= 0) {
    const close = storageSrc.indexOf('];', at);
    const body = close > at ? storageSrc.slice(at, close) : '';
    for (const l of body.split(NL)) if (/^[ \t]*\/\^?/.test(l)) chatDataPatterns += 1;
  }
}
const nsStoreHits = storageSrc ? (storageSrc.split('_ensureNamespaceStore').length - 1) : 0;

/* ══════════ 二、上游复核（位置无关 + 迭代搜索 + 可达性实测） ══════════ */
const UP = { checked: false, root: UPSTREAM, note: null,
  modules_scanned: 0, has_index: false, isRepo: false,
  persist_files: null, persist_top: null,
  branch_domain_modules: null, branch_domain_preview_hits: null, branch_domain_preview_files: null,
  checkpoint_named_persistent: null, checkpoint_named: null,
  snapshot_branch_faces: null, snapshot_body_found: false,
  reach: null };

const countAll = (src, toks) => { let n = 0; for (const t of toks) { let i = 0; while ((i = src.indexOf(t, i)) >= 0) { n += 1; i += t.length; } } return n; };

/* ★ 可达性实测沙箱：把上游模块源码在**隔离 global** 上真加载、真调用。
 *   上游模块是 IIFE + 双导出（`module.exports` 与 `globalThis.LonShaXxx`）。
 *   沙箱把 `module` 传 undefined（跳过 CJS 分支）、`window` 传 undefined
 *   （源码写的是 `typeof window !== 'undefined' ? window : globalThis`，于是挂到我们的沙箱 globalThis）。
 *   不抛：任何加载/调用失败都降级成一条读数（本探针只量，不判产品对错）。 */
function loadUpModule(file) {
  const sandbox = {};
  try {
    const src = fs.readFileSync(file, 'utf8');
    const fn = new Function('globalThis', 'window', 'module', 'exports', 'require', src);
    fn(sandbox, undefined, undefined, undefined, undefined);
    return { ok: true, sandbox: sandbox };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}

if (UPSTREAM && fs.existsSync(UPSTREAM)) {
  UP.checked = true;
  UP.has_index = fs.existsSync(path.join(UPSTREAM, 'index.js'));
  UP.isRepo = fs.existsSync(path.join(UPSTREAM, '.git'));
  /* ★ 迭代搜索：模块名单由目录枚举得出（不写死任何文件名） */
  const upMods = [];
  for (const n of fs.readdirSync(UPSTREAM)) {
    if (n.slice(-3) !== '.js') continue;
    const p = path.join(UPSTREAM, n);
    try { if (fs.statSync(p).isFile()) upMods.push(n); } catch (_e) { /* 忽略 */ }
  }
  UP.modules_scanned = upMods.length;
  if (upMods.length < 10) {
    console.error('[branch] 上游只扫到 ' + upMods.length + ' 个模块（低于下限 10）—— fail-closed 拒判');
    process.exit(2);
  }
  const UP_SRC = {};
  for (const n of upMods) { try { UP_SRC[n] = fs.readFileSync(path.join(UPSTREAM, n), 'utf8'); } catch (_e) { UP_SRC[n] = ''; } }
  UP.moduleList = upMods;

  /* 持久化机制在场（跨会话 / 跨设备留存的真写法） */
  const PERSIST = ['localStorage', 'sessionStorage', 'msg.extra', 'chatMetadata', 'extensionSettings', 'indexedDB'];
  const persistBy = [];
  for (const n of upMods) { const c = countAll(UP_SRC[n] || '', PERSIST); if (c > 0) persistBy.push({ file: n, hits: c }); }
  UP.persist_files = persistBy.length;
  UP.persist_top = persistBy.sort((a, b) => b.hits - a.hits).slice(0, 6);

  /* ★ 域限定：分支 / 回滚域由**文件名模式**派生（不是硬编码具体文件） */
  const DOMAIN_RE = /(branch|ledger|replay|guard|snapshot|checkpoint|restore|changeset|version|closure|shift)/i;
  const domain = upMods.filter((n) => DOMAIN_RE.test(n));
  UP.branch_domain_modules = domain.length;
  if (domain.length < 5) {
    console.error('[branch] 分支/回滚域只派生出 ' + domain.length + ' 个模块（低于下限 5）—— fail-closed 拒判');
    process.exit(2);
  }
  const PREVIEW = ['dryRun', 'dry-run', '预检', '干跑', '预演'];
  let dph = 0;
  const dpf = [];
  for (const n of domain) { const c = countAll(UP_SRC[n] || '', PREVIEW); if (c > 0) { dph += c; dpf.push({ file: n, hits: c }); } }
  UP.branch_domain_preview_hits = dph;
  UP.branch_domain_preview_files = dpf;

  /* ★ 「检查点」面：以英文 checkpoint / 存档点 命名（**不认中文「检查点」** —— 会撞
   *   step-pipeline 的「取消检查点」，那是取消信号轮询点，与存档无关），
   *   且**同文件必须带持久化机制**，否则只是名字。 */
  const CP_TOKENS = ['checkpoint', 'Checkpoint', '存档点'];
  const cpPersist = [];
  const cpNamed = [];
  for (const n of upMods) {
    const src = UP_SRC[n] || '';
    if (countAll(src, CP_TOKENS) > 0) {
      cpNamed.push(n);
      if (countAll(src, PERSIST) > 0) cpPersist.push(n);
    }
  }
  UP.checkpoint_named = cpNamed;
  UP.checkpoint_named_persistent = cpPersist;
  /* ★ 诚实口径（防「上游什么都不持久」的过度结论）：域内**确实有**持久化模块。
   *   量出来，并说明它们持久化的是什么 —— 每楼一份的附注（账随楼走），
   *   不是「用户主动打的一个检查点」。若不记这条，R1 的 0 会被误读成「上游没有持久面」。 */
  const dpersist = [];
  for (const n of domain) { if (countAll(UP_SRC[n] || '', PERSIST) > 0) dpersist.push(n); }
  UP.branch_domain_persist_files = dpersist.length;
  UP.branch_domain_persist_list = dpersist;

  /* ★ 范围粒度纪律：查快照只查 buildBridgeSnapshot() 函数体（配平抽取），不查整文件 */
  if (UP.has_index) {
    const u = UP_SRC['index.js'] || '';
    const at = u.indexOf('buildBridgeSnapshot(');
    let body = '';
    if (at >= 0) {
      const open = u.indexOf('{', at);
      let depth = 0;
      for (let j = open; j < u.length; j++) {
        if (u[j] === '{') depth += 1;
        else if (u[j] === '}') { depth -= 1; if (depth === 0) { body = u.slice(at, j + 1); break; } }
      }
    }
    UP.snapshot_body_found = body.length > 0;
    const FACES = ['LonShaBranchGuard', 'LonShaLedgerReplay', 'branchGuard', 'ledgerReplay', 'branchFace', 'checkpoint'];
    UP.snapshot_branch_faces = body ? FACES.filter((f) => body.indexOf(f) >= 0) : null;
  }

  /* ★ 可达性实测：真加载 + 真调用（三条外供通道里，模块全局这一条能不能用） */
  const bgPath = path.join(UPSTREAM, 'branch-guard.js');
  const lrPath = path.join(UPSTREAM, 'ledger-replay.js');
  const reach = { branch_guard: null, ledger_replay: null };
  if (fs.existsSync(bgPath)) {
    const L = loadUpModule(bgPath);
    const r = { loadable: L.ok, error: L.ok ? null : L.error, api_keys: null, line_reachable: false,
      state_crosses_instances: null, guard_records_no_content: null };
    if (L.ok) {
      const api = L.sandbox.LonShaBranchGuard;
      r.api_keys = api ? Object.keys(api).length : 0;
      try {
        const g1 = api.createGuard();
        const g2 = api.createGuard();
        r.line_reachable = (typeof g1.line() === 'string');
        /* 持久性实测：实例 A 记一条，实例 B 能不能看见（跨实例可见 ⇔ 状态不在实例内存里） */
        g1.markSwipeMode(7, 's1');
        const bSees = (typeof g2.isSwipeMode === 'function') ? g2.isSwipeMode(7, 's1') : null;
        r.state_crosses_instances = (bSees === null) ? null : !!bSees;
        /* ★ 关键口径：这些队列记的是**楼层号 + 过期时刻**，不记「回滚会丢掉什么内容」。
         *   量它：把同一楼标成三种态，看 stats 里有没有任何字段携带内容 / 条数。 */
        g1.markRequestRollback(8, 's1');
        g1.markApplyRollback(9, 's1');
        const st = g1.stats();
        r.guard_records_no_content = (st && typeof st === 'object') &&
          !Object.keys(st).some((k) => /content|items|records|messages|preview/i.test(k));
        r.stats_keys = Object.keys(st || {});
      } catch (e) { r.error = String((e && e.message) || e).slice(0, 120); }
    }
    reach.branch_guard = r;
  }
  if (fs.existsSync(lrPath)) {
    const L = loadUpModule(lrPath);
    const r = { loadable: L.ok, error: L.ok ? null : L.error, api_keys: null, floor_owners: null,
      preview_before_change: false, coverage_reachable: null };
    if (L.ok) {
      const api = L.sandbox.LonShaLedgerReplay;
      r.api_keys = api ? Object.keys(api).length : 0;
      r.floor_owners = api && Array.isArray(api.FLOOR_OWNERS) ? api.FLOOR_OWNERS.length : 0;
      /* 回放面给不给「先算后改」：replayDrop 的签名只有 (host, floor, registry)，
       *   没有 opts / dry —— 量它的**形参个数**（真读数，不猜）。 */
      try {
        r.preview_before_change = /function replayDrop\s*\(\s*host\s*,\s*floor\s*,\s*registry\s*\)/.test(UP_SRC['ledger-replay.js'] || '');
        const cov = api.coverage({}, undefined);
        r.coverage_reachable = cov && Number.isFinite(cov.total) ? cov.total : null;
      } catch (e) { r.error = String((e && e.message) || e).slice(0, 120); }
    }
    reach.ledger_replay = r;
  }
  UP.reach = reach;
  /* 外供通道读数：快照面 0 个字段 + 模块全局可达 ⇒ 通道是「模块全局」，不是「快照」 */
  UP.bridge_channel_used = (UP.snapshot_branch_faces && UP.snapshot_branch_faces.length === 0);
  UP.global_channel_reachable = !!(reach.branch_guard && reach.branch_guard.loadable) ||
    !!(reach.ledger_replay && reach.ledger_replay.loadable);
} else if (UPSTREAM) {
  /* ★ 指定了上游根却读不到 ⇒ fail-closed。若在此静默降级成「未复核」，
   *   读的人会以为复核过（把「路径写错」伪装成「没给路径」）。 */
  console.error('[branch] 指定了上游根但读不到：' + UPSTREAM + ' —— fail-closed 拒判');
  process.exit(2);
} else {
  UP.note = '未指定上游根（--upstream / RP_UPSTREAM_ROOT），跳过复核；冻结证据以基线为准';
}

/* ══════════ 三、判据 + 判定 ══════════ */
const bg = UP.checked ? UP.reach.branch_guard : null;
const lr = UP.checked ? UP.reach.ledger_replay : null;
const cpPer = UP.checked ? UP.checkpoint_named_persistent : [];
const dph = UP.checked ? UP.branch_domain_preview_hits : 0;
const snapFaces = UP.checked && UP.snapshot_branch_faces ? UP.snapshot_branch_faces.length : 0;
const globalOk = UP.checked ? !!UP.global_channel_reachable : false;

const crit = [
  { id: 'R1', desc: '上游存在**以「检查点 / 存档点」为名且持久化**的面（F-1 第一件的对象）',
    pass: UP.checked ? (cpPer.length > 0) : false, got: String(cpPer.length),
    gotText: UP.checked
      ? (cpPer.length > 0 ? ('命中：' + cpPer.join('、'))
        : ('枚举 ' + UP.modules_scanned + ' 个模块：以 checkpoint/存档点 为名的有 [' +
          (UP.checkpoint_named.join('、') || '无') + ']，**其中带持久化机制的是 0 个**'))
      : '未复核（冻结证据：0）' },
  { id: 'R2', desc: '**分支 / 回滚域**里存在「预检 / 干跑」面（F-1 第二件的对象）',
    pass: UP.checked ? (dph > 0) : false, got: String(dph),
    gotText: UP.checked
      ? (dph > 0 ? (dph + ' 处（' + (UP.branch_domain_preview_files || []).map((x) => x.file + '×' + x.hits).join('、') + '）')
        : ('域内 ' + UP.branch_domain_modules + ' 个模块，预检 token **零命中**' +
          '（域外有：' + (UP.persist_top ? '' : '') + '注入链路诊断 dry-run，属另一域）'))
      : '未复核（冻结证据：0）' },
  { id: 'R3', desc: '上游分支 / 回放的**模块全局通道运行时可达**（真加载真调用，不靠猜外供形式）',
    pass: UP.checked ? globalOk : false, got: String(globalOk),
    gotText: UP.checked
      ? ('branch-guard 可加载=' + !!(bg && bg.loadable) + '（API ' + ((bg && bg.api_keys) || 0) + ' 键，' +
        '一句话读数可达=' + !!(bg && bg.line_reachable) + '）· ledger-replay 可加载=' + !!(lr && lr.loadable) +
        '（API ' + ((lr && lr.api_keys) || 0) + ' 键，登记 ' + ((lr && lr.floor_owners) || 0) + ' 本账）')
      : '未复核（冻结证据：n/a）' },
  { id: 'R4', desc: '上游分支 / 回滚面**携带内容**（能答「回滚会丢掉什么」，而不只是楼层号）',
    pass: UP.checked ? (bg && bg.guard_records_no_content === false) : false, got: String(!(bg && bg.guard_records_no_content)),
    gotText: UP.checked
      ? ('branch-guard stats 键 = [' + ((bg && bg.stats_keys) || []).join('、') + '] ⇒ **只记楼层号与过期时刻**，' +
        '无内容 / 条数字段；ledger-replay 的 replayDrop 形参只有 (host, floor, registry)，无 opts ⇒ 无「先算后改」')
      : '未复核（冻结证据：false）' },
  { id: 'R5', desc: '下游已有回滚覆盖面（增量基础已存在）',
    pass: rollbackFiles.length >= 2, got: String(rollbackFiles.length),
    gotText: rollbackPoints.length + ' 点 / ' + rollbackFiles.length + ' 文件 / ' + rollbackEntryDefs.length + ' 入口定义' }
];

/* 判定：R1（持久检查点）与 R2（回滚预览）是 F-1 的主体，任一不成立即 not_now。
 *   R3（可达性）成立只说明「读得到」，不等于「有可接的面」；
 *   R4 把「读到了什么」量出来 —— 它是不成立的，这决定了「分支只读对照」也做不成。 */
const verdict = (crit[0].pass === true && crit[1].pass === true && crit[3].pass === true) ? 'go' : 'not_now';

const report = {
  filesScanned: files.length,
  rollbackPoints: rollbackPoints.length,
  rollbackFiles: rollbackFiles.length,
  rollbackEntryDefs: rollbackEntryDefs.length,
  rollbackFilesList: rollbackFiles,
  checkpointFaceHits: checkpointHits.length,
  previewFaceHits: previewHits.length,
  branchFaceHits: branchFaceHits.length,
  upstreamGlobalReadSites: globalReadSites.length,
  chatDataPatterns: chatDataPatterns,
  namespaceStoreSites: nsStoreHits,
  upstream: UP,
  criteria: crit,
  verdict: verdict
};

if (JSON_MODE) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log('[branch] ===== F-1 分支与玩法可行性 =====');
console.log('[branch] ① 下游枚举面：' + files.length + ' 个 .js（apps/** + config/**）');
console.log('[branch] ② 回滚覆盖面：' + rollbackPoints.length + ' 点 / ' + rollbackFiles.length + ' 文件 / ' + rollbackEntryDefs.length + ' 入口定义');
console.log('[branch] ③ F-1 三件在**下游**的现状：持久检查点 ' + checkpointHits.length + ' · 回滚预览 ' + previewHits.length + ' · 分支只读对照 ' + branchFaceHits.length);
console.log('[branch] ④ 下游现有上游模块直读站点：' + globalReadSites.length + ' 处 · 存储分域：CHAT_DATA_PATTERNS ' + chatDataPatterns + ' 条 / 命名空间守卫 ' + nsStoreHits + ' 处');
console.log('[branch] ⑤ 上游复核：' + (UP.checked ? '已跑（枚举 ' + UP.modules_scanned + ' 个模块' + (UP.isRepo ? '，git 仓' : '') + '）' : '跳过 —— ' + UP.note));
console.log('[branch] ⑥ 判定：');
for (const c of crit) console.log('[branch]    ' + c.id + ' ' + (c.pass === true ? 'OK' : (c.pass === null ? '?' : 'NG')) + ' ' + c.desc + ' —— ' + c.gotText);
console.log('[branch] => ' + verdict);
process.exit(0);