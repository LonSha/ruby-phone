#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3430_apply.py — [v3.43.0] 抬版连带面：边界文档复校（真改写，零手抄）。

为什么必须改（三条门禁同时守它）：
  · tests/system-v3201.test.mjs 的 E2：文档必须带「v3.43.0 复校」标记，
    且「语法 N 文件」/「导入 N 文件 N 条」两行必须与**现场真跑**逐项一致；
  · tests/system-v328.test.mjs 的 B2/C1：同上，复校标记 = 当版、数字 = 真跑；
  · 正文第 43 行那句「实测规模（vX.Y.Z 复校）：…语法门 N 文件」同样参与比对。

本脚本做四件事（全部现场取数，不写字面量）：
  ① 标题行改为「# ruby-phone 运行时验证边界（v2.82.0 起；**v3.43.0 复校**）」；
  ② 实测规模行用现场读数刷新；
  ③ 两行契约行（- 语法 N 文件 / - 导入 N 文件 N 条）用现场读数刷新；
  ④ 追加 v3.43.0 复校段（定位 / 四块不缝逐条 / 本版自抓真缺陷 / 判据侧自身错 / R-O3 三条）。

用法：python3 tools/doc3430_apply.py            # 只报差异（dry-run）
      python3 tools/doc3430_apply.py --write    # 落盘
"""
import io
import json
import re
import subprocess
import sys

ROOT = '/home/user/ruby-phone'
DOC = ROOT + '/docs/runtime-verification-boundary.md'
VER = '3.43.0'
WRITE = '--write' in sys.argv[1:]


def live_readings():
    syn = subprocess.run(['node', 'scripts/syntax-check.mjs'], cwd=ROOT,
                         capture_output=True, text=True, timeout=600)
    imp = subprocess.run(['node', 'scripts/import-resolve-check.mjs'], cwd=ROOT,
                         capture_output=True, text=True, timeout=600)
    assert syn.returncode == 0, '语法门必须跑通'
    assert imp.returncode == 0, '导入门必须跑通'
    n_syn = re.search(r'语法门通过：(\d+) 个文件', syn.stdout).group(1)
    m = re.search(r'扫描 (\d+) 个文件 · 静态相对导入 (\d+) 条', imp.stdout)
    dyn = re.search(r'动态 import\((\d+)\) 条', imp.stdout)
    assert m and dyn, '导入门必须报出扫描面 / 条数 / 动态条数'
    return n_syn, m.group(1), m.group(2), dyn.group(1)


SEG = """- **v3.43.0 复校（素材缝合第 3 层第七件：PV 案头）**：本层本轮**没有新增可观测面**，做的是把
  Perigee OS 的「ニコニコ 音乐PV工房」一族（`niconico.js` 1467 行 + `niconico-pv-form` /
  `pv-frames` / `pv-lyrics` / `pv-media` / `pv-storyboard` / `pv-submit`，七件合计 **4450 行 / 126 方法**）
  缝成一个**新 App**（`apps/pvdesk/` 四件：数据层 / App 层 / 视图 / 样式）。
  取的是**治理面**：① 分镜脚本解析（区间反了 / 超镜数上限**逐条报**并裁到上限；镜头体为空**逐条报**；
  正文超硬限报「只解了前 N 字、后面 M 字没进来」；以「使用的素材」打头的行剔掉时**计数报出来**）；
  ② 逐镜要求文本组装（画风锚 + 机型 + 情绪 + 立绘号 + 「只画这一帧」约束；**逐格报填写态**：
  哪一格「没给」与哪一格「给了但认不出」不同形）；③ 歌词时间轴与字幕版式（三态 **不许压平**：
  带时间戳 / 没有时间戳 / 空；坏行按「没时间标签」「标签后没字」「元标签行」逐项列；
  主副行切法与出处逐句标）；④ 三项上限**余量**（四项画「读数 / 上限」，取不出来画横线，**不许画 0**）。
  ★ **四块不缝**（源的整套能力，本件一律不接）：① 源自起 WebAudio 合成与三段试听
  （`createGain` / `createOscillator`）；② 源自己切参考音频并编码 WAV（`_encodeWav`）；
  ③ 源自己把分镜图逐镜喂给生图入口、调视频生成任务队列出片、落 IndexedDB 与 GitHub 备份；
  ④ 源满篇 `document.getElementById` 直读宿主界面元素。
  **四条偏离**：① 镜头区间反了不许静默跳过（源只认正序）；② 镜头体为空不许静默收下；
  ③ 歌词坏行不许静默丢（源不中即 `continue`）；④ 上限不许只丢一句「已裁剪」（本件给余量与拒绝原因）。
  ★ **本版自己抓到四条真缺陷**（都在数据层，且都是「不报错、只错数据」）：
  ① **每镜正文尾部混入下一镜表头** —— 切割位置写成「下一表头结束 − 表头字数」，那落在右括号前的
  两个字符上、不在表头起点，于是每一镜的正文尾巴上都挂着别人的表头（分镜表看上去行行都多一截）；
  ② **LRC 时间标签根本没被剥掉** —— 剥标签写成拿「标签结束位置」当切割终点，`slice(end, end)` 恒为空串、
  而 `slice(0, end)` 又把标签本身加了回去，实测正文是「[00:01.00]第一行」、主副行被切成「[00:01」与「.00]第一行」；
  ③ **时间戳行被算成「没正文」**（②的下游）：坏行计数恒为 0，源那条「标签后没字」永远报不出来；
  ④ **时间码没补零** —— 本件出 `0:00`，而仓内同族件（曲库案头）的时间码是 `00:00` 两位形。
  另修**落盘层与仓内机制不对齐**一处：取数口原本走 `storage.getChatData` / `setChatData`，
  而本仓 storage 的公共 API 是 `get` / `set`、且 `scripts/keys-audit.mjs` 的证据面**只认 storage 句柄上的 get/set/remove**
  —— 走别的取数口会让四条键**从未进入登记面**（K1/K2/K3 一并失效）。已改回 `get` / `set`。
  ★ **本层能验**：分镜解析逐条报的**形状与计数**、逐镜文本的组装顺序与逐格填写态、歌词三态与坏行分类、
  上限余量在「取不出来」与「真的 0」下的不同形、四条会话键的归属登记、`onChatChanged` 四格全量重取。
  **不能保证**（三条均归 **R-O3**）：① 真宿主实机里的落盘 / 会话隔离 / 换会话重绑实况；
  ② 真机上贴一份回信进来后的观感与长歌词排版；③ 窄屏上的六页签 + 逐镜卡片 + 逐句字幕表排版。
  这三条与本层历来的口径同规：判据能守住的只有**形状**，**看起来没坏但显示不对** 的那一类仍要实机才能收。
"""


def main():
    n_syn, n_files, n_specs, n_dyn = live_readings()
    scheme = ('v%d 复校' % 0)  # 占位不用，避免误替换
    with io.open(DOC, encoding='utf-8') as f:
        doc = f.read()
    out = doc
    plan = []

    # ① 标题行：把标题里的复校标记刷到当版
    t_old = re.search(r'^# .*$', out, re.M).group(0)
    t_new = '# ruby-phone 运行时验证边界（v2.82.0 起；**v%s 复校**）' % VER
    plan.append(('标题行', t_old, t_new))

    # ② 实测规模行
    l_old = re.search(r'^- 实测规模（v[\d.]+ 复校）：.*$', out, re.M).group(0)
    l_new = ('- 实测规模（v%s 复校）：**%s 个文件 / %s 条静态相对导入**'
             '（另 %s 条动态 import 不计入判据）；语法门 **%s 文件**。'
             % (VER, n_files, n_specs, n_dyn, n_syn))
    plan.append(('实测规模行', l_old, l_new))

    # ③ 两行契约行
    c1_old = re.search(r'^- 语法 \d+ 文件.*$', out, re.M).group(0)
    plan.append(('契约-语法行', c1_old, '- 语法 %s 文件' % n_syn))
    c2_old = re.search(r'^- 导入 \d+ 文件 \d+ 条.*$', out, re.M).group(0)
    plan.append(('契约-导入行', c2_old, '- 导入 %s 文件 %s 条' % (n_files, n_specs)))

    for name, old, new in plan:
        if old == new:
            print('  = %s 已同源' % name)
            continue
        assert out.count(old) == 1, '%s 锚点必须恰中 1 次（实得 %d）' % (name, out.count(old))
        out = out.replace(old, new, 1)
        print('  ~ %s  %s  ->  %s' % (name, old[:60], new[:60]))

    # ④ 追加本版复校段
    if ('v%s 复校（素材缝合第 3 层第七件' % VER) in out:
        print('  = 本版复校段已在场')
    else:
        anchor = '## 五、当版实测数字'
        assert out.count(anchor) == 1, '复校段的插入锚点必须恰中 1 次'
        # 段序：历次复校段按版本号升序排列 → 插在「最后一段复校段之后、『未来若拿到…』之前」
        tail_mark = '未来若拿到可运行浏览器的环境'
        at = out.index(tail_mark)
        out = out[:at] + SEG + '\n' + out[at:]
        print('  + 追加 v%s 复校段（%d 字符）' % (VER, len(SEG)))

    # 自证：五个必核面
    ok = True
    for name, val in [
        ('标题带本版复校标记', ('v%s 复校' % VER) in out),
        ('契约-语法行与真跑一致', ('- 语法 %s 文件' % n_syn) in out),
        ('契约-导入行与真跑一致', ('- 导入 %s 文件 %s 条' % (n_files, n_specs)) in out),
        ('实测规模行与真跑一致', ('语法门 **%s 文件**' % n_syn) in out),
        ('同源标志语在场', '看起来没坏但显示不对' in out),
    ]:
        print('  %s %s' % ('✓' if val else '✗', name))
        ok = ok and val
    if not ok:
        return 1
    if not WRITE:
        print('（dry-run，未落盘；加 --write 生效）')
        return 0
    with io.open(DOC, 'w', encoding='utf-8') as f:
        f.write(out)
    print('WROTE %s（%d 字符）' % (DOC, len(out)))
    return 0


if __name__ == '__main__':
    sys.exit(main())