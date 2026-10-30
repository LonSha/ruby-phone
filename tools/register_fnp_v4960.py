#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v4.96.0 第222迭代批次2收口：manageUsageParadigm 退役后，usage-paradigm.js 里
   被它包着的 filterNoticesByParadigm 在产品端随之失去唯一调用者，两道门当场判红：
     - dead-export-check.mjs：97 / 基线 96 / 新增 1
     - bind-consumption-audit.mjs：132 / 基线 131 / 新增 1
   处置：登记冻结，不删。理由：该函数有测试面真消费（tests/eighth-cycle-batch-a.test.mjs
   用它验证按档过滤语义），语义本身成立；缺的是产品接线，属既有冻结存量，
   与「摘账以真调用点为据」口径一致 —— 不为了过门把语义工具删掉。
   两道门都按 file::name 精确匹配、现场重算 dead 集合后比对，条目不匹配即判复活；
   故手工插条必须逐字对齐现场读数（file/name 精确，line 取各自门禁现场报数）。
默认 dry-run；--write 落盘。禁用 --update（不做全量重写，只做手术式加条）。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

REASON = ('usage-paradigm 语义工具（按当前档过滤通知）。v4.96.0 退役假驱动 manageUsageParadigm 后产品端暂无调用者，'
          '但有测试面真消费（tests/eighth-cycle-batch-a.test.mjs），语义成立，冻结待接线。')

NEW = {
    'file': 'config/usage-paradigm.js',
    'name': 'filterNoticesByParadigm',
    'line': 231,
    'reason': REASON,
}

NEW_BIND = {
    'file': 'config/usage-paradigm.js',
    'name': 'filterNoticesByParadigm',
    'line': 208,
    'evidence': 'no-ref',
    'refs': [],
}

TARGETS = [
    ('scripts/dead-export-baseline.json', NEW),
    ('scripts/bind-dead-baseline.json', NEW_BIND),
]

for rel, entry in TARGETS:
    path = os.path.join(ROOT, rel)
    with io.open(path, encoding='utf-8') as f:
        d = json.load(f)
    entries = d['entries']
    key = entry['file'] + '::' + entry['name']
    hit = [e for e in entries if e.get('file') + '::' + e.get('name') == key]
    if hit:
        print('[skip] ' + rel + ': ' + key + ' 已在场')
        continue
    entries.append(entry)
    if WRITE:
        with io.open(path, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('[write] ' + rel + ': ' + str(len(entries) - 1) + ' -> ' + str(len(entries)))
    else:
        print('[dry] ' + rel + ': ' + str(len(entries) - 1) + ' -> ' + str(len(entries)))
if not WRITE:
    print('--- DRY RUN (pass --write) ---')