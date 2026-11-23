/* ============================================================
 * tools/gen_app_ledger.mjs — App 重构台账**生成器**
 * ------------------------------------------------------------
 * 为什么需要这个文件：
 *   「20 版 60 只 App 重构」这个标题从 v4.191.0 起沿用了 8 个版本，
 *   但仓里**从来没有一份文件定义过「60 只」是哪 60 只**。
 *   磁盘实读是：`apps/` 下 **101 个目录**、`config/apps.js` 里 **105 条 id**。
 *   「60」是一个**没有出处的数**（v4.199.0 回改时定位确认）。
 *
 * 本工具把「App 重构进度」从散文变成机器可读的一份账，每个数都从磁盘现读。
 * 判据（tests/system-v4199.test.mjs）import 本文件的 collectAppLedger()，
 * 不重写取数逻辑 —— 两份取数必然漂移，漂移的后果是同一个读数在两处显示成不同结论。
 *
 * 三条纪律（与 tools/gen_status_ledger.mjs 同源）：
 *   ① **未知不报 0**：数不出来一律 null，并在 unknown[] 里写为什么；
 *   ② **声明面为真源**：一个 App 是否算「已重构」，只认本文件声明的判据，
 *      不猜「看起来像」；
 *   ③ **目录 ≠ App**：`apps/` 下的目录不全是 App（实测 8 个目录是内核散件，
 *      没有对应 id），`config/apps.js` 的 id 也不全有独立目录
 *      （实测 12 个是重构产出的子 App）。两本账分开记，不许合成一个数。
 *
 * 用法：
 *   node tools/gen_app_ledger.mjs            # 打印 JSON 到 stdout
 *   node tools/gen_app_ledger.mjs --write    # 写入 tests/audit/app-refactor-ledger.json
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/**
 * 「已重构」的判据（**声明面，唯一口径**）：
 *   该 App 目录下存在至少一个 `*-core.js` 文件。
 *   这是 v4.191.0 立下的四件套第一件（纯函数内核 + 控制器 + 视图 + 样式），
 *   也是全仓可静态判定的那一格。
 *
 * 这个判据的**已知边界**（写在这里，不许后来者当成「已验收」）：
 *   它只证明「内核抽出来了」，**不证明**行为等价、不证明接线完整、
 *   更不证明真机上跑对。等价性与接线由各版本自己的判据管。
 */
export const REFACTORED_MARKER = '-core.js';

/** 列目录下的 .js 文件（不含子目录）。 */
function listJs(dirAbs) {
  try { return fs.readdirSync(dirAbs).filter((n) => n.endsWith('.js')).sort(); }
  catch (_e) { return []; }
}

/** 递归统计一个目录的 .js 文件数与总物理行数。 */
function measure(dirAbs) {
  let files = 0;
  let lines = 0;
  const stack = [dirAbs];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch (_e) { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      files += 1;
      try { lines += fs.readFileSync(p, 'utf8').split('\n').length; }
      catch (_e) { /* 读不到的文件不计行数，但计入文件数（两个数不许互相冒充） */ }
    }
  }
  return { files, lines };
}

/**
 * 现场取数。返回一份可序列化的账。
 *
 * 三本账分开记（不许合成一个「App 总数」）：
 *   · dirs      ：`apps/` 下的目录（磁盘实读）
 *   · ids       ：`config/apps.js` 的 id 条数
 *   · overlap   ：两边都在的（真 App）
 *   · dir_only  ：有目录无 id（内核散件，不是独立 App）
 *   · id_only   ：有 id 无目录（重构产出的子 App）
 */
export function collectAppLedger() {
  const unknown = [];
  const appsDir = path.join(ROOT, 'apps');
  let dirNames = null;
  try {
    dirNames = fs.readdirSync(appsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (_e) {
    unknown.push('apps/ 读不到，目录清单为 null');
    dirNames = [];
  }

  /* ── config/apps.js 的 id 条数 ──
   * 口径与 tools/gen_status_ledger.mjs 的 scale.apps_ids 一致：
   *   只数 `^\s*id:\s*'` 行首形（那条正则同时被浏览器场景 A1 用）。
   *   两处取数必须同源，否则「101 个目录 / 105 条 id」这句话自己在两处打架。 */
  let ids = null;
  let idList = null;
  try {
    const src = fs.readFileSync(path.join(ROOT, 'config/apps.js'), 'utf8');
    idList = (src.match(/^\s*id:\s*'([^']+)'/gm) || [])
      .map((line) => (/^\s*id:\s*'([^']+)'/.exec(line) || [])[1]);
    ids = idList.length;
    if (ids === 0) { ids = null; unknown.push('config/apps.js 里 id 条数解析为 0（口径可能变了），如实记 null'); }
  } catch (_e) {
    unknown.push('config/apps.js 读不到，id 条数为 null');
  }

  /* ── 逐目录实读 ── */
  const dirSet = new Set(dirNames);
  const rows = dirNames.map((name) => {
    const abs = path.join(appsDir, name);
    const js = listJs(abs);
    const cores = js.filter((n) => n.endsWith(REFACTORED_MARKER));
    const m = measure(abs);
    return {
      dir: name,
      js_files: m.files,
      js_lines: m.lines,
      core_files: cores,
      refactored: cores.length > 0,
      has_app_id: idList ? idList.includes(name) : null,
    };
  });

  const refactored = rows.filter((r) => r.refactored);
  const pending = rows.filter((r) => !r.refactored);

  return {
    schema: 'app-refactor-ledger@1',
    generated_by: 'tools/gen_app_ledger.mjs',
    /* 判据口径的唯一声明处 —— 后来者改这里，判据跟着变，不许只改一处 */
    refactor_marker: REFACTORED_MARKER,
    refactor_marker_note: '已重构 = 该 App 目录下存在至少一个 *-core.js（四件套第一件）。' +
      'js_lines 为该目录全部 .js 行数合计，不是单个文件；settings 的 config/phone-color-face.js 属跨 App 复用纯函数族，与 apps/<dir>/*-core.js 不同层，不计入本判据。'
      + '只证明内核抽出，不证明行为等价 / 接线完整 / 真机跑对',
    scale: {
      app_dirs: dirNames === null ? null : dirNames.length,
      apps_ids: ids,
      /* 两本账的差不许合成一个数，但可以把差集列出来供人看。
       * ★ dir_only 必须拿 idList 比，不是拿 dirSet 比自己（那恒为空数组，是假账）；
       *   id_only 同理，必须拿真清单比。两个差集都是磁盘实读。 */
      dir_only: idList ? dirNames.filter((d) => !idList.includes(d)) : null,
      id_only: idList ? idList.filter((i) => !dirSet.has(i)) : null,
    },
    counts: {
      refactored: refactored.length,
      pending: pending.length,
      total_dirs: rows.length,
    },
    refactored_dirs: refactored.map((r) => r.dir),
    pending_dirs: pending.map((r) => r.dir),
    rows,
    unknown,
    unknown_count: unknown.length,
  };
}

/* ── CLI ── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = collectAppLedger();
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    const dest = path.join(ROOT, 'tests/audit/app-refactor-ledger.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    console.log(`[app-ledger] 已写入 ${path.relative(ROOT, dest)} —— 目录 ${out.counts.total_dirs} / 已重构 ${out.counts.refactored} / 待重构 ${out.counts.pending} / unknown=${out.unknown_count}`);
  } else {
    process.stdout.write(text);
  }
}
