#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe3360b.py — 细探：找出 stripComments 状态机在哪一行进入字符串/模板串后**没复位**。

做法：逐字符跑等价状态机，记录每次「进入字符串态」的源行号与「退出」的源行号；
末尾仍未退出的那一次，就是卡点。卡点通常来自**正则字面量里的裸引号**（本仓
剥器不解析正则字面量 —— v3.31.0 在 date-view 上踩过）。
"""
import io
import sys


def scan(src, name):
    i = 0
    n = len(src)
    state = 'code'
    entry = []          # (行号, 进入时的字符)
    open_at = None
    line = 1
    events = []
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
                events.append((open_at, (line, c, i)))
                open_at = None
    print('====', name, '最终 state =', repr(state))
    if open_at:
        ln, ch, idx = open_at
        print('  ✗ 未复位：进入于源行 %d，字符 %r' % (ln, ch))
        print('      源行内容：', repr(src[src.rfind('\n', 0, idx) + 1:src.find('\n', idx)]))
        print('      前 3 行：')
        start = src.rfind('\n', 0, max(0, idx - 200))
        print(repr(src[start:idx + 120]))
    # 打印「跨行」的字符串（进出行号不同的），这些是可疑点
    for (a, (b, ch, _i)) in events:
        if b != a:
            print('  ~ 跨行字符串：源行 %d → %d（字符 %r）' % (a, b, ch))
    return open_at


for rel in sys.argv[1:]:
    src = io.open(rel, encoding='utf-8').read()
    scan(src, rel)