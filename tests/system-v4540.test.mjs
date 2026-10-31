/* ============================================================
 * tests/system-v4540.test.mjs — v4.54.0 · 第六期批次 F 手机侧两项验收
 *   - R6-X7 跨媒介互动连载
 *   - R6-X9 平行人生试玩场
 * ------------------------------------------------------------
 * 判据面：A 面 版本锚（v4.102.0 起只留 A1/A2/A4）
 *
 * v4.102.0 · 计划 R13-O3：serial-narrative 与 parallel-life 判定为 B 类退役
 * （能力由 replay-face-bridge + replayable-phone-program + branch-canon-contract
 *   + branch-contrast 在产品面承担，见 tests/audit/r6_kernel_disposition.tsv），
 * 两个内核文件已删除，故 A3（两模块 VERSION 常量）与 D1~D3（破坏这两个内核的
 * 负控制）一并删除 —— 判据不能指向不存在的源码。
 * 保留 A1/A2/A4：本版 4.54.0 的版本下界锚仍然有效，且它是「这一批出生就带版本闸」
 * 的历史事实，不该随模块退役一起消失。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.54.0';

function vnum(v) { return v.split('.').map(Number).reduce((a, b, i) => a + b * Math.pow(100, 2 - i), 0); }

/* ============================================================ */
/* A 面：版本锚与结构自证                                       */
/* ============================================================ */
test('A1: manifest.json 版本 >= BORN_V', () => {
  const man = JSON.parse(read('manifest.json'));
  assert.ok(vnum(man.version) >= vnum(BORN_V), `manifest version ${man.version} < ${BORN_V}`);
});

test('A2: index.js ST_PHONE_VERSION >= BORN_V', () => {
  const src = read('index.js');
  const m = src.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION not found');
  assert.ok(vnum(m[1]) >= vnum(BORN_V), `ST_PHONE_VERSION ${m[1]} < ${BORN_V}`);
});

test('A4: BORN_V 自锚', () => {
  assert.equal(BORN_V, '4.54.0');
});

/* ============================================================ */
/* B 面：R6-X7 跨媒介互动连载                                    */
/* ============================================================ */