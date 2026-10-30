#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4998_handoff.py — 给 v4.99.8 当版条目补一条「交棒改写」实录。

为什么必须补（不是为了让历史判据变绿）：
本版在收尾时**真的改写了三处旧口径**，但公告段只写了「不做：三件明确不做的事」，
历史判据（v3171 E1 / v3201 E1 / v3213 G3）的形态锚要求当版条目如实记下这件事，
于是三条转红。红得对：**改了旧判据却没写下来**正是那三条要防的形态。

⚠ 方括号禁则：当版切片判据按「公告块里第一个 `]`」截头部，items 里一旦出现 `]`
   头部就被提前截断、后半读不到 ⇒ 假红。故本条目里**不写**任何方括号，
   连「criteria[L5]」这种引用也改写成「criteria 的 L5 格」。
"""
import io
import json
import sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)

ITEM = (
    '【交棒改写（下限形）】本版收尾时改写/收窄了三处旧口径，逐条记录，不静默通过：'
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

BANNED = ('[', ']', '"', chr(92), NL)


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def once(src, old, new, tag):
    n = src.count(old)
    assert n == 1, ('anchor must hit exactly once: ' + tag, n)
    return src.replace(old, new, 1)


def main():
    for bad in BANNED:
        assert bad not in ITEM, ('item must not contain banned char', repr(bad))

    # ① update-log.json（首位仍是当版；items 追加在末尾）
    p_ul = ROOT + '/update-log.json'
    ul = json.loads(rd(p_ul))
    ver = ul['latest']
    items = ul['versions'][ver]['items']
    if ITEM not in items:
        items.append(ITEM)
    wr(p_ul, json.dumps(ul, ensure_ascii=False, indent=2) + NL)

    # ② ITERATION_LOG.md：插在「不做」那条之前（语义顺序：先做了什么、再交棒、最后不做）
    p_il = ROOT + '/ITERATION_LOG.md'
    il = rd(p_il)
    if ITEM not in il:
        anchor = '- 【不做：三件明确不做的事】'
        assert il.count(anchor) == 1, ('ITERATION_LOG 不做条目锚点', il.count(anchor))
        idx = il.index(anchor)
        line_start = il.rfind(NL, 0, idx) + 1
        il = il[:line_start] + ('- ' + ITEM + NL) + il[line_start:]
    wr(p_il, il)

    # ③ index.js 公告块：插在末条之前（保持逗号结构），注意末条无逗号
    p_ij = ROOT + '/index.js'
    ij = rd(p_ij)
    quoted = json.dumps(ITEM, ensure_ascii=False)
    if quoted not in ij:
        last = json.dumps(items[-2], ensure_ascii=False)  # 追加后 items[-1] 是新条目，[-2] 是原末条
        anchor = '        ' + last + NL
        assert ij.count(anchor) == 1, ('index.js 末条（无逗号）锚点', ij.count(anchor))
        new = '        ' + last + ',' + NL + '        ' + quoted + NL
        ij = once(ij, anchor, new, 'index.js 公告块插条')
    wr(p_ij, ij)

    print('[handoff] items = %d / 版本 = %s' % (len(items), ver))
    print('[handoff] ITERATION_LOG 含条目: %s' % (ITEM in rd(p_il)))
    print('[handoff] index.js 含条目: %s' % (quoted in rd(p_ij)))
    return 0


if __name__ == '__main__':
    sys.exit(main())