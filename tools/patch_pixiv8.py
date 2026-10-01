#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv8.py — 修两处**逗号落点**（patch_pixiv4 第三次尝试的残留）。

★ 现状（`index.js` 的重绑表 与 `tests/system-v255.test.mjs` 的目录映射表）：

        'lofterApp'       // [v3.34.0] 老福特：…
                          // …必须进表
    ,
        'pixivApp'        // [v3.35.0] Pixiv：…

  逗号被落在**注释块之后、独立成行** —— 语法合法（注释会被丢掉），
  但本仓同表其余各处一律是「逗号紧跟每一项的字面量之后、注释之前」。
  留着会成为后续按行解析者的坑，也让人误读成两行是同一项。

★ 修法：把逗号搬回 `'lofterApp'` 字面量之后，删掉孤立的 `,` 行。
★ 幂等：锚点命中次数 ≠ 1 即拒改；改后一律 `node --check`。
"""
import os
import subprocess
import sys
import tempfile

FAILS = []
TARGETS = ['index.js', 'tests/system-v255.test.mjs']


def check_js(text):
    fd, tmp = tempfile.mkstemp(suffix='.mjs')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        return (r.returncode == 0), (r.stderr or '').strip()[:300]
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def patch(path, old, new, tag):
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        FAILS.append('%s：%s 锚点命中 %d 次（应恰 1 次）' % (path, tag, n))
        return
    out = text.replace(old, new, 1)
    ok, err = check_js(out)
    if not ok:
        FAILS.append('%s：%s 改后语法不合法 %s' % (path, tag, err))
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('OK %s：%s' % (path, tag))


patch('index.js',
      "    'lofterApp'       // [v3.34.0] 老福特：",
      "    'lofterApp',      // [v3.34.0] 老福特：",
      '逗号搬回 lofterApp 字面量之后')

patch('index.js',
      "皆为视图态），换会话必须丢草稿重取，必须进表\n,\n    'pixivApp'",
      "皆为视图态），换会话必须丢草稿重取，必须进表\n    'pixivApp'",
      '删掉孤立的逗号行')

patch('tests/system-v255.test.mjs',
      "    lofterApp: 'lofter'        // [v3.34.0] 老福特：换会话丢草稿（短文批量 / 续章 / 评论 / 作者与文风格）与视图态并全量重取\n,\n",
      "    lofterApp: 'lofter',       // [v3.34.0] 老福特：换会话丢草稿（短文批量 / 续章 / 评论 / 作者与文风格）与视图态并全量重取\n",
      '目录映射表逗号归位（老福特项）')

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
print('OK patch_pixiv8 全部落地')
sys.exit(0)