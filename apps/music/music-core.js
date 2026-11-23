/* ============================================================
 * music-core.js — [v4.190.0] 音乐 · 歌词解析与播放模式的纯函数内核
 * ------------------------------------------------------------
 * 从 apps/music/music-data.js 那 1514 行类里抽出来的**可纯化部分**：
 *   源的 _parseLrc（LRC 文本 -> 时间轴歌词行）+ getPlaybackMode /
 *   setPlaybackMode / cyclePlaybackMode 一族的模式判定。
 *   —— 全是「给定输入 -> 给定结论」，不碰 Audio、不碰存储、不碰 DOM。
 * ------------------------------------------------------------
 * 为什么只抽这两块：MusicData 那个类**构造器里就造了音频元素**，还持
 *   _playlist / _favorites 懒加载、_lyricCache Map、_failedSongs Map、
 *   recycleBin 恢复器、以及十来个 fetch 音乐源的 Promise。那是**有副作用**的
 *   编排，不能也不该整只搬。但歌词解析与播放模式判定是纯的，值得单独钉住。
 * ------------------------------------------------------------
 * 刻意不做：不持状态、不改入参、不碰 Audio / fetch / storage。
 * ============================================================ */

/** 播放模式封闭词表：认不出就落到 once（不是悄悄记住一个坏值）。 */
export const PLAYBACK_MODES = Object.freeze(['once', 'repeat-one', 'repeat-all']);

/** 模式中文名（视图用）。 */
export const PLAYBACK_MODE_LABELS = Object.freeze({
    once: '顺序播放',
    'repeat-one': '单曲循环',
    'repeat-all': '列表循环'
});

/** 模式 -> 图标（视图用）。 */
export const PLAYBACK_MODE_ICONS = Object.freeze({
    once: '▶',
    'repeat-one': '🔂',
    'repeat-all': '🔁'
});

/** 拒绝原因。 */
export const MUSIC_REJECT = Object.freeze({
    unknownMode: 'unknown_mode',
    emptyText: 'empty_text',
    badLine: 'bad_line'
});

/** LRC 一行的时间戳上限（一行里出现几百个时间戳是坏档，不无限吃）。 */
export const LRC_LIMITS = Object.freeze({
    maxStampsPerLine: 16,
    maxLines: 4000
});

/* ---------- 1. 播放模式 ---------- */

/** 模式认得吗。 */
export function isPlaybackMode(mode) {
    return typeof mode === 'string' && PLAYBACK_MODES.indexOf(mode) >= 0;
}

/** 归一播放模式：认不出归 once（不留坏值）。 */
export function normalizePlaybackMode(mode) {
    return isPlaybackMode(mode) ? mode : 'once';
}

/** 按一次模式按钮后该到哪个模式（once -> repeat-one -> repeat-all -> once）。 */
export function nextPlaybackMode(mode) {
    const cur = normalizePlaybackMode(mode);
    const i = PLAYBACK_MODES.indexOf(cur);
    return PLAYBACK_MODES[(i + 1) % PLAYBACK_MODES.length];
}

/** 「单曲循环」开关与模式的双向映射（旧设置项迁移用）。 */
export function modeFromRepeatOne(enabled) {
    return (enabled === true || enabled === 'true') ? 'repeat-one' : 'repeat-all';
}

/** 这个模式要不要让 audio 元素 loop。 */
export function shouldLoop(mode) {
    return normalizePlaybackMode(mode) === 'repeat-one';
}

/* ---------- 2. 歌词解析 ---------- */

/**
 * LRC 文本 -> 时间轴歌词行 [{ t, txt }]，按 t 升序。
 *   - 一行可以有多个时间戳（[00:12.00][01:30.00]副歌），每个都成一条；
 *   - 没有时间戳的行、剥完时间戳就空的行，一律丢（元数据行如 [ar:xx] 因此自然被剔掉）；
 *   - t 支持 mm:ss 与 mm:ss.fff；只有分秒没有小数也认；
 *   - 坏档（不是字符串 / 空）返回 []，不抛。
 */
export function parseLrc(text) {
    const src = String(text == null ? '' : text);
    if (!src) return [];
    const lines = [];
    const raw = src.split(/\r?\n/);
    const cap = Math.min(raw.length, LRC_LIMITS.maxLines);
    for (let i = 0; i < cap; i += 1) {
        const line = String(raw[i] || '').trim();
        if (!line) continue;
        const stamps = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\]/g);
        if (!stamps || !stamps.length) continue;
        if (stamps.length > LRC_LIMITS.maxStampsPerLine) continue;
        const lyricText = line.replace(/\[(\d+):(\d+)(?:\.(\d+))?\]/g, '').trim();
        if (!lyricText) continue;
        for (const stamp of stamps) {
            const m = /\[(\d+):(\d+)(?:\.(\d+))?\]/.exec(stamp);
            if (!m) continue;
            const minutes = parseInt(m[1], 10);
            const seconds = parseInt(m[2], 10);
            const fraction = m[3] ? parseFloat('0.' + m[3]) : 0;
            if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
            lines.push({ t: minutes * 60 + seconds + fraction, txt: lyricText });
        }
    }
    return lines.sort((a, b) => a.t - b.t);
}

/**
 * 当前该高亮哪一句歌词。返回索引（没有可用的返回 -1）。
 *   nowSec 由调用方给（来自 audio.currentTime，内核不碰 Audio）。
 */
export function currentLyricIndex(lyrics, nowSec) {
    if (!Array.isArray(lyrics) || !lyrics.length) return -1;
    const t = Number(nowSec);
    if (!Number.isFinite(t) || t < 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i += 1) {
        const at = Number(lyrics[i] && lyrics[i].t);
        if (!Number.isFinite(at) || at > t) break;
        idx = i;
    }
    return idx;
}

/** 歌词是否为空（空态判定：没歌词就不画歌词面板）。 */
export function hasLyrics(lyrics) {
    return Array.isArray(lyrics) && lyrics.length > 0;
}

export default {
    PLAYBACK_MODES, PLAYBACK_MODE_LABELS, PLAYBACK_MODE_ICONS, MUSIC_REJECT, LRC_LIMITS,
    isPlaybackMode, normalizePlaybackMode, nextPlaybackMode, modeFromRepeatOne,
    shouldLoop, parseLrc, currentLyricIndex, hasLyrics
};