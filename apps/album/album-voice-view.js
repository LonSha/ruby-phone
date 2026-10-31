/* ============================================================
 * apps/album/album-voice-view.js — [v4.102.0 · R13-O3]
 *   「声音叙事」页：voice-narrative 的第一个产品端界面（挂在相册里）
 * ------------------------------------------------------------
 * 【为什么放在相册而不是新开一个 App】
 *   计划书 O3 的落点写的是「接 `apps/album` 音频面」。相册已经是「看/听已存下来的东西」
 *   的那一屏，演出项目本身就是一种已存下来的东西；新开 App 会让它在应用库里多一个格子，
 *   而它现在还只有一个示例场景 —— 不值一个独立入口。
 *
 * 【这一页的三段结构，对应内核的三条验收】
 *   ① 时间轴：每一段一行，说清「谁在说 / 说什么 / 多久 / 有没有音频」；
 *      没有音频的行必须写下**为什么**（没 TTS / 素材不在 / 没指定）。
 *   ② 预演：只有文字。按钮只推进「现在演到哪」，不播放任何声音 ——
 *      本页不持有 <audio>，因为库里没有真音频，假装播就是把缺失说成成功。
 *   ③ 改一句：改一条台词 → 这一段标「待重制」，其余段不动；
 *      按「这段重制好了」只清这一段。界面上有**一个能数出来的数字**。
 *
 * 【诚实边界】
 *   · 本页不调用 TTS、不播音频：它只证明「内核的编排能力有了一扇门」；
 *   · 示例场景是一个例子，不是内容库；
 *   · 改词只活在这一次打开里（离开即丢）；要存档得先把 project 接到 storage，本版不做。
 * ============================================================ */
import {
  startSampleRun,
  previewRows,
  stepAndRead,
  replaceLineAndRead,
  markRendered,
  dirtyRows,
  runStatus,
} from '../../config/voice-face-bridge.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&' + 'quot;');
}

function fmtMs(ms) {
  const t = Math.max(0, Math.round(Number(ms) || 0));
  const s = Math.round(t / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? (m + '′' + String(r).padStart(2, '0') + '″') : (r + '″');
}

/** 独立样式表：与 album.css 分开，避免把演出页的规则塞进相册主样式。 */
const VOICE_CSS_URL = new URL('./album-voice.css?v=1.0.0', import.meta.url).href;

export class AlbumVoiceView {
  constructor(app) {
    this.app = app;
    this._cssLoaded = false;
    this._run = null;
    this._notice = null;
    this._editing = ''; // 正在改词的 cueId
    this._playing = ''; // 预演指针（cueId）
  }

  _loadCSS() {
    if (this._cssLoaded) return;
    if (document.getElementById('album-voice-css')) { this._cssLoaded = true; return; }
    const link = document.createElement('link');
    link.id = 'album-voice-css';
    link.rel = 'stylesheet';
    link.href = VOICE_CSS_URL;
    document.head.appendChild(link);
    this._cssLoaded = true;
  }

  _ensureRun() {
    if (!this._run) this._run = startSampleRun();
    return this._run;
  }

  /**
   * 可用性由宿主决定，本视图不探测。
   * 现状：本仓没有接 TTS 服务，素材库也没有这些音效 —— 因此**如实报缺**。
   * 若哪天接了 TTS，只改这一处：把 ttsAvailable 交给宿主真值。
   */
  _availability() {
    return { ttsAvailable: false, assets: {} };
  }

  render() {
    this._loadCSS();
    const run = this._ensureRun();
    const prev = previewRows(run, this._availability());
    const status = runStatus(run);
    const dirty = dirtyRows(run);
    const dirtyIds = new Set(dirty.map((d) => d.cueId));

    const rowsHtml = prev.rows.map((r) => {
      const cls = ['av-row'];
      if (r.cueId === this._playing) cls.push('is-now');
      if (dirtyIds.has(r.cueId)) cls.push('is-dirty');
      if (!r.hasAudio) cls.push('is-text-only');
      const audioTag = r.hasAudio
        ? '<span class="av-ok">有音频</span>'
        : '<span class="av-miss">' + esc(r.why || '缺音频') + '</span>';
      const canEdit = r.type === 'dialog' || r.type === 'narration';
      const editBtn = canEdit
        ? '<button class="av-mini" data-edit="' + esc(r.cueId) + '" type="button">改词</button>'
        : '';
      const rerenderBtn = dirtyIds.has(r.cueId)
        ? '<button class="av-mini av-mini-ok" data-rendered="' + esc(r.cueId) + '" type="button">这段重制好了</button>'
        : '';
      const editor = this._editing === r.cueId
        ? `<div class="av-editor">
             <textarea class="av-input" data-input="${esc(r.cueId)}" rows="2">${esc(r.text)}</textarea>
             <button class="av-mini av-mini-ok" data-save="${esc(r.cueId)}" type="button">存这一句</button>
           </div>`
        : '';
      return `
        <div class="${cls.join(' ')}" data-cue="${esc(r.cueId)}">
          <div class="av-row-head">
            <span class="av-id">${esc(r.cueId)}</span>
            <span class="av-type">${esc(r.typeLabel)}</span>
            ${r.actorId ? '<span class="av-who">' + esc(r.actorId) + '</span>' : ''}
            <span class="av-dur">${fmtMs(r.durationMs)}</span>
            ${editBtn}${rerenderBtn}
          </div>
          <div class="av-line">${r.text ? esc(r.text) : '<span class="av-silent">（无台词）</span>'}</div>
          <div class="av-audio">${audioTag}</div>
          ${editor}
        </div>`;
    }).join('');

    const dirtyHtml = dirty.length
      ? '<ul class="av-dirty-list">' + dirty.map((d) => `<li>${esc(d.cueId)} · ${esc(d.typeLabel)} · ${esc(d.text || '（无台词）')}</li>`).join('') + '</ul>'
      : '<div class="av-note">还没有改过任何一句。</div>';

    const notice = this._notice
      ? `<div class="av-notice av-notice-${esc(this._notice.kind)}">
           <div class="av-notice-title">${esc(this._notice.title)}</div>
           <div class="av-notice-detail">${esc(this._notice.detail)}</div>
         </div>`
      : '';

    const html = `
      <div class="album-app av-app">
        <header class="av-top">
          <button class="av-icon" id="av-back" type="button" aria-label="返回相册"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="av-title-wrap">
            <div class="av-title">${esc(run.project.title)}</div>
            <div class="av-sub">${esc(status.text)}</div>
          </div>
          <button class="av-icon" id="av-restart" type="button">重开</button>
        </header>
        <main class="av-body">
          ${notice}
          <div class="av-summary">${esc(prev.summary)}</div>
          <div class="av-honest">
            这一页只有文字。本机没接语音合成，素材库里也没有这些音效 ——
            所以下面每一段都写清「为什么没有音频」，不写成「已生成」。
          </div>

          <section class="av-block">
            <div class="av-block-title">预演</div>
            <div class="av-controls">
              <button class="av-btn" data-act="play" type="button">从头</button>
              <button class="av-btn" data-act="next" type="button">下一段</button>
              <button class="av-btn" data-act="pause" type="button">暂停</button>
              <button class="av-btn" data-act="resume" type="button">继续</button>
              <button class="av-btn" data-act="stop" type="button">停下</button>
            </div>
            <div class="av-now" id="av-now">${this._playing ? '现在演到 ' + esc(this._playing) : '还没开始'}</div>
          </section>

          <section class="av-block">
            <div class="av-block-title">待重制 <span class="av-count">${dirty.length}</span></div>
            ${dirtyHtml}
          </section>

          <section class="av-block">
            <div class="av-block-title">时间轴</div>
            <div class="av-rows">${rowsHtml}</div>
          </section>

          <div class="av-foot">示例场景只是例子。改词只活在这一次打开里，离开即丢。</div>
        </main>
      </div>`;
    this.app.phoneShell.setContent(html, 'album-voice');
    this._bind();
  }

  _bind() {
    document.getElementById('av-back')?.addEventListener('click', () => {
      this._run = null;
      this._playing = '';
      this._editing = '';
      this.voiceMode = false;
      this.app.albumView.replayMode = false;
      this.app.albumView.render();
    });
    document.getElementById('av-restart')?.addEventListener('click', () => {
      this._run = null;
      this._playing = '';
      this._editing = '';
      this._notice = { kind: 'info', title: '重新开局', detail: '改过的词都回去了' };
      this.render();
    });
    document.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        const res = stepAndRead(this._run, act);
        if (res.cueId) this._playing = res.cueId;
        if (act === 'play' || act === 'stop') this._playing = act === 'stop' ? '' : this._playing;
        this._notice = { kind: res.ok ? 'ok' : 'info', title: res.text, detail: '' };
        this.render();
      });
    });
    document.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._editing = btn.getAttribute('data-edit');
        this._notice = null;
        this.render();
      });
    });
    document.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cueId = btn.getAttribute('data-save');
        const input = document.querySelector(`[data-input="${cueId}"]`);
        const text = input ? String(input.value || '') : '';
        const res = replaceLineAndRead(this._run, cueId, text);
        this._editing = '';
        this._notice = res.ok
          ? { kind: 'info', title: '换好了 ' + cueId, detail: '只有这一段标了待重制；其余 ' + (res.dirtyCount > 1 ? '连同之前的 ' + (res.dirtyCount - 1) + ' 段' : '段落') + '不受影响。' }
          : { kind: 'bad', title: '换不了', detail: res.why || '' };
        this.render();
      });
    });
    document.querySelectorAll('[data-rendered]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cueId = btn.getAttribute('data-rendered');
        const res = markRendered(this._run, cueId);
        this._notice = res.ok
          ? { kind: 'ok', title: '记下了：' + cueId + ' 已重制', detail: res.dirtyCount ? ('还欠 ' + res.dirtyCount + ' 段') : '这一场没有欠账了' }
          : { kind: 'bad', title: '找不到这一段', detail: '' };
        this.render();
      });
    });
  }

  /** 返回键：从演出页退回相册主列表（不是退到应用库）。 */
  handleBack() {
    /* 「退一层」：演出页 → 相册主列表；再由相册自己的 handleSwipeBack 决定下一步。
     * 返回 true 表示「这一层吃掉了返回」，不会一路退到应用库。 */
    this._run = null;
    this._playing = '';
    this._editing = '';
    this.voiceMode = false;
    this.app.albumView.replayMode = false;
    this.app.albumView.render();
    return true;
  }

  destroy() {
    this._run = null;
    this._notice = null;
    this._editing = '';
    this._playing = '';
  }
}