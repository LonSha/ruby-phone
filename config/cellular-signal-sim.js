/* ========================================================
 * config/cellular-signal-sim.js
 * RubyPhone R10-O7 · 多卡槽与蜂窝网络弱网漫游模拟
 * 
 * 核心机制：
 * 1. 双卡槽与虚拟 eSIM 管理 (Multi-SIM Profiles):
 *    - SIM1 (主卡): 绑定日常通讯录与默认数据通道
 *    - SIM2 (备用卡/临时 eSIM): 绑定涉密或特定角色联系人，支持独立停机/激活
 * 2. 物理弱网与信号衰减状态机 (Signal Strength & Network Types):
 *    - 信号格数: 0 ~ 5 格
 *    - 制式: 5G, 4G, 3G, NO_SERVICE (无服务)
 *    - 物理场景触发: 地铁/电梯/地下密室自动跌落至 NO_SERVICE
 * 3. 弱网消息挂起与恢复补偿 (Offline Outbox Queue):
 *    - 无服务或断网时发送消息，进入挂起队列 (PENDING_OFFLINE)
 *    - 信号恢复（>= 1 格）时自动排队补发，触发剧情投递回执
 * ======================================================== */

export const NETWORK_TYPES = Object.freeze({
    FIVE_G: '5G',
    FOUR_G: '4G',
    THREE_G: '3G',
    NO_SERVICE: 'NO_SERVICE'
});

export class CellularSignalSim {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.simSlots = [
            { id: 'sim_1', label: '主卡', carrier: opts.carrier1 || 'Docomo 5G', active: true, phoneNumber: '138****0101' },
            { id: 'sim_2', label: '副卡(eSIM)', carrier: opts.carrier2 || 'Virtual Secure eSIM', active: false, phoneNumber: '170****9922' }
        ];
        this.activeDataSim = 'sim_1';
        this.signalBars = 4; // 0 ~ 5
        this.networkType = NETWORK_TYPES.FIVE_G;
        this.outboxQueue = []; // 离线挂起队列
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('cellular_sim_outbox', []);
            if (Array.isArray(raw)) this.outboxQueue = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('cellular_sim_outbox', this.outboxQueue);
        } catch (_e) {}
    }

    /**
     * 设置环境物理场景（模拟电梯、地下密室、隧道）
     * @param {string} scenario 'NORMAL' | 'ELEVATOR' | 'SUBWAY_TUNNEL' | 'BASEMENT'
     */
    applyEnvironmentScenario(scenario) {
        switch (scenario) {
            case 'ELEVATOR':
            case 'BASEMENT':
                this.signalBars = 0;
                this.networkType = NETWORK_TYPES.NO_SERVICE;
                break;
            case 'SUBWAY_TUNNEL':
                this.signalBars = 1;
                this.networkType = NETWORK_TYPES.THREE_G;
                break;
            case 'NORMAL':
            default:
                this.signalBars = 5;
                this.networkType = NETWORK_TYPES.FIVE_G;
                break;
        }
        // 信号恢复时自动触发补发
        if (this.signalBars > 0 && this.outboxQueue.length > 0) {
            return this.flushOutbox();
        }
        return { flushed: 0, pending: this.outboxQueue.length };
    }

    /**
     * 尝试发送消息（若弱网则挂起）
     * @param {Object} message { toContact, text, type }
     * @returns {Object} { sent: boolean, status: 'SENT'|'QUEUED', messageId: string }
     */
    dispatchMessage(message) {
        const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const item = {
            id,
            ...message,
            queuedAt: Date.now(),
            viaSim: this.activeDataSim
        };

        if (this.networkType === NETWORK_TYPES.NO_SERVICE || this.signalBars === 0) {
            this.outboxQueue.push(item);
            this._save();
            return { sent: false, status: 'QUEUED', messageId: id, reason: 'NO_CELLULAR_SIGNAL' };
        }

        return { sent: true, status: 'SENT', messageId: id };
    }

    /**
     * 信号恢复时排队冲刷补发离线消息
     * @returns {Object} 冲刷统计
     */
    flushOutbox() {
        if (this.networkType === NETWORK_TYPES.NO_SERVICE || this.signalBars === 0) {
            return { flushed: 0, pending: this.outboxQueue.length };
        }

        const count = this.outboxQueue.length;
        const delivered = [...this.outboxQueue];
        this.outboxQueue = [];
        this._save();

        return {
            flushed: count,
            pending: 0,
            deliveredMessages: delivered
        };
    }

    /**
     * 切换主数据卡
     */
    switchDataSim(simId) {
        const target = this.simSlots.find(s => s.id === simId);
        if (!target || !target.active) return false;
        this.activeDataSim = simId;
        return true;
    }

    toggleSimSlot(simId, active) {
        const target = this.simSlots.find(s => s.id === simId);
        if (!target) return false;
        target.active = !!active;
        if (!target.active && this.activeDataSim === simId) {
            const fallback = this.simSlots.find(s => s.active);
            if (fallback) this.activeDataSim = fallback.id;
        }
        return true;
    }

    getStatus() {
        return {
            simSlots: this.simSlots,
            activeDataSim: this.activeDataSim,
            signalBars: this.signalBars,
            networkType: this.networkType,
            hasConnection: this.signalBars > 0 && this.networkType !== NETWORK_TYPES.NO_SERVICE,
            outboxPendingCount: this.outboxQueue.length
        };
    }
}