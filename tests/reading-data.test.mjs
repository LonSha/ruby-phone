// 阅读 App 数据层单元测试：编码探测 + 章节切分 + 智能分段 + 书架
import { decodeTxtArrayBuffer, parseTxtContent, detectParagraphMode, ReadingData } from '../apps/reading/reading-data.js';

let pass = 0, fail = 0;
function assert(name, cond) {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name}`); }
}

// 1. UTF-8 BOM 识别
{
    const buf = new TextEncoder().encode('\uFEFF第一章 初见\n\n他推开门。\n\n第二章 重逢\n\n她笑了。').buffer;
    const { text, encoding } = decodeTxtArrayBuffer(buf);
    assert('UTF-8 BOM 识别为 utf-8', encoding === 'utf-8');
    assert('UTF-8 BOM 内容正确', text.includes('第一章 初见'));
}

// 2. 章节切分
{
    const text = '第一章 初见\n\n他推开门。\n\n第二章 重逢\n\n她笑了。';
    const book = parseTxtContent(text, 'test.txt', 'auto');
    assert('章节数量=2', book.chapters.length === 2);
    assert('首章标题', book.chapters[0].title === '第一章 初见');
    assert('次章标题', book.chapters[1].title === '第二章 重逢');
    assert('首章段落', book.chapters[0].paragraphs.length === 1 && book.chapters[0].paragraphs[0].includes('推开门'));
}

// 3. 无章节 → 全文单章
{
    const text = '这是第一行。\n这是第二行。';
    const book = parseTxtContent(text, 'note.txt', 'auto');
    assert('无章节=单章全文', book.chapters.length === 1 && book.chapters[0].title === '全文');
    assert('书名取自文件名', book.title === 'note');
}

// 4. 序章检测（第一章前有内容）
{
    const text = '楔子\n\n天地初开。\n\n第一章 开篇\n\n主角登场。';
    const book = parseTxtContent(text, 'x.txt', 'auto');
    assert('有序章', book.chapters.length === 2);
    assert('序章在首位', book.chapters[0].title === '序');
}

// 5. 段落格式探测
{
    assert('空行分段', detectParagraphMode(['a', '', 'b', '', 'c']) === 'blank');
    assert('缩进分段', detectParagraphMode(['\u3000a', '\u3000b', '\u3000c']) === 'indent');
    assert('一行一段', detectParagraphMode(['a', 'b', 'c', 'd', 'e', 'f', 'g']) === 'line');
}

// 6. UTF-8 无 BOM 也能识别
{
    const buf = new TextEncoder().encode('测试文本内容，这是正常的中文句子。').buffer;
    const { text, encoding } = decodeTxtArrayBuffer(buf);
    assert('UTF-8 无 BOM 识别为 utf-8', encoding === 'utf-8');
    assert('UTF-8 无 BOM 内容正确', text.includes('测试文本内容'));
}

// 7. 书架存取
{
    class MockStorage {
        constructor() { this.d = {}; }
        get(k) { return this.d[k] ?? null; }
        set(k, v) { this.d[k] = v; }
        remove(k) { delete this.d[k]; }
    }
    const st = new MockStorage();
    const rd = new ReadingData(st);
    const text = '第一章 起点\n\n正文内容一。\n\n第二章 前进\n\n正文内容二。';
    const parsed = parseTxtContent(text, 'mybook.txt', 'auto');
    const payload = { title: parsed.title, format: 'txt', chapters: parsed.chapters };
    const result = rd.addBook(payload, 'mybook.txt', 'utf-8', 'auto');
    assert('addBook 返回 bookId', !!result.bookId);
    assert('addBook 章节=2', result.chapters.length === 2);
    assert('书架有 1 本书', rd.getBooks().length === 1);
    // 同名覆盖
    const result2 = rd.addBook(payload, 'mybook.txt', 'utf-8', 'auto');
    assert('同名覆盖后仍 1 本', rd.getBooks().length === 1);
    // 删除（用最新 bookId）
    rd.removeBook(result2.bookId);
    assert('删除后书架空', rd.getBooks().length === 0);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);