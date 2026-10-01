#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe3360c.py — 找 stripComments 状态机的**第一个卡点**（含跨行字符串清单）。

卡点的经典来源：**正则字面量里含裸引号**（如 `/[\\/:*?"<>|]/`）—— 剥器不解析
正则字面量，会把那个 `"` 当成字符串起头，从此再也复位不了。
"""
import io
import sys


def scan(src, name):
    i = 0
    n = len(src)
    state = 'code'
    open_at = None
    line = 1
    events = []
    first_bad = None
    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ''
        if c == '\n':
            line += 1
        if state == 'code':
            if c == '/' and d == '/':
                state = 'line'; i += 2; continue
            if c == '/' and d == '*':
                state = 'block'; i += 2; continue
            if c in ("'", '"', '`'):
                state = c
                open_at = (line, c, i)
                i += 1; continue
            i += 1; continue
        if state == 'line':
            if c == '\n':
                state = 'code'
            i += 1; continue
        if state == 'block':
            if c == '*' and d == '/':
                state = 'code'; i += 2; continue
            i += 1; continue
        if c == '\\':
            i += 2; continue
        i += 1
        if c == state:
            state = 'code'
            if open_at:
                a = open_at
                events.append((a[0], line, a[1], a[2]))
                open_at = None
    print('====', name, '最终 state =', repr(state))
    if open_at:
        ln, ch, idx = open_at
        s0 = src.rfind('\n', 0, idx) + 1
        s1 = src.find('\n', idx)
        print('  ✗ 未复位：进入于源行 %d，字符 %r' % (ln, ch))
        print('      该行：', repr(src[s0:s1]))
    # 跨行字符串（进出行号不同）—— 卡点的候选
    for (a, b, ch, idx) in events:
        if b != a:
            s0 = src.rfind('\n', 0, idx) + 1
            s1 = src.find('\n', idx)
            print('  ~ 跨行字符串：源行 %d → %d（%r）：%s' % (a, b, ch, repr(src[s0:min(s1, s0 + 90)])))
    return open_at


for rel in sys.argv[1:]:
    src = io.open(rel, encoding='utf-8').read()
    scan(src, rel)