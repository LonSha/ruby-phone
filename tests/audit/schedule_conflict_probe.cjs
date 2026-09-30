#!/usr/bin/env node
/* ============================================================
 * tests/audit/schedule_conflict_probe.cjs
 * 探针：F-4「剧情日程冲突（与地点层级 / 在场面的冲突判定）」可行性取证 —— 只量，不拆。
 * ------------------------------------------------------------
 * 【要回答的问题】
 *   ① 上游有没有「日程 / 时刻表」外供面？（要接的面到底存不存在）
 *   ② 上游有没有「按时刻 / 按日程」的维度？（deadline 之外还有没有时间轴）
 *   ③ 上游对「冲突判定」这件事的态度是什么？（它自己给不给判定）
 *   ④ 下游现在已经消费到什么？（增量到底有多大）
 *
 * 【口径纪律】
 *   · 只读：不写任何文件；
 *   · 可复算：同一份树跑两次读数逐字节相同（套件 A3）；
 *   · **位置无关**：不得把兄弟仓绝对路径写死在断言里（上游 v3.204.0 的纪律：
 *     路径依赖的绿只在一台机器上成立）。上游复核走 `--upstream <dir>` 或环境变量
 *     `RP_UPSTREAM_ROOT`，**不传就不复核**（冻结证据以基线为准）；
 *   · 读不到就 fail-closed（exit 2）。
 *
 * 【与 lifecycle_declarative_probe 的分工】同款：本探针回答「面存不存在、增量多大」，
 *   不进 npm run check，由 tests/system-v325.test.mjs 拉起。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const S = '[ ' + BS + 't]';

const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const UPSTREAM = argVal('--upstream') || process.env.RP_UPSTREAM_ROOT || null;
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const idxPath = path.join(ROOT, 'index.js');
const appsDir = path.join(ROOT, 'apps');
if (!fs.existsSync(idxPath) || !fs.existsSync(appsDir)) {
  console.error('[schedule] 读不到 index.js 或 apps/ —— fail-closed 拒判');
  process.exit(2);
}
const IDX = fs.readFileSync(idxPath, 'utf8');
if (!IDX.length) { console.error('[schedule] index.js 为空 —— fail-closed 拒判'); process.exit(2); }

/* ── 文件枚举（apps/** + config/** 的 .js） ── */
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
  console.error('[schedule] 枚举面只扫到 ' + files.length + ' 个文件（低于下限 40）—— fail-closed 拒判');
  process.exit(2);
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/* ── ① 下游：承诺期限/状态的消费点 ── */
/* ★ 口径修正（v3.22.0 复校）：`deadline` 必须带**词边界**。
 *   裸词子串匹配会把与上游承诺无关的同族私名一起吃进来 —— 本仓实例：
 *   `apps/focus/focus-app.js` 的私有运行态字段 `_deadline`（番茄钟倒计时时刻，10 处）
 *   被算成「消费上游承诺期限」，读数 26 → 36 点 / 6 → 7 文件（**漂亮的假涨**）。
 *   本探针要量的是「下游有没有在消费上游 promises 的 deadlineFloor」，
 *   倒计时字段与之毫无关系。故 `deadline` 只认**独立标识符**（前一位不得为标识符字符）；
 *   `deadlineFloor` 由它自己的 token 命中（本就单列）。 */
const CONSUME_TOKENS = [
  { tok: 'deadlineFloor', re: /deadlineFloor/ },
  { tok: 'deadline', re: /(?:^|[^A-Za-z0-9_$])deadline(?!Floor)/ },
  { tok: 'promises', re: /promises/ }
];
/* ★ 块注释也算注释（v3.22.0 复校）：探针口径写的是「注释行不计」，但原实现只跳过 `//`，
 *   于是 `/* … 倒计时显示走 deadline。 *`` 这类**块注释散文**被算成消费点（残余 1 点）。
 *   匹配前先把块注释整段抹白（保留换行 ⇒ 行号不变），任何文件的注释散文都不再计入。 */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}
const consumePoints = [];
for (const f of files) {
  const src = stripBlockComments(fs.readFileSync(f, 'utf8'));
  const lines = src.split(NL);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.slice(0, 2) === '//') continue;
    for (const spec of CONSUME_TOKENS) {
      if (spec.re.test(lines[i])) { consumePoints.push({ file: rel(f), line: i + 1, token: spec.tok }); break; }
    }
  }
}
const consumeFiles = [...new Set(consumePoints.map((p) => p.file))].sort();

/* ── ② 下游：确认没有本地「日程引擎」（否则 F-4 就是接自己） ── */
const ENGINE_TOKENS = ['scheduleEngine', 'timetableEngine', 'conflictEngine', '日程引擎'];
const engineHits = [];
/* ★ 性能纪律：`IDX.split(NL)` 必须**只算一次** —— 首版把它写在 for 的条件与体内，
 *   于是 13k 行的 index.js 每次迭代都重切一次（O(n²)）。实测后果：单次探针 ~24 秒，
 *   套件里探针被拉起四次 ⇒ 96 秒、且超过上游可接受的门禁时长。
 *   读数**完全不变**（同一份文本、同一套判据），只是不再重复切分。 */
const idxLines = IDX.split(NL);
for (let i = 0; i < idxLines.length; i++) {
  const l = idxLines[i];
  for (const tok of ENGINE_TOKENS) if (l.indexOf(tok) >= 0) engineHits.push({ file: 'index.js', line: i + 1, token: tok });
}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(NL);
  for (let i = 0; i < lines.length; i++) {
    for (const tok of ENGINE_TOKENS) if (lines[i].indexOf(tok) >= 0) engineHits.push({ file: rel(f), line: i + 1, token: tok });
  }
}

/* ── ③ 上游复核（可选，位置无关） ── */
const UP = { checked: false, root: UPSTREAM, scheduleFaceKeys: 0, deadlineOnly: null, coPresenceConflictFields: null, note: null };
if (UPSTREAM && fs.existsSync(UPSTREAM)) {
  UP.checked = true;
  const upIdx = path.join(UPSTREAM, 'index.js');
  const upGit = path.join(UPSTREAM, '.git');
  UP.isRepo = fs.existsSync(upGit);
  UP.hasIndex = fs.existsSync(upIdx);
  if (UP.hasIndex) {
    const u = fs.readFileSync(upIdx, 'utf8');
    /* ① 日程 / 时刻表**外供面**：只认「对象键形态」（`schedule:` / `'timetable':`），
     *    不认裸子串 —— 实测裸子串会把内部调度器 `_scheduleFloorHeal(f)`（周期调度纯函数）
     *    误报成「上游有日程面」。判据必须匹配真实书写。 */
    const FACE_KEYS = ['schedule', 'timetable', 'agenda', 'calendarFace', 'dayPlan'];
    const keyHits = [];
    for (const k of FACE_KEYS) {
      const re = new RegExp('(?:^|[^A-Za-z0-9_$])' + k + "[ ]*:[ ]*(?:[^:=]|$)");
      if (re.test(u)) keyHits.push(k);
    }
    UP.scheduleFaceKeys = keyHits.length;
    UP.scheduleKeyHits = keyHits;
    /* ② 时间维度：只认 deadlineFloor（楼层维），无时刻维 */
    UP.deadlineOnly = u.indexOf('deadlineFloor') >= 0 && u.indexOf('scheduledAt') < 0 && u.indexOf('dueTime') < 0;
    /* ③ coPresence 面不得含冲突/紧张度字段（上游 v3.232.0 的纪律）
     *    ★ 只在 **coPresence 函数体**里搜，不在整文件里搜 —— 实测整文件搜会把
     *      `observationNotes()` 里的 T16/T17 自述字段 `severity: 'observation'`
     *      误报成「coPresence 面含判断字段」。范围粒度错会造成假阳性。 */
    const FORBIDDEN = ['conflictLevel', 'tension', 'severity'];
    const sb = path.join(UPSTREAM, 'scene-book.js');
    const sbSrc = fs.existsSync(sb) ? fs.readFileSync(sb, 'utf8') : '';
    if (sbSrc) {
      const at = sbSrc.indexOf('coPresence(');
      let body = '';
      if (at >= 0) {
        const open = sbSrc.indexOf('{', at);
        let depth = 0;
        for (let j = open; j < sbSrc.length; j++) {
          if (sbSrc[j] === '{') depth += 1;
          else if (sbSrc[j] === '}') { depth -= 1; if (depth === 0) { body = sbSrc.slice(at, j + 1); break; } }
        }
      }
      UP.coPresenceBodyFound = body.length > 0;
      UP.coPresenceConflictFields = body ? FORBIDDEN.filter((f) => body.indexOf(f) >= 0).length : null;
    } else {
      UP.coPresenceConflictFields = null;
    }
  } else {
    UP.note = '上游 index.js 不存在于指定根';
  }
} else {
  UP.note = '未指定上游根（--upstream / RP_UPSTREAM_ROOT），跳过复核；冻结证据以基线为准';
}

/* ── 四判据 + 判定 ── */
const crit = [
  { id: 'R1', desc: '上游存在「日程 / 时刻表」外供面', pass: UP.checked ? (UP.scheduleFaceKeys > 0) : false,
    got: UP.checked ? String(UP.scheduleFaceKeys) : '未复核（冻结证据：0）', gotText: UP.checked ? (UP.scheduleFaceKeys + ' 个候选键命中') : '0 个候选键命中（冻结）' },
  { id: 'R2', desc: '上游承诺面存在「按时刻」维度（非仅楼层）', pass: UP.checked ? (UP.deadlineOnly === false) : false,
    got: String(UP.deadlineOnly), gotText: 'deadlineFloor 在场 / scheduledAt·dueTime 缺席 ⇒ 只有楼层维' },
  { id: 'R3', desc: '上游把「冲突判定」留给下游（它的读数面不含判断字段）', pass: UP.checked ? (UP.coPresenceConflictFields === 0) : null,
    got: String(UP.coPresenceConflictFields), gotText: UP.checked ? (UP.coPresenceConflictFields === 0 ? 'coPresence 函数体内零冲突字段（判断被刻意排除）' : 'coPresence 函数体内发现判断字段（' + UP.coPresenceConflictFields + ' 个）') : '未复核（冻结证据：0）' },
  { id: 'R4', desc: '下游已消费承诺的期限 / 状态（增量基础已存在）', pass: consumeFiles.length >= 1,
    got: String(consumeFiles.length), gotText: consumeFiles.length + ' 个文件在消费' }
];
/* 判定：R1 不成立 ⇒ 要接的面不存在 ⇒ not_now（不是不做，是现在没有「日程」这东西可冲突） */
const verdict = (crit[0].pass === false) ? 'not_now' : (crit.every((c) => c.pass) ? 'go' : 'not_now');

const report = {
  filesScanned: files.length,
  consumeFiles: consumeFiles,
  consumePoints: consumePoints.length,
  localEngineHits: engineHits.length,
  upstream: UP,
  criteria: crit,
  verdict: verdict
};

if (JSON_MODE) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log('[schedule] ===== F-4 剧情日程冲突可行性 =====');
console.log('[schedule] ① 下游枚举面：' + files.length + ' 个 .js（apps/** + config/**）');
console.log('[schedule] ② 承诺期限/状态消费：' + consumePoints.length + ' 个点 / ' + consumeFiles.length + ' 个文件' +
  (consumeFiles.length ? '：' + consumeFiles.join(' · ') : ''));
console.log('[schedule] ③ 下游本地日程引擎：' + engineHits.length + ' 处（0 = F-4 不是「接自己」）');
console.log('[schedule] ④ 上游复核：' + (UP.checked ? '已跑（' + (UP.isRepo ? 'git 仓' : '非 git 目录') + '）' : '跳过 —— ' + UP.note));
console.log('[schedule] ⑤ 判定：');
for (const c of crit) console.log('[schedule]    ' + c.id + ' ' + (c.pass === true ? '✓' : (c.pass === null ? '?' : '✗')) + ' ' + c.desc + ' —— ' + c.gotText);
console.log('[schedule] ⇒ ' + verdict);
process.exit(0);
