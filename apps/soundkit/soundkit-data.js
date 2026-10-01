/* ========================================================
 * soundkit-data.js — [v3.37.0] 白盒音效盒 · 纯函数内核
 *
 * 缝合自 SullyOS 的 WhiteboxSoundEditor（assets/WhiteboxSoundEditor-*.js
 * 37105 字节）+ ttsRouter / voicePlayback / SARSpeechSwitch 三件套。
 *
 * ── 源是什么 ────────────────────────────────────────────
 *   ① **六条内置音效是合成配方**（不是音频文件）：
 *      每条是 { label, notes:[{freq,at,dur,type,gain},…] } —— 由若干
 *      oscillator 音符（频率 / 起始偏移 / 时长 / 波形 / 增益）组成，
 *      播放走 AudioContext 现合成。**这正是「白盒」二字的来历**：
 *      音效是可读、可改、可分享的**数据**，而不是一个二进制 mp3。
 *   ② **播放器**（源 k_(sound, volume)）：createGain 做主音量 + 每个音符
 *      一个 createOscillator + 一个 createGain，linearRampToValueAtTime
 *      8ms 淡入、exponentialRampToValueAtTime 到 1e-4 淡出。
 *   ③ **分享码**：SULLYSND1: + btoa(unescape(encodeURIComponent(JSON)))
 *      —— 只带 { src, volume } 两个字段，**不带界面样式**。
 *   ④ **CSS 内嵌绑定**：一行 @sully-sound 注释挂在白框 CSS 顶上，
 *      读回走正则（源 Ec(css)）。
 *   ⑤ **语音三件套**：ttsRouter（三家 TTS 商路由 + 粤语模型前置校验）、
 *      voicePlayback（NotAllowedError 人话化 + 静音 wav priming 绕过
 *      自动播放限制）、SARSpeechSwitch（原台词 ↔ 污染台词二态开关）。
 *
 * ── 本件取哪几块 ────────────────────────────────────────
 *   取 ①②③⑤（合成配方 / 播放器 / 分享码 / 三件套的**机制**）；
 *   ④ 只取**编解码**（parseSoundComment / writeSoundComment），
 *   因为本仓的 CSS 落点是 phone.css 打包面，不接用户白框 CSS。
 *
 * ── 四块不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① **不自己调 TTS 商**：源 ttsRouter 直连 fishaudio / elevenlabs /
 *      minimax 三家，自己拼请求、自己按语言选模型、粤语还做模型前置校验。
 *      本件**一个网络调用都没有** —— 合成只走**本机 WebAudio**，
 *      厂商路由整块不缝（本仓语音出口的唯一仲裁者是 apps/settings 的
 *      语音设置面，本件不与它争）。
 *   ② **不碰宿主对象**：源把提示音改 UI 之后又写回宿主，并把 CSS 绑定
 *      注释写进宿主白框。本件零宿主写入、零宿主读，落 PhoneStorage 的
 *      **三条会话键**。
 *   ③ **不读别的 App 的表**：源 voicePlayback 直接读全局音频元素、
 *      ttsRouter 读角色卡上的 voiceProfile 字段。本件自带配方表与
 *      自定义槽，零跨 App 读 —— 兄弟 App 的池改了不该让本件静默变样。
 *   ④ **不收外链、不产二进制**：源允许 https 音频直链与 ≤200KB 音频上传
 *      （转 data URL）。本件**只收配方**：零 URL、零 base64 载荷、
 *      零文件上传 —— 所以「音效」在本件里永远是**可审计的数字**。
 *
 * ── 三条偏离（偏离不是遗漏，逐条写明）──
 *   ① **「没这一条」与「这一条是空的」不许塌成一态**：源在
 *      (!sound || !sound.src || sound.src === 'none') 时**静默 return**，
 *      于是「没绑」「绑了空」「绑了 none」「绑了一个不存在的 key」四种处境
 *      在用户那边**都是「点了没响」**。本件把取数收成 resolveSound()，
 *      返回 { kind: builtin|custom|silent|missing, notes, volume,
 *      missingKind }，**四态互不同形**。
 *   ② **配方是数据不是渲染副作用**：源把六条配方写死在打包产物里，
 *      用户只能从「内置音效」按钮里挑。本件把配方提成**可登记、可改、
 *      可导出**的数据，且频率与时长一律过校验门（sanitizeNotes），
 *      坏音符**如实计数**而不是静默丢弃。
 *   ③ **音量收成一次取值**：源在**每一处**调用点各写一遍
 *      （Math.min(1, Math.max(0, Number.isFinite(t) ? t : .6))），
 *      而 Number('') / Number(null) 都是 0 ⇒「没给」被读成「静音」。
 *      本件用 numOrNull 取值门 + 一次夹取，**「没给」与「给了 0」
 *      不许塌成同一个读数**（前者回落默认 0.6，后者如实是 0）。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 「没有这一条」/「这一条是空的」/「这一条被关掉了」**不许同形**；
 *   · 坏音符（负频率 / NaN 时长 / 未知波形）**不许静默丢掉** —— 要计数；
 *   · 分享码里带外链或 data URL **不许被当成合法配方**（本件根本不收）；
 *   · 「导入失败」与「导入成功但一条都没认出来」**不许同形**；
 *   · 自动播放被浏览器拦下 **不许报成「播完了」**。
 *
 * ── 实现纪律（本仓 v3.31/v3.35/v3.36 各踩过一次）──
 *   代码里**不许出现会骗过状态机的裸引号**：本仓判据共用的剥注释器是
 *   字符状态机、不解析正则字面量，正则里的裸引号会让它**永久卡住**
 *   （卡住之后文件尾注释全被当成代码 ⇒ 通道面判据假红）。
 *   故本件正则一律 new RegExp 构造、引号用 String.fromCharCode 拼装。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 真源表 ①：波形（视图的键面与校验白名单共用这一张） ---------- */
export const SOUNDKIT_WAVE_KINDS = Object.freeze([
    'sine', 'triangle', 'square', 'sawtooth'
]);

/* ---------- 真源表 ②：内置音效（**合成配方**，逐条与源一致） ---------- */
export const SOUNDKIT_BUILTIN = Object.freeze({
    chime: {
        label: '风铃',
        notes: [
            { freq: 1046.5, at: 0, dur: 0.5, type: 'sine', gain: 0.6 },
            { freq: 1568, at: 0.09, dur: 0.6, type: 'sine', gain: 0.45 }
        ]
    },
    ding: {
        label: '叮',
        notes: [
            { freq: 880, at: 0, dur: 0.45, type: 'sine', gain: 0.7 },
            { freq: 1760, at: 0, dur: 0.28, type: 'sine', gain: 0.18 }
        ]
    },
    pop: {
        label: '气泡',
        notes: [
            { freq: 420, at: 0, dur: 0.09, type: 'triangle', gain: 0.7 },
            { freq: 780, at: 0.05, dur: 0.12, type: 'sine', gain: 0.6 }
        ]
    },
    crystal: {
        label: '水晶',
        notes: [
            { freq: 1318.5, at: 0, dur: 0.32, type: 'sine', gain: 0.5 },
            { freq: 1760, at: 0.08, dur: 0.32, type: 'sine', gain: 0.4 },
            { freq: 2093, at: 0.16, dur: 0.4, type: 'sine', gain: 0.32 }
        ]
    },
    heart: {
        label: '心跳',
        notes: [
            { freq: 174, at: 0, dur: 0.18, type: 'sine', gain: 0.9 },
            { freq: 174, at: 0.24, dur: 0.22, type: 'sine', gain: 0.7 }
        ]
    },
    retro: {
        label: '像素',
        notes: [
            { freq: 660, at: 0, dur: 0.07, type: 'square', gain: 0.28 },
            { freq: 990, at: 0.08, dur: 0.1, type: 'square', gain: 0.28 }
        ]
    }
});

/** 内置 key 列表（视图的键面；**不许手写** —— 从真源算）。 */
export const SOUNDKIT_BUILTIN_KEYS = Object.freeze(Object.keys(SOUNDKIT_BUILTIN));

/* ---------- 真源表 ③：绑定去处（谁在用这条音效） ---------- */
export const SOUNDKIT_SLOTS = Object.freeze([
    { key: 'message', label: '新消息' },
    { key: 'send', label: '我发出' },
    { key: 'tap', label: '点击' },
    { key: 'notice', label: '系统通知' }
]);

/* ---------- 真源表 ④：音效四态（**不许塌成一态**） ---------- */
/** `severity` 是**数据层的语义**（这一态算「在用」还是「有情况」），不是配色：
 *  视图把 severity 映射成色相，但**不许自己手写第二份四态键面** ——
 *  数据层多一态时，手写的那份表静默落到兜底色，四态在用户眼里又塌回一种观感。 */
export const SOUNDKIT_STATES = Object.freeze([
    { key: 'builtin', label: '内置配方', severity: 'ok' },
    { key: 'custom', label: '自定义配方', severity: 'info' },
    { key: 'silent', label: '已静音', severity: 'mute' },
    { key: 'missing', label: '没绑这条', severity: 'warn' }
]);

/* ---------- 真源表 ⑥：取数面三态（App 与视图**共用这一份**，不许各写一遍） ---------- */
/** 「音效盒开着」/「还没有配方」/「存储不可用」三种处境**不许同形**。
 *  ★ 本表为什么必须存在（本版抓到的**第四处**同族真缺陷，由第九道门 J7 当场报红）：
 *    首版把这三个标识符在**两个文件里各写了一遍** —— App 里是 `const FACE = { ok: 'ok',
 *    empty: 'empty', storage_absent: 'storage_absent' }`，视图里是
 *    `const FACE_META = { ok: …, empty: …, storage_absent: … }`。
 *    两份靠**碰巧拼写一致**对齐：任何一边改名（哪怕只是把 `storage_absent` 改成
 *    `no_storage`），视图那份查不到 ⇒ **静默落兜底**，于是「还没有配方」与
 *    「存储不可用（读数拿不到）」在用户眼里**塌成同一句话** —— 而这恰恰是本件
 *    最要紧的一条口径。修法与 clock / ledger 同：**键面只有一份**，视图用计算键
 *    `[SOUNDKIT_FACES.ok]` 建表，形状由真源决定。 */
export const SOUNDKIT_FACES = Object.freeze({
    ok: 'ok',
    empty: 'empty',
    storage_absent: 'storage_absent'
});

/* ---------- 真源表 ⑤：坏音符原因（视图人话表的键面，**不许手写**） ---------- */
export const SOUNDKIT_DROP_REASONS = Object.freeze([
    { key: 'note_not_object', label: '不是音符对象' },
    { key: 'freq_out_of_range', label: '频率越界' },
    { key: 'dur_out_of_range', label: '时长越界' },
    { key: 'at_out_of_range', label: '起点越界' },
    { key: 'wave_unknown', label: '波形不认识' },
    { key: 'gain_missing', label: '增益读不到' },
    { key: 'over_max_notes', label: '超过条数上限' }
]);

/* ---------- 默认值与上限（唯一处） ---------- */
export const SOUNDKIT_DEFAULT_VOLUME = 0.6;
export const SOUNDKIT_MAX_NOTES = 24;
export const SOUNDKIT_MAX_RECIPES = 60;
export const SOUNDKIT_FREQ_MIN = 20;
export const SOUNDKIT_FREQ_MAX = 20000;
export const SOUNDKIT_DUR_MIN = 0.005;
export const SOUNDKIT_DUR_MAX = 5;
export const SOUNDKIT_AT_MAX = 5;
export const SOUNDKIT_SHARE_PREFIX = 'SOUNDKIT1:';

/* ---------- ⓪ UTF-8 base64（零依赖手写：浏览器无 Buffer） ---------- */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 字符串 → UTF-8 字节数组（不依赖 TextEncoder，便于无头判据逐字节对照）。 */
export function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
        let c = s.codePointAt(i);
        if (c > 0xffff) i += 1;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) {
            out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c < 0x10000) {
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        } else {
            out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
                0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    return out;
}

/** UTF-8 字节数组 → 字符串。 */
export function utf8Decode(bytes) {
    const b = Array.isArray(bytes) ? bytes : [];
    let out = '';
    for (let i = 0; i < b.length;) {
        const c = b[i];
        if (c < 0x80) { out += String.fromCharCode(c); i += 1; } else if (c < 0xe0) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (b[i + 1] & 0x3f)); i += 2;
        } else if (c < 0xf0) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f));
            i += 3;
        } else {
            const cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
            out += String.fromCodePoint(cp);
            i += 4;
        }
    }
    return out;
}

/** 字节数组 → base64 字符串。 */
export function bytesToBase64(bytes) {
    const b = Array.isArray(bytes) ? bytes : [];
    let out = '';
    for (let i = 0; i < b.length; i += 3) {
        const b0 = b[i];
        const b1 = i + 1 < b.length ? b[i + 1] : null;
        const b2 = i + 2 < b.length ? b[i + 2] : null;
        out += B64_CHARS[b0 >> 2];
        out += B64_CHARS[((b0 & 3) << 4) | (b1 === null ? 0 : b1 >> 4)];
        out += b1 === null ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 === null ? 0 : b2 >> 6)];
        out += b2 === null ? '=' : B64_CHARS[b2 & 63];
    }
    return out;
}

/** base64 字符串 → 字节数组（坏字符 ⇒ null，**不抛**）。 */
export function base64ToBytes(s) {
    const str = typeof s === 'string' ? s.replace(/[\s]/g, '') : '';
    if (!str.length || str.length % 4 !== 0) return null;
    const out = [];
    for (let i = 0; i < str.length; i += 4) {
        const c = [0, 1, 2, 3].map((k) => {
            const ch = str[i + k];
            if (ch === '=') return 0;
            const idx = B64_CHARS.indexOf(ch);
            return idx;
        });
        if (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[3] < 0) return null;
        out.push((c[0] << 2) | (c[1] >> 4));
        if (str[i + 2] !== '=') out.push(((c[1] & 15) << 4) | (c[2] >> 2));
        if (str[i + 3] !== '=') out.push(((c[2] & 3) << 6) | c[3]);
    }
    return out;
}

/* ---------- ① 音量取值门（「没给」≠「给了 0」） ---------- */
/**
 * 音量：没给 ⇒ 回落默认；给了 0 ⇒ **如实是 0**（静音是合法选择）。
 * 越界一律夹取到 [0, 1]（夹取是语义，不是取值）。
 */
export function normalizeVolume(v) {
    const n = numOrNull(v);
    if (n === null) return SOUNDKIT_DEFAULT_VOLUME;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

/* ---------- ② 音符校验（坏音符如实计数，不静默丢） ---------- */
/**
 * 校验一条音符数组。产出 { notes, dropped, reasons, totalMs }：
 *   · notes 是**能播的**那部分（已按 at 升序、已截到上限）；
 *   · dropped 是坏音符条数；reasons 是逐条原因计数。
 * 坏音符（任一即坏）：频率不在 [20, 20000] / 时长不在 [0.005, 5] /
 * 起始偏移为负或 > 5 / 波形不在白名单 / 增益取不到数。
 * ★ 这一条是源的**真缺陷**：源拿 o.freq 就 createOscillator，坏值一律
 *   **抛在播放期**（而播放期抛异常在宿主里常被吞掉 ⇒ 用户只看到
 *   「点了没响」）。
 */
export function sanitizeNotes(list) {
    const out = [];
    const reasons = {};
    let dropped = 0;
    /* ★ 原因计数必须**带条数**：一次超限砍掉 5 条，就该记 5 次（否则
     *   「逐因相加 = dropped」这条不变量在超限这一条上破掉 —— 读数面上
     *   「有 5 个音符放不了」与「原因表里只写着 1 个」自相矛盾）。 */
    const bump = (why, n) => { reasons[why] = (reasons[why] || 0) + (n == null ? 1 : n); };
    const arr = Array.isArray(list) ? list : [];
    for (const raw of arr) {
        const n = raw && typeof raw === 'object' ? raw : null;
        if (!n) { dropped += 1; bump('note_not_object'); continue; }
        const freq = numOrNull(n.freq);
        const dur = numOrNull(n.dur);
        const at = numOrNull(n.at);
        const gain = numOrNull(n.gain);
        const type = typeof n.type === 'string' ? n.type : 'sine';
        if (freq === null || freq < SOUNDKIT_FREQ_MIN || freq > SOUNDKIT_FREQ_MAX) {
            dropped += 1; bump('freq_out_of_range'); continue;
        }
        if (dur === null || dur < SOUNDKIT_DUR_MIN || dur > SOUNDKIT_DUR_MAX) {
            dropped += 1; bump('dur_out_of_range'); continue;
        }
        if (at === null || at < 0 || at > SOUNDKIT_AT_MAX) {
            dropped += 1; bump('at_out_of_range'); continue;
        }
        if (SOUNDKIT_WAVE_KINDS.indexOf(type) < 0) {
            dropped += 1; bump('wave_unknown'); continue;
        }
        if (gain === null) { dropped += 1; bump('gain_missing'); continue; }
        out.push({
            freq,
            at,
            dur,
            type,
            gain: gain < 0 ? 0 : (gain > 1 ? 1 : gain)
        });
    }
    out.sort((a, b) => a.at - b.at);
    const capped = out.length > SOUNDKIT_MAX_NOTES ? out.slice(0, SOUNDKIT_MAX_NOTES) : out;
    if (capped.length < out.length) {
        const cut = out.length - capped.length;
        dropped += cut;
        bump('over_max_notes', cut);
    }
    return {
        notes: capped,
        dropped,
        reasons,
        /* ★ 逐因相加必须等于 dropped（读数面自洽的不变量，判据面会核）。 */
        reasonsTotal: Object.keys(reasons).reduce((m, k) => m + reasons[k], 0),
        totalMs: capped.reduce((m, n) => Math.max(m, (n.at + n.dur) * 1000), 0)
    };
}

/** 坏音符原因人话（视图不手写键面 —— 由真源表算）。 */
export function dropReasonLabel(key) {
    const hit = SOUNDKIT_DROP_REASONS.find((r) => r.key === key);
    return hit ? hit.label : key;
}

/* ---------- ③ 配方登记（自定义槽） ---------- */
/**
 * 登记一条自定义配方。产出 { ok, recipes, reason }：
 *   · label 空 ⇒ 如实拒绝（reason:'label_empty'）；
 *   · 一个能播的音符都没有 ⇒ 如实拒绝（reason:'no_playable_note'）；
 *   · 超过条数上限 ⇒ 如实拒绝（reason:'over_max_recipes'），
 *     **不静默顶掉旧的**；
 *   · 同名 ⇒ 覆盖（这是「改」的入口），但回报 replaced:true。
 */
export function registerRecipe(recipes, input) {
    const list = Array.isArray(recipes) ? recipes.slice() : [];
    const label = input && typeof input.label === 'string' ? input.label.trim() : '';
    if (!label) return { ok: false, recipes: list, reason: 'label_empty' };
    const s = sanitizeNotes(input && input.notes);
    if (!s.notes.length) return { ok: false, recipes: list, reason: 'no_playable_note', dropped: s.dropped };
    const key = typeof input.key === 'string' && input.key.trim() ? input.key.trim() : label;
    const entry = {
        key,
        label,
        notes: s.notes,
        volume: normalizeVolume(input && input.volume)
    };
    const idx = list.findIndex((r) => r && r.key === key);
    let replaced = false;
    if (idx >= 0) {
        list[idx] = entry;
        replaced = true;
    } else {
        if (list.length >= SOUNDKIT_MAX_RECIPES) {
            return { ok: false, recipes: list, reason: 'over_max_recipes', dropped: s.dropped };
        }
        list.push(entry);
    }
    return { ok: true, recipes: list, recipe: entry, replaced, dropped: s.dropped, reasons: s.reasons };
}

/** 删一条自定义配方。found:false 与「删掉了」**不许同形**。 */
export function removeRecipe(recipes, key) {
    const list = Array.isArray(recipes) ? recipes.slice() : [];
    const k = String(key == null ? '' : key);
    const i = list.findIndex((r) => r && r.key === k);
    if (i < 0) return { ok: false, recipes: list, found: false };
    list.splice(i, 1);
    return { ok: true, recipes: list, found: true };
}

/* ---------- ④ 四态取数（本件的核心偏离之一） ---------- */
/**
 * 解析某个槽位当前绑的是哪条音效。
 * 产出 { kind, notes, volume, label, missingKind }，四态互不同形：
 *   · builtin：绑了内置 key，且该 key 真在真源表里；
 *   · custom：绑了自定义配方（recipes 里找得到）；
 *   · silent：**显式静音**（binding.mode === 'silent'）；
 *   · missing：没绑 / 绑的 key 不存在（missingKind 区分 unbound 与
 *     unknown_key —— 这两种处境在源里同形）。
 */
export function resolveSound(binding, recipes) {
    const b = binding && typeof binding === 'object' ? binding : null;
    const custom = Array.isArray(recipes) ? recipes : [];
    if (!b || b.mode == null || b.mode === 'none') {
        return { kind: 'missing', missingKind: 'unbound', notes: [], volume: SOUNDKIT_DEFAULT_VOLUME, label: '' };
    }
    if (b.mode === 'silent') {
        return { kind: 'silent', missingKind: null, notes: [], volume: 0, label: '静音' };
    }
    if (b.mode === 'builtin') {
        const hit = SOUNDKIT_BUILTIN[b.key];
        if (!hit) {
            return { kind: 'missing', missingKind: 'unknown_key', notes: [], volume: SOUNDKIT_DEFAULT_VOLUME, label: '' };
        }
        const s = sanitizeNotes(hit.notes);
        return {
            kind: 'builtin',
            missingKind: null,
            notes: s.notes,
            volume: normalizeVolume(b.volume),
            label: hit.label,
            key: b.key,
            dropped: s.dropped
        };
    }
    if (b.mode === 'custom') {
        const hit = custom.find((r) => r && r.key === b.key);
        if (!hit) {
            return { kind: 'missing', missingKind: 'unknown_key', notes: [], volume: SOUNDKIT_DEFAULT_VOLUME, label: '' };
        }
        const s = sanitizeNotes(hit.notes);
        return {
            kind: 'custom',
            missingKind: null,
            notes: s.notes,
            volume: b.volume == null ? normalizeVolume(hit.volume) : normalizeVolume(b.volume),
            label: hit.label,
            key: b.key,
            dropped: s.dropped
        };
    }
    return { kind: 'missing', missingKind: 'unknown_key', notes: [], volume: SOUNDKIT_DEFAULT_VOLUME, label: '' };
}

/** 四态人话（视图不手写键面 —— 由真源表算）。 */
export function stateLabel(kind) {
    const hit = SOUNDKIT_STATES.find((s) => s.key === kind);
    return hit ? hit.label : '未知';
}

/* ---------- ⑤ 分享码（只带配方，不带任何外链） ---------- */
/**
 * 导出分享码：SOUNDKIT1: + base64(UTF-8 JSON)。
 * ★ 与源的差别：源 SULLYSND1: 带的是 { src, volume } —— src 既可以是
 *   内置 key、也可以是 https 直链、还可以是 data URL。本件**只带配方**，
 *   且导出前先过 sanitizeNotes（坏音符根本不进分享码）。
 */
export function toShareCode(recipe) {
    const r = recipe && typeof recipe === 'object' ? recipe : {};
    const s = sanitizeNotes(r.notes);
    const payload = {
        v: 1,
        label: typeof r.label === 'string' ? r.label.slice(0, 40) : '',
        volume: normalizeVolume(r.volume),
        notes: s.notes
    };
    return SOUNDKIT_SHARE_PREFIX + bytesToBase64(utf8Bytes(JSON.stringify(payload)));
}

/**
 * 导入分享码。产出 { ok, recipe, reason, dropped }：
 *   · 前缀不对 / base64 坏 / JSON 坏 ⇒ reason:'bad_code'；
 *   · 结构不对（不是对象 / notes 不是数组）⇒ reason:'bad_shape'；
 *   · 一个能播的音符都没有 ⇒ reason:'no_playable_note'。
 * ★ 「导入失败」与「导入成功但一条都没认出来」**不同形**。
 */
export function fromShareCode(code) {
    const raw = typeof code === 'string' ? code.trim() : '';
    if (!raw.startsWith(SOUNDKIT_SHARE_PREFIX)) return { ok: false, reason: 'bad_code' };
    const bytes = base64ToBytes(raw.slice(SOUNDKIT_SHARE_PREFIX.length));
    if (!bytes) return { ok: false, reason: 'bad_code' };
    let obj = null;
    try {
        obj = JSON.parse(utf8Decode(bytes));
    } catch (e) {
        return { ok: false, reason: 'bad_code' };
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.notes)) {
        return { ok: false, reason: 'bad_shape' };
    }
    const s = sanitizeNotes(obj.notes);
    if (!s.notes.length) return { ok: false, reason: 'no_playable_note', dropped: s.dropped };
    return {
        ok: true,
        dropped: s.dropped,
        reasons: s.reasons,
        recipe: {
            label: typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim().slice(0, 40) : '导入音效',
            volume: normalizeVolume(obj.volume),
            notes: s.notes
        }
    };
}

/* ---------- ⑥ CSS 绑定注释（只取编解码，不接用户白框 CSS） ---------- */
const SOUND_COMMENT_RE = new RegExp(
    '/\\*\\s*@soundkit-sound\\b[^{}]*' + '(\\{[^{}]*\\})' + '\\s*\\*/', 'i'
);
const SOUND_COMMENT_STRIP_RE = new RegExp(
    '/\\*\\s*@soundkit-sound\\b[^{}]*\\{[^{}]*\\}\\s*\\*/\\n?', 'i'
);

/** 从一段 CSS 里读回绑定（没有 ⇒ null；有但坏 ⇒ null + 不抛）。 */
export function parseSoundComment(css) {
    if (typeof css !== 'string' || !css) return null;
    const m = css.match(SOUND_COMMENT_RE);
    if (!m) return null;
    let obj = null;
    try { obj = JSON.parse(m[1]); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const mode = typeof obj.mode === 'string' ? obj.mode : '';
    const key = typeof obj.key === 'string' ? obj.key.trim() : '';
    if (!mode) return null;
    return { mode, key, volume: normalizeVolume(obj.volume) };
}

/** 把绑定写进 CSS 顶部（先剥旧的，**不留两行**）。 */
export function writeSoundComment(css, binding) {
    const base = typeof css === 'string' ? css.replace(SOUND_COMMENT_STRIP_RE, '') : '';
    if (!binding || !binding.mode) return base;
    const payload = { mode: binding.mode, key: binding.key || '', volume: normalizeVolume(binding.volume) };
    const line = '/* @soundkit-sound ' + JSON.stringify(payload) + ' */';
    return base ? line + '\n' + base : line;
}

/* ---------- ⑦ 播放计划（纯函数：把配方算成「谁在什么时候响多久」） ---------- */
/**
 * 产出播放计划 { ok, steps, totalMs, reason }：
 *   · 静音 / 没绑 ⇒ ok:false + reason（**不许报成「播完了」**）；
 *   · 每条 step 带 startAt / stopAt / peak / wave（视图与播放器共用）；
 *   · totalMs 是**最后一条停下的时刻**（源从不报这个读数）。
 * ★ 这一层是纯函数，**不碰 AudioContext** —— 于是「配方对不对」在无头
 *   环境里就能判，不必真的出声。
 */
export function playbackPlan(sound) {
    const s = sound && typeof sound === 'object' ? sound : null;
    if (!s || s.kind === 'missing') {
        return { ok: false, reason: s ? 'missing_' + (s.missingKind || 'unbound') : 'no_sound', steps: [], totalMs: 0 };
    }
    if (s.kind === 'silent') return { ok: false, reason: 'silent', steps: [], totalMs: 0 };
    const notes = Array.isArray(s.notes) ? s.notes : [];
    if (!notes.length) return { ok: false, reason: 'no_playable_note', steps: [], totalMs: 0 };
    const vol = normalizeVolume(s.volume);
    if (vol === 0) return { ok: false, reason: 'volume_zero', steps: [], totalMs: 0 };
    const steps = notes.map((n) => ({
        startAt: n.at,
        stopAt: n.at + n.dur + 0.03,
        peak: Math.max(1e-4, n.gain * vol),
        wave: n.type,
        freq: n.freq
    }));
    const totalMs = steps.reduce((m, x) => Math.max(m, x.stopAt * 1000), 0);
    return { ok: true, reason: null, steps, totalMs };
}

/* ---------- ⑧ 台账读数（与配方数**分开报**） ---------- */
/**
 * 汇总读数。bindings 是槽位 → 绑定的表，recipes 是自定义配方表。
 * 产出含：四态各自条数 / 坏音符总数 / 静音槽数 / 未绑槽数 / 上限余量。
 * ★ 四态**分开计数**是本件相对源的主要改进：源没有任何一处能回答
 *   「现在到底有几个槽在用音效、几个是空的」。
 */
export function soundkitReadings(bindings, recipes) {
    const b = bindings && typeof bindings === 'object' ? bindings : {};
    const rs = Array.isArray(recipes) ? recipes : [];
    /* ★ 计数表的键面**从真源表算**（不许手写第二份 `{ builtin: 0, custom: 0, … }`）：
     *   本仓 J7 形态 —— 数据层多一个状态时，手写的那份表**静默少一个格**，
     *   读数面上永远看不到新状态，而没有任何东西会报错。 */
    const counts = {};
    for (const s of SOUNDKIT_STATES) counts[s.key] = 0;
    let dropped = 0;
    const unresolved = [];
    for (const slot of SOUNDKIT_SLOTS) {
        const r = resolveSound(b[slot.key], rs);
        /* 不写 `|| 0` 兜底：resolveSound 只可能返回四态之一，表外 kind 应当
         *   在读数面上**响亮地坏**（NaN），而不是被悄悄补成一格。 */
        counts[r.kind] += 1;
        dropped += r.dropped || 0;
        if (r.kind === 'missing') unresolved.push({ slot: slot.key, why: r.missingKind });
    }
    let recipeDropped = 0;
    for (const rec of rs) recipeDropped += sanitizeNotes(rec && rec.notes).dropped;
    return {
        slots: SOUNDKIT_SLOTS.length,
        counts,
        unresolved,
        unresolvedCount: unresolved.length,
        droppedNotes: dropped,
        recipeDropped,
        recipes: rs.length,
        recipeRoom: SOUNDKIT_MAX_RECIPES - rs.length,
        builtinCount: SOUNDKIT_BUILTIN_KEYS.length
    };
}

/* ---------- ⑨ 语音三件套的机制（只取读数面，不碰任何 TTS 商） ---------- */
/**
 * 自动播放受限的人话化（缝自源 voicePlayback）。
 * ★ 源把 NotAllowedError 与「加载失败」**分成两句不同的话**（这是对的，
 *   本件照缝），但源只在**播放器**里做；本件把它提成纯函数，
 *   于是「浏览器拦了」与「真的坏了」在**读数面上**就不同形。
 */
export function playbackErrorFace(err) {
    const name = err && typeof err.name === 'string' ? err.name : '';
    if (name === 'NotAllowedError') {
        return { kind: 'blocked', retryable: true, hint: '浏览器未允许播放，点一下继续；无需重新生成' };
    }
    if (name === 'NotSupportedError' || name === 'AbortError') {
        return { kind: 'unsupported', retryable: false, hint: '这条音效当前环境放不了' };
    }
    return { kind: 'failed', retryable: true, hint: '播放失败，可重试' };
}

/**
 * 「原台词 ↔ 污染台词」二态开关（缝自源 SARSpeechSwitch）。
 * ★ 源的开关只做一件事：切一个布尔并换文案。本件把**两种文本的取数**
 *   收成纯函数，且**两种都取不到时如实报**（不许默认落到某一边 ——
 *   源在污染文本缺失时会显示空）。
 */
export function speechFace(truth, surface) {
    const t = typeof truth === 'string' && truth.trim() ? truth : '';
    const s = typeof surface === 'string' && surface.trim() ? surface : '';
    return {
        hasTruth: !!t,
        hasSurface: !!s,
        mode: s ? 'surface' : (t ? 'truth' : 'none'),
        missingKind: t ? (s ? null : 'surface_only') : (s ? 'truth_only' : 'both_missing'),
        text: s || t
    };
}