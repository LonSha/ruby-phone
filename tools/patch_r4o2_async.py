#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o2_async.py — [v4.14.0 · R4-O2] 给 config/memory-qa-contract.js 加异步读口。

纪律:
  · 锚点必须恰中一次(不唯一即抛);
  · 只插一支新函数 + 一次 default 导出登记,**不改同步版一行**(同步版是旧插件的兼容路径);
  · 新函数与同步版共用同一套五态与 `emptyQa`,不另写一份缺席回执(那会漂)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'config/memory-qa-contract.js'

ANCHOR = ('/**\n * \u8f6c\u6210\u53ef\u6253\u5f00\u7684\u51fa\u5904\u5f15\u7528'
          + '\uff08\u8d70\u4ed3\u5185\u552f\u4e00\u9776\u5fc3\u4ef6 `config/open-ref.js`\uff09\u3002')

NEW_FN = '''/**
 * [v4.14.0 \u00b7 R4-O2] \u95ee\u4e00\u53e5\u5f80\u4e8b(**\u5f02\u6b65\u7248**:\u8d70\u4e0a\u6e38 `askMemoryQuestionAsync`)\u3002
 *
 * \u3010\u4e0e\u540c\u6b65\u7248\u7684\u5173\u7cfb\u3011\u4e0a\u6e38 lonsha-memory-plugin v3.332.0(M4-O4)\u4ea4\u4ed8\u4e86\u5f02\u6b65\u51fa\u53e3:
 *   \u4e0e `askMemoryQuestion` **\u540c\u4e00\u4e2a planQuestion / queryAsync / composeAnswer**,
 *   \u53ea\u6362\u6267\u884c\u65f6\u673a(\u9010\u6761\u8ba1\u5212\u7247\u95f4\u8ba9\u51fa\u4e3b\u7ebf\u7a0b),\u56de\u6267\u5728\u540c\u6b65\u7248\u5168\u952e\u4e4b\u5916\u589e\u56db\u952e
 *   `async / taskId / state / processed`\u3002\u672c\u51fd\u6570\u662f\u5b83\u5728\u4e0b\u6e38\u7684**\u552f\u4e00\u6d88\u8d39\u70b9**\u3002
 *
 * \u3010\u4e3a\u4ec0\u4e48\u5355\u5217\u4e00\u652f\u800c\u4e0d\u662f\u6539\u540c\u6b65\u7248\u3011\u540c\u6b65\u7248\u662f\u65e7\u63d2\u4ef6\u7684**\u517c\u5bb9\u8def\u5f84**(\u4e0a\u6e38\u660e\u5199
 *   \u300caskMemoryQuestion \u4fdd\u6301\u539f\u6837,\u4e0d\u8fc1\u79fb\u4e0d\u5220\u9664\u300d)\u3002\u4e0b\u6e38\u8981\u540c\u65f6\u7559\u4f4f\u4e24\u6761:
 *   \u6709\u5f02\u6b65\u53e3\u8d70\u5f02\u6b65,\u6ca1\u6709\u5c31\u8d70\u540c\u6b65 \u2014\u2014 \u7531 `config/ask-request.js::planAskPhase` \u4e00\u5904\u5224,
 *   \u672c\u51fd\u6570\u53ea\u8d1f\u8d23\u300c\u5f02\u6b65\u8fd9\u6761\u8def\u600e\u4e48\u8bfb\u300d\u3002
 *
 * \u3010\u4e94\u6001\u4e0e\u540c\u6b65\u7248\u540c\u4e00\u5957\u3011\u552f\u4e00\u65b0\u589e\u7684\u8bfb\u6570\u662f `upstreamState`:
 *   `canceled`(\u53d6\u6d88:answer/gaps **\u662f\u5df2\u5904\u7406\u90e8\u5206**)\u4e0e `absent`(\u5185\u6838\u6a21\u5757\u4e0d\u5728)\u5206\u5217,
 *   \u4e0d\u538b\u5e73 \u2014\u2014 \u538b\u5e73\u5c31\u4f1a\u628a\u300c\u6211\u6309\u4e86\u53d6\u6d88\u300d\u663e\u793a\u6210\u300c\u672c\u7248\u6ca1\u6709\u8fd9\u4e00\u9762\u300d\u3002
 *   \u540c\u65f6\u4fdd\u7559 `faceReason = 'canceled'`,\u4f9b\u89c6\u56fe\u4e0e\u8bf7\u6c42\u8ddf\u8e2a\u5668\u4ea4\u53c9\u6838\u5bf9\u3002
 *
 * @param {object} [win] \u663e\u5f0f\u6ce8\u5165 window
 * @param {string} question \u7528\u6237\u95ee\u53e5
 * @param {object} [opts] { knownActors?, maxActors?, maxSentences?, pageSize?, maxPerLedger?,
 *                          taskId?, shouldCancel?, onProgress? }
 * @returns {Promise<object>} \u6052\u5b9a 15 \u952e + { state, faceReason, async, taskId, upstreamState, processed }
 */
export async function readMemoryQaAnswerAsync(win, question, opts) {
    const o = opts || {};
    const base4 = { async: true, taskId: String(o.taskId || ''), upstreamState: '', processed: null };
    try {
        const plugin = pluginOf(win);
        if (!plugin) return Object.assign(emptyQa(question, 'plugin-absent', MEMORY_QA_FACE_STATES.ENGINE_ABSENT), base4, { async: false });
        if (typeof plugin.askMemoryQuestionAsync !== 'function') {
            /* \u63d2\u4ef6\u5728\u573a\u4f46\u6ca1\u6709\u5f02\u6b65\u51fa\u53e3 \u21d2 **\u4e0e\u300c\u6ca1\u6709\u95ee\u7b54\u51fa\u53e3\u300d\u5206\u5f00**:
             *   \u8fd9\u4e00\u6001\u7531\u8c03\u7528\u65b9\u9000\u56de\u843d\u540c\u6b65(\u7167\u65e7\u53ef\u7528),\u4e0d\u662f\u300c\u6ca1\u8fd9\u529f\u80fd\u300d\u3002 */
            return Object.assign(emptyQa(question, 'async-face-absent', MEMORY_QA_FACE_STATES.FACE_ABSENT), base4, { async: false });
        }
        const r = await plugin.askMemoryQuestionAsync(question, o);
        if (!r || typeof r !== 'object') {
            return Object.assign(emptyQa(question, 'malformed', MEMORY_QA_FACE_STATES.UNUSABLE), base4);
        }
        const answer = Array.isArray(r.answer) ? r.answer : [];
        const gaps = Array.isArray(r.gaps) ? r.gaps : [];
        const version = Number(r.version) || 0;
        const upstreamState = String(r.state || '');
        let state, faceReason;
        if (version === 0 && String(r.reason || '')) {
            state = MEMORY_QA_FACE_STATES.ENGINE_ABSENT; faceReason = String(r.reason);
        } else if (upstreamState === 'canceled') {
            /* \u2605 \u53d6\u6d88\u6001**\u5355\u5217**:\u4e0e empty \u5904\u7f6e\u76f8\u53cd(\u524d\u8005\u300c\u8fd8\u80fd\u518d\u95ee\u300d,\u540e\u8005\u300c\u6362\u4e2a\u95ee\u6cd5\u300d),
             *   \u800c\u4e14\u5b83\u7684 answer \u662f**\u5df2\u5904\u7406\u90e8\u5206** \u2014\u2014 \u4e0d\u8bb8\u5f53\u5168\u91cf\u7ed3\u8bba\u8bfb(\u4e0a\u6e38\u9010\u5b57\u63d0\u9192\u8fc7)\u3002 */
            state = MEMORY_QA_FACE_STATES.EMPTY; faceReason = 'canceled';
        } else if (answer.length) {
            state = MEMORY_QA_FACE_STATES.OK; faceReason = 'ok';
        } else {
            state = MEMORY_QA_FACE_STATES.EMPTY; faceReason = 'no-answer';
        }
        return {
            state, faceReason,
            version,
            question: String(r.question || question || ''),
            intents: Array.isArray(r.intents) ? r.intents : [],
            actor: r.actor === undefined ? null : r.actor,
            answer,
            gaps,
            refs: Array.isArray(r.refs) ? r.refs : [],
            plans: Array.isArray(r.plans) ? r.plans : [],
            masked: Number(r.masked) || 0,
            truncated: r.truncated === true,
            resourced: Number(r.resourced) || 0,
            total: Number(r.total) || 0,
            knownActors: Number(r.knownActors) || 0,
            reason: String(r.reason || ''),
            writesNothing: true,
            /* \u5f02\u6b65\u9762\u56db\u952e(\u4e0e\u4e0a\u6e38\u9010\u5b57\u540c\u5f62,\u4e0d\u91cd\u547d\u540d)\u3002 */
            async: true,
            taskId: String(r.taskId === undefined || r.taskId === null ? (o.taskId || '') : r.taskId),
            upstreamState,
            processed: (r.processed && typeof r.processed === 'object') ? r.processed : null
        };
    } catch (_e) {
        return Object.assign(emptyQa(question, 'thrown', MEMORY_QA_FACE_STATES.UNUSABLE), base4);
    }
}
'''

EXPORT_ANCHOR = '    readMemoryQaAnswer,\n'
EXPORT_NEW = '    readMemoryQaAnswer,\n    readMemoryQaAnswerAsync,\n'


def main():
    p = os.path.join(ROOT, REL)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(ANCHOR)
    assert n == 1, 'anchor A must hit exactly 1, got %d' % n
    assert 'readMemoryQaAnswerAsync' not in s, 'already patched'
    s = s.replace(ANCHOR, NEW_FN + ANCHOR, 1)
    n2 = s.count(EXPORT_ANCHOR)
    assert n2 == 1, 'anchor B must hit exactly 1, got %d' % n2
    s = s.replace(EXPORT_ANCHOR, EXPORT_NEW, 1)
    assert s.count('readMemoryQaAnswerAsync') == 2, s.count('readMemoryQaAnswerAsync')
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())