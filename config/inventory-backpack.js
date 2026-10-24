/**
 * config/inventory-backpack.js - 道具背包与权属流转应用 (Inventory Backpack App)
 * 
 * 机制借鉴与超越：
 * 吸收 Mneme (v1.0.0) 的 ItemStatus 状态机 (held | lost | consumed) 与瑟瑟台账物品表。
 * 在手机端呈现主角与各角色随身携带的重要信物、剧情关键道具、纪念品与消费品。
 * 追踪物品来源剧情楼层、情感象征意义、当前持有者与转赠历史。
 */

export const STORAGE_KEY = 'ibp_inventory_backpack_v1';

export class InventoryBackpackManager {
    constructor() {
        this.items = new Map(); // itemId -> item
    }

    /**
     * 录入新物品或道具
     * @param {Object} item { id, name, owner, source, significance, status }
     * @returns {Object} 登记后的物品对象
     */
    registerItem(item) {
        if (!item || !item.name) {
            throw new Error('Item must have a name');
        }

        const id = item.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const record = {
            id,
            name: item.name,
            owner: item.owner || 'protagonist', // 默认主角持有
            source: item.source || '剧情获得',
            significance: item.significance || '随身纪念物',
            status: ['held', 'lost', 'consumed'].includes(item.status) ? item.status : 'held',
            history: [{
                action: 'acquired',
                to: item.owner || 'protagonist',
                at: Date.now()
            }],
            createdAt: Date.now()
        };

        this.items.set(id, record);
        return record;
    }

    /**
     * 转赠或转移道具给他人
     * @param {string} itemId 
     * @param {string} newOwner 
     * @param {string} reason 
     * @returns {Object} 更新后的道具
     */
    transferItem(itemId, newOwner, reason = '') {
        const item = this.items.get(itemId);
        if (!item) {
            throw new Error(`Item ${itemId} not found`);
        }
        if (item.status !== 'held') {
            throw new Error(`Cannot transfer item with status ${item.status}`);
        }

        const previousOwner = item.owner;
        item.owner = newOwner;
        item.history.push({
            action: 'transferred',
            from: previousOwner,
            to: newOwner,
            reason,
            at: Date.now()
        });
        return item;
    }

    /**
     * 消耗或遗失道具
     * @param {string} itemId 
     * @param {'consumed'|'lost'} newStatus 
     * @param {string} note 
     * @returns {Object}
     */
    changeStatus(itemId, newStatus, note = '') {
        const item = this.items.get(itemId);
        if (!item) {
            throw new Error(`Item ${itemId} not found`);
        }
        if (!['consumed', 'lost'].includes(newStatus)) {
            throw new Error('Status must be consumed or lost');
        }

        item.status = newStatus;
        item.history.push({
            action: newStatus,
            note,
            at: Date.now()
        });
        return item;
    }

    /**
     * 按照持有者列出道具
     * @param {string} owner - 角色名或 'protagonist'
     * @param {boolean} onlyHeld - 是否仅列出当前持有的
     * @returns {Array}
     */
    listByOwner(owner = 'protagonist', onlyHeld = true) {
        let list = Array.from(this.items.values()).filter(i => i.owner === owner);
        if (onlyHeld) {
            list = list.filter(i => i.status === 'held');
        }
        return list;
    }
}