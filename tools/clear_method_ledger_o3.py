#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O3 首链：把 manageUsageParadigm 从方法面死账本里手工摘除。

为什么不用 `--update`：计划 R11-O3 明令禁止。--update 是拿现场读数整体覆盖账本，
  会把本版顺手引入的其它漂移一并洗白；这里只删**确认已接线**的这一条，
  删前要求「门的复活告警里点名了它」当作自证，删后要求计数只减 1。

⚠️ 顺便记一条踩过的坑：本版公告文案一开始写了方法名 `auditReadability` 作举例，
  该名字因此进入「原文面」被计入存活，账本上记的死方法被一句公告文案写活了。
  这不是判据错（判据的已知边界就是「字符串面提及算活，方向是漏报」），
  但它说明：**公告块属于原文面**，写方法名要当心。那条文案已改为中文描述。
"""
import json
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'scripts', 'dead-method-baseline.json')
WRITE = '--write' in sys.argv
TARGET = {'rel': 'config/subsystem-orchestrator.js', 'cls': 'SubsystemOrchestrator',
          'name': 'manageUsageParadigm'}
# 现场真消费方（接线自证：这两个文件必须真的用到这条链的入口）
# ⚠️ 首版这里写错了断言：查 'manageUsageParadigm'/'UsageParadigm' 字面量，
#   但真实接线根本没提这个字符串——主屏调的是 resolveAppOrder，App 读的是 PARADIGM_KEY，
#   于是断言恒假、把自己挡在门外。改法不是放宽成「随便有个词就算」，
#   而是按链的**入口名**逐个钉（LIVE 为 (rel, 必须出现的入口字面量)）。
LIVE = [('phone/home-screen.js', 'resolveAppOrder'),
        ('apps/usage/usage-app.js', 'PARADIGM_KEY')]

with io.open(P, encoding='utf-8') as f:
    doc = json.load(f)

entries = doc['entries']
before = len(entries)
hit = [e for e in entries
       if e.get('rel') == TARGET['rel'] and e.get('cls') == TARGET['cls'] and e.get('name') == TARGET['name']]
if len(hit) != 1:
    print('❌ 目标条目命中 %d 条（期望 1），中止' % len(hit))
    sys.exit(2)
print('✔ 账本条目：%s:%d %s.%s（classInstantiated=%s）'
      % (hit[0]['rel'], hit[0]['line'], hit[0]['cls'], hit[0]['name'], hit[0].get('classInstantiated')))

# 接线自证：现场消费方必须真的提到它，否则删的是冤账
missing = []
for rel, token in LIVE:
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        if token not in f.read():
            missing.append('%s(缺 %s)' % (rel, token))
if missing:
    print('❌ 这些文件读不到接线痕迹，拒绝删账：%r' % missing)
    sys.exit(2)
print('✔ 接线自证：%s' % ', '.join('%s#%s' % (r, t) for r, t in LIVE))

doc['entries'] = [e for e in entries if e is not hit[0]]
after = len(doc['entries'])
if after != before - 1:
    print('❌ 删后计数异常：%d → %d' % (before, after))
    sys.exit(2)
doc['note'] = doc.get('note', '') + (
    ' 【v4.95.0 · R11-O3】SubsystemOrchestrator.manageUsageParadigm 已人工摘除：'
    '产品端真接线（phone/home-screen.js 调 resolveAppOrder、apps/usage/usage-app.js 读范式键），'
    '门的复活告警点名了它。摘除方式为手工删条，非 --update。'
)
print('✔ 条目 %d → %d' % (before, after))

if not WRITE:
    print('--- DRY RUN (pass --write) ---')
    sys.exit(0)
with io.open(P, 'w', encoding='utf-8') as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('--- WRITTEN ---')