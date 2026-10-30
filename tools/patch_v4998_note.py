#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4998_note.py — 给两本冻结账本补一条本版的人工摘除说明。

`node scripts/method-consumption-audit.mjs --update` 是幂等重写：它会保留 note 原文，
但**不会**替你写下「为什么这一版少了两条」。少了那句话，后来者只能看到条目凭空消失，
而那正是本仓最忌的样子（账本被悄悄洗过）。故本补丁把来由如实写进 note。
"""
import io
import json
import sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)

MOD_NOTE = (
    ' 【v4.99.8 · R11-X4】已人工摘除（非 --update 的副作用）：'
    'config/sharing-boundary.js 与 config/offline-creator-bundle-pipeline.js 已真接进 '
    'apps/backupdesk（分享五态授权 / 创作者包选择性导入计划，经 config/share-migrate-bridge.js 翻形状），'
    '两者从 orchestrator-only 升入 product 面，故弱档模块账本 82 → 80。'
    '同版还抓到一个真缺陷：`_shareVm` 里另写了一遍 `sharePreviewOf`，使 `previewShare` '
    '退化成只有判据在调的死方法；`markShareRead`（记一次已读）更是产品面零调用 —— '
    '于是「撤回前已读 N 人」这句留痕在界面上永远是 0 人。两处已接线（视图给出「记他读过了」入口）。'
)

METHOD_NOTE = (
    ' 【v4.99.8 · R11-X4】本版新增的两条死方法当场被抓并修掉，故条数未增（315 → 315）：'
    '`BackupdeskApp.previewShare` 与 `BackupdeskApp.markShareRead` 此前只有判据在调、产品面零调用 —— '
    '前者因为 `_shareVm` 里另写了一份 `sharePreviewOf`（同一件事两份口径），后者因为界面没有「记已读」入口。'
    '修法是**真接线**，不是写进账本：判据绿而对用户不存在，是本面最贵的一种假绿。'
)


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    changed = []
    for rel, extra in [('scripts/dead-module-baseline.json', MOD_NOTE),
                       ('scripts/dead-method-baseline.json', METHOD_NOTE)]:
        p = ROOT + '/' + rel
        doc = json.loads(rd(p))
        note = doc.get('note') or ''
        if extra.strip() in note:
            print('[note] %s 已含当版说明，跳过' % rel)
            continue
        doc['note'] = note + extra
        wr(p, json.dumps(doc, ensure_ascii=False, indent=2) + NL)
        changed.append(rel)
    print('[note] 写入 %d 件：%s' % (len(changed), ', '.join(changed) if changed else '无'))
    return 0


if __name__ == '__main__':
    sys.exit(main())