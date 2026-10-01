#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv16.py — 修全链门禁当场报红的两处**新真缺陷**（缺陷⑪⑫）。

⑪ **零消费导出** `followedAuthorsOf`（`dead-exports` 门报红）：
   数据层导出「我关注的作者 id 集合」，但**全库零调用点** —— 视图那处直接读
   `app.stored().followedAuthorIds`（绕过真源、自己拆一遍 store）。
   这正是本仓迭代主线「导出了能力但没人用」。修法是**真接线**：
   ① 数据层那个出口就是唯一真源，App 层加 `followedAuthors()` 直调它；
   ② 视图改用 `app.followedAuthors()`，不再自己拆 store。
   并补一条「口径唯一」：App 的 `_toggle` 之后仍由数据层出口统一取。

⑫ **归因文案表手写标识符形键**（`bridge-contract` 门 J7 报红）：
   视图的 `CMT_FACE_TEXT` 键写作 `not_read` / `partial` / `read` / `failed`
   （下划线形），而真源是数据层 `commentCountFace` 现算出来的 `face` 值。
   本仓 J7 的教训（clock-view 的 FACE_META 写 `no_clock_face`、真源是连字符形
   ⇒ 五态里三态查不到、兜底全显示成同一句，而当时判据全绿）就在此：
   **手写键 = 第二个真源**。修法是把四个面名提成数据层常量 `PIXIV_COMMENT_FACES`，
   视图表用 `[PIXIV_COMMENT_FACES.not_read]` 这类**计算键**，一个都不手写。
"""
import sys

PX_DATA = 'apps/pixiv/pixiv-data.js'
PX_APP = 'apps/pixiv/pixiv-app.js'
PX_VIEW = 'apps/pixiv/pixiv-view.js'

EDITS = []

# ── ⑫ 数据层：把评论四态提成常量（真源） ──
EDITS.append((PX_DATA,
    '/** 评论数三态面（**「0 条」与「还没读」不许同形**）。 */\n'
    'export function commentCountFace(chapter) {\n'
    '    const ch = (chapter && typeof chapter === \'object\') ? chapter : {};\n'
    '    const list = Array.isArray(ch.commentsList) ? ch.commentsList : [];\n'
    '    // ★ 顺序即语义：失败**不是**「没读过」（一个是「还没试」、一个是「试了没成」），\n'
    '    //   故失败态必须排在 not_read 之前 —— 首版把它排在后面，失败被静默吞成「没读过」。\n'
    '    const face = ch.commentsFailed ? \'failed\'\n'
    '        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? \'not_read\'\n'
    '            : (ch.commentsLoaded ? \'read\' : \'partial\'));',
    '/** 评论四态的面名（**真源**）。视图的文案表必须用这些**计算键**，不许手写。\n'
    ' *  ★ 本仓 J7 的教训：clock-view 的 FACE_META 手写 `no_clock_face`（下划线形），\n'
    ' *    而真源的值是 `no-clock-face`（连字符形）⇒ 五态里三态查不到、兜底全显示成\n'
    ' *    同一句话，**而当时判据全绿**。手写键 = 第二个真源。 */\n'
    'export const PIXIV_COMMENT_FACES = {\n'
    '    not_read: \'not_read\',\n'
    '    partial: \'partial\',\n'
    '    read: \'read\',\n'
    '    failed: \'failed\',\n'
    '};\n'
    '/** 评论数三态面（**「0 条」与「还没读」不许同形**）。 */\n'
    'export function commentCountFace(chapter) {\n'
    '    const ch = (chapter && typeof chapter === \'object\') ? chapter : {};\n'
    '    const list = Array.isArray(ch.commentsList) ? ch.commentsList : [];\n'
    '    // ★ 顺序即语义：失败**不是**「没读过」（一个是「还没试」、一个是「试了没成」），\n'
    '    //   故失败态必须排在 not_read 之前 —— 首版把它排在后面，失败被静默吞成「没读过」。\n'
    '    const F = PIXIV_COMMENT_FACES;\n'
    '    const face = ch.commentsFailed ? F.failed\n'
    '        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? F.not_read\n'
    '            : (ch.commentsLoaded ? F.read : F.partial));'))

# ── ⑫ 视图：文案表改计算键 ──
EDITS.append((PX_VIEW,
    '/** 评论四态的人话（`failed` 与 `not_read` **不许同形**，故各给各的话）。 */\n'
    'const CMT_FACE_TEXT = {\n'
    '    not_read: \'评论还没读\',\n'
    '    partial: \'评论读了一半\',\n'
    '    read: \'评论已读\',\n'
    '    failed: \'评论这次没读出来\',\n'
    '};',
    '/** 评论四态的人话（`failed` 与 `not_read` **不许同形**，故各给各的话）。\n'
    ' *  ★ 键**取真源常量**（计算键），不手写标识符形 —— 见数据层 `PIXIV_COMMENT_FACES`\n'
    ' *    的注释（本仓 J7 的真缺陷：手写键与真源值不同形 ⇒ 查不到、静默走兜底）。 */\n'
    'const CMT_FACE_TEXT = {\n'
    '    [PIXIV_COMMENT_FACES.not_read]: \'评论还没读\',\n'
    '    [PIXIV_COMMENT_FACES.partial]: \'评论读了一半\',\n'
    '    [PIXIV_COMMENT_FACES.read]: \'评论已读\',\n'
    '    [PIXIV_COMMENT_FACES.failed]: \'评论这次没读出来\',\n'
    '};'))

# ── ⑫ 视图：两处 face 比较也改真源（同一个真源、同一个形态） ──
EDITS.append((PX_VIEW,
    "        if (cf.face === 'failed') {",
    '        if (cf.face === PIXIV_COMMENT_FACES.failed) {'))

EDITS.append((PX_VIEW,
    "            parts.push('<div class=\"pxv-empty\">' + (cf.face === 'not_read'",
    '            parts.push(\'<div class="pxv-empty">\' + (cf.face === PIXIV_COMMENT_FACES.not_read'))

# ── ⑪ App：把数据层那个出口接上 ──
EDITS.append((PX_APP,
    '    novelsAll() { return visibleNovels(this.novels, this.settings); }',
    '    novelsAll() { return visibleNovels(this.novels, this.settings); }\n'
    '    /** 我关注的作者 id（**走数据层那一个出口**，视图不许自己拆 store）。\n'
    '     *  ★ 数据层 `followedAuthorsOf` 首版是零消费导出（建好了没人用）—— 这里接线。 */\n'
    '    followedAuthors() { return followedAuthorsOf(this.store); }'))

# ── ⑪ App import 补 followedAuthorsOf（缺陷⑤的教训：漏导入只在走到分支时才炸） ──
EDITS.append((PX_APP,
    '    formatCount, pickDiverseAuthors, resolveWritingStyle, pixivPromptBlock, projectPixiv,',
    '    formatCount, pickDiverseAuthors, resolveWritingStyle, pixivPromptBlock, projectPixiv,\n'
    '    followedAuthorsOf,'))

# ── ⑫ 视图 import 补 PIXIV_COMMENT_FACES（同一个坑） ──
EDITS.append((PX_VIEW,
    "import { PIXIV_REASONS, PIXIV_LIMITS, PIXIV_COMMENT_DELIM } from './pixiv-data.js';",
    "import {\n"
    "    PIXIV_REASONS, PIXIV_LIMITS, PIXIV_COMMENT_DELIM, PIXIV_COMMENT_FACES,\n"
    "} from './pixiv-data.js';"))

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
    print('')
    print('失败 %d 处' % fail)
    sys.exit(1)
print('')
print('OK patch_pixiv16 全部落地')