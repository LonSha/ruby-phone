/* ========================================================
 *  音乐氛围增强 (Music Ambience)
 *  移植自 Selene Music v2.10.17 精华:
 *   1. 桌面歌词 (Desktop Lyrics): fixed 顶层浮动歌词条
 *   2. MediaSession 媒体会话: 锁屏/系统媒体中心显示歌曲与进度
 *   3. 时间轴歌词推进: timeupdate 驱动, 显示当前句
 *  零侵入: 挂到 MusicData.audioPlayer 事件 + 读公开状态
 *
 *  [v3.24.0 · L0-2] 场景环境音（L0 素材第 4 类）：
 *   5 条 30 秒环境音（`assets/sounds/ambience/`）作为**可叠加的背景层**，
 *   与歌曲同时播放（各自一个 Audio 实例，互不抢声道）。
 *   · 素材路径只在取数口 `config/l0-assets.js` 一处拼 —— 本文件不写 assets 路径；
 *   · key 落进已有的 `ruby_phone_lyrics_settings`（不新增 storage 键）；
 *   · **惰性创建**：只有真的选了环境音才 new Audio()，否则这 1.2MB 一条都不加载。
 * ======================================================== */
import { L0_ASSETS } from '../../config/l0-assets.js';

const LYRICS_ROOT_ID = 'ruby-phone-desktop-lyrics';
const KEY = 'ruby_phone_lyrics_settings';

/* 环境音清单（key → {label, url}），唯一真源在取数口 */
const AMBIENCE_LIST = L0_ASSETS.ambience;
const AMBIENCE_BY_KEY = Object.freeze(Object.fromEntries(AMBIENCE_LIST.map((a) => [a.key, a])));

export class MusicAmbience {
  constructor(musicData) {
    this.musicData = musicData;
    this.audio = musicData.audioPlayer || (musicData.audioElement);
    this.settings = this._load();
    this.lyricTimeline = [];
    this.lyricIndex = -1;
    this.currentWords = '';
    this._boundTimeupdate = null;
    this._boundPlay = null;
    this._boundPause = null;
    this._boundEnded = null;
    this._boundMeta = null;
    this.el = null;
    this.textEl = null;
    /* [v3.24.0 · L0-2] 环境音层：一个 Audio 实例 + 当前 key（惰性创建，见 _ensureAmbienceAudio） */
    this._ambienceAudio = null;
    this._ambienceKey = '';
  }

  _load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? { ...this._defaults(), ...JSON.parse(raw) } : this._defaults();
    } catch (e) { return this._defaults(); }
  }

  _defaults() {
    return {
      desktopLyrics: false,   // 桌面歌词默认关 (避免打扰)
      mobileLyrics: true,     // 手机内歌词默认开
      lyricColor: '#f2cf70',
      fontSize: 14,
      position: { left: 50, top: 92 }, // 百分比
      ambienceKey: '',        // [v3.24.0 · L0-2] 场景环境音 key（''=关）
      ambienceVolume: 0.35    // [v3.24.0 · L0-2] 环境音音量（相对歌曲，默认压低）
    };
  }

  save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch (e) {}
  }

  /** 解析歌词为时间轴: [{time, text}] — 兼容 LRC 字符串 与 [{t,txt,tr}] 数组 */
  parseLyrics(lrc) {
    // 数组格式 (RubyPhone MusicData._fetchLyrics 返回)
    if (Array.isArray(lrc)) {
      return lrc
        .filter(x => x && (x.txt || x.text))
        .map(x => {
          const raw = Number(x.t ?? x.time ?? 0);
          // MusicData._parseLrc 用秒; 若已是毫秒(>10000 且看起来不像 2.7 小时内的秒)保持原值
          const ms = raw > 0 && raw < 10000 ? raw * 1000 : raw;
          return { time: ms, text: String(x.txt || x.text || '') };
        })
        .filter(x => x.text && isFinite(x.time))
        .sort((a, b) => a.time - b.time);
    }
    const text = this._lyricText(lrc);
    if (!text) return [];
    const lines = [];
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    // 先找时间标签行
    const rows = text.split('\n');
    for (const row of rows) {
      const times = [];
      let m;
      const re2 = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      while ((m = re2.exec(row)) !== null) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const frac = m[3] ? parseInt(m[3], 10) : 0;
        const ms = min * 60000 + sec * 1000 + (m[3] && m[3].length === 2 ? frac * 10 : frac);
        times.push(ms);
      }
      const content = row.replace(/\[[^\]]*\]/g, '').trim();
      if (!content) continue;
      for (const t of times) lines.push({ time: t, text: content });
    }
    lines.sort((a, b) => a.time - b.time);
    return lines;
  }

  _lyricText(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    for (const k of ['lyric', 'lrc', 'text', 'content']) {
      if (typeof value[k] === 'string' && value[k]) return value[k];
    }
    return '';
  }

  /** 设置当前歌词 (歌曲切换时调用) */
  setLyric(rawLyric) {
    this.lyricTimeline = this.parseLyrics(rawLyric);
    this.lyricIndex = -1;
    this.currentWords = '';
    this._paint();
  }

  /** 从当前歌曲同步歌词 (状态变化时调用) */
  syncFromSong() {
    try {
      const song = this._currentSong();
      if (!song) return;
      const lrc = song.lrc || song.lyric || null;
      const sig = Array.isArray(lrc) ? lrc.length : String(lrc || '').length;
      if (sig !== this._lastLyricSig) {
        this._lastLyricSig = sig;
        this.setLyric(lrc);
      }
      this._updateMediaMetadata();
    } catch (e) {}
  }

  /** 当前播放句 (按时间推进) */
  _currentLine(timeMs) {
    if (!this.lyricTimeline.length) return '';
    let idx = -1;
    for (let i = 0; i < this.lyricTimeline.length; i++) {
      if (timeMs >= this.lyricTimeline[i].time) idx = i;
      else break;
    }
    if (idx !== this.lyricIndex) {
      this.lyricIndex = idx;
      this.currentWords = idx >= 0 ? this.lyricTimeline[idx].text : '';
    }
    return this.currentWords;
  }

  /** 挂载: 绑定 audio 事件 + 建歌词 DOM */
  attach() {
    if (!this.audio) return;
    this._boundTimeupdate = () => {
      const t = (this.audio.currentTime || 0) * 1000;
      this.currentWords = this._currentLine(t);
      this._paint();
      this._updateMediaPosition();
    };
    this._boundPlay = () => { this._setMediaSessionPlayback(true); this._resumeAmbience(); };
    this._boundPause = () => { this._setMediaSessionPlayback(false); this._pauseAmbience(); };
    this._boundEnded = () => { this._setMediaSessionPlayback(false); this._pauseAmbience(); };
    this._boundMeta = () => { this._updateMediaMetadata(); };
    this.audio.addEventListener('timeupdate', this._boundTimeupdate);
    this.audio.addEventListener('play', this._boundPlay);
    this.audio.addEventListener('pause', this._boundPause);
    this.audio.addEventListener('ended', this._boundEnded);
    this.audio.addEventListener('loadedmetadata', this._boundMeta);
    this._ensureLyricEl();
    this._updateMediaMetadata();
    this._bindMediaSessionActions();
  }

  _bindMediaSessionActions() {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setActionHandler !== 'function') return;
    const md = this.musicData;
    const bind = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {}
    };
    bind('play', () => {
      try {
        if (typeof md.resume === 'function') md.resume();
        else this.audio?.play?.();
      } catch (e) {}
    });
    bind('pause', () => { try { md.pause?.(); } catch (e) {} });
    bind('previoustrack', () => { try { md.prev?.(); } catch (e) {} });
    bind('nexttrack', () => { try { md.next?.(); } catch (e) {} });
    bind('seekto', (d) => {
      try {
        if (d && typeof d.seekTime === 'number' && this.audio) this.audio.currentTime = d.seekTime;
      } catch (e) {}
    });
  }

  detach() {
    if (!this.audio) return;
    if (this._boundTimeupdate) this.audio.removeEventListener('timeupdate', this._boundTimeupdate);
    if (this._boundPlay) this.audio.removeEventListener('play', this._boundPlay);
    if (this._boundPause) this.audio.removeEventListener('pause', this._boundPause);
    if (this._boundEnded) this.audio.removeEventListener('ended', this._boundEnded);
    if (this._boundMeta) this.audio.removeEventListener('loadedmetadata', this._boundMeta);
    this._boundTimeupdate = null;
    this._removeLyricEl();
  }

  /** 设置开关 (桌面歌词) */
  setDesktopLyrics(enabled) {
    this.settings.desktopLyrics = enabled;
    this.save();
    this._paint();
  }

  /* ==================== [v3.24.0 · L0-2] 场景环境音 ====================
   *  与歌曲**同时播放**的背景层：独立 Audio 实例 ⇒ 音量各自可控、互不暂停。
   *  素材只取 key 定位；白名单外（含 ''）一律当作「关」——
   *  素材哪天从 assets/ 里删掉，读回时会静默回到无环境音态，而不是对着 404 空播放。
   */

  /** 环境音选项（给设置面板渲染用；唯一真源在取数口） */
  static ambienceOptions() {
    return AMBIENCE_LIST.map((a) => ({ key: a.key, label: a.label }));
  }

  /** 当前环境音 key（''=关）。读回时对白名单校验，失效 key 当关。 */
  getAmbienceKey() {
    const key = String(this.settings.ambienceKey || '');
    return AMBIENCE_BY_KEY[key] ? key : '';
  }

  /** 惰性创建 Audio（只在该 key 真被选中时才加载那条 240KB 素材） */
  _ensureAmbienceAudio() {
    if (this._ambienceAudio) return this._ambienceAudio;
    try {
      const audio = new Audio();
      audio.loop = true;              // 30 秒素材无缝循环
      audio.preload = 'auto';
      this._ambienceAudio = audio;
      return audio;
    } catch (e) {
      this._ambienceAudio = null;
      return null;
    }
  }

  /**
   * 切换环境音。
   * @param {string} key 取数口清单里的 key；''/'off' 表示关闭
   * @param {{resume?: boolean}} [opts] resume=true 时切换后立即续播（面板上换音时要保持连通）
   * @returns {string} 实际生效的 key（''=已关）
   */
  setAmbience(key, opts = {}) {
    const next = AMBIENCE_BY_KEY[String(key || '')] ? String(key) : '';
    const audio = this._ambienceAudio;
    if (audio) {
      try { audio.pause(); } catch (e) { /* 忽略 */ }
    }
    this._ambienceKey = next;
    this.settings.ambienceKey = next;
    this.save();
    if (!next) return '';
    const created = this._ensureAmbienceAudio();
    if (!created) return '';
    try {
      created.src = AMBIENCE_BY_KEY[next].url;
      created.loop = true;
      created.volume = this._clampVolume(this.settings.ambienceVolume);
      if (opts.resume !== false) {
        const p = created.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放被浏览器挡住：等下一次用户手势 */ });
      }
    } catch (e) { /* 忽略 */ }
    return next;
  }

  /** 环境音音量（0~1），与歌曲音量正交 */
  setAmbienceVolume(volume) {
    this.settings.ambienceVolume = this._clampVolume(volume);
    this.save();
    if (this._ambienceAudio) {
      try { this._ambienceAudio.volume = this.settings.ambienceVolume; } catch (e) { /* 忽略 */ }
    }
    return this.settings.ambienceVolume;
  }

  getAmbienceVolume() {
    return this._clampVolume(this.settings.ambienceVolume);
  }

  _clampVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.35;
    return Math.max(0, Math.min(1, n));
  }

  /** 歌曲起播/续播时把环境音一起带上（被浏览器挡过的那次在这里补上） */
  _resumeAmbience() {
    if (!this._ambienceKey && !this.getAmbienceKey()) return;
    const key = this.getAmbienceKey();
    if (!key) return;
    const audio = this._ensureAmbienceAudio();
    if (!audio) return;
    try {
      if (!audio.src) audio.src = AMBIENCE_BY_KEY[key].url;
      audio.volume = this._clampVolume(this.settings.ambienceVolume);
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 忽略 */ });
    } catch (e) { /* 忽略 */ }
  }

  /** 暂停环境音（歌曲暂停/结束时；不销毁，key 保留） */
  _pauseAmbience() {
    if (!this._ambienceAudio) return;
    try { this._ambienceAudio.pause(); } catch (e) { /* 忽略 */ }
  }

  /** 彻底回收（清缓存 / 换会话时） */
  destroyAmbience() {
    const audio = this._ambienceAudio;
    this._ambienceAudio = null;
    this._ambienceKey = '';
    if (!audio) return;
    try {
      audio.pause();
      audio.removeAttribute?.('src');
      audio.load?.();
    } catch (e) { /* 忽略 */ }
  }


  _ensureLyricEl() {
    let el = document.getElementById(LYRICS_ROOT_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = LYRICS_ROOT_ID;
      el.className = 'rp-desktop-lyrics hidden';
      el.innerHTML = '<div class="rp-lyric-text"></div>';
      (document.body || document.documentElement).appendChild(el);
    }
    this.el = el;
    this.textEl = el.querySelector('.rp-lyric-text');
    // 移动端拖拽
    el.addEventListener('pointerdown', (e) => {
      const startX = e.clientX, startY = e.clientY;
      const baseLeft = this.settings.position.left, baseTop = this.settings.position.top;
      const move = (ev) => {
        const vw = window.innerWidth || 700;
        const vh = window.innerHeight || 900;
        this.settings.position.left = Math.max(1, Math.min(99, baseLeft + (ev.clientX - startX) / vw * 100));
        this.settings.position.top = Math.max(1, Math.min(99, baseTop + (ev.clientY - startY) / vh * 100));
        this._paint();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.save();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  _removeLyricEl() {
    document.getElementById(LYRICS_ROOT_ID)?.remove();
    this.el = null;
    this.textEl = null;
  }

  _paint() {
    const el = this.el;
    if (!el) return;
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    const enabled = mobile ? this.settings.mobileLyrics !== false : this.settings.desktopLyrics === true;
    const visible = enabled && !!this.currentWords && !!this.audio && !this.audio.paused;
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (this.textEl) this.textEl.textContent = this.currentWords;
    el.style.left = this.settings.position.left + '%';
    el.style.top = this.settings.position.top + '%';
    el.style.color = this.settings.lyricColor || '#f2cf70';
  }

  /** MediaSession 元数据 */
  _updateMediaMetadata() {
    if (!('mediaSession' in navigator)) return;
    const song = this._currentSong();
    if (!song) return;
    try {
      const artwork = [];
      const pic = song.pic || song.cover || song.Cover || '';
      if (pic) artwork.push({ src: pic, sizes: '512x512', type: 'image/jpeg' });
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name || '未知歌曲',
        artist: song.artist || 'RubyPhone',
        album: 'RubyPhone 音乐',
        artwork
      });
    } catch (e) {}
  }

  _updateMediaPosition() {
    if (!('mediaSession' in navigator) || !this.audio || !isFinite(this.audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate || 1,
        position: this.audio.currentTime || 0
      });
    } catch (e) {}
  }

  _setMediaSessionPlayback(isPlaying) {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch (e) {}
  }

  _currentSong() {
    const md = this.musicData;
    if (!md) return null;
    if (typeof md.getCurrentSong === 'function') {
      const song = md.getCurrentSong();
      if (song) return song;
    }
    const list = md.getActiveList ? md.getActiveList() : null;
    if (Array.isArray(list) && md.currentIndex >= 0) return list[md.currentIndex] || null;
    if (md._cardData) return md._cardData;
    return null;
  }
}

export default MusicAmbience;