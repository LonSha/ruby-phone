#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""takeover_v4440_anchors.py — [v4.44.0 · 抬版接管] 十一条历史套件的版本锚。

【修前实测的形态（跑一次就现形，不是推演）】
  `tests/system-v4330` 至 `v4430` 的版本锚长这样：
      const ver = pkg.version;
      ...
      const items = (log.versions[ver].items || []).join(NL);
      assert.ok(items.indexOf('R5-Oxx') >= 0, '当版条目必须点名 R5-Oxx');
  前几条（五源一致）是**全局不变量**，任何版本都成立；
  最后那条断的是「**当版**公告记了本版那件事」—— 抬到 v4.44.0 的那一刻
  `ver` 变成 4.44.0，而 4.44.0 的公告里当然没有 R5-O7 / R5-O8 / … ⇒ 转红。
  这不是产品缺陷，是**判据写错了主语**：它想说的是「v4.34.0 这一版记全了」，
  写成了「当前这一版记全了」。两者只在抬版前那一瞬同义。
  本仓 v4.27.0 的 `tools/patch_x6e.py` 档头已逐字记过同因（v4260 那条）。

【本次实测的转红面（HEAD b29df6b 上即已如此，非本版引入）】
  抬版前 `log.latest = 4.43.0`，其公告只点名 R5-X3 ⇒
  v4340 / v4350 / v4360 / v4370 / v4380 / v4390 / v4400 / v4420 八条在 HEAD 上就是红的；
  v4410（要 R5-X8）在 HEAD 上也红（本版公告里恰好提到 R5-X8，故它反而转绿 —— 偶然）；
  v4430（要 R5-X3）在 HEAD 上绿，本版抬版后转红（这条才是抬版连带）。
  v4330 用的是自己的字面量，但把「五源一致」也一并锁死在 4.33.0 ⇒ 同样转红。

【修法（同仓既有口径：旧锚点被接管，留痕不静默）】
  一致性（五源同版 / 版本号形态 / index.js 常量在场）继续跟随 `pkg.version`；
  当版**内容**改为锁**自己那一版**的字面量。**断言强度不变** —— 只换主语，不放宽。
  旧写法逐字留档于本档头，改写清单见下方 REWRITES。

用法：
  python3 tools/takeover_v4440_anchors.py            # DRY RUN
  python3 tools/takeover_v4440_anchors.py --write    # 落盘
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)

# (suite, 自己那一版, [(old, new), ...])
DYNAMIC_BLOCK = u'''    const ver = pkg.version;
    assert.match(ver, /^\\d+\\.\\d+\\.\\d+$/, '版本号形态必须正常:' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 必须同版');
    assert.equal(log.latest, ver, 'update-log.latest 必须同版');
    assert.equal(log.head, ver, 'update-log.head 必须同版');
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);'''


def dynamic_new(own):
    return (u'''    /* ★ [v4.44.0 · 抬版接管] 一致性跟随当前版；当版**内容**锁自己那一版。
     *   修前两句共用一个 `ver` ⇒ 抬版后「本版公告记了本版那件事」被判成假：
     *   那不是产品缺陷，是判据的主语写错了（见 tools/patch_x6e.py 档头同因）。 */
    const cur = pkg.version;
    assert.match(cur, /^\\d+\\.\\d+\\.\\d+$/, '版本号形态必须正常:' + cur);
    assert.equal(man.version, cur, 'manifest 与 package 必须同版');
    assert.equal(log.latest, cur, 'update-log.latest 必须同版');
    assert.equal(log.head, cur, 'update-log.head 必须同版');
    const ver = '%s';
    assert.ok(log.versions[ver], '当版条目必须存在');
    const items = (log.versions[ver].items || []).join(NL);''' % own)


IDX_OLD = u'''    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + ver + "';") >= 0, 'index.js 版本常量必须同源');'''
IDX_NEW = u'''    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + cur + "';") >= 0, 'index.js 版本常量必须同源');'''

V4330_OLD = u'''    const ver = '4.33.0';
    assert.equal(pkg.version, ver, 'package.json');
    assert.equal(man.version, ver, 'manifest.json');
    assert.equal(log.latest, ver, 'update-log.latest');
    assert.equal(log.head, ver, 'update-log.head');
    assert.equal(m[1], ver, 'index.js 版本常量必须同源');
    const entry = log.versions[ver];'''
V4330_NEW = u'''    /* ★ [v4.44.0 · 抬版接管] 一致性跟随当前版；当版内容锁自己那一版。 */
    const cur = pkg.version;
    assert.match(cur, /^\\d+\\.\\d+\\.\\d+$/, '版本号形态必须正常:' + cur);
    assert.equal(man.version, cur, 'manifest.json 必须与 package 同版');
    assert.equal(log.latest, cur, 'update-log.latest 必须同版');
    assert.equal(log.head, cur, 'update-log.head 必须同版');
    assert.equal(m[1], cur, 'index.js 版本常量必须同源');
    const ver = '4.33.0';
    const entry = log.versions[ver];'''

V4340_OLD = u'''    assert.equal(ul.versions[versions[0]] != null, true, '当版条目必须在 update-log 里');
    const items = ul.versions[versions[0]].items || [];'''
V4340_NEW = u'''    /* ★ [v4.44.0 · 抬版接管] 当版**内容**锁自己那一版（见 tools/patch_x6e.py 档头同因）。 */
    const own = ul.versions['4.34.0'];
    assert.equal(own != null, true, '当版条目必须在 update-log 里');
    const items = own.items || [];'''

V4350_OLD = u'''    const items = (ul.versions[mm[1]] || {}).items || [];'''
V4350_NEW = u'''    /* ★ [v4.44.0 · 抬版接管] 当版内容锁自己那一版（一致性仍跟随当前版）。 */
    const items = (ul.versions['4.35.0'] || {}).items || [];'''

REWRITES = [
    ('v4330', None, [(V4330_OLD, V4330_NEW)]),
    ('v4340', None, [(V4340_OLD, V4340_NEW)]),
    ('v4350', None, [(V4350_OLD, V4350_NEW)]),
    ('v4360', '4.36.0', [(DYNAMIC_BLOCK, dynamic_new('4.36.0')), (IDX_OLD, IDX_NEW)]),
    ('v4370', '4.37.0', [(DYNAMIC_BLOCK, dynamic_new('4.37.0')), (IDX_OLD, IDX_NEW)]),
    ('v4380', '4.38.0', [(DYNAMIC_BLOCK, dynamic_new('4.38.0')), (IDX_OLD, IDX_NEW)]),
    ('v4390', '4.39.0', [(DYNAMIC_BLOCK, dynamic_new('4.39.0')), (IDX_OLD, IDX_NEW)]),
    ('v4400', '4.40.0', [(DYNAMIC_BLOCK, dynamic_new('4.40.0')), (IDX_OLD, IDX_NEW)]),
    ('v4410', '4.41.0', [(DYNAMIC_BLOCK, dynamic_new('4.41.0')), (IDX_OLD, IDX_NEW)]),
    ('v4420', '4.42.0', [(DYNAMIC_BLOCK, dynamic_new('4.42.0')), (IDX_OLD, IDX_NEW)]),
    ('v4430', '4.43.0', [(DYNAMIC_BLOCK, dynamic_new('4.43.0')), (IDX_OLD, IDX_NEW)]),
]


def main():
    changed = 0
    for suite, own, pairs in REWRITES:
        rel = 'tests/system-%s.test.mjs' % suite
        p = os.path.join(ROOT, rel)
        with io.open(p, encoding='utf-8') as f:
            src = f.read()
        for old, new in pairs:
            n = src.count(old)
            assert n == 1, '[%s] anchor must hit exactly 1, got %d: %s' % (
                suite, n, old[:60].replace(NL, ' '))
            src = src.replace(old, new, 1)
        print('  %s -> own=%s' % (suite, own or 'literal'))
        changed += 1
        if WRITE:
            with io.open(p, 'w', encoding='utf-8') as f:
                f.write(src)
    print('--- %d suites %s ---' % (changed, 'WRITTEN' if WRITE else 'DRY RUN'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
