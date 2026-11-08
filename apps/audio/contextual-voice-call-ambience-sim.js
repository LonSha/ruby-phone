/* ============================================================
 * contextual-voice-call-ambience-sim.js — 沉浸式情境通话与实时环境声场模拟器
 * [v4.140.0 · 3D声场音轨分层合成、环境底噪与沉浸临场感]
 * ============================================================ */

export class ContextualVoiceCallAmbienceSim {
    synthesizeCallAmbience(weather = "rainy", physicalActivity = "running", location = "cafe") {
        const layers = [];
        if (weather === "rainy") {
            layers.push({ sound: "窗外淅沥雨声与车轮碾过积水的湿漉声", volumeDb: -18, loop: true });
        } else if (weather === "thunderstorm") {
            layers.push({ sound: "远端沉闷雷鸣与狂风呼啸的底噪", volumeDb: -14, loop: false });
        }

        if (physicalActivity === "running") {
            layers.push({ sound: "急促且带有微喘的呼吸节律与衣物摩擦声", volumeDb: -11, loop: true });
        } else if (physicalActivity === "walking") {
            layers.push({ sound: "平稳鞋跟轻踏地面的节奏声", volumeDb: -24, loop: true });
        }

        if (location === "cafe") {
            layers.push({ sound: "咖啡机蒸汽细鸣与远端极轻柔的爵士钢琴曲", volumeDb: -22, loop: true });
        } else if (location === "subway") {
            layers.push({ sound: "车厢轮轨金属共振啸叫与报站提示音", volumeDb: -15, loop: true });
        }

        const ambienceString = layers.map(l => l.sound).join("、");
        return {
            weather,
            physicalActivity,
            location,
            audioTracks: layers,
            ambienceDescription: ambienceString,
            promptDirective: `【情境通话实时声场】话筒听筒中持续传来「${ambienceString}」，声音质感极富现实呼吸感与物理沉浸感。`
        };
    }
}
if (typeof globalThis !== "undefined") { globalThis.ContextualVoiceCallAmbienceSim = ContextualVoiceCallAmbienceSim; }
if (typeof window !== "undefined") { window.ContextualVoiceCallAmbienceSim = ContextualVoiceCallAmbienceSim; }
if (typeof module !== "undefined" && module.exports) { module.exports = ContextualVoiceCallAmbienceSim; }
export default ContextualVoiceCallAmbienceSim;