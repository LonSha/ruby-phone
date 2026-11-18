/* ============================================================
 * config/time-machine.js — [R25-X2] 状态回放（时光机）：回到某时刻，手机当时长什么样
 * ------------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   本仓已经有「拍点 / 比差异 / 选择性还原」（config/recovery-hub.js + apps/backupdesk），
 *   也就是能回答「现在和那个点差在哪」；但**答不出**「那个点当时的手机是什么样」：
 *   消息有几条、未读几条、日程上有哪些事。排查与复盘要的恰恰是后者 ——
 *   没有它，用户只能靠记忆争论「那天到底有没有这条消息」。
 *
 * 【数据从哪来（不新造存储，也不编数）】
 *   恢复点（`rh_recovery_hub_v1`）拍点时把**当刻的键面原文**整份存进 dataPayload
 *   （见 apps/backupdesk/backupdesk-app.js:captureSnapshot），键形如 `chat::wechat_msg_<id>`。
 *   所以「当时的长相」本来就在盘上，只差一层投影。本模块只做投影，**一个字节都不写**。
 *
 * 【四个面，四句不等号】
 *   · `messages`：快照里的 `wechat_msg_*` 逐个解析 ⇒ 条数 + 每会话条数 + 最近三条。
 *     还按**剧情钟**（storyTsOf）再切一次「不晚于该时刻」：剧情回拨补写的历史消息
 *     （storyAt 在过去、入盘在现在）不该出现在更早的那一刻里。没有剧情时刻的消息
 *     **不猜**（既不当作已发生、也不丢掉），单独计数点名。
 *   · `unread`：未读判定在本仓有唯一实现（apps/wechat/chat-read-cursor.js 的 unreadStateOf）。
 *     本模块**不重写**它：由调用方注入（`opts.unreadOf`）。未注入 ⇒ 这一面报 `unknown`
 *     并说明原因 —— 「没有判定器」绝不能画成「未读 0 条」。
 *   · `schedule`：快照里 `calendar_memos` 的**当时值**直接投影（它就是那一刻的日程表）。
 *   · `wallet`：金钱账面是上游记忆插件的**活体 window 面**（lonsha_memory_bridge_v1.snapshot.moneyLedger），
 *     本仓从不把它写盘 ⇒ 历史里**没有**它。这一面永远显式 `unknown`（reason
 *     `upstream-face-not-persisted`），**不拿今天的余额冒充当时的余额**。修法写在文案里：
 *     想让它可回放，得先有「账面流水带时间戳落盘」的那一环（R25-X2 后续）。
 *
 * 【三态纪律】
 *   · 该时刻之前没有任何快照 ⇒ `unreadable` + reason `no-snapshot-before-moment`，
 *     **不回落**到「最近那一个」（那是另一个时刻的长相）；
 *   · 面级 `ok` / `unknown` / `absent` 各自成形：`absent`＝这份快照里根本没有这类键（不是空），
 *     `unknown`＝有数据但判不出（例如没有未读判定器）；
 *   · 对拍 `same` / `mismatch` / `unknown` 三态，`unknown ≠ same`。
 *
 * 【只读是硬约束】
 *   本模块不 import 任何存储/写回模块，不出现 setItem / writeReceipt / storage.set。
 *   判据里有一条专门扫这一点（写在 tests/r25_x2_time_machine.test.mjs），
 *   因为「回放顺手把状态也写回去了」是这个功能最容易犯的错。
 * ============================================================ */
'use strict';
import { storyTsOf } from './time-source.js';
import { numOrNull as num } from './num-gate.js';
/* [R25-X2] 桥名走真源常量：本文件不许自持 `lonsha_memory_bridge_v1` 字面量
 *   （bridge-contract 门 J1 实测抓到过一处 —— 桥改名时产品端不会跟着改）。 */
import { LONSHA_BRIDGE_ID } from './world-bridge.js';

/** 四个消费面（闭集；加面要同时加标签与投影，缺一即红）。 */
export const MACHINE_FACES = Object.freeze(['messages', 'unread', 'wallet', 'schedule']);

/** 面名 → 中文（多处共用同一套名字，不许各写一份）。 */
export const FACE_LABELS = Object.freeze({
    messages: '消息',
    unread: '未读',
    wallet: '钱包',
    schedule: '日程'
});

/** 回放整体两态：能回放 / 回放不了（回放不了必须带 reason）。 */
export const REPLAY_STATES = Object.freeze({ ok: 'ok', unreadable: 'unreadable' });

/** 面级三态：算出来了 / 判不出 / 这份快照里没有这类键。 */
export const FACE_STATES = Object.freeze({ ok: 'ok', unknown: 'unknown', absent: 'absent' });

/** 钱包面为什么永远是 unknown：上游账面不落盘。文案唯一真源。 */
export const WALLET_GAP_REASON = 'upstream-face-not-persisted';
export const WALLET_GAP_TEXT = '钱包面读不到：金钱账面是上游记忆插件的活体面（window.' + LONSHA_BRIDGE_ID + '.snapshot.moneyLedger），本仓从不把它写盘，所以历史快照里没有它。这里**不拿今天的余额冒充当时的余额**。';

/** 只读徽标：界面上必须显示，判据会扫。 */
export const READ_ONLY_BADGE = '只读回放：本面只做投影，不写任何键';

/** 消息键前缀（与 apps/wechat/wechat-data.js 的 messageKeyPrefix 逐字一致）。 */
export const MESSAGE_KEY_PREFIX = 'wechat_msg_';
/** 会话总账键（readCursors 在它里面，是**那一刻的**游标）。 */
export const WECHAT_STATE_KEY = 'wechat_data';
/** 日程键（calendar_memos，那一刻的日程表）。 */
export const SCHEDULE_KEY = 'calendar_memos';

/** 快照键形如 `chat::wechat_msg_x` / `global::x`：取裸键。 */
function bareKeyOf(key) {
    const k = String(key == null ? '' : key);
    const at = k.indexOf('::');
    return at >= 0 ? k.slice(at + 2) : k;
}

/** 值可能是原文串，也可能是已解析对象；解析失败返回 undefined（不是空数组 —— 失败 ≠ 没有）。 */
function parseValue(raw) {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return undefined;
    try { return JSON.parse(raw); } catch (_e) { return undefined; }
}

/**
 * 快照时刻表（新→旧）。
 * @param {object|Array} snapshots normalizeRecoveryState 的 state 或快照数组
 * @returns {Array<{id:string,label:string,at:number,keyCount:number}>}
 */
export function momentsOf(snapshots) {
    const raw = Array.isArray(snapshots)
        ? snapshots
        : (snapshots && typeof snapshots === 'object' && snapshots.snapshots && typeof snapshots.snapshots === 'object'
            ? Object.keys(snapshots.snapshots).map((k) => snapshots.snapshots[k])
            : []);
    const out = [];
    for (const s of raw) {
        if (!s || typeof s !== 'object') continue;
        const at = num(s.createdAt);
        if (at === null) continue;              // 没有拍点时刻的条目无法定位「当时」，跳过并留痕在下面
        out.push({
            id: String(s.id == null ? '' : s.id),
            label: String(s.label == null ? '' : s.label) || '未命名恢复点',
            at: at,
            keyCount: num(s.keyCount) === null ? 0 : num(s.keyCount)
        });
    }
    out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    return out;
}

/**
 * 选「不晚于该时刻的最新那一个」快照。
 * ★ 一个都没有 ⇒ null（调用方据此报 unreadable，**不许**退而取最近那个）。
 */
export function snapshotAt(snapshots, momentMs) {
    const t = num(momentMs);
    if (t === null) return null;
    const list = momentsOf(snapshots);
    let best = null;
    for (const m of list) {
        if (m.at <= t && (!best || m.at > best.at)) best = m;
    }
    if (!best) return null;
    const state = Array.isArray(snapshots) ? null : snapshots;
    if (state) {
        const hit = state.snapshots && state.snapshots[best.id];
        return hit ? { ...best, dataPayload: (hit.dataPayload && typeof hit.dataPayload === 'object') ? hit.dataPayload : {} } : best;
    }
    return best;
}

/** 从 payload 里按裸键前缀收集消息（返回 {byChat, badJson, keys}）。 */
function collectMessages(payload) {
    const byChat = new Map();
    const bad = [];
    let keys = 0;
    for (const k of Object.keys(payload)) {
        const bare = bareKeyOf(k);
        if (bare.indexOf(MESSAGE_KEY_PREFIX) !== 0) continue;
        keys += 1;
        const chatId = bare.slice(MESSAGE_KEY_PREFIX.length);
        const parsed = parseValue(payload[k]);
        if (!Array.isArray(parsed)) { bad.push(bare); continue; }
        byChat.set(chatId, parsed);
    }
    return { byChat, bad, keys };
}

/** 消息面的投影：按剧情钟切「不晚于 T」，没有剧情钟的单独点名。 */
function faceMessages(byChat, bad, momentMs) {
    let total = 0;
    let future = 0;
    let noTime = 0;
    const rows = [];
    const preview = [];
    for (const [chatId, list] of byChat) {
        let count = 0;
        for (const m of list) {
            if (!m || typeof m !== 'object') continue;
            const ts = storyTsOf(m);
            if (ts === null) { noTime += 1; continue; }
            if (ts > momentMs) { future += 1; continue; }
            count += 1;
            preview.push({ chatId, at: ts, from: String(m.sender || m.role || ''), text: String(m.content == null ? '' : m.content).slice(0, 40) });
        }
        total += count;
        rows.push({ chatId, count });
    }
    rows.sort((a, b) => b.count - a.count || (a.chatId < b.chatId ? -1 : 1));
    preview.sort((a, b) => b.at - a.at);
    if (byChat.size === 0) {
        return {
            state: FACE_STATES.absent,
            reason: 'no-message-keys',
            text: '这份快照里没有任何消息键（不是「当时没有消息」，是这份点没收到聊天数据）',
            count: null, chats: 0, rows: [], preview: [], future: 0, noTime: 0, badKeys: bad
        };
    }
    return {
        state: FACE_STATES.ok,
        count: total,
        chats: byChat.size,
        rows: rows.slice(0, 8),
        preview: preview.slice(0, 3),
        future: future,
        noTime: noTime,
        badKeys: bad,
        text: '当时共 ' + String(total) + ' 条消息（' + String(byChat.size) + ' 个会话）' +
            (future ? ('；另有 ' + String(future) + ' 条剧情时刻晚于该刻，已排除') : '') +
            (noTime ? ('；' + String(noTime) + ' 条没有剧情时刻，无法判断先后（不猜）') : '')
    };
}

/** 未读面：必须用注入的唯一判定器；没有判定器就 unknown，绝不画 0。 */
function faceUnread(byChat, payload, momentMs, unreadOf) {
    if (typeof unreadOf !== 'function') {
        return {
            state: FACE_STATES.unknown,
            reason: 'no-unread-reader',
            text: '未读面判不出：没有注入未读判定器（本仓唯一实现在 apps/wechat/chat-read-cursor.js）。**这不是「当时未读 0 条」**',
            total: null, rows: []
        };
    }
    let cursorRaw;
    for (const k of Object.keys(payload)) {
        if (bareKeyOf(k) === WECHAT_STATE_KEY) { cursorRaw = parseValue(payload[k]); break; }
    }
    if (cursorRaw === undefined || cursorRaw === null || typeof cursorRaw !== 'object') {
        return {
            state: FACE_STATES.unknown,
            reason: 'no-cursor-ledger',
            text: '未读面判不出：这份快照里读不到会话总账（读取游标在它里面），不拿今天的游标冒充当时的游标',
            total: null, rows: []
        };
    }
    const cursors = (cursorRaw.readCursors && typeof cursorRaw.readCursors === 'object') ? cursorRaw.readCursors : null;
    if (!cursors) {
        return {
            state: FACE_STATES.unknown,
            reason: 'no-cursor-face',
            text: '未读面判不出：会话总账在，但这版没有读游标那一格',
            total: null, rows: []
        };
    }
    let total = 0;
    const rows = [];
    for (const [chatId, list] of byChat) {
        const asOf = list.filter((m) => {
            if (!m || typeof m !== 'object') return false;
            const ts = storyTsOf(m);
            return ts !== null && ts <= momentMs;
        });
        let r;
        try { r = unreadOf({ cursors: cursors, chatId: chatId, messages: asOf }); }
        catch (_e) { r = null; }
        if (!r || typeof r !== 'object') {
            rows.push({ chatId: chatId, state: 'unknown', count: null });
            continue;
        }
        const n = num(r.count);
        if (r.state === 'behind' && n !== null) total += n;
        rows.push({ chatId: chatId, state: String(r.state || 'unknown'), count: n });
    }
    const unknownRows = rows.filter((r) => r.state === 'unknown').length;
    return {
        state: FACE_STATES.ok,
        total: total,
        rows: rows.slice(0, 8),
        unknownRows: unknownRows,
        text: '当时未读合计 ' + String(total) + ' 条' +
            (unknownRows ? ('；其中 ' + String(unknownRows) + ' 个会话判不出（游标缺失，单独计，不并进合计）') : '')
    };
}

/** 日程面：快照里的 calendar_memos 就是那一刻的日程表，直接投影（不再按时间切，避免二次口径）。 */
function faceSchedule(payload) {
    let raw;
    for (const k of Object.keys(payload)) {
        if (bareKeyOf(k) === SCHEDULE_KEY) { raw = payload[k]; break; }
    }
    const parsed = parseValue(raw);
    if (!Array.isArray(parsed)) {
        return {
            state: FACE_STATES.absent,
            reason: parsed === undefined ? 'no-schedule-keys' : 'bad-schedule-json',
            text: parsed === undefined
                ? '这份快照里没有日程键（不是「当时没有日程」，是这份点没收到日历数据）'
                : '日程键在，但解析不出来（坏 JSON 不当作空日程）',
            count: null, rows: []
        };
    }
    const rows = parsed
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({ dateKey: String(m.dateKey || ''), time: String(m.time || ''), title: String(m.title || '') }))
        .sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
    return {
        state: FACE_STATES.ok,
        count: rows.length,
        rows: rows.slice(0, 8),
        text: '当时日程 ' + String(rows.length) + ' 条'
    };
}

/**
 * 回放：给定快照台账与一个时刻，投影四个面。
 * @param {object|Array} snapshots 恢复点台账（rh_recovery_hub_v1 的 state）或快照数组
 * @param {number} momentMs 要回到的时刻（毫秒）
 * @param {{unreadOf?:Function}} [opts] 未读判定器（本仓唯一实现：unreadStateOf）
 * @returns {object}
 */
export function replayAt(snapshots, momentMs, opts) {
    const t = num(momentMs);
    const o = (opts && typeof opts === 'object') ? opts : {};
    if (t === null) {
        return {
            state: REPLAY_STATES.unreadable, reason: 'no-moment',
            text: '先选一个时刻：没有时刻就没有「当时」',
            moment: null, snapshotId: null, faces: null
        };
    }
    const pick = snapshotAt(snapshots, t);
    if (!pick) {
        const all = momentsOf(snapshots);
        return {
            state: REPLAY_STATES.unreadable,
            reason: 'no-snapshot-before-moment',
            text: all.length
                ? ('该时刻之前没有恢复点（最早的恢复点是 ' + new Date(all[all.length - 1].at).toISOString() + '）—— 不拿之后的点冒充')
                : '这台手机还没拍过恢复点，没有可回放的「当时」',
            moment: t, snapshotId: null, faces: null
        };
    }
    const payload = (pick.dataPayload && typeof pick.dataPayload === 'object') ? pick.dataPayload : {};
    const msgs = collectMessages(payload);
    const faces = {
        messages: faceMessages(msgs.byChat, msgs.bad, t),
        unread: faceUnread(msgs.byChat, payload, t, o.unreadOf),
        wallet: {
            state: FACE_STATES.unknown,
            reason: WALLET_GAP_REASON,
            text: WALLET_GAP_TEXT,
            balance: null, rows: []
        },
        schedule: faceSchedule(payload)
    };
    return {
        state: REPLAY_STATES.ok,
        reason: '',
        moment: t,
        snapshotId: pick.id,
        snapshotLabel: pick.label,
        snapshotAt: pick.at,
        keyCount: num(pick.keyCount) === null ? 0 : num(pick.keyCount),
        messageKeys: msgs.keys,
        faces: faces,
        text: '回到「' + pick.label + '」（' + new Date(pick.at).toISOString() + '）当时的手机：' +
            MACHINE_FACES.map((f) => FACE_LABELS[f] + ' ' + shortOf(faces[f])).join(' · ')
    };
}

/** 一面一句话的极短形（给结论行用）。 */
function shortOf(face) {
    if (!face || typeof face !== 'object') return '判不出';
    if (face.state === FACE_STATES.absent) return '这份点没有这类键';
    if (face.state === FACE_STATES.unknown) return '判不出';
    if (face.count !== undefined && face.count !== null) return String(face.count) + ' 条';
    if (face.total !== undefined && face.total !== null) return String(face.total) + ' 条';
    return '判不出';
}

/** 面级人话（视图按面逐行显示；不自己拼句子）。 */
export function faceTextOf(replay, faceKey) {
    const f = replay && replay.faces ? replay.faces[faceKey] : null;
    if (!f) return '（没有这一面）';
    return String(f.text == null ? '判不出' : f.text);
}

/**
 * 读回对拍：视图上真显示的四句 ⇄ 内核算出的四句。
 * @param {object|null} replay replayAt 的返回
 * @param {object|null} observed {messages,unread,wallet,schedule} 视图实际文本
 * @returns {{verdict:'same'|'mismatch'|'unknown', diffs:Array}}
 */
export function judgeReplayApplied(replay, observed) {
    if (!replay || replay.state !== REPLAY_STATES.ok || !replay.faces) {
        return { verdict: 'unknown', diffs: [{ face: '', why: '没有回放面（回放不了 ≠ 四处一致）' }] };
    }
    if (!observed || typeof observed !== 'object') {
        return { verdict: 'unknown', diffs: [{ face: '', why: '视图没回传读数（读不到 ≠ 一致）' }] };
    }
    const diffs = [];
    for (const f of MACHINE_FACES) {
        const want = faceTextOf(replay, f);
        const got = (observed[f] === undefined || observed[f] === null) ? null : String(observed[f]);
        if (got === null) { diffs.push({ face: f, why: '视图没有显示这一面' }); continue; }
        if (got !== want) diffs.push({ face: f, why: '显示与投影不一致', want: want, got: got });
    }
    return { verdict: diffs.length ? 'mismatch' : 'same', diffs: diffs };
}
