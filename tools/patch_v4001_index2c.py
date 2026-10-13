#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0 · R3-O8] 按 vp._creationWorkbenchScope 定位后精确插入草稿本读数。"""
import io, sys

p = '/home/user/ruby-phone/index.js'
lines = io.open(p, encoding='utf-8').read().split('\n')

# 唯一定位：vp._creationWorkbenchScope = scope; 后面紧跟 const cached = {
idxs = [k for k, L in enumerate(lines) if L.strip() == 'vp._creationWorkbenchScope = scope;']
if len(idxs) != 1:
    print('FAIL scope 锚 %d 次' % len(idxs)); sys.exit(1)
i = idxs[0]
if lines[i + 1].strip() != 'const cached = {':
    print('FAIL cached 行不符：%r' % lines[i + 1]); sys.exit(1)

reads = '''            /* 草稿本：读不出与空分开（normalizeDraftBook 给 readable）。
             *   与发布台账一样，认不出的行**如实计数**，不静默丢。 */
            const draftsNorm = normalizeDraftBook(cwReadDraftsRaw());
            const drafts = {
                readable: draftsNorm.readable,
                reason: draftsNorm.reason,
                items: draftsNorm.drafts.map(function (d) {
                    const it = cwFindMaterial(materials.items, cwMaterialRef(d.source, d.materialId));
                    const pv = previewOf(d, it || {});
                    return {
                        key: d.key, target: d.target, source: d.source, materialId: d.materialId,
                        note: d.note, tags: d.tags, version: d.version, state: d.state,
                        preview: pv.title, previewBody: pv.body, readyToPublish: pv.readyToPublish,
                        materialFound: !!it,
                    };
                }),
                dropped: draftsNorm.dropped,
                limit: CMD_LIMITS.drafts,
            };'''
lines.insert(i + 1, reads)

j = None
for k in range(i + 1, min(i + 24, len(lines))):
    if lines[k].strip() == "selfCheck: cwSelfCheck(''),":
        j = k; break
if j is None:
    print('FAIL selfCheck 行未找到'); sys.exit(1)

lines.insert(j, "                drafts: drafts,\n                draftsText: drafts.readable\n                    ? ('草稿 ' + String(drafts.items.length) + ' 份（认不出 ' + String(drafts.dropped) + ' 份）')\n                    : '草稿本**读不到**（不是「没草稿」—— 这两件事处置相反）',")
lines.insert(j + 4, "                multiSelfCheck: cmdSelfCheckOf(),")

io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('OK inserted after line %d, selfCheck at %d' % (i, j))
