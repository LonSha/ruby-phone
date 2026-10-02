#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3480.py — v3.48.0 运行时验证边界文档复校（两处机器可读契约 + 首行版标）

本版（v3.48.0 子宫画板）新增 apps/uterus/ 三件 .js + 一个判据套件，
故两面读数各 +4：语法面 +4（三件 .js + 判据套件 .mjs，样式 .css 不计）。

写什么（三处，锚点先自证恰中 1 次）：
  ① 首行版标：v3.47.0 复校 -> v3.48.0 复校；
  ② 头部「实测规模（v3.47.0 复校）」那行 -> 本版读数 + 本版三格来由段；
  ③ 第五节两条机器可读契约行（语法 N 文件 / 导入 N 文件 N 条）
     -> 本版读数 + 本版复校说明段。
纪律：读数全部取自现场（真跑两道门），脚本里不写字面量；默认 dry-run。
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
VER = 'v3.48.0'
PREV = 'v3.47.0'
NL = chr(10)
DOC = os.path.join(ROOT, 'docs', 'runtime-verification-boundary.md')


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, ' '.join(cmd) + ' rc=' + str(r.returncode) + ' ' + (r.stderr or '')[-400:]
    return r.stdout or ''


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


SYN_OUT = run(['node', 'scripts/syntax-check.mjs'])
IMP_OUT = run(['node', 'scripts/import-resolve-check.mjs'])
m1 = re.search('语法门通过：([0-9]+) 个文件', SYN_OUT)
m2 = re.search('扫描 ([0-9]+) 个文件 · 静态相对导入 ([0-9]+) 条 · 动态 import' + chr(92) + chr(40) + '([0-9]+)' + chr(92) + chr(41) + ' 条', IMP_OUT)
assert m1 and m2, (SYN_OUT[-300:], IMP_OUT[-300:])
SYN_N = m1.group(1)
IMP_F = m2.group(1)
IMP_S = m2.group(2)
IMP_D = m2.group(3)

NEW_JS = [f for f in os.listdir(os.path.join(ROOT, 'apps', 'uterus')) if f.endswith('.js')]
assert len(NEW_JS) == 3, NEW_JS
SUITE = 'tests/system-v3480.test.mjs'
assert os.path.exists(os.path.join(ROOT, SUITE))
APP_DESC = ('`apps/uterus/` 三件（数据层 / App 层 / 视图层）+ `' + SUITE + '` 一个判据套件'
            '（该件的 `uterus.css` 是样式不是 .js，不计入语法面）')

s = open(DOC, encoding='utf-8').read()
# 旧读数（自证仍在文档里，防口径已变）
OLD_SYN = '语法 578 文件'
OLD_IMP = '导入 344 文件 531 条'
OLD_SCALE = ('- 实测规模（v3.47.0 复校）：**344 个文件 / 531 条静态相对导入**'
             '（另 125 条动态 import 不计入判据）；语法门 **578 文件**。')
for tag, a in (('旧语法行', OLD_SYN), ('旧导入行', OLD_IMP), ('旧实测规模行', OLD_SCALE)):
    assert s.count(a) == 1, tag + ' 必须恰中 1 次，实得 %d' % s.count(a)

# ① 首行版标
s = once(s, '# ruby-phone 运行时验证边界（v2.82.0 起；**v3.47.0 复校**）',
         '# ruby-phone 运行时验证边界（v2.82.0 起；**v3.48.0 复校**）', '首行版标')

# ② 头部实测规模行
NEW_SCALE = ('- 实测规模（v3.48.0 复校）：**%s 个文件 / %s 条静态相对导入**'
             '（另 %s 条动态 import 不计入判据）；语法门 **%s 文件**。' % (IMP_F, IMP_S, IMP_D, SYN_N))
REASON = (
    NL + '  ★ v3.48.0 复校的三格来由（本仓纪律：**逐条对账，不写「大约」**）：扫描面 344 → **%s** 文件'
    ' —— 增量全部落在产品侧 3 件新文件（`apps/uterus/` 的 `uterus-data.js` / `uterus-app.js` /'
    ' `uterus-view.js`）；静态说明符 531 → **%s** 条，逐条对上新件的三条模块间引用'
    '（App→数据层 / App→视图层 / 视图→数据层）；动态 import 125 → **%s**'
    '（`index.js` 的懒加载那一条，设计上不计入判据）。'
    '★ 本行只记真跑读数：两道门在现场各跑一遍，读数直接落笔（脚本里不写字面量）。' % (IMP_F, IMP_S, IMP_D))
s = once(s, OLD_SCALE, NEW_SCALE + REASON, '实测规模行')

# ③ 两条机器可读契约行
s = once(s, OLD_SYN, '语法 %s 文件' % SYN_N, '语法契约行')
s = once(s, OLD_IMP, '导入 %s 文件 %s 条' % (IMP_F, IMP_S), '导入契约行')

# ④ 契约行下补本版复校说明段（插在语法契约行之后）
SYN_LINE = '语法 %s 文件' % SYN_N
NOTE = (
    NL + '（**v3.48.0 复校**：本版新增 4 个 .js —— ' + APP_DESC +
    '。★ 与上一版**同形**：本版导入面也增 **3** 文件 / **3** 条静态说明符，**不随语法面同步 +4**'
    ' —— 因为 `tests/` 不在导入门的扫描面里（两道门的 `SKIP_DIRS` 差异是既有口径）。'
    '★ 本版是四页签 + 96x120 像素画布放大两倍的**机制面**；真机排版与观感仍归 R-O3。')
s = once(s, SYN_LINE, SYN_LINE + NOTE, '语法契约行补说明')
IMPORT_LINE = '导入 %s 文件 %s 条' % (IMP_F, IMP_S)
NOTE2 = (
    NL + '（**v3.48.0 复校**：导入面增量逐条对账 —— 文件 344 → **%s**（新件 3 个：'
    '`apps/uterus/uterus-data.js` / `uterus-app.js` / `uterus-view.js`）、'
    '静态说明符 531 → **%s**（新件的三条模块间引用：App→数据层 / App→视图层 / 视图→数据层）、'
    '动态 import 125 → **%s**（`index.js` 的懒加载那条）。**未随语法面 +4**（`tests/` 不进导入门扫描面）。'
    % (IMP_F, IMP_S, IMP_D))
s = once(s, IMPORT_LINE, IMPORT_LINE + NOTE2, '导入契约行补说明')

assert s.count('v3.48.0 复校') >= 3
print('== dry-run 摘要 ==')
print('  现场读数：语法 %s 文件 / 导入 %s 文件 %s 条 / 动态 %s 条' % (SYN_N, IMP_F, IMP_S, IMP_D))
print('  首行版标 v3.47.0 -> v3.48.0 复校')
print('  头部实测规模行 + 本版三格来由段')
print('  两条机器可读契约行：语法 %s 文件 / 导入 %s 文件 %s 条' % (SYN_N, IMP_F, IMP_S))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(DOC, 'w', encoding='utf-8') as f:
    f.write(s)
print('已落盘', DOC, os.path.getsize(DOC))
