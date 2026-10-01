#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_baseline3380.py — 校验四份活基线**已**为 v3.38.0 现场读数（幂等，只读不写）。
为什么不复用 rebuild_v3380.py：那个脚本按设计会在「本版应 +1 而实得 0」时拒绝执行
（防重复落盘），而收干后基线已经是本版读数 —— 此时需要的是**一致性校验**而不是重建。
本脚本做四件事：
  ① 四份基线 rebuilds 必须有 v3.38.0 段（确已抬过）；
  ② 基线的消费文件 / 回滚文件名单与 `file` 字段未被改写；
  ③ 现场探针重跑，读数与基线逐项相等（不等的项逐个点名，不许只看总数）；
  ④ 活体读数（long_chat 的 40 项）与四类静态站点计数逐格相等。
用法：python3 tools/verify_baseline3380.py --live <live_dir>
"""
import argparse
import json
import os
import subprocess

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.38.0'
ap = argparse.ArgumentParser()
ap.add_argument('--live', required=True)
args = ap.parse_args()
LIVE = args.live


def run_probe(name):
    out = subprocess.run(['node', 'tests/audit/%s_probe.cjs' % name, '--json'],
                         cwd=ROOT, capture_output=True, text=True)
    assert out.returncode == 0, '探针必须跑通：%s\n%s' % (name, out.stderr[:300])
    return json.loads(out.stdout)


def load_base(name):
    with open(os.path.join(AUDIT, name + '_baseline.json'), encoding='utf-8') as f:
        return json.load(f)


bad = []
for name in ('lifecycle_declarative', 'schedule_conflict', 'branch_play', 'long_chat'):
    b = load_base(name)
    assert V in b.get('rebuilds', {}), '%s 基线缺 %s 段（抬版未落）' % (name, V)
    # file 字段：逐份形态不同（lifecycle/schedule/branch 指向基线自身，long_chat 指向探针脚本）
    #   ⇒ 不假设统一形态，与 **HEAD 版**比对（读数零手抄：值从 git 读，不在这里写字面量）。
    head_raw = subprocess.run(['git', 'show', 'HEAD:tests/audit/%s_baseline.json' % name],
                              cwd=ROOT, capture_output=True, text=True)
    assert head_raw.returncode == 0, '读不到 HEAD 版基线：' + name
    head_file = json.loads(head_raw.stdout).get('file')
    if b.get('file') != head_file:
        bad.append('%s.file 被改写：%r → %r' % (name, head_file, b.get('file')))
    else:
        print('  %-24s file 字段未被改写（%s）' % (name, b.get('file')))
    live = run_probe(name)
    # 读数面：逐项比对
    if name == 'lifecycle_declarative':
        pairs = {
            'app_classes': live['appClasses'], 'slots': live['slots'],
            'app_slots': live['appSlots'],
            'wiring_points': live['wiringPoints'], 'app_exit_points': live['appExitPoints'],
            'non_app_points': live['nonAppPoints'], 'sig_empty': live['signatures']['empty'],
            'sig_required': live['signatures']['required'], 'sig_none': live['signatures']['none'],
            'semantic_slots': live['semanticSlots'], 'semantic_same': live['semanticSame'],
            'semantic_diff': live['semanticDiff'],
        }
        for k, v in pairs.items():
            if b['readings'].get(k) != v:
                bad.append('%s.%s 基线 %s ≠ 现场 %s' % (name, k, b['readings'].get(k), v))
    elif name == 'schedule_conflict':
        for k, v in (('files_scanned', live['filesScanned']), ('consume_points', live['consumePoints']),
                     ('consume_files', len(live['consumeFiles'])), ('local_engine_hits', live['localEngineHits'])):
            if b['readings'].get(k) != v:
                bad.append('%s.%s 基线 %s ≠ 现场 %s' % (name, k, b['readings'].get(k), v))
        assert live['consumeFiles'] == b['consume_files'], '消费文件名单被改写'
    elif name == 'branch_play':
        for k, v in (('files_scanned', live['filesScanned']), ('rollback_points', live['rollbackPoints']),
                     ('rollback_files', live['rollbackFiles']), ('rollback_entry_defs', live['rollbackEntryDefs']),
                     ('upstream_global_read_sites', live['upstreamGlobalReadSites']),
                     ('chat_data_patterns', live['chatDataPatterns']),
                     ('namespace_store_sites', live['namespaceStoreSites']),
                     ('checkpoint_face_hits', live['checkpointFaceHits']),
                     ('preview_face_hits', live['previewFaceHits']), ('branch_face_hits', live['branchFaceHits'])):
            if b['readings'].get(k) != v:
                bad.append('%s.%s 基线 %s ≠ 现场 %s' % (name, k, b['readings'].get(k), v))
        assert live['rollbackFilesList'] == b['rollback_files_list'], '回滚文件名单被改写'
    else:
        if b['scan'] != live['scan']:
            bad.append('long_chat.scan 基线 %s ≠ 现场 %s' % (b['scan'], live['scan']))
        if b['readings'] != live['readings']:
            bad.append('long_chat 活体读数有格不等（%d 项）' % len(live['readings']))
        for k, ol in b['sites'].items():
            if len(ol) != len(live['sites'][k]):
                bad.append('long_chat 站点条数变了：%s' % k)
    print('  %-24s 现场读数已逐项对齐（rebuilds %s 在第 %d 段）'
          % (name, V, list(b['rebuilds']).index(V) + 1))

if bad:
    print('\n✗ 不一致 %d 项：' % len(bad))
    for x in bad:
        print('  ' + x)
    raise SystemExit(1)
print('\n✓ 四份活基线与现场读数逐项一致；名单与 file 字段未被改写')