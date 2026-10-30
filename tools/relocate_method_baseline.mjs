#!/usr/bin/env node
/* 账本行号重定位：只改 line 字段，不动条目集合、不动 classInstantiated。
 *
 * 为什么需要它：`scripts/dead-method-baseline.json` 每条记的是 (rel, line, cls, name)。
 *   本版在主屏与洞察 App 里插了代码，同文件内**其后所有方法的行号整体后移** ——
 *   于是 `tests/system-v4940.test.mjs` 的 E1（拿账本行号回读真源码、断言那一行含方法名）
 *   一次性判红三处。这不是判据错，也不是缺陷，是账本陈旧：它记的是「当时的行号」。
 *
 * ★ 为什么不改成「E1 只按 (rel, cls, name) 找、不查行号」：
 *   那样会把这个坐标系的**校验能力**整块丢掉。账本行号是唯一能证明「账本没被
 *   别的东西整体替换过」的凭据；放弃它，账本与源码之间就只剩名字相等，
 *   重名方法会互相顶替而无人察觉。所以修法必须是**刷新行号**，不是放宽判据。
 *
 * 重定位口径：在 rel 文件里找「类体范围内的那一行声明」——
 *   逐行扫，命中 `名称(` 且该行位于 e.cls 的类体块内（用花括号配平粗判），
 *   且与旧行号距离最近的候选优先。找不到唯一候选即中止，不猜。
 */
import fs from 'node:fs';

const P = 'scripts/dead-method-baseline.json';
const WRITE = process.argv.includes('--write');

const doc = JSON.parse(fs.readFileSync(P, 'utf8'));
const cache = new Map();
const srcOf = (rel) => {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(rel, 'utf8'));
  return cache.get(rel);
};

/** 找 e.cls 这个类在文件里的类体行范围 [start, end]（1 基，含首尾）。 */
function classBodyRange(rel, cls) {
  const lines = srcOf(rel).split('\n');
  const head = new RegExp('class\\s+' + cls + '\\b');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (head.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  // 从类声明行起做花括号配平（跳过字符串与注释只是粗判；本仓类体都是常规写法）
  let depth = 0, seen = false;
  for (let i = start; i < lines.length; i += 1) {
    const s = lines[i].replace(/\/\/.*$/, '');
    for (const ch of s) {
      if (ch === '{') { depth += 1; seen = true; }
      else if (ch === '}') { depth -= 1; }
    }
    if (seen && depth === 0) return [start + 1, i + 1];
  }
  return null;
}

const moved = [];
const unresolved = [];
for (const e of doc.entries) {
  const lines = srcOf(e.rel).split('\n');
  const cur = lines[e.line - 1] || '';
  if (cur.includes(e.name)) continue;           // 行号仍然对，跳过

  const range = classBodyRange(e.rel, e.cls);
  if (!range) { unresolved.push(e.rel + ' ' + e.cls + '（找不到类体）'); continue; }
  const cand = [];
  for (let i = range[0] - 1; i < range[1]; i += 1) {
    // 声明形：行首缩进 + 名称 + ( ；排除调用形（前面有 . 或 =）
    if (new RegExp('^[ \\t]+' + e.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\s*\\(').test(lines[i])) {
      cand.push(i + 1);
    }
  }
  if (cand.length !== 1) {
    unresolved.push(e.rel + ':' + e.line + ' ' + e.cls + '.' + e.name + '（候选 ' + cand.length + ' 个：' + cand.join(',') + '）');
    continue;
  }
  moved.push({ rel: e.rel, cls: e.cls, name: e.name, from: e.line, to: cand[0] });
  e.line = cand[0];
}

console.log('条目 ' + doc.entries.length + ' · 需重定位且已定位 ' + moved.length + ' · 未能定位 ' + unresolved.length);
for (const m of moved) console.log('  ' + m.rel + ' ' + m.cls + '.' + m.name + ' ' + m.from + ' → ' + m.to);
if (unresolved.length) {
  console.error('❌ 有未能定位的条目，中止（不猜行号）：');
  for (const u of unresolved) console.error('  ' + u);
  process.exit(2);
}

if (!WRITE) { console.log('--- DRY RUN (pass --write) ---'); process.exit(0); }
doc.generated_at_note = '行号按 tools/relocate_method_baseline.mjs 重定位（v4.95.0：源码插入导致其后行号整体后移）';
fs.writeFileSync(P, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log('--- WRITTEN ---');
