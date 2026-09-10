/**
 * 成就簿 (Achievement App) - 视图组件
 */

export class AchievementView {
  constructor(app) {
    this.app = app;
    this.currentCat = '全部';
    this.searchKeyword = '';
    this.container = null;
  }

  render(container) {
    this.container = container;
    const stats = this.app.data.getStats();

    container.innerHTML = `
      <div class="ach-root">
        <header class="ach-header">
          <div class="ach-title-row">
            <button class="ach-back-btn" id="ach-back-btn"><i class="fa-solid fa-chevron-left"></i></button>
            <h2 class="ach-title">成就簿</h2>
            <div class="ach-header-spacer"></div>
          </div>
          <div class="ach-progress-card">
            <div class="ach-progress-left">
              <div class="ach-progress-trophy"><i class="fa-solid fa-trophy"></i></div>
              <div class="ach-progress-texts">
                <span class="ach-progress-title">全卡总览达成率</span>
                <span class="ach-progress-numbers">${stats.unlocked} / ${stats.total} 项</span>
              </div>
            </div>
            <div class="ach-progress-percent">${stats.percent}%</div>
          </div>
          <div class="ach-bar-container">
            <div class="ach-bar-fill" style="width: ${stats.percent}%"></div>
          </div>

          <div class="ach-search-row">
            <div class="ach-search-box">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" id="ach-search-input" placeholder="搜索 666 条成就名称、描述..." value="${this.searchKeyword}" />
            </div>
          </div>

          <nav class="ach-cat-nav" id="ach-cat-nav">
            <!-- 分类按钮动态填充 -->
          </nav>
        </header>

        <main class="ach-body">
          <div class="ach-list" id="ach-list">
            <!-- 成就列表动态填充 -->
          </div>
        </main>
      </div>
    `;

    this._bindHeaderEvents();
    this._renderCategories();
    this._renderList();
  }

  _renderCategories() {
    const nav = this.container.querySelector('#ach-cat-nav');
    if (!nav) return;
    const cats = ['全部', ...this.app.data.getCategories()];
    nav.innerHTML = cats.map(c => `
      <button class="ach-cat-pill ${c === this.currentCat ? 'active' : ''}" data-cat="${c}">
        ${c}
      </button>
    `).join('');

    nav.querySelectorAll('.ach-cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentCat = btn.dataset.cat;
        nav.querySelectorAll('.ach-cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderList();
      });
    });
  }

  _renderList() {
    const listContainer = this.container.querySelector('#ach-list');
    if (!listContainer) return;
    const achs = this.app.data.getAchievements(this.currentCat, this.searchKeyword);

    if (achs.length === 0) {
      listContainer.innerHTML = `<div class="ach-empty"><i class="fa-solid fa-crown"></i><p>未找到符合条件的成就</p></div>`;
      return;
    }

    listContainer.innerHTML = achs.map(a => {
      const isUnlocked = this.app.data.isUnlocked(a.id);
      const isHidden = a.hidden && !isUnlocked;

      return `
        <div class="ach-card ${isUnlocked ? 'unlocked' : 'locked'} ${isHidden ? 'hidden' : ''}">
          <div class="ach-card-icon">
            <i class="${isUnlocked ? 'fa-solid fa-medal' : isHidden ? 'fa-solid fa-question' : 'fa-solid fa-lock'}"></i>
          </div>
          <div class="ach-card-main">
            <div class="ach-card-header">
              <span class="ach-card-name">${isHidden ? '？？？神秘成就' : a.name}</span>
              <span class="ach-card-cat">${a.cat}</span>
            </div>
            <div class="ach-card-intro">${isHidden ? '未公开成就解锁条件，在旅途中探索触发' : a.intro}</div>
            ${isUnlocked && a.comment ? `<div class="ach-card-comment">「${a.comment}」</div>` : ''}
          </div>
          ${isUnlocked ? '<div class="ach-card-check"><i class="fa-solid fa-circle-check"></i></div>' : ''}
        </div>
      `;
    }).join('');
  }

  _bindHeaderEvents() {
    this.container.querySelector('#ach-back-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });

    const searchInput = this.container.querySelector('#ach-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.searchKeyword = e.target.value;
      this._renderList();
    });
  }
}
