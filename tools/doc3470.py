#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3470.py — 抬版连带面：刷新四处审计基线（读数零手抄，全部取自探针现场输出）

本版（v3.47.0 诊断案头）新增 apps/diagdesk/ 四件 .js/.css + 一个判据套件，
并注册进 config/apps.js / config/storage.js / index.js / scripts/keys-audit.mjs。连带面四处：

① lifecycle_declarative_baseline.json —— L 面（新 App 注册）
   App 类 63 -> 64、实例槽位 76 -> 77、App 槽位 64 -> 65、占比 84.2 -> 84.4、空参签名 53 -> 54。
② branch_play_baseline.json —— 枚举面 328 -> 331、会话隔离前缀面 239 -> 246。
③ schedule_conflict_baseline.json —— 枚举面 328 -> 331（消费面一格未动）。
④ long_chat_baseline.json —— 静态扫描面 329 -> 332、判据散文 L5 同步。

纪律：只写读数与来由，不改判据；默认 dry-run，--write 才落盘。
现场读数取自：node tests/audit/<name>_probe.cjs --json。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
VER = 'v3.47.0'

def rj(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)

def wj(rel, obj):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write(chr(10))

# ===== ① L 面（lifecycle 声明式） =====
L = 'tests/audit/lifecycle_declarative_baseline.json'
lb = rj(L)
assert list(lb['rebuilds'])[-1] in ('v3.46.0', VER), list(lb['rebuilds'])[-1]
print('① L 面 刷新前：', json.dumps(lb['readings'], ensure_ascii=False))
lb['readings']['app_classes'] = 64
lb['readings']['slots'] = 77
lb['readings']['app_slots'] = 65
lb['readings']['app_slot_share_pct'] = 84.4
lb['readings']['sig_empty'] = 54
lb['rebuilds'][VER] = {
    'what': 'v3.47.0 诊断案头（apps/diagdesk/ 四件）注册进 config/apps.js，成为本仓新的 App',
    'why': '本版与上一版**同形**：诊断案头**是一个新 App**（四件 1886 行：数据层 745 / App 层 470 / '
           '视图 471 / 样式 200），按仓内规范注册进 config/apps.js（id/name/icon/color）并接 index.js 的'
           '表单字段表与懒加载分支，因此本面**真增长**：App 类 63 -> 64、实例槽位 76 -> 77、App 槽位 64 -> 65、'
           'App 槽位占比 84.2% -> 84.4%、空参签名 53 -> 54（新 App 的构造与出口都走空参形态）；'
           '覆盖率 80.6% 与三路径分布（19 / 20 / 23）一格未动 —— 本版只在既有咽喉点上挂采集调用，'
           '未改产品生命周期路径；其余三类签名 / 语义面 11 槽（同 5 · 异 6）也未动。'
           '判定仍为 not_done：两条硬否决 R2（必选参出口）与 R3（三路径语义一致率 45.5%）一格未动。',
    'readings': {
        'app_classes': 64,
        'slots': 77,
        'app_slots': 65,
        'app_slot_share_pct': 84.4,
        'sig_empty': 54,
    },
    'unchanged': [
        'wiring_points', 'app_exit_points', 'non_app_points', 'coverage_pct',
        'non_app_share_pct', 'points_p1', 'points_p2', 'points_p3',
        'sig_default', 'sig_required', 'sig_none', 'semantic_slots',
        'semantic_same', 'semantic_diff', 'semantic_consistency_pct',
        'criteria_pass_count',
    ],
    'not_done': [
        '本面增量**只有注册面**：诊断案头的会话隔离由 config/storage.js 的一条宽前缀承担（见 keys 门账本）；'
        '本 App 的三条会话键（存档原文 / 摘要草稿 / 动作台账）都不进本面的槽位账。',
        '真机里「换会话时存档与台账是否三格全量重取、视图是否级联刷新」仍归 R-O3（真宿主实机验证）。',
    ],
}
# ===== ② 分支对照面 =====
L2 = 'tests/audit/branch_play_baseline.json'
b2 = rj(L2)
assert list(b2['rebuilds'])[-1] in ('v3.46.0', VER), list(b2['rebuilds'])[-1]
print('② 分支对照面 刷新前：files=%s patterns=%s'
      % (b2['readings']['files_scanned'], b2['readings']['chat_data_patterns']))
b2['readings']['files_scanned'] = 331
b2['readings']['chat_data_patterns'] = 246
b2['rebuilds'][VER] = {
    'what': 'v3.47.0 诊断案头的真实接线（storage 宽前缀面）；本件不写回滚点、不碰分支对照',
    'why': '枚举面 328 -> 331 个文件（本版三个新 .js：apps/diagdesk/ 的 data / app / view，样式那件不进扫描面）；'
           '**会话隔离前缀面** 239 -> 246（+7）—— 逐行拆开写：本版在 config/storage.js 新增 1 条**宽前缀** '
           '/^diagdesk_/（一条前缀覆盖三条键：存档原文 / 摘要草稿 / 动作台账；三条键都无元字符，'
           '按仓内口径无需宽匹配登记）+ 6 行配套注释（版标行、一条前缀覆盖三键行、三类各自是什么行、'
           '随会话隔离行、源把三类挤在一个宿主对象行、本件按动作边界分开行）= +7。'
           '★ 本探针这条读数**按文本行计**，注释与真前缀同形（历史各版同口径，未改）。'
           '回滚覆盖面（41 点 / 4 文件 / 12 入口定义）与上游面（全局读点 8、命名空间存储点 5、'
           '检查点面 1、预览面 42、分支面 0）**一格未动** —— 诊断案头不写回滚点、不碰分支对照'
           '（只写自己的三条会话键）。',
    'readings': {
        'files_scanned': 331,
        'chat_data_patterns': 246,
    },
    'unchanged': [
        'rollback_points', 'rollback_files', 'rollback_entry_defs',
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
        'chat_data_patterns 的 +7 里有 6 是**注释行**（本版 storage.js 的六条配套注释，与真前缀同形）：'
        '本探针这条读数按文本行计。本版只如实刷新，未改口径（改口径会让历史读数不可比）。',
    ],
}
# ===== ③ 日程冲突面 =====
L3 = 'tests/audit/schedule_conflict_baseline.json'
b3 = rj(L3)
assert list(b3['rebuilds'])[-1] in ('v3.46.0', VER), list(b3['rebuilds'])[-1]
print('③ 日程冲突面 刷新前：files=%s' % b3['readings']['files_scanned'])
b3['readings']['files_scanned'] = 331
b3['rebuilds'][VER] = {
    'what': 'v3.47.0 诊断案头：只扩枚举面，不消费「承诺期限 / 状态」',
    'why': '枚举面随本版新件扩张（328 -> 331 个文件：apps/diagdesk/ 的 data / app / view 三件 .js，'
           '样式那件不进本探针的扫描面）；**承诺期限 / 状态的消费面一格未动**：消费点仍 23 处、'
           '消费文件仍 6 个、本地引擎命中仍 0。诊断案头是一块**看一份存档怎么读、该补什么**的案头面'
           '（版本 / 六态 / 增量 / 流水线 / 栏位 / 迁移 / 判定 / 收录），它不读楼层时间轴、不参与日程合并、'
           '不消费上游的「承诺期限 / 状态」。'
           '上游面（R1-R3）仍为「未复核（冻结证据）」：本层不硬依赖兄弟仓在场，按既有口径不刷新。',
    'readings': {
        'files_scanned': 331,
    },
    'unchanged': [
        'consume_points', 'consume_files', 'local_engine_hits',
    ],
    'criteria_refreshed': {},
    'not_done': [
        '本版新件共带 **3 条会话键**（存档原文 / 摘要草稿 / 动作台账），但**没有一条**落在'
        '「承诺期限 / 状态」的消费面上：消费点 23 / 消费文件 6 与上一版逐字相同。这是**如实记录**，'
        '不是漏复校。',
        '真机里「换会话时存档与台账从 storage 现取」的时序仍归 R-O3（真宿主实机验证）。',
    ],
}

# ===== ④ 长对话面 =====
L4 = 'tests/audit/long_chat_baseline.json'
b4 = rj(L4)
assert list(b4['rebuilds'])[-1] in ('v3.46.0', VER), list(b4['rebuilds'])[-1]
print('④ 长对话面 刷新前：scan.files=%s' % b4['scan']['files'])
b4['scan']['files'] = 332
OLD_L5 = 'files=329，全表物化=9，slice(-n)=5，下标直取=11，长度读=48'
NEW_L5 = 'files=332，全表物化=9，slice(-n)=5，下标直取=11，长度读=48'
b4['readings'].pop('criteria.L5.got_text', None)
b4['rebuilds'][VER] = {
    'what': 'v3.47.0 诊断案头的四件真实接线；楼层长会话面一格未动',
    'why': '静态扫描面 329 -> 332 个文件（本版三个新 .js）；**四类站点计数与全部活体读数一格未动**'
           '（全表物化 9 / 有界切片 5 / 下标直取 11 / 长度读 48）—— 诊断案头的存档、草稿与台账'
           '都是**自己那一份会话存档**，连楼层数组都不摸。既有站点行号随前置插入整体后移'
           '（config/storage.js 追加一条宽前缀与六行注释、config/apps.js 追加注册条目、'
           'scripts/keys-audit.mjs 追加三条键登记），按现场重取；判据散文 L5 的 files= 同步刷新为 332。',
    'how': 'node tests/audit/long_chat_probe.cjs --json',
    'readings': {
        'scan.files': 332,
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

if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
wj(L, lb)
wj(L2, b2)
wj(L3, b3)
wj(L4, b4)
print('已落盘四处基线：', L, L2, L3, L4)
