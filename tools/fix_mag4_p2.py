#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_mag4_p2.py — 重写 patch_mag4.py 里的 P2 两条编辑（类前加常量 + _fileName 用常量）。

首版把 `export class MagazineApp {` 塞进了 `_fileName` 的替换块里 —— 那个类头在
构造函数之前、`_fileName` 在类内，两处位置不同，一条替换写不完。拆成两条。
"""
import io

P = 'tools/patch_mag4.py'
t = io.open(P, encoding='utf-8').read()

start = t.index("# ══════════ P2 双引号（App 层）══════════")
end = t.index("# ══════════ P3 TITLE 尾部星号 ══════════")

NEW = '''# ══════════ P2 双引号（App 层）══════════
APP = 'apps/magazine/magazine-app.js'
# ② 类前加两个常量（插在 `export class MagazineApp {` 之前）
E.append((APP,
    "export class MagazineApp {",
    "/** ★ 双引号同样用拼装形（见数据层 `BT` 的注释）—— 裸双引号会让剥注释器在\\n"
    " *  `'...'` 之外卡住（本仓纪律：代码里不许出现会骗过状态机的裸引号）。 */\\n"
    "const DQ = String.fromCharCode(34);\\n"
    "const BAD_FILE_CHARS = new RegExp('[\\\\\\\\/:*?' + DQ + '<>|]', 'g');\\n"
    "\\n"
    "export class MagazineApp {",
    'P2a 类前加 DQ / BAD_FILE_CHARS'))
# ③ _fileName 里的字面量正则改用常量
E.append((APP,
    "        const s = String(base || 'article').slice(0, 30).replace(/[\\\\\\\\/:*?\\"<>|]/g, '_');",
    "        const s = String(base || 'article').slice(0, 30).replace(BAD_FILE_CHARS, '_');",
    'P2b _fileName 用常量'))

'''
t = t[:start] + NEW + t[end:]
io.open(P, 'w', encoding='utf-8').write(t)
print('OK 已重写 P2 段')