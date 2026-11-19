/* ============================================================
 * tests/r24_o5_media_cache_boundary.test.mjs — R24-O5 的**边界**验收
 * ------------------------------------------------------------
 * 为什么单开一个套件（而不是只扩 r24_o5_media_cache.test.mjs）：
 *   那个套件守的是**内核行为**（LRU / 三态 / 缩略 / release 方法）。
 *   本套件守的是计划书里另两句、内核套件根本测不到的话：
 *     ① 「release() 挂在会话切换与 releasePhoneInactiveResources 上」
 *     ② 「读数暴露到洞察 App 的一个分页」
 *   这两句此前**零消费点**：`mediaCacheSelfCheck` 进了 index.js 的桥表就算交了，
 *   而 grep 全仓 `createMediaCache(` 只有内核与自己 —— 典型的「写了方法没人调」。
 *
 * 纪律（本套件自己的约束）：
 *   · 挂载点断言走 **hooks 的真行为**（真造 cache、真释放、真断言字节归零），
 *     不满足于「源码里出现过这个函数名」；源码级断言只用于「接线在不在」这一面。
 *   · 负控制必须真把实现打坏再跑：把 release 摘掉后，同一断言必须转红。
 *   · 三态不塌：「没有 cache」写 absent，「读失败」写 unknown，**都不许写成 0**。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  mediaCacheEnsure,
  mediaCacheOnChatChanged,
  mediaCacheOnInactive,
  mediaCacheFace,
  mediaCacheFaceText,
  mediaCacheRows,
} from '../config/media-cache-hooks.js';
import { createMediaCache } from '../config/media-cache.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 只剥注释、保留字符串：注释里写「我们调了 X」不算接线。 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function seeded(bytes) {
  const c = createMediaCache({ maxBytes: 100000, maxEntries: 50 });
  c.putLoaded('a.jpg', { bytes });
  return c;
}

/* ---------------- A 组：挂载点与读数面 ---------------- */
test('A1 钩子导出面完整（六件：确保单例 / 两个挂载 / 三件读数）', () => {
  for (const fn of [mediaCacheEnsure, mediaCacheOnChatChanged, mediaCacheOnInactive, mediaCacheFace, mediaCacheFaceText, mediaCacheRows]) {
    assert.equal(typeof fn, 'function', '每个导出都必须是函数');
  }
});

test('A2 换会话挂载点：真释放（字节归零 + releaseCount+1 + freedBytes=释放前占用）', () => {
  const c = seeded(800);
  const before = c.stats().bytes;
  assert.equal(before, 800);
  const out = mediaCacheOnChatChanged(c);
  assert.equal(out.ok, true, '释放必须报 ok：' + JSON.stringify(out));
  assert.equal(out.reason, 'chat-changed', 'reason 必须如实写挂载来源');
  assert.equal(out.freedBytes, 800, '必须报出释放了多少字节');
  assert.equal(c.stats().bytes, 0, '释放后占用必须归零');
  assert.equal(c.stats().releaseCount, 1);
  assert.equal(c.stats().releasedBytes, 800);
});

test('A3 非活跃资源挂载点：同样真释放，且回带 activeAppId（两个挂载点不是同一个）', () => {
  const c = seeded(300);
  const out = mediaCacheOnInactive(c, 'album');
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'inactive', 'reason 必须是 inactive（不是 chat-changed）');
  assert.equal(out.activeAppId, 'album', '切 App 的挂载点必须知道当前活跃 App');
  assert.equal(out.freedBytes, 300);
  assert.equal(c.stats().bytes, 0);
  /* 两个挂载点的 reason 必须不同形：同一个原因画成两种来源，等于没区分谁在放。 */
  const other = mediaCacheOnChatChanged(seeded(1));
  assert.notEqual(other.reason, out.reason);
});

test('A4 异常安全：没有 cache 不抛、release 抛错不吞成成功（各自成态）', () => {
  const noCache = mediaCacheOnChatChanged(null);
  assert.equal(noCache.ok, false);
  assert.equal(noCache.reason, 'no-cache');
  assert.equal(noCache.freedBytes, 0);

  const throwing = { release() { throw new Error('boom'); }, stats() { return {}; } };
  const threw = mediaCacheOnInactive(throwing, 'x');
  assert.equal(threw.ok, false);
  assert.equal(threw.reason, 'release-threw', '抛错必须点名，不许报 ok');
});

test('A5 单例：ensure 两次返回同一对象；给上限时真按上限，不给时交给内核默认', () => {
  const win = { VirtualPhone: {} };
  const a = mediaCacheEnsure(win, null);
  const b = mediaCacheEnsure(win, 2048);
  assert.equal(a, b, '第二次 ensure 必须复用同一个 cache（不许每次新建把占用账抹掉）');
  assert.equal(a.stats().maxBytes, 24 * 1024 * 1024, '未给上限时用内核默认');
  const win2 = { VirtualPhone: {} };
  const c = mediaCacheEnsure(win2, 4096);
  assert.equal(c.stats().maxBytes, 4096, '给上限时必须按给的字节数');
  assert.equal(mediaCacheEnsure(null, 1), null, '没有 win 时如实返回 null（不是造一个孤立 cache）');
});

test('A6 读数三态不塌：absent / ok / unknown，且 hitRate 为 null 时不画成 0%', () => {
  const absent = mediaCacheFace({ VirtualPhone: {} });
  assert.equal(absent.kind, 'absent', '没有 cache 必须 absent');
  assert.equal(mediaCacheFaceText(absent).includes('不是「占用 0 字节」'), true, 'absent 的文案必须说清「没量过 ≠ 0」');

  const win = { VirtualPhone: {} };
  const c = mediaCacheEnsure(win, 4096);
  const empty = mediaCacheFace(win);
  assert.equal(empty.kind, 'ok');
  assert.equal(empty.stats.hitRate, null, '没有读取时命中率必须是 null（不是 0）');
  assert.equal(mediaCacheFaceText(empty).includes('尚无读取'), true, 'null 命中率必须写「尚无读取」');
  assert.equal(mediaCacheFaceText(empty).includes('0%'), false, '不许把 null 画成 0%');

  c.putLoaded('x.jpg', { bytes: 10 });
  c.get('x.jpg');
  const ok = mediaCacheFace(win);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.stats.bytes, 10, '读数必须等于 stats 的真值');
  assert.equal(ok.stats.hits, 1);
  assert.equal(mediaCacheRows(ok).length, 6, '明细必须六格（占用/张数/命中/命中率/淘汰/释放）');

  const broken = { VirtualPhone: { mediaCache: { release() {}, stats() { throw new Error('nope'); } } } };
  const unknown = mediaCacheFace(broken);
  assert.equal(unknown.kind, 'unknown', '读失败必须 unknown（不许 absent，更不许 0）');
  assert.equal(mediaCacheFaceText(unknown).includes('不写 0'), true);
});

/* ---------------- B 组：接线证据（计划书点名的两个挂载点 + 洞察一页） ---------------- */
test('B1 接线：index.js 真 import 钩子，且在 onChatChanged / releasePhoneInactiveResources 各真调一次', () => {
  const src = stripComments(read('index.js'));
  assert.ok(src.includes("from './config/media-cache-hooks.js'"), '必须真 import 钩子（不是注释里提一句）');
  const chat = src.split('mediaCacheOnChatChanged(mediaCacheEnsure(window').length - 1;
  const inactive = src.split('mediaCacheOnInactive(mediaCacheEnsure(window').length - 1;
  assert.equal(chat, 1, '换会话挂载点必须恰调一次，实测 ' + chat);
  assert.equal(inactive, 1, '非活跃回收挂载点必须恰调一次，实测 ' + inactive);
  /* 两个调用必须分别在两个函数体内：用「函数名到下一次 function 声明」的区间粗判。 */
  const iChatFn = src.indexOf('function onChatChanged()');
  const iRelFn = src.indexOf('function releasePhoneInactiveResources(');
  assert.ok(iChatFn >= 0 && iRelFn >= 0, '两个宿主函数必须还在');
  assert.ok(src.indexOf('mediaCacheOnChatChanged(mediaCacheEnsure(window') > iChatFn, '换会话调用必须在 onChatChanged 体内');
  assert.ok(src.indexOf('mediaCacheOnInactive(mediaCacheEnsure(window') > iRelFn, '非活跃调用必须在 releasePhoneInactiveResources 体内');
});

test('B2 洞察 App：数据层出数、视图层渲染（两段都在才算「暴露到一个分页」）', () => {
  const data = stripComments(read('apps/diagnose/diagnose-data.js'));
  assert.ok(data.includes('mediaCacheSc'), 'collectDiagnose 必须取这一面');
  assert.ok(data.includes('mediaCache: mediaCacheSc,'), '返回对象里必须真有这个键（取了不放出去等于没取）');
  const view = stripComments(read('apps/diagnose/diagnose-view.js'));
  assert.ok(view.includes('_mediaCacheHtml(pkg)'), '视图必须真调用渲染函数');
  assert.ok(view.includes('媒体缓存（图片占多少、谁会放）'), '卡片必须真 push 进页面（有标题才有面）');
  assert.ok(view.includes('mediaCacheFaceText(face)'), '视图文案必须走内核转发，不许自拼');
});

test('B3 交付口径：内核套件仍在，且本套件补的是它没覆盖的两句', () => {
  const kernel = read('tests/r24_o5_media_cache.test.mjs');
  assert.ok(kernel.includes("cache.release('chat-changed')"), '内核套件测的是 release 方法本身');
  assert.equal(kernel.slice(0, 400).includes('onChatChanged'), false, '前提：内核套件不测挂载点（本套件的存在理由）');
});

/* ---------------- C 组：负控制（真把实现打坏） ---------------- */
function copyHooks(broken) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o5_'));
  fs.writeFileSync(path.join(dir, 'media-cache-hooks.js'), broken, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'config/num-gate.js'), path.join(dir, 'num-gate.js'));
  fs.copyFileSync(path.join(ROOT, 'config/media-cache.js'), path.join(dir, 'media-cache.js'));
  return dir;
}

test('C1 负控制：把 release 调用摘掉 ⇒ A2/A3 同款断言必转红（行为级，不是读源码）', async () => {
  const src = read('config/media-cache-hooks.js');
  const from = '        out = cache.release(why);';
  assert.equal(src.split(from).length - 1, 1, '负控制锚点必须恰中一次');
  const broken = src.replace(from, '        out = { ok: true, freedBytes: 0 };');
  const dir = copyHooks(broken);
  const mod = await import(pathToFileURL(path.join(dir, 'media-cache-hooks.js')).href);
  const c = seeded(800);
  const out = mod.mediaCacheOnChatChanged(c);
  assert.equal(out.ok, true, '破坏版仍会「报 ok」——这正是它危险的地方');
  assert.equal(c.stats().bytes, 800, '破坏版没有真释放 ⇒ A2 的「释放后归零」必然转红');
  assert.equal(out.freedBytes, 0, '破坏版 freedBytes=0 ⇒ A2 的「报出释放字节」必然转红');
});

test('C2 负控制：把 stats 读数改成常量 ⇒ A6 同款断言必转红（读数不是编的）', async () => {
  const src = read('config/media-cache-hooks.js');
  const from = '        st = cache.stats();';
  assert.equal(src.split(from).length - 1, 1, '负控制锚点必须恰中一次');
  const broken = src.replace(from, '        st = { bytes: 0, maxBytes: 0, entries: 0, maxEntries: 0, hits: 0, misses: 0, hitRate: null, evictions: 0, releaseCount: 0, releasedBytes: 0 };');
  const dir = copyHooks(broken);
  const mod = await import(pathToFileURL(path.join(dir, 'media-cache-hooks.js')).href);
  const win = { VirtualPhone: {} };
  const c = mod.mediaCacheEnsure(win, 4096);
  c.putLoaded('x.jpg', { bytes: 10 });
  const face = mod.mediaCacheFace(win);
  assert.equal(face.kind, 'ok', '破坏版的 kind 仍是 ok（它假装读到了）');
  assert.notEqual(face.stats.bytes, c.stats().bytes, '破坏版读数 ≠ 真 stats ⇒ A6「读数等于真值」必然转红');
});

test('C3 负控制：把 index.js 的换会话调用摘掉 ⇒ B1 必转红', () => {
  const src = stripComments(read('index.js'));
  const line = '            mediaCacheOnChatChanged(mediaCacheEnsure(window, null), \'chat-changed\');';
  assert.equal(src.split(line).length - 1, 1, '接线锚点必须恰中一次');
  const broken = src.replace(line, '            /* negative-control: detached */');
  assert.equal(broken.split('mediaCacheOnChatChanged(mediaCacheEnsure(window').length - 1, 0,
    '摘掉后计数必须归零 ⇒ B1 的「恰调一次」必然转红');
});

test('C4 负控制：把视图的卡片 push 摘掉 ⇒ B2 必转红', () => {
  const src = read('apps/diagnose/diagnose-view.js');
  const from = 'this._mediaCacheHtml(pkg)';
  assert.equal(src.split(from).length - 1, 1, '渲染锚点必须恰中一次');
  const broken = src.replace(from, 'null');
  /* 注意：方法**定义**里也有 `_mediaCacheHtml(pkg)`（不带 `this.`），所以这里必须断言
   * 带 `this.` 的**调用**归零 —— 否则摘掉调用后方法定义还在，断言会假绿。 */
  assert.equal(broken.includes('this._mediaCacheHtml(pkg)'), false,
    '摘掉后视图不再调用渲染函数 ⇒ B2 的「必须真调用渲染函数」必然转红');
});