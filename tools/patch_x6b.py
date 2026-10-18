# -*- coding: utf-8 -*-
"""v4.27.0 · R4-X6 收口补丁 B：门禁 J20 + 两份台账同步。
（补丁 A 已落 registry 登记行；本补丁只做剩余三处。）
锚点纪律：每步写盘前 count == 1；全部锚点在**同一份内存串**上顺序替换，中途不重读文件。
"""
import io
import os

ROOT = '/home/user/ruby-phone'


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, s):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


GATE_REL = 'scripts/bridge-contract-audit.mjs'
g = rd(GATE_REL)

# ---- ① 常量与面标签 ----
A2 = ("const TESTIMONY_READER = 'readTestimonyBoard';\n"
      "/* [face: testimonyBoard] [reader: readTestimonyBoard] [floor: 1] */\n"
      "const TESTIMONY_SOURCE_REL = 'config/perspective-contrast-contract.js';\n"
      "const TESTIMONY_MIN_CONSUMERS = 1;\n")
J20_DECL = """/* ── [v4.27.0 · R4-X6] J20：上游因果线索面（causalChain）必须真被业务面消费 ──
 * 【为什么必须有】上游在 v3.323.0（M3-X3）交付了因果链面（`causal-chain.js`），它答的是
 *   「这件事是怎么来的」与「哪些约定/伏笔还没收口」——立身之本含**推测边与已确认边分两个数组**
 *   （结构上不可混读）、**四收口分列**（resolved|cancelled|broken|unresolved）、
 *   **图外 id 追链与「追到头」不同形**（前者 known=false + reason=not-in-graph）。
 *   而这一面在本仓 `grep -RIn 'causalChain' apps config`（消费者侧）此前零命中；
 *   本仓对它唯一的声明是未消费理由台账里那句「手机侧的消费点属 R3-X4 的后续增强」——
 *   那是**声明**，而不是判据。v4.27.0 的 R4-X6 把它接上（上游表行早已在，故本版补的是
 *   **下游两处**：本仓 registry 登记行 + 本门标签）。
 * 【判据口径】① 真源 config/causal-board-contract.js 必须导出该四出口；
 *   ② 产品面 apps/** 的消费点不得少于下限 1。写 1 不留余量是刻意的 ——
 *   少一个就意味着这一面又回到零消费（「建好不消费」第十七例的入口）。
 *   ③ 标签 [face: causalChain] 与上游表行 consumer 列同一口径（下游 R5 判这一条）。 */
const CAUSAL_READER = 'readCausalBoard';
/* [face: causalChain] [reader: readCausalBoard] [floor: 1] */
const CAUSAL_SOURCE_REL = 'config/causal-board-contract.js';
const CAUSAL_MIN_CONSUMERS = 1;
"""
g = once(g, A2, A2 + J20_DECL, 'gate J20 decl')

# ---- ② 真源四出口校验 ----
A3 = ("const testimonyExportsOk = [TESTIMONY_READER, 'readTestimonyRevoke', 'testimonyLine', 'pcxSelfCheck']\n"
      "    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(testimonyCode) }));\n")
J20_EXP = ("/* ── [v4.27.0 · R4-X6] J20：因果线索面的真源四出口 + 产品侧消费点 ── */\n"
           "const causalCode = stripped.get(CAUSAL_SOURCE_REL) || '';\n"
           "const causalExportsOk = [CAUSAL_READER, 'readCausalTodos', 'readCausalTrace', 'readCausalProposals']\n"
           "    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(causalCode) }));\n")
g = once(g, A3, A3 + J20_EXP, 'gate J20 exports')

# ---- ③ 计数器声明 ----
A4 = "let testimonyConsumerCount = 0;\nconst testimonyConsumerFiles = [];\n"
g = once(g, A4, A4 + "let causalConsumerCount = 0;\nconst causalConsumerFiles = [];\n", 'gate J20 counters')

# ---- ④ 计数循环 ----
A5 = ("    const c5 = countOf(code, TESTIMONY_READER + '(');\n"
      "    if (c5 > 0) { testimonyConsumerCount += c5; testimonyConsumerFiles.push(rel); }\n")
g = once(g, A5, A5 + ("    /* [v4.27.0 · R4-X6] 因果线索面的产品侧消费点（只数 apps/**）。 */\n"
                      "    const c6 = countOf(code, CAUSAL_READER + '(');\n"
                      "    if (c6 > 0) { causalConsumerCount += c6; causalConsumerFiles.push(rel); }\n"), 'gate J20 loop')

# ---- ⑤ --list 输出 ----
A6 = "    console.log('\\n── J19 ' + TESTIMONY_READER + ' 消费点（只计 apps/**）：' + testimonyConsumerCount + '（下限 ' + TESTIMONY_MIN_CONSUMERS + '）──');\n"
g = once(g, A6, A6 + ("    console.log('\\n── J20 ' + CAUSAL_READER + ' 消费点（只计 apps/**）：' + causalConsumerCount + '（下限 ' + CAUSAL_MIN_CONSUMERS + '）──');\n"
                      "    for (const f of causalConsumerFiles) console.log('  ' + f);\n"
                      "    if (!causalConsumerFiles.length) console.log('  （无 —— 上游因果面没人读，「这条线怎么来的」就只能靠猜）');\n"
                      "    for (const x of causalExportsOk) console.log('  ' + (x.ok ? '·' : 'x') + ' 真源出口 ' + x.fn);\n"), 'gate J20 list')

# ---- ⑥ fail-closed 判定 ----
A7 = "if (corrupt) process.exit(2);\n"
J20_FAIL = """/* ── J20 [v4.27.0 · R4-X6] 因果线索面：真源出口 + 产品侧消费点（下游这半边） ── */
const missingCausalExports = causalExportsOk.filter((x) => !x.ok).map((x) => x.fn);
if (missingCausalExports.length) {
    corrupt = 1;
    console.error('[bridge-contract] x J20 真源 ' + CAUSAL_SOURCE_REL + ' 缺出口（' + missingCausalExports.length + ' 个）：' + missingCausalExports.join(' / '));
}
if (causalConsumerCount < CAUSAL_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J20 ' + CAUSAL_READER + ' 只有 ' + causalConsumerCount + ' 个产品侧消费点（下限 ' + CAUSAL_MIN_CONSUMERS + '）：');
    for (const f of causalConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 M3-X3（v3.323.0）把「因果链推导与候选边与回溯」做成对外读面');
    console.error('        （四收口分列 + 推测边与已确认边两个数组 + 图外 id 追链与「追到头」不同形），');
    console.error('        下游零消费 ⇒ 「未结约定 / 已解决伏笔 / 仅推测因果」在手机上同形，而三者处置相反');
    console.error('        （前者要去做 / 中者不必再提 / 后者不能当事实）。');
    console.error('  修法：手机侧接 config/causal-board-contract.js 的 ' + CAUSAL_READER + '。');
}
"""
g = once(g, A7, J20_FAIL + A7, 'gate J20 fail')

# ---- ⑦ 汇总行（整行锚点，插在 J19 汇总行之后）----
A8_FULL = "console.log('[bridge-contract] ' + TESTIMONY_READER + ' 消费点 ' + testimonyConsumerCount + ' 个（' + testimonyConsumerFiles.length + ' 文件，下限 ' + TESTIMONY_MIN_CONSUMERS + '）· 真源四出口在场 ' + (testimonyExportsOk.every((x) => x.ok) ? '是' : '否'));"
J20_SUM = "console.log('[bridge-contract] ' + CAUSAL_READER + ' 消费点 ' + causalConsumerCount + ' 个（' + causalConsumerFiles.length + ' 文件，下限 ' + CAUSAL_MIN_CONSUMERS + '）· 真源四出口在场 ' + (causalExportsOk.every((x) => x.ok) ? '是' : '否'));"
g = once(g, A8_FULL, A8_FULL + "\n" + J20_SUM, 'gate J20 summary')

# ---- ⑧ 总述末句 ----
A9 = "证词面多方说法被业务面消费');\n"
g = once(g, A9, "证词面多方说法被业务面消费 / 因果线索与未完事项被业务面消费');\n", 'gate J20 closing')

wr(GATE_REL, g)
print('gate OK')

# ---- ⑨ 未消费台账：causalChain 移出 ----
UN = 'tests/audit/upstream_face_unconsumed.json'
un = rd(UN)
OLD_KEY = '  "causalChain": "M3-X3 交付的是**上游侧的面与契约**(因果链推导与候选与回溯),手机侧的消费点属 R3-X4(跨社媒同一事件与舆论演变)的**后续增强**,本轮只落地了同源事件的话题页与可知范围,没有接因果链。故如实写 none@0。"\n'
assert un.count(OLD_KEY) == 1, 'unconsumed key anchor'
un = un.replace(OLD_KEY, '')
un = once(un,
          '仍为非空的只剩 causalChain 一面。"',
          '【v4.27.0】causalChain 已由 R4-X6（可操作的线索与未完事项板）真消费，故从本表移出—— 它现在走的是登记行那一条路（lonsha.causalChain + 本门 J20 的 `[face: causalChain] [reader: readCausalBoard] [floor: 1]` 标签），上游账面那一格仍写 none@0 ⇒ 差异落进 upstream_face_lag.json。本表此刻**空表是真读数**。"',
          'unconsumed note')
wr(UN, un)
print('unconsumed OK')

# ---- ⑩ 滞后台账：新增 causalChain 一条 ----
LAG = 'tests/audit/upstream_face_lag.json'
lag = rd(LAG)
A10 = '  "items": [\n'
NEW_ITEM = '''  "items": [
    {
      "face": "causalChain",
      "kind": "consumer-none",
      "upSays": "none@0",
      "ourSays": "readCausalBoard@1",
      "upstreamCommit": "30feb80",
      "reason": "上游在 v3.323.0(M3-X3)交付这一面时如实写 none@0(当时下游确实一个都不消费),且本仓 upstream_face_unconsumed.json 里那一格的理由逐字写着「手机侧的消费点属 R3-X4 的后续增强」—— 那条理由当时是对的。本仓 v4.27.0 的 R4-X6(可操作的线索与未完事项板)把它接上了:config/causal-board-contract.js 的 readCausalBoard / readCausalTodos / readCausalTrace / readCausalProposals 四出口真读该面(四收口分列 / 推测边与已确认边两个数组不可混读 / 图外 id 追链与「追到头了」不同形),消费点下限 1(登记行 lonsha.causalChain、桥契约面标签与两侧逐字对齐)。故上游那一格已陈旧 —— 它需要在下一次更新自己的 consumer 列时改写。上游一提交,本条立刻变成「登记了不存在的分歧」而转红 —— 那正是台账双向闭合的用意:它不许腐化成掩饰。"
    },
'''
lag = once(lag, A10, NEW_ITEM, 'lag item')
wr(LAG, lag)
print('DONE B')