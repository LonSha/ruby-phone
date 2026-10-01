/* ========================================================
 * smoke_assert3360.mjs — [v3.36.0] 杂志 · 冒烟**硬断言外壳**（硬门禁）
 *
 * 为什么必须有这一层（v3.35.0 起的纪律）：
 *   冒烟脚本自己 `exit 1` 但**没人把它当门禁** —— 漏导入那条真缺陷就是这样漏进来的
 *   （`node --check` 绿、静态门绿、套件绿，只有走到那条分支才炸）。
 *   故本层做三件事：
 *     ① 真跑冒烟，**逐字**比对末行必须是 `SMOKE-3360 ALL GREEN`；
 *     ② 输出里**不许出现 ✗**（防「脚本改了但退出码没跟上」）；
 *     ③ 退出码必须是 0（防「末行对了但进程非零」）。
 *   三条同时成立才算过；任一条不成立 ⇒ 本层 exit 1。
 *
 * 用法：node tools/smoke_assert3360.mjs   （末行必须是 SMOKE-ASSERT-3360 ALL GREEN）
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SMOKE = path.join(ROOT, 'tools', 'smoke3360.mjs');
const EXPECT_TAIL = 'SMOKE-3360 ALL GREEN';

const r = spawnSync(process.execPath, [SMOKE], { encoding: 'utf8', cwd: ROOT });
const out = (r.stdout || '') + (r.stderr || '');
const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
const tail = lines.length ? lines[lines.length - 1] : '';
const crossCount = (out.match(/✗/g) || []).length;

const problems = [];
if (tail !== EXPECT_TAIL) problems.push('冒烟末行必须是「' + EXPECT_TAIL + '」，实测「' + tail + '」');
if (crossCount !== 0) problems.push('冒烟输出里不许有 ✗，实测 ' + crossCount + ' 处');
if (r.status !== 0) problems.push('冒烟退出码必须是 0，实测 ' + r.status);

if (problems.length) {
    console.error('SMOKE-ASSERT-3360 失败：');
    for (const p of problems) console.error('  · ' + p);
    console.error('（冒烟输出末尾 600 字）');
    console.error(out.slice(-600));
    process.exit(1);
}
console.log('✓ 冒烟末行逐字对上：' + EXPECT_TAIL);
console.log('✓ 输出零 ✗');
console.log('✓ 退出码 0');
console.log('SMOKE-ASSERT-3360 ALL GREEN');