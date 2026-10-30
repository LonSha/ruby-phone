#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抬 v4.99.5（五源同源，单版）—— R11-X5：全局检索接出落地，Spotlight 跨域搜索从「内核写好了没人用」变成搜索 App 里可读、可跳、三态不同形的一格产品面。
范式逐条沿用 tools/bump_v4994.py（once 断言锚点恰中 1 次、parse_items 断言四类标志语、
rebuild_block 重建公告块、五源同改、默认 dry-run）。本版只换 STEPS 与头注，逻辑一字未改 ——
改逻辑等于让「五源同源」这件事有两份实现。
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
    ('4.99.5', '2026-10-30', '4.99.4', 'tools/iter229_seg.md', 229),
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
        # 方括号禁则**必须保留**：当版切片判据按「公告块里第一个 `]`」截头部，
        #   items 里一旦出现 `]` 头部就被提前截断、后半读不到 ⇒ 假红。
        assert '[' not in it and ']' not in it, it[:24]
        items.append(it)
    assert len(items) >= 8, len(items)

    def _has(pat):
        return any(re.search(pat, it) for it in items)
    assert _has('版本升至'), 'missing closing: 版本升至 X(五源同源)'
    assert _has('自己抓到的缺陷|本版自己抓到|缺陷形态'), 'missing flaw-form anchor'
    assert _has('交棒改写|主动改写|下限形|不做：'), 'missing handoff anchor'
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


META_ANCHOR = '- **当前版本**：`%s`（五源同源）'
TAG = '个版本，按版本号索引'
DOC_PAT = '（v2.82.0 起；**v%s 复校**）'


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
    assert not _miss, 'index.js 公告块缺条目: ' + '; '.join(_miss)
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
    # 状态账本（五源之一）：version 与 version_sources 四处必须同改。
    led = json.loads(state['led'])
    assert led['version'] == prev, led['version']
    assert led['version_same'] is True
    for k, v in led['version_sources'].items():
        assert v == prev, (k, v)
    led['version'] = ver
    for k in led['version_sources']:
        led['version_sources'][k] = ver
    state['led'] = json.dumps(led, ensure_ascii=False, indent=2) + NL


def main():
    state = {
        'ul': rd('update-log.json'),
        'man': rd('manifest.json'),
        'pkg': rd('package.json'),
        'idx': rd('index.js'),
        'il': rd('ITERATION_LOG.md'),
        'doc': rd('docs/runtime-verification-boundary.md'),
        'led': rd('tests/audit/status-ledger.json'),
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
    wr('tests/audit/status-ledger.json', state['led'])
    print('--- WRITTEN --- final version = ' + STEPS[-1][0])
    return 0


if __name__ == '__main__':
    sys.exit(main())