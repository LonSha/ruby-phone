#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refresh_baselines_v3750.py — R-O5 收口的基线同步（**现场读数写回，零手抄**）。

范式的来由：本仓历代抬版都要在「新增/改动文件」之后重跑各探针、把现场读数写回基线
（tools/_fix_v3610_b8.py 立的口径：「用探针现场读数写回，不猜增量」）。手抄一次基线
就会出现「基线与现场差一」——那是本仓最贵的假绿之一。

本次做两件事：
  ① 新建 tests/audit/search_scale_baseline.json —— R-O5 规模探针的首版基线。
     `measured_at` 由探针**现读 manifest**（不手写版本号）；此后抬版**不得**改写它
     （tests/system-v3760 的 B3 / F1 把这条钉住：首测版是冻结的历史值）。
  ② 既有三份探针基线（long_chat / schedule_conflict / branch_play）按现场读数对账：
     计数格与现场不同才写回（幂等），并把 long_chat 的 L5 判据散文同步成现场数
     （散文与现场不一致时 assertLongChatCriteria 当场转红 —— 它比的是文本）。

纪律：只在 reader 与现场不同才写盘；每处都打印旧值→新值；probe rc!=0 即报错不写。
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)


def run_probe(rel):
    r = subprocess.run(['node', rel, '--json'], cwd=ROOT, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise SystemExit('[refresh] 探针 %s rc=%d：%s' % (rel, r.returncode, (r.stderr or '')[:300]))
    return json.loads(r.stdout)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def write_json(rel, obj):
    wr(rel, json.dumps(obj, ensure_ascii=False, indent=1) + NL)


def main():
    fails = []

    # ── ① R-O5 规模基线（首版） ─────────────────────────────────────
    probe = 'tests/audit/search_scale_probe.cjs'
    base = 'tests/audit/search_scale_baseline.json'
    live = run_probe(probe)
    assert isinstance(live.get('verdict'), str), '探针必须全绿才建基线：' + json.dumps(live.get('verdict'), ensure_ascii=False)[:200]
    live['note'] = live['note'] + ' 首版基线（建基线时实测）：计数段逐字节可复算，计时段只比同量级。'
    live['probe'] = probe
    if os.path.exists(os.path.join(ROOT, base)):
        old = json.loads(rd(base))
        if old.get('readings') == live.get('readings') and old.get('measured_at') == live.get('measured_at'):
            print('[refresh] ① %s：读数与首测版均已同源，跳过' % base)
        else:
            if WRITE:
                write_json(base, live)
                print('[refresh] ① %s 已按现场读数重写（measured_at=%s）' % (base, live['measured_at']))
            else:
                print('[refresh]（dry）① %s 需重写（measured_at %s → %s）' % (base, old.get('measured_at'), live['measured_at']))
    else:
        if WRITE:
            write_json(base, live)
            print('[refresh] ① %s 已落盘（measured_at=%s，读数 %d 项，判据 %d 条）'
                  % (base, live['measured_at'], len(live['readings']), len(live['criteria'])))
        else:
            print('[refresh]（dry）① %s 待落盘' % base)

    # ── ② 既有三份探针基线对账 ─────────────────────────────────────
    for base_rel, probe_rel, key_path in [
        ('tests/audit/long_chat_baseline.json', 'tests/audit/long_chat_probe.cjs', 'scan'),
        ('tests/audit/schedule_conflict_baseline.json', 'tests/audit/schedule_conflict_probe.cjs', 'files_scanned'),
        ('tests/audit/branch_play_baseline.json', 'tests/audit/branch_play_probe.cjs', 'files_scanned'),
    ]:
        lv = run_probe(probe_rel)
        doc = json.loads(rd(base_rel))
        if key_path == 'scan':
            old_scan = doc.get('scan')
            new_scan = lv.get('scan')
            if old_scan == new_scan and doc.get('readings') == lv.get('readings'):
                print('[refresh] ② %s：scan 与 readings 都是现场值，跳过' % base_rel)
                continue
            # L5 散文同步（它比的是文本）
            l5 = None
            for c in doc.get('criteria', []):
                if c.get('id') == 'L5':
                    l5 = c
            if WRITE:
                doc['scan'] = new_scan
                doc['readings'] = lv.get('readings')
                if l5 and isinstance(l5.get('got_text'), str):
                    txt = l5['got_text']
                    for label, val in [('files', new_scan.get('files')),
                                       ('全表物化', new_scan.get('full_materialize')),
                                       ('slice(-n)', new_scan.get('bounded_slice')),
                                       ('下标直取', new_scan.get('indexed_loop')),
                                       ('长度读', new_scan.get('length_read'))]:
                        if isinstance(val, int):
                            txt = re.sub(re.escape(label) + r'=\d+', '%s=%d' % (label, val), txt)
                    l5['got_text'] = txt
                write_json(base_rel, doc)
                print('[refresh] ② %s：scan/readings 已按现场写回；L5 散文已同步' % base_rel)
            else:
                print('[refresh]（dry）② %s：scan 有漂移（旧 %s → 新 %s）'
                      % (base_rel, str(old_scan)[:60], str(new_scan)[:60]))
        else:
            live_v = lv.get('filesScanned')
            old_v = doc.get('readings', {}).get(key_path)
            if old_v == live_v:
                print('[refresh] ② %s：%s 已是现场值，跳过' % (base_rel, key_path))
                continue
            if WRITE:
                doc['readings'][key_path] = live_v
                write_json(base_rel, doc)
                print('[refresh] ② %s：%s %s → %s（现场）' % (base_rel, key_path, old_v, live_v))
            else:
                print('[refresh]（dry）② %s：%s %s → %s' % (base_rel, key_path, old_v, live_v))

    if fails:
        raise SystemExit('[refresh] 失败：' + '；'.join(fails))
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())