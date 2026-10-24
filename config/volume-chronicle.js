/**
 * config/volume-chronicle.js - 历史卷宗回放与长剧本浏览应用 (Volume Chronicle App)
 * 
 * 机制借鉴与超越：
 * 吸收 Mneme (v1.0.0) 的卷宗封装与编年史展示模型。
 * 在手机端以互动小说 / GALGAME 分卷小说的形式呈现已封存的历史卷宗。
 * 支持按卷查阅关键剧情节点、卷内高光、登场人物与当时的故事时间轴，
 * 让长线对话拥有清晰的里程碑沉淀感，避免漫长剧情带来的记忆迷失。
 */

export const STORAGE_KEY = 'vch_volume_chronicle_v1';

export class VolumeChronicleManager {
    constructor() {
        this.volumes = []; // [{ index, title, timeRange, recap, entryCount, majorEventCount, characters: [] }]
    }

    /**
     * 同步或导入一批已封存的卷宗
     * @param {Array} volumeList 
     */
    syncVolumes(volumeList = []) {
        this.volumes = (volumeList || []).map(v => ({
            index: v.index || 1,
            title: v.title || `第${v.index || 1}卷`,
            timeRange: v.timeRange || '未知时期',
            recap: v.recap || '无概述',
            entryCount: v.entryCount || 0,
            majorEventCount: v.majorEventCount || 0,
            characters: Array.isArray(v.characters) ? v.characters : [],
            sealedAt: v.sealedAt || Date.now()
        })).sort((a, b) => a.index - b.index);
    }

    /**
     * 获取卷宗总数与概况统计
     * @returns {Object}
     */
    getStats() {
        return {
            totalVolumes: this.volumes.length,
            totalEntriesArchived: this.volumes.reduce((sum, v) => sum + v.entryCount, 0),
            totalMajorEvents: this.volumes.reduce((sum, v) => sum + v.majorEventCount, 0),
            latestVolume: this.volumes[this.volumes.length - 1] || null
        };
    }

    /**
     * 获取指定卷的详情
     * @param {number} volumeIndex 
     * @returns {Object|null}
     */
    getVolume(volumeIndex) {
        return this.volumes.find(v => v.index === volumeIndex) || null;
    }

    /**
     * 渲染适合手机端界面展示的卡片列表结构
     * @returns {Array} 卡片展示对象
     */
    renderCardDeck() {
        return this.volumes.map(v => ({
            badge: `VOL.${String(v.index).padStart(2, '0')}`,
            title: v.title,
            timeSubtitle: v.timeRange,
            contentPreview: v.recap,
            statsTag: `${v.entryCount}条记忆 · ${v.majorEventCount}次重大转折`,
            characterTags: v.characters.slice(0, 4)
        }));
    }
}