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

/* [v3.99.2 交棒] 当版五源读数已交棒给 tests/system-v3992.test.mjs 的 F1/F2；
 * 本组只锁三件不随抬版漂移的事实（v3990→v3991 交棒同法）。 */
test('E1 历史档：3.99.1 台账条目仍在 + 迭代段不可抹 + 视图收口在场 + 入口版本不低于 3.99.1', () => {
    const VER = '3.99.1';
    const ul = JSON.parse(read('update-log.json'));
    assert.ok(ul.versions[VER], '3.99.1 台账条目必须保留（历史不抹）');
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 157 '), '迭代 157 段不可抹');
    const view = read('apps/taskentry/taskentry-view.js');
    assert.ok(view.includes('const brief = (fo.focus || []).map(function (x) { return byId[x.id]; }).filter(Boolean);'), '顺序投影写法在场');
    assert.ok(view.includes('if (fo.ok) {'), '分组条件只看 fo.ok');
    assert.ok(view.includes('>恢复显示<') && !view.includes('>恢显示<'), '文案完整');
    const cur = (IDX.match(/const ST_PHONE_VERSION = '(\d+\.\d+\.\d+)';/) || [])[1] || '0.0.0';
    const cmp = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); } return 0; };
    assert.ok(cmp(cur, VER) >= 0, '入口版本不得低于 3.99.1（实测 ' + cur + '）');
});
