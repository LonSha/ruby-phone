#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_p1.py — 逐项核对 DAMAGE 表十项锚点在**当前源码**里的命中次数。

patch_pixiv11 / 12 改过产品源码，故锚点须重新核对（改了就得重新量）。
"""
import sys

PX_DATA = 'apps/pixiv/pixiv-data.js'
PX_APP = 'apps/pixiv/pixiv-app.js'
PX_VIEW = 'apps/pixiv/pixiv-view.js'

d = open(PX_DATA, encoding='utf-8').read()
a = open(PX_APP, encoding='utf-8').read()
v = open(PX_VIEW, encoding='utf-8').read()

ANCHORS = [
    ('d1', d, '        num: numOrNull(c.num) === null ? null : Math.max(0, Math.trunc(numOrNull(c.num))),'),
    ('d2', d, '        hearts: chapters.some((c) => c.num !== null) ? maxCh'),
    ('d3', d, '    const types = PIXIV_ACTIVE_TYPES.concat(PIXIV_IDLE_TYPES);'),
    ('d4', d, "    const face = ch.commentsFailed ? 'failed'\n        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'"),
    ('d5', d, '        } else if (pid && byId.has(pid) && d <= lim) {'),
    ('d6', d, '        const rawCh = rawArr[pos] || null;'),
    ('a1', a, '        const rc = this._readRaw(CONTENT_KEY);'),
    ('a2', a, '        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed).picked;'),
    ('a3', a, '            countableChapters: n.chapters.filter((c) => c.num !== null).length,'),
    ('v1', v, "        const rec = app.recommendAuthors(3, '', 7);"),
]

bad = 0
for key, src, needle in ANCHORS:
    n = src.count(needle)
    if n != 1:
        bad += 1
    print('%s %-4s hit=%d  %r' % ('OK ' if n == 1 else '!!!', key, n, needle[:60]))

print('')
print('失配 =', bad)
sys.exit(1 if bad else 0)