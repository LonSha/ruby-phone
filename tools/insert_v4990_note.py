#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v4.99.0 来由散文插进 refresh_baselines_v4990.py 的 REFRESH_NOTE_FMT 末尾（第 140 行之后）。"""
import ast
import io
import os

ROOT = '/home/user/ruby-phone'
DST = os.path.join(ROOT, 'tools', 'refresh_baselines_v4990.py')
_raw = io.open('/tmp/v4990_note.txt', encoding='utf-8').read()
NOTE = _raw.rstrip('\n').rstrip()
if not NOTE.startswith('    '):
    NOTE = '    ' + NOTE.lstrip()

lines = io.open(DST, encoding='utf-8').read().split('\n')
# 找 v4.91.0 那行的下标（它是 REFRESH_NOTE_FMT 的最后一条）
idx = [i for i, l in enumerate(lines) if l.startswith("    '【v4.91.0】")]
assert len(idx) == 1, 'v4.91.0 来由行命中 %d 次' % len(idx)
i0 = idx[0]
assert lines[i0 + 1] == ')', 'v4.91.0 行之后不是闭括号：%r' % lines[i0 + 1]
assert "'" not in NOTE.replace("'", "", 0) or True
assert NOTE.startswith("    '") and NOTE.endswith("'"), '来由散文须是单引号 Python 字符串行'
lines.insert(i0 + 1, NOTE)
out = '\n'.join(lines)
ast.parse(out)
io.open(DST, 'w', encoding='utf-8').write(out)
back = io.open(DST, encoding='utf-8').read()
ast.parse(back)
assert back == out
# 幂等自证：再跑一次必须抛（锚点已不是唯一形态，即 v4.91.0 后面跟着的不是闭括号）
print('[insert] ok, lines=%d' % len(back.split('\n')))
print('[insert] VER:', [l for l in back.split('\n') if l.startswith('VER =')][0])
print('[insert] v4.99.0 note present:', back.count('【v4.99.0】'))
