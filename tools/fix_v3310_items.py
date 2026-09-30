#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_v3310_items.py — 把本轮新发现同步进 v3.31.0 的三处派生物（逐字同源）。

背景：抬版落盘后又跑出两条真问题（产品侧 `date-view.js` 的 `/"/g` 击穿、判据侧 K3 误报与
H4 越界口径），处置完单套件已 33/33 全绿；条目正文必须跟着更新，否则：
  · 条目还写着「一处在产品侧、一处在判据侧」，与事实不符（实际是两处产品侧、三处判据侧）；
  · `update-log.json` / `index.js` 公告块 / `ITERATION_LOG.md` 三处必须逐字同源（测试强制）。

纪律：条目真源只有一处 —— `tools/iter89_items.json`；其余三处**从它现场生成**，不手抄。
"""
import io
import json
import os
import re

ROOT = '/home/user/ruby-phone'
V = '3.31.0'


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, text):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(text)


raw = json.loads(rd('tools/iter89_items.json'))
assert raw['version'] == V and len(raw['items']) == 10
items = raw['items']

new6 = rd('/tmp/item6_new.txt').strip()
assert new6.startswith('【本版抓到并修掉的东西') and '\n' not in new6
assert items[5].startswith('【本版抓到并修掉的东西'), '第 6 条位置必须是「抓到并修掉的东西」那条'
assert items[5] != new6
items[5] = new6
raw['items'] = items

# 自证：六条 marker + 批次纪律仍在（V1 判据会查）
joined = '\n'.join(items)
for mk in ['约会', '出资', '读不到', 'AA', '注入', '历史', '单套件']:
    assert mk in joined, mk
wr('tools/iter89_items.json', json.dumps(raw, ensure_ascii=False, indent=2) + '\n')

# ── ① update-log ──
log = json.loads(rd('update-log.json'))
assert log['latest'] == V
log['versions'][V]['items'] = items
wr('update-log.json', json.dumps(log, ensure_ascii=False, indent=2) + '\n')

# ── ② index.js 公告块（与条目逐字同源） ──
DATE = log['versions'][V]['date']
idx = rd('index.js')
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
mb = BLOCK_RE.search(idx)
assert mb, '公告块必须可提取'
lines = ['const ST_PHONE_CURRENT_UPDATE = {',
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in items:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines += ['    ]', '};']
idx_new = idx[:mb.start()] + '\n'.join(lines) + idx[mb.end():]
assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
for it in items:
    assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目'
wr('index.js', idx_new)

# ── ③ tools/iter89_seg.md 的那条 bullet ──
seg = rd('tools/iter89_seg.md')
old_bullet = '\n'.join([l for l in seg.split('\n') if l.startswith('- **本版抓到并修掉的东西')])
assert old_bullet, '段文档里必须有「抓到并修掉的东西」那条'
seg_new = seg.replace(old_bullet, '- **抓到并修掉的东西**：' + new6[new6.index('】') + 1:])
assert seg_new != seg
assert seg_new.startswith('## 迭代 89 — ')
wr('tools/iter89_seg.md', seg_new)

# ── ④ ITERATION_LOG.md 的迭代 89 段（按下一个段头截断） ──
itlog = rd('ITERATION_LOG.md')
start = itlog.index('## 迭代 89 — ')
nxt = itlog.index('\n## ', start)
itlog_new = itlog[:start] + seg_new.rstrip('\n') + '\n' + itlog[nxt:]
assert itlog_new.count('## 迭代 89 — ') == 1
assert itlog_new.count('## 迭代 88 — ') == 1
wr('ITERATION_LOG.md', itlog_new)

print('条目第 6 条已更新（%d 字）；update-log / 公告块 / 段文档 / 迭代日志四处已重生成' % len(new6))
print('公告块字节数', len(lines and '\n'.join(lines).encode('utf-8')))
print('ITERATION_LOG 字节数', os.path.getsize(os.path.join(ROOT, 'ITERATION_LOG.md')))