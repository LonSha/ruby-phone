/**
 * update-gap.js — [v2.72.0 原创移植] 表格更新锚点
 *
 * 【来源】移植自 yuzi83/st-yuzi-phone 的 modules/table-update-review/update-gap.js：
 *   用「chatMetadata + sendDate + swipeId」三元组记住「表格最后一次被更新是在哪一楼」，
 *   使「还有几楼没进表格」变成有名有数的读数。**已按本仓库规范重写**，非复制。
 *
 * 【为什么需要它 / 修前实测后果】
 *   RubyPhone 的表格/状态类 App（角色状态表、关系表、记忆表…）此前只有「表格当前长什么样」，
 *   没有「表格落后正文几楼」。用户翻 swipe、删楼、或让模型连着写几楼之后，
 *   没有任何读数能回答「这几楼的正文有没有进表格」——要么整表重扫（费 token 且会把
 *   用户手工修正冲掉），要么永久漏掉那几楼（表格越来越旧且无人知晓）。
 *   原版方案的另一半价值在**锚点失效判定**：删楼/换分支后，锚点指向的那楼可能已经不是
 *   原来那条回复了，此时必须显示「未知」而不是把另一条回复误认为已更新。
 *
 * 【本模块只做三件事】
 *   ① 记锚点：表格更新成功后，把 {floorId, sendDate, swipeId} 写进 chatMetadata；
 *   ② 数缺口：从锚点楼之后数起，还有几条 AI 楼没进表格；
 *   ③ 判失效：锚点楼被删/被换分支/被翻页时，读数返回 null（未知）而非一个错数。
 *
 * 【不做什么】
 *   不复制表格逐表历史，不按事件次数累加。本模块是**读数层**，
 *   「怎么把缺的楼补上」由各 App 自己的增量提取管线决定。
 *
 * 【存储归属】
 *   锚点写在 ctx.chatMetadata（宿主聊天元数据），随聊天走、随聊天删。
 *   **不新增 PhoneStorage 键**：这是 chatMetadata 顶层键而非插件自有存储键，
 *   故不触发 keys-audit 的登记要求；写入走 saveMetadataDebounced，失败只 warn 不打断。
 */

/** chatMetadata 上的锚点键（与源实现同键名，便于跨版本迁移识别）。 */
export const UPDATE_GAP_KEY = 'rubyTableUpdateReviewAnchor';

/** 单条锚点的最大保留份数（防止长会话无限膨胀；超出按 floorId 淘汰最旧）。 */
const MAX_ANCHORS = 50;

/**
 * 是否 AI 楼。
 * 与原版一致：is_user===true 与 is_system===true 都排除（系统楼不是正文）。
 */
function isAiFloor(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.is_user === true) return false;
    if (message.is_system === true) return false;
    if (message.role === 'user' || message.role === 'system') return false;
    return true;
}

/** sendDate 归一（缺失给空串，保证「取不到」与「空」同形可比）。 */
function stampOf(message) {
    try {
        return String(message?.send_date ?? '');
    } catch (_e) { return ''; }
}

/** swipeId 归一（缺失/畸形给 0，与宿主语义一致）。 */
function swipeOf(message) {
    try {
        const n = Number(message?.swipe_id);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    } catch (_e) { return 0; }
}

/** 取当前聊天的 chatMetadata（缺失/非对象返回 null，不抛）。 */
function metadataOf(context) {
    try {
        const md = context?.chatMetadata;
        return (md && typeof md === 'object') ? md : null;
    } catch (_e) { return null; }
}

/** 取当前聊天的消息数组（缺失/非数组返回 null）。 */
function chatOf(context) {
    try {
        const chat = context?.chat;
        return Array.isArray(chat) ? chat : null;
    } catch (_e) { return null; }
}

/**
 * 读缺口：锚点楼之后还有几条 AI 楼没进表格。
 *
 * @returns {number|null} null = **未知**（锚点缺失/失效，此时不得把任何数字当缺口用）；
 *                        number = 未更新的 AI 楼条数（0 = 已追平）。
 *
 * 失效判定（三类，任一命中即返回 null）：
 *   · 锚点本身不是合法形状（没记过 / 结构被外部改坏）
 *   · 锚点楼已不存在（删楼/楼层前移）
 *   · 锚点楼还在，但 sendDate 或 swipeId 与记录不符（那条回复被换成了另一条）
 */
export function readUnupdatedFloorCount(context) {
    try {
        const chat = chatOf(context);
        const md = metadataOf(context);
        if (!chat || !md) return null;

        // 兼容两种形态：单锚点（历史）与按 scope 分的锚点表（v2.72.0 起）。
        const anchor = resolveAnchor(md, context?.scope);
        if (!anchor) return null;
        if (!Number.isInteger(anchor.floorId) || anchor.floorId < 0) return null;

        const message = chat[anchor.floorId];
        if (!isAiFloor(message)) return null;
        // 锚点失效 ⇒ 显示未知，绝不把另一条回复误认为已更新。
        if (stampOf(message) !== String(anchor.sendDate ?? '')) return null;
        if (swipeOf(message) !== (Number.isFinite(Number(anchor.swipeId)) ? Math.round(Number(anchor.swipeId)) : 0)) return null;

        let count = 0;
        for (let i = anchor.floorId + 1; i < chat.length; i++) {
            if (isAiFloor(chat[i])) count++;
        }
        return count;
    } catch (_e) {
        return null;
    }
}

/**
 * 从 chatMetadata 解析锚点。
 * 读路径对新旧两种形态都要认：新版 {scope: {floorId,...}} 与旧版裸 {floorId,...}。
 */
function resolveAnchor(md, scope) {
    try {
        const raw = md[UPDATE_GAP_KEY];
        if (!raw || typeof raw !== 'object') return null;
        // 旧版裸锚点（无 scope 概念）——只有在新调用方也没给 scope 时才认，
        // 否则带 scope 的调用方会把另一个表的锚点当成自己的，那是串账。
        if (!scope) {
            if (Number.isInteger(raw.floorId)) return raw;
            return null;
        }
        const key = String(scope);
        const per = raw[key];
        if (per && typeof per === 'object' && Number.isInteger(per.floorId)) return per;
        // 未按 scope 记过：退回旧版裸锚点（同 scope 语义下的历史数据可延续）。
        if (Number.isInteger(raw.floorId)) return raw;
        return null;
    } catch (_e) {
        return null;
    }
}

/** 把 anchor map 收敛到上限内（按 floorId 升序保留最新的 MAX_ANCHORS 份）。 */
function pruneAnchors(map) {
    try {
        const keys = Object.keys(map);
        if (keys.length <= MAX_ANCHORS) return map;
        keys
            .map((k) => ({ k, floor: Number(map[k]?.floorId) }))
            .filter((x) => Number.isFinite(x.floor))
            .sort((a, b) => a.floor - b.floor)
            .slice(0, keys.length - MAX_ANCHORS)
            .forEach((x) => { delete map[x.k]; });
        return map;
    } catch (_e) {
        return map;
    }
}

/**
 * 记锚点：表格在该楼更新成功后调用。
 *
 * @returns {boolean} true = 已写入（或本来就相同而跳过写入也算 true，调用方无需区分）；
 *                    false = 拒绝写入（入参非法 / chatMetadata 不可写）。
 *
 * 幂等：同一 {floorId, sendDate, swipeId} 重复记不触发保存（省一次 debounced 写）。
 * 翻页语义：翻到新页后记锚点 = 新页的新账，旧页的锚点被覆写——不继承、不合并。
 */
export function recordTableUpdateFloor(context, floorId) {
    try {
        const chat = chatOf(context);
        const md = metadataOf(context);
        if (!chat || !md) return false;
        const floor = Number(floorId);
        if (!Number.isInteger(floor) || floor < 0) return false;

        const message = chat[floor];
        if (!isAiFloor(message)) return false;

        const anchor = {
            floorId: floor,
            sendDate: stampOf(message),
            swipeId: swipeOf(message),
        };

        const scope = context?.scope ? String(context.scope) : '';
        const raw = md[UPDATE_GAP_KEY];
        let store;
        if (scope) {
            store = (raw && typeof raw === 'object') ? { ...raw } : {};
            store[scope] = anchor;
        } else {
            store = { ...anchor };
        }

        const previous = scope
            ? ((raw && typeof raw === 'object') ? raw[scope] : null)
            : ((raw && typeof raw === 'object' && Number.isInteger(raw.floorId)) ? raw : null);

        // 完全相同 ⇒ 不写，省一次宿主保存。
        if (previous && previous.floorId === anchor.floorId
            && String(previous.sendDate ?? '') === anchor.sendDate
            && (Number.isFinite(Number(previous.swipeId)) ? Math.round(Number(previous.swipeId)) : 0) === anchor.swipeId) {
            return true;
        }

        md[UPDATE_GAP_KEY] = pruneAnchors(store);
        _saveDebounced(context);
        return true;
    } catch (_e) {
        return false;
    }
}

/** 复用宿主的防抖保存；存储失败不能打断更新数据链，只 warn。 */
function _saveDebounced(context) {
    try {
        const fn = context?.saveMetadataDebounced;
        if (typeof fn !== 'function') return;
        Promise.resolve(fn.call(context)).catch((e) => {
            try { console.warn('[RubyPhone] 保存表格更新锚点失败:', e); } catch (_e) { /* 无 console 环境 */ }
        });
    } catch (e) {
        try { console.warn('[RubyPhone] 保存表格更新锚点失败:', e); } catch (_e) { /* 同上 */ }
    }
}

/**
 * 一行读数（诊断/UI 用）。三态可分辨：
 *   'unknown' —— 锚点缺失或失效（不是 0，也不是一个错数）
 *   'clear'   —— 已追平
 *   'behind'  —— 落后 N 楼
 */
export function updateGapLine(context) {
    const n = readUnupdatedFloorCount(context);
    if (n === null) return { state: 'unknown', count: null, text: '未知（锚点失效，需重建）' };
    if (n === 0) return { state: 'clear', count: 0, text: '已追平正文' };
    return { state: 'behind', count: n, text: `落后正文 ${n} 楼` };
}
