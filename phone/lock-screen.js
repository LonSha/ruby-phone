/**
 * 锁屏 [v2.16.0 升级]
 * 交互参考 ovo066/kktest LockScreen：上滑解锁，显示时间/日期/电量。
 *
 * v2.16.0 新增（系统层补强的一部分）：
 *  - 时段问候（凌晨/早上/中午/下午/傍晚/深夜）
 *  - 通知速览：读取通知中心落账层（sys_notifs），锁屏即可见最近 5 条未读，
 *    轻点整块跳转通知中心。此前通知一闪即逝，锁屏是唯一能「回看」的入口。
 *  - 音乐卡：正在播放时展示曲目（与 MusicApp 真实联动）。
 * 全部为可选能力：通知层/音乐层缺失时自动降级为原锁屏，不抛异常。
 */

import { currentTrack as _currentTrack } from '../config/system-controls.js';

function _esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\u0022/g, '&#34;').replace(/'/g, '&#39;');
}

export class LockScreen {
  constructor(phoneShell) {
    this.phoneShell = phoneShell;
    this.locked = false;
    this._root = null;
    this._startY = 0;
    this._dragging = false;
    this._clockTimer = null;
  }

  isLocked() {
    return this.locked;
  }

  lock() {
    if (this.locked) return;
    this.locked = true;
    this.render();
  }

  unlock() {
    this.locked = false;
    this._clearClock();
    this._root?.remove();
    this._root = null;
    this.phoneShell?.container?.classList.remove('screen-off');
  }

  toggle() {
    if (this.locked) this.unlock();
    else this.lock();
  }

  _clearClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  }

  _pad(n) {
    return String(n).padStart(2, '0');
  }

  _nowParts() {
    const d = new Date();
    const weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return {
      time: d.getHours() + ':' + this._pad(d.getMinutes()),
      date: (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weeks[d.getDay()],
      greeting: this._greeting(d.getHours())
    };
  }

  /** [v2.16.0] 时段问候 */
  _greeting(hour) {
    const h = Number(hour) || 0;
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 22) return '晚上好';
    return '夜深了';
  }

  _wallpaper() {
    try {
      return window.VirtualPhone?.imageManager?.getWallpaper?.()
        || window.VirtualPhone?.storage?.get?.('phone-wallpaper')
        || '';
    } catch (e) {
      return '';
    }
  }

  _battery() {
    const n = Number(this.phoneShell?.batteryLevel);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 78;
  }

  /** [v2.16.0] 最近未读通知（最多 5 条）；无通知层则返回空数组 */
  _recentNotifications() {
    try {
      const log = window.VirtualPhone?.notificationLog;
      if (!log || typeof log.list !== 'function') return [];
      return (log.list() || []).filter(n => n && !n.read).slice(0, 5);
    } catch (_e) { return []; }
  }

  /** [v2.16.0] 正在播放的曲目；无音乐则返回 null（复用 system-controls 单一真源） */
  _nowPlaying() {
    const t = _currentTrack();
    if (!t || !t.playing) return null;
    return { title: t.title || '未知曲目', artist: t.artist || '' };
  }

  render() {
    const host = this.phoneShell?.container;
    if (!host) return;
    this._root?.remove();
    const parts = this._nowParts();
    const wp = this._wallpaper();
    const bat = this._battery();
    const notes = this._recentNotifications();
    const track = this._nowPlaying();
    const root = document.createElement('div');
    root.className = 'phone-lockscreen';
    if (wp) root.style.backgroundImage = "url('" + String(wp).replace(/'/g, '%27') + "')";
    const notesHtml = notes.length
      ? `<div class="pls-notes" id="pls-notes">
           <div class="pls-notes-head">通知 ${notes.length}</div>
           ${notes.map(n => `
             <div class="pls-note" data-id="${_esc(n.id || '')}" data-app="${_esc(n.appId || '')}">
               <span class="pls-note-icon">${_esc(n.icon || '🔔')}</span>
               <span class="pls-note-body">
                 <span class="pls-note-title">${_esc(n.title || '')}</span>
                 <span class="pls-note-msg">${_esc(n.message || '')}</span>
               </span>
             </div>`).join('')}
         </div>`
      : '';
    const trackHtml = track
      ? `<div class="pls-track"><span class="pls-track-icon">🎵</span><span class="pls-track-title">${_esc(track.title)}</span>${track.artist ? `<span class="pls-track-artist">${_esc(track.artist)}</span>` : ''}</div>`
      : '';
    root.innerHTML =
      '<div class="pls-shade"></div>' +
      '<div class="pls-hello" id="pls-hello">' + _esc(parts.greeting) + '</div>' +
      '<div class="pls-date" id="pls-date">' + parts.date + '</div>' +
      '<div class="pls-time" id="pls-time">' + parts.time + '</div>' +
      '<div class="pls-battery">电量 ' + bat + '%</div>' +
      trackHtml +
      notesHtml +
      '<div class="pls-hint">上滑解锁</div>';
    host.appendChild(root);
    this._root = root;
    this._bind(root);
    this._clearClock();
    this._clockTimer = setInterval(() => {
      const next = this._nowParts();
      const timeEl = root.querySelector('#pls-time');
      const dateEl = root.querySelector('#pls-date');
      const helloEl = root.querySelector('#pls-hello');
      if (timeEl) timeEl.textContent = next.time;
      if (dateEl) dateEl.textContent = next.date;
      if (helloEl) helloEl.textContent = next.greeting;
    }, 10000);
  }

  _bind(root) {
    const onStart = (y) => { this._dragging = true; this._startY = y; };
    const onMove = (y) => {
      if (!this._dragging) return;
      const dy = this._startY - y;
      if (dy > 0) root.style.transform = 'translateY(' + (-dy) + 'px)';
    };
    const onEnd = (y) => {
      if (!this._dragging) return;
      this._dragging = false;
      const dy = this._startY - y;
      root.style.transform = '';
      if (dy > 72) this.unlock();
    };
    root.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY), { passive: true });
    root.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY), { passive: true });
    root.addEventListener('touchend', (e) => onEnd((e.changedTouches[0] || {}).clientY || this._startY));
    root.addEventListener('mousedown', (e) => onStart(e.clientY));
    window.addEventListener('mousemove', (e) => { if (this._dragging) onMove(e.clientY); });
    window.addEventListener('mouseup', (e) => { if (this._dragging) onEnd(e.clientY); });
    // [v2.16.0] 轻点通知速览 → 解锁并进通知中心（点击不产生位移，故不会误触解锁）
    // [v2.17.0] 升级：单条通知各自直达其来源 App（单击条目），系统通知（__sys__）与空白区仍进通知中心。
    //   点击不产生位移，故不会误触解锁；单条点击先标记该条已读并同步宿主角标。
    const _jump = (appId) => {
      this.unlock();
      setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId } }));
        } catch (_e) { /* 忽略 */ }
      }, 30);
    };
    root.querySelectorAll('.pls-note').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const nid = String(el.dataset.id || '');
        const appId = String(el.dataset.app || '');
        try {
          if (nid) window.VirtualPhone?.notificationLog?.markRead?.(nid);
          window.VirtualPhone?.syncNotificationsBadge?.();
        } catch (_e) { /* 忽略 */ }
        _jump(appId && appId !== '__sys__' ? appId : 'notifications');
      });
    });
    root.querySelector('#pls-notes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _jump('notifications');
    });
  }
}

export default LockScreen;