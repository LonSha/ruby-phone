#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4n.py — [v4.28.0 · R4-X4] 修本版判据套件自己抓到的两条写错处。

第一条（A4 转红 · 判据写窄了）：视图经 App 取数的出口清单里漏了
  `canonRevokeLabel(` 与 `canonRevokeBuckets(` —— 而 `_canonRevokeBlock`
  正是经这两个出口取四张表的表名与名字。补进清单，并新增一条真判据：
  视图里不得再出现第二份四表表名（本版真抓到过一例手写表名表，
  已由 patch_x4m 收回内核；这条判据把「收回」变成跑不掉的约束）。

第二条（B7 转红 · 判据扫了注释）：`countOf(kernelSrc, 'commit')` 命中的是
  契约件第 582 行**注释**里的「本件不提交（commit 恒不传）」——
  本仓纪律：判据只认代码，不认注释里的自述（旧病：注释里的名字被当成代码判）。
  改为先去注释再判，并补一条双向对照（原版注释里确实提过 commit
  ⇒ 上一条判的不是空判据）。

幂等：三处锚点各恰中 1 次，重复执行即 abort。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
T = 'tests/system-v4280.test.mjs'


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


# 锚点用**字符码拼**（本文件不许出现中文正文字面量的转义地狱）
C_STAR = chr(0x2605)          # ★
B7_NOTE_OLD = ('    /* ' + C_STAR + ' 本件绝不传 commit：落笔归上游 owner。 */')
B7_ASSERT_OLD = ("    assert.equal(countOf(kernelSrc, 'commit'), 0, "
                 + "'契约件不得出现 commit（本件不提交）');")
B7_NOTE_NEW = ('    /* ' + C_STAR + ' 本件绝不传 commit：落笔归上游 owner。' + NL
               + '     *   ★ 判据只认代码、不认注释里的自述（本仓旧病：注释里的名字被当成代码判）。' + NL
               + '     *   第一版直接数原文，命中的是契约件第 582 行那句「本件不提交（commit 恒不传）」——' + NL
               + '     *   判据被注释养着，真代码里多一个 commit 反而不会响。 */')
B7_ASSERT_NEW = ("    assert.equal(countOf(stripAll(kernelSrc), 'commit'), 0," + NL
                 + "        '契约件代码里不得出现 commit（本件不提交）');" + NL
                 + "    assert.ok(countOf(kernelSrc, 'commit') >= 1," + NL
                 + "        '双向对照：注释里确实提到过 commit（说明上一条判的不是空判据）');")


def main():
    t = rd(T)
    assert 'canonRevokeBuckets' not in t, 'T already patched (abort)'

    # ── ① A4：出口清单补齐 + 第二份表名真判据 ─────────────────────
    A4_OLD = ("    for (const fn of ['canonPack(', 'canonGate(', 'canonNote(', 'canonStateHint('," + NL
              + "        'canonDecisionIds(', 'canonDecisionLabel(', 'canonClashLabel(', 'canonAdoptLabel('," + NL
              + "        'canonProvLabel(', 'canonUnmappedLabel(']) {" + NL
              + "        assert.ok(countOf(viewSrc, fn) >= 1, '视图必须经 App 出口取数：' + fn);" + NL
              + "    }" + NL
              + "});")
    A4_NEW = ("    for (const fn of ['canonPack(', 'canonGate(', 'canonNote(', 'canonStateHint('," + NL
              + "        'canonDecisionIds(', 'canonDecisionLabel(', 'canonClashLabel(', 'canonAdoptLabel('," + NL
              + "        'canonProvLabel(', 'canonUnmappedLabel(', 'canonRevokeLabel(', 'canonRevokeBuckets(']) {" + NL
              + "        assert.ok(countOf(viewSrc, fn) >= 1, '视图必须经 App 出口取数：' + fn);" + NL
              + "    }" + NL
              + "    /* ★ 视图不许自己写第二份表名表：撤销四张表的表名只许在核心里一份。" + NL
              + "     *   本版判据当场抓到过一例（视图手写了整份四表表名），已由 patch_x4m 收回内核 ——" + NL
              + "     *   这一条把「收回」变成跑不掉的约束，连注释里也不许留。" + NL
              + "     *   （四档决定同理：视图按内核 id 取，不写第二份顺序表。） */" + NL
              + "    for (const lit of ['" + chr(0x522b) + chr(0x6279) + "', '"
              + chr(0x624b) + chr(0x5de5) + chr(0x8865) + chr(0x7684) + "', '"
              + chr(0x540e) + chr(0x6765) + chr(0x52a0) + chr(0x7684) + "']) {" + NL
              + "        assert.equal(countOf(viewSrc, lit), 0, '视图不得再写第二份四表表名：' + lit);" + NL
              + "    }" + NL
              + "});")
    t = once(t, A4_OLD, A4_NEW, 'A4-outlets')

    # ── ② B7：判据不许扫注释 ─────────────────────────────────────
    t = once(t, B7_NOTE_OLD + NL + B7_ASSERT_OLD,
             B7_NOTE_NEW + NL + B7_ASSERT_NEW, 'B7-strip')

    # ── ③ 档头补一条去注释器（只此一份，A2/B7 共用） ──────────────
    S_OLD = "const countOf = (hay, needle) => hay.split(needle).length - 1;" + NL
    S_NEW = (S_OLD
             + "/** 去注释（块注释 + 整行注释）：判据只认代码，不认注释里的自述。 */" + NL
             + "const stripAll = (s) => s" + NL
             + "    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')" + NL
             + "    .split(NL).filter((l) => !/^\\s*\\/\\//.test(l)).join(NL);" + NL)
    t = once(t, S_OLD, S_NEW, 'stripAll')

    print('--- patch_x4n: 3 anchors (all hit exactly 1) ---')
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    wr(T, t)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())