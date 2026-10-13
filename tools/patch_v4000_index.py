#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4000_index.py — v4.00.0 · R3-O7：index.js 装配 mediaTasks 注册板。

三处改动，每处锚点必须恰中一次：
  ① import 区加 import { canCancel as mtrCanCancel, applyCancel as mtrApplyCancel } ...；
  ② TtsManager 实例化后建 mediaTasks 板（会话内存 Map，不落盘——任务态的生命周期
     就是会话生命周期，重启后由各 App 自身的恢复面接管：微信生图 loading→failed）；
  ③ VirtualPhone 装配区挂 window.VirtualPhone.mediaTasks。
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

# ---------- ① import 区 ----------
s = rd('index.js')
old1 = "import { MemoryCore } from './apps/memory/memory-data.js';"
new1 = old1 + "\nimport { canCancel as mtrCanCancel, applyCancel as mtrApplyCancel, normalizeTask as mtrNormalizeTask, summarizeTasks as mtrSummarizeTasks } from './config/media-task-registry.js';"
s = once(s, old1, new1, 'import')

# ---------- ② mediaTasks 板（TtsManager 实例化之后） ----------
old2 = "        ttsManager = new TtsManager(storage);"
new2 = old2 + """
        /* [v4.00.0 · R3-O7] 生图与语音的统一任务注册板（会话内存，不落盘）。
         *   任务态的生命周期就是会话生命周期：重启后微信生图的 loading 恢复面
         *   （wechat-data 的 loading→failed）照旧接管，这里不做第二份持久化。
         *   板上只有三个动作：upsert（登记/更新，过 normalizeTask 窄口）、
         *   cancel（过 canCancel/applyCancel 白名单——可播放成果不允许被取消误伤）、
         *   snapshot（聚合读数，供任务入口/诊断消费）。 */
        const mediaTaskMap = new Map();
        window.VirtualPhone.mediaTasks = {
            upsert(raw) {
                const norm = mtrNormalizeTask(raw);
                if (!norm.ok) return { saved: false, why: norm.reason };
                mediaTaskMap.set(norm.task.key, norm.task);
                return { saved: true, why: '', task: norm.task };
            },
            remove(key) {
                const k = String(key || '').trim();
                return { saved: mediaTaskMap.delete(k), why: k ? '' : 'empty-key' };
            },
            cancel(key) {
                const k = String(key || '').trim();
                const task = mediaTaskMap.get(k);
                if (!task) return { ok: false, why: 'no-such-task', task: null };
                const gate = mtrCanCancel(task);
                if (!gate.ok) return { ok: false, why: gate.reason, task: null };
                const applied = mtrApplyCancel(task);
                if (!applied.ok) return { ok: false, why: applied.reason, task: null };
                mediaTaskMap.set(k, applied.task);
                return { ok: true, why: '', task: applied.task };
            },
            snapshot() {
                return mtrSummarizeTasks(Array.from(mediaTaskMap.values()));
            }
        };"""
s = once(s, old2, new2, 'mediaTasks-board')

# ---------- ③ 挂到 VirtualPhone（apiManager 行前的装配区） ----------
old3 = "                ttsManager: ttsManager,"
new3 = old3 + "\n                mediaTasks: window.VirtualPhone ? window.VirtualPhone.mediaTasks : null, // [v4.00.0 · R3-O7]"
s = once(s, old3, new3, 'vp-mount')

assert s.count('media-task-registry.js') == 1, 'import must appear exactly once'
assert s.count('window.VirtualPhone.mediaTasks') >= 2, 'board must be defined and mounted'

if WRITE:
    wr('index.js', s)
    print('index.js written OK')
else:
    print('DRY RUN OK (anchors hit, no write)')
