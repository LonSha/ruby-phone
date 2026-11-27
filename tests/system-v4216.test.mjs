/* ============================================================
 * tests/system-v4216.test.mjs — v4.216.0 浏览器 runner 假绿缺陷修复判据
 * ------------------------------------------------------------
 * 缺陷：runScenario 在 stdout 里没有 <pre id="__result"> 时 m=null，
 *   旧代码只判 `if (m && !scriptRan)`，于是 m=null 直接落到 executed:true +
 *   0 读数；printReports 见 fail=0 打印「✓ 全部读数通过」并 exit 0。
 *   现场：Chromium 共享内存/GPU 报错导致 --dump-dom 没吐页面，页面完全没跑，
 *   驱动却报绿 —— 违反本仓「未执行不得计通过」纪律。
 *
 * 修法（两层防线）：
 *   ① classifyRun() 把四态 fail-closed 收敛成纯函数（无 <pre> / 未跑脚本 /
 *      超时 / 0 读数），runScenario 统一走它；
 *   ② printReports() 即使上游误判 executed=true，也按 pageRan/timedOut/读数条数
 *      再判一次，绝不打印「全部读数通过」。
 *
 * 本套件每条都能单点复现（铁律：全量前先单跑）。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRun, printReports, runScenario } from '../tests/browser/browser-runner.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ------------------------------------------------------------
 * A 组：classifyRun 五态
 * ------------------------------------------------------------ */
test('A1 无结果节点（m=null）必判未执行 —— 这是原假绿的直接根因', () => {
  const r = classifyRun({ matched: false, scriptRan: false, timedOut: false, reportCount: 0 });
  assert.equal(r.executed, false);
  assert.match(r.reason, /stdout 未匹配到/);
});

test('A2 有节点但脚本未跑（scriptRan=false）必判未执行', () => {
  const r = classifyRun({ matched: true, scriptRan: false, timedOut: false, reportCount: 0 });
  assert.equal(r.executed, false);
  assert.match(r.reason, /脚本未执行/);
});

test('A3 超时（即便有绿读数）必判未执行 —— 半截 DOM 不可信', () => {
  const r = classifyRun({ matched: true, scriptRan: true, timedOut: true, reportCount: 5 });
  assert.equal(r.executed, false);
  assert.match(r.reason, /超时/);
});

test('A4 脚本跑了但 0 读数必判未执行 —— 判据被掏空等同没测', () => {
  const r = classifyRun({ matched: true, scriptRan: true, timedOut: false, reportCount: 0 });
  assert.equal(r.executed, false);
  assert.match(r.reason, /0 条读数/);
});

test('A5 正常态（有节点/脚本已跑/未超时/有读数）才判执行', () => {
  const r = classifyRun({ matched: true, scriptRan: true, timedOut: false, reportCount: 3 });
  assert.equal(r.executed, true);
  assert.equal(r.reason, undefined);
});

/* ------------------------------------------------------------
 * B 组：printReports 第二道防线
 * ------------------------------------------------------------ */
function capture(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { return { ret: fn(), lines }; } finally { console.log = orig; }
}

test('B1 pageRan=false 即便上游写 executed=true 也拒判，且不打印通过', () => {
  const { ret, lines } = capture(() => printReports(
    { executed: true, pageRan: false, browser: 'x', timedOut: false, reports: [] }, '[bad]'));
  assert.equal(ret.fail, 1);
  assert.equal(ret.pass, 0);
  assert.ok(!lines.some((l) => l.includes('全部读数通过')), '绝不能打印「全部读数通过」');
  assert.ok(lines.some((l) => l.includes('未执行')), '必须打印未执行');
});

test('B2 timedOut=true 即便带绿读数也拒判', () => {
  const { ret, lines } = capture(() => printReports(
    { executed: true, pageRan: true, browser: 'x', timedOut: true,
      reports: [{ name: 'ok', ok: true, detail: 'x' }] }, '[timeout]'));
  assert.equal(ret.fail, 1);
  assert.ok(!lines.some((l) => l.includes('全部读数通过')));
});

test('B3 0 读数即便 executed=true 也拒判', () => {
  const { ret } = capture(() => printReports(
    { executed: true, pageRan: true, browser: 'x', timedOut: false, reports: [] }, '[empty]'));
  assert.equal(ret.fail, 1);
});

test('B4 正常态照常逐条打印并计通过（不能修过头）', () => {
  const { ret, lines } = capture(() => printReports(
    { executed: true, pageRan: true, browser: 'x', timedOut: false,
      reports: [{ name: 'a', ok: true, detail: 'x' }, { name: 'b', ok: true, detail: 'y' }] }, '[good]'));
  assert.equal(ret.pass, 2);
  assert.equal(ret.fail, 0);
  assert.ok(lines.some((l) => l.includes('2 ok / 0 fail')));
});

/* ------------------------------------------------------------
 * C 组：runScenario 真路径（用假 browser 模拟 --dump-dom 没吐 <pre>）
 * ------------------------------------------------------------ */
test('C1 runScenario 遇到无 <pre> 的 stdout 时 executed=false（集成级）', async () => {
  // 用 /bin/true 当「浏览器」：exit 0、stdout/stderr 全空 —— 正是原假绿现场。
  const r = await runScenario({
    root: ROOT,
    body: 'report({name:"never",ok:true,detail:"x"});',
    browser: { available: true, exe: '/bin/true', source: 'fake:no-dom' },
    budgetMs: 100, timeoutMs: 5000,
  });
  assert.equal(r.executed, false, '空 stdout 必须判未执行（不得计通过）');
  assert.match(String(r.reason), /未匹配到/);
  assert.equal(r.pageRan, false);
  assert.deepEqual(r.reports, []);
});

/* ------------------------------------------------------------
 * D 组：源码形态判据（防后来者把防线删掉）
 * ------------------------------------------------------------ */
test('D1 runScenario 必须统一走 classifyRun，不得再留 `m && !scriptRan` 旧分支', () => {
  const src = rd('tests/browser/browser-runner.mjs');
  assert.ok(/export function classifyRun/.test(src), 'classifyRun 必须导出');
  assert.ok(/const verdict = classifyRun\(/.test(src), 'runScenario 必须调用 classifyRun');
  assert.ok(!/if \(m && !scriptRan\)/.test(src), '旧假绿分支必须移除');
});

test('D2 printReports 必须有 pageRan/timedOut/0 读数三合一防线', () => {
  const src = rd('tests/browser/browser-runner.mjs');
  const at = src.indexOf('export function printReports');
  assert.ok(at >= 0, '必须能定位 printReports 定义');
  const body = src.slice(at); // printReports 是文件最后一个函数，之后到 EOF 都是它的体
  assert.ok(/r\.pageRan === false/.test(body), '必须判 pageRan');
  assert.ok(/r\.timedOut === true/.test(body), '必须判 timedOut');
  assert.ok(/r\.reports\.length === 0/.test(body), '必须判 0 读数');
  assert.ok(/未执行（不得计通过）/.test(body), '必须打印未执行拒判说明');
  /* 不再检查全文件「全部读数通过」字样 —— 注释里保留历史说明是诚实的，
   * 判据只管可执行代码里没有无条件通过声明。 */
});
