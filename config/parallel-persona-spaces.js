/* ========================================================
 * config/parallel-persona-spaces.js
 * RubyPhone R10-X7 · 多账户多重人格分身系统
 * 
 * 核心机制：
 * 1. 独立并行系统空间 (Parallel Persona Spaces):
 *    - 主空间 (DEFAULT_SPACE): 日常公开身份、常规联系人与公开便签
 *    - 私密伪装分身空间 (PERSONA_SPACES): 独立密码/图案锁、独立桌面壁纸、专属加密应用列表
 * 2. 跨空间数据隔离沙箱 (Cross-Space Isolation):
 *    - 微信联系人、通话记录、相册照片随当前激活 SpaceId 完全隔离过滤
 * 3. 紧急一键伪装切回 (Panic Camouflage Switch):
 *    - 遇突发查岗时，输入指定伪装手势立即销毁分身前台显示并静默退回主空间
 * ======================================================== */

export const DEFAULT_SPACE_ID = 'space_default';

export class ParallelPersonaSpaces {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.spaces = new Map(); // spaceId -> spaceConfig
        this.currentSpaceId = DEFAULT_SPACE_ID;
        this._initDefaultSpace();
        this._load();
    }

    _initDefaultSpace() {
        this.spaces.set(DEFAULT_SPACE_ID, {
            id: DEFAULT_SPACE_ID,
            name: '默认公开空间',
            pin: '',
            themeWallpaper: 'default_blue',
            hiddenAppIds: [],
            isPrivate: false
        });
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('parallel_persona_spaces_data', []);
            if (Array.isArray(raw)) {
                raw.forEach(s => this.spaces.set(s.id, s));
            }
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('parallel_persona_spaces_data', Array.from(this.spaces.values()));
        } catch (_e) {}
    }

    /**
     * 创建新的分身空间
     * @param {Object} spaceData { name, pin, wallpaper, hiddenAppIds }
     * @returns {Object} 空间配置
     */
    createPersonaSpace(spaceData) {
        if (!spaceData || !spaceData.name || !spaceData.pin) {
            throw new Error('name and pin are required to create a persona space');
        }

        const id = 'space_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
        const space = {
            id,
            name: String(spaceData.name).trim(),
            pin: String(spaceData.pin).trim(),
            themeWallpaper: spaceData.wallpaper || 'persona_dark_neon',
            hiddenAppIds: Array.isArray(spaceData.hiddenAppIds) ? spaceData.hiddenAppIds : [],
            isPrivate: true,
            createdAt: Date.now()
        };

        this.spaces.set(id, space);
        this._save();
        return space;
    }

    /**
     * 验证 PIN 码并切换当前系统空间
     * @param {string} pin 
     * @returns {{ success: boolean, space?: Object, reason?: string }}
     */
    unlockAndSwitchSpace(pin) {
        const targetPin = String(pin).trim();
        for (const space of this.spaces.values()) {
            if (space.pin && space.pin === targetPin) {
                this.currentSpaceId = space.id;
                return { success: true, space };
            }
        }
        return { success: false, reason: 'INVALID_PIN' };
    }

    /**
     * 一键紧急伪装：迅速退回主空间
     */
    triggerCamouflagePanic() {
        this.currentSpaceId = DEFAULT_SPACE_ID;
        return {
            success: true,
            activeSpace: this.spaces.get(DEFAULT_SPACE_ID),
            action: 'CAMOUFLAGE_RESET_TO_DEFAULT'
        };
    }

    getActiveSpace() {
        return this.spaces.get(this.currentSpaceId) || this.spaces.get(DEFAULT_SPACE_ID);
    }

    /**
     * 判断某应用在当前空间下是否被隐藏
     * @param {string} appId 
     * @returns {boolean}
     */
    isAppVisibleInCurrentSpace(appId) {
        const cur = this.getActiveSpace();
        if (cur.hiddenAppIds && cur.hiddenAppIds.includes(appId)) {
            return false;
        }
        return true;
    }
}