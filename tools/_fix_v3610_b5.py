#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B5：v3130 / v3550 / v3560 三件收尾。

① system-v3130「启动耗时读数层」：B1 判「全部动态 import 都被旁听包住」，
   而 67 段 `instrumentImport(import(x), x)` 已随 O6 搬进表 —— index.js 只剩 52 处，
   判据读 78 是**旧扫描面**（代码结构变了，扫描面没跟）。修法：B1 与 D4 的输入换判据面。
   · 渲染出的分支与 index.js 原五件套逐字同构，所以 `import(` 计数自然回到 118 未剥 /
     ≥78 剥后，D4 的 mood 锚点也仍然在（表里 mood 一行的 module 就是原 spec）。
② system-v3550「App 消费面矩阵」：`varToAppId()` 只扫 index.js 找
   `window.VirtualPhone.X = new ...`（原 67 处已在表里），映射塌到 16 个 ⇒
   F4_wechatLink / F6_lifecycle 两列的磁盘复算全错、A1/A2/D9 三处红灯。
   修法：varToAppId 与 F6 取数一律走判据面（表行渲染回同形构造点）。
③ system-v3560「六项缺陷」：B 面返回键的判据扫**原文**，而 v3.61.0 为本块写了
   一段解释「此前为什么会被杀死」的注释，注释里逐字引着 `<button id="phone-back-button">`
   ⇒ 命中变成 2（判据自指伪证）。修法：B1 在 `codeOf()` 剥注释面上判（与同文件
   A1/A7 负判据同一纪律）；D5 的破坏锚点同时收紧为含 `class=` 的**唯一**串。

锚点纪律：每处恰中预期次数，失配即退出且不写盘。
"""
import ast
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
TESTS = ROOT / 'tests'
BACKUP = Path('/tmp/rp_v3610b5_backup')
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b5] ast 自证通过')
if not BACKUP.exists():
    shutil.copytree(TESTS, BACKUP)
    print('[b5] tests/ 已备份 → %s' % BACKUP)

IMP = "import { routeSurface, readRepoTable } from './_lazy_routes.mjs';"


def add_import(src):
    if '_lazy_routes.mjs' in src:
        return src
    lines = src.split('\n')
    last = max((i for i, l in enumerate(lines[:300]) if l.startswith('import ')), default=-1)
    assert last >= 0, '找不到 import 区'
    lines.insert(last + 1, IMP)
    return '\n'.join(lines)


JOBS = []

# ① v3130
JOBS.append(dict(
    file='system-v3130.test.mjs',
    pairs=[
        # B1 输入面
        ("""test('B1 ★★★ index.js 全部动态 import 都被旁听包住，且 spec 逐字不变（读数层不得改加载路径）', () => {
    const src = readRel('index.js');""",
         """test('B1 ★★★ index.js 全部动态 import 都被旁听包住，且 spec 逐字不变（读数层不得改加载路径）', () => {
    /* [v3.61.0 · O6] 输入取**判据面**（index.js 内联 ∪ 懒加载路由表行渲染回的同形分支）：
     *   67 段 `instrumentImport(import(x), x)` 已搬进 config/app-lazy-routes.js，
     *   index.js 只剩内联的十几处。旧扫描面（只读 index.js）会把它们读成「掉了 26 处」——
     *   真实现一处没少，是扫描面没跟着代码走。判据口径一字未改。 */
    const src = routeSurface(readRel('index.js'), readRepoTable());"""),
        # D4 输入面
        ("""test('D4 ★★★ 负控制：真源码里拆掉一处 import 旁听 ⇒ 判据 3（B1 同款）转红', () => {
    const src = readRel('index.js');""",
         """test('D4 ★★★ 负控制：真源码里拆掉一处 import 旁听 ⇒ 判据 3（B1 同款）转红', () => {
    /* 同 B1：取判据面（mood 一行就在表里，module 字段即原 spec，故锚点照旧恰中 1 次）。 */
    const src = routeSurface(readRel('index.js'), readRepoTable());"""),
    ],
))

# ② v3550：两处取 index.js 的落点（varToAppId 内 + recompute 的 F6 段）都切判据面
JOBS.append(dict(
    file='system-v3550.test.mjs',
    pairs=[],
    multi=[("""    const idx = readFrom(root, INDEX_REL);""",
            """    /* [v3.61.0 · O6] 取判据面：67 个 `window.VirtualPhone.X = new …` 已搬进
     *   懒加载路由表，只读 index.js 会让「实例变量 → appId」映射塌掉（实测 22 → 16），
     *   F4/F6 两列的磁盘复算随之全错。扫描面跟着代码走，判据口径不动。 */
    const idx = routeSurface(readFrom(root, INDEX_REL), readRepoTable());""", 2)],
))

# ③ v3560
JOBS.append(dict(
    file='system-v3560.test.mjs',
    pairs=[
        ("""    if (hits(shell, 'id=' + DQ + 'phone-back-button' + DQ) !== 1) bad.push('B1 未渲染返回按钮');
    const screenStart = shell.indexOf('<div class="phone-screen"');
    const btnAt = shell.indexOf('id=' + DQ + 'phone-back-button' + DQ);""",
         """    /* ★ 判据面取**代码面**（剥注释）：v3.61.0 为本块补了一段解释「此前为什么会被
     *   第一次 setContent 杀掉」的注释，注释里逐字引着 `<button id="phone-back-button">` ——
     *   裸文本扫描会把**说明**读成第二个按钮（判据自指伪证，本仓最贵的形态之一）。
     *   与同文件 A1/A7 的负判据同一纪律。 */
    const shellCode = codeOf(shell);
    if (hits(shellCode, 'id=' + DQ + 'phone-back-button' + DQ) !== 1) bad.push('B1 未渲染返回按钮');
    const screenStart = shellCode.indexOf('<div class="phone-screen"');
    const btnAt = shellCode.indexOf('id=' + DQ + 'phone-back-button' + DQ);"""),
        ("""    ['B1 返回按钮被拿掉', SHELL_REL,
        'id=' + DQ + 'phone-back-button' + DQ,
        'id=' + DQ + 'phone-back-x' + DQ, 'backProblems'],""",
         """    /* ★ 锚点收紧为含 class= 的唯一串：只写 `id="phone-back-button"` 时，
     *   v3.61.0 的解说注释里也有一处同形引用 ⇒ 命中 2 次，破坏就不再单一
     *   （breakIn 会抛「锚点不唯一」，负控制变成「跑不起来」而不是「响过了」）。 */
    ['B1 返回按钮被拿掉', SHELL_REL,
        'class=' + DQ + 'phone-back-button' + DQ + ' id=' + DQ + 'phone-back-button' + DQ,
        'class=' + DQ + 'phone-back-x' + DQ + ' id=' + DQ + 'phone-back-x' + DQ, 'backProblems'],"""),
    ],
))

fails = []
for J in JOBS:
    p = TESTS / J['file']
    src = p.read_text(encoding='utf-8')
    before = src
    if '_lazy_routes.mjs' in src and not J.get('pairs'):
        print('  %-26s skip(已处理)' % J['file'])
        continue
    # 幂等：若所有标准锚点都已 0 命中且本件已接判据面，说明先前那轮已改过
    if '_lazy_routes.mjs' in src and all(src.count(o) == 0 for o, _ in J.get('pairs', [])):
        print('  %-26s skip(已处理·锚点已消失)' % J['file'])
        continue
    for old, new in J['pairs']:
        n = src.count(old)
        if n != 1:
            fails.append('%s 锚点命中 %d 次：%s' % (J['file'], n, old.strip()[:50]))
    for old, new, cnt in J.get('multi', []):
        n = src.count(old)
        if n != cnt:
            fails.append('%s multi 锚点命中 %d 次（期望 %d）' % (J['file'], n, cnt))
    if fails:
        continue
    for old, new in J['pairs']:
        src = src.replace(old, new)
    for old, new, cnt in J.get('multi', []):
        src = src.replace(old, new)
    src = add_import(src)
    if src == before:
        fails.append('%s 无变化' % J['file'])
        continue
    p.write_text(src, encoding='utf-8')
    print('  %-26s ok' % J['file'])

if fails:
    sys.exit('[b5] 失败：' + ' | '.join(fails))
print('[b5] 完成')