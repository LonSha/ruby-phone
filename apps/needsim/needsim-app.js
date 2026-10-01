/* ========================================================
 * needsim-app.js — [v3.41.0] 需求沙盘 · 落盘与接线
 *
 * 数据层：needsim-data.js（纯函数内核）  视图层：needsim-view.js
 *
 * ── 三层分工（与第 2 / 第 3 层各件同规格）──────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：需求钳位 / 效果台账 / 池子四态 / 游标轮次 /
 *      愿望四态 / 记忆淘汰 / 回信归一 / 读数 —— 都不碰存储、不碰网络；
 *   ③ 落盘（PhoneStorage）：三条会话键，全走 /^needsim_/ 前缀。
 *
 * ── 四条会话键 ──────────────────────────────────────────
 *   · needsim_needs    —— 这个角色的六项需求值（逐项报「读得出来 / 读不出来」）；
 *   · needsim_pool     —— 生成的台词池与小事件池 + 游标（含四态）；
 *   · needsim_journal  —— 记忆流 + 今日愿望（同键两件事，四态分开判）；
 *   · needsim_ledger   —— 台账（每次点行动 / 点事件 / 重定愿望的回执）
 *                         + 策略（台账保留数）。
 *   ★ 为什么记忆与愿望同键：源也把它们放在同一处（角色维度的本地存储），
 *     但源**不报**两者里哪一个坏了 —— 本件同键而分开判态。
 *
 * ── 不缝的那一块（源的核心能力，本件不接）──────────────
 *   源自己从浏览器本地存储直读模型地址与密钥、自己拼五段式 prompt、
 *   自己发请求、自己从回复里抠 JSON。本件**零网络调用、零密钥读**：
 *   只产**可复制的要求文本**（composeRequestText）与**回信归一**（parseReply）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 需求读不出来 **不许**当成 5（视图画「这一项读不出来」）；
 *   · 心情缺一项 **不许**落「非常不开心」（moodOf 报读不出来）；
 *   · 池子「没生成」与「生成了但一条都用不上」**不许**同形；
 *   · 游标绕回 **不许**无痕迹（报 wrap 第几轮）；
 *   · 愿望过期 **不许**与「今天没有」同形；
 *   · 记忆满了 **不许**整本清空（落最旧一条并报 evicted）；
 *   · 换会话后旧池与旧游标 **不许**留着（onChatChanged 全量重取）。
 * ======================================================== */
import {
    SIMS_NEED_KEYS, SIMS_NEED_META, SIMS_ACTION_IDS, SIMS_ACTION_META, SIMS_CARE_OF, SIMS_ICON_OF,
    SIMS_LEVELS, SIMS_LEVEL_META, SIMS_NEED_UNREADABLE,
    SIMS_MOODS, SIMS_MOOD_META, SIMS_MOOD_UNKNOWN,
    SIMS_VALUE_MIN, SIMS_VALUE_MAX, SIMS_EFFECT_MIN, SIMS_EFFECT_MAX,
    SIMS_POOL_STATES, SIMS_POOL_STATE_TEXT, SIMS_LINE_LIMIT, SIMS_EVENT_LIMIT,
    SIMS_MEMORY_LIMIT, SIMS_MAX_UNITS, SIMS_MEMORY_STATES,
    SIMS_WISH_STATES, SIMS_WISH_STATE_TEXT,
    SIMS_FACES, SIMS_FACE_TEXT, SIMS_REPLY_WHYS,
    clampNeed, needDefaults, levelKeyOf, needsReadout, moodOf,
    sanitizeEffects, applyEffects, effectText,
    todayKeyOf, parseSavedWish, buildWish,
    normalizePool, emptyPool, nextFromPool,
    normalizeMemories, addMemory, memoryAgeOf,
    extractObject, parseReply, composeRequestText, readingsOf, faceOf
} from './needsim-data.js';
import { NeedsimView } from './needsim-view.js';
import { numOrNull } from '../../config/num-gate.js';

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中
   /^needsim_/，否则跨会话串味。源把需求值与生成池都放在没有角色维度的键下。 */
const NEEDS_KEY = 'needsim_needs';
const POOL_KEY = 'needsim_pool';
const JOURNAL_KEY = 'needsim_journal';
const LEDGER_KEY = 'needsim_ledger';
/** 取数面读数（视图不自己拼统计）。
 *  ★ 四态常量**从真源数组派生**，不手写标识符形（本仓 J7 形态：手写一份靠碰巧
 *    拼写一致对齐，真源增删一态就静默走兜底）。
 *  ★ 本件比源多两态：源把「写了但认不出来」与「还没记过」都画成空列表。 */
const FACE_OK = SIMS_FACES[0];
const FACE_MALFORMED = SIMS_FACES[2];
const FACE_ABSENT = SIMS_FACES[3];

/** 覆盖值取值口：显式传入的**真数字**才认，取不出来回落。
 *  ★ 不写弱口径签名（那是本仓 W1 门禁禁的形态：会把「没给」说成「给了 0」）。 */
function numOrSelf(v, self) {
    const n = numOrNull(v);
    return n === null ? self : n;
}

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

function clampLen(s, max) {
    const t = toStr(s).trim();
    return t.length > max ? t.slice(0, max) : t;
}

/** 「这一格写了东西、但认不出来」——_readRaw 的三种回报里只有这一种算数。
 *  ★ 与「storage 取不出来」（ok=false）**不同形**：那个是**取不出来**，
 *    这个是**取到了但读不懂**，用户要做的事不一样（修数据 vs 检查存储）。
 *  ★ 与「没写过」（ok=true, raw=null, text=null）也不同形。 */
function malformedOf(rep) {
    const r = (rep && typeof rep === 'object') ? rep : {};
    return !!(r.ok === true && r.raw === null && typeof r.text === 'string' && r.text.trim());
}

/** 保留数取值门：显式传入的**正整数**才认，否则回落真源上限。
 *  ★ 「0 / 负数 / 小数 / 非数」一律回落，不静默当成 0。 */
function keepOr(v, fallback) {
    const fb = (numOrNull(fallback) === null) ? SIMS_MAX_UNITS : Math.floor(numOrNull(fallback));
    const n = numOrNull(v);
    if (n === null || !Number.isInteger(n) || n < 1) return fb;
    return Math.min(n, SIMS_MAX_UNITS);
}

export class NeedsimApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        /* 六项需求（**只存原始值**，派生结论一律现算） */
        this.needs = {};
        /* 池子（台词 / 小事件 / 游标） */
        this.pool = emptyPool();
        /* 记忆流 */
        this.memories = [];
        /* 今日愿望（当前生效的那条） */
        this.wish = null;
        /* 策略：台账最多留多少条 */
        this.ledgerKeep = SIMS_MAX_UNITS;
        /* 台账 */
        this.receipts = [];
        /* 视图态（进重绑表） */
        this._current = '';
        this._draft = '';
        this._tab = 'needs';
        this.face = FACE_ABSENT;
        /* ★ 愿望四态必须**存下来**：parseSavedWish 的 stale 态在 probe 里算得出来，
         *   但它只活在这一帧 —— 视图要画「存着的是过去某天的愿望」就得能拿到它。 */
        this._wishState = SIMS_WISH_STATES[2];
        this._wishStale = null;
        this._poolBad = false;
        this._memBad = false;
        this._needsBad = false;
        this._badLedger = false;
        this._readings = readingsOf([], null, this._wishState, { receipts: 0 });
        this._readingsOk = false;
        this._proj = null;
        this._view = null;
        /* ★ 「今天是哪天」只许有一个出处：外部显式给过就用它，否则用系统时钟。
         *   两处各自取——落盘时用外部给的日子、回读时用系统时钟——会让刚定下的愿望
         *   在下一次 probe 里立刻被自己判成过期（双口径必然分岔）。 */
        this._today = '';
        /* ★ 构造末尾就取一次数：否则读数与需求在 render() 之前是空的 ——
         *  任何先读后画的路径都会把「还没取数」看成「一条都没有」。 */
        this.probe();
    }
    /**
     * 取数（**分两种回报**）：ok 说「storage 能不能用」，raw 说「这一格读到了什么」。
     *   · ok === false ⇒ storage 没给 / 一取就抛 ⇒ 这是「取不出来」，不是「空的」；
     *   · ok === true, raw === null ⇒ storage 是好的，只是这一格没有 / 不是合法 JSON。
     */
    /** 「今天是哪天」的唯一出处（视图与数据层都不许各自取时钟）。 */
    todayOf() { return this._today || todayKeyOf(); }
    _readRaw(key) {
        /* ★ 「能读不能写」也算存储不可用：本件的核心动作就是落盘，
         *   能读不能写意味着「当场看着成功、下次打开全没了」。 */
        if (!this.storage || typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, raw: null, text: null };
        }
        let text = null;
        try { text = this.storage.get(key); }
        catch (_e) { return { ok: false, raw: null, text: null }; }
        if (typeof text !== 'string') return { ok: true, raw: text, text: null };
        try { return { ok: true, raw: JSON.parse(text), text: text };
        } catch (_e) { return { ok: true, raw: null, text: text }; }
    }
    _writeJSON(key, v) {
        try {
            if (!this.storage || typeof this.storage.set !== 'function') return false;
            this.storage.set(key, JSON.stringify(v));
            return true;
        } catch (_e) { return false; }
    }
    /* ---------- 装载 ---------- */
    /**
     * 需求格装载。
     *   ★ 逐项判定：一项读不出来只影响那一项（源把它回落成 5 并照画进度条）。
     */
    _loadNeeds(rep) {
        this.needs = {};
        this._needsBad = false;
        if (!rep || rep.ok !== true) return false;
        if (rep.raw === null) {
            if (typeof rep.text === 'string' && rep.text.trim()) this._needsBad = true;
            return this._needsBad;
        }
        const r = (rep.raw && typeof rep.raw === 'object') ? rep.raw : null;
        if (!r) { this._needsBad = true; return true; }
        const src = (r.needs && typeof r.needs === 'object') ? r.needs : r;
        for (const k of SIMS_NEED_KEYS) {
            if (src[k] === undefined) continue;
            this.needs[k] = src[k];
        }
        return false;
    }
    _loadPool(rep) {
        const r = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : null;
        this.pool = normalizePool(r);
        return malformedOf(rep);
    }
    _loadLedger(rep) {
        const r = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : {};
        const rs = Array.isArray(r.receipts) ? r.receipts : [];
        const kept = [];
        for (let i = 0; i < rs.length && kept.length < SIMS_MAX_UNITS; i += 1) {
            const one = rs[i];
            if (!one || typeof one !== 'object') continue;
            kept.push({
                at: toStr(one.at),
                actionId: toStr(one.actionId),
                label: clampLen(one.label, 24),
                line: clampLen(one.line, 120),
                applied: Array.isArray(one.applied) ? one.applied.length : 0,
                skipped: Array.isArray(one.skipped) ? one.skipped.length : 0,
                capped: numOrNull(one.capped) === null ? 0 : Math.floor(numOrNull(one.capped)),
                evicted: numOrNull(one.evicted) === null ? 0 : Math.floor(numOrNull(one.evicted)),
                wrap: numOrNull(one.wrap) === null ? 0 : Math.floor(numOrNull(one.wrap)),
                mood: toStr(one.mood),
                wishDone: one.wishDone === true,
                kind: toStr(one.kind)
            });
        }
        this.receipts = kept;
        return malformedOf(rep);
    }
    _loadPolicy(rep) {
        const r = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : {};
        this.ledgerKeep = keepOr(r.ledgerKeep, SIMS_MAX_UNITS);
        return malformedOf(rep);
    }
    /**
     * 记忆流 + 今日愿望装载。
     *   ★ 两件事写在**一个键**里（源也一样：记忆与愿望同在角色维度的本地存储上），
     *     但四态判定要**分开做** —— 记忆坏了不等于愿望坏了。
     */
    _loadMemoriesAndWish(rep) {
        const bad = malformedOf(rep);
        this.memories = [];
        this.wish = null;
        this._wishState = SIMS_WISH_STATES[2];
        this._wishStale = null;
        /* ★ 先归零：否则早退分支会把**上一轮**的 _memBad 带到这一轮 ——
         *   第二次 probe 时「写了但认不出来」会被前一轮的 false 盖成「还没记过」。 */
        this._memBad = false;
        if (!rep || rep.ok !== true || rep.raw === null) {
            if (bad) {
                this._wishState = SIMS_WISH_STATES[3];
                this._memBad = true;
                return true;
            }
            return false;
        }
        const r = (rep.raw && typeof rep.raw === 'object') ? rep.raw : null;
        if (!r) {
            this._wishState = SIMS_WISH_STATES[3];
            this._memBad = true;
            return true;
        }
        const nm = normalizeMemories(r.memories);
        this.memories = nm.memories;
        this._memBad = nm.state === SIMS_MEMORY_STATES[2];
        const today = this.todayOf();
        const w = (r.wish && typeof r.wish === 'object') ? r.wish : null;
        const pw = parseSavedWish(w ? JSON.stringify(w) : '', today);
        this._wishState = pw.state;
        this.wish = pw.wish || null;
        this._wishStale = pw.stale || null;
        return false;
    }
    _persistNeeds() { this._writeJSON(NEEDS_KEY, { needs: this.needs }); }
    _persistPool() { this._writeJSON(POOL_KEY, {
        actions: this.pool.actions, events: this.pool.events, cursors: this.pool.cursors,
        generatedAt: this.pool.generatedAt
    }); }
    _persistLedger() { this._writeJSON(LEDGER_KEY, { receipts: this.receipts, ledgerKeep: this.ledgerKeep }); }
    _persistMemoriesAndWish() {
        this._writeJSON(JOURNAL_KEY, {
            memories: this.memories,
            wish: this.wish ? {
                date: this.wish.date, need: this.wish.need, actionId: this.wish.actionId,
                title: this.wish.title, desc: this.wish.desc,
                completed: this.wish.completed === true, at: this.wish.at
            } : null
        });
    }
    /* ---------- 缺省态（storage 取不出来时用；此时投影为 null） ---------- */
    _clearToDefaults() {
        this.needs = {};
        this.pool = emptyPool();
        this.memories = [];
        this.wish = null;
        this._wishState = SIMS_WISH_STATES[2];
        this._wishStale = null;
        this.receipts = [];
        this.ledgerKeep = SIMS_MAX_UNITS;
        this._needsBad = false;
        this._poolBad = false;
        this._memBad = false;
        this._badLedger = false;
    }

    /* ---------- 取数 ---------- */
    probe() {
        const rn = this._readRaw(NEEDS_KEY);
        const rp = this._readRaw(POOL_KEY);
        const rj = this._readRaw(JOURNAL_KEY);
        const rl = this._readRaw(LEDGER_KEY);
        const storageOk = !!(rn.ok && rp.ok && rj.ok && rl.ok);
        if (storageOk) {
            /* ★ 四格各自报「写了但认不出来」：源把这种与「还没记过」都画成空列表。 */
            this._needsBad = false;
            if (this._loadNeeds(rn)) this._needsBad = true;
            this._poolBad = this._loadPool(rp);
            this._loadMemoriesAndWish(rj);
            this._badLedger = this._loadLedger(rl);
            /* 策略与台账同键：装载时一并读出来（★ 走 _loadPolicy，不在这里另写一份口径） */
            this._loadPolicy(rl);
        } else {
            this._clearToDefaults();
            this._badLedger = false;
        }
        this._readingsOk = storageOk;
        this._readings = readingsOf(this.memories, this.pool, this._wishState, { receipts: this.receipts.length });
        /* 面的优先级：取不出来 > 有可用内容 > （写了但认不出来 > 还没记过）。 */
        const anyBad = this._needsBad || this._poolBad || this._memBad
            || this._wishState === SIMS_WISH_STATES[3] || this._badLedger === true;
        const hasUse = this.memories.length > 0 || this.pool.lines > 0 || this.pool.events.length > 0
            || Object.keys(this.needs).length > 0 || this.receipts.length > 0;
        this.face = storageOk
            ? (hasUse ? FACE_OK : faceOf(true, false, anyBad))
            : FACE_ABSENT;
        this._proj = storageOk ? this._project() : null;
        return this._proj;
    }
    /** 投影：视图只吃这一份。
     *  ★ 三处计数在「读数取不出来」时是 **null**（不是 0）—— 视图画「—」。 */
    _project() {
        return {
            face: this.face,
            faceText: this.faceTextOf(this.face),
            /* ★ 「这一格写了但认不出来」必须报出（源把它画成空列表）。 */
            malformed: (this._needsBad || this._poolBad || this._memBad
                || this._wishState === SIMS_WISH_STATES[3] || this._badLedger === true),
            readings: this._readings,
            mood: this.moodRow(),
            needs: this.needRows(),
            actions: this.actionRows(),
            events: this.eventRows(),
            wish: this.wishRow(),
            memories: this.memoryRows(),
            receipts: this.receiptRows(),
            policy: this.policyRow()
        };
    }

    /* ---------- 需求面 ---------- */
    /**
     * 六项逐项一行。
     *   ★ value 在「读不出来」时是 **null**（不是回落值）—— 视图据此画
     *     「这一项读不出来」而不是一根 5% 的进度条。
     */
    needRows() {
        const src = {};
        for (const k of SIMS_NEED_KEYS) if (this.needs[k] !== undefined) src[k] = this.needs[k];
        const ro = needsReadout(src);
        return ro.rows.map((r) => ({
            key: r.key, label: r.label, value: r.value, ok: r.ok,
            level: r.level, levelLabel: r.levelLabel, why: r.why,
            unreadableText: SIMS_NEED_UNREADABLE,
            icon: SIMS_ICON_OF[SIMS_CARE_OF[r.key]] || '',
            careLabel: (SIMS_ACTION_META[SIMS_CARE_OF[r.key]] || {}).label || ''
        }));
    }
    /** 心情一行（缺一项即读不出来，源落「非常不开心」）。 */
    moodRow() {
        const src = {};
        for (const k of SIMS_NEED_KEYS) if (this.needs[k] !== undefined) src[k] = this.needs[k];
        const m = moodOf(src);
        return {
            ok: m.ok, mood: m.mood, label: m.label, avg: m.avg, why: m.why,
            unknownText: SIMS_MOOD_UNKNOWN,
            given: Object.keys(src).length
        };
    }
    /** 六个行动逐行（带效果说明与「这一项读不出来会跳过」的预告）。 */
    actionRows() {
        const ro = needsReadout(this.needs);
        const broken = {};
        for (const r of ro.rows) if (!r.ok) broken[r.key] = true;
        return SIMS_ACTION_IDS.map((a) => {
            const meta = SIMS_ACTION_META[a];
            const face = this.pool.faces[a] || SIMS_POOL_STATES[2];
            const lines = this.pool.actions[a] || [];
            return {
                key: a,
                label: meta.label,
                icon: SIMS_ICON_OF[a] || '',
                need: meta.need,
                needLabel: SIMS_NEED_META[meta.need].label,
                effectText: effectText(meta.effects),
                poolState: face,
                poolText: SIMS_POOL_STATE_TEXT[face] || '',
                lineCount: lines.length,
                blocked: SIMS_NEED_KEYS.some((k) => broken[k] && Object.prototype.hasOwnProperty.call(meta.effects, k))
            };
        });
    }
    /** 小事件池逐条一行。 */
    eventRows() {
        return this.pool.events.map((e, i) => ({
            index: i,
            title: e.title,
            text: e.text,
            effectText: effectText(e.effects),
            hasEffects: !!(e.effects && Object.keys(e.effects).length)
        }));
    }
    /** 小事件池的**整格四态**（源只有「能拆开」与「当成空」；视图不许自己数条数推态）。 */
    eventsStateOf() { return this.pool.eventsState; }
    /** 今日愿望一行（四态各自带话）。 */
    wishRow() {
        const st = this._wishState;
        const w = this.wish;
        const stale = this._wishStale;
        return {
            state: st,
            stateText: SIMS_WISH_STATE_TEXT[st] || '',
            has: !!w,
            title: w ? w.title : (stale ? stale.title : ''),
            desc: w ? w.desc : (stale ? stale.desc : ''),
            needLabel: w ? (SIMS_NEED_META[w.need] ? SIMS_NEED_META[w.need].label : w.need) : '',
            actionId: w ? w.actionId : '',
            actionLabel: w ? ((SIMS_ACTION_META[w.actionId] || {}).label || w.actionId) : '',
            completed: !!(w && w.completed === true),
            date: w ? w.date : '',
            staleDate: stale ? stale.date : '',
            staleText: stale ? '存着的是 ' + stale.date + ' 那天的愿望，今天要用得重新定' : ''
        };
    }
    /** 记忆流逐条一行（含淘汰痕迹与未来时间戳两种坏读）。 */
    memoryRows(nowMs) {
        return this.memories.map((m, i) => {
            const age = memoryAgeOf(m.at, nowMs);
            return {
                index: i, title: m.title, text: m.text, effects: m.effects,
                auto: m.auto === true, ageOk: age.ok, ageLabel: age.label, ageWhy: age.why
            };
        });
    }
    receiptRows() {
        return this.receipts.map((r) => ({
            at: r.at, actionId: r.actionId, label: r.label, line: r.line,
            applied: r.applied, skipped: r.skipped, capped: r.capped,
            evicted: r.evicted, wrap: r.wrap, mood: r.mood,
            wishDone: r.wishDone === true, kind: r.kind
        }));
    }
    policyRow() {
        return {
            ledgerKeep: this.ledgerKeep,
            receiptCount: this.receipts.length,
            receiptFull: this.receipts.length >= this.ledgerKeep,
            memoryCount: this.memories.length,
            maxUnits: SIMS_MAX_UNITS,
            maxMemories: SIMS_MEMORY_LIMIT
        };
    }
    readings() { return this._readingsOk ? this._readings : null; }
    readingsOk() { return this._readingsOk === true; }
    faceOf() { return this.face; }
    summaryLine() {
        if (!this._readingsOk) return '读数拿不到（存储不可用）';
        const r = this._readings;
        const bits = ['记忆 ' + r.memories + ' 条'];
        bits.push('台词池合格 ' + r.poolOk + ' / ' + SIMS_ACTION_IDS.length);
        if (r.poolPartial) bits.push('不满三条 ' + r.poolPartial);
        if (r.poolAbsent) bits.push('还没生成 ' + r.poolAbsent);
        if (r.poolMalformed) bits.push('一格都用不上 ' + r.poolMalformed);
        bits.push('小事件 ' + r.events + ' 条');
        bits.push('回执 ' + this.receipts.length + ' / ' + this.ledgerKeep + ' 条');
        return bits.join(' · ');
    }
    /** 真源表读数（视图的键面来自这几张，不许手写）。 */
    catalogs() {
        return {
            needKeys: SIMS_NEED_KEYS,
            needMeta: SIMS_NEED_META,
            actionIds: SIMS_ACTION_IDS,
            actionMeta: SIMS_ACTION_META,
            careOf: SIMS_CARE_OF,
            iconOf: SIMS_ICON_OF,
            levels: SIMS_LEVELS,
            levelMeta: SIMS_LEVEL_META,
            moods: SIMS_MOODS,
            moodMeta: SIMS_MOOD_META,
            poolStates: SIMS_POOL_STATES,
            poolStateText: SIMS_POOL_STATE_TEXT,
            wishStates: SIMS_WISH_STATES,
            wishStateText: SIMS_WISH_STATE_TEXT,
            memoryStates: SIMS_MEMORY_STATES,
            faces: SIMS_FACES,
            faceText: SIMS_FACE_TEXT,
            replyWhys: SIMS_REPLY_WHYS,
            needUnreadable: SIMS_NEED_UNREADABLE,
            moodUnknown: SIMS_MOOD_UNKNOWN,
            limits: {
                valueMin: SIMS_VALUE_MIN,
                valueMax: SIMS_VALUE_MAX,
                effectMin: SIMS_EFFECT_MIN,
                effectMax: SIMS_EFFECT_MAX,
                lineLimit: SIMS_LINE_LIMIT,
                eventLimit: SIMS_EVENT_LIMIT,
                memoryLimit: SIMS_MEMORY_LIMIT,
                maxUnits: SIMS_MAX_UNITS
            },
            tabs: ['needs', 'pool', 'wish', 'memory', 'ledger', 'policy']
        };
    }
    levelLabelOf(k) { return SIMS_LEVEL_META[k] ? SIMS_LEVEL_META[k].label : SIMS_NEED_UNREADABLE; }
    moodLabelOf(k) { return SIMS_MOOD_META[k] ? SIMS_MOOD_META[k].label : SIMS_MOOD_UNKNOWN; }
    actionLabelOf(k) { return SIMS_ACTION_META[k] ? SIMS_ACTION_META[k].label : String(k); }
    poolTextOf(k) { return SIMS_POOL_STATE_TEXT[k] || String(k); }
    wishTextOf(k) { return SIMS_WISH_STATE_TEXT[k] || String(k); }
    faceTextOf(k) { return SIMS_FACE_TEXT[k] || String(k); }

    /* ---------- 行动：点一次落一条，逐项报账 ---------- */
    /**
     * performAction(actionId) —— 点一个行动。
     *   ① 从池子里取一句台词（池空 / 绕回都如实报）；
     *   ② 把固定效果落到六项上（逐项报 from → to，跳过项要指明为什么）；
     *   ③ 落一条记忆（超限给淘汰数，**不整本清空**）；
     *   ④ 回头看看今日愿望是不是被这件事完成了（源只认「碰了那一项」）；
     *   ⑤ 落一张台账回执。
     */
    performAction(actionId, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const aid = toStr(actionId);
        const meta = SIMS_ACTION_META[aid];
        if (!meta) return { ok: false, reason: 'unknown_action', saw: actionId };
        const pick = nextFromPool(this.pool.actions[aid], this.pool.cursors[aid]);
        if (!pick.ok) return { ok: false, reason: 'empty_pool', actionId: aid, label: meta.label };
        const res = applyEffects(this.needs, meta.effects);
        this.needs = res.needs;
        this.pool.cursors[aid] = pick.cursor;
        const mem = addMemory(this.memories, {
            title: meta.label, text: pick.line, effects: meta.effects, auto: false,
            at: numOrNull(o.at) === null ? Date.now() : Math.floor(numOrNull(o.at))
        }, SIMS_MEMORY_LIMIT);
        this.memories = mem.list;
        const done = this._wishDoneBy(meta.effects, aid);
        const mood = moodOf(this.needs);
        this.receipts.push({
            at: toStr(o.at), actionId: aid, label: meta.label, line: pick.line,
            applied: res.applied, skipped: res.skipped,
            capped: res.applied.filter((x) => x.capped === true).length,
            evicted: mem.evicted, wrap: pick.wrap,
            mood: mood.ok ? mood.label : SIMS_MOOD_UNKNOWN,
            wishDone: done, kind: 'action'
        });
        this._trimLedger();
        this._persistNeeds();
        this._persistPool();
        this._persistMemoriesAndWish();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return {
            ok: true, actionId: aid, label: meta.label, line: pick.line,
            wrapped: pick.wrapped, wrap: pick.wrap, poolSize: pick.poolSize,
            applied: res.applied, skipped: res.skipped, rejected: res.rejected,
            evicted: mem.evicted, over: mem.over, limit: mem.limit,
            wishDone: done, mood: mood.ok ? mood.label : SIMS_MOOD_UNKNOWN
        };
    }
    /**
     * triggerEvent(opts) —— 点一次小事件。
     *   ★ 源在池空时只弹一句「请先刷新生成小事件」，而**不说明池里到底有没有东西**；
     *   本件把「没生成」与「生成了但一条都用不上」分开报（池子四态）。
     */
    triggerEvent(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const pick = nextFromPool(this.pool.events, this.pool.cursors.randomEvent);
        if (!pick.ok) {
            return {
                ok: false, reason: 'empty_pool', poolState: this.pool.eventsState,
                poolText: SIMS_POOL_STATE_TEXT[this.pool.eventsState] || ''
            };
        }
        const ev = this.pool.events[pick.index];
        const res = applyEffects(this.needs, ev.effects || {});
        this.needs = res.needs;
        this.pool.cursors.randomEvent = pick.cursor;
        const mem = addMemory(this.memories, {
            title: ev.title, text: ev.text, effects: ev.effects, auto: true,
            at: numOrNull(o.at) === null ? Date.now() : Math.floor(numOrNull(o.at))
        }, SIMS_MEMORY_LIMIT);
        this.memories = mem.list;
        const done = this._wishDoneBy(ev.effects || {}, null);
        const mood = moodOf(this.needs);
        this.receipts.push({
            at: toStr(o.at), actionId: '', label: ev.title, line: ev.text,
            applied: res.applied, skipped: res.skipped,
            capped: res.applied.filter((x) => x.capped === true).length,
            evicted: mem.evicted, wrap: pick.wrap,
            mood: mood.ok ? mood.label : SIMS_MOOD_UNKNOWN,
            wishDone: done, kind: 'event'
        });
        this._trimLedger();
        this._persistNeeds();
        this._persistPool();
        this._persistMemoriesAndWish();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return {
            ok: true, title: ev.title, text: ev.text, effectText: effectText(ev.effects),
            wrapped: pick.wrapped, wrap: pick.wrap, evicted: mem.evicted,
            applied: res.applied, skipped: res.skipped, wishDone: done
        };
    }
    /**
     * 愿望完成判定（源「碰了那一项就算完成」）。
     *   ★ 源写的是：愿望有 actionId 时「只要 actionId 对得上」就算完成（不管数值有没有动）；
     *     本件保留这个口径但**把判定依据报出去**（wishDoneBy 的 reason），
     *     因为「数值压根没动但愿望被标完成」这件事用户应当看得见。
     */
    _wishDoneBy(effects, actionId) {
        const w = this.wish;
        if (!w || w.completed === true) return false;
        const san = sanitizeEffects(effects);
        const want = toStr(w.actionId);
        const aid = toStr(actionId);
        if (want && aid && want === aid) {
            this.wish = {
                date: w.date, need: w.need, actionId: w.actionId, title: w.title,
                desc: w.desc, completed: true, at: toStr(w.at)
            };
            this._persistMemoriesAndWish();
            return true;
        }
        if (!Object.prototype.hasOwnProperty.call(san.effects, w.need)) return false;
        if (san.effects[w.need] <= 0) return false;
        this.wish = {
            date: w.date, need: w.need, actionId: w.actionId, title: w.title,
            desc: w.desc, completed: true, at: toStr(w.at)
        };
        this._persistMemoriesAndWish();
        return true;
    }
    /** setWish(wish) —— 定/重定今日愿望（源在过期时直接盖掉旧的那条，不留痕）。 */
    setWish(wish, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const w = (wish && typeof wish === 'object') ? wish : null;
        if (!w) return { ok: false, reason: 'empty_input' };
        const title = clampLen(w.title, 40);
        const desc = clampLen(w.desc, 80);
        if (!title || !desc) return { ok: false, reason: title ? 'no_desc' : 'no_title' };
        const aid = SIMS_ACTION_IDS.indexOf(toStr(w.actionId)) >= 0 ? toStr(w.actionId) : '';
        const need = SIMS_NEED_KEYS.indexOf(toStr(w.need)) >= 0 ? toStr(w.need) : '';
        const prev = this._wishState;
        /* ★ 外部显式给了日子就记下来：随后 probe 的回读必须用同一个日子，
         *   否则刚定下的愿望会被自己判成「过期的」。 */
        if (toStr(o.today)) this._today = toStr(o.today);
        this.wish = {
            date: toStr(o.today) || todayKeyOf(), need: need, actionId: aid,
            title: title, desc: desc, completed: false, at: toStr(o.at)
        };
        this._wishState = SIMS_WISH_STATES[0];
        this._wishStale = null;
        this._persistMemoriesAndWish();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, wish: this.wishRow(), replacedStale: prev === SIMS_WISH_STATES[1], prevState: prev };
    }
    /** buildWishNow() —— 按最弱的那项定今天的愿望（源的做法，但缺项会如实拒）。 */
    buildWishNow(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const today = toStr(o.today) || this.todayOf();
        const b = buildWish(this.needs, today);
        if (!b.ok) return { ok: false, reason: b.why, unknown: b.unknown };
        return this.setWish(b.wish, { today: today, at: o.at });
    }
    /** reloadWish() —— 把今日愿望重读一遍（过期态）。 */
    wishStateOf() { return this._wishState; }

    /* ---------- 回信归一：哪一步坏的要说出来 ---------- */
    /** requestText(form) —— 产一段可复制的要求文本（本件不替你发请求）。 */
    requestText(form) {
        const text = composeRequestText(form);
        this._draft = text;
        return { ok: true, text: text };
    }
    draftOf() { return this._draft; }
    /**
     * ingestReply(raw, opts) —— 收拾一段模型回信。
     *   ★ 失败时分五种因报出（源全塔成一句「无法解析响应」）；
     *     成功时把「缺了哪几项需求」与「池子逐格四态」一并报出。
     *   mode: 'merge'（默认，只就回信中给了的项） / 'replace'（整份替换）。
     */
    ingestReply(raw, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const text = toStr(raw);
        if (!text.trim()) return { ok: false, reason: 'empty_input' };
        const r = parseReply(text, { today: toStr(o.today) || this.todayOf() });
        if (!r.ok) {
            const why = SIMS_REPLY_WHYS[r.why] || { label: r.why, why: '' };
            return { ok: false, reason: r.why, whyLabel: why.label, whyText: why.why, truncated: r.truncated === true };
        }
        const before = this.moods();
        const merged = {};
        const current = {};
        for (const k of SIMS_NEED_KEYS) if (this.needs[k] !== undefined) current[k] = this.needs[k];
        for (const k of SIMS_NEED_KEYS) merged[k] = (o.mode === 'replace') ? r.needs[k] : (r.needs[k] !== undefined ? r.needs[k] : current[k]);
        this.needs = merged;
        const np = normalizePool({ actions: r.pool.actions, events: r.pool.events, indexes: this.pool.cursors });
        this.pool = np;
        this._poolBad = false;
        let wishSet = false;
        if (r.wish && r.wish.title && r.wish.desc) {
            const set = this.setWish(r.wish, { today: toStr(o.today) });
            wishSet = set.ok === true;
        }
        this._persistNeeds();
        this._persistPool();
        this.probe();
        if (this._view) this._view.refresh();
        return {
            ok: true, mode: (o.mode === 'replace') ? 'replace' : 'merge',
            given: Object.keys(r.needs).length, missing: r.missing.slice(),
            pool: { faces: np.faces, eventsState: np.eventsState, lines: np.lines, rejected: np.rejected.length },
            wish: wishSet, thoughts: r.thoughts,
            moodBefore: before, moodAfter: this.moods()
        };
    }
    moods() {
        const src = {};
        for (const k of SIMS_NEED_KEYS) if (this.needs[k] !== undefined) src[k] = this.needs[k];
        const m = moodOf(src);
        return m.ok ? m.label : SIMS_MOOD_UNKNOWN;
    }

    /* ---------- 策略 / 台账 ---------- */
    setLedgerKeep(v) {
        const saw = v;
        this.ledgerKeep = keepOr(v, SIMS_MAX_UNITS);
        this._trimLedger();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saw: saw, took: this.ledgerKeep, max: SIMS_MAX_UNITS };
    }
    ledgerKeepOf() { return this.ledgerKeep; }
    /** 裁剪台账到保留数。
     *
     *  ★ 循环上界**自己带下界**：上游归一（keepOr）一旦被绕过，负保留数会让
     *    「条数 > 负数」恒真 ⇒ **无限循环**把界面挂死（v3.39.0 负控制实测到过这一族）。
     *    单靠上游归一就是单点防线。
     */
    _trimLedger() {
        const lim = Math.max(1, numOrSelf(this.ledgerKeep, SIMS_MAX_UNITS));
        while (this.receipts.length > lim) this.receipts.shift();
    }
    clearLedger() {
        this.receipts = [];
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true };
    }
    /** 清空记忆流（**只清记忆**，不动需求与池 —— 源把两者混在一个开关上）。 */
    clearMemories() {
        const n = this.memories.length;
        this.memories = [];
        this._persistMemoriesAndWish();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, cleared: n };
    }
    /** resetNeeds() —— 六项回到初值（用户主动重置，与「读不出来」不同形）。 */
    resetNeeds() {
        const d = needDefaults(null);
        this.needs = {};
        for (const k of SIMS_NEED_KEYS) this.needs[k] = d[k];
        this._persistNeeds();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, needs: this.needRows() };
    }

    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'needs');
        const ok = ['needs', 'pool', 'wish', 'memory', 'ledger', 'policy'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'needs';
        return this._tab;
    }
    currentKey() { return this._current; }
    openMemory(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.memories.length) {
            return { ok: false, reason: 'out_of_range', saw: index };
        }
        this._current = String(i);
        if (this._view) this._view.refresh();
        return { ok: true, row: this.memoryRows()[i] };
    }
    closeMemory() {
        this._current = '';
        if (this._view) this._view.refresh();
        return { ok: true };
    }

    /* ---------- 生命周期 ---------- */
    /** 换会话：需求、池、记忆、台账全是「这个角色的账」，故全部重取。 */
    onChatChanged() {
        this._current = '';
        this._draft = '';
        this._tab = 'needs';
        this._today = '';
        /* ★ 四格的装载由 probe **一处**承担（单一装载路径）：
         *   两处装载会造出「首次渲染走这套、换会话走那套」的双口径，
         *   而双口径必定分歧（本仓为此吃过亏）。 */
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new NeedsimView(this, this.shell, this.storage);
        this._view.render();
    }
}
