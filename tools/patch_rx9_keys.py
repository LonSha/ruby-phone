#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 注册面补丁 ⑤：三个新键登记（K1 准入）。

与 patch_rx9_wire.py 拆开的原因：那四个补丁点（apps / 路由 / 矩阵 / phone.css）
一次执行即落定，**不可重跑**（锚点已被替换，重跑会 FAIL）；键登记是另一件事，
单独成脚本便于「只补这一格」。合在一起会让整份脚本不可重入 —— 本仓口径：
补丁脚本必须在锚点已替换后**明确失败**（而不是静默跳过），故拆开。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
PATH = 'scripts/keys-audit.mjs'
src = io.open(ROOT + '/' + PATH, encoding='utf-8').read()

ANCHOR = "  { key: '__migration_ledger', scope: 'global', note: '存储层迁移留痕账本（version+keys）' },"
NEW = """  /* [v3.93.0 · R-X9] 无障碍操作层三键。**全部命中 /^sys_/ ⇒ 会话隔离**：
   *   口径与 sys_motion_level / sys_shell_scale 一致 —— 「这台手机怎么显示」随会话走，
   *   这也是计划验收「设置重开后保留，且按会话正确隔离」的落点。
   *   刻意不新开「低动画」与「字体缩放」键：前者就是 sys_motion_level、后者就是
   *   phone-font-scale（同一件事两个存储位必然漂移）。 */
  { key: 'sys_access_level', scope: 'chat', note: '操作层档位（standard / enhanced / large，随会话隔离）' },
  { key: 'sys_access_compact', scope: 'chat', note: '紧凑列表开关（随会话隔离）' },
  { key: 'sys_access_theme', scope: 'chat', note: '主题档（auto / light / dark，随会话隔离）' },
""" + ANCHOR

if "key: 'sys_access_level'" in src:
    print('skip（已登记，幂等）')
    sys.exit(0)
n = src.count(ANCHOR)
if n != 1:
    print('FAIL 锚点命中 %d 次（要求恰中 1 次）' % n)
    sys.exit(1)
io.open(ROOT + '/' + PATH, 'w', encoding='utf-8').write(src.replace(ANCHOR, NEW, 1))
print('OK keys-audit.mjs 登记三键 %d -> %d 字节' % (len(src), len(src) + len(NEW) - len(ANCHOR)))