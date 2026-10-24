/**
 * config/character-dossier.js - 角色等权多档案备忘录应用 (Character Dossier App)
 * 
 * 机制借鉴与超越：
 * 吸收 SillyTavern 记忆宫殿 (Memory Palace v3.4.0) 的多主要角色等权呈现
 * 与瑟瑟台账 V1.165 的恋爱对象/重要角色表规范。
 * 每个主角在手机端享有平等的多档案窗口，展示阶段心境、专属称呼、
 * 固定双段格式“关系：XX；态度：YY”以及近期经历摘要与性格偏移说明。
 */

export const STORAGE_KEY = 'cds_character_dossier_v1';

export class CharacterDossierManager {
    constructor() {
        this.dossiers = new Map(); // characterName -> dossier
    }

    /**
     * 录入或更新角色档案
     * @param {Object} data { name, identity, relationship, attitude, recentInteractions, personalityShift, experienceBrief }
     * @returns {Object} 规范化后的档案
     */
    upsertDossier(data) {
        if (!data || !data.name) {
            throw new Error('Dossier must have a character name');
        }

        const name = data.name.trim();
        const existing = this.dossiers.get(name) || {};

        // 规范化双段格式态度: "关系：XX；态度：YY"
        let relationship = data.relationship || existing.relationship || '朋友';
        let attitude = data.attitude || existing.attitude || '友好相待';
        let formattedAttitude = `关系：${relationship}；态度：${attitude}`;

        const record = {
            name,
            identity: data.identity || existing.identity || '重要角色',
            relationship,
            attitude,
            formattedAttitudeText: formattedAttitude,
            recentInteractions: data.recentInteractions || existing.recentInteractions || '暂无近期特殊互动',
            personalityShift: data.personalityShift || existing.personalityShift || null, // 格式: { behavior, meaning, avoidReadingAs }
            experienceBrief: data.experienceBrief || existing.experienceBrief || '经历待补充',
            updatedAt: Date.now()
        };

        this.dossiers.set(name, record);
        return record;
    }

    /**
     * 记录角色近期性格偏移说明（反极化交互逻辑）
     * @param {string} name 
     * @param {Object} shift { behavior: string, meaning: string, avoidReadingAs: string }
     * @returns {Object} 更新后的档案
     */
    recordPersonalityShift(name, shift) {
        const dossier = this.dossiers.get(name);
        if (!dossier) {
            throw new Error(`Dossier for ${name} not found`);
        }

        dossier.personalityShift = {
            behavior: shift.behavior,
            meaning: shift.meaning,
            avoidReadingAs: shift.avoidReadingAs,
            statement: `${shift.behavior} = ${shift.meaning} | 不要理解为${shift.avoidReadingAs}`
        };
        dossier.updatedAt = Date.now();
        return dossier;
    }

    /**
     * 获取指定角色的完整档案卡
     * @param {string} name 
     * @returns {Object|null}
     */
    getDossier(name) {
        return this.dossiers.get(name) || null;
    }

    /**
     * 获取所有主要角色的档案摘要列表
     * @returns {Array}
     */
    listDossierSummaries() {
        return Array.from(this.dossiers.values()).map(d => ({
            name: d.name,
            identity: d.identity,
            formattedAttitudeText: d.formattedAttitudeText,
            hasShift: !!d.personalityShift,
            shiftSummary: d.personalityShift ? d.personalityShift.statement : '性格状态稳定'
        }));
    }
}