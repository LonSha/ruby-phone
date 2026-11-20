/**
 * tests/r26_o7_i18n_coverage.test.mjs — 两包对等 + 缺键面判据 [R26-O7]
 *
 * A1 期望键由闭集规则生成（核心键 + 每 App 的 name/empty），不手抄
 * A2 两包齐全：parityOk 且零缺口
 * A3 一包少一个键：缺口精确到「哪个 locale 的哪个 App 的哪个键」，且判两包不等
 * A4 孤儿键（另一包多出来的键）同样要被判出来（双向差集）
 * A5 只有一个语言包时不假装「两包对等」（parity 为空数组，文案不许说两包）
 * A6 没有任何语言包时：不编 per-locale 缺口，但文案必须说「全部键都缺」
 * A7 真 App 面接入：`config/apps.js` 的 APPS 能喂进审计（id 唯一、数量 > 0）
 * A8 文案列出前几处缺口（定位不靠猜）
 * A9 自检为绿
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：包间对等只比单向 ⇒ 孤儿键漏判
 * N2 破坏副本：App 键匹配规则失效 ⇒ 缺口塌成 0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  APP_KEY_SUFFIXES,
  CORE_KEYS,
  auditI18nCoverage,
  expectedKeys,
  i18nCoverageSelfCheck,
  i18nCoverageText,
} from '../config/i18n-coverage.js';
import { APPS } from '../config/apps.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'i18n-coverage.js'), 'utf8');

const APPS2 = ['wechat', 'gallery'];
const fullPack = (prefix) => ({
  'common.ok': prefix + 'ok',
  'common.cancel': prefix + 'cancel',
  'common.retry': prefix + 'retry',
  'app.wechat.name': prefix + 'wechat',
  'app.wechat.empty': prefix + 'wechat-empty',
  'app.gallery.name': prefix + 'gallery',
  'app.gallery.empty': prefix + 'gallery-empty',
});

test('A1 期望键由闭集规则生成', () => {
  const keys = expectedKeys(APPS2);
  assert.deepEqual([...CORE_KEYS], ['common.ok', 'common.cancel', 'common.retry']);
  assert.deepEqual([...APP_KEY_SUFFIXES], ['name', 'empty']);
  assert.equal(keys.length, CORE_KEYS.length + APPS2.length * APP_KEY_SUFFIXES.length);
  assert.ok(keys.includes('app.wechat.name') && keys.includes('app.gallery.empty'));
  assert.deepEqual(expectedKeys([]), [...CORE_KEYS]);
  assert.deepEqual(expectedKeys(APPS2), expectedKeys(APPS2), '同输入必须同序（可逐字对拍）');
});

test('A2 两包齐全：对等且零缺口', () => {
  const r = auditI18nCoverage({ 'zh-CN': fullPack('zh-'), 'en-US': fullPack('en-') }, APPS2);
  assert.deepEqual(r.locales, ['zh-CN', 'en-US']);
  assert.equal(r.parityOk, true);
  assert.deepEqual(r.gaps, []);
  assert.deepEqual(r.coreGaps, []);
  assert.equal(r.summary.gapCount, 0);
  assert.match(i18nCoverageText(r), /齐全/);
});

test('A3 少一个键：精确到 locale + App + 键，并判两包不等', () => {
  const zh = fullPack('zh-');
  delete zh['app.gallery.empty'];
  const r = auditI18nCoverage({ 'zh-CN': zh, 'en-US': fullPack('en-') }, APPS2);
  assert.equal(r.parityOk, false);
  const hit = r.gaps.find((g) => g.locale === 'zh-CN' && g.appId === 'gallery' && g.key === 'app.gallery.empty');
  assert.ok(hit, `缺口必须精确到 App + 键：${JSON.stringify(r.gaps)}`);
  assert.ok(!r.gaps.some((g) => g.locale === 'en-US'), '英文包不缺，不该被算进缺口');
  assert.equal(r.perLocale['zh-CN'].coverRate < 1, true);
  assert.equal(r.perLocale['en-US'].coverRate, 1);
});

test('A4 孤儿键（另一包多出来的键）也要判出来', () => {
  const en = fullPack('en-');
  en['app.wechat.legacy'] = 'old';
  const r = auditI18nCoverage({ 'zh-CN': fullPack('zh-'), 'en-US': en }, APPS2);
  assert.equal(r.parityOk, false, '双向差集：多出来的键也是不等');
  const pair = r.parity[0];
  assert.ok(pair.missingInA.includes('app.wechat.legacy'), '孤儿键必须落在 missingInA（A=zh-CN 没有它）');
});

test('A5 单包不假装「两包对等」', () => {
  const r = auditI18nCoverage({ 'zh-CN': fullPack('zh-') }, APPS2);
  assert.deepEqual(r.parity, [], '只有一个包时没有「对」，不许凭空造一条 same=true');
  assert.deepEqual(r.gaps, []);
  const text = i18nCoverageText(r);
  assert.ok(!text.includes('两包'), '单包文案不许提两包');
});

test('A6 无语言包：不编 per-locale 缺口，但文案说清全缺', () => {
  const r = auditI18nCoverage({}, APPS2);
  assert.deepEqual(r.locales, []);
  assert.deepEqual(r.gaps, []);
  assert.match(i18nCoverageText(r), /没有任何语言包/);
  assert.match(i18nCoverageText(r), /全部键都缺/);
});

test('A7 真 App 面可喂（id 唯一、数量 > 0）', () => {
  const ids = APPS.map((a) => (a && a.id ? String(a.id) : null)).filter(Boolean);
  assert.ok(ids.length > 0, 'APPS 解析不出 id');
  assert.equal(new Set(ids).size, ids.length, 'App id 必须唯一');
  const keys = expectedKeys(ids);
  assert.equal(keys.length, CORE_KEYS.length + ids.length * APP_KEY_SUFFIXES.length);
  // 真仓现状：没有任何语言包 ⇒ 全缺且文案直说
  const r = auditI18nCoverage({}, ids);
  assert.deepEqual(r.locales, []);
  assert.equal(r.apps, ids.length);
});

test('A8 文案列出前几处缺口', () => {
  const r = auditI18nCoverage({ 'zh-CN': {}, 'en-US': fullPack('en-') }, APPS2);
  const text = i18nCoverageText(r);
  assert.match(text, /缺 \d+ 键/);
  assert.match(text, /zh-CN:/, '必须点名是哪个语言包缺的');
  assert.match(text, /两包键集合不等/);
});

test('A9 自检为绿', () => {
  const r = i18nCoverageSelfCheck();
  assert.deepEqual(r.bad, [], JSON.stringify(r.bad));
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*auditI18nCoverage[^}]*\}\s*from\s*'\.\/config\/i18n-coverage\.js'/);
  assert.ok(/VirtualPhone\.i18nCoverage\s*=/.test(indexSrc), '覆盖审计面必须挂诊断面');
  assert.ok(/['"]_r26O7['"]/.test(indexSrc), '自检必须进启动自检总表 _r26O7');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_o7_${tag}_`));
  const file = path.join(dir, 'i18n-coverage.js');
  fs.writeFileSync(file, text, 'utf8');
  // 同目录补上依赖闭包：i18n.js → num-gate.js（num-gate 自身无依赖）
  // 一级依赖漏拷会直接 ERR_MODULE_NOT_FOUND，负控制变成「加载失败」而不是「判据真红」
  for (const leaf of ['i18n.js', 'num-gate.js']) {
    fs.copyFileSync(path.join(ROOT, 'config', leaf), path.join(dir, leaf));
  }
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：对等只比单向 ⇒ 孤儿键漏判（证明 A4 靠双向差集）', async () => {
  const broken = await loadMutant(
    [['      const d = keyDiff(p[a] || {}, p[b] || {});', '      const d = { missingInA: [], missingInB: keyDiff(p[a] || {}, p[b] || {}).missingInB, same: false };']],
    'oneway'
  );
  const en = fullPack('en-');
  en['app.wechat.legacy'] = 'old';
  const r = broken.auditI18nCoverage({ 'zh-CN': fullPack('zh-'), 'en-US': en }, APPS2);
  assert.deepEqual(r.parity[0].missingInA, [], '单向比较后孤儿键不再被点名（正说明真实现是双向的）');
});

test('N2 破坏：App 键匹配规则失效 ⇒ 缺口塌成 0（证明 A3 不是空过）', async () => {
  const broken = await loadMutant(
    [['        const m = /^app\\.(.+)\\.(name|empty)$/.exec(key);', '        const m = null;']],
    'nogap'
  );
  const zh = fullPack('zh-');
  delete zh['app.gallery.empty'];
  const r = broken.auditI18nCoverage({ 'zh-CN': zh, 'en-US': fullPack('en-') }, APPS2);
  assert.equal(r.gaps.length, 0, '规则失效后缺口塌成 0（正说明真实现靠这条正则定位 App）');
  assert.equal(r.coreGaps.length, 1, '缺的那个键会退化成「核心键缺」，定位信息丢失');
});