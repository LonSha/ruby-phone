#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_mag_app_tail.py — 把 magazine-app.js 的尾部生命周期段改成**本仓视图规格**。

本仓规格（照 pixiv / lofter / date）：
  · `render()` **空参** —— 视图自己从 shell 拿容器；
  · 换会话钩子叫 `onChatChanged()`（不是 resetForChat）；
  · 视图只有 `render()` / `refresh()` 两个口（没有 mount / teardown / update）。
先落盘脚本再执行（本仓纪律：终端 heredoc 内嵌 python 易被 bash 解析失败）。
"""
import io

P = 'apps/magazine/magazine-app.js'
text = io.open(P, encoding='utf-8').read()

MARK = '    /* ---------- 生命周期 ---------- */'
n = text.count(MARK)
assert n == 1, '生命周期段头必须恰中 1 次，实得 %d' % n
head = text[:text.index(MARK)]

TAIL = '''    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'list');
        this._tab = ['list', 'new', 'search', 'settings'].indexOf(k) >= 0 ? k : 'list';
        return this._tab;
    }
    openArticle(id) {
        const f = this.find(id);
        if (!f.found) return { ok: false, reason: 'not_found' };
        this._current = id;
        this._tab = 'reader';
        if (this._view) this._view.refresh();
        return { ok: true, article: f.article };
    }
    backToList() {
        this._current = '';
        this._tab = 'list';
        if (this._view) this._view.refresh();
        return this._tab;
    }
    currentId() { return this._current; }
    /** 摘要行（头部那一行读数；视图不自己拼统计）。 */
    summaryLine() {
        const r = this._readings;
        const l = this.ledgerFace();
        const bits = ['稿件 ' + r.totalArticles + ' 篇'];
        bits.push('分享过 ' + l.shared + ' / 导出过 ' + l.exported);
        if (r.unparsed) bits.push('有 ' + r.unparsed + ' 行没认出来');
        if (r.dropped) bits.push('丢过 ' + r.dropped + ' 条');
        if (r.volConflicts) bits.push('期号撞号 ' + r.volConflicts + ' 次');
        return bits.join(' · ');
    }

    /* ---------- 生命周期 ---------- */
    /** 换会话：稿件、译文、台账全是「这段关系的账」，故全部重取。
     *  （源没有这一步：它的数据在内存里，切角色时**原样留着** —— 串味。） */
    onChatChanged() {
        this._current = '';
        this._tab = 'list';
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new MagazineView(this, this.shell, this.storage);
        this._view.render();
    }
}
'''

io.open(P, 'w', encoding='utf-8').write(head + TAIL)
print('OK 尾部已改；新行数 =', (head + TAIL).count('\n'))