// tests/system-v325.test.mjs — F-4 剧情日程冲突可行性取证 [v3.8.0]
//
//   本版**只取证，不实施**。TODO F 批的 F-4 一直挂着「先取证再立 Gate」，而「先取证」这件事
//   在本轮第一次真跑：要接的面到底存不存在？
//
//   本轮的结论（按读数否掉一个候选，且理由不是「工作量」而是「对象不存在」）：
//     **要接的面不存在 ⇒ not_now（不立 Gate、不实施）** —— 四条读数：
//     ① 上游无任何「日程 / 时刻表」外供面（对象键形态零命中）；
//     ② 上游时间轴只有「楼层」一条（`deadlineFloor` 在场，`scheduledAt`/`dueTime` 缺席）；
//     ③ 上游把「冲突判断」刻意留给下游（`coPresence()` 函数体内零判断字段）；
//     ④ 下游已有基础（4 文件 / 22 点已消费承诺期限与状态）⇒ 增量只剩「撞车提醒」。
//     真正有读数支持的替代轴是「承诺到期读数的可见性提升」（把上游已给的 status 三态
//     与 deadlineFloor 按紧迫度分档），而不是凭空造一个日程模型。
//
//   覆盖：
//     A 基线四件齐备 + 探针读数与基线逐项一致 + 判定挂在读数上（可复算）
//     B 回写防护：无本地日程引擎 / 无兄弟仓硬编码 / 探针位置无关
//     C 结论面（not_now 必须给出「面不存在」的三类证据，且必须有替代轴）
//     D 负控制（四条：破坏判据所需输入，在同款真判据上转红）
//     E 版本锚（只在 3.8.0 及以后成立）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AUDIT = path.join(ROOT, 'tests', 'audit');
const PROBE = path.join(AUDIT, 'schedule_conflict_probe.cjs');
const BASEF = path.join(AUDIT, 'schedule_conflict_baseline.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const IDX_SRC = read(path.join(ROOT, 'index.js'));
const PROBE_SRC = read(PROBE);

function runProbe(root, extra) {
  const args = [PROBE];
  if (root) args.push('--root', root);
  if (extra) args.push.apply(args, extra);
  args.push('--json');
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
}
const main = runProbe(null, null);
assert.equal(main.status, 0, '探针必须能跑通：' + String(main.stderr || '').slice(0, 300));
let rep;
try { rep = JSON.parse(main.stdout); } catch (e) { assert.fail('探针输出必须是 JSON：' + String(main.stdout).slice(0, 160)); }
const base = JSON.parse(read(BASEF));
const R = base.readings;

/* ── 夹具：只复制判据真正需要的输入面（index.js + apps/ + config/），走 os.tmpdir() ── */
const temps = [];
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_f4_'));
  temps.push(dir);
  fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(dir, 'index.js'));
  fs.cpSync(path.join(ROOT, 'apps'), path.join(dir, 'apps'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'config'), path.join(dir, 'config'), { recursive: true });
  return dir;
}
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/* 真源码破坏：锚点必须**恰中一次** */
function damage(rel, anchor, replacement) {
  const dir = makeCopy();
  const p = path.join(dir, rel);
  const src = read(p);
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  fs.writeFileSync(p, src.split(anchor).join(replacement));
  return { dir: dir, res: runProbe(dir, null) };
}

/* ══════════ A ── 基线与读数 ══════════ */
test('A1 基线四件齐备（读数 / 冻结上游证据 / 判定 / 未做）', () => {
  for (const k of ['file', 'note', 'measured_at', 'probe', 'upstream_frozen', 'readings', 'shape', 'verdict', 'corrections', 'not_done']) {
    assert.ok(base[k], '缺面：' + k);
  }
  for (const [k, v] of Object.entries(R)) {
    assert.ok(Number.isFinite(v) && v >= 0, 'readings.' + k + ' 必须是有限非负数');
  }
  const uf = base.upstream_frozen;
  assert.ok(uf.commit && uf.version, '上游冻结证据必须带版本与 commit（可追溯）');
  assert.ok(Array.isArray(uf.findings) && uf.findings.length >= 4, '上游发现必须逐条写明');
  assert.ok(/位置无关|路径依赖|兄弟仓/.test(uf.why_frozen), '必须写明为什么冻结（跨仓路径纪律）');
  assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 2, '修正面必须如实写下（含两条假阳性）');
  assert.ok(Array.isArray(base.not_done) && base.not_done.length >= 3, '必须如实写下没做什么');
});

test('A2 探针读数与基线逐项一致（读数可复算，防转写漂移）', () => {
  assert.equal(rep.filesScanned, R.files_scanned);
  assert.equal(rep.consumePoints, R.consume_points);
  assert.equal(rep.consumeFiles.length, R.consume_files);
  assert.equal(rep.localEngineHits, R.local_engine_hits);
  /* 消费文件名单也必须一致（防「数对了但文件换了」） */
  assert.deepEqual(rep.consumeFiles, base.consume_files);
  /* 枚举面自证：扫到的文件数必须落在合理量级（扫描器失效时会塌成 0） */
  assert.ok(rep.filesScanned > 150, '枚举面须 > 150 个文件，实测 ' + rep.filesScanned);
  /* 下游确实在消费（若为 0，说明 R4 的基础也丢了） */
  assert.ok(rep.consumeFiles.length >= 1, '承诺期限/状态消费文件不得为 0');
  assert.ok(rep.consumePoints > rep.consumeFiles.length, '消费点数须多于文件数（同一文件多点）');
});

test('A3 判定挂在读数上（四条判据由探针算出；同一棵树跑两次逐字节相同）', () => {
  assert.equal(rep.criteria.length, 4, '四条判据必须在场');
  assert.equal(rep.criteria.map((c) => c.id).join(','), 'R1,R2,R3,R4');
  for (const c of rep.criteria) assert.ok(c.desc && c.gotText, '判据必须自带口径与实测值：' + c.id);
  assert.equal(rep.verdict, 'not_now', '本版判定必须是 not_now');
  /* R1 必须不成立（面不存在）—— 那是 not_now 的根因 */
  const r1 = rep.criteria.find((c) => c.id === 'R1');
  assert.equal(r1.pass, false, 'R1「上游存在日程面」必须不成立');
  const again = runProbe(null, null);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, main.stdout, '同一棵树跑两次读数必须逐字相同');
});

test('A4 未指定上游根时不得假绿（跨仓证据不硬依赖兄弟仓在场）', () => {
  const r = runProbe(null, null);
  const j = JSON.parse(r.stdout);
  assert.equal(j.upstream.checked, false, '不给上游根时不得声称复核过');
  assert.ok(/未指定上游根/.test(String(j.upstream.note)), '必须写明为什么没复核');
  /* 且判定不得因此变成 go（未复核 ⇏ 通过） */
  assert.equal(j.verdict, 'not_now', '未复核时判定不得翻成 go');
});

/* ══════════ B ── 回写防护 ══════════ */
test('B1 下游不得悄悄长出「日程引擎」（本版只取证；若实施，本判据会被主动改写而非静默通过）', () => {
  for (const tok of ['scheduleEngine', 'timetableEngine', 'conflictEngine', '日程引擎']) {
    assert.equal(IDX_SRC.indexOf(tok), -1, 'index.js 不得引入 ' + tok);
  }
  for (const dir of fs.readdirSync(path.join(ROOT, 'apps'))) {
    const abs = path.join(ROOT, 'apps', dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.slice(-3) !== '.js') continue;
      const src = read(path.join(abs, f));
      for (const tok of ['scheduleEngine', 'timetableEngine', 'conflictEngine', '日程引擎']) {
        assert.equal(src.indexOf(tok), -1, dir + '/' + f + ' 不得引入 ' + tok);
      }
    }
  }
});

test('B2 探针位置无关：不得把兄弟仓绝对路径写死（上游 v3.204.0 的跨仓纪律）', () => {
  /* 为什么守这条：路径依赖的绿只在一台机器上成立。
   *   探针允许**运行期**通过 --upstream / RP_UPSTREAM_ROOT 接收上游根，
   *   但脚本体里不得出现任何 /home/... 这类绝对路径字面量。 */
  const code = PROBE_SRC.split(String.fromCharCode(10))
    .filter((l) => { const t = l.trim(); return !(t.slice(0, 2) === ' *' || t.slice(0, 2) === '/*' || t.slice(0, 2) === '//'); })
    .join(String.fromCharCode(10));
  assert.equal(/['"]\/home\//.test(code), false, '探针代码里不得出现 /home/ 绝对路径字面量');
  assert.ok(/RP_UPSTREAM_ROOT/.test(PROBE_SRC), '上游根必须走环境变量入口');
  assert.ok(/--upstream/.test(PROBE_SRC), '上游根必须走 --upstream 入口');
});

test('B3 被消费的上游键仍在真源里（下游读的不是幻影）', () => {
  /* 下游读 worldProg.promises[].deadlineFloor / .status —— 这两个键名必须仍在读侧在场 */
  const pd = read(path.join(ROOT, 'apps', 'plotline', 'plotline-data.js'));
  assert.ok(/deadlineFloor/.test(pd), 'plotline 读侧必须仍读 deadlineFloor');
  assert.ok(/p\.status/.test(pd), 'plotline 读侧必须仍读 status');
  const gs = read(path.join(ROOT, 'apps', 'memory', 'global-search-engine.js'));
  assert.ok(/deadlineFloor/.test(gs), '全局搜索必须仍读 deadlineFloor');
});

/* ══════════ C ── 结论面 ══════════ */
test('C1 not_now 必须给出「面不存在」的三类证据，不得只写一句「不做」', () => {
  const v = base.verdict;
  assert.ok(v && v.question && v.answer, '须有被问的问题与给的答案');
  assert.ok(/not_now/.test(v.answer), '结论必须明确标 not_now');
  const txt = v.reasons.join(' ');
  assert.ok(/零命中|不存在/.test(txt), '必须写明「上游无日程外供面」');
  assert.ok(/deadlineFloor/.test(txt) && /scheduledAt/.test(txt), '必须写明上游时间轴只有楼层维');
  assert.ok(/coPresence/.test(txt), '必须写明上游把冲突判断留给下游');
  assert.ok(/F-3/.test(txt), '必须指出与 F-3 已定纪律的关系（不重建已被拒绝的判断面）');
  assert.ok(/4 个文件|22 个点|增量/.test(txt), '必须给出下游增量的实测读数');
  assert.ok(v.not_blocked_by, '必须写明不阻其他项');
});

test('C2 结论必须给出有读数支持的替代轴（否掉一个候选的同时必须指出方向）', () => {
  assert.ok(base.verdict.only_axis_with_evidence, '必须有替代轴');
  assert.ok(/status|紧迫|到期/.test(base.verdict.only_axis_with_evidence), '替代轴须围绕承诺到期读数的可见性');
  assert.ok(/并排呈现|不.*判定|而非/.test(base.verdict.only_axis_with_evidence), '替代轴须明确「不写判定」');
  assert.ok(base.shape && base.shape.verdict, '形状面必须给结论');
});

/* ══════════ D ── 负控制（真破坏 → 同款真判据必须转红） ══════════ */
test('D1 破坏枚举面（掏空 apps/ 与 config/）⇒ 探针必须 fail-closed 拒判', () => {
  const dir = makeCopy();
  fs.rmSync(path.join(dir, 'apps'), { recursive: true, force: true });
  const r = runProbe(dir, null);
  assert.equal(r.status, 2, '枚举面塌陷时必须 exit 2，实测 exit ' + r.status);
  assert.ok(/fail-closed/.test(String(r.stderr)), '必须说明 fail-closed');
});

test('D2 破坏 index.js（空文件）⇒ 探针必须 fail-closed 拒判', () => {
  const dir = makeCopy();
  fs.writeFileSync(path.join(dir, 'index.js'), '');
  const r = runProbe(dir, null);
  assert.equal(r.status, 2, '入口被掏空时必须 exit 2，实测 exit ' + r.status);
});

test('D3 摘掉一处承诺消费 ⇒ 消费点读数必须可观测地变少（真判据对破坏有反应）', () => {
  /* ★ 破坏形态的选择（踩过坑）：探针的判据 token 是**子串**匹配（`deadlineFloor` 含 `deadline`），
   *   于是「把 deadlineFloor 改名」这类细粒度改名**不会**让点数变少（另一个 token 仍命中同一行）。
   *   故这里用**整行**作锚点：把 global-search-engine 里遍历 promises 的那一行换成不含 token 的写法。
   *   整行锚点同时满足「恰中 1 次」与「确实让该行不再命中任何 token」。 */
  const line = 'for (const p of asArray(wp.promises)) {';
  const d = damage('apps/memory/global-search-engine.js', line, 'for (const p of asArray(wp.promiseRows)) {');
  assert.equal(d.res.status, 0, '单行改动不应使探针拒判（只是读数变小）');
  const r2 = JSON.parse(d.res.stdout);
  assert.equal(r2.consumePoints, R.consume_points - 1, '消费点必须恰好少 1（' + r2.consumePoints + ' vs ' + R.consume_points + '）');
  assert.ok(r2.consumeFiles.includes('apps/memory/global-search-engine.js'), '被改的文件应仍在消费面里（它还有另一处命中）');
  assert.equal(r2.consumeFiles.length, R.consume_files, '消费文件数不变（同一文件仍有命中）');
});

test('D4 把「上游日程面」凭空写进 index.js ⇒ R1 类判据在**上游复核面**上必须能观测到差异', () => {
  /* 本判据守的是「探针真的在读上游」：造一个合成上游根，给 index.js 一个真正的日程键对象，
   *   复核面必须从 0 命中翻成 >0（否则 R1 是死判据）。 */
  const up = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_f4_up_'));
  temps.push(up);
  fs.writeFileSync(path.join(up, 'index.js'), 'const x = { schedule: [] };' + String.fromCharCode(10));
  const r = runProbe(null, ['--upstream', up]);
  assert.equal(r.status, 0, '合成上游根不得使探针失败');
  const j = JSON.parse(r.stdout);
  assert.equal(j.upstream.checked, true, '给了上游根就必须真复核');
  assert.ok(j.upstream.scheduleFaceKeys > 0, '合成上游的日程键必须被认出来（R1 是活判据）');
  /* 反坐实：真实上游（冻结读数）为 0 —— 两者必须可区分 */
  assert.equal(R.local_engine_hits, 0);
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（只在 3.8.0 及以后成立）', () => {
  const v = JSON.parse(read(path.join(ROOT, 'manifest.json'))).version;
  const parts = v.split('.').map(Number);
  const ok = parts[0] > 3 || (parts[0] === 3 && parts[1] >= 8);
  assert.ok(ok, '本套件成立于 RubyPhone 3.8.0 及以后，当前 ' + v);
  assert.equal(base.measured_at, 'v3.7.0', '基线首测版必须是 v3.7.0');
});
