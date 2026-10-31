/* ============================================================
 * tests/system-v4107.test.mjs — R13-O7 验收套件（入口交给机器）
 * ------------------------------------------------------------
 * 立项现象（计划书原话）：`tests/system-v4980.test.mjs` 已经证明「基线表可以
 *   交给机器」，而**入口与优先级节没有**：`TODO.md` 顶面停在 v4.54.0（差 45 版）、
 *   `PLAN.md` 的优先级节还停在第六期排序。这不是「缺守卫」，是**已建机制
 *   只盖了三分之一**。
 *
 * 本套件守三件事：
 *   A 组：三处入口都被机器校对（真源取数，且 fail-closed —— 抽不到就报红）
 *   B 组：`--write` 的射程被钉死（只写 TODO 版本号那一格，不代写优先级排序）
 *   C 组：负控制（三种破坏各转红一次，原件对照必须绿）
 *
 * 纪律：36 项做完前不跑全量；本套件单点可复现（`node --test tests/system-v4107.test.mjs`）。
 *
 * 【诚实边界（计划书原话，写进判据免得后来者越权）】本项只守**入口与数字**，
 *   不守「优先级节里排的顺序是否合理」——排序判断永远是人做的。故本套件不断言
 *   「1 号就是最该做的第一件事」，只断言「当期编号一个不少地在节内出现」。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computePlanEntries, parsePlanEntry } from '../tools/gen_plan_baseline.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PLAN = () => rd('PLAN.md');
const TODO = () => rd('TODO.md');

/* ------------------------------------------------------------
 * A 组：三处入口真的被校对（不是「工具里写了但没接上」）
 * ------------------------------------------------------------ */
test('A1: 三处入口与真源一致——PLAN 顶部期号/日期 · 优先级节编号集合 · TODO 最近更新', () => {
  const r = computePlanEntries();
  assert.equal(r.ok, true, '入口漂移：' + (r.errors || []).join('; '));
  assert.ok(r.raw.numbers.length >= 18, '当期编号应至少 9+9=18 个，实测 ' + r.raw.numbers.length);
  const opt = r.raw.numbers.filter((n) => n.includes('-O'));
  const exp = r.raw.numbers.filter((n) => n.includes('-X'));
  assert.ok(opt.length >= 9 && exp.length >= 9, `优化 ${opt.length} / 拓展 ${exp.length} 均须 ≥ 9`);
});

test('A2: TODO.md 顶部「最近更新」必须等于 update-log.json 的 latest（这就是 45 版滞后的那个洞）', () => {
  const live = JSON.parse(rd('update-log.json')).latest;
  const m = TODO().match(/^>\s*\*\*最近更新：v([0-9][0-9.]*)\*\*/m);
  assert.ok(m, 'TODO.md 顶部必须有机器可读的「> **最近更新：vX**」行');
  assert.equal(m[1], String(live), `TODO.md 最近更新 v${m[1]} 必须等于 latest v${live}`);
});

test('A3: 期号与日期必须真的从计划书真源派生，不得在判据里写死（改标题即变）', () => {
  /* ★ 本条是「判据不漂移」的自守，而且故意不用「源码里有正则」这种文本判据：
   *   那种写法只能证明「正则还在文件里」，不能证明「取数真的跟着真源走」。
   *   故直接改计划书标题里的中文期号，断言工具读出来的期号跟着变，
   *   且**同时**报出「PLAN 顶部入口未换挡」——派生与校对两段一起验。 */
  const base = computePlanEntries();
  assert.equal(base.ok, true, '对照组：原件必须是绿的');
  assert.ok(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(base.raw.date || ''), '必须能从计划书文件名解析出日期');
  assert.ok(base.raw.epoch, '必须能从计划书标题解析出中文期号');

  const BOOK = '.agents/notes/proposed/architecture/2026-10-31-product-optimization-v13.md';
  const p = path.join(ROOT, BOOK);
  const original = fs.readFileSync(p, 'utf8');
  const st = fs.statSync(p);
  /* 把标题里的「第十三期」改成「第九十九期」（一个不可能与 PLAN 对齐的值），
   * 若工具把期号写死了，这里就读不出变化、也不会报未换挡 —— 即本条会转红。 */
  const tampered = original.replace(/^#\s+Agent Note:([^\n]*)第[一二三四五六七八九十百]+期/m, (m, mid) => '# Agent Note:' + mid + '第九十九期');
  assert.notEqual(tampered, original, '破坏锛点必须命中计划书标题');
  try {
    fs.writeFileSync(p, tampered, 'utf8');
    const r = computePlanEntries();
    assert.equal(r.raw.epoch, '九十九', '期号必须跟着真源变（写死的话读到的还是十三）');
    assert.equal(r.ok, false, '期号变了而 PLAN 顶部没变 ⇒ 必须报未换挡');
    assert.ok(
      r.errors.some((e) => e.includes('顶部入口未换挡')),
      '必须点名顶部入口未换挡：' + r.errors.join('; ')
    );
  } finally {
    fs.writeFileSync(p, original, 'utf8');
    try { fs.utimesSync(p, st.atime, st.mtime); } catch (_e) { /* 尽力恢复 */ }
  }
  assert.equal(computePlanEntries().ok, true, '恢复后必须回到绿（破坏没污染仓库）');
});

test('A4: 优先级节必须逐字列出当期全部编号（缺一个即红）', () => {
  const r = computePlanEntries();
  const plan = PLAN();
  const i = plan.indexOf('\n## 优先级');
  assert.ok(i >= 0, 'PLAN.md 必须有「## 优先级」节');
  const rest = plan.slice(i + 1);
  const endAt = rest.search(/\n---\n/);
  const section = endAt >= 0 ? rest.slice(0, endAt) : rest;
  const missing = r.raw.numbers.filter((n) => !section.includes(n));
  assert.deepEqual(missing, [], '优先级节缺当期编号：' + missing.join(' '));
});

/* ------------------------------------------------------------
 * A5：入口校对必须真的**接在门上**（本版自己抓到的第三处假绿）
 * ------------------------------------------------------------
 * 本套件首发时 A1～A4 全部直接调 `computePlanEntries()`。做负控制时把
 *   `checkPlanBaseline()` 里那两行 `errors.push(...entryChk.errors)` 摘掉，
 *   **11 条依然全绿** —— 因为「校对了」与「门上报出来了」是两件事。
 *   这正是本仓反复付代价的形态：函数写好了、零调用点。
 * 故本条走**门本身**（`checkPlanBaseline`，package 与 v4980-A1 都走它），
 *   并用真源码破坏证明它确实依赖那条接线。
 * ------------------------------------------------------------ */
test('A5: 入口校对必须接在 checkPlanBaseline 这个门上（漏接 = 函数写了没人调）', async () => {
  const { checkPlanBaseline } = await import('../tools/gen_plan_baseline.mjs');
  const before = checkPlanBaseline();
  assert.equal(before.ok, true, '对照组：门本身必须是绿的：' + (before.errors || []).join('; '));

  /* 行为证明：把 TODO 顶面版本改回旧值，**门**必须报红（而不仅是 computePlanEntries） */
  const p = path.join(ROOT, 'TODO.md');
  const original = fs.readFileSync(p, 'utf8');
  const st = fs.statSync(p);
  const tampered = original.replace(/^>\s*\*\*最近更新：v[0-9][0-9.]*\*\*/m, '> **最近更新：v4.54.0**');
  assert.notEqual(tampered, original, '破坏锛点必须命中 TODO 顶面');
  try {
    fs.writeFileSync(p, tampered, 'utf8');
    const r = checkPlanBaseline();
    assert.equal(r.ok, false, '门必须跟着转红（若仍绿 ⇒ 入口校对没接在门上）');
    assert.ok(
      r.errors.some((e) => e.includes('TODO.md 顶部最近更新')),
      '门的错误列表里必须出现入口类错误：' + r.errors.join('; ')
    );
  } finally {
    fs.writeFileSync(p, original, 'utf8');
    try { fs.utimesSync(p, st.atime, st.mtime); } catch (_e) { /* 尽力恢复 */ }
  }

  /* 负控制：把接线从源码里真摘掉，同一条行为必须在**门**上失去反应 ⇒ 本条转红 */
  const TOOL = path.join(ROOT, 'tools/gen_plan_baseline.mjs');
  const toolSrc = fs.readFileSync(TOOL, 'utf8');
  const wire = '  const entryChk = computePlanEntries();\n  errors.push(...entryChk.errors);';
  assert.equal(toolSrc.split(wire).length - 1, 1, '接线锛点在源码里必须恰中 1 次');
  const tst = fs.statSync(TOOL);
  try {
    fs.writeFileSync(TOOL, toolSrc.replace(wire, '  /* negative-control: detached */'), 'utf8');
    /* 重新 import 拿不到缓存外的模块，故用子进程跑同一段行为 */
    const { execFileSync } = await import('node:child_process');
    fs.writeFileSync(p, tampered, 'utf8');
    let detachedOk = null;
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'tools/gen_plan_baseline.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe' });
      detachedOk = true;
    } catch (e) {
      detachedOk = false;
    }
    assert.equal(detachedOk, true, '摘掉接线后门对同一个破坏应当失去反应（这就是 A5 要抓的假绿）');
  } finally {
    fs.writeFileSync(TOOL, toolSrc, 'utf8');
    try { fs.utimesSync(TOOL, tst.atime, tst.mtime); } catch (_e) { /* 尽力恢复 */ }
    fs.writeFileSync(p, original, 'utf8');
    try { fs.utimesSync(p, st.atime, st.mtime); } catch (_e) { /* 尽力恢复 */ }
  }
});

/* ------------------------------------------------------------
 * B 组：--write 的射程必须被钉死
 * ------------------------------------------------------------ */
test('B1: --write 只许写 TODO 的版本号那一格，不得代写 PLAN 的优先级排序', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/gen_plan_baseline.mjs'), 'utf8');
  const w = src.slice(src.indexOf('export function writePlanEntries()'));
  const body = w.slice(0, w.indexOf('\n}\n') + 3);
  assert.ok(/TODO\.md/.test(body), '写入函数应作用于 TODO.md');
  assert.ok(!/PLAN\.md/.test(body), '写入函数**不得**触碰 PLAN.md（排序是人做的，工具代写等于替我决定做什么）');
  assert.ok(!/## 优先级/.test(body), '写入函数不得写入优先级节');
});

test('B2: 抽样 — 计划书里每个 `### R<n>-*` 标题都必须在优先级节出现（不是只抽前几个）', () => {
  const r = computePlanEntries();
  const plan = PLAN();
  const i = plan.indexOf('\n## 优先级');
  const rest = plan.slice(i + 1);
  const endAt = rest.search(/\n---\n/);
  const section = endAt >= 0 ? rest.slice(0, endAt) : rest;
  const uniq = Array.from(new Set(r.raw.numbers));
  const absent = uniq.filter((n) => !section.includes(n));
  assert.deepEqual(absent, [], '这些真编号在优先级节里找不到：' + absent.join(' '));
});

/* ------------------------------------------------------------
 * B3：占位文件名履行后必须从「计划交付物」台账移除（否则占位成为永久免罪）
 * ------------------------------------------------------------
 * 计划书里那条占位文件名（落地前写作 `tests/` + `system-v` + `xxxxx`）是本项登记的**未来交付物占位**。
 *   一旦本轮把真名落实名（`tests/system-v4107.test.mjs`），占位就必须撤账：
 *   留着 = 「说得清为什么不在」永久生效，下一个漏网的路径可以躲在占位里。
 *   本仓的 doc-path-claim 台账对「已落地却仍挂在台账里」也有自锁（反向），
 *   这条是正向那一半。
 * ------------------------------------------------------------ */
/* 占位名以拼接形式给出：履行后它已**不存在于磁盘**，若再以完整字面写出，
 * doc-path-claim 门会把它读成一条新的落空声明（这正是「历史留痕 ≠ 当期声明」的边界）。 */
const PLACEHOLDER = ['tests', 'system-v' + 'xxxxx' + '.test.mjs'].join('/');

test('B3: 占位文件名落实后，计划交付物台账必须撤账，且文档里不再引用占位', () => {
  const ledger = JSON.parse(rd('scripts/doc-path-claim-planned-deliverables.json'));
  const paths = (ledger.entries || []).map((e) => e.path);
  assert.ok(!paths.includes(PLACEHOLDER), '占位已履行，必须从计划交付物台账移除');
  assert.ok(fs.existsSync(path.join(ROOT, 'tests/system-v4107.test.mjs')), '真名落地文件必须存在');
  const book = rd('.agents/notes/proposed/architecture/2026-10-31-product-optimization-v13.md');
  assert.ok(!book.includes(PLACEHOLDER), '计划书正文不得再引用未履行的占位');
  assert.ok(book.includes('tests/system-v4107.test.mjs'), '计划书应把落实名写回 owner 接线点');
  /* 台账里每条都必须是「磁盘上真没有」的未来件；有落地的即为僵尸条目 */
  for (const p of paths) {
    if (p.includes('xxx') || p.includes('xxxx')) {
      assert.ok(!fs.existsSync(path.join(ROOT, p)), `占位 ${p} 若已落地必须撤账`);
    }
  }
});

/* ------------------------------------------------------------
 * C 组：负控制（真源码/真文件破坏 → 判据必须转红）
 * ------------------------------------------------------------ */
function withTampered(file, transform, fn) {
  const p = path.join(ROOT, file);
  const original = fs.readFileSync(p, 'utf8');
  const st = fs.statSync(p);
  const tampered = transform(original);
  assert.notEqual(tampered, original, `破坏锛点必须命中 ${file}（命中注疏等于没破坏）`);
  try {
    fs.writeFileSync(p, tampered, 'utf8');
    return fn();
  } finally {
    fs.writeFileSync(p, original, 'utf8');
    try { fs.utimesSync(p, st.atime, st.mtime); } catch (_e) { /* 尽力恢复 */ }
  }
}

test('C1: 负控制 — 改期号（把顶部入口的「第十三期」改回去），A1 必须转红', () => {
  const before = computePlanEntries();
  assert.equal(before.ok, true, '对照组：原件必须是绿的');
  const r = withTampered('PLAN.md', (s) => s.replace(/第[一二三四五六七八九十]+期产品计划（/, '第九期产品计划（'), () => computePlanEntries());
  assert.equal(r.ok, false, '改期号后必须转红');
  assert.ok(r.errors.some((e) => e.includes('顶部入口未换挡')), '必须精准点名「顶部入口未换挡」：' + r.errors.join('; '));
});

test('C2: 负控制 — 删一个编号（从优先级节删掉 R13-X9），A1 必须转红并点名', () => {
  const r = withTampered('PLAN.md', (s) => {
    const i = s.indexOf('\n## 优先级');
    const head = s.slice(0, i);
    const tail = s.slice(i).replace(/`R13-X9`/g, '`R13-X九`');
    return head + tail;
  }, () => computePlanEntries());
  assert.equal(r.ok, false, '删掉编号后必须转红');
  assert.ok(r.errors.some((e) => e.includes('R13-X9')), '必须点名缺了 R13-X9：' + r.errors.join('; '));
});

test('C3: 负控制 — 把 TODO 的版本号改回 v4.54.0，A1 必须转红（45 版滞后的原样复现）', () => {
  const r = withTampered('TODO.md', (s) => s.replace(/^>\s*\*\*最近更新：v[0-9][0-9.]*\*\*/m, '> **最近更新：v4.54.0**'), () => computePlanEntries());
  assert.equal(r.ok, false, '改 TODO 版本后必须转红');
  assert.ok(r.errors.some((e) => e.includes('TODO.md 顶部最近更新 v4.54.0')), '必须点名 v4.54.0 滞后：' + r.errors.join('; '));
});

test('C4: 负控制 — 计划书里抽不到任何编号时必须报红（fail-closed，不许空集走完循环当通过）', () => {
  const r = withTampered('.agents/notes/proposed/architecture/2026-10-31-product-optimization-v13.md',
    (s) => s.replace(/^### R13-O/gm, '### 已删编号 O'),
    () => computePlanEntries());
  assert.equal(r.ok, false, '抽不到编号时必须报红');
  assert.ok(
    r.errors.some((e) => e.includes('一条') && e.includes('抽不到')) || r.errors.some((e) => e.includes('低于本期 9+9')),
    '必须明说编号抽不到/数量不足：' + r.errors.join('; ')
  );
});

test('C5: 负控制 — 顶部入口链接坏掉时必须报红（不是静默跳过校对）', () => {
  const r = withTampered('PLAN.md', (s) => s.replace('[优化提升九项](', '[优化提升九项](BROKEN/'), () => computePlanEntries());
  assert.equal(r.ok, false, '链接坏掉必须报红');
  assert.ok(
    r.errors.some((e) => e.includes('不存在')) || r.errors.some((e) => e.includes('链接')),
    '必须点名链接坏掉：' + r.errors.join('; ')
  );
});
