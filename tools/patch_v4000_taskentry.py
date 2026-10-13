#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4000_taskentry.py — v4.00.0 · R3-O7：任务入口的跨 App 媒体任务聚合面。

计划原文要给的是「**统一用户侧任务卡**：等待/生成/可播放/失败/结果待核」——
本补丁把注册板读数摆进任务入口（本 App 是全局任务面的落点）。

三处改动：
  ① import 注册板读数口（mediaTasks 挂 window.VirtualPhone，本件只读它）；
  ② _vm 加 mediaTasks 读数（每次现取——读数不落库的口径与本仓其它 App 一致）；
  ③ 视图加媒体任务段（五档计数 + 按态列表；空读数如实报「没有进行中的生成」）。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv


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


# ---------- ① app 层：_vm 加 mediaTasks 读数 ----------
s = rd('apps/taskentry/taskentry-app.js')
old1 = """            focus: focus
        };
    }"""
new1 = """            focus: focus,
            /* [v4.00.0 · R3-O7] 跨 App 媒体任务读数（生图/语音的中断续用）。
             *   **每次现取、不缓存**：注册板是会话内存，读数随生成进度实时变；
             *   缓存一份必然在「任务刚完成」时给出旧读数（本仓反复抓到的形态）。
             *   板未就绪（宿主早期/无壳环境）时如实报 absent，不造一个空的成功读数。 */
            media: this._mediaReadings()
        };
    }
    /**
     * [v4.00.0 · R3-O7] 媒体任务聚合读数。
     *   板不在（window.VirtualPhone.mediaTasks 缺失）⇒ ready:false + 如实原因，
     *   与「板上真的没有任务」（total === 0）是两件不同的事，必须分得开。
     */
    _mediaReadings() {
        const board = (typeof window !== 'undefined' && window.VirtualPhone)
            ? window.VirtualPhone.mediaTasks : null;
        if (!board || typeof board.snapshot !== 'function') {
            return { ready: false, reason: '任务注册板未就绪', total: 0, counts: null, groups: null };
        }
        const snap = board.snapshot();
        return {
            ready: true,
            reason: '',
            total: snap.total,
            counts: snap.counts,
            groups: snap.groups
        };
    }"""
s = once(s, old1, new1, 'vm-media')

# 自检读数也带上注册板内核自检（诊断面一并可见）
old2 = """    selfCheck() {
        const r = taskEntrySelfCheck();
        return { problems: listOf(r.problems), cards: r.cards, caps: r.caps };
    }"""
new2 = """    selfCheck() {
        const r = taskEntrySelfCheck();
        /* [v4.00.0 · R3-O7] 注册板内核自检（板在才读；不在时报 null 而不是假绿）。 */
        const board = (typeof window !== 'undefined' && window.VirtualPhone)
            ? window.VirtualPhone.mediaTasks : null;
        const mediaCheck = (board && typeof board.selfCheck === 'function') ? board.selfCheck() : null;
        return { problems: listOf(r.problems), cards: r.cards, caps: r.caps, mediaCheck: mediaCheck };
    }"""
s = once(s, old2, new2, 'selfcheck-media')

if WRITE:
    wr('apps/taskentry/taskentry-app.js', s)
    print('taskentry-app.js written OK')
else:
    print('DRY RUN OK (app anchors hit, no write)')