/* ========================================================
 * config/time-source.js — [v4.106.0 · 第十三期 R13-O4] 时间的**两个钟**与唯一取数口
 * --------------------------------------------------------
 * 【它要治的缺陷：同一场雨落在两个时刻】
 *   实测 `apps/` 下裸 `Date.now()` **760 处** / `new Date()` **70 处**，而本仓的时间
 *   单一源 `config/time-manager.js` 只有 7 个文件提及。后果不是「代码不整齐」，是
 *   用户最容易察觉又最难描述的一类错：**照片时间戳与消息时间戳对不上**。
 *   而更要紧的是：本仓其实**同时存在两个钟**，却从来没有一处说出来过 ——
 *     · 剧情钟：角色世界里现在几点（`timeManager.getCurrentStoryTime()`）；
 *     · 墙钟    ：这台设备真实跑了多久（`Date.now()`，用于节流/审计/排序稳定性）。
 *   两者**都合法**，但每个字段只许属于其中一个。此前没有任何一处声明这件事，
 *   于是同一族字段在不同 App 里各挑各的钟 —— 这才是漂移的根因（不是谁忘了改）。
 *
 * 【本模块只做三件事，不做第四件】
 *   ① `storyNow(win)`  —— 剧情时刻的**唯一取数口**（内部只认 timeManager）；
 *   ② `wallNow()`      —— 墙钟时刻的**唯一取数口**（本仓唯一允许直接写 Date.now 的地方之一）；
 *   ③ `FIELD_CLOCKS` / `fieldClockOf(name)` —— **字段级时钟归属声明**，逐条带理由。
 *   它**不做**时间运算、不做格式化、不做时区换算：那些是既有实现的事，多一份就多一次漂移。
 *
 * 【三条纪律（与本仓既有口径一致，逐条对应已治过的形态）】
 *   ① **读不到就说读不到**：`storyNow` 在 timeManager 缺席 / 抛错 / 读到空面时一律
 *      `ok:false` + `reason`，**绝不补墙钟**。补墙钟会把「剧情里是 1943 年」读成
 *      「现在是 2026 年」，而这是本仓最贵的错读数之一（同族见 `config/comm-time.js`
 *      头注：「补 now 会把三天前没接到的电话读成刚刚漏接」）。
 *   ② **降级必须是显式的、并且只有一个出口**：确实需要「剧情源不可用时退回墙钟」的地方
 *      （例如消息时间兜底），走 `storyNowWallFallback(win)` —— 它返回 `degraded:true`
 *      并在 `reason` 里说明为什么降级。**降级不许散落在调用点各自写一遍**：
 *      散着写的后果是「哪个 App 在什么条件下用了墙钟」无人可答。
 *   ③ **字段级归属不许靠命名猜**：`FIELD_CLOCKS` 是**闭集**，未登记的字段名
 *      `fieldClockOf` 一律返回 `null`（不是猜一个默认值）—— 「没声明」与「声明为墙钟」
 *      必须不同形，否则下一版随手加一个 `xxAt` 就又漂走了。
 *
 * 【与既有双轨制的关系（不是新发明，是把已有的说法收成一份）】
 *   `apps/wechat/wechat-data.js` 早已同时写 `message.timestamp`（剧情）与
 *   `message.realTimestamp`（墙钟），并且注释里明写过这两者不许混用。本模块做的事是
 *   把这条**已经存在的正确做法**写成一张可机读的表，并为日历 / 日记 / 相册补齐剧情轨
 *   （`storyAt`）—— 它们此前**只有墙钟**，所以「照片时间与消息时间对不上」在它们身上
 *   是必然的，不是偶发。
 *
 * 纯 ESM export，零 import（不引入任何模块，避免依赖方向问题）。
 * ============================================================ */
'use strict';

/* 口径唯一实现：本模块曾为「零 import」而就地手写了一份同口径取数，
 *   而那正是本仓 weak-coercion 门点了四轮的第五度形态（口径一旦有第二份实现，
 *   下一个人就会再写一遍弱的）。`config/num-gate.js` 是**零依赖叶子模块**
 *   （见它自己的头注），引用它不造出依赖方向问题 ——「零 import」的原意是
 *   **不许反向依赖业务模块**，不是「不许复用口径」。 */
import { numOrNull } from './num-gate.js';

/** 两个钟的标识（键名即语义，不许出现第三个）。 */
export const CLOCKS = Object.freeze({
    story: 'story',
    wall: 'wall'
});

/**
 * 剧情时刻读不到时的成因码（**逐一给人话**：这些码会直接摆到诊断面上）。
 * 刻意不用布尔：`ok:false` 只说明「读不到」，说不清「为什么读不到」，
 * 而不同成因的处置相反（缺 timeManager 要装配；缺上下文要等会话；读到空面要等上游）。
 */
export const STORY_REASONS = Object.freeze({
    ok: '就绪',
    'no-host': '宿主不在（无 window，例如纯 Node 判据环境）',
    'no-time-manager': '手机上还没有时间管理器（装配未完成）',
    'threw': '取数本身抛错（看控制台的 warning）',
    'empty-face': '时间面在，但日期或时间读到空（上游还没给出剧情时间）',
    'bad-stamp': '时间面在场但没有可用的时间戳'
});

/**
 * 字段级时钟归属（**闭集**）。未登记 ⇒ `fieldClockOf` 返回 null。
 *
 * 判定口径（写在这里，免得下一次重新讨论）：
 *   · **用户能看见的时刻**属于剧情钟 —— 它就是角色世界里的「现在」；
 *   · **机器自己用的时刻**属于墙钟 —— 节流窗口、审计流水、缓存新鲜度、排序稳定性。
 *     这些若改用剧情钟，会出现「剧情时间被回拨后节流永远不失效」这类怪故障，
 *     而它们对用户不可见，故没有理由跟着剧情走。
 */
export const FIELD_CLOCKS = Object.freeze({
    /* ── 剧情钟（用户可见） ── */
    timestamp: 'story',
    storyAt: 'story',
    date: 'story',
    time: 'story',
    weekday: 'story',
    dateKey: 'story',
    realDate: 'story',
    /* ── 墙钟（机器用） ── */
    realTimestamp: 'wall',
    createdAt: 'wall',
    updatedAt: 'wall',
    deletedAt: 'wall',
    startedAt: 'wall',
    finishedAt: 'wall',
    lastActiveAt: 'wall',
    lastAt: 'wall',
    at: 'wall',
    ts: 'wall'
});

/** 每个字段为什么属于那个钟（同样进闭集：新增字段必须连带回答这个问题）。 */
export const FIELD_CLOCK_WHY = Object.freeze({
    timestamp: '一条消息在角色世界里发生的时刻（双轨制的剧情侧，见 wechat-data 头注）',
    storyAt: '为只有墙钟的 App 补齐的剧情轨（日历 / 日记 / 相册索引），对齐 message.timestamp',
    date: '剧情日期文本（用户读的是「2044年10月28日」，不是本机日期）',
    time: '剧情时刻文本（HH:MM）',
    weekday: '剧情星期（古历剧情里为空，由调用方决定怎么显示）',
    dateKey: '日程挂在哪一天 —— 它是剧情日期，不是本机日期',
    realDate: '现实日期（与剧情日期并列展示时必须分开存，不可互相顶替）',
    realTimestamp: '双轨制的墙钟侧：记录「这条消息是哪次生成写下的」，与剧情时刻不同义',
    createdAt: '记录创建时刻：用于排序稳定性与审计，剧情回拨不许让它倒退',
    updatedAt: '记录最后修改时刻：同上',
    deletedAt: '删除时刻：回收站按它倒序分组，必须单调（剧情回拨会让顺序乱掉）',
    startedAt: '一次任务 / 生成的开始时刻：用于耗时，属于机器时间',
    finishedAt: '一次任务 / 生成的结束时刻：用于耗时，属于机器时间',
    lastActiveAt: '最后活动时刻：用于活跃度节流，属于机器时间',
    lastAt: '设备使用痕迹最后打开时刻：本机墙钟，不随剧情回拨',
    at: '账本 / 历史条目时刻（审计流水）：必须单调且跨会话可比',
    ts: '缓存条目 / 瞬态读数的新鲜度标记：属于机器时间'
});

/**
 * 查一个字段名属于哪个钟。
 * @param {string} name 字段名（`timestamp` / `createdAt` …）
 * @returns {'story'|'wall'|null} 未登记 ⇒ **null**（刻意不猜默认值）
 */
export function fieldClockOf(name) {
    const key = String(name == null ? '' : name).trim();
    if (!key) return null;
    return Object.prototype.hasOwnProperty.call(FIELD_CLOCKS, key) ? FIELD_CLOCKS[key] : null;
}

/**
 * 墙钟时刻（毫秒）。本仓**唯一**允许直接 `Date.now()` 的产品出口。
 * @returns {number}
 */
export function wallNow() {
    return Date.now();
}

function readTimeManager(win) {
    /* 宿主注入方式与全仓一致：`window.VirtualPhone.timeManager`（index.js 装配点）。 */
    try {
        return (win && win.VirtualPhone && win.VirtualPhone.timeManager) || null;
    } catch (_e) {
        return null;
    }
}

/**
 * 剧情时刻 —— **唯一取数口**。
 *
 * @param {object} [win] 宿主（`window`）；缺省视为无宿主（纯 Node 判据环境）
 * @returns {{ok:boolean, ms:number|null, date:string, time:string, weekday:string,
 *            source:string, reason:string, degraded:boolean}}
 *   · `ok:false` 时 `ms` 必为 **null**（**绝不补墙钟**）；
 *   · `reason` 取自 `STORY_REASONS` 的键；
 *   · `source` 原样转发 timeManager 给出的来源（chat / manual-sync / worldaxis …），
 *     未知即空串 —— 不在这里发明第三个来源名。
 */
/** options.readOnly=true 只读已发布缓存；不重算剧情钟，不接受墙钟回落。 */
export function storyNow(win, options = {}) {
    const out = {
        ok: false, ms: null, date: '', time: '', weekday: '',
        source: '', reason: 'no-host', degraded: false
    };
    if (!win) return out;
    const tm = readTimeManager(win);
    if (!tm || (options.readOnly === true
        ? typeof tm.peekCurrentStoryTime !== 'function'
        : typeof tm.getCurrentStoryTime !== 'function')) {
        out.reason = 'no-time-manager';
        return out;
    }
    let face = null;
    try {
        face = options.readOnly === true ? tm.peekCurrentStoryTime() : tm.getCurrentStoryTime();
    } catch (_e) {
        out.reason = 'threw';
        return out;
    }
    if (!face || typeof face !== 'object') {
        out.reason = 'empty-face';
        return out;
    }
    const date = String(face.date == null ? '' : face.date).trim();
    const time = String(face.time == null ? '' : face.time).trim();
    if (!date || !time) {
        out.reason = 'empty-face';
        return out;
    }
    /* 时间戳走**唯一实现**（`config/num-gate.js` 的 `numOrNull`）——
     *   它在「没给」一面上与弱口径**不同形**：`Number('')` / `Number(null)` / `Number([])` 全是 0，
     *   弱口径会把它们读成「有时间戳 0」；`numOrNull` 一律 null。
     *   语义差补在这里：`numOrNull(0)` 是**合法读数 0**（它只回答「有没有可用的数」），
     *   而时间戳 0 不是可用时刻 ⇒ 本处再判 `> 0`。 */
    const rawMs = numOrNull(face.timestamp);
    const ms = (rawMs !== null && rawMs > 0) ? rawMs : null;
    out.ok = true;
    out.ms = ms;
    out.date = date;
    out.time = time;
    out.weekday = String(face.weekday == null ? '' : face.weekday).trim();
    out.source = String(face.source == null ? '' : face.source).trim();
    out.reason = ms === null ? 'bad-stamp' : 'ok';
    return out;
}

/**
 * 剧情时刻（毫秒）或 **null**（读不到即 null，调用方必须自己决定怎么办）。
 * @param {object} [win]
 * @returns {number|null}
 */
export function storyNowMs(win) {
    return storyNow(win).ms;
}

/**
 * 写点专用：**一次取两个钟**。
 *
 * 为什么要有这个函数：写一条记录时同时需要「用户看见的时刻」与「机器用的时刻」，
 * 若每个写点各自调 `storyNow` + `Date.now` 拼一遍，拼错的形态有两种且都静默——
 *   ① 两个字段都填墙钟（用户看到的是本机日期，剧情里明明写着 2044 年）；
 *   ② 两个字段都填剧情钟（剧情回拨后节流永不失效、回收站顺序乱掉）。
 * 故把「配对」这件事收成一份，写点只负责把两个值各自放进该放的字段。
 *
 * @param {object} [win] 宿主
 * @returns {{storyAt:number|null, wallAt:number, storyReason:string, storyDegraded:boolean}}
 *   · `storyAt` 读不到时**是 null**（不谎报墙钟：null 表示「确实不知道剧情时刻」）；
 *   · `wallAt` 恒为墙钟（它的用途是排序稳定性 / 审计 / 节流，见 `FIELD_CLOCK_WHY`）。
 */
export function stampPair(win) {
    const s = storyNow(win);
    return {
        storyAt: s.ms,
        wallAt: wallNow(),
        storyReason: s.reason,
        storyDegraded: s.ms === null
    };
}

/**
 * 从一条已落盘记录里读剧情时刻（**读数口径只此一份**）。
 *
 * 兼容面：新写入的 `storyAt` 是权威；历史数据没有这个字段，此时退到
 * `timestamp`（微信消息的老字段名，语义相同）。两者都没有 ⇒ **null**（不猜）。
 * 故意**不**回退到 `createdAt`：那是墙钟，混进来就等于把本条纪律作废。
 *
 * @param {object} rec
 * @returns {number|null}
 */
export function storyTsOf(rec) {
    const o = rec || {};
    /* 同上：取值走唯一实现，「时间戳必须为正」这一条语义差留在本处。 */
    const pick = (v) => {
        const n = numOrNull(v);
        return (n !== null && n > 0) ? n : null;
    };
    const a = pick(o.storyAt);
    if (a !== null) return a;
    return pick(o.timestamp);
}

/**
 * 剧情时刻，**读不到时显式降级到墙钟**（本仓唯一允许的降级出口）。
 *
 * 为什么必须集中在这里：降级本身是合法的（消息时间总要有一个兜底），
 * 但**散落在各调用点各自写一遍**的后果是「哪个 App 在什么条件下用了墙钟」无人可答。
 * 故这里把降级这件事变成一个可观测对象：`degraded:true` + `reason` 说明原因。
 *
 * @param {object} [win]
 * @returns {{ok:boolean, ms:number|null, date:string, time:string, weekday:string,
 *            source:string, reason:string, degraded:boolean}}
 */
export function storyNowWallFallback(win) {
    const s = storyNow(win);
    if (s.ms !== null) return s;
    const wall = wallNow();
    const d = new Date(wall);
    const pad = (n) => String(n).padStart(2, '0');
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return {
        ok: false,
        ms: wall,
        date: d.getFullYear() + '年' + pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日',
        time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
        weekday: weekdays[d.getDay()],
        source: 'wall-fallback',
        reason: s.reason,
        degraded: true
    };
}

/**
 * 一句话读数（诊断面与判据共用，不许各写一份）。
 * 「读不到」与「读到了但降级」必须不同形 —— 前者没有剧情时刻，后者有但那是墙钟。
 * @param {object} s `storyNow*` 的返回
 * @returns {string}
 */
export function storySourceLine(s) {
    const o = s || {};
    const why = String(STORY_REASONS[o.reason] || o.reason || '未知原因');
    if (o.ok === true) {
        return '剧情时刻 ' + String(o.date || '') + ' ' + String(o.time || '')
            + (o.source ? '（来源 ' + o.source + '）' : '');
    }
    if (o.degraded === true) {
        return '剧情时刻读不到，本处已降级到本机时间 —— ' + why;
    }
    return '剧情时刻读不到 —— ' + why;
}
