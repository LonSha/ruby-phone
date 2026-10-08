#!/usr/bin/env python3
"""patch_ulog_v3720.py — 向 update-log.json 注入 3.72.0 条目并放到 versions 字典首位。"""
import json, os
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fp = os.path.join(ROOT, 'update-log.json')

with open(fp, encoding='utf-8') as f:
    data = json.load(f, object_pairs_hook=OrderedDict)

entry_v3720 = OrderedDict([
    ('version', '3.72.0'),
    ('date', '2026-10-08'),
    ('items', [
        '【定位 · X8 的真实缺口（修前实测处境）】** 已有 resume-brief 五面、织光机呈现、回滚预览、检查点内容对照、存档案头；但「选两分支 → 看语义变化」和「恢复前预检 → 执行 → 回读」两段操作流程此前在 feat/x8-resume-handoff 分支上交付过（v3.62.0/v3.63.0），未合入 main。X8 的任务是把这两件纯函数协议层合入当前主线（v3.71.0），完成只读分支对照 + 受控恢复交接的完整接线。',
        '【协议层 · 分支对照（只读）】** `config/branch-contrast.js`（纯函数，397 行）：`branchContrast` 把两支 payload 的差异按四组语义面（character/commitment/finance/storyTime）归类，每组给出 onlyA/onlyB/changed 三类行；跨支秘密隔离判定（`countLeak`）；三态不同形（缺席/空/正常）；`applied` 恒 false（只读）。',
        '【第二件 · 受控恢复交接（预检→执行→回读三段闸门）】** `config/resume-handoff.js`（纯函数，463 行，只 import 取数门 numOrNull）：`precheckHandoff` 四道检查 → ok/blocked/unusable 三档；`handoffResume` 预检不过零调用（held）、同 handoffId 幂等、先抬交接世代再执行；`readbackOf` ok/mismatch/unreadable 三态；`guardHandoffWrite` 交接世代栅栏与 session-gate 串联（两把都要过）。',
        '【接线 · 诊断中心 handoffFace 卡片】** `apps/diagnose/diagnose-data.js` 的 handoff IIFE 与 handoffFaceText 转发函数已在 main 上（继承自 v3.63.0）；`apps/diagnose/diagnose-view.js` 加 `_handoffHtml` 渲染方法与卡片 section（与 sessionGate 面分列）；`index.js` import 两个协议件。',
        '【验证 · 门禁与判据真读数】** 两个测试套件共 27 个用例（v3720 分支对照 10 条 + v3730 受控恢复 17 条），含跨支泄漏/三态不同形/幂等/回读/旧写入被拒/两把闸门/真源码破坏负控制。自检函数全绿。',
        '【版本升至 3.72.0（五源同源）】** manifest.json / package.json / index.js 的版本常量与公告块 / update-log.json 的 latest 与 head 与新条目一次抬齐；本文件新增本迭代段；边界文档按当版复校。',
    ]),
    ('label', 'v3.72.0'),
    ('summary', '拓展计划 X8：续玩与分支对照工作区（只读分支对照 + 受控恢复交接三段闸门）'),
    ('changes', '新增 config/branch-contrast.js + config/resume-handoff.js；诊断面 handoffFace 卡片；index.js import 两个协议件；source-derivation 台账 +2 条；v296 TOUCHED +2 条。'),
])

old_versions = data['versions']
new_versions = OrderedDict()
new_versions['3.72.0'] = entry_v3720
for k, v in old_versions.items():
    if k != '3.72.0':
        new_versions[k] = v
data['versions'] = new_versions
data['latest'] = '3.72.0'

with open(fp, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f'update-log.json updated: latest=3.72.0, versions head={list(new_versions.keys())[0]}')