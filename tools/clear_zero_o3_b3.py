#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.97.0 · R11-O3 第三批] 手术式清账：三件内核（commission-pipeline /
district-network / reading-studio）接线后，从三张冻结账本移除其条目。
禁用两门的 --update（会全量重写并吞掉其他冻结条目的 reason），改为点删：
  - dead-export-baseline.json : file 命中三内核的条目（15 条）
  - bind-dead-baseline.json   : file 命中三内核的条目（17 条）
  - dead-module-baseline.json : tier=zero 且 rel 命中三内核（3 条）
幂等：已在场才删，不在场 skip；AST 校验后写盘。"""
import json, ast, sys

REPO = '/home/user/ruby-phone'
KEYS = ('commission-pipeline', 'district-network', 'reading-studio')
DRY = '--write' not in sys.argv

def hit(s):
    return any(k in str(s) for k in KEYS)

def clean(path, match):
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    d = json.loads(raw)
    src = ast.parse(raw)
    entries = d['entries'] if isinstance(d, dict) and 'entries' in d else d
    before = len(entries)
    kept = [e for e in entries if not match(e)]
    removed = before - len(kept)
    if isinstance(d, dict) and 'entries' in d:
        d['entries'] = kept
        out = d
    else:
        out = kept
    print(f'{path.split("/")[-1]}: {before} -> {len(kept)} (removed {removed})')
    return out, removed, src

changed = []
d1, r1, _ = clean(f'{REPO}/scripts/dead-export-baseline.json',
                  lambda e: hit(e.get('file')))
changed.append(('scripts/dead-export-baseline.json', d1, r1))
d2, r2, _ = clean(f'{REPO}/scripts/bind-dead-baseline.json',
                  lambda e: hit(e.get('file')))
changed.append(('scripts/bind-dead-baseline.json', d2, r2))
d3, r3, _ = clean(f'{REPO}/scripts/dead-module-baseline.json',
                  lambda e: e.get('tier') == 'zero' and hit(e.get('rel')))
changed.append(('scripts/dead-module-baseline.json', d3, r3))

total = r1 + r2 + r3
print(f'total removed: {total}')
if DRY:
    print('DRY-RUN（加 --write 落盘）')
    sys.exit(0)
for path, data, _ in changed:
    with open(f'{REPO}/{path}', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    # 写后回读校验
    json.load(open(f'{REPO}/{path}', encoding='utf-8'))
print('WRITTEN + 回读校验通过')
