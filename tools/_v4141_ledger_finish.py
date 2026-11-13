#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v4.141.0 台账收尾（R21-O2 批次 A · 全部按既有纪律，零手抄读数）：
  1) update-log.json：item 8 文件名笔误 v4110→v4141；head→4.141.0；versions 首键=当版；
  2) index.js ST_PHONE_CURRENT_UPDATE：date + items 与 update-log 当版逐字同源；
  3) ITERATION_LOG.md：前置 迭代 262 · v4.141.0（items 逐字同源）；
  4) TODO.md：顶部「最近更新」换挡到 v4.141.0；
  5) scripts/doc-path-claim-planned-deliverables.json：两条已落地交付物移出台账
     （doc-path-claim-audit 的裁决原文：已落地在磁盘，须移出台账并改用真实文件判据）。
"""
import json
import re
import io

def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()

def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)

# ---------- 1) update-log.json ----------
u = json.loads(rd('update-log.json'))
items = [it.replace('tests/system-v4110.test.mjs', 'tests/system-v4141.test.mjs')
         for it in u['versions']['4.141.0']['items']]
u['versions']['4.141.0']['items'] = items
u['head'] = '4.141.0'
if list(u['versions'].keys())[0] != '4.141.0':
    nv = {'4.141.0': u['versions']['4.141.0']}
    for k, v in u['versions'].items():
        if k != '4.141.0':
            nv[k] = v
    u['versions'] = nv
wr('update-log.json', json.dumps(u, ensure_ascii=False, indent=2) + '\n')
print('[1] update-log.json: head=%s, first-key=%s, item8-filename=%s' % (
    u['head'], list(u['versions'].keys())[0],
    'v4141' if 'system-v4141' in items[7] else 'STILL-v4110'))

# ---------- 2) index.js ST_PHONE_CURRENT_UPDATE ----------
idx = rd('index.js')
start = idx.index('const ST_PHONE_CURRENT_UPDATE = {')
end = idx.index('};', start)
block = idx[start:end]
mdate = re.search(r'date: "([0-9-]+)"', block)
block = block[:mdate.start()] + 'date: "2026-11-12"' + block[mdate.end():]
i2 = block.index('items: [')
j2 = block.index(']', i2)   # items 内无 ASCII 右方括号（判据明文约束），首个 ] 即数组收口
new_items = ',\n'.join('        ' + json.dumps(it, ensure_ascii=False) for it in items)
block = block[:i2] + 'items: [\n' + new_items + ',\n    ' + block[j2 + 1:]
idx = idx[:start] + block + idx[end:]
wr('index.js', idx)
print('[2] index.js: ST_PHONE_CURRENT_UPDATE items=%d 条（与 update-log 逐字同源），date=2026-11-12' % len(items))

# ---------- 3) ITERATION_LOG.md ----------
seg = '## 迭代 262 · v4.141.0 · 第二十一期批次 A 第一步 R21-O2：内容时间轴收口 + 收口进度机器读数（2026-11-12）\n'
for it in items:
    seg += '- ' + it + '\n'
seg += '\n'
log = rd('ITERATION_LOG.md')
if '## 迭代 262 · v4.141.0' not in log:
    wr('ITERATION_LOG.md', seg + log)
print('[3] ITERATION_LOG.md: 迭代 262 前置完成（items 逐字同源）')

# ---------- 4) TODO.md ----------
todo = rd('TODO.md')
lines = todo.split('\n')
replaced = False
for i, ln in enumerate(lines):
    if '最近更新：v4.140.0' in ln:
        lines[i] = '> **最近更新：v4.141.0**（第二十一期批次 A 第一步 R21-O2：内容时间轴 6 处规格点 story 档收口 + 实勘新增 5 文件 7 处，白名单「待收口」字样清零；新增收口进度机器读数与诊断台进度行，判据四组 19 条全绿）'
        replaced = True
        break
assert replaced, 'TODO.md 未找到「最近更新：v4.140.0」行'
wr('TODO.md', '\n'.join(lines))
print('[4] TODO.md: 最近更新 → v4.141.0')

# ---------- 5) planned-deliverables.json ----------
PL = 'scripts/doc-path-claim-planned-deliverables.json'
p = json.loads(rd(PL))
drop = {'tools/gen_time_debt_readings.mjs', 'tests/audit/time_debt_readings.json'}
before = len(p['entries'])
p['entries'] = [e for e in p['entries'] if e.get('path') not in drop]
wr(PL, json.dumps(p, ensure_ascii=False, indent=2) + '\n')
print('[5] planned-deliverables.json: %d → %d 条（移出已落地的 %s）' % (
    before, len(p['entries']), ', '.join(sorted(drop))))
print('ALL DONE')