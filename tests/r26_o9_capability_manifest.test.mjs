/**
 * tests/r26_o9_capability_manifest.test.mjs — 能力清单自生成判据 [R26-O9]
 *
 * A1 四档分类正确：产品面已接 / 仅测试 / 仅自身 / 无引用
 * A2 非 wired 项必须带理由，且理由只能出自闭集
 * A3 未知能力类型直接抛错（不许悄悄归到某一档）
 * A4 真仓：apps/ 下每个目录都进清单（数量对得上）
 * A5 真仓：config/ 模块进清单，且总数 = apps + config（不许漏也不许重）
 * A6 真仓：每项 state 合法、非 wired 必有 reason
 * A7 真仓：至少有一批 wired（清单不是「全黑」也不是「全绿」）
 * A8 文案给出四档计数与非 wired 点名
 * A9 自检为绿
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：仅测试引用也算 wired ⇒ test-only 塌成 wired（噪声被藏起来）
 * N2 破坏副本：非 wired 不给理由 ⇒ 无理由的 dormant 混进来
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CAPABILITY_KINDS,
  CAPABILITY_STATES,
  DORMANT_REASONS,
  buildManifest,
  capabilityManifestSelfCheck,
  collectReferences,
  manifestText,
  resolveKind,
} from '../config/capability-manifest.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'capability-manifest.js'), 'utf8');

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

/** 真仓现场（只读一次，几个真仓用例共用）。 */
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
  return { apps, configModules, manifest: buildManifest({ apps, configModules, refs }) };
})();

test('A1 四档分类正确', () => {
  assert.deepEqual([...CAPABILITY_KINDS], ['app', 'config']);
  assert.deepEqual([...CAPABILITY_STATES], ['wired', 'test-only', 'self-only', 'dormant']);
  const m = buildManifest({
    apps: ['wechat', 'gallery', 'ghost'],
    configModules: ['boot-budget'],
    refs: { wechat: { product: 2 }, gallery: { test: 3 }, ghost: {}, 'boot-budget': { self: 1 } },
  });
  const byId = Object.fromEntries(m.entries.map((e) => [e.id, e.state]));
  assert.equal(byId.wechat, 'wired');
  assert.equal(byId.gallery, 'test-only');
  assert.equal(byId.ghost, 'dormant');
  assert.equal(byId['boot-budget'], 'self-only');
});

test('A2 非 wired 项必须带理由，且理由出自闭集', () => {
  const m = buildManifest({ apps: ['a', 'b', 'c'], refs: { a: { test: 1 }, b: { self: 1 }, c: {} } });
  for (const e of m.entries) {
    assert.equal(typeof e.reason, 'string');
    assert.equal(e.reason, DORMANT_REASONS[e.state]);
  }
  const wired = buildManifest({ apps: ['d'], refs: { d: { product: 1 } } }).entries[0];
  assert.equal(wired.reason, null, 'wired 项不许挂 dormant 理由');
});

test('A3 未知能力类型直接抛错', () => {
  assert.equal(resolveKind('app'), 'app');
  assert.equal(resolveKind('config'), 'config');
  assert.throws(() => resolveKind('plugin'), /未知能力类型/);
  assert.throws(() => resolveKind(''), /未知能力类型/);
});

test('A4 真仓：apps/ 下每个目录都进清单', () => {
  assert.ok(REPO.apps.length > 50, `apps 目录数应当成规模，实测 ${REPO.apps.length}`);
  const entries = REPO.manifest.entries.filter((e) => e.kind === 'app');
  assert.equal(entries.length, REPO.apps.length, '目录数与清单条目数必须一致');
  for (const id of REPO.apps) assert.ok(entries.some((e) => e.id === id), `缺了 ${id}`);
});

test('A5 真仓：config 模块进清单且总数自洽', () => {
  assert.ok(REPO.configModules.length > 300, `config 模块数实测 ${REPO.configModules.length}`);
  assert.equal(REPO.manifest.total, REPO.apps.length + REPO.configModules.length);
  // app 与 config 允许同名（真仓里 `workflow` 就既是 app 目录又是 config 模块），
  // 所以唯一性按 kind+id 判；同 kind 内重复才是真重复。
  const keys = new Set(REPO.manifest.entries.map((e) => `${e.kind}:${e.id}`));
  assert.equal(keys.size, REPO.manifest.total, '同一 kind 下不许重复登记');
  const appIds = new Set(REPO.manifest.entries.filter((e) => e.kind === 'app').map((e) => e.id));
  assert.equal(appIds.size, REPO.apps.length);
});

test('A6 真仓：每项 state 合法、非 wired 必有 reason', () => {
  for (const e of REPO.manifest.entries) {
    assert.ok(CAPABILITY_STATES.includes(e.state), `${e.id} 的状态非法：${e.state}`);
    if (e.state !== 'wired') assert.ok(typeof e.reason === 'string' && e.reason.length > 0, `${e.id} 没有理由`);
  }
});

test('A7 真仓：至少有一批 wired，也至少有一批非 wired', () => {
  assert.ok(REPO.manifest.counts.wired > 0, '一条都没接上，说明扫描面错了');
  const rest = REPO.manifest.total - REPO.manifest.counts.wired;
  assert.ok(rest > 0, '全部 wired 反而要怀疑计数口径（真仓不可能零 dormant 面）');
  assert.equal(REPO.manifest.dormant.length, rest);
});

test('A8 文案给出四档计数与非 wired 点名', () => {
  const text = manifestText(REPO.manifest);
  assert.ok(text.includes('能力清单：共'));
  assert.ok(text.includes('已接'));
  assert.ok(text.includes('仅测试'));
  assert.ok(text.includes('无引用'));
  const first = REPO.manifest.entries.find((e) => e.state !== 'wired');
  if (first) assert.ok(text.includes(first.id), '非 wired 要点名');
  assert.equal(manifestText(null), '能力清单：无读数（未生成）');
});

test('A9 自检为绿', () => {
  const r = capabilityManifestSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*buildManifest[^}]*\}\s*from\s*'\.\/config\/capability-manifest\.js'/);
  assert.ok(/VirtualPhone\.capabilityManifest\s*=/.test(indexSrc), '能力清单必须挂诊断面');
  assert.ok(/['"]_r26O9['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O9');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_o9_${tag}_`));
  const file = path.join(dir, 'capability-manifest.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：仅测试引用也算 wired ⇒ test-only 塌成 wired', async () => {
  const broken = await loadMutant(
    [['    if (product > 0) state = \'wired\';\n    else if (test > 0) state = \'test-only\';', "    if (product > 0 || test > 0) state = 'wired';"]],
    'testaswired'
  );
  const m = broken.buildManifest({ apps: ['gallery'], refs: { gallery: { test: 3 } } });
  assert.equal(m.counts['test-only'], 0, '破坏后没有 test-only 档（正说明真实现单列）');
  assert.equal(m.counts.wired, 1, '被伪装成已接');
});

test('N2 破坏：非 wired 不给理由 ⇒ 无理由的 dormant 混进来', async () => {
  const broken = await loadMutant(
    [["reason: DORMANT_REASONS[state] || null", 'reason: state === \'dormant\' ? null : DORMANT_REASONS[state]']],
    'noreason'
  );
  const m = broken.buildManifest({ apps: ['ghost'], refs: {} });
  assert.equal(m.entries[0].state, 'dormant');
  assert.equal(m.entries[0].reason, null, '破坏后 dormant 没有理由（正说明真实现必须给理由）');
});