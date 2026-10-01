#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_iter94_brackets.py — 条目真源不许含方括号（v324 门禁：公告块不得含方括号）。

第 8 条里的 `[\\*\\#\\s]*` 与第 10 条里的 `['']` 都是**正则 / 字面量写法**，
改用文字描述替代 —— 语义不变（条目本来就在讲「源用了什么写法」，写成文字更清楚）。
"""
import json

P = 'tools/iter94_items.json'
d = json.load(open(P, encoding='utf-8'))
items = d['items']

REPL = [
    ('正则的 `[\\*\\#\\s]*` 会吃掉',
     '正则的行首星号井号空白字符类会吃掉'),
    ('空正文 `split(\'\\n\')` 得 `[\'\']` ⇒ 产一个 `gap` 块',
     '空正文按行切开后得一个只含空串的单元素数组 ⇒ 产一个 `gap` 块'),
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
        for j, ch in enumerate(it):
            if ch in '[]':
                print('  第 %d 条 @%d: %s' % (i, j, it[max(0, j - 40):j + 40]))
    raise SystemExit(1)

json.dump(d, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
open(P, 'a', encoding='utf-8').write('\n')
print('OK 写入完成，条数 =', len(items))