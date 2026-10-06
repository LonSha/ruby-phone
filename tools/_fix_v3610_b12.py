#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B12：更新 ITERATION_LOG 的遗留项与验收读数。

原遗留②写「全量测试面（204 套件）尚未跑」——本轮已跑完，改为**实测读数**：
    `node --test --reporter=tap tests/*.test.mjs` ⇒ 1..2951 / pass 2951 / fail 0（rc=0）；
    十道脚本门禁逐门单独真跑全 rc=0。
同时补记本轮的收口内容（扫描面交棒 + 三处自纠），保持「文档面不说谎」。
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b12] ast 自证通过')

p = ROOT / 'ITERATION_LOG.md'
s = p.read_text(encoding='utf-8')
OLD = ('- 【遗留】① 公告块 40KB 是 24 套判据的公共锚点（正则锁死在 index.js 内），'
       '外移需整体交棒 —— 本版不动；② 全量测试面（204 套件）尚未跑'
       '（用户指令「先把剩下的做了，再跑」—— 待用户一声令下统一跑全量）。')
NEW = ('- 【收口 · 扫描面交棒】O6 把 67 段懒加载五件套搬进表之后，全仓 40 个套件 57 处'
       '「index.js 必须有懒加载分支 / 懒加载单例 / import 路径 / 实例变量 → appId 映射」'
       '的**扫描面**随之失效（真功能一处没少、判据全数落空 = 假红）。统一改为读 '
       '`tests/_lazy_routes.mjs` 导出的**判据面**（index 内联分支 ∪ 表行渲染回的同形分支，'
       '渲染形与重构前逐字同构 ⇒ 断言与文案一字未改）；表缺席或 < 60 行即 fail-closed 拒判。'
       '连带的接线面副本树、破坏表锚点（v3450 q34 / v3460 q33 / v3470 q21·q22）一并重定向到表行。'
       '三件探针（schedule / branch / long_chat）与探针 `lifecycle_declarative` 的取数面同样切到判据面。\n'
       '- 【收口 · 本版自己抓到的三处缺陷】① 表 `errTitle` 语义定错：字段带「加载失败」后缀、'
       '装配器又拼一次 ⇒ 67 个 App 的失败提示全是「…加载失败失败」病句（改为标题基名，'
       'console/notify 文案逐字回归重构前形态）；② 抬版漏项：update-log 当版条目缺 `version` 字段'
       '（全 212 版唯一例外）、ITERATION_LOG 元信息停在 3.60.0、边界文档契约行停在「语法 637 文件」'
       '（真跑已 638）—— 均已按真读数补齐；③ 工具面：批量补丁把共享模块的 import 插进**多行 '
       'import 语句的中间**（8 个套件语法错，被语法门当场抓到），已改为插在该语句收尾行之后；'
       '另有两处补丁非幂等（重跑即误报失败）已加守卫。\n'
       '- 【验收 · 全量真跑】`node --test --reporter=tap tests/*.test.mjs` ⇒ 1..2951 / '
       '**pass 2951 / fail 0**（rc=0，205 秒）；十道脚本门禁（syntax / import-resolve / dead-exports / '
       'lifecycle / registry / keys / source-derivation / bridge-contract / weak-coercion / upstream-face）'
       '逐门单独真跑全 rc=0。')
n = s.count(OLD)
if '【验收 · 全量真跑】' in s:
    print('[b12] 遗留项已是验收读数形态，跳过（幂等）')
    raise SystemExit(0)
if n != 1:
    sys.exit('[b12] 遗留项锚点命中 %d 次' % n)
s = s.replace(OLD, NEW)
p.write_text(s, encoding='utf-8')
print('[b12] ITERATION_LOG 遗留项已更新为验收读数')

# 自证
s2 = p.read_text(encoding='utf-8')
assert 'pass 2951 / fail 0' in s2
assert '全量测试面（204 套件）尚未跑' not in s2
print('[b12] 自证通过')