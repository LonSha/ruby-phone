#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.29.0 抬版交棒：按探针现场输出重建四份活基线（读数零手抄）。

纪律（与 v3.28.0 同）：
  · 所有数字来自 tests/audit/*_probe.cjs --json 的现场输出，脚本不写字面量；
  · 每份在 rebuilds 下登记 v3.29.0（what / why / readings / unchanged）；
  · 不做 --upstream ⇒ 上游面照旧「未复核」，不硬依赖兄弟仓在场；
  · 先算 draft、逐份断言（基线 file 字段不得被改写）、最后才落盘。

本版与上一版的差别：只新增 **1** 个 App（`apps/taobao`），故各读数只 +1 个量级；
`chat_data_patterns` 因新增一条前缀 + 一条配套注释行而 +2。

用法：
  python3 tools/rebuild_v3290.py --live <live_dir>           # dry-run
  python3 tools/rebuild_v3290.py --live <live_dir> --write   # 真写
"""
import argparse
import json
import os

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.29.0'

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
    same = [k for k in live if R[k] == live[k]]
    note('[lifecycle] 变化 %d 项：%s' % (len(changed), diff_line(R, live)))

    b['readings'] = {k: (live[k] if k in live else R[k]) for k in R}
    b['rebuilds'][V] = {
        'what': '桃宝 App 的**真实接线**（懒加载分支、重绑键、storage 前缀、样式投递、会话路径入口）',
        'why': ('素材缝合第 2 层第一批第一件落地（桃宝 `apps/taobao`）：新增 1 个 App 类 ⇒ '
                'App 类 %d → %d、实例槽位 %d → %d、App 槽位 %d → %d、签名「无参出口」%d → %d'
                '（`onChatChanged()` 无参）。**三条路径区间与接线点（%d / %d / %d、%d/%d/%d）一字未动** —— '
                '新 App 只进 `ST_PHONE_REBIND_APP_KEYS` 的泛化重绑循环，不在三处咽喉点上补出口调用。'
                '占比随分母按现场重算：App 槽位占比 %s%% → %s%%。'
                '判定仍为 not_done：决定性硬否决 R2（%d 个必选参出口）与 R3（三路径语义一致率 %s%%）一格未动 —— '
                '拿本版读数当「接近可实施」的证据是误读。'
                % (R['app_classes'], live['app_classes'], R['slots'], live['slots'],
                   R['app_slots'], live['app_slots'], R['sig_empty'], live['sig_empty'],
                   R['wiring_points'], R['app_exit_points'], R['non_app_points'],
                   R['points_p1'], R['points_p2'], R['points_p3'],
                   R['app_slot_share_pct'], live['app_slot_share_pct'],
                   live['sig_required'], live['semantic_consistency_pct'])),
        'readings': changed,
        'unchanged': same,
        'not_done': [
            ('新 App 的三条会话路径（p1/p2/p3）出口调用：计数 %d/%d/%d **一格未动** ⇒ 桃宝 **没有**在'
             '这三条路径上补出口调用（它不持有需要显式回收的资源：无定时器、无全局监听器、无 Audio 实例；'
             '换会话只丢缓存并重取目录 / 车 / 订单 / 抓取记录）。这是**如实记录**，不是漏复校。'
             % (live['points_p1'], live['points_p2'], live['points_p3'])),
            '真宿主上「点了入口真的进得去」不可测 —— 仍归 R-O3。',
        ],
    }
    return b, ['system-v324.test.mjs — A2 读数逐项 / A3 判据挂读数']


# ══════════════════ 2. schedule_conflict ══════════════════
def do_schedule():
    b = load_base('schedule_conflict')
    l = load('schedule_conflict')
    R = b['readings']
    live = {
        'files_scanned': l['filesScanned'],
        'consume_points': l['consumePoints'],
        'consume_files': len(l['consumeFiles']),
        'local_engine_hits': l['localEngineHits'],
    }
    assert set(live) == set(R), '读数键面必须一致'
    assert l['upstream']['checked'] is False, '未传 --upstream，上游面必须如实为未复核'

    def key(f):
        return f.get('file') if isinstance(f, dict) else f

    assert [key(f) for f in l['consumeFiles']] == [key(f) for f in b['consume_files']], \
        '消费文件名单必须逐字不变（防「数对了但文件换了」）'
    changed = {k: v for k, v in live.items() if R[k] != v}
    note('[schedule] 变化：%s' % diff_line(R, live))

    b['readings'] = {k: (live[k] if k in live else R[k]) for k in R}
    b['rebuilds'][V] = {
        'what': '桃宝 App 的**真实接线**（出口调用、样式投递、storage 前缀、会话路径入口）',
        'why': ('枚举面随新 App 扩张（%d → %d 个文件）；**承诺期限 / 状态的消费面一格未动**：'
                '消费点仍 %d 处、消费文件仍 %d 个、本地引擎命中仍 %d —— 桃宝不消费上游的'
                '「承诺期限 / 状态」（它是一册**本会话自有的商品 / 车 / 订单 / 抓取记录台账**，不读楼层时间轴、'
                '不参与日程合并）。上游面（R1–R3）仍为「未复核（冻结证据）」：'
                '本层不硬依赖兄弟仓在场，按既有口径不刷新。'
                % (R['files_scanned'], live['files_scanned'], live['consume_points'],
                   live['consume_files'], live['local_engine_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed],
        'criteria_refreshed': {},
        'not_done': [
            ('新 App 带 5 条会话隔离键（settings / products / cart / orders / grabs），但**没有一条**落在'
             '「承诺期限 / 状态」的消费面上：消费点 %d / 消费文件 %d 与上一版逐字相同。'
             '这是**如实记录**，不是漏复校。' % (live['consume_points'], live['consume_files'])),
            '真机里「换会话时目录 / 车 / 订单 / 抓取记录从 storage 现取」的时序仍归 R-O3（真宿主实机验证）。',
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
    note('[branch] 变化：%s' % diff_line(R, live))
    assert 'branch_face_hits' not in changed or live['branch_face_hits'] == 0, '分支面必须仍为 0'

    delta = live['chat_data_patterns'] - R['chat_data_patterns']
    b['readings'] = {k: (live[k] if k in live else R[k]) for k in R}
    b['rebuilds'][V] = {
        'what': '桃宝 App 的**真实接线**（出口调用、样式投递、storage 前缀、会话路径入口）',
        'why': ('枚举面 %d → %d 个文件；**新增 1 条会话隔离前缀**（`^taobao_` 一条覆盖五键：'
                '`taobao_settings` / `taobao_products` / `taobao_cart` / `taobao_orders` / `taobao_grabs`）'
                '⇒ 静态模式面 `chat_data_patterns` %d → %d（+%d：1 条真前缀 + %d 条配套注释行，'
                '本探针这条读数按文本行计，注释与真前缀同形）。'
                '回滚覆盖面（%d 点 / %d 文件 / %d 入口定义）与上游面（全局读点 %d、命名空间存储点 %d、'
                '检查点面 %d、预览面 %d、分支面 %d）**一格未动** —— 新 App 不写回滚点、不碰分支对照'
                '（只写自己的会话键）。'
                % (R['files_scanned'], live['files_scanned'], R['chat_data_patterns'], live['chat_data_patterns'],
                   delta, delta - 1,
                   live['rollback_points'], live['rollback_files'], live['rollback_entry_defs'],
                   live['upstream_global_read_sites'], live['namespace_store_sites'],
                   live['checkpoint_face_hits'], live['preview_face_hits'], live['branch_face_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed] + missing,
        'criteria_refreshed': {},
        'not_done': [
            ('上游面（R1–R4）仍是「未复核（冻结证据）」—— 未传 `--upstream`，跨仓探针不硬依赖兄弟仓在场。'
             '本版如实保留各冻结读数（%d 个模块 / 域内 %d 个 / 以 checkpoint 为名且带持久化的 %d 个），不当作绿。'
             % (R['upstream_modules_scanned'], R['upstream_branch_domain_modules'],
                R['upstream_checkpoint_named_persistent'])),
            ('`chat_data_patterns` 的 +%d 里有 %d 是**注释行**（新前缀各带一条配套注释，与真前缀同形）：'
             '本探针这条读数按文本行计，注释与真前缀同形。本版只如实刷新，未改口径（改口径会让历史读数不可比）。'
             % (delta, delta - 1)),
        ],
    }
    return b, ['system-v326.test.mjs — A2 读数逐项 / A3 判据形状']


# ══════════════════ 4. long_chat ══════════════════
def do_long_chat():
    b = load_base('long_chat')
    l = load('long_chat')
    prev_files = b['scan']['files']
    changed_scan = {k: v for k, v in l['scan'].items() if b['scan'].get(k) != v}
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
        'what': '桃宝 App 的**真实接线**（出口调用、样式投递、storage 前缀、会话路径入口）',
        'why': ('静态扫描面 %d → %d 个文件；**四类站点计数与全部 %d 项活体读数一格未动** '
                '（全表物化 %d / 有界切片 %d / 下标直取 %d / 长度读 %d）—— 桃宝不消费楼层序列'
                '（只画自己的目录 / 车 / 订单时间线 / 抓取记录）。'
                '既有站点行号随前置插入整体后移（`index.js` 追加懒加载分支与重绑键、`phone.css` 追加本件样式、'
                '`config/apps.js` 与 `config/storage.js` 各追加登记），按现场重取；'
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