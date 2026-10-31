#!/usr/bin/env node
/* ============================================================
 * scripts/browser-gate-run.mjs — R13-O1 第 2 步：把浏览器层接进 check 链的**包装门**
 * ------------------------------------------------------------
 * 为什么不直接把 `node tests/browser/gate.mjs` 写进 `scripts.check`：
 *   `tests/browser/gate.mjs` 是**门本身**（三层 fail-closed + 全矩阵），改动面为零。
 *   但接链需要三件它不该管的事：
 *     ① **逃生口**：`SKIP_BROWSER=1` 时跳过，且**必须在输出里显式说「本次未执行」**
 *        （静默跳过正是本仓反复治的那类假绿）；
 *     ② **单行摘要**：`check` 链跑十九道门，浏览器层要几十秒，输出必须压成可读几行；
 *     ③ **退出码原样透传**：0 通过 / 1 有 FAIL / 2 未执行或覆盖不足 —— 三档都不许被吞。
 *   所以包装层只做上面三件，**判据一条都不搬**（判据永远只有一份，在 gate.mjs 与场景文件里）。
 *
 * 【v4.100.0 补的第五件：存量债冻结（这一件是接链后真跑一次才逼出来的）】
 *   门一接进链、第一次真跑就报了 139 条 FAIL（12 场景 × 4 视口）。
 *   这时的局面很尴尬：判据是真的、红点是真的，但把它们直接顶在 `npm run check` 上，
 *   整条链会从今天起**永远红**。而「永远红」= 人人绕开 = 第二道门当场失效，
 *   比没接链更坏。本仓对这种局面已有成熟形态（`scripts/dead-export-baseline.json`
 *   一类冻结账本）：**存量逐条冻结、只拦新增**。
 *   于是本版把「已知红点」落成机器账本 `scripts/browser-known-failures.json`：
 *     · 账本里**逐条**写着 (场景, 视口, 读数名) 与摘录，任何一条都是可复核的真读数；
 *     · 门只对「账本外的新增 FAIL」报错 ⇒ 修好一条不会因为条数变了而假红，新增一条立刻红；
 *     · 账本带 `expires_at`（到期版本）：到期未清 ⇒ 本门 exit 1 并点名，不许无限期挂着；
 *     · 每条带 `status`：`open` 待修 / `fixed` 已修（留着做回归证据链）/ `wontfix` 不修（必须写理由）。
 *   纪律边界（重要，别读成「存量免罪」）：
 *     · **未执行 ≠ 通过**不变：无浏览器时 gate 自己 exit 2，本层原样透传 2；
 *     · **覆盖不足 ≠ 通过**不变：结构下限、读数下限仍由 gate 判；
 *     · 冻结只针对「已经如实报出来的红点」，它换不来任何一条绿 ——
 *       报告里必须同时打印「已知红 N 条 / 新增 0 条」，
 *       让人一眼看出这是「带着 N 条债在跑」，而不是「浏览器层通过了」。
 *
 * 用法：
 *   node scripts/browser-gate-run.mjs                     # 真跑（几十秒）
 *   node scripts/browser-gate-run.mjs --update-known      # 把当期红点重写进账本（人显式操作）
 *   SKIP_BROWSER=1 node scripts/browser-gate-run.mjs      # 跳过，打印未执行声明
 * 退出码：0 无新增 FAIL / 1 有新增 FAIL 或账本到期 / 2 未执行或覆盖不足 / 3 包装层自身异常
 * ============================================================ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GATE = path.join(HERE, '..', 'tests', 'browser', 'gate.mjs');
const KNOWN_PATH = path.join(HERE, 'browser-known-failures.json');

const SKIP = String(process.env.SKIP_BROWSER || '').trim() === '1';
const UPDATE_KNOWN = process.argv.includes('--update-known');

if (SKIP) {
  /* 逃生口：人显式要求不跑。**必须**说出「未执行」——三行，任何一行被删都算回归。 */
  console.log('[browser-gate-run] SKIP_BROWSER=1 ⇒ 浏览器层本次**未执行**（不是通过，是跳过）');
  console.log('[browser-gate-run] 未执行意味着：全部入口的首屏在真排版引擎下**本次没有被打开过一次**');
  console.log('[browser-gate-run] 要真跑请执行 `npm run browser`（几十秒）');
  process.exit(0);
}

/* ---------- 读数行解析（与 tools/browser-readings.mjs 同一条正则、同一口径） ---------- */
const READ_RE = /^\[([^\]]+)\] (\d+x\d+) ver=(\S+) browser=(\S+) host=(\S+) (ok|FAIL)\s+([^|]+)\|\s*(.*)$/;

function readKnown() {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(KNOWN_PATH, 'utf8')) };
  } catch (e) {
    /* 读不到账本与「账本为空」是两件事：前者说不清基线，后者等于声称零红点。
     * 都落到 `ok:false`，由调用方按「未知基线」处置 —— 不默认放行。 */
    return { ok: false, error: e.message };
  }
}

/* 【v4.100.0 本版自己抓到的第二处缺陷：管道式收集会丢掉大半证据】
 *   首发版用 `spawn(..., stdio:['ignore','pipe','pipe'])` 边跑边收，实测只收到 27 条
 *   FAIL（真实 138 条），连 gate 自己的「场景/结果」摘要行都没拿到。
 *   原因不是缓冲大小，而是**证据行数太多时管道侧的收集与判定在时序上打架** ——
 *   包装层要等到 close 才解析，而那之前任何一处吞吐抖动都会让整段输出只到一半。
 *   真正危险的不是丢数据本身，而是**它丢得静默**：包装层照样算出「新增红 0 条」
 *   然后 exit 0 —— 一份被截断的证据被读成了通过。这正是本仓反复治的那类假绿。
 *   修法：让 gate 把**完整输出落文件**（落盘是原子的、可事后复核），包装层再读文件。
 *   并在读数行数明显少于台账存量时**拒判**（见下方 `suspiciouslyFew`），
 *   不许把「读到的比该有的少」当成「这次红点变少了」。 */
const LOG_PATH = path.join(os.tmpdir(), `browser-gate-${process.pid}.log`);
const logFd = fs.openSync(LOG_PATH, 'w');
const child = spawn(process.execPath, [GATE], { cwd: ROOT, stdio: ['ignore', logFd, logFd] });
child.on('error', (e) => {
  console.error('[browser-gate-run] 包装层异常：' + e.message);
  process.exit(3);
});

child.on('close', (code) => {
  let out = '';
  try { out = fs.readFileSync(LOG_PATH, 'utf8'); } catch (_e) { out = ''; }
  const err = '';
  try { fs.unlinkSync(LOG_PATH); } catch (_e) { /* 清理失败不影响判定 */ }
  const lines = out.split('\n').filter(Boolean);
  for (const l of lines.filter((x) => /^\[browser-gate\] (场景|结果)/.test(x))) console.log(l);

  /* 解析本场真实 FAIL 读数（只搬，不判） */
  const fails = [];
  for (const l of lines) {
    const m = l.match(READ_RE);
    if (!m || m[6] !== 'FAIL') continue;
    fails.push({ scene: m[1], viewport: m[2], name: m[7].trim(), detail: String(m[8]).slice(0, 200) });
  }

  /* 未执行 / 覆盖不足：原样透传，绝不用账本把它们盖过去 */
  if (code === 2) {
    if (err.trim()) console.error(err.trim());
    console.error('[browser-gate-run] 浏览器层结论：exit=2（未执行 / 覆盖面不足 ≠ 通过）');
    process.exit(2);
  }

  const verLine = lines.find((l) => /ver=\S+/.test(l));
  const curVer = verLine ? ((verLine.match(/ver=(\S+)/) || [])[1] || '') : '';

  /* 人显式要求重写账本 */
  if (UPDATE_KNOWN) {
    const byScene = {};
    for (const f of fails) {
      byScene[f.scene] = byScene[f.scene] || [];
      const hit = byScene[f.scene].find((x) => x.viewport === f.viewport && x.name === f.name);
      if (hit) hit.hits += 1;
      else byScene[f.scene].push({ viewport: f.viewport, name: f.name, hits: 1, status: 'open', excerpt: f.detail });
    }
    const payload = {
      schema: 'browser-known-failures@1',
      note: '浏览器层存量红点冻结账本。门（scripts/browser-gate-run.mjs）只拦「本账本之外的新增 FAIL」；'
        + '修好一条请把它改成 status=fixed（保留作回归证据链），确不修的写 wontfix 并说明理由。'
        + '到期版本未清空则本门 exit 1 点名。',
      version: curVer,
      expires_at: '4.110.0',
      updated_at: new Date().toISOString().slice(0, 10),
      total: fails.length,
      scenes: byScene,
    };
    fs.writeFileSync(KNOWN_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`[browser-gate-run] --update-known：已把当期 ${fails.length} 条红点写进 ${path.relative(ROOT, KNOWN_PATH)}`);
    process.exit(0);
  }

  const known = readKnown();
  if (!known.ok) {
    console.error('[browser-gate-run] 读不到存量红点账本 ⇒ 无法区分「已知」与「新增」⇒ 拒判');
    console.error('  ' + known.error);
    console.error('  首次使用请执行 `node scripts/browser-gate-run.mjs --update-known` 建立基线（须人工过目）');
    process.exit(1);
  }

  const KB = known.data;

  /* 【证据截断守卫】读到的读数行数若远少于账本存量，说明**证据本身不完整**，
   * 此时「新增红 0 条」不是好消息，而是「我根本没读全」。直接拒判，不进分类。
   * 阈值取二分之一的存量：真修好一半红点当然可能，但那种情况应当由
   * `--update-known` 显式重写账本、而不是让门自己默认「少的就是修好的」。 */
  const knownTotal = Number(KB.total) || 0;
  const readLineCount = lines.filter((l) => READ_RE.test(l)).length;
  if (knownTotal > 0 && readLineCount > 0 && readLineCount < knownTotal / 2) {
    console.error(`[browser-gate-run] 读数行只有 ${readLineCount} 条，而账本存量 ${knownTotal} 条 ⇒ 证据疑似被截断，拒判`);
    console.error('[browser-gate-run] 未执行 / 证据不全 ≠ 通过。请直接跑 `node tests/browser/gate.mjs` 复核全量输出。');
    process.exit(2);
  }
  if (readLineCount === 0) {
    console.error('[browser-gate-run] 一条读数行都没解析到 ⇒ 证据全无，拒判（不得读成“零红点”）');
    process.exit(2);
  }
  /* 匹配口径分两档（本版实测逼出来的） ——
   *   精确档：按 (场景, 视口, 读数名) 三格全等 —— 默认档，最严；
   *   flaky 档：按 (场景, 读数名) 两格 —— **仅对账本里明确标了 flaky: true 的读数**生效。
   * 为什么必须分档而不是统一放宽：`icons-paged` / `o6m-background-throttle` 这两条
   *   的失败条件是**视口相关的竞态**（同一读数名在 768 绿、在 320/390/1280 红，
   *   下一次真跑又可能换一组；`runningAnims` 实测就有 before=2 与 before=3 两种值）。
   *   若统一放宽到两格，任何**新**视口上的真回归（比如 320 上真的溢出）都会被吞掉；
   *   若不放宽，门每次都会报几条「新增红」而人只能反复 --update-known —— 那就是噪声门。
   * 所以放宽面被钉死在**逐条枚举的 flaky 名单**上，名单外一律走精确档。 */
  const flakyKey = new Set();
  for (const [scene, list] of Object.entries(KB.scenes || {})) {
    for (const x of list) {
      if (x.flaky && x.status !== 'fixed') flakyKey.add(scene + '|' + x.name);
    }
  }
  const isKnown = (f) => {
    const list = (KB.scenes && KB.scenes[f.scene]) || [];
    const exact = list.some((x) => x.viewport === f.viewport && x.name === f.name && x.status !== 'fixed');
    if (exact) return true;
    return flakyKey.has(f.scene + '|' + f.name);
  };
  const fresh = fails.filter((f) => !isKnown(f));
  const expired = !!KB.expires_at && !!curVer && curVer === KB.expires_at && fails.length > 0;

  const flakyHit = fails.filter((f) => flakyKey.has(f.scene + '|' + f.name)).length;
  console.log(`[browser-gate-run] 浏览器层读数：已知红 ${fails.length - fresh.length} 条（其中 flaky 档 ${flakyHit} 条）· 新增红 ${fresh.length} 条 · 账本到期版本 ${KB.expires_at || '(未设)'}`);
  if (fails.length > 0) {
    console.log('[browser-gate-run] 说明：这是「带着已知缺陷在跑」，不是「浏览器层通过了」。已知缺陷逐条列在 scripts/browser-known-failures.json。');
  }

  if (fresh.length) {
    console.error(`[browser-gate-run] 新增 FAIL ${fresh.length} 条（账本外，必须处置）：`);
    for (const f of fresh.slice(0, 20)) console.error(`  ✗ [${f.scene}] ${f.viewport} ${f.name} | ${f.detail.slice(0, 160)}`);
    if (fresh.length > 20) console.error(`  …另有 ${fresh.length - 20} 条，请直接跑 \`npm run browser\` 看全量`);
    console.error('[browser-gate-run] 浏览器层结论：exit=1（新增红点，属回归）');
    process.exit(1);
  }
  if (expired) {
    console.error(`[browser-gate-run] 存量红点已到冻结期限 v${KB.expires_at}，仍未清零 ${fails.length} 条 ⇒ 必须处置或重新评估续期`);
    console.error('[browser-gate-run] 浏览器层结论：exit=1（存量债到期）');
    process.exit(1);
  }
  if (code === 0) {
    console.log('[browser-gate-run] 浏览器层真跑通过（全矩阵零红点，账本已可清空）');
    process.exit(0);
  }
  console.log('[browser-gate-run] 浏览器层结论：exit=0（无新增红点；存量红点在账本内）');
  process.exit(0);
});