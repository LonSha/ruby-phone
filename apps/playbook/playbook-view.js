/**
 * 灵感工坊 (Playbook App) - 视图组件
 */

export class PlaybookView {
  constructor(app) {
    this.app = app;
    this.currentCat = '全部';
    this.searchKeyword = '';
    this.container = null;
  }

  render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="playbook-root">
        <header class="playbook-header">
          <div class="playbook-title-row">
            <button class="playbook-back-btn" id="pb-back-btn"><i class="fa-solid fa-chevron-left"></i></button>
            <h2 class="playbook-title">灵感工坊</h2>
            <div class="playbook-header-action">
              <button class="playbook-icon-btn" id="pb-info-btn" title="玩法说明"><i class="fa-solid fa-circle-question"></i></button>
            </div>
          </div>
          <div class="playbook-search-row">
            <div class="playbook-search-box">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" id="pb-search-input" placeholder="搜索 458 种玩法、体位、调教姿势..." value="${this.searchKeyword}" />
              ${this.searchKeyword ? '<button class="pb-clear-search" id="pb-clear-search"><i class="fa-solid fa-xmark"></i></button>' : ''}
            </div>
          </div>
          <nav class="playbook-cat-nav" id="pb-cat-nav">
            <!-- 分类药丸动态生成 -->
          </nav>
        </header>

        <main class="playbook-body">
          <div class="playbook-grid" id="pb-grid">
            <!-- 玩法胶囊动态填充 -->
          </div>
        </main>

        <footer class="playbook-bottom-bar">
          <div class="pb-status-info">
            <span class="pb-selected-badge" id="pb-selected-count">已选 0 项</span>
            <label class="pb-autoclear-toggle">
              <input type="checkbox" id="pb-autoclear-chk" ${this.app.data.autoClear ? 'checked' : ''} />
              <span>发后自清</span>
            </label>
          </div>
          <div class="pb-action-buttons">
            <button class="pb-btn pb-btn-secondary" id="pb-clear-btn"><i class="fa-solid fa-trash-can"></i> 清空</button>
            <button class="pb-btn pb-btn-primary" id="pb-inject-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> 注入剧情</button>
          </div>
        </footer>
      </div>
    `;

    this._bindHeaderEvents();
    this._renderCategories();
    this._renderPlays();
    this._updateBottomBar();
  }

  _renderCategories() {
    const nav = this.container.querySelector('#pb-cat-nav');
    if (!nav) return;
    const cats = ['全部', ...this.app.data.getCategories()];
    nav.innerHTML = cats.map(c => `
      <button class="pb-cat-pill ${c === this.currentCat ? 'active' : ''}" data-cat="${c}">
        ${c}
      </button>
    `).join('');

    nav.querySelectorAll('.pb-cat-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.currentCat = btn.dataset.cat;
        nav.querySelectorAll('.pb-cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderPlays();
      });
    });
  }

  _renderPlays() {
    const grid = this.container.querySelector('#pb-grid');
    if (!grid) return;
    const list = this.app.data.searchPlays(this.searchKeyword, this.currentCat);
    if (list.length === 0) {
      grid.innerHTML = `<div class="pb-empty"><i class="fa-solid fa-feather"></i><p>未找到匹配的玩法灵感</p></div>`;
      return;
    }

    grid.innerHTML = list.map(play => {
      const isSelected = this.app.data.selectedPlays.has(play);
      return `
        <button class="pb-play-chip ${isSelected ? 'selected' : ''}" data-play="${play}">
          <span class="pb-chip-text">${play}</span>
          ${isSelected ? '<i class="fa-solid fa-check pb-chip-check"></i>' : ''}
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.pb-play-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const name = chip.dataset.play;
        this.app.data.togglePlay(name);
        const nowSelected = this.app.data.selectedPlays.has(name);
        chip.classList.toggle('selected', nowSelected);
        if (nowSelected) {
          if (!chip.querySelector('.pb-chip-check')) {
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-check pb-chip-check';
            chip.appendChild(icon);
          }
        } else {
          chip.querySelector('.pb-chip-check')?.remove();
        }
        this._updateBottomBar();
      });
    });
  }

  _updateBottomBar() {
    const countEl = this.container?.querySelector('#pb-selected-count');
    const count = this.app.data.selectedPlays.size;
    if (countEl) {
      countEl.textContent = `已选 ${count} 项`;
      countEl.classList.toggle('has-items', count > 0);
    }
  }

  _bindHeaderEvents() {
    this.container.querySelector('#pb-back-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });

    const searchInput = this.container.querySelector('#pb-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.searchKeyword = e.target.value;
      this._renderPlays();
    });

    this.container.querySelector('#pb-autoclear-chk')?.addEventListener('change', (e) => {
      this.app.data.autoClear = e.target.checked;
      this.app.data.saveState();
    });

    this.container.querySelector('#pb-clear-btn')?.addEventListener('click', () => {
      this.app.data.clearSelected();
      this._renderPlays();
      this._updateBottomBar();
    });

    this.container.querySelector('#pb-inject-btn')?.addEventListener('click', () => {
      this.app.executeManualInjection();
    });
  }
}
