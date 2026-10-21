#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.47.0 · R5-X7] 创作台 App 侧补丁：假设试写区的交互态与动作转交。

四处改动（锚点必须恰中 1 次）：
  ① import 契约件的态与文案表（界面不写第二份）；
  ② 构造函数里加 `_hy` 交互态（两栏草稿 + 基线 + 选中栏）；
  ③ 在「去向 id 与标签」之前插一整段假设试写交互（读 / 写 / run / keep / adopt / discard）；
  ④ 读数里补 `hy*` 字段；`onChatChanged` 里丢 `_hy` 实例态。

用法：
    python3 tools/patch_x7_app.py            # dry-run
    python3 tools/patch_x7_app.py --write    # 落盘
"""
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "apps", "creationdesk", "creationdesk-app.js")

IMPORT_ANCHOR = """import { handoffTargetIds as mbhTargetIds, handoffTargetLabel as mbhTargetLabel, MBH_STATES } from '../../config/material-board-handoff.js';
"""
IMPORT_ADD = """import { handoffTargetIds as mbhTargetIds, handoffTargetLabel as mbhTargetLabel, MBH_STATES } from '../../config/material-board-handoff.js';
/* [v4.47.0 · 第五期 R5-X7] 可丢弃的假设场景双栏试写（契约件）。
 *   本层只持**用户的临时选择**（两栏假设 + 基线 + 选中栏）与转交；
 *   态 / 文案 / 可比性判定全在契约件与宿主，界面不写第二份。
 *   ★ 试写**不是既成结局**：本层不生成、不采纳、不落正史。 */
import {
    HY_STATES, HY_LANES, HY_LANE_STATES, HY_ASSUME_KINDS, HY_ASSUME_LABEL,
    HY_DECISIONS, HY_DECISION_LABEL, HY_COMPARABLE, HY_COMPARABLE_LABEL, HY_LANE_STATE_LABEL,
    compareLanes as hyCompareLanes,
    laneLine as hyLaneLine, trialLine as hyTrialLine,
} from '../../config/hypo-trial-contract.js';
"""

CTOR_ANCHOR = """        /* [v4.45.0 · R5-O1] 交接单预览行（**纯读数**；预览不落笔，落笔在 boardCommit）。 */
        this._boardPreview = '';
"""
CTOR_ADD = """        /* [v4.45.0 · R5-O1] 交接单预览行（**纯读数**；预览不落笔，落笔在 boardCommit）。 */
        this._boardPreview = '';
        /* [v4.47.0 · R5-X7] 假设试写区交互态：两栏假设 + 各自试写文本 + 基线 + 选中栏。
         *   ★ 它**不是**剧情事实：只活在实例态与本机键 hy_trial，换会话一律作废。 */
        this._hy = {
            baseline: '',
            a: { kind: '', text: '', written: '' },
            b: { kind: '', text: '', written: '' },
            picked: '',
            flash: '',
            flashBad: false
        };
"""

METHOD_ANCHOR = """    /** 去向 id 与标签（界面不写第二份去向表）。 */
    boardTargetIds() { try { return mbhTargetIds(); } catch (_e) { return []; } }
"""
METHOD_ADD = """    /* ══════════ [v4.47.0 · 第五期 R5-X7] 可丢弃的假设场景双栏试写 ══════════
     * 【为什么要有它】正史选择（archive 的支线结局）只能对**已经存在的**两条分支做取舍；
     *   而「还没建正式分支前，先拿两种假设各写一栏看看」此前**全仓零落点**（grep 零命中）。
     *   于是用户要么在脑子里比，要么**先建一条正式分支再删** —— 而正式分支是既成结局，
     *   建了就有痕迹，「预演」被读成「已经这么定了」。
     * 【本层做什么】持用户的临时选择 + 转交；`run` 落本机键、`keep` 落既有草稿本、
     *   `adopt` 只判闸并交回选中栏、`discard` 清临时选择（**正史零写**）。
     * 【本层不做什么】不生成文本、不建分支、不写剧情事实、不发请求
     *   （计划原文三条不做：不自动多模型竞赛 / 不后台无限续写 / 不增加第二套生成 API）。
     * ------------------------------------------------------------------ */
    /** 试写区读数（宿主给；读不到 ⇒ null，**不拟一份**）。 */
    hyFace() {
        const host = this.host();
        if (!host || !host.hypoTrial) return null;
        return host.hypoTrial.face || null;
    }
    /** 试写区一行主读数（判据全在契约件 `trialLine`）。 */
    hyLine() {
        const host = this.host();
        if (host && host.hypoTrial && host.hypoTrial.line) return String(host.hypoTrial.line);
        try {
            return hyTrialLine({ state: HY_STATES.EMPTY });
        } catch (_e) { return '假设试写：读数读不到（不假装为空）'; }
    }
    /** 两栏读数（宿主有就用宿主的行；没有就用本机交互态现算，**不冒充已试写**）。 */
    hyLanes() {
        const face = this.hyFace();
        const out = {};
        for (const id of HY_LANES) {
            const fromFace = (face && face.lanes && face.lanes[id]) ? face.lanes[id] : null;
            const local = this._hy[id] || { kind: '', text: '', written: '' };
            const written = String(local.written || '');
            const assumeOk = !!String(local.kind || '').trim() && !!String(local.text || '').trim();
            const state = !assumeOk
                ? HY_LANE_STATES.REFUSED
                : (written ? HY_LANE_STATES.WRITTEN : HY_LANE_STATES.PENDING);
            const lane = {
                id: id,
                label: (fromFace && fromFace.label) || (id === 'a' ? '假设 A' : '假设 B'),
                state: (fromFace && fromFace.state) || state,
                chars: (fromFace && typeof fromFace.chars === 'number') ? fromFace.chars : written.length,
                assume: {
                    kind: String(local.kind || ''),
                    kindLabel: HY_ASSUME_LABEL[String(local.kind || '')] || HY_ASSUME_LABEL.custom,
                    text: String(local.text || '')
                },
                baseline: { given: !!String(this._hy.baseline || '').trim(), at: this._hy.baseline === '' ? null : Number(this._hy.baseline) }
            };
            lane.line = hyLaneLine(lane);
            out[id] = lane;
        }
        return out;
    }
    /** 可比性标签（宿主给了就用宿主的；没有就如实报「还没比」）。 */
    hyCompareLabel() {
        const face = this.hyFace();
        const c = face && face.comparable;
        if (c && c.label) return String(c.label);
        /* 宿主没给（试写区还没落盘）⇒ 如实报「比不了」，**不假装已比过**。 */
        return HY_COMPARABLE_LABEL['missing-baseline'] || '';
    }
    /** 基线（楼层号；空值即清空，**不默认挑一个**）。 */
    hySetBaseline(v) { this._hy.baseline = String(v == null ? '' : v).trim(); this.render(); return this._hy.baseline; }
    /** 一栏的假设种类（空值即清空，**不回落成「接受」**）。 */
    hySetAssumeKind(lane, kind) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        if (!id) return '';
        this._hy[id].kind = String(kind || '').trim();
        this.render();
        return this._hy[id].kind;
    }
    /** 一栏的假设说明。 */
    hySetAssumeText(lane, text) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        if (!id) return '';
        this._hy[id].text = String(text || '');
        return this._hy[id].text;
    }
    /** 一栏的试写文本（**用户显式写**：本层不代写、不后台续写）。 */
    hySetWritten(lane, text) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        if (!id) return '';
        this._hy[id].written = String(text || '');
        return this._hy[id].written;
    }
    /** 选中要采纳的那一栏（空值即取消选中）。 */
    hyPick(lane) {
        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';
        this._hy.picked = id;
        this.render();
        return id;
    }
    /** 假设种类 id 与标签（界面不写第二份种类表）。 */
    hyAssumeIds() { return HY_ASSUME_KINDS.slice(); }
    hyAssumeLabel(k) { return HY_ASSUME_LABEL[String(k || '')] || ''; }
    hyDecisionIds() { return HY_DECISIONS.slice(); }
    hyDecisionLabel(d) { return HY_DECISION_LABEL[String(d || '')] || ''; }
    hyLaneStateLabel(s) { return HY_LANE_STATE_LABEL[String(s || '')] || ''; }
    /**
     * 试写区动作统一入口（与 draftAct 同范式：只转咽喉，不直连、不落正史）。
     * @param {string} sub run | keep | adopt | discard
     */
    async hyAct(sub) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            /* 入口不在位 ⇒ **如实报没有接收者**，不许报成功。 */
            this._hy.flash = '**没有接收者**：创作工作台入口不在位（本层零写盘，不代写）';
            this._hy.flashBad = true;
            this.render();
            return { ok: false, note: this._hy.flash };
        }
        const face = this._displayedFace;
        const lanes = {};
        for (const id of HY_LANES) {
            const l = this._hy[id] || { kind: '', text: '', written: '' };
            lanes[id] = {
                assume: { kind: String(l.kind || ''), text: String(l.text || '') },
                text: String(l.written || '')
            };
        }
        const payload = {
            action: 'hypo', sub: String(sub || ''),
            baseline: (String(this._hy.baseline || '').trim() === '' ? null : Number(this._hy.baseline)),
            lanes: lanes,
            picked: this._hy.picked,
            scope: face && face.scope, token: face && face.token
        };
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        this._hy.flash = String((r && r.note) || '');
        this._hy.flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    /** 去向 id 与标签（界面不写第二份去向表）。 */
    boardTargetIds() { try { return mbhTargetIds(); } catch (_e) { return []; } }
"""

READOUT_ANCHOR = """            boardPreview: String(this._boardPreview || ''),
"""
READOUT_ADD = """            boardPreview: String(this._boardPreview || ''),
            /* [v4.47.0 · 第五期 R5-X7] 假设试写读数（**如实分列**：试写 ≠ 已采纳 ≠ 已落正史）。 */
            hyLine: this.hyLine(),
            hyFace: this.hyFace(),
            hyLanes: this.hyLanes(),
            hyCompareLabel: this.hyCompareLabel(),
            hyBaseline: String(this._hy.baseline || ''),
            hyPicked: String(this._hy.picked || ''),
            hyFlash: String(this._hy.flash || ''),
            hyFlashBad: this._hy.flashBad === true,
"""

RESET_ANCHOR = """        this._boardPreview = '';
        /* [v4.30.0 · R4-X9] 取材板也丢实例态"""
RESET_ADD = """        this._boardPreview = '';
        /* [v4.47.0 · R5-X7] 试写区实例态一律丢（换角色后上一个角色的两栏预演不能留着）。 */
        this._hy = { baseline: '', a: { kind: '', text: '', written: '' }, b: { kind: '', text: '', written: '' }, picked: '', flash: '', flashBad: false };
        /* [v4.30.0 · R4-X9] 取材板也丢实例态"""

PATCHES = [
    ("import", IMPORT_ANCHOR, IMPORT_ADD),
    ("ctor", CTOR_ANCHOR, CTOR_ADD),
    ("methods", METHOD_ANCHOR, METHOD_ADD),
    ("readout", READOUT_ANCHOR, READOUT_ADD),
    ("reset", RESET_ANCHOR, RESET_ADD),
]


def main():
    write = "--write" in sys.argv[1:]
    with open(TARGET, encoding="utf-8") as fh:
        src = fh.read()
    out = src
    for name, anchor, add in PATCHES:
        hits = out.count(anchor)
        if hits != 1:
            print("[FAIL] %s 锚点命中 %d 次（必须恰 1 次）" % (name, hits))
            return 1
        out = out.replace(anchor, add)
        print("[OK] %s 已应用" % name)
    if not write:
        print("dry-run：改动 %d 字节（加 --write 落盘）" % (len(out) - len(src)))
        return 0
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("已落盘：+%d 字节" % (len(out) - len(src)))
    return 0


if __name__ == "__main__":
    sys.exit(main())