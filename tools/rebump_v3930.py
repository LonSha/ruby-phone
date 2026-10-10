#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rebump_v3930.py — 条目真源变更后，**原地**刷新三处（不重跑抬版脚本：抬版只做一次）。

范式抄自 tools/rebump3340.py（同仓唯一「就地刷新」口径）：
  ① update-log.json 的 versions['3.93.0'].items（indent=2 重建，键序与其余字段不动）；
  ② index.js 的 ST_PHONE_CURRENT_UPDATE 公告块（由真源逐行生成）；
  ③ ITERATION_LOG.md 的迭代 150 段（从段头到下一个段头前整段替换）。

为什么本版需要它：抬版发生在「迭代段还只有 16 条」的时候，
之后补写了两条**本版自己抓到的缺陷**（其中一条是本版新工具自己踩的坑），
条目真源变了 ⇒ 三处必须跟着对平，否则 E1 的「弹窗逐字同源」当场转红。

纪律：先读真源 → 逐份断言锚点唯一 → 最后才落盘；默认干跑。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.93.0'
DATE = '2026-10-16'
SEG_REL = 'tools/iter150_seg.md'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    seg = rd(SEG_REL).rstrip('\n')
    assert seg.startswith('## 迭代 150 — v%s' % VER), 'seg 段头不对'
    items = []
    for line in seg.split('\n'):
        line = line.strip()
        if not line.startswith('- '):
            continue
        it = line[2:].strip()
        if it.startswith('**'):
            it = it[2:]
        if it.endswith('**'):
            it = it[:-2]
        it = it.strip()
        assert it.startswith(chr(0x3010)) and chr(0x3011) in it, it[:24]
        items.append(it)
    print('items = %d' % len(items))

    # ① update-log.json
    log = json.loads(rd('update-log.json'))
    assert log['latest'] == VER and list(log['versions'])[0] == VER, 'update-log 状态不对'
    assert log['head'] == VER
    old_n = len(log['versions'][VER]['items'])
    log['versions'][VER]['items'] = items
    assert log['versions'][VER]['date'] == DATE and log['versions'][VER]['version'] == VER

    # ② index.js 公告块
    idx = rd('index.js')
    m = re.search(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};', idx)
    assert m, '公告块必须可提取'
    lines = ['const ST_PHONE_CURRENT_UPDATE = {',
             '    version: ST_PHONE_VERSION,',
             '    date: "%s",' % DATE,
             '    items: [']
    for i, it in enumerate(items):
        comma = ',' if i < len(items) - 1 else ''
        lines.append('        ' + json.dumps(it, ensure_ascii=False) + comma)
    lines += ['    ]', '};']
    idx_new = idx[:m.start()] + '\n'.join(lines) + idx[m.end():]
    assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
    for it in items:
        assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目：' + it[:20]

    # ③ ITERATION_LOG.md 迭代 150 段
    itlog = rd('ITERATION_LOG.md')
    start = itlog.index('## 迭代 150 — ')
    end = itlog.index('## 迭代 149 — ', start)
    itlog_new = itlog[:start] + seg + '\n\n' + itlog[end:]
    assert itlog_new.count('## 迭代 150 — ') == 1 and itlog_new.count('## 迭代 149 — ') == 1
    assert itlog_new.count('- **当前版本**：`%s`' % VER) == 1

    if '--write' not in sys.argv:
        print('（dry-run）items %d -> %d 段；update-log / index.js / ITERATION_LOG 三处将就地刷新'
              % (old_n, len(items)))
        return 0
    wr('update-log.json', json.dumps(log, ensure_ascii=False, indent=2) + '\n')
    wr('index.js', idx_new)
    wr('ITERATION_LOG.md', itlog_new)
    print('就地刷新完成（三处）items %d -> %d' % (old_n, len(items)))
    return 0


if __name__ == '__main__':
    sys.exit(main())