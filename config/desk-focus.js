/* =========================================================
 * config/desk-focus.js — [v3.99.0 · R3-O9] 手机桌面与返回路径减负（**纯函数**）
 * ---------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   桌面（phone/home-screen.js）到 v3.98 为止是**全量平铺**：`config/task-entry.js`
 *   定义了 7 组任务卡（找往事 / 整理素材 / 今天的事 / 余额 / 人脉 / 创作 / 看诊），
 *   每一组又挂 3~5 个 App 目标 —— 一个没收藏、没使用记录的新会话，第一屏就是
 *   「把 80+ 入口一次铺给你」，而验收原文要的是「**三步内**完成找联系人 / 看今天 /
 *   继续创作」。两组缺口：
 *     ① **没有「先看什么」的默认秩序**：四类高频任务（聊天 / 今天 / 记录 / 创作）
 *        与该被收进工具区的案头（看诊 / 素材 / 余额）在同一屏里等权排列；
 *     ② **没有「按卡隐藏」的能力** —— 用户要么全看，要么去删数据。
 *   返回路径一侧同样缺一处：桌面/App 的多层返回此前只能「一路退到首页」，
 *   **原页签 / 查询 / 滚动 / 编辑草稿**在退栈后没有一处统一口径可恢复
 *   （每个页面各写一遍恢复逻辑，必然漂移）。
 *
 * 【本模块只做两件事（不新建入口 App、不做路由框架）】
 *   ① **默认聚焦**：`focusOf(cards, ctx)` 把七组卡分成
 *      `focus`（聊天 / 今天 / 记录 / 创作四类，默认在首屏）与 `tools`（其余案头，收进工具区），
 *      并允许 `hidden` 按卡隐藏（**隐藏只是不显示，不删任何数据与使用记录**）；
 *   ② **返回路径恢复读数**：`restorePlan(before, after)` 说明「原页签 / 查询 / 滚动 / 草稿」
 *      四格哪些恢复得住、哪些恢复不住 —— **看不见读数时「恢复了」与「被静默重置」同形**。
 *
 * 【刻意不做的事（边界，逐条对齐计划原文）】
 *   · **不是「再添一个入口 App」**：本模块是纯函数，不注册 App、不占地盘；
 *   · **不删数据**：隐藏只看 `hidden` 名单，`task-entry.js` 的收藏与使用台账**一字不动**；
 *   · **不新建路由框架**：仍然用既有的 `phone:goHome` 一类事件与页面栈，本模块只给恢复读数；
 *   · **不碰 DOM**：调用方按读数落实类名与列表，本模块零 DOM 零 storage 零计时 API。
 * ========================================================= */
'use strict';
/** 恒定键面（读者不必再判 undefined）。 */
function emptyFocus(reason) {
    return {
        ok: false, reason: reason,
        focus: [], tools: [], hidden: [], dropped: [],
        focusCount: 0, toolsCount: 0, hiddenCount: 0
    };
}
/**
 * 默认聚焦的四类任务（**登记表**：改这里即口径变化）。
 *   对齐验收原文「新会话三步内完成找联系人、查看今天约定、继续上次创作」：
 *     · chat   找联系人（聊天）
 *     · today  今天约定
 *     · record 记录（找一段往事 / 记事与人脉）
 *     · create 继续创作
 *   其余任务卡（素材 / 余额 / 看诊等案头）收进工具区 —— **不是删掉**。
 */
export const DF_FOCUS_IDS = Object.freeze(['chat', 'today', 'record', 'create']);
/**
 * 任务卡在登记表里的显示次序（**次键**：同 rank 时用它，保证顺序确定）。
 *   为什么必须显式登记：`past` 与 `people` 同属 `record`（rank 相同），
 *   只按 rank 排会让「先看什么」随输入顺序漂（本仓「同一份数据两种次序」的老账）。
 */
export const DF_CARD_ORDER = Object.freeze(['today', 'past', 'people', 'create', 'materials', 'money', 'clinic']);
/**
 * 「桌面图标直达」登记表（**验收原文的第三档路径**）。
 *   实测：任务卡表（TE_CARDS）里**没有**「聊天」这一类 —— 找联系人本来就是
 *   桌面 dock 上的微信图标**一步直达**，它不该被硬塞进任务卡。故本表把这类
 *   「由桌面图标直接完成」的需求与它的 App id 对齐：步数按 1 计，来源标 `dock`。
 *   把「找不到 chat 卡」报成「判不了」会把一条**本来就通的路径**说成不通。
 */
export const DF_ICON_DIRECT = Object.freeze({
    chat: Object.freeze({ appId: 'wechat', note: '桌面 dock 图标一步直达（聊天不在任务卡表里）' })
});
/** 任务卡 id → 聚焦类别的别名表（源卡 id 与验收词汇不同名时在此对齐，改为单一真源）。 */
export const DF_CARD_ALIAS = Object.freeze({
    past: 'record',
    people: 'record',
    materials: 'tools',
    money: 'tools',
    clinic: 'tools'
});
/**
 * 归类（**窄口**）：拿一个任务卡，回答它属于 focus 还是 tools。
 *   三条纪律：
 *     · 别名表优先（`DF_CARD_ALIAS` 是单一真源）；
 *     · 名单里没有的 id **不猜** ⇒ 落 `tools` 并具名 `unlisted`（把未知塞进 focus 会让
 *       没登记的新卡悄悄占据首屏，那与「默认聚焦」的承诺相反）；
 *     · 显式 `hidden` 优先于一切（隐藏就是不显示，无论它本属哪类）。
 * @returns {{group:'focus'|'tools', why:string}}
 */
export function classifyCard(card) {
    const c = (card && typeof card === 'object') ? card : {};
    const id = String(c.id === undefined ? '' : c.id);
    if (!id) return { group: 'tools', why: 'no-id（卡没有 id ⇒ 不猜，收进工具区）' };
    const alias = Object.prototype.hasOwnProperty.call(DF_CARD_ALIAS, id) ? DF_CARD_ALIAS[id] : null;
    const kind = alias || id;
    if (DF_FOCUS_IDS.indexOf(kind) >= 0) return { group: 'focus', why: alias ? ('别名 ' + id + ' → ' + kind) : ('在册聚焦类 ' + kind) };
    if (alias) return { group: 'tools', why: '别名 ' + id + ' → ' + kind + '（案头类）' };
    return { group: 'tools', why: 'unlisted（' + id + ' 未登记 ⇒ 收进工具区，不占首屏）' };
}
/**
 * 默认聚焦（**纯函数**，只读）。
 * @param {Array} cards 任务卡（形如 task-entry.js 的 TE_CARDS）
 * @param {{hidden?:string[]}} [ctx] `hidden` 是按卡隐藏名单
 * @returns {{ok:boolean, reason:string, focus:Array, tools:Array, hidden:Array,
 *            dropped:Array, focusCount:number, toolsCount:number, hiddenCount:number}}
 */
export function focusOf(cards, ctx) {
    if (!Array.isArray(cards)) return emptyFocus('cards-not-array（拿不到卡表 ⇒ 判不了，不是「一张卡都没有」）');
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const hide = Array.isArray(c.hidden) ? c.hidden.map((x) => String(x)) : [];
    const out = emptyFocus('');
    out.ok = true;
    const seen = [];
    for (const card of cards) {
        const cd = (card && typeof card === 'object') ? card : {};
        const id = String(cd.id === undefined ? '' : cd.id);
        if (hide.indexOf(id) >= 0) {
            out.hidden.push({ id: id, label: String(cd.label === undefined ? '' : cd.label) });
            continue;
        }
        /* 无 id 的卡：既进不了 focus 也不该被静默丢掉 —— 进 dropped 并具名。 */
        if (!id) {
            out.dropped.push({ label: String(cd.label === undefined ? '' : cd.label), why: 'no-id（无 id 的卡归不了类）' });
            continue;
        }
        /* 重复 id：第二条起进 dropped（首条胜出）—— 重复会让同一张卡在屏上出现两次。 */
        if (seen.indexOf(id) >= 0) {
            out.dropped.push({ id: id, label: String(cd.label === undefined ? '' : cd.label), why: 'duplicate-id（同一 id 只收第一条）' });
            continue;
        }
        seen.push(id);
        const cls = classifyCard(cd);
        const row = { id: id, label: String(cd.label === undefined ? '' : cd.label), why: cls.why, targets: Array.isArray(cd.targets) ? cd.targets.slice() : [] };
        if (cls.group === 'focus') out.focus.push(row); else out.tools.push(row);
    }
    /* 聚焦区排序：**按 DF_FOCUS_IDS 的登记次序**（聊天 → 今天 → 记录 → 创作）——
     *   输入顺序变了也不许让「先看什么」跟着变（那会让默认秩序随数据漂移）。 */
    /* ★ 同 rank 时**顺序必须仍是确定的**：首版只按 rank 排，而 `past` 与 `people` 同为
     *   `record`（rank 相同）—— 排序对相等元素不稳定，输入倒序时两者就换了位。
     *   实测：`focusOf(TE_CARDS)` 得 [today, past, people, create]，倒序输入得
     *   [today, people, past, create] ⇒ 「先看什么」随数据来源漂（正是本条要防的形态）。
     *   修法：rank 相等时按**卡表原始次序**（`DF_FOCUS_IDS` 是主键，原始序号是次键）。 */
    const rank = (row) => {
        const alias = DF_CARD_ALIAS[row.id];
        const kind = alias || row.id;
        const i = DF_FOCUS_IDS.indexOf(kind);
        return i < 0 ? DF_FOCUS_IDS.length : i;
    };
    /* ★ 次键不能用「排序前位置」（那还是输入序）—— 必须用**卡表登记里的位置**。
       实测：首版用输入位置作次键，倒序输入时 past / people 仍在换位（两者同为 record）。 */
    const seqOf = (id) => {
        const i = DF_CARD_ORDER.indexOf(String(id));
        return i < 0 ? DF_CARD_ORDER.length : i;
    };
    out.focus.sort((a, b) => (rank(a) - rank(b)) || (seqOf(a.id) - seqOf(b.id)));
    out.focusCount = out.focus.length;
    out.toolsCount = out.tools.length;
    out.hiddenCount = out.hidden.length;
    out.reason = '';
    return out;
}
/**
 * 返回路径恢复读数（**不做恢复动作**，只如实报哪几格恢复得住）。
 *   四格（对齐验收原文「返回恢复原页签、查询、滚动和编辑草稿」）：
 *     tab / query / scroll / draft。
 *   三态互不同形：`restored`（两侧同值）/ `lost`（值不同或没回写）/ `absent`（本来就没记 ——
 *   **未记不是「丢了」**，用户从没打开过编辑草稿时不该看到「草稿丢失」）。
 * @returns {{ok:boolean, reason:string, restored:Array, lost:Array, absent:Array, allRestored:boolean}}
 */
export const DF_RESTORE_FIELDS = Object.freeze(['tab', 'query', 'scroll', 'draft']);
export function restorePlan(before, after) {
    const b = (before && typeof before === 'object') ? before : null;
    const a = (after && typeof after === 'object') ? after : null;
    if (!b || !a) {
        return { ok: false, reason: 'inputs-not-object（拿不到两侧快照 ⇒ 判不了，不是「都没丢」）', restored: [], lost: [], absent: [], allRestored: false };
    }
    const restored = []; const lost = []; const absent = [];
    for (const f of DF_RESTORE_FIELDS) {
        const hasB = Object.prototype.hasOwnProperty.call(b, f);
        const hasA = Object.prototype.hasOwnProperty.call(a, f);
        if (!hasB && !hasA) { absent.push({ field: f, why: 'both-absent（本来就没记 ⇒ 不是「丢了」）' }); continue; }
        if (!hasA) { lost.push({ field: f, why: 'after-missing（退栈后没回写 ⇒ 重开即丢）' }); continue; }
        if (JSON.stringify(b[f]) === JSON.stringify(a[f])) restored.push({ field: f, value: b[f] });
        else lost.push({ field: f, why: 'value-changed（与退栈前不同）' });
    }
    return {
        ok: true, reason: '',
        restored: restored, lost: lost, absent: absent,
        allRestored: lost.length === 0 && restored.length > 0
    };
}
/**
 * 三步可达判定（**验收原文的可算面**）：找联系人 / 看今天 / 继续创作各要几步。
 *   步数口径：`focus` 区里那张卡 → 卡下第一个 `targets` 目标 = **2 步**（点卡 + 点目标）；
 *   若卡被隐藏或不在 focus 区，则须先展开工具区再找 = 多一步（如实计 3 步），
 *   完全找不到（卡不在卡表里）⇒ `steps:null` + 具名 reason（**不是 0 步**）。
 * @returns {{ok:boolean, reason:string, items:Array, maxSteps:number|null}}
 */
export function threeStepOf(cards, ctx) {
    const f = focusOf(cards, ctx);
    if (!f.ok) return { ok: false, reason: f.reason, items: [], maxSteps: null };
    const want = [
        { need: 'chat', label: '找联系人' },
        { need: 'today', label: '查看今天约定' },
        { need: 'create', label: '继续上次创作' }
    ];
    const items = [];
    for (const w of want) {
        const inFocus = f.focus.filter((row) => (DF_CARD_ALIAS[row.id] || row.id) === w.need)[0] || null;
        const inTools = f.tools.filter((row) => (DF_CARD_ALIAS[row.id] || row.id) === w.need)[0] || null;
        const inHidden = f.hidden.filter((row) => (DF_CARD_ALIAS[row.id] || row.id) === w.need)[0] || null;
        if (inFocus) items.push({ need: w.need, label: w.label, steps: 2, where: 'focus' });
        else if (inTools) items.push({ need: w.need, label: w.label, steps: 3, where: 'tools（须先展开工具区）' });
        else if (inHidden) items.push({ need: w.need, label: w.label, steps: null, where: 'hidden', why: '该卡被按需隐藏 ⇒ 只能从搜索进（不算步数，**不是 0 步**）' });
        else if (Object.prototype.hasOwnProperty.call(DF_ICON_DIRECT, w.need)) {
            const d = DF_ICON_DIRECT[w.need];
            items.push({ need: w.need, label: w.label, steps: 1, where: 'dock', appId: d.appId, why: d.note });
        }
        else items.push({ need: w.need, label: w.label, steps: null, where: 'absent', why: '卡表里没有这一类（未登记 ⇒ 判不了）' });
    }
    const nums = items.map((x) => x.steps).filter((n) => typeof n === 'number');
    return { ok: true, reason: '', items: items, maxSteps: nums.length ? Math.max.apply(null, nums) : null };
}
/** 诊断一行（纯字符串，不抛）。三态分开写。 */
export function line(f) {
    try {
        const x = f || {};
        if (!x.ok) return '桌面聚焦 —（' + (x.reason || '判不了') + '）';
        return '桌面聚焦 首屏 ' + x.focusCount + ' · 工具区 ' + x.toolsCount
            + (x.hiddenCount ? ' · 按需隐藏 ' + x.hiddenCount : '')
            + (x.dropped && x.dropped.length ? ' · 未收 ' + x.dropped.length : '');
    } catch (_e) { return '—（桌面聚焦异常）'; }
}
export default { DF_FOCUS_IDS, DF_CARD_ORDER, DF_CARD_ALIAS, DF_ICON_DIRECT, DF_RESTORE_FIELDS, classifyCard, focusOf, restorePlan, threeStepOf, line };
