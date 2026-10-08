#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o9_chain2.py — 修正门链顺序：两道新门**必须排在 upstream-face 之前**。

由来：本仓既有判据 `tests/system-v3203.test.mjs` 的 A1 要求
  `check 链必须以 upstream-face 收尾`（第三道门是**跨仓面对账**，
  它要读全仓的声明↔真码，放在最后才看得到完整面）。
第一版把它们追加到链尾 ⇒ A1 当场报红。**这条判据是对的、我的排法是错的**，
故按它的口径把两道新门插到 upstream-face 前面，三源一并重写。
"""
import io
import json
import os
import re

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in __import__('sys').argv
NL = chr(10)
TAIL_ANCHOR = 'upstream-face'
NEW = ['named-import', 'screen-host']


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, s):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(s)


pkg = json.loads(rd('package.json'))
order = [m.group(1) for m in re.finditer(r'npm run ([a-z-]+)', pkg['scripts']['check'])]
order = [g for g in order if g not in NEW]
assert TAIL_ANCHOR in order, '尾锚不在链上，先看真源'
at = order.index(TAIL_ANCHOR)
new_order = order[:at] + NEW + order[at:]
chain = ' && '.join('npm run ' + g for g in new_order)
pkg['scripts']['check'] = chain

b = json.loads(rd('config/gate-budget.json'))
assert set(b['gates'].keys()) == set(order) | set(NEW), '预算表键集与链不同源'
b['gates'] = {k: b['gates'][k] for k in new_order}
b['total_ms'] = sum(g['ms'] for g in b['gates'].values())

doc = rd('CONTEXT.md')
CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五']
cnt_cn = CN[len(new_order)]
new_lines = [
    '- `npm run check` = **%s道子门**串联：' % cnt_cn
    + ' → '.join('`%s`' % n for n in new_order[:5]),
    '  → ' + ' → '.join('`%s`' % n for n in new_order[5:]) + '。',
]
m = re.search(r'- `npm run check` = \*\*[一二三四五六七八九十]+道子门\*\*串联：.*?' + NL
              + r'  → .*?' + NL, doc, re.S)
assert m, 'CONTEXT.md 转写行锚点未命中'
if WRITE:
    wr('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + NL)
    wr('config/gate-budget.json', json.dumps(b, ensure_ascii=False, indent=2) + NL)
    wr('CONTEXT.md', doc.replace(m.group(0), NL.join(new_lines) + NL, 1))
    print('[write] 门数 =', len(new_order), '尾门 =', new_order[-1])
    print('[write] 顺序 =', ' → '.join(new_order))

# 自证三源
pkg2 = json.loads(rd('package.json'))
real = re.findall(r'npm run ([a-z-]+)', pkg2['scripts']['check'])
b2 = json.loads(rd('config/gate-budget.json'))
assert real == list(b2['gates'].keys()), '链与预算表顺序不同源'
assert real[-1] == TAIL_ANCHOR, '★ 尾门必须仍是 ' + TAIL_ANCHOR
assert b2['total_ms'] == sum(g['ms'] for g in b2['gates'].values()), 'total_ms 不自洽'
d2 = rd('CONTEXT.md')
seg_at = d2.find('道子门**串联：')
seg = d2[seg_at:d2.find('。', seg_at)]
names = re.findall(r'`([a-z-]+)`', seg)
assert names == real, 'CONTEXT 转写与真源不同：%s vs %s' % (names, real)
assert re.search(r'\*\*[一二三四五六七八九十]+道子门\*\*', d2), '数量词必须在场'
print('[self-check] 三源同源 ✓ 门数 =', len(real), '尾门 =', real[-1])