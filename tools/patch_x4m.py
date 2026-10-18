#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4m.py — [v4.28.0 · R4-X4 收尾] 把「第二份标签表」收回内核。

本补丁修的是本版判据当场抓到的缺陷（A4 转红，不是推演）：
  `_canonRevokeBlock` 里手写了一份撤销四表的名字与顺序
  （可撤 / 别批（别人接的）/ 手工补的（绝不动）/ 后来加的），
  而内核 BC_REVOKE_LABEL 里本来就有这四张表的**唯一一份**名字 ——
  两处各写一份，内核加表或改词那天视图会静默漏一格（本仓最贵的形态之一）。
  同族：四档决定的名字与顺序也只在核心里一份，视图此前一处都没列出来。

三处改动（本仓「同名同序只许一份」纪律）：
  ① apps/archive/archive-canon.js：import BC_REVOKE_BUCKETS + 新增 revokeBuckets()
     （表名的**唯一出处**转手）；
  ② apps/archive/archive-app.js：新增出口 canonRevokeBuckets()（视图经它取）；
  ③ apps/archive/archive-view.js：_canonClashBlock 按内核 id 列出四档名字
     （此前一个都没列），_canonRevokeBlock 改为按内核表名逐格报出，
     删掉视图自己那份手写表名表。

幂等：三处锚点各恰中 1 次，且以「已含新形态」为前置判据（重复执行即 abort）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

WIRE = 'apps/archive/archive-canon.js'
APP = 'apps/archive/archive-app.js'
VIEW = 'apps/archive/archive-view.js'


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


def main():
    wire = rd(WIRE)
    app = rd(APP)
    view = rd(VIEW)

    # ── ① 接线件：表名出处 + 转手方法 ─────────────────────────────
    assert 'revokeBuckets' not in wire, 'WIRE already patched (abort)'
    wire = once(wire,
                '    BC_UNMAPPED_LABEL,' + NL + '    BC_REVOKE_LABEL,',
                '    BC_UNMAPPED_LABEL,' + NL + '    BC_REVOKE_BUCKETS,' + NL + '    BC_REVOKE_LABEL,',
                'WIRE-import')
    wire = once(wire,
                "    revokeLabel(v) { return BC_REVOKE_LABEL[v] || String(v == null ? '' : v); }" + NL,
                "    revokeLabel(v) { return BC_REVOKE_LABEL[v] || String(v == null ? '' : v); }" + NL
                + "    /** 撤销四张表的**表名与顺序**的唯一出处（视图不写第二份表名表）。 */" + NL
                + "    revokeBuckets() { return BC_REVOKE_BUCKETS.slice(); }" + NL,
                'WIRE-method')

    # ── ② App：出口（视图经它取，不直呼内核） ─────────────────────
    assert 'canonRevokeBuckets' not in app, 'APP already patched (abort)'
    app = once(app,
               "    canonRevokeLabel(v) {" + NL
               + "        try { return this.canon.revokeLabel(v); } catch (_e) { return String(v == null ? '' : v); }" + NL
               + "    }" + NL,
               "    canonRevokeLabel(v) {" + NL
               + "        try { return this.canon.revokeLabel(v); } catch (_e) { return String(v == null ? '' : v); }" + NL
               + "    }" + NL
               + "    /** 撤销四张表的表名出处（**唯一出处是内核**，视图不写第二份表名表） */" + NL
               + "    canonRevokeBuckets() {" + NL
               + "        try { return this.canon.revokeBuckets(); } catch (_e) { return []; }" + NL
               + "    }" + NL,
               'APP-outlet')

    # ── ③ 视图：四档名字按内核 id 列 + 撤销四表按内核表名报 ────────
    assert 'canonRevokeBuckets' not in view, 'VIEW already patched (abort)'
    view = once(view,
                "        parts.push(this._sec('冲突位 ' + String(rows.length) + ' 个'," + NL
                + "            '「两条终结声明」与「取值不同」不同形 —— 选中的成为正史，其余留痕'));" + NL
                + "        if (!rows.length) {",
                "        parts.push(this._sec('冲突位 ' + String(rows.length) + ' 个'," + NL
                + "            '「两条终结声明」与「取值不同」不同形 —— 选中的成为正史，其余留痕'));" + NL
                + "        /* ★ 四档决定的**名字与顺序只在核心里一份**：这里按内核给的 id 逐档列出，" + NL
                + "         *   视图不写第二份顺序表 —— 写了就会在内核加档那天静默错位。" + NL
                + "         *   （此前视图一档都没列：用户看不到「除了定为正史还有什么可选」。） */" + NL
                + "        const decs = app.canonDecisionIds();" + NL
                + "        if (decs.length) {" + NL
                + "            const legend = [];" + NL
                + "            for (let d = 0; d < decs.length; d++) legend.push(app.canonDecisionLabel(decs[d]));" + NL
                + "            parts.push('<div class=\"arc-sec-note\">可选的 ' + String(decs.length)" + NL
                + "                + ' 档：' + this._esc(legend.join(' / ')) + '</div>');" + NL
                + "        }" + NL
                + "        if (!rows.length) {",
                'VIEW-legend')
    view = once(view,
                "        const buckets = [" + NL
                + "            ['可撤', rv.revocable]," + NL
                + "            ['别批（别人接的）', rv.keptForeign]," + NL
                + "            ['手工补的（绝不动）', rv.keptManual]," + NL
                + "            ['后来加的', rv.keptLater]" + NL
                + "        ];",
                "        /* ★ 四张表的**表名与顺序只在核心里一份**（经 app.canonRevokeBuckets() 取），" + NL
                + "         *   视图不写第二份表名表 —— 写了就会在内核加表那天静默漏一格。" + NL
                + "         *   （此前这里手写了一整份四表表名，与内核 BC_REVOKE_LABEL 是同一件事的" + NL
                + "         *     第二个实现 —— 表名一个都不许留在视图里，连注释里也不留。） */" + NL
                + "        const names = app.canonRevokeBuckets();" + NL
                + "        const buckets = [];" + NL
                + "        for (let b = 0; b < names.length; b++) buckets.push([app.canonRevokeLabel(names[b]), rv[names[b]]]);",
                'VIEW-buckets')
    # 手写表名必须一个不剩（判据 A4/C5 的真值来源）
    for lit in ['别批（别人接的）', '手工补的（绝不动）', '后来加的']:
        assert lit not in view, 'view still carries hand-written bucket label: ' + lit

    print('--- patch_x4m: 3 files, 4 anchors (all hit exactly 1) ---')
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    wr(WIRE, wire)
    wr(APP, app)
    wr(VIEW, view)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
