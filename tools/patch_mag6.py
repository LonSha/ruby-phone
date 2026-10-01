#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag6.py — [v3.36.0] 第三轮：修判据侧 2 处（I7 崩栈 / d6 锚点落在注释里）。

  J11 I7 判据**崩在 TypeError** 上：去掉 export 后 `mod.MAGAZINE_TIME_UNITS` 是
      `undefined`，而判据紧接着 `mod.MAGAZINE_TIME_UNITS.includes(...)` ⇒ 抛异常。
      报红的原因不是判据响，是判据自己没做前置守卫。修法：先 `Array.isArray` 判定，
      不成立就记一条并**提前返回**（后面的断言都依赖这张表）。
  J12 d6 锚点带注释：破坏锚点写成 `'question',   // Q&A 里的提问行…` —— 那一行**含注释**，
      而 J2 的「锚点必须落在代码里」自证（`stripComments(src).includes(from)`）会失败。
      修法：破坏改成**在解析器里产出一个表外块**（`push('question', …)` →
      `push('questionx', …)`）—— 纯代码行、唯一、且与「表脱节」同义（都让产出块出白名单）。
"""
import io
import sys

T = 'tests/system-v3360.test.mjs'
E = []

E.append((
    "    /* ⑦ 时间单位表必须是**导出**的常量（视图要拿它建计算键） */\n"
    "    if (!Array.isArray(mod.MAGAZINE_TIME_UNITS)) bad.push('time-units-missing');\n"
    "    /* ⑧ 时间读数产出必须落在单位表内 */\n"
    "    const f = mod.timeAgoFace(Date.now() - 5 * 60000, Date.now());\n"
    "    if (!mod.MAGAZINE_TIME_UNITS.includes(f.unit)) bad.push('time-unit-stray');",
    "    /* ⑦ 时间单位表必须是**导出**的常量（视图要拿它建计算键）。\n"
    "     *   ★ 先做守卫再往下：去掉 export 后这一格是 undefined，若直接 `.includes`\n"
    "     *     会抛 TypeError —— 那报红的原因就不是判据响、而是判据自己崩了。 */\n"
    "    if (!Array.isArray(mod.MAGAZINE_TIME_UNITS)) {\n"
    "        bad.push('time-units-missing');\n"
    "        return bad;\n"
    "    }\n"
    "    /* ⑧ 时间读数产出必须落在单位表内 */\n"
    "    const f = mod.timeAgoFace(Date.now() - 5 * 60000, Date.now());\n"
    "    if (!mod.MAGAZINE_TIME_UNITS.includes(f.unit)) bad.push('time-unit-stray');",
    'J11 I7 判据加前置守卫'))

E.append((
    "    /* ⑥ 白名单与解析器**脱节**（表里把 question 写错名 ⇒ 产出块不在白名单内）。\n"
    "     *   ★ 为什么不破坏「校验那一行」：产品从不产白名单外的块 ⇒ 摘掉校验与不摘掉\n"
    "     *     **行为完全相同**（不可观测的破坏 = 装饰破坏）。要让判据有判别力，\n"
    "     *     必须破坏**表本身**（真源），判据才看得见。 */\n"
    "    d6: [MG_DATA,\n"
    "        \"    'question',   // Q&A 里的提问行（源按 ―― / —— 行首分流）\",\n"
    "        \"    'question_typo',   // Q&A 里的提问行（源按 ―― / —— 行首分流）\"],",
    "    /* ⑥ 让解析器**产出一个表外块**（`question` → `questionx`）。\n"
    "     *   ★ 为什么不破坏「校验那一行」：产品从不产白名单外的块 ⇒ 摘掉校验与不摘掉\n"
    "     *     **行为完全相同**（不可观测的破坏 = 装饰破坏）。要让判据有判别力，\n"
    "     *     必须让**产出**越过白名单，判据才看得见。\n"
    "     *   ★ 为什么不改表本身：表里的每一行都带行尾注释 ⇒ 锚点会落在注释里，\n"
    "     *     而 J2 的自证要求「锚点必须落在代码里」（`stripComments` 会把注释剥掉）。 */\n"
    "    d6: [MG_DATA,\n"
    "        \"            push('question', { text: trimmed });\",\n"
    "        \"            push('questionx', { text: trimmed });\"],",
    'J12 d6 改成让解析器产表外块'))


def main(write):
    text = io.open(T, encoding='utf-8').read()
    bad = 0
    for old, new, label in E:
        n = text.count(old)
        if n != 1:
            print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
            bad += 1
            continue
        text = text.replace(old, new, 1)
        print('OK   %s' % label)
    if bad:
        print('失配 %d 处' % bad)
        sys.exit(1)
    if write:
        io.open(T, 'w', encoding='utf-8').write(text)
        print('已落盘')
    else:
        print('（dry-run，未落盘）')


main('--write' in sys.argv)