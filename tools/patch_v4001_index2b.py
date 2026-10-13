#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0 · R3-O8] 用行区间精确插入草稿本读数（锚点不唯一）。"""
import io, sys

p = '/home/user/ruby-phone/index.js'
lines = io.open(p, encoding='utf-8').read().split('\n')

# 定位锚（都必须在文件里唯一）
A = '            const cached = {\n'
try:
    i = lines.index('            const cached = {')
except ValueError:
    print('FAIL cached 锚未找到'); sys.exit(1)
if i < 1 or lines[i - 1] != '                scope: scope,':
    # 真实顺序：cached 行前面是 vp._creationWorkbenchScope = scope;
    if lines[i - 1].strip() != 'vp._creationWorkbenchScope = scope;':
        print('FAIL cached 上下文不符：%r' % lines[i - 1]); sys.exit(1)

# 取数口插入点：cached 之前
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

lines.insert(i, reads)

# cached 里插入 drafts / draftsText / multiSelfCheck
j = None
for k in range(i, min(i + 20, len(lines))):
    if lines[k].strip() == "selfCheck: cwSelfCheck(''),":
        j = k
        break
if j is None:
    print('FAIL cached 段内未找到 selfCheck 行'); sys.exit(1)

lines.insert(j, "                drafts: drafts,\n                draftsText: drafts.readable\n                    ? ('草稿 ' + String(drafts.items.length) + ' 份（认不出 ' + String(drafts.dropped) + ' 份）')\n                    : '草稿本**读不到**（不是「没草稿」—— 这两件事处置相反）',")
lines.insert(j + 4, "                multiSelfCheck: cmdSelfCheckOf(),")

io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('OK inserted at %d / %d' % (i, j))
