# -*- coding: utf-8 -*-
"""v4.27.0 · R4-X6 收口补丁 A：
  ① config/crossrepo-registry.js 补登记行 lonsha.causalChain（上游表行已在，属「补齐下游两处」）
  ② scripts/bridge-contract-audit.mjs 新增 J20（因果线索面的真源四出口 + 产品侧消费点下限）
  ③ 两份台账同步：causalChain 从未消费台账移出（已消费），进滞后台账（上游账面仍写 none@0）
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


# ---------------------------------------------------------------- ① registry 登记行
REG_REL = 'config/crossrepo-registry.js'
reg = rd(REG_REL)
A1 = ("        upstreamFace: 'testimonyBoard',\n"
      "        declaredConsumer: 'readTestimonyBoard',\n"
      "        declaredFloor: 1\n"
      "    },\n")
ROW = ("""    {
        id: 'lonsha.causalChain',
        label: '因果线索与未完事项（未结约定 / 伏笔 / 已收口 / 仅推测）',
        owner: OWNER_LONSHA,
        since: '3.323.0',
        sinceSource: '上游 lonsha-memory-plugin/causal-chain.js（v3.323.0 M3-X3）与 index.js 的 causalChainGraph / causalChainTodos / causalChainTrace / causalChainProposals 四出口；证据在上游真源与 open_face_registry.tsv 的 face=causalChain 行（该行上游早已登记，本版补的是**下游两处**：本登记行与本门 J20 标签）',
        fieldKeys: [],
        contract: '引擎方法 / 模块出口两路：`engine.causalChainGraph(opts)` 或 `LonShaCausalChain.build(sources, opts)`，返回 kind=causal_chain 的读数（nodes[] / edges[] / speculative[] / unresolved[] / resolved[] / cancelled[] / broken[] / counts / truncated / malformedInput / writesNothing / degraded）。★ **推测边与已确认边是两个数组**（结构上不可混读，并入 edges 即等于把「猜的」当「有据的」）；★ 四收口 resolved|cancelled|broken|unresolved **分列**（合成一格就分不出「不用再提」与「还没做」）；★ 追溯走 `engine.causalChainTrace(id, opts)`，**只走已确认边**，图外 id ⇒ known=false + reason=not-in-graph（**不是**「追到了头」）；★ 候选边走 `engine.causalChainProposals(opts)`，恒为推测、手机端不替用户确认',
        keySites: [
            { file: 'config/causal-board-contract.js', token: 'eng.causalChainGraph' }
        ],
        consumers: [
            { file: 'apps/plotline/plotline-board.js', token: 'readCausalBoard(' }
        ],
        invalidation: '插件不在场 / 模块未加载 ⇒ engine-absent（等装插件）；插件在、本版无此面（上游降级面 version=0）⇒ face-absent（等升级到 v3.323.0+）；出口在但调用抛错 / malformedInput / degraded ⇒ unusable（本机读不出，**不是**「这条线没有前因」）；没给要追的起点 ⇒ no-subject（**不是**「追到头了」，更不许默认挑一条线）；真跑过、图里零节点 ⇒ empty（**真读数**）——五态处置相反，压平即把「还没装插件」显示成「故事里没有任何线索」',
        standalone: '未装上游 ⇒ 剧情线页照常出卡（大纲/承诺/支线是本仓自己的），但因果板如实标不在场，**不退回本地猜一份因果**；四收口与推测边原样端出，**不替用户标已解决**（零写面，writesNothing 恒 true）——「提醒过」不等于「履约」，确认与收口动作归上游 owner',
        upstreamFace: 'causalChain',
        declaredConsumer: 'readCausalBoard',
        declaredFloor: 1
    },
""")
reg = once(reg, A1, A1 + ROW, 'registry row')
wr(REG_REL, reg)

# ---------------------------------------------------------------- ② 门禁 J20
GATE_REL = 'scripts/bridge-contract-audit.mjs'
g = rd(GATE_REL)

# ②-1 常量与面标签
A2 = ("const TESTIMONY_READER = 'readTestimonyBoard';\n"
      "/* [face: testimonyBoard] [reader: readTestimonyBoard] [floor: 1] */\n"
      "const TESTIMONY_SOURCE_REL = 'config/perspective-contrast-contract.js';\n"
      "const TESTIMONY_MIN_CONSUMERS = 1;\n")
J20_DECL = ("""/* \u2500\u2500 [v4.27.0 \u00b7 R4-X6] J20\uff1a\u4e0a\u6e38\u56e0\u679c\u7ebf\u7d22\u9762\uff08causalChain\uff09\u5fc5\u987b\u771f\u88ab\u4e1a\u52a1\u9762\u6d88\u8d39 \u2500\u2500
 * \u3010\u4e3a\u4ec0\u4e48\u5fc5\u987b\u6709\u3011\u4e0a\u6e38\u5728 v3.323.0\uff08M3-X3\uff09\u4ea4\u4ed8\u4e86\u56e0\u679c\u94fe\u9762\uff08`causal-chain.js`\uff09\uff0c\u5b83\u7b54\u7684\u662f
 *   \u300c\u8fd9\u4ef6\u4e8b\u662f\u600e\u4e48\u6765\u7684\u300d\u4e0e\u300c\u54ea\u4e9b\u7ea6\u5b9a/\u4f0f\u7b14\u8fd8\u6ca1\u6536\u53e3\u300d\u2014\u2014\u7acb\u8eab\u4e4b\u672c\u542b**\u63a8\u6d4b\u8fb9\u4e0e\u5df2\u786e\u8ba4\u8fb9\u5206\u4e24\u4e2a\u6570\u7ec4**
 *   \uff08\u7ed3\u6784\u4e0a\u4e0d\u53ef\u6df7\u8bfb\uff09\u3001**\u56db\u6536\u53e3\u5206\u5217**\uff08resolved|cancelled|broken|unresolved\uff09\u3001
 *   **\u56fe\u5916 id \u8ffd\u94fe\u4e0e\u300c\u8ffd\u5230\u5934\u300d\u4e0d\u540c\u5f62**\uff08\u524d\u8005 known=false + reason=not-in-graph\uff09\u3002
 *   \u800c\u8fd9\u4e00\u9762\u5728\u672c\u4ed3 `grep -RIn 'causalChain' apps config`\uff08\u6d88\u8d39\u8005\u4fa7\uff09\u6b64\u524d\u96f6\u547d\u4e2d\uff1b
 *   \u672c\u4ed3\u5bf9\u5b83\u7684\u552f\u4e00\u58f0\u660e\u662f\u672a\u6d88\u8d39\u7406\u7531\u53f0\u8d26\u91cc\u90a3\u53e5\u300c\u624b\u673a\u4fa7\u7684\u6d88\u8d39\u70b9\u5c5e R3-X4 \u7684\u540e\u7eed\u589e\u5f3a\u300d\u2014\u2014
 *   \u90a3\u662f**\u58f0\u660e**\uff0c\u800c\u4e0d\u662f\u5224\u636e\u3002v4.27.0 \u7684 R4-X6 \u628a\u5b83\u63a5\u4e0a\uff08\u4e0a\u6e38\u8868\u884c\u65e9\u5df2\u5728\uff0c\u6545\u672c\u7248\u8865\u7684\u662f
 *   **\u4e0b\u6e38\u4e24\u5904**\uff1a\u672c\u4ed3 registry \u767b\u8bb0\u884c + \u672c\u95e8\u6807\u7b7e\uff09\u3002
 * \u3010\u5224\u636e\u53e3\u5f84\u3011\u2460 \u771f\u6e90 config/causal-board-contract.js \u5fc5\u987b\u5bfc\u51fa\u8be5\u56db\u51fa\u53e3\uff1b
 *   \u2461 \u4ea7\u54c1\u9762 apps/** \u7684\u6d88\u8d39\u70b9\u4e0d\u5f97\u5c11\u4e8e\u4e0b\u9650 1\u3002\u5199 1 \u4e0d\u7559\u4f59\u91cf\u662f\u523b\u610f\u7684 \u2014\u2014
 *   \u5c11\u4e00\u4e2a\u5c31\u610f\u5473\u7740\u8fd9\u4e00\u9762\u53c8\u56de\u5230\u96f6\u6d88\u8d39\uff08\u300c\u5efa\u597d\u4e0d\u6d88\u8d39\u300d\u7b2c\u5341\u4e03\u4f8b\u7684\u5165\u53e3\uff09\u3002
 *   \u2462 \u6807\u7b7e [face: causalChain] \u4e0e\u4e0a\u6e38\u8868\u884c consumer \u5217\u540c\u4e00\u53e3\u5f84\uff08\u4e0b\u6e38 R5 \u5224\u8fd9\u4e00\u6761\uff09\u3002 */
const CAUSAL_READER = 'readCausalBoard';
/* [face: causalChain] [reader: readCausalBoard] [floor: 1] */
const CAUSAL_SOURCE_REL = 'config/causal-board-contract.js';
const CAUSAL_MIN_CONSUMERS = 1;
""")
g = once(g, A2, A2 + J20_DECL, 'gate J20 decl')

# ②-2 真源出口校验
A3 = ("const testimonyExportsOk = [TESTIMONY_READER, 'readTestimonyRevoke', 'testimonyLine', 'pcxSelfCheck']\n"
      "    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(testimonyCode) }));\n")
J20_EXP = ("/* \u2500\u2500 [v4.27.0 \u00b7 R4-X6] J20\uff1a\u56e0\u679c\u7ebf\u7d22\u9762\u7684\u771f\u6e90\u56db\u51fa\u53e3 + \u4ea7\u54c1\u4fa7\u6d88\u8d39\u70b9 \u2500\u2500 */\n"
           "const causalCode = stripped.get(CAUSAL_SOURCE_REL) || '';\n"
           "const causalExportsOk = [CAUSAL_READER, 'readCausalTodos', 'readCausalTrace', 'readCausalProposals']\n"
           "    .map((fn) => ({ fn, ok: new RegExp('export\\\\s+function\\\\s+' + fn + '\\\\s*\\\\(').test(causalCode) }));\n")
g = once(g, A3, A3 + J20_EXP, 'gate J20 exports')

# ②-3 计数器声明
A4 = ("let testimonyConsumerCount = 0;\n"
      "const testimonyConsumerFiles = [];\n")
g = once(g, A4, A4 + "let causalConsumerCount = 0;\nconst causalConsumerFiles = [];\n", 'gate J20 counters')

# ②-4 计数循环
A5 = ("    /* [v4.26.0 \u00b7 R4-X5] \u8bc1\u8bcd\u9762\u7684\u4ea7\u54c1\u4fa7\u6d88\u8d39\u70b9\uff08\u53ea\u6570 apps/**\uff09\u3002 */\n"
      "    const c5 = countOf(code, TESTIMONY_READER + '(');\n"
      "    if (c5 > 0) { testimonyConsumerCount += c5; testimonyConsumerFiles.push(rel); }\n")
g = once(g, A5, A5 + ("    /* [v4.27.0 \u00b7 R4-X6] \u56e0\u679c\u7ebf\u7d22\u9762\u7684\u4ea7\u54c1\u4fa7\u6d88\u8d39\u70b9\uff08\u53ea\u6570 apps/**\uff09\u3002 */\n"
                      "    const c6 = countOf(code, CAUSAL_READER + '(');\n"
                      "    if (c6 > 0) { causalConsumerCount += c6; causalConsumerFiles.push(rel); }\n"), 'gate J20 loop')

# ②-5 --list 输出
A6 = ("    console.log('\\n\u2500\u2500 J19 ' + TESTIMONY_READER + ' \u6d88\u8d39\u70b9\uff08\u53ea\u8ba1 apps/**\uff09\uff1a' + testimonyConsumerCount + '\uff08\u4e0b\u9650 ' + TESTIMONY_MIN_CONSUMERS + '\uff09\u2500\u2500');\n")
g = once(g, A6, A6 + ("    console.log('\\n\u2500\u2500 J20 ' + CAUSAL_READER + ' \u6d88\u8d39\u70b9\uff08\u53ea\u8ba1 apps/**\uff09\uff1a' + causalConsumerCount + '\uff08\u4e0b\u9650 ' + CAUSAL_MIN_CONSUMERS + '\uff09\u2500\u2500');\n"
                      "    for (const f of causalConsumerFiles) console.log('  ' + f);\n"
                      "    if (!causalConsumerFiles.length) console.log('  \uff08\u65e0 \u2014\u2014 \u4e0a\u6e38\u56e0\u679c\u9762\u6ca1\u4eba\u8bfb\uff0c\u300c\u8fd9\u6761\u7ebf\u600e\u4e48\u6765\u7684\u300d\u5c31\u53ea\u80fd\u9760\u731c\uff09');\n"
                      "    for (const x of causalExportsOk) console.log('  ' + (x.ok ? '\u00b7' : 'x') + ' \u771f\u6e90\u51fa\u53e3 ' + x.fn);\n"), 'gate J20 list')

# ②-6 fail-closed 判定
A7 = "if (corrupt) process.exit(2);\n"
J20_FAIL = ("""/* \u2500\u2500 J20 [v4.27.0 \u00b7 R4-X6] \u56e0\u679c\u7ebf\u7d22\u9762\uff1a\u771f\u6e90\u51fa\u53e3 + \u4ea7\u54c1\u4fa7\u6d88\u8d39\u70b9\uff08\u4e0b\u6e38\u8fd9\u534a\u8fb9\uff09 \u2500\u2500 */
const missingCausalExports = causalExportsOk.filter((x) => !x.ok).map((x) => x.fn);
if (missingCausalExports.length) {
    corrupt = 1;
    console.error('[bridge-contract] x J20 \u771f\u6e90 ' + CAUSAL_SOURCE_REL + ' \u7f3a\u51fa\u53e3\uff08' + missingCausalExports.length + ' \u4e2a\uff09\uff1a' + missingCausalExports.join(' / '));
}
if (causalConsumerCount < CAUSAL_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J20 ' + CAUSAL_READER + ' \u53ea\u6709 ' + causalConsumerCount + ' \u4e2a\u4ea7\u54c1\u4fa7\u6d88\u8d39\u70b9\uff08\u4e0b\u9650 ' + CAUSAL_MIN_CONSUMERS + '\uff09\uff1a');
    for (const f of causalConsumerFiles) console.error('    ' + f);
    console.error('  \u8bf4\u660e\uff1a\u4e0a\u6e38 M3-X3\uff08v3.323.0\uff09\u628a\u300c\u56e0\u679c\u94fe\u63a8\u5bfc\u4e0e\u5019\u9009\u8fb9\u4e0e\u56de\u6eaf\u300d\u505a\u6210\u5bf9\u5916\u8bfb\u9762');
    console.error('        \uff08\u56db\u6536\u53e3\u5206\u5217 + \u63a8\u6d4b\u8fb9\u4e0e\u5df2\u786e\u8ba4\u8fb9\u4e24\u4e2a\u6570\u7ec4 + \u56fe\u5916 id \u8ffd\u94fe\u4e0e\u300c\u8ffd\u5230\u5934\u300d\u4e0d\u540c\u5f62\uff09\uff0c');
    console.error('        \u4e0b\u6e38\u96f6\u6d88\u8d39 \u21d2 \u300c\u672a\u7ed3\u7ea6\u5b9a / \u5df2\u89e3\u51b3\u4f0f\u7b14 / \u4ec5\u63a8\u6d4b\u56e0\u679c\u300d\u5728\u624b\u673a\u4e0a\u540c\u5f62\uff0c\u800c\u4e09\u8005\u5904\u7f6e\u76f8\u53cd');
    console.error('        \uff08\u524d\u8005\u8981\u53bb\u505a / \u4e2d\u8005\u4e0d\u5fc5\u518d\u63d0 / \u540e\u8005\u4e0d\u80fd\u5f53\u4e8b\u5b9e\uff09\u3002');
    console.error('  \u4fee\u6cd5\uff1a\u624b\u673a\u4fa7\u63a5 config/causal-board-contract.js \u7684 ' + CAUSAL_READER + '\u3002');
}
""")
g = once(g, A7, J20_FAIL + A7, 'gate J20 fail')

# ②-7 汇总行
A8 = ("console.log('[bridge-contract] ' + TESTIMONY_READER + ' \u6d88\u8d39\u70b9 ' + testimonyConsumerCount + ' \u4e2a\uff08' + testimonyConsumerFiles.length + ' \u6587\u4ef6\uff0c\u4e0b\u9650 ' + TESTIMONY_MIN_CONSUMERS + '\uff09\u00b7 \u771f\u6e90\u56db\u51fa\u53e3\u5728\u573a ' + (testimonyExportsOk.every((x) => x.ok) ? '\u662f' : '\u5426') + '\uff09');\n")
g = once(g, A8, A8 + ("console.log('[bridge-contract] ' + CAUSAL_READER + ' \u6d88\u8d39\u70b9 ' + causalConsumerCount + ' \u4e2a\uff08' + causalConsumerFiles.length + ' \u6587\u4ef6\uff0c\u4e0b\u9650 ' + CAUSAL_MIN_CONSUMERS + '\uff09\u00b7 \u771f\u6e90\u56db\u51fa\u53e3\u5728\u573a ' + (causalExportsOk.every((x) => x.ok) ? '\u662f' : '\u5426') + '\uff09');\n"), 'gate J20 summary')

# ②-8 总述末句
A9 = "\u8bc1\u8bcd\u9762\u591a\u65b9\u8bf4\u6cd5\u88ab\u4e1a\u52a1\u9762\u6d88\u8d39');\n"
g = once(g, A9, "\u8bc1\u8bcd\u9762\u591a\u65b9\u8bf4\u6cd5\u88ab\u4e1a\u52a1\u9762\u6d88\u8d39 / \u56e0\u679c\u7ebf\u7d22\u4e0e\u672a\u5b8c\u4e8b\u9879\u88ab\u4e1a\u52a1\u9762\u6d88\u8d39');\n", 'gate J20 closing')
wr(GATE_REL, g)

# ---------------------------------------------------------------- ③ 台账同步
UNCONS_REL = 'tests/audit/upstream_face_unconsumed.json'
un = rd(UNCONS_REL)
OLD_KEY = '  "causalChain": "M3-X3 \u4ea4\u4ed8\u7684\u662f**\u4e0a\u6e38\u4fa7\u7684\u9762\u4e0e\u5951\u7ea6**(\u56e0\u679c\u94fe\u63a8\u5bfc\u4e0e\u5019\u9009\u4e0e\u56de\u6eaf),\u624b\u673a\u4fa7\u7684\u6d88\u8d39\u70b9\u5c5e R3-X4(\u8de8\u793e\u5a92\u540c\u4e00\u4e8b\u4ef6\u4e0e\u8206\u8bba\u6f14\u53d8)\u7684**\u540e\u7eed\u589e\u5f3a**,\u672c\u8f6e\u53ea\u843d\u5730\u4e86\u540c\u6e90\u4e8b\u4ef6\u7684\u8bdd\u9898\u9875\u4e0e\u53ef\u77e5\u8303\u56f4,\u6ca1\u6709\u63a5\u56e0\u679c\u94fe\u3002\u6545\u5982\u5b9e\u5199 none@0\u3002"\n'
assert un.count(OLD_KEY) == 1, 'unconsumed causalChain key must hit exactly 1'
un = un.replace(OLD_KEY, '')
un = once(un,
          '\u4ecd\u4e3a\u975e\u7a7a\u7684\u53ea\u5269 causalChain \u4e00\u9762\u3002"',
          '\u3010v4.27.0\u3011causalChain \u5df2\u7531 R4-X6\uff08\u53ef\u64cd\u4f5c\u7684\u7ebf\u7d22\u4e0e\u672a\u5b8c\u4e8b\u9879\u677f\uff09\u771f\u6d88\u8d39\uff0c\u6545\u4ece\u672c\u8868\u79fb\u51fa\u2014\u2014 \u5b83\u73b0\u5728\u8d70\u7684\u662f\u767b\u8bb0\u884c\u90a3\u4e00\u6761\u8def\uff08lonsha.causalChain + \u672c\u95e8 J20 \u7684 `[face: causalChain] [reader: readCausalBoard] [floor: 1]` \u6807\u7b7e\uff09\uff0c\u4e0a\u6e38\u8d26\u9762\u90a3\u4e00\u683c\u4ecd\u5199 none@0 \u21d2 \u5dee\u5f02\u843d\u8fdb upstream_face_lag.json\u3002\u672c\u8868\u6b64\u523b**\u7a7a\u8868\u662f\u771f\u8bfb\u6570**\u3002"',
          'unconsumed note')
wr(UNCONS_REL, un)

LAG_REL = 'tests/audit/upstream_face_lag.json'
lag = rd(LAG_REL)
A10 = '  "items": [\n'
NEW_ITEM = ("""  "items": [
    {
      "face": "causalChain",
      "kind": "consumer-none",
      "upSays": "none@0",
      "ourSays": "readCausalBoard@1",
      "upstreamCommit": "30feb80",
      "reason": "\u4e0a\u6e38\u5728 v3.323.0(M3-X3)\u4ea4\u4ed8\u8fd9\u4e00\u9762\u65f6\u5982\u5b9e\u5199 none@0(\u5f53\u65f6\u4e0b\u6e38\u786e\u5b9e\u4e00\u4e2a\u90fd\u4e0d\u6d88\u8d39),\u4e14\u672c\u4ed3 `upstream_face_unconsumed.json` \u91cc\u90a3\u4e00\u683c\u7684\u7406\u7531\u9010\u5b57\u5199\u7740\u300c\u624b\u673a\u4fa7\u7684\u6d88\u8d39\u70b9\u5c5e R3-X4 \u7684\u540e\u7eed\u589e\u5f3a\u300d\u2014\u2014 \u90a3\u6761\u7406\u7531\u5f53\u65f6\u662f\u5bf9\u7684\u3002\u672c\u4ed3 v4.27.0 \u7684 R4-X6(\u53ef\u64cd\u4f5c\u7684\u7ebf\u7d22\u4e0e\u672a\u5b8c\u4e8b\u9879\u677f)\u628a\u5b83\u63a5\u4e0a\u4e86:config/causal-board-contract.js \u7684 readCausalBoard / readCausalTodos / readCausalTrace / readCausalProposals \u56db\u51fa\u53e3\u771f\u8bfb\u8be5\u9762(\u56db\u6536\u53e3\u5206\u5217 / \u63a8\u6d4b\u8fb9\u4e0e\u5df2\u786e\u8ba4\u8fb9\u4e24\u4e2a\u6570\u7ec4\u4e0d\u53ef\u6df7\u8bfb / \u56fe\u5916 id \u8ffd\u94fe\u4e0e\u300c\u8ffd\u5230\u5934\u4e86\u300d\u4e0d\u540c\u5f62),\u6d88\u8d39\u70b9\u4e0b\u9650 1(\u767b\u8bb0\u884c lonsha.causalChain\u3001\u6865\u5951\u7ea6\u9762\u6807\u7b7e\u4e0e\u4e24\u4fa7\u9010\u5b57\u5bf9\u9f50)\u3002\u6545\u4e0a\u6e38\u90a3\u4e00\u683c\u5df2\u9648\u65e7 \u2014\u2014 \u5b83\u9700\u8981\u5728\u4e0b\u4e00\u6b21\u66f4\u65b0\u81ea\u5df1\u7684 consumer \u5217\u65f6\u6539\u5199\u3002\u4e0a\u6e38\u4e00\u63d0\u4ea4,\u672c\u6761\u7acb\u523b\u53d8\u6210\u300c\u767b\u8bb0\u4e86\u4e0d\u5b58\u5728\u7684\u5206\u6b67\u300d\u800c\u8f6c\u7ea2 \u2014\u2014 \u90a3\u6b63\u662f\u53f0\u8d26\u53cc\u5411\u95ed\u5408\u7684\u7528\u610f:\u5b83\u4e0d\u8bb8\u8150\u5316\u6210\u63a9\u9970\u3002"
    },
""")
lag = once(lag, A10, NEW_ITEM, 'lag item')
wr(LAG_REL, lag)

print('DONE A')
