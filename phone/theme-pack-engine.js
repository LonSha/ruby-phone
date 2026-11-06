/* ========================================================
 * phone/theme-pack-engine.js
 * [v4.132.0 · R15-X7] 角色专属桌面主题定制与热替换引擎
 * ======================================================== */
export class ThemePackEngine {
    constructor() {
        this.currentThemeId = 'default';
        this.themes = new Map([
            ['default', {
                id: 'default',
                name: '默认极简',
                primaryColor: '#4f46e5',
                bgColor: '#0f172a',
                textColor: '#f8fafc',
                bubbleColor: '#1e293b',
                chatSendLabel: '发送'
            }],
            ['catherine_frost', {
                id: 'catherine_frost',
                name: '凯瑟琳·冰霜守候',
                primaryColor: '#38bdf8',
                bgColor: '#082f49',
                textColor: '#e0f2fe',
                bubbleColor: '#0c4a6e',
                chatSendLabel: '传递魔力'
            }],
            ['lilia_crimson', {
                id: 'lilia_crimson',
                name: '莉莉娅·绯红誓约',
                primaryColor: '#f43f5e',
                bgColor: '#4c0519',
                textColor: '#ffe4e6',
                bubbleColor: '#881337',
                chatSendLabel: '誓约'
            }]
        ]);
    }

    /**
     * 应用角色专属主题
     * @param {string} themeId
     * @returns {Object} 激活的主题配置
     */
    applyTheme(themeId) {
        if (!this.themes.has(themeId)) {
            themeId = 'default';
        }
        this.currentThemeId = themeId;
        const theme = this.themes.get(themeId);
        return {
            applied: true,
            theme,
            cssVariables: {
                '--phone-primary': theme.primaryColor,
                '--phone-bg': theme.bgColor,
                '--phone-text': theme.textColor,
                '--phone-bubble': theme.bubbleColor
            }
        };
    }

    /**
     * 获取当前主题配置
     */
    getCurrentTheme() {
        return this.themes.get(this.currentThemeId) || this.themes.get('default');
    }
}