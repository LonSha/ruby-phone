/* ========================================================
 * creation-workbench-app.js — [v3.90.0 · 拓展计划 R-X6]
 *   素材到发布的完整创作工作台 · 落盘与接线
 *
 * 【本件刻意不做的事（验收③④的落点）】
 *   · **不发布**：本件没有 addMoment / publishUserPost / createNovel 的任何直接调用；
 *     发布动作一律交咽喉的 cwInvokeOwner（那里才认目标 App 的**真源写口**）。
 *   · **不造第二份草稿/素材状态**：素材清单与草稿读数全部读咽喉缓存（`_creationWorkbench`），
 *     草稿本身走 creation-pipeline 的同一个幂等键。
 *   · **不自己判**：能不能发布全由内核 cwPlanPublish 判；本件只把意图交上去
 *     —— 重判就是同一口径两份实现。
 *   · **不执行任意用户 JS**：素材与目标是**数据**，没有脚本编辑器。
 * ========================================================= */
'use strict';
import { cwPlanLine, cwSelfCheck, CW_STEPS } from '../../config/creation-workbench.js';
import { CreationWorkbenchView } from './creation-workbench-view.js';

export class CreationWorkbenchApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._pickRef = '';
        this._target = '';
        this._sensitive = false;
        this._note = '';
        this._flash = '';
        this._flashBad = false;
    }
    /* ---------- 读数：只取，不判 ---------- */
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.creationWorkbenchFace === 'function') ? vp.creationWorkbenchFace() : null;
        } catch (_e) { return null; }
    }
    /* ---------- 交互：全部转咽喉 ---------- */
    setPick(ref) { this._pickRef = String(ref || ''); this.render(); return this._pickRef; }
    setTarget(t) { this._target = String(t || ''); this.render(); return this._target; }
    setSensitive(on) { this._sensitive = on === true; this.render(); return this._sensitive; }
    setNote(note) { this._note = String(note || ''); return this._note; }
    async act(action) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationWorkbenchAction !== 'function') {
            this._flash = '创作工作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const scope = face && face.scope;
        const token = face && face.token;
        const payload = {
            action: action,
            ref: this._pickRef,
            target: this._target,
            sensitive: this._sensitive,
            note: this._note,
            scope: scope,
            token: token,
        };
        let r;
        try { r = await vp.applyCreationWorkbenchAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== token || JSON.stringify(now.scope) !== JSON.stringify(scope))) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    /* ---------- 渲染 ---------- */
    render() {
        if (!this._view) this._view = new CreationWorkbenchView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const mats = host && host.materials ? host.materials : { items: [], states: [], unreadable: [], dropped: 0, readable: false };
        const plan = host && host.plan ? host.plan : null;
        const self = cwSelfCheck(this._target);
        return {
            scope: host && host.scope ? host.scope : {},
            scopeOk: !!(host && host.scopeState === 'ok'),
            materials: mats,
            materialsText: mats.readable
                ? ('素材 ' + String(mats.items.length) + ' 条（认不出 ' + String(mats.dropped) + ' 条）')
                : ('有 ' + String(mats.unreadable.length) + ' 类清单**读不到**（不是「没有素材」—— 这两件事处置相反）'),
            states: mats.states || [],
            pickRef: this._pickRef,
            target: this._target,
            targets: (host && host.targets) || [],
            sensitive: this._sensitive,
            plan: plan,
            planLine: cwPlanLine(plan),
            steps: CW_STEPS,
            published: (host && host.published) || { readable: false, entries: [], dropped: 0 },
            publishedText: (host && host.published && host.published.readable)
                ? ('已发布台账 ' + String(host.published.entries.length) + ' 条')
                : '已发布台账**读不到**（不是「没发过」）',
            selfCheck: self,
            flash: this._flash,
            flashBad: this._flashBad,
        };
    }
    selfCheck() { return cwSelfCheck(this._target); }
    onChatChanged() {
        /* 换会话必须丢**实例态**：选中素材 / 目标 / 提示行（换角色后上一个角色的选中项不能留着）。 */
        this._pickRef = '';
        this._target = '';
        this._sensitive = false;
        this._note = '';
        this._flash = '';
        this._flashBad = false;
        this.render();
    }
    destroy() { this._view = null; }
}
