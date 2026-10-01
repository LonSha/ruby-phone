#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv3.py — 给 apps/pixiv/pixiv-app.js 补四个设置面方法。

补的是视图要用的公开面（照 lofter-app 的 addAuthor / addStyle / removeStyle /
toggleStyle 口径改写）：
  · addAuthor(input)   —— 用户自建作者进池（内置只补缺不覆盖那条纪律的写侧）
  · addStyle(name, rules) —— 加一款自建文风（重名内置的拒掉）
  · removeStyle(id)    —— 删自建文风（内置的不许删，只能停用）
  · toggleStyle(id)    —— 启停一款文风（关掉的随机抽不到）

★ 幂等：任一锚点命中次数 ≠ 1 就拒绝执行（已改过 / 现场不同）。
"""
import os
import subprocess
import sys
import tempfile

TARGET = 'apps/pixiv/pixiv-app.js'
ANCHOR = "    /* ---------- 生成要求（可复制文本；本件不发请求） ---------- */"

BLOCK = '''    /* ---------- 自建作者 / 自建文风（写侧；内置只补缺不覆盖） ---------- */
    /**
     * 加一位自建作者。★ 与 `probe()` 的合并纪律成对：
     *   probe 是「内置只补缺、不覆盖同 id 的用户项」，这里保证新 id 不与内置撞。
     */
    addAuthor(input) {
        const s = (input && typeof input === 'object') ? input : {};
        const name = String(s.name || '').trim();
        if (!name) return { ok: false, error: '作者要有名字' };
        const raw = String(s.type || '');
        const type = (this.allTypes().indexOf(raw) >= 0) ? raw : PIXIV_ACTIVE_TYPES[0];
        const id = 'pxv_a_u' + Date.now().toString(36);
        const a = {
            id,
            name,
            type,
            bio: String(s.bio || '').trim().slice(0, 200),
            contentTags: toStrArr(s.contentTags).map((t) => t.replace(/^#/, '').trim())
                .filter(Boolean).slice(0, 3),
            writingStyle: String(s.writingStyle || '').trim(),
            builtIn: false,
        };
        this.authors = this.authors.concat([a]);
        this._persistContent();
        this.probe();
        return { ok: true, id: a.id, name: a.name, type: a.type, active: isActivePixivType(a.type) };
    }
    /** 加一款自建文风。重名内置的拒掉（内置是单一真源，不许被同名遮住）。 */
    addStyle(name, rules) {
        const n = String(name || '').trim();
        const r = String(rules || '').trim();
        if (!n) return { ok: false, error: '文风要有名字' };
        if (!r) return { ok: false, error: '文风要写点规则（不然模型不知道怎么写）' };
        const builtInNames = PIXIV_WRITING_STYLES.map((s) => s.name);
        if (builtInNames.indexOf(n) >= 0) return { ok: false, error: '内置已经有一款叫「' + n + '」的了，换个名字' };
        const id = 'pxv_style_u' + Date.now().toString(36);
        this.settings.writingStyles = this.styleList()
            .concat([{ id, name: n, description: '', rules: r, enabled: true }]);
        this.saveSettings();
        return { ok: true, id, count: this.settings.writingStyles.length };
    }
    /** 删自建文风。内置的不许删 —— 只想停用就关掉（关掉后随机抽不到）。 */
    removeStyle(id) {
        const want = String(id || '');
        const cur = this.styleById(want);
        if (!cur) return { ok: false, error: '这款文风找不到了' };
        if (PIXIV_WRITING_STYLES.some((s) => s.id === want)) {
            return { ok: false, error: '内置文风不能删 —— 只想停用就把它关掉（关掉后随机不会抽到它）' };
        }
        this.settings.writingStyles = this.styleList().filter((s) => s.id !== want);
        this.saveSettings();
        return { ok: true, count: this.settings.writingStyles.length };
    }
    /** 启停一款文风。返回启用了的款数，防止「五款全关」这种静默空抽。 */
    toggleStyle(id) {
        const want = String(id || '');
        let hit = null;
        const list = this.styleList().map((s) => {
            if (s.id !== want) return s;
            hit = Object.assign({}, s, { enabled: s.enabled === false });
            return hit;
        });
        if (!hit) return { ok: false, error: '这款文风找不到了' };
        this.settings.writingStyles = list;
        this.saveSettings();
        return { ok: true, enabled: hit.enabled, enabledCount: list.filter((s) => s.enabled !== false).length };
    }
'''


def main():
    with open(TARGET, 'r', encoding='utf-8') as f:
        text = f.read()
    n = text.count(ANCHOR)
    if n != 1:
        print('FAIL %s 锚点命中 %d 次（应恰 1 次）' % (TARGET, n))
        return 1
    out = text.replace(ANCHOR, BLOCK + '\n' + ANCHOR, 1)
    if out == text:
        print('FAIL 替换后内容未变')
        return 1
    # ★ 目标文件是 JS：用 node --check 校验，别用 Python 的 ast（那是 Python 语法解析器）。
    fd, tmp = tempfile.mkstemp(suffix='.mjs')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(out)
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        if r.returncode != 0:
            print('FAIL 替换后 JS 语法不合法: %s' % (r.stderr or '').strip()[:400])
            return 1
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    with open(TARGET, 'w', encoding='utf-8') as f:
        f.write(out)
    print('OK %s 补四个方法；%d -> %d 行' % (TARGET, text.count('\n') + 1, out.count('\n') + 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
