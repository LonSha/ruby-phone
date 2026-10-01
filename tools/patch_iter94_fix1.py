#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_iter94_fix1.py — 修 v3.36.0 条目的**版本锚形态词**。

现场：抬版收干后全链首跑 2 红（tests/system-v3171.test.mjs:231 与
tests/system-v3201.test.mjs:407，两条都是「当版条目须如实记录本版自己抓到的缺陷（形态锚）」）。
定性：**不是产品缺陷**，是本版条目第 8 条的措辞没对齐形态词 —— 旧套件认的是
「自己抓到的缺陷 / 本版自己抓到 / 缺陷形态」三者之一，本版写的是「起手就抓到的真缺陷」。

修法：把第 8 条标题里的「起手就抓到的真缺陷」改成「本版自己抓到的真缺陷」（对齐形态词），
四处**同时**改（条目真源 + update-log + index.js 公告块 + ITERATION_LOG 段），
逐处断言锚点恰中 1 次 —— 不留两版、不静默通过。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = '【起手就抓到的真缺陷 · 三处（两处由门禁当场报红，一处由套件首轮报红）】'
NEW = '【本版自己抓到的真缺陷 · 三处（两处由门禁当场报红，一处由套件首轮报红）】'
WRITE = '--write' in sys.argv


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


targets = ['tools/iter94_items.json', 'update-log.json', 'index.js', 'ITERATION_LOG.md']
drafts = {}
for rel in targets:
    drafts[rel] = once(rd(rel), OLD, NEW, rel)
    assert drafts[rel].count(NEW) == 1, rel + ' 新词必须恰 1 次'
    assert OLD not in drafts[rel], rel + ' 旧词必须绝迹'
src = json.loads(drafts['tools/iter94_items.json'])
assert src['version'] == '3.36.0' and len(src['items']) == 19, '条目真源结构变了'
assert re.search('自己抓到的缺陷|本版自己抓到|缺陷形态', '\n'.join(src['items'])), '改完仍须命中形态锚'
idx = drafts['index.js']
for it in src['items']:
    assert json.dumps(it, ensure_ascii=False) in idx, '公告块与真源不同源：' + it[:20]
print('== 四处锚点自证通过 ==')
for rel in targets:
    print('  OK  %s' % rel)
if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)
for rel in targets:
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(drafts[rel])
print('OK 已落盘 4 处')