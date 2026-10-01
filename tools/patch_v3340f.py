# -*- coding: utf-8 -*-
"""[v3.34.0] 第六批：C3 夹具挑错层级（第二版）。

第一版以为「我来说一句」在第二层 —— 其实 App 的 addComment 不传 replyToId 时
`replyToCommentId: null` ⇒ 它和「再来一条」都是**根**（depth 1）。真正落在第二层的
是紧接着回的「回第一条」。所以：
  第二层节点 = rows.find(content === '回第一条')  (depth 2)
  回复它 ⇒ 第三层（= maxCommentDepth），这才坐得满。
"""
import io
import sys

TESTS = 'tests/system-v3340.test.mjs'

EDITS = [
    (TESTS,
     """    const mid = fresh.commentRows(id).find((n) => n.content === '我来说一句');
    assert.ok(mid && mid.depth === 2, '前置：夹具必须先把第二层坐实');
    const deeper = fresh.addComment(id, '再深一层', mid.id);""",
     """    /* ★ 第二层是「回第一条」（不传 replyToId 的评论会落成根，depth 1）——
     *   夹具拿根节点当第二层会让第三层永远坐不满（一度如此）。 */
    const mid = fresh.commentRows(id).find((n) => n.content === '回第一条');
    assert.ok(mid && mid.depth === 2, '前置：夹具必须先把第二层坐实');
    const deeper = fresh.addComment(id, '再深一层', mid.id);""",
     'tests C3: 第二层目标改为「回第一条」'),
]


def edit(path, old, new, label):
    with io.open(path, encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
        sys.exit(1)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text.replace(old, new, 1))
    print('OK   %s' % label)


for path, old, new, label in EDITS:
    edit(path, old, new, label)
print('全部完成')