/* ============================================================
 * apps/games/mystery/mystery-view.js — [v4.102.0 · R13-O3]
 *   「推理谜题」视图：mystery-engine 的第一个产品端界面
 * ------------------------------------------------------------
 * 【这一页只做三件事，顺序也是玩家的顺序】
 *   ① 看证据：已发现的线索排成列表，未读的标「未读」，读过的才展开正文；
 *   ② 去问人：每个证人一列，点一条线索就问一句，回答分「不知道 / 知情但没读 / 确认」三档；
 *   ③ 提假说：选一条解法路径提交，结果分「还差证据 / 方向有误 / 成立」三档。
 *
 * 【纪律：本视图不判对错】
 *   对不对由 `config/mystery-engine.js` 判；怎么翻成人话由
 *   `config/mystery-face-bridge.js` 决定；本文件只管排版与事件绑定。
 *   三次「同一个词两种意思」的地方都分开说：
 *     · 证人「不知道」≠「你还没发现这条线索」；
 *     · 「还差证据」≠「推理方向有误」；
 *     · 「这一局已解开」≠「你又猜对一次」。
 *
 * 【诚实边界】
 *   · 内置的示例谜题是**一个可玩的例子**，不是内容库；
 *   · 进度只活在这一页（离开即重置）。要跨会话存档，得先把 progress
 *     接到 storage —— 那是下一格，本版不做，也不假装做了。
 * ============================================================ */
import {
  startSampleRun,
  readClue,
  askAndRead,
  submitAndRead,
  discoveredRows,
  witnessRows,
  runStatus,
} from '../../../config/mystery-face-bridge.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&' + 'quot;');
}

export class MysteryView {
  constructor(app) {
    this.app = app;
    this._cssLoaded = false;
    this._run = null;
    this._notice = null; // { kind:'ok'|'bad'|'info', title, detail }
    this._pickedClues = []; // 提交假说时勾中的线索
  }

  _loadCSS() {
    if (this._cssLoaded) return;
    if (document.getElementById('games-mystery-css')) { this._cssLoaded = true; return; }
    const link = document.createElement('link');
    link.id = 'games-mystery-css';
    link.rel = 'stylesheet';
    link.href = new URL('./mystery.css?v=1.0.0', import.meta.url).href;
    document.head.appendChild(link);
    this._cssLoaded = true;
  }

  /** 开局（或重新开局）。离开页面时 `_run` 丢弃 —— 不做假存档。 */
  _ensureRun() {
    if (!this._run) this._run = startSampleRun();
    return this._run;
  }

  render() {
    this._loadCSS();
    const run = this._ensureRun();
    const rows = discoveredRows(run);
    const witnesses = witnessRows(run);
    const status = runStatus(run);
    const solved = status.state === 'solved';

    const clueHtml = rows.length
      ? rows.map((r) => this._renderClue(r)).join('')
      : '<div class="gm-empty">还没有任何线索。先去问下面的人。</div>';

    const witnessHtml = witnesses.map((w) => this._renderWitness(w)).join('');

    const solutionHtml = (run.mystery.solutions || []).map((s) => {
      const need = s.requiredClueIds.map((id) => {
        const got = run.progress.readClueIds.includes(id);
        const found = run.progress.discoveredClueIds.includes(id);
        const mark = got ? '已读' : (found ? '未读' : '未发现');
        return `<span class="gm-need ${got ? 'is-got' : (found ? 'is-unread' : 'is-missing')}">${esc(id)}·${mark}</span>`;
      }).join('');
      return `
        <div class="gm-solution" data-solution="${esc(s.solutionId)}">
          <div class="gm-solution-head">
            <div class="gm-solution-title">解法 ${esc(s.solutionId)}</div>
            <button class="gm-submit" data-submit="${esc(s.solutionId)}" type="button">${solved ? '已收束' : '按这条提假说'}</button>
          </div>
          <div class="gm-solution-need">需要 ${need}</div>
        </div>`;
    }).join('');

    const notice = this._notice
      ? `<div class="gm-notice gm-notice-${esc(this._notice.kind)}">
           <div class="gm-notice-title">${esc(this._notice.title)}</div>
           <div class="gm-notice-detail">${esc(this._notice.detail)}</div>
         </div>`
      : '';

    const html = `
      <div class="games-app gm-app">
        <div class="gm-top">
          <button class="gm-icon" id="gm-back-lobby" type="button"><i class="fa-solid fa-chevron-left"></i></button>
          <div>
            <div class="gm-title">${esc(run.mystery.title)}</div>
            <div class="gm-sub">${esc(status.text)}</div>
          </div>
          <button class="gm-icon" id="gm-restart" type="button">重开</button>
        </div>
        <div class="gm-body">
          ${notice}
          <div class="gm-section">
            <div class="gm-section-title">证据</div>
            <div class="gm-clues">${clueHtml}</div>
          </div>
          <div class="gm-section">
            <div class="gm-section-title">问人</div>
            <div class="gm-witnesses">${witnessHtml}</div>
          </div>
          <div class="gm-section">
            <div class="gm-section-title">提假说</div>
            <div class="gm-solutions">${solutionHtml}</div>
          </div>
          <div class="gm-foot">示例谜题只是例子，不是内容库。进度离开本页即重置。</div>
        </div>
      </div>`;
    this.app.phoneShell.setContent(html, 'games-mystery');
    this._bind();
  }

  _renderClue(r) {
    const cls = ['gm-clue'];
    if (r.isRead) cls.push('is-read');
    if (r.isRedHerring) cls.push('is-red');
    const body = r.isRead
      ? `<div class="gm-clue-text">${esc(r.text)}</div>`
      : `<div class="gm-clue-text is-hidden">还没读。点一下展开。</div>`;
    const readBtn = r.isRead
      ? ''
      : `<button class="gm-read" data-read="${esc(r.id)}" type="button">读</button>`;
    return `
      <div class="${cls.join(' ')}" data-clue="${esc(r.id)}">
        <div class="gm-clue-head">
          <span class="gm-clue-id">${esc(r.id)}</span>
          ${r.isRedHerring ? '<span class="gm-tag">无用</span>' : ''}
          ${readBtn}
        </div>
        ${body}
      </div>`;
  }

  _renderWitness(w) {
    const run = this._run;
    const all = (run.mystery.clues || []).map((c) => c.id);
    const opts = all.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
    return `
      <div class="gm-witness" data-witness="${esc(w.id)}">
        <div class="gm-witness-name">${esc(w.actorId)}</div>
        <div class="gm-witness-row">
          <select class="gm-witness-pick" data-witness-pick="${esc(w.id)}">${opts}</select>
          <button class="gm-ask" data-ask="${esc(w.id)}" type="button">问</button>
        </div>
        <div class="gm-witness-said" data-said="${esc(w.id)}"></div>
      </div>`;
  }

  _bind() {
    document.getElementById('gm-back-lobby')?.addEventListener('click', () => {
      this._run = null;
      this.app.backToLobby();
    });
    document.getElementById('gm-restart')?.addEventListener('click', () => {
      this._run = null;
      this._notice = { kind: 'info', title: '重新开局', detail: '证据都收回去了' };
      this.render();
    });
    document.querySelectorAll('[data-read]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-read');
        const res = readClue(this._run, id);
        this._notice = res.ok
          ? { kind: 'info', title: '读到一条线索', detail: res.text }
          : { kind: 'bad', title: '读不到', detail: res.why };
        this.render();
      });
    });
    document.querySelectorAll('[data-ask]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wid = btn.getAttribute('data-ask');
        const sel = document.querySelector(`[data-witness-pick="${wid}"]`);
        const cid = sel ? sel.value : '';
        const res = askAndRead(this._run, wid, cid);
        const said = document.querySelector(`[data-said="${wid}"]`);
        const own = (witnessRows(this._run).find((w) => w.id === wid) || {}).actorId || wid;
        if (said) {
          said.textContent = res.ok ? res.text : res.why;
          said.className = 'gm-witness-said ' + (res.ok ? 'is-answer' : 'is-refuse');
        }
        /* 只有真的「承认知情」才重渲染（证据区多了一条），其余留在原地不闪屏 */
        if (res.ok && res.discovered && res.discovered.length) {
          this._notice = { kind: 'ok', title: own + ' 承认知情', detail: '证据区多了一条（还没读）' };
          this.render();
        }
      });
    });
    document.querySelectorAll('[data-submit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.getAttribute('data-submit');
        const res = submitAndRead(this._run, sid);
        const kind = res.verdict === 'solved' ? 'ok' : (res.verdict === 'wrong' ? 'bad' : 'info');
        this._notice = { kind, title: res.title, detail: res.detail };
        this.render();
      });
    });
  }

  handleBack() {
    /* 返回键：先回大厅（与其它小游戏一致），不吞掉返回 */
    this._run = null;
    this.app.backToLobby();
    return true;
  }

  destroy() {
    this._run = null;
    this._notice = null;
    this._pickedClues = [];
  }
}