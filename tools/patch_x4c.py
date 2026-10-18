#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4c.py — [v4.28.0 · R4-X4 补丁 C] archive-app 补一个标签出口

视图的「读不出」分支要摆一句状态提示（五态各一句），
那一句的唯一出处是内核 BC_STATE_HINT —— 故 App 侧再补一个只转发出口
canonStateHint（与 canonGate 同一族的标签转发，**不在视图里写第二份**）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
APP = 'apps/archive/archive-app.js'


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


C_OLD = u"""    /**
     * 这一面能不能读 + 读不到时的处置建议（**判定词只许内核一份**）。"""

C_NEW = u"""    /** 五态各一句状态提示（界面文案的唯一出处 = 内核表，视图不写第二份） */
    canonStateHint(st) {
        try { return this.canon.stateHint(st); } catch (_e) { return ''; }
    }
    /**
     * 这一面能不能读 + 读不到时的处置建议（**判定词只许内核一份**）。"""


def main():
    s = rd(APP)
    s = once(s, C_OLD, C_NEW, 'canonStateHint')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(APP, s)
    print('--- WRITTEN C ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())