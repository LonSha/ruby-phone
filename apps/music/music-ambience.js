/* ========================================================
 *  音乐氛围增强 (Music Ambience)
 *  移植自 Selene Music v2.10.17 精华:
 *   1. 桌面歌词 (Desktop Lyrics): fixed 顶层浮动歌词条
 *   2. MediaSession 媒体会话: 锁屏/系统媒体中心显示歌曲与进度
 *   3. 时间轴歌词推进: timeupdate 驱动, 显示当前句
 *  零侵入: 挂到 MusicData.audioPlayer 事件 + 读公开状态
 * ======================================================== */

const LYRICS_ROOT_ID = 'ruby-phone-desktop-lyrics';
const KEY = 'ruby_phone_lyrics_settings';

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
      position: { left: 50, top: 92 } // 百分比
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
        .map(x => ({ time: Number(x.t ?? x.time ?? 0), text: String(x.txt || x.text || '') }))
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
    this._boundPlay = () => { this._setMediaSessionPlayback(true); };
    this._boundPause = () => { this._setMediaSessionPlayback(false); };
    this._boundEnded = () => { this._setMediaSessionPlayback(false); };
    this._boundMeta = () => { this._updateMediaMetadata(); };
    this.audio.addEventListener('timeupdate', this._boundTimeupdate);
    this.audio.addEventListener('play', this._boundPlay);
    this.audio.addEventListener('pause', this._boundPause);
    this.audio.addEventListener('ended', this._boundEnded);
    this.audio.addEventListener('loadedmetadata', this._boundMeta);
    this._ensureLyricEl();
    this._updateMediaMetadata();
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
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name || '未知歌曲',
        artist: song.artist || 'RubyPhone',
        album: 'RubyPhone 音乐'
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
    const list = md.getActiveList ? md.getActiveList() : null;
    if (Array.isArray(list) && md.currentIndex >= 0) return list[md.currentIndex] || null;
    if (md._cardData) return md._cardData;
    return null;
  }
}

export default MusicAmbience;