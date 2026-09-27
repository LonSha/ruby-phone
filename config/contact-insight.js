/* ========================================================
 * contact-insight.js — [v3.15.0] 联系人互动分析内核（计划 #53）
 * --------------------------------------------------------
 * 动机：计划 #53「联系人互动分析：统计与每个联系人的互动频率 / 最近联系时间，
 *   提醒长期未联系的重要联系人」。
 *   ★ 取证先于动手：本仓的互动痕迹**分散在三处**，且形状各不相同 ——
 *     · 微信：`wechatData.data.chats`（会话，带 `lastMessage` / `timestamp`）
 *       + `wechatData.data.messages`（**按会话分桶**，且懒加载，未加载的会话桶是空的）；
 *     · 短信：`phoneCallData.getSmsConversations()`（**会话套消息**形状）；
 *     · 通话：`phoneCallData.getCallHistory()`（扁平列表）。
 *   三处没有任何地方做过汇总，故「谁很久没联系了」在本仓此前**无从回答**。
 *
 * ★ 本模块的核心纪律（本仓反复治理的同一族缺陷）：
 *   ① **未加载 ≠ 没有消息**。微信正文按会话懒加载（`_messagesLoaded`），
 *      未加载的会话我们**只能算下界**，必须如实标 `partial` ——
 *      按空桶算成「0 条互动」会得到一个**漂亮的假零**：
 *      界面显示「这个联系人从没聊过」，而实际是「还没点进去看过」。
 *   ② **读不到 ≠ 0**。最近联系时间拿不到一律 `null`，**绝不补 0**
 *      （0 是 1970-01-01，会把它算成「已经 55 年没联系了」，是最离谱的错读数）。
 *   ③ **不猜**。昵称对不上就不合并（同名视为不同人；本仓已知存在同名异人的历史），
 *      匹配一律用**会话 id / 联系人 id**，不用昵称模糊匹配。
 *
 * 只读：本模块不写任何 storage（判据在 tests/system-v3150.test.mjs 的「零写入」组）。
 * ============================================================ */

/* 取数口径：**用全仓唯一实现**（config/num-gate.js，v3.12.0 立的纪律）。
 *   本文件初版自带一份同义的 numOrNull，已改为引用 —— 逐处复制即下一个漏网处，
 *   而 test 面的「零弱口径」门禁正是为此存在（scripts/weak-coercion-audit.mjs）。 */
import { numOrNull } from './num-gate.js';

/** 默认「长期未联系」阈值（天）。可被设置覆盖。 */
export const STALE_DAYS_DEFAULT = 30;

/** 默认「重要联系人」判定：互动条数进入前 N。 */
export const IMPORTANT_TOP_N = 5;

function isoDayOf(ts) {
    try {
        const d = new Date(ts);
        const p = (n) => (n < 10 ? '0' + n : String(n));
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    } catch (_e) { return null; }
}

/**
 * 取「最近联系时间」。
 * 依次尝试候选字段；**任何一步拿不到都返回 null**（不回落成 0、不回落成「现在」）。
 * 返回 `{at, via}`：`via` 记明这个时间是从哪个字段读来的（供诊断，防「读数来源不明」）。
 */
export function pickRecentAt(candidates) {
    for (const c of candidates) {
        if (!c) continue;
        const n = numOrNull(c.value);
        // 只认「看起来像毫秒时间戳」的值：> 2001-01-01。更小的值不是时间戳，
        // 多半是序号 / 楼层 / 未初始化的 0 —— 收下它就会造出一条假读数。
        if (n !== null && n > 978307200000) return { at: n, via: c.via };
    }
    return { at: null, via: '' };
}

/**
 * 从三处痕迹收联系人行。
 * @param {{wechat?:object, sms?:Array, calls?:Array}} stores 已取好的三处读数
 *        （取数在视图/控制器侧完成 —— 本内核**不摸宿主**，保持纯函数）
 * @param {{now?:number, staleDays?:number}} opts
 * @returns {{rows:Array, sources:Array, partialWechat:number, empty:boolean}}
 */
export function buildContactInsight(stores, opts = {}) {
    const now = numOrNull(opts.now) !== null ? numOrNull(opts.now) : Date.now();
    const staleDays = numOrNull(opts.staleDays) !== null ? numOrNull(opts.staleDays) : STALE_DAYS_DEFAULT;
    const src = stores || {};
    const byKey = new Map();   // key = 来源域 + id（**不用昵称**，防同名异人合并）
    const sources = [];

    /* ① 微信：会话表给「对象 + 最近时间 + 条数下界」，分桶正文给「已加载会话的真实条数」。 */
    let partialWechat = 0;
    try {
        const wd = src.wechat;
        const chats = (wd && Array.isArray(wd.chats)) ? wd.chats : null;
        if (chats) {
            const buckets = (wd && wd.buckets && typeof wd.buckets === 'object') ? wd.buckets : {};
            const loaded = (wd && Array.isArray(wd.loadedIds)) ? wd.loadedIds : [];
            for (const c of chats) {
                if (!c || typeof c !== 'object') continue;
                const id = String(c.id || '');
                if (!id) continue;
                const isGroup = String(c.type || '') === 'group';
                const bucket = Array.isArray(buckets[id]) ? buckets[id] : null;
                const isLoaded = loaded.indexOf(id) >= 0;
                // 真实条数只有「已加载」时才可算；否则如实 null（下界未知，不是 0）。
                const count = (bucket && isLoaded) ? bucket.length : null;
                if (!isLoaded) partialWechat += 1;
                const rec = pickRecentAt([
                    { value: c.timestamp, via: 'chat.timestamp' },
                    { value: (bucket && bucket.length) ? bucket[bucket.length - 1]?.timestamp : null, via: 'msg.timestamp' }
                ]);
                byKey.set('wechat:' + id, {
                    domain: 'wechat', id: id, name: String(c.name || '未命名'),
                    isGroup: isGroup, count: count, at: rec.at, atVia: rec.via,
                    partial: !isLoaded, anchor: ''
                });
            }
            sources.push({ id: 'wechat', state: 'ok', via: 'wechatData.data.chats' });
        } else {
            sources.push({ id: 'wechat', state: src.wechat === undefined ? 'no-host' : 'face-absent', via: 'wechatData.data.chats' });
        }
    } catch (_e) {
        sources.push({ id: 'wechat', state: 'thrown', via: 'wechatData.data.chats' });
    }

    /* ② 短信：**会话套消息**形状。按会话算条数与最后一条的时间。 */
    try {
        const convs = Array.isArray(src.sms) ? src.sms : null;
        if (convs) {
            for (const conv of convs) {
                if (!conv || typeof conv !== 'object') continue;
                const id = String(conv.id || conv.contactId || conv.name || '');
                if (!id) continue;
                const msgs = Array.isArray(conv.messages) ? conv.messages : [];
                const last = msgs.length ? msgs[msgs.length - 1] : null;
                const rec = pickRecentAt([
                    { value: last && last.timestamp, via: 'sms.last.timestamp' },
                    { value: conv.timestamp, via: 'sms.conv.timestamp' }
                ]);
                byKey.set('sms:' + id, {
                    domain: 'sms', id: id, name: String(conv.name || conv.contactName || '未命名'),
                    isGroup: false, count: msgs.length, at: rec.at, atVia: rec.via,
                    partial: false, anchor: ''
                });
            }
            sources.push({ id: 'sms', state: 'ok', via: 'getSmsConversations()' });
        } else {
            sources.push({ id: 'sms', state: 'face-absent', via: 'getSmsConversations()' });
        }
    } catch (_e) {
        sources.push({ id: 'sms', state: 'thrown', via: 'getSmsConversations()' });
    }

    /* ③ 通话：扁平列表。**只累加次数，不产生新行** ——
     *   通话对象往往没有会话 id，凭空建行会造出没有昵称的幽灵联系人。 */
    try {
        const calls = Array.isArray(src.calls) ? src.calls : null;
        if (calls) {
            for (const call of calls) {
                if (!call || typeof call !== 'object') continue;
                const name = String(call.name || call.contactName || '');
                if (!name) continue;
                // 只挂到**已存在的同名联系人**上（精确相等，不模糊匹配）。
                for (const [key, row] of byKey) {
                    if (row.name !== name) continue;
                    row.calls = (row.calls || 0) + 1;
                    if (!row.at) {
                        const rec = pickRecentAt([{ value: call.timestamp, via: 'call.timestamp' }]);
                        if (rec.at) { row.at = rec.at; row.atVia = rec.via; }
                    }
                    break;
                }
            }
            sources.push({ id: 'calls', state: 'ok', via: 'getCallHistory()' });
        } else {
            sources.push({ id: 'calls', state: 'face-absent', via: 'getCallHistory()' });
        }
    } catch (_e) {
        sources.push({ id: 'calls', state: 'thrown', via: 'getCallHistory()' });
    }

    const rows = [...byKey.values()].map((r) => {
        const days = (r.at === null) ? null : Math.floor((now - r.at) / 86400000);
        return {
            ...r,
            calls: r.calls || 0,
            daysSince: days,
            lastDay: (r.at === null) ? null : isoDayOf(r.at),
            // 三态：unknown（时间读不到）/ fresh（在阈值内）/ stale（超阈值）
            freshness: (days === null) ? 'unknown' : (days >= staleDays ? 'stale' : 'fresh')
        };
    });

    // 排序：**先按可判定的新鲜度分档**（fresh 在前、stale 次之、unknown 最后），
    // 组内按互动条数降序；条数读不到的（null）沉底 —— 绝不让「读不到」顶到最上面。
    const rank = { fresh: 0, stale: 1, unknown: 2 };
    rows.sort((a, b) => {
        const d = rank[a.freshness] - rank[b.freshness];
        if (d !== 0) return d;
        const ca = (a.count === null ? -1 : a.count);
        const cb = (b.count === null ? -1 : b.count);
        if (cb !== ca) return cb - ca;
        return (a.name < b.name) ? -1 : (a.name > b.name ? 1 : 0);
    });

    const counted = rows.filter((r) => r.count !== null);
    const staleRows = rows.filter((r) => r.freshness === 'stale');
    const important = [...counted].sort((a, b) => b.count - a.count).slice(0, IMPORTANT_TOP_N);
    // 「重要的、且已经很久没联系」= 本条计划真正要让用户看见的那一格。
    const staleImportant = important.filter((r) => r.freshness === 'stale');

    return {
        rows: rows,
        sources: sources,
        partialWechat: partialWechat,
        staleCount: staleRows.length,
        staleImportant: staleImportant,
        importantCount: important.length,
        empty: rows.length === 0,
        staleDays: staleDays,
        measuredAt: now
    };
}

/** 总述一句话（视图与注入共用，避免两处各写一套文案）。 */
export function insightSummaryLine(insight) {
    try {
        if (!insight || insight.empty) return '还没有可统计的联系人';
        const parts = [];
        parts.push(insight.rows.length + ' 位联系人');
        if (insight.partialWechat > 0) parts.push(insight.partialWechat + ' 个微信会话尚未加载（条数为下界）');
        if (insight.staleCount > 0) parts.push(insight.staleCount + ' 位超过 ' + insight.staleDays + ' 天未联系');
        return parts.join(' · ');
    } catch (_e) { return ''; }
}

/**
 * 生成侧注入块（可选，受设置开关控制）。
 * 语义：把「关系疏远度」作为**既定事实**告知模型 —— 不是命令模型「去联系谁」。
 * 空内容返回空串（不产生空块），与本仓全部 promptBlock 同规。
 */
export function contactPromptBlock(insight, maxRows = 5) {
    try {
        if (!insight || insight.empty) return '';
        const rows = insight.staleImportant.length
            ? insight.staleImportant
            : insight.rows.filter((r) => r.freshness === 'stale').slice(0, maxRows);
        if (!rows.length) return '';
        const lines = rows.slice(0, maxRows).map((r) => {
            const when = (r.daysSince === null) ? '最近联系时间未知' : (r.daysSince + ' 天未联系');
            const cnt = (r.count === null) ? '互动条数未知' : (r.count + ' 条互动');
            return '· ' + r.name + '（' + when + '，' + cnt + '）';
        });
        return '【系统·联系人互动】\n' + lines.join('\n');
    } catch (_e) { return ''; }
}