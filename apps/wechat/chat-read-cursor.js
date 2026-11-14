/* ============================================================
 * apps/wechat/chat-read-cursor.js — [R21-X1 · 消息流阅读游标与未读边界]
 * ------------------------------------------------------------
 * 【修前实测的缺口（读码可复算）】
 *   `apps/wechat/wechat-data.js` 约 5569 行，会话上只有 `chat.unread` 一个计数器：
 *   · 收到消息就 `+1`（wechat-app.js:6678/6689），打开会话就清零（wechat-app.js:4870）；
 *   · 没有任何地方回答「读到哪了」。剧情回拨后 AI 补写的历史消息（storyAt 在过去、
 *     realTimestamp 是现在）会被盲目的 `+1` 记成未读 —— 「不报错、只错结果」。
 *
 * 【三条铁律（违反即红，判据里有负控制）】
 *   ① 未读判定**只比剧情钟**：`cursor.lastReadStoryAt` vs 消息 `storyAt`
 *      （经 config/time-source.js 的 storyTsOf 单一口径取值）。
 *      墙钟那份（lastReadWallAt）只回答「这台设备上次读是哪天」这类机器问题，
 *      **绝不参与未读判定** —— 判定面出现 realTimestamp/Date.now() 就是负控制靶子。
 *   ② 三态互斥：no-cursor（从没读过，全部未读）/ up-to-date / behind{count}。
 *      每态形状不同形，不许用同一个空对象糊弄。
 *   ③ 消息没有剧情时刻（storyTsOf === null）时不猜：按**楼层**（数组下标）对
 *      cursor.lastReadFloor 比较兜底，绝不拿墙钟顶替剧情钟。
 * ============================================================ */
import { storyTsOf } from '../../config/time-source.js';
/* [v4.149.0 · R21-X1] 取值唯一实现：弱 coercion 门 W5 实测抓到本文件首版的就地
 *   `Number()` 探针把 `false`/`[]` 读成有效值（floorOf 的 false:0 / true:1 / arr5:5）。
 *   收口走全仓唯一出口 `numOrNull`，不就地再写第二份。 */
import { numOrNull } from '../../config/num-gate.js';

/** 游标形状闭集：多字段少字段都算坏游标（坏游标按 null 处理 ⇒ no-cursor，不猜）。 */
export const CURSOR_FIELDS = Object.freeze(['chatId', 'lastReadFloor', 'lastReadStoryAt', 'lastReadWallAt']);

export const UNREAD_STATES = Object.freeze({
    NO_CURSOR: 'no-cursor',     // 从没读过：全部未读
    UP_TO_DATE: 'up-to-date',   // 剧情钟上没有比上次读更新的消息
    BEHIND: 'behind'            // 落后 count 条（count 只数剧情钟上更新的）
});

const floorOf = (v) => {
    const n = numOrNull(v);
    return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};
const tsOrNull = (v) => {
    const n = numOrNull(v);
    return n !== null && n > 0 ? n : null;
};

/**
 * 游标归一化：形状不对（缺字段 / 楼层不是非负整数 / chatId 空）一律 null。
 * 宁可退回 no-cursor 也不拿半个游标猜 —— 坏游标比没游标更危险。
 */
export function normalizeCursor(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const f of CURSOR_FIELDS) if (!(f in raw)) return null;
    const chatId = String(raw.chatId || '').trim();
    const lastReadFloor = floorOf(raw.lastReadFloor);
    if (!chatId || lastReadFloor === null) return null;
    return {
        chatId,
        lastReadFloor,
        lastReadStoryAt: tsOrNull(raw.lastReadStoryAt),
        lastReadWallAt: tsOrNull(raw.lastReadWallAt)
    };
}

/** 读游标：无 / 坏 ⇒ null（调用方据此落 no-cursor）。 */
export function readCursorOf(cursors, chatId) {
    const key = String(chatId || '').trim();
    if (!key) return null;
    return normalizeCursor((cursors || {})[key]);
}

/**
 * 落一次读进度（纯函数：返回新表，不动入参）。
 * @param {object} cursors 全量游标表 { [chatId]: cursor }
 * @param {string} chatId
 * @param {{floor:number, storyAt:number|null, wallAt:number}} read 楼层与两个钟的读数
 */
export function markRead(cursors, chatId, read = {}) {
    const key = String(chatId || '').trim();
    const floor = floorOf(read.floor);
    if (!key || floor === null) return cursors || {};
    const prev = readCursorOf(cursors, key);
    /* 只前进不后退：重放/重roll 会让「这次读到的楼层」变小，倒退的游标没有意义。 */
    if (prev && floor <= prev.lastReadFloor
        && (prev.lastReadStoryAt !== null || read.storyAt == null)) {
        return cursors || {};
    }
    const next = { ...(cursors || {}) };
    next[key] = Object.freeze({
        chatId: key,
        lastReadFloor: floor,
        lastReadStoryAt: tsOrNull(read.storyAt),
        lastReadWallAt: tsOrNull(read.wallAt)
    });
    return next;
}

/**
 * 未读判定（本模块唯一的判定出口）。
 * @param {{cursors:object, chatId:string, messages:Array}} args
 * @returns {{state:'no-cursor'|'up-to-date'|'behind', count:number, firstUnreadIndex:number|null}}
 *   · no-cursor：count = 全部可读消息数（从没读过就是全没读）；
 *   · behind：firstUnreadIndex 给出第一条未读的下标（供进会话定位）；
 *   · 判定只看剧情钟（storyTsOf）；storyAt 为 null 的消息按楼层兜底，不碰墙钟。
 */
export function unreadStateOf({ cursors, chatId, messages }) {
    const list = Array.isArray(messages) ? messages : [];
    const cursor = readCursorOf(cursors, chatId);
    if (!cursor) {
        return { state: UNREAD_STATES.NO_CURSOR, count: list.length, firstUnreadIndex: list.length ? 0 : null };
    }
    let count = 0;
    let firstUnreadIndex = null;
    for (let i = 0; i < list.length; i++) {
        const ts = storyTsOf(list[i]);
        let unread;
        if (ts !== null && cursor.lastReadStoryAt !== null) {
            /* 铁律①：唯一判定面 —— 剧情钟 vs 剧情钟。 */
            unread = ts > cursor.lastReadStoryAt;
        } else if (ts === null) {
            /* 铁律③：这条消息没有剧情时刻 —— 按楼层兜底，不猜时间。 */
            unread = i > cursor.lastReadFloor;
        } else {
            /* 有剧情时刻但游标没记到剧情钟（上次读时钟坏了）⇒ 同样退到楼层。 */
            unread = i > cursor.lastReadFloor;
        }
        if (unread) {
            count++;
            if (firstUnreadIndex === null) firstUnreadIndex = i;
        }
    }
    return count > 0
        ? { state: UNREAD_STATES.BEHIND, count, firstUnreadIndex }
        : { state: UNREAD_STATES.UP_TO_DATE, count: 0, firstUnreadIndex: null };
}

/** 自检读数（判据 B 组逐条对账用；也是本模块的对外机器读数出口）。 */
export function cursorSelfCheck() {
    return {
        fields: CURSOR_FIELDS.slice(),
        states: Object.values(UNREAD_STATES),
        /* 判定铁律的机器可读自述：判据拿它与真代码面对账（不许只信注释）。 */
        verdictSource: 'storyTsOf',
        wallClockRole: 'machine-only'
    };
}
