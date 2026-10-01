/* ========================================================
 * sourcebook-app.js — [v3.39.0] 时光胶囊 · 封存取回台
 *
 * 数据层：sourcebook-data.js（纯函数内核）  视图层：sourcebook-view.js
 *
 * ── 三层分工（与第 2 / 第 3 层各件同规格）──────────────
 *   ① 取数（probe）：每次 render / refresh 都重取，不持跨轮副本
 *      （换会话 / 外部改动后陈旧副本会静默生效）；
 *   ② 纯函数（数据层）：跨度分档 / 口吻分族 / 折叠归一 / 回信归一 /
 *      两条硬约束 / 读数 —— 都不碰存储、不碰网络，于是无头环境就能判；
 *   ③ 落盘（PhoneStorage）：三条会话键，全走 /^sourcebook_/ 前缀。
 *
 * ── 三条会话键 ──────────────────────────────────────────
 *   · sourcebook_capsules —— 封存的信（message / openDate / createdAt /
 *                             mood / roleId）；
 *   · sourcebook_policy   —— 策略（默认跨度显示、口吻族提示开关）；
 *   · sourcebook_ledger   —— 台账（每次取回的回执 + 待贴回的回信正文）。
 *
 * ── 不缝的那一块（源的核心能力，本件不接）──────────────
 *   源自己从 localStorage 直读 apiUrl / apiKey / selectedModel 并拼 chat
 *   请求。本件**零网络调用、零密钥读**：只产**可复制的要求文本**
 *   （composeRequest）与**回信校验**，由用户贴回自己惯用的对话端。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是空的」（_readRaw 分两种回报）；
 *   · 封存时间取不出来 **不许**当成「今天封的」（spanOf 三态）；
 *   · 心情未填写 **不许**与填了默认值同形（moodOf 两态）；
 *   · 坏输入 **不许**静默成了空列表（foldCapsules 分因）；
 *   · 回信落兜底 **不许**报成模型真写了（provided 逐段）；
 *   · 换会话后旧信与旧回执 **不许**留着（onChatChanged 全量重取）。
 * ======================================================== */
import {
    SPAN_BUCKETS, SPAN_META, TONE_TYPES, TONE_META, MOOD_FALLBACK,
    GUARD_REASONS, GUARD_KEYS, ECHO_SEGMENTS, RECIPIENT_KINDS, RECIPIENT_KEYS,
    CREATED_STATES, CREATED_STATE_KEYS, SOURCEBOOK_FACES, SPAN_UNKNOWN_LABEL,
    SOURCEBOOK_MAX_CAPSULES, SOURCEBOOK_MAX_TITLE, SOURCEBOOK_MAX_MESSAGE,
    SOURCEBOOK_MAX_KEYWORDS, SOURCEBOOK_MAX_RECEIPTS, SOURCEBOOK_RECEIPT_WITNESS_MAX,
    parseOpenDate, spanLabel, spanOf, moodOf,
    toneOf, toneLabel, normalizeCapsules, guardEcho, guardLabel, guardVocab,
    cleanText, inlineText, clampText, normalizeEcho, composeRequest,
    sourcebookReadings, ledgerFace
} from './sourcebook-data.js';
import { SourcebookView } from './sourcebook-view.js';
import { numOrNull } from '../../config/num-gate.js';

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中
   /^sourcebook_/，否则跨会话串味。源把胶囊写在宿主微信键下（全局）。 */
const CAPSULES_KEY = 'sourcebook_capsules';
const POLICY_KEY = 'sourcebook_policy';
const LEDGER_KEY = 'sourcebook_ledger';
/** 取数面读数（视图不自己拼统计）。★ 键面取数据层真源 SOURCEBOOK_FACES，
 *  不在本文件另写一份（本仓 J7 形态：两份靠碰巧拼写一致对齐）。 */
const FACE = SOURCEBOOK_FACES;
const NL = String.fromCharCode(10);

/** 覆盖值取值口（时间戳 / 上限共用）：显式传入的**真数字**才认，取不出来回落。
 *  ★ 不走 ?? 兜底：本仓口径里「传了 null」与「没传」都回落，
 *    而 ?? 会让 null 直接返回 null；也**不写** Number.isFinite(Number(v))
 *    （那是弱口径签名，Number(null) 是 0，会把「没给」说成「给了 0」）。 */
function numOrSelf(v, self) {
    const n = numOrNull(v);
    return n === null ? self : n;
}

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

/** 台账保留数取值门：显式传入的**正整数**才认，否则回落真源上限。
 *  ★ 「0 / 负数 / 小数 / 非数」一律回落，不静默当成 0（那会让台账一存就空）。 */
function keepOr(v) {
    const n = numOrNull(v);
    if (n === null || !Number.isInteger(n) || n < 1) return SOURCEBOOK_MAX_RECEIPTS;
    return Math.min(n, SOURCEBOOK_MAX_RECEIPTS);
}

/** 只收非空字符串数组，去重、封顶（信 id 表走这里）。 */
function toStrArr(v, cap) {
    if (!Array.isArray(v)) return [];
    const lim = numOrSelf(cap, SOURCEBOOK_MAX_CAPSULES);
    const out = [];
    for (const x of v) {
        if (typeof x === 'string' && x && out.indexOf(x) < 0) out.push(x);
        if (out.length >= lim) break;
    }
    return out;
}

/** 台账最多留最近多少张回执（源存在同一个 IndexedDB 键里，无上限）。 */
const LEDGER_KEEP = SOURCEBOOK_MAX_RECEIPTS;

export class SourcebookApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        /* 封存的信（每条只放原始字段，不放派生结论） */
        this.capsules = [];
        /* 策略：台账最多留多少张（源把回执存在同一个 IndexedDB 键里，无上限）*/
        this.ledgerKeep = LEDGER_KEEP;
        /* 台账 */
        this.receipts = [];
        /* 当前正在看的信下标（视图态，进重绑表） */
        this._current = '';
        this._draft = '';
        this._tab = 'shelf';
        this.face = FACE.storage_absent;
        this._readings = sourcebookReadings([], {});
        /* 读数可不可信（storage 取不出来时读数是**假的**，不能当零点画）。
         *  这一位是进 spanRows / toneRows / readings() 的唯一门。 */
        this._readingsOk = false;
        this._proj = null;
        this._view = null;
        this._loadCapsules();
        this._loadPolicy();
        this._loadLedger();
        /* ★ 构造末尾就取一次数：否则书架 / 读数在 render() 之前是空的 ——
         *  任何先读后画的路径都会把「还没取数」看成「一条信都没有」。 */
        this.probe();
    }
    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; }
        catch (_e) { return globalThis; }
    }
    /** 取数（吞异常版）：只给「没有就用默认」的场景用（配置键）。 */
    _readJSON(key) {
        try {
            const raw = this.storage ? this.storage.get(key) : null;
            return (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (_e) { return null; }
    }
    /**
     * 取数（**分两种回报**）：ok 说「storage 能不能用」，raw 说「这一格读到了什么」。
     *   · ok === false ⇒ storage 没给 / 一取就抛 ⇒ 这是「取不出来」，不是「空的」；
     *   · ok === true, raw === null ⇒ storage 是好的，只是这一格没有 / 不是合法 JSON。
     * 源把胶囊写在宿主键下，从没区分过这两种情形。
     */
    _readRaw(key) {
        if (!this.storage || typeof this.storage.get !== 'function') return { ok: false, raw: null };
        let text = null;
        try { text = this.storage.get(key); }
        catch (_e) { return { ok: false, raw: null }; }
        if (typeof text !== 'string') return { ok: true, raw: text };
        try { return { ok: true, raw: JSON.parse(text) }; }
        catch (_e) { return { ok: true, raw: null }; }
    }
    _writeJSON(key, v) {
        try {
            if (!this.storage || typeof this.storage.set !== 'function') return false;
            this.storage.set(key, JSON.stringify(v));
            return true;
        } catch (_e) { return false; }
    }
    /* ---------- 装载 ---------- */
    _loadCapsules() {
        const raw = this._readJSON(CAPSULES_KEY);
        const r = normalizeCapsules(raw);
        this.capsules = r.ok ? r.list.slice(0, SOURCEBOOK_MAX_CAPSULES) : [];
        this._loadWhy = r.ok ? null : r.reason;
    }
    _loadPolicy() {
        const raw = this._readJSON(POLICY_KEY);
        const r = (raw && typeof raw === 'object') ? raw : {};
        this.ledgerKeep = keepOr(r.ledgerKeep);
    }
    _loadLedger() {
        const raw = this._readJSON(LEDGER_KEY);
        const r = (raw && typeof raw === 'object') ? raw : {};
        const rs = Array.isArray(r.receipts) ? r.receipts : [];
        const kept = [];
        for (let i = 0; i < rs.length && kept.length < LEDGER_KEEP; i += 1) {
            const one = rs[i];
            if (!one || typeof one !== 'object') continue;
            kept.push({
                at: toStr(one.at),
                capsuleId: toStr(one.capsuleId),
                spanBucket: toStr(one.spanBucket),
                spanDays: numOrNull(one.spanDays),
                tone: toStr(one.tone),
                created: toStr(one.created),
                guardOk: one.guardOk === true,
                guardReasons: toStrArr(one.guardReasons, SOURCEBOOK_MAX_CAPSULES),
                fellBack: one.fellBack && typeof one.fellBack === 'object' ? one.fellBack : {},
                source: toStr(one.source) || 'pasted'
            });
        }
        this.receipts = kept;
    }
    _persistCapsules() { this._writeJSON(CAPSULES_KEY, { capsules: this.capsules }); }
    _persistPolicy() {
        this._writeJSON(POLICY_KEY, {
            ledgerKeep: this.ledgerKeep
        });
    }
    _persistLedger() { this._writeJSON(LEDGER_KEY, { receipts: this.receipts }); }

    /* ---------- 缺省态（storage 取不出来时用；此时投影为 null） ---------- */
    _clearToDefaults() {
        this.capsules = [];
        this.receipts = [];
        this.ledgerKeep = LEDGER_KEEP;
    }
    /* ---------- 取数（每次 render / 换会话 / 外部改动后都重取） ---------- */
    /**
     * probe() —— 真取一次数，回投影（视图只吃投影，不自己拆内部结构）。
     * ★ 三条键里任何一条「取不出来」（storage 没给 / 一取就抛）都算
     *   storage_absent，且此时投影为 **null** —— 视图拿不到投影就只能画
     *   「取不出来」，绝不会把「读不到」画成「一条信都没有」。
     */
    probe() {
        const rc = this._readRaw(CAPSULES_KEY);
        const rp = this._readRaw(POLICY_KEY);
        const rl = this._readRaw(LEDGER_KEY);
        const storageOk = !!(rc.ok && rp.ok && rl.ok);
        if (storageOk) {
            this._loadCapsules();
            this._loadPolicy();
            this._loadLedger();
        } else {
            this._clearToDefaults();
        }
        const ledger = { receipts: this.receipts };
        this._readingsOk = storageOk;
        this._readings = sourcebookReadings(this.capsules, ledger);
        /* 面的优先级：storage 取不出来（最贵，读数本身就是假的）> 有信 > 台账三态。
         *   修前本行取 ledgerFace(ledger)，而它对空台账一律回 empty ——
         *   与「一条信都没有」同形：用户分不出该去看书架、还是台账本来就空。 */
        this.face = storageOk
            ? (this.capsules.length > 0 ? FACE.ok : ledgerFace(ledger))
            : FACE.storage_absent;
        this._proj = storageOk ? this._project() : null;
        return this._proj;
    }
    /** 投影：视图只吃这一份。
     *  ★ spanRows.count / toneRows.count 在「读数取不出来」时是 **null**（不是 0）——
     *    视图据此画「—」而不是「0」：「这一档真的没有信」与「读不出来」不同形。 */
    _project() {
        return {
            face: this.face,
            readings: this._readings,
            shelf: this.shelfRows(),
            spanRows: this.spanRows(),
            toneRows: this.toneRows(),
            receipts: this.receiptRows(),
            policy: this.policyRow()
        };
    }
    /* ---------- 读数面 ---------- */
    /** 书架：每条信一行（含跨度 / 口吻 / 心情两态 —— 视图不自己 resolve）。 */
    shelfRows() {
        return this.capsules.map((c, i) => {
            const span = spanOf(c);
            const tone = toneOf(c);
            const mood = moodOf(c);
            return {
                index: i,
                id: toStr(c.id),
                message: clampText(inlineText(toStr(c.message)), 40),
                openDate: toStr(c.openDate),
                createdAt: toStr(c.createdAt),
                roleId: toStr(c.roleId),
                kind: toStr(c.roleId) ? 'role' : 'self',
                spanBucket: span.bucket,
                spanKnown: span.known === true,
                spanLabel: span.known ? span.label : SPAN_UNKNOWN_LABEL,
                spanDays: span.days,
                created: toStr(span.created),
                tone: tone.type,
                toneLabel: tone.label,
                moodKey: mood.key,
                moodFilled: mood.filled === true,
                /* 封存时间三态（ok / absent / malformed）—— 只给 bool 的话
                 *  「没写」与「写了但坏的」在书架面上同形，用户不知道该补还是该改。 */
                createdAtState: this.createdStateOf(c.createdAt)
            };
        });
    }
    /** 跨度六档逐档一行（塔成一档就说明真源表被写死了一份）。 */
    spanRows() {
        const counts = this._readings.spanCounts || {};
        return SPAN_BUCKETS.map((k) => ({
            key: k,
            label: spanLabel(k),
            floorDays: SPAN_META[k].floorDays,
            /* ★ 三态：读数取不出来时是 **null**（视图画「—」）——
             *  修前这里是 numOrSelf(counts[k], 0)，把「读不到」硬塔成「这一档零封」，
             *  而上面 _project() 的注释却已写着可 null ⇒ **注释说了、机制到不了**。 */
            count: this._readingsOk ? numOrNull(counts[k]) : null
        }));
    }
    /** 口吻六族逐族一行。 */
    toneRows() {
        const counts = this._readings.toneCounts || {};
        return TONE_TYPES.map((k) => ({
            key: k,
            label: toneLabel(k),
            feel: TONE_META[k].feel,
            count: this._readingsOk ? numOrNull(counts[k]) : null
        }));
    }
    /** 台账回执行（每条带面：ok / empty / storage_absent 三态分开画）。 */
    receiptRows() {
        return this.receipts.map((r) => ({
            at: r.at,
            capsuleId: r.capsuleId,
            spanBucket: r.spanBucket,
            spanLabel: r.spanBucket ? spanLabel(r.spanBucket) : SPAN_UNKNOWN_LABEL,
            spanKnown: !!r.spanBucket,
            spanDays: r.spanDays,
            tone: r.tone,
            toneLabel: toneLabel(r.tone),
            created: r.created,
            guardOk: r.guardOk === true,
            guardReasons: r.guardReasons.slice(),
            guardLabels: r.guardReasons.map((x) => guardLabel(x)),
            fellBack: {
                title: r.fellBack.title === true,
                keywords: r.fellBack.keywords === true,
                witness: r.fellBack.witness === true
            },
            source: r.source
        }));
    }
    policyRow() {
        return {
            ledgerKeep: this.ledgerKeep,
            receiptCount: this.receipts.length,
            /* 「满没满」必须单成一位：台账被削到上限之后条数会停在同一个数字上，
             *  用户分不出「就写了这么几条」与「后面的都被削了」。 */
            receiptFull: this.receipts.length >= this.ledgerKeep,
            maxCapsules: SOURCEBOOK_MAX_CAPSULES
        };
    }
    /** 读数（**取不出来一律 null**）—— 视图只能画「读数拿不到」，不许画成零点。 */
    readings() { return this._readingsOk ? this._readings : null; }
    readingsOk() { return this._readingsOk === true; }
    faceOf() { return this.face; }
    summaryLine() {
        const r = this._readings;
        if (!this._readingsOk) return '读数拿不到（存储不可用）';
        const bits = ['共 ' + r.total + ' 封信'];
        bits.push('跨度认得出来 ' + (r.total - r.spanUnknown) + ' / ' + r.total);
        if (r.spanUnknown) bits.push('跨度取不出 ' + r.spanUnknown);
        bits.push('心情已填 ' + r.moodFilled + ' / 未填 ' + r.moodMissing);
        if (r.createdMissing) bits.push('封存时间取不出 ' + r.createdMissing);
        bits.push('回执 ' + r.receipts + ' / ' + this.ledgerKeep + ' 条');
        return bits.join(' · ');
    }
    /** 真源表读数（视图的键面来自这几张，不许手写）。 */
    catalogs() {
        return {
            spans: SPAN_BUCKETS,
            spanMeta: SPAN_META,
            tones: TONE_TYPES,
            toneMeta: TONE_META,
            guardReasons: GUARD_REASONS,
            guardKeys: GUARD_KEYS,
            guardVocab: guardVocab(),
            segments: ECHO_SEGMENTS,
            recipients: RECIPIENT_KINDS,
            recipientKeys: RECIPIENT_KEYS,
            createdStates: CREATED_STATES,
            createdKeys: CREATED_STATE_KEYS,
            faces: SOURCEBOOK_FACES,
            moodFallback: MOOD_FALLBACK,
            limits: {
                maxCapsules: SOURCEBOOK_MAX_CAPSULES,
                maxTitle: SOURCEBOOK_MAX_TITLE,
                maxMessage: SOURCEBOOK_MAX_MESSAGE,
                maxKeywords: SOURCEBOOK_MAX_KEYWORDS,
                maxReceiptWitness: SOURCEBOOK_RECEIPT_WITNESS_MAX,
                maxReceipts: SOURCEBOOK_MAX_RECEIPTS
            },
            tabs: ['shelf', 'span', 'tone', 'ledger', 'policy']
        };
    }
    /** 键面人话（视图不手写键面）。 */
    spanLabelOf(k) { return spanLabel(k); }
    toneLabelOf(k) { return toneLabel(k); }
    guardLabelOf(k) { return guardLabel(k); }

    /* ---------- 封存一条信（不许静默接受坏值） ---------- */
    /**
     * seal(capsule) —— 收一封信进书架。
     * ★ 三条必填：正文（message）/ 拆开日期（openDate）/ 封存时间（createdAt）。
     *   三者任一取不出来一律拒绝并如实分因 —— 源是直接 push，坏行会在
     *   后来算跨度时才出错（而那时早就存进库了）。
     */
    seal(capsule) {
        const c = (capsule && typeof capsule === 'object') ? capsule : {};
        const message = cleanText(toStr(c.message));
        if (!message) return { ok: false, reason: 'no_message' };
        const open = parseOpenDate(c.openDate);
        if (!open.ok) return { ok: false, reason: 'bad_open_date', saw: toStr(c.openDate), why: open.reason };
        /* 封存时间两种合法形态：YYYY-MM-DD（源用 new Date(createdAt)）或日序号。 */
        const cst = this.createdStateOf(c.createdAt);
        if (cst !== CREATED_STATES.ok) {
            return { ok: false, reason: 'bad_created_at', saw: toStr(c.createdAt), why: cst };
        }
        if (this.capsules.length >= SOURCEBOOK_MAX_CAPSULES) {
            return { ok: false, reason: 'over_max', max: SOURCEBOOK_MAX_CAPSULES, saw: this.capsules.length };
        }
        const one = {
            id: toStr(c.id) || ('sb_' + (this.capsules.length + 1) + '_' + open.saw),
            message: message,
            openDate: open.saw,
            createdAt: toStr(c.createdAt),
            mood: toStr(c.mood),
            roleId: toStr(c.roleId)
        };
        this.capsules.push(one);
        this._persistCapsules();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, capsule: this.shelfRows()[this.capsules.length - 1] };
    }
    /** 封存时间读数（三态）：seal 收信与书架读数共用这一份，防两处口径漂移。
     *  ○ YYYY-MM-DD（源用 new Date(createdAt) 收这种）／纯日序号 → ok
     *  ○ 空 → absent（**没写**）　○ 写了但不是日期也不是序号 → malformed（**写了但是坏的**）*/
    createdStateOf(v) {
        const raw = toStr(v);
        if (!raw.trim()) return CREATED_STATES.absent;
        if (parseOpenDate(raw).ok) return CREATED_STATES.ok;
        if (numOrNull(raw) !== null) return CREATED_STATES.ok;
        return CREATED_STATES.malformed;
    }
    /** 撤一封（封错了 / 不想要了）。 */
    unseal(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.capsules.length) {
            return { ok: false, reason: 'out_of_range', saw: index };
        }
        this.capsules.splice(i, 1);
        if (this._current !== '') this._current = '';
        this._persistCapsules();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, left: this.capsules.length };
    }
    capsuleAt(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.capsules.length) return null;
        return this.capsules[i];
    }
    capsuleCount() { return this.capsules.length; }

    /* ---------- 取回：产要求文本 / 收模型回信 ---------- */
    /**
     * buildRequest(index) —— 给这一封信产一段可复制的「要模型产什么」。
     * 本件不替你发请求（源自己发），只把要求写清楚。
     * ★ 跨度取不出来的信一样能产（文本里会写「取不出来，不要猜」）——
     *   源在这种情况下会当成今天封的，产出的要求文本也就跟着错档。
     */
    buildRequest(index) {
        const c = this.capsuleAt(index);
        if (!c) return { ok: false, reason: 'out_of_range', saw: index };
        const text = composeRequest(c);
        this._draft = text;
        return {
            ok: true,
            text: text,
            span: spanOf(c),
            tone: toneOf(c),
            mood: moodOf(c),
            /* ★ 词库规模取数据层真源（guardVocab）—— 修前这里是手抄的 30 / 10：
             *   词库一改，这两处就与真库脱钩而**不报错**（本仓 J7 形态）。 */
            guardWords: guardVocab(),
            witnessMax: SOURCEBOOK_RECEIPT_WITNESS_MAX
        };
    }
    /**
     * acceptEcho(index, raw) —— 收一段模型回信（用户贴回来的）。
     * ★ 两条硬约束在这里真校验：不过关的回信一律不入台账，
     *   且**如实报出问题在哪一句**（源抛异常，调用方常常吞掉）。
     */
    acceptEcho(index, raw) {
        const c = this.capsuleAt(index);
        if (!c) return { ok: false, reason: 'out_of_range', saw: index };
        let parsed = raw;
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return { ok: false, reason: 'empty_input' };
            try { parsed = JSON.parse(trimmed); }
            catch (_e) { return { ok: false, reason: 'bad_json' }; }
        }
        if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not_object' };
        const guard = guardEcho(parsed);
        const r = normalizeEcho(parsed, c);
        if (!r.ok) {
            return {
                ok: false,
                reason: r.reason,
                guard: guard,
                guardLabels: GUARD_KEYS.map((k) => guardLabel(k))
            };
        }
        const ledgerOne = {
            at: toStr(parsed.at),
            capsuleId: toStr(c.id),
            spanBucket: toStr(r.span.bucket),
            spanDays: r.span.days,
            tone: toStr(r.tone.type),
            created: toStr(r.span.created),
            guardOk: guard.ok === true,
            guardReasons: GUARD_KEYS.filter((k) => numOrSelf((guard.reasons || {})[k], 0) > 0),
            fellBack: r.fellBack,
            source: toStr(parsed.source) || 'pasted'
        };
        this.receipts.push(ledgerOne);
        while (this.receipts.length > LEDGER_KEEP) this.receipts.shift();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return {
            ok: true,
            segments: r.segments,
            provided: r.provided,
            fellBack: r.fellBack,
            span: r.span,
            tone: r.tone,
            mood: r.mood,
            witnessMax: SOURCEBOOK_RECEIPT_WITNESS_MAX,
            kind: r.kind,
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
    /** 台账最多留多少张：源对回执无上限（同一个 IndexedDB 键一直堆）；本仓给口并回落。
     *  ★ 回落的是**显式值取不出来**（0 / 负数 / 小数 / 非数），不是静默吞掉输入 ——
     *    结果里如实报 saw 与 took，用户能看出「我填的没被采纳」。 */
    setLedgerKeep(v) {
        const saw = v;
        this.ledgerKeep = keepOr(v);
        this._trimLedger();
        this._persistPolicy();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, saw: saw, took: this.ledgerKeep, max: SOURCEBOOK_MAX_RECEIPTS };
    }
    ledgerKeepOf() { return this.ledgerKeep; }
    /** 裁剪台账到保留数。

     *  ★ 循环上界**自己带下界**：上游归一（keepOr）一旦被绕过，负保留数会让

     *    「条数 > 负数」 恒真 ⇒ **无限循环**把界面挂死（本版负控制实测到了这条）。

     *    单靠上游归一就是单点防线。 */

    _trimLedger() {

        const lim = Math.max(1, numOrSelf(this.ledgerKeep, LEDGER_KEEP));

        while (this.receipts.length > lim) this.receipts.shift();

    }
    draftOf() { return this._draft; }

    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'shelf');
        const ok = ['shelf', 'span', 'tone', 'ledger', 'policy'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'shelf';
        return this._tab;
    }
    openCapsule(index) {
        const i = numOrNull(index);
        if (i === null || !Number.isInteger(i) || i < 0 || i >= this.capsules.length) {
            return { ok: false, reason: 'out_of_range' };
        }
        this._current = String(i);
        this._tab = 'shelf';
        if (this._view) this._view.refresh();
        return { ok: true, row: this.shelfRows()[i] };
    }
    closeCapsule() {
        this._current = '';
        this._tab = 'shelf';
        if (this._view) this._view.refresh();
        return this._tab;
    }
    currentKey() { return this._current; }

    /* ---------- 生命周期 ---------- */
    /** 换会话：封存的信、策略、台账全是「这段关系的账」，故全部重取。
     *  （源把所有胶囊写在宿主键下，切角色**原样留着** —— 串味。） */
    onChatChanged() {
        this._current = '';
        this._draft = '';
        this._tab = 'shelf';
        this._loadCapsules();
        this._loadPolicy();
        this._loadLedger();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new SourcebookView(this, this.shell, this.storage);
        this._view.render();
    }
}
