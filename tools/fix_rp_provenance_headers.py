#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RubyPhone provenance 修正（第一刀：版权头 + manifest 署名）。

背景（实测，非推测）：
  - 仓内 50 个文件带 `Copyright (c) yuzuki` 头、其中 42 个带横幅
    「禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发」。
  - `manifest.json` 的 author 写着 `yuzuki × Ruby宇宙 × LonSha`。
  - 用户 2026-10-11 明确：本仓**不含 yuzuki-phone 的本地代码**，只是早期 LLM 误植。
  - 全盘检索确认：本地无 yuzuki-phone 源码留存
    （`/home/user/memory-plugin-research/yuzuki` 是 yuzuki-**Memory**，且在主仓之外）。

因此这些声明是「给人读的那一处与真源脱节」：它既不是真的（无上游代码）
又不是无关的（是在公开仓库里替第三方主张权利，并声明自己违反该权利）。

处置口径（三分法，不可一刀切）：
  A 版权头块  —— 伪陈述，**替换**为 RubyPhone 自有署名（保留文件名/结构）
  B 功能互操作串 —— **不动**（window.YuzukiMemory / 柚月の记懆 / yuzuki-phone-backup 等）
  C 主题资源名 —— **不动**（yuzuki-clear-floral / yuzuki_清透花语）
"""
import io, os, sys

R = '/home/user/ruby-phone'

# ---- A 版权头块：三种实测形态，逐一替换 ----
BLOCK_FULL = """/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */"""

BLOCK_FULL_ALT = """/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */"""

BLOCK_SHORT = """/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */"""

NEW_HEADER = """/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */"""

PAIRS = [
    (BLOCK_FULL, 'full'),
    (BLOCK_FULL_ALT, 'full-alt'),
    (BLOCK_SHORT, 'short'),
]

def main():
    files = []
    for dirpath, dirnames, filenames in os.walk(R):
        if '.git' in dirpath.split(os.sep) or 'node_modules' in dirpath.split(os.sep):
            continue
        for fn in filenames:
            if fn.endswith(('.js', '.css', '.json')):
                files.append(os.path.join(dirpath, fn))
    stat = {'full': 0, 'full-alt': 0, 'short': 0, 'miss': []}
    for p in files:
        s = io.open(p, encoding='utf-8', errors='surrogateescape').read()
        if 'Copyright (c) yuzuki' not in s:
            continue
        hit = False
        for blk, label in PAIRS:
            if blk in s:
                s = s.replace(blk, NEW_HEADER, 1)
                stat[label] += 1
                hit = True
                break
        if not hit:
            stat['miss'].append(os.path.relpath(p, R))
        io.open(p, 'w', encoding='utf-8', errors='surrogateescape').write(s)
    print('replaced:', {k: v for k, v in stat.items() if k != 'miss'})
    print('MISS:', stat['miss'])

if __name__ == '__main__':
    main()
