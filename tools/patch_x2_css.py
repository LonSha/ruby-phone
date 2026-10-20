#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v4.38.0 R5-X2 的目标树样式同步进 phone.css 打包产物。

phone.css 是本仓的**运行时投递面**（manifest.css 指向它），apps/plotline/plotline.css
是源面（保留供追溯与 App 自注入机制）。两侧必须逐字一致 —— 只写一侧等于运行时裸奔。
"""
import io

ROOT = '/home/user/ruby-phone/'
SRC = 'apps/plotline/plotline.css'
BUNDLE = 'phone.css'
BLOCK_START = '/* ---------- [v4.38.0 · R5-X2] 目标树（纯计划模式，.pn-goal-*） ----------'
BLOCK_END = '.pn-goal-note-text { font-size: 11px; color: #d9a441; }'
# 打包面里 plotline 段的锚。★ 实测 phone.css 的 pn-* 段停在 v2.49.0
#   （pn-cb 系列与 pn-goal 系列都不在里面），故不能用 `.pn-cb-trace-note` 当锚 ——
#   那一条只在**源面**存在。锚必须落在**打包面真有的那一行**上。
ANCHOR = '.pn-empty {'


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
    # 插在 `.pn-empty {` 之前（它属 plotline 段尾；块自带注释头，归属可辨）。
    bundle = bundle.replace(ANCHOR, block + chr(10) + ANCHOR, 1)
    wr(BUNDLE, bundle)
    print('OK: 已插入 %d 字节' % len(block))

for cls in ['.pn-goal-card', '.pn-goal-input', '.pn-goal-face', '.pn-goal-pv',
            '.pn-goal-row', '.pn-goal-actions', '.pn-goal-mini', '.pn-goal-note-text']:
    print(cls, 'src=%s bundle=%s' % (cls in src, cls in rd(BUNDLE)))