#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_p0.py — 核对 patch_pixiv11 将要用到的全部锚点在现源码里的命中次数。"""
import sys

ANCHORS = [
    # ---- 产品侧：数据层 ----
    ('apps/pixiv/pixiv-data.js', 'P1 章号拾到 1',
     '        num: numOrNull(c.num) === null ? null : Math.max(1, Math.trunc(numOrNull(c.num))),'),
    ('apps/pixiv/pixiv-data.js', 'P2 单章规范化 头注释（插 chapNum 的位置）',
     '/** 单章规范化。★ 章的三个状态位**各自独立**，不许合并成一个 boolean。 */'),
    ('apps/pixiv/pixiv-data.js', 'P3 可见作品过滤',
     '    const kept = st.showInvalidNovels ? arr : arr.filter((n) => n.chapters.length > 0);'),
    ('apps/pixiv/pixiv-data.js', 'P3b 可见作品 头注释',
     '/** 可见作品（`showInvalidNovels === false` 时滤掉没有任何章的）。 */'),
    ('apps/pixiv/pixiv-data.js', 'P4a depthOf 签名与体',
     '    const depthOf = (node) => {\n'
     '        const seen = new Set([node.id]);\n'
     '        let cur = node;\n'
     '        let d = 1;\n'
     '        while (cur && cur.replyToCommentId) {\n'
     '            const pid = String(cur.replyToCommentId);\n'
     '            if (seen.has(pid)) break;\n'),
    ('apps/pixiv/pixiv-data.js', 'P4b for 循环判定头',
     '        const pid = node.replyToCommentId ? String(node.replyToCommentId) : \'\';\n'
     '        if (pid && byId.has(pid) && d <= lim) {'),
    ('apps/pixiv/pixiv-data.js', 'P4c 超深分支',
     '        } else if (pid && byId.has(pid) && d > lim) {'),
    ('apps/pixiv/pixiv-data.js', 'P6 位置面章号',
     '    const num = numOrNull(chapterNum) === null ? 1 : Math.max(1, Math.trunc(numOrNull(chapterNum)));'),
    # ---- 产品侧：编排层 ----
    ('apps/pixiv/pixiv-app.js', 'P5a copyPrompt chapter 语言行',
     "            if (b.language === 'jp-cn') lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');\n"
     "            if (b.userDirection) lines.push('另外：' + b.userDirection);\n"
     "        } else if (b.mode === 'comment') {"),
    ('apps/pixiv/pixiv-app.js', 'P5b copyPrompt novel 语言行',
     "            if (b.minWords) lines.push('至少 ' + b.minWords + ' 字。');\n"
     "            if (b.language === 'jp-cn') lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');\n"
     "            if (b.userDirection) lines.push('另外：' + b.userDirection);"),
    # ---- 判据侧 ----
    ('tests/system-v3350.test.mjs', 'T1 A7 负数断言',
     "    assert.equal(DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num, 1, '负数抬到 1（下界）');"),
    ('tests/system-v3350.test.mjs', 'T2 C5 alien 过滤',
     "    const alien = [...new Set(classes)].filter((c) => c.indexOf('.pxv-') !== 0);"),
    ('tests/system-v3350.test.mjs', 'T3 E1 拆包正则',
     "    assert.ok(/pickDiverseAuthors\\([^)]*\\)\\.picked/.test(app), '必须显式拆包 `.picked`（否则视图拿到对象）');"),
    ('tests/system-v3350.test.mjs', 'T4 dataProblems ③ 之后（插 raw-chapter-by-number）',
     "    if (onlyBad.hearts === 0 && 500 > 0) bad.push('cache-hearts-zeroed-by-bad-num');"),
    ('tests/system-v3350.test.mjs', 'T5 appReadProblems 全函数',
     "const appReadProblems = (src) => {\n"
     "    const bad = [];\n"
     "    if (!src.includes('_readRaw(')) bad.push('read-raw-not-used');\n"
     "    if (!/storageOk\\s*=/.test(src)) bad.push('storage-ok-not-computed');\n"
     "    return bad;\n"
     "};"),
    ('tests/system-v3350.test.mjs', 'T6 appPickProblems 全函数',
     "const appPickProblems = (src) => {\n"
     "    const bad = [];\n"
     "    if (!/pickDiverseAuthors\\([^)]*\\)\\.picked/.test(src)) bad.push('pick-not-unwrapped');\n"
     "    return bad;\n"
     "};"),
    ('tests/system-v3350.test.mjs', 'T7 DAMAGE d4',
     "    d4: [PX_DATA,\n"
     "        \"    const face = ch.commentsFailed ? 'failed'\\n\"\n"
     "        \"        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'\" +,\n"
     "        \"    const face = ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'\"],"),
    ('tests/system-v3350.test.mjs', 'T8 DAMAGE d6',
     "    d6: [PX_DATA,\n"
     "        '        const rawCh = rawArr[pos] || null;',\n"
     "        '        const rawCh = rawArr[(c.num === null ? pos + 1 : c.num) - 1] || null;'],"),
    ('tests/system-v3350.test.mjs', 'T9 DAMAGE a1',
     "    a1: [PX_APP,\n"
     "        '        const rc = this._readRaw(CONTENT_KEY);',\n"
     "        '        const rc = { ok: true, raw: this._readJSON(CONTENT_KEY) };'],"),
    ('tests/system-v3350.test.mjs', 'T10 NEG I6 行',
     "    ['I6 破坏「原始章按下标配对」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['cache-hearts-zeroed-by-bad-num']],"),
    ('tests/system-v3350.test.mjs', 'T11 A14 自指断言',
     "    assert.ok(t2.roots.length >= 1, '自指数据必须能建出树（不许卡死/抛错）');"),
]

bad = 0
for rel, name, needle in ANCHORS:
    s = open(rel, encoding='utf-8').read()
    n = s.count(needle)
    flag = 'OK ' if n == 1 else '!!!'
    if n != 1:
        bad += 1
    print('%s %-52s hit=%d' % (flag, name, n))

print('')
print('失配数 =', bad)
sys.exit(1 if bad else 0)