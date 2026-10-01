#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv17.py — 把视图那处「自己拆 store」改成走数据层出口（补 ⑪ 的真接线）。

patch_pixiv16 把数据层 `followedAuthorsOf` 接到了 App 的 `followedAuthors()`，
但视图那处仍在 `app.stored().followedAuthorIds` 上自己取一遍 —— 门禁能过
（有调用点了），**语义上仍是两套口径**：数据层那个出口一旦改口径（例如把
「无效 id 过滤掉」），视图显示的还是旧口径。本脚本把视图也改到那个出口。
"""
import sys

PX_VIEW = 'apps/pixiv/pixiv-view.js'

EDITS = []

EDITS.append((PX_VIEW,
    '        const active = app.authorsActive();\n'
    '        const followed = app.stored().followedAuthorIds;',
    '        const active = app.authorsActive();\n'
    '        // ★ 走 App 那个出口（它直调数据层 `followedAuthorsOf`）—— 视图自己拆 store\n'
    '        //   就是第二个口径，数据层改口径后视图不会跟着变。\n'
    '        const followed = app.followedAuthors();'))

fail = 0
for rel, from_s, to_s in EDITS:
    s = open(rel, encoding='utf-8').read()
    n = s.count(from_s)
    if n != 1:
        print('FAIL %s 锚点命中 %d 次：%r' % (rel, n, from_s[:70]))
        fail += 1
        continue
    open(rel, 'w', encoding='utf-8').write(s.replace(from_s, to_s))
    print('OK  %s  ← %r' % (rel, from_s[:60].replace('\n', '⏎')))

if fail:
    sys.exit(1)
print('')
print('OK patch_pixiv17 全部落地')