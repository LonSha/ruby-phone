#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv13.py — 修 v3.35.0 首轮自红里的**六处判据口径错**（产品侧已由 11/12 修掉）。

逐条：
  ① A7「负数抬到下界」期望值写死 1 —— 产品下界已对齐到 **0**（0 是合法章号），
     判据必须跟着改；写死 1 就等于把「0 是合法章号」这条纪律从负数一侧推翻。
  ② C5 只放行 `.pxv-` 前缀，把状态类 `.is-on/.is-idle/.is-off/.is-bad` 判成「外来的」
     —— 状态类是本仓既有写法（`.is-*`），不是别家前缀。
  ③ E1 的 `/pickDiverseAuthors\\([^)]*\\)\\.picked/` 卡在 `authorsActive()` 的括号上
     —— `[^)]*` 遇第一个 `)` 就停，真源码反而判成「没拆包」。
  ④ dataProblems 缺一条「原始章按下标配对」的判据 ⇒ d6 破坏**无处可报**
     （负控制纪律②：破坏面必须与判据面同一语义）。补的场景必须让**章号 ≠ 下标**，
     否则按号取与按下标取等价、破坏行为不变（等于装饰）。
  ⑤ appReadProblems 只查全文件含 `_readRaw(` —— 该串在定义处与别处都在，
     破坏 probe 里的那一处也照样为真 ⇒ 判据面没落到**被破坏的那一处**。
     改成只看 `probe()` 函数体窗口。
  ⑥ NEG 表 I6 的期望码跟着 ④ 一起改。
"""
import sys

P = 'tests/system-v3350.test.mjs'

EDITS = []

# ── ① A7 负数下界 ──
EDITS.append((
    "    assert.equal(DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num, 1, '负数抬到 1（下界）');",
    "    assert.equal(DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num, 0, '负数抬到下界 0（0 是合法章号，不许抬成 1）');"))

# ── ② C5 状态类放行 ──
EDITS.append((
    "    const alien = [...new Set(classes)].filter((c) => c.indexOf('.pxv-') !== 0);",
    "    /* ★ `.is-*` 是本仓既有**状态类**写法（`is-on` / `is-idle` / `is-off` / `is-bad`），\n"
    "     *   不是别家前缀 —— 首版只放行 `.pxv-`，把四个状态类判成外来的（判据自己红）。 */\n"
    "    const alien = [...new Set(classes)].filter((c) => c.indexOf('.pxv-') !== 0 && c.indexOf('.is-') !== 0);"))

# ── ③ E1 拆包正则 ──
EDITS.append((
    "    assert.ok(/pickDiverseAuthors\\([^)]*\\)\\.picked/.test(app), '必须显式拆包 `.picked`（否则视图拿到对象）');",
    "    /* ★ 不许用 `[^)]*`：调用里第一个 `)` 是 `authorsActive()` 的，正则当场断掉，\n"
    "     *   真源码反而判成「没拆包」。改成「同一个调用点窗口里必须出现 `.picked`」。 */\n"
    "    assert.ok(/pickDiverseAuthors\\([\\s\\S]{0,160}?\\)\\.picked/.test(app), '必须显式拆包 `.picked`（否则视图拿到对象）');"))

# ── ⑤ appReadProblems 落到 probe 函数体 ──
EDITS.append((
    "const appReadProblems = (src) => {\n"
    "    const bad = [];\n"
    "    if (!src.includes('_readRaw(')) bad.push('read-raw-not-used');\n"
    "    if (!/storageOk\\s*=/.test(src)) bad.push('storage-ok-not-computed');\n"
    "    return bad;\n"
    "};",
    "const appReadProblems = (src) => {\n"
    "    const bad = [];\n"
    "    /* ★ 判据必须落到**被破坏的那一处**（`probe()` 里的认源调用）。\n"
    "     *   首版只查全文件含 `_readRaw(` —— 定义处与别处都在，破坏 probe 那一处照样为真，\n"
    "     *   等于判据面没盖住破坏面（负控制纪律②）。 */\n"
    "    const i = src.indexOf('    probe() {');\n"
    "    const body = i < 0 ? '' : src.slice(i, i + 2400);\n"
    "    if (!body.includes('this._readRaw(CONTENT_KEY)')) bad.push('read-raw-not-used');\n"
    "    if (!/storageOk\\s*=/.test(body)) bad.push('storage-ok-not-computed');\n"
    "    return bad;\n"
    "};"))

# ── ④ dataProblems 补「原始章按下标配对」 ──
EDITS.append((
    "    if (onlyBad.hearts === 0 && 500 > 0) bad.push('cache-hearts-zeroed-by-bad-num');",
    "    if (onlyBad.hearts === 0 && 500 > 0) bad.push('cache-hearts-zeroed-by-bad-num');\n"
    "    /* ④ 原始章必须**按下标**配对：场景要让**章号 ≠ 下标**，否则按号取与按下标取等价、\n"
    "     *   破坏行为不变（等于装饰断言）。这里第 0 章号是 5、下标是 0 —— 按号取会拿到\n"
    "     *   `rawArr[4]`（不存在）⇒ 已给的心数被丢掉、改算派生值。 */\n"
    "    const offset = mod.initNovelPopularity({\n"
    "        id: 'n_offset',\n"
    "        chapters: [{ num: 5, content: 'a'.repeat(30), hearts: 0 },\n"
    "            { num: 'bad', content: 'b'.repeat(30), hearts: 77 }],\n"
    "    });\n"
    "    if (offset.chapters[0].hearts !== 0) bad.push('raw-chapter-by-number');\n"
    "    if (offset.chapters[1].hearts !== 77) bad.push('raw-chapter-by-number');"))

# ── ⑥ NEG I6 期望码 ──
EDITS.append((
    "    ['I6 破坏「原始章按下标配对」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['cache-hearts-zeroed-by-bad-num']],",
    "    ['I6 破坏「原始章按下标配对」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['raw-chapter-by-number']],"))

fail = 0
for from_s, to_s in EDITS:
    s = open(P, encoding='utf-8').read()
    n = s.count(from_s)
    if n != 1:
        print('FAIL 锚点命中 %d 次：%r' % (n, from_s[:70]))
        fail += 1
        continue
    open(P, 'w', encoding='utf-8').write(s.replace(from_s, to_s))
    print('OK  ← %r' % (from_s[:64].replace('\n', '⏎'),))

if fail:
    print('')
    print('失败 %d 处' % fail)
    sys.exit(1)
print('')
print('OK patch_pixiv13 全部落地')