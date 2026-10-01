#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync_css_v3370.py — 把 apps/soundkit/soundkit.css 的正文逐字回灌进 phone.css 的本版段。

为什么要有这个脚本：
    phone.css 里的本版样式段必须与 apps/soundkit/soundkit.css **逐字同源**
    （tests/system-v3370.test.mjs 的 C3 判据守着这条）。上一版为修 C5（四类面板落点）
    只改了源文件、没回灌 phone.css，于是 C3 转红。手工改两处必然会再犯，
    因此把「回灌」做成幂等脚本：源文件永远是唯一真源，phone.css 只是它的投影。

用法：
    python3 tools/sync_css_v3370.py            # 只报差异（dry-run）
    python3 tools/sync_css_v3370.py --write    # 落盘
"""

import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHONE = os.path.join(ROOT, "phone.css")
SRC = os.path.join(ROOT, "apps", "soundkit", "soundkit.css")

MARK = "[v3.37.0] 白盒音效盒"
SEP = "\u2550" * 14  # 与仓内其它段头同形


def build_head():
    return "/* " + SEP + " " + MARK + "（soundkit） " + SEP + " */"


def main():
    write = "--write" in sys.argv[1:]

    with open(PHONE, encoding="utf-8") as fh:
        css = fh.read()
    with open(SRC, encoding="utf-8") as fh:
        seg = fh.read().strip()

    idx = css.find(MARK)
    if idx < 0:
        print("FAIL 段头不在场：" + MARK)
        return 1

    # 段起点：段头注释行的行首（段头必须独立成行）
    head_comment = css.rfind("/*", 0, idx)
    start = css.rfind("\n", 0, head_comment) + 1

    # 段终点：下一个段头行（形如 \n/* ═...）之前的换行
    nxt = css.find("\n/* " + SEP, idx)
    if nxt < 0:
        print("FAIL 找不到本版段的下一个段头（段尾无法界定）")
        return 1

    old = css[start:nxt + 1]
    new = build_head() + "\n" + seg + "\n"

    if old == new:
        print("OK 已同源（无需改动），段长 " + str(len(new)))
        return 0

    print("DIFF 段长 " + str(len(old)) + " -> " + str(len(new)))

    if not write:
        print("（dry-run，未落盘；加 --write 生效）")
        return 0

    with open(PHONE, "w", encoding="utf-8") as fh:
        fh.write(css[:start] + new + css[nxt + 1:])

    # 落盘后自证：源文件正文必须能在 phone.css 里逐字找到
    with open(PHONE, encoding="utf-8") as fh:
        back = fh.read()
    ok = seg in back
    print("WROTE phone.css；自证（源正文逐字在场）：" + ("OK" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
