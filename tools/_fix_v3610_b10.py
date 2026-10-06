#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B10：把 B8 的文档步骤改成幂等（零手抄 + 可重跑）。

问题：B8 对文档那一步是无条件 `+1`。脚本入仓后若被重跑，会把契约行写成 639、640…
与真门禁读数越差越远（v328 C1 会红）。
修法：改成「跑 scripts/syntax-check.mjs 取**现场真读数**写回，已相等则跳过」——
与探针基线那一步同款零手抄口径，且天然幂等。
顺带清理 tools/__pycache__（本轮 `.py` 补丁工具的字节码缓存，不该进仓）。
"""
import ast
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b10] ast 自证通过')

p = ROOT / 'tools/_fix_v3610_b8.py'
src = p.read_text(encoding='utf-8')
OLD = """    doc = doc.replace(m.group(0), '- 语法 %d 文件' % (int(m.group(1)) + 1), 1)"""
NEW = """    # 零手抄 + 幂等：以门禁**现场真读数**为准，已相等即跳过（重跑不会越改越偏）
    live_m = subprocess.run(['node', str(ROOT / 'scripts/syntax-check.mjs')],
                            cwd=str(ROOT), capture_output=True, text=True, timeout=300)
    live = re.search(r'语法门通过：(\\d+) 个文件', live_m.stdout or '')
    if not live:
        fails.append('③语法门未报出文件数（rc=%d）' % live_m.returncode)
        doc = None
    elif int(m.group(1)) == int(live.group(1)):
        print('[b10] ③ 契约行已是现场读数 %s，跳过' % live.group(1))
    else:
        doc = doc.replace(m.group(0), '- 语法 %s 文件' % live.group(1), 1)"""
n = src.count(OLD)
if 'live_m = subprocess.run' in src:
    print('[b10] 已是幂等形态，跳过')
    raise SystemExit(0)
if n != 1:
    sys.exit('[b10] 锚点命中 %d 次' % n)
src = src.replace(OLD, NEW)
# 后续引用 doc 的地方要容忍 None（跳过分支）
src = src.replace("""    # v3.61.0 复校说明补这一个增量的来由
    old_note = '语法面 625 -> **637**。'""",
                  """    # v3.61.0 复校说明补这一个增量的来由
    old_note = '语法面 625 -> **637**。'
    if doc is None:
        old_note = '\\x00NEVER'   # 跳过分支：不碰说明""")
p.write_text(src, encoding='utf-8')
print('[b10] b8 文档步骤已改为幂等（现场真读数写回）')

# 清理字节码缓存
cache = ROOT / 'tools/__pycache__'
if cache.exists():
    shutil.rmtree(cache)
    print('[b10] 已清理 tools/__pycache__')
print('[b10] 完成')