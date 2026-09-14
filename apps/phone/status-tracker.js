/**
 * status-tracker.js — [v2.11.0 缝合] 状态追踪解析引擎
 *
 * 【来源】缝合 Angx666/u4d-panel（status-parser.js），按工程规范重写为
 *         纯函数 ESM 模块。剥离 DOM 渲染（hideStatusMarkup/removeLegacyStatusMarkup），
 *         保留并通用化核心解析能力。
 *
 * 【机制】
 *   AI 在回复中输出 `[STATUS:字段=值|字段=值|记录+=条目]` 标记，本引擎解析为
 *   结构化状态对象。支持：
 *   - 中英字段别名规范化（normalizeKey: trim+小写+去 _-空格 → FIELD_ALIASES 反查）
 *   - keyed 载荷（字段=值，| 分隔）+ legacy 定位置载荷（≥7段，含数值校验）双格式
 *   - 增量记录（`记录+=xxx` / record 字段，addRecord 去重保序）
 *   - 跨天状态滚动（isStoryDayChange 检测剧情日切换，仅携带 DAILY_CARRY_FIELDS）
 *   - 剧情日识别：日历日期 / 第N天（含中文数字 parseChineseInteger）/ Day N
 *
 * 【与源码差异】
 *   - 字段集通用化：u4d 是 4 十数字+护理域（体温/呼吸/循环…），本引擎保留别名校验
 *     框架但允许调用方注入自定义 FIELD_ALIASES，默认内置一组通用角色状态字段
 *   - 纯函数化：applyStatusUpdate 不依赖 createInitialStatus 的 DOM 上下文
 *   - parseChineseInteger 修正：源码对「零〇」digit 后无 unit 时按 digit 直加，
 *     本实现保持等价语义但加 guard 防 section 重复累计
 */

// ---------------------------------------------------------------------------
// 字段别名（默认通用角色状态域，可通过 makeParser 注入自定义别名覆盖）
// ---------------------------------------------------------------------------

/** 默认字段别名表：归一化 key → 规范字段名 */
const DEFAULT_FIELD_ALIASES = new Map([
    ['date', 'date'], ['日期', 'date'], ['time', 'date'], ['时间', 'date'],
    ['mood', 'mood'], ['心情', 'mood'], ['情绪', 'mood'], ['心境', 'mood'],
    ['state', 'state'], ['状态', 'state'], ['当前状态', 'state'],
    ['location', 'location'], ['地点', 'location'], ['位置', 'location'], ['所在', 'location'],
    ['energy', 'energy'], ['体力', 'energy'], ['能量', 'energy'], ['精力', 'energy'],
    ['health', 'health'], ['健康', 'health'], ['身体', 'health'],
    ['form', 'form'], ['形态', 'form'], ['外观', 'form'],
    ['growth', 'growth'], ['成长', 'growth'], ['阶段', 'growth'], ['phase', 'growth'],
    ['drive', 'drive'], ['驱动', 'drive'], ['目标', 'drive'],
    ['mental', 'mental'], ['精神', 'mental'], ['意识', 'mental'], ['认知', 'mental'],
    ['stress', 'stress'], ['应激', 'stress'], ['压力', 'stress'],
    ['record', 'record'], ['records', 'record'], ['记录', 'record'], ['长期记录', 'record'], ['log', 'record'],
]);

/** 状态标记：[STATUS:载荷]（不跨行） */
const STATUS_PATTERN = /\[STATUS\s*:\s*([^\]\r\n]+)\]/gi;

/** 跨天时携带的字段（其余随新一天重置为空） */
const DAILY_CARRY_FIELDS = ['growth', 'form'];

// ---------------------------------------------------------------------------
// key 规范化与别名反查
// ---------------------------------------------------------------------------

/** 归一化字段 key：trim + 小写 + 去空格/下划线/连字符 */
export function normalizeKey(key) {
    return String(key ?? '')
        .trim()
        .toLowerCase()
        .replace(/[ _-]/g, '');
}

// ---------------------------------------------------------------------------
// 中文数字解析
// ---------------------------------------------------------------------------

/**
 * 解析中文整数（零一二两三四五六七八九十百千）
 * @returns {number|null} 无法解析返回 null
 */
export function parseChineseInteger(value) {
    const digits = new Map([
        ['零', 0], ['〇', 0], ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4],
        ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9],
    ]);
    const units = new Map([['十', 10], ['百', 100], ['千', 1000]]);
    let section = 0;
    let digit = 0;
    let sawAny = false;

    for (const ch of String(value ?? '')) {
        if (digits.has(ch)) {
            digit = digits.get(ch);
            sawAny = true;
            continue;
        }
        const unit = units.get(ch);
        if (!unit) return null;
        section += (digit || 1) * unit;
        digit = 0;
        sawAny = true;
    }

    if (!sawAny) return null;
    return section + digit;
}

// ---------------------------------------------------------------------------
// 剧情日识别
// ---------------------------------------------------------------------------

/**
 * 提取剧情日唯一键（用于跨天检测）
 * @returns {string|null} 'calendar:Y-M-D' | 'story:N' | null
 */
export function getStoryDayKey(value) {
    const text = String(value ?? '').trim();
    if (!text || text === '未记录') return null;

    const compact = text.replace(/\s+/gu, '');
    const calendar = compact.match(/(\d{2,4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/u);
    if (calendar) {
        return `calendar:${Number(calendar[1])}-${Number(calendar[2])}-${Number(calendar[3])}`;
    }

    const numberedDay = compact.match(/第([\d零〇一二两三四五六七八九十百千]+)天/u);
    if (numberedDay) {
        const parsed = parseChineseInteger(numberedDay[1]);
        const key = parsed === null ? numberedDay[1] : String(parsed);
        return `story:${key}`;
    }

    const englishDay = compact.match(/(?:day|d)[-_:：]?([0-9]+)/iu);
    if (englishDay) {
        return `story:${Number(englishDay[1])}`;
    }

    return null;
}

/** 判断两个日期字段是否跨越剧情日 */
export function isStoryDayChange(previousDate, nextDate) {
    const prev = getStoryDayKey(previousDate);
    const next = getStoryDayKey(nextDate);
    return Boolean(prev && next && prev !== next);
}

// ---------------------------------------------------------------------------
// 解析器工厂（支持自定义字段别名）
// ---------------------------------------------------------------------------

/**
 * 创建状态解析器
 * @param {object} [options]
 * @param {Map<string,string>} [options.fieldAliases] 自定义别名表（归一化 key→规范字段）
 * @param {string[]} [options.initialFields] 初始状态包含的规范字段名列表
 * @param {string[]} [options.dailyCarryFields] 跨天携带字段（默认 growth/form）
 */
export function makeParser(options = {}) {
    const aliases = options.fieldAliases ?? DEFAULT_FIELD_ALIASES;
    const carryFields = options.dailyCarryFields ?? DAILY_CARRY_FIELDS;
    const initialFields = options.initialFields ??
        [...new Set([...aliases.values()])].filter(f => f !== 'record');

    const canonicalField = (key) => aliases.get(normalizeKey(key)) ?? null;

    const createInitialStatus = () => {
        const status = {};
        for (const f of initialFields) status[f] = '';
        status.records = [];
        return status;
    };

    const addRecord = (records, value) => {
        const text = String(value ?? '').trim();
        if (!text || records.includes(text)) return;
        records.push(text);
    };

    /** 解析 keyed 载荷：字段=值 | 字段+=记录 */
    const parseKeyedPayload = (payload) => {
        const updates = {};
        const records = [];
        let recognized = false;

        for (const part of String(payload).split('|')) {
            const match = part.match(/^\s*([^=:|]+?)\s*(\+)?\s*[=:：]\s*(.*?)\s*$/u);
            if (!match) continue;
            const rawKey = match[1].trim();
            const value = match[3].trim();
            const field = canonicalField(rawKey);
            if (!field || !value) continue;
            recognized = true;
            if (field === 'record') {
                const norm = normalizeKey(rawKey);
                const generic = norm === 'record' || norm === 'records' || norm === '记录' || norm === '长期记录' || norm === 'log';
                addRecord(records, generic ? value : `${rawKey}：${value}`);
            } else {
                updates[field] = value;
            }
        }

        return recognized ? { updates, records } : null;
    };

    /** 解析 legacy 定位置载荷（≥7段，第3/4段须为数值） */
    const parseLegacyPayload = (payload) => {
        const parts = String(payload).split('|').map(p => p.trim());
        if (parts.length < 7) return null;
        const nums = [Number(parts[2]), Number(parts[3])];
        if (nums.some(v => !Number.isFinite(v))) return null;
        const records = [];
        if (parts[6] && !/^无(?:变动|记录)?$/u.test(parts[6])) {
            records.push(`因果：${parts[6]}`);
        }
        return {
            updates: { date: parts[0], growth: parts[1], drive: parts[4], form: parts[5] },
            records,
            legacy: true,
        };
    };

    /** 解析单条 STATUS 载荷（keyed 优先，legacy 兜底） */
    const parseStatusPayload = (payload) =>
        parseKeyedPayload(payload) ?? parseLegacyPayload(payload);

    /** 从文本提取全部 STATUS 更新 */
    const findStatusUpdates = (text) => {
        const updates = [];
        for (const match of String(text).matchAll(STATUS_PATTERN)) {
            const parsed = parseStatusPayload(match[1]);
            if (parsed) updates.push({ ...parsed, raw: match[0] });
        }
        STATUS_PATTERN.lastIndex = 0;
        return updates;
    };

    /** 提取最新一条 STATUS 更新 */
    const findLatestStatus = (text) => {
        const updates = findStatusUpdates(text);
        return updates.at(-1) ?? null;
    };

    /** 跨天滚动：保留携带字段，其余重置 */
    const createNextDayStatus = (previous) => {
        const next = createInitialStatus();
        for (const f of carryFields) {
            next[f] = previous?.[f] ?? next[f];
        }
        next.records = [...(previous?.records ?? [])];
        return next;
    };

    /**
     * 应用一条解析结果到既有状态（不可变更新）
     * @param {object|null} previous 既有状态
     * @param {object|null} parsed   parseStatusPayload 的返回
     * @returns {object} 新状态
     */
    const applyStatusUpdate = (previous, parsed) => {
        const previousStatus = {
            ...createInitialStatus(),
            ...(previous ?? {}),
            records: [...(previous?.records ?? [])],
        };
        const nextDate = parsed?.updates?.date;
        const base = nextDate && isStoryDayChange(previousStatus.date, nextDate)
            ? createNextDayStatus(previousStatus)
            : previousStatus;
        const next = {
            ...base,
            ...(parsed?.updates ?? {}),
            records: [...base.records],
        };
        for (const record of parsed?.records ?? []) {
            addRecord(next.records, record);
        }
        return next;
    };

    return {
        STATUS_PATTERN,
        canonicalField,
        createInitialStatus,
        parseStatusPayload,
        findStatusUpdates,
        findLatestStatus,
        applyStatusUpdate,
        createNextDayStatus,
    };
}

/** 默认解析器实例（通用角色状态域） */
export const defaultParser = makeParser();

export const {
    parseStatusPayload,
    findStatusUpdates,
    findLatestStatus,
    applyStatusUpdate,
    createInitialStatus,
} = defaultParser;
