/* ========================================================
 * 幸运转盘 (Gacha) App — 数据层
 * 5 卡池 / 630 道具 / 权重抽卡 / 品质分级 / 背包 / 幸运币账本
 * 道具库源自 V3.759 状态栏 GACHA_DATA (ACU 扭蛋), 纯本地零 LLM
 * ======================================================== */
'use strict';
import { gachaPools, gachaItems } from '../../data/gacha-items.js';

// 品质 → 中文显示 + 权重 + 颜色
export const QUALITY_META = {
  '神话': { weight: 1, color: '#f59e0b', order: 0 },
  '传说': { weight: 2, color: '#ec4899', order: 1 },
  '史诗': { weight: 4, color: '#a855f7', order: 2 },
  '稀有': { weight: 8, color: '#3b82f6', order: 3 },
  '优秀': { weight: 16, color: '#10b981', order: 4 },
  '普通': { weight: 30, color: '#94a3b8', order: 5 },
};
// 单抽价格 / 十连折扣
export const SINGLE_COST = 100;
export const TEN_COST = 900;

export class GachaData {
  constructor(storage) {
    this.storage = storage;
    this.KEY = 'ruby_gacha_state';
    this.coins = 1000;          // 幸运币（初始赠送）
    this.inventory = {};        // itemId -> count
    this.history = [];          // 最近抽卡记录
    this.pullCount = 0;
    this._pools = gachaPools;
    this._items = gachaItems;
    this._load();
  }

  _load() {
    try {
      const raw = this.storage?.get?.(this.KEY);
      if (raw) {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof d.coins === 'number') this.coins = d.coins;
        if (d.inventory && typeof d.inventory === 'object') this.inventory = d.inventory;
        if (Array.isArray(d.history)) this.history = d.history;
        if (typeof d.pullCount === 'number') this.pullCount = d.pullCount;
      }
    } catch (e) { /* 忽略 */ }
  }
  _save() {
    try {
      this.storage?.set?.(this.KEY, JSON.stringify({
        coins: this.coins,
        inventory: this.inventory,
        history: this.history.slice(0, 30),
        pullCount: this.pullCount,
      }));
    } catch (e) { /* 忽略 */ }
  }

  getPools() { return this._pools.slice(); }
  getItemsOfPool(poolId) {
    if (poolId === 'all') return this._items;
    return this._items.filter(i => (i.poolTags || []).includes(poolId));
  }

  // 加权随机抽一件（按品质权重）
  _rollOne(poolId) {
    let pool = this._items;
    if (poolId && poolId !== 'all') pool = this.getItemsOfPool(poolId);
    if (!pool.length) pool = this._items;
    // 按权重选一件（quality 权重 × item.weight）
    const weighted = [];
    for (const item of pool) {
      const qw = (QUALITY_META[item.quality] || QUALITY_META['普通']).weight;
      const iw = Math.max(0.1, Number(item.weight) || 1);
      weighted.push({ item, w: qw * iw });
    }
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const { item, w } of weighted) {
      r -= w;
      if (r <= 0) return item;
    }
    return weighted[weighted.length - 1].item;
  }

  // 单抽
  pullOnce(poolId) {
    if (this.coins < SINGLE_COST) return { ok: false, reason: '幸运币不足', need: SINGLE_COST, balance: this.coins };
    return this._doPull(poolId, 1);
  }
  // 十连
  pullTen(poolId) {
    if (this.coins < TEN_COST) return { ok: false, reason: '幸运币不足', need: TEN_COST, balance: this.coins };
    return this._doPull(poolId, 10);
  }

  _doPull(poolId, count) {
    const cost = count >= 10 ? TEN_COST : SINGLE_COST;
    const items = [];
    for (let i = 0; i < count; i++) items.push(this._rollOne(poolId));
    const results = items.map(item => {
      this.inventory[item.id] = (this.inventory[item.id] || 0) + (Number(item.grantQuantity) || 1);
      return {
        id: item.id,
        name: item.name,
        type: item.type || '道具',
        quality: item.quality || '普通',
        description: item.description || '',
        weight: Number(item.weight) || 1,
      };
    });
    this.coins -= cost;
    this.pullCount += 1;
    this.history.unshift({ at: Date.now(), poolId, cost, got: results.map(r => ({ name: r.name, quality: r.quality })) });
    this._save();
    return { ok: true, cost, balance: this.coins, results };
  }

  // 积分（幸运币）赠送
  addCoins(n) {
    this.coins += Math.max(0, Math.floor(Number(n) || 0));
    this._save();
    return this.coins;
  }

  // 背包
  getInventory() {
    const out = [];
    for (const [id, count] of Object.entries(this.inventory)) {
      const item = this._items.find(i => i.id === id) || { id, name: id, quality: '普通', description: '', type: '道具' };
      if (count > 0) out.push({ ...item, count });
    }
    // 按品质排序
    out.sort((a, b) => (QUALITY_META[a.quality]?.order ?? 9) - (QUALITY_META[b.quality]?.order ?? 9));
    return out;
  }
  getBalance() { return this.coins; }
  getStats() {
    return { pullCount: this.pullCount, itemKinds: Object.keys(this.inventory).length };
  }
}

export default GachaData;