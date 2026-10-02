/* ========================================================
 * socialguard-view.js — [v3.50.0] 熟人可见性案头 · 视图
 * 与号与尖括号走 String.fromCharCode 拼装形；挂载走 shell.getContentContainer
 * （v3430~v3480 案头先例），不碰 document.getElementById / document.body。
 * 键面话术本文件不重列，读数取不出来画横线。
 * ======================================================== */
'use strict';
import { visibleTo, isStoryAlive } from './socialguard-data.js';

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';
const DASH = String.fromCharCode(45, 45);

function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}
function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? String(v) : DASH; }

export class SocialguardView {
    constructor(app) { this.app = app; this.root = null; }
    _mount() {
        if (this.root) return this.root;
        const shell = this.app && this.app.shell;
        const container = shell && typeof shell.getContentContainer === 'function' ? shell.getContentContainer() : null;
        if (!container) return null;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'sg-root';
        container.appendChild(root);
        this.root = root;
        return this.root;
    }
    render(vm) {
        const el = this._mount();
        if (!el) return;
        el.innerHTML = this._html(vm);
        this._bind(el, vm);
    }
    _html(vm) {
        const parts = [];
        parts.push('<div class="sg-wrap">');
        parts.push(this._head(vm));
        parts.push(this._tabs(vm));
        if (vm.tab === 'board') parts.push(this._board(vm));
        else if (vm.tab === 'feed') parts.push(this._feed(vm));
        else if (vm.tab === 'contacts') parts.push(this._contacts(vm));
        else if (vm.tab === 'check') parts.push(this._check(vm));
        else parts.push(this._ledger(vm));
        parts.push('</div>');
        return parts.join('');
    }
    _head(vm) {
        const r = vm.readings || {};
        return '<div class="sg-head"><div class="sg-face">' + esc(vm.face) + '</div>' +
            '<div class="sg-readings">' +
            this._kv('帖子', num(r.posts)) + this._kv('故事', num(r.stories)) +
            this._kv('人脉', num(r.contacts)) + this._kv('看过', num(r.seenCount)) +
            this._kv('赞', num(r.likeCount)) + this._kv('评论', num(r.commentCount)) +
            '</div></div>';
    }
    _kv(k, v) { return '<div class="sg-kv"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }
    _tabs(vm) {
        const tabs = [['board', '看板'], ['feed', '动态'], ['contacts', '人脉'], ['check', '判定'], ['ledger', '台账']];
        let h = '<div class="sg-tabs">';
        for (const t of tabs) {
            const on = vm.tab === t[0] ? ' sg-tab-on' : '';
            h += '<button class="sg-tab' + on + '" data-tab="' + esc(t[0]) + '">' + esc(t[1]) + '</button>';
        }
        return h + '</div>';
    }    _board(vm) {
        let h = '<div class="sg-board">';
        h += '<div class="sg-sec"><h3>可见性判定（选一帖一看者）</h3>' +
            '<div class="sg-kv">' + this._kv('说明', '在动态页签点「验」逐帖判定') + '</div></div>';
        h += '<div class="sg-sec"><h3>收帖库（JSON）</h3>' +
            '<textarea class="sg-input" data-in="posts"></textarea>' +
            '<button class="sg-btn" data-act="intake-posts">收下帖子库</button>' +
            '<button class="sg-btn" data-act="clear-posts">清帖子库</button></div>';
        return h + '</div>';
    }
    _feed(vm) {
        let h = '<div class="sg-feed">';
        const rows = (vm.posts || []).concat(vm.stories || []);
        if (!rows.length) h += '<div class="sg-empty">还没有帖子。回看板收下帖子库。</div>';
        for (const p of rows) {
            const alive = p.kind === 'story' ? isStoryAlive(p, Date.now()) : true;
            const vis = visibleTo(p, 'user');
            const seen = !!(p.seenBy && p.seenBy['user']);
            const tone = (!alive || !vis) ? 'sg-row-off' : 'sg-row-ok';
            h += '<div class="sg-row ' + tone + '"><span class="sg-row-kind">' + esc(p.kind) + '</span>' +
                '<span class="sg-row-author">' + esc(p.authorId) + '</span>' +
                '<span class="sg-row-text">' + esc((p.text || '').slice(0, 60)) + '</span>' +
                '<span class="sg-row-badges">' + (vis ? '可见' : '不可见') + (seen ? '·已看' : '·未看') + (!alive ? '·已过期' : '') + '</span>' +
                '<button class="sg-btn" data-act="check" data-id="' + esc(p.id) + '">验</button>' +
                '<button class="sg-btn" data-act="seen" data-id="' + esc(p.id) + '">记已看</button></div>';
        }
        return h + '</div>';
    }    _contacts(vm) {
        let h = '<div class="sg-contacts">';
        h += '<div class="sg-sec"><h3>收人脉册（JSON）</h3>' +
            '<textarea class="sg-input" data-in="contacts"></textarea>' +
            '<button class="sg-btn" data-act="intake-contacts">收下人脉册</button>' +
            '<button class="sg-btn" data-act="clear-contacts">清人脉册</button></div>';
        const rows = vm.contacts || [];
        if (!rows.length) h += '<div class="sg-empty">还没有人脉。</div>';
        for (const c of rows) {
            h += '<div class="sg-row"><span class="sg-row-author">' + esc(c.ownerCharId || '?') + ' → ' + esc(c.actorId || '?') + '</span>' +
                '<span class="sg-row-badges">' + esc(c.relationship || '无备注') + (c.mayInteract ? '·可互动' : '') + (c.mayPost ? '·可发帖' : '') + (c.mayStory ? '·可发故事' : '') + '</span></div>';
        }
        return h + '</div>';
    }
    _check(vm) {
        return '<div class="sg-check"><div class="sg-empty">回动态页签点「验」看逐帖判定结果。</div></div>';
    }
    _ledger(vm) {
        let h = '<div class="sg-ledger">';
        h += '<div class="sg-actions"><button class="sg-btn" data-act="clear-ledger">清台账</button></div>';
        const rows = vm.ledger || [];
        if (!rows.length) h += '<div class="sg-empty">台账还没有记录。</div>';
        for (const e of rows) {
            h += '<div class="sg-row"><span>' + esc(e.action) + '</span><span>' + esc(e.detail || DASH) + '</span></div>';
        }
        if (vm.dropped > 0) h += '<div class="sg-dropped">台账挤掉 ' + String(vm.dropped) + ' 条</div>';
        return h + '</div>';
    }
    _bind(el) {
        const self = this;
        el.querySelectorAll('[data-tab]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.setTab(b.getAttribute('data-tab')); });
        });
        el.querySelectorAll('[data-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const act = b.getAttribute('data-act');
                const id = b.getAttribute('data-id');
                if (act === 'intake-posts') {
                    const ta = el.querySelector('[data-in="posts"]');
                    self.app.intakePosts(ta ? ta.value : '');
                } else if (act === 'intake-contacts') {
                    const ta = el.querySelector('[data-in="contacts"]');
                    self.app.intakeContacts(ta ? ta.value : '');
                } else if (act === 'seen') {
                    self.app.applySeen(id, 'user');
                } else if (act === 'check') {
                    self.app.checkPost(id, 'user', 'user');
                } else if (act === 'clear-posts') {
                    self.app.clearPosts();
                } else if (act === 'clear-contacts') {
                    self.app.clearContacts();
                } else if (act === 'clear-ledger') {
                    self.app.clearLedger();
                }
            });
        });
    }
}