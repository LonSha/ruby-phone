#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v4.43.0 R5-X3 的行踪带样式同步进 phone.css 运行时投递面。"""
import io

ROOT = '/home/user/ruby-phone/'
SRC = 'apps/place/place.css'
BUNDLE = 'phone.css'
BLOCK_START = '/* ---------- [v4.43.0 · R5-X3] 行踪时间带与会面证据 ----------'
BLOCK_END = '.pl-band-row { font-size: 12px; color: #cfe3f5; line-height: 1.7; word-break: break-word; }'
ANCHOR = '.pl-group-place {'


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

for cls in ['.pl-band-chips', '.pl-band-chip', '.pl-band-actions', '.pl-band-ev', '.pl-band-row']:
    print(cls, 'src=%s bundle=%s' % (cls in src, cls in rd(BUNDLE)))