// EPUB 解析集成测试：读 Python 生成的真实 EPUB
import fs from 'node:fs';
const buf = fs.readFileSync('/tmp/test_book.epub');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const { parseEpubFile } = await import('../apps/reading/reading-epub.js');
let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`✓ ${n}`); } else { fail++; console.log(`✗ ${n}`); } };
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
} catch (e) {
  fail++;
  console.log('✗ 解析异常:', e.message);
}
console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);