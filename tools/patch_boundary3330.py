#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v3.33.0 复校段插到边界文档里 v3.32.0 复校段之前（按行定位，不做整段匹配）。
纪律：锚点必须恰中 1 次；只插一行；插完断言新版标记与旧版标记都在场。
"""
import io
import os
import sys
ROOT = '/home/user/ruby-phone'
DOC = os.path.join(ROOT, 'docs', 'runtime-verification-boundary.md')
SEG = os.path.join(ROOT, 'tools', 'boundary_seg_v3330.md')
anchor = '- **v3.32.0 复校（素材缝合第 2 层第四件 · 游戏厅上半：海龟汤 + 你说我猜）**'
doc = io.open(DOC, encoding='utf-8').read()
seg = io.open(SEG, encoding='utf-8').read().rstrip('\n')
assert seg.startswith('- **v3.33.0 复校（素材缝合第 2 层第四件 · 游戏厅下半'), '段必须以 v3.33.0 复校起头'
assert '\n' not in seg, '段必须是单行（文档结构按行）'
n = doc.count(anchor)
assert n == 1, '锚点必须恰中 1 次，实得 %d' % n
doc = doc.replace(anchor, seg + '\n' + anchor, 1)
assert doc.count('- **v3.33.0 复校（') == 1
assert doc.count('- **v3.32.0 复校（') == 1
assert doc.count('**v3.33.0 复校**') == 1, '题头处该恰好出现一次 v3.33.0 复校标记'
if '--write' not in sys.argv:
    print('dry-run：将插入 %d 字符，文档 %d → %d 字符' % (len(seg), len(doc) - len(seg) - 1, len(doc)))
    sys.exit(0)
io.open(DOC, 'w', encoding='utf-8').write(doc)
print('已写入：文档 %d 字符' % len(doc))