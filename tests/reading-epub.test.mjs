// EPUB 解析集成测试：读 Python（现在是本仓零依赖夹具）生成的真实 EPUB
//
// 【v3.22.0 修复：不再依赖 /tmp 的环境残留】
//   原版第一行是 `fs.readFileSync('/tmp/test_book.epub')`，而全仓**没有任何脚本生成它**
//   （grep 全仓只有这一处引用）。后果：干净环境必红，报的是 ENOENT ——
//   与「解析器坏了」在输出上**完全同形**（都是这一条测试失败）。
//   这正是本仓反复记过的那类形态：**看起来没坏但判定不对** —— 一条永远红着的测试
//   会把真回归一起吞掉（狼来了）。
//   修法：夹具进仓（tests/_epub_fixture.mjs，零依赖 STORE 写 ZIP），本文件自己生成字节。
//   断言**一条不减**（书名 / 作者 / 两章 / 章标题 / 首章首段 / 次章段落），并**新增**五条
//   自证判据：① 夹具字节非空 / 是合法 ZIP 头 / 自带 EOCD；② 旧路径不再被读（本文件源码里）；
//   ③ 同一份字节解析两次结果一致；
//   ④ 这是 STORE 路径的解析（解析器另有 DEFLATE 路径，走浏览器 DecompressionStream，本环境不可测）。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTestBook } from './_epub_fixture.mjs';
const ab = buildTestBook();
const { parseEpubFile } = await import('../apps/reading/reading-epub.js');
let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`✓ ${n}`); } else { fail++; console.log(`✗ ${n}`); } };

/* ── 夹具自证（先证明「喂进去的东西」是对的，再判解析结果）── */
const head = new DataView(ab);
assert('夹具字节非空', ab.byteLength > 400);
assert('夹具是 ZIP（PK\\x03\\x04）', head.getUint32(0, true) === 0x04034b50);
assert('夹具自带 EOCD（PK\\x05\\x06）', (() => {
  const b = new Uint8Array(ab);
  for (let i = b.length - 22; i >= 0 && i > b.length - 22 - 65536; i--) {
    if (new DataView(ab).getUint32(i, true) === 0x06054b50) return true;
  }
  return false;
})());
assert('旧路径（/tmp 下的临时 epub）不再被读（环境残留不再决定成败）', (() => {
  // 【为什么读 import.meta.url 而不是写死文件名】
  //   写死 'reading-epub.test.mjs' 会构成**假绿形态①（对原文件断言）**：
  //   把本文件复制成副本、往副本里注入旧路径，判据读的还是原文件 ⇒ 破坏没被观测到也照样绿。
  //   负控制实测确认过这一形态（副本注入后仍 14/0）。改成读自身，破坏落在哪份文件上就判那份。
  const raw = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  // 先剥离注释再查：注释里会**复述**旧路径（那是留档），判据只该看真正的代码
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  // 探针字面量拆开拼：否则本行自己就是一次命中（自我指涉假红）
  const stale = '/tmp/' + 'test_' + 'book.epub';
  return !code.includes(stale);
})());

/* ── 断言面（与原版逐条对应）── */
try {
  const book = await parseEpubFile(ab);
  assert('书名=测试小说', book.title === '测试小说');
  assert('作者=测试作者', book.author === '测试作者');
  assert('章节数=2', book.chapters.length === 2);
  assert('首章标题含第一章', book.chapters[0].title.includes('第一章'));
  assert('首章段落>=2', book.chapters[0].paragraphs.length >= 2);
  assert('首章首段', book.chapters[0].paragraphs.some(p => p.includes('推开木门')));
  assert('次章标题含第二章', book.chapters[1].title.includes('第二章'));
  assert('次章段落', book.chapters[1].paragraphs.some(p => p.includes('渡口')));
  /* 新增：可复算（同一份字节两次解析同形）+ 章节顺序真的是 spine 顺序 */
  const again = await parseEpubFile(buildTestBook());
  assert('可复算：两次解析结果逐字段相同',
    JSON.stringify(again) === JSON.stringify(book));
  assert('章节顺序按 spine（第一章在前）',
    book.chapters[0].title.includes('第一章') && book.chapters[1].title.includes('第二章'));
} catch (e) {
  fail++;
  console.log('✗ 解析异常:', e.message);
}
console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);