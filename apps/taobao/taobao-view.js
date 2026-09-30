/* ========================================================
 * taobao-view.js — [v3.29.0] 桃宝 App 视图
 * 归因卡 + 商品目录 + 购物车 + 订单/物流面板 + 娃娃机 + 设置
 *
 * 与 shop-view / piggy-view 同纪律：归因文案表的键取 TAOBAO_REASONS 的**值**。
 * 本视图**只画与派事件**：一切数据变动都回调到 App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 三处「不糊弄」：
 *   · 物流面板显示的是**推演的读数**（走到第几步、下一步还要多久），不是定时器
 *     —— 页面关掉再开，读数自己会补上（App.probe 每次现推）；
 *   · 车里有「已不在目录里」的条目时，把它**明着算出来**（`有 N 项已失效`），不静默吞；
 *   · 娃娃机的战利品只显示**面值**，并写明「不入账」——本仓用户钱包的仲裁源是微信零钱。
 * ======================================================== */
'use strict';
import {
    TAOBAO_REASONS, TAOBAO_LIMITS, REWARD_TIERS,
    formatCents, statusTextOf,
} from './taobao-data.js';

const FACE_META = {
    [TAOBAO_REASONS.ready]: { icon: '\u2705', label: '桃宝开着', tone: 'ok' },
    [TAOBAO_REASONS.empty]: { icon: '\u{1f6d2}', label: '这个会话还没上架任何东西', tone: 'warn' },
    [TAOBAO_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

/** 状态色（键是英文键，文案取数据层的 ORDER_STATUS —— 两边不许各写一份中文）。 */
/** 计数行用的短标签（不在表里的键回落到数据层原文案）。 */
const STATUS_SHORT = { placed: '待付', paid: '待发', shipped: '在途', received: '已签' };
const STATUS_TONE = { placed: 'gray', paid: 'blue', shipped: 'orange', received: 'green' };

/** 物流时间线在面板上一屏最多画几步（9 步全画也不长，但按推演到哪显到哪更真）。 */
const MAX_INLINE_STEPS = 9;

export class TaobaoView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._draft = { name: '', priceYuan: '', note: '' };
        this._openLogi = '';
        this._pendingConfirm = '';
        this._flash = '';
        this._grabLog = '';
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'tbo-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || {
            productCount: 0, unPricedCount: 0, cartCents: 0, cartCount: 0, cartRows: 0, cartMissing: 0,
            orderCount: 0, statusCounts: { placed: 0, paid: 0, shipped: 0, received: 0 },
            pendingCount: 0, inTransitCount: 0, nextEvent: null, grabCount: 0, grabNetCents: 0, hasAny: false,
        };
        const settings = app.settings;
        const limits = app.limits();
        const products = app.productsList();
        const cart = app.cartList();
        const orders = app.ordersList();
        const grabs = app.grabsList();
        const parts = [];

        parts.push('<div class="tbo-header"><h2>\u{1f6cd}\ufe0f 桃宝</h2></div>');

        parts.push('<div class="tbo-face tbo-face-' + meta.tone + '">');
        parts.push('<span class="tbo-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="tbo-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) {
            parts.push('<div class="tbo-flash">' + this._esc(this._flash) + '</div>');
        }

        /* ---------- 读数 ---------- */
        parts.push('<div class="tbo-stats">');
        parts.push('<div class="tbo-stat-row"><span>目录</span><span>' + proj.productCount + ' / ' + limits.maxProducts + ' 件</span></div>');
        if (proj.unPricedCount) {
            parts.push('<div class="tbo-stat-row tbo-warn"><span>没定价</span><span>' + proj.unPricedCount + ' 件</span></div>');
        }
        parts.push('<div class="tbo-stat-row"><span>购物车</span><span>' + formatCents(proj.cartCents)
            + ' · ' + proj.cartCount + ' 件' + (proj.cartMissing ? (' · <em>有 ' + proj.cartMissing + ' 项已失效</em>') : '') + '</span></div>');
        parts.push('<div class="tbo-stat-row"><span>订单</span><span>' + proj.orderCount + ' 单（'
            + app.statusOrder().map((k) => (STATUS_SHORT[k] || statusTextOf(k)) + ' ' + (proj.statusCounts[k] || 0)).join(' / ')
            + '）</span></div>');
        parts.push('<div class="tbo-stat-row"><span>娃娃机</span><span>抓过 ' + proj.grabCount + ' 次 · 面值合计 '
            + formatCents(proj.grabNetCents) + '</span></div>');
        parts.push('</div>');

        if (proj.nextEvent) {
            parts.push('<div class="tbo-next">下一站：' + this._esc(proj.nextEvent.text)
                + '<span class="tbo-next-when">还要 ' + this._dur(proj.nextEvent.remainingMs) + '</span></div>');
        }

        /* ★ 两个面由数据层给（`TAOBAO_FACES`）：数据层若去掉一个面，界面跟着少一段。 */
        const faces = app.faces();
        const hasMall = faces.includes('mall');
        const hasClaw = faces.includes('claw');
        if (!hasMall) parts.push('<div class="tbo-empty">（这个版本没带逛街面）</div>');
        if (hasMall) {
        /* ---------- 商品目录 ---------- */
        parts.push('<div class="tbo-list">');
        parts.push('<h3 class="tbo-list-title">商品（' + products.length + '）</h3>');
        if (!products.length) {
            parts.push('<div class="tbo-empty">还没有商品。下面登记一件 —— 本 App 不替你生成商品，也不替你去问模型。</div>');
        } else {
            for (const p of products) {
                const inCart = cart.find((x) => x.productId === p.id);
                parts.push('<div class="tbo-item" data-id="' + this._esc(p.id) + '">');
                parts.push('<div class="tbo-item-main">');
                parts.push('<span class="tbo-item-name">' + this._esc(p.name) + '</span>');
                parts.push('<span class="tbo-item-price">' + (p.unPriced ? '未定价' : formatCents(p.priceCents)) + '</span>');
                if (inCart) parts.push('<span class="tbo-item-incart">车里 ' + inCart.qty + '</span>');
                parts.push('</div>');
                if (p.note) parts.push('<div class="tbo-item-note">' + this._esc(p.note) + '</div>');
                parts.push('<div class="tbo-item-actions">');
                parts.push('<button class="tbo-mini tbo-add-cart" data-id="' + this._esc(p.id) + '">加入购物车</button>');
                parts.push('<button class="tbo-mini tbo-item-del" data-id="' + this._esc(p.id) + '">删</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }
        parts.push('</div>');

        /* ---------- 登记商品 ---------- */
        parts.push('<div class="tbo-create">');
        parts.push('<h3 class="tbo-list-title">登记一件商品</h3>');
        parts.push('<input class="tbo-input" id="tbo-p-name" type="text" maxlength="' + limits.maxNameLen
            + '" placeholder="叫什么" value="' + this._esc(this._draft.name) + '">');
        parts.push('<div class="tbo-create-row">');
        parts.push('<input class="tbo-input tbo-input-price" id="tbo-p-price" type="text" inputmode="decimal" placeholder="价格（元，可留空）" value="' + this._esc(this._draft.priceYuan) + '">');
        parts.push('<input class="tbo-input" id="tbo-p-note" type="text" maxlength="' + limits.maxNoteLen
            + '" placeholder="一句备注（可留空）" value="' + this._esc(this._draft.note) + '">');
        parts.push('</div>');
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-primary" id="tbo-p-add">登记</button>');
        parts.push('<button class="tbo-mini tbo-mini-armed" id="tbo-clear-products">清空目录</button>');
        parts.push('</div>');
        parts.push('<div class="tbo-hint">价格留空 = **未定价**（源里商品价格本来就可能空着），不计入合计。'
            + '钱的单位一律是**分**的整数，不会有 0.1+0.2 那种误差。</div>');
        parts.push('</div>');

        /* ---------- 购物车 ---------- */
        parts.push('<div class="tbo-cart">');
        parts.push('<h3 class="tbo-list-title">购物车</h3>');
        if (!cart.length) {
            parts.push('<div class="tbo-empty">车是空的。</div>');
        } else {
            const byId = new Map(products.map((p) => [p.id, p]));
            for (const row of cart) {
                const p = byId.get(row.productId);
                parts.push('<div class="tbo-cart-row' + (p ? '' : ' is-dead') + '">');
                parts.push('<span class="tbo-cart-name">' + (p ? this._esc(p.name) : '\u26a0\ufe0f 已不在目录里') + '</span>');
                parts.push('<input class="tbo-input tbo-cart-qty" type="number" min="0" max="' + limits.maxQty
                    + '" value="' + row.qty + '" data-id="' + this._esc(row.productId) + '">');
                parts.push('<span class="tbo-cart-price">' + (p ? formatCents(p.priceCents * row.qty) : '\u2014') + '</span>');
                parts.push('<button class="tbo-mini tbo-cart-del" data-id="' + this._esc(row.productId) + '">摘</button>');
                parts.push('</div>');
            }
            parts.push('<div class="tbo-cart-total">合计 <strong>' + formatCents(proj.cartCents) + '</strong>');
            if (proj.cartMissing) parts.push('<span class="tbo-warn-text">（有 ' + proj.cartMissing + ' 项已失效，不计入）</span>');
            parts.push('</div>');
        }
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-primary" id="tbo-order"' + (cart.length ? '' : ' disabled') + '>下单</button>');
        parts.push('<button class="tbo-mini" id="tbo-cart-clear"' + (cart.length ? '' : ' disabled') + '>清空车</button>');
        parts.push('<button class="tbo-mini" id="tbo-push">推演到此刻</button>');
        parts.push('</div>');
        parts.push('</div>');

        /* ---------- 订单 + 物流 ---------- */
        parts.push('<div class="tbo-orders">');
        parts.push('<h3 class="tbo-list-title">订单（' + orders.length + '）</h3>');
        if (!orders.length) {
            parts.push('<div class="tbo-empty">还没有订单。</div>');
        } else {
            for (const o of orders) {
                const key = o.status || 'placed';
                parts.push('<div class="tbo-order tbo-order-' + (STATUS_TONE[key] || 'gray') + '">');
                parts.push('<div class="tbo-order-head">');
                parts.push('<span class="tbo-order-status">' + this._esc(statusTextOf(key)) + '</span>');
                parts.push('<span class="tbo-order-total">' + formatCents(o.totalCents) + '</span>');
                parts.push('</div>');
                parts.push('<div class="tbo-order-city">' + this._esc(o.shipFrom || '') + ' \u2192 '
                    + this._esc(o.transitCity || '\u2014') + ' \u2192 ' + this._esc(o.userCity || '') + '</div>');
                parts.push('<div class="tbo-order-rows">');
                for (const r of (Array.isArray(o.rows) ? o.rows : [])) {
                    parts.push('<span class="tbo-order-row">' + this._esc(r.name) + '\u00d7' + r.qty + '</span>');
                }
                parts.push('</div>');
                parts.push('<div class="tbo-order-actions">');
                parts.push('<button class="tbo-mini tbo-logi-toggle" data-id="' + this._esc(o.id) + '">'
                    + (this._openLogi === o.id ? '收起物流' : '看物流') + '</button>');
                parts.push('<button class="tbo-mini tbo-order-del" data-id="' + this._esc(o.id) + '">删</button>');
                parts.push('</div>');
                if (this._openLogi === o.id) {
                    parts.push(this._logiHTML(o.id));
                }
                parts.push('</div>');
            }
        }
        parts.push('<div class="tbo-hint">订单状态**由时间推演**，不是定时器改的：源给每个未来步骤挂一个倒计时，'
            + '页面关掉就永远补不上、回来时间线缺格。这里每次取数都按「现在」重算一遍，'
            + '关掉再开自己就补上了。</div>');
        parts.push('</div>');

        } /* 结束逛街面 */
        /* ---------- 娃娃机 ---------- */
        if (hasClaw) {
        parts.push('<div class="tbo-claw">');
        parts.push('<h3 class="tbo-list-title">娃娃机</h3>');
        parts.push('<div class="tbo-claw-pool">');
        for (const t of REWARD_TIERS) {
            parts.push('<span class="tbo-claw-chip">' + this._esc(t.label) + ' ' + t.weight + '%</span>');
        }
        parts.push('</div>');
        parts.push('<div class="tbo-actions">');
        parts.push('<button class="tbo-btn tbo-btn-primary" id="tbo-grab">夹一次</button>');
        parts.push('</div>');
        if (this._grabLog) parts.push('<div class="tbo-flash">' + this._esc(this._grabLog) + '</div>');
        if (grabs.length) {
            parts.push('<div class="tbo-grabs">');
            for (const g of grabs.slice(0, 8)) {
                parts.push('<div class="tbo-grab">');
                parts.push('<span class="tbo-grab-label">' + this._esc(g.label || g.type) + '</span>');
                parts.push('<span class="tbo-grab-value">' + formatCents(g.valueCents) + '</span>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }
        parts.push('<div class="tbo-hint">战利品**只登记面值，不入任何账**：本仓用户钱包的仲裁源是微信零钱，'
            + '这里再记一笔，同一笔钱就有两个记账者了。要不要记进钱包，你自己定。</div>');
        } /* 结束娃娃机面 */
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="tbo-settings">');
        parts.push('<h3 class="tbo-list-title">设置</h3>');
        parts.push('<label class="tbo-toggle"><span>把「在途订单」交给生成侧</span>'
            + '<input type="checkbox" id="tbo-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="tbo-field"><span>注入时带几条</span>'
            + '<input type="number" id="tbo-max-inject" min="0" max="20" value="' + settings.maxInjectOrders + '"></label>');
        parts.push('<label class="tbo-field"><span>物流时间倍率</span>'
            + '<input type="number" id="tbo-speed" min="1" max="' + limits.maxSpeedFactor + '" value="' + settings.speedFactor + '"></label>');
        parts.push('<label class="tbo-field"><span>最多留几次抓取</span>'
            + '<input type="number" id="tbo-max-grabs" min="5" max="200" value="' + settings.maxGrabs + '"></label>');
        parts.push('<div class="tbo-hint">倍率 1× 就是源的时间尺度（全流程约 82.4 小时）；'
            + '调到 3600× 时 82 秒就能看到签收。**倍率只改「时刻怎么算」，不会让已经发出的货退回去。**'
            + '目录、车、订单、抓取记录都随会话走：换角色后那是另一个角色的另一个店。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    /** 物流面板：推演到哪画到哪 + 一条进度。 */
    _logiHTML(orderId) {
        const app = this.app;
        const info = app.logisticsOf(orderId);
        if (!info) return '<div class="tbo-logi"><div class="tbo-empty">这一单找不到了。</div></div>';
        const parts = [];
        parts.push('<div class="tbo-logi">');
        parts.push('<div class="tbo-logi-head">当前：' + this._esc(info.statusText)
            + '<span class="tbo-logi-progress">' + info.doneCount + ' / ' + info.steps.length + ' 步</span></div>');
        const show = info.steps.slice(0, Math.min(MAX_INLINE_STEPS, info.shownCount));
        /* 倒序（最新在上）—— 源也是 `prepend`，时间线最新的那条在最上面。 */
        for (const s of show.slice().reverse()) {
            parts.push('<div class="tbo-logi-step' + (s.done ? ' is-done' : '') + '">');
            parts.push('<span class="tbo-logi-text">' + this._esc(s.text) + '</span>');
            parts.push('<span class="tbo-logi-time">' + this._at(s.at) + '</span>');
            parts.push('</div>');
        }
        if (info.next) {
            parts.push('<div class="tbo-logi-next">下一步：' + this._esc(info.next.text)
                + '<span class="tbo-next-when">还要 ' + this._dur(info.remainingMs) + '</span></div>');
        } else {
            parts.push('<div class="tbo-logi-next">9 步走完了。</div>');
        }
        parts.push('</div>');
        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        /* 加入购物车 */
        for (const b of this._root.querySelectorAll('.tbo-add-cart')) {
            b.addEventListener('click', () => {
                const r = app.cartAdd(b.dataset.id, 1);
                if (!r.ok) { this._flash = r.error || '加不进去'; }
                else if (r.clamped) { this._flash = '数量到上限了（' + TAOBAO_LIMITS.maxQty + '）'; }
                else { this._flash = ''; }
                this.refresh();
            });
        }

        /* 删商品（两步确认） */
        for (const b of this._root.querySelectorAll('.tbo-item-del')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                if (this._needConfirm('tbo-p:' + id, b)) return;
                app.removeProduct(id);
                this.refresh();
            });
        }

        /* 登记商品 */
        const pName = q('#tbo-p-name');
        if (pName) pName.addEventListener('input', () => { this._draft.name = pName.value; });
        const pPrice = q('#tbo-p-price');
        if (pPrice) pPrice.addEventListener('input', () => { this._draft.priceYuan = pPrice.value; });
        const pNote = q('#tbo-p-note');
        if (pNote) pNote.addEventListener('input', () => { this._draft.note = pNote.value; });
        const pAdd = q('#tbo-p-add');
        if (pAdd) pAdd.addEventListener('click', () => {
            const r = app.addProduct({ name: this._draft.name, priceYuan: this._draft.priceYuan, note: this._draft.note });
            if (!r.ok) { this._flash = r.error || '登记失败'; this.refresh(); return; }
            this._flash = r.unPriced ? '登记好了（没填价，标成未定价）' : '登记好了';
            this._draft = { name: '', priceYuan: '', note: '' };
            this.refresh();
        });

        const clearP = q('#tbo-clear-products');
        if (clearP) clearP.addEventListener('click', () => {
            if (this._needConfirm('tbo-clear-p', clearP)) return;
            const n = app.clearProducts();
            this._flash = n ? ('清掉了 ' + n + ' 件') : '本来就是空的';
            this.refresh();
        });

        /* 购物车 */
        for (const el of this._root.querySelectorAll('.tbo-cart-qty')) {
            el.addEventListener('change', () => { app.cartSet(el.dataset.id, el.value); this.refresh(); });
        }
        for (const b of this._root.querySelectorAll('.tbo-cart-del')) {
            b.addEventListener('click', () => { app.cartRemove(b.dataset.id); this.refresh(); });
        }
        const cartClear = q('#tbo-cart-clear');
        if (cartClear) cartClear.addEventListener('click', () => { app.cartClear(); this.refresh(); });
        const order = q('#tbo-order');
        if (order) order.addEventListener('click', () => {
            const r = app.doOrder();
            if (!r.ok) { this._flash = r.error || '下不了单'; this.refresh(); return; }
            this._flash = '下单了，物流从「已提交」开始';
            this._openLogi = r.orderId;
            this.refresh();
        });
        const push = q('#tbo-push');
        if (push) push.addEventListener('click', () => {
            const r = app.doPush();
            this._flash = r.changed ? ('推进了 ' + r.changed + ' 单') : '还没有哪一单到时候';
            this.refresh();
        });

        /* 物流面板 / 删单 */
        for (const b of this._root.querySelectorAll('.tbo-logi-toggle')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                this._openLogi = (this._openLogi === id) ? '' : id;
                this.refresh();
            });
        }
        for (const b of this._root.querySelectorAll('.tbo-order-del')) {
            b.addEventListener('click', () => {
                const id = b.dataset.id;
                if (this._needConfirm('tbo-o:' + id, b)) return;
                app.removeOrder(id);
                if (this._openLogi === id) this._openLogi = '';
                this.refresh();
            });
        }

        /* 娃娃机 */
        const grab = q('#tbo-grab');
        if (grab) grab.addEventListener('click', () => {
            const r = app.doGrab('');
            const e = r.entry || {};
            this._grabLog = e.label ? ('夹到「' + e.label + '」' + formatCents(e.valueCents)) : '这次空了';
            this.refresh();
        });

        /* 设置 */
        const inject = q('#tbo-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const maxInject = q('#tbo-max-inject');
        if (maxInject) maxInject.addEventListener('change', (e) => app.patchSettings({ maxInjectOrders: e.target.value }));
        const speed = q('#tbo-speed');
        if (speed) speed.addEventListener('change', (e) => app.patchSettings({ speedFactor: e.target.value }));
        const maxGrabs = q('#tbo-max-grabs');
        if (maxGrabs) maxGrabs.addEventListener('change', (e) => app.patchSettings({ maxGrabs: e.target.value }));
    }

    /** 时长人话：秒 / 分 / 小时 / 天（源没有这一层，本件为「还要多久」加的）。 */
    _dur(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '不到 1 秒';
        const s = Math.round(n / 1000);
        if (s < 60) return s + ' 秒';
        const m = Math.round(s / 60);
        if (m < 60) return m + ' 分钟';
        const h = Math.floor(m / 60);
        const rm = m % 60;
        if (h < 24) return rm ? (h + ' 小时 ' + rm + ' 分') : (h + ' 小时');
        const d = Math.floor(h / 24);
        const rh = h % 24;
        return rh ? (d + ' 天 ' + rh + ' 小时') : (d + ' 天');
    }

    /** 时刻（本地时分；只画时间不画日期 —— 单一单最多跨三天，够用）。 */
    _at(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n)) return '';
        try {
            const d = new Date(n);
            const p = (x) => String(x).padStart(2, '0');
            return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        } catch (_e) { return ''; }
    }

    /** 两步确认（删商品/订单不可逆，而本仓不弹宿主 confirm）。 */
    _needConfirm(key, btn) {
        if (this._pendingConfirm === key) { this._pendingConfirm = ''; return false; }
        this._pendingConfirm = key;
        if (btn) { btn.textContent = '确认'; btn.classList.add('tbo-mini-armed'); }
        return true;
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
}

/* （无尾部导出：本视图只用数据层的常量，不再另开一份同形的汇总导出 —— 多余的出口会被死导出门报。） */