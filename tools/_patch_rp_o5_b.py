#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o5_b.py — R-O5 第二刀：索引阶段可作废（默认关）+ 段位读数。

修前实测真缺口：`searchAll()` 阶段一只让出、**不查取消**。长会话下索引阶段是
最贵的一段（10000 楼要建 10000 条对象），用户在等待期点「取消」要等整段建完
才被受理；作废后读数还把 indexLen 报成全量。

本刀加一条**默认关**的取消路径：
  · `searchAll(..., { cancelIndex: true })` 时才在索引片间查 `isCancelled()`；
  · 作废即 `gen.return()`（触发生成器 finally，落「已建部分」的记账），
    返回 `indexed: all.length` / `scanned: 0` / `scope.cancelledAt: 'index'`。

为什么默认关（不是懒，是契约）：`isCancelled` 的调用计数被
tests/system-v3170 B5 锁死（第 4 次检查 = 已扫 6000 条）。默认插检查点会挪动它。
「既有调用方与判据一字不改」由「默认关」保证，而不是靠改判据迁就实现。

附带一处**位置**改动：`cancelledNow` 的定义从阶段一下方提到 `searchAll` 开头。
为什么必须提：索引阶段在它之前执行，不提就得另写一份同款谓言（本仓最忌
「同一口径两份实现」）。位置改了，**行为一字未改**（谓言体逐字照搬）。

纪律：锚点逐字相符且恰中 1 次；只写一个文件；默认 dry-run。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/memory/global-search-engine.js'
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
    src = rd(REL)

    # ── ① 文档 + 签名 + 谓言上提 + 索引阶段开关（一整段唯一锚点） ──
    A_BIG = ('     * @param {{limit?:number, sourceIds?:string[], full?:boolean,' + NL
             + '     *          onProgress?:Function, isCancelled?:Function}} [opts]' + NL
             + '     * @returns {Promise<object>} 与同步路径同形的结果体' + NL
             + '     */' + NL
             + '    async searchAll(query, opts = {}) {' + NL
             + '        const q = norm(query);' + NL
             + '        const limit = Math.max(1, Number(opts.limit) || 60);' + NL
             + '        const full = opts.full === true;' + NL
             + '        const allow = Array.isArray(opts.sourceIds) && opts.sourceIds.length' + NL
             + '            ? new Set(opts.sourceIds.map(String))' + NL
             + '            : null;' + NL
             + '        const weightOf = {};' + NL
             + '        for (const s of this._sources) weightOf[s.id] = s.weight;' + NL
             + '        const hits = [];' + NL
             + '        const scannedBySource = {};' + NL
             + '        const cancelledNow = () => {' + NL
             + "            try { return typeof opts.isCancelled === 'function' && !!opts.isCancelled(); } catch (_e) { return false; }" + NL
             + '        };' + NL
             + '        /* ══ 阶段一：建索引（可让出，不与同步路径分家） ══ */' + NL
             + '        const all = [];' + NL
             + '        const gen = this._indexChunks({ full: full, sink: all });' + NL
             + '        while (true) {' + NL
             + '            const step = gen.next();' + NL
             + '            if (step.done) break;' + NL)
    NEW_BIG = ('     * @param {{limit?:number, sourceIds?:string[], full?:boolean,' + NL
               + '     *          onProgress?:Function, isCancelled?:Function,' + NL
               + '     *          cancelIndex?:boolean}} [opts]' + NL
               + '     *   `cancelIndex`（[v3.75.0 + R-O5]，默认 false）为真时，索引片间也受理作废；' + NL
               + '     *   默认关是**契约**（见阶段一注释：调用计数被 tests/system-v3170 B5 锁死）。' + NL
               + '     * @returns {Promise<object>} 与同步路径同形的结果体' + NL
               + '     */' + NL
               + '    async searchAll(query, opts = {}) {' + NL
               + '        const q = norm(query);' + NL
               + '        const limit = Math.max(1, Number(opts.limit) || 60);' + NL
               + '        const full = opts.full === true;' + NL
               + '        const allow = Array.isArray(opts.sourceIds) && opts.sourceIds.length' + NL
               + '            ? new Set(opts.sourceIds.map(String))' + NL
               + '            : null;' + NL
               + '        const weightOf = {};' + NL
               + '        for (const s of this._sources) weightOf[s.id] = s.weight;' + NL
               + '        const hits = [];' + NL
               + '        const scannedBySource = {};' + NL
               + '        /* [v3.75.0 + R-O5] 取消谓言提到开头：索引阶段（阶段一）也要能看到它。' + NL
               + '         *   原来它定义在阶段一下方 —— 索引阶段在它之前执行，那时函数还没定义' + NL
               + '         *   （不改位置就只能另写一份，而本仓最忌「同一口径两份实现」）。' + NL
               + '         *   位置改了，**行为一字未改**（谓言体逐字照搬）。 */' + NL
               + '        const cancelledNow = () => {' + NL
               + "            try { return typeof opts.isCancelled === 'function' && !!opts.isCancelled(); } catch (_e) { return false; }" + NL
               + '        };' + NL
               + '        /* ══ 阶段一：建索引（可让出；可选地在片间受理作废） ══' + NL
               + '         * [v3.75.0 + R-O5] `opts.cancelIndex === true` 时才在索引片间查取消谓言。' + NL
               + '         *   为什么**默认关**：`isCancelled` 的调用计数是既有判据的契约' + NL
               + '         *   （tests/system-v3170 B5 锁「第 4 次检查 = 已扫 6000 条」），默认插检查点' + NL
               + '         *   会挪动它 —— 「既有调用方与判据一字不改」由「默认关」保证，' + NL
               + '         *   而不是靠改判据来迁就实现。' + NL
               + '         *   为什么必须**有**这条路径：索引阶段是长会话最贵的一段（10000 楼要建' + NL
               + '         *   10000 条对象），此前用户在等待期点「取消」要等整段建完才被受理。' + NL
               + '         *   作废时如实报 `indexed`（已建部分）与 `scanned: 0`（一条都没比中过）。 */' + NL
               + '        const cancelIndex = opts.cancelIndex === true;' + NL
               + '        const all = [];' + NL
               + '        const gen = this._indexChunks({ full: full, sink: all });' + NL
               + '        while (true) {' + NL
               + '            const step = gen.next();' + NL
               + '            if (step.done) break;' + NL)
    src = once(src, A_BIG, NEW_BIG, 'doc-signature-phase1')

    # ── ② 索引片间受理作废（默认关） ──
    A_P1B = ('            await this._yieldTurn();' + NL
             + '        }' + NL
             + '        /* ══ 阶段二：分片比中（检查点原位，片后让出） ══ */' + NL)
    NEW_P1B = ('            await this._yieldTurn();' + NL
               + '            if (cancelIndex && cancelledNow()) {' + NL
               + '                /* 索引阶段被作废：**不建完**。`gen.return()` 触发生成器的 finally，' + NL
               + '                 *   于是 `_lastScan.indexed` 与 `_errors` 落的是**已建部分**的真记账' + NL
               + '                 *   （防「取消之后读数还停在上一轮」那类不报错、只错数的形态）。 */' + NL
               + '                gen.return();' + NL
               + '                return {' + NL
               + "                    query: '', results: [], groups: [], total: 0, scanned: 0," + NL
               + '                    indexed: all.length, errors: this._errors.slice(), cancelled: true,' + NL
               + "                    scope: this._scope(full, { coverage: { scannedBySource: {}, pending: all.length, complete: false, cancelledAt: 'index' } }, all.length)" + NL
               + '                };' + NL
               + '            }' + NL
               + '        }' + NL
               + '        /* ══ 阶段二：分片比中（检查点原位，片后让出） ══ */' + NL)
    src = once(src, A_P1B, NEW_P1B, 'phase1-cancel')

    assert 'cancelIndex' in src and "cancelledAt: 'index'" in src
    assert src.count('const cancelledNow = () => {') == 1, 'cancelledNow 不得出现两份'
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        print('target = ' + REL)
        return 0
    wr(REL, src)
    print('--- WRITTEN --- ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())