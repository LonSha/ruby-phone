#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch_v3410_fix.py — 补 v3.41.0 自审发现的**本件自身两处缺陷**。
#
# 缺陷 ①（状态残留）：_loadMemoriesAndWish 的早退分支（journal 整格坏 JSON）
#   不碰 this._memBad，于是它保留**上一轮装载留下的值** —— 第二次 probe 时
#   「写了但认不出来」会被前一轮的 false 盖成「还没记过」（不报错、不崩溃、只错结果）。
#   修法：进函数先归零，早退分支按真实情况置位。
#
# 缺陷 ②（功能级失效）：_loadPolicy 定义了但**全库零调用** —— probe 里另写了一份
#   keepOr(...) 内联版。同一件事两个口径，改了其中一处另一处不会跟着改。
#   修法：probe 改调用 _loadPolicy，删掉内联重复。
#
# 纪律：幂等（二跑报「已在场，跳过」）；**先校验 draft、再落盘**。
# ★ 不能用 ast.parse 当语法门：本工具治的是 JS 文件，Python 解析器对 JS 必抛；
#   首版把落盘写在 ast.parse **之前**，于是「文件已经改了、工具却报错退出」
#    —— 正是本仓反复登记的「写了但报错了」形态。改用 node --check 校验 draft。
import os
import subprocess

ROOT = '/home/user/ruby-phone'
P = os.path.join(ROOT, 'apps/needsim/needsim-app.js')
s = open(P, encoding='utf-8').read()

# ---------- 缺陷 ① ----------
A_OLD = (
    '        this.memories = [];\n'
    '        this.wish = null;\n'
    '        this._wishState = SIMS_WISH_STATES[2];\n'
    '        this._wishStale = null;\n'
    '        if (!rep || rep.ok !== true || rep.raw === null) {\n'
    '            if (bad) {\n'
    '                this._wishState = SIMS_WISH_STATES[3];\n'
    '                return true;\n'
    '            }\n'
    '            return false;\n'
    '        }\n'
    "        const r = (rep.raw && typeof rep.raw === 'object') ? rep.raw : null;\n"
    '        if (!r) {\n'
    '            this._wishState = SIMS_WISH_STATES[3];\n'
    '            return true;\n'
    '        }\n'
)
A_NEW = (
    '        this.memories = [];\n'
    '        this.wish = null;\n'
    '        this._wishState = SIMS_WISH_STATES[2];\n'
    '        this._wishStale = null;\n'
    '        /* ★ 先归零：否则早退分支会把**上一轮**的 _memBad 带到这一轮 ——\n'
    '         *   第二次 probe 时「写了但认不出来」会被前一轮的 false 盖成「还没记过」。 */\n'
    '        this._memBad = false;\n'
    '        if (!rep || rep.ok !== true || rep.raw === null) {\n'
    '            if (bad) {\n'
    '                this._wishState = SIMS_WISH_STATES[3];\n'
    '                this._memBad = true;\n'
    '                return true;\n'
    '            }\n'
    '            return false;\n'
    '        }\n'
    "        const r = (rep.raw && typeof rep.raw === 'object') ? rep.raw : null;\n"
    '        if (!r) {\n'
    '            this._wishState = SIMS_WISH_STATES[3];\n'
    '            this._memBad = true;\n'
    '            return true;\n'
    '        }\n'
)
B_OLD = (
    '            this._loadMemoriesAndWish(rj);\n'
    '            this._badLedger = this._loadLedger(rl);\n'
    '            /* 策略与台账同键：装载时一并读出来 */\n'
    '            this.ledgerKeep = keepOr((rl && rl.raw && rl.raw.ledgerKeep), SIMS_MAX_UNITS);\n'
)
B_NEW = (
    '            this._loadMemoriesAndWish(rj);\n'
    '            this._badLedger = this._loadLedger(rl);\n'
    '            /* 策略与台账同键：装载时一并读出来（★ 走 _loadPolicy，不在这里另写一份口径） */\n'
    '            this._loadPolicy(rl);\n'
)

# ---------- 幂等应用 ----------
pending = []
for tag, old, new in [('mem-bad-reset', A_OLD, A_NEW), ('policy-single-source', B_OLD, B_NEW)]:
    n = s.count(old)
    if n == 0:
        assert s.count(new) == 1, tag + ' 锚点既不在场也不已在位（状态不明，拒写）'
        print(tag + ' 已在场，跳过')
        continue
    assert n == 1, tag + ' 锚点必须洽中 1 次，实得 %d' % n
    s = s.replace(old, new, 1)
    pending.append(tag)

if pending:
    draft = os.path.join(ROOT, 'apps/needsim/.patch_v3410_draft.js')
    with open(draft, 'w', encoding='utf-8') as f:
        f.write(s)
    r = subprocess.run(['node', '--check', draft], capture_output=True, text=True)
    os.remove(draft)
    assert r.returncode == 0, 'draft 语法不过，拒落盘：' + (r.stderr or '')[-300:]
    with open(P, 'w', encoding='utf-8') as f:
        f.write(s)
    print('patched（' + '/'.join(pending) + '）%d bytes' % os.path.getsize(P))
else:
    print('全部已在场，未落盘')
