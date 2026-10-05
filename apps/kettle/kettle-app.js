/* ========================================================
 * kettle-app.js — [v3.40.0] 对话水壶 · 落盘与接线
 *
 * 数据层：kettle-data.js（纯函数内核）  视图层：kettle-view.js
 *
 * ── 三层分工（与第 2 / 第 3 层各件同规格）──────────────
 *   ① 取数（probe）：每次 render / 换会话 / 外部改动后都重取，不持跨轮副本；
 *   ② 纯函数（数据层）：轮次分档 / 选项裁切 / 场景标签 / 单字登记 /
 *      破折号体检 / 记录封包 / 读数 —— 都不碰存储、不碰网络；
 *   ③ 落盘（PhoneStorage）：三条会话键，全走 /^kettle_/ 前缀。
 *
 * ── 三条会话键 ──────────────────────────────────────────
 *   · kettle_notes   —— 已封的对话记录（对面的人 / 轮次 / 首句 / 快照）；
 *   · kettle_policy  —— 策略（保留多少条）；
 *   · kettle_ledger  —— 台账（每次收拾一段回信的回执）。
 *
 * ── 不缝的那一块（源的核心能力，本件不接）──────────────
 *   源自己从浏览器本地存储直读模型地址与密钥、自己拼 system prompt、
 *   自己走 SSE 流式回信。本件**零网络调用、零密钥读**：只产**可复制的
 *   要求文本**（composeEnvelope）与**回信收拾**（parseReply）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是没记过」（_readRaw 分两种回报）；
 *   · 轮次数不出来 **不许**当成「聊了很久」（roundBucketOf 三态）；
 *   · 选项不足三个 **不许**当合格的一组（parseOptions 四态）；
 *   · 场景标签缺了 **不许**沿用上一次的地点（parseScene 三态）；
 *   · 单字语气词 **不许**被静默保存（soloRegister 只登记）；
 *   · 换会话后旧记录与旧回执 **不许**留着（onChatChanged 全量重取）。
 * ======================================================== */
import {
    KETTLE_ROUND_BUCKETS, KETTLE_ROUND_META, KETTLE_ROUND_UNKNOWN,
    KETTLE_OPTION_FACES, KETTLE_OPTION_FACE_TEXT, KETTLE_OPTIONS_MIN, KETTLE_OPTIONS_MAX,
    KETTLE_SCENE_STATES, KETTLE_SCENE_MAX_LEN,
    KETTLE_SOLO_CHARS, KETTLE_SOLO_WHY, KETTLE_DASH_CHAR, KETTLE_DASH_LONG,
    KETTLE_MAX_NOTES, KETTLE_MAX_TEXT, KETTLE_MAX_SUMMARY, KETTLE_MAX_SNAPSHOT,
    KETTLE_SETTLE_REASONS, KETTLE_NOTE_STATES, KETTLE_FACES, KETTLE_FACE_TEXT,
    roundBucketOf, parseOptions, parseScene, splitTranscript,
    soloRegister, dashAudit, noteStateOf, settleRecord, composeEnvelope,
    kettleReadings, ledgerFace
} from './kettle-data.js';
import { KettleView } from './kettle-view.js';
import { writeReceipt } from '../../config/write-receipt.js';
import { numOrNull } from '../../config/num-gate.js';

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中
   /^kettle_/，否则跨会话串味。源把探店记录直接写进宿主会话。 */
const NOTES_KEY = 'kettle_notes';
const POLICY_KEY = 'kettle_policy';
const LEDGER_KEY = 'kettle_ledger';
/** 取数面读数（视图不自己拼统计）。
 *  ★ 三态常量**从真源数组派生**，不手写标识符形（本仓 J7 形态：手写一份靠碰巧
 *    拼写一致对齐，真源增删一态就静默走兜底）。
 *  ★ 本件比源多一态：源把「这一格写了但认不出来」与「没写过」都画成空列表，
 *    于是用户看着空界面不知道该去补写、还是该去修那格坏数据（noteStateOf 判它）。 */
const FACE_OK = KETTLE_FACES[0];
const FACE_MALFORMED = KETTLE_FACES[2];
const FACE_ABSENT = KETTLE_FACES[3];

/** 覆盖值取值口：显式传入的**真数字**才认，取不出来回落。
 *  ★ 不写弱口径签名（那是本仓 W1 门禁禁的形态：会把「没给」说成「给了 0」）。 */
function numOrSelf(v, self) {
    const n = numOrNull(v);
    return n === null ? self : n;
}

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

/** 「这一格写了东西、但认不出来」——_readRaw 的三种回报里只有这一种算数。
 *  ★ 与「storage 取不出来」（ok=false）**不同形**：那个是**取不出来**，
 *    这个是**取到了但读不懂**，用户要做的事不一样（修数据 vs 检查存储）。
 *  ★ 与「没写过」（ok=true, raw=null, text=null）也不同形。 */
function malformedOf(rep) {
    const r = (rep && typeof rep === 'object') ? rep : {};
    return !!(r.ok === true && r.raw === null && typeof r.text === 'string' && r.text.trim());
}

function clampLen(s, max) {
    const t = toStr(s).trim();
    return t.length > max ? t.slice(0, max) : t;
}

/** 保留数取值门：显式传入的**正整数**才认，否则回落真源上限。
 *  ★ 「0 / 负数 / 小数 / 非数」一律回落，不静默当成 0。 */
function keepOr(v) {
    const n = numOrNull(v);
    if (n === null || !Number.isInteger(n) || n < 1) return KETTLE_MAX_NOTES;
    return Math.min(n, KETTLE_MAX_NOTES);
}

/** 只收非空字符串数组，去重、封顶。 */
function toStrArr(v, cap) {
    if (!Array.isArray(v)) return [];
    const lim = numOrSelf(cap, KETTLE_MAX_SNAPSHOT);
    const out = [];
    for (const x of v) {
        if (typeof x === 'string' && x && out.indexOf(x) < 0) out.push(x);
        if (out.length >= lim) break;
    }
    return out;
}

/** 台账最多留最近多少张回执（源把回执与记录混在一处，无上限）。 */
const LEDGER_KEEP = 40;

export class KettleApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        /* 已封的记录（每条只放原始字段与可读快照，不放派生结论） */
        this.notes = [];
        /* 策略：台账最多留多少张 */
        this.ledgerKeep = LEDGER_KEEP;
        /* 台账 */
        this.receipts = [];
        /* 当前正在看的记录下标（视图态，进重绑表） */
        this._current = '';
        this._draft = '';
        this._tab = 'notes';
        this.face = FACE_ABSENT;
        this._readings = kettleReadings([], {});
        /* 读数可不可信（storage 取不出来时读数是**假的**，不能当零点画） */
        this._readingsOk = false;
        this._proj = null;
        this._view = null;
        /* 三格里有没有「写了但认不出来」的（本件守的第四态；源画不出这一态）。 */
        this._bad = false;
        /* 记录格为什么读不出内容（'' = 正常；'malformed' = 写了但认不出来）。 */
        this._notesWhy = '';
        /* ★ 构造末尾就取一次数：否则记录与读数在 render() 之前是空的 ——
         *  任何先读后画的路径都会把「还没取数」看成「一条都没有」。 */
        this.probe();
    }
    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; }
        catch (_e) { return globalThis; }
    }
    /**
     * 取数（**分两种回报**）：ok 说「storage 能不能用」，raw 说「这一格读到了什么」。
     *   · ok === false ⇒ storage 没给 / 一取就抛 ⇒ 这是「取不出来」，不是「空的」；
     *   · ok === true, raw === null ⇒ storage 是好的，只是这一格没有 / 不是合法 JSON。
     */
    _readRaw(key) {
        /* ★ 「能读不能写」也算存储不可用：本件的核心动作就是落盘，
         *   能读不能写意味着「当场看着成功、下次打开全没了」——不报错不崩，只是结果不对。 */
        if (!this.storage || typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, raw: null, text: null };
        }
        let text = null;
        try { text = this.storage.get(key); }
        catch (_e) { return { ok: false, raw: null, text: null }; }
        if (typeof text !== 'string') return { ok: true, raw: text, text: null };
        try { return { ok: true, raw: JSON.parse(text), text: text }; }
        catch (_e) { return { ok: true, raw: null, text: text }; }
    }
    _writeJSON(key, v) {
        try {
            if (!this.storage || typeof this.storage.set !== 'function') return false;
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，
             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */
            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;
        } catch (_e) { return false; }
    }
    /* ---------- 装载 ---------- */
    _loadNotes(rep0) {
        const rep = (rep0 && typeof rep0 === 'object') ? rep0 : { ok: false, raw: null, text: null };
        /* ★ noteStateOf 判「这一格写了什么」：可读 / 没写 / 写了但认不出来。
         *   源三种都塔成空列表（用户看着空界面，不知道该补写还是该修数据）。 */
        const st = noteStateOf(rep.ok ? rep.text : null);
        const malformed = st.state === KETTLE_NOTE_STATES[2];
        this._notesWhy = malformed ? 'malformed' : '';
        const shape = malformed ? {} : { notes: st.notes };
        const list = Array.isArray(shape.notes) ? shape.notes : [];
        const kept = [];
        for (let i = 0; i < list.length && kept.length < KETTLE_MAX_NOTES; i += 1) {
            const one = list[i];
            if (!one || typeof one !== 'object') continue;
            kept.push({
                partner: clampLen(one.partner, 40),
                shop: clampLen(one.shop, 40),
                rounds: numOrNull(one.rounds),
                bucket: toStr(one.bucket),
                firstLine: clampLen(one.firstLine, KETTLE_MAX_SUMMARY),
                soloHits: numOrNull(one.soloHits),
                soloChars: toStrArr(one.soloChars, KETTLE_MAX_SNAPSHOT),
                dashTotal: numOrNull(one.dashTotal),
                dashDense: one.dashDense === true,
                scene: toStr(one.scene),
                sceneState: toStr(one.sceneState),
                at: toStr(one.at)
            });
        }
        this.notes = kept;
        return malformed;
    }
    _loadPolicy(rep) {
        const r0 = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : {};
        this.ledgerKeep = keepOr(r0.ledgerKeep);
        return malformedOf(rep);
    }
    _loadLedger(rep) {
        const r = (rep && rep.ok && rep.raw && typeof rep.raw === 'object') ? rep.raw : {};
        const rs = Array.isArray(r.receipts) ? r.receipts : [];
        const kept = [];
        for (let i = 0; i < rs.length && kept.length < LEDGER_KEEP; i += 1) {
            const one = rs[i];
            if (!one || typeof one !== 'object') continue;
            kept.push({
                at: toStr(one.at),
                partner: clampLen(one.partner, 40),
                rounds: numOrNull(one.rounds),
                bucket: toStr(one.bucket),
                optionFace: toStr(one.optionFace),
                optionCount: numOrNull(one.optionCount),
                options: toStrArr(one.options, KETTLE_OPTIONS_MAX),
                dropped: numOrNull(one.dropped),
                sceneState: toStr(one.sceneState),
                scene: toStr(one.scene),
                soloHits: numOrNull(one.soloHits),
                soloChars: toStrArr(one.soloChars, KETTLE_MAX_SNAPSHOT),
                lone: numOrNull(one.lone),
                dashTotal: numOrNull(one.dashTotal),
                dashDense: one.dashDense === true,
                dashWhy: toStr(one.dashWhy)
            });
        }
        this.receipts = kept;
        return malformedOf(rep);
    }
    _persistNotes() { this._writeJSON(NOTES_KEY, { notes: this.notes }); }
    _persistPolicy() { this._writeJSON(POLICY_KEY, { ledgerKeep: this.ledgerKeep }); }
    _persistLedger() { this._writeJSON(LEDGER_KEY, { receipts: this.receipts }); }

    /* ---------- 缺省态（storage 取不出来时用；此时投影为 null） ---------- */
    _clearToDefaults() {
        this.notes = [];
        this.receipts = [];
        this.ledgerKeep = LEDGER_KEEP;
    }
    /* ---------- 取数 ---------- */
    probe() {
        const rn = this._readRaw(NOTES_KEY);
        const rp = this._readRaw(POLICY_KEY);
        const rl = this._readRaw(LEDGER_KEY);
        const storageOk = !!(rn.ok && rp.ok && rl.ok);
        if (storageOk) {
            /* ★ 三格各自报「写了但认不出来」：账实两格的坏内容在源里都塔成空。 */
            this._bad = this._loadNotes(rn);
            if (this._loadPolicy(rp)) this._bad = true;
            if (this._loadLedger(rl)) this._bad = true;
        } else {
            this._clearToDefaults();
            this._bad = false;
            this._notesWhy = '';
        }
        this._readingsOk = storageOk;
        this._readings = kettleReadings(this.notes, { cap: this.ledgerKeep });
        /* 面的优先级：取不出来 > 有记录 > （写了但认不出来 > 一条都没有）。 */
        this.face = storageOk
            ? (this.notes.length > 0 ? FACE_OK : ledgerFace(this.receipts.length, true, this._bad))
            : FACE_ABSENT;
        this._proj = storageOk ? this._project() : null;
        return this._proj;
    }
    /** 投影：视图只吃这一份。
     *  ★ roundRows.count / optionRows.count 在「读数取不出来」时是 **null**（不是 0）。 */
    _project() {
        return {
            face: this.face,
            faceText: this.faceTextOf(this.face),
            /* ★ 「这一格写了但认不出来」必须报出（源把它画成空列表）。 */
            malformed: this._bad === true,
            readings: this._readings,
            notes: this.noteRows(),
            rounds: this.roundRows(),
            options: this.optionRows(),
            receipts: this.receiptRows(),
            policy: this.policyRow()
        };
    }
    /* ---------- 读数面 ---------- */
    noteRows() {
        return this.notes.map((n, i) => {
            const b = roundBucketOf(n.rounds);
            const st = n.sceneState || KETTLE_SCENE_STATES[1];
            return {
                index: i,
                partner: n.partner,
                shop: n.shop,
                rounds: n.rounds,
                bucket: b.bucket,
                bucketKnown: b.ok === true,
                bucketLabel: b.ok ? b.label : KETTLE_ROUND_UNKNOWN,
                firstLine: n.firstLine,
                soloHits: n.soloHits,
                soloChars: n.soloChars.slice(),
                dashTotal: n.dashTotal,
                dashDense: n.dashDense === true,
                scene: n.scene,
                sceneState: st,
                sceneLabel: st === KETTLE_SCENE_STATES[0] ? n.scene : (st === KETTLE_SCENE_STATES[1] ? '这次没标地点' : '地点标签认不出来'),
                at: n.at
            };
        });
    }
    /** 轮次三档逐档一行（塔成一档就说明真源表被写死了一份）。 */
    roundRows() {
        const counts = this._readings.perBucket || {};
        return KETTLE_ROUND_BUCKETS.map((k) => ({
            key: k,
            label: KETTLE_ROUND_META[k].label,
            max: KETTLE_ROUND_META[k].max,
            why: KETTLE_ROUND_META[k].why,
            /* ★ 三态：读数取不出来时是 **null**（视图画「—」） */
            count: this._readingsOk ? numOrNull(counts[k]) : null
        }));
    }
    /** 选项协议四态逐态一行。 */
    optionRows() {
        const total = this._readings.total;
        return KETTLE_OPTION_FACES.map((k) => {
            let count = 0;
            for (const r of this.receipts) if (r.optionFace === k) count += 1;
            return {
                key: k,
                text: KETTLE_OPTION_FACE_TEXT[k],
                count: this._readingsOk ? count : null,
                rate: (this._readingsOk && total > 0) ? Math.round((count * 100) / total) : null
            };
        });
    }
    receiptRows() {
        return this.receipts.map((r) => {
            const b = roundBucketOf(r.rounds);
            return {
                at: r.at,
                partner: r.partner,
                rounds: r.rounds,
                bucket: b.bucket,
                bucketKnown: b.ok === true,
                bucketLabel: b.ok ? b.label : KETTLE_ROUND_UNKNOWN,
                optionFace: r.optionFace,
                optionText: KETTLE_OPTION_FACE_TEXT[r.optionFace] || r.optionFace,
                optionCount: r.optionCount,
                options: r.options.slice(),
                dropped: r.dropped,
                sceneState: r.sceneState,
                scene: r.scene,
                sceneLabel: r.sceneState === KETTLE_SCENE_STATES[0] ? r.scene : (r.sceneState === KETTLE_SCENE_STATES[1] ? '没标地点（源会沿用上一次的地点）' : '地点标签认不出来'),
                soloHits: r.soloHits,
                soloChars: r.soloChars.slice(),
                lone: r.lone,
                dashTotal: r.dashTotal,
                dashDense: r.dashDense === true,
                dashWhy: r.dashWhy
            };
        });
    }
    policyRow() {
        return {
            ledgerKeep: this.ledgerKeep,
            receiptCount: this.receipts.length,
            receiptFull: this.receipts.length >= this.ledgerKeep,
            noteCount: this.notes.length,
            maxNotes: KETTLE_MAX_NOTES
        };
    }
    readings() { return this._readingsOk ? this._readings : null; }
    readingsOk() { return this._readingsOk === true; }
    faceOf() { return this.face; }
    summaryLine() {
        const r = this._readings;
        if (!this._readingsOk) return '读数拿不到（存储不可用）';
        const bits = ['共 ' + r.total + ' 段对话'];
        bits.push('轮次认得出来 ' + (r.total - r.unknownRounds) + ' / ' + r.total);
        if (r.unknownRounds) bits.push('轮次数不出 ' + r.unknownRounds);
        if (r.withSolo) bits.push('含单字语气词 ' + r.withSolo);
        if (r.withDenseDash) bits.push('破折号偏密 ' + r.withDenseDash);
        bits.push('回执 ' + this.receipts.length + ' / ' + this.ledgerKeep + ' 条');
        return bits.join(' · ');
    }
    /** 真源表读数（视图的键面来自这几张，不许手写）。 */
    catalogs() {
        return {
            rounds: KETTLE_ROUND_BUCKETS,
            roundMeta: KETTLE_ROUND_META,
            optionFaces: KETTLE_OPTION_FACES,
            optionText: KETTLE_OPTION_FACE_TEXT,
            sceneStates: KETTLE_SCENE_STATES,
            soloChars: KETTLE_SOLO_CHARS,
            soloWhy: KETTLE_SOLO_WHY,
            dashChar: KETTLE_DASH_CHAR,
            dashLong: KETTLE_DASH_LONG,
            noteStates: KETTLE_NOTE_STATES,
            settleReasons: KETTLE_SETTLE_REASONS,
            faces: KETTLE_FACES,
            faceText: KETTLE_FACE_TEXT,
            roundUnknown: KETTLE_ROUND_UNKNOWN,
            limits: {
                maxNotes: KETTLE_MAX_NOTES,
                maxText: KETTLE_MAX_TEXT,
                maxSummary: KETTLE_MAX_SUMMARY,
                maxSnapshot: KETTLE_MAX_SNAPSHOT,
                optionsMin: KETTLE_OPTIONS_MIN,
                optionsMax: KETTLE_OPTIONS_MAX,
                sceneMaxLen: KETTLE_SCENE_MAX_LEN
            },
            tabs: ['notes', 'rounds', 'options', 'ledger', 'policy']
        };
    }
    roundLabelOf(k) { return KETTLE_ROUND_META[k] ? KETTLE_ROUND_META[k].label : KETTLE_ROUND_UNKNOWN; }
    optionTextOf(k) { return KETTLE_OPTION_FACE_TEXT[k] || String(k); }
    faceTextOf(k) { return KETTLE_FACE_TEXT[k] || String(k); }

    /* ---------- 封一段对话（不许静默接受坏值） ---------- */
    /**
     * settleTranscript(text, opts) —— 把**贴回来的一整段对话**封成一条记录。
     * ★ 这是本件的主入口：用户从自己惯用的对话端拿到一段对话，整段贴进来。
     *   「拆不出说话人」的那几行如实报出（源会当成对面说的话，轮次数因此虚高）。
     */
    settleTranscript(text, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const sp = splitTranscript(text, o.partner);
        if (!sp.messages.length) return { ok: false, reasons: ['no_note'], labels: [], split: sp };
        const r = this.settle({
            partner: o.partner,
            shop: o.shop,
            at: o.at,
            messages: sp.messages
        });
        if (r.ok) r.split = sp;
        return r;
    }
    /**
     * settleDemo(partner, shop, at) —— 封一段**示范**对话。
     * ★ 它存在有两条理由（都不是为了凑数）：
     *   ① 让「轮次三档」这一面在**没有任何外部输入**时也能被判据真跑到；
     *   ② 示范里刻意带一处单字语气词与一处偏密的破折号，使「登记不留」与
     *      「破折号体检」两条在台账面上看得见（否则这两条只有靠手工贴才验得到）。
     */
    settleDemo(partner, shop, at) {
        const who = clampLen(partner, 40) || '对面的人';
        const lines = [
            who + '：今天的汤滚得很慢。',
            '我：那就等它滚。',
            who + '：嗯——',
            who + '：不过你要是不赶时间——我可以再讲一件旧事——那件事我从来没跟别人说过——真的——你信不信——就一句。',
            '我：讲吧。'
        ];
        return this.settleTranscript(lines.join(String.fromCharCode(10)), { partner: who, shop: shop, at: at });
    }

    /**
     * settle(record) —— 把一段对话封成一条记录。
     * ★ 三因各自报出：没有正文（no_note）/ 没有对面的人（no_partner）/
     *   轮次数不出来（bad_rounds）。源三种都静默落一条残缺记录。
     */
    settle(record) {
        const r = (record && typeof record === 'object') ? record : {};
        const pack = settleRecord(r);
        if (!pack.ok) {
            return { ok: false, reasons: pack.reasons, labels: pack.labels, pack: pack };
        }
        if (this.notes.length >= KETTLE_MAX_NOTES) {
            return { ok: false, reasons: ['over_max'], labels: ['记录满了'], max: KETTLE_MAX_NOTES, saw: this.notes.length };
        }
        const msg = Array.isArray(r.messages) ? r.messages : [];
        /* ★ 三项体检跑在**整段**上，不是最后一句上：
         *   · 单字语气词要回答「这一段里出现过几处」（只看末句会漏掉中间那几声）；
         *   · 破折号密度本来就是**整段**的观感（只看末句量不出一条线）；
         *   · 场景标签模型通常写在首行，但换地方会再标一次 —— 取整段里第一次出现的。
         *   源把这三件事各写在四处，且都只看**当轮**那一句。 */
        const whole = msg.map((m) => toStr(m && m.content)).join(String.fromCharCode(10));
        const solo = soloRegister(whole);
        const dash = dashAudit(whole);
        const scene = parseScene(whole);
        const one = {
            partner: pack.partner,
            shop: pack.shop,
            rounds: pack.rounds,
            bucket: pack.bucket,
            firstLine: pack.firstLine,
            soloHits: solo.hits,
            soloChars: solo.chars.slice(0, KETTLE_MAX_SNAPSHOT),
            dashTotal: dash.total,
            dashDense: dash.dense === true,
            scene: scene.scene,
            sceneState: scene.state,
            at: toStr(r.at)
        };
        this.notes.push(one);
        this._persistNotes();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, note: this.noteRows()[this.notes.length - 1], pack: pack };
    }
    /** 撤一条（封错了 / 不想要了）。 */
    unnote(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.notes.length) {
            return { ok: false, reason: 'out_of_range', saw: index };
        }
        this.notes.splice(i, 1);
        if (this._current !== '') this._current = '';
        this._persistNotes();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, left: this.notes.length };
    }
    noteAt(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.notes.length) return null;
        return this.notes[i];
    }
    noteCount() { return this.notes.length; }

    /* ---------- 收拾回信：解析 / 校验 / 入台账 ---------- */
    /**
     * buildEnvelope(index) —— 给这一条产一段可复制的要求文本。
     * 本件不替你发请求（源自己发 SSE），只把要求写清楚。
     */
    buildEnvelope(index) {
        const n = this.noteAt(index);
        if (!n) return { ok: false, reason: 'out_of_range', saw: index };
        const text = composeEnvelope({ name: n.partner, persona: n.firstLine }, { shop: n.shop });
        this._draft = text;
        return { ok: true, text: text, partner: n.partner, shop: n.shop, soloWords: KETTLE_SOLO_CHARS.length };
    }
    /**
     * parseReply(index, raw) —— 收拾一段模型回信。
     * ★ 四件事各自报出：选项三态、场景三态、单字登记、破折号体检。
     *   源把这四件事各写在四处、且都不报「这一轮**没**给选项」这件事。
     */
    parseReply(index, raw) {
        const n = this.noteAt(index);
        if (!n) return { ok: false, reason: 'out_of_range', saw: index };
        const text = toStr(raw);
        if (!text.trim()) return { ok: false, reason: 'empty_input' };
        const opt = parseOptions(text);
        const scene = parseScene(text);
        const solo = soloRegister(text);
        const dash = dashAudit(text);
        const ledgerOne = {
            at: toStr(n.at),
            partner: n.partner,
            rounds: n.rounds,
            bucket: n.bucket,
            optionFace: opt.face,
            optionCount: opt.items.length,
            options: opt.items.slice(),
            dropped: opt.dropped,
            sceneState: scene.state,
            scene: scene.scene,
            soloHits: solo.hits,
            soloChars: solo.chars.slice(0, KETTLE_MAX_SNAPSHOT),
            lone: solo.lone,
            dashTotal: dash.total,
            dashDense: dash.dense === true,
            dashWhy: dash.why
        };
        this.receipts.push(ledgerOne);
        this._trimLedger();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return {
            ok: true,
            optionFace: opt.face,
            optionText: KETTLE_OPTION_FACE_TEXT[opt.face] || opt.face,
            options: opt.items.slice(),
            dropped: opt.dropped,
            sceneState: scene.state,
            scene: scene.scene,
            sceneLabel: scene.state === KETTLE_SCENE_STATES[0] ? scene.scene : KETTLE_SCENE_STATES[1],
            soloHits: solo.hits,
            soloChars: solo.chars.slice(0, KETTLE_MAX_SNAPSHOT),
            soloWhy: KETTLE_SOLO_WHY,
            dashDense: dash.dense === true,
            dashWhy: dash.why,
            receipt: this.receiptRows()[this.receipts.length - 1]
        };
    }
    clearLedger() {
        this.receipts = [];
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true };
    }

    /* ---------- 策略 ---------- */
    /** 台账最多留多少张：源对回执无上限（与记录混在一个键里一直堆）；本仓给口并回落。 */
    setLedgerKeep(v) {
        const saw = v;
        this.ledgerKeep = keepOr(v);
        this._trimLedger();
        this._persistPolicy();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saw: saw, took: this.ledgerKeep, max: KETTLE_MAX_NOTES };
    }
    ledgerKeepOf() { return this.ledgerKeep; }
    /** 裁剪台账到保留数。
     *
     *  ★ 循环上界**自己带下界**：上游归一（keepOr）一旦被绕过，负保留数会让
     *    「条数 > 负数」恒真 ⇒ **无限循环**把界面挂死（v3.39.0 负控制实测到过这一族）。
     *    单靠上游归一就是单点防线。
     */
    _trimLedger() {
        const lim = Math.max(1, numOrSelf(this.ledgerKeep, LEDGER_KEEP));
        while (this.receipts.length > lim) this.receipts.shift();
    }
    draftOf() { return this._draft; }

    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'notes');
        const ok = ['notes', 'rounds', 'options', 'ledger', 'policy'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'notes';
        return this._tab;
    }
    openNote(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.notes.length) {
            return { ok: false, reason: 'out_of_range' };
        }
        this._current = String(i);
        this._tab = 'notes';
        if (this._view) this._view.refresh();
        return { ok: true, row: this.noteRows()[i] };
    }
    closeNote() {
        this._current = '';
        this._tab = 'notes';
        if (this._view) this._view.refresh();
        return this._tab;
    }
    currentKey() { return this._current; }

    /* ---------- 生命周期 ---------- */
    /** 换会话：记录、策略、台账全是「这段关系的账」，故全部重取。 */
    onChatChanged() {
        this._current = '';
        this._draft = '';
        this._tab = 'notes';
        /* ★ 三格的装载由 probe **一处**承担（单一装载路径）：
         *   两处装载会造出「首次渲染走这套、换会话走那套」的双口径，
         *   而双口径必定分歧（本仓为此吃过亏）。 */
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new KettleView(this, this.shell, this.storage);
        this._view.render();
    }
}