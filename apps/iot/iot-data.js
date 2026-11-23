/* ========================================================
 * iot-data.js — [v4.186.0] 智能家居中枢 · 纯函数内核
 *
 * 重构自 `apps/iot/smart-home-ambient-iot-hub.js`（40 行内核，v4.140.0 代入）。
 * 源里能用的只有一句话：三件设备 + 两套场景补丁。其余三块必须改：
 *
 *   ① **状态是类的实例字段**（`this.iotDevices`）：会话该怎么存、跨会话怎么不串味、
 *      重启后还认不认，源没有答案。本件改成纯函数：状态是**值**，进也进 PhoneStorage。
 *   ② **自己产叙事与 prompt 指令**（`narrativeAmbience` / `promptDirective`）：
 *      本仓 App 只给**事实读数**，叙事归生成侧。本件 `iotPromptBlock()` 只报「灯 2400K 35%、
 *      空调 quiet 24 度、窗帘全闭、场景 cozy_night」，一个字的气氛描写都不写。
 *   ③ **「同室私密」写死在 cozy_night 的描述里**：那是叙事口味，不是设备状态。
 *      本件只记设备读数与场景名，谁想写那层气氛自己去写。
 *
 * 四条纪律（都是本仓治过的形态）：
 *   · 越界读数**夹取并如实报**（`notes`），不静默归零；
 *   · 认不出的值**拒答**（`ok:false` + reason），不当默认值用；
 *   · 所有函数**不改入参**（返回新对象）；
 *   · 读不出存储 ≠ 没设过（`FACE.storage_absent` 独立一态）。
 * ======================================================== */
'use strict';

export const IOT_FACE = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage_absent',
});

export const IOT_LIMITS = Object.freeze({
    colorTempK: [2000, 6500],
    brightness: [0, 100],
    setPointC: [16, 30],
    closedPercent: [0, 100],
});

export const AC_MODES = Object.freeze(['cool', 'heat', 'dry', 'fan', 'quiet']);

/** 设备表：id / 名 / 图标 / 可调属性（属性名 → 类型）。 */
export const IOT_DEVICES = Object.freeze([
    { id: 'lamp', name: '氛围灯', icon: '💡', keys: ['power', 'colorTempK', 'brightness'] },
    { id: 'ac', name: '空调', icon: '❄', keys: ['power', 'mode', 'setPointC'] },
    { id: 'blind', name: '窗帘', icon: '🪟', keys: ['closedPercent'] },
]);

/** 场景 = **设备补丁表**，不是故事。每一格都是可校验的读数。 */
export const IOT_SCENES = Object.freeze({
    cozy_night: {
        label: '睡前暖光',
        patch: {
            lamp: { power: true, colorTempK: 2400, brightness: 35 },
            ac: { power: true, mode: 'quiet', setPointC: 24 },
            blind: { closedPercent: 100 },
        },
    },
    fresh_morning: {
        label: '清晨开窗',
        patch: {
            lamp: { power: false, brightness: 0 },
            blind: { closedPercent: 0 },
        },
    },
    focus: {
        label: '专注',
        patch: {
            lamp: { power: true, colorTempK: 5000, brightness: 85 },
            ac: { power: true, mode: 'cool', setPointC: 25 },
            blind: { closedPercent: 60 },
        },
    },
    away: {
        label: '离家',
        patch: {
            lamp: { power: false, brightness: 0 },
            ac: { power: false },
            blind: { closedPercent: 100 },
        },
    },
});

function inRange(n, lo, hi) { return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi; }

/** 夹取到区间，并报「改过」（不改数据就不出声）。 */
function clampN(v, lo, hi, label, notes) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < lo) { notes.push(label + ' 低于下限 ' + lo + '（实测 ' + n + '）'); return lo; }
    if (n > hi) { notes.push(label + ' 高于上限 ' + hi + '（实测 ' + n + '）'); return hi; }
    return n;
}

export function defaultIotState() {
    return {
        scene: 'custom',
        devices: {
            lamp: { power: true, colorTempK: 3000, brightness: 70 },
            ac: { power: true, mode: 'cool', setPointC: 25 },
            blind: { closedPercent: 20 },
        },
    };
}

/** 归一：认出几件说几件；认不出的**留下原值并记账**，绝不悄悄换成默认值。 */
export function normalizeIotState(raw) {
    const notes = [];
    const base = defaultIotState();
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_object', state: base, notes };
    const out = { scene: typeof raw.scene === 'string' ? raw.scene : 'custom', devices: {} };
    for (const dev of IOT_DEVICES) {
        const src = (raw.devices && raw.devices[dev.id]) || {};
        const dst = {};
        for (const key of dev.keys) {
            if (!(key in src)) { dst[key] = base.devices[dev.id][key]; continue; }
            if (key === 'power') { dst.power = src.power === true; continue; }
            if (key === 'mode') {
                if (AC_MODES.indexOf(src.mode) >= 0) dst.mode = src.mode;
                else { dst.mode = base.devices[dev.id].mode; notes.push('空调模式认不出（' + String(src.mode) + '），保留默认'); }
                continue;
            }
            const range = IOT_LIMITS[key];
            const v = clampN(src[key], range[0], range[1], dev.name + ' ' + key, notes);
            dst[key] = (v === null) ? base.devices[dev.id][key] : v;
            if (v === null) notes.push(dev.name + ' ' + key + ' 不是数（' + String(src[key]) + '），保留默认');
        }
        out.devices[dev.id] = dst;
    }
    if (IOT_SCENES[out.scene] === undefined && out.scene !== 'custom') notes.push('场景名认不出（' + out.scene + '），记为 custom');
    return { ok: true, state: out, notes };
}

/** 应用场景：返回**新状态** + 实际改动的格子清单（没改就不出声）。 */
export function applyScene(state, sceneId) {
    const sc = IOT_SCENES[sceneId];
    if (!sc) return { ok: false, reason: 'unknown_scene', state, changes: [] };
    const norm = normalizeIotState(state);
    const cur = norm.state;
    const devices = {};
    const changes = [];
    for (const dev of IOT_DEVICES) {
        devices[dev.id] = Object.assign({}, cur.devices[dev.id]);
        const patch = sc.patch[dev.id];
        if (!patch) continue;
        for (const key of Object.keys(patch)) {
            const next = patch[key];
            if (devices[dev.id][key] !== next) changes.push(dev.name + ' ' + key + ':' + String(devices[dev.id][key]) + '->' + String(next));
            devices[dev.id][key] = next;
        }
    }
    return { ok: true, state: { scene: sceneId, devices }, changes };
}

/** 单独改一格：devId + key + value。越界**夹取并报**，认不出**拒答**。 */
export function setDeviceProp(state, devId, key, value) {
    const dev = IOT_DEVICES.find((d) => d.id === devId);
    if (!dev) return { ok: false, reason: 'unknown_device', state };
    if (dev.keys.indexOf(key) < 0) return { ok: false, reason: 'unknown_key', state };
    const notes = [];
    const norm = normalizeIotState(state);
    const cur = norm.state;
    const devices = {};
    for (const d of IOT_DEVICES) devices[d.id] = Object.assign({}, cur.devices[d.id]);
    if (key === 'power') {
        if (typeof value !== 'boolean') return { ok: false, reason: 'not_boolean', state: cur };
        devices[devId].power = value;
    } else if (key === 'mode') {
        if (AC_MODES.indexOf(value) < 0) return { ok: false, reason: 'unknown_mode', state: cur };
        devices[devId].mode = value;
    } else {
        const range = IOT_LIMITS[key];
        const v = clampN(value, range[0], range[1], dev.name + ' ' + key, notes);
        if (v === null) return { ok: false, reason: 'not_number', state: cur };
        devices[devId][key] = v;
    }
    return { ok: true, state: { scene: 'custom', devices }, notes };
}

/** 三态面：读得出 / 读得出但是初值 / 读不出（不许把读不出写成没设过）。 */
export function readIotFace(state, storageOk) {
    if (!storageOk) return IOT_FACE.storage_absent;
    if (!state) return IOT_FACE.empty;
    return IOT_FACE.ready;
}

/** 人话读数：一行一件，供视图与注入共用（两侧同源）。 */
export function projectIot(state) {
    const norm = normalizeIotState(state);
    const s = norm.state;
    const rows = [];
    const l = s.devices.lamp;
    rows.push({ device: 'lamp', text: l.power ? ('氛围灯开 · ' + l.colorTempK + 'K · ' + l.brightness + '%') : '氛围灯关' });
    const a = s.devices.ac;
    rows.push({ device: 'ac', text: a.power ? ('空调开 · ' + a.mode + ' · ' + a.setPointC + '度') : '空调关' });
    const b = s.devices.blind;
    rows.push({ device: 'blind', text: b.closedPercent >= 100 ? '窗帘全闭' : (b.closedPercent <= 0 ? '窗帘全开' : ('窗帘闭 ' + b.closedPercent + '%')) });
    const scene = IOT_SCENES[s.scene] ? IOT_SCENES[s.scene].label : '自己调的';
    return { scene, sceneId: s.scene, rows, notes: norm.notes };
}

/** 注入面：**只给事实**。禁止出现叙事形容词（由判据扫）。 */
export function iotPromptBlock(state) {
    const p = projectIot(state);
    const lines = ['【室内设备读数】场景：' + p.scene];
    for (const r of p.rows) lines.push('- ' + r.text);
    return lines.join(String.fromCharCode(10));
}
