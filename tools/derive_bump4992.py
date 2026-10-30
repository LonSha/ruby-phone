#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 bump_v4991.py 逐字派生 bump_v4992.py：只换头注与 STEPS，逻辑一字不改。"""
import io
import re

src = io.open('tools/bump_v4991.py', encoding='utf-8').read()

# 1) 换头注 docstring
old_doc = '抬 v4.99.1（五源同源，单版）—— R11-X6：中枢通知接进通知中心，顺手抓到一条「开关拨了没反应」的真缺陷（免打扰字符串优先级 NaN 比较）。'
new_doc = '抬 v4.99.2（五源同源，单版）—— R11-X1：人物档案面（背包 / 档案 / 卷宗）接进群像 App，补上三件管理器的持久化（此前键有登记、零写入方）。'
n = src.count(old_doc)
assert n == 1, 'doc anchor must hit exactly 1, got %d' % n
src = src.replace(old_doc, new_doc, 1)

# 2) 换范式来源说明里的上一版脚本名
old_par = '范式逐条沿用 tools/bump_v4970.py'
assert src.count(old_par) == 1, 'paradigm anchor must hit exactly 1'
src = src.replace(old_par, '范式逐条沿用 tools/bump_v4991.py', 1)

# 3) 换 STEPS
old_steps = "STEPS = [\n    ('4.99.1', '2026-10-30', '4.99.0', 'tools/iter225_seg.md', 225),\n]"
new_steps = "STEPS = [\n    ('4.99.2', '2026-10-30', '4.99.1', 'tools/iter226_seg.md', 226),\n]"
n = src.count(old_steps)
assert n == 1, 'STEPS anchor must hit exactly 1, got %d' % n
src = src.replace(old_steps, new_steps, 1)

with io.open('tools/bump_v4992.py', 'w', encoding='utf-8') as f:
    f.write(src)
print('derived tools/bump_v4992.py, len=', len(src))
