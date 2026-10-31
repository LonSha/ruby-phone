#!/usr/bin/env node
/* ============================================================
 * tools/browser-readings.mjs — R13-O1 第 3 步：把真跑一次的读数落成台账
 * ------------------------------------------------------------
 * 为什么单独立一件工具而不是让 gate.mjs 顺手写：
 *   `tests/browser/gate.mjs` 是**门**，它只该回答「过没过」。
 *   台账是**证据**（场景数 / 视口数 / 每场景读数条数 / 耗时 / 浏览器版本），
 *   证据要能被后来的版本 diff、能被判据复算，所以要有确定的落盘位置与 schema。
 *
 * 纪律：
 *   · 本工具**不判 ok**、不重算判据 —— 判定权只在 gate.mjs 与场景文件里，这里只搬运读数；
 *   · 未执行（无浏览器）时**不写台账**，退出码 2 —— 不生成一份「空台账」假装跑过；
 *   · 台账带 `browser` / `version` / `measured_at`，任何一份证据都能自证是哪次跑出来的；
 *   · 日志里有多少行就读多少行 —— 缺场景照实记缺（scene_coverage 会点名），绝不补行。
 *
 * 两种模式：
 *   直线  node tools/browser-readings.mjs
 *         本工具自己 spawn gate.mjs，边跑边收 stdout。
 *   回放  node tools/browser-readings.mjs --from=/tmp/gate.log
 *         从**已经跑完的真实日志**里搬读数。
 *         为什么要回放：直线模式要求子进程撑到把 512 行证据全吐完；高内存压力下
 *         Chromium 可能被 OOM 干掉，读数就会半途断掉（本仓实测断在第 4 个场景，
 *         137 条读数 vs 真实 512 条）。回放把「跑」与「记账」解耦：
 *         gate 先把真日志落文件（那本身就是一次真跑），本工具再从那份真日志里搬。
 *         代价诚实写明：回放模式**观测不到 gate 的退出码**，台账里记 null 并注明，
 *         不猜、不补。
 *
 * 用法：node tools/browser-readings.mjs [--out=tests/audit/browser_readings.json] [--from=<gate 日志>]
 * 退出码：0 已落盘且无 FAIL / 2 未执行或读不到日志 / 1 已落盘但有 FAIL
 * ============================================================ */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GATE = path.join(ROOT, 'tests', 'browser', 'gate.mjs');
const SCEN_DIR = path.join(ROOT, 'tests', 'browser', 'scenarios');

const argv = process.argv.slice(2);
const outArg = argv.find((a) => a.startsWith('--out='));
const OUT = path.join(ROOT, outArg ? outArg.slice(6) : 'tests/audit/browser_readings.json');
const fromArg = argv.find((a) => a.startsWith('--from='));
const FROM = fromArg ? path.resolve(ROOT, fromArg.slice(7)) : null;

/* ---------- 磁盘上的正式场景清单（只用于覆盖自证，不改判据） ---------- */
function scenariosOnDisk() {
  try {
    /* 与 gate.mjs 的 listScenes() **同一条口径**：`_` 前缀是取证用的一次性探针，
     * 不算正式场景。这里若不一字对齐，台账就会把 25 个 _diag*.scen.js 误报成「缺失」，
     * 覆盖自证反而变成噪音源。 */
    return fs.readdirSync(SCEN_DIR)
      .filter((n) => n.endsWith('.scen.js') && !n.startsWith('_'))
      .sort();
  } catch (_e) {
    return [];
  }
}

/* 读数行：`[scene] WxH ver=V browser=S host=stub ok|FAIL name | detail` */
const READ_RE = /^\[([^\]]+)\] (\d+x\d+) ver=(\S+) browser=(\S+) host=(\S+) (ok|FAIL)\s+([^|]+)\|\s*(.*)$/;

function harvest(text, gateExitCode, elapsedMs) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(READ_RE);
    if (!m) continue;
    rows.push({
      scene: m[1], viewport: m[2], version: m[3], browser: m[4], host: m[5],
      ok: m[6] === 'ok', name: m[7].trim(), detail: String(m[8]).slice(0, 300),
    });
  }

  /* 未执行：不写台账（写一份空台账等于制造假证据） */
  if (/环境无可用浏览器|结构自证失败/.test(text)) {
    console.error('[browser-readings] 未执行 ⇒ 不落台账（未执行不得计通过，也不得留下假证据）');
    const m = text.match(/\[browser-gate\] 环境无可用浏览器[^\n]*/);
    if (m) console.error('  ' + m[0]);
    process.exit(2);
  }
  if (rows.length === 0) {
    console.error('[browser-readings] gate 没有输出可解析的读数行 ⇒ 不落台账（防止落一份空证据）');
    process.exit(2);
  }

  const scenes = [...new Set(rows.map((r) => r.scene))].sort();
  const viewports = [...new Set(rows.map((r) => r.viewport))];
  const perScene = {};
  for (const s of scenes) {
    const mine = rows.filter((r) => r.scene === s);
    perScene[s] = { reads: mine.length, fail: mine.filter((r) => !r.ok).length };
  }
  const failRows = rows.filter((r) => !r.ok);

  /* 覆盖自证：磁盘上有几个正式场景，这份台账实际记到几个。
   * 只报事实，不下「通过/不通过」结论（那是 gate 的活）；
   * 但它让「只跑到 4/12」这类半途断档再也藏不住。 */
  const onDisk = scenariosOnDisk();
  const measured = new Set(scenes);
  const missing = onDisk.filter((n) => !measured.has(n));
  const extra = scenes.filter((n) => !onDisk.includes(n));

  const ledger = {
    schema: 'browser-readings@1',
    why: 'R13-O1 第 3 步交付物：浏览器层**真跑一次**的读数台账。本文件由 tools/browser-readings.mjs 从 gate.mjs 的真实输出逐行搬运，不重算任何判据。',
    measured_at: new Date().toISOString(),
    version: rows[0].version,
    browser: rows[0].browser,
    mode: FROM ? 'replay' : 'direct',
    source: FROM
      ? { log: path.relative(ROOT, FROM), bytes: fs.statSync(FROM).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(FROM)).digest('hex') }
      : { gate: path.relative(ROOT, GATE) },
    elapsed_ms: elapsedMs,
    scenes: scenes.length,
    viewports: viewports.length,
    viewport_list: viewports,
    total_reads: rows.length,
    fail_reads: failRows.length,
    min_reads_per_scene: Math.min(...Object.values(perScene).map((v) => v.reads)),
    scene_coverage: {
      on_disk: onDisk.length,
      measured: scenes.length,
      missing,
      extra,
      complete: missing.length === 0 && extra.length === 0,
    },
    per_scene: perScene,
    /* 失败读数只留「场景 / 视口 / 读数名 / 摘要」，全量明细由 `npm run browser` 现场给 */
    failures: failRows.map((r) => ({ scene: r.scene, viewport: r.viewport, name: r.name, detail: r.detail })),
    gate_exit_code: gateExitCode,
    gate_exit_code_note: gateExitCode === null
      ? '回放模式只读日志、观测不到 gate 退出码，故记 null（不猜不补）；真实判定以日志末的 fail 计数为准。'
      : '直线模式原样透传 gate.mjs 的退出码。',
    honest_boundary: '本台账证明「门真跑了一次并如实报出读数」；它不证明 89 个入口的内容都正确。门内判据的红点即为当期真缺陷，逐条列在 failures 里。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  console.log(`[browser-readings] 已落盘 ${path.relative(ROOT, OUT)}（mode=${ledger.mode}）`);
  console.log(`[browser-readings] 场景 ${scenes.length}/${onDisk.length} · 视口 ${viewports.length} 档 · 读数 ${rows.length} 条 · FAIL ${failRows.length} 条 · 耗时 ${elapsedMs}ms`);
  console.log(`[browser-readings] 浏览器 ${ledger.browser} · 版本 ${ledger.version} · gate exit=${gateExitCode === null ? 'n/a' : gateExitCode}`);
  if (missing.length) {
    console.error(`[browser-readings] ⚠ 覆盖不全：磁盘上 ${onDisk.length} 个场景，本台账缺 ${missing.length} 个 ⇒ ${missing.join(', ')}`);
  }
  if (extra.length) {
    console.error(`[browser-readings] ⚠ 台账里有磁盘上不存在的场景 ⇒ ${extra.join(', ')}`);
  }
  if (failRows.length > 0) process.exit(1);
  if (gateExitCode === null) process.exit(0);
  process.exit(gateExitCode === 0 ? 0 : 1);
}

if (FROM) {
  let raw = '';
  try { raw = fs.readFileSync(FROM, 'utf8'); } catch (_e) {
    console.error('[browser-readings] 读不到日志：' + FROM + ' ⇒ 不落台账');
    process.exit(2);
  }
  harvest(raw, null, Number(process.env.READINGS_ELAPSED_MS || 0) || 0);
} else {
  const t0 = Date.now();
  const child = spawn(process.execPath, [GATE], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => harvest(out + err, code, Date.now() - t0));
}