/* ========================================================
 * music-core-app.js — [v4.190.0] 音乐 歌词/播放模式 · 控制器
 *
 * 职责：把 music-core.js 的纯函数接到「一段 LRC 怎么变成时间轴歌词」
 *   与「播放模式怎么循环」这两件上。给一个可试算的面。
 * 为什么不动 music-data.js 那个 1514 行的类：MusicData 构造器里就
 *   new Audio()，还持 _playlist/_favorites 懒加载、_lyricCache Map、
 *   recycleBin 恢复器、十来个 fetch 音乐源 Promise——是有副作用的编排。
 *   本件只包纯逻辑面。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    parseLrc, currentLyricIndex, hasLyrics,
    normalizePlaybackMode, nextPlaybackMode, shouldLoop, modeFromRepeatOne,
    PLAYBACK_MODES, PLAYBACK_MODE_LABELS, PLAYBACK_MODE_ICONS, MUSIC_REJECT
} from './music-core.js';
import { numOrNull } from '../../config/num-gate.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'music_core_v1';

/** 判据用的固定进度（秒）：内核不碰 audio.currentTime，由调用方给。 */
const DEMO_SECONDS = 65;

const DEMO_LRC = [
    '[00:00.00]凌晨的面馆',
    '[00:12.50]灯还亮着',
    '[00:30.00]你喜欢的歌',
    '[00:30.00]副歌又来一遍',
    '[01:05.00]尾声'
].join('\n');

import { MusicCoreView } from './music-core-view.js';
export class MusicCoreApp {
    render() {
        this._view ??= new MusicCoreView(this, this.shell);
        this._view.render();
    }
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this._initFromStorage();
    }

    /**
     * 构造与换会话共用同一条重取路径（v4.199.0 从构造函数抽出，只为让 onChatChanged 不抄一份）。
     * 读的是**本会话**的存储快照，所以换会话 = 回构造态再读一次。
     */
    _initFromStorage() {
        this.lrcText = DEMO_LRC;
        this.mode = 'once';
        this.seconds = DEMO_SECONDS;
        this.lastOut = null;
        this._view = null;
        const snap = this._readSnapshot();
        if (snap) {
            this.lrcText = typeof snap.lrcText === 'string' ? snap.lrcText : this.lrcText;
            this.mode = normalizePlaybackMode(snap.mode);
            this.seconds = numOrNull(snap.seconds) == null ? this.seconds : numOrNull(snap.seconds);
        }
    }

    /**
     * [v4.199.0] 换会话：歌词与进度是**会话数据**（落盘键按会话隔离），
     * 不重取的话，上一会话的读数会原样出现在新会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this._initFromStorage();
    }


    _readSnapshot() {
        try {
            const raw = this.storage ? this.storage.get(STATE_KEY) : null;
            if (typeof raw !== 'string') return null;
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (_e) { return null; }
    }

    _saveSnapshot() {
        try {
            if (!this.storage) return false;
            const r = writeReceipt(this.storage, STATE_KEY, JSON.stringify({
                lrcText: this.lrcText, mode: this.mode, seconds: this.seconds
            }));
            return r.saved === true;
        } catch (_e) { return false; }
    }

    /** 歌词试算：LRC 文本 -> 时间轴行 + 当前该高亮哪一句。 */
    lrc(text) {
        const src = String(text == null ? '' : text);
        const lines = parseLrc(src);
        const idx = currentLyricIndex(lines, this.seconds);
        const out = {
            count: lines.length,
            has: hasLyrics(lines),
            index: idx,
            current: (idx >= 0 && lines[idx]) ? lines[idx].txt : '',
            lines: lines.slice(0, 12)
        };
        this.lrcText = src;
        this.lastOut = { kind: 'lrc', out };
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 把播放进度拨到某一句上（判据用：同一秒永远同一句）。 */
    seek(seconds) {
        const s = Number(seconds);
        if (!Number.isFinite(s) || s < 0) return { ok: false, reason: MUSIC_REJECT.badLine, out: null };
        this.seconds = s;
        return { ok: true, reason: null, out: { seconds: s } };
    }

    /** 模式循环：once -> repeat-one -> repeat-all -> once。 */
    cycle() {
        const before = normalizePlaybackMode(this.mode);
        const after = nextPlaybackMode(before);
        this.mode = after;
        const out = { before, after, loop: shouldLoop(after), label: PLAYBACK_MODE_LABELS[after], icon: PLAYBACK_MODE_ICONS[after] };
        this.lastOut = { kind: 'mode', out };
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 指定模式（认不出就拒，不悄悄落 once）。 */
    setMode(mode) {
        if (PLAYBACK_MODES.indexOf(String(mode)) < 0) {
            return { ok: false, reason: MUSIC_REJECT.unknownMode, out: null };
        }
        this.mode = String(mode);
        const out = { mode: this.mode, loop: shouldLoop(this.mode) };
        this.lastOut = { kind: 'mode', out };
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    /** 旧「单曲循环」布尔开关迁到新模式词表。 */
    migrate(enabled) {
        const mode = modeFromRepeatOne(enabled);
        const out = { enabled: enabled === true, mode, loop: shouldLoop(mode) };
        this.mode = mode;
        this.lastOut = { kind: 'migrate', out };
        this._saveSnapshot();
        return { ok: true, reason: null, out };
    }

    destroy() { this._view = null; }
}

export { parseLrc, currentLyricIndex, hasLyrics, normalizePlaybackMode, nextPlaybackMode, shouldLoop };
export default MusicCoreApp;
