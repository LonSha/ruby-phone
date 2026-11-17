#!/usr/bin/env node
/* ============================================================
 * tests/audit/scan_file_size_ceiling.mjs —— 全仓单文件行数上界门（R23-O1）
 * ------------------------------------------------------------
 * 【它解决什么】
 *   PLAN.md 里那条「无上界门：data/cheats.js 27612 行、chat-view.js 19977 行，谁都不拦」
 *   是立项时的真读数，也是这次要兑现的欠账。只给 chat-view.js 设天花板（R22-O1 那一条）
 *   等于只拦一个文件：谁都能在 settings-app.js 里再长出一个 1.2 万行。
 *
 *   所以这道门的口径是**全仓 + 默认上限 + 逐文件棘轮**：
 *     · 默认上限 DEFAULT_MAX：任何 apps/ config/ 下的 .js 超过它就是「大文件」，
 *       必须逐条落进台账（不是禁止，是"要长就得记账"）；
 *     · 逐文件 lines_max：台账里记的是**当前真读数**，只降不涨；
 *     · 总量：全仓 .js 行数之和也只降不涨（防"拆一个文件、新增三个文件"）。
 *
 * 【为什么 R3 要求 lines_max == 当前行数（而不是留余量）】
 *   留余量就等于允许"悄悄长回去一点"。所以拆完/删完必须跑 --write 把台账压下来，
 *   压的动作要留在提交里。涨了 → R2 红；降了没压 → R3 红（提示跑 --write）。
 *
 * 【诚实写明】
 *   · 行数是弱指标：它不判断代码好坏，只保证「长大必须有人签字」。
 *   · 本门不替代覆盖率；覆盖率台账仍以 coverage_baseline.json 为准（R23-O4 处理）。
 *
 * 用法：
 *   node tests/audit/scan_file_size_ceiling.mjs            # 检查（默认）
 *   node tests/audit/scan_file_size_ceiling.mjs --write    # 重写台账（拆完/删完才用）
 *   node tests/audit/scan_file_size_ceiling.mjs --json     # 机读
 * 退出码：0 通过 / 1 违规 / 2 结构失效（fail-closed）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

export const PLAN = 'R23-O1';
/* 扫描清单：所有放产品代码的根目录。刻意**排除** tests/（判据本身）与 docs/（文档）。
 * assets/ 也扫：vendored 单文件将来若长大，同样要有人签字（台账 note 里写清是 vendored）。
 * 这条清单漏一个目录，就等于那个目录没有上界 —— PLAN.md 点名的 data/cheats.js 27611 行
 * 正是「只扫 apps 就会漏掉」的现场证据。 */
export const TARGET_DIRS = ['apps', 'config', 'data', 'phone', 'workers', 'assets'];
export const LEDGER = 'tests/audit/file_size_ceiling.json';
/** 新文件的默认上限：超过它就必须落台账。 */
export const DEFAULT_MAX = 1200;
/** 探针自检下限：扫不到这么多 .js 说明路径/结构变了，不许算通过。 */
export const MIN_FILES = 300;

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const WRITE = argv.includes('--write');

export const linesOf = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

/** 递归收集 .js（跳过 node_modules / .git）。 */
export function collect(rootDir, dirs, out = [], base = rootDir) {
  for (const d of dirs) {
    const abs = path.join(rootDir, d);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name.endsWith('.js')) out.push(path.relative(base, p).split(path.sep).join('/'));
      }
    }
  }
  return out;
}

/** 读全仓读数：[{ path, lines }]，按行数降序。 */
export function readSizes(rootDir = ROOT) {
  const files = collect(rootDir, TARGET_DIRS).sort();
  const rows = files.map((rel) => ({ path: rel, lines: linesOf(fs.readFileSync(path.join(rootDir, rel), 'utf8')) }));
  rows.sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1));
  return rows;
}

/* ---------------- 判据（纯函数，便于负控制） ---------------- */

/**
 * @param {{rows: {path:string,lines:number}[], ledger: object, defaultMax?: number}} o
 * @returns {{ok:boolean, problems:{id:string,msg:string}[], stats:object}}
 */
export function checkCeilings({ rows, ledger, defaultMax = DEFAULT_MAX }) {
  const problems = [];
  const push = (id, msg) => problems.push({ id, msg });
  const known = (ledger && ledger.files) || {};
  const byPath = new Map(rows.map((r) => [r.path, r.lines]));

  /* R0：探针自检 —— 扫不到足够文件就是探针坏了，不是"没有大文件" */
  if (rows.length < MIN_FILES) {
    return { ok: false, problems: [{ id: 'R0', msg: `只扫到 ${rows.length} 个 .js（<${MIN_FILES}），探针失效，拒判` }], stats: { files: rows.length } };
  }

  /* R1：大文件必须有天花板（无上界门的主要兑现点） */
  for (const r of rows) {
    if (r.lines <= defaultMax) continue;
    if (!(r.path in known)) {
      push('R1', `${r.path} 有 ${r.lines} 行（> 默认上限 ${defaultMax}）但没有天花板记录 —— 大文件必须落台账`);
    }
  }

  /* R2：只降不涨（逐文件棘轮） */
  for (const [rel, rec] of Object.entries(known)) {
    const now = byPath.get(rel);
    if (now === undefined) {
      push('R2', `${rel}：台账里有天花板，但文件已不存在（删文件要同步跑 --write）`);
      continue;
    }
    const max = Number(rec.lines_max);
    if (!Number.isFinite(max)) {
      push('R2', `${rel}：lines_max 不是数字（${JSON.stringify(rec.lines_max)}）`);
      continue;
    }
    if (now > max) push('R2', `${rel}：${now} 行 > 天花板 ${max}（涨了；真需要长就写进台账并说明）`);
  }

  /* R3：台账必须是当前快照（降了不压 = 下次能悄悄长回去） */
  for (const [rel, rec] of Object.entries(known)) {
    const now = byPath.get(rel);
    if (now === undefined) continue;
    const max = Number(rec.lines_max);
    if (Number.isFinite(max) && now < max) {
      push('R3', `${rel}：现 ${now} 行 < 台账 ${max}，天花板没跟上（跑 --write 压下来，让"降"留在提交里）`);
    }
  }

  /* R4：总量只降不涨 */
  const total = rows.reduce((a, r) => a + r.lines, 0);
  const totalMax = Number(ledger && ledger.total_lines_max);
  if (!Number.isFinite(totalMax)) push('R4', '台账缺 total_lines_max（总量没有天花板）');
  else if (total > totalMax) push('R4', `全仓 .js 合计 ${total} 行 > 天花板 ${totalMax}（拆一个、长三个也会被这条抓到）`);

  const stats = {
    files: rows.length,
    total,
    overDefault: rows.filter((r) => r.lines > defaultMax).length,
    ledgered: Object.keys(known).length,
  };
  return { ok: problems.length === 0, problems, stats };
}

/** 由当前读数生成台账（--write 用）。 */
export function buildLedger(rows, defaultMax = DEFAULT_MAX, now = new Date()) {
  const files = {};
  for (const r of rows) {
    if (r.lines <= defaultMax) continue; // 小文件不必逐条记账
    files[r.path] = { lines_max: r.lines, note: '大文件（> 默认上限），只降不涨；真需要长就在提交里改这里' };
  }
  return {
    schema: 'file-size-ceiling@1',
    plan: PLAN,
    note: '全仓 apps/ config/ 下 .js 的文件行数天花板。台账里只收「大文件」（> default_max）；小文件靠 default_max 兜底。lines_max 记的是当前真读数，只降不涨：涨了 R2 红，降了不压 R3 红。行数口径 = 物理行数（末尾换行不计）：所以 chat-view.js 在这里是 18531，而 chat_render_split.json 的 view_lines_max 用的是 split 长度 18532，两者差 1 是口径差不是不一致。 R23-O2（同文件内/出文件切片）之后该文件是 18449。' +
      ' **总量棘轮的一个已知代价**：把方法体内的一段搬到新模块，会让全仓行数**上涨**（每个切片至少要付函数壳 + 调用点这 6 行），R23-O2 为此涨了 24 行（402654 → 402678）。这不是偷偷长，是切片本身的成本，已写在这里并在提交里可见；要抵消它得靠后续真正删代码，不能靠「不压台账」。',
    default_max: defaultMax,
    generated_at: now.toISOString(),
    total_lines_max: rows.reduce((a, r) => a + r.lines, 0),
    files,
  };
}

/* ---------------- 主流程 ---------------- */

function main() {
  const rows = readSizes(ROOT);
  const ledgerPath = path.join(ROOT, LEDGER);

  if (WRITE) {
    const ledger = buildLedger(rows);
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`[file-size] 台账已写：${LEDGER}（${Object.keys(ledger.files).length} 个大文件 / 合计 ${ledger.total_lines_max} 行）`);
    return 0;
  }

  if (!fs.existsSync(ledgerPath)) {
    console.error(`[file-size] fail-closed：读不到 ${LEDGER}（先跑 --write 建立台账）`);
    return 2;
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const { ok, problems, stats } = checkCeilings({ rows, ledger });

  if (JSON_MODE) console.log(JSON.stringify({ ok, stats, problems }, null, 2));
  else {
    if (problems.length) for (const p of problems) console.log(`FAIL [${p.id}] ${p.msg}`);
    else console.log('OK   全部判据通过');
    console.log(
      `\n[file-size] ${ok ? '通过' : '未通过'}：${stats.files} 个 .js / 合计 ${stats.total} 行 / 大文件 ${stats.overDefault} 个（台账 ${stats.ledgered}）`
    );
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}