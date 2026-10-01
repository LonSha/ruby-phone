#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_iter93_brackets.py — 条目真源不许含方括号（v324 门禁：公告块不得含方括号）。

含方括号的是正则写法 `[^&]` / `[^)]*` 这类。改用**文字描述**替代字面量，
语义不变（条目本来就是在讲「源用了什么写法」，写成文字更清楚）。
"""
import json

P = 'tools/iter93_items.json'
d = json.load(open(P, encoding='utf-8'))
items = d['items']

REPL = [
    ('源用 `[^&]` 匹配已转义标签的属性段', '源用一个「非与号」字符类匹配已转义标签的属性段'),
    ('E1 的拆包正则用 `[^)]*`', 'E1 的拆包正则用「非右括号的任意字符」写法'),
]

changed = 0
for i, it in enumerate(items):
    new = it
    for a, b in REPL:
        if a in new:
            new = new.replace(a, b)
            changed += 1
    items[i] = new

bad = [i + 1 for i, x in enumerate(items) if '[' in x or ']' in x]
print('替换处数 =', changed)
print('仍含方括号的条目 =', bad)
if bad:
    for i in bad:
        it = items[i - 1]
        pos = [j for j, ch in enumerate(it) if ch in '[]']
        for j in pos:
            print('  第 %d 条 @%d: %s' % (i, j, it[max(0, j - 40):j + 40]))
    raise SystemExit(1)

json.dump(d, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(P, 'a', encoding='utf-8').write('\n')
print('OK 写入完成，条数 =', len(items))