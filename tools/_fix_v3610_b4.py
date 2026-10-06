#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B4：两个冒烟测试的 mock 补 setContent。

真缺陷（O1 交棒）：apps/gacha/gacha-view.js 与 apps/reading/reading-view.js 在
v3.61.0 改成走 `phoneShell.setContent()`（此前直写 screen.innerHTML）。两个冒烟
测试的 mock 只有 `screen` 没有 `setContent`，于是
    this.app.phoneShell.setContent is not a function
当场抛错，整个 try 块中断 —— 连「render 不抛错」之后的断言全都没跑。
这不是判据严，是夹具没过新接口（判据面照旧测的是真行为）。

修法：mock 补一个与真 setContent 语义等价的极小实现（把 html 落进 screen）。
锚点：两个文件里 `phoneShell: { screen: new MockScreen(), showNotification() {} },`
须各恰中 1 次。
"""
import ast
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
TESTS = ROOT / 'tests'
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b4] ast 自证通过')

OLD = "  phoneShell: { screen: new MockScreen(), showNotification() {} },"
NEW = """  phoneShell: {
    screen: new MockScreen(),
    showNotification() {},
    /* [v3.61.0 · O1] 视图改走 setContent（唯一内容入口），夹具必须跟上新接口：
     *   缺它则 render 当场抛「setContent is not a function」，后续断言全不跑。 */
    setContent(html) { this.screen.innerHTML = html; },
  },"""

fails = []
for name in ['gacha-app.test.mjs', 'reading-app.test.mjs']:
    p = TESTS / name
    src = p.read_text(encoding='utf-8')
    n = src.count(OLD)
    if n != 1:
        fails.append('%s 锚点命中 %d 次' % (name, n))
        continue
    p.write_text(src.replace(OLD, NEW), encoding='utf-8')
    print('  %-26s ok' % name)
if fails:
    sys.exit('[b4] 失败：' + ' | '.join(fails))
print('[b4] 完成')