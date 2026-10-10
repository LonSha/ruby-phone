#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 v255 dirMap 补丁：accessdeskApp 登记进「换会话必须丢实例态」的对照表。

为什么必须补：v255 的 dirMap 是「REBIND 表里每个 key 都要能映射到真实目录」的对照面。
  新 App 进了 REBIND 表（咽喉补丁加了 'accessdeskApp'）却不进 dirMap ⇒ 该测试转红
  （本版实测 fail 1）。这条红是**对的**：它证明门禁真的在看这张表。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
PATH = 'tests/system-v255.test.mjs'
src = io.open(ROOT + '/' + PATH, encoding='utf-8').read()

ANCHOR = "    caphealthApp: 'caphealth',      // [v3.92.0] 能力体检：换会话必须丢提示行与已生成的报告（都是实例态）；"
NEW = """    accessdeskApp: 'accessdesk',    // [v3.93.0] 无障碍操作台：换会话必须丢提示行与预览档（都是实例态）；
                                    //             三个设置键走 ^sys_ 前缀随会话隔离，档位属性由咽喉下一次 render 重写。
""" + ANCHOR

if "'accessdeskApp'" in src or 'accessdeskApp:' in src:
    print('skip（已登记，幂等）')
    sys.exit(0)
n = src.count(ANCHOR)
if n != 1:
    print('FAIL 锚点命中 %d 次（要求恰中 1 次）' % n)
    sys.exit(1)
io.open(ROOT + '/' + PATH, 'w', encoding='utf-8').write(src.replace(ANCHOR, NEW, 1))
print('OK system-v255.test.mjs -> %d 字节' % (len(src) + len(NEW) - len(ANCHOR)))