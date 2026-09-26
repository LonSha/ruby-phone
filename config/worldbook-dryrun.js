/* ========================================================
 * worldbook-dryrun.js — [v3.9.3] 世界书「干跑取数」：此刻**真正会被触发**的条目
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   本仓既有 `WorldbookManager.appendWorldbookMessages(appKey)` 把**用户在设置里
 *   手选的**世界书条目拼进 App 的 AI 请求 —— 那是「用户以为会看到的设定」。
 *   而酒馆主 AI 生成时看到的，是**按当前聊天上下文扫描后真正激活的**条目
 *   （关键词命中 / 位置 / 深度 / 概率 / 常驻）。两者不是同一件事：
 *     · 用户选了、但此刻不命中的条目 → 现在照样进 App 请求（**假在场**）；
 *     · 用户没选、但此刻命中（常驻或多书激活）的条目 → App 完全不知道（**真缺席**）。
 *   App 侧因此只能凭「设定集」说话，不能凭「此刻生效的设定」说话。
 *
 * 【本模块的职责（只取数、不判定、不注入）】
 *   调酒馆的 `getWorldInfoPrompt()` 做一次**干跑**（dry-run），把此刻会被触发的
 *   条目取出来，归一成稳定形状，并给出**归因**（读不到时如实分态）。
 *   本版**只落这一层**：不改任何 App 的现有请求、不动 `WorldbookManager` 的选书面。
 *
 * 【口径纪律（本仓反复治理的「读数说谎」，逐条对应）】
 *   ① **干跑不污染**：`getWorldInfoPrompt(..., isDryRun = true)` 的返回值用完即弃，
 *      本模块不写 `extensionSettings` / `chatMetadata` / 任何全局 —— 取数不是注入。
 *   ② **api 每次现取**：`api()` 每次调，**不缓存**模块或函数引用 ——
 *      酒馆可能换宿主、换版本、热重载；缓存会让「换了但读的还是旧的」静默发生。
 *   ③ **三态必须分形（本仓 O-1 / R3-D 的老账）**：`unsupported`（这版酒馆没这接口）
 *      与 `ok`（真读到 0 条）**必须不同形**。`unsupported` 时 `entries === null`
 *      而**不是** `[]` —— 「没给」与「给了 0」同形正是本仓抓过的缺陷。
 *   ④ **降级要留名**：干跑失败但有 `WORLD_INFO_ACTIVATED` 事件兜底时，记
 *      `activated-fallback` 而**不是** `ok` —— 兜底拿到的是「上一次生成时激活的」，
 *      不是「此刻会激活的」，两者语义不同，不得合并。
 *   ⑤ **纯函数化**：`api` / `ctx` 全可注入 ⇒ 可在最小宿主夹具下真跑、可被负控制打断。
 *
 * 纯 ESM export，零 window 依赖（一律走注入的 ctx）。
 * ======================================================== */

/** 状态文案表（与 `state` 一一对应；缺项即 UI 显示原始值，不静默） */
export const DRYRUN_REASONS = Object.freeze({
    ok: '已取到此刻会激活的世界书条目',
    unsupported: '这版酒馆没有 getWorldInfoPrompt 接口（不是「没有条目」，是「读不到」）',
    unavailable: '酒馆有接口，但这次干跑调用失败（条目未知，不是 0 条）',
    'activated-fallback': '干跑失败，退回上一次生成时被激活的条目（是「上一次」，不是「此刻」）'
});

/** 四态（顺序即「可信度」由高到低；UI 不得把后三态画成 ok） */
export const DRYRUN_STATES = Object.freeze(['ok', 'activated-fallback', 'unavailable', 'unsupported']);

/** key 只留前 6 个：与酒馆事件载荷一致，防止把整本书的键塞进内存 */
const KEY_PREVIEW = 6;
/** 单条正文上限（含 `\n`）；超出即如实截断，不静默丢 */
const CONTENT_MAX = 2000;
/** 单条注释上限 */
const COMMENT_MAX = 160;

function str(v, max) {
    const s = String(v == null ? '' : v);
    return max ? s.slice(0, max) : s;
}

/** 默认取数口：每次**现取**（纪律 ②，禁止模块级缓存） */
export function defaultLoreApi() {
    try {
        const c = globalThis?.SillyTavern?.getContext?.();
        if (!c) return null;
        return typeof c.getWorldInfoPrompt === 'function' ? c : null;
    } catch (_e) { return null; }
}

/** 默认上下文口 */
export function defaultLoreCtx() {
    try {
        return globalThis?.SillyTavern?.getContext?.() || null;
    } catch (_e) { return null; }
}

/**
 * 把一条世界书条目归一成稳定形状。
 * 只留只读面：`world` / `uid` / `comment` / `content` / `key`（截断预览）。
 * 空正文条目返回 null（调用方计数进 `dropped`，不静默当「一条」）。
 */
export function normalizeLoreEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const content = str(raw.content);
    if (!content.trim()) return null;
    return {
        world: str(raw.world, COMMENT_MAX),
        uid: Number.isInteger(raw.uid) ? raw.uid : (raw.uid == null ? null : str(raw.uid, 32)),
        comment: str(raw.comment, COMMENT_MAX),
        content: content.slice(0, CONTENT_MAX),
        key: Array.isArray(raw.key) ? raw.key.slice(0, KEY_PREVIEW).map((k) => str(k, 60)) : []
    };
}

/**
 * 归一酒馆干跑返回值。纯函数：不读全局、不抛。
 *
 * 酒馆形状（实测，见 `getWorldInfoPrompt` 的消费方惯例）：
 *   `{ worldInfoBefore, worldInfoAfter, worldInfoDepth: [{ entries: [...] }],
 *      anBefore: [], anAfter: [] }`
 *
 * @returns {{ entries: Array, sections: {before:string, after:string, depth:string}, dropped:number }}
 */
export function normalizeDryRunResult(res) {
    const out = { entries: [], sections: { before: '', after: '', depth: '' }, dropped: 0 };
    if (!res || typeof res !== 'object') return out;
    out.sections.before = str(res.worldInfoBefore);
    out.sections.after = str(res.worldInfoAfter);
    const depthEntries = Array.isArray(res.worldInfoDepth)
        ? res.worldInfoDepth.flatMap((d) => (Array.isArray(d?.entries) ? d.entries : []))
        : [];
    out.sections.depth = depthEntries.map((e) => str(e?.content)).filter(Boolean).join('\n\n');
    /* 条目对象可能出现三处：深度段（主来源）/ 顶层 `entries`（部分版本外供）/
     *   `anBefore|anAfter`（附注条目）。三处都收，去重后再归一。 */
    const ann = [...(Array.isArray(res.anBefore) ? res.anBefore : []), ...(Array.isArray(res.anAfter) ? res.anAfter : [])];
    const top = Array.isArray(res.entries) ? res.entries : [];
    const seen = new Set();
    const all = [];
    for (const raw of [...depthEntries, ...top, ...ann]) {
        const id = raw && typeof raw === 'object'
            ? (raw.uid != null ? `u:${raw.uid}` : `c:${str(raw.comment)}|${str(raw.content).slice(0, 80)}`)
            : `x:${String(raw)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        all.push(raw);
    }
    for (const raw of all) {
        const n = normalizeLoreEntry(raw);
        if (n) out.entries.push(n); else out.dropped += 1;
    }
    return out;
}

/** 读前先探形态：没有接口 ⇒ `unsupported`（**不是**「0 条」） */
export function dryRunSupport(api) {
    return !!(api && typeof api.getWorldInfoPrompt === 'function');
}

/**
 * 干跑取数。**只读**，不写任何全局。
 *
 * @param {object} [o]
 * @param {object} [o.ctx]   酒馆上下文（默认现取）
 * @param {object} [o.api]   取数口（默认现取）；负控制的打断点
 * @param {number} [o.maxContext] 传给酒馆的上下文长度（默认 ctx.maxContext 或 8192）
 * @param {Array}  [o.activated] 事件兜底：`WORLD_INFO_ACTIVATED` 记录下来的条目
 * @returns {Promise<{state:string, reason:string, entries:Array|null, sections:object, at:number, dropped:number, floorCount:number}>}
 */
export async function collectDryRunEntries(o = {}) {
    const ctx = o.ctx !== undefined ? o.ctx : defaultLoreCtx();
    const api = o.api !== undefined ? o.api : defaultLoreApi();
    const at = Number(o.at) || 0;
    const base = { reason: '', at, dropped: 0, floorCount: 0, sections: { before: '', after: '', depth: '' } };
    if (!dryRunSupport(api)) {
        /* 纪律 ③：读不到 ⇒ entries 为 null，绝不写成 [] */
        return { ...base, state: 'unsupported', reason: DRYRUN_REASONS.unsupported, entries: null };
    }
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const floors = chat.filter((m) => m && !m.is_system && !m?.extra?.hidden && str(m.mes).trim());
    /* 酒馆惯例：最近的楼层在前（reverse）—— 与 P-A 的 dry-run 同款，保持与宿主一致 */
    const chatForWI = floors.map((m) => `${str(m.name) || (m.is_user ? 'user' : 'char')}: ${str(m.mes)}`).reverse();
    const maxContext = Number(o.maxContext) || Number(ctx?.maxContext) || 8192;
    const ch = ctx?.characterId != null ? ctx?.characters?.[ctx.characterId] : null;
    const scanData = {
        trigger: 'normal',
        personaDescription: '',
        characterDescription: str(ch?.description),
        characterPersonality: str(ch?.personality),
        characterDepthPrompt: str(ch?.data?.extensions?.depth_prompt?.prompt),
        scenario: str(ch?.scenario),
        creatorNotes: str(ch?.data?.creator_notes)
    };
    try {
        const res = await api.getWorldInfoPrompt(chatForWI, maxContext, true, scanData);
        const norm = normalizeDryRunResult(res);
        return {
            state: 'ok',
            reason: DRYRUN_REASONS.ok,
            entries: norm.entries,
            sections: norm.sections,
            at,
            dropped: norm.dropped,
            floorCount: floors.length
        };
    } catch (_e) {
        /* 纪律 ④：降级要留名 —— 有事件兜底就标 activated-fallback，否则 unavailable */
        const fb = Array.isArray(o.activated) ? o.activated.map(normalizeLoreEntry).filter(Boolean) : [];
        if (fb.length) {
            return {
                state: 'activated-fallback',
                reason: DRYRUN_REASONS['activated-fallback'],
                entries: fb,
                sections: { before: '', after: '', depth: '' },
                at,
                dropped: 0,
                floorCount: floors.length
            };
        }
        return { ...base, state: 'unavailable', reason: DRYRUN_REASONS.unavailable, entries: null, floorCount: floors.length };
    }
}

/**
 * 记账 `WORLD_INFO_ACTIVATED` 载荷（只归一与截断，不做判断）。
 * 返回**新数组**（不改入参），供事件监听一行接上。
 */
export function recordActivated(prev, payload) {
    if (!Array.isArray(payload)) return Array.isArray(prev) ? prev : [];
    const out = payload.map(normalizeLoreEntry).filter(Boolean);
    return out.length ? out : (Array.isArray(prev) ? prev : []);
}

/**
 * 投影：给 App 侧一段可读的「此刻生效的设定」文本块。
 * 空/不可读时返回 ''（调用方按 `state` 自行决定说什么，本函数不替它说）。
 */
export function dryRunLoreBlock(snapshot, o = {}) {
    if (!snapshot || !Array.isArray(snapshot.entries) || !snapshot.entries.length) return '';
    const maxChars = Number(o.maxChars) || 6000;
    const parts = [];
    let used = 0;
    for (const e of snapshot.entries) {
        const head = e.comment ? `【${e.comment}】\n` : '';
        const piece = head + e.content;
        if (used + piece.length > maxChars) break;
        parts.push(piece);
        used += piece.length;
    }
    return parts.join('\n\n');
}

/**
 * 给 UI 的一句话（含证据：条数 / 楼层数 / 丢弃数）。
 * 四态各有各的话；**读不到时绝不说「没有条目」**。
 */
export function dryRunFace(snapshot) {
    const s = snapshot || {};
    const state = DRYRUN_STATES.includes(s.state) ? s.state : 'unsupported';
    const reason = s.reason || DRYRUN_REASONS[state];
    if (state === 'ok' || state === 'activated-fallback') {
        const n = Array.isArray(s.entries) ? s.entries.length : 0;
        const tail = s.dropped ? `（另有 ${s.dropped} 条空正文被丢弃）` : '';
        return { state, label: `${n} 条${state === 'ok' ? '' : '（事件兜底）'}`, detail: `${reason}${tail}` };
    }
    return { state, label: '取不到', detail: reason };
}
