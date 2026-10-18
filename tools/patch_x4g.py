#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4g.py — [v4.28.0 · R4-X4 补丁 G] onChatChanged 块内注释外移

【为什么必须外移】tests/system-v3450.test.mjs 的 J2 有一条硬纪律：

    assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');

q25 的锚点是 onChatChanged() 的**整块字面**。补丁 A4 在这块中间插了
三行注释（说明「为什么要丢掉旧选位」），于是：

  · 锚点串含注释文本 ⇒ stripComments(src) 里注释已被删 ⇒ includes(from) 为假 ⇒ J2 炸；
  · 若把注释从锚点串里摘掉，锚点就**跨不过**那三行（连续字面断了）⇒ hits 断言炸。

两头都堵死 ⇒ 正确修法是**把那三行注释移到方法上方的文档注释里**，
让 onChatChanged 体内保持纯代码。信息一个字都不少（仍然写在同一处），
只是搬到了它本来该在的位置：方法契约写在方法头上。

【顺带】`catch (_e) { }` 写成空块（不留块内注释）——
  块内注释同样会被剥器吃掉，任何跨它的锚点都会失配。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
APP = 'apps/archive/archive-app.js'
V3450 = 'tests/system-v3450.test.mjs'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


# ---- G1：App —— 注释上移 + 块内保持纯代码
G1_OLD = u"""    /** 换会话：包 / 对账 / 草稿 / 台账 全是「这段关系的账」，故全部重取。
     *  ★ 四格的装载由 probe **一处**承担（单一装载路径）。 */
    onChatChanged() {
        this._tab = 'pack';
        this._sel = null;
        /* [v4.28.0 · R4-X4] 换会话也丢掉「上一次选了哪一位冲突」：那是旧会话的选择，
         *   而正史面随会话变 —— 留着它会把新会话里一个同名的冲突位当成旧选择。 */
        try { this.canon.resetScene(); } catch (_e) { /* 静默：换会话绝不能因接线件而报错 */ }
        this._proj = null;"""

G1_NEW = u"""    /** 换会话：包 / 对账 / 草稿 / 台账 全是「这段关系的账」，故全部重取。
     *  ★ 四格的装载由 probe **一处**承担（单一装载路径）。
     *  ★ [v4.28.0 · R4-X4] 同时丢掉「上一次要定哪一位冲突」：那是旧会话的选择，
     *    而正史面随会话变 —— 留着它会把新会话里一个同名的冲突位当成旧选择。
     *    （降级为静默：换会话绝不能因接线件而报错。） */
    onChatChanged() {
        this._tab = 'pack';
        this._sel = null;
        try { this.canon.resetScene(); } catch (_e) { }
        this._proj = null;"""

# ---- G2：v3450 q25 锚点跟着改成纯代码块
G2_OLD = u"""        + '        this._sel = null;' + NL
        + '        /* [v4.28.0 · R4-X4] 换会话也丢掉「上一次选了哪一位冲突」：那是旧会话的选择，' + NL
        + '         *   而正史面随会话变 —— 留着它会把新会话里一个同名的冲突位当成旧选择。 */' + NL
        + '        try { this.canon.resetScene(); } catch (_e) { /* 静默：换会话绝不能因接线件而报错 */ }' + NL
        + '        this._proj = null;' + NL"""

G2_NEW = u"""        + '        this._sel = null;' + NL
        + '        try { this.canon.resetScene(); } catch (_e) { }' + NL
        + '        this._proj = null;' + NL"""


def main():
    a = rd(APP)
    a = once(a, G1_OLD, G1_NEW, 'app onChatChanged')
    t = rd(V3450)
    t = once(t, G2_OLD, G2_NEW, 'v3450 q25')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(APP, a)
    wr(V3450, t)
    print('--- WRITTEN G ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())