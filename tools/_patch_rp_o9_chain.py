#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o9_chain.py — 把两道新静态门挂进 check 链 / 预算表 / CONTEXT 转写行。

挂三处（三处必须同源，任何一处漏了都会由既有判据当场报红）：
  ① package.json：新增 named-import / screen-host 两个 script，并加进 scripts.check 链；
  ② config/gate-budget.json：两门各一行预算（含 why），total_ms 按各门 ms 之和重算；
  ③ CONTEXT.md 第 24~25 行：**转写行**（判据 system-v3190 的 C4 会逐字比对本行与真源：
     门名、顺序、中文数量词三者都要对上）。

为什么用脚本而不是手改：手改三处必然漏一处，而漏哪一处都由别的判据报红 ——
但那时人已经以为改完了。落盘脚本 + AST/计数自证，是这套多源同构的标准作业法。
"""
import io
import json
import os
import re
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv
NL = chr(10)

NEW_GATES = [
    ('named-import', 'named-import-check.mjs', 956, 1052,
     '具名导入门要建每个模块的具名导出面，随模块数线性涨'),
    ('screen-host', 'screen-host-check.mjs', 797, 877,
     '外壳宿主门只扫 apps/** 的 render 目标，轻量'),
]


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, s):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(s)


# ─────────── ① package.json ───────────
pkg = json.loads(rd('package.json'))
sc = pkg['scripts']
chain = sc['check']
for name, fname, _ms, _lim, _why in NEW_GATES:
    key = name
    if key not in sc:
        sc[key] = 'node scripts/' + fname
    add = 'npm run ' + key
    if add not in chain:
        chain = chain + ' && ' + add
sc['check'] = chain
if WRITE:
    wr('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + NL)
    print('[1/3] package.json: chain =', len(re.findall(r'npm run [a-z-]+', chain)), '道')

# ─────────── ② gate-budget.json ───────────
b = json.loads(rd('config/gate-budget.json'))
for name, _fname, ms, lim, why in NEW_GATES:
    assert name not in b['gates'], 'already present: ' + name
    b['gates'][name] = {'ms': ms, 'limit_ms': lim, 'why': why}
# 门顺序必须与 check 链同源（判据 F1 用 Object.keys 比 deepEqual）
order = [m.group(1) for m in re.finditer(r'npm run ([a-z-]+)', chain)]
assert set(order) == set(b['gates'].keys()), (
    'check 链与预算表键集不一致：链 %s 预算 %s' % (sorted(order), sorted(b['gates'].keys())))
b['gates'] = {k: b['gates'][k] for k in order}
b['total_ms'] = sum(g['ms'] for g in b['gates'].values())
if WRITE:
    wr('config/gate-budget.json', json.dumps(b, ensure_ascii=False, indent=2) + NL)
    print('[2/3] gate-budget.json: gates =', len(b['gates']), 'total_ms =', b['total_ms'])

# ─────────── ③ CONTEXT.md 转写行 ───────────
doc = rd('CONTEXT.md')
CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五']
cnt_cn = CN[len(order)]
head_names = order[:5]
tail_names = order[5:]
new_lines = [
    '- `npm run check` = **%s道子门**串联：' % cnt_cn
    + ' → '.join('`%s`' % n for n in head_names),
    '  → ' + ' → '.join('`%s`' % n for n in tail_names) + '。',
]
m = re.search(r'- `npm run check` = \*\*[一二三四五六七八九十]+道子门\*\*串联：.*?' + NL
              + r'  → .*?' + NL, doc, re.S)
assert m, 'CONTEXT.md 转写行锚点未命中（口径已变，先看真源再改本条）'
old = m.group(0)
new = NL.join(new_lines) + NL
if WRITE:
    doc = doc.replace(old, new, 1)
    wr('CONTEXT.md', doc)
    print('[3/3] CONTEXT.md: %s道子门 / %s' % (cnt_cn, ' → '.join(order)))
else:
    print('[dry] CONTEXT.md 将写为：')
    print(NL.join(new_lines))

# ─────────── 自证 ───────────
pkg2 = json.loads(rd('package.json'))
real = re.findall(r'npm run ([a-z-]+)', pkg2['scripts']['check'])
b2 = json.loads(rd('config/gate-budget.json'))
assert real == list(b2['gates'].keys()), '链与预算表顺序不同源'
assert b2['total_ms'] == sum(g['ms'] for g in b2['gates'].values()), 'total_ms 不自洽'
d2 = rd('CONTEXT.md')
seg_at = d2.find('道子门**串联：')
seg = d2[seg_at:d2.find('。', seg_at)]
names = re.findall(r'`([a-z-]+)`', seg)
assert names == real, 'CONTEXT 转写与真源不同：%s vs %s' % (names, real)
print('[self-check] 三源同源 ✓ 门数 =', len(real), '顺序 =', real)
