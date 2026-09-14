/**
 * floor-store.js — [v2.9.0 原创缝合] 楼层挂载存储基建
 *
 * 【来源】缝合自葵葵机（向日葵MioRu）的 msg.data.wechat_log 模式：
 *   数据挂在每条 ST 消息的 data 上而非独立顶层存储——删除楼层自动带走数据、
 *   重 roll 不残留、跨设备随聊天导出。本模块是其工程化泛化：
 *   - 任意命名空间（wechat_log / pyq_log / forum_log / ...）而非硬编码
 *   - 两阶段批量写（先收集 messagesToUpdate 再一次 setChatMessages）防卡顿
 *     （来自 yexiaoxiaoye/mobile LIVE_FIXES_SUMMARY.md 的教训）
 *   - target 维度查询/合并/删除（撤回）能力
 *
 * 【依赖】TavernHelper.setChatMessages/getChatMessages（五档降级链探测）。
 *   无 TH 环境（如单测 mock）降级为「内存影子层」：读写全落在 _shadow 上，
 *   行为与真实一致但不可持久化——保证模块在任何环境可用、可测。
 *
 * 纯 ESM export（对齐 drives-engine/jiwen-engine 约定，本仓库 type:module，
 * IIFE+require 会返回空对象）。
 */

// ========== TH 通道探测（五档降级链，葵葵机 getPhoneRawGenerator 同款思路） ==========
function _resolveTH() {
    try {
        if (typeof window === 'undefined') return null;
        return window.TavernHelper
            || window.parent?.TavernHelper
            || null;
    } catch (_e) { return null; }
}

function _resolveContext() {
    try {
        if (typeof window === 'undefined') return null;
        return window.SillyTavern?.getContext?.()
            || window.parent?.SillyTavern?.getContext?.()
            || null;
    } catch (_e) { return null; }
}

/** 唯一 id（wx_ 前缀沿用葵葵机惯例，方便调试辨识来源） */
function _uid(prefix = 'fl') {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function _ts() { return Date.now(); }

/**
 * FloorStore — 楼层挂载存储引擎（单例式使用，new FloorStore() 每实例独立影子层）
 */
export class FloorStore {
    constructor() {
        // 内存影子层（无 TH 环境的降级）：{ [message_id]: { [ns]: Array } }
        this._shadow = new Map();
    }

    /** 是否具备真实楼层写能力（TH 在场） */
    get isLive() {
        const th = _resolveTH();
        return !!(th && typeof th.getChatMessages === 'function' && typeof th.setChatMessages === 'function');
    }

    // ========== 底层读取：合并所有楼层的指定命名空间数据 ==========
    /**
     * 读取全部楼层的某命名空间记录（按时间戳升序合并）。
     * @param {string} ns 命名空间（如 'wechat_log'）
     * @returns {Array<{...record, _stId:number}>} 附带来源楼层 message_id
     */
    readAll(ns) {
        const out = [];
        if (this.isLive) {
            const th = _resolveTH();
            let msgs = [];
            try { msgs = th.getChatMessages('0-0') || []; } catch (_e) { msgs = []; }
            for (const msg of msgs) {
                const arr = msg?.data?.[ns];
                if (!Array.isArray(arr)) continue;
                for (const item of arr) {
                    out.push({ ...item, _stId: msg.message_id });
                }
            }
        } else {
            for (const [stId, nss] of this._shadow.entries()) {
                const arr = nss[ns];
                if (!Array.isArray(arr)) continue;
                for (const item of arr) out.push({ ...item, _stId: stId });
            }
        }
        out.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
        return out;
    }

    /** 按 target 过滤读取（联系人/群聊维度） */
    readByTarget(ns, target) {
        return this.readAll(ns).filter(r => (r.target || r.name) === target);
    }

    // ========== 底层写入：两阶段批量（收集 → 一次性提交） ==========
    /**
     * 向「最后一楼」追加一条记录（单条快捷路径）。
     * @returns {{id:string, stId:number}|null}
     */
    async append(ns, record, opts = {}) {
        return this.appendBatch(ns, [record], opts).then(r => r?.[0] || null);
    }

    /**
     * 两阶段批量追加到「最后一楼」：先构造完整新数组，再一次 setChatMessages。
     * @returns {Promise<Array<{id:string, stId:number}>|null>}
     */
    async appendBatch(ns, records, opts = {}) {
        if (!Array.isArray(records) || records.length === 0) return [];
        const target = opts.target ?? null;
        const withMeta = records.map(r => ({
            id: r.id || _uid(ns.slice(0, 2)),
            role: r.role || 'recv',
            name: r.name || '',
            content: String(r.content ?? ''),
            timestamp: Number(r.timestamp) || _ts(),
            ...(target !== null ? { target } : (r.target !== undefined ? { target: r.target } : {})),
            ...r.extra
        }));

        if (this.isLive) {
            const th = _resolveTH();
            let msgs = [];
            try { msgs = th.getChatMessages('0-0') || []; } catch (_e) { return null; }
            const last = msgs[msgs.length - 1];
            if (!last) return null;
            const arr = Array.isArray(last.data?.[ns]) ? [...last.data[ns]] : [];
            arr.push(...withMeta);
            // 第二阶段：一次性提交（refresh:'none' 避免触发重渲染抖动）
            try {
                await th.setChatMessages([{
                    message_id: last.message_id,
                    data: { ...last.data, [ns]: arr }
                }], { refresh: 'none' });
            } catch (_e) { return null; }
            return withMeta.map(r => ({ id: r.id, stId: last.message_id }));
        }

        // 影子层降级：写入虚拟最后一楼（id = -1）
        const stId = -1;
        const nss = this._shadow.get(stId) || {};
        nss[ns] = Array.isArray(nss[ns]) ? nss[ns] : [];
        nss[ns].push(...withMeta);
        this._shadow.set(stId, nss);
        return withMeta.map(r => ({ id: r.id, stId }));
    }

    // ========== 删除（撤回）：按 id 定位并移除 ==========
    /**
     * 按记录 id 删除（撤回一条）。
     * @returns {Promise<boolean>} 是否找到并删除
     */
    async removeById(ns, id) {
        const hit = this._locate(ns, r => r.id === id);
        if (!hit) return false;
        return this._commitRemove(ns, hit);
    }

    /**
     * 删除某楼层某命名空间的全部记录（楼层级回收）。
     * @returns {Promise<number>} 删除条数
     */
    async removeByFloor(ns, stId) {
        if (this.isLive) {
            const th = _resolveTH();
            let msg = null;
            try { msg = th.getChatMessages(String(stId))?.[0] || null; } catch (_e) { return 0; }
            const arr = msg?.data?.[ns];
            if (!Array.isArray(arr) || arr.length === 0) return 0;
            const n = arr.length;
            const data = { ...msg.data };
            delete data[ns];
            try {
                await th.setChatMessages([{ message_id: Number(stId), data }], { refresh: 'none' });
            } catch (_e) { return 0; }
            return n;
        }
        const nss = this._shadow.get(Number(stId));
        if (!nss || !Array.isArray(nss[ns])) return 0;
        const n = nss[ns].length;
        delete nss[ns];
        return n;
    }

    /** 定位第一条匹配记录 { stId, index } */
    _locate(ns, pred) {
        if (this.isLive) {
            const th = _resolveTH();
            let msgs = [];
            try { msgs = th.getChatMessages('0-0') || []; } catch (_e) { return null; }
            for (const msg of msgs) {
                const arr = msg?.data?.[ns];
                if (!Array.isArray(arr)) continue;
                const idx = arr.findIndex(pred);
                if (idx >= 0) return { stId: msg.message_id, index: idx };
            }
            return null;
        }
        for (const [stId, nss] of this._shadow.entries()) {
            const arr = nss[ns];
            if (!Array.isArray(arr)) continue;
            const idx = arr.findIndex(pred);
            if (idx >= 0) return { stId, index: idx };
        }
        return null;
    }

    async _commitRemove(ns, hit) {
        if (this.isLive) {
            const th = _resolveTH();
            let msg = null;
            try { msg = th.getChatMessages(String(hit.stId))?.[0] || null; } catch (_e) { return false; }
            if (!msg) return false;
            const arr = Array.isArray(msg.data?.[ns]) ? [...msg.data[ns]] : [];
            if (hit.index >= arr.length) return false;
            arr.splice(hit.index, 1);
            try {
                await th.setChatMessages([{
                    message_id: hit.stId,
                    data: { ...msg.data, [ns]: arr }
                }], { refresh: 'none' });
            } catch (_e) { return false; }
            return true;
        }
        const nss = this._shadow.get(hit.stId);
        if (!nss || !Array.isArray(nss[ns])) return false;
        nss[ns].splice(hit.index, 1);
        return true;
    }

    // ========== 双源合并渲染辅助（葵葵机 syncWechatHistory 模式） ==========
    /**
     * 合并「楼层挂载记录」与「外部提取记录」按时间排序。
     * 外部记录（如正文正则提取）不可撤回，打 type:'external' 标记；
     * 楼层记录打 type:'floor' 标记（可撤回，有 id + _stId）。
     * @param {string} ns
     * @param {Array} externalRecords 外部源记录（需含 timestamp/target/name/content/role）
     * @returns {Array} 合并排序后的统一记录
     */
    mergeWithExternal(ns, externalRecords = []) {
        const floor = this.readAll(ns).map(r => ({ ...r, type: 'floor' }));
        const ext = (Array.isArray(externalRecords) ? externalRecords : [])
            .map((r, i) => ({ ...r, type: 'external', _extIdx: i, timestamp: Number(r.timestamp) || 0 }));
        const merged = [...floor, ...ext];
        merged.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
        return merged;
    }

    /** 清空影子层（测试用） */
    _clearShadow() { this._shadow.clear(); }
}

/** 默认单例（运行时共享；测试可 new 独立实例） */
export const floorStore = new FloorStore();

/** 便捷：当前上下文是否在场（供 UI 判断是否显示「可撤回」等能力） */
export function isFloorStoreLive() { return floorStore.isLive; }
