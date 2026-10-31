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

/* ============================================================
 * R13-O7：入口与优先级的机器射程（从「基线表三行」扩到「三处入口」）
 * ------------------------------------------------------------
 * 立项理由原话：「这不是缺守卫，是已建机制只盖了三分之一」——
 *   R11-O5 起本工具守住了 PLAN.md 基线表三行，但 PLAN 的**顶部入口**
 *   （期号 / 日期 / 计划书链接）、PLAN 的**优先级节**（编号集合）
 *   与 TODO.md 的**最近更新版本号**三处一直没有判据：实测 TODO.md 顶面
 *   停在 v4.54.0，落后 45 个版本无人察觉。
 *
 * 取数一律回真源，不把结论抄进判据：
 *   期号 / 日期 ← 计划书文件名与标题；编号集合 ← 两份计划书里的 `### R13-*` 标题；
 *   版本号 ← update-log.json 的 latest（经 collectStatus）。
 *
 * ★ fail-closed：真源解析不出来（链接丢、标题改形、编号抽空）一律报错 ——
 *   绝不让空集合走完循环后「零条错误 = 通过」。这条坑本仓付过代价。
 *
 * 诚实边界（计划书原话）：本项只守**入口与数字**，不守「优先级节里排的顺序
 *   是否合理」——排序判断永远是人做的。故 `--write` 只回写 TODO 的版本号那一格
 *   （机械可算），PLAN 的期号与编号集合**只判不写**：自动生成优先级节，
 *   等于让工具替我决定接下来做什么。
 * ============================================================ */

/** 从 PLAN.md 顶部入口解析出当期两份计划书链接（只认**第一个**匹配 = 现行入口）。 */
export function parsePlanEntry(content) {
  const errors = [];
  const opt = content.match(/\[优化提升九项\]\((\.[^\s)]+)\)/);
  const exp = content.match(/\[拓展创新九项\]\((\.[^\s)]+)\)/);
  if (!opt) errors.push('PLAN.md 顶部入口缺「[优化提升九项](...)」链接（入口形态丢失）');
  if (!exp) errors.push('PLAN.md 顶部入口缺「[拓展创新九项](...)」链接（入口形态丢失）');
  return { optFile: opt ? opt[1] : null, expFile: exp ? exp[1] : null, errors };
}

/** 把计划书正文里的 `### R13-O1` 一类标题抽成编号列表。 */
function collectPlanNumbers(md) {
  const out = [];
  const re = /^###\s+(R[0-9]+-[OX][0-9]+)\s/mg;
  let m;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  return out;
}

export function computePlanEntries() {
  const live = collectStatus();
  const errors = [];
  const plan = fs.existsSync(PLAN_FILE) ? fs.readFileSync(PLAN_FILE, 'utf8') : null;
  if (plan === null) errors.push('PLAN.md 不存在');
  const todoPath = path.join(ROOT, 'TODO.md');
  const todo = fs.existsSync(todoPath) ? fs.readFileSync(todoPath, 'utf8') : null;
  if (todo === null) errors.push('TODO.md 不存在');

  const entry = parsePlanEntry(plan || '');
  errors.push(...entry.errors);
  const readMaybe = (rel) => {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const optContent = entry.optFile ? readMaybe(entry.optFile) : null;
  const expContent = entry.expFile ? readMaybe(entry.expFile) : null;
  if (entry.optFile && optContent === null) errors.push('PLAN.md 顶部入口指向的优化计划书不存在：' + entry.optFile);
  if (entry.expFile && expContent === null) errors.push('PLAN.md 顶部入口指向的拓展计划书不存在：' + entry.expFile);

  /* 期号与日期真源 */
  let epochCn = null;
  let planDate = null;
  if (entry.optFile) {
    const d = entry.optFile.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (!d) errors.push('计划书文件名里读不到日期 ⇒ 日期真源取不到（fail-closed，不猜）');
    else planDate = d[1];
  }
  if (optContent) {
    const m = optContent.match(/^#\s+Agent Note:[^\n]*第([一二三四五六七八九十百]+)期/m);
    if (!m) errors.push('优化计划书标题里读不到「第<中文数字>期」⇒ 期号真源取不到（fail-closed，不猜）');
    else epochCn = m[1];
  }

  /* 编号集合真源 */
  const optNumbers = optContent ? collectPlanNumbers(optContent) : [];
  const expNumbers = expContent ? collectPlanNumbers(expContent) : [];
  const numbers = optNumbers.concat(expNumbers);
  if (numbers.length === 0) {
    errors.push('两份当期计划书里一条 `### R<n>-*` 编号都抽不到 ⇒ 优先级节无从校对（fail-closed）');
  } else {
    const prefixes = new Set(numbers.map((n) => n.replace(/-[OX][0-9]+$/, '')));
    if (prefixes.size > 1) {
      errors.push('当期两份计划书的编号前缀不一致：' + Array.from(prefixes).join(' / ') + '（期号混用）');
    }
    if (optNumbers.length < 9 || expNumbers.length < 9) {
      errors.push('编号数低于本期 9+9：优化 ' + optNumbers.length + ' 条 / 拓展 ' + expNumbers.length + ' 条');
    }
  }

  /* 第一处：PLAN.md 顶部入口（期号 + 日期） */
  if (plan !== null && epochCn && planDate) {
    const need = '第' + epochCn + '期产品计划（' + planDate;
    if (!plan.includes(need)) {
      errors.push('PLAN.md 顶部入口未换挡：应含「' + need + '…」，实测缺（期号/日期与当期计划书不一致）');
    }
  }

  /* 第二处：PLAN.md「## 优先级」节的编号集合 */
  if (plan !== null && numbers.length > 0) {
    const prIdx = plan.indexOf('\n## 优先级');
    if (prIdx < 0) {
      errors.push('PLAN.md 找不到「## 优先级」节（优先级入口消失）');
    } else {
      const rest = plan.slice(prIdx + 1);
      const endAt = rest.search(/\n---\n/);
      const section = endAt >= 0 ? rest.slice(0, endAt) : rest;
      const missing = numbers.filter((n) => !section.includes(n));
      if (missing.length > 0) {
        errors.push('PLAN.md 优先级节缺当期编号 ' + missing.length + ' 个：' + missing.join(' ') + '（旧排序未换挡）');
      }
    }
  }

  /* 第三处：TODO.md 顶部「最近更新」版本号 */
  if (todo !== null) {
    const m = todo.match(/^>\s*\*\*最近更新：v([0-9][0-9.]*)\*\*/m);
    if (!m) {
      errors.push('TODO.md 顶部「> **最近更新：vX**」读不到（入口没有机器可读形态）');
    } else if (m[1] !== String(live.version)) {
      errors.push('TODO.md 顶部最近更新 v' + m[1] + ' ≠ 当版 v' + live.version + '（入口滞后，正是 R13-O7 的立案现象）');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    raw: {
      version: live.version,
      epoch: epochCn,
      date: planDate,
      numbers,
      optFile: entry.optFile,
      expFile: entry.expFile,
    },
  };
}

/** `--write` 侧只写 TODO 的版本号那一格。PLAN 的期号/编号集合只判不写（排序是人做的）。 */
export function writePlanEntries() {
  const live = collectStatus();
  const p = path.join(ROOT, 'TODO.md');
  if (!fs.existsSync(p)) return { ok: false, reason: 'TODO.md 不存在' };
  let todo = fs.readFileSync(p, 'utf8');
  const re = /^>\s*\*\*最近更新：v[0-9][0-9.]*\*\*/m;
  if (!re.test(todo)) return { ok: false, reason: 'TODO.md 顶部没有可写的「最近更新」行（不猜位置）' };
  todo = todo.replace(re, '> **最近更新：v' + live.version + '**');
  fs.writeFileSync(p, todo, 'utf8');
  return { ok: true, version: live.version };
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

  /* R13-O7：射程扩到三处入口（入口不过期，基线表再准也没用 —— 后来者打不开入口） */
  const entryChk = computePlanEntries();
  errors.push(...entryChk.errors);

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
    const eW = writePlanEntries();
    console.log('[tools/gen_plan_baseline] TODO.md 顶部最近更新：' + (eW.ok ? ('已写到 v' + eW.version) : ('未写 —— ' + eW.reason)));
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
    console.log('[tools/gen_plan_baseline] PLAN.md 基线表 + 三处入口（PLAN 顶部期号/日期 · 优先级节编号集合 · TODO 最近更新）均与真源一致。');
  } else {
    const { lines } = computePlanBaseline();
    console.log('当前计算的基线行：');
    console.log(lines.versionLine);
    console.log(lines.gatesLine);
    console.log(lines.volumeLine);
  }
}
