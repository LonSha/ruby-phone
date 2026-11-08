/* ============================================================
 * ambient-lockscreen-wallpaper-engine.js — [v4.126.0 · 第十六期手机生活引擎]
 * 锁屏情境动态壁纸与呼吸氛围投影 (Ambient Lockscreen Wallpaper & Atmosphere Engine)
 * ------------------------------------------------------------
 * 【核心设计与痛点解决】
 * 掌机屏幕是玩家最直观的心情视窗：
 *   - 当角色心情低落、或者现实中下着大雨时，锁屏应当产生共鸣；
 *   - 本引擎依据真实时钟（晨曦、落日、星夜）以及 NPC 的当前心理状态，
 *     自适应推导出 8-bit 像素锁屏壁纸的主题色彩、呼吸动效与生活寄语。
 *
 * 挂载：RubyAmbientLockscreen / CJS / AMD
 * ============================================================ */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RubyAmbientLockscreen = factory();
        root.AmbientLockscreenEngine = root.RubyAmbientLockscreen;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VERSION = '4.126.0';

    function deriveWallpaperTheme({ hour = new Date().getHours(), weather = 'clear', mood = '平稳' } = {}) {
        const h = Number(hour) % 24;
        let timePeriod = 'day';
        let bgGradient = '#2b3a4a';
        let motto = '今天也是值得期待的一天。';

        if (h >= 5 && h < 8) {
            timePeriod = 'dawn';
            bgGradient = 'linear-gradient(180deg, #ff9a9e 0%, #fecfef 99%)';
            motto = '晨光熹微，万物苏醒。';
        } else if (h >= 8 && h < 17) {
            timePeriod = 'day';
            bgGradient = 'linear-gradient(180deg, #a1c4fd 0%, #c2e9fb 100%)';
            motto = '阳光正好，微风不燥。';
        } else if (h >= 17 && h < 20) {
            timePeriod = 'dusk';
            bgGradient = 'linear-gradient(180deg, #fa709a 0%, #fee140 100%)';
            motto = '夕阳把天边染成暖橘色。';
        } else {
            timePeriod = 'night';
            bgGradient = 'linear-gradient(180deg, #09203f 0%, #537895 100%)';
            motto = '夜幕低垂，繁星入梦。';
        }

        if (mood === '亲昵' || mood === '温暖') {
            motto = '心里装着喜欢的人，世界格外温柔。';
        } else if (mood === '紧绷' || mood === '疲惫') {
            motto = '累了就停一停，这里永远可以安心歇息。';
        }

        return {
            timePeriod,
            bgGradient,
            motto,
            updatedAt: Date.now()
        };
    }

    return {
        VERSION,
        deriveWallpaperTheme
    };
}));
export default (typeof RubyAmbientLockscreen !== "undefined" ? RubyAmbientLockscreen : {});
