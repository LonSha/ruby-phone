/* ========================================================
 * taskentry-app.js — [v3.65.0 · 拓展计划 X1 第一切片] 任务入口 · 落盘与接线
 * 两条会话键走 ^te_ 前缀随会话隔离：te_pins 收藏 / te_ledger 台账。
 * 判定与投影全在 config/task-entry.js（纯函数），本件只做「读 → 判 → 落 → 渲染」。
 * ======================================================== */
'use strict';
import {
    TE_CARDS, TE_CAPS, TE_PINS_KEY, TE_LEDGER_KEY, TE_LEDGER_MAX,
    availableCards, pinnedCards, recentFromUsage, entryReadings, filterCards, capabilityOf,
    tabState, isRouted, toStr, listOf, dispatchOpen,
    readPins, writePins, togglePin, readLedger, writeLedger,
    taskEntrySelfCheck, TE_TABMAP
} from '../../config/task-entry.js';
/* ★ 真浏览器逐开 82 入口实测抓到的真缺陷：这三个名字原本从 `config/task-entry.js` 导入，
 *   而它们从来就不在那里（定义在 `config/tab-source.js`）⇒ 模块整体加载失败，
 *   任务入口入口点开后永远是空白。修法：改指真源（不在 task-entry 里转手一份——那会造出第二份声明）。 */
import { hasTabSource, tabSourceReadings, TAB_SOURCE_NOTE } from '../../config/tab-source.js';
import { readUsage } from '../../config/usage-tracker.js';
import { TaskentryView } from './taskentry-view.js';
export { TE_PINS_KEY, TE_LEDGER_KEY };
export class TaskentryApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._cap = 'usable';
        /* 两个**案例读数**（不是缓存真源）：它们只在 render 时现取。
         *   持有它们只为让 _vm 不必二次读盘，也让「读不出」这个事实能被视图说清。 */
        this._pinState = '';
        this._recentState = '';
        this._dropped = 0;
    }
    _nowMs() {
        if (this.shell && typeof this.shell.now === 'function') {
            try { const n = this.shell.now(); if (Number.isFinite(n)) return n; } catch (_e) { /* 下取 Date.now */ }
        }
        return Date.now();
    }
    /* 台账：走 config/task-entry.js 的唯一写门；裁剪口径与其它案头一致（带上限 + dropped 计数）。 */
    _log(action, detail) {
        const cur = readLedger(this.storage);
        const rows = listOf(cur.rows);
        const next = [{ at: this._nowMs(), action: toStr(action), detail: toStr(detail) }].concat(rows);
        const trimmed = next.slice(0, TE_LEDGER_MAX);
        this._dropped += Math.max(0, next.length - trimmed.length);
        writeLedger(this.storage, trimmed);
    }
    /* ---------- 视图交互（视图只调这几个口） ---------- */
    cap() { return this._cap; }
    setCap(c) {
        const k = toStr(c);
        this._cap = TE_CAPS.indexOf(k) >= 0 ? k : 'usable';
        this.render();
        return this._cap;
    }
    /** 打开一条靶心：**只派发**，不改任何本地状态（导航是旁路，不该写台账之外的副作用）。 */
    openTarget(appId, tab) {
        const id = toStr(appId);
        if (!id) return { sent: false, why: 'bad-app-id' };
        const t = toStr(tab) || null;
        /* 只认**本仓有路由**的 appId：派发一个不存在的 App 只会静默什么都不发生，
         *   用户看到的「点了没反应」正是本仓最贵的形态，故这里先拦。 */
        if (!isRouted(id)) {
            this._log('open_refused', 'app=' + id + ' why=app-not-routed');
            this.render();
            return { sent: false, why: 'app-not-routed' };
        }
        /* 有页签声明时先核靶心：声明的页签在白名单里才派发。
         *   这里**不拦** `unknown`（页签真源没登记这个 App）——真源覆盖面是逐步长的，
         *   拦掉 unknown 会把「还没核对过的 App」变成打不开的 App（把欠债升级成故障）。
         *   但要**如实记账**，让欠债可见。 */
        let tabNote = '';
        if (t) {
            const ts = tabState(id, t);
            if (ts.state === 'unsupported') {
                this._log('open_refused', 'app=' + id + ' tab=' + t + ' why=tab-unsupported');
                this.render();
                return { sent: false, why: 'tab-unsupported' };
            }
            if (ts.state === 'unknown') tabNote = ' tab-unverified';
        }
        const res = dispatchOpen(id, t);
        if (!res.sent) {
            this._log('open_refused', 'app=' + id + (t ? ' tab=' + t : '') + ' why=' + res.why);
            this.render();
            return { sent: false, why: res.why };
        }
        this._log('open', 'app=' + id + (t ? ' tab=' + t : '') + tabNote);
        this.render();
        return { sent: true, why: '' };
    }
    /** 收藏 / 取消收藏（幂等）。上限满了如实说，不静默丢。 */
    toggleCard(cardId) {
        const id = toStr(cardId);
        const cur = readPins(this.storage);
        const r = togglePin(cur.pins, id, null);
        if (r.full) {
            this._log('pin_refused', 'card=' + id + ' why=too-many-pins');
            this.render();
            return { ok: false, changed: '', why: 'too-many-pins' };
        }
        const w = writePins(this.storage, r.pins);
        this._log(r.changed === 'added' ? 'pin' : 'unpin', 'card=' + id + ' saved=' + String(w.saved === true));
        this.render();
        return { ok: true, changed: r.changed, why: '' };
    }
    /* ---------- 读数与渲染 ---------- */
    readings() {
        const pinsRaw = readPins(this.storage);
        const usage = readUsage(this.storage);
        this._pinState = pinsRaw.state;
        return { pinsRaw: pinsRaw, usage: usage };
    }
    render() {
        const r = this.readings();
        if (!this._view) this._view = new TaskentryView(this);
        this._view.render(this._vm(r));
    }
    _vm(r) {
        const pinsRaw = r.pinsRaw;
        const rowsAll = availableCards(TE_CARDS, {});
        const rowsList = filterCards(rowsAll, this._cap).map((row) => Object.assign({}, row, { capability: capabilityOf(row) }));
        const pinCards = pinnedCards(pinsRaw, TE_CARDS, {});
        const rec = recentFromUsage(r.usage, 6);
        this._recentState = rec.state;
        const ledger = readLedger(this.storage);
        const pinIds = listOf(pinCards.items).map((x) => x.appId);
        /* 页签真源的覆盖读数（给用户看「这张表现在管到哪些 App」；
         *   与卡表读数分列 —— 前者是声明面的宽度，后者是靶心的可达性，两件不同的事）。 */
        const tsRead = tabSourceReadings();
        const sc = this.selfCheck();
        return {
            cap: this._cap,
            rows: rowsList,
            readings: entryReadings(TE_CARDS, pinsRaw.pins, r.usage, {}),
            tabSource: { apps: tsRead.apps, tabs: tsRead.tabs, byShape: tsRead.byShape, note: TAB_SOURCE_NOTE },
            selfCheck: sc,
            pinState: pinsRaw.state,
            pinIds: pinIds,
            pinned: pinCards.items,
            pinOrphans: pinCards.orphans,
            recent: listOf(rec.items).filter((x) => x.routed).map((x) => ({ appId: x.appId, count: x.count, routed: true })),
            recentStale: listOf(rec.items).filter((x) => !x.routed),
            recentState: rec.state,
            ledger: listOf(ledger.rows),
            dropped: this._dropped
        };
    }
    /* ---------- 页签真源的可视面（本 App 是**唯一**把真源读数摆给用户看的地方） ---------- */
    /** 这个 App 的页签有没有被真源登记过：「未登记」与「不支持」是两件不同的事。 */
    tabSourceOf(appId) {
        const id = toStr(appId);
        if (!id) return { known: false, tabs: [], note: TAB_SOURCE_NOTE };
        return { known: hasTabSource(id), tabs: hasTabSource(id) ? listOf(TE_TABMAP[id]) : [], note: TAB_SOURCE_NOTE };
    }
    /** 自检读数（页签真源结构 + 卡表结构 + 词表），由视图头部如实展示。 */
    selfCheck() {
        const r = taskEntrySelfCheck();
        return { problems: listOf(r.problems), cards: r.cards, caps: r.caps };
    }
    onChatChanged() { this.render(); }
    destroy() { this._view = null; }
}