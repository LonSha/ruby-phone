# -*- coding: utf-8 -*-
"""v3.80.0 接线修正 R2：config/injection-priority.js 的局部 `num()` 撞 weak-coercion W2b。
口径：族名（num/floor/finite 前缀）且体内含 `Number(` 的函数必须是**强形态或纯转发**。
修法：删掉局部弱口径，改由 config/num-gate.js 的唯一实现转发。"""
import io, os, sys

R = '/home/user/ruby-phone'
os.chdir(R)

PLAN = [
    ('config/injection-priority.js',
     " * ============================================================ */\n\n"
     "/** 分类：块的语义优先级（数字越小越优先）。未命中的一律落 `ambient`（最后让位）。 */\n",
     " * ============================================================ */\n\n"
     "import { numOrNull } from './num-gate.js';\n\n"
     "/** 分类：块的语义优先级（数字越小越优先）。未命中的一律落 `ambient`（最后让位）。 */\n",
     'R2d import num-gate'),
    ('config/injection-priority.js',
     "function num(v, fallback = 0) {\n"
     "    const n = Number(v);\n"
     "    return Number.isFinite(n) && n >= 0 ? n : fallback;\n"
     "}\n",
     "/* 数值门：**转发**全仓唯一实现 `num-gate.numOrNull`，不在这里自己写一份。\n"
     " *  为什么必须转发而不是内联一个 `Number(v)`：本仓 weak-coercion 门（W2b）明令\n"
     " *  「族名（num/floor/finite 前缀）且体内含 Number( 的函数，必须是强形态或纯转发」——\n"
     " *  自己写一份就会把「没给」读成 0，与「给了 0」塌成同形（本仓最贵的那类错读数）。\n"
     " *  函数名刻意**不**用族名：它不是门，只是把 numOrNull 的 null 语义补一个默认值。 */\n"
     "function nonNeg(v, fallback = 0) {\n"
     "    const n = numOrNull(v);\n"
     "    return (n === null || n < 0) ? fallback : n;\n"
     "}\n",
     'R2a strong gate'),
    ('config/injection-priority.js',
     "    const wanted = textOf(block).length || num(block && block.chars, 0);\n"
     "    const left = num(budget, 0);\n",
     "    const wanted = textOf(block).length || nonNeg(block && block.chars, 0);\n"
     "    const left = nonNeg(budget, 0);\n",
     'R2b call sites 1'),
    ('config/injection-priority.js',
     "    const budget = num(options.budgetChars, 0);\n",
     "    const budget = nonNeg(options.budgetChars, 0);\n",
     'R2c call sites 2'),
]


def main():
    for rel, anchor, new, label in PLAN:
        src = io.open(rel, encoding='utf-8').read()
        n = src.count(anchor)
        if n != 1:
            print('ABORT [%s] %s: 锚点命中 %d 次' % (rel, label, n))
            return 1
        io.open(rel, 'w', encoding='utf-8').write(src.replace(anchor, new, 1))
        print('ok [%s] %s' % (rel, label))
    return 0


sys.exit(main())