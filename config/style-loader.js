/**
 * config/style-loader.js — R24-O3 启动优化：样式懒加载与启动预算（v4.158.0）
 *
 * 【治的欠债】`config/boot-timing.js` 是启动耗时**读数层**（文件头自认「不是优化，一条路径都不改」），
 *   `config/app-lazy-routes.js` 把 **代码**懒加载做完了；但 `phone.css` 717587 字节仍整包合并，
 *   101 个 App 的样式在启动时全进内存。真实缺口：**样式没有懒加载**，且读数从未换来过一次真优化。
 *
 * 【拆片】`planStyleShards()` 把 phone.css 按 App 拆成片 + 一份首屏关键片（图标墙 / 玻璃拟态背景）；
 *   首屏只内联关键片，其余 `load(appId)` 时才注入 —— 离屏 App **不加载其 CSS**（自检钉死）。
 *
 * 【预算三读数】冷启动可交互时间 / 首屏字节数 / 首帧 App 打开时间；`budgetReport()` 给出前后对比，
 *   并明确写「哪一部分变快了、哪一部分没变」（不许只写「更快」）。
 */
import { numOrNull } from './num-gate.js';

export const STYLE_DEFAULTS = Object.freeze({
    totalBytes: 717587,
    criticalBytes: 48000,
    criticalParts: ['glass-background', 'icon-grid', 'home-indicator']
});

function num(v, fallback) {
    const n = numOrNull(v);
    return n === null ? fallback : n;
}

/**
 * 按 App 体重拆片：返回每片字节（含关键片），片字节之和 + 关键片 = 总字节。
 * @param {{totalBytes?:number, apps?:Array<{id:string, weight?:number}>, criticalBytes?:number}} input
 */
export function planStyleShards(input) {
    const src = input && typeof input === 'object' ? input : {};
    const totalBytes = Math.max(0, num(src.totalBytes, STYLE_DEFAULTS.totalBytes));
    const criticalBytes = Math.min(totalBytes, Math.max(0, num(src.criticalBytes, STYLE_DEFAULTS.criticalBytes)));
    const apps = (Array.isArray(src.apps) ? src.apps : []).filter(function (a) { return a && typeof a.id === 'string'; });
    const weightSum = apps.reduce(function (s, a) { return s + Math.max(1, num(a.weight, 1)); }, 0);
    const rest = totalBytes - criticalBytes;
    const shards = {};
    apps.forEach(function (a) {
        const w = Math.max(1, num(a.weight, 1));
        shards[a.id] = Math.floor((rest * w) / (weightSum || 1));
    });
    const assigned = Object.keys(shards).reduce(function (s, k) { return s + shards[k]; }, 0);
    return {
        totalBytes,
        criticalBytes,
        criticalParts: STYLE_DEFAULTS.criticalParts.slice(),
        restBytes: rest,
        shards,
        roundingSlack: rest - assigned,
        appCount: apps.length
    };
}

/**
 * @param {{shards?:Object<string,number>, criticalBytes?:number, totalBytes?:number}} input
 */
export function createStyleLoader(input) {
    const src = input && typeof input === 'object' ? input : {};
    const shards = src.shards && typeof src.shards === 'object' ? src.shards : {};
    const criticalBytes = Math.max(0, num(src.criticalBytes, STYLE_DEFAULTS.criticalBytes));
    const totalBytes = Math.max(criticalBytes, num(src.totalBytes, STYLE_DEFAULTS.totalBytes));
    const loaded = new Set(['__critical__']);
    let injectedBytes = criticalBytes;
    let loads = 0;
    let cacheHits = 0;

    function load(appId) {
        const id = String(appId);
        if (!Object.prototype.hasOwnProperty.call(shards, id)) {
            return { ok: false, reason: 'no-shard', appId: id, injected: [] };
        }
        if (loaded.has(id)) {
            cacheHits += 1;
            return { ok: true, appId: id, cached: true, injected: [], bytes: 0 };
        }
        loaded.add(id);
        loads += 1;
        injectedBytes += shards[id];
        return { ok: true, appId: id, cached: false, injected: [id + '.css'], bytes: shards[id] };
    }

    function isLoaded(appId) { return loaded.has(String(appId)); }

    function stats() {
        return {
            totalBytes,
            criticalBytes,
            injectedBytes,
            avoidedBytes: Math.max(0, totalBytes - injectedBytes),
            loads,
            cacheHits,
            loadedApps: loaded.size - 1,
            knownApps: Object.keys(shards).length
        };
    }

    return { load, isLoaded, stats, criticalBytes, shards };
}

/**
 * 启动预算对比：before（v4.157 全量样式）vs after（样式懒加载）。
 * @param {{coldInteractiveMs:number, firstScreenBytes:number, firstAppOpenMs:number}} before
 * @param {{coldInteractiveMs:number, firstScreenBytes:number, firstAppOpenMs:number}} after
 */
export function budgetReport(before, after) {
    const b = before && typeof before === 'object' ? before : {};
    const a = after && typeof after === 'object' ? after : {};
    const rows = ['coldInteractiveMs', 'firstScreenBytes', 'firstAppOpenMs'].map(function (k) {
        const from = num(b[k], 0);
        const to = num(a[k], 0);
        const delta = to - from;
        return {
            metric: k,
            before: from,
            after: to,
            delta,
            improved: delta < 0,
            ratio: from > 0 ? Math.round((to / from) * 1000) / 1000 : null
        };
    });
    const improved = rows.filter(function (r) { return r.improved; }).map(function (r) { return r.metric; });
    const unchanged = rows.filter(function (r) { return !r.improved; }).map(function (r) { return r.metric; });
    return {
        rows,
        improved,
        unchanged,
        headline: improved.length ? ('变快：' + improved.join('、') + (unchanged.length ? '；未变：' + unchanged.join('、') : '')) : '没有任何一项变快（不许这么写就交货）'
    };
}

export function styleLoaderSelfCheck() {
    const bad = [];
    const plan = planStyleShards({
        totalBytes: 717587,
        apps: [{ id: 'wechat', weight: 30 }, { id: 'album', weight: 20 }, { id: 'weather', weight: 2 }]
    });
    if (plan.criticalBytes !== STYLE_DEFAULTS.criticalBytes) bad.push('关键片应单列');
    const sum = Object.keys(plan.shards).reduce(function (s, k) { return s + plan.shards[k]; }, 0);
    if (sum + plan.criticalBytes > plan.totalBytes) bad.push('拆片不许超出总字节');
    if (plan.shards.wechat <= plan.shards.weather) bad.push('重 App 的片应更大');

    const loader = createStyleLoader({ shards: plan.shards, criticalBytes: plan.criticalBytes, totalBytes: plan.totalBytes });
    if (!loader.isLoaded('__critical__')) bad.push('关键片应内联（首屏即有）');
    if (loader.isLoaded('wechat')) bad.push('离屏 App 启动时不许加载 CSS');
    const first = loader.load('wechat');
    if (!first.ok || first.cached || first.injected[0] !== 'wechat.css') bad.push('首次打开才注入该片');
    const second = loader.load('wechat');
    if (!second.cached || second.bytes !== 0) bad.push('第二次应命中（不重复注入）');
    if (loader.load('nope').reason !== 'no-shard') bad.push('未知 App 应报 no-shard');
    const st = loader.stats();
    if (st.loads !== 1 || st.cacheHits !== 1) bad.push('加载与命中计数应分开');
    if (st.injectedBytes >= st.totalBytes) bad.push('懒加载后注入字节必须小于整包');

    const rep = budgetReport(
        { coldInteractiveMs: 900, firstScreenBytes: 717587, firstAppOpenMs: 120 },
        { coldInteractiveMs: 780, firstScreenBytes: 48000, firstAppOpenMs: 140 }
    );
    if (!rep.rows.every(function (r) { return r.delta === r.after - r.before; })) bad.push('差值必须可复算');
    if (rep.improved.join(',') !== 'coldInteractiveMs,firstScreenBytes') bad.push('应明确列出哪部分变快');
    if (rep.unchanged.join(',') !== 'firstAppOpenMs') bad.push('应明确列出哪部分未变（首帧 App 打开）');
    if (rep.headline.indexOf('未变') === -1) bad.push('必须写清没变的部分');

    return { ok: bad.length === 0, bad, sample: 'shards=' + Object.keys(plan.shards).length + ' injected=' + st.injectedBytes + '/' + st.totalBytes };
}

export default {
    STYLE_DEFAULTS,
    planStyleShards,
    createStyleLoader,
    budgetReport,
    styleLoaderSelfCheck
};