#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v4310.py — 抬 v4.31.0(五源同源,单版)。
范式沿用 tools/bump_v4300.py(同仓唯一抬版口径,不另立第二份)。
本版做的是第五期 R5-O4 生理状态交接的事件级幂等 ——
交接账本升级为「事实账 + 事件账」同住一个持久化键(ruby_health_handoff,不新增键、
不造第二份真源),两者各自裁剪、互不挤占(entries 50 / events 50);
新增事件身份 eventKeyOf(宿主可证身份优先,给不出则回落内容指纹并如实标 identified:false,
空值身份 msg:undefined / msg:null / msg:NaN 不当身份用,身份里刻意不含 swipe);
processReply 加应用前幂等闸 + 事实粒度 settled/held 双清单;
配套修 applyFacts 的 apply-error 分支(此前只保留 type,键对不上会把失败的那条误记成已处置);
health-app.js 的 MESSAGE_RECEIVED 钩子向下传 { eventKey: msg 拼 messageId, source: chat }。
新增判据 tests/system-v4310.test.mjs(89 项,含四组定点破坏负控制),
新增 tools/iter190_seg.md(本版迭代段)。
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
    ('4.31.0', '2026-11-16', '4.30.0', 'tools/iter190_seg.md', 190),
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
    def _has(pat):
        return any(re.search(pat, it) for it in items)
    assert _has('版本升至'), 'missing closing: 版本升至 X(五源同源)'
    assert _has('自己抓到的缺陷|本版自己抓到|缺陷形态'), 'missing flaw-form anchor'
    assert _has('交棒改写|主动改写|下限形'), 'missing handoff anchor'
    assert _has('运行时验证边界'), 'missing runtime-boundary item'
    assert any(it.startswith(chr(0x3010) + '版本升至') for it in items), \
        'iter seg must carry the closing item'
    return seg, items
def rebuild_block(ij, items, date):
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
META_ANCHOR = '- **\u5f53\u524d\u7248\u672c**\uff1a`%s`'
TAG = '\u4e2a\u7248\u672c\uff0c\u6309\u7248\u672c\u53f7\u7d22\u5f15'
DOC_PAT = '\uff08v2.82.0 \u8d77\uff1b**v%s \u590d\u6821**\uff09'
def step(ver, date, prev, seg_path, iter_no, state):
    seg, items = parse_items(seg_path)
    print('--- %s <- %s | items %d | iter %d ---' % (ver, prev, len(items), iter_no))
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
    man = json.loads(state['man'])
    pkg = json.loads(state['pkg'])
    assert man['version'] == prev and pkg['version'] == prev
    man['version'] = ver
    pkg['version'] = ver
    state['man'] = json.dumps(man, ensure_ascii=False, indent=2) + NL
    state['pkg'] = json.dumps(pkg, ensure_ascii=False, indent=2) + NL
    ij = state['idx']
    ij = once(ij, "const ST_PHONE_VERSION = '%s';" % prev,
              "const ST_PHONE_VERSION = '%s';" % ver, 'ST_PHONE_VERSION')
    ij = rebuild_block(ij, items, date)
    _miss = [it[:40] for it in items if json.dumps(it, ensure_ascii=False) not in ij]
    assert not _miss, 'index.js 应公告块缺条目: ' + '; '.join(_miss)
    assert ('版本升至 ' + ver) in ij, 'index.js must expose the closing item'
    state['idx'] = ij
    il = state['il']
    il = once(il, META_ANCHOR % prev, META_ANCHOR % ver, 'meta version line')
    m = re.search(r'(\d+) ' + re.escape(TAG), il)
    assert m, 'version-count sentence must hit exactly 1'
    print('  头部版本数:%s -> %d' % (m.group(1), len(new_versions)))
    il = il[:m.start(1)] + str(len(new_versions)) + il[m.end(1):]
    il = seg + NL + NL + il
    assert il.count('## 迭代 %d ' % iter_no) == 1
    state['il'] = il
    doc = state['doc']
    pat = DOC_PAT % prev
    assert doc.count(pat) == 1, doc.count(pat)
    doc = doc.replace(pat, DOC_PAT % ver, 1)
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
