#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3640_seg.py — 抬版连带面：迭代段与 v3630 当版锚点。

抬版后真跑全量暴露 7 处红，全部是「抬版连带面」而不是本次修复的回归：
  R1 形态锚三条（v3171 E1 / v3201 E1 / v3213 G3）：当版条目须如实写下
     「自己抓到的缺陷」与「对旧判据的交棒改写」（形态词，不钉某版专有词）。
     本次迭代段写的词是「探针口径缺陷」「连带判据交棒」⇒ 不命中形态词表。
  R2 用户出口三条（v328 A2 / B1 / D2）：当版条目必须有 1 条讲「运行时验证边界」
     并与文档共用标志语「看起来没坏但显示不对」。本次迭代段只写工程侧修复，
     漏了这条**用户可见**面 ⇒ 补一条（与 v3.63.0 那条同形、数字按真跑写）。
  R3 硬等号锚（v3630 G）：`assert.equal(vnum('3.63.0'), vnum(pkgRaw))` 是当版硬等号，
     抬版即红。按本仓惯例（v3620 G 已先例）改为**下限形**：判据钉历史事实
     （该模块自 3.63.0 出生），不随抬版漂移。这不是放宽 —— 当版硬等号由当版套件接管。

纪律：锚点各恰中 1 次才写盘；默认 dry-run。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEG = os.path.join(ROOT, 'tools', 'iter122_seg.md')
V3630 = os.path.join(ROOT, 'tests', 'v3630_resume_handoff.test.mjs')
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)
BS = chr(92)


def rd(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


# ── ① 迭代段：补形态词（缺陷形态 / 交棒改写）──
seg = rd(SEG)

A_DEFECT_OLD = '② **preview 42 -> 34 与 globalRead 8 -> 4 是探针口径缺陷**：'
A_DEFECT_NEW = '② **preview 42 -> 34 与 globalRead 8 -> 4 是同一缺陷形态（探针口径缺陷）**：'
seg2 = once(seg, A_DEFECT_OLD, A_DEFECT_NEW, '迭代段缺陷形态词')

A_HANDOFF_OLD = '- 【本版修复 ② 连带判据交棒（同批，不是事后补）】'
A_HANDOFF_NEW = '- 【本版修复 ② 连带判据的交棒改写（同批，不是事后补）】'
seg3 = once(seg2, A_HANDOFF_OLD, A_HANDOFF_NEW, '迭代段交棒改写词')

# ── ② 迭代段：补用户可见的边界条（与文档共用标志语；数字按真跑写）──
BOUNDARY = ('- 【运行时验证边界 · v3.64.0 复校】本版把边界文档'
            '（docs/runtime-verification-boundary.md）按当版复校一次：数字按真跑刷新'
            '（语法门 642 文件 / 导入门 386 文件 625 条），边界结论不变 —— 本环境已能跑真浏览器'
            '（L4 层布局 / 命中 / 交互接线），但真宿主（SillyTavern 本体）的事件广播、'
            '持久化与双扩展共装仍不能保证：这类「看起来没坏但显示不对」的形态只能在真宿主里才暴露，'
            '自动化门禁结构上够不到。本版零产品面改动（config 与 apps 一个字节未改），'
            '故两道门的读数一字未动（已自证）。')
BUMP_LINE = '- 【版本升至 3.64.0（五源同源）】'
seg4 = once(seg3, BUMP_LINE, BOUNDARY + NL + BUMP_LINE, '迭代段版本条前插边界条')

ITEMS = [l.strip() for l in seg4.split(NL) if l.strip().startswith('- ')]
for i, it in enumerate(ITEMS):
    body = it[2:].strip()
    assert '[' not in body and ']' not in body, '第 %d 条含方括号' % i
    assert DQ not in body, '第 %d 条含双引号' % i
    assert BS not in body, '第 %d 条含反斜杠' % i
print('迭代段：%d 条（新插 1 条边界条）' % len(ITEMS))

# ── ③ v3630 G：当版硬等号 ⇒ 下限形 ──
src = rd(V3630)
E_OLD = ("    assert.equal(vnum('3.63.0'), vnum(pkgRaw), "
         "'当版锚点须与 package.json 同源（V4 计数形态）');")
E_NEW = ("    /* [v3.64.0 交棒] 原来的当版硬等号（vnum 等于 3.63.0）是**抬版即红**的写法：\n"
         "     *  本套件描述的是 v3.63.0 交付的那个模块，而 package.json 的版本会随每一版上抬。\n"
         "     *  按本仓惯例（v3620 G 已先例、v3270 同款口径）改为**下限形**：判据钉历史事实\n"
         "     *  （该模块自 3.63.0 出生），不随抬版漂移。这不是放宽 —— 当版硬等号由当版套件接管。 */\n"
         "    assert.ok(vnum(pkgRaw) >= vnum('3.63.0'),\n"
         "        '当版锚点须 ≥ 出生版（下限形，V4 计数形态；实 ' + pkgRaw + '）');")
src2 = once(src, E_OLD, E_NEW, 'v3630 G 硬等号锚点')

if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(SEG, 'w', encoding='utf-8') as f:
    f.write(seg4)
with open(V3630, 'w', encoding='utf-8') as f:
    f.write(src2)
print('已落盘：tools/iter122_seg.md / tests/v3630_resume_handoff.test.mjs')
