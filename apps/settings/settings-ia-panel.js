/**
 * apps/settings/settings-ia-panel.js — 设置面信息架构面板（v4.157.0 · R25-O5）
 *
 * 【为什么单独一个文件】`settings-app.js` 已经 12,798 行，O5 自带「新增行数有上限」约束。
 * 所以判据面在 `config/settings-ia.js`（纯函数），DOM 面在这里，主文件只留 import + 一次 mount。
 *
 * 【这一层真做的事】
 *   1. 组目录：六组各多少项，点一下跳过去（跨 tab，不再靠位置记忆）。
 *   2. 搜索可见：复用设置页已有搜索框 `#r22-settings-filter`（只挂一个 input 监听，不新建第二个索引），
 *      命中结果画在**可见区**，每条带「组 · 分区」，点一条就切 tab 滚过去。
 *      —— 修的是 R22-O2 的真缺口：命中项可能正躺在 `hidden` 的 tab 里，用户只看到「一片空白」。
 *   3. 恢复默认：统一入口 → 先出差异预览（从什么变成什么）→ 勾选 → 写入 → 回执四态。
 *      读不到当前值就如实说「未知」，绝不当成「都是默认值」。
 *
 * 【边界】只写 `IA_RESET_ENTRIES` 登记过的键（默认值可从源码对账）；没登记的项不给假按钮。
 */
import {
    IA_RESET_ENTRIES,
    iaItemKey,
    buildIaIndex,
    iaSearch,
    iaResetPlan,
    iaResetReceipt,
    iaPanelNote,
    settingsIaSelfCheck
} from '../../config/settings-ia.js?v=4.157.0&r=20261119-r25o5';

export const IA_PANEL_ID = 'r25-ia-panel';
const IA_STYLE_ID = 'r25-ia-style';
const MAX_HITS = 40;

function esc(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // 引号实体拆开写：整串实体在生成链里会被吃掉（本仓踩过两次）
        .replace(/"/g, '&' + 'quot;');
}

function squash(text) {
    return String(text == null ? '' : text).split('\n').join(' ').replace(/[ \t\r]+/g, ' ').trim();
}

/** 元素所属分区标题（找不到就空；空标题由内核统一记成「未分组」）。 */
function sectionTitleOf(el) {
    let node = el && el.parentElement;
    while (node) {
        if (node.matches && node.matches('.setting-section, details')) {
            const t = node.querySelector('.setting-section-title, .settings-subsection-title, summary');
            return squash(t && t.textContent);
        }
        node = node.parentElement;
    }
    return '';
}

/** DOM → 分区快照（内核只吃这个形状，不认识 DOM）。 */
export function collectIaSnapshot(root) {
    const host = root && typeof root.querySelectorAll === 'function' ? root : null;
    if (!host) return [];
    const tabIds = [];
    host.querySelectorAll('[data-tab]').forEach(function (btn) {
        const id = String(btn.getAttribute('data-tab') || '').trim();
        if (id && tabIds.indexOf(id) === -1) tabIds.push(id);
    });
    const snapshot = [];
    tabIds.forEach(function (tabId) {
        const panel = host.querySelector('#tab-' + tabId);
        if (!panel) return;
        const sections = [];
        const byTitle = new Map();
        panel.querySelectorAll('.setting-item').forEach(function (item) {
            const labelEl = item.querySelector('.setting-label');
            const label = squash(labelEl && labelEl.textContent) || squash(String(item.textContent || '').slice(0, 40));
            if (!label) return;
            const title = sectionTitleOf(item) || '未分组';
            if (!byTitle.has(title)) {
                const bucket = { title, items: [] };
                byTitle.set(title, bucket);
                sections.push(bucket);
            }
            byTitle.get(title).items.push({ label });
        });
        if (sections.length) snapshot.push({ tab: tabId, sections });
    });
    return snapshot;
}

function injectStyle(doc) {
    if (!doc || doc.getElementById(IA_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = IA_STYLE_ID;
    style.textContent = [
        '#' + IA_PANEL_ID + '{margin:2px 10px 8px;border:1px solid #e6e6e6;border-radius:10px;background:#fbfbfb;padding:8px;}',
        '#' + IA_PANEL_ID + ' .r25-ia-groups{display:flex;flex-wrap:wrap;gap:6px;}',
        '#' + IA_PANEL_ID + ' .r25-ia-group{border:1px solid #dcdcdc;background:#fff;border-radius:999px;padding:4px 9px;font-size:11px;color:#333;cursor:pointer;line-height:1.4;}',
        '#' + IA_PANEL_ID + ' .r25-ia-group[data-empty="1"]{color:#aaa;border-style:dashed;cursor:default;}',
        '#' + IA_PANEL_ID + ' .r25-ia-group b{font-weight:600;color:#0b6bcb;margin-left:3px;}',
        '#' + IA_PANEL_ID + ' .r25-ia-results{display:flex;flex-direction:column;gap:4px;margin-top:6px;max-height:190px;overflow:auto;}',
        '#' + IA_PANEL_ID + ' .r25-ia-hit{display:flex;gap:6px;align-items:baseline;justify-content:space-between;border:1px solid #e6e6e6;background:#fff;border-radius:8px;padding:5px 8px;font-size:11px;color:#222;cursor:pointer;text-align:left;}',
        '#' + IA_PANEL_ID + ' .r25-ia-hit span.r25-ia-route{color:#8a8a8a;font-size:10px;white-space:nowrap;}',
        '#' + IA_PANEL_ID + ' .r25-ia-foot{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:7px;}',
        '#' + IA_PANEL_ID + ' .r25-ia-status{font-size:11px;color:#666;min-height:15px;flex:1;min-width:0;}',
        '#' + IA_PANEL_ID + ' .r25-ia-reset{border:1px solid #d8d8d8;background:#fff;border-radius:8px;padding:5px 9px;font-size:11px;color:#333;cursor:pointer;white-space:nowrap;}',
        '#' + IA_PANEL_ID + ' .r25-ia-sheet{position:fixed;left:8%;right:8%;top:12%;max-height:70%;overflow:auto;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:12px;z-index:9999;}',
        '#' + IA_PANEL_ID + ' .r25-ia-sheet h4{margin:0 0 4px;font-size:13px;}',
        '#' + IA_PANEL_ID + ' .r25-ia-sheet p{margin:0 0 8px;font-size:11px;color:#777;}',
        '#' + IA_PANEL_ID + ' .r25-ia-sheet label{display:flex;gap:6px;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px dashed #eee;}',
        '#' + IA_PANEL_ID + ' .r25-ia-sheet .r25-ia-diff{color:#0b6bcb;}',
        '#' + IA_PANEL_ID + ' .r25-ia-sheet .r25-ia-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;}',
        '#' + IA_PANEL_ID + ' .r25-ia-flash{outline:2px solid #0b6bcb;outline-offset:2px;transition:outline-color .3s ease;}'
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
}

/**
 * 挂载面板。可重复调用（每次设置页重渲都会调一次）。
 * @param {Element} root 设置页根
 * @param {{storage:object, doc?:Document, lastReceipt?:Function, jumpSlot?:object, onAfterReset?:Function, mountPoint?:Element}} opts
 */
export function mountIaPanel(root, opts) {
    const host = root && typeof root.querySelector === 'function' ? root : null;
    const options = opts && typeof opts === 'object' ? opts : {};
    if (!host) return { ok: false, reason: 'no-root' };
    const doc = options.doc || host.ownerDocument || (typeof document === 'undefined' ? null : document);
    if (!doc) return { ok: false, reason: 'no-document' };
    const storage = options.storage;
    const jumpSlot = options.jumpSlot && typeof options.jumpSlot === 'object' ? options.jumpSlot : { key: null };

    const old = host.querySelector('#' + IA_PANEL_ID) || doc.getElementById(IA_PANEL_ID);
    if (old && old.remove) old.remove();
    injectStyle(doc);

    const snapshot = collectIaSnapshot(host);
    const index = buildIaIndex(snapshot);

    const panel = doc.createElement('div');
    panel.id = IA_PANEL_ID;
    panel.className = 'r25-ia-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '设置分组与恢复默认');

    const groupsBox = doc.createElement('div');
    groupsBox.className = 'r25-ia-groups';
    groupsBox.setAttribute('role', 'group');
    groupsBox.setAttribute('aria-label', '设置分组');

    const resultsBox = doc.createElement('div');
    resultsBox.className = 'r25-ia-results';
    resultsBox.id = 'r25-ia-results';
    resultsBox.hidden = true;

    const foot = doc.createElement('div');
    foot.className = 'r25-ia-foot';

    const status = doc.createElement('div');
    status.className = 'r25-ia-status';
    status.id = 'r25-ia-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const resetBtn = doc.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'r25-ia-reset';
    resetBtn.id = 'r25-ia-reset';
    resetBtn.textContent = '恢复默认设置';

    const sheet = doc.createElement('div');
    sheet.className = 'r25-ia-sheet';
    sheet.id = 'r25-ia-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '恢复默认设置确认');
    sheet.hidden = true;

    foot.appendChild(status);
    foot.appendChild(resetBtn);
    panel.appendChild(groupsBox);
    panel.appendChild(resultsBox);
    panel.appendChild(foot);
    panel.appendChild(sheet);

    const mountPoint = options.mountPoint && options.mountPoint.parentNode ? options.mountPoint : (host.querySelector('#r22-settings-filter-status') || host.querySelector('.settings-tabs'));
    if (mountPoint && mountPoint.parentNode) {
        if (mountPoint.id === 'r22-settings-filter-status') mountPoint.insertAdjacentElement('afterend', panel);
        else mountPoint.insertAdjacentElement('afterend', panel);
    } else {
        host.appendChild(panel);
    }

    const api = {
        index,
        panel,
        lastSearch: null,
        lastReceipt: null,
        appliedAt: 0
    };

    function setStatus(text) {
        status.textContent = String(text == null ? '' : text);
    }

    /** 目标项在 DOM 里的真元素（按 tab + 分区 + 标签重算，不靠序号）。 */
    function findItemEl(target) {
        const panelEl = host.querySelector('#tab-' + target.tab);
        if (!panelEl) return null;
        let hit = null;
        panelEl.querySelectorAll('.setting-item').forEach(function (item) {
            if (hit) return;
            const labelEl = item.querySelector('.setting-label');
            const label = squash(labelEl && labelEl.textContent) || squash(String(item.textContent || '').slice(0, 40));
            const title = sectionTitleOf(item) || '未分组';
            if (iaItemKey(target.tab, title, label) === target.key) hit = item;
        });
        return hit;
    }

    function flash(el) {
        if (!el || !el.classList) return;
        el.classList.add('r25-ia-flash');
        if (typeof setTimeout === 'function') {
            setTimeout(function () { el.classList.remove('r25-ia-flash'); }, 1400);
        }
    }

    /** 切 tab 或滚动到目标项。切 tab 会触发设置页整页重渲，所以切之前把目标写进 jumpSlot。 */
    function jumpTo(target) {
        if (!target) return { ok: false, reason: 'no-target' };
        const tabBtn = host.querySelector('.settings-tab-btn[data-tab="' + target.tab + '"]');
        const alreadyThere = !tabBtn || tabBtn.getAttribute('aria-selected') === 'true';
        const el = findItemEl(target);
        if (!alreadyThere) {
            jumpSlot.key = target.key;
            jumpSlot.tab = target.tab;
            if (tabBtn && tabBtn.click) { tabBtn.click(); return { ok: true, reason: 'tab-switch' }; }
            return { ok: false, reason: 'no-tab-button' };
        }
        if (!el) return { ok: false, reason: 'not-found' };
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        // 目标可能躺在一个收起的 <details> 里：先展开再说（展开状态由设置页自己落盘）
        let fold = el.closest ? el.closest('details') : null;
        while (fold) {
            if (!fold.open) fold.open = true;
            fold = fold.parentElement && fold.parentElement.closest ? fold.parentElement.closest('details') : null;
        }
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        flash(el);
        return { ok: true, reason: 'scrolled' };
    }

    function renderGroups() {
        groupsBox.textContent = '';
        index.groups.forEach(function (g) {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'r25-ia-group';
            btn.setAttribute('data-ia-group', g.group);
            btn.setAttribute('data-empty', g.count ? '0' : '1');
            if (!g.count) {
                btn.disabled = true;
                btn.title = '该分组当前没有识别到设置项';
            } else {
                btn.title = '跳到「' + g.title + '」';
            }
            btn.innerHTML = esc(g.title) + '<b>' + g.count + '</b>';
            btn.addEventListener('click', function () {
                const first = g.items[0];
                if (!first) return;
                jumpTo(first);
                setStatus('已跳到「' + g.title + '」（' + g.count + ' 项）');
            });
            groupsBox.appendChild(btn);
        });
    }

    function renderHits(result) {
        resultsBox.textContent = '';
        const hits = result && result.face === 'results' ? result.hits : [];
        if (!hits.length) { resultsBox.hidden = true; return; }
        resultsBox.hidden = false;
        hits.slice(0, MAX_HITS).forEach(function (it) {
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'r25-ia-hit';
            row.setAttribute('data-ia-hit', it.key);
            row.innerHTML = '<span>' + esc(it.label) + '</span><span class="r25-ia-route">' + esc(it.groupTitle) + ' · ' + esc(it.section) + '</span>';
            row.addEventListener('click', function () {
                const r = jumpTo(it);
                setStatus(r.ok ? '已跳到「' + it.label + '」' : '没找到「' + it.label + '」（可能刚被重渲）');
            });
            resultsBox.appendChild(row);
        });
        if (hits.length > MAX_HITS) {
            const more = doc.createElement('div');
            more.className = 'r25-ia-status';
            more.textContent = '还有 ' + (hits.length - MAX_HITS) + ' 项，继续输入缩小范围';
            resultsBox.appendChild(more);
        }
    }

    /** 搜索：同一个输入框，r22 负责藏 DOM 项，这里负责把命中画成看得见的列表。 */
    function onQuery(query) {
        const result = iaSearch(index, query);
        api.lastSearch = { query: String(query == null ? '' : query), face: result.face, matched: result.matched, hits: result.hits.length };
        renderHits(result);
        setStatus(iaPanelNote(index, result));
        return result;
    }

    function closeSheet() {
        sheet.hidden = true;
        sheet.textContent = '';
    }

    function openSheet(plan) {
        sheet.textContent = '';
        const h4 = doc.createElement('h4');
        h4.textContent = '恢复默认设置';
        const p = doc.createElement('p');
        p.textContent = '会改 ' + plan.changed.length + ' 项，先看清从什么变成什么再点确认' + (plan.skipped.length ? '（' + plan.skipped.length + ' 项读不到，已跳过）' : '');
        sheet.appendChild(h4);
        sheet.appendChild(p);

        plan.items.forEach(function (it) {
            const row = doc.createElement('label');
            const cb = doc.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!it.changed;
            cb.disabled = !it.changed;
            cb.setAttribute('data-ia-reset-id', it.id);
            cb.addEventListener('change', function () { it.checked = cb.checked; });
            it.checked = !!it.changed;
            const text = doc.createElement('span');
            const from = it.fromSet ? String(it.from) : '（没设过）';
            text.innerHTML = esc(it.label) + ' <span class="r25-ia-diff">' + esc(from) + ' → ' + esc(String(it.to)) + '</span>';
            row.appendChild(cb);
            row.appendChild(text);
            sheet.appendChild(row);
        });

        const acts = doc.createElement('div');
        acts.className = 'r25-ia-acts';
        const cancel = doc.createElement('button');
        cancel.type = 'button';
        cancel.className = 'r25-ia-reset';
        cancel.textContent = '取消';
        cancel.addEventListener('click', function () {
            closeSheet();
            setStatus('已取消，没有改任何设置');
        });
        const confirm = doc.createElement('button');
        confirm.type = 'button';
        confirm.className = 'r25-ia-reset';
        confirm.id = 'r25-ia-reset-confirm';
        confirm.textContent = '确认恢复';
        confirm.addEventListener('click', function () { applyReset(plan); });
        acts.appendChild(cancel);
        acts.appendChild(confirm);
        sheet.appendChild(acts);
        sheet.hidden = false;
        api.lastSheet = { items: plan.items.length, changed: plan.changed.length };
    }

    async function applyReset(plan) {
        const picked = plan.items.filter(function (it) { return it.checked === true && it.changed === true; });
        const results = [];
        for (const it of picked) {
            try {
                if (!storage || typeof storage.set !== 'function') throw new Error('no-storage');
                await storage.set(it.storageKey, it.to);
                results.push({ id: it.id, ok: true, key: it.storageKey, value: it.to });
            } catch (err) {
                results.push({ id: it.id, ok: false, key: it.storageKey, error: String((err && err.message) || err) });
            }
        }
        const receipt = iaResetReceipt(results);
        api.lastReceipt = receipt;
        api.appliedAt = Date.now();
        closeSheet();
        setStatus('上次：' + receipt.note);
        if (typeof options.onAfterReset === 'function') {
            try { options.onAfterReset(receipt); } catch (err) { setStatus('上次：' + receipt.note + '（页面刷新失败：' + String((err && err.message) || err) + '）'); }
        }
        return receipt;
    }

    resetBtn.addEventListener('click', function () {
        let plan;
        try {
            plan = iaResetPlan(IA_RESET_ENTRIES, function (key) { return storage && typeof storage.get === 'function' ? storage.get(key) : null; }, { kind: 'all' });
        } catch (err) {
            setStatus('读不到当前值（未知），没敢动');
            return;
        }
        api.lastPlan = { face: plan.face, changed: plan.changed.length, skipped: plan.skipped.length };
        if (plan.face === 'noop') { setStatus(plan.note); return; }
        if (plan.face === 'unknown') { setStatus(plan.note); return; }
        openSheet(plan);
    });

    renderGroups();
    onQuery('');

    const searchInput = doc.getElementById('r22-settings-filter') || host.querySelector('#r22-settings-filter');
    if (searchInput && typeof searchInput.addEventListener === 'function') {
        searchInput.addEventListener('input', function () { onQuery(searchInput.value); });
        searchInput.addEventListener('keydown', function (e) { if (e.key === 'Escape') onQuery(''); });
        if (String(searchInput.value || '').trim()) onQuery(searchInput.value);
    }

    if (options.lastReceipt && typeof options.lastReceipt === 'function') {
        try {
            const prev = options.lastReceipt();
            if (prev && prev.note) setStatus('上次：' + prev.note);
        } catch (err) { /* 读历史回执失败不该拦下面板 */ }
    }

    // 跨 tab 跳转：切 tab 会把整页重渲（面板跟着重建），目标 key 暂存在 jumpSlot 里
    if (jumpSlot.key) {
        const target = index.items.find(function (it) { return it.key === jumpSlot.key; });
        jumpSlot.key = null;
        if (target) {
            const r = jumpTo(target);
            if (r.ok) setStatus('已跳到「' + target.label + '」');
        }
    }

    api.mountPointId = panel.parentNode && panel.parentNode.id ? panel.parentNode.id : '';
    /* 读数上屏：写到真实 DOM 节点的 dataset 上（写 JS 对象是写进虚空 —— R25-O4 踩过）。
     * 空组数单独一个读数：它不是「0 项」的同义词，是「这一组一个可识别设置项都没有」。 */
    if (doc.body && doc.body.dataset) {
        doc.body.dataset.iaItems = String(index.total);
        doc.body.dataset.iaGroups = String(index.groups.length);
        doc.body.dataset.iaEmptyGroups = String(index.absentGroups.length);
    }
    if (typeof window !== 'undefined' && window.VirtualPhone) {
        window.VirtualPhone._r25O5 = { api, index, note: iaPanelNote(index), selfCheck: settingsIaSelfCheck() };
    }
    return { ok: true, api, index };
}
