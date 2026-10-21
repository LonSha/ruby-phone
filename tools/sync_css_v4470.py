#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync_css_v4470.py - 把 apps/creationdesk/creationdesk.css 的 v4.47.0 段投递进 phone.css。

为什么要有这个脚本（沿用 v4.46.0 的 sync_css_v4460.py 口径）：
    phone.css 里的本版样式段必须与源文件**逐字同源**。只改源文件不回灌 =>
    打包环境里 .cwb-hy-* 全部裸奔（界面长得和源码环境不一样，且不报错）。
    手工改两处必然会再犯，故做成幂等脚本：源文件永远是唯一真源，
    phone.css 只是它的投影。

★ 取段口径与 v4.46.0 **不同**，这里写清为什么：
    memory.css 是「单 App 一面」的文件，v4.46.0 的段是它最后一节，
    故可用「段头 -> 文件尾」。而 **creationdesk 段在 phone.css 里不是最后一节**
    （其后还接着 workflow 等段，实测 phone.css:20393 起）。若照抄「段头 -> 文件尾」，
    回灌会把后面那些段**整段删掉** —— 那正是本脚本要防的那类静默破坏。
    故本版改成**按块插入**：从源文件取「本版段头 -> 源文件尾」这一块，
    插到 phone.css 里 creationdesk 段末行的**后面**（锚点 = 该段末行，须恰中 1 次）。
    ★ 若将来 creationdesk.css 在本版块之后又接了新段，取块口径必须改成
      「按下一个段头截断」，否则会把新段并进来造成假红。

用法：
    python3 tools/sync_css_v4470.py            # 只报差异（dry-run）
    python3 tools/sync_css_v4470.py --write    # 落盘
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHONE = os.path.join(ROOT, 'phone.css')
SRC = os.path.join(ROOT, 'apps', 'creationdesk', 'creationdesk.css')
MARK = '[v4.47.0 \u00b7 R5-X7]'
ANCHOR = '.cwb-st-ok { color: #4a7a4a; }'


def section_of(text):
    lines = text.split('\n')
    start = None
    for i, ln in enumerate(lines):
        if MARK in ln:
            start = i
            break
    if start is None:
        return None
    return '\n'.join(lines[start:]).strip()


def main():
    write = '--write' in sys.argv[1:]
    with io.open(PHONE, encoding='utf-8') as fh:
        css = fh.read()
    with io.open(SRC, encoding='utf-8') as fh:
        seg = section_of(fh.read())
    if seg is None:
        print('源文件里找不到段头 ' + MARK)
        return 1
    if MARK in css:
        # 判「是否已同源」必须与**插入口径同源**（都锚在段末行），不许另写一套边界。
        #   首版这里用 css.find('\n/*', head) 找块尾，结果命中了块**内部**的第一行注释
        #   （本版块自己就含「为什么这几条…」那行），于是第二次跑报「差异 54 字 / 源段 1084 字」
        #   —— 幂等性自己坏了。这正是本仓那条纪律：两套边界必然漂移。
        #   现在统一用「段末行 → 下一个 App 段头」取块。
        a = css.find(ANCHOR)
        if a < 0:
            print('phone.css 里找不到段末行锚点：%s' % ANCHOR)
            return 1
        b = css.find('\n/* \u2550', a)
        b = len(css) if b < 0 else b
        cur = css[(a + len(ANCHOR)):b].strip()
        if cur == seg:
            print('OK 已同源，无需改动。')
            return 0
        print('差异：phone.css 段 %d 字 / 源段 %d 字' % (len(cur), len(seg)))
        new = css[:(a + len(ANCHOR))] + '\n' + seg + css[b:]
    else:
        n = css.count(ANCHOR)
        if n != 1:
            print('锚点必须恰中 1 次，实测 %d 次：%s' % (n, ANCHOR))
            return 1
        print('phone.css 里没有本版段头 —— 将在 creationdesk 段末行之后插入。')
        new = css.replace(ANCHOR, ANCHOR + '\n' + seg, 1)
    if not write:
        print('（dry-run，未落盘；加 --write 落盘）')
        return 0
    with io.open(PHONE, 'w', encoding='utf-8') as fh:
        fh.write(new)
    print('OK phone.css 本版段已与 apps/creationdesk/creationdesk.css 逐字同源。')
    return 0


if __name__ == '__main__':
    sys.exit(main())