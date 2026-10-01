#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v3360.py — 抬版 v3.36.0（五源同源）

做什么（与 bump_v3350.py 同款范式）：
  ① update-log.json：新键插**首位**（仓内约定，v3.23.0 踩过「追加末尾」的坑），
     latest / head 同置；
  ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
  ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— **由条目真源生成**（逐字同源，不手抄）；
  ④ ITERATION_LOG.md：头部插迭代 94 段 + 元信息「当前版本」行改当版 +
     头部「N 个版本」由真源重算。
纪律：
  · 本脚本只写上面四处；先算 draft、逐份断言、最后才落盘（一次成型，不留半成品）。
  · 默认 dry-run，`--write` 才落盘。
  · 条目真源**不许含方括号**（v324 门禁：公告块不得含方括号）。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.36.0'
DATE = '2026-10-01'
PREV = '3.35.0'
WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


# ────────────────────────── 条目 ──────────────────────────
_RAW = json.loads(rd('tools/iter94_items.json'))
assert isinstance(_RAW, dict), '条目真源必须是 {version,date,items} 形态'
assert _RAW.get('version') == VER, '条目文件版本字段应为 %s，实得 %s' % (VER, _RAW.get('version'))
assert _RAW.get('date') == DATE, '条目文件日期字段应为 %s' % DATE
ITEMS = _RAW.get('items')
assert isinstance(ITEMS, list) and len(ITEMS) == 19, \
    '条目数必须为 19，实得 %s' % (len(ITEMS) if isinstance(ITEMS, list) else type(ITEMS))
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it, '第 %d 条必须是非空字符串' % (i + 1)
    assert '\n' not in it and '\r' not in it and '\t' not in it, '第 %d 条含控制字符' % (i + 1)
    assert it.startswith('【') and '】' in it, '第 %d 条必须形如【标题】正文' % (i + 1)
    assert '[' not in it and ']' not in it, '第 %d 条含方括号（v324 门禁：公告块不得含方括号）' % (i + 1)

# ────────────────────────── ① update-log.json ──────────────────────────
log_rel = 'update-log.json'
log = json.loads(rd(log_rel))
assert log['latest'] == PREV, '抬版前 latest 应为 %s，实得 %s' % (PREV, log['latest'])
assert list(log['versions'])[0] == PREV, '抬版前首位键应为 %s，实得 %s' % (PREV, list(log['versions'])[0])
assert VER not in log['versions'], '目标版本已存在，禁止重复抬版'
entry = {'version': VER, 'date': DATE, 'items': ITEMS}
new_versions = {VER: entry}
for k, v in log['versions'].items():
    new_versions[k] = v
new_log = {'latest': VER, 'versions': new_versions, 'head': VER}
assert list(new_log['versions'])[0] == VER

# ────────────────────────── ② manifest / package ──────────────────────────
man = json.loads(rd('manifest.json'))
pkg = json.loads(rd('package.json'))
assert man['version'] == PREV and pkg['version'] == PREV, '抬版前 manifest/package 应为 %s' % PREV
man['version'] = VER
pkg['version'] = VER

# ────────────────────────── ③ index.js ──────────────────────────
idx = rd('index.js')
idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
               "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
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
    assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目：' + it[:20]

# ────────────────────────── ④ ITERATION_LOG.md ──────────────────────────
iter_rel = 'ITERATION_LOG.md'
itlog = rd(iter_rel)
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
meta_re = re.compile(r'（\d+ 个版本，')
assert len(meta_re.findall(itlog)) == 1, '头部版本数锚点必须恰中 1 次'
itlog = meta_re.sub('（%d 个版本，' % len(new_versions), itlog)
assert ('（%d 个版本，' % len(new_versions)) in itlog
SEG = rd('tools/iter94_seg.md')
anchor = '## 迭代 93 — '
assert itlog.count(anchor) == 1, '迭代 93 段头锚点必须恰中 1 次，实得 %d' % itlog.count(anchor)
assert SEG.lstrip().startswith('## 迭代 94 — '), 'iter94_seg.md 必须以「## 迭代 94 — 」起头'
itlog = itlog.replace(anchor, SEG.rstrip('\n') + '\n\n' + anchor)
assert itlog.count('## 迭代 94 — ') == 1

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d → %d' % (VER, list(new_log['versions'])[0], len(log['versions']), len(new_versions)))
print('manifest/package: version → %s' % VER)
print('index.js: 常量 + 公告块（%d 条）' % len(ITEMS))
print('ITERATION_LOG: 迭代 94 段 + 当前版本行 + 版本数 %d' % len(new_versions))

if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)

with open(os.path.join(ROOT, log_rel), 'w', encoding='utf-8') as f:
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
with open(os.path.join(ROOT, iter_rel), 'w', encoding='utf-8') as f:
    f.write(itlog)
print('OK 五源已落盘')