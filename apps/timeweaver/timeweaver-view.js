/* ========================================================
 * timeweaver-view.js — 织光机视图（生活流时间线 + 里程碑 + 情感曲线 + 亲密度榜 + 年度信）
 * ======================================================== */
'use strict';
import { buildNarrative } from './timeweaver-collector.js';
// [v3.0.2] R2-C：注入读数（送达侧）的文案出口。刻意**不在视图里拼结论** ——
//   本仓反复踩到「视图自己兜底推出一个结论」，于是不同面给出互相矛盾的说法。
import { injectionLine, blockLine } from '../../config/injection-contract.js';
// [v3.5.0] F-2 下游侧：来源构成的一行读数取自桥真源（本文件不拼口径，只渲染）
import { eventPlatformsLine } from '../../config/world-bridge.js';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'"');
}
const SRC_ICON = { diary:'📔', album:'🖼️', achievement:'🏆', calendar:'📅', weibo:'💬', honey:'🍯', theater:'🎭', life:'✨', chat:'💬', misc:'✨', unknown:'✨' };

export class TimeweaverView {
    constructor(app) { this.app = app; this._tab = 'letter'; }

    render() {
        if (!this.app.phoneShell?.setContent) return;
        const model = buildNarrative(this.app.storage, { bucket: 'day' });
        const html = model.empty ? this._empty() : this._layout(model);
        this.app.phoneShell.setContent(this._css() + html, 'timeweaver-main');
        this._bind();
    }

    _empty() {
        return `<div class="tw-wrap"><div class="tw-empty">
          <div class="tw-empty-icon">🕰️</div>
          <div class="tw-empty-title">织光机还没有可织的碎片</div>
          <div class="tw-empty-sub">去写写日记、拍张照片、聊聊蜜语、解锁成就……<br>当生活散落足够的碎片，这里会为你织出一部可回望的时光。</div>
        </div></div>`;
    }

    _layout(m) {
        return `<div class="tw-wrap">
          <div class="tw-hero">
            <div class="tw-hero-title">🕰️ 织光机</div>
            <div class="tw-hero-sub">${m.events.length} 个碎片 · ${new Set(m.events.map(e=>e.source)).size} 个来源 · 已织成你的时光</div>
          </div>
          <div class="tw-tabs">
            ${[['letter','💌 叙事信'],['timeline','🧵 生活流'],['mile','🌱 里程碑'],['board','❤️ 亲密度'],['recall','🔁 回望'],['album','📚 收藏册']].map(([k,l])=>
              `<button class="tw-tab ${this._tab===k?'on':''}" data-tab="${k}">${l}</button>`).join('')}
          </div>
          <div class="tw-body">${this._panel(m)}</div>
        </div>`;
    }

    _panel(m) {
        if (this._tab === 'timeline') return this._timeline(m);
        if (this._tab === 'mile') return this._milestones(m);
        if (this._tab === 'board') return this._board(m);
        if (this._tab === 'recall') return this._recall(m);
        if (this._tab === 'album') return this._album(m);
        return this._letter(m);
    }

    _letter(m) {
        const L = m.letter;
        if (!L) return '<div class="tw-hint">碎片还太少，织不出一封完整的信。</div>';
        const ai = this.app.aiLetter || null;
        const moodColor = L.stats.avgMood > 0.2 ? '#4ade80' : L.stats.avgMood < -0.2 ? '#f87171' : '#58a6ff';
        // [v2.14.0] AI 升华层：有 AI 信优先渲染，本地规则版作离线/降级兜底
        const letterBody = (ai && ai.paragraphs && ai.paragraphs.length)
            ? `<div class="tw-letter-title">✨ 一封被 AI 织起的时光信</div>
               ${ai.paragraphs.map(p => `<p class="tw-letter-p">${esc(p)}</p>`).join('')}
               <div class="tw-letter-stats"><span class="tw-chip" style="color:#e8a33d">AI 升华 · 本地规则版可导出</span></div>`
            : `<div class="tw-letter-title">${esc(L.title)}</div>
               ${L.paragraphs.map(p => `<p class="tw-letter-p">${esc(p)}</p>`).join('')}
               <div class="tw-letter-stats">
                 <span class="tw-chip" style="color:${moodColor}">情绪 ${L.stats.avgMood>=0?'+':''}${L.stats.avgMood.toFixed(2)}</span>
                 ${L.stats.topPerson?`<span class="tw-chip">❤️ ${esc(L.stats.topPerson)}</span>`:''}
                 <span class="tw-chip">${L.stats.firsts} 个第一次</span>
               </div>`;
        const aiBtn = ai && ai.loading
            ? '<button class="tw-export" disabled>✨ AI 升华中…</button>'
            : '<button class="tw-export" id="tw-ai">✨ 求 AI 升华这封信</button>';
        const saveBtn = ai && ai.loading
            ? ''
            : '<button class="tw-export" id="tw-save" style="background:#3d2f1e;color:#e8a33d">📚 收藏这封信</button>';
        const shareBtn = ai && ai.loading
            ? ''
            : '<button class="tw-export" id="tw-share" style="background:#2b3a2b;color:#8fd48f">📤 分享到朋友圈</button>';
        const aiErr = (ai && ai.error) ? `<div class="tw-hint" style="color:#f87171">${esc(ai.error)}</div>` : '';
        return `
        <div class="tw-curve">${this._curve(m)}</div>
        <div class="tw-letter">
          ${letterBody}
        </div>
        ${aiErr}
        <div class="tw-actions">
          ${aiBtn}
          ${saveBtn}
          ${shareBtn}
          <button class="tw-export" id="tw-export">⬇ 导出本地规则版</button>
        </div>`;
    }

    _curve(m) {
        if (!m.curve || !m.curve.length) return '';
        const pts = m.curve.slice(-30);
        const bars = pts.map(p => {
            const h = Math.max(6, Math.round((p.mood + 1) / 2 * 44));
            const col = p.mood > 0.15 ? '#4ade80' : p.mood < -0.15 ? '#f87171' : '#58a6ff';
            return `<div class="tw-curve-bar" title="${esc(p.label)}" style="height:${h}px;background:${col}"></div>`;
        }).join('');
        return `<div class="tw-curve-label">生活情绪曲线（近 ${pts.length} 拍 · 绿=上扬/红=下沉/蓝=平静）</div><div class="tw-curve-track">${bars}</div>`;
    }

    _timeline(m) {
        return m.timeline.map(b => `
          <div class="tw-day">
            <div class="tw-day-head"><span class="tw-day-label">${esc(b.label)}</span>
              <span class="tw-day-mood ${b.avgMood>0.2?'pos':b.avgMood<-0.2?'neg':''}">${b.avgMood>0.2?'☀️':b.avgMood<-0.2?'🌧':'⛅'}</span></div>
            ${b.events.map(e => `<div class="tw-ev">
              <span class="tw-ev-icon">${SRC_ICON[e.source]||'✨'}</span>
              <div class="tw-ev-main"><div class="tw-ev-title">${esc(e.title)}</div>
              ${e.body?`<div class="tw-ev-body">${esc(e.body.slice(0,80))}</div>`:''}</div>
              ${e.actors.length?`<span class="tw-ev-actor">${esc(e.actors[0])}</span>`:''}
            </div>`).join('')}
          </div>`).join('');
    }

    _milestones(m) {
        if (!m.milestones.length) return '<div class="tw-hint">还没有里程碑。第一次总是值得期待。</div>';
        return m.milestones.map(x => `
          <div class="tw-mile">
            <span class="tw-mile-icon">${x.icon}</span>
            <div><div class="tw-mile-label">${esc(x.label)}</div>
            <div class="tw-mile-detail">${esc(x.detail)}</div></div>
          </div>`).join('');
    }

    _board(m) {
        if (!m.board.length) return '<div class="tw-hint">还没有人物轨迹。</div>';
        const max = m.board[0].score || 1;
        return m.board.slice(0, 12).map((b, i) => `
          <div class="tw-person">
            <span class="tw-person-rank">${['🥇','🥈','🥉'][i] || (i+1)}</span>
            <div class="tw-person-main">
              <div class="tw-person-name">${esc(b.name)} <span class="tw-person-meta">${b.interactions}次交集 · ${b.breadth}场景</span></div>
              <div class="tw-person-bar"><div class="tw-person-fill" style="width:${Math.round(b.score/max*100)}%"></div></div>
            </div>
            <span class="tw-person-mood ${b.avgMood>0.2?'pos':b.avgMood<-0.2?'neg':''}">${b.avgMood>0.2?'😊':b.avgMood<-0.2?'😔':'😐'}</span>
          </div>`).join('');
    }

    /* [v2.15.0] 收藏册面板：历次织成的信（AI 升华版与本地规则版都在册）。
       与「叙事信」面板的区别：叙事信看的是「现在能织出什么」，收藏册看的是「已经留下过什么」——
       信是按时间沉淀的，翻旧信能明显看出这段时光的走向。 */
    _album() {
        const list = (this.app.listLetters && this.app.listLetters()) || [];
        if (!list.length) {
            return `<div class="tw-hint">收藏册还空着。<br><br>
              <span style="font-size:11px;line-height:1.9">在「💌 叙事信」里点「📚 收藏这封信」，<br>
              或等定期织信自动留下痕迹，这里会攒成一部时光信集。</span></div>`;
        }
        const rows = list.map(x => {
            const d = new Date(Number(x.ts) || Date.now());
            const stamp = `${d.getMonth() + 1}月${d.getDate()}日`;
            const tag = x.source === 'ai' ? '✨ AI' : '📄 本地';
            return `<div class="tw-mile" data-letter="${esc(x.id || '')}" style="cursor:pointer;align-items:flex-start">
              <span class="tw-mile-icon">💌</span>
              <div style="flex:1;min-width:0">
                <div class="tw-mile-label">${esc(x.title || '一段被织起的时光')} <span class="tw-person-meta" style="font-weight:400">${stamp} · ${tag}</span></div>
                <div class="tw-mile-detail" style="line-height:1.7">${esc(String((x.paragraphs || [])[0] || '').slice(0, 70))}…</div>
              </div>
            </div>`;
        }).join('');
        return `<div class="tw-curve-label" style="margin:2px 0 10px">共收藏 ${list.length} 封信（点开可再分享到朋友圈）</div>${rows}`;
    }
    /* [v2.15.0] 回望面板：LonSha 召回自检的观测镜像（跨项目数据互喂）。
       织光机原本只看得见「你生产了什么」（日记/照片/成就…），这里补上
       「你回望了什么」（lonsha 正文每轮召回命中哪段剧情）——两端观测拼成完整一面。 */
    _recall(m) {
        const r = m.recall;
        if (!r) {
            return `<div class="tw-hint">还没有可回望的痕迹。<br><br>
              <span style="font-size:11px;line-height:1.9">这一栏读取的是 LonSha 记忆引擎的「召回自检」——<br>
              当正文生成时它每轮记录『想起了哪段剧情』。<br>
              装上记忆插件并聊过几轮之后，这里会亮起你反复回望的时光。</span></div>`;
        }
        const emptyPct = r.rounds ? Math.round(r.emptyRounds / r.rounds * 100) : 0;
        const maxCount = r.hotFloors[0]?.count || 1;
        const floorRows = r.hotFloors.map((h, i) => `
          <div class="tw-person">
            <span class="tw-person-rank">${['🥇','🥈','🥉'][i] || (i + 1)}</span>
            <div class="tw-person-main">
              <div class="tw-person-name">第 ${h.floor} 楼 <span class="tw-person-meta">被想起 ${h.count} 次</span></div>
              <div class="tw-person-bar"><div class="tw-person-fill" style="width:${Math.round(h.count / maxCount * 100)}%"></div></div>
            </div>
          </div>`).join('');
        return `
        <div class="tw-curve">
          <div class="tw-curve-label">🔁 来自剧情侧的观测 · LonSha 召回自检${r.pluginVersion ? `（v${esc(r.pluginVersion)}）` : ''}</div>
          <div class="tw-letter-stats" style="margin-top:8px">
            <span class="tw-chip">观测 ${r.rounds} 轮</span>
            <span class="tw-chip" style="color:${emptyPct > 30 ? '#f87171' : '#cbb89a'}">空召回 ${r.emptyRounds} 轮（${emptyPct}%）</span>
            <span class="tw-chip">平均命中 ${r.avgHits}</span>
          </div>
          ${r.lastQuery ? `<div class="tw-hint" style="padding:12px 0 0;text-align:left">最近一次回望的是：「${esc(r.lastQuery)}」</div>` : ''}
        </div>
        ${r.hotFloors.length ? `<div class="tw-curve-label" style="margin:4px 0 8px">你最常回望的时光</div>${floorRows}` : '<div class="tw-hint">还没有形成明显的回望热点。</div>'}
        <div class="tw-hint" style="font-size:11px;line-height:1.8">右侧「被想起」越多，说明那段剧情越常被正文重新唤起。<br>空召回比例偏高时，剧情侧可能缺乏可关联的前情素材。</div>
        ${this._injectionBlock(m)}${this._eventPlatformsBlock(m)}`;
    }
    /* [v3.0.2] R2-C 送达侧：本轮**真的**进了上下文的是哪几块、哪几块被预算裁掉。
       为什么和上面的「回望」分两块：那张卡答「想起了什么」（召回侧），
       这张卡答「送进去了什么」（送达侧）—— 中间隔着预算裁剪与去重，
       少的那部分恰恰是用户在别处看不到的信息（本仓第七次「建好不消费」的那一面）。 */
    _injectionBlock(m) {
        const inj = m && m.injection;
        if (!inj) return '';
        const rows = (inj.blocks || []).map(b => `
          <div class="tw-person">
            <span class="tw-person-rank">${b.kept ? '\u2713' : '\u2717'}</span>
            <div class="tw-person-main">
              <div class="tw-person-name">${esc(b.label || b.ref || '一块记忆')} <span class="tw-person-meta">${esc(blockLine(b))}</span></div>
            </div>
          </div>`).join('');
        const warn = inj.verdict !== 'injected';
        return `
        <div class="tw-curve" style="margin-top:14px">
          <div class="tw-curve-label">\ud83d\udcee 送达侧观测 · 本轮实际注入</div>
          <div class="tw-letter-stats" style="margin-top:8px">
            <span class="tw-chip" style="color:${warn ? '#f87171' : '#cbb89a'}">${esc(injectionLine(inj))}</span>
            <span class="tw-chip" style="color:${inj.outcome === 'aborted' ? '#f87171' : (inj.outcome === 'completed' ? '#cbb89a' : '#6e7681')}">${inj.outcome === 'aborted' ? '\u26a0\ufe0f 被中止（本轮无回复）' : (inj.outcome === 'completed' ? '\u2713 已完成' : '结局未定')}</span>
          </div>
          ${rows}
        </div>`;
    }

    /* [v3.5.0] F-2 来源侧：那件事是谁记的（跨平台事件来源构成）。
       与上面两块并列的**第三个问题**：
         · 「回望」答 想起了哪段剧情（召回侧）；
         · 「送达」答 哪几块真的进了上下文（送达侧）；
         · 本块答 这件事是插件从正文提的、还是手机 App 里发生的（**来源侧**）。
       前两块都只看得见「模型看到了什么」，本块第一次让「这台设备上有没有跨平台来源」可读。
       缺席时**不显示**：读不到就是读不到，不写「0 个平台」（那会把「没读到」说成「确实没有」）。 */
    _eventPlatformsBlock(m) {
        const ep = m && m.eventPlatforms;
        if (!ep) return '';
        /* 三态各有各的话（真源已把五态分好，此处只做转述，**不重判形态**）：
         *   unusable ⇒ 装了却读不出（本机的问题面，须点名）；
         *   empty    ⇒ 有面、账里还没有事件段（真读数）；
         *   ok       ⇒ 有构成。
         * 缺席两态（桥未装 / 本版没这面）在收集器那层就不建卡了。 */
        const TAG = { usable: '', ok: '', empty: '（此刻还没有事件段）', unusable: '（本版读不出该面）' };
        const tag = TAG[ep.state] || '';
        const rows = (ep.platforms || []).map((p) => `
          <div class="tw-person">
            <span class="tw-person-rank">◆</span>
            <div class="tw-person-main">
              <div class="tw-person-name">${esc(p)}</div>
            </div>
          </div>`).join('');
        const zero = ep.segments
            ? `共 ${ep.segments} 段${ep.truncated ? '（展示已截断，计数为全量）' : ''}`
            : '本楼还没有事件段';
        return `
        <div class="tw-curve" style="margin-top:14px">
          <div class="tw-curve-label">🔗 来源侧观测 · 事件是谁记的${tag}</div>
          <div class="tw-letter-stats" style="margin-top:8px">
            <span class="tw-chip">${esc(eventPlatformsLine())}</span>
            <span class="tw-chip">${esc(zero)}</span>
          </div>
          ${rows}
          <div class="tw-hint" style="font-size:11px;line-height:1.8">平台标签由记忆插件侧登记方**显式给出**，不做文本猜测归类；<br>本栏只列被标过的平台，不排哪个平台更重要。</div>
        </div>`;
    }

    _bind() {
        const root = this.app.phoneShell?.element;
        if (!root) return;
        root.querySelectorAll('.tw-tab').forEach(btn => {
            btn.addEventListener('click', () => { this._tab = btn.dataset.tab; this.render(); });
        });
        const ex = root.querySelector('#tw-export');
        if (ex) ex.addEventListener('click', () => this._export());
        // [v2.14.0] AI 升华按钮：调 app.composeAILetter（无 API 时该方法已自处理降级）
        const aiBtn = root.querySelector('#tw-ai');
        if (aiBtn) aiBtn.addEventListener('click', () => { const p = this.app.composeAILetter?.(); if (p && typeof p.catch === 'function') p.catch(() => {}); });
        // [v2.15.0] 收藏 / 分享按钮
        const saveBtn = root.querySelector('#tw-save');
        if (saveBtn) saveBtn.addEventListener('click', () => this._saveCurrent());
        const shareBtn = root.querySelector('#tw-share');
        if (shareBtn) shareBtn.addEventListener('click', () => this._shareCurrent());
        root.querySelectorAll('[data-letter]').forEach(el => {
            el.addEventListener('click', () => this._shareById(el.dataset.letter));
        });
    }

    /* [v2.15.0] 当前要收藏/分享的那封信：AI 升华版优先，否则本地规则版。 */
    _currentLetter() {
        const ai = this.app.aiLetter || null;
        if (ai && Array.isArray(ai.paragraphs) && ai.paragraphs.length) {
            return { title: '一封被 AI 织起的时光信', paragraphs: ai.paragraphs, source: 'ai', ts: Number(ai.ts) || Date.now() };
        }
        const m = buildNarrative(this.app.storage, { bucket: 'day' });
        if (!m.letter) return null;
        return { title: m.letter.title, paragraphs: m.letter.paragraphs, source: 'local', ts: Date.now() };
    }
    _saveCurrent() {
        const letter = this._currentLetter();
        if (!letter) { this._toast('碎片还太少，织不出一封信'); return; }
        const p = this.app.saveLetter?.(letter);
        Promise.resolve(p).then(res => {
            if (res && res.ok) this._toast(`已收藏（共 ${res.total} 封）`);
            else this._toast((res && res.reason) || '收藏失败');
        }).catch(() => this._toast('收藏失败'));
    }
    _shareCurrent() {
        const letter = this._currentLetter();
        if (!letter) { this._toast('碎片还太少，没有可分享的内容'); return; }
        const res = this.app.shareLetterToMoments?.(letter);
        this._toast(res && res.ok ? '已分享到朋友圈' : ((res && res.reason) || '分享失败'));
    }
    _shareById(id) {
        const hit = (this.app.listLetters?.() || []).find(x => String(x.id) === String(id));
        if (!hit) return;
        const res = this.app.shareLetterToMoments?.(hit);
        this._toast(res && res.ok ? '已分享到朋友圈' : ((res && res.reason) || '分享失败'));
    }
    _toast(msg) {
        try {
            if (this.app.phoneShell?.showNotification) this.app.phoneShell.showNotification('织光机', msg, '💌');
            else console.log('[织光机]', msg);
        } catch (e) { console.log('[织光机]', msg); }
    }
    _export() {
        const m = buildNarrative(this.app.storage, {});
        if (!m.letter) return;
        const txt = `【${m.letter.title}】\n\n${m.letter.paragraphs.join('\n\n')}\n\n—— 织光机 · ${new Date().toLocaleDateString('zh-CN')}`;
        try {
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `织光机-时光信-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) { console.error('[织光机] 导出失败', e); }
    }

    _css() {
        return `<style>
.tw-wrap{padding:12px;font-size:13px;color:var(--rp-text,#e6edf3);min-height:100%;background:linear-gradient(180deg,#1a1410,#12100c)}
.tw-hero{padding:8px 4px 12px;border-bottom:1px solid #e8a33d33}
.tw-hero-title{font-size:20px;font-weight:700;color:#e8a33d}
.tw-hero-sub{font-size:11px;color:#9c8b7a;margin-top:2px}
.tw-tabs{display:flex;gap:6px;padding:10px 0;flex-wrap:wrap}
.tw-tab{flex:1;min-width:64px;padding:7px 4px;border:1px solid #e8a33d44;background:#e8a33d11;color:#cbb89a;border-radius:8px;font-size:12px;cursor:pointer}
.tw-tab.on{background:#e8a33d;color:#1a1410;font-weight:700}
.tw-empty{text-align:center;padding:60px 20px}
.tw-empty-icon{font-size:48px}
.tw-empty-title{font-size:16px;font-weight:700;margin:16px 0 8px;color:#e8a33d}
.tw-empty-sub{font-size:12px;color:#9c8b7a;line-height:1.8}
.tw-curve{margin-bottom:12px;background:#ffffff08;border-radius:10px;padding:10px}
.tw-curve-label{font-size:10px;color:#9c8b7a;margin-bottom:6px}
.tw-curve-track{display:flex;align-items:flex-end;gap:2px;height:48px;border-bottom:1px solid #ffffff22}
.tw-curve-bar{flex:1;min-width:3px;border-radius:2px 2px 0 0;opacity:0.85}
.tw-letter{background:linear-gradient(135deg,#e8a33d18,#e8a33d08);border:1px solid #e8a33d33;border-radius:12px;padding:16px}
.tw-letter-title{font-size:15px;font-weight:700;color:#e8a33d;margin-bottom:10px}
.tw-letter-p{font-size:13px;line-height:1.9;color:#e6d9c8;margin:8px 0}
.tw-letter-stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.tw-chip{font-size:10px;background:#ffffff12;border-radius:10px;padding:3px 8px;color:#cbb89a}
.tw-export{width:100%;margin-top:12px;padding:10px;border:none;border-radius:10px;background:#e8a33d;color:#1a1410;font-weight:700;cursor:pointer}
.tw-day{margin-bottom:14px}
.tw-day-head{display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px solid #ffffff18;margin-bottom:6px}
.tw-day-label{font-weight:700;color:#e8a33d;font-size:12px}
.tw-ev{display:flex;gap:8px;padding:6px 2px;align-items:flex-start}
.tw-ev-icon{font-size:14px}
.tw-ev-main{flex:1;min-width:0}
.tw-ev-title{font-size:12px;color:#e6d9c8}
.tw-ev-body{font-size:11px;color:#9c8b7a;margin-top:2px}
.tw-ev-actor{font-size:10px;background:#e8a33d22;color:#e8a33d;border-radius:8px;padding:2px 6px;flex-shrink:0}
.tw-mile{display:flex;gap:10px;padding:10px;background:#ffffff06;border-radius:10px;margin-bottom:8px;align-items:center}
.tw-mile-icon{font-size:20px}
.tw-mile-label{font-size:12px;font-weight:700;color:#e8a33d}
.tw-mile-detail{font-size:11px;color:#9c8b7a}
.tw-person{display:flex;gap:10px;align-items:center;padding:8px;background:#ffffff06;border-radius:10px;margin-bottom:8px}
.tw-person-rank{font-size:16px;width:24px;text-align:center}
.tw-person-main{flex:1}
.tw-person-name{font-size:13px;font-weight:700;color:#e6d9c8}
.tw-person-meta{font-size:10px;color:#9c8b7a;font-weight:400;margin-left:6px}
.tw-person-bar{height:5px;background:#ffffff14;border-radius:3px;margin-top:5px;overflow:hidden}
.tw-person-fill{height:100%;background:linear-gradient(90deg,#e8a33d,#f5c96b);border-radius:3px}
.tw-person-mood.pos{color:#4ade80}.tw-person-mood.neg{color:#f87171}
.tw-day-mood.pos,.tw-hint{color:#9c8b7a}
.tw-hint{text-align:center;padding:30px;font-size:12px}
</style>`;
    }
}

export default TimeweaverView;