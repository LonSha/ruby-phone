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
// [v2.32.0] 回收口径卡：控制中心此前**完全没有**运行时诊断入口（诊断只能靠控制台）。
//   本版把「回收了几次、其中几次过早」这两本账并列显示在手机上 —— 它们此前分属
//   两个 Map（childRuntimeReleaseLog / childRuntimePrematureLog），任何一本单独看
//   都回答不了这个问题。只读这两本账，不新增状态、不触发任何回收。
import { childRuntimeReleaseLog, childRuntimePrematureLog, childRuntimePrematureBy } from '../config/runtime-lifecycle.js';

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
        // [v2.31.0] 陈旧实例护栏：面板重建会让宿主指针改指新实例，而**旧实例仍可达**
        //   （闭包、事件回调、外部持有的引用都还握着它）。此时若有人在旧实例上
        //   toggle()/show()，它会用自己的 phoneShell 把 overlay 挂进**已被摘除的旧容器**
        //   —— 用户看到的是「控制器没反应」，而对象图里多出一个谁也不认领的 overlay。
        //   注意守卫必须落在 show()（唯一能造出界面的入口），只守 close() 等于没守。
        this._disposed = false;
    }

    isOpen() { return this.open; }

    toggle() { if (this._disposed) return; if (this.open) this.close(); else this.show(); }

    show() {
        // [v2.31.0] 已销毁实例不得再挂界面。容器可能已被重建（host 存在），
        //   挂上去就会出现两个控制中心面板，且旧实例的 toggle 与新实例互相看不见对方。
        if (this._disposed) return;
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
                ${this._releaseHtml()}
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
        // [v2.31.0] 已销毁的实例不得再操作界面：close 本身幂等，早退只是省掉一次
        //   无意义的 DOM 查询，同时让「陈旧实例还活着」这件事不至于静默成真。
        if (this._disposed) { this._root = null; this.open = false; return; }
        this._root?.remove();
        this._root = null;
        this.open = false;
    }
    /**
     * [v2.31.0] 实例销毁：宿主丢弃本实例时调用。
     * 控制中心没有全局监听器（界面内监听器随 overlay 摘除自然回收，故不登记），
     * 需要收的只有「界面本身」与「实例可用性标记」。
     */
    dispose() {
        this._disposed = true;
        try { this._root?.remove(); } catch (_e) { /* 忽略 */ }
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

    /**
     * [v2.32.0] 回收口径卡：把两本账**合起来读**。
     * 口径（与 runtimeStats().releaseVerdict 同源，纯读不写）：
     *   · 全部域名都没过早回收 → 「N 个域名被回收过 · 无过早回收」；
     *   · 有过早 → 列出前三项，标黄，并给出「回收 N 次 / 其中过早 M 次」。
     * 读取失败一律降级为一行提示，绝不抛（控制中心任何一块坏掉都不该拖垮整个面板）。
     */
    _releaseHtml() {
        let names = {}, pre = {}, by = {};
        try { names = childRuntimeReleaseLog('') || {}; } catch (_e) { names = {}; }
        try { pre = childRuntimePrematureLog('') || {}; } catch (_e) { pre = {}; }
        try { by = childRuntimePrematureBy('') || {}; } catch (_e) { by = {}; }
        const released = Object.keys(names).length;
        const rows = Object.entries(pre).filter(([, v]) => Number(v) > 0)
            .map(([n, v]) => {
                const causes = (by[n] && typeof by[n] === 'object') ? { ...by[n] } : {};
                // [v2.33.0] 「提前回收」= 宿主主动收掉还在用的实例的域（host-*）。
                //   实例自持出口（tidy）是界面正常退出时的自我注销，不是缺陷。
                const hostile = Object.entries(causes)
                    .filter(([k]) => k.startsWith('host-'))
                    .reduce((s2, [, x]) => s2 + Number(x || 0), 0);
                return { name: n, premature: Number(v), releases: Number(names[n] || 0), causes, hostile };
            })
            .sort((a, b) => b.hostile - a.hostile || b.premature - a.premature || a.name.localeCompare(b.name));
        // [v2.33.0] 读数诚实化：把「笔数」拆成「成因」再下结论。
        //   此前本卡片写作「无过早回收 / N 个域名过早回收」+「全部发生在实例销毁后」，
        //   而实测 honey-view 这类**界面内正常返回**的闲置出口同样计入过早回收
        //   （exitHoneySurface 的 9 个调用点里 6 个是页面返回/回首页）——
        //   于是健康装机上「有过早回收」恒成立，这句话恒为假：它把正常导航说成
        //   「过早」，又断言「全部发生在实例销毁后」。没有按成因分开读，这本账
        //   在正常用法下**永远非零**，读者只能学会忽略它（遥测一旦噪声化，
        //   真正该看的宿主提前回收就被淹没）。现在：宿主造成的才计缺陷，
        //   自持出口归为正常回收 —— 「有缺陷时告警、没缺陷时安静」才成立。
        const flaws = rows.filter(r => r.hostile > 0);
        const tidyOnly = rows.filter(r => r.hostile === 0);
        const clean = rows.length === 0;
        const head = `<div class="sys-cc-scale-head"><span>回收口径</span><span>${clean ? '无过早回收'
            : (flaws.length ? flaws.length + ' 个域名被提前回收' : '无提前回收')}</span></div>`;
        const body = clean
            ? `<div class="sys-cc-rel-line">${released} 个域名被回收过 · 全部发生在实例销毁后</div>`
            : (flaws.length
                ? flaws.slice(0, 3).map(r =>
                    `<div class="sys-cc-rel-line sys-cc-rel-warn">${_esc(r.name)} 回收 ${r.releases} 次 · 其中提前回收 ${r.hostile} 次</div>`
                ).join('')
                : `<div class="sys-cc-rel-line">${released} 个域名被回收过 · ${tidyOnly.length} 个为界面退出时自持回收（正常）</div>`);
        const more = flaws.length > 3 ? `<div class="sys-cc-rel-line">…另有 ${flaws.length - 3} 个域名</div>` : '';
        return `<div class="sys-cc-scale sys-cc-releases" data-release-tally="${flaws.length ? 'premature' : 'clean'}">${head}${body}${more}</div>`;
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