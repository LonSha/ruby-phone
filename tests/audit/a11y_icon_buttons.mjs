#!/usr/bin/env node
/**
 * tests/audit/a11y_icon_buttons.mjs — 无障碍面可数读数与门禁（计划 R22-O3）
 * ------------------------------------------------------------
 * 为什么这么做（R22-O3 真实现场，2026-11-17 实测）：
 *   全仓 apps/ 440 个 js、1712 个 `<button>`、592 个 `<input>`，而 aria-label 只有 233 处、
 *   role 115 处、tabindex 17 处。缺口不是「所有按钮都没有标签」——带可见文字的按钮本来
 *   就有可访问名；真正坏掉的是**纯图标按钮**：`<button><i class="fa-solid fa-xmark"></i></button>`
 *   读屏读出来是一个没有名字的「按钮」。
 *   实测该类共 **117 个**（28 个文件），本轮全部补上 aria-label（语义按图标 + class 定，
 *   如 fa-chevron-left→返回、phone-slash+reject→拒接）。
 *
 * 判定规则：
 *   R1 纯图标按钮必须有可访问名：`aria-label` / `aria-labelledby` / `title` 三者之一。
 *      带可见文字的按钮**不**强制 aria-label（否则会逼出「aria-label=按钮」这种假无障碍）。
 *   R2 不下滑：每文件的 aria-label / role / tabindex 计数不得低于基线台账
 *      (`tests/audit/a11y_baseline.json`)，总量也不得低于基线（防「补了又拆」）。
 *   R3 白名单逐条带理由（≥12 字）：确实无法定名的纯图标按钮必须写明原因。
 *   R4 fail-closed：扫到 app 文件数 <300 或 `<button>` <500 ⇒ exit 2（探针失效不许算通过）。
 *
 * 用法：node tests/audit/a11y_icon_buttons.mjs [--write|--check]
 *   --write  重写基线台账（换版本时用；写完必须复跑 --check 并提交）
 *   --check  默认，按基线判不下滑 + R1/R3
 * 退出码：0 通过 / 1 违规 / 2 结构失效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.RUBY_AUDIT_ROOT || path.resolve(__dir, '../..');
const BASELINE_PATH = 'tests/audit/a11y_baseline.json';
const WHITELIST_PATH = 'tests/audit/a11y_whitelist.json';
const MIN_FILES = 300;
const MIN_BUTTONS = 500;

const BUTTON_RE = /<button([^>]*)>([\s\S]{0,120}?)<\/button>/g;

function collectFiles(dir, base, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, base, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(base, p));
  }
}

/** 纯图标判定：去标签、去实体、去空白与常见分隔符后为空 ⇒ 没有可见文字。 */
function visibleTextOf(inner) {
  return String(inner)
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, '')
    .replace(/[\s\u00a0·•…—\-]/g, '');
}

export function measureA11y(sources) {
  const perFile = {};
  const iconOnlyUncovered = [];
  let totals = { files: 0, buttons: 0, ariaLabel: 0, role: 0, tabindex: 0, iconOnly: 0, iconOnlyCovered: 0 };
  for (const [file, src] of sources.entries()) {
    const ariaLabel = (src.match(/aria-label=/g) || []).length;
    const role = (src.match(/\brole=/g) || []).length;
    const tabindex = (src.match(/tabindex=/g) || []).length;
    let buttons = 0;
    let iconOnly = 0;
    let covered = 0;
    BUTTON_RE.lastIndex = 0;
    let m;
    while ((m = BUTTON_RE.exec(src)) !== null) {
      buttons++;
      const attrs = m[1];
      if (visibleTextOf(m[2]).length > 0) continue;
      iconOnly++;
      if (/aria-label=|aria-labelledby=|title=/.test(attrs)) {
        covered++;
        continue;
      }
      const line = src.slice(0, m.index).split('\n').length;
      iconOnlyUncovered.push({ file, line });
    }
    perFile[file] = { ariaLabel, role, tabindex, buttons, iconOnly, iconOnlyCovered: covered };
    totals.files++;
    totals.buttons += buttons;
    totals.ariaLabel += ariaLabel;
    totals.role += role;
    totals.tabindex += tabindex;
    totals.iconOnly += iconOnly;
    totals.iconOnlyCovered += covered;
  }
  return { perFile, totals, iconOnlyUncovered };
}

/**
 * @param {object} opts
 * @param {Map<string,string>|object} [opts.sources]
 * @param {object} [opts.baseline]
 * @param {object} [opts.whitelist]
 * @param {boolean} [opts.write]
 * @param {string} [opts.rootDir]
 */
export function auditA11y(opts = {}) {
  const rootDir = opts.rootDir || ROOT;

  let sources;
  if (opts.sources) {
    sources = opts.sources instanceof Map ? opts.sources : new Map(Object.entries(opts.sources));
  } else {
    const files = [];
    collectFiles(path.join(rootDir, 'apps'), rootDir, files);
    sources = new Map();
    for (const f of files) {
      try { sources.set(f, fs.readFileSync(path.join(rootDir, f), 'utf8')); } catch (_e) { /* 读不到就跳过 */ }
    }
  }

  const measured = measureA11y(sources);

  const fail = (error) => ({ status: 'fail_closed', exitCode: 2, error, measured });

  if (!opts.sources) {
    if (measured.totals.files < MIN_FILES) return fail(`扫到 app 文件数 ${measured.totals.files} < ${MIN_FILES}，探针失效`);
    if (measured.totals.buttons < MIN_BUTTONS) return fail(`扫到 <button> 数 ${measured.totals.buttons} < ${MIN_BUTTONS}，探针失效`);
  }

  let baseline = opts.baseline;
  if (baseline === undefined) {
    try { baseline = JSON.parse(fs.readFileSync(path.join(rootDir, BASELINE_PATH), 'utf8')); } catch (_e) { baseline = null; }
  }

  /* --write：只写读数，不判；写完由调用方复跑 --check */
  if (opts.write) {
    return {
      status: 'written',
      exitCode: 0,
      totals: measured.totals,
      baseline: {
        schema: 'a11y-baseline@1',
        plan: 'R22-O3',
        note: '纯图标按钮的可访问名覆盖基线。R1 要求 uncovered=0；R2 要求每文件 aria-label/role/tabindex 与总量不低于本台账。',
        generated_at: new Date().toISOString(),
        totals: measured.totals,
        perFile: measured.perFile,
      },
    };
  }

  if (!baseline || !baseline.perFile) return fail(`读不到基线台账 ${BASELINE_PATH}（先跑 --write）`);

  let whitelist = opts.whitelist;
  if (whitelist === undefined) {
    try { whitelist = JSON.parse(fs.readFileSync(path.join(rootDir, WHITELIST_PATH), 'utf8')); } catch (_e) { whitelist = { entries: [] }; }
  }
  const allowed = new Map();
  const badWhitelist = [];
  for (const e of (whitelist.entries || [])) {
    if (!e || typeof e.file !== 'string' || !e.file) { badWhitelist.push({ why: '条目缺 file' }); continue; }
    if (typeof e.why !== 'string' || e.why.trim().length < 12) {
      badWhitelist.push({ file: e.file, why: '理由过短（必须写清为什么这个纯图标按钮无法定名）' });
      continue;
    }
    allowed.set(e.file, e.why);
  }

  const uncovered = measured.iconOnlyUncovered.filter((v) => !allowed.has(v.file));
  const staleWhitelist = [...allowed.keys()].filter((f) => !measured.iconOnlyUncovered.some((v) => v.file === f));

  const regressions = [];
  for (const [file, cur] of Object.entries(measured.perFile)) {
    const base = baseline.perFile[file];
    if (!base) continue;                                  // 新文件不判下滑
    for (const k of ['ariaLabel', 'role', 'tabindex']) {
      if (cur[k] < base[k]) regressions.push({ file, key: k, base: base[k], now: cur[k] });
    }
  }
  for (const k of ['ariaLabel', 'role', 'tabindex']) {
    if (measured.totals[k] < baseline.totals[k]) {
      regressions.push({ file: '(总量)', key: k, base: baseline.totals[k], now: measured.totals[k] });
    }
  }

  const violations = { uncovered, regressions, badWhitelist, staleWhitelist };
  const bad = uncovered.length + regressions.length + badWhitelist.length + staleWhitelist.length;
  return {
    status: bad > 0 ? 'defect' : 'ok',
    exitCode: bad > 0 ? 1 : 0,
    totals: measured.totals,
    baselineTotals: baseline.totals,
    violations,
    totalViolations: bad,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const write = process.argv.includes('--write');
  const res = auditA11y({ write });
  if (res.status === 'fail_closed') {
    console.error(`[a11y] FAIL-CLOSED (exit 2): ${res.error}`);
    process.exit(2);
  }
  if (write) {
    fs.writeFileSync(path.join(ROOT, BASELINE_PATH), JSON.stringify(res.baseline, null, 2) + '\n', 'utf8');
    console.log(`[a11y] 基线已写入 ${BASELINE_PATH}：aria-label ${res.totals.ariaLabel} / role ${res.totals.role}`
      + ` / tabindex ${res.totals.tabindex}；纯图标按钮 ${res.totals.iconOnly} 个，已覆盖 ${res.totals.iconOnlyCovered}。`);
    process.exit(0);
  }
  for (const [k, label] of Object.entries({
    uncovered: '纯图标按钮缺可访问名',
    regressions: '无障碍计数低于基线（下滑）',
    badWhitelist: '白名单条目不合格',
    staleWhitelist: '白名单条目过期',
  })) {
    const arr = res.violations[k] || [];
    if (!arr.length) continue;
    console.error(`[a11y] ${label}（${arr.length}）：`);
    for (const v of arr.slice(0, 20)) console.error('  - ' + JSON.stringify(v));
  }
  if (res.exitCode !== 0) process.exit(res.exitCode === 1 ? 1 : 2);
  console.log(`[a11y] 检查通过：${res.totals.files} 个 app 文件 / ${res.totals.buttons} 个 button；`
    + `纯图标按钮 ${res.totals.iconOnly} 个全部有可访问名（${res.totals.iconOnlyCovered} 覆盖）；`
    + `aria-label ${res.totals.ariaLabel}（基线 ${res.baselineTotals.ariaLabel}）、role ${res.totals.role}、tabindex ${res.totals.tabindex} 均未下滑。`);
  process.exit(0);
}