#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv6.py — 修三处「视图 ↔ App ↔ 数据层」契约错，并补齐评论回填这条通道。

★ 缺陷一（真缺陷，白盒比对才发现）：`recommendAuthors` 把数据层的返回**对象**
  `{picked, considered, matched}` 原样吐给视图，而视图 `for (const a of rec)` /
  `rec.length` 把它当**数组**用 —— 结果是点开「我的」面直接 `TypeError: rec is not
  iterable`。数据层返回值这三种读数**都要留**（判据要断言），故修在 App 侧：
  `recommendAuthors` 返回 `picked`，另开 `recommendFace()` 把三个读数原样带出。

★ 缺陷二（功能级失效）：`ingestComments` 在视图里**零入口** —— 导出了、有实现，
  但没有任何一条用户路径能走到它。源侧这条通道是 `_parseComments`（`---COMMENT---`
  分隔块）→ `_assembleComments` → 落盘。本件补：数据层 `parseCommentsBlock()`、
  App 层 `ingestCommentsText()`、视图层「把宿主给的评论贴回来」文本框 + 收下按钮。

★ 缺陷三（假面）：视图里 `#pxv-cmt-again`「让宿主重读这一話」按钮的绑定语是
  `this._open = this._open;` —— 一句**废语句**，按了只会重绘，什么也没发生。
  「重读」在零网络件里没有实现路径 ⇒ 删掉这个按钮，不留按不动的假面。

★ 幂等：每条锚点命中次数 ≠ 1 即拒改。
"""
import os
import subprocess
import sys
import tempfile

FAILS = []
TARGETS = ['apps/pixiv/pixiv-data.js', 'apps/pixiv/pixiv-app.js', 'apps/pixiv/pixiv-view.js']


def check_js(text):
    fd, tmp = tempfile.mkstemp(suffix='.mjs')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        return (r.returncode == 0), (r.stderr or '').strip()[:400]
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def patch(path, old, new, tag, times=1):
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != times:
        FAILS.append('%s：%s 锚点命中 %d 次（应恰 %d 次）' % (path, tag, n, times))
        return
    out = text.replace(old, new, times)
    ok, err = check_js(out)
    if not ok:
        FAILS.append('%s：%s 改后语法不合法 %s' % (path, tag, err))
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('OK %s：%s' % (path, tag))


# ────────────────────────────────── ① 数据层：评论分隔块解析器
D_ANCHOR = """/** 我的四个子面（各自独立，**不许合并**）。 */"""
D_INSERT = """/* ---------- 宿主回填：评论分隔块 ---------- */

/** 评论块分隔符（照源 `_parseComments` 的 `---COMMENT---` 口径）。 */
export const PIXIV_COMMENT_DELIM = '---COMMENT---';

/**
 * 解析宿主贴回来的评论块。协议（本件定，写在视图的输入框提示里）：
 *   `---COMMENT---` 分块；块内首行可选 `AUTHOR: 名字`、次行可选 `REPLY: 序号`，
 *   其余行拼成正文。`REPLY` 里的序号是**本次列表内**的 1 基序号（指向前面某条）。
 *
 * ★ 为什么要有「解析」这一步：源把解析与登记揉在一个网络回调里（`loadComments`），
 *   本件没有网络，于是「解析」必须自己成为一条**纯函数**通道，否则 `ingestComments`
 *   永远没有入口（导出了、有实现、零调用 = 功能级失效）。
 * ★ 回报 `skipped`：正文为空的块**如实计数**，不许静默丢。
 */
export function parseCommentsBlock(text) {
    const raw = String(text || '');
    const chunks = raw.split(PIXIV_COMMENT_DELIM);
    const items = [];
    let skipped = 0;
    for (const chunk of chunks) {
        const body = chunk.replace(/^\\s*\\n/, '').replace(/\\s+$/, '');
        if (!body.trim()) continue;
        const lines = body.split('\\n');
        let author = '';
        let replyTo = null;
        let i = 0;
        for (; i < lines.length; i++) {
            const m = lines[i].match(/^\\s*(AUTHOR|REPLY)\\s*[:：]\\s*(.*)$/i);
            if (!m) break;
            if (m[1].toUpperCase() === 'AUTHOR') author = m[2].trim();
            else {
                const idx = numOrNull(m[2].trim());
                replyTo = (idx === null || Math.trunc(idx) < 1) ? null : (items[Math.trunc(idx) - 1] ? items[Math.trunc(idx) - 1].id : null);
            }
        }
        const content = lines.slice(i).join('\\n').trim();
        if (!content) { skipped += 1; continue; }
        items.push({ id: 'hc' + (items.length + 1), author: author || '匿名', content, replyToCommentId: replyTo });
    }
    return { items, skipped, blocks: chunks.length - 1 };
}

"""
patch('apps/pixiv/pixiv-data.js', D_ANCHOR, D_INSERT + D_ANCHOR, '数据层加 parseCommentsBlock')

# ────────────────────────────────── ② App 层：recommendAuthors 形态 + 回填入口
A1_OLD = """    recommendAuthors(count, preferTag, seed) {
        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed);
    }"""
A1_NEW = """    recommendAuthors(count, preferTag, seed) {
        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed).picked;
    }
    /** 挑选面的**三个读数**（挑出几位 / 池里参与几位 / tag 命中几位）—— 分开报。 */
    recommendFace(count, preferTag, seed) {
        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed);
    }"""
patch('apps/pixiv/pixiv-app.js', A1_OLD, A1_NEW, 'recommendAuthors 返回 picked')

A2_OLD = """    /* ---------- 收下宿主机给的产出 ---------- */"""
A2_NEW = """    /** 把宿主贴回来的评论**文本块**收下（解析 → 登记；解析器在数据层）。 */
    ingestCommentsText(novelId, num, text) {
        const parsed = parseCommentsBlock(text);
        if (!parsed.items.length) {
            return { ok: false, error: parsed.skipped ? ('贴回来的 ' + parsed.skipped + ' 块里没有正文') : '没看到评论块（每块用 ' + PIXIV_COMMENT_DELIM + ' 起头）' };
        }
        const r = this.ingestComments(novelId, num, parsed.items, false);
        return Object.assign({}, r, { skipped: parsed.skipped, blocks: parsed.blocks });
    }
    /* ---------- 收下宿主机给的产出 ---------- */"""
patch('apps/pixiv/pixiv-app.js', A2_OLD, A2_NEW, 'App 加 ingestCommentsText')

A3_OLD = """    previewContext, nextChapterNum, chapterPositionFace,"""
if A3_OLD in open('apps/pixiv/pixiv-app.js', encoding='utf-8').read():
    A3_NEW = """    previewContext, nextChapterNum, chapterPositionFace,
    parseCommentsBlock,"""
    patch('apps/pixiv/pixiv-app.js', A3_OLD, A3_NEW, 'import 加 parseCommentsBlock')
else:
    # 实际 import 里没有 previewContext，改用真实行
    A3B_OLD = """    prevChapterContext, nextChapterNum, chapterPositionFace,"""
    A3B_NEW = """    prevChapterContext, nextChapterNum, chapterPositionFace, parseCommentsBlock,"""
    patch('apps/pixiv/pixiv-app.js', A3B_OLD, A3B_NEW, 'import 加 parseCommentsBlock')

# ────────────────────────────────── ③ 视图层：删假按钮 + 加回填框
V1_OLD = """        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cmt-prompt">让宿主给几条评论</button>');
        if (cf.face !== 'not_read') {
            parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cmt-again">让宿主重读这一話</button>');
        }
        parts.push('</div>');"""
V1_NEW = """        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cmt-prompt">让宿主给几条评论</button>');
        parts.push('<button class="pxv-btn pxv-btn-ghost" id="pxv-cmt-ingest">收下宿主给的评论</button>');
        parts.push('</div>');
        parts.push('<textarea class="pxv-ta" id="pxv-cmt-host" placeholder="把宿主写的评论贴回来：每块用 '
            + '---COMMENT--- 起头，块内可写 AUTHOR: 名字 与 REPLY: 要回的序号（本次第几条）">'
            + this._esc(this._draft.hostComments) + '</textarea>');"""
patch('apps/pixiv/pixiv-view.js', V1_OLD, V1_NEW, '视图评论区：删假按钮 + 加回填框')

V2_OLD = """        const cg = this._q('#pxv-cmt-again');
        if (cg) cg.addEventListener('click', () => { this._open = this._open; this.refresh(); });"""
V2_NEW = """        const cht = this._q('#pxv-cmt-host');
        if (cht) cht.addEventListener('input', (e) => { this._draft.hostComments = e.target.value; });
        const cg = this._q('#pxv-cmt-ingest');
        if (cg) cg.addEventListener('click', () => {
            const ch = app.currentChapter();
            if (!ch) return;
            const ta = this._q('#pxv-cmt-host');
            const r = app.ingestCommentsText(this._open, ch.num, ta ? ta.value : this._draft.hostComments);
            this._flash = r.ok
                ? ('收下 ' + r.added + ' 条' + (r.skipped ? ('（另有 ' + r.skipped + ' 块没有正文，丢了）') : '')
                    + (r.expired ? ('（满 ' + PIXIV_LIMITS.maxCommentsPerChapter + ' 条，丢了最早的 ' + r.expired + ' 条）') : ''))
                : (r.error || '没成');
            if (r.ok) this._draft.hostComments = '';
            this.refresh();
        });"""
patch('apps/pixiv/pixiv-view.js', V2_OLD, V2_NEW, '视图评论区：绑回填')

V3_OLD = """            prompt: '', negativePrompt: '', size: '1024x1024', count: '', search: '',"""
V3_NEW = """            prompt: '', negativePrompt: '', size: '1024x1024', count: '', search: '', hostComments: '',"""
patch('apps/pixiv/pixiv-view.js', V3_OLD, V3_NEW, '视图草稿加 hostComments')

if FAILS:
    print('FAIL:')
    for f in FAILS:
        print('  · ' + f)
    sys.exit(1)
for t in TARGETS:
    ok, err = check_js(open(t, encoding='utf-8').read())
    if not ok:
        print('FAIL 最终语法 %s: %s' % (t, err))
        sys.exit(1)
print('OK patch_pixiv6 全部落地')
sys.exit(0)