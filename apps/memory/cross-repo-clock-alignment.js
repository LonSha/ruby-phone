/* ========================================================
 * [v4.150.0 · R21-X2] 双仓剧情钟对齐，只报告，不校时。
 * 手机经 storyNow(readOnly) 取已发布缓存；记忆经统一探针取 LonSha 已发布对象。
 * 不调用重算、拉取、刷新或私有桥缓存；精度不足返回 unavailable。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';
import { LONSHA_BRIDGE_ID, readPushProbe, readPushField } from '../../config/world-bridge.js';
import { storyNow } from '../../config/time-source.js';

export const CLOCK_ALIGNMENT_STATES = Object.freeze({
    ALIGNED: 'aligned', SKEWED: 'skewed', UNAVAILABLE: 'unavailable'
});

/** 两侧无时区的剧情日期采用同一 UTC 坐标比较；缺时间不能猜成午夜。 */
export function parseClockToTimestamp(dateStr, timeStr = '') {
    if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
    const date = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/.exec(dateStr.trim());
    const time = /^(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?$/.exec(timeStr.trim());
    if (!date || !time) return null;
    const [, year, month, day] = date.map(Number);
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    const second = time[3] ? Number(time[3]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31
        || hour > 23 || minute > 59 || second > 59) return null;
    const parsed = new Date(0);
    parsed.setUTCFullYear(year, month - 1, day);
    parsed.setUTCHours(hour, minute, second, 0);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day) return null;
    return parsed.getTime();
}

const text = (value) => typeof value === 'string' ? value.trim() : '';
function clockFace(clock) {
    if (!clock || typeof clock !== 'object' || Array.isArray(clock) || clock.absent === true) return null;
    const date = text(clock.date) || text(clock.storyDate);
    const explicitTime = text(clock.time) || text(clock.storyTime);
    const label = text(clock.label);
    const time = explicitTime || label;
    const precision = text(clock.precision).toLowerCase();
    if (!explicitTime && label && precision && !['minute', 'second', 'exact'].includes(precision)) {
        return { display: [date, label].filter(Boolean).join(' '), ms: null };
    }
    const stamp = numOrNull(clock.timestamp);
    const display = [date, time].filter(Boolean).join(' ') || (stamp !== null ? String(stamp) : '');
    // 有日期/时间文本时以同一坐标解析，避免手机本地时区时间戳与记忆 UTC 文本混比。
    const ms = date || time ? parseClockToTimestamp(date, time) : (stamp !== null && stamp > 0 ? stamp : null);
    return { display, ms };
}

function unavailable(reason, phoneText = '', memoryText = '', detail = '时间格式不可比或精度不足') {
    return {
        state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE, verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
        minutes: null, direction: 'unknown', reason, phoneText, memoryText,
        label: `时钟对齐：读不到（${detail}）`
    };
}

/** 纯函数；不改入参；三态的返回键面恒定。阈值以未舍入的偏差判定。 */
export function checkClockAlignment(phoneClock, memoryClock, options = {}) {
    try {
        const phone = clockFace(phoneClock);
        const memory = clockFace(memoryClock);
        if (!phone) return unavailable('no-phone-clock', '', memory?.display || '', '手机剧情时钟缺失');
        if (!memory) return unavailable('no-memory-clock', phone.display, '', '记忆插件剧情时钟缺失');
        if (!phone.display) return unavailable('phone-clock-empty', '', memory.display, '手机端时间为空');
        if (!memory.display) return unavailable('memory-clock-empty', phone.display, '', '记忆端时间为空');
        if (phone.ms === null || memory.ms === null) {
            return unavailable('unparsable-time-format', phone.display, memory.display);
        }
        const threshold = Math.max(0, numOrNull(options?.thresholdMinutes) ?? 0);
        const diff = phone.ms - memory.ms;
        const minutes = Math.abs(diff) / 60000;
        const aligned = minutes <= threshold;
        const state = aligned ? CLOCK_ALIGNMENT_STATES.ALIGNED : CLOCK_ALIGNMENT_STATES.SKEWED;
        return {
            state, verdict: state, minutes: aligned ? 0 : minutes,
            direction: aligned ? 'exact' : (diff > 0 ? 'phone-ahead' : 'memory-ahead'),
            reason: aligned ? 'aligned' : 'clock-skewed',
            phoneText: phone.display, memoryText: memory.display,
            label: aligned ? '时钟对齐：一致' : `时钟对齐：偏差 ${Number(minutes.toFixed(2))} 分钟`
        };
    } catch (_e) {
        return unavailable('clock-read-error');
    }
}

/** 每次渲染读取已发布快照，不刷新桥、不重算剧情钟、不写入任一侧。 */
export function probeCrossRepoClockAlignment(win) {
    const w = win === undefined ? (typeof window !== 'undefined' ? window : null) : win;
    if (!w || typeof w !== 'object') return unavailable('no-window', '', '', '宿主环境不存在');
    try {
        const phone = storyNow(w, { readOnly: true });
        if (!phone.ok) return unavailable('phone-clock-unavailable', '', '', '手机尚无有效的剧情时钟缓存');
        const probe = readPushProbe(w, { publishedOnly: true, bridgeId: LONSHA_BRIDGE_ID });
        if (!probe.mounted) return unavailable('memory-bridge-absent', '', '', '记忆插件未连接');
        if (!probe.hasSnapshot) return unavailable('memory-no-snapshot', '', '', '记忆插件尚无已发布快照');
        const field = readPushField(probe.snapshot, 'clock');
        if (!field.present) return unavailable('memory-clock-absent', '', '', '记忆快照没有剧情时钟');
        return checkClockAlignment({ date: phone.date, time: phone.time, timestamp: phone.ms }, field.value);
    } catch (_e) {
        return unavailable('clock-read-error');
    }
}
