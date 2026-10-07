#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3640_probe.py — v3.64.0：给 branch_play_probe.cjs 补上「块注释也算注释」纪律。

【治的欠债（本轮真跑实测，不是推测）】
  两份跨仓取证探针并列，同一条口径写成两样：
    · tests/audit/schedule_conflict_probe.cjs —— **v3.22.0** 就立过 `stripBlockComments`
      （该版 rebuilds 留档原话：「探针口径写明『注释行不计』，但实现只跳过 `//`，
      块注释散文照算（残余 1 点）」）；
    · tests/audit/branch_play_probe.cjs —— **从未同步**：`countTokens` 与三处
      `scanRollback` 读文件时只跳 `//` 行，块注释里的散文照进读数。
  实测后果（本版真跑，逐条有据）：
    checkpoint 1 -> 0（唯一命中在 config/checkpoint-content-contract.js 文件头块注释，
      那几行逐字写的是「绝不碰 saveCheckpoint / dropCheckpoint 这类写面」—— 它声明的是**没做**写面）；
    preview   43 -> 34；branchFace 2 -> 0（两处全在 config/branch-contrast.js 文件头块注释）；
    globalRead 8 -> 4（world-bridge.js 那处注释逐字写着「不摸 window.LonShaEvidenceWorkbench」）。
  回滚覆盖面 41 点 / 4 文件 / 12 入口定义 **一格未动**（已实测），故 D3 负控制不受影响。

【纪律】只改这一件探针的口径实现与头部留档，**不动任何判据数值**；
  先逐条校验锚点恰中 1 次，再统一写盘；默认 dry-run，--write 才落盘。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tests/audit/branch_play_probe.cjs'
WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


src = rd(REL)
orig = src
plan = []

# ── ① 头部口径纪律补记（第 ④ 条） ──
A_HDR = (' *   另守两条 token 纪律：不认裸词（下游 `preview` 是图片预览、`checkpoint` 是 SD 模型名、')
HDR_NEW = (
    ' *   ④ **块注释也算注释**（v3.64.0 复校，与 `schedule_conflict_probe.cjs` 的 v3.22.0 同款）：\n'
    ' *     本探针此前只跳过 `//` 行，**块注释散文照进读数** —— 而块注释恰恰是「写规格」的地方，\n'
    ' *     于是「本模块绝不碰 X」这类声明会被算成「X 已实施」。实测四族都吃过这一口：\n'
    ' *       checkpoint 1->0（唯一命中在 config/checkpoint-content-contract.js 文件头，\n'
    ' *         那几行写的是「绝不碰 saveCheckpoint / dropCheckpoint 这类写面」）；\n'
    ' *       preview 43->34；branchFace 2->0（两处全在 config/branch-contrast.js 文件头）；\n'
    ' *       globalRead 8->4（config/world-bridge.js 那处注释写着「不摸 window.LonShaEvidenceWorkbench」）。\n'
    ' *     回滚覆盖面 41 点 / 4 文件 / 12 入口定义**一格未动**（同一口径下实测） ⇒ D3 负控制不受影响。\n'
    ' *     剥离实现保留换行（行号仍指向真实文件），与姊妹探针逐字同款。\n'
    ' *   另守两条 token 纪律：不认裸词（下游 `preview` 是图片预览、`checkpoint` 是 SD 模型名、'
)
src = once(src, A_HDR, HDR_NEW, '头部纪律第 ④ 条')
plan.append('头部口径纪律补 ④ 块注释也算注释')

# ── ② 探针主体：IDX_CODE 走剥离 + 新增 readCode 助手 ──
A_IDX = 'const IDX_CODE = stripAnnouncements(IDX);\nconst idxLines = IDX_CODE.split(NL);'
IDX_NEW = (
    '/* ★ 块注释也算注释（v3.64.0 复校）。与 `schedule_conflict_probe.cjs` 的 `stripBlockComments`\n'
    ' *   逐字同款（v3.22.0 立）：匹配前先把块注释整段抹白、**保留换行** ⇒ 行号不变。\n'
    ' *   为什么必须做：本探针全部 token 族都是**子串匹配**，而块注释是写规格的地方 ——\n'
    ' *   「本模块绝不碰 X」会被算成「X 已实施」（实测四族都吃过这一口，见头部 ④）。 */\n'
    'function stripBlockComments(src) {\n'
    '  return src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, (m) => m.replace(/[^\\n]/g, \' \'));\n'
    '}\n'
    'const readCode = (abs) => stripBlockComments(fs.readFileSync(abs, \'utf8\'));\n'
    'const IDX_CODE = stripBlockComments(stripAnnouncements(IDX));\n'
    'const idxLines = IDX_CODE.split(NL);'
)
src = once(src, A_IDX, IDX_NEW, 'IDX_CODE 剥离 + readCode 助手')
plan.append('IDX_CODE 走 stripBlockComments + 新增 readCode 助手')

# ── ③ 三处 scanRollback / downLines 读文件改走 readCode ──
A_RB1 = "for (const f of files) scanRollback(fs.readFileSync(f, 'utf8'), rel(f));"
src = once(src, A_RB1, "for (const f of files) scanRollback(readCode(f), rel(f));", 'scanRollback 读面')
plan.append('scanRollback 读面 -> readCode（实测读数不变）')

A_RB2 = '  const lines = fs.readFileSync(f, \'utf8\').split(NL);'
src = once(src, A_RB2, '  const lines = readCode(f).split(NL);', '入口定义循环读面')
plan.append('入口定义循环读面 -> readCode（实测读数不变）')

A_RB3 = "for (const f of files) downLines.push([rel(f), fs.readFileSync(f, 'utf8').split(NL)]);"
src = once(src, A_RB3, "for (const f of files) downLines.push([rel(f), readCode(f).split(NL)]);", 'downLines 读面')
plan.append('downLines 读面 -> readCode（四族 token 由此统一剥注释）')

assert src != orig
assert 'stripBlockComments(' in src and src.count('function stripBlockComments') == 1
# 定义行写的是 `readCode = (abs) =>`，不带括号紧邻，故 `readCode(` 只应命中 3 个**调用点**
assert src.count('readCode(') == 3, 'readCode 调用点必须 3 处，实得 %d' % src.count('readCode(')
assert "fs.readFileSync(f, 'utf8')" not in src, '探针内不得残留未剥离的裸读'

print('== v3.64.0 探针纯度补丁 draft ==')
for i, p in enumerate(plan):
    print('  %d. %s' % (i + 1, p))
print('  文件：%s（%d -> %d 字符）' % (REL, len(orig), len(src)))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, REL), 'w', encoding='utf-8') as f:
    f.write(src)
print('已落盘：', REL)
