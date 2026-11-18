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
      ' **总量棘轮的一个已知代价**：把方法体内的一段搬到新模块，会让全仓行数**上涨**（每个切片至少要付函数壳 + 调用点这 6 行），R23-O2 为此涨了 24 行（402654 → 402678）。这不是偷偷长，是切片本身的成本，已写在这里并在提交里可见；要抵消它得靠后续真正删代码，不能靠「不压台账」。' +
      ' **R25-X4/X6 的上涨（381454 → 382634）**：两个新内核落盘 —— config/time-format.js（335 行）与 config/notify-tiers.js（337 行）；其余是「内核必须接到真实消费点」的接线成本：settings-app.js +230（两节控件与绑定）、diagnose-view.js +92、phone-shell.js +29、diagnose-data.js +27、calendar-view.js +16、wechat-app.js +5、phone-view.js +3。这几处正是判据 X4-1/X6-11 要求的「不只交模块」的代价：只写内核不接消费点的方案行数更少，但那是文档写了 ≠ 代码在。压回原位的唯一正当手段是 R25-O1 拆骨（settings-app.js 12795 / chat-view.js 18449），不是把接线删掉。' +
      ' **R25-X5/X9 的上涨（382637 → 383229）**：同样不是偷偷长，是「内核 + 真消费点」四件套的成本 —— config/layout-breaks.js（205 行，三档断点的唯一真源）与 config/story-clock-fanout.js（149 行，剧情钟四面同一次计算）两个新内核，加上必须把它们接到用户看得见的地方：phone-shell.js +59（resize/orientationchange 真监听 + 属性上屏与读回）、diagnose-view.js +96 / diagnose-data.js +43（两张新卡：布局对拍 + 四面与锁屏真 DOM 对拍）、index.js +59（补上缺了很久的 `storyNow` import + 广播与首帧）、lock-screen.js +30（`_nowParts` 从不接钟改为读联动面）、phone.css +51（三档属性选择器；.css 不进本条判据但如实列在这里）。反向的一笔：screen-adaptive-layout-engine.js 由 53 行改成 74 行的**消费者**（旧实现自带一套 768/480/360 阈值与 `Number(w) || 375` 的假默认值，已删）。换言之这轮把「模块在盘」变成「机制在用」，代价就是接线行数；压回原位仍只能靠 R25-O1 拆骨（index.js 15186 / chat-view.js 18449 / settings-app.js 12798），不能靠删接线。' +
       ' **R25-X2 的上涨（383229 → 383754）**：config/time-machine.js（387 行，只读回放内核）落盘，加接线与读回：backupdesk-app.js +68（replayMoment / 机器视图 / 换会话丢态）、backupdesk-view.js +58（时刻按钮 + 四行 + 结论行 + 读回对拍）。这一笔**不碰任何写盘路径**（内核不 import 存储、replayMoment 方法体零写入），所以它换不来行数回落；压回原位仍只能靠 R25-O1 拆骨（index.js 15188 / chat-view.js 18449 / settings-app.js 12798）。' +
       " **R25-O6 的上涨（383754 → 384250）**：config/data-growth.js（342 行，零 import 的占用测量内核）落盘，加接线：backupdesk-app.js +97（measureGrowth 逐键 try storage.get、快照 moments 按 bytesOfValue、预览与增量）、backupdesk-view.js +65（占用榜 + 未归属红字 + 读失败点名 + 预览「会失去什么」）。这一笔全部是「内核 + 真消费点」，没有删任何现有实现，所以净涨；它换来的东西是「读不出 ⇒ unknown，绝不画成 0 字节」与「预览 applied 恒 false」。压回原位仍靠 R25-O1 拆骨（index.js 15188 / chat-view.js 18449 / settings-app.js 12798）。" +
       " **R25-O1 第一刀（384250 → 384259）**：把 chat-view.js 里 6 个零 this 的纯文本解析方法（cleanAbnormalSpaces / _readBracketGroupAt / _parseIncomingCallMarker / _extractQuickReplyPayload / _parseWeiboCommentLine / _parseManualTimeAdvanceCommand，共 129 行）搬到 apps/wechat/chat-text-core.js（158 行），chat-view.js 由 18449 → 18323。顺手收敛了重复：wechat-data.js 里 _readBracketGroupAt 还有一份逐字相同的同源副本（判据 O1-12 当面点名），已删掉 25 行改为消费唯一实现。总量仍微涨 9 行是拆骨本身的手续费（提取件头注 + import + Object.assign 混入），调用点一行未改所以还看不到红利；刀口继续往 index.js 15188 / settings-app.js 12798 推。" +
       " **R25-O2 的上涨（384259 → 384551）**：config/chat-scroll-memory.js（158 行，纯函数台账，零 DOM、零存储、时钟由参数给）落盘，加接线：chat-view.js 18323 → 18457（+134：记账/恢复/绑定/读数上屏四段，加「首次加载贴底要让位给已恢复位置」的让位规则，再把 csmVerdict 真消费进恢复读数）。算术对得上：+158（内核）+ +134（接线）= +292，就是 384259 → 384551 的全部差额，没有第三笔偷偷长出来的东西（index.js +4 的 import 与装配点不在这张台账的扫描面：台账只收 apps/ 与 config/ 下的 .js，这是既有口径）。这一笔换来的不是抽象概念：浏览器层真跑 1 万条消息，切到桌面再回来，scrollTop 5713 → 5713（delta 0），同一个场景改前是 5713 → 11411（被强制贴底顶掉）。压回原位仍靠继续拆 index.js 15188 / settings-app.js 12798。",
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