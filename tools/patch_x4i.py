#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4i.py — [v4.28.0 · R4-X4 补丁 I] 本仓跨仓登记行补 lonsha.branchCanon

落点：config/crossrepo-registry.js 的 CROSSREPO_FEATURES，插在 lonsha.causalChain
条目之后（保持「按接入时间就近追加」的既有次序）。

十五格口径（与上游 open_face_registry.tsv 的 branchCanon 行逐格对齐）：
  · since 必须与上游 producer_version **归一后逐字相同**（上游 `v3.342.0` ↔ 本仓 `3.342.0`），
    否则 tests/audit 的 R4 会报「两侧指着不同版本说你的版太低」；
  · declaredConsumer / declaredFloor 必须与本门 J21 标签逐字一致（R5 判同仓两处）；
  · keySites 的 token 必须是真源码里真出现的读取点（A2 判）；
  · consumers 的 token 必须是产品面真出现的消费点（A3 判）；
  · sinceSource 以「上游 」起头（A5：本仓不留档上游版本，如实标出处）。
"""
import io
import sys

REG = '/home/user/ruby-phone/config/crossrepo-registry.js'
WRITE = '--write' in sys.argv
NL = chr(10)

ANCHOR = """        upstreamFace: 'causalChain',
        declaredConsumer: 'readCausalBoard',
        declaredFloor: 1
    },
"""

ROW = """    {
        id: 'lonsha.branchCanon',
        label: '支线结局接续（选哪条成为正史 / 其余支线留痕 / 撤销只撤本次接续）',
        owner: OWNER_LONSHA,
        since: '3.342.0',
        sinceSource: '上游 lonsha-memory-plugin/branch-canon.js（v3.342.0 M4-X3）与 index.js 的 branchCanonState / branchCanonPlan / branchCanonPreview / branchCanonRevoke / storyCanonAdoptPlan / storyCanonAdoption / storyCanonRevokeGuard / storyCanonAdoptConfirm 出口；证据在上游真源与 open_face_registry.tsv 的 face=branchCanon 行（该行上游在 v3.342.0 漏登，本版三处同批补齐）',
        fieldKeys: [],
        contract: '引擎方法 / 模块出口两路：`engine.branchCanonState(opts)` 或 `LonShaBranchCanon.build(sources, opts)`，返回 kind=branch_canon 的读数（rows[] / counts / version / malformedInput / writesNothing / degraded）；每冲突位带 key / verdict / branches[] / titles[] / terminalCount / decision。★ 选择计划走 `engine.branchCanonPlan(opts)`，chosen|coexisted|excluded|pending **四档分列**、provenance 覆盖每一条结局（未被选中的历史必须留痕）；★ 交接预览走 `engine.branchCanonPreview(opts)`，只读不给凭据；★ 落卷面走 `engine.storyCanonAdoptPlan(opts)` / `storyCanonAdoption(opts)`，verdict 三态 ready|blocked|empty **不许压平**（blocked 与 empty 处置相反：一个回去选、一个去补结局条文），unmapped 缺格三因 no-face|no-owner|no-key 分列；★ 撤销走 `engine.branchCanonRevoke(opts)` 或 `storyCanonRevokeGuard(opts)`，revocable|keptForeign|keptManual|keptLater 四表分列、deletesManual 与 branchWrites 写成读数（**撤销只撤本次接续，原分支原文不动**）；★ 唯一有写动作的是 `storyCanonAdoptConfirm(opts)`，归上游 owner',
        keySites: [
            { file: 'config/branch-canon-contract.js', token: 'eng.branchCanonState' }
        ],
        consumers: [
            { file: 'apps/archive/archive-canon.js', token: 'readBranchCanonState(' }
        ],
        invalidation: '插件不在场 / 模块未加载 ⇒ engine-absent（等装插件）；插件在、本版无此面（上游降级面 version=0）⇒ face-absent（等升级到 v3.342.0+）；出口在但调用抛错 / judged:false 装配未到 / degraded / malformedInput ⇒ unusable（本机读不出，**不是**「两条结局没有冲突」）；没给要落卷的范围 ⇒ no-scope（**不是**「这次接续没事可做」）；真跑过、一个冲突位都没有 ⇒ empty（**真读数**）——五态处置相反，压平即把「还没装插件」显示成「这批结局没有冲突」',
        standalone: '未装上游 ⇒ 存档台照常出卡（包页/面貌/重置/台账是本仓自己的），但第五页签「支线结局」如实标不在场，**不退回本地猜一份选择**；三态与四表原样端出，**不替用户拍板哪条故事更好**（零写盘，writesNothing 恒 true）——分卷写入与撤销归上游 owner，手机端只把上游给的凭据经 storyCanonAdoptConfirm 原样转交',
        upstreamFace: 'branchCanon',
        declaredConsumer: 'readBranchCanonState',
        declaredFloor: 1
    },
"""


def main():
    s = io.open(REG, encoding='utf-8').read()
    if "id: 'lonsha.branchCanon'" in s:
        print('· 已存在 lonsha.branchCanon 登记行，跳过')
        return 0
    n = s.count(ANCHOR)
    if n != 1:
        print('!! 锚点命中 ' + str(n) + ' 次（须恰好 1 次），abort')
        return 1
    s = s.replace(ANCHOR, ANCHOR + ROW, 1)
    if not WRITE:
        print('--- DRY RUN（补 --write 才落盘） ---')
        print('  将在 lonsha.causalChain 之后插入 lonsha.branchCanon（15 格）')
        return 0
    io.open(REG, 'w', encoding='utf-8').write(s)
    print('--- WRITTEN I（本仓登记行） ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
