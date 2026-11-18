/* 一次性生成：data/cheats.js（27611 行巨型数据文件）→ data/cheats/part-NN.js 分片 + 薄聚合器
 * R24-O9：数据/代码分离。分片只装**数据**（每包一行 JSON，无模板串转义风险），
 * 聚合器只留 import 与拼接（代码），物理行数 <1000。
 * 幂等：重复运行给出同样的分片与同样的顺序（id 稳定性铁律不许重排）。
 * 用法：node scripts/split-cheats-v24.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SRC = path.join(ROOT, 'data', 'cheats.js');
const OUT_DIR = path.join(ROOT, 'data', 'cheats');
const PACKS_PER_PART = 6; // 6 包 ≈ 800 行，稳在千行内

const src = fs.readFileSync(SRC, 'utf8');
if (!src.includes('export const cheatPacks = [')) {
    console.error('不是预期的 cheats.js 形态（找不到 export const cheatPacks = [），中止');
    process.exit(1);
}

const mod = await import(SRC + '?t=' + Date.now());
const packs = mod.cheatPacks;
if (!Array.isArray(packs) || packs.length === 0) {
    console.error('读不到 cheatPacks，中止');
    process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// 清掉旧分片（幂等：分片数可能变少）
for (const f of fs.readdirSync(OUT_DIR)) {
    if (/^part-\d+\.js$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));
}

const parts = [];
for (let i = 0; i < packs.length; i += PACKS_PER_PART) parts.push(packs.slice(i, i + PACKS_PER_PART));

const pad = (n) => String(n).padStart(2, '0');
parts.forEach((chunk, idx) => {
    const name = 'part-' + pad(idx + 1) + '.js';
    const lines = chunk.map((p) => JSON.stringify(p));
    const text = '/** R24-O9 数据分片（由 scripts/split-cheats-v24.mjs 生成，勿手改）。'
        + ' id 顺序即原文件顺序，禁止重排。 */\n'
        + 'export const packs = [\n' + lines.join(',\n') + '\n];\n';
    fs.writeFileSync(path.join(OUT_DIR, name), text);
    chunk.forEach(() => {});
});

const imports = parts.map((_, idx) => 'import { packs as p' + pad(idx + 1) + " } from './cheats/part-" + pad(idx + 1) + ".js';");
const concatArgs = parts.map((_, idx) => 'p' + pad(idx + 1)).join(', ');
const aggregator = `/* ========================================================
 * 万界武库 (Cheat Vault) — 数据聚合（R24-O9 数据/代码分离后只剩代码，v4.158.0）
 *
 * 【本文件现在只做三件事】列分片 import、按原顺序拼接、导出同一个 \`cheatPacks\`。
 *   正文本身在 data/cheats/part-NN.js（每包一行 JSON），本文件物理行数 <1000。
 *   【纪律】消费方一行代码都不用改：\`cheatPacks\` 的名字、类型、顺序与分离前逐项一致。
 *
 * 【id 稳定性铁律】分片顺序 = 原文件顺序，id 永不重排/删除；下线包只标记不下架。
 * 【同源】轻量索引仍是 data/cheat-index.js（抽卡侧只读元数据），两文件由测试锁定一致。
 * 【生成】scripts/split-cheats-v24.mjs（幂等，重跑给出同样结果）。
 * ======================================================== */
'use strict';
${imports.join('\n')}

export const cheatPacks = [].concat(${concatArgs});

export const CHEAT_PART_COUNT = ${parts.length};
export const CHEAT_PACK_COUNT = cheatPacks.length;

export default { cheatPacks, CHEAT_PART_COUNT, CHEAT_PACK_COUNT };
`;

fs.writeFileSync(SRC, aggregator);

const lines = fs.readFileSync(SRC, 'utf8').split('\n').length;
console.log('分片 ' + parts.length + ' 个，条目 ' + packs.length + '；聚合器 ' + lines + ' 行');

const back = await import(SRC + '?t=' + Date.now());
const okSame = JSON.stringify(back.cheatPacks) === JSON.stringify(packs);
console.log('往返一致：' + (okSame ? '是' : '否'));
if (!okSame || back.cheatPacks.length !== packs.length) process.exit(1);
if (lines >= 1000) { console.error('聚合器仍 ≥1000 行'); process.exit(1); }