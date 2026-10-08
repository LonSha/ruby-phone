#!/usr/bin/env python3
"""patch_items.py — 只替换 index.js 的 ST_PHONE_CURRENT_UPDATE.items 数组。"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)

def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()
def wr(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)

seg = rd('tools/iter130_seg.md').rstrip(NL)
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

ij = rd('index.js')
old_head = "const ST_PHONE_CURRENT_UPDATE = {"
idx = ij.find(old_head)
assert idx >= 0
items_idx = ij.find('items: [', idx)
assert items_idx >= 0
# Find the closing ] of the items array - it's the one followed by newline + spaces + ],
# we need to find the matching bracket
bracket_count = 0
pos = items_idx + len('items: ')  # at '['
end = -1
for i in range(pos, len(ij)):
    if ij[i] == '[':
        bracket_count += 1
    elif ij[i] == ']':
        bracket_count -= 1
        if bracket_count == 0:
            end = i
            break
assert end >= 0, 'could not find closing ]'
old_block = ij[items_idx:end+1]
# Build multi-line items block with 8-space indent (required by D9 test: ^ {8}["'])
lines = ['items: [']
for i, it in enumerate(items):
    comma = ',' if i < len(items) - 1 else ''
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + comma)
lines.append('    ]')
new_block = chr(10).join(lines)
ij = ij[:items_idx] + new_block + ij[end+1:]
wr('index.js', ij)
print(f'items replaced: {len(items)} items')