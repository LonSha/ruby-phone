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

/** 从 PLAN.md 顶部入口解析出当期两份计划书链接（只认**第一个**匹配 = 现行入口）。
 *  [v4.118 维护] 路径不以 `.` 开头也必须匹配：此前 `(\.[^\s)]+)` 遇到坏链接
 *  （如 C5 负控制写出的 `BROKEN/...`）会匹配落空，正则继续后扫**静默回退**命中
 *  历史期号的同名链接，把「链接不存在」吞成「期号混用」——坏链接逃过门禁。
 *  修法是放宽捕获、把「路径对不对」交给存在性检查 fail-closed 报红。 */
/* [v4.159 维护] 顶部入口区 = 文件开头那一段「> **第N期产品计划**」，到第一条
 * `> ---` / `---` 分隔线为止。入口链接解析与「顶部是否换挡」的校对**都必须**
 * 限制在段内 —— 段后是历史留档（第 23 期起按此格式留档），里面同样有
 * 「第N期产品计划（日期」「[优化提升九项](...)」这类文本。
 *
 * 这是本仓第三次撞同一个坑（前两次：坏链接静默回退、C5 破坏打在留档行上）：
 *   第二十四期把入口文案从「优化提升九项」简化成「优化九项」，旧正则全文
 *   首匹配落空后继续后扫，命中第 23 期留档行 ⇒ 工具读到的是**已收口的上一期**，
 *   于是「改现行期号」这种真破坏打不红（v4107/C1 实测 r.ok = true）。
 * 修法不是补一个字面量，而是把「哪一段才是现行入口」变成可判定的边界。 */
export function headZoneOf(content) {
  const s = String(content || '');
  const cuts = [];
  const a = s.search(/\n> ---/);
  if (a >= 0) cuts.push(a);
  const b = s.search(/\n---\n/);
  if (b >= 0) cuts.push(b);
  const cut = cuts.length ? Math.min.apply(null, cuts) : s.length;
  return s.slice(0, cut);
}

export function parsePlanEntry(content) {
  const errors = [];
  const head = headZoneOf(content);
  const pick = (re) => {
    const m = head.match(re);
    return m ? m[1] : null;
  };
  /* 入口文案认双形态：现行「[优化九项]」/「[拓展九项]」，历史留档「[优化提升九项]」/
   * 「[拓展创新九项]」。文案是人写的缩写，不该因为改名就让工具罢工；
   * 但**只在顶部区里认**，落空即 fail-closed 报错，绝不回退全文件。 */
  const optFile = pick(/\[(?:优化提升九项|优化九项)\]\(([^)\s]+)\)/);
  const expFile = pick(/\[(?:拓展创新九项|拓展九项)\]\(([^)\s]+)\)/);
  if (!optFile) errors.push('PLAN.md 顶部入口区缺「[优化九项](...)」（旧形态「[优化提升九项](...)」同样认）链接（入口形态丢失）');
  if (!expFile) errors.push('PLAN.md 顶部入口区缺「[拓展九项](...)」（旧形态「[拓展创新九项](...)」同样认）链接（入口形态丢失）');
  return { optFile, expFile, errors };
}

/** 把计划书正文里的编号抽成列表 —— **两代文档形态都认**：
 *  · 旧形态（≤R23）：`### R13-O1 标题`（编号自带期号前缀）
 *  · 新形态（R24 起）：`## O1 · 标题`（编号前缀由文件名派生，不在标题里重复）
 * 前缀一律由调用方从计划书文件名派生，不从标题里猜。
 * fail-closed：两种形态都抽不到就返回空数组，由调用方报错（不许空集当通过）。 */
function collectPlanNumbers(md, epochNum) {
  const out = [];
  let re = /^###\s+(R[0-9]+-[OX][0-9]+)\s/mg;
  let m;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  if (out.length > 0) return out;
  if (!epochNum) return out;
  const P = 'R' + epochNum;
  re = /^##\s+([OX])([0-9]+)\s*[·:：.、]/mg;
  while ((m = re.exec(md)) !== null) out.push(P + '-' + m[1] + String(Number(m[2])));
  return out;
}

/** 中文期号 → 数字（只认「二十四」「九」「十」这类纯数字写法，不猜别的）。
 * 返回 null 表示读不懂 ⇒ 调用方 fail-closed。 */
function fromChineseNum(cn) {
  const D = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const s = String(cn || '');
  if (s === '十') return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? D[m[1]] : 1) * 10 + (m[2] ? D[m[2]] : 0);
  return D[s] === undefined ? null : D[s];
}

/** 现行优先级节正文：从 `## 优先级` 起，到**下一个二级标题**或分隔线为止。
 *  [v4.159] 此前切到第一个 `---`，把「## 历史优先级（第二十三期 …）」也包进来了 ——
 *  于是「现行排序没换挡」可以靠历史节里的同名编号蒙混过关。本期 R23/R24 前缀不同
 *  才没当场炸，换成「改名不改号」的期就会真炸。现行节必须自证，历史节不算数。 */
export function prioritySectionOf(plan) {
  const s = String(plan || '');
  const i = s.indexOf('\n## 优先级');
  if (i < 0) return null;
  const rest = s.slice(i + 1);
  const tail = rest.slice(1);
  const m = tail.match(/\n(?:##\s|---\n)/);
  const end = m ? m.index + 1 : rest.length;
  return rest.slice(0, end);
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
  let epochNum = null;
  let planDate = null;
  if (entry.optFile) {
    const d = entry.optFile.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (!d) errors.push('计划书文件名里读不到日期 ⇒ 日期真源取不到（fail-closed，不猜）');
    else planDate = d[1];
    const v = entry.optFile.match(/-v([0-9]+)\.md$/);
    if (!v) errors.push('计划书文件名里读不到「-v<期号>.md」⇒ 编号前缀取不到（fail-closed，不猜）');
    else epochNum = Number(v[1]);
  }
  if (optContent) {
    /* 只取**首行**：两代标题都认（`# Agent Note:…第X期` / `# 第X期 · …`）。
     * 不在全文里搜，避免正文提到历史期号时读错。 */
    const firstLine = optContent.split('\n', 1)[0] || '';
    const m = firstLine.match(/^#\s+[^\n]*?第([一二三四五六七八九十百]+)期/);
    if (!m) errors.push('优化计划书首行标题里读不到「第<中文数字>期」⇒ 期号真源取不到（fail-closed，不猜）');
    else epochCn = m[1];
  }
  /* 标题期号与文件名期号必须同源：改了标题不改名（或反之）就是两处口径 ——
   * 这种「半截换挡」此前靠「全文 includes」永远看不出来。 */
  if (epochCn && epochNum !== null) {
    const byCn = fromChineseNum(epochCn);
    if (byCn === null) {
      errors.push('计划书标题里的中文期号「第' + epochCn + '期」读不成数字（fail-closed，不猜）');
    } else if (byCn !== epochNum) {
      errors.push('期号两处不一致：标题写「第' + epochCn + '期」= ' + byCn + '，文件名写 v' + epochNum + '（半截换挡）');
    }
  }

  /* 编号集合真源 */
  const optNumbers = optContent ? collectPlanNumbers(optContent, epochNum) : [];
  const expNumbers = expContent ? collectPlanNumbers(expContent, epochNum) : [];
  const numbers = optNumbers.concat(expNumbers);
  if (numbers.length === 0) {
    errors.push('两份当期计划书里一条编号都抽不到（`### R<n>-*` 与 `## O<n> ·` 两代形态皆无）⇒ 优先级节无从校对（fail-closed）');
  } else {
    const prefixes = new Set(numbers.map((n) => n.replace(/-[OX][0-9]+$/, '')));
    if (prefixes.size > 1) {
      errors.push('当期两份计划书的编号前缀不一致：' + Array.from(prefixes).join(' / ') + '（期号混用）');
    }
    if (optNumbers.length < 9 || expNumbers.length < 9) {
      errors.push('编号数低于本期 9+9：优化 ' + optNumbers.length + ' 条 / 拓展 ' + expNumbers.length + ' 条');
    }
  }

  /* 第一处：PLAN.md 顶部入口（期号 + 日期）
   * [v4.159] 只在顶部入口区内校对：此前全文 includes，历史留档行
   *   「第23期产品计划（2026-11-17」会把本该报红的破坏吞掉。 */
  if (plan !== null && epochCn && planDate) {
    const need = '第' + epochCn + '期产品计划（' + planDate;
    if (!headZoneOf(plan).includes(need)) {
      errors.push('PLAN.md 顶部入口未换挡：应含「' + need + '…」，实测缺（期号/日期与当期计划书不一致）');
    }
  }

  /* 第二处：PLAN.md「## 优先级」节的编号集合（只看现行节，历史节不算数） */
  if (plan !== null && numbers.length > 0) {
    const section = prioritySectionOf(plan);
    if (section === null) {
      errors.push('PLAN.md 找不到「## 优先级」节（优先级入口消失）');
    } else {
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
