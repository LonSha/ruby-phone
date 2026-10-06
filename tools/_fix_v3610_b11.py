#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B11：把本轮补丁工具全部改成幂等（可重跑）。

B8 重跑时的两处非幂等：
  ① dead-export 的 REAL_REPO 改写：已应用后锚点 0 命中 ⇒ 误报「失败」并让整脚本 rc=1
     （实际文件是对的）。修法：先查 REAL_REPO 是否已在场，在场即跳过并如实打印。
B10 自身重跑时的非幂等：其锚点（`'- 语法 %d 文件' % (int(m.group(1)) + 1)`）已被 B10 自己
  替换掉 ⇒ 重跑 0 命中即 exit 1。修法：查目标是否已是「现场真读数写回」形态，是即跳过。

口径：补丁脚本要能重复执行而不出错、且重复执行不改变结果（本轮 B8 的两处非幂等
正是「脚本入仓后再跑一次就报假失败」的形态，属工具面缺陷，一并收掉）。
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b11] ast 自证通过')

# ── ① b8 的 dead-export 段加幂等守卫 ───────────────────────────────
p = ROOT / 'tools/_fix_v3610_b8.py'
src = p.read_text(encoding='utf-8')
OLD = """n = src.count(OLD)
if n != 1:
    fails.append('①lazy 闸锚点命中 %d 次' % n)
else:"""
NEW = """n = src.count(OLD)
if 'const REAL_REPO = rootIdx < 0;' in src:
    print('[b8] ① dead-export 闸已是真仓作用域，跳过（幂等）')
elif n != 1:
    fails.append('①lazy 闸锚点命中 %d 次' % n)
else:"""
if src.count(OLD) != 1:
    sys.exit('[b11] ①锚点命中 %d 次' % src.count(OLD))
src = src.replace(OLD, NEW)
p.write_text(src, encoding='utf-8')
print('[b11] ① b8 的 dead-export 段已加幂等守卫')

# ── ② b10 自身加幂等守卫 ───────────────────────────────────────────
p = ROOT / 'tools/_fix_v3610_b10.py'
src = p.read_text(encoding='utf-8')
OLD2 = """n = src.count(OLD)
if n != 1:
    sys.exit('[b10] 锚点命中 %d 次' % n)"""
NEW2 = """n = src.count(OLD)
if 'live_m = subprocess.run' in src:
    print('[b10] 已是幂等形态，跳过')
    raise SystemExit(0)
if n != 1:
    sys.exit('[b10] 锚点命中 %d 次' % n)"""
if src.count(OLD2) != 1:
    sys.exit('[b11] ②锚点命中 %d 次' % src.count(OLD2))
src = src.replace(OLD2, NEW2)
p.write_text(src, encoding='utf-8')
print('[b11] ② b10 已加幂等守卫')

# ── ③ 自证：两份工具重跑均 rc=0 ────────────────────────────────────
import subprocess
for name in ['_fix_v3610_b8.py', '_fix_v3610_b10.py']:
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / name)],
                       cwd=str(ROOT), capture_output=True, text=True, timeout=900)
    print('[b11] 重跑 %s rc=%d' % (name, r.returncode))
    if r.returncode != 0:
        print((r.stdout or '')[-800:]); print((r.stderr or '')[-400:])
        sys.exit('[b11] 重跑仍有非零退出')

# ── ④ 清理字节码缓存 ───────────────────────────────────────────────
import shutil
cache = ROOT / 'tools/__pycache__'
if cache.exists():
    shutil.rmtree(cache)
    print('[b11] 已清理 tools/__pycache__')
print('[b11] 完成')