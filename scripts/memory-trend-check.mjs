#!/usr/bin/env node
/* ============================================================
 * scripts/memory-trend-check.mjs — 长会话内存跨轮趋势门（R21-O6）[v4.144.0]
 * ------------------------------------------------------------
 * 【为什么有它】
 *   `tests/audit/memory_growth_probe.cjs` 早就在盘上，基线 `memory_growth_baseline.json`
 *   也早就落了读数（实测 8 轮 heap 4362→4378 KB），基线自己的 `note` 逐字写着
 *   「单点仍不可判泄漏，只判**跟轮趋势**」—— 而**没有任何门在读这个读数**。
 *   于是「能力建好了、没人用」这第三笔账在这里又记了一笔：读数会随真正的泄漏越来越大，
 *   而没有东西会响。本门就是那一声。
 *
 * 【口径一：趋势门，不是精确门】
 *   上界留**4 倍余量**（当前实测 tail 2KB / total 15KB ⇒ 门为 8KB / 64KB）。
 *   理由：同一份代码 12 连跑曾出现 0.5 与 55.25 KB/轮两个档次（见探针注释），
 *   环境噪声必须容得下；把阈值压到实测值身上只会得到一道时红时绿的噪声门。
 *   而真泄漏不是这个量级：本门的负控制实测拿 3075KB（见 `--keep-kb`）。
 *
 * 【口径二：两个读数都要，它们分工不同】
 *   `heap_total_growth_kb` = 首轮→末轮（含 JIT/缓存填充）；
 *   `heap_tail_growth_kb`  = 后半段→末轮（这才是泄漏形态）。
 *   只看前者会把「首轮载入的一次性开销」当成泄漏；只看后者会漏掉
 *   「每轮配\u4e00份固定开销」那种慢性扩容。两个都越界才算真红？不 —— **任一越界即红**，
 *   不取并集的“发涩”写法。
 *
 * 【口径三：读不到 / 不可比 ⇒ 拒判 exit 2，绝不发合格证】
 *   · 探针不在场 / 跑不起来 / JSON 解不开 / 读数缺格 ⇒ exit 2；
 *   · `gc_forced !== true` ⇒ exit 2。**本条是这道门最重要的一句**：
 *     实测同一份代码不带 `--expose-gc` 得 166.75KB/轮、带则 0.5KB/轮，差 300 倍。
 *     那个读数量的是「未回收垃圾」，不是泄漏；拿它评红绿都是把噪声当证据。
 *   与仓内既有纪律同族：「读不到就 fail-closed，绝不发合格证」。
 *
 * 【口径四：结构自证（防「探针被描述成空壳」的假绿）】
 *   样本点必须 ≥ 6 个、轮数必须 ≥ 6、`heap_samples_kb` 必须是数组。
 *   否则「8 轮趋势」这件事就只剩一个名字。
 *
 * 定向负控制（`--keep-kb N` 透传给探针：每轮真留 N KB 堆内数组）：
 *   `node scripts/memory-trend-check.mjs --keep-kb 1024` ⇒ 必须 exit 1，实测 tail 约 3075KB。
 *   这条不是为了看好：没有它就无法知道这道门在超界时真的会响。
 *
 * 用法：
 *   node scripts/memory-trend-check.mjs               # 评判（真跑探针一次，带 --expose-gc）
 *   node scripts/memory-trend-check.mjs --json        # 机读读数
 *   node scripts/memory-trend-check.mjs --root <dir> # 指定仓根（夹具用）
 *   node scripts/memory-trend-check.mjs --keep-kb N   # 负控制：每轮真留 N KB（必须转红）
 * 退出码：0=趋势过门  1=越界  2=拒判（读不到 / 不可比 / 结构漂移）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { numOrNull } from '../config/num-gate.js';
/* 判决与可比性两面的**唯一实现**在 lib：判据也导它，不各写一份。 */
import { judgeTrendReadings, guardProbeOutput, TAIL_LIMIT_KB, TOTAL_LIMIT_KB } from './lib/memory-trend.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
const JSON_MODE = argv.includes('--json');
const ROOT = path.resolve(argOf('--root') || path.join(HERE, '..'));
const PROBE_REL = 'tests/audit/memory_growth_probe.cjs';
const PROBE = path.join(ROOT, PROBE_REL);
function reject(msg) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ verdict: 'reject', why: msg }, null, 1) + String.fromCharCode(10));
  else console.error('[memory-trend] 拒判：' + msg);
  process.exit(2);
}
if (!fs.existsSync(PROBE)) reject('探针不在场：' + PROBE_REL + '（读不到就不发合格证）');
/* ★ 必须带 --expose-gc：不带就是在量未回收垃圾（实测差 300 倍）。 */
const args = ['--expose-gc', PROBE, '--json', '--root', ROOT];
const keep = argOf('--keep-kb');
if (keep !== null) args.push('--keep-kb', String(keep));
const rounds = argOf('--rounds');
if (rounds !== null) args.push('--rounds', String(rounds));
const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600000 });
if (r.error) reject('探针启动失败：' + String(r.error.message || r.error));
if (r.status !== 0) {
  reject('探针 exit ' + String(r.status) + '（stderr：' + String(r.stderr || '').slice(0, 240) + '）');
}
let live = null;
try { live = JSON.parse(r.stdout); } catch (e) { reject('探针 stdout 不是 JSON：' + String(e && e.message)); }
if (!live || typeof live !== 'object') reject('探针输出为空');
/* ---------- 结构自证（不在本文重写判据：唤同上方纯函数） ---------- */
const guard = guardProbeOutput(live);
if (!guard.ok) reject(guard.why);
const rd2 = live.readings;
const samples = rd2.heap_samples_kb;
const roundsLive = guard.rounds;
/* ---------- 判决（也唤纯函数） ---------- */
const judged = judgeTrendReadings(rd2);
const tail = judged.tail;
const total = judged.total;
const over = judged.over;
const keepKB = numOrNull(rd2.keep_kb);
const retainedN = numOrNull(rd2.retained_arrays);
const out = {
  verdict: over.length ? 'over-limit' : 'pass',
  over,
  readings: {
    heap_tail_growth_kb: tail,
    heap_total_growth_kb: total,
    tail_limit_kb: TAIL_LIMIT_KB,
    total_limit_kb: TOTAL_LIMIT_KB,
    rounds: roundsLive,
    samples: samples.length,
    gc_forced: live.gc_forced,
    keep_kb: keepKB,
    retained_arrays: retainedN
  },
  probe: PROBE_REL,
  note: '趋势门（非精确门）：单点 heapUsed 不可判泄漏，只判跨轮趋势；上界留 4 倍余量。'
    + '不判「真机长时运行」—— 那一段仍归真宿主档。'
};
if (JSON_MODE) {
  process.stdout.write(JSON.stringify(out, null, 1) + String.fromCharCode(10));
} else {
  process.stdout.write('[memory-trend] 尾段增长 ' + tail + 'KB（上界 ' + TAIL_LIMIT_KB + 'KB）· 总增长 ' + total
    + 'KB（上界 ' + TOTAL_LIMIT_KB + 'KB）· 轮数 ' + roundsLive + '· 样本 ' + samples.length
    + '· 强制GC ' + String(live.gc_forced) + String.fromCharCode(10));
  if (keepKB !== null && keepKB > 0) {
    process.stdout.write('[memory-trend] 负控制开关：每轮真留 ' + keepKB + 'KB（累计 ' + String(retainedN) + ' 个数组）'+ String.fromCharCode(10));
  }
  if (over.length) {
    for (const o of over) process.stderr.write('[memory-trend] ✗ ' + o + String.fromCharCode(10));
    process.stderr.write('[memory-trend] ✗ 趋势越界：这不是单点抖动，而是后半段每轮都在长；需单独立项定位' + String.fromCharCode(10));
  } else {
    process.stdout.write('[memory-trend] ✓ 趋势门通过（无泄漏候选）'+ String.fromCharCode(10));
  }
}
process.exit(over.length ? 1 : 0);
