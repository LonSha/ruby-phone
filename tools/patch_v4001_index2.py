#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0 · R3-O8] index.js：取数口带草稿本 + 四个新动作。"""
import io, sys

p = '/home/user/ruby-phone/index.js'
s = io.open(p, encoding='utf-8').read()
N = 0


def sub(old, new, tag):
    global s, N
    n = s.count(old)
    if n != 1:
        print('FAIL %s 锚点 %d 次' % (tag, n)); sys.exit(1)
    s = s.replace(old, new); N += 1; print('ok   %s' % tag)


# ① 取数口：加草稿本 + 自检
sub("""            const scope = { chatId: chatId, branchKey: branchKey };""",
"""            /* 草稿本：读不出与空分开（normalizeDraftBook 给 readable）。 */
            const draftsRaw = cwReadDraftsRaw();
            const draftsNorm = normalizeDraftBook(draftsRaw);
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
            };
            const scope = { chatId: chatId, branchKey: branchKey };""",
    'reads-drafts')

# ② 取数口读数带上草稿本与内核自检
sub("""                published: published,
                selfCheck: cwSelfCheck(''),""",
"""                published: published,
                drafts: drafts,
                draftsText: drafts.readable
                    ? ('草稿 ' + String(drafts.items.length) + ' 份（认不出 ' + String(drafts.dropped) + ' 份）')
                    : '草稿本**读不到**（不是「没草稿」—— 这两件事处置相反）',
                selfCheck: cwSelfCheck(''),
                multiSelfCheck: cmdSelfCheckOf(),""",
    'reads-face')

io.open(p, 'w', encoding='utf-8').write(s)
print('--- phase2 %d ---' % N)
