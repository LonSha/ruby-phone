#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# bump_v3410.py — 抬版 v3.41.0（五源同源）
# 与 bump_v3400.py 同款范式：
#   ① update-log.json：新键插首位（仓内约定），latest / head 同置；
#   ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
#   ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— 由条目真源生成（逐字同源）；
#   ④ ITERATION_LOG.md：头部插迭代 99 段 + 元信息「当前版本」行改当版 + 头部版本数由真源重算。
# 纪律：只写上面四处；先算 draft、逐份断言、最后才落盘；默认 dry-run，--write 才落盘。
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.41.0'
DATE = '2026-10-05'
PREV = '3.40.0'
WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须洽中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


_RAW = json.loads(rd('tools/iter99_items.json'))
assert _RAW.get('version') == VER
assert _RAW.get('date') == DATE
ITEMS = _RAW['items']
assert len(ITEMS) == 22
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it
    assert it.startswith('【') and '】' in it
    assert '[' not in it and ']' not in it

# ① update-log.json
log = json.loads(rd('update-log.json'))
assert log['latest'] == PREV
assert list(log['versions'])[0] == PREV
assert VER not in log['versions']
entry = {'version': VER, 'date': DATE, 'items': ITEMS}
new_versions = {VER: entry}
for k, v in log['versions'].items():
    new_versions[k] = v
new_log = {'latest': VER, 'versions': new_versions, 'head': VER}
assert list(new_log['versions'])[0] == VER

# ② manifest / package
man = json.loads(rd('manifest.json'))
pkg = json.loads(rd('package.json'))
assert man['version'] == PREV and pkg['version'] == PREV
man['version'] = VER
pkg['version'] = VER

# ③ index.js
idx = rd('index.js')
# （本仓实情：index.js 常量可能已在上一轮先抬——那时这一步就是幂等空步）
if "const ST_PHONE_VERSION = '%s';" % PREV in idx:
    idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
                   "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
else:
    assert "const ST_PHONE_VERSION = '%s';" % VER in idx, 'index.js 版本常量既不是上一版也不是本版'
    idx_new = idx
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
mb = BLOCK_RE.search(idx_new)
assert mb, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
lines = ['const ST_PHONE_CURRENT_UPDATE = {',
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines.append('    ]')
lines.append('};')
new_block = '\n'.join(lines)
idx_new = idx_new[:mb.start()] + new_block + idx_new[mb.end():]
assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new

# ④ ITERATION_LOG.md
itlog = rd('ITERATION_LOG.md')
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
meta_re = re.compile(r'（(\d+) 个版本，')
assert len(meta_re.findall(itlog)) == 1
itlog = meta_re.sub('（%d 个版本，' % len(new_versions), itlog)
SEG = rd('tools/iter99_seg.md')
anchor = '## 迭代 98 — '
assert itlog.count(anchor) == 1
assert SEG.lstrip().startswith('## 迭代 99 — ')
itlog = itlog.replace(anchor, SEG.rstrip('\n') + '\n\n' + anchor)
assert itlog.count('## 迭代 99 — ') == 1

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d -> %d' % (VER, list(new_log['versions'])[0], len(log['versions']), len(new_versions)))
print('manifest/package: version -> %s' % VER)
print('index.js: 常量 + 公告块（%d 条）' % len(ITEMS))
print('ITERATION_LOG: 迭代 99 段 + 当前版本行 + 版本数 %d' % len(new_versions))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, 'update-log.json'), 'w', encoding='utf-8') as f:
    json.dump(new_log, f, ensure_ascii=False, indent=2)
    f.write('\n')
with open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(man, f, ensure_ascii=False, indent=2)
    f.write('\n')
with open(os.path.join(ROOT, 'package.json'), 'w', encoding='utf-8') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write('\n')
with open(os.path.join(ROOT, 'index.js'), 'w', encoding='utf-8') as f:
    f.write(idx_new)
with open(os.path.join(ROOT, 'ITERATION_LOG.md'), 'w', encoding='utf-8') as f:
    f.write(itlog)
print('已落盘五源')
