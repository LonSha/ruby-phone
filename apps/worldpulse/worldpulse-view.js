/* ========================================================
 * worldpulse-view.js — 世界脉搏视图（开关/风格/阈值/手动脉冲/历史流）
 * ======================================================== */
'use strict';
import { WP_STYLES } from './worldpulse-engine.js';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'"');
}
const STYLE_ICON = { '都市日常':'🏙️', '财经头条':'📈', '娱乐八卦':'🍉', '科幻未来':'🚀', '悬疑异闻':'🕵️', '自定义':'✍️' };

export class WorldpulseView {
    constructor(app) { this.app = app; }

    render() {
        if (!this.app.phoneShell?.setContent) return;
        this.app.phoneShell.setContent(this._css() + this._layout(), 'worldpulse-main');
        this._bind();
    }

    _layout() {
        const s = this.app.getSettings();
        const history = this.app.getHistory().slice().reverse();  // 新→旧
        const st = this.app.getState();
        return `<div class="wp-wrap">
          <div class="wp-hero">
            <div class="wp-hero-title">🌍 世界脉搏</div>
            <div class="wp-hero-sub">主线之外，这个世界仍在运转 · ${history.length} 条动态</div>
          </div>

          <div class="wp-card">
            <div class="wp-row">
              <span class="wp-label">自动脉搏</span>
              <button class="wp-switch ${s.enabled?'on':''}" id="wp-toggle">${s.enabled?'开':'关'}</button>
            </div>
            <div class="wp-row">
              <span class="wp-label">风格</span>
              <div class="wp-styles">${Object.keys(WP_STYLES).map(k=>
                `<button class="wp-style ${s.style===k?'on':''}" data-style="${k}">${STYLE_ICON[k]||''} ${k}</button>`).join('')}</div>
            </div>
            ${s.style==='自定义' ? `<div class="wp-row"><input class="wp-input" id="wp-custom" placeholder="自定义生成指令前缀…" value="${esc(s.customPrefix)}"></div>` : ''}
            <div class="wp-row">
              <span class="wp-label">每 ${s.threshold} 楼一次</span>
              <input type="range" class="wp-range" id="wp-threshold" min="1" max="20" value="${s.threshold}">
            </div>
            <div class="wp-row wp-queue">队列 ${st.queue.length} · 已处理至第 ${st.lastFloorCount} 楼</div>
            <div class="wp-row wp-actions">
              <button class="wp-btn" id="wp-manual">⚡ 立即脉冲一次</button>
              <button class="wp-btn wp-btn-ghost" id="wp-clear">清空历史</button>
            </div>
          </div>

          <div class="wp-feed">
            ${history.length === 0
              ? `<div class="wp-empty"><div class="wp-empty-icon">🌍</div><div>还没有世界动态</div><div class="wp-empty-sub">开启自动脉搏，或点「立即脉冲一次」让世界呼吸</div></div>`
              : history.map(e=>`
                <div class="wp-item">
                  <div class="wp-item-head"><span class="wp-item-style">${STYLE_ICON[e.style]||'🌍'} ${esc(e.style)}</span><span class="wp-item-time">第${e.floorCount}楼</span></div>
                  <div class="wp-item-text">${esc(e.content)}</div>
                </div>`).join('')}
          </div>
        </div>`;
    }

    _bind() {
        const $ = id => document.getElementById(id);
        const rerender = () => this.render();
        $('wp-toggle')?.addEventListener('click', () => {
            const s = this.app.getSettings();
            this.app.saveSettings({ enabled: !s.enabled, autoGenerate: !s.enabled });
            if (!s.enabled) this.app.startListening(); else this.app.stopListening();
            rerender();
        });
        document.querySelectorAll('.wp-style').forEach(b => b.addEventListener('click', () => {
            this.app.saveSettings({ style: b.dataset.style }); rerender();
        }));
        $('wp-custom')?.addEventListener('change', e => this.app.saveSettings({ customPrefix: e.target.value }));
        $('wp-threshold')?.addEventListener('change', e => { this.app.saveSettings({ threshold: Number(e.target.value) }); rerender(); });
        $('wp-manual')?.addEventListener('click', async e => {
            e.target.disabled = true; e.target.textContent = '⏳ 生成中…';
            await this.app.manualPulse();
            rerender();
        });
        $('wp-clear')?.addEventListener('click', () => { if (confirm('清空全部世界动态历史？')) { this.app.clearHistory(); rerender(); } });
    }

    _css() {
        return `<style>
.wp-wrap{padding:14px;background:#0d1117;min-height:100%;color:#e6edf3;font-family:inherit;}
.wp-hero{padding:14px 4px 10px;}
.wp-hero-title{font-size:22px;font-weight:800;letter-spacing:1px;}
.wp-hero-sub{font-size:12px;color:#8b949e;margin-top:4px;}
.wp-card{background:#161b22;border:1px solid #21262d;border-radius:14px;padding:12px;margin-bottom:14px;}
.wp-row{margin-bottom:12px;}
.wp-row:last-child{margin-bottom:0;}
.wp-label{font-size:13px;font-weight:700;color:#c9d1d9;display:block;margin-bottom:8px;}
.wp-switch{background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:20px;padding:5px 16px;font-size:12px;cursor:pointer;}
.wp-switch.on{background:#1f6feb;border-color:#1f6feb;color:#fff;}
.wp-styles{display:flex;flex-wrap:wrap;gap:6px;}
.wp-style{background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;}
.wp-style.on{background:#1f6feb22;border-color:#1f6feb;color:#79c0ff;}
.wp-input{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:8px;font-size:13px;box-sizing:border-box;}
.wp-range{width:100%;}
.wp-queue{font-size:11px;color:#6e7681;}
.wp-actions{display:flex;gap:8px;}
.wp-btn{flex:1;background:#238636;border:none;color:#fff;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;}
.wp-btn:disabled{opacity:0.6;cursor:default;}
.wp-btn-ghost{background:#21262d;border:1px solid #30363d;color:#c9d1d9;flex:0 0 auto;}
.wp-feed{display:flex;flex-direction:column;gap:10px;}
.wp-item{background:#161b22;border:1px solid #21262d;border-left:3px solid #1f6feb;border-radius:10px;padding:10px 12px;}
.wp-item-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.wp-item-style{font-size:11px;font-weight:700;color:#79c0ff;}
.wp-item-time{font-size:10px;color:#6e7681;}
.wp-item-text{font-size:13px;line-height:1.6;color:#c9d1d9;}
.wp-empty{text-align:center;padding:50px 20px;color:#8b949e;}
.wp-empty-icon{font-size:40px;margin-bottom:10px;}
.wp-empty-sub{font-size:12px;color:#6e7681;margin-top:8px;line-height:1.7;}
</style>`;
    }
}

export default WorldpulseView;