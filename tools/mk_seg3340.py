#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mk_seg3340.py — 由 tools/iter92_items.json 生成 tools/iter92_seg.md（与历史各版同形）。

形态（iter91_seg.md 逐字对齐）：
  第一行：`## 迭代 92 — v3.34.0 <标题>`
  其后每段：`- **【内小标题】**：正文`（把条目首部的【…】折成粗体小标题）
不动条目原文（正文逐字搬），只在排版上折一次。
"""
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'iter92_items.json')
DST = os.path.join(ROOT, 'tools', 'iter92_seg.md')

HEAD = ('## 迭代 92 — v3.34.0 素材缝合路线图第 2 层第五件：老福特落地（短文流 / 长篇合集与滑窗 / '
        '评论楼中楼 / 关注订阅四格与阅读面 / 文风库）+ 起手抓八处真缺陷 + 判据侧七处自身错 + 抬版连带面收干')

raw = json.loads(io.open(SRC, encoding='utf-8').read())
assert raw.get('version') == '3.34.0', raw.get('version')
items = raw['items']
assert isinstance(items, list) and len(items) == 19, len(items)

lines = [HEAD]
for i, it in enumerate(items):
    assert '\n' not in it and '\t' not in it, '第 %d 段含控制字符' % (i + 1)
    m = re.match(r'^【([^】]+)】(.*)$', it)
    assert m, '第 %d 段必须形如【标题】正文' % (i + 1)
    head, body = m.group(1), m.group(2)
    lines.append('- **%s**：%s' % (head, body.lstrip()))

out = '\n'.join(lines) + '\n'
io.open(DST, 'w', encoding='utf-8').write(out)
print('写入 %s（%d 段 / %d 字符）' % (DST, len(items), len(out)))
