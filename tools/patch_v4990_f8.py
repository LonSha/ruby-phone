#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4990_f8.py — 把 R11-O4 的真产物 doc-path-claim-audit 接进门禁链。

真正的缺陷（不是台账数字问题）：
  `scripts/doc-path-claim-audit.mjs` 早在 R11-O4 就落盘了（151 行 + 403 行 baseline），
  `tests/system-v4980.test.mjs` 的 B 组也真 import 它并真跑它，但它**从没进过任何门禁链**：
    · package.json 里没有 `doc-path-claim` 这个 npm 脚本；
    · scripts.check 链上没有它；
    · config/gate-tiers.json 静态档没有它；
    · config/gate-budget.json 没有它的预算；
    · scripts/check-file.mjs 的 READS 没有它的主读数。
  于是 F8 报 `static_gate_files 17 !== tiers.static.commands.length 16` —— F8 的判据是
  **「台账静态门文件数 == 分档表静态档条目数」**，17 个门文件里恰好那一个没进分档表。
  ★ 这正是本仓纪律点名的形态：**一段没人跑到过的代码等于不存在**。
    它比「坏了」更坏 —— 坏了会响，没接线永远不响（只有 F8 这条旁证判据替它响了）。
  ★ 修法必须是把**产物**接进去，不是把**数字**改小：改 gen_status_ledger 的过滤口径
    （比如把 `*-audit.mjs` 排除掉）能让 F8 变绿，但那是**把判据改瞎**换来的绿。

本补丁只做接线六件事（每件事都带锚点恰中 1 次的断言）：
  ① package.json 加 `doc-path-claim` 脚本；
  ② scripts.check 链在 `upstream-face` **之前**插入它（尾锚不变量：链以 upstream-face 收尾）；
  ③ config/gate-tiers.json 静态档按链序插到同一位，并把 why 里的「这十六道门」改成实际数；
  ④ config/gate-budget.json 按链序插一条预算（limit_ms 由 margin_pct 自算，total_ms 重算）；
  ⑤ scripts/check-file.mjs 的 READS 补登记主读数（不登记 ⇒ 执行器 exit 2 拒判）；
  ⑥ CONTEXT.md 的门链转写按链序插名并把「十七道」改「十八道」（C4 逐位核名与顺序）。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

NPM_NAME = 'doc-path-claim'
GATE_FILE = 'scripts/doc-path-claim-audit.mjs'
ANCHOR_GATE = 'upstream-face'   # 新门只能插在它之前（链尾不变量）
# 预算实测：单跑 1.07~1.14s（三次），取 1150ms（四舍五入到 50）
BUDGET_MS = 1150
BUDGET_WHY = ('文档路径声明门要 walk 全仓 3522 处 tests/scripts/tools 形态的路径声明并逐条'
              '查磁盘存在性，扫描面与语法门同量级但每处多一次 path.join + existsSync；'
              '慢下来通常意味着扫描面被扩到 node_modules，或 skipFiles 白名单被误删。')


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


def detect_indent(rel):
    s = rd(rel)
    lines = s.split(NL)
    if len(lines) < 2:
        return 2
    n = len(lines[1]) - len(lines[1].lstrip(' '))
    return n if 0 < n <= 8 else 2


def dump(rel, obj):
    return json.dumps(obj, ensure_ascii=False, indent=detect_indent(rel)) + NL


def patch_pkg():
    rel = 'package.json'
    pkg = json.loads(rd(rel))
    assert NPM_NAME not in pkg['scripts'], '脚本已存在（幂等检查）：' + NPM_NAME
    chain = pkg['scripts']['check']
    # ② 插链：upstream-face 之前
    old_tail = 'npm run hardlink-safety && npm run upstream-face'
    new_tail = 'npm run hardlink-safety && npm run %s && npm run upstream-face' % NPM_NAME
    assert chain.count(old_tail) == 1, chain
    pkg['scripts']['check'] = chain.replace(old_tail, new_tail, 1)
    # ① 加脚本别名（放在 upstream-face 那行之后，保持同一族相邻）
    items = list(pkg['scripts'].items())
    out = {}
    for k, v in items:
        out[k] = v
        if k == 'upstream-face':
            out[NPM_NAME] = 'node ' + GATE_FILE
    assert NPM_NAME in out
    pkg['scripts'] = out
    # 顺序自证：链上 doc-path-claim 的下一个必须是 upstream-face
    seq = [s.strip().replace('npm run ', '') for s in pkg['scripts']['check'].split('&&')]
    i = seq.index(NPM_NAME)
    assert seq[i + 1] == ANCHOR_GATE, seq[i:i + 2]
    assert seq[-1] == ANCHOR_GATE, seq[-3:]
    return dump(rel, pkg), len(seq)


def patch_tiers(n_chain):
    rel = 'config/gate-tiers.json'
    doc = json.loads(rd(rel))
    cmds = doc['tiers']['static']['commands']
    assert 'npm run ' + NPM_NAME not in cmds, '静态档已含本门（幂等）'
    # ★ 插入位不是「末尾前一位」：静态档最后两条是 `node scripts/…` 形态
    #   （named-import-check / screen-host-check），而 `npm run upstream-face` 在**倒数第三位**。
    #   链序不变量只对 `npm run …` 段成立（v4940 F7 的 chainOrder 就是按「两边都有的段」比的，
    #   两条 node 形态天然不进那个交集）—— 故插入点取 `npm run upstream-face` 的下标。
    anchor = 'npm run ' + ANCHOR_GATE
    assert anchor in cmds, cmds
    at = cmds.index(anchor)
    cmds.insert(at, 'npm run ' + NPM_NAME)
    # ③ why 里的数量词必须改成实际数（「这十六道门」→「这十七道门」）
    old_why_count = '这十六道门回答'
    assert doc['tiers']['static']['why'].count(old_why_count) == 1, doc['tiers']['static']['why'][:60]
    doc['tiers']['static']['why'] = doc['tiers']['static']['why'].replace(
        old_why_count, '这十七道门回答', 1)
    assert len(cmds) == 17, len(cmds)
    assert cmds[cmds.index('npm run ' + NPM_NAME) + 1] == anchor, cmds[at:at + 2]
    return dump(rel, doc), len(cmds)


def patch_budget():
    rel = 'config/gate-budget.json'
    doc = json.loads(rd(rel))
    gates = doc['gates']
    assert NPM_NAME not in gates, '预算表已含本门（幂等）'
    margin = doc['margin_pct']
    # ④ 按链序重建：新门插在 upstream-face 之前
    new_gates = {}
    for k, v in gates.items():
        if k == ANCHOR_GATE:
            new_gates[NPM_NAME] = {
                'ms': BUDGET_MS,
                'limit_ms': round(BUDGET_MS * (1 + margin / 100.0)),
                'why': BUDGET_WHY,
            }
        new_gates[k] = v
    assert NPM_NAME in new_gates
    doc['gates'] = new_gates
    total = sum(g['ms'] for g in new_gates.values())
    doc['total_ms'] = total
    return dump(rel, doc), len(new_gates), total


READS_BLOCK = """    /* ── [v4.99.0 · F8 修复] 第十七道门：文档路径声明（R11-O4 的真产物）。
     *   ★ 这道门的**产物早就在盘上**（151 行 + 403 行 baseline），也从没进过任何门禁链 ——
     *     于是它所看守的「散文声称有判据 / 文件其实不在」这一整面，只在
     *     tests/system-v4980.test.mjs 里被套件跑，**不参与 `npm run check`**。
     *     F8 的 `static_gate_files 17 !== tiers.static.commands.length 16` 正是替它响的那一声：
     *     17 个门文件里恰好这一个没进分档表。修的是接线，不是数字。 */
    'doc-path-claim': [
        { id: 'claims', label: '扫描到的路径声明数', re: /共扫描 (\\d+) 处声明/, g: 1 },
        { id: 'local', label: '本仓有效声明数', re: /本仓 (\\d+) 处/, g: 1 },
        { id: 'upstream', label: '上游合法声明数', re: /上游 (\\d+) 处/, g: 1 },
        /* ★ 这条读数是**这门存在的全部理由**：未登记落空数必须为 0。
         *   非 0 时门自己会 exit 1；此处登记它是为了让 check:file 的汇总行
         *   在**全绿那次**也能读到「0」——「没红」与「没读数」不是一回事。 */
        { id: 'violations', label: '未登记落空声明', re: /(\\d+) 未登记落空/, g: 1 }
    ],
"""


def patch_checkfile():
    rel = 'scripts/check-file.mjs'
    src = rd(rel)
    assert "'doc-path-claim': [" not in src, 'READS 已登记本门（幂等）'
    anchor = "    'upstream-face': ["
    assert src.count(anchor) == 1, src.count(anchor)
    src = src.replace(anchor, READS_BLOCK + anchor, 1)
    assert src.count("'doc-path-claim': [") == 1
    return src


def patch_context():
    rel = 'CONTEXT.md'
    doc = rd(rel)
    assert '`doc-path-claim`' not in doc, 'CONTEXT.md 已列本门（幂等）'
    old = '**十七道子门**串联：'
    assert doc.count(old) == 1, doc.count(old)
    doc = doc.replace(old, '**十八道子门**串联：', 1)
    old_tail = '`hardlink-safety` → `upstream-face`'
    assert doc.count(old_tail) == 1, doc.count(old_tail)
    doc = doc.replace(old_tail, '`hardlink-safety` → `doc-path-claim` → `upstream-face`', 1)
    # 尾锚说明跟上（原文写「新门插在它之前」——本门正是照此插入的，把这次实例记上）
    marker = '故新门插在它**之前**而不是追加到末尾 —— 这条是踩过的：一版曾把新门追加到链尾，当场被两条判据抓红。'
    assert doc.count(marker) == 1, doc.count(marker)
    doc = doc.replace(marker, marker + NL +
                      '  > 【本行再次订正 · v4.99.0】新增第十七段 `doc-path-claim`（`scripts/doc-path-claim-audit.mjs`：'
                      'R11-O4 的文档路径存活审计），故本行由「十七道」改「**十八道**」。'
                      '★ 这一次的来由值得留档：那道门的产物早就在盘上、套件也早就在跑它，'
                      '**但它从没进过 check 链** —— 于是 F8「台账静态门文件数 == 分档表静态档条目数」'
                      '报 `17 !== 16`，那一声就是替它响的（没接线的代码不会自己响）。', 1)
    return doc


def main():
    pkg_txt, n_chain = patch_pkg()
    tiers_txt, n_static = patch_tiers(n_chain)
    budget_txt, n_budget, total = patch_budget()
    cf_txt = patch_checkfile()
    ctx_txt = patch_context()
    print('[f8] chain=%d static=%d budget=%d total_ms=%d' % (n_chain, n_static, n_budget, total))
    assert n_chain == 18, n_chain
    assert n_static == 17, n_static
    assert n_budget == 18, n_budget
    # 三处同序自证：链（去掉 test）/ 静态档 / 预算表 三者除去 test 必须逐位一致
    pkg = json.loads(pkg_txt)
    seq = [s.strip().replace('npm run ', '') for s in pkg['scripts']['check'].split('&&')]
    budget_seq = list(json.loads(budget_txt)['gates'].keys())
    # ★ 预算表含 `test`（它是最贵的一门，必须计费）⇒ 与**整条链**逐位对齐；
    #   而分档表静态档**不含 test**（判据门归定向档）⇒ 与链去掉 test 后逐位对齐。
    #   两者不是一回事，首版脚本正是把它们混成一个比对，被自己的断言当场拦下。
    assert seq == budget_seq, (seq, budget_seq)
    # ★ 静态档的比对**只比交集、按链序**，不要求「静态档是链的投影」——
    #   静态档尾部合法地留着两条 `node scripts/…` 形态的门（named-import / screen-host），
    #   它们不在 check 链里。这个口径不是我自己定的，是 v4940 F7 既有的那一句：
    #     chainOrder = chain.filter(c => staticCmds.includes(c))
    #     必须 == staticCmds.filter(c => chain.includes(c))
    #   ★ 首版补丁在此处写成「静态档去掉 test 必须与链逐位相同」，当场被自己的断言拦下 ——
    #     那正是本仓治过的形态：**把时点快照当成永久约束**（同族：v3201 A4 把链逐字钉死）。
    raw_chain = [s.strip() for s in pkg['scripts']['check'].split('&&')]
    raw_cmds = json.loads(tiers_txt)['tiers']['static']['commands']
    chain_order = [c for c in raw_chain if c in raw_cmds]
    cmd_order = [c for c in raw_cmds if c in raw_chain]
    assert chain_order == cmd_order, (chain_order, cmd_order)
    # 新增段必须在三处同现（链 / 静态档 / 预算表），且都在 upstream-face 之前
    # 三处写法不同（链是 `npm run X`、静态档是 `npm run X` 或 `node scripts/X-check.mjs`、
    # 预算表是裸键 X）—— 故先归一成裸名再比，否则会拿名字去撞带前缀的串而假红。
    bare = lambda xs: [x.replace('npm run ', '').replace('node scripts/', '').replace('.mjs', '')
                       .replace('-check', '').replace('-audit', '') for x in xs]
    for where, xs in (('chain', seq), ('static', raw_cmds), ('budget', budget_seq)):
        bs = bare(xs)
        want = NPM_NAME.replace('-audit', '').replace('-check', '')
        assert want in bs, (where, bs)
        assert bs.index(want) < bs.index(ANCHOR_GATE), (where, bs[-4:])
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    wr('package.json', pkg_txt)
    wr('config/gate-tiers.json', tiers_txt)
    wr('config/gate-budget.json', budget_txt)
    wr('scripts/check-file.mjs', cf_txt)
    wr('CONTEXT.md', ctx_txt)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
