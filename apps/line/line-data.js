/* ========================================================
 * line-data.js — [v4.159.0 · 第 2 层最后一件] LINE 仿真内核（纯函数）
 *
 * 【本件治的欠账】TODO 的「第 2 / 3 层」清单里，淘宝 / 恋爱空间 / 约会 /
 *   游戏厅 / 老福特 / Pixiv / 杂志七件都已落地，**只剩 LINE**（源 167474 字节，
 *   在 nuo3/perigee 两侧，本机没有那份源）。故本件按本仓「独立实现」定位，
 *   **取机制不搬代码**：LINE 的四个真机制 —— ① 1:1 / 群 / 官方三种房间；
 *   ② 每房间消息环形上限；③ 已读回执（读到第几条，不是布尔）；④ 贴图包。
 *
 * 【四条「不缝」逐条写明（源有、本仓不能有）】
 *   ① 源自己发请求拉贴图与历史（`fetch` + 图床 URL）⇒ 本件零网络、零 URL，
 *      贴图只是一张**静态的 id → 名字表**，图由宿主/CSS 决定；
 *   ② 源把「已读」做成布尔并写进宿主角色对象 ⇒ 本件只记**本会话的读游标**
 *      （`readUpTo` 楼层号），且不碰任何角色对象；
 *   ③ 源起常驻定时器轮询「有没有新消息」⇒ 本件零定时器：新消息由用户/生成侧
 *      调 `appendMessage` 进来，界面只在 render 时现取；
 *   ④ 源按时间重排全局消息流（一份大数组）⇒ 本件按房间分账 + 每房间环形上限，
 *      跨房间只出**时间线读数**（最近 N 条，不复制正文）。
 *
 * 【三态不塌】存储读不出 = `storage_absent`（拿不到读数）；读到但空 = `empty`
 *   （真的还没有会话）；有账 = `ready`。三者文案互不相同，界面各自成形。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/** 归因文案：值是**稳定串**（视图按值取图标与标签，不按中文措辞比）。 */
export const LINE_REASONS = Object.freeze({
    ready: 'line-has-rooms',
    empty: 'line-no-rooms',
    storage_absent: 'line-storage-absent',
});

/** 上限**全部**是读数（不是注释）：超了就这么办，界面上也照这么说。 */
export const LINE_LIMITS = Object.freeze({
    rooms: 24,          // 会话数上限（超出拒建并明说）
    messages: 200,      // 每会话消息上限（环形，最早的先丢）
    text: 1000,         // 单条正文上限（超出截断并留痕）
    members: 12,        // 群成员上限（名字表，不读角色对象）
    timeline: 10,       // 时间线取样条数
});

/** 房间类型：三态（1:1 / 群 / 官方）。官方号不参与「未读」计数（那是号的广播）。 */
export const LINE_KINDS = Object.freeze(['dm', 'group', 'official']);

/** 贴图包：**纯静态 id → 名字**（零 URL、零网络）。源那些图床链接一条都不进来。 */
export const LINE_STICKERS = Object.freeze([
    { id: 'sb-hi', name: '打招呼', pack: '日常' },
    { id: 'sb-ok', name: '成交', pack: '日常' },
    { id: 'sb-thx', name: '谢谢', pack: '日常' },
    { id: 'sb-nya', name: '喵', pack: '猫猫' },
    { id: 'sb-wow', name: '哇', pack: '猫猫' },
    { id: 'sb-sad', name: '垂头', pack: '猫猫' },
    { id: 'sb-nod', name: '点头', pack: '动作' },
    { id: 'sb-wave', name: '挥手', pack: '动作' },
    { id: 'sb-hug', name: '抱抱', pack: '动作' },
    { id: 'sb-zzz', name: '困了', pack: '状态' },
    { id: 'sb-rain', name: '下雨了', pack: '状态' },
    { id: 'sb-spark', name: '闪亮', pack: '状态' },
].map(Object.freeze));

export const LINE_DEFAULT_SETTINGS = Object.freeze({
    injectToPrompt: true,   // 是否把最近消息作为事实注入生成侧
    readReceiptOn: true,    // 已读回执照不照实说
    officialUnread: false,  // 官方号算不算未读
});

/** 设置归一：只认三个布尔，缺一个就用默认（不猜成 true）。 */
export function defaultLineSettings() { return { ...LINE_DEFAULT_SETTINGS }; }

export function normalizeLineSettings(raw) {
    const d = LINE_DEFAULT_SETTINGS;
    const src = (raw && typeof raw === 'object') ? raw : {};
    const pick = (k) => (typeof src[k] === 'boolean' ? src[k] : d[k]);
    return { injectToPrompt: pick('injectToPrompt'), readReceiptOn: pick('readReceiptOn'), officialUnread: pick('officialUnread') };
}

/** 空账：`{ rooms: [], rev: 0 }`。`rev` 是写序号（视图用它判断「是不是这一版」）。 */
export function emptyLineState() { return { rooms: [], rev: 0 }; }

const isStr = (v) => typeof v === 'string' && v.length > 0;
/* 数值取值走全仓唯一实现 config/num-gate.js（v3.12.0 纪律：
 *   不得就地再写一份 Number.isFinite(Number(x)) 弱口径）。
 *   本文件只需「取不到就用缺省」这一种语义，故包一层带缺省值的壳。 */
const numOf = (v, d) => { const n = numOrNull(v); return n === null ? d : n; };

function normalizeMessage(m) {
    if (!m || typeof m !== 'object') return null;
    const id = isStr(m.id) ? m.id : '';
    const from = isStr(m.from) ? m.from.slice(0, 40) : '';
    const sticker = isStr(m.sticker) ? m.sticker : '';
    const rawText = isStr(m.text) ? m.text : '';
    if (!id || !from) return null;
    if (!rawText && !sticker) return null;   // 既没正文也没贴图 ⇒ 不是一条消息
    return {
        id,
        from,
        text: rawText.slice(0, LINE_LIMITS.text),
        sticker,
        ts: numOf(m.ts, 0),
        recalled: m.recalled === true,
        truncated: rawText.length > LINE_LIMITS.text,
    };
}

function normalizeRoom(r) {
    if (!r || typeof r !== 'object') return null;
    const id = isStr(r.id) ? r.id : '';
    if (!id) return null;
    const kind = LINE_KINDS.includes(r.kind) ? r.kind : 'dm';
    const members = Array.isArray(r.members)
        ? r.members.filter(isStr).map((x) => x.slice(0, 40)).slice(0, LINE_LIMITS.members)
        : [];
    const names = isStr(r.name) ? r.name.slice(0, 60) : (members[0] || id);
    const msgs = [];
    const seen = new Set();
    for (const raw of (Array.isArray(r.messages) ? r.messages : [])) {
        const m = normalizeMessage(raw);
        if (!m || seen.has(m.id)) continue;   // 坏行丢掉，但**计数留痕**（见 droppedOf）
        seen.add(m.id);
        msgs.push(m);
    }
    const clamped = msgs.slice(-LINE_LIMITS.messages);
    return {
        id,
        name: names,
        kind,
        members,
        messages: clamped,
        readUpTo: isStr(r.readUpTo) ? r.readUpTo : '',
        dropped: Math.max(0, msgs.length - clamped.length),
        muted: r.muted === true,
    };
}

/** 归一整份账。返回新对象（不改入参）：`{ rooms, rev }`。 */
export function normalizeLineState(raw) {
    try {
        const src = (raw && typeof raw === 'object') ? raw : {};
        const seen = new Set();
        const rooms = [];
        for (const r of (Array.isArray(src.rooms) ? src.rooms : [])) {
            const room = normalizeRoom(r);
            if (!room || seen.has(room.id)) continue;
            seen.add(room.id);
            rooms.push(room);
        }
        return { rooms: rooms.slice(-LINE_LIMITS.rooms), rev: numOf(src.rev, 0) };
    } catch (_e) {
        return emptyLineState();
    }
}

/** 账里「有没有东西」的**唯一判据**（视图与 App 共用，不许各写一份）。 */
export function hasAny(state) {
    try {
        return !!(state && Array.isArray(state.rooms) && state.rooms.length > 0);
    } catch (_e) { return false; }
}

/** 归因三态（存储读不出 / 读到但空 / 有账）。 */
export function readLineFace(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    if (!o.storageOk) return LINE_REASONS.storage_absent;
    return o.hasAny ? LINE_REASONS.ready : LINE_REASONS.empty;
}

/** 类型 → 人话（未知类型不猜，直接说「未知」）。 */
export function describeKind(kind) {
    if (kind === 'dm') return '单聊';
    if (kind === 'group') return '群聊';
    if (kind === 'official') return '官方号';
    return '未知类型';
}

/** 贴图 id → 贴图（找不到就是 `null`：界面上「没有这张贴图」≠「加载失败」）。 */
export function stickerById(id) {
    if (!isStr(id)) return null;
    for (const s of LINE_STICKERS) if (s.id === id) return s;
    return null;
}

/** 时间读数：只到「几点几分」，跨天补「昨天 / N 天前」（不猜时区，用本地钟）。 */
export function formatClock(ts) {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return '没记时间';
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const hm = hh + ':' + mm;
    try {
        const now = new Date();
        const sameDay = now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
        if (sameDay) return hm;
        const days = Math.floor((Date.now() - t) / 86400000);
        if (days === 1) return '昨天 ' + hm;
        if (days > 1 && days < 30) return days + ' 天前';
        return (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) + ' ' + hm;
    } catch (_e) { return hm; }
}

/** 找房间（找不到返回 `null`，不返回空壳）。 */
export function roomOf(state, roomId) {
    const rooms = (state && Array.isArray(state.rooms)) ? state.rooms : [];
    for (const r of rooms) if (r.id === roomId) return r;
    return null;
}

/** 建/改房间。`{ ok, state, error? }` —— 上限与坏入参**都**带人话原因。 */
export function upsertRoom(state, room) {
    const base = normalizeLineState(state);
    if (!room || !isStr(room.id)) return { ok: false, error: '会话没有 id，建不了' };
    const id = room.id.slice(0, 60);
    const idx = base.rooms.findIndex((r) => r.id === id);
    if (idx < 0 && base.rooms.length >= LINE_LIMITS.rooms) {
        return { ok: false, error: '会话数已到上限 ' + LINE_LIMITS.rooms + '（先关掉一个再加）' };
    }
    const keep = idx >= 0 ? base.rooms[idx] : null;
    const merged = normalizeRoom({
        id,
        name: isStr(room.name) ? room.name : (keep ? keep.name : id),
        kind: room.kind || (keep ? keep.kind : 'dm'),
        members: Array.isArray(room.members) ? room.members : (keep ? keep.members : []),
        messages: keep ? keep.messages : [],
        readUpTo: room.readUpTo !== undefined ? room.readUpTo : (keep ? keep.readUpTo : ''),
        muted: room.muted !== undefined ? room.muted : (keep ? keep.muted : false),
    });
    if (!merged) return { ok: false, error: '会话形状不合法' };
    const rooms = base.rooms.slice();
    if (idx >= 0) rooms[idx] = merged; else rooms.push(merged);
    return { ok: true, state: { rooms, rev: base.rev + 1 } };
}

/** 关掉一个会话。`{ removed, state }`（removed=false 表示本来就没有，不算错）。 */
export function removeRoom(state, roomId) {
    const base = normalizeLineState(state);
    const rooms = base.rooms.filter((r) => r.id !== roomId);
    return { removed: rooms.length !== base.rooms.length, state: { rooms, rev: base.rev + 1 } };
}

/** 追加一条消息（环形上限）。`{ ok, state, error? }`。 */
export function appendMessage(state, roomId, msg) {
    const base = normalizeLineState(state);
    const idx = base.rooms.findIndex((r) => r.id === roomId);
    if (idx < 0) return { ok: false, error: '没有这个会话：' + roomId };
    const m = normalizeMessage(msg);
    if (!m) return { ok: false, error: '这条消息既没有正文也没有贴图' };
    const room = base.rooms[idx];
    if (room.messages.some((x) => x.id === m.id)) return { ok: false, error: '这条消息已经有了（id 重复）' };
    const msgs = room.messages.concat([m]);
    const dropped = msgs.length > LINE_LIMITS.messages ? (msgs.length - LINE_LIMITS.messages) : 0;
    const next = Object.assign({}, room, {
        messages: dropped ? msgs.slice(-LINE_LIMITS.messages) : msgs,
        dropped: room.dropped + dropped,
    });
    const rooms = base.rooms.slice();
    rooms[idx] = next;
    return { ok: true, state: { rooms, rev: base.rev + 1 } };
}

/** 撤回：标记 `recalled`，**不删**（删了就没有「撤回」这件事可读）。 */
export function recallMessage(state, roomId, msgId) {
    const base = normalizeLineState(state);
    const idx = base.rooms.findIndex((r) => r.id === roomId);
    if (idx < 0) return { ok: false, error: '没有这个会话' };
    const room = base.rooms[idx];
    const mi = room.messages.findIndex((m) => m.id === msgId);
    if (mi < 0) return { ok: false, error: '没有这条消息' };
    if (room.messages[mi].recalled) return { ok: false, error: '这条已经撤回过' };
    const messages = room.messages.slice();
    messages[mi] = Object.assign({}, messages[mi], { recalled: true });
    const rooms = base.rooms.slice();
    rooms[idx] = Object.assign({}, room, { messages });
    return { ok: true, state: { rooms, rev: base.rev + 1 } };
}

/** 把读游标推到该会话最后一条（不是布尔：读游标要能被「更早的未读」表达）。 */
export function markRead(state, roomId) {
    const base = normalizeLineState(state);
    const idx = base.rooms.findIndex((r) => r.id === roomId);
    if (idx < 0) return { ok: false, state: base, error: '没有这个会话' };
    const room = base.rooms[idx];
    const last = room.messages.length ? room.messages[room.messages.length - 1].id : '';
    if (!last || room.readUpTo === last) return { ok: false, state: base, error: '本来就没有新消息' };
    const rooms = base.rooms.slice();
    rooms[idx] = Object.assign({}, room, { readUpTo: last });
    return { ok: true, state: { rooms, rev: base.rev + 1 } };
}

/** 未读数：按「读游标之后还有几条」算（游标不在列表里 ⇒ 全算未读，如实说）。 */
export function unreadOf(state, room, settings) {
    const s = normalizeLineSettings(settings);
    const r = room || null;
    if (!r) return 0;
    if (r.kind === 'official' && !s.officialUnread) return 0;
    const msgs = Array.isArray(r.messages) ? r.messages : [];
    if (!r.readUpTo) return msgs.length;
    const at = msgs.findIndex((m) => m.id === r.readUpTo);
    if (at < 0) return msgs.length;
    return Math.max(0, msgs.length - at - 1);
}

/** 未读总数（跨会话）。 */
export function unreadTotal(state, settings) {
    const base = normalizeLineState(state);
    let n = 0;
    for (const r of base.rooms) n += unreadOf(base, r, settings);
    return n;
}

/** 时间线：跨会话取最近 N 条**引用**（不复制正文，正文留在房间里）。 */
export function timelineOf(state, limit) {
    const base = normalizeLineState(state);
    const cap = Math.max(1, Math.min(LINE_LIMITS.timeline, Number(limit) || LINE_LIMITS.timeline));
    const rows = [];
    for (const r of base.rooms) {
        const last = r.messages.length ? r.messages[r.messages.length - 1] : null;
        if (!last) continue;
        rows.push({ roomId: r.id, roomName: r.name, kind: r.kind, msgId: last.id, from: last.from, ts: last.ts, recalled: last.recalled, unread: unreadOf(base, r, null) });
    }
    rows.sort((a, b) => (b.ts - a.ts) || String(b.msgId).localeCompare(String(a.msgId)));
    return rows.slice(0, cap);
}

/** 投影：给视图与生成侧用的**只读读数**（三态都在）。 */
export function projectLine(state, settings, now) {
    const base = normalizeLineState(state);
    const s = normalizeLineSettings(settings);
    const t = Number(now) || Date.now();
    const rooms = base.rooms.map((r) => {
        const msgs = r.messages;
        const last = msgs.length ? msgs[msgs.length - 1] : null;
        return {
            id: r.id, name: r.name, kind: r.kind, kindText: describeKind(r.kind),
            members: r.members.slice(), count: msgs.length, dropped: r.dropped,
            unread: unreadOf(base, r, s), muted: r.muted,
            last: last ? { id: last.id, from: last.from, text: last.text, sticker: last.sticker,
                stickerName: (stickerById(last.sticker) || {}).name || '', ts: last.ts,
                clock: formatClock(last.ts), recalled: last.recalled, truncated: last.truncated } : null,
        };
    });
    rooms.sort((a, b) => ((b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0)) || String(a.name).localeCompare(String(b.name)));
    return {
        at: t, hasAny: base.rooms.length > 0, roomCount: base.rooms.length,
        unreadTotal: unreadTotal(base, s), rooms, timeline: timelineOf(base, LINE_LIMITS.timeline),
        readReceiptOn: s.readReceiptOn,
    };
}

/** 生成侧注入块：只给**事实**（谁在哪个会话说了什么、多久之前），不给指令。 */
export function linePromptBlock(proj, settings) {
    const s = normalizeLineSettings(settings);
    if (!s.injectToPrompt) return '';
    if (!proj || !proj.hasAny) return '';
    const bits = [];
    for (const r of proj.rooms.slice(0, 6)) {
        const L = r.last;
        if (!L) continue;
        const what = L.recalled ? '（撤回了一条）' : (L.sticker ? ('[贴图：' + (L.stickerName || '未知贴图') + ']') : L.text);
        bits.push('· ' + r.name + '（' + r.kindText + '）' + L.from + ' @' + L.clock + '：' + what);
    }
    if (!bits.length) return '';
    return '[LINE 会话近况]\n' + bits.join('\n')
        + '\n（以上是这段时间里 LINE 上真实发生过的消息；没有提到的会话就是没有新消息。）';
}
