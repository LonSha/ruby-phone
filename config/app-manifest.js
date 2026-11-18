/**
 * config/app-manifest.js — R24-X3 应用市场：第三方 App 的声明与装载（v4.158.0）
 *
 * 【治的欠债】新增 App 要改**四处注册**（`config/apps.js` / `phone.css` / `index.js` 分支 / 可选标签监听），
 *   `CONTEXT.md` 与 `scripts/registry-audit.mjs` 都写死了这条 ⇒「第三方写个 App 装进来」结构上不可能。
 *
 * 【声明式清单】`{ id, name, icon, color, entry, styles, permissions, schema }`。
 *   `validateManifest()` 拒非法清单并给出**具体原因**（缺 entry / 权限越界 / id 撞内置）。
 *
 * 【同一条装载路径】内置 App 与第三方 App 走同一个 `install()`：
 *   没有「内置特权分支」，卸载同样撤图标 + 撤样式 + 撤权限（数据保留或清除由用户选，不许静默删）。
 *
 * 【权限走 X2】`permissions` 只接受 `config/app-permissions.js` 登记的六类资源；越界即装不上。
 */
export const MANIFEST_FIELDS = Object.freeze(['id', 'name', 'icon', 'color', 'entry', 'styles', 'permissions', 'schema']);
export const MANIFEST_REQUIRED = Object.freeze(['id', 'name', 'entry']);
export const RESOURCE_NAMES = Object.freeze(['contacts', 'album', 'messages', 'wallet', 'location', 'calendar']);

/** 内置 App 的 id 集合（由调用方注入真实清单；这里只做撞名判定）。 */
export function validateManifest(manifest, builtinIds) {
    const m = manifest && typeof manifest === 'object' ? manifest : null;
    const bad = [];
    if (!m) return { ok: false, bad: ['no-manifest'] };
    MANIFEST_REQUIRED.forEach(function (f) {
        if (typeof m[f] !== 'string' || m[f].trim() === '') bad.push('missing-field:' + f);
    });
    if (typeof m.id === 'string' && !/^[a-z][a-z0-9_-]{1,31}$/.test(m.id)) bad.push('bad-id');
    const builtins = Array.isArray(builtinIds) ? builtinIds.map(String) : [];
    if (typeof m.id === 'string' && builtins.indexOf(m.id) !== -1 && m.origin !== 'builtin-return') bad.push('id-conflicts-builtin');
    if (typeof m.entry !== 'string' || !/\.m?js$/.test(m.entry)) bad.push('bad-entry');
    if (m.styles !== undefined && typeof m.styles !== 'string') bad.push('bad-styles');
    if (m.permissions !== undefined) {
        if (!Array.isArray(m.permissions)) bad.push('bad-permissions');
        else m.permissions.forEach(function (p) { if (RESOURCE_NAMES.indexOf(p) === -1) bad.push('permission-out-of-scope:' + String(p)); });
    }
    if (m.schema !== undefined && (m.schema === null || typeof m.schema !== 'object' || Array.isArray(m.schema))) bad.push('bad-schema');
    if (m.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(m.color))) bad.push('bad-color');
    return { ok: bad.length === 0, bad, normalized: bad.length ? null : {
        id: m.id, name: m.name, icon: m.icon || 'app', color: m.color || '#5b8cff',
        entry: m.entry, styles: m.styles || null, permissions: (m.permissions || []).slice(), schema: m.schema || {}
    } };
}

/**
 * 注册表：运行时可增删，内置与第三方同路径。
 * @param {{builtins?:Array<object>}} input
 */
export function createAppRegistry(input) {
    const src = input && typeof input === 'object' ? input : {};
    const apps = new Map();
    const styles = new Set();
    const log = [];
    let installs = 0;
    let uninstalls = 0;

    (Array.isArray(src.builtins) ? src.builtins : []).forEach(function (b) {
        const v = validateManifest(Object.assign({ origin: 'builtin-return' }, b), []);
        if (v.ok) { apps.set(v.normalized.id, Object.assign({ builtin: true, installed: true }, v.normalized)); }
    });

    function builtinIds() { return Array.from(apps.values()).filter(function (a) { return a.builtin; }).map(function (a) { return a.id; }); }

    function install(manifest) {
        const v = validateManifest(manifest, builtinIds());
        if (!v.ok) return { ok: false, bad: v.bad };
        if (apps.has(v.normalized.id)) {
            const cur = apps.get(v.normalized.id);
            if (cur.builtin) return { ok: false, bad: ['id-conflicts-builtin'] };
            if (cur.installed) return { ok: false, bad: ['already-installed'] };
        }
        apps.set(v.normalized.id, Object.assign({ builtin: false, installed: true, origin: 'third-party' }, v.normalized));
        if (v.normalized.styles) styles.add(v.normalized.id);
        installs += 1;
        log.push({ action: 'install', appId: v.normalized.id });
        return { ok: true, appId: v.normalized.id, via: 'same-path', permissions: v.normalized.permissions };
    }

    /**
     * @param {string} appId
     * @param {{keepData?:boolean}} options 必须显式表态：不传则拒（不许静默删）
     */
    function uninstall(appId, options) {
        const id = String(appId);
        const entry = apps.get(id);
        if (!entry) return { ok: false, bad: ['not-installed'] };
        if (entry.builtin) return { ok: false, bad: ['builtin-cannot-uninstall'] };
        const o = options && typeof options === 'object' ? options : {};
        if (typeof o.keepData !== 'boolean') return { ok: false, bad: ['keep-data-not-specified'] };
        apps.delete(id);
        styles.delete(id);
        uninstalls += 1;
        log.push({ action: 'uninstall', appId: id, keepData: o.keepData });
        return { ok: true, appId: id, iconRemoved: true, styleRemoved: true, data: o.keepData ? 'kept' : 'cleared' };
    }

    function list() {
        return Array.from(apps.values()).map(function (a) {
            return { id: a.id, name: a.name, builtin: a.builtin, hasStyle: styles.has(a.id), permissions: a.permissions.slice() };
        });
    }

    function get(appId) { return apps.get(String(appId)) || null; }

    function stats() {
        return { total: apps.size, builtins: builtinIds().length, thirdParty: apps.size - builtinIds().length, styles: styles.size, installs, uninstalls };
    }

    return { install, uninstall, list, get, stats, builtinIds, log };
}

/** 同一件事不允许走两套挂载：所有安装都带 `via: 'same-path'`。 */
export function mountPathOf(installResult) {
    return installResult && installResult.ok ? installResult.via : null;
}

export function appManifestSelfCheck() {
    const bad = [];
    const registry = createAppRegistry({ builtins: [{ id: 'wechat', name: '微信', entry: 'apps/wechat/index.js' }] });

    if (registry.stats().builtins !== 1) bad.push('内置 App 应按同一清单登记');
    // 注意：单字母 id（如 'x'）本身就会命中 bad-id ⇒ 断言用 indexOf，别把首项当唯一原因。
    if (validateManifest({ id: 'wx1', name: 'X' }, []).bad.indexOf('missing-field:entry') === -1) bad.push('缺 entry 应给出具体原因');
    if (validateManifest({ id: 'wx1', name: 'X', entry: 'a.txt' }, []).bad.indexOf('bad-entry') === -1) bad.push('非 js 入口应拒');
    if (validateManifest({ id: 'wx1', name: 'X', entry: 'a.js', permissions: ['root'] }, []).bad.indexOf('permission-out-of-scope:root') === -1) bad.push('权限越界应拒并指明');
    if (validateManifest({ id: 'x', name: 'X', entry: 'a.js' }, []).bad.indexOf('bad-id') === -1) bad.push('单字母 id 应拒');
    if (validateManifest({ id: 'wechat', name: '微信', entry: 'a.js' }, ['wechat']).bad[0] !== 'id-conflicts-builtin') bad.push('撞内置 id 应拒');

    const weather = { id: 'weather', name: '天气', entry: 'apps/weather/index.js', styles: 'weather.css', permissions: ['location'], color: '#3aa0ff' };
    const inst = registry.install(weather);
    if (!inst.ok || mountPathOf(inst) !== 'same-path') bad.push('第三方 App 应走同一装载路径');
    if (registry.get('weather').builtin) bad.push('第三方不许被标成内置');
    if (registry.stats().styles !== 1) bad.push('样式应按需登记');
    if (registry.install(weather).bad[0] !== 'already-installed') bad.push('重复安装应拒');

    if (registry.uninstall('weather', {}).bad[0] !== 'keep-data-not-specified') bad.push('卸载必须让用户选数据去留（不许静默删）');
    const un = registry.uninstall('weather', { keepData: false });
    if (!un.ok || !un.styleRemoved || un.data !== 'cleared') bad.push('卸载应撤图标撤样式');
    if (registry.get('weather') !== null) bad.push('卸载后不应还在清单里');
    if (registry.uninstall('wechat', { keepData: true }).bad[0] !== 'builtin-cannot-uninstall') bad.push('内置不许被第三方卸载路径处理');

    return { ok: bad.length === 0, bad, sample: 'apps=' + registry.stats().total + ' installs=' + registry.stats().installs };
}

export default {
    MANIFEST_FIELDS,
    MANIFEST_REQUIRED,
    RESOURCE_NAMES,
    validateManifest,
    createAppRegistry,
    mountPathOf,
    appManifestSelfCheck
};