#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3650_consequences.py — v3.65.0 连带面（一件补丁同时修，不留半抬状态）。

★ 为什么必须同批：本版新增 6 个源件（config/tab-source.js · config/app-open-detail.js ·
  config/task-entry.js · apps/taskentry/taskentry-app.js · taskentry-view.js · tests 那套件），
  于是「按目录枚举」的一批台账与四份活基线**必然陈旧**。这些是**判据抓出来的真欠账**，
  不是「顺手改绿」—— 每一条都在下面写明「为什么它本来就该变」。

① tests/system-v255.test.mjs 的 A5 dirMap：新 App taskentryApp → 'taskentry'。
   该测试的**合同**是「REBIND 表里每个 key 都必须登记 dirMap」（断言原文
   「新 App X 未登记 dirMap（本测试需同步扩展）」）。新增 key 就欠这一格 —— 补上。
② tests/audit/lifecycle_declarative_baseline.json：app_classes 77→78、slots 89→90、
   app_slots 78→79、app_slot_share_pct 87.6→87.8、sig_empty 67→68。
   新 App 类进面（枚举面按 apps/** 与 index.js 真数），它实现了无参 onChatChanged
   ⇒ 无参出口 +1。**其余读数一格未动**（下面逐项断言 unchanged）。
   R2 那条「1 个必选参出口」的判据散文一字不改（必选参出口仍是 MusicApp 一个）。
③ tests/audit/schedule_conflict_baseline.json：files_scanned 373→378
   + R4 散文刷新（消费面 23 点 / 6 件 / local_engine_hits 0 一格未动）。
④ tests/audit/branch_play_baseline.json：files_scanned 373→378、chat_data_patterns 279→285
   + R5 散文刷新；回滚覆盖面 41/4/12 与 checkpoint/preview/branch/globalRead 四格一格未动。
   为什么本来就该变：files_scanned 是「apps/** + config/** 的 .js 计数」（+5 新件确有 5 个 .js，
   测试套件在 tests/ 下、不进该面）；chat_data_patterns 是**存储层会话前缀族**的条数 ——
   本版给 config/storage.js 加了 /^te_/ 一条，149 个键的存储层随之 +1 条族。
⑤ tests/audit/long_chat_baseline.json：保留的 L5 那格 got_text 的 files=374→379
   （扫描面真读数；长会话行为五档一格未动）。
⑥ **条目真源** tools/iter123_seg.md：把边界那句改写成含「不能保证」的形态 ——
   v328 的 B1 判据要求用户条与文档共用标志语**且**把边界说成「不能保证」而非「已验」。
   上一版措辞（「…仍未验证」）过不了那条正则（只认「不能保证|仍不能验|不可测|不能验」四式）。
   **这不是放宽判据，是把文案写对。**
   ★ 为什么改真源而不是改 update-log：此刻 update-log 还在 3.64.0（抬版已按纪律回滚），
   3.65.0 的当版条目还不存在，它由 tools/bump_v3650.py 从这份真源生成 ——
   改生成物下次重抬即丢，改真源才是一次到位。

纪律：所有读数取自**现场跑探针**（零手抄）；默认 dry-run，--write 才落盘；
      写前逐项断言「该变的变了、不该变的没动」。
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
SEGS = []


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def rj(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def wj(rel, obj):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write(NL)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


def live(name):
    r = subprocess.run(['node', 'tests/audit/%s_probe.cjs' % name, '--json'],
                       cwd=ROOT, capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, '%s 探针必须能跑通：%s' % (name, r.stderr[:400])
    return json.loads(r.stdout)


# ── ① v255 A5 dirMap ──
P255 = 'tests/system-v255.test.mjs'
s = rd(P255)
# ★ 锚点必须取**整行**（含行尾注释）：只取到逗号会把 traveldesk 那行的注释留成
#   taskentry 行的尾巴 —— 首跑即踩（实测 diff 里出现两行 taskentryApp 且第一行挂着
#   别人的注释）。这与本仓「锚点取整行」的既有纪律同款。
old = "    traveldeskApp: 'traveldesk',    // [v3.54.0] 旅行记账案头：换会话丢账本与台账，两格全量重取"
new = ("    traveldeskApp: 'traveldesk',    // [v3.54.0] 旅行记账案头：换会话丢账本与台账，两格全量重取" + NL +
       "    taskentryApp: 'taskentry',      // [v3.65.0] 任务入口：换会话必须丢筛选态（_cap）"
       "与台账挤掉计数（_dropped，都是实例态），收藏与台账随会话重取")
n_add = s.count(new)
if n_add == 1:
    s2 = s            # 已改过（幂等：不重复插）
elif n_add == 0:
    s2 = once(s, old, new, 'v255 dirMap')
else:
    raise AssertionError('taskentryApp 行出现 %d 次，须为 0 或 1' % n_add)
assert s2.count("    taskentryApp: 'taskentry',") == 1, s2.count("    taskentryApp: 'taskentry',")

# ── ②~⑤ 四份活基线（读数全部现场取） ──
LC = live('lifecycle_declarative')
SC = live('schedule_conflict')
BP = live('branch_play')
LG = live('long_chat')

# ② lifecycle
LCP = 'tests/audit/lifecycle_declarative_baseline.json'
lc = rj(LCP)
r = lc['readings']
# 幂等：接受「旧值」或「已刷成的新值」，其余一律拒（防手改漂移被静默吞掉）
assert r['app_classes'] in (77, LC['appClasses']), r['app_classes']
assert LC['appClasses'] == 78, LC['appClasses']
assert r['slots'] in (89, LC['slots']) and LC['slots'] == 90, (r['slots'], LC['slots'])
assert r['app_slots'] in (78, LC['appSlots']) and LC['appSlots'] == 79, (r['app_slots'], LC['appSlots'])
assert r['sig_empty'] in (67, LC['signatures']['empty']), (r['sig_empty'], LC['signatures']['empty'])
assert LC['signatures']['empty'] == 68, LC['signatures']['empty']
for k, v in (('wiring_points', 62), ('app_exit_points', 50), ('non_app_points', 12),
             ('sig_default', 1), ('sig_required', 1), ('sig_none', 8),
             ('semantic_slots', 11), ('semantic_same', 5), ('semantic_diff', 6)):
    assert r[k] == v, ('不该动的动了', k, r[k], v)
assert LC['wiringPoints'] == 62 and LC['appExitPoints'] == 50 and LC['nonAppPoints'] == 12, LC
assert r['points_p1'] == 19 and r['points_p2'] == 20 and r['points_p3'] == 23, r
assert LC['pointsByPath'] == {'P1': 19, 'P2': 20, 'P3': 23}, LC['pointsByPath']
assert sum(LC['signatures'].values()) == LC['appClasses'], LC['signatures']
r['app_classes'] = LC['appClasses']
r['slots'] = LC['slots']
r['app_slots'] = LC['appSlots']
r['sig_empty'] = LC['signatures']['empty']
share = round(100.0 * LC['appSlots'] / LC['slots'], 1)
assert share == 87.8, share
r['app_slot_share_pct'] = share
lc.setdefault('rebuilds', {})['v3.65.0'] = {
    'what': 'v3.65.0 新增一个 App 类（任务入口 TaskentryApp，实现了无参 onChatChanged）⇒ 枚举面 +1',
    'why': '本探针按 apps/** 与 index.js **真数**枚举 App 类与生命周期槽位。新增一件产品面 App '
           '必然让 app_classes 77 -> 78、slots 89 -> 90（新 App 在会话重绑表里 ⇒ 有会话槽位）、'
           'app_slots 78 -> 79、app_slot_share 87.6% -> 87.8%、sig_empty 67 -> 68（新出口是无参的）。'
           '**其余读数一格未动**（接线点 62 / App 出口 50 / 非 App 点 12 / 三条路径 19-20-23 / '
           '默认参 1 / 必选参 1 / 无签名 8 / 语义 11-5-6）—— 新 App 的接线点落在既有咽喉点上'
           '（P1 的懒加载重绑），不新增手写散点。R2 的判据散文仍写「1 个必选参出口」且一字不改'
           '（必选参出口仍是 MusicApp 一个）。',
    'readings': {'app_classes': LC['appClasses'], 'slots': LC['slots'], 'app_slots': LC['appSlots'],
                 'app_slot_share_pct': share, 'sig_empty': LC['signatures']['empty']},
    'unchanged': ['wiring_points', 'app_exit_points', 'non_app_points', 'points_p1', 'points_p2',
                  'points_p3', 'sig_default', 'sig_required', 'sig_none', 'semantic_slots',
                  'semantic_same', 'semantic_diff'],
    'not_done': '本版仍未实施「声明式生命周期出口」（四条判据的结论一字未动）。',
}

# ③ schedule_conflict
SCP = 'tests/audit/schedule_conflict_baseline.json'
sc = rj(SCP)
assert sc['readings']['files_scanned'] in (373, SC['filesScanned']) and SC['filesScanned'] == 378, \
    (sc['readings']['files_scanned'], SC['filesScanned'])
assert sc['readings']['consume_points'] == 23 and SC['consumePoints'] == 23, SC['consumePoints']
assert sc['readings']['local_engine_hits'] == 0 and SC['localEngineHits'] == 0, SC['localEngineHits']
sc['readings']['files_scanned'] = SC['filesScanned']
sc['consume_files'] = list(SC['consumeFiles'])
for c in sc['criteria']:
    if c.get('id') == 'R4':
        c['got_text'] = '%d 个文件在消费' % len(SC['consumeFiles'])
sc.setdefault('rebuilds', {})['v3.65.0'] = {
    'what': 'v3.65.0 枚举面 +5（config 新件 3 个 .js；apps/taskentry 2 个 .js）',
    'why': 'files_scanned 是 apps/** + config/** 的 .js 计数：373 -> 378。'
           '**消费面一格未动**（消费点 23 / 消费文件 6 件 / 本地引擎命中 0）—— '
           '本版新增的是任务入口导航件，不碰排期冲突的任何消费路径'
           '（R2 的「只有楼层维」与 R3 的「未复核（冻结证据：0）」两段散文一字不改）。',
    'readings': {'files_scanned': SC['filesScanned'], 'consume_points': SC['consumePoints'],
                 'local_engine_hits': SC['localEngineHits']},
    'unchanged': ['consume_points', 'consume_files', 'local_engine_hits'],
    'not_done': '上游实时复核仍未做（本版未给 --upstream）。',
}

# ④ branch_play
BPP = 'tests/audit/branch_play_baseline.json'
bp = rj(BPP)
assert bp['readings']['files_scanned'] in (373, BP['filesScanned']), bp['readings']['files_scanned']
assert bp['readings']['chat_data_patterns'] in (279, BP['chatDataPatterns']), bp['readings']['chat_data_patterns']
assert BP['filesScanned'] == 378 and BP['chatDataPatterns'] == 285, BP
assert BP['rollbackPoints'] == 41 and BP['rollbackFiles'] == 4 and BP['rollbackEntryDefs'] == 12, BP
assert BP['checkpointFaceHits'] == 0 and BP['previewFaceHits'] == 34 and BP['branchFaceHits'] == 0, BP
assert BP['upstreamGlobalReadSites'] == 4 and BP['namespaceStoreSites'] == 5, BP
bp['readings']['files_scanned'] = BP['filesScanned']
bp['readings']['chat_data_patterns'] = BP['chatDataPatterns']
bp['readings']['namespace_store_sites'] = BP['namespaceStoreSites']
for c in bp['criteria']:
    if c.get('id') == 'R5':
        c['got_text'] = '%d 点 / %d 文件 / %d 入口定义' % (BP['rollbackPoints'], BP['rollbackFiles'],
                                                          BP['rollbackEntryDefs'])
bp.setdefault('rebuilds', {})['v3.65.0'] = {
    'what': 'v3.65.0 枚举面 +5（config 新件 3 / apps/taskentry 2）+ 会话前缀族 +1（/^te_/）',
    'why': 'files_scanned 373 -> 378（apps/** + config/** 的 .js 计数）；'
           'chat_data_patterns 279 -> 285 是**存储层会话前缀族**的真读数 —— 本版给 config/storage.js '
           '的会话前缀族加了 /^te_/（任务入口两条会话键），族条数随之增加。'
           '**回滚覆盖面与上游读取面一格未动**：41 点 / 4 文件 / 12 入口定义 · checkpoint 0 · '
           'preview 34 · branch 0 · 上游全局读取点 4 —— 本版不碰回滚/检查点/预览/分支对照任何路径。',
    'readings': {'files_scanned': BP['filesScanned'], 'chat_data_patterns': BP['chatDataPatterns'],
                 'namespace_store_sites': BP['namespaceStoreSites']},
    'unchanged': ['rollback_points', 'rollback_files', 'rollback_entry_defs', 'checkpoint_face_hits',
                  'preview_face_hits', 'branch_face_hits', 'upstream_global_read_sites',
                  'namespace_store_sites'],
    'not_done': '上游实时复核仍未做（本版未给 --upstream）。',
}

# ⑤ long_chat
LGP = 'tests/audit/long_chat_baseline.json'
lg = rj(LGP)
assert LG['scan']['files'] == 379, LG['scan']
assert lg['readings']['floor_count_n10'] == 10 and lg['readings']['floor_count_n2000'] == 2000, '长会话五档需在场'
l5 = [c for c in lg['criteria'] if c.get('id') == 'L5']
assert len(l5) == 1, len(l5)
m = re.search(r'files=(\d+)', l5[0]['got_text'])
assert m and m.group(1) in ('374', str(LG['scan']['files'])), l5[0]['got_text']
l5[0]['got_text'] = re.sub(r'files=\d+', 'files=' + str(LG['scan']['files']), l5[0]['got_text'], count=1)
# ★ 两处必须同批改：v327 的 A2 直接 deepEqual(rep.scan, base.scan)，而 FM1 又要求
#   L5 散文的 files= 与 scan.files 同源。只改散文不改 scan ⇒ A2 转红；只改 scan 不改散文
#   ⇒ FM1 转红。两处同源，所以要一起刷（这也是本补丁存在的理由：不留半改状态）。
assert lg['scan']['files'] in (374, LG['scan']['files']), lg['scan']['files']
lg['scan'] = dict(LG['scan'])
lg.setdefault('rebuilds', {})['v3.65.0'] = {
    'what': 'v3.65.0 枚举面 +5（config 新件 3 / apps/taskentry 2）',
    'why': 'L5 的 files= 是扫描面真读数（374 -> 379，为本版新增源件后的仓内 .js 计数）。'
           '**长会话行为读数一格未动**（N=10/100/400/1000/2000 五档的楼层数、物化条数、'
           '引擎索引长度、最近楼层上下文行数全部逐字不变）—— 本版不碰楼层消费路径。'
           '四类站点计数（全表物化 9 / 有界切片 5 / 下标直取 11 / 长度读 48）同样一格未动。',
    'readings': {'files': LG['scan']['files'], 'full_materialize': LG['scan']['full_materialize'],
                 'bounded_slice': LG['scan']['bounded_slice'],
                 'indexed_loop': LG['scan']['indexed_loop'], 'length_read': LG['scan']['length_read']},
    'unchanged': ['floor_count', 'materialize_items', 'engine_index_len', 'recent_story_context_lines'],
    'not_done': '本轮仍为合成宿主取证，非实机。',
}

# ── ⑥ update-log 当版条目：本版**不在这里改** ──
# 原因（顺序问题，不是漏做）：此刻 update-log 还在 3.64.0（抬版已按纪律回滚），
# 3.65.0 的当版条目**还不存在**，它由 tools/bump_v3650.py 从 tools/iter123_seg.md 生成。
# 所以「边界那句必须含不能保证」的唯一正确改法，是把**条目真源** iter123_seg.md 改对
# （已在本补丁之前改好：「真宿主里点一下是否真落在歌词页**不能保证**」），
# 重抬时生成的当版条目自然带上它，v328 的 B1 才会绿。
# 若在这里等抬版后再改 update-log，等于给生成物打补丁 —— 下次重抬即丢。
ITEM_SRC = 'tools/iter123_seg.md'
_src = rd(ITEM_SRC)
assert _src.count('不能保证') >= 1, '条目真源必须已含「不能保证」（否则重抬后 v328 会红）'
assert '真宿主里点一下是否真落在歌词页**不能保证**' in _src, '边界那句须是改写后的形态'

print('== dry-run 摘要（读数全部现场取）==')
for tag, rel in [('① v255 A5 dirMap', P255), ('② lifecycle 基线', LCP),
                 ('③ schedule_conflict 基线', SCP), ('④ branch_play 基线', BPP),
                 ('⑤ long_chat 基线', LGP), ('⑥ 条目真源（已改，供重抬生成）', ITEM_SRC)]:
    print(' ', tag, '->', rel)
print('  lifecycle: app_classes 77->%d slots 89->%d app_slots 78->%d share 87.6->%.1f sig_empty 67->%d'
      % (LC['appClasses'], LC['slots'], LC['appSlots'], share, LC['signatures']['empty']))
print('  schedule/branch: files_scanned 373->%d' % SC['filesScanned'])
print('  branch: chat_data_patterns 279->%d' % BP['chatDataPatterns'])
print('  long_chat: files 374->%d' % LG['scan']['files'])
print('  条目真源: 已含「不能保证」的边界句（重抬后当版条目由它生成）')
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)

wr(P255, s2)
wj(LCP, lc)
wj(SCP, sc)
wj(BPP, bp)
wj(LGP, lg)
print('落盘完成：5 处（v255 + 四份活基线）；条目真源 iter123_seg.md 已在补丁前改好')
