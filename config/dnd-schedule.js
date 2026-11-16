/**
 * 免打扰时段 —— 唯一桥（v4.157.0 · R22-X2）
 *
 * 回答「此刻该不该打扰」。只判不写：时段配置归宿主，打扰与否由本桥给候选。
 * 跨零点时段（如 23:00→07:00）支持；start==end 视为全天不打扰。
 */
import { numOrNull } from './num-gate.js';

const DND_FACES = Object.freeze(['disabled', 'outside', 'inside', 'invalid']);

export function normalizeWindow(w) {
    if (!w || typeof w !== 'object') return { ok: false };
    const start = numOrNull(w.start);
    const end = numOrNull(w.end);
    if (start == null || end == null) return { ok: false };
    const s = ((Math.floor(start) % 24) + 24) % 24;
    const e = ((Math.floor(end) % 24) + 24) % 24;
    return { ok: true, start: s, end: e };
}

export function inWindow(hour, win) {
    const h = numOrNull(hour);
    if (h == null) return null;
    const nw = normalizeWindow(win);
    if (!nw.ok) return null;
    const hh = ((Math.floor(h) % 24) + 24) % 24;
    if (nw.start === nw.end) return true;
    if (nw.start < nw.end) return hh >= nw.start && hh < nw.end;
    return hh >= nw.start || hh < nw.end;
}

export function dndFace({ enabled, hour, window } = {}) {
    if (!enabled) return { face: 'disabled', quiet: false, hour: numOrNull(hour) };
    const nw = normalizeWindow(window);
    if (!nw.ok) return { face: 'invalid', quiet: false, hour: numOrNull(hour) };
    const inside = inWindow(hour, window);
    if (inside == null) return { face: 'invalid', quiet: false, hour: null };
    return { face: inside ? 'inside' : 'outside', quiet: inside, hour: numOrNull(hour) };
}

function dndNote(r) {
    const face = r && r.face;
    if (face === 'disabled') return '免打扰未开启';
    if (face === 'invalid') return '免打扰时段读不出来';
    if (face === 'inside') return '正在免打扰时段，通知先进通知中心';
    return '不在免打扰时段';
}

export function dndSelfCheck() {
    const bad = [];
    if (dndFace({ enabled: false }).face !== 'disabled') bad.push('关闭态错');
    if (dndFace({ enabled: true, hour: 23, window: { start: 23, end: 7 } }).face !== 'inside') bad.push('跨零点内错');
    if (dndFace({ enabled: true, hour: 12, window: { start: 23, end: 7 } }).face !== 'outside') bad.push('跨零点外错');
    if (dndFace({ enabled: true, hour: 10, window: { start: 9, end: 18 } }).face !== 'inside') bad.push('同日窗内错');
    if (dndFace({ enabled: true, hour: 8, window: { start: 9, end: 18 } }).face !== 'outside') bad.push('同日窗外错');
    if (dndFace({ enabled: true, hour: 5, window: { start: 0, end: 0 } }).face !== 'inside') bad.push('全天窗错');
    if (dndFace({ enabled: true, hour: 5, window: { start: null, end: 7 } }).face !== 'invalid') bad.push('坏窗应 invalid');
    if (inWindow(null, { start: 1, end: 2 }) !== null) bad.push('时刻读不到应 null');
    return { ok: bad.length === 0, bad };
}
