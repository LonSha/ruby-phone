/* ========================================================
 *  RubyPhone · 三级记忆模型（A2）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   本仓记忆现在**只有会话级**：`/^memory_/` 全部判会话隔离，一个 chat 一个桶。
 *   这条口径本身是对的（换会话不串味是 v2.8.10 事故换来的），但它漏掉了一整类东西：
 *
 *     「无论在哪张卡、哪个存档里，我和**这个人**经历过的事」
 *
 *   典型形态：用户开了三张卡，卡甲里和「周砚」在城西避过雨，
 *   切到卡乙后周砚又出现了 —— 此时她不该表现得像第一次见面。
 *   会话级桶在这个场景下**结构性失效**：它答的是「这个 chat 记过什么」，
 *   而问题问的是「这个角色记过什么」。
 *
 * 【三级（三个问题，答案不同，故不得合并）】
 *   ① `world`  —— 跨卡共同层：与具体角色无关的世界事实（在哪座城市、什么年份、
 *                  用户自己的设定）。键只按 user 走。
 *   ② `shared` —— 跨卡角色层：**按角色名**聚合的共同经历。这是本模块的主战场。
 *   ③ `save`   —— 会话存档层：维持现有的会话隔离语义，**本模块不接管**它，
 *                  只是在检索时把它作为第三档拼进来（一档都不许丢）。
 *
 * 【存储（只加一个键，这是刻意的）】
 *   三级共用**一个**全局桶 `phone_shared_memory_v1`，内部按 `world / shared:<name>`
 *   分槽。理由是键面成本：每加一个 storage 键，就要在 scripts/keys-audit.mjs 的
 *   `KEY_REGISTRY` 里回答归属、在 `config/storage.js` 的 `CHAT_DATA_PATTERNS` 里
 *   与机制对齐（K1/K2/K3 三道判据盯着这件事）。加三个键就要回答三次，
 *   而它们三者的归属答案是同一个（global）—— 那就没有理由拆成三个。
 *
 * 【为什么必须是 global scope（这条会碰存储铁律，故写清楚）】
 *   跨卡共同层的**全部价值**就在于它不被会话边界切碎。若把它登记成 chat scope，
 *   换卡即丢 —— 那它就是第三个会话级桶，名字叫 shared 而已。
 *   故登记为 `scope: 'global'`，并在 keys-audit 里如实写明它是「跨会话聚合层」。
 *   同时：**写入这条桶的东西必须是用户能清掉的**（clear() 必须存在且真的清），
 *   否则一个全局桶会变成一块用户看不见也删不掉的污渍。
 *
 * 【不做什么】
 *   · 不做自动同步：不会把会话级记忆自动提升为跨卡记忆。那需要判「什么值得跨卡」，
 *     而那是判断，不是索引 —— 由显式调用（结构化记忆块 / 人工纠错通道）触发。
 *   · 不做合并去重跨卡：同一件事在两张卡里各记一遍，本模块**两条都留**
 *     （它们的上下文不同，合并会把「在哪张卡里发生的」这个信息抹掉）。
 * ============================================================ */

/** 唯一 storage 键。跨会话聚合层。 */
export const SHARED_MEMORY_KEY = 'phone_shared_memory_v1';

/** 桶的结构版本：形状变了就抬这个数，读到时版本不同即走迁移分支而不是硬读。 */
export const SCHEMA_VERSION = 1;

export const LEVELS = Object.freeze({ WORLD: 'world', SHARED: 'shared', SAVE: 'save' });

/** 单槽条数上限（超出丢最旧的）。全局桶会长在用户的手机里三年，
 *  不设上限的桶迟早变成一个几十 MB 的 JSON —— 而它的读取发生在会话切换的热路径上。 */
export const MAX_PER_BUCKET = 400;
export const MAX_TEXT_CHARS = 400;

function nowIso() {
    return new Date().toISOString();
}

function str(v, max = MAX_TEXT_CHARS) {
    return String(v ?? '').trim().slice(0, max);
}

/** 空桶。**每一次**返回新对象（不可共享同一个字面量 —— 那会让两个会话拿到同一份引用）。 */
export function emptyStore() {
    return { schema: SCHEMA_VERSION, world: [], shared: {}, updatedAt: nowIso() };
}

/** 归一化读入：认 null / 字符串 / 老形状，一律返回可安全写入的桶。 */
export function normalizeStore(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_e) { data = null; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyStore();
    const out = emptyStore();
    if (Number(data.schema) === SCHEMA_VERSION) out.schema = SCHEMA_VERSION;
    if (Array.isArray(data.world)) {
        out.world = data.world.filter((e) => e && str(e.text)).slice(-MAX_PER_BUCKET);
    }
    if (data.shared && typeof data.shared === 'object' && !Array.isArray(data.shared)) {
        for (const name of Object.keys(data.shared)) {
            const list = data.shared[name];
            if (!Array.isArray(list)) continue;
            const clean = list.filter((e) => e && str(e.text)).slice(-MAX_PER_BUCKET);
            if (clean.length) out.shared[name] = clean;
        }
    }
    if (data.updatedAt) out.updatedAt = String(data.updatedAt);
    return out;
}

/** 角色名归一：大小写、首尾空白、全角空格。**不做**别名合并（那需要一张人工表）。 */
export function nameKey(name) {
    return str(name, 80).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 造一条记录。`cardId` / `chatId` 是**来源标记**，保留它们是为了让「这条是从哪来的」
 *  永远可查 —— 跨卡聚合最怕的就是变成一堆无出处的句子。 */
export function makeRecord(text, meta = {}) {
    const body = str(text);
    if (!body) return null;
    const rec = { text: body, at: nowIso() };
    if (meta.cardId) rec.cardId = str(meta.cardId, 80);
    if (meta.chatId) rec.chatId = str(meta.chatId, 80);
    if (meta.kind) rec.kind = str(meta.kind, 24);
    if (meta.source) rec.source = str(meta.source, 40);
    return rec;
}

/**
 * 写入。
 * @returns {{store:object, added:boolean, reason:string, bucket:string}}
 *   `reason`：`'ok'` / `'empty-text'` / `'duplicate'`。三态分列。
 */
export function remember(store, level, text, meta = {}) {
    const data = normalizeStore(store);
    const rec = makeRecord(text, meta);
    if (!rec) return { store: data, added: false, reason: 'empty-text', bucket: '' };
    let bucket = LEVELS.WORLD;
    if (level === LEVELS.SHARED) {
        const key = nameKey(meta.name || meta.character || '');
        if (!key) return { store: data, added: false, reason: 'empty-text', bucket: '' };
        bucket = 'shared:' + key;
        if (!Array.isArray(data.shared[key])) data.shared[key] = [];
        const list = data.shared[key];
        /* 去重口径：**同一条文本 + 同来源** 才算重复。跨来源的同一句话要两条都留
         *（见文件头「不做什么」：合并会抹掉「在哪张卡里发生的」）。 */
        const dup = list.some((e) => str(e.text) === rec.text
            && String(e.cardId || '') === String(rec.cardId || '')
            && String(e.chatId || '') === String(rec.chatId || ''));
        if (dup) return { store: data, added: false, reason: 'duplicate', bucket: bucket };
        list.push(rec);
        if (list.length > MAX_PER_BUCKET) list.splice(0, list.length - MAX_PER_BUCKET);
    } else {
        const list = data.world;
        const dup = list.some((e) => str(e.text) === rec.text
            && String(e.cardId || '') === String(rec.cardId || ''));
        if (dup) return { store: data, added: false, reason: 'duplicate', bucket: bucket };
        list.push(rec);
        if (list.length > MAX_PER_BUCKET) list.splice(0, list.length - MAX_PER_BUCKET);
    }
    data.updatedAt = nowIso();
    return { store: data, added: true, reason: 'ok', bucket: bucket };
}

/** 读：取某档的全部记录（不排序 —— 排序是检索的事，本函数只负责取）。 */
export function recordsOf(store, level, name = '') {
    const data = normalizeStore(store);
    if (level === LEVELS.SHARED) {
        const key = nameKey(name);
        return key && Array.isArray(data.shared[key]) ? data.shared[key].slice() : [];
    }
    if (level === LEVELS.SAVE) return [];   /* 存档层由既有会话桶承载，本模块不接管 */
    return data.world.slice();
}

/**
 * 三级检索：把三档各自的命中拼起来，并**逐档标注来源**。
 *
 * 为什么逐档标注而不是揉成一列：诊断页必须能回答「这条是从跨卡层来的还是本次会话来的」，
 * 揉成一列之后，同一个角色在两张卡里的两条记录会长得一模一样而无法区分。
 *
 * @param {object} store 全局桶
 * @param {Array} saveRecords 会话层的记录（调用方从既有桶取来传入 —— 本模块不读它）
 * @param {{text?:string,name?:string,limit?:number,score?:Function}} query
 */
export function recall(store, saveRecords, query = {}) {
    const limit = Number.isFinite(query.limit) ? query.limit : 8;
    const score = typeof query.score === 'function' ? query.score : null;
    const bag = [];
    const push = (level, label, records) => {
        for (const rec of (Array.isArray(records) ? records : [])) {
            const s = score ? Number(score(query.text || query.name || '', str(rec.text))) : 0;
            bag.push({ level: level, label: label, text: str(rec.text), score: Number.isFinite(s) ? s : 0, at: rec.at || '', cardId: rec.cardId || '', chatId: rec.chatId || '' });
        }
    };
    push(LEVELS.SHARED, '共同', recordsOf(store, LEVELS.SHARED, query.name || ''));
    push(LEVELS.WORLD, '世界', recordsOf(store, LEVELS.WORLD));
    push(LEVELS.SAVE, '本档', saveRecords);
    bag.sort((a, b) => (b.score - a.score) || String(a.at).localeCompare(String(b.at)));
    const top = bag.slice(0, Math.max(0, limit));
    const counts = { shared: 0, world: 0, save: 0 };
    for (const row of bag) counts[row.level] += 1;
    return { items: top, counts: counts, total: bag.length };
}

/** 清空（用户必须能清掉全局桶 —— 见文件头）。`level` 省略即全清。 */
export function clear(store, level = null, name = '') {
    const data = normalizeStore(store);
    if (level === LEVELS.WORLD) data.world = [];
    else if (level === LEVELS.SHARED) {
        const key = nameKey(name);
        if (key) delete data.shared[key];
    } else if (level === null) return emptyStore();
    data.updatedAt = nowIso();
    return data;
}

/** 一行读数：三档分列（共同 / 世界 / 本档），不得压成一个总数。 */
export function sharedMemoryLine(result) {
    if (!result || typeof result !== 'object') return '记忆三档：无读数';
    const c = result.counts || {};
    return '记忆三档：共同 ' + (c.shared || 0) + ' · 世界 ' + (c.world || 0)
        + ' · 本档 ' + (c.save || 0) + '（取前 ' + (result.items || []).length + ' 条）';
}

export default {
    SHARED_MEMORY_KEY, SCHEMA_VERSION, LEVELS, MAX_PER_BUCKET,
    emptyStore, normalizeStore, nameKey, makeRecord, remember, recordsOf, recall, clear, sharedMemoryLine
};