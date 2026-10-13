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
/* [v3.99.0 · R3-O9] 桌面与返回路径减负：**默认聚焦**与**按卡隐藏**的判定全在
 *   config/desk-focus.js（纯函数）—— 本件只把读数摆出来，不在这里另写一份归类。 */
import { focusOf, restorePlan } from '../../config/desk-focus.js';
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
        /* [v3.99.0 · R3-O9] 按卡隐藏名单与**上一次离开时的快照**（返回路径恢复读数用）。
           两者都是本会话内有效：隐藏是显示意图（不属于任何一条数据），
           快照只用于与「退栈后」比对，不落盘（落盘就把「本次退栈」与「上次会话」混了）。 */
        this._hidden = [];
        this._leftSnapshot = null;
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
        /* [v3.99.0 · R3-O9] 默认聚焦读数（首屏 / 工具区 / 按需隐藏三档分开报）。
           卡表与条件都来自真源：卡表用 TE_CARDS，隐藏名单用本会话的 _hidden。 */
        const focus = focusOf(TE_CARDS, { hidden: this._hidden });
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
            dropped: this._dropped,
            /* [v3.99.0 · R3-O9] 聚焦三档读数（视图据此把首屏与工具区分列；
             *   未收进任何一档的卡在 focus.dropped 里如实报，不静默丢）。 */
            focus: focus
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
    /* ---------- [v3.99.0 · R3-O9] 按卡隐藏与返回路径 ---------- */
    /**
     * 按卡隐藏（**只改显示意图，不删任何数据**）。
     *   隐藏不写 storage、不动 te_pins / te_ledger —— 任务入口的收藏与使用台账**一字不动**
     *   （验收原文「不删数据」的字面落点）；隐藏后该卡仍在卡表里，
     *   搜索与直接打开 App 都不受影响（「隐藏 App 仍能由搜索打开」）。
     * @returns {{ok:boolean, hidden:string[], reason:string}}
     */
    hideCard(id, on) {
        const key = toStr(id);
        if (!key) return { ok: false, hidden: this._hidden.slice(), reason: 'empty-id（没给 id ⇒ 不猜是哪张卡）' };
        const has = this._hidden.indexOf(key) >= 0;
        const want = (on === undefined) ? !has : (on === true);
        if (want && !has) this._hidden = this._hidden.concat([key]);
        else if (!want && has) this._hidden = this._hidden.filter((x) => x !== key);
        this.render();
        return { ok: true, hidden: this._hidden.slice(), reason: '' };
    }
    /** 当前隐藏名单（只读副本；视图与诊断面读它）。 */
    hiddenCards() { return this._hidden.slice(); }
    /**
     * 记录「离开时的界面快照」（原页签 / 查询 / 滚动 / 草稿）。
     *   本件**不做恢复动作**（那由页面栈自己落实，本件不该长出一条第二路由）；
     *   它只负责把快照留住并给出**恢复读数** —— 「恢复了」与「被静默重置」必须可分辨。
     *   四个字段都缺 ⇒ 如实报 absent（未记不是「丢了」）。
     */
    markLeft(snap) {
        const s = (snap && typeof snap === 'object') ? snap : null;
        this._leftSnapshot = s ? {
            tab: s.tab, query: s.query, scroll: s.scroll, draft: s.draft
        } : null;
        return this._leftSnapshot;
    }
    /** 返回路径恢复读数（拿「离开时」与「现在」比；本件不替页面栈做恢复）。 */
    restoreReading(now) {
        return restorePlan(this._leftSnapshot, now);
    }
    onChatChanged() { this.render(); }
    destroy() { this._view = null; }
}