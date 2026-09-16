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
        // [v2.15.0] 织信对话框输入（分享朋友圈时用）
        this.composeDraft = '';
    }
    /**
     * [v2.15.0] 收藏册：把一封信存进 tw_letters（随会话隔离，上限由 PhoneStorage 熔断兜底）。
     *  idempotent：同一封信（同 ts + 同首段）重复收藏不产生第二条。
     * @param {{title:string, paragraphs:string[], meta?:object}} letter
     * @returns {{ok:boolean, total:number, reason?:string}}
     */
    async saveLetter(letter) {
        try {
            if (!letter || !Array.isArray(letter.paragraphs) || !letter.paragraphs.length) {
                return { ok: false, total: this.listLetters().length, reason: '空信不入册' };
            }
            const list = this.listLetters();
            const ts = Number(letter.ts) || Date.now();
            const sig = String(letter.paragraphs[0] || '').slice(0, 40);
            if (list.some(x => Number(x.ts) === ts && String((x.paragraphs || [])[0] || '').slice(0, 40) === sig)) {
                return { ok: false, total: list.length, reason: '已有同一封信' };
            }
            const rec = {
                id: 'L' + ts.toString(36) + Math.random().toString(36).slice(2, 6),
                ts,
                savedAt: Date.now(),
                title: String(letter.title || '一段被织起的时光').slice(0, 40),
                source: letter.source === 'ai' ? 'ai' : 'local',
                paragraphs: (letter.paragraphs || []).map(p => String(p || '').slice(0, 600)).filter(Boolean).slice(0, 12),
                meta: (letter.meta && typeof letter.meta === 'object') ? letter.meta : {}
            };
            list.unshift(rec);
            await this.storage.set('tw_letters', list.slice(0, 60));
            return { ok: true, total: Math.min(list.length, 60) };
        } catch (e) {
            return { ok: false, total: this.listLetters().length, reason: String(e?.message || e) };
        }
    }
    /** [v2.15.0] 读收藏册（新→旧） */
    listLetters() {
        try {
            const raw = this.storage.get('tw_letters');
            const v = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            return Array.isArray(v) ? v.filter(x => x && Array.isArray(x.paragraphs)) : [];
        } catch (e) { return []; }
    }
    /**
     * [v2.15.0] 定期自动织信：距上次超过 minGapDays 天才真实生成（AI 优先，缺 API 时落本地规则版），
     *  避免每次打开 App 都触发 LLM 调用。游标存 tw_last_auto（stamp = 真实毫秒，随会话隔离）。
     * @param {{minGapDays?:number, force?:boolean}} [opts]
     * @returns {Promise<{generated:boolean, reason?:string}>}
     */
    async autoWeaveIfDue(opts = {}) {
        try {
            const gapMs = Math.max(1, Number(opts.minGapDays) || 7) * 86400000;
            const last = Number(this.storage.get('tw_last_auto')) || 0;
            if (!opts.force && last && (Date.now() - last) < gapMs) {
                const daysLeft = Math.ceil((gapMs - (Date.now() - last)) / 86400000);
                return { generated: false, reason: `距下次自动织信还有 ${daysLeft} 天` };
            }
            const model = buildNarrative(this.storage, { bucket: 'day' });
            if (model.empty || !model.letter) return { generated: false, reason: '碎片还太少' };
            let letter = { title: model.letter.title, paragraphs: model.letter.paragraphs, source: 'local', ts: Date.now() };
            const am = this._vp()?.apiManager;
            if (am && typeof am.callAI === 'function') {
                const ai = await this.composeAILetter();
                if (ai && ai.paragraphs && ai.paragraphs.length) {
                    letter = { title: ai.title, paragraphs: ai.paragraphs, source: 'ai', ts: Date.now() };
                }
            }
            const saved = await this.saveLetter(letter);
            await this.storage.set('tw_last_auto', Date.now());
            return { generated: true, saved };
        } catch (e) {
            return { generated: false, reason: String(e?.message || e) };
        }
    }
    /**
     * [v2.15.0] 把一封信分享到微信朋友圈（用户本人身份发帖，复用微信数据层）。
     *  结构化段落压成短引文 + 一句邀约，避免整封信糊在动态里。
     * @returns {{ok:boolean, reason?:string}}
     */
    shareLetterToMoments(letter) {
        try {
            const vp = this._vp();
            const wd = vp?.wechatApp?.wechatData || vp?.cachedWechatData;
            if (!wd || typeof wd.addMoment !== 'function') return { ok: false, reason: '微信未初始化' };
            if (!letter || !Array.isArray(letter.paragraphs) || !letter.paragraphs.length) return { ok: false, reason: '没有可分享的内容' };
            const userInfo = (typeof wd.getUserInfo === 'function' ? wd.getUserInfo() : null) || {};
            const tm = vp?.timeManager;
            const storyTime = tm?.getCurrentStoryTime?.() || {};
            const quote = String(letter.paragraphs[0] || '').replace(/\s+/g, ' ').slice(0, 90);
            const text = `把这段时光织成了一封信。

「${quote}……」

—— 织光机`;
            const now = new Date();
            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            wd.addMoment({
                id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
                name: userInfo.name || '我',
                avatar: userInfo.avatar || '😊',
                text,
                images: [],
                time: String(storyTime.time || now.toTimeString().slice(0, 5)),
                date: String(storyTime.date || `${now.getMonth() + 1}月${now.getDate()}日`),
                weekday: String(storyTime.weekday || weekdays[now.getDay()]),
                timestamp: Number(storyTime.timestamp) || Date.now(),
                likes: 0, likeList: [], comments: 0, commentList: [], imageGenerationStates: [],
                isUserPost: true,
                visibility: { type: 'public', contactIds: [], contactNames: [] }
            });
            try { vp?.wechatApp?.syncMomentsUnreadIndicator?.(); } catch (_e) {}
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: String(e?.message || e) };
        }
    }

    render() {
        this.view.render();
        this._maybeAutoWeave();
    }
    /**
     * [v2.15.0] 统一取 VirtualPhone 宿主。
     *  以前各处直接写 `window.VirtualPhone`，在非浏览器宿主（单测 / SSR / 无 window 环境）
     *  会抛 ReferenceError 并被上层 catch 吞成「静默失败」——日志上看起来像功能没生效。
     *  这里收敛为一个安全取值点。
     */
    _vp() {
        try {
            const w = (typeof window !== 'undefined') ? window
                : (typeof globalThis !== 'undefined' ? globalThis : null);
            return (w && w.VirtualPhone) || null;
        } catch (e) { return null; }
    }
    /**
     * [v2.15.0] 打开 App 时按间隔检查是否该自动织信（每个 App 实例生命周期内只检查一次）。
     *  生成成功才刷新视图并通知，避免打断用户当前操作；失败/未到期间隔静默。
     */
    _maybeAutoWeave() {
        if (this._autoChecked) return;
        this._autoChecked = true;
        const p = this.autoWeaveIfDue();
        if (p && typeof p.then === 'function') {
            p.then(res => {
                if (!res || !res.generated) return;
                this.view.render();
                try { this.phoneShell?.showNotification?.('织光机', '定期织信：新的一封已收入收藏册', '💌'); } catch (_e) {}
            }).catch(() => {});
        }
    }

    /**
     * [v2.14.0] AI 升华时光信：把 buildNarrative 的编年数据（letter/里程碑/亲密度/情绪曲线）
     * 作为事实素材，交给 LLM 用挚友口吻写成一封真正的信。
     * 引擎纯函数（composeLetter）不动——它产出的 stats/milestones/board 是本方法的事实源。
     * @returns {Promise<{title:string, paragraphs:string[], source:'ai'}|null>}
     */
    async composeAILetter() {
        const am = this._vp()?.apiManager || null;
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