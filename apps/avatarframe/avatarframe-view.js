/* ========================================================
 * avatarframe-view.js — [v3.27.0] 头像框 App 视图
 * 归因卡 + 框清单（按来源归类）+ 两个挂载点的选择 + 导入/粘贴 + 未保存提示 + 设置
 *
 * 与 focus-view / piggy-view / punchcard-view 同纪律：归因文案表的键取 AVATAR_FRAME_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 两处「不糊弄」：
 *   · 挂载点选中的是 **src**（不是下标），与数据层身份口径一致；
 *   · 有未保存改动时把它当**读数**顶在面板上（源把两套保存语义藏在代码里，界面上看不出来）。
 * ======================================================== */
'use strict';
import { AVATAR_FRAME_REASONS, AVATAR_FRAME_LIMITS } from './avatarframe-data.js';

const FACE_META = {
    [AVATAR_FRAME_REASONS.ready]: { icon: '\u2705', label: '已有头像框清单', tone: 'ok' },
    [AVATAR_FRAME_REASONS.empty]: { icon: '\u{1f5bc}\ufe0f', label: '这个会话还没有框', tone: 'warn' },
    [AVATAR_FRAME_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

/** 来源类别的**人类可读**说法（键是 classifySource 的返回值）。 */
const KIND_LABEL = {
    'empty': '摘掉（无框）',
    'preset-token': '预置框名',
    'data-url': '自包含图',
    'external-url': '外链（未开启时不收）',
    'blob-url': '临时 blob（重开会话失效）',
    'invalid': '拒收',
};

const TARGET_LABEL = { my: '我', ai: '本会话角色' };

export class AvatarFrameView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 粘贴框的来源（纯视图态，不落盘） */
        this._pasteSrc = '';
        this._pasteName = '';
        /** 清单文本导入区（纯视图态） */
        this._importText = '';
        /** 两步确认 */
        this._pendingConfirm = '';
        /** 提示条 */
        this._flash = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'avf-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const frames = app.framesList();
        const proj = app.projection() || {
            stats: { total: 0, 'data-url': 0, 'external-url': 0, 'preset-token': 0, 'blob-url': 0, empty: 0 },
            mounts: [], hasAny: false,
        };
        const settings = app.settings;
        const limits = app.limits();
        const parts = [];

        parts.push('<div class="avf-header"><h2>\u{1f5bc}\ufe0f 头像框</h2></div>');

        parts.push('<div class="avf-face avf-face-' + meta.tone + '">');
        parts.push('<span class="avf-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="avf-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) {
            parts.push('<div class="avf-flash">' + this._esc(this._flash) + '</div>');
        }

        /* 未保存提示（读数，不是装饰） */
        if (app.mountsDirty()) {
            parts.push('<div class="avf-dirty">有改动还没保存 —— 点下面「保存挂载」才生效，否则离开就丢。</div>');
        }

        /* ---------- 两个挂载点 ---------- */
        parts.push('<div class="avf-mounts">');
        parts.push('<h3 class="avf-list-title">谁挂着什么</h3>');
        for (const m of proj.mounts) {
            const label = TARGET_LABEL[m.target] || m.target;
            parts.push('<div class="avf-mount' + (m.orphan ? ' is-orphan' : '') + '">');
            parts.push('<div class="avf-mount-head">');
            parts.push('<span class="avf-mount-name">' + this._esc(label) + '</span>');
            parts.push('<span class="avf-mount-what">'
                + (m.none ? '还没挂'
                    : (m.frame ? this._esc(m.frame.name) : '\u26a0\ufe0f 挂的框已不在清单里'))
                + '</span>');
            parts.push('</div>');
            parts.push('<div class="avf-mount-actions">');
            parts.push('<button class="avf-mini avf-pick" data-target="' + this._esc(m.target) + '">选一个</button>');
            parts.push('<button class="avf-mini avf-unmount" data-target="' + this._esc(m.target) + '"'
                + (m.none ? ' disabled' : '') + '>摘掉</button>');
            parts.push('</div>');
            parts.push('</div>');
        }
        parts.push('<div class="avf-actions">');
        parts.push('<button class="avf-btn avf-btn-primary" id="avf-save-mounts"'
            + (app.mountsDirty() ? '' : ' disabled') + '>保存挂载</button>');
        parts.push('<button class="avf-mini" id="avf-discard-mounts"'
            + (app.mountsDirty() ? '' : ' disabled') + '>放弃改动</button>');
        parts.push('</div>');
        parts.push('<div class="avf-hint">挂载点走**草稿**：改完要点「保存挂载」才写进本会话。'
            + '源对「角色设置」是暂存、对「主屏/微博」是即时写 —— 同一件事两套语义，这里统一成一套。</div>');
        parts.push('</div>');

        /* ---------- 清单 ---------- */
        parts.push('<div class="avf-stats">');
        parts.push('<div class="avf-stat-row"><span>清单总数</span><span>' + proj.stats.total + ' / ' + limits.maxFrames + '</span></div>');
        parts.push('<div class="avf-stat-row"><span>自包含图（能落地）</span><span>' + proj.stats['data-url'] + '</span></div>');
        parts.push('<div class="avf-stat-row"><span>预置框名</span><span>' + proj.stats['preset-token'] + '</span></div>');
        parts.push('<div class="avf-stat-row"><span>外链</span><span>' + proj.stats['external-url']
            + (settings.allowExternal ? '（已允许）' : '（默认不收）') + '</span></div>');
        parts.push('<div class="avf-stat-row"><span>临时 blob</span><span>' + proj.stats['blob-url'] + '</span></div>');
        parts.push('</div>');

        parts.push('<div class="avf-list">');
        parts.push('<h3 class="avf-list-title">框清单（' + frames.length + '）</h3>');
        if (!frames.length) {
            parts.push('<div class="avf-empty">还没有框。下面可以「粘贴一张」或「导清单文本」。</div>');
        } else {
            for (const f of frames) {
                const used = proj.mounts.filter((m) => m.src && m.src === f.src).map((m) => TARGET_LABEL[m.target] || m.target);
                parts.push('<div class="avf-item" data-src="' + this._esc(f.src) + '">');
                parts.push('<div class="avf-item-main">');
                parts.push('<span class="avf-item-name">' + this._esc(f.name) + '</span>');
                parts.push('<span class="avf-item-kind">' + this._esc(KIND_LABEL[f.kind] || f.kind) + '</span>');
                if (used.length) parts.push('<span class="avf-item-used">' + this._esc(used.join(' / ')) + ' 在用</span>');
                parts.push('</div>');
                parts.push('<button class="avf-mini avf-item-del" data-src="' + this._esc(f.src) + '">删</button>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 粘贴一张 ---------- */
        parts.push('<div class="avf-create">');
        parts.push('<h3 class="avf-list-title">粘贴一张</h3>');
        parts.push('<input class="avf-input" id="avf-paste-name" type="text" maxlength="' + limits.maxNameLen
            + '" placeholder="给它起个名（可留空）" value="' + this._esc(this._pasteName) + '">');
        parts.push('<textarea class="avf-input avf-textarea" id="avf-paste-src" placeholder="贴 data:image/...;base64,... 或 frame_xxx（预置框名）">'
            + this._esc(this._pasteSrc) + '</textarea>');
        parts.push('<div class="avf-actions">');
        parts.push('<button class="avf-btn avf-btn-primary" id="avf-add">加进清单</button>');
        parts.push('</div>');
        parts.push('<div class="avf-hint">认得出四种：自包含图（data:image/…）✓、预置框名（frame_xxx）✓、'
            + '外链（默认不收，可在设置里打开）、临时 blob（\u2717 重开会话就失效）。认不出的**直接拒收**，不猜。</div>');
        parts.push('</div>');

        /* ---------- 导入清单文本 ---------- */
        parts.push('<div class="avf-import">');
        parts.push('<h3 class="avf-list-title">导清单文本</h3>');
        parts.push('<textarea class="avf-input avf-textarea" id="avf-import-text" placeholder=\'把源清单贴进来，如 { id: "frame_cat_ear", url: "…", name: "1" },\'>'
            + this._esc(this._importText) + '</textarea>');
        parts.push('<div class="avf-actions">');
        parts.push('<button class="avf-btn" id="avf-import">解析并导入</button>');
        parts.push('<button class="avf-mini avf-mini-armed" id="avf-clear">清空清单</button>');
        parts.push('</div>');
        parts.push('<div class="avf-hint">源那份清单里 **id 其实是重复的**（365 条只有 123 个唯一 id），'
            + '所以本 App 按**来源**去重、也按来源认框 —— 不按 id。</div>');
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="avf-settings">');
        parts.push('<h3 class="avf-list-title">设置</h3>');
        parts.push('<label class="avf-toggle"><span>把「谁挂着什么框」交给生成侧</span>'
            + '<input type="checkbox" id="avf-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="avf-field"><span>注入时最多报几处</span>'
            + '<input type="number" id="avf-max-inject" min="0" max="20" value="' + settings.maxInjectFrames + '"></label>');
        parts.push('<label class="avf-toggle"><span>允许收外链（默认关）</span>'
            + '<input type="checkbox" id="avf-allow-ext"' + (settings.allowExternal ? ' checked' : '') + '></label>');
        parts.push('<div class="avf-hint">换角色 / 换会话后，这份框清单和上一个角色的是分开的两份。'
            + '本 App 只做本会话的框账：不生成图、不请求网络、不碰聊天记录。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        /* 选一个框 —— 用清单里的项直接挂（不弹第二个面板；选哪一项由清单决定） */
        for (const btn of this._root.querySelectorAll('.avf-pick')) {
            btn.addEventListener('click', () => {
                const target = btn.dataset.target;
                const first = app.framesList()[0];
                if (!first) { this._flash = '清单是空的，先加一张框'; this.refresh(); return; }
                /* 轮转：每次点「选一个」就换到清单里的下一张（面板里能看见挂的是哪一张） */
                const cur = (app.projection() || { mounts: [] }).mounts.find((m) => m.target === target);
                const list = app.framesList();
                const idx = cur && cur.src ? list.findIndex((f) => f.src === cur.src) : -1;
                const next = list[(idx + 1) % list.length];
                const r = app.draftMount(target, next.src);
                this._flash = r.ok ? '' : r.error;
                this.refresh();
            });
        }

        for (const btn of this._root.querySelectorAll('.avf-unmount')) {
            btn.addEventListener('click', () => {
                const r = app.draftMount(btn.dataset.target, '');
                this._flash = r.ok ? '' : r.error;
                this.refresh();
            });
        }

        const saveMounts = q('#avf-save-mounts');
        if (saveMounts) saveMounts.addEventListener('click', () => {
            const ok = app.saveMounts();
            app.mountsDirty();
            this.refresh();
            this._flash = ok ? '' : '没有改动可保存';
            this.refresh();
        });

        const disc = q('#avf-discard-mounts');
        if (disc) disc.addEventListener('click', () => {
            app.discardMounts();
            this._flash = '已放弃未保存的改动';
            this.refresh();
        });

        /* 粘贴一张 */
        const pn = q('#avf-paste-name');
        if (pn) pn.addEventListener('input', () => { this._pasteName = pn.value; });
        const ps = q('#avf-paste-src');
        if (ps) ps.addEventListener('input', () => { this._pasteSrc = ps.value; });
        const add = q('#avf-add');
        if (add) add.addEventListener('click', () => {
            const r = app.addFrame({ name: String(this._pasteName || '').trim(), src: String(this._pasteSrc || '').trim() });
            if (!r.ok) { this._flash = r.error || '没加进去'; this.refresh(); return; }
            this._pasteSrc = '';
            this._pasteName = '';
            this._flash = '加好了';
            this.refresh();
        });

        /* 导入清单 */
        const it = q('#avf-import-text');
        if (it) it.addEventListener('input', () => { this._importText = it.value; });
        const imp = q('#avf-import');
        if (imp) imp.addEventListener('click', () => {
            const r = app.importPreset(String(this._importText || ''));
            if (!r.ok) { this._flash = r.error || '没导入'; this.refresh(); return; }
            const bits = ['导入 ' + r.added + ' 条'];
            if (r.dropped) bits.push('去重丢掉 ' + r.dropped);
            if (r.rejected) bits.push('拒收 ' + r.rejected);
            if (r.malformed) bits.push('没认出 ' + r.malformed);
            this._flash = bits.join(' · ');
            this.refresh();
        });

        const clr = q('#avf-clear');
        if (clr) clr.addEventListener('click', () => {
            if (this._needConfirm('avf-clear', clr)) return;
            const n = app.clearFrames();
            this._flash = '清掉了 ' + n + ' 张';
            this.refresh();
        });

        /* 删一张（按 src；正挂着会连挂载点一起摘） */
        for (const btn of this._root.querySelectorAll('.avf-item-del')) {
            btn.addEventListener('click', () => {
                const r = app.removeFrame(btn.dataset.src);
                this._flash = r.ok ? ('删掉 ' + r.removed + (r.unmounted ? '（顺带把指着它的挂载点一起摘了）' : '')) : '没删掉';
                this.refresh();
            });
        }

        /* 设置 */
        const inj = q('#avf-inject');
        if (inj) inj.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const mi = q('#avf-max-inject');
        if (mi) mi.addEventListener('change', (e) => app.patchSettings({ maxInjectFrames: e.target.value }));
        const ae = q('#avf-allow-ext');
        if (ae) ae.addEventListener('change', (e) => {
            app.patchSettings({ allowExternal: e.target.checked });
            this._flash = e.target.checked ? '外链已允许（仍然只收清单里已存在的）' : '外链已关闭';
            this.refresh();
        });
    }

    /** 两步确认（清空清单不可逆，本仓不弹宿主 confirm）。 */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '再点一次确认清空'; btn.classList.add('avf-mini-armed'); }
        return true;
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}