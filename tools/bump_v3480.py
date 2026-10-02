#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# bump_v3480.py — 抬版 v3.48.0（五源同源）
# 与 bump_v3470.py 同款范式：
#   ① update-log.json：新键插首位（仓内约定），latest / head 同置；
#   ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
#   ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— 由条目真源生成（逐字同源）；
#   ④ ITERATION_LOG.md：头部插迭代 106 段 + 元信息「当前版本」行改当版 + 头部版本数由真源重算。
# 纪律：只写上面五处；先算 draft、逐份断言、最后才落盘；默认 dry-run，--write 才落盘。
# 本脚本零反斜杠：公告块与版本数都改走字符串定位，不用正则转义。
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.48.0'
DATE = '2026-10-12'
PREV = '3.47.0'
SEG_ANCHOR = '## 迭代 105 ' + chr(8212) + ' '
WRITE = '--write' in sys.argv
NL = chr(10)


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


_RAW = json.loads(rd('tools/iter106_items.json'))
assert _RAW.get('version') == VER, _RAW.get('version')
assert _RAW.get('date') == DATE, _RAW.get('date')
ITEMS = _RAW['items']
assert len(ITEMS) == 23, len(ITEMS)
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it, i
    assert it.startswith('【') and '】' in it, i
    assert '[' not in it and ']' not in it, i
    assert NL not in it, i

# ① update-log.json
log = json.loads(rd('update-log.json'))
assert log['latest'] == PREV, log['latest']
assert log['head'] == PREV, log['head']
assert list(log['versions'])[0] == PREV
assert VER not in log['versions']
OLD_N = len(log['versions'])
entry = {'version': VER, 'date': DATE, 'items': ITEMS}
new_versions = {VER: entry}
for k, v in log['versions'].items():
    new_versions[k] = v
new_log = {'latest': VER, 'versions': new_versions, 'head': VER}
assert list(new_log['versions'])[0] == VER
assert len(new_versions) == OLD_N + 1

# ② manifest / package
man = json.loads(rd('manifest.json'))
pkg = json.loads(rd('package.json'))
assert man['version'] == PREV and pkg['version'] == PREV
man['version'] = VER
pkg['version'] = VER

# ③ index.js
idx = rd('index.js')
if ("const ST_PHONE_VERSION = '%s';" % PREV) in idx:
    idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
                   "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
else:
    assert ("const ST_PHONE_VERSION = '%s';" % VER) in idx, 'index.js 版本常量既不是上一版也不是本版'
    idx_new = idx
START = 'const ST_PHONE_CURRENT_UPDATE = {'
assert idx_new.count(START) == 1
bi = idx_new.find(START)
bj = idx_new.find(NL + '};', bi)
assert bi > 0 and bj > bi, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
lines = [START,
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines.append('    ]')
lines.append('};')
new_block = NL.join(lines)
idx_new = idx_new[:bi] + new_block + idx_new[bj + len(NL) + 2:]
assert idx_new.count(START) == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new

# ④ ITERATION_LOG.md
itlog = rd('ITERATION_LOG.md')
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
OLD_CNT_TXT = '（%d 个版本，' % OLD_N
itlog = once(itlog, OLD_CNT_TXT, '（%d 个版本，' % len(new_versions), '头部版本数')
SEG = rd('tools/iter106_seg.md')
assert itlog.count(SEG_ANCHOR) == 1, '迭代 105 段锚点必须恰中 1 次'
assert SEG.lstrip().startswith('## 迭代 106 '), SEG[:40]
itlog = itlog.replace(SEG_ANCHOR, SEG.rstrip(NL) + NL + NL + SEG_ANCHOR)
assert itlog.count('## 迭代 106 ') == 1

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d -> %d'
      % (VER, list(new_log['versions'])[0], OLD_N, len(new_versions)))
print('manifest/package: version -> %s' % VER)
print('index.js: 常量 + 公告块（%d 条）' % len(ITEMS))
print('ITERATION_LOG: 迭代 106 段 + 当前版本行 + 版本数 %d' % len(new_versions))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, 'update-log.json'), 'w', encoding='utf-8') as f:
    json.dump(new_log, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(man, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'package.json'), 'w', encoding='utf-8') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'index.js'), 'w', encoding='utf-8') as f:
    f.write(idx_new)
with open(os.path.join(ROOT, 'ITERATION_LOG.md'), 'w', encoding='utf-8') as f:
    f.write(itlog)
print('已落盘五源')
