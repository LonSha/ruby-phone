/* ========================================================
 * soundkit-app.js — [v3.37.0] 白盒音效盒 · 应用核心控制器
 *
 * 数据层：soundkit-data.js（纯函数内核）  视图层：soundkit-view.js
 *
 * ── 三层分工（与第 2 层各件同规格）──────────────────────
 *   ① 取数（probe）：每次 render / refresh 都**重取**，不持跨轮副本
 *      （换会话 / 外部改动后陈旧副本会静默生效）；
 *   ② 纯函数（数据层）：配方校验 / 四态取数 / 播放计划 / 分享码 —— 都不碰
 *      存储、不碰 AudioContext，于是无头环境就能判；
 *   ③ 落盘（PhoneStorage）：三条会话键，全走 `/^soundkit_/` 前缀。
 *
 * ── 三条会话键 ──────────────────────────────────────────
 *   · soundkit_settings —— 绑定表（四个槽位各绑了什么）+ 试听音量；
 *   · soundkit_recipes  —— 自定义配方（**音效本身就是数据**）；
 *   · soundkit_ledger   —— 台账（试听过哪些 / 导出过哪些，与配方数分开报）。
 *
 * ── 不缝的那一块（源的核心能力，本件不接）──────────────
 *   源 ttsRouter 直连 fishaudio / elevenlabs / minimax 三家 TTS 商。
 *   本件**零网络调用**：合成只走本机 WebAudio（`_ctx()` 惰性建 AudioContext），
 *   厂商路由整块不缝 —— 本仓语音出口的唯一仲裁者是 apps/settings 的语音设置面。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · storage 取数抛异常 **不许**读成「就是空的」（`_readRaw` 分两种回报）；
 *   · 静音 / 没绑 **不许**报成「播完了」（`play()` 回 `{ok:false,reason}`）；
 *   · 自动播放被浏览器拦下 **不许**报成「播完了」（`playbackErrorFace` 分流）；
 *   · 换会话后旧槽位的绑定 **不许**留着（`onChatChanged()` 全量重取）。
 * ======================================================== */
import {
    SOUNDKIT_WAVE_KINDS, SOUNDKIT_BUILTIN, SOUNDKIT_BUILTIN_KEYS, SOUNDKIT_SLOTS,
    SOUNDKIT_STATES, SOUNDKIT_DROP_REASONS, SOUNDKIT_DEFAULT_VOLUME, SOUNDKIT_FACES,
    SOUNDKIT_MAX_NOTES, SOUNDKIT_MAX_RECIPES, SOUNDKIT_FREQ_MIN, SOUNDKIT_FREQ_MAX,
    SOUNDKIT_DUR_MIN, SOUNDKIT_DUR_MAX, SOUNDKIT_AT_MAX, SOUNDKIT_SHARE_PREFIX,
    normalizeVolume, sanitizeNotes, dropReasonLabel, registerRecipe, removeRecipe,
    resolveSound, stateLabel, toShareCode, fromShareCode,
    parseSoundComment, writeSoundComment, playbackPlan, soundkitReadings,
    playbackErrorFace, speechFace
} from './soundkit-data.js';
import { SoundkitView } from './soundkit-view.js';

/* 三条会话键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^soundkit_/`，
   否则跨会话串味。源把提示音写回宿主对象（切角色时**原样留着**）。 */
const SETTINGS_KEY = 'soundkit_settings';
const RECIPES_KEY = 'soundkit_recipes';
const LEDGER_KEY = 'soundkit_ledger';

/** 取数面读数（视图不自己拼统计）。★ 键面取数据层真源 `SOUNDKIT_FACES`，
 *  不在本文件另写一份（本版第四处同族真缺陷：首版这里与视图各写了一遍）。 */
const FACE = SOUNDKIT_FACES;

function toStrArr(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) {
        if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
    }
    return out;
}

export class SoundkitApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.bindings = {};
        this.masterVolume = SOUNDKIT_DEFAULT_VOLUME;
        this.recipes = [];
        this.ledger = { previewedKeys: [], exportedKeys: [] };
        this.face = FACE.storage_absent;
        this._readings = soundkitReadings({}, []);
        this._proj = null;
        this._current = '';
        this._tab = 'slots';
        this._view = null;
        this._audioCtx = null;
        this._lastPlay = null;
        this._loadSettings();
        /* ★ 构造末尾就取一次数：否则 `recipes` / `slotRows()` 在 `render()` 之前是空的
         *   —— 任何先读后画的路径（换会话后马上取读数、宿主先问一句状态）都会把
         *   「还没取数」看成「一条配方都没有」，自定义绑定的槽位还会显示成
         *   `unknown_key`（「指向的配方不在了」），而真因只是**还没读**。 */
        this.probe();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /** 取数（吞异常版）：只给「没有就用默认」的场景用（设置键）。 */
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
     * 源把提示音写在宿主对象上，从没区分过这两种情形。
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
            if (!this.storage) return false;
            this.storage.set(key, JSON.stringify(v));
            return true;
        } catch (_e) { return false; }
    }
    _loadSettings() {
        const raw = this._readJSON(SETTINGS_KEY);
        const r = (raw && typeof raw === 'object') ? raw : {};
        const b = (r.bindings && typeof r.bindings === 'object') ? r.bindings : {};
        const next = {};
        for (const slot of SOUNDKIT_SLOTS) {
            const one = b[slot.key];
            if (one && typeof one === 'object' && typeof one.mode === 'string') {
                next[slot.key] = { mode: one.mode, key: String(one.key || ''), volume: normalizeVolume(one.volume) };
            }
        }
        this.bindings = next;
        this.masterVolume = normalizeVolume(r.masterVolume);
    }
    _persistSettings() {
        this._writeJSON(SETTINGS_KEY, { bindings: this.bindings, masterVolume: this.masterVolume });
    }
    _persistRecipes() { this._writeJSON(RECIPES_KEY, { recipes: this.recipes }); }
    _persistLedger() { this._writeJSON(LEDGER_KEY, this.ledger); }

    /* ---------- 取数 ---------- */
    /**
     * 现取（每次 render / refresh 都重取，不持跨轮副本 —— 防陈旧）。
     * ★ storage 取不出来时**不许**把配方读成空表（那样用户会以为自己的音效丢了）。
     */
    probe() {
        const rr = this._readRaw(RECIPES_KEY);
        const rl = this._readRaw(LEDGER_KEY);
        let storageOk = rr.ok && rl.ok;
        try {
            const rec = (rr.raw && typeof rr.raw === 'object') ? rr.raw : {};
            const list = Array.isArray(rec.recipes) ? rec.recipes : [];
            const kept = [];
            for (const one of list) {
                if (!one || typeof one !== 'object') continue;
                const label = typeof one.label === 'string' ? one.label.trim() : '';
                if (!label) continue;
                const s = sanitizeNotes(one.notes);
                if (!s.notes.length) continue;
                kept.push({
                    key: typeof one.key === 'string' && one.key.trim() ? one.key.trim() : label,
                    label,
                    notes: s.notes,
                    volume: normalizeVolume(one.volume)
                });
            }
            this.recipes = kept;
            const l = (rl.raw && typeof rl.raw === 'object') ? rl.raw : {};
            this.ledger = {
                previewedKeys: toStrArr(l.previewedKeys),
                exportedKeys: toStrArr(l.exportedKeys)
            };
            this._readings = soundkitReadings(this.bindings, this.recipes);
        } catch (_e) {
            storageOk = false;
            this.recipes = [];
            this.ledger = { previewedKeys: [], exportedKeys: [] };
            this._readings = soundkitReadings({}, []);
        }
        if (this._current && !this.recipeByKey(this._current)) this._current = '';
        const hasAny = !!(this.recipes.length
            || this.ledger.previewedKeys.length
            || this.ledger.exportedKeys.length
            || Object.keys(this.bindings).length);
        this.face = storageOk ? (hasAny ? FACE.ok : FACE.empty) : FACE.storage_absent;
        this._proj = storageOk ? this._project() : null;
        return this._proj;
    }

    /** 投影：视图只吃这一份（不自己拆内部结构）。 */
    _project() {
        return {
            face: this.face,
            readings: this._readings,
            slots: this.slotRows(),
            recipes: this.recipes.map((r) => ({
                key: r.key,
                label: r.label,
                notes: r.notes.length,
                volume: r.volume,
                ms: Math.round(sanitizeNotes(r.notes).totalMs)
            })),
            masterVolume: this.masterVolume
        };
    }

    /* ---------- 读数面 ---------- */
    /** 四个槽位各自的行（含四态与人话）—— 视图不自己 resolve。 */
    slotRows() {
        return SOUNDKIT_SLOTS.map((slot) => {
            const b = this.bindings[slot.key] || null;
            const s = resolveSound(b, this.recipes);
            return {
                slot: slot.key,
                slotLabel: slot.label,
                kind: s.kind,
                kindLabel: stateLabel(s.kind),
                label: s.label,
                key: s.key || '',
                volume: s.volume,
                notes: s.notes.length,
                missingKind: s.missingKind || '',
                dropped: s.dropped || 0
            };
        });
    }
    readings() { return this._readings; }
    faceOf() { return this.face; }
    summaryLine() {
        const r = this._readings;
        const bits = ['配方 ' + r.recipes + ' 条'];
        bits.push('在用 ' + (r.counts.builtin + r.counts.custom) + ' / 静音 ' + r.counts.silent
            + ' / 没绑 ' + r.counts.missing);
        if (r.droppedNotes) bits.push('坏音符 ' + r.droppedNotes + ' 个');
        if (r.unresolvedCount) bits.push(r.unresolvedCount + ' 个槽位指向了不存在的配方');
        return bits.join(' · ');
    }
    /** 真源表读数（视图的键面来自这几张，**不许手写**）。 */
    catalogs() {
        return {
            waves: SOUNDKIT_WAVE_KINDS,
            builtins: SOUNDKIT_BUILTIN_KEYS,
            slots: SOUNDKIT_SLOTS,
            states: SOUNDKIT_STATES,
            reasons: SOUNDKIT_DROP_REASONS,
            limits: {
                maxNotes: SOUNDKIT_MAX_NOTES,
                maxRecipes: SOUNDKIT_MAX_RECIPES,
                freqMin: SOUNDKIT_FREQ_MIN,
                freqMax: SOUNDKIT_FREQ_MAX,
                durMin: SOUNDKIT_DUR_MIN,
                durMax: SOUNDKIT_DUR_MAX,
                atMax: SOUNDKIT_AT_MAX,
                sharePrefix: SOUNDKIT_SHARE_PREFIX
            },
            builtinRecipes: SOUNDKIT_BUILTIN
        };
    }
    /** 坏音符原因人话（视图不手写键面）。 */
    dropReasonLabel(key) { return dropReasonLabel(key); }
    /** 语音二态开关的读数面（缝自源 SARSpeechSwitch；本件只取读数，不接语音）。 */
    speechFaceOf(truth, surface) { return speechFace(truth, surface); }

    /* ---------- 绑定 ---------- */
    /**
     * 给某个槽位绑一条音效。产出 { ok, reason }：
     *   · 槽位不认识 ⇒ reason:'unknown_slot'；
     *   · mode 不认识 ⇒ reason:'bad_mode'；
     *   · builtin/custom 但 key 找不到 ⇒ reason:'unknown_key'（**不许静默绑空**）。
     */
    bind(slotKey, mode, key, volume) {
        const slot = SOUNDKIT_SLOTS.find((s) => s.key === slotKey);
        if (!slot) return { ok: false, reason: 'unknown_slot' };
        const m = String(mode == null ? '' : mode);
        if (m === 'none') {
            delete this.bindings[slotKey];
            this._persistSettings();
            this.probe();
            return { ok: true, mode: 'none' };
        }
        if (m === 'silent') {
            this.bindings[slotKey] = { mode: 'silent', key: '', volume: 0 };
            this._persistSettings();
            this.probe();
            return { ok: true, mode: 'silent' };
        }
        if (m !== 'builtin' && m !== 'custom') return { ok: false, reason: 'bad_mode' };
        const k = String(key == null ? '' : key);
        if (m === 'builtin' && !SOUNDKIT_BUILTIN[k]) return { ok: false, reason: 'unknown_key' };
        if (m === 'custom' && !this.recipes.some((r) => r.key === k)) return { ok: false, reason: 'unknown_key' };
        this.bindings[slotKey] = { mode: m, key: k, volume: normalizeVolume(volume) };
        this._persistSettings();
        this.probe();
        return { ok: true, mode: m, key: k };
    }
    /** 改某个槽位的音量（**只改这一个槽**，不动全局试听音量）。 */
    setSlotVolume(slotKey, v) {
        const cur = this.bindings[slotKey];
        if (!cur) return { ok: false, reason: 'unbound' };
        cur.volume = normalizeVolume(v);
        this._persistSettings();
        this.probe();
        return { ok: true, volume: cur.volume };
    }
    /** 全局试听音量。 */
    setMasterVolume(v) {
        this.masterVolume = normalizeVolume(v);
        this._persistSettings();
        this.probe();
        return this.masterVolume;
    }
    masterVolumeOf() { return this.masterVolume; }

    /* ---------- 配方 ---------- */
    recipeByKey(key) {
        const k = String(key == null ? '' : key);
        const hit = this.recipes.find((r) => r.key === k);
        return hit || null;
    }
    /**
     * 登记 / 改一条自定义配方。真源是数据层的 registerRecipe，
     * 这里只负责落盘 + 台账（**不重复实现校验**）。
     */
    saveRecipe(input) {
        const r = registerRecipe(this.recipes, input);
        if (!r.ok) return { ok: false, reason: r.reason, dropped: r.dropped || 0 };
        this.recipes = r.recipes;
        this._persistRecipes();
        this.probe();
        return { ok: true, key: r.recipe.key, replaced: r.replaced, dropped: r.dropped || 0 };
    }
    deleteRecipe(key) {
        const r = removeRecipe(this.recipes, key);
        if (!r.ok) return { ok: false, found: false };
        this.recipes = r.recipes;
        this._persistRecipes();
        for (const slot of SOUNDKIT_SLOTS) {
            const b = this.bindings[slot.key];
            if (b && b.mode === 'custom' && b.key === String(key)) delete this.bindings[slot.key];
        }
        this._persistSettings();
        this.probe();
        return { ok: true, found: true };
    }
    /** 导出一条配方为分享码（**只带配方，不带任何外链**）。 */
    exportRecipe(key) {
        const rec = this.recipeByKey(key);
        if (!rec) return { ok: false, reason: 'not_found' };
        if (!this.ledger.exportedKeys.includes(rec.key)) {
            this.ledger.exportedKeys.push(rec.key);
            this._persistLedger();
        }
        return { ok: true, code: toShareCode(rec), label: rec.label };
    }
    /** 导入分享码并**直接登记**（导入失败与「一条都没认出来」不同形）。 */
    importRecipe(code) {
        const r = fromShareCode(code);
        if (!r.ok) return { ok: false, reason: r.reason, dropped: r.dropped || 0 };
        const saved = this.saveRecipe({ label: r.recipe.label, notes: r.recipe.notes, volume: r.recipe.volume });
        if (!saved.ok) return { ok: false, reason: saved.reason, dropped: r.dropped || 0 };
        return { ok: true, key: saved.key, dropped: r.dropped || 0, replaced: saved.replaced };
    }
    /** CSS 绑定注释：读回 / 写出（只取编解码，不接用户白框 CSS）。 */
    readCssBinding(css) { return parseSoundComment(css); }
    writeCssBinding(css, slotKey) {
        const b = this.bindings[slotKey];
        if (!b) return { ok: false, reason: 'unbound', css: writeSoundComment(css, null) };
        return { ok: true, css: writeSoundComment(css, b) };
    }

    /* ---------- 播放 ---------- */
    /**
     * 试听某个槽位。产出 { ok, reason, totalMs, steps }：
     *   · 静音 / 没绑 / 音量 0 ⇒ ok:false + reason（**不许报成「播完了」**）；
     *   · 无 AudioContext（无头环境）⇒ ok:false + reason:'no_audio_context'
     *     —— 计划照样返回，**读数不因环境缺失而消失**。
     * ★ 计划由数据层纯函数算（无头可判），这里只负责真的发声。
     */
    play(slotKey) {
        const b = this.bindings[slotKey];
        const sound = resolveSound(b, this.recipes);
        const plan = playbackPlan({ ...sound, volume: normalizeVolume(sound.volume * this.masterVolume) });
        this._lastPlay = { slot: slotKey, kind: sound.kind, ok: plan.ok, reason: plan.reason, totalMs: plan.totalMs };
        if (!plan.ok) return { ok: false, reason: plan.reason, totalMs: 0, steps: [] };
        const ctx = this._ctx();
        if (!ctx) return { ok: false, reason: 'no_audio_context', totalMs: plan.totalMs, steps: plan.steps };
        try {
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(() => {});
            const master = ctx.createGain();
            master.gain.value = 1;
            master.connect(ctx.destination);
            const t0 = ctx.currentTime + 0.01;
            for (const st of plan.steps) {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = st.wave;
                osc.frequency.value = st.freq;
                osc.connect(g);
                g.connect(master);
                const start = t0 + st.startAt;
                g.gain.setValueAtTime(1e-4, start);
                g.gain.linearRampToValueAtTime(st.peak, start + 0.008);
                g.gain.exponentialRampToValueAtTime(1e-4, start + (st.stopAt - st.startAt));
                osc.start(start);
                osc.stop(start + (st.stopAt - st.startAt) + 0.03);
            }
        } catch (e) {
            return { ok: false, reason: 'play_failed', face: playbackErrorFace(e), totalMs: plan.totalMs, steps: plan.steps };
        }
        if (!this.ledger.previewedKeys.includes(slotKey)) {
            this.ledger.previewedKeys.push(slotKey);
            this._persistLedger();
        }
        return { ok: true, reason: null, totalMs: plan.totalMs, steps: plan.steps };
    }
    /** 播放计划（**纯读数**，不出声 —— 无头环境也能判配方对不对）。 */
    planOf(slotKey) {
        const b = this.bindings[slotKey];
        const sound = resolveSound(b, this.recipes);
        return playbackPlan({ ...sound, volume: normalizeVolume(sound.volume * this.masterVolume) });
    }
    lastPlay() { return this._lastPlay; }
    /**
     * 草稿校验读数（视图编辑器**只读**，不自己实现校验 —— 真源是数据层）。
     * ★ 与 saveRecipe 的差别：这里**不落盘、不登记**，只是「这条草稿现在能不能播」。
     *   坏音符如实计数与分因（源把坏值拖到播放期才抛，用户只看到「点了没响」）。
     */
    checkNotes(notes) {
        const s = sanitizeNotes(notes);
        return {
            ok: s.notes.length > 0,
            notes: s.notes,
            dropped: s.dropped,
            reasons: s.reasons,
            totalMs: s.totalMs
        };
    }
    /** 草稿的播放计划（**纯读数**：不出声、不落盘、不占台账 —— 无头环境照样能画波形）。 */
    planOfDraft(notes, volume) {
        const s = sanitizeNotes(notes);
        return playbackPlan({
            kind: s.notes.length ? 'custom' : 'missing',
            missingKind: 'unbound',
            notes: s.notes,
            volume: normalizeVolume(volume)
        });
    }
    /** 惰性建 AudioContext（无 AudioContext 的环境 ⇒ null，**不抛**）。 */
    _ctx() {
        if (this._audioCtx) return this._audioCtx;
        try {
            const w = this._win();
            const C = w.AudioContext || w.webkitAudioContext;
            if (!C) return null;
            this._audioCtx = new C();
            return this._audioCtx;
        } catch (_e) { return null; }
    }

    /* ---------- 视图交互（视图只调这几个口，自己不拆数据） ---------- */
    tab() { return this._tab; }
    setTab(t) {
        const k = String(t || 'slots');
        this._tab = ['slots', 'editor', 'share', 'settings'].indexOf(k) >= 0 ? k : 'slots';
        return this._tab;
    }
    currentKey() { return this._current; }
    openRecipe(key) {
        const rec = this.recipeByKey(key);
        if (!rec) return { ok: false, reason: 'not_found' };
        this._current = rec.key;
        this._tab = 'editor';
        if (this._view) this._view.refresh();
        return { ok: true, recipe: rec };
    }
    closeRecipe() {
        this._current = '';
        this._tab = 'slots';
        if (this._view) this._view.refresh();
        return this._tab;
    }

    /* ---------- 生命周期 ---------- */
    /** 换会话：绑定、配方、台账全是「这段关系的账」，故全部重取。
     *  （源没有这一步：它的提示音写在宿主对象上，切角色时**原样留着** —— 串味。） */
    onChatChanged() {
        this._current = '';
        this._tab = 'slots';
        this._audioCtx = null;
        this._lastPlay = null;
        this._loadSettings();
        this.probe();
        if (this._view) this._view.refresh();
    }
    render() {
        this.probe();
        if (!this._view) this._view = new SoundkitView(this, this.shell, this.storage);
        this._view.render();
    }
}