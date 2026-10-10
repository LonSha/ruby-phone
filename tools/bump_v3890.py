#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v3890.py — 抬 v3.89.0（五源同源，单版）。

范式抄自 tools/bump_v3880.py（同仓唯一抬版口径，不另立第二份）：
  ① update-log.json：新键插首位 + latest / head 同置（indent=2 重建）；
  ② manifest.json / package.json 的 version；
  ③ index.js 的 ST_PHONE_VERSION 常量 + ST_PHONE_CURRENT_UPDATE 公告块（公告块 = 当版条目）；
  ④ ITERATION_LOG.md：头部插迭代段 + 元信息「当前版本」行 + 版本数由真源重算；
  ⑤ docs/runtime-verification-boundary.md：当版复校标记（数字由取数臂另跑，不手抄）。

纪律：只写上面五处；先算 draft、逐份断言；默认 dry-run，--write 才落盘。
本版（v3.89.0）是拓展计划 R-X5 的落地版：新模块 config/workflow.js 与 config/workflow-runtime.js，
以及 apps/workflow 三层 / 咽喉唯一 owner 口与执行入口 / 诊断协议面三处接线，配套判据 tests/system-v3890.test.mjs。
本版新增一个存储键 wf_runs（会话数据域），已登记进 scripts/keys-audit.mjs；
边界文档两行由 tools/refresh_doc_readings.py 现场跑两道门写回。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)
BS = chr(92)

# (ver, date, prev, seg_file, iter_no)
STEPS = [
    ('3.89.0', '2026-10-12', '3.88.0', 'tools/iter146_seg.md', 146),
]


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


def parse_items(seg_path):
    seg = rd(seg_path).rstrip(NL)
    assert BS not in seg, 'iter seg must not contain backslash'
    assert '[' not in seg and ']' not in seg, 'iter seg must not contain brackets'
    items = []
    for line in seg.split(NL):
        line = line.strip()
        if not line.startswith('- '):
            continue
        it = line[2:].strip()
        if it.startswith('**'):
            it = it[2:]
        if it.endswith('**'):
            it = it[:-2]
        it = it.strip()
        assert it.startswith(chr(0x3010)), it[:24]
        assert chr(0x3011) in it, it[:24]
        assert NL not in it and DQ not in it and BS not in it, it[:24]
        assert '[' not in it and ']' not in it, it[:24]
        items.append(it)
    assert len(items) >= 8, len(items)
    return seg, items


def rebuild_block(ij, items, date):
    """把 ST_PHONE_CURRENT_UPDATE 的 items 换成当版 items（公告块 = 当版条目）。"""
    START = 'const ST_PHONE_CURRENT_UPDATE = {'
    bi = ij.index(START)
    bj = ij.index(NL + '};', bi)
    old = ij[bi:bj]
    assert len(old) > 0
    head = (START + NL + '    version: ST_PHONE_VERSION,' + NL
            + '    date: ' + DQ + date + DQ + ',' + NL + '    items: [')
    new_lines = [head]
    for idx, it in enumerate(items):
        comma = ',' if idx < len(items) - 1 else ''
        new_lines.append('        ' + json.dumps(it, ensure_ascii=False) + comma)
    new_lines.append('    ]')
    return ij[:bi] + NL.join(new_lines) + ij[bj:]


def step(ver, date, prev, seg_path, iter_no, state):
    seg, items = parse_items(seg_path)
    print('--- %s <- %s | items %d | iter %d ---' % (ver, prev, len(items), iter_no))

    # 1) update-log.json
    ul = json.loads(state['ul'])
    assert ul['latest'] == prev, ul['latest']
    assert ul['head'] == prev, ul['head']
    assert list(ul['versions'])[0] == prev
    assert ver not in ul['versions']
    old_n = len(ul['versions'])
    new_versions = {ver: {'version': ver, 'date': date, 'items': items}}
    for k, v in ul['versions'].items():
        new_versions[k] = v
    ul = {'latest': ver, 'versions': new_versions, 'head': ver}
    assert list(ul['versions'])[0] == ver and len(new_versions) == old_n + 1
    state['ul'] = json.dumps(ul, ensure_ascii=False, indent=2) + NL

    # 2) manifest / package
    man = json.loads(state['man'])
    pkg = json.loads(state['pkg'])
    assert man['version'] == prev and pkg['version'] == prev
    man['version'] = ver
    pkg['version'] = ver
    state['man'] = json.dumps(man, ensure_ascii=False, indent=2) + NL
    state['pkg'] = json.dumps(pkg, ensure_ascii=False, indent=2) + NL

    # 3) index.js 版本常量 + 公告块
    ij = state['idx']
    ij = once(ij, "const ST_PHONE_VERSION = '%s';" % prev,
              "const ST_PHONE_VERSION = '%s';" % ver, 'ST_PHONE_VERSION')
    ij = rebuild_block(ij, items, date)
    for it in items:
        assert json.dumps(it, ensure_ascii=False) in ij
    state['idx'] = ij

    # 4) ITERATION_LOG.md
    il = state['il']
    il = once(il, '- **当前版本**：`%s`' % prev, '- **当前版本**：`%s`' % ver, 'meta version line')
    TAG = '个版本，按版本号索引'
    m = re.search(r'(\d+) ' + re.escape(TAG), il)
    assert m, 'version-count sentence must hit exactly 1'
    print('  头部版本数：%s -> %d' % (m.group(1), len(new_versions)))
    il = il[:m.start(1)] + str(len(new_versions)) + il[m.end(1):]
    il = seg + NL + NL + il
    assert il.count('## 迭代 %d ' % iter_no) == 1
    state['il'] = il

    # 5) 边界文档复校标记（数字归取数臂另跑）
    doc = state['doc']
    pat = '（v2.82.0 起；**v' + prev + ' 复校**）'
    assert doc.count(pat) == 1, doc.count(pat)
    doc = doc.replace(pat, '（v2.82.0 起；**v' + ver + ' 复校**）', 1)
    state['doc'] = doc
    assert ('**v' + ver + ' 复校**') in state['doc']


def main():
    state = {
        'ul': rd('update-log.json'),
        'man': rd('manifest.json'),
        'pkg': rd('package.json'),
        'idx': rd('index.js'),
        'il': rd('ITERATION_LOG.md'),
        'doc': rd('docs/runtime-verification-boundary.md'),
    }
    for ver, date, prev, seg, no in STEPS:
        step(ver, date, prev, seg, no, state)

    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        print('final version = ' + STEPS[-1][0])
        return 0

    wr('update-log.json', state['ul'])
    wr('manifest.json', state['man'])
    wr('package.json', state['pkg'])
    wr('index.js', state['idx'])
    wr('ITERATION_LOG.md', state['il'])
    wr('docs/runtime-verification-boundary.md', state['doc'])
    print('--- WRITTEN --- final version = ' + STEPS[-1][0])
    return 0


if __name__ == '__main__':
    sys.exit(main())
