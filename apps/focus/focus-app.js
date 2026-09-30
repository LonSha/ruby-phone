/* ========================================================
 * focus-app.js — [v3.21.0] 番茄钟 App 控制器
 * 照抄 clock-app 规格：取数 → 投影 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xINOVO（js/modules/pomodoro.js）。源文件的操作面远大于本仓能承载的：
 *   它自带 AI 请求（getPomodoroAiReply 直接 fetch 角色 API 让人物发鼓励消息）、
 *   往聊天记录里塞消息（chat.history.push）、世界书拼装、图片压缩上传。
 * 本仓这些各有归属（微信/日记/剧场负责发消息，记忆插件负责上下文），
 *   故此处只取**计时器本身与它的统计**：建任务 → 专注 → 记账 → 注入事实。
 *   不替用户发任何消息，不碰任何角色会话数据。
 * ======================================================== */

import {
    FOCUS_REASONS, DURATION_PRESETS,
    defaultFocusSettings, normalizeFocusSettings,
    normalizeTask, normalizeSession,
    readFocusFace, projectFocusStats, formatDuration,
    focusRecordLine, focusPromptBlock,
} from './focus-data.js';
import { FocusView } from './focus-view.js';

const SETTINGS_KEY = 'focus_settings';
const TASKS_KEY = 'focus_tasks';
const SESSIONS_KEY = 'focus_sessions';
/* 只保留最近 200 次记录：聚合只看最近，长尾没有价值，留着只会撑存档。 */
const SESSION_KEEP = 200;

export class FocusApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultFocusSettings() };
        this.tasks = [];
        this.sessions = [];
        this.face = FOCUS_REASONS.storage_absent;
        this.stats = null;
        /* 运行态（不落盘）：本轮专注的真实秒数由墙钟算，倒计时显示走 deadline。 */
        this._running = false;
        this._paused = false;
        this._pausedRemain = 0;
        this._current = null;
        this._deadline = 0;
        this._sessionSeconds = 0;
        this._pokes = 0;
        this._tickTimer = null;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /* ---------- 取数 ---------- */

    /** 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。 */
    probe() {
        let storageOk = !!this.storage;
        try {
            const rawT = this.storage ? this.storage.get(TASKS_KEY) : null;
            const rawS = this.storage ? this.storage.get(SESSIONS_KEY) : null;
            this.tasks = this._parseTasks(rawT);
            this.sessions = this._parseSessions(rawS);
        } catch (_e) {
            storageOk = false;
            this.tasks = [];
            this.sessions = [];
        }
        this.face = readFocusFace({ storageOk, tasks: this.tasks });
        this.stats = projectFocusStats(this.sessions, Date.now());
    }

    _parseTasks(raw) {
        let arr = raw;
        if (typeof raw === 'string') {
            try { arr = JSON.parse(raw); } catch (_e) { return []; }
        }
        if (!Array.isArray(arr)) return [];
        return arr.map((t) => normalizeTask(t)).filter(Boolean);
    }

    _parseSessions(raw) {
        let arr = raw;
        if (typeof raw === 'string') {
            try { arr = JSON.parse(raw); } catch (_e) { return []; }
        }
        if (!Array.isArray(arr)) return [];
        return arr.map((s) => normalizeSession(s)).filter(Boolean);
    }

    faceReason() { return this.face; }
    projection() { return this.stats; }
    taskList() { return this.tasks.slice(); }

    /* ---------- 任务增删 ---------- */

    addTask(name, mode, duration) {
        const t = normalizeTask({ name, mode, duration, createdAt: Date.now() });
        if (!t) return null;
        this.tasks.push(t);
        this.saveTasks();
        return t;
    }

    removeTask(taskId) {
        const before = this.tasks.length;
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        if (this.tasks.length !== before) this.saveTasks();
    }

    saveTasks() {
        try {
            if (this.storage) this.storage.set(TASKS_KEY, this.tasks);
        } catch (_e) { /* silent */ }
    }

    saveSessions() {
        try {
            if (!this.storage) return;
            const trimmed = this.sessions.slice(-SESSION_KEEP);
            this.sessions = trimmed;
            this.storage.set(SESSIONS_KEY, trimmed);
        } catch (_e) { /* silent */ }
    }

    /* ---------- 计时 ---------- */

    currentTask() { return this._current; }
    isRunning() { return this._running; }
    isPaused() { return this._paused; }
    pokeCount() { return this._pokes; }
    sessionSeconds() { return this._sessionSeconds; }

    /** 剩余秒数（倒计时）或已过秒数（正计时）。墙钟口径，不靠 tick 累加。 */
    displaySeconds() {
        if (!this._current) return 0;
        if (this._current.mode === 'countdown') {
            if (!this._running) return Math.max(0, Math.round(this._pausedRemain));
            return Math.max(0, Math.ceil((this._deadline - Date.now()) / 1000));
        }
        if (!this._running) return Math.max(0, Math.round(this._pausedRemain));
        return Math.max(0, Math.round((Date.now() - this._deadline) / 1000));
    }

    start(taskId) {
        const task = this.tasks.find((t) => t.id === taskId);
        if (!task) return false;
        this._current = task;
        this._sessionSeconds = 0;
        this._pokes = 0;
        this._paused = false;
        this._running = true;
        if (task.mode === 'countdown') {
            this._deadline = Date.now() + task.duration * 60000;
            this._pausedRemain = task.duration * 60;
        } else {
            this._deadline = Date.now();
            this._pausedRemain = 0;
        }
        this._startTick();
        if (this._view) this._view.refresh();
        return true;
    }

    pause() {
        if (!this._running) return;
        // 先把本轮真实秒数结算掉，再冻结显示值。
        this._sessionSeconds += this._elapsedSinceDeadline();
        this._pausedRemain = this.displaySeconds();
        this._running = false;
        this._paused = true;
        this._stopTick();
        if (this._view) this._view.refresh();
    }

    resume() {
        if (!this._current || this._running) return;
        this._running = true;
        if (this._current.mode === 'countdown') {
            this._deadline = Date.now() + this._pausedRemain * 1000;
        } else {
            this._deadline = Date.now() - this._pausedRemain * 1000;
        }
        this._startTick();
        if (this._view) this._view.refresh();
    }

    /** 用户点「戳一下」——只记数，不发任何请求（源在此处会去调角色 API）。 */
    poke() {
        if (!this._running) return;
        this._pokes += 1;
        if (this._view) this._view.refresh();
    }

    /** 结束本轮并记账。countdown 到点自动调用；stopwatch 由用户点「结束」调用。 */
    finish() {
        if (!this._current) return;
        if (this._running) this._sessionSeconds += this._elapsedSinceDeadline();
        const rec = normalizeSession({
            taskId: this._current.id,
            name: this._current.name,
            seconds: this._sessionSeconds,
            pokes: this._pokes,
            finishedAt: Date.now(),
        });
        if (rec) {
            this.sessions.push(rec);
            this.saveSessions();
        }
        this._stopTick();
        this._running = false;
        this._paused = false;
        this._current = null;
        this._sessionSeconds = 0;
        this._pokes = 0;
        this.probe();
        if (this._view) this._view.refresh();
    }

    /** 放弃：不记账，直接回列表（源同义，但它要用户 confirm，本仓由视图弹确认）。 */
    giveUp() {
        this._stopTick();
        this._running = false;
        this._paused = false;
        this._current = null;
        this._sessionSeconds = 0;
        this._pokes = 0;
        if (this._view) this._view.refresh();
    }

    _elapsedSinceDeadline() {
        if (!this._current) return 0;
        /* 本轮墙钟长度 - 已计入的秒数既不稳，直接按模式算：倒计时看消耗，正计时看走过。 */
        if (this._current.mode === 'countdown') {
            const consumed = this._current.duration * 60 - Math.max(0, Math.ceil((this._deadline - Date.now()) / 1000));
            return Math.max(0, Math.round(consumed) - Math.round(this._sessionSeconds));
        }
        const walked = Math.max(0, Math.round((Date.now() - this._deadline) / 1000));
        return Math.max(0, walked - Math.round(this._sessionSeconds));
    }

    _startTick() {
        this._stopTick();
        const win = this._win();
        const setI = (typeof win.setInterval === 'function') ? win.setInterval.bind(win) : setInterval;
        this._tickTimer = setI(() => {
            if (!this._running) return;
            if (this._current && this._current.mode === 'countdown' && this.displaySeconds() <= 0) {
                this.finish();
                return;
            }
            if (this._view) this._view.tick();
        }, 1000);
    }

    _stopTick() {
        if (this._tickTimer === null || this._tickTimer === undefined) return;
        const win = this._win();
        const clearI = (typeof win.clearInterval === 'function') ? win.clearInterval.bind(win) : clearInterval;
        try { clearI(this._tickTimer); } catch (_e) { /* silent */ }
        this._tickTimer = null;
    }

    /* ---------- 注入 ---------- */

    /** 生成侧注入块：只注入聚合事实（见 focus-data.focusPromptBlock）。 */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        return focusPromptBlock(this.stats, this.settings);
    }

    summaryLine() {
        if (!this.stats || !this.stats.hasHistory) return '还没有专注记录';
        return '今日 ' + formatDuration(this.stats.todaySeconds) + ' · 连续 ' + this.stats.streakDays + ' 天';
    }

    recordLine() {
        if (!this.stats || !this.stats.latest) return '';
        return focusRecordLine(this.stats.latest);
    }

    durations() { return DURATION_PRESETS.slice(); }

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

    /* ---------- 生命周期 ---------- */

    /** 换会话：番茄钟是「我的」时间，不随角色走，故只重取读数、不动计时。 */
    onChatChanged() {
        this.probe();
        if (this._view) this._view.refresh();
    }

    /** App 切走时把计时器掐掉，别让 interval 在后台空转。 */
    deactivate() {
        this._stopTick();
        this._running = false;
        this._paused = true;
        if (this._current) this._pausedRemain = this.displaySeconds();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new FocusView(this, this.shell, this.storage);
        }
        this._view.render();
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizeFocusSettings(obj);
        } catch (_e) { this.settings = { ...defaultFocusSettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }
}