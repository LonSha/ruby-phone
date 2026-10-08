/* ============================================================
 * tests/browser/gate.mjs — L4 浏览器层的**总门禁**
 * ------------------------------------------------------------
 * 与 run-scenario.mjs 的分工（别搞混）：
 *   · run-scenario.mjs 是**单次驱动**：给几个场景就跑那几个，读数打在屏上，
 *     供人调试与取证用；它不承诺覆盖面。
 *   · 本文件是**门**：它把「覆盖面」本身也变成读数 —— 跑了几档视口、几个场景、
 *     多少条判据，任何一项低于下限就**拒判**（exit 2），而不是「跑少了也算绿」。
 *
 * 为什么必须有这一层（本仓已登记的假绿形态之四：**覆盖面静默缩水**）：
 *   场景文件被误删 / 判据被写成 `if (x) assert(...)` / 扫描 glob 写错一个字符，
 *   三条路的现场表现**完全一致**：进程 exit 0、屏上「✓ 全部读数通过」、
 *   而实际什么都没测。R-O1 的验收原文要求「320 / 390 / 768 / 1280px 四档视口
 *   完成核心流程」—— 四档里少跑一档，在单次驱动里看不出来，在这里必须转红。
 *
 * 判据分三层，逐层 fail-closed：
 *   ① 环境层：无浏览器 ⇒ 未执行（exit 2），**不得计通过**；
 *   ② 结构层：场景数与视口数低于下限 ⇒ 拒判（exit 2）；
 *   ③ 读数层：任一条判据 FAIL ⇒ exit 1。
 *
 * 证据格式（R-O1 验收原文：「每条证据带版本号、浏览器版本、fixture/host 标记」）：
 *   每行读数渲染成
 *     [scene] viewport=WxH ver=V browser=B host=stub read-name | ok|FAIL | detail
 *   这一段是**报表**不是**判据** —— 判据在各场景文件里，本文件只保证
 *   「读数条数不低于下限且逐条带全标记」。
 *
 * 用法：
 *   node tests/browser/gate.mjs [--scenes=a,b] [--widths=320,390,768,1280]
 *                               [--heights=568,844,1024,800] [--budget=45000]
 *                               [--min-scenes=7] [--quiet]
 * 退出码：0 = 全绿；1 = 有 FAIL；2 = 未执行 / 覆盖面不足 / 用法错误。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario, findBrowser } from './browser-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCEN_DIR = path.join(HERE, 'scenarios');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flags = new Map();
for (const a of argv) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i < 0) flags.set(a.slice(2), 'true');
  else flags.set(a.slice(2, i), a.slice(i + 1));
}
/** 四档视口：R-O1 验收原文点名的那四档（宽度是判据，高度取该宽度的常用机身高）。 */
const DEFAULT_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];
function parseViewports() {
  const ws = flags.get('widths');
  if (!ws) return DEFAULT_VIEWPORTS;
  const hs = String(flags.get('heights') || '').split(',').map((s) => Number(s.trim()));
  return String(ws).split(',').map((s, i) => ({
    width: Number(s.trim()),
    height: Number.isFinite(hs[i]) && hs[i] > 0 ? hs[i] : 800,
  })).filter((v) => Number.isFinite(v.width) && v.width > 0);
}
const VIEWPORTS = parseViewports();
const budgetMs = Number(flags.get('budget') || 45000);
/** 结构自证下限：低于这些数就是「覆盖面缩水」，不是「恰好没找到问题」。 */
const MIN_SCENES = Number(flags.get('min-scenes') || 7);
const MIN_VIEWPORTS = Number(flags.get('min-viewports') || 4);
/** 每场景读数条数下限：一条场景只报 1 条读数 = 判据被掏空，等同没测。 */
const MIN_READS_PER_SCENE = Number(flags.get('min-reads') || 2);
const quiet = flags.get('quiet') === 'true';

/** 列出正式场景：`_` 前缀是取证用的一次性探针（非交付物），一律不进本门扫描面。 */
function listScenes() {
  let names = [];
  try { names = fs.readdirSync(SCEN_DIR); } catch (_e) { names = []; }
  const picked = [];
  for (const n of names) {
    if (!n.endsWith('.scen.js')) continue;
    if (n.startsWith('_')) continue;
    picked.push(n);
  }
  const only = flags.get('scenes');
  const filtered = only
    ? picked.filter((n) => String(only).split(',').some((p) => n.includes(p.trim())))
    : picked;
  return filtered.sort();
}

/* ---------- 结构自证（先跑，早失败） ---------- */
const scenes = listScenes();
const structProblems = [];
if (scenes.length < MIN_SCENES) {
  structProblems.push(`正式场景数 ${scenes.length}（下限 ${MIN_SCENES}）—— 场景被删/glob 写错会让本门「零失败」而全绿，属 fail-open，必须拒判`);
}
if (VIEWPORTS.length < MIN_VIEWPORTS) {
  structProblems.push(`视口档数 ${VIEWPORTS.length}（下限 ${MIN_VIEWPORTS}）—— R-O1 要求四档视口全覆盖，少跑一档不得计通过`);
}
for (const v of VIEWPORTS) {
  if (!(v.width > 0) || !(v.height > 0)) structProblems.push(`视口非法：${JSON.stringify(v)}`);
}

/* ---------- 版本面（证据必须带版本号） ---------- */
function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (_e) { return null; } }
const pkg = readJson('package.json');
const man = readJson('manifest.json');
const versions = [String((pkg && pkg.version) || ''), String((man && man.version) || '')];
if (!versions[0] || !versions[1]) structProblems.push('版本面读不到（package.json / manifest.json）—— 证据必须能带版本号');
if (versions[0] && versions[1] && versions[0] !== versions[1]) {
  structProblems.push(`版本两源不同源：package.json=${versions[0]} manifest.json=${versions[1]}（证据里的版本号必须唯一）`);
}
const VERSION = versions[0] || versions[1] || 'unknown';

if (structProblems.length) {
  console.error('[browser-gate] 结构自证失败 —— 拒判（exit 2）');
  for (const p of structProblems) console.error('  ✗ ' + p);
  process.exit(2);
}

/* ---------- 环境自证（无浏览器 ⇒ 未执行，不得计通过） ---------- */
const probe = findBrowser();
if (!probe.available) {
  console.error('[browser-gate] 环境无可用浏览器 ⇒ 本门**未执行**（不得计通过）：' + probe.reason);
  process.exit(2);
}

/* ---------- 跑全矩阵 ---------- */
if (!quiet) {
  console.log(`[browser-gate] ver=${VERSION} root=${ROOT}`);
  console.log(`[browser-gate] browser=${probe.source} → ${probe.exe}`);
  console.log(`[browser-gate] scenes=${scenes.length} viewports=${VIEWPORTS.map((v) => v.width + 'x' + v.height).join('/')} budget=${budgetMs}ms`);
}
const evidence = [];
let totalReads = 0;
let totalFail = 0;
let totalUnexecuted = 0;
const perScene = new Map();

for (const scene of scenes) {
  const rel = path.join('tests/browser/scenarios', scene);
  for (const vp of VIEWPORTS) {
    const r = await runScenario({
      root: ROOT, scenarios: [rel], styles: ['phone.css'],
      viewport: vp, budgetMs, browser: probe,
    });
    const key = scene;
    const acc = perScene.get(key) || { reads: 0, fail: 0, unexecuted: 0, boxes: 0 };
    if (!r.executed) {
      totalUnexecuted += 1;
      acc.unexecuted += 1;
      evidence.push({
        scene, viewport: `${vp.width}x${vp.height}`, read: '(未执行)', ok: false,
        detail: String(r.reason || '未执行'), unexecuted: true,
      });
    } else {
      const boxes = r.reports.length;
      acc.boxes = Math.max(acc.boxes, boxes);
      for (const x of r.reports) {
        const ok = !!(x && x.ok);
        totalReads += 1;
        acc.reads += 1;
        if (!ok) { totalFail += 1; acc.fail += 1; }
        evidence.push({
          scene, viewport: `${vp.width}x${vp.height}`,
          read: String((x && x.name) || '(无名读数)'), ok,
          detail: String((x && x.detail) || '').slice(0, 200),
        });
      }
    }
    perScene.set(key, acc);
  }
}

/* ---------- 读数层结构自证：每个场景都得真报够读数 ---------- */
const thinScenes = [];
for (const [scene, acc] of perScene) {
  if (acc.unexecuted > 0) continue; // 未执行已单独计
  if (acc.boxes < MIN_READS_PER_SCENE) {
    thinScenes.push(`${scene} 最多只报 ${acc.boxes} 条读数（下限 ${MIN_READS_PER_SCENE}）—— 判据被掏空等同没测`);
  }
}

/* ---------- 报表 ---------- */
if (!quiet) {
  console.log('');
  console.log('=== 证据（每条带 scene / viewport / ver / browser / host） ===');
  for (const e of evidence) {
    const tag = e.ok ? 'ok  ' : 'FAIL';
    console.log(
      `[${e.scene}] ${e.viewport} ver=${VERSION} browser=${probe.source} host=stub ` +
      `${tag} ${e.read} | ${e.detail}`,
    );
  }
}
console.log('');
console.log(`[browser-gate] 场景 ${scenes.length} · 视口 ${VIEWPORTS.length} 档 · 读数 ${totalReads} 条（每场景下限 ${MIN_READS_PER_SCENE}）`);
console.log(`[browser-gate] 结果：fail=${totalFail} unexecuted=${totalUnexecuted} ver=${VERSION} browser=${probe.source}`);

if (thinScenes.length) {
  console.error('[browser-gate] 读数面过薄 —— 拒判（exit 2）');
  for (const s of thinScenes) console.error('  ✗ ' + s);
  process.exit(2);
}
if (totalUnexecuted > 0) {
  console.error(`[browser-gate] 有 ${totalUnexecuted} 次运行**未执行** ⇒ 不得计通过`);
  process.exit(2);
}
if (totalFail > 0) {
  console.error(`[browser-gate] ${totalFail} 条 FAIL`);
  process.exit(1);
}
console.log('[browser-gate] ✓ 全矩阵通过');
