/* ========================================================
 * loverspace-app.js — [v3.30.0] 恋爱空间 App 控制器
 * 照抄 taobao / shop / widget 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xintuk（`runtime/scripts/lovers-space/`，四片 174001 字节 / 77 函数）。
 * 源把一个 `chat.loversSpaceData` 既当数据又当界面状态用（六件事挤在一起），
 * 逐条取舍写在 loverspace-data.js 的文件头（五块取 / 四处不缝 / 四条偏离）。
 * 这里只记**接线上的三件事**：
 *
 *  【① 不做实时定时器】
 *   源 `setInterval(updateLoversSpaceDaysCounter, 60*1000)` 每分钟重画一次页面。
 *   本件一个定时器都不转：`probe()` 每次现算「此刻应有的样子」，读数与页面在不在无关。
 *
 *  【② 不替宿主写楼层】
 *   源 `handlePostQuestion` 往 `chat.history.push({ role:'system', isHidden:true })`
 *   驱动模型、`handlePostLoveLetter` 直改 `chat.history` —— 本件**一个字都不往历史里写**。
 *   提问只是登记一条「等你回答」的事实，让生成侧看见；回答是用户/角色自己填进来的。
 *
 *  【③ 存的是六个独立键，不是一个嵌套大对象】
 *   源把六件事塞一个对象里存（改一处要整块回写，任一处写坏六件事一起没）。
 *   本件拆成六个会话键（都走 ^lover_ 前缀），各自独立回写。
 * ======================================================== */
'use strict';
import {
    LOVER_REASONS, LOVER_FACES, LOVER_LIMITS, QUESTION_STATES,
    defaultLoverSettings, normalizeLoverSettings, readLoverFace,
    localDateStr, splitDateStr, parseDateInput, daysTogether,
    normalizeFootprints, visibleFootprints, canRegisterToday,
    normalizeDiaryEntry, hasDiary, pruneDiaryStore, pruneFootprintStore,
    footprintsOf, putFootprints, calendarGrid, moodJar,
    composeLetter, composeIncoming, normalizeLetters,
    normalizeQuestion, questionState, askQuestion, answerQuestion, removeQuestion,
    parseFootprintLines, parseDiaryInput, parseLetterInput,
    projectLover, loverPromptBlock, faceSummary,
} from './loverspace-data.js';
import { LoverSpaceView } from './loverspace-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 六个会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^lover_/`，否则跨会话串味 */
const SETTINGS_KEY = 'lover_settings';
const DAYS_KEY = 'lover_days';
const FOOT_KEY = 'lover_footprints';
const DIARY_KEY = 'lover_diary';
const LETTER_KEY = 'lover_letters';
const QUESTION_KEY = 'lover_questions';

export class LoverSpaceApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultLoverSettings() };
        this.startDate = '';
        this.footprints = {};
        this.diary = {};
        this.letters = [];
        this.questions = [];
        this.face = LOVER_REASONS.storage_absent;
        this._proj = null;
        this._expired = { footprintDays: 0, diaryDays: 0 };
        this._view = null;
        this._hookBound = false;
        this._seq = 0;
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
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }

    /** 宿主的称呼（`name1` 是用户、`name2` 是角色）；无宿主 ⇒ 用中性词，**不编人名**。 */
    _ctxNames() {
        let c = null;
        try {
            const w = this._win();
            c = (w && typeof w.SillyTavern !== 'undefined' && typeof w.SillyTavern.getContext === 'function')
                ? w.SillyTavern.getContext() : null;
        } catch (_e) { c = null; }
        const myName = String((c && c.name1) || '我').trim() || '我';
        const charName = String((c && c.name2) || '').trim();
        return { myName, charName, myAvatar: null, charAvatar: null };
    }

    /* ---------- 取数 ---------- */

    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 取数末尾做一次尾巴收紧：足迹库与日记库按天留存（源无上限）。
     */
    probe() {
        let storageOk = !!this.storage;
        try {
            const days = this._readJSON(DAYS_KEY);
            this.startDate = (days && typeof days === 'object') ? String(days.startDate || '') : '';
            const fp = pruneFootprintStore(this._readJSON(FOOT_KEY), LOVER_LIMITS.maxFootprintDays);
            const dy = pruneDiaryStore(this._readJSON(DIARY_KEY), LOVER_LIMITS.maxDiaryDays);
            this.footprints = fp.store;
            this.diary = dy.store;
            this._expired = { footprintDays: fp.expiredDays, diaryDays: dy.expiredDays };
            if (fp.expiredDays > 0) this._writeJSON(FOOT_KEY, this.footprints);
            if (dy.expiredDays > 0) this._writeJSON(DIARY_KEY, this.diary);
            const rawL = this._readJSON(LETTER_KEY);
            this.letters = (Array.isArray(rawL) ? rawL : []).filter((x) => x && typeof x === 'object');
            const rawQ = this._readJSON(QUESTION_KEY);
            this.questions = (Array.isArray(rawQ) ? rawQ : []).filter((x) => x && typeof x === 'object');
        } catch (_e) {
            storageOk = false;
            this.startDate = '';
            this.footprints = {};
            this.diary = {};
            this.letters = [];
            this.questions = [];
            this._expired = { footprintDays: 0, diaryDays: 0 };
        }
        const todayStr = localDateStr(Date.now());
        const todayFoot = footprintsOf(this.footprints, todayStr);
        const lettersN = normalizeLetters(this.letters);
        this.face = readLoverFace({
            storageOk,
            hasAny: !!(this.startDate || todayFoot.length > 0
                || Object.keys(this.diary).length > 0
                || lettersN.list.length > 0 || this.questions.length > 0),
        });
        this._proj = storageOk ? this._project() : null;
    }

    _project() {
        const todayStr = localDateStr(Date.now());
        const todayFoot = this._readTodayFootprints();
        return projectLover({
            startDate: this.startDate,
            todayFootprints: todayFoot,
            letters: this.letters,
            questions: this.questions,
            diary: this.diary,
        }, Date.now(), this.settings);
    }

    /* 今天是哪一天、今天的足迹是什么 —— 两处都走同一口径（本地日期串）。 */
    _today() { return localDateStr(Date.now()); }

    _readTodayFootprints() {
        const t = this._today();
        const raw = footprintsOf(this.footprints, t);
        return normalizeFootprints(raw, Date.now()).list;
    }

    /* ---------- ① 起算日 ---------- */

    /**
     * 记下第一天。非法日期**拒收并给原因**（源直接赋值，`2026-02-30` 会被 Date 顺延成 3-02）。
     * 返回 `{ok, error?, days?}`。
     */
    setStartDate(input) {
        const d = parseDateInput(input);
        if (d === null) return { ok: false, error: '这个日期认不出来（用 YYYY-MM-DD）' };
        this.startDate = localDateStr(d);
        this._writeJSON(DAYS_KEY, { startDate: this.startDate });
        this.probe();
        return { ok: true, days: this._proj ? this._proj.daysTogether : null };
    }

    clearStartDate() {
        this.startDate = '';
        this._writeJSON(DAYS_KEY, { startDate: '' });
        this.probe();
    }

    /* ---------- ② 今日足迹 ---------- */

    footprintsOfToday() { return this._readTodayFootprints(); }

    /** 到点显形后的可见列表（视图只画这些）。 */
    visibleToday() {
        const list = this._readTodayFootprints();
        const vis = visibleFootprints(list, Date.now(), this.settings.revealByTime);
        return { visible: vis.visible.slice(), hidden: vis.hidden, total: list.length, allShown: vis.allShown };
    }

    /** 今天还没到点的那条（视图挂「下一步」）。 */
    nextToday() {
        const list = this._readTodayFootprints();
        const nowMs = Date.now();
        const hid = list.filter((x) => x.at > nowMs);
        if (!hid.length) return null;
        return { time: hid[0].time, description: hid[0].description, inMs: hid[0].at - nowMs };
    }

    /**
     * 登记一整天的足迹。输入是**多行文本**（每行 `HH:mm 描述`），
     * 由 `parseFootprintLines` 解析；认不出的行**如实计数**回报。
     * `force` 是显式覆盖「一天只登记一次」那道门。
     */
    registerFootprints(text, force) {
        const day0 = Date.now();
        const todayStr = this._today();
        const existing = footprintsOf(this.footprints, todayStr);
        const gate = canRegisterToday(existing, day0, this.settings.oncePerDay, force);
        if (!gate.ok) return { ok: false, error: '今天已经记过了（想再记一次就点「覆盖今天」）', reason: gate.reason };
        const parsed = parseFootprintLines(text);
        if (!parsed.list.length) return { ok: false, error: '一行都没认出来（每行写 `HH:mm 做了什么`）', skipped: parsed.skipped };
        const norm = normalizeFootprints(parsed.list, day0);
        const r = putFootprints(this.footprints, todayStr, norm.list);
        if (r.error) return { ok: false, error: '日期串不合法：' + todayStr };
        this.footprints = r.store;
        this._writeJSON(FOOT_KEY, this.footprints);
        this.probe();
        return { ok: true, count: norm.list.length, skipped: parsed.skipped, overCap: norm.overCap, dropped: norm.dropped };
    }

    /** 清掉今天登记的足迹（源没有这个出口；判据要造「今天空着」这一态）。 */
    clearToday() {
        const todayStr = this._today();
        const r = putFootprints(this.footprints, todayStr, []);
        if (r.error) return { ok: false };
        this.footprints = r.store;
        this._writeJSON(FOOT_KEY, this.footprints);
        this.probe();
        return { ok: true };
    }

    /* ---------- ③ 心情日记 ---------- */

    diaryOf(dateStr) {
        const k = String(dateStr || this._today());
        return normalizeDiaryEntry(this.diary[k]);
    }

    hasDiaryOn(dateStr) {
        return hasDiary(this.diaryOf(dateStr));
    }

    /**
     * 记一天心情。三行文本走 `parseDiaryInput`；认不出形状 ⇒ **降级**成
     * 「整段当用户日记」（而不是拒收 —— 用户写的东西不能因为格式不合就没了）。
     */
    saveDiary(text, dateStr) {
        const k = String(dateStr || this._today());
        if (splitDateStr(k) === null) return { ok: false, error: '日期串不合法' };
        const raw = String(text === null || text === undefined ? '' : text).trim();
        if (!raw) return { ok: false, error: '什么都没写' };
        const parsed = parseDiaryInput(raw);
        const entry = parsed.parsed
            ? normalizeDiaryEntry(parsed.parsed)
            : normalizeDiaryEntry({ userDiary: raw });
        if (!hasDiary(entry)) return { ok: false, error: '存不下空的一天' };
        const next = { ...this.diary };
        next[k] = entry;
        const pr = pruneDiaryStore(next, LOVER_LIMITS.maxDiaryDays);
        this.diary = pr.store;
        this._writeJSON(DIARY_KEY, this.diary);
        this.probe();
        return { ok: true, parsed: !!parsed.parsed, expiredDays: pr.expiredDays };
    }

    removeDiary(dateStr) {
        const k = String(dateStr || '');
        if (!k || !this.diary[k]) return { ok: false, error: '这一天本来就没记' };
        const next = { ...this.diary };
        delete next[k];
        this.diary = next;
        this._writeJSON(DIARY_KEY, this.diary);
        this.probe();
        return { ok: true };
    }

    /** 该月日历网格（视图画格子用）。 */
    gridOf(year, month) { return calendarGrid(year, month, this.diary); }

    /** 该月心情罐子（emoji 平铺）。 */
    jarOf(year, month) { return moodJar(year, month, this.diary); }

    /* ---------- ④ 情书 ---------- */

    lettersList() { return normalizeLetters(this.letters).list.slice(); }

    /** 写一封信。`replyToId` 非空 ⇒ 回信（**只能回来信**，回自己的信会被拒）。 */
    writeLetter(text, replyToId) {
        const names = this._ctxNames();
        const parsed = parseLetterInput(text);
        const to = parsed.to;
        const ctx = { ...names, charName: to || names.charName };
        const rep = replyToId
            ? (this.lettersList().find((l) => l.id === String(replyToId)) || null)
            : null;
        if (replyToId && !rep) return { ok: false, error: '要回的那封信找不到了' };
        const r = composeLetter(parsed.body, ctx, rep, Date.now());
        if (!r.letter) {
            const why = r.error === 'empty-content' ? '还没写内容'
                : (r.error === 'self-reply' ? '这封是你自己写的，回它没有去处（回信要回 Ta 的来信）'
                    : (r.error === 'no-char' ? '还不知道 Ta 叫什么（先把 Ta 的来信记下来）' : '写不出来'));
            return { ok: false, error: why, reason: r.error };
        }
        this._pushLetter(r.letter);
        return { ok: true, id: r.letter.id, reply: !!rep };
    }

    /** 记一封**来信**（角色写给你的）。没有它，回信是个没有对象的按钮。 */
    recordIncoming(text) {
        const names = this._ctxNames();
        const r = composeIncoming(text, names, Date.now());
        if (!r.letter) {
            const why = r.error === 'empty-content' ? '还没写内容'
                : (r.error === 'no-char' ? '还不知道 Ta 叫什么（宿主没给角色名，界面里也认不出）' : '存不下来');
            return { ok: false, error: why, reason: r.error };
        }
        this._pushLetter(r.letter);
        return { ok: true, id: r.letter.id, from: r.letter.senderName };
    }

    _pushLetter(letter) {
        this.letters = this.letters.concat([letter]);
        /* 上限在**纯函数**里裁（normalizeLetters），这里只负责把它写回去 —— 不各写一份口径。 */
        const kept = normalizeLetters(this.letters);
        this.letters = kept.list.slice();
        this._writeJSON(LETTER_KEY, this.letters);
        this.probe();
    }

    removeLetter(id) {
        const want = String(id || '');
        const kept = this.letters.filter((l) => {
            const n = normalizeLetters([l]).list[0];
            return !n || n.id !== want;
        });
        const removed = this.letters.length - kept.length;
        if (!removed) return { ok: false, error: '这封信找不到了' };
        this.letters = kept;
        this._writeJSON(LETTER_KEY, this.letters);
        this.probe();
        return { ok: true, removed };
    }

    clearLetters() {
        const n = this.letters.length;
        if (!n) return { ok: true, removed: 0 };
        this.letters = [];
        this._writeJSON(LETTER_KEY, this.letters);
        this.probe();
        return { ok: true, removed: n };
    }

    /* ---------- ⑤ 提问与回答 ---------- */

    questionsList() {
        const now = Date.now();
        return this.questions.map((q) => normalizeQuestion(q, now)).filter(Boolean);
    }

    /** 你问 Ta 一个问题（提问者=user、等 Ta 答）。 */
    ask(text) {
        const names = this._ctxNames();
        const r = askQuestion({ questionText: text, questioner: 'user', answerer: 'char', timestamp: Date.now() }, Date.now());
        if (!r.question) return { ok: false, error: '还没写问题', reason: r.error };
        this.questions = this.questions.concat([r.question]);
        this._writeJSON(QUESTION_KEY, this.questions);
        this.probe();
        return { ok: true, id: r.question.id, charName: names.charName };
    }

    /** 记一个 **Ta 问你** 的问题（等用户答）。源没有这个入口（它只驱动模型去问）。 */
    askByChar(text) {
        const r = askQuestion({ questionText: text, questioner: 'char', answerer: 'user', timestamp: Date.now() }, Date.now());
        if (!r.question) return { ok: false, error: '还没写问题', reason: r.error };
        this.questions = this.questions.concat([r.question]);
        this._writeJSON(QUESTION_KEY, this.questions);
        this.probe();
        return { ok: true, id: r.question.id };
    }

    /**
     * 回答。`byWhom` 是 'user' 或 'char' —— **只有悬着的那一方能答**，
     * 答过的再答、或替对方答，都拒收（源直接改字段，谁都能覆盖谁的答复）。
     */
    answer(id, byWhom, text) {
        const before = this.questions.map((q) => normalizeQuestion(q, Date.now())).filter(Boolean);
        const r = answerQuestion(before, id, byWhom, text, Date.now());
        if (r.error) {
            const why = r.error === 'already-answered' ? '这条已经答过了'
                : (r.error === 'not-your-turn' ? '这条不是轮到你答' : (r.error === 'empty-content' ? '还没写回答' : '这条提问找不到了'));
            return { ok: false, error: why, reason: r.error };
        }
        this.questions = r.list.slice();
        this._writeJSON(QUESTION_KEY, this.questions);
        this.probe();
        return { ok: true };
    }

    removeQuestionItem(id) {
        const r = removeQuestion(this.questions, id);
        if (r.error) return { ok: false, error: '这条提问找不到了' };
        this.questions = r.list.slice();
        this._writeJSON(QUESTION_KEY, this.questions);
        this.probe();
        return { ok: true };
    }

    /* ---------- 读数 / 注入 ---------- */

    faceReason() { return this.face; }
    faces() { return LOVER_FACES.slice(); }
    projection() { return this._proj; }
    limits() { return LOVER_LIMITS; }
    states() { return QUESTION_STATES; }
    expiredDays() { return { ...this._expired }; }
    faceOf(face) { return faceSummary(this._proj, face); }

    /** 换会话后「今天是哪一天」跟着变 —— 视图的标题要用。 */
    todayLabel() { return this._today(); }

    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || this._project();
        return loverPromptBlock(proj, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到恋爱空间';
        if (!p.hasAny) return '还没有开始';
        const bits = [];
        if (p.daysTogether !== null) bits.push('第 ' + p.daysTogether + ' 天');
        if (p.todayFootprintCount) bits.push('今天 ' + p.todayFootprintCount + ' 条足迹');
        if (p.awaitingChar) bits.push(p.awaitingChar + ' 个问题等你答');
        if (p.letterCount) bits.push(p.letterCount + ' 封情书');
        return bits.join(' · ') || '还没有开始';
    }

    /** 视图要的两个称呼（宿主给什么用什么，没有就用中性词 —— **不编人名**）。 */
    names() { return this._ctxNames(); }

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

    /* ---------- 设置 ---------- */

    _loadSettings() {
        try {
            this.settings = normalizeLoverSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = { ...defaultLoverSettings() }; }
    }

    saveSettings() { this._writeJSON(SETTINGS_KEY, this.settings); }

    patchSettings(patch) {
        this.settings = normalizeLoverSettings({ ...this.settings, ...(patch || {}) });
        this.saveSettings();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：起算日、足迹、日记、情书、问答全是「这段关系的账」，故全部重取。 */
    onChatChanged() {
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new LoverSpaceView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}
