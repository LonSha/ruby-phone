#!/usr/bin/env node
/* ============================================================
 * tools/strip-emoji.mjs —— RubyPhone 版（v3.6，零依赖，Node 18+）
 * ------------------------------------------------------------
 * 与 lonsha-memory-plugin 的 tools/strip-emoji.mjs（v3.2）同源：码点分类与 JS 词法器逐字沿用（见 <core> 段），
 * 但**规则完全不同**——ruby-phone 的约束是「iOS 拟真开关默认关、关着时页面逐字节不变」，所以本版：
 *   1. **默认不改 App 源码**。界面外壳里的 emoji / 字符图标，统一在运行时（phone/ui/rp-skin-runtime.js 的字符图标桥，
 *      只在 #phone-panel[data-rp-ios="3"] 时工作、detach 逐字还原）换成 shared/icons.js 的 SVG。
 *      本工具的职责是：把「运行时才拼出来」的 emoji 全部找出来，模拟它们落进 DOM 的位置，
 *      判定运行时桥能不能认出来，认不出来的给出站点规则（phone/ui/rp-glyph-sites-v3.6.js），并把每一条「保留」写明理由。
 *   2. 「运行时拼出」的四种形态都认：
 *        concat   字面量与运行时值用 + 拼接，或模板字符串里夹着 ${...}（例：'<span>[红心] ' + n + '</span>'）
 *        escape   源码里写成 \uXXXX / \u{XXXXX} 转义（上游为了过自家源码门禁大量这样写）
 *        fcp      String.fromCharCode / fromCodePoint 用常量参数拼出（含代理对两次调用相加）
 *        map      对象 / 数组查表（{ ok: { icon: '\u{1f514}' } } 之类），落点按消费处（.icon / 变量名）追踪
 *      源码里直接写死、也不拼接的 emoji（static）同样列出，按同一套落点规则判定。
 *   3. 落点模拟与运行时桥**同一套判据**（CONTENT_DENY / CHROME_SEL 从 rp-skin-runtime.js 读出，站点表从
 *      rp-glyph-sites-v3.6.js 读出）：
 *        V33_ONLY    文本节点里只有字符图标                -> v3.3 规则已换
 *        V33_LEAD    外壳元素里开头的字符图标              -> v3.3 规则已换
 *        V36_COUNTER 「图标 + 数字」计数串（[红心] 12 [气泡] 3）-> v3.6 计数规则全换（v3.3 只换第一个）
 *        V36_SITE    站点表命中                              -> v3.6 站点规则（该元素内所有字符图标都换）
 *        V36_ATTR    title / aria-label / placeholder / alt / <option> 开头的字符图标 -> v3.6 去掉（原值存档，detach 还原）
 *        KEEP_*      内容区 / 发给模型的提示词 / 控制台日志 / 功能性比较 / 用户数据 / 不渲染 —— 写明理由
 *        GAP         外壳但运行时认不出来 —— 必须为 0（--check 时非 0 退出码）
 *
 * 用法（在 ruby-phone 仓库根目录执行）：
 *   node tools/strip-emoji.mjs                    报告摘要（按 App / 形态 / 判定计数）
 *   node tools/strip-emoji.mjs --tsv=FILE         写出逐条清单（文件、行、码点、形态、落点、判定、理由）
 *   node tools/strip-emoji.mjs --json=FILE        完整 JSON
 *   node tools/strip-emoji.mjs --check            有 GAP 或「运行时拼出、落点不明」的外壳站点时退出码 1（给 CI 用）
 *   node tools/strip-emoji.mjs --tests            列出 tests/ 里断言了这些字符串的地方（本版不改源码，所以它们都不需要改；列出来是为了上游哪天改成 JS 补丁时知道要动哪些）
 *   node tools/strip-emoji.mjs --app=peek,affairs 只看这几个 App（站点表的 app 字段只是登记归属；运行时与本工具都按选择器全局匹配）
 *   node tools/strip-emoji.mjs --write            **只做一件事**：把站点表里标了 patch 的条目（本版 0 条）按锚点改写；其余一律不写源码
 * 本文件自身不含任何被检码点：所有字符一律用 \u 转义书写。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

// <core>
/* ---------------- 码点分类（与 lonsha-memory-plugin tools/strip-emoji.mjs v3.2 逐字相同） ---------------- */
const EMOJI_SRC = '[\\u{1F000}-\\u{1FAFF}\\u{E0020}-\\u{E007F}\\u{2B50}\\u{2B55}\\u{231A}\\u{231B}\\u{23E9}-\\u{23F3}\\u{23F8}-\\u{23FA}\\u{25FD}\\u{25FE}\\u{2614}\\u{2615}\\u{2648}-\\u{2653}\\u{267F}\\u{2693}\\u{26A1}\\u{26AA}\\u{26AB}\\u{26BD}\\u{26BE}\\u{26C4}\\u{26C5}\\u{26CE}\\u{26D4}\\u{26EA}\\u{26F2}-\\u{26F5}\\u{26FA}\\u{26FD}\\u{2705}\\u{270A}\\u{270B}\\u{2728}\\u{274C}\\u{274E}\\u{2753}-\\u{2755}\\u{2757}\\u{2795}-\\u{2797}\\u{27B0}\\u{27BF}]';
const GLYPH_SRC = '[\\u{2190}-\\u{21FF}\\u{2300}-\\u{23FF}\\u{25A0}-\\u{25FF}\\u{2600}-\\u{27BF}\\u{2900}-\\u{297F}\\u{2B00}-\\u{2BFF}\\u{3030}\\u{303D}\\u{3297}\\u{3299}\\u{2122}\\u{2139}\\u{24C2}]';
const MOD_SRC = '[\\u{FE0E}\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}\\u{20E3}]';
/* 一个「簇」= 基字符 + 可选变体选择符 / 肤色 / 键帽 + 可选 ZWJ 连接的后续字符 */
const CLUSTER_SRC = '(?:' + EMOJI_SRC + '|' + GLYPH_SRC + ')' + MOD_SRC + '*(?:\\u{200D}(?:' + EMOJI_SRC + '|' + GLYPH_SRC + ')' + MOD_SRC + '*)*|' + MOD_SRC + '|\\u{200D}';
const reCluster = () => new RegExp(CLUSTER_SRC, 'gu');
const EMOJI_RE = new RegExp(EMOJI_SRC + '|[\\u{FE0F}\\u{200D}\\u{20E3}]', 'gu');
const GLYPH_RE = new RegExp(GLYPH_SRC, 'gu');
const cp = (s) => s.codePointAt(0);
const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');

/* ---------------- 词法（够用的 JS 词法器：注释 / 字符串 / 模板（含嵌套 ${}）/ 正则 / 其他） ---------------- */
const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
function lex(src) {
    const toks = []; const n = src.length; let i = 0; const stack = []; let depth = 0; let last = null; let gid = 0;
    const isId = (ch) => /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127;
    const scanTpl = (start, g) => {
        let j = start + 1;
        while (j < n) {
            const ch = src[j];
            if (ch === '\\') { j += 2; continue; }
            if (ch === '`') { toks.push({ k: 'tpl', s: start, e: j + 1, g, open: false }); last = { k: 'str' }; return j + 1; }
            if (ch === '$' && src[j + 1] === '{') { toks.push({ k: 'tpl', s: start, e: j + 2, g, open: true }); stack.push({ depth, g }); depth = 0; last = { k: 'p', t: '{' }; return j + 2; }
            j++;
        }
        toks.push({ k: 'tpl', s: start, e: n, g, open: false }); return n;
    };
    while (i < n) {
        const ch = src[i];
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
        if (ch === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; toks.push({ k: 'com', s: i, e: j }); i = j; continue; }
        if (ch === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; toks.push({ k: 'com', s: i, e: j }); i = j; continue; }
        if (ch === '\'' || ch === '"') {
            let j = i + 1;
            while (j < n && src[j] !== ch) { if (src[j] === '\\') j += 2; else if (src[j] === '\n') break; else j++; }
            toks.push({ k: 'str', s: i, e: j + 1, q: ch }); i = j + 1; last = { k: 'str' }; continue;
        }
        if (ch === '`') { i = scanTpl(i, ++gid); continue; }
        if (ch === '}' && stack.length && depth === 0) { const top = stack.pop(); depth = top.depth; i = scanTpl(i, top.g); continue; }
        if (ch === '/') {
            const ok = !last || (last.k === 'p' && !')]}'.includes(last.t)) || (last.k === 'id' && KW_BEFORE_REGEX.has(last.t));
            if (ok) {
                let j = i + 1; let cls = false;
                while (j < n) { const c = src[j]; if (c === '\\') { j += 2; continue; } if (c === '\n') break; if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break; j++; }
                j++; while (j < n && /[a-z]/i.test(src[j])) j++;
                toks.push({ k: 're', s: i, e: j }); i = j; last = { k: 'str' }; continue;
            }
        }
        if (isId(ch)) { let j = i; while (j < n && isId(src[j]) && src[j] !== '\u00A0' && src[j] !== '\u3000') j++; if (j === i) j = i + 1; toks.push({ k: 'id', s: i, e: j }); last = { k: 'id', t: src.slice(i, j) }; i = j; continue; }
        if (ch === '{') depth++; else if (ch === '}') depth--;
        /* 多字符运算符合并成一个 punc，=== 之类的比较判定要用 */
        const three = src.substr(i, 3), two = src.substr(i, 2);
        const op = (three === '===' || three === '!==') ? three : ((['==', '!=', '=>', '&&', '||', '??', '+=', '?.'].includes(two)) ? two : ch);
        toks.push({ k: 'p', s: i, e: i + op.length, t: op }); last = { k: 'p', t: op }; i += op.length;
    }
    return toks;
}



/* ---------------- 字面量解码 ---------------- */
function decodeLiteral(raw, kind) {
    let body;
    if (kind === 'str') body = raw.slice(1, raw.endsWith(raw[0]) && raw.length > 1 ? -1 : undefined);
    else { body = raw.replace(/^[`}]/, ''); body = body.endsWith('${') ? body.slice(0, -2) : body.replace(/`$/, ''); }
    return body.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (m, _a, u1, u2, x, ch) => {
        if (u1) return String.fromCodePoint(parseInt(u1, 16));
        if (u2) return String.fromCharCode(parseInt(u2, 16));
        if (x) return String.fromCharCode(parseInt(x, 16));
        return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' })[ch] ?? ch;
    });
}
const hasGlyph = (s) => reCluster().test(s);
const clustersOf = (s) => (String(s).match(reCluster()) || []).filter((c) => !/^[\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]+$/u.test(c));
const cpList = (cl) => [...cl].map((ch) => 'U+' + hex(cp(ch))).join(' ');

/* ---------------- 与运行时同一套判据（从 rp-skin-runtime.js / rp-glyph-sites-v3.6.js 读出，读不到就报错） ---------------- */
function readArrayLiteral(text, name) {
    const i = text.indexOf(name);
    if (i < 0) throw new Error('anchor-miss: ' + name);
    const a = text.indexOf('[', i);
    let depth = 0, j = a, q = '';
    for (; j < text.length; j++) {
        const ch = text[j];
        if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = ''; continue; }
        if (ch === '\'' || ch === '"') { q = ch; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) break; }
    }
    return text.slice(a, j + 1);
}
function loadJudges(root) {
    const rt = fs.readFileSync(path.join(root, 'phone/ui/rp-skin-runtime.js'), 'utf8');
    const deny = [...readArrayLiteral(rt, 'const CONTENT_DENY').matchAll(/'([^']*)'/g)].map((x) => x[1]);
    const m = /const CHROME_SEL = '([^']+)'/.exec(rt);
    if (!m) throw new Error('anchor-miss: CHROME_SEL');
    const chrome = m[1].split(/\s*,\s*/);
    const st = fs.readFileSync(path.join(root, 'phone/ui/rp-glyph-sites-v3.6.js'), 'utf8');
    const sites = JSON.parse(readArrayLiteral(st, 'GLYPH_SITES = Object.freeze('));
    return { deny, chrome, sites };
}
/* 极简选择器匹配：只支持「标签? (.类)* ([属性*="值"] / [属性] / [属性="值"])?」的复合选择器，空格 = 后代、> = 子 */
function parseCompound(c) {
    const o = { tag: '', cls: [], attr: null };
    const am = /\[([\w-]+)(?:(\*?=)"([^"]*)")?\]/.exec(c);
    if (am) { o.attr = { name: am[1], op: am[2] || '', val: am[3] || '' }; c = c.replace(am[0], ''); }
    const tm = /^[a-zA-Z][\w-]*/.exec(c); if (tm) o.tag = tm[0].toLowerCase();
    (c.match(/\.[\w-]+/g) || []).forEach((x) => o.cls.push(x.slice(1)));
    return o;
}
function matchCompound(el, o) {
    if (o.tag && el.tag !== o.tag) return false;
    for (const c of o.cls) if (!el.classes.includes(c)) return false;
    if (o.attr) {
        const v = o.attr.name === 'class' ? el.classStr : el.attrs[o.attr.name];
        if (v === undefined) return false;
        if (o.attr.op === '*=' && !String(v).includes(o.attr.val)) return false;
        if (o.attr.op === '=' && String(v) !== o.attr.val) return false;
    }
    return !!(o.tag || o.cls.length || o.attr);
}
/** stack：外到内的元素数组；判断「最内层元素（或其祖先）.closest(sel)」是否成立 */
function closestMatch(stack, sel) {
    for (const one of sel.split(/\s*,\s*/)) {
        const parts = one.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
        const comps = []; let child = false;
        for (const p of parts) { if (p === '>') { child = true; continue; } comps.push({ o: parseCompound(p), child }); child = false; }
        for (let k = stack.length - 1; k >= 0; k--) {
            if (!matchCompound(stack[k], comps[comps.length - 1].o)) continue;
            let ok = true, pos = k;
            for (let c = comps.length - 2; c >= 0 && ok; c--) {
                const needChild = comps[c + 1].child;
                let found = -1;
                for (let q = pos - 1; q >= 0; q--) { if (matchCompound(stack[q], comps[c].o)) { found = q; break; } if (needChild) break; }
                if (found < 0) ok = false; else pos = found;
            }
            if (ok) return true;
        }
    }
    return false;
}

/* ---------------- 表达式重建：把一条拼接表达式还原成「字面量原文 + § 占位」 ---------------- */
const TYPO_ARROWS = new Set([0x2190, 0x2192, 0x2194, 0x21D0, 0x21D2, 0x21D4, 0x27F6, 0x2191, 0x2193]);
const HARD_TAGS = new Set(['textarea', 'input', 'select', 'script', 'style', 'pre', 'code']);
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'wbr', 'col', 'area']);
function tplLevels(toks) {
    const lv = new Array(toks.length).fill(0); let depth = 0; const open = new Map();
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k === 'tpl') {
            const continuing = open.has(t.g);
            if (continuing) depth--;
            lv[i] = depth;
            if (t.open) { open.set(t.g, true); depth++; } else open.delete(t.g);
        } else lv[i] = depth;
    }
    return lv;
}
const STOP_BACK = new Set([';', '=', '=>', '{', '}', '+=', '&&', '||', '??']);
function exprRange(src, toks, lv, t) {
    const L = lv[t];
    const inCall = openerOf(src, toks, lv, t).k === '(';
    let depth = 0, s = t;
    for (let j = t - 1; j >= 0; j--) {
        const k = toks[j];
        if (lv[j] < L) break;
        if (lv[j] > L) { s = j; continue; }
        if (k.k === 'com') continue;
        if (k.k === 'p') {
            if (k.t === ')' || k.t === ']') depth++;
            else if (k.t === '(' || k.t === '[') { if (depth === 0) { if (k.t === '(') break; s = j + 1; continue; } depth--; }
            else if (depth === 0 && (STOP_BACK.has(k.t) || k.t === ':' || k.t === '?' || (inCall && k.t === ','))) break;
        } else if (k.k === 'id' && depth === 0 && ['return', 'case', 'const', 'let', 'var'].includes(src.slice(k.s, k.e))) break;
        s = j;
    }
    let e = t; depth = 0;
    for (let j = t + 1; j < toks.length; j++) {
        const k = toks[j];
        if (lv[j] < L) break;
        if (lv[j] > L) { e = j; continue; }
        if (k.k === 'com') continue;
        if (k.k === 'p') {
            if (k.t === '(' || k.t === '[') depth++;
            else if (k.t === ')' || k.t === ']') { if (depth === 0) break; depth--; }
            else if (depth === 0 && (k.t === ';' || STOP_BACK.has(k.t) || k.t === ':' || k.t === '?' || (inCall && k.t === ','))) break;
        }
        e = j;
    }
    return [s, e];
}
/** 在 [s, e] 内拼出字符串；focus 位置的 token 用 value 代替（消费处追踪时用），返回 { text, at, len } */
function buildExpr(src, toks, lv, s, e, focus, value, focusStart) {
    const L = lv[focus];
    const f0 = focusStart === undefined ? focus : focusStart;
    let out = '', at = -1, len = 0, ph = false;
    for (let j = s; j <= e; j++) {
        const k = toks[j];
        if (k.k === 'com') continue;
        if (j >= f0 && j < focus) continue;
        if (j === focus) { at = out.length; out += value; len = value.length; ph = false; continue; }
        if (lv[j] === L && (k.k === 'str' || k.k === 'tpl')) { out += decodeLiteral(src.slice(k.s, k.e), k.k); ph = false; continue; }
        if (lv[j] === L && k.k === 'p' && (k.t === '+' || k.t === ',' || k.t === '(' || k.t === ')' || k.t === '.')) continue;
        if (!ph) { out += '\u00A7'; ph = true; }
    }
    return { text: out, at, len };
}
function parseStack(prefix) {
    const stack = [];
    const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
    let m, lastEnd = 0;
    while ((m = re.exec(prefix))) {
        lastEnd = re.lastIndex;
        const tag = m[2].toLowerCase();
        if (m[1]) { for (let q = stack.length - 1; q >= 0; q--) if (stack[q].tag === tag) { stack.length = q; break; } continue; }
        if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
        const attrs = {};
        m[3].replace(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (_x, n, _v, a, b, c) => { attrs[n.toLowerCase()] = a ?? b ?? c ?? ''; return ''; });
        m[3].replace(/(?:^|\s)([\w:-]+)(?=\s|$)/g, (_x, n) => { if (!(n.toLowerCase() in attrs)) attrs[n.toLowerCase()] = ''; return ''; });
        const classStr = attrs.class || '';
        stack.push({ tag, attrs, classStr, classes: classStr.split(/\s+/).filter(Boolean) });
    }
    const tail = prefix.slice(lastEnd);
    const lt = tail.search(/<[a-zA-Z/][^>]*$/);
    let inTag = null;
    if (lt >= 0) {
        const part = tail.slice(lt);
        const am = /([\w:-]+)\s*=\s*["']?[^"'=]*$/.exec(part);
        inTag = { tag: (/^<\/?([a-zA-Z][\w-]*)/.exec(part) || [, ''])[1].toLowerCase(), attr: am ? am[1].toLowerCase() : '?' };
    }
    const lastGt = prefix.lastIndexOf('>');
    return { stack, inTag, textPrefix: lastGt >= 0 ? prefix.slice(lastGt + 1) : prefix, hadTag: lastGt >= 0 };
}
const NUMISH = '[\\d\u00A7][\\d\u00A7.,\u4E07\u5343\u4EBF+kKwW]*';
const COUNTER_RE = new RegExp('^(?:(?:' + CLUSTER_SRC + ')+\\s*' + NUMISH + '\\s*)+$', 'u');
const ONLY_RE = new RegExp('^(?:' + CLUSTER_SRC + ')+$', 'u');
const RANK = ['GAP_EMBED', 'GAP_NONCHROME', 'UNKNOWN', 'TEXT_SINK', 'TOAST', 'NO_CONTAINER', 'LIMIT_NATIVE', 'V36_SITE', 'V36_COUNTER', 'V36_ATTR', 'V33_LEAD', 'V33_ONLY', 'KEEP_CONTENT_AREA', 'KEEP_TYPO', 'KEEP_HTML_COMMENT', 'KEEP_TEXT_OUT', 'KEEP_ATTR_DATA', 'KEEP_OPTION_MID', 'KEEP_FUNCTIONAL', 'KEEP_MAPPED', 'KEEP_CONSOLE', 'KEEP_UNUSED'];
/** 值里每一个字符图标各判一次落点，取最差的一个（一个字面量里可能有好几个图标，落点不同） */
function landAll(J, ex, appId) {
    const value = ex.text.slice(ex.at, ex.at + ex.len);
    const re = reCluster(); let m; const res = [];
    while ((m = re.exec(value))) {
        if (!clustersOf(m[0]).length) continue;
        res.push(landing(J, { text: ex.text, at: ex.at + m.index, len: m[0].length }, appId));
    }
    if (!res.length) return { land: 'KEEP_UNUSED' };
    res.sort((a, b) => RANK.indexOf(a.land) - RANK.indexOf(b.land));
    return res[0];
}
/** 落点判定（与运行时 bridgeText 同序：站点 -> 计数 -> 只有图标 -> 外壳开头） */
function landing(J, expr, appId) {
    const prefix = expr.text.slice(0, expr.at);
    const rest = expr.text.slice(expr.at + expr.len);
    const value = expr.text.slice(expr.at, expr.at + expr.len);
    const cm = prefix.lastIndexOf('<!--');
    if (cm >= 0 && prefix.indexOf('-->', cm) < 0) return { land: 'KEEP_HTML_COMMENT', where: '<!-- -->' };
    if (/<style[\s>][^]*$/i.test(prefix) && !/<\/style>/i.test(prefix.slice(prefix.search(/<style[\s>][^]*$/i)))) return { land: 'KEEP_HTML_COMMENT', where: '<style>' };
    const P = parseStack(prefix);
    const elDesc = P.stack.slice(-3).map((x) => x.tag + (x.classes.length ? '.' + x.classes.join('.') : '')).join(' > ');
    if (P.inTag) {
        const a = P.inTag.attr;
        if (['title', 'aria-label', 'placeholder', 'alt'].includes(a)) return { land: 'V36_ATTR', where: '<' + P.inTag.tag + ' ' + a + '>' };
        return { land: 'KEEP_ATTR_DATA', where: '<' + P.inTag.tag + ' ' + a + '>' };
    }
    const lt = rest.indexOf('<');
    const textSuffix = lt >= 0 ? rest.slice(0, lt) : rest;
    const text = (P.textPrefix + value + textSuffix).replace(/\u00A0/g, ' ');
    const trimmed = text.trim();
    const inner = P.stack[P.stack.length - 1];
    if (inner && inner.tag === 'option') return /^\s*$/.test(P.textPrefix) ? { land: 'V36_ATTR', where: '<option>' } : { land: 'KEEP_OPTION_MID', where: '<option>' };
    /* 与运行时同序：硬内容区（输入 / 代码 / 可编辑 / 显式保留）-> 站点表（逐条核对过，优先于 CONTENT_DENY 的宽匹配，
       例如 [class*="-cell"] 会把查手机的视频格 .pk-dy-cell 误当棋盘格）-> CONTENT_DENY */
    if (P.stack.some((el) => HARD_TAGS.has(el.tag) || 'contenteditable' in el.attrs || 'data-rp33-keep-glyph' in el.attrs)) return { land: 'KEEP_CONTENT_AREA', where: elDesc };
    /* 排版箭头夹在两段文字之间（「导出范围 -> 包体身份」「§ -> §」）：是标点，不是图标 */
    const c0 = cp(value);
    if (TYPO_ARROWS.has(c0) && /\S\s*$/.test(P.textPrefix) && /^\s*\S/.test(textSuffix)) return { land: 'KEEP_TYPO', where: elDesc };
    const isLead = /^\s*$/.test(P.textPrefix.replace(reCluster(), ''));
    const denied = P.stack.some((el) => J.denyCompounds.some((o) => matchCompound(el, o)));
    const site = P.hadTag && J.sites.find((st) => (!denied || st.overrideDeny) && (st.mode === 'all' || isLead) && (!st.cps || st.cps.includes(c0)) && closestMatch(P.stack, st.sel));
    if (site) return { land: 'V36_SITE', where: elDesc, site: site.id };
    if (denied) return { land: 'KEEP_CONTENT_AREA', where: elDesc };
    if (!P.hadTag) return { land: 'NO_CONTAINER', where: '', text: trimmed };
    if (COUNTER_RE.test(trimmed)) return { land: 'V36_COUNTER', where: elDesc };
    if (ONLY_RE.test(trimmed)) return { land: 'V33_ONLY', where: elDesc };
    const lead = isLead;
    const chrome = P.stack.some((el) => J.chromeCompounds.some((o) => matchCompound(el, o)));
    if (lead && chrome) {
        const after = clustersOf(trimmed.replace(new RegExp('^(?:(?:' + CLUSTER_SRC + ')\\s*)+', 'u'), ''));
        return after.length ? { land: 'GAP_EMBED', where: elDesc, text: trimmed } : { land: 'V33_LEAD', where: elDesc };
    }
    if (lead) return { land: 'GAP_NONCHROME', where: elDesc, text: trimmed };
    return { land: 'GAP_EMBED', where: elDesc, text: trimmed };
}

/** 向前找本层没有闭合的括号：返回 { k: '(' | '[' | '{', j } */
const ESCAPERS = /^(?:_?esc\w*|escapeHtml|escapeAttr|_escapeHtml|_escape|escHtml|String|safe|_safe|h)$/;
/** 焦点在 esc(...) / String(...) 这类透明包装的参数里时，把整个调用当焦点（落点看调用在哪里） */
function unwrapCall(src, toks, lv, f, t) {
    for (let guard = 0; guard < 3; guard++) {
        const op = openerOf(src, toks, lv, f);
        const callee = calleeOf(src, toks, op);
        if (!(op.k === '(' && ESCAPERS.test(callee))) break;
        let d = 0, close = -1;
        for (let j = op.j; j < toks.length; j++) { if (toks[j].k !== 'p') continue; if (toks[j].t === '(') d++; else if (toks[j].t === ')') { d--; if (d === 0) { close = j; break; } } }
        if (close < 0) break;
        let c0 = op.j - 1; if (toks[c0] && toks[c0].t === '?.') c0--;
        while (c0 >= 2 && toks[c0 - 1].k === 'p' && (toks[c0 - 1].t === '.' || toks[c0 - 1].t === '?.') && toks[c0 - 2].k === 'id') c0 -= 2;
        f = c0; t = close;
    }
    return [f, t];
}
function calleeOf(src, toks, op) {
    if (op.k !== '(') return '';
    let q = op.j - 1;
    if (toks[q] && toks[q].k === 'p' && toks[q].t === '?.') q--;
    return toks[q] && toks[q].k === 'id' ? src.slice(toks[q].s, toks[q].e) : '';
}
function argIndex(toks, lv, open, t) {
    let d = 0, n = 0;
    for (let j = open + 1; j < t; j++) {
        const k = toks[j];
        if (lv[j] !== lv[t] || k.k !== 'p') continue;
        if (k.t === '(' || k.t === '[' || k.t === '{') d++;
        else if (k.t === ')' || k.t === ']' || k.t === '}') d--;
        else if (k.t === ',' && d === 0) n++;
    }
    return n;
}
/** 已知去向的辅助函数：参数下标 -> 落点（按 phone/phone-shell.js、config/phone-feedback.js、apps/wechat/wechat-app.js 的实现写死；
 *  上游改了这些函数时 loadJudges 的锚点校验会报 anchor-miss） */
const EL = (tag, cls) => ({ tag, attrs: { class: cls }, classStr: cls, classes: cls.split(/\s+/).filter(Boolean) });
function landIn(J, stack, value, app) {
    const ex = { text: stack.map((el) => '<' + el.tag + ' class="' + el.classStr + '">').join('') + value, at: 0, len: value.length };
    ex.at = ex.text.length - value.length;
    return landAll(J, ex, app);
}
const CALL_SINKS = {
    showNotification: {
        0: (J, S, app) => Object.assign(landIn(J, [EL('div', 'phone-notification'), EL('div', 'notification-title')], S.value, app), { why: '通知标题（phone-shell textContent）' }),
        1: (J, S, app) => Object.assign(landIn(J, [EL('div', 'phone-notification'), EL('div', 'notification-message')], S.value, app), { why: '通知正文（phone-shell textContent）' }),
        2: () => ({ land: 'KEEP_MAPPED', why: 'showNotification 的图标参数：phone-shell 用 iconMap 把它换成 Font Awesome 类名（认不出的一律 fa-bell），emoji 本身不进 DOM' }),
    },
    renderAvatar: { 1: () => ({ land: 'KEEP_FUNCTIONAL', why: 'renderAvatar 的 defaultEmoji 只用来判断「群 / 个人」（=== 比较），不显示' }) },
    phoneNotice: { 0: (J, S, app) => Object.assign(landIn(J, [EL('div', 'rp-feedback-notice')], S.value, app), { why: '底部提示条（config/phone-feedback.js textContent）' }) },
    phoneAlert: { 0: () => ({ land: 'LIMIT_NATIVE', why: '宿主浏览器原生 alert，不在 #phone-panel 里，放不了 SVG' }) },
    phoneConfirm: { 0: () => ({ land: 'LIMIT_NATIVE', why: '宿主浏览器原生 confirm，不在 #phone-panel 里，放不了 SVG' }) },
    phonePrompt: { 0: () => ({ land: 'LIMIT_NATIVE', why: '宿主浏览器原生 prompt，不在 #phone-panel 里，放不了 SVG' }) },
    confirm: { 0: () => ({ land: 'LIMIT_NATIVE', why: '原生 confirm，放不了 SVG' }) },
    alert: { 0: () => ({ land: 'LIMIT_NATIVE', why: '原生 alert，放不了 SVG' }) },
};
function openerOf(src, toks, lv, t) {
    let d = 0;
    for (let j = t - 1; j >= 0; j--) {
        const k = toks[j];
        if (lv[j] !== lv[t] || k.k !== 'p') continue;
        if (k.t === ')' || k.t === ']' || k.t === '}') d++;
        else if (k.t === '(' || k.t === '[' || k.t === '{') { if (d === 0) return { k: k.t, j }; d--; }
    }
    return { k: '', j: -1 };
}
function bindingBefore(src, toks, j) {
    const eq = toks[j - 1], id = toks[j - 2], kw = toks[j - 3];
    if (eq && eq.k === 'p' && eq.t === '=' && id && id.k === 'id' && kw && kw.k === 'id' && ['const', 'let', 'var'].includes(src.slice(kw.s, kw.e))) return src.slice(id.s, id.e);
    if (eq && eq.k === 'p' && eq.t === ':' && id && id.k === 'id') return '.' + src.slice(id.s, id.e);
    if (eq && eq.k === 'p' && eq.t === ':' && id && id.k === 'str') return '.' + src.slice(id.s + 1, id.e - 1);
    return null;
}
/* ---------------- 采集 ---------------- */
const TEXT_SINK = /\.(?:textContent|innerText|title|placeholder|value)\s*=\s*$/;
const FUNCTIONAL = /\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|replace|replaceAll|split|test|match|has|delete)\(\s*$|(?:===|!==|==|!=)\s*$/;
const CONSOLE = /console\.(?:log|warn|error|info|debug)\s*\($/;
const TOAST = /(?:toast|Toast|notify|alert|confirm|prompt)\w*\s*\($/;
function statementHead(src, toks, lv, t) {
    const [s] = exprRange(src, toks, lv, t);
    let j = s - 1; while (j >= 0 && toks[j].k === 'com') j--;
    const prev = j >= 0 ? toks[j] : null;
    const before = src.slice(Math.max(0, (prev ? prev.s : 0) - 80), prev ? prev.e : 0);
    let bind = null, key = null;
    if (prev && prev.k === 'p' && prev.t === '=') {
        const id = toks[j - 1];
        const kw = toks[j - 2];
        if (id && id.k === 'id' && kw && kw.k === 'id' && ['const', 'let', 'var'].includes(src.slice(kw.s, kw.e))) bind = src.slice(id.s, id.e);
    }
    if (prev && prev.k === 'p' && prev.t === ':') {
        const id = toks[j - 1];
        if (id && (id.k === 'id' || id.k === 'str')) key = id.k === 'str' ? src.slice(id.s + 1, id.e - 1) : src.slice(id.s, id.e);
        else if (id && id.k === 'p' && id.t === ']') {   // [FACES.ok]: ... 计算键：取方括号前的对象（落点按其值的属性名追）
            key = null;
        }
    }
    return { prev, before, bind, key };
}
function enclosingFn(src, pos) {
    const head = src.slice(Math.max(0, pos - 3000), pos);
    const m = [...head.matchAll(/(?:function\s+([\w$]+)|([\w$]+)\s*\([^()]*\)\s*\{|([\w$]+)\s*[:=]\s*(?:async\s*)?(?:function|\([^()]*\)\s*=>))/g)].pop();
    return m ? (m[1] || m[2] || m[3] || '') : '';
}
const PROMPT_FN = /prompt|Prompt|inject|Inject|system|toAi|forAi|ForAI|forModel|context|Context|digest|Digest|narrat|report|Report|summar|Summar|describe|brief|Brief|story|Story|export|Export|toText|asText|markdown|Markdown/;
function collect(root, opts = {}) {
    const J = loadJudges(opts.uiRoot || root);
    J.denyCompounds = J.deny.map(parseCompound);
    J.chromeCompounds = J.chrome.map(parseCompound);
    const appsDir = path.join(root, 'apps');
    const apps = fs.readdirSync(appsDir).filter((d) => fs.statSync(path.join(appsDir, d)).isDirectory()).filter((d) => !opts.apps || opts.apps.includes(d)).sort();
    const sites = [];
    for (const app of apps) {
        const files = [];
        (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) files.push(p); } })(path.join(appsDir, app));
        const parsed = files.sort().map((p) => { const src = fs.readFileSync(p, 'utf8'); const toks = lex(src); return { p, rel: path.relative(root, p).split(path.sep).join('/'), src, toks, lv: tplLevels(toks) }; });
        for (const F of parsed) {
            const { src, toks, lv } = F;
            const lineOf = (pos) => src.slice(0, pos).split('\n').length;
            const push = (t, value, how, extra = {}) => {
                const cls = clustersOf(value);
                if (!cls.length) return;
                sites.push(Object.assign({ app, file: F.rel, line: lineOf(toks[t].s), tok: t, how, clusters: cls, value, F }, extra));
            };
            for (let t = 0; t < toks.length; t++) {
                const k = toks[t];
                if (k.k !== 'str' && k.k !== 'tpl') continue;
                const raw = src.slice(k.s, k.e);
                const val = decodeLiteral(raw, k.k);
                if (!hasGlyph(val)) continue;
                const escaped = clustersOf(raw).length < clustersOf(val).length;
                const nb = toks[t - 1], na = toks[t + 1];
                const concat = (k.k === 'tpl' && (raw.endsWith('${') || raw.startsWith('}'))) || (nb && nb.k === 'p' && nb.t === '+') || (na && na.k === 'p' && na.t === '+');
                const opn = (nb && nb.k === 'p' && (nb.t === ':' || nb.t === ',' || nb.t === '[')) ? openerOf(src, toks, lv, t).k : '';
                const mapv = !concat && ((nb && nb.t === ':' && opn === '{') || opn === '[');
                push(t, val, escaped ? 'escape' : concat ? 'concat' : mapv ? 'map' : 'static', { escaped, concat, mapv });
            }
            /* String.fromCharCode / fromCodePoint 常量参数（代理对相加也认） */
            for (let t = 0; t + 3 < toks.length; t++) {
                if (!(toks[t].k === 'id' && src.slice(toks[t].s, toks[t].e) === 'String' && toks[t + 2] && /^from(?:CharCode|CodePoint)$/.test(src.slice(toks[t + 2].s, toks[t + 2].e)))) continue;
                if (toks[t - 2] && toks[t - 1].t === '+' && toks[t - 2].k === 'p' && toks[t - 2].t === ')') continue;   // 第二半由第一半一并处理
                let j = t, val = '', ok = true;
                for (;;) {
                    const fn = src.slice(toks[j + 2].s, toks[j + 2].e);
                    const close = src.indexOf(')', toks[j + 3].s);
                    const args = src.slice(toks[j + 3].e, close).split(',').map((x) => x.trim());
                    if (!args.every((a) => /^(?:0x[0-9a-fA-F]+|\d+)$/.test(a))) { ok = false; break; }
                    const nums = args.map(Number);
                    val += fn === 'fromCodePoint' ? String.fromCodePoint(...nums) : String.fromCharCode(...nums);
                    let q = j + 3; while (q < toks.length && toks[q].s < close) q++;
                    if (toks[q + 1] && toks[q + 1].t === '+' && toks[q + 2] && src.slice(toks[q + 2].s, toks[q + 2].e) === 'String') { j = q + 2; continue; }
                    break;
                }
                if (ok) push(t, val, 'fcp', { escaped: true });
            }
        }
        /* 落点：容器内的直接判；没有容器的按去向 / 绑定 / 键追消费处 */
        const appSites = sites.filter((x) => x.app === app);
        for (const S of appSites) {
            const { src, toks, lv } = S.F;
            const [s, e] = exprRange(src, toks, lv, S.tok);
            const ex = buildExpr(src, toks, lv, s, S.how === 'fcp' ? S.tok : e, S.tok, S.value);
            if (S.how === 'fcp') { ex.text = ex.text.slice(0, ex.at + ex.len); }
            let L = landAll(J, ex, app);
            const H = statementHead(src, toks, lv, S.tok);
            S.fn = enclosingFn(src, toks[S.tok].s);
            if (L.land === 'NO_CONTAINER') {
                const before = src.slice(Math.max(0, toks[s].s - 120), toks[s].s).replace(/\s+$/, '');
                const after = src.slice(toks[e].e, toks[e].e + 16);
                const op = openerOf(src, toks, lv, s);
                const callee = calleeOf(src, toks, op);
                const argIx = op.k === '(' ? argIndex(toks, lv, op.j, s) : -1;
                const CS = CALL_SINKS[callee];
                if (CS && CS[argIx]) L = CS[argIx](J, S, app);
                else if (CONSOLE.test(before) || /^(?:log|warn|error|info|debug)$/.test(callee) && /console\.\w+\($/.test(src.slice(0, toks[op.j].e))) L = { land: 'KEEP_CONSOLE' };
                else if (FUNCTIONAL.test(before) || /^\s*(?:===|!==|==|!=)/.test(after) || /^(?:includes|startsWith|endsWith|indexOf|lastIndexOf|replace|replaceAll|split|test|match|has)$/.test(callee)) L = { land: 'KEEP_FUNCTIONAL' };
                else if (TOAST.test(before) || /(?:toast|Toast|notify|alert|confirm)\w*$/.test(callee)) L = { land: 'TOAST', why: '经 ' + (callee || 'toast') + '() 显示' };
                else if (TEXT_SINK.test(before)) L = { land: 'TEXT_SINK', where: before.slice(-40) };
                else {
                    let H2 = { bind: H.bind, key: H.key };
                    if (!H2.bind && !H2.key && op.k === '[') { const b = bindingBefore(src, toks, op.j); if (b && b[0] === '.') H2.key = b.slice(1); else if (b) H2.bind = b; }
                    if (!H2.bind && !H2.key && op.k === '{' && H.key) H2.key = H.key;
                    if (op.k === '{' && !H2.bind) { const b = bindingBefore(src, toks, op.j); if (b && b[0] !== '.') H2.bind = b; }
                    if (H2.bind || H2.key) L = consumers(J, app, parsed, S, H2);
                    else if (PROMPT_FN.test(S.fn) || /\n/.test(S.value)) L = { land: 'KEEP_TEXT_OUT', why: '函数 ' + (S.fn || '?') + ' 产出的是文本 / 报告 / 提示词，不进 DOM 外壳' };
                    else L = { land: 'UNKNOWN', why: callee ? '作为参数传给 ' + callee + '()' : (S.fn ? '在 ' + S.fn + '() 里' : '') };
                }
                if (L.land === 'UNKNOWN' && PROMPT_FN.test(S.fn)) L = { land: 'KEEP_TEXT_OUT', why: '函数 ' + S.fn + ' 产出的是文本 / 报告 / 提示词' };
            }
            Object.assign(S, { landing: L.land, where: L.where || '', site: L.site || '', note: L.why || L.text || '' , via: L.via || '' });
        }
    }
    return { J, sites };
}
/** 绑定 / 键的消费处：同 App 里所有 `NAME` 标识符与 `.key` 成员访问，逐个当作「值就在这里」重新判落点 */
function consumers(J, app, parsed, S, H) {
    const lands = [];
    const name = H.bind; const key = H.key || (S.how === 'map' ? null : null);
    for (const F of parsed) {
        const { src, toks, lv } = F;
        for (let t = 0; t < toks.length; t++) {
            const k = toks[t];
            if (k.k !== 'id') continue;
            const w = src.slice(k.s, k.e);
            let hit = false;
            if (name && w === name && F === S.F && t !== S.tok - 2 && !(toks[t + 1] && toks[t + 1].t === '=' && toks[t - 1] && toks[t - 1].k === 'id')) hit = true;
            if (key && w === key && toks[t - 1] && toks[t - 1].k === 'p' && (toks[t - 1].t === '.' || toks[t - 1].t === '?.')) hit = true;
            if (!hit) continue;
            /* 成员链：把 a.b.key 的起点当焦点 */
            let f = t; while (f >= 2 && toks[f - 1].k === 'p' && (toks[f - 1].t === '.' || toks[f - 1].t === '?.') && (toks[f - 2].k === 'id' || toks[f - 2].t === ')' || toks[f - 2].t === ']')) f -= 2;
            const [fu, tu] = unwrapCall(src, toks, lv, f, t);
            f = fu;
            const [s, e] = exprRange(src, toks, lv, fu);
            const ex = buildExpr(src, toks, lv, Math.min(s, fu), Math.max(e, tu), tu, S.value, fu);
            const before = src.slice(Math.max(0, toks[Math.min(s, f)].s - 120), toks[Math.min(s, f)].s).replace(/\s+$/, '');
            let L = landAll(J, ex, app);
            const op = openerOf(src, toks, lv, Math.min(s, f));
            const callee = calleeOf(src, toks, op);
            const CS = CALL_SINKS[callee];
            const argIx = op.k === '(' ? argIndex(toks, lv, op.j, Math.min(s, f)) : -1;
            if (L.land === 'NO_CONTAINER' && CS && CS[argIx]) L = CS[argIx](J, S, app);
            if (L.land === 'NO_CONTAINER') {
                if (CONSOLE.test(before)) L = { land: 'KEEP_CONSOLE' };
                else if (FUNCTIONAL.test(before)) L = { land: 'KEEP_FUNCTIONAL' };
                else if (TOAST.test(before)) L = { land: 'TOAST' };
                else if (TEXT_SINK.test(before)) L = { land: 'TEXT_SINK', where: before.slice(-40) };
                else if (PROMPT_FN.test(enclosingFn(src, k.s))) L = { land: 'KEEP_TEXT_OUT', why: '消费处 ' + enclosingFn(src, k.s) + ' 产出文本 / 报告' };
                else L = { land: 'UNKNOWN' };
            }
            lands.push(Object.assign(L, { at: F.rel + ':' + src.slice(0, k.s).split('\n').length }));
        }
    }
    if (!lands.length) return { land: 'KEEP_UNUSED', why: '同 App 里找不到消费处（' + (name || key || '?') + '）' };
    lands.sort((a, b) => RANK.indexOf(a.land) - RANK.indexOf(b.land));
    const worst = lands[0];
    const kinds = [...new Set(lands.map((x) => x.land))];
    return { land: worst.land, where: worst.where || '', site: worst.site || '', via: (name ? name : '.' + key) + ' -> ' + lands.length + ' 处（' + kinds.join('/') + '），最差：' + worst.at, why: worst.why || '' };
}
// </core>

/* ---------------- 判定：落点 -> 处置 + 理由（GAP 之外每一类都有理由；个案理由在 OVERRIDES） ---------------- */
const DECIDE = {
    V33_ONLY: ['replace', 'v3.3 字符图标桥：文本节点里只有图标，换 SVG（原字符留在视觉隐藏 span）'],
    V33_LEAD: ['replace', 'v3.3 字符图标桥：外壳元素开头的图标，换 SVG'],
    V36_COUNTER: ['replace', 'v3.6 计数规则：「图标 + 数字」串里每个图标都换（v3.3 只换第一个）'],
    V36_SITE: ['replace', 'v3.6 站点规则：该元素里所有字符图标都换'],
    V36_ATTR: ['replace', 'v3.6 属性规则：title / aria-label / placeholder / alt / <option> 开头的图标去掉（属性里放不了 SVG；原值存档、detach 还原）'],
    KEEP_CONTENT_AREA: ['keep', '落在内容区（聊天 / 朋友圈正文、表情面板、输入框、棋盘格等，与运行时 CONTENT_DENY 同一份清单）：是用户 / 剧情内容'],
    KEEP_TEXT_OUT: ['keep', '产出的是文本（发给模型的提示词 / 导出报告 / 日报正文），不是界面外壳；改了会改变模型输入或用户导出的内容'],
    KEEP_CONSOLE: ['keep', '控制台日志，不进界面'],
    KEEP_FUNCTIONAL: ['keep', '功能性字面量（比较 / 查找 / 替换的操作数），改了会断开与生产方的匹配'],
    KEEP_ATTR_DATA: ['keep', '数据属性 / value 里的值（程序读取用），不是给人看的'],
    KEEP_OPTION_MID: ['keep', '<option> 中间的符号（文字的一部分）'],
    KEEP_UNUSED: ['keep', '定义了但同 App 里没有消费处'],
    KEEP_MAPPED: ['keep', '只当查表键用，渲染前已换成别的图标'],
    KEEP_HTML_COMMENT: ['keep', 'HTML 注释 / <style> 里的字符，不渲染'],
    KEEP_TYPO: ['keep', '排版箭头夹在两段文字中间（流程连接号 / 「旧值 -> 新值」），是标点不是图标；换成 SVG 会打断句子，读屏也会改读'],
    LIMIT_NATIVE: ['limit', '浏览器原生对话框里的界面文字：在 #phone-panel 之外、也放不了 SVG，运行时桥管不到（已知限制，未处理）'],
};
const OVERRIDES = [
    /* [文件, 行号所在行的锚点子串, 处置, 理由] —— 自动判定不对、或需要个案说明的条目 */
    ['apps/wechat/chat-view.js', "name: 'SYSTEM (", 'keep', '发给模型的 messages 条目的 name 字段（提示词），不进界面；自动判定按通用键 .name 追到了通知，是误报'],
    ['apps/wechat/wechat-app.js', 'style.textContent = `', 'keep', '<style> 文本（CSS 注释里的字符），不渲染'],
    ['apps/wechat/wechat-app.js', '\u529F\u80FD\u63D0\u793A\u8BCD\n', 'limit', '微信设置页的分组标题 / 警告行（功能提示词、表情包 API 密钥、头像管理器、会话样式、清空数据）：内联样式、无类名，找不到不误伤用户内容的稳定选择器，未处理（需要上游给标题加类名）'],
    ['apps/wechat/wechat-app.js', '\u7FA4\u8BED\u97F3\u901A\u8BDD</span>', 'replace', '运行时由站点 wx-prompt-sub 换（开头两个图标作为一组换成一个 people 图标）'],
    ['apps/wechat/wechat-app.js', '\u7FA4\u89C6\u9891\u901A\u8BDD</span>', 'replace', '同上'],
    ['apps/wechat/wechat-app.js', '\u8868\u60C5\u5305 API', 'limit', '微信设置页的分组标题 / 警告行（功能提示词、表情包 API 密钥、头像管理器、会话样式、清空数据）：内联样式、无类名，找不到不误伤用户内容的稳定选择器，未处理（需要上游给标题加类名）'],
    ['apps/wechat/wechat-app.js', '\u5934\u50CF\u7BA1\u7406\u5668', 'limit', '微信设置页的分组标题 / 警告行（功能提示词、表情包 API 密钥、头像管理器、会话样式、清空数据）：内联样式、无类名，找不到不误伤用户内容的稳定选择器，未处理（需要上游给标题加类名）'],
    ['apps/wechat/wechat-app.js', '\u4F1A\u8BDD\u6837\u5F0F', 'limit', '微信设置页的分组标题 / 警告行（功能提示词、表情包 API 密钥、头像管理器、会话样式、清空数据）：内联样式、无类名，找不到不误伤用户内容的稳定选择器，未处理（需要上游给标题加类名）'],
    ['apps/wechat/wechat-app.js', '\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D', 'limit', '微信设置页的分组标题 / 警告行（功能提示词、表情包 API 密钥、头像管理器、会话样式、清空数据）：内联样式、无类名，找不到不误伤用户内容的稳定选择器，未处理（需要上游给标题加类名）'],
    ['apps/wechat/chat-view.js', '\u77ED\u6309\u8BBE\u4E3A\u5F53\u524D\u804A\u5929', 'limit', '微信聊天背景设置页的提示行：内联样式、无类名，未处理'],
    ['apps/wechat/contacts-view.js', '\u4E2A\u4EBA\u5F62\u8C61\u53C2\u8003\u56FE', 'limit', '微信编辑联系人页的小标题：内联样式、无类名，未处理'],
    ['apps/peek/peek-data.js', 'subtitle:', 'replace', '运行时由站点 peek-item-meta 换：subtitle 渲染在 .pk-item-top > span（peek-view.js:61），并被 joinItems 拼进 .pk-section-head > p 的摘要；站点只换这 4 个计数码点'],
    ['apps/magazine/magazine-data.js', "text: '\u25C6 ' + b.", 'unverified', '通用键 .text 在本 App 有 47 处消费，自动追踪取到的「最差落点」是别的行（评论引号行），不是这两行真正的去向；行首菱形符号若落进 .mgz-cmt 会被站点 mgz-cmt 换，没有逐条确认'],
    ['apps/reading/reading-view.js', '\u7F3A\u6B63\u6587\uFF08', 'replace', '运行时由站点 rd-excerpt-tag 换：模拟只看得到 <span>（它先存进 tag 变量，再拼进 .rd-excerpt-text）'],
];
function decide(S) {
    const ov = OVERRIDES.filter((o) => S.file === o[0] && (S.lineText.includes(o[1]) || String(S.value).includes(o[1])));
    if (ov.length && (S.landing.startsWith('GAP') || S.landing === 'UNKNOWN')) return ov[0][2] === 'unverified' ? { decision: 'unverified', reason: ov[0][3], override: true } : { decision: ov[0][2], reason: ov[0][3], override: true };
    if (S.landing === 'UNKNOWN' || S.landing === 'TEXT_SINK' || S.landing === 'TOAST') return { decision: 'unverified', reason: '多跳数据流 / 动态容器，静态追不到落点（' + S.landing + (S.note ? '：' + S.note : '') + (S.via ? '；' + S.via : '') + '）。运行时 v3.3 / v3.6 规则照常生效，但这一条没有逐条确认' };
    const d = DECIDE[S.landing];
    if (d) return { decision: d[0], reason: d[1] + (S.note ? '；' + S.note : '') };
    return { decision: 'gap', reason: '外壳 / 去向不明，运行时认不出：' + S.landing + (S.note ? '（' + S.note + '）' : '') };
}

function testsAsserting(root, sites) {
    const out = [];
    const dir = path.join(root, 'tests');
    if (!fs.existsSync(dir)) return out;
    const vals = new Map();
    sites.forEach((S) => S.clusters.forEach((c) => { if (!vals.has(c)) vals.set(c, []); vals.get(c).push(S.file); }));
    (function walk(d) {
        for (const f of fs.readdirSync(d)) {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) { walk(p); continue; }
            if (!/\.(?:m?js|cjs)$/.test(f)) continue;
            const src = fs.readFileSync(p, 'utf8');
            src.split('\n').forEach((ln, i) => {
                const dec = decodeLiteral('\'' + ln.replace(/\\\\u/g, '\\u') + '\'', 'str');
                const cs = clustersOf(dec);
                if (!cs.length || /^\s*(?:\/\/|\*|\/\*)/.test(ln)) return;
                const files = [...new Set(cs.flatMap((c) => vals.get(c) || []))];
                const named = files.filter((fl) => src.includes(path.basename(fl)) || src.includes(fl.split('/')[1] + '/'));
                if (named.length) out.push({ test: path.relative(root, p).split(path.sep).join('/'), line: i + 1, clusters: cs.map(cpList), files: named });
            });
        }
    })(dir);
    return out;
}

function main(argv) {
    const args = Object.fromEntries(argv.map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
    const root = process.cwd();
    const { sites } = collect(root, { apps: args.app ? String(args.app).split(',') : null });
    sites.forEach((S) => { S.lineText = S.F.src.split('\n')[S.line - 1] || ''; Object.assign(S, decide(S)); });
    const by = (f) => sites.reduce((m, S) => { const k = f(S); m[k] = (m[k] || 0) + 1; return m; }, {});
    const runtimeBuilt = sites.filter((S) => S.how !== 'static');
    const summary = { total: sites.length, runtimeBuilt: runtimeBuilt.length, byHow: by((S) => S.how), byLanding: by((S) => S.landing), byDecision: by((S) => S.decision), gaps: sites.filter((S) => S.decision === 'gap').length };
    console.log(JSON.stringify(summary, null, 2));
    if (args.tsv) {
        const head = ['app', 'file', 'line', 'how', 'codepoints', 'landing', 'where', 'site', 'via', 'decision', 'reason'];
        const rows = sites.map((S) => [S.app, S.file, S.line, S.how, S.clusters.map(cpList).join(' | '), S.landing, S.where, S.site, S.via, S.decision, S.reason].map((x) => String(x).replace(/[\t\n]/g, ' ')).join('\t'));
        fs.writeFileSync(args.tsv, head.join('\t') + '\n' + rows.join('\n') + '\n');
    }
    if (args.json) fs.writeFileSync(args.json, JSON.stringify(sites.map(({ F, tok, value, ...r }) => r), null, 1));
    if (args.tests) testsAsserting(root, sites).forEach((t) => console.log(t.test + ':' + t.line + '  ' + t.clusters.join(' ') + '  <- ' + t.files.join(', ')));
    if (args.write) console.log('--write：本版站点表没有 patch 条目，不改任何源码（见文件头第 1 条）。');
    if (args.check && summary.gaps) { console.error('GAP ' + summary.gaps + ' 处（外壳里运行时认不出的字符图标），见 --tsv'); process.exitCode = 1; }
}
if (typeof process !== 'undefined' && process.argv && import.meta.url === 'file://' + process.argv[1]) main(process.argv.slice(2));
export { collect, decide, landing, parseStack, closestMatch, decodeLiteral, clustersOf, COUNTER_RE, main };
