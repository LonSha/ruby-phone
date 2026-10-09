#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o5_a.py — R-O5 第一刀：取数耗时计入读数 + 已建条数 + 作废段位。

修前实测真缺口（都在 apps/memory/global-search-engine.js）：
  ① 源侧取数耗时**不在读数里**：`src.items()` 是一次同步物化（单源最多 20000 条），
     既不可中断、也从未被计时 ⇒ 「代价在源侧」只有定性没有定量（R-O5 第 3 条
     原文要求「必须计入耗时」）。
  ② 取消后 `scope.indexLen` 仍报全量（10000），读起来像「扫过了 10000 条」，
     而真正处置的是 0 条 —— 不报错、只错数。
  ③ 作废只有 `complete:false` 一处形状信息，分不清是索引阶段还是比中阶段被作废。

本刀只做读数面，**既有调用方与判据一字不改**（不新增取消点、不改任何分支条件）：
  · perSource[id].ms = 该源取数真实耗时（performance.now 优先）
  · _lastScan.indexed = 已建条数（被收束时反映「已建部分」）
  · scope.cancelledAt = null | 'match'（索引阶段的段位在第二刀补）

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

    A_NORM = ('function norm(s) {' + NL
              + "    return String(s ?? '').replace(/\\s+/g, ' ').trim();" + NL
              + '}' + NL)
    NEW_NORM = A_NORM + NL + '/**' + NL \
        + ' * [v3.75.0 + R-O5] 单调取时：优先 `performance.now()`（亚毫秒），退回 `Date.now()`。' + NL \
        + ' * 为什么不用 Date.now() 单独扛：它的 1ms 分辨率会把「单源 20000 条物化」这类真成本读成 0，' + NL \
        + ' *   于是「源侧代价」永远量不出来 —— 本版要立的正是这条读数（先量后定阈值）。' + NL \
        + ' * 与 `_yieldTurn` 同族：宿主能力走 globalThis 探测，缺了不抛、只降级。' + NL \
        + ' * @returns {number}' + NL \
        + ' */' + NL \
        + 'function nowMs() {' + NL \
        + "    const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : {};" + NL \
        + "    if (g.performance && typeof g.performance.now === 'function') return g.performance.now();" + NL \
        + '    return Date.now();' + NL \
        + '}' + NL
    src = once(src, A_NORM, NEW_NORM, 'nowMs')

    A_TAKE = ('                try {' + NL
              + '                    const raw = src.items() || [];' + NL
              + '                    if (!Array.isArray(raw)) continue;' + NL
              + '                    let n = 0;' + NL
              + '                    let bodyCapped = false;' + NL
              + '                    perSourceStat[src.id] = { raw: raw.length, indexed: 0, capped: false };' + NL)
    NEW_TAKE = ('                try {' + NL
                + '                    /* [v3.75.0 + R-O5] 取数耗时**计入读数**：源侧 `items()` 仍是一次同步物化' + NL
                + '                     *   （形态被 tests/system-v3170 A2 与 tests/system-v327 B1 锁死，不得前移截断），' + NL
                + '                     *   但它的代价不再是「看不见的成本」—— 逐源记进 perSource[id].ms。' + NL
                + '                     *   为什么必须记：R-O5 第 3 条原文要求「必须计入耗时」。没有这条读数，' + NL
                + '                     *   「要不要把截断前移到取数口」就只能靠感觉定。 */' + NL
                + '                    const takeT0 = nowMs();' + NL
                + '                    const raw = src.items() || [];' + NL
                + '                    const takeMs = Math.round((nowMs() - takeT0) * 100) / 100;' + NL
                + '                    if (!Array.isArray(raw)) continue;' + NL
                + '                    let n = 0;' + NL
                + '                    let bodyCapped = false;' + NL
                + '                    perSourceStat[src.id] = { raw: raw.length, indexed: 0, capped: false, ms: takeMs };' + NL)
    src = once(src, A_TAKE, NEW_TAKE, 'take-ms')

    A_CHUNK = '                            perSourceStat[src.id] = { raw: raw.length, indexed: n, capped: false };' + NL
    NEW_CHUNK = '                            perSourceStat[src.id] = { raw: raw.length, indexed: n, capped: false, ms: takeMs };' + NL
    src = once(src, A_CHUNK, NEW_CHUNK, 'chunk-stat')

    A_FINAL = '                    perSourceStat[src.id] = { raw: raw.length, indexed: n, capped: capped };' + NL
    NEW_FINAL = '                    perSourceStat[src.id] = { raw: raw.length, indexed: n, capped: capped, ms: takeMs };' + NL
    src = once(src, A_FINAL, NEW_FINAL, 'final-stat')

    A_LS = ('            this._lastScan = {' + NL
            + '                full: full, perSource: perSourceStat, cappedSources: cappedSources,' + NL
            + '                bodyCappedSources: bodyCappedSources, totalCapped: out.length >= totalCap' + NL
            + '            };' + NL)
    NEW_LS = ('            this._lastScan = {' + NL
              + '                full: full, perSource: perSourceStat, cappedSources: cappedSources,' + NL
              + '                bodyCappedSources: bodyCappedSources, totalCapped: out.length >= totalCap,' + NL
              + '                /* [v3.75.0 + R-O5] 已建条数：中途被 gen.return() 收束时，' + NL
              + '                 *   这是**已建部分**的真读数（不是上一轮的陈旧值，也不是全量上限）。 */' + NL
              + '                indexed: out.length' + NL
              + '            };' + NL)
    src = once(src, A_LS, NEW_LS, 'last-scan-indexed')

    A_SCOPE = ('            pending: Number((cov && cov.pending) || 0),' + NL
               + '            complete: !(cov && cov.complete === false)' + NL)
    NEW_SCOPE = ('            pending: Number((cov && cov.pending) || 0),' + NL
                 + '            /* [v3.75.0 + R-O5] 作废发生在哪一段：`index` / `match` / null（三态互不同形）。' + NL
                 + '             *   为什么要有这一格：此前只报 `complete:false`，索引阶段与比中阶段' + NL
                 + '             *   被作废在读数上同形 —— 用户看不出「取消到底受理在哪一段」。 */' + NL
                 + "            cancelledAt: (cov && cov.cancelledAt) || null," + NL
                 + '            complete: !(cov && cov.complete === false)' + NL)
    src = once(src, A_SCOPE, NEW_SCOPE, 'scope-cancelledAt')

    A_P2 = ("                    query: '', results: [], groups: [], total: 0, scanned: processed," + NL
            + '                    errors: this._errors.slice(), cancelled: true,' + NL
            + "                    scope: this._scope(full, { coverage: { scannedBySource: scannedBySource, pending: Math.max(0, all.length - processed), complete: false } }, all.length)" + NL)
    NEW_P2 = ("                    query: '', results: [], groups: [], total: 0, scanned: processed," + NL
              + '                    indexed: all.length, errors: this._errors.slice(), cancelled: true,' + NL
              + "                    scope: this._scope(full, { coverage: { scannedBySource: scannedBySource, pending: Math.max(0, all.length - processed), complete: false, cancelledAt: 'match' } }, all.length)" + NL)
    src = once(src, A_P2, NEW_P2, 'phase2-cancel')

    A_OK = ('            query: q, results: results, groups: groups, total: hits.length, scanned: processed,' + NL
            + '            errors: this._errors.slice(), cancelled: false,' + NL
            + "            scope: this._scope(full, { coverage: { scannedBySource: scannedBySource, pending: 0, complete: true } }, all.length)" + NL)
    NEW_OK = ('            query: q, results: results, groups: groups, total: hits.length, scanned: processed,' + NL
              + '            indexed: all.length, errors: this._errors.slice(), cancelled: false,' + NL
              + "            scope: this._scope(full, { coverage: { scannedBySource: scannedBySource, pending: 0, complete: true, cancelledAt: null } }, all.length)" + NL)
    src = once(src, A_OK, NEW_OK, 'phase2-ok')

    assert 'nowMs' in src and 'cancelledAt' in src and 'indexed: all.length' in src
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        print('target = ' + REL)
        return 0
    wr(REL, src)
    print('--- WRITTEN --- ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())