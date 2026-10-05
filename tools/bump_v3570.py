#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# bump_v3570.py — 抬版 v3.57.0（五源同源）
# 与 bump_v3550.py 同款范式（本脚本零反斜杠：全部走字符串定位，不用正则转义）：
#   ① update-log.json：新键插首位，latest / head 同置；
#   ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
#   ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— 由条目真源生成（当版 items 是块头部前缀）；
#   ④ ITERATION_LOG.md：头部插迭代段 + 「当前版本」行改当版 + 头部版本数由真源重算。
# 纪律：只写上面五处；先算 draft、逐份断言、最后才落盘；默认 dry-run，--write 才落盘。
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.57.0'
DATE = '2026-10-04'
PREV = '3.56.0'
SEG_ANCHOR = '## 迭代 114 ' + chr(8212) + ' '
WRITE = '--write' in sys.argv
NL = chr(10)


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


SEG = rd('tools/iter115_seg.md').rstrip(NL)
ITEMS = []
for line in SEG.split(NL):
    line = line.strip()
    if not line.startswith('- '):
        continue
    it = line[2:].strip()
    if it.startswith('**'):
        it = it[2:]
    if it.endswith('**'):
        it = it[:-2]
    it = it.strip()
    assert it.startswith(chr(0x3010)), it[:20]
    ITEMS.append(it)
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it, i
    assert chr(0x3011) in it, i
    assert NL not in it, i
    assert chr(34) not in it, i
assert len(ITEMS) >= 12, len(ITEMS)

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
idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
               "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
assert idx_new.count(START) == 1
bi = idx_new.find(START)
bj = idx_new.find(NL + '};', bi)
assert bi > 0 and bj > bi, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
OLD_BLOCK = idx_new[bi:bj]
old_items_part = OLD_BLOCK[OLD_BLOCK.index('items: [') + len('items: ['):OLD_BLOCK.rindex('    ]')]
OLD_LINES = [l for l in old_items_part.split(NL) if l.strip().startswith('"')]
assert len(OLD_LINES) >= 5, '旧块 items 行数异常：%d' % len(OLD_LINES)
merged = [START, '    version: ST_PHONE_VERSION,', '    date: "%s",' % DATE, '    items: [']
for it in ITEMS:
    merged.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
merged.extend(OLD_LINES)
merged.append('    ]')
merged.append('};')
idx_new = idx_new[:bi] + NL.join(merged) + idx_new[bj + len(NL) + 2:]
assert idx_new.count(START) == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new
# 引号计数法（代代相传的接线自纠）：items 区块每行引号数必须为 2
seg = idx_new[idx_new.index('    items: [', idx_new.index(START)):idx_new.index(NL + '    ]', idx_new.index('    items: [', idx_new.index(START)))]
for ln in seg.split(NL):
    if not ln.strip().startswith('"'):
        continue
    q = ln.count('"') - ln.count(chr(92) + '"')
    assert q == 2, '公告块引号数异常（行内引号 %d）：%s' % (q, ln[:60])

# ④ ITERATION_LOG.md
itlog = rd('ITERATION_LOG.md')
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
TAG = ' 个版本，按版本号索引'
assert itlog.count(TAG) == 1, '头部版本数句式必须恰中 1 次'
_ti = itlog.index(TAG)
_ts = _ti
while _ts > 0 and itlog[_ts - 1].isdigit():
    _ts -= 1
_old_decl = int(itlog[_ts:_ti])
itlog = itlog[:_ts] + str(len(new_versions)) + itlog[_ti:]
print('头部版本数：%d -> %d（声明值与 update-log 真源对齐）' % (_old_decl, len(new_versions)))
assert itlog.count(SEG_ANCHOR) == 1, '迭代 114 段锚点必须恰中 1 次'
itlog = itlog.replace(SEG_ANCHOR, SEG + NL + NL + SEG_ANCHOR)
assert itlog.count('## 迭代 115 ') == 1

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d -> %d' % (VER, list(new_log['versions'])[0], OLD_N, len(new_versions)))
print('manifest/package: version -> %s' % VER)
print('index.js: 常量 + 公告块（当版 %d 条 + 历史 %d 条 = %d）' % (len(ITEMS), len(OLD_LINES), len(ITEMS) + len(OLD_LINES)))
print('ITERATION_LOG: 迭代 115 段 + 当前版本行 + 版本数 %d' % len(new_versions))
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