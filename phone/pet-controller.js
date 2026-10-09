/* ========================================================
 *  桌面宠物控制器 (Pet Controller)
 *  移植自 道渊小手机 (linxin1925/DaoYuan-Phone) ZiweiPetController
 *  状态机: Idle → TapReaction → PhoneEnter → PhoneLoop → PhoneExit
 *  双 video 交叉淡化 + webm 透明通道 alpha 检测兜底
 *  素材: phone/pet/*.webm (本地)
 * ======================================================== */

const LOOPING_STATES = new Set(['Idle', 'PhoneLoop']);

function petVideoUrl(file) {
  try { return new URL('./pet/' + file, import.meta.url).href; }
  catch (e) { return './phone/pet/' + file; }
}
export const PET_VIDEOS = {
  Idle: petVideoUrl('idle.webm'),
  TapReaction: petVideoUrl('tap.webm'),
  PhoneEnter: petVideoUrl('phone-enter.webm'),
  PhoneLoop: petVideoUrl('phone-loop.webm'),
  PhoneExit: petVideoUrl('phone-exit.webm')
};

export class PetController {
  /**
   * @param root 容器元素 (button)
   * @param onPhoneReady 手机就绪回调 (宠物动画 PhoneEnter 完成后触发)
   */
  constructor(root, onPhoneReady) {
    this.root = root;
    this.onPhoneReady = typeof onPhoneReady === 'function' ? onPhoneReady : () => {};
    this.state = 'Idle';
    this.transitionTimer = null;
    this.frontIndex = 0;
    this.renderGeneration = 0;
    this.destroyed = false;
    this.alphaChecked = new WeakSet();
    /* [v3.79.0 · 计划 R-O6 第二层] 后台降频：面板关闭或页面切走时把播放**暂停**。
     *   修前实测：面板隐藏（display:none）与页面隐藏两种状态下宠物 video 都还在播
     *   （`paused=false`）—— 它是本仓最贵的一类资源：一个 webm 被钉在内存里、
     *   解码器按帧跑，而用户根本看不到。
     *   口径边界（**降频不是杀死**）：只暂停播放，不清 src、不销毁元素、不改状态机；
     *   恢复时从**当前状态**继续（不是从头播），且状态机本身不因暂停而前进。 */
    this.active = true;
    this.pausedByGate = false;

    // 双 video 交叉淡化
    this.videos = [];
    for (let i = 0; i < 2; i++) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.className = 'pet-video';
      root.appendChild(v);
      this.videos.push(v);
    }
    // 兜底 image (video 失败时显示)
    this.image = document.createElement('img');
    this.image.className = 'pet-fallback-img';
    this.image.alt = '';
    root.appendChild(this.image);

    this.renderState('Idle');
  }

  getState() { return this.state; }

  openPhone() {
    if (this.destroyed || (this.state !== 'Idle' && this.state !== 'PhoneExit')) return;
    this.clearTransitionTimer();
    this.renderState('TapReaction');
    this.schedule(() => {
      this.renderState('PhoneEnter');
      this.onPhoneReady();
    }, 650);
  }

  closePhone() {
    if (this.destroyed || this.state === 'Idle' || this.state === 'PhoneExit') return;
    this.clearTransitionTimer();
    this.renderState('PhoneExit');
  }

  /** 点击宠物 → 开手机; 手机开着 → 关手机 */
  toggle() {
    if (this.state === 'PhoneEnter' || this.state === 'PhoneLoop') this.closePhone();
    else this.openPhone();
  }

  isPhoneOpen() {
    return this.state === 'PhoneEnter' || this.state === 'PhoneLoop';
  }

  /** 面板从其他入口开关时同步宠物动画, 不再触发 onPhoneReady (避免循环 toggle) */
  syncPanel(open) {
    if (this.destroyed) return;
    if (open) {
      if (this.state === 'Idle' || this.state === 'PhoneExit') {
        this.clearTransitionTimer();
        this.renderState('PhoneEnter');
      }
    } else if (this.isPhoneOpen()) {
      this.closePhone();
    }
  }

  /**
   * [v3.79.0] 后台降频闸：`active=false` 时暂停播放（保留 src 与状态机）。
   * 幂等：重复调用同一值不产生额外副作用；与 destroy 可共存（destroy 后本方法空转）。
   * @returns {{active:boolean, playing:number, paused:number, changed:boolean}}
   */
  setActive(active) {
    const next = active === true;
    const result = { active: next, playing: 0, paused: 0, changed: false };
    if (this.destroyed) return result;
    if (next === this.active) {
      // 值没变：仍然如实报当前播放面（调用方读的是真读数，不是「我刚请求过什么」）。
      for (const v of this.videos) { if (v && !v.paused && !v.ended) result.playing += 1; else if (v && v.paused) result.paused += 1; }
      return result;
    }
    this.active = next;
    result.changed = true;
    if (next) {
      if (this.pausedByGate) {
        this.pausedByGate = false;
        // 恢复：**只恢复那一个前台视频**，不让两条同时跑（双 video 交叉淡化的前提）。
        const front = this.videos[this.frontIndex];
        if (front && front.getAttribute('src')) { try { front.play().catch(() => this.root.classList.add('is-pet-fallback')); } catch (_e) { /* 忽略 */ } }
      }
    } else {
      let any = false;
      for (const v of this.videos) { if (!v || v.paused) continue; any = true; v.pause(); }
      this.pausedByGate = any;
    }
    for (const v of this.videos) { if (v && !v.paused && !v.ended) result.playing += 1; else if (v && v.paused) result.paused += 1; }
    return result;
  }

  destroy() {
    this.destroyed = true;
    this.renderGeneration += 1;
    this.clearTransitionTimer();
    this.image.removeAttribute('src');
    for (const v of this.videos) {
      v.pause();
      v.onloadeddata = null;
      v.onended = null;
      v.onerror = null;
      v.removeAttribute('src');
      try { v.load(); } catch (e) {}
    }
  }

  renderState(state) {
    if (this.destroyed) return;
    const generation = ++this.renderGeneration;
    this.state = state;
    this.root.dataset.petState = state;
    this.root.classList.remove('is-pet-fallback');
    this.root.setAttribute('aria-expanded', String(state === 'PhoneEnter' || state === 'PhoneLoop'));

    this.image.removeAttribute('src');
    const nextIndex = this.frontIndex === 0 ? 1 : 0;
    const current = this.videos[this.frontIndex];
    const next = this.videos[nextIndex];
    next.pause();
    next.classList.remove('is-front');
    next.loop = LOOPING_STATES.has(state);

    const promote = () => {
      if (this.destroyed || generation !== this.renderGeneration) return;
      next.onloadeddata = null;
      next.currentTime = 0;
      this.detectLostAlpha(next);
      next.classList.add('is-front');
      current.classList.remove('is-front');
      current.pause();
      this.frontIndex = nextIndex;
      // [v3.79.0] 闸门关闭时不启动：否则「换状态」这一步会把刚暂停的视频又拉起来
      //   （实测形态：面板隐藏期间状态机推进一次，宠物又开播）。
      if (this.active) next.play().catch(() => this.root.classList.add('is-pet-fallback'));
      else this.pausedByGate = true;
    };

    next.onloadeddata = promote;
    next.onended = () => {
      if (generation !== this.renderGeneration) return;
      if (state === 'PhoneEnter') this.renderState('PhoneLoop');
      if (state === 'PhoneExit') this.renderState('Idle');
    };
    next.onerror = () => {
      if (generation !== this.renderGeneration) return;
      this.root.classList.add('is-pet-fallback');
      if (state !== 'Idle') this.renderState('Idle');
    };
    next.src = PET_VIDEOS[state];
    next.load();
    if (next.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) promote();

    this.root.dispatchEvent(new CustomEvent('phone:pet-statechange', { detail: { state } }));
  }

  /** 检测 webm 透明通道丢失 (黑角不透明 = alpha 丢失, 启用静态图兜底) */
  detectLostAlpha(video) {
    if (this.alphaChecked.has(video) || !video.videoWidth || !video.videoHeight) return;
    this.alphaChecked.add(video);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, 2, 2);
      const pixels = ctx.getImageData(0, 0, 2, 2).data;
      let opaqueBlackCorners = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 245 && pixels[i] < 12 && pixels[i + 1] < 12 && pixels[i + 2] < 12) opaqueBlackCorners += 1;
      }
      if (opaqueBlackCorners === 4) this.root.classList.add('is-alpha-fallback');
    } catch (e) { /* canvas 探测失败则继续默认透明播放 */ }
  }

  schedule(cb, delay) {
    this.transitionTimer = window.setTimeout(() => {
      this.transitionTimer = null;
      cb();
    }, delay);
  }

  clearTransitionTimer() {
    if (this.transitionTimer !== null) window.clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
  }
}

export default PetController;