#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v4.45.0 收尾补丁②（v2）：把「自己抓到的缺陷⑤（弱口径）」等四条记入四处同源面。

首版锚点失配（实测，已回滚）：裸锚点 `- 【不做面在代码上可判】` 在三类面上各错一次 ——
  · `ITERATION_LOG.md` / `update-log.json` 里 v4.44.0 段有一条**同名开头**的条目 ⇒ 命中 2 次；
  · `index.js` / `update-log.json` 的 items 是 **JSON/JS 字符串**（行首多一对引号）⇒ 命中 0 次。
★ 教训（本仓老账）：跨面改写不能用「人眼看着唯一」的锚点 —— 必须用**只在本版出现的**串，
  且要按面区分前缀形态。本版专属锚点 = 含 `cw_board_chat_pending` 的那条「不做面」条目。

口径：
  · 每个面**恰中 1 次**，否则 abort（不做静默部分替换）；
  · 插入位置 = 该条**之前**（它是本段的收尾性陈述）；
  · 前缀按面构造：md 面 `- `，JSON/JS items 面沿用锚点行自身的缩进与引号。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 本版专属锚点（只在本版条目里出现的子串）
ANCHOR = '【不做面在代码上可判】不自动发布（零 `addMoment`'

BODY = [
    '【自己抓到的缺陷⑤（本版引入 · 门禁抓的，不是人眼看的）：新契约件里就地写了一遍弱口径】`config/material-board-handoff.js` 的 `floor` / `asOf` 两处首版写成 `Number.isFinite(Number(v)) ? Math.floor(Number(v)) : null`。本仓自 v3.12.0 起把「数值取值」收成**唯一实现**（`config/num-gate.js` 的 `numOrNull`）并配常驻门禁 `scripts/weak-coercion-audit.mjs`，因为该写法会把 `\'\'` / `[]` / `false` 读成 `0`，与「上游**没给**」塌成同一个读数（两者处置常常相反）。实测：本版新件落地后门禁从 1 处（存量 `config/goal-tree-contract.js`）涨到 **3 处**，把两处改成**纯转发** `numOrNull` 后回落 1 处。★ 教训与 v3.12.0 档头同款：门立住了不等于下一个人不会再写一遍弱的那版 —— 新件必须**引门**，不是**再写一遍**。',
    '【门禁读数如实：本版只降自己引入的，不动存量】`weak-coercion` 门禁剩 1 处（`config/goal-tree-contract.js:201`，本版范围外）**原样留着不顺手改**：那属于另一项的范围，顺手改会把两件事的 diff 混在一起，也让「本版引入了什么」这句话不再可判。本版只保证**自己新加的文件零弱口径**。',
    '【公告读数不得手抄：判据条数写错即「只错结果」】本版公告首稿写「本版判据（六组 26 条）当版跑绿」，而套件实测 **31 条**。四处同源面（迭代段 / `ITERATION_LOG.md` / `update-log.json` items / `index.js` 公告块）一致地写着 26，读者据此核对会以为漏了 5 条判据 —— 这正是本仓最贵的「不报错、不崩溃、只错结果」的最小形态。已四处同改并自证（旧串 0 残留 / 新串全在场）。',
    '【本版四道门禁与全量回归的实测口径（写清哪些是存量、哪些是本版）】四道门（syntax / import-resolve / dead-export / named-import）全绿；本版判据 31/31 全绿；历史套件 v3900(21) / v4010(17) / v4300(35) / v4440(36) 全绿。全量 `npm test` 在本仓**存量**上有红项（`system-v290/v293/v296/v310/v311/v3120/v325/v326/v327/v328/v3570/v3770` 等，与 `weak-coercion` 的存量项同族）：实测在**干净 HEAD 副本**（4.44.0，`git archive` 展开后独立跑）上红项与本工作区**逐套件红数完全一致** ⇒ 这批红**非本版引入**，不在本版范围内顺手改（会把两件事混在一起）。',
]

MD_FACES = ['tools/iter204_seg.md', 'ITERATION_LOG.md']
JS_FACES = ['index.js']


def insert_md(rel):
    p = ROOT / rel
    lines = p.read_text(encoding='utf-8').split('\n')
    hits = [i for i, l in enumerate(lines) if l.startswith('- ') and ANCHOR in l]
    if len(hits) != 1:
        return f'{rel}: 锚点命中 {len(hits)} 次（期望 1）'
    at = hits[0]
    new = ['- ' + b for b in BODY]
    lines[at:at] = new
    p.write_text('\n'.join(lines), encoding='utf-8')
    print(f'[ok] {rel}: 在行 {at + 1} 前插入 {len(new)} 条')
    return None


def insert_js(rel):
    p = ROOT / rel
    lines = p.read_text(encoding='utf-8').split('\n')
    hits = [i for i, l in enumerate(lines) if ANCHOR in l]
    if len(hits) != 1:
        return f'{rel}: 锚点命中 {len(hits)} 次（期望 1）'
    at = hits[0]
    ref = lines[at]
    indent = ref[:len(ref) - len(ref.lstrip())]
    if not ref.lstrip().startswith('"'):
        return f'{rel}: 锚点行不是 JSON/JS 字符串元素（前缀形态不认识）'
    new = [indent + '"' + b + '",' for b in BODY]
    lines[at:at] = new
    p.write_text('\n'.join(lines), encoding='utf-8')
    print(f'[ok] {rel}: 在行 {at + 1} 前插入 {len(new)} 条（前缀 {indent!r}）')
    return None


def insert_ulog():
    lp = ROOT / 'update-log.json'
    log = json.loads(lp.read_text(encoding='utf-8'))
    ver = log.get('latest')
    items = log.get('versions', {}).get(ver, {}).get('items', [])
    hits = [i for i, s in enumerate(items) if ANCHOR in s]
    if len(hits) != 1:
        return f'update-log.json[{ver}].items: 锚点命中 {len(hits)} 次（期望 1）'
    at = hits[0]
    items[at:at] = list(BODY)
    lp.write_text(json.dumps(log, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'[ok] update-log.json[{ver}].items: 在 index {at} 前插入 {len(BODY)} 条')
    return None


def main() -> int:
    bad = []
    for rel in MD_FACES:
        e = insert_md(rel)
        if e:
            bad.append(e)
    for rel in JS_FACES:
        e = insert_js(rel)
        if e:
            bad.append(e)
    e = insert_ulog()
    if e:
        bad.append(e)

    if bad:
        print('ABORT —— 锚点失配（可能已部分写入，需人工核对）：')
        for b in bad:
            print('  -', b)
        return 2

    # 自证：四面各含全部 4 条（各恰 1 次）；update-log.json 仍可解析且条目在册
    for rel in MD_FACES + JS_FACES:
        t = (ROOT / rel).read_text(encoding='utf-8')
        for b in BODY:
            assert t.count(b) == 1, f'{rel} 条目数不是 1：{b[:24]}'
    log = json.loads((ROOT / 'update-log.json').read_text(encoding='utf-8'))
    items = log['versions'][log['latest']]['items']
    for b in BODY:
        assert items.count(b) == 1, f'update-log items 条目数不是 1：{b[:24]}'
    print(f'[self-check] 四面各含 {len(BODY)} 条（各恰 1 次）；update-log.json 可解析（items {len(items)} 条）')
    return 0


if __name__ == '__main__':
    sys.exit(main())