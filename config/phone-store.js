/**
 * config/phone-store.js — R24-O1 持久层 v3：每 App 声明、配额与越权写拦截（v4.158.0）
 *
 * 【与 storage.js 的分工】`config/storage.js`（1748 行）提供**键前缀 + 会话隔离 + 全局**
 *   `STORAGE_SCHEMA_VERSION = 2`（一个版本号管全部）。本模块在其上补「**每 App 一份声明**」：
 *   `{ version, defaults, migrate(from,to,data) }`，并给配额与人话提示。
 *   不替换 storage.js，不自己碰宿主 API —— 通过注入的 `storage` 适配器（get/set/keys）读写。
 *
 * 【三态不塌】读结果 face 五态，各自处置相反，禁止压成一句「无」：
 *   `current`   版本一致
 *   `migrated`  旧版经迁移链升到当前版（`steps` 逐跳可查）
 *   `fresh`     旧键不存在 ⇒ 取声明默认值（**不是迁移成功**，不许记成 migrated）
 *   `corrupt`   读到但解析失败 / 迁移抛错 / 迁移产出不是对象 ⇒ **保留原值不覆盖**
 *   `undeclared` App 没声明 ⇒ 读写都不许发生（fail-closed）
 *   `future`     盘上版本高于本仓 ⇒ 拒绝降级（不静默丢字段）
 *
 * 【写拦截】越配额返回 `over-quota` + 三个读数（当前/本条/写入后），不是静默失败；
 *   corrupt 的数据**不许**被一次 write 顺手覆盖（那会把「可救」变成「永久丢」）。
 *
 * 【孤儿键】只登记不自动删（删除权在 O7 体检面）。
 */
import { numOrNull } from './num-gate.js';

export const STORE_FACES = Object.freeze({
    current: '版本一致',
    migrated: '已迁移',
    fresh: '新装（无旧键）',
    corrupt: '解析或迁移失败',
    undeclared: '未声明',
    future: '盘上版本更新'
});

export const STORE_ERRORS = Object.freeze({
    'no-declaration': 'App 未声明，读写均拒判',
    'over-quota': '超出配额，写入被拒',
    'migration-failed': '迁移抛错，原值保留',
    'bad-patch': 'patch 不是对象',
    'newer-version': '盘上版本高于本仓，拒绝降级',
    corrupt: '当前数据已损坏，需先体检'
});

const KEY_PREFIX = 'phone.app.';
const DEFAULT_QUOTA_BYTES = 512 * 1024;
const NEAR_RATIO = 0.8;

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
    if (v === null || v === undefined) return v;
    return JSON.parse(JSON.stringify(v));
}

function byteLength(text) {
    const s = String(text === null || text === undefined ? '' : text);
    let n = 0;
    for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
        else n += 3;
    }
    return n;
}

/**
 * @param {{storage?:{get:Function,set:Function,keys:Function}, quotaBytes?:number}} options
 */
export function createAppStore(options) {
    const o = options && typeof options === 'object' ? options : {};
    const storage = o.storage && typeof o.storage.get === 'function' && typeof o.storage.set === 'function'
        ? o.storage
        : { get: function () { return null; }, set: function () {}, keys: function () { return []; } };
    const wanted = numOrNull(o.quotaBytes);
    const quotaBytes = wanted !== null && wanted > 0 ? Math.floor(wanted) : DEFAULT_QUOTA_BYTES;
    const declarations = new Map();

    function declare(appId, spec) {
        if (typeof appId !== 'string' || appId.trim() === '') return { ok: false, bad: ['no-app-id'] };
        const s = spec && typeof spec === 'object' ? spec : {};
        const bad = [];
        const version = numOrNull(s.version);
        if (version === null || version < 1) bad.push('bad-version');
        if (s.defaults !== undefined && !isPlainObject(s.defaults)) bad.push('bad-defaults');
        if (s.migrate !== undefined && typeof s.migrate !== 'function') bad.push('bad-migrate');
        if (version !== null && version > 1 && typeof s.migrate !== 'function') bad.push('migrate-required');
        if (bad.length) return { ok: false, bad };
        declarations.set(appId, {
            version: Math.floor(version),
            defaults: clone(s.defaults || {}),
            migrate: typeof s.migrate === 'function' ? s.migrate : null
        });
        return { ok: true, bad: [], appId, version: Math.floor(version) };
    }

    function keyOf(appId) {
        return KEY_PREFIX + String(appId);
    }

    function read(appId) {
        const decl = declarations.get(appId);
        if (!decl) return { face: 'undeclared', reason: 'no-declaration', data: null, version: null };
        const raw = storage.get(keyOf(appId));
        if (raw === null || raw === undefined || raw === '') {
            return { face: 'fresh', reason: 'no-key', data: clone(decl.defaults), version: decl.version, steps: [] };
        }
        let obj;
        try {
            obj = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
        } catch (e) {
            return { face: 'corrupt', reason: 'bad-json', data: null, version: null, raw, error: String((e && e.message) || e) };
        }
        if (!isPlainObject(obj)) return { face: 'corrupt', reason: 'bad-shape', data: null, version: null, raw };
        const recorded = numOrNull(obj.__v);
        let from = recorded === null ? 0 : recorded;
        if (from > decl.version) return { face: 'future', reason: 'newer-version', data: clone(obj.data || {}), version: from, diskVersion: from };
        let data = isPlainObject(obj.data) ? clone(obj.data) : clone(decl.defaults);
        const steps = [];
        while (from < decl.version) {
            const to = from + 1;
            if (!decl.migrate) return { face: 'corrupt', reason: 'migration-failed', data: null, version: from, raw, error: 'no-migrate' };
            let next;
            try {
                next = decl.migrate(from, to, clone(data));
            } catch (e) {
                return { face: 'corrupt', reason: 'migration-failed', data: null, version: from, failedStep: [from, to], raw, error: String((e && e.message) || e) };
            }
            if (!isPlainObject(next)) {
                return { face: 'corrupt', reason: 'migration-produced-nothing', data: null, version: from, failedStep: [from, to], raw };
            }
            data = next;
            steps.push(from + '->' + to);
            from = to;
        }
        return {
            face: steps.length ? 'migrated' : 'current',
            reason: steps.length ? 'version-bumped' : 'in-sync',
            data,
            version: from,
            steps,
            bytes: byteLength(raw)
        };
    }

    function totalBytes() {
        let total = 0;
        const perApp = {};
        declarations.forEach(function (_decl, appId) {
            const raw = storage.get(keyOf(appId));
            const size = raw === null || raw === undefined ? 0 : byteLength(raw);
            perApp[appId] = size;
            total += size;
        });
        return { total, perApp };
    }

    function write(appId, patch) {
        const decl = declarations.get(appId);
        if (!decl) return { ok: false, reason: 'no-declaration' };
        if (!isPlainObject(patch)) return { ok: false, reason: 'bad-patch' };
        const cur = read(appId);
        if (cur.face === 'corrupt') return { ok: false, reason: 'corrupt', detail: cur.reason };
        if (cur.face === 'future') return { ok: false, reason: 'newer-version' };
        const merged = Object.assign({}, cur.data || {});
        Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        const record = { __v: decl.version, data: merged };
        const text = JSON.stringify(record);
        const size = byteLength(text);
        const before = byteLength(JSON.stringify({ __v: decl.version, data: cur.data || {} }));
        const totals = totalBytes();
        const wouldBe = totals.total - totals.perApp[appId] + size;
        if (wouldBe > quotaBytes) {
            return { ok: false, reason: 'over-quota', limit: quotaBytes, appBytes: size, totalBytes: totals.total, wouldBe };
        }
        storage.set(keyOf(appId), text);
        return { ok: true, face: 'current', appBytes: size, totalBytes: wouldBe, quotaLimit: quotaBytes };
    }

    function quota() {
        const totals = totalBytes();
        const ratio = quotaBytes > 0 ? totals.total / quotaBytes : 1;
        return {
            limit: quotaBytes,
            totalBytes: totals.total,
            perApp: totals.perApp,
            ratio: Math.round(ratio * 1000) / 1000,
            face: totals.total > quotaBytes ? 'over' : (ratio >= NEAR_RATIO ? 'near' : 'ok'),
            note: totals.total > quotaBytes
                ? '会话数据已超出上限，新的写入会被拒绝（不会静默丢）'
                : (ratio >= NEAR_RATIO ? '会话数据接近上限，建议清理大 App' : '会话数据在预算内')
        };
    }

    function orphanKeys() {
        const keys = typeof storage.keys === 'function' ? storage.keys() : [];
        const roots = [];
        for (let i = 0; i < keys.length; i += 1) {
            const k = keys[i];
            if (typeof k !== 'string' || k.indexOf(KEY_PREFIX) !== 0) continue;
            const appId = k.slice(KEY_PREFIX.length);
            if (!declarations.has(appId)) roots.push(appId);
        }
        return { count: roots.length, appIds: roots, autoDeleted: 0 };
    }

    function describe() {
        const apps = [];
        declarations.forEach(function (decl, appId) { apps.push({ appId, version: decl.version }); });
        const q = quota();
        return { appCount: apps.length, apps, quota: q, keyPrefix: KEY_PREFIX };
    }

    return { declare, read, write, quota, orphanKeys, describe, keyOf };
}

export function phoneStoreSelfCheck() {
    const bad = [];
    const mem = {};
    const storage = {
        get: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        set: function (k, v) { mem[k] = String(v); },
        keys: function () { return Object.keys(mem); }
    };
    const store = createAppStore({ storage, quotaBytes: 2048 });

    if (!store.declare('wechat', { version: 2, defaults: { msgs: 0 }, migrate: function (from, to, d) { const n = Object.assign({}, d); if (to === 2) n.draft = ''; return n; } }).ok) bad.push('声明 v2 应成功');
    if (store.declare('x', { version: 2, defaults: {} }).ok) bad.push('v2 缺 migrate 应拒收');
    if (store.declare('', { version: 1 }).ok) bad.push('空 appId 应拒收');

    const fresh = store.read('wechat');
    if (fresh.face !== 'fresh' || fresh.data.msgs !== 0) bad.push('无旧键应 fresh 且带默认值');
    if (store.read('nobody').face !== 'undeclared') bad.push('未声明应 undeclared');

    if (!store.write('wechat', { msgs: 3 }).ok) bad.push('正常写应成功');
    const cur = store.read('wechat');
    if (cur.face !== 'current' || cur.data.msgs !== 3) bad.push('写入后应 current');

    mem['phone.app.wechat'] = '{"__v":1,"data":{"msgs":5}}';
    const mig = store.read('wechat');
    if (mig.face !== 'migrated' || mig.data.draft !== '' || mig.steps[0] !== '1->2') bad.push('旧版应 migrated 且逐跳可查');
    if (mig.data.msgs !== 5) bad.push('迁移不许丢旧字段');

    const corruptRaw = '{"__v":2,"data":';
    mem['phone.app.wechat'] = corruptRaw;
    const corrupt = store.read('wechat');
    if (corrupt.face !== 'corrupt' || corrupt.reason !== 'bad-json') bad.push('坏 JSON 应 corrupt/bad-json');
    if (mem['phone.app.wechat'] !== corruptRaw) bad.push('corrupt 时原值必须留在盘上');
    const blocked = store.write('wechat', { msgs: 9 });
    if (blocked.ok || blocked.reason !== 'corrupt') bad.push('corrupt 时写应被拒（不许顺手覆盖）');
    if (mem['phone.app.wechat'] !== corruptRaw) bad.push('被拒的写不许改盘');

    mem['phone.app.wechat'] = '{"__v":9,"data":{"msgs":1}}';
    if (store.read('wechat').face !== 'future') bad.push('盘上版本更高应 future');
    if (store.write('wechat', { msgs: 2 }).reason !== 'newer-version') bad.push('future 时写应拒降级');

    store.declare('album', { version: 1, defaults: { photos: [] } });
    mem['phone.app.wechat'] = '{"__v":2,"data":{"msgs":3,"draft":""}}';
    const big = 'x'.repeat(4000);
    const over = store.write('album', { photos: [big] });
    if (over.ok || over.reason !== 'over-quota') bad.push('超配额应拒写并给原因');
    if (over.limit !== 2048 || over.wouldBe <= 2048) bad.push('配额读数应可复算');
    const q = store.quota();
    if (q.face !== 'near' && q.face !== 'ok') bad.push('配额 face 应 ok/near/over 之一');
    if (typeof q.note !== 'string' || q.note === '') bad.push('配额必须带人话提示');

    mem['phone.app.ghost'] = '{"__v":1,"data":{}}';
    const orph = store.orphanKeys();
    if (orph.count !== 1 || orph.appIds[0] !== 'ghost') bad.push('孤儿键应被登记');
    if (orph.autoDeleted !== 0) bad.push('孤儿键只登记不自动删');
    if (mem['phone.app.ghost'] === undefined) bad.push('孤儿键不许被删');

    return { ok: bad.length === 0, bad, sample: 'apps=' + store.describe().appCount + ' total=' + q.totalBytes + ' orphans=' + orph.count };
}

export default {
    STORE_FACES,
    STORE_ERRORS,
    createAppStore,
    phoneStoreSelfCheck
};
