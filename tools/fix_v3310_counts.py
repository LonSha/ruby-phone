#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_v3310_counts.py — 把段文档里两处过时读数改成实际值（字节/行数 + 绿序）。"""
import io
import os
import re

ROOT = '/home/user/ruby-phone'
seg_rel = 'tools/iter89_seg.md'
seg = io.open(os.path.join(ROOT, seg_rel), encoding='utf-8').read()
before = seg

# ① 套件体积/行数（两次修判据后文件变大）
seg = seg.replace('新建 `tests/system-v3310.test.mjs`（33 条 / 85248 字节 / 1177 行）',
                  '新建 `tests/system-v3310.test.mjs`（33 条 / 91696 字节 / 1274 行）')
assert seg != before, '套件体积锚点未命中'

# ② 验收读数的「绿序」：33/33 是在**抬版之后**才凑齐的（抬版前后又抓出两条真问题）
old = '（抬版前 30 绿 / 3 红：两条是本版自己修掉的锚点与判据、一条是待抬版的版本锚）'
new = ('（绿的过程如实记：首跑 25 绿 / 8 红 → 逐条甄别处置后 30 绿 / 3 红（其中一条是待抬版的版本锚）'
       '→ **抬版之后**又跑出两条真问题（产品侧 `_esc` 的 `/"/g` 击穿尾随块注释、判据侧 K3 误报与 H4 越界口径），'
       '处置完才到 33 / 33）')
assert old in seg, '绿序锚点未命中'
seg = seg.replace(old, new)
assert seg.startswith('## 迭代 89 — ')
io.open(os.path.join(ROOT, seg_rel), 'w', encoding='utf-8').write(seg)

# ③ ITERATION_LOG 的迭代 89 段跟着重建（按下一个段头截断）
itlog_rel = 'ITERATION_LOG.md'
itlog = io.open(os.path.join(ROOT, itlog_rel), encoding='utf-8').read()
start = itlog.index('## 迭代 89 — ')
nxt = itlog.index('\n## ', start)
itlog_new = itlog[:start] + seg.rstrip('\n') + '\n' + itlog[nxt:]
assert itlog_new.count('## 迭代 89 — ') == 1
assert itlog_new.count('## 迭代 88 — ') == 1
io.open(os.path.join(ROOT, itlog_rel), 'w', encoding='utf-8').write(itlog_new)

print('段文档已改：字节', len(seg.encode('utf-8')), '| 迭代日志', os.path.getsize(os.path.join(ROOT, itlog_rel)))
print('残留旧读数检查：85248 ->', seg.count('85248'), '| 1177 行 ->', seg.count('1177 行'))
