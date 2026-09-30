/* ========================================================
 * weather-app.js — [v3.27.0] 天气 App 控制器
 * 照抄 focus / piggy / punchcard / avatarframe / shop / block 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自两路源（见 weather-data 文件头）：xINOVO 的 `WeatherService`（角色一份 / 用户一份 + 24 小时时效）
 * 与 MyPhone 的 WMO 码表（码 → 中文说法 / 算不算下雨）。
 * 源那三处本仓不能有：自己发 `fetch`（四家 provider + open-meteo + nominatim）、自己拿定位、
 * 读别的 App 的 indexedDB。本件只做**本会话的天气记事**：谁在哪儿、什么天、几度、几时记的。
 * 零数据库、零网络、零定位、零定时器、零碰聊天历史。
 *
 * 【契约：天气事实从哪来】本件**不请求天气**。事实由两处进来：
 *   · 用户在这一页手填（城市 / 温度 / 天气码）；
 *   · 或宿主/别的模块读到之后调 `setSlot(...)` 塞进来。
 * 本件负责把码翻成人话、算清「这条是几时的」，再交给生成侧。
 * ======================================================== */
'use strict';
import {
    WEATHER_REASONS, WEATHER_SLOTS, WEATHER_LIMITS, WEATHER_KINDS,
    defaultWeatherSettings, normalizeWeatherSettings,
    normalizeWeatherState, emptyWeatherState,
    setObservation, clearObservation, clearAllObservations,
    readWeatherFace, projectWeather, weatherPromptBlock,
    describeCode, formatTempC,
} from './weather-data.js';
import { WeatherView } from './weather-view.js';

/* 会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^weather_/`，否则跨会话串味 */
const SETTINGS_KEY = 'weather_settings';
const STATE_KEY = 'weather_state';

export class WeatherApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultWeatherSettings() };
        this.state = emptyWeatherState();
        this.face = WEATHER_REASONS.storage_absent;
        this._proj = null;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }

    _writeJSON(key, v) {
        try {
            if (!this.storage) return false;
            this.storage.set(key, JSON.stringify(v));
            return true;
        } catch (_e) { return false; }
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            this.state = normalizeWeatherState(this._readJSON(STATE_KEY));
        } catch (_e) {
            storageOk = false;
            this.state = emptyWeatherState();
        }
        this.face = readWeatherFace({ storageOk, hasAny: this._any() });
        this._proj = storageOk ? projectWeather(this.state, this.settings, Date.now()) : null;
    }

    _any() {
        return WEATHER_SLOTS.some((s) => {
            const o = this.state[s] || {};
            return !!(o.city || o.tempC !== null || o.code !== null);
        });
    }

    faceReason() { return this.face; }
    projection() { return this._proj; }
    limits() { return WEATHER_LIMITS; }
    slots() { return WEATHER_SLOTS.slice(); }
    kinds() { return WEATHER_KINDS; }
    stateSnapshot() { return normalizeWeatherState(this.state); }
    /** 码 → 说法（视图给用户看「这个码是什么天」时用同一个口）。 */
    describe(code) { return describeCode(code); }
    tempText(v) { return formatTempC(v); }

    /* ---------- 记账 ---------- */

    /** 记一条观测（城市 / 温度 / 天气码，缺哪个留哪个）。返回 `{ok, error?}`。 */
    setSlot(slot, patch) {
        const r = setObservation(this.state, slot, patch, Date.now());
        if (!r.ok) return { ok: false, error: r.error || '没记上' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    clearSlot(slot) {
        const r = clearObservation(this.state, slot);
        if (!r.cleared) return { ok: false, error: '这个位置本来就是空的' };
        this.state = r.state;
        this._writeState();
        this.probe();
        return { ok: true };
    }

    clearAll() {
        const r = clearAllObservations(this.state);
        if (!r.cleared) return 0;
        this.state = r.state;
        this._writeState();
        this.probe();
        return r.cleared;
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入事实（见数据层 weatherPromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || projectWeather(this.state, this.settings, Date.now());
        return weatherPromptBlock(proj, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到天气';
        if (!p.hasAny) return '还没记过天气';
        const bits = [];
        for (const r of p.rows) {
            if (!r.has) continue;
            bits.push((r.slot === 'char' ? '角色' : '你') + '：' + r.desc + (r.tempText ? (' ' + r.tempText) : ''));
        }
        return bits.join(' · ') + (p.staleCount ? ('（' + p.staleCount + ' 条不是当下的）') : '');
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const ctx = this._win().SillyTavern && this._win().SillyTavern.getContext ? this._win().SillyTavern.getContext() : null;
            const es = ctx ? ctx.eventSource : null;
            const et = ctx ? ctx.event_types : null;
            if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const blk = this.promptBlock();
                    if (blk) payload.prompt.push({ role: 'system', content: blk });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hookBound = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /* ---------- 落盘 ---------- */

    _writeState() {
        this._writeJSON(STATE_KEY, this.state);
    }

    _loadSettings() {
        try {
            this.settings = normalizeWeatherSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultWeatherSettings() }; }
    }

    saveSettings() {
        this._writeJSON(SETTINGS_KEY, this.settings);
    }

    patchSettings(patch) {
        this.settings = normalizeWeatherSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：两个槽位都是「本会话的天气」，故全部重取。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new WeatherView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}