/* ========================================================
 * backupdesk-app.js — [v3.91.0 · 拓展计划 R-X7] 本地备份与恢复 · 落盘与接线
 * 一条会话键走 ^backup_ 前缀随会话隔离：backup_ledger 备份与恢复台账。
 * 判定与计划全在 config/data-backup.js（纯函数），本件只做「读 → 判 → 落 → 渲染」。
 *
 * 【本件刻意不做的事】
 *   · **不联网**：本件没有 fetch / XMLHttpRequest / 外链；备份默认不上传云端。
 *   · **不自己解 JSON**：解析容错走仓内既有实现，本件只把文本交给咽喉。
 *   · **不自己判**：能不能导入 / 冲突怎么算 / 分面能不能换，全由内核判；
 *     本件只把意图交给咽喉（applyBackupAction）—— 重判就是同一口径两份实现。
 *   · **不编辑包体**：本件没有「改包」入口，只有选择 / 预览 / 提交 / 撤销四个动作。
 * ========================================================= */
'use strict';
import { BACKUP_DIM_KEYS, BACKUP_ENTRY_STATES, backupPackLine, backupPlanLine, backupSelfCheck } from '../../config/data-backup.js';
import { BackupdeskView } from './backupdesk-view.js';

export class BackupdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._dims = {};
        this._onConflict = 'keep';
        this._flash = '';
        this._flashBad = false;
    }
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.backupFace === 'function') ? vp.backupFace() : null;
        } catch (_e) { return null; }
    }
    setDim(dim, value) {
        if (BACKUP_DIM_KEYS.indexOf(String(dim)) < 0) return this._dims;
        const cur = Array.isArray(this._dims[dim]) ? this._dims[dim].slice() : [];
        const i = cur.indexOf(String(value));
        if (i >= 0) cur.splice(i, 1); else cur.push(String(value));
        this._dims[dim] = cur;
        this.render();
        return this._dims;
    }
    setConflict(mode) {
        this._onConflict = ['keep', 'overwrite', 'skip'].indexOf(String(mode)) >= 0 ? String(mode) : 'keep';
        this.render();
        return this._onConflict;
    }
    async act(action, extra) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyBackupAction !== 'function') {
            this._flash = '备份入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const scope = face && face.scope;
        const token = face && face.token;
        const payload = Object.assign({ action: action, selection: this._dims, onConflict: this._onConflict, scope: scope, token: token }, extra || {});
        let r;
        try { r = await vp.applyBackupAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== token || JSON.stringify(now.scope) !== JSON.stringify(scope))) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    render() {
        if (!this._view) this._view = new BackupdeskView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const self = backupSelfCheck();
        const plan = host && host.plan ? host.plan : null;
        return {
            scope: host && host.scope ? host.scope : {},
            scopeOk: !!(host && host.scopeState === 'ok'),
            keysText: host ? host.keysText : '键枚举读数还没取到',
            dims: BACKUP_DIM_KEYS,
            dimValues: (host && host.dimValues) || {},
            picked: this._dims,
            onConflict: this._onConflict,
            packLine: host && host.pack ? backupPackLine(host.pack) : '还没有导出任何包',
            planLine: plan ? backupPlanLine(plan, host && host.commit) : '还没有导入计划',
            planRows: plan ? plan.rows.filter((r) => r.state !== BACKUP_ENTRY_STATES.IDENTICAL).slice(0, 40) : [],
            identical: plan ? plan.totals.identical : 0,
            ledger: (host && host.ledger) || { readable: false, entries: [] },
            ledgerText: (host && host.ledger && host.ledger.readable)
                ? ('备份台账 ' + String(host.ledger.entries.length) + ' 条')
                : '备份台账**读不到**（不是「没备份过」—— 这两件事处置相反）',
            undo: host && host.undo ? host.undo : null,
            cloudLine: '默认不上传云端（本面零网络调用）',
            selfCheck: self,
            flash: this._flash, flashBad: this._flashBad,
        };
    }
    selfCheck() { return backupSelfCheck(); }
    onChatChanged() {
        /* 换会话必须丢**实例态**：选中的范围与提示行（上一个会话的选择不能留着）。 */
        this._dims = {};
        this._flash = '';
        this._flashBad = false;
        this.render();
    }
    destroy() { this._view = null; }
}
