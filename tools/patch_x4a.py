#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4a.py — [v4.28.0 · R4-X4 补丁 A] archive-app 接线

把 apps/archive/archive-canon.js（第五页签取数件）接进 ArchiveApp：
  ① import 接线件；
  ② 构造器持有实例 + 新增 _win()（宿主窗口取法）；
  ③ 新增 13 个只转发出口（六路读数 / 四行读数 / 判定 / 标签）；
  ④ setTab 白名单加 'canon'（**页签真源三处同步的第一处**）；
  ⑤ onChatChanged 丢掉「上一次选了哪一位冲突」。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
APP = 'apps/archive/archive-app.js'


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


A1_OLD = u"""import { rwProjectsFromPack } from '../../config/resume-workbench.js';
export const AR_PACK_KEY = 'archive_pack';"""
A1_NEW = u"""import { rwProjectsFromPack } from '../../config/resume-workbench.js';
/* [v4.28.0 · 第四期 R4-X4] 支线结局选择与接续的**取数接线件**。
 *   本件是「存档台第五页签」的取数源；判定词与标签表都在纯契约件
 *   （config/branch-canon-contract.js）里，接线件只转发、视图只画 ——
 *   三处各写一份必然漂移，而漂移那天没人会响。 */
import { ArchiveCanon } from './archive-canon.js';
export const AR_PACK_KEY = 'archive_pack';"""

A2_OLD = u"""        this._proj = null;
    }
    /* ---------- storage 三态（本仓纪律：抛异常不等于「没记过」） ---------- */"""
A2_NEW = u"""        this._proj = null;
        /* [v4.28.0 · R4-X4] 支线结局面（六路读数 + 四行读数）。
         *   本件只持「用户选了哪一位冲突」—— 读数一律现取，绝不缓存副本。 */
        this.canon = new ArchiveCanon(this);
    }
    /* [v4.28.0 · R4-X4] 宿主窗口（与 plotline-app 同取法：注入优先，回落全局） */
    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }
    /* ---------- storage 三态（本仓纪律：抛异常不等于「没记过」） ---------- */"""

A3_OLD = u"""    tab() { return this._tab; }
    setTab(t) {
        const k = toStr(t);
        const ok = ['pack', 'face', 'reset', 'ledger'];"""
A3_NEW = u"""    tab() { return this._tab; }
    /* ========== [v4.28.0 · R4-X4] 支线结局选择与接续（只转发，不重判） ==========
     *   【为什么出口要这么多】每一路答的是**不同的问题**，合成一路就会把
     *   「还没选完」与「选了也没东西可接」读成同一句话，而两者处置相反
     *   （回去选 / 去补结局条文）。判定与标签一律走内核，本层不做第二份。 */
    /** 一次取齐「冲突列举 + 结算计划 + 交接预览 + 落卷 + 凭据 + 撤销 + 四行读数 + 当前起点」。
     *   ★ 没选冲突位时如实报「还没选」—— **不默认挑第一位**（那会把「用户还没定」
     *     伪装成「这一位已经定了」）。 */
    canonPack(opts) {
        try { return this.canon.pack(opts || {}); }
        catch (_e) { return this.canon.pack({}); }
    }
    /** 当前选中的冲突位（空串 = 还没选） */
    canonSlot() {
        try { return this.canon.slot; } catch (_e) { return ''; }
    }
    /** 设为要定的那一位（空值即清空，**不回落成「默认第一位」**） */
    setCanonSlot(key) {
        try { return this.canon.setSlot(key); } catch (_e) { return ''; }
    }
    /** 四档决定 id 列表（界面按钮的**唯一出处**是内核，不写第二份顺序表） */
    canonDecisionIds() {
        try { return this.canon.decisionIds(); } catch (_e) { return []; }
    }
    /** 四档决定标签（视图不写第二份标签表） */
    canonDecisionLabel(d) {
        try { return this.canon.decisionLabel(d); } catch (_e) { return String(d == null ? '' : d); }
    }
    /** 冲突档 / 落卷三态 / 出处三态 / 缺格三因 / 撤销四表 —— 标签一律转内核表 */
    canonClashLabel(v) {
        try { return this.canon.clashLabel(v); } catch (_e) { return String(v == null ? '' : v); }
    }
    canonAdoptLabel(v) {
        try { return this.canon.adoptLabel(v); } catch (_e) { return String(v == null ? '' : v); }
    }
    canonProvLabel(v) {
        try { return this.canon.provLabel(v); } catch (_e) { return String(v == null ? '' : v); }
    }
    canonUnmappedLabel(v) {
        try { return this.canon.unmappedLabel(v); } catch (_e) { return String(v == null ? '' : v); }
    }
    canonRevokeLabel(v) {
        try { return this.canon.revokeLabel(v); } catch (_e) { return String(v == null ? '' : v); }
    }
    /**
     * 这一面能不能读 + 读不到时的处置建议（**判定词只许内核一份**）。
     *   视图拿这个出口决定「先报读不到」还是「画板子」，不自己比状态字面量 ——
     *   自己比就会在内核改名时静默走到「读到」那一支。
     */
    canonGate(read) {
        try { return this.canon.gate(read); }
        catch (_e) { return { readable: false, hint: '支线结局面不可读' }; }
    }
    /** 落卷读数的一句说明（'' = 没有要说的） */
    canonNote(read) {
        try { return this.canon.note(read); }
        catch (_e) { return ''; }
    }
    setTab(t) {
        const k = toStr(t);
        const ok = ['pack', 'face', 'reset', 'ledger', 'canon'];"""

A4_OLD = u"""    onChatChanged() {
        this._tab = 'pack';
        this._sel = null;"""
A4_NEW = u"""    onChatChanged() {
        this._tab = 'pack';
        this._sel = null;
        /* [v4.28.0 · R4-X4] 换会话也丢掉「上一次选了哪一位冲突」：那是旧会话的选择，
         *   而正史面随会话变 —— 留着它会把新会话里一个同名的冲突位当成旧选择。 */
        try { this.canon.resetScene(); } catch (_e) { /* 静默：换会话绝不能因接线件而报错 */ }"""


def main():
    s = rd(APP)
    s = once(s, A1_OLD, A1_NEW, 'import')
    s = once(s, A2_OLD, A2_NEW, 'ctor')
    s = once(s, A3_OLD, A3_NEW, 'setTab')
    s = once(s, A4_OLD, A4_NEW, 'onChatChanged')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(APP, s)
    print('--- WRITTEN A ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
