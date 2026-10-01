#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv11.py — 修 v3.35.0 首轮测试自红暴露的**四处产品真缺陷**（数据层三处）。

首轮 tests/system-v3350.test.mjs 跑出 15 条红。逐条取证后归成两类：
  · 判据口径错（6 处，判据自己写错）—— 归 patch_pixiv13 修；
  · **产品真缺陷（5 处）** —— 本脚本修数据层三处：
    ⑦ `normalizeChapter` 的 `Math.max(1, ...)` 把**合法章号 0 抬成 1**
       （篡改给定数据；且 0 抬成 1 会与既有 num=1 的章撞号）。
       下界必须是 0 —— 「0 是合法章号」这条纪律写在同文件的 A7 判据里。
    ⑧ `buildCommentTree` 对**互指环**（A 回 B、B 回 A）两个节点都不挂：
       环里两条既不是根、也不在任何人的 children 里 ⇒ `roots` 为空 ⇒
       **整块评论从树上消失**（视图拿到空数组，评论区一片空白）。
       源靠 `guard < 50` 停下但同样丢块；本件必须各自当根并如实计数。
    ⑨ `visibleNovels` 把**没有任何章的作品**一律滤掉 ⇒ 用户刚建好的草稿
       「建完就看不见」（源是 push 进列表、不重建可见集，故不会遇到）。
       本件每次 `probe()` 重建可见集，不加这条就把草稿吞掉。
"""
import sys

PX_DATA = 'apps/pixiv/pixiv-data.js'

EDITS = []

# ───────────────────────── ⑦ 章号下界必须是 0 ─────────────────────────
EDITS.append((PX_DATA,
    '        num: numOrNull(c.num) === null ? null : Math.max(1, Math.trunc(numOrNull(c.num))),',
    '        num: numOrNull(c.num) === null ? null : Math.max(0, Math.trunc(numOrNull(c.num))),'))

EDITS.append((PX_DATA,
    '        // ★ 坏号与「没给」都是 null —— **不许静默补成位置号**：补号会与相邻章撞号\n'
    '        //   （目录两格同号、按号查找只找得到第一条 ⇒ 点一格进另一条），且与纪律区\n'
    '        //   的「坏值即 null」自相矛盾。条数不受影响：`normalizeNovel` 不滤坏号章。',
    '        // ★ 坏号与「没给」都是 null —— **不许静默补成位置号**：补号会与相邻章撞号\n'
    '        //   （目录两格同号、按号查找只找得到第一条 ⇒ 点一格进另一条），且与纪律区\n'
    '        //   的「坏值即 null」自相矛盾。条数不受影响：`normalizeNovel` 不滤坏号章。\n'
    '        // ★ 下界是 **0 不是 1**：0 是合法章号（序章 / 第 0 話）。首版写 `Math.max(1, ...)`\n'
    '        //   把「显式给的 0」抬成 1 —— 篡改给定数据，且会与既有 num=1 的章撞号。'))

# ───────────────────────── ⑨ 自建草稿不许被可见集吞掉 ─────────────────────────
EDITS.append((PX_DATA,
    '/** 可见作品（`showInvalidNovels === false` 时滤掉没有任何章的）。 */\n'
    'export function visibleNovels(novels, settings) {\n'
    '    const st = normalizePixivSettings(settings);\n'
    '    const arr = (Array.isArray(novels) ? novels : []).map((n) => normalizeNovel(n));\n'
    '    const kept = st.showInvalidNovels ? arr : arr.filter((n) => n.chapters.length > 0);',
    '/** 可见作品（`showInvalidNovels === false` 时滤掉没有任何章的）。\n'
    ' *  ★ 用户自建的（`isUserCreated`）**一律可见**：刚建好还没写正文的草稿若被滤掉，\n'
    ' *    建完就「看不见」—— 视图建完立刻 `openNovel`，而列表里没有它，用户点不回去。\n'
    ' *    源是「建了就往数组里 push、列表不重建」，故不会遇到；本件每次 `probe()`\n'
    ' *    重建可见集，不写这条就会把草稿吞掉（且不报错，静默）。 */\n'
    'export function visibleNovels(novels, settings) {\n'
    '    const st = normalizePixivSettings(settings);\n'
    '    const arr = (Array.isArray(novels) ? novels : []).map((n) => normalizeNovel(n));\n'
    '    const kept = st.showInvalidNovels ? arr : arr.filter((n) => n.chapters.length > 0 || n.isUserCreated);'))

# ───────────────────────── ⑧ 互指环必须各自当根 ─────────────────────────
EDITS.append((PX_DATA,
    '    const roots = [];\n'
    '    let truncated = 0;\n'
    '    let orphans = 0;\n'
    '    // 先按父指针算深度（带访问集，防自指）\n'
    '    const depthOf = (node) => {\n'
    '        const seen = new Set([node.id]);\n'
    '        let cur = node;\n'
    '        let d = 1;\n'
    '        while (cur && cur.replyToCommentId) {\n'
    '            const pid = String(cur.replyToCommentId);\n'
    '            if (seen.has(pid)) break;',
    '    const roots = [];\n'
    '    let truncated = 0;\n'
    '    let orphans = 0;\n'
    '    // ★ 环内节点（A 回 B、B 回 A，或自指）：既不是根、也不在任何人的子树里\n'
    '    //   ⇒ 必须**各自当根**，否则整块评论从树上消失（视图拿到空数组、评论区全白）。\n'
    '    //   源靠 `guard < 50` 步数上限停下，同样丢块；本件如实计数。\n'
    '    let cycleRoots = 0;\n'
    '    const inCycle = new Set();\n'
    '    // 先按父指针算深度（带访问集，防自指）\n'
    '    const depthOf = (node) => {\n'
    '        const seen = new Set([node.id]);\n'
    '        let cur = node;\n'
    '        let d = 1;\n'
    '        while (cur && cur.replyToCommentId) {\n'
    '            const pid = String(cur.replyToCommentId);\n'
    '            if (seen.has(pid)) { inCycle.add(node.id); break; }'))

EDITS.append((PX_DATA,
    "        const pid = node.replyToCommentId ? String(node.replyToCommentId) : '';\n"
    '        if (pid && byId.has(pid) && d <= lim) {',
    "        const pid = node.replyToCommentId ? String(node.replyToCommentId) : '';\n"
    '        if (inCycle.has(node.id)) {\n'
    '            cycleRoots += 1;\n'
    '            roots.push(node);\n'
    '            node.depth = 1;\n'
    '        } else if (pid && byId.has(pid) && d <= lim) {'))

EDITS.append((PX_DATA,
    '    roots.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));\n'
    '    return { roots, truncated, orphans };',
    '    roots.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));\n'
    '    return { roots, truncated, orphans, cycleRoots };'))

fail = 0
for rel, from_s, to_s in EDITS:
    s = open(rel, encoding='utf-8').read()
    n = s.count(from_s)
    if n != 1:
        print('FAIL %s 锚点命中 %d 次：%r' % (rel, n, from_s[:70]))
        fail += 1
        continue
    open(rel, 'w', encoding='utf-8').write(s.replace(from_s, to_s))
    print('OK  %s  ← %r' % (rel, from_s[:64].replace('\n', '⏎')))

if fail:
    print('')
    print('失败 %d 处' % fail)
    sys.exit(1)
print('')
print('OK patch_pixiv11 全部落地')