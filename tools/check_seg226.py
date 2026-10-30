#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 seg 是否满足 bump 脚本的形态锚与禁用字符约束。

锚词必须是**正则 OR**（与 bump 脚本逐字同口径），不能把
'甲|乙|丙' 当字面子串去 count —— 那种写法怎么查都是 0，
是判据自己写错的假红（不是文件写错）。
"""
import io
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'tools/iter226_seg.md'
s = io.open(path, encoding='utf-8').read()
items = [l for l in s.split(chr(10)) if l.startswith('- ')]

ANCHORS = [
    ('version', '版本升至'),
    ('closing', '五源同源'),
    ('flaw', '自己抓到的缺陷|本版自己抓到|缺陷形态'),
    ('handoff', '交棒改写|主动改写|下限形|不做：'),
    ('runtime', '运行时验证边界'),
]
print('items:', len(items))
ok = True

for name, pat in ANCHORS:
    hit = [i for i, it in enumerate(items) if re.search(pat, it)]
    print('  %-9s items-hit=%s' % (name, hit))
    if not hit:
        ok = False

for ch in ['[', ']', chr(92)]:
    bad = [i for i, l in enumerate(items) if ch in l]
    print('banned %r in items: %s' % (ch, bad))
    if bad:
        ok = False

print('SEG-OK' if ok else 'SEG-BAD')