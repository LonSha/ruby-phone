#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.31.0 抬版前的两处交棒（v3300 套件）：

 ① H3 的取段口径：v3.30.0 那套件接的是当时末段，判据里含一条**自证「后面没有别的段头」**
    —— v3.31.0 往后接了「约会大作战」段，这条按设计**主动报红**（提醒交棒，不是回归）。
    按 v3.29.0 那套件已用的形状改成「按下一个段头截断」。

 ② V1 的版本锚：原读 `log.versions[man.version]`（当版）—— 即「守别人的版」，
    抬到 3.31.0 后 latest 换成新件，于是「本版条目必须写到 恋爱空间」当场报红，
    而 3.30.0 的条目其实好好的。改成读**自己那一版**（SELF = '3.30.0'）。
    这是本轮记下的第三例同款口径错（v3270 / v3280 / v3290 / v3300 四处）。

纪律：锚点必须恰中 1 次；dry-run 默认，--write 才落盘。
"""
import io
import os
import sys

R = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv
REL = 'tests/system-v3300.test.mjs'


def rd(rel):
    with io.open(os.path.join(R, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with io.open(os.path.join(R, rel), 'w', encoding='utf-8') as f:
        f.write(text)


def sub_once(src, old, new, label):
    n = src.count(old)
    assert n == 1, '%s 锚点必须恰中 1 次，实得 %d' % (label, n)
    return src.replace(old, new)


src = rd(REL)

# ① H3 取段口径（交棒）
OLD_H3 = """    const rest = phone.slice(at);
    /* ★ 取段纪律：本版接的是**当前末段** ⇒ 取到文件尾；但先自证后面**没有**别的段头。
     *   v3.31.0 往后接段时这条会**主动报红**，提醒按 v3.28.0 立的交棒口径改成
     *   「按下一个段头截断」（v3.29.0 那套件就是这么改的，不是回归）。 */
    assert.equal(rest.indexOf('/* ---------- [', 1), -1,
        '本段原本应是末段：它后面出现了新段头 ⇒ 请把取段口径改成「按下一个段头截断」（交棒）');
    const norm = (x) => x.replace(/^\\/\\*[\\s\\S]*?\\*\\/\\s*/, '').trim();
    assert.equal(norm(rest), norm(read(CSS_REL)), 'phone.css 的本版段必须与 ' + CSS_REL + ' 逐字同源');
    assert.ok(rest.split(CSS_PFX).length - 1 >= 5, '本段必须真的带样式');"""
NEW_H3 = """    const rest = phone.slice(at);
    /* ★ [v3.31.0 接段已执行] 本段不再是末段 —— v3.31.0 往后接了「约会大作战」段，
     *   故按 v3.28.0 当时立的交棒口径：**按下一个段头截断**，不取文件尾。
     *   下版若再往后接段，本取法依然正确（不会以「同源失败」假红）。 */
    const nxt = rest.indexOf('/* ---------- [', 1);
    const seg = nxt >= 0 ? rest.slice(0, nxt) : rest;
    const norm = (x) => x.replace(/^\\/\\*[\\s\\S]*?\\*\\/\\s*/, '').trim();
    assert.equal(norm(seg), norm(read(CSS_REL)), 'phone.css 的本版段必须与 ' + CSS_REL + ' 逐字同源');
    assert.ok(seg.split(CSS_PFX).length - 1 >= 5, '本段必须真的带样式');"""
src = sub_once(src, OLD_H3, NEW_H3, 'H3 取段口径')

# ② V1 版本锚（守自己那一版）
OLD_V1 = """    /* 本版条目必须在场且非空（审计门会查这一条，这里先钉住）。 */
    const cur = (log.versions || {})[man.version];
    assert.ok(cur, 'update-log 必须含当前版本 ' + man.version + ' 的条目');"""
NEW_V1 = """    /* 本版条目必须在场且非空（审计门会查这一条，这里先钉住）。 */
    /* ★ 本套件守的是**自己那一版**（v3.30.0 恋爱空间），不是「当版」——
     *   抬版后 latest 换成新件。此前这里读 `log.versions[man.version]`，
     *   一抬到 3.31.0 就报「本版条目必须写到 恋爱空间」红，而 3.30.0 的条目其实好好的。
     *   这是本仓记过的「守别人的版」同款口径错的第四例（v3270 / v3280 / v3290 已改）。 */
    const SELF = '3.30.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');"""
src = sub_once(src, OLD_V1, NEW_V1, 'V1 版本锚')

print('patch bytes', len(src.encode()))
if not WRITE:
    print('（dry-run；加 --write 才落盘）')
    sys.exit(0)
wr(REL, src)
print('== 已落盘 ==')