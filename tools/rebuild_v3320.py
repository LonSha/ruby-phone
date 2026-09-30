#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.32.0 抬版交棒：按探针现场输出重建四份活基线（读数零手抄）。

纪律（与 v3.30.0 同）：
  · 所有数字来自 tests/audit/*_probe.cjs --json 的现场输出，脚本不写字面量；
  · 每份在 rebuilds 下登记 v3.32.0（what / why / readings / unchanged / not_done）；
  · 不做 --upstream ⇒ 上游面照旧「未复核」，不硬依赖兄弟仓在场；
  · 先算 draft、逐份断言（基线 file 字段不得被改写），最后才落盘。

★ 本版与上一版的**关键差别**：基线停在 v3.30.0，而这次要补的是**两版**的连带面
  （v3.31.0 约会大作战 + v3.32.0 游戏厅上半四件里新增的两个子游戏）——
  故各读数增量是两版之和，`why` 里逐版拆开写清，不含糊成一句「随新件扩张」。
  且本版**没有新增 App 类**（两个子游戏挂在既有 `apps/games/` 下，不进 `config/apps.js`），
  故 lifecycle 面的增量**全部来自 v3.31.0**，本版对它是一格未动。

用法：
  python3 tools/rebuild_v3320.py --live <live_dir>            # dry-run
  python3 tools/rebuild_v3320.py --live <live_dir> --write    # 真写
"""
import argparse
import json
import os

ROOT = '/home/user/ruby-phone'
AUDIT = os.path.join(ROOT, 'tests', 'audit')
V = 'v3.32.0'

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
        'what': 'v3.31.0 约会大作战 App 的**真实接线**（懒加载分支、重绑键、storage 前缀、样式投递、会话路径入口）'
                '；本版（v3.32.0）两个子游戏**不进本面**',
        'why': ('本面基线停在 v3.30.0，这次补的是**两版**的连带面 —— 但增量**全部来自 v3.31.0**：'
                '约会大作战新增 1 个 App 类（`apps/date`）⇒ App 类 %d → %d、实例槽位 %d → %d、App 槽位 %d → %d、'
                '签名「无参出口」%d → %d（它的 `onChatChanged()` 无参，进签名「空列表」那一格）。'
                '**本版（v3.32.0）在这一面一格未动**：海龟汤 / 你说我猜是挂在既有 `apps/games/` 下的两个子游戏'
                '（`games-app.js` 里的内部视图切换 + 两张大厅卡片），**不新增 App 类、不进 `config/apps.js`、'
                '不新增实例槽位** —— 故本版对这一面是「如实的一格未动」，不是漏复校。'
                '占比随分母按现场重算：App 槽位占比 %s%% → %s%%。'
                '**三条路径区间与接线点（%d / %d / %d、%d/%d/%d）一字未动** —— 新 App 只进 '
                '`ST_PHONE_REBIND_APP_KEYS` 的泛化重绑循环，不在三处咽喉点上补出口调用；两个子游戏连槽位都没有。'
                '判定仍为 not_done：决定性硬否决 R2（%d 个必选参出口）与 R3（三路径语义一致率 %s%%）一格未动 —— '
                '拿本版读数当「接近可实施」的证据是误读。'
                % (R['app_classes'], live['app_classes'], R['slots'], live['slots'],
                   R['app_slots'], live['app_slots'], R['sig_empty'], live['sig_empty'],
                   R['app_slot_share_pct'], live['app_slot_share_pct'],
                   R['wiring_points'], R['app_exit_points'], R['non_app_points'],
                   R['points_p1'], R['points_p2'], R['points_p3'],
                   live['sig_required'], live['semantic_consistency_pct'])),
        'readings': changed,
        'unchanged': same,
        'not_done': [
            ('新 App（date）的三条会话路径（p1/p2/p3）出口调用：计数 %d/%d/%d **一格未动** ⇒ 约会大作战 **没有**在'
             '这三条路径上补出口调用（它不持有需要显式回收的资源：无定时器、无全局监听器、无 Audio 实例；'
             '换会话只丢草稿与视图态并全量重取场景册 / 场次 / 欠账）。这是**如实记录**，不是漏复校。'
             % (live['points_p1'], live['points_p2'], live['points_p3'])),
            ('本版两个子游戏（海龟汤 / 你说我猜）**刻意不进本面**：它们是 `apps/games/` 的内部视图，'
             '生命周期由父类 `GamesApp` 一条管到底（`games-app.js` 里两处级联清退）。'
             '它们的「换会话不许串味」由会话键隔离保证，不由本面保证 —— 本面量的是**会话路径出口调用**，'
             '两个子游戏不新增槽位，故本面对它们无话可说（这本身就是如实读数）。'),
            '真宿主上「点了入口真的进得去」不可测 —— 仍归 R-O3。',
        ],
    }
    return b, ['system-v324.test.mjs — A2 读数逐项 / A3 判据挂读数 / D4 无参出口 +1']


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
        'what': 'v3.31.0 约会大作战 App 的**真实接线**（出口调用、样式投递、storage 前缀、会话路径入口）'
                '；v3.32.0 两个子游戏同样只扩枚举面',
        'why': ('枚举面随两版新件扩张（%d → %d 个文件：v3.31.0 的 `apps/date/` 三件 ＋ v3.32.0 的 '
                '`apps/games/seaturtle/` 与 `apps/games/guesswhat/` 各两件 .js）；'
                '**承诺期限 / 状态的消费面一格未动**：消费点仍 %d 处、消费文件仍 %d 个、本地引擎命中仍 %d —— '
                '约会大作战是一册**本会话自有的约会台账**（场景册 / 场次 / 欠账），'
                '海龟汤与你说我猜是**一局对话型对局**（谜题 / 日志 / 回合），'
                '三者都不读楼层时间轴、不参与日程合并、不消费上游的「承诺期限 / 状态」。'
                '上游面（R1–R3）仍为「未复核（冻结证据）」：'
                '本层不硬依赖兄弟仓在场，按既有口径不刷新。'
                % (R['files_scanned'], live['files_scanned'], live['consume_points'],
                   live['consume_files'], live['local_engine_hits'])),
        'readings': changed,
        'unchanged': [k for k in live if k not in changed],
        'criteria_refreshed': {},
        'not_done': [
            ('两版新件共带 9 条会话隔离键（date：settings / scenes / store 三键；'
             'seaturtle / guesswhat 各一态键），但**没有一条**落在「承诺期限 / 状态」的消费面上：'
             '消费点 %d / 消费文件 %d 与上一版逐字相同。这是**如实记录**，不是漏复校。'
             % (live['consume_points'], live['consume_files'])),
            '真机里「换会话时场景册 / 场次 / 欠账 / 一局对局态从 storage 现取」的时序仍归 R-O3（真宿主实机验证）。',
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
        'what': 'v3.31.0 约会大作战与 v3.32.0 两个子游戏的**真实接线**（出口调用、样式投递、storage 前缀、'
                '会话路径入口）；两版都不写回滚点、不碰分支对照',
        'why': ('枚举面 %d → %d 个文件（两版新件 .js 之和）；'
                '**会话隔离前缀面** %d → %d（+%d），两版**各 +5**，逐版拆开写：'
                'v3.31.0 新增 1 条真前缀 `/^date_/` ＋ 4 条配套注释行 = +5；'
                'v3.32.0 新增 2 条**精确枚举**（`/^chat_games_seaturtle_state$/` 与 '
                '`/^chat_games_guesswhat_state$/`，父前缀 `/^chat_games_/` 已能自动接住，'
                '列出来只为「游戏厅里现在有哪几款按聊天独立存档」可一眼可数）＋ 3 条配套注释行 = +5。'
                '★ 本探针这条读数**按文本行计**，注释与真前缀同形（历史各版同口径，未改）。'
                '回滚覆盖面（%d 点 / %d 文件 / %d 入口定义）与上游面（全局读点 %d、命名空间存储点 %d、'
                '检查点面 %d、预览面 %d、分支面 %d）**一格未动** —— 两版新件都不写回滚点、不碰分支对照'
                '（只写自己的会话键）。'
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
             '本版如实保留各冻结读数（%d 个模块 / 域内 %d 个 / 以 checkpoint 为名且带持久化的 %d 个），不当作绿。'
             % (R['upstream_modules_scanned'], R['upstream_branch_domain_modules'],
                R['upstream_checkpoint_named_persistent'])),
            ('`chat_data_patterns` 的 +%d 里有 %d 是**注释行**（两版各带数条配套注释，与真前缀同形）：'
             '本探针这条读数按文本行计，注释与真前缀同形。本版只如实刷新，未改口径（改口径会让历史读数不可比）。'
             '★ 另需注意：本次 +%d 是**两版之和**（基线停在 v3.30.0），不是单版增量。'
             % (delta, delta - 2, delta)),
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
        'what': 'v3.31.0 与 v3.32.0 两版新件的**真实接线**（出口调用、样式投递、storage 前缀、会话路径入口）',
        'why': ('静态扫描面 %d → %d 个文件（两版新件 .js 之和：`apps/date/` 三件 ＋ 两个子游戏各两件）；'
                '**四类站点计数与全部 %d 项活体读数一格未动** '
                '（全表物化 %d / 有界切片 %d / 下标直取 %d / 长度读 %d）—— 约会大作战不消费楼层序列'
                '（只画自己的场景册 / 场次 / 欠账），两个子游戏的日志是**自己那一局的内存与存档**，'
                '连楼层数组都不摸。'
                '既有站点行号随前置插入整体后移（`index.js` 追加懒加载分支与重绑键、`phone.css` 追加各件样式、'
                '`config/apps.js` / `config/storage.js` / `apps/games/games-app.js` 各追加登记），按现场重取；'
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
