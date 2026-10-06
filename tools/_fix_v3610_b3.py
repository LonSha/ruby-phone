#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B3：带破坏表的接线套件切到「内联 ∪ 表」。

适用：system-v3450 / v3460 / v3470（archive / cotdesk / diagdesk）。这三件的
懒加载分支已在 O6 里搬进表，于是：
  ① 接线面 `wireJudgeAt` 读的 index.js 要换成**判据面**（否则 wire-lazy-branch-lost
     在真仓上恒报，「对照：副本未破坏时必须干净」当场断言失败）；
  ② 破坏锚点原本落在 index.js 的 `} else if (appId === 'x') {` 上 —— 那条分支
     已不在 index.js，锚点命中 0 次。修法：**把锚点重定向到表文件那一行**
     （id / module / key 改写成 X 后缀，渲染出的分支即带 X 后缀，对应 wire-* 照样转红），
     并把破坏写进副本的表；
  ③ 副本树补一份表文件，破坏才落得下去。

锚点纪律照旧：每处锚点须恰中 1 次，失配即退出且不写盘。
"""
import ast
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
TESTS = ROOT / 'tests'
BACKUP = Path('/tmp/rp_v3610b3_backup')
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b3] ast 自证通过')
if not BACKUP.exists():
    shutil.copytree(TESTS, BACKUP)
    print('[b3] tests/ 已备份 → %s' % BACKUP)

TROW = '    { id: "%s", module: "%s", key: "%s", cls: "%s", errTitle: "%s" },'

JOBS = [
    dict(
        file='system-v3450.test.mjs',
        idx_arg='index: rd(INDEX),',
        idx_new='index: routeSurface(rd(INDEX), TABLE_IN(dir)),',
        pairs=[
            ("""    q34: [INDEX,
        "} else if (appId === 'archive') {",
        "} else if (appId === 'archiveX') {"],""",
             """    q34: [LAZY_ROUTE_TABLE_REL,
        '%s',
        '%s'],""" % (TROW % ('archive', './apps/archive/archive-app.js', 'archiveApp', 'ArchiveApp', '存档台App'),
                     TROW % ('archiveX', './apps/archiveX/archive-app.js', 'archiveApp', 'ArchiveApp', '存档台App'))),
        ],
    ),
    dict(
        file='system-v3460.test.mjs',
        idx_arg='index: rd(INDEX),',
        idx_new='index: routeSurface(rd(INDEX), TABLE_IN(dir)),',
        pairs=[
            ("""    q33: [INDEX, '                } else if (appId === ' + Q + 'cotdesk' + Q + ') {',
        '                } else if (appId === ' + Q + 'cotdeskX' + Q + ') {'],""",
             """    q33: [LAZY_ROUTE_TABLE_REL,
        '%s',
        '%s'],""" % (TROW % ('cotdesk', './apps/cotdesk/cotdesk-app.js', 'cotdeskApp', 'CotdeskApp', '思维链案头App'),
                     TROW % ('cotdeskX', './apps/cotdeskX/cotdesk-app.js', 'cotdeskApp', 'CotdeskApp', '思维链案头App'))),
        ],
    ),
    dict(
        file='system-v3470.test.mjs',
        idx_arg='index: rd(INDEX),',
        idx_new='index: routeSurface(rd(INDEX), TABLE_IN(dir)),',
        pairs=[
            ("""    q21: [INDEX, "                } else if (appId === 'diagdesk') {",
        "                } else if (appId === 'diagdeskX') {"],""",
             """    q21: [LAZY_ROUTE_TABLE_REL,
        '%s',
        '%s'],""" % (TROW % ('diagdesk', './apps/diagdesk/diagdesk-app.js', 'diagdeskApp', 'DiagdeskApp', '诊断案头App'),
                     TROW % ('diagdeskX', './apps/diagdeskX/diagdesk-app.js', 'diagdeskApp', 'DiagdeskApp', '诊断案头App'))),
            ("""    q22: [INDEX, '                            if (!window.VirtualPhone.diagdeskApp) {' + NL + '                                window.VirtualPhone.diagdeskApp = new module.DiagdeskApp(phoneShell, storage);',
        '                            if (!window.VirtualPhone.diagdeskAppX) {' + NL + '                                window.VirtualPhone.diagdeskAppX = new module.DiagdeskApp(phoneShell, storage);'],""",
             """    q22: [LAZY_ROUTE_TABLE_REL,
        '%s',
        '%s'],""" % (TROW % ('diagdesk', './apps/diagdesk/diagdesk-app.js', 'diagdeskApp', 'DiagdeskApp', '诊断案头App'),
                     TROW % ('diagdesk', './apps/diagdesk/diagdesk-app.js', 'diagdeskAppX', 'DiagdeskApp', '诊断案头App'))),
        ],
    ),
]

WIRE_COPY = "    for (const rel of [APPS, STORAGE, INDEX, KEYS, PHONE_CSS]) {"
WIRE_COPY_NEW = "    for (const rel of [APPS, STORAGE, INDEX, KEYS, PHONE_CSS, LAZY_ROUTE_TABLE_REL]) {"

HELPER = """const TABLE_IN = (dir) => {
    const p = path.join(dir, LAZY_ROUTE_TABLE_REL);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : readRepoTable();
};
"""

fails = []
for J in JOBS:
    p = TESTS / J['file']
    src = p.read_text(encoding='utf-8')
    before = src
    for old, new in J['pairs']:
        n = src.count(old)
        if n != 1:
            fails.append('%s 破坏锚点命中 %d 次: %s' % (J['file'], n, old.strip()[:40]))
    n = src.count(J['idx_arg'])
    if n != 1:
        fails.append('%s ①index 取数行命中 %d 次' % (J['file'], n))
    n = src.count(WIRE_COPY)
    if n != 1:
        fails.append('%s ②副本树行命中 %d 次' % (J['file'], n))
    n = src.count('function wireJudgeAt(root) {')
    if n != 1:
        fails.append('%s ④wireJudgeAt 命中 %d 次' % (J['file'], n))
    if fails:
        continue
    for old, new in J['pairs']:
        src = src.replace(old, new)
    src = src.replace(J['idx_arg'], J['idx_new'])
    src = src.replace(WIRE_COPY, WIRE_COPY_NEW)
    src = src.replace('function wireJudgeAt(root) {', HELPER + 'function wireJudgeAt(root) {')
    m = re.search(r"^import \{ ([^}]+) \} from '\./_lazy_routes\.mjs';$", src, re.M)
    if not m:
        fails.append('%s ⑤找不到 _lazy_routes import' % J['file'])
        continue
    want = ['LAZY_ROUTE_TABLE_REL', 'readRepoTable', 'routeSurface', 'withRouteSurface']
    names = sorted(set([x.strip() for x in m.group(1).split(',') if x.strip()] + want))
    src = src.replace(m.group(0), "import { %s } from './_lazy_routes.mjs';" % ', '.join(names))
    if src == before:
        fails.append('%s 无变化' % J['file'])
        continue
    p.write_text(src, encoding='utf-8')
    print('  %-26s ok' % J['file'])

if fails:
    sys.exit('[b3] 失败：' + ' | '.join(fails))
print('[b3] 完成')