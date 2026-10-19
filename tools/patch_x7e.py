#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x7e.py — v4.29.0 收口补丁 E：边界文档补当版来由段。

为什么要单独补这一段：
  tools/refresh_doc_readings.py 的来由段只在 --why=<值>（等号形式）下写入；
  本次收口误用了空格形式 --why "..."，flag() 取不到值 ⇒ note 段未落笔。
  而该工具在「数字已一致 + 复校标记在场」时直接 return 0，不会再写 note ——
  所以补写必须由本补丁显式完成，不能指望重跑刷新器。

与历史同形：v4.28.0 / v4.26.0 的两行下方都带着当版来由段（现场跑门、不手抄 +
当版边界一句话），本版照此补齐，不新增第三种写法。

锚点恰中 1 次；只插一行，不改任何既有行（历史复校行是留档）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = 'docs/runtime-verification-boundary.md'
NL = chr(10)
WRITE = '--write' in sys.argv

ANCHOR = '- \u5bfc\u5165 474 \u6587\u4ef6 834 \u6761' + NL

NOTE = (
    '\uff08**v4.29.0 \u590d\u6821**\uff1av4.29.0 \u65b0\u589e '
    'config/group-vote-contract.js\uff08\u7fa4\u804a\u6295\u7968\u7eaf\u5951\u7ea6\u4ef6\uff09+ '
    'apps/wechat/group-vote.js\uff08\u63a5\u7ebf\u4ef6\uff09+ '
    'tests/system-v4290.test.mjs\uff08\u5224\u636e\u5957\u4ef6\uff09\uff1bwechat \u4e09\u4ef6\u65b0\u589e'
    '\u4e09\u4e2a\u6d88\u606f\u7c7b\u522b case\u3001\u5341\u4e2a\u51fa\u53e3\u4e0e\u7fa4\u6295\u7968\u5361\u3002'
    '\u2605 \u672c\u4e24\u884c\u7531 `tools/refresh_doc_readings.py` \u73b0\u573a\u8dd1\u4e24\u9053\u95e8\u540e\u5199\u5165\uff0c'
    '\u4e0d\u624b\u6284\uff1b\u8be5\u5de5\u5177\u5e72\u8dd1\u6a21\u5f0f\u5728\u53d1\u73b0\u6f02\u79fb\u65f6\u8fd4\u56de 1\uff0c\u53ef\u76f4\u63a5\u6302\u8fdb CI\u3002'
    '\u2605 \u8fb9\u754c\uff1a\u672c\u4ef6\u662f**\u4e0b\u6e38\u81ea\u5efa**'
    '\uff08\u4e0a\u6e38\u5916\u4f9b\u9762\u8868\u5341\u56db\u9762\u91cc\u6ca1\u6709\u4efb\u4f55\u6295\u7968 / \u8f6e\u8be2 / \u8ba1\u7968\u9762\uff0c'
    'grep vote / poll / ballot \u96f6\u547d\u4e2d\uff09\uff0c\u6545\u4e0d\u7acb\u8de8\u4ed3\u767b\u8bb0\u884c\uff1b'
    '\u771f\u5b9c\u4e3b\u91cc\u786e\u8ba4\u4e8b\u4ef6 phone:groupVoteConfirm \u7684**\u6700\u7ec8\u843d\u70b9\u672a\u8dd1**'
    '\u2014\u2014 \u672c\u5361\u53ea\u6d3e\u53d1\u51ed\u636e\u3001\u7ea6\u5b9a\u843d\u7b14\u5728\u65e5\u5386 owner\uff0c\u5f85\u5b9e\u673a\u590d\u6838\u3002\uff09'
    + NL
)


def main():
    p = os.path.join(ROOT, DOC)
    with io.open(p, encoding='utf-8') as f:
        doc = f.read()
    n = doc.count(ANCHOR)
    assert n == 1, '[E] anchor must hit exactly 1, got %d' % n
    assert 'v4.29.0 \u590d\u6821' in doc, '[E] head recert mark missing'
    assert NOTE.strip() not in doc, '[E] note already present (idempotent refusal)'
    new = doc.replace(ANCHOR, ANCHOR + NOTE, 1)
    assert len(new.split(NL)) == len(doc.split(NL)) + 1, '[E] must add exactly one line'
    for keep in ('v3.63.0 \u590d\u6821', 'v4.28.0 \u590d\u6821', 'v4.26.0 \u590d\u6821'):
        assert keep in new, '[E] history line must survive: %s' % keep
    assert new.count('v4.29.0 \u590d\u6821') == doc.count('v4.29.0 \u590d\u6821') + 1
    if not WRITE:
        print('[E] dry run: 1 line would be inserted after the import readings line')
        print('[E] note = %d chars' % len(NOTE))
        return 0
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(new)
    print('[E] written: v4.29.0 note inserted (%d chars)' % len(NOTE))
    return 0


if __name__ == '__main__':
    sys.exit(main())
