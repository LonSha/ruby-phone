import { THEATER_STYLES } from './theater-data.js';

export class TheaterView {
  constructor(app) {
    this.app = app;
    this.container = null;
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _draw() {
    const draft = this.app.data.draft;
    const styles = Object.entries(THEATER_STYLES).map(([key, label]) => {
      const active = draft.style === key ? ' active' : '';
      return '<button class="th-chip' + active + '" data-style="' + key + '">' + this._esc(label) + '</button>';
    }).join('');
    const stories = (this.app.data.stories || []).slice(0, 8).map((story) => {
      return '<article class="th-story"><b>' + this._esc(story.theme) + '</b><p>' + this._esc(String(story.content || '').slice(0, 120)) + '</p></article>';
    }).join('') || '<div class="th-empty">还没有保存的小剧场。</div>';

    this.container.innerHTML = [
      '<div class="th-root">',
      '  <header class="th-header">',
      '    <button class="th-nav" id="th-home"><i class="fa-solid fa-chevron-left"></i></button>',
      '    <h2>小剧场</h2>',
      '  </header>',
      '  <div class="th-form">',
      '    <input id="th-theme" value="' + this._esc(draft.theme) + '" placeholder="主题，例如：雨夜便利店" />',
      '    <div class="th-chips">' + styles + '</div>',
      '    <select id="th-length">',
      '      <option value="short"' + (draft.length === 'short' ? ' selected' : '') + '>短 200-600 字</option>',
      '      <option value="medium"' + (draft.length === 'medium' ? ' selected' : '') + '>中 400-800 字</option>',
      '      <option value="long"' + (draft.length === 'long' ? ' selected' : '') + '>长 800-1500 字</option>',
      '      <option value="custom"' + (draft.length === 'custom' ? ' selected' : '') + '>自由设置</option>',
      '    </select>',
      '    <textarea id="th-content" placeholder="生成或粘贴正文后可保存 / 续写">' + this._esc(draft.content) + '</textarea>',
      '    <div class="th-roll">',
      '      <div class="th-roll-head">',
      '        <button class="th-roll-btn" id="th-roll">世界书随机</button>',
      '        <span class="th-roll-status" id="th-roll-status">' + this._esc(draft.rollResult ? '已抽 ' + draft.rollResult.split('\n\n').length + ' 条' : '') + '</span>',
      '        <button class="th-roll-clear" id="th-roll-clear">清除</button>',
      '      </div>',
      '      <pre class="th-roll-preview" id="th-roll-preview">' + this._esc(draft.rollResult || '') + '</pre>',
      '    </div>',
      '    <div class="th-actions">',
      '      <button id="th-copy">复制提示词</button>',
      '      <button id="th-continue">复制续写提示词</button>',
      '      <button id="th-save">保存</button>',
      '    </div>',
      '  </div>',
      this._rules(),
      '  <main class="th-body">' + stories + '</main>',
      '</div>'
    ].join('\n');
    this._bind();
  }

  /**
   * [v4.96.0 · R11-O3 第二批] 规则剧场面板：触发器 / 条件 / 动作三张白名单。
   *   三张表全部来自内核（RULE_TRIGGERS / RULE_OPERATORS / RULE_ACTIONS）——
   *   本视图不写第三个选项，写死就是第二份口径。
   *   面板只做两件事：把**库里有的规则**列出来、把**已存的那一条**交回去；
   *   能不能收、命中哪些动作，全由内核判。
   */
  _rules() {
    const r = (typeof this.app.ruleVm === 'function') ? this.app.ruleVm() : null;
    if (!r) return '';
    const opts = (list, cur) => list.map((v) => '<option value="' + this._esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + this._esc(v) + '</option>').join('');
    const rows = (r.rows || []).map((x) => {
      return '<div class="th-rule"><b>' + this._esc(x.name) + '</b>' +
        '<span class="th-rule-meta">' + this._esc(x.trigger) + ' · 命中 ' + String(x.fireCount) + ' 次 · ' +
        this._esc((x.actions || []).join('/')) + '</span></div>';
    }).join('') || '<div class="th-empty">还没有规则。下面填一条即可（同 id 覆盖，不堆积）。</div>';
    const fired = r.lastFired
      ? ('<div class="th-rule-fired">本次触发（' + this._esc(r.lastFired.type) + '）：' +
          (r.lastFired.lines.length ? this._esc(r.lastFired.lines.join('；')) : '没有动作') + '</div>')
      : '';
    return [
      '<section class="th-rules">',
      '  <h3>规则剧场（事件 → 条件 → 白名单动作）</h3>',
      '  <div class="th-rule-count">' + this._esc(r.countText) + '</div>',
      r.flash ? ('  <div class="th-flash' + (r.flashBad ? ' th-flash-bad' : '') + '">' + this._esc(r.flash) + '</div>') : '',
      fired,
      '  <div class="th-rule-list">' + rows + '</div>',
      '  <div class="th-rule-form">',
      '    <input id="rt-name" value="' + this._esc(r.draft.name) + '" placeholder="规则名，例如：心情低落时递一段日常" />',
      '    <div class="th-rule-line"><label>触发</label><select id="rt-trigger">' + opts(r.triggers, r.draft.trigger) + '</select></div>',
      '    <div class="th-rule-line"><label>字段</label><input id="rt-field" value="' + this._esc(r.draft.field) + '" placeholder="mood / intimacy …" /></div>',
      '    <div class="th-rule-line"><label>运算</label><select id="rt-op">' + opts(r.operators, r.draft.operator) + '</select></div>',
      '    <div class="th-rule-line"><label>值</label><input id="rt-value" value="' + this._esc(String(r.draft.value === undefined ? '' : r.draft.value)) + '" placeholder="low / 30 …" /></div>',
      '    <div class="th-rule-line"><label>动作</label><select id="rt-act">' + opts(r.actions, r.draft.actionType) + '</select></div>',
      '    <div class="th-rule-acts">',
      '      <button id="rt-save">存下这条规则</button>',
      '      <button id="rt-try">回放一次（用当前字段=值）</button>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join('\n');
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    const data = this.app.data;
    q('#th-home')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    q('#th-theme')?.addEventListener('input', (e) => { data.draft.theme = e.target.value; data._save(); });
    q('#th-length')?.addEventListener('change', (e) => { data.draft.length = e.target.value; data._save(); });
    q('#th-content')?.addEventListener('input', (e) => { data.draft.content = e.target.value; data._save(); });
    this.container.querySelectorAll('.th-chip').forEach((btn) => {
      btn.addEventListener('click', () => { data.draft.style = btn.dataset.style; data._save(); this._draw(); });
    });
    q('#th-roll')?.addEventListener('click', async () => {
      const status = q('#th-roll-status');
      status.textContent = '抽取中…';
      const res = await data.rollWorldBook();
      if (res.ok) {
        status.textContent = '已抽 ' + res.count + ' 条';
        q('#th-roll-preview').textContent = data.draft.rollResult || '';
      } else {
        status.textContent = res.reason || '失败';
      }
    });
    q('#th-roll-clear')?.addEventListener('click', () => {
      data.clearRollResult();
      q('#th-roll-status').textContent = '';
      q('#th-roll-preview').textContent = '';
    });
    q('#th-copy')?.addEventListener('click', async () => {
      const prompt = data.buildPrompt(false);
      try { await navigator.clipboard.writeText(prompt); window.toastr?.success?.('已复制生成提示词', '小剧场'); }
      catch (e) { window.toastr?.info?.(prompt.slice(0, 80), '小剧场'); }
    });
    q('#th-continue')?.addEventListener('click', async () => {
      const prompt = data.buildPrompt(true);
      try { await navigator.clipboard.writeText(prompt); window.toastr?.success?.('已复制续写提示词', '小剧场'); }
      catch (e) { window.toastr?.info?.(prompt.slice(0, 80), '小剧场'); }
    });
    q('#th-save')?.addEventListener('click', () => {
      const story = data.saveCurrent();
      window.toastr?.[story ? 'success' : 'warning']?.(story ? '已保存' : '没有可保存的正文', '小剧场');
      this._draw();
    });
    /* [v4.96.0] 规则面板的绑定：四个输入各走一个 setRuleDraft，两个按钮各走一个内核口。
     *   这里**不判**规则合不合法、也不算命中 —— 判在内核，提示行由 App 给。 */
    const rd = (patch) => { if (typeof this.app.setRuleDraft === 'function') this.app.setRuleDraft(patch); };
    q('#rt-name')?.addEventListener('input', (e) => rd({ name: e.target.value }));
    q('#rt-field')?.addEventListener('input', (e) => rd({ field: e.target.value }));
    q('#rt-value')?.addEventListener('input', (e) => rd({ value: e.target.value }));
    q('#rt-trigger')?.addEventListener('change', (e) => rd({ trigger: e.target.value }));
    q('#rt-op')?.addEventListener('change', (e) => rd({ operator: e.target.value }));
    q('#rt-act')?.addEventListener('change', (e) => rd({ actionType: e.target.value }));
    q('#rt-save')?.addEventListener('click', () => {
      if (typeof this.app.submitRule !== 'function') return;
      const r = this.app.submitRule();
      window.toastr?.[r.ok ? 'success' : 'warning']?.(r.ok ? '规则已存下' : '规则没收下', '小剧场');
      this._draw();
    });
    q('#rt-try')?.addEventListener('click', () => {
      if (typeof this.app.evaluateRuleEvent !== 'function') return;
      const d = this.app._ruleDraft || {};
      /* 回放用的载荷就是**表单里填的字段与值**：这样「为什么没命中」当场可查，
       *   不必猜内核拿什么去比的（这也是这条路唯一的自证方式）。 */
      const payload = {};
      payload[String(d.field || 'mood')] = (typeof this.app.constructor._coerce === 'function')
        ? this.app.constructor._coerce(d.value) : d.value;
      this.app.evaluateRuleEvent(String(d.trigger || ''), payload);
      this._draw();
    });
  }
}

export default TheaterView;
