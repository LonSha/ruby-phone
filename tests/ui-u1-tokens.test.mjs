// U1：灰阶 token codemod 的安全性 + 棘轮门判据（含破坏性对照）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewriteCss } from '../tools/ui-token-codemod.mjs';
import { measure } from '../scripts/ui-token-gate.mjs';

test('codemod rewrites only bare declaration values and keeps original as fallback', () => {
    const { text, count } = rewriteCss('.a{color:#94a3b8;border:1px solid #CBD5E1}');
    assert.equal(count, 2);
    assert.equal(text, '.a{color:var(--rp-slate-400, #94a3b8);border:1px solid var(--rp-slate-300, #cbd5e1)}');
});

test('codemod leaves comments, strings, url(), existing var() fallbacks, selectors and longer hexes alone', () => {
    for (const css of [
        '/* #94a3b8 */.x{}',
        '.c{background:url("data:image/svg+xml,<svg fill=\'#94a3b8\'/>")}',
        '.b{color:var(--x,#94a3b8)}',
        '.e{content:"#94a3b8"}',
        '.f{color:#94a3b88}',
        ':root{--rp-slate-400:#94a3b8}'
    ]) assert.equal(rewriteCss(css).count, 0, css);
});

test('codemod is idempotent', () => {
    const once = rewriteCss('.a{color:#64748b;box-shadow:0 0 1px #e2e8f0}').text;
    assert.equal(rewriteCss(once).count, 0);
});

test('every token used by the codemod is defined in phone.css :root with the identical value', () => {
    const root = readFileSync(new URL('../phone.css', import.meta.url), 'utf8').match(/:root\s*\{[\s\S]*?\n\}/)[0];
    const map = { 50: 'f8fafc', 100: 'f1f5f9', 200: 'e2e8f0', 300: 'cbd5e1', 400: '94a3b8', 500: '64748b', 600: '475569', 700: '334155', 800: '1e293b', 900: '0f172a', 950: '020617' };
    for (const [step, hex] of Object.entries(map)) assert.match(root, new RegExp(`--rp-slate-${step}:\\s*#${hex};`));
    for (const z of ['base', 'raised', 'dropdown', 'sheet', 'modal', 'toast', 'max']) assert.match(root, new RegExp(`--rp-z-${z}:\\s*\\d+;`));
});

test('gate measure: counts bare slate / !important / numeric z-index; ignores var fallbacks and token defs', () => {
    assert.deepEqual(measure('.a{color:#94a3b8;z-index:3!important}.b{color:var(--x,#94a3b8)}'), { slate: 1, important: 1, zindex: 1 });
    assert.deepEqual(measure(':root{--rp-slate-400:#94a3b8}.a{z-index:var(--rp-z-modal)}'), { slate: 0, important: 0, zindex: 0 });
    assert.equal(measure('/* #94a3b8 !important z-index:9 */').slate, 0);
});

test('broken-detector control: a measure that ignored var() depth would see the fallback (proves the gate is not vacuous)', () => {
    const naive = (css) => (css.match(/#94a3b8\b/g) || []).length;
    const css = '.b{color:var(--rp-slate-400, #94a3b8)}';
    assert.equal(naive(css), 1);
    assert.equal(measure(css).slate, 0);
});

test('baseline already has zero bare slate across the repo', () => {
    const base = JSON.parse(readFileSync(new URL('../scripts/ui-token-baseline.json', import.meta.url), 'utf8'));
    assert.ok(Object.keys(base).length >= 50);
    assert.equal(Object.values(base).reduce((s, x) => s + x.slate, 0), 0);
});