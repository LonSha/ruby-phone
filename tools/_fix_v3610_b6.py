#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B6：修正 B2 的 import 插入位置（真缺陷自纠）。

B2 把 `import { … } from './_lazy_routes.mjs';` 插在「最后一条以 import 起首的行」之后，
而部分套件写的是**多行 import**：
    import {
    <新插的 import 落在这里>
        SYS_KEYS, …
    } from '../config/system-controls.js';
这本是合法 JS，但插进 `import {` 与 `} from …` 之间就是语法错误（Unexpected reserved word），
被语法门当场抓到（8 个文件）。修法：把该行从原位摘掉，移到**该 import 语句的收尾行**之后。
"""
import ast
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
TESTS = ROOT / 'tests'
BACKUP = Path('/tmp/rp_v3610b6_backup')
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b6] ast 自证通过')
if not BACKUP.exists():
    shutil.copytree(TESTS, BACKUP)
    print('[b6] tests/ 已备份 → %s' % BACKUP)

IMP_RE = re.compile(r"^import \{[^}]*\} from '\./_lazy_routes\.mjs';$")
END_RE = re.compile(r"^\s*\} from ['\"][^'\"]+['\"];\s*$")

fixed, skipped = [], []
for p in sorted(TESTS.glob('*.test.mjs')):
    lines = p.read_text(encoding='utf-8').split('\n')
    idx = [i for i, l in enumerate(lines) if IMP_RE.match(l)]
    if len(idx) != 1:
        continue
    i = idx[0]
    # 判据：上一行以 `import {` 结尾（无 from）⇒ 说明插进了多行 import 里
    if not re.match(r"^\s*import \{\s*$", lines[i - 1] if i else ''):
        skipped.append(p.name)
        continue
    imp = lines.pop(i)
    # 从新位置往下找该 import 语句的收尾行
    j = i
    while j < len(lines) and not END_RE.match(lines[j]):
        j += 1
    if j >= len(lines):
        sys.exit('[b6] %s 找不到 import 收尾行' % p.name)
    lines.insert(j + 1, imp)
    p.write_text('\n'.join(lines), encoding='utf-8')
    fixed.append(p.name)

print('[b6] 修正 %d 个：%s' % (len(fixed), ', '.join(fixed)))
print('[b6] 位置本就正确 %d 个' % len(skipped))