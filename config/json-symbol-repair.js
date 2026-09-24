/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  JSON 容错解析（符号级修复）
 *
 *  【来源】缝合 atonal519/ST-MyriadKnots 的 src/json-symbol-repair.js，
 *          按本仓零依赖纯模块口径重写（非照抄）。
 *
 *  【为什么缝它】本仓解析大模型 JSON 的地方很多（honey / asset / wechat /
 *    weibo / wangxiang …），但容错手段只有一句朴素正则：
 *      JSON.parse(text.replace(/,\s*([\]}])/g, '$1'))
 *   它只认尾逗号。模型输出一旦是「缺分隔逗号」或「缺冒号」——
 *   例如 {"a":1
 *            "b":2} 或 {"a" 1} —— 整批数据直接被丢弃。本仓最贵的
 *    形态就是「不报错、不崩溃，只错数据」，所以这里补一个符号级的修复器。
 *
 *  【从素材保留的四条纪律】（机制本身比代码更值得缝）
 *    1. **严格优先**：先原地 JSON.parse，成功就绝不做任何改动。
 *    2. **只在「说完了」的时候才修**：调用方若明确告知 finishReason 是截断语义
 *       （length / max_tokens …），则**不做符号修复** —— 半截数据不该被
 *       改造成「看起来完整」的东西。尾逗号兼容不受此限（那是词法问题，
 *       不是补内容）。
 *    3. **必须真的改过才算修复**：扫描结束若一次改动都没发生，说明本来就不该
 *       走这条路，宁可不返回，也不把「没修好却说修好了」当成成功。
 *    4. **重复键不得被「修复成看起来没事」**：`{"a":1,"a":2}` 里后写的值会被
 *       静默吃掉，那是另一类「错数据」。一旦走修复路径（重新序列化）时发现
 *       重复键，直接拒判，交给调用方处置；严格路径不加码 —— 那一步是宿主
 *       `JSON.parse` 的既定行为，本模块不越权改写调用方原有的语义。
 *
 *  【允许的改动只有三类】插入缺失的 `:`、插入缺失的 `,`、删除尾随 `,`。
 *    不补字段、不猜值、不补嵌套括号 —— 修复不得发明内容。
 *    （补一个缺失的右花括号是另一件事，见 repairUniqueMissingClose。）
 * ======================================================== */

const MAX_REPAIRS = 64;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const BARE_KEY_START = /[A-Za-z_$]/;
const BARE_KEY_PART = /[A-Za-z0-9_$-]/;

/** 截断语义的 finishReason：这些值下不做符号修复 */
const TRUNCATED_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'content_filter']);

function textOf(value) {
    return typeof value === 'string' ? value : '';
}

/** 剥 Markdown 围栏（```json ... ``` / ``` ... ```） */
export function stripJsonFence(value) {
    const text = textOf(value).trim();
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : text;
}

/** 字符串与转义感知的括号配平，返回第一个完整 JSON 对象/数组的片段。
 *  替代 /\{[\s\S]*\}/ 这类贪婪匹配 —— 那种写法会把后面的正文一起吃进来。 */
export function extractFirstJsonSpan(value) {
    const text = textOf(value);
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch !== '{' && ch !== '[') continue;
        const span = balanceFrom(text, i);
        // [v2.94.0] 纪律 6 —— **容器没配平就一律拒判，绝不往后跳读**：
        //   往后跳（继续找下一个 `{` / `[`）会把一个被截断的大对象读成它内层的
        //   某个小对象，调用方于是拿到一个「形状合法、内容错位」的结果 ——
        //  「不报错、不崩溃，只错数据」，正是本仓最贵的形态。读不出来就如实说读不出来。
        if (!span) return null;
        // 明显不是 JSON 的成对短括号（正文里的 `[注]`、`[1]`）不是容器，可以略过。
        //   略过一个**完整**的正文括号 ≠ 跳过一个被截断的大对象：前者不会错读数据。
        if (isProseBracket(span.text)) continue;
        return span;
    }
    return null;
}

/** 成对、但明显是**正文**的短方括号片段（`[注]`、`[笑]`、`[旁白]`）。
 *  判据刻意收到最紧：必须**短**、内部**含非 ASCII（汉字等）**、且**不含任何 JSON 标点**。
 *  这样 `[1]`、`[1,2]`、`["x"]`、`[{"a":1}]` 都不会被误当成正文括号略过 ——
 *  真正的数组哪怕首容器、也照原样返回，绝不为了找后面的东西跳过它。 */
function isProseBracket(text) {
    if (text[0] !== '[' || text.length > 16) return false;
    const inner = text.slice(1, -1);
    if (!inner || /["{}[\]:,]/.test(inner)) return false;
    return /[^\x00-\x7f]/.test(inner);
}

/** 从 start 处按「字符串与转义感知」的方式配平出第一个完整容器；未配平返回 null。 */
function balanceFrom(text, start) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth += 1;
        else if (ch === close) {
            depth -= 1;
            if (depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 };
        }
    }
    return null;
}

function normalizeFinishReason(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
}

/** 符号级修复扫描：一次遍历重新序列化，并记账每一次改动。
 *  改动类型只有 insert-colon / insert-comma / remove-trailing-comma 三种。
 *  按选项返回 { text, operations } 或 null（不满足纪律即拒判）。 */
function symbolScan(source, { trailingCommasOnly = false } = {}) {
    let index = 0;
    let output = '';
    const operations = [];
    let duplicateKey = false;

    const record = (type, at, payload = '') => {
        // 尾逗号兼容模式：只允许删尾逗号，其余改动一律拒判（严格的子集）。
        if (trailingCommasOnly && type !== 'remove-trailing-comma') throw new SyntaxError('non-trailing-comma');
        if (operations.length >= MAX_REPAIRS) throw new SyntaxError('too-many-json-repairs');
        operations.push({ type, index: at, value: payload });
    };
    const whitespace = () => {
        while (/\s/.test(source[index] || '')) index += 1;
    };
    const cloneWs = () => {
        const start = index;
        while (/\s/.test(source[index] || '')) index += 1;
        output += source.slice(start, index);
    };
    const isValueStart = (ch) => ch === '{' || ch === '[' || ch === '"' || ch === '-' || /[0-9]/.test(ch || '')
        || ch === 't' || ch === 'f' || ch === 'n';

    /* 读一个字符串 token；返回 { key } 或 null。不合法就不修（修复不发明内容） */
    function stringToken() {
        if (source[index] !== '"') return null;
        let cursor = index + 1;
        while (cursor < source.length) {
            const ch = source[cursor];
            if (ch === '\\') {
                const esc = source[cursor + 1];
                if (esc === 'u') {
                    if (!/^[0-9a-fA-F]{4}$/.test(source.slice(cursor + 2, cursor + 6))) return null;
                    cursor += 6;
                } else if (/["\\/bfnrt]/.test(esc || '')) cursor += 2;
                else return null;
                continue;
            }
            if (ch === '"') break;
            if (ch.charCodeAt(0) <= 0x1f) return null;
            cursor += 1;
        }
        if (source[cursor] !== '"') return null;
        const rawToken = source.slice(index, cursor + 1);
        index = cursor + 1;
        output += rawToken;
        try { return { key: JSON.parse(rawToken) }; } catch { return null; }
    }

    /* 裸键：`{a:1}` —— 补上引号并记账。 */
    function bareKeyToken() {
        if (!BARE_KEY_START.test(source[index] || '')) return null;
        const start = index;
        index += 1;
        while (BARE_KEY_PART.test(source[index] || '')) index += 1;
        const key = source.slice(start, index);
        if (source[index] === '"') index += 1;   // `a":` 这种半截引号
        record('quote-bare-key', start, key);
        output += JSON.stringify(key);
        whitespace();
        return { key };
    }

    function parseKey() {
        if (source[index] === '"') return stringToken();
        return bareKeyToken();
    }

    function parseValue() {
        const ch = source[index];
        if (ch === '{') return parseObject();
        if (ch === '[') return parseArray();
        if (ch === '"') return stringToken() ? { kind: 'string' } : null;
        for (const literal of ['true', 'false', 'null']) {
            if (source.startsWith(literal, index)) {
                output += literal;
                index += literal.length;
                return { kind: 'literal' };
            }
        }
        NUMBER.lastIndex = index;
        const num = NUMBER.exec(source);
        if (num) {
            output += num[0];
            index = NUMBER.lastIndex;
            return { kind: 'number' };
        }
        return null;
    }

    function parseObject() {
        const keys = new Set();
        output += '{';
        index += 1;
        cloneWs();
        if (source[index] === '}') { output += '}'; index += 1; return { kind: 'object' }; }
        while (index < source.length) {
            const keyToken = parseKey();
            if (!keyToken) return null;
            if (keys.has(keyToken.key)) duplicateKey = true;
            keys.add(keyToken.key);
            // 冒号：有就照抄；没有则只有在「键后面确实隔了空白又跟着值」时才补。
            //   没有间隔就直接补，会把 `{a b:1}` 这种两个键粘在一起的输入猜错。
            const wsStart = index;
            while (/\s/.test(source[index] || '')) index += 1;
            const gap = index - wsStart;
            if (source[index] === ':') { output += source.slice(wsStart, index) + ':'; index += 1; }
            else if (isValueStart(source[index]) && gap > 0) {
                record('insert-colon', index, ':');
                output += source.slice(wsStart, index) + ':';
            } else return null;
            cloneWs();
            const value = parseValue();
            if (!value) return null;
            cloneWs();
            if (source[index] === '}') { output += '}'; index += 1; return { kind: 'object' }; }
            if (source[index] === ',') {
                const commaAt = index;
                index += 1;
                const wsAt = index;
                while (/\s/.test(source[index] || '')) index += 1;
                if (source[index] === '}') {
                    record('remove-trailing-comma', commaAt);
                    output += source.slice(wsAt, index) + '}';
                    index += 1;
                    return { kind: 'object' };
                }
                output += ',' + source.slice(wsAt, index);
                continue;
            }
            // 没逗号但后面是键或值：插一个（仅当边界安全：不把两个字符串挤在一起）
            const safeBoundary = isValueStart(source[index])
                && !(value.kind === 'string' && source[index] === '"');
            if (!safeBoundary) return null;
            record('insert-comma', index, ',');
            output += ',';
            continue;
        }
        return null;
    }

    function parseArray() {
        output += '[';
        index += 1;
        cloneWs();
        if (source[index] === ']') { output += ']'; index += 1; return { kind: 'array' }; }
        while (index < source.length) {
            const value = parseValue();
            if (!value) return null;
            cloneWs();
            if (source[index] === ']') { output += ']'; index += 1; return { kind: 'array' }; }
            if (source[index] === ',') {
                const commaAt = index;
                index += 1;
                const wsStart = index;
                while (/\s/.test(source[index] || '')) index += 1;
                if (source[index] === ']') {
                    record('remove-trailing-comma', commaAt);
                    output += source.slice(wsStart, index) + ']';
                    index += 1;
                    return { kind: 'array' };
                }
                output += ',' + source.slice(wsStart, index);
                continue;
            }
            const safeBoundary = (value.kind === 'object' || value.kind === 'array')
                && (source[index] === '{' || source[index] === '[');
            if (!safeBoundary) return null;
            record('insert-comma', index, ',');
            output += ',';
        }
        return null;
    }

    try {
        cloneWs();
        const root = parseValue();
        if (!root) return null;
        cloneWs();
        if (index !== source.length) return null;
        if (duplicateKey) return null;
        if (!operations.length) return null;   // 纪律 3：没改过就不算修复
        let value;
        try { value = JSON.parse(output); } catch { return null; }
        return { value, text: output, operations };
    } catch {
        return null;
    }
}

/**
 * 容错解析入口。
 * @param {string} raw 原始文本（可带 ```json 围栏）
 * @param {{finishReason?:string, allowSymbolRepair?:boolean}} [options]
 * @returns {{ok:boolean, value:*, text:string, repaired:boolean, operations:Array, reason:string}}
 */
export function parseJsonTolerant(raw, options = {}) {
    const source = stripJsonFence(raw);
    const fail = (reason) => ({ ok: false, value: null, text: source, repaired: false, operations: [], reason });
    if (!source) return fail('empty');

    try {
        return { ok: true, value: JSON.parse(source), text: source, repaired: false, operations: [], reason: 'strict' };
    } catch { /* 进入容错路径 */ }

    const reason = normalizeFinishReason(options.finishReason);
    const truncated = TRUNCATED_REASONS.has(reason) || options.allowSymbolRepair === false;

    // 第二段：尾逗号兼容。这是**词法**问题（多了一个分隔符），不发明任何内容，
    //   也不改变数据的形状 —— 因此不受「截断不修」限制：说半截话时把尾逗号
    //   去掉不会制造任何假事实。（素材里这一路也是独立函数。）
    const lexical = symbolScan(source, { trailingCommasOnly: true });
    if (lexical) {
        return { ok: true, value: lexical.value, text: lexical.text, repaired: true, operations: lexical.operations, reason: 'trailing-comma' };
    }
    if (truncated) return fail('truncated-no-repair');

    // 第三段：整段只差一个收尾花括号，且可行的补法唯一。
    //   放在括号配平之前：`{"a":{"b":1}` 这种输入里，配平器会先找到**内层**
    //   那个已闭合的对象，把整条记录读成内层对象 —— 那是错的读数。
    const closed = repairUniqueMissingClose(source, options);
    if (closed) {
        return {
            ok: true, value: closed, text: source + '}', repaired: true,
            operations: [{ type: 'append-object-close', index: source.length, value: '}' }],
            reason: 'unique-close-repair',
        };
    }

    // 第四段：从正文里配平出第一个完整 JSON 片段。若它本身就合规，那叫**提取**，
    //   不叫修复 —— 纪律 1/3 都要求如实标注，不得借此声称「修好了」。
    const span = extractFirstJsonSpan(source);
    if (!span) return fail('no-json-span');
    try {
        return { ok: true, value: JSON.parse(span.text), text: span.text, repaired: false, operations: [], reason: 'strict' };
    } catch { /* 片段本身也不合规，进入符号修复 */ }

    const scanned = symbolScan(span.text);
    if (!scanned) return fail('unrepairable');
    return { ok: true, value: scanned.value, text: scanned.text, repaired: true, operations: scanned.operations, reason: 'symbol-repair' };
}

/** 第三段兜底：仅当「补一个右花括号」能修好、且可行位置唯一时才接受。
 *  多个位置都能补时说明输入歧义，宁可拒判也不猜。
 *  （本函数不导出：它是 parseJsonTolerant 的内部阶段，不单独对外开口子。） */
function repairUniqueMissingClose(source, options = {}) {
    if (!source) return null;
    if (TRUNCATED_REASONS.has(normalizeFinishReason(options.finishReason))) return null;
    if (/^\s*\[/.test(source)) return null;
    // 按**结果**去重，而不是按插入位置计数：插在末尾最后一个括号之前与之后
    //   会得到完全相同的文本，若按位置计数，唯一的可行解会被误判成多解。
    const hits = new Map();
    for (let i = source.length; i >= Math.max(0, source.length - 64); i -= 1) {
        if (i < source.length && !/[}\]]/.test(source[i])) continue;
        const candidate = source.slice(0, i) + '}' + source.slice(i);
        if (hits.has(candidate)) continue;
        try {
            const parsed = JSON.parse(candidate);
            const okShape = parsed && typeof parsed === 'object'
                && (options.allowArray === true || !Array.isArray(parsed));
            if (okShape) hits.set(candidate, parsed);
        } catch { /* 试下一个可能的位置 */ }
    }
    if (hits.size !== 1) return null;
    return [...hits.values()][0];
}
