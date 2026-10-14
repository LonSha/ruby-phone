# -*- coding: utf-8 -*-
"""_fix_v4100_face.py — v4.10.0 收口:下游 memoryToolsEnvelope 格回真(治「照抄上游失真账面」)。

【取证(不是推演)】
  · 上游 memory-tools-api.js 全史只有一条提交 9336e0e(v3.305.0 · M-X9),此后零改动;
  · 上游登记表该面的 col3(producer_version)却从 v3.319.0 起被**每一次抬版脚本**
    机械改写:v3.318.0 -> v3.320.0 -> v3.322.0 -> v3.326.0 -> v3.327.0 -> v3.328.0;
  · 上游 v3.328.1(0f2f7fd)已把该格回真为 v3.305.0,并把 v3305 D2 判据改成
    `cols[2] === 'v' + BORN`(绑供给模块诞生版,**不再绑宿主版**);
  · 本仓该格 since=3.322.0 正是照抄了上游那条**失真账面** —— 上游写 v3.322.0,
    本仓抄成 3.322.0,两侧「一致地错」,于是第十一道门 R4(两侧同口径比对)长期绿。
    上游一回真,R4 当场抓到(本次)。

【为什么必须回真,不是对齐着好看】
  since 是本面唯一会指使读者去「升级」的读数:写高了就对装了新版上游的用户报
  `producer-behind:3.322.0` 的**假「版本偏低」**。本仓 v3970 的 featureState 判据逐字依赖它。
  更根本的一层:v3970 的「全绿探针」从**冻读取**取上游当版;本仓 since 若比上游真值高,
  探针就凑不出「全部就绪」,那条反向自证(没有缺席项时不得写缺席)会失效。

【为什么按行定位而不是拼整句锚点】
  仓内中文标点是全角(圆括号 U+FF08/FF09、逗号 U+FF0C、分号 U+FF1B、顿号 U+3001、
  间隔点 U+00B7)。整句锚点里任何一个标点写成半角就 0 命中 —— 治这条缺陷时踩过两次
  (先是括号、再是逗号),故改为**行级纪律**:先定位「唯一一行」,再在其内定位「唯一一处」。
  每条都断言恰中 1 次;dry-run 不落盘。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
DUN = chr(0x3001)   # 、
DOT = chr(0x00B7)   # ·
LP = chr(0xFF08)    # (
RP = chr(0xFF09)    # )
SEMI = chr(0xFF1B)  # ;


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def one_line(lines, musts, tag):
    idxs = [i for i, l in enumerate(lines) if all(m in l for m in musts)]
    assert len(idxs) == 1, '[%s] must locate exactly 1 line, got %d' % (tag, len(idxs))
    return idxs[0]


def main():
    out = {}

    # ── 1 登记面:since 回真 + 出处如实写明 ──────────────────────────────
    rel = 'config/crossrepo-registry.js'
    lines = rd(rel).split(NL)
    # 「since: '3.322.0',」在 qaAnswer 那条也在场 ⇒ 用「其下一行含 memory-tools-api」定位
    cands = [i for i, l in enumerate(lines)
             if "since: '3.322.0'," in l and i + 1 < len(lines) and 'memory-tools-api' in lines[i + 1]]
    assert len(cands) == 1, '[registry since] locate exactly 1, got %d' % len(cands)
    i = cands[0]
    assert lines[i].count("3.322.0") == 1, '[registry since] frag not unique'
    lines[i] = lines[i].replace("3.322.0", "3.305.0", 1)

    nxt = lines[i + 1]
    head_mark = '的五能力出口'
    tail_mark = '上游版本本仓未留档'
    assert nxt.count(head_mark) == 1, '[registry sinceSource] head not unique'
    assert nxt.count(tail_mark) == 1, '[registry sinceSource] tail not unique'
    a = nxt.index(head_mark) + len(head_mark)
    b = nxt.index(tail_mark)
    fresh = (LP + 'v3.305.0 M-X9 交付' + DUN + '**该面供给模块此后零改动**' + RP + SEMI
             + '★ 本格此前写着 3.322.0 —— 那是**照抄上游失真账面**的连带:上游那张表该列自'
             + ' v3.319.0 起被每一次抬版脚本机械改写,本仓跟着抄成了'
             + chr(0x300C) + '抬版幻影' + chr(0x300D) + ',而上游 v3.328.1 已把账面回真'
             + LP + '判据改绑供给模块诞生版,不再绑宿主版' + RP + SEMI)
    lines[i + 1] = nxt[:a] + fresh + nxt[b:]
    out[rel] = NL.join(lines)
    print('ok  registry since/sinceSource  (lines %d-%d)' % (i + 1, i + 2))

    # ── 2 消费侧真源注释:同一条失真表述 ────────────────────────────────
    rel = 'config/memory-qa-contract.js'
    lines = rd(rel).split(NL)
    i = one_line(lines, ['memoryToolsEnvelope', 'v3.305.0', '交付'], 'memory-qa-contract')
    seg = 'v3.305.0 交付'
    assert lines[i].count(seg) == 1, '[memory-qa-contract] frag not unique'
    a = lines[i].index(seg) + len(seg)
    b = lines[i].index(RP)
    assert b > a, '[memory-qa-contract] closing paren before frag end'
    lines[i] = lines[i][:a] + (DUN + '**此后零改动**') + lines[i][b:]
    out[rel] = NL.join(lines)
    print('ok  memory-qa-contract heading  (line %d)' % (i + 1))

    # ── 3 第九道门注释:它把交付版写成了 v3.319.0 ────────────────────────
    rel = 'scripts/bridge-contract-audit.mjs'
    lines = rd(rel).split(NL)
    i = one_line(lines, ['五能力统一只读信封', 'v3.319.0'], 'bridge-contract')
    assert lines[i].count('v3.319.0') == 1, '[bridge-contract] frag not unique'
    lines[i] = lines[i].replace('v3.319.0', '**v3.305.0**', 1)
    nb = lines[i].index(RP)
    lines[i] = (lines[i][:nb] + ' —— 该面自 M-X9 交付后供给模块零改动,'
                + '此前这里写的 v3.319.0 是抬版幻影' + lines[i][nb:])
    out[rel] = NL.join(lines)
    print('ok  bridge-contract heading  (line %d)' % (i + 1))

    # ── 4 v3970 判据档头注释 ───────────────────────────────────────────
    rel = 'tests/system-v3970.test.mjs'
    lines = rd(rel).split(NL)
    i = one_line(lines, ['memoryToolsEnvelope', 'v3.319.0/3.322.0'], 'v3970')
    assert lines[i].count('v3.319.0/3.322.0') == 1, '[v3970] frag not unique'
    lines[i] = lines[i].replace('v3.319.0/3.322.0',
                                '**上游 v3.305.0** ' + DOT + ' 供给模块零改动', 1)
    out[rel] = NL.join(lines)
    print('ok  v3970 heading  (line %d)' % (i + 1))

    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    for rel, s in out.items():
        wr(rel, s)
        print('written  ' + rel)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())