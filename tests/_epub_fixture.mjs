// tests/_epub_fixture.mjs — 零依赖 EPUB 夹具（STORE 方式，逐字节自造）
//
// 【为什么要造这个】
//   tests/reading-epub.test.mjs 原来直接 `fs.readFileSync('/tmp/test_book.epub')` ——
//   而全仓**没有任何脚本生成这个文件**（只有那一处引用）。于是这条测试的通过与否
//   取决于「上次谁手工在 /tmp 里放过一个 epub」：干净环境必红（本仓长期挂着这一条失败），
//   而它红的时候给出的信息是 ENOENT，与「EPUB 解析器坏了」完全无法区分 ——
//   正是本仓最忌讳的那一类形态：**看起来没坏但判定不对**。
//   修法：夹具进仓、由测试自己生成字节，断言一条不减。
//
// 【零依赖的 ZIP 写法（只写 STORE 未压缩条目）】
//   解析器（apps/reading/reading-epub.js）只读两处：中央目录（定位各条目的 localOffset
//   与 compSize）与 local header（取名字/额外字段长度算 dataStart）。故本夹具只需
//   如实写出 ①local header ②数据 ③中央目录 ④EOCD。用 STORE ⇒ 不碰 DecompressionStream，
//   在无头 Node 里也能跑（解析器对 method 8 走 Blob/DecompressionStream，那是浏览器面）。
//
// 【口径纪律】位置无关：不写任何临时文件，纯内存返回 ArrayBuffer。

/** CRC-32（IEEE 802.3），供 ZIP 条目校验字段用。 */
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = new TextEncoder();

/**
 * 造一个 ZIP（全部 STORE）→ ArrayBuffer。
 * @param {Array<{name: string, text: string}>} files 条目顺序即写入顺序
 */
export function buildStoreZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);   // local file header 签名
    lh.setUint16(4, 20, true);           // version needed
    lh.setUint16(6, 0x0800, true);       // flag：UTF-8 名字
    lh.setUint16(8, 0, true);            // method = 0 (STORE)
    lh.setUint16(10, 0, true);           // mod time
    lh.setUint16(12, 0x21, true);        // mod date（1980-01-01）
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); // comp size
    lh.setUint32(22, data.length, true); // uncomp size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);           // extra len
    locals.push(new Uint8Array(lh.buffer), nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);   // central directory 签名
    ch.setUint16(4, 20, true);           // version made by
    ch.setUint16(6, 20, true);           // version needed
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);           // method = 0
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);           // extra
    ch.setUint16(32, 0, true);           // comment
    ch.setUint16(34, 0, true);           // disk start
    ch.setUint16(36, 0, true);           // internal attrs
    ch.setUint32(38, 0, true);           // external attrs
    ch.setUint32(42, offset, true);      // local header offset
    centrals.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of centrals) cdSize += c.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);   // EOCD 签名
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);

  const parts = [...locals, ...centrals, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}

/**
 * 造一本两章的测试书。
 * 断言面（与 tests/reading-epub.test.mjs 逐条对应）：书名 / 作者 / 两章 / 章标题 /
 * 首章首段含「推开木门」/ 次章含「渡口」。
 */
export function buildTestBook() {
  const container = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    + '  <rootfiles><rootfile full-path="OEBPS/content.opf" '
    + 'media-type="application/oebps-package+xml"/></rootfiles>\n'
    + '</container>\n';
  const opf = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">\n'
    + '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    + '    <dc:title>测试小说</dc:title>\n'
    + '    <dc:creator>测试作者</dc:creator>\n'
    + '    <dc:language>zh</dc:language>\n'
    + '  </metadata>\n'
    + '  <manifest>\n'
    + '    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>\n'
    + '    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>\n'
    + '  </manifest>\n'
    + '  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>\n'
    + '</package>\n';
  const ch1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>\n'
    + '<h1>第一章 木门</h1>\n'
    + '<p>他推开木门，院子里积着昨夜的雨水。</p>\n'
    + '<p>檐下的风铃响了一声，又安静下去。</p>\n'
    + '</body></html>\n';
  const ch2 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body>\n'
    + '<h1>第二章 渡口</h1>\n'
    + '<p>天没亮她就到了渡口，船还没来。</p>\n'
    + '<p>水面上一层薄雾，把对岸的树影化开了。</p>\n'
    + '</body></html>\n';
  return buildStoreZip([
    { name: 'mimetype', text: 'application/epub+zip' },
    { name: 'META-INF/container.xml', text: container },
    { name: 'OEBPS/content.opf', text: opf },
    { name: 'OEBPS/ch1.xhtml', text: ch1 },
    { name: 'OEBPS/ch2.xhtml', text: ch2 }
  ]);
}