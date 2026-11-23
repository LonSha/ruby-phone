/* ========================================================
 * phone-text-view.js — [v4.192.0] 通话/短信文本归一 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是七组试算格子：通话回复 / 拒接理由 / 短信批量 / TTS 缓存键 / 头像地址 /
 *   TTS 性别 / 内核常量 + 一段 JSON 输出。
 * ======================================================== */
'use strict';

export class PhoneTextView {
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
            if (document.getElementById('phone-text-css')) return;
            const link = document.createElement('link');
            link.id = 'phone-text-css';
            link.rel = 'stylesheet';
            link.href = new URL('./phone-text.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'pt-root';
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

    _html() {
        const o = this.app.lastOut;
        const out = o ? JSON.stringify(o) : '还没试算过';
        return '<div class="pt-head">'
            + '<div class="pt-title">通话/短信 文本归一试算台</div>'
            + '<div class="pt-sub">同一输入 => 同一结果（内核纯函数，不取时钟不造随机）</div>'
            + '</div>'
            + '<div class="pt-grid">'
            + '<button type="button" data-act="call">通话回复清洗</button>'
            + '<button type="button" data-act="reject">拒接理由清洗</button>'
            + '<button type="button" data-act="sms">短信批量解析</button>'
            + '<button type="button" data-act="cachekey">TTS 缓存键</button>'
            + '<button type="button" data-act="avatar">头像地址归一</button>'
            + '<button type="button" data-act="ttsgender">TTS 性别归一</button>'
            + '<button type="button" data-act="constants">内核常量读数</button>'
            + (this._flash ? '<div class="pt-flash">' + this._flash + '</div>' : '')
            + '<div class="pt-out">' + out + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'call') {
                const r = this.app.call('<Call>---阿茶---\n<Call>在吗？\n</Phone>\n在吗？\n|||</Call>', '阿茶');
                this._flashText('拆出 ' + r.lines.length + ' 行：' + r.lines.join(' / '));
            } else if (act === 'reject') {
                const r = this.app.reject('<Call>[拒绝电话]：阿茶：我在开会</Call>', '阿茶');
                this._flashText('理由：「' + r.reason + '」');
            } else if (act === 'sms') {
                const r = this.app.sms('<短信>\n[姓名]\n内容：晚点回你\n发送时间：2024年3月5日 21:30\n</短信>', '阿茶');
                const m = r.messages[0];
                this._flashText(m
                    ? ('解析 ' + r.messages.length + ' 条：' + m.sender + ' / ' + m.text + ' / ' + m.date + ' ' + m.time)
                    : '没解析出短信（缺 [发送方] 或缺内容）');
            } else if (act === 'cachekey') {
                const r = this.app.cacheKey({ bubbleId: 'b1', caller: '阿茶', provider: 'minimax_cn', voice: 'v1', text: '在吗' });
                this._flashText('键长 ' + r.key.length + '（含 US 分隔符）');
            } else if (act === 'avatar') {
                const r = this.app.avatar('apps/wechat/avatars/male3.png');
                this._flashText('归一为：' + (r.path || '（不放行）'));
            } else if (act === 'ttsgender') {
                const r = this.app.ttsGender('F');
                this._flashText('性别归一为：' + (r.gender || '（不认）'));
            } else if (act === 'constants') {
                const r = this.app.constants();
                this._flashText('全局常量：' + r.genders + ' · 分隔符 US · 占位符 ' + r.placeholder);
            }
        });
    }
}

export default PhoneTextView;