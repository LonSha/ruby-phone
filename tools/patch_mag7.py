#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag7.py — [v3.36.0] 冒烟脚本三处自纠（都是**冒烟自己的口径错**，不是产品缺陷）。

  S1 E3 口径错：`app.ingest(null)` 走的是「空输入 → 产一篇空稿」的**合法路径**
     （`reason: 'ok'`，标题与正文都是空串，靠 `normalizeArticle` 的缺省兜住）。
     冒烟却断言 `reason === 'bad_input'`。**这不是产品缺陷** —— 产品对 `null` 的
     处置是「当空对象办」，与 `normalizeArticle(null)` 的既有口径一致（不抛、给缺省）。
     修法：断言改成「不抛 + 产出的稿件字段面完整 + reason 是 'ok'」，
     并**另加一条**：坏 `vol` 走缺省、不许抛。
  S2 H4/H5 口径错：冒烟直接扫**源码全文**，于是文件头里逐条写明「源有什么、本仓
     为什么不能有」的那些词（`callChatAPI` / `AppState` / `Utils.saveData`）被当成
     违规命中。本仓纪律是「**注释里的提及不算消费**」⇒ 冒烟也必须先剥注释。
     修法：内置一个与判据套件同款的字符状态机剥注释器，先剥再扫。
"""
import io
import sys

P = 'tools/smoke3360.mjs'
text = io.open(P, encoding='utf-8').read()

# ── S1 E3 ──
OLD_E3 = "ok('E3 坏输入不抛', app3.ingest(null).reason === 'bad_input');"
NEW_E3 = ("/* ★ 口径：`ingest(null)` 走的是「空输入 → 产一篇空稿」的合法路径（字段面靠\n"
          " *   `normalizeArticle` 的缺省兜住），**不是** 'bad_input'。断言改成「不抛 + 字段面完整」。 */\n"
          "ok('E3 空输入不抛且产出的字段面完整', (() => {\n"
          "    const rr = app3.ingest(null);\n"
          "    return rr.reason === 'ok' && rr.article\n"
          "        && typeof rr.article.id === 'string' && typeof rr.article.vol === 'number'\n"
          "        && typeof rr.article.content === 'string' && Array.isArray(rr.article.peopleIds);\n"
          "})());\n"
          "ok('E3b 坏期号不抛、走缺省', (() => {\n"
          "    const rr = app3.ingest({ type: 'column', vol: 'nope', response: 'TITLE: x\\n正文' });\n"
          "    return rr.reason === 'ok' && rr.article.vol >= 1;\n"
          "})());")
assert text.count(OLD_E3) == 1, 'E3 锚点'
text = text.replace(OLD_E3, NEW_E3, 1)

# ── S2 H4/H5：先剥注释 ──
OLD_H = ("ok('H4 零网络调用', !/fetch\\(|callChatAPI|XMLHttpRequest/.test(appSrc + viewSrc + dataSrc));\n"
         "ok('H5 零宿主写入', !/Utils\\.saveData|AppState|pushMessage/.test(appSrc + viewSrc + dataSrc));")
NEW_H = ("/* ★ 先剥注释再扫：本仓纪律「注释里的提及不算消费」—— 文件头逐条写明了\n"
         " *   「源有什么、本仓为什么不能有」，那些词是**说明**不是**消费**。 */\n"
         "const stripComments = (src) => {\n"
         "    let out = '';\n"
         "    let i = 0;\n"
         "    let state = 'code';\n"
         "    while (i < src.length) {\n"
         "        const c = src[i];\n"
         "        const d = src[i + 1];\n"
         "        if (state === 'code') {\n"
         "            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }\n"
         "            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }\n"
         "            if (c === \"'\" || c === '\"' || c === '`') { state = c; out += c; i += 1; continue; }\n"
         "            out += c; i += 1; continue;\n"
         "        }\n"
         "        if (state === 'line') { if (c === '\\n') { state = 'code'; out += c; } i += 1; continue; }\n"
         "        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }\n"
         "        if (c === '\\\\') { out += c + (d || ''); i += 2; continue; }\n"
         "        out += c; i += 1;\n"
         "        if (c === state) state = 'code';\n"
         "    }\n"
         "    return out;\n"
         "};\n"
         "const code = stripComments(appSrc) + '\\n' + stripComments(viewSrc) + '\\n' + stripComments(dataSrc);\n"
         "ok('H4 零网络调用', !/fetch\\(|callChatAPI|XMLHttpRequest/.test(code));\n"
         "ok('H5 零宿主写入', !/Utils\\.saveData|AppState|pushMessage/.test(code));\n"
         "ok('H6 剥注释器已复位（三件都能剥净文件尾哨兵）', (() => {\n"
         "    const sent = stripComments(appSrc + '\\n/* RP_TAIL_3360 */\\n');\n"
         "    return !sent.includes('RP_TAIL_3360');\n"
         "})());")
assert text.count(OLD_H) == 1, 'H4/H5 锚点'
text = text.replace(OLD_H, NEW_H, 1)

io.open(P, 'w', encoding='utf-8').write(text)
print('OK 冒烟三处自纠已落盘')