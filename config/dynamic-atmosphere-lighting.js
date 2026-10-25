/* ========================================================
 * config/dynamic-atmosphere-lighting.js
 * RubyPhone R10-O3 · 全天候环境光影与动态壁纸自适应系统
 * 
 * 核心机制：
 * 1. 四时微光与色温演算 (Circadian Color & Temperature Model):
 *    - DAWN(晨曦 05:00~08:00): 温暖粉橙色温 (3200K), 低饱和高漫射
 *    - DAY(正午 08:00~17:00): 透亮自然白光 (5500K), 高对比
 *    - DUSK(黄昏 17:00~20:00): 浓郁暮色金红 (2700K), 强阴影
 *    - NIGHT(深夜 20:00~05:00): 冷澈深蓝黑夜 (6500K 弱光), 护眼暗色模式
 * 2. 天气粒子态与表面凝结 (Weather Particle Modulation):
 *    - RAINY(雨天): 屏幕边缘雨滴挂珠与径向水雾蒙版 (dropletMistIntensity)
 *    - SNOWY(雪天): 屏幕四角霜化结晶 (frostBorder)
 *    - THUNDER(雷暴): 偶发微频闪电曝光过曝补偿 (flashExposure)
 * 3. 动态 CSS 变量渲染载荷生成 (CSS Variables Preset):
 *    - 输出 --phone-ambient-filter, --phone-wallpaper-overlay, --phone-glass-blur
 * ======================================================== */

export const ATMOSPHERE_PHASES = Object.freeze({
    DAWN: 'DAWN',
    DAY: 'DAY',
    DUSK: 'DUSK',
    NIGHT: 'NIGHT'
});

export const WEATHER_CONDITIONS = Object.freeze({
    CLEAR: 'CLEAR',
    CLOUDY: 'CLOUDY',
    RAINY: 'RAINY',
    SNOWY: 'SNOWY',
    THUNDER: 'THUNDER'
});

export class DynamicAtmosphereLighting {
    constructor(opts = {}) {
        this.baseHour = opts.defaultHour || 14;
        this.weather = opts.defaultWeather || WEATHER_CONDITIONS.CLEAR;
    }

    /**
     * 判定当前时态阶段
     * @param {number} hour 0~23
     * @returns {string} ATMOSPHERE_PHASES
     */
    resolvePhase(hour) {
        const h = Number(hour);
        if (h >= 5 && h < 8) return ATMOSPHERE_PHASES.DAWN;
        if (h >= 8 && h < 17) return ATMOSPHERE_PHASES.DAY;
        if (h >= 17 && h < 20) return ATMOSPHERE_PHASES.DUSK;
        return ATMOSPHERE_PHASES.NIGHT;
    }

    /**
     * 计算环境光色温与 CSS 滤镜样式
     * @param {Object} [ctx] { hour, weather, isStoryTime }
     * @returns {Object} 渲染参数包
     */
    computeAtmosphere(ctx = {}) {
        const hour = (typeof ctx.hour === 'number') ? ctx.hour : this.baseHour;
        const weather = ctx.weather || this.weather;
        const phase = this.resolvePhase(hour);

        let colorTemp = 5500;
        let overlayColor = 'rgba(0, 0, 0, 0)';
        let brightness = 1.0;
        let contrast = 1.0;

        switch (phase) {
            case ATMOSPHERE_PHASES.DAWN:
                colorTemp = 3600;
                overlayColor = 'rgba(255, 180, 120, 0.15)';
                brightness = 0.95;
                contrast = 0.95;
                break;
            case ATMOSPHERE_PHASES.DAY:
                colorTemp = 5500;
                overlayColor = 'rgba(255, 255, 255, 0.02)';
                brightness = 1.05;
                contrast = 1.0;
                break;
            case ATMOSPHERE_PHASES.DUSK:
                colorTemp = 2800;
                overlayColor = 'rgba(255, 120, 50, 0.22)';
                brightness = 0.92;
                contrast = 1.05;
                break;
            case ATMOSPHERE_PHASES.NIGHT:
                colorTemp = 6500;
                overlayColor = 'rgba(10, 18, 38, 0.45)';
                brightness = 0.85;
                contrast = 0.9;
                break;
        }

        // 天气影响叠乘
        let dropletMist = 0;
        let frostCrystal = 0;
        if (weather === WEATHER_CONDITIONS.RAINY) {
            dropletMist = 0.45;
            brightness *= 0.9;
        } else if (weather === WEATHER_CONDITIONS.SNOWY) {
            frostCrystal = 0.55;
            brightness *= 0.96;
        } else if (weather === WEATHER_CONDITIONS.THUNDER) {
            dropletMist = 0.65;
            brightness *= 0.85;
        }

        const cssVariables = {
            '--phone-ambient-temp': `${colorTemp}K`,
            '--phone-ambient-overlay': overlayColor,
            '--phone-ambient-brightness': `${brightness}`,
            '--phone-ambient-contrast': `${contrast}`,
            '--phone-mist-intensity': `${dropletMist}`,
            '--phone-frost-intensity': `${frostCrystal}`,
            '--phone-ambient-filter': `brightness(${brightness}) contrast(${contrast})`
        };

        return {
            hour,
            phase,
            weather,
            colorTemp,
            cssVariables,
            isNightMode: phase === ATMOSPHERE_PHASES.NIGHT
        };
    }
}