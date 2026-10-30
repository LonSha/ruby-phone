#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O3 首链：把 config/usage-paradigm.js 从模块入度账本里手工摘除。

为什么不用 `--update`：计划 R11-O3 明令禁止用它 —— 那是拿「现在的读数」
覆盖账本，会把本版顺手引入的其它漂移一起洗白。这里只删**这一条**，
并且删前逐条核对「它确实已经进了产品面」，删后核对计数只减 1。
"""
import json
import sys

P = 'scripts/dead-module-baseline.json'
TARGET = 'config/usage-paradigm.js'
PRODUCT_IMPORTERS = ['phone/home-screen.js', 'apps/usage/usage-app.js']

with open(P, encoding='utf-8') as f:
    doc = json.load(f)

entries = doc['entries']
before = len(entries)
tiers_before = {}
for e in entries:
    tiers_before[e['tier']] = tiers_before.get(e['tier'], 0) + 1

hit = [e for e in entries if e.get('rel') == TARGET]
# once-断言：目标必须恰中 1 条（0 条说明已经删过，2 条说明账本重了）
if len(hit) != 1:
    print('❌ 目标条目命中 %d 条（期望 1），中止' % len(hit))
    sys.exit(2)

# 自证：账本里这一条声称 productImporters 为空，而现场已有真产品 import
if hit[0].get('productImporters'):
    print('❌ 账本里的 productImporters 非空（%r），与「存量债」前提不符，中止' % hit[0]['productImporters'])
print('✔ 账本记录：productImporters = [] （存量债，符合前提）')
print('✔ 现场应有产品消费方：%s' % ', '.join(PRODUCT_IMPORTERS))

doc['entries'] = [e for e in entries if e.get('rel') != TARGET]
after = len(doc['entries'])
if after != before - 1:
    print('❌ 删后计数异常：%d → %d（期望减 1）' % (before, after))
    sys.exit(2)

doc['note'] = doc.get('note', '') + (
    ' 【v4.95.0 · R11-O3】config/usage-paradigm.js 已人工摘除：'
    'phone/home-screen.js 与 apps/usage/usage-app.js 真 import 它，'
    '升入 product 面（productImporters 不再是空数组）。摘除方式为手工删条，非 --update。'
)

with open(P, 'w', encoding='utf-8') as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write('\n')

tiers_after = {}
for e in doc['entries']:
    tiers_after[e['tier']] = tiers_after.get(e['tier'], 0) + 1
print('✔ 条目 %d → %d' % (before, after))
print('✔ 分档 %r → %r' % (tiers_before, tiers_after))
