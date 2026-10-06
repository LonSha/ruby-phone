#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B2：路由扫描面切到共享单源（内联 ∪ 表）。

口径（本仓纪律「扫描面口径必须跟着代码走」）：
  O6 把 67 段懒加载分支从 index.js 搬进 config/app-lazy-routes.js 的单源表，
  40 个套件里 57 处「index.js 必须有懒加载分支」随即全数落空 —— 真功能在跑、
  判据判不到，是假红。修法不是逐条放宽断言，而是**把数据源换成判据面**：
      routeSurface(indexRaw, tableRaw) = index 原文 + 表行渲染回的内联分支
  渲染形与重构前的五件套逐字同构（缩进/字段顺序/文案拼接一致），故断言一字不改。

三类落点（每处锚点必须恰中预期次数，失配即退出且不写盘）：
  A 组（有 read 助手）：read 定义改为 withRouteSurface 包装，并插入一行 import。
  B 组（直接 readFileSync 取 index.js）：就地包成 routeSurface(raw, readRepoTable())。
先过 ast.parse 自证（本脚本是 Python），再执行；执行前整目录备份 tests/。
"""
import ast
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
TESTS = ROOT / 'tests'
BACKUP = Path('/tmp/rp_v3610b2_backup')

# 先自证语法
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b2] ast 自证通过')

IMP = "import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';"

# ── A 组：read 助手包装 ─────────────────────────────────────────────
A_FILES = """system-v246.test.mjs system-v247.test.mjs system-v248.test.mjs system-v249.test.mjs
system-v251.test.mjs system-v252.test.mjs system-v253.test.mjs system-v261.test.mjs
system-v299.test.mjs system-v3250.test.mjs system-v3260.test.mjs system-v3270.test.mjs
system-v3280.test.mjs system-v3290.test.mjs system-v3300.test.mjs system-v3310.test.mjs
system-v3340.test.mjs system-v3350.test.mjs system-v3360.test.mjs system-v3370.test.mjs
system-v3380.test.mjs system-v3390.test.mjs system-v3400.test.mjs system-v3410.test.mjs
system-v3420.test.mjs system-v3430.test.mjs system-v3440.test.mjs system-v3450.test.mjs
system-v3460.test.mjs system-v3470.test.mjs system-v3480.test.mjs system-v3490.test.mjs""".split()

READ_DEF = re.compile(
    r'^const read = \((\w+)(?:, (\w+))?\) => (fs\.readFileSync|readFileSync)\((.+)\);\s*$', re.M)


def wrap_a(name):
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
    root_var = m.group(2) if m.group(2) else ('ROOT' if re.search(r'\bROOT\b', m.group(4)) else 'root')
    if m.group(2):
        new_def = ('const _readRaw = (%s) => %s;\n'
                   'const read = (%s) => withRouteSurface(_readRaw, %s || ROOT)(%s, %s);') % (
            args, call, args, m.group(2), m.group(1), m.group(2))
    else:
        new_def = ('const _readRaw = (%s) => %s;\n'
                   'const read = withRouteSurface(_readRaw, %s);') % (args, call, root_var)
    new_src = src[:m.start()] + new_def + src[m.end():]
    # 插入 import：最后一条顶层 import 之后
    lines = new_src.split('\n')
    last = -1
    for i, l in enumerate(lines[:80]):
        if re.match(r'^import\s', l):
            last = i
    if last < 0:
        return 'FAIL(找不到 import 区)'
    lines.insert(last + 1, IMP)
    p.write_text('\n'.join(lines), encoding='utf-8')
    return 'ok'


# ── B 组：直接 readFileSync ────────────────────────────────────────
B_JOBS = [
    ('audit.test.mjs',
     "const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');",
     "const idx = routeSurface(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), readRepoTable());"),
    ('entry-integrity.test.mjs',
     "const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');",
     "const idx = routeSurface(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), readRepoTable());"),
    ('system-v216.test.mjs',
     "const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');",
     "const idx = routeSurface(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), readRepoTable());"),
]


def wrap_b(name, old, new):
    p = TESTS / name
    src = p.read_text(encoding='utf-8')
    n = src.count(old)
    if n != 1:
        return 'FAIL(锚点命中 %d 次)' % n
    out = src.replace(old, new)
    if '_lazy_routes.mjs' not in out:
        lines = out.split('\n')
        last = max((i for i, l in enumerate(lines[:80]) if re.match(r'^import\s', l)), default=-1)
        if last < 0:
            return 'FAIL(找不到 import 区)'
        lines.insert(last + 1, IMP)
        out = '\n'.join(lines)
    p.write_text(out, encoding='utf-8')
    return 'ok'


if not BACKUP.exists():
    shutil.copytree(TESTS, BACKUP)
    print('[b2] tests/ 已备份 → %s' % BACKUP)

fails = []
print('=== A 组 ===')
for f in A_FILES:
    r = wrap_a(f)
    print('  %-30s %s' % (f, r))
    if r.startswith('FAIL'):
        fails.append(f)
print('=== B 组 ===')
for f, old, new in B_JOBS:
    r = wrap_b(f, old, new)
    print('  %-30s %s' % (f, r))
    if r.startswith('FAIL'):
        fails.append(f)
if fails:
    sys.exit('[b2] 失败：' + ','.join(fails))
print('[b2] 完成')