/**
 * config/app-lifecycle.js — R24-X8 多任务与后台：状态保留与回收（v4.158.0）
 *
 * 【治的欠债】有返回栈、有 `releasePhoneInactiveResources`、有会话级回收，
 *   但**没有「后台 App 保留多久、恢复时状态还在不在」的语义** ——
 *   切走再切回，有的 App 状态还在、有的重置了，这不是设计，是各处实现差异。
 *
 * 【四态】`foreground` / `background`（状态保留）/ `suspended`（状态丢弃、可重建）/ `closed`。
 *   每个 App 声明自己能不能被 `suspended`（重建成本低）还是必须 `background`（有未保存草稿）。
 *
 * 【回收顺序】内存压力下先 `suspended` 后 `background`；
 *   **有未保存草稿的永不自动回收**（自检用负控制钉死）。
 *
 * 【恢复语义】`background` 恢复必须逐字段一致（scrollTop / draft / cursor / expanded）；
 *   `suspended` 恢复回首页并明说「已重置」（不许静默清空）。
 */
import { numOrNull } from './num-gate.js';

export const LIFECYCLE_STATES = Object.freeze({
    foreground: '前台',
    background: '后台（保留状态）',
    suspended: '挂起（丢弃状态，可重建）',
    closed: '已关闭'
});

export const RETENTION_POLICIES = Object.freeze({
    background: '必须保状态（有未保存草稿）',
    suspendable: '可挂起（重建成本低）'
});

export const RESTORE_FACES = Object.freeze({
    exact: '逐字段一致',
    reset: '已重置（回首页）',
    cold: '冷启动'
});

function num(v, fallback) {
    const n = numOrNull(v);
    return n === null ? fallback : n;
}

/**
 * @param {{apps?:Array<{id:string, policy?:string, initial?:object}>}} input
 */
export function createLifecycleManager(input) {
    const src = input && typeof input === 'object' ? input : {};
    const entries = new Map();
    const events = [];

    (Array.isArray(src.apps) ? src.apps : []).forEach(function (a) {
        if (!a || typeof a.id !== 'string') return;
        const policy = a.policy === 'background' ? 'background' : 'suspendable';
        entries.set(a.id, {
            id: a.id,
            policy,
            state: 'closed',
            snapshot: a.initial && typeof a.initial === 'object' ? Object.assign({}, a.initial) : null
        });
    });

    function get(appId) {
        const e = entries.get(String(appId));
        return e ? { id: e.id, policy: e.policy, state: e.state, hasSnapshot: e.snapshot !== null } : null;
    }

    /** 切换前台：上一个前台 App 按策略进 background 或 suspended。 */
    function switchTo(appId) {
        const next = entries.get(String(appId));
        if (!next) return { ok: false, reason: 'unknown-app' };
        let previous = null;
        entries.forEach(function (e) {
            if (e.state === 'foreground' && e.id !== next.id) {
                e.state = e.policy === 'background' ? 'background' : 'suspended';
                if (e.state === 'suspended') e.snapshot = null;
                previous = { id: e.id, state: e.state };
            }
        });
        next.state = 'foreground';
        events.push({ action: 'switch', to: next.id, previous });
        return { ok: true, appId: next.id, previous };
    }

    /** 保存草稿（存在即意味着「不可自动回收」）。 */
    function saveDraft(appId, draft) {
        const e = entries.get(String(appId));
        if (!e) return { ok: false, reason: 'unknown-app' };
        e.snapshot = Object.assign({}, e.snapshot || {}, { draft: draft && typeof draft === 'object' ? draft : {} });
        return { ok: true, appId: e.id, hasDraft: true };
    }

    function hasUnsavedDraft(e) {
        return !!(e && e.snapshot && e.snapshot.draft && typeof e.snapshot.draft === 'object'
            && (String(e.snapshot.draft.text || '') !== '' || num(e.snapshot.draft.cursor, 0) > 0));
    }

    /** 内存压力回收：先 suspended 后 background，有未保存草稿的一律跳过。 */
    function recycleUnderPressure() {
        const recycled = [];
        const protectedApps = [];
        const order = ['suspended', 'background'];
        order.forEach(function (state) {
            entries.forEach(function (e) {
                if (e.state !== state) return;
                if (hasUnsavedDraft(e)) { protectedApps.push(e.id); return; }
                e.state = 'closed';
                e.snapshot = null;
                recycled.push({ id: e.id, from: state });
            });
        });
        events.push({ action: 'recycle', recycled: recycled.length });
        return { ok: true, recycled, protected: protectedApps };
    }

    /** 恢复：background 逐字段一致；suspended 回首页并报「已重置」。 */
    function restore(appId) {
        const e = entries.get(String(appId));
        if (!e) return { ok: false, reason: 'unknown-app' };
        if (e.state === 'background') {
            return { ok: true, appId: e.id, face: 'exact', snapshot: Object.assign({}, e.snapshot || {}) };
        }
        if (e.state === 'suspended' || e.state === 'closed') {
            const was = e.state;
            e.state = 'foreground';
            return { ok: true, appId: e.id, face: 'reset', snapshot: null, notice: '已重置（回首页）', from: was };
        }
        return { ok: true, appId: e.id, face: 'exact', snapshot: Object.assign({}, e.snapshot || {}) };
    }

    function snapshotOf(appId) {
        const e = entries.get(String(appId));
        return e ? { state: e.state, snapshot: e.snapshot ? Object.assign({}, e.snapshot) : null } : null;
    }

    function stats() {
        const byState = { foreground: 0, background: 0, suspended: 0, closed: 0 };
        entries.forEach(function (e) { byState[e.state] += 1; });
        return { apps: entries.size, byState, events: events.length };
    }

    return { switchTo, saveDraft, recycleUnderPressure, restore, snapshotOf, get, stats };
}

export function appLifecycleSelfCheck() {
    const bad = [];
    const mgr = createLifecycleManager({
        apps: [
            { id: 'wechat', policy: 'background', initial: { scrollTop: 420, cursor: 3, expanded: ['c1'] } },
            { id: 'album', policy: 'suspendable', initial: { page: 'grid' } },
            { id: 'music', policy: 'suspendable', initial: { tab: 'now' } }
        ]
    });

    mgr.switchTo('wechat');
    mgr.saveDraft('wechat', { text: '打一半', cursor: 6 });
    mgr.switchTo('album');
    if (mgr.get('wechat').state !== 'background') bad.push('有草稿的 App 退到 background');

    const back = mgr.restore('wechat');
    if (back.face !== 'exact') bad.push('background 恢复应逐字段一致');
    if (back.snapshot.scrollTop !== 420 || back.snapshot.cursor !== 3 || !back.snapshot.expanded) bad.push('恢复的字段不许丢');
    if (back.snapshot.draft.text !== '打一半' || back.snapshot.draft.cursor !== 6) bad.push('草稿与光标必须一致');

    mgr.switchTo('album');
    mgr.switchTo('wechat');
    if (mgr.get('album').state !== 'suspended') bad.push('无草稿 App 应可挂起');
    const reset = mgr.restore('album');
    if (reset.face !== 'reset' || reset.notice.indexOf('已重置') === -1) bad.push('suspended 恢复应明说已重置');
    if (reset.snapshot !== null) bad.push('suspended 恢复不该带回旧状态');

    // 回收：wechat 在 background 且**有未保存草稿** ⇒ 必须被保护；
    // album 在 suspended 且草稿为空 ⇒ 可回收；music 在 foreground ⇒ 不在回收范围。
    mgr.switchTo('album');
    mgr.saveDraft('album', { text: '', cursor: 0 });
    mgr.switchTo('music');
    const before = mgr.get('wechat').state;
    const rec = mgr.recycleUnderPressure();
    if (rec.recycled.length !== 1 || rec.recycled[0].id !== 'album') bad.push('回收顺序：先挂起后后台');
    if (mgr.get('wechat').state !== before) bad.push('有未保存草稿的 App 不许被自动回收');
    if (rec.protected.indexOf('wechat') === -1) bad.push('被保护的 App 应如实登记');
    if (mgr.get('music').state !== 'foreground') bad.push('前台 App 不在回收范围');

    if (mgr.switchTo('nope').ok) bad.push('未知 App 应拒');
    if (LIFECYCLE_STATES.suspended === undefined) bad.push('四态应登记');

    return { ok: bad.length === 0, bad, sample: 'apps=' + mgr.stats().apps + ' recycled=' + rec.recycled.length };
}

export default {
    LIFECYCLE_STATES,
    RETENTION_POLICIES,
    RESTORE_FACES,
    createLifecycleManager,
    appLifecycleSelfCheck
};