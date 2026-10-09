/* ========================================================
 *  RubyPhone · 世界书写入的纯函数核心（A1）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   `config/worldbook-manager.js` 一直以来**只有读**：它能把世界书列出来、
 *   读出条目、按选中面拼注入消息，但一个字节也写不回去。
 *   后果是：记忆层记得的东西（共同经历、承诺、关系变化）永远停在
 *   「本机某个桶里」，用户无法用酒馆原生的世界书编辑器查看、修改、导出，
 *   换设备 / 换前端就全丢。
 *
 *   本模块只做**纯函数**那一半：怎么合、怎么去重、哪条该跳过。
 *   与宿主交互的那一半（loadWorldInfo / saveWorldInfo / updateWorldInfoList）
 *   留在 `config/worldbook-manager.js` 里 —— 因为这半边的可测性完全靠「无 IO」，
 *   把它和 fetch 混在一起，它就只能靠真宿主才验得动，而本仓没有真宿主。
 *
 * 【两条铁律（写错任何一条都会毁数据）】
 *   ① **绝不覆盖**：合并只做「追加」与「按 uid 更新**我写的**那几条」。
 *      用户在自己的世界书里手写的条目，哪怕内容与我要写的一模一样，
 *      也**不得**被我改写（他的版本可能带自己的注释与键）。
 *   ② **按内容去重**：同一段内容重复写入是本仓最容易被引入的 bug 形态
 *      （每次生成都追加一次 ⇒ 玩三小时世界书里同一段话出现 200 遍）。
 *      去重的口径是**归一化后的内容**，不是标题、不是键 —— 标题会变、键会撞，
 *      只有内容本身是「这句话说过了没有」的判据。
 *
 * 【与 ST 条目形状的边界】
 *   本模块认 ST 的条目形状（`{uid, comment, content, key, keysecondary, disable,
 *   constant, ...}`），但**不校验、不补齐** ST 的全部字段：ST 各版本的字段集
 *   在变（`order` / `position` / `depth` / `probability` / `group` …），
 *   在此处硬编码一份「完整字段表」等于把 ST 的版本演进变成我的 bug。
 *   故：我只写我认识的字段，其余原样带过（`...extra`）。
 * ============================================================ */

/** 归一化：用于**判等**，不用于写回。写回一律用原文（归一化过的文本写进世界书
 *  会把用户的全角标点、缩进、换行全吃掉 —— 那是一种静默的数据损坏）。 */
export function normalizeForCompare(text) {
    return String(text ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, '')
        .trim();
}

/** 内容指纹。写成导出的，是为了让套件与负控制能对**同一份指纹口径**做断言 ——
 *  若指纹在套件里另写一遍，两边一旦分叉就会「判据绿而现场重复」。 */
export function contentKeyOf(entry) {
    const text = entry && typeof entry === 'object' ? entry.content : entry;
    return normalizeForCompare(text).slice(0, 800);
}

/** ST 的条目表：可能是数组、可能是 `{uid: entry}` 映射。两种都要认。 */
export function entriesOf(data) {
    const raw = data && typeof data === 'object' ? (data.entries || data) : null;
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw)) return raw.filter((e) => e && typeof e === 'object');
    return Object.values(raw).filter((e) => e && typeof e === 'object');
}

/** 取当前最大 uid + 1（ST 用 uid 作键，撞号会覆盖别人的条目）。 */
export function nextUid(entries) {
    let max = 0;
    for (const e of entries) {
        const uid = Number(e && e.uid);
        if (Number.isFinite(uid) && uid > max) max = Math.floor(uid);
    }
    return max + 1;
}

/**
 * 合并。
 *
 * @param {object|Array} existing 现世界书数据（或条目数组）
 * @param {Array} incoming 待写条目：`{comment, content, key?, keysecondary?, constant?, disable?, source?}`
 * @param {{mode?:'append'|'update-by-uid', forceRewriteSource?:boolean, maxEntries?:number}} options
 * @returns {{entries:Array, added:Array, skipped:Array, replaced:Array, uidBase:number}}
 *
 * `skipped` 里每条带 `reason`：`'duplicate-content'`（内容已在）/ `'empty-content'`（空内容我不写）
 * / `'cap-reached'`（超出 maxEntries）。三条的处置方向不同，故不压成一格。
 */
export function mergeEntries(existing, incoming, options = {}) {
    const mode = options.mode === 'update-by-uid' ? 'update-by-uid' : 'append';
    const cap = Number.isFinite(options.maxEntries) ? options.maxEntries : 0;
    const list = Array.isArray(existing) ? existing.slice() : entriesOf(existing).slice();
    const byContent = new Map();
    const byUid = new Map();
    list.forEach((e, i) => {
        const ck = contentKeyOf(e);
        if (ck && !byContent.has(ck)) byContent.set(ck, i);
        const uid = Number(e.uid);
        if (Number.isFinite(uid)) byUid.set(Math.floor(uid), i);
    });

    const added = [];
    const skipped = [];
    const replaced = [];
    let uid = nextUid(list);

    for (const raw of (Array.isArray(incoming) ? incoming : [])) {
        const item = raw && typeof raw === 'object' ? raw : { content: String(raw ?? '') };
        const content = String(item.content ?? '');
        if (!normalizeForCompare(content)) {
            skipped.push({ comment: String(item.comment ?? ''), reason: 'empty-content' });
            continue;
        }
        if (cap > 0 && list.length >= cap) {
            skipped.push({ comment: String(item.comment ?? ''), reason: 'cap-reached' });
            continue;
        }

        if (mode === 'update-by-uid') {
            const targetUid = Number(item.uid);
            if (Number.isFinite(targetUid) && byUid.has(Math.floor(targetUid))) {
                const at = byUid.get(Math.floor(targetUid));
                const prev = list[at];
                /* ★ 铁律 ①：默认**只**更新我自己的标记面（source 相同），
                 *   其余字段一律保留用户现值。`forceRewriteSource` 是显式的越权口，
                 *   只在调用方明确知道「这条就是我上次写的」时才传。 */
                const sameSource = String(prev.source ?? '') === String(item.source ?? '');
                if (sameSource || options.forceRewriteSource === true) {
                    list[at] = { ...prev, ...item, uid: Math.floor(targetUid) };
                    replaced.push({ uid: Math.floor(targetUid), comment: String(item.comment ?? prev.comment ?? '') });
                    const ck = contentKeyOf(list[at]);
                    if (ck && !byContent.has(ck)) byContent.set(ck, at);
                    continue;
                }
            }
        }

        const ck = contentKeyOf(item);
        if (byContent.has(ck)) {
            skipped.push({ comment: String(item.comment ?? ''), reason: 'duplicate-content' });
            continue;
        }
        const entry = {
            uid: uid,
            comment: String(item.comment ?? ('记忆 ' + uid)),
            content: content,
            key: Array.isArray(item.key) ? item.key.slice() : (item.key ? [String(item.key)] : []),
            keysecondary: Array.isArray(item.keysecondary) ? item.keysecondary.slice() : [],
            disable: item.disable !== undefined ? !!item.disable : false,
            constant: item.constant !== undefined ? !!item.constant : false,
            ...(item.extra && typeof item.extra === 'object' ? item.extra : {})
        };
        if (item.source) entry.source = String(item.source);
        list.push(entry);
        byContent.set(contentKeyOf(entry), list.length - 1);
        byUid.set(uid, list.length - 1);
        added.push({ uid: uid, comment: entry.comment });
        uid += 1;
    }

    return { entries: list, added: added, skipped: skipped, replaced: replaced, uidBase: nextUid(list) };
}

/** 写回前的自检：把条目表转成 ST 期望的 `{uid: entry}` 映射（数组下标当 uid 会串位）。 */
export function toEntriesMap(entries) {
    const out = {};
    for (const e of entries) {
        const uid = Number(e && e.uid);
        out[String(Number.isFinite(uid) ? Math.floor(uid) : 0)] = e;
    }
    return out;
}

/** 一行读数（诊断页 / 日志）。三态分列，不得压成「写了 N 条」。 */
export function worldbookWriteLine(result) {
    if (!result || typeof result !== 'object') return '世界书写入：无读数';
    const dup = result.skipped.filter((s) => s.reason === 'duplicate-content').length;
    const empty = result.skipped.filter((s) => s.reason === 'empty-content').length;
    const cap = result.skipped.filter((s) => s.reason === 'cap-reached').length;
    const parts = ['新增 ' + result.added.length, '更新 ' + result.replaced.length];
    if (dup) parts.push('跳过重复 ' + dup);
    if (empty) parts.push('跳过空内容 ' + empty);
    if (cap) parts.push('超上限未写 ' + cap);
    return '世界书写入：' + parts.join(' · ');
}

export default { normalizeForCompare, contentKeyOf, entriesOf, nextUid, mergeEntries, toEntriesMap, worldbookWriteLine };