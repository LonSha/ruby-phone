#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v4.41.0 R5-X8 的周期样式同步进 phone.css 运行时投递面。

calendar.css 是源面（App 自注入机制），phone.css 是 manifest.css 指向的运行时面；
两侧必须逐字一致 —— 只写一侧等于运行时裸奔。
"""
import io

ROOT = '/home/user/ruby-phone/'
SRC = 'apps/calendar/calendar.css'
BUNDLE = 'phone.css'
BLOCK_START = '/* ---------- [v4.41.0 · R5-X8] 周期与单次例外 ----------'
BLOCK_END = '.yzp-calendar-recur-btn:active { transform: scale(0.96); }'
# 打包面里 calendar 段的锚（源面那一行在打包面里也有一份）。
ANCHOR = '    .yzp-calendar-detail-body'


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

for cls in ['.yzp-calendar-recur-block', '.yzp-calendar-recur-title', '.yzp-calendar-recur-hint',
            '.yzp-calendar-recur-row', '.yzp-calendar-recur-actions', '.yzp-calendar-recur-btn']:
    print(cls, 'src=%s bundle=%s' % (cls in src, cls in rd(BUNDLE)))