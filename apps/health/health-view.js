/**
 * 健康与生理 App (Health App) - 视图组件
 * 呈现 iOS 风格生理圆环、当前阶段指标卡与调节滑块
 */

export class HealthView {
  constructor(app) {
    this.app = app;
    this.container = null;
  }

  render(container) {
    this.container = container;
    const info = this.app.data.getPhaseInfo();
    const day = this.app.data.currentCycleDay;
    const percent = Math.round((day / 28) * 100);

    container.innerHTML = `
      <div class="hl-root">
        <header class="hl-header">
          <button class="hl-back-btn" id="hl-back-btn"><i class="fa-solid fa-chevron-left"></i></button>
          <h2 class="hl-title">经期与身体健康</h2>
          <div class="hl-spacer"></div>
        </header>

        <main class="hl-body">
          <!-- 核心圆形仪表盘 -->
          <div class="hl-ring-card">
            <div class="hl-ring-outer" style="--ring-color: ${info.color}; --ring-pct: ${percent}%;">
              <div class="hl-ring-inner">
                <i class="fa-solid fa-droplet hl-droplet-icon" style="color: ${info.color};"></i>
                <span class="hl-ring-day">Day ${day}</span>
                <span class="hl-ring-phase" style="color: ${info.color};">${info.phase}</span>
              </div>
            </div>
            <div class="hl-badge-pill" style="background: ${info.color}22; color: ${info.color}; border: 1px solid ${info.color}55;">
              ${info.badge}
            </div>
          </div>

          <!-- 生理体征详情卡片 -->
          <div class="hl-info-cards">
            <div class="hl-card">
              <div class="hl-card-label"><i class="fa-solid fa-venus"></i> 受孕可能评估</div>
              <div class="hl-card-val" style="color: ${info.color};">${info.fertility}</div>
            </div>
            <div class="hl-card">
              <div class="hl-card-label"><i class="fa-solid fa-heart-pulse"></i> 敏感情绪与性欲</div>
              <div class="hl-card-val">${info.arousalLevel}</div>
            </div>
            <div class="hl-card full-width">
              <div class="hl-card-label"><i class="fa-solid fa-notes-medical"></i> 阶段特质与身心反应</div>
              <div class="hl-card-desc">${info.desc}</div>
            </div>
          </div>

          <!-- 快捷调节与注入 -->
          <div class="hl-controls-section">
            <div class="hl-section-title">快速推演与调节</div>
            <div class="hl-slider-row">
              <span class="hl-slider-label">调整周期第 ${day} 天:</span>
              <input type="range" class="hl-slider" id="hl-day-slider" min="1" max="28" value="${day}" />
            </div>

            <div class="hl-btn-grid">
              <button class="hl-action-btn" id="hl-step-prev"><i class="fa-solid fa-arrow-left"></i> 前一天</button>
              <button class="hl-action-btn" id="hl-step-next">后一天 <i class="fa-solid fa-arrow-right"></i></button>
              <button class="hl-action-btn ${this.app.data.isPregnant ? 'active' : ''}" id="hl-toggle-preg">
                <i class="fa-solid fa-baby"></i> ${this.app.data.isPregnant ? '解密妊娠' : '模拟受孕'}
              </button>
            </div>

            <div class="hl-inject-box">
              <div class="hl-inject-top">
                <span class="hl-inject-title">同步至大模型上下文</span>
                <button class="hl-inject-now-btn" id="hl-inject-now"><i class="fa-solid fa-paper-plane"></i> 立即同步</button>
              </div>
              <p class="hl-inject-hint">同步后，AI 在生成接下来的剧情与亲密互动时，将严格遵循角色当前的排卵/易孕/经期体温与敏感特质。</p>
            </div>
          </div>
        </main>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    this.container.querySelector('#hl-back-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });

    const slider = this.container.querySelector('#hl-day-slider');
    slider?.addEventListener('input', (e) => {
      this.app.data.setDay(e.target.value);
      this.render(this.container);
    });

    this.container.querySelector('#hl-step-prev')?.addEventListener('click', () => {
      this.app.data.advanceDays(-1);
      this.render(this.container);
    });
    this.container.querySelector('#hl-step-next')?.addEventListener('click', () => {
      this.app.data.advanceDays(1);
      this.render(this.container);
    });

    this.container.querySelector('#hl-toggle-preg')?.addEventListener('click', () => {
      const nowPreg = !this.app.data.isPregnant;
      this.app.data.togglePregnancy(nowPreg, 4);
      this.render(this.container);
      window.toastr?.info(nowPreg ? '已切换至妊娠状态（第4周）' : '已恢复常规生理周期', '健康App');
    });

    this.container.querySelector('#hl-inject-now')?.addEventListener('click', () => {
      const prompt = this.app.data.buildPromptDirective();
      window.toastr?.success('生理状态已注入！将在下一次回复中生效', '健康App');
    });
  }
}
