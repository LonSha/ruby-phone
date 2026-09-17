/* ========================================================
 * 塔罗 (Tarot) App — 应用控制器
 * 纯本地抽牌 + 存档; AI 解读通过剧情自然输出 (<TAROT> 协议注入)
 * ======================================================== */
'use strict';
import { SPREADS, drawCards, buildTarotInjection } from './tarot-data.js';
import { TarotView } from './tarot-view.js';

export class TarotApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.KEY = 'ruby_tarot_history';
        this.history = [];
        this.currentDraw = null;
        this.view = new TarotView(this);
        this._load();
    }

    _load() {
        try {
            const raw = this.storage?.get?.(this.KEY);
            if (raw) this.history = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
        } catch (e) { this.history = []; }
    }

    _save() {
        try {
            this.storage?.set?.(this.KEY, JSON.stringify(this.history.slice(0, 50)));
        } catch (e) { /* 忽略 */ }
    }

    // 执行一次抽牌
    performDraw(spreadKey, question = '') {
        const draw = drawCards(spreadKey, {});
        this.currentDraw = { ...draw, question: String(question || '').trim(), at: Date.now() };
        // 存档 (不含 position 引用, 便于序列化)
        this.history.unshift({
            at: this.currentDraw.at,
            question: this.currentDraw.question,
            spread: draw.spread.name,
            cards: draw.cards.map(c => ({ key: c.key, name: c.name, reversed: c.reversed, up: c.reversed ? c.down : c.up, position: c.position.label }))
        });
        this._save();
        return this.currentDraw;
    }

    // 生成给 AI 的解读提示 (<TAROT> 注入)
    buildInjection() {
        if (!this.currentDraw) return '';
        return buildTarotInjection(this.currentDraw);
    }

    onChatChanged() {
        // [v2.23.0] 换会话重绑：清空内存态并按新会话键重新载入抽牌历史。
        this.history = [];
        this.currentDraw = null;
        this._load();
    }

    render() {
        if (!this.phoneShell?.setContent) return;
        this.view.render();
    }
}

export default TarotApp;