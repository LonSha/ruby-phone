# -*- coding: utf-8 -*-
"""[v3.34.0] 本件第二处真缺陷 + 五处判据自身错。

一、产品侧真缺陷（跑单套件时抓到）：
    `buildArticleFromBlock` 把宿主给的 `COMMENT_n` 组装成了评论数组 `list`，
    但返回对象里**没把 `list` 喂给 `normalizeArticle`** ⇒ 规范器把 `comments` 兜成空数组
    —— 收下的文章评论永远 0 条，而 `stats.comments` 记的却是 `list.length`（自洽地错）。
    这与本版第一处（规范器丢 comments）是**同一形态的上下游两处**：第一处修了规范器，
    第二处在组装侧就把数据丢了。判据 C3 当场抓到（夹具的评论块放在最后一块，
    正好是 `articlesAll()[0]`）。

二、判据自身五处错（都不是产品缺陷，是判据写错或写弱）：
    ① D2 的导入面按**单行**数 `^import...\n` —— 本件 App 是**多行导入块**（`import {` 下文
       `} from '...'`）⇒ 只数到 2 条、且 imports[0] 不含 `'./lofter-data.js'`。改为按块裁。
    ② G1 把数据层的 `LOFTER_TYPE_LABELS` 期望写成 5 —— 数据层是**声明处**（1 次），
       消费在视图（3 次）。门槛写高会让判据对真实现报红（假红）。
    ③ dataProblems ⑦ 只看 `fullCount/digestCount`：`normalizeArticle` 丢键会让这两个数
       **一起**变 ⇒ 对与本条无关的破坏（I1）也转红（关联红）。改为判**摘要真被截短**。
    ④ DAMAGE d8 的替换串 `walk(n.children, depth + 1);` 让 `else` 后接语句 ⇒ 语法错
       （J2 当场报「破坏后必须仍是合法 JS」）。改为空语句。
    ⑤ C5 里那行 `assert.equal(s[k], s.raw[k] >= 1e4 || s.raw[k] === 0 ? s[k] : s[k])`
       自己等于自己 —— 装饰断言（本仓纪律不容）。改为真比对 `formatCount`。
"""
import io
import sys

DATA = 'apps/lofter/lofter-data.js'
TESTS = 'tests/system-v3340.test.mjs'

EDITS = [
    # ── 一、产品真缺陷：组装好的评论必须喂给规范器 ──────────────────────────
    (DATA,
     """        stats: { hearts: stats.hearts, favorites: stats.favorites, comments: list.length },
        createdAt: now,""",
     """        stats: { hearts: stats.hearts, favorites: stats.favorites, comments: list.length },
        // ★ 组装好的评论必须**真的喂给规范器**：此前这里没传 `comments`，
        //   宿主给的 COMMENT_n 在 `normalizeArticle` 里被兜成空数组 ⇒ 收下的文章
        //   评论永远是 0 条，而 `stats.comments` 记的却是 `list.length`（自洽地错）。
        //   这与「规范器返回对象漏了 comments 键」是**同一形态的上下游两处**。
        comments: list,
        createdAt: now,""",
     'data: buildArticleFromBlock 把组装好的评论喂给规范器'),

    # ── 二①、D2 导入面按块裁（多行导入块） ────────────────────────────────
    (TESTS,
     """    const imports = code.match(/^import[^\\n]*\\n/gm) || [];
    assert.equal(imports.length, 3, 'App 层只许三条 import（数据层 / 数值门 / 视图）');
    assert.ok(imports[0].includes('./lofter-data.js'), '第一条必须是本件数据层');
    assert.ok(imports[1].includes('../../config/num-gate.js'), '第二条必须是两层级的数值门');
    assert.ok(imports[2].includes('./lofter-view.js'), '第三条必须是本件视图');""",
     """    /* ★ 导入面是**块**（`import {` 起首、`} from '...'` 收尾）：按块裁出来数。
     *   按「单行含 import」数会**少算** —— 多行导入块的正文行不含 `import` 字样。 */
    const importBlocks = code.match(/^import[\\s\\S]*?from '[^']+';/gm) || [];
    assert.equal(importBlocks.length, 3, 'App 层只许三条 import（数据层 / 数值门 / 视图）');
    assert.ok(importBlocks[0].includes("from './lofter-data.js'"), '第一条必须是本件数据层');
    assert.ok(importBlocks[1].includes("from '../../config/num-gate.js'"), '第二条必须是两层级的数值门');
    assert.ok(importBlocks[2].includes("from './lofter-view.js'"), '第三条必须是本件视图');""",
     'tests D2: 导入面按块裁'),

    # ── 二②、G1 计数门槛改真值 ───────────────────────────────────────────
    (TESTS,
     """        /* 数据层新出口必须真被消费：类型人话表 / 非活跃清单 / 文风收口 */
        [LF_DATA, 'LOFTER_TYPE_LABELS', 5],
        [LF_VIEW, 'LOFTER_TYPE_LABELS', 2],
        [LF_VIEW, 'LOFTER_IDLE_TYPES', 2],
        [LF_DATA, 'LOFTER_IDLE_TYPES', 3],""",
     """        /* 数据层是**声明/定义处**（各自 1~2 次），消费在视图与 App。
         * ★ 门槛一律取**实测真值**，不取「希望它有几次」——写高即假红。 */
        [LF_DATA, 'LOFTER_TYPE_LABELS', 1],
        [LF_VIEW, 'LOFTER_TYPE_LABELS', 3],
        [LF_VIEW, 'LOFTER_IDLE_TYPES', 2],
        [LF_DATA, 'LOFTER_IDLE_TYPES', 2],""",
     'tests G1: 计数门槛改实测真值'),

    # ── 二③、dataProblems ⑦ 判摘要真被截短（去掉关联红） ─────────────────
    (TESTS,
     """    /* ⑦ 滑窗必须区分全文与摘要（给 8 章要 5 全文 2 摘要） */
    const chs = new Array(8).fill(0).map((_x, i) => ({ id: 'c' + i, chapterNum: i + 1, title: 't', content: 'x'.repeat(40) }));
    const ctx = mod.prevChapterContext(chs, 8, mod.LOFTER_FULL_TEXT_WINDOW);
    if (ctx.fullCount !== mod.LOFTER_FULL_TEXT_WINDOW || ctx.digestCount !== 0) bad.push('window-mode-collapsed');""",
     """    /* ⑦ 滑窗必须区分全文与摘要：给 8 章要 5 全文 2 摘要，且**摘要真的被截短**。
     *  ★ 为什么不能只看 fullCount/digestCount：那两数在 `normalizeArticle` 丢掉
     *    `chapterNum` 时会**一起**归零（关联红）—— 判据就会对与本条无关的破坏也转红，
     *    假红比漏报更伤（本仓记过的账）。故判据落在**模式与内容长度**上。 */
    const chs = new Array(8).fill(0).map((_x, i) => ({ id: 'c' + i, chapterNum: i + 1, title: 't', content: 'x'.repeat(400) }));
    const ctx = mod.prevChapterContext(chs, 8, mod.LOFTER_FULL_TEXT_WINDOW);
    if (ctx.fullCount !== mod.LOFTER_FULL_TEXT_WINDOW || ctx.digestCount !== 2) bad.push('window-mode-collapsed');
    for (const b of ctx.blocks) {
        const len = String(b.text || '').length;
        if (b.mode === 'digest' && len > 260) bad.push('digest-not-truncated');
        if (b.mode === 'full' && len < 400) bad.push('full-truncated');
    }""",
     'tests dataProblems: 滑窗判据改判内容截断'),

    # ── 二④、DAMAGE d8 替换串保持语法合法（else 后需语句） ────────────────
    (TESTS,
     """    d8: [LF_DATA, '            if (depth < LOFTER_LIMITS.maxCommentDepth) walk(n.children, depth + 1);',
        '            walk(n.children, depth + 1);'],""",
     """    /* ★ 替换串必须让**破坏后的源码仍是合法 JS**（`else` 后面直接接 `walk(...)` 会语法错，
     *   转红就只证明「文件坏了」而不是「行为变了」）——J2 当场抓过这一条。 */
    d8: [LF_DATA, '            if (depth < LOFTER_LIMITS.maxCommentDepth) walk(n.children, depth + 1);',
        '            void 0;'],""",
     'tests DAMAGE d8: 替换串保持语法合法'),

    # ── 二⑤、C5 装饰断言换成真比对 ───────────────────────────────────────
    (TESTS,
     """        assert.equal(s[k], s.raw[k] >= 1e4 || s.raw[k] === 0 ? s[k] : s[k], k + ' 一致性自持');""",
     """        assert.equal(s[k], DAT.formatCount(s.raw[k]), k + ' 显示串必须是 formatCount 出口（不是自比）');""",
     'tests C5: 装饰断言换真比对'),

    # ── 三、C3 夹具：评论块放**最后一块**（它就是 articlesAll()[0]） ──────
    (TESTS,
     """const batchText = (n) => [
    '---LOF---', 'TAG: [N1]', 'TITLE: 第一篇', 'TAGS: #宿命', 'CONTENT: 雨下了一整夜，伞骨断了三根。',
    'COMMENT_1: 路人甲|我看哭了', 'COMMENT_2: 路人乙|刀味很足',
    '---LOF---', 'TAG: [N2]', 'TITLE: 第二篇', 'TAGS: #日常', 'CONTENT: 草莓两盒，一盒放冰箱一盒门口。',
].join('\\n') + (n > 2 ? '\\n---LOF---\\nTAG: [N3]\\nTITLE: 第三篇\\nCONTENT: 第三篇的正文也得够长才行。' : '');""",
     """/* ★ 夹具的口径：带 `COMMENT_n` 的块一律放**最后一块** —— 新文章在最前（`articlesAll()[0]`），
 *   评论判据要拿到的正是它。写成第一块会让判据去量一篇**没有评论**的文章（假红）。 */
const batchText = (n) => [
    '---LOF---', 'TAG: [N1]', 'TITLE: 第一篇', 'TAGS: #宿命', 'CONTENT: 雨下了一整夜，伞骨断了三根。',
    '---LOF---', 'TAG: [N2]', 'TITLE: 第二篇', 'TAGS: #日常', 'CONTENT: 草莓两盒，一盒放冰箱一盒门口。',
].join('\\n') + (n > 2
    ? '\\n---LOF---\\nTAG: [N3]\\nTITLE: 第三篇\\nCONTENT: 第三篇的正文也得够长才行。\\n'
        + 'COMMENT_1: 路人甲|我看哭了\\nCOMMENT_2: 路人乙|刀味很足'
    : '');""",
     'tests 夹具: 评论块放最后一块'),

    (TESTS,
     """    const st = memStorage();
    const app = new LofterApp(null, st);
    app.probe();
    app.ingestBatch(batchText(2));
    const id = app.articlesAll()[0].id;
    assert.equal(app.commentsOf(id).length, 2, '宿主给的两条评论必须收下');""",
     """    const st = memStorage();
    const app = new LofterApp(null, st);
    app.probe();
    app.ingestBatch(batchText(3));
    const id = app.articlesAll()[0].id;
    assert.equal(app.commentsOf(id).length, 2,
        '宿主给的两条评论必须收下（组装侧不喂给规范器就会在这里归零）');""",
     'tests C3: 用带评论的那一块'),
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