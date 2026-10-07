#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3640_handoff.py — v3.64.0：把 v326 A2 的 `checkpointFaceHits >= 1` 下限判据**交棒**。

【为什么必须同批交棒（不是可选动作）】
  探针补上块注释纪律后，`checkpointFaceHits` 由 1 如实落到 0，旧下限 1 当场翻红。
  但**这不是「实现被摘」**：那唯一的 1 点命中来自
  `config/checkpoint-content-contract.js` 的**文件头规格注释**，逐字写的是
  「绝不碰 `saveCheckpoint` / `dropCheckpoint` 这类写面」—— 它声明的是**没做**写面。
  ⇒ 旧判据量的从来不是「有没有实施」，而是「有没有人在这份树的任意位置（含块注释）
     写过这个 token」。**探针的刻度是文本的，注释也会进读数**（本仓 v3.20.2 已为此留过档）。

【处置口径（按本仓纪律，不取两条下策）】
  · 不删断言（删断言 = 洗断言）；
  · 不把探针改名成新 token 把散文重新算成绿（那等于把散文固化成读数）。
  改写为**版本无关的真判据**：真源四出口在场 + 产品面**真调用**（import 名不算消费）。
  这两件事 `scripts/bridge-contract-audit.mjs` 的 J13 已以更强形式守着
  （[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1]）；
  本条的 1 不留余量原意由 J13 承接，本处留**调用点级**的贴身复核。

【纪律】只改这一处判据及其留档；锚点先校验恰中 1 次；默认 dry-run，--write 才落盘。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tests/system-v326.test.mjs'
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

OLD = (
    "  assert.ok(rep.checkpointFaceHits >= 1,\n"
    "    '检查点面在下游已实施（下限 1）—— 读数不得塌成 0（塌成 0 = 实现被摘或探针刻度失效），实测 ' + rep.checkpointFaceHits);\n"
)
NEW = (
    "  /* ★ [v3.64.0 交棒] 本条由「探针文本计数的下限」改写为「真源出口 + 产品面真调用」。\n"
    "   *   **为什么必须改**：`checkpointFaceHits` 是**文本子串计数**，而本探针（v3.64.0 前）\n"
    "   *   只跳 `//` 行、**不剥块注释** ⇒ 它量的从来不是「有没有实施」，而是「有没有人在这份树的\n"
    "   *   任意位置（含块注释散文）写过这个 token」。实测：唯一的 1 点命中来自\n"
    "   *   `config/checkpoint-content-contract.js` 的文件头**规格注释** —— 那几行逐字写着\n"
    "   *   「绝不碰 `saveCheckpoint` / `dropCheckpoint` 这类写面」，即它声明的是**没做**写面。\n"
    "   *   v3.64.0 给探针补上块注释纪律（与 `schedule_conflict_probe.cjs` 的 v3.22.0 同款）后\n"
    "   *   该读数如实归零 ⇒ 旧下限 1 翻红。**这不是「塌成 0」，是「原先那个 1 本来就是散文」**\n"
    "   *   （本仓 v3.20.2 已为同一形态留过档：探针的刻度是文本的，注释也会进读数）。\n"
    "   *   **为什么这样改**：按本仓纪律「优先交棒为版本无关的真判据」，且不取两条下策 ——\n"
    "   *     删断言（= 洗断言）与「换个 token 把散文重新算绿」（= 把散文固化成读数）。\n"
    "   *     新判据锚在**实现**上：① 真源四出口在场；② 产品面**真调用**（import 名不算消费）。\n"
    "   *   同一件事 `scripts/bridge-contract-audit.mjs` 的 J13 已以更强形式守着\n"
    "   *   （`[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1]`，\n"
    "   *   实测消费点 1、真源四出口在场）。旧判据「写 1 不留余量」的原意（少一个 = 那一面又回到\n"
    "   *   零消费）由 J13 承接，本处另留**调用点级**贴身复核。\n"
    "   *   ⚠ 代价如实记：本条不再能拦住「把实现删掉、把注释留下」这一形态 —— 但那种形态现在由\n"
    "   *   真调用判据拦（删掉调用点即翻红），而**注释形态本来就不该被判据当成实现**。 */\n"
    "  const cpSrc = read(path.join(ROOT, 'config', 'checkpoint-content-contract.js'));\n"
    "  for (const fn of ['readLonshaCheckpointFace', 'readCheckpointContentDiff',\n"
    "    'checkpointContentLines', 'checkpointFaceLine']) {\n"
    "    assert.ok(new RegExp('export function ' + fn + '\\\\b').test(cpSrc),\n"
    "      '检查点真源必须导出 ' + fn + '（缺一即该面被摘）');\n"
    "  }\n"
    "  assert.ok(/checkpointContentDiff|CHECKPOINT_DIFF_STATES/.test(cpSrc),\n"
    "    '真源必须带深对照态（上游半成功与失败不同形）');\n"
    "  const cpConsumer = read(path.join(ROOT, 'apps', 'diagnose', 'diagnose-data.js'));\n"
    "  assert.ok(/readLonshaCheckpointFace\\(/.test(cpConsumer),\n"
    "    '产品面必须**真调用**检查点读面（import 进来的名字不算消费）—— '\n"
    "    + '这是「下游已实施检查点内容级对照」此刻的**实现级**证据');\n"
    "  assert.ok(/readCheckpointContentDiff\\(/.test(cpConsumer),\n"
    "    '产品面必须真调用深对照读数（只读一行文案不算接了内容级对照）');\n"
)
src = once(src, OLD, NEW, 'v326 A2 检查点下限判据交棒')

# 同步头部覆盖说明里的这条改写（保持「覆盖」清单与正文一致）
OLD_HDR = '//     D 负控制五条（真源码破坏 → 同款真判据转红；含 fail-closed 两条）\n'
NEW_HDR = ('//     D 负控制五条（真源码破坏 → 同款真判据转红；含 fail-closed 两条）\n'
           '//   ★ [v3.64.0 交棒] A2 的第三条判据（`checkpointFaceHits` 下限 1）在本版改写为\n'
           '//     「真源四出口在场 + 产品面真调用」—— 理由与代价见该判据处留档（探针补上块注释\n'
           '//     纪律后该文本读数如实归零，原先那 1 点来自文件头规格注释）。\n')
src = once(src, OLD_HDR, NEW_HDR, '头部覆盖清单同步')

assert src != orig
assert 'assert.ok(rep.checkpointFaceHits >= 1' not in src, '旧下限判据必须已退场'
assert 'readLonshaCheckpointFace\\(' in src, '新判据必须贴身复核调用点形态'
assert 'assert.ok(rep.previewFaceHits >= 15' in src, '预览面下限判据不得被动到'

print('== v3.64.0 交棒补丁 draft ==')
print('  1. v326 A2：checkpointFaceHits >= 1 -> 真源四出口在场 + 产品面真调用（＋深对照调用）')
print('  2. v326 头部覆盖清单同步交棒记录')
print('  文件：%s（%d -> %d 字符）' % (REL, len(orig), len(src)))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, REL), 'w', encoding='utf-8') as f:
    f.write(src)
print('已落盘：', REL)