#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4d.py — [v4.28.0 · R4-X4 补丁 D] 页签真源三处同步（其余两处）

页签不是自由的：`config/tab-source.js` 是**页签真源快照**（声明面），
由 tests/system-v3650_task_entry.test.mjs 的 B 面真读源码逐条核
（抽 setTab 体内第一个 [...] 的所有串，与表比集合相等），漂移即报「页签漂移」。
同时 tests/system-v3450.test.mjs 的 G7 与破坏表 q22 也锁着四个字面量。

故新增「支线结局」页签必须三处同步（补丁 A 已改第一处 app 夹取数组）：
  D1  config/tab-source.js 的 archive 登记行加 'canon'；
  D2  tests/system-v3450.test.mjs 的 G7 遍历数组加 'canon'；
  D3  tests/system-v3450.test.mjs 的 q22 破坏锚点串加 'canon'
      （**不改**则破坏锚点在真源码上 0 命中 ⇒ `hits === 1` 断言直接炸）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
TABSRC = 'config/tab-source.js'
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


D1_OLD = u"""        tabs: Object.freeze(['pack', 'face', 'reset', 'ledger']),
        file: 'apps/archive/archive-app.js', shape: 'array',
        note: '存档台；兜底包页'"""
D1_NEW = u"""        tabs: Object.freeze(['pack', 'face', 'reset', 'ledger', 'canon']),
        file: 'apps/archive/archive-app.js', shape: 'array',
        note: '存档台；兜底包页；canon=支线结局（v4.28.0 · R4-X4）'"""

D2_OLD = u"""    for (const t of ['pack', 'face', 'reset', 'ledger']) {
        assert.ok(code.indexOf(Q + t + Q) >= 0, '页签 ' + t + ' 不在');
    }
});"""
D2_NEW = u"""    for (const t of ['pack', 'face', 'reset', 'ledger', 'canon']) {
        assert.ok(code.indexOf(Q + t + Q) >= 0, '页签 ' + t + ' 不在');
    }
});"""

D3_OLD = u'''    q22: [AR_APP,
        "        const ok = ['pack', 'face', 'reset', 'ledger'];" + NL + "        this._tab = ok.indexOf(k) >= 0 ? k : 'pack';",
        "        this._tab = k;"],'''
D3_NEW = u'''    q22: [AR_APP,
        "        const ok = ['pack', 'face', 'reset', 'ledger', 'canon'];" + NL + "        this._tab = ok.indexOf(k) >= 0 ? k : 'pack';",
        "        this._tab = k;"],'''


def main():
    s = rd(TABSRC)
    s = once(s, D1_OLD, D1_NEW, 'tab-source')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(TABSRC, s)
    t = rd(V3450)
    t = once(t, D2_OLD, D2_NEW, 'v3450 G7')
    t = once(t, D3_OLD, D3_NEW, 'v3450 q22')
    wr(V3450, t)
    print('--- WRITTEN D ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())