/* ========================================================
 * 阅读 App — EPUB 解析器（零依赖）
 * 极简 ZIP 只读解析（中央目录）+ EPUB 结构解析
 * 依赖浏览器原生 DecompressionStream（参照 image-generation-manager 既有用法）
 * 纯本地零 LLM
 * ======================================================== */
'use strict';

// ---- 极简 ZIP 只读解析 ----
// 仅支持 Standard Zip: 定位 EOCD → 中央目录 → 逐条目读 local header
export async function parseZipEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);

    // 定位 EOCD (End Of Central Directory): 0x06054b50
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('无效的 ZIP 文件（找不到中央目录结尾）');

    const cdCount = dv.getUint16(eocd + 10, true);   // 中央目录条目数
    const cdOffset = dv.getUint32(eocd + 16, true);  // 中央目录偏移
    const entries = new Map();

    let pos = cdOffset;
    for (let i = 0; i < cdCount; i++) {
        if (dv.getUint32(pos, true) !== 0x02014b50) break; // 中央目录签名
        const method = dv.getUint16(pos + 10, true);       // 压缩方法 0=STORE 8=DEFLATE
        const compSize = dv.getUint32(pos + 20, true);
        const uncompSize = dv.getUint32(pos + 24, true);
        const nameLen = dv.getUint16(pos + 28, true);
        const extraLen = dv.getUint16(pos + 30, true);
        const commentLen = dv.getUint16(pos + 32, true);
        const localOffset = dv.getUint32(pos + 42, true);
        const nameBytes = bytes.slice(pos + 46, pos + 46 + nameLen);
        const name = new TextDecoder('utf-8').decode(nameBytes);
        entries.set(name, { method, compSize, uncompSize, localOffset });
        pos += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.size === 0) throw new Error('无效的 ZIP 文件（中央目录为空）');
    return { entries, dv, bytes };
}

// 读取单个条目并解压
export async function readZipEntry(zip, entryName) {
    const { entries, dv, bytes } = zip;
    const meta = entries.get(entryName);
    if (!meta) return null;
    const { method, compSize, uncompSize, localOffset } = meta;

    // 跳 local header (30 字节 + 名字长度 + 额外字段长度)
    const nameLen = dv.getUint16(localOffset + 26, true);
    const extraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + nameLen + extraLen;
    const compBytes = bytes.slice(dataStart, dataStart + compSize);

    if (method === 0) {
        // STORE 未压缩
        return new TextDecoder('utf-8').decode(compBytes);
    }
    // DEFLATE: 用浏览器原生 DecompressionStream
    if (method === 8) {
        if (typeof DecompressionStream === 'function') {
            try {
                const stream = new Blob([compBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                const buf = await new Response(stream).arrayBuffer();
                return new TextDecoder('utf-8').decode(buf);
            } catch (e) {
                // 某些 ZIP 用 zlib 包裹 (deflate 而非 deflate-raw)
                try {
                    const stream2 = new Blob([compBytes]).stream().pipeThrough(new DecompressionStream('deflate'));
                    const buf2 = await new Response(stream2).arrayBuffer();
                    return new TextDecoder('utf-8').decode(buf2);
                } catch (e2) {
                    throw new Error('ZIP 条目解压失败: ' + entryName);
                }
            }
        }
        throw new Error('浏览器不支持原生解压，无法读取 EPUB');
    }
    throw new Error('不支持的压缩方法: ' + method);
}

function stripHtmlTags(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/"/g, '"')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractTextFromHtml(html) {
    const titleMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)
        || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : '';
    const paragraphs = [];
    const blockPattern = /<(?:p|div|li)[^>]*>([\s\S]*?)<\/(?:p|div|li)>/gi;
    let match;
    while ((match = blockPattern.exec(html)) !== null) {
        const text = stripHtmlTags(match[1]).trim();
        if (text.length > 0) paragraphs.push(text);
    }
    if (paragraphs.length === 0) {
        const plainText = stripHtmlTags(html).trim();
        if (plainText) {
            const lines = plainText.split(/\n{2,}/).map(l => l.trim()).filter(l => l.length > 0);
            paragraphs.push(...lines);
        }
    }
    return { title, paragraphs };
}

/**
 * 解析 EPUB 为 { title, author, chapters }
 * @param {ArrayBuffer} arrayBuffer EPUB 文件字节
 */
export async function parseEpubFile(arrayBuffer) {
    const zip = await parseZipEntries(arrayBuffer);

    // 1. container.xml → rootfile 路径
    const containerXml = await readZipEntry(zip, 'META-INF/container.xml');
    if (!containerXml) throw new Error('无效的 EPUB：缺少 META-INF/container.xml');
    const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!rootfileMatch) throw new Error('无效的 EPUB：无 rootfile');
    const rootfilePath = rootfileMatch[1];
    const rootDir = rootfilePath.includes('/') ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1) : '';

    // 2. OPF 包文档
    const opfXml = await readZipEntry(zip, rootfilePath);
    if (!opfXml) throw new Error('无效的 EPUB：缺少 OPF');

    const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
    const authorMatch = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    const bookTitle = (titleMatch ? stripHtmlTags(titleMatch[1]).trim() : '') || '未命名';
    const author = authorMatch ? stripHtmlTags(authorMatch[1]).trim() : '';

    // 3. spine 阅读顺序
    const spineItems = [];
    const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
    if (spineMatch) {
        const itemRefPattern = /idref="([^"]+)"/g;
        let m;
        while ((m = itemRefPattern.exec(spineMatch[1])) !== null) {
            spineItems.push(m[1]);
        }
    }

    // 4. manifest id → href
    const idToHref = new Map();
    const manifestMatch = opfXml.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i);
    if (manifestMatch) {
        const itemPattern = /id="([^"]+)"[^>]*href="([^"]+)"/g;
        let m;
        while ((m = itemPattern.exec(manifestMatch[1])) !== null) {
            idToHref.set(m[1], m[2]);
        }
    }

    // 5. 逐个 spine 条目提取文本
    const chapters = [];
    for (const itemId of spineItems) {
        const href = idToHref.get(itemId);
        if (!href) continue;
        let filePath;
        try { filePath = rootDir + decodeURIComponent(href); }
        catch (e) { filePath = rootDir + href; }
        const html = await readZipEntry(zip, filePath);
        if (!html) continue;
        const { title, paragraphs } = extractTextFromHtml(html);
        if (paragraphs.length === 0) continue;
        chapters.push({ title: title || `第${chapters.length + 1}章`, paragraphs });
    }
    if (chapters.length === 0) {
        throw new Error('EPUB 解析失败，未找到文本内容');
    }
    return { title: bookTitle, author, chapters };
}

export default parseEpubFile;