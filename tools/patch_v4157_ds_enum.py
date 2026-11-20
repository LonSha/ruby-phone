#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4157_ds_enum.py — 设计系统收编后，三份「探针读数基线」的现场复算写回。

为什么需要这一步：本仓三套取证基线（schedule_conflict / branch_play / long_chat）
都把「枚举面文件数」这类读数**逐字**记在 JSON 里，判据（A2/FM1）要求现场复算与之逐项相等。
设计系统收编让扫描面 +1/+2 个文件（scripts/gen-legacy-layer.mjs 与 phone/ 下新模块），
读数因此漂移。纪律是「读数零手抄」：所以这里**跑探针、把探针吐出来的值写回基线**，
一个数字都不在本脚本里硬写；写完把这次刷新记进 rebuilds / refreshed_at / refresh_note。

用法：
    python3 tools/patch_v4157_ds_enum.py            # 干跑，只报差异
    python3 tools/patch_v4157_ds_enum.py --write    # 落盘
"""
import io
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, 'tests', 'audit')
WRITE = '--write' in sys.argv
NL = chr(10)
NOTE = ('设计系统收编后现场复算：扫描面 +1/+2 文件（scripts/gen-legacy-layer.mjs 与 phone/ 下新模块），'
        '枚举面读数随之漂移；本行数字由探针当场跑出来写回，非手抄。')

# (基线文件名, 探针文件名, 探针输出 -> 基线 readings 的驼峰->蛇形映射表)
CASES = [
    ('schedule_conflict_baseline.json', 'schedule_conflict_probe.cjs', {
        'filesScanned': 'files_scanned',
        'consumePoints': 'consume_points',
        'consumeFiles': 'consume_files',
        'localEngineHits': 'local_engine_hits',
    }, {'consumeFiles': 'consume_files'}),
    ('branch_play_baseline.json', 'branch_play_probe.cjs', {
        'filesScanned': 'files_scanned',
        'rollbackPoints': 'rollback_points',
        'rollbackFiles': 'rollback_files',
        'rollbackEntryDefs': 'rollback_entry_defs',
        'checkpointFaceHits': 'checkpoint_face_hits',
        'previewFaceHits': 'preview_face_hits',
        'branchFaceHits': 'branch_face_hits',
        'upstreamGlobalReadSites': 'upstream_global_read_sites',
        'chatDataPatterns': 'chat_data_patterns',
        'namespaceStoreSites': 'namespace_store_sites',
    }, {'rollbackFilesList': 'rollback_files_list'}),
]


def run_probe(name):
    out = subprocess.run(['node', os.path.join(AUDIT, name), '--json'],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit('[patch] 探针跑挂了：%s -> %s' % (name, (out.stderr or '')[-300:]))
    return json.loads(out.stdout)


def main():
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    total = 0
    for base_name, probe_name, num_map, list_map in CASES:
        rep = run_probe(probe_name)
        path = os.path.join(AUDIT, base_name)
        with io.open(path, encoding='utf-8') as f:
            base = json.load(f)
        changed = []
        readings = base['readings']
        for ck, sk in num_map.items():
            if ck not in rep:
                continue
            if sk in rep:                       # 有些键探针直接给蛇形
                live = rep[sk]
            elif isinstance(rep.get(ck), list):
                continue
            else:
                live = rep[ck]
            if readings.get(sk) != live:
                changed.append('%s: %r -> %r' % (sk, readings.get(sk), live))
                readings[sk] = live
        for ck, bk in list_map.items():
            if ck in rep and base.get(bk) != rep[ck]:
                changed.append('%s: 列表 %d 项 -> %d 项' % (bk, len(base.get(bk) or []), len(rep[ck])))
                base[bk] = rep[ck]
        # 这两套的 criteria 是人写散文 + 探针机读摘要两种形状，形状不同（探针那份没有 got_text），
        # 覆盖它等于把判据散文换成 undefined —— 所以 criteria 一个都不碰；散文由 readings 复算判据（FM1）自己看守。
        # 刻意不碰 verdict：基线里的 verdict 是人写的判定/替代轴散文（C1/C2 判据看守），
        # 探针那份是机读摘要，覆盖它等于把结论面换掉。
        if changed:
            base['refreshed_at'] = now
            base['refresh_note'] = NOTE
            if not isinstance(base.get('rebuilds'), dict):
                base['rebuilds'] = {}
            base['rebuilds']['ds-v3'] = {'why': NOTE, 'diff': changed}
        print('[patch] %s: %d 处差异' % (base_name, len(changed)))
        for c in changed:
            print('   - ' + c)
        total += len(changed)
        if WRITE and changed:
            with io.open(path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(base, ensure_ascii=False, indent=2) + NL)
            print('   => 已写入')
    # long_chat：探针直接把 readings / criteria / timing_criteria / scan / sites 都吐出来
    rep = run_probe('long_chat_probe.cjs')
    path = os.path.join(AUDIT, 'long_chat_baseline.json')
    with io.open(path, encoding='utf-8') as f:
        base = json.load(f)
    changed = []
    for key in ('readings', 'criteria', 'scan'):
        # 刻意不碰：timing_criteria（计时不可复算，判据 A3 已排除）、sites（行号面，判据不比）、verdict（只比 answer）。
        if key in rep and base.get(key) != rep[key]:
            changed.append('%s: 漂移（按探针重写）' % key)
            base[key] = rep[key]
    if changed:
        base['refreshed_at'] = now
        base['refresh_note'] = NOTE
        if not isinstance(base.get('rebuilds'), dict):
            base['rebuilds'] = {}
        base['rebuilds']['ds-v3'] = {'why': NOTE, 'diff': changed}
    print('[patch] long_chat_baseline.json: %d 处差异' % len(changed))
    for c in changed:
        print('   - ' + c)
    total += len(changed)
    if WRITE and changed:
        with io.open(path, 'w', encoding='utf-8') as f:
            f.write(json.dumps(base, ensure_ascii=False, indent=2) + NL)
        print('   => 已写入')
    print('[patch] 合计 %d 处；%s' % (total, '已落盘' if WRITE else '干跑（加 --write 生效）'))
    return 0


if __name__ == '__main__':
    sys.exit(main())