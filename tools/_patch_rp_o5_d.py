#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o5_d.py — R-O5 第三刀补：把 D1 变异锚点加上下文（唯一性）。

上一刀把 A_STAGE1 收成单行 `            await this._yieldTurn();`，但**阶段二**
循环里也有一句同缩进的让出 ⇒ 锚点实得 2 次，D1 在唯一性断言上转红（fail-closed
正是它该做的：锚点不唯一时拒改）。

修法：把锚点收成**两行**（让出 + 紧随其后的索引阶段开关），阶段二那句后面跟的是
`}` 而不是开关 ⇒ 唯一。破坏仍删「让出那一句」，判别力不变。

纪律：锚点逐字相符且恰中 1 次；只写一个文件；默认 dry-run。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tests/system-v3600.test.mjs'
WRITE = '--write' in sys.argv
NL = chr(10)


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
    src = rd(REL)
    A = ('const A_STAGE1 = "            await this._yieldTurn();";' + NL
         + "const A_STAGE1_X = '';" + NL)
    NEW = ("/* ★ 唯一性靠**上下文**，不靠缩进：阶段二循环里也有一句同缩进的让出，" + NL
           + " *   单行锚点实得 2 次（D1 因此在唯一性断言上 fail-closed 拒改 —— 这是对的）。" + NL
           + " *   故锚点取「让出 + 紧随的索引阶段开关」两行；阶段二那句后面跟的是 `}`。 */" + NL
           + "const A_STAGE1 ="
           + " ['            await this._yieldTurn();', '            if (cancelIndex && cancelledNow()) {'].join(NL);" + NL
           + "const A_STAGE1_X ="
           + " ['            if (cancelIndex && cancelledNow()) {'].join(NL);" + NL)
    src = once(src, A, NEW, 'A_STAGE1-ctx')
    assert 'A_STAGE1_X = [' in src
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        print('target = ' + REL)
        return 0
    wr(REL, src)
    print('--- WRITTEN --- ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())