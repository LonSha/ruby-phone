/**
 * tests/system-v296.test.mjs — 派生读数源身份台账门禁 [v2.96.0]
 *
 * 动机（TODO P0「源头变更后的下游对齐普查」的**收口**）：
 *   这条普查从 v2.77 一路手查到 v2.95 —— 生活事件（v2.77/2.90/2.92/2.93）→
 *   搜索索引（v2.81）→ 桌面角标（v2.91）→ 万象背包（v2.95）。
 *   每轮的做法都是「读代码找形态」，于是有两个问题一直没被回答：
 *     ① 还有哪些库属于同一形态？（永远没有清单）
 *     ② 查过的库，判据只活在当轮套件里，下一轮没人知道它还成立吗？
 *   本版把这一支从「逐轮手查」换成「一次性枚举 + 台账 + 门禁」：
 *     `scripts/source-derivation-audit.mjs` 持续回答
 *       枚举面有没有新增未登记的库 / 登记出口是否仍在 / 条目是否仍存活。
 *
 * 覆盖：
 *   A 结构面：门禁接入 check 链、真仓库全绿、台账自证（派生库必有出口判据）
 *   B 负控制：四条真源码破坏 → 在**副本树**上重跑门禁必须转红，且信息指向真原因
 *   C 台账内容：已判定的三条结论（含被证伪项）必须留在台账里（防重复投入）
 *   D 版本下限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AUDIT_REL = 'scripts/source-derivation-audit.mjs';

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v296 A1. 门禁接入 check 链（否则等于没做）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['source-derivation'], 'package.json 缺 source-derivation 脚本');
  assert.match(pkg.scripts.check, /source-derivation/, 'check 链未包含 source-derivation');
  assert.ok(fs.existsSync(path.join(ROOT, AUDIT_REL)), '门禁脚本不存在');
});

test('v296 A2. 真仓库上全绿（枚举面全部登记 / 出口在场 / 条目存活）', () => {
  const out = execFileSync('node', [AUDIT_REL], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /枚举面全部登记/, '未给出通过结论');
  assert.match(out, /台账 \d+ 条/, '未输出台账统计');
  assert.match(out, /派生库 3/, '派生库计数异常（应含 life-events / wanxiang-inventory / worldbook-selection）');
});

test('v296 A3. 台账自证：派生库必须给出口判据，且枚举面非空', () => {
  const src = read(AUDIT_REL);
  // 自证判据本身必须在脚本里（fail-closed，不允许「零命中 = 全绿」）
  assert.match(src, /枚举面零命中/, '缺「枚举正则失效」自证');
  assert.match(src, /台账为空/, '缺「台账为空」自证');
  assert.match(src, /kind === 'derivation' && \(!entry\.exports/, '缺「派生库必须给出口」自证');
  // 三层判定（derivation / store / not-a-derivation）必须都登记到
  assert.match(src, /'derivation'/, '缺 derivation 分类');
  assert.match(src, /'not-a-derivation'/, '缺「已查、非派生库」分类（防重复投入）');
});

/* ============================================================
 * B. 负控制：真源码破坏 → 在副本树上重跑门禁必须转红
 * ============================================================ */
const TOUCHED = [
  AUDIT_REL,
  'package.json',
  'config/life-events.js',
  'config/worldbook-manager.js',
  'config/prompt-manager.js',
  'apps/calendar/calendar-app.js',
  'apps/calendar/calendar-data.js',
  'apps/calendar/calendar-view.js',
  'apps/wangxiang/wangxiang-app.js',
  'apps/album/album-data.js',
  'apps/album/album-image-picker.js',
  'apps/album/album-view.js',
  'apps/memory/global-search-engine.js',
  'apps/search/search-view.js',
];

function stageTree(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v296-tree-'));
  for (const rel of TOUCHED) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, read(rel));
  }
  for (const [rel, content] of Object.entries(extra)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/** 在副本树上跑门禁，返回 { ok, out, err }（破坏后必须 exit != 0） */
function runAudit(dir) {
  try {
    const out = execFileSync('node', [AUDIT_REL], { cwd: dir, encoding: 'utf8' });
    return { ok: true, out, err: '' };
  } catch (e) {
    return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
  return s.replace(from, to);
};

test('v296 B0. 副本树自身全绿（否则负控制是假绿）', () => {
  const dir = stageTree();
  try {
    const r = runAudit(dir);
    assert.equal(r.ok, true, '未破坏的副本树必须通过：' + r.err);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v296 B1. 负控制：拆掉一个登记出口 → 红灯指向该出口', () => {
  const brokenLife = replaceOnce(read('config/life-events.js'),
    'removeBySourceBase(base) {', 'removeBySourceBaseRenamed(base) {');
  const dir = stageTree({ 'config/life-events.js': brokenLife });
  try {
    const r = runAudit(dir);
    assert.equal(r.ok, false, '出口名被改后必须红灯');
    assert.match(r.err, /removeBySourceBase\(base\)/, '红灯须指向具体出口');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v296 B2. 负控制：新增一个未登记的派生库文件 → 枚举面红灯', () => {
  // 刻意用「本仓最常见的配对写法」（源字段在比较右侧、方法参数内不直接出现源字段），
  //   以证明枚举口径没有开口：口径若收紧成「参数内必须带源字段」，这条破坏会漏网。
  const newLib = `export function pickBySource(items, sourceId) {\n    return (items || []).filter((x) => String(x?.sourceKey || '') === sourceId);\n}\n`;
  const dir = stageTree({ 'apps/album/album-fresh-lib.js': newLib });
  try {
    const r = runAudit(dir);
    assert.equal(r.ok, false, '未登记的新库必须红灯');
    assert.match(r.err, /未登记的库/, '红灯须说明是枚举面未登记');
    assert.match(r.err, /album-fresh-lib\.js/, '红灯须点名该文件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v296 B3. 负控制：登记在枚举面里的文件消失 → 僵尸条目红灯', () => {
  const dir = stageTree();
  try {
    fs.rmSync(path.join(dir, 'apps/search/search-view.js'));
    const r = runAudit(dir);
    assert.equal(r.ok, false, '僵尸条目必须红灯');
    assert.match(r.err, /枚举面已不命中它/, '红灯须说明条目已失效');
    assert.match(r.err, /search-view\.js/, '红灯须点名该文件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('v296 B4. 负控制：台账被清空 → fail-closed 红灯（不许空台账蒙过）', () => {
  const brokenAudit = replaceOnce(read(AUDIT_REL),
    'const LEDGER = [', 'const LEDGER = []; const _UNUSED_LEDGER = [');
  const dir = stageTree({ [AUDIT_REL]: brokenAudit });
  try {
    const r = runAudit(dir);
    assert.equal(r.ok, false, '空台账必须红灯（否则门禁失去意义）');
    assert.match(r.err, /台账为空/, '红灯须给出「台账为空」的理由');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ============================================================
 * C. 台账内容：已判定的结论必须留下（防下一轮重复投入）
 * ============================================================ */
test('v296 C. 台账保留「已查、非缺陷」的判定与依据', () => {
  const src = read(AUDIT_REL);
  // ① 删订单记录不回收 = 设计本意（v2.95 的证伪结论）
  assert.match(src, /删订单\*\*记录\*\*不回收 = 设计本意/,
    '万象支的证伪结论（设计本意）必须留在台账，防被当成缺陷重查');
  // ② 世界书来源选择 = 已证伪（UI 挡住 / 来源由宿主提供）—— 判定与依据必须在同一条 note 里
  assert.match(src, /worldbook-selection[\s\S]{0,700}判定为非缺陷/,
    '世界书支的证伪结论必须在台账');
  // ③ 提示词导入预设 = 非派生库（字段名叫 sourceId 但语义不同）
  assert.match(src, /prompt-manager\.js[\s\S]{0,200}字段名叫 sourceId/,
    '提示词预设支的判定（语义不是源头身份）必须在台账');
  // ④ 每条「非派生库」都带理由（不许只留文件名）
  const notDerivation = src.slice(src.indexOf("kind: 'not-a-derivation'"));
  assert.match(notDerivation, /note: '/, '非派生库条目必须给出理由');
});

/* ============================================================
 * D. 版本下限
 * ============================================================ */
function vnum(v) { return String(v || '').split('.').map((n) => Number.parseInt(n, 10) || 0); }
function atLeast(v, floor) {
  const a = vnum(v), b = vnum(floor);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}
test('v296 D. 版本不低于 2.96.0 且五源同源', () => {
  const log = JSON.parse(read('update-log.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION 必须存在');
  assert.equal(log.latest, manifest.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, m[1]);
  assert.equal(atLeast(log.latest, '2.96.0'), true, `版本 ${log.latest} < 2.96.0`);
  const entry = log.versions[log.latest];
  assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
});