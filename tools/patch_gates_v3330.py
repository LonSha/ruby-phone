#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_gates_v3330.py — 两条判据的形态收紧（v3.33.0 抬版连带面里的**判据自身缺陷**）。

问题形态（本仓反复付代价的那一族：**把「当版」写进判据**）：
  两套判据的「落大厅分支」断言写成「必须**确切**包含 `this.currentView === '<当版最后一款>')`」——
      · tests/system-v3320.test.mjs：`this.currentView === 'guesswhat')`
      · tests/system-v3330.test.mjs：`this.currentView === 'ludo')`
  于是**下一个**子游戏落进这个析取链时，老套件当场报红，而产品侧完全正确
  （枚举本来就该跟着长）。这与 v3270/v3280/v3290/v3300 四处「守别人的版」同族，
  只是这次守的不是版本号而是「当版的最后一款」。

改法（泛化，不是放宽）：断言改成两段 ——
  ① **形态锚**：落大厅分支必须是一条 `currentView === '…'` 的**析取链**（仍要求 ≥2 项）；
  ② **守自己那一件**：本套件所属那两款必须在这个分支里（v3320 守 seaturtle / guesswhat，
     v3330 守 scriptkill / ludo）。
  这样：产品把枚举拓宽 ⇒ 老套件不受影响（这是正确的措辞）；有人把某一件从链上摘掉 ⇒ 它仍报红。

纪律：锚点必须恰中 1 次；改完对两文件做 `node --check` 之外的语法校验（node --test 单独跑）。
用法：python3 tools/patch_gates_v3330.py [--write]
"""
import io
import os
import sys
ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv


def patch(rel, old, new, tag):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    s2 = s.replace(old, new, 1)
    assert s2 != s
    if WRITE:
        io.open(p, 'w', encoding='utf-8').write(s2)
    print('[%s] %s：%+d 字符' % (tag, rel, len(s2) - len(s)))
    return s2


# ── ① v3320 套件：落大厅分支 ──
patch(
    'tests/system-v3320.test.mjs',
    "    assert.ok(swipe.includes(\"this.currentView === 'guesswhat')\"), '落大厅分支必须含 guesswhat');",
    """    /* ★ [v3.33.0 交棒 · 判据自身缺陷] 原断言写成「必须**确切**包含
     *   `this.currentView === 'guesswhat')`」—— 那是把「当版最后一款」写进了判据：
     *   **下一个**子游戏落进这个析取链时它当场报红，而产品侧完全正确（枚举本来就该跟着长）。
     *   与 v3270/v3280/v3290/v3300 四处「守别人的版」同族，只是这次守的是「当版最后一款」。
     *   改为泛化：形态锚（仍须是一条析取链）+ 守自己那一件（本套件那两款必须在链上）。 */
    assert.ok(/this\\.currentView === '[a-z0-9]+'(?: \\|\\| this\\.currentView === '[a-z0-9]+')+\\)/.test(swipe),
        '落大厅分支必须是一条 currentView 析取链（形态锚，不许退化成单件判定）');
    for (const v of ['seaturtle', 'guesswhat']) {
        assert.ok(swipe.includes("'" + v + "'"), '落大厅分支必须含本套件那一件：' + v);
    }""",
    'v3320 落大厅分支',
)

# ── ② v3330 套件：落大厅分支 ──
patch(
    'tests/system-v3330.test.mjs',
    "    assert.ok(swipe.includes(\"this.currentView === 'ludo')\"), '落大厅分支必须含 ludo');",
    """    /* ★ 同一形态的措辞（与 v3320 交棒改法一致）：形态锚 + 守自己那一件，
     *   不把「当版最后一款」写成确切包含。 */
    assert.ok(/this\\.currentView === '[a-z0-9]+'(?: \\|\\| this\\.currentView === '[a-z0-9]+')+\\)/.test(swipe),
        '落大厅分支必须是一条 currentView 析取链（形态锚，不许退化成单件判定）');
    for (const v of ['scriptkill', 'ludo']) {
        assert.ok(swipe.includes("'" + v + "'"), '落大厅分支必须含本套件那一件：' + v);
    }""",
    'v3330 落大厅分支',
)
print('（%s）' % ('已写入' if WRITE else 'dry-run，未写入'))
