/* ============================================================
 * config/context-compose.js — 跨 App 内容生成的单一上下文构建面 [v3.18.0 · R-O4]
 * ------------------------------------------------------------
 * 【为什么需要这一面 / 修前实测后果】
 *   R-O4 取证结论（本仓实跑，不是推断）：四条内容生成路径**各自为政**——
 *     · apps/wechat/chat-view.js        buildMessagesArray()
 *     · apps/weibo/weibo-data.js        _collectContextMessages()
 *     · apps/diary/diary-data.js        _collectChatHistory()
 *     · apps/calendar/calendar-app.js   _collectRecentChatMessages()
 *   四条路径各自写了一遍「从末楼往回取 N 条正文」的循环，而细节互不相同：
 *     过滤条件（个别路径多跳 role === system）、清洗钩子（有的走 applyPhoneTagFilter、
 *     有的只剥 HTML、有的两者都做）、正文裁剪（有的 1800 字、有的不裁）、
 *     条目格式（有的「说话人: 正文」、有的纯正文）。
 *   后果不是崩溃，而是**同一件事在各 App 里说法不同**（本仓最贵形态）：
 *   微信说这一天发生的是 A、日记写的是 B、日程排的是 C —— 三处都「不算错」，
 *   因为三处读的本来就不是同一段上下文；而更贵的是：**没有任何一处能回答**
 *   「现在到底是哪一天」或「这个角色此刻到底知不知道这件事」。
 *
 * 【本模块的职责（只归一、只拼接、不判定）】
 *   ① collectRecentChat() 单一收集循环：循环 / 过滤 / 清洗调用 / 方向（unshift）只有一份，
 *      **条目格式由调用方注入**（`toEntry`）⇒ 各 App 的既有格式逐字不变（零行为漂移）；
 *   ② contextFaces() 统一取数：把「当前剧情时刻」与「谁明确不知情」两面一次取齐，
 *      全走既有真源（config/story-clock.js / config/knowledge-contract.js），本模块不另写一份；
 *   ③ consistencyBlock() 一致性约束块：把两面收成**一段交给生成侧的话**，
 *      让四条路径交给模型的是同一个「现在」与同一份知情边界；
 *   ④ retellNode() / retellChains() 转述来源链：同一件事被多个 App 转述时，
 *      它们必须能被认成**同一条来源链**，而不是「三个互相印证的独立证据」。
 *
 * 【口径纪律（逐条对应本仓治理过的形态）】
 *   ① **不猜**：三源全缺时不写日期（绝不拿现实时间顶替剧情时间 —— 两者不是同一件事）；
 *   ② **不推断**：知情面只列账里**明确记着**不知情的人；silent（有记录但这条事实两边都没记）
 *      与 unrecorded（一条记录都没有）一个字都不进块（把「没记录」写成约束，模型会当事实陈述）；
 *   ③ **不同形**：「转述」与「独立来源」必须不同形（`kind` 如实带出），
 *      否则一条传闻被三个 App 各说一次就会在生成侧「变得更可信」；
 *   ④ **不抛、纯函数化**：畸形输入一律降级；win 由调用方注入，本模块不读全局；
 *   ⑤ **取数口唯一**：日历取数只经 storyClockProbe（本模块绝不自摸宿主对象）；
 *   ⑥ **不重判形态**：快照形态裁定只许有一份（world-bridge 的 faceFieldState），
 *      本模块不得自写「x.snapshot 且 typeof …」那种形状判据（第九道门 J4）。
 *
 * 纯 ESM export，零 window 依赖。
 * ============================================================ */

import { readPushProbe, faceFieldState } from './world-bridge.js';
import { storyClock, storyClockProbe } from './story-clock.js';
import { knowledgeFace, unawareBlock } from './knowledge-contract.js';

function str(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

function clampLimit(v) {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(9999, n);
}

/**
 * 正文归一：**默认只 trim**（逐字保留换行）——
 *   为什么默认不折叠空白：四条既有路径里绝大多数从来不折叠，
 *   而「抽取相同构建步骤」的前提是**行为零漂移**（折叠空白会让同一段正文
 *   在重构前后面目全非，而那种漂移在无头环境下看不出来）。
 *   需要折叠的调用方显式传 `squeeze: true`（本仓折叠空白只发生在既有实现已那样做的地方）。
 */
function normText(text, maxChars, squeeze) {
    let s = String(text == null ? '' : text);
    if (squeeze) s = s.replace(/\s+/g, ' ');
    s = s.trim();
    if (maxChars > 0) s = s.slice(0, maxChars);
    return s;
}

/* ------------------------------------------------------------
 * ① 单一「从末楼往回取」收集循环
 * ------------------------------------------------------------ */
/**
 * 默认条目格式：`说话人: 正文`（微信侧既有格式）。
 * 刻意**不导出** —— 导出就必须被产品侧消费，而它只是 toEntry 的缺省值。
 */
function defaultEntry(e) {
    return {
        role: e.isUser ? 'user' : 'assistant',
        content: (e.isUser ? e.userName : e.charName) + ': ' + e.text,
        isPhoneMessage: true
    };
}

/**
 * 唯一的「最近正文」收集循环。
 *
 * @param {object} context 酒馆上下文（含 `chat`）
 * @param {object} [o]
 *   · limit     取几条（<=0 即不取；缺省 0）
 *   · userName / charName 说话人显示名（缺省取 context.name1/name2）
 *   · clean     `(raw)=>string` 清洗钩子（缺省原样；各 App 各自传 applyPhoneTagFilter 等）
 *   · toEntry   `(e)=>object|null` 条目格式化（缺省 defaultEntry）；返回 null 即丢弃该条
 *   · start/end 区间（用于日记的楼层区段；缺省整段）
 *   · skipSystem 是否跳过 `role === 'system'`（微信侧现状不跳，日记/日程侧跳）
 *   · maxChars  正文裁剪上限（缺省 0 = 不裁；各 App 传自己原本就有的那个值）
 *   · squeeze   是否把连续空白折叠成单空格（缺省 false；只有原本就折叠的路径才传 true）
 *   · limit 传 `Infinity` 表示无上限（日记按楼层区段取全量）
 * @returns {{ messages:Array, scanned:number, skipped:number, taken:number }}
 *   `scanned/skipped/taken` 是**如实计数**（供诊断与套件对账，不用来渲染）
 */
export function collectRecentChat(context, o = {}) {
    const empty = { messages: [], scanned: 0, skipped: 0, taken: 0 };
    try {
        const chat = Array.isArray(context && context.chat) ? context.chat : [];
        /* `Infinity` = 无上限（日记需按区段取全量）；其余一律走归一化闸（不编数） */
        const unbounded = (o.limit === Infinity);
        const limit = unbounded ? Infinity : clampLimit(o.limit);
        if (!(limit > 0) || !chat.length) return empty;
        const userName = str(o.userName) || str(context && context.name1) || '用户';
        const charName = str(o.charName) || str(context && context.name2) || '角色';
        const clean = typeof o.clean === 'function' ? o.clean : null;
        const toEntry = typeof o.toEntry === 'function' ? o.toEntry : defaultEntry;
        const maxChars = Number.isFinite(o.maxChars) ? Math.max(0, Number(o.maxChars)) : 0;
        const squeeze = o.squeeze === true;
        const start = Number.isInteger(o.start) ? Math.max(0, o.start) : 0;
        const end = Number.isInteger(o.end) ? Math.min(chat.length, Math.max(start, o.end)) : chat.length;
        const out = [];
        let scanned = 0;
        let skipped = 0;
        for (let i = end - 1; i >= start && out.length < limit; i -= 1) {
            const msg = chat[i];
            scanned += 1;
            /* 手机/记忆插件内部消息一律跳过（条路径的既有共识，逐字保留） */
            if (!msg || msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) { skipped += 1; continue; }
            if (o.skipSystem && msg.role === 'system') { skipped += 1; continue; }
            const raw = String(msg.mes || msg.content || '');
            if (!raw) { skipped += 1; continue; }
            let text = clean ? clean(raw) : raw;
            text = normText(text, maxChars, squeeze);
            if (!text) { skipped += 1; continue; }
            const isUser = !!(msg.is_user || msg.role === 'user');
            const entry = toEntry({ msg, text, isUser, userName, charName, index: i });
            if (!entry) { skipped += 1; continue; }
            out.unshift(entry);
        }
        return { messages: out, scanned, skipped, taken: out.length };
    } catch (_e) { return empty; }
}

/* ------------------------------------------------------------
 * ② 统一取数（两面一次取齐，全走既有真源）
 * ------------------------------------------------------------ */
/**
 * 把「当前剧情时刻」与「知情面」一次取齐。
 *
 * 为什么不各自取一次：本仓 v2.97 的教训是**同一口径抄 N 份必然漂移**；
 * 这两面在此前实测各只有 1 个 / 3 个消费点，正是最容易被各 App 再抄一份的形态。
 *
 * @param {object} [win] 宿主 window（缺省由 storyClockProbe 回落全局）
 * @returns {{ clock:object|null, knowledge:{state:string, people:Array, silentCapable:boolean} }}
 *   `clock` 为 `storyClock()` 的原样结果（本模块**不裁不改**，裁决全在真源）；
 *   `knowledge.people` 为 `knowledgeFace()` 的原样 `people`（同样不裁）。
 */
export function contextFaces(win) {
    const clock = (() => {
        try {
            const p = storyClockProbe(win);
            return storyClock({ win: p.win, calendarSource: p.calendarSource });
        } catch (_e) { return null; }
    })();
    const knowledge = (() => {
        try {
            const p = readPushProbe(win);
            const snap = (p && p.hasSnapshot) ? p.snapshot : null;
            /* 形态裁定只许一份：面级三态走真源 faceFieldState，本模块不自写形状判据 */
            const faceState = snap ? faceFieldState(snap, ['worldProg']) : '';
            const world = (snap && typeof snap === 'object' && snap.worldProg && typeof snap.worldProg === 'object')
                ? snap.worldProg : null;
            const f = knowledgeFace({
                mounted: (p && typeof p.mounted === 'boolean') ? p.mounted : undefined,
                hasSnapshot: !!(p && p.hasSnapshot),
                worldProg: world,
                faceState
            });
            return { state: f.state, people: f.people, silentCapable: f.silentCapable === true };
        } catch (_e) { return { state: 'bridge-absent', people: [], silentCapable: false }; }
    })();
    return { clock, knowledge };
}

/* ------------------------------------------------------------
 * ③ 一致性约束块（给生成侧的一段话）
 * ------------------------------------------------------------ */
/** 块的抬头（消费侧读它判断块是否在场，不得在别处手写第二份字面量） */
export const CONSISTENCY_HEAD = '【跨 App 同一事实（本机各 App 的内容不得互相否定）】';

/**
 * 把「当前剧情时刻 + 明确不知情的人 + 转述链」收成一段约束（无内容返回空串，不产生空块）。
 *
 * 三条边界：
 *   · 三源全缺（`primary === null`）时**不写日期** —— 那句「三处全缺」对生成侧毫无约束力，
 *     写进去只会让模型以为「今天」；
 *   · 冲突（`conflict === true`）时**必须说出来**，并要求写作前先确认（不得同时采用两个日期）；
 *   · 知情面只列**明确记录**的那一档（silent / unrecorded 一个字不进）。
 *
 * @param {object} [win] 宿主 window
 * @param {object} [o] `{ faces?, fact?, retells?, maxChars? }`
 *   `faces` 可直接给 `contextFaces()` 的结果（同一份读数上多面同源，避免各 App 各取一次）；
 *   `fact` 是本次要生成的那件事（用于查「谁明确不知情」）；
 *   `retells` 是同一条传闻的各平台转述（走 retellNode 归一后归链）。
 * @returns {string}
 */
export function consistencyBlock(win, o = {}) {
    try {
        const faces = (o.faces && typeof o.faces === 'object') ? o.faces : contextFaces(win);
        const parts = [];
        const clk = faces && faces.clock;
        /* 只在**真有来源给出日期**时注入；`primaryDate` 是该来源的原值（不裁不改） */
        if (clk && clk.primary && clk.primaryDate) {
            const tail = clk.conflict
                ? '（**多处读数互相矛盾**：写作前须先确认哪一个是当前，不得同一段里同时采用两个日期）'
                : '';
            parts.push('- 当前剧情时刻：' + str(clk.primaryDate, 80) + tail);
        }
        const kn = faces && faces.knowledge;
        const fact = str(o.fact, 120);
        if (kn && Array.isArray(kn.people) && kn.people.length && fact) {
            const line = unawareBlock(kn.people, fact, { maxChars: 200 });
            if (line) parts.push(line);
        }
        const chains = retellChains(o.retells);
        if (chains.text) parts.push(chains.text);
        if (!parts.length) return '';
        return CONSISTENCY_HEAD + '\n' + parts.join('\n');
    } catch (_e) { return ''; }
}

/* ------------------------------------------------------------
 * ④ 转述来源链
 * ------------------------------------------------------------ */
/**
 * 一条落地内容的**来源身份**（转述链的最小单位）。
 *
 * 为什么必须存在：世界脉搏的一条事件会被推送成微博动态，又可能被朋友圈转述、
 * 被聊天提到。三者各自都有 `id`，于是生成侧看到的是「三个不同来源在说同一件事」——
 * 同一件传闻被转述三次就「变得更可信」（本仓最贵的那类错读数）。
 * 本函数把每条内容的来源身份如实取出来，`kind` 三态**必须不同形**：
 *   · original —— 本机第一次陈述这件事（这条自己就是来源）
 *   · retold   —— 这件事已有更早的来源（`origin` 指向它）
 *   · unknown  —— 条目里没有任何来源身份（旧数据），如实报「认不出」
 *
 * @param {object} raw 落地条目（微博帖 / 朋友圈 / 世界脉搏条目）
 * @param {{platform?:string, origin?:string}} [o]
 * @returns {{ platform:string, sourceId:string, origin:string, kind:string, chainId:string }}
 */
export function retellNode(raw, o = {}) {
    const miss = { platform: 'unknown', sourceId: '', origin: '', kind: 'unknown', chainId: '' };
    try {
        const r = (raw && typeof raw === 'object') ? raw : {};
        const platform = str(o.platform) || str(r.platform) || 'unknown';
        const sourceId = str(r.sourceId || r.id, 80);
        const origin = str(o.origin || r.origin || r.retellOf, 80);
        const kind = origin ? 'retold' : (sourceId ? 'original' : 'unknown');
        /* chainId：转述指向来源；原件以「平台:自身 id」为链名 —— 同一件事的不同转述因此可归并 */
        const chainId = origin || (sourceId ? (platform + ':' + sourceId) : '');
        return { platform, sourceId, origin, kind, chainId };
    } catch (_e) { return miss; }
}

/**
 * 把一组落地条目归成**来源链**，并回答「有几条链被多个平台各陈述了一次」。
 *
 * 验收对齐：同一传闻三平台转述**只算同一来源链**（不是三个独立证据）。
 * 无来源身份的条目如实进 `unknown`，**不计入链**（认不出就是认不出，不硬塞进某条链）。
 *
 * 【为什么「来源端点入链」也在这里，而不在消费方】
 *   一条转述的 `origin` 形如 `worldpulse:xxx` —— 那个源头**本身也在本机落地过**
 *   （世界脉搏推给微博的那条事件）。若只把转述方入链，链上就只剩一端，
 *   「同一件事」看不出来。首版把这段逻辑写在微博数据层里，结果撞上了
 *   `scripts/source-derivation-audit.mjs` 的枚举面（源码里出现源身份字段 + 集合操作
 *   = 疑似派生库）—— 那是**门禁正确地提醒**：一组「按源身份归并」的规则
 *   只能有一份实现，写在消费方就是下一处漂移的种子。故上收到本函数。
 *
 * @param {Array} nodes
 * @returns {{ nodes:Array, chains:Array, chainCount:number, retoldChains:number, unknown:number, text:string }}
 */
export function retellChains(nodes) {
    const empty = { nodes: [], chains: [], chainCount: 0, retoldChains: 0, unknown: 0, text: '' };
    try {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return empty;
        const norm = list.map((n) => retellNode(n));
        const map = new Map();
        let unknown = 0;
        const add = (chain, plat) => {
            if (!chain || !plat) return;
            if (!map.has(chain)) map.set(chain, []);
            const arr = map.get(chain);
            if (!arr.includes(plat)) arr.push(plat);
        };
        for (const n of norm) {
            if (!n.chainId) { unknown += 1; continue; }
            add(n.chainId, n.platform);
            /* 来源端点也入链（否则链上只剩转述方，「同一件事」就看不出来） */
            if (n.origin) {
                const cut = n.origin.indexOf(':');
                if (cut > 0) add(n.origin, n.origin.slice(0, cut));
            }
        }
        const chains = [...map.entries()].map(([chainId, platforms]) => ({ chainId, platforms: platforms.slice(), count: platforms.length }));
        const retoldChains = chains.filter((c) => c.count > 1).length;
        let text = '';
        if (retoldChains) {
            const rows = chains.filter((c) => c.count > 1).slice(0, 3)
                .map((c) => c.chainId + '（' + c.platforms.join('、') + '）');
            text = '- 以下内容是**同一条来源链的转述**（不是互相印证的多个独立证据，'
                + '不得因「多处都在说」而当作已确证）：' + rows.join('；');
        }
        return { nodes: norm, chains, chainCount: chains.length, retoldChains, unknown, text };
    } catch (_e) { return empty; }
}

export default {
    CONSISTENCY_HEAD,
    collectRecentChat,
    contextFaces,
    consistencyBlock,
    retellNode,
    retellChains
};
