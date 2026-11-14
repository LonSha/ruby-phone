/* ========================================================
 * apps/memory/cross-repo-clock-alignment.js
 * [v4.150.0 · 第二十一期 R21-X2 双仓剧情钟对齐校验]
 *
 * 【职责与定位】
 *   对齐校验两端的剧情时钟：
 *     - RubyPhone 手机端剧情时刻（经 `config/time-source.js` 或 `config/story-clock.js`）
 *     - LonSha 记忆插件侧剧情时刻（经 `window.lonsha_memory_bridge_v1` 快照或 `lonshaBridge`）
 *
 * 【四条纪律】
 *   ① 只报差异，绝不自动改写任一侧（改写权归各仓自己的 owner —— 跨仓纪律）。
 *   ② 读不到就如实报 unavailable（带出原因 reason，绝不猜默认值，不许伪造「一致」）。
 *   ③ 弱类型严格收敛至 numOrNull，绝不就地隐式类型转换。
 *   ④ 纯读无副作用，不写任何存储，不触发任何网络或生命周期变动。
 * ======================================================== */

import { numOrNull } from '../../config/num-gate.js';
import { readPushProbe, readPushField } from '../../config/world-bridge.js';
import { storyNow } from '../../config/time-source.js';

/** 对齐状态三态枚举（互斥） */
export const CLOCK_ALIGNMENT_STATES = Object.freeze({
    ALIGNED: 'aligned',
    SKEWED: 'skewed',
    UNAVAILABLE: 'unavailable'
});

/** 解析时间字符串到毫秒时间戳（纯函数，解析失败返回 null） */
export function parseClockToTimestamp(dateStr, timeStr = '') {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const cleanDate = dateStr.trim();
    if (!cleanDate) return null;

    // 格式1：标准 YYYY-MM-DD 或 YYYY/MM/DD
    const dateMatch = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})(?:日)?/.exec(cleanDate);
    if (!dateMatch) return null;

    const y = Number.parseInt(dateMatch[1], 10);
    const m = Number.parseInt(dateMatch[2], 10);
    const d = Number.parseInt(dateMatch[3], 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;

    let hour = 0;
    let min = 0;
    let sec = 0;

    const cleanTime = typeof timeStr === 'string' ? timeStr.trim() : '';
    if (cleanTime) {
        const timeMatch = /^(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?/.exec(cleanTime);
        if (timeMatch) {
            hour = Number.parseInt(timeMatch[1], 10);
            min = Number.parseInt(timeMatch[2], 10);
            sec = timeMatch[3] ? Number.parseInt(timeMatch[3], 10) : 0;
            if (hour < 0 || hour > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) {
                return null;
            }
        }
    }

    const ts = Date.UTC(y, m - 1, d, hour, min, sec);
    return Number.isFinite(ts) ? ts : null;
}

/**
 * 校验两个剧情时钟的对齐情况。
 * 纯函数，不抛、不改写入参、返回值键面恒定。
 *
 * @param {object|null} phoneClock { date?: string, time?: string, timestamp?: number }
 * @param {object|null} memoryClock { date?: string, time?: string, timestamp?: number }
 * @param {object} [options]
 * @returns {{
 *   state: 'aligned'|'skewed'|'unavailable',
 *   verdict: string,
 *   minutes: number|null,
 *   direction: 'exact'|'phone-ahead'|'memory-ahead'|'unknown',
 *   reason: string,
 *   phoneText: string,
 *   memoryText: string,
 *   label: string
 * }}
 */
export function checkClockAlignment(phoneClock, memoryClock, options = {}) {
    const skewThresholdMinutes = numOrNull(options?.thresholdMinutes) ?? 0;

    // 1. 检查手机侧时钟输入
    if (!phoneClock || typeof phoneClock !== 'object') {
        return {
            state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            minutes: null,
            direction: 'unknown',
            reason: 'no-phone-clock',
            phoneText: '',
            memoryText: '',
            label: '时钟对齐：读不到（手机剧情时钟缺失）'
        };
    }

    // 2. 检查记忆侧时钟输入
    if (!memoryClock || typeof memoryClock !== 'object') {
        return {
            state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            minutes: null,
            direction: 'unknown',
            reason: 'no-memory-clock',
            phoneText: String(phoneClock.date || phoneClock.timestamp || ''),
            memoryText: '',
            label: '时钟对齐：读不到（记忆插件剧情时钟缺失）'
        };
    }

    const pDate = String(phoneClock.date || '').trim();
    const pTime = String(phoneClock.time || '').trim();
    const pStamp = numOrNull(phoneClock.timestamp);

    const mDate = String(memoryClock.date || '').trim();
    const mTime = String(memoryClock.time || '').trim();
    const mStamp = numOrNull(memoryClock.timestamp);

    const phoneText = [pDate, pTime].filter(Boolean).join(' ') || (pStamp !== null ? String(pStamp) : '');
    const memoryText = [mDate, mTime].filter(Boolean).join(' ') || (mStamp !== null ? String(mStamp) : '');

    if (!phoneText) {
        return {
            state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            minutes: null,
            direction: 'unknown',
            reason: 'phone-clock-empty',
            phoneText: '',
            memoryText,
            label: '时钟对齐：读不到（手机端时间为空）'
        };
    }

    if (!memoryText) {
        return {
            state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            minutes: null,
            direction: 'unknown',
            reason: 'memory-clock-empty',
            phoneText,
            memoryText: '',
            label: '时钟对齐：读不到（记忆端时间为空）'
        };
    }

    // 3. 计算时间戳
    let pTs = (pStamp !== null && pStamp > 0) ? pStamp : parseClockToTimestamp(pDate, pTime);
    let mTs = (mStamp !== null && mStamp > 0) ? mStamp : parseClockToTimestamp(mDate, mTime);

    // 4. 若无法计算确定时间戳（例如架空纪元或非标文本），尝试字符串字面相等性
    if (pTs === null || mTs === null) {
        if (pDate === mDate && (!pTime || !mTime || pTime === mTime)) {
            return {
                state: CLOCK_ALIGNMENT_STATES.ALIGNED,
                verdict: CLOCK_ALIGNMENT_STATES.ALIGNED,
                minutes: 0,
                direction: 'exact',
                reason: 'exact-text-match',
                phoneText,
                memoryText,
                label: '时钟对齐：一致'
            };
        }
        return {
            state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            minutes: null,
            direction: 'unknown',
            reason: 'unparsable-time-format',
            phoneText,
            memoryText,
            label: '时钟对齐：读不到（时间格式不可比）'
        };
    }

    // 5. 分钟偏差计算
    const diffMs = pTs - mTs;
    const diffMinutes = Math.round(diffMs / 60000);
    const absMinutes = Math.abs(diffMinutes);

    if (absMinutes <= skewThresholdMinutes) {
        return {
            state: CLOCK_ALIGNMENT_STATES.ALIGNED,
            verdict: CLOCK_ALIGNMENT_STATES.ALIGNED,
            minutes: 0,
            direction: 'exact',
            reason: 'aligned',
            phoneText,
            memoryText,
            label: '时钟对齐：一致'
        };
    }

    const direction = diffMinutes > 0 ? 'phone-ahead' : 'memory-ahead';
    return {
        state: CLOCK_ALIGNMENT_STATES.SKEWED,
        verdict: CLOCK_ALIGNMENT_STATES.SKEWED,
        minutes: absMinutes,
        direction,
        reason: 'clock-skewed',
        phoneText,
        memoryText,
        label: `时钟对齐：偏差 ${absMinutes} 分钟`
    };
}

/**
 * 从当前宿主环境中探测双仓剧情时钟并核对对齐情况。
 * 纯读取操作，不向宿主或插件写入任何状态。
 *
 * @param {object} [win] 宿主 window，缺省回退到当前全局
 * @returns {object} 对齐结论对象
 */
export function probeCrossRepoClockAlignment(win) {
    const w = (win && typeof win === 'object') ? win : ((typeof window !== 'undefined') ? window : null);
    if (!w) {
        return {
            state: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            verdict: CLOCK_ALIGNMENT_STATES.UNAVAILABLE,
            minutes: null,
            direction: 'unknown',
            reason: 'no-window',
            phoneText: '',
            memoryText: '',
            label: '时钟对齐：读不到（宿主环境不存在）'
        };
    }

    // 手机侧剧情钟提取
    let phoneClock = null;
    try {
        const sn = storyNow(w);
        if (sn && sn.ok) {
            phoneClock = {
                date: sn.date,
                time: sn.time,
                timestamp: sn.ms
            };
        } else {
            const tm = w.VirtualPhone?.timeManager;
            const cur = tm?.getCurrentStoryTime?.();
            if (cur && typeof cur === 'object') {
                phoneClock = {
                    date: String(cur.date || ''),
                    time: String(cur.time || ''),
                    timestamp: numOrNull(cur.timestamp)
                };
            }
        }
    } catch (_e) {
        phoneClock = null;
    }

    // 记忆插件侧剧情钟提取
    let memoryClock = null;
    try {
        const probe = readPushProbe(w);
        if (probe && probe.hasSnapshot && probe.snapshot) {
            const field = readPushField(probe.snapshot, 'clock');
            if (field && field.present && field.value) {
                const val = field.value;
                if (typeof val === 'object') {
                    memoryClock = {
                        date: String(val.date || val.storyDate || ''),
                        time: String(val.time || val.storyTime || ''),
                        timestamp: numOrNull(val.timestamp)
                    };
                } else if (typeof val === 'string') {
                    memoryClock = {
                        date: val.trim(),
                        time: '',
                        timestamp: null
                    };
                }
            }
        }
        // 若快照暂无或未刷新，探寻 lonshaBridge 上缓存的剧情时钟
        if (!memoryClock && w.VirtualPhone?.lonshaBridge) {
            const lb = w.VirtualPhone.lonshaBridge;
            if (typeof lb.getClockSnapshot === 'function') {
                memoryClock = lb.getClockSnapshot();
            } else if (lb._lastClock && typeof lb._lastClock === 'object') {
                memoryClock = {
                    date: String(lb._lastClock.date || ''),
                    time: String(lb._lastClock.time || ''),
                    timestamp: numOrNull(lb._lastClock.timestamp)
                };
            }
        }
    } catch (_e) {
        memoryClock = null;
    }
    return checkClockAlignment(phoneClock, memoryClock);
}
