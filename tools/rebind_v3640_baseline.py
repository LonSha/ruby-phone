#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rebind_v3640_baseline.py — v3.64.0 连带面：重绑两份活基线（读数零手抄，全部取自探针现场）。

本版治的是**探针口径**（块注释也算注释），不新增任何产品文件；故：
① branch_play_baseline.json —— 四格读数改变，逐格有据：
   · files_scanned 371 -> 373：**陈旧漂移**（与口径无关）。枚举面 = apps/** 315 + config/** 58
     = 373；基线 rebuilds 段最后一条停在 v3.58.0（记 370），此后 v3.61.0/v3.62.0/v3.63.0
     新增的 config/branch-contrast.js（v3.62.0）、config/resume-handoff.js（v3.63.0）等从未重绑。
   · checkpoint_face_hits 1 -> 0 / preview_face_hits 42 -> 34 / upstream_global_read_sites 8 -> 4：
     **口径诚实化**（块注释不再进读数）。逐条归因：
       checkpoint：唯一 1 点在 config/checkpoint-content-contract.js 文件头规格注释
         （逐字写着「绝不碰 saveCheckpoint / dropCheckpoint 这类写面」）；
       preview：9 处块注释行（apps/diagnose/diagnose-data.js 3 · diagnose-view.js 1 ·
         config/rollback-preview.js 2 · config/boot-timing.js 1 · config/num-gate.js 1 ·
         config/branch-contrast.js 1）；
       globalRead：4 处块注释行（apps/memory/graph-bridge.js 1 · memory-app.js 2 ·
         config/world-bridge.js 1，后者逐字写着「不摸 window.LonShaEvidenceWorkbench」）。
   · 回滚覆盖面 41 点 / 4 文件 / 12 入口定义 · chat_data_patterns 279 · namespace_store_sites 5
     **一格未动**（同一口径下实测；rollback 族本就没有块注释命中）。
   · branch_face_hits 仍为 0（原 2 点全在 config/branch-contrast.js 文件头块注释）。
② schedule_conflict_baseline.json —— 只 files_scanned 371 -> 373（同源陈旧漂移）；
   consume_points 23 / consume_files 6 / local_engine_hits 0 与名单逐字不变。
③ 四族判据散文（criteria[*].got_text）随现场刷新；不新增关键字段。

纪律：只写读数与来由，不改判据；默认 dry-run，--write 才落盘。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
VER = 'v3.64.0'
PREV = 'v3.63.0'
NL = chr(10)


def rj(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def wj(rel, obj):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write(NL)


def live(name):
    """现场跑探针取真读数（本脚本不手抄：写进去的每个数都要与现场逐项相同）。"""
    r = subprocess.run(['node', 'tests/audit/%s_probe.cjs' % name, '--json'],
                       cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, '%s 探针必须能跑通：%s' % (name, r.stderr[:300])
    return json.loads(r.stdout)


BP = live('branch_play')
SC = live('schedule_conflict')

# ── 现场定值（跑不通即拒判，不做任何静默降级）──
assert BP['filesScanned'] == 373, BP['filesScanned']
assert BP['rollbackPoints'] == 41 and BP['rollbackFiles'] == 4 and BP['rollbackEntryDefs'] == 12, BP
assert BP['checkpointFaceHits'] == 0, BP['checkpointFaceHits']
assert BP['previewFaceHits'] == 34, BP['previewFaceHits']
assert BP['branchFaceHits'] == 0, BP['branchFaceHits']
assert BP['upstreamGlobalReadSites'] == 4, BP['upstreamGlobalReadSites']
assert BP['chatDataPatterns'] == 279 and BP['namespaceStoreSites'] == 5, BP
assert BP['rollbackFilesList'] == ['apps/phone/phone-data.js', 'apps/wangxiang/wangxiang-app.js',
                                   'apps/wechat/wechat-data.js', 'index.js'], BP['rollbackFilesList']
assert SC['filesScanned'] == 373 and SC['consumePoints'] == 23 and SC['localEngineHits'] == 0, SC
assert len(SC['consumeFiles']) == 6, SC['consumeFiles']

# ── ① branch_play ──
L1 = 'tests/audit/branch_play_baseline.json'
b1 = rj(L1)
assert list(b1['rebuilds'])[-1] in ('v3.58.0', 'v3.55.0', PREV, VER), list(b1['rebuilds'])[-1]
print('① branch_play 刷新前：files=%s cp=%s prev=%s global=%s branch=%s'
      % (b1['readings']['files_scanned'], b1['readings']['checkpoint_face_hits'],
         b1['readings']['preview_face_hits'], b1['readings']['upstream_global_read_sites'],
         b1['readings']['branch_face_hits']))
b1['readings']['files_scanned'] = BP['filesScanned']
b1['readings']['checkpoint_face_hits'] = BP['checkpointFaceHits']
b1['readings']['preview_face_hits'] = BP['previewFaceHits']
b1['readings']['branch_face_hits'] = BP['branchFaceHits']
b1['readings']['upstream_global_read_sites'] = BP['upstreamGlobalReadSites']
b1['rebuilds'][VER] = {
    'what': 'v3.64.0 探针纯度复校：branch_play_probe 补上「块注释也算注释」纪律'
            '（与 schedule_conflict_probe 的 v3.22.0 同款）+ 陈旧枚举面重绑',
    'why': '两件事各自独立、必须分开记：'
           '（A）**陈旧漂移**：files_scanned 371 -> 373。枚举面 = apps/** 315 + config/** 58 = 373；'
           '基线 rebuilds 段最后一条停在 v3.58.0（记 370），此后 v3.61.0/v3.62.0/v3.63.0 新增的 '
           'config/branch-contrast.js（v3.62.0）与 config/resume-handoff.js（v3.63.0）从未重绑 —— '
           '本版不是「新件进面」，是**把欠账补上**。'
           '（B）**口径诚实化**：checkpoint_face_hits 1 -> 0、preview_face_hits 42 -> 34、'
           'upstream_global_read_sites 8 -> 4。探针此前的 countTokens 与三处读文件只跳 `//` 行，'
           '**块注释散文照进读数**，而块注释恰是写规格的地方 ⇒ 「本模块绝不碰 X」被算成「X 已实施」。'
           '逐条归因（现场实测，非推测）：checkpoint 唯一 1 点在 '
           'config/checkpoint-content-contract.js 文件头，逐字写「绝不碰 saveCheckpoint / dropCheckpoint '
           '这类写面」；preview 9 处块注释行（diagnose-data 3 · diagnose-view 1 · rollback-preview 2 · '
           'boot-timing 1 · num-gate 1 · branch-contrast 1）；globalRead 4 处（graph-bridge 1 · '
           'memory-app 2 · world-bridge 1，后者逐字写「不摸 window.LonShaEvidenceWorkbench」）。'
           'branch_face_hits 仍 0：原 2 点全在 config/branch-contrast.js 文件头块注释 —— 那是**下游自建的 '
           'X8 第一切片**（消费上游既有 checkpointCompare 面），与「下游有没有接上游的分支只读对照面」'
           '**同名不同物**，如实归零正是本探针该给的读数。'
           '回滚覆盖面（41 点 / 4 文件 / 12 入口定义）· 会话隔离前缀面（279）· 命名空间存储点（5）'
           '**一格未动**（rollback 族本就没有块注释命中，已实测）。'
           '★ 连带面（同批落地，不是事后补）：本读数归零会打破 v326 A2 的「下限 1」判据 ⇒ '
           '该判据已改写为「真源四出口在场 + 产品面真调用」（见 tools/patch_v3640_handoff.py 留档），'
           '文本计数版退场、真调用版接棒（bridge-contract J13 早已以更强形式守着同一件事）。',
    'readings': {
        'files_scanned': BP['filesScanned'],
        'checkpoint_face_hits': BP['checkpointFaceHits'],
        'preview_face_hits': BP['previewFaceHits'],
        'branch_face_hits': BP['branchFaceHits'],
        'upstream_global_read_sites': BP['upstreamGlobalReadSites'],
    },
    'unchanged': [
        'rollback_points', 'rollback_files', 'rollback_entry_defs', 'chat_data_patterns',
        'namespace_store_sites', 'upstream_modules_scanned',
        'upstream_branch_domain_modules', 'upstream_checkpoint_named',
        'upstream_checkpoint_named_persistent', 'upstream_branch_domain_preview_hits',
        'upstream_branch_guard_loadable', 'upstream_ledger_replay_loadable',
        'upstream_bridge_snapshot_branch_faces',
    ],
    'criteria_refreshed': {},
    'not_done': [
        '上游面（R1-R4）仍是「未复核（冻结证据）」—— 未传 --upstream，跨仓探针不硬依赖兄弟仓在场。'
        '本版如实保留各冻结读数（65 个模块 / 域内 18 个 / 以 checkpoint 为名且带持久化的 0 个），不当作绿。',
        '块注释纪律只补在**探针侧**；其它 token 族走子串匹配的探针若日后新增，仍须逐件核对是否同步。'
        '本版只修 branch_play_probe（schedule_conflict_probe 早在 v3.22.0 已立）。',
        '「下游已实施检查点内容级对照」此刻的证据是**真源四出口在场 + 产品面真调用**（v326 A2 改写 + '
        'bridge-contract J13），**不是**本探针的文本计数 —— 文本计数从此不再为该结论作证。',
    ],
}

# ── ② schedule_conflict ──
L2 = 'tests/audit/schedule_conflict_baseline.json'
b2 = rj(L2)
assert list(b2['rebuilds'])[-1] in ('v3.58.0', 'v3.55.0', PREV, VER), list(b2['rebuilds'])[-1]
print('② schedule_conflict 刷新前：files=%s' % b2['readings']['files_scanned'])
b2['readings']['files_scanned'] = SC['filesScanned']
b2['rebuilds'][VER] = {
    'what': 'v3.64.0：只重绑陈旧枚举面（本探针口径早在 v3.22.0 已含块注释纪律，本版未改它）',
    'why': 'files_scanned 371 -> 373：枚举面 = apps/** 315 + config/** 58 = 373；基线 rebuilds 段'
           '最后一条停在 v3.58.0（记 370），此后 v3.61.0/v3.62.0/v3.63.0 新增的 config 侧新件'
           '（branch-contrast.js / resume-handoff.js / app-lazy-routes.js 等）未重绑。'
           '本版治的是兄弟探针（branch_play_probe）的块注释口径，**不动本探针任何读数**：'
           'consume_points 23 / consume_files 6 / local_engine_hits 0 与消费文件名单逐字不变'
           '（同一份现场输出比对，非照抄）。',
    'readings': {
        'files_scanned': SC['filesScanned'],
    },
    'unchanged': [
        'consume_points', 'consume_files', 'local_engine_hits',
    ],
    'criteria_refreshed': {},
    'not_done': [
        '消费面读数为零漂移（承诺期限 / 状态消费点 23、文件 6、本地日程引擎 0），这是如实记录而非漏复校。',
        '上游面（R1-R3）仍为「未复核（冻结证据）」：本层不硬依赖兄弟仓在场，按既有口径不刷新。',
    ],
}

# ── 未动项对账：`unchanged` 里每个键都必须与现场逐项相同（防「顺手改了还写没动」）──
LIVE_B = {
    'rollback_points': BP['rollbackPoints'],
    'rollback_files': BP['rollbackFiles'],
    'rollback_entry_defs': BP['rollbackEntryDefs'],
    'chat_data_patterns': BP['chatDataPatterns'],
    'namespace_store_sites': BP['namespaceStoreSites'],
}
LIVE_S = {
    'consume_points': SC['consumePoints'],
    'consume_files': len(SC['consumeFiles']),
    'local_engine_hits': SC['localEngineHits'],
}
for tag, frozen, livevals in (('①B', b1, LIVE_B), ('②S', b2, LIVE_S)):
    for k in frozen['rebuilds'][VER]['unchanged']:
        if k not in livevals:
            continue
        assert frozen['readings'][k] == livevals[k], \
            '%s 未动项 %s 与现场不符：基线 %s / 现场 %s' % (tag, k, frozen['readings'][k], livevals[k])
print('未动项对账通过（两面）')

# ── 判据散文复算对账（现场非冻结的判据必须与基线 got_text 逐字相同）──
FROZEN = ('未复核', '冻结证据', '（冻结）')
bset = {c['id']: c for c in b1['criteria']}
lset = {c['id']: c for c in BP['criteria']}
for cid, live_c in lset.items():
    got = str(live_c.get('gotText', ''))
    if any(f in got for f in FROZEN):
        continue
    assert bset[cid]['got_text'] == got, '判据散文漂移 %s：基线 %r / 现场 %r' % (cid, bset[cid]['got_text'], got)
print('判据散文对账通过（branch_play）')
for cid, live_c in {c['id']: c for c in SC['criteria']}.items():
    got = str(live_c.get('gotText', ''))
    if any(f in got for f in FROZEN):
        continue
    assert {c['id']: c for c in b2['criteria']}[cid]['got_text'] == got, '判据散文漂移 %s' % cid
print('判据散文对账通过（schedule_conflict）')

if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
wj(L1, b1)
wj(L2, b2)
print('已落盘两份基线：', L1, L2)