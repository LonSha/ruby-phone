/* ========================================================
 * recall-app.js — [v3.38.0] 记忆宫殿 · 召回治理台
 *
 * 数据层：recall-data.js（纯函数内核）  视图层：recall-view.js
 *
 * ── 三层分工（与第 2 / 第 3 层各件同规格）──────────────
 *   ① 取数（probe）：每次 render / refresh 都重取，不持跨轮副本
 *      （换会话 / 外部改动后陈旧副本会静默生效）；
 *   ② 纯函数（数据层）：路状态 / 水位线 / 融合 / 重排 / 裁决 / 回执 ——
 *      都不碰存储、不碰网络，于是无头环境就能判；
 *   ③ 落盘（PhoneStorage）：三条会话键，全走 /^recall_/ 前缀。
 *
 * ── 三条会话键 ──────────────────────────────────────────
 *   · recall_settings —— 四路配置（configured / enabled / modelChanged /
 *                        degraded / lastError 五个原始位）；
 *   · recall_policy  —— 策略（当前房间、注入开关、门槛、topN、水位线）；
 *   · recall_ledger  —— 台账（每次召回的回执 + 候选快照）。
 *
 * ── 不缝的那一块（源的核心能力，本件不接）──────────────
 *   源自己有 47 处 apiKey / 56 处 fetch，自己拼请求算向量。
 *   本件**零网络调用**：只治理**已到手的候选** —— 候选由本仓 apps/memory
 *   的 BM25 与 LonSha 桥供给。缝进来就是把第二个模型出口塞进本仓。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是空的」（_readRaw 分两种回报）；
 *   · 失败批次 **不许**推进水位线（推进了 = 那批记忆永久丢失）；
 *   · 空候选池的路 **不许**静默消失（per 里如实标 skipped）；
 *   · 空召回 **不许**报成「注入成功」（decideInject 分四种跳过因）；
 *   · 换会话后旧路的配置与回执 **不许**留着（onChatChanged 全量重取）。
 * ======================================================== */
import {
    RECALL_CHANNELS, RECALL_CHANNEL_META, RECALL_STATES, RECALL_STATE_KEYS,
    RECALL_BM25_MODES, RECALL_ROOM_WEIGHTS, RECALL_ROOM_FALLBACK,
    RECALL_SKIP_REASONS, RECALL_SKIP_KEYS, RECALL_FACES,
    RECALL_MAX_CANDIDATES, RECALL_DEFAULT_TOP_N, RECALL_MIN_SCORE,
    channelState, stateLabel, stateSeverity, bm25Mode, roomWeights,
    scoreCandidate, advanceWatermark, fuseChannels, rerankCandidates,
    decideInject, skipReasonLabel, recallReceipt, receiptFace, recallReadings
} from './recall-data.js';
import { RecallView } from './recall-view.js';
import { numOrNull } from '../../config/num-gate.js';
/** 覆盖值取值口（topN / floor 共用）：显式传入的**真数字**才认，取不出来就回落实例值。
 *  ★ 不走 `?? ` 兜底：本仓口径里「传了 null」与「没传」都回落（套件钉住这行为），
 *    而 `??` 会让 null 直接返回 null；也不写 `Number.isFinite(Number(v))`
 *    （那是弱口径签名，`Number(null)` 是 0，会把「没给」说成「给了 0」）。 */
function numOrSelf(v, self) {
    const n = numOrNull(v);
    return n === null ? self : n;
}

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 /^recall_/，
   否则跨会话串味。源把状态挂在角色卡与全局对象上（切角色原样留着）。 */
const SETTINGS_KEY = 'recall_settings';
const POLICY_KEY = 'recall_policy';
const LEDGER_KEY = 'recall_ledger';
/** 取数面读数（视图不自己拼统计）。★ 键面取数据层真源 RECALL_FACES，
 *  不在本文件另写一份（本仓 J7 形态：两份靠碰巧拼写一致对齐）。 */
const FACE = RECALL_FACES;

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

/** 只收非空字符串数组，去重（回执 id 列 / 快照都走这里）。 */
function toStrArr(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) {
        if (typeof x === 'string' && x && out.indexOf(x) < 0) out.push(x);
        if (out.length >= RECALL_MAX_CANDIDATES) break;
    }
    return out;
}

export class RecallApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        /* 四路原始位（值全是布尔 / 字符串，不放派生结论） */
        this.states = {};
        /* 策略 */
        this.room = RECALL_ROOM_FALLBACK;
        this.injectEnabled = true;
        this.floor = RECALL_MIN_SCORE;
        this.topN = RECALL_DEFAULT_TOP_N;
        this.bm25Raw = '';
        this.watermark = null;
        /* 台账 */
        this.snapshots = {};
        this.receipts = [];
        this.face = FACE.storage_absent;
        this._readings = recallReadings({}, []);
        this._proj = null;
        this._current = '';
        this._tab = 'channels';
        this._view = null;
        this._loadSettings();
        this._loadPolicy();
        /* ★ 构造末尾就取一次数：否则通道表 / 读数在 render() 之前是空的 ——
         *  任何先读后画的路径都会把「还没取数」看成「四路都没配」
         *  （四路全 absent），而真因只是**还没读**。 */
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
     * 源把状态写在角色卡与全局对象上，从没区分过这两种情形。
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
    _loadSettings() {
        const raw = this._readJSON(SETTINGS_KEY);
        const r = (raw && typeof raw === 'object') ? raw : {};
        const next = {};
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) {
            const ch = RECALL_CHANNELS[i];
            const one = r[ch];
            const o = (one && typeof one === 'object') ? one : {};
            next[ch] = {
                configured: o.configured === true,
                enabled: o.enabled !== false,
                modelChanged: o.modelChanged === true,
                degraded: o.degraded === true,
                lastError: toStr(o.lastError)
            };
        }
        this.states = next;
        this.bm25Raw = toStr(r.bm25Raw);
    }
    _loadPolicy() {
        const raw = this._readJSON(POLICY_KEY);
        const r = (raw && typeof raw === 'object') ? raw : {};
        const rw = roomWeights(r.room);
        this.room = rw.room;
        this.injectEnabled = r.injectEnabled !== false;
        const f = Number(r.floor);
        this.floor = (Number.isFinite(f) && f >= 0) ? f : RECALL_MIN_SCORE;
        const t = Number(r.topN);
        this.topN = (Number.isInteger(t) && t > 0 && t <= RECALL_MAX_CANDIDATES) ? t : RECALL_DEFAULT_TOP_N;
        const wm = Number(r.watermark);
        this.watermark = (Number.isFinite(wm) && wm >= 0) ? wm : null;
    }
    _loadLedger() {
        const raw = this._readJSON(LEDGER_KEY);
        const r = (raw && typeof raw === 'object') ? raw : {};
        const snap = (r.snapshots && typeof r.snapshots === 'object') ? r.snapshots : {};
        const next = {};
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) {
            const ch = RECALL_CHANNELS[i];
            next[ch] = toStrArr(snap[ch]);
        }
        this.snapshots = next;
        const rs = Array.isArray(r.receipts) ? r.receipts : [];
        const kept = [];
        for (let i = 0; i < rs.length && kept.length < RECALL_MAX_CANDIDATES; i += 1) {
            const one = rs[i];
            if (!one || typeof one !== 'object') continue;
            kept.push({
                at: toStr(one.at),
                entry: toStr(one.entry),
                hits: Number(one.hits) || 0,
                contributed: numOrNull(one.contributed),
                skipped: numOrNull(one.skipped),
                inject: one.inject === true,
                reason: toStr(one.reason),
                degraded: toStrArr(one.degraded),
                failed: toStrArr(one.failed),
                ms: numOrNull(one.ms),
                timedOut: one.timedOut === true
            });
        }
        this.receipts = kept;
    }
    _persistSettings() { this._writeJSON(SETTINGS_KEY, { ...this.states, bm25Raw: this.bm25Raw }); }
    _persistPolicy() {
        this._writeJSON(POLICY_KEY, {
            room: this.room,
            injectEnabled: this.injectEnabled,
            floor: this.floor,
            topN: this.topN,
            watermark: this.watermark
        });
    }
    _persistLedger() { this._writeJSON(LEDGER_KEY, { snapshots: this.snapshots, receipts: this.receipts }); }

    /* ---------- 缺省态（storage 取不出来时用；此时投影为 null） ---------- */
    _clearToDefaults() {
        const st = {};
        const snap = {};
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) {
            const ch = RECALL_CHANNELS[i];
            st[ch] = {
                configured: false,
                enabled: true,
                modelChanged: false,
                degraded: false,
                lastError: ''
            };
            snap[ch] = [];
        }
        this.states = st;
        this.snapshots = snap;
        this.receipts = [];
        this.bm25Raw = '';
        this.room = RECALL_ROOM_FALLBACK;
        this.injectEnabled = true;
        this.floor = RECALL_MIN_SCORE;
        this.topN = RECALL_DEFAULT_TOP_N;
        this.watermark = null;
    }
    _configuredTotal() {
        let n = 0;
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) {
            const o = this.states[RECALL_CHANNELS[i]];
            if (o && o.configured === true) n += 1;
        }
        return n;
    }
    _snapshotTotal() {
        let n = 0;
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) {
            const a = this.snapshots[RECALL_CHANNELS[i]];
            if (Array.isArray(a)) n += a.length;
        }
        return n;
    }
    /* ---------- 取数（每次 render / 换会话 / 外部改动后都重取） ---------- */
    /**
     * probe() —— 真取一次数，回投影（视图只吃投影，不自己拆内部结构）。
     * ★ 三条键里任何一条「取不出来」（storage 没给 / 一取就抛）都算
     *   storage_absent，且此时投影为 **null** —— 视图拿不到投影就只能画
     *   「取不出来」，绝不会把「读不到」画成「四路都没配」。
     */
    probe() {
        const rs = this._readRaw(SETTINGS_KEY);
        const rp = this._readRaw(POLICY_KEY);
        const rl = this._readRaw(LEDGER_KEY);
        const storageOk = !!(rs.ok && rp.ok && rl.ok);
        if (storageOk) {
            this._loadSettings();
            this._loadPolicy();
            this._loadLedger();
        } else {
            this._clearToDefaults();
        }
        this._readings = recallReadings(this.states, this.receipts);
        const hasAny = !!(this._readings.usableChannels > 0
            || this._readings.receipts > 0
            || this.bm25Raw
            || this.watermark !== null
            || this._configuredTotal() > 0
            || this._snapshotTotal() > 0);
        this.face = storageOk ? (hasAny ? FACE.ok : FACE.empty) : FACE.storage_absent;
        this._proj = storageOk ? this._project() : null;
        return this._proj;
    }
    /** 投影：视图只吃这一份。 */
    _project() {
        return {
            face: this.face,
            readings: this._readings,
            channels: this.channelRows(),
            policy: this.policyRow(),
            receipts: this.receiptRows()
        };
    }
    /* ---------- 读数面 ---------- */
    /** 四路各自一行（含六态与人话）—— 视图不自己 resolve。 */
    channelRows() {
        const meta = RECALL_CHANNEL_META;
        return RECALL_CHANNELS.map((ch) => {
            const o = this.states[ch] || {};
            const st = channelState(o);
            const m = meta[ch] || {};
            return {
                channel: ch,
                label: toStr(m.label),
                why: toStr(m.why),
                state: st,
                stateLabel: stateLabel(st),
                severity: stateSeverity(st),
                configured: o.configured === true,
                enabled: o.enabled !== false,
                modelChanged: o.modelChanged === true,
                degraded: o.degraded === true,
                lastError: toStr(o.lastError),
                candidates: (Array.isArray(this.snapshots[ch]) ? this.snapshots[ch].length : 0)
            };
        });
    }
    /** 策略行（含房间认没认出来、BM25 认没认出来 —— 都如实报）。 */
    policyRow() {
        const rw = roomWeights(this.room);
        const bm = bm25Mode(this.bm25Raw);
        return {
            room: rw.room,
            roomKnown: rw.known,
            roomSaw: toStr(rw.sawRoom),
            weights: rw.weights,
            injectEnabled: this.injectEnabled === true,
            floor: this.floor,
            topN: this.topN,
            watermark: (this.watermark === null ? null : this.watermark),
            bm25: bm.mode,
            bm25Recognized: bm.recognized,
            bm25Saw: toStr(bm.sawRaw)
        };
    }
    /** 回执行（每条带面：ok / empty / storage_absent 三态分开画）。 */
    receiptRows() {
        return this.receipts.map((r) => ({
            at: r.at,
            entry: r.entry,
            hits: r.hits,
            contributed: r.contributed,
            skipped: r.skipped,
            inject: r.inject === true,
            reason: r.reason,
            reasonLabel: skipReasonLabel(r.reason),
            degraded: r.degraded,
            failed: r.failed,
            ms: r.ms,
            timedOut: r.timedOut === true,
            face: receiptFace(r)
        }));
    }
    readings() { return this._readings; }
    faceOf() { return this.face; }
    summaryLine() {
        const r = this._readings;
        const bits = ['四路可用 ' + r.usableChannels + ' / ' + r.totalChannels];
        if (r.counts.stale) bits.push('陈旧 ' + r.counts.stale);
        if (r.counts.degraded) bits.push('降级 ' + r.counts.degraded);
        if (r.counts.failed) bits.push('上轮失败 ' + r.counts.failed);
        if (r.counts.absent) bits.push('没配 ' + r.counts.absent);
        if (r.counts.off) bits.push('已关 ' + r.counts.off);
        bits.push('回执 ' + r.receipts + ' 条（注入 ' + r.injected + ' / 跳过 ' + r.skipped + '）');
        return bits.join(' · ');
    }
    /** 真源表读数（视图的键面来自这几张，不许手写）。 */
    catalogs() {
        return {
            channels: RECALL_CHANNELS,
            channelMeta: RECALL_CHANNEL_META,
            states: RECALL_STATES,
            stateKeys: RECALL_STATE_KEYS,
            bm25Modes: RECALL_BM25_MODES,
            bm25Fallback: RECALL_BM25_FALLBACK,
            rooms: RECALL_ROOM_WEIGHTS,
            roomFallback: RECALL_ROOM_FALLBACK,
            skipReasons: RECALL_SKIP_REASONS,
            skipKeys: RECALL_SKIP_KEYS,
            faces: RECALL_FACES,
            limits: {
                maxChannels: RECALL_MAX_CHANNELS,
                maxCandidates: RECALL_MAX_CANDIDATES,
                rrfK: RECALL_RRF_K,
                defaultTopN: RECALL_DEFAULT_TOP_N,
                minScore: RECALL_MIN_SCORE
            },
            tabs: ['channels', 'fusion', 'ledger', 'policy']
        };
    }
    /** 键面人话（视图不手写键面）。 */
    stateLabelOf(k) { return stateLabel(k); }
    severityOf(k) { return stateSeverity(k); }
    skipLabelOf(k) { return skipReasonLabel(k); }
    channelLabelOf(k) {
        const m = RECALL_CHANNEL_META[k];
        return m ? m.label : '';
    }

    /* ---------- 四路配置（每一改都落盘，且**不许静默接受坏值**） ---------- */
    _knockChannel(ch) {
        const name = toStr(ch);
        return (RECALL_CHANNELS.indexOf(name) >= 0)
            ? { ok: true, channel: name }
            : { ok: false, reason: 'unknown_channel' };
    }
    /**
     * configure(ch, patch) —— 只改给到的位（没给的不动）。
     * ★ 这一路原本没配（absent）时，第一次改会自动置 configured=true ——
     *   否则用户「开了开关」但 configured 仍是 false，路状态仍报「没配」，
     *   开关看上去按了没反应（源就是把配置压在角色卡里，看不出这层）。
     */
    configure(ch, patch) {
        const k = this._knockChannel(ch);
        if (!k.ok) return k;
        const name = k.channel;
        const cur = this.states[name] || {};
        const p = (patch && typeof patch === 'object') ? patch : {};
        const next = {
            configured: cur.configured === true,
            enabled: cur.enabled !== false,
            modelChanged: cur.modelChanged === true,
            degraded: cur.degraded === true,
            lastError: toStr(cur.lastError)
        };
        let touched = false;
        if (Object.prototype.hasOwnProperty.call(p, 'enabled')) {
            next.enabled = p.enabled === true;
            touched = true;
        }
        if (Object.prototype.hasOwnProperty.call(p, 'modelChanged')) {
            next.modelChanged = p.modelChanged === true;
            touched = true;
        }
        if (Object.prototype.hasOwnProperty.call(p, 'degraded')) {
            next.degraded = p.degraded === true;
            touched = true;
        }
        if (Object.prototype.hasOwnProperty.call(p, 'lastError')) {
            next.lastError = toStr(p.lastError);
            touched = true;
        }
        if (Object.prototype.hasOwnProperty.call(p, 'configured')) {
            next.configured = p.configured === true;
            touched = true;
        }
        if (!touched) return { ok: false, reason: 'empty_patch' };
        if (next.configured !== true) next.configured = true;
        this.states[name] = next;
        this._persistSettings();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, channel: name, state: channelState(next) };
    }
    /** 取消这一路的配置（回到「没配」，不是「已关」）。 */
    unconfigure(ch) {
        const k = this._knockChannel(ch);
        if (!k.ok) return k;
        const name = k.channel;
        this.states[name] = {
            configured: false,
            enabled: true,
            modelChanged: false,
            degraded: false,
            lastError: ''
        };
        if (Array.isArray(this.snapshots[name])) this.snapshots[name] = [];
        this._persistSettings();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, channel: name, state: 'absent' };
    }
    /* ---------- 策略 ---------- */
    /** 设房间：认不出的一律拒绝并回报（不许静默当 living_room）。 */
    setRoom(room) {
        const rw = roomWeights(room);
        if (!rw.known) return { ok: false, reason: 'unknown_room', sawRoom: toStr(rw.sawRoom) };
        this.room = rw.room;
        this._persistPolicy();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, room: rw.room, weights: rw.weights };
    }
    setInjectEnabled(flag) {
        this.injectEnabled = flag === true;
        this._persistPolicy();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, injectEnabled: this.injectEnabled };
    }
    setFloor(v) {
        const f = Number(v);
        if (!Number.isFinite(f) || f < 0 || f > 1) return { ok: false, reason: 'bad_floor', saw: v };
        this.floor = f;
        this._persistPolicy();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, floor: f };
    }
    setTopN(v) {
        const t = Number(v);
        if (!Number.isInteger(t) || t <= 0 || t > RECALL_MAX_CANDIDATES) {
            return { ok: false, reason: 'bad_topn', saw: v, max: RECALL_MAX_CANDIDATES };
        }
        this.topN = t;
        this._persistPolicy();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, topN: t };
    }
    /** 手填 BM25 档位：认不出的照落 naive，但**必须回报没认出来**。 */
    setBm25(raw) {
        const bm = bm25Mode(raw);
        this.bm25Raw = toStr(raw);
        this._persistSettings();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: bm.recognized, mode: bm.mode, recognized: bm.recognized, sawRaw: toStr(bm.sawRaw) };
    }
    /** 水位线推进：失败批次一律不推进（推进了那批记忆就永久丢了）。 */
    advanceLine(batch) {
        const r = advanceWatermark(this.watermark, batch);
        if (r.advanced === true) {
            this.watermark = r.value;
            this._persistPolicy();
            this.probe();
            if (this._view) this._view.refresh();
        }
        return r;
    }
    watermarkOf() { return this.watermark; }
    roomOf() { return this.room; }
    floorOf() { return this.floor; }
    topNOf() { return this.topN; }
    injectEnabledOf() { return this.injectEnabled === true; }
    bm25RawOf() { return this.bm25Raw; }

    /* ---------- 候选快照（每路的候选池原文，供融合复现） ---------- */
    /**
     * setSnapshot(ch, ids) —— 记下这一路此刻的候选（去重、封顶）。
     * 不许把非数组静默当空数组写掉：非数组一律拒绝。
     */
    setSnapshot(ch, ids) {
        const k = this._knockChannel(ch);
        if (!k.ok) return k;
        if (!Array.isArray(ids)) return { ok: false, reason: 'not_array' };
        const name = k.channel;
        this.snapshots[name] = toStrArr(ids);
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true, channel: name, kept: this.snapshots[name].length, saw: ids.length };
    }
    snapshotOf(ch) {
        const k = this._knockChannel(ch);
        if (!k.ok) return [];
        const a = this.snapshots[k.channel];
        return Array.isArray(a) ? a.slice() : [];
    }
    clearSnapshots() {
        const next = {};
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) next[RECALL_CHANNELS[i]] = [];
        this.snapshots = next;
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true };
    }
    /** 融合：拿三条快照跑一次确定性 RRF，每路都报贡献。 */
    runFusion(opts) {
        const o = opts || {};
        const lists = {};
        for (let i = 0; i < RECALL_CHANNELS.length; i += 1) {
            const ch = RECALL_CHANNELS[i];
            lists[ch] = Array.isArray(this.snapshots[ch]) ? this.snapshots[ch] : [];
        }
        const fused = fuseChannels(lists, { topN: numOrSelf(o.topN, this.topN) });
        this._lastFused = fused;
        return fused;
    }
    /** 重排：候选池为空就如实报「没跑」（源也是跳过，但源不回报）。 */
    runRerank(extra, opts) {
        const o = opts || {};
        const base = Array.isArray(o.base) ? o.base : (this.snapshotOf('rerank'));
        const r = rerankCandidates(base, extra, { topN: numOrSelf(o.topN, this.topN) });
        this._lastRerank = r;
        return r;
    }
    /**
     * decide(opts) —— 拿最近一次融合（或传入的）出注入裁决。
     * ★ 第 8 行那条底线的落点：真的没有（empty）与四路全坏（all_broken）
     *   必须分开 —— 前者用户不用管，后者用户得去修路径。
     */
    decide(fused, opts) {
        const o = opts || {};
        const f = fused || this._lastFused || null;
        const verdict = decideInject(f, {
            floor: numOrSelf(o.floor, this.floor),
            userOff: (typeof o.userOff === 'boolean' ? o.userOff : (this.injectEnabled !== true))
        });
        this._lastVerdict = verdict;
        return verdict;
    }
    verdictOf() { return this._lastVerdict || null; }
    fusedOf() { return this._lastFused || null; }
    /* ---------- 回执（每次召回留一张；台账只留最近 MAX 张） ---------- */
    /**
     * recordReceipt(input) —— 实打实往台账里存一张回执。
     * 回执内容全由数据层 recallReceipt 生成，App 层不自己拼字段 ——
     * 否则视图、测试、导出三处会各自拼一份，早晚拼岔。
     */
    recordReceipt(input) {
        const i = (input && typeof input === 'object') ? input : {};
        const states = (i.states && typeof i.states === 'object') ? i.states : this.states;
        const fused = (i.fused && typeof i.fused === 'object') ? i.fused : (this._lastFused || {});
        const card = recallReceipt({
            at: toStr(i.at),
            entry: toStr(i.entry),
            fused: fused,
            verdict: (i.verdict && typeof i.verdict === 'object') ? i.verdict : (this._lastVerdict || undefined),
            states: states,
            opts: (i.opts && typeof i.opts === 'object') ? i.opts : {},
            ms: i.ms,
            timedOut: i.timedOut === true
        });
        this.receipts.push(card);
        while (this.receipts.length > RECALL_MAX_CANDIDATES) this.receipts.shift();
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return card;
    }
    clearReceipts() {
        this.receipts = [];
        this._persistLedger();
        this.probe();
        if (this._view) this._view.refresh();
        return { ok: true };
    }
    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'channels');
        const ok = ['channels', 'fusion', 'ledger', 'policy'];
        this._tab = ok.indexOf(k) >= 0 ? k : 'channels';
        return this._tab;
    }
    openReceipt(i) {
        const idx = Number(i);
        if (!Number.isInteger(idx) || idx < 0 || idx >= this.receipts.length) {
            return { ok: false, reason: 'out_of_range' };
        }
        this._current = String(idx);
        this._tab = 'ledger';
        if (this._view) this._view.refresh();
        return { ok: true, receipt: this.receiptRows()[idx] };
    }
    closeReceipt() {
        this._current = '';
        this._tab = 'channels';
        if (this._view) this._view.refresh();
        return this._tab;
    }
    currentKey() { return this._current; }
    /* ---------- 生命周期 ---------- */
    /** 换会话：四路配置、策略、台账全是「这段关系的账」，故全部重取。
     *  （源没有这一步：它的配置挂在角色卡与全局对象上，切角色**原样留着** —— 串味。） */
    onChatChanged() {
        this._current = '';
        this._tab = 'channels';
        this._lastFused = null;
        this._lastRerank = null;
        this._lastVerdict = null;
        this._loadSettings();
        this._loadPolicy();
        this._loadLedger();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new RecallView(this, this.shell, this.storage);
        this._view.render();
    }
}
