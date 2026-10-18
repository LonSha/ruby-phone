#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o2_view.py — [v4.14.0 · R4-O2] 记忆视图接异步问答(进度 / 取消 / 只显示最新一次)。

四处改动(每处锚点必须恰中一次):
  1 import:增加 `config/ask-request.js` 的五个出口;
  2 问往事页:输入行后面加一个「取消」按钮(默认隐藏,只在问的期间出现);
  3 事件绑定:`_doAsk` 改成**异步派发**(有异步口走异步、没有回落同步并如实告知);
  4 新方法 `_askRunHtml` 与 `_bindCancel`:运行态一行的渲染 + 取消按钮落点。

纪律:
  · 视图**不判靶心/不判代际** —— 代际在控制器,运行态文案在纯函数件;
  · 旧回信一律不写进面板(`onDone(null, 'stale-dropped')` 时只显示一条提示);
  · 取消后**不给半份结果当全量**(上游明写 answer 是已处理部分)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/memory/memory-view.js'

IMP_ANCHOR = "import { normalizeSource, isLocatable, sourceLocatorLine, sourceOpenRef, locateResultLine } from '../../config/source-locator.js';"
IMP_NEW = (IMP_ANCHOR + "\n"
           "/* [v4.14.0 \u00b7 R4-O2] \u8fd0\u884c\u6001\u4e0e\u8fdb\u5ea6\u7684\u4eba\u8bfb\u6587\u6848:\u516d\u6001\u4e92\u4e0d\u540c\u5f62\u5168\u5728\u90a3\u4ef6\u91cc,\n"
           " *   \u672c\u89c6\u56fe**\u4e0d\u81ea\u5df1\u5224\u4e00\u4efd**(\u81ea\u5df1\u5224\u5c31\u4f1a\u628a\u300c\u5df2\u53d6\u6d88\u300d\u4e0e\u300c\u88ab\u65b0\u95ee\u9898\u9876\u6389\u300d\u538b\u6210\u540c\u4e00\u53e5)\u3002 */\n"
           "import { ASK_RUN_STATES, askRunLine } from '../../config/ask-request.js';")

# 锚点刻意**避开标点**:这一行的 placeholder 里是全角冒号(U+FF1A,实测 count=1,而 ASCII 版 count=0)。
# 避开它比「猜它到底是哪一个」便宜,也更不容易在下次全角化时再失配。
SEARCHROW_ANCHOR = "<button id=\"mem-ask-btn\">\u95ee</button></div>' +"
SEARCHROW_NEW = ("<button id=\"mem-ask-btn\">\u95ee</button>'\n"
                 "      + '<button id=\"mem-ask-cancel\" class=\"mem-ask-cancel\" hidden>\u53d6\u6d88</button></div>' +\n"
                 "      '    <div id=\"mem-ask-run\" class=\"mem-ask-run\"></div>' +")

DOASK_ANCHOR = '''  _doAsk() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#mem-ask-q')?.value?.trim();
    const box = q('#mem-ask-results');
    const face = q('#mem-ask-face');
    if (!box && !face) return;
    if (!kw) { if (box) box.innerHTML = ''; return; }
    let qa = null;
    try { qa = this.app.askPast?.(kw) || null; } catch (_e) { qa = null; }
    const html = this._askFaceHtml(qa);
    if (face) face.innerHTML = html;
    else if (box) box.innerHTML = html;
  }'''

DOASK_NEW = '''  /**
   * [v4.14.0 \u00b7 R4-O2] \u95ee\u5f80\u4e8b(**\u5f02\u6b65\u6d3e\u53d1**):\u6709\u5f02\u6b65\u53e3\u8d70\u5f02\u6b65(\u53ef\u53d6\u6d88\u3001\u6709\u8fdb\u5ea6\u3001\u7247\u95f4\u8ba9\u51fa),
   *   \u6ca1\u6709\u5219\u56de\u843d\u540c\u6b65\u5e76**\u5982\u5b9e\u544a\u77e5**(\u300c\u672c\u7248\u63d2\u4ef6\u6ca1\u6709\u5f02\u6b65\u95ee\u7b54\u51fa\u53e3\u300d\u4e0d\u7b49\u4e8e\u300c\u540e\u53f0\u8dd1\u300d)\u3002
   *
   * \u3010\u65e7\u56de\u4fe1\u4e0d\u5199\u9762\u677f\u3011\u63a7\u5236\u5668\u4f1a\u628a\u88ab\u9876\u6389\u7684\u90a3\u4e00\u6761\u62a5\u6210 `stale-dropped`\u4e14 `receipt` \u4e3a null:
   *   \u672c\u5904\u5bf9\u8be5\u6001**\u53ea\u663e\u793a\u4e00\u6761\u63d0\u793a**,\u4e0d\u628a\u4e0a\u4e00\u6b21\u7684\u7b54\u6848\u91cd\u65b0\u753b\u4e0a\u53bb(\u90a3\u6b63\u662f\u672c\u7248\u8981\u6cbb\u7684\u5f62\u6001)\u3002
   */
  _doAsk() {
    const q = (sel) => this.container.querySelector(sel);
    const kw = q('#mem-ask-q')?.value?.trim();
    const box = q('#mem-ask-results');
    const face = q('#mem-ask-face');
    if (!box && !face) return;
    if (!kw) { if (box) box.innerHTML = ''; return; }
    const paint = (html) => {
      const f = q('#mem-ask-face') || face;
      if (f) f.innerHTML = html;
      else if (box) box.innerHTML = html;
    };
    const setRun = (state, progress) => {
      const el = q('#mem-ask-run');
      if (el) el.innerHTML = this._askRunHtml(state, progress);
      const btn = q('#mem-ask-cancel');
      if (btn) btn.hidden = (state !== ASK_RUN_STATES.RUNNING);
    };
    if (typeof this.app.askPastAsync !== 'function') {
      /* \u63a7\u5236\u5668\u65e0\u5f02\u6b65\u53e3(\u5f02\u5e38\u60c5\u5f62:\u65e7\u7248\u63d2\u4ef6\u4e0b\u4ecd\u5e94\u5728\u4f4d)\u21d2 \u9000\u56de\u540c\u6b65\u3002 */
      let qa = null;
      try { qa = this.app.askPast?.(kw) || null; } catch (_e) { qa = null; }
      paint(this._askFaceHtml(qa));
      return;
    }
    setRun(ASK_RUN_STATES.RUNNING, null);
    let promise = null;
    try {
      promise = this.app.askPastAsync(kw, {
        chatId: this._chatId(),
        onProgress: (p) => setRun(ASK_RUN_STATES.RUNNING, p),
        onDone: (receipt, runState) => {
          if (runState === ASK_RUN_STATES.STALE_DROPPED) {
            setRun(runState, null);
            return;   /* \u65e7\u56de\u4fe1:\u4e0d\u628a\u5b83\u753b\u4e0a\u53bb */
          }
          setRun(runState, null);
          paint(this._askFaceHtml(receipt, runState));
        }
      });
    } catch (_e) { promise = null; }
    if (!promise || typeof promise.then !== 'function') {
      let qa = null;
      try { qa = this.app.askPast?.(kw) || null; } catch (_e) { qa = null; }
      setRun(ASK_RUN_STATES.DONE, null);
      paint(this._askFaceHtml(qa));
    }
  }

  /** \u5f53\u524d\u4f1a\u8bdd\u8eab\u4efd(\u53ea\u8bfb,\u4e0d\u5199)\u2014\u2014\u4f5c\u4e3a\u4efb\u52a1\u8eab\u4efd\u7684\u4f1a\u8bdd\u90e8\u5206\u3002\u53d6\u4e0d\u5230\u8fd4\u56de\u7a7a\u4e32(\u7eaf\u51fd\u6570\u4f1a\u5199 na)\u3002 */
  _chatId() {
    try {
      const s = this.app?.storage;
      return String(s?.currentConversationId || '');
    } catch (_e) { return ''; }
  }

  /** \u8fd0\u884c\u6001\u4e00\u884c(\u516d\u6001\u5404\u6709\u5404\u7684\u5f62;\u6587\u6848\u53d6\u81ea\u7eaf\u51fd\u6570\u4ef6)\u3002 */
  _askRunHtml(state, progress) {
    const line = askRunLine(state, { progress });
    if (!line) return '';
    return '<div class="mem-hint mem-ask-runline">' + this._esc(line) + '</div>';
  }'''

# 锚点只用**两行真代码**(注释那一行的括号是全角,实测已失败过一次:
#   本仓多个文件的说明文字被全角化过,拿它当锚点等于每次都在猜)。
BIND_ANCHOR = """    q('#mem-ask-btn')?.addEventListener('click', () => this._doAsk());
    q('#mem-ask-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._doAsk(); });"""
BIND_NEW = """    /* [v4.14.0 · R4-O2] 问往事:取数走 `app.askPastAsync()`(唯一出口;旧插件自动回落同步),
     *   本视图只排版。取消按钮默认隐藏,只在问的期间出现(见 `_doAsk` 的 `setRun`)。 */
    q('#mem-ask-btn')?.addEventListener('click', () => this._doAsk());
    q('#mem-ask-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._doAsk(); });
    q('#mem-ask-cancel')?.addEventListener('click', () => this._cancelAsk());"""

CANEL_FN = '''
  /**
   * [v4.14.0 · R4-O2] 用户按了取消。**只打标记,不打断调用栈** ——
   *   上游在**下一个协作分片让出点**读这个标记并停下(它自己那一层是 `queryAsync` 的片间检查)。
   *   本处立刻把按钮收起并写一行「正在停…」:让用户看到按键**已经受理**,
   *   而不是盯着一个不动的界面怀疑没点上。
   */
  _cancelAsk() {
    let res = null;
    try { res = this.app.cancelAskNow?.() || null; } catch (_e) { res = null; }
    const btn = this.container.querySelector('#mem-ask-cancel');
    if (btn) btn.hidden = true;
    const el = this.container.querySelector('#mem-ask-run');
    if (el) {
      const ok = !!(res && res.ok === true);
      el.innerHTML = '<div class="mem-hint mem-ask-runline">' + this._esc(
        ok ? '已受理取消 —— 正在停(下一片生效)' : '当前没有在问的请求'
      ) + '</div>';
    }
  }
'''

FACE_ANCHOR = '''  _askFaceHtml(qa) {
    const r = (qa && typeof qa === 'object') ? qa : null;
    if (!r) return '';'''
FACE_NEW = '''  _askFaceHtml(qa, runState) {
    const r = (qa && typeof qa === 'object') ? qa : null;
    /* [v4.14.0 · R4-O2] 取消态:**先**说清「下面是已处理部分」,再列答案 ——
     *   顺序反了,读者会先把它当全量结论记住。 */
    if (runState === ASK_RUN_STATES.CANCELED) {
      const body = r ? this._askBodyHtml(r) : '';
      return '<div class="mem-none mem-ask-canceled">\u5df2\u53d6\u6d88 \u2014\u2014 \u4e0b\u9762\u662f**\u5df2\u5904\u7406\u90e8\u5206**,\u4e0d\u662f\u5168\u91cf\u7ed3\u8bba</div>' + body;
    }
    if (!r) return '';'''

BODY_SPLIT_ANCHOR = '''    const answer = Array.isArray(r.answer) ? r.answer : [];'''
BODY_SPLIT_NEW = '''    return this._askBodyHtml(r);
  }

  /** 答案主体(有答案 / 没命中的排版;**取消态与正常态共用同一份口径**)。 */
  _askBodyHtml(r) {
    if (!r || typeof r !== 'object') return '';
    const answer = Array.isArray(r.answer) ? r.answer : [];'''


def patch(rel, pairs, expect=None):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    for i, (a, b) in enumerate(pairs):
        n = s.count(a)
        assert n == 1, '[%s] anchor %d must hit exactly 1, got %d' % (rel, i, n)
        s = s.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


def main():
    patch(REL, [
        (IMP_ANCHOR, IMP_NEW),
        (SEARCHROW_ANCHOR, SEARCHROW_NEW),
        (DOASK_ANCHOR, DOASK_NEW + CANEL_FN),
        (BIND_ANCHOR, BIND_NEW),
        (FACE_ANCHOR, FACE_NEW),
        (BODY_SPLIT_ANCHOR, BODY_SPLIT_NEW),
    ])
    return 0


if __name__ == '__main__':
    sys.exit(main())