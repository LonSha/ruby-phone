# -*- coding: utf-8 -*-
"""[v3.34.0] 修 phone.css 的一处粘连：date.css 尾行没有换行符，
`cat >>` 把老福特样式段的头一行**粘在了 `.dat-debt-when` 那一行后面**（语法上仍合法，
但一段样式被吃进上一行、且注释头藏在行尾 —— 门禁的「段头可辨认」会读不到）。

修法：把那处粘连拆成两行，并把段头改成规范的独立注释行。
"""
import sys

PATH = 'phone.css'
GLUED = "/* [v3.34.0] 老福特 App（.lof-*） */"
FIXED = ("\n/* ---------- [v3.34.0] 老福特 App（.lof-*） ---------- */\n"
         "/* 缝合自 Perigee js/lofter.js。四处不缝：不直连模型 / 不落 Dexie 与不写 chat.history /\n"
         "   不共用别的 App 的粉丝池 / 不存图也不收外链。样式投递走机制 A（打包进本文件）。 */")

with open(PATH, encoding='utf-8') as f:
    text = f.read()
if GLUED not in text:
    print('FAIL: 段头未找到')
    sys.exit(1)
n = text.count(GLUED)
print('段头命中 %d 次' % n)
text = text.replace(GLUED, FIXED, 1)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(text)
print('OK phone.css 粘连已拆、段头已规范')