/* ========================================================
 * focus-view.js — [v3.21.0] 番茄钟 App 视图
 * 归因卡 + 统计卡 + 任务列表 + 新建表单 + 专注屏 + 设置卡
 *
 * 与 clock-view 同纪律：归因文案表的键取 FOCUS_REASONS 的**值**（连字符形），
 *   不另写一套下划线形 —— 否则查不到会静默走兜底，多种处境显示成同一句话。
 * ======================================================== */

import { FOCUS_REASONS, formatDuration } from './focus-data.js';

const FACE_META = {
    [FOCUS_REASONS.ready]: { icon: '\u23f1\ufe0f', label: '可以开工', tone: 'ok' },
    [FOCUS_REASONS.no_tasks]: { icon: '\u2615', label: '还没有专注任务', tone: 'warn' },
    [FOCUS_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};

export class FocusView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        this._timerEl = null;
    }

    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'fc-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }

    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    /** 每秒只改计时文本，不整页重画（否则正在输入的任务名会被擦掉）。 */
    tick() {
        if (!this._timerEl || !this._timerEl.isConnected) {
            this._timerEl = this._root ? this._root.querySelector('.fc-timer') : null;
        }
        if (this._timerEl) this._timerEl.textContent = this._fmtClock(this.app.displaySeconds());
    }

    _fmtClock(sec) {
        const s = Math.max(0, Math.round(sec || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }

    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const stats = app.projection();
        const parts = [];

        parts.push('<div class="fc-header"><h2>\u23f1\ufe0f 番茄钟</h2></div>');

        // 归因卡
        parts.push('<div class="fc-face fc-face-' + meta.tone + '">');
        parts.push('<span class="fc-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="fc-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        // 统计卡（有记录才出）
        if (stats && stats.hasHistory) {
            parts.push('<div class="fc-stats">');
            parts.push('<div class="fc-stat-row"><span>今日专注</span><span>' + this._esc(this.app.summaryLine()) + '</span></div>');
            parts.push('<div class="fc-stat-row"><span>累计</span><span>' + stats.totalSessions + ' 次 · ' + this._esc(this._dur(stats.totalSeconds)) + '</span></div>');
            parts.push('<div class="fc-stat-row"><span>单次平均</span><span>' + this._esc(this._dur(stats.avgSessionSeconds)) + '</span></div>');
            if (stats.bestDaySeconds > 0) {
                parts.push('<div class="fc-stat-row"><span>最佳单日</span><span>' + this._esc(this._dur(stats.bestDaySeconds)) + '</span></div>');
            }
            parts.push('</div>');
        }

        // 专注屏（有当前任务才出）
        const cur = app.currentTask();
        if (cur) {
            parts.push('<div class="fc-focus">');
            parts.push('<div class="fc-focus-name">' + this._esc(cur.name) + '</div>');
            parts.push('<div class="fc-timer">' + this._fmtClock(app.displaySeconds()) + '</div>');
            parts.push('<div class="fc-focus-meta">');
            parts.push('<span class="fc-chip">' + (cur.mode === 'stopwatch' ? '正计时' : '倒计时 ' + cur.duration + ' 分') + '</span>');
            parts.push('<span class="fc-chip">分心 ' + app.pokeCount() + ' 次</span>');
            parts.push('</div>');
            parts.push('<div class="fc-focus-actions">');
            if (app.isRunning()) {
                parts.push('<button class="fc-btn" id="fc-pause">暂停</button>');
            } else {
                parts.push('<button class="fc-btn" id="fc-resume">继续</button>');
            }
            parts.push('<button class="fc-btn fc-btn-ghost" id="fc-poke">戳一下</button>');
            parts.push('<button class="fc-btn" id="fc-finish">' + (cur.mode === 'stopwatch' ? '结束并记录' : '提前结束') + '</button>');
            parts.push('<button class="fc-btn fc-btn-danger" id="fc-giveup">放弃</button>');
            parts.push('</div>');
            parts.push('</div>');
        }

        // 任务列表
        const tasks = app.taskList();
        if (tasks.length > 0) {
            parts.push('<div class="fc-tasks">');
            for (const t of tasks) {
                parts.push('<div class="fc-task" data-id="' + this._esc(t.id) + '">');
                parts.push('<div class="fc-task-info">');
                parts.push('<div class="fc-task-name">' + this._esc(t.name) + '</div>');
                parts.push('<div class="fc-task-detail">' + (t.mode === 'stopwatch' ? '正计时' : t.duration + ' 分钟') + '</div>');
                parts.push('</div>');
                parts.push('<div class="fc-task-actions">');
                parts.push('<button class="fc-mini fc-start">开始</button>');
                parts.push('<button class="fc-mini fc-del">删除</button>');
                parts.push('</div>');
                parts.push('</div>');
            }
            parts.push('</div>');
        }

        // 新建任务
        parts.push('<div class="fc-create">');
        parts.push('<h3>\u2795 新建专注任务</h3>');
        parts.push('<input class="fc-input" id="fc-name" type="text" maxlength="40" placeholder="任务名称（如：写代码 / 背单词）">');
        parts.push('<div class="fc-mode">');
        parts.push('<label class="fc-radio"><input type="radio" name="fc-mode" value="countdown" checked><span>倒计时</span></label>');
        parts.push('<label class="fc-radio"><input type="radio" name="fc-mode" value="stopwatch"><span>正计时</span></label>');
        parts.push('</div>');
        parts.push('<div class="fc-pills" id="fc-pills">');
        for (const d of this.app.durations()) {
            parts.push('<button class="fc-pill' + (d === this.app.settings.duration ? ' is-active' : '') + '" data-duration="' + d + '">' + d + ' 分</button>');
        }
        parts.push('</div>');
        parts.push('<button class="fc-btn fc-btn-primary" id="fc-add">创建任务</button>');
        parts.push('</div>');

        // 设置
        parts.push('<div class="fc-settings">');
        parts.push('<h3>\u2699\ufe0f 设置</h3>');
        parts.push('<label class="fc-toggle"><input type="checkbox" id="fc-inject" ' + (this.app.settings.injectToPrompt ? 'checked' : '') + '><span>专注进度注入 Prompt</span></label>');
        parts.push('<label class="fc-field"><span>每日目标（分钟）</span><input type="number" id="fc-goal" min="1" max="1440" value="' + this.app.settings.dailyGoalMinutes + '"></label>');
        parts.push('<label class="fc-field"><span>鼓励间隔（分钟）</span><input type="number" id="fc-enc" min="1" max="1440" value="' + this.app.settings.encouragementMinutes + '"></label>');
        parts.push('<label class="fc-field"><span>分心上限（次）</span><input type="number" id="fc-poke-limit" min="0" max="999" value="' + this.app.settings.pokeLimit + '"></label>');
        parts.push('<div class="fc-hint">读完不落盘、不自动发消息：番茄钟只记时长，注入只给事实。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }

    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);

        const addBtn = q('#fc-add');
        if (addBtn) addBtn.addEventListener('click', () => {
            const input = q('#fc-name');
            const name = input ? input.value : '';
            const modeEl = this._root.querySelector('input[name="fc-mode"]:checked');
            const mode = modeEl ? modeEl.value : 'countdown';
            const active = this._root.querySelector('.fc-pill.is-active');
            const duration = active ? parseInt(active.dataset.duration, 10) : this.app.settings.duration;
            const t = app.addTask(name, mode, duration);
            if (!t) {
                if (input) input.classList.add('is-error');
                return;
            }
            if (input) { input.value = ''; input.classList.remove('is-error'); }
            this.refresh();
        });

        for (const pill of this._root.querySelectorAll('.fc-pill')) {
            pill.addEventListener('click', () => {
                for (const p of this._root.querySelectorAll('.fc-pill')) p.classList.remove('is-active');
                pill.classList.add('is-active');
            });
        }

        for (const row of this._root.querySelectorAll('.fc-task')) {
            const id = row.dataset.id;
            const startBtn = row.querySelector('.fc-start');
            const delBtn = row.querySelector('.fc-del');
            if (startBtn) startBtn.addEventListener('click', () => { app.start(id); this.refresh(); });
            if (delBtn) delBtn.addEventListener('click', () => { app.removeTask(id); this.refresh(); });
        }

        const pauseBtn = q('#fc-pause');
        if (pauseBtn) pauseBtn.addEventListener('click', () => { app.pause(); this.refresh(); });
        const resumeBtn = q('#fc-resume');
        if (resumeBtn) resumeBtn.addEventListener('click', () => { app.resume(); this.refresh(); });
        const pokeBtn = q('#fc-poke');
        if (pokeBtn) pokeBtn.addEventListener('click', () => { app.poke(); this.refresh(); });
        const finishBtn = q('#fc-finish');
        if (finishBtn) finishBtn.addEventListener('click', () => { app.finish(); this.refresh(); });
        const giveUpBtn = q('#fc-giveup');
        if (giveUpBtn) giveUpBtn.addEventListener('click', () => { app.giveUp(); this.refresh(); });

        const inject = q('#fc-inject');
        if (inject) inject.addEventListener('change', (e) => {
            app.settings = { ...app.settings, injectToPrompt: e.target.checked };
            app.saveSettings();
        });
        const goal = q('#fc-goal');
        if (goal) goal.addEventListener('change', (e) => {
            app.settings = { ...app.settings, dailyGoalMinutes: parseInt(e.target.value, 10) || app.settings.dailyGoalMinutes };
            app.saveSettings();
        });
        const enc = q('#fc-enc');
        if (enc) enc.addEventListener('change', (e) => {
            app.settings = { ...app.settings, encouragementMinutes: parseInt(e.target.value, 10) || app.settings.encouragementMinutes };
            app.saveSettings();
        });
        const pokeLimit = q('#fc-poke-limit');
        if (pokeLimit) pokeLimit.addEventListener('change', (e) => {
            app.settings = { ...app.settings, pokeLimit: parseInt(e.target.value, 10) || 0 };
            app.saveSettings();
        });

        this._timerEl = q('.fc-timer');
    }

    _dur(s) {
        return formatDuration(s);
    }

    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}