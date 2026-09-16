/**
 * 控制中心 [v2.16.0 原创]
 * 从手机顶部状态栏区域**向下滑动**呼出（与轻点药丸锁屏不冲突：点按无位移）。
 *
 * 提供真实可控项（全部落到既有能力，不做纯装饰）：
 *   - 免打扰：开启后通知只入通知中心、不弹横幅（消息不丢，只是不打断）
 *   - 显示缩放：80–120%，复用设置页同一套 --phone-shell-* 缩放
 *   - Wi-Fi：联动状态栏图标
 *   - 手电筒：手机壳暖光晕
 *   - 立即锁屏：真实调 PhoneShell 锁屏
 *   - 音乐：真实联动 MusicApp（播放/暂停、上一首、下一首）
 *
 * 状态键一律 sys_*（随会话隔离，见 config/system-controls.js）。
 */

import {
    SYS_KEYS, SCALE_MIN, SCALE_MAX,
    readFlag, writeFlag,
    isDndOn, isFlashlightOn, isWifiOn, readShellScale, applyShellScale,
    applyWifiIndicator, applyFlashlightVisual, lockNow,
    musicControl, currentTrack
} from '../config/system-controls.js';

function _esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\u0022/g, '&quot;').replace(/'/g, '&#39;');
}

export class ControlCenter {
    /**
     * @param {object} phoneShell PhoneShell 实例
     * @param {object} storage PhoneStorage 实例
     */
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this._root = null;
        this.open = false;
    }

    isOpen() { return this.open; }

    toggle() { if (this.open) this.close(); else this.show(); }

    show() {
        const host = this.phoneShell?.container;
        if (!host) return;
        this._root?.remove();
        const root = document.createElement('div');
        root.className = 'sys-cc-overlay';
        root.innerHTML = `<div class="sys-cc-backdrop" data-sys-cc-close="1"></div>
            <div class="sys-cc-panel" role="dialog" aria-label="控制中心">
                <div class="sys-cc-grip"></div>
                <div class="sys-cc-title">控制中心</div>
                ${this._togglesHtml()}
                ${this._musicHtml()}
                ${this._scaleHtml()}
                <button class="sys-cc-action sys-cc-lock" id="sys-cc-lock">
                    <i class="fa-solid fa-lock"></i><span>立即锁屏</span>
                </button>
                <div class="sys-cc-hint">向下拖动状态栏可再次呼出 · 轻点空白处关闭</div>
            </div>`;
        host.appendChild(root);
        this._root = root;
        this.open = true;
        this._bind();
    }

    close() {
        this._root?.remove();
        this._root = null;
        this.open = false;
    }

    // ---------------- 片段 ----------------

    _togglesHtml() {
        const dnd = isDndOn(this.storage);
        const wifi = isWifiOn(this.storage);
        const torch = isFlashlightOn(this.storage);
        const tile = (id, icon, label, on, tone) => `
            <button class="sys-cc-tile${on ? ' sys-cc-on' : ''}" id="${id}" data-on="${on ? '1' : '0'}"${tone ? ` style="--cc-tone:${tone}"` : ''}>
                <i class="${icon}"></i><span>${label}</span>
                <em class="sys-cc-state">${on ? '开' : '关'}</em>
            </button>`;
        return `<div class="sys-cc-grid">
            ${tile('sys-cc-dnd', 'fa-solid fa-moon', '免打扰', dnd, '#6c5ce7')}
            ${tile('sys-cc-wifi', 'fa-solid fa-wifi', 'Wi-Fi', wifi, '#0984e3')}
            ${tile('sys-cc-torch', 'fa-solid fa-lightbulb', '手电筒', torch, '#fdcb6e')}
        </div>`;
    }

    _musicHtml() {
        const t = currentTrack();
        const title = t ? _esc(t.title) : '未在播放';
        const artist = t && t.artist ? _esc(t.artist) : '';
        const playing = !!(t && t.playing);
        return `<div class="sys-cc-music">
            <div class="sys-cc-music-info">
                <span class="sys-cc-music-icon">🎵</span>
                <span class="sys-cc-music-text">
                    <span class="sys-cc-music-title">${title}</span>
                    ${artist ? `<span class="sys-cc-music-artist">${artist}</span>` : ''}
                </span>
            </div>
            <div class="sys-cc-music-ctrl">
                <button id="sys-cc-prev" title="上一首"><i class="fa-solid fa-backward-step"></i></button>
                <button id="sys-cc-play" class="sys-cc-play" title="${playing ? '暂停' : '播放'}"><i class="fa-solid ${playing ? 'fa-pause' : 'fa-play'}"></i></button>
                <button id="sys-cc-next" title="下一首"><i class="fa-solid fa-forward-step"></i></button>
            </div>
        </div>`;
    }

    _scaleHtml() {
        const pct = readShellScale(this.storage);
        return `<div class="sys-cc-scale">
            <div class="sys-cc-scale-head"><span>显示缩放</span><span id="sys-cc-scale-val">${pct}%</span></div>
            <input type="range" id="sys-cc-scale" min="${SCALE_MIN}" max="${SCALE_MAX}" step="1" value="${pct}" />
        </div>`;
    }

    // ---------------- 交互 ----------------

    _bind() {
        const root = this._root;
        if (!root) return;
        root.querySelector('[data-sys-cc-close]')?.addEventListener('click', () => this.close());

        // 免打扰
        root.querySelector('#sys-cc-dnd')?.addEventListener('click', (e) => this._flip(e.currentTarget, SYS_KEYS.DND));
        // Wi-Fi（联动状态栏）
        root.querySelector('#sys-cc-wifi')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const next = btn.dataset.on !== '1';
            writeFlag(this.storage, SYS_KEYS.WIFI, next);
            applyWifiIndicator(next);
            this._paintTile(btn, next);
        });
        // 手电筒
        root.querySelector('#sys-cc-torch')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const next = btn.dataset.on !== '1';
            writeFlag(this.storage, SYS_KEYS.FLASHLIGHT, next);
            applyFlashlightVisual(next);
            this._paintTile(btn, next);
        });
        // 锁屏
        root.querySelector('#sys-cc-lock')?.addEventListener('click', () => {
            this.close();
            lockNow(this.phoneShell);
        });
        // 音乐
        root.querySelector('#sys-cc-prev')?.addEventListener('click', () => { musicControl('prev'); this._refreshMusic(); });
        root.querySelector('#sys-cc-next')?.addEventListener('click', () => { musicControl('next'); this._refreshMusic(); });
        root.querySelector('#sys-cc-play')?.addEventListener('click', () => { musicControl('toggle'); this._refreshMusic(); });
        // 缩放
        const slider = root.querySelector('#sys-cc-scale');
        slider?.addEventListener('input', (e) => {
            const pct = Number(e.target?.value) || 100;
            const label = root.querySelector('#sys-cc-scale-val');
            if (label) label.textContent = pct + '%';
        });
        slider?.addEventListener('change', (e) => {
            const pct = Number(e.target?.value) || 100;
            applyShellScale(this.storage, pct);
        });
    }

    _flip(btn, key) {
        const next = btn?.dataset?.on !== '1';
        writeFlag(this.storage, key, next);
        this._paintTile(btn, next);
    }

    _paintTile(btn, on) {
        if (!btn) return;
        btn.classList.toggle('sys-cc-on', !!on);
        btn.dataset.on = on ? '1' : '0';
        const state = btn.querySelector('.sys-cc-state');
        if (state) state.textContent = on ? '开' : '关';
    }

    /** 重绘音乐卡（曲目可能已切歌） */
    _refreshMusic() {
        const box = this._root?.querySelector('.sys-cc-music');
        if (box) box.outerHTML = this._musicHtml();
        this._bind();
    }

    /** 供外部同步开关外观（如设置页改了缩放/开关） */
    syncFromStorage() {
        if (!this._root) return;
        const root = this._root;
        const dnd = root.querySelector('#sys-cc-dnd');
        if (dnd) this._paintTile(dnd, isDndOn(this.storage));
        const wifi = root.querySelector('#sys-cc-wifi');
        if (wifi) this._paintTile(wifi, isWifiOn(this.storage));
        const torch = root.querySelector('#sys-cc-torch');
        if (torch) this._paintTile(torch, isFlashlightOn(this.storage));
        const slider = root.querySelector('#sys-cc-scale');
        if (slider) slider.value = String(readShellScale(this.storage));
    }
}

export default ControlCenter;