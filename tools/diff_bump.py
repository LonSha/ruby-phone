#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对 bump_v4992.py 与 bump_v4991.py 的差异只有头注与 STEPS（逻辑零差异）。"""
import difflib
import io

a = io.open('tools/bump_v4991.py', encoding='utf-8').read().split(chr(10))
b = io.open('tools/bump_v4992.py', encoding='utf-8').read().split(chr(10))
diff = list(difflib.unified_diff(a, b, 'v4991', 'v4992', lineterm='', n=0))
print('diff lines:', len(diff))
for line in diff:
    print(line)