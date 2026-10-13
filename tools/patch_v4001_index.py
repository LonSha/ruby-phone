#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0 · R3-O8] index.js 接线：多目标草稿本 + 四个新动作。"""
import io, sys

p = '/home/user/ruby-phone/index.js'
s = io.open(p, encoding='utf-8').read()
N = 0


def sub(old, new, tag):
    global s, N
    n = s.count(old)
    if n != 1:
        print('FAIL %s 锚点 %d 次' % (tag, n))
        sys.exit(1)
    s = s.replace(old, new)
    N += 1
    print('ok   %s' % tag)


# ① import
sub("""    cwReceiptOf, cwAppendPublished, cwSelfCheck, cwTargetOwnerOf,
} from './config/creation-workbench.js';""",
"""    cwReceiptOf, cwAppendPublished, cwSelfCheck, cwTargetOwnerOf,
} from './config/creation-workbench.js';
/* [v4.01.0 · 计划 R3-O8] 创作工作台的多草稿内核（纯函数）。
 *   接在咽喉的理由与 R-X6 同族：素材引用 / 草稿文字 / 目标清单全由调用方给，
 *   **内核自己不取数、不写存储、不发布**。四个新动作（compose / edit / redo / drop）
 *   只动「草稿本」这一面，发布仍逐目标走 cwInvokeOwner 的表，一次都不代发。 */
import {
    CMD_LIMITS, composeDrafts, normalizeDraftBook, upsertDraft,
    replaceMaterialKeepText, replaceDraftInBook, recomposeTargets,
    previewOf, diffDrafts, diffLine, cmdSelfCheck as cmdSelfCheckOf,
} from './config/creation-multi-draft.js';""",
    'import')

# ② 键名与动作白名单
sub("""    const CW_PUBLISHED_KEY = 'cw_published';
    /* 本模块对外只认这三个动作（用户脚本无法绕过白名单）。声明在取数口之前 ——
     *   取数口要在读数里带上它，而 const 有暂时性死区，先后必须对。 */
    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh'];""",
"""    const CW_PUBLISHED_KEY = 'cw_published';
    /* [v4.01.0 · R3-O8] 草稿本落盘键。与 cw_published 分开：一个是「要发的稿」，
     *   一个是「已发过的回执」，两份台账不混。 */
    const CW_DRAFTS_KEY = 'cw_drafts';
    /* 本模块对外只认这七个动作（用户脚本无法绕过白名单）。声明在取数口之前 ——
     *   取数口要在读数里带上它，而 const 有暂时性死区，先后必须对。
     *   [v4.01.0] 新增四个都只动草稿本：compose（多目标编排）/ edit（改这一份的文案）/ 
     *   redo（只重做所选段）/ drop（丢掉这一份）。 */
    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop'];
    /** 读草稿本原始值：**读不出来返回 null**（不是空数组——两者处置相反）。 */
    function cwReadDraftsRaw() {
        try {
            if (!storage || typeof storage.get !== 'function') return null;
            const raw = storage.get(CW_DRAFTS_KEY, '[]');
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }
    /** 写草稿本：**写后回读核对行数**，读不回不算写成功。 */
    function cwWriteDrafts(rows) {
        const norm = normalizeDraftBook(rows);
        try { storage.set(CW_DRAFTS_KEY, JSON.stringify(norm.drafts)); } catch (_e) { return { ok: false, reason: 'write-failed', drafts: norm.drafts }; }
        const back = normalizeDraftBook(cwReadDraftsRaw());
        const same = back.readable && back.drafts.length === norm.drafts.length;
        return { ok: same, reason: same ? 'ok' : 'readback-mismatch', drafts: back.drafts };
    }
    /** 引用键拆源与素材 id（与内核同口径）。 */
    function cwSplitRef(ref) {
        const s2 = String(ref || '');
        const i = s2.indexOf(':');
        if (i <= 0 || i === s2.length - 1) return null;
        return { source: s2.slice(0, i), materialId: s2.slice(i + 1) };
    }""",
    'keys+helpers')

io.open(p, 'w', encoding='utf-8').write(s)
print('--- phase1 %d ---' % N)
