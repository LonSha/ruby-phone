#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_plan_o1.py — 把 R4-O1 在两份计划书里的标题标上「已完成,v4.13.0」。

纪律:锚点必须恰中一次(两文件各一次);只改标题行,不动正文证据与验收原文
(计划书是**提案档**,标的只是交付事实;正文的现状证据保留为「当时缺口」的历史留痕)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = '.agents/notes/proposed/architecture/2026-10-15-product-optimization-v4.md'
NEW_MARK = '**\u5df2\u5b8c\u6210**,v4.13.0'
# 计划书标题里的括号是**全角**(U+FF08 / U+FF09):与抬版脚本那几个锚点同因,
# 照 ASCII 写会命中 0 次。这一类在本仓已出现多次,故此处直接写码点,不猜。
HEAD = ('### R4-O1 \u00b7 \u5f80\u4e8b\u7b54\u6848\u771f\u6b63\u53ef\u70b9\u5f00\u51fa\u5904'
        + '\uff08P0 / M\uff09')


def patch(rel):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(HEAD + chr(10))
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (rel, n)
    assert (HEAD + NEW_MARK) not in s, 'already patched'
    s = s.replace(HEAD + chr(10), HEAD + NEW_MARK + chr(10), 1)
    assert s.count(NEW_MARK) == 1
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


def main():
    patch(OPT)
    return 0


if __name__ == '__main__':
    sys.exit(main())