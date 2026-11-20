/**
 * tests/r26_o2_dependency_slimming.test.mjs — 只被测试引用清单与处置判据 [R26-O2]
 *
 * A1 待处置面只收 test-only / self-only / dormant；wired 不进清单
 * A2 未登记处置的项一律进 undisposed，且 ok=false
 * A3 三种处置都计入且有独立计数
 * A4 未知处置方式抛错（不许「先放着」）
 * A5 真仓：清单来自真实引用计数（条目数与能力清单的待处置档一致，不是手抄）
 * A6 真仓：readonly 读数自洽（总量 = 已处置 + 未处置）
 * A7 真仓：真的存在只被测试引用的模块（否则这条机制永远空跑）
 * A8 文案点名未处置项（说不出是谁等于没处置）
 * A9 自检为绿
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：未登记处置也算已处置 ⇒ 未处置被藏成 0（假绿）
 * N2 破坏副本：wired 也进待处置面 ⇒ 清单被灌水
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SLIM_DISPOSITIONS,
  SLIM_TARGET_STATES,
  buildSlimPlan,
  dependencySlimmingSelfCheck,
  slimPlanText,
} from '../config/dependency-slimming.js';
import { buildManifest, collectReferences } from '../config/capability-manifest.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'dependency-slimming.js'), 'utf8');

const MANIFEST = {
  entries: [
    { id: 'boot-budget', kind: 'config', state: 'wired' },
    { id: 'only-test', kind: 'config', state: 'test-only', reason: '仅测试引用' },
    { id: 'self-ref', kind: 'config', state: 'self-only', reason: '仅自身引用' },
    { id: 'ghost', kind: 'app', state: 'dormant', reason: '无任何引用' },
  ],
};

function readTree(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...readTree(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** 真仓现场（只读一次）。 */
const REPO = (() => {
  const apps = fs
    .readdirSync(path.join(ROOT, 'apps'))
    .filter((n) => fs.statSync(path.join(ROOT, 'apps', n)).isDirectory())
    .sort();
  const configModules = fs
    .readdirSync(path.join(ROOT, 'config'))
    .filter((n) => n.endsWith('.js'))
    .map((n) => n.slice(0, -3))
    .sort();
  const productSources = [fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')];
  for (const f of readTree(path.join(ROOT, 'apps'))) productSources.push(fs.readFileSync(f, 'utf8'));
  const testSources = fs
    .readdirSync(path.join(ROOT, 'tests'))
    .filter((n) => n.endsWith('.test.mjs'))
    .map((n) => fs.readFileSync(path.join(ROOT, 'tests', n), 'utf8'));
  const refs = collectReferences({ ids: [...apps, ...configModules], productSources, testSources });
  return buildManifest({ apps, configModules, refs });
})();

test('A1 待处置面只收三种状态', () => {
  assert.deepEqual([...SLIM_TARGET_STATES], ['test-only', 'self-only', 'dormant']);
  const plan = buildSlimPlan(MANIFEST, {});
  assert.deepEqual(plan.items.map((i) => i.id), ['only-test', 'self-ref', 'ghost']);
  assert.ok(!plan.items.some((i) => i.id === 'boot-budget'), 'wired 不进待处置面');
});

test('A2 未登记处置 ⇒ undisposed 且 ok=false', () => {
  const plan = buildSlimPlan(MANIFEST, {});
  assert.equal(plan.undisposed.length, 3);
  assert.equal(plan.disposed, 0);
  assert.equal(plan.ok, false);
});

test('A3 三种处置都计入且有独立计数', () => {
  assert.deepEqual([...SLIM_DISPOSITIONS], ['wired', 'exempt', 'remove']);
  const plan = buildSlimPlan(MANIFEST, {
    'only-test': { disposition: 'wired' },
    'self-ref': { disposition: 'exempt', note: '自身调自身，对外无入口' },
    ghost: { disposition: 'remove' },
  });
  assert.equal(plan.counts.wired, 1);
  assert.equal(plan.counts.exempt, 1);
  assert.equal(plan.counts.remove, 1);
  assert.equal(plan.disposed, 3);
  assert.equal(plan.ok, true);
});

test('A4 未知处置方式抛错', () => {
  assert.throws(() => buildSlimPlan(MANIFEST, { ghost: { disposition: 'later' } }), /未知处置方式/);
  assert.throws(() => buildSlimPlan(null, {}), /需要能力清单/);
});

test('A5 真仓：清单来自真实能力清单的待处置档', () => {
  const plan = buildSlimPlan(REPO, {});
  const expect = REPO.entries.filter((e) => SLIM_TARGET_STATES.includes(e.state)).length;
  assert.equal(plan.items.length, expect);
  assert.ok(expect > 0, '真仓应当存在待处置项');
});

test('A6 真仓：读数自洽（总量 = 已处置 + 未处置）', () => {
  const plan = buildSlimPlan(REPO, {});
  assert.equal(plan.items.length, plan.disposed + plan.undisposed.length);
  const c = plan.counts;
  assert.equal(c.wired + c.exempt + c.remove, plan.disposed);
  assert.equal(plan.ok, plan.undisposed.length === 0);
});

test('A7 真仓：确实存在「只被测试引用」的模块', () => {
  const onlyTest = REPO.entries.filter((e) => e.state === 'test-only');
  assert.ok(onlyTest.length > 0, '没有一条只被测试引用，说明扫描面或口径错了');
  for (const e of onlyTest) assert.equal(e.reason, '仅测试引用');
});

test('A8 文案点名未处置项', () => {
  const plan = buildSlimPlan(MANIFEST, { 'only-test': { disposition: 'wired' } });
  const text = slimPlanText(plan);
  assert.ok(text.includes('未处置 2 条'));
  assert.ok(text.includes('self-ref'), '未处置要点名');
  assert.ok(text.includes('接线 1'));
  assert.equal(slimPlanText(null), '瘦身清单：无读数（未生成）');
  const green = buildSlimPlan(MANIFEST, {
    'only-test': { disposition: 'wired' },
    'self-ref': { disposition: 'exempt' },
    ghost: { disposition: 'remove' },
  });
  assert.ok(slimPlanText(green).includes('没有未处置项'));
});

test('A9 自检为绿', () => {
  const r = dependencySlimmingSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*buildSlimPlan[^}]*\}\s*from\s*'\.\/config\/dependency-slimming\.js'/);
  assert.ok(/VirtualPhone\.dependencySlimming\s*=/.test(indexSrc), '瘦身清单必须挂诊断面');
  assert.ok(/['"]_r26O2['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O2');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_o2_${tag}_`));
  const file = path.join(dir, 'dependency-slimming.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：未登记处置也算已处置 ⇒ 未处置被藏成 0（假绿）', async () => {
  const broken = await loadMutant(
    [["const undisposed = items.filter((i) => i.disposition === null).map((i) => i.id);", 'const undisposed = [];']],
    'fakegreen'
  );
  const plan = broken.buildSlimPlan(MANIFEST, {});
  assert.equal(plan.undisposed.length, 0, '破坏后未处置消失（正说明真实现如实数出来）');
  assert.equal(plan.ok, true, '假绿：三条没处置也报绿');
});

test('N2 破坏：wired 也进待处置面 ⇒ 清单被灌水', async () => {
  const broken = await loadMutant(
    [["const SLIM_TARGET_STATES = Object.freeze(['test-only', 'self-only', 'dormant']);", "const SLIM_TARGET_STATES = Object.freeze(['test-only', 'self-only', 'dormant', 'wired']);"]],
    'water'
  );
  const plan = broken.buildSlimPlan(MANIFEST, {});
  assert.equal(plan.items.length, 4, '破坏后 wired 也进清单（正说明真实现只收三档）');
});