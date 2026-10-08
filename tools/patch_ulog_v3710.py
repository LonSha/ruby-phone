#!/usr/bin/env python3
"""patch_ulog_v3710.py — 向 update-log.json 注入 3.71.0 条目并放到 versions 字典首位。"""
import json, os
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fp = os.path.join(ROOT, 'update-log.json')

with open(fp, encoding='utf-8') as f:
    data = json.load(f, object_pairs_hook=OrderedDict)

# Build the 3.71.0 entry
entry_v3710 = OrderedDict([
    ('version', '3.71.0'),
    ('date', '2026-10-08'),
    ('items', [
        '【定位 · X7 的真实缺口（修前实测处境）】** image-generation-manager.js（5245 行）已解析最多六个 {人物 ... 人物} 块、产出 v4_prompt / v4_negative_prompt 的 char_captions / centers，支持位置（A1-E5 网格 / 中文方位 / 英文别名）和深度标签（前/后）。但槽位编辑全内联在类方法里：增删重排只能手改字符串，重复别名不报，坐标越界不拦，payload 无法离线预检，图片回执无绑定。',
        '【协议层 · 槽位模型 + payload 预检】** 新增 `config/character-slot-manager.js`（纯函数，740 行，18 个 export）：`parseSlotModel` 把 `{人物 ... 人物}` 字符串解析成结构化槽位列表（含位置/深度标签/ntags 分离）；`serializeSlotModel` 序列化回字符串；`addSlot` / `removeSlot` / `swapSlots` / `reorderSlots` 结构化编辑（六槽上限）；`buildPayloadPreview` 构建最终角色分配预览（char_captions / centers / use_coords），重复别名报 conflict、坐标越界报 out-of-bounds。',
        '【第二件 · 幂等图片回执账本】** `imageReceiptIdemKey` + `normalizeImageReceiptEntry` + `normalizeImageReceiptLedger` + `diffImageReceiptLedger` + `applyImageReceiptLedger`：幂等键 `<sessionKey>:<characterId>:<sceneTag>`，同角色同场景只记一次；diff 判断角色被删则标记 stale；上限 200 条，随会话隔离（image_receipt_ledger）。',
        '【位置工具 · grid ↔ coords 互转 + 越界校验】** `gridToCoords` / `coordsToGrid` 实现 A1-E5 网格与 {x,y} 坐标互转（与 image-generation-manager._resolveNovelAICharacterPosition 同口径）；`validatePosition` 校验坐标在 [0.1, 0.9] 范围内。',
        '【接线 · 诊断中心 characterSlotFace 卡片】** `apps/diagnose/diagnose-data.js` 加 IIFE 取数面（表自检 + 回执账本状态 pending/completed 计数），`diagnose-view.js` 加 `_characterSlotHtml` 渲染方法与卡片；`index.js` 在 `checkCalendarScheduleReminders` 内加 `_imageReceiptLedgerCache` 缓存写入块。',
        '【存储键 · 会话隔离登记】** `config/storage.js` 的 CHAT_DATA_PATTERNS 加 `^image_receipt_` 前缀；`scripts/keys-audit.mjs` 加 `image_receipt_ledger` 键（scope: chat）。',
        '【验证 · 门禁与判据真读数】** 新增套件 42 个用例（协议 3 / 槽位解析 7 / 槽位编辑 9 / payload 预检 5 / 幂等账本 9 / 位置工具 10 / 版本与导出面 2），含六槽上限/重复别名/坐标越界/空输入防御性降级的负控制。自检函数全绿。',
        '【版本升至 3.71.0（五源同源）】** manifest.json / package.json / index.js 的版本常量与公告块 / update-log.json 的 latest 与 head 与新条目一次抬齐；本文件新增本迭代段；边界文档按当版复校。',
    ]),
    ('label', 'v3.71.0'),
    ('summary', '拓展计划 X7：多角色生图操作深化（槽位编辑 + payload 预检 + 幂等回执账本）'),
    ('changes', '新增 config/character-slot-manager.js（18 export）；诊断面 characterSlotFace 卡片；storage.js 加 ^image_receipt_ 前缀；keys-audit 加 image_receipt_ledger 键；index.js 加 _imageReceiptLedgerCache 缓存。'),
])

# Rebuild versions with 3.71.0 at the head
old_versions = data['versions']
new_versions = OrderedDict()
new_versions['3.71.0'] = entry_v3710
for k, v in old_versions.items():
    if k != '3.71.0':
        new_versions[k] = v
data['versions'] = new_versions

# Update latest
data['latest'] = '3.71.0'

# Write back with indentation matching existing format
with open(fp, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f'update-log.json updated: latest=3.71.0, versions head={list(new_versions.keys())[0]}')
