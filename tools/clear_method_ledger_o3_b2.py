#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O3 第二批次：把两条已处置的链从**两张**账本里手工摘除。

摘什么：
  方法面 dead-method-baseline.json：
    SubsystemOrchestrator.manageRecoverySnapshot   ← orchestrator 退役（假驱动，调用全传错参）
    SubsystemOrchestrator.theatreRule             ← 同上
  模块面 dead-module-baseline.json：
    config/recovery-hub.js            ← 已真接进 apps/backupdesk（快照/差异/还原/体检）
    config/portable-recovery-hub.js   ← 同上（同一 App 的便携导出面）
    config/rule-theatre.js            ← 已真接进 apps/theater（规则面板）

为什么不用 `--update`：计划 R11-O3 明令禁止。--update 是拿现场读数整体覆盖账本，
  会把本版顺手引入的其它漂移一并洗白（本批次还剩 30 条链没动，绝不能一次洗平）。
  这里只删**确认已处置**的这 5 条，删前要求现场自证，删后要求计数只减预期值。

自证（任一不成立即中止，不改账本）：
  方法面两条 —— orchestrator 源码里**不能再出现方法声明**（`name(` 形式），
    只在注释里提名字不算接线；同时要求 App 侧真有对应入口字面量。
  模块面三条 —— App 侧必须出现该链的**键常量**与**入口名**，
    这是「模块被产品面真 import 且真调用」的最小可判据形态（不是 import 了就算数）。
"""
import json
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M_P = os.path.join(ROOT, 'scripts', 'dead-method-baseline.json')
D_P = os.path.join(ROOT, 'scripts', 'dead-module-baseline.json')
WRITE = '--write' in sys.argv

# (rel, cls, name)
METHOD_TARGETS = [
    ('config/subsystem-orchestrator.js', 'SubsystemOrchestrator', 'manageRecoverySnapshot'),
    ('config/subsystem-orchestrator.js', 'SubsystemOrchestrator', 'theatreRule'),
]
# rel → [(file, 必须出现的字面量), ...]
MODULE_TARGETS = {
    'config/recovery-hub.js': [
        ('apps/backupdesk/backupdesk-app.js', 'RH_KEY'),
        ('apps/backupdesk/backupdesk-app.js', 'captureSnapshot'),
        ('apps/backupdesk/backupdesk-app.js', 'restoreSnapshotKeys'),
    ],
    'config/portable-recovery-hub.js': [
        ('apps/backupdesk/backupdesk-app.js', 'inspectPayload'),
    ],
    'config/rule-theatre.js': [
        ('apps/theater/theater-app.js', 'RT_KEY'),
        ('apps/theater/theater-app.js', 'registerRule'),
        ('apps/theater/theater-app.js', 'evaluateEvent'),
    ],
}


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def fail(msg):
    print('❌ ' + msg)
    sys.exit(2)


def ok(msg):
    print('✔ ' + msg)


# ---------------- 1. 现场自证 ----------------
orch = read('config/subsystem-orchestrator.js')
for rel, cls, name in METHOD_TARGETS:
    # 方法面判活口径是行首匹配，退役后这里必须一个声明都不剩
    if re.search(r'(^|\n)[ \t]*' + re.escape(name) + r'\s*\(', orch):
        fail('%s 仍在 orchestrator 里以方法声明形式存在，拒绝摘账' % name)
ok('方法面自证：%s 已无声明（仅可能与注释无关）'
   % ', '.join(n for _, _, n in METHOD_TARGETS))

live_cache = {}
for rel, checks in MODULE_TARGETS.items():
    for f, token in checks:
        if f not in live_cache:
            live_cache[f] = read(f)
        if token not in live_cache[f]:
            fail('%s 里读不到 %s，%s 未被产品面真接线，拒绝摘账' % (f, token, rel))
ok('模块面自证：%d 件模块均有 App 侧键常量 + 入口名'
   % len(MODULE_TARGETS))

# ---------------- 2. 方法账本 ----------------
with io.open(M_P, encoding='utf-8') as f:
    mdoc = json.load(f)
m_before = len(mdoc['entries'])
hit = []
for rel, cls, name in METHOD_TARGETS:
    got = [e for e in mdoc['entries']
           if e.get('rel') == rel and e.get('cls') == cls and e.get('name') == name]
    if len(got) != 1:
        fail('方法条目 %s 命中 %d 条（期望 1）' % (name, len(got)))
    hit.append(got[0])
    print('  方法条目：%s:%d %s.%s（classInstantiated=%s）'
          % (got[0]['rel'], got[0]['line'], cls, name, got[0].get('classInstantiated')))
drop = {id(e) for e in hit}
mdoc['entries'] = [e for e in mdoc['entries'] if id(e) not in drop]
m_after = len(mdoc['entries'])
if m_after != m_before - len(METHOD_TARGETS):
    fail('方法账本删后计数异常：%d → %d' % (m_before, m_after))

# ---------------- 3. 模块账本 ----------------
with io.open(D_P, encoding='utf-8') as f:
    ddoc = json.load(f)
d_before = len(ddoc['entries'])
got_mods = []
for rel in MODULE_TARGETS:
    got = [e for e in ddoc['entries'] if e.get('rel') == rel]
    if len(got) != 1:
        fail('模块条目 %s 命中 %d 条（期望 1）' % (rel, len(got)))
    got_mods.append(got[0])
    print('  模块条目：%s（tier=%s, productImporters=%r）'
          % (rel, got[0].get('tier'), got[0].get('productImporters')))
dropd = {id(e) for e in got_mods}
ddoc['entries'] = [e for e in ddoc['entries'] if id(e) not in dropd]
d_after = len(ddoc['entries'])
if d_after != d_before - len(MODULE_TARGETS):
    fail('模块账本删后计数异常：%d → %d' % (d_before, d_after))

TAG = ('【v4.96.0 · R11-O3 批次2】'
       '已人工摘除（非 --update）：'
       '方法面 SubsystemOrchestrator.manageRecoverySnapshot / theatreRule '
       '两条为假驱动，已在 orchestrator 内退役（调用签名全错、返回形状对但内容空）；'
       '模块面 config/recovery-hub.js 与 config/portable-recovery-hub.js '
       '已真接进 apps/backupdesk（拍点/差异/还原/包体体检），'
       'config/rule-theatre.js 已真接进 apps/theater（规则面板，独立于小剧场生成流）。')

# ---------------- 4. 落盘 ----------------
print('  方法账本 %d → %d；模块账本 %d → %d' % (m_before, m_after, d_before, d_after))
if not WRITE:
    print('--- DRY RUN (pass --write) ---')
    sys.exit(0)

mdoc['note'] = mdoc.get('note', '') + ' ' + TAG
ddoc['note'] = ddoc.get('note', '') + ' ' + TAG
for path, doc in ((M_P, mdoc), (D_P, ddoc)):
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
ok('已写入两张账本')
