#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_iter232_handoff.py — 把「交棒改写」实录写进**公告段唯一真源** tools/iter232_seg.md。

背景（这一条是本版收尾时自己撞出来的）：
`tools/bump_v4997.py`（以及沿用的 v4998）的 `parse_items` 白名单里多认一个「不做：」，
而历史判据 v3171 E1 / v3201 E1 / v3213 G3 的形态锚只认「交棒改写 / 主动改写 / 下限形」。
于是脚本放行、判据转红 —— **脚本口径宽于判据口径**，同一件事两份实现。
收窄脚本白名单之后，脚本立刻如实拦住了这份段文件：段里确实没有交棒条目。
故本补丁把实录补进段文件（唯一真源），再由 bump 脚本重建成三源同源。

⚠ 方括号禁则：items 里出现 `]` 会让当版切片判据把公告块头部提前截断 ⇒ 假红。
   故条目里不写方括号（criteria 的 L5 格、share_ 前缀都是为绕开它改写的）。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)
SEG = ROOT + '/tools/iter232_seg.md'

ITEM = (
    '- 【交棒改写（下限形）】本版收尾时改写/收窄了三处旧口径，逐条记录，不静默通过：'
    '① 三张取证基线按真值刷新 —— branch_play 与 schedule_conflict 的 files_scanned 624→625、'
    'long_chat 的 scan.files 625→626 与 criteria 的 L5 格 got_text 同步，'
    '顺带修掉一条**跨版未刷**的遗留：branch_play 的 chat_data_patterns 402→405'
    '（本版 config/storage.js 新增 share_ 会话前缀与两行说明注释，探针口径把段内注释行也计入，'
    '与既有「行首注释也算一条」一致）；刷新由 tools/refresh_baselines_v4998.py 完成'
    '（零手抄、幂等、冻结 measured_at）。'
    '② 弱档模块账本 82→80：config/sharing-boundary.js 与 config/offline-creator-bundle-pipeline.js '
    '真接进产品面后按 --update 摘除，并在账本 note 里写明是人工摘除而非漂移。'
    '③ 抬版脚本的 parse_items 白名单**收回**到与历史判据一致：v4996/v4997 曾把「不做：」'
    '加进交棒锚的白名单，于是脚本放行、而 v3171/v3201/v3213 的形态锚转红 —— '
    '脚本口径宽于判据口径，是同一件事的两份实现，本版把它收窄。'
    '这三条都是「下限形」：放宽的是脚本与基线读数，收紧的是判据锚，方向都是少给自己留后门。'
)

ANCHOR = '- 【不做：三件明确不做的事】'
BANNED = ('[', ']', '"', chr(92), NL)


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    for bad in BANNED:
        assert bad not in ITEM, ('item must not contain banned char', repr(bad))
    seg = rd(SEG)
    if ITEM in seg:
        print('[seg] 已含交棒条目，跳过')
        return 0
    assert seg.count(ANCHOR) == 1, ('段文件「不做」锚点', seg.count(ANCHOR))
    # 插在「不做」那条之前：先做了什么 / 再交棒 / 最后不做
    idx = seg.index(ANCHOR)
    line_start = seg.rfind(NL, 0, idx) + 1
    seg = seg[:line_start] + ITEM + NL + seg[line_start:]
    wr(SEG, seg)
    print('[seg] 已写入；行数 %d；条目数 %d'
          % (len(seg.split(NL)), sum(1 for l in seg.split(NL) if l.startswith('- '))))
    return 0


if __name__ == '__main__':
    sys.exit(main())