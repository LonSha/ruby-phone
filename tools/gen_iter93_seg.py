#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_iter93_seg.py — 由条目真源生成 ITERATION_LOG.md 的迭代 93 段（零手抄）。"""
import json

raw = json.load(open('tools/iter93_items.json', encoding='utf-8'))
items = raw['items']
for i, it in enumerate(items):
    assert '[' not in it and ']' not in it, '第 %d 条含方括号（v324 门禁：公告块不得含方括号）' % (i + 1)

TITLE = ('## 迭代 93 — v3.35.0 素材缝合路线图第 2 层第六件：Pixiv 落地'
         '（插画登记面 / 小说与滑窗 / 确定性心数 / 评论楼中楼与三态 / 检索与四格 / 出图要求文本）'
         '+ 起手抓十二处真缺陷（含门禁当场抓到的两处） + 判据侧六处自身错 + 抬版连带面收干')

lines = [TITLE]
for it in items:
    assert it.startswith('【') and '】' in it, '条目必须形如【标题】正文'
    head, body = it[1:].split('】', 1)
    lines.append('- **' + head + '**：' + body)

seg = '\n'.join(lines) + '\n'
open('tools/iter93_seg.md', 'w', encoding='utf-8').write(seg)
print('生成 tools/iter93_seg.md：%d 行（%d 条）' % (seg.count('\n'), len(items)))
print('首行：', lines[0][:80])
print('末条头：', items[-1][:40])