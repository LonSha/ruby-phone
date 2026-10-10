# -*- coding: utf-8 -*-
"""R-X8 诊断面卡补丁：diagnose-data.js（协议面 + 一行读数）与 diagnose-view.js（卡片渲染）。

与 R-X1..R-X7 的既有卡同范式：内核只陈列，视图只排版；三态不同形。

【修订记录（首次执行前自查发现并修掉三处）】
  ① import 路径曾误写 `crossrepo-caphealth-link.js`（不存在）⇒ 改为真源 `capability-health.js`；
     import 面同时收窄：只引本内核真正用到的四项（自检 / 能力 id 表 / 标签表 / 四态文案）。
  ② 视图卡曾调用 `symOfState(r.state)`，而 diagnose-view.js 里**没有这个函数** ——
     真跑起来是 ReferenceError（这一整卡连带后面的卡拉黑）。改为卡内**局部常量函数**，
     不新增模块级导出（本仓「视图不新增第二份状态文案实现」）。
  ③ 状态片曾写成 `this._chip(escapeHtml(...))` —— `_chip` 内部已经过一遍 escapeHtml，
     两次转义会把符号里的方括号渲染成 `&#91;`。改为**不预转义**，交给 `_chip` 一次做。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
DATA = os.path.join(ROOT, 'apps', 'diagnose', 'diagnose-data.js')
VIEW = os.path.join(ROOT, 'apps', 'diagnose', 'diagnose-view.js')

# ───────────────────── diagnose-data.js ─────────────────────

IMP_OLD = u"""/* [v3.83.0 · 计划 R-O7] 诊断处置面：把「有读数」翻成「能处置」。"""

IMP_NEW = u"""/* [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康协议面：与 backupFace / workflowFace 同范式 ——
 *   只读自检 + 六项能力四态行（含替代操作）+ 设备身份读数 + 零写入证据。
 *   ★ 本卡答的问题与上面几张**都不重叠**：那几张各答「某一功能这条路通不通」，
 *     本卡答「这台机器**有没有能力**跑那条路」—— 设备级前提，不是功能级读数。
 *   四态刻意不同形（可用 / 部分可用 / 不可用 / **未验证**）：压平任何两态都会造出
 *   「两种处置相反的处境长得一模一样」，而「没测过」被报成「坏了」正是本卡要防的那一类。 */
import {
    capHealthSelfCheck,
    CAPABILITY_IDS, CAPABILITY_LABELS, CAP_STATE_TEXT as CH_STATE_TEXT,
} from '../../config/capability-health.js';
/* [v3.83.0 · 计划 R-O7] 诊断处置面：把「有读数」翻成「能处置」。"""

FACE_OLD = u"""    /* [v3.88.0 · 拓展计划 R-X4] 跳项目续玩工作台协议面：与 financeCommitFace 同范式——
     *   只读自检 + 三态表 + 宿主缓存读数（选中项 / 清单 / 影响范围）+ 缺口。"""

FACE_NEW = u"""    /* [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康协议面：与 backupFace 同范式 ——
     *   只读自检 + 六项能力四态行 + 设备身份读数（本机 / 宿主 / 上游）+ 零写入证据。
     *   ★ 读数**只从咽喉那一份缓存读**（`vp._caphealth`），本内核不自己采观测 ——
     *     再采一份就是「同一读数的两个来源必然漂移」。缓存不在就如实报「尚未取数」。 */
    const capHealthFace = (() => {
        try {
            const self = capHealthSelfCheck();
            const problems = Array.isArray(self && self.problems) ? self.problems.map(String) : [];
            const w = hostWindow();
            const vp = (w && w.VirtualPhone) ? w.VirtualPhone : null;
            const cache = vp ? (vp._caphealth || null) : null;
            const summary = (cache && cache.summary) ? cache.summary : null;
            const notice = (cache && cache.notice) ? cache.notice : null;
            const rows = (summary && Array.isArray(summary.rows)) ? summary.rows.map((r) => ({
                id: String(r.id || ''),
                label: String(r.label || CAPABILITY_LABELS[r.id] || r.id || ''),
                state: String(r.state || ''),
                stateText: String(r.stateText || CH_STATE_TEXT[r.state] || ''),
                probe: String(r.probe || ''),
                why: String(r.why || ''),
                fallbacks: Array.isArray(r.fallbacks) ? r.fallbacks.slice() : [],
            })) : [];
            const counts = (summary && summary.counts) ? summary.counts : null;
            /* 「面缺席」与「尚未取数」必须分开：前者是咽喉没挂（本层读不出），
             *   后者是挂了但那一轮还没跑。压成一态就是本仓最贵的那类错读数。 */
            const linked = !!(vp && typeof vp.capHealthFace === 'function');
            const head = !linked
                ? '能力体检读数口不在位（咽喉未挂）—— **不是「六项都不可用」**'
                : (cache
                    ? (summary ? String(summary.line || '') : '读数在但汇总面读不出')
                    : '尚未取数（能力体检那一路还没跑过）');
            return {
                ok: problems.length === 0,
                reason: 'ok',
                problems: problems,
                linked: linked,
                cacheReadable: !!cache,
                counts: counts,
                total: summary ? summary.total : CAPABILITY_IDS.length,
                rows: rows,
                hostVersion: cache ? String(cache.hostVersion || '') : '',
                hostLine: cache ? String(cache.hostVersionText || '') : '',
                crossLine: notice ? String(notice.line || '') : '',
                crossStale: !!(notice && notice.stale),
                crossMissing: (notice && Array.isArray(notice.missing)) ? notice.missing.slice() : [],
                crossOutdated: (notice && Array.isArray(notice.outdated)) ? notice.outdated.slice() : [],
                writes: cache ? numOrNull(cache.writes) : null,
                states: 4,
                capabilities: CAPABILITY_IDS.length,
                line: head,
                text: '能力体检：四态（' + ['ok', 'partial', 'unavailable', 'unverified'].map((k) => CH_STATE_TEXT[k]).join(' / ') + '）；'
                    + '六项能力（' + CAPABILITY_IDS.map((k) => CAPABILITY_LABELS[k]).join(' / ') + '）；'
                    + head
                    + (notice ? ('；' + String(notice.line || '')) : '')
                    + (problems.length ? '**有 ' + String(problems.length) + ' 条问题**' : '；四态不同形 / 接口存在不报成服务可用 / 检测零写入零模型调用自检全部通过') + '。'
            };
        } catch (_e) { return null; }
    })();
    /* [v3.88.0 · 拓展计划 R-X4] 跳项目续玩工作台协议面：与 financeCommitFace 同范式——
     *   只读自检 + 三态表 + 宿主缓存读数（选中项 / 清单 / 影响范围）+ 缺口。"""

RET_OLD = u"workflowFace, creationWorkbenchFace, backupFace, knowledgeBridgeFace,"
RET_NEW = u"workflowFace, creationWorkbenchFace, backupFace, capHealthFace, knowledgeBridgeFace,"

TXT_OLD = u"""/* 原函数名保留：上面那个是新增，下面这个是既有实现。 */
export function creationWorkbenchFaceText(face) {"""
TXT_NEW = u"""/** [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康协议面的一行读数（唯一实现在本文件 collectDiagnose 内取的那一面）。
 *  与 backupFaceText 同范式：只做转发与文案，视图不自己拼。
 *  三态不同形：面缺席 / 尚未取数 / 有读数。 */
export function capHealthFaceText(face) {
    try {
        const f = (face && typeof face === 'object') ? face : null;
        if (!f) return '能力体检：读取异常（已降级）—— 这不是「六项都不可用」';
        return String(f.text || '能力体检：无读数');
    } catch (_e) { return '能力体检：读取异常（已降级）'; }
}
/* 原函数名保留：上面那个是新增，下面这个是既有实现。 */
export function creationWorkbenchFaceText(face) {"""

DEF_OLD = u"""    backupFaceText,
    provenanceFaceText,"""
DEF_NEW = u"""    backupFaceText,
    capHealthFaceText,
    provenanceFaceText,"""

# ───────────────────── diagnose-view.js ─────────────────────

VIMP_OLD = u"backupFaceText, knowledgeBridgeFaceText,"
VIMP_NEW = u"backupFaceText, capHealthFaceText, knowledgeBridgeFaceText,"

CARD_OLD = u"""    _workflowHtml(pkg) {"""
CARD_NEW = u"""    /** [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康协议卡：六项能力四态行（含替代操作）+ 设备身份 + 零写入证据。
     *  与 _backupHtml / _workflowHtml 同规格：内核只陈列，本视图只排版；三态不同形。
     *  ★ 状态符号是**本卡局部**的（不是模块级第二份实现）：它只服务「不只依赖颜色」这一条验收，
     *    文案唯一实现仍在内核（CAP_STATE_TEXT，经 face.rows[].stateText 送达）。 */
    _capHealthHtml(pkg) {
        const symOfState = (st) => (st === 'ok' ? '[可用]'
            : (st === 'partial' ? '[部分]' : (st === 'unavailable' ? '[不可用]' : '[未验证]')));
        const toneOfState = (st) => (st === 'ok' ? 'ok' : (st === 'unverified' ? 'muted' : 'bad'));
        const face = (pkg && pkg.capHealthFace) || null;
        if (!face) {
            return '<div class=' + Q + 'dg-note dg-bad' + Q + '>读不到能力体检协议面（已降级）—— '
                + '这是「本层读不出」，**不是**「六项能力都不可用」。</div>';
        }
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(capHealthFaceText(face)) + '</div>';
        /* 设备身份：本机 / 宿主 / 上游（功能点 ①）。与「能力四态」分开摆 —— 前者是身份，后者是处境。 */
        if (face.hostLine) {
            html += '<div class=' + Q + 'dg-note' + Q + '>' + escapeHtml(String(face.hostLine))
                + '（宿主版本读不出与「宿主不支持」是两件事：前者去确认装没装，后者去换环境）</div>';
        }
        const rows = Array.isArray(face.rows) ? face.rows : [];
        if (!rows.length) {
            html += '<div class=' + Q + 'dg-note' + Q + '>'
                + (face.linked ? '能力读数尚未取数（**不是**「六项都不可用」）' : '语义：读数口不在位（咽喉未挂）')
                + '</div>';
        } else {
            html += '<div class=' + Q + 'dg-table' + Q + '>' + rows.map((r) => {
                const bits = '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(r.label || r.id) + '</code>'
                    + this._chip(symOfState(r.state) + ' ' + String(r.state || ''), toneOfState(r.state))
                    + '<span class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(String(r.stateText || '')) + '</span>'
                    + '</div>';
                const why = r.why ? ('<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(r.why) + '</div>') : '';
                /* 验收②：缺能力时给替代操作（不可用 / 部分可用才给；未验证不需要动手）。 */
                const fb = (r.state === 'unavailable' || r.state === 'partial')
                    ? ('<div class=' + Q + 'dg-note' + Q + '>替代操作（顺序即优先级）：'
                        + escapeHtml((r.fallbacks || []).join(' -> ')) + '</div>')
                    : (r.state === 'unverified'
                        ? ('<div class=' + Q + 'dg-note' + Q + '>现在不必动手：跑一次才知道（未验证不是坏）</div>')
                        : '');
                return bits + why + fb;
            }).join('') + '</div>';
            html += '<div class=' + Q + 'dg-note' + Q + '>四态计数：可用 '
                + escapeHtml(String((face.counts && face.counts.ok) || 0)) + ' · 部分可用 '
                + escapeHtml(String((face.counts && face.counts.partial) || 0)) + ' · 不可用 '
                + escapeHtml(String((face.counts && face.counts.unavailable) || 0)) + ' · 未验证 '
                + escapeHtml(String((face.counts && face.counts.unverified) || 0))
                + '（未验证 = **没测过**，不等于坏）</div>';
        }
        if (face.crossLine) {
            html += '<div class=' + Q + 'dg-note' + Q + '>跨仓联动：' + escapeHtml(String(face.crossLine))
                + (face.crossStale ? '（版本读不出与版本偏低处置相反：前者去确认装没装，后者去升级）' : '') + '</div>';
        }
        /* 验收③的可见证据：检测本身零写入。取不到就如实说「取不到」，不写 0。 */
        html += '<div class=' + Q + 'dg-note' + Q + '>检测副作用：'
            + (face.writes === null ? '写入计数<b>取不到</b>（不是 0）' : ('写入计数 ' + escapeHtml(String(face.writes))))
            + '（能力判定内核零 import 零 IO ⇒ 结构上不可能写存储 / 发网络 / 调模型）</div>';
        const problems = Array.isArray(face.problems) ? face.problems : [];
        if (problems.length) {
            html += '<div class=' + Q + 'dg-note dg-bad' + Q + '><b>四态/替代操作/跨仓段地基自检报了问题</b>：</div>';
            html += problems.map((p) => '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(p) + '</div>').join('');
        }
        return html;
    }
    _workflowHtml(pkg) {"""

SEC_OLD = u"""         h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>社媒知情边界（可见性判定 + 幂等账本）</h3>' + this._knowledgeBridgeHtml(pkg) + '</section>');"""
SEC_NEW = u"""         /* [v3.92.0 · R-X8] 能力体检卡与功能卡**并列**（分工：那几张答「某条功能路通不通」，
          *   本卡答「这台机器有没有能力跑那条路」—— 设备级前提）。 */
         h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>宿主与能力健康（四态：可用 / 部分可用 / 不可用 / 未验证 · 接口存在不报成服务可用）</h3>' + this._capHealthHtml(pkg) + '</section>');
         h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>社媒知情边界（可见性判定 + 幂等账本）</h3>' + this._knowledgeBridgeHtml(pkg) + '</section>');"""


def patch(path, pairs, label):
    with io.open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    bad = False
    for a, b, name in pairs:
        n = src.count(a)
        print(label, name, 'anchor-count', n)
        if n != 1:
            bad = True
            continue
        src = src.replace(a, b)
    if bad:
        print('ABORT', label)
        sys.exit(1)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(src)
    print('OK', label, len(src.encode('utf-8')))


def main():
    patch(DATA, [
        (IMP_OLD, IMP_NEW, 'import'),
        (FACE_OLD, FACE_NEW, 'face'),
        (RET_OLD, RET_NEW, 'return-list'),
        (TXT_OLD, TXT_NEW, 'text-fn'),
        (DEF_OLD, DEF_NEW, 'default-export'),
    ], 'diagnose-data.js')
    patch(VIEW, [
        (VIMP_OLD, VIMP_NEW, 'import'),
        (CARD_OLD, CARD_NEW, 'card'),
        (SEC_OLD, SEC_NEW, 'section'),
    ], 'diagnose-view.js')


if __name__ == '__main__':
    main()
