/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 *  config/phone-components.js — [U3] 现代基础 UI 组件库
 *  统一规范：
 *    - 所有交互元素默认达到移动端 44px 最小触控热区；
 *    - 严格遵循 WAI-ARIA 无障碍语义标准；
 *    - 强制语义化设计 token（slate 灰阶、层级变量）。
 *
 *  版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

/**
 * 创建无障碍图标按钮（IconButton）
 * 强制要求 label，防止无文本图标导致屏幕阅读器无法读取。
 * @param {Object} opts
 * @param {string} opts.label - 必须，无障碍文本（写入 aria-label 和 title）
 * @param {string} [opts.icon] - 图标 HTML 或类名（如 'fa fa-cog' 或 '✕'）
 * @param {Function} [opts.onClick] - 点击回调
 * @param {string} [opts.className] - 附加 CSS 类名
 * @param {string} [opts.type] - button 类型，默认 'button'
 * @returns {HTMLButtonElement}
 */
export function createIconButton(opts = {}) {
    const { label, icon = '', onClick, className = '', type = 'button' } = opts;
    if (!label || typeof label !== 'string' || !label.trim()) {
        throw new Error('[phone-components] createIconButton 要求非空 label（供 aria-label 使用）');
    }

    if (typeof document === 'undefined' || !document.createElement) {
        return { label, icon, type };
    }

    const btn = document.createElement('button');
    btn.type = type;
    btn.className = `rp-icon-btn ${className}`.trim();
    btn.setAttribute('aria-label', label.trim());
    btn.setAttribute('title', label.trim());

    // 默认样式类与内联尺寸保障 44px 热区
    btn.style.minWidth = '44px';
    btn.style.minHeight = '44px';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.cursor = 'pointer';

    if (icon.startsWith('<')) {
        btn.innerHTML = icon;
    } else if (icon.startsWith('fa') || icon.includes(' ')) {
        const i = document.createElement('i');
        i.className = icon;
        i.setAttribute('aria-hidden', 'true');
        btn.appendChild(i);
    } else {
        btn.textContent = icon;
    }

    if (typeof onClick === 'function') {
        btn.addEventListener('click', onClick);
    }

    return btn;
}

/**
 * 创建通用卡片组件（Card）
 * @param {Object} opts
 * @param {string} [opts.title] - 标题
 * @param {string} [opts.subtitle] - 副标题
 * @param {HTMLElement|string} [opts.content] - 卡片内容
 * @param {HTMLElement|string} [opts.footer] - 底部内容
 * @param {string} [opts.className] - 附加类名
 * @returns {HTMLDivElement}
 */
export function createCard(opts = {}) {
    const { title, subtitle, content, footer, className = '' } = opts;
    if (typeof document === 'undefined' || !document.createElement) {
        return { title, subtitle, content, footer };
    }

    const card = document.createElement('div');
    card.className = `rp-card ${className}`.trim();
    card.style.background = 'var(--rp-slate-100, #f1f5f9)';
    card.style.borderRadius = '12px';
    card.style.padding = '14px';
    card.style.margin = '8px 0';
    card.style.border = '1px solid var(--rp-slate-200, #e2e8f0)';

    if (title || subtitle) {
        const header = document.createElement('div');
        header.className = 'rp-card-header';
        header.style.marginBottom = '10px';
        if (title) {
            const h = document.createElement('div');
            h.className = 'rp-card-title';
            h.style.fontWeight = '600';
            h.style.fontSize = '15px';
            h.textContent = title;
            header.appendChild(h);
        }
        if (subtitle) {
            const sub = document.createElement('div');
            sub.className = 'rp-card-subtitle';
            sub.style.fontSize = '12px';
            sub.style.color = 'var(--rp-slate-500, #64748b)';
            sub.style.marginTop = '2px';
            sub.textContent = subtitle;
            header.appendChild(sub);
        }
        card.appendChild(header);
    }

    if (content) {
        const body = document.createElement('div');
        body.className = 'rp-card-body';
        if (typeof content === 'string') {
            body.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            body.appendChild(content);
        }
        card.appendChild(body);
    }

    if (footer) {
        const foot = document.createElement('div');
        foot.className = 'rp-card-footer';
        foot.style.marginTop = '12px';
        foot.style.paddingTop = '8px';
        foot.style.borderTop = '1px solid var(--rp-slate-200, #e2e8f0)';
        if (typeof footer === 'string') {
            foot.innerHTML = footer;
        } else if (footer instanceof HTMLElement) {
            foot.appendChild(footer);
        }
        card.appendChild(foot);
    }

    return card;
}

/**
 * 创建列表项组件（ListItem）
 * @param {Object} opts
 * @param {HTMLElement|string} [opts.leading] - 前置图标/头像
 * @param {string} opts.title - 主标题
 * @param {string} [opts.subtitle] - 副标题
 * @param {HTMLElement|string} [opts.trailing] - 后置元素（箭头、开关等）
 * @param {Function} [opts.onClick] - 点击回调
 * @param {string} [opts.className] - 附加类名
 * @returns {HTMLDivElement}
 */
export function createListItem(opts = {}) {
    const { leading, title = '', subtitle, trailing, onClick, className = '' } = opts;
    if (typeof document === 'undefined' || !document.createElement) {
        return { leading, title, subtitle, trailing };
    }

    const item = document.createElement('div');
    item.className = `rp-list-item ${className}`.trim();
    item.style.minHeight = '48px';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.padding = '8px 12px';
    item.style.gap = '12px';
    item.style.borderBottom = '1px solid var(--rp-slate-200, #e2e8f0)';
    item.style.boxSizing = 'border-box';

    if (typeof onClick === 'function') {
        item.style.cursor = 'pointer';
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.addEventListener('click', onClick);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
            }
        });
    }

    if (leading) {
        const leadEl = document.createElement('div');
        leadEl.className = 'rp-list-item-leading';
        leadEl.style.flexShrink = '0';
        if (typeof leading === 'string') leadEl.innerHTML = leading;
        else if (leading instanceof HTMLElement) leadEl.appendChild(leading);
        item.appendChild(leadEl);
    }

    const textEl = document.createElement('div');
    textEl.className = 'rp-list-item-text';
    textEl.style.flex = '1';
    textEl.style.minWidth = '0';

    const t = document.createElement('div');
    t.className = 'rp-list-item-title';
    t.style.fontSize = '14px';
    t.style.fontWeight = '500';
    t.textContent = title;
    textEl.appendChild(t);

    if (subtitle) {
        const s = document.createElement('div');
        s.className = 'rp-list-item-subtitle';
        s.style.fontSize = '12px';
        s.style.color = 'var(--rp-slate-500, #64748b)';
        s.style.marginTop = '2px';
        s.textContent = subtitle;
        textEl.appendChild(s);
    }
    item.appendChild(textEl);

    if (trailing) {
        const trailEl = document.createElement('div');
        trailEl.className = 'rp-list-item-trailing';
        trailEl.style.flexShrink = '0';
        if (typeof trailing === 'string') trailEl.innerHTML = trailing;
        else if (trailing instanceof HTMLElement) trailEl.appendChild(trailing);
        item.appendChild(trailEl);
    }

    return item;
}

/**
 * 创建无障碍标签页切换组件（WAI-ARIA Tabs）
 * 包含完整的键盘方向键与 Home/End 导航支持。
 * @param {Object} opts
 * @param {Array<{id: string, label: string, panel: HTMLElement|string}>} opts.tabs - 标签页定义
 * @param {string} [opts.initialTab] - 初始选中的 tab id
 * @param {Function} [opts.onTabChange] - tab 切换回调 (tabId)
 * @param {string} [opts.className] - 附加容器类名
 * @returns {HTMLDivElement}
 */
export function createTabs(opts = {}) {
    const { tabs = [], initialTab, onTabChange, className = '' } = opts;
    if (!Array.isArray(tabs) || tabs.length === 0) {
        throw new Error('[phone-components] createTabs 要求非空的 tabs 数组');
    }

    if (typeof document === 'undefined' || !document.createElement) {
        return { tabs, initialTab };
    }

    const prefix = 'rp-tab-' + Math.random().toString(36).slice(2, 7);
    const container = document.createElement('div');
    container.className = `rp-tabs-container ${className}`.trim();

    const tablist = document.createElement('div');
    tablist.className = 'rp-tabs-nav';
    tablist.setAttribute('role', 'tablist');
    tablist.style.display = 'flex';
    tablist.style.borderBottom = '1px solid var(--rp-slate-200, #e2e8f0)';
    tablist.style.gap = '8px';

    const panelsContainer = document.createElement('div');
    panelsContainer.className = 'rp-tabs-panels';
    panelsContainer.style.marginTop = '8px';

    const tabButtons = [];
    const panelEls = [];

    const activeId = initialTab || tabs[0].id;

    tabs.forEach((tab, index) => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.id = `${prefix}-tab-${tab.id}`;
        tabBtn.className = 'rp-tab-btn';
        tabBtn.setAttribute('role', 'tab');
        tabBtn.setAttribute('data-tab-id', tab.id);
        tabBtn.setAttribute('aria-controls', `${prefix}-panel-${tab.id}`);
        tabBtn.textContent = tab.label;

        tabBtn.style.padding = '8px 14px';
        tabBtn.style.minHeight = '40px';
        tabBtn.style.border = 'none';
        tabBtn.style.background = 'transparent';
        tabBtn.style.cursor = 'pointer';
        tabBtn.style.fontWeight = '500';
        tabBtn.style.fontSize = '14px';
        tabBtn.style.borderBottom = '2px solid transparent';

        const isSelected = tab.id === activeId;
        tabBtn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        tabBtn.tabIndex = isSelected ? 0 : -1;
        if (isSelected) {
            tabBtn.style.borderBottomColor = 'var(--rp-slate-800, #1e293b)';
            tabBtn.style.color = 'var(--rp-slate-900, #0f172a)';
        } else {
            tabBtn.style.color = 'var(--rp-slate-500, #64748b)';
        }

        tablist.appendChild(tabBtn);
        tabButtons.push(tabBtn);

        const panel = document.createElement('div');
        panel.id = `${prefix}-panel-${tab.id}`;
        panel.className = 'rp-tab-panel';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', `${prefix}-tab-${tab.id}`);
        panel.style.display = isSelected ? 'block' : 'none';

        if (typeof tab.panel === 'string') {
            panel.innerHTML = tab.panel;
        } else if (tab.panel instanceof HTMLElement) {
            panel.appendChild(tab.panel);
        }

        panelsContainer.appendChild(panel);
        panelEls.push(panel);
    });

    const activateTab = (tabId, focus = false) => {
        tabButtons.forEach((btn, idx) => {
            const on = btn.getAttribute('data-tab-id') === tabId;
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
            btn.style.borderBottomColor = on ? 'var(--rp-slate-800, #1e293b)' : 'transparent';
            btn.style.color = on ? 'var(--rp-slate-900, #0f172a)' : 'var(--rp-slate-500, #64748b)';
            if (on && focus) btn.focus();

            if (panelEls[idx]) {
                panelEls[idx].style.display = on ? 'block' : 'none';
            }
        });
        if (typeof onTabChange === 'function') {
            onTabChange(tabId);
        }
    };

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            activateTab(btn.getAttribute('data-tab-id'));
        });
    });

    tablist.addEventListener('keydown', (e) => {
        const curIdx = tabButtons.findIndex(b => b === document.activeElement);
        if (curIdx === -1) return;

        let nextIdx = -1;
        if (e.key === 'ArrowRight') {
            nextIdx = (curIdx + 1) % tabButtons.length;
        } else if (e.key === 'ArrowLeft') {
            nextIdx = (curIdx - 1 + tabButtons.length) % tabButtons.length;
        } else if (e.key === 'Home') {
            nextIdx = 0;
        } else if (e.key === 'End') {
            nextIdx = tabButtons.length - 1;
        }

        if (nextIdx !== -1) {
            e.preventDefault();
            activateTab(tabButtons[nextIdx].getAttribute('data-tab-id'), true);
        }
    });

    container.appendChild(tablist);
    container.appendChild(panelsContainer);

    return container;
}
