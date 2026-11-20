#!/usr/bin/env node
/* ============================================================
 * tools/glyph-check.mjs — 字符图标 / emoji 门禁（零依赖，Node 18+）
 * ------------------------------------------------------------
 * 扫描给定目录里的 .js .mjs .cjs .css .html .svg .md .json 文件，统计两类码点：
 *   EMOJI  —— Extended_Pictographic（按 Unicode 15.1 的主要区段）、变体选择符 U+FE0F、零宽连接符 U+200D、
 *             键帽 U+20E3、区域指示符、标签字符；
 *   GLYPH  —— 常被拿来「当图标用」的符号区段：箭头 U+2190-21FF / U+2900-297F / U+2B00-2BFF、
 *             杂项技术 U+2300-23FF、几何图形 U+25A0-25FF、杂项符号 U+2600-26FF、装饰符号 U+2700-27BF、
 *             以及 U+3030 U+303D U+3297 U+3299 U+2122 U+2139 U+24C2。
 * 任意一类计数 > 0 即退出码 1。用法：
 *   node tools/glyph-check.mjs [目录或文件 ...]          默认扫描当前目录
 *   node tools/glyph-check.mjs --json ui css             输出 JSON 报告
 * 说明：正则全部用 \u 转义书写，本文件自身不含任何被检码点。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.htm', '.svg', '.md', '.json']);
const SKIP_DIR = new Set(['node_modules', '.git', '.versions', '.metadata']);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}\u{FE0F}\u{200D}\u{20E3}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25FD}\u{25FE}\u{2614}\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}\u{26AB}\u{26BD}\u{26BE}\u{26C4}\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F5}\u{26FA}\u{26FD}\u{2705}\u{270A}\u{270B}\u{2728}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2795}-\u{2797}\u{27B0}\u{27BF}]/gu;
const GLYPH = /[\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{2122}\u{2139}\u{24C2}]/gu;

function* walk(p) {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
        for (const name of fs.readdirSync(p)) { if (!SKIP_DIR.has(name)) yield* walk(path.join(p, name)); }
    } else if (EXT.has(path.extname(p).toLowerCase())) {
        yield p;
    }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const roots = args.filter((a) => !a.startsWith('--'));
if (!roots.length) roots.push('.');

const report = { files: 0, emoji: 0, glyph: 0, hits: [] };
for (const root of roots) {
    for (const file of walk(root)) {
        report.files++;
        const text = fs.readFileSync(file, 'utf8');
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            const e = line.match(EMOJI) || [];
            const g = (line.match(GLYPH) || []).filter((ch) => !e.includes(ch));
            if (e.length || g.length) {
                report.emoji += e.length;
                report.glyph += g.length;
                report.hits.push({ file, line: i + 1, codepoints: [...e, ...g].map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')) });
            }
        });
    }
}

if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`glyph-check：扫描 ${report.files} 个文件，emoji 码点 ${report.emoji} 个，字符图标码点 ${report.glyph} 个`);
    for (const h of report.hits.slice(0, 200)) console.log(`  ${h.file}:${h.line}  ${h.codepoints.join(' ')}`);
    console.log(report.emoji + report.glyph === 0 ? '[OK] 零 emoji、零字符图标' : '[FAIL] 发现上面列出的码点，请改用 shared/icons.js 的 SVG 图标');
}
process.exit(report.emoji + report.glyph === 0 ? 0 : 1);
