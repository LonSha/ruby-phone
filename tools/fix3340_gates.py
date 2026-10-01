# -*- coding: utf-8 -*-
"""[v3.34.0] 抬版连带面：三条红的定位与修法。

① C1（tests/system-v328.test.mjs）/ ② E2（tests/system-v3201.test.mjs）：
   边界文档的**机器可读契约行**（`- 语法 N 文件` / `- 导入 N 文件 N 条`）是两条历史套件
   真跑比对的锚点，抬版后必须与现场实测一致（语法门 517 / 导入门 305 文件 477 条）。
   注：文档末尾的「v3.34.0 复校段」不受这两条判据约束（它们只认「v<N> 复校」在场 + 那两行），
   但**两行契约行**必须刷新 —— 这是本仓「文档写了实测就必须与真跑一致」的固定流水线一环。
③ H4（tests/system-v3310.test.mjs）：本套件里**引用了别人的类名前缀字面量**
   （拿上一版那处「样式段头行尾粘连」当类比写进注释与断言消息）⇒ 该前缀的「全仓唯一」判据
   当场报越界。这不是产品越界，是**判据不引用别人的字面量**这条纪律的又一处兑现：
   改成不带头缀的措辞（把类比说清楚，但一个字符都不借用）。
"""
import io
import sys

DOC = 'docs/runtime-verification-boundary.md'
TESTS = 'tests/system-v3340.test.mjs'

EDITS = [
    (DOC, '- 语法 512 文件', '- 语法 517 文件', '文档契约行：语法门文件数'),
    (DOC, '- 导入 302 文件 472 条', '- 导入 305 文件 477 条', '文档契约行：导入面读数'),

    (TESTS,
     '//        `.dat-debt-when` 那一行尾（语法上仍合法，样式却挂错选择器）—— 由 D5 钉住；',
     '//        上一段末尾那一行尾（语法上仍合法，样式却挂错选择器）—— 由 D5 钉住；',
     '套件注释：不借用别人的类名前缀字面量'),

    (TESTS,
     """    assert.equal(css[idx - 1], '\\n', '段头必须独立成行（起手是 `.dat-debt-when` 行尾粘连，语法合法但样式挂错选择器）');""",
     """    assert.equal(css[idx - 1], '\\n', '段头必须独立成行（起手是上一段末行行尾粘连，语法合法但样式挂错选择器）');""",
     '套件断言消息：同上'),
]


def edit(path, old, new, label):
    text = io.open(path, encoding='utf-8').read()
    n = text.count(old)
    if n != 1:
        print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
        sys.exit(1)
    io.open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
    print('OK   %s' % label)


for path, old, new, label in EDITS:
    edit(path, old, new, label)
print('全部完成')