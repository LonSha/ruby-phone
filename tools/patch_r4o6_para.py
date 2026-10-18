#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o6_para.py — [v4.18.0 · R4-O6] 给 config/list-window.js 补**中段窗口**(段落邻域)。

为什么必须补:`_renderReader` 对整章 `paragraphs.map(...).join('')` —— 2 万段的单章
   一次全铺进 DOM。已有 `tailWindowOf` 从**尾部**切(聊天),服务不了「锚定到第 N 段、
   只看它前后各 R 段」这种**中段**需求。三种切片(头 / 尾 / 中)方向各不相同,
   必须各有各的函数(硬塞进任一支都会得出「用户不在他要看的位置」)。

两支(不改既有 windowOf / tailWindowOf / patchOf / keepState 一行):
  · paraWindowOf(paras, {anchor, radius, pageSize}) —— 以 anchor 为中心切 ± radius 段;
    首/中/末三处都能锚到同一段(验收原文:三处刷新都回到同段);
  · anchorOf(paras, raw) —— 把任意「段落身份」归一成**下标**(数字下标优先,id 字符串次之),
    读不出如实 null(不补 0 —— 0 是合法首段,与「没给锚点」处置相反)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'config/list-window.js'

ANCHOR = 'export function mergeTailWindow(prev, next) {'

NEW = '''/**
 * [v4.18.0 \u00b7 R4-O6] \u6bb5\u843d\u90bb\u57df\u7a97\u53e3(\u4e2d\u6bb5\u5207\u7247:\u4ee5\u951a\u70b9\u4e3a\u4e2d\u5fc3 \u00b1 \u534a\u5f84)\u3002
 *
 * \u4e3a\u4ec0\u4e48\u4e0d\u80fd\u7528\u5df2\u6709\u4e24\u652f:`windowOf` \u4ece\u5934\u90e8\u5207\u3001`tailWindowOf` \u4ece\u5c3e\u90e8\u5207,
 *   \u800c\u300c\u8bfb\u8005\u505c\u5728\u7b2c N \u6bb5\u300d\u8981\u770b\u7684\u662f**\u5b83\u524d\u540e\u5404 R \u6bb5**\u3002\u4e09\u79cd\u5207\u7247\u65b9\u5411\u5404\u4e0d\u76f8\u540c
 *   (\u5934 / \u5c3e / \u4e2d),\u786c\u585e\u8fdb\u4efb\u4e00\u652f\u90fd\u4f1a\u5f97\u51fa\u300c\u7528\u6237\u4e0d\u5728\u4ed6\u8981\u770b\u7684\u4f4d\u7f6e\u300d\u3002
 *
 * \u4e09\u6001\u5206\u5f00:\u00b7 `items` \u672c\u6b21\u8be5\u6e32\u67d3\u7684\u6bb5; \u00b7 `start`/`end` \u5b83\u5728\u5168\u7ae0\u91cc\u7684\u533a\u95f4;
 *   \u00b7 `hasBefore`/`hasAfter` \u4e24\u5934\u662f\u5426\u8fd8\u6709\u66f4\u591a\u2014\u2014\u300c\u5df2\u5230\u5f00\u5934\u300d\u4e0e\u300c\u8fd8\u6ca1\u52a0\u8f7d\u300d\u4e0d\u5f97\u540c\u5f62\u3002
 *
 * @param {Array} paras \u5168\u7ae0\u6bb5\u843d(\u987a\u5e8f\u6570\u7ec4)
 * @param {{anchor?:number, radius?:number, pageSize?:number}} [opts]
 *   `anchor` \u951a\u70b9\u4e0b\u6807(\u7ecf `anchorOf` \u5f52\u4e00);
 *   `radius` \u534a\u5f84(\u7f3a\u7701\u53d6 pageSize \u7684\u4e00\u534a,\u4e0a\u9650\u4e0e\u65e2\u6709\u9875\u957f\u540c\u53e3\u5f84 200)
 */
export function paraWindowOf(paras, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const size = normalizePageSize(o.pageSize, 250);
    const rRaw = numOrNull(o.radius);
    const radius = (rRaw === null || rRaw <= 0) ? Math.max(1, Math.floor(size / 2)) : Math.min(200, Math.floor(rRaw));
    const out = {
        ok: false, items: [], start: 0, end: 0, anchor: null,
        loaded: 0, total: 0, hasBefore: false, hasAfter: false, reason: ''
    };
    if (!Array.isArray(paras)) {
        out.reason = 'paras-not-array(\u62ff\u4e0d\u5230\u6bb5\u843d \u21d2 \u5224\u4e0d\u4e86,\u4e0d\u662f\u7a7a\u7ae0)';
        return out;
    }
    out.ok = true;
    out.total = paras.length;
    if (paras.length === 0) {
        out.reason = 'empty-chapter(\u672c\u7ae0\u771f\u7684\u6ca1\u5185\u5bb9)';
        return out;
    }
    const aRaw = numOrNull(o.anchor);
    /* \u951a\u70b9\u7f3a\u7701\u21d2\u9996\u6bb5(\u4e0e\u65e2\u6709\u300c\u4ece\u5934\u5f00\u59cb\u300d\u540c\u4e49);**\u8d85\u51fa\u8303\u56f4\u5219\u5939\u5230\u5408\u6cd5\u533a\u95f4**\u5e76\u5982\u5b9e\u62a5 anchor\u3002 */
    let anchor = (aRaw === null) ? 0 : Math.floor(aRaw);
    if (anchor < 0) anchor = 0;
    if (anchor > paras.length - 1) anchor = paras.length - 1;
    out.anchor = anchor;
    const start = Math.max(0, anchor - radius);
    const end = Math.min(paras.length, anchor + radius + 1);
    out.start = start;
    out.end = end;
    out.items = paras.slice(start, end);
    out.loaded = out.items.length;
    out.hasBefore = start > 0;
    out.hasAfter = end < paras.length;
    out.reason = out.hasBefore || out.hasAfter ? 'has-more(\u4e24\u5934\u8fd8\u6709)' : 'whole-chapter(\u5168\u7ae0\u90fd\u5728\u7a97\u53e3\u5185)';
    return out;
}

/**
 * [v4.18.0 \u00b7 R4-O6] \u628a\u4efb\u610f\u300c\u6bb5\u843d\u8eab\u4efd\u300d\u5f52\u4e00\u6210**\u4e0b\u6807**\u3002
 *   \u00b7 \u6570\u5b57\u4e0b\u6807\u4f18\u5148;\u00b7 \u5b57\u7b26\u4e32\u5f62\u5e26 `para:` \u524d\u7f00\u7684 id \u6b21\u4e4b;
 *   \u00b7 \u8bfb\u4e0d\u51fa\u5982\u5b9e `null` \u2014\u2014 **\u4e0d\u8865 0**:0 \u662f\u5408\u6cd5\u9996\u6bb5,\u4e0e\u300c\u6ca1\u7ed9\u951a\u70b9\u300d\u5904\u7f6e\u76f8\u53cd\u3002
 */
export function anchorOf(paras, raw) {
    const n = numOrNull(raw);
    if (n !== null) {
        const i = Math.floor(n);
        return (i >= 0) ? i : null;
    }
    if (typeof raw === 'string') {
        const m = /^para:(\\d+)$/.exec(raw.trim());
        if (m) {
            const i = Math.floor(Number(m[1]));
            return Number.isFinite(i) ? i : null;
        }
        /* \u5e26 `data-para` \u5c5e\u6027\u7684\u5c5e\u6027\u540d\u4e5f\u8ba4(\u89c6\u56fe\u76f4\u63a5\u4f20 el.dataset.para \u65f6\u662f\u7eaf\u6570\u5b57\u4e32,\u5df2\u7531\u4e0a\u9762\u6536\u4f4f)\u3002 */
    }
    return null;
}

/** [v4.18.0 \u00b7 R4-O6] \u6bb5\u843d\u7a97\u53e3\u7684\u4e00\u53e5\u8bdd\u8bfb\u6570(\u4e0e\u65e2\u6709 `line` \u540c\u89c4\u683c)\u3002 */
export function paraLine(w) {
    try {
        const x = w || {};
        if (!x.ok) return '\u6bb5\u843d\u7a97\u53e3 \u2014(' + (x.reason || '\u5224\u4e0d\u4e86') + ')';
        if (!x.total) return '\u6bb5\u843d\u7a97\u53e3 \u2014(' + (x.reason || '\u7a7a\u7ae0') + ')';
        return '\u6bb5\u843d ' + (x.start + 1) + '-' + x.end + '/' + x.total + ' \u00b7 \u951a\u5728\u7b2c ' + (x.anchor + 1) + ' \u6bb5'
            + (x.hasBefore ? ' \u00b7 \u524d\u9762\u8fd8\u6709' : ' \u00b7 \u5df2\u5230\u5f00\u5934')
            + (x.hasAfter ? ' \u00b7 \u540e\u9762\u8fd8\u6709' : ' \u00b7 \u5df2\u5230\u672b\u5c3e');
    } catch (_e) { return '\u2014(\u6bb5\u843d\u7a97\u53e3\u8bfb\u6570\u5f02\u5e38)'; }
}

'''

DEF_OLD = """export default {
    normalizePageSize, windowOf, patchOf, diffFields, keepState, line,
    tailWindowOf, mergeTailWindow, tailLine
};"""
DEF_NEW = """export default {
    normalizePageSize, windowOf, patchOf, diffFields, keepState, line,
    tailWindowOf, mergeTailWindow, tailLine,
    paraWindowOf, anchorOf, paraLine
};"""


def main():
    p = os.path.join(ROOT, REL)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(ANCHOR)
    assert n == 1, 'anchor must hit exactly 1, got %d' % n
    assert 'paraWindowOf' not in s, 'already patched'
    s = s.replace(ANCHOR, NEW + ANCHOR, 1)
    assert s.count(DEF_OLD) == 1, 'default anchor must hit exactly 1'
    s = s.replace(DEF_OLD, DEF_NEW, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())