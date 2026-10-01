#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv5.py — 修「坏 storage 被静默读成『空』」这一处真缺陷。

★ 缺陷形态（冒烟 T 项当场暴露，不是门禁报的）：
  `probe()` 用 `_readJSON()` 取数，而 `_readJSON` **自己吞掉异常**返回 null
  （`catch (_e) { return null; }`）。于是「storage 一取就抛」这条路上，异常
  永远到不了 probe 的 catch，`storageOk` 一直是 true —— 结果：
    · 坏 storage ⇒ face 报 `empty`（"还没有作品"），而**不是** `storage_absent`；
    · `_proj` 照旧现算一份空投影，视图会照常渲染一整套空壳。
  这正是本仓反复禁的「塌成一态」：**「取不出来」和「本来就是空的」不是一回事**。

★ 修法：加 `_readRaw()` —— 把「取不到」（storage 抛 / 没有 get）与
  「解析不了」（键里不是合法 JSON）分成两种回报：
    · `ok: false` ⇒ storage 不可用（probe 据此把 face 定成 storage_absent、投影置 null）；
    · `ok: true, raw: null` ⇒ storage 好的、只是这个键读不出东西（照旧走空脸面）。
  probe 与 `contentFace()` 都改走这条道。
  设置键（pixiv_settings）**仍走 `_readJSON`**：那里的语义本来就是「没有就用默认」。

★ 幂等：锚点命中次数 ≠ 1 即拒改。
"""
import os
import subprocess
import sys
import tempfile

TARGET = 'apps/pixiv/pixiv-app.js'
FAILS = []


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


A1_OLD = """    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }
"""
A1_NEW = """    /** 取数（**吞异常版**）：只给「没有就用默认」的场景用（设置键）。
     *  ★ 别拿它认源 —— 它会把自己的异常吞掉，「取不出来」于是变成「就是空的」。 */
    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }
    /**
     * 取数（**分两种回报**）：`ok` 说「storage 能不能用」，`raw` 说「这一格读到了什么」。
     *   · `ok === false` ⇒ storage 没给 / 一取就抛 ⇒ 这是「取不出来」，不是「空的」；
     *   · `ok === true, raw === null` ⇒ storage 是好的，只是这一格没有 / 不是合法 JSON。
     * 源把全部状态挂在内存对象上，从没区分过这两种情形（内存对象永远在）。
     */
    _readRaw(key) {
        if (!this.storage || typeof this.storage.get !== 'function') return { ok: false, raw: null };
        let text = null;
        try { text = this.storage.get(key); }
        catch (_e) { return { ok: false, raw: null }; }
        if (typeof text !== 'string') return { ok: true, raw: text };
        try { return { ok: true, raw: JSON.parse(text) }; }
        catch (_e) { return { ok: true, raw: null }; }
    }
"""

A2_OLD = """        let storageOk = !!this.storage;
        try {
            const rawC = this._readJSON(CONTENT_KEY);
            const c = (rawC && typeof rawC === 'object') ? rawC : {};
"""
A2_NEW = """        // ★ 先认 storage 本身可不可用（**异常不许被吞**）——见 `_readRaw` 的注释。
        const rc = this._readRaw(CONTENT_KEY);
        const rs = this._readRaw(STORE_KEY);
        let storageOk = rc.ok && rs.ok;
        try {
            const c = (rc.raw && typeof rc.raw === 'object') ? rc.raw : {};
"""

A3_OLD = """            const rawS = this._readJSON(STORE_KEY);
            const s = (rawS && typeof rawS === 'object') ? rawS : {};
"""
A3_NEW = """            const s = (rs.raw && typeof rs.raw === 'object') ? rs.raw : {};
"""

A4_OLD = """    contentFace() { return readPixivFace(this._readJSON(CONTENT_KEY)); }"""
A4_NEW = """    contentFace() {
        const r = this._readRaw(CONTENT_KEY);
        return readPixivFace(r.ok ? r.raw : null);
    }"""


def apply(text, old, new, tag):
    n = text.count(old)
    if n != 1:
        FAILS.append('%s 锚点命中 %d 次（应恰 1 次）' % (tag, n))
        return text
    return text.replace(old, new, 1)


def main():
    with open(TARGET, 'r', encoding='utf-8') as f:
        text = f.read()
    orig = text
    text = apply(text, A1_OLD, A1_NEW, 'A1 取数助手下沉')
    text = apply(text, A2_OLD, A2_NEW, 'A2 probe 认 storage')
    text = apply(text, A3_OLD, A3_NEW, 'A3 store 读侧')
    text = apply(text, A4_OLD, A4_NEW, 'A4 contentFace')
    if FAILS:
        print('FAIL:')
        for f in FAILS:
            print('  · ' + f)
        return 1
    if text == orig:
        print('FAIL 内容未变')
        return 1
    ok, err = check_js(text)
    if not ok:
        print('FAIL 改后 JS 语法不合法: %s' % err)
        return 1
    with open(TARGET, 'w', encoding='utf-8') as f:
        f.write(text)
    print('OK %s 修「坏 storage 读成空」；%d -> %d 行' % (TARGET, orig.count('\n') + 1, text.count('\n') + 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())