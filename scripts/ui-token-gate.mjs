#!/usr/bin/env node
/* ============================================================
 * scripts/ui-token-gate.mjs — U1 样式债务棘轮门（只许减，不许增）
 * ------------------------------------------------------------
 * 存量太大（数千处），一次性清零不现实；本门按**文件**记基线，
 * 每个文件三项读数都不得高于基线：
 *   T1 裸写 slate 灰阶（不在 var() 回退里）—— 基线为 0，已全部收编，任何新增即红；
 *   T2 `!important` 个数；
 *   T3 裸数字 z-index 个数（`z-index: var(--rp-z-*)` 不计）。
 * 读数下降时用 --update 收紧基线（基线只会被写小，不会被写大）。
 * 新文件基线视为 0：新写的 CSS 必须从第一天起就干净。
 * 退出码：0 通过；1 有文件超基线；2 结构自证失败（判据或枚举面坏了，拒判）。
 * ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASELINE = 'scripts/ui-token-baseline.json';
const SLATE = /#(f8fafc|f1f5f9|e2e8f0|cbd5e1|94a3b8|64748b|475569|334155|1e293b|0f172a|020617)\b/gi;

export function measure(css) {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove var(...) fallbacks (nesting-aware) before counting bare slate.
    let bare = '', depth = 0;
    for (let i = 0; i < code.length; i++) {
        if (code.startsWith('var(', i)) { depth++; i += 3; continue; }
        if (depth && code[i] === '(') depth++;
        else if (depth && code[i] === ')') { depth--; continue; }
        if (!depth) bare += code[i];
    }
    // token definitions in :root are the single source and allowed
    bare = bare.replace(/--rp-slate-\d+\s*:\s*#[0-9a-f]{6}/gi, '');
    return {
        slate: (bare.match(SLATE) || []).length,
        important: (code.match(/!\s*important/gi) || []).length,
        zindex: (code.match(/z-index\s*:\s*-?\d+/gi) || []).length
    };
}

function listCss() {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.css'], { encoding: 'utf8' })
        .split('\n').filter(f => f && !f.startsWith('dist/') && !f.startsWith('node_modules/') && existsSync(f));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const update = process.argv.includes('--update');
    const init = process.argv.includes('--init');
    const files = listCss();
    // structure self-check: enumerable surface and detector must both be alive
    const probe = measure('.a{color:#94a3b8;z-index:3!important}.b{color:var(--x,#94a3b8)}');
    if (files.length < 50 || probe.slate !== 1 || probe.important !== 1 || probe.zindex !== 1) {
        console.error(`[ui-token-gate] 结构自证失败：files=${files.length} probe=${JSON.stringify(probe)}`);
        process.exit(2);
    }
    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const now = {};
    for (const f of files) now[f] = measure(readFileSync(f, 'utf8'));
    if (init) {
        writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(now).sort()), null, 1) + '\n');
        console.log(`[ui-token-gate] baseline initialised for ${files.length} files`);
        process.exit(0);
    }
    const fail = [];
    const next = {};
    for (const [f, m] of Object.entries(now)) {
        const b = base[f] || { slate: 0, important: 0, zindex: 0 };
        for (const k of ['slate', 'important', 'zindex']) if (m[k] > b[k]) fail.push(`${f}: ${k} ${b[k]} → ${m[k]}`);
        next[f] = { slate: Math.min(m.slate, b.slate), important: Math.min(m.important, b.important), zindex: Math.min(m.zindex, b.zindex) };
    }
    const sum = (o, k) => Object.values(o).reduce((s, x) => s + x[k], 0);
    console.log(`[ui-token-gate] files=${files.length} slate=${sum(now, 'slate')} important=${sum(now, 'important')} zindex=${sum(now, 'zindex')}`);
    if (fail.length) {
        console.error('[ui-token-gate] 以下文件超出基线（请改用 var(--rp-*) token / 去掉 !important / 用 --rp-z-* 档位）：');
        for (const l of fail) console.error('  - ' + l);
        process.exit(1);
    }
    if (update) {
        writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 1) + '\n');
        console.log('[ui-token-gate] baseline tightened');
    }
}