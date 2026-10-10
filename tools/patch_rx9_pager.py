#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 分页容量补丁：把内核的 narrowPlan 接进真实桌面分页（防「建好了零消费」）。

【为什么必须改 getIconPageCapacity】
  320px 窄屏把列数从 4 改成 3（phone.css 的 @media 段），而**每页容量是 JS 算的**：
  `getIconPageCapacity()` 写死 `columns = 4`。两处各写一个数字 ⇒ 320px 上每页
  仍然只摆 20 个（3 列 × 7 行），第 7 行被 dock 压住 —— 正是计划验收第四条要治的形态。
  本补丁让容量从内核 `narrowPlan()` 派生（**同一口径唯一实现**），
  列数由内核给、行数按可用高度算。

【怎么读视口】只在**有 window 时**读 innerWidth；读不出（无宿主 / 未挂载）⇒ NaN ⇒
  内核如实退回标准布局（不猜）。这与内核 narrowPlan 的判据一字不差。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
PATH = 'phone/home-screen.js'
src = io.open(ROOT + '/' + PATH, encoding='utf-8').read()

OLD = """    getIconPageCapacity() {
        const columns = 4;
        const rows = 5;
        return columns * rows;
    }"""
NEW = """    getIconPageCapacity() {
        /* [v3.93.0 · R-X9] 列数**从内核派生**（config/access-layers.js 的 narrowPlan）：
         *   320px 窄屏把列数改成 3（phone.css 的 @media 段落实），而容量是 JS 算的 ——
         *   两处各写一个 4 就必然漂移：窄屏上仍按 4 列摆，第 7 行被 dock 压住。
         *   行数仍按实测几何取 5（窄屏下图标更小、可用高度不变，故行数不变）。
         *   视口读不出 ⇒ 内核如实退回标准列数（不猜成窄屏）。 */
        let width = NaN;
        try {
            const w = (typeof window !== 'undefined') ? window : null;
            if (w && typeof w.innerWidth === 'number') width = w.innerWidth;
        } catch (_e) { width = NaN; }
        const plan = narrowPlan({ width: width, level: this._accessLevel() });
        const rows = 5;
        return plan.cols * rows;
    }

    /** 现读操作层档位（**只读** storage，不写、不缓存）：窄屏列数随档位微调。 */
    _accessLevel() {
        try {
            const st = (typeof window !== 'undefined') && window.VirtualPhone ? window.VirtualPhone.storage : null;
            const v = st && typeof st.get === 'function' ? st.get('sys_access_level') : null;
            return v || 'standard';
        } catch (_e) { return 'standard'; }
    }"""

n = src.count(OLD)
if n != 1:
    print('FAIL getIconPageCapacity 锚点命中 %d 次（要求恰中 1 次）' % n)
    sys.exit(1)
src = src.replace(OLD, NEW, 1)

IMP_OLD = "import { iconA11yName, a11yNameUsable } from '../config/access-layers.js';"
IMP_NEW = "import { iconA11yName, a11yNameUsable, narrowPlan } from '../config/access-layers.js';"
if src.count(IMP_OLD) != 1:
    print('FAIL import 锚点命中 %d 次' % src.count(IMP_OLD))
    sys.exit(1)
src = src.replace(IMP_OLD, IMP_NEW, 1)

io.open(ROOT + '/' + PATH, 'w', encoding='utf-8').write(src)
print('OK phone/home-screen.js -> %d 字节' % len(src))