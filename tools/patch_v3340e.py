# -*- coding: utf-8 -*-
"""[v3.34.0] 第五批：C3 夹具层数与 d8 破坏面。

① C3：夹具只坐了两层（根 + 回复），而改挂判定要求目标在 `maxCommentDepth`(=3) 那一层 ⇒
   `deepest` 恒为空、断言先炸。修法：**先补齐第三层**（回复现处于第二层的「我来说一句」），
   再去挑最深一层做改挂。这属于夹具自身没搭够场景，不是产品问题。
② d8：替换串一度写成 `if (false)`（为绕开 `else` 悬空），结果深度根本没被放开 ⇒
   `comment-depth-unbounded` 永远不报（假绿）。`if (true)` 既保留 `if/else` 结构
   （语法合法，J2 过），又真让 walk 无条件递归 ⇒ 深度真越界。
"""
import io
import sys

TESTS = 'tests/system-v3340.test.mjs'

EDITS = [
    (TESTS,
     """    /* 最深一层再回复：自动改挂到顶层（源会越挂越深）。
     * ★ 目标必须挑**真在 maxCommentDepth 那一层**的节点：拿浅层（比如第一层）去回复
     *   不会触发改挂 —— 判据会在测一个不存在的场景。 */
    const deepest = rows.filter((n) => n.depth === DAT.LOFTER_LIMITS.maxCommentDepth);
    assert.ok(deepest.length > 0, '夹具必须真造出最深一层的评论（否则这条判据测不到东西）');""",
     """    /* ★ 夹具必须**先把楼层坐满**：此刻最多只有两层（两条根 + 它们的回复），
     *   直接挑 `depth === 3` 会挑到空数组 —— 判据在测一个不存在的场景（一度如此）。
     *   回复现处于第二层的「我来说一句」，第三层才真出现。 */
    const mid = fresh.commentRows(id).find((n) => n.content === '我来说一句');
    assert.ok(mid && mid.depth === 2, '前置：夹具必须先把第二层坐实');
    const deeper = fresh.addComment(id, '再深一层', mid.id);
    assert.equal(deeper.rehomed, false, '第二层回复不许被改挂');
    /* 最深一层再回复：自动改挂到顶层（源会越挂越深）。
     * ★ 目标必须挑**真在 maxCommentDepth 那一层**的节点：拿浅层（比如第一层）去回复
     *   不会触发改挂 —— 判据会在测一个不存在的场景。 */
    const deepest = fresh.commentRows(id).filter((n) => n.depth === DAT.LOFTER_LIMITS.maxCommentDepth);
    assert.ok(deepest.length > 0, '夹具必须真造出最深一层的评论（否则这条判据测不到东西）');""",
     'tests C3: 夹具补齐第三层再挑改挂目标'),

    (TESTS,
     """        '            if (false) walk(n.children, depth + 1);'],""",
     """        '            if (true) walk(n.children, depth + 1);'],""",
     'tests DAMAGE d8: if (false) → if (true)（真放开深度，且语法合法）'),
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
