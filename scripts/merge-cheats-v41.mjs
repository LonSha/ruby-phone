#!/usr/bin/env node
/* 万界武库 V4.1 合并式更新：data/cheats.js + data/cheat-index.js
 *
 * 策略（用户指令：不砍原有）：
 *   1. 同名包 → 用 V4.1 内容覆盖，**id 原地保留**（存档 cheat_<packId> 安全）；
 *   2. V4.1 新增包 → 追加到尾部，id 从 max+1 顺延；
 *   3. V4 独有包 → 原样保留不动。
 * 用法：node scripts/merge-cheats-v41.mjs <V4.1.json>
 */
import fs from 'node:fs';

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node scripts/merge-cheats-v41.mjs <万界武库V4.1.json>'); process.exit(1); }

const FULL = '/home/user/ruby-phone/data/cheats.js';
const IDX = '/home/user/ruby-phone/data/cheat-index.js';

/* ---------- 1) 解析 V4.1 世界书 → 归并包（照 gen-cheats.mjs 归并规则） ---------- */
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const entries = raw.data.character_book.entries;
const cleanName = (n) => String(n || '').trim().replace(/[>》]+$/, '').trim();
const groups = new Map();
for (const e of entries) {
  const name = cleanName(e.comment);
  if (!name) continue;
  const base = name.split('\u00b7')[0].trim();
  if (!groups.has(base)) groups.set(base, new Map());
  const g = groups.get(base);
  const content = String(e.content || '');
  const prev = g.get(name);
  if (!prev || content.length > prev.length) g.set(name, content);
}
const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (chars) => BANDS.find(([t]) => chars >= t)[1];

function pick(text, tag) {
  if (!text) return '';
  const m = text.match(new RegExp('<' + tag + '>[^<]*'));
  if (!m) return '';
  return m[0].slice(tag.length + 2).trim();
}
function firstSentence(s, max) {
  if (!s) return '';
  const cut = s.split(/\n/)[0].trim();
  const seg = cut.split(/(?<=[。！？；])/)[0] || cut;
  const out = seg.replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max) + '…' : out;
}
function axisTag(head) {
  const rawAx = pick(head, '主收益轴') + ' ' + pick(head, '核心收益');
  const m = rawAx.match(/(个人与平台复合型|平台兼个人复合型|个人型|平台型)/);
  if (m) return m[1].includes('复合') ? '复合型' : m[1];
  if (/平台|店铺|商城|领地|据点|界域/.test(rawAx + head.slice(0, 400))) return '平台型';
  if (/个人/.test(rawAx)) return '个人型';
  return '外挂';
}
function normType(t) {
  if (t === '个人与平台复合型' || t === '平台兼个人复合型' || t === '复合型') return '复合型';
  if (t.startsWith('个人型')) return '个人型';
  if (t.startsWith('平台型')) return '平台型';
  return '外挂';
}
function buildPack(base, m, idx) {
  const items = [...m.entries()];
  items.sort((a, b) => (a[0] === base ? 0 : 1) - (b[0] === base ? 0 : 1));
  const body = items.map(([, c]) => c.trim()).join('\n\n');
  const head = items[0][1] || '';
  return {
    id: 'ch' + String(idx).padStart(3, '0'),
    name: base,
    quality: qualityOf(body.length),
    chars: body.length,
    sub: items.length,
    type: normType(axisTag(head)),
    desc: firstSentence(pick(head, '简介'), 60) || firstSentence(pick(head, '本质'), 60),
    content: body,
  };
}

/* ---------- 2) 读旧库（真源：node 导入） ---------- */
const { cheatPacks: oldPacks } = await import(FULL);
const oldByName = new Map(oldPacks.map((p) => [p.name, p]));

/* ---------- 3) 合并 ---------- */
const out = oldPacks.map((p) => ({ ...p }));
const outByName = new Map(out.map((p) => [p.name, p]));
let nextId = Math.max(...oldPacks.map((p) => parseInt(p.id.slice(2), 10) || 0)) + 1;
const stats = { updated: [], added: [], kept: oldPacks.length };

for (const [base, m] of groups) {
  if (base === '见世界书' || !m.size) continue;
  const fresh = buildPack(base, m, 0); // id 稍后定
  const old = outByName.get(base);
  if (old) {
    const oldChars = old.chars;
    old.content = fresh.content;
    old.chars = fresh.chars;
    old.sub = fresh.sub;
    old.quality = fresh.quality;
    old.type = fresh.type;
    old.desc = fresh.desc;
    stats.updated.push({ name: base, id: old.id, oldChars, newChars: fresh.chars });
  } else {
    fresh.id = 'ch' + String(nextId).padStart(3, '0');
    nextId += 1;
    out.push(fresh);
    outByName.set(base, fresh);
    stats.added.push({ name: base, id: fresh.id, chars: fresh.chars });
  }
}

/* ---------- 4) 校验合并语义 ---------- */
const byId = new Map(out.map((p) => [p.id, p]));
if (byId.size !== out.length) throw new Error('id 冲突');
// id 稳定性：旧包 id 与位置全部不变
oldPacks.forEach((p, i) => {
  if (out[i].id !== p.id) throw new Error(`id 位置漂移 @${i}`);
  if (out[i].name !== p.name) throw new Error(`name 漂移 @${i}`);
});
// 不砍原有
for (const p of oldPacks) if (!outByName.has(p.name)) throw new Error('旧包丢失: ' + p.name);
// content 非空
if (out.some((p) => !String(p.content || '').trim())) throw new Error('空 content');

/* ---------- 5) 生成两文件（格式照 gen-cheats.mjs） ---------- */
const JSON_ESC = (s) => JSON.stringify(String(s));
const escTpl = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const total = out.reduce((s, p) => s + p.chars, 0);

const srcName = SRC.split('/').pop();
const fullHeader = `/* ========================================================
 * 万界武库 (Cheat Vault) — 外挂全量数据 [v2.88.0]
 *
 * 来源：世界书《万界武库V4》(185 条 → 157 包) 与《万界武库V4.1》(${entries.length} 条) 的**合并式更新**。
 *   合并策略（不砍原有）：V4.1 同名包覆盖正文（${stats.updated.length} 包，id 原地保留）、
 *   V4.1 新增 ${stats.added.length} 包（含思维链V2/通用选项栏）追加尾部、V4 独有 ${stats.kept} 包全保留。
 *   合并脚本：scripts/merge-cheats-v41.mjs（源：${srcName}）。
 *   归并规则：「主条 + ·子条」家族合并为单个外挂（主条在前、子条顺次），
 *   避免同一外挂被抽两次却只生效一半。
 *   品阶按包总字数分档：神话 >=6000 / 传说 >=4500 / 史诗 >=3500 / 稀有 >=2600 / 优秀 >=1800 / 普通 <1800。
 *
 * 零外部依赖：内置静态事实源，禁止改为外部模板（CONTEXT.md 零数据库铁律 #2）。
 * 本文件由 scripts 生成，勿手改（正文含模板字符串反引号转义）。
 * 轻量索引（抽卡侧只用元数据）见 data/cheat-index.js，两文件同源生成、由测试锁定一致。
 * 【id 稳定性铁律】cheat_<packId> 已进玩家抽卡存档：id 永不重排/删除，下线包只标记不下架。
 * ======================================================== */
'use strict';
export const cheatPacks = [
`;
const fullBody = out.map((p) => [
  '  {',
  '    "id": ' + JSON_ESC(p.id) + ',',
  '    "name": ' + JSON_ESC(p.name) + ',',
  '    "quality": ' + JSON_ESC(p.quality) + ',',
  '    "chars": ' + p.chars + ',',
  '    "sub": ' + p.sub + ',',
  '    "type": ' + JSON_ESC(p.type) + ',',
  '    "desc": ' + JSON_ESC(p.desc) + ',',
  '    "content": `' + escTpl(p.content) + '`',
  '  }',
].join('\n')).join(',\n');
fs.writeFileSync(FULL, fullHeader + fullBody + '\n];\nexport default { cheatPacks };\n', 'utf8');

const idxHeader = `/* ========================================================
 * 万界武库 — 轻量索引 [v2.88.0]
 *
 * 只含元数据（id / 名称 / 品阶 / 字数 / 合条数 / 类型 / 简介），供**抽卡侧**使用：
 *   幸运转盘需要「抽到什么名字、什么品阶、权重多少、简介写什么」，
 *   但不需要全量正文——为了抽一张卡解析全文是没必要的开销。
 *   正文在 data/cheats.js，由金手指 App 加载。
 *
 * 【同源锁定】本文件与 data/cheats.js 由同一份源、同一个脚本生成；
 *   一致性由测试断言（id 集合相同、同 id 的 quality/chars/desc 逐字相同）。
 *   手改任一份都会被测试红灯拦下。
 * 【id 稳定性】与 data/cheats.js 同规：id 永不重排/删除。
 * ======================================================== */
'use strict';
export const cheatIndex = [
`;
const idxBody = out.map((p) => [
  '  {',
  '    "id": ' + JSON_ESC(p.id) + ',',
  '    "name": ' + JSON_ESC(p.name) + ',',
  '    "quality": ' + JSON_ESC(p.quality) + ',',
  '    "chars": ' + p.chars + ',',
  '    "sub": ' + p.sub + ',',
  '    "type": ' + JSON_ESC(p.type) + ',',
  '    "desc": ' + JSON_ESC(p.desc) + ',',
  '  }',
].join('\n')).join(',\n');
const idxTail = [
  '',
  '/** 品阶元数据：weight 用于抽卡权重（越大越常见）、color/order 用于展示排序。',
  ' *  抽卡侧与金手指 App **共用这一份**，不各自再写一张权重表（否则两边权重会漂移）。 */',
  'export const CHEAT_QUALITY_META = Object.freeze({',
  "  '神话': { weight: 1, color: '#f59e0b', order: 0 },",
  "  '传说': { weight: 2, color: '#ec4899', order: 1 },",
  "  '史诗': { weight: 4, color: '#a855f7', order: 2 },",
  "  '稀有': { weight: 8, color: '#3b82f6', order: 3 },",
  "  '优秀': { weight: 16, color: '#10b981', order: 4 },",
  "  '普通': { weight: 30, color: '#94a3b8', order: 5 },",
  '});',
  '',
  '/** 品阶从高到低（视图按此顺序分组） */',
  "export const CHEAT_QUALITY_ORDER = ['神话', '传说', '史诗', '稀有', '优秀', '普通'];",
  '',
  '/** 抽卡侧 itemId 前缀：外挂在幸运转盘里以 `cheat_<packId>` 入包（两侧唯一真源，改一处即两边失联） */',
  "export const CHEAT_ITEM_PREFIX = 'cheat_';",
  '',
  '/** packId → 抽卡侧 itemId */',
  'export function cheatItemId(packId) {',
  "  return CHEAT_ITEM_PREFIX + String(packId || '');",
  '}',
  '',
  '/** 反解 itemId → packId；非外挂 id 一律返回空串（不猜） */',
  'export function cheatPackIdOfItem(itemId) {',
  "  const s = String(itemId || '');",
  "  return s.startsWith(CHEAT_ITEM_PREFIX) ? s.slice(CHEAT_ITEM_PREFIX.length) : '';",
  '}',
  '',
  'export default { cheatIndex, CHEAT_QUALITY_META, CHEAT_QUALITY_ORDER, CHEAT_ITEM_PREFIX, cheatItemId, cheatPackIdOfItem };',
  '',
].join('\n');
fs.writeFileSync(IDX, idxHeader + idxBody + '\n];\n' + idxTail, 'utf8');

/* ---------- 6) 汇报 ---------- */
console.log(`合并完成: 旧 ${stats.kept} 包 → 新 ${out.length} 包 / ${total} 字`);
console.log(`覆盖更新 ${stats.updated.length} 包, 新增 ${stats.added.length} 包`);
console.log('新增:', stats.added.map((a) => `${a.id} ${a.name}(${a.chars})`).join(', '));
console.log('覆盖抽样:', stats.updated.slice(0, 5).map((u) => `${u.id} ${u.name} ${u.oldChars}->${u.newChars}`).join(', '));