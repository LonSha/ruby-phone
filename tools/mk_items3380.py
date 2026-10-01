#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mk_items3380.py — 生成 v3.38.0 条目真源 tools/iter96_items.json（19 条，形态与 iter95 同）。
条目是**面向用户的变更说明**，也是 ITERATION_LOG 段的真源（由 gen_iter96_seg.py 生成）。
真源正文放在 tools/_blob3380.txt（用 %% 分隔）—— 因为终端 heredoc 对含大量引号与特殊字符的长文本
不可靠（本版写入时两次丢失列表元素的引号），改用无引号纯文本载体后一次成功。
纪律：
  · 19 条，每条形如【标题】正文；
  · **不许含方括号**（v324 门禁）；
  · 形态锚必须在场（版本升至 3.38.0（五源同源） / 本版自己抓到的真缺陷 / 交棒改写）。
"""
import json
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.38.0'
DATE = '2026-10-02'
SEP = chr(10) + '%%' + chr(10)
with open(os.path.join(ROOT, 'tools', '_blob3380.txt'), encoding='utf-8') as f:
    ITEMS = [x.strip() for x in f.read().split(SEP) if x.strip()]

assert len(ITEMS) == 19, '条目数必须为 19，实得 %d' % len(ITEMS)
for i, it in enumerate(ITEMS):
    assert it and it.startswith('【') and '】' in it, '第 %d 条必须形如【标题】正文' % (i + 1)
    assert '[' not in it and ']' not in it, '第 %d 条含方括号（v324 门禁）' % (i + 1)
    assert chr(10) not in it and chr(9) not in it, '第 %d 条含控制字符' % (i + 1)
joined = chr(10).join(ITEMS)
for marker in ['召回', '六态', '水位线', '融合', '注入']:
    assert marker in joined, '形态锚缺 marker：' + marker
assert '版本升至 ' + VER + '（五源同源）' in joined, '形态锚缺：本版落点'
assert '本版自己抓到的真缺陷' in joined, '形态锚缺：本版自己抓到的缺陷'
assert '交棒改写' in joined, '形态锚缺：交棒改写'
out = {'version': VER, 'date': DATE, 'items': ITEMS}
path = os.path.join(ROOT, 'tools', 'iter96_items.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write(chr(10))
print('生成 tools/iter96_items.json：%d 条 / %d 字节' % (len(ITEMS), os.path.getsize(path)))
for i, it in enumerate(ITEMS):
    print('  %2d. %s' % (i + 1, it[:44]))
