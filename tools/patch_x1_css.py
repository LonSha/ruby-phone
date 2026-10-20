#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v4.37.0 R5-X1 的物品卡样式同步进 phone.css 打包产物。

phone.css 是本仓手工维护的打包面（无构建脚本），apps/memory/memory.css 是源面。
两侧必须逐字一致 —— 只写一侧等于打包环境里裸奔（样式不生效，
而界面看着「就是不好看」而不是报错）。
"""
import io

ROOT = '/home/user/ruby-phone/'
SRC = 'apps/memory/memory.css'
BUNDLE = 'phone.css'
ANCHOR = '/* [v4.36.0 · R5-O9] 时点条件行 + 可撤条件按钮。'
BLOCK_START = '/* [v4.37.0 · R5-X1] 随身物品与借还卡。'
BLOCK_END = '.mem-item-note-text { color: #b45309; font-size: 12px; }'


def rd(rel):
    with io.open(ROOT + rel, encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(ROOT + rel, 'w', encoding='utf-8') as f:
        f.write(s)


src = rd(SRC)
i = src.index(BLOCK_START)
j = src.index(BLOCK_END) + len(BLOCK_END)
block = src[i:j]

bundle = rd(BUNDLE)
if block in bundle:
    print('SKIP: phone.css 已有该块')
else:
    n = bundle.count(ANCHOR)
    assert n == 1, '锚点必须恰中 1 次，实测 %d' % n
    bundle = bundle.replace(ANCHOR, block + chr(10) + ANCHOR, 1)
    wr(BUNDLE, bundle)
    print('OK: 已插入 %d 字节' % len(block))

for cls in ['.mem-item-section', '.mem-item-face', '.mem-item-should', '.mem-item-row',
            '.mem-item-mini', '.mem-item-note-text']:
    print(cls, 'src=%s bundle=%s' % (cls in src, cls in rd(BUNDLE)))