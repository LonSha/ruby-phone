#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4j.py — [v4.28.0 · R4-X4 补丁 J] 桥门禁补 J21（支线结局接续面）

落点：scripts/bridge-contract-audit.mjs，八段（J21 的八处接线），
逐段锚点唯一即写盘，任一段失配即 abort（不改文件）。

为什么 J21 必须有（与 J19/J20 同族）：
  上游 v3.342.0（M4-X3）交付正史落卷面（branch-canon.js），它答的是「哪条支线结局
  成为后续正史」——立身之本含 **三态不许压平**（blocked 与 empty 处置相反）、
  **四档分列**（chosen|coexisted|excluded|pending）、**撤销只撤本次接续**（四表 +
  deletesManual / branchWrites 写成读数）。上游当时**漏登外供表**，本仓消费者侧
  此前同样零命中；本版三处同批补上（上游表行 / 本仓 registry 登记行 / 本门标签）。

判据口径（与 J19/J20 逐条同形）：
  ① 真源 config/branch-canon-contract.js 必须导出该四出口；
  ② 产品面 apps/** 的消费点不得少于下限 1。写 1 不留余量是刻意的 ——
     少一个就意味着这一面又回到零消费（「建好不消费」第十八例的入口）。
  ③ 标签 [face: branchCanon] [reader: readBranchCanonState] [floor: 1]
     与上游表行 consumer 列逐字一致（下游 R5 判这一条）。
"""
import io
import sys

GATE = '/home/user/ruby-phone/scripts/bridge-contract-audit.mjs'
WRITE = '--write' in sys.argv

SEGS = []

# ── 段 1：J21 标签 + 常量（插在 J20 常量之后） ──
SEGS.append((
    "const CAUSAL_MIN_CONSUMERS = 1;\n",
    """const CAUSAL_MIN_CONSUMERS = 1;
/* ── [v4.28.0 · R4-X4] J21：上游支线结局接续面（branchCanon）必须真被业务面消费 ──
 * 【为什么必须有】上游在 v3.342.0（M4-X3）交付正史落卷面（`branch-canon.js`），它答的是
 *   「哪条支线结局成为后续正史、其余支线怎么留痕」——立身之本含**三态不许压平**
 *   （ready|blocked|empty；blocked 与 empty 处置相反：一个回去选、一个去补结局条文）、
 *   **选择计划四档分列**（chosen|coexisted|excluded|pending + provenance 覆盖每条结局）、
 *   **撤销四表分列**（revocable|keptForeign|keptManual|keptLater）且 deletesManual /
 *   branchWrites 写成读数（撤销只撤本次接续，原分支原文不动）。
 *   而这一面**上游当时漏登外供表**（`open_face_registry.tsv` 此前只登记到 testimonyBoard），
 *   本仓 `grep -RIn 'branchCanon' apps config`（消费者侧）此前同样零命中。
 *   v4.28.0 的 R4-X4 把它接上：三处同批落地（上游补表行 / 本仓 registry 登记行 / 本门标签）。
 * 【判据口径】① 真源 config/branch-canon-contract.js 必须导出该四出口；
 *   ② 产品面 apps/** 的消费点不得少于下限 1。写 1 不留余量是刻意的 ——
 *   少一个就意味着这一面又回到零消费。
 *   ③ 标签 [face: branchCanon] 与上游表行 consumer 列逐字一致（下游 R5 判这一条）。 */
const BRANCH_CANON_READER = 'readBranchCanonState';
/* [face: branchCanon] [reader: readBranchCanonState] [floor: 1] */
const BRANCH_CANON_SOURCE_REL = 'config/branch-canon-contract.js';
const BRANCH_CANON_MIN_CONSUMERS = 1;
""",
))

# ── 段 2：真源四出口 ──
SEGS.append((
    """const causalExportsOk = [CAUSAL_READER, 'readCausalTodos', 'readCausalTrace', 'readCausalProposals']
    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(causalCode) }));
""",
    """const causalExportsOk = [CAUSAL_READER, 'readCausalTodos', 'readCausalTrace', 'readCausalProposals']
    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(causalCode) }));
/* ── [v4.28.0 · R4-X4] J21：支线结局接续面的真源四出口 + 产品侧消费点 ── */
const branchCanonCode = stripped.get(BRANCH_CANON_SOURCE_REL) || '';
const branchCanonExportsOk = [BRANCH_CANON_READER, 'readBranchCanonPlan', 'readBranchCanonAdopt', 'readBranchCanonRevokeGuard']
    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(branchCanonCode) }));
""",
))

# ── 段 3：计数器声明 ──
SEGS.append((
    """let causalConsumerCount = 0;
const causalConsumerFiles = [];
""",
    """let causalConsumerCount = 0;
const causalConsumerFiles = [];
let branchCanonConsumerCount = 0;
const branchCanonConsumerFiles = [];
""",
))

# ── 段 4：消费点计数 ──
SEGS.append((
    """    const c6 = countOf(code, CAUSAL_READER + '(');
    if (c6 > 0) { causalConsumerCount += c6; causalConsumerFiles.push(rel); }
""",
    """    const c6 = countOf(code, CAUSAL_READER + '(');
    if (c6 > 0) { causalConsumerCount += c6; causalConsumerFiles.push(rel); }
    /* [v4.28.0 · R4-X4] 支线结局接续面的产品侧消费点（只数 apps/**）。 */
    const c7 = countOf(code, BRANCH_CANON_READER + '(');
    if (c7 > 0) { branchCanonConsumerCount += c7; branchCanonConsumerFiles.push(rel); }
""",
))

# ── 段 5：--list 报告行 ──
SEGS.append((
    """    console.log('\\n── J20 ' + CAUSAL_READER + ' 消费点（只计 apps/**）：' + causalConsumerCount + '（下限 ' + CAUSAL_MIN_CONSUMERS + '）──');
""",
    """    console.log('\\n── J20 ' + CAUSAL_READER + ' 消费点（只计 apps/**）：' + causalConsumerCount + '（下限 ' + CAUSAL_MIN_CONSUMERS + '）──');
    console.log('\\n── J21 ' + BRANCH_CANON_READER + ' 消费点（只计 apps/**）：' + branchCanonConsumerCount + '（下限 ' + BRANCH_CANON_MIN_CONSUMERS + '）──');
    for (const f of branchCanonConsumerFiles) console.log('  ' + f);
    if (!branchCanonConsumerFiles.length) console.log('  （无 —— 上游支线结局面没人读，「选哪条成为正史」就只能靠猜）');
    for (const x of branchCanonExportsOk) console.log('  ' + (x.ok ? '·' : 'x') + ' 真源出口 ' + x.fn);
""",
))

# ── 段 6：判定块（插在 J20 判定块之后、`if (corrupt)` 之前） ──
SEGS.append((
    """if (corrupt) process.exit(2);
""",
    """/* ── J21 [v4.28.0 · R4-X4] 支线结局接续面：真源出口 + 产品侧消费点（下游这半边） ── */
const missingBranchCanonExports = branchCanonExportsOk.filter((x) => !x.ok).map((x) => x.fn);
if (missingBranchCanonExports.length) {
    corrupt = 1;
    console.error('[bridge-contract] x J21 真源 ' + BRANCH_CANON_SOURCE_REL + ' 缺出口（' + missingBranchCanonExports.length + ' 个）：' + missingBranchCanonExports.join(' / '));
}
if (branchCanonConsumerCount < BRANCH_CANON_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J21 ' + BRANCH_CANON_READER + ' 只有 ' + branchCanonConsumerCount + ' 个产品侧消费点（下限 ' + BRANCH_CANON_MIN_CONSUMERS + '）：');
    for (const f of branchCanonConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 M4-X3（v3.342.0）把「选哪条支线结局成为后续正史 / 其余怎么留痕 / 撤销只撤本次接续」');
    console.error('        做成对外读面（三态 ready|blocked|empty 不许压平 + 四档分列 + 撤销四表分列），');
    console.error('        并已由本版在 open_face_registry.tsv 按 face=branchCanon 补登记 consumer=readBranchCanonState@1；');
    console.error('        下游零消费 ⇒ 「选定的那条成为正史」在用户侧不成立，互斥结局仍会同时进新卷。');
    console.error('  修法：手机侧接 config/branch-canon-contract.js 的 ' + BRANCH_CANON_READER + '。');
}
if (corrupt) process.exit(2);
""",
))

# ── 段 7：尾部汇总行 ──
SEGS.append((
    """console.log('[bridge-contract] ' + CAUSAL_READER + ' 消费点 ' + causalConsumerCount + ' 个（' + causalConsumerFiles.length + ' 文件，下限 ' + CAUSAL_MIN_CONSUMERS + '）· 真源四出口在场 ' + (causalExportsOk.every((x) => x.ok) ? '是' : '否'));
""",
    """console.log('[bridge-contract] ' + CAUSAL_READER + ' 消费点 ' + causalConsumerCount + ' 个（' + causalConsumerFiles.length + ' 文件，下限 ' + CAUSAL_MIN_CONSUMERS + '）· 真源四出口在场 ' + (causalExportsOk.every((x) => x.ok) ? '是' : '否'));
console.log('[bridge-contract] ' + BRANCH_CANON_READER + ' 消费点 ' + branchCanonConsumerCount + ' 个（' + branchCanonConsumerFiles.length + ' 文件，下限 ' + BRANCH_CANON_MIN_CONSUMERS + '）· 真源四出口在场 ' + (branchCanonExportsOk.every((x) => x.ok) ? '是' : '否'));
""",
))

# ── 段 8：收尾那句「各面被消费」清单 ──
SEGS.append((
    """/ 因果线索与未完事项被业务面消费');
process.exit(0);
""",
    """/ 因果线索与未完事项被业务面消费 / 支线结局接续被业务面消费');
process.exit(0);
""",
))


def main():
    s = io.open(GATE, encoding='utf-8').read()
    if 'BRANCH_CANON_READER' in s:
        print('· 已存在 J21（BRANCH_CANON_READER），跳过')
        return 0
    bad = 0
    for i, (a, b) in enumerate(SEGS):
        n = s.count(a)
        print('  段 ' + str(i + 1) + ' 锚点命中 ' + str(n) + ' 次')
        if n != 1:
            bad += 1
    if bad:
        print('!! ' + str(bad) + ' 段锚点失配，abort（文件未改）')
        return 1
    for a, b in SEGS:
        s = s.replace(a, b, 1)
    if not WRITE:
        print('--- DRY RUN（补 --write 才落盘） ---')
        return 0
    io.open(GATE, 'w', encoding='utf-8').write(s)
    print('--- WRITTEN J（桥门禁 J21） ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())