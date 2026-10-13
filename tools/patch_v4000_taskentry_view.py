#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4000_taskentry_view.py — v4.00.0 · R3-O7：任务入口视图的媒体任务段。

一段新增 + 一处插入：
  · _media(vm)：五档计数 + 按态列表（等待/生成/可播放/失败/待核 + 已取消）；
    板不在 ⇒ 如实报「读不到任务面（已降级）」——与「真的没有任务」分得开。
  · 插在 _filters 之后、收藏段之前（任务面应在导航之上：用户更常关心「在跑什么」）。
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


s = rd('apps/taskentry/taskentry-view.js')

# ---------- ① 新增 _media 方法（插在 _card 之前） ----------
old1 = """    /** 一张卡：标题 + 每条靶心一行（页签状态如实标，不可用说清原因）。 */"""
new1 = """    /**
     * [v4.00.0 · R3-O7] 跨 App 媒体任务段（生图/语音的中断续用）。
     *   五档计数 + 按态列表；**板读不到与板为空必须分得开**：
     *     ready=false ⇒ 降级说明（宿主早期/无壳环境）；ready=true 且 total=0 ⇒ 真的没有任务。
     *   取消入口不在本段：取消是各 App 自己的在飞任务（微信生图在气泡上），
     *   本段只做**跨 App 汇总可见性**，不抢 App 的动作权。
     */
    _media(vm) {
        const m = vm.media || {};
        let h = '<div class="te-media"><h3>生成任务</h3>';
        if (!m.ready) {
            h += '<div class="te-empty">' + esc(m.reason || '任务面读取失败') + '</div>';
            return h + '</div>';
        }
        const c = m.counts || {};
        const flight = Number(c.waiting || 0) + Number(c.running || 0);
        h += '<div class="te-media-counts">' +
            '等待 ' + String(c.waiting || 0) + ' · 生成中 ' + String(c.running || 0) +
            ' · 可播放 ' + String(c.playable || 0) + ' · 失败 ' + String(c.failed || 0) +
            ' · 待核 ' + String(c.review || 0) + ' · 已取消 ' + String(c.cancelled || 0) +
            (flight ? ('　<span class="te-media-live">在飞 ' + String(flight) + '</span>') : '') +
            '</div>';
        if (!m.total) {
            h += '<div class="te-empty">没有进行中的生成。</div>';
            return h + '</div>';
        }
        const order = [['waiting', '排队等待'], ['running', '生成中'], ['playable', '可播放'],
            ['failed', '失败可重试'], ['review', '结果待核'], ['cancelled', '已取消']];
        const groups = m.groups || {};
        for (const pair of order) {
            const list = groups[pair[0]] || [];
            if (!list.length) continue;
            h += '<div class="te-media-group"><div class="te-media-head">' + esc(pair[1]) +
                '（' + String(list.length) + '）</div>';
            for (const t of list) {
                h += '<div class="te-media-row"><span class="te-media-title">' + esc(t.title || '') +
                    '</span><span class="te-media-app">' + esc(t.app || '') + ' · ' + esc(t.kind || '') +
                    '</span>' + (t.hasResult ? '<span class="te-media-has">已有成果</span>' : '') + '</div>';
            }
            h += '</div>';
        }
        return h + '</div>';
    }
    /** 一张卡：标题 + 每条靶心一行（页签状态如实标，不可用说清原因）。 */"""
s = once(s, old1, new1, 'media-method')

# ---------- ② 插到 _html 里（filters 之后、收藏段之前） ----------
old2 = """        h += this._filters(vm);
        h += '<div class="te-pinned"><h3>收藏（按你摆的顺序）</h3>';"""
new2 = """        h += this._filters(vm);
        /* [v4.00.0 · R3-O7] 生成任务段在收藏之上：用户点开入口首先要知道「有什么在跑」。 */
        h += this._media(vm);
        h += '<div class="te-pinned"><h3>收藏（按你摆的顺序）</h3>';"""
s = once(s, old2, new2, 'html-insert')

assert s.count('_media(vm)') == 2, 'def + call, got %d' % s.count('_media(vm)')
assert s.count('te-media') >= 6

if WRITE:
    wr('apps/taskentry/taskentry-view.js', s)
    print('taskentry-view.js written OK')
else:
    print('DRY RUN OK (view anchors hit, no write)')