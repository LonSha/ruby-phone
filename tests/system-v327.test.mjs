// tests/system-v327.test.mjs — 长会话（1000 楼）楼层消费路径取证（TODO P2 主项）[v3.9.1]
//
//   本版**只取证，不实施**。TODO P2「关键 App 的存储增长与恢复测试」第 ③ 格已经
//   交付 2/6 维（listener 数量 / chatMetadata 键数），主项「1000 楼长会话」一直挂着：
//   夹具已有 `chatLength` 参数，但**楼层消费路径从未在长会话下被观测过**。
//
//   本轮读数（合成宿主 1000 楼 + 真模块）：
//     · 有界消费者确实有界：`recentStoryContext` 8/8/8/8/8、`recentStoryDigest` 6/6/6/6/6；
//     · 全表物化站点 8 个，且 Tavern 源 `items()` 对象数 == 楼层数（截断发生在物化之后）；
//     · 引擎侧上限 `MAX_SCAN_PER_SOURCE = 600` 是活的（索引 400→1000→2000 时钉在 600）；
//     · 未观察到超线性（n400 ≈ 0.5ms、n2000 ≈ 2~3ms）——**这不是性能危机，是形态问题**。
//   结论：唯一有读数支持的优化面是「**把截断前移到取数口**」，本版只登记与立判据。
//
//   覆盖：
//     A 基线四件齐备 + 读数可复算 + **计数段**逐字节相同 + fail-closed
//     B 回写防护：产品代码零改动 / 判据面不被公告侵入 / 探针位置无关 / 形态纪律在代码里
//     C 结论面（每条理由挂在读数上 + 唯一优化轴 + 没做什么）
//     D 负控制三条（真源码破坏 → 同款真判据转红；含「公告不得污染计数」）
//     E 版本锚
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
const PROBE = path.join(AUDIT, 'long_chat_probe.cjs');
const BASEF = path.join(AUDIT, 'long_chat_baseline.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const PROBE_SRC = read(PROBE);
const base = JSON.parse(read(BASEF));
const IDX_SRC = read(path.join(ROOT, 'index.js'));

function runProbe(root) {
  const args = [PROBE];
  if (root) args.push('--root', root);
  args.push('--json');
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
}
const main = runProbe(null);
assert.equal(main.status, 0, '探针必须能跑通：' + String(main.stderr || '').slice(0, 300));
let rep;
try { rep = JSON.parse(main.stdout); } catch (e) { assert.fail('探针输出必须是 JSON：' + String(main.stdout).slice(0, 200)); }
const R = base.readings;
const FLOORS = [10, 100, 400, 1000, 2000];
/** 计数段（可复算）与计时段（不可复算）**分块**比较 —— 见探针口径纪律第 3 条。 */
const countBlock = (j) => JSON.stringify([j.readings, j.scan, j.criteria, j.verdict, j.sites]);

/* ── 夹具：只复制判据真正要跑的输入面（index.js + apps/ + config/ + manifest + 宿主夹具） ── */
const temps = [];
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_longchat_'));
  temps.push(dir);
  fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(dir, 'index.js'));
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(dir, 'manifest.json'));
  fs.cpSync(path.join(ROOT, 'apps'), path.join(dir, 'apps'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'config'), path.join(dir, 'config'), { recursive: true });
  /* ★ 真模块的**真实依赖**：`data/` 等顶层目录必须一起拷。
   *   漏了它 `global-search-engine` 会经 cheat-data → data/cheats.js 加载失败 ——
   *   探针会如实报 load-failed 并（修正后）fail-closed 拒判。 */
  for (const d of ['data', 'phone', 'workers', 'assets']) {
    if (fs.existsSync(path.join(ROOT, d))) {
      fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    }
  }
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tests', '_runtime_host.mjs'), path.join(dir, 'tests', '_runtime_host.mjs'));
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
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 80));
  fs.writeFileSync(p, src.split(anchor).join(replacement));
  return runProbe(dir);
}

/* ══════════ A ── 基线与读数 ══════════ */
test('A1 基线齐备（读数 / 静态面 / 站点 / 判据 / 结论 / 修正 / 未做）', () => {
  for (const k of ['file', 'probe', 'note', 'measured_at', 'host', 'readings', 'scan', 'sites',
    'criteria', 'verdict', 'corrections', 'not_done']) {
    assert.ok(base[k], '缺面：' + k);
  }
  assert.ok(Object.keys(R).length >= 30, '读数至少 30 项，实测 ' + Object.keys(R).length);
  for (const [k, v] of Object.entries(R)) {
    assert.ok(Number.isFinite(v), 'readings.' + k + ' 必须是有限数');
  }
  for (const [k, v] of Object.entries(base.scan)) {
    assert.ok(Number.isFinite(v) && v >= 0, 'scan.' + k + ' 必须是有限非负数');
  }
  assert.equal(base.host.announcement_stripped, true, '判据面必须已剥离内置公告（否则计数会被散文污染）');
  assert.deepEqual(base.host.chat_lengths, FLOORS, '楼层采样点必须与判据同序');
  assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 4, '修正面必须如实写下（≥4 条口径事故）');
  assert.ok(Array.isArray(base.not_done) && base.not_done.length >= 4, '必须如实写下没做什么（≥4）');
  const txt = JSON.stringify(base);
  assert.ok(/合成/.test(txt) && /非实机/.test(txt), '必须写明合成宿主 / 非实机');
  assert.ok(/无浏览器|无 SillyTavern 宿主/.test(txt), '必须写明无浏览器/无宿主参与');
  assert.ok(/未验证实机|实机/.test(base.not_done.join(' ')), '没做什么里必须写明未验实机');
});

test('A2 探针读数与基线逐项一致（读数零手抄；枚举面与上限自证）', () => {
  assert.deepEqual(rep.readings, base.readings, '读数必须与基线逐项一致');
  assert.deepEqual(rep.scan, base.scan, '静态面计数必须与基线一致');
  assert.equal(rep.verdict.answer, base.verdict.answer, '结论文本必须与基线一致');
  /* 枚举面自证：扫描器失效时会塌成 0 */
  assert.ok(rep.scan.files > 150, '枚举面须 > 150，实测 ' + rep.scan.files);
  assert.ok(rep.scan.full_materialize > 0 && rep.scan.bounded_slice > 0 &&
    rep.scan.indexed_loop > 0 && rep.scan.length_read > 10, '四类站点计数都须 > 0（扫描器未失效）');
  /* 关键读数：物化对象数 == 楼层数（截断在物化之后） */
  for (const N of FLOORS) {
    assert.equal(rep.readings['materialize_items_n' + N], N,
      '物化对象数必须等于楼层数（N=' + N + '）—— 若变小，说明形态已变，本条应被主动改写');
  }
  /* 引擎侧上限是活的：600 钉住 */
  assert.equal(rep.readings['engine_index_len_n400'], 400, '400 楼未触顶');
  assert.equal(rep.readings['engine_index_len_n1000'], 600, '1000 楼必须正好卡在上限 600');
  assert.equal(rep.readings['engine_index_len_n2000'], 600, '2000 楼不得突破上限');
  /* 有界消费者输出恒定 */
  for (const N of FLOORS) {
    assert.equal(rep.readings['recent_story_context_lines_n' + N], rep.readings['recent_story_context_lines_n10'],
      '最近 n 楼摘要行数不得随楼层数增长（N=' + N + '）');
  }
});

test('A3 计数段跑两次逐字节相同（★ 计时段刻意排除在外）', () => {
  /* ★ 判据口径：只有**计数段**能要求逐字节复算。计时读数受进程调度与 GC 影响，
   *   把它并进来会让本条假红 —— 探针因此把 L4 单独放进 timing_criteria 块。 */
  const again = runProbe(null);
  assert.equal(again.status, 0, '二次跑必须成功');
  assert.equal(countBlock(JSON.parse(again.stdout)), countBlock(rep),
    '同一棵树跑两次，计数段必须逐字相同');
  assert.ok(base.timing_criteria && base.timing_criteria.length >= 1,
    '计时类判据必须单独成块（不得混进 criteria，否则上一条会假红）');
  /* ★ 口径：不得用裸 `ms` 作 token —— 它会撞 `items`（同族 token 撞词事故，见探针 corrections）。 */
  assert.equal(base.criteria.some((c) => /耗时|毫秒|[0-9]\.[0-9]+ ?ms/.test(c.got_text)), false,
    'criteria 里不得出现计时读数');
});

test('A4 fail-closed：读不到就拒判，绝不以 0 发合格证', () => {
  /* ① index.js 被掏空 */
  const d1 = makeCopy();
  fs.writeFileSync(path.join(d1, 'index.js'), '');
  const r1 = runProbe(d1);
  assert.equal(r1.status, 2, 'index.js 为空必须 exit 2，实测 ' + r1.status);
  assert.ok(/fail-closed/.test(String(r1.stderr)), '必须说明 fail-closed');
  /* ② 枚举面塌陷 */
  const d2 = makeCopy();
  fs.rmSync(path.join(d2, 'apps'), { recursive: true, force: true });
  const r2 = runProbe(d2);
  assert.equal(r2.status, 2, 'apps/ 不在场必须 exit 2，实测 ' + r2.status);
  /* ③ manifest 缺失（版本读数来源） */
  const d3 = makeCopy();
  fs.rmSync(path.join(d3, 'manifest.json'));
  const r3 = runProbe(d3);
  assert.equal(r3.status, 2, 'manifest.json 不在场必须 exit 2，实测 ' + r3.status);
  /* ④ --root 指向不存在的目录 */
  const r4 = runProbe(path.join(os.tmpdir(), 'rp_no_such_root_xyz'));
  assert.equal(r4.status, 2, '路径写错必须 exit 2，实测 ' + r4.status);
  /* ⑤ 正常树不得被判成 fail-closed */
  assert.equal(main.status, 0);
});

/* ══════════ B ── 回写防护 ══════════ */
test('B1 产品代码零改动（本版只取证；若实施，本判据会被主动改写而不是静默通过）', () => {
  /* ★ 判据面纪律：查「取数口形态」只能看**产品代码**，且必须先剥离内置公告
   *   （v3.9.0 抓到的第六类「读数说谎」：公告是散文，不是实现）。 */
  assert.ok(IDX_SRC.includes('const ST_PHONE_CURRENT_UPDATE'), '自证公告块确实在场（剥离面非空）');
  const at = IDX_SRC.indexOf('const ST_PHONE_CURRENT_UPDATE');
  const end = IDX_SRC.indexOf('};', at);
  const IDX_CODE = IDX_SRC.slice(0, at) + IDX_SRC.slice(at, end + 2).replace(/[^\n]/g, '') + IDX_SRC.slice(end + 2);
  /* 本版不得把截断前移：`items()` 里的全量 map 必须**仍在原处**（形态未变就是证据） */
  const gse = read(path.join(ROOT, 'apps', 'memory', 'global-search-engine.js'));
  assert.ok(/items: \(\) => ctx\.chat\.map\(/.test(gse),
    '本版不得改取数口（`items()` 仍应是全量 map —— 改了就该主动改写本条）');
  assert.ok(/MAX_SCAN_PER_SOURCE = 600/.test(gse), '引擎侧上限必须仍在 600');
  /* 不得引入任何「前移截断」的标记（本版未实施） */
  for (const tok of ['makeTavernSourceLazy', 'lazyItems', 'takeFromTail', 'headSlice']) {
    assert.equal(IDX_CODE.indexOf(tok), -1, 'index.js 不得引入 ' + tok);
    assert.equal(gse.indexOf(tok), -1, 'global-search-engine.js 不得引入 ' + tok);
  }
});

test('B2 探针位置无关：不得把绝对路径写死', () => {
  const code = PROBE_SRC.split('\n')
    .filter((l) => { const t = l.trim(); return !(t.slice(0, 2) === ' *' || t.slice(0, 2) === '/*' || t.slice(0, 2) === '//'); })
    .join('\n');
  assert.equal(/['"]\/home\//.test(code), false, '探针代码里不得出现 /home/ 绝对路径字面量');
  assert.ok(/--root/.test(PROBE_SRC), '根必须走 --root 入口');
  assert.ok(/__dirname/.test(PROBE_SRC), '默认根必须落在探针自身位置（位置无关）');
});

test('B3 三条形态纪律必须在源码里可见（公告剥离 / 计时分块 / 枚举面 fail-closed）', () => {
  assert.ok(/stripAnnouncement/.test(PROBE_SRC), '判据面必须先剥离内置公告（形态纪律一）');
  assert.ok(/timing_criteria/.test(PROBE_SRC), '计时类判据必须单独成块（形态纪律二）');
  assert.ok(/fail-closed/.test(PROBE_SRC) && /process\.exit\(2\)/.test(PROBE_SRC), '读不到必须 exit 2（形态纪律三）');
  assert.ok(/MEASURED_AT/.test(PROBE_SRC) && /manifest\.json/.test(PROBE_SRC), '版本必须从 manifest 读，不硬编码');
});

/* ══════════ C ── 结论面 ══════════ */
test('C1 结论必须逐条挂在读数上（不得只写一句「先不改」）', () => {
  const v = base.verdict;
  assert.ok(v && v.question && v.answer, '须有被问的问题与给的答案');
  const txt = v.reasons.join(' ');
  assert.ok(/8\/8\/8\/8\/8/.test(txt), '必须给出有界消费者的实测行数序列');
  assert.ok(/10\/100\/400\/1000\/2000/.test(txt), '必须给出物化对象数的实测序列');
  assert.ok(/600/.test(txt), '必须给出引擎侧上限读数');
  assert.ok(/物化之后|在物化之后|设在物化之后/.test(txt), '必须写明「上限设在物化之后」这个关键形态');
  assert.ok(/未观察到超线性|未观察超线性/.test(txt), '必须如实写明未观察到超线性（不得冒称性能危机）');
  assert.ok(/未实测|静态归类/.test(txt), '必须如实标出视图层站点未实测');
  assert.ok(v.not_blocked_by, '必须写明不阻其他项');
});

test('C2 唯一优化轴必须有读数支持且边界清楚（只改取数口 / 三面等价判据）', () => {
  const ax = base.verdict.only_axis;
  assert.ok(/截断前移/.test(ax), '轴必须围绕「把截断前移到取数口」');
  assert.ok(/不改.*契约/.test(ax), '必须写明不改跨仓契约');
  assert.ok(/判据/.test(ax), '必须自带判据（不是空口承诺）');
  assert.ok(/等价/.test(ax), '判据必须要求行为等价');
});

test('C3 修正面必须记下口径事故（本项最重要的沉淀）', () => {
  const txt = base.corrections.join(' ');
  assert.ok(/0 命中|假阴性/.test(txt), '必须记下扫描器正则 0 命中的口径事故');
  assert.ok(/有界|bounded|slice/.test(txt), '必须记下「有界物化」与「全量物化」不可混计');
  assert.ok(/不可.*复算|GC|调度/.test(txt), '必须记下计时读数不可复算');
  assert.ok(/公告/.test(txt), '必须记下「判据面被公告侵入」的形态');
});

/* ══════════ D ── 负控制（真破坏 → 同款真判据必须转红） ══════════ */
test('D1 把取数口改成有界（items 前移截断）⇒ L2 必须转红', () => {
  /* ★ 这一条守的是 L2「全表物化」是**活判据**：把 `ctx.chat.map(` 改成 `ctx.chat.slice(-600).map(`，
   *   物化对象数就不再等于楼层数 ⇒ L2 必须翻成 false。 */
  const r = damage(path.join('apps', 'memory', 'global-search-engine.js'),
    'items: () => ctx.chat.map((m, i) => ({',
    'items: () => ctx.chat.slice(-600).map((m, i) => ({');
  assert.equal(r.status, 0, '单点改形不得使探针拒判：' + String(r.stderr).slice(0, 200));
  const j = JSON.parse(r.stdout);
  const L2 = j.criteria.find((c) => c.id === 'L2');
  assert.equal(L2.pass, false, '取数口改成有界后，L2「物化对象数 == 楼层数」必须转红');
  assert.equal(j.readings['materialize_items_n2000'], 600, '物化对象数必须可观测地变小（2000 → 600）');
  assert.equal(j.readings['materialize_items_n100'], 100, '小于上限的采样点不受影响（100 → 100）');
});

test('D2 把有界消费者改成全量 ⇒ L1 必须转红', () => {
  /* 守「有界消费者」这一面：把 `ctx.chat.slice(-n).map` 改成 `ctx.chat.map`，
   *   输出行数就会随楼层数增长 ⇒ L1 必须翻红。 */
  const r = damage(path.join('config', 'phone-chat-memory.js'),
    'return ctx.chat.slice(-n).map(m => {',
    'return ctx.chat.map(m => {',
  );
  assert.equal(r.status, 0, '单点改形不得使探针拒判：' + String(r.stderr).slice(0, 200));
  const j = JSON.parse(r.stdout);
  const L1 = j.criteria.find((c) => c.id === 'L1');
  assert.equal(L1.pass, false, '有界消费者被改成全量后，L1 必须转红');
  assert.equal(j.readings['recent_story_context_lines_n1000'], 1000,
    '1000 楼下行数必须变成 1000（真判据对破坏有反应）');
});

test('D3 把取证对象写进公告 ⇒ 计数与判据必须一动不动（判据查代码不查散文）', () => {
  /* ★ 这一条是**真源码破坏型**负控制：往内置公告里塞进探针自己的形态词，
   *   探针的静态计数必须**一动不动**。若哪天有人把剥离逻辑删掉，本条会立刻转红。 */
  const dir = makeCopy();
  const ip = path.join(dir, 'index.js');
  const src = read(ip);
  const anchor = 'const ST_PHONE_CURRENT_UPDATE = {';
  assert.equal(src.split(anchor).length - 1, 1, '公告锚点必须恰中 1 次');
  const at = src.indexOf(anchor);
  const end = src.indexOf('};', at);
  assert.ok(end > at, '公告块必须有收尾');
  const injected = 'const ST_PHONE_CURRENT_UPDATE = { version: ST_PHONE_VERSION, ' +
    'date: "2026-09-27", items: ["本版优化长会话：chat.forEach 全表物化、chat.length 读取、' +
    'ctx.chat.map 均已前移截断"] };';
  fs.writeFileSync(ip, src.slice(0, at) + injected + src.slice(end + 2));
  /* 自证注入确实生效：换完的 index.js 里必须能读到那些形态词 */
  const after = read(ip);
  for (const tok of ['chat.forEach', 'chat.length', 'ctx.chat.map']) {
    assert.ok(after.includes(tok), '注入须生效（公告里应能读到 ' + tok + '）');
  }
  const r = runProbe(dir);
  assert.equal(r.status, 0, '公告被注入不得使探针崩溃：' + String(r.stderr).slice(0, 200));
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.scan, base.scan,
    '公告写了形态词 ⇒ 静态计数必须与基线逐项一致（判据查代码不查散文）');
  /* 比的是**计数**与**判据**；`sites` 里的行号会因公告块行数变化而整体平移，
   *   那不属于「判据面被侵入」，故不并入本条。 */
  assert.deepEqual(j.readings, base.readings, '读数不得被公告动摇');
  assert.deepEqual(j.criteria, base.criteria, '判据不得被公告动摇');
  assert.deepEqual(j.verdict, base.verdict, '结论不得被公告动摇');
  assert.equal(j.scan.full_materialize, base.scan.full_materialize, '全表物化计数必须不变');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（下限形）+ 基线与 manifest 同源', () => {
  const mv = JSON.parse(read(path.join(ROOT, 'manifest.json'))).version;
  const parts = mv.split('.').map(Number);
  const ok = parts[0] > 3 || (parts[0] === 3 && parts[1] >= 9);
  assert.ok(ok, '本套件成立于 RubyPhone 3.9.0 及以后，当前 ' + mv);
  assert.equal(base.measured_at, rep.measured_at, '基线与探针读数必须同源（版本从 manifest 读）');
  assert.equal(base.measured_at, 'v' + mv, '基线首测版必须等于当前 manifest 版本');
  assert.equal(base.probe, 'tests/audit/long_chat_probe.cjs', '基线必须指名探针路径');
});
