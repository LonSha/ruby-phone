#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v3300.py — 抬版 v3.30.0（五源同源）

做什么：
  ① update-log.json：新键插**首位**（仓内约定，v3.23.0 踩过「追加末尾」的坑），latest / head 同置；
  ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
  ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— **由 update-log 条目生成**（逐字同源，不手抄）；
  ④ ITERATION_LOG.md：头部插迭代 86 段 + 元信息「当前版本」行改当版。

纪律：
  · 本脚本只写上面四处；先算 draft、逐份断言、最后才落盘（一次成型的写入不许留半成品）。
  · 默认 dry-run，`--write` 才落盘。
  · 公告块由条目列表 dumps 生成，不做字符串拼贴（条目里含引号也逐字对得上）。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.30.0'
DATE = '2026-10-01'

WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)


# ────────────────────────── 条目（从 tools/iter86_items.json 读入，12 条） ──────────────────────────
ITEMS = json.loads(rd('tools/iter88_items.json'))

assert len(ITEMS) == 14, '条目数必须为 14，实得 %d' % len(ITEMS)

# ────────────────────────── ① update-log.json ──────────────────────────
log_rel = 'update-log.json'
log = json.loads(rd(log_rel))
assert log['latest'] == '3.29.0', '抬版前 latest 应为 3.29.0，实得 ' + str(log['latest'])
assert list(log['versions'])[0] == '3.29.0', '抬版前首位键应为 3.29.0'
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
assert man['version'] == '3.29.0' and pkg['version'] == '3.29.0'
man['version'] = VER
pkg['version'] = VER

# ────────────────────────── ③ index.js ──────────────────────────
idx = rd('index.js')
old_const = "const ST_PHONE_VERSION = '3.29.0';"
assert idx.count(old_const) == 1, '版本常量锚点必须恰中 1 次，实得 %d' % idx.count(old_const)
idx_new = idx.replace(old_const, "const ST_PHONE_VERSION = '%s';" % VER)

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
# 逐字同源自证：公告块里每一条都必须能被 JSON.stringify(it) 找到
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目：' + it[:20]

# ────────────────────────── ④ ITERATION_LOG.md ──────────────────────────
iter_rel = 'ITERATION_LOG.md'
itlog = rd(iter_rel)
old_ver_line = '- **当前版本**：`3.29.0`（五源同源）'
assert itlog.count(old_ver_line) == 1, '元信息版本行锚点必须恰中 1 次'
itlog = itlog.replace(old_ver_line, '- **当前版本**：`%s`（五源同源）' % VER)

# 头部元信息「N 个版本」由真源重算（此前是手写数字，从 v3.26.0 起静默漂移了两版）
meta_re = re.compile(r'（\d+ 个版本，')
assert len(meta_re.findall(itlog)) == 1, '头部版本数锚点必须恰中 1 次'
itlog = meta_re.sub('（%d 个版本，' % len(new_versions), itlog)
assert ('（%d 个版本，' % len(new_versions)) in itlog

SEG = rd('tools/iter88_seg.md')
anchor = '## 迭代 87 — '
assert itlog.count(anchor) == 1, '迭代 87 段头锚点必须恰中 1 次'
itlog = itlog.replace(anchor, SEG.rstrip('\n') + '\n\n' + anchor)
assert itlog.count('## 迭代 88 — ') == 1

# ────────────────────────── 落盘 ──────────────────────────
print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d → %d' % (VER, list(new_log['versions'])[0], len(log['versions']), len(new_versions)))
print('manifest/package: version → %s' % VER)
print('index.js: 常量 + 公告块（%d 条）' % len(ITEMS))
print('ITERATION_LOG: 迭代 88 段 + 当前版本行')
if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)

wr(log_rel, json.dumps(new_log, ensure_ascii=False, indent=2) + '\n')
wr('manifest.json', json.dumps(man, ensure_ascii=False, indent=2) + '\n')
wr('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
wr('index.js', idx_new)
wr(iter_rel, itlog)
print('== 已落盘 ==' + ' latest=%s' % json.loads(rd(log_rel))['latest'])
