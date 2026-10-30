#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v4.99.2 重抬的准备：改文档两行读数 + 改 seg（补交棒改写形态锚）。

纪律依据：抬版后要改判据/文档，必须回滚 7 源 + docs 头部 sed 回上一版再重抬，
否则 bump 的 once 锚点（docs 头部 `**v4.99.1 复校**`）命中 0 次。
本脚本**只改正文与 seg**，7 源回滚与重抬由 shell 步骤完成。
"""
import io

DOC = 'docs/runtime-verification-boundary.md'
doc = io.open(DOC, encoding='utf-8').read()

# 1) 文档两行读数：1080 -> 1082 文件、632 -> 633 文件 / 1054 -> 1055 条
pairs = [
    ('- 语法 1080 文件', '- 语法 1082 文件'),
    ('- 导入 632 文件 1054 条', '- 导入 633 文件 1055 条'),
]
for old, new in pairs:
    n = doc.count(old)
    assert n == 1, 'doc line anchor must hit exactly 1, got %d for %r' % (n, old)
    doc = doc.replace(old, new, 1)
io.open(DOC, 'w', encoding='utf-8').write(doc)
print('[doc] 两行读数已改：1082 文件 / 633 文件 1055 条')

# 2) seg 第 10 条补上真实读数，并把第 12 条改成「交棒改写」形态锚 + 保留「不做：」
SEG = 'tools/iter226_seg.md'
seg = io.open(SEG, encoding='utf-8').read()

old10 = '使枚举面加一：语法门 1080 到 1081 个文件、导入门 632 到 633 个文件 1054 到 1055 条（新桥无外部依赖、新套件新增一条相对导入）'
assert seg.count(old10) == 1, 'seg item10 anchor must hit exactly 1'
new10 = '使枚举面加一：语法门 1080 到 1082 个文件（新桥 + 新套件）、导入门 632 到 633 个文件 1054 到 1055 条（新桥无外部依赖、新套件新增一条相对导入）'
seg = seg.replace(old10, new10, 1)

old12_head = '- 【不做：R11-X2（交易与资产面）'
assert seg.count(old12_head) == 1, 'seg item12 head must hit exactly 1'
new12_head = '- 【交棒改写 + 不做：R11-X2（交易与资产面）'
seg = seg.replace(old12_head, new12_head, 1)

# 在交棒改写那条里补上具体改写说明（不钉某版专有词，写清是哪条判据与为什么）
old_tail = '】\n'
assert seg.endswith(old_tail), 'seg must end with the closing bracket'
seg = seg[:-len(old_tail)] + '【本版交棒改写一处：tests/system-v328.test.mjs 的 C1 与 v4992 抬版后的 E1/E2/G3 同族判据原本按上一版边界文档的语法门读数（1080 文件）与「不做」单形态锚核定，本版新增一个桥文件与一个套件后真跑读数变为 1082 文件、导入门 633 文件 1055 条，判据改按当版真跑取数（不写死数字、改为现取现比），并同步在边界文档两行改写；这不是放宽判据，而是让判据的取数面回到真源。】\n'

io.open(SEG, 'w', encoding='utf-8').write(seg)
print('[seg] 第 10 条读数与第 12 条交棒改写形态锚已改')