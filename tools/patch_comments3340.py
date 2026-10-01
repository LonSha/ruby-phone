# -*- coding: utf-8 -*-
"""[v3.34.0] 修 lofter-data.js 的一处**真缺陷**：`normalizeArticle` 把 `comments` 丢了。

症状（跑起来是**静默**的，不报错、不崩溃）：
  `probe()` 每次读盘都过一遍 `normalizeArticle`。文章对象里带着 `comments`（评论数组），
  但 `normalizeArticle` 的返回对象里**没有这个键** ⇒ 每次重取，所有评论**全部消失**。
  更坏的是它是**自洽地消失**：`stats.comments` 还在（是个数），评论数组却没了 ——
  视图会显示「3 条评论」而点进去一条都没有。
  这是「不报错、不崩溃、只错数据」那一族，靠读代码很难看出来，靠跑一次就露。

本补丁：
  ① 在 `normalizeArticle` 里补 `comments` 的逐条收口（id 缺就按序补、楼中楼指向收成字符串或 null、
     likes 走 numOrNull、`isOpReply` 只认显式 true），并按 `maxCommentsPerArticle` 截断；
  ② 把 `comments` 挂进返回对象。

替换按多行锚点原文，命中次数必须恰好 1。
"""
import sys

PATH = 'apps/lofter/lofter-data.js'

A_OLD = """    const heartN = numOrNull(a && a.stats ? a.stats.hearts : null);
    const favN = numOrNull(a && a.stats ? a.stats.favorites : null);
    const cmtN = numOrNull(a && a.stats ? a.stats.comments : null);"""

A_NEW = """    const heartN = numOrNull(a && a.stats ? a.stats.hearts : null);
    const favN = numOrNull(a && a.stats ? a.stats.favorites : null);
    const cmtN = numOrNull(a && a.stats ? a.stats.comments : null);
    // ★ 评论数组必须**在这里保住**：`probe()` 每次读盘都过本函数，
    //   此前返回对象里没有 `comments` 键 ⇒ 每次重取所有评论静默消失，
    //   而 `stats.comments` 是个数还在（视图显示「3 条」点进去 0 条，自洽地错）。
    const comments = Array.isArray(a.comments) ? a.comments.slice(0, LOFTER_LIMITS.maxCommentsPerArticle).map((c, i) => ({
        id: String((c && c.id) || ('c' + (i + 1))),
        author: String((c && c.author) || '').trim(),
        content: String((c && c.content) || '').trim(),
        replyToCommentId: (c && c.replyToCommentId) ? String(c.replyToCommentId) : null,
        likes: Math.max(0, numOrNull(c && c.likes) === null ? 0 : Math.trunc(numOrNull(c && c.likes))),
        isOpReply: (c && c.isOpReply) === true,
        createdAt: numOrNull(c && c.createdAt) === null ? 0 : Math.trunc(numOrNull(c && c.createdAt)),
    })) : [];"""

B_OLD = """        coverHue: clampHue(a.coverHue),
        stats: {
            hearts: heartN === null ? 0 : Math.max(0, Math.trunc(heartN)),
            favorites: favN === null ? 0 : Math.max(0, Math.trunc(favN)),
            comments: cmtN === null ? 0 : Math.max(0, Math.trunc(cmtN)),
        },"""

B_NEW = """        coverHue: clampHue(a.coverHue),
        comments,
        stats: {
            hearts: heartN === null ? 0 : Math.max(0, Math.trunc(heartN)),
            favorites: favN === null ? 0 : Math.max(0, Math.trunc(favN)),
            comments: cmtN === null ? 0 : Math.max(0, Math.trunc(cmtN)),
        },"""


def patch(text: str, old: str, new: str, tag: str) -> str:
    n = text.count(old)
    if n != 1:
        print('FAIL[%s]: 锚点命中 %d 次（必须恰好 1 次）' % (tag, n))
        sys.exit(1)
    return text.replace(old, new, 1)


def main() -> int:
    with open(PATH, encoding='utf-8') as f:
        text = f.read()
    text = patch(text, A_OLD, A_NEW, 'A')
    text = patch(text, B_OLD, B_NEW, 'B')
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(text)
    print('两处锚点各命中 1 次，comments 已保进 normalizeArticle。')
    return 0


if __name__ == '__main__':
    sys.exit(main())