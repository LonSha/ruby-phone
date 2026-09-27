/* ========================================================
 * cheat-view.js — [v2.47.0] 万界武库 · 视图
 * 三标签：已装配（当前生效的权能）/ 万界武库（165 包全库，可搜可看可装）/ 设置
 * 样式走 apps/cheat/cheat.css（同时合并进 phone.css，与既有 App 同规）
 * ======================================================== */
'use strict';
import {
  qualityColorOf, qualityOrderOf, cheatsGroupedByQuality, searchCheats,
  getCheatById, INSTALL_MIN, INSTALL_MAX,
} from './cheat-data.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}
/* [v3.12.0] 原名为 `num`，但它返回的是**展示字符串**（'—' / '1.2 万字'），不是取数门。
 *  占着 `num` 这个名字正是本轮要治的那种混淆（读代码的人看到 `fmtChars(` 无法判断拿到的是
 *  一份数还是一个字样，也就无从判断它有没有走全仓那个取数门）—— 故改名为 `fmtChars`。
 *  取值口径本身不变：非有限数显示 '—'（不是 0 字）。 */
function fmtChars(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万字` : `${v} 字`;
}

export class CheatView {
  constructor(app) {
    this.app = app;
    this.tab = 'installed';   // installed | vault | settings
    this.q = '';              // 搜索关键词
    this.detail = null;       // 展开查看的 packId
  }

  render(container) {
    const host = container || this.app.phoneShell?.screen;
    if (!host) return;
    host.innerHTML = this._html();
    this._bind(host);
  }

  _html() {
    const sum = this.app.installedSummary();
    const ov = this.app.overview();
    return `
<div class="ch-root">
  <div class="ch-head">
    <div class="ch-title">🪄 金手指</div>
    <div class="ch-badge">
      <span class="ch-badge-main">${sum.count}/${sum.limit}</span>
      <span class="ch-badge-sub">${fmtChars(sum.chars)}</span>
    </div>
  </div>
  <div class="ch-tabs">
    ${this._tabBtn('installed', '已装配')}
    ${this._tabBtn('vault', `万界武库 ${ov.total}`)}
    ${this._tabBtn('settings', '设置')}
  </div>
  <div class="ch-body">${this._body(sum, ov)}</div>
</div>`;
  }

  _tabBtn(id, label) {
    return `<button class="ch-tab${this.tab === id ? ' on' : ''}" data-ch-tab="${esc(id)}">${esc(label)}</button>`;
  }

  _body(sum, ov) {
    if (this.tab === 'vault') return this._vault();
    if (this.tab === 'settings') return this._settings(sum, ov);
    return this._installed(sum);
  }

  /* ---------- 已装配 ---------- */
  _installed(sum) {
    if (this.detail && sum.ids.includes(this.detail)) return this._detailOf(this.detail);
    if (!sum.count) {
      return `<div class="ch-empty">
        <div class="ch-empty-icon">🈳</div>
        <div class="ch-empty-title">还没装配任何外挂</div>
        <div class="ch-empty-desc">去「幸运转盘」抽签入包，再回这里装配生效</div>
      </div>`;
    }
    const rows = sum.ids.map((id) => {
      const p = getCheatById(id);
      if (!p) return '';
      return `<div class="ch-card" data-ch-open="${esc(p.id)}">
        <div class="ch-card-top">
          <span class="ch-q" style="background:${qualityColorOf(p.quality)}">${esc(p.quality)}</span>
          <span class="ch-name">${esc(p.name)}</span>
          <span class="ch-chars">${fmtChars(p.chars)}</span>
        </div>
        <div class="ch-desc">${esc(p.desc || '（无简介）')}</div>
        <div class="ch-card-ops">
          <button class="ch-btn ch-btn-off" data-ch-toggle="${esc(p.id)}">卸下</button>
          <button class="ch-btn ch-btn-ghost" data-ch-open="${esc(p.id)}">查看正文</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="ch-note">当前注入 <b>${sum.count}</b> 条 · 合计 <b>${sum.chars}</b> 字 · 上限 ${sum.limit} 条</div>${rows}
      <button class="ch-btn ch-btn-danger ch-wide" id="ch-clear">清空装配</button>`;
  }

  /* ---------- 万界武库 ---------- */
  _vault() {
    if (this.detail) return this._detailOf(this.detail);
    const owned = this.app.ownedIds();
    const installed = new Set(this.app.getInstalled());
    const list = this.q ? searchCheats(this.q) : null;
    const head = `<div class="ch-search">
      <input id="ch-q" class="ch-input" type="text" placeholder="搜索外挂名称 / 简介" value="${esc(this.q)}">
      ${this.q ? `<button class="ch-btn ch-btn-ghost" id="ch-q-clear">清空</button>` : ''}
    </div>`;

    let body = '';
    if (list) {
      if (!list.length) return head + `<div class="ch-empty"><div class="ch-empty-title">没有匹配的外挂</div></div>`;
      body = `<div class="ch-note">搜索命中 <b>${list.length}</b> 条</div>` + list
        .sort((a, b) => qualityOrderOf(a.quality) - qualityOrderOf(b.quality))
        .map((p) => this._vaultRow(p, owned, installed)).join('');
    } else {
      body = cheatsGroupedByQuality().map((g) => `
        <div class="ch-group">
          <div class="ch-group-head"><span class="ch-q" style="background:${g.color}">${esc(g.quality)}</span><span>${g.list.length} 条</span></div>
          ${g.list.map((p) => this._vaultRow(p, owned, installed)).join('')}
        </div>`).join('');
    }
    return head + body;
  }

  _vaultRow(p, owned, installed) {
    const has = owned.has(p.id);
    const on = installed.has(p.id);
    const op = on
      ? `<button class="ch-btn ch-btn-off" data-ch-toggle="${esc(p.id)}">卸下</button>`
      : (has
        ? `<button class="ch-btn ch-btn-on" data-ch-toggle="${esc(p.id)}">装配</button>`
        : `<button class="ch-btn ch-btn-lock" disabled>未获得</button>`);
    return `<div class="ch-row">
      <div class="ch-row-main" data-ch-open="${esc(p.id)}">
        <div class="ch-card-top">
          <span class="ch-q" style="background:${qualityColorOf(p.quality)}">${esc(p.quality)}</span>
          <span class="ch-name">${esc(p.name)}${has ? '' : '<i class="ch-lock-tag">未获得</i>'}</span>
          <span class="ch-chars">${fmtChars(p.chars)}</span>
        </div>
        <div class="ch-desc">${esc(p.desc || '（无简介）')}</div>
      </div>
      <div class="ch-row-op">${op}</div>
    </div>`;
  }

  /* ---------- 正文详情 ---------- */
  _detailOf(id) {
    const p = getCheatById(id);
    if (!p) { this.detail = null; return this._installed(this.app.installedSummary()); }
    const on = this.app.isInstalled(p.id);
    const has = this.app.ownedIds().has(p.id);
    const op = on
      ? `<button class="ch-btn ch-btn-off" data-ch-toggle="${esc(p.id)}">卸下</button>`
      : (has ? `<button class="ch-btn ch-btn-on" data-ch-toggle="${esc(p.id)}">装配</button>` : '');
    return `<div class="ch-detail">
      <button class="ch-btn ch-btn-ghost ch-wide" id="ch-back">← 返回列表</button>
      <div class="ch-detail-head">
        <span class="ch-q" style="background:${qualityColorOf(p.quality)}">${esc(p.quality)}</span>
        <b>${esc(p.name)}</b>
        <span class="ch-chars">${fmtChars(p.chars)}${p.sub > 1 ? ` · ${p.sub} 合条` : ''}</span>
      </div>
      <div class="ch-detail-meta">类型 ${esc(p.type || '—')} · id ${esc(p.id)}</div>
      <pre class="ch-pre">${esc(p.content)}</pre>
      ${op}
    </div>`;
  }

  /* ---------- 设置 ---------- */
  _settings(sum, ov) {
    const s = sum.settings;
    const qs = Object.entries(ov.byQuality)
      .sort((a, b) => qualityOrderOf(a[0]) - qualityOrderOf(b[0]))
      .map(([q, n]) => `<span class="ch-q" style="background:${qualityColorOf(q)}">${esc(q)} ${n}</span>`).join('');
    return `
    <div class="ch-set">
      <div class="ch-set-row">
        <div class="ch-set-label">装配上限</div>
        <div class="ch-set-desc">同时生效的外挂条数（越少越省上下文，建议 3）</div>
        <div class="ch-slider">
          <input id="ch-max" type="range" min="${INSTALL_MIN}" max="${INSTALL_MAX}" step="1" value="${Number(s.maxInstall) || 3}">
          <span id="ch-max-val">${Number(s.maxInstall) || 3}</span>
        </div>
      </div>
      <div class="ch-set-row">
        <div class="ch-set-label">注入生成</div>
        <div class="ch-set-desc">把已装配外挂的权能交给生成侧，让剧情认得这些外挂</div>
        <label class="ch-switch"><input id="ch-inject" type="checkbox" ${s.injectToPrompt ? 'checked' : ''}><span></span></label>
      </div>
      <div class="ch-set-row">
        <div class="ch-set-label">显示诊断</div>
        <div class="ch-set-desc">显示库统计与装配清单的原始读数</div>
        <label class="ch-switch"><input id="ch-diag" type="checkbox" ${s.showDiagnostics ? 'checked' : ''}><span></span></label>
      </div>
      ${s.showDiagnostics ? `<div class="ch-diag">
        <div>库总量：${ov.total} 条 / ${ov.chars} 字</div>
        <div>装配：${sum.count}/${sum.limit} 条 / ${sum.chars} 字</div>
        <div>清单：${esc(sum.ids.join(', ') || '（空）')}</div>
        <div>注入块长度：${this.app.promptBlock().length} 字</div>
      </div>` : ''}
    </div>
    <div class="ch-note ch-ov">万界武库共 <b>${ov.total}</b> 条 · <b>${ov.chars}</b> 字</div>
    <div class="ch-ov-q">${qs}</div>`;
  }

  /* ---------- 事件 ---------- */
  _bind(host) {
    host.querySelectorAll('[data-ch-tab]').forEach((b) => {
      b.addEventListener('click', () => { this.tab = b.dataset.chTab; this.detail = null; this.render(host); });
    });
    host.querySelectorAll('[data-ch-open]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.detail = b.dataset.chOpen;
        this.render(host);
      });
    });
    host.querySelector('#ch-back')?.addEventListener('click', () => { this.detail = null; this.render(host); });

    host.querySelectorAll('[data-ch-toggle]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.dataset.chToggle;
        const r = this.app.toggleInstall(id);
        const p = getCheatById(id);
        if (r.ok) {
          this.app.phoneShell?.showNotification?.('金手指', `${r.installed.includes(id) ? '装配' : '卸下'}「${p?.name || id}」`, '🪄');
        } else {
          this.app.phoneShell?.showNotification?.('金手指', r.reason || '操作失败', '⚠️');
        }
        this.render(host);
      });
    });

    host.querySelector('#ch-clear')?.addEventListener('click', () => {
      this.app.clearInstalled();
      this.app.phoneShell?.showNotification?.('金手指', '已清空装配', '🪄');
      this.render(host);
    });

    const qi = host.querySelector('#ch-q');
    if (qi) {
      qi.addEventListener('input', () => {
        this.q = qi.value;
        // 保留输入焦点与光标：整块重绘会把焦点丢掉，故重绘后把焦点放回并置尾
        this.render(host);
        const ni = host.querySelector('#ch-q');
        if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
      });
    }
    host.querySelector('#ch-q-clear')?.addEventListener('click', () => { this.q = ''; this.render(host); });

    const maxEl = host.querySelector('#ch-max');
    if (maxEl) {
      maxEl.addEventListener('input', () => {
        const v = Number(maxEl.value) || 3;
        const lab = host.querySelector('#ch-max-val');
        if (lab) lab.textContent = String(v);
      });
      maxEl.addEventListener('change', () => {
        const v = Math.max(INSTALL_MIN, Math.min(INSTALL_MAX, Number(maxEl.value) || 3));
        this.app.saveSettings({ maxInstall: v });
        this.app.phoneShell?.showNotification?.('金手指', `装配上限 ${v} 条`, '🪄');
        this.render(host);
      });
    }
    host.querySelector('#ch-inject')?.addEventListener('change', (e) => {
      this.app.saveSettings({ injectToPrompt: !!e.target.checked });
      this.render(host);
    });
    host.querySelector('#ch-diag')?.addEventListener('change', (e) => {
      this.app.saveSettings({ showDiagnostics: !!e.target.checked });
      this.render(host);
    });
  }
}

export default CheatView;