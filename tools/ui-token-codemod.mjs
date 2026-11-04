#!/usr/bin/env node
/* ============================================================
 * tools/ui-token-codemod.mjs — U1 灰阶 token 化（一次性、可重复执行、幂等）
 * ------------------------------------------------------------
 * 把 CSS 声明值里**裸写**的 slate 灰阶色替换为 `var(--rp-slate-N, #原色)`。
 *   · 只动声明值（`prop: value`），不碰选择器、注释、字符串、url(...)；
 *   · 保留原色值作 var 回退：phone.css 未加载时视觉也不变；
 *   · 已在 var(...) 回退里的色值不再包一层（幂等）；
 *   · :root 里 --rp-slate-* 的定义本身跳过（否则自引用）。
 * 用法：node tools/ui-token-codemod.mjs [--check]   (--check 只统计不写)
 * ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const SLATE = {
    f8fafc: 50, f1f5f9: 100, e2e8f0: 200, cbd5e1: 300, '94a3b8': 400,
    '64748b': 500, '475569': 600, '334155': 700, '1e293b': 800, '0f172a': 900, '020617': 950
};
const HEX = new RegExp(`#(${Object.keys(SLATE).join('|')})\\b`, 'gi');

/** Replace bare slate hexes inside one declaration value. */
function rewriteValue(value) {
    let out = '';
    let depthVar = 0;           // inside var( ... ) ⇒ leave as-is (already a fallback)
    let i = 0;
    while (i < value.length) {
        const rest = value.slice(i);
        if (/^var\(/i.test(rest)) { depthVar++; out += 'var('; i += 4; continue; }
        if (/^url\(/i.test(rest)) {          // copy url(...) verbatim
            const end = value.indexOf(')', i);
            const stop = end < 0 ? value.length : end + 1;
            out += value.slice(i, stop); i = stop; continue;
        }
        const ch = value[i];
        if (ch === '"' || ch === "'") {      // copy strings verbatim
            const end = value.indexOf(ch, i + 1);
            const stop = end < 0 ? value.length : end + 1;
            out += value.slice(i, stop); i = stop; continue;
        }
        if (ch === '(' && depthVar) { depthVar++; out += ch; i++; continue; }
        if (ch === ')' && depthVar) { depthVar--; out += ch; i++; continue; }
        if (ch === '#' && !depthVar) {
            HEX.lastIndex = 0;
            const m = /^#([0-9a-f]{6})\b/i.exec(rest);
            const step = m && SLATE[m[1].toLowerCase()];
            if (step !== undefined) {
                out += `var(--rp-slate-${step}, #${m[1].toLowerCase()})`;
                i += 7; continue;
            }
        }
        out += ch; i++;
    }
    return out;
}

/** Rewrite one stylesheet. Returns { text, count }. */
export function rewriteCss(css) {
    let count = 0;
    // Mask comments so we never touch them, then walk declarations.
    const parts = css.split(/(\/\*[\s\S]*?\*\/)/);
    const text = parts.map((part, idx) => {
        if (idx % 2 === 1) return part;                       // comment
        return part.replace(/(^|[{;\s])(--?[a-zA-Z][\w-]*|[a-zA-Z-]+)(\s*:\s*)([^;{}]*)/g,
            (all, lead, prop, colon, value) => {
                if (/^--rp-slate-\d+$/.test(prop)) return all;  // token definitions themselves
                if (!HEX.test(value)) { HEX.lastIndex = 0; return all; }
                HEX.lastIndex = 0;
                const next = rewriteValue(value);
                if (next !== value) count += (value.match(HEX) || []).length - (next.match(/#[0-9a-f]{6}\b(?![^()]*\)\s*$)/gi) ? 0 : 0);
                return lead + prop + colon + next;
            });
    }).join('');
    return { text, count: countWrapped(text) - countWrapped(css) };
}
const countWrapped = (s) => (s.match(/var\(--rp-slate-\d+, #/g) || []).length;

function listCss() {
    return execFileSync('git', ['ls-files', '*.css'], { encoding: 'utf8' })
        .split('\n').filter(f => f && !f.startsWith('dist/') && !f.startsWith('node_modules/'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const check = process.argv.includes('--check');
    let total = 0, files = 0;
    for (const f of listCss()) {
        const src = readFileSync(f, 'utf8');
        const { text, count } = rewriteCss(src);
        if (!count) continue;
        total += count; files++;
        if (!check) writeFileSync(f, text);
    }
    console.log(`[ui-token-codemod] ${check ? 'would rewrite' : 'rewrote'} ${total} slate hex in ${files} files`);
}