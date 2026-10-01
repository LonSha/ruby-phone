#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_iter95_seg.py — 由条目真源生成 tools/iter95_seg.md（插进 ITERATION_LOG.md 的段）。
形态（与 iter85~iter94 各段一致）：
  首行 '## 迭代 95 — v3.37.0 …'
  随后每段以 '- **【标题】正文**' 起头（条目里的【标题】提到段首加粗）。
"""
import io
import json
P = 'tools/iter95_items.json'
OUT = 'tools/iter95_seg.md'
d = json.load(open(P, encoding='utf-8'))
items = d['items']
assert d['version'] == '3.37.0', d['version']
HEAD = ('## 迭代 95 — v3.37.0 素材缝合路线图第 3 层第一件：白盒音效盒'
        '（六条合成配方 / 四条去处与试听台账 / 分享码只带配方 / 语音三件套读数面 / '
        '四处不缝一条没进）+ 起手抓四处真缺陷（含第九道门当场报红一处）+ '
        '判据侧九处自身错 + 抬版连带面收干（第 3 层开局）')
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
