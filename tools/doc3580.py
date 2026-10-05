#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3580.py — 抬版 v3.58.0 连带面：刷新四处审计基线（读数零手抄，全部取自探针现场输出）

本版（v3.58.0 O4 会话世代栅栏 / O5 写入回执）新增产品侧 2 件 .js
（config/session-gate.js、config/write-receipt.js）+ 3 个判据套件（tests/system-v3570/3580/3590.test.mjs）。
连带面四处：
① lifecycle_declarative_baseline.json —— L 面：App 类 76 -> 77、App 槽位 77 -> 78、
   占比 86.5 -> 87.6、空参签名 66 -> 67（精确归因到 SearchApp：O4 给它补了 onChatChanged 出口）。
② branch_play_baseline.json —— 枚举面 368 -> 370（消费面 / 回滚面一格未动）。
③ schedule_conflict_baseline.json —— 枚举面 368 -> 370（消费面一格未动）。
④ long_chat_baseline.json —— 静态扫描面 369 -> 371、判据散文 L5 同步。
纪律：只写读数与来由，不改判据；默认 dry-run，--write 才落盘。
现场读数取自：node tests/audit/<name>_probe.cjs --json。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
VER = 'v3.58.0'
PREV = 'v3.57.0'


def rj(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def wj(rel, obj):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write(chr(10))


def live(name):
    """现场跑探针取真读数（本脚本不手抄：写进去的每个数都要与现场逐项相同）。"""
    import subprocess
    r = subprocess.run(['node', 'tests/audit/%s_probe.cjs' % name, '--json'],
                       cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, '%s 探针必须能跑通：%s' % (name, r.stderr[:300])
    return json.loads(r.stdout)


LC = live('lifecycle_declarative')
BP = live('branch_play')
SC = live('schedule_conflict')
LG = live('long_chat')
assert LC['appClasses'] == 77 and LC['appSlots'] == 78 and LC['signatures']['empty'] == 67, LC
assert round(LC['appSlotShare'] * 100, 1) == 87.6, LC['appSlotShare']
assert round(LC['coverage'] * 100, 1) == 80.6, LC['coverage']
assert BP['filesScanned'] == 370 and SC['filesScanned'] == 370, (BP['filesScanned'], SC['filesScanned'])
assert LG['scan']['files'] == 371, LG['scan']
L5_LIVE = [c for c in LG['criteria'] if c['id'] == 'L5'][0]['got_text']
assert L5_LIVE == 'files=371，全表物化=9，slice(-n)=5，下标直取=11，长度读=48', L5_LIVE


# ===== ① L 面（lifecycle 声明式） =====
L = 'tests/audit/lifecycle_declarative_baseline.json'
lb = rj(L)
assert list(lb['rebuilds'])[-1] in ('v3.54.0', PREV, VER), list(lb['rebuilds'])[-1]
print('① L 面 刷新前：', json.dumps(lb['readings'], ensure_ascii=False))
lb['readings']['app_classes'] = LC['appClasses']
lb['readings']['app_slots'] = LC['appSlots']
lb['readings']['app_slot_share_pct'] = round(LC['appSlotShare'] * 100, 1)
lb['readings']['sig_empty'] = LC['signatures']['empty']
lb['rebuilds'][VER] = {
    'what': 'v3.58.0 O4 会话世代栅栏 + O5 写入回执：搜索 App 进换会话重绑表（补 onChatChanged 出口）',
    'why': '本面**真增长一格**：App 类 76 -> 77、App 槽位 77 -> 78、App 槽位占比 86.5% -> 87.6%、'
           '空参签名 66 -> 67 —— 增量**精确归因到 SearchApp**：O4 为「换会话后上一段会话的全历史扫描'
           '仍算当前代际」补了 `onChatChanged()`（invalidateAll + _syncHostSources）并登记进 '
           'ST_PHONE_REBIND_APP_KEYS。本面只计「定义了出口的类」，故它此刻才进类账；出口是空参形态，'
           '故空参签名同步 +1。★ 与 v3.47.0 那版同形（新增 App 注册）不同源：本版**没有新增 App**，'
           '增长的只是「既有 App 补了一条实例出口」这一格。'
           '接线点总数 62、App 出口 50、非 App 12、覆盖率 80.6%、三路径分布 19/20/23、'
           '语义槽位 11（同 5 · 异 6）一格未动 —— 本版不新增生命周期咽喉点，只在既有重绑表上挂一格。'
           '判定仍为 not_done：两条硬否决 R2（必选参出口）与 R3（三路径语义一致率 45.5%）一格未动。',
    'readings': {
        'app_classes': 77,
        'app_slots': 78,
        'app_slot_share_pct': 87.6,
        'sig_empty': 67,
    },
    'unchanged': [
        'slots', 'wiring_points', 'app_exit_points', 'non_app_points', 'coverage_pct',
        'non_app_share_pct', 'points_p1', 'points_p2', 'points_p3',
        'sig_default', 'sig_required', 'sig_none', 'semantic_slots',
        'semantic_same', 'semantic_diff', 'semantic_consistency_pct',
        'criteria_pass_count',
    ],
    'not_done': [
        '本面增量只有**出口注册**这一格：搜索 App 的会话隔离由它自己那份 _scanGen 承担，'
        '不进本面的槽位账。',
        '真机里「换会话时上一段会话那轮全历史扫描是否真的被作废」仍归 R-O3（真宿主实机验证）；'
        '本面只证明`出口在场`，不证明它被真调过。',
    ],
}

# ===== ② 分支对照面 =====
L2 = 'tests/audit/branch_play_baseline.json'
b2 = rj(L2)
assert list(b2['rebuilds'])[-1] in ('v3.54.0', 'v3.55.0', PREV, VER), list(b2['rebuilds'])[-1]
print('② 分支对照面 刷新前：files=%s patterns=%s'
      % (b2['readings']['files_scanned'], b2['readings']['chat_data_patterns']))
b2['readings']['files_scanned'] = BP['filesScanned']
b2['rebuilds'][VER] = {
    'what': 'v3.58.0 O4/O5：两条新真源（config/session-gate.js · config/write-receipt.js）；本件不写回滚点',
    'why': '枚举面 368 -> 370 个文件（本版三个新 .js 里，两个产品侧真源进本探针扫描面：'
           'config/session-gate.js 与 config/write-receipt.js；第三个是 tests/system-v3590.test.mjs，'
           '`tests/` 不在本探针的扫描面）。**会话隔离前缀面（chat_data_patterns）279 一格未动** —— '
           '本版七族写回口接的是「出发时记令牌 + 写回前裁决」，裁决结果落在内存账本'
           '（sessionDropLog 有界快照），**不新增任何会话键、也不新增 storage 前缀**：'
           '回执面只回答「这次调用落了没有」，不引入新的持久化面。'
           '回滚覆盖面（41 点 / 4 文件 / 12 入口定义）与上游面（全局读点 8、命名空间存储点 5、'
           '检查点面 1、预览面 42、分支面 0）**一格未动** —— 会话栅栏不写回滚点、不碰分支对照。',
    'readings': {
        'files_scanned': 370,
    },
    'unchanged': [
        'rollback_points', 'rollback_files', 'rollback_entry_defs', 'chat_data_patterns',
        'upstream_global_read_sites', 'namespace_store_sites', 'checkpoint_face_hits',
        'preview_face_hits', 'branch_face_hits', 'upstream_modules_scanned',
        'upstream_branch_domain_modules', 'upstream_checkpoint_named',
        'upstream_checkpoint_named_persistent', 'upstream_branch_domain_preview_hits',
        'upstream_branch_guard_loadable', 'upstream_ledger_replay_loadable',
        'upstream_bridge_snapshot_branch_faces',
    ],
    'criteria_refreshed': {},
    'not_done': [
        '上游面（R1-R4）仍是「未复核（冻结证据）」—— 未传 --upstream，跨仓探针不硬依赖兄弟仓在场。'
        '本版如实保留各冻结读数（65 个模块 / 域内 18 个 / 以 checkpoint 为名且带持久化的 0 个），不当作绿。',
        '本版新增的两件真源都是**进程内**真源（世代号与回执判定），没有持久化态：'
        '故本面既不新增会话隔离前缀、也不新增回滚点。这是如实记录，不是漏复校。',
    ],
}

# ===== ③ 日程冲突面 =====
L3 = 'tests/audit/schedule_conflict_baseline.json'
b3 = rj(L3)
assert list(b3['rebuilds'])[-1] in ('v3.54.0', 'v3.55.0', PREV, VER), list(b3['rebuilds'])[-1]
print('③ 日程冲突面 刷新前：files=%s' % b3['readings']['files_scanned'])
b3['readings']['files_scanned'] = SC['filesScanned']
b3['rebuilds'][VER] = {
    'what': 'v3.58.0 O4/O5：只扩枚举面，不消费「承诺期限 / 状态」',
    'why': '枚举面随本版新件扩张（368 -> 370 个文件：config/session-gate.js 与 config/write-receipt.js；'
           '判据套件不进本探针扫描面）；**承诺期限 / 状态的消费面一格未动**：消费点仍 23 处、'
           '消费文件仍 6 个、本地引擎命中仍 0。本版治的是「回信跨会话落错桶」与「写入报成功但其实没落」，'
           '两者都不读楼层时间轴、不参与日程合并、不消费上游的「承诺期限 / 状态」。'
           '上游面（R1-R3）仍为「未复核（冻结证据）」：本层不硬依赖兄弟仓在场，按既有口径不刷新。',
    'readings': {
        'files_scanned': 370,
    },
    'unchanged': [
        'consume_points', 'consume_files', 'local_engine_hits',
    ],
    'criteria_refreshed': {},
    'not_done': [
        '本版新增的两件真源都不落在「承诺期限 / 状态」的消费面上：消费点 23 / 消费文件 6 '
        '与上一版逐字相同。这是如实记录，不是漏复校。',
        '真机里「换会话时在飞的日程请求是否被栅栏挡下」的时序仍归 R-O3（真宿主实机验证）。',
    ],
}

# ===== ④ 长对话面 =====
L4 = 'tests/audit/long_chat_baseline.json'
b4 = rj(L4)
assert list(b4['rebuilds'])[-1] in ('v3.54.0', 'v3.55.0', PREV, VER), list(b4['rebuilds'])[-1]
print('④ 长对话面 刷新前：scan.files=%s' % b4['scan']['files'])
b4['scan']['files'] = LG['scan']['files']
OLD_L5 = 'files=369，全表物化=9，slice(-n)=5，下标直取=11，长度读=48'
NEW_L5 = L5_LIVE
b4['rebuilds'][VER] = {
    'what': 'v3.58.0 O4/O5 的两件新真源进扫描面；楼层长会话面一格未动',
    'why': '静态扫描面 369 -> 371 个文件（config/session-gate.js 与 config/write-receipt.js）；'
           '**四类站点计数与全部活体读数一格未动**（全表物化 9 / 有界切片 5 / 下标直取 11 / 长度读 48）'
           '—— 本版治的是「在飞的写回口」与「写入回执」，两者都不摸楼层数组。'
           '既有站点行号随前置插入整体后移（config 目录新增两件、index.js 追加三处 bumpSessionEpoch '
           '与七族写回口的令牌判定），按现场重取；判据散文 L5 的 files= 同步刷新为 371。',
    'how': 'node tests/audit/long_chat_probe.cjs --json',
    'readings': {
        'scan.files': 371,
        'criteria.L5.got_text': NEW_L5,
    },
    'criteria_refreshed': {
        'L5': [OLD_L5, NEW_L5],
    },
    'unchanged': [
        '四类静态站点计数',
        '全部活体读数',
        'timing（计时类，按口径不刷新）',
    ],
}
hits = []
for c in b4['criteria']:
    if c.get('got_text') == OLD_L5:
        c['got_text'] = NEW_L5
        hits.append(c.get('id'))
print('④ 判据散文命中并刷新：', hits)
assert hits in ([], ['L5']), hits
assert 'criteria.L5.got_text' not in b4['readings'], 'readings 必须严格等于探针现场读数（多一个键就转红）'
# ── 未动项对账：`unchanged` 里列的每个键都必须与现场逐项相同（防「顺手改了还写没动」）──
LIVE_L = {
    'slots': LC['slots'],
    'wiring_points': LC['wiringPoints'],
    'app_exit_points': LC['appExitPoints'],
    'non_app_points': LC['nonAppPoints'],
    'coverage_pct': round(LC['coverage'] * 100, 1),
    'non_app_share_pct': round(LC['nonAppShare'] * 100, 1),
    'points_p1': LC['pointsByPath']['P1'],
    'points_p2': LC['pointsByPath']['P2'],
    'points_p3': LC['pointsByPath']['P3'],
    'sig_default': LC['signatures']['def'],
    'sig_required': LC['signatures']['required'],
    'sig_none': LC['signatures']['none'],
    'semantic_slots': LC['semanticSlots'],
    'semantic_same': LC['semanticSame'],
    'semantic_diff': LC['semanticDiff'],
    'semantic_consistency_pct': round(LC['semanticConsistency'] * 100, 1),
    'criteria_pass_count': len([c for c in LC['criteria'] if c['pass']]),
}
LIVE_B = {
    'rollback_points': BP['rollbackPoints'],
    'rollback_files': BP['rollbackFiles'],
    'rollback_entry_defs': BP['rollbackEntryDefs'],
    'chat_data_patterns': BP['chatDataPatterns'],
    'upstream_global_read_sites': BP['upstreamGlobalReadSites'],
    'namespace_store_sites': BP['namespaceStoreSites'],
    'checkpoint_face_hits': BP['checkpointFaceHits'],
    'preview_face_hits': BP['previewFaceHits'],
    'branch_face_hits': BP['branchFaceHits'],
}
LIVE_S = {
    'consume_points': SC['consumePoints'],
    'consume_files': len(SC['consumeFiles']),
    'local_engine_hits': SC['localEngineHits'],
}
for tag, frozen, livevals in (('①L', lb, LIVE_L), ('②B', b2, LIVE_B), ('③S', b3, LIVE_S)):
    for k in frozen['rebuilds'][VER]['unchanged']:
        if k not in livevals:
            continue
        assert frozen['readings'][k] == livevals[k], \
            '%s 未动项 %s 与现场不符：基线 %s / 现场 %s' % (tag, k, frozen['readings'][k], livevals[k])
print('未动项对账通过（三面）')

if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
wj(L, lb)
wj(L2, b2)
wj(L3, b3)
wj(L4, b4)
print('已落盘四处基线：', L, L2, L3, L4)
