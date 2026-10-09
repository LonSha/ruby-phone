#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refresh_baselines_v3790.py — v3.79.0 抬版后的探针基线对账（现场读数写回，零手抄）。

和 v3.75.0 那版的分工：那版建了 R-O5 规模基线并把三份旧基线的**计数格**对平；
本版只做 v3.79.0 抬版带来的枚举面漂移（+2 个新真源：config/motion.js、config/perf-sampler.js），
但由于那份工具的对账只能治 `readings` / `scan`，**治不了判据散文**，
于 v3.79.0 抬版后暴露出三处红：v327 的 A2/FM1（L5 的 files=385 → 387）与
v325/v326 的 A2（files_scanned 384 → 386）。

本版补齐那一格：对账时**同时**做 `criteria[*].got_text` ↔ 探针现场 `gotText` 的同款比较，
口径与 tests/system-v325/326/327 的 assertMainCriteria / assertLongChatCriteria **逐字同规**：
  · 逐条按 id 对齐（id 或条数不同即报错，不静默）；
  · 现场值命中 /未复核|冻结证据|（冻结）/ 的**冻结面跳过**（跨仓探针不硬依赖兄弟仓在场）；
  · 其余不一致才写回，并打印旧值→新值（幂等：已同源则一行不动）。

纪律：probe rc!=0 即中止不写；只在现场与基线不同才写盘；不碰首测版的 `measured_at`。
"""
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
FROZEN_RE = ('未复核', '冻结证据', '（冻结）')

PAIRS = [
    ('tests/audit/schedule_conflict_baseline.json', 'tests/audit/schedule_conflict_probe.cjs', 'files_scanned'),
    ('tests/audit/branch_play_baseline.json', 'tests/audit/branch_play_probe.cjs', 'files_scanned'),
    ('tests/audit/long_chat_baseline.json', 'tests/audit/long_chat_probe.cjs', 'scan.files'),
]


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def write_json(rel, obj):
    wr(rel, json.dumps(obj, ensure_ascii=False, indent=1) + NL)


def run_probe(rel):
    r = subprocess.run(['node', rel, '--json'], cwd=ROOT, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise SystemExit('[refresh] 探针 %s rc=%d：%s' % (rel, r.returncode, (r.stderr or '')[:300]))
    return json.loads(r.stdout)


def camel(s):
    p = s.split('_')
    return p[0] + ''.join(x[:1].upper() + x[1:] for x in p[1:])


def scalars(x, y):
    """两侧都是标量才可比 —— 这格防的是「基线记计数、现场给名单」。
    活标本：schedule 基线的 `readings.consume_files` 是 6（计数），
    而探针现场的同名字段是 6 个文件路径的**名单**（consumeFiles）；
    不做这层判断，对账会把 int 键改写成 list，A2 的 deepEqual 当场炸。"""
    for v in (x, y):
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            return False
    return True


def sync_readings(doc, live, changed):
    """把基线 readings 的每个键按现场同名字（camel）对平；不一致即记入 changed。"""
    rd_block = doc.get('readings') or {}
    for k, v in list(rd_block.items()):
        jk = camel(k)
        if jk in live and live[jk] != v and scalars(v, live[jk]):
            changed.append('readings.%s %s → %s' % (k, v, live[jk]))
            rd_block[k] = live[jk]
    doc['readings'] = rd_block


def sync_criteria(doc, live, changed):
    """判据散文 ↔ 现场 gotText 同款对账（口径与三份套件的 assertMainCriteria 逐字同规）。"""
    base_crit = doc.get('criteria') or []
    live_crit = live.get('criteria') or []
    if len(base_crit) != len(live_crit):
        raise SystemExit('[refresh] 判据条数与现场不同（%d vs %d）—— 不静默，先人工核' % (len(base_crit), len(live_crit)))
    lm = {}
    for c in live_crit:
        lm[str(c.get('id'))] = c
    for b in base_crit:
        cid = str(b.get('id'))
        l = lm.get(cid)
        if l is None:
            raise SystemExit('[refresh] 现场缺判据 ' + cid)
        lg = l.get('gotText', l.get('got_text'))
        if lg is None:
            continue
        lg = str(lg)
        if any(t in lg for t in FROZEN_RE):
            continue
        bpass = b.get('pass')
        lpass = l.get('pass')
        if bpass != lpass and bpass is not None and lpass is not None:
            changed.append('criteria[%s].pass %s → %s' % (cid, bpass, lpass))
            b['pass'] = lpass
        if str(b.get('got_text')) != lg:
            changed.append('criteria[%s].got_text %s → %s' % (cid, str(b.get('got_text'))[:48], lg[:48]))
            b['got_text'] = lg
    doc['criteria'] = base_crit


def main():
    total = 0
    for base_rel, probe_rel, key in PAIRS:
        live = run_probe(probe_rel)
        doc = json.loads(rd(base_rel))
        changed = []
        # ① 计数格
        if key == 'scan.files':
            new_scan = live.get('scan') or {}
            old_scan = doc.get('scan') or {}
            for k, v in old_scan.items():
                if k in new_scan and new_scan[k] != v and not isinstance(v, (list, dict)):
                    changed.append('scan.%s %s → %s' % (k, v, new_scan[k]))
            doc['scan'] = new_scan
        # ② readings 全体对平（含 files_scanned —— 上一步的处理互不重叠，见 scalars 注释）
        sync_readings(doc, live, changed)
        # ③ 判据散文对平（本版新增的那一格）
        sync_criteria(doc, live, changed)
        if not changed:
            print('[refresh] %s：已与现场同源，跳过' % base_rel)
            continue
        total += len(changed)
        for line in changed:
            print('[refresh] %s：%s' % (base_rel, line))
        if WRITE:
            write_json(base_rel, doc)
            print('[refresh] %s → 已写盘（%d 处）' % (base_rel, len(changed)))
        else:
            print('[refresh] %s → （dry）需写盘（%d 处）' % (base_rel, len(changed)))
    print('[refresh] 合计待写 %d 处' % total)
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
