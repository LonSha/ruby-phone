/* ========================================================
 * config/worldbook-entry-settings.js —— 世界书条目的「设置面」归一化
 * --------------------------------------------------------
 * 缝合自 memory-plugin-research/memorybooks/addlore.js 的两段
 *   （`normalizeLorebookEntrySettings` / `applyLorebookEntrySettings`，
 *    侦察台账第 2 件与第 7 件在此合流）。
 *
 * 【修前本仓是什么样（实测）】
 *   `config/worldbook-write.js` 的 `mergeEntries()` 写条目时只认四个字段
 *   （key / keysecondary / disable / constant），其余一律靠 `...extra` 原样带过。
 *   于是写出去的记忆条目在世界书里**全是默认形态**：
 *     · `position` 不写 ⇒ 落在 ST 的缺省位；`order` 不写 ⇒ 与同期手写条目抢序；
 *     · 想让某条「常驻」只能靠用户在编辑器里手点（`constant` 虽能写，但没人会去点）；
 *     · 标题是 `记忆 <uid>` 这种裸名 —— 世界书列表里按标题排序时全挤在一起，
 *       且**没有序号可读**，用户找一条旧记忆要一条条点开。
 *   这不是「缺一个开关」，是写出去的条目**没有可读性与可控性**。
 *
 * 【本件给什么（逐条对应源）】
 *   · 受控字段白名单（28 格）：只给这些格子写默认值，其余字段原样带过 ——
 *     硬编码「完整字段表」等于把 ST 的版本演进变成我的 bug（与 worldbook-write 同口径）；
 *   · `position` 合法集是 `{0,1,2,3,5,6,7}`（ST 的 4 号位已废），非法一律回 0；
 *   · `order` 三档：`auto`（= 自身序号）/ `reverse`（`reverseStart - (序号-1)`）/ `manual`（给定值），
 *     三档都夹在 0~9999；`reverseStart` 自己夹在 100~9999；
 *     **越界不是丢弃而是夹紧**，并回一条「夹紧了」的读数（用户设 99999 该得到 9999，而不是没有）；
 *   · `constVectMode` 三色 → 两个布尔：`blue`=常驻（constant）、`green`=关键字触发、
 *     `link`=向量化；非法回 `link`；
 *   · `position === 7`（outlet）才写 `outletName`，其余位置**删掉**该字段 ——
 *     留着会让 ST 把非 outlet 位置的条目也当 outlet 处理；
 *   · 标题模板：`[000]` 这类占位按序号补零，模板里没有占位时可用 `forceNumber` 补在最前；
 *     控制字符（U+0000–001F / 007F–009F）剥离，剥空了兜底一个可读名。
 *
 * 【本仓差异（照抄会坏的地方）】
 *   · 源从 `extension_settings.STMemoryBooks` 读设置、从 `newWorldInfoEntryTemplate` 取字段默认值、
 *     越界时 `toastr.info` 弹提示。本仓三者都没有宿主面：
 *     设置由调用方传入（`config/worldbook-manager.js` 的 storage 键），默认值用本文件的冻结表，
 *     弹窗换成**返回值里的 `notes`**（谁要提示谁自己去提示，纯件不碰 DOM）。
 *   · 源用 `Number.isFinite(Number(v))` 取数；本仓 W1 门禁禁这一族写法，一律走 `numOrNull`。
 *   · 源的标题里有 `{{date}} {{time}}`（moment）；本仓不引入 moment，占位由调用方备好值，
 *     本件只做「占位替换 + 补零 + 净化」，**不看时钟**（故可 data: URL 装载副本做负控制）。
 *
 * 【纪律】
 *   ① 纯函数：零 IO、不看时钟、不弹窗（提示以返回值表达）；
 *   ② 不抛：设置畸形（null / 字符串 / 数组 / Symbol）一律降级成默认表，绝不因设置坏掉而写坏条目；
 *   ③ 不覆盖用户值以外的面：只写白名单 + 三档 order + displayIndex，`content` / `uid` / `comment`
 *      由调用方持有，本件一个字节都不碰。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';

/** ST 的 position 合法集（4 号位已废，故跳号）。 */
export const LOREBOOK_POSITIONS = Object.freeze([0, 1, 2, 3, 5, 6, 7]);
/** position 7 = outlet：只有这一位才带 `outletName`。 */
export const OUTLET_POSITION = 7;
/** order 三档的边界（源值）。 */
export const ORDER_MIN = 0;
export const ORDER_MAX = 9999;
export const REVERSE_START_MIN = 100;
export const REVERSE_START_MAX = 9999;
/** 标题模板缺省值（源 addlore 的 DEFAULT_TITLE_FORMATS 兜底项 i18n 同款 `[000] - {{title}}`）。
 *   必须带 `{{title}}` 占位：只写 `[000]` 会让标题只剩一个编号，用户认不出这条记的是什么。 */
export const TITLE_NUMBER_FALLBACK = '[000] - {{title}}';

/** 设置表的默认值（冻结；源的默认 orderMode 是 auto、orderValue 100、reverseStart 9999）。 */
export const DEFAULT_ENTRY_SETTINGS = Object.freeze({
    constVectMode: 'link',
    position: 0,
    outletName: '',
    orderMode: 'auto',
    orderValue: 100,
    reverseStart: 9999,
    preventRecursion: false,
    delayUntilRecursion: false,
    ignoreBudget: false,
    titleFormat: TITLE_NUMBER_FALLBACK
});

/**
 * 受控字段白名单（28 格，源逐字同表）。
 *   只给这些格子写默认值 —— 不在表里的字段原样保留调用方现值。
 */
export const CONTROLLED_ENTRY_FIELDS = Object.freeze([
    'keysecondary',
    'selective',
    'selectiveLogic',
    'addMemo',
    'disable',
    'ignoreBudget',
    'excludeRecursion',
    'matchPersonaDescription',
    'matchCharacterDescription',
    'matchCharacterPersonality',
    'matchCharacterDepthPrompt',
    'matchScenario',
    'matchCreatorNotes',
    'probability',
    'useProbability',
    'depth',
    'group',
    'groupOverride',
    'groupWeight',
    'scanDepth',
    'caseSensitive',
    'matchWholeWords',
    'useGroupScoring',
    'automationId',
    'role',
    'sticky',
    'cooldown',
    'delay',
    'triggers'
]);

/**
 * 受控字段的默认值（源逐字同表）。
 *   `null` 是**有意义的默认**（scanDepth / caseSensitive / matchWholeWords /
 *   useGroupScoring / sticky / cooldown / delay）—— 表示「跟随 ST 的全局缺省」，
 *   不是「没给」。故这里不能用 `undefined` 表达，两者在写回时会分家。
 */
export const CONTROLLED_FIELD_DEFAULTS = Object.freeze({
    keysecondary: [],
    selective: true,
    selectiveLogic: 0,
    addMemo: false,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    triggers: []
});

/** order 值夹紧到 0~9999（不可判定则用 fallback）。取整，不四舍五入。 */
export function clampOrderValue(value, fallback = 100) {
    const n = numOrNull(value);
    if (n === null) return fallback;
    return Math.min(ORDER_MAX, Math.max(ORDER_MIN, Math.trunc(n)));
}

/** reverseStart 夹紧到 100~9999（不可判定则用 fallback）。 */
export function clampReverseStart(value, fallback = REVERSE_START_MAX) {
    const n = numOrNull(value);
    if (n === null) return fallback;
    return Math.min(REVERSE_START_MAX, Math.max(REVERSE_START_MIN, Math.trunc(n)));
}

/** orderMode：只认 auto / reverse / manual，其余回 auto。 */
export function normalizeOrderMode(value) {
    const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return mode === 'manual' || mode === 'reverse' ? mode : 'auto';
}

/** position：取整后必须在合法集内，否则回 fallback（再不行回 0）。 */
export function normalizePosition(value, fallback = 0) {
    const safeFallback = LOREBOOK_POSITIONS.includes(fallback) ? fallback : 0;
    const n = numOrNull(value);
    if (n === null) return safeFallback;
    const pos = Math.trunc(n);
    return LOREBOOK_POSITIONS.includes(pos) ? pos : safeFallback;
}

/**
 * delayUntilRecursion 是三态：`false` / `true` / 正数（延迟层数）。
 *   源的口径：非布尔的数字先取整，`> 0` 才算数，否则落回 false（0 与负数都等于关）。
 */
export function normalizeDelayUntilRecursion(value, fallback = false) {
    if (value === undefined) return fallback;
    if (value === true || value === false) return value;
    const n = numOrNull(value);
    if (n !== null && n > 0) return Math.trunc(n);
    return false;
}

/**
 * 算某条的 order。
 *   `auto` 直接用序号；`reverse` 从 reverseStart 往下减；`manual` 用给定值。
 *   三档结果一律夹紧，并在真发生夹紧时回一条 note（源在此处弹 toast，本件只回报）。
 * @returns {{order:number, notes:Array<string>}}
 */
export function computeEntryOrder(settings, orderNumber) {
    const one = settings && typeof settings === 'object' ? settings : {};
    const safeNumber = numOrNull(orderNumber);
    const seq = safeNumber === null ? 1 : Math.max(1, Math.trunc(safeNumber));
    const mode = normalizeOrderMode(one.orderMode);
    const notes = [];
    let raw;
    let label;
    if (mode === 'manual') {
        raw = one.orderValue;
        label = '手填 order';
    } else if (mode === 'reverse') {
        raw = clampReverseStart(one.reverseStart, REVERSE_START_MAX) - (seq - 1);
        label = '倒序算出的 order（第 ' + seq + ' 条）';
    } else {
        raw = seq;
        label = '序号本身';
    }
    const fallback = mode === 'manual' ? 100 : seq;
    const order = clampOrderValue(raw, fallback);
    const asNum = numOrNull(raw);
    if (asNum !== null && (asNum < ORDER_MIN || asNum > ORDER_MAX)) {
        notes.push(label + ' 越界 ' + asNum + '，已夹到 ' + order);
    }
    return { order: order, notes: notes };
}

/**
 * 归一设置表。任何一格坏掉都只坏那一格，其余照常。
 * @param {*} settings 上游设置（可能畸形）
 * @param {*} defaults 覆盖默认（可选）
 * @returns {{settings:object, notes:Array<string>}}
 */
export function normalizeLorebookEntrySettings(settings, defaults) {
    const base = Object.assign({}, DEFAULT_ENTRY_SETTINGS, (defaults && typeof defaults === 'object') ? defaults : {});
    const one = settings && typeof settings === 'object' ? settings : {};
    const notes = [];
    const pick = (key) => (one[key] !== undefined ? one[key] : base[key]);

    const modeRaw = typeof pick('constVectMode') === 'string' ? pick('constVectMode').trim().toLowerCase() : '';
    const constVectMode = (modeRaw === 'blue' || modeRaw === 'green' || modeRaw === 'link') ? modeRaw : 'link';
    if (modeRaw && modeRaw !== constVectMode) notes.push('常驻/向量模式「' + modeRaw + '」不认识，按 link 处理');

    const orderMode = normalizeOrderMode(pick('orderMode'));
    const positionFallback = normalizePosition(base.position, 0);
    const position = normalizePosition(pick('position'), positionFallback);
    if (numOrNull(pick('position')) !== null && position !== Math.trunc(numOrNull(pick('position')))) {
        notes.push('position ' + pick('position') + ' 不是合法位（' + LOREBOOK_POSITIONS.join('/') + '），已回 ' + position);
    }

    const orderValueFallback = clampOrderValue(base.orderValue, 100);
    const reverseStartFallback = clampReverseStart(base.reverseStart, REVERSE_START_MAX);
    const titleRaw = typeof pick('titleFormat') === 'string' ? pick('titleFormat').trim() : '';

    return {
        settings: {
            constVectMode: constVectMode,
            position: position,
            outletName: typeof pick('outletName') === 'string' ? pick('outletName').trim() : String(pick('outletName') ?? '').trim(),
            orderMode: orderMode,
            orderValue: clampOrderValue(pick('orderValue'), orderValueFallback),
            reverseStart: clampReverseStart(pick('reverseStart'), reverseStartFallback),
            preventRecursion: pick('preventRecursion') === undefined ? !!base.preventRecursion : !!pick('preventRecursion'),
            delayUntilRecursion: normalizeDelayUntilRecursion(pick('delayUntilRecursion'), normalizeDelayUntilRecursion(base.delayUntilRecursion)),
            ignoreBudget: pick('ignoreBudget') === undefined ? !!base.ignoreBudget : !!pick('ignoreBudget'),
            titleFormat: titleRaw || TITLE_NUMBER_FALLBACK
        },
        notes: notes
    };
}

/** 受控字段的默认值副本（数组/对象要拷贝，否则两次写入共用同一个数组实例）。 */
function defaultOf(field) {
    const value = CONTROLLED_FIELD_DEFAULTS[field];
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return Object.assign({}, value);
    return value;
}

/**
 * 把设置落到条目上。**就地改传入对象**（调用方拿到的就是改写后的那份）。
 * @param {object} entry 目标条目
 * @param {*} settings 上游设置
 * @param {{orderNumber?:number}} options `orderNumber` 是该条的序号（倒序档要用）
 * @returns {{orderNumber:number, settings:object, notes:Array<string>}}
 */
export function applyLorebookEntrySettings(entry, settings, options = {}) {
    const target = entry && typeof entry === 'object' ? entry : {};
    const normalized = normalizeLorebookEntrySettings(settings);
    const set = normalized.settings;
    const notes = normalized.notes.slice();
    const orderNumberRaw = numOrNull(options && options.orderNumber);
    const orderNumber = orderNumberRaw === null ? 1 : Math.max(1, Math.trunc(orderNumberRaw));

    /* 三色 → 两个布尔。绿与链都**不是**常驻，差别只在向量化。 */
    if (set.constVectMode === 'blue') {
        target.constant = true;
        target.vectorized = false;
    } else if (set.constVectMode === 'green') {
        target.constant = false;
        target.vectorized = false;
    } else {
        target.constant = false;
        target.vectorized = true;
    }

    target.position = set.position;
    /* 只有 outlet 位才带 outletName；其余位置留着会让 ST 把普通条目当 outlet。 */
    if (set.position === OUTLET_POSITION && set.outletName) {
        target.outletName = set.outletName;
    } else {
        delete target.outletName;
    }

    const computed = computeEntryOrder(set, orderNumber);
    target.order = computed.order;
    notes.push(...computed.notes);

    target.preventRecursion = set.preventRecursion;
    target.delayUntilRecursion = set.delayUntilRecursion;
    for (const field of CONTROLLED_ENTRY_FIELDS) {
        target[field] = defaultOf(field);
    }
    /* 白名单里的 ignoreBudget 与设置里的同名字段取设置值（源同序：先铺默认再覆盖）。 */
    target.ignoreBudget = set.ignoreBudget;
    target.addMemo = true;
    /* displayIndex 让 ST 的列表按写入序排；stmemorybooks 是「这条是插件写的」的标记。 */
    target.displayIndex = orderNumber;
    target.stmemorybooks = true;
    return { orderNumber: orderNumber, settings: set, notes: notes };
}

/**
 * 标题净化：只剥控制字符（C0 / C1），其余 Unicode 一律放行（与 ST 的编辑器一致）。
 *   剥空了兜底一个可读名 —— 空标题在世界书列表里是一行空白，比「自动记忆」更难认。
 */
export function sanitizeEntryTitle(title) {
    const text = String(title ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    return text || '自动记忆';
}

/** 模板里有没有序号占位（`[[000]]` / `([000])` / `{[000]}` / `#[000]` / `[000]` / `(000)` / `{000}` / `#000`）。 */
export function hasSequencePlaceholder(titleFormat) {
    return /\[\[0+\]\]|\(\[0+\]\)|\{\[0+\]\}|#\[0+\]|\[0+\]|\(0+\)|\{0+\}|#0+/.test(String(titleFormat ?? ''));
}

/**
 * 把模板里的序号占位换成实际序号（按占位位数补零）。
 *   没有占位时原样返回；要让「没有占位的模板」也带序号，用 `forceNumber`。
 *
 * ★ 括号的**去留与源逐字一致**（照 source 的 memoryRegeneration.test.js 逐条对读，
 *   那里是 8 条期望值全列出来的表驱动断言，不是我凭「看着像」写）：
 *     `[[000]]` → `[007]`（双括号退成单括号）   `[000]` → `007`（**括号被吃掉**）
 *     `([000])` → `(007)`  `{[000]}` → `{007}`  `#[000]` → `#007`
 *     `(000)`   → `(007)`  `{000}`   → `{007}`  `#000`   → `#007`
 *   即：占位的外壳（[] {} # 与两侧圆括号）不属于序号，**只有 `[[..]]` 与 `([..])`
 *   这两种双层写法才把内层方括号当成外壳的一部分**。`[000]` 单层写法的输出没有方括号。
 */
export function formatEntryTitleAtNumber(titleFormat, sequenceNumber, options = {}) {
    const format = String(titleFormat ?? '');
    const n = numOrNull(sequenceNumber);
    const number = Math.max(0, Math.trunc(n === null ? 0 : n));
    const patterns = [
        [/\[\[(0+)\]\]/g, (digits) => '[' + String(number).padStart(digits.length, '0') + ']'],
        [/\(\[(0+)\]\)/g, (digits) => '(' + String(number).padStart(digits.length, '0') + ')'],
        [/\{\[(0+)\]\}/g, (digits) => '{' + String(number).padStart(digits.length, '0') + '}'],
        [/#\[(0+)\]/g, (digits) => '#' + String(number).padStart(digits.length, '0')],
        [/\[(0+)\]/g, (digits) => String(number).padStart(digits.length, '0')],
        [/\((0+)\)/g, (digits) => '(' + String(number).padStart(digits.length, '0') + ')'],
        [/\{(0+)\}/g, (digits) => '{' + String(number).padStart(digits.length, '0') + '}'],
        [/#(0+)/g, (digits) => '#' + String(number).padStart(digits.length, '0')]
    ];
    let out = format;
    for (const [pattern, replace] of patterns) {
        if (pattern.test(out)) {
            pattern.lastIndex = 0;
            out = out.replace(pattern, (_m, digits) => replace(digits));
            return out;
        }
        pattern.lastIndex = 0;
    }
    if (options && options.forceNumber === true) {
        /* forceNumber 走的是 addlore 的另一条分支：`[${String(n).padStart(3,'0')}] `（**带**方括号）。 */
        return '[' + String(number).padStart(3, '0') + '] ' + out;
    }
    return out;
}

/**
 * 下一可用序号：只看**已有条目**里按同一模板能认出序号的标题，取最大值 +1。
 *   认不出（模板无占位）⇒ 1。神秘点：认序号必须**按模板**认，不能拿「正文里的数字」凑 ——
 *   `[000] 第三次约会` 里的那个 3 是内容，不是序号。
 */
export function nextEntryNumber(entries, titleFormat) {
    const list = Array.isArray(entries) ? entries : [];
    const format = String(titleFormat ?? '').trim();
    let max = 0;
    for (const entry of list) {
        const comment = entry && typeof entry === 'object' ? String(entry.comment ?? '') : '';
        if (!comment) continue;
        const num = numberFromFormattedTitle(comment, format);
        if (num !== null && num > max) max = num;
    }
    return max + 1;
}

/**
 * 从「按某模板生成的标题」里反解序号。
 *   做法是**照搬格式化那八条 pattern 的产物形态**拼正则：格式化把 `[000]` 换成 `007`（无壳）、
 *   把 `[[000]]` 换成 `[007]`（留一层方括号）、把 `#[000]` 换成 `#007`……
 *   反解必须逐条一一对应，否则「反解不出自己刚生成的东西」（这正是本件第一版自检抓到的形态）。
 *   `{{...}}` 段放成任意内容；模板没有占位、或标题对不上模板 ⇒ null（不猜）。
 */
export function numberFromFormattedTitle(title, titleFormat) {
    const text = String(title ?? '');
    const format = String(titleFormat ?? '').trim();
    if (!text || !format || !hasSequencePlaceholder(format)) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* 与 formatEntryTitleAtNumber 的 patterns 逐条同序：左边是输入的占位写法，右边是它的产出外壳。
       数字用 `\d+` 而不是按占位位数定长 —— 源的反解也是 `(\d+)`：位数只约束**补零**，
       不约束**认读**（手改过的标题 `12` 落在 `[000]` 模板上仍该认成 12，不该因为少一位就 null）。 */
    const shells = [
        [/^\[\[(0+)\]\]/, () => '\\[(\\d+)\\]'],
        [/^\(\[(0+)\]\)/, () => '\\((\\d+)\\)'],
        [/^\{\[(0+)\]\}/, () => '\\{(\\d+)\\}'],
        [/^#\[(0+)\]/, () => '#(\\d+)'],
        [/^\[(0+)\]/, () => '(\\d+)'],
        [/^\((0+)\)/, () => '\\((\\d+)\\)'],
        [/^\{(0+)\}/, () => '\\{(\\d+)\\}'],
        [/^#(0+)/, () => '#(\\d+)']
    ];
    let pattern = '';
    let i = 0;
    const src = format;
    while (i < src.length) {
        const two = src.slice(i, i + 2);
        if (two === '{{') {
            const close = src.indexOf('}}', i + 2);
            if (close < 0) { pattern += esc(src.slice(i)); break; }
            pattern += '[\\s\\S]*?';
            i = close + 2;
            continue;
        }
        const rest = src.slice(i);
        let hitShell = null;
        for (const [re, build] of shells) {
            const m = re.exec(rest);
            if (m) { hitShell = { len: m[0].length, built: build(m[1]) }; break; }
        }
        if (hitShell) {
            pattern += hitShell.built;
            i += hitShell.len;
            continue;
        }
        pattern += esc(src[i]);
        i += 1;
    }
    let re = null;
    try {
        re = new RegExp('^' + pattern + '$');
    } catch (_e) {
        return null;
    }
    const hit = re.exec(text);
    if (!hit) return null;
    const n = numOrNull(hit[1]);
    return n === null ? null : Math.trunc(n);
}

/** 一行读数：三态分列（位置 / 排序 / 常驻形态），夹紧与降级各自说出来。 */
export function entrySettingsLine(result) {
    if (!result || typeof result !== 'object') return '条目设置：无读数';
    const set = result.settings && typeof result.settings === 'object' ? result.settings : {};
    const modeLabel = set.constVectMode === 'blue' ? '常驻' : (set.constVectMode === 'green' ? '关键字触发' : '向量化');
    const parts = [
        '位置 ' + (set.position === undefined ? '?' : set.position),
        '排序 ' + (set.orderMode === 'manual' ? '手填' : (set.orderMode === 'reverse' ? '倒序' : '自动')),
        '形态 ' + modeLabel
    ];
    const notes = Array.isArray(result.notes) ? result.notes : [];
    if (notes.length) parts.push('调整 ' + notes.length + ' 处：' + notes.join('；'));
    return '条目设置：' + parts.join(' · ');
}

/** 自检：每格都两向自证（该夹的夹、该留的留），并证「坏一格不坏其余」。 */
export function worldbookEntrySettingsSelfCheck() {
    const problems = [];
    const push = (ok, msg) => { if (!ok) problems.push(msg); };

    /* ① 夹紧两向：越界夹、合法留、不可判定回 fallback */
    push(clampOrderValue(99999) === ORDER_MAX, 'order 上越界必须夹到上限');
    push(clampOrderValue(-5) === ORDER_MIN, 'order 负值必须夹到下限');
    push(clampOrderValue(37) === 37 && clampOrderValue('37') === 37, '合法 order 必须原样（数与数字串同形）');
    push(clampOrderValue('  ') === 100 && clampOrderValue(null) === 100, '不可判定必须回 fallback（空串与 null 不得当 0）');
    push(clampOrderValue(3.9) === 3, 'order 必须取整不四舍五入');
    push(clampReverseStart(1) === REVERSE_START_MIN, 'reverseStart 下越界必须夹到下限');
    push(clampReverseStart(99999) === REVERSE_START_MAX, 'reverseStart 上越界必须夹到上限');
    push(clampReverseStart(500) === 500, '合法 reverseStart 必须原样');

    /* ② 枚举两向：认得的三值留、其余回缺省 */
    push(normalizeOrderMode('MANUAL') === 'manual' && normalizeOrderMode(' Reverse ') === 'reverse', '大小写与空白必须认');
    push(normalizeOrderMode('乱写') === 'auto' && normalizeOrderMode(null) === 'auto', '不认识的排序必须回 auto');
    push(normalizePosition(7) === 7 && normalizePosition('3') === 3, '合法位置必须原样');
    push(normalizePosition(4) === 0, '空档位 4 必须回 0');
    push(normalizePosition(99) === 0, '越界位置必须回 fallback');
    push(normalizePosition(4, 7) === 7, 'fallback 本身是合法位时必须用它');
    push(normalizePosition(4, 44) === 0, 'fallback 非法时必须回 0');

    /* ③ 延迟三态：false / true / 正数留，0 与负数等于关 */
    push(normalizeDelayUntilRecursion(true) === true, 'true 必须留');
    push(normalizeDelayUntilRecursion(3) === 3, '正数层数必须留');
    push(normalizeDelayUntilRecursion(0) === false && normalizeDelayUntilRecursion(-2) === false, '0 与负数必须等于关');
    push(normalizeDelayUntilRecursion('乱写') === false, '乱写必须等于关');
    push(normalizeDelayUntilRecursion(undefined, true) === true, 'undefined 必须用 fallback');

    /* ④ 排序计算三档：auto=序号、reverse=倒减、manual=给定值，且夹紧有 note */
    push(computeEntryOrder({ orderMode: 'auto' }, 5).order === 5, 'auto 档必须等于序号');
    push(computeEntryOrder({ orderMode: 'reverse', reverseStart: 900 }, 3).order === 898, 'reverse 档必须从 reverseStart 倒减');
    push(computeEntryOrder({ orderMode: 'manual', orderValue: 12 }, 5).order === 12, 'manual 档必须用给定值');
    const clamped = computeEntryOrder({ orderMode: 'manual', orderValue: 99999 }, 1);
    push(clamped.order === ORDER_MAX && clamped.notes.length === 1, '夹紧必须回报一条 note');
    push(computeEntryOrder({}, 0).order === 1, '序号 0 必须当 1');

    /* ⑤ 归一表：坏一格只坏那一格 */
    const bad = normalizeLorebookEntrySettings({ position: 4, constVectMode: '紫色', orderMode: '乱写', orderValue: 99999, titleFormat: '  ' }, null);
    push(bad.settings.position === 0, '非法位置必须回 0');
    push(bad.settings.constVectMode === 'link', '非法模式必须回 link');
    push(bad.settings.orderMode === 'auto', '非法排序必须回 auto');
    push(bad.settings.orderValue === ORDER_MAX, '越界 orderValue 必须夹紧');
    push(bad.settings.titleFormat === TITLE_NUMBER_FALLBACK, '空模板必须回默认模板');
    push(bad.notes.length >= 2, '每处调整都必须留 note，实得 ' + bad.notes.length);

    /* ⑥ 落到条目：三色语义、outletName 条件写、白名单与标记 */
    const blue = {}; applyLorebookEntrySettings(blue, { constVectMode: 'blue' }, { orderNumber: 2 });
    push(blue.constant === true && blue.vectorized === false, 'blue 必须常驻且非向量化');
    const green = {}; applyLorebookEntrySettings(green, { constVectMode: 'green' }, { orderNumber: 2 });
    push(green.constant === false && green.vectorized === false, 'green 必须非常驻且非向量化');
    const link = {}; applyLorebookEntrySettings(link, {}, { orderNumber: 2 });
    push(link.constant === false && link.vectorized === true, '缺省必须向量化');
    const outlet = {}; applyLorebookEntrySettings(outlet, { position: 7, outletName: ' 记忆出口 ' }, { orderNumber: 1 });
    push(outlet.outletName === '记忆出口' && outlet.position === 7, 'outlet 位必须写 outletName 并去空白');
    const noOutlet = { outletName: '残留' };
    applyLorebookEntrySettings(noOutlet, { position: 1 }, { orderNumber: 1 });
    push(!('outletName' in noOutlet), '非 outlet 位必须删掉 outletName');
    const pos7NoName = {}; applyLorebookEntrySettings(pos7NoName, { position: 7, outletName: '  ' }, { orderNumber: 1 });
    push(!('outletName' in pos7NoName), 'outlet 位但名为空也必须删掉该字段');
    push(link.order === 2 && link.displayIndex === 2, 'order 与 displayIndex 都必须落位');
    push(link.stmemorybooks === true && link.addMemo === true, '来源标记与备忘必须落位');
    push(Object.prototype.hasOwnProperty.call(link, 'depth') && link.depth === 4, '白名单字段必须铺默认值');
    push(Array.isArray(link.keysecondary) && link.keysecondary !== CONTROLLED_FIELD_DEFAULTS.keysecondary, '数组默认值必须拷贝而非共用实例');
    push(Object.prototype.hasOwnProperty.call(link, 'scanDepth') && link.scanDepth === null, 'null 默认必须写进去（不是 undefined）');
    const kept = { content: '正文', uid: 9, comment: '标题' };
    applyLorebookEntrySettings(kept, {}, { orderNumber: 1 });
    push(kept.content === '正文' && kept.uid === 9 && kept.comment === '标题', '正文/uid/标题不得被碰');

    /* ⑦ 标题：补零、首个占位优先、无占位原样、forceNumber 前置。
       括号的去留按源表逐条对读（memoryRegeneration.test.js 是 8 条期望的全列表）：
       单层 `[000]` 的方括号会被吃掉、双层 `[[000]]` 退成单层。 */
    push(formatEntryTitleAtNumber('[[000]] - {{title}}', 7) === '[007] - {{title}}', '双层方括号必须退成单层并补零');
    push(formatEntryTitleAtNumber('[000] - {{title}}', 7) === '007 - {{title}}', '单层方括号必须被吃掉（源表同款）');
    push(formatEntryTitleAtNumber('([000]) - {{title}}', 7) === '(007) - {{title}}', '圆括号套方括号必须留圆括号');
    push(formatEntryTitleAtNumber('[00] - {{title}}', 12) === '12 - {{title}}', '两位占位按两位补');
    push(formatEntryTitleAtNumber('[[000]] / [[000]] - {{title}}', 7) === '[007] / [007] - {{title}}', '同写法多处占位必须全换（源 replace 带 g）');
    push(formatEntryTitleAtNumber('无占位', 7) === '无占位', '无占位必须原样');
    push(formatEntryTitleAtNumber('无占位', 7, { forceNumber: true }) === '[007] 无占位', 'forceNumber 必须前置序号');
    push(hasSequencePlaceholder('[000]') && hasSequencePlaceholder('#00'), '占位必须认得');
    push(!hasSequencePlaceholder('无') && !hasSequencePlaceholder(''), '无占位必须认不出');

    /* ⑧ 反解序号：必须能反解自己刚生成的东西（格式化→反解回环），对不上不猜 */
    for (const [fmt, seq] of [['[[000]] - {{title}}', 7], ['[000] - {{title}}', 12], ['#[000] - {{title}}', 3], ['(000) - {{title}}', 5], ['{000} - {{title}}', 9]]) {
        const generated = formatEntryTitleAtNumber(fmt, seq);
        push(numberFromFormattedTitle(generated, fmt) === seq, '必须能反解自己生成的标题：' + fmt + ' → ' + generated);
    }
    push(numberFromFormattedTitle('12 - 海边', '[000] - {{title}}') === 12, '必须反解出序号');
    push(numberFromFormattedTitle('12 - 海边', '无占位') === null, '无占位模板必须 null');
    push(numberFromFormattedTitle('随便一条', '[000] - {{title}}') === null, '对不上模板必须 null');
    push(nextEntryNumber([{ comment: '3 - a' }, { comment: '7 - b' }, { comment: '不是我的' }], '[000] - {{title}}') === 8, '下一序号必须是最大 +1');
    push(nextEntryNumber([], '[000]') === 1 && nextEntryNumber(null, null) === 1, '空表必须 1');
    push(nextEntryNumber([{ comment: '第一次约会' }], '[000] - {{title}}') === 1, '内容里的数字不得当序号（模板对不上即不认）');

    /* ⑨ 净化：剥控制字符、保 Unicode、剥空兜底 */
    push(sanitizeEntryTitle('a\u0001b\u009Fc') === 'abc', '控制字符必须剥掉');
    push(sanitizeEntryTitle('  海边\u0000  ') === '海边', '首尾空白必须去');
    push(sanitizeEntryTitle('汉字🎐全角（）') === '汉字🎐全角（）', 'Unicode 必须放行');
    push(sanitizeEntryTitle('') === '自动记忆' && sanitizeEntryTitle(null) === '自动记忆', '剥空必须兜底');

    /* ⑩ 读数两向：说得清，且没说调整时不提调整 */
    const quiet = entrySettingsLine({ settings: { position: 1, orderMode: 'auto', constVectMode: 'link' }, notes: [] });
    push(quiet.includes('位置 1') && !quiet.includes('调整'), '无调整时不得说调整：' + quiet);
    const loud = entrySettingsLine({ settings: { position: 0, orderMode: 'reverse', constVectMode: 'blue' }, notes: ['x'] });
    push(loud.includes('倒序') && loud.includes('常驻') && loud.includes('调整 1 处'), '三态与调整数都必须说出');
    push(entrySettingsLine(null).includes('无读数'), '无读数必须说无读数');

    /* ⑪ 不抛：畸形输入 */
    let threw = false;
    try {
        normalizeLorebookEntrySettings(Symbol('s'), 'x');
        applyLorebookEntrySettings(null, null, null);
        applyLorebookEntrySettings({}, { orderMode: 'manual', orderValue: {} }, { orderNumber: [] });
        clampOrderValue(Symbol('c'));
        formatEntryTitleAtNumber(null, Symbol('n'));
        nextEntryNumber('x', 3);
        entrySettingsLine(undefined);
        sanitizeEntryTitle([]);
    } catch (_e) { threw = true; }
    push(!threw, '畸形输入不得抛');

    return { ok: problems.length === 0, problems: problems };
}

export default {
    LOREBOOK_POSITIONS, OUTLET_POSITION, ORDER_MIN, ORDER_MAX, REVERSE_START_MIN, REVERSE_START_MAX,
    TITLE_NUMBER_FALLBACK, DEFAULT_ENTRY_SETTINGS, CONTROLLED_ENTRY_FIELDS, CONTROLLED_FIELD_DEFAULTS,
    clampOrderValue, clampReverseStart, normalizeOrderMode, normalizePosition, normalizeDelayUntilRecursion,
    computeEntryOrder, normalizeLorebookEntrySettings, applyLorebookEntrySettings, sanitizeEntryTitle,
    hasSequencePlaceholder, formatEntryTitleAtNumber, nextEntryNumber, numberFromFormattedTitle,
    entrySettingsLine, worldbookEntrySettingsSelfCheck
};
