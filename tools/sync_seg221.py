#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 tools/iter221_seg.md 的条目刷回「已抬版」的三个位置（版本号不动）：
   1) index.js 的 ST_PHONE_CURRENT_UPDATE 公告块
   2) update-log.json 的 versions['4.95.0'].items
   3) ITERATION_LOG.md 顶部的迭代 221 段正文
为什么需要它：抬版是「先抬版、后补缺陷」两步。补进 seg 的条目必须回灌，
  否则公告块 / update-log / 日志三处与 seg 真源脱节 —— 这正是本仓「转写必须同源」那条纪律。
默认 dry-run；--write 落盘。（本文件对齐 tools/sync_seg220.py。）
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
VER = '4.95.0'
ITER = 221
SEG = 'tools/iter221_seg.md'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def parse_items(seg):
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
        assert NL not in it and chr(34) not in it and chr(92) not in it, it[:24]
        assert '[' not in it and ']' not in it, it[:24]
        items.append(it)
    assert len(items) >= 8, len(items)
    return items


def rebuild_block(ij, items, date):
    START = 'const ST_PHONE_CURRENT_UPDATE = {'
    bi = ij.index(START)
    bj = ij.index(NL + '};', bi)
    head = (START + NL + '    version: ST_PHONE_VERSION,' + NL
            + '    date: ' + chr(34) + date + chr(34) + ',' + NL + '    items: [')
    lines = [head]
    for idx, it in enumerate(items):
        comma = ',' if idx < len(items) - 1 else ''
        lines.append('        ' + json.dumps(it, ensure_ascii=False) + comma)
    lines.append('    ]')
    return ij[:bi] + NL.join(lines) + ij[bj:]


def main():
    seg_raw = rd(SEG).rstrip(NL)
    items = parse_items(seg_raw)
    ul = json.loads(rd('update-log.json'))
    assert ul['latest'] == VER, ul['latest']
    cur = ul['versions'][VER]
    date = cur['date']
    old_items = cur['items']
    print('seg items %d / update-log items %d' % (len(items), len(old_items)))
    cur['items'] = items
    ul_text = json.dumps(ul, ensure_ascii=False, indent=2) + NL

    ij = rd('index.js')
    new_ij = rebuild_block(ij, items, date)
    miss = [it[:30] for it in items if json.dumps(it, ensure_ascii=False) not in new_ij]
    assert not miss, 'index.js 公告块缺条目: ' + '; '.join(miss)
    assert ('版本升至 ' + VER) in new_ij, 'index.js 必须带当版收尾条目'

    il = rd('ITERATION_LOG.md')
    # 顶部第一个二级标题就是当版迭代段；整段替换到下一个 '\n## ' 之前
    assert il.startswith('## 迭代 %d ' % ITER), il[:40]
    nxt = il.index(NL + '## ', 1)
    old_seg = il[:nxt]
    new_il = seg_raw + il[nxt:]
    assert new_il.startswith('## 迭代 %d ' % ITER)
    assert new_il.count('## 迭代 %d ' % ITER) == 1
    print('ITERATION_LOG 当版段 %d 字符 -> %d 字符' % (len(old_seg), len(seg_raw)))

    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr('index.js', new_ij)
    wr('update-log.json', ul_text)
    wr('ITERATION_LOG.md', new_il)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
