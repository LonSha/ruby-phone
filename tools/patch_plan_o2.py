#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_plan_o2.py — 把 R4-O2 在第四期优化计划书里的标题标上「已完成,v4.14.0」。

纪律:锚点必须恰中一次;只改标题行,正文的现状证据保留为「当时缺口」的历史留痕。
标点直接写码点(全角括号已让本仓的锚点失配过四次)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = '.agents/notes/proposed/architecture/2026-10-15-product-optimization-v4.md'
NEW_MARK = '**\u5df2\u5b8c\u6210**,v4.14.0'
HEAD = ('### R4-O2 \u00b7 \u95ee\u7b54\u4e0e\u68c0\u7d22\u53ef\u53d6\u6d88\u3001\u53ef\u7ee7\u7eed\u64cd\u4f5c'
        + '\uff08P1 / L\uff09')


def patch(rel, head, mark):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(head + chr(10))
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (rel, n)
    assert (head + mark) not in s, 'already patched'
    s = s.replace(head + chr(10), head + mark + chr(10), 1)
    assert s.count(mark) == 1
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


def main():
    patch(OPT, HEAD, NEW_MARK)
    return 0


if __name__ == '__main__':
    sys.exit(main())