#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3430_p4.py — 第四发：judge 近邻切片用错基底 + q16 替换体残留原串

【一】第三发把 viewClimbProblems 的顺序判据下沉到「点击处理段」时，
      近邻检查那句沿用了 `code.slice(...)`（整文件基底），而 iCard 现在是
      **段内相对下标** ⇒ 取到的是无关位置，真源码上就报 card-climb-lost
      （J5「真模块上判据必须干净」当场红，I21/I23 的对照断言也红）。
      修法：近邻检查改用 `seg.slice(...)`。

【二】q16 的替换体末尾仍写了原样那一行（`this._receipt('ingest', false, ...)`），
      于是 `damaged.split(from)` 仍能命中 ⇒ J2「替换后不许残留原串」红。
      修法：替换体把回执的 detail 多加一个字段（语义不变：仍是「记一条失败回执」，
      但原串不再完整出现）。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = '\n'
Q = "'"
CUR = {}
COUNT = [0]


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(rel, old, new, tag):
    if rel not in CUR:
        CUR[rel] = rd(rel)
    n = CUR[rel].count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d：%r' % (tag, n, old[:90])
    CUR[rel] = CUR[rel].replace(old, new, 1)
    COUNT[0] += 1
    print('  %-32s %s' % (tag, rel))


T = 'tests/system-v3430.test.mjs'
print('== 第四发清单 ==')

once(T,
     '    if (iCard > 0) {' + NL
     + '        const near = code.slice(Math.max(0, iCard - 70), iCard + 40);' + NL
     + "        if (near.indexOf('climb(') < 0) bad.push('card-climb-lost');" + NL
     + '    }',
     '    if (iCard > 0) {' + NL
     + '        /* \u2605 \u57fa\u5e95\u5fc5\u987b\u662f**\u6bb5\u5185**\uff1aiCard \u662f seg \u7684\u76f8\u5bf9\u4e0b\u6807\uff0c' + NL
     + '         *   \u62ff code \u53d6\u8fd1\u90bb\u4f1a\u62ff\u5230\u65e0\u5173\u4f4d\u7f6e\uff08\u771f\u6e90\u7801\u4e0a\u5c31\u4f1a\u8bef\u62a5\uff09\u3002 */' + NL
     + '        const near = seg.slice(Math.max(0, iCard - 70), iCard + 40);' + NL
     + "        if (near.indexOf('climb(') < 0) bad.push('card-climb-lost');" + NL
     + '    }',
     'test.viewClimb.near-base')

once(T,
     "        \"            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });\"," + NL
     + "        '            this._brief = ' + Q + Q + ';' + NL + '            this._recompute();' + NL" + NL
     + "        + \"            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });\"],",
     "        \"            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });\"," + NL
     + "        '            this._brief = ' + Q + Q + ';' + NL + '            this._face = FACE_EMPTY;' + NL" + NL
     + "        + '            this._recompute();' + NL" + NL
     + "        + \"            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0, wiped: true });\"],",
     'DAMAGE.q16.no-resid')

print('== 共 %d 处 ==' % COUNT[0])
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)

for rel, body in CUR.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(body)
    print('  写 %s' % rel)
print('已落盘 %d 个文件。' % len(CUR))