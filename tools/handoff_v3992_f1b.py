#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""handoff_v3992_f1b.py — 用行区间精确替换 v3992 的 F1（不靠长锚点逐字匹配）。

F1 原为当版硬锁（latest === 3.99.2），抬到 4.00.0 前必须交棒为历史档形。
"""
import io

p = '/home/user/ruby-phone/tests/system-v3992.test.mjs'
lines = io.open(p, encoding='utf-8').read().split('\n')

start = None
end = None
for i, ln in enumerate(lines):
    if ln.startswith("test('F1 五源同源"):
        start = i
    if start is not None and ln == '});' and i > start:
        end = i
        break
assert start is not None and end is not None, 'F1 block not found: %s %s' % (start, end)
print('F1 lines %d..%d' % (start + 1, end + 1))
print('--- old ---')
print('\n'.join(lines[start:end + 1]))

new_block = """test('F1 历史档（v4.00.0 起交棒为下限形）：3.99.2 台账条目仍在 + 迭代 158 段不可抹 + 改动面在场 + 入口版本不低于 3.99.2', () => {
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

out = lines[:start] + new_block.split('\n') + lines[end + 1:]
io.open(p, 'w', encoding='utf-8').write('\n'.join(out))
print('written OK')