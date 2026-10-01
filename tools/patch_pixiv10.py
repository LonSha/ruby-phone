#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv10.py — 收回 patch_pixiv9 带出的一处**新坑**。

★ 坑是什么：patch_pixiv9 为了让下游「按下标配对原始章」，把 `chKept` 以
  `rawChapters` 键挂在 `normalizeNovel` 的**返回值**上。于是：

    Object.keys(normalizeNovel({...})) 里多出 `rawChapters`

  而 `probe()` 拿规范化结果当作品本体（`this.novels = np.kept.map(normalize...)`），
  `_persistContent()` 又把 `this.novels` 原样写盘 ⇒ **盘上每篇作品多存一份章的
  完整副本**（章正文各存两份，60 篇 × 60 章的体积直接翻倍），且任何读
  `novel` 的消费面都会看到一个与 `chapters` 并列的重复数组。

★ 为什么不必带出：`initNovelPopularity(novel, cold)` 的**入参就是盘上的原始对象**
  （`probe()` 直接把解析出来的裸对象传进来），原始章本来就在 `novel.chapters` 里，
  且下标一一对应。收回这个键、改读入参即可，配对语义不变。

★ 幂等：锚点命中次数 ≠ 1 即拒改；改后一律 `node --check`。
"""
import os
import subprocess
import sys
import tempfile

FAILS = []
TARGETS = ['apps/pixiv/pixiv-data.js']


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


# ① 收回 `rawChapters` 键（不许挂在作品本体上：会随写盘把章副本翻倍）
patch('apps/pixiv/pixiv-data.js',
      '        rawChapters: chKept,\n',
      '',
      '收回 rawChapters（不随作品对象写盘）')

# ② 改读入参原始数组（`initNovelPopularity` 的入参就是盘上裸对象）
patch('apps/pixiv/pixiv-data.js',
      '    const rawArr = Array.isArray(n.rawChapters) ? n.rawChapters\n'
      '        : ((novel && Array.isArray(novel.chapters)) ? novel.chapters : []);',
      '    // ★ 原始章从**入参**取（`probe()` 传进来的就是盘上裸对象，下标一一对应）；\n'
      '    //   不许从规范化结果上取 —— 那个键若挂上去会随写盘把每章的正文副本翻倍。\n'
      '    const rawArr = (novel && Array.isArray(novel.chapters)) ? novel.chapters : [];',
      'initNovelPopularity 改读入参原始章')

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
print('OK patch_pixiv10 全部落地')
sys.exit(0)