/* ========================================================
 *  桌面宠物控制器 (Pet Controller)
 *  移植自 道渊小手机 (linxin1925/DaoYuan-Phone) ZiweiPetController
 *  状态机: Idle → TapReaction → PhoneEnter → PhoneLoop → PhoneExit
 *  双 video 交叉淡化 + webm 透明通道 alpha 检测兜底
 *  素材: phone/pet/*.webm (本地)
 * ======================================================== */

const LOOPING_STATES = new Set(['Idle', 'PhoneLoop']);

export const PET_VIDEOS = {
  Idle: './phone/pet/idle.webm',
  TapReaction: './phone/pet/tap.webm',
  PhoneEnter: './phone/pet/phone-enter.webm',
  PhoneLoop: './phone/pet/phone-loop.webm',
  PhoneExit: './phone/pet/phone-exit.webm'
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
      next.play().catch(() => this.root.classList.add('is-pet-fallback'));
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