#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync_v3750_items.py — 把**当版条目**与迭代段同步成改后的 iter133_seg.md。

来由（本版自己踩到的一处顺序错）：抬版脚本先跑，之后才把「用户可见边界说明」那一条
补进 tools/iter133_seg.md。于是三处仍停在 10 条：update-log 的 3.75.0 items、index.js 的
公告块、ITERATION_LOG 的迭代段。tests/system-v328 的 A2/B1/D2 当场报红 —— 它要的是
「当前版本条目里必须有与文档同源的那句」。

本脚本只做这三处同步，别的字不碰：
  ① update-log.json 的 3.75.0 items = 当版条目（由 seg 解析，零手抄）；
  ② index.js 的 ST_PHONE_CURRENT_UPDATE 公告块重建（复用 bump 里的同一口径）；
  ③ ITERATION_LOG.md 里「## 迭代 133 …」到下一段之间的正文换成新 seg。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)
BS = chr(92)
VER = '3.75.0'
SEG = 'tools/iter133_seg.md'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def parse_items(seg_path):
    seg = rd(seg_path).rstrip(NL)
    items = []
    for line in seg.split(NL):
        line = line.strip()
        if not line.startswith('- '):
            continue
        it = line[2:].strip()
        if it.startswith('**'):
            it = it[2:]
        if it.endswith('**'):
            it = it[:-2]
        it = it.strip()
        assert it.startswith(chr(0x3010)), it[:24]
        assert chr(0x3011) in it, it[:24]
        assert NL not in it and DQ not in it and BS not in it, it[:24]
        assert '[' not in it and ']' not in it, it[:24]
        items.append(it)
    return seg, items


def rebuild_block(ij, items, date):
    START = 'const ST_PHONE_CURRENT_UPDATE = {'
    bi = ij.index(START)
    bj = ij.index(NL + '};', bi)
    head = START + NL + '    version: ST_PHONE_VERSION,' + NL + '    date: ' + DQ + date + DQ + ',' + NL + '    items: ['
    out = [head]
    for it in items:
        out.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
    out.append('    ]')
    out.append('};')
    return ij[:bi] + NL.join(out) + ij[bj + len(NL) + 2:]


def main():
    seg, items = parse_items(SEG)
    print('seg items = %d' % len(items))
    assert any('运行时验证边界' in it for it in items), '当版条目必须含用户可见边界说明那一条'

    # ① update-log
    ul = json.loads(rd('update-log.json'))
    assert ul['latest'] == VER and list(ul['versions'])[0] == VER
    old_n = len(ul['versions'][VER]['items'])
    ul['versions'][VER]['items'] = items
    print('① update-log 3.75.0 items: %d -> %d' % (old_n, len(items)))

    # ② index.js 公告块
    ij = rd('index.js')
    ij = rebuild_block(ij, items, ul['versions'][VER]['date'])
    for it in items:
        assert json.dumps(it, ensure_ascii=False) in ij
    print('② index.js 公告块已重建（%d 条）' % len(items))

    # ③ ITERATION_LOG 的迭代 133 段
    il = rd('ITERATION_LOG.md')
    m = re.search(r'## 迭代 133 .*?(?=' + NL + NL + '## 迭代 132 )', il, re.S)
    assert m, '必须能定位迭代 133 段（其后紧跟迭代 132 段）'
    old_seg = m.group(0)
    assert old_seg.startswith('## 迭代 133 ')
    # 幂等口径：比的是**整段文本**是否已同源，不是「某个词在不在」——
    #   第一次跑过之后段里当然已经有那个词（本版自己踩到的一次假拒）。
    assert seg != old_seg, '迭代 133 段必须与 seg 不同才替换（相同即已同步）'
    il = il[:m.start()] + seg + il[m.end():]
    assert il.count('## 迭代 133 ') == 1
    print('③ ITERATION_LOG 迭代 133 段已换成新 seg（%d 字 -> %d 字）' % (len(old_seg), len(seg)))

    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    wr('update-log.json', json.dumps(ul, ensure_ascii=False, indent=2) + NL)
    wr('index.js', ij)
    wr('ITERATION_LOG.md', il)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())