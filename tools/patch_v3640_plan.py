#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3640_plan.py — 抬版连带面：PLAN.md 现状基线重算（读数零手抄）。

PLAN.md 的「现状基线」段停在 **v3.56.0 / ac0a570**（第 3 行自述「2026-10-04 核实」）。
此后 v3.57~v3.64 八版全部落地，五格读数**每一项都已偏移**：

  版本       v3.56.0        -> v3.64.0
  门禁       2881 tests     -> 2978 tests / 0 fail（v3.64.0 全量实测）
  体量       388 .js / 290201 行 / tests 200 套件 / index.js 885409 字节 14142 行
             -> 400 .js / 291946 行 / tests 206 套件 / index.js 778983 字节 13017 行
  平台消费面 65 生命周期      -> 66（v3.62/v3.63 新增 App 各带一条）
  NA 台账    5 件            -> 4 件（v3.58.0 O4 把 search 移出）
  config    53 文件          -> 58 文件

纪律：每格锚点必须恰中 1 次；默认 dry-run，--write 才落盘；读数全部来自现场实测
（本脚本顶部把实测值写死为常量，但每个常量都在本次会话里由真跑取得，并在注释里注明出处命令）。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, 'PLAN.md')
WRITE = '--write' in sys.argv

# ── 现场实测读数（出处逐条注明）──
VER = '3.64.0'                  # manifest/package/update-log.latest/index.js 常量
HEAD = '5a20685'                # git rev-parse --short HEAD（v3.64.0 交付提交）
TESTS = '2978'                  # npm test ->  pass 2978 / fail 0
JS_N = '400'                    # find . -name '*.js' -not -path './node_modules/*' | wc -l
JS_L = '291946'                 # 同上 -exec cat {} + | wc -l
APPS_JS = '315'                 # find apps -name '*.js' | wc -l
CFG_JS = '58'                   # find config -name '*.js' | wc -l
APP_DIRS = '80'                 # ls -d apps/*/ | wc -l
SUITES = '206'                  # ls tests/*.test.mjs | wc -l
IDX_B = '778983'                # wc -c index.js
IDX_L = '13017'                 # wc -l index.js
F_LIFE = '66'                   # faceCounts(MATRIX).F6_lifecycle
NA_N = '4'                      # Object.keys(NA).length
MATRIX_ROWS = '81'              # MATRIX.length（80 目录 + memory 双 App 一行）


def rd(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


doc = rd(PLAN)

doc = once(doc,
           '> **当前规划入口（2026-10-04 核实，v3.56.0 / ac0a570）**：',
           '> **当前规划入口（2026-10-08 复算，v%s / %s）**：' % (VER, HEAD),
           'PLAN 头部核实行')

doc = once(doc,
           '| 版本 | v3.56.0（五源同源） | `update-log.json` latest / `package.json` |',
           '| 版本 | v%s（五源同源） | `update-log.json` latest / `package.json` |' % VER,
           'PLAN 版本行')

doc = once(doc,
           '| 门禁 | `npm run check` **十一道门全过**，**2881 个 tests / 0 fail**'
           '（v3.55.0 实测；v3.56.0 本轮新增 v3560 套件 15 例） | `package.json` scripts.check |',
           '| 门禁 | `npm run check` **十一道门全过**，**%s 个 tests / 0 fail**'
           '（v%s 全量实测，duration 126s） | `package.json` scripts.check |' % (TESTS, VER),
           'PLAN 门禁行')

OLD_BULK = ('| 体量 | **388 个 .js / 290201 行**：apps 315 文件（**80 个 App 目录**）、'
            'config 53 文件、tests 200 套件；`index.js` **885409 字节 / 14142 行** '
            '| `find . -name \'*.js\'` / `wc -l` / `wc -c` |')
NEW_BULK = ('| 体量 | **%s 个 .js / %s 行**：apps %s 文件（**%s 个 App 目录**）、'
            'config %s 文件、tests %s 套件；`index.js` **%s 字节 / %s 行** '
            '| `find . -name \'*.js\'` / `wc -l` / `wc -c` |'
            % (JS_N, JS_L, APPS_JS, APP_DIRS, CFG_JS, SUITES, IDX_B, IDX_L))
doc = once(doc, OLD_BULK, NEW_BULK, 'PLAN 体量行')

OLDM = ('| 平台消费面 | **80 件 App × 六条平台级消费面**矩阵（生成侧注入 28 / 全局搜索 27 / '
        '系统通知 14 / 微信链路 10 / 上游读数 12 / 生命周期 65；六面全无 5 件已入「不适用」台账） '
        '| `config/app-consumption-matrix.js` / `tests/system-v3550.test.mjs` |')
NEWM = ('| 平台消费面 | **%s 行 × 六条平台级消费面**矩阵（生成侧注入 28 / 全局搜索 27 / '
        '系统通知 14 / 微信链路 10 / 上游读数 12 / 生命周期 %s；六面全无 %s 件已入「不适用」台账） '
        '| `config/app-consumption-matrix.js` / `tests/system-v3550.test.mjs` |'
        % (MATRIX_ROWS, F_LIFE, NA_N))
doc = once(doc, OLDM, NEWM, 'PLAN 平台消费面行')

# 补一行：本表读数由谁保证不腐烂（与门禁面同源）
TAIL_ANCHOR = '| 素材 | L0 四类静态素材**已全部接入产品侧消费点**（v3.24.0）；素材路线图前三层十八件已缝完（v3.25~v3.54） | `config/l0-assets.js` / `tests/system-v3240.test.mjs` |'
NOTE = '\n> 本表**没有判据看守**（它不在任何门禁的扫描面里），所以每次抬版都要人肉复算一次 —— 这是已知欠债，'
NOTE += '已登记在 O8「计划、基线与测试成本收口」名下。读数出处逐条写在最右列，复算时按列跑命令即可。'
doc = once(doc, TAIL_ANCHOR, TAIL_ANCHOR + '\n' + NOTE, 'PLAN 基线表尾注')

# 表尾注不得含方括号/反斜杠（沿用版本条目源断言口径，防污染弹窗与判据切片）
assert '[' not in NOTE and ']' not in NOTE and chr(92) not in NOTE

if not WRITE:
    print('PLAN 现状基线五格 + 头部核实行 + 尾注（dry-run，未落盘）')
    sys.exit(0)
with open(PLAN, 'w', encoding='utf-8') as f:
    f.write(doc)
print('已落盘：PLAN.md（五格 + 头部核实行 + 尾注）')