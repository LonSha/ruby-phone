#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe3360a.py — 定位 stripComments 状态机在 magazine 三件上的**卡点**。

JS 版 stripComments 不解析正则字面量：一旦代码里出现**裸的引号或反引号**，
剥器会把正则正文当成字符串/模板串的起头，从此再也不复位 —— 于是注释里的
词（`AppState` / `SillyTavern`）会被当成代码，D2 / D4 假红。
本脚本用**等价实现**逐字符复刻那个状态机，找出卡在哪儿。
"""
import io
import sys

def strip(src):
    i = 0
    n = len(src)
    out = []
    state = 'code'
    where = []
    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ''
        if state == 'code':
            if c == '/' and d == '/':
                state = 'line'; i += 2; continue
            if c == '/' and d == '*':
                state = 'block'; i += 2; continue
            if c in ("'", '"', '`'):
                state = c; out.append(c); where.append(i); i += 1; continue
            out.append(c); i += 1; continue
        if state == 'line':
            if c == '\n':
                state = 'code'; out.append(c)
            i += 1; continue
        if state == 'block':
            if c == '*' and d == '/':
                state = 'code'; i += 2; continue
            i += 1; continue
        if c == '\\':
            out.append(c + (d or '')); i += 2; continue
        out.append(c); i += 1
        if c == state:
            state = 'code'
    return ''.join(out), state


for rel in ['apps/magazine/magazine-data.js', 'apps/magazine/magazine-app.js', 'apps/magazine/magazine-view.js']:
    src = io.open(rel, encoding='utf-8').read()
    res, state = strip(src)
    line = src[:len(src)].count('\n') + 1
    print('====', rel)
    print('  最终 state =', repr(state))
    for needle in ['AppState', 'SillyTavern', 'callChatAPI']:
        idx = res.find(needle)
        if idx >= 0:
            ln = res[:idx].count('\n') + 1
            print('  ✗ 残留 %s @结果行 %d：%s' % (needle, ln, repr(res[max(0, idx - 60):idx + 40])))
            # 找源文件里对应位置
            k = src.find(needle)
            while k >= 0:
                sl = src[:k].count('\n') + 1
                print('      源行 %d：%s' % (sl, repr(src[max(0, k - 60):k + 40])))
                k = src.find(needle, k + 1)
        else:
            print('  ✓ %s 已剥净' % needle)
