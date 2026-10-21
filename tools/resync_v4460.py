#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""resync_v4460.py — 把 tools/iter205_seg.md 的条目重同步进四处同源面。

为什么要有这个脚本：
    抬版脚本 `tools/bump_v4460.py` 的前置断言是「当前版本必须是上一版」（防重复抬版），
    所以**抬版之后**再补写条目（本版就是这种情况：补登记两处存量缺口的实测证据）
    不能重跑抬版脚本 —— 重跑会被断言挡住，硬改断言就是把闸拆了。
    本脚本只做**同步**、不做抬版：它按当前版本号把四处面重写一遍，幂等可重跑。
    源文件（迭代段）永远是唯一真源，其余四处只是它的投影。

用法：
    python3 tools/resync_v4460.py            # 只报差异（dry-run）
    python3 tools/resync_v4460.py --write    # 落盘
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
VER = '4.46.0'
SEG = 'tools/iter205_seg.md'
ITER_NO = 205


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
        items.append(it.strip())
    assert len(items) >= 8, len(items)
    assert any(it.startswith(chr(0x3010) + '版本升至') for it in items), 'must carry closing item'
    return seg, items


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
    seg, items = parse_items(SEG)
    print('--- resync %s | items %d ---' % (VER, len(items)))
    changed = []
    # ① update-log.json
    ul = json.loads(rd('update-log.json'))
    assert ul['latest'] == VER, ul['latest']
    old_items = ul['versions'][VER].get('items', [])
    if old_items != items:
        ul['versions'][VER]['items'] = items
        changed.append('update-log.json (%d -> %d)' % (len(old_items), len(items)))
        if WRITE:
            wr('update-log.json', json.dumps(ul, ensure_ascii=False, indent=2) + NL)
    # ② index.js 公告块
    ij = rd('index.js')
    date = ul['versions'][VER].get('date', '')
    new_ij = rebuild_block(ij, items, date)
    if new_ij != ij:
        miss = [it[:40] for it in items if json.dumps(it, ensure_ascii=False) not in new_ij]
        assert not miss, 'index.js 公告块缺条目: ' + '; '.join(miss)
        changed.append('index.js')
        if WRITE:
            wr('index.js', new_ij)
    # ③ ITERATION_LOG.md 的本版段
    il = rd('ITERATION_LOG.md')
    head = '## 迭代 %d ' % ITER_NO
    i = il.index(head)
    j = il.find(NL + '## ', i)
    j = len(il) if j < 0 else j + 1
    new_il = il[:i] + seg + NL + NL + il[j:]
    if new_il != il:
        assert new_il.count(head) == 1, '本版段必须恰一处'
        changed.append('ITERATION_LOG.md')
        if WRITE:
            wr('ITERATION_LOG.md', new_il)
    # ④ 自证：四处面都必须含每一条
    if WRITE:
        ul2 = json.loads(rd('update-log.json'))
        assert ul2['versions'][VER]['items'] == items
        ij2 = rd('index.js')
        for it in items:
            assert json.dumps(it, ensure_ascii=False) in ij2, it[:40]
        il2 = rd('ITERATION_LOG.md')
        for it in items:
            assert ('- ' + it) in il2 or it in il2, it[:40]
    print('改动：' + (', '.join(changed) if changed else '（无，已同源）'))
    if not WRITE:
        print('（dry-run，未落盘；加 --write 落盘）')
    else:
        print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())