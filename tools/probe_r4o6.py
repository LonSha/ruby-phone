#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_r4o6.py — 逐字节核对 R4-O6 视图补丁的锚点 A1(渲染行)。"""
import io
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('pv', os.path.join(ROOT, 'tools', 'patch_r4o6_view.py'))
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)

s = io.open(os.path.join(ROOT, 'apps/reading/reading-view.js'), encoding='utf-8').read()
anchor = pv.RENDER_ANCHOR
print('anchor len', len(anchor), 'count', s.count(anchor))
i = s.index('const paras = ch.paragraphs') - 8
seg = s[i:i + len(anchor)]
print('anchor repr:', repr(anchor))
print('file   repr:', repr(seg))
print('equal:', seg == anchor)
for k in range(min(len(seg), len(anchor))):
    if seg[k] != anchor[k]:
        print('first diff at', k, hex(ord(seg[k])), hex(ord(anchor[k])))
        print('  file  :', repr(seg[max(0, k - 24):k + 24]))
        print('  anchor:', repr(anchor[max(0, k - 24):k + 24]))
        break
else:
    print('no diff in overlap; len file=%d anchor=%d' % (len(seg), len(anchor)))