#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# rebuild_v3390.py — 抬版 v3.39.0 交棒：按探针现场输出重建四份活基线（读数零手抄）。
# 做什么：读四个探针的 --json 现场输出，逐份只更新**真变化**项，并在 rebuilds
#         下登记本版段（what / why / readings / unchanged / not_done）。
# 纪律（与 v3.30.0 / v3.32.0 ~ v3.38.0 同）：
#   · 所有数字来自现场 JSON，脚本里不写字面量；
#   · 基线 file 字段不得被改写；消费文件 / 回滚文件名单必须逐字不变；
#   · 不做 --upstream ⇒ 上游面照旧「未复核（冻结证据）」；
#   · 先算 draft、逐份断言，最后才落盘（一次成型，不留半成品）。
# ★ 本版与前几版同形：新增了一个 App（apps/sourcebook/ 四件），故 lifecycle 面是
#   真增长（+1 App 类 / +1 实例槽位 / +1 App 槽位 / +1 空参签名）；
#   config/storage.js 加一条宽前缀 + 4 行配文注释 = +5。
import argparse
import json
import os

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.39.0'

ap = argparse.ArgumentParser()
ap.add_argument('--live', required=True, help='探针 --json 输出落盘目录（live_<name>.json）')
ap.add_argument('--write', action='store_true', help='真写；缺省为 dry-run')
args = ap.parse_args()
LIVE = args.live


def load(name):
    with open(os.path.join(LIVE, 'live_%s.json' % name), encoding='utf-8') as f:
        return json.load(f)


def load_base(name):
    with open(os.path.join(AUDIT, name + '_baseline.json'), encoding='utf-8') as f:
        return json.load(f)


def pct(x):
    """探针给 0-1 比值，基线存 1 位小数百分数（与既有各版口径同）。"""
    return round(float(x) * 100, 1)


def count_lines(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return sum(1 for _ in f)


c_lines = {p: count_lines('apps/sourcebook/' + p) for p in
           ('sourcebook-data.js', 'sourcebook-app.js', 'sourcebook-view.js', 'sourcebook.css')}


def note(msg):
    print(msg)


def diff_line(old, new):
    return ', '.join('%s %s->%s' % (k, old[k], new[k]) for k in new if old.get(k) != new[k]) or '(none)'


# ======================= 1. lifecycle_declarative =======================
def do_lifecycle():
    b = load_base('lifecycle_declarative')
    l = load('lifecycle_declarative')
    R = b['readings']
    live = {
        'app_classes': l['appClasses'],
        'slots': l['slots'],
        'app_slots': l['appSlots'],
        'app_slot_share_pct': pct(l['appSlotShare']),
        'wiring_points': l['wiringPoints'],
        'app_exit_points': l['appExitPoints'],
        'non_app_points': l['nonAppPoints'],
        'coverage_pct': pct(l['coverage']),
        'non_app_share_pct': pct(l['nonAppShare']),
        'points_p1': l['pointsByPath']['P1'],
        'points_p2': l['pointsByPath']['P2'],
        'points_p3': l['pointsByPath']['P3'],
        'sig_empty': l['signatures']['empty'],
        'sig_default': l['signatures']['def'],
        'sig_required': l['signatures']['required'],
        'sig_none': l['signatures']['none'],
        'semantic_slots': l['semanticSlots'],
        'semantic_same': l['semanticSame'],
        'semantic_diff': l['semanticDiff'],
        'semantic_consistency_pct': pct(l['semanticConsistency']),
        'criteria_pass_count': sum(1 for c in l['criteria'] if c.get('pass')),
    }
    assert set(live) == set(R), 'readings key face must match'
    crit = {c['id']: c for c in l['criteria']}
    assert crit['R2']['pass'] is False and crit['R3']['pass'] is False, 'two hard vetoes must still fail'
    assert l['verdict'] == 'not_done', 'verdict must still be not_done'
    changed = {k: v for k, v in live.items() if R[k] != v}
    for k, d in (('app_classes', 1), ('slots', 1), ('app_slots', 1), ('sig_empty', 1)):
        assert changed.get(k, R[k]) == R[k] + d, 'this face must grow %s by %d, got %s' % (k, d, changed.get(k))
    for k in changed:
        assert k in ('app_classes', 'slots', 'app_slots', 'app_slot_share_pct', 'coverage_pct',
                     'non_app_share_pct', 'sig_empty'), 'unexpected reading moved: ' + k
    note('[lifecycle] changed: %s' % diff_line(R, live))
    b['readings'] = {k: live[k] for k in R}
    b['rebuilds'][V] = {
        'what': 'v3.39.0 时光胶囊（apps/sourcebook/ 四件）注册进 config/apps.js，成为本仓新的 App',
        'why': (
            '本版与前几版**同形**：时光胶囊**是一个新 App**（四件 %d 行：数据层 %d / App 层 %d / '
            '视图 %d / 样式 %d），按仓内规范注册进 config/apps.js（id/name/icon/color）'
            '并接 index.js 的重绑表与懒加载分支，'
            '因此本面**真增长**：App 类 %d -> %d、实例槽位 %d -> %d、App 槽位 %d -> %d、'
            'App 槽位占比 %s%% -> %s%%、覆盖率 %s%% -> %s%%、非 App 占比 %s%% -> %s%%、'
            '空参签名 %d -> %d（新 App 的构造与出口都走空参形态）；'
            '接线点 / 三路径分布 / 其余三类签名 / 语义面 %d 槽（同 %d · 异 %d）一格未动。'
            '判定仍为 not_done：两条硬否决 R2（必选参出口）与 R3（三路径语义一致率 %s%%）一格未动。'
            % (sum(c_lines.values()), c_lines['sourcebook-data.js'], c_lines['sourcebook-app.js'],
               c_lines['sourcebook-view.js'], c_lines['sourcebook.css'],
               R['app_classes'], live['app_classes'], R['slots'], live['slots'],
               R['app_slots'], live['app_slots'],
               R['app_slot_share_pct'], live['app_slot_share_pct'],
               R['coverage_pct'], live['coverage_pct'],
               R['non_app_share_pct'], live['non_app_share_pct'],
               R['sig_empty'], live['sig_empty'],
               live['semantic_slots'], live['semantic_same'], live['semantic_diff'],
               live['semantic_consistency_pct'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed],
        'not_done': [
            '本面增量**只有注册面**：时光胶囊的会话隔离由 config/storage.js 的一条宽前缀承担（见 keys 门账本）；'
            '本 App 的三条会话键（封存 / 策略 / 台账）都不进本面的槽位账。',
            '真机里「换角色时时光胶囊是否全量重取、视图是否级联刷新」仍归 R-O3（真宿主实机验证）。',
        ],
    }
    return b, ['system-v324.test.mjs — A2 读数逐项 / A3 判据挂读数']


# ======================= 2. schedule_conflict =======================
def do_schedule():
    b = load_base('schedule_conflict')
    l = load('schedule_conflict')
    R = b['readings']
    assert l['consumeFiles'] == b['consume_files'], 'consume file list must stay byte-identical'
    live = {
        'files_scanned': l['filesScanned'],
        'consume_points': l['consumePoints'],
        'consume_files': len(l['consumeFiles']),
        'local_engine_hits': l['localEngineHits'],
    }
    assert set(live) == set(R), 'readings key face must match'
    changed = {k: v for k, v in live.items() if R[k] != v}
    assert set(changed) <= {'files_scanned'}, 'only enum face may move: %s' % diff_line(R, live)
    note('[schedule] changed: %s' % diff_line(R, live))
    b['readings'] = {k: live[k] for k in R}
    b['rebuilds'][V] = {
        'what': 'v3.39.0 时光胶囊：只扩枚举面，不消费「承诺期限 / 状态」',
        'why': (
            '枚举面随本版新件扩张（%d -> %d 个文件：apps/sourcebook/ 的 data / app / view 三件 .js，'
            '样式那件不进本探针的扫描面）；'
            '**承诺期限 / 状态的消费面一格未动**：消费点仍 %d 处、消费文件仍 %d 个、本地引擎命中仍 %d。'
            '时光胶囊是一块**封存取回治理面**（跨度分档 / 口吻分族 / 硬约束校验 / 回信归一 / 读数台账），'
            '它不读楼层时间轴、不参与日程合并、不消费上游的「承诺期限 / 状态」。'
            '上游面（R1-R3）仍为「未复核（冻结证据）」：本层不硬依赖兄弟仓在场，按既有口径不刷新。'
            % (R['files_scanned'], live['files_scanned'], live['consume_points'],
               live['consume_files'], live['local_engine_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed],
        'criteria_refreshed': {},
        'not_done': [
            '本版新件共带 **3 条会话键**（封存 / 策略 / 台账），但**没有一条**落在'
            '「承诺期限 / 状态」的消费面上：消费点 %d / 消费文件 %d 与上一版逐字相同。这是**如实记录**，不是漏复校。'
            % (live['consume_points'], live['consume_files']),
            '真机里「换会话时策略与台账从 storage 现取」的时序仍归 R-O3（真宿主实机验证）。',
        ],
    }
    return b, ['system-v325.test.mjs — A2 读数逐项 / A3 判据挂读数']


# ======================= 3. branch_play =======================
def do_branch():
    b = load_base('branch_play')
    l = load('branch_play')
    R = b['readings']
    live = {
        'files_scanned': l['filesScanned'],
        'rollback_points': l['rollbackPoints'],
        'rollback_files': l['rollbackFiles'],
        'rollback_entry_defs': l['rollbackEntryDefs'],
        'upstream_global_read_sites': l['upstreamGlobalReadSites'],
        'chat_data_patterns': l['chatDataPatterns'],
        'namespace_store_sites': l['namespaceStoreSites'],
        'checkpoint_face_hits': l['checkpointFaceHits'],
        'preview_face_hits': l['previewFaceHits'],
        'branch_face_hits': l['branchFaceHits'],
    }
    missing = [k for k in R if k not in live]
    note('[branch] live missing keys (upstream face, no --upstream so not refreshed): %s' % missing)
    assert l['rollbackFilesList'] == b['rollback_files_list'], 'rollback file list must stay byte-identical'
    changed = {k: v for k, v in live.items() if R.get(k) != v}
    assert set(changed) <= {'files_scanned', 'chat_data_patterns'}, \
        'only enum face and chat-isolation prefix face may move: %s' % diff_line(R, live)
    note('[branch] changed: %s' % diff_line(R, live))
    assert 'branch_face_hits' not in changed or live['branch_face_hits'] == 0, 'branch face must stay 0'
    delta = live['chat_data_patterns'] - R['chat_data_patterns']
    assert delta == 5, 'chat isolation prefix face must grow 5 (1 wide prefix + 4 comment lines), got +%d' % delta
    b['readings'] = {k: (live[k] if k in live else R[k]) for k in R}
    b['rebuilds'][V] = {
        'what': 'v3.39.0 时光胶囊的真实接线（storage 宽前缀面）；本件不写回滚点、不碰分支对照',
        'why': (
            '枚举面 %d -> %d 个文件（本版三个新 .js）；'
            '**会话隔离前缀面** %d -> %d（+%d）—— 逐行拆开写：本版在 config/storage.js 新增 '
            '1 条**宽前缀** /^sourcebook_/,（一条前缀覆盖三条键：封存 / 策略 / 台账；三条键都无元字符，按仓内口径无需宽匹配登记）'
            '+ 4 行配套注释（版标行、一条前缀覆盖三键行、三键各自独立行、随会话隔离行）= +5。'
            '★ 本探针这条读数**按文本行计**，注释与真前缀同形（历史各版同口径，未改）。'
            '回滚覆盖面（%d 点 / %d 文件 / %d 入口定义）与上游面（全局读点 %d、命名空间存储点 %d、'
            '检查点面 %d、预览面 %d、分支面 %d）**一格未动** —— 时光胶囊不写回滚点、不碰分支对照（只写自己的三条会话键）。'
            % (R['files_scanned'], live['files_scanned'],
               R['chat_data_patterns'], live['chat_data_patterns'], delta,
               live['rollback_points'], live['rollback_files'], live['rollback_entry_defs'],
               live['upstream_global_read_sites'], live['namespace_store_sites'],
               live['checkpoint_face_hits'], live['preview_face_hits'], live['branch_face_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed] + missing,
        'criteria_refreshed': {},
        'not_done': [
            '上游面（R1-R4）仍是「未复核（冻结证据）」—— 未传 --upstream，跨仓探针不硬依赖兄弟仓在场。'
            '本版如实保留各冻结读数（%d 个模块 / 域内 %d 个 / 以 checkpoint 为名且带持久化的 %d 个），不当作绿。'
            % (R['upstream_modules_scanned'], R['upstream_branch_domain_modules'],
               R['upstream_checkpoint_named_persistent']),
            'chat_data_patterns 的 +%d 里有 4 是**注释行**（本版 storage.js 的四条配套注释，与真前缀同形）：'
            '本探针这条读数按文本行计。本版只如实刷新，未改口径（改口径会让历史读数不可比）。' % delta,
        ],
    }
    return b, ['system-v326.test.mjs — A2 读数逐项 / A3 判据形状']


# ======================= 4. long_chat =======================
def do_long_chat():
    b = load_base('long_chat')
    l = load('long_chat')
    prev_files = b['scan']['files']
    changed_scan = {k: v for k, v in l['scan'].items() if b['scan'].get(k) != v}
    assert set(changed_scan) <= {'files'}, 'only static scan file count may move: %s' % changed_scan
    assert b['readings'] == l['readings'], 'live readings must be untouched'
    for k, old_list in b['sites'].items():
        new_list = l['sites'][k]
        assert len(old_list) == len(new_list), 'site count must stay: ' + k
        assert [str(x).split(':')[0] for x in old_list] == [str(x).split(':')[0] for x in new_list], \
            'site file list must stay item-identical (only line numbers may shift): ' + k
    moved = [(k, o, n) for k, ol in b['sites'].items() for o, n in zip(ol, l['sites'][k]) if o != n]
    note('[long_chat] site line shifts %d (files and counts unchanged): %s'
         % (len(moved), ', '.join('%s %s->%s' % x for x in moved[:6]) or '(none)'))
    l5 = next(c for c in l['criteria'] if c['id'] == 'L5')
    l5_text = l5['gotText'] if l5.get('gotText') is not None else l5['got_text']
    b_l5 = next(c for c in b['criteria'] if c['id'] == 'L5')
    old_l5_text = b_l5['got_text']
    note('[long_chat] scan changed: %s' % diff_line(b['scan'], l['scan']))
    note('[long_chat] live readings count %d (untouched)' % len(l['readings']))
    note('[long_chat] L5: %s  ->  %s' % (old_l5_text, l5_text))
    b['scan'] = {k: l['scan'][k] for k in b['scan']}
    b_l5['got_text'] = l5_text
    b['rebuilds'][V] = {
        'what': 'v3.39.0 时光胶囊的真实接线；楼层长会话面一格未动',
        'why': (
            '静态扫描面 %d -> %d 个文件（本版三个新 .js）；'
            '**四类站点计数与全部 %d 项活体读数一格未动** '
            '（全表物化 %d / 有界切片 %d / 下标直取 %d / 长度读 %d）—— 时光胶囊的封存书架、'
            '读数面与回执台账都是**自己那一份会话存档**，连楼层数组都不摸。'
            '既有站点行号随前置插入整体后移（config/storage.js 追加一条宽前缀与四行注释、'
            'config/apps.js 追加注册条目），按现场重取；判据散文 L5 的 files= 同步刷新为 %d。'
            % (prev_files, l['scan']['files'], len(l['readings']), l['scan']['full_materialize'],
               l['scan']['bounded_slice'], l['scan']['indexed_loop'], l['scan']['length_read'],
               l['scan']['files'])),
        'how': 'node tests/audit/long_chat_probe.cjs --json',
        'readings': {'scan.files': l['scan']['files'], 'criteria.L5.got_text': l5_text},
        'criteria_refreshed': {'L5': [old_l5_text, l5_text]},
        'unchanged': ['四类静态站点计数', '全部 %d 项活体读数' % len(l['readings']),
                      'timing（计时类，按口径不刷新）'],
    }
    return b, ['system-v327.test.mjs — A2 读数逐项 / FM1 判据散文可复算']


JOBS = [
    ('lifecycle_declarative', do_lifecycle),
    ('schedule_conflict', do_schedule),
    ('branch_play', do_branch),
    ('long_chat', do_long_chat),
]

out = []
for name, fn in JOBS:
    draft, gates = fn()
    with open(os.path.join(AUDIT, name + '_baseline.json'), encoding='utf-8') as f:
        assert json.load(f)['file'] == draft['file'], 'baseline file field must not be rewritten: ' + name
    out.append((name, (draft, gates)))

print('')
print('==== to write ====')
for name, (b, gates) in out:
    print('  %s . rebuilds key %s . affected gates: %s' % (name, V, ' / '.join(gates)))
if args.write:
    for name, (b, _g) in out:
        p = os.path.join(AUDIT, name + '_baseline.json')
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(b, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('  wrote', p, os.path.getsize(p))
    print('done (%d files)' % len(out))
else:
    print('(dry-run, nothing written)')
