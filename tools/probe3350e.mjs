// tools/probe3350e.mjs — 实测负控制「破坏副本」的加载是否真生效
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = '/home/user/ruby-phone';
const rel = 'apps/pixiv/pixiv-data.js';
const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

const from = '        num: numOrNull(c.num) === null ? null : Math.max(1, Math.trunc(numOrNull(c.num))),';
const to = '        num: numOrNull(c.num) === null ? (index + 1) : Math.max(1, Math.trunc(numOrNull(c.num))),';

console.log('锚点命中 =', src.split(from).length - 1);
const damaged = src.split(from).join(to);
console.log('替换后变了吗 =', damaged !== src);

const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_probe_'));
const target = path.join(dir, path.dirname(rel), path.basename(rel));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, damaged);
fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
console.log('副本路径 =', target);

/* 看副本里的 import 行，确认依赖面是否都在副本树里 */
const imports = damaged.split('\n').filter((l) => /^\s*import\s/.test(l) || /from '.*'/.test(l) && l.includes('import'));
console.log('副本 import 行：');
for (const l of imports) console.log('   ', l.trim().slice(0, 120));

try {
    const mod = await import(pathToFileURL(target).href);
    console.log('加载成功');
    console.log('  normalizeChapter({num:"nope"},4).num =', JSON.stringify(mod.normalizeChapter({ num: 'nope', content: 'x' }, 4).num));
    console.log('  normalizeChapter({num:0},0).num    =', JSON.stringify(mod.normalizeChapter({ num: 0, content: 'x' }, 0).num));
    console.log('  模块 identity 与真模块同源？', mod.normalizeChapter === undefined ? '?' : '(比较见下)');
    const真 = await import(pathToFileURL(path.join(ROOT, rel)).href);
    console.log('  真模块 normalizeChapter({num:"nope"},4).num =', JSON.stringify(真.normalizeChapter({ num: 'nope', content: 'x' }, 4).num));
    console.log('  ★ 副本与真模块是两个模块对象？', mod !== 真);
    console.log('  ★ 副本 normalizeChapter 与真的同一个函数？', mod.normalizeChapter === 真.normalizeChapter);
} catch (e) {
    console.log('加载失败：', e.message);
}
fs.rmSync(dir, { recursive: true, force: true });