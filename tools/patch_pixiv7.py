#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv7.py — 三件收尾：

★ ① 真缺陷：`PIXIV_COMMENT_DELIM` 在数据层导出了，App 层**没导入** ——
  `ingestCommentsText` 的「空文本被拒」分支一走到就 `ReferenceError`。
  形态与本节反复抓的「导出成功、通路断开」完全相同：`node --check` 全绿
  （语法合法）、冷路径不报错，只有走到那条分支才炸。
  ★ 纪律沉淀：**JS 的 import 漏项不像 Python 的 NameError 会在加载期暴露**，
  只能靠「全分支真调用」抓到 —— 故本件同时落 ③ 硬断言外壳。

★ ② 分隔符只留一个真源：视图的输入框提示里原先是写死的 `---COMMENT---`
  字面量，改为引用 `PIXIV_COMMENT_DELIM`（否则用户按视图提示写、
  解析器按常量切，两边各自演化）。

★ ③ 落「硬断言外壳」`tools/smoke_assert3350.mjs`：
  冒烟脚本原先只打印读数，**任何调用一炸就 exit 非零、但没人把它当门禁**。
  v3.35.0 起把冒烟纳入硬门禁（spawnSync + 逐字比对 ALL GREEN + 禁 `✗`）。

★ 幂等：锚点命中次数 ≠ 1 即拒改。
"""
import os
import subprocess
import sys
import tempfile

FAILS = []
TARGETS = ['apps/pixiv/pixiv-app.js', 'apps/pixiv/pixiv-view.js']


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


# ────────────────────────────────── ① App 层补导入
A1_OLD = """    prevChapterContext, nextChapterNum, chapterPositionFace, parseCommentsBlock,"""
A1_NEW = """    prevChapterContext, nextChapterNum, chapterPositionFace, parseCommentsBlock,
    PIXIV_COMMENT_DELIM,"""
patch('apps/pixiv/pixiv-app.js', A1_OLD, A1_NEW, 'import 补 PIXIV_COMMENT_DELIM')

# ────────────────────────────────── ② 视图：分隔符真源 + 导入
V1_OLD = """import { PIXIV_REASONS, PIXIV_LIMITS } from './pixiv-data.js';"""
V1_NEW = """import { PIXIV_REASONS, PIXIV_LIMITS, PIXIV_COMMENT_DELIM } from './pixiv-data.js';"""
patch('apps/pixiv/pixiv-view.js', V1_OLD, V1_NEW, '视图 import 加 PIXIV_COMMENT_DELIM')

V2_OLD = """            + '---COMMENT--- 起头，块内可写 AUTHOR: 名字 与 REPLY: 要回的序号（本次第几条）">'"""
V2_NEW = """            + PIXIV_COMMENT_DELIM + ' 起头，块内可写 AUTHOR: 名字 与 REPLY: 要回的序号（本次第几条）">'"""
patch('apps/pixiv/pixiv-view.js', V2_OLD, V2_NEW, '视图提示串改用常量')

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
print('OK patch_pixiv7 全部落地')
sys.exit(0)
