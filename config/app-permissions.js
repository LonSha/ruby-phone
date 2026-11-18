/**
 * config/app-permissions.js — R24-X2 App 间资源权限面（v4.158.0）
 *
 * 【治的欠债】`CONTEXT.md` 写着「一个 App 不读另一个 App 的表」，但那是**纪律不是机制**：
 *   `config/` 里 300+ 模块相互 import，谁读了谁的资源没有任何地方可查（问题只能靠人记）。
 *   边界提醒：`config/source-permission.js` 是「世界书按书名排除」，与 App 间资源权限**无关**，勿合并。
 *
 * 【fail-closed】未声明的读取一律 `denied`，返回的是**拒判**而不是空数组：
 *   「没权限」与「没有数据」必须不同形，否则界面会把「读不到」画成「空」。
 *
 * 【四态不塌】`granted` / `denied`（未声明）/ `revoked`（用户撤销）/ `invalid`（资源名不存在）
 *   撤销即时生效：不做缓存，撤销后下一次 read 就拿不到（不用重启）。
 *
 * 【台账】最近 N 次跨 App 读取（含被拒尝试）记进一条环形台账，只记「谁读了什么 + 结果」，
 *   **不记内容**；`trailCount` 恒等于 read 次数（不虚增不遗漏）。
 */
import { numOrNull } from './num-gate.js';

export const PERMISSION_RESOURCES = Object.freeze({
    contacts: '通讯录',
    album: '相册',
    messages: '消息',
    wallet: '钱包',
    location: '位置',
    calendar: '日程'
});

export const PERMISSION_FACES = Object.freeze({
    granted: '已授权',
    denied: '未声明（fail-closed）',
    revoked: '用户已撤销',
    invalid: '资源名不存在'
});

export const PERMISSION_TRAIL_LIMIT = 50;

function isResource(resource) {
    return Object.prototype.hasOwnProperty.call(PERMISSION_RESOURCES, resource);
}

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
}

function pairKey(appId, resource) {
    return String(appId) + '::' + String(resource);
}

/**
 * 权限注册表。纯内存，不写 storage —— 声明本身是配置，撤销是会话级用户动作。
 */
export function createPermissionRegistry(options) {
    const o = options && typeof options === 'object' ? options : {};
    const wanted = numOrNull(o.trailLimit);
    const trailLimit = wanted !== null && wanted > 0 ? Math.floor(wanted) : PERMISSION_TRAIL_LIMIT;

    const declarations = new Map();
    const revoked = new Set();
    const trail = [];
    let readCount = 0;

    function declare(appId, resources) {
        if (!isNonEmptyString(appId)) return { ok: false, bad: ['no-app-id'], appId: null, declared: [] };
        const list = Array.isArray(resources) ? resources : [];
        const bad = [];
        const kept = [];
        for (let i = 0; i < list.length; i += 1) {
            const r = list[i];
            if (!isResource(r)) { bad.push('unknown-resource:' + String(r)); continue; }
            if (kept.indexOf(r) === -1) kept.push(r);
        }
        declarations.set(appId, kept);
        return { ok: bad.length === 0, bad, appId, declared: kept.slice() };
    }

    function face(appId, resource) {
        if (!isResource(resource)) return { face: 'invalid', reason: 'unknown-resource' };
        if (revoked.has(pairKey(appId, resource))) return { face: 'revoked', reason: 'user-revoked' };
        const list = declarations.get(appId);
        if (!list || list.indexOf(resource) === -1) return { face: 'denied', reason: 'not-declared' };
        return { face: 'granted', reason: 'declared' };
    }

    /**
     * 唯一读取出口。只有 granted 才会调用 loader（负控制：被拒时 loader 一次都不许被调）。
     * `data: null` + `reason: 'no-data'` 是「有权限但确实没有」，与 denied 不同形。
     */
    function read(appId, resource, loader) {
        const f = face(appId, resource);
        readCount += 1;
        trail.push({ appId: String(appId), resource: String(resource), face: f.face, seq: readCount });
        while (trail.length > trailLimit) trail.shift();
        if (f.face !== 'granted') return { face: f.face, reason: f.reason, data: null };
        if (typeof loader !== 'function') return { face: 'granted', reason: 'no-loader', data: null };
        let data;
        try {
            data = loader();
        } catch (e) {
            return { face: 'granted', reason: 'loader-threw', data: null, error: String((e && e.message) || e) };
        }
        if (data === null || data === undefined) return { face: 'granted', reason: 'no-data', data: null, empty: true };
        return { face: 'granted', reason: 'ok', data };
    }

    function revoke(appId, resource) {
        if (!isResource(resource)) return { ok: false, bad: ['unknown-resource'], face: 'invalid' };
        revoked.add(pairKey(appId, resource));
        return { ok: true, appId, resource, face: 'revoked' };
    }

    /** 撤销后可恢复，但**只能恢复到已声明**：没声明过的资源不能靠「恢复」绕过 fail-closed。 */
    function grant(appId, resource) {
        if (!isResource(resource)) return { ok: false, bad: ['unknown-resource'], face: 'invalid' };
        const list = declarations.get(appId);
        if (!list || list.indexOf(resource) === -1) return { ok: false, bad: ['not-declared'], face: 'denied' };
        revoked.delete(pairKey(appId, resource));
        return { ok: true, appId, resource, face: 'granted' };
    }

    function trailLog(limit) {
        const n = numOrNull(limit);
        const take = n !== null && n > 0 ? Math.floor(n) : trail.length;
        return trail.slice(Math.max(0, trail.length - take)).map(function (e) { return Object.assign({}, e); });
    }

    function trailCount() {
        return readCount;
    }

    function describe() {
        const apps = [];
        declarations.forEach(function (list, appId) {
            apps.push({ appId, declared: list.slice(), granted: list.filter(function (r) { return !revoked.has(pairKey(appId, r)); }) });
        });
        return {
            appCount: apps.length,
            resourceNames: Object.keys(PERMISSION_RESOURCES),
            trailCount: readCount,
            trailKept: trail.length,
            trailLimit,
            apps
        };
    }

    return { declare, face, read, revoke, grant, trailLog, trailCount, describe };
}

export function appPermissionsSelfCheck() {
    const bad = [];
    const reg = createPermissionRegistry({ trailLimit: 3 });

    const d = reg.declare('wechat', ['contacts', 'messages']);
    if (!d.ok) bad.push('合法声明应成功');
    const d2 = reg.declare('mall', ['wallet', 'bogus']);
    if (d2.ok || d2.bad.indexOf('unknown-resource:bogus') === -1) bad.push('非法资源名应拒收并指明');

    if (reg.face('wechat', 'contacts').face !== 'granted') bad.push('已声明应 granted');
    if (reg.face('mall', 'contacts').face !== 'denied') bad.push('未声明应 denied');
    if (reg.face('wechat', 'nothing').face !== 'invalid') bad.push('不存在的资源应是 invalid 而不是 denied');

    let loaderCalls = 0;
    const granted = reg.read('wechat', 'messages', function () { loaderCalls += 1; return ['hi']; });
    if (granted.face !== 'granted' || !granted.data) bad.push('granted 应拿到数据');
    const denied = reg.read('mall', 'contacts', function () { loaderCalls += 1; return ['leak']; });
    if (denied.face !== 'denied') bad.push('denied 应是 denied');
    if (denied.data !== null) bad.push('denied 的 data 必须是 null（不是空数组）');
    if (loaderCalls !== 1) bad.push('被拒时 loader 不许被调用（负控制）');

    const empty = reg.read('wechat', 'messages', function () { return null; });
    if (empty.face !== 'granted' || empty.reason !== 'no-data') bad.push('有权限但没数据应 granted/no-data');

    reg.revoke('wechat', 'contacts');
    if (reg.face('wechat', 'contacts').face !== 'revoked') bad.push('撤销后应 revoked');
    const callsBefore = loaderCalls;
    const afterRevoke = reg.read('wechat', 'contacts', function () { loaderCalls += 1; return ['x']; });
    if (afterRevoke.face !== 'revoked') bad.push('撤销后读取应 revoked');
    if (loaderCalls !== callsBefore) bad.push('撤销应即时生效（loader 一次都不许被调，负控制）');

    if (reg.grant('wechat', 'contacts').face !== 'granted') bad.push('已声明资源可恢复');
    if (reg.grant('wechat', 'wallet').ok) bad.push('未声明资源不许靠 grant 绕过 fail-closed');

    const before = reg.trailCount();
    reg.read('wechat', 'messages', function () { return 'SECRET-PAYLOAD'; });
    if (reg.trailCount() !== before + 1) bad.push('台账计数应与读取次数一致');
    const logText = JSON.stringify(reg.trailLog(10));
    if (logText.indexOf('SECRET-PAYLOAD') !== -1) bad.push('台账不许记内容');
    if (reg.trailLog(10).length > 3) bad.push('台账环形上限应生效');

    const desc = reg.describe();
    if (desc.appCount !== 2) bad.push('describe 应报两个 App');
    if (desc.resourceNames.length !== 6) bad.push('六类资源应齐');

    return {
        ok: bad.length === 0,
        bad,
        sample: 'apps=' + desc.appCount + ' reads=' + desc.trailCount + ' kept=' + desc.trailKept
    };
}

export default {
    PERMISSION_RESOURCES,
    PERMISSION_FACES,
    PERMISSION_TRAIL_LIMIT,
    createPermissionRegistry,
    appPermissionsSelfCheck
};
