import { PetController } from './pet-controller.js';
// [v2.28.0] 实例级资源域：悬浮入口的常驻资源（轮询 + 3 个 resize 监听）随实例回收
import { childRuntime } from '../config/runtime-lifecycle.js';

const FLOATING_ROOT_ID = 'phone-floating-entry-root';
const FLOATING_BUTTON_ID = 'phone-floating-entry-button';

export const PHONE_FLOATING_ENTRY_ENABLED_KEY = 'phone-floating-entry-enabled';
export const PHONE_FLOATING_ENTRY_STYLE_KEY = 'phone-floating-entry-style';
export const PHONE_FLOATING_ENTRY_POSITION_KEY = 'phone-floating-entry-position';
/* [v3.56.0] 桌面宠物位置（「悬浮球」拖拽落点）。与悬浮按钮位置同族：键名走连字符形态
 *   ⇒ 既不在 `CHAT_DATA_PATTERNS` 内（默认落**全局** extensionSettings），
 *   也不在 keys-audit 的抽取面内（CALL_RE / CONST_RE 的键名字符集 `[A-Za-z0-9_]` 不含
 *   连字符，与既有的 `phone-floating-entry-position` / `dock-apps` 同形）。
 *   语义归属：宠物位置是**界面偏好**而非会话数据 —— 跨会话漂移会让用户每换一个角色
 *   都要重新摆一次，而它与「这个角色是谁」无关。
 *   为什么不复用 PHONE_FLOATING_ENTRY_POSITION_KEY：两者是**不同元素**
 *   （120px 宠物根 vs 46/52px 悬浮按钮），且可见性互斥
 *   （`updateVisibility` 的 `button.hidden = hasPet || hidden`）——
 *   共键会让「拖了宠物」下次把按钮摆到宠物位上，反之亦然。 */
export const PHONE_PET_POSITION_KEY = 'phone-pet-position';
export const PHONE_FLOATING_ENTRY_DEFAULT_STYLE = 'silver';

export const PHONE_FLOATING_ENTRY_STYLES = Object.freeze([
    { id: 'gold', label: '金色', file: 'phone/xfjs.png' },
    { id: 'blue', label: '蓝色', file: 'phone/xfls.png' },
    { id: 'green', label: '绿色', file: 'phone/xflvs.png' },
    { id: 'silver', label: '银色', file: 'phone/xfys.png' },
    { id: 'purple', label: '紫色', file: 'phone/xfzs.png' },
    { id: 'black', label: '黑色', file: 'phone/xfhs.png' }
]);

const FLOATING_STYLE_MAP = new Map(PHONE_FLOATING_ENTRY_STYLES.map(item => [item.id, item]));

function isEnabledValue(value) {
    return value === true || value === 'true' || value === 1;
}

function normalizeStyle(value) {
    const style = String(value || '').trim();
    return FLOATING_STYLE_MAP.has(style) ? style : PHONE_FLOATING_ENTRY_DEFAULT_STYLE;
}

export class PhoneFloatingEntry {
    constructor(options = {}) {
        this.storage = options.storage || null;
        this.baseUrl = options.baseUrl || './';
        this.onActivate = typeof options.onActivate === 'function' ? options.onActivate : () => {};
        this.isPanelOpen = typeof options.isPanelOpen === 'function' ? options.isPanelOpen : () => false;
        this.resizeController = null;
        this._rt = childRuntime('floating-entry');
        this.visibilityTimer = null;
        this.pet = null;  // 桌面宠物控制器
        this._onPanelVisibility = event => {
            const open = event?.detail?.open;
            this.updateVisibility(typeof open === 'boolean' ? open : null);
        };
        this._onSettingsChanged = () => this.sync();
    }

    isEnabled() {
        return isEnabledValue(this.storage?.get?.(PHONE_FLOATING_ENTRY_ENABLED_KEY, false));
    }

    getStyle() {
        return normalizeStyle(this.storage?.get?.(PHONE_FLOATING_ENTRY_STYLE_KEY, PHONE_FLOATING_ENTRY_DEFAULT_STYLE));
    }

    isMobileViewport() {
        if (typeof window === 'undefined') return false;
        if (typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 600px), (pointer: coarse)').matches) {
            return true;
        }
        return Number(window.innerWidth) <= 600;
    }

    getRoot() {
        let root = document.getElementById(FLOATING_ROOT_ID);
        if (root) return root;

        root = document.createElement('div');
        root.id = FLOATING_ROOT_ID;
        (document.body || document.documentElement).appendChild(root);
        return root;
    }

    readPosition() {
        const raw = this.storage?.get?.(PHONE_FLOATING_ENTRY_POSITION_KEY, null);
        if (!raw) return null;
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const left = Number(parsed?.left);
            const top = Number(parsed?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
            return {
                left,
                top,
                mode: parsed?.mode === 'mobile' || parsed?.mode === 'desktop' ? parsed.mode : null,
                source: parsed?.source === 'user' || parsed?.source === 'default' ? parsed.source : null
            };
        } catch {
            return null;
        }
    }

    shouldUseSavedPosition(saved) {
        if (!saved) return false;
        if (!this.isMobileViewport()) {
            // 移动端的默认坐标不是桌面端的有效位置；用户拖动过的坐标仍可跨端保留。
            return saved.mode !== 'mobile' || saved.source === 'user';
        }
        // 老版本没有 mode/source，或是桌面端留下的默认坐标，移动端统一迁移到视口边缘。
        return saved.mode === 'mobile' && saved.source === 'user';
    }

    savePosition(left, top, options = {}) {
        const payload = JSON.stringify({
            left: Math.round(left),
            top: Math.round(top),
            mode: this.isMobileViewport() ? 'mobile' : 'desktop',
            source: options.source === 'default' ? 'default' : 'user'
        });
        Promise.resolve(this.storage?.set?.(PHONE_FLOATING_ENTRY_POSITION_KEY, payload)).catch(error => {
            console.warn('[VirtualPhone] 保存悬浮图标位置失败:', error);
        });
    }

    getViewport(button = null) {
        const rect = button?.getBoundingClientRect?.();
        const defaultSize = this.isMobileViewport() ? 46 : 52;
        const fallbackSize = Math.max(44, Math.round(Math.max(rect?.width || 0, rect?.height || 0, defaultSize)));
        const viewport = window.visualViewport;
        return {
            left: Math.max(0, Number(viewport?.offsetLeft) || 0),
            top: Math.max(0, Number(viewport?.offsetTop) || 0),
            width: Math.max(fallbackSize, Number(viewport?.width) || window.innerWidth || document.documentElement.clientWidth || fallbackSize),
            height: Math.max(fallbackSize, Number(viewport?.height) || window.innerHeight || document.documentElement.clientHeight || fallbackSize),
            size: fallbackSize
        };
    }

    clampPosition(left, top, button = null) {
        const viewport = this.getViewport(button);
        const margin = this.isMobileViewport() ? 0 : 8;
        const minLeft = viewport.left + margin;
        const minTop = viewport.top + margin;
        const maxLeft = Math.max(minLeft, viewport.left + viewport.width - viewport.size - margin);
        const maxTop = Math.max(minTop, viewport.top + viewport.height - viewport.size - margin);
        return {
            left: Math.max(minLeft, Math.min(maxLeft, Number(left) || minLeft)),
            top: Math.max(minTop, Math.min(maxTop, Number(top) || minTop))
        };
    }

    applyPosition(button, left, top, options = {}) {
        if (!button) return;
        const next = this.clampPosition(left, top, button);
        button.style.left = `${next.left}px`;
        button.style.top = `${next.top}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        if (options.persist) this.savePosition(next.left, next.top, options);
    }

    position(button) {
        const saved = this.readPosition();
        if (this.shouldUseSavedPosition(saved)) {
            this.applyPosition(button, saved.left, saved.top);
            return;
        }

        const viewport = this.getViewport(button);
        const mobile = this.isMobileViewport();
        const margin = mobile ? 0 : 14;
        const shouldPersistMobileDefault = mobile
            && (!saved || saved.mode !== 'mobile' || saved.source !== 'default');
        let left = viewport.left + viewport.width - viewport.size - margin;
        const top = viewport.top + Math.round(viewport.height * 0.72);
        if (!mobile) {
            const chatArea = document.querySelector('#sheld') || document.querySelector('#chat');
            const chatRect = chatArea?.getBoundingClientRect?.();
            if (chatRect?.width > 0 && chatRect.right > viewport.size && chatRect.right <= viewport.left + viewport.width + 1) {
                left = chatRect.right - viewport.size - margin;
            }
        }
        this.applyPosition(button, left, top, {
            persist: shouldPersistMobileDefault,
            source: 'default'
        });
    }

    ensureVisible(button = document.getElementById(FLOATING_BUTTON_ID)) {
        if (!button?.isConnected || button.hidden) return;
        const saved = this.readPosition();
        if (this.isMobileViewport() && !this.shouldUseSavedPosition(saved)) {
            this.position(button);
            return;
        }
        const rect = button.getBoundingClientRect();
        const viewport = this.getViewport(button);
        const outside = rect.right < viewport.left
            || rect.left > viewport.left + viewport.width
            || rect.bottom < viewport.top
            || rect.top > viewport.top + viewport.height;
        if (outside) {
            if (this.shouldUseSavedPosition(saved)) this.applyPosition(button, saved.left, saved.top, { persist: true, source: 'user' });
            else this.position(button);
            return;
        }
        this.applyPosition(button, rect.left, rect.top);
    }

    updateImage(button = document.getElementById(FLOATING_BUTTON_ID)) {
        const image = button?.querySelector?.('.phone-floating-entry-image');
        if (!image) return;
        const style = FLOATING_STYLE_MAP.get(this.getStyle()) || FLOATING_STYLE_MAP.get(PHONE_FLOATING_ENTRY_DEFAULT_STYLE);
        image.src = new URL(style.file, this.baseUrl).href;
        button.dataset.phoneFloatingStyle = style.id;
        button.title = `打开 RubyPhone（${style.label}悬浮图标）`;
    }

    bindDrag(button) {
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let moved = false;

        const finish = event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            button.releasePointerCapture?.(pointerId);
            pointerId = null;
            button.classList.remove('phone-floating-entry-dragging');

            if (moved) {
                const rect = button.getBoundingClientRect();
                this.applyPosition(button, rect.left, rect.top, { persist: true });
            } else {
                event.preventDefault();
                event.stopPropagation();
                Promise.resolve(this.onActivate()).catch(error => {
                    console.warn('[VirtualPhone] 悬浮入口打开手机失败:', error);
                });
            }

            window.setTimeout(() => {
                moved = false;
            }, 40);
        };

        button.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            const rect = button.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            moved = false;
            button.classList.add('phone-floating-entry-dragging');
            button.setPointerCapture?.(pointerId);
        });

        button.addEventListener('pointermove', event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;
            if (!moved && Math.hypot(deltaX, deltaY) > 8) moved = true;
            if (!moved) return;
            event.preventDefault();
            this.applyPosition(button, startLeft + deltaX, startTop + deltaY);
        });

        button.addEventListener('pointerup', finish);
        button.addEventListener('pointercancel', event => {
            if (pointerId === null || event.pointerId !== pointerId) return;
            button.releasePointerCapture?.(pointerId);
            pointerId = null;
            moved = false;
            button.classList.remove('phone-floating-entry-dragging');
        });
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
        });
        button.addEventListener('dragstart', event => event.preventDefault());
    }

    createButton() {
        const button = document.createElement('button');
        button.id = FLOATING_BUTTON_ID;
        button.type = 'button';
        button.className = 'phone-floating-entry-button';
        button.setAttribute('aria-label', '打开 RubyPhone');

        const image = document.createElement('img');
        image.className = 'phone-floating-entry-image';
        image.alt = '';
        image.draggable = false;
        image.setAttribute('aria-hidden', 'true');
        button.appendChild(image);

        this.updateImage(button);
        this.bindDrag(button);
        return button;
    }

    updateVisibility(panelOpen = null) {
        const hidden = typeof panelOpen === 'boolean' ? panelOpen : !!this.isPanelOpen();
        const button = document.getElementById(FLOATING_BUTTON_ID);
        const hasPet = !!this.pet;
        if (button) {
            button.hidden = hasPet || hidden;
            button.setAttribute('aria-hidden', String(button.hidden));
            if (!button.hidden) {
                const saved = this.readPosition();
                if (this.shouldUseSavedPosition(saved)) this.applyPosition(button, saved.left, saved.top);
                else if (this.isMobileViewport()) this.position(button);
                else this.ensureVisible(button);
            }
        }
        try { this.pet?.syncPanel?.(hidden); } catch (e) {}
    }

    mount() {
        const root = this.getRoot();
        let button = document.getElementById(FLOATING_BUTTON_ID);
        if (!button) {
            button = this.createButton();
            root.appendChild(button);
            this.position(button);
        } else if (button.parentElement !== root) {
            root.appendChild(button);
        }
        this.updateImage(button);

        this.ensurePet();

        if (!this.resizeController) {
            this.resizeController = new AbortController();
            const signal = this.resizeController.signal;
            const reposition = () => this.ensureVisible(button);
            window.addEventListener('resize', reposition, { passive: true, signal });
            window.visualViewport?.addEventListener?.('resize', reposition, { passive: true, signal });
            window.visualViewport?.addEventListener?.('scroll', reposition, { passive: true, signal });
            window.addEventListener('phone:panelVisibility', this._onPanelVisibility, { signal });
            window.addEventListener('phone:floatingEntrySettingsChanged', this._onSettingsChanged, { signal });
        }

        // [v2.28.0] 自愈轮询入实例域（tag entry:）：unmount/unmountButtonOnly 一次收净。
        //   旧写法用裸 window.setInterval + this.visibilityTimer，两条卸载路径各写一次
        //   clearInterval，属「人工维护回收清单」的典型失败形态。
        this._rt.cancelByTag('entry:');
        this._rt.addInterval(() => this.ensureVisible(button), 3000, 'entry:visibility');
        this.visibilityTimer = null;
        this.updateVisibility();
    }

    unmount() {
        if (this.pet) {
            try { this.pet.destroy(); } catch (e) {}
            this.pet = null;
        }
        document.getElementById('phone-pet-root')?.remove();
        this.resizeController?.abort?.();
        this.resizeController = null;
        this._rt.cancelByTag('entry:');
        this.visibilityTimer = null;
        document.getElementById(FLOATING_BUTTON_ID)?.remove();
        const root = document.getElementById(FLOATING_ROOT_ID);
        if (root && !root.childElementCount) root.remove();
        // [v2.29.0] 卸载同时注销域（两条卸载路径共用同一出口，不必各写一次）：
        //   cancelByTag 只清条目，域本身仍被登记表钉住；宿主侧实测未写
        //   disposeChildRuntimes('floating-entry')，故此处由实例自己收尾。
        this._rt.dispose();
    }

    ensurePet() {
        if (this.pet) return;
        try {
            const root = this.getRoot();
            let petRoot = document.getElementById('phone-pet-root');
            if (!petRoot) {
                petRoot = document.createElement('button');
                petRoot.type = 'button';
                petRoot.className = 'phone-pet-root';
                petRoot.id = 'phone-pet-root';
                petRoot.title = '点我开手机 · 可拖动';
                root.appendChild(petRoot);
            }
            this.pet = new PetController(petRoot, () => this.onActivate());
            // [v3.56.0] 桌面宠物拖拽：`pet.css` 一直写着 cursor: grab，但全库从无实现
            //   （用户报障「悬浮球不能拖动」的根因）。挂在这里而不是 PetController 内：
            //   pet-root 由本方法创建，绑定点与创建点同处，无跨模块时序依赖。
            this.bindPetDrag(petRoot);
            if (!petRoot._petClickBound) {
                petRoot._petClickBound = true;
                petRoot.addEventListener('click', (e) => {
                    e.stopPropagation();
                    /* [v3.56.0] 拖拽后的那一次 click 由 bindPetDrag 的捕获期监听器
                     *   stopImmediatePropagation 吞掉（同节点、注册顺序在前）。
                     *   但「靠另一个监听器拦」是**隐式契约**：任何一处顺序或介质变动
                     *   （例如换成 MutationObserver 重建、或宿主导入顺序不同）都会让它静默失效，
                     *   失效表现恰好是「拖完宠物手机莫名开一次」—— 用户只会觉得「拖拽很怪」。
                     *   故此处再判一次显式标志位：吞没吞掉都能兜住，两个判据互不依赖。 */
                    if (this._petDragMoved) {
                        this._petDragMoved = false;
                        return;
                    }
                    const panelOpen = !!this.isPanelOpen();
                    if (panelOpen) {
                        this.pet?.closePhone();
                        this.onActivate();
                    } else {
                        this.pet?.openPhone();
                    }
                });
            }
        } catch (e) {
            console.warn('[手机宠物] 桌面宠物创建失败:', e);
            this.pet = null;
        }
    }

    /* ============================================================
     * [v3.56.0] 桌面宠物拖拽
     * ------------------------------------------------------------
     * 为什么加（用户报障「悬浮球不能拖动」）：
     *   实查发现用户口中的「悬浮球」其实是**桌面宠物**（PetController 播放的 webm 角色），
     *   而非 `#phone-floating-entry-button` —— 后者因 `updateVisibility()` 里的
     *   `button.hidden = hasPet || hidden` 在 `ensurePet()` 成功后**恒被隐藏**。
     *   而 `bindDrag()` 只被 `createButton()` 调用（挂在那个永不显示的按钮上），
     *   `pet-root` 只绑了 `click` —— 全仓无任何 pointerdown/pointermove 拖拽实现。
     *   但 `pet.css` 的 `.phone-pet-root` 写着 `cursor: grab` 与 `:active { cursor: grabbing }`
     *   —— **光标承诺了可拖拽，代码从未实现**（承诺与实现不同源）。
     *
     * 与点击的关系（关键，不能只加 draggable）：
     *   宠物 `click` 承担「开/关手机」，与拖拽同源冲突。故用**位移阈值**判别：
     *     位移 ≤ 6px ⇒ 认作点击（照原逻辑走）；
     *     位移 > 6px ⇒ 认作拖拽，并在随后的 click 上吞掉一次（防拖动松手顺手开/关手机）。
     *   与 `bindDrag` 的口径一致（那里也走 moved 标志），但**不复用它**：
     *   那条实现挂在 button 上、改的是 button 的样式，两处 DOM 不同。
     *
     * 落点：`pet.css` 里 `.phone-pet-root` 是 `position: fixed; left:16px; bottom:90px`，
     *   故拖拽必须**同时改写 left/top 并清掉 bottom**，否则 top 与 bottom 同时生效，
     *   位置不跟随指针。
     * ============================================================ */
    bindPetDrag(petRoot) {
        if (!petRoot || petRoot.dataset.petDragBound === '1') return;
        petRoot.dataset.petDragBound = '1';

        const DRAG_MIN = 6;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let lastLeft = null;
        let lastTop = null;
        let moved = false;

        const clampToViewport = (left, top) => {
            /* 尺寸取 offsetWidth/offsetHeight（**未变换**的布局尺寸），不取 rect.width：
             *   本函数算的是 left/top（未变换原点）的合法区间，而 rect.* 是缩放后的视觉值
             *   —— 手机开着时 rect.width = 120×0.86 = 103.2，用它算出来的边界比真实边界
             *   窄 7px，宠物会提前被挡住。同一坐标系内取数，边界才与写入值对齐。 */
            const w = Math.max(1, petRoot.offsetWidth || 120);
            const h = Math.max(1, petRoot.offsetHeight || 120);
            const vw = window.innerWidth || document.documentElement.clientWidth || w;
            const vh = window.innerHeight || document.documentElement.clientHeight || h;
            // 至少保留 1/3 可见：全推出视口就等于「宠物丢了」，而它没有恢复入口
            const minLeft = -w / 3;
            const minTop = -h / 3;
            const maxLeft = vw - w / 3;
            const maxTop = vh - h / 3;
            return {
                left: Math.max(minLeft, Math.min(maxLeft, left)),
                top: Math.max(minTop, Math.min(maxTop, top))
            };
        };

        const applyPos = (left, top) => {
            const p = clampToViewport(left, top);
            lastLeft = p.left;
            lastTop = p.top;
            petRoot.style.left = p.left + 'px';
            petRoot.style.top = p.top + 'px';
            petRoot.style.right = 'auto';
            // ★ 必须清 bottom（样式表写的是 bottom:90px）
            petRoot.style.bottom = 'auto';
        };

        this._rt.addListener(petRoot, 'pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            pointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            moved = false;
            lastLeft = null;
            lastTop = null;
            /* ★ 起点取「**未变换**的原点」，而不是 rect.left。
             *   宠物根可能是缩过的（`[data-pet-state="PhoneLoop"] { transform: scale(0.86) }`，
             *   手机开着时生效）。transform 以中心为原点，于是
             *       rect.left = styleLeft + (offsetWidth - rect.width) / 2
             *   反解即 styleLeft = rect.left + (rect.width - offsetWidth) / 2。
             *   offsetWidth/offsetHeight **不随 transform 变**，故这是精确反解。
             *   为什么不用「先清 transform 再量」那套：清掉会让宠物在按下的瞬间**放大跳一下**
             *   （而且多数按下其实只是一次点击，为点击闪一下不值得）。
             *   为什么不能把 rect.left 直接当起点：那样拖拽全程会带上半个缩放量的固定偏移，
             *   且松手存下的坐标与下次读回时的语义不一致（存的是视觉值、写的是原点值）。 */
            const rect = petRoot.getBoundingClientRect();
            const scaledW = (Number(rect.width) || 0) - (petRoot.offsetWidth || 0);
            const scaledH = (Number(rect.height) || 0) - (petRoot.offsetHeight || 0);
            startLeft = (Number(rect.left) || 0) + scaledW / 2;
            startTop = (Number(rect.top) || 0) + scaledH / 2;
            petRoot.classList.add('is-pet-pressing');
            try { petRoot.setPointerCapture?.(pointerId); } catch (_e) { /* 捕获失败仍可拖 */ }
        }, false, 'pet:pointerdown');

        this._rt.addListener(petRoot, 'pointermove', (e) => {
            if (pointerId === null || e.pointerId !== pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!moved && Math.hypot(dx, dy) > DRAG_MIN) {
                moved = true;
                petRoot.classList.remove('is-pet-pressing');
                petRoot.classList.add('is-pet-dragging');
                /* 此处**不**重新量 rect、也不改 transform：位移是相对「未变换原点」算的，
                 *   只要缩放比例在拖拽期间不变，视觉位移就与手指严格同步（无补偿可做、
                 *   也就无补偿可错）。这要求 `:active` 的 transform 反馈不得参与
                 *   —— 已把 `.phone-pet-root:active` 的 scale 换成 brightness（见 pet.css）。 */
            }
            if (!moved) return;
            e.preventDefault();
            applyPos(startLeft + dx, startTop + dy);
        }, false, 'pet:pointermove');

        const finishDrag = (e) => {
            if (pointerId === null || (e && e.pointerId !== pointerId)) return;
            try { petRoot.releasePointerCapture?.(pointerId); } catch (_e) { /* 未捕获时忽略 */ }
            pointerId = null;
            petRoot.classList.remove('is-pet-pressing', 'is-pet-dragging');
            if (moved) {
                /* 落点取 applyPos 实际写下的坐标，**不**再量 rect：
                 *   `rect` 是在 scale(0.86) 生效与否的两种渲染态下取值，
                 *   而 lastLeft/lastTop 是「写进 style 的那个数」——
                 *   与下次 restorePetPosition 读出来的语义完全同源（都是未缩坐标）。 */
                const left = lastLeft ?? petRoot.getBoundingClientRect().left;
                const top = lastTop ?? petRoot.getBoundingClientRect().top;
                this.savePetPosition(left, top);
                // 显式标志位：与捕获期吞 click 互为**独立**兜底（见 ensurePet 的注释）。
                this._petDragMoved = true;
            }
        };
        this._rt.addListener(petRoot, 'pointerup', finishDrag, false, 'pet:pointerup');
        this._rt.addListener(petRoot, 'pointercancel', (e) => {
            if (pointerId === null || (e && e.pointerId !== pointerId)) return;
            pointerId = null;
            moved = false;
            petRoot.classList.remove('is-pet-pressing', 'is-pet-dragging');
        }, false, 'pet:pointercancel');

        // 捕获期吞掉「拖拽结束的那一次 click」：否则拖完松手会顺手把手机开/关一次。
        //   ★ 必须用 **stopImmediatePropagation**，不能只用 stopPropagation：
        //     `ensurePet` 的开/关 click 监听挂在**同一个 petRoot** 上（petRoot 是 button，
        //     两个子元素都是 pointer-events:none，故事件 target 恒为 petRoot 本身）。
        //     按 DOM 事件模型，**同节点**上的监听器按注册顺序触发，stopPropagation 只能
        //     拦住「传播到别的节点」，拦不住同节点后面那个监听器 —— 用错方法即等于没吞。
        //   ★ 捕获标志（true）是**必要条件**：它保证本监听器在注册顺序上排在
        //     ensurePet 的 click 之前（否则先开手机再吞，吞了个寂寞）。
        this._rt.addListener(petRoot, 'click', (e) => {
            if (!moved) return;
            moved = false;
            // 本监听器既然已经消费掉这次 click，就要把显式标志位一并清掉 ——
            //   否则它留在 true，下一次**真正**的点击会被 ensurePet 的兜底分支误吞一次。
            this._petDragMoved = false;
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true, 'pet:click-swallow');

        this.restorePetPosition(petRoot);
    }

    /* 宠物位置持久化。键名走 global 作用域（`phone-` 前缀不在 CHAT_DATA_PATTERNS 内）——
     *   宠物位置是**界面偏好**，不是会话数据；跨会话漂移会让用户每次换角色都要重摆。 */
    savePetPosition(left, top) {
        try {
            const payload = JSON.stringify({ left: Math.round(left), top: Math.round(top) });
            Promise.resolve(this.storage?.set?.(PHONE_PET_POSITION_KEY, payload)).catch(() => {});
        } catch (e) {
            console.warn('[VirtualPhone] 保存桌面宠物位置失败:', e);
        }
    }

    restorePetPosition(petRoot) {
        try {
            const raw = this.storage?.get?.(PHONE_PET_POSITION_KEY);
            if (!raw) return false;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const left = Number(parsed?.left);
            const top = Number(parsed?.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
            /* 恢复时**必须**夹取：存下来的是「当时那个视口」的坐标。用户若在这之后
             *   旋转了屏幕、换了设备、或把手机面板拉大到几乎全屏，旧坐标就可能落在视口外。
             *   不夹取的后果是**静默丢失**：宠物本身还在 DOM 里，但看不见也摸不到，
             *   而且它没有「找回来」的入口（这正是拖拽夹取存在的同一个理由）。
             *   偏移量与拖拽共用同一口径：至少保留 1/3 可见。 */
            const w = Math.max(1, petRoot.offsetWidth || 120);
            const h = Math.max(1, petRoot.offsetHeight || 120);
            const vw = window.innerWidth || document.documentElement.clientWidth || w;
            const vh = window.innerHeight || document.documentElement.clientHeight || h;
            const safeLeft = Math.max(-w / 3, Math.min(vw - w / 3, left));
            const safeTop = Math.max(-h / 3, Math.min(vh - h / 3, top));
            petRoot.style.left = safeLeft + 'px';
            petRoot.style.top = safeTop + 'px';
            petRoot.style.right = 'auto';
            petRoot.style.bottom = 'auto';
            return true;
        } catch (e) {
            return false;
        }
    }

    sync() {
        if (this.isEnabled()) this.mount();
        else this.unmountButtonOnly();
        this.ensurePet();
        this.updateVisibility();
    }

    unmountButtonOnly() {
        this.resizeController?.abort?.();
        this.resizeController = null;
        // [v2.28.0] 与 unmount 共用同一回收口径（实例域）
        this._rt.cancelByTag('entry:');
        this.visibilityTimer = null;
        document.getElementById(FLOATING_BUTTON_ID)?.remove();
    }
}

