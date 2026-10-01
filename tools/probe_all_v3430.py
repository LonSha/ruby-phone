#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_all_v3430.py — [v3.43.0] 四份活基线 + 两处文档/散文读数：现场真跑取数。

为什么要这个脚本（本仓纪律「零手抄」）：
    抬版后基线里的读数必须**现场跑探针取回**，不许人肉把数字抄进 JSON ——
    抄错一项就是「看起来没坏但显示不对」。本脚本只做三件事：
      ① 跑四个探针（lifecycle_declarative / long_chat / memory_growth / branch_play）；
      ② 现场数两个门禁的读数（语法门文件数 / 生命周期门类型数）；
      ③ 把结果打成 JSON 打到 stdout（由 tools/rebuild_v3430.py 决定怎么写盘）。
    本脚本**不写任何文件**（只读）—— 写盘一律由 rebuild 脚本做。
"""
import json
import os
import re
import subprocess
import sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)


def run_probe(rel):
    p = os.path.join(ROOT, rel)
    r = subprocess.run(['node', p, '--json'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    out = (r.stdout or '').strip()
    start = out.find('{')
    if r.returncode != 0 or start < 0:
        return {'ok': False, 'rc': r.returncode, 'err': (r.stderr or '')[:400], 'stdout': out[:400]}
    try:
        return {'ok': True, 'data': json.loads(out[start:])}
    except Exception as e:  # noqa
        return {'ok': False, 'rc': r.returncode, 'err': 'json: %s' % e, 'stdout': out[:400]}


def count_syntax_files():
    """语法门真跑读数：走 npm run syntax 并解析它自报的文件数。"""
    r = subprocess.run(['npm', 'run', 'syntax'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    txt = (r.stdout or '') + (r.stderr or '')
    m = re.search(r'(\d+)\s*个?\s*文件', txt) or re.search(r'files[^0-9]{0,6}(\d+)', txt)
    return {'rc': r.returncode, 'n': (int(m.group(1)) if m else None), 'tail': txt.strip().split(NL)[-3:]}


def count_lifecycle():
    r = subprocess.run(['npm', 'run', 'lifecycle'], cwd=ROOT, capture_output=True, text=True, timeout=600)
    txt = (r.stdout or '') + (r.stderr or '')
    m = re.search(r'扫描\s*(\d+)\s*个含生命周期出口的 App 类', txt)
    return {'rc': r.returncode, 'classes': (int(m.group(1)) if m else None),
            'tail': txt.strip().split(NL)[-2:]}


def main():
    out = {'probes': {}, 'syntax': count_syntax_files(), 'lifecycle': count_lifecycle()}
    for rel in ['tests/audit/lifecycle_declarative_probe.cjs', 'tests/audit/long_chat_probe.cjs',
                'tests/audit/memory_growth_probe.cjs', 'tests/audit/branch_play_probe.cjs']:
        out['probes'][rel] = run_probe(rel)
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())