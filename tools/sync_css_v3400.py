#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# sync_css_v3400.py — 把 apps/kettle/kettle.css 的正文逐字回灌进 phone.css 的本版段。
#
# 为什么要有这个脚本：
#     phone.css 里的本版样式段必须与 apps/kettle/kettle.css **逐字同源**
#     （tests/system-v3400.test.mjs 的 C4 判据守着这条）。本仓已在 v3.37.0 踩过一次：
#     只改了源文件、没回灌 phone.css，于是同源判据转红。手工改两处必然会再犯，
#     因此把「回灌」做成幂等脚本：源文件永远是唯一真源，phone.css 只是它的投影。
#
# 与 sync_css_v3390.py 的差别（只一处）：
#     本件是**首次插入**（当前最前的段头是 v3.39.0，本版段还没有），因此保留首插分支；
#     段头已在场时行为与 v3390 版完全一致（原地替换）。
#     段序约定：**最新版在最前**，因此首插位置是当前最前的那个段头之前，不是文件尾。
#
# 用法：
#     python3 tools/sync_css_v3400.py            # 只报差异（dry-run）
#     python3 tools/sync_css_v3400.py --write    # 落盘

import sys
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHONE = os.path.join(ROOT, "phone.css")
SRC = os.path.join(ROOT, "apps", "kettle", "kettle.css")

MARK = "[v3.40.0] 对话水壶"
SEP = "\u2550" * 14  # 与仓内其它段头同形


def build_head():
    return "/* " + SEP + " " + MARK + "（kettle） " + SEP + " */"


def find_insert_at(css):
    # 段序上最新版在最前，故新段插在「当前最前的那个段头」之前；找不到段头则插到文件尾。
    hits = [m.start() for m in re.finditer(re.escape("/* " + SEP), css)]
    if not hits:
        return None
    return css.rfind("\n", 0, hits[0]) + 1


def main():
    write = "--write" in sys.argv[1:]
    with open(PHONE, encoding="utf-8") as fh:
        css = fh.read()
    with open(SRC, encoding="utf-8") as fh:
        seg = fh.read().strip()
    idx = css.find(MARK)
    if idx < 0:
        at = find_insert_at(css)
        new_seg = build_head() + "\n" + seg + "\n\n"
        if at is None:
            new_css = css.rstrip("\n") + "\n\n" + new_seg
        else:
            new_css = css[:at] + new_seg + css[at:]
        print("INSERT 首插段长 " + str(len(new_seg)))
        if not write:
            print("（dry-run，未落盘；加 --write 生效）")
            return 0
        with open(PHONE, "w", encoding="utf-8") as fh:
            fh.write(new_css)
        with open(PHONE, encoding="utf-8") as fh:
            back = fh.read()
        ok = seg in back
        print("WROTE phone.css；自证（源正文逐字在场）：" + ("OK" if ok else "FAIL"))
        return 0 if ok else 1
    # 段已在场：原地替换
    head_comment = css.rfind("/*", 0, idx)
    start = css.rfind("\n", 0, head_comment) + 1
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
    with open(PHONE, encoding="utf-8") as fh:
        back = fh.read()
    ok = seg in back
    print("WROTE phone.css；自证（源正文逐字在场）：" + ("OK" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
