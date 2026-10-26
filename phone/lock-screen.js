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
/* [v4.88.0] 时钟轮询的静止退避（缝自 jiangxi1129/gaze）。纯函数内核：
 *   本文件只持有 streak/interval 两个读数并按裁决自调度，不自己算倍率。 */
import { judgeGazeTick, initialGazeState } from '../config/gaze-backoff.js';

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
    /* [v4.88.0] 自调度后句柄既可能是 interval（旧路径）也可能是 timeout，两种都清。
     *   踩坑点：先置 null 再判断会让第二个 if 恒假 —— 故先取副本。 */
    const handle = this._clockTimer;
    this._clockTimer = null;
    if (handle) {
      clearInterval(handle);
      clearTimeout(handle);
    }
  }

  /** [v4.88.0] 排下一次时钟 tick（自调度：裁决给出的间隔就是下一次的延迟）。 */
  _scheduleClockTick(verdict) {
    this._clearClock();
    const ms = Math.max(200, Number(verdict?.intervalMs) || 10000);
    this._clockTimer = setTimeout(() => {
      this._clockTimer = null;
      if (!this._root) return;
      try { this._clockTick(); } catch (_e) { /* 单帧失败不得让链断掉 */ }
    }, ms);
  }
  /**
   * [v2.31.0] 实例销毁：宿主丢弃本实例时调用（面板重建 / 清数据 / 换会话）。
   * 语义与 unlock() 的区别是**收多少**：
   *   unlock() 是「用户解锁」这个交互 —— 只回滚界面，两个 window 监听器
   *            **刻意保留**（锁屏复用同一实例，下一次 lock() 还要用，v2.26 已锁定该行为）；
   *   dispose() 是「实例不再存在」—— 时钟、DOM、window 监听器三者都要收。
   * 为什么必须解 _onWinMouseMove/_onWinMouseUp：它们是 window（长期存活对象）上的
   *   监听器，闭包钉住本实例与上一轮的 root 节点；只 remove() DOM 而不解绑，
   *   实例仍被 window 引用钉住 —— 这正是本版主题「实例被丢弃了、它的资源没人收」
   *   在锁屏上的形态。幂等（重复 dispose 时引用已为 null，不重复解绑）。
   */
  dispose() {
    if (this._onWinMouseMove) {
      window.removeEventListener('mousemove', this._onWinMouseMove);
      this._onWinMouseMove = null;
    }
    if (this._onWinMouseUp) {
      window.removeEventListener('mouseup', this._onWinMouseUp);
      this._onWinMouseUp = null;
    }
    this._clearClock();
    this._root?.remove();
    this._root = null;
    this._dragging = false;
    this._startY = 0;
    this.locked = false;
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
      ? `<div class="pls-track" data-app="music" role="button" title="打开音乐"><span class="pls-track-icon">🎵</span><span class="pls-track-title">${_esc(track.title)}</span>${track.artist ? `<span class="pls-track-artist">${_esc(track.artist)}</span>` : ''}</div>`
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
    /* [v3.79.0 · 计划 R-O6 第二层] 后台降频：页面隐藏时这个 10s 时钟轮询只做一次
     *   「醒来即对齐」，不再按周期跑（**降频不是杀死** —— 时钟是用户正在看的信息，
     *   不能整个停掉，但没必要在页面看不见时每 10 秒重算一次。
     *   实测口径：`document.hidden` 为真时该轮询改由恢复事件驱动（见 _bind 的可见性监听）。 */
    /* [v4.88.0] 时钟轮询改「自调度 + 静止退避」（config/gaze-backoff.js）。
     * 修前是固定 setInterval(10s)：页面停在这一屏，时间串几分钟不变，
     * 每分钟照样白算 6 次 DOM 查询与 3 次 textContent 写。
     * 落地口径（与内核语义对齐）：
     *   · `distance` = 时间串「变没变」——不变 0、变了 1，阈值 0.5 判；
     *   · 基线间隔就是原来的 10s（外观完全不变），静止后按 ×1.5 退避、封顶 120s；
     *   · 时间一变立刻回 10s（用户最可能在这时正在看）；
     *   · 页面隐藏时 `sleeping: true` 走密集段（≤1s），这样解锁/回前台后
     *     第一帧就对得上，不用等一个退避周期。
     * ★ **仍只用一个定时器句柄**（_clockTimer）：自调度不是「多一个定时器」，
     *   而是把同一个改成 setTimeout 链，_clearClock 的语义不变。 */
    this._clockTick = () => {
      if (typeof document !== 'undefined' && document.hidden === true) {
        // 隐藏：**不排下一次**（依赖既有的 visibilitychange 恢复监听补一次 tick）。
        //   与 v3.79.0 的原始口径一致：「隐藏期不重算，由恢复事件驱动」。
        //   链在此自然停住，句柄置 null 后 _clearClock 仍是幂等的。
        const handle = this._clockTimer;
        this._clockTimer = null;
        if (handle) { clearInterval(handle); clearTimeout(handle); }
        return;
      }
      const next = this._nowParts();
      const signature = next.time + '|' + next.date + '|' + next.greeting;
      const moved = signature !== this._clockSignature;
      const verdict = judgeGazeTick(this._clockState, {
        distance: moved ? 1 : 0,
        windowKey: 'locked'
      }, { threshold: 0.5, baseIntervalMs: 10000 });
      this._clockState = { staticStreak: verdict.staticStreak, intervalMs: verdict.intervalMs, windowKey: verdict.windowKey };
      if (moved || verdict.reset) {
        this._clockSignature = signature;
        const timeEl = root.querySelector('#pls-time');
        const dateEl = root.querySelector('#pls-date');
        const helloEl = root.querySelector('#pls-hello');
        if (timeEl) timeEl.textContent = next.time;
        if (dateEl) dateEl.textContent = next.date;
        if (helloEl) helloEl.textContent = next.greeting;
      }
      this._scheduleClockTick(verdict);
    };
    this._clockState = initialGazeState('locked', { baseIntervalMs: 10000 });
    this._clockSignature = '';
    this._scheduleClockTick(this._clockState);
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
    // [v2.26.0] window 是长期存活对象，而 _bind() 在 render() 内（每次锁屏都会执行）：
    //   原写法每次「锁屏→解锁」净增 2 个 window mousemove/mouseup 监听器，其闭包
    //   钉住上一轮的 root 节点。改为实例字段持有 + 重绑前先解绑旧引用
    //   （幂等，与 v2.25 music-app 的 remove-then-add 范式同构）。
    if (this._onWinMouseMove) window.removeEventListener('mousemove', this._onWinMouseMove);
    if (this._onWinMouseUp) window.removeEventListener('mouseup', this._onWinMouseUp);
    this._onWinMouseMove = (e) => { if (this._dragging) onMove(e.clientY); };
    this._onWinMouseUp = (e) => { if (this._dragging) onEnd(e.clientY); };
    window.addEventListener('mousemove', this._onWinMouseMove);
    window.addEventListener('mouseup', this._onWinMouseUp);
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
    // [v2.18.0] 锁屏音乐卡 → 解锁并直达音乐 App（播放中才存在该块）
    root.querySelector('.pls-track')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _jump('music');
    });
    /* [v3.79.0 · 计划 R-O6 第二层] 恢复后**立即重取一次**：时钟在隐藏期没有重算
     *   （见 render() 的 _clockTick），故恢复时必须补一次，否则用户会先看到一段
     *   陈旧时间（最长 10 秒）再被下一次轮询纠正 —— 那是「看起来没坏但显示不对」。
     *   监听器同样走实例字段持有 + 重绑前先解绑旧引用（与上面 window 两处同规，
     *   否则每次锁屏→解锁净增一个 document 监听器）。 */
    if (this._onDocVisibility) document.removeEventListener('visibilitychange', this._onDocVisibility);
    this._onDocVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden === true) return;
      try { this._clockTick?.(); } catch (_e) { /* 重取失败不得阻断解锁 */ }
    };
    document.addEventListener('visibilitychange', this._onDocVisibility);
  }
}

export default LockScreen;