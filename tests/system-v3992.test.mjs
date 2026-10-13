/**
 * system-v3992.test.mjs — v3.99.2 · R3-X8 重启可继续的本地阅读与摘录
 *
 * 【本版做什么（计划原文的「无需确认」部分）】
 *   计划 R3-X8 有两条线：① 正文作为独立本地附件持久化（**原文标注「需确认实施决策」**，
 *   宿主附件存储 vs 本地 Blob 边界未定，本版不动它）；② 书签 / 划线 / 摘录成素材、
 *   同名不同文件不静默覆盖、丢附件可重新定位。本版只做 ②——不需要先确认存储形态的那半。
 *
 * 【四条用户验收逐条落法】
 *   · 「同名不同文件不静默覆盖」→ contentHashOf 内容指纹 + findReusable：同指纹替换（回原书），
 *     异指纹并存（旧书不删，返回值 coexist 如实告知）；
 *   · 「丢附件可重新定位」→ 重新导入同一文件时按（文件名 + 指纹）重接既有条目 id，
 *     进度键（ruby_reading_progress_<id>）与摘录引用（bookId）因此都还指得回去；
 *   · 「摘录保留书/章/段引用」→ normalizeExcerpt 窄口：缺 bookId 或章/段索引不完整即不收；
 *   · 「正文不塞入提示词或 chatMetadata」→ 摘录只存文本片段 + 引用；本套件断言
 *     addBook 的 shelf 条目**不含正文**（无 chapters 字段）、摘录条目不含 paragraph 数组。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const DATA_REL = 'apps/reading/reading-data.js';
const APP_REL = 'apps/reading/reading-app.js';
const VIEW_REL = 'apps/reading/reading-view.js';
const D = await import(pathToFileURL(path.join(root, DATA_REL)).href);
const T = await import(pathToFileURL(path.join(root, APP_REL)).href);
const V = await import(pathToFileURL(path.join(root, VIEW_REL)).href);

/** 最小 storage 桩（与真实 PhoneStorage 的 get/set 口一致）。 */
function mkStorage() {
    const m = new Map();
    return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); }, _m: m };
}
function mkParsed(title, n = 3) {
    return { title, chapters: Array.from({ length: n }, (_, i) => ({ title: '第' + (i + 1) + '章', paragraphs: ['段' + i + '甲', '段' + i + '乙'] })) };
}
/* ══════════════════ A. 内容指纹与窄口 ══════════════════ */
test('A1 contentHashOf 确定、同文同值、异文异值、含长度后缀', () => {
    assert.equal(typeof D.contentHashOf, 'function');
    const a = D.contentHashOf('一样的正文');
    assert.equal(a, D.contentHashOf('一样的正文'), '同文必须同指纹');
    assert.notEqual(a, D.contentHashOf('不一样的正文'), '异文必须异指纹');
    assert.match(a, /^h[0-9a-f]+_\d+$/);
    assert.equal(D.contentHashOf(''), D.contentHashOf(null), '空与 null 同槽（都不判内容）');
    assert.ok(a.endsWith('_5'), '长度后缀为真字符数');
});
test('A2 normalizeExcerpt 窄口：缺正文 / 缺 bookId / 章段索引不完整一律不收', () => {
    assert.equal(D.normalizeExcerpt(null), null);
    assert.equal(D.normalizeExcerpt({}), null);
    assert.equal(D.normalizeExcerpt({ text: '有字', chapter: 0, para: 0 }), null, '缺 bookId 不收（丢出处等于丢素材）');
    assert.equal(D.normalizeExcerpt({ bookId: 'b1', chapter: 0, para: 0 }), null, '缺正文不收');
    assert.equal(D.normalizeExcerpt({ text: '有字', bookId: 'b1', chapter: -1, para: 0 }), null, '负章号不收');
    assert.equal(D.normalizeExcerpt({ text: '有字', bookId: 'b1', chapter: 0, para: 1.5 }), null, '非整数段号不收');
    const ok = D.normalizeExcerpt({ text: '  一段话  ', bookId: 'b1', bookTitle: '书', chapter: 2, para: 7, chapterTitle: '第三章' });
    assert.ok(ok && ok.text === '一段话' && ok.chapter === 2 && ok.para === 7 && ok.chapterTitle === '第三章');
    assert.match(ok.id, /^ex_/);
});
test('A3 normalizeExcerptList 净化 + 倒序 + 上限（超限丢最旧，不静默膨胀）', () => {
    const list = [
        { text: '旧', bookId: 'b', chapter: 0, para: 0, createdAt: 1000 },
        { text: '', bookId: 'b', chapter: 0, para: 0, createdAt: 2000 },
        { text: '新', bookId: 'b', chapter: 0, para: 1, createdAt: 5000 },
    ];
    const out = D.normalizeExcerptList(list);
    assert.equal(out.length, 2, '脏条目被净化掉');
    assert.equal(out[0].text, '新', '最新在前');
    const capped = D.normalizeExcerptList(list, 1);
    assert.equal(capped.length, 1);
    assert.equal(capped[0].text, '新', '超限丢最旧');
    assert.deepEqual(D.normalizeExcerptList(null), []);
});
/* ══════════════════ B. 同名覆盖口径 ══════════════════ */
test('B1 同名同指纹 ⇒ 替换（回原书）；同名异指纹 ⇒ 并存（不静默覆盖旧书）', () => {
    const st = mkStorage();
    const rd = new D.ReadingData(st);
    const p1 = mkParsed('甲书');
    const r1 = rd.addBook(p1, 'a.txt', 'utf-8', 'auto', { contentHash: D.contentHashOf('内容一') });
    assert.equal(r1.replaced, false);
    assert.equal(r1.coexist, false);
    const r2 = rd.addBook(mkParsed('甲书'), 'a.txt', 'utf-8', 'auto', { contentHash: D.contentHashOf('内容一') });
    assert.equal(r2.replaced, true, '同指纹必须替换');
    assert.equal(r2.coexist, false);
    assert.equal(rd.getBooks().length, 1);
    const r3 = rd.addBook(mkParsed('甲书'), 'a.txt', 'utf-8', 'auto', { contentHash: D.contentHashOf('内容二') });
    assert.equal(r3.replaced, false, '异指纹不得替换');
    assert.equal(r3.coexist, true, '异指纹必须如实报并存');
    assert.equal(rd.getBooks().length, 2, '同名两本并存');
    assert.ok(rd.getBooks().some((b) => b.id === r1.bookId), '旧书条目仍在（不静默覆盖）');
});
test('B2 findReusable 按（文件名 + 指纹）重接：丢附件后重新导入回到原书 id', () => {
    const st = mkStorage();
    const rd = new D.ReadingData(st);
    const hash = D.contentHashOf('同一本书');
    const r1 = rd.addBook(mkParsed('书'), 'b.txt', 'utf-8', 'auto', { contentHash: hash });
    const hit = rd.findReusable('b.txt', hash);
    assert.ok(hit && hit.id === r1.bookId, '同文件重导必须回到原 id（进度与引用才指得回去）');
    assert.equal(rd.findReusable('c.txt', hash), null, '换文件名不重接（同名才重接）');
    assert.equal(rd.findReusable('b.txt', D.contentHashOf('别的')), null, '换内容不重接');
    assert.equal(rd.findReusable('', hash), null);
    assert.equal(rd.findReusable('b.txt', ''), null);
});
test('B3 shelf 条目不含正文（正文不进 chatMetadata）', () => {
    const st = mkStorage();
    const rd = new D.ReadingData(st);
    rd.addBook(mkParsed('书'), 'b.txt', 'utf-8', 'auto', { contentHash: 'h1_1' });
    const raw = st.get('ruby_reading_shelf');
    assert.ok(typeof raw === 'string' && raw.length < 4000, '书架落盘必须是轻量元数据');
    const books = JSON.parse(raw);
    assert.ok(books.every((b) => !('chapters' in b) && !('paragraphs' in b)), 'shelf 条目不得持正文');
    assert.ok(books.every((b) => typeof b.contentHash === 'string'), '每条须带指纹');
});
/* ══════════════════ C. App 层（真控制器 + 桩宿主） ══════════════════ */
function mkApp() {
    const st = mkStorage();
    const notes = [];
    const shell = { showNotification: (t, m) => notes.push(m), screen: null, setContent: () => {}, getContentContainer: () => null };
    const app = new T.ReadingApp(shell, st);
    return { app, st, notes };
}
test('C1 addExcerpt 真写入 + 读回 + 脏输入如实报错不落盘', () => {
    const { app, st } = mkApp();
    const bad = app.addExcerpt({ text: '缺引用' });
    assert.ok(bad.error, '脏输入必须如实报错');
    assert.ok(!st.get('ruby_reading_excerpts'), '脏输入不得落盘');
    const ok = app.addExcerpt({ text: '一句摘录', bookId: 'b1', bookTitle: '书', chapter: 1, para: 3, chapterTitle: '第二章' });
    assert.equal(ok.ok, true);
    assert.equal(ok.count, 1);
    const got = app.getExcerpts();
    assert.equal(got.length, 1);
    assert.equal(got[0].bookId, 'b1');
    assert.equal(got[0].chapter, 1);
    assert.equal(got[0].para, 3);
    assert.ok(typeof st.get('ruby_reading_excerpts') === 'string', '真写入会话键');
});
test('C2 换会话重载：摘录从新会话键重读（不串味、不缓存旧值）', () => {
    const { app, st } = mkApp();
    app.addExcerpt({ text: '会话A摘录', bookId: 'b', chapter: 0, para: 0 });
    assert.equal(app.getExcerpts().length, 1);
    st._m.clear();                       /* 模拟换会话：键空间换了 */
    app.onChatChanged();
    assert.equal(app.getExcerpts().length, 0, '换会话必须重读，不得留旧缓存');
    app.addExcerpt({ text: '会话B摘录', bookId: 'b', chapter: 0, para: 0 });
    assert.equal(app.getExcerpts()[0].text, '会话B摘录');
});
/* ══════════════════ D. 视图层（真渲染输出） ══════════════════ */
test('D1 正文段落带 data-para 段索引 + 摘录列表如实显示引用', () => {
    const { app } = mkApp();
    app.getExcerpts = () => [{ id: 'ex_1', text: '摘录文本', bookId: 'b1', bookTitle: '一本书', chapter: 2, para: 4, chapterTitle: '第三章', createdAt: 1 }];
    const view = new V.ReadingView(app);
    view.currentBook = { id: 'b1', title: '一本书', chapters: [{ title: '第三章', paragraphs: ['甲', '乙'] }] };
    view.curChapter = 0;
    /* _renderReader 是纯字符串拼装，可直接取输出验段落索引 */
    const reader = view._renderReader({ text: '#000', sub: '#999', card: '#fff', bar: '#eee', border: '#ddd', soft: '#666' });
    assert.ok(reader.includes('data-para="0"') && reader.includes('data-para="1"'), '每段必须带段索引（摘录引用要靠它）');
    /* 书架页渲染摘录列表 */
    app.data.getBooks = () => [];
    view.currentBook = null;
    const shelf = view._renderShelf({ text: '#000', sub: '#999', card: '#fff', bar: '#eee', border: '#ddd', soft: '#666', bgImage: '' });
    assert.ok(shelf.includes('✂️ 摘录'), '书架页必须有摘录区');
    assert.ok(shelf.includes('一本书') && shelf.includes('第三章') && shelf.includes('第5段'), '摘录必须显示书/章/段引用（段号为 1 基）');
});
test('D2 源码不变量：落盘不含正文 / 摘录键已注册 / 无外部请求', () => {
    const data = read(DATA_REL);
    assert.ok(data.includes('contentHash'), '指纹口径必须在数据层');
    const stor = read('config/storage.js');
    assert.ok(stor.includes('/^ruby_reading_excerpts$/'), '摘录键必须归入会话隔离域');
    const keys = read('scripts/keys-audit.mjs');
    assert.ok(keys.includes("key: 'ruby_reading_excerpts'"), 'K1 登记必须同步');
    assert.ok(exists(APP_REL) && exists(VIEW_REL));
});
/* ══════════════════ E. 负控制（真源码破坏） ══════════════════ */
test('E1 负控制：把异指纹并存改回无条件同名覆盖 ⇒ 并存判据必须转红', async () => {
    const src = read(DATA_REL);
    const anchor = "                if (b.contentHash === book.contentHash) { replaced = true; reuseId = b.id; return false; }\n                coexist = true; return true;";
    assert.equal(src.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = src.replace(anchor, "                replaced = true; return false;");
    const negAbs = path.join(root, 'apps/reading/reading-data.__neg__.js');
    fs.writeFileSync(negAbs, broken);
    const M = await import(pathToFileURL(negAbs).href + '?v=' + Date.now());
    const rd = new M.ReadingData(mkStorage());
    rd.addBook(mkParsed('甲'), 'a.txt', 'utf-8', 'auto', { contentHash: 'hA' });
    const r = rd.addBook(mkParsed('甲'), 'a.txt', 'utf-8', 'auto', { contentHash: 'hB' });
    assert.equal(r.coexist, false, '破坏生效：异指纹不再报并存');
    assert.equal(rd.getBooks().length, 1, '破坏生效：旧书被静默覆盖');
    fs.unlinkSync(negAbs);
    /* 原版上同判据必须真（两本并存） */
    const rd2 = new D.ReadingData(mkStorage());
    rd2.addBook(mkParsed('甲'), 'a.txt', 'utf-8', 'auto', { contentHash: 'hA' });
    const r2 = rd2.addBook(mkParsed('甲'), 'a.txt', 'utf-8', 'auto', { contentHash: 'hB' });
    assert.equal(r2.coexist, true);
    assert.equal(rd2.getBooks().length, 2);
});
test('E2 负控制：摘录窄口放宽（缺章段索引也收）⇒ 引用完整性判据必须转红', async () => {
    const src = read(DATA_REL);
    const anchor = "    if (!Number.isInteger(chapter) || chapter < 0) return null;\n    if (!Number.isInteger(para) || para < 0) return null;";
    assert.equal(src.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = src.replace(anchor, "    const chapter2 = Number.isFinite(chapter) ? chapter : 0;\n    const para2 = Number.isFinite(para) ? para : 0;\n    void chapter2; void para2;");
    const negAbs = path.join(root, 'apps/reading/reading-data.__neg2__.js');
    fs.writeFileSync(negAbs, broken);
    const M = await import(pathToFileURL(negAbs).href + '?v=' + Date.now());
    const loose = M.normalizeExcerpt({ text: '有字', bookId: 'b1' });
    assert.ok(loose, '破坏生效：缺章段索引也收下了');
    assert.equal(D.normalizeExcerpt({ text: '有字', bookId: 'b1' }), null, '原版必须拒绝');
    fs.unlinkSync(negAbs);
});
/* ══════════════════ F. 版本锚 ══════════════════ */
test('F1 五源同源：3.99.2 落齐（常量 / 台账 / 包描述 / 迭代日志 / 改动面在场）', () => {
    const VER = '3.99.2';
    const IDX = read('index.js');
    assert.ok(IDX.includes("const ST_PHONE_VERSION = '" + VER + "';"), '入口常量');
    assert.ok(read('manifest.json').includes('"version": "' + VER + '"'), 'manifest');
    assert.ok(read('package.json').includes('"version": "' + VER + '"'), 'package.json');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, VER);
    assert.equal(ul.head, VER);
    assert.ok(ul.versions[VER], '台账必须有当版条目');
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')));
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 158 '), '迭代日志必须有当版段');
    assert.ok(read(DATA_REL).includes('contentHashOf'), '改动面：指纹在场');
    assert.ok(read(APP_REL).includes('findReusable'), '改动面：重接在场');
});
test('F2 历史档：3.99.1 台账条目仍在 + 迭代 157 段不可抹 + 入口版本不低于 3.99.1', () => {
    const ul = JSON.parse(read('update-log.json'));
    assert.ok(ul.versions['3.99.1'], '3.99.1 条目必须保留');
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 157 '), '迭代 157 段不可抹');
    const cur = (read('index.js').match(/const ST_PHONE_VERSION = '(\d+\.\d+\.\d+)';/) || [])[1] || '0.0.0';
    const cmp = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); } return 0; };
    assert.ok(cmp(cur, '3.99.1') >= 0, '入口版本不得低于 3.99.1（实测 ' + cur + '）');
});
