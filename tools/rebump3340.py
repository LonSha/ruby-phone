#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rebump3340.py — 条目真源变更后，**原地**刷新三处（不重跑 bump：那是抬版脚本，
抬版只做一次，重复跑会被「目标版本已存在」的断言挡下）。

刷新面（与 bump_v3340.py 的 ①②③④ 同源，只是从「插入」改成「就地替换」）：
  ① update-log.json 的 `versions['3.34.0'].items`（键顺序与其余字段一字不动）；
  ② index.js 的 `ST_PHONE_CURRENT_UPDATE` 公告块（由真源逐行生成）；
  ③ ITERATION_LOG.md 的迭代 92 段（从段头到下一个段头前整段替换）。
纪律：先读真源 → 逐份断言锚点唯一 → 最后才落盘。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.34.0'
DATE = '2026-10-01'


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)


raw = json.loads(rd('tools/iter92_items.json'))
assert raw['version'] == VER and raw['date'] == DATE, '条目真源版本/日期不符'
ITEMS = raw['items']
assert isinstance(ITEMS, list) and len(ITEMS) == 19, len(ITEMS)

# ① update-log.json
log = json.loads(rd('update-log.json'))
assert log['latest'] == VER and list(log['versions'])[0] == VER, 'update-log 状态不对'
assert len(log['versions'][VER]['items']) == 19
log['versions'][VER]['items'] = ITEMS
assert log['versions'][VER]['date'] == DATE and log['versions'][VER]['version'] == VER

# ② index.js 公告块
idx = rd('index.js')
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
mb = BLOCK_RE.search(idx)
assert mb, '公告块必须可提取'
lines = ['const ST_PHONE_CURRENT_UPDATE = {',
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines += ['    ]', '};']
idx_new = idx[:mb.start()] + '\n'.join(lines) + idx[mb.end():]
assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目：' + it[:20]

# ③ ITERATION_LOG.md 迭代 92 段
SEG = rd('tools/iter92_seg.md')
assert SEG.lstrip().startswith('## 迭代 92 — '), 'seg 段头不对'
itlog = rd('ITERATION_LOG.md')
start = itlog.index('## 迭代 92 — ')
end = itlog.index('## 迭代 91 — ', start)
itlog_new = itlog[:start] + SEG.rstrip('\n') + '\n\n' + itlog[end:]
assert itlog_new.count('## 迭代 92 — ') == 1 and itlog_new.count('## 迭代 91 — ') == 1
assert itlog_new.count('- **当前版本**：`%s`（五源同源）' % VER) == 1

if '--write' not in sys.argv:
    print('（dry-run）items %d 段；update-log / index.js / ITERATION_LOG 三处将就地刷新' % len(ITEMS))
    sys.exit(0)

wr('update-log.json', json.dumps(log, ensure_ascii=False, indent=2) + '\n')
wr('index.js', idx_new)
wr('ITERATION_LOG.md', itlog_new)
print('就地刷新完成（三处）')
