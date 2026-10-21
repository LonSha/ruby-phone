#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync_css_v4460.py — 把 apps/memory/memory.css 的 v4.46.0 段逐字回灌进 phone.css。

为什么要有这个脚本：
    phone.css 里的本版样式段必须与 apps/memory/memory.css **逐字同源**。
    本版只改了源文件、没回灌 phone.css ⇒ 打包环境里 `.mem-sr-*` 全部裸奔
    （实测：phone.css 中 `mem-sr` 的 3 次命中全是 `.mem-src-go` 的子串误命中，
    真正的 SR 样式类一个都没进去）—— 界面在打包环境下长得和源码环境不一样，
    且**不报错**（本仓最贵的形态）。手工改两处必然会再犯，故做成幂等脚本：
    源文件永远是唯一真源，phone.css 只是它的投影。

取段口径：段头 = 含 `[v4.46.0 · R5-X6]` 的那一行注释；段尾 = 文件尾
    （本版段就是 memory.css 的最后一节）。若将来在它之后又接了新段，
    必须改成「按下一个段头截断」，否则会把新段并进来造成假红。

用法：
    python3 tools/sync_css_v4460.py            # 只报差异（dry-run）
    python3 tools/sync_css_v4460.py --write    # 落盘
"""
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHONE = os.path.join(ROOT, "phone.css")
SRC = os.path.join(ROOT, "apps", "memory", "memory.css")
MARK = "[v4.46.0 \u00b7 R5-X6]"


def section_of(text):
    lines = text.split("\n")
    start = None
    for i, ln in enumerate(lines):
        if MARK in ln:
            start = i
            break
    if start is None:
        return None
    return "\n".join(lines[start:]).strip()


def main():
    write = "--write" in sys.argv[1:]
    with open(PHONE, encoding="utf-8") as fh:
        css = fh.read()
    with open(SRC, encoding="utf-8") as fh:
        seg = section_of(fh.read())
    if seg is None:
        print("源文件里找不到段头 " + MARK)
        return 1
    idx = css.find(MARK)
    if idx < 0:
        print("phone.css 里没有本版段头 —— 将追加。")
        new = css.rstrip("\n") + "\n" + seg + "\n"
    else:
        head = css.rfind("\n", 0, idx)
        head = 0 if head < 0 else head + 1
        cur = css[head:].strip()
        if cur == seg:
            print("OK 已同源，无需改动。")
            return 0
        print("差异：phone.css 段 " + str(len(cur)) + " 字 / 源段 " + str(len(seg)) + " 字")
        new = css[:head] + seg + "\n"
    if not write:
        print("（dry-run，未落盘；加 --write 落盘）")
        return 0
    with open(PHONE, "w", encoding="utf-8") as fh:
        fh.write(new)
    print("OK phone.css 本版段已与 apps/memory/memory.css 逐字同源。")
    return 0


if __name__ == "__main__":
    sys.exit(main())