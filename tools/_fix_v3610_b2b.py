#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B2 补丁：修 v3310（import 区在 87 行，超出原搜索窗 80）。

原 B2 对 32 个 A 组文件生效；v3310 因文件头注释长达 80+ 行、import 落在第 87 行
而报「找不到 import 区」并整文件未写盘。本脚本把搜索窗放宽到 300 行重做该文件。
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
TESTS = ROOT / 'tests'
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b2b] ast 自证通过')

IMP = "import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';"
READ_DEF = re.compile(
    r'^const read = \((\w+)(?:, (\w+))?\) => (fs\.readFileSync|readFileSync)\((.+)\);\s*$', re.M)


def wrap(name):
    p = TESTS / name
    src = p.read_text(encoding='utf-8')
    if '_lazy_routes.mjs' in src:
        return 'skip(已有 import)'
    ms = list(READ_DEF.finditer(src))
    if len(ms) != 1:
        return 'FAIL(read 定义命中 %d 次)' % len(ms)
    m = ms[0]
    args = m.group(1) + (', ' + m.group(2) if m.group(2) else '')
    call = m.group(3) + '(' + m.group(4) + ')'
    if m.group(2):
        new_def = ('const _readRaw = (%s) => %s;\n'
                   'const read = (%s) => withRouteSurface(_readRaw, %s || ROOT)(%s, %s);') % (
            args, call, args, m.group(2), m.group(1), m.group(2))
    else:
        root_var = 'ROOT' if re.search(r'\bROOT\b', m.group(4)) else 'root'
        new_def = ('const _readRaw = (%s) => %s;\n'
                   'const read = withRouteSurface(_readRaw, %s);') % (args, call, root_var)
    out = src[:m.start()] + new_def + src[m.end():]
    lines = out.split('\n')
    last = max((i for i, l in enumerate(lines[:300]) if re.match(r'^import\s', l)), default=-1)
    if last < 0:
        return 'FAIL(找不到 import 区)'
    lines.insert(last + 1, IMP)
    p.write_text('\n'.join(lines), encoding='utf-8')
    return 'ok'


r = wrap('system-v3310.test.mjs')
print('[b2b] system-v3310.test.mjs %s' % r)
if r.startswith('FAIL'):
    sys.exit(1)
print('[b2b] 完成')