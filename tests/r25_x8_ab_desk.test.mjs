/* R25-X8 整机 A/B 对照台（产品面，不是门禁）
 * 纪律：内核纯函数在 node 里逐条判；差异面四档不压平；负控制证明判据自己会红；
 *   「台不是门」也当判据：它只许 exit 0/2，不许自带通过/失败结论。
 * 本文件不用正则（生成链会吃反斜杠），一律 includes / indexOf。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diffReadings, formatMarkdown, abDeskSelfCheck, AB_FACES } from '../tools/ab-desk-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('X8-1 内核自检 5 条边界全绿', () => {
  const sc = abDeskSelfCheck();
  assert.equal(sc.ok, true, JSON.stringify(sc.items));
  assert.equal(sc.items.length >= 5, true);
  assert.deepEqual(AB_FACES, ['same', 'diff', 'only-a', 'only-b']);
});

test('X8-2 同一版本跑两次（同源对照）⇒ 全 same，不许出现 diff/only', () => {
  const a = [
    { name: 's1::alpha', ok: true, detail: 'x' },
    { name: 's1::beta', ok: false, detail: 'y' },
    { name: 's2::gamma', ok: true, detail: 'z' },
  ];
  const r = diffReadings(a, JSON.parse(JSON.stringify(a)));
  assert.equal(r.verdict, 'identical');
  assert.equal(r.counts.same, 3);
  assert.equal(r.changed, 0);
});

test('X8-3 差异面不压平：ok 翻转 / detail 变化 / 一边缺失 各归各档', () => {
  const a = [
    { name: 'p::flip', ok: true, detail: 'same' },
    { name: 'p::detail', ok: true, detail: '10ms' },
    { name: 'p::onlyA', ok: true, detail: '' },
  ];
  const b = [
    { name: 'p::flip', ok: false, detail: 'same' },
    { name: 'p::detail', ok: true, detail: '12ms' },
    { name: 'p::onlyB', ok: true, detail: '' },
  ];
  const r = diffReadings(a, b);
  assert.equal(r.counts.diff, 2, 'ok 翻转与 detail 变化都算 diff');
  assert.equal(r.counts['only-a'], 1, 'A 有 B 没有 ⇒ only-a，不许算 same');
  assert.equal(r.counts['only-b'], 1, 'B 有 A 没有 ⇒ only-b，不许算 same');
  assert.equal(r.counts.same, 0);
  assert.equal(r.verdict, 'changed');
  const onlyA = r.rows.find((x) => x.name === 'p::onlyA');
  assert.equal(onlyA.b.ok, 'missing', '缺的那一边要显式写 missing，不能编一个值');
});

test('X8-4 两边零读数 ⇒ unknown（不拿 0 条差异冒充两版一致）', () => {
  const r = diffReadings([], []);
  assert.equal(r.total, 0);
  assert.equal(r.verdict, 'unknown');
});

test('X8-5 负控制：把 only-a 抄成 same ⇒ X8-3 同款断言必须转红', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'ab-desk-core.mjs'), 'utf8');
  const from = "    if (!other) face = 'only-a';";
  assert.equal(src.split(from).length - 1, 1, '负控制锚点必须恰中一次');
  const broken = src.replace(from, "    if (!other) face = 'same';");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x8_'));
  const file = path.join(dir, 'ab-desk-core.broken.mjs');
  fs.writeFileSync(file, broken);
  const mod = await import(pathToFileURL(file).href);
  const r = mod.diffReadings([{ name: 'z', ok: true, detail: '' }], []);
  assert.equal(r.counts['only-a'], 0, '打补丁后缺读数不再进 only-a');
  assert.equal(r.counts.same, 1, '被抄成了 same');
  assert.equal(r.verdict, 'identical', '于是「一边没有」被说成两版一致 —— X8-3 的断言换到这种实现上必然转红');
});

test('X8-6 台不是门：CLI 只许 exit 0 / 2，且缺参数当场 exit 2', () => {
  const src = read('tools/ab-desk.mjs');
  assert.equal(src.includes('process.exit(0)'), true, '正常跑完必须 exit 0（差异条数不影响退出码）');
  assert.equal(src.includes('process.exit(2)'), true, '未执行 / 用法错误必须 exit 2');
  assert.equal(src.includes('process.exit(1)'), false, '台不许有「1 = 有差异」这种门禁语义');
  const r = spawnSync(process.execPath, ['tools/ab-desk.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 2, '缺 --a/--b 必须 exit 2：' + r.stdout + r.stderr);
  assert.equal(String(r.stderr).includes('ab-desk'), true, '拒判理由要打给用户看');
});

test('X8-7 表结构不被 detail 里的换行 / 竖线打散（一条读数只占一行）', () => {
  const NL = String.fromCharCode(10);
  const dirty = 'before' + NL + 'after | pipe';
  const r = diffReadings([{ name: 'q::dirty', ok: true, detail: dirty }], [{ name: 'q::dirty', ok: true, detail: 'clean' }]);
  assert.equal(r.counts.diff, 1, 'detail 变了就是 diff');
  const md = formatMarkdown(r, { '操作序列': 'o3-media-20.scen.js' });
  const lines = md.split(NL);
  const rows = lines.filter((l) => l.startsWith('|'));
  assert.equal(rows.length, 3, '表里只能是 表头 + 分隔行 + 1 条差异，detail 的换行不许造出新行：' + rows.length);
  rows.forEach((l) => assert.equal(l.split('|').length - 1, 5, '每行必须恰好 5 个竖线，多一个就把列数搞错了：' + l));
  assert.equal(md.indexOf('before after / pipe') >= 0, true, '换行压成空格、竖线换掉，但内容不许丢');
});

test('X8-8 自检有产品端消费点：--self-check 真跑一次（不是只为测试而存在）', () => {
  const src = read('tools/ab-desk.mjs');
  assert.equal(src.indexOf('abDeskSelfCheck()') >= 0, true, 'CLI 必须真调用它（否则它就是零消费导出）');
  assert.equal(src.indexOf('AB_FACES') >= 0, true, '四档清单也得在台面上打给用户看');
  const r = spawnSync(process.execPath, ['tools/ab-desk.mjs', '--self-check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, '自检成立 → exit 0：' + r.stdout + r.stderr);
  assert.equal(String(r.stdout).indexOf('5/5') >= 0, true, '五条边界要真跑一遍，不是空打印');
  assert.equal(String(r.stdout).indexOf('only-b') >= 0, true, '四档档名要打给用户看');
});
