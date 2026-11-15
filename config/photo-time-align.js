/* ========================================================
 * config/photo-time-align.js
 * RubyPhone R21-X4 · 照片 EXIF 与剧情时间校准（只读收敛面）
 *
 * 只把照片已有的 EXIF 拍摄时刻与唯一剧情钟摆在一起比较。
 * 不写照片、不写存储、不用导入时刻或墙钟补齐 EXIF 缺口。
 * ======================================================== */

import { numOrNull } from './num-gate.js';
import { storyNow } from './time-source.js';

export const PHOTO_TIME_VERDICTS = Object.freeze({
    ALIGNED: 'aligned',
    DRIFTED: 'drifted',
    NO_EXIF: 'no-exif',
    NO_EXIF_STAMP: 'no-exif-stamp',
    NO_STORY_CLOCK: 'no-story-clock'
});

/* 数值时间戳是本仓现有媒体索引的稳定形态；EXIF 字符串只接受 ISO/可被 Date.parse
 * 无歧义解释的值，不接受本地化散文，也不把它当成剧情时间重新推算。 */
export const EXIF_STAMP_FIELDS = Object.freeze([
    'timestamp', 'takenAt', 'DateTimeOriginal', 'dateTimeOriginal'
]);

function positiveMs(value) {
    const number = numOrNull(value);
    return number !== null && number > 0 ? number : null;
}

function exifMsOf(value) {
    const numeric = positiveMs(value);
    if (numeric !== null) return numeric;
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readExif(photo) {
    try {
        const exif = photo?.exif;
        return exif && typeof exif === 'object' && !Array.isArray(exif) ? exif : null;
    } catch (_error) {
        return null;
    }
}

function readExifStamp(photo) {
    const exif = readExif(photo);
    if (!exif) return { hasExif: false, field: '', ms: null };
    for (const field of EXIF_STAMP_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(exif, field)) continue;
        return { hasExif: true, field, ms: exifMsOf(exif[field]) };
    }
    return { hasExif: true, field: '', ms: null };
}

function safeStory(story) {
    if (!story || typeof story !== 'object') {
        return { ok: false, ms: null, reason: 'no-story-clock', source: '' };
    }
    const ms = positiveMs(story.ms);
    return {
        ok: story.ok === true && ms !== null,
        ms: story.ok === true && ms !== null ? ms : null,
        reason: String(story.reason == null ? '' : story.reason),
        source: String(story.source == null ? '' : story.source)
    };
}

/**
 * 纯函数：只读一张照片的 EXIF 与注入的剧情钟，不改入参。
 * `story` 应来自 `storyNow(win, {readOnly:true})`，便于测试和运行时边界复核。
 */
export function alignOne(photo, story) {
    const exif = readExifStamp(photo);
    const clock = safeStory(story);
    const result = {
        verdict: '',
        exifField: exif.field,
        exifMs: exif.ms,
        storyMs: clock.ms,
        driftMs: null,
        direction: '',
        storyReason: clock.reason,
        storySource: clock.source
    };

    if (!exif.hasExif) {
        result.verdict = PHOTO_TIME_VERDICTS.NO_EXIF;
        return result;
    }
    if (exif.ms === null) {
        result.verdict = PHOTO_TIME_VERDICTS.NO_EXIF_STAMP;
        return result;
    }
    if (clock.ms === null) {
        result.verdict = PHOTO_TIME_VERDICTS.NO_STORY_CLOCK;
        return result;
    }

    result.driftMs = exif.ms - clock.ms;
    if (result.driftMs === 0) {
        result.verdict = PHOTO_TIME_VERDICTS.ALIGNED;
        return result;
    }
    result.verdict = PHOTO_TIME_VERDICTS.DRIFTED;
    result.direction = result.driftMs > 0 ? 'after' : 'before';
    return result;
}

/** 读取整册的只读汇总；缺 EXIF 的照片保留在 rows 中，不静默丢弃。 */
export function alignAlbum(photos, win, options = {}) {
    const list = Array.isArray(photos) ? photos : [];
    const story = options?.story && typeof options.story === 'object'
        ? options.story
        : storyNow(win, { readOnly: true });
    const rows = list.map((photo, index) => ({
        index,
        id: typeof photo?.id === 'string' ? photo.id : '',
        ...alignOne(photo, story)
    }));
    const counts = Object.fromEntries(
        Object.values(PHOTO_TIME_VERDICTS).map(verdict => [verdict, 0])
    );
    let worstDrift = null;
    for (const row of rows) {
        counts[row.verdict] = (counts[row.verdict] || 0) + 1;
        if (row.driftMs !== null
            && (!worstDrift || Math.abs(row.driftMs) > Math.abs(worstDrift.driftMs))) {
            worstDrift = {
                index: row.index,
                id: row.id,
                driftMs: row.driftMs,
                direction: row.direction
            };
        }
    }
    const normalizedStory = safeStory(story);
    return {
        total: rows.length,
        story: normalizedStory,
        counts,
        worstDrift,
        rows
    };
}

function formatDelta(ms) {
    const absolute = Math.abs(Number(ms) || 0);
    if (absolute < 1000) return `${absolute} 毫秒`;
    const seconds = Math.round(absolute / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    return `${(minutes / 60).toFixed(1)} 小时`;
}

/** 视图只消费这一个文案出口，避免各 UI 自己解释缺失态。 */
export function photoTimeLabel(row) {
    const verdict = row?.verdict;
    if (verdict === PHOTO_TIME_VERDICTS.ALIGNED) return 'EXIF 与剧情钟一致';
    if (verdict === PHOTO_TIME_VERDICTS.DRIFTED) {
        return `EXIF ${row.direction === 'after' ? '晚于' : '早于'}剧情钟 · 偏差 ${formatDelta(row.driftMs)}`;
    }
    if (verdict === PHOTO_TIME_VERDICTS.NO_EXIF_STAMP) return '时间不详 · EXIF 没有可用拍摄时刻';
    if (verdict === PHOTO_TIME_VERDICTS.NO_EXIF) return '时间不详 · 没有 EXIF 拍摄时刻';
    if (verdict === PHOTO_TIME_VERDICTS.NO_STORY_CLOCK) return 'EXIF 可读 · 剧情钟暂不可用';
    return `时间状态未知 · ${String(verdict || 'unknown')}`;
}

export function photoTimeSelfCheck() {
    const story = { ok: true, ms: 1000, reason: 'ok', source: 'chat' };
    const cases = [
        [{ id: 'a', exif: { timestamp: 1000 } }, PHOTO_TIME_VERDICTS.ALIGNED],
        [{ id: 'b', exif: { timestamp: 900 } }, PHOTO_TIME_VERDICTS.DRIFTED],
        [{ id: 'c', exif: {} }, PHOTO_TIME_VERDICTS.NO_EXIF_STAMP],
        [{ id: 'd' }, PHOTO_TIME_VERDICTS.NO_EXIF],
        [{ id: 'e', exif: { timestamp: 1234 } }, PHOTO_TIME_VERDICTS.NO_STORY_CLOCK]
    ];
    const before = JSON.stringify(cases);
    const got = cases.map(([photo, expected]) => [alignOne(photo, story).verdict, expected]);
    const noClock = alignOne(cases[4][0], { ok: false, ms: null, reason: 'no-host' });
    return {
        ok: got.every(([actual, expected]) => actual === expected)
            && noClock.verdict === PHOTO_TIME_VERDICTS.NO_STORY_CLOCK
            && JSON.stringify(cases) === before
            && photoTimeLabel(alignOne({ exif: {} }, story)).startsWith('时间不详'),
        cases: got.map(([actual]) => actual),
        noClock: noClock.verdict
    };
}
