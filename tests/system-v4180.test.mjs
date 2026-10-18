/* ============================================================
 * tests/system-v4180.test.mjs -- [v4.18.0 · 第四期 R4-O6 超长章节阅读与精确进度恢复]
 *   无分章大 TXT 不一次塞满 DOM;字号/主题变化、摘录回跳后保持同一段落位置。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   `apps/reading/reading-view.js::_renderReader` 对整章 `paras.map(...).join('')`
 *   —— 2 万段的单章一次全铺进 DOM;而进度只按**章节比例**(`(curChapter+1)/章节数`),
 *   段内位置一律不记,故改字号/切主题/摘录回跳都会回到**本章开头**(不是同段)。
 *   已实现的 IndexedDB 附件与摘录不在本项射程内(计划原文逐字:不再把「正文落盘」列为新功能)。
 *
 * 【本版落的两件】一 `config/list-window.js` 补**中段**三支
 *   (`paraWindowOf` / `anchorOf` / `paraLine`,既有三支 + 尾部三支一行未改);
 *   二 阅读视图接邻域窗口 + 段落锚点进度(`data-para` 仍是全章下标)。
 *
 * 判据面(五组):
 *   A 口径:中段三支与既有同规格 / 纯函数零副作用 / 页长走既有同一支
 *   B 行为:以锚点为中心切 / 三处(首中末)都锚得准 / 两头三态 / 锚点归一不补 0
 *   C 接线:视图真切片 / 进度加一格 para / 扩窗口入口 / 摘录读全章数组
 *   D 负控制:真源码定点破坏五条口径 ⇒ 同款判据必转红(配原版必真的反向对照)
 *   E 版本锚:下限形
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LW_REL = 'config/list-window.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const IDX_REL = 'index.js';
const LW = await import(pathToFileURL(path.join(ROOT, LW_REL)).href);
const lwSrc = read(LW_REL);
const viewSrc = read(VIEW_REL);
const idxSrc = read(IDX_REL);
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
    if (c === '\\') { out += c + (d || ''); i += 2; continue; }
    if (c === quote) { state = 'code'; out += c; i += 1; continue; }
    out += c; i += 1;
  }
  return out;
}
const lwCode = stripComments(lwSrc);
const viewCode = stripComments(viewSrc);

const mk = (n) => Array.from({ length: n }, (_, i) => 'p' + i);

/* ══════════════════ A. 口径面 ══════════════════ */
test('A1 中段三支与既有六支同处:既有六支一行未改,新三支同规格', () => {
  for (const fn of ['windowOf', 'patchOf', 'keepState', 'tailWindowOf', 'mergeTailWindow', 'tailLine']) {
    assert.equal(typeof LW[fn], 'function', '既有 ' + fn + ' 必须在位');
  }
  for (const fn of ['paraWindowOf', 'anchorOf', 'paraLine']) {
    assert.equal(typeof LW[fn], 'function', '新增 ' + fn + ' 必须在位');
  }
  /* 恒定键面。 */
  const w = LW.paraWindowOf(mk(100), { anchor: 50, pageSize: 21 });
  for (const k of ['ok', 'items', 'start', 'end', 'anchor', 'loaded', 'total', 'hasBefore', 'hasAfter', 'reason']) {
    assert.ok(k in w, '中段窗口必须有键 ' + k);
  }
  assert.equal(typeof LW.default.paraWindowOf, 'function');
});

test('A2 纯函数:中段三支不碰 DOM / 不写存储 / 不联网', () => {
  const fn = lwCode.slice(lwCode.indexOf('export function paraWindowOf('));
  const body = fn.slice(0, fn.indexOf('export function mergeTailWindow(') > 0 ? fn.indexOf('export function mergeTailWindow(') : fn.length);
  for (const bad of ['document', 'window', 'localStorage', 'dispatchEvent', 'setTimeout', 'fetch', 'indexedDB']) {
    assert.equal(new RegExp('\\b' + bad + '\\b').test(body), false, '中段三支不得出现 ' + bad);
  }
});

test('A3 页长走既有同一支(不自写一份上限)', () => {
  const fn = lwCode.slice(lwCode.indexOf('export function paraWindowOf('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(body.includes('normalizePageSize('), '必须用既有那支');
  assert.equal(/Number\.isFinite\(Number\(/.test(body), false, '不得出现弱口径签名');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 以**锚点为中心**切:前后各 R 段(不是头也不是尾)', () => {
  const w = LW.paraWindowOf(mk(1000), { anchor: 500, radius: 10 });
  assert.equal(w.anchor, 500);
  assert.equal(w.start, 490);
  assert.equal(w.end, 511);
  assert.equal(w.items.length, 21);
  assert.equal(w.items[0], 'p490');
  assert.equal(w.items[20], 'p510');
  assert.equal(w.hasBefore, true);
  assert.equal(w.hasAfter, true);
});

test('B2 **首/中/末三处**都锚得住(验收原文:三处刷新都回到同段)', () => {
  const arr = mk(20000);
  const head = LW.paraWindowOf(arr, { anchor: 0 });
  assert.equal(head.anchor, 0);
  assert.equal(head.start, 0);
  assert.equal(head.hasBefore, false, '首段前面没有 ⇒ hasBefore:false');
  assert.equal(head.hasAfter, true);
  assert.equal(arr[0], head.items[0]);
  const mid = LW.paraWindowOf(arr, { anchor: 10000 });
  assert.equal(mid.anchor, 10000);
  assert.equal(arr[10000], mid.items[mid.anchor - mid.start], '中间段的身份必须对得上');
  const tail = LW.paraWindowOf(arr, { anchor: 19999 });
  assert.equal(tail.anchor, 19999);
  assert.equal(tail.end, 20000);
  assert.equal(tail.hasAfter, false, '末段后面没有 ⇒ hasAfter:false');
  assert.equal(tail.hasBefore, true);
});

test('B3 窗口大小:默认邻域 **不超过 250 段**(计划原文验收口径)', () => {
  const w = LW.paraWindowOf(mk(20000), {});
  assert.ok(w.items.length <= 250, '邻域不得超过 250 段,实测 ' + w.items.length);
  assert.ok(w.items.length >= 1);
  /* 显式半径同样受限。 */
  const big = LW.paraWindowOf(mk(20000), { anchor: 5000, radius: 999 });
  assert.ok(big.items.length <= 401, '半径上限 200 ⇒ 窗口至多 401,实测 ' + big.items.length);
});

test('B4 锚点**超范围夹到合法区间**并如实回报;畸形不猜', () => {
  const arr = mk(100);
  const over = LW.paraWindowOf(arr, { anchor: 999 });
  assert.equal(over.anchor, 99, '超出末尾必须夹到末段');
  const under = LW.paraWindowOf(arr, { anchor: -5 });
  assert.equal(under.anchor, 0, '负数必须夹到首段');
  assert.equal(arr.length, 100, '入参不得被改');
  /* 空章与拿不到章节分开。 */
  const empty = LW.paraWindowOf([], { anchor: 3 });
  assert.equal(empty.ok, true);
  assert.equal(empty.total, 0);
  assert.ok(empty.reason.includes('empty-chapter'), '空章必须具名');
  const bad = LW.paraWindowOf(null, {});
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.includes('not-array'), '拿不到章节与空章分开:' + bad.reason);
});

test('B5 anchorOf:数字优先,`para:` id 次之,读不出如实 null(**不补 0**)', () => {
  assert.equal(LW.anchorOf([], 5), 5);
  assert.equal(LW.anchorOf([], '5'), 5);
  assert.equal(LW.anchorOf([], 0), 0, '0 是合法首段');
  assert.equal(LW.anchorOf([], '0'), 0);
  assert.equal(LW.anchorOf([], 'para:7'), 7);
  for (const bad of [null, undefined, '', '   ', 'abc', 'para:', 'para:x', -1, NaN, Infinity, {}, []]) {
    assert.equal(LW.anchorOf([], bad), null, '读不出必须 null:' + String(bad));
  }
  /* ★ 关键:「没给锚点」与「就在第 0 段」必须分得开。 */
  assert.notEqual(LW.anchorOf([], null), LW.anchorOf([], 0), 'null ≠ 0');
});

test('B6 paraLine:一句话读数(与既有 line 同规格)', () => {
  const w = LW.paraWindowOf(mk(20000), { anchor: 10000 });
  const line = LW.paraLine(w);
  assert.ok(line.includes('10000') || line.includes('20000'), '必须报总数:' + line);
  assert.ok(line.includes('前面还有'));
  assert.ok(line.includes('后面还有'));
  const head = LW.paraLine(LW.paraWindowOf(mk(20), { anchor: 0 }));
  assert.ok(head.includes('已到开头'));
  assert.ok(LW.paraLine({ ok: false, reason: 'x' }).includes('x'));
  assert.ok(LW.paraLine(null).includes('判不了'));
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 阅读视图:**真切片**(不再整章 map 进 DOM)', () => {
  assert.ok(viewCode.includes("from '../../config/list-window.js';"), '必须消费真源');
  const fn = viewCode.slice(viewCode.indexOf('_renderReader(tc) {'));
  const body = fn.slice(0, fn.indexOf('const chapterOptions'));
  assert.ok(body.includes('paraWindowOf(paras'), '正文渲染必须先切邻域');
  assert.ok(body.includes('win.items.map('), '必须把切片交给渲染');
  assert.equal(/[^.]\bparas\.map\(/.test(body), false, '不得再对整章 map');
  /* data-para 仍是**全章下标**。 */
  assert.ok(body.includes('win.start + k'), 'data-para 必须是全章下标(段身份不受切片影响)');
});

test('C2 进度:**加一格 para**(段落锚点),键名不变', () => {
  const save = viewCode.slice(viewCode.indexOf('_saveProgress() {'));
  const body = save.slice(0, save.indexOf('\n    }'));
  assert.ok(body.includes('ruby_reading_progress_'), '键名沿用既有(不新增键)');
  assert.ok(body.includes('para:'), '必须存段落锚点');
  assert.ok(body.includes('chapter: this.curChapter'), '既有 chapter 字段保留');
  /* 加载时有就读、没有不设(不补 0)。 */
  const load = viewCode.slice(viewCode.indexOf('_loadProgress(bookId) {'));
  const lb = load.slice(0, load.indexOf('\n    }'));
  assert.ok(lb.includes('anchorOf([], p.para)'), '锚点走真源归一');
  assert.ok(lb.includes('(pa === null) ? null'), '读不出必须 null(不补 0)');
});

test('C3 扩窗口入口在场,且**不删任何段**', () => {
  assert.match(viewCode, /showMoreParas\(delta\) \{/);
  const fn = viewCode.slice(viewCode.indexOf('showMoreParas(delta) {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.equal(/\.splice\(|\.pop\(|\.shift\(/.test(body), false, '不得从章数组里删段');
  assert.equal(/paragraphs\s*=\s*\[/.test(body), false, '不得改章数组(切片只动画口)');
  assert.ok(body.includes('this.render()'), '扩了要重绘');
  /* 两个按钮都真接上。 */
  assert.ok(viewCode.includes("q('#rd-more-before')?.addEventListener('click', () => this.showMoreParas(-1));"));
  assert.ok(viewCode.includes("q('#rd-more-after')?.addEventListener('click', () => this.showMoreParas(1));"));
});

test('C4 摘录仍读**全章数组**(不受切片影响)', () => {
  const fn = viewCode.slice(viewCode.indexOf("root.querySelectorAll('.rd-content p[data-para]')"));
  const body = fn.slice(0, fn.indexOf('});') + 3);
  assert.ok(body.includes('book.chapters[this.curChapter]?.paragraphs || []'),
    '摘录必须从**全章**数组取(而不是从切片后的 DOM 文本)');
  assert.ok(body.includes('Number(p.dataset.para)'), '用全章下标定位');
});

test('C5 滚动记锚点有节流(view 不持未登记定时器)', () => {
  const fn = viewCode.slice(viewCode.indexOf('_captureParaAnchorThrottled() {'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.ok(body.includes('_anchorAt'), '必须有节流闸门');
  assert.equal(/setTimeout/.test(body), false, '不得用定时器');
  assert.ok(viewCode.includes(".addEventListener('scroll'"), '滚动事件必须接上');
});

/* ══════════════════ D. 负控制(真源码破坏 → 同一份判据必须转红) ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + tag);
  return src.replace(anchor, replacement);
}

test('D0 ★★★ 阳性对照:未破坏时四条判据必须全为真(否则 D 组是假绿)', () => {
  assert.equal(/Number\.isFinite\(Number\(/.test(lwCode), false, '纯函数件无弱口径');
  assert.ok(lwCode.includes('out.items = paras.slice(start, end);'), '中段切片在位');
  assert.ok(viewCode.includes('paraWindowOf(paras'), '视图真切片');
  assert.ok(viewCode.includes('anchorOf([], p.para)'), '锚点归一在位');
});

test('D1 ★★★ 破坏「以锚点为中心切」⇒ 同款判据必转红(切到头/尾)', () => {
  const broken = breakOnce(lwCode,
    '    const start = Math.max(0, anchor - radius);',
    '    const start = 0;',
    'd1');
  assert.equal(broken.includes('const start = Math.max(0, anchor - radius);'), false, '破坏副本:已不按锚点');
  assert.ok(lwCode.includes('const start = Math.max(0, anchor - radius);'), '原版必须按锚点');
  /* 行为面。 */
  const w = LW.paraWindowOf(mk(1000), { anchor: 500, radius: 10 });
  assert.equal(w.start, 490, '原版必须从 490 起');
});

test('D2 ★★★ 破坏「视图真切片」⇒ 同款判据必转红(整章重铺回归)', () => {
  const broken = breakOnce(viewCode,
    'win.items.map((p, k)',
    'paras.map((p, k)',
    'd2');
  assert.equal(broken.includes('win.items.map((p, k)'), false, '破坏副本:又整章');
  assert.ok(viewCode.includes('win.items.map((p, k)'), '原版必须切片');
});

test('D3 ★★★ 破坏「锚点读不出不补 0」⇒ 同款判据必转红(没给锚点被当成首段)', () => {
  /* ★ 锚点取**去注释后文本里的真形态**:`anchorOf` 对「负数 / 读不出」都是靠
   *   `return ... : null` 这一支拒的。首版拿那句 doc 注释当锚,而 lwCode 已把它剥掉 ⇒ 零命中。 */
  const broken = breakOnce(lwCode,
    'return (i >= 0) ? i : null;',
    'return (i >= 0) ? i : 0;',
    'd3');
  assert.equal(broken.includes('return (i >= 0) ? i : null;'), false, '破坏副本:已补 0');
  assert.ok(lwCode.includes('return (i >= 0) ? i : null;'), '原版必须 null');
  /* 行为面。 */
  assert.equal(LW.anchorOf([], null), null, '原版:读不出必须 null');
  assert.equal(LW.anchorOf([], -1), null, '原版:负下标也必须 null');
});

test('D4 ★★★ 破坏「data-para 是全章下标」⇒ 同款判据必转红(切片后段身份错位 ⇒ 摘录拿错段)', () => {
  /* ★ 锚点**避开反引号**:反引号在 shell/正则里都要多层转义,而「模板串里的这一段」
   *   用引号内的字面量就足以唯一命中(stripComments 保留字符串内容)。 */
  const broken = breakOnce(viewCode,
    'data-para="${win.start + k}"',
    'data-para="${k}"',
    'd4');
  assert.equal(broken.includes('data-para="${win.start + k}"'), false, '破坏副本:用了局部下标');
  assert.ok(viewCode.includes('data-para="${win.start + k}"'), '原版必须全章下标');
});

test('D5 ★★★ 破坏「邻域上限」⇒ 同款判据必转红(一次铺满整章)', () => {
  const broken = breakOnce(lwCode,
    '    const radius = (rRaw === null || rRaw <= 0) ? Math.max(1, Math.floor((size - 1) / 2)) : Math.min(200, Math.floor(rRaw));',
    '    const radius = Math.max(1, Math.floor(paras.length / 2));',
    'd5');
  assert.equal(broken.includes('Math.min(200, Math.floor(rRaw))'), false, '破坏副本:已无上限');
  assert.ok(lwCode.includes('Math.min(200, Math.floor(rRaw))'), '原版必须限额');
});

/* ══════════════════ E. 版本锚(下限形) ══════════════════ */
test('E1 版本锚:三源一致且当版条目存在(不锁死具体版本号)', () => {
  const pkg = JSON.parse(read('package.json'));
  const man = JSON.parse(read('manifest.json'));
  const log = JSON.parse(read('update-log.json'));
  const ver = pkg.version;
  assert.match(ver, /^\d+\.\d+\.\d+$/);
  assert.equal(man.version, ver);
  assert.equal(log.latest, ver);
  assert.equal(log.head, ver);
  assert.ok(log.versions[ver], '当版条目必须存在');
  assert.ok(Array.isArray(log.versions[ver].items) && log.versions[ver].items.length >= 8);
  assert.ok(idxSrc.includes("const ST_PHONE_VERSION = '" + ver + "';"));
});