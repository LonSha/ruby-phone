/**
 * 锁屏
 * 交互参考 ovo066/kktest LockScreen：上滑解锁，显示时间/日期/电量
 */

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
    };
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

  render() {
    const host = this.phoneShell?.container;
    if (!host) return;
    this._root?.remove();
    const parts = this._nowParts();
    const wp = this._wallpaper();
    const bat = this._battery();
    const root = document.createElement('div');
    root.className = 'phone-lockscreen';
    if (wp) root.style.backgroundImage = "url('" + wp.replace(/'/g, '%27') + "')";
    root.innerHTML =
      '<div class="pls-shade"></div>' +
      '<div class="pls-date" id="pls-date">' + parts.date + '</div>' +
      '<div class="pls-time" id="pls-time">' + parts.time + '</div>' +
      '<div class="pls-battery">电量 ' + bat + '%</div>' +
      '<div class="pls-hint">上滑解锁</div>';
    host.appendChild(root);
    this._root = root;
    this._bind(root);
    this._clearClock();
    this._clockTimer = setInterval(() => {
      const next = this._nowParts();
      const timeEl = root.querySelector('#pls-time');
      const dateEl = root.querySelector('#pls-date');
      if (timeEl) timeEl.textContent = next.time;
      if (dateEl) dateEl.textContent = next.date;
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
  }
}

export default LockScreen;
