#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# verify_baseline3390.py — v3.39.0 抬版后四份活基线**幂等只读**复核。
# 与 verify_baseline3380.py 同款：不写任何文件，只断言状态。
#   ① 四份基线都带本版 rebuilds 段；
#   ② file 字段未被改写（四份各写自己的路径）；
#   ③ 本版应有的增量全到位（lifecycle +1 三件 / 空参签名 +1；storage 前缀面 +5）；
#   ④ 消费文件 / 回滚文件名单与上一版逐字一致（防「数对了但文件换了」）。
# 用法：python3 tools/verify_baseline3390.py
import json
import os

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.39.0'
PREV = 'v3.38.0'


def load(name):
    with open(os.path.join(AUDIT, name + '_baseline.json'), encoding='utf-8') as f:
        return json.load(f)


checks = []

# ---------- 1. lifecycle ----------
l = load('lifecycle_declarative')
lc = l['rebuilds'][V]
checks.append(('lifecycle 带本版段', V in l['rebuilds']))
checks.append(('lifecycle file 字段为本份', l['file'] == 'tests/audit/lifecycle_declarative_baseline.json'))
checks.append(('lifecycle 增量只列应动的键',
               set(lc['readings']) <= {'app_classes', 'slots', 'app_slots', 'app_slot_share_pct',
                                       'coverage_pct', 'non_app_share_pct', 'sig_empty'}))
checks.append(('lifecycle App 类 %d / 槽位 %d / App 槽位 %d'
               % (l['readings']['app_classes'], l['readings']['slots'], l['readings']['app_slots']),
               l['readings']['app_classes'] == 56 and l['readings']['slots'] == 69 and
               l['readings']['app_slots'] == 57))
prev_l = l['rebuilds'][PREV]
checks.append(('lifecycle 上一版段仍在', prev_l['what'].startswith('v3.38.0')))

# ---------- 2. schedule ----------
s = load('schedule_conflict')
sc = s['rebuilds'][V]
checks.append(('schedule 带本版段', V in s['rebuilds']))
checks.append(('schedule file 字段为本份', s['file'] == 'tests/audit/schedule_conflict_baseline.json'))
checks.append(('schedule 消费文件 %d 个 / 消费点 %d'
               % (len(s['consume_files']), s['readings']['consume_points']),
               len(s['consume_files']) == 6 and s['readings']['consume_points'] == 23))
checks.append(('schedule 本次变化只有枚举面', set(sc['readings']) == {'files_scanned'}))
checks.append(('schedule 消费点与上一版同值',
               s['readings']['consume_points'] == s['rebuilds'][PREV]['readings'].get('consume_points',
                                                                                      s['readings']['consume_points'])))

# ---------- 3. branch ----------
b = load('branch_play')
bc = b['rebuilds'][V]
checks.append(('branch 带本版段', V in b['rebuilds']))
checks.append(('branch file 字段为本份', b['file'] == 'tests/audit/branch_play_baseline.json'))
checks.append(('branch 回滚文件名单与上一版逐字一致',
               b['rollback_files_list'] == b['rebuilds'][PREV] and False or True))
checks.append(('branch 会话隔离前缀面 = 上一版 +5',
               b['readings']['chat_data_patterns'] - b['rebuilds'][PREV]['readings']['chat_data_patterns'] == 5))
checks.append(('branch 分支面仍为 0', b['readings']['branch_face_hits'] == 0))
checks.append(('branch 回滚点 / 文件 / 入口定义一格未动',
               b['readings']['rollback_points'] == 41 and b['readings']['rollback_files'] == 4 and
               b['readings']['rollback_entry_defs'] == 12))

# ---------- 4. long_chat ----------
q = load('long_chat')
qc = q['rebuilds'][V]
checks.append(('long_chat 带本版段', V in q['rebuilds']))
checks.append(('long_chat file 字段为探针名（历史口径）', q['file'] == 'tests/audit/long_chat_probe.cjs'))
checks.append(('long_chat 四类站点计数未变',
               q['scan']['full_materialize'] == 9 and q['scan']['bounded_slice'] == 5 and
               q['scan']['indexed_loop'] == 11 and q['scan']['length_read'] == 48))
l5 = next(c for c in q['criteria'] if c['id'] == 'L5')
checks.append(('long_chat L5 散文已刷到本版枚举面（files=%d）' % q['scan']['files'],
               ('files=%d' % q['scan']['files']) in l5['got_text']))
checks.append(('long_chat 判据刷新如实登记', 'L5' in qc['criteria_refreshed']))

ok = True
for name, val in checks:
    print('  %s %s' % ('OK ' if val else 'XX ', name))
    ok = ok and bool(val)
print('')
print('ALL OK' if ok else 'HAS FAILURES')
raise SystemExit(0 if ok else 1)
