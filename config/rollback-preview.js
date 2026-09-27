/* ============================================================
 * config/rollback-preview.js — 回滚影响的**只算不执行**预览面
 *                                     [v3.11.0 · F-1 替代轴落地]
 * ------------------------------------------------------------
 * 【治的欠债】F-1（分支与玩法）在 v3.9.0 取证后判定 `not_now`：三件里两件要接的面不存在。
 *   但取证同轮留下了一条**有读数支持的替代轴**（`FOUR_RELEASE_PLAN.md` Gate F-1「替代轴」）：
 *
 *     下游 41 个回滚点已有确定的「按楼层作废」语义，缺的从来不是引擎而是**读前即知** ——
 *     在删楼 / 翻页 / 重生成之前，把「这次动作会让哪些域各丢几条」在**下游自己的数据上**
 *     算一遍并呈现（**只呈现、不执行**）。
 *
 *   修前的真实处境：用户在删楼之前**无从知道**这会连带作废多少手机短信、多少微信正文、
 *   多少条朋友圈动态、多少条钱包流水、多少条任务进度 —— 而这些域全都在删楼那条路径上被
 *   同时清掉（`index.js` 的 MESSAGE_DELETED / SWIPED / rollback 三处）。用户看到的是
 *   「我删了一楼」，实际发生的是「我删了一楼 **并且** 五个域各少了一截」。前者是用户的意图，
 *   后者是系统的行为 —— 两者之间此前没有任何可见面。
 *
 * 【口径纪律（本模块全部输出都是**读数**，不是判定）】
 *   ① **只算不写**：不 import 任何 store、不调任何回滚入口、不碰 localStorage。
 *      它只接收调用方**已经取好的数据**（各域数组），算「若按某楼层作废会少几条」。
 *      预览一旦自己会写，它就同时成了第二份真源（v2.97 的 7 份 probeBridge 各自为政）。
 *   ② **不猜**：取不到的域如实报 `absent`，**不得**报 0 条 —— 「这个域没有可作废的东西」
 *      与「这个域我读不到」是两件事，处置相反（前者什么都不做，后者要去看桥）。
 *   ③ **口径与真实现同源**：每域的「会丢几条」必须逐条复用该域作废时的**同一谓词**
 *      （短信：正文标记 + 楼层；微信正文：同；朋友圈动态：同；钱包流水：同；
 *      任务进度：**只有楼层**，它本来就没有正文标记）。若在这里另写一份「大概是这样」的
 *      过滤条件，读数就会与真回滚漂移 —— 那个漂移是**看不见的**（预览说 0、真回滚清 30 条），
 *      比不做预览更坏。
 *   ④ **只呈现不执行**：本模块没有任何执行出口，导出面上不存在任何动词。
 *      这不是「还没实现」——是这条轴的**设计**（F-1 取证结论：面不存在，不自造回退语义）。
 *   ⑤ **读数不完整要说出来**（`partial` 态）：微信正文按会话懒加载，未加载的会话在内存里
 *      没有消息桶。此时**只算已加载部分并显式标注这是下界**，绝不静默给出一个偏低但看起来
 *      完整的数字（「漂亮的假零」的邻形态）。
 *
 * 【刻意不做的事（不是遗漏，是纪律）】
 *   · 不弹窗、不打断：与 `config/silence-guard.js` 同族 —— 把「安静地知道」换成
 *     「吵闹地知道」没有价值；
 *   · 不给行动号召（「要删吗？」）：本模块只回答「会少几条」；
 *   · 不自动回滚 / 不自动备份：那是执行面，本轴明确不做；
 *   · **不报金额**：钱包流水作废时会反向冲回余额，报金额要重算余额 ⇒ 那已经是在预演副作用，
 *     而副作用是否与真回滚逐分一致、本层无法自证。如实少报一层，好过给出一个没人能核对的数。
 *
 * 【★ 一条影响读数的写法纪律（免得下一个人踩）】
 *   本文件的注释**刻意不写那几个回滚入口的函数名**。理由：
 *   `tests/audit/branch_play_probe.cjs` 统计「回滚覆盖面」时逐行做**子串匹配**，
 *   且只跳过以 `//` 开头的行（**块注释行不跳**）。若在这里写上那些函数名，
 *   读数就会把**预览面的散文**算成**回滚实现点** —— 那正是本仓最忌的「判据面被散文侵入」
 *   （v3.9.0 的 B4 负控制就是为这一类立的）。故此处只写「哪个文件 + 什么动作」，
 *   逐字函数名与谓词对照见 `ITERATION_LOG.md` 迭代 59。
 * ============================================================ */
'use strict';

/* ── 宿主窗口（与 config/story-clock.js 的探针同规格：注入优先、回落全局） ── */
function hostWindow(win) {
    if (win && typeof win === 'object') return win;
    return (typeof window !== 'undefined') ? window : null;
}

/* ── 楼层归一（唯一实现）：**缺失与 0 是两件事** ──
 *   `Number(null) === 0`、`Number('') === 0`、`Number([]) === 0` —— 直接 Number 化会把
 *   「没给楼层」静默变成「第 0 楼」，于是预览给出一份「第 0 楼不影响任何域」的漂亮读数
 *   （而真实情况是「我们根本没拿到楼层，作废范围未知」）。故先把这几种写法规一为 NaN。 */
function floorNum(raw) {
    if (raw === null || raw === undefined || raw === '') return NaN;
    return Number(raw);
}
/* ── 楼层谓词（唯一实现；`exact` 对应「编辑重放该楼」而非「回滚到该楼」） ── */
function floorMatch(raw, floor, exact) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return false;
    return exact ? n === floor : n >= floor;
}

/* ── 通用计数：接受数组，或 `{messages: []}` 形 ──
 *   非数组且无 `messages` 数组 ⇒ **null（读不到）**，不是 0。
 *   `[]`（读到了、但一条都没有）⇒ 0（**真的是 0 条**）。两者的区分是本模块的核心纪律之一。 */
function countByFloor(data, floor, exact, pred) {
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.messages) ? data.messages : null);
    if (!list) return null;
    let n = 0;
    for (const it of list) if (pred(it) && floorMatch(it?.tavernMessageIndex, floor, exact)) n += 1;
    return n;
}

/* ── 会话套消息（短信域专用）：先遍历会话、再遍历它的 messages，与真实现的遍历顺序同构 ──
 *   ★ 形状注意：短信域拿到的是 **conversations 数组**（每个会话带自己的 `messages`），
 *   不是扁平的 message 列表。若按扁平列表数，会话对象本身没有正文标记 ⇒ 读数恒 0 条
 *   （一个**漂亮的假零**：预览说「不会丢东西」，真回滚清掉一串）。 */
function countInConversations(data, floor, exact, pred) {
    if (!Array.isArray(data)) return null;
    let n = 0;
    for (const conv of data) {
        const msgs = conv && Array.isArray(conv.messages) ? conv.messages : [];
        for (const m of msgs) if (pred(m) && floorMatch(m?.tavernMessageIndex, floor, exact)) n += 1;
    }
    return n;
}

/* ── 微信正文（按会话分桶 + 懒加载标记）：**未加载的会话只报下界** ──
 *   形状来自取数口：`{buckets: {chatId: [msg]}, loadedIds: [chatId], totalChats: n}`。
 *   为什么不去调按会话取消息的那个出口：它会**触发懒加载、给旧消息补 id、并把刷新后残留的
 *   「生成中」状态改写成失败，随后落盘** —— 预览面一旦走它就违反了「只算不写」
 *   （打开诊断页就成了「打开一下就改了数据」）。故此处只读内存桶。
 *   代价是：未加载的会话算不到 ⇒ 如实返回 `{count, partial:true, note}`，
 *   由 `previewRollback` 标成 `partial` 态并说明「这是下界」。 */
function countInWechatBuckets(data, floor, exact, pred) {
    if (!data || typeof data !== 'object') return null;
    const buckets = data.buckets;
    if (!buckets || typeof buckets !== 'object') return null;
    const loaded = Array.isArray(data.loadedIds) ? data.loadedIds : [];
    let n = 0;
    for (const chatId of Object.keys(buckets)) {
        if (loaded.indexOf(chatId) < 0) continue;   // 未标记已加载 ⇒ 桶可能不完整，不计入（下界）
        const list = buckets[chatId];
        if (!Array.isArray(list)) continue;
        for (const m of list) if (pred(m) && floorMatch(m?.tavernMessageIndex, floor, exact)) n += 1;
    }
    const total = Number(data.totalChats) || 0;
    const unloaded = Math.max(0, total - loaded.length);
    return unloaded > 0
        ? { count: n, partial: true, note: '有 ' + unloaded + ' 个会话尚未加载到内存（只算了已加载的）' }
        : n;
}

/* ── 五域登记表（单一真源；每域的「怎么数」写在同一个条目上，不散落在各处） ──
 *   逐域谓词与真实现的对应关系（中文写，见文件头那条写法纪律）：
 *     · sms              ← `apps/phone/phone-data.js` 的**两个短信作废入口**
 *                          （一个精确到该楼、一个该楼及之后），两者都要求正文标记为真；
 *     · wechatMessages   ← `apps/wechat/wechat-data.js` 的正文作废入口（按会话分桶）；
 *     · wechatMoments    ← 同文件的朋友圈作废段；
 *     · walletTransactions ← 同文件的钱包流水作废段（内部方法；本预览只条数、不金额）；
 *     · taskProgress     ← `apps/wangxiang/wangxiang-app.js` 的任务进度历史作废段。
 *   任务进度**没有**正文标记（它的来源本来就只有一处），故谓词只有楼层一条 ——
 *   这是与其它四域的**结构差异**，在此显式写明，免得下一个人以为漏了条件。 */
const ROLLBACK_DOMAINS = Object.freeze([
    Object.freeze({
        id: 'sms',
        label: '手机短信（正文产出）',
        count: (data, floor, exact) => countInConversations(data, floor, exact, (m) => m?.fromMainChatTag === true)
    }),
    Object.freeze({
        id: 'wechatMessages',
        label: '微信正文消息',
        count: (data, floor, exact) => countInWechatBuckets(data, floor, exact, (m) => m?.fromMainChatTag === true)
    }),
    Object.freeze({
        id: 'wechatMoments',
        label: '微信朋友圈动态',
        count: (data, floor, exact) => countByFloor(data, floor, exact, (m) => m?.fromMainChatTag === true)
    }),
    Object.freeze({
        id: 'walletTransactions',
        label: '钱包流水',
        count: (data, floor, exact) => countByFloor(data, floor, exact, (r) => r?.fromMainChatTag === true)
    }),
    Object.freeze({
        id: 'taskProgress',
        label: '忘向 · 任务进度历史',
        count: (data, floor, exact) => countByFloor(data, floor, exact, () => true)
    })
]);

/* ── 当前楼层（**取数口唯一**；诊断面不再自己摸宿主） ──
 *   0 基、与 SillyTavern 一致；**0 是合法楼层**。
 *   ★ 空会话 ⇒ 返回 null（**没有楼层可算**），不得兜底成 0 ——
 *   「空」与「第 0 楼」是两件事，兜底成 0 会凭空造出一个「可作废的楼层」。 */
export function currentFloorOf(win) {
    const w = hostWindow(win);
    try {
        const st = (w && w.SillyTavern && typeof w.SillyTavern.getContext === 'function') ? w.SillyTavern
            : ((typeof SillyTavern !== 'undefined' && SillyTavern && typeof SillyTavern.getContext === 'function') ? SillyTavern : null);
        const ctx = st ? st.getContext() : null;
        const chat = ctx && Array.isArray(ctx.chat) ? ctx.chat : null;
        if (!chat || chat.length === 0) return null;
        return chat.length - 1;
    } catch (_e) { return null; }
}

/* ── 五域取数口（**唯一实现**；诊断内核只调它，不自己摸宿主单例） ──
 *   每个域独立降级，返回值**结构恒定**（缺的域一律 null）；`sources` 逐域带出归因，
 *   供卡片显示「这一格是从哪个出口读的、读到了还是读不到」。
 *   归因取值：`ok` / `no-host`（宿主都没挂）/ `face-absent`（宿主在、这一层没给）/ `thrown`。 */
export function readRollbackStores(win) {
    const w = hostWindow(win);
    const vp = (w && w.VirtualPhone) || null;
    const sources = [];
    const mark = (id, state, via) => { sources.push({ id: id, state: state, via: via || '' }); };

    /* ① 短信：走通话数据层的公开读出口。 */
    let sms = null;
    try {
        const pcd = vp && vp.phoneApp && vp.phoneApp.phoneCallData;
        const v = (pcd && typeof pcd.getSmsConversations === 'function') ? pcd.getSmsConversations() : null;
        if (Array.isArray(v)) { sms = v; mark('sms', 'ok', 'phoneCallData.getSmsConversations()'); }
        else mark('sms', vp ? 'face-absent' : 'no-host', 'phoneCallData.getSmsConversations()');
    } catch (_e) { mark('sms', 'thrown', 'phoneCallData.getSmsConversations()'); }

    /* ② 微信三域共用同一个数据实例（与全仓其它消费方同一条解析顺序：
     *   微信 App 持有的实例优先、缓存实例兜底）。 */
    const wd = (vp && ((vp.wechatApp && vp.wechatApp.wechatData) || vp.cachedWechatData)) || null;

    let wechatMessages = null;
    try {
        if (wd && wd.data && wd.data.messages && typeof wd.data.messages === 'object') {
            const loaded = (wd._messagesLoaded && typeof wd._messagesLoaded === 'object') ? wd._messagesLoaded : {};
            const chats = Array.isArray(wd.data.chats) ? wd.data.chats : [];
            const loadedIds = Object.keys(wd.data.messages).filter((id) => loaded[id] === true);
            wechatMessages = { buckets: wd.data.messages, loadedIds: loadedIds, totalChats: chats.length };
            mark('wechatMessages', 'ok', 'wechatData.data.messages + _messagesLoaded');
        } else mark('wechatMessages', vp ? 'face-absent' : 'no-host', 'wechatData.data.messages');
    } catch (_e) { mark('wechatMessages', 'thrown', 'wechatData.data.messages'); }

    let wechatMoments = null;
    try {
        const v = (wd && typeof wd.getMoments === 'function') ? wd.getMoments() : null;
        if (Array.isArray(v)) { wechatMoments = v; mark('wechatMoments', 'ok', 'wechatData.getMoments()'); }
        else mark('wechatMoments', vp ? 'face-absent' : 'no-host', 'wechatData.getMoments()');
    } catch (_e) { mark('wechatMoments', 'thrown', 'wechatData.getMoments()'); }

    let walletTransactions = null;
    try {
        const v = (wd && typeof wd.getWalletTransactions === 'function') ? wd.getWalletTransactions() : null;
        if (Array.isArray(v)) { walletTransactions = v; mark('walletTransactions', 'ok', 'wechatData.getWalletTransactions()'); }
        else mark('walletTransactions', vp ? 'face-absent' : 'no-host', 'wechatData.getWalletTransactions()');
    } catch (_e) { mark('walletTransactions', 'thrown', 'wechatData.getWalletTransactions()'); }

    /* ③ 任务进度：忘向 App 的公开字段（它没有专用读出口）。 */
    let taskProgress = null;
    try {
        const wa = vp && vp.wangxiangApp;
        const v = wa ? wa.taskProgressHistory : null;
        if (Array.isArray(v)) { taskProgress = v; mark('taskProgress', 'ok', 'wangxiangApp.taskProgressHistory'); }
        else mark('taskProgress', vp ? 'face-absent' : 'no-host', 'wangxiangApp.taskProgressHistory');
    } catch (_e) { mark('taskProgress', 'thrown', 'wangxiangApp.taskProgressHistory'); }

    return {
        host: !!vp,
        sms: sms,
        wechatMessages: wechatMessages,
        wechatMoments: wechatMoments,
        walletTransactions: walletTransactions,
        taskProgress: taskProgress,
        sources: sources
    };
}

/**
 * 算一次「按楼层作废」在各域的影响面。
 *
 * **本函数只读不写**：`store` 里的每个域都是调用方已经取好的数据（或 `null`）。
 *   调用方负责取数（诊断中心走 `readRollbackStores`），本模块负责算 —— 分工与
 *   `config/silence-guard.js`（只读 pkg、不自己摸桥）同族。
 *
 * @param {object} store 形如 `{ sms, wechatMessages, wechatMoments, walletTransactions, taskProgress }`
 *   —— 每个键可以是数组（直接数）、微信正文那种分桶对象、或 `null` / `undefined`（**读不到**，
 *   与「读到了但为空」不同）；
 * @param {number} floor 目标楼层（**0 基**，与 SillyTavern 一致；0 是合法楼层）；
 * @param {{exact?:boolean}} [opts] `exact:true` ⇒ 只算**正好该楼**（编辑重放语义）；
 *   默认 `false` ⇒ 算 **该楼及之后**（删楼 / 回滚语义）。
 * @returns {{floor:number|null, exact:boolean, floorOk:boolean, domains:Array, total:number|null,
 *   readable:number, partial:number, anyData:boolean, allAbsent:boolean}} 读数面（**非**判定面）
 */
export function previewRollback(store, floor, opts) {
    const f = floorNum(floor);
    const exact = !!(opts && opts.exact);
    const src = (store && typeof store === 'object') ? store : {};
    const base = { floor: Number.isFinite(f) ? f : null, exact: exact };
    /* 楼层不合法（含 `null` / `undefined` / `''`，经 `floorNum` 归一）⇒ 整份读数标记为不可算
     *  （**不**退化成 0 条：0 条是个结论，这里的问题是
     *   「你给的楼层不是个楼层」，两者处置相反 —— 与全仓 `numOrNull` 同族纪律）。 */
    if (!Number.isFinite(f)) {
        return {
            ...base, floorOk: false,
            domains: ROLLBACK_DOMAINS.map((d) => ({ id: d.id, label: d.label, state: 'no-floor', count: null, note: '' })),
            total: null, readable: 0, partial: 0, anyData: false, allAbsent: true
        };
    }
    const domains = ROLLBACK_DOMAINS.map((d) => {
        let n = null;
        let partial = false;
        let note = '';
        try {
            const r = d.count(src[d.id], f, exact);
            /* ★ 判空必须**先于**数值化：`Number(null) === 0`，直接走「数值化」那条支路会把
             *   「这个域读不到」静默算成「0 条」，状态于是被标成 `zero`（真的是 0 条）而不是
             *   `absent`（读不到）—— 两者处置相反，正是本模块文件头第 ② 条纪律要挡的形态。
             *   （同一族缺陷在楼层入参处已修过一次，这里是残留的第二处：上面那条 `Number` 化
             *   分支必须排在判空之后。） */
            if (r === null || r === undefined) {
                n = null;
            } else if (r && typeof r === 'object' && Number.isFinite(Number(r.count))) {
                n = Number(r.count);
                partial = r.partial === true;
                note = String(r.note || '');
            } else if (Number.isFinite(Number(r))) {
                n = Number(r);
            } else {
                n = null;
            }
        } catch (_e) { n = null; }
        /* 四态（与全仓 `faceFieldState` / `sourceState` 同规格）：
         *   absent  —— 这个域没数据 / 读不到（**不是** 0 条）；
         *   partial —— 读到了，但读数不完整（只算得出下界）；
         *   zero    —— 域有数据，但这一楼不会让它少任何东西（真的是 0 条）；
         *   hit     —— 会少 n 条。
         *   为什么必须分开：混起来就会出现「预览说没影响，用户放心删，实际那个域压根没被
         *   读到」或「预览给了一个偏低但看起来完整的数字」—— 这正是本仓治理过多轮的**静默降级**。 */
        let state;
        if (n === null) state = 'absent';
        else if (partial) state = 'partial';
        else if (n === 0) state = 'zero';
        else state = 'hit';
        return { id: d.id, label: d.label, state: state, count: n, note: note };
    });
    const readable = domains.filter((d) => d.state !== 'absent').length;
    const total = domains.reduce((a, d) => a + (typeof d.count === 'number' ? d.count : 0), 0);
    return {
        ...base, floorOk: true,
        domains: domains,
        total: total,
        readable: readable,
        partial: domains.filter((d) => d.state === 'partial').length,
        anyData: domains.some((d) => d.state !== 'absent'),
        allAbsent: readable === 0
    };
}

/**
 * 一次取齐「当前楼的影响面」（取数 + 楼层 + 两种语义），供诊断面**一次调用**拿到全部读数。
 *   `rollback` = 该楼及之后（删楼 / 回滚）；`replay` = 只该楼（编辑重放）。
 *   两者**都算**而不是让消费方自己挑：挑错语义就会给出一个方向相反的建议
 *   （「只丢 2 条」vs「丢 30 条」），而它们读的是同一份数据、同一套谓词，成本相同。
 */
export function rollbackPreviewFace(win) {
    const w = hostWindow(win);
    const floor = currentFloorOf(w);
    const store = readRollbackStores(w);
    return {
        host: store.host,
        floor: floor,
        floorOk: floor !== null && Number.isFinite(Number(floor)),
        rollback: previewRollback(store, floor, { exact: false }),
        replay: previewRollback(store, floor, { exact: true }),
        sources: store.sources,
        readings: store.sources.filter((s) => s.state === 'ok').length
    };
}

/**
 * 一行读数（供卡片 / 日志 / 测试**共用同一个实现**）。
 *   与 `storyClockFaceText` 同规格：文案只有一份，视图不自己拼。
 *   四态文案各不相同，且**缺席不说 0、下界不说「就是这些」**。
 */
export function rollbackPreviewLine(pv) {
    if (!pv || typeof pv !== 'object') return '回滚预览：无读数';
    if (pv.floorOk !== true) return '回滚预览：楼层不可算（不是 0 条，是没给楼层）';
    if (pv.allAbsent) return '回滚预览：五个域全部读不到（看不清，不是「没影响」）';
    const scope = pv.exact ? '正好该楼' : '及之后';
    const hits = pv.domains.filter((d) => d.state === 'hit' || d.state === 'partial');
    const fewer = pv.readable < pv.domains.length
        ? '（' + (pv.domains.length - pv.readable) + ' 个域读不到）' : '';
    if (!hits.length) {
        if (pv.partial > 0) {
            const p = pv.domains.find((d) => d.state === 'partial');
            return '回滚预览：这一层 ' + scope + ' 已加载部分无正文产出可作废，'
                + '但读数不完整（' + p.label + '：' + p.note + '）' + fewer;
        }
        return '回滚预览：这一层 ' + scope + ' 无正文产出可作废' + fewer;
    }
    const parts = hits.map((d) => d.label + ' ' + d.count + ' 条');
    const tail = pv.partial > 0
        ? '（合计 ' + pv.total + ' 条，其中 ' + pv.partial + ' 个域是下界 —— '
          + pv.domains.filter((d) => d.state === 'partial').map((d) => d.note).join('；') + '；只报不动手）'
        : '（合计 ' + pv.total + ' 条，只报不动手）';
    return '回滚预览：这一层 ' + scope + '会让 ' + parts.join(' / ') + ' 作废' + tail + fewer;
}

/**
 * 逐域明细（结构化，供表格 / 断言；**与 `rollbackPreviewLine` 同源**，不另算一遍）。
 *   返回 `[{id,label,state,count,note,text}]`，`text` 是每域一句话（四态**不同形**）。
 */
export function rollbackPreviewTable(pv) {
    if (!pv || !Array.isArray(pv.domains)) return [];
    return pv.domains.map((d) => ({
        id: d.id, label: d.label, state: d.state, count: d.count, note: d.note || '',
        text: (d.state === 'no-floor') ? '楼层不可算（不是 0 条）'
            : (d.state === 'absent') ? '读不到（不等于 0 条）'
                : (d.state === 'partial') ? ('至少 ' + d.count + ' 条（' + (d.note || '读数不完整') + ' ⇒ 已加载部分是下界）')
                    : (d.state === 'zero') ? '0 条（这一楼不影响它）'
                        : (d.count + ' 条会作废')
    }));
}

export default {
    previewRollback,
    rollbackPreviewFace,
    rollbackPreviewLine,
    rollbackPreviewTable,
    readRollbackStores,
    currentFloorOf
};