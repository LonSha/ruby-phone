/**
 * config/phone-archive.js — R24-X4 整机可携：人类可读的手机档案（v4.158.0）
 *
 * 【边界】`apps/archive`（存档台）与 `apps/backupdesk`（备份桌）都是**包治理**
 *   （一份包的结构 / 版本 / 覆盖性），不是「把整台手机端走再放回来」。本模块补后者。
 *
 * 【人类可读】导出成 `phone/<app>/data.json` + `manifest.json`；
 *   字段名是英文标识（id / at / from / text），不是内部键（`__v` / `_p` 之流不进档案）。
 *
 * 【三种导入模式必须不同形】
 *   `replace` 全量替换（档案说了算）/ `merge` 同 id 取新（按 at 比）/ `fill` 只补空（本地有就不动）。
 *   三模式在同一份档案上**必须产生三种不同结果**（测试可复跑）。
 *
 * 【先预览后写】`previewImport()` 给出「新增 / 覆盖 / 丢弃 / 保留」四个数，确认后才 `applyImport()`。
 */
export const IMPORT_MODES = Object.freeze({
    replace: '全量替换（档案说了算）',
    merge: '合并（同 id 取新）',
    fill: '只补空（本地有就不动）'
});

export const MANIFEST_SCHEMA = 'phone-archive@1';

/** 兼容两种喂法：直接给记录数组，或 `{records:[...]}`（各处实现差异不大，别逼调用方改形状）。 */
function recordsOf(app) {
    if (Array.isArray(app)) return app;
    return app && Array.isArray(app.records) ? app.records : [];
}

function atOf(rec) {
    const n = rec && rec.at !== undefined ? Number(rec.at) : NaN;
    return isFinite(n) ? n : 0;
}

function indexById(records) {
    const map = new Map();
    records.forEach(function (r) { if (r && r.id !== undefined) map.set(String(r.id), r); });
    return map;
}

/** 导出：纯 JSON，可被文本编辑器读。 */
export function exportArchive(state, options) {
    const s = state && typeof state === 'object' ? state : {};
    const apps = s.apps && typeof s.apps === 'object' ? s.apps : {};
    const o = options && typeof options === 'object' ? options : {};
    const files = {};
    const manifestApps = {};
    Object.keys(apps).sort().forEach(function (appId) {
        const records = recordsOf(apps[appId]).map(function (r) {
            return {
                id: String(r && r.id !== undefined ? r.id : ''),
                at: atOf(r),
                from: String(r && r.from !== undefined ? r.from : ''),
                text: String(r && r.text !== undefined ? r.text : '')
            };
        });
        files['phone/' + appId + '/data.json'] = records;
        manifestApps[appId] = { count: records.length };
    });
    const manifest = {
        schema: MANIFEST_SCHEMA,
        exportedAt: String(o.exportedAt || ''),
        appCount: Object.keys(manifestApps).length,
        apps: manifestApps
    };
    return { files, manifest };
}

/** 解析档案（只认本模块导出的形状）。 */
export function parseArchive(archive) {
    const a = archive && typeof archive === 'object' ? archive : {};
    const manifest = a.manifest && typeof a.manifest === 'object' ? a.manifest : null;
    const bad = [];
    if (!manifest) bad.push('no-manifest');
    else if (manifest.schema !== MANIFEST_SCHEMA) bad.push('bad-schema');
    const files = a.files && typeof a.files === 'object' ? a.files : {};
    const apps = {};
    Object.keys(files).forEach(function (path) {
        const m = /^phone\/([a-z0-9_-]+)\/data\.json$/.exec(path);
        if (!m) { bad.push('bad-path:' + path); return; }
        const list = files[path];
        if (!Array.isArray(list)) { bad.push('bad-data:' + path); return; }
        apps[m[1]] = list.map(function (r) {
            return { id: String(r.id), at: atOf(r), from: String(r.from || ''), text: String(r.text || '') };
        });
    });
    return { ok: bad.length === 0, bad, apps, manifest };
}

/** 预览：不写，只算四个数（逐 App + 合计）。 */
export function previewImport(archive, current) {
    const parsed = parseArchive(archive);
    if (!parsed.ok) return { ok: false, bad: parsed.bad };
    const cur = current && typeof current === 'object' && current.apps ? current.apps : {};
    const perApp = {};
    let added = 0; let overwritten = 0; let dropped = 0; let kept = 0;
    Object.keys(parsed.apps).forEach(function (appId) {
        const incoming = parsed.apps[appId];
        const local = recordsOf(cur[appId]);
        const localMap = indexById(local);
        const incomingMap = indexById(incoming);
        let a = 0; let ov = 0; let dr = 0;
        incoming.forEach(function (r) { if (localMap.has(String(r.id))) ov += 1; else a += 1; });
        local.forEach(function (r) { if (!incomingMap.has(String(r.id))) dr += 1; });
        perApp[appId] = { added: a, overwritten: ov, droppedOnReplace: dr, localOnlyKeptInMerge: dr };
        added += a; overwritten += ov; dropped += dr;
    });
    kept = dropped;
    return { ok: true, perApp, added, overwritten, droppedOnReplace: dropped, localOnlyKept: kept, appCount: Object.keys(parsed.apps).length };
}

/**
 * 应用导入（纯函数：返回新 state，不改入参）。
 * @param {object} archive
 * @param {object} current
 * @param {'replace'|'merge'|'fill'} mode
 */
export function applyImport(archive, current, mode) {
    const parsed = parseArchive(archive);
    if (!parsed.ok) return { ok: false, bad: parsed.bad };
    if (!Object.prototype.hasOwnProperty.call(IMPORT_MODES, mode)) return { ok: false, bad: ['unknown-mode'] };
    const cur = current && typeof current === 'object' && current.apps ? current.apps : {};
    const nextApps = {};
    if (mode === 'replace') {
        Object.keys(cur).forEach(function (appId) { nextApps[appId] = recordsOf(cur[appId]).slice(); });
        Object.keys(parsed.apps).forEach(function (appId) { nextApps[appId] = parsed.apps[appId].slice(); });
        return { ok: true, mode, state: { apps: nextApps }, changedApps: Object.keys(parsed.apps) };
    }
    Object.keys(cur).forEach(function (appId) { nextApps[appId] = recordsOf(cur[appId]).slice(); });
    Object.keys(parsed.apps).forEach(function (appId) {
        const local = nextApps[appId] ? nextApps[appId].slice() : [];
        const localMap = indexById(local);
        parsed.apps[appId].forEach(function (r) {
            const existing = localMap.get(String(r.id));
            if (!existing) {
                local.push(r);
                localMap.set(String(r.id), r);
                return;
            }
            if (mode === 'fill') return;
            // merge：同 id 取新（at 大者胜）
            if (atOf(r) >= atOf(existing)) local[local.indexOf(existing)] = r;
        });
        nextApps[appId] = local;
    });
    return { ok: true, mode, state: { apps: nextApps }, changedApps: Object.keys(parsed.apps) };
}

/** 往返对拍：逐字段（id / at / from / text 排序后）比较两台手机的档案。 */
export function diffStates(a, b) {
    const left = exportArchive(a).files;
    const right = exportArchive(b).files;
    const appIds = Array.from(new Set(Object.keys(left).concat(Object.keys(right)))).sort();
    const diffs = [];
    appIds.forEach(function (path) {
        const l = (left[path] || []).slice().sort(function (x, y) { return String(x.id) < String(y.id) ? -1 : 1; });
        const r = (right[path] || []).slice().sort(function (x, y) { return String(x.id) < String(y.id) ? -1 : 1; });
        if (JSON.stringify(l) !== JSON.stringify(r)) diffs.push({ path, left: l.length, right: r.length });
    });
    return { same: diffs.length === 0, diffs };
}

export function phoneArchiveSelfCheck() {
    const bad = [];
    const state = {
        apps: {
            wechat: [{ id: 'm1', at: 1, from: '阿明', text: '在吗' }, { id: 'm2', at: 2, from: '我', text: '在' }],
            album: [{ id: 'p1', at: 3, from: '我', text: '照片1' }]
        }
    };
    const archive = exportArchive(state, { exportedAt: '2026-11-18' });
    if (archive.manifest.appCount !== 2) bad.push('清单应报两个 App');
    if (!archive.files['phone/wechat/data.json']) bad.push('路径应为 phone/<app>/data.json');
    const text = JSON.stringify(archive);
    if (text.indexOf('__v') !== -1) bad.push('档案不许带内部键');
    if (archive.files['phone/wechat/data.json'][0].text !== '在吗') bad.push('字段应为英文标识');

    const cleared = { apps: {} };
    const back = applyImport(archive, cleared, 'replace');
    if (!diffStates(state, back.state).same) bad.push('导出→清空→导入应逐字段一致');

    const local = { apps: { wechat: [{ id: 'm1', at: 9, from: '阿明', text: '本地新值' }, { id: 'm3', at: 3, from: '我', text: '本地独有' }] } };
    const prev = previewImport(archive, local);
    // album 整 App 是新增（+1 条），wechat 里 m2 新增、m1 同名覆盖 —— 逐 App 才对得上账。
    if (!prev.ok || prev.perApp.wechat.added !== 1 || prev.perApp.wechat.overwritten !== 1) bad.push('预览应给出新增/覆盖');
    if (prev.perApp.wechat.droppedOnReplace !== 1) bad.push('预览应算出 replace 会丢几条');
    if (prev.added !== 2) bad.push('总新增应为 wechat.m2 + album.p1');
    const r1 = applyImport(archive, local, 'replace').state;
    const r2 = applyImport(archive, local, 'merge').state;
    const r3 = applyImport(archive, local, 'fill').state;
    // 本地 m1 比档案新（9 > 1）⇒ merge 与 fill 在此例同形是**对的**，
    // 故另起一例让档案更新，才能把 merge / fill 分开考。
    const older = { apps: { wechat: [{ id: 'm1', at: 0, from: '阿明', text: '本地旧值' }, { id: 'm3', at: 3, from: '我', text: '本地独有' }] } };
    const m2 = applyImport(archive, older, 'merge').state;
    const f2 = applyImport(archive, older, 'fill').state;
    if (JSON.stringify(m2) === JSON.stringify(f2)) bad.push('merge 与 fill 必须不同形');
    if (f2.apps.wechat.find(function (r) { return r.id === 'm1'; }).text !== '本地旧值') bad.push('fill 不许覆盖本地已有');
    if (m2.apps.wechat.find(function (r) { return r.id === 'm1'; }).text !== '在吗') bad.push('merge 同 id 取新（档案 at 更大）');
    if (r1.apps.wechat.some(function (r) { return r.id === 'm3'; })) bad.push('replace 应丢弃本地独有');
    if (!r2.apps.wechat.some(function (r) { return r.id === 'm3'; })) bad.push('merge 应保留本地独有');
    if (r3.apps.wechat.find(function (r) { return r.id === 'm1'; }).text !== '本地新值') bad.push('本地更新时 fill 更不许覆盖');
    if (JSON.stringify(local.apps.wechat[0].text) !== JSON.stringify('本地新值')) bad.push('导入不许改入参');

    if (applyImport(archive, local, 'nope').bad[0] !== 'unknown-mode') bad.push('未知模式应拒');
    if (!parseArchive({ files: {} }).bad.includes('no-manifest')) bad.push('缺清单应拒');

    return { ok: bad.length === 0, bad, sample: 'apps=' + archive.manifest.appCount + ' modes=3' };
}

export default {
    IMPORT_MODES,
    MANIFEST_SCHEMA,
    exportArchive,
    parseArchive,
    previewImport,
    applyImport,
    diffStates,
    phoneArchiveSelfCheck
};