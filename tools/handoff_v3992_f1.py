#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""handoff_v3992_f1.py — v4.00.0 抬版前把 v3992 的 F1 从「当版硬锁」交棒为「历史档形」。

原 F1 断言 latest === '3.99.2'，抬到 4.00.0 后必然转红（这不是放宽，而是
本仓的抬版范式：上一版的当版硬锁必须改写为历史档 —— 锁台账条目仍在、
迭代 158 段不可抹、改动面符号仍在、入口版本不低于 3.99.2）。
"""
import io

p = '/home/user/ruby-phone/tests/system-v3992.test.mjs'
s = io.open(p, encoding='utf-8').read()

old = """test('F1 五源同源：3.99.2 落齐（常量 / 台账 / 包描述 / 迭代日志 / 改动面在场）', () => {
    const VER = '3.99.2';
    const IDX = read('index.js');
    assert.ok(IDX.includes("const ST_PHONE_VERSION = '" + VER + "'"), '入口常量');
    assert.ok(read('manifest.json').includes('"version": "' + VER + '"'), 'manifest');
    assert.ok(read('package.json').includes('"version": "' + VER + '"'), 'package.json');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, VER);
    assert.equal(ul.head, VER);
    assert.ok(ul.versions[VER], '台账必须有当版条目');
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')));
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 158 '), '迭代日志必须有当版段');
    assert.ok(read(DATA_REL).includes('contentHashOf'), '改动面：指纹在场');
    assert.ok(read(APP_REL).includes('findReusable'), '改动面：重接在场');
});"""

new = """test('F1 历史档（v4.00.0 起交棒为下限形）：3.99.2 台账条目仍在 + 迭代 158 段不可抹 + 改动面在场 + 入口版本不低于 3.99.2', () => {
    const VER = '3.99.2';
    const ul = JSON.parse(read('update-log.json'));
    assert.ok(ul.versions[VER], '3.99.2 台账条目必须保留（历史不可抹）');
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')), '当版收尾条目必须留在台账里');
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 158 '), '迭代 158 段不可抹');
    assert.ok(read(DATA_REL).includes('contentHashOf'), '改动面：指纹仍在');
    assert.ok(read(APP_REL).includes('findReusable'), '改动面：重接仍在');
    /* 下限形：不再锁 latest === 3.99.2（v4.00.0 已接管），只锁「入口版本不低于本版」。 */
    const cur = (read('index.js').match(/const ST_PHONE_VERSION = '(\\d+\\.\\d+\\.\\d+)';/) || [])[1] || '0.0.0';
    const cmp = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); } return 0; };
    assert.ok(cmp(cur, VER) >= 0, '入口版本不得低于 3.99.2（实测 ' + cur + '）');
});"""

assert s.count(old) == 1, 'anchor %d' % s.count(old)
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('OK')