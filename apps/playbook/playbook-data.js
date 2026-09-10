/**
 * 灵感工坊 (Playbook App) - 数据管理模块
 * 管理 458 条精选玩法、当前已选集合与注入状态
 * 零外部数据库依赖，状态持久化于当前会话的 chatMetadata
 */

export class PlaybookData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'ruby_playbook_state';
    this.playsCatalog = {};
    this.selectedPlays = new Set();
    this.autoClear = true;
    this.injectDepth = 0;
    this.injectPosition = 'at_depth'; // 'at_depth' | 'before_char' | 'after_char'
    this._loadCatalog();
    this.loadState();
  }

  async _loadCatalog() {
    try {
      const res = await fetch(new URL('../../data/plays.json', import.meta.url));
      if (res.ok) {
        this.playsCatalog = await res.json();
      }
    } catch (e) {
      console.warn('[PlaybookData] 加载 plays.json 失败，使用内联兜底:', e);
    }
  }

  getCategories() {
    return Object.keys(this.playsCatalog);
  }

  getPlaysByCategory(category) {
    if (!category || category === '全部') {
      const all = [];
      for (const cat of Object.keys(this.playsCatalog)) {
        all.push(...this.playsCatalog[cat]);
      }
      return Array.from(new Set(all));
    }
    return this.playsCatalog[category] || [];
  }

  searchPlays(kw, category = '全部') {
    const list = this.getPlaysByCategory(category);
    if (!kw || !kw.trim()) return list;
    const term = kw.trim().toLowerCase();
    return list.filter(p => p.toLowerCase().includes(term));
  }

  togglePlay(playName) {
    if (this.selectedPlays.has(playName)) {
      this.selectedPlays.delete(playName);
    } else {
      this.selectedPlays.add(playName);
    }
    this.saveState();
  }

  clearSelected() {
    this.selectedPlays.clear();
    this.saveState();
  }

  loadState() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      if (raw) {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(data.selected)) {
          this.selectedPlays = new Set(data.selected);
        }
        if (typeof data.autoClear === 'boolean') {
          this.autoClear = data.autoClear;
        }
        if (typeof data.depth === 'number') {
          this.injectDepth = data.depth;
        }
      }
    } catch (e) {
      console.warn('[PlaybookData] 加载状态失败:', e);
    }
  }

  saveState() {
    try {
      const data = {
        selected: Array.from(this.selectedPlays),
        autoClear: this.autoClear,
        depth: this.injectDepth,
        position: this.injectPosition,
        updatedAt: Date.now()
      };
      this.storage?.set?.(this.storageKey, data);
    } catch (e) {
      console.warn('[PlaybookData] 保存状态失败:', e);
    }
  }

  buildInjectionPrompt() {
    if (this.selectedPlays.size === 0) return '';
    const list = Array.from(this.selectedPlays).map(p => `  - ${p}`).join('\n');
    return `<Scene_Inspiration>\n【当前剧情特定玩法与体位指引】\n在接下来的亲密互动或情欲场景中，自然融入以下动作与体位细节：\n${list}\n请根据角色性格、体能与当前情境逻辑展开描写，避免生硬罗列。\n</Scene_Inspiration>`;
  }
}
