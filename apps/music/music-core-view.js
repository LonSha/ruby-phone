/* ========================================================
 * music-core-view.js — [v4.190.0] 音乐 歌词/播放模式 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是：一段 LRC 试算 + 时间轴歌词列表 + 播放模式拨盘。
 * ======================================================== */
'use strict';

export class MusicCoreView {
    constructor(app, shell) {
        this.app = app;
        this.shell = shell;
        this._root = null;
        this._boundRoot = null;
        this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('music-core-css')) return;
            const link = document.createElement('link');
            link.id = 'music-core-css';
            link.rel = 'stylesheet';
            link.href = new URL('./music-core.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'mc-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root;
        this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
    }

    _flashText(msg) { this._flash = msg || ''; this.refresh(); }

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '"');
    }

    _sec(t) {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        const f = Math.floor((t - Math.floor(t)) * 100);
        const pad = (n, w) => { const x = String(n); return (w ? '0' : '') .repeat(Math.max(0, w - x.length)) + x; };
        return pad(m, 2) + ':' + pad(s, 2) + '.' + pad(f, 2);
    }

    _html() {
        const a = this.app;
        const mode = a.mode;
        const out = a.lastOut;
        const o = out ? out.out : null;
        let list = '<div class="mc-empty">点「试算歌词」跑一遍</div>';
        if (o && out.kind === 'lrc') {
            const rows = (o.lines || []).map((l, i) => {
                const cur = (i === o.index) ? ' mc-cur' : '';
                return '<div class="mc-line' + cur + '"><span class="mc-t">' + this._esc(this._sec(l.t)) + '</span><span class="mc-x">' + this._esc(l.txt) + '</span></div>';
            });
            list = '<div class="mc-lines">' + rows.join('') + '</div>'
                + '<div class="mc-meta">共 ' + o.count + ' 句 · 进度 ' + a.seconds + 's · 当前第 ' + (o.index + 1) + ' 句</div>';
        }
        return '<div class="mc-head">'
            + '<div class="mc-title">歌词 / 播放模式 试算台</div>'
            + '<div class="mc-sub">同一段 LRC + 同一秒 => 同一句（内核不碰 Audio、不自己取时间）</div>'
            + '</div>'
            + '<div class="mc-grid">'
            + '<button type="button" data-act="lrc">试算歌词</button>'
            + '<button type="button" data-act="cycle">切模式（' + this._esc(mode) + '）</button>'
            + '<button type="button" data-act="seek30">拨到 30s</button>'
            + '<button type="button" data-act="seek65">拨到 65s</button>'
            + '</div>'
            + (this._flash ? '<div class="mc-flash">' + this._flash + '</div>' : '')
            + list;
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'lrc') {
                const r = this.app.lrc(this.app.lrcText);
                this._flashText('解出 ' + r.out.count + ' 句，当前「' + r.out.current + '」');
            } else if (act === 'cycle') {
                const r = this.app.cycle();
                this._flashText(r.out.before + ' -> ' + r.out.after + (r.out.loop ? '（loop 开）' : ''));
            } else if (act === 'seek30') {
                this.app.seek(30);
                const r = this.app.lrc(this.app.lrcText);
                this._flashText('30s => 第 ' + (r.out.index + 1) + ' 句「' + r.out.current + '」');
            } else if (act === 'seek65') {
                this.app.seek(65);
                const r = this.app.lrc(this.app.lrcText);
                this._flashText('65s => 第 ' + (r.out.index + 1) + ' 句「' + r.out.current + '」');
            }
        });
    }
}

export default MusicCoreView;