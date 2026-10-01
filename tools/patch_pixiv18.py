#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv18.py — 同步 d4 破坏锚点到产品现状（patch_pixiv16 改过 commentCountFace）。

patch_pixiv16 把 `commentCountFace` 里的裸字面量 `'failed'` / `'not_read'` 换成
`PIXIV_COMMENT_FACES` 的计算键（真源），于是 d4 的破坏串**锚点失配 0 次**
（I4 与 J2 当场报红 —— 这正是「改产品就得同步破坏表」这条纪律在起作用）。

同时把 dataProblems 的期望值也改成取真源（判据不该再手写面名字面量）。
"""
import sys

P = 'tests/system-v3350.test.mjs'

EDITS = []

# ── d4 破坏串同步到产品现状 ──
EDITS.append((
    "    d4: [PX_DATA,\n"
    "        \"    const face = ch.commentsFailed ? 'failed'\\n\" +\n"
    "        \"        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'\",\n"
    "        \"    const face = ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'\"],",
    "    d4: [PX_DATA,\n"
    "        '    const face = ch.commentsFailed ? F.failed\\n' +\n"
    "        '        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? F.not_read',\n"
    "        '    const face = ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? F.not_read'],"))

# ── 判据期望值取真源（不再手写面名） ──
EDITS.append((
    "    if (fl.face !== 'failed') bad.push('failed-collides-with-not-read');",
    "    if (fl.face !== mod.PIXIV_COMMENT_FACES.failed) bad.push('failed-collides-with-not-read');"))

fail = 0
for from_s, to_s in EDITS:
    s = open(P, encoding='utf-8').read()
    n = s.count(from_s)
    if n != 1:
        print('FAIL 锚点命中 %d 次：%r' % (n, from_s[:70]))
        fail += 1
        continue
    open(P, 'w', encoding='utf-8').write(s.replace(from_s, to_s))
    print('OK  ← %r' % (from_s[:60].replace('\n', '⏎'),))

if fail:
    sys.exit(1)
print('')
print('OK patch_pixiv18 全部落地')