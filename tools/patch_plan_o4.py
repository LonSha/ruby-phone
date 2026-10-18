#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_plan_o4.py — 把 R4-O4 在第四期优化计划书里的标题标上「已完成,v4.16.0」。

纪律:用**逐字垂直线**定位(不猜括弧全/半角 —— 本仓两种都出现过),
  只改标题行,正文的现状证据保留为「当时缺口」的历史留痕。
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = '.agents/notes/proposed/architecture/2026-10-15-product-optimization-v4.md'
MARK = '**\u5df2\u5b8c\u6210**,v4.16.0'
# 用**最稳的前缀**定位:`### R4-O4 •`(标题里的逗号是全角 U+FF0C,不预设它)。
NEEDLE = '### R4-O4 \u00b7 '


def main():
    p = os.path.join(ROOT, OPT)
    s = io.open(p, encoding='utf-8').read()
    # 抓「标题行」(从 NEEDLE 到该行行尾),不预设括弧形态。
    m = re.search(re.escape(NEEDLE) + r'[^\n]*\n', s)
    assert m, 'needle must appear once'
    assert s.count(NEEDLE) == 1, s.count(NEEDLE)
    head = m.group(0)
    assert MARK not in head, 'already patched'
    title = head.rstrip('\n')
    new_head = title + MARK + '\n'
    s = s[:m.start()] + new_head + s[m.end():]
    assert s.count(MARK) == 1
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched: ' + new_head.strip())
    return 0


if __name__ == '__main__':
    sys.exit(main())