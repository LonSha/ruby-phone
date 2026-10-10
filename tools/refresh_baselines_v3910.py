#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refresh_baselines_v3910.py — v3.91.0 抬版后的探针基线对账（现场读数写回，零手抄）。

抬版带来的枚举面漂移（R-X6 真实缺口落地）：
  · 新增真源：config/workflow.js、config/workflow-runtime.js
  · 新增产品面：apps/creationdesk/creationdesk-app.js（App 类）
    、apps/workflow/workflow-view.js、apps/workflow/ 接线、config/apps.js 登记
  · 新增判据：tests/system-v3890.test.mjs

受影响的三格：
  ① v325 / v326 的 A2 —— readings.files_scanned（扫全树文件数）；
  ② v327 的 A2 / FM1 —— scan.files 与 criteria[L5].got_text 里的 files= 字样
     （判据散文与现场同源，**散文也得跟着对平**，这正是 v3.79.0 那版补的那一格）；
  ③ v324 的 A2 / D4 —— readings.app_classes 与 readings.sig_empty：
     WorkflowApp 带 onChatChanged() 无参出口 ⇒ App 类 78→79、无参出口 68→69。
     D4 的「破坏后 empty 必须多 1」是**相对**判据（R.sig_empty + 1），故基线对平即可自愈。

纪律与 v3.79.0 那版逐字同规：
  · 探针 rc!=0 即中止不写；
  · 只在现场与基线不同才写盘（幂等：已同源则一行不动）；
  · 判据散文逐条按 id 对齐，条数不同即报错不静默；
  · 现场值命中「未复核 / 冻结证据 / （冻结）」的冻结面跳过；
  · 标量才可对平（防「基线记计数、现场给名单」的 int↔list 误写）。
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
    ('tests/audit/lifecycle_declarative_baseline.json', 'tests/audit/lifecycle_declarative_probe.cjs', 'app_classes'),
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
    r = subprocess.run(['node', rel, '--json'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise SystemExit('[refresh] 探针 %s rc=%d：%s' % (rel, r.returncode, (r.stderr or '')[:300]))
    return json.loads(r.stdout)


def camel(s):
    p = s.split('_')
    return p[0] + ''.join(x[:1].upper() + x[1:] for x in p[1:])


def scalars(x, y):
    for v in (x, y):
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            return False
    return True


# 嵌套与异名（探针把签名/路径分组成对象，基线把它们平铺成下划线键）
NESTED = {
    'sig_empty': ('signatures', 'empty'),
    'sig_default': ('signatures', 'def'),
    'sig_required': ('signatures', 'required'),
    'sig_none': ('signatures', 'none'),
    'points_p1': ('pointsByPath', 'P1'),
    'points_p2': ('pointsByPath', 'P2'),
    'points_p3': ('pointsByPath', 'P3'),
}
# 同名异算（现场换了字段名，值语义相同：百分比与一致率）
ALIAS = {
    'app_slot_share_pct': 'appSlotShare',
    'coverage_pct': 'coverage',
    'non_app_share_pct': 'nonAppShare',
    'semantic_consistency_pct': 'semanticConsistency',
}


def live_get(live, key):
    if key in NESTED:
        head, tail = NESTED[key]
        blk = live.get(head)
        return blk.get(tail) if isinstance(blk, dict) else None
    if key in ALIAS:
        return live.get(ALIAS[key])
    jk = camel(key)
    return live.get(jk)


def same_unit(key, base_v, live_v):
    """口径归一：*_pct 在基线里是**百分数形式**（80.6），
    而探针现场给的是**小数形式**（0.8064516...）—— 两者不是漂移，是同一读数的两种写法。
    这一格防的是「对账把可读口径改写成 0.8064516129032258」这种**形式破坏**：
    写回前先按同口径比一次，同口径即视为已同源、一行不动。
    活标本：v3.24.0 基线里 app_slot_share_pct: 87.8，现场 appSlotShare: 0.8791...。
    """
    if key.endswith('_pct') and isinstance(base_v, (int, float)) and isinstance(live_v, (int, float)):
        if abs(live_v) <= 1.0000001:
            return round(live_v * 100.0, 1) == round(float(base_v), 1)
    return False


def sync_readings(doc, live, changed):
    rd_block = doc.get('readings') or {}
    for k, v in list(rd_block.items()):
        lv = live_get(live, k)
        if lv is None or lv == v or not scalars(v, lv):
            continue
        if same_unit(k, v, lv):
            continue
        out = lv
        if k.endswith('_pct') and isinstance(lv, (int, float)) and abs(lv) <= 1.0000001:
            # 真漂移也按基线口径写回（百分数形式，一位小数），不把可读口径改成小数
            out = round(lv * 100.0, 1)
        changed.append('readings.%s %s -> %s' % (k, v, out))
        rd_block[k] = out
    doc['readings'] = rd_block


def sync_criteria(doc, live, changed):
    base_crit = doc.get('criteria') or []
    live_crit = live.get('criteria') or []
    if not base_crit or not live_crit:
        return
    if len(base_crit) != len(live_crit):
        raise SystemExit('[refresh] 判据条数与现场不同（%d vs %d）—— 不静默，先人工核'
                         % (len(base_crit), len(live_crit)))
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
            changed.append('criteria[%s].pass %s -> %s' % (cid, bpass, lpass))
            b['pass'] = lpass
        if str(b.get('got_text')) != lg:
            changed.append('criteria[%s].got_text %s -> %s' % (cid, str(b.get('got_text'))[:48], lg[:48]))
            b['got_text'] = lg
    doc['criteria'] = base_crit


def main():
    total = 0
    for base_rel, probe_rel, key in PAIRS:
        live = run_probe(probe_rel)
        doc = json.loads(rd(base_rel))
        changed = []
        if key == 'scan.files':
            new_scan = live.get('scan') or {}
            old_scan = doc.get('scan') or {}
            for k, v in old_scan.items():
                if k in new_scan and new_scan[k] != v and not isinstance(v, (list, dict)):
                    changed.append('scan.%s %s -> %s' % (k, v, new_scan[k]))
            doc['scan'] = new_scan
        sync_readings(doc, live, changed)
        sync_criteria(doc, live, changed)
        if not changed:
            print('[refresh] %s：已与现场同源，跳过' % base_rel)
            continue
        total += len(changed)
        for line in changed:
            print('[refresh] %s：%s' % (base_rel, line))
        if WRITE:
            write_json(base_rel, doc)
            print('[refresh] %s -> 已写盘（%d 处）' % (base_rel, len(changed)))
        else:
            print('[refresh] %s -> （dry）需写盘（%d 处）' % (base_rel, len(changed)))
    print('[refresh] 合计待写 %d 处' % total)
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
