/* ============================================================
 * apps/memory/hud-bridge-parser.js — HUD 块 → 手机现场态（R21-X3）
 * ------------------------------------------------------------
 * [v4.151.0 · R21-X3] TavernOS HUD 机制缝入（第一条缝）。
 *
 * Ported from TavernOS HUD © 2026 alewwi — AGPL-3.0
 *   https://github.com/alewwi/HUD  (v23.89.33)
 *
 * 本文件是**机制移植**，不是代码照抄：上游是 SillyTavern 扩展，
 * 标识符以俄文写作、依赖 settings / i18n / DOM 与自身渲染栈；
 * 本仓是零依赖纯模块，故实现逐段重写，只保留判据可验证的机制。
 * 按 AGPL-3.0 要求保留本署名与来源地址。
 *
 * 【为什么缝它（本仓的真欠债，实测）】
 *   `apps/memory/lonsha-bridge.js` 自 v4.125.0 起就备好了整套现场态接口
 *   （applyScenePresenceState / getScenePresenceState / getSceneHudLine /
 *    checkPresenceInterception / scanNearFieldRadar / isPrivacyAntiPeekActive），
 *   而全仓 **零个产品侧提供方**：`applyScenePresenceState` 只在 tests/ 里被调，
 *   于是三处消费端长期走兜底 ——
 *     · 桌面「情境流 · Smart Widget」的 `📍当前现场 · 离线感知`；
 *     · 控制中心的「NFC 近场雷达 · 无同室目标」；
 *     · 同场防窥拦截永远判「不在场」。
 *   这是本仓点名过的形态：**建好了、没人喂**（引擎在、读数为恒假）。
 *   上游 HUD 恰好产这份数据：模型每楼附一个 HUD 块，块里 `sc` 段是
 *   「时间 / 日期 / 地点 / 天气 / 氛围 / 情绪 / 转折」，`cs` 段就是在场人物。
 *   两者形状同构，缝过来即闭环 —— 而且**不需要改写任何既有消费端**。
 *
 * 【落地的两条机制（第三条如实不落，见文末）】
 *   M1 末帧回喂（fold + last-frame）：
 *     · 旧 HUD 不进记忆正文 —— `stripHudBlocks`，由 memory-data.js 的 record
 *       在 `cleanFloorForSummary` **之前**调用（顺序不可换，理由见该调用点注释）；
 *     · 只把**最后一楼**的快照交给模型 —— `latestHudSnapshot` + `hudSnapshotPromptBlock`。
 *   M3 块解析与字段映射：容错解析 HUD 块 → 现场态（`deriveScenePresence`）。
 *
 * 【三条纪律（与 apps/place/place-data.js 同规格）】
 *   ① 不猜：字段缺失如实留空，绝不编地点、编人数、编时刻；
 *   ② 不抛：块缺失 / 块空 / JSON 坏 / YAML 坏，一律降级成**明确状态**，不 throw；
 *   ③ 不持副本：解析与投影都是纯函数，读数由调用方每次现取（本模块无实例态）。
 * ============================================================ */
import { numOrNull } from '../../config/num-gate.js';

/* ---------------- 块边界：四种写法 + 实体形态 + 未闭合 ----------------
 * 上游把它写成一条正则覆盖全扩展（此前被复制进七个文件、副本开始分叉）。
 * 这里同样只留一份，但重写了两条判据：
 *   ① 标签认四种书写：`[HUD]` / `<HUD>` / `&lt;HUD&gt;` / `&#91;HUD&#93;`
 *      （消息经宿主渲染后常以实体形态回到 `mes`）；
 *   ② **块内不许再出现开标签**。否则「模型在计划里写『最后附 [HUD] 块』」
 *      这类**提及**会被当成块起点，一路吞到真块 —— 结果是正文被剥掉半截，
 *      而剥掉的那半截里有真剧情。这条在上游是实测事故，故照机制缝。
 */
const OPEN_TAG = '(?:\\[|&lt;|<|&#91;)\\s*HUD\\s*(?:\\]|&gt;|>|&#93;)';
const CLOSE_TAG = '(?:\\[|&lt;|<|&#91;)\\s*(?:\\/|&#47;|\\\\)\\s*HUD\\s*(?:\\]|&gt;|>|&#93;)';
const NO_OPEN = '(?:(?!' + OPEN_TAG + ')[\\s\\S])';
/** 开标签之后必须是**数据**（代码围栏 / JSON 花括号 / 换行后的 key: 行）。
 *  裸散文不认：`[HUD] 这一轮发生了什么…` 是叙述，不是块。 */
const DATA_HEAD = '\\s*(?:<\\/?(?:p|br|pre|code|span|div)\\b[^>]*>\\s*)*(?:```|\\x60\\x60\\x60|\\{|&#123;|\\r?\\n\\s*[A-Za-z_]\\w*\\s*:)';
/* 开标签后紧跟闭标签（含中间只有空白）也算块 —— 上游把这种「写了标签没填数据」
 * 记为空块而不是没有块：两者对现场态的效果相同（都不覆盖），但诊断读数必须
 * 分开，否则「模型写了块但每次都是空的」会被误报成「模型根本没写块」。 */
const blockRe = (flags) => new RegExp(OPEN_TAG + '(?=' + DATA_HEAD + '|\\s*' + CLOSE_TAG + ')' + NO_OPEN + '*?(?:' + CLOSE_TAG + '|$)', flags);

/* ---------------- 推理标签掩码 ----------------
 * 模型写在 <plan>/<thinking> 里的东西对扩展**不存在**。上游为此把推理段整段
 * 掩成长度相同的不可见字符（不删、不压，故索引与原文逐字符对齐），
 * 于是「掩码面上的命中位置」可以直接拿去切原文。这里照同一机制缝。 */
const REASON_TAGS = ['plan', 'planning', 'thinking', 'think', 'thought', 'thoughts', 'reasoning', 'analysis', 'scratchpad', 'reflection'];
const MASK_CHAR = '\u2063';
const REASON_OPEN = '(?:<|&lt;)\\s*(' + REASON_TAGS.join('|') + ')(?=[\\s>&/])[^<>]*?(?:>|&gt;)';

function maskReasoning(text) {
    const src = String(text ?? '');
    if (!/plan|think|thought|reason|analysis|scratchpad|reflection/i.test(src)) return src;
    const openRe = new RegExp(REASON_OPEN, 'gi');
    const spans = [];
    let pos = 0;
    let m;
    while ((m = openRe.exec(src)) !== null) {
        if (m.index < pos) continue;
        const name = m[1];
        const closeRe = new RegExp('(?:<|&lt;)\\s*\\/\\s*' + name + '\\s*(?:>|&gt;)', 'i');
        const afterOpen = m.index + m[0].length;
        const tail = src.slice(afterOpen);
        const close = tail.match(closeRe);
        let end;
        if (close) {
            end = afterOpen + close.index + close[0].length;
        } else {
            /* 未闭合（模型还在写或忘了闭合）：掩到「第一个真块的开标签」为止，
             * 否则整个正文都会被当成推理而消失。 */
            const dataRe = new RegExp(OPEN_TAG + '(?=' + DATA_HEAD + ')', 'i');
            const d = tail.match(dataRe);
            end = d ? afterOpen + d.index : src.length;
        }
        spans.push([m.index, end]);
        pos = end;
        openRe.lastIndex = Math.max(end, m.index + 1);
    }
    if (!spans.length) return src;
    let out = '';
    let from = 0;
    for (const [a, b] of spans) {
        out += src.slice(from, a) + MASK_CHAR.repeat(Math.max(0, b - a));
        from = b;
    }
    return out + src.slice(from);
}

/* ---------------- ① M1 落地：HUD 原文不进正文 ---------------- */
/**
 * 剥掉所有真 HUD 块，保留正文。
 *
 * 为什么不靠 `cleanFloorForSummary` 那条通用方括号正则：它是**碰巧覆盖**
 * （`[ABC]…[/ABC]` 大类横扫），HUD 块里一旦有 JSON 数组（`"guns":[…]`），
 * 通用规则会从第一个 `]` 处咬断，剩下的半截 JSON 反而被当成正文记进记忆。
 * 剥除必须按**块的语义**做，才能保证「进记忆的正文里不含 HUD 数据」。
 *
 * @param {string} text 原始楼层文本
 * @returns {string} 剥除后的正文
 */
export function stripHudBlocks(text) {
    const src = String(text ?? '');
    if (!/HUD/i.test(src)) return src;
    const masked = maskReasoning(src);
    const re = blockRe('gi');
    const spans = [];
    let m;
    while ((m = re.exec(masked)) !== null) {
        spans.push([m.index, m.index + m[0].length]);
        if (m[0].length === 0) re.lastIndex += 1;
    }
    if (!spans.length) return src;
    let out = '';
    let from = 0;
    for (const [a, b] of spans) {
        out += src.slice(from, a);
        from = b;
    }
    const kept = out + src.slice(from);
    return kept.replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- ② M3 落地：容错解析 ---------------- */
function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function innerOf(full) {
    const src = String(full ?? '');
    let s = src.replace(new RegExp('^' + OPEN_TAG, 'i'), '');
    s = s.replace(new RegExp('(?:' + CLOSE_TAG + ')$', 'i'), '');
    return s;
}

function stripFence(raw) {
    let s = String(raw ?? '').trim();
    s = s.replace(/^(?:```|~~~)[A-Za-z0-9_-]*\s*\r?\n/, '');
    s = s.replace(/\r?\n(?:```|~~~)\s*$/, '');
    s = s.replace(/^(?:```|~~~)/, '');
    s = s.replace(/(?:```|~~~)$/, '');
    return s.trim();
}

/** 符号级容错（口径沿用本仓 config/json-symbol-repair.js 的**四类**，不 import 它）：
 *  该模块的导出面是给「大模型 JSON」用的整体解析器，本模块只要符号替换这一步；
 *  引它会把整条导出面拖进来（而死导出门禁只认真消费）。
 *  纪律照旧：**严格优先** —— `tryParse` 先原地 JSON.parse，成功就绝不修。 */
function repairLite(text) {
    let s = String(text ?? '');
    s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
    s = s.replace(/^\s*\/\/.*$/gm, ' ');
    s = s.replace(/,\s*([}\]])/g, '$1');
    s = s.replace(/([{,]\s*)'([^'\u005c]*)'(\s*:)/g, '$1"$2"$3');
    s = s.replace(/:\s*'([^'\u005c]*)'(\s*[,}])/g, ': "$1"$2');
    return s;
}

/** 极简 YAML（只认两层：顶层 `key:` + 缩进 `sub: value`）。
 *  上游有完整 YAML 解析器；本仓只要「模型降级成 YAML 时还能读出 sc 段」，
 *  多写一层解析器是给自己造第二份实现。cs 数组形态在 YAML 路**读不出**——
 *  这不是缺陷，是降级边界：`deriveScenePresence` 于是不给在场名单（不猜）。 */
function parseYamlLite(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const root = {};
    let cur = null;
    let sawAny = false;
    for (const line of lines) {
        if (!line.trim() || /^\s*#/.test(line) || /^\s*(?:```|~~~)/.test(line)) continue;
        const top = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (top) {
            sawAny = true;
            const rest = top[2].trim();
            if (rest) { root[top[1]] = rest; cur = null; } else { root[top[1]] = {}; cur = root[top[1]]; }
            continue;
        }
        const sub = /^\s+(?:-\s*)?([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (sub && cur) {
            sawAny = true;
            const v = sub[2].trim().replace(/^["']|["']$/g, '');
            if (v) cur[sub[1]] = v;
        }
    }
    return sawAny ? root : null;
}

function tryParse(raw) {
    const body = stripFence(raw);
    if (!body) return { ok: false, reason: 'empty-body' };
    try {
        const v = JSON.parse(body);
        if (isPlainObject(v)) return { ok: true, format: 'json', value: v };
        return { ok: false, reason: 'not-object' };
    } catch (_e) { /* 落到符号修复 */ }
    try {
        const v = JSON.parse(repairLite(body));
        if (isPlainObject(v)) return { ok: true, format: 'json-repaired', value: v };
        return { ok: false, reason: 'not-object' };
    } catch (_e) { /* 落到 YAML */ }
    const yaml = parseYamlLite(body);
    if (yaml) return { ok: true, format: 'yaml', value: yaml };
    return { ok: false, reason: 'unparsable' };
}

/**
 * 解析楼层文本里的**最后一个** HUD 块（M1 的「末帧」口径）。
 *
 * 四态分开报，压成一种就再也答不出「为什么这块没生效」：
 *   · `absent`    没有块（绝大多数回复就是没有，不是失败）→ present:false
 *   · `empty`     块在，但是空的（模型写了空块）→ 与 absent 分开
 *   · `malformed` 块在、有内容，但 JSON 与 YAML 都读不出（带原文片段供人眼判）
 *   · `ok`        解析成功（带 format：json / json-repaired / yaml）
 *
 * @param {string} text
 * @returns {{present:boolean, state:'absent'|'empty'|'malformed'|'ok', snapshot:object|null, block:string, format?:string, reason?:string, sample?:string}}
 */
export function parseHudSnapshot(text) {
    const src = String(text ?? '');
    const masked = maskReasoning(src);
    const re = blockRe('gi');
    let last = null;
    let m;
    while ((m = re.exec(masked)) !== null) {
        last = { index: m.index, length: m[0].length };
        if (m[0].length === 0) re.lastIndex += 1;
    }
    if (!last) return { present: false, state: 'absent', snapshot: null, block: '' };
    const full = src.slice(last.index, last.index + last.length);
    const inner = innerOf(full);
    if (!inner.trim()) return { present: true, state: 'empty', snapshot: null, block: full };
    const parsed = tryParse(inner);
    if (!parsed.ok) {
        return { present: true, state: 'malformed', snapshot: null, block: full, reason: parsed.reason, sample: stripFence(inner).slice(0, 80) };
    }
    return { present: true, state: 'ok', snapshot: parsed.value, block: full, format: parsed.format };
}

/* ---------------- ③ 现场态映射：HUD 字段 → 桥的 applyScenePresenceState ---------------- */
const SCENE_KEYS = ['sc', 'scene', 'сцена', '场景'];
const CAST_KEYS = ['cs', 'characters', 'персонажи', '人物'];
const FIELD_LOCATION = ['L', 'location', 'Место', 'место', '地点'];
const FIELD_DATE = ['Dt', 'date', 'Дата', 'дата', '日期'];
const FIELD_TIME = ['T', 'time', 'Время', 'время', '时间'];
const FIELD_TWIST = ['Tw', 'twist', '转折'];
const FIELD_ATMOS = ['At', 'atmosphere', 'Атмосфера', 'атмосфера', '氛围'];
const FIELD_MOOD = ['Md', 'mood', 'Настроение', 'настроение', '心情'];

function firstObject(root, keys) {
    for (const k of keys) if (isPlainObject(root[k])) return root[k];
    return null;
}
function firstArray(root, keys) {
    for (const k of keys) if (Array.isArray(root[k])) return root[k];
    return null;
}
/** 空字段：上游约定模型把「没有」写成 `empty`（或干脆不写）。两者等价于「没给」。 */
function textField(obj, keys) {
    if (!isPlainObject(obj)) return '';
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string') {
            const t = v.trim();
            if (t && t.toLowerCase() !== 'empty') return t;
        }
    }
    return '';
}
function nameOf(entry) {
    if (typeof entry === 'string') {
        const t = entry.trim();
        return t && t.toLowerCase() !== 'empty' ? t : '';
    }
    return textField(entry, ['N', 'name', 'Имя', 'имя', '名字']);
}

/**
 * 把 HUD 快照投影成桥能直接吃下的现场态。
 *
 * 三态如实分开（这是本仓反复治的形态，不许合并）：
 *   · 完全没数据 → 返回 null（**不编**一个空现场去冒充「现场无人」）；
 *   · `cs` 缺席   → `inSceneCharacters: undefined`（「未知」）；
 *   · `cs` 在但空 → `inSceneCharacters: []`（「明确没人」）。
 * 后两者的区别在下游是真判据：桥的 getSceneHudLine 对 undefined 不给「· 现场无人」，
 * 而 checkPresenceInterception / isPrivacyAntiPeekActive 只认数组。
 *
 * @param {object} snapshot parseHudSnapshot().snapshot
 * @returns {null|{location:string, time:string, action:string, tension:string, inSceneCharacters:(string[]|undefined), source:string}}
 */
export function deriveScenePresence(snapshot) {
    if (!isPlainObject(snapshot)) return null;
    const scene = firstObject(snapshot, SCENE_KEYS);
    const castRaw = firstArray(snapshot, CAST_KEYS);
    const names = castRaw ? castRaw.map(nameOf).filter(Boolean) : undefined;
    const location = textField(scene, FIELD_LOCATION);
    const date = textField(scene, FIELD_DATE);
    const clock = textField(scene, FIELD_TIME);
    const time = [date, clock].filter(Boolean).join(' ');
    const action = textField(scene, FIELD_TWIST);
    const tension = textField(scene, FIELD_ATMOS);
    const mood = textField(scene, FIELD_MOOD);
    const known = names === undefined ? [] : names;
    if (!location && !time && !action && !tension && !mood && known.length === 0) return null;
    return { location, time, action, tension, mood, inSceneCharacters: names, source: 'hud-block' };
}

/* ---------------- ④ M1 的供给面：末帧快照 → 注入块 ---------------- */
function pickMessageText(row) {
    if (!row || typeof row !== 'object') return '';
    const swipeId = Number.isInteger(row.swipe_id) ? row.swipe_id : 0;
    if (Array.isArray(row.swipes) && row.swipes.length) {
        const bySwipe = String(row.swipes[swipeId] || '');
        if (bySwipe) return bySwipe;
        const first = String(row.swipes[0] || '');
        if (first) return first;
    }
    return typeof row.mes === 'string' ? row.mes : '';
}

/**
 * 从聊天历史里取**最后一楼**的 HUD 块（M1 的 last-frame 口径）。
 *
 * 为什么现取而不是缓存：本仓的现场态随会话变，任何实例级缓存在换会话 / 删楼
 * 回滚后必成陈旧数据（`onChatChanged` 只丢归因、不持副本，见 place-data 同规）。
 * 扫描上限默认 40 楼：HUD 按「每楼一块」写，真的没有就是没有，扫到底等于给
 * 一个长会话做全量正则 —— 那是性能换不到信息的交易。
 *
 * @param {Array} chat 宿主 context.chat
 * @param {{maxScan?:number}} [options]
 * @returns {{state:string, snapshot:object|null, floor:number|null, format?:string, reason?:string}}
 */
export function latestHudSnapshot(chat, options = {}) {
    if (!Array.isArray(chat) || chat.length === 0) return { state: 'no-chat', snapshot: null, floor: null };
    const maxScan = numOrNull(options.maxScan);
    const limit = maxScan === null ? 40 : Math.max(1, maxScan);
    let scanned = 0;
    for (let i = chat.length - 1; i >= 0 && scanned < limit; i -= 1, scanned += 1) {
        const row = chat[i];
        if (!row || row.is_user === true) continue;
        const text = pickMessageText(row);
        if (!text) continue;
        const res = parseHudSnapshot(text);
        if (res.state === 'absent') continue;
        return { state: res.state, snapshot: res.snapshot, floor: i, format: res.format, reason: res.reason };
    }
    return { state: 'absent', snapshot: null, floor: null };
}

/** 拼一行快照文案。字段为空就不写该段 —— 空段比「未知」更吵，且会诱导模型补编。 */
function snapshotLine(snapshot, castLimit) {
    const sc = firstObject(snapshot, SCENE_KEYS);
    const castRaw = firstArray(snapshot, CAST_KEYS);
    const parts = [];
    const loc = textField(sc, FIELD_LOCATION);
    if (loc) parts.push('现场: ' + loc);
    const time = [textField(sc, FIELD_DATE), textField(sc, FIELD_TIME)].filter(Boolean).join(' ');
    if (time) parts.push('时间: ' + time);
    const tension = textField(sc, FIELD_ATMOS);
    if (tension) parts.push('氛围: ' + tension);
    const mood = textField(sc, FIELD_MOOD);
    if (mood) parts.push('心情: ' + mood);
    const twist = textField(sc, FIELD_TWIST);
    if (twist) parts.push('转折: ' + twist);
    if (castRaw) {
        const names = castRaw.map(nameOf).filter(Boolean);
        const shown = castLimit === null ? names : names.slice(0, castLimit);
        if (shown.length) parts.push('在场: ' + shown.join('、'));
    }
    return parts.join(' | ');
}

/**
 * 生成前交给模型的「上一轮 HUD 快照」块（M1 回喂）。
 *
 * 机制要点（照上游）：模型拿到的是**短码行**而不是完整 JSON —— 完整快照等于
 * 每轮把整个世界重述一遍，既贵又诱导模型照抄旧值；短码行的作用是
 * 「你在这一格上往前推一步」，而不是「重新造一次世界」。
 *
 * 预算三态（本仓没有 tokenizer，故量纲如实标**字符**，不冒充 token）：
 *   · `full`    完整行（在场名单最多 8 人）≤ 预算
 *   · `compact` 只留现场与时间、在场最多 3 人（仍是同一份读数，只是更省）
 *   · `none`    连 compact 都超预算 ⇒ 返回空串，**不注入**（宁缺勿假）
 *
 * @param {object|null} snapshot
 * @param {{budgetChars?:number}} [options]
 * @returns {{text:string, mode:'full'|'compact'|'none', costChars:number, budgetChars:number}}
 */
export function hudSnapshotPromptBlock(snapshot, options = {}) {
    const given = numOrNull(options.budgetChars);
    const budgetChars = given === null ? 700 : Math.max(80, given);
    const emptyResult = { text: '', mode: 'none', costChars: 0, budgetChars };
    if (!isPlainObject(snapshot)) return emptyResult;
    const fullLine = snapshotLine(snapshot, 8);
    if (!fullLine) return emptyResult;
    const head = '【手机侧 HUD 快照 · 上一楼】';
    const tail = '只在这一格上往前推一步，不要重建世界；与正文冲突时以正文为准。';
    const fullText = head + fullLine + '\n' + tail;
    if (fullText.length <= budgetChars) {
        return { text: fullText, mode: 'full', costChars: fullText.length, budgetChars };
    }
    const compactLine = snapshotLine({ ...snapshot, [CAST_KEYS[0]]: undefined, [CAST_KEYS[1]]: undefined }, 0);
    if (!compactLine) return emptyResult;
    const compactText = head + compactLine + '（同场名单过长，已略）';
    if (compactText.length <= budgetChars) {
        return { text: compactText, mode: 'compact', costChars: compactText.length, budgetChars };
    }
    return emptyResult;
}

/* ============================================================
 * 未落地面（如实登记，不硬缝）
 * ------------------------------------------------------------
 * 上游的第三条机制是**差分计量**：把 prompt 重 build 一遍但不含某一节，
 * 两次长度相减得到该节的真实开销，用来显示「这一块值多少 token」。
 *
 * 本仓**没有**这条机制的落点，理由是可验证的三条：
 *   ① 本仓没有统一的 prompt builder —— 记忆块、场所块、玩法块、HUD 快照
 *      各写各的 `payload.prompt.push(...)`，没有一个函数能「重 build 一遍」；
 *   ② 宿主接口 `ctx.setExtensionPrompt(key, ...)` **只写不读**，
 *      写完拿不回来自检，两次相减的第二项取不到；
 *   ③ 本仓没有 tokenizer，用字符数冒充 token 会把「估算」写成「读数」——
 *      那正是本仓最贵的假绿形态（上游能这么做是因为它自带分词表）。
 *
 * 故本版**不做**这条，也不留一个「占位实现」假装它存在。若将来本仓立起
 * 统一 prompt builder（读得回、可重跑），这条机制才有地方落。
 * ============================================================ */
