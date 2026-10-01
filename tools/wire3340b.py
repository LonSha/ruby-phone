# -*- coding: utf-8 -*-
"""[v3.34.0] 补 index.js 重绑表槽位名（上一步锚点第二行漏了 22 空格缩进，未命中 —— 已修）。"""
import sys

PATH = 'index.js'
OLD = "                      //             换会话必须丢草稿重取，必须进表\n];"
NEW = ("                      //             换会话必须丢草稿重取，必须进表\n"
       "    'lofterApp'       // [v3.34.0] 老福特：有未提交草稿（短文批量 / 续章正文 / 评论框 / 三处作者与文风格）、\n"
       "                      //             选中面与展开项（_article / _collection / _myFace / _promptFor / _replyTo\n"
       "                      //             皆为视图态），换会话必须丢草稿重取，必须进表\n"
       "];")

with open(PATH, encoding='utf-8') as f:
    text = f.read()
n = text.count(OLD)
if n != 1:
    print('FAIL: 锚点命中 %d 次' % n)
    sys.exit(1)
text = text.replace(OLD, NEW, 1)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(text)
print('OK index.js 重绑表（lofterApp 已进表）')
