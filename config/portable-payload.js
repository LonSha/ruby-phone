/* ========================================================
 *  RubyPhone · 便携负载的纯函数对（A6）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   全仓已有三处「导入 / 导出」各自演化：图片预设（NAI）、GPT 预设、ComfyUI 工作流。
 *   三处各自解析、各自去重、各自命名 —— 于是同一件事故在三处各犯一遍：
 *     · 导入不看「这是谁的文件」：随便一个 JSON 都能被吃进来，
 *       错文件的后果是**静默写脏**（不会崩，只会多出一堆不像样的条目）；
 *     · 追加只按名字去重：同一份文件导两次就多一份（id 每次都是新生成的，
 *       名字能被 `导入2` 这种改名规则绕开），而「导两次」恰恰是用户最常见的动作；
 *     · 去重失败时**覆盖**既有条目：用户手调过的参数被自己导回来的旧文件冲掉，
 *       且没有任何读数说明发生过这件事。
 *
 *   本模块只做纯函数那一半：怎么认魔标、怎么算指纹、怎么追加。
 *   IO 与 UI 留在 App 里 —— 这半边能与真宿主脱钩，才能被负控制直接破坏。
 *
 * 【三态互不同形（本仓反复点名的形态纪律）】
 *   `added`（真加进去了）/ `skipped`（被拦下来了，每条带 reason）/ `kept`（既有条目原样保留）
 *   三者必须分得开：把 `skipped` 并进 `added` 会答不出「为什么导了两次只多了一份」；
 *   把 `kept` 并进 `added` 会答不出「原来那些还在不在」。
 *
 * 【两条铁律（与 A1 世界书写入同一口径，方向不可互换）】
 *   ① **绝不覆盖**：本模块只做「保留既有 + 追加新的」。它没有改写既有条目的入口，
 *      也**不修改**既有条目对象 —— 调用方拿到的既有条目是**原来那些对象本身**，
 *      逐项与原数组同引用（`===`），故「覆盖」这件事在这里不可能发生。
 *   ② **按内容去重**：指纹取归一化后的**结构**（键排序、字符串 NFKC + 小写 + 空白折叠），
 *      不取名字。名字是用户可改的显示面，指纹是身份面，两者不能混用。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 魔标名单：**唯一真源**。导出侧写它、导入侧认它，两边不许各写一份字面量 ——
 *  字面量分叉的那一天，「自己导出的文件自己认不出来」会以最难查的形态出现。 */
export const PORTABLE_MARKS = Object.freeze({
    NAI_PRESETS: 'yuzuki-phone-nai-presets',
    GPT_PRESETS: 'yuzuki-phone-gpt-presets',
    COMFYUI_WORKFLOWS: 'yuzuki-phone-comfyui-workflows'
});

/** 解析五态。刻意**不合并** `unmarked` 与 `foreign`：
 *  前者是「旧版本导出的、还没有魔标的文件」（应当接受，属兼容面），
 *  后者是「有魔标、但不是这一类」（必须拒绝，属错文件面）。合并即等于把错文件当旧文件收下。 */
export const PARSE_STATES = Object.freeze({
    OK: 'ok',
    EMPTY: 'empty',
    NOT_JSON: 'not-json',
    UNMARKED: 'unmarked',
    FOREIGN: 'foreign'
});

/** 跳过原因（`skipped[].reason`）。三个原因处置方向不同，故不压成一格。 */
export const SKIP_REASONS = Object.freeze({
    DUPLICATE_EXISTING: 'duplicate-existing',
    DUPLICATE_INCOMING: 'duplicate-incoming',
    EMPTY: 'empty'
});

const DEFAULT_IGNORE_KEYS = Object.freeze(['id', 'updatedAt', 'exportedAt', 'app']);
const DEFAULT_LIST_KEYS = Object.freeze(['presets', 'items', 'workflows']);

function asKeys(value, fallback) {
    if (Array.isArray(value) && value.length) return value.map((v) => String(v));
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return fallback.slice();
}

/**
 * 读一个便携负载：空 / 非 JSON / 无魔标 / 异类魔标 / 通过 —— 五态各自成形。
 *
 * @param {string} rawText 原始文本（从文件读到的原样）
 * @param {{expect?:string|string[], allowUnmarked?:boolean, parse?:(t:string)=>any, listKeys?:string[]}} options
 *   `expect` 为期望魔标（可给多个）；`allowUnmarked` 默认 true（旧文件兼容），
 *   给 false 即「必须有魔标」；`parse` 可注入容错解析（本仓为 `parseJsonTolerant`）。
 * @returns {{state:string, accepted:boolean, mark:string, version:number|null, payload:any, candidates:Array}}
 */
export function readPortable(rawText, options = {}) {
    const text = String(rawText ?? '').trim();
    if (!text) {
        return { state: PARSE_STATES.EMPTY, accepted: false, mark: '', version: null, payload: null, candidates: [] };
    }
    let payload;
    try {
        payload = options.parse ? options.parse(text) : JSON.parse(text);
    } catch (_e) {
        payload = undefined;
    }
    if (payload === undefined || payload === null) {
        return { state: PARSE_STATES.NOT_JSON, accepted: false, mark: '', version: null, payload: null, candidates: [] };
    }
    const mark = String(payload?.type ?? payload?.magic ?? '').trim();
    const version = numOrNull(payload?.version);
    const expect = asKeys(options.expect, []);
    const allowUnmarked = options.allowUnmarked !== false;
    let state;
    let accepted;
    if (!mark) {
        state = PARSE_STATES.UNMARKED;
        accepted = allowUnmarked;
    } else if (expect.length && !expect.includes(mark)) {
        state = PARSE_STATES.FOREIGN;
        accepted = false;
    } else {
        state = PARSE_STATES.OK;
        accepted = true;
    }
    return {
        state: state,
        accepted: accepted,
        mark: mark,
        version: version,
        payload: payload,
        candidates: portableCandidates(payload, options)
    };
}

/** 从负载里取出「条目数组」。形状同时支持裸数组与三种包壳键；
 *  都不是时返回 `[]`（**不是**抛错：抛错会让调用方用一个 try 把「空文件」与「错文件」揉成一句失败）。
 *  `singleObject: true` 时，一个不带包壳键的**裸对象**也当一条（ComfyUI 工作流就是这样：
 *  用户直接粘一份 API Format JSON，它没有 `workflows` 外衣）。 */
export function portableCandidates(payload, options = {}) {
    if (Array.isArray(payload)) return payload.slice();
    if (!payload || typeof payload !== 'object') return [];
    for (const key of asKeys(options.listKeys, DEFAULT_LIST_KEYS)) {
        if (Array.isArray(payload[key])) return payload[key].slice();
    }
    return options.singleObject === true ? [payload] : [];
}

function normalizeScalar(value) {
    if (typeof value === 'string') {
        return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    }
    return value;
}

/** 这份（已归一化的）结构里有没有**真读数**。
 *  仅由空串 / null / 空数组 / 空对象构成的结构**不算一条内容** —— 否则
 *  `{name: ''}` 会被算成一条有身份的条目、被写进库里占一格。
 *  数与布尔一律算真读数（`0` 与 `false` 是合法配置值，不是「没给」）。 */
function hasMeaning(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasMeaning);
    if (typeof value === 'object') return Object.keys(value).some((k) => hasMeaning(value[k]));
    if (typeof value === 'string') return value.trim() !== '';
    return true;
}

/** 稳定序列化：键排序 + 标量归一 + 丢弃易变键（id / 时间戳 / 导出环境）。
 *  写成导出的，是为了让套件与负控制对**同一份指纹口径**做断言 ——
 *  若指纹在套件里另写一遍，两边一旦分叉就会「判据绿而现场重复」。 */
export function canonicalKeyOf(item, options = {}) {
    if (item === null || item === undefined) return '';
    const ignore = new Set(asKeys(options.ignoreKeys, DEFAULT_IGNORE_KEYS));
    const seen = new WeakSet();
    const walk = (value) => {
        if (value === null || typeof value !== 'object') return normalizeScalar(value);
        if (seen.has(value)) return '[circular]';
        seen.add(value);
        if (Array.isArray(value)) return value.map((v) => walk(v));
        const out = {};
        for (const key of Object.keys(value).sort()) {
            if (ignore.has(key)) continue;
            out[key] = walk(value[key]);
        }
        return out;
    };
    let text = '';
    let structure;
    try {
        structure = walk(item);
        text = JSON.stringify(structure);
    } catch (_e) {
        structure = undefined;
        text = '';
    }
    /* 「空」的判据不是 `text === '{}'` 那一串字面量比较，而是**结构里有没有真读数**：
     *  `{name: '   '}` 归一后是 `{"name":""}` —— 字面量比较会把它当成一条有身份的条目，
     *  于是空条目被写进库里占位、并且在下一次导入时挡住同名条目。 */
    if (!text || !hasMeaning(structure)) return '';
    return text;
}

/**
 * 按内容去重追加。**绝不覆盖**：既有条目只被保留，从不被改写。
 *
 * @param {Array} existing 既有条目
 * @param {Array} incoming 新条目
 * @param {{ignoreKeys?:string[]}} options
 * @returns {{list:Array, added:Array, skipped:Array, kept:Array, duplicateSkipped:number}}
 *   `added` 里的对象**就是** `incoming` 里那些对象本身（调用方要补 id / 改名时改的就是它，
 *   改完即为 `list` 尾部那几条）；`kept` 里的对象**就是** `existing` 里那些对象本身，
 *   逐项同引用，故「既有被覆盖」在本模块的产物上可直接用 `===` 证伪。
 */
export function appendByContent(existing, incoming, options = {}) {
    const base = Array.isArray(existing) ? existing : [];
    const next = base.slice();
    const existingKeys = new Set();
    for (const item of base) {
        const key = canonicalKeyOf(item, options);
        if (key) existingKeys.add(key);
    }
    const addedKeys = new Set();
    const added = [];
    const skipped = [];
    for (const item of (Array.isArray(incoming) ? incoming : [])) {
        const key = canonicalKeyOf(item, options);
        if (!key) {
            skipped.push({ item: item, reason: SKIP_REASONS.EMPTY });
            continue;
        }
        if (existingKeys.has(key)) {
            skipped.push({ item: item, reason: SKIP_REASONS.DUPLICATE_EXISTING });
            continue;
        }
        if (addedKeys.has(key)) {
            skipped.push({ item: item, reason: SKIP_REASONS.DUPLICATE_INCOMING });
            continue;
        }
        addedKeys.add(key);
        added.push(item);
        next.push(item);
    }
    return {
        list: next,
        added: added,
        skipped: skipped,
        kept: base.slice(),
        duplicateSkipped: skipped.filter((s) => s.reason !== SKIP_REASONS.EMPTY).length
    };
}

/** 一行读数（面向 UI 提示与诊断页）。三态各占一格，不得压成「导入完成」。 */
export function portableLine(result, label = '便携负载') {
    if (!result || typeof result !== 'object') return label + '：无读数';
    const dup = result.skipped.filter((s) => s.reason === SKIP_REASONS.DUPLICATE_EXISTING).length;
    const dupIn = result.skipped.filter((s) => s.reason === SKIP_REASONS.DUPLICATE_INCOMING).length;
    const empty = result.skipped.filter((s) => s.reason === SKIP_REASONS.EMPTY).length;
    const parts = ['加入 ' + result.added.length, '保留既有 ' + result.kept.length];
    if (dup) parts.push('跳过重复 ' + dup);
    if (dupIn) parts.push('跳过同批重复 ' + dupIn);
    if (empty) parts.push('跳过空条目 ' + empty);
    return label + '：' + parts.join(' · ');
}

/** 解析态一行读数（给「为什么这个文件没进来」一个可读的答案）。 */
export function parseStateLine(state, mark = '') {
    switch (state) {
        case PARSE_STATES.OK: return '魔标已认（' + mark + '）';
        case PARSE_STATES.UNMARKED: return '无魔标（按旧版文件处理）';
        case PARSE_STATES.FOREIGN: return '魔标不属于此类（' + (mark || '未知') + '）—— 拒绝导入';
        case PARSE_STATES.NOT_JSON: return '不是有效 JSON';
        case PARSE_STATES.EMPTY: return '文件内容为空';
        default: return '未知解析态';
    }
}

export default {
    PORTABLE_MARKS, PARSE_STATES, SKIP_REASONS,
    readPortable, portableCandidates, canonicalKeyOf, appendByContent, portableLine, parseStateLine
};