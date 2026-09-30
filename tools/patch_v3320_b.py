#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_b.py — v3.32.0 抬版连带面修复（第二批）：update-log.json + index.js 公告块

背景：`tools/bump_v3320.py` 的入口前置是 `assert log['latest'] == PREV(3.31.0)`，
而本次要补的是**已经抬完版**的那一版 —— 重跑抬版脚本会当场拒判。故本批只做**定点补丁**：
把 `tools/iter90_items.json`（已由 patch_a.py 修到 14 条）**整份**作为当版条目，
同时写进 update-log 与 index.js 的公告块 —— 两者逐字同源（仓内一贯约定，判据强制）。

为什么不「只追加三条」：条目真源是唯一真相，公告块由它生成；只追加会留下
「真源 14 条 / 产物 11 条」这类静默分叉，而 update-log 与公告块恰恰是本仓
被逐字比的两个面（v312 的当版切片 / v3171 E1 / v3201 E1 / v3213 G2 / v328 D2 都读它们）。

自证（任一不过即拒判，不落盘）：
  · entry.date 与条目真源一致；条目 14 条且与真源逐字相同；
  · index.js 里 const ST_PHONE_CURRENT_UPDATE 恰 1 处，块可提取；
  · **切片自证**：公告块里第一个 `]` 必须落在 items 数组闭合处（v324 A4 与 v312 的
    「按首个 ] 截断」取头部判据依赖这一点），且 14 条逐字都能在头部里读到；
  · 存量未动：公告块之外的一切字节与替换前逐字相同。

用法：python3 tools/patch_v3320_b.py            # dry-run
      python3 tools/patch_v3320_b.py --write    # 落盘
"""
import json
import os
import re
import sys

ROOT = '/home/user/ruby-phone'
VER = '3.32.0'
WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)


# ────────────────────── ① 条目真源 ──────────────────────
raw = json.loads(rd('tools/iter90_items.json'))
assert isinstance(raw, dict) and raw['version'] == VER, '条目真源版本应为 ' + VER
ITEMS = raw['items']
assert len(ITEMS) == 14, '条目真源应为 14 条（11 条本体 + 收尾条 + 交棒条 + 边界条），实得 %d' % len(ITEMS)
_DATE = raw['date']
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it, '第 %d 条必须非空' % (i + 1)
    assert '\n' not in it and '\r' not in it and '\t' not in it, '第 %d 条含控制字符' % (i + 1)
    assert not ('[' in it or ']' in it), '第 %d 条含方括号（会提前截断切片取头部的判据）' % (i + 1)

# ────────────────────── ② update-log.json ──────────────────────
log_rel = 'update-log.json'
log = json.loads(rd(log_rel))
assert log['latest'] == VER, log['latest']
assert list(log['versions'])[0] == VER, '当版条目必须在首位'
entry = log['versions'][VER]
assert entry['date'] == _DATE, '日期须与条目真源同源'
OLD_ITEMS = entry['items']
assert len(OLD_ITEMS) == 11, '补丁前当版条目应为 11 条，实得 %d' % len(OLD_ITEMS)
assert OLD_ITEMS[0] == ITEMS[0] and OLD_ITEMS[8] == ITEMS[8], \
    '存量条目必须逐字未动（本补丁只动第 10 条与新增三条）'
entry['items'] = ITEMS
new_log = {'latest': log['latest'], 'versions': log['versions'], 'head': log.get('head', log['latest'])}
assert list(new_log['versions'])[0] == VER

# ────────────────────── ③ index.js 公告块 ──────────────────────
idx_rel = 'index.js'
idx = rd(idx_rel)
assert "const ST_PHONE_VERSION = '%s';" % VER in idx, '入口版本常量须已是 ' + VER
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
m = BLOCK_RE.search(idx)
assert m, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
assert idx.count('const ST_PHONE_CURRENT_UPDATE = {') == 1, '公告块必须恰 1 处'
old_block = m.group(0)
lines = ['const ST_PHONE_CURRENT_UPDATE = {',
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % _DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines.append('    ]')
lines.append('};')
new_block = '\n'.join(lines)
idx_new = idx[:m.start()] + new_block + idx[m.end():]
assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1

# ────────────────────── 自证 ──────────────────────
for i, it in enumerate(ITEMS):
    lit = json.dumps(it, ensure_ascii=False)
    assert idx_new.count(lit) == 1, '公告块必须逐字含第 %d 条恰 1 次' % (i + 1)
assert idx_new.count('date: "%s"' % _DATE) == 1
seg = idx_new[idx_new.index('const ST_PHONE_CURRENT_UPDATE'):]
head = seg[:seg.index(']') + 1]
assert head.endswith(']'), '第一个 ] 必须落在 items 数组闭合处'
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in head, '切片头部必须读得到每一条'
assert head.count(']') == 1, '头部切片不得提前截断'
assert '版本升至 %s（五源同源）' % VER in head, '落地行必须带当版升级声明'
assert '运行时验证边界' in head and '看起来没坏但显示不对' in head, '用户可见边界条必须在头部里'
assert idx_new[:m.start()] == idx[:m.start()], '公告块之前的字节必须未动'
assert idx_new[m.start() + len(new_block):] == idx[m.end():], '公告块之后的字节必须未动'

print('== dry-run ==')
print('update-log[%s].items: %d → %d 条' % (VER, len(OLD_ITEMS), len(ITEMS)))
print('index.js 公告块: %d → %d 字节' % (len(old_block), len(new_block)))
print('头部切片长度 %d' % len(head))
print('第 10 条头部：', ITEMS[9][:34])
print('三条新增：', ITEMS[11][:22], '/', ITEMS[12][:22], '/', ITEMS[13][:22])
if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)
wr(log_rel, json.dumps(new_log, ensure_ascii=False, indent=2) + '\n')
wr(idx_rel, idx_new)
print('已写', log_rel, os.path.getsize(os.path.join(ROOT, log_rel)))
print('已写', idx_rel, os.path.getsize(os.path.join(ROOT, idx_rel)))