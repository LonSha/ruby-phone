/* 一次性生成：源世界书 万界武库V4.json → data/cheats.js（全量正文）+ data/cheat-index.js（轻量索引）
 * 拆两个文件的理由：抽卡侧只需要「名字/品阶/权重/简介」（约 25KB），
 *   不该为了抽一张卡就把 500K 字正文全部解析进内存。两边由同一份源生成，并由测试锁定一致性。
 */
import fs from 'node:fs';

const SRC = process.argv[2];
const OUT_FULL = process.argv[3];
const OUT_IDX = process.argv[4];
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const entries = Object.values(raw.entries || {});

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

/* 品阶分档：按归并后包总字数 */
const BANDS = [[6000, '神话'], [4500, '传说'], [3500, '史诗'], [2600, '稀有'], [1800, '优秀'], [0, '普通']];
const qualityOf = (chars) => BANDS.find(([t]) => chars >= t)[1];

/* 从正文里抽标签块内容（截到下一个 < 标签为止） */
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
/* 主收益轴 → 归一到四值短标签（个人型 / 平台型 / 复合型 / 外挂） */
function axisTag(head) {
  const raw = pick(head, '主收益轴') + ' ' + pick(head, '核心收益');
  const m = raw.match(/(个人与平台复合型|平台兼个人复合型|个人型|平台型)/);
  if (m) return m[1].includes('复合') ? '复合型' : m[1];
  if (/平台|店铺|商城|领地|据点|界域/.test(raw + head.slice(0, 400))) return '平台型';
  if (/个人/.test(raw)) return '个人型';
  return '外挂';
}
function normType(t) {
  if (t === '个人与平台复合型' || t === '平台兼个人复合型' || t === '复合型') return '复合型';
  if (t.startsWith('个人型')) return '个人型';
  if (t.startsWith('平台型')) return '平台型';
  return '外挂';
}

const packs = [];
let idx = 0;
for (const [base, m] of groups) {
  idx += 1;
  const items = [...m.entries()];
  items.sort((a, b) => (a[0] === base ? 0 : 1) - (b[0] === base ? 0 : 1));
  const body = items.map(([, c]) => c.trim()).join('\n\n');
  const head = items[0][1] || '';
  packs.push({
    id: 'ch' + String(idx).padStart(3, '0'),
    name: base,
    quality: qualityOf(body.length),
    chars: body.length,
    sub: items.length,
    type: normType(axisTag(head)),
    desc: firstSentence(pick(head, '简介'), 60) || firstSentence(pick(head, '本质'), 60),
    content: body,
  });
}

const JSON_ESC = (s) => JSON.stringify(String(s));
const escTpl = (s) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const total = packs.reduce((s, p) => s + p.chars, 0);

/* ---------- 1) 全量正文 data/cheats.js ---------- */
const fullHeader = `/* ========================================================
 * 万界武库 (Cheat Vault) — 外挂全量数据 [v2.47.0]
 *
 * 来源：世界书《万界武库V4》(${entries.length} 条) 归并去重后的 ${packs.length} 个外挂包 / ${total} 字。
 *   归并规则：「主条 + ·子条」家族（试炼空间 / 文明之光系统 / 脑洞 / 我命由我 /
 *   词条系统 / 人生模拟 / 熟练度状态栏 / 孤月的爱）合并为单个外挂（主条在前、子条顺次），
 *   避免同一外挂被抽两次却只生效一半。
 *   品阶按包总字数分档：神话 >=6000 / 传说 >=4500 / 史诗 >=3500 / 稀有 >=2600 / 优秀 >=1800 / 普通 <1800。
 *
 * 零外部依赖：内置静态事实源，禁止改为外部模板（CONTEXT.md 零数据库铁律 #2）。
 * 本文件由 scripts 生成，勿手改（正文含模板字符串反引号转义）。
 * 轻量索引（抽卡侧只用元数据）见 data/cheat-index.js，两文件同源生成、由测试锁定一致。
 * ======================================================== */
'use strict';
export const cheatPacks = [
`;
const fullBody = packs.map((p) => [
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
fs.writeFileSync(OUT_FULL, fullHeader + fullBody + '\n];\nexport default { cheatPacks };\n', 'utf8');

/* ---------- 2) 轻量索引 data/cheat-index.js ---------- */
const idxHeader = `/* ========================================================
 * 万界武库 — 轻量索引 [v2.47.0]
 *
 * 只含元数据（id / 名称 / 品阶 / 字数 / 合条数 / 类型 / 简介），供**抽卡侧**使用：
 *   幸运转盘需要「抽到什么名字、什么品阶、权重多少、简介写什么」，
 *   但不需要 500K 字正文——为了抽一张卡解析全文是没必要的开销。
 *   正文在 data/cheats.js，由金手指 App 加载。
 *
 * 【同源锁定】本文件与 data/cheats.js 由同一份源、同一个脚本生成；
 *   一致性由测试断言（id 集合相同、同 id 的 quality/chars/desc 逐字相同）。
 *   手改任一份都会被测试红灯拦下。
 * ======================================================== */
'use strict';
export const cheatIndex = [
`;
const idxBody = packs.map((p) => [
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
  '];',
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
fs.writeFileSync(OUT_IDX, idxHeader + idxBody + '\n' + idxTail, 'utf8');

console.log('written', OUT_FULL, '+', OUT_IDX);
console.log('packs', packs.length, 'chars', total, 'backtick-or-interp', packs.filter((p) => /`|\$\{/.test(p.content)).length);
const q = {};
for (const p of packs) q[p.quality] = (q[p.quality] || 0) + 1;
console.log('quality', JSON.stringify(q));
const t = {};
for (const p of packs) t[p.type] = (t[p.type] || 0) + 1;
console.log('type', JSON.stringify(t));
console.log('no-desc', packs.filter((p) => p.desc === '').length);