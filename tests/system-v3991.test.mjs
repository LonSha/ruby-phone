/**
 * system-v3991.test.mjs — v3.99.1 · R3-O9 视图收口（版本锚档）
 *
 * 【本版定位】v3.99.0 首轮交付后，源码复核发现两处「内核对、视图错」的真实缺陷：
 *   ① 视图按 rows 原序做成员过滤，内核 DF_CARD_ORDER 确定排序没有落到 _html 输出；
 *   ② 全部卡隐藏时分组条件（两档非空）不成立，视图回落原始卡列表——已隐藏卡被重显、
 *      恢复按钮消失。本版只修 taskentry-view.js（投影顺序 + 分组条件 + 缺字文案），
 *   行为层判据在 tests/system-v3990.test.mjs 的 E0 组（真 _html 输出验证 + 负控制）。
 * 本文件是当版版本锚档：锁五源同源为 3.99.1。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const IDX = read('index.js');

test('E1 五源同源：3.99.1 落齐（常量 / 台账 / 包描述 / 迭代日志 / 视图收口在场）', () => {
    const VER = '3.99.1';
    assert.ok(IDX.includes("const ST_PHONE_VERSION = '" + VER + "';"), '入口常量');
    assert.ok(read('manifest.json').includes('"version": "' + VER + '"'), 'manifest');
    assert.ok(read('package.json').includes('"version": "' + VER + '"'), 'package.json');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, VER);
    assert.equal(ul.head, VER);
    assert.ok(ul.versions[VER], '台账必须有当版条目');
    assert.ok(Array.isArray(ul.versions[VER].items) && ul.versions[VER].items.length >= 8);
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')));
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 157 '), '迭代日志必须有当版段');
    /* 本版改动面在场（视图收口真改动，不是只抬数字）： */
    const view = read('apps/taskentry/taskentry-view.js');
    assert.ok(view.includes('const brief = (fo.focus || []).map(function (x) { return byId[x.id]; }).filter(Boolean);'), '顺序投影写法在场');
    assert.ok(view.includes('if (fo.ok) {'), '分组条件只看 fo.ok');
    assert.ok(view.includes('>恢复显示<') && !view.includes('>恢显示<'), '文案完整');
});
