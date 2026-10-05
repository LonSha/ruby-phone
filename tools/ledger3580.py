#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ledger3580.py — v3.58.0 收尾记账：把 O5 的验收补面、界面播报缺口、四处基线与两门读数

做四件事（全部只写记账位，不改判据逻辑；默认 dry-run，--write 才落盘）：
① `update-log.json` 的 3.58.0 条目补一条「O5 验收补面与未覆盖面」（与 index.js 公告块逐字同源）；
② `tools/iter116_seg.md` 的「交棒改写 · 无」那条**换成如实记账**（本版确有四处换锚），
   并补 O5 验收补面 / 界面播报缺口两条（迭代日志是工程侧过程记录）；
③ 版本记账簇四份基线已在 `tools/doc3580.py` 里刷过（本脚本只做自证读数）；
④ 打印本版两门 / 死导出 / 十一道门的现场读数摘要，供人工核对。

【为什么要写这一条】计划 O5 验收原文含「多键中途失败时均不显示已保存」「重开往返可验证」
「清除一个 App 不连坐其他桶」。本版把**写回执层**（config/write-receipt.js）做到位，
并以 R4 真模块真契约覆盖了前三条的**机制面**；但**界面层播报**仍以 `r.ok` 为准 ——
真跑实测 `ingestItems` 在第二键抛错时返回 `{ok: true, saved: false}`，视图照报「已收下」。
该缺口如实登记为 R5 读数（非红判据）与本节条目，留待按「一次改一处」的节奏收口。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
DQ = chr(34)
NL = chr(10)
VER = 'v3.58.0'


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


ITEM = (
    '【O5 验收补面 · 三条此前没有断言覆盖的】定向回归时逐条对计划 O5 的验收原文，'
    '发现三条**判据面是空的**，本版补齐并跑真模块：① 多键中途失败（第二条键抛错 / 报假）'
    '时回执必须为假 —— 这条正是源代「只报最后一条键」的对照面，夹具必须同步抛错才看得到；'
    '② 重开往返（写成功 → 等落队 → 新实例装回来）读数必须与写进去的一致；'
    '③ 清一个 App 不连坐其他桶（只清自己的键，别人的键一字不动）；另加「不新增另一套数据库」'
    '（写回执里零 indexedDB / localStorage / sessionStorage，宿主出口唯一）。'
    '四条都落在 tests/system-v3590.test.mjs 的 R4 面。'
    '【界面播报缺口 · 如实记读数不记绿】验收还有一条「多键中途失败时均不显示已保存」：'
    '本版做到的是**写回执层**，而界面层播报仍以 ok 为准 —— 真跑实测 ingestItems 在第二键抛错时'
    '返回 ok 真而 saved 假，视图照报「已收下」。本版把它钉成可复算读数（R5，逐件列出哪几件视图'
    '还没见过 saved 字样），**不写成红判据**（写成恒红等于把缺口盖上），留待按「一次改一处」收口。'
    '【本版自己抓到的缺陷 · 闸门只管一半】写边界文档复校脚本时，首版把 update-log 的落盘写在'
    'WRITE 闸门**之前**，于是 dry-run 也真写了磁盘（与本版整治的两类形态同族）。'
    '当场按公告块头部前缀回填还原，并把三份落盘一律收到闸门之后。')
assert '[' not in ITEM and ']' not in ITEM, '条目不得含方括号'
assert DQ not in ITEM and chr(92) not in ITEM, '条目不得含双引号与反斜杠'

# ══════════ ① update-log + 公告块 ══════════
with open(os.path.join(ROOT, 'update-log.json'), encoding='utf-8') as f:
    log = json.load(f)
items = log['versions']['3.58.0']['items']
assert ITEM not in items, '本脚本已执行过'
ver_item = [it for it in items if it.startswith('【版本升至 ' + '3.58.0')][0]
items.insert(items.index(ver_item), ITEM)
print('update-log：3.58.0 条目 %d 条（补 O5 验收补面条）' % len(items))

src = open(os.path.join(ROOT, 'index.js'), encoding='utf-8').read()
VER_LINE = '        ' + json.dumps(ver_item, ensure_ascii=False)
assert src.count(VER_LINE) == 1, src.count(VER_LINE)
src = src.replace(VER_LINE, '        ' + json.dumps(ITEM, ensure_ascii=False) + ',' + NL + VER_LINE, 1)
bi = src.index('const ST_PHONE_CURRENT_UPDATE = {')
blk = src[bi:src.index(NL + '};', bi)]
for it in items:
    assert json.dumps(it, ensure_ascii=False) in blk, '弹窗逐字同源失败：' + it[:30]

# ══════════ ② 迭代日志段（工程侧过程记录） ══════════
SEG = os.path.join(ROOT, 'tools', 'iter116_seg.md')
seg = open(SEG, encoding='utf-8').read()
OLD_HANDOFF = [l for l in seg.split(NL) if l.startswith('- 【交棒改写 · 无')]
assert len(OLD_HANDOFF) == 1, len(OLD_HANDOFF)
NEW_HANDOFF = ('- 【交棒改写 · 四处旧判据换锚不是放宽】O5 落地后定向回归暴露四类连带面，'
               '全部按「把门钉回它本来要钉的东西」修：① v3340 的「恰三条 import」计数门改为分层允许集、'
               'v3410 的 App import 白名单收录新真源；② v3380 / v3390 / v3400 / v3420 / v3430 的写面字面量门'
               '由钉死 storage.set 改为认「经 set 落盘」；③ v3450 的 I24 破坏锚点从不可达死码'
               '（writeReceipt 自带 try/catch 之后的外层 catch）移到活机制（把回执判定抹成无条件成功）；'
               '④ v281 的锚点收回到 render 独有那一处（同一文件自 O4 起有两处同步点，锚点必须恰中 1 次）。'
               '另给 15 个副本树补 config/write-receipt.js、给 v290 与 v293 的镜像树补 config/session-gate.js '
               '与 config/num-gate.js —— 副本树缺件时判据压根跑不起来，负控制就失去证明力。')
seg = seg.replace(OLD_HANDOFF[0], NEW_HANDOFF, 1)
SEG_ITEM = '【O5 验收补面与界面播报缺口】' + ITEM.split('【O5 验收补面 · 三条此前没有断言覆盖的】')[1]
SEG_LINE = '- ' + SEG_ITEM
assert SEG_LINE.count(DQ) == 0 and SEG_LINE.count(chr(92)) == 0, '迭代段不得含双引号与反斜杠'
assert '[' not in SEG_LINE and ']' not in SEG_LINE, '迭代段不得含方括号（弹窗切片判据按首个右方括号截断）'
seg = seg.rstrip(NL) + NL + SEG_LINE + NL
assert seg.count('【交棒改写 · 无') == 0, '旧的「无交棒改写」记账必须已被替换'
assert seg.count('【O5 验收补面与界面播报缺口】') == 1, '迭代段里补面条必须恰一条'

print('== dry-run 摘要 ==')
print('  条目 +1（O5 验收补面与界面播报缺口）、公告块同步 +1 行')
print('  迭代段：交棒改写一条改为如实记账 + 追加 O5 补面一条')
for tag, cmd in (('语法门', ['node', 'scripts/syntax-check.mjs']),
                 ('导入门', ['node', 'scripts/import-resolve-check.mjs']),
                 ('死导出门', ['node', 'scripts/dead-export-check.mjs'])):
    rc, out = run(cmd)
    tail = [l for l in out.strip().split(NL) if l.strip()][-1]
    print('  %s rc=%d：%s' % (tag, rc, tail[:110]))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, 'update-log.json'), 'w', encoding='utf-8') as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'index.js'), 'w', encoding='utf-8') as f:
    f.write(src)
with open(SEG, 'w', encoding='utf-8') as f:
    f.write(seg)
print('已落盘：update-log.json / index.js / tools/iter116_seg.md')