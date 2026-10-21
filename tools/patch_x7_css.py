#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x7_css.py - [v4.47.0 / R5-X7] 假设试写区样式（源文件是唯一真源）。

只写一侧（源文件或 phone.css）=> 界面在打包环境里长得和源码环境不一样，
而且不报错（本仓最贵的形态）。故源文件先落，再由 tools/sync_css_v4470.py
幂等回灌 phone.css（与 v4.46.0 的 sync_css_v4460.py 同范式）。

本支另修一处既有缺口：视图用 cwb-btn-on 标「已选中」，而全仓没有这个类
（实测两侧样式 grep -c cwb-btn-on 都是 0）—— 选中与未选中在屏上同形。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
SRC = 'apps/creationdesk/creationdesk.css'
MARK = '/* ========== [v4.47.0 \u00b7 R5-X7] \u5047\u8bbe\u573a\u666f\u53cc\u680f\u8bd5\u5199 ========== */'
BLOCK = MARK + NL + """/* 为什么这几条要长得跟普通表单行不一样：它承载的是「预演」这个状态 ——
 * 两栏并列、基线共起点、试写文本可丢弃。屏上必须让用户一眼看出
 * 「这还不是既成结局」；否则「先试试看」会被读成「已经这么定了」。
 * 态在屏上不许同形：还没写 / 已有文本 / 这一栏不合格 三种处置相反。 */
.cwb-hy { border-color: #dfe6ef; background: #fbfcfe; }
.cwb-hy-line { color: #3c4a58; }
.cwb-hy-lane {
    margin-top: 8px;
    padding: 7px 9px;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #cfd8e3;
    border-radius: 7px;
    background: #fff;
}
.cwb-hy-lane-on { border-left-color: #4a5a6a; background: #f5f8fa; }
.cwb-hy-head { display: flex; align-items: baseline; gap: 8px; }
.cwb-hy-name { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: #3c4a58; }
.cwb-hy-state { font-size: 10px; color: #9a948a; }
.cwb-hy-st-pending { color: #9a948a; }
.cwb-hy-st-written { color: #4a7a4a; font-weight: 600; }
.cwb-hy-st-refused { color: #a0553f; font-weight: 600; }
.cwb-hy-row { color: #6a645c; }
.cwb-hy-cmp { color: #33586a; }
/* 选中态按钮：既有缺口（视图用了这个类，两侧样式都没定义）。 */
.cwb-btn-on { border-color: #4a5a6a; background: #eef2f5; color: #2f3d4a; font-weight: 600; }
"""


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


src = rd(SRC)
if MARK in src:
    print('SKIP: creationdesk.css 已有该块')
else:
    if not src.endswith(NL):
        src += NL
    if WRITE:
        wr(SRC, src + BLOCK)
    print('OK: creationdesk.css 追加 %d 字节（源面）' % len(BLOCK))

src2 = rd(SRC)
print('mark in src     :', MARK in src2)
for cls in ['.cwb-hy-lane', '.cwb-hy-st-pending', '.cwb-hy-st-written', '.cwb-hy-st-refused', '.cwb-btn-on']:
    print('%-20s src=%s' % (cls, cls in src2))