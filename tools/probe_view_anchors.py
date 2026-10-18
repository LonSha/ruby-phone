#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_view_anchors.py — 逐字节探出 patch_r4o2_view.py 里那几个锚点的真实形态。

为什么单独一件:本仓的标点被全角化过多次,凭 ASCII 猜锚点已经失败过三回。
本探针把「期望锚点」与「文件里那一行」各自打码点,差异一眼可见 ——
不再靠肉眼比对(那是猜)。
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/memory/memory-view.js'
s = io.open(os.path.join(ROOT, REL), encoding='utf-8').read()

CAND = {
    'searchrow': "mem-search-row\"><input id=\"mem-ask-q\"",
    'doask_head': '  _doAsk() {',
    'face_head': '  _askFaceHtml(qa) {',
    'answerline': 'const answer = Array.isArray(r.answer) ? r.answer : [];',
    'bindline': "    q('#mem-ask-q')?.addEventListener('keydown'",
}


def dump(label, text):
    print('--- %s ---' % label)
    print('  repr : ' + repr(text[:100]))
    print('  codes: ' + ' '.join('%x' % ord(c) for c in text[:100]))


for k, needle in CAND.items():
    i = s.find(needle)
    if i < 0:
        print('!! %s NOT FOUND' % k)
        continue
    dump(k, s[max(0, i - 30):i + len(needle) + 30])
    print('  count=%d' % s.count(needle))
print('=== 全角冒号 / 半角冒号 计数 ===')
print('U+FF1A (fullwidth colon) in file: %d' % s.count('\uff1a'))
print('U+003A (ascii colon) in file: %d' % s.count(':'))