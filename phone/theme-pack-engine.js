/* ========================================================
 * phone/theme-pack-engine.js
 * [v4.133.0 · R15-X7] 酒馆通用多角色专属主题定制与动态绑定引擎
 * ========================================================
 * 【架构原则】
 * 坚决杜绝硬编码单一角色名字！
 * 酒馆（SillyTavern）中每个角色（无论是单人还是群聊中的任意成员）
 * 均通过 characterId / charName 唯一标识。
 * 本引擎支持：
 * 1. 动态为任意酒馆角色绑定/解绑定制视觉主题；
 * 2. 根据角色元数据（name, personality, colorScheme）动态生成/派生角色主题；
 * 3. 在聊天切换不同酒馆角色时，手机主题与按键文案自动跟随切换。
 * ======================================================== */

export class ThemePackEngine {
    constructor() {
        this.globalThemeId = 'system_default';
        // 全局可用预设调色板
        this.systemThemes = new Map([
            ['system_default', {
                id: 'system_default',
                name: '系统默认极简',
                primaryColor: '#4f46e5',
                bgColor: '#0f172a',
                textColor: '#f8fafc',
                bubbleColor: '#1e293b',
                chatSendLabel: '发送'
            }],
            ['dark_slate', {
                id: 'dark_slate',
                name: '深空暗影',
                primaryColor: '#64748b',
                bgColor: '#020617',
                textColor: '#f1f5f9',
                bubbleColor: '#0f172a',
                chatSendLabel: '发送'
            }]
        ]);

        // characterId -> ThemeConfig 映射表（真正支持酒馆无限角色卡）
        this.characterThemeBindings = new Map();
        this.activeCharacterId = null;
    }

    /**
     * 为酒馆中指定的任意角色绑定专属主题配置
     * @param {string} characterId 酒馆角色唯一标识
     * @param {Object} customConfig 自定义主题属性 { name, primaryColor, bgColor, bubbleColor, chatSendLabel }
     */
    bindCharacterTheme(characterId, customConfig = {}) {
        if (!characterId) return false;
        const base = this.systemThemes.get(this.globalThemeId);
        const resolvedTheme = {
            id: `char_theme_${characterId}`,
            characterId,
            name: customConfig.name || `角色专属主题 (${characterId})`,
            primaryColor: customConfig.primaryColor || base.primaryColor,
            bgColor: customConfig.bgColor || base.bgColor,
            textColor: customConfig.textColor || base.textColor,
            bubbleColor: customConfig.bubbleColor || base.bubbleColor,
            chatSendLabel: customConfig.chatSendLabel || base.chatSendLabel
        };
        this.characterThemeBindings.set(String(characterId), resolvedTheme);
        return resolvedTheme;
    }

    /**
     * 从酒馆角色元数据中动态分析并生成专属主题（自适应）
     * @param {Object} character 酒馆角色对象 { id, name, personality, color }
     */
    deriveThemeFromCharacter(character = {}) {
        const charId = character.id || character.characterId || character.name || 'unknown';
        const name = character.name || '未命名角色';
        const personality = String(character.personality || '').toLowerCase();

        // 根据角色人设或偏好推导色系与交互动效文案
        let primaryColor = '#4f46e5';
        let bubbleColor = '#1e293b';
        let chatSendLabel = '发送';

        if (personality.includes('冷') || personality.includes('傲') || personality.includes('冰')) {
            primaryColor = '#0ea5e9';
            bubbleColor = '#082f49';
            chatSendLabel = '回应';
        } else if (personality.includes('热') || personality.includes('火') || personality.includes('恋') || personality.includes('爱')) {
            primaryColor = '#f43f5e';
            bubbleColor = '#4c0519';
            chatSendLabel = '传递心意';
        } else if (personality.includes('暗') || personality.includes('刺客') || personality.includes('神秘')) {
            primaryColor = '#8b5cf6';
            bubbleColor = '#2e1065';
            chatSendLabel = '密语';
        }

        const derived = {
            name: `${name}·契约主题`,
            primaryColor: character.color || primaryColor,
            bgColor: '#090d16',
            textColor: '#f8fafc',
            bubbleColor,
            chatSendLabel: character.sendLabel || chatSendLabel
        };

        return this.bindCharacterTheme(charId, derived);
    }

    /**
     * 切换当前活跃的酒馆角色，使手机主题自适应
     * @param {string} characterId
     * @returns {Object} 生效的主题及 CSS 变量
     */
    setActiveCharacter(characterId) {
        this.activeCharacterId = characterId ? String(characterId) : null;
        const currentTheme = this.getCurrentTheme();
        return {
            applied: true,
            activeCharacterId: this.activeCharacterId,
            theme: currentTheme,
            cssVariables: {
                '--phone-primary': currentTheme.primaryColor,
                '--phone-bg': currentTheme.bgColor,
                '--phone-text': currentTheme.textColor,
                '--phone-bubble': currentTheme.bubbleColor
            }
        };
    }

    /**
     * 获取当前应生效的主题：优先取活跃角色的专属绑定，否则回退全局主题
     */
    getCurrentTheme() {
        if (this.activeCharacterId && this.characterThemeBindings.has(this.activeCharacterId)) {
            return this.characterThemeBindings.get(this.activeCharacterId);
        }
        return this.systemThemes.get(this.globalThemeId) || this.systemThemes.get('system_default');
    }

    /**
     * 移除特定角色的专属主题，恢复使用全局默认
     */
    unbindCharacterTheme(characterId) {
        return this.characterThemeBindings.delete(String(characterId));
    }
}