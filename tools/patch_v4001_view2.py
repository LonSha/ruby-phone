#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0 · R3-O8] 视图层完整补丁（重建版，git checkout 后重做）。"""
import io, sys

p = '/home/user/ruby-phone/apps/creationdesk/creationdesk-view.js'
s = io.open(p, encoding='utf-8').read()
N = 0


def sub(old, new, tag):
    global s, N
    n = s.count(old)
    if n != 1:
        print('FAIL %s 锚点 %d 次' % (tag, n)); sys.exit(1)
    s = s.replace(old, new); N += 1; print('ok   %s' % tag)


NEW_METHODS = '''    /** [v4.01.0 · R3-O8] 多目标勾选：一目标一份稿，编辑互不覆盖。 */
    _multiTargets(vm) {
        let h = '<div class="cwb-box"><h3>多目标编排（一段剧情 → 多种社媒稿，分别编辑互不覆盖）</h3>';
        for (const t of (vm.targets || [])) {
            const on = (vm.multiTargets || []).indexOf(t.target) >= 0;
            h += '<button class="cwb-tgt' + (on ? ' cwb-tgt-on' : '') + '" data-cw-multi="' + esc(t.target) + '">' +
                (on ? '已勾选 ' : '勾选 ') + esc(t.label) + (t.owner ? '' : '（无发布口）') + '</button>';
        }
        h += '<div class="cwb-note">已选 ' + String((vm.multiTargets || []).length) + ' 个目标；compose 后每目标各成一份草稿</div>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-draft="compose">编排草稿（一次多目标）</button>';
        h += '<button class="cwb-btn" data-cw-draft="redo">只重做所选段（其余原样保留）</button>';
        h += '</div></div>';
        return h;
    }
    /** [v4.01.0 · R3-O8] 草稿本列表：每份可选中编辑、可丢掉；编辑框只改选中的那份。 */
    _drafts(vm) {
        let h = '<div class="cwb-box"><h3>草稿本（关闭重开保留；每目标一份，互不覆盖）</h3>';
        const dr = vm.drafts || {};
        if (!dr.readable) {
            h += '<div class="cwb-row"><span class="cwb-row-v">草稿本读不到（不是「没草稿」—— 这两件事处置相反）</span></div>';
            return h + '</div>';
        }
        if (!(dr.items || []).length) {
            h += '<div class="cwb-row"><span class="cwb-row-v">草稿本读到了，但一份草稿也没有（先选素材与多目标，编排一次）</span></div>';
            return h + '</div>';
        }
        for (const d of dr.items) {
            const on = vm.draftKey === d.key;
            h += '<div class="cwb-mat' + (on ? ' cwb-mat-on' : '') + '">';
            h += '<button class="cwb-pick" data-cw-draft-key="' + esc(d.key) + '">' + (on ? '编辑中' : '选中编辑') + '</button>';
            h += '<span class="cwb-mat-label">' + esc(d.preview || d.key) + '</span>';
            h += '<span class="cwb-mat-meta">v' + String(d.version) + ' · ' + esc(d.state) + (d.readyToPublish ? ' · 可发布' : ' · 还没写正文') + (d.materialFound ? '' : ' · 素材已不在清单') + '</span>';
            h += '<button class="cwb-btn" data-cw-draft="drop" data-cw-key="' + esc(d.key) + '">丢掉这份</button>';
            h += '</div>';
        }
        h += '<div class="cwb-note">上限 ' + String(dr.limit || 0) + ' 份（最早先出）· 认不出 ' + String(dr.dropped || 0) + ' 份如实计数</div>';
        h += '<div class="cwb-note">编辑框就是「这一份」的文字—— 保存只改这一份，不动其它目标</div>';
        h += '<textarea class="cwb-note-area" data-cw-draft-note rows="4">' + esc(vm.draftNote) + '</textarea>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-draft="edit">保存这份文案（版本比较随行）</button>';
        h += '</div></div>';
        return h;
    }
'''

# ① 在 _html 之前插入两个新方法
sub("""    _html(vm) {""",
    NEW_METHODS + "    _html(vm) {",
    'methods')

# ② 组装
sub("""        h += this._targets(vm);
        h += this._plan(vm);""",
"""        h += this._targets(vm);
        h += this._multiTargets(vm);
        h += this._drafts(vm);
        h += this._plan(vm);""",
    'html')

# ③ 头部读数加草稿本行
sub("""        h += '<div class="cwb-reads">' + esc(vm.publishedText) + '</div>';""",
"""        h += '<div class="cwb-reads">' + esc(vm.publishedText) + '</div>';
        h += '<div class="cwb-reads">' + esc(vm.draftsText) + '</div>';""",
    'head')

# ④ 绑定
sub("""        el.querySelectorAll('[data-cw-act]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.act(b.getAttribute('data-cw-act')); });
        });""",
"""        el.querySelectorAll('[data-cw-act]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.act(b.getAttribute('data-cw-act')); });
        });
        /* [v4.01.0 · R3-O8] 草稿本与多目标绑定。 */
        el.querySelectorAll('[data-cw-multi]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.toggleMultiTarget(b.getAttribute('data-cw-multi')); });
        });
        el.querySelectorAll('[data-cw-draft-key]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setDraft(b.getAttribute('data-cw-draft-key')); });
        });
        const noteArea = el.querySelector('[data-cw-draft-note]');
        if (noteArea) noteArea.addEventListener('input', function () { self.app.setDraftNote(noteArea.value); });
        el.querySelectorAll('[data-cw-draft]').forEach(function (b) {
            b.addEventListener('click', function () {
                const k = b.getAttribute('data-cw-key');
                if (k) self.app.setDraft(k);
                self.app.draftAct(b.getAttribute('data-cw-draft'));
            });
        });""",
    'bind')

io.open(p, 'w', encoding='utf-8').write(s)
print('--- view2 %d ---' % N)
