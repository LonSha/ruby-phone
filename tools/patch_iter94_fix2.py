#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_iter94_fix2.py — 更正 v3.36.0 第 19 条的**全链读数**并如实留档首跑 2 红。

现场：抬版收干后补跑全链，首跑 2 红（版本锚形态词，见 patch_iter94_fix1.py）。
第 19 条原写的读数是**抬版前预估**（1978 tests / 语法 532 文件），实测是
**2003 tests / 语法 534 文件**（边界文档两行契约行也是 534 文件 / 311 文件 487 条）。
本仓纪律：条目里不写当时不存在的读数 —— 一律改成实测值，并把首跑 2 红如实写进去。

改法（五处，逐处断言锚点恰中 1 次）：
  ① tools/iter94_items.json（条目真源，整条换文）
  ② update-log.json（同源）
  ③ index.js（入口公告块，同源）
  ④ 重跑 tools/gen_iter94_seg.py 由真源**重生成** tools/iter94_seg.md（段不许手改）
  ⑤ ITERATION_LOG.md：把 `## 迭代 94 — ` 到 `## 迭代 93 — ` 之间的**整段**换成新段
     （不按子串替换 —— 段是生成物，整段替换才不留两版）
"""
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

OLD_TITLE = '【全链读数 · 抬版收干后补跑】'
NEW_TITLE = '【全链读数 · 抬版收干后补跑（首跑 2 红已收干）】'
OLD_BODY = ('抬版收干后补跑全链：**1978 tests / 1978 pass / 0 fail**，'
            '十道静态门同步 **10/10 全绿**（语法 532 文件 / 导入 311 文件 487 条 / 键归属 216 个使用点 / '
            '零消费导出无新增 / 生命周期 53 个 App 类 66 槽位 / 注册三方对账 58 / 派生台账 / '
            '弱口径唯一实现被 38 文件引用 / 上游面一致 / 桥契约十四面）。')
NEW_BODY = ('抬版收干后补跑全链，**首跑 2 红**：两条都是**版本锚的形态锚**'
            '（`tests/system-v3171.test.mjs` 与 `tests/system-v3201.test.mjs` 的'
            '「当版条目须如实记录本版自己抓到的缺陷」）—— 定性**不是产品缺陷**，是本版第 8 条标题写'
            '「起手就抓到的真缺陷」、**措辞没对齐形态词**（旧套件认的是「自己抓到的缺陷 / 本版自己抓到 / '
            '缺陷形态」三者之一）；修法是标题改成「本版自己抓到的真缺陷」并**四处同改**'
            '（条目真源 / update-log / 入口公告块 / ITERATION_LOG 段），逐处断言锚点恰中 1 次、'
            '改完交叉自证旧词绝迹。收干后全链 **2003 tests / 2003 pass / 0 fail**，'
            '十道静态门同步 **10/10 全绿**（语法 534 文件 / 导入 311 文件 487 条 / 键归属 216 个使用点 / '
            '零消费导出无新增 / 生命周期 53 个 App 类 66 槽位 / 注册三方对账 58 / 派生台账 / '
            '弱口径唯一实现被 38 文件引用 / 上游面一致 / 桥契约十四面）。')
assert '[' not in NEW_TITLE + NEW_BODY and ']' not in NEW_TITLE + NEW_BODY, '新串不得含方括号'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


targets = ['tools/iter94_items.json', 'update-log.json', 'index.js']
drafts = {}
for rel in targets:
    drafts[rel] = once(rd(rel), OLD_TITLE + OLD_BODY, NEW_TITLE + NEW_BODY, rel)
    assert '1978 tests' not in drafts[rel], rel + ' 旧读数必须绝迹'
    assert '2003 tests' in drafts[rel] and '首跑 2 红' in drafts[rel], rel + ' 新读数与留档必须在场'
src = json.loads(drafts['tools/iter94_items.json'])
assert src['version'] == '3.36.0' and len(src['items']) == 19, '条目真源结构变了'
idx = drafts['index.js']
for it in src['items']:
    assert json.dumps(it, ensure_ascii=False) in idx, '公告块与真源不同源：' + it[:20]

seg_rel = 'tools/iter94_seg.md'
if not WRITE:
    print('== 三处条目源自证通过（dry-run：不重生成段、不落盘）==')
    for rel in targets:
        print('  OK  %s' % rel)
    sys.exit(0)

for rel in targets:
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(drafts[rel])
subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools/gen_iter94_seg.py')], cwd=ROOT)
seg = rd(seg_rel)
assert '1978 tests' not in seg and '2003 tests' in seg, '重生成的段里读数不对'
assert seg.lstrip().startswith('## 迭代 94 — '), '段头形态不对'

log_rel = 'ITERATION_LOG.md'
log = rd(log_rel)
A = '## 迭代 94 — '
B = '## 迭代 93 — '
assert log.count(A) == 1 and log.count(B) == 1, '段头锚点各须恰中 1 次'
i, j = log.index(A), log.index(B)
assert i < j, '迭代 94 段必须在迭代 93 段之前'
new_log = log[:i] + seg.rstrip('\n') + '\n\n' + log[j:]
assert new_log.count(A) == 1 and new_log.count(B) == 1
assert '1978 tests' not in new_log, 'ITERATION_LOG 旧读数必须绝迹'
assert '2003 tests' in new_log and '首跑 2 红' in new_log, 'ITERATION_LOG 新读数必须在场'
with io.open(os.path.join(ROOT, log_rel), 'w', encoding='utf-8') as f:
    f.write(new_log)
print('== 五处自证通过 ==')
for rel in targets + [seg_rel, log_rel]:
    print('  OK  %s' % rel)
print('OK 已落盘 5 处')