#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把上一轮「简化抬版脚本」的产物回退到标准范式可接受的基线。

为什么需要这一步：仓内唯一抬版范式是 tools/bump_v3790.py 那一份
（update-log 以 indent=2 重建 / 公告块与当版条目逐条同源 / 迭代日志插段 + 版本数重算）。
上一轮用了临时脚本（tools/bump_v3800.py），它只写了一条 3000+ 字的公告，
既撞了 G8「当版条目数下限 4」，又把 update-log 全文件缩进由 2 改成 4（6455 行无意义 diff）。

本脚本只做回退，不改语义：把五源退到「3.79.0 当版」的状态，
再由标准范式脚本一次抬齐。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
NL = chr(10)
PREV = '3.80.0'
DROP = '3.81.0'


def rd(rel):
    with io.open(rel, encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(rel, 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    # 1. update-log.json：删掉 DROP 条目，latest/head 退回 PREV，按 indent=2 重建
    ul = json.loads(rd('update-log.json'))
    if DROP in ul['versions']:
        del ul['versions'][DROP]
        print('update-log: 已删除 %s 条目' % DROP)
    assert PREV in ul['versions'], PREV
    ul['latest'] = PREV
    ul['head'] = PREV
    wr('update-log.json', json.dumps(ul, ensure_ascii=False, indent=2) + NL)
    print('update-log: latest/head -> %s · 版本数 %d' % (PREV, len(ul['versions'])))

    # 2. manifest / package：version 退回 PREV
    for rel in ('manifest.json', 'package.json'):
        obj = json.loads(rd(rel))
        obj['version'] = PREV
        wr(rel, json.dumps(obj, ensure_ascii=False, indent=2) + NL)
        print('%s: version -> %s' % (rel, PREV))

    # 3. index.js：版本常量退回 PREV（公告块由标准脚本整体重建，此处不动）
    ij = rd('index.js')
    old = "const ST_PHONE_VERSION = '" + DROP + "';"
    new = "const ST_PHONE_VERSION = '" + PREV + "';"
    assert ij.count(old) == 1, ij.count(old)
    wr('index.js', ij.replace(old, new, 1))
    print('index.js: ST_PHONE_VERSION -> %s' % PREV)

    # 4. ITERATION_LOG.md：抹掉 137 段（若在）、元信息版本行退回、版本数退回真实值
    il = rd('ITERATION_LOG.md')
    m = re.search('## 迭代 138 — v3' + re.escape('.81.0') + '.*?' + NL + '## 迭代 ', il, re.S)
    if m:
        il = il[:m.start()] + il[m.end() - len('## 迭代 '):]
        print('ITERATION_LOG: 已移除 137 段')
    il = il.replace('- **当前版本**：`' + DROP + '`', '- **当前版本**：`' + PREV + '`')
    TAG = '个版本，按版本号索引'
    mm = re.search('(\\d+) ' + re.escape(TAG), il)
    assert mm, '版本数句子必须恰中 1 次'
    il = il[:mm.start(1)] + str(len(ul['versions'])) + il[mm.end(1):]
    wr('ITERATION_LOG.md', il)
    print('ITERATION_LOG: 当前版本 %s · 版本数 %d' % (PREV, len(ul['versions'])))

    # 5. 边界文档复校标记退回 PREV
    doc = rd('docs/runtime-verification-boundary.md')
    pat = '**v' + DROP + ' 复校**'
    if pat in doc:
        doc = doc.replace(pat, '**v' + PREV + ' 复校**')
        wr('docs/runtime-verification-boundary.md', doc)
        print('boundary: 复校标记 -> %s' % PREV)
    else:
        print('boundary: 标记已是 %s（未动）' % PREV)
    print('--- 回退完成，可跑标准抬版 ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
