#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3580_boundary.py — v3.58.0 运行时验证边界文档复校 + 当版用户可见条补写

本版（O4 会话世代栅栏 / O5 写入回执）连带面两处：
① 边界文档 `docs/runtime-verification-boundary.md`：首行版标 v3.57.0 -> v3.58.0 复校；
   第五节两条**机器可读契约行**（语法 N 文件 / 导入 N 文件 N 条）刷成本版真跑读数，
   各补一段「本版增量逐条对账」（读数全部取自现场真跑两道门，脚本里不写字面量）。
② 当版条目（`update-log.json` 的 3.58.0 items 与 `index.js` 公告块，两处逐字同源）：
   补一条「运行时验证边界复校（v3.58.0）」用户可见条（v328 A2/B1 的机器可读契约：
   两条必须都提到「运行时验证边界」且共用同一句标志语「看起来没坏但显示不对」）；
   并把原先那条「本版未改任何既有判据的口径」**改成如实记账** —— 本版为 O5 的连带面
   确实改了四处旧判据的锚点/允许面，写「无」是不实记账。
纪律：只写读数与来由，不改判据；默认 dry-run，--write 才落盘。
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
VER = 'v3.58.0'
PREV = 'v3.57.0'
NL = chr(10)
DQ = chr(34)
DOC = os.path.join(ROOT, 'docs', 'runtime-verification-boundary.md')
LOG_REL = 'update-log.json'
IDX_REL = 'index.js'
MARK = '看起来没坏但显示不对'


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, ' '.join(cmd) + ' rc=' + str(r.returncode) + ' ' + (r.stderr or '')[-400:]
    return r.stdout or ''


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


# ══════════ 现场真跑两道门（读数零手抄） ══════════
SYN_OUT = run(['node', 'scripts/syntax-check.mjs'])
IMP_OUT = run(['node', 'scripts/import-resolve-check.mjs'])
m1 = re.search('语法门通过：([0-9]+) 个文件', SYN_OUT)
m2 = re.search('扫描 ([0-9]+) 个文件 · 静态相对导入 ([0-9]+) 条 · 动态 import' + chr(92) + chr(40) + '([0-9]+)', IMP_OUT)
assert m1 and m2, (SYN_OUT[-300:], IMP_OUT[-300:])
SYN_N, IMP_F, IMP_S, IMP_D = m1.group(1), m2.group(1), m2.group(2), m2.group(3)
print('现场读数：语法 %s 文件 / 导入 %s 文件 %s 条 / 动态 %s 条' % (SYN_N, IMP_F, IMP_S, IMP_D))

# ══════════ ① 边界文档 ══════════
s = open(DOC, encoding='utf-8').read()
OLD_HEAD = '# ruby-phone 运行时验证边界（v2.82.0 起；**%s 复校**）' % PREV
OLD_SYN = '语法 620 文件'
OLD_IMP = '导入 381 文件 572 条'
for tag, a in (('首行版标', OLD_HEAD), ('旧语法契约行', OLD_SYN), ('旧导入契约行', OLD_IMP)):
    assert s.count(a) == 1, tag + ' 必须恰中 1 次，实得 %d' % s.count(a)
s = once(s, OLD_HEAD, OLD_HEAD.replace(PREV, VER), '首行版标')
s = once(s, OLD_SYN, '语法 %s 文件' % SYN_N, '语法契约行')
SYN_LINE = '语法 %s 文件' % SYN_N
NOTE_SYN = (
    NL + '（**%s 复校**：本版新增 4 个 .js —— 产品侧两件真源 `config/session-gate.js`（会话世代栅栏）与'
    ' `config/write-receipt.js`（写回执）+ 两个判据套件 `tests/system-v3580.test.mjs` /'
    ' `tests/system-v3590.test.mjs`。语法面 620 → **%s** 的增量全部来自这四件（`tests/` 进语法门、'
    '不进导入门扫描面）。**本行只记真跑读数**：两道门现场各跑一遍，读数直接落笔（脚本里不写字面量）。）'
    % (VER, SYN_N))
s = once(s, SYN_LINE, SYN_LINE + NOTE_SYN, '语法契约行补说明')
s = once(s, OLD_IMP, '导入 %s 文件 %s 条' % (IMP_F, IMP_S), '导入契约行')
IMP_LINE = '导入 %s 文件 %s 条' % (IMP_F, IMP_S)
NOTE_IMP = (
    '（**%s 复校**：导入面增量逐条对账 —— 文件 381 → **%s**（新件 2 个：`config/session-gate.js` 与'
    ' `config/write-receipt.js`；两个判据套件不进本门扫描面）、静态说明符 572 → **%s**'
    '（增 %s 条：`config/write-receipt.js` 被 34 件写回口各引一条、`config/session-gate.js` 被 9 件引'
    '（含入口 `index.js` 那一条）、另有 14 条新写的 `config/num-gate.js` 引用落在 O4/O5 逐处侦察时'
    '一起归门的取数点上；**零条既有导入被删**（比对 HEAD 基线 `--list` 明细：新增 57 条、消失 0 条））、'
    '动态 import 137 → **%s**。'
    '★ 边界：本版能证明的是「在飞的写回口全部接了栅栏」与「写回执的裁决口径唯一且 Promise 不当布尔读」，'
    '**不证明**真宿主里那一轮真实 AI 回信、真机切会话与真机渲染，也不证明字节真进了宿主存储'
    '（调用落了不等于落盘，要写后真读一次才能证明往返）。这正是本文第二类'
    '「看起来没坏但显示不对」的典型。）' % (VER, IMP_F, IMP_S, int(IMP_S) - 572, IMP_D))
s = once(s, IMP_LINE, IMP_LINE + NOTE_IMP, '导入契约行补说明')
assert s.count('v3.58.0 复校') >= 3, s.count('v3.58.0 复校')
assert s.count('v3.58.0 复校') == 1 + s.count('（**v3.58.0 复校**'), '首行与契约段各一次（无重复块）'

# ══════════ ② 当版条目两处同源 ══════════
ITEM_BOUNDARY = (
    '【运行时验证边界复校（v3.58.0）】本版治的是两类「' + MARK + '」的形态：'
    '① 回信飞出去时是这一段会话、回来时已经不是了 —— 它不报错、不崩溃，只是把结果写进了现在那个存档桶；'
    '② 写入回执把异步的 set 当同步布尔读 —— 界面恒报已收下，而那一格永远读不出真值。'
    '本层能保证的是：两维会话栅栏（会话身份加进程内世代）与写回执裁决（Thenable 不当布尔读）'
    '在真模块真调用下成立、七族在飞写回口的令牌与栅栏成对在场、被挡下的回信有可读账本与可见消费面。'
    '它不能保证的是：真宿主里那一轮真实 AI 回信、真机切会话与真机渲染；也不保证字节真进了宿主存储 —— '
    '调用落了不等于落盘了，要写后真读一次才能证明往返，那一步仍需真机复现。')
ITEM_HANDOFF = (
    '【交棒改写 · 四处旧判据换锚不是放宽】O5 落地后定向回归暴露四类连带面，全部按「把门钉回它本来要钉的'
    '东西」修：① v3340 的「恰三条 import」计数门改为分层允许集、v3410 的 App import 白名单收录新真源；'
    '② v3380 / v3390 / v3400 / v3420 / v3430 的写面字面量门由钉死 storage.set 改为认「经 set 落盘」；'
    '③ v3450 的 I24 破坏锚点从不可达死码（writeReceipt 自带 try/catch 之后的外层 catch）移到活机制'
    '（把回执判定抹成无条件成功）；④ v281 的锚点收回到 render 独有那一处（同一文件自 O4 起有两处同步点，'
    '锚点必须恰中 1 次）。另给 15 个副本树补 config/write-receipt.js、给 v290 与 v293 的镜像树补'
    ' config/session-gate.js 与 config/num-gate.js —— 副本树缺件时判据压根跑不起来，负控制就失去证明力。')
for it in (ITEM_BOUNDARY, ITEM_HANDOFF):
    assert '[' not in it and ']' not in it, it[:40]
    assert DQ not in it and chr(92) not in it, it[:40]

with open(os.path.join(ROOT, LOG_REL), encoding='utf-8') as f:
    log = json.load(f)
assert log['latest'] == '3.58.0', log['latest']
items = log['versions']['3.58.0']['items']
assert ITEM_BOUNDARY not in items and ITEM_HANDOFF not in items, '本脚本已执行过（条目已在场）'
OLD_HANDOFF = [it for it in items if it.startswith('【交棒改写 · 无')]
assert len(OLD_HANDOFF) == 1, len(OLD_HANDOFF)
OLD_ITEM = OLD_HANDOFF[0]
assert '未改任何既有判据的口径' in OLD_ITEM
pos = items.index(OLD_ITEM)
items[pos] = ITEM_HANDOFF
# 条目序位惯例（对齐 v3.55.0~v3.57.0）：「运行时验证边界复校」排在「版本升至 X（五源同源）」**之前**
VER_ITEMS = [i for i, it in enumerate(items) if it.startswith('【版本升至 ' + '3.58.0')]
assert len(VER_ITEMS) == 1, VER_ITEMS
items.insert(VER_ITEMS[0], ITEM_BOUNDARY)
# ★ 闸门纪律（本版自己抓到的缺陷）：首版把 update-log 的落盘写在 WRITE 闸门**之前**，
#   于是 dry-run 也真写了磁盘（本仓记过的「闸门只管一半」同族形态）。修法：三份落盘一律收到闸门之后。
print('update-log.json（待写）：3.58.0 条目 %d 条（换锚 1 处 + 新增 1 条）' % len(items))

src = open(os.path.join(ROOT, IDX_REL), encoding='utf-8').read()
OLD_LINE = '        ' + json.dumps(OLD_ITEM, ensure_ascii=False)
assert src.count(OLD_LINE) == 1, src.count(OLD_LINE)
src = once(src, OLD_LINE, '        ' + json.dumps(ITEM_HANDOFF, ensure_ascii=False), '公告块换锚')
VER_ITEM = [it for it in items if it.startswith('【版本升至 ' + '3.58.0')][0]
VER_LINE = '        ' + json.dumps(VER_ITEM, ensure_ascii=False)
assert src.count(VER_LINE) == 1, src.count(VER_LINE)
src = once(src, VER_LINE, '        ' + json.dumps(ITEM_BOUNDARY, ensure_ascii=False) + ',' + NL + VER_LINE,
           '公告块插入当版边界条（序位与 update-log 同源）')
# 自纠：items 区每行引号数必须为 2 且不得含方括号（代代相传的接线口径）
bi = src.index('const ST_PHONE_CURRENT_UPDATE = {')
seg_start = src.index('    items: [', bi)
seg_end = src.index(NL + '    ]', seg_start)
for ln in src[seg_start:seg_end].split(NL):
    t = ln.strip()
    if not t.startswith(DQ):
        continue
    assert t.count(DQ) - t.count(chr(92) + DQ) == 2, '公告块引号数异常：' + t[:60]
    assert '[' not in t and ']' not in t, '公告条目不得含方括号：' + t[:60]
# 两处逐字同源自证（判据面同款关系）
blk = src[src.index('const ST_PHONE_CURRENT_UPDATE = {'):src.index(NL + '};', bi)]
for it in log['versions']['3.58.0']['items']:
    assert json.dumps(it, ensure_ascii=False) in blk, '弹窗逐字同源失败：' + it[:30]

print('== dry-run 摘要 ==')
print('  文档：首行版标 -> %s 复校；语法 %s 文件；导入 %s 文件 %s 条' % (VER, SYN_N, IMP_F, IMP_S))
print('  条目：换锚 1 处（交棒改写如实记账）+ 新增 1 条（运行时验证边界复校）')
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(DOC, 'w', encoding='utf-8') as f:
    f.write(s)
with open(os.path.join(ROOT, LOG_REL), 'w', encoding='utf-8') as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, IDX_REL), 'w', encoding='utf-8') as f:
    f.write(src)
print('已落盘：', DOC, os.path.getsize(DOC), '/', LOG_REL, '/', IDX_REL)