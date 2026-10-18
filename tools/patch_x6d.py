#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x6d.py — [v4.27.0 · R4-X6 收口补丁 D]
把「这一面能不能读」的判定从**视图**收回**内核**一份。

【修前实测的缺陷（读码可复算，不是推演）】
  apps/plotline/plotline-view.js 的 _boardCard() 里写着第二份状态判定词：
      b.state === 'engine-absent' || b.state === 'face-absent'
      || b.state === 'unusable' || b.state === 'empty'
  以及一张**手写的归因文案表**（四个键）。_tracePathHtml() 里另有一份
  trace.reason === 'not-in-graph'。后果不是报错，而是**静默退化**：
  内核把状态名改掉的那一天，视图这几处比较全部落空 ⇒ 走进 else 分支 ⇒
  「插件没装」被显示成「读到了一份空图」，两个处置正好相反
  （该去装插件 vs 该去聊一楼），而没有任何东西会响。
  同仓 bridge-contract-audit 已在扫「归因文案表手写键」（本版真跑读数 0 张），
  本补丁把这条纪律落实到因果面。

【补法（与 R4-X5 的 layoutOf / perspectiveModeIds 同一规格）】
  内核 config/causal-board-contract.js 新增三件：
    · CB_STATE_HINT —— 五态处置建议表（含 no-subject），键即状态字面量；
    · boardGateOf(read) —— 返回 {readable,state,hint}，**读不到时 hint 必非空**；
    · traceNoteOf(read) —— 追溯读数的一句说明（'' = 没有要说的）。
  接线件与 App 各加两个**纯转发**出口；视图改走出口，判定词零残留。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

K_REL = 'config/causal-board-contract.js'
W_REL = 'apps/plotline/plotline-board.js'
A_REL = 'apps/plotline/plotline-app.js'
V_REL = 'apps/plotline/plotline-view.js'


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


# ---------------------------------------------------------------- kernel
K_BLOCK = u'''/* ---------------------------------------------------------------
 * 这一面能不能读（★ 判定词**只此一份**）
 *   为什么放在内核而不是视图：视图里写第二份状态字面量，内核改名那天
 *   那些比较会**静默落空**（不报错、不转红），于是「插件没装」被显示成
 *   「读到了一份空图」—— 两个处置正好相反（去装插件 / 去聊一楼）。
 *   同仓 bridge-contract-audit 已按「归因文案表手写键」扫过同类形态。
 * ------------------------------------------------------------ */
/** 各态的**给用户看的一句处置建议**（与 CB_REASONS 的短归因分工不同：那条进一行读数，这条进卡片） */
export const CB_STATE_HINT = Object.freeze({
    'engine-absent': '未检测到 LonSha 记忆插件的因果面 —— 装上（或升级）后本卡自动可用',
    'face-absent': '插件在，但这一版没有因果面：需要较新版本',
    'unusable': '因果面在，但本机读不出（出口报错或面畸形）—— 这不是「故事里没有线索」',
    'empty': '因果面真跑过了，图里一个节点都没有 —— 剧情推进后会自动长出来',
    'no-subject': '还没选要追的那条线：先在下面点一条（本卡不替你挑）'
});
/**
 * 这一面能不能读 + 读不到时该说什么。
 *   ★ `readable:false` 时 `hint` **必非空** —— 视图直接摆出来即可，不必再判一格。
 *   ★ 未知状态（上游加了新态而本件没跟上）**也走 readable:false**：
 *     宁可说「不可读」，绝不默认成「读到了」。
 */
export function boardGateOf(read) {
    const r = obj(read) || {};
    if (r.state === CB_STATES.OK) return { readable: true, state: r.state, hint: '' };
    return {
        readable: false,
        state: str(r.state),
        hint: CB_STATE_HINT[r.state] || '因果板不可读（状态未登记，如实说读不出）'
    };
}
/**
 * 追溯读数的**一句说明**（没有要说的就给空串）。
 *   ★ 「起点不在图里」与「追到头了」的差别只在这一处判：前者要换起点、
 *     后者到点了 —— 合成一句就是把「该换一条」写成「这条已经到头」。
 */
export function traceNoteOf(read) {
    const r = obj(read) || {};
    if (r.reason === 'not-in-graph') return '起点不在图里 —— 该换一个起点，不是「已经追到头了」';
    return '';
}
'''

# ---------------------------------------------------------------- wiring
W_IMPORT_OLD = u'''    CB_CLOSURE,
    CB_CLOSURE_LABEL
} from '../../config/causal-board-contract.js';'''
W_IMPORT_NEW = u'''    CB_CLOSURE,
    CB_CLOSURE_LABEL,
    boardGateOf,
    traceNoteOf
} from '../../config/causal-board-contract.js';'''

W_METHODS_OLD = u'''    /* ========== 起点（用户显式选择，不猜） ========== */'''
W_METHODS_NEW = u'''    /* ========== 这一面能不能读（判定词**只许内核一份**，本件只转发） ========== */
    /** 读不到时给一句处置建议；读到则 readable=true、hint='' */
    gate(read) {
        try { return boardGateOf(read); }
        catch (_e) { return boardGateOf(null); }
    }
    /** 追溯读数的一句说明（'' = 没有要说的） */
    traceNote(read) {
        try { return traceNoteOf(read); }
        catch (_e) { return ''; }
    }
    /* ========== 起点（用户显式选择，不猜） ========== */'''

# ---------------------------------------------------------------- app
A_OLD = u'''    /**
     * 换会话 / 清数据：本 App **不持有任何读数副本**，故无需重绑数据层；'''
A_NEW = u'''    /**
     * 这一面能不能读 + 读不到时的处置建议（**判定词只许内核一份**）。
     *   视图拿这个出口决定「先报读不到」还是「画板子」，不自己比状态字面量 ——
     *   自己比就会在内核改名时静默走到「读到」那一支。
     */
    boardGate(read) {
        try { return this.board.gate(read); }
        catch (_e) { return { readable: false, hint: '因果板不可读' }; }
    }
    /** 追溯读数的一句说明（'' = 没有要说的） */
    boardTraceNote(read) {
        try { return this.board.traceNote(read); }
        catch (_e) { return ''; }
    }
    /**
     * 换会话 / 清数据：本 App **不持有任何读数副本**，故无需重绑数据层；'''

# ---------------------------------------------------------------- view
V1_OLD = u'''        const absent = !b || b.state === 'engine-absent' || b.state === 'face-absent'
            || b.state === 'unusable' || b.state === 'empty';
        let body;
        if (absent) {
            const why = {
                'engine-absent': '未检测到 LonSha 记忆插件的因果面 —— 装上（或升级）后本卡自动可用',
                'face-absent': '插件在，但这一版没有因果面：需要较新版本',
                'unusable': '因果面在，但本机读不出（出口报错或面畸形）—— 这不是「故事里没有线索」',
                'empty': '因果面真跑过了，图里一个节点都没有 —— 剧情推进后会自动长出来'
            }[b && b.state] || '因果板不可读';
            body = '<div class="pn-empty">' + this._esc(why) + '</div>';
        } else {'''
V1_NEW = u'''        /* ★ 归因**只由内核判**（走 App 出口）：本卡不写第二份状态判定词。
         *   自己写的话，内核改名那天这些比较会静默落空 ⇒ 走进 else ⇒
         *   「插件没装」被显示成「没有线索」，而两个处置正好相反。 */
        const gate = (() => {
            try { return this.app.boardGate(b); }
            catch (_e) { return { readable: false, hint: '因果板不可读' }; }
        })();
        let body;
        if (!gate.readable) {
            body = '<div class="pn-empty">' + this._esc(gate.hint) + '</div>';
        } else {'''

V2_OLD = u'''            + (absent ? '—' : (b.counts && b.counts.nodes ? b.counts.nodes + ' 个节点' : '—')) + '</span></div>','''
V2_NEW = u'''            + (gate.readable && b.counts && b.counts.nodes ? b.counts.nodes + ' 个节点' : '—') + '</span></div>','''

V3_OLD = u'''        if (!trace) return '';
        if (trace.reason === 'not-in-graph') {
            return '<div class="pn-cb-trace-note">起点不在图里 —— 该换一个起点，不是「已经追到头了」</div>';
        }
        if (trace.state !== 'ok') return '';'''
V3_NEW = u'''        if (!trace) return '';
        /* ★ 「起点不在图里」这句说明**由内核给**（视图不写第二份判定词）。
         *   读不出时给空串，由内核的 ok 位决定要不要继续画链。 */
        const note = (() => {
            try { return this.app.boardTraceNote(trace); }
            catch (_e) { return ''; }
        })();
        if (note) return '<div class="pn-cb-trace-note">' + this._esc(note) + '</div>';
        if (!trace.ok) return '';'''


def main():
    st = {K_REL: rd(K_REL), W_REL: rd(W_REL), A_REL: rd(A_REL), V_REL: rd(V_REL)}

    # ---- kernel: 插块（在自检段之前）+ 进 default export + 顺手补 boardLine 缩进
    k = st[K_REL]
    k = once(k, u'''/* ---------------------------------------------------------------
 * 自检（纯函数式，不抛）：八条口径当场自证
 * ------------------------------------------------------------ */''',
             K_BLOCK + u'''/* ---------------------------------------------------------------
 * 自检（纯函数式，不抛）：八条口径当场自证
 * ------------------------------------------------------------ */''', 'K block')
    k = once(k, u'''    traceLine,
    cbSelfCheck
};''', u'''    traceLine,
    cbSelfCheck,
    CB_STATE_HINT,
    boardGateOf,
    traceNoteOf
};''', 'K default export')
    st[K_REL] = k
    print('kernel OK')

    # ---- wiring
    w = st[W_REL]
    w = once(w, W_IMPORT_OLD, W_IMPORT_NEW, 'W import')
    w = once(w, W_METHODS_OLD, W_METHODS_NEW, 'W methods')
    st[W_REL] = w
    print('wiring OK')

    # ---- app
    a = st[A_REL]
    a = once(a, A_OLD, A_NEW, 'A exits')
    st[A_REL] = a
    print('app OK')

    # ---- view
    v = st[V_REL]
    v = once(v, V1_OLD, V1_NEW, 'V1 gate')
    v = once(v, V2_OLD, V2_NEW, 'V2 title')
    v = once(v, V3_OLD, V3_NEW, 'V3 trace note')
    st[V_REL] = v
    print('view OK')

    # ---- 残留判定词自检（接线层必须零命中）
    wire_all = st[W_REL] + st[A_REL] + st[V_REL]
    for lit in [u"'engine-absent'", u"'face-absent'", u"'unusable'", u"'no-subject'", u"'not-in-graph'"]:
        n = wire_all.count(lit)
        assert n == 0, 'wiring still carries kernel-only literal %s (%d)' % (lit, n)
    for lit in [u"'engine-absent'", u"'face-absent'", u"'unusable'", u"'no-subject'", u"'not-in-graph'"]:
        n = st[K_REL].count(lit)
        assert n >= 1, 'kernel lost literal %s' % lit
    print('literals OK (wiring zero / kernel present)')

    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    for rel, s in st.items():
        wr(rel, s)
    print('--- WRITTEN D ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
