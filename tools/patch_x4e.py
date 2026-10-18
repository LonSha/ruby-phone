#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4e.py — [v4.28.0 · R4-X4 补丁 E] v3450 副本树补拷新件

tests/system-v3450.test.mjs 的 stageTree() 按**真相对路径**把存档台三件
拷进临时树，再在副本上跑行为判据（负控制只准写副本，绝不写真仓）。

R4-X4 之后 archive-app.js 多了一条静态导入：
    import { ArchiveCanon } from './archive-canon.js';
而 archive-canon.js 又 import '../../config/branch-canon-contract.js'
（后者 import './num-gate.js'，num-gate 已在副本树里）。

副本树不补这两件 ⇒ 每一个 appmod 类负控制都报
`ERR_MODULE_NOT_FOUND: .../archive-canon.js` ——
**破坏有没有发生已经不重要了**，判据根本没跑到（典型的假红）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
V3450 = 'tests/system-v3450.test.mjs'


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


E_OLD = u"""    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    const ad = path.join(dir, 'apps', 'archive');
    fs.mkdirSync(ad, { recursive: true });
    for (const f of ['archive-data.js', 'archive-view.js', 'archive-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'archive', f), path.join(ad, f));
    }
    return dir;"""

E_NEW = u"""    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    /* [v4.28.0 · R4-X4] 存档台第五页签的取数件引了纯契约件（后者引 num-gate）。
     *   ★ 副本树必须跟着长：少拷一件，appmod 类负控制全部报 MODULE_NOT_FOUND，
     *     判据根本没跑到 —— 破坏有没有发生已经不重要了（典型假红）。 */
    fs.copyFileSync(path.join(ROOT, 'config', 'branch-canon-contract.js'), path.join(dir, 'config', 'branch-canon-contract.js'));
    const ad = path.join(dir, 'apps', 'archive');
    fs.mkdirSync(ad, { recursive: true });
    for (const f of ['archive-data.js', 'archive-view.js', 'archive-app.js', 'archive-canon.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'archive', f), path.join(ad, f));
    }
    return dir;"""


def main():
    s = rd(V3450)
    s = once(s, E_OLD, E_NEW, 'stageTree')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(V3450, s)
    print('--- WRITTEN E ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())