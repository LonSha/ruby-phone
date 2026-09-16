/* ========================================================
 * timeweaver-app.js — 织光机 App 控制器
 * 【完全原创】数字生活叙事引擎：主动聚合各 App 散落碎片，织成可回望的时光。
 * 【v2.14.0】AI 时光信：本地规则 composeLetter 之上，加 LLM 升华层——
 *   把聚合出的编年数据交给 apiManager.callAI，用「见证你这段时光的挚友」口吻
 *   写成一封有温度的信。本地规则版保留为离线/降级兜底。
 * ======================================================== */
'use strict';
import { TimeweaverView } from './timeweaver-view.js';
import { buildNarrative } from './timeweaver-collector.js';

export class TimeweaverApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new TimeweaverView(this);
        // [v2.14.0] AI 信状态：{ loading, error, paragraphs, ts } 缓存本次会话
        this.aiLetter = null;
    }

    render() {
        this.view.render();
    }

    /**
     * [v2.14.0] AI 升华时光信：把 buildNarrative 的编年数据（letter/里程碑/亲密度/情绪曲线）
     * 作为事实素材，交给 LLM 用挚友口吻写成一封真正的信。
     * 引擎纯函数（composeLetter）不动——它产出的 stats/milestones/board 是本方法的事实源。
     * @returns {Promise<{title:string, paragraphs:string[], source:'ai'}|null>}
     */
    async composeAILetter() {
        const am = (typeof window !== 'undefined' && window.VirtualPhone?.apiManager) || null;
        if (!am || typeof am.callAI !== 'function') {
            this.aiLetter = { loading: false, error: 'API Manager 未初始化，无法 AI 升华', paragraphs: null };
            return null;
        }
        const model = buildNarrative(this.storage, { bucket: 'day' });
        if (model.empty || !model.letter) {
            this.aiLetter = { loading: false, error: '碎片还太少，织不出一封完整的信', paragraphs: null };
            return null;
        }
        this.aiLetter = { loading: true, error: null, paragraphs: null };
        this.view.render();
        try {
            const L = model.letter;
            const facts = [
                `这段时光共 ${L.stats.total} 个碎片，来自 ${L.stats.sources} 个生活角落。`,
                `整体情绪基调：${L.stats.avgMood >= 0.3 ? '温暖明亮' : L.stats.avgMood <= -0.3 ? '跌宕起伏' : '平静流淌'}（均值 ${L.stats.avgMood.toFixed(2)}）。`,
                L.stats.firsts ? `经历了 ${L.stats.firsts} 个「第一次」：${model.milestones.filter(m => m.icon === '🌱').slice(0, 3).map(m => m.label).join('、')}。` : '',
                L.stats.topPerson ? `出现最多的人是 ${L.stats.topPerson}（横跨 ${L.board[0]?.breadth || 1} 个场景）。` : '',
                L.stats.topMoment ? `最深刻的片段是「${L.stats.topMoment}」。` : '',
                L.stats.highDays || L.stats.lowDays ? `有 ${L.stats.highDays} 段明亮时光${L.stats.lowDays ? `、${L.stats.lowDays} 段需要撑过去的日子` : ''}。` : ''
            ].filter(Boolean).join('\n');
            const sysPrompt = '你是「织光机」的叙事之魂——一位见证了用户这段数字生活的挚友。'
                + '你会基于给定的事实素材，用第二人称「你」，写一封 3-5 段的温暖回顾信。'
                + '语气：真诚、细腻、有画面感，像老朋友在灯下为你读这段时光，不要机械罗列数据，不要把事实素材原样照抄。'
                + '开头用一个具体的意象或场景引入，结尾收束到「这些碎片值得被记住」。'
                + '只输出信件正文（可多段），不要标题、不要署名、不要解释。';
            const userPrompt = `请基于以下这段时光的事实素材，为我写一封回顾信：\n\n${facts}`;
            const result = await am.callAI([
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userPrompt }
            ], { max_tokens: 900, appId: 'timeweaver' });
            if (!result || !result.success) {
                throw new Error((result && result.error) || 'AI 返回失败');
            }
            const text = String(result.summary || result.text || '').trim();
            if (!text) throw new Error('AI 返回空信件');
            const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
            this.aiLetter = { loading: false, error: null, paragraphs, ts: Date.now() };
            this.view.render();
            return { title: '一封被 AI 织起的时光信', paragraphs, source: 'ai' };
        } catch (e) {
            this.aiLetter = { loading: false, error: String(e?.message || e), paragraphs: null };
            this.view.render();
            return null;
        }
    }
}

export default TimeweaverApp;