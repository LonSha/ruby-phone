#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv12.py — 修 v3.35.0 首轮自红暴露的**第 5 处产品真缺陷**（编排层）+ 一处派生面下界。

真缺陷⑩：`pixivPromptBlock` 为 chapter / novel 两模式都算了 `purityRule`
（`PIXIV_PURITY_RULE` 常量，源 2026 补的硬规则：**指令语言 ≠ 正文语言**），
但 `copyPrompt` 折文本时**从不读它** ⇒ 数据算了、零消费点 ⇒ 用户复制的日语模式
要求文本里没有这条规则 ⇒ 中文指令会被原样搬进日语正文（正是那条规则要挡的塌陷）。
与老福特 `buildArticleFromBlock` 组了评论数组却不喂规范器是同一形态。

顺带把 `deriveChapterHearts` 的章号下界对齐到 0：0 与 1 会算出**同一个散列步长**，
两章读数恒同 —— 与 A12「逐章心数不许同值」的纪律相冲（章号 0 合法之后才暴露）。
"""
import sys

PX_DATA = 'apps/pixiv/pixiv-data.js'
PX_APP = 'apps/pixiv/pixiv-app.js'

EDITS = []

# ───── ⑩ copyPrompt：chapter 模式把纯度规则折进文本 ─────
EDITS.append((PX_APP,
    "            if (b.language === 'jp-cn') lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');\n"
    "            if (b.userDirection) lines.push('另外：' + b.userDirection);\n"
    "        } else if (b.mode === 'comment') {",
    "            if (b.language === 'jp-cn') {\n"
    "                lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');\n"
    "                // ★ 纯度规则**必须真进文本**：数据层算了却没人读 = 这条硬规则等于不存在，\n"
    "                //   用户复制的日语要求里没有它，中文指令会被原样搬进日语正文。\n"
    "                if (b.purityRule) lines.push('纯度：' + b.purityRule);\n"
    "            }\n"
    "            if (b.userDirection) lines.push('另外：' + b.userDirection);\n"
    "        } else if (b.mode === 'comment') {"))

# ───── ⑩ copyPrompt：novel 模式同样 ─────
EDITS.append((PX_APP,
    "            if (b.minWords) lines.push('至少 ' + b.minWords + ' 字。');\n"
    "            if (b.language === 'jp-cn') lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');\n"
    "            if (b.userDirection) lines.push('另外：' + b.userDirection);",
    "            if (b.minWords) lines.push('至少 ' + b.minWords + ' 字。');\n"
    "            if (b.language === 'jp-cn') {\n"
    "                lines.push('语言：日文正文 + 每 3〜5 段给一次中文译文折叠块。');\n"
    "                if (b.purityRule) lines.push('纯度：' + b.purityRule);\n"
    "            }\n"
    "            if (b.userDirection) lines.push('另外：' + b.userDirection);"))

# ───── 派生面：章号下界对齐到 0（0 与 1 不许算出同一个读数） ─────
EDITS.append((PX_DATA,
    '    const n = num === null ? 1 : Math.max(1, Math.trunc(num));\n'
    '    const step = ((n * 7) % 51) / 100;   // 0.00〜0.50，按章号散开',
    '    // ★ 下界 0：章号 0 合法（序章），若按 1 夹，0 与 1 会算出**同一个散列步长**、\n'
    '    //   两章读数恒同 —— 与「逐章心数不许同值」相冲。\n'
    '    const n = num === null ? 1 : Math.max(0, Math.trunc(num));\n'
    '    const step = ((n * 7) % 51) / 100;   // 0.00〜0.50，按章号散开'))

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
print('OK patch_pixiv12 全部落地')