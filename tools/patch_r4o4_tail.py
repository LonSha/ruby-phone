#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o4_tail.py — [v4.16.0 · R4-O4] 给 config/list-window.js 补**尾部窗口**。

为什么必须补:`windowOf` 是**从头部**切片(`items = notes.slice(0, next)`),
   它服务的是瀑布流(先看最新 30 条)。而聊天是**从尾部**看 —— 用户看的是
   「最近 N 条」,更早的按需往上加载。两种切片方向相反,必须各有各的函数
   (硬把聊天塞进 windowOf 会「先渲染最早的 30 条」,那正好是把用户丢在聊天开头)。

三支(不改既有 windowOf / patchOf / keepState 一行):
  · tailWindowOf(items, {loaded, pageSize}) —— 从**尾部**切:最近 loaded 条;
    首次加载给最近 pageSize 条;`added` 是相对上一次**新出现**的尾部增量。
  · mergeTailWindow(prev, next) —— 增量追加:上一屏 + 新来的几条,且**不重铺**。
  · tailLine(w) —— 一句话读数(与既有 line 同规格)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'config/list-window.js'

# 锚点直接用**真代码行**(注释行的括号/分号是全角,已因它失配过多次)。
ANCHOR = 'export function diffFields(before, after) {'

NEW = '''/**
 * [v4.16.0 \u00b7 R4-O4] **\u5c3e\u90e8**\u7a97\u53e3\u5207\u7247(\u804a\u5929\u4e0e\u4efb\u4f55\u300c\u6700\u65b0\u5728\u4e0b\u300d\u7684\u957f\u5217\u8868)\u3002
 *
 * \u4e3a\u4ec0\u4e48\u5fc5\u987b\u4e0e `windowOf` \u5206\u5f00:`windowOf` \u4ece**\u5934\u90e8**\u5207
 *   (`items = notes.slice(0, next)`)\u2014\u2014 \u5b83\u670d\u52a1\u7011\u5e03\u6d41(\u5148\u770b\u6700\u65b0 30 \u6761\u5c31\u6676)\u3002
 *   \u800c\u804a\u5929\u7528\u6237\u770b\u7684\u662f**\u6700\u8fd1 N \u6761**(B\u7aef\u5728\u4e0b\u3001\u65b0\u6d88\u606f\u5728\u5e95)\u3002
 *   \u4e24\u79cd\u5207\u7247\u65b9\u5411\u76f8\u53cd:\u628a\u804a\u5929\u786c\u585e\u8fdb `windowOf` \u4f1a\u300c\u5148\u6e32\u67d3\u6700\u65e9\u7684 30 \u6761\u300d,
 *   \u90a3\u6b63\u597d\u662f\u628a\u7528\u6237\u4e22\u5728\u804a\u5929\u5f00\u5934\u3002
 *
 * \u4e09\u6001\u5206\u5f00(\u4e0e `windowOf` \u540c\u89c4):
 *   \u00b7 `items`  \u672c\u6b21\u8be5\u4ea4\u7ed9\u6e32\u67d3\u7684\u6bb5(\u5c3e\u90e8 loaded \u6761);
 *   \u00b7 `added`  \u76f8\u5bf9\u4e0a\u4e00\u6b21**\u65b0\u51fa\u73b0**\u7684\u90a3\u51e0\u6761(\u589e\u91cf\u8ffd\u52a0\u7528);
 *   \u00b7 `hasMore`\u8fd8\u6709\u66f4\u65e9\u7684\u6ca1\u8f7d\u5165\u2014\u2014\u300c\u6ca1\u4e86\u300d\u4e0e\u300c\u8fd8\u6ca1\u8bf7\u6c42\u300d\u4e0d\u5f97\u540c\u5f62\u3002
 *
 * @param {Array} items \u5168\u91cf\u987a\u5e8f\u6570\u7ec4(\u65f6\u95f4\u4ece\u65e9\u5230\u665a)
 * @param {{loaded?:number, pageSize?:number, prevCount?:number}} [opts]
 *   `loaded` \u672c\u6b21\u6253\u7b97\u5448\u73b0\u7684\u5c3e\u90e8\u6761\u6570;\u7f3a\u7701\u53d6 `pageSize`
 *   `prevCount` \u4e0a\u4e00\u6b21\u7684**\u603b\u6761\u6570**(\u7528\u4e8e\u7b97 added)
 */
export function tailWindowOf(items, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const size = normalizePageSize(o.pageSize, 300);
    const out = {
        ok: false, items: [], added: [], start: 0, end: 0,
        loaded: 0, total: 0, hasMore: false, appended: false, reason: ''
    };
    if (!Array.isArray(items)) {
        out.reason = 'items-not-array(\u62ff\u4e0d\u5230\u5217\u8868 \u21d2 \u5224\u4e0d\u4e86,\u4e0d\u662f\u7a7a\u5217\u8868)';
        return out;
    }
    out.ok = true;
    out.total = items.length;
    const ld = numOrNull(o.loaded);
    const want = (ld === null) ? size : Math.max(size, Math.floor(ld));
    const take = Math.min(want, items.length);
    out.loaded = take;
    out.start = items.length - take;
    out.end = items.length;
    out.items = items.slice(out.start);
    const pc = numOrNull(o.prevCount);
    if (o.prevCount === undefined || pc === null) {
        out.added = [];
        out.appended = false;
    } else {
        const prev = Math.max(0, Math.floor(pc));
        /* \u589e\u91cf\u53ea\u5728\u300c\u65b0\u6761\u76ee\u662f\u5c3e\u90e8\u8ffd\u52a0\u300d\u65f6\u7b97:\u603b\u6570\u51cf\u5c11(\u5220/\u64a4\u56de)\u4e0d\u5f53\u589e\u91cf\u3002 */
        const grew = items.length > prev;
        out.added = grew ? items.slice(prev) : [];
        out.appended = grew && out.added.length > 0;
    }
    out.hasMore = out.start > 0;
    out.reason = items.length === 0 ? 'empty-list(\u5217\u8868\u771f\u7684\u662f\u7a7a\u7684)'
        : (out.hasMore ? 'has-more' : 'exhausted(\u5df2\u5230\u5f00\u5934)');
    return out;
}

/**
 * [v4.16.0 \u00b7 R4-O4] \u628a\u65b0\u6765\u7684\u5c3e\u90e8\u6d88\u606f**\u8ffd\u52a0**\u5230\u4e0a\u4e00\u5c4f(\u800c\u4e0d\u91cd\u94fa\u6574\u6bb5)\u3002
 *
 * \u4e3a\u4ec0\u4e48\u8981\u5355\u72ec\u4e00\u652f:\u300c\u672c\u6b21\u8be5\u6e32\u67d3\u54ea\u4e9b\u300d\u4e0e\u300c\u5df2\u7ecf\u753b\u5728\u5c4f\u4e0a\u7684\u662f\u54ea\u4e9b\u300d\u662f**\u4e24\u4ef6\u4e8b**\u3002
 *   \u8be5\u6570\u7ec4\u4e00\u65e6\u88ab\u5f53\u6210\u300c\u91cd\u65b0\u753b\u4e00\u904d\u300d\u7684\u4f9d\u636e,\u6b63\u5728\u7ffb\u65e7\u8bb0\u5f55\u7684\u4eba\u5c31\u4f1a\u88ab\u62c9\u5230\u5e95\u90e8
 *   (\u800c\u4ed6\u7684\u6eda\u52a8\u4f4d\u7f6e\u662f**\u4ed6\u81ea\u5df1\u7684\u610f\u613f**, \u4e0d\u662f\u5e94\u8be5\u88ab\u987a\u624b\u62b9\u6389\u7684\u72b6\u6001)\u3002
 *
 * @param {Array} prev \u4e0a\u4e00\u5c4f\u5df2\u6e32\u67d3\u7684\u6761\u76ee(\u65f6\u95f4\u987a\u5e8f\u4e0e next \u540c)
 * @param {Array} next \u672c\u6b21\u5168\u91cf\u987a\u5e8f\u6570\u7ec4
 * @returns {{ok:boolean, appended:boolean, appendItems:Array, removed:boolean, reason:string}}
 *   `removed: true` \u8868\u793a**\u4e0d\u80fd\u9760\u8ffd\u52a0\u5b8c\u6210**(\u6709\u5220/\u6709\u6539/\u987a\u5e8f\u53d8)\u2014\u2014 \u8c03\u7528\u65b9\u5fc5\u987b\u8d70\u91cd\u5efa\u8def\u5f84\u3002
 */
export function mergeTailWindow(prev, next) {
    const a = Array.isArray(prev) ? prev : null;
    const b = Array.isArray(next) ? next : null;
    const out = { ok: false, appended: false, appendItems: [], removed: false, reason: '' };
    if (!a || !b) {
        out.reason = '\u4e24\u4fa7\u4e0d\u662f\u6570\u7ec4(\u5224\u4e0d\u4e86 \u21d2 \u6309\u9700\u91cd\u5efa\u5904\u7406)';
        out.removed = true;
        return out;
    }
    out.ok = true;
    const keyOf = (x, i) => String((x && x.id !== undefined) ? x.id : ('#' + i));
    const aIds = a.map(keyOf);
    const bIds = b.map(keyOf);
    /* \u524d\u7f00\u5fc5\u987b\u4e00\u81f4:\u5426\u5219\u4e0d\u662f\u300c\u8ffd\u52a0\u300d\u800c\u662f\u300c\u6539\u4e86\u201d(\u5220/\u6539/\u6362\u4f1a\u8bdd)\u3002 */
    const samePrefix = aIds.length <= bIds.length
        && aIds.every((id, i) => id === bIds[i]);
    if (!samePrefix) {
        out.removed = true;
        out.reason = '\u524d\u7f00\u4e0d\u4e00\u81f4(\u6709\u5220\u6216\u6709\u6539 \u21d2 \u5fc5\u987b\u91cd\u5efa)';
        return out;
    }
    const extra = b.slice(aIds.length);
    out.appendItems = extra;
    out.appended = extra.length > 0;
    out.reason = out.appended ? 'pure-append(\u7eaf\u5c3e\u90e8\u8ffd\u52a0)' : 'no-change';
    return out;
}

/** [v4.16.0 \u00b7 R4-O4] \u5c3e\u90e8\u7a97\u53e3\u7684\u4e00\u53e5\u8bdd\u8bfb\u6570(\u4e0e\u65e2\u6709 `line` \u540c\u89c4\u683c)\u3002 */
export function tailLine(w) {
    try {
        const x = w || {};
        if (!x.ok) return '\u804a\u5929\u7a97\u53e3 \u2014(' + (x.reason || '\u5224\u4e0d\u4e86') + ')';
        return '\u804a\u5929\u7a97\u53e3 \u6700\u8fd1 ' + x.loaded + '/' + x.total + ' \u6761'
            + (x.appended ? ' \u00b7 \u65b0\u589e ' + x.added.length : '')
            + (x.hasMore ? ' \u00b7 \u8fd8\u6709\u66f4\u65e9\u7684' : ' \u00b7 \u5df2\u5230\u5f00\u5934');
    } catch (_e) { return '\u2014(\u7a97\u53e3\u8bfb\u6570\u5f02\u5e38)'; }
}

/** \u4e24\u4fa7\u6761\u76ee\u54ea\u4e9b\u5b57\u6bb5\u771f\u7684\u53d8\u4e86(\u4f9b\u4e0a\u62a5\u4e0e\u8bca\u65ad;**\u4e0d\u6539\u4e0d\u62a5**)\u3002 */\nexport function diffFields(before, after) {'''


def main():
    p = os.path.join(ROOT, REL)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(ANCHOR)
    assert n == 1, 'anchor must hit exactly 1, got %d' % n
    assert 'tailWindowOf' not in s, 'already patched'
    s = s.replace(ANCHOR, NEW, 1)
    # default 导出补三支
    d_old = "export default { normalizePageSize, windowOf, patchOf, diffFields, keepState, line };"
    d_new = ("export default {\n"
             "    normalizePageSize, windowOf, patchOf, diffFields, keepState, line,\n"
             "    tailWindowOf, mergeTailWindow, tailLine\n"
             "};")
    assert s.count(d_old) == 1, 'default anchor must hit exactly 1'
    s = s.replace(d_old, d_new, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())