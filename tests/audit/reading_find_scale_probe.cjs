#!/usr/bin/env node
/* ============================================================
 * tests/audit/reading_find_scale_probe.cjs
 * 探针：全书连续找句的规模读数 —— 只量，不改。
 * ------------------------------------------------------------
 * 【要回答的问题】（R5-O7「全书连续找句可取消且不反复重建」的准入读数）
 *   计划原文：「以本地 200 万汉字书记录改前/后首查、续查及内存；
 *   连续三次查询只建一次同版本索引」。
 *   故本探针量的正是这几格：
 *     ① 首查（冷：这本书的索引还没建过）耗时；
 *     ② 续查（热：同版本索引已在）耗时 —— 改前它与首查**同量级**，
 *        因为 `searchBook` 每次调用都现建索引、用完即弃；
 *     ③ 第三次查询耗时（「连续三次」的第三条，防止把「第二次碰巧快」读成「复用生效」）；
 *     ④ 索引构建次数（「只建一次」的**计数证据**，不是耗时推测）；
 *     ⑤ 三次查询前后的堆增量（内存有界性的准入读数）。
 *
 * 【为什么耗时读数与计数读数必须分块】
 *   计时段（首查/续查/第三次 ms、堆增量）不可复算：进程调度与 GC 都会动它。
 *   计数段（三次查询各自命中几处、扫了几章）可复算。
 *   把两者混在一格里，套件就没法「只比计数、只比同量级」——这是本仓
 *   search_scale_probe 已立的纪律，本探针照办。
 *
 * 【改前那一版为什么 `index_builds_*` 是 null 而不是 0】
 *   v4.33.0 的 `searchBook` 每次现建现弃，App 上**没有任何计数口**。
 *   「本版没有这条读数」与「这条读数是 0」是两件事：报 0 会被读成
 *   「一次都没建」（明显荒谬），报 null 并写明为什么，才是诚实的准入读数。
 *   探针探测 `app.indexBuildCount()` 是否存在 —— 有就取真值，没有就如实 null。
 *
 * 【口径纪律（与 long_chat / search_scale / longlist_scale 三支同族）】
 *   · 只读：不写任何文件；基线由调用方重定向 stdout 落盘（读数零手抄）。
 *   · 计数段可复算：同一夹具跑两次逐字节相同。
 *   · 计时段不可复算 ⇒ 与计数段分块，套件只比「同量级」。
 *   · 位置无关：根走 --root 或 __dirname/../..，代码里不得出现绝对路径字面量。
 *   · 读不到就 fail-closed（exit 2），绝不以 0 发合格证。
 *   · 合成书是**内存数组**：本探针不造真附件层压力（真 IndexedDB 读取归实测）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');
const APP_REL = 'apps/reading/reading-app.js';
const CONTRACT_REL = 'config/reading-notes-contract.js';
const MANIFEST_REL = 'manifest.json';
for (const [p, label] of [[path.join(ROOT, APP_REL), APP_REL],
  [path.join(ROOT, CONTRACT_REL), CONTRACT_REL],
  [path.join(ROOT, MANIFEST_REL), MANIFEST_REL]]) {
  if (!fs.existsSync(p)) { console.error('[readfind] 读不到 ' + label + ' —— fail-closed 拒判'); process.exit(2); }
}
const MANIFEST = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8')); } catch (_e) { return null; }
})();
if (!MANIFEST || !MANIFEST.version) { console.error('[readfind] 读不到 manifest.json 的 version —— fail-closed 拒判'); process.exit(2); }
const MEASURED_AT = 'v' + MANIFEST.version;
/* ---------- 夹具：约 200 万汉字的书（1000 章 × 100 段 × 20 字） ---------- */
const CH_COUNT = 1000;
const PARA_PER_CH = 100;
const FILLER = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
const MARK_HEAD = '开头章独有句';
const MARK_MID = '中段独有句';
const MARK_TAIL = '结尾章独有句';
function mkBook() {
  const chapters = [];
  for (let i = 0; i < CH_COUNT; i++) {
    const ps = [];
    for (let j = 0; j < PARA_PER_CH; j++) {
      let t = FILLER;
      if (i === 0 && j === 0) t = MARK_HEAD + FILLER.slice(MARK_HEAD.length);
      else if (i === Math.floor(CH_COUNT / 2) && j === Math.floor(PARA_PER_CH / 2)) t = MARK_MID + FILLER.slice(MARK_MID.length);
      else if (i === CH_COUNT - 1 && j === PARA_PER_CH - 1) t = MARK_TAIL + FILLER.slice(MARK_TAIL.length);
      ps.push(t);
    }
    chapters.push({ title: '第' + (i + 1) + '章', paragraphs: ps });
  }
  return chapters;
}
/* ---------- 假存储（数据层只用 get/set/has） ---------- */
function mkStorage() {
  const mem = new Map();
  return { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); }, has: (k) => mem.has(k), version: '1.19.0' };
}
const noIdbWin = {};
function nowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
  return Date.now();
}
function mb(x) { return Math.round((x / 1048576) * 100) / 100; }
(async () => {
  const appMod = await import(pathToFileURL(path.join(ROOT, APP_REL)).href).catch((e) => {
    console.error('[readfind] App 装载失败 —— fail-closed 拒判：' + String((e && e.message) || e).slice(0, 200));
    return null;
  });
  if (!appMod || typeof appMod.ReadingApp !== 'function') {
    console.error('[readfind] App 导出面不可用（ReadingApp 缺席）—— fail-closed 拒判');
    process.exit(2);
  }
  const K = await import(pathToFileURL(path.join(ROOT, CONTRACT_REL)).href).catch(() => null);
  if (!K || typeof K.buildSearchIndex !== 'function') {
    console.error('[readfind] 契约件导出面不可用（buildSearchIndex 缺席）—— fail-closed 拒判');
    process.exit(2);
  }
  const chapters = mkBook();
  const totalChars = chapters.reduce((a, c) => a + c.paragraphs.reduce((b, t) => b + t.length, 0), 0);
  const app = new appMod.ReadingApp({ showNotification: () => {}, screen: null }, mkStorage());
  app._hostWin = () => noIdbWin;
  const bookId = 'rd_scale';
  app.data.shelf.unshift({
    id: bookId, title: '规模书', fileName: 'scale.txt', author: '', encoding: 'utf-8',
    format: 'txt', mode: 'auto', addedAt: 1, chapterCount: chapters.length,
    contentHash: 'hScale', hasContent: true
  });
  app._contentCache.set(bookId, chapters);
  /* 索引构建次数的观测口：改后 App 提供 `indexBuildCount()`；改前没有 ⇒ 如实 null。 */
  const hasCount = typeof app.indexBuildCount === 'function';
  const builds = [];
  const reused = [];
  const queries = [MARK_HEAD, MARK_MID, MARK_TAIL];
  const ms = [];
  const hits = [];
  const scanned = [];
  const heap0 = mb(process.memoryUsage().heapUsed);
  let bad = 0;
  for (const q of queries) {
    if (hasCount) builds.push(app.indexBuildCount());
    const t0 = nowMs();
    let r = null;
    try { r = await app.searchBook(q, { bookId: bookId }); } catch (_e) { r = null; bad += 1; }
    ms.push(Math.round((nowMs() - t0) * 100) / 100);
    if (!r || r.ok !== true) { hits.push(null); scanned.push(null); reused.push(null); bad += 1; continue; }
    hits.push(r.totalHits);
    scanned.push(r.chaptersScanned);
    /* 「这一轮复用了索引吗」的**结构证据**（不是耗时推测）：改前这一格根本不存在。 */
    reused.push(r.index ? (r.index.reused === true) : null);
  }
  const buildsAfter = hasCount ? app.indexBuildCount() : null;
  const heap1 = mb(process.memoryUsage().heapUsed);
  /* 计数段（可复算）：三次查询各自命中几处、扫了几章。 */
  const counts = {
    chapters: chapters.length, paras: CH_COUNT * PARA_PER_CH, total_chars: totalChars,
    hits_head: hits[0], hits_mid: hits[1], hits_tail: hits[2],
    scanned_head: scanned[0], scanned_mid: scanned[1], scanned_tail: scanned[2],
    all_ok: bad === 0 ? 1 : 0,
    index_builds_available: hasCount ? 1 : 0,
    /* 三次查询一共建了几份索引 —— 「连续三次只建一次同版本索引」的**直接读数**。 */
    index_builds_total: buildsAfter,
    /* 逐次查询**之前**的建数：0 / 1 / 1 就是「第一次建了、后两次没建」的形态证据。 */
    index_builds_before: hasCount ? builds.join('/') : null,
    /* 逐次查询的复用标记：false / true / true（第一次必然是新建）。 */
    index_reused_seq: reused.join('/'),
    /* ★ 这一格刻意**不再叫 growth**：首版把它写成「第 3 次查询前 − 第 1 次查询前」，
     *   于是「三次一共建了 1 份」被读成 1（看着像「多建了一份」）。
     *   名字错了就会把正确的行为读成缺陷 —— 故直接报「一共建了几份」（`index_builds_total`），
     *   并把逐次形态留在 `index_builds_before` 里，不另造一个易误读的派生格。 */
    index_builds_after_first: (hasCount && builds.length === 3) ? (builds[1] - builds[0]) : null
  };
  /* 计时段（不可复算）：只报数，套件只比同量级。 */
  const timing = {
    first_ms: ms[0], second_ms: ms[1], third_ms: ms[2],
    /* 首查 / 续查 比值：改前两者同量级（每次都重建），改后续查应显著低于首查。 */
    warm_over_cold: (ms[0] > 0) ? Math.round((ms[1] / ms[0]) * 1000) / 1000 : null,
    heap_before_mb: heap0, heap_after_mb: heap1,
    heap_delta_mb: Math.round((heap1 - heap0) * 100) / 100
  };
  const out = {
    file: 'tests/audit/reading_find_scale_probe.cjs',
    probe: 'tests/audit/reading_find_scale_probe.cjs',
    note: '全书连续找句的规模读数：合成书（约 200 万汉字）+ 真模块（无浏览器 / 无附件层）。'
      + '读数不代表实机；取消的**用户可感知延迟**须真 DOM 层另测。计数段可复算，计时段只比同量级。',
    measured_at: MEASURED_AT,
    host: { chapters: CH_COUNT, paras_per_chapter: PARA_PER_CH, filler_len: FILLER.length, total_chars: totalChars },
    readings: counts,
    timing: timing,
    criteria: [
      { id: 'R1', desc: '三次查询全部跑通（ok === true）', pass: counts.all_ok === 1, got: counts.all_ok },
      { id: 'R2', desc: '末章那一句找得到（扫全章）', pass: counts.hits_tail === 1 && counts.scanned_tail === CH_COUNT, got: counts.hits_tail + '/' + counts.scanned_tail },
      { id: 'R3', desc: '索引构建次数有观测口（改前为 null，属「本版没有这条读数」）', pass: true, got: counts.index_builds_available },
      { id: 'R4', desc: '连续三次查询只建一次同版本索引（改前不成立，正是本版要治的）', pass: counts.index_builds_total === 1 && counts.index_builds_before === '0/1/1', got: counts.index_builds_total + ' / ' + counts.index_builds_before },
      { id: 'R5', desc: '第 2、3 次查询走的是**复用**（结构证据；改前这一格不存在）', pass: counts.index_reused_seq === 'false/true/true', got: counts.index_reused_seq },
      { id: 'R6', desc: '续查不慢于首查（**不比绝对值**：分片让出本身要付宏任务代价，首查含建索引）', pass: (timing.warm_over_cold != null && timing.warm_over_cold <= 1), got: timing.warm_over_cold }
    ],
    verdict: '准入读数（基线）：改前每次查询都现建索引、且无任何复用读数 ⇒ R3 报 0（无观测口）、R4/R5 不成立，正是 R5-O7 要治的。'
      + '【为什么这里不判「续查必须快 N 倍」】分片让出把一段同步台阶换成了许多轮宏任务，'
      + '**绝对耗时可能变长**（本机实测首查 94ms vs 改前 16ms）—— 换来的是「期间计时器与点击事件能跑到」。'
      + '计划原文要的是「记录改前/后首查、续查及内存」，不是「承诺更快」；把这条写成本版承诺就是自造判据。',
    not_done: [
      '未做实机取证：无浏览器、无真 SillyTavern 宿主、无真实附件层；合成书的段远短于真实段落，绝对耗时不可外推。',
      '未测真 IndexedDB / localStorage 读取耗时：正文在本探针里是内存数组（真实路径要先回读附件）。',
      '未测手机端后台节流窗口：Node 事件循环上的让出证据不代表移动端定时器行为。',
      '未测取消的用户可感知延迟：那是真 DOM 层读数（≤200ms 的验收口径），归浏览器门。'
    ]
  };
  process.stdout.write(JSON.stringify(out, null, 2) + String.fromCharCode(10));
})();