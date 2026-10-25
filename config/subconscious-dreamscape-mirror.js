/* ========================================================
 * config/subconscious-dreamscape-mirror.js
 * RubyPhone R10-X9 · 记忆引擎深层反哺之手机潜意识梦境镜像
 * 
 * 核心机制：
 * 1. 深度消费 LonSha 认知机制产物 (LonSha Cognitive Feed):
 *    - 潜意识暗涌 (LonShaSubconsciousEngine / unconsciousDrive)
 *    - 创伤解离 (LonShaDissociationSandbox / traumaDissociation)
 *    - 具身感官线索 (LonShaSensoryMesh / sensoryTraces)
 * 2. 手机端梦境投影与潜意识物化 (Phone State Materialization):
 *    - 备忘录呓语与断片记录 (Memo Sleep Talking Fragments)
 *    - 模糊梦境相册与相片水印 (Censored Dream Visual Anchors)
 *    - 微信深夜未发告白与撤销草稿 (Unsent Midnight Drafts)
 * 3. 梦境解析与清醒度计算 (Lucidity & Tension Index):
 *    - 推演梦境紧张度 (tensionScore) 与清醒度 (lucidityDegree)
 * ======================================================== */

export const DREAM_ARCHETYPES = Object.freeze({
    LABYRINTH_ESCAPE: 'LABYRINTH_ESCAPE',       // 迷宫逃离/焦虑
    ECHO_REUNION: 'ECHO_REUNION',               // 故人重逢/怀旧
    ABYSS_CONFRONTATION: 'ABYSS_CONFRONTATION', // 深渊对质/创伤
    WHISPER_CONFESSION: 'WHISPER_CONFESSION'    // 呢喃低语/潜意识渴望
});

export class SubconsciousDreamscapeMirror {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.dreamLogs = [];
        this.maxLogs = opts.maxLogs || 50;
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('dreamscape_mirror_records', []);
            if (Array.isArray(raw)) this.dreamLogs = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('dreamscape_mirror_records', this.dreamLogs);
        } catch (_e) {}
    }

    /**
     * 将 LonSha 记忆引擎的深层认知状态投射为手机梦境物化镜像
     * @param {Object} cognitivePayload LonSha 传入的认知包
     * @param {string} actorName 角色名称
     * @returns {Object} 梦境镜像产物
     */
    mirrorCognitiveState(cognitivePayload = {}, actorName = '主角') {
        const undercurrent = cognitivePayload.unconsciousDrive || cognitivePayload.undercurrent || null;
        const dissociation = cognitivePayload.traumaDissociation || cognitivePayload.dissociation || null;
        const sensory = Array.isArray(cognitivePayload.sensoryTraces) ? cognitivePayload.sensoryTraces : [];

        // 1. 判定梦境原型与紧张度
        let archetype = DREAM_ARCHETYPES.WHISPER_CONFESSION;
        let tensionScore = 0.3; // 0.0 ~ 1.0

        if (dissociation && (dissociation.defenseStage === 'DISSOCIATION' || dissociation.panicLevel > 0.6)) {
            archetype = DREAM_ARCHETYPES.ABYSS_CONFRONTATION;
            tensionScore = 0.85;
        } else if (undercurrent && /恐惧|危机|逃跑|离开|防备/.test(undercurrent.coreUrge || '')) {
            archetype = DREAM_ARCHETYPES.LABYRINTH_ESCAPE;
            tensionScore = 0.65;
        } else if (sensory.length > 0) {
            archetype = DREAM_ARCHETYPES.ECHO_REUNION;
            tensionScore = 0.45;
        }

        // 2. 物化为备忘录呓语 (Memo Fragment)
        const memoTitle = `〔梦境断片 · ${new Date().toLocaleDateString()}〕`;
        let memoContent = '';
        if (archetype === DREAM_ARCHETYPES.ABYSS_CONFRONTATION) {
            memoContent = `坠落感... 周围的声音全被抽空了。${actorName} 站在裂痕的另一侧，怎么喊都没有回音。`;
        } else if (archetype === DREAM_ARCHETYPES.WHISPER_CONFESSION) {
            memoContent = undercurrent?.suppressedDesire 
                ? `好像一直想对你说一句话：“${undercurrent.suppressedDesire}”，但醒来喉咙发紧。`
                : `反复梦见那个阳光照进来的午后，手里紧紧攥着什么东西不肯松手。`;
        } else {
            memoContent = `雨声与海潮的交界处。感官线索：${sensory.join('、') || '微弱的气息'}。`;
        }

        // 3. 物化为微信深夜未发草稿 (Unsent Draft)
        let unsentDraft = null;
        if (undercurrent) {
            unsentDraft = {
                targetContact: actorName,
                text: undercurrent.suppressedDesire ? `其实有些话一直没敢发出去... ${undercurrent.suppressedDesire}` : '你睡了吗？我刚才梦到你了。',
                savedAtTime: '03:47'
            };
        }

        // 4. 组装梦境镜像档案
        const record = {
            id: 'dream_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            timestamp: Date.now(),
            actorName,
            archetype,
            tensionScore,
            lucidityDegree: Number((1.0 - tensionScore * 0.5).toFixed(2)),
            artifacts: {
                memoFragment: {
                    title: memoTitle,
                    content: memoContent
                },
                unsentDraft,
                ambientSensory: sensory
            }
        };

        this.dreamLogs.unshift(record);
        if (this.dreamLogs.length > this.maxLogs) this.dreamLogs.pop();
        this._save();

        return record;
    }

    /**
     * 获取最新梦境镜像
     */
    getLatestDream() {
        return this.dreamLogs[0] || null;
    }
}