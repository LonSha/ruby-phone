#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fixv3350_test.py — 扫 tests/system-v3350.test.mjs 里的「相邻字符串字面量缺 +」。

JS 不像 Python/C 支持隐式字符串拼接：`"a" "b"` 是语法错。
本仓测试文件里写多行破坏串时容易漏 `+`，这里一次扫清。
判据：某行 strip 后形如  "...."  或  '....'  （纯字面量、行末是引号）
      且下一行 strip 后也以引号开头
      且本行行末不是 `+` / `,` / `)` / `;`
则嫌疑。
"""
import io
import re
import sys
import ast

P = 'tests/system-v3350.test.mjs'

s = open(P, encoding='utf-8').read()
if not s.endswith('\n'):
    s += '\n'
lines = s.split('\n')

# 纯字符串字面量行：开头一个或多个空白 + 引号开始 + 行末引号结束（无分号逗号）
lit_re = re.compile(r'^(\s*)(["\']).*\2$')

hits = []
for i in range(len(lines) - 1):
    a = lines[i]
    b = lines[i + 1]
    ma = lit_re.match(a.rstrip())
    if not ma:
        continue
    if not b.lstrip().startswith(('"', "'")):
        continue
    if a.rstrip().endswith('+'):
        continue
    hits.append(i)

print('=== 嫌疑行数:', len(hits), '===')
for i in hits:
    print('  line', i + 1, ':', repr(lines[i][:100]))

if not hits:
    print('无嫌疑行，文件已是规范形态')
    sys.exit(0)

for i in hits:
    lines[i] = lines[i].rstrip() + ' +'
    print('  已补 + : line', i + 1)

open(P, 'w', encoding='utf-8').write('\n'.join(lines))
print('OK 写入完成')
