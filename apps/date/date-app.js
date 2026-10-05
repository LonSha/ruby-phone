/* ========================================================
 * date-app.js — [v3.31.0] 约会大作战 App 控制器
 * 照抄 taobao / shop / loverspace 规格：取数 → 纯函数 → 视图；注入走表驱动。
 *
 * 缝合自 EPhone·xintuk（`runtime/scripts/date/`，三片 120530 字节 / 3195 行 / 51 个函数）。
 * 源把「场景册 → 出资 → 开演 → 结算 → 分享 → 历史 → 立绘 → BGM」全塞进一个屏幕，
 * 逐条取舍写在 date-data.js 的文件头（六块取 / 两块不取 / 四处不缝 / 四条偏离）。
 * 这里只记**接线上的五件事**：
 *
 *  【① 不碰钱包：只读、只判定，一分钱都不动】
 *   源四处直改余额：`updateUserBalanceAndLogTransaction(...)`（我来付 / 找人借）与
 *   `updateCharacterPhoneBankBalance(...)`（Ta 来付）。本仓用户钱包的**仲裁源是微信零钱**
 *   （`apps/games/catbox/` 有同款只读范式），出账入账归它管。本件只做两件：
 *   算「谁出多少」（纯函数 `sourceOfFunds`）与判「够不够」（`walletGate`）。
 *   开演时**只给提示，不扣钱** —— 谁记账谁负责，App 不越权改别人的账本。
 *
 *  【② 不直连模型】
 *   源三处自己拼 systemPrompt 直发（连 Gemini 分支都自己走 `toGeminiRequestData`）。
 *   本件的剧情来自**宿主生成侧**（用户或模型在对话框里写的），App 只负责登记。
 *
 *  【③ 不写 Dexie、不碰 `db.chats` / `chat.history`】
 *   源把整份 chat 落库、往 history 塞 `isHidden` 系统消息驱动模型、结束时塞 `pat_message`。
 *   本件零数据库，且 App 不替宿主写楼层：分享只产一份 `shareText` 给用户自己复制。
 *
 *  【④ 一张图都不存、一条外链都不收】
 *   源把生图 URL（含 `data:`）写进场景与立绘，背景靠 `i.postimg.cc` 外链。
 *   本件登记的是**宿主给的本地路径或用户自填提示词**；预览只认本机路径，
 *   外链**不预览、不抓取**（收了就变成第二个图床权威）。`bareImageUrl()` 顺手修掉
 *   源「把用户填的 URL 裸插进 `url(...)`」那条脏。
 *
 *  【⑤ 不做实时定时器】
 *   源 4 处 `setTimeout`（立绘淡入 ×2、文本 250ms 淡出淡入、卡片放大移除）。
 *   本件一个定时器都不转：`probe()` 每次现算「此刻应有的样子」。
 * ======================================================== */
'use strict';
import {
    DATE_REASONS, DATE_FACES, FUND_MODES, RUN_PHASES, DATE_LIMITS,
    defaultDateSettings, normalizeDateSettings, readDateFace,
    localDateStr, startOfLocalDay, isValidDateStr, msOfTime,
    normalizeScenes, localScene, updatableScene, sceneCanonical, sceneStyleTags,
    craftBackgroundPrompt, bareImageUrl,
    sourceOfFunds, walletGate, borrowPlan,
    planDateRun, assignFunds, noteBorrow, startRun, closeRun, addRunLine, attachStory,
    runPhase, humanSpan, rateDate, settleRun, sharePayload, shareText,
    pruneRunStore, projectDate, datePromptBlock, faceSummary,
} from './date-data.js';
import { numOrNull } from '../../config/num-gate.js';
import { DateView } from './date-view.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^date_/`，否则跨会话串味。
   源把全部状态塞在内存的 `datingGameState` 里（重开全丢）—— 本件落三条独立的键：
   设置 / 场景册 / 场次与欠账，改一处不必整块回写。 */
const SETTINGS_KEY = 'date_settings';
const SCENES_KEY = 'date_scenes';
const STORE_KEY = 'date_store';

export class DateApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = defaultDateSettings();
        this.scenes = [];
        this.store = { runs: [], debts: [] };
        this.wallet = { available: false, balance: null };
        this.face = DATE_REASONS.storage_absent;
        this._proj = null;
        this._sceneRead = { dropped: 0, dupes: 0, trimmed: 0 };
        this._expired = { expiredRuns: 0, expiredDebts: 0, totalRuns: 0 };
        this._current = '';
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
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }

    /** 宿主的称呼（`name1` 是用户、`name2` 是角色）；无宿主 ⇒ 用中性词，**绝不编人名**。 */
    _ctxNames() {
        let c = null;
        try {
            const w = this._win();
            c = (w && typeof w.SillyTavern !== 'undefined' && typeof w.SillyTavern.getContext === 'function')
                ? w.SillyTavern.getContext() : null;
        } catch (_e) { c = null; }
        return {
            myName: String((c && c.name1) || '我').trim() || '我',
            charName: String((c && c.name2) || '').trim(),
            charRef: '',
        };
    }

    /* ---------- 取数 ---------- */

    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * 末尾做一次尾巴收紧：场次与欠账库按上限裁，更早的**如实计数**回报。
     */
    probe() {
        let storageOk = !!this.storage;
        try {
            const rawS = this._readJSON(SCENES_KEY);
            const arr = Array.isArray(rawS) ? rawS : ((rawS && Array.isArray(rawS.list)) ? rawS.list : []);
            const norm = normalizeScenes(arr);
            this.scenes = norm.list;
            this._sceneRead = { dropped: norm.dropped, dupes: norm.dupes, trimmed: norm.trimmed };
            if (norm.dropped || norm.dupes || norm.trimmed) this._writeJSON(SCENES_KEY, this.scenes);
            const pr = pruneRunStore(this._readJSON(STORE_KEY), DATE_LIMITS.maxRuns);
            this.store = pr.store;
            this._expired = { expiredRuns: pr.expiredRuns, expiredDebts: pr.expiredDebts, totalRuns: pr.totalRuns };
            if (pr.expiredRuns || pr.expiredDebts) this._writeJSON(STORE_KEY, this.store);
        } catch (_e) {
            storageOk = false;
            this.scenes = [];
            this.store = { runs: [], debts: [] };
            this._sceneRead = { dropped: 0, dupes: 0, trimmed: 0 };
            this._expired = { expiredRuns: 0, expiredDebts: 0, totalRuns: 0 };
        }
        this.wallet = this._readWallet();
        if (this._current && !this.runByUid(this._current)) this._current = '';
        this.face = readDateFace({
            storageOk: storageOk,
            hasAny: !!(this.scenes.length || this.store.runs.length || this.store.debts.length),
        });
        this._proj = storageOk ? projectDate({ scenes: this.scenes, runs: this.store.runs, debts: this.store.debts }, Date.now(), this.settings) : null;
    }

    _project() {
        return projectDate({ scenes: this.scenes, runs: this.store.runs, debts: this.store.debts }, Date.now(), this.settings);
    }

    /**
     * 只读用户钱包（微信零钱）。**只读**：本件没有任何一个出口会写它。
     * `available: false` 表示「读不到」——与「余额是 0」是两件事（`walletGate` 分开报）。
     */
    _readWallet() {
        try {
            const w = this._win();
            const wa = w && w.VirtualPhone ? w.VirtualPhone.wechatApp : null;
            const wd = wa && wa.wechatData ? wa.wechatData : null;
            if (!wd || typeof wd.getWalletBalance !== 'function') return { available: false, balance: null };
            return { available: true, balance: numOrNull(wd.getWalletBalance()) };
        } catch (_e) { return { available: false, balance: null }; }
    }

    /* ---------- ① 场景册 ---------- */

    sceneList() { return this.scenes.slice(); }

    sceneByUid(uid) {
        const want = String(uid || '');
        for (let i = 0; i < this.scenes.length; i++) if (this.scenes[i].uid === want) return this.scenes[i];
        return null;
    }

    /** 场景册的读数（丢了几个 / 重了几个 / 裁了几个 —— 都如实报，不静默）。 */
    sceneReading() { return { ...this._sceneRead }; }

    /** 手建一个场景（源 `handleSaveCustomDatingScene`；本件走纯函数 `localScene`）。 */
    addScene(input) {
        const r = localScene(input);
        if (!r.ok) return { ok: false, error: r.error, problem: r.problem };
        const list = this.scenes.concat([r.scene]);
        const norm = normalizeScenes(list);
        if (norm.list.length === this.scenes.length) {
            return { ok: false, error: '这个场景跟已有的重了（换个名字或改掉 uid）', problem: 'dupe' };
        }
        this.scenes = norm.list;
        this._writeJSON(SCENES_KEY, this.scenes);
        this.probe();
        return { ok: true, uid: r.scene.uid, count: this.scenes.length, trimmed: norm.trimmed };
    }

    /**
     * 批量收下别处产出的场景（宿主/AI 给的 JSON 数组 —— 源 `refreshDatingScenes` 走的就是这条路）。
     * 坏条目**如实计数**，不是静默丢。
     */
    addScenes(list) {
        const src = Array.isArray(list) ? list : [];
        if (!src.length) return { ok: false, error: '没有可收的场景' };
        const norm = normalizeScenes(this.scenes.concat(src));
        const added = norm.list.length - this.scenes.length;
        this.scenes = norm.list;
        this._writeJSON(SCENES_KEY, this.scenes);
        this.probe();
        return { ok: true, added: added, dropped: norm.dropped, dupes: norm.dupes, trimmed: norm.trimmed };
    }

    /** 改一个场景（`uid` 与 `source` 不可改：改了就是另一条记录了）。 */
    patchScene(uid, patch) {
        const cur = this.sceneByUid(uid);
        if (!cur) return { ok: false, error: '这个场景找不到了' };
        const r = updatableScene(cur, patch);
        if (!r.ok) {
            const why = r.problem === 'no-name' ? '场景名不能空着'
                : (r.problem === 'bad-cost' ? '花费要填一个不小于 0 的数' : '图片地址不认（要用 http 开头、data:image 或本机路径）');
            return { ok: false, error: why, problem: r.problem };
        }
        const list = this.scenes.map((s) => (s.uid === cur.uid ? r.scene : s));
        const norm = normalizeScenes(list);
        this.scenes = norm.list;
        this._writeJSON(SCENES_KEY, this.scenes);
        this.probe();
        return { ok: true, scene: r.scene, dropped: norm.dropped };
    }

    removeScene(uid) {
        const want = String(uid || '');
        const kept = this.scenes.filter((s) => s.uid !== want);
        const removed = this.scenes.length - kept.length;
        if (!removed) return { ok: false, error: '这个场景找不到了' };
        this.scenes = kept;
        this._writeJSON(SCENES_KEY, this.scenes);
        this.probe();
        return { ok: true, removed: removed };
    }

    clearScenes() {
        const n = this.scenes.length;
        if (!n) return { ok: true, removed: 0 };
        this.scenes = [];
        this._writeJSON(SCENES_KEY, this.scenes);
        this.probe();
        return { ok: true, removed: n };
    }

    /** 场景的风格归类 + 文生图提示词（视图显示与「复制提示词」都用这两处）。 */
    styleOf(scene) { return sceneStyleTags(scene && scene.name); }
    promptOf(scene) { return craftBackgroundPrompt(scene); }
    cleanUrl(u) { return bareImageUrl(u); }
    checkScene(raw) { return sceneCanonical(raw); }

    /* ---------- ② 出资 ---------- */

    modes() { return FUND_MODES; }
    phases() { return RUN_PHASES; }

    walletReading() { return { ...this.wallet }; }

    /** 预览「这种出资方式各出多少」（不落任何东西）。 */
    previewFunds(mode, cost) { return sourceOfFunds(mode, cost); }

    /** 判「钱够不够」（用户那部分要出多少 —— `lend` 时就是他要还的总额）。 */
    gateFor(mode, cost) {
        const r = sourceOfFunds(mode, cost);
        if (!r.ok) return { ok: false, error: r.error };
        const g = walletGate(this.wallet.available ? this.wallet.balance : null, r.userPart);
        return Object.assign({}, g, { userPart: r.userPart, charPart: r.charPart, total: r.total, walletAvailable: this.wallet.available });
    }

    /** 借钱计划：只产「向谁借、借多少」三件事实，**不动任何余额**。 */
    planBorrow(amount, opts) {
        const debts = Array.isArray(this.store.debts) ? this.store.debts : [];
        let total = 0;
        for (let i = 0; i < debts.length; i++) total += numOrNull(debts[i] && debts[i].amount) ?? 0;
        return borrowPlan(amount, total, DATE_LIMITS.maxDebts, opts);
    }

    /* ---------- ③ 场次：计划 → 开演 → 收场 ---------- */

    runList() {
        const runs = Array.isArray(this.store.runs) ? this.store.runs : [];
        const now = Date.now();
        return runs.map((r) => Object.assign({}, r, { phaseNow: runPhase(r, now) }));
    }

    runByUid(uid) {
        const want = String(uid || '');
        const runs = Array.isArray(this.store.runs) ? this.store.runs : [];
        for (let i = 0; i < runs.length; i++) if (runs[i].uid === want) return runs[i];
        return null;
    }

    debtList() {
        const debts = Array.isArray(this.store.debts) ? this.store.debts : [];
        return debts.filter((d) => d && typeof d === 'object');
    }

    /** 当前选中的那一场（视图的展开面板；纯视图态，但换会话必须重取 ⇒ 一并清掉）。 */
    currentUid() { return this._current; }
    setCurrent(uid) { this._current = String(uid || ''); return this._current; }

    _replaceRun(run) {
        const runs = Array.isArray(this.store.runs) ? this.store.runs : [];
        const idx = runs.findIndex((r) => r.uid === run.uid);
        const next = (idx >= 0) ? runs.map((r, i) => (i === idx ? run : r)) : runs.concat([run]);
        const pr = pruneRunStore({ runs: next, debts: this.store.debts }, DATE_LIMITS.maxRuns);
        this.store = pr.store;
        this._expired = { expiredRuns: pr.expiredRuns, expiredDebts: pr.expiredDebts, totalRuns: pr.totalRuns };
        this._writeJSON(STORE_KEY, this.store);
        this.probe();
        return pr;
    }

    /**
     * 计划一场约会。`mode` 空 ⇒ 先不定出资（源是点四下按钮，本件把「还没定」当成一种**合法状态**）。
     */
    plan(sceneUid, mode) {
        const scene = this.sceneByUid(sceneUid);
        if (!scene) return { ok: false, error: '先挑一个去处' };
        const names = this._ctxNames();
        const r = planDateRun(scene, { name: names.charName, ref: names.charRef, myName: names.myName }, Date.now(), mode);
        if (!r.ok) {
            const why = r.problem === 'no-char' ? '还不知道要跟谁去（宿主没给角色名）' : (r.error || '计划不成');
            return { ok: false, error: why, problem: r.problem };
        }
        const pr = this._replaceRun(r.run);
        this._current = r.run.uid;
        return { ok: true, uid: r.run.uid, expiredRuns: pr.expiredRuns };
    }

    /** 定 / 改出资方式。**开演后不许再改**（钱已经出去了，改分配就是在改账）。 */
    setMode(uid, mode) {
        const run = this.runByUid(uid);
        if (!run) return { ok: false, error: '这一场找不到了' };
        if (String(run.phase) !== RUN_PHASES.planned) return { ok: false, error: '已经开演了，出资方式不能再改（改分配就是在改账）' };
        const r = assignFunds(run, mode);
        if (!r.ok) return { ok: false, error: r.error, problem: r.problem };
        const g = this.gateFor(mode, r.run.cost);
        this._replaceRun(r.run);
        return { ok: true, run: r.run, gate: g };
    }

    /** 开演。**只给提示，不扣钱** —— 出账归钱包那个权威。 */
    start(uid) {
        const run = this.runByUid(uid);
        if (!run) return { ok: false, error: '这一场找不到了' };
        const r = startRun(run, Date.now());
        if (!r.ok) return { ok: false, error: r.error };
        this._replaceRun(r.run);
        const g = this.gateFor(r.run.mode, r.run.cost);
        return { ok: true, run: r.run, gate: g };
    }

    /** 记一笔（谁说的 / 发生了什么）。源把剧情全表物化在内存里，无上界。 */
    log(uid, who, text) {
        const run = this.runByUid(uid);
        if (!run) return { ok: false, error: '这一场找不到了' };
        const r = addRunLine(run, who, text, Date.now());
        if (!r.ok) return { ok: false, error: r.error, overCap: !!r.overCap };
        this._replaceRun(r.run);
        return { ok: true, count: (r.run.log || []).length };
    }

    /** 记下这段剧情（**登记**，不是生成：剧情来自宿主生成侧）。 */
    setStory(uid, text) {
        const run = this.runByUid(uid);
        if (!run) return { ok: false, error: '这一场找不到了' };
        const r = attachStory(run, text);
        if (!r.ok) return { ok: false, error: r.error };
        this._replaceRun(r.run);
        return { ok: true, len: r.run.storyText.length };
    }

    /** 收场。半途收场也照样记 —— 但记的是半途（评级里看得出来），不冒充完整。 */
    finish(uid) {
        const run = this.runByUid(uid);
        if (!run) return { ok: false, error: '这一场找不到了' };
        const r = closeRun(run, Date.now());
        if (!r.ok) return { ok: false, error: r.error };
        this._replaceRun(r.run);
        return { ok: true, rating: rateDate(r.run), settle: settleRun(r.run) };
    }

    /** 借一笔（登记 `run.debtTo` / `run.borrowed` + 欠账台账；**不改任何余额**）。 */
    borrow(uid, name, amount) {
        const run = this.runByUid(uid);
        if (!run) return { ok: false, error: '这一场找不到了' };
        const r = noteBorrow(run, name, amount);
        if (!r.ok) return { ok: false, error: r.error };
        const debts = (Array.isArray(this.store.debts) ? this.store.debts : []).concat([{
            uid: 'debt_' + String(Date.now()) + '_' + String(r.run.debtTo).length,
            runUid: run.uid, name: r.run.debtTo, amount: Math.round(numOrNull(amount) ?? 0),
            at: Date.now(), sceneName: run.sceneName,
        }]);
        this.store = { runs: this.store.runs, debts: debts };
        const pr = this._replaceRun(r.run);
        return { ok: true, run: r.run, debts: this.debtList().length, expiredDebts: pr.expiredDebts };
    }

    /** 清掉一笔欠账（还了 / 记错了）。只动台账，不动余额。 */
    settleDebt(debtUid) {
        const want = String(debtUid || '');
        const debts = Array.isArray(this.store.debts) ? this.store.debts : [];
        const kept = debts.filter((d) => !(d && d.uid === want));
        const removed = debts.length - kept.length;
        if (!removed) return { ok: false, error: '这笔欠账找不到了' };
        this.store = { runs: this.store.runs, debts: kept };
        this._writeJSON(STORE_KEY, this.store);
        this.probe();
        return { ok: true, removed: removed };
    }

    removeRun(uid) {
        const want = String(uid || '');
        const runs = Array.isArray(this.store.runs) ? this.store.runs : [];
        const kept = runs.filter((r) => r.uid !== want);
        const removed = runs.length - kept.length;
        if (!removed) return { ok: false, error: '这一场找不到了' };
        this.store = { runs: kept, debts: this.store.debts };
        if (this._current === want) this._current = '';
        this._writeJSON(STORE_KEY, this.store);
        this.probe();
        return { ok: true, removed: removed };
    }

    clearRuns() {
        const n = (this.store.runs || []).length;
        if (!n) return { ok: true, removed: 0 };
        this.store = { runs: [], debts: this.store.debts };
        this._current = '';
        this._writeJSON(STORE_KEY, this.store);
        this.probe();
        return { ok: true, removed: n };
    }

    /* ---------- ④ 结算 / 分享 ---------- */

    ratingOf(uid) { return rateDate(this.runByUid(uid)); }
    settleOf(uid) { return settleRun(this.runByUid(uid)); }
    progressOf(uid) { return runPhase(this.runByUid(uid), Date.now()); }

    /** 分享用的纯数据（**不写楼层**：宿主想用得自己拿这份 payload 去写）。 */
    payloadOf(uid) {
        const names = this._ctxNames();
        return sharePayload(this.runByUid(uid), names);
    }

    /** 可复制的一段文本（源把这段直接当聊天消息的内容塞进 history）。 */
    textOf(uid) { return shareText(this.payloadOf(uid)); }

    /* ---------- 读数 / 注入 ---------- */

    faceReason() { return this.face; }
    faces() { return DATE_FACES.slice(); }
    projection() { return this._proj; }
    limits() { return DATE_LIMITS; }
    expiredReading() { return { ...this._expired }; }
    faceOf(face) { return faceSummary(this._proj, face); }
    names() { return this._ctxNames(); }

    /** 今天的日期串（本地时区）；产不出合法串就如实空着 —— 视图标题不会显示一个假日期。 */
    todayLabel() {
        const s = localDateStr(Date.now());
        return isValidDateStr(s) ? s : '';
    }

    /** 今天 0 点（视图的「今天」分组用；`now` 显式取毫秒再过门）。 */
    dayStart() { return startOfLocalDay(Date.now()); }

    /** 「从那一刻到现在有多久」的人话（视图给每场标注用）。 */
    spanSince(ms) {
        const t = msOfTime(ms);
        if (t === null) return '';
        return humanSpan(Math.max(0, Date.now() - t));
    }

    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        const proj = this._proj || this._project();
        return datePromptBlock(proj, this.settings);
    }

    summaryLine() {
        const p = this._proj;
        if (!p) return '读不到约会数据';
        if (!p.hasAny) return '还没有去处，也没约过';
        const bits = [];
        if (p.sceneCount) bits.push(p.sceneCount + ' 个去处');
        if (p.runningCount) bits.push(p.runningCount + ' 场在跑');
        if (p.plannedCount) bits.push(p.plannedCount + ' 场待发');
        if (p.endedCount) bits.push(p.endedCount + ' 场收场');
        if (p.outstanding > 0) bits.push('欠着 ' + p.outstanding);
        return bits.join(' · ') || '还没有去处，也没约过';
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const w = this._win();
            const ctx = (w.SillyTavern && typeof w.SillyTavern.getContext === 'function') ? w.SillyTavern.getContext() : null;
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
            this.settings = normalizeDateSettings(this._readJSON(SETTINGS_KEY));
        } catch (_e) { this.settings = defaultDateSettings(); }
    }

    saveSettings() { this._writeJSON(SETTINGS_KEY, this.settings); }

    patchSettings(patch) {
        this.settings = normalizeDateSettings(Object.assign({}, this.settings, patch || {}));
        this.saveSettings();
        this.probe();
    }

    /* ---------- 生命周期 ---------- */

    /** 换会话：场景册、场次、欠账、设置全是「这段关系的账」，故全部重取并丢掉选中态。 */
    onChatChanged() {
        this._current = '';
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new DateView(this, this.shell, this.storage);
        }
        this._view.render();
    }
}
