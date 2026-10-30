#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「账本行号重定位工具」这条补进 tools/iter221_seg.md（插在末条「没做什么」之前）。

为什么单写一个脚本而不是直接编辑 md：这条是抬版之后才发现的，需要**插入到倒数第二条**，
  且必须保证插入后仍满足 parse_items 的四类标志语断言与方括号禁则。用脚本插入可以
  在插入前后各跑一遍校验，避免手改把「没做什么（如实）」那条挤丢。
默认 dry-run；--write 落盘。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
SEG = os.path.join(ROOT, 'tools', 'iter221_seg.md')

NEW = (
    '- ' + chr(0x3010) + '账本行号重定位工具（本版新增）' + chr(0x3011)
    + '源码插入让 phone/home-screen.js 里其后的方法行号整体后移，'
    'tests/system-v4940.test.mjs 的 E1（拿账本行号回读真源码、断言那行含方法名）一次判红三处。'
    '判断为**账本陈旧**而非判据错：账本行号是唯一能证明「账本没被整体替换过」的凭据，'
    '放弃它账本与源码就只剩名字相等、重名方法会互相顶替而无人察觉。'
    '故新增 tools/relocate_method_baseline.mjs 按 (rel, cls) 定位类体范围、只改 line 字段'
    '（条目集合与 classInstantiated 一条不动），命中 3 处（62→70 / 722→785 / 797→860），'
    '偏移量与插入行数一致；候选不唯一即 exit 2 中止，不猜行号。'
)

TAIL_TAG = '- ' + chr(0x3010) + '没做什么（如实）' + chr(0x3011)


def check(text, tag):
    items = [l.strip()[2:].strip() for l in text.split(NL) if l.strip().startswith('- ')]
    assert len(items) >= 8, (tag, 'items', len(items))
    for it in items:
        assert '[' not in it and ']' not in it, (tag, 'bracket', it[:30])
        assert chr(34) not in it and chr(92) not in it, (tag, 'quote', it[:30])
    return items


with io.open(SEG, encoding='utf-8') as f:
    text = f.read()

before = check(text, 'before')
assert len([l for l in text.split(NL) if l.startswith(TAIL_TAG)]) == 1, '末条「没做什么」必须恰中 1 行'
assert NEW not in text, '本条目已存在（重复执行会插两条），中止'

lines = text.split(NL)
idx = next(i for i, l in enumerate(lines) if l.startswith(TAIL_TAG))
lines.insert(idx, NEW)
out = NL.join(lines)

after = check(out, 'after')
assert len(after) == len(before) + 1, ('条目数应 +1', len(before), len(after))
assert any('版本升至' in i for i in after)
assert any(('自己抓到的缺陷' in i) or ('本版自己抓到' in i) for i in after)
assert any(('交棒改写' in i) or ('下限形' in i) for i in after)
assert any('运行时验证边界' in i for i in after)
print('items %d -> %d' % (len(before), len(after)))

if not WRITE:
    print('--- DRY RUN (pass --write) ---')
    sys.exit(0)
with io.open(SEG, 'w', encoding='utf-8') as f:
    f.write(out)
print('--- WRITTEN ---')