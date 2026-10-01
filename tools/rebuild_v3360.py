#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rebuild_v3360.py — 抬版 v3.36.0 交棒：按探针现场输出重建四份活基线（读数零手抄）。

做什么：读四个探针的 `--json` 现场输出，逐份只更新**真变化**项，并在 `rebuilds`
        下登记本版段（what / why / readings / unchanged / not_done）。
纪律（与 v3.30.0 / v3.32.0 / v3.33.0 / v3.34.0 / v3.35.0 同）：
  · 所有数字来自现场 JSON，脚本里不写字面量；
  · 基线 `file` 字段不得被改写；消费文件 / 回滚文件名单必须逐字不变；
  · 不做 `--upstream` ⇒ 上游面照旧「未复核（冻结证据）」，不硬依赖兄弟仓在场；
  · 先算 draft、逐份断言，最后才落盘（一次成型的写入不留半成品）。
★ 本版与上一版的关键差别：与 v3.34.0 / v3.35.0 **同形** —— 本版同样**新增了一个 App**
  （`apps/magazine/` 四件，注册进 `config/apps.js`），故 lifecycle 面是**真增长**
  （+1 App 类 / +1 实例槽位 / +1 App 槽位 / +1 空参签名），脚本按现场断言这组增量。
  ★ 本版 storage.js 加的是**一条宽前缀 + 四行配套注释 = +6 行**（上一版是 +5）：
  本版注释多一行（把「三条键各自是什么」拆成两行写），按现场如实登记。
用法：
  python3 tools/rebuild_v3360.py --live <live_dir>            # dry-run
  python3 tools/rebuild_v3360.py --live <live_dir> --write    # 真写
"""
import argparse
import json
import os

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.36.0'

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
    """探针给 0–1 比值，基线存 1 位小数百分数（与既有各版口径同）。"""
    return round(float(x) * 100, 1)


def note(msg):
    print(msg)


def diff_line(old, new):
    return ', '.join('%s %s→%s' % (k, old[k], new[k]) for k in new if old.get(k) != new[k]) or '（无）'


# ══════════════════ 1. lifecycle_declarative ══════════════════
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
    assert set(live) == set(R), '读数键面必须一致（探针形态变了就该先对齐口径）'
    crit = {c['id']: c for c in l['criteria']}
    assert crit['R2']['pass'] is False and crit['R3']['pass'] is False, '两条硬否决必须仍不达'
    assert l['verdict'] == 'not_done', '总判定必须仍为 not_done'
    changed = {k: v for k, v in live.items() if R[k] != v}
    for k, d in (('app_classes', 1), ('slots', 1), ('app_slots', 1), ('sig_empty', 1)):
        assert changed.get(k, R[k]) == R[k] + d, \
            '本面本版应 %s +%d，实得 %s' % (k, d, changed.get(k))
    for k in changed:
        assert k in ('app_classes', 'slots', 'app_slots', 'app_slot_share_pct', 'coverage_pct',
                     'non_app_share_pct', 'sig_empty'), '不该动的读数动了：' + k
    note('[lifecycle] 变化：%s' % diff_line(R, live))
    b['readings'] = {k: live[k] for k in R}
    b['rebuilds'][V] = {
        'what': 'v3.36.0 杂志（`apps/magazine/` 四件）注册进 `config/apps.js`，成为本仓新的 App',
        'why': ('本版与前两版**同形**：杂志**是一个新 App**（四件 2617 行：数据层 911 / App 层 466 / '
                '视图 639 / 样式 601），按仓内规范注册进 `config/apps.js`（id/name/icon/color）'
                '并接 `index.js` 的重绑表与懒加载分支，'
                '因此本面**真增长**：App 类 %d → %d、实例槽位 %d → %d、App 槽位 %d → %d、'
                'App 槽位占比 %s%% → %s%%、覆盖率 %s%% → %s%%、非 App 占比 %s%% → %s%%、'
                '空参签名 %d → %d（新 App 的构造与出口都走空参形态）；'
                '接线点 / 三路径分布 / 其余三类签名 / 语义面 %d 槽（同 %d · 异 %d）一格未动。'
                '判定仍为 not_done：两条硬否决 R2（必选参出口）与 R3（三路径语义一致率 %s%%）一格未动 ——'
                '本版没有触碰这条「声明式生命周期准入」的任一面。'
                % (R['app_classes'], live['app_classes'], R['slots'], live['slots'],
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
            ('本面增量**只有注册面**：杂志的「会话隔离」由 `config/storage.js` 的一条宽前缀承担'
             '（见 keys 门账本），与生命周期出口无关；'
             '本 App 的三条会话键（设置 / 内容 / 台账）都不进本面的槽位账。'),
            '真机里「换角色时杂志是否全量重取、视图是否级联刷新」仍归 R-O3（真宿主实机验证）。',
        ],
    }
    return b, ['system-v324.test.mjs — A2 读数逐项 / A3 判据挂读数']


# ══════════════════ 2. schedule_conflict ══════════════════
def do_schedule():
    b = load_base('schedule_conflict')
    l = load('schedule_conflict')
    R = b['readings']
    assert l['consumeFiles'] == b['consume_files'], \
        '消费文件名单必须逐字不变（防「数对了但文件换了」）'
    live = {
        'files_scanned': l['filesScanned'],
        'consume_points': l['consumePoints'],
        'consume_files': len(l['consumeFiles']),
        'local_engine_hits': l['localEngineHits'],
    }
    assert set(live) == set(R), '读数键面必须一致'
    changed = {k: v for k, v in live.items() if R[k] != v}
    assert set(changed) <= {'files_scanned'}, '本版只许枚举面变化，实得：%s' % diff_line(R, live)
    note('[schedule] 变化：%s' % diff_line(R, live))
    b['readings'] = {k: live[k] for k in R}
    b['rebuilds'][V] = {
        'what': 'v3.36.0 杂志：只扩枚举面，不消费「承诺期限 / 状态」',
        'why': ('枚举面随本版新件扩张（%d → %d 个文件：`apps/magazine/` 的 data / app / view 三件 .js，'
                '样式那件不进本探针的扫描面）；'
                '**承诺期限 / 状态的消费面一格未动**：消费点仍 %d 处、消费文件仍 %d 个、本地引擎命中仍 %d。'
                '杂志是一块**内容编辑部**（十型稿件 / 十套解析 / 四套导出 / 译文块），'
                '它不读楼层时间轴、不参与日程合并、不消费上游的「承诺期限 / 状态」。'
                '上游面（R1–R3）仍为「未复核（冻结证据）」：本层不硬依赖兄弟仓在场，按既有口径不刷新。'
                % (R['files_scanned'], live['files_scanned'], live['consume_points'],
                   live['consume_files'], live['local_engine_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed],
        'criteria_refreshed': {},
        'not_done': [
            ('本版新件共带 **3 条会话键**（设置 / 内容 / 台账），但**没有一条**落在'
             '「承诺期限 / 状态」的消费面上：消费点 %d / 消费文件 %d 与上一版逐字相同。'
             '这是**如实记录**，不是漏复校。'
             % (live['consume_points'], live['consume_files'])),
            '真机里「换会话时稿件从 storage 现取」的时序仍归 R-O3（真宿主实机验证）。',
        ],
    }
    return b, ['system-v325.test.mjs — A2 读数逐项 / A3 判据挂读数']


# ══════════════════ 3. branch_play ══════════════════
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
    note('[branch] 现场缺键（来自上游面，未传 --upstream 故不刷新）：%s' % missing)
    assert l['rollbackFilesList'] == b['rollback_files_list'], '回滚文件名单必须逐字不变'
    changed = {k: v for k, v in live.items() if R.get(k) != v}
    assert set(changed) <= {'files_scanned', 'chat_data_patterns'}, \
        '本版只许枚举面与会话隔离前缀面变化，实得：%s' % diff_line(R, live)
    note('[branch] 变化：%s' % diff_line(R, live))
    assert 'branch_face_hits' not in changed or live['branch_face_hits'] == 0, '分支面必须仍为 0'
    delta = live['chat_data_patterns'] - R['chat_data_patterns']
    assert delta == 6, '本版会话隔离前缀面应 +6（1 条宽前缀 + 5 行配套注释），实得 +%d' % delta
    b['readings'] = {k: (live[k] if k in live else R[k]) for k in R}
    b['rebuilds'][V] = {
        'what': 'v3.36.0 杂志的真实接线（storage 宽前缀面）；本件不写回滚点、不碰分支对照',
        'why': ('枚举面 %d → %d 个文件（本版三个新 .js）；'
                '**会话隔离前缀面** %d → %d（+%d）—— 逐行拆开写：本版在 `config/storage.js` 新增 '
                '1 条**宽前缀** `/^magazine_/,`（一条前缀覆盖三条键：设置 / 内容 / 台账；三条键都无元字符，'
                '按仓内口径「无需宽匹配登记」）+ 5 行配套注释（`// [v3.36.0] 杂志…`、'
                '`//   一条前缀覆盖三键…`、`//   设置…、内容…、`、`//   台账…各自独立。`、'
                '`//   随会话隔离…`）= +6。'
                '★ 本探针这条读数**按文本行计**，注释与真前缀同形（历史各版同口径，未改）。'
                '回滚覆盖面（%d 点 / %d 文件 / %d 入口定义）与上游面（全局读点 %d、命名空间存储点 %d、'
                '检查点面 %d、预览面 %d、分支面 %d）**一格未动** —— 杂志不写回滚点、不碰分支对照'
                '（只写自己的三条会话键）。'
                % (R['files_scanned'], live['files_scanned'],
                   R['chat_data_patterns'], live['chat_data_patterns'], delta,
                   live['rollback_points'], live['rollback_files'], live['rollback_entry_defs'],
                   live['upstream_global_read_sites'], live['namespace_store_sites'],
                   live['checkpoint_face_hits'], live['preview_face_hits'], live['branch_face_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed] + missing,
        'criteria_refreshed': {},
        'not_done': [
            ('上游面（R1–R4）仍是「未复核（冻结证据）」—— 未传 `--upstream`，跨仓探针不硬依赖兄弟仓在场。'
             '本版如实保留各冻结读数（%d 个模块 / 域内 %d 个 / 以 checkpoint 为名且带持久化的 %d 个），'
             '不当作绿。'
             % (R['upstream_modules_scanned'], R['upstream_branch_domain_modules'],
                R['upstream_checkpoint_named_persistent'])),
            ('`chat_data_patterns` 的 +%d 里有 5 是**注释行**（本版 storage.js 的五条配套注释，与真前缀同形）：'
             '本探针这条读数按文本行计。本版只如实刷新，未改口径（改口径会让历史读数不可比）。'
             % delta),
        ],
    }
    return b, ['system-v326.test.mjs — A2 读数逐项 / A3 判据形状']


# ══════════════════ 4. long_chat ══════════════════
def do_long_chat():
    b = load_base('long_chat')
    l = load('long_chat')
    prev_files = b['scan']['files']
    changed_scan = {k: v for k, v in l['scan'].items() if b['scan'].get(k) != v}
    assert set(changed_scan) <= {'files'}, '只许静态扫描面文件数变化，实得：%s' % changed_scan
    assert b['readings'] == l['readings'], '活体读数必须一格未动（对不上就该如实查形态）'
    for k, old_list in b['sites'].items():
        new_list = l['sites'][k]
        assert len(old_list) == len(new_list), '站点条数必须不变：' + k
        assert [str(x).split(':')[0] for x in old_list] == [str(x).split(':')[0] for x in new_list], \
            '站点文件名单必须逐项不变（只允许行号后移）：' + k
    moved = [(k, o, n) for k, ol in b['sites'].items() for o, n in zip(ol, l['sites'][k]) if o != n]
    note('[long_chat] 站点行号后移 %d 处（文件名与条数不变）：%s'
         % (len(moved), ', '.join('%s %s→%s' % x for x in moved[:6]) or '（无）'))
    l5 = next(c for c in l['criteria'] if c['id'] == 'L5')
    l5_text = l5['gotText'] if l5.get('gotText') is not None else l5['got_text']
    b_l5 = next(c for c in b['criteria'] if c['id'] == 'L5')
    old_l5_text = b_l5['got_text']
    note('[long_chat] scan 变化：%s' % diff_line(b['scan'], l['scan']))
    note('[long_chat] 活体读数项数 %d（一格未动）' % len(l['readings']))
    note('[long_chat] L5：%s  →  %s' % (old_l5_text, l5_text))
    b['scan'] = {k: l['scan'][k] for k in b['scan']}
    b_l5['got_text'] = l5_text
    b['rebuilds'][V] = {
        'what': 'v3.36.0 杂志的真实接线；楼层长会话面一格未动',
        'why': ('静态扫描面 %d → %d 个文件（本版三个新 .js）；'
                '**四类站点计数与全部 %d 项活体读数一格未动** '
                '（全表物化 %d / 有界切片 %d / 下标直取 %d / 长度读 %d）—— 杂志的稿件与译文都是'
                '**自己那一份会话存档**，连楼层数组都不摸。'
                '既有站点行号随前置插入整体后移（`config/storage.js` 追加一条宽前缀与五行注释、'
                '`config/apps.js` 追加注册条目），按现场重取；'
                '判据散文 L5 的 `files=` 同步刷新为 %d。'
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
        assert json.load(f)['file'] == draft['file'], '基线 file 字段不得被改写：' + name
    out.append((name, (draft, gates)))
print('\n==== 待写入 ====')
for name, (b, gates) in out:
    print('  %s · rebuilds 新键 %s · 受影响判据：%s' % (name, V, ' / '.join(gates)))

if args.write:
    for name, (b, _g) in out:
        p = os.path.join(AUDIT, name + '_baseline.json')
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(b, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('  写入', p, os.path.getsize(p))
    print('done（已写 %d 份）' % len(out))
else:
    print('（dry-run，未写入）')