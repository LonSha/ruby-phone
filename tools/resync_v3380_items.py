#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""resync_v3380_items.py — v3.38.0 收干后在**已抬版**状态上重新同源四处条目面。
为什么不回滚版本号：抬版已经发生，回滚会让 update-log 首位 / manifest / index.js 常量
三处一起动，多一倍风险；本脚本只把**条目正文**这一面在四处同步重算：
  ① update-log.json 的 versions['3.38.0'].items（19 条，新正文）
  ② index.js 的 ST_PHONE_CURRENT_UPDATE 公告块（19 条同类目字面量）
  ③ ITERATION_LOG.md 的迭代 96 段（由 tools/iter96_seg.md 重算后整段替换）
纪律：先在内存里做完三处替换，逐项断言后再落盘；锚点各恰中 1 次。
"""
import io
import json
import re
import sys

ROOT = '/home/user/ruby-phone'
VER = '3.38.0'


def rd(rel):
    with io.open(ROOT + '/' + rel, encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(ROOT + '/' + rel, 'w', encoding='utf-8') as f:
        f.write(s)


ITEMS = [x.strip() for x in rd('tools/_blob3380.txt').split('\n%%\n') if x.strip()]
assert len(ITEMS) == 19, '条目数必须 19，实得 %d' % len(ITEMS)

# ① update-log.json（保持最新键仍在首位、latest/head 不动）
log = json.loads(rd('update-log.json'))
assert list(log['versions'])[0] == VER and log['latest'] == VER and log['head'] == VER, '本版必须仍为当版'
log['versions'][VER]['items'] = ITEMS
wr('update-log.json', json.dumps(log, ensure_ascii=False, indent=2) + '\n')

# ② index.js 公告块（只换 items 段，版本 / 日期行不动）
idx = rd('index.js')
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
m = BLOCK_RE.search(idx)
assert m, '公告块必须可提取'
blk = idx[m.start():m.end()]
vm = re.search(r"version: ST_PHONE_VERSION,\n    date: \"([^\"]+)\",\n    items: \[", blk)
assert vm, '公告块形态必须为 version/date/items'
new_blk = ('const ST_PHONE_CURRENT_UPDATE = {\n'
           '    version: ST_PHONE_VERSION,\n'
           '    date: "%s",\n'
           '    items: [\n' % vm.group(1)
           + ''.join('        ' + json.dumps(it, ensure_ascii=False) + ',\n' for it in ITEMS)
           + '    ]\n};')
idx2 = idx[:m.start()] + new_blk + idx[m.end():]
assert idx2.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx2, '公告块缺条目：' + it[:16]
wr('index.js', idx2)

# ③ ITERATION_LOG.md：迭代 96 段整段替换（段内容由 iter96_seg.md 重算）
import subprocess
r = subprocess.run(['python3', 'tools/gen_iter96_seg.py'], cwd=ROOT, capture_output=True, text=True)
assert r.returncode == 0, r.stdout + r.stderr
print('  ' + r.stdout.strip().replace('\n', ' | '))
SEG = rd('tools/iter96_seg.md').rstrip('\n')
itlog = rd('ITERATION_LOG.md')
start = itlog.index('## 迭代 96 — ')
end = itlog.index('## 迭代 95 — ')
old_seg = itlog[start:end]
itlog2 = itlog[:start] + SEG + '\n\n' + itlog[end:]
assert itlog2.count('## 迭代 96 — ') == 1, '迭代 96 段必须恰 1 处'
assert itlog2.count('## 迭代 95 — ') == 1
assert '看起来没坏但显示不对' in itlog2, '迭代段必须带同源标志语'
wr('ITERATION_LOG.md', itlog2)

print('① update-log %s items = %d 条' % (VER, len(ITEMS)))
print('② index.js 公告块 items = %d 条' % len(ITEMS))
print('③ ITERATION_LOG 迭代 96 段 %d → %d 字节' % (len(old_seg), len(SEG)))
print('四处条目面已同源重算（版本面未动）')