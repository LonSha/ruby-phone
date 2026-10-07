#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""三份活基线刷新（v3.66.0：config/open-ref.js 进枚举面）。
按 tools/doc3580.py 的范式：值取自探针真跑 stdout，rebuilds 追加一段。
"""
import io, json, os, subprocess, sys

ROOT = '/home/user/ruby-phone'
VER = 'v3.66.0'
NL = chr(10)
DRY = '--write' not in sys.argv


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def wr(rel, s):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8').write(s)


def jsonl(rel):
    return json.loads(rd(rel))


def probe(name):
    r = subprocess.run(['node', 'tests/audit/' + name, '--json'], cwd=ROOT,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[:300]
    return json.loads(r.stdout)


SC = probe('schedule_conflict_probe.cjs')
BP = probe('branch_play_probe.cjs')
LG = probe('long_chat_probe.cjs')
print('probe: schedule files=%s / branch files=%s / long files=%s'
      % (SC['filesScanned'], BP['filesScanned'], LG['scan']['files']))

WHAT = 'v3.66.0 X2 第一切片：config/open-ref.js 进枚举面（跨 App 靶心协议件）'
WHY = ('枚举面 378 -> 379 个文件（本版新增四个 .js：config/open-ref.js 进本探针扫描面；'
       'apps/search/search-view.js / apps/memory/global-search-engine.js 是既有件；'
       'tests/system-v3660_open_ref.test.mjs 在 tests/ 下，不进本探针扫描面）。'
       '**消费面一格未动** —— 本版治的是「搜到一条内容却打不开那一条」，'
       '它既不读楼层时间轴、也不参与日程合并、不消费上游的「承诺期限 / 状态」。')

# ① 日程冲突面
B3 = 'tests/audit/schedule_conflict_baseline.json'
b3 = jsonl(B3)
assert list(b3['rebuilds'])[-1] in ('v3.54.0', 'v3.55.0', 'v3.58.0', 'v3.65.0'), list(b3['rebuilds'])[-1]
old3 = b3['readings']['files_scanned']
b3['readings']['files_scanned'] = SC['filesScanned']
b3['rebuilds'][VER] = {
    'what': WHAT,
    'why': WHY,
    'readings': {'files_scanned': SC['filesScanned']},
    'unchanged': ['consume_points', 'consume_files', 'local_engine_hits'],
    'criteria_refreshed': {},
    'not_done': [
        '本版新增的协议件不落在「承诺期限 / 状态」的消费面上：消费点 23 / 消费文件 6 '
        '与上一版逐字相同。这是如实记录，不是漏复校。',
        '真机里「点搜索结果能否真落到那一条上」仍归 R-O3（真宿主实机验证）—— '
        '本门只证明索引面与消费面在场，不证明真机上的落点。',
    ],
}
print('① schedule: files %s -> %s' % (old3, SC['filesScanned']))

# ② 分支对照面
B2 = 'tests/audit/branch_play_baseline.json'
b2 = jsonl(B2)
assert list(b2['rebuilds'])[-1] in ('v3.54.0', 'v3.55.0', 'v3.58.0', 'v3.65.0'), list(b2['rebuilds'])[-1]
old2 = b2['readings']['files_scanned']
b2['readings']['files_scanned'] = BP['filesScanned']
b2['rebuilds'][VER] = {
    'what': WHAT,
    'why': WHY,
    'readings': {'files_scanned': BP['filesScanned']},
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
        '本版如实保留各冻结读数，不当作绿。',
        '本版新增的协议件不写回滚点、不碰分支对照：回滚覆盖面（41 点 / 4 文件 / 12 入口定义）'
        '与上游面一格未动。这不代表没接好，代表本门确实与它无关（X2 治的是结果靶心）。',
    ],
}
print('② branch: files %s -> %s' % (old2, BP['filesScanned']))

# ③ 长对话面
B4 = 'tests/audit/long_chat_baseline.json'
b4 = jsonl(B4)
assert list(b4['rebuilds'])[-1] in ('v3.54.0', 'v3.55.0', 'v3.58.0', 'v3.65.0'), list(b4['rebuilds'])[-1]
old4 = b4['scan']['files']
b4['scan']['files'] = LG['scan']['files']
L5_LIVE = LG['criteria'].get('L5') if isinstance(LG.get('criteria'), dict) else None
if L5_LIVE is None:
    L5_LIVE = next(c for c in LG['criteria'] if c.get('id') == 'L5')
old_l5 = (lambda o: o.get('got_text') if isinstance(o, dict) else o.get('gotText'))(b4['criteria'].get('L5', {}) if isinstance(b4['criteria'], dict) else next(c for c in b4['criteria'] if c.get('id') == 'L5'))
new_l5 = L5_LIVE.get('got_text', L5_LIVE.get('gotText'))
b4['rebuilds'][VER] = {
    'what': 'v3.66.0 X2 第一切片：静态扫描面随新件扩张；楼层长会话面一格未动',
    'why': '静态扫描面 379 -> 380 个文件（config/open-ref.js）；**四类站点计数与全部活体读数一格未动**'
           '（全表物化 9 / 有界切片 5 / 下标直取 11 / 长度读 48）—— 本版治的是「结果没有靶心」，'
           '不摸楼层数组。既有站点行号随前置插入整体后移（global-search-engine 新增两条 import 与'
           '七个源登记块），按现场重取；判据散文 L5 的 files= 同步刷新为 380。',
    'how': 'node tests/audit/long_chat_probe.cjs --json',
    'readings': {
        'scan.files': LG['scan']['files'],
        'criteria.L5.got_text': new_l5,
    },
    'criteria_refreshed': {L5_LIVE.get('id', 'L5'): {'got_text': [old_l5, new_l5]}},
    'not_done': [
        '本版新增的协议件与楼层数组无关：四类站点计数与全部活体读数逐项相同。这是如实记录，不是漏复校。',
        '真机里 1000 楼长会话下的渲染与时序仍归 R-O3；本门只跑合成宿主。',
    ],
}
print('③ long_chat: files %s -> %s' % (old4, LG['scan']['files']))

if DRY:
    print('（dry-run，未落盘）')
    sys.exit(0)
wr(B3, json.dumps(b3, ensure_ascii=False, indent=2) + NL)
wr(B2, json.dumps(b2, ensure_ascii=False, indent=2) + NL)
wr(B4, json.dumps(b4, ensure_ascii=False, indent=2) + NL)
print('已落盘三份活基线。')