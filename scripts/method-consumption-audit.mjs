#!/usr/bin/env node
/**
 * scripts/method-consumption-audit.mjs — 类方法面 + 模块入度面审计（计划 R11-O2）
 *
 * 为什么存在（v4.93.0 实测的两处结构性盲区，见 scripts/lib/dead-surface.mjs 头注释）：
 *   ① 门只看「模块级导出有没有人 import」。`export class SubsystemOrchestrator` 被
 *      `index.js` import 了，于是它的 **41 个类方法一次全部白拿「已消费」**——
 *      实测其中 **34 个在产品面除声明行外零出现**，门从来没报过。
 *   ② `config/*.js` 264 件里 **79 件只被 orchestrator 引**、**15 件零 import**，
 *      因为「中枢那一行 import」就算已消费，整批件长期无人过问。
 *
 * 判据（照计划「只判增量，存量冻结」纪律）：
 *   · 方法面：公开方法名在**全仓除声明行外零出现** ⇒ 记死。最保守口径（下界，不冤枉）。
 *     与基线 scripts/dead-method-baseline.json 比对：新增未登记 ⇒ 红。
 *   · 模块面：`config/` 与 `phone/` 顶层模块的入度分档；**新增**落入
 *     `orchestrator-only` / `zero` 且未登记 ⇒ 红。存量 79+15 一次冻结为基线。
 *   · 扫描面塌陷（文件数 / 类数 / 方法数低于阈值）⇒ exit 2（fail-closed）。
 *
 * ⚠️ 夹具模式（--root 指到别处）**不做基线比对**：基线是**本仓**的存量账本，
 *   拿它去对一棵合成夹具，等于用别人的账要求这棵树 —— 全部 332 条基线会被判「已复活」、
 *   夹具里的死方法又会被判「未登记」，两侧全是噪声。夹具模式下只出自证读数。
 *   （本版 F4 实测踩到：--fixture 曾带着真仓基线跑夹具，输出 332 条假「复活」告警。）
 *
 * 退出码：0 通过 / 1 有新增 / 2 结构失效（fail-closed）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSurfaces, collectClassMethods, buildNameIndex, findDeadMethods,
  buildInstantiationIndex, buildModuleIndegree,
} from './lib/dead-surface.mjs';
import { loadTree } from './lib/binding-consumption.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const METHOD_BASELINE = path.join(__dir, 'dead-method-baseline.json');
const MODULE_BASELINE = path.join(__dir, 'dead-module-baseline.json');

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : ROOT;
const listMode = args.includes('--list');
const updateMode = args.includes('--update');
const FIXTURE = args.includes('--fixture');
const REAL_REPO = rootIdx < 0;

/* 扫描面下限：真仓实测 676 文件 / 281 个带方法类 / 4803 条公开方法。
 * 取真值的 ~55% 作下限：低于它就说明探测器结构失效（而不是「代码变干净了」）。 */
const MIN_FILES = 380;
const MIN_CLASSES = 150;
const MIN_PUBLIC = 2500;

const { raw, masked } = loadSurfaces(root);
const { bindTexts } = loadTree(root, { skipDirs: new Set(['node_modules', '.git', '.wrangler']) });

const classesWithMethods = collectClassMethods(masked).filter((c) => c.methods.length);
const publicEntries = [];
for (const c of classesWithMethods) {
  for (const m of c.methods) {
    if (m.isAccessor || m.isPrivate) continue;
    publicEntries.push({ ...m, cls: c.cls, rel: c.rel });
  }
}

/* ---------- 结构自证（fail-closed，防探测器失效后全绿） ---------- */
// 空面无论加不加 --fixture 都必须是 exit 2：合成夹具可以小，但不可能「零文件还判绿」。
//   首版把 --fixture 写成整体绕过下限检查，负控制 N3 实测 rc=0 —— 那正是
//   「探测器失效后全绿」的经典通道，已被 N3 钉住。
if (raw.size === 0) {
  console.error('[method-audit] ❌ 扫描面为空（0 文件）：无论是否 --fixture 都 fail-closed。');
  process.exit(2);
}
const collapse = [];
if (raw.size < MIN_FILES) collapse.push(`文件 ${raw.size} < ${MIN_FILES}`);
if (classesWithMethods.length < MIN_CLASSES) collapse.push(`带方法类 ${classesWithMethods.length} < ${MIN_CLASSES}`);
if (publicEntries.length < MIN_PUBLIC) collapse.push(`公开方法 ${publicEntries.length} < ${MIN_PUBLIC}`);
if (!(raw.size === masked.size)) collapse.push(`原文/掩码数量不一致 ${raw.size}/${masked.size}`);
if (REAL_REPO && collapse.length) {
  console.error(`[method-audit] ❌ 扫描面塌陷：${collapse.join(' · ')}`);
  console.error('  这不是「代码变干净了」，而是探测器结构失效（枚举面被削/掩码出错）。fail-closed。');
  process.exit(2);
}
if (!REAL_REPO && !FIXTURE && collapse.length) {
  console.error(`[method-audit] --root ${root} 扫描面不足（${collapse.join(' · ')}）；若确是合成夹具请加 --fixture。`);
  process.exit(2);
}

const nameIndex = buildNameIndex(masked, raw, new Set(publicEntries.map((m) => m.name)));
const deadMethods = findDeadMethods(classesWithMethods, nameIndex);
const instIndex = buildInstantiationIndex(masked, new Set(classesWithMethods.map((c) => c.cls)));

/* 方法条目带上「所属类是否被 new 过」：同一条方法，类从没被 new 过与类被 new 过，
 * 处置动作不同（前者连实例都不存在，后者只是这个方法没人调）——报告里必须能分。 */
for (const d of deadMethods) {
  d.classInstantiated = (instIndex.get(d.cls) || []).length > 0;
}

/* ---------- 模块入度面 ---------- */
const moduleRows = buildModuleIndegree(bindTexts);
const weakTiers = moduleRows.filter((r) => r.tier === 'orchestrator-only' || r.tier === 'zero');

/* ---------- 与基线比对 ---------- */
/* 夹具模式不做基线比对（理由见文件头）：基线是本仓存量账本，
 *   拿它去对合成夹具 ⇒ 332 条基线全判「复活」、夹具内死方法全判「未登记」，两侧全是噪声。
 *   自证判据（塌陷 / 空面）在夹具模式下照旧生效，与基线比对无关。 */
function readBaseline(p, shape) {
  if (!fs.existsSync(p)) return shape;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return shape; }
}
const mBase = readBaseline(METHOD_BASELINE, { note: '', entries: [] });
const dBase = readBaseline(MODULE_BASELINE, { note: '', entries: [] });
const FIXTURE_MODE = !REAL_REPO;
const baseMethodEntries = FIXTURE_MODE ? [] : (mBase.entries || []);
const baseModuleEntries = FIXTURE_MODE ? [] : (dBase.entries || []);

const keyOf = (d) => `${d.rel}::${d.cls}::${d.name}`;
const mBaseKeys = new Set(baseMethodEntries.map(keyOf));
const mKeys = new Set(deadMethods.map(keyOf));
/* 夹具模式（--root 非本仓）**只出自证读数，不做增量判红**：
 *   基线是本仓存量账本，拿它去对合成树，两侧都是噪声（332 条基线判假复活、
 *   夹具里的方法判未登记）。这与「塌陷自证在夹具模式照旧生效」不冲突 ——
 *   同一份判据的两种角色：结构自证永远跑，增量判定只对真仓跑。
 *   （本版 F4 首跑踩到两次：先是 332 条假复活告警，再是夹具里那条 zero 模块被判红。） */
const mNew = FIXTURE_MODE ? [] : deadMethods.filter((d) => !mBaseKeys.has(keyOf(d)));
const mRevived = FIXTURE_MODE ? [] : baseMethodEntries.filter((e) => !mKeys.has(keyOf(e)));

const dKeyOf = (r) => `${r.rel}`;
const dBaseMap = new Map(baseModuleEntries.map((e) => [dKeyOf(e), e]));
const dNew = FIXTURE_MODE ? [] : weakTiers.filter((r) => {
  const b = dBaseMap.get(dKeyOf(r));
  if (!b) return true;
  // 档位恶化也算新增（zero 与 orchestrator-only 之间不算恶化，两者都算「产品端不达」）
  return false;
});
const dImproved = FIXTURE_MODE ? [] : baseModuleEntries.filter((e) => {
  const now = weakTiers.find((r) => dKeyOf(r) === dKeyOf(e));
  return !now;
});

const baseLabel = (n) => (FIXTURE_MODE ? '夹具模式不比对' : String(n));
if (listMode) {
  console.log(`[method-audit] 死方法 ${deadMethods.length}（基线 ${baseLabel(baseMethodEntries.length)} / 新增 ${mNew.length} / 复活 ${mRevived.length}）`);
  console.log(`[method-audit] 弱档模块 ${weakTiers.length}（基线 ${baseLabel(baseModuleEntries.length)} / 新增 ${dNew.length} / 返回产品面 ${dImproved.length}）`);
  process.exit(mNew.length || dNew.length ? 1 : 0);
}

if (updateMode) {
  /* --update 会把读数**写回本仓账本**。在夹具模式下写，等于拿合成树覆盖真本仓账本 ——
   *   一次 --root 指错就把 332 条存量账本洗成夹具的那几条。故夹具模式一律拒绝写入。 */
  if (FIXTURE_MODE) {
    console.error('[method-audit] ❌ 夹具模式（--root 非本仓）禁止 --update：会拿合成读数覆盖本仓账本。');
    process.exit(2);
  }
  fs.writeFileSync(METHOD_BASELINE, JSON.stringify({
    note: mBase.note || '类方法面冻结账本（R11-O2）。判据：公开方法名在**全仓除声明行外零出现**即记死。新增未登记即红；条目被真接线后应清理。口径见 scripts/lib/dead-surface.mjs 头注释。',
    schema: 'dead-method-baseline@1',
    generated_at: new Date().toISOString(),
    generated_version_hint: process.env.RP_VERSION || 'auto',
    rule: '只判增量。存量冻结是为了「不一次性清零牵连整批 App」（计划明令）。每条带 classInstantiated 以便分档处置。',
    entries: deadMethods,
  }, null, 2) + '\n');
  fs.writeFileSync(MODULE_BASELINE, JSON.stringify({
    note: dBase.note || '模块入度面冻结账本（R11-O2）。判据：config/ 与 phone/ 顶层模块「新增落入 orchestrator-only 或 zero」即红；存量 79+15 冻结。',
    schema: 'dead-module-baseline@1',
    generated_at: new Date().toISOString(),
    generated_version_hint: process.env.RP_VERSION || 'auto',
    rule: '只判增量：已建件只有中枢引、或完全孤岛，是存量债（计划 O2 明令不许一次性清零），不是本版引入的问题。',
    entries: weakTiers,
  }, null, 2) + '\n');
  console.log(`[method-audit] 基线已更新：死方法 ${deadMethods.length} 条 / 弱档模块 ${weakTiers.length} 件`);
  process.exit(0);
}

let rc = 0;
if (mRevived.length) {
  console.warn(`[method-audit] ${mRevived.length} 条基线方法已被重新消费，建议 --update 清理：`);
  for (const e of mRevived.slice(0, 8)) console.warn(`  ${e.rel}:${e.line} ${e.cls}.${e.name}`);
}
if (dImproved.length) {
  console.warn(`[method-audit] ${dImproved.length} 件基线模块已进入产品面，建议 --update 清理：`);
  for (const e of dImproved.slice(0, 8)) console.warn(`  ${e.rel}`);
}

if (mNew.length) {
  rc = 1;
  console.error(`[method-audit] ❌ ${mNew.length} 条死方法未登记（公开方法名在全仓除声明行外零出现）：`);
  for (const d of mNew.slice(0, 40)) {
    console.error(`  ${d.rel}:${d.line} ${d.cls}.${d.name}${d.classInstantiated ? '' : '（所属类从未被 new）'}`);
  }
  if (mNew.length > 40) console.error(`  … 其余 ${mNew.length - 40} 条`);
  console.error(`  修法：真接线 / 删方法 / 或写进 ${path.relative(ROOT, METHOD_BASELINE)} 并写明理由。`);
}

if (dNew.length) {
  rc = 1;
  console.error(`[method-audit] ❌ ${dNew.length} 件模块新增为弱档（产品端不 import）：`);
  for (const r of dNew.slice(0, 30)) {
    console.error(`  ${r.rel}  [${r.tier}]  importers=${r.importers.join(', ') || '无'}`);
  }
  console.error(`  修法：接到产品面 / 或写进 ${path.relative(ROOT, MODULE_BASELINE)}。`);
}

const tallyClass = { newed: 0, neverNewed: 0 };
for (const d of deadMethods) (d.classInstantiated ? tallyClass.newed++ : tallyClass.neverNewed++);
const tierTally = {};
for (const r of moduleRows) tierTally[r.tier] = (tierTally[r.tier] || 0) + 1;

console.log(`[method-audit] 扫描 ${raw.size} 文件 / ${classesWithMethods.length} 个带方法类 / ${publicEntries.length} 条公开方法`);
console.log(`[method-audit] 死方法 ${deadMethods.length}（类被 new 过 ${tallyClass.newed} / 类从未 new ${tallyClass.neverNewed}）/ 基线 ${(mBase.entries || []).length} / 新增 ${mNew.length}`);
console.log(`[method-audit] 模块入度 ${moduleRows.length} 件：${Object.entries(tierTally).map(([k, v]) => `${k}=${v}`).join(' / ')}；弱档 ${weakTiers.length} / 基线 ${(dBase.entries || []).length} / 新增 ${dNew.length}`);
process.exit(rc);