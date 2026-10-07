#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步迭代 124 段（真源 tools/iter124_seg.md）到三处同源：
  ① update-log.json 的 3.66.0 items；② index.js 公告块当版 items；③ ITERATION_LOG.md 的迭代 124 段。

纪律：只替换当版 items / 当版段；历史 items 与段一字不动；断言锚点唯一。
关键：公告块的「历史窗口」一律从块自身尾部与 update-log 的版本链**对齐推出**，
      绝不依赖「上一次自己写过什么」（否则同步一次就自污染，历史会被多吃一段）。
"""
import io, json, os, sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)
DQ = chr(34)
BS = chr(92)
VER = '3.66.0'
WRITE = '--write' in sys.argv


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, s):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(s)


SEG = rd('tools/iter124_seg.md').rstrip(NL)
assert BS not in SEG and '[' not in SEG and ']' not in SEG and DQ not in SEG, '迭代段字符纪律'
ITEMS = []
for line in SEG.split(NL):
    t = line.strip()
    if not t.startswith('- '):
        continue
    it = t[2:].strip()
    if it.startswith('**'):
        it = it[2:]
    if it.endswith('**'):
        it = it[:-2]
    ITEMS.append(it.strip())
assert len(ITEMS) >= 4, len(ITEMS)
print('items = %d' % len(ITEMS))

# ① update-log.json
log = json.loads(rd('update-log.json'))
assert log['latest'] == VER and VER in log['versions']
KEYS = list(log['versions'].keys())
assert KEYS[0] == VER, KEYS[:3]
PREV = KEYS[1]
print('prev = %s' % PREV)
log['versions'][VER]['items'] = ITEMS

# ② index.js 公告块
idx = rd('index.js')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
assert idx.count(START) == 1
bi = idx.find(START)
bj = idx.find(NL + '};', bi)
blk = idx[bi:bj]
lines = blk.split(NL)
hdr_end = [i for i, l in enumerate(lines) if l.strip() == 'items: [']
assert len(hdr_end) == 1
hdr_end = hdr_end[0]
body_end = [i for i, l in enumerate(lines) if i > hdr_end and l.strip() == ']']
assert len(body_end) == 1
body_end = body_end[0]
head = lines[:hdr_end + 1]
raw_items = lines[hdr_end + 1:body_end]
tail = lines[body_end:]
vals = []
for l in raw_items:
    t = l.strip()
    assert t.startswith(DQ), t[:40]
    s = t[:-1] if t.endswith(',') else t
    vals.append(json.loads(s))
print('公告块 items = %d' % len(vals))

# 历史窗口 = 从 PREV 起沿结构链向下，与块尾逐条对齐的最长连续段
chain = []
k = 1
while k < len(KEYS):
    chain = chain + list(log['versions'][KEYS[k]]['items'])
    n = len(chain)
    if n < len(vals) and vals[len(vals) - n:] == chain:
        best = n
    k += 1
try:
    best
except NameError:
    raise AssertionError('历史窗口无法与 update-log 版本链对齐（块尾与任何连续版本段都不匹配）')
hist_start = len(vals) - best
print('历史窗口 = %d 条（自 %s 向下）；被替换的旧当版 = %d 条' % (best, PREV, hist_start))
assert best >= 5, best
assert hist_start >= 0

merged = head[:]
for it in ITEMS:
    merged.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
merged.extend(raw_items[hist_start:])
merged.extend(tail)
new_blk = NL.join(merged)
idx_new = idx[:bi] + new_blk + idx[bj:]
assert idx_new.count(START) == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new
# 历史逐字不动
assert raw_items[hist_start:] == [l for l in new_blk.split(NL) if l.strip().startswith(DQ)][len(ITEMS):]

# ③ ITERATION_LOG.md 迭代 124 段
itlog = rd('ITERATION_LOG.md')
A = '## 迭代 124 ' + chr(8212) + ' '
B = '## 迭代 123 ' + chr(8212) + ' '
assert itlog.count(A) == 1, itlog.count(A)
assert itlog.count(B) == 1
ia = itlog.index(A)
ib = itlog.index(B)
old_seg = itlog[ia:ib].rstrip(NL)
new_seg = SEG + NL + NL
itlog_new = itlog[:ia] + new_seg + itlog[ib:]
assert itlog_new.count(A) == 1 and itlog_new.count(B) == 1
print('旧段 %d 字符 -> 新段 %d 字符' % (len(old_seg), len(SEG)))

if not WRITE:
    print('（dry-run）')
    sys.exit(0)
wr('update-log.json', json.dumps(log, ensure_ascii=False, indent=2) + NL)
wr('index.js', idx_new)
wr('ITERATION_LOG.md', itlog_new)
print('三处同源已同步。')