#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_iter96_seg.py — 由条目真源生成 tools/iter96_seg.md（插进 ITERATION_LOG.md 的段）。
形态（与 iter85~iter95 各段一致）：
  首行 '## 迭代 96 — v3.38.0 …'
  随后每段以 '- **【标题】正文**' 起头（条目里的【标题】提到段首加粗）。
"""
import io
import json
P = 'tools/iter96_items.json'
OUT = 'tools/iter96_seg.md'
d = json.load(open(P, encoding='utf-8'))
items = d['items']
assert d['version'] == '3.38.0', d['version']
HEAD = ('## 迭代 96 — v3.38.0 素材缝合路线图第 3 层第二件：召回治理台'
        '（四路治理内核 / 六态互不同形 / 失败批次不推进水位线 / 逐路报贡献 / '
        '四因分野的注入裁决 / 四块不缝一条没进）+ 抓五处真缺陷（起手两处 + 全链首跑三处）+ '
        '判据侧三处自身错 + 抬版连带面收干（第 3 层第二件）')
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
