/* ========================================================
 * dt-view.js — [v2.48.0] 撩语 · 视图
 * 三标签：已装配（当前生效的说话方式）/ 词库（199 模块全库，可搜可看可装）/ 设置
 * 样式走 apps/dirtytalk/dt.css（同时合并进 phone.css，与既有 App 同规）
 * ======================================================== */
'use strict';
import {
  tierColorOf, tierOrderOf, modulesGroupedByCat, searchModules,
  getModuleById, INSTALL_MIN, INSTALL_MAX, CAT_LABEL, TIER_ORDER,
} from './dt-data.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}
/* [v3.12.0] 同 apps/cheat/cheat-view.js：这一个是**展示格式化器**而非取数门，
 *  改名 `fmtChars` 以免与全仓唯一取数门同名混淆。取值口径逐字不变。 */
function fmtChars(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万字` : `${v} 字`;
}

export class DtView {
  constructor(app) {
    this.app = app;
    this.tab = 'installed';   // installed | vault | settings
    this.q = '';              // 搜索关键词
    this.detail = null;       // 展开查看的 moduleId
    this.cat = '';            // 词库类别筛选（空 = 全部分组）
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
<div class="dt-root">
  <div class="dt-head">
    <div class="dt-title">💬 撩语</div>
    <div class="dt-badge">
      <span class="dt-badge-main">${sum.count}/${sum.limit}</span>
      <span class="dt-badge-sub">${fmtChars(sum.chars)}</span>
    </div>
  </div>
  <div class="dt-tabs">
    ${this._tabBtn('installed', '已装配')}
    ${this._tabBtn('vault', `词库 ${ov.total}`)}
    ${this._tabBtn('settings', '设置')}
  </div>
  <div class="dt-body">${this._body(sum, ov)}</div>
</div>`;
  }

  _tabBtn(id, label) {
    return `<button class="dt-tab${this.tab === id ? ' on' : ''}" data-dt-tab="${esc(id)}">${esc(label)}</button>`;
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
      return `<div class="dt-empty">
        <div class="dt-empty-icon">🈳</div>
        <div class="dt-empty-title">还没装配任何撩语</div>
        <div class="dt-empty-desc">去「幸运转盘」抽签入包，再回这里装配生效</div>
      </div>`;
    }
    const rows = sum.ids.map((id) => {
      const p = getModuleById(id);
      if (!p) return '';
      return `<div class="dt-card" data-dt-open="${esc(p.id)}">
        <div class="dt-card-top">
          <span class="dt-q" style="background:${tierColorOf(p.tier)}">${esc(p.tier)}</span>
          <span class="dt-cat">${esc(p.label || p.cat)}</span>
          <span class="dt-name">${esc(p.name)}</span>
          <span class="dt-chars">${fmtChars(p.chars)}</span>
        </div>
        <div class="dt-desc">${esc(p.desc || '（无简介）')}</div>
        <div class="dt-card-ops">
          <button class="dt-btn dt-btn-off" data-dt-toggle="${esc(p.id)}">卸下</button>
          <button class="dt-btn dt-btn-ghost" data-dt-open="${esc(p.id)}">查看正文</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="dt-note">当前注入 <b>${sum.count}</b> 条 · 合计 <b>${sum.chars}</b> 字 · 上限 ${sum.limit} 条</div>${rows}
      <button class="dt-btn dt-btn-danger dt-wide" id="dt-clear">清空装配</button>`;
  }

  /* ---------- [v2.49.0] 场景联动推荐（词库页顶部） ---------- */
  _sceneCard() {
    let hints = null;
    try { hints = this.app.sceneStyleHints?.(); } catch (_e) { hints = null; }
    if (!hints || !hints.chain.length) return '';
    const where = hints.chain.map((s) => esc(s)).join(' <span class="dt-scene-sep">›</span> ');
    const styles = (hints.styles || []).map((s) =>
      `<span class="dt-scene-chip"><b>${esc(s.name)}</b><i>${esc(s.why)}</i></span>`
    ).join('');
    return `<div class="dt-scene">
      <div class="dt-scene-loc"><span class="dt-scene-label">当前所在</span>${where}</div>
      ${styles ? `<div class="dt-scene-rec">${styles}</div>` : ''}
    </div>`;
  }
  /* ---------- 词库 ---------- */
  _vault() {
    if (this.detail) return this._detailOf(this.detail);
    const owned = this.app.ownedIds();
    const installed = new Set(this.app.getInstalled());
    const list = this.q ? searchModules(this.q) : null;
    const cats = Object.entries(CAT_LABEL).map(([k, v]) =>
      `<button class="dt-chip${this.cat === k ? ' on' : ''}" data-dt-cat="${esc(k)}">${esc(v)}</button>`
    ).join('');
    const sceneCard = this._sceneCard();
    const head = `${sceneCard}<div class="dt-search">
      <input id="dt-q" class="dt-input" type="text" placeholder="搜索风格 / 人设 / 玩法 / 语录" value="${esc(this.q)}">
      ${this.q ? `<button class="dt-btn dt-btn-ghost" id="dt-q-clear">清空</button>` : ''}
    </div>
    <div class="dt-chips"><button class="dt-chip${this.cat === '' ? ' on' : ''}" data-dt-cat="">全部</button>${cats}</div>`;

    let body = '';
    if (list) {
      const filtered = this.cat ? list.filter((p) => p.cat === this.cat) : list;
      if (!filtered.length) return head + `<div class="dt-empty"><div class="dt-empty-title">没有匹配的模块</div></div>`;
      body = `<div class="dt-note">搜索命中 <b>${filtered.length}</b> 条</div>` + filtered
        .sort((a, b) => tierOrderOf(a.tier) - tierOrderOf(b.tier))
        .map((p) => this._vaultRow(p, owned, installed)).join('');
    } else {
      const groups = modulesGroupedByCat().filter((g) => !this.cat || g.cat === this.cat);
      body = groups.map((g) => `
        <div class="dt-group">
          <div class="dt-group-head"><span class="dt-cat-lab">${esc(g.label)}</span><span>${g.list.length} 条</span></div>
          ${g.list.map((p) => this._vaultRow(p, owned, installed)).join('')}
        </div>`).join('');
    }
    return head + body;
  }

  _vaultRow(p, owned, installed) {
    const has = owned.has(p.id);
    const on = installed.has(p.id);
    const op = on
      ? `<button class="dt-btn dt-btn-off" data-dt-toggle="${esc(p.id)}">卸下</button>`
      : (has
        ? `<button class="dt-btn dt-btn-on" data-dt-toggle="${esc(p.id)}">装配</button>`
        : `<button class="dt-btn dt-btn-lock" disabled>未获得</button>`);
    return `<div class="dt-row">
      <div class="dt-row-main" data-dt-open="${esc(p.id)}">
        <div class="dt-card-top">
          <span class="dt-q" style="background:${tierColorOf(p.tier)}">${esc(p.tier)}</span>
          <span class="dt-name">${esc(p.name)}${has ? '' : '<i class="dt-lock-tag">未获得</i>'}</span>
          <span class="dt-chars">${fmtChars(p.chars)}</span>
        </div>
        <div class="dt-desc">${esc(p.desc || '（无简介）')}</div>
      </div>
      <div class="dt-row-op">${op}</div>
    </div>`;
  }

  /* ---------- 正文详情 ---------- */
  _detailOf(id) {
    const p = getModuleById(id);
    if (!p) { this.detail = null; return this._installed(this.app.installedSummary()); }
    const on = this.app.isInstalled(p.id);
    const has = this.app.ownedIds().has(p.id);
    const op = on
      ? `<button class="dt-btn dt-btn-off" data-dt-toggle="${esc(p.id)}">卸下</button>`
      : (has ? `<button class="dt-btn dt-btn-on" data-dt-toggle="${esc(p.id)}">装配</button>` : '');
    return `<div class="dt-detail">
      <button class="dt-btn dt-btn-ghost dt-wide" id="dt-back">← 返回列表</button>
      <div class="dt-detail-head">
        <span class="dt-q" style="background:${tierColorOf(p.tier)}">${esc(p.tier)}</span>
        <b>${esc(p.name)}</b>
        <span class="dt-chars">${fmtChars(p.chars)}${p.sub > 1 ? ` · ${p.sub} 合条` : ''}</span>
      </div>
      <div class="dt-detail-meta">${esc(p.label || p.cat)} · id ${esc(p.id)}</div>
      <pre class="dt-pre">${esc(p.content)}</pre>
      ${op}
    </div>`;
  }

  /* ---------- 设置 ---------- */
  _settings(sum, ov) {
    const s = sum.settings;
    const cats = Object.entries(ov.byCat)
      .map(([c, n]) => `<span class="dt-chip on">${esc(CAT_LABEL[c] || c)} ${n}</span>`).join('');
    const tiers = TIER_ORDER.map((t) =>
      `<span class="dt-q" style="background:${tierColorOf(t)}">${esc(t)} ${ov.byTier[t] || 0}</span>`
    ).join('');
    return `
    <div class="dt-set">
      <div class="dt-set-row">
        <div class="dt-set-label">装配上限</div>
        <div class="dt-set-desc">同时生效的撩语条数（越少越省上下文，建议 4）</div>
        <div class="dt-slider">
          <input id="dt-max" type="range" min="${INSTALL_MIN}" max="${INSTALL_MAX}" step="1" value="${Number(s.maxInstall) || 4}">
          <span id="dt-max-val">${Number(s.maxInstall) || 4}</span>
        </div>
      </div>
      <div class="dt-set-row">
        <div class="dt-set-label">注入生成</div>
        <div class="dt-set-desc">把已装配模块的说话方式交给生成侧，让剧情认得这些风格</div>
        <label class="dt-switch"><input id="dt-inject" type="checkbox" ${s.injectToPrompt ? 'checked' : ''}><span></span></label>
      </div>
      <div class="dt-set-row">
        <div class="dt-set-label">显示诊断</div>
        <div class="dt-set-desc">显示库统计与装配清单的原始读数</div>
        <label class="dt-switch"><input id="dt-diag" type="checkbox" ${s.showDiagnostics ? 'checked' : ''}><span></span></label>
      </div>
      ${s.showDiagnostics ? `<div class="dt-diag">
        <div>库总量：${ov.total} 条 / ${ov.chars} 字</div>
        <div>装配：${sum.count}/${sum.limit} 条 / ${sum.chars} 字</div>
        <div>清单：${esc(sum.ids.join(', ') || '（空）')}</div>
        <div>注入块长度：${this.app.promptBlock().length} 字</div>
      </div>` : ''}
    </div>
    <div class="dt-note dt-ov">撩语词库共 <b>${ov.total}</b> 条 · <b>${ov.chars}</b> 字</div>
    <div class="dt-ov-q">${tiers}</div>
    <div class="dt-ov-q">${cats}</div>
    <div class="dt-ov-q">${(ov.styles || []).map((n) => `<span class="dt-chip on">${esc(n)}</span>`).join('')}</div>
    <div class="dt-note">语料档 ${ov.corpus ? ov.corpus.total : 0} 条 / ${ov.corpus ? ov.corpus.chars : 0} 字（只读参考，不注入生成）</div>`;
  }

  /* ---------- 事件 ---------- */
  _bind(host) {
    host.querySelectorAll('[data-dt-tab]').forEach((b) => {
      b.addEventListener('click', () => { this.tab = b.dataset.dtTab; this.detail = null; this.render(host); });
    });
    host.querySelectorAll('[data-dt-open]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.detail = b.dataset.dtOpen;
        this.render(host);
      });
    });
    host.querySelectorAll('[data-dt-cat]').forEach((b) => {
      b.addEventListener('click', () => { this.cat = b.dataset.dtCat || ''; this.detail = null; this.render(host); });
    });
    host.querySelector('#dt-back')?.addEventListener('click', () => { this.detail = null; this.render(host); });

    host.querySelectorAll('[data-dt-toggle]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.dataset.dtToggle;
        const r = this.app.toggleInstall(id);
        const p = getModuleById(id);
        if (r.ok) {
          this.app.phoneShell?.showNotification?.('撩语', `${r.installed.includes(id) ? '装配' : '卸下'}「${p?.name || id}」`, '💬');
        } else {
          this.app.phoneShell?.showNotification?.('撩语', r.reason || '操作失败', '⚠️');
        }
        this.render(host);
      });
    });

    host.querySelector('#dt-clear')?.addEventListener('click', () => {
      this.app.clearInstalled();
      this.app.phoneShell?.showNotification?.('撩语', '已清空装配', '💬');
      this.render(host);
    });

    const qi = host.querySelector('#dt-q');
    if (qi) {
      qi.addEventListener('input', () => {
        this.q = qi.value;
        this.render(host);
        const ni = host.querySelector('#dt-q');
        if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
      });
    }
    host.querySelector('#dt-q-clear')?.addEventListener('click', () => { this.q = ''; this.render(host); });

    const maxEl = host.querySelector('#dt-max');
    if (maxEl) {
      maxEl.addEventListener('input', () => {
        const v = Number(maxEl.value) || 4;
        const lab = host.querySelector('#dt-max-val');
        if (lab) lab.textContent = String(v);
      });
      maxEl.addEventListener('change', () => {
        const v = Math.max(INSTALL_MIN, Math.min(INSTALL_MAX, Number(maxEl.value) || 4));
        this.app.saveSettings({ maxInstall: v });
        this.app.phoneShell?.showNotification?.('撩语', `装配上限 ${v} 条`, '💬');
        this.render(host);
      });
    }
    host.querySelector('#dt-inject')?.addEventListener('change', (e) => {
      this.app.saveSettings({ injectToPrompt: !!e.target.checked });
      this.render(host);
    });
    host.querySelector('#dt-diag')?.addEventListener('change', (e) => {
      this.app.saveSettings({ showDiagnostics: !!e.target.checked });
      this.render(host);
    });
  }
}

export default DtView;