#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_pv1.py — 把 pvdesk-data.js 里的转义序列与注释反引号清成拼装形。

本仓纪律：被审代码里不许出现**反斜杠**与**反引号**（剥注释器是字符状态机，
不解析正则字面量，遇到裸引号/反斜杠会把正则正文当字符串起头）。
本脚本逐条「锚点必须恰中 N 次」替换；默认 dry-run，--write 才落盘。
"""
import io
import sys

PATH = 'apps/pvdesk/pvdesk-data.js'
WRITE = '--write' in sys.argv

BS = chr(92)
BT = chr(96)

# （锚点, 替换, 期望次数）—— 锚点里的 \t / \n / \r 是**两个字符**（反斜杠 + 字母）
EDITS = [
    ("    return ch === ' ' || ch === '" + BS + "t';",
     "    return ch === ' ' || ch === CHAR_TAB;", 1),
    ("        const lines = raw.split('" + BS + "n');",
     "        const lines = raw.split(CHAR_NL);", 1),
    ("        raw = clean(kept.join('" + BS + "n'));",
     "        raw = clean(kept.join(CHAR_NL));", 1),
    ("    const text = lines.join('" + BS + "n');",
     "    const text = lines.join(CHAR_NL);", 1),
    ("    return { text: base + (base ? '" + BS + "n' : '') + '画风：' + pick.anchor, applied: true, filled: pick.filled };",
     "    return { text: base + (base ? CHAR_NL : '') + '画风：' + pick.anchor, applied: true, filled: pick.filled };", 1),
    ("    const raw = str.split('" + BS + "n');",
     "    const raw = str.split(CHAR_NL);", 2),
    ("        const line = raw[i].split('" + BS + "r').join('');",
     "        const line = raw[i].split(CHAR_CR).join('');", 2),
    ("    const lines = src.split('" + BS + "n');",
     "    const lines = src.split(CHAR_NL);", 1),
    ("        if (at2 <= 0) { out.brief = out.brief ? out.brief + '" + BS + "n' + line : line; continue; }",
     "        if (at2 <= 0) { out.brief = out.brief ? out.brief + CHAR_NL + line : line; continue; }", 1),
    ("        out.brief = out.brief ? out.brief + '" + BS + "n' + line : line;",
     "        out.brief = out.brief ? out.brief + CHAR_NL + line : line;", 1),
    # 常量声明：插在工具区开头（strOf 之前）
    ("/* ---------- 工具 ---------- */\nfunction strOf(v) {",
     "/* ---------- 拼装形字符（本仓纪律：源码里不许出现反斜杠转义） ---------- */\n"
     "const CHAR_TAB = String.fromCharCode(9);\n"
     "const CHAR_NL = String.fromCharCode(10);\n"
     "const CHAR_CR = String.fromCharCode(13);\n\n"
     "/* ---------- 工具 ---------- */\nfunction strOf(v) {", 1),
    # 注释里的反引号（两条）
    (" *  ★ 源在这里用 " + BT + "_PV_ART_STYLES[k] || ''" + BT + " 一把兜底 ⇒ 「没给」与「给了但认不出」",
     " *  ★ 源在这里用 _PV_ART_STYLES[k] 或空串一把兜底 ⇒ 「没给」与「给了但认不出」", 1),
]


def main():
    with io.open(PATH, encoding='utf-8') as f:
        src = f.read()
    out = src
    for i, (old, new, want) in enumerate(EDITS):
        got = out.count(old)
        assert got == want, '第 %d 条锚点期望 %d 次，实得 %d' % (i + 1, want, got)
        out = out.replace(old, new)
    print('编辑 %d 条全部命中' % len(EDITS))
    print('反斜杠 %d -> %d' % (src.count(BS), out.count(BS)))
    print('反引号 %d -> %d' % (src.count(BT), out.count(BT)))
    if WRITE:
        with io.open(PATH, 'w', encoding='utf-8') as f:
            f.write(out)
        print('已落盘')
    else:
        print('dry-run（加 --write 才落盘）')


if __name__ == '__main__':
    main()