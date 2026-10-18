#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x6e.py — [v4.27.0 · R4-X6 收口补丁 E]
修「历史套件的版本锚被抬版连带转红」这一形态。

【修前实测的缺陷（跑一次就现形，不是推演）】
  tests/system-v4260.test.mjs 的 E1 里有这几条：
      const ver = pkg.version;
      const items = log.versions[ver].items;
      assert.ok(all.indexOf('chars-perspective.js') >= 0);
      assert.ok(all.indexOf('J19') >= 0);
      assert.ok(all.indexOf('testimonyBoard') >= 0);
  前三条（五源一致）是**全局不变量**，任何版本都成立；
  后四条断的是「**当版**公告记了本版三件」—— 抬到 v4.27.0 的那一刻，
  `ver` 变成 4.27.0，而 4.27.0 的公告里当然没有 chars-perspective.js ⇒ 转红。
  这不是产品缺陷，是**判据写错了主语**：它想说的是「v4.26.0 这一版记全了」，
  写成了「当前这一版记全了」。两者只在抬版前那一瞬同义。

【修法（同仓既有口径：新套件接管旧锚点）】
  历史套件里，**五源一致性**继续跟随 `pkg.version`（那是永远该成立的不变量）；
  **当版内容**改为锁**自己那一版**的字面量（`log.versions['4.26.0']`）。
  本版新写的 tests/system-v4270.test.mjs 从一开始就按这个形态写（锁 4.27.0），
  故它将来被抬版时也不会连带转红。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

V4260 = 'tests/system-v4260.test.mjs'
V4270 = 'tests/system-v4270.test.mjs'

# ---- v4260：把「当版内容」三条改成锁自己那一版
OLD_4260 = u'''    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0, 'ITERATION_LOG 必须记这一版');
    /* 当版公告必须记到本版三件：接线件 / 门禁标签 / 运行时验证边界（防「做了但没记」）。 */
    const all = items.join(NL);
    assert.ok(all.indexOf('chars-perspective.js') >= 0, '当版公告必须记接线件');
    assert.ok(all.indexOf('J19') >= 0, '当版公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0, '当版公告必须记运行时边界');
    assert.ok(all.indexOf('testimonyBoard') >= 0, '当版公告必须记证词面 id');
});'''
NEW_4260 = u'''    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0, 'ITERATION_LOG 必须记这一版');
    /* ★ 下面这几条断的是「**v4.26.0 这一版**记全了」，故必须锁**自己那一版**的字面量，
     *   不能跟随 `pkg.version`：抬到下一版的那一刻，`ver` 会变成新版，
     *   而新版公告里当然没有本版的件名 ⇒ 判据会因「抬版」而转红 ——
     *   那是判据写错了主语（它想说「这一版记全了」，写成了「当前这一版记全了」）。
     *   五源一致性（上面三条）是全局不变量，继续跟随 `ver` 不受影响。 */
    const own = log.versions['4.26.0'];
    assert.ok(own, 'v4.26.0 条目必须在账上（历史留痕不删）');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('chars-perspective.js') >= 0, 'v4.26.0 公告必须记接线件');
    assert.ok(all.indexOf('J19') >= 0, 'v4.26.0 公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0, 'v4.26.0 公告必须记运行时边界');
    assert.ok(all.indexOf('testimonyBoard') >= 0, 'v4.26.0 公告必须记证词面 id');
});'''

# ---- v4270：从一开始就锁自己那一版（防将来抬版连带转红）
OLD_4270 = u'''    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0);
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0);
    const all = items.join(NL);
    assert.ok(all.indexOf('plotline-board.js') >= 0, '当版公告必须记接线件');
    assert.ok(all.indexOf('J20') >= 0, '当版公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0);
    assert.ok(all.indexOf('causalChain') >= 0, '当版公告必须记因果面 id');
});'''
NEW_4270 = u'''    const items = (log.versions[ver] && log.versions[ver].items) || [];
    assert.ok(Array.isArray(items) && items.length >= 8, '当版公告至少 8 条');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0);
    assert.ok(read('ITERATION_LOG.md').indexOf('v' + ver) >= 0);
    /* ★ 同 v4260 的修法：这几条断的是「**v4.27.0 这一版**记全了」，
     *   故锁自己那一版的字面量，不跟随 `pkg.version` ——
     *   否则本套件会在抬到 v4.28.0 时因「新版公告里没有本版件名」而转红。 */
    const own = log.versions['4.27.0'];
    assert.ok(own, 'v4.27.0 条目必须在账上');
    const all = (own.items || []).join(NL);
    assert.ok(all.indexOf('plotline-board.js') >= 0, 'v4.27.0 公告必须记接线件');
    assert.ok(all.indexOf('J20') >= 0, 'v4.27.0 公告必须记门禁标签');
    assert.ok(all.indexOf('运行时验证边界') >= 0);
    assert.ok(all.indexOf('causalChain') >= 0, 'v4.27.0 公告必须记因果面 id');
});'''


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
    st = {V4260: rd(V4260), V4270: rd(V4270)}
    st[V4260] = once(st[V4260], OLD_4260, NEW_4260, 'v4260 E1')
    print('v4260 E1 OK')
    st[V4270] = once(st[V4270], OLD_4270, NEW_4270, 'v4270 E1')
    print('v4270 E1 OK')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    for rel, s in st.items():
        wr(rel, s)
    print('--- WRITTEN E ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())