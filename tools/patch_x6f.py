#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x6f.py — [v4.27.0 · R4-X6 收口补丁 F]
把补丁 E 抓到的缺陷形态**记进本版三处公告**（防「做了但没记」）。

【为什么必须记】本仓口径：当版公告要记到「本版自己抓到的缺陷形态」。
  补丁 E 修的是「历史套件的版本锚写错了主语」—— 这是本版抬版时**才现形**的，
  它属本版自己抓到的形态，不记就等于这版只留了修复、没留为什么。
  三处同批：update-log.json 的 4.27.0 条目 / index.js 的当版公告块 /
  ITERATION_LOG.md 的迭代 186 段。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

ITEM = ('\u3010\u672c\u7248\u81ea\u5df1\u6293\u5230\u7684\u7f3a\u9677\u5f62\u6001\uff1a'
        '\u5386\u53f2\u5957\u4ef6\u7684\u7248\u672c\u951a**\u5199\u9519\u4e86\u4e3b\u8bed** \u2014\u2014 '
        'tests/system-v4260 \u7684 E1 \u628a\u300cv4.26.0 \u8fd9\u4e00\u7248\u516c\u544a\u8bb0\u5168\u4e86\u300d'
        '\u5199\u6210\u4e86\u300c\u5f53\u524d\u8fd9\u4e00\u7248\u8bb0\u5168\u4e86\u300d\uff08\u8ddf\u968f pkg.version\uff09\uff0c'
        '\u62ac\u5230 v4.27.0 \u7684\u90a3\u4e00\u523b\u5fc5\u7ea2\uff1b'
        '\u5df2\u6539\u4e3a\u9501\u81ea\u5df1\u90a3\u4e00\u7248\u7684\u5b57\u9762\u91cf\uff0c'
        '\u672c\u7248\u65b0\u5957\u4ef6\u4ece\u4e00\u5f00\u59cb\u5c31\u6309\u6b64\u5f62\u6001\u5199')

SEG_LINE = ('- \u3010\u672c\u7248\u81ea\u5df1\u6293\u5230\u7684\u7f3a\u9677\u5f62\u6001\uff1a'
            '\u5386\u53f2\u5957\u4ef6\u7684\u7248\u672c\u951a\u5199\u9519\u4e86\u4e3b\u8bed \u2014\u2014 '
            'tests/system-v4260 \u7684 E1 \u628a\u300cv4.26.0 \u8fd9\u4e00\u7248\u516c\u544a\u8bb0\u5168\u4e86\u300d'
            '\u5199\u6210\u4e86\u300c\u5f53\u524d\u8fd9\u4e00\u7248\u8bb0\u5168\u4e86\u300d\uff08\u8ddf\u968f pkg.version\uff09\uff0c'
            '\u62ac\u5230 v4.27.0 \u7684\u90a3\u4e00\u523b\u5fc5\u7ea2\uff1b'
            '\u5df2\u6539\u4e3a\u9501\u81ea\u5df1\u90a3\u4e00\u7248\u7684\u5b57\u9762\u91cf\uff0c'
            '\u672c\u7248\u65b0\u5957\u4ef6\u4ece\u4e00\u5f00\u59cb\u5c31\u6309\u6b64\u5f62\u6001\u5199\u3011')


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    # ---- 1. update-log.json
    ul = json.loads(rd('update-log.json'))
    assert ul['latest'] == '4.27.0', ul['latest']
    items = ul['versions']['4.27.0']['items']
    assert ITEM not in items
    items.append(ITEM)
    ul_out = json.dumps(ul, ensure_ascii=False, indent=2) + NL

    # ---- 2. index.js 当版公告块
    ij = rd('index.js')
    anchor = '    version: ST_PHONE_VERSION,' + NL
    bi = ij.index('const ST_PHONE_CURRENT_UPDATE = {')
    bj = ij.index(NL + '};', bi)
    block = ij[bi:bj]
    assert block.count('\u5f53\u524d\u8fd9\u4e00\u7248\u8bb0\u5168\u4e86') == 0
    # 块尾形如 `        "最后一项"` + NL + `    ]` —— 新项插在 `    ]` 之前。
    close_idx = block.rindex(NL + '    ]')
    body = block[:close_idx].rstrip(NL)
    assert body.endswith('"'), body[-40:]
    new_block = (body + ',' + NL + '        ' + json.dumps(ITEM, ensure_ascii=False)
                 + block[close_idx:])
    ij_out = ij[:bi] + new_block + ij[bj:]

    # ---- 3. ITERATION_LOG.md 迭代 186 段
    il = rd('ITERATION_LOG.md')
    head = '## \u8fed\u4ee3 186 \u2014 v4.27.0'
    assert il.count(head) == 1
    hi = il.index(head)
    # 段末：找下一段的起点（或文件里本段结束处的空行 + 下一段）
    nxt = il.find(NL + '## ', hi + 1)
    seg_end = nxt if nxt > 0 else len(il)
    seg = il[hi:seg_end]
    assert '\u5f53\u524d\u8fd9\u4e00\u7248\u8bb0\u5168\u4e86' not in seg
    assert seg.rstrip().endswith('\u3011'), seg[-60:]
    il_out = il[:hi] + seg.rstrip(NL) + NL + SEG_LINE + il[seg_end:]

    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        print('items now =', len(items))
        return 0
    wr('update-log.json', ul_out)
    wr('index.js', ij_out)
    wr('ITERATION_LOG.md', il_out)
    print('--- WRITTEN F --- items=%d' % len(items))
    return 0


if __name__ == '__main__':
    sys.exit(main())