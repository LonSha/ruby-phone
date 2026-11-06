/* ========================================================
 * phone/ambient-call-simulator.js
 * [v4.130.0 · R15-X3] 拟真通话环境音与天气噪点模拟器
 * ======================================================== */
export class AmbientCallSimulator {
    /**
     * 根据当前外部物理环境与信号状态修饰通话音效/前缀
     * @param {Object} env { weather, location, signalStrength }
     * @returns {Object} 带有环境噪点修饰的通话状态
     */
    static formatCallAtmosphere(env = {}) {
        const weather = String(env.weather || '晴朗').toLowerCase();
        const signal = typeof env.signalStrength === 'number' ? env.signalStrength : 4;
        
        let noiseTag = '';
        let atmosphericDesc = '';

        if (weather.includes('暴雪') || weather.includes('雪') || weather.includes('blizzard')) {
            noiseTag = '〔呼啸的风雪声与气流破音〕';
            atmosphericDesc = '风雪呼啸，通话背景伴随刺耳的风声';
        } else if (weather.includes('雨') || weather.includes('rain')) {
            noiseTag = '〔淅沥的雨声与击打伞面声〕';
            atmosphericDesc = '雨声绵延，话筒传来潮湿的白噪音';
        } else if (signal <= 1) {
            noiseTag = '〔微弱的电流杂音与断续卡顿〕';
            atmosphericDesc = '信号微弱，声音断断续续';
        } else {
            noiseTag = '〔清晰的通话背景音〕';
            atmosphericDesc = '室内安静，音质清晰';
        }

        return {
            noiseTag,
            atmosphericDesc,
            signalBars: signal,
            formattedSpeakerPrefix: (speaker, text) => `${speaker}${noiseTag}：“${text}”`
        };
    }
}