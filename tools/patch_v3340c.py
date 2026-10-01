# -*- coding: utf-8 -*-
"""[v3.34.0] 第三批：三处判据自身修正。

① DAMAGE d8：`void 0;` 会让 `else` 悬空 ⇒ 语法错（J2 又抓到）。正确替换是
   `if (false) walk(...);` —— 保留 if/else 结构，行为上永不走深。
② C3：改挂的目标要挑**真到最深一层**的节点。夹具里第一条评论 `c1` 自己就是根（depth 1），
   拿它当回复目标**不会**触发改挂 —— 判据在测一个不存在的场景（假红）。
   改为挑 `depth === maxCommentDepth` 的那个节点。
③ I10：破坏串 `expired: pr.expired, firstId:` → 先确认它在源码里的**真形**再对齐判据
   （`appCountProblems` 现在判的是裸 `expired: pr.expired`，与破坏面不是同一行）。
"""
import io
import sys

TESTS = 'tests/system-v3340.test.mjs'

EDITS = [
    (TESTS,
     """    d8: [LF_DATA, '            if (depth < LOFTER_LIMITS.maxCommentDepth) walk(n.children, depth + 1);',
        '            void 0;'],""",
     """    d8: [LF_DATA, '            if (depth < LOFTER_LIMITS.maxCommentDepth) walk(n.children, depth + 1);',
        '            if (false) walk(n.children, depth + 1);'],""",
     'tests DAMAGE d8: 用 if (false) 保留 if/else 结构'),

    (TESTS,
     """    /* 最深一层再回复：自动改挂到顶层（源会越挂越深）。 */
    const deep = rows.reduce((acc, n) => (n.depth > (acc ? acc.depth : 0) ? n : acc), null);
    const deepReply = fresh.addComment(id, '再回一层', deep.id);
    assert.equal(deepReply.rehomed, true, '到最深一层时必须改挂到该线程顶层（源无此保护）');""",
     """    /* 最深一层再回复：自动改挂到顶层（源会越挂越深）。
     * ★ 目标必须挑**真在 maxCommentDepth 那一层**的节点：拿浅层（比如第一层）去回复
     *   不会触发改挂 —— 判据会在测一个不存在的场景。 */
    const deepest = rows.filter((n) => n.depth === DAT.LOFTER_LIMITS.maxCommentDepth);
    assert.ok(deepest.length > 0, '夹具必须真造出最深一层的评论（否则这条判据测不到东西）');
    const deepReply = fresh.addComment(id, '再回一层', deepest[0].id);
    assert.equal(deepReply.rehomed, true, '到最深一层时必须改挂到该线程顶层（源无此保护）');""",
     'tests C3: 改挂目标挑最深一层'),
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