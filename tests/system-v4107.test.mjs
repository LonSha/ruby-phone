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

import { computePlanEntries, parsePlanEntry, headZoneOf, prioritySectionOf } from '../tools/gen_plan_baseline.mjs';

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

/* [v4.118 维护] 当期计划书路径与编号前缀一律从 PLAN.md 顶部入口真源派生，
 *  不得写死：本套件首发时把 v13 路径/前缀硬编码进判据，第十四期计划落盘后
 *  四条用例集体过期 —— 这正是 A3 自己宣称要防的「判据漂移」，先在自己身上应验。 */
const CURRENT = parsePlanEntry(PLAN());
const CURRENT_BOOK = CURRENT.optFile;   // 当期优化计划书（相对 ROOT）
const CURRENT_PREFIX = (CURRENT_BOOK.match(/-v(\d+)\.md$/) || [])[1]
  ? 'R' + (CURRENT_BOOK.match(/-v(\d+)\.md$/)[1] - 0)
  : null;
assert.ok(CURRENT.optFile && CURRENT.expFile, 'PLAN 顶部入口必须能解析出当期两份计划书');
assert.ok(CURRENT_PREFIX && /^[RX]/.test(CURRENT_PREFIX), '当期期号前缀必须可从文件名派生：' + CURRENT_PREFIX);

test('A3: 期号与日期必须真的从计划书真源派生，不得在判据里写死（改标题即变）', () => {
  /* ★ 本条是「判据不漂移」的自守，而且故意不用「源码里有正则」这种文本判据：
   *   那种写法只能证明「正则还在文件里」，不能证明「取数真的跟着真源走」。
   *   故直接改计划书标题里的中文期号，断言工具读出来的期号跟着变，
   *   且**同时**报出「PLAN 顶部入口未换挡」——派生与校对两段一起验。 */
  const base = computePlanEntries();
  assert.equal(base.ok, true, '对照组：原件必须是绿的');
  assert.ok(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(base.raw.date || ''), '必须能从计划书文件名解析出日期');
  assert.ok(base.raw.epoch, '必须能从计划书标题解析出中文期号');
  const BOOK = CURRENT_BOOK;
  const p = path.join(ROOT, BOOK);
  const original = fs.readFileSync(p, 'utf8');
  const st = fs.statSync(p);
  /* 把标题里的中文期号改成「第九十九期」（一个不可能与 PLAN 对齐的值），
   * 若工具把期号写死了，这里就读不出变化、也不会报未换挡 —— 即本条会转红。
   * [v4.159] 破坏点跟着文档形态走：只改**首行标题**里的「第X期」，
   *   不依赖 `# Agent Note:` 这个旧前缀（R24 起标题已改成 `# 第X期 · …`）。 */
  const first = original.split('\n', 1)[0];
  const tFirst = first.replace(/第[一二三四五六七八九十]+期/, '第九十九期');
  const tampered = tFirst === first ? original : tFirst + original.slice(first.length);
  assert.notEqual(tampered, original, '破坏锛点必须命中计划书标题');
  try {
    fs.writeFileSync(p, tampered, 'utf8');
    const r = computePlanEntries();
    assert.equal(r.raw.epoch, '九十九', '期号必须跟着真源变（写死的话读到的还是二十四）');
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

test('A4: 优先级节必须逐字列出当期全部编号（缺一个即红；只看现行节，历史节不算数）', () => {
  const r = computePlanEntries();
  const section = prioritySectionOf(PLAN());
  assert.ok(section, 'PLAN.md 必须有「## 优先级」节');
  const missing = r.raw.numbers.filter((n) => !section.includes(n));
  assert.deepEqual(missing, [], '优先级节缺当期编号：' + missing.join(' '));
  /* 现行节必须到下一个二级标题就停：历史优先级节里的编号不得替它作证。 */
  assert.ok(!/^##\s/m.test(section.slice(1)), '现行优先级节必须是独立的一段（历史节不得并入）');
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

test('B2: 抽样 — 计划书里每个 `### R<n>-*`（或 `## O<n> ·`）标题都必须在优先级节出现（不是只抽前几个）', () => {
  const r = computePlanEntries();
  const section = prioritySectionOf(PLAN());
  assert.ok(section, 'PLAN.md 必须有「## 优先级」节');
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

test('C1: 负控制 — 改现行期号（把顶部入口的「第二十四期」改掉），A1 必须转红', () => {
  const before = computePlanEntries();
  assert.equal(before.ok, true, '对照组：原件必须是绿的');
  const r = withTampered('PLAN.md', (s) => s.replace(/第[一二三四五六七八九十]+期产品计划（/, '第九期产品计划（'), () => computePlanEntries());
  assert.equal(r.ok, false, '改期号后必须转红');
  assert.ok(r.errors.some((e) => e.includes('顶部入口未换挡')), '必须精准点名「顶部入口未换挡」：' + r.errors.join('; '));
});

test('C2: 负控制 — 从优先级节删掉当期最后一个编号，A1 必须转红并点名', () => {
  const r = withTampered('PLAN.md', (s) => {
    const i = s.indexOf('\n## 优先级');
    const head = s.slice(0, i);
    const tail = s.slice(i).replace(new RegExp('`' + CURRENT_PREFIX + '-X9`', 'g'), '`' + CURRENT_PREFIX + '-X九`');
    assert.ok(tail.includes(CURRENT_PREFIX + '-X九'), '破坏锛点必须命中优先级节里的 ' + CURRENT_PREFIX + '-X9');
    return head + tail;
  }, () => computePlanEntries());
  assert.equal(r.ok, false, '删掉编号后必须转红');
  assert.ok(r.errors.some((e) => e.includes(CURRENT_PREFIX + '-X9')), '必须点名缺了 ' + CURRENT_PREFIX + '-X9：' + r.errors.join('; '));
});

test('C3: 负控制 — 把 TODO 的版本号改回 v4.54.0，A1 必须转红（45 版滞后的原样复现）', () => {
  const r = withTampered('TODO.md', (s) => s.replace(/^>\s*\*\*最近更新：v[0-9][0-9.]*\*\*/m, '> **最近更新：v4.54.0**'), () => computePlanEntries());
  assert.equal(r.ok, false, '改 TODO 版本后必须转红');
  assert.ok(r.errors.some((e) => e.includes('TODO.md 顶部最近更新 v4.54.0')), '必须点名 v4.54.0 滞后：' + r.errors.join('; '));
});

test('C4: 负控制 — 计划书里抽不到任何编号时必须报红（fail-closed，不许空集走完循环当通过）', () => {
  /* 两代文档形态都要打掉：旧 `### R24-O1`、新 `## O1 ·`。
   * 只打旧形态的话，新形态计划书根本命中不了，破坏就成了空转。 */
  const r = withTampered(CURRENT_BOOK,
    (s) => {
      const a = s.replace(new RegExp('^###\\s+' + CURRENT_PREFIX + '-O', 'gm'), '### 已删编号 O');
      return a.replace(/^##\s+([OX])([0-9]+)\s*[·:：.、]/gm, '## 已删编号 $1$2');
    },
    () => computePlanEntries());
  assert.equal(r.ok, false, '抽不到编号时必须报红');
  assert.ok(
    r.errors.some((e) => e.includes('一条') && e.includes('抽不到')) || r.errors.some((e) => e.includes('低于本期 9+9')),
    '必须明说编号抽不到/数量不足：' + r.errors.join('; ')
  );
});

test('C5: 负控制 — 顶部入口链接坏掉时必须报红（不是静默跳过校对）', () => {
  const r = withTampered('PLAN.md', (s) => s.replace('· [优化九项](', '· [优化九项](BROKEN/'), () => computePlanEntries());
  assert.equal(r.ok, false, '链接坏掉必须报红');
  assert.ok(
    r.errors.some((e) => e.includes('不存在')) || r.errors.some((e) => e.includes('链接')),
    '必须点名链接坏掉：' + r.errors.join('; ')
  );
});

/* ------------------------------------------------------------
 * A6：入口解析必须只看**顶部入口区**（本版抓到的第四处假绿）
 * ------------------------------------------------------------
 * 现象：第二十四期把入口文案从「[优化提升九项]」简化成「[优化九项]」，
 *   旧正则**全文**首匹配落空后继续后扫，命中第 23 期留档行 ⇒ 工具读到的是
 *   **已收口的上一期**。于是 C1「改现行期号」实测 r.ok = true —— 真破坏打不红。
 * 修法：现行入口 = 文件开头到第一条 `> ---` / `---` 分隔线之间。
 * 本条守三面：①边界真的截断；②历史行被改坏不影响取数；③入口改名时
 *   fail-closed 报红（而不是回退到历史链接）。
 * ------------------------------------------------------------ */
test('A6: 入口解析只看顶部入口区 — 历史留档行不得替现行入口作证', () => {
  const plan = PLAN();
  const head = headZoneOf(plan);

  /* ① 边界：顶部区必须是全文真子集，且不含任何历史期号/留档措辞 */
  assert.ok(head.length > 0 && head.length < plan.length, '顶部入口区必须是全文的真子集');
  assert.ok(plan.includes('第二十三期产品计划（'), '前提：全文仍有第 23 期留档行（旧写法的假绿来源）');
  assert.ok(!head.includes('第二十三期产品计划（'), '顶部入口区不得含历史期号 —— 否则历史行会替现行入口作证');
  assert.ok(!head.includes('已收口'), '顶部入口区不得含「已收口」这类留档措辞');

  /* ② 历史行改坏，取数必须一字不变（证明解析没有后扫） */
  const before = parsePlanEntry(plan);
  const brokenHistory = plan.replace('[优化提升九项](', '[优化提升九项](BROKEN-HISTORY/');
  assert.notEqual(brokenHistory, plan, '破坏锛点必须命中历史留档行的旧文案链接');
  const afterHist = parsePlanEntry(brokenHistory);
  assert.equal(afterHist.optFile, before.optFile, '历史行改坏后现行入口不得改变');
  assert.deepEqual(afterHist.errors, [], '历史行改坏不得让现行入口报错：' + afterHist.errors.join('; '));

  /* ③ 顶部入口文案改名 ⇒ fail-closed 报红，且不得回退到历史链接 */
  const renamed = plan.replace('· [优化九项](', '· [本期优化]( ');
  assert.notEqual(renamed, plan, '破坏锛点必须命中顶部入口链接');
  const afterRename = parsePlanEntry(renamed);
  assert.equal(afterRename.optFile, null, '顶部入口形态丢失时必须返回 null（不许回退历史链接）');
  assert.ok(
    afterRename.errors.some((e) => e.includes('入口形态丢失')),
    '必须点名入口形态丢失：' + afterRename.errors.join('; ')
  );
});

/* ------------------------------------------------------------
 * A7：期号只能有一处口径（标题 vs 文件名）
 * ------------------------------------------------------------
 * 与 A3 的分工：A3 走「标题 vs PLAN 顶部入口」，本条走「标题 vs 文件名」。
 * 两条同时绿才说明期号没有被拆成两个各说各话的真源 ——
 * 「改了标题忘了改名」这种半截换挡，此前全文 includes 那条路永远看不见。
 * ------------------------------------------------------------ */
test('A7: 标题期号与文件名期号必须同源 — 半截换挡必须报红', () => {
  const r = withTampered(CURRENT_BOOK, (s) => {
    const first = s.split('\n', 1)[0];
    const tamperedFirst = first.replace(/第[一二三四五六七八九十]+期/, '第九十九期');
    assert.notEqual(tamperedFirst, first, '破坏锛点必须命中计划书首行标题里的期号');
    return tamperedFirst + s.slice(first.length);
  }, () => computePlanEntries());
  assert.equal(r.ok, false, '只改标题不改文件名（半截换挡）必须报红');
  assert.ok(r.errors.some((e) => e.includes('期号两处不一致')), '必须点名期号两处不一致：' + r.errors.join('; '));
});
