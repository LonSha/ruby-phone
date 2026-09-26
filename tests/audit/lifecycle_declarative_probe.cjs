#!/usr/bin/env node
/* ============================================================
 * tests/audit/lifecycle_declarative_probe.cjs
 * 探针：P-6 「声明式生命周期注册」可行性取证 —— 只量，不拆。
 * ------------------------------------------------------------
 * 【要回答的问题】（凡实施前必须先有读数）
 *   ① 声明式注册能覆盖多少「手写接线点」？（判据：>= 80% 才实施）
 *   ② 三条会话路径上，同一个 App 出口的调用语义是否一致？
 *      （不一致 = 单一声明表达不了「三路径各做不同的事」）
 *   ③ onChatChanged 的参数契约能否统一？（框架统一调用只能是零参或统一传参）
 *   ④ 覆盖不到的那部分是什么？（决定「统一框架 + 例外清单」还是「本来就不该统一」）
 *
 * 【口径纪律】
 *   · 只读：不写任何文件、不改任何状态；
 *   · 可复算：同一份 index.js 跑两次，读数必须逐字节相同（套件 A1）；
 *   · 区间按函数/监听器边界精确划定（沿用 scripts/lifecycle-audit.mjs 的踩坑结论：
 *     近似区间会让 P1 尾部与 P2 头部重叠，把真缺口判成已覆盖）；
 *   · 读不到就 fail-closed（exit 2），绝不用坏探针发合格证。
 *
 * 【与 lifecycle-audit.mjs 的分工】
 *   · 那道门回答「有没有接线」（存在性），进 npm run check；
 *   · 本探针回答「接线能不能改成声明式」（形态），不进 npm run check，
 *     由 tests/system-v324.test.mjs 拉起。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const S = '[ ' + BS + 't]';

const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');
const JSON_MODE = argv.includes('--json');

const idxPath = path.join(ROOT, 'index.js');
if (!fs.existsSync(idxPath)) {
  console.error('[declarative] 读不到 index.js —— fail-closed 拒判');
  process.exit(2);
}
const IDX = fs.readFileSync(idxPath, 'utf8');
if (!IDX.length) {
  console.error('[declarative] index.js 为空 —— fail-closed 拒判');
  process.exit(2);
}
const LINES = IDX.split(NL);
const APP_DIR = path.join(ROOT, 'apps');
if (!fs.existsSync(APP_DIR)) {
  console.error('[declarative] apps/ 不存在 —— fail-closed 拒判');
  process.exit(2);
}

const EXITS = ['onChatChanged', 'clearCache', 'destroy', 'deactivate', 'reload'];

/* 出口定义：类体内以行首缩进起始的方法签名（门禁同款口径） */
function definedExits(body) {
  return EXITS.filter((e) => new RegExp(NL + S + '*' + e + S + '*' + BS + '(').test(body));
}

/* onChatChanged 参数签名：'' = 无参；其余为该参数列表原文 */
function onChatSignature(body) {
  const re = new RegExp(NL + S + '*' + 'onChatChanged' + S + '*' + BS + '(([^)]*)' + BS + ')');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

/* ── ① App 类枚举 ── */
const CLASS_RE = /export[ 	]+class[ 	]+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const classes = [];
for (const dir of fs.readdirSync(APP_DIR).sort()) {
  const abs = path.join(APP_DIR, dir);
  if (!fs.statSync(abs).isDirectory()) continue;
  for (const f of fs.readdirSync(abs).sort()) {
    if (f.slice(-7) !== '-app.js') continue;
    const src = fs.readFileSync(path.join(abs, f), 'utf8');
    let m;
    CLASS_RE.lastIndex = 0;
    while ((m = CLASS_RE.exec(src)) !== null) {
      const body = src.slice(m.index);
      const exits = definedExits(body);
      if (!exits.length) continue;
      classes.push({ dir: dir, file: f, cls: m[1], exits: exits, sig: onChatSignature(body) });
    }
  }
}

/* ── ② 槽位反查 ── */
function slotsOf(cls) {
  const re = new RegExp('VirtualPhone' + BS + '.' + '([A-Za-z0-9_]+)' + BS + 's*=' + BS + 's*new' + BS + 's*(?:module' + BS + '.)?' + cls + BS + 'b', 'g');
  const out = [];
  let m;
  while ((m = re.exec(IDX)) !== null) out.push(m[1]);
  return out;
}
const SLOTS_RE = new RegExp('VirtualPhone' + BS + '.' + '([A-Za-z0-9_]+)' + BS + 's*=' + BS + 's*new' + BS + 'b', 'g');
const allSlots = [];
{ let m; while ((m = SLOTS_RE.exec(IDX)) !== null) allSlots.push(m[1]); }
const allSlotsUniq = [...new Set(allSlots)].sort();

const slotToCls = new Map();
for (const c of classes) {
  for (const s of slotsOf(c.cls)) {
    if (!slotToCls.has(s)) slotToCls.set(s, []);
    slotToCls.get(s).push(c.cls);
  }
  c.slots = slotsOf(c.cls);
}
const appSlots = new Set([...slotToCls.keys()]);

/* ── ③ 三条会话路径区间（门禁同款，函数/监听器边界） ── */
function lineOf(re, from) {
  for (let i = from || 0; i < LINES.length; i++) if (re.test(LINES[i])) return i;
  return -1;
}
const p1s = lineOf(new RegExp('^' + S + '*' + 'function onChatChanged' + BS + '(' + BS + ')' + S + '*' + BS + '{'));
const p1e = lineOf(new RegExp('^' + S + '*' + 'function getContext' + BS + '(' + BS + ')' + S + '*' + BS + '{'), p1s + 1);
const p2s = lineOf(new RegExp('addEventListener' + BS + '(' + S + '*' + "'phone:clearCurrentData'"));
const p3s = lineOf(new RegExp('addEventListener' + BS + '(' + S + '*' + "'phone:clearAllData'"));
const p3e = p3s >= 0 ? lineOf(new RegExp('addEventListener' + BS + '('), p3s + 1) : -1;
const PATHS = {
  P1: (p1s >= 0 && p1e > p1s) ? [p1s, p1e] : null,
  P2: (p2s >= 0 && p3s > p2s) ? [p2s, p3s] : null,
  P3: (p3s >= 0) ? [p3s, (p3e > p3s ? p3e : LINES.length)] : null
};
const missing = Object.keys(PATHS).filter((k) => !PATHS[k]);
if (missing.length) {
  console.error('[declarative] 三条会话路径锚点缺失: ' + missing.join(',') + ' —— fail-closed 拒判');
  process.exit(2);
}

/* ── ④ 散点扫描与三分类 ── */
const CALL_RE = new RegExp(BS + '.' + '(?:' + BS + '?' + BS + '.)?' + '(' + EXITS.join('|') + ')' + '(?:' + BS + '?' + BS + '.)?' + BS + '(');
const NULLIFY_RE = new RegExp('VirtualPhone' + BS + '.' + '([A-Za-z0-9_]+)' + S + '*' + '=' + S + '*' + 'null');

function scanRegion(range) {
  const out = [];
  for (let i = range[0]; i < range[1] && i < LINES.length; i++) {
    const raw = LINES[i];
    const t = raw.trim();
    if (!t || t.slice(0, 2) === '//' || t[0] === '*') continue;
    if (raw.indexOf('VirtualPhone.') < 0 && raw.indexOf('phone.') < 0) continue;
    const isCall = CALL_RE.test(raw);
    const nul = NULLIFY_RE.exec(raw);
    if (!isCall && !nul) continue;
    /* 命中的槽位：作废式取被赋值的那个；调用式取行内第一个出现的槽位 */
    let slot = null;
    if (isCall) {
      for (const s of allSlotsUniq) {
        if (raw.indexOf('VirtualPhone.' + s) >= 0 || raw.indexOf('phone.' + s) >= 0) { slot = s; break; }
      }
    } else {
      slot = nul[1];
    }
    if (!slot) continue;
    out.push({ line: i + 1, slot: slot, kind: isCall ? 'exit' : 'nullify', app: appSlots.has(slot) });
  }
  return out;
}

const points = [];
for (const tag of ['P1', 'P2', 'P3']) {
  for (const p of scanRegion(PATHS[tag])) points.push(Object.assign({ path: tag }, p));
}

const appExitPoints = points.filter((p) => p.app).length;
const nonAppPoints = points.length - appExitPoints;
const coverage = points.length ? appExitPoints / points.length : 0;
const nonAppShare = points.length ? nonAppPoints / points.length : 0;

/* ── ⑤ 三路径语义一致性：以槽位为单位比对「动作集」 ── */
const bySlot = new Map();
for (const p of points) {
  if (!p.app) continue;
  if (!bySlot.has(p.slot)) bySlot.set(p.slot, { P1: [], P2: [], P3: [] });
  bySlot.get(p.slot)[p.path].push(p.kind);
}
const semantics = [];
for (const [slot, v] of [...bySlot.entries()].sort()) {
  const a = JSON.stringify(v.P1.sort());
  const b = JSON.stringify(v.P2.sort());
  const c = JSON.stringify(v.P3.sort());
  semantics.push({ slot: slot, same: (a === b && b === c), P1: v.P1, P2: v.P2, P3: v.P3 });
}
const sameCount = semantics.filter((s) => s.same).length;
const semanticConsistency = semantics.length ? sameCount / semantics.length : 0;

/* ── ⑥ onChatChanged 签名分布 ── */
const sig = { empty: 0, required: 0, def: 0, none: 0 };
for (const c of classes) {
  if (c.sig === null) sig.none += 1;
  else if (c.sig === '') sig.empty += 1;
  else if (c.sig.indexOf('=') >= 0) sig.def += 1;
  else sig.required += 1;
}
const sigUniform = (sig.required === 0);

/* ── ⑦ 四判据 + 判定 ── */
const pctOf = (x) => (x * 100).toFixed(1) + '%';
const THRESHOLD = { coverage: 0.8, semanticConsistency: 0.8, nonAppShare: 0.2 };
const crit = [
  { id: 'R1', desc: '声明式覆盖面 >= ' + (THRESHOLD.coverage * 100) + '%', pass: coverage >= THRESHOLD.coverage, got: coverage, gotText: pctOf(coverage) },
  { id: 'R2', desc: 'onChatChanged 参数契约可统一（无必选参出口）', pass: sigUniform, got: sig.required, gotText: sig.required + ' 个必选参出口' },
  { id: 'R3', desc: '三路径语义一致率 >= ' + (THRESHOLD.semanticConsistency * 100) + '%', pass: semanticConsistency >= THRESHOLD.semanticConsistency, got: semanticConsistency, gotText: pctOf(semanticConsistency) },
  { id: 'R4', desc: '非 App 接线点占比 <= ' + (THRESHOLD.nonAppShare * 100) + '%', pass: nonAppShare <= THRESHOLD.nonAppShare, got: nonAppShare, gotText: pctOf(nonAppShare) }
];
const verdict = crit.every((c) => c.pass) ? 'go' : 'not_done';

const report = {
  appClasses: classes.length,
  slots: allSlotsUniq.length,
  appSlots: appSlots.size,
  appSlotShare: allSlotsUniq.length ? appSlots.size / allSlotsUniq.length : 0,
  wiringPoints: points.length,
  appExitPoints: appExitPoints,
  nonAppPoints: nonAppPoints,
  coverage: coverage,
  nonAppShare: nonAppShare,
  pointsByPath: { P1: points.filter((p) => p.path === 'P1').length, P2: points.filter((p) => p.path === 'P2').length, P3: points.filter((p) => p.path === 'P3').length },
  signatures: sig,
  signatureRequired: classes.filter((c) => c.sig !== null && c.sig !== '' && c.sig.indexOf('=') < 0).map((c) => c.cls + '(' + c.sig + ')'),
  signatureDefault: classes.filter((c) => c.sig !== null && c.sig.indexOf('=') >= 0).map((c) => c.cls + '(' + c.sig + ')'),
  semanticSlots: semantics.length,
  semanticSame: sameCount,
  semanticDiff: semantics.length - sameCount,
  semanticConsistency: semanticConsistency,
  semanticDiffList: semantics.filter((s) => !s.same),
  criteria: crit.map((c) => ({ id: c.id, desc: c.desc, pass: c.pass, got: c.got, gotText: c.gotText })),
  verdict: verdict
};

/* L4 枚举面自证：下限不达 = 枚举器失效，fail-closed */
if (classes.length < 20 || allSlotsUniq.length < 20 || appSlots.size < 15) {
  console.error('[declarative] 枚举面不足（类 ' + classes.length + ' / 槽位 ' + allSlotsUniq.length + ' / App 槽位 ' + appSlots.size + '）—— fail-closed 拒判');
  process.exit(2);
}
if (points.length === 0) {
  console.error('[declarative] 三路径零接线点 —— 扫描器失效，fail-closed 拒判');
  process.exit(2);
}

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const pct = (x) => (x * 100).toFixed(1) + '%';
console.log('[declarative] ===== P-6 声明式生命周期注册可行性 =====');
console.log('[declarative] ① 枚举面：App 类 ' + classes.length + ' · 实例槽位 ' + allSlotsUniq.length + ' · App 实例槽位 ' + appSlots.size + '（' + pct(report.appSlotShare) + '）');
console.log('[declarative] ② 三路径手写接线点：' + points.length + '（P1 ' + report.pointsByPath.P1 + ' / P2 ' + report.pointsByPath.P2 + ' / P3 ' + report.pointsByPath.P3 + '）');
console.log('[declarative]    其中 App 实例出口 ' + appExitPoints + ' · 非 App 目标 ' + nonAppPoints);
console.log('[declarative] ③ onChatChanged 签名：无参 ' + sig.empty + ' · 带默认值 ' + sig.def + ' · 带必选参 ' + sig.required + ' · 无此出口 ' + sig.none);
console.log('[declarative] ④ 三路径语义一致：' + sameCount + ' / ' + semantics.length + '（' + pct(semanticConsistency) + '）');
console.log('[declarative] ⑤ 判定：');
for (const c of crit) {
  console.log('[declarative]    ' + c.id + ' ' + (c.pass ? '✓' : '✗') + ' ' + c.desc + ' —— 实测 ' + c.gotText);
}
console.log('[declarative] ⇒ ' + verdict);
process.exit(0);
