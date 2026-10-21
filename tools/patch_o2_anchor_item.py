#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_o2_anchor_item.py — [v4.44.0 · R5-O2 收尾] 补一条「抬版连带面」迭代条目。

为什么必须补：本版跑定点回归时实测到 **十一条历史套件**（v4330…v4430）的版本锚转红。
那不是本版引入的产品缺陷，是**判据写错了主语**（`const ver = pkg.version` 同时被用来
断「五源一致」与「当版公告记了本版那件事」）—— 本仓 v4.27.0 的 `tools/patch_x6e.py`
档头已逐字记过同因。本次按同仓口径接管（一致性跟随当前版；当版内容锁自己那一版），
工具 `tools/takeover_v4440_anchors.py` 落盘。**这条必须进公告**：否则下一次抬版的人
仍会把它当成新缺陷重查一遍。

同源面四处（与 `tools/bump_v4440.py` 的 rebuild_block 同规）：
  tools/iter203_seg.md · ITERATION_LOG.md 迭代 203 段 · update-log.json items · index.js 公告块
用法：python3 tools/patch_o2_anchor_item.py [--write]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)
VER = '4.44.0'

ITEM = (
    u'【抬版连带面：十一条历史套件的版本锚被抬版连带转红（本仓已登记过的同因形态）】'
    u'本版跑定点回归时实测 v4330 至 v4430 十一条套件各有 1 条红，红在同一个位置：'
    u'它们用 `const ver = pkg.version` **同时**断「五源一致」与「当版公告记了本版那件事」——'
    u'抬版那一刻 `ver` 变成 4.44.0，而 4.44.0 的公告里当然没有 R5-O7 / R5-O8 / 等编号。'
    u'其中八条在 HEAD b29df6b 上就已是红的（`log.latest` 还是 4.43.0），只有 v4430 是本版抬版带红的。'
    u'这不是产品缺陷，是**判据的主语写错了**：它想说的是「v4.34.0 这一版记全了」，'
    u'写成了「当前这一版记全了」——两者只在抬版前那一瞬同义。'
    u'本仓 v4.27.0 的 `tools/patch_x6e.py` 档头已逐字记过同因（v4260 那条），故本版按同仓口径接管：'
    u'一致性继续跟随当前版，当版**内容**锁**自己那一版**的字面量，**断言强度不变**（只换主语，不放宽）。'
    u'接管工具 `tools/takeover_v4440_anchors.py`（锚点各断言恰中 1 次，失配即整件退出），'
    u'十一条全部转绿；旧写法逐字留档在该工具档头。'
)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


def main():
    seg = rd('tools/iter203_seg.md')
    assert seg.count(NL + '- 【本版新增件的分工】') == 1, 'seg tail anchor'
    assert ('抬版连带面' in seg) is False, 'already patched'
    seg = seg.rstrip(NL) + NL + '- ' + ITEM + NL
    print('  seg 条目数 -> %d' % seg.count(NL + '- 【'))

    il = rd('ITERATION_LOG.md')
    hdr = '## 迭代 203 · v%s（2026-04-07）' % VER
    i = il.index(hdr)
    j = il.index(NL + '## 迭代 ', i + len(hdr))
    block = il[i:j].rstrip(NL)
    assert block.count('抬版连带面') == 0, 'already patched in log'
    il = il[:i] + block + NL + '- ' + ITEM + NL + il[j:]
    assert il.count('## 迭代 203 ') == 1

    ul = json.loads(rd('update-log.json'))
    assert ul['latest'] == VER and ul['head'] == VER
    items = ul['versions'][VER]['items']
    assert not any('抬版连带面' in it for it in items), 'already patched in update-log'
    items.append(ITEM)
    print('  update-log items -> %d' % len(items))

    idx = rd('index.js')
    START = 'const ST_PHONE_CURRENT_UPDATE = {'
    bi = idx.index(START)
    bj = idx.index(NL + '};', bi)
    old_block = idx[bi:bj]
    assert '抬版连带面' not in old_block, 'already patched in index.js'
    lines = old_block.split(NL)
    # 末行是 '    ]'，在它之前插一条。
    #   ★ 原末条是数组最后一项（**无尾逗号**）⇒ 先给它补上逗号，再插新末条。
    last = lines[-1]
    assert last.strip() == ']', last
    prev = lines[-2]
    if not prev.rstrip().endswith(','):
        lines[-2] = prev.rstrip() + ','
    lines.insert(len(lines) - 1, '        ' + json.dumps(ITEM, ensure_ascii=False))
    new_block = NL.join(lines)
    idx = idx[:bi] + new_block + idx[bj:]
    _miss = [it[:30] for it in items if json.dumps(it, ensure_ascii=False) not in idx]
    assert not _miss, 'index.js 公告块缺条目: ' + '; '.join(_miss)

    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr('tools/iter203_seg.md', seg)
    wr('ITERATION_LOG.md', il)
    wr('update-log.json', json.dumps(ul, ensure_ascii=False, indent=2) + NL)
    wr('index.js', idx)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())