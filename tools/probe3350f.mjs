// tools/probe3350f.mjs — 复刻测试文件里的 NEG 循环，逐项打印「破坏副本」的真实行为
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

const ROOT = '/home/user/ruby-phone';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PX_APP = 'apps/pixiv/pixiv-app.js';
const PX_DATA = 'apps/pixiv/pixiv-data.js';
const PX_VIEW = 'apps/pixiv/pixiv-view.js';

const DAT = await import(pathToFileURL(path.join(ROOT, PX_DATA)).href);

const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

function writeDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    if (hits !== 1) { console.log('   !!! 锚点命中不是 1：', hits); }
    const damaged = src.split(from).join(to);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_f_'));
    const target = path.join(dir, path.dirname(rel), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return { target, src: damaged };
}

const DAMAGE = {
    d1: [PX_DATA,
        '        num: numOrNull(c.num) === null ? null : Math.max(1, Math.trunc(numOrNull(c.num))),',
        '        num: numOrNull(c.num) === null ? (index + 1) : Math.max(1, Math.trunc(numOrNull(c.num))),'],
    d2: [PX_DATA,
        '        hearts: chapters.some((c) => c.num !== null) ? maxCh',
        '        hearts: chapters.length ? maxCh'],
};

for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
    console.log('=== ' + key + ' ===');
    const { target, src } = writeDamagedCopy(rel, from, to);
    console.log('  target =', target);
    /* 抽查副本文件里那条锚点附近长什么样 */
    const hot = (from.split('\n')[0].trim().slice(0, 40));
    const line = src.split('\n').filter((l) => l.includes(hot.slice(0, 24)))[0];
    console.log('  副本里的新行 =', JSON.stringify(line));
    let mod;
    try {
        mod = await import(pathToFileURL(target).href);
    } catch (e) {
        console.log('  加载失败：', e.message);
        continue;
    }
    console.log('  mod 与真模块同一对象？', mod === DAT);
    console.log('  normalizeChapter({num:"nope"},4).num =', JSON.stringify(mod.normalizeChapter({ num: 'nope', content: 'x' }, 4).num));
    console.log('  normalizeChapter({num:0},0).num     =', JSON.stringify(mod.normalizeChapter({ num: 0, content: 'x' }, 0).num));
    const onlyBad = mod.normalizeNovel({ id: 'n', hearts: 500, chapters: [{ num: 'bad', content: 'a' }] });
    console.log('  只有坏号章 + hearts=500 → hearts =', onlyBad.hearts);
    console.log('  真模块同输入 → hearts =', DAT.normalizeNovel({ id: 'n', hearts: 500, chapters: [{ num: 'bad', content: 'a' }] }).hearts);
}

console.log('');
console.log('=== 真模块 dataProblems 逐条 ===');
{
    const mod = DAT;
    console.log('  bad-num-filled ?', mod.normalizeChapter({ num: 'nope', content: 'x' }, 4).num !== null);
    console.log('  zero-num-coerced ?', mod.normalizeChapter({ num: 0, content: 'x' }, 0).num !== 0, '(num=' + mod.normalizeChapter({ num: 0, content: 'x' }, 0).num + ')');
}