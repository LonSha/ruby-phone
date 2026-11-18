/* R25-O3 媒体内存：释放路径与回执（判据本体）
 * 纪律：内核在 node 里逐条判；接线按源码断言「真调了」；负控制证明判据自己会红。
 * 本文件刻意不用正则（上一轮 O1 的教训：生成链会把反斜杠吃掉两次），一律 indexOf/includes。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ML_MAX_LIVE, ML_RECEIPT_LIMIT, ML_MEMORY_TOLERANCE_PCT,
  mlBytesOfSrc, mlTrack, mlReleasePlan, mlSweep, mlReceipt, mlVerdict,
  mediaLifetimeSelfCheck
} from '../config/media-lifetime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KERNEL = path.join(ROOT, 'config', 'media-lifetime.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释：判据要查的是代码，不是注释里写的承诺。手写扫描器（不靠正则）。 */
function codeOf(src) {
  const NL = String.fromCharCode(10);
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '/*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (two === '//') { const nl = src.indexOf(NL, i + 2); i = nl < 0 ? src.length : nl; continue; }
    out += src[i]; i += 1;
  }
  return out;
}

test('O3-1 内核自检通过（六条边界各有真样例）', () => {
  const sc = mediaLifetimeSelfCheck();
  assert.equal(sc.ok, true, JSON.stringify(sc.items));
  assert.equal(sc.items.length >= 6, true);
});

test('O3-2 data URL 估算字节：base64 按 3/4；非字符串一律 null（不编 0）', () => {
  assert.equal(mlBytesOfSrc('data:image/png;base64,AAAA'), 3);
  assert.equal(mlBytesOfSrc('https://example.com/a.png'), null, '普通 URL 拿不到长度 ⇒ null');
  assert.equal(mlBytesOfSrc(null), null);
  assert.equal(mlBytesOfSrc(''), null);
});

test('O3-3 登记上限：超了就 FIFO 丢最旧，且丢的 id 要交回调用方去释放', () => {
  let live = new Map();
  live = mlTrack(live, { id: 'a', kind: 'image', src: 'data:image/png;base64,AA', at: 1 }).state;
  live = mlTrack(live, { id: 'b', kind: 'image', src: 'data:image/png;base64,AA', at: 2 }).state;
  const over = mlTrack(live, { id: 'c', kind: 'video', src: 'data:video/mp4;base64,AA', at: 3 }, 2);
  assert.deepEqual(over.dropped, ['a']);
  assert.equal(over.state.size, 2);
  assert.equal(over.state.has('c'), true);
});

test('O3-4 拒登两种：没 id / kind 不在三类 —— 都不许编一个能用的出来', () => {
  assert.equal(mlTrack(new Map(), { kind: 'image' }).rejected, 'no-id');
  assert.equal(mlTrack(new Map(), { id: 'x', kind: 'pdf' }).rejected, 'bad-kind');
  assert.equal(mlTrack(new Map(), { id: '  ', kind: 'image' }).rejected, 'no-id');
});

test('O3-5 释放动作按类型不同形（image ≠ video/audio），不明 kind 给 unknown', () => {
  assert.equal(mlReleasePlan({ id: 'i', kind: 'image' }).action, 'detach-src');
  assert.deepEqual(mlReleasePlan({ id: 'v', kind: 'video' }).steps, ['pause', 'detach-src']);
  assert.deepEqual(mlReleasePlan({ id: 'a', kind: 'audio' }).steps, ['pause', 'detach-src']);
  assert.equal(mlReleasePlan({ id: 'z', kind: 'pdf' }).action, 'unknown');
});

test('O3-6 扫描：超龄进 release，未超龄 keep', () => {
  const live = new Map([
    ['old', { id: 'old', kind: 'image', src: 'data:image/png;base64,AA', at: 0 }],
    ['new', { id: 'new', kind: 'image', src: 'data:image/png;base64,AA', at: 900 }]
  ]);
  const r = mlSweep(live, 1000, { maxAgeMs: 500 });
  assert.deepEqual(r.release.map((p) => p.id), ['old']);
  assert.deepEqual(r.keep, ['new']);
  assert.deepEqual(r.unknown, []);
});

test('O3-7 扫描三态不压平：不明 kind / 没钟 / 没 src 都进 unknown，不许算作已释放', () => {
  const live = new Map([
    ['bad', { id: 'bad', kind: 'pdf', src: 'data:x', at: 0 }],
    ['clock', { id: 'clock', kind: 'image', src: 'data:image/png;base64,AA', at: null }],
    ['nosrc', { id: 'nosrc', kind: 'image', src: '', at: 0 }]
  ]);
  const r = mlSweep(live, 1000, { maxAgeMs: 100 });
  assert.equal(r.release.length, 0);
  assert.deepEqual(r.unknown.map((u) => u.why).sort(), ['bad-kind', 'no-clock', 'no-src']);
});

test('O3-8 回执：ok=false 不得被写成 true；台账自己有上限（不许自己成为泄漏源）', () => {
  const plan = mlReleasePlan({ id: 'i', kind: 'image' });
  const bad = mlReceipt({ id: 'i', kind: 'image' }, plan, false, 123);
  assert.equal(bad.receipt.ok, false);
  assert.equal(bad.receipt.action, 'detach-src');
  assert.equal(bad.receipt.at, 123);
  let receipts = [];
  for (let i = 0; i < ML_RECEIPT_LIMIT + 10; i++) receipts = mlReceipt({ id: 'k' + i, kind: 'image' }, plan, true, i, receipts).receipts;
  assert.equal(receipts.length, ML_RECEIPT_LIMIT);
  assert.equal(receipts[receipts.length - 1].id, 'k' + (ML_RECEIPT_LIMIT + 9));
});

test('O3-9 内存对拍：±' + '10% 内 same，超出 mismatch', () => {
  assert.equal(ML_MEMORY_TOLERANCE_PCT, 10);
  assert.equal(mlVerdict(1000, 1050).face, 'same');
  assert.equal(mlVerdict(1000, 1110).face, 'mismatch');
  assert.equal(mlVerdict(1000, 850).face, 'mismatch');
  assert.equal(mlVerdict(1000, 1000).deltaPct, 0);
});

test('O3-10 内存对拍：缺读数 / 基线为 0 ⇒ unknown（读不到≠已回落）', () => {
  assert.equal(mlVerdict(null, 100).face, 'unknown');
  assert.equal(mlVerdict(100, undefined).face, 'unknown');
  assert.equal(mlVerdict(0, 0).face, 'unknown');
  assert.equal(mlVerdict(NaN, 100).face, 'unknown');
});

test('O3-11 接线：相册视图真 import 内核、真调登记/方案/回执（不是注释自述）', () => {
  const code = codeOf(read('apps/album/album-view.js'));
  assert.equal(code.includes('config/media-lifetime.js'), true, '必须从内核 import');
  assert.equal(code.includes('mlTrack('), true, '必须真登记句柄');
  assert.equal(code.includes('mlReleasePlan('), true, '必须真拿释放方案');
  assert.equal(code.includes('mlReceipt('), true, '必须真写回执');
});

test('O3-12 接线：关闭预览真的摘 src（video 先 pause），不是只 remove 元素', () => {
  const code = codeOf(read('apps/album/album-view.js'));
  const closeAt = code.indexOf('closePreview() {');
  assert.equal(closeAt > 0, true);
  const body = code.slice(closeAt, closeAt + 400);
  assert.equal(body.includes('releasePreviewMedia()'), true, 'closePreview 必须先释放再 remove');
  const relAt = code.indexOf('releasePreviewMedia() {');
  assert.equal(relAt > 0, true);
  const relBody = code.slice(relAt, relAt + 2000);
  assert.equal(relBody.includes("removeAttribute('src')"), true, '必须真摘 src');
  assert.equal(relBody.includes('pause?.'), true, 'video 必须先 pause');
  assert.equal(body.includes('preview.remove()'), true, '元素仍要移除');
});

test('O3-13 可见消费点：相册工具条上有人能看的「已释放 N」（不是只写 dataset）', () => {
  const src = read('apps/album/album-view.js');
  assert.equal(src.includes('已释放 '), true, '界面上必须有这条读数');
  const code = codeOf(src);
  assert.equal(code.includes('dataset.mlReleased'), true, '同时留机读面');
  assert.equal(code.includes('dataset.mlLastReceipt'), true, '回执要能被读出来核对');
});

test('O3-14 负控制 · 把 unknown 抄成 same ⇒ 上面那条判据必须转红', async () => {
  const src = fs.readFileSync(KERNEL, 'utf8');
  const from = "        return { face: 'unknown', deltaPct: null, why: 'no-reading' };";
  assert.equal(src.split(from).length - 1, 1, '负控制锚点必须恰中一次');
  const broken = src.replace(from, "        return { face: 'same', deltaPct: 0, why: 'no-reading' };");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o3_'));
  const file = path.join(dir, 'media-lifetime.broken.js');
  fs.writeFileSync(file, broken);
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.mlVerdict(null, 100).face, 'same', '打补丁后必须变 same');
  assert.equal(mod.mlVerdict(null, 100).face === 'unknown', false, '只有原实现会判 unknown');
});

test('O3-15 重渲染不许把诊断读数丢掉：render 后用实例真值补写 dataset（浏览器 o3-switch-path 就是靠这条）', () => {
  const code = codeOf(read('apps/album/album-view.js'));
  const at = code.indexOf('_mlHost.dataset.mlReleased');
  const renderEnd = code.indexOf('requestAnimationFrame(() => this.bindEvents())');
  assert.equal(at > 0, true, 'render 里必须补写 dataset.mlReleased');
  assert.equal(renderEnd > 0, true);
  assert.equal(at < renderEnd, true, '补写必须在 render 收尾之前（同一次渲染内完成）');
  const around = code.slice(at - 300, at + 200);
  assert.equal(around.includes('_mediaReleasedTotal'), true, '补写的值必须来自实例计数，不能是 0 占位');
  assert.equal(code.includes('_mlHost.dataset.mlLive'), true, 'live 读数同样要补写');
});
