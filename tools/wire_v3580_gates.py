#!/usr/bin/env python3
"""wire_v3580_gates.py — [v3.58.0 · 计划 O5] 把「钉在当时那一格」的静态门改成**允许面**。

【治的是什么】O5 把案头一族的写面从 `this.storage.set(...)` 收成唯一实现
`writeReceipt(this.storage, key, ...)`，并给 App 加了一条 import。于是这些套件里
把「当时的恰好形态」当成不变量的门集体假红：

  · 数 import：`assert.equal(importBlocks.length, 3, 'App 层只许三条 import')`
    —— 门要钉的是「只许数据层 / 数值门 / 视图 / 写回执这几件」，不是「恰好三条」。
  · 白名单：`im.includes('./needsim-data.js') || ... || im.includes('num-gate.js')`
    —— 写回执唯一实现同为允许面。
  · 写面字面量：`code.includes('this.storage.set(key, JSON.stringify(value))')`
    —— 门要钉的是「经 set 落盘」，`writeReceipt` 内部正是调 set。

【纪律】不是放宽门，是**把门钉回它本来要钉的东西**：允许面是枚举，不是计数；
写面认「经 set 落盘」这一事实，不认某一行字面量的形状。改后每处都仍有「必须导入
本件数据层 / 视图 / 取数门」的正向断言，门不会变空。

【用法】
    python3 tools/wire_v3580_gates.py            # dry-run
    python3 tools/wire_v3580_gates.py --write    # 落盘
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATCHES = [
    # ── C1 · v3340：import 计数门 → 分层允许集 ──────────────────────────────
    ('tests/system-v3340.test.mjs',
     """    const importBlocks = code.match(/^import[\\s\\S]*?from '[^']+';/gm) || [];
    assert.equal(importBlocks.length, 3, 'App 层只许三条 import（数据层 / 数值门 / 视图）');
    assert.ok(importBlocks[0].includes("from './lofter-data.js'"), '第一条必须是本件数据层');
    assert.ok(importBlocks[1].includes("from '../../config/num-gate.js'"), '第二条必须是两层级的数值门');
    assert.ok(importBlocks[2].includes("from './lofter-view.js'"), '第三条必须是本件视图');""",
     """    const importBlocks = code.match(/^import[\\s\\S]*?from '[^']+';/gm) || [];
    /* [v3.58.0 · 计划 O5] 白名单是**分层允许集**：数据层 / 数值门 / 视图 / 写回执唯一实现。
     *   这四条就是「App 层只许这么几件」的全部 —— 原先数「恰三条」是把当时那一格当成了
     *   不变量，于是接入写回执（O5 的正当接线）会被读成「多导入了别的东西」。 */
    const ALLOWED_IMPORT_SOURCES = [
        "from './lofter-data.js'",
        "from '../../config/num-gate.js'",
        "from './lofter-view.js'",
        "from '../../config/write-receipt.js'",
    ];
    for (const blk of importBlocks) {
        assert.ok(ALLOWED_IMPORT_SOURCES.some((s) => blk.includes(s)),
            'App 层不许 import 别的东西：' + blk.replace(/\\s+/g, ' ').slice(0, 90));
    }
    assert.ok(importBlocks.some((b) => b.includes("from './lofter-data.js'")), '必须导入本件数据层');
    assert.ok(importBlocks.some((b) => b.includes("from '../../config/num-gate.js'")), '必须导入两层级的数值门');
    assert.ok(importBlocks.some((b) => b.includes("from './lofter-view.js'")), '必须导入本件视图');"""),

    # ── C2 · v3410：import 白名单 → 收录写回执 ──────────────────────────────
    ('tests/system-v3410.test.mjs',
     """        assert.ok(im.includes('./needsim-data.js') || im.includes('./needsim-view.js') || im.includes('num-gate.js'),
            'App 不许 import 别的东西：' + im);""",
     """        /* [v3.58.0 · 计划 O5] 写回执的唯一实现同为**允许面**（三件基本 + 取数门 + 写回执）。 */
        assert.ok(im.includes('./needsim-data.js') || im.includes('./needsim-view.js')
            || im.includes('num-gate.js') || im.includes('write-receipt.js'),
            'App 不许 import 别的东西：' + im);"""),

    # ── C3 · v3430：写面字面量 → 认「经 set 落盘」 ──────────────────────────
    ('tests/system-v3430.test.mjs',
     """    assert.ok(code.includes('this.storage.set(key, JSON.stringify(value))'), '写面必须走 storage.set');""",
     """    /* [v3.58.0 · 计划 O5] 写面既可以直接走 set，也可以走唯一实现（writeReceipt 内部正是调 set）——
     *   门要钉的是「有没有经 set 落盘」，不是「字面量必须长这一行」。 */
    assert.ok(code.includes('this.storage.set(key, JSON.stringify(value))')
        || code.includes('writeReceipt(this.storage, key, JSON.stringify(value))'), '写面必须走 storage.set');"""),

    # ── C4 · v3380 / v3390 / v3400 / v3420：同上（各件的变量名不同） ────────
    ('tests/system-v3380.test.mjs',
     """    assert.ok(appCode.includes('this.storage.set('), 'App 必须经 storage.set 落盘');""",
     """    /* [v3.58.0 · 计划 O5] 经 set 落盘即可：直调 set 或走唯一实现（writeReceipt 内部调 set）。 */
    assert.ok(appCode.includes('this.storage.set(') || appCode.includes('writeReceipt(this.storage'),
        'App 必须经 storage.set 落盘');"""),

    ('tests/system-v3390.test.mjs',
     """    assert.ok(app.includes('this.storage.set('), '必须经 set 口落盘');""",
     """    /* [v3.58.0 · 计划 O5] 经 set 口落盘即可：直调或走唯一实现。 */
    assert.ok(app.includes('this.storage.set(') || app.includes('writeReceipt(this.storage'),
        '必须经 set 口落盘');"""),

    ('tests/system-v3400.test.mjs',
     """    assert.ok(app.includes('this.storage.set('), '必须只走 set');""",
     """    /* [v3.58.0 · 计划 O5] 经 set 落盘即可：直调或走唯一实现。 */
    assert.ok(app.includes('this.storage.set(') || app.includes('writeReceipt(this.storage'), '必须只走 set');"""),

    ('tests/system-v3420.test.mjs',
     """    assert.ok(code.indexOf('this.storage.set') > 0);""",
     """    /* [v3.58.0 · 计划 O5] 经 set 落盘即可：直调或走唯一实现。 */
    assert.ok(code.indexOf('this.storage.set') > 0 || code.indexOf('writeReceipt(this.storage') > 0);"""),
]


def main():
    write = '--write' in sys.argv
    done, bad = 0, []
    for rel, old, new in PATCHES:
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        n = src.count(old)
        if n != 1:
            bad.append('%-32s 锚点命中 %d 次（应 1）' % (rel, n))
            continue
        if write:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(src.replace(old, new, 1))
            print('WRITE %-32s' % rel)
        else:
            print('DRY   %-32s' % rel)
        done += 1
    for msg in bad:
        print('BAD   ' + msg)
    print('--- %s：%d/%d 处%s' % ('已落盘' if write else '可落盘', done, len(PATCHES),
                                  '' if write else '（未写入，加 --write 落盘）'))
    if bad:
        sys.exit(1)


if __name__ == '__main__':
    main()