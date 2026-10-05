/* ========================================================
 * pvdesk-app.js — [v3.43.0] PV 案头 · 落盘与接线
 *
 * 数据层：pvdesk-data.js（纯函数内核）  视图层：pvdesk-view.js
 *
 * ── 三层分工（与第 3 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：分镜解析 / 立绘号 / 图号映射 / 逐镜要求文本 /
 *      歌词解析与字幕版式 / 上限余量 / 回信归一 —— 都不碰存储、不碰网络；
 *   ③ 落盘（PhoneStorage）：四条会话键，全走 /^pvdesk_/ 前缀。
 *
 * ── 四条会话键 ──────────────────────────────────────────
 *   · pvdesk_brief  —— 题面（分镜脚本原文 + 标题 / 时长 / 风格 / 机型 / 情绪）；
 *   · pvdesk_shelf  —— 作品台账（每一次「配好一份要求文本」的存档）；
 *   · pvdesk_lyrics —— 眼下这一首的歌词原文与解析读数；
 *   · pvdesk_policy —— 策略（字幕主行最大字数 / 语言 / 宽素材上限开关）。
 *   ★ 为什么题面与台账分开：题面是「眼下这一份在写的」，台账是「写过的每一份」。
 *     源把两者与成片任务混在一处，于是清一次任务列表会把题面一起清掉。
 *
 * ── 不缝的那一块（源的整套能力，本件一律不接）──────────
 *   ① 源自己起 WebAudio 合成与三段试听（createGain / createOscillator）；
 *   ② 源自己切参考音频并编码 WAV（_encodeWav）；
 *   ③ 源自己调生图入口逐镜出图、调视频生成任务队列出片、落 IndexedDB
 *      与 GitHub 备份；
 *   ④ 源满篇 document.getElementById 直读宿主界面元素。
 *   本件**零音频元件、零网络、零出图、零成片、零外链、零宿主界面读**：
 *   只把分镜与歌词收拾好，并产**可复制的要求文本**（requestText）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 题面读不出来 **不许**读成「一条都没有」（四态面分开判）；
 *   · 镜头区间反了 **不许**静默收下（逐条报 rejected）；
 *   · 镜头体为空 **不许**静默收下（逐条报 emptyBodies）；
 *   · 短文截断 **不许**静默（报 truncated 与 keptChars）；
 *   · 风格「没给」与「给了但认不出」**不许**同形（absent / unknown）；
 *   · 歌词三态 **不许**压平（timed / untimed / empty）；
 *   · 歌词坏行 **不许**静默丢（报 dropped.noTime / noText）；
 *   · 上限余量取不出来 **不许**画成 0（六格 null ≠ 0）；
 *   · 换会话后旧题面与旧台账 **不许**留着（onChatChanged 四格全量重取）。
 * ======================================================== */
'use strict';
import {
    PV_FACES, PV_PARSE_WHYS, PV_HOLD_WHYS, PV_READ_KEYS, PV_GAUGE_KEYS,
    PV_SHOT_MAX, PV_HARD_LIMIT_CHARS, PV_CAST_MAX, PV_REFS_MAX, PV_REFS_MAX_WIDE,
    PV_DURATION_MIN, PV_DURATION_MAX, PV_DURATION_DEFAULT, PV_LEDGER_MAX,
    PV_EXCERPT_THRESHOLD,
    PV_PERSPECTIVES, PV_MOOD_CUES, PV_STYLE_ANCHORS, PV_DIALOGUE_LANGS,
    PV_SOURCE_NOTE, PV_SOURCE_FILES,
    clean, charCount, briefOf, excerptOf, splitParen, captionCut, captionLayout,
    speechLimitCheck, textClassOf, parseShots, shotFigNums, allFigNums, figMapRows,
    stylePick, perspectiveOf, promptForShot, wrapPromptForSubmit, applyStyleAnchor,
    parseLrcText, lyricsPlainText, findCueAt, formatClock, durationOptions,
    refsLimitOf, holdCheck, parseBriefReply, readingsOf, blankCover
} from './pvdesk-data.js';
import { PvdeskView } from './pvdesk-view.js';
import { numOrNull } from '../../config/num-gate.js';
import { writeReceipt } from '../../config/write-receipt.js';

/* 四条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中
   /^pvdesk_/，否则跨会话串味。源把题面、歌词、任务列表与设置全放在
   **无角色维度**的键下（换角色后旧题面与旧台账原样留着，串味且不报）。 */
const BRIEF_KEY = 'pvdesk_brief';
const SHELF_KEY = 'pvdesk_shelf';
const LYRICS_KEY = 'pvdesk_lyrics';
const POLICY_KEY = 'pvdesk_policy';

/** 四态常量**从真源数组派生**，不手写标识符形（本仓 J7 形态）。 */
const FACE_OK = PV_FACES[0];
const FACE_EMPTY = PV_FACES[1];
const FACE_MALFORMED = PV_FACES[2];
const FACE_ABSENT = PV_FACES[3];
const NL = String.fromCharCode(10);
const DASH_UNIT = String.fromCharCode(8212);

/** 面文案表：键取**真源常量的值**（J7 形态：手写一套靠碰巧拼写一致对齐，
 *  真源增删一态就静默走兜底）。 */
const FACE_TEXT = Object.freeze({
    [PV_FACES[0]]: '题面在册',
    [PV_FACES[1]]: '还没写题面',
    [PV_FACES[2]]: '写了但认不出来',
    [PV_FACES[3]]: '读数拿不到（存储不可用）'
});
/** 解析失败因文案表：同样取真源值。 */
const PARSE_WHY_TEXT = Object.freeze({
    [PV_PARSE_WHYS[0]]: '没给内容',
    [PV_PARSE_WHYS[1]]: '一行镜头表头都没有',
    [PV_PARSE_WHYS[2]]: '镜头数超上限',
    [PV_PARSE_WHYS[3]]: '正文超硬限'
});
/** 收工失败因文案表：同样取真源值。 */
const HOLD_WHY_TEXT = Object.freeze({
    [PV_HOLD_WHYS[0]]: '这一镜是空的',
    [PV_HOLD_WHYS[1]]: '这句台词按语速塞不进这一镜',
    [PV_HOLD_WHYS[2]]: '立绘数超上限',
    [PV_HOLD_WHYS[3]]: '登场角色超上限',
    [PV_HOLD_WHYS[4]]: '参考素材超上限',
    [PV_HOLD_WHYS[5]]: '一镜都没有'
});

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}
function dash() {
    return DASH_UNIT;
}
/** 读数取值：取不出来就画横线（**不画 0** —— 0 与「取不出来」同形是本件守的静默失效）。 */
function meterText(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return dash();
    return String(cell.value);
}

export class PvdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._tab = 'brief';
        this._brief = '';
        this._title = '';
        this._duration = PV_DURATION_DEFAULT;
        this._style = '';
        this._lens = '';
        this._mood = '';
        this._lang = PV_DIALOGUE_LANGS[1].key;
        this._lyricsRaw = '';
        this._maxChars = 12;
        this._wide = false;
        this._shelf = [];
        this._ledger = [];
        this._draft = '';
        this._focus = '';
        this._dropped = 0;
        this._now = 0;
        this._face = FACE_ABSENT;
        this._malformed = false;
        this._readings = blankCover('init');
        this._parsed = { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [] };
        this._lyrics = { mode: 'empty', timed: false, cues: [], dropped: { noTime: [], noText: 0, meta: 0 } };
        this._hold = { rows: [], ok: false, fails: 0, figs: [], figures: 0 };
    }

    /* ---------- storage 三态（本仓纪律：抛异常不等于「没记过」） ---------- */
    _storageUsable() {
        if (!this.storage) return { ok: false, why: 'no_storage' };
        if (typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, why: 'no_api' };
        }
        return { ok: true, why: '' };
    }
    _savedOk(wrote) {
        return { saved: wrote === true, storage: this._storageUsable().ok };
    }
    /** 读一格。三种回报：ok / absent（这一格压根没写过）/ malformed（写了但读不懂）。
     *  ★ 抛异常**不是**「没记过」：本仓最贵的形态是「读不出来 ⇒ 画成空」。
     *  ★ 只走 storage.get / storage.set —— keys-audit 的证据面只认 storage 句柄上的
     *    这三个口；走别的取数口会让这四个键从未进入登记面（K1/K2/K3 一并失效）。 */
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        let v = null;
        try { v = this.storage.get(key, null); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }
    _writeJSON(key, value) {
        const gate = this._storageUsable();
        if (!gate.ok) return false;
        if (typeof this.storage.set !== 'function') return false;
        try {
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败也照报成功（与 A 族方向相反的同一类错）。 */
            return writeReceipt(this.storage, key, JSON.stringify(value)).saved === true;
        } catch (e) {
            return false;
        }
    }

    /* ---------- 装载（单一装载路径：首次渲染与换会话都走这里） ---------- */
    _loadBrief() {
        const r = this._readRaw(BRIEF_KEY);
        if (!r.ok) return { face: FACE_ABSENT, why: r.why };
        if (r.why === 'absent') return { face: FACE_EMPTY, why: '' };
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            return { face: FACE_MALFORMED, why: 'json' };
        }
        if (!obj || typeof obj !== 'object') return { face: FACE_MALFORMED, why: 'shape' };
        this._brief = toStr(obj.brief);
        this._title = toStr(obj.title);
        const d = numOrNull(obj.duration);
        this._duration = (d !== null && d >= PV_DURATION_MIN && d <= PV_DURATION_MAX) ? d : PV_DURATION_DEFAULT;
        this._style = toStr(obj.style);
        this._lens = toStr(obj.lens);
        this._mood = toStr(obj.mood);
        if (!this._brief) return { face: FACE_EMPTY, why: '' };
        return { face: FACE_OK, why: '' };
    }
    /** 台账与动作记录（与题面**分两条键**：题面是「眼下这一份」，台账是
     *  「写过的每一份」—— 源把两者与成片任务挤在一处，清一次任务列表会把题面一起清掉）。
     *  ★ 读不出来时清空内存里的台账：不许把「取不出来」读成「还留着上一份」。 */
    _loadShelf() {
        const r = this._readRaw(SHELF_KEY);
        if (!r.ok || r.why === 'absent') { this._shelf = []; this._ledger = []; this._dropped = 0; return; }
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            this._shelf = []; this._ledger = []; this._dropped = 0; return;
        }
        this._shelf = (obj && Array.isArray(obj.shelf)) ? obj.shelf : [];
        this._ledger = (obj && Array.isArray(obj.ledger)) ? obj.ledger : [];
        const dp = numOrNull(obj && obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? dp : 0;
    }
    _loadLyrics() {
        const r = this._readRaw(LYRICS_KEY);
        if (!r.ok) return;
        if (r.why === 'absent') { this._lyricsRaw = ''; return; }
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            this._lyricsRaw = '';
            return;
        }
        this._lyricsRaw = toStr(obj && obj.raw);
    }
    _loadPolicy() {
        const r = this._readRaw(POLICY_KEY);
        if (!r.ok || r.why === 'absent') return;
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            return;
        }
        const mc = numOrNull(obj && obj.maxChars);
        if (mc !== null && mc >= 4 && mc <= 40) this._maxChars = mc;
        const lg = toStr(obj && obj.lang);
        for (let i = 0; i < PV_DIALOGUE_LANGS.length; i++) {
            if (PV_DIALOGUE_LANGS[i].key === lg) this._lang = lg;
        }
        this._wide = (obj && obj.wide === true);
    }
    _persistBrief() {
        return this._writeJSON(BRIEF_KEY, {
            brief: this._brief, title: this._title, duration: this._duration,
            style: this._style, lens: this._lens, mood: this._mood
        });
    }
    /** 台账那条键的落盘（每记一笔动作回执就落一次，台账不随会话退出丢掉）。 */
    _persistShelf() {
        return this._writeJSON(SHELF_KEY, {
            shelf: this._shelf, ledger: this._ledger, dropped: this._dropped
        });
    }
    _persistLyrics() {
        return this._writeJSON(LYRICS_KEY, { raw: this._lyricsRaw });
    }
    _persistPolicy() {
        return this._writeJSON(POLICY_KEY, { maxChars: this._maxChars, lang: this._lang, wide: this._wide });
    }
    _clearToDefaults() {
        this._face = FACE_EMPTY;
        this._malformed = false;
        this._brief = '';
        this._title = '';
        this._duration = PV_DURATION_DEFAULT;
        this._style = '';
        this._lens = '';
        this._mood = '';
        this._lyricsRaw = '';
        this._shelf = [];
        this._ledger = [];
        this._draft = '';
        this._focus = '';
        this._dropped = 0;
        this._parsed = { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [] };
        this._lyrics = { mode: 'empty', timed: false, cues: [], dropped: { noTime: [], noText: 0, meta: 0 } };
        this._hold = { rows: [], ok: false, fails: 0, figs: [], figures: 0 };
    }

    /* ---------- 取数：一处装配（不持跨轮副本） ---------- */
    probe() {
        const st = this._loadBrief();
        this._face = st.face;
        this._malformed = (st.face === FACE_MALFORMED);
        this._loadLyrics();
        this._loadPolicy();
        this._loadShelf();
        this._recompute();
        return {
            face: this._face, faceText: FACE_TEXT[this._face], shots: this._parsed.shots.length,
            rejected: this._parsed.rejected.length, emptyBodies: this._parsed.emptyBodies.length,
            cues: this._lyrics.cues.length, hold: this._hold.ok
        };
    }
    /** 重算四格投影（**不重读 storage**）。
     *  ★ 必须单独成口：动作口（收题面 / 收歌词 / 清空 / 各 set*）改的是**内存字段**，
     *    投影得跟着变。只在 probe 里算一次的话，动作之后视图读到的还是**上一轮**的
     *    投影 —— 表现是「收下了却什么都没变」，不报错、不崩溃、只错结果。 */
    _recompute() {
        const briefChars = charCount(this._brief);
        const overChars = briefChars > PV_HARD_LIMIT_CHARS;
        this._parsed = this._brief
            ? parseShots(this._brief, { limitChars: PV_HARD_LIMIT_CHARS, limitShots: PV_SHOT_MAX })
            : { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [], truncated: false, chars: 0 };
        this._lyrics = this._lyricsRaw
            ? parseLrcText(this._lyricsRaw, { duration: this._duration, maxChars: this._maxChars, offset: 0 })
            : { mode: 'empty', timed: false, cues: [], dropped: { noTime: [], noText: 0, meta: 0 }, lines: 0 };
        /* ★ 这一份的「登场角色」= 镜头里挂到的立绘号（不是台词行数：
         *   源把两件事混在一处数，于是角色上限永远判不出超员）。 */
        const figs = allFigNums(this._parsed.shots);
        this._hold = holdCheck({
            shots: this._parsed.shots,
            text: this._brief,
            cast: figs,
            refs: this.refRows(),
            wide: this._wide
        });
        const malformed = (this._malformed === true) || overChars;
        this._readings = (this._face === FACE_ABSENT)
            ? blankCover('storage_absent')
            : readingsOf({
                brief: this._brief,
                shots: this._parsed.shots,
                cast: figs,
                refs: this.refRows(),
                cues: this._lyrics.cues,
                dropped: this._lyrics.dropped,
                malformed,
                wide: this._wide
            });
        if (malformed && this._readings.face === FACE_OK) this._readings.face = FACE_MALFORMED;
        this._now = Date.now();
    }

    /* ---------- 视图取数口 ---------- */
    /** 镜头行（每行带要求文本与立绘号）。 */
    shotRows() {
        const rows = [];
        const shots = this._parsed.shots;
        for (let i = 0; i < shots.length; i++) {
            const s = shots[i];
            const prompt = promptForShot(s, {
                styleKey: this._style, lensKey: this._lens, moodKey: this._mood
            });
            rows.push({
                index: i, n: s.n, from: s.a, to: s.b, sec: s.sec,
                clock: formatClock(s.a).text + '-' + formatClock(s.b).text,
                body: s.body,
                figs: prompt.figs,
                text: prompt.text,
                filled: prompt.filled,
                empty: s.body === ''
            });
        }
        return rows;
    }
    /** 台词行（每行给一句台词与它塞不塞得进这一镜）。 */
    castRows() {
        const out = [];
        const seen = [];
        const shots = this._parsed.shots;
        for (let i = 0; i < shots.length; i++) {
            const body = shots[i].body;
            let at = body.indexOf('「');
            while (at >= 0) {
                const close = body.indexOf('」', at + 1);
                if (close < 0) break;
                const line = clean(body.slice(at + 1, close));
                if (line) {
                    const chk = speechLimitCheck(line, shots[i].sec, this._lang);
                    out.push({ index: out.length, shot: shots[i].n, sec: shots[i].sec, text: line,
                               ok: chk.ok, why: chk.why, limit: chk.limit, saw: chk.saw,
                               cls: textClassOf(line).cls });
                }
                at = body.indexOf('「', close + 1);
            }
            const nums = shotFigNums(body);
            for (let k = 0; k < nums.length; k++) {
                if (seen.indexOf(nums[k]) < 0) seen.push(nums[k]);
            }
        }
        return out;
    }
    /** 参考素材行：源把「这一份要用几张参考图」缩成一句素材指代、超了才报，
     *  于是**没挂过的素材与挂过的素材同形**，且超限只报一句「已裁剪」。
     *  本件单列一栏：每项带图号、出现在哪几镜、当前上限、是否已超限。 */
    refRows() {
        const nums = allFigNums(this._parsed.shots);
        const limit = refsLimitOf('paint', this._wide);
        const rows = [];
        for (let i = 0; i < nums.length; i++) {
            const where = [];
            for (let k = 0; k < this._parsed.shots.length; k++) {
                if (shotFigNums(this._parsed.shots[k].body).indexOf(nums[i]) >= 0) {
                    where.push(this._parsed.shots[k].n);
                }
            }
            rows.push({
                index: i, key: '图' + nums[i], n: nums[i],
                shots: where.length, where: where.join('/'),
                limit, over: (i + 1) > limit
            });
        }
        return rows;
    }
    captionRows() {
        const rows = [];
        const cues = this._lyrics.cues;
        for (let i = 0; i < cues.length; i++) {
            rows.push({
                index: i, t: cues[i].t, end: cues[i].end,
                clock: formatClock(cues[i].t).text,
                text: cues[i].text, main: cues[i].main, sub: cues[i].sub,
                subFrom: (cues[i].sub && cues[i].text.indexOf(cues[i].sub) < 0) ? 'cut' : (cues[i].sub ? 'paren' : '')
            });
        }
        return rows;
    }
    droppedRows() {
        const rows = [];
        const d = this._lyrics.dropped || { noTime: [] };
        const nt = Array.isArray(d.noTime) ? d.noTime : [];
        for (let i = 0; i < nt.length; i++) {
            rows.push({ index: i, kind: 'noTime', line: nt[i].line, saw: nt[i].saw, why: nt[i].why });
        }
        return rows;
    }
    shelfRows() {
        const rows = [];
        for (let i = 0; i < this._shelf.length; i++) {
            const e = this._shelf[i];
            rows.push({
                index: i, at: e.at, title: e.title || '(无标题)',
                shots: numOrNull(e.shots) === null ? dash() : String(e.shots),
                chars: numOrNull(e.chars) === null ? dash() : String(e.chars),
                kind: e.kind || 'brief'
            });
        }
        return rows;
    }
    ledgerRows() {
        const rows = [];
        for (let i = this._ledger.length - 1; i >= 0; i--) {
            rows.push(this._ledger[i]);
        }
        return rows;
    }
    /* ---------- 焦点（详情条） ---------- */
    /** 焦点键：卡片判定不许读直点元素的文本（源满篇 target 直读）。
     *  点卡片里的正文文字时 target 是子元素，判定落空 ⇒ 用户点正文没反应。 */
    currentKey() {
        return String(this._focus);
    }
    openItem(key) {
        const k = String(key == null ? '' : key);
        const shots = this.shotRows();
        for (let i = 0; i < shots.length; i++) {
            if (String(shots[i].n) === k) { this._focus = k; return { ok: true, key: k, kind: 'shot' }; }
        }
        const refs = this.refRows();
        for (let i = 0; i < refs.length; i++) {
            if (String(refs[i].n) === k) { this._focus = k; return { ok: true, key: k, kind: 'ref' }; }
        }
        this._focus = '';
        return { ok: false, key: k, kind: '' };
    }
    closeItem() {
        this._focus = '';
        return { ok: true };
    }
    /** 上游面：三项上限的余量（视图画进度条与拒绝原因）。 */
    gaugeRows() {
        const r = this._readings.rows || {};
        const out = [];
        for (let i = 0; i < PV_GAUGE_KEYS.length; i++) {
            const t = PV_GAUGE_KEYS[i];
            const cell = r[t.key] || null;
            out.push({
                key: t.key, label: t.label,
                value: cell ? cell.value : null,
                of: cell ? cell.of : null,
                pct: cell && cell.pct !== null ? cell.pct : null,
                text: meterText(cell)
            });
        }
        return out;
    }
    readings() {
        return {
            ok: this._readings.ok, face: this._readings.face,
            faceText: FACE_TEXT[this._readings.face] || FACE_TEXT[FACE_ABSENT],
            rows: this.gaugeRows(),
            cards: PV_READ_KEYS.map((k) => {
                const cell = (this._readings.rows || {})[k] || null;
                return { key: k, text: meterText(cell), dash: !(cell && cell.value !== null) };
            })
        };
    }
    readingsOk() {
        return this._readings.ok === true;
    }
    faceOf() {
        return this._face;
    }
    faceTextOf() {
        return FACE_TEXT[this._face] || FACE_TEXT[FACE_ABSENT];
    }
    stateTextOf() {
        return this._hold.ok ? '可以收工' : ('还差 ' + this._hold.fails + ' 项');
    }
    whyTextOf(key) {
        return PARSE_WHY_TEXT[key] || key || '';
    }
    holdWhyTextOf(key) {
        return HOLD_WHY_TEXT[key] || key || '';
    }
    sourceNoteOf() {
        return PV_SOURCE_NOTE;
    }
    sourceFilesOf() {
        return PV_SOURCE_FILES.slice();
    }
    /** 一句总览（视图与条目都读它，不各写一套）。 */
    summaryLine() {
        const parts = [];
        parts.push('镜头 ' + this._parsed.shots.length + '/' + PV_SHOT_MAX);
        parts.push('正文 ' + charCount(this._brief) + ' 字');
        parts.push('歌词 ' + this._lyrics.cues.length + ' 句（' + this._lyrics.mode + '）');
        parts.push(this._hold.ok ? '可收工' : ('差 ' + this._hold.fails + ' 项'));
        return parts.join(' · ');
    }
    lyricsModeOf() {
        return this._lyrics.mode;
    }
    lyricsModeText() {
        const mode = this._lyrics.mode;
        if (mode === 'timed') return '带时间戳';
        if (mode === 'untimed') return '没有时间戳（只能按字数排）';
        if (mode === 'empty') return '没给歌词';
        return mode;
    }
    captionPlan() {
        return captionLayout(this._lyrics.cues, this._duration, this._maxChars);
    }

    /* ---------- 视图小口（读现算值，视图不重算） ---------- */
    durationOf() {
        return this._duration;
    }
    lensOf() {
        return this._lens;
    }
    styleOf() {
        return this._style;
    }
    moodOf() {
        return this._mood;
    }
    /** 这一份题面「认出来没有」：视图照画，不自己再判一遍。 */
    parseInfo() {
        return {
            ok: this._parsed.ok === true,
            why: this._parsed.ok ? '' : toStr(this._parsed.why),
            saw: toStr(this._parsed.saw),
            shots: this._parsed.shots.length,
            chars: charCount(this._brief),
            keptChars: (typeof this._parsed.keptChars === 'number')
                ? this._parsed.keptChars : charCount(this._brief),
            truncated: this._parsed.truncated === true,
            rejected: this._parsed.rejected || [],
            emptyBodies: this._parsed.emptyBodies || []
        };
    }
    /** 题面预览：超阈值就截断，**截断要说出来**（源也截，但静默）。 */
    previewOf() {
        return excerptOf(this._brief, PV_EXCERPT_THRESHOLD);
    }
    /** 歌词读数：三态之外还要**逐项报坏行**（源静默丢）。 */
    lyricsInfo() {
        const d = this._lyrics.dropped || { noTime: [] };
        return {
            mode: this._lyrics.mode,
            lines: (typeof this._lyrics.lines === 'number') ? this._lyrics.lines : null,
            cues: this._lyrics.cues.length,
            noTime: Array.isArray(d.noTime) ? d.noTime.length : null,
            noText: (typeof d.noText === 'number') ? d.noText : null,
            meta: (typeof d.meta === 'number') ? d.meta : null
        };
    }

    /* ---------- 源里有、本件先前只在数据层建好的那几面（产品侧接上） ---------- */
    /** 分镜体里被剔掉的行：源静默剔，用户只看到「这一镜怎么这么短」。 */
    bodyCutRows() {
        const rows = this._parsed.bodyCut || [];
        const out = [];
        for (let i = 0; i < rows.length; i++) out.push({ index: i, n: rows[i].n, cut: rows[i].cut });
        return out;
    }
    /** 题面正文的截断读数（源截但不说）。 */
    briefMeta() {
        return briefOf(this._brief, PV_EXCERPT_THRESHOLD);
    }
    /** 按字数排的歌词正文行（没时间戳时只能读它）。 */
    plainRows() {
        const lines = lyricsPlainText(this._lyricsRaw);
        const out = [];
        for (let i = 0; i < lines.length; i++) out.push({ index: i, text: lines[i] });
        return out;
    }
    /** 这一镜另出一份「追加画风锚」的文本：已有同一锚就不重复加（源口径）。 */
    scriptOf(n) {
        const shots = this.shotRows();
        const src = this._parsed.shots;
        for (let i = 0; i < shots.length && i < src.length; i++) {
            if (String(shots[i].n) === String(n)) {
                const p = promptForShot(src[i], {
                    styleKey: this._style, lensKey: this._lens, moodKey: this._mood
                });
                const anchored = applyStyleAnchor(p.text, this._style);
                return { ok: true, key: String(n), text: anchored.text,
                         applied: anchored.applied === true, filled: toStr(anchored.filled) };
            }
        }
        return { ok: false, key: String(n), text: '', applied: false, filled: '' };
    }
    /** 图号 → 镜号映射行（源的 _pvBuildAssetLines）。frames = 取前几镜做参考帧。 */
    figMapRowsOf(frames) {
        const rows = this.shotRows();
        const n = numOrNull(frames);
        const use = (n !== null && n > 0) ? Math.min(n, rows.length) : 0;
        const nums = [];
        for (let i = 0; i < use; i++) nums.push(rows[i].n);
        return { lines: figMapRows(allFigNums(this._parsed.shots).length, nums), frames: use };
    }
    /** 按秒找当前这一句（区间左闭右开）。 */
    cueAt(sec) {
        const n = numOrNull(sec);
        if (n === null) return { ok: false, why: 'no_time', clock: '', text: '', index: -1 };
        const r = findCueAt(this._lyrics.cues, n);
        return {
            ok: r.found === true, why: toStr(r.why), index: r.index,
            clock: r.found ? formatClock(r.cue.t).text : '',
            text: r.found ? r.cue.text : ''
        };
    }
    /** 一句台词的字形构成（中日英三类）：源不做混合分类，只看长度。 */
    vocabOf(text) {
        const c = textClassOf(text);
        return { cls: c.cls, kana: c.kana, hans: c.hans, latin: c.latin };
    }
    /** 眼下这一份的六格读数（视图照画；取不出来是 null **不是 0**）。 */
    readerRows() {
        const rd = this.readings();
        const out = [];
        for (let i = 0; i < rd.cards.length; i++) {
            out.push({ key: rd.cards[i].key, text: rd.cards[i].text, dash: rd.cards[i].dash === true });
        }
        return out;
    }

    /* ---------- 各表（视图直接读，不另算） ---------- */
    catalogs() {
        return {
            perspectives: PV_PERSPECTIVES.map((p) => ({ key: p.key, label: p.label, lens: p.lens, note: p.note })),
            moods: PV_MOOD_CUES.map((m) => ({ key: m.key, label: m.label, text: m.text })),
            styles: PV_STYLE_ANCHORS.map((s) => ({ key: s.key, label: s.label })),
            langs: PV_DIALOGUE_LANGS.map((l) => ({ key: l.key, label: l.label, pace: l.pace })),
            durations: durationOptions(PV_DURATION_MIN, PV_DURATION_MAX, this._duration)
        };
    }

    /* ---------- 动作口 ① 收题面回信 ---------- */
    /** 吃得进两种回信：
     *   · 键值形态（题面：标题 / 时长 / 风格 / 镜头 / 情绪 加正文段落）；
     *   · 分镜脚本形态（镜头 N（a-b秒）…）。
     *  不猜：两种都没认出时报 why，**不静默当成空的**。 */
    ingestReply(text) {
        const raw = clean(text);
        if (!raw) {
            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });
            return { ok: false, why: PV_PARSE_WHYS[0], detail: { chars: 0, shots: 0 } };
        }
        const briefRep = parseBriefReply(raw);
        const shotsRep = parseShots(raw, { limitChars: PV_HARD_LIMIT_CHARS, limitShots: PV_SHOT_MAX });
        const hasKeys = raw.indexOf('：') >= 0 || raw.indexOf(':') >= 0;
        if (hasKeys && briefRep.brief && !shotsRep.ok) {
            this._brief = briefRep.brief;
            if (briefRep.title) this._title = briefRep.title;
            if (briefRep.duration !== null) this._duration = briefRep.duration;
            if (briefRep.style) this._style = briefRep.style;
            if (briefRep.lens) this._lens = briefRep.lens;
            if (briefRep.mood) this._mood = briefRep.mood;
            this._face = FACE_OK;
            this._malformed = false;
            this._recompute();
            const wrote = this._persistBrief();
            this._receipt('ingest', true, '', {
                chars: charCount(this._brief), shots: shotsRep.shots.length,
                filled: briefRep.filled
            });
            return Object.assign(this._savedOk(wrote), {
                ok: true, kind: 'brief', why: '',
                detail: { chars: charCount(this._brief), shots: 0, fields: briefRep.filled }
            });
        }
        if (shotsRep.ok) {
            this._brief = raw;
            this._face = FACE_OK;
            this._malformed = false;
            this._recompute();
            const wrote = this._persistBrief();
            this._receipt('ingest', true, '', {
                chars: charCount(raw), shots: shotsRep.shots.length,
                rejected: shotsRep.rejected.length, emptyBodies: shotsRep.emptyBodies.length
            });
            return Object.assign(this._savedOk(wrote), {
                ok: true, kind: 'shots', why: '',
                detail: {
                    chars: charCount(raw), shots: shotsRep.shots.length,
                    rejected: shotsRep.rejected.length, emptyBodies: shotsRep.emptyBodies.length
                }
            });
        }
        const why = shotsRep.why || briefRep.why || PV_PARSE_WHYS[0];
        this._receipt('ingest', false, why, { chars: charCount(raw), shots: 0 });
        return Object.assign(this._savedOk(false), {
            ok: false, kind: '', why,
            detail: { chars: charCount(raw), shots: 0, saw: shotsRep.saw || '' }
        });
    }

    /* ---------- 动作口 ② 收歌词 ---------- */
    ingestLyrics(text) {
        const raw = toStr(text);
        this._lyricsRaw = clean(raw);
        const wrote = this._persistLyrics();
        this._recompute();
        const lyr = parseLrcText(this._lyricsRaw, { duration: this._duration, maxChars: this._maxChars, offset: 0 });
        this._receipt('lyrics', this._lyricsRaw !== '', lyr.mode, {
            lines: lyr.lines || 0, cues: lyr.cues.length,
            dropped: (lyr.dropped.noTime || []).length + (lyr.dropped.noText || 0)
        });
        return Object.assign(this._savedOk(wrote), {
            ok: this._lyricsRaw !== '', mode: lyr.mode, cues: lyr.cues.length,
            dropped: (lyr.dropped.noTime || []).length + (lyr.dropped.noText || 0)
        });
    }

    /* ---------- 动作口 ③ 配好这一份 → 产要求文本 ---------- */
    /** 返回 { text, chars, blocks, saved, kind }。**不**出图、**不**出片。 */
    composeText(opts) {
        const o = opts || {};
        const shots = this._parsed.shots;
        const cast = this.castRows();
        const figs = allFigNums(shots);
        const frames = (typeof o.frameCount === 'number' && o.frameCount > 0) ? o.frameCount : 0;
        const frameShots = [];
        for (let i = 0; i < frames && i < shots.length; i++) frameShots.push(shots[i].n);
        const pick = stylePick(this._style);
        const lensRow = perspectiveOf(this._lens);
        const head = [];
        head.push('标题：' + (this._title || '(无标题)'));
        head.push('时长：' + this._duration + '秒');
        head.push('机型：' + (lensRow ? (lensRow.label + '·' + lensRow.lens) : '没给'));
        /* ★「没给」与「给了但认不出」不同形：源两处都写「未指定」。 */
        head.push('画风：' + (pick.filled === 'ok'
            ? (pick.label + '·' + pick.anchor)
            : (pick.filled === 'absent' ? '没给' : ('认不出「' + pick.saw + '」'))));
        head.push('情绪：' + (this._mood || '没给'));
        head.push('镜头数：' + shots.length + ' · 登场立绘：' + figs.length + ' · 台词：' + cast.length);
        const body = [];
        for (let i = 0; i < shots.length; i++) {
            const p = promptForShot(shots[i], {
                styleKey: this._style, lensKey: this._lens, moodKey: this._mood
            });
            body.push('—— 镜头' + shots[i].n + '（' + shots[i].a + '-' + shots[i].b + '秒）——');
            body.push(p.text);
        }
        const core = head.join(NL) + NL + NL + body.join(NL);
        const wrapped = wrapPromptForSubmit(core, {
            assetCount: figs.length, frameShots: frameShots, segCount: this._duration
        });
        this._draft = wrapped.text;
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), {
            ok: shots.length > 0, text: wrapped.text, chars: wrapped.chars,
            blocks: wrapped.blocks, shots: shots.length, figs: figs.length,
            kind: 'compose',
            filled: {
                style: pick.filled,
                lens: lensRow ? 'ok' : (this._lens ? 'unknown' : 'absent'),
                mood: this._mood ? 'ok' : 'absent',
                shots: shots.length
            }
        });
    }
    requestText() {
        return this._draft;
    }
    draftOf() {
        return this._draft;
    }
    clearDraft() {
        this._draft = '';
        return { ok: true };
    }

    /* ---------- 动作口 ④ 存进台账 ---------- */
    /** 存的是「这一份题面的账」；★ 没配过文本就存 ⇒ 如实报 no_cut，不静默存空。 */
    saveToShelf(opts) {
        const o = opts || {};
        if (!this._brief) {
            this._receipt('shelf', false, PV_HOLD_WHYS[5], { shots: 0 });
            return Object.assign(this._savedOk(false), { ok: false, why: PV_HOLD_WHYS[5], kind: 'brief_without_cut' });
        }
        const text = toStr(o.text) || this._draft;
        const shots = this._parsed.shots.length;
        /* ★ 参考素材超了上限一律**拒存**：源在这一步静默截掉多余的参考图，
         *   用户拿到的永远是「少了素材的那一份」而看不出来。 */
        const refLimit = refsLimitOf('paint', this._wide);
        const refs = this.refRows();
        if (refs.length > refLimit) {
            this._receipt('shelf', false, PV_HOLD_WHYS[4], { refs: refs.length, limit: refLimit });
            return Object.assign(this._savedOk(false), {
                ok: false, why: PV_HOLD_WHYS[4], kind: '', refs: refs.length, limit: refLimit
            });
        }
        const kind = shots > 0 ? 'cut' : 'brief_without_cut';
        this._shelf.push({
            at: Date.now(), title: this._title, kind,
            shots, chars: text ? text.length : 0, text: shots > 0 ? text : ''
        });
        const wrote = this._persistShelf();
        this._receipt('shelf', true, shots > 0 ? '' : kind, { shots, chars: text ? text.length : 0 });
        return Object.assign(this._savedOk(wrote), {
            ok: true, kind, shots, chars: text ? text.length : 0
        });
    }
    removeFromShelf(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this._shelf.length) {
            return { ok: false, reason: 'out_of_range', saw: index };
        }
        this._shelf.splice(i, 1);
        const wrote = this._persistShelf();
        this._receipt('shelf_remove', true, '', { index: i, left: this._shelf.length });
        return Object.assign(this._savedOk(wrote), { ok: true, left: this._shelf.length });
    }

    /* ---------- 动作口 ⑤ 三项设定 ---------- */
    setStyle(key) {
        const p = stylePick(key);
        this._style = p.filled === 'ok' ? key : '';
        this._recompute();
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), { ok: p.filled === 'ok', filled: p.filled, saw: p.saw });
    }
    setLens(key) {
        const p = perspectiveOf(key);
        this._lens = p ? key : '';
        this._recompute();
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), { ok: !!p, saw: toStr(key) });
    }
    setMood(key) {
        let found = false;
        for (let i = 0; i < PV_MOOD_CUES.length; i++) {
            if (PV_MOOD_CUES[i].key === key) found = true;
        }
        this._mood = found ? key : '';
        this._recompute();
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), { ok: found, saw: toStr(key) });
    }
    setDuration(sec) {
        const n = numOrNull(sec);
        if (n === null || n < PV_DURATION_MIN || n > PV_DURATION_MAX) {
            return { ok: false, reason: 'out_of_range', saw: sec, min: PV_DURATION_MIN, max: PV_DURATION_MAX };
        }
        this._duration = n;
        this._recompute();
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), { ok: true, duration: n });
    }
    setMaxChars(n) {
        const v = numOrNull(n);
        if (v === null || v < 4 || v > 40) return { ok: false, reason: 'out_of_range', saw: n };
        this._maxChars = v;
        this._recompute();
        const wrote = this._persistPolicy();
        return Object.assign(this._savedOk(wrote), { ok: true, maxChars: v });
    }
    setLang(key) {
        let found = false;
        for (let i = 0; i < PV_DIALOGUE_LANGS.length; i++) {
            if (PV_DIALOGUE_LANGS[i].key === key) found = true;
        }
        if (!found) return { ok: false, reason: 'unknown_lang', saw: key };
        this._lang = key;
        this._recompute();
        const wrote = this._persistPolicy();
        return Object.assign(this._savedOk(wrote), { ok: true, lang: key });
    }
    setWide(on) {
        this._wide = on === true;
        this._recompute();
        const wrote = this._persistPolicy();
        return Object.assign(this._savedOk(wrote), { ok: true, wide: this._wide, refs: refsLimitOf('paint', this._wide) });
    }
    policyOf() {
        return { maxChars: this._maxChars, lang: this._lang, wide: this._wide,
                 refsLimit: refsLimitOf('paint', this._wide) };
    }

    /* ---------- 台账 ---------- */
    /** 记一笔。★ 挤掉旧记录要**计数报出来**：源静默 shift，
     *  用户只看到「台账怎么少了」，看不到「被挤掉了多少」。 */
    _receipt(kind, ok, why, detail) {
        this._ledger.push({ at: Date.now(), kind, ok: ok === true, why: toStr(why), detail: detail || {} });
        while (this._ledger.length > PV_LEDGER_MAX) { this._ledger.shift(); this._dropped += 1; }
        this._persistShelf();
    }
    ledgerInfo() {
        return { kept: this._ledger.length, dropped: this._dropped, max: PV_LEDGER_MAX };
    }
    clearLedger() {
        this._ledger = [];
        this._dropped = 0;
        const wrote = this._persistShelf();
        return Object.assign(this._savedOk(wrote), { ok: true, dropped: 0 });
    }
    /** 清题面与台账。
     *  ★ **不走** 「_clearToDefaults()」：那是换会话用的整页清，会把歌词原文与策略
     *    一起带走 —— 而按钮字面里只说了「题面与台账」。用户贴的那段歌词不该被
     *    一个没提它的按钮清掉（源把三者挤在一处，清一次任务列表全没）。 */
    clearBrief() {
        this._face = FACE_EMPTY;
        this._malformed = false;
        this._brief = '';
        this._title = '';
        this._duration = PV_DURATION_DEFAULT;
        this._style = '';
        this._lens = '';
        this._mood = '';
        this._shelf = [];
        this._draft = '';
        this._focus = '';
        this._recompute();
        const wrote = this._persistBrief();
        this._persistShelf();
        this._receipt('clear', true, '', {});
        return Object.assign(this._savedOk(wrote), { ok: true });
    }

    /* ---------- 页签 ---------- */
    tab() {
        return this._tab;
    }
    setTab(t) {
        const k = String(t || 'brief');
        const ok = ['brief', 'shots', 'cast', 'lyrics', 'compose', 'shelf'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'brief';
        return this._tab;
    }
    /* ---------- 生命周期 ---------- */
    /** 换会话：题面、台账、歌词、策略全是「这段关系的账」，故全部重取。
     *  ★ 四格的装载由 probe **一处**承担（单一装载路径）。 */
    onChatChanged() {
        this._clearToDefaults();
        this._tab = 'brief';
        this._focus = '';
        this._now = 0;
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, face: this._face };
    }
    render() {
        this.probe();
        if (!this._view) this._view = new PvdeskView(this, this.shell, this.storage);
        this._view.render();
    }
}