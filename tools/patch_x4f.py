#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4f.py — [v4.28.0 · R4-X4 补丁 F] v3450 q25 破坏锚点随当版前移

q25 的锚点是 onChatChanged() 的**整块字面**（从 `onChatChanged() {` 到 `this.probe();`），
它的破坏方式是**抽掉 probe() 与两格重置**（换会话不重取）。

补丁 A4 在这块里插了「丢掉旧选位」的三行（注释 + try 行），
锚点串因此失配（`hits === 1` 直接炸）。

★ 这正是本仓记过的形态：**历史套件的破坏锚点是「当版源码快照」，
  改源码必须同步改锚点**；且锚点要锁**自己那一版的字面量**，
  不许跟随 pkg.version、也不许写成宽松正则。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
V3450 = 'tests/system-v3450.test.mjs'


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


F_OLD = u"""    q25: [AR_APP,
        '    onChatChanged() {' + NL + "        this._tab = 'pack';" + NL
        + '        this._sel = null;' + NL + '        this._proj = null;' + NL
        + "        this._focus = '';" + NL + "        this._input = '';" + NL + '        this._now = 0;' + NL + '        this.probe();',
        '    onChatChanged() {' + NL + "        this._tab = 'pack';" + NL
        + "        this._focus = '';" + NL + "        this._input = '';" + NL + '        this._now = 0;'],"""

F_NEW = u"""    q25: [AR_APP,
        '    onChatChanged() {' + NL + "        this._tab = 'pack';" + NL
        + '        this._sel = null;' + NL
        + '        /* [v4.28.0 · R4-X4] 换会话也丢掉「上一次选了哪一位冲突」：那是旧会话的选择，' + NL
        + '         *   而正史面随会话变 —— 留着它会把新会话里一个同名的冲突位当成旧选择。 */' + NL
        + '        try { this.canon.resetScene(); } catch (_e) { /* 静默：换会话绝不能因接线件而报错 */ }' + NL
        + '        this._proj = null;' + NL
        + "        this._focus = '';" + NL + "        this._input = '';" + NL + '        this._now = 0;' + NL + '        this.probe();',
        '    onChatChanged() {' + NL + "        this._tab = 'pack';" + NL
        + "        this._focus = '';" + NL + "        this._input = '';" + NL + '        this._now = 0;'],"""


def main():
    s = rd(V3450)
    s = once(s, F_OLD, F_NEW, 'q25')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(V3450, s)
    print('--- WRITTEN F ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())