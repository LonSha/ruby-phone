/* ========================================================
 * musicdesk-app.js — [v3.42.0] 曲库案头 · 落盘与接线
 *
 * 数据层：musicdesk-data.js（纯函数内核）  视图层：musicdesk-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：曲目归一 / 去重 / 封面四态 / 歌词归一 / 队列与播放模式 /
 *      来源读数 / 校验序 / 把握分 / 回执归一 / 读数 —— 都不碰存储、不碰网络；
 *   ③ 落盘（PhoneStorage）：四条会话键，全走 /^musicdesk_/ 前缀。
 *
 * ── 四条会话键 ──────────────────────────────────────────
 *   · musicdesk_lib     —— 曲库（归一后的曲目表）+ 来源表 + 队列游标 + 播放模式；
 *   · musicdesk_lyrics  —— 当前这一首的歌词原文与解析读数；
 *   · musicdesk_ledger  —— 台账（每次收拾回信 / 换模式 / 跳曲 / 裁队列的回执）；
 *   · musicdesk_policy  —— 策略（队列上限）。
 *   ★ 为什么曲库与歌词分开：曲库是「这一段关系的收藏」（用户攒的），
 *     歌词是「眼下这一首的附带物」（随手贴的）。源把两者混在一处本地存储里，
 *     于是清一次歌词会把曲库一起清掉。
 *
 * ── 不缝的那一块（两个源的核心能力，本件一律不接）──────
 *   ① 小鼠机的 netease 一族：自己持多家聚合 API 与 NCM 节点、自己发请求、
 *      自己 `new Audio()` 真放一遍验链接、自己从本地存储直读账号 uid 与 cookie；
 *   ② EPhone 的第三方音乐聚合：同上一路，另有扫码账号桥与外链托底封面。
 *   本件**零网络调用、零密钥读、零音频元件、零外链**：只收拾用户从任何
 *   对话端拿回来的那份曲目数据，并产**可复制的要求文本**（composeRequestText）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 曲库读不出来 **不许**读成「一条都没有」（四态面分开判）；
 *   · 去重合并 **不许**无声（逐条报 merged 与合并进哪一条）；
 *   · 歌词坏行 **不许**静默丢弃（报 dropped.noTime / noText）；
 *   · 时长读不出来 **不许**画成 00:00（与真的 0 秒不同形）；
 *   · 播放模式认不出来 **不许**静默回落顺序播放（报 saw 与 why）；
 *   · 坏游标 / 越界定位 **不许**静默夹成 0（一律拒并计数）；
 *   · 队列超限 **不许**静默截断（报 capped 与截掉几条）；
 *   · 来源全在冷静 **不许**画成「没有来源」（absent 与 cooling_only 不同形）；
 *   · 换会话后旧曲库与旧游标 **不许**留着（onChatChanged 四格全量重取）。
 * ======================================================== */
'use strict';
import {
    MUS_PLAYBACK_MODES, MUS_PLAYBACK_MODE_META, MUS_MODES, MUS_MODE_META,
    MUS_STATES, MUS_STATE_TEXT, MUS_FACES, MUS_FACE_TEXT, MUS_SORT_WHY,
    MUS_VERIFY_WHYS, MUS_REPLY_WHYS, MUS_QUEUE_LIMIT, MUS_MAX_UNITS,
    MUS_COOLING_FAILS, MUS_COOLING_MS, MUS_MATCH_MIN,
    normalizeSong, songKeyOf, baseIdOf, guardQueue, coverOf,
    durationOf, parseLrc, formatTime, modeOf, nextIndex, seekTo,
    healthOf, sortSources, pickSource, verifyOrder, matchScore,
    parseReply, composeRequestText, readingsOf, faceOf, todayKeyOf
} from './musicdesk-data.js';
import { MusicdeskView } from './musicdesk-view.js';
import { writeReceipt } from '../../config/write-receipt.js';
import { numOrNull } from '../../config/num-gate.js';

/* 四条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中
   /^musicdesk_/，否则跨会话串味。源把曲库、歌词、来源健康都放在**无角色维度**
   的键下（换角色后旧曲库与旧游标原样留着，串味且不报）。 */
const LIB_KEY = 'musicdesk_lib';
const LYRICS_KEY = 'musicdesk_lyrics';
const LEDGER_KEY = 'musicdesk_ledger';
const POLICY_KEY = 'musicdesk_policy';

/** 四态常量**从真源数组派生**，不手写标识符形（本仓 J7 形态：手写一份靠碰巧
 *  拼写一致对齐，真源增删一态就静默走兜底）。 */
const FACE_OK = MUS_FACES[0];
const FACE_EMPTY = MUS_FACES[1];
const FACE_MALFORMED = MUS_FACES[2];
const FACE_ABSENT = MUS_FACES[3];

/** 读数画横线用的那一个字符（与视图层同款，走拼装形）。 */
const DASH_UNIT = String.fromCharCode(8212);

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

/** 队列上限取值门：显式传入的**正整数**才认，否则回落真源上限。 */
function keepOr(v, fallback) {
    const fb = (numOrNull(fallback) === null) ? MUS_MAX_UNITS : Math.floor(numOrNull(fallback));
    const n = numOrNull(v);
    if (n === null || !Number.isInteger(n) || n < 1) return fb;
    return Math.min(n, MUS_MAX_UNITS);
}

/** 曲目表归一：逐条走 normalizeSong，坏条不计入（但要报出坏几条）。 */
function normalizeList(raw) {
    const out = { list: [], given: 0, bad: 0, items: [] };
    if (!Array.isArray(raw)) return out;
    out.given = raw.length;
    for (let i = 0; i < raw.length; i += 1) {
        const one = raw[i];
        if (!one || typeof one !== 'object') { out.bad += 1; continue; }
        const n = normalizeSong(one);
        if (n.ok !== true) { out.bad += 1; continue; }
        out.list.push(n.song);
        out.items.push({ key: songKeyOf(n.song), base: baseIdOf(n.song) });
    }
    return out;
}

export class MusicdeskApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        /* 曲库（**归一后**才进来；原始形状一律不留） */
        this.songs = [];
        /* 来源表（**只读**：本件不发请求，来源是用户自己填的清单） */
        this.sources = [];
        /* 队列去重结果（guardQueue 的产物） */
        this.queue = null;
        /* 歌词解析结果 */
        this.lrc = null;
        /* 播放模式（认不出来时**保持上一次**，但要报 saw 与 why） */
        this.mode = MUS_PLAYBACK_MODES[0];
        /* 队列游标（**只有 seekTo 通过才动**） */
        this.cursor = 0;
        /* 台账 */
        this.receipts = [];
        /* 策略：队列上限 */
        this.queueKeep = MUS_QUEUE_LIMIT;
        /* 策略：台账最多留几条 */
        this.ledgerKeep = MUS_MAX_UNITS;
        /* 视图态（进重绑表） */
        this._current = '';
        this._draft = '';
        this._tab = 'shelf';
        this.face = FACE_ABSENT;
        /* 四格的「写了但认不出来」痕迹（**分开判**） */
        this._libBad = false;
        this._lyrBad = false;
        this._ledBad = false;
        this._polBad = false;
        this._readings = null;
        this._readingsOk = false;
        this._proj = null;
        this._view = null;
        /* ★ 「现在几点」只许有一个出处：外部显式给过就用它，否则用系统时钟。
         *   两处各自取 —— 落盘时用外部给的时间、回读时用系统时钟 —— 会让
         *   冷却读数当场分岔（这一帧「还剩 30 秒」、下一帧「已经过了」）。 */
        this._now = 0;
        /* ★ 构造末尾就取一次数：否则读数与曲库在 render() 之前是空的 ——
         *   任何先读后画的路径都会把「还没取数」看成「一条都没有」。 */
        this.probe();
    }
    /** 「现在几点」的唯一出处（视图与数据层都不许各自取时钟）。 */
    nowOf(at) {
        const n = numOrNull(at);
        if (n !== null) return n;
        if (this._now) return this._now;
        return Date.now();
    }
    /**
     * 取数（**分两种回报**）：ok 说「storage 能不能用」，raw 说「这一格读到了什么」。
     *   · ok === false ⇒ storage 没给 / 一取就抛 ⇒ 这是「取不出来」，不是「空的」；
     *   · ok === true, raw === null ⇒ storage 是好的，只是这一格没有 / 不是合法 JSON。
     */
    /** 「存储能不能用」的**唯一出处**：get 与 set 都必须是函数。
     *  ★ 「能读不能写」也算不可用 —— 本件的核心动作就是落盘，能读不能写意味着
     *    「当场看着成功、下次打开全没了」。
     *  ★ 取数面与动作口的 saved **必须同用这一处判**：两处各判一次，一定会分岔
     *    （本仓吃过的双口径形态）。 */
    _storageUsable() {
        return !!(this.storage
            && typeof this.storage.get === 'function'
            && typeof this.storage.set === 'function');
    }
    /** 「这次做的东西**重开还在**吗」的唯一出处：写进去了 **且** 这一轮存储读得出来。
     *  ★ 只报「写没写进去」是不够的：取数一取就抛（存储坏了）时写入往往照样成功，
     *    报 saved:true 等于骗用户「重开还在」—— 那正是本件守的那种
     *    「看起来没坏、结果不对」。 */
    _savedOk(wrote) {
        return !!(wrote && this._readingsOk);
    }
    _readRaw(key) {
        if (!this._storageUsable()) return { ok: false, raw: null, text: null };
        let text = null;
        try { text = this.storage.get(key); }
        catch (_e) { return { ok: false, raw: null, text: null }; }
        if (typeof text !== 'string') return { ok: true, raw: text, text: null };
        try { return { ok: true, raw: JSON.parse(text), text: text };
        } catch (_e) { return { ok: true, raw: null, text: text }; }
    }
    _writeJSON(key, v) {
        try {
            if (!this._storageUsable()) return false;
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }
    /* ---------- 装载 ---------- */
    /**
     * 曲库格装载：曲目表 + 来源表 + 游标 + 播放模式（**一格四件事，分开判**）。
     *   ★ 源把「曲库读不出来」与「曲库是空的」画成同一屏；本件四态分开。
     */
    _loadLibrary(rep) {
        this.songs = [];
        this.sources = [];
        this.cursor = 0;
        this.mode = MUS_PLAYBACK_MODES[0];
        this._libBad = false;
        if (!rep || rep.ok !== true) return false;
        const r = (rep.raw && typeof rep.raw === 'object' && !Array.isArray(rep.raw)) ? rep.raw : null;
        if (!r) {
            this._libBad = malformedOf(rep);
            return this._libBad;
        }
        const nl = normalizeList(r.songs);
        this.songs = nl.list;
        this._givenSongs = nl.given;
        this._badSongs = nl.bad;
        const rawSources = Array.isArray(r.sources) ? r.sources : [];
        this.sources = rawSources;
        const m = modeOf(r.mode);
        if (m.mode) this.mode = m.mode;
        const want = numOrNull(r.cursor);
        const s = seekTo(this.songs, want === null ? 0 : want);
        this.cursor = s.ok ? s.index : 0;
        return malformedOf(rep);
    }
    _loadLyrics(rep) {
        this.lrc = null;
        this._lrcText = '';
        this._lyrBad = false;
        if (!rep || rep.ok !== true) return false;
        const r = (rep.raw && typeof rep.raw === 'object' && !Array.isArray(rep.raw)) ? rep.raw : null;
        if (!r) {
            this._lyrBad = malformedOf(rep);
            return this._lyrBad;
        }
        this._lrcText = toStr(r.text);
        this.lrc = parseLrc(this._lrcText, MUS_MAX_UNITS * 8);
        return false;
    }
    _loadLedger(rep) {
        const r = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : {};
        const rs = Array.isArray(r.receipts) ? r.receipts : [];
        const kept = [];
        for (let i = 0; i < rs.length && kept.length < MUS_MAX_UNITS; i += 1) {
            const one = rs[i];
            if (!one || typeof one !== 'object') continue;
            kept.push({
                at: toStr(one.at),
                kind: toStr(one.kind),
                label: clampLen(one.label, 24),
                line: clampLen(one.line, 120),
                given: numOrSelf(one.given, 0),
                kept: numOrSelf(one.kept, 0),
                merged: numOrSelf(one.merged, 0),
                capped: numOrSelf(one.capped, 0),
                dropped: numOrSelf(one.dropped, 0),
                saw: clampLen(one.saw, 32),
                why: toStr(one.why)
            });
        }
        this.receipts = kept;
        return malformedOf(rep);
    }
    _loadPolicy(rep) {
        const r = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : {};
        this.queueKeep = keepOr(r.queueKeep, MUS_QUEUE_LIMIT);
        this.ledgerKeep = keepOr(r.ledgerKeep, MUS_MAX_UNITS);
        return malformedOf(rep);
    }
    _persistLibrary() {
        /* ★ 返回值**必须透出**（写不进去不是「没事」）：见各动作口的 saved 字段 ——
         *   存储能读不能写时，界面上看着成功、下次打开全没了（本版真踩到过）。 */
        return this._writeJSON(LIB_KEY, {
            songs: this.songs, sources: this.sources,
            cursor: this.cursor, mode: this.mode,
            savedAt: this.nowOf(null)
        });
    }
    _persistLyrics() {
        return this._writeJSON(LYRICS_KEY, { text: this.lrc ? this._lrcText : '' });
    }
    _persistLedger() { return this._writeJSON(LEDGER_KEY, { receipts: this.receipts, ledgerKeep: this.ledgerKeep }); }
    _persistPolicy() { return this._writeJSON(POLICY_KEY, { queueKeep: this.queueKeep, ledgerKeep: this.ledgerKeep }); }
    /* ---------- 缺省态（storage 取不出来时用；此时投影为 null） ---------- */
    _clearToDefaults() {
        this.songs = [];
        this.sources = [];
        this.queue = null;
        this.lrc = null;
        this.mode = MUS_PLAYBACK_MODES[0];
        this.cursor = 0;
        this.receipts = [];
        this.queueKeep = MUS_QUEUE_LIMIT;
        this.ledgerKeep = MUS_MAX_UNITS;
        this._libBad = false;
        this._lyrBad = false;
        this._ledBad = false;
        this._polBad = false;
        this._givenSongs = 0;
        this._badSongs = 0;
        this._lrcText = '';
    }

    /* ---------- 取数 ---------- */
    probe(at) {
        const n = numOrNull(at);
        if (n !== null) this._now = n;
        const rl = this._readRaw(LIB_KEY);
        const ry = this._readRaw(LYRICS_KEY);
        const rg = this._readRaw(LEDGER_KEY);
        const rp = this._readRaw(POLICY_KEY);
        const storageOk = !!(rl.ok && ry.ok && rg.ok && rp.ok);
        if (storageOk) {
            /* ★ 四格各自报「写了但认不出来」：源把这种与「还没记过」都画成空列表。 */
            this._libBad = this._loadLibrary(rl);
            this._lyrBad = this._loadLyrics(ry);
            this._ledBad = this._loadLedger(rg);
            this._polBad = this._loadPolicy(rp);
        } else {
            this._clearToDefaults();
        }
        this.queue = guardQueue(this.songs, this.queueKeep);
        if (!seekTo(this.songs, this.cursor).ok) this.cursor = 0;
        this._readingsOk = storageOk;
        this._readings = readingsOf({
            songs: storageOk ? this.songs : null,
            lrc: this.lrc,
            sources: this.sources,
            queue: this.queue,
            now: this.nowOf(null)
        });
        /* 面的优先级：存储取不出来 > 有可用内容 > （写了但认不出来 > 还没收进来）。 */
        const anyBad = this._libBad || this._lyrBad || this._ledBad || this._polBad;
        const hasUse = this.songs.length > 0 || this.receipts.length > 0 || this.sources.length > 0;
        if (!storageOk) this.face = FACE_ABSENT;
        else if (hasUse) this.face = FACE_OK;
        else if (anyBad) this.face = FACE_MALFORMED;
        else if (this.songs.length) this.face = FACE_OK;
        else this.face = FACE_EMPTY;
        this._proj = storageOk ? this._project() : null;
        return this._proj;
    }
    /** 投影：视图只吃这一份。
     *  ★ 三处计数在「读数取不出来」时是 **null**（不是 0）—— 视图画横线。 */
    _project() {
        return {
            face: this.face,
            faceText: this.faceTextOf(this.face),
            /* ★ 「这一格写了但认不出来」必须报出（源把它画成空列表）。 */
            malformed: !!(this._libBad || this._lyrBad || this._ledBad || this._polBad),
            readings: this._readings,
            songs: this.songRows(),
            covers: this.coverRows(),
            lyrics: this.lyricRows(),
            queue: this.queueRow(),
            modes: this.modeRows(),
            sources: this.sourceRows(),
            receipts: this.receiptRows(),
            policy: this.policyRow(),
            request: this._draft
        };
    }

    /* ---------- 曲库面 ---------- */
    /**
     * 曲目逐条一行。
     *   ★ duration 在「读不出来」时是 **null**（不是 0）—— 视图据此画横线
     *     而不是 00:00（源把读不出来的时长画成 00:00）。
     */
    songRows() {
        const out = [];
        const now = this.nowOf(null);
        for (let i = 0; i < this.songs.length; i += 1) {
            const s = this.songs[i];
            /* ★ 时长这里**不许**再拿归一的原始字段重判一遍：曲库落盘的形状里
             *   没有 duration 这个字段，只有归一时的 seconds 与 secondsWhy。
             *   读得出来 ⇒ 拿 seconds 判一次；读不出来 ⇒ 直接把归一时记下的那个因
             *   端出来（不重判成 not_number，否则「太大 / 太小 / 不是数」三形会塌成一形）。
             *   本版真踩到过：重取一个不存在的字段，会让**每一首读得出来的曲目**
             *   在画面上都变成一条横线，而且不报任何错。 */
            const hasDur = (typeof s.seconds === 'number');
            const d = hasDur
                ? durationOf(s.seconds)
                : { ok: false, seconds: null, why: (toStr(s.secondsWhy) || 'not_number') };
            const c = coverOf(s);
            const t = hasDur ? formatTime(s.seconds) : formatTime(null);
            out.push({
                index: i,
                id: s.id,
                name: s.name,
                artist: s.artist,
                album: s.album,
                key: songKeyOf(s),
                gone: !!(s.gone || s.notFound),
                durationOk: d.ok === true,
                durationText: t.text,
                durationWhy: d.ok ? 'ok' : d.why,
                coverState: c.state,
                coverI: c.i,
                coverTone: c.tone,
                coverInitial: c.initial,
                onCursor: (i === this.cursor),
                at: now
            });
        }
        return out;
    }
    /** 封面四态各几首（读数取不出来时整格 null，不是四个零）。 */
    coverRows() {
        if (!this._readingsOk) return null;
        const c = this._readings.covers;
        /* ★ 读数在但封面计数整格没有 ⇒ 也算读数拿不到（视图画横线）。
         *   给四个零会让「读不到」被画成「四种封面各 0 首」。 */
        if (!c) return null;
        return [
            { state: MUS_STATES[0], text: MUS_STATE_TEXT[MUS_STATES[0]], n: c.ok },
            { state: MUS_STATES[1], text: MUS_STATE_TEXT[MUS_STATES[1]], n: c.partial },
            { state: MUS_STATES[2], text: MUS_STATE_TEXT[MUS_STATES[2]], n: c.absent },
            { state: MUS_STATES[3], text: MUS_STATE_TEXT[MUS_STATES[3]], n: c.malformed }
        ];
    }
    /** 歌词逐条一行 + 丢弃读数（坏行**不静默**）。 */
    lyricRows() {
        const l = this.lrc;
        if (!l) return { lines: [], kept: null, tags: null, noTime: null, noText: null, capped: null, why: 'absent' };
        return {
            lines: l.lines.map((x, i) => ({
                index: i,
                at: x.at,
                timeText: formatTime(x.at).text,
                text: x.text
            })),
            kept: l.kept,
            tags: l.tags,
            noTime: l.dropped.noTime,
            noText: l.dropped.noText,
            capped: l.capped,
            why: l.why
        };
    }
    /** 队列一行（去重与超限**逐项报**）。 */
    queueRow() {
        const q = this.queue;
        if (!q) return null;
        const s = seekTo(this.songs, this.cursor);
        const picked = pickSource(this.sources, this.nowOf(null));
        const order = verifyOrder(this._lastKey, this.songs.map((x) => songKeyOf(x)));
        return {
            given: q.given,
            kept: q.kept,
            merged: q.merged,
            droppedNoId: q.dropped.no_id,
            droppedNoName: q.dropped.no_name,
            capped: q.capped,
            limit: q.limit,
            over: !!q.over,
            why: q.why,
            cursorOk: s.ok,
            cursorIndex: s.ok ? s.index : -1,
            cursorSize: s.size,
            cursorWhy: s.why,
            cursorGiven: s.given,
            sourcePick: picked.why,
            order: order.why
        };
    }
    /** 三种播放模式逐行（当前那一条标出来）。 */
    modeRows() {
        return MUS_PLAYBACK_MODES.map((k) => ({
            key: k,
            label: MUS_PLAYBACK_MODE_META[k].label,
            hint: MUS_PLAYBACK_MODE_META[k].hint,
            on: (k === this.mode)
        }));
    }
    /** 来源逐行（偏好在先 + 冷却读数）。 */
    sourceRows() {
        const rows = sortSources(this.sources, this.nowOf(null));
        return rows.map((r) => ({
            key: r.key,
            url: r.url,
            pending: r.pending,
            state: r.state,
            stateText: MUS_STATE_TEXT[r.state],
            why: r.why,
            left: r.left,
            leftText: r.left > 0 ? ('还剩 ' + Math.ceil(r.left / 1000) + ' 秒') : '',
            fails: r.fails,
            oks: r.oks
        }));
    }
    receiptRows() {
        return this.receipts.map((r) => ({
            at: r.at, kind: r.kind, label: r.label, line: r.line,
            given: r.given, kept: r.kept, merged: r.merged,
            capped: r.capped, dropped: r.dropped, saw: r.saw, why: r.why
        }));
    }
    policyRow() {
        return {
            queueKeep: this.queueKeep,
            ledgerKeep: this.ledgerKeep,
            receiptCount: this.receipts.length,
            receiptFull: this.receipts.length >= this.ledgerKeep,
            songCount: this.songs.length,
            maxUnits: MUS_MAX_UNITS,
            queueLimit: MUS_QUEUE_LIMIT
        };
    }
    readings() { return this._readingsOk ? this._readings : null; }
    readingsOk() { return this._readingsOk === true; }
    faceOf() { return this.face; }
    faceTextOf(k) { return MUS_FACE_TEXT[k] || String(k); }
    stateTextOf(k) { return MUS_STATE_TEXT[k] || String(k); }
    whyTextOf(k) { return MUS_VERIFY_WHYS[k] || String(k); }
    sortWhyOf(k) { return MUS_SORT_WHY[k] || String(k); }
    replyWhyOf(k) { return MUS_REPLY_WHYS[k] || String(k); }
    summaryLine() {
        if (!this._readingsOk) return '读数拿不到（存储不可用）';
        const r = this._readings;
        const bits = ['曲目 ' + (r.songs === null ? DASH_UNIT : (r.songs + ' 首'))];
        if (r.covers) {
            bits.push('封面齐 ' + r.covers.ok + ' / 缺 ' + r.covers.absent);
            if (r.covers.partial) bits.push('缺首字 ' + r.covers.partial);
            if (r.covers.malformed) bits.push('封面读不出来 ' + r.covers.malformed);
        } else {
            bits.push('封面读数 ' + DASH_UNIT);
        }
        if (r.lrc) bits.push('歌词 ' + (r.lrc.kept === null ? '—' : r.lrc.kept) + ' 行');
        bits.push('来源 ' + (r.sources === null ? '—' : r.sources.count) + ' 条');
        if (r.sources && r.sources.cooling) bits.push('冷静中 ' + r.sources.cooling);
        bits.push('回执 ' + this.receipts.length + ' 条');
        return bits.join(' · ');
    }
    /** 真源表读数（视图的键面来自这几张，不许手写）。 */
    catalogs() {
        return {
            playbackModes: MUS_PLAYBACK_MODES,
            playbackMeta: MUS_PLAYBACK_MODE_META,
            modes: MUS_MODES,
            modeMeta: MUS_MODE_META,
            states: MUS_STATES,
            stateText: MUS_STATE_TEXT,
            faces: MUS_FACES,
            faceText: MUS_FACE_TEXT,
            sortWhy: MUS_SORT_WHY,
            verifyWhys: MUS_VERIFY_WHYS,
            replyWhys: MUS_REPLY_WHYS,
            limits: {
                queueLimit: MUS_QUEUE_LIMIT,
                maxUnits: MUS_MAX_UNITS,
                coolingFails: MUS_COOLING_FAILS,
                coolingMs: MUS_COOLING_MS,
                matchMin: MUS_MATCH_MIN
            },
            tabs: ['shelf', 'lyrics', 'queue', 'source', 'form', 'policy']
        };
    }

    /* ---------- 收拾回信：落一笔台账 ---------- */
    /**
     * 收拾一段回信（本件唯一的入口动作）。
     *   ① 回执归一（**六因分列**，源全塔成一句「无法解析响应」）；
     *   ② 曲目归一 + 去重（**逐条报**合并与截断，源静默）；
     *   ③ 歌词同步归一（**报坏行**，源静默丢）；
     *   ④ 落一条台账回执。
     * ★ 失败时**不动现有曲库**（源在解析失败时也会把池子清一遍）。
     */
    ingestReply(raw) {
        const text = toStr(raw);
        if (!text.trim()) return { ok: false, reason: 'empty_input' };
        const r = parseReply(text, this.queueKeep);
        if (!r.ok) {
            const rec = this._receipt({
                kind: 'ingest', label: '收拾回信', line: '',
                given: 0, kept: 0, merged: 0, capped: 0, dropped: 0,
                saw: '', why: r.why
            });
            return { ok: false, reason: r.why, whyLabel: this.replyWhyOf(r.why), receipt: rec };
        }
        /* ★ parseReply 已经把去重的完整读数放在 detail 里（原始条数 / 合并明细 /
         *   截断数 / 丢两因）—— 这里**直接用它**，不再二次去重：
         *   二次去重会让「给进来几条」变成「去重后剩几条」（用户贴 4 条、界面报
         *   「给进来 1 条」，与台账里的「合并 1 · 丢 2」当场对不上，本版真踩到过）。 */
        const det = (r.detail && typeof r.detail === 'object') ? r.detail : null;
        const nl = normalizeList(r.list);
        const givenTotal = det ? det.given : nl.given;
        this.songs = nl.list;
        this.cursor = 0;
        this._givenSongs = givenTotal;
        this._badSongs = nl.bad;
        if (r.lrc !== undefined) {
            this._lrcText = toStr(r.lrc);
            this.lrc = parseLrc(this._lrcText, MUS_MAX_UNITS * 8);
        }
        const savedLib = this._persistLibrary();
        const savedLyr = this._persistLyrics();
        const rec = this._receipt({
            kind: 'ingest', label: '收拾回信', line: clampLen(r.list[0] ? r.list[0].name : '', 60),
            given: givenTotal, kept: nl.list.length,
            merged: (det ? det.merged.length : 0), capped: (det ? det.capped : 0),
            dropped: nl.bad + (det ? (det.dropped.no_id + det.dropped.no_name) : 0),
            saw: '', why: 'ok'
        });
        this.probe();
        if (this._view) this._view.refresh();
        return {
            /* ★ 「这次收进来的东西有没有真的存下来」必须报出来（本版真踩到过）：
             *   存储能读不能写时，界面上看着收拾成功、下次打开全没了。 */
            saved: this._savedOk(!!(savedLib && savedLyr)),
            ok: true, given: givenTotal, kept: nl.list.length, bad: nl.bad,
            merged: (det ? det.merged : []), capped: (det ? det.capped : 0),
            droppedNoId: (det ? det.dropped.no_id : 0), droppedNoName: (det ? det.dropped.no_name : 0),
            lyrics: this.lrc ? { kept: this.lrc.kept, noTime: this.lrc.dropped.noTime, noText: this.lrc.dropped.noText } : null,
            receipt: rec
        };
    }
    /** 产一段要求文本（本件唯一一处写出去的字）。 */
    requestText(hint) {
        const r = composeRequestText(hint);
        this._draft = r.text;
        if (this._view) this._view.refresh();
        return { ok: true, text: r.text, prompt: r.prompt };
    }
    draftOf() { return this._draft; }
    clearDraft() {
        this._draft = '';
        if (this._view) this._view.refresh();
        return { ok: true };
    }

    /* ---------- 播放模式与跳曲 ---------- */
    /**
     * 换播放模式。
     *   ★ 认不出来时**保持原样**并报 saw 与 why（源静默不动：用户点了按钮、
     *     界面没变、也不说为什么）。
     */
    setMode(mode) {
        const saw = mode;
        const m = modeOf(mode);
        if (!m.mode) {
            const rec = this._receipt({
                kind: 'mode', label: '换播放模式', line: '',
                given: 0, kept: 0, merged: 0, capped: 0, dropped: 0,
                saw: clampLen(typeof saw === 'string' ? saw : String(saw), 32), why: m.why
            });
            return { ok: false, reason: m.why, saw: saw, kept: this.mode, receipt: rec };
        }
        this.mode = m.mode;
        const rec = this._receipt({
            kind: 'mode', label: '换播放模式', line: MUS_PLAYBACK_MODE_META[m.mode].label,
            given: 0, kept: 0, merged: 0, capped: 0, dropped: 0,
            saw: m.mode, why: 'ok'
        });
        const saved = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, mode: m.mode, saved: this._savedOk(saved === true), receipt: rec };
    }
    /**
     * 跳曲：按当前播放模式算下一首。
     *   ★ 游标一律走 seekTo（坏游标**拒**，不静默夹 0）；绕回要报出来。
     */
    stepIndex(pick) {
        const r = nextIndex(this.mode, this.cursor, this.songs.length, pick);
        if (!r.ok) {
            const rec = this._receipt({
                kind: 'step', label: '下一首', line: '',
                given: 0, kept: 0, merged: 0, capped: 0, dropped: 0,
                saw: '', why: r.why
            });
            return { ok: false, reason: r.why, receipt: rec };
        }
        const s = seekTo(this.songs, r.index);
        if (!s.ok) {
            const rec = this._receipt({
                kind: 'step', label: '下一首', line: '',
                given: s.given, kept: 0, merged: 0, capped: 0, dropped: 0,
                saw: '', why: s.why
            });
            return { ok: false, reason: s.why, receipt: rec };
        }
        this._lastKey = songKeyOf(this.songs[this.cursor] || {});
        this.cursor = s.index;
        const rec = this._receipt({
            kind: 'step', label: '下一首',
            line: clampLen(this.songs[this.cursor] ? this.songs[this.cursor].name : '', 60),
            given: 0, kept: 0, merged: 0, capped: 0, dropped: 0,
            saw: '', why: r.why
        });
        const saved = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, index: this.cursor, why: r.why, wrapped: r.wrapped === true,
            saved: this._savedOk(saved === true), receipt: rec };
    }
    /** 直接定位（坏游标**拒**并给为什么）。 */
    seek(cursor) {
        const s = seekTo(this.songs, cursor);
        if (!s.ok) {
            const rec = this._receipt({
                kind: 'seek', label: '定位', line: '',
                given: s.given, kept: 0, merged: 0, capped: 0, dropped: 0,
                saw: '', why: s.why
            });
            return { ok: false, reason: s.why, size: s.size, receipt: rec };
        }
        this.cursor = s.index;
        const saved = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, index: s.index, size: s.size, saved: this._savedOk(saved === true) };
    }

    /* ---------- 来源：用户自己填的清单（本件不发请求） ---------- */
    setSources(list) {
        const arr = Array.isArray(list) ? list : [];
        const rows = [];
        for (let i = 0; i < arr.length && rows.length < MUS_MAX_UNITS; i += 1) {
            const one = arr[i];
            if (!one || typeof one !== 'object') continue;
            rows.push({
                key: clampLen(one.key, 24),
                url: clampLen(one.url, 120),
                preferred: one.preferred === true,
                fails: numOrSelf(one.fails, 0),
                oks: numOrSelf(one.oks, 0),
                coolingUntil: numOrSelf(one.coolingUntil, 0)
            });
        }
        this.sources = rows;
        const saved = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saved: this._savedOk(saved === true), count: rows.length, pick: pickSource(this.sources, this.nowOf(null)).why };
    }
    /** 记账一条来源的成败（**本件只记，不发请求**；冷却读数由此得出）。 */
    recordSource(key, okFlag) {
        const k = toStr(key);
        const now = this.nowOf(null);
        let hit = null;
        for (let i = 0; i < this.sources.length; i += 1) if (this.sources[i].key === k) { hit = this.sources[i]; break; }
        if (!hit) {
            return { ok: false, reason: 'no_source', saw: k };
        }
        if (okFlag === true) { hit.oks += 1; hit.fails = 0; hit.coolingUntil = 0; }
        else {
            hit.fails += 1;
            if (hit.fails >= MUS_COOLING_FAILS) hit.coolingUntil = now + MUS_COOLING_MS;
        }
        const h = healthOf(hit, now);
        const saved = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, state: h.state, why: h.why, left: h.left, fails: hit.fails,
            saved: this._savedOk(saved === true) };
    }
    /** 两首像不像同一首（**纯读数**，不改任何东西）。 */
    scoreOf(a, b) { return matchScore(a, b); }

    /* ---------- 策略 / 台账 ---------- */
    setQueueKeep(v) {
        const saw = v;
        this.queueKeep = keepOr(v, MUS_QUEUE_LIMIT);
        this.queue = guardQueue(this.songs, this.queueKeep);
        this.songs = this.queue.list;
        if (!seekTo(this.songs, this.cursor).ok) this.cursor = 0;
        const savedPol = this._persistPolicy();
        const savedLib = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saw: saw, took: this.queueKeep, max: MUS_MAX_UNITS, capped: this.queue.capped,
            saved: this._savedOk(!!(savedPol && savedLib)) };
    }
    queueKeepOf() { return this.queueKeep; }
    _receipt(row) {
        const at = todayKeyOf ? todayKeyOf() : '';
        const one = {
            at: toStr(row.at) || at,
            kind: toStr(row.kind),
            label: toStr(row.label),
            line: clampLen(row.line, 120),
            given: numOrSelf(row.given, 0),
            kept: numOrSelf(row.kept, 0),
            merged: numOrSelf(row.merged, 0),
            capped: numOrSelf(row.capped, 0),
            dropped: numOrSelf(row.dropped, 0),
            saw: clampLen(row.saw, 32),
            why: toStr(row.why)
        };
        this.receipts.unshift(one);
        this._trimLedger();
        this._persistLedger();
        return one;
    }
    clearLedger() {
        this.receipts = [];
        const saved = this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saved: this._savedOk(saved === true) };
    }
    /** 裁剪台账到保留数。
     *
     *  ★ 循环上界**自己带下界**：上游归一（keepOr）一旦被绕过，负保留数会让
     *    「条数 > 负数」恒真 ⇒ **无限循环**把界面挂死（v3.39.0 负控制实测到过这一族）。
     *    单靠上游归一就是单点防线。
     */
    _trimLedger() {
        const lim = Math.max(1, numOrSelf(this.ledgerKeep, MUS_MAX_UNITS));
        while (this.receipts.length > lim) this.receipts.pop();
    }
    ledgerKeepOf() { return this.ledgerKeep; }
    setLedgerKeep(v) {
        const saw = v;
        this.ledgerKeep = keepOr(v, MUS_MAX_UNITS);
        this._trimLedger();
        const savedLed = this._persistLedger();
        const savedPol = this._persistPolicy();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saw: saw, took: this.ledgerKeep, max: MUS_MAX_UNITS,
            saved: this._savedOk(!!(savedLed && savedPol)) };
    }
    /** 清空曲库（**只清曲库**，不动歌词与台账 —— 源把三者混在一个开关上）。 */
    clearSongs() {
        const n = this.songs.length;
        this.songs = [];
        this.cursor = 0;
        this.queue = guardQueue(this.songs, this.queueKeep);
        const saved = this._persistLibrary();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, cleared: n, saved: this._savedOk(saved === true) };
    }

    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'shelf');
        const ok = ['shelf', 'lyrics', 'queue', 'source', 'form', 'policy'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'shelf';
        return this._tab;
    }
    currentKey() { return this._current; }
    openSong(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.songs.length) {
            return { ok: false, reason: 'out_of_range', saw: index };
        }
        this._current = String(i);
        if (this._view) this._view.refresh();
        return { ok: true, row: this.songRows()[i] };
    }
    closeSong() {
        this._current = '';
        if (this._view) this._view.refresh();
        return { ok: true };
    }

    /* ---------- 生命周期 ---------- */
    /**
     * 换会话：曲库、歌词、台账、策略全是「这段关系的账」，故全部重取。
     *   ★ 四格的装载由 probe **一处**承担（单一装载路径）：
     *     两处装载会造出「首次渲染走这套、换会话走那套」的双口径，
     *     而双口径必定分歧（本仓为此吃过亏）。
     */
    onChatChanged() {
        this._current = '';
        this._draft = '';
        this._tab = 'shelf';
        this._now = 0;
        this._lastKey = '';
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new MusicdeskView(this, this.shell, this.storage);
        this._view.render();
    }
}

