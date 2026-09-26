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

          ${this._bridgeCard()}
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

    /**
     * [v2.36.0] 跨插件世界桥卡片：把「桥通不通、通到哪一步、两个钟差多少」摆给用户看。
     *
     * 为什么需要它：本 App 的平行事件要么陈述真世界、要么退回 LLM 现编，而这个**分岔**
     *   此前在界面上完全看不见——用户只看到「又是编的」，看不到原因（桥没装？桥没开？
     *   对方引擎没就绪？两个钟对不上？）。可观测面就是把这段话摆出来。
     * 只读：只调 app.bridgeStatus()（其内部只调两个桥的读取面），不写任何状态。
     */
    _bridgeCard() {
        let st = null;
        try { st = this.app.bridgeStatus(); } catch (_e) { st = null; }
        const br = st && st.bridges ? st.bridges : null;
        if (!br) {
            return `<div class="wp-card wp-bridge"><div class="wp-label">跨插件世界桥</div>
              <div class="wp-bridge-line wp-bridge-off">可观测面不可用（读取失败，已降级）</div></div>`;
        }
        const WA_TXT = {
            'not-mounted': 'WorldAxis 未安装', 'disabled': '世界桥休眠（未开闸）',
            'refused': '世界桥拒绝读取', 'no-snapshot': '桥在但尚无快照',
            'ready': '就绪', 'probe-threw': '探针异常'
        };
        const LO_TXT = {
            'not-mounted': 'LonSha 未安装', 'ready': '就绪',
            'engine-absent': '插件在但引擎未就位', 'engine-empty': '引擎在位但返回空',
            'thrown': '取快照抛错', 'no-snapshot': '桥在但尚未产出快照',
            'probe-threw': '探针异常'
        };
        // [v2.37.0] 优先用 bridgeReport() 的条目（worldBridgeAvailability 只报在场，没有读取结果）；
        const rep = (st && st.report) || null;
        const wi = (rep && rep.worldaxis) || br.worldaxis || {}, lo = (rep && rep.lonsha) || br.lonsha || {};
        const waRead = wi.read || null, loRead = lo.read || null;
        // 「来源态说就绪、这一次却拉不到」也算读不到——不能只看 reason。
        const bad = (wi.reason === 'refused' || wi.reason === 'no-snapshot' || lo.reason === 'thrown' || lo.reason === 'engine-empty'
            || (wi.reason === 'ready' && waRead && waRead.ok === false)
            || (lo.reason === 'ready' && loRead && loRead.ok === false));
        /* [v3.5.0] F-2 来源侧：桥卡片再答一个问题 —— 「记忆侧的事件是谁记的」。
         * 与前两块并列的第三个问题：不是「世界现在什么样」，而是「这条线是插件从正文提的、
         * 还是手机 App 里发生的」——跨平台对照的事实前提。
         * 四态文案直接取真源给出的 line，**视图不重判形态**（真源已把
         * bridge-absent / face-absent / empty / ok 分好）；缺席时如实带出，不写「0 个平台」。
         */
        let epHtml = '';
        if (st && st.eventPlatforms) {
            const ep = st.eventPlatforms;
            /* 三态各有各的色：ok 绿 / empty 中性（真读数，不是故障）/ 其余（缺席、读不出）按故障色。 */
            const cls = ep.state === 'ok' ? ' wp-bridge-ok' : (ep.state === 'empty' ? '' : ' wp-bridge-off');
            const plats = (ep.state === 'ok' && Array.isArray(ep.platforms) && ep.platforms.length)
                ? `<div class="wp-bridge-hint">被标过的平台：${ep.platforms.map(p => esc(p)).join(' · ')}`
                  + `（标签由登记方显式给出、不猜归类、不排重要性）</div>`
                : '';
            epHtml = `<div class="wp-bridge-line${cls}">${esc(ep.line || '')}</div>` + plats;
        } else if (st) {
            epHtml = `<div class="wp-bridge-line wp-bridge-off">事件来源：读取失败</div>`;
        }
        return `<div class="wp-card wp-bridge">
            <div class="wp-label">跨插件世界桥</div>
            <div class="wp-bridge-line ${wi.mounted ? (wi.reason === 'ready' ? 'wp-bridge-ok' : 'wp-bridge-warn') : 'wp-bridge-off'}">
              WorldAxis：${esc(WA_TXT[wi.reason] || wi.reason || '未知')}${wi.reason === 'ready' && waRead && waRead.ok === false ? '（实际拉取失败：' + esc(waRead.reason || 'unknown') + '）' : ''}</div>
            <div class="wp-bridge-line ${lo.mounted ? (lo.reason === 'ready' ? 'wp-bridge-ok' : 'wp-bridge-warn') : 'wp-bridge-off'}">
              LonSha：${esc(LO_TXT[lo.reason] || lo.reason || '未知')}${lo.reason === 'ready' && loRead && loRead.ok === false ? '（实际拉取失败：' + esc(loRead.reason || 'unknown') + '）' : ''}</div>
            ${bad ? `<div class="wp-bridge-line wp-bridge-warn">读不到时本 App 会退回 LLM 生成——两个世界就此对不上</div>` : ''}
            ${rep && rep.consistent === false ? `<div class="wp-bridge-line wp-bridge-warn">来源态与实际读取不一致：桥自述可用、这一次却拉不到——按「实际读取失败」处置</div>` : ''}
            ${rep && rep.summary ? `<div class="wp-bridge-hint">${esc(rep.summary)}</div>` : ''}
            ${epHtml}
            <div class="wp-bridge-hint">真世界可用时，平行事件陈述真事件、不调 LLM；桥休眠时退回生成（不编数据顶替真世界）。
              「未安装」与「装了没开」是两件事——后者去 WorldAxis 面板开闸即可。</div>
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
.wp-bridge .wp-label{margin-bottom:6px;}
.wp-bridge-line{font-size:12px;line-height:1.9;color:#8b949e;}
.wp-bridge-ok{color:#3fb950;}
.wp-bridge-warn{color:#d29922;}
.wp-bridge-off{color:#6e7681;}
.wp-bridge-hint{font-size:11px;color:#6e7681;margin-top:6px;line-height:1.7;}
</style>`;
    }
}

export default WorldpulseView;