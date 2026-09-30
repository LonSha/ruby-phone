# -*- coding: utf-8 -*-
"""fix_v3290_items.py — 条目改写后，把 3.29.0 的三处派生物重新生成（逐字同源）。

纪律：
  · 条目真源只有一处：tools/iter87_items.json
  · 派生物三处：update-log.json 的当版条目 / index.js 公告块 / ITERATION_LOG.md 的迭代 87 段
  · 不手抄：公告块与段都从条目 json 现场生成
"""
import io
import json
import os
import re

ROOT = '/home/user/ruby-phone'
V = '3.29.0'


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, text):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(text)


ITEMS = json.loads(rd('tools/iter87_items.json'))
assert len(ITEMS) == 13
for it in ITEMS:
    assert '[' not in it and ']' not in it, '弹窗文案不得含方括号（v324 A4）：' + it[:40]

# ── ① update-log ──
log = json.loads(rd('update-log.json'))
assert log['latest'] == V and log['versions'][V]['items'] != ITEMS
log['versions'][V]['items'] = ITEMS
wr('update-log.json', json.dumps(log, ensure_ascii=False, indent=2) + '\n')

# ── ② index.js 公告块 —— 与 bump 脚本同款构造，逐字生成 ──
DATE = log['versions'][V]['date']
idx = rd('index.js')
BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
mb = BLOCK_RE.search(idx)
assert mb, '公告块必须可提取'
lines = ['const ST_PHONE_CURRENT_UPDATE = {',
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines += ['    ]', '};']
idx_new = idx[:mb.start()] + '\n'.join(lines) + idx[mb.end():]
assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目'
wr('index.js', idx_new)

# ── ③ ITERATION_LOG 迭代 87 段 —— 段由条目重生成 ──
HEAD = ('## 迭代 87 — v3.29.0 素材缝合路线图第 2 层第一批第一件：桃宝落地'
        '（源是四合一超级模块，本件取三块）+ 第 2 层范式当场立住'
        '（取机制 → 套三层 → 改持久化）+ 一条自证式取段交棒')
seg_lines = [HEAD]
for it in ITEMS:
    m = re.match(r'^【(.+?)】(.*)$', it, re.S)
    assert m, it[:60]
    seg_lines.append('- **%s**：%s' % (m.group(1), m.group(2)))
seg = '\n'.join(seg_lines) + '\n'
wr('tools/iter87_seg.md', seg)

itlog = rd('ITERATION_LOG.md')
start = itlog.index('## 迭代 87 — ')
nxt = itlog.index('\n## ', start)
old_seg = itlog[start:nxt + 1]
assert old_seg.startswith('## 迭代 87 — v3.29.0')
itlog_new = itlog[:start] + seg + '\n' + itlog[nxt + 1:]   # seg 已带尾换行 ⇒ 再补一行空行与下一段隔开
assert itlog_new.count('## 迭代 87 — ') == 1
assert itlog_new.count('## 迭代 86 — ') == 1
wr('ITERATION_LOG.md', itlog_new)

print('条目 %d 条；公告块重生成；迭代 87 段重生成（%d 字节）' % (len(ITEMS), len(seg.encode())))
print('方括号自证：', sum(1 for it in ITEMS if '[' in it or ']' in it))
