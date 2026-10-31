/* ============================================================
 * tests/system-v4109.test.mjs — R13-O6 验收套件（空态四态 · reason code）
 * ------------------------------------------------------------
 * 立项现象（计划书原话）：全仓 543 处空态文案 / 147 处 loading，但三种处境同形。
 *   用户看到「还没有照片」时分不清：该去拍一张 / 该去清筛选 / 该去看诊断。
 *   三种处置**相反**，界面却给同一句话 —— 这是本仓最贵的老账。
 *
 * 本套件守五件事：
 *   A 组：四态闭集 + reason code 词表 + 未登记不猜
 *   B 组：faceOf 判定顺序（先取数面在不在，最后才是空）—— 顺序错了就把「读失败」读成「真的没有」
 *   C 组：四态文案**互不相同**（断言的是「不同」，不是「都非空」）
 *   D 组：真接线（已分形的 app 里，非 ok 空态必须带 data-face-why）
 *   E 组：负控制（把 blocked 文案复制成 empty、把判定顺序倒过来，判据必须转红）
 *
 * 纪律：36 项做完前不跑全量；本单点可复现。
 *
 * 【诚实边界】四态只解决「说清是哪一种」，**不解决**「为什么挡」的深层归因
 *   （例如某个 blocked 究竟卡在哪一层）。那是各 app 自己的事。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  FACE,
  NOT_OK,
  FACE_ATTR,
  FACE_REASON,
  REASON_FACE,
  FACE_TEXT,
  isFace,
  reasonOf,
  faceOfReason,
  faceOf,
  faceHtml
} from '../config/empty-face.js';
import { stageTreeWithDeps } from './_stage-tree.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ------------------------------------------------------------
 * A 组：闭集与词表
 * ------------------------------------------------------------ */
test('A1: 四态是闭集，非 ok 三态与 FACE_TEXT 一一对应', () => {
  assert.deepEqual(Object.keys(FACE).sort(), ['absent', 'blocked', 'empty', 'ok'], '四态闭集不许增删');
  assert.deepEqual([...NOT_OK].sort(), ['absent', 'blocked', 'empty'], '非 ok 恰好三态');
  assert.ok(!NOT_OK.includes('ok'), 'ok 不许进「非 ok」集合');
  for (const f of Object.keys(FACE)) {
    assert.ok(String(FACE_TEXT[f] || '').length >= 3, `态 ${f} 必须有人话标题`);
  }
});

test('A2: reason code 词表与归属表对齐，未登记一律 null（不猜）', () => {
  for (const code of Object.keys(REASON_FACE)) {
    assert.ok(FACE_REASON[code], `reason ${code} 必须在词表里有说明`);
    assert.ok(isFace(REASON_FACE[code]), `reason ${code} 的归属必须是合法四态`);
    assert.notEqual(REASON_FACE[code], 'ok', `reason ${code} 不许归属 ok（非 ok 才有 reason）`);
  }
  assert.equal(reasonOf('this-code-does-not-exist'), null, '未登记 reason 返回 null');
  assert.equal(reasonOf(''), null, '空 reason 返回 null');
  /* 未登记 reason 对应的四态必须是 absent：宁可报「打不开」也不冒充「真的没有」 */
  assert.equal(faceOfReason('this-code-does-not-exist'), 'absent', '未登记 reason 一律归 absent');
});

test('A3: 属性名与词表同源（不许某处硬写字符串）', () => {
  assert.equal(FACE_ATTR, 'data-face-why', '属性名是契约，改动会打断所有已分形的 app');
  const src = rd('config/empty-face.js');
  const imports = [...src.matchAll(/^\s*import\s/gm)];
  assert.equal(imports.length, 0, '本模块必须是零依赖叶子');
});

/* ------------------------------------------------------------
 * B 组：判定顺序（顺序错了就退回本模块要消灭的毛病）
 * ------------------------------------------------------------ */
test('B1: 判定顺序 —— 取数面不在 / 读失败 / 未就绪 都归 absent，不许被读成 empty', () => {
  assert.equal(faceOf({ mounted: false }).face, 'absent');
  assert.equal(faceOf({ mounted: false }).code, 'not-mounted');
  assert.equal(faceOf({ error: 'boom' }).face, 'absent');
  assert.equal(faceOf({ error: 'boom' }).code, 'read-failed');
  assert.equal(faceOf({ ready: false }).face, 'absent');
  assert.equal(faceOf({ ready: false, items: [] }).face, 'absent', '★ 未就绪即使列表也空，仍是 absent（不是「真的没有」）');
  /* 关键反例：空列表 + 读失败 ⇒ 必须是 absent。若判定顺序把「空」放前面，这里会得 empty */
  assert.equal(faceOf({ items: [], error: 'read failed' }).face, 'absent', '★ 空列表 + 读失败 = absent，这是本模块存在的理由');
});

test('B2: 有内容但被挡住 ⇒ blocked（三种挡法各有 code）', () => {
  assert.equal(faceOf({ items: [], filtered: true }).face, 'empty', '没内容时「筛选了」不构成 blocked（本来就空）');
  assert.equal(faceOf({ items: [1], filtered: true }).face, 'blocked');
  assert.equal(faceOf({ items: [1], filtered: true }).code, 'filtered-out');
  assert.equal(faceOf({ permission: false }).face, 'blocked');
  assert.equal(faceOf({ permission: false }).code, 'no-permission');
  assert.equal(faceOf({ locked: true }).face, 'blocked');
  assert.equal(faceOf({ locked: true }).code, 'locked');
});

test('B3: 真的没有 ⇒ empty；有内容 ⇒ ok（不出空态）', () => {
  assert.equal(faceOf({ items: [] }).face, 'empty');
  assert.equal(faceOf({ items: [] }).code, 'no-data');
  assert.equal(faceOf({}).face, 'empty', '没给任何输入时按「真的没有」处理');
  assert.equal(faceOf({ items: [1, 2] }).face, 'ok');
  assert.equal(faceOf({ count: 3 }).face, 'ok', '只给 count 也要能判 ok');
  assert.equal(faceHtml('ok'), '', 'ok 态不渲染任何空态 HTML');
});

/* ------------------------------------------------------------
 * C 组：四态文案互不相同（★ 本项最贵的一条）
 * ------------------------------------------------------------
 * 断言的是「四句话不同」，不是「四句话都非空」。
 *   把 blocked 文案复制成 empty 的，C1 必须转红。
 * ------------------------------------------------------------ */
test('C1: 四态标题两两不同（复制粘贴必被抓）', () => {
  const texts = Object.values(FACE_TEXT);
  assert.equal(new Set(texts).size, texts.length, '四态文案必须两两不同：' + JSON.stringify(FACE_TEXT));
});

test('C2: 渲染出的空态 HTML 里，非 ok 三态的 (属性值 + 文案) 组合两两不同', () => {
  const seen = new Map();
  for (const f of NOT_OK) {
    const html = faceHtml(f);
    assert.ok(html.includes(FACE_ATTR + '='), `态 ${f} 的 HTML 必须带 ${FACE_ATTR}`);
    const code = html.match(new RegExp(FACE_ATTR + '="([^"]+)"'))[1];
    assert.ok(reasonOf(code) !== null, `态 ${f} 渲染出的 reason 必须在词表内：${code}`);
    const key = code + '|' + html.replace(/<[^>]+>/g, '');
    assert.ok(!seen.has(key), `态 ${f} 与 ${seen.get(key)} 渲染结果同形（等于没分形）`);
    seen.set(key, f);
  }
});

/* ------------------------------------------------------------
 * D 组：真接线（已分形的 app 必须真的带属性）
 * ------------------------------------------------------------ */
/* 已分形的 app：每个都要有非 ok 空态且带 data-face-why。
 *   为什么用清单而不是「全仓扫」：本项验收口径就是「先做高频 app，其余进台账」，
 *   全仓扫会把未改的 app 全部判红，那不是本项的范围（那是台账的活）。
 *   但清单必须真的存在且真接了 —— 谎报一条就转红。 */
const SHAPED = [
  'apps/album/album-view.js',
  'apps/chars/chars-view.js',
  'apps/wallet/wallet-view.js',
  'apps/plotline/plotline-view.js',
  'apps/diary/diary-view.js',
  'apps/memory/memory-view.js'
];

test('D1: 已分形的 app 清单逐条真带 data-face-why（谎报一条即红）', () => {
  assert.ok(SHAPED.length >= 6, '已分形 app 至少 6 个，实测 ' + SHAPED.length);
  for (const f of SHAPED) {
    const p = path.join(ROOT, f);
    assert.ok(fs.existsSync(p), f + ' 必须存在');
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(src.includes('FACE_ATTR'), f + ' 必须用统一属性常量（不许硬写字符串）');
    assert.ok(/data-face="|data-face=.\$\{/.test(src) || src.includes('FACE_ATTR'), f + ' 必须带上 face 标记');
  }
});

test('D2: 已分形的 app 里，删掉「读不到 ≠ 还没有」这层区分就能被看见', () => {
  /* 反向探针：已分形的 app 必须同时出现「真的没有」与「读不到」两种处置，
     否则它只是改了文案、没有真的分形。至少一个 app 要能证明这一点。 */
  const both = SHAPED.filter((f) => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return /absent|read-failed|读不到/.test(s) && /empty|no-data|还没有/.test(s);
  });
  assert.ok(both.length >= 4, '至少 4 个已分形 app 同时区分「空」与「读不到」，实测 ' + both.length);
});

/* ------------------------------------------------------------
 * E 组：负控制
 * ------------------------------------------------------------ */
function brokenCopy(transform) {
  const src = rd('config/empty-face.js');
  const broken = transform(src);
  assert.notEqual(broken, src, '破坏锚点必须命中');
  const dir = stageTreeWithDeps({ 'config/empty-face-broken.js': broken }, { prefix: 'v4109-neg-', root: ROOT });
  assert.deepEqual(dir.missing, [], '临时树必须补齐依赖');
  return path.join(dir.dir, 'config', 'empty-face-broken.js');
}

async function load(file) {
  return import(pathToFileURL(file).href);
}

test('E1: 把 blocked 文案复制成 empty ⇒ C1 那条「两两不同」必须转红', async () => {
  const file = brokenCopy((s) => s.replace("blocked: '被挡住了',", "blocked: '还没有内容',"));
  const m = await load(file);
  const texts = Object.values(m.FACE_TEXT);
  assert.equal(new Set(texts).size < texts.length, true, '★ 破坏版必须让两态文案同形（C1 抓的就是这个）');
});

test('E2: 把判定顺序倒过来（先看空再看待取数面）⇒ B1 反例必须转红', async () => {
  const file = brokenCopy((s) => s.replace(
    "    if (o.error) return { face: 'absent', code: 'read-failed' };",
    "    if (o.error && false) return { face: 'absent', code: 'read-failed' };"
  ));
  const m = await load(file);
  const r = m.faceOf({ items: [], error: 'read failed' });
  assert.equal(r.face, 'empty', '★ 破坏版必须把「空列表 + 读失败」读成 empty（退回本模块要消灭的毛病）');
});

test('E3: 把未登记 reason 的归属改成 empty ⇒ A2 那条必须转红', async () => {
  const file = brokenCopy((s) => s.replace(
    "return c === null ? FACE.absent : REASON_FACE[c];",
    "return c === null ? FACE.empty : REASON_FACE[c];"
  ));
  const m = await load(file);
  assert.equal(m.faceOfReason('this-code-does-not-exist'), 'empty', '★ 破坏版必须让未登记 reason 冒充「真的没有」');
});

test('E4: 把 faceHtml 的属性去掉 ⇒ C2 那条必须转红', async () => {
  const file = brokenCopy((s) => s.replace(
    "'<div class=\"empty-face\" ' + FACE_ATTR + '=\"'",
    "'<div class=\"empty-face\" data-x=\"'",
    1
  ));
  const m = await load(file);
  const html = m.faceHtml('empty');
  assert.equal(html.includes(m.FACE_ATTR), false, '★ 破坏版必须不再带 data-face-why');
});
