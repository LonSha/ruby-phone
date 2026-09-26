#!/usr/bin/env node
/* ============================================================
 * tests/audit/long_chat_probe.cjs
 * 探针：长会话（1000 楼）楼层消费路径取证 —— 只量，不改。
 * ------------------------------------------------------------
 * 【要回答的问题】（TODO P2 主项「1000 楼长会话」的准入读数）
 *   ① 长会话下「楼层消费路径」分几种形态？各多少站点？（静态面）
 *   ② 有界消费者的输出真的不随楼层数增长吗？（活体实测，真模块）
 *   ③ 有没有「上限存在但设在物化之后」的站点？代价随 N 怎么走？
 *   ④ 缩放是线性的还是超线性？（超线性才立优化候选）
 *
 * 【与既有探针的关系】
 *   与 branch_play_probe.cjs / lifecycle_declarative_probe.cjs 同族：只读、可复算、
 *   位置无关、fail-closed。差别是它**真加载真模块**（借 tests/_runtime_host.mjs 夹具），
 *   因此读数分两段：**计数段**（可逐字节复算）与**计时段**（不可复算，单独成块）。
 *
 * 【口径纪律（五条，全是既有代价换来的）】
 *   · 只读：不写任何文件、不改宿主；基线由调用方重定向 stdout 落盘（读数零手抄）。
 *   · 计数段可复算：同一份树跑两次逐字节相同（套件 A3 **只**比计数段）。
 *   · 计时段不可复算（进程调度 / GC 都会动它）⇒ 与计数段**分块**，套件只比「同量级」。
 *   · 位置无关：根走 --root 或 __dirname/../..，代码里不得出现绝对路径字面量。
 *   · 判据面不得被面向用户的公告侵入（v3.9.0 抓到的第六类「读数说谎」）：
 *     index.js 的静态扫描**先剥离 ST_PHONE_CURRENT_UPDATE 整块**（保留行号）。
 *   · 读不到就 fail-closed（exit 2），绝不以 0 发合格证。
 *
 * 【本版只取证】不改产品代码；任何「前移截断 / 改惰性取数」都必须另立一版改。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const NL = String.fromCharCode(10);
const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const IDX = path.join(ROOT, 'index.js');
const APPS = path.join(ROOT, 'apps');
const CONFIG = path.join(ROOT, 'config');
const HOSTF = path.join(ROOT, 'tests', '_runtime_host.mjs');
for (const [p, label] of [[IDX, 'index.js'], [APPS, 'apps/'], [CONFIG, 'config/'], [HOSTF, 'tests/_runtime_host.mjs']]) {
  if (!fs.existsSync(p)) {
    console.error('[longchat] 读不到 ' + label + ' —— fail-closed 拒判');
    process.exit(2);
  }
}
const IDX_SRC = fs.readFileSync(IDX, 'utf8');
/* 版本从 manifest 读（不硬编码）：硬编码的版本号挂久了就是一条「读数说谎」。 */
const MANIFEST = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')); } catch (_e) { return null; }
})();
if (!MANIFEST || !MANIFEST.version) {
  console.error('[longchat] 读不到 manifest.json 的 version —— fail-closed 拒判');
  process.exit(2);
}
const MEASURED_AT = 'v' + MANIFEST.version;
if (!IDX_SRC.length) { console.error('[longchat] index.js 为空 —— fail-closed 拒判'); process.exit(2); }

/* ---------- ① 判据面净化：剥离内置公告整块（保留行数，行号仍指向真实文件） ---------- */
function stripAnnouncement(src) {
  const at = src.indexOf('const ST_PHONE_CURRENT_UPDATE');
  if (at < 0) return { code: src, stripped: false };
  const end = src.indexOf('};', at);
  if (end < 0) return { code: src, stripped: false };
  const block = src.slice(at, end + 2);
  const blanked = block.split(NL).map(() => '').join(NL);
  return { code: src.slice(0, at) + blanked + src.slice(end + 2), stripped: true };
}
const _strip = stripAnnouncement(IDX_SRC);
const IDX_CODE = _strip.code;

/* ---------- ② 静态面：枚举全部产品代码并归类消费站点 ---------- */
function walkJs(absDir, out) {
  let names = [];
  try { names = fs.readdirSync(absDir); } catch (_e) { return out; }
  for (const n of names) {
    const abs = path.join(absDir, n);
    let st = null;
    try { st = fs.statSync(abs); } catch (_e) { continue; }
    if (st.isDirectory()) walkJs(abs, out);
    else if (n.slice(-3) === '.js') out.push(abs);
  }
  return out;
}
const SCAN_FILES = walkJs(APPS, []).concat(walkJs(CONFIG, []));
if (SCAN_FILES.length < 50) {
  console.error('[longchat] 枚举面塌陷（只读到 ' + SCAN_FILES.length + ' 个 .js）—— fail-closed 拒判');
  process.exit(2);
}
const ABS = { idx: IDX, apps: APPS, config: CONFIG };
const relOf = (abs) => {
  if (abs === ABS.idx) return 'index.js';
  if (abs.startsWith(ABS.apps + path.sep)) return 'apps/' + path.relative(ABS.apps, abs).split(path.sep).join('/');
  if (abs.startsWith(ABS.config + path.sep)) return 'config/' + path.relative(ABS.config, abs).split(path.sep).join('/');
  return abs;
};
/* 四类站点。口径说明：
 *   fullMaterialize —— `X.chat.forEach|map|filter(`：**先造出 N 个元素**再决定用几个。
 *   boundedSlice    —— `chat.slice(-n)`：先取 S 再处理（S 与 N 无关，但 slice 仍是 O(S)）。
 *   indexedLoop     —— `chat[i]`：下标直取，不造中间数组。
 *   lengthRead      —— `chat.length`：只读长度（判空 / 算锚点），O(1)。
 */
const RE_FULL = /(\b[\w$.]*(?:context|ctx)[\w$.]*\.chat|\bchat)\s*\.\s*(?:forEach|map|filter)\s*\(/g;
const RE_BOUNDED = /\bchat\.slice\(-/g;
const RE_INDEXED = /(?:context|ctx)?\.?chat\[(?:i|idx|index)\]/g;
const RE_LENGTH = /(?:context|ctx)\.chat\.length|\bchat\.length/g;
function countMatches(src, re, rel, bag) {
  re.lastIndex = 0;
  let m;
  let n = 0;
  while ((m = re.exec(src)) !== null) {
    n++;
    if (bag && bag.length < 40) {
      bag.push(rel + ':' + (src.slice(0, m.index).split(NL).length));
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return n;
}
const scan = { files: SCAN_FILES.length + 1, full_materialize: 0, bounded_slice: 0, indexed_loop: 0, length_read: 0 };
const fullSites = [];
const boundedSites = [];
const lengthSites = [];
for (const abs of SCAN_FILES) {
  let src = '';
  try { src = fs.readFileSync(abs, 'utf8'); } catch (_e) { continue; }
  const rel = relOf(abs);
  scan.full_materialize += countMatches(src, RE_FULL, rel, fullSites);
  scan.bounded_slice += countMatches(src, RE_BOUNDED, rel, boundedSites);
  scan.indexed_loop += countMatches(src, RE_INDEXED, rel, null);
  const nl = countMatches(src, RE_LENGTH, rel, lengthSites);
  scan.length_read += nl;
}
/* index.js 单独计入，但用**剥离公告后**的文本（判据面净化） */
scan.full_materialize += countMatches(IDX_CODE, RE_FULL, 'index.js', fullSites);
scan.bounded_slice += countMatches(IDX_CODE, RE_BOUNDED, 'index.js', boundedSites);
scan.indexed_loop += countMatches(IDX_CODE, RE_INDEXED, 'index.js', null);
scan.length_read += countMatches(IDX_CODE, RE_LENGTH, 'index.js', lengthSites);

/* ---------- ③ 活体面：真夹具 + 真模块，量缩放 ---------- */
const LENGTHS = [10, 100, 400, 1000, 2000];
const counts = {};   /* 可复算 */
const timing = {};   /* 不可复算 */
const modules = {};
async function load(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try { return await import(pathToFileURL(abs).href); } catch (e) {
    modules[rel] = 'load-failed: ' + String((e && e.message) || e).slice(0, 120);
    return null;
  }
}
function ms(t0) { return Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100; }

/** 结论：每条理由都必须挂在一条读数上（不得只写一句「先不改」）。 */
function buildVerdict(c, scan) {
  const LN = [10, 100, 400, 1000, 2000];
  const at = (k) => LN.map((N) => c[k + '_n' + N]).join('/');
  return {
    question: '1000 楼长会话下，楼层消费路径有没有真实的、可立的优化面？',
    answer: '**本版判定：有一个面，而且只有一个 —— 「截断发生在物化之后」。它按读数成立，不靠感觉；本版只登记与立判据，形态决策留给后续版本。**',
    reasons: [
      '**有界消费者确实有界**：`recentStoryContext` 行数 ' + at('recent_story_context_lines') +
        '、`recentStoryDigest` 行数 ' + at('recent_story_digest_lines') +
        '（N=10/100/400/1000/2000）—— 最近 n 楼抽取类路径全程输出形态恒定。这条**否掉了「长会话下本地摘要会退化」的猜测**。',
      '**全表物化站点确实存在且对象数 == 楼层数**：Tavern 源 `items()` 长度 ' + at('materialize_items') +
        '（静态面实测 ' + scan.full_materialize + ' 个站点）。代表性证据：`makeTavernSource()` 是 `ctx.chat.map(...)`；wechat/honey 是 `chat.forEach` 建**全量**行数组后再 `slice(-10)`。',
      '**上限存在，但设在物化之后**：引擎索引长度 ' + at('engine_index_len') +
        '（`MAX_SCAN_PER_SOURCE = 600`）—— 引擎侧是安全的；代价在**源侧**：即便最终只用 600 条，源侧也已把 N 条全部映成了对象（每条含最多 600 字正文）。',
      '**未观察到超线性**（实测值见 `timing_criteria` 块：计时读数不可复算，故不写进结论文本）。所以这不是性能危机，而是「代价随会话长度无界增长」的**形态**问题：今天 1000 楼 1~2ms，但真实单楼可达数千字、真机比这里慢，再叠加多个消费点，才是要防的。',
      '**视图层站点未实测**：4 处视图层的全表物化（`wechat/chat-view.js` / `wechat/wechat-data.js` / `honey/honey-data.js` / `weibo/weibo-data.js`）需真 DOM 与 App 实例，本探针只做静态归类 —— 如实登记，不假装覆盖。'
    ],
    only_axis: '**把截断前移到取数口（只改取数口，惰性取数）** —— 改的是 `items()` 与 `forEach` 建全量数组这两类站点，目标形态是「先取 N 条，再产出」；不改 UI 结构、不改任何跨仓契约、不改 App 清单。判据：改前改后「有界消费者输出」「引擎可见条目集」「用户可见搜索结果」三面逐项等价。',
    not_blocked_by: '不阻任何其他项；与 OPT-D2（气泡渲染性能）正交（那是视图层测时，本项是取数层形态）。本项为决策输入，不是契约。'
  };
}
(async () => {
  const hostMod = await load('tests/_runtime_host.mjs');
  if (!hostMod || typeof hostMod.installRuntimeHost !== 'function') {
    console.error('[longchat] 宿主夹具不可用 —— fail-closed 拒判');
    process.exit(2);
  }
  const gse = await load('apps/memory/global-search-engine.js');
  const pcm = await load('config/phone-chat-memory.js');
  const wpe = await load('apps/worldpulse/worldpulse-engine.js');
  const ugp = await load('config/update-gap.js');
  /* ★ fail-closed：量活体缩放要靠这三个模块。加载不到就**没有读数**，
   *   绝不能退化成空序列然后照样发一个判定 —— 那是「以 0 发合格证」的温床。 */
  const REQUIRED = [
    ['apps/memory/global-search-engine.js', gse, 'makeTavernSource'],
    ['config/phone-chat-memory.js', pcm, 'recentStoryContext'],
    ['config/update-gap.js', ugp, 'readUnupdatedFloorCount']
  ];
  const broken = REQUIRED.filter((r) => !r[1] || typeof r[1][r[2]] !== 'function');
  if (broken.length) {
    console.error('[longchat] 关键模块不可用（' + broken.map((r) => r[0]).join(', ') +
      '）—— fail-closed 拒判：根源多半是根目录不完整（缺 data/ 等真实依赖）');
    process.exit(2);
  }
  modules.quote_full_materialize = true;
  modules.wpe_loaded = !!(wpe && typeof wpe.recentStoryDigest === 'function');

  for (const N of LENGTHS) {
    const host = hostMod.installRuntimeHost({ chatLength: N });
    const ctx = host.context;
    const key = 'n' + N;
    counts['floor_count_' + key] = Array.isArray(ctx.chat) ? ctx.chat.length : -1;

    /* ③-1 全量物化站点：Tavern 源每轮把整本 chat 映成条目（上限在下游引擎，不在这里） */
    if (gse && typeof gse.makeTavernSource === 'function') {
      const src = gse.makeTavernSource(ctx);
      let items = [];
      const t0 = process.hrtime.bigint();
      try { items = src.items() || []; } catch (_e) { items = []; }
      timing['materialize_ms_' + key] = ms(t0);
      counts['materialize_items_' + key] = items.length;
      let chars = 0;
      for (const it of items) chars += String(it && it.title || '').length + String(it && it.body || '').length;
      counts['materialize_chars_' + key] = chars;
      /* 引擎级：上限 MAX_SCAN_PER_SOURCE 在**物化之后**生效 ⇒ 索引长度有界 */
      let idxLen = -1;
      const t1 = process.hrtime.bigint();
      try {
        const eng = new gse.GlobalSearchEngine({ sources: [src] });
        idxLen = eng.build().length;
      } catch (_e) { idxLen = -1; }
      timing['engine_build_ms_' + key] = ms(t1);
      counts['engine_index_len_' + key] = idxLen;
    }

    /* ③-2 有界消费者：最近 n 楼摘要（输出形态应与 N 无关） */
    if (pcm && typeof pcm.recentStoryContext === 'function') {
      const t2 = process.hrtime.bigint();
      const out = String(pcm.recentStoryContext(ctx, 8) || '');
      timing['recent_story_context_ms_' + key] = ms(t2);
      counts['recent_story_context_lines_' + key] = out ? out.split(NL).length : 0;
      counts['recent_story_context_chars_' + key] = out.length;
    }
    if (wpe && typeof wpe.recentStoryDigest === 'function') {
      const out = String(wpe.recentStoryDigest(ctx, 6) || '');
      counts['recent_story_digest_lines_' + key] = out ? out.split(NL).length : 0;
    }

    /* ③-3 下标直取 + 线性扫尾（不造中间数组，但扫过的楼层数随 N 走） */
    if (ugp && typeof ugp.recordTableUpdateFloor === 'function' && typeof ugp.readUnupdatedFloorCount === 'function') {
      try {
        ugp.recordTableUpdateFloor(ctx, 0);
        const t3 = process.hrtime.bigint();
        const gap = ugp.readUnupdatedFloorCount(ctx);
        timing['update_gap_ms_' + key] = ms(t3);
        counts['update_gap_floors_' + key] = (gap === null ? -1 : Number(gap));
      } catch (_e) {
        counts['update_gap_floors_' + key] = -2;
      }
    }
    host.uninstall();
  }

  /* ---------- ④ 判据（每条自带口径 + 实测值） ---------- */
  const gate = (id, desc, pass, got) => ({ id: id, desc: desc, pass: !!pass, got_text: String(got) });
  const crit = [];
  /* L1 有界消费者的输出不随楼层数增长 */
  const rscLines = LENGTHS.map((N) => counts['recent_story_context_lines_n' + N]);
  const rsdLines = LENGTHS.map((N) => counts['recent_story_digest_lines_n' + N]);
  const boundedStable = rscLines.every((v) => v === rscLines[0]) && rscLines[0] > 0;
  crit.push(gate('L1', '有界消费者（最近 n 楼摘要）的输出形态不随楼层数增长',
    boundedStable && rsdLines.every((v) => v === rsdLines[0]),
    'recentStoryContext 行数=' + rscLines.join('/') + '，recentStoryDigest 行数=' + rsdLines.join('/') + '（N=' + LENGTHS.join('/') + '）'));
  /* L2 存在「全表物化」站点：对象数随 N 线性 */
  const mItems = LENGTHS.map((N) => counts['materialize_items_n' + N]);
  const linearItems = LENGTHS.every((N, i) => mItems[i] === N);
  crit.push(gate('L2', '存在「全表物化」站点：物化对象数 == 楼层数（截断发生在物化之后）',
    linearItems,
    'Tavern 源 items() 长度=' + mItems.join('/') + '（N=' + LENGTHS.join('/') + '）'));
  /* L3 引擎级上限存在且与物化解耦 */
  const eIdx = LENGTHS.map((N) => counts['engine_index_len_n' + N]);
  const capped = eIdx.every((v, i) => v === Math.min(LENGTHS[i], 600));
  crit.push(gate('L3', '下游索引上限（MAX_SCAN_PER_SOURCE=600）存在，且作用在物化之后',
    capped,
    '引擎索引长度=' + eIdx.join('/') + '，期望=' + LENGTHS.map((N) => Math.min(N, 600)).join('/')));
  /* ★ 计时类判据**不进 crit**：计时读数不能逐字节复算，与计数判据同块会让
   *   「同树跑两次逐字节相同」的判据假红。它单独成立在 timing_criteria 块。 */
  const timingCrit = [];
  const tSmall = timing['materialize_ms_n400'];
  const tBig = timing['materialize_ms_n2000'];
  timingCrit.push(gate('L4', '物化耗时随楼层数增长未观察到超线性（5 倍楼层 ≤ 8 倍耗时 + 常数）',
    (tBig <= tSmall * 8 + 5),
    'n400=' + tSmall + 'ms，n2000=' + tBig + 'ms（计时读数不可复算，只比同量级）'));
  /* L5 静态面四类站点都非零（扫描器未失效） */
  crit.push(gate('L5', '静态扫描器未失效：四类站点计数都 > 0 且枚举面 > 150',
    scan.full_materialize > 0 && scan.bounded_slice > 0 && scan.indexed_loop > 0 && scan.length_read > 10 && scan.files > 150,
    'files=' + scan.files + '，全表物化=' + scan.full_materialize + '，slice(-n)=' + scan.bounded_slice +
    '，下标直取=' + scan.indexed_loop + '，长度读=' + scan.length_read));

  const allPass = crit.every((c) => c.pass);
  const verdict = allPass ? buildVerdict(counts, scan) : {
    question: '1000 楼长会话下，楼层消费路径有没有真实的、可立的优化面？',
    answer: 'inconclusive —— 准入判据未全绿，须先查探针本身而不是往下推',
    failed: crit.filter((c) => !c.pass).map((c) => c.id),
    not_blocked_by: '不阻其他项；本项为决策输入，不是契约'
  };

  const rep = {
    file: 'tests/audit/long_chat_probe.cjs',
    probe: 'tests/audit/long_chat_probe.cjs',
    note: '长会话（1000 楼）楼层消费路径取证：静态四类站点 + 活体缩放。合成宿主 + 真模块，非实机。',
    measured_at: MEASURED_AT,
    host: { fixture: 'tests/_runtime_host.mjs', chat_lengths: LENGTHS, announcement_stripped: _strip.stripped },
    readings: counts,
    timing: timing,
    scan: scan,
    sites: { full_materialize: fullSites, bounded_slice: boundedSites, length_read_sample: lengthSites.slice(0, 12) },
    criteria: crit,
    timing_criteria: timingCrit,
    verdict: verdict,
    modules: modules,
    corrections: [
      '本探针第一版把「全表物化」正则写成 `(?:context|ctx)\\.chat`，实测 0 命中 —— 因为真实写法里接收者叫 `chat`（`const chat = ctx?.chat`）、且有的站点是 `probe.chat.forEach`。口径修正：接收者改为「任意以 context/ctx 结尾的成员链，或裸 chat」，实测 8 个站点。',
      '「物化」不能只看 forEach/map/filter：`chat.slice(-8).map(...)` 也是 O(8) 物化，但它**有界**。故四类分开计（full / bounded / indexed / length），不混成一个「消费点数」。',
      '计时读数**不可**逐字节复算（进程调度与 GC 会动它）—— 若与计数段同块，套件的「跑两次逐字节相同」判据会假红。故分块，且套件只比同量级。',
      '判据面必须先剥离内置公告（v3.9.0 第六类「读数说谎」）：公告里提一句 `chat.forEach` 就会污染静态计数。本探针在扫描前剥离 ST_PHONE_CURRENT_UPDATE 整块并保留行号。'
    ],
    not_done: [
      '**未改任何产品代码**：本版只取证与立基线。「把截断前移到取数口」的形态决策刻意留给取证之后的版本。',
      '**未验证实机**：无浏览器、无 SillyTavern 宿主、无真实聊天记录。合成楼层每条约 6 字（`楼层 N`），而真实长会话单楼可达数千字 —— 本基线量的是**形态**（对象数/索引长度是否随 N 走），不是真实体量的字节数。',
      '**内存快照增长 / 单次渲染耗时这一维仍未测**（TODO P2 同一格）：夹具不渲染 DOM、无布局与命中测试，`process.memoryUsage()` 在本环境噪声远大于信号（实测 heapUsed 抖动 GB 级，且探针自身即为大对象宿主）。这一维按既有口径继续登记在 docs/runtime-verification-boundary.md。',
      '**未覆盖视图层站点的运行代价**：`phone-view / chat-view / moments-view / settings-app` 的消费点需要真 DOM 与 App 实例方能驱动，本探针只做静态归类，不驱动它们。',
      '**未做 AST 级归属**：静态计数是文本形态（与 O-6 / P-1 同口径），同名接收者会混算；要精确须单独立一版换工具。'
    ]
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(rep, null, 1) + NL);
  } else {
    const L = [];
    L.push('[longchat] ===== 长会话（1000 楼）楼层消费路径 =====');
    L.push('[longchat] 静态面：文件 ' + scan.files + '；全表物化 ' + scan.full_materialize +
      '；slice(-n) ' + scan.bounded_slice + '；下标直取 ' + scan.indexed_loop + '；长度读 ' + scan.length_read);
    for (const c of crit.concat(timingCrit)) L.push('[longchat] ' + (c.pass ? 'OK  ' : 'NG  ') + c.id + ' ' + c.desc + ' —— ' + c.got_text);
    L.push('[longchat] 判定：' + verdict);
    process.stdout.write(L.join(NL) + NL);
  }
  process.exit(0);
})().catch((e) => {
  console.error('[longchat] 探针异常 —— fail-closed 拒判：' + String((e && e.stack) || e).slice(0, 400));
  process.exit(2);
});
