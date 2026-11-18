#!/usr/bin/env node
/* ============================================================
 * tools/ab-desk.mjs — R25-X8 整机 A/B 对照台（产品面，不是门禁）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/ab-desk.mjs --a=<旧版本根> --b=<新版本根> --scenes=o3-media-20.scen.js
 *        [--width=390] [--height=844] [--budget=60000] [--out=tests/audit/ab-reports/latest.md]
 *
 * 它做的事只有三件：同一段操作序列（场景文件，从**当前仓**取绝对路径，两边跑同一份）
 *   分别在 A/B 两个根上真跑一遍 → 读数按名字对齐 → 输出差异清单（Markdown + JSON）。
 * 它**不判通过/失败**（判定权在场景文件与 gate）：
 *   · 只有一种硬错误会让它拒判：两边都跑不起来 / 都零读数 ⇒ exit 2，不出报告；
 *   · 差异多少条都不影响退出码（0）—— 差异是**要看的东西**，不是红点。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, runScenario, browserVersion } from '../tests/browser/browser-runner.mjs';
import { diffReadings, formatMarkdown, abDeskSelfCheck, AB_FACES } from './ab-desk-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const flags = new Map();
argv.forEach((a) => {
  const i = a.indexOf('=');
  if (a.startsWith('--') && i > 0) flags.set(a.slice(2, i), a.slice(i + 1));
});

const rootA = path.resolve(String(flags.get('a') || ''));
const rootB = path.resolve(String(flags.get('b') || ''));
const sceneArg = String(flags.get('scenes') || '').split(',').map((s) => s.trim()).filter(Boolean);
const scenePaths = sceneArg.map((s) => (path.isAbsolute(s) ? s : path.join(ROOT, 'tests', 'browser', 'scenarios', s)));
const viewport = { width: Number(flags.get('width') || 390), height: Number(flags.get('height') || 844) };
const budgetMs = Number(flags.get('budget') || 60000);
const outArg = String(flags.get('out') || 'tests/audit/ab-reports/latest.md');
const OUT = path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg);

function fail(msg) {
  console.error('[ab-desk] ' + msg);
  process.exit(2);
}

/* 台自检：内核五条边界还成立吗。它不判产品，判**自己能不能给出可信读数**。
 * 自检不成立 => 这台此刻给不出可信对照 => exit 2（未执行，不出任何结论），
 * 与「用法错误」同一个语义；任何情况下都不出现 exit 1（台不是门）。 */
if (argv.indexOf('--self-check') >= 0) {
  const sc = abDeskSelfCheck();
  const good = sc.items.filter((i) => i.ok).length;
  console.log('[ab-desk] 自检 ' + good + '/' + sc.items.length + ' 条成立');
  console.log('[ab-desk] 差异面四档：' + AB_FACES.join(' / '));
  sc.items.forEach((i) => console.log('  - ' + (i.ok ? 'ok' : 'FAIL') + ' | ' + i.name + ' | ' + i.detail));
  if (!sc.ok) fail('内核自检不成立 => 这台此刻给不出可信对照，未做任何比对。');
  process.exit(0);
}

if (!flags.get('a') || !flags.get('b')) fail('用法：--a=<旧版本根> --b=<新版本根> --scenes=<场景文件[,场景文件]>');
if (scenePaths.length === 0) fail('至少给一个 --scenes（它就是那段「操作序列」）');
for (const p of scenePaths) if (!fs.existsSync(p)) fail('场景文件不存在：' + p);
for (const p of [rootA, rootB]) if (!fs.existsSync(path.join(p, 'index.js'))) fail('根目录下没有 index.js：' + p);

const probe = findBrowser();
if (!probe.available) fail('环境无可用浏览器 ⇒ 本次未执行（不生成任何对照结论）：' + probe.reason);
const version = await browserVersion(probe.exe);

async function runSide(root, label) {
  const readings = [];
  const problems = [];
  for (const scene of scenePaths) {
    const r = await runScenario({ root, scenarios: [scene], styles: ['phone.css'], viewport, budgetMs, browser: probe });
    if (!r.executed) { problems.push(label + ' 未执行：' + scene + '（' + String(r.reason || '') + '）'); continue; }
    if (!r.pageRan) problems.push(label + ' 页面没跑起来：' + scene);
    for (const rec of r.reports || []) {
      readings.push({ name: path.basename(scene) + '::' + String(rec && rec.name), ok: !!(rec && rec.ok), detail: String((rec && rec.detail) || '') });
    }
  }
  return { readings, problems };
}

console.log('[ab-desk] A=' + rootA);
console.log('[ab-desk] B=' + rootB);
console.log('[ab-desk] scenes=' + scenePaths.map((p) => path.basename(p)).join(',') + ' viewport=' + viewport.width + 'x' + viewport.height + ' budget=' + budgetMs + 'ms');
console.log('[ab-desk] browser=' + probe.source + ' -> ' + version);

const sideA = await runSide(rootA, 'A');
const sideB = await runSide(rootB, 'B');
if (sideA.readings.length === 0 && sideB.readings.length === 0) {
  fail('两边都零读数 ⇒ 未执行，不出对照结论。' + JSON.stringify(sideA.problems.concat(sideB.problems)));
}

const result = diffReadings(sideA.readings, sideB.readings);
const meta = {
  'A（旧）': rootA,
  'B（新）': rootB,
  '操作序列': scenePaths.map((p) => path.basename(p)).join(' + '),
  '视口': viewport.width + 'x' + viewport.height,
  '浏览器': version,
  '运行问题': sideA.problems.concat(sideB.problems).join(' / ') || '无',
}; 
const md = formatMarkdown(result, meta);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md + String.fromCharCode(10));
const jsonPath = OUT.endsWith('.md') ? OUT.slice(0, -3) + '.json' : OUT + '.json';
fs.writeFileSync(jsonPath, JSON.stringify({ meta, ...result }, null, 2) + String.fromCharCode(10));
console.log('[ab-desk] 读数 ' + result.total + ' 条 · same ' + result.counts.same + ' / diff ' + result.counts.diff + ' / only-a ' + result.counts['only-a'] + ' / only-b ' + result.counts['only-b'] + ' ⇒ ' + result.verdict);
console.log('[ab-desk] 报告已写：' + path.relative(ROOT, OUT));
for (const r of result.rows) {
  if (r.face === 'same') continue;
  console.log('  - ' + r.face + ' | ' + r.name);
}
process.exit(0);

