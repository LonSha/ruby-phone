#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.47.0 · R5-X7] 宿主侧补丁：把「可丢弃的假设场景双栏试写」接进 index.js 的创作工作台咽喉。

三处改动（每处锚点必须恰中 1 次，否则拒绝落盘）：
  ① import 契约件（紧接 creation-multi-draft 的 import 之后）；
  ② CW_ACTION_KEYS 末位追加 'hypo'（不动首项：v4.01.0 的判据锁「白名单以 plan 开头」）；
  ③ 在 `board` 动作分支之后插一支 `hypo` 分支：
       · run  —— 收下用户的两栏与基线，**本机键只落试写区**（预演不是正史）；
       · keep —— 把选中的那一栏收进既有草稿本（source = HY_DRAFT_SOURCE）；
       · adopt—— 只判闸（adoptGate），**转交上游**，本机一个正史字节都不落；
       · discard —— 清本机临时选择，正史零写；
     · 另在 refreshCreationdesk 的读数里补 `hypoTrial` 一格（面态 + 两栏 + 可比性）。
用法：
    python3 tools/patch_x7_hypo.py            # 只报差异（dry-run）
    python3 tools/patch_x7_hypo.py --write    # 落盘
"""
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "index.js")

# ── ① import 块 ──────────────────────────────────────────────
IMPORT_ANCHOR = """} from './config/creation-multi-draft.js';
"""
IMPORT_ADD = """} from './config/creation-multi-draft.js';
/* [v4.47.0 · 第五期 R5-X7] 可丢弃的假设场景双栏试写（纯契约件）。
 *   接在咽喉的理由与 R5-O1 同族：两栏文本 / 基线 / 上游探测全由调用方给，
 *   契约件不取数、不写存储、不发布；**试写不是既成结局** —— 正史零写由本层守。
 *   落笔只有一处：既有草稿本 `cw_drafts`（source = HY_DRAFT_SOURCE）；
 *   转正式分支**只判闸、只转交**（adoptGate 不给凭据，接续归上游 owner）。 */
import {
    HY_STATES, HY_LANES, HY_LANE_STATES, HY_DECISIONS, HY_KEYS, HY_DRAFT_SOURCE,
    HY_LIMITS, normalizeTrial as hyNormalize, laneLine as hyLaneLine,
    compareLanes as hyCompare, readHypoTrial as hyProbe, adoptGate as hyAdoptGate,
    discardPlan as hyDiscardPlan, trialLine as hyTrialLine, hySelfCheck as hySelfCheckOf,
} from './config/hypo-trial-contract.js';
"""

# ── ② 动作白名单 ─────────────────────────────────────────────
KEYS_ANCHOR = "    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop', 'topic', 'board'];\n"
KEYS_NEW = ("    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop', 'topic', 'board', 'hypo'];\n")

# ── ③ hypo 分支（插在 board 分支的 return 之后）────────────────
BRANCH_ANCHOR = """                    key: norm.key,
                    count: norm.items.length,
                };
            }
"""
BRANCH_ADD = """                    key: norm.key,
                    count: norm.items.length,
                };
            }
            /* ══════ [v4.47.0 · 第五期 R5-X7] 可丢弃的假设场景双栏试写 ══════
             *   计划原文：「选择基线时点与两种假设，分别预览材料 / 约束并可显式试写；
             *     对照文本保留为草稿；只有用户选择转为正式分支后才调用原接续确认。」
             *   ★ 本分支**只落两处**：① 本机键 hy_trial（试写区本身，换会话作废）；
             *     ② 既有草稿本 cw_drafts（用户选「保留为草稿」时，source=hypo-trial）。
             *   ★ **正史零写**：adopt 只走 adoptGate 判闸并把选中的那一栏交回调用方，
             *     本层不写任何剧情事实、不建分支、不发请求（计划原文「不增加第二套生成 API」）。
             *   ★ 试写文本由用户显式给（或由上游既有生成通道产出后经本口收下）——
             *     本层**不自己生成**，故不存在「后台无限续写」。 */
            if (action === 'hypo') {
                const sub = String(p.sub || '').trim();
                const readTrial = function () {
                    try {
                        const raw = storage && typeof storage.get === 'function' ? storage.get(HY_KEYS.trial, '') : '';
                        if (!raw) return null;
                        return (typeof raw === 'string') ? JSON.parse(raw) : raw;
                    } catch (_e) { return null; }
                };
                const writeTrial = function (obj) {
                    try {
                        if (!storage || typeof storage.set !== 'function') return false;
                        storage.set(HY_KEYS.trial, JSON.stringify(obj));
                        return true;
                    } catch (_e) { return false; }
                };
                const probe = hyProbe((typeof window !== 'undefined') ? window : globalThis, {
                    materials: (p.materials === undefined ? null : p.materials),
                    materialsReadable: (p.materialsReadable === true)
                });
                /* ── discard：清本机临时选择（**正史零写**，且如实报清掉了几栏） ── */
                if (sub === 'discard') {
                    const cur = readTrial();
                    const dp = hyDiscardPlan((cur && cur.trial) || {});
                    writeTrial({ trial: null, at: Date.now() });
                    refreshCreationdesk();
                    return {
                        ok: true, kind: 'hypo-discarded', note: dp.note,
                        clearedTexts: dp.clearedTexts, clearedChars: dp.clearedChars,
                        canonWrites: 0
                    };
                }
                /* ── run：收下基线 + 两栏（含试写文本），落本机键 ── */
                if (sub === 'run') {
                    const norm = hyNormalize({
                        baseline: p.baseline, lanes: p.lanes, picked: p.picked
                    });
                    const lanesOut = {};
                    for (const id of HY_LANES) {
                        const l = (norm.trial.lanes || {})[id] || {};
                        lanesOut[id] = {
                            id: id, label: l.label, state: l.state, chars: l.chars,
                            line: hyLaneLine(l),
                            assume: l.assume || null,
                            baseline: l.baseline || null
                        };
                    }
                    const cmp = hyCompare((norm.trial.lanes || {}).a, (norm.trial.lanes || {}).b);
                    if (!norm.ok) {
                        /* 拒收时**照样把用户写过的两栏留住**（换个走向就能接着写）。 */
                        writeTrial({
                            trial: {
                                baseline: norm.trial.baseline,
                                lanes: norm.trial.lanes,
                                picked: norm.trial.picked
                            },
                            at: Date.now()
                        });
                        const face = {
                            ok: false, state: HY_STATES.REFUSED, reason: norm.why,
                            lanes: lanesOut, comparable: cmp, probe: probe
                        };
                        face.line = hyTrialLine(face);
                        refreshCreationdesk();
                        return { ok: false, kind: 'hypo-' + norm.why, note: face.line, face: face };
                    }
                    if (!writeTrial({
                        trial: {
                            baseline: norm.trial.baseline,
                            lanes: norm.trial.lanes,
                            picked: norm.trial.picked
                        },
                        at: Date.now()
                    })) {
                        return { ok: false, kind: 'hypo-write-failed', note: '试写区落盘失败（**不得当作试写跑过了**）' };
                    }
                    const written = HY_LANES.filter(function (id) {
                        return (norm.trial.lanes || {})[id] && norm.trial.lanes[id].state === HY_LANE_STATES.WRITTEN;
                    }).length;
                    const face = {
                        ok: true,
                        state: (written > 0 ? HY_STATES.READY : HY_STATES.EMPTY),
                        reason: (written > 0 ? 'ok' : 'empty'),
                        lanes: lanesOut, comparable: cmp, probe: probe,
                        baseline: norm.trial.baseline, picked: norm.trial.picked, written: written
                    };
                    face.line = hyTrialLine(face);
                    refreshCreationdesk();
                    return { ok: true, kind: 'hypo-' + face.state, note: face.line, face: face };
                }
                /* ── keep：把选中的那一栏收进既有草稿本（**只落草稿，不落正史**） ── */
                if (sub === 'keep') {
                    const cur = readTrial();
                    const trial = (cur && cur.trial) || null;
                    const picked = String(p.picked || (trial && trial.picked) || '').trim();
                    const lane = (trial && trial.lanes && trial.lanes[picked]) || null;
                    if (!lane || lane.state !== HY_LANE_STATES.WRITTEN) {
                        return {
                            ok: false, kind: 'hypo-keep-not-written',
                            note: '这一栏还没有试写文本 —— 收进草稿的是**你写过的内容**，不是「跑过了」'
                        };
                    }
                    /* 幂等键 = 栏 id + 基线 + 文本指纹（同一份选定只落一行）。 */
                    const fp = String(lane.chars) + '-' + String(lane.text.length);
                    const key = 'hy-' + picked + '-' + String((trial.baseline && trial.baseline.at) || 0) + '-' + fp;
                    const bookNorm = normalizeDraftBook(cwReadDraftsRaw());
                    const exists = bookNorm.drafts.some(function (d) { return d.key === key; });
                    if (exists) {
                        const note = '这一栏已经在草稿本里了（同一份选定不重复落）';
                        return { ok: true, kind: 'hypo-keep-replayed', note: note, key: key, state: 'replayed' };
                    }
                    const nd = normalizeDraft({
                        key: key,
                        source: HY_DRAFT_SOURCE,
                        materialId: picked,
                        target: 'draft',
                        note: String(lane.text || ''),
                        tags: ['预演', picked],
                        version: 1,
                        state: 'editing',
                        at: Date.now()
                    });
                    if (!nd.ok) {
                        return { ok: false, kind: 'hypo-keep-normalize', note: '草稿被拒：' + String(nd.reason || '') };
                    }
                    const book = upsertDraft(bookNorm.drafts, nd.draft);
                    const w = cwWriteDrafts(book.drafts);
                    refreshCreationdesk();
                    if (!w.ok) {
                        return { ok: false, kind: w.reason, note: '草稿本落盘失败（**不得当作已保留**）' };
                    }
                    return {
                        ok: true, kind: 'hypo-keep-drafted', key: key, state: 'drafted',
                        note: '已收进草稿本（**预演，不是既成结局**）：' + String(lane.chars) + ' 字'
                    };
                }
                /* ── adopt：只判闸、只转交（**本层零写正史**） ── */
                if (sub === 'adopt') {
                    const cur = readTrial();
                    const trial = (cur && cur.trial) || null;
                    const picked = String(p.picked || (trial && trial.picked) || '').trim();
                    if (trial && picked) trial.picked = picked;
                    const gate = hyAdoptGate(trial || {}, { hasAdoptFace: probe.hasFace === true });
                    refreshCreationdesk();
                    return {
                        ok: gate.ok === true, kind: 'hypo-adopt-' + gate.why,
                        note: gate.hint, why: gate.why, picked: gate.picked || '',
                        /* ★ 本层一个正史字节都没落：接续归上游 owner（计划原文）。 */
                        canonWrites: 0
                    };
                }
                return { ok: false, kind: 'hypo-bad-sub', note: '不认识的试写子命令（run / keep / adopt / discard）：' + sub };
            }
"""

# ── ④ 读数补一格 ─────────────────────────────────────────────
FACE_ANCHOR = """                topicSelfCheck: topicSelfCheckOf(),
"""
FACE_ADD = """                topicSelfCheck: topicSelfCheckOf(),
                /* [v4.47.0 · 第五期 R5-X7] 假设试写读数（**如实分列**：试写 ≠ 已采纳）。
                 *   · probe  —— 上游试写面在不在（不在 ⇒ 本机手工试写，照样可用）；
                 *   · lanes  —— 逐栏三态（还没写 / 有文本 / 这一栏不合格）；
                 *   · comparable —— 两栏基线是否相同（同基线才叫「同一场景的两条岔路」）。 */
                hypoTrial: (function () {
                    let cur = null;
                    try {
                        const raw = storage && typeof storage.get === 'function' ? storage.get(HY_KEYS.trial, '') : '';
                        if (raw) cur = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                    } catch (_e) { cur = null; }
                    const trial = (cur && cur.trial) || null;
                    const probe = hyProbe((typeof window !== 'undefined') ? window : globalThis, {
                        materials: null, materialsReadable: false
                    });
                    if (!trial) {
                        const face = { ok: false, state: HY_STATES.EMPTY, reason: 'empty', lanes: {}, probe: probe };
                        face.line = hyTrialLine(face);
                        return { present: false, face: face, line: face.line, selfCheck: hySelfCheckOf() };
                    }
                    const lanesOut = {};
                    for (const id of HY_LANES) {
                        const l = (trial.lanes || {})[id] || {};
                        lanesOut[id] = {
                            id: id, label: l.label, state: l.state, chars: l.chars,
                            line: hyLaneLine(l),
                            assume: l.assume || null,
                            baseline: l.baseline || null
                        };
                    }
                    const cmp = hyCompare((trial.lanes || {}).a, (trial.lanes || {}).b);
                    const written = HY_LANES.filter(function (id) {
                        return (trial.lanes || {})[id] && trial.lanes[id].state === HY_LANE_STATES.WRITTEN;
                    }).length;
                    const face = {
                        ok: written > 0,
                        state: (written > 0 ? HY_STATES.READY : HY_STATES.EMPTY),
                        reason: (written > 0 ? 'ok' : 'empty'),
                        lanes: lanesOut, comparable: cmp, probe: probe,
                        baseline: trial.baseline, picked: trial.picked, written: written
                    };
                    face.line = hyTrialLine(face);
                    return {
                        present: true, face: face, line: face.line,
                        decisions: HY_DECISIONS.slice(), limits: HY_LIMITS,
                        selfCheck: hySelfCheckOf()
                    };
                })(),
"""

PATCHES = [
    ("import", IMPORT_ANCHOR, IMPORT_ADD),
    ("action-keys", KEYS_ANCHOR, KEYS_NEW),
    ("hypo-branch", BRANCH_ANCHOR, BRANCH_ADD),
    ("face-readout", FACE_ANCHOR, FACE_ADD),
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
    if out == src:
        print("无改动。")
        return 0
    if not write:
        print("dry-run：改动 %d 字节（加 --write 落盘）" % (len(out) - len(src)))
        return 0
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("已落盘：+%d 字节" % (len(out) - len(src)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
