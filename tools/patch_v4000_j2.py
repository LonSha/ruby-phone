#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.00.0 · R3-O7] 桥契约门 J2 修复：注册板 snapshot() 改名 readAll()。

lonsha_memory_bridge_v1 是推送型桥 —— 它的 snapshot 是对象字段。
第九道门 J2 判据：产品代码不得出现 .snapshot( 调用式。
任务板动作与桥字段同名会让维护者把字段当函数 call（本门记录过的真缺陷形态）。
故改名 readAll()：动作名与桥字段名彻底分离。
"""
import io, sys
EDIT = []


def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print('FAIL %s: 锚点命中 %d 次: %r' % (path, n, old[:70]))
            sys.exit(1)
        s = s.replace(old, new)
        EDIT.append(path)
    io.open(path, 'w', encoding='utf-8').write(s)
    print('OK  %s' % path)


D = '/home/user/ruby-phone/'
patch(D + 'index.js', [
    ('            snapshot() {\n                return mtrSummarizeTasks(Array.from(mediaTaskMap.values()));\n            },',
     '            readAll() {\n                return mtrSummarizeTasks(Array.from(mediaTaskMap.values()));\n            },'),
    ('         *   snapshot（聚合读数，供任务入口/诊断消费）。 */',
     '         *   readAll（聚合读数，供任务入口/诊断消费）。\n         *   [v4.00.0] 原名 snapshot()，改名理由见 tools/patch_v4000_j2.py ——\n         *   上游推送型桥的 snapshot 是对象字段，本板动作与它同名会让维护者\n         *   把字段当函数 call（本仓 bridge-contract 门 J2 钉住的正是这个形态）。 */'),
    ('remove、cancel（走 canCancel/applyCancel）、snapshot（聚合读数）；',
     'remove、cancel（走 canCancel/applyCancel）、readAll（聚合读数，原名 snapshot，因与推送型桥字段撞形改名）；'),
])

patch(D + 'apps/taskentry/taskentry-app.js', [
    ("        if (!board || typeof board.snapshot !== 'function') {",
     "        if (!board || typeof board.readAll !== 'function') {"),
    ('        const snap = board.snapshot();',
     '        const snap = board.readAll();'),
])

patch(D + 'tests/system-v4000.test.mjs', [
    ("for (const m of ['upsert(raw)', 'remove(key)', 'cancel(key)', 'snapshot()', 'shouldSkip(key)', 'selfCheck()']) {",
     "for (const m of ['upsert(raw)', 'remove(key)', 'cancel(key)', 'readAll()', 'shouldSkip(key)', 'selfCheck()']) {"),
])

print('--- changed %d ---' % len(EDIT))
