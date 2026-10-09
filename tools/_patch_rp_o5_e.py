#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o5_e.py — R-O5 第五刀：pending 三态（未知不报 0）+ 端到端启用。

两件事：

① `_scope.pending` 加**第三态** `null`（未知不报 0）。
   索引阶段被作废时「还剩多少没建」**不可得** —— 引擎只知道已建了多少。
   此前只能给个数（给 0 被读成「没有剩余」，给已建量被读成「还剩这么多」），
   两种都是把未知读成已知。本仓对「未知不报 0」一贯有硬口径，此处照办：
   `complete === false` 且 pending 不可得 ⇒ `null`。
   既有调用方行为不变：比中作废与完成态都仍传数字；同步路径无 coverage ⇒ 0。

② `search-app.js` 在全历史档调用 `searchAll` 时传 `cancelIndex: true`。
   没有这一步，索引阶段的可作废性只是内核里的备用分支，**用户在面板上点取消
   仍然要等整段索引建完** —— 那就不算交付（R-O5 治的正是「函数不让出、
   取消只在渲染层生效」）。引擎侧 `isCancelled` 的调用计数契约（v3170 B5）
   走的是**默认关**的直调路径，不受本条影响。

纪律：锚点逐字相符且恰中 1 次；写两个文件；默认 dry-run。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GSE = 'apps/memory/global-search-engine.js'
APP = 'apps/search/search-app.js'
WRITE = '--write' in sys.argv
NL = chr(10)


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
    # ── ① pending 三态 ──
    g = rd(GSE)
    A = "        const cov = (opts.coverage && typeof opts.coverage === 'object') ? opts.coverage : null;" + NL
    NEW = A \
        + '        /* [v3.75.0 + R-O5] pending 是**三态**：数字（已知）/ 0（真的没有剩余）' + NL \
        + '         *   / null（未知 —— 索引阶段被作废时「还剩多少没建」根本不可得）。' + NL \
        + '         *   为什么不能塌成 0：UI 读 `Number(pending) > 0`，0 会被显示成' + NL \
        + '         *   「没有剩余」，而事实是「不知道」—— 把未知读成已知正是本仓最贵的假绿。 */' + NL \
        + '        const pendingKnown = (cov && cov.pending != null) ? Number(cov.pending) : null;' + NL \
        + '        const pendingVal = Number.isFinite(pendingKnown) ? pendingKnown' + NL \
        + '            : ((cov && cov.complete === false) ? null : 0);' + NL
    g = once(g, A, NEW, 'pending-3state')

    A2 = '            pending: Number((cov && cov.pending) || 0),' + NL
    A2_NEW = '            pending: pendingVal,' + NL
    g = once(g, A2, A2_NEW, 'pending-use')
    # （索引阶段作废的 pending 已在补丁 b 里落成 `all.length`，此处只需把它改判为
    #   `null`：见下面的 A4。不在此处加"审计"步 —— 它的锚点与比中分支同形，不唯一。）
    A4 = "                    scope: this._scope(full, { coverage: { scannedBySource: {}, pending: all.length, complete: false, cancelledAt: 'index' } }, all.length)" + NL
    A4_NEW = "                    scope: this._scope(full, { coverage: { scannedBySource: {}, pending: null, complete: false, cancelledAt: 'index' } }, all.length)" + NL
    g = once(g, A4, A4_NEW, 'index-pending-null')


    # ── ② app 层端到端（带上下文，保证唯一） ──
    a = rd(APP)
    B = ("        const gen = ++this._scanGen;" + NL
         + "        this._scanning = true;" + NL
         + "        const self = this;" + NL
         + "        const p = Promise.resolve().then(() => this.engine.searchAll(kw, Object.assign({}, scopeOpt, {" + NL
         + "            full: true," + NL
         + "            onProgress: typeof opt.onProgress === 'function' ? opt.onProgress : null," + NL
         + "            isCancelled: self.cancelToken(gen)" + NL)
    B_NEW = ("        const gen = ++this._scanGen;" + NL
             + "        this._scanning = true;" + NL
             + "        const self = this;" + NL
             + "        const p = Promise.resolve().then(() => this.engine.searchAll(kw, Object.assign({}, scopeOpt, {" + NL
             + "            full: true," + NL
             + "            onProgress: typeof opt.onProgress === 'function' ? opt.onProgress : null," + NL
             + "            /* [v3.75.0 + R-O5] 索引阶段也受理作废：全历史档最贵的一段就是建索引" + NL
             + "             *   （10000 楼要建 10000 条对象）。不传这一格，用户在等待期点" + NL
             + "             *   「取消」要等整段建完才被受理 —— 那正是 R-O5 要治的形态。" + NL
             + "             *   引擎侧 `isCancelled` 调用计数契约（v3170 B5）走默认关的直调路径。 */" + NL
             + "            cancelIndex: true," + NL
             + "            isCancelled: self.cancelToken(gen)" + NL)
    a = once(a, B, B_NEW, 'app-cancelIndex')

    assert g.count('pendingVal') == 2 and 'cancelIndex: true' in a
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        print('targets = ' + GSE + ' , ' + APP)
        return 0
    wr(GSE, g)
    wr(APP, a)
    print('--- WRITTEN --- ' + GSE + ' , ' + APP)
    return 0


if __name__ == '__main__':
    sys.exit(main())