#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o2_wire.py — [v4.14.0 · R4-O2] 把异步问答接进记忆 App 控制器。

三处改动(每处锚点必须恰中一次):
  1 import:增加 `readMemoryQaAnswerAsync` 与 `config/ask-request.js` 的四个出口;
  2 控制器:新增 `askPastAsync(question, hooks)` —— 派发相一处判(planAskPhase),
     代际由 tracker 管,回信按 isStale 丢弃;
  3 default 面:无(本 App 无 default 导出)。

纪律:同步版 `askPast` **一行不动**(旧插件兼容路径),异步版单列新方法。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/memory/memory-app.js'

IMP_ANCHOR = ('import {\n  readMemoryQaAnswer, readMemoryToolsDescribe, readMemoryToolsEnvelope,\n'
              '  MEMORY_QA_FACE_STATES\n} from \'../../config/memory-qa-contract.js\';')
IMP_NEW = ('import {\n  readMemoryQaAnswer, readMemoryQaAnswerAsync, readMemoryToolsDescribe,\n'
           '  readMemoryToolsEnvelope, MEMORY_QA_FACE_STATES\n} from \'../../config/memory-qa-contract.js\';\n'
           '/* [v4.14.0 \u00b7 R4-O2] \u95ee\u7b54\u8bf7\u6c42\u8eab\u4efd\u4e0e\u53d6\u6d88(\u7eaf\u51fd\u6570)\u3002\n'
           ' *   \u672c\u5c42\u53ea\u6301\u4e00\u4e2a\u8ddf\u8e2a\u5668\u5e76\u628a\u5b83\u4ea4\u7ed9\u4e0a\u6e38;\u5224\u5b9a\u53e3\u5f84\u5168\u5728\u90a3\u4ef6\u91cc\u3002 */\n'
           'import {\n'
           '  newAskTracker, advanceAsk, isStale, cancelAsk, isCanceled,\n'
           '  shouldCancelFn, makeAskTaskId, planAskPhase, ASK_PHASES, ASK_RUN_STATES\n'
           '} from \'../../config/ask-request.js\';')

FN_ANCHOR = '''    try {
      return readMemoryQaAnswer(typeof window !== 'undefined' ? window : null, question, {});
    } catch (_e) {
      return readMemoryQaAnswer(null, question, {});
    }
  }'''

FN_NEW = '''    try {
      return readMemoryQaAnswer(typeof window !== 'undefined' ? window : null, question, {});
    } catch (_e) {
      return readMemoryQaAnswer(null, question, {});
    }
  }

  /* ========== [v4.14.0 \u00b7 R4-O2] \u5f02\u6b65\u95ee\u5f80\u4e8b(\u53ef\u53d6\u6d88 / \u53ea\u5c55\u793a\u6700\u65b0\u4e00\u6b21 / \u6709\u8fdb\u5ea6) ========== */
  /**
   * \u95ee\u4e00\u53e5\u5f80\u4e8b(**\u5f02\u6b65\u7248**)\u3002\u4e0e\u540c\u6b65\u7248 `askPast` \u540c\u4e00\u4efd\u4e0a\u6e38\u53e3\u5f84,\u53ea\u6362\u6267\u884c\u65f6\u673a\u3002
   *
   * \u3010\u6d3e\u53d1\u76f8\u4e00\u5904\u5224\u3011\u6709\u5f02\u6b65\u53e3\u8d70\u5f02\u6b65;\u6ca1\u6709\u5c31**\u56de\u843d\u540c\u6b65**\u5e76\u5982\u5b9e\u544a\u77e5(\u65e7\u63d2\u4ef6\u8def\u5f84)\u3002
   *   \u5224\u636e\u5728 `config/ask-request.js::planAskPhase`\u4e00\u5904 \u2014\u2014 \u4e0d\u5728\u672c\u5c42\u518d\u5199\u4e00\u4efd\u300c\u63d2\u4ef6\u6709\u6ca1\u6709\u8fd9\u4e2a\u51fa\u53e3\u300d\u7684\u5224\u65ad\u3002
   *
   * \u3010\u65e7\u56de\u4fe1\u4e0d\u8bb8\u8986\u76d6\u65b0\u95ee\u9898\u3011\u6bcf\u95ee\u4e00\u6b21 `advanceAsk` \u63a8\u8fdb\u4ee3\u9645;\u56de\u4fe1\u843d\u5730\u524d\u5148\u8fc7 `isStale`\u3002
   *   \u2014\u2014 \u6ce8\u610f:\u8fd9\u662f**\u4e24\u5c42\u4fdd\u62a4**:\u4e0a\u6e38\u5728\u7247\u95f4\u8c03 `shouldCancel()` \u5c31\u4f1a\u505c\u6389\u65e7\u90a3\u4e00\u8f6e(\u7701\u6389\u767d\u626b),
   *   \u800c\u5373\u4f7f\u5b83\u5df2\u7ecf\u8dd1\u5b8c\u4e86,\u56de\u4fe1\u4e5f\u4f1a\u5728\u8fd9\u91cc\u88ab\u4e22\u5f03 \u2014\u2014 \u4e24\u9053\u90fd\u5728,\u56e0\u4e3a\u53d6\u6d88\u68c0\u67e5\u6709\u53ef\u80fd\u8fdf\u4e00\u7247\u751f\u6548\u3002
   *
   * \u3010\u672c\u65b9\u6cd5\u4e0d\u78b0 DOM\u3011\u8fdb\u5ea6\u4e0e\u7ed3\u679c\u90fd\u901a\u8fc7 `hooks` \u56de\u7ed9\u89c6\u56fe:\n
   *   `onProgress(p)` / `onDone(receipt, runState)`\u3002\u89c6\u56fe\u53ea\u6392\u7248\u3002
   *
   * @param {string} question \u95ee\u53e5
   * @param {{chatId?:string, onProgress?:Function, onDone?:Function}} [hooks]
   * @returns {Promise<{phase:string, gen:number, taskId:string, runState:string, receipt:object|null}>}
   */
  async askPastAsync(question, hooks) {
    const h = (hooks && typeof hooks === 'object') ? hooks : {};
    const chatId = (typeof h.chatId === 'string') ? h.chatId : '';
    const win = (typeof window !== 'undefined') ? window : null;
    const plugin = (() => { try { return win ? win.LonShaMemory : null; } catch (_e) { return null; } })();
    const hasAsync = !!(plugin && typeof plugin.askMemoryQuestionAsync === 'function');
    const hasSync = !!(plugin && typeof plugin.askMemoryQuestion === 'function');
    const phase = planAskPhase(hasAsync, hasSync);
    /* \u63d2\u4ef6\u4e0d\u5728\u573a / \u6ca1\u6709\u4efb\u4f55\u95ee\u7b54\u51fa\u53e3 \u21d2 \u4e0d\u8fdb\u8ddf\u8e2a\u5668(\u6ca1\u6709\u201c\u672c\u6b21\u95ee\u201d\u8fd9\u56de\u4e8b)\u3002 */
    if (phase === ASK_PHASES.ABSENT) {
      const recv = readMemoryQaAnswer(win, question, {});
      return { phase, gen: 0, taskId: '', runState: ASK_RUN_STATES.SYNC_FALLBACK, receipt: recv };
    }
    if (!this._askTracker) this._askTracker = newAskTracker();
    const gen = advanceAsk(this._askTracker);
    const taskId = makeAskTaskId(gen, chatId);
    if (phase === ASK_PHASES.SYNC) {
      /* \u65e7\u63d2\u4ef6\u8def\u5f84:\u80fd\u7528,\u4f46**\u4f1a\u5360\u4f4f\u4e3b\u7ebf\u7a0b** \u2014\u2014 \u56de\u62a5\u7684\u8fd0\u884c\u6001\u4e0e\u300c\u540e\u53f0\u8dd1\u300d\u4e0d\u540c\u5f62\u3002 */
      const recv = readMemoryQaAnswer(win, question, {});
      const stale = isStale(this._askTracker, gen);
      const runState = stale ? ASK_RUN_STATES.STALE_DROPPED : ASK_RUN_STATES.SYNC_FALLBACK;
      if (typeof h.onDone === 'function') {
        try { h.onDone(stale ? null : recv, runState); } catch (_e) { /* \u56de\u8c03\u629b\u9519\u4e0d\u963b\u65ad\u53d6\u6570 */ }
      }
      return { phase, gen, taskId, runState, receipt: stale ? null : recv };
    }
    const onProgress = (typeof h.onProgress === 'function') ? h.onProgress : null;
    const recv = await readMemoryQaAnswerAsync(win, question, {
      taskId,
      shouldCancel: shouldCancelFn(this._askTracker, gen),
      onProgress: onProgress ? function (p) {
        /* \u8fdb\u5ea6\u56de\u8c03\u5fc5\u987b\u5148\u8fc7\u4ee3\u9645:\u65e7\u90a3\u4e00\u8f6e\u7684\u8fdb\u5ea6**\u4e0d\u8bb8**\u5237\u65b0\u65b0\u95ee\u9898\u7684\u8fdb\u5ea6\u6761\u3002 */
        if (isStale(this._askTracker, gen)) return;
        try { onProgress(p); } catch (_e) { /* \u8fdb\u5ea6\u9762\u629b\u9519\u4e0d\u963b\u65ad\u67e5\u8be2 */ }
      }.bind(this) : null
    });
    const stale = isStale(this._askTracker, gen);
    const canceled = isCanceled(this._askTracker) && (recv && recv.faceReason === 'canceled');
    const runState = stale ? ASK_RUN_STATES.STALE_DROPPED
      : (canceled ? ASK_RUN_STATES.CANCELED : ASK_RUN_STATES.DONE);
    if (typeof h.onDone === 'function') {
      try { h.onDone(stale ? null : recv, runState); } catch (_e) { /* \u56de\u8c03\u629b\u9519\u4e0d\u963b\u65ad\u53d6\u6570 */ }
    }
    return { phase, gen, taskId, runState, receipt: stale ? null : recv };
  }

  /** \u7528\u6237\u6309\u4e86\u53d6\u6d88(\u4e0b\u4e00\u4e2a\u7247\u95f4\u8ba9\u51fa\u70b9\u751f\u6548)\u3002\u6ca1\u5728\u95ee\u65f6\u5982\u5b9e\u8fd4\u56de false\u3002 */
  cancelAskNow() {
    if (!this._askTracker) return { ok: false, gen: 0 };
    return cancelAsk(this._askTracker);
  }

  /** \u5f53\u524d\u8fd9\u4e00\u6b21\u662f\u5426\u5df2\u88ab\u53d6\u6d88(\u4f9b\u89c6\u56fe\u5224\u6309\u94ae\u6001)\u3002 */
  isAskingCanceled() {
    return this._askTracker ? isCanceled(this._askTracker) : false;
  }'''

RESET_ANCHOR = '''  onChatChanged() {
    this._lastInsightDegraded = false;'''
RESET_NEW = '''  onChatChanged() {
    this._lastInsightDegraded = false;
    /* [v4.14.0 \u00b7 R4-O2] \u6362\u4f1a\u8bdd\u5f53\u573a\u4f5c\u5e9f\u5bf9\u8bdd\u4ee3\u9645:\u4e0a\u4e00\u6bb5\u7684\u5728\u98de\u56de\u4fe1\u4e0d\u8bb8\u5199\u8fdb\u65b0\u4f1a\u8bdd\u7684\u95ee\u7b54\u9762\u3002
     *   \u4e0e\u6838\u5fc3\u4e00\u81f4:tracker \u54ea\u6015\u53ea\u662f\u4e00\u4e2a\u8ba1\u6570\u5668,\u6362\u4f1a\u8bdd\u4e5f\u5fc5\u987b\u6362\u6389(\u5426\u5219\u65b0\u4f1a\u8bdd\u7684\u7b2c 1 \u6b21\u4f1a\u4e0e\u4e0a\u4e00\u6bb5\u7684\u7b2c 1 \u6b21\u649e\u4ee3\u9645)\u3002 */
    this._askTracker = null;'''


def patch(rel, pairs):
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
        (FN_ANCHOR, FN_NEW),
        (RESET_ANCHOR, RESET_NEW),
    ])
    return 0


if __name__ == '__main__':
    sys.exit(main())