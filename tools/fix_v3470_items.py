#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# fix_v3470_items.py — 收干 v3.47.0 条目面（两处）
import json, os, re, sys
ROOT = '/home/user/ruby-phone'
VER = '3.47.0'
WRITE = '--write' in sys.argv
def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()
def wr(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)
raw = json.loads(rd('tools/iter105_items.json'))
assert raw['version'] == VER
items = raw['items']
assert len(items) == 26
i12 = items[12]
assert i12.startswith('【抓真缺陷一 · '), i12[:40]
items[12] = '【本版自己抓到的产品侧真缺陷 · ' + i12[1:]
assert '自己抓到' in items[12]
i25 = items[25]
assert i25.count('语法 577 文件') == 1
items[25] = i25.replace('语法 577 文件', '语法 578 文件')
assert '577' not in items[25]
for it in items:
    assert isinstance(it, str) and it.startswith('【') and '】' in it
    assert '[' not in it and ']' not in it
assert any(('版本升至 ' + VER + chr(65288) + '五源同源' + chr(65289)) in x for x in items)
assert any(('自己抓到的缺陷' in x or '本版自己抓到' in x or '缺陷形态' in x) for x in items)
assert any(('交棒改写' in x or '主动改写' in x or '下限形' in x) for x in items)
seg = rd('tools/iter105_seg.md')
seg_lines = seg.rstrip(chr(10)).split(chr(10))
assert seg_lines[0].startswith('## 迭代 105 ')
new_seg = chr(10).join([seg_lines[0]] + ['- **' + it + '**' for it in items]) + chr(10)
assert new_seg.count('## 迭代 105 ') == 1
assert '语法 578 文件' in new_seg and '语法 577 文件' not in new_seg
idx = rd('index.js')
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
mb = BLOCK_RE.search(idx)
assert mb
lines = ['const ST_PHONE_CURRENT_UPDATE = {', '    version: ST_PHONE_VERSION,', '    date: "2026-10-11",', '    items: [']
for it in items:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines += ['    ]', '};']
new_idx = idx[:mb.start()] + chr(10).join(lines) + idx[mb.end():]
assert new_idx.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
for it in items:
    assert json.dumps(it, ensure_ascii=False) in new_idx
log = json.loads(rd('update-log.json'))
assert log['latest'] == VER and list(log['versions'])[0] == VER
new_log = json.loads(json.dumps(log))
new_log['versions'][VER]['items'] = items
itlog = rd('ITERATION_LOG.md')
m = re.search(r'## 迭代 105 [\s\S]*?(?=\n## 迭代 104 )', itlog)
assert m
new_itlog = itlog[:m.start()] + new_seg.rstrip(chr(10)) + chr(10) + chr(10) + itlog[m.end():]
assert new_itlog.count('## 迭代 105 ') == 1
assert '语法 578 文件' in new_itlog
assert m.group(0).count('语法 577 文件') >= 1
print('== dry-run 摘要 ==')
print('items[12] ->', items[12][:60])
print('items[25] 语法读数 ->', '578 文件' if '语法 578 文件' in items[25] else '?')
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
raw['items'] = items
wr('tools/iter105_items.json', json.dumps(raw, ensure_ascii=False, indent=2) + chr(10))
wr('tools/iter105_seg.md', new_seg)
wr('index.js', new_idx)
wr('update-log.json', json.dumps(new_log, ensure_ascii=False, indent=2) + chr(10))
wr('ITERATION_LOG.md', new_itlog)
print('已落盘')
