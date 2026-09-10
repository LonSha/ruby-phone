/**
 * 成就簿 (Achievement App) - 数据管理模块
 * 管理 666 条全量成就定义、已解锁清单与进度统计
 * 零数据库依赖，跨会话/会话级双模存储
 */

export class AchievementData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'ruby_unlocked_achievements';
    this.achievementsCatalog = [];
    this.unlockedMap = new Map(); // id -> timestamp
    
    this._loadCatalog();
    this.loadState();
  }

  async _loadCatalog() {
    try {
      const res = await fetch(new URL('../../data/achievements.json', import.meta.url));
      if (res.ok) {
        this.achievementsCatalog = await res.json();
      }
    } catch (e) {
      console.warn('[AchievementData] 加载 achievements.json 失败:', e);
    }
  }

  loadState() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      if (raw) {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (typeof data === 'object' && data !== null) {
          this.unlockedMap = new Map(Object.entries(data));
        }
      }
    } catch (e) {
      console.warn('[AchievementData] 读取成就状态失败:', e);
    }
  }

  saveState() {
    try {
      const obj = Object.fromEntries(this.unlockedMap);
      this.storage?.set?.(this.storageKey, obj);
    } catch (e) {
      console.warn('[AchievementData] 保存成就状态失败:', e);
    }
  }

  unlock(achId) {
    if (this.unlockedMap.has(achId)) return false; // 已解锁过
    const ach = this.achievementsCatalog.find(a => a.id === achId);
    if (!ach) return false;

    const now = Date.now();
    this.unlockedMap.set(achId, now);
    this.saveState();
    return ach;
  }

  isUnlocked(achId) {
    return this.unlockedMap.has(achId);
  }

  getCategories() {
    const cats = new Set(this.achievementsCatalog.map(a => a.cat));
    return Array.from(cats);
  }

  getStats() {
    const total = this.achievementsCatalog.length;
    const unlocked = this.unlockedMap.size;
    const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
    return { total, unlocked, percent };
  }

  getAchievements(cat = '全部', kw = '') {
    return this.achievementsCatalog.filter(a => {
      const matchCat = cat === '全部' || a.cat === cat;
      if (!matchCat) return false;
      if (!kw || !kw.trim()) return true;
      const t = kw.trim().toLowerCase();
      return a.name.toLowerCase().includes(t) || (a.intro && a.intro.toLowerCase().includes(t));
    });
  }
}
