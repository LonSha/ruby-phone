#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_iter94_seg.py — 由条目真源生成 `tools/iter94_seg.md`（插进 ITERATION_LOG.md 的段）。

形态（与 iter85~iter93 各段一致）：
  首行 `## 迭代 94 — v3.36.0 …`
  随后每段以 `- **【标题】正文**` 起头（条目里的【标题】提到段首加粗）。
"""
import io
import json

P = 'tools/iter94_items.json'
OUT = 'tools/iter94_seg.md'
d = json.load(open(P, encoding='utf-8'))
items = d['items']
assert d['version'] == '3.36.0', d['version']

HEAD = ('## 迭代 94 — v3.36.0 素材缝合路线图第 2 层第七件（末件）：杂志落地'
        '（十型稿件 / 十套解析提成唯一实现 / 期号是事实不是位置 / 关系图与受访者两处兜底 / '
        '四套导出与译文段落化）+ 起手抓三处真缺陷（含门禁当场抓到两处）+ 判据侧十处自身错 + '
        '抬版连带面收干（第 2 层至此全部完成）')

lines = [HEAD]
for it in items:
    s = it.strip()
    assert s.startswith('【'), '条目必须形如【标题】正文：' + s[:30]
    end = s.index('】')
    title = s[1:end]
    body = s[end + 1:].strip()
    lines.append('- **【' + title + '】**' + body)
text = '\n'.join(lines) + '\n'
io.open(OUT, 'w', encoding='utf-8').write(text)
print('生成 %s：%d 行（%d 条）' % (OUT, len(lines), len(items)))
print('首行：', lines[0][:60])
print('末条头：', lines[-1][:40])