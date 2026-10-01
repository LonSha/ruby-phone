#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv9.py — 修真缺陷④：坏章号**补号即错配**（连带三处）。

★ 缺陷链（`tools/probe3350b.mjs` 探针当场量出来的，不是推演）：

  `normalizeChapter({ num: 'nope' }, 4)` 返回 `num: 5` ——
  文件纪律区白纸黑字写着「坏值一律 `numOrNull` 取，坏值即 null」，
  **实现却把坏值静默补成位置号**（源 `chIdx + 1` 那一族的形态）。

  往下游连坐两处，都不报错、不崩：
  ① `initNovelPopularity` 按**位置**取原始章 `novel.chapters[c.num - 1]`：
     补号后 `c.num` 不再是位置 ⇒ 取到**别的章**的原始数据 ⇒「给过心数」判错章
     ⇒ **已给的心数被丢掉、改算派生值**；
  ② 补号可能与既有章**撞号**：外源数据「好章第 4 話 + 坏号章」规范化后两章同为 4
     ⇒ 目录两格同号、`chapterAt(4)` 只找得到第一条 ⇒ 点其中一格进的是**另一条**。

★ 修法（三处同因同法）：
  ① 坏号落 `num: null`（不出示、不参与按号查找），但**条数如实**：`normalizeNovel`
     不滤坏号章，另带出 `rawChapters` 供下游按下标配对；
  ② `initNovelPopularity` 按**下标**配对，「给过心数」判 `>= 0`（0 是合法读数）；
  ③ 缓存心数：有可数章时以逐章最高为准，全是坏号章时才退回存量值；
  ④ `prevChapterContext` 的坏号按位置补一个号，但**不许与已有号撞**（撞就顺延）。

★ 视图/App：`chapterAt` 与 `nextChapterNum` 无需改（前者按 `num === want` 查、
  后者 `Math.max(...)` 会把 `null` 当 0）；目录对坏号章出「章号不详」、不给点击目标。

★ 幂等：锚点命中次数 ≠ 1 即拒改；改后一律 `node --check`。
"""
import os
import subprocess
import sys
import tempfile

FAILS = []
TARGETS = ['apps/pixiv/pixiv-data.js', 'apps/pixiv/pixiv-app.js', 'apps/pixiv/pixiv-view.js']


def check_js(text):
    fd, tmp = tempfile.mkstemp(suffix='.mjs')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        return (r.returncode == 0), (r.stderr or '').strip()[:400]
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def patch(path, old, new, tag, times=1):
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != times:
        FAILS.append('%s：%s 锚点命中 %d 次（应恰 %d 次）' % (path, tag, n, times))
        return
    out = text.replace(old, new, times)
    ok, err = check_js(out)
    if not ok:
        FAILS.append('%s：%s 改后语法不合法 %s' % (path, tag, err))
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('OK %s：%s' % (path, tag))


# ────────────────────────────────── ① 坏章号即 null
patch('apps/pixiv/pixiv-data.js',
      '        num: numOrNull(c.num) === null ? (index + 1) : Math.max(1, Math.trunc(numOrNull(c.num))),',
      '        // ★ 坏号与「没给」都是 null —— **不许静默补成位置号**：补号会与相邻章撞号\n'
      '        //   （目录两格同号、按号查找只找得到第一条 ⇒ 点一格进另一条），且与纪律区\n'
      '        //   的「坏值即 null」自相矛盾。条数不受影响：`normalizeNovel` 不滤坏号章。\n'
      '        num: numOrNull(c.num) === null ? null : Math.max(1, Math.trunc(numOrNull(c.num))),',
      '坏章号即 null（不再补位置号）')

# ────────────────────────────────── ② 原始章带出 + 缓存心数以可数章为准
patch('apps/pixiv/pixiv-data.js',
      '    const chapters = chRaw.slice(0, PIXIV_LIMITS.maxChaptersPerNovel).map((c, i) => normalizeChapter(c, i));',
      '    // ★ 原始章数组**原样带出**（`rawChapters`）：下游要靠它判「这一章给过心数没」，\n'
      '    //   只能按下标配对 —— 按号配在下游、按号取会错配。\n'
      '    const chKept = chRaw.slice(0, PIXIV_LIMITS.maxChaptersPerNovel);\n'
      '    const chapters = chKept.map((c, i) => normalizeChapter(c, i));',
      '原始章原样带出')

patch('apps/pixiv/pixiv-data.js',
      '        hearts: chapters.length ? maxCh : (heartN === null ? 0 : Math.max(0, Math.trunc(heartN))),',
      '        // ★ 有**可数章**（num 非 null）就以逐章最高为准；全是坏号章时才退回存量值\n'
      '        //   （否则一条坏号章会把整个作品的缓存心数拉成 0）。\n'
      '        hearts: chapters.some((c) => c.num !== null) ? maxCh\n'
      '            : (chapters.length ? ((heartN === null || heartN < maxCh) ? maxCh : Math.trunc(heartN))\n'
      '                : (heartN === null ? 0 : Math.max(0, Math.trunc(heartN)))),\n'
      '        rawChapters: chKept,',
      '缓存心数以可数章为准 + 带出 rawChapters')

# ────────────────────────────────── ③ initNovelPopularity 按下标配对、保留显式给过的心数
patch('apps/pixiv/pixiv-data.js',
      '    const chapters = n.chapters.map((c) => {\n'
      '        const rawCh = (novel && Array.isArray(novel.chapters)) ? novel.chapters[c.num - 1] : null;\n'
      '        const had = rawCh && numOrNull(rawCh.hearts) !== null;\n'
      '        return Object.assign({}, c, { hearts: had ? c.hearts : deriveChapterHearts(heatBase, c.num) });\n'
      '    });',
      '    // ★ 按下标取原始章（`c.num - 1` 在坏号/补号时会错配到别人的心数）；\n'
      '    //   「给过心数」判 `>= 0` —— 0 是**合法读数**，`!== null` 会把 0 当没给过而覆盖。\n'
      '    const rawArr = Array.isArray(n.rawChapters) ? n.rawChapters\n'
      '        : ((novel && Array.isArray(novel.chapters)) ? novel.chapters : []);\n'
      '    const chapters = n.chapters.map((c, pos) => {\n'
      '        const rawCh = rawArr[pos] || null;\n'
      '        const had = rawCh ? (numOrNull(rawCh.hearts) !== null && numOrNull(rawCh.hearts) >= 0) : false;\n'
      '        const chNum = c.num === null ? (pos + 1) : c.num;\n'
      '        return Object.assign({}, c, { hearts: had ? c.hearts : deriveChapterHearts(heatBase, chNum) });\n'
      '    });',
      'initNovelPopularity 按下标配对')

# ────────────────────────────────── ④ 滑窗坏号按位补且不撞号
patch('apps/pixiv/pixiv-data.js',
      '    const arr = (Array.isArray(chapters) ? chapters : []).map((c, i) => normalizeChapter(c, i));',
      '    // ★ 本函数只拿章号**排序与筛选**（不做按号展示），故坏号按位置补一个号；\n'
      '    //   但补出来的号**不许与已有号撞**（撞就顺延），否则排序结果会自相矛盾。\n'
      '    const arr = (() => {\n'
      '        const list = (Array.isArray(chapters) ? chapters : []).map((c, i) => normalizeChapter(c, i));\n'
      '        const used = new Set(list.map((c) => c.num).filter((x) => x !== null));\n'
      '        for (let i = 0; i < list.length; i++) {\n'
      '            if (list[i].num !== null) continue;\n'
      '            let cand = i + 1;\n'
      '            while (used.has(cand)) cand += 1;\n'
      '            used.add(cand);\n'
      '            list[i] = Object.assign({}, list[i], { num: cand });\n'
      '        }\n'
      '        return list;\n'
      '    })();',
      '滑窗坏号按位补且不撞号')

# ────────────────────────────────── ⑤ App：章条数如实（含坏号章）
patch('apps/pixiv/pixiv-app.js',
      '            chapters: n.chapters.length,',
      '            // ★ 条数如实（坏号章也算一条）—— 免得「目录 3 格、统计说 2 章」自相矛盾。\n'
      '            chapters: n.chapters.length,\n'
      '            countableChapters: n.chapters.filter((c) => c.num !== null).length,',
      'statsOf 补 countableChapters')

# ────────────────────────────────── ⑥ 视图：坏号章不撒谎
patch('apps/pixiv/pixiv-view.js',
      '            parts.push(\'<button class="pxv-toc-item\' + (on ? \' is-on\' : \'\') + \'" data-chap="\' + c.num + \'">\'\n'
      '                + \'<span class="pxv-toc-n">第 \' + c.num + \' 話</span>\'',
      '            // ★ 坏号章（`num === null`）：不假装成一个具体章号，也不给点击目标。\n'
      '            const numLabel = c.num === null ? \'章号不详\' : (\'第 \' + c.num + \' 話\');\n'
      '            const chapAttr = c.num === null ? \'\' : (\' data-chap="\' + c.num + \'"\');\n'
      '            parts.push(\'<button class="pxv-toc-item\' + (on ? \' is-on\' : \'\') + (c.num === null ? \' is-bad\' : \'\') + \'"\' + chapAttr + \'>\'\n'
      '                + \'<span class="pxv-toc-n">\' + numLabel + \'</span>\'',
      '目录对坏号章不撒谎')

if FAILS:
    print('FAIL:')
    for f in FAILS:
        print('  · ' + f)
    sys.exit(1)
for t in TARGETS:
    ok, err = check_js(open(t, encoding='utf-8').read())
    if not ok:
        print('FAIL 最终语法 %s: %s' % (t, err))
        sys.exit(1)
print('OK patch_pixiv9 全部落地')
sys.exit(0)