/* ============================================================
 * tools/gen_plan_baseline.mjs — R11-O5: PLAN 基线表接机器台账
 * ------------------------------------------------------------
 * 真实需求（R11-O5 / Problem 7）：
 *   PLAN.md:48-50 的现状基线表停在 v3.74.0（漂移 120+ 版），表下自述「本表仍没有判据看守」。
 *   本工具复用 tools/gen_status_ledger.mjs 的 collectStatus() 取数函数，
 *   把当前版本、门禁、体量三行直接改写，并提供 --check / --write 接口与轻判据。
 *
 * 用法：
 *   node tools/gen_plan_baseline.mjs          # 打印当前计算的基线行
 *   node tools/gen_plan_baseline.mjs --check  # 校验 PLAN.md 内数字是否与现场一致（漂移 exit 1）
 *   node tools/gen_plan_baseline.mjs --write  # 改写 PLAN.md 现状基线表三行与表注
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStatus, ROOT } from './gen_status_ledger.mjs';

const PLAN_FILE = path.join(ROOT, 'PLAN.md');

function toChineseNum(n) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return digits[n];
  if (n < 20) return '十' + (n % 10 === 0 ? '' : digits[n % 10]);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return digits[tens] + '十' + (ones === 0 ? '' : digits[ones]);
  }
  return String(n);
}

export function computePlanBaseline() {
  const live = collectStatus();
  const configCount = fs.readdirSync(path.join(ROOT, 'config')).length;
  const scriptsCount = fs.readdirSync(path.join(ROOT, 'scripts')).length;
  const indexBytes = fs.statSync(path.join(ROOT, 'index.js')).size;

  const version = live.version;
  const gatesCount = live.gates.check_chain_len;
  const gatesChinese = toChineseNum(gatesCount);
  const testFiles = live.tests.test_files;
  const appDirs = live.scale.app_dirs;
  const appsIds = live.scale.apps_ids;
  const indexLines = live.scale.index_lines;
  const cssBytes = live.scale.css_bytes;

  const versionLine = `| 版本 | **v${version}**（五源同源） | \`update-log.json\` latest / \`package.json\` |`;
  const gatesLine = `| 门禁 | \`npm run check\` **${gatesChinese}道静态门全过**；全量 \`node --test tests/*.test.mjs\` **${testFiles} 套件实跑全绿** | \`package.json\` scripts.check / \`tests/\` 实跑 |`;
  const volumeLine = `| 体量 | **v${version} 机器台账复算**：apps **${appDirs} 个 App 目录**（\`config/apps.js\` **${appsIds} 条 id**）、config **${configCount}** 件、tests **${testFiles}** 套件、scripts **${scriptsCount}** 件；\`index.js\` **${indexBytes} 字节 / ${indexLines} 行**；\`phone.css\` **${cssBytes} 字节** | \`tools/gen_status_ledger.mjs\` / \`tests/audit/status-ledger.json\` |`;

  return {
    raw: {
      version,
      gatesCount,
      testFiles,
      appDirs,
      appsIds,
      configCount,
      scriptsCount,
      indexBytes,
      indexLines,
      cssBytes,
    },
    lines: {
      versionLine,
      gatesLine,
      volumeLine,
    },
  };
}

export function checkPlanBaseline() {
  const { raw } = computePlanBaseline();
  if (!fs.existsSync(PLAN_FILE)) {
    return { ok: false, errors: ['PLAN.md 不存在'] };
  }
  const content = fs.readFileSync(PLAN_FILE, 'utf8');
  const errors = [];

  // 1. 版本匹配
  const verPattern = new RegExp(`\\|\\s*版本\\s*\\|\\s*\\*\\*v${raw.version.replace('.', '\\.')}\\*\\*`);
  if (!verPattern.test(content)) {
    errors.push(`版本读数未对齐：期望包含 **v${raw.version}**`);
  }

  // 2. 门禁匹配
  const gatePattern = new RegExp(`\\|\\s*门禁\\s*\\|.*(${raw.gatesCount}|${toChineseNum(raw.gatesCount)})道静态门全过`);
  if (!gatePattern.test(content)) {
    errors.push(`门禁道数未对齐：期望包含 ${raw.gatesCount} 或 ${toChineseNum(raw.gatesCount)}道静态门全过`);
  }

  // 3. 体量字段匹配
  const checks = [
    { label: 'app_dirs', pattern: new RegExp(`apps\\s+\\*\\*${raw.appDirs}\\s+个\\s*App\\s*目录\\*\\*`) },
    { label: 'apps_ids', pattern: new RegExp(`config/apps\\.js\`?\\s+\\*\\*${raw.appsIds}\\s+条\\s*id\\*\\*`) },
    { label: 'config_count', pattern: new RegExp(`config\\s+\\*\\*${raw.configCount}\\*\\*\\s*件`) },
    { label: 'tests_count', pattern: new RegExp(`tests\\s+\\*\\*${raw.testFiles}\\*\\*\\s*套件`) },
    { label: 'scripts_count', pattern: new RegExp(`scripts\\s+\\*\\*${raw.scriptsCount}\\*\\*\\s*件`) },
    { label: 'index_lines', pattern: new RegExp(`${raw.indexLines}\\s*行\\*\\*`) },
    { label: 'css_bytes', pattern: new RegExp(`\\*\\*${raw.cssBytes}\\s*字节\\*\\*`) },
  ];

  for (const c of checks) {
    if (!c.pattern.test(content)) {
      errors.push(`体量项 [${c.label}] 未对齐：未匹配正则 ${c.pattern}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function writePlanBaseline() {
  const { lines, raw } = computePlanBaseline();
  let content = fs.readFileSync(PLAN_FILE, 'utf8');

  // 替换版本行
  content = content.replace(
    /\|\s*版本\s*\|.*\|.*\|/,
    lines.versionLine
  );

  // 替换门禁行
  content = content.replace(
    /\|\s*门禁\s*\|.*\|.*\|/,
    lines.gatesLine
  );

  // 替换体量行
  content = content.replace(
    /\|\s*体量\s*\|.*\|.*\|/,
    lines.volumeLine
  );

  // 替换表注行
  const noteRegex = /> 本表已于 \*\*.*?\*\*复算一次.*?(?=\n\n|\n---)/s;
  const newNote = `> 本表已由 **tools/gen_plan_baseline.mjs（v${raw.version}）自动接线复算**（版本 / 门禁 / 体量三行与 status-ledger 及磁盘现状机器对账）。★ R-O9 与 R11-O5 守卫看守，手改或读数漂移即红。`;
  if (noteRegex.test(content)) {
    content = content.replace(noteRegex, newNote);
  }

  fs.writeFileSync(PLAN_FILE, content, 'utf8');
  return { ok: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2];
  if (arg === '--write') {
    writePlanBaseline();
    console.log('[tools/gen_plan_baseline] PLAN.md 基线表已按 live 状态更新。');
    const chk = checkPlanBaseline();
    if (!chk.ok) {
      console.error('[tools/gen_plan_baseline] 写入后自检失败：', chk.errors);
      process.exit(1);
    }
    console.log('[tools/gen_plan_baseline] 写入后自检全部通过。');
  } else if (arg === '--check') {
    const chk = checkPlanBaseline();
    if (!chk.ok) {
      console.error('[tools/gen_plan_baseline] PLAN.md 与台账漂移：\n  ' + chk.errors.join('\n  '));
      process.exit(1);
    }
    console.log('[tools/gen_plan_baseline] PLAN.md 与台账一致。');
  } else {
    const { lines } = computePlanBaseline();
    console.log('当前计算的基线行：');
    console.log(lines.versionLine);
    console.log(lines.gatesLine);
    console.log(lines.volumeLine);
  }
}
