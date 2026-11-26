/* ========================================================
 * clock-view.js — [v2.52.0] 时计 App 视图
 * 归因卡 + 时间轴卡片 + 诊断卡片 + 设置卡
 * ======================================================== */

import { CLOCK_REASONS } from './clock-data.js';
/* [v4.112.0 · R13-X1] 「今天」页签的词表**取真源**（键面与标签都从 config 读），
 *   视图不手写第二份 —— 手写一份标识符形会与本仓已立判据（文案表不得手写键）相撞，
 *   且真源一旦改名，本表会静默落兜底、多种处境显示成同一句话。 */
import { TODAY_STATES, TODAY_SOURCE_STATES, TODAY_SOURCE_LABEL, TODAY_SOURCES } from '../../config/today-terms.js';
/* [v4.119.0 · R14-O3] 载荷走唯一一支笔（与 search-view / 装配器同一件）：
 *   手拼 { appId, ref } 会让字段名一漂，而漂掉的表现是「点了没反应」。 */
import { buildOpenDetail } from '../../config/app-open-detail.js';
/* [v4.141.0 · R21-O2] 诊断卡新增「时间轴收口进度」行。读数取**自动生成的同源模块**
 *   config/time-debt-readings.js（由 tools/gen_time_debt_readings.mjs 扫白名单产出，
 *   与 tests/audit/time_debt_readings.json 同一次扫描），视图不手抄数字 ——
 *   手抄会出现「收口推进了、诊断行还停在旧读数」的静默漂移。 */
import { TIME_DEBT_READINGS } from '../../config/time-debt-readings.js';

/* [v4.112.0 · R13-X1] 「今天」的一条原话点回去 ⇒ 打开**那个 App**。
 * [v4.119.0 · R14-O3] 升级：**有靶心的那一条**，点下去就落在那一篇 / 那一则备忘上。
 *   本版给 `diary` 与 `calendar` 两源补齐了 `OPEN_REF_KINDS` 登记与 App 侧 `openRef`，
 *   于是这两源的按钮从「打开日记」变成「打开这一条」（真的能落到）；
 *   `wechat` / `album` 仍**没有** `openRef` 定位口，按钮文案照旧只写「打开 X」——
 *   ★ 文案必须由**靶心在不在**决定，不能按源名写死：写死就会出现「某天补了口但文案不改」
 *   （或反过来，文案先承诺、口还没补）两类静默缺陷，而两类都只在用户点下去时才暴露。 */
const TODAY_JUMP_APP = Object.freeze({
  wechat: 'wechat', calendar: 'calendar', diary: 'diary', album: 'album'
});

/* [v2.98.0] 键必须取 CLOCK_REASONS 的**值**（连字符形），不得另写一套下划线形。
   修前实测：本表键写作 no_clock_face / no_snapshot / bridge_absent，
   而 CLOCK_REASONS 的值是 no-clock-face / no-snapshot / bridge-absent ⇒
   五态里三态查不到，而下一行的兜底又是 FACE_META.bridge_absent，于是
   「快照不可用」「这版快照没时钟面」「桥未连接」三种完全不同的处境
   **一律显示成「桥未连接」**。与本仓最贵的缺陷形态同形。
   改用常量做键：形状由真源决定，真源改了这里跟着变，不会再静默塔缩。 */
const FACE_META = {
  [CLOCK_REASONS.ready]: { icon: '\u23f1\ufe0f', label: '已同步', tone: 'ok' },
  [CLOCK_REASONS.empty]: { icon: '\u2615', label: '尚无时间', tone: 'warn' },
  [CLOCK_REASONS.upstream_empty]: { icon: '\u2615', label: '上游报该项为空', tone: 'warn' },
  [CLOCK_REASONS.no_clock_face]: { icon: '\u2b50', label: '这版快照无时钟面', tone: 'warn' },
  [CLOCK_REASONS.no_snapshot]: { icon: '\u26d4', label: '快照不可用', tone: 'err' },
  [CLOCK_REASONS.bridge_absent]: { icon: '\u26a1', label: '桥未连接', tone: 'err' },
};

export class ClockView {
  constructor(app, shell, storage) {
    this.app = app;
    this.shell = shell;
    this.storage = storage;
    this._root = null;
    /* [v4.112.0 · R13-X1] 页签态**不落盘**：它只是「现在在看哪一屏」，
     *   每次打开都从「今天」开始 —— 用户打开时计最想知道的是今天发生了什么。 */
    this._tab = 'today';
  }

  /** 页签表（既有一屏 = 时计原屏，新增一屏 = 今天）。 */
  _tabs() {
    return [
      { key: 'today', label: '今天' },
      { key: 'clock', label: '时计' }
    ];
  }

  /* [v4.209.0 · 照官方那种] 底栏格表 = 官方四格（世界时钟 / 闹钟 / 秒表 / 计时器）
   *   ＋ 本仓自有的「今天」一格（排最后，不打乱官方四格的相对位置）。
   *   未实现的三格**画出来但禁用**（is-disabled + aria-disabled，点击走页面内提示条给真话），
   *   不再像 v4.208.0 那样整格不画 —— 藏起来会被读成「这个 App 没有这些功能」，
   *   静默会被读成「按钮坏了」，两种都不对（贴吧「消息」那轮确立的口径）。 */
  _navCells() {
    return [
      { key: 'clock', label: '世界时钟' },
      { key: 'alarm', label: '闹钟', disabled: true, why: '本机没有闹钟调度与唤醒链路' },
      { key: 'stopwatch', label: '秒表', disabled: true, why: '本机没有秒表计时链路' },
      { key: 'timer', label: '计时器', disabled: true, why: '本机没有倒计时链路' },
      { key: 'today', label: '今天', own: true }
    ];
  }
  _switchTab(key) {
    const ok = this._tabs().some((t) => t.key === key);
    this._tab = ok ? key : 'today';
  }

  render() {
    const container = this.shell?.getContentContainer?.();
    if (!container) return;
    container.innerHTML = '';
    this._root = document.createElement('div');
    /* [v4.208.0 · 照现实] 根容器只做满屏纵向 flex 外壳（cl-app），
     *   内边距与内容流搬到 .cl-scroll，底栏 .cl-tabbar 用 flex-shrink:0 贴底。
     *   不写 position:fixed —— 贴吧/老福特/Pixiv 三轮实测：fixed 会脱离外壳高度约束，
     *   底栏被裁或盖住最后一行内容。 */
    this._root.className = 'cl-root cl-app';
    this._root.innerHTML = this._buildHTML();
    container.appendChild(this._root);
    this._bindEvents();
  }

  refresh() {
    if (!this._root) return;
    /* [v4.209.0] 整段重绘会把提示条节点冲掉，先收回计时器与悬挂引用，否则会留一颗「看不见但还在数」的定时器。 */
    this._clearToast();
    this._root.innerHTML = this._buildHTML();
    this._bindEvents();
  }

  _buildHTML() {
    const face = this.app.clockFace();
    const proj = this.app.projection();
    /* [v3.0.1] 归属面：从控制器取（不在视图里重取投影 —— 两次读数会给出两份「来源」）。 */
    let src = null;
    try { src = this.app.sourceFace(); } catch (_e) { src = null; }
    // [v2.98.0] 未识别的状态如实报出（带原值），不冒充「桥未连接」。
    const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
    const parts = [];

    // Header
    parts.push('<div class="cl-scroll">');
    parts.push('<div class="cl-header"><h2>\u23f1\ufe0f 时计</h2></div>');

    if (this._tab === 'today') {
      parts.push(this._todayHtml());
      parts.push('</div>');
      parts.push(this._tabbarHtml());
      return parts.join('\n');
    }

    // Face card
    parts.push('<div class="cl-face cl-face-' + meta.tone + '">');
    parts.push('<span class="cl-face-icon">' + meta.icon + '</span>');
    parts.push('<span class="cl-face-label">' + meta.label + '</span>');
    parts.push('</div>');

    // Source card (v3.0.1: 这份读数是哪一次的)
    if (src) {
      const tone = src.usable === true ? (src.stale === true ? 'warn' : 'ok') : 'off';
      parts.push('<div class="cl-src cl-src-' + tone + '">');
      parts.push('<div class="cl-src-title">数据来源</div>');
      parts.push('<div class="cl-src-line">' + this._esc(src.line) + '</div>');
      parts.push('</div>');
    }

    // Time card (ready only)
    if (face === CLOCK_REASONS.ready && proj) {
      parts.push('<div class="cl-time-card">');
      if (proj.date) parts.push('<div class="cl-date">' + this._esc(proj.date) + '</div>');
      if (proj.label) parts.push('<div class="cl-label">' + this._esc(proj.label) + '</div>');
      parts.push('<div class="cl-meta">');
      parts.push('<span class="cl-chip cl-chip-prec">' + this._precLabel(proj.precision) + '</span>');
      if (proj.turn > 0) parts.push('<span class="cl-chip">L' + proj.turn + '</span>');
      if (proj.hasFlashback) parts.push('<span class="cl-chip cl-chip-fb">\u21a9 闪回</span>');
      parts.push('</div>');
      if (proj.hasFlashback && proj.flashback) {
        parts.push('<div class="cl-flashback">\u21a9 ' + this._esc(proj.flashback.date || '未知') + (proj.flashback.label ? ' \u00b7 ' + this._esc(proj.flashback.label) : '') + '</div>');
      }
      parts.push('</div>');
    }

    // Diagnostics card
    if (face === CLOCK_REASONS.ready && proj && this.app.settings.showDiagnostics) {
      parts.push('<div class="cl-diag-card">');
      parts.push('<h3>\ud83d\udd0d 诊断</h3>');
      if (proj.stats) {
        parts.push('<div class="cl-stat-row"><span>时间标签</span><span>' + proj.stats.paired + '/' + proj.stats.total + ' 配对</span></div>');
        parts.push('<div class="cl-stat-row"><span>校准</span><span>' + proj.stats.calibrated + ' 次</span></div>');
        if (proj.stats.unparseable > 0) parts.push('<div class="cl-stat-row cl-stat-warn"><span>不可解析</span><span>' + proj.stats.unparseable + '</span></div>');
      }
      if (proj.worldClock) {
        parts.push('<div class="cl-stat-row"><span>世界钟</span><span>已读</span></div>');
      }
      if (proj.anchor) {
        parts.push('<div class="cl-stat-row"><span>锚点</span><span>有</span></div>');
      }
      /* [v4.141.0 · R21-O2] 内容时间轴收口进度：x/y（story 档欠债清零即 0 待收口）。 */
      parts.push('<div class="cl-stat-row"><span>时间轴收口</span><span>' + TIME_DEBT_READINGS.storyClosed + '/' + TIME_DEBT_READINGS.total + (TIME_DEBT_READINGS.storyPending > 0 ? ' · 待收口 ' + TIME_DEBT_READINGS.storyPending : ' · 已清零') + '</span></div>');
      parts.push('</div>');
    }

    // Settings card
    parts.push('<div class="cl-settings">');
    parts.push('<h3>\u2699\ufe0f 设置</h3>');
    parts.push('<label class="cl-toggle"><input type="checkbox" id="cl-inject" ' + (this.app.settings.injectToPrompt ? 'checked' : '') + '><span>注入 Prompt</span></label>');
    parts.push('<label class="cl-toggle"><input type="checkbox" id="cl-diag" ' + (this.app.settings.showDiagnostics ? 'checked' : '') + '><span>显示诊断</span></label>');
    parts.push('</div>');

    /* [v4.209.0 · 照官方那种] 官方「时钟」的『闹钟 / 秒表 / 计时器』三格**照位置画出来但禁用**
     *   （底栏 is-disabled + aria-disabled，点了在页面内给一句真话）。本仓没有闹钟调度、
     *   秒表与倒计时链路，所以它们不能切面；但藏起来会被读成「这个 App 没有这些功能」，
     *   静默会被读成「按钮坏了」——都不对，故「画出来 + 当场说实话」是唯一不撒谎的形态。 */
    parts.push('<div class="cl-absent">底栏照官方列了『闹钟 / 秒表 / 计时器』三格：'
      + '本机没有闹钟调度、秒表与倒计时链路，故三格置灰不可切，点一下会告诉你这一格为什么还没做。</div>');

    parts.push('</div>');
    parts.push(this._tabbarHtml());
    return parts.join('\n');
  }

  /* [v4.209.0 · 照官方那种] 底栏一级导航（结构与格位照 iOS「时钟」的底部页签）。
   *   判据来源写在这里，不靠记忆：Apple 官方支持两篇 ——
   *     ·「在 iPhone 上使用计时器或秒表」：「轻点『秒表』」；
   *     ·「在 iPhone 上的『时钟』中查看世界时间」：「前往『时钟』App。轻点『世界时钟』」。
   *   即「时钟」的一级入口在**页面底部**的页签上，不是页头的小胶囊。
   *   格位：官方四格原样（世界时钟 / 闹钟 / 秒表 / 计时器）+ 本仓自有「今天」排最后。
   *   未实现格**带 data-act 而不是 data-tab**：它不切面，只在页面内给一句真话。 */
  _tabbarHtml() {
    const items = this._navCells().map((t) => {
      if (t.disabled) {
        return '<button type="button" class="cl-tabbar-item is-disabled"'
          + ' data-act="cl-soon" data-what="' + this._esc(t.label) + '"'
          + ' data-why="' + this._esc(t.why || '') + '"'
          + ' aria-disabled="true" aria-current="false">'
          + this._esc(t.label) + '</button>';
      }
      const on = this._tab === t.key;
      return '<button type="button" class="cl-tabbar-item' + (on ? ' is-on' : '') + '"'
        + ' data-tab="' + t.key + '" aria-current="' + (on ? 'page' : 'false') + '">'
        + this._esc(t.label) + '</button>';
    }).join('');
    return '<nav class="cl-tabbar" role="navigation" aria-label="主导航">' + items + '</nav>';
  }

  /* 页面内提示条（不碰宿主 alert —— 那会卡住 SillyTavern 的消息流）。
   *   生命周期：只保留一条，重复点击刷新文案并重置计时；重绘/切面时由 _clearToast 收掉。 */
  _toast(msg) {
    if (!this._root) return;
    this._clearToast();
    const bar = document.createElement('div');
    bar.className = 'cl-toast';
    bar.setAttribute('role', 'status');
    bar.textContent = String(msg || '');
    this._root.appendChild(bar);
    this._toastEl = bar;
    this._toastTimer = setTimeout(() => { this._clearToast(); }, 2600);
  }
  _clearToast() {
    if (this._toastTimer) { clearTimeout(this._toastTimer); this._toastTimer = null; }
    if (this._toastEl && this._toastEl.parentNode) this._toastEl.parentNode.removeChild(this._toastEl);
    this._toastEl = null;
  }

  /* ════════ [v4.112.0 · R13-X1] 「今天」面板 ════════
   * 五态各自画，且**每种都写清这是哪一种**：
   *   · no-clock  —— 剧情钟读不到 ⇒ 边界定不下来（不等于今天没事）
   *   · absent    —— 一个 App 都没接入（不等于今天没事）
   *   · partly    —— 只接上了一部分，且今天还没有事（还不能说今天没事）
   *   · empty     —— 都接上了，今天确实什么都没有
   *   · ok        —— 有事件
   * 压平任意两态，都会造出「处置相反的两件事长得一样」（本仓最贵的老账）。 */
  _todayHtml() {
    let res = null;
    try { res = this.app.today(); } catch (_e) { res = null; }
    const parts = [];
    parts.push('<div class="cl-today">');
    if (!res || typeof res !== 'object') {
      /* 取数口自己抛了：这是**读数坏了**，不是「今天没事」。 */
      parts.push('<div class="cl-today-face cl-face-err">今天的读数取不出来 —— 这不等于今天没事</div>');
      parts.push('</div>');
      return parts.join('\n');
    }
    const tone = (res.state === TODAY_STATES.ok) ? 'ok'
      : (res.state === TODAY_STATES.empty) ? 'mute' : 'err';
    const faceText = res.readError || res.line || '';
    parts.push('<div class="cl-today-face cl-face-' + tone + '">' + this._esc(faceText) + '</div>');

    /* 源状态：逐源一行。**没接入与今天没事必须分开写** —— 这是本项最容易被糊掉的一处。 */
    parts.push('<div class="cl-today-srcs">');
    for (const row of (res.sourceRows || [])) {
      const cls = (row.state === TODAY_SOURCE_STATES.ok) ? 'is-ok'
        : (row.state === TODAY_SOURCE_STATES.error) ? 'is-err' : 'is-off';
      const label = TODAY_SOURCE_LABEL[row.source] || row.label || row.source;
      let text;
      if (row.state === TODAY_SOURCE_STATES.ok) {
        text = label + '：今天 ' + row.count + ' 条'
          + (row.dropped ? ('，另有 ' + row.dropped + ' 条没有可用时刻没排进来') : '');
      } else if (row.state === TODAY_SOURCE_STATES.error) {
        text = label + '：读不出来（**不等于**今天没有）';
      } else {
        text = label + '：还没有接入今天';
      }
      parts.push('<div class="cl-src-row ' + cls + '">' + this._esc(text) + '</div>');
    }
    parts.push('</div>');

    const events = Array.isArray(res.events) ? res.events : [];
    if (events.length) {
      parts.push('<div class="cl-tl">');
      for (const ev of events) {
        const jumpApp = TODAY_JUMP_APP[ev.source] || '';
        parts.push('<div class="cl-tl-row">');
        parts.push('<span class="cl-tl-at">' + this._esc(this._todayTime(ev.at)) + '</span>');
        parts.push('<span class="cl-tl-src">' + this._esc(ev.sourceLabel || ev.source) + '</span>');
        parts.push('<span class="cl-tl-title">' + this._esc(ev.title || '（这一条没有标题）') + '</span>');
        if (jumpApp) {
          /* 文案由**靶心在不在**决定（见 TODAY_JUMP_APP 头注）：
           *   有靶心 ⇒ 「打开这一条」（真能落到那一条）；没靶心 ⇒ 「打开 X」（不承诺做不到的事）。
           *   data-today-ref 只在有靶心时写，派发时才带 ref —— 空串靶心不投。 */
          const refJson = ev && ev.ref ? this._esc(JSON.stringify(ev.ref)) : '';
          const label = refJson ? ('打开这一条') : ('打开' + (ev.sourceLabel || ''));
          parts.push('<button type="button" class="cl-tl-go" data-today-app="' + this._esc(jumpApp)
            + (refJson ? ('" data-today-ref="' + refJson) : '"')
            + ' title="' + this._esc(refJson ? ('落到' + (ev.sourceLabel || '') + '的那一条') : ('只打开' + (ev.sourceLabel || '') + '，落不到具体那一条'))
            + '">' + this._esc(label) + '</button>');
        }
        parts.push('</div>');
      }
      parts.push('</div>');
      if (Number(res.truncated) > 0) {
        parts.push('<div class="cl-today-cut">另有 ' + Number(res.truncated) + ' 条没排进来（本次只排了前 '
          + TODAY_SOURCES.length + ' 类里的 ' + events.length + ' 条）</div>');
      }
    }
    parts.push('</div>');
    return parts.join('\n');
  }

  /** 时刻人话：读不出来就说读不出来，**不编一个日期**。 */
  _todayTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '时间不可知';
    try {
      const d = new Date(n);
      const p2 = (x) => String(x).padStart(2, '0');
      return p2(d.getHours()) + ':' + p2(d.getMinutes());
    } catch (_e) { return '时间不可知'; }
  }

  _bindEvents() {
    /* [v4.112.0 · R13-X1] 页签切换与「打开某个 App」都走容器级委托：
     *   面板是整段 innerHTML 重绘的，逐按钮挂监听会在每次 refresh 后失效（本仓治过同款）。 */
    if (this._root && !this._delegated) {
      this._root.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.getAttribute) return;
        const tab = t.getAttribute('data-tab');
        if (tab) { this._switchTab(tab); this.refresh(); return; }
        /* [v4.209.0] 未实现格：不切面、不静默，只给一句真话（页面内提示条，不碰宿主 alert）。 */
        if (t.getAttribute('data-act') === 'cl-soon') {
          const what = t.getAttribute('data-what') || '这一格';
          const why = t.getAttribute('data-why') || '';
          this._toast('「' + what + '」本机还没做' + (why ? '：' + why : '') + '。');
          return;
        }
        const appId = t.getAttribute('data-today-app');
        if (appId) {
          /* [v4.119.0 · R14-O3] 有靶心就投靶心（落到那一条），没靶心只开 App。
           *   载荷走唯一一支笔（buildOpenDetail）：手拼 { appId, ref } 会让「字段名一漂」
           *   又回到本仓老账上（ref / openRef / target 三种写法同时在）。
           *    ★ ref 解析失败不静默吞：退为只开 App 并报原因（与 search-view 同款）。 */
          let ref = null;
          const refRaw = t.getAttribute('data-today-ref') || '';
          if (refRaw) {
            try { ref = JSON.parse(refRaw); }
            catch (_e) {
              ref = null;
              try { console.warn('[clock] 今天的靶心读不出（退为只开 App）', refRaw); } catch (_e2) { /* 无 console 也不影响结论 */ }
            }
          }
          try {
            const win = (typeof window !== 'undefined') ? window : globalThis;
            win.dispatchEvent(new CustomEvent('phone:openApp', { detail: buildOpenDetail(appId, null, ref) }));
          } catch (_e) {
            /* 宿主不在（判据环境）：不假装开了。 */
          }
        }
      });
      this._delegated = true;
    }
    const inject = this._root.querySelector('#cl-inject');
    const diag = this._root.querySelector('#cl-diag');
    if (inject) inject.addEventListener('change', (e) => {
      this.app.settings.injectToPrompt = e.target.checked;
      this.app.saveSettings();
    });
    if (diag) diag.addEventListener('change', (e) => {
      this.app.settings.showDiagnostics = e.target.checked;
      this.app.saveSettings();
      this.refresh();
    });
  }

  _precLabel(p) {
    if (p === 'day') return '精确';
    if (p === 'approximate') return '约数';
    return '未知';
  }

  _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
