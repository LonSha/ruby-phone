#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4h.py — [v4.28.0 · R4-X4 补丁 H] 上游外供登记表补 branchCanon 行

上游 lonsha-memory-plugin/tests/audit/open_face_registry.tsv 九列。
★ 上游在 v3.342.0（M4-X3）交付正史落卷面时漏登外供表（与 M4-X5 证词面同一形态），
  而本仓自己的纪律要求外供面须与本仓表行 / 下游 registry 登记行 / 下游门禁标签
  **三处同批**落地。本轮下游 R4-X4 要接这一面，故补齐上游这半边。

口径（逐条对应上游守卫 scan_open_faces.mjs 的 T1~T6）：
  · producer_version 取**本面契约版本** v3.342.0（供给模块 branch-canon.js
    最后一次改动所在版本），不是宿主版本 —— 宿主抬版不构成本面变更；
  · consumer 写 readBranchCanonState@1，与下游门禁标签逐字一致（下游 R5 判这一条）；
  · invalid_conditions 把「缺席 / 旧版 / 不产出 / 空数据」四态**逐态分开写**（T5）；
  · absent_vs_empty 按「｜」切成两段以上并写清处置相反（T6）。
"""
import io
import os
import sys

UPSTREAM = '/home/user/lonsha-memory-plugin'
TSV = os.path.join(UPSTREAM, 'tests', 'audit', 'open_face_registry.tsv')
WRITE = '--write' in sys.argv
TAB = chr(9)
NL = chr(10)

ROW = [
    'branchCanon',
    'lonsha-memory-plugin',
    'v3.342.0',
    'branch-canon.js::conflicts,planCanon,buildContinuePack,adoptionBrief,revokeGuard,selfCheck',
    '恒定键面 kind|version|ok|judged|reason|writesNothing（+ 逐面分列）；列举面 rows[]（每冲突位 key|verdict|branches[]|titles[]|terminalCount|decision）；'
    '计划面 chosen[]|coexisted[]|excluded[]|pending[]|provenance[]（四档分列，provenance 覆盖每一条结局，未被选中的历史必须留痕）；'
    '交接面 preview|pack{packId,volumeId,entryCount,withheldCount}|pendingCount|keeperUnknown|masked；'
    '落卷面 verdict 三态 ready|blocked|empty + items[]|unmapped[]（缺格三因 no-face|no-owner|no-key 分列）|bareOutcomes[]|adoptionId（幂等键，只由选择本身哈希）；'
    '撤销保护面 revocable[]|keptForeign[]|keptManual[]|keptLater[] + deletesManual|branchWrites 写成读数；'
    '**三态不许压平**（blocked 与 empty 处置相反：一个回去选、一个去补结局条文）',
    'readBranchCanonState@1',
    '缺席（插件不在场 ⇒ 下游 engine-absent，等装插件）|'
    '旧版（插件在场但本版无此面 ⇒ 下游 face-absent，等升级到 v3.342.0+）|'
    '不产出（出口在但调用抛错 / judged:false 装配未到 ⇒ 下游 unusable + no-deps，本机读不出，**不是**「两条结局没有冲突」）|'
    '空数据（真跑过、一个冲突位都没有 ⇒ 下游 empty，**不是**「插件没装」）',
    '未装上游 ⇒ 存档台第五页签如实标不在场，不退回本地猜一份选择；落卷与撤回归上游 owner'
    '（手机端零写盘，writesNothing 恒 true），分卷写入与撤销只走 storyCanonAdoptConfirm',
    '缺席（插件不在场，该去装插件）｜空数据（真跑过、这批结局没有冲突位，该去聊一楼）'
    '——两态处置相反，压平即把「还没装插件」显示成「这批结局没有冲突」',
]


def main():
    s = io.open(TSV, encoding='utf-8').read()
    if 'branchCanon' + TAB in s:
        print('· 已存在 branchCanon 行，跳过')
        return 0
    if not s.endswith(NL):
        s += NL
    s += TAB.join(ROW) + NL
    if not WRITE:
        print('--- DRY RUN（补 --write 才落盘） ---')
        print('  将追加 ' + str(len(ROW)) + ' 列：' + ROW[0])
        return 0
    io.open(TSV, 'w', encoding='utf-8').write(s)
    print('--- WRITTEN H（上游表行） ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())