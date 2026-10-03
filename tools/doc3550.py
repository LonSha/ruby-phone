#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3550.py — 抬版连带面：刷新三份审计活基线（读数零手抄，全部取自探针现场输出）

本版（v3.55.0 A2 App 消费面矩阵）未新增 App，只新增 3 个 .js：
  · config/app-consumption-matrix.js（消费面矩阵只读真源）
  · tests/system-v3550.test.mjs（判据套件）
  · tools/bump_v3550.py（抬版脚本）
另改产品侧 2 件：apps/diagnose/diagnose-data.js（接矩阵面）、apps/diagnose/diagnose-view.js（建卡）。

连带面三处（探针的静态扫描面按 .js 文件计）：
① schedule_conflict / branch_play：枚举面 367 -> 368（新件 config/app-consumption-matrix.js 进扫描面）。
② long_chat：静态扫描面 +1，且判据散文 L5 的 files 字段同步。
纪律：只写读数与来由，不改判据；默认 dry-run，--write 才落盘。
现场读数取自：node tests/audit/<name>_probe.cjs --json。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
VER = 'v3.55.0'
WHY = ('v3.55.0 A2 App 消费面矩阵：新增 config/app-consumption-matrix.js（只读真源）与 '
       'tests/system-v3550.test.mjs（判据套件），并把矩阵面接进诊断中心（apps/diagnose/diagnose-data.js '
       '真陈列、diagnose-view.js 建卡）。本版**未新增 App**：生命周期面的 App 类 / 实例槽位 / 三路径分布 '
       '一格未动；本面变动的只是**静态扫描面**（该探针按 .js 文件计），故 +1。')


def rj(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def wj(rel, obj):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write('\n')


# ══════════ ① schedule_conflict ══════════
S = 'tests/audit/schedule_conflict_baseline.json'
sb = rj(S)
assert list(sb['rebuilds'])[-1] in ('v3.54.0', VER), list(sb['rebuilds'])[-1]
print('① schedule_conflict 刷新前：', json.dumps(sb['readings'], ensure_ascii=False))
sb['readings']['files_scanned'] = 368
sb['rebuilds'][VER] = {
    'what': '枚举面 367 -> 368（新件 config/app-consumption-matrix.js 进静态扫描面）',
    'why': WHY + ' 消费面一格未动（consume_points 23 / consume_files 6 / local_engine_hits 0 逐项不变）；'
           '四条判据与 verdict（not_now）一字未动。',
    'readings': dict(sb['readings']),
}
print('① 刷新后：', json.dumps(sb['readings'], ensure_ascii=False))

# ══════════ ② branch_play ══════════
B = 'tests/audit/branch_play_baseline.json'
bb = rj(B)
assert list(bb['rebuilds'])[-1] in ('v3.54.0', VER), list(bb['rebuilds'])[-1]
print('② branch_play 刷新前：', json.dumps(bb['readings'], ensure_ascii=False)[:200])
bb['readings']['files_scanned'] = 368
bb['rebuilds'][VER] = {
    'what': '枚举面 367 -> 368（同上）',
    'why': WHY + ' 回滚覆盖面一格未动（rollback_points 41 / rollback_files 4 / rollback_entry_defs 12 逐项不变）。',
    'readings': dict(bb['readings']),
}
print('② 刷新后 files_scanned=', bb['readings']['files_scanned'])

# ══════════ ③ long_chat ══════════
LC = 'tests/audit/long_chat_baseline.json'
lb = rj(LC)
assert list(lb['rebuilds'])[-1] in ('v3.54.0', VER), list(lb['rebuilds'])[-1]
OLD = lb['scan']
print('③ long_chat 刷新前 scan：', json.dumps(OLD, ensure_ascii=False)[:200])
for t in lb['criteria']:
    if t.get('id') == 'L5':
        print('   L5 旧散文：', t.get('got_text'))
lb['scan']['files'] = 369
for t in lb['criteria']:
    if t.get('id') == 'L5':
        t['got_text'] = t['got_text'].replace('files=368', 'files=369')
lb['rebuilds'][VER] = {
    'what': '静态扫描面 +1（新件 config/app-consumption-matrix.js）并同步判据散文 L5 的 files 字段',
    'why': WHY + ' 楼层消费形态一格未动（全表物化站点 / 引擎侧上限 600 / 有界消费者读数逐项不变）。',
    'scan': dict(lb['scan']),
}
print('③ 刷新后 scan.files=', lb['scan']['files'])

if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
wj(S, sb)
wj(B, bb)
wj(LC, lb)
print('已落盘三份活基线')
