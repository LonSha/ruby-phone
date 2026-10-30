#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 seg 第 4 条的形态词修成 bump 脚本认得的写法（恰中 1 次）。"""
import io

p = 'tools/iter226_seg.md'
s = io.open(p, encoding='utf-8').read()
old = '本版自己抓到的真缺陷：'
new = '本版自己抓到：'
n = s.count(old)
assert n == 1, 'anchor must hit exactly 1, got %d' % n
s = s.replace(old, new, 1)
with io.open(p, 'w', encoding='utf-8') as f:
    f.write(s)
print('rewritten, len=', len(s))
