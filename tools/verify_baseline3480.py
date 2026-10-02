#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# verify_baseline3480.py — v3.48.0 抬版后四份活基线**幂等只读**复核。
# 与 verify_baseline3410.py 同款：不写任何文件，只断言状态。
#   ① 四份基线都带本版 rebuilds 段（且上一版段仍在）；
#   ② file 字段未被改写（四份各写自己的路径，long_chat 为历史探针名口径）；
#   ③ 本版应有的增量全到位（lifecycle +1 App / 空参签名 +1；storage 前缀面 +6；枚举面 +3）；
#   ④ 消费文件 / 回滚文件名单与上一版逐字一致（防「数对了但文件换了」）；
#   ⑤ **幂等面**：四个探针重跑一遍，基线读数必须与现场一致（干跑不差一格）。
# 用法：python3 tools/verify_baseline3480.py
import json
import os
import subprocess

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.48.0'
PREV = 'v3.47.0'
NL = chr(10)


def load(name):
    with open(os.path.join(AUDIT, name + '_baseline.json'), encoding='utf-8') as f:
        return json.load(f)


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def live(name):
    r = subprocess.run(['node', 'tests/audit/%s_probe.cjs' % name, '--json'],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, 'probe %s rc=%d %s' % (name, r.returncode, r.stderr[-400:])
    return json.loads(r.stdout)


def pct(x):
    return round(float(x) * 100, 1)

# —————— 本版增量：从现场文件量出来，不写字面量 ——————
APP_DIR = 'apps/uterus'
NEW_JS = sorted(f for f in os.listdir(os.path.join(ROOT, APP_DIR)) if f.endswith('.js'))
N_NEW_JS = len(NEW_JS)
STOR = rd('config/storage.js').split(NL)
i0 = next(i for i, l in enumerate(STOR) if l.strip().startswith('// [v3.48.0] 子宫画板'))
i1 = next(i for i, l in enumerate(STOR) if l.strip() == '/^uterus_/,')
STOR_ADDED = i1 - i0 + 1


def prevval(rebuild, base, k):
    """上一版 rebuilds 段只登记**变化项**；不入变化表即为未变（取当版值）。
    未变项既可能在基线顶层（如 scan.files），也可能在 readings 下。"""
    r = rebuild.get('readings', {})
    if k in r:
        return r[k]
    for root in (base.get('readings', {}), base):
        cur = root
        ok = True
        for part in k.split('.'):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                ok = False
                break
        if ok:
            return cur
    raise KeyError(k)


checks = []

# ---------- 1. lifecycle ----------
l = load('lifecycle_declarative')
lc = l['rebuilds'][V]
checks.append(('lifecycle 带本版段', V in l['rebuilds']))
checks.append(('lifecycle file 字段为本份', l['file'] == 'tests/audit/lifecycle_declarative_baseline.json'))
checks.append(('lifecycle 增量只列应动的键',
               set(lc['readings']) <= {'app_classes', 'slots', 'app_slots', 'app_slot_share_pct', 'sig_empty'}))
for k, d in (('app_classes', 1), ('slots', 1), ('app_slots', 1), ('sig_empty', 1)):
    checks.append(('lifecycle %s = 上版 +%d' % (k, d),
                   l['readings'][k] - prevval(l['rebuilds'][PREV], l, k) == d))
checks.append(('lifecycle 占比随之上移',
               l['readings']['app_slot_share_pct'] > prevval(l['rebuilds'][PREV], l, 'app_slot_share_pct')))
crit = {c['id']: c for c in l['criteria']}
checks.append(('lifecycle 两条硬否决仍在（判定不得装绿）',
               crit['R2']['pass'] is False and crit['R3']['pass'] is False))
checks.append(('lifecycle 判定仍为不实施（not_done）', 'not_done' in l['verdict']['answer']))
checks.append(('lifecycle 上一版段仍在', PREV in l['rebuilds']))

# ---------- 2. schedule ----------
s = load('schedule_conflict')
sc = s['rebuilds'][V]
checks.append(('schedule 带本版段', V in s['rebuilds']))
checks.append(('schedule file 字段为本份', s['file'] == 'tests/audit/schedule_conflict_baseline.json'))
checks.append(('schedule 本次变化只有枚举面', set(sc['readings']) == {'files_scanned'}))
checks.append(('schedule 枚举面 = 上版 + 新件 .js 数（%d）' % N_NEW_JS,
               s['readings']['files_scanned'] - prevval(s['rebuilds'][PREV], s, 'files_scanned') == N_NEW_JS))
checks.append(('schedule 消费点 / 消费文件 / 本地引擎命中一格未动',
               s['readings']['consume_points'] == prevval(s['rebuilds'][PREV], s, 'consume_points') and
               s['readings']['consume_files'] == prevval(s['rebuilds'][PREV], s, 'consume_files') and
               s['readings']['local_engine_hits'] == prevval(s['rebuilds'][PREV], s, 'local_engine_hits')))
checks.append(('schedule readings.consume_files 是计数（%d 个，不为名单）' % s['readings']['consume_files'],
               isinstance(s['readings']['consume_files'], int) and
               s['readings']['consume_files'] == len(s['consume_files'])))
checks.append(('schedule 上一版段仍在', PREV in s['rebuilds']))

# ---------- 3. branch ----------
b = load('branch_play')
bc = b['rebuilds'][V]
checks.append(('branch 带本版段', V in b['rebuilds']))
checks.append(('branch file 字段为本份', b['file'] == 'tests/audit/branch_play_baseline.json'))
checks.append(('branch 会话隔离前缀面 = 上版 + 现场 storage 本版段行数（%d）' % STOR_ADDED,
               b['readings']['chat_data_patterns'] - prevval(b['rebuilds'][PREV], b, 'chat_data_patterns') == STOR_ADDED))
checks.append(('branch 枚举面 = 上版 + 新件 .js 数（%d）' % N_NEW_JS,
               b['readings']['files_scanned'] - prevval(b['rebuilds'][PREV], b, 'files_scanned') == N_NEW_JS))
checks.append(('branch 分支面仍为 0', b['readings']['branch_face_hits'] == 0))
checks.append(('branch 回滚点 / 文件 / 入口定义一格未动',
               b['readings']['rollback_points'] == prevval(b['rebuilds'][PREV], b, 'rollback_points') and
               b['readings']['rollback_files'] == prevval(b['rebuilds'][PREV], b, 'rollback_files') and
               b['readings']['rollback_entry_defs'] == prevval(b['rebuilds'][PREV], b, 'rollback_entry_defs')))
checks.append(('branch 上一次变更只有枚举面与前缀面',
               set(bc['readings']) <= {'files_scanned', 'chat_data_patterns'}))
checks.append(('branch 回滚文件名单与上一版逐字一致',
               b['rollback_files_list'] == ['apps/phone/phone-data.js', 'apps/wangxiang/wangxiang-app.js',
                                            'apps/wechat/wechat-data.js', 'index.js']))
checks.append(('branch 上游面仍为冻结值（未当作绿）',
               b['readings']['upstream_modules_scanned'] == prevval(b['rebuilds'][PREV], b, 'upstream_modules_scanned')))
checks.append(('branch 上一版段仍在', PREV in b['rebuilds']))

# ---------- 4. long_chat ----------
q = load('long_chat')
qc = q['rebuilds'][V]
checks.append(('long_chat 带本版段', V in q['rebuilds']))
checks.append(('long_chat file 字段为探针名（历史口径）', q['file'] == 'tests/audit/long_chat_probe.cjs'))
checks.append(('long_chat 枚举面 = 上版 + 新件 .js 数（%d）' % N_NEW_JS,
               q['scan']['files'] - prevval(q['rebuilds'][PREV], q, 'scan.files') == N_NEW_JS))
checks.append(('long_chat 四类站点计数未变',
               q['scan']['full_materialize'] == 9 and q['scan']['bounded_slice'] == 5 and
               q['scan']['indexed_loop'] == 11 and q['scan']['length_read'] == 48))
l5 = next(c for c in q['criteria'] if c['id'] == 'L5')
checks.append(('long_chat L5 散文已刷到本版枚举面（files=%d）' % q['scan']['files'],
               ('files=%d' % q['scan']['files']) in l5['got_text']))
checks.append(('long_chat 判据刷新如实登记', 'L5' in qc['criteria_refreshed']))
checks.append(('long_chat 上一版段仍在', PREV in q['rebuilds']))

# ---------- 5. 幂等面：探针重跑与基线一致 ----------
lv = live('lifecycle_declarative')
checks.append(('幂等 lifecycle 重跑一致',
               l['readings']['app_classes'] == lv['appClasses'] and
               l['readings']['slots'] == lv['slots'] and
               l['readings']['app_slots'] == lv['appSlots'] and
               l['readings']['sig_empty'] == lv['signatures']['empty'] and
               l['readings']['app_slot_share_pct'] == pct(lv['appSlotShare'])))
sv = live('schedule_conflict')
checks.append(('幂等 schedule 重跑一致',
               s['readings']['files_scanned'] == sv['filesScanned'] and
               s['readings']['consume_points'] == sv['consumePoints'] and
               s['consume_files'] == sv['consumeFiles']))
bv = live('branch_play')
checks.append(('幂等 branch 重跑一致',
               b['readings']['files_scanned'] == bv['filesScanned'] and
               b['readings']['chat_data_patterns'] == bv['chatDataPatterns'] and
               b['rollback_files_list'] == bv['rollbackFilesList']))
qv = live('long_chat')
checks.append(('幂等 long_chat 重跑一致',
               q['scan'] == {k: qv['scan'][k] for k in q['scan']} and
               q['readings'] == qv['readings']))

ok = True
for name, val in checks:
    print('  %s %s' % ('OK ' if val else 'XX ', name))
    ok = ok and bool(val)
print('')
print('ALL OK (%d 项)' % len(checks) if ok else 'HAS FAILURES')
raise SystemExit(0 if ok else 1)
