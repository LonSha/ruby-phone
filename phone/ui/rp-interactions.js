/* ========================================================
 * phone/ui/rp-interactions.js — RubyPhone v2.1 微交互（ESM）
 * v2.1：所有字符图标（回应、菜单、滑动回复箭头）改为 SVG（侧效导入 ../../shared/icons.js）
 * --------------------------------------------------------
 * 只负责「手势 -> 属性 / CSS 变量」，视觉全部在 phone-components-v2.css。
 * 每个 attach* 都返回 detach()，方便 App 卸载时清理；全部尊重 prefers-reduced-motion。
 *
 *   openAppZoom(win, iconEl, root) / closeAppZoom(win, iconEl, root)   从图标放大打开 App（FLIP）
 *   createIsland(el)                     灵动岛：idle / compact / banner / expanded，横幅排队
 *   attachSwipeToReply(thread, opts)     左滑回复（Telegram）；兼容旧 DOM：selector='.chat-message', bubble='.message-text'
 *   attachTapbacks(thread, opts)         长按 / 双击 -> 图标回应 + 上下文菜单（iOS 信息）
 *   attachControlCenter(cc, opts)        下拉呼出 / 上推收起，竖向滑杆
 *   attachMomentActions(feed, opts)      朋友圈「··」-> 赞 / 评论
 *   attachLockScreen(lock, opts)         上滑解锁
 * 灵感来源见 README「设计参考」表；本文件不含任何第三方代码。
 * ======================================================== */

import '../../shared/icons.js';   // 侧效导入：挂到 globalThis.LonShaIcons（UMD）

export const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* 不支持 */ } };
const once = (el, ev, ms) => new Promise((res) => {
    let done = false;
    const fin = (e) => {
        if (e && e.target !== el) return;   // 子元素的动画事件会冒泡上来，忽略
        if (!done) { done = true; el.removeEventListener(ev, fin); res(); }
    };
    el.addEventListener(ev, fin);
    setTimeout(() => fin(), ms);
});

/* ---------------- App 打开 / 关闭（从图标位置缩放） ---------------- */
function zoomVars(win, iconEl, root) {
    const host = root || win.offsetParent || document.body;
    const r = host.getBoundingClientRect();
    const a = iconEl ? (iconEl.querySelector('.rp-icon-art') || iconEl).getBoundingClientRect() : null;
    if (!a || !r.width) { win.style.removeProperty('--rp-zoom-x'); return; }
    const k = r.width / (host.offsetWidth || r.width);   // 外层被 transform: scale() 缩放时换算回本地坐标
    win.style.setProperty('--rp-zoom-x', ((a.left - r.left) / k).toFixed(1) + 'px');
    win.style.setProperty('--rp-zoom-y', ((a.top - r.top) / k).toFixed(1) + 'px');
    win.style.setProperty('--rp-zoom-sx', (a.width / r.width).toFixed(4));
    win.style.setProperty('--rp-zoom-sy', (a.height / r.height).toFixed(4));
}
export async function openAppZoom(win, iconEl, root, home) {
    zoomVars(win, iconEl, root);
    win.hidden = false;
    win.dataset.anim = 'open';
    if (home) home.setAttribute('data-behind', '');
    await once(win, 'animationend', reducedMotion() ? 10 : 700);
    if (win.dataset.anim === 'open') delete win.dataset.anim;
}
export async function closeAppZoom(win, iconEl, root, home) {
    zoomVars(win, iconEl, root);
    win.dataset.anim = 'close';
    if (home) home.removeAttribute('data-behind');
    await once(win, 'animationend', reducedMotion() ? 10 : 600);
    win.hidden = true;
    delete win.dataset.anim;
}

/* ---------------- 灵动岛 ---------------- */
export function createIsland(el) {
    const q = [];
    let timer = null, live = null;
    const html = (o) => `<span class="rp-island-lead"${o.chip ? ` data-chip="${o.chip}"` : ''} aria-hidden="true">${o.icon || ''}</span>
        <span class="rp-island-main"><span class="rp-island-title">${o.title || ''}</span>${o.sub ? `<span class="rp-island-sub">${o.sub}</span>` : ''}</span>
        <span class="rp-island-trail">${o.trail || ''}</span>${o.actions ? `<span class="rp-island-actions">${o.actions}</span>` : ''}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const set = (state, o) => {
        if (o) el.innerHTML = html(o);
        el.dataset.state = state;
    };
    const next = () => {
        clearTimeout(timer);
        const o = q.shift();
        if (!o) { if (live) set('compact', live); else set('idle'); return; }
        set('banner', o);
        haptic(10);
        el.onclick = () => { if (el.dataset.state === 'banner' && o.expand) set('expanded', { ...o, ...o.expand }); else { o.onTap && o.onTap(); next(); } };
        timer = setTimeout(next, o.duration || 3800);
    };
    set('idle');
    return {
        /** 横幅通知：{ icon, chip, title, sub, trail, duration, onTap, expand:{ sub, actions } } */
        notify(o) { q.push(o); if (el.dataset.state !== 'banner' && el.dataset.state !== 'expanded') next(); },
        /** 常驻实时活动（紧凑态，例如通话计时 / 音乐波形）；传 null 取消 */
        live(o) { live = o; if (el.dataset.state === 'idle' || el.dataset.state === 'compact') { if (o) set('compact', o); else set('idle'); } },
        dismiss: next,
        get state() { return el.dataset.state; },
    };
}

/* ---------------- 左滑回复 ---------------- */
export function attachSwipeToReply(thread, { onReply, selector = '.rp-msg2', bubble = '.rp-bub', threshold = 56, max = 80 } = {}) {
    let s = null;
    const down = (e) => {
        const row = e.target.closest(selector);
        if (!row || !thread.contains(row) || e.button > 0) return;
        if (!row.querySelector('.rp-swipe-ico')) row.insertAdjacentHTML('beforeend', `<span class="rp-swipe-ico" aria-hidden="true">${glyph('reply')}</span>`);
        s = { row, b: row.querySelector(bubble) || row, x: e.clientX, y: e.clientY, dx: 0, lock: null, armed: false, id: e.pointerId };
    };
    const move = (e) => {
        if (!s || e.pointerId !== s.id) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (s.lock == null && Math.hypot(dx, dy) > 8) s.lock = Math.abs(dx) > Math.abs(dy) * 1.3 && dx < 0 ? 'x' : 'y';
        if (s.lock !== 'x') return;
        e.preventDefault();
        s.row.setAttribute('data-swiping', '');
        // 越过阈值后加阻尼（橡皮筋）
        const raw = Math.min(0, dx);
        s.dx = raw < -threshold ? -threshold - Math.min(max - threshold, (-raw - threshold) * 0.35) : raw;
        s.b.style.setProperty('--rp-swipe-x', s.dx.toFixed(1) + 'px');
        s.row.style.setProperty('--rp-swipe-p', Math.min(1, -s.dx / threshold).toFixed(3));
        const armed = -s.dx >= threshold;
        if (armed !== s.armed) { s.armed = armed; s.row.toggleAttribute('data-armed', armed); if (armed) haptic(); }
    };
    const up = (e) => {
        if (!s || (e && e.pointerId !== s.id)) return;
        const { row, b, armed } = s;
        s = null;
        row.removeAttribute('data-swiping');
        row.removeAttribute('data-armed');
        b.style.removeProperty('--rp-swipe-x');        // 交给 CSS 弹簧回位
        row.style.removeProperty('--rp-swipe-p');
        if (armed && onReply) onReply(row);
    };
    thread.addEventListener('pointerdown', down);
    thread.addEventListener('pointermove', move, { passive: false });
    thread.addEventListener('pointerup', up);
    thread.addEventListener('pointercancel', up);
    return () => {
        thread.removeEventListener('pointerdown', down);
        thread.removeEventListener('pointermove', move);
        thread.removeEventListener('pointerup', up);
        thread.removeEventListener('pointercancel', up);
    };
}

/* ---------------- Tapback（长按 / 双击） ---------------- */
/* v2.1：回应改为 SVG 图标名（shared/icons.js），不再使用 emoji。onReact(row, name) 收到的是图标名，
   需要旧的字符值时用 TAPBACK_LABELS[name] 取中文名自行映射。自定义 emojis 选项传入未知名字时按纯文本渲染（向后兼容）。 */
export const TAPBACKS = ['heart', 'thumbs-up', 'thumbs-down', 'laugh', 'exclaim-double', 'question'];
export const TAPBACK_LABELS = { heart: '喜欢', 'thumbs-up': '赞', 'thumbs-down': '踩', laugh: '哈哈', 'exclaim-double': '强调', question: '疑问' };
const ICON = (name, opts) => { try { const L = globalThis.LonShaIcons; return L && L.has(name) ? L.svg(name, opts) : null; } catch (_) { return null; } };
const glyph = (name, opts) => ICON(name, opts) ?? String(name).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function attachTapbacks(thread, { layer, emojis = TAPBACKS, actions = [['回复', 'reply'], ['复制', 'copy'], ['引用', 'quote'], ['撤回', 'undo', true]], onReact, onAction, longPress = 380 } = {}) {
    if (!layer) return () => {};
    let t = null, cur = null;
    const close = () => { layer.hidden = true; layer.innerHTML = ''; cur = null; };
    const open = (row) => {
        cur = row;
        const mine = row.querySelector('.rp-tapback[data-mine]');
        layer.dataset.from = row.dataset.from || 'other';
        const clone = row.cloneNode(true);
        clone.classList.add('rp-react-focus');
        clone.querySelectorAll('.rp-tapback, .rp-swipe-ico').forEach(n => n.remove());
        clone.removeAttribute('data-pos');
        layer.innerHTML = `<div class="rp-react-bar" role="toolbar" aria-label="回应">${emojis.map(em => `<button type="button" data-em="${em}" aria-pressed="${mine && mine.dataset.em === em}" aria-label="回应：${TAPBACK_LABELS[em] || em}">${glyph(em, { fill: true })}</button>`).join('')}</div>`;
        layer.appendChild(clone);
        layer.insertAdjacentHTML('beforeend', `<div class="rp-react-menu" role="menu">${actions.map(([l, ico, danger]) => `<button type="button" role="menuitem" data-act="${l}"${danger ? ' data-danger' : ''}>${l}<span aria-hidden="true">${glyph(ico)}</span></button>`).join('')}</div>`);
        layer.hidden = false;
        haptic(12);
        requestAnimationFrame(() => layer.querySelector('.rp-react-bar button')?.focus());
    };
    const react = (row, em) => {
        let tb = row.querySelector('.rp-tapback[data-mine]');
        if (tb && tb.dataset.em === em) tb.remove();
        else {
            if (!tb) { tb = document.createElement('span'); tb.className = 'rp-tapback'; tb.setAttribute('data-mine', ''); row.querySelector('.rp-bub')?.appendChild(tb); }
            tb.dataset.em = em; tb.innerHTML = glyph(em, { fill: true }); tb.setAttribute('aria-label', TAPBACK_LABELS[em] || em);
            try { tb.getAnimations().forEach((a) => { a.cancel(); a.play(); }); } catch (_) { /* 旧浏览器：不重播 */ }   // 重新播放弹出动画
        }
        onReact && onReact(row, tb && tb.isConnected ? em : null);
    };
    const pd = (e) => {
        const b = e.target.closest('.rp-bub');
        if (!b || !thread.contains(b)) return;
        const sx = e.clientX, sy = e.clientY;
        clearTimeout(t);
        t = setTimeout(() => open(b.closest('.rp-msg2')), longPress);
        const cancel = (ev) => { if (!ev || ev.type !== 'pointermove' || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { clearTimeout(t); thread.removeEventListener('pointermove', cancel); } };
        thread.addEventListener('pointermove', cancel);
        thread.addEventListener('pointerup', () => cancel(), { once: true });
    };
    const dbl = (e) => { const b = e.target.closest('.rp-bub'); if (b && thread.contains(b)) react(b.closest('.rp-msg2'), emojis[0]); };
    const ctx = (e) => { if (e.target.closest('.rp-bub')) e.preventDefault(); };
    const lc = (e) => {
        const em = e.target.closest('[data-em]');
        if (em && cur) { react(cur, em.dataset.em); close(); return; }
        const act = e.target.closest('[data-act]');
        if (act && cur) { const row = cur; close(); onAction && onAction(act.dataset.act, row); return; }
        if (e.target === layer) close();
    };
    const key = (e) => { if (e.key === 'Escape' && !layer.hidden) { e.stopPropagation(); close(); } };
    thread.addEventListener('pointerdown', pd);
    thread.addEventListener('dblclick', dbl);
    thread.addEventListener('contextmenu', ctx);
    layer.addEventListener('click', lc);
    document.addEventListener('keydown', key, true);
    return () => {
        thread.removeEventListener('pointerdown', pd); thread.removeEventListener('dblclick', dbl); thread.removeEventListener('contextmenu', ctx);
        layer.removeEventListener('click', lc); document.removeEventListener('keydown', key, true);
    };
}

/* ---------------- 控制中心 ---------------- */
export function attachControlCenter(cc, { trigger, onOpen, onClose } = {}) {
    const grid = cc.querySelector('.rp-cc-grid');
    const setOpen = (on) => {
        cc.toggleAttribute('data-open', on);
        cc.setAttribute('aria-hidden', String(!on));
        cc.style.removeProperty('--rp-cc-drag');
        if (on) { haptic(); onOpen && onOpen(); requestAnimationFrame(() => cc.querySelector('button, [role="slider"]')?.focus({ preventScroll: true })); }
        else onClose && onClose();
    };
    // 从顶部下拉呼出 / 在面板上上推收起（跟手 + 松手弹簧）
    let d = null;
    const start = (e, from) => { d = { y: e.clientY, from, id: e.pointerId }; };
    const mv = (e) => {
        if (!d || e.pointerId !== d.id) return;
        const dy = e.clientY - d.y;
        if (d.from === 'trigger' && dy > 6) { if (!cc.hasAttribute('data-open')) { cc.setAttribute('data-open', ''); cc.setAttribute('data-dragging', ''); } cc.style.setProperty('--rp-cc-drag', Math.min(0, dy - 120).toFixed(0) + 'px'); }
        if (d.from === 'cc' && dy < -6 && !e.target.closest('[role="slider"]')) { cc.setAttribute('data-dragging', ''); cc.style.setProperty('--rp-cc-drag', dy.toFixed(0) + 'px'); }
    };
    const end = (e) => {
        if (!d || (e && e.pointerId !== d.id)) return;
        const dy = e ? e.clientY - d.y : 0, from = d.from;
        d = null;
        cc.removeAttribute('data-dragging');
        if (from === 'trigger') setOpen(dy > 60 || cc.hasAttribute('data-open') && dy > 6);
        else if (dy < -60) setOpen(false);
        else cc.style.removeProperty('--rp-cc-drag');
    };
    const tDown = (e) => start(e, 'trigger');
    const cDown = (e) => { if (e.target === cc) { setOpen(false); return; } start(e, 'cc'); };
    const key = (e) => { if (e.key === 'Escape' && cc.hasAttribute('data-open')) { e.stopPropagation(); setOpen(false); } };
    trigger && trigger.addEventListener('pointerdown', tDown);
    cc.addEventListener('pointerdown', cDown);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', end);
    document.addEventListener('keydown', key, true);
    // 圆形开关
    const tiles = (e) => { const b = e.target.closest('.rp-cc-tile'); if (b && cc.contains(b)) { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); haptic(6); } };
    cc.addEventListener('click', tiles);
    // 竖向滑杆
    cc.querySelectorAll('.rp-cc-slider').forEach((sl) => attachVerticalSlider(sl));
    void grid;
    return {
        open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!cc.hasAttribute('data-open')),
        detach() {
            trigger && trigger.removeEventListener('pointerdown', tDown);
            cc.removeEventListener('pointerdown', cDown); cc.removeEventListener('click', tiles);
            window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end);
            document.removeEventListener('keydown', key, true);
        },
    };
}
export function attachVerticalSlider(sl, onChange) {
    const setV = (v) => {
        v = Math.max(0, Math.min(100, Math.round(v)));
        sl.style.setProperty('--v', v);
        sl.setAttribute('aria-valuenow', String(v));
        onChange && onChange(v);
    };
    if (!sl.hasAttribute('tabindex')) sl.tabIndex = 0;
    sl.setAttribute('role', 'slider');
    sl.setAttribute('aria-valuemin', '0');
    sl.setAttribute('aria-valuemax', '100');
    setV(+(sl.getAttribute('aria-valuenow') || 50));
    let on = false;
    const at = (e) => { const r = sl.getBoundingClientRect(); setV(((r.bottom - e.clientY) / r.height) * 100); };
    sl.addEventListener('pointerdown', (e) => { on = true; sl.setAttribute('data-dragging', ''); sl.setPointerCapture(e.pointerId); at(e); e.stopPropagation(); });
    sl.addEventListener('pointermove', (e) => { if (on) at(e); });
    const stop = () => { on = false; sl.removeAttribute('data-dragging'); };
    sl.addEventListener('pointerup', stop); sl.addEventListener('pointercancel', stop);
    sl.addEventListener('keydown', (e) => {
        const cur = +sl.getAttribute('aria-valuenow');
        const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 }[e.key];
        if (step) { e.preventDefault(); setV(cur + step); }
        if (e.key === 'Home') setV(0); if (e.key === 'End') setV(100);
    });
}

/* ---------------- 朋友圈：赞 / 评论 ---------------- */
export function attachMomentActions(feed, { onLike, onComment } = {}) {
    const closeAll = (except) => feed.querySelectorAll('.rp-moment-pop[data-open]').forEach(p => { if (p !== except) p.removeAttribute('data-open'); });
    const click = (e) => {
        const more = e.target.closest('.rp-moment-more');
        if (more) { const pop = more.parentElement.querySelector('.rp-moment-pop'); closeAll(pop); pop.toggleAttribute('data-open'); more.setAttribute('aria-expanded', String(pop.hasAttribute('data-open'))); return; }
        const like = e.target.closest('[data-like]');
        if (like) {
            const on = like.getAttribute('aria-pressed') !== 'true';
            like.setAttribute('aria-pressed', String(on));
            like.querySelector('.rp-like-text') && (like.querySelector('.rp-like-text').textContent = on ? '取消' : '赞');
            haptic(on ? 10 : 4);
            onLike && onLike(like.closest('.rp-moment'), on);
            setTimeout(() => like.closest('.rp-moment-pop')?.removeAttribute('data-open'), 260);
            return;
        }
        const cm = e.target.closest('[data-comment]');
        if (cm) { cm.closest('.rp-moment-pop')?.removeAttribute('data-open'); onComment && onComment(cm.closest('.rp-moment')); return; }
        closeAll();
    };
    feed.addEventListener('click', click);
    // 滚动后导航栏变实（封面图上方透明 -> 毛玻璃）
    const sc = () => feed.toggleAttribute('data-scrolled', feed.scrollTop > 160);
    feed.addEventListener('scroll', sc, { passive: true });
    return () => { feed.removeEventListener('click', click); feed.removeEventListener('scroll', sc); };
}

/* ---------------- 锁屏：上滑解锁 ---------------- */
export function attachLockScreen(lock, { onUnlock } = {}) {
    let s = null;
    const unlock = () => { lock.dataset.state = 'unlocked'; lock.querySelectorAll('[data-masked]').forEach(n => n.removeAttribute('data-masked')); haptic(14); onUnlock && onUnlock(); };
    const down = (e) => { if (e.target.closest('button')) return; s = { y: e.clientY, id: e.pointerId }; lock.setAttribute('data-dragging', ''); };
    const move = (e) => {
        if (!s || e.pointerId !== s.id) return;
        const dy = Math.min(0, e.clientY - s.y);
        lock.style.setProperty('--rp-lock-y', dy.toFixed(1) + 'px');
        lock.style.setProperty('--rp-lock-p', Math.min(0.9, -dy / 600).toFixed(3));
    };
    const up = (e) => {
        if (!s) return;
        const dy = e.clientY - s.y; s = null;
        lock.removeAttribute('data-dragging');
        lock.style.removeProperty('--rp-lock-y'); lock.style.removeProperty('--rp-lock-p');
        if (dy < -90 || Math.abs(dy) < 4 && e.target.closest('.rp-lock-hint')) unlock();
    };
    lock.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    const key = (e) => { if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') && lock.dataset.state !== 'unlocked' && lock.contains(document.activeElement)) { e.preventDefault(); unlock(); } };
    lock.addEventListener('keydown', key);
    return { unlock, lock: () => { lock.dataset.state = 'locked'; }, detach() { lock.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); lock.removeEventListener('keydown', key); } };
}
