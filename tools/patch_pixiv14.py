#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv14.py — 第二轮：修四处「锚点随产品改动失配」+ 两处判据面没盖住破坏面。

① C5 用**未剥注释**的 css 抓类名 ⇒ 文件头注释里的 `pixiv-illust.js` / `pixiv.css`
   被当成类名（`.js` / `.css`）。判据必须剥注释后再抓（本仓纪律：注释里的提及不算消费）。
② DAMAGE d1 的 from 还是 `Math.max(1,` —— 产品已改成 `Math.max(0,`（patch_pixiv11），
   锚点失配 0 次。破坏串必须跟着产品现状走。
③ DAMAGE d5 的 from 是 `if (pid && byId.has(pid) && d <= lim) {` —— 产品已改成
   `} else if (...)`（patch_pixiv11 插了环分支），锚点失配。
④ appPickProblems 还是旧正则 `[^)]*` —— patch_pixiv13 只改了 E1 的断言，这里漏改。
⑤ dataProblems 的「三态不许塌」判据写成 `nrt.face === fl.face` —— 该式抓不住
   d4 那种破坏（删掉 failed 分支后 fl.face 变成 `partial`，与 not_read **不同形**，
   判据反而放行）。真正的语义是「**failed 必须报 failed**」，改判这一条。
"""
import sys

P = 'tests/system-v3350.test.mjs'

EDITS = []

# ── ① C5 剥注释后再抓类名 ──
EDITS.append((
    "    const css = read(PX_CSS);\n"
    "    assert.ok(css.length > 2000, '样式文件必须真有内容');\n"
    "    const classes = css.match(/\\.[a-zA-Z][a-zA-Z0-9_-]*/g) || [];",
    "    const css = read(PX_CSS);\n"
    "    assert.ok(css.length > 2000, '样式文件必须真有内容');\n"
    "    /* ★ 必须**剥注释**后再抓类名：文件头注释里写了 `pixiv-illust.js` / `pixiv.css`\n"
    "     *   这类文件名，未剥注释就会把 `.js` / `.css` 当成类名（判据自己红）。 */\n"
    "    const classes = stripComments(css).match(/\\.[a-zA-Z][a-zA-Z0-9_-]*/g) || [];"))

# ── ② d1 锚点同步到产品现状 ──
EDITS.append((
    "    d1: [PX_DATA,\n"
    "        '        num: numOrNull(c.num) === null ? null : Math.max(1, Math.trunc(numOrNull(c.num))),',",
    "    d1: [PX_DATA,\n"
    "        '        num: numOrNull(c.num) === null ? null : Math.max(0, Math.trunc(numOrNull(c.num))),',"))

# ── ③ d5 锚点同步到产品现状 ──
EDITS.append((
    "    d5: [PX_DATA,\n"
    "        '        if (pid && byId.has(pid) && d <= lim) {',\n"
    "        '        if (pid && byId.has(pid) && true) {'],",
    "    d5: [PX_DATA,\n"
    "        '        } else if (pid && byId.has(pid) && d <= lim) {',\n"
    "        '        } else if (pid && byId.has(pid) && true) {'],"))

# ── ④ appPickProblems 正则同步 ──
EDITS.append((
    "const appPickProblems = (src) => {\n"
    "    const bad = [];\n"
    "    if (!/pickDiverseAuthors\\([^)]*\\)\\.picked/.test(src)) bad.push('pick-not-unwrapped');\n"
    "    return bad;\n"
    "};",
    "const appPickProblems = (src) => {\n"
    "    const bad = [];\n"
    "    /* ★ 同 E1：`[^)]*` 会卡在 `authorsActive()` 的括号上（真源码判成没拆包）。 */\n"
    "    if (!/pickDiverseAuthors\\([\\s\\S]{0,160}?\\)\\.picked/.test(src)) bad.push('pick-not-unwrapped');\n"
    "    return bad;\n"
    "};"))

# ── ⑤ failed 必须报 failed（判据面盖住破坏面） ──
EDITS.append((
    "    const nrt = mod.commentCountFace({});\n"
    "    const fl = mod.commentCountFace({ commentsAttempted: true, commentsFailed: true });\n"
    "    if (nrt.face === fl.face) bad.push('failed-collides-with-not-read');",
    "    const nrt = mod.commentCountFace({});\n"
    "    const fl = mod.commentCountFace({ commentsAttempted: true, commentsFailed: true });\n"
    "    /* ★ 判据是「**failed 必须报 failed**」而不是「两个名字不同形」：\n"
    "     *   删掉 failed 分支后 fl 会退化成 `partial`，与 not_read 不同形 ⇒ 旧式反而放行。 */\n"
    "    if (fl.face !== 'failed') bad.push('failed-collides-with-not-read');\n"
    "    if (nrt.face === fl.face) bad.push('failed-collides-with-not-read');"))

fail = 0
for from_s, to_s in EDITS:
    s = open(P, encoding='utf-8').read()
    n = s.count(from_s)
    if n != 1:
        print('FAIL 锚点命中 %d 次：%r' % (n, from_s[:70]))
        fail += 1
        continue
    open(P, 'w', encoding='utf-8').write(s.replace(from_s, to_s))
    print('OK  ← %r' % (from_s[:64].replace('\n', '⏎'),))

if fail:
    print('')
    print('失败 %d 处' % fail)
    sys.exit(1)
print('')
print('OK patch_pixiv14 全部落地')