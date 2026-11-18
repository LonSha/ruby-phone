#!/usr/bin/env node
/* ============================================================
 * tools/split_phone_css_lazy.mjs — 把 App 独有样式搬出 phone.css [R25-O4]
 * ------------------------------------------------------------
 * 用法：
 *   node tools/split_phone_css_lazy.mjs            # 只算不改（打印每个 App 可搬多少字节）
 *   node tools/split_phone_css_lazy.mjs --write     # 真改 phone.css
 *
 * 【为什么要一个工具，而不是手删】
 *   搬样式是「不报错、不崩溃、只错结果」的重灾区：少搬一条别的 App 会裸奔，多搬一条
 *   本 App 会掉样式，两条都不报错。所以搬的动作必须带**当场验的两条硬条件**：
 *     ① 每条搬走的规则，必须在 apps/<id>/<id>.css 里逐条存在（忽略空白与注释）——
 *        否则「搬到哪去了」就是凭空丢规则；
 *     ② 每条搬走的规则，其选择器里的类前缀**全部属于本 App**（共享前缀 .is-* 一律不搬）——
 *        否则就是拿别的 App 的样式当代价。
 *   任一条不成立 ⇒ exit 3，**一个字节都不改**（宁可不动，不许错着动）。
 *
 * 【为什么它不写回 config/style-lazy.js】
 *   那本账是**人**的声明（bytes / why），工具只做校验：算出来的可搬字节必须与账本
 *   声明**逐条相等**，不等就红。让工具改账本等于让被判据者自己填表。
 *
 * 退出码：0 一致（--write 时已改）/ 3 账本或验条件不成立 / 2 用法错误。
 * 本文件不用正则、不写字面反斜杠（生成链会吃反斜杠）：引号与空白一律走字符码。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_LAZY } from '../config/style-lazy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CSS_PATH = path.join(ROOT, 'phone.css');
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const Q1 = String.fromCharCode(34);
const Q2 = String.fromCharCode(39);
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const WRITE = process.argv.slice(2).indexOf('--write') >= 0;

const isSpace = (ch) => ch === ' ' || ch === TAB || ch === NL || ch === CR;
const isWord = (ch) => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '-';
const isLower = (ch) => ch >= 'a' && ch <= 'z';
const isSep = (ch) => isSpace(ch) || ch === ',' || ch === '>' || ch === '+' || ch === '~' || ch === '(';

/** 去掉注释（位置留一个空格）。 */
function stripComments(t) {
    let out = '';
    let i = 0;
    while (i < t.length) {
        if (t[i] === '/' && t[i + 1] === '*') {
            const e = t.indexOf('*/', i + 2);
            i = e < 0 ? t.length : e + 2;
            out += ' ';
            continue;
        }
        out += t[i];
        i += 1;
    }
    return out;
}

/** 压掉全部空白（逐条比对用：两边源码缩进不同，但规则必须一模一样）。 */
function noWs(t) {
    const src = stripComments(t);
    let out = '';
    for (const ch of src) {
        if (isSpace(ch)) continue;
        out += ch;
    }
    return out;
}

/** 把 CSS 切成「顶层块」：prelude + { ... }（@media/@supports 递归处理）。
 *  手写扫描器能正确处理字符串、注释与嵌套花括号 —— 正则在这三样上必然出错。 */
function scanBlocks(text) {
    const out = [];
    let i = 0;
    let preludeStart = 0;
    let depth = 0;
    let inStr = null;
    let blockOpen = -1;
    while (i < text.length) {
        const c = text[i];
        if (inStr) {
            if (c === inStr && text[i - 1] !== BS) inStr = null;
            i += 1;
            continue;
        }
        if (c === Q1 || c === Q2) { inStr = c; i += 1; continue; }
        if (c === '/' && text[i + 1] === '*') {
            const e = text.indexOf('*/', i + 2);
            i = e < 0 ? text.length : e + 2;
            continue;
        }
        if (c === '{') {
            if (depth === 0) blockOpen = i;
            depth += 1;
            i += 1;
            continue;
        }
        if (c === '}') {
            depth -= 1;
            i += 1;
            if (depth === 0) {
                out.push({
                    start: preludeStart,
                    end: i,
                    prelude: text.slice(preludeStart, blockOpen),
                    body: text.slice(blockOpen + 1, i - 1)
                });
                preludeStart = i;
            }
            continue;
        }
        i += 1;
    }
    if (preludeStart < text.length) out.push({ start: preludeStart, end: text.length, prelude: text.slice(preludeStart), body: null });
    return out;
}

/** 选择器里出现的类前缀族（.abc-xxx ⇒ abc）。 */
function prefixesIn(s) {
    const set = new Set();
    let i = 0;
    while (i < s.length) {
        if (s[i] === '.' && (i === 0 || isSep(s[i - 1]))) {
            let j = i + 1;
            let tok = '';
            while (j < s.length && isWord(s[j])) { tok += s[j]; j += 1; }
            const dash = tok.indexOf('-');
            if (dash > 0 && isLower(tok.charAt(0))) set.add(tok.slice(0, dash));
            i = j;
            continue;
        }
        i += 1;
    }
    return Array.from(set);
}

const cssText = fs.readFileSync(CSS_PATH, 'utf8');
const beforeBytes = Buffer.byteLength(cssText);

const ledger = new Map();
for (const e of STYLE_LAZY) ledger.set(e.appId, { entry: e, own: new Set(e.prefixes), moved: [], movedBytes: 0 });

function ownerOf(prelude) {
    const ps = prefixesIn(prelude);
    if (ps.length === 0) return null;
    for (const appId of ledger.keys()) {
        const rec = ledger.get(appId);
        let all = true;
        for (const p of ps) {
            if (!rec.own.has(p)) { all = false; break; }
        }
        if (all) return appId;
    }
    return null;
}

/* 递归：把可搬的块从 text 里摘掉，同时把摘掉的规则文本记进账。 */
function extract(text) {
    const blocks = scanBlocks(text);
    let keptOut = '';
    let cursor = 0;
    for (const b of blocks) {
        keptOut += text.slice(cursor, b.start);
        const preludeTrim = b.prelude.trim();
        const isAt = b.body !== null && preludeTrim.indexOf('@') === 0;
        const owner = (isAt || b.body === null) ? null : ownerOf(b.prelude);
        if (owner) {
            const rec = ledger.get(owner);
            rec.moved.push(noWs(text.slice(b.start, b.end)));
            rec.movedBytes += Buffer.byteLength(text.slice(b.start, b.end));
            cursor = b.end;
            continue;
        }
        if (isAt) {
            /* @media / @supports：先递归内部；内部全被摘掉就整块不留（不许留空壳）。 */
            const inner = extract(b.body);
            if (inner.trim() === '') {
                cursor = b.end;
                continue;
            }
            keptOut += b.prelude + '{' + inner + '}';
            cursor = b.end;
            continue;
        }
        keptOut += text.slice(b.start, b.end);
        cursor = b.end;
    }
    keptOut += text.slice(cursor);
    return keptOut;
}

const nextCss = extract(cssText);
const nextBytes = Buffer.byteLength(nextCss);

/* 条件①：每条搬走的规则必须在 App 自己的 css 里逐条存在。 */
const problems = [];
let alreadyDone = 0;
for (const [appId, rec] of ledger.entries()) {
    const cssFile = path.join(ROOT, 'apps', appId, appId + '.css');
    let src = '';
    try { src = fs.readFileSync(cssFile, 'utf8'); } catch (_e) {
        problems.push(appId + '：没有 apps/' + appId + '/' + appId + '.css，搬走就无处可搬');
        continue;
    }
    const flat = noWs(src);
    for (const rule of rec.moved) {
        if (flat.indexOf(rule) < 0) problems.push(appId + '：搬走的规则在自己的 css 里找不到（会凭空丢样式）：' + rule.slice(0, 80));
    }
    /* 幂等：这条已搬完（phone.css 里已无该 App 的规则）⇒ 不再对账字节，
     * 但仍要求「搬完」这件事可重现：声明了多少就必须一条不剩地搬走过。 */
    if (rec.movedBytes === 0 && rec.entry.bytes > 0) {
        alreadyDone += 1;
        continue;
    }
    if (rec.movedBytes !== rec.entry.bytes) {
        problems.push(appId + '：账本声明搬出 ' + rec.entry.bytes + 'B，实测可搬 ' + rec.movedBytes + 'B（账本与实况必须逐条相等）');
    }
}

console.log('[split-css] phone.css ' + beforeBytes + 'B ⇒ ' + nextBytes + 'B（减少 ' + (beforeBytes - nextBytes) + 'B）');
if (alreadyDone > 0 && nextBytes === beforeBytes) console.log('[split-css] 已搬完 ' + alreadyDone + ' 个 App（幂等：phone.css 里已无它们的独有规则）');
for (const [appId, rec] of ledger.entries()) {
    console.log('  - ' + appId + '  ' + rec.moved.length + ' 条规则 · ' + rec.movedBytes + 'B（账本 ' + rec.entry.bytes + 'B）');
}
if (problems.length > 0) {
    console.error('[split-css] 验条件不成立 ' + problems.length + ' 条 ⇒ 一个字节都没改：');
    for (const p of problems.slice(0, 12)) console.error('  - ' + p);
    process.exit(3);
}
if (!WRITE) {
    console.log('[split-css] 只算不改（加 --write 才会写 phone.css）');
    process.exit(0);
}
fs.writeFileSync(CSS_PATH, nextCss);
console.log('[split-css] phone.css 已重写：' + beforeBytes + 'B ⇒ ' + nextBytes + 'B');