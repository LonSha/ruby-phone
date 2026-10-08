#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v3670.py — 抬版 v3.67.0（五源同源）。
沿用 bump_v3660.py 的范式：五处同源一次抬齐。
  ① update-log.json：新键插首位，latest 同置；
  ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
  ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块；
  ④ ITERATION_LOG.md：头部插迭代段；
  ⑤ docs/runtime-verification-boundary.md：当版复校标记。
"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.67.0'
DATE = '2026-10-08'
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)

def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()
def wr(rel, s):
    p = os.path.join(ROOT, rel)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)

# ① update-log.json
ul_path = 'update-log.json'
ul = json.loads(rd(ul_path))
assert ul['latest'] == '3.66.0', f"latest != 3.66.0: {ul['latest']}"
seg = rd('tools/iter125_seg.md').rstrip(NL)
items = []
for line in seg.split(NL):
    line = line.strip()
    if line.startswith('- '):
        it = line[2:].strip()
        if it.startswith('**'):
            it = it[2:]
        if it.endswith('**'):
            it = it[:-2]
        it = it.strip()
        items.append(it)
assert items, 'no items parsed from iter125_seg.md'
new_entry = {"version": VER, "date": DATE, "items": items}
ul['versions'][VER] = new_entry
ul['latest'] = VER
ul_str = json.dumps(ul, ensure_ascii=False, indent=2)
if WRITE:
    wr(ul_path, ul_str)
    print(f'[1/5] update-log.json: latest={VER}, items={len(items)}')

# ② version constants
for rel, old in [('package.json', '"version": "3.66.0"'),
                 ('manifest.json', '"version": "3.66.0"')]:
    s = rd(rel)
    new = old.replace('3.66.0', VER)
    assert s.count(old) == 1, f'{rel}: anchor count != 1'
    s = s.replace(old, new, 1)
    if WRITE:
        wr(rel, s)
        print(f'[2/5] {rel}: {VER}')

# index.js ST_PHONE_VERSION
ij = rd('index.js')
old_ver = "const ST_PHONE_VERSION = '3.66.0';"
new_ver = f"const ST_PHONE_VERSION = '{VER}';"
assert ij.count(old_ver) == 1, 'ST_PHONE_VERSION anchor != 1'
ij = ij.replace(old_ver, new_ver, 1)

# ③ index.js ST_PHONE_CURRENT_UPDATE
# Find the block start
old_head = "const ST_PHONE_CURRENT_UPDATE = {"
idx = ij.find(old_head)
assert idx >= 0, 'ST_PHONE_CURRENT_UPDATE not found'
# Find the items array start
items_idx = ij.find('items: [', idx)
assert items_idx >= 0, 'items array not found'
# Find the first item string start
first_quote = ij.find('"', items_idx)
assert first_quote >= 0, 'first item quote not found'
# Build new items list
new_items_json = json.dumps(items, ensure_ascii=False)
# Replace from items: [ to the closing ]
close = ij.find('],', items_idx)
assert close >= 0, 'items closing not found'
old_items_block = ij[items_idx:close+2]
new_items_block = 'items: ' + new_items_json + ','
ij = ij[:items_idx] + new_items_block + ij[close+2:]

if WRITE:
    wr('index.js', ij)
    print(f'[3/5] index.js: ST_PHONE_VERSION={VER}, items={len(items)}')

# ④ ITERATION_LOG.md
il_path = 'ITERATION_LOG.md'
il = rd(il_path)
# Insert segment at the top after the header
header_end = il.find(NL + NL)
if header_end < 0:
    header_end = 0
seg_block = seg + NL + NL
il_new = il[:header_end+1] + NL + seg_block + il[header_end+1:]
# Update current version line if present
il_new = il_new.replace('当前版本：3.66.0', f'当前版本：{VER}')
il_new = il_new.replace('当前版本: 3.66.0', f'当前版本: {VER}')
if WRITE:
    wr(il_path, il_new)
    print(f'[4/5] ITERATION_LOG.md: segment inserted')

# ⑤ docs/runtime-verification-boundary.md
rvb_path = 'docs/runtime-verification-boundary.md'
if os.path.exists(os.path.join(ROOT, rvb_path)):
    rvb = rd(rvb_path)
    # Update version markers
    rvb = rvb.replace('3.66.0', VER)
    if WRITE:
        wr(rvb_path, rvb)
        print(f'[5/5] {rvb_path}: updated')
else:
    print(f'[5/5] {rvb_path}: not found (skip)')

if not WRITE:
    print('--- DRY RUN (pass --write to apply) ---')
    print(f'update-log latest={VER}, items={len(items)}')
    print(f'package.json/manifest.json/index.js version={VER}')
    print(f'ITERATION_LOG.md: segment inserted')
else:
    print('--- DONE ---')
