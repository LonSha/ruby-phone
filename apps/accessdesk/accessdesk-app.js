/* ========================================================
 * accessdesk-app.js — [v3.93.0 · 拓展计划 R-X9] 无障碍操作台 · 落盘与接线
 *
 * 【本件刻意不做的事】
 *   · 不自己判：三档怎么定、四态怎么分、窄屏怎么排、名字取哪个真源，
 *     全由内核 config/access-layers.js 判；本件只把意图交给咽喉（applyAccessAction）。
 *   · 不自己写 DOM 属性：dataset 与 CSS 变量由咽喉的 refreshAccess() 统一写
 *     （写两处必然漂移：一处改了另一处没改，界面就是「看起来生效了、其实没生效」）。
 *   · 不新开键：低动画复用 sys_motion_level、字体缩放复用 phone-font-scale，
 *     本 App 只写 sys_access_level / sys_access_compact / sys_access_theme 三键。
 * ========================================================= */
'use strict';
import { AX_LEVEL_LIST, AX_THEMES, accessSelfCheck, markOf, overlapGuardOf } from '../../config/access-layers.js';
import { AccessdeskView } from './accessdesk-view.js';

export class AccessdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._flash = '';
        this._flashBad = false;
        this._previewLevel = '';    /* 只读预览用的档位（不落盘） */
    }
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.accessFace === 'function') ? vp.accessFace() : null;
        } catch (_e) { return null; }
    }
    /**
     * 唯一动作入口。动作白名单（内核与咽喉各有一份，此处只转发）：
     *   level / compact / theme —— 三件落盘设置；preview —— 纯视图态（不落盘）。
     */
    async act(action, value) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyAccessAction !== 'function') {
            this._flash = '无障碍操作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const name = String(action || '');
        if (name === 'preview') {
            /* 预览是纯视图态：改的是「这一屏怎么排」，不落盘、不进 storage，
             *   故它不进白名单、也不经过咽喉 —— 它根本不写任何东西。 */
            const v = String(value === null || value === undefined ? '' : value);
            this._previewLevel = AX_LEVEL_LIST.indexOf(v) >= 0 ? v : '';
            this.render();
            return { ok: true, note: '预览档：' + (this._previewLevel || '（跟随设置）'), kind: 'preview' };
        }
        const face = this._displayedFace;
        const token = face ? face.token : undefined;
        let r;
        try { r = await vp.applyAccessAction({ action: name, value: value, token: token }); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && token !== undefined && now.token !== token) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    setLevel(v) { return this.act('level', v); }
    setCompact(v) { return this.act('compact', v); }
    setTheme(v) { return this.act('theme', v); }
    preview(v) { return this.act('preview', v); }
    render() {
        if (!this._view) this._view = new AccessdeskView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const self = accessSelfCheck();
        const base = (host && host.plan) ? host.plan : { narrow: false, reason: '读数还没取到' };
        /* 预览档位只在视图态生效：拿它现算一份 plan 给用户看，
         *   但落盘的那一份始终以咽喉为准（预览绝不写 storage）。 */
        const previewPlan = this._previewLevel
            ? { narrow: base.narrow === true, reason: base.reason || '', level: this._previewLevel }
            : base;
        const guard = overlapGuardOf(previewPlan, host ? host.fontPercent : null);
        const mark = markOf(host && host.levelState, host && host.levelText);
        return {
            levels: AX_LEVEL_LIST,
            level: this._previewLevel || (host && host.level) || 'standard',
            levelSaved: (host && host.level) || 'standard',
            previewing: !!this._previewLevel,
            themes: AX_THEMES,
            theme: (host && host.theme) || 'auto',
            themeSource: (host && host.themeSource) || 'default',
            compact: !!(host && host.compact),
            /* 三件既有真源的读数（本 App 只读它们，不写） */
            motionLevel: (host && host.motionLevel) || '（读不出）',
            fontPercent: host ? host.fontPercent : null,
            fontBand: guard.band,
            /* 排版依据**只此一格**：视图按 plan 排版（narrow / reason / level），
             *   不再从 narrow 与 narrowReason 两个字段各自还原一次口径。 */
            plan: previewPlan,
            narrow: previewPlan.narrow === true,
            narrowReason: previewPlan.reason || '',
            guard: guard,
            counts: (host && host.counts) || { ok: 0, fail: 0, unknown: 0, empty: 0 },
            focusRing: (host && host.focusRing) || 'unknown',
            namesMissing: (host && host.namesMissing) !== undefined ? host.namesMissing : null,
            selfCheck: self,
            stateMark: mark,
            flash: this._flash,
            flashBad: this._flashBad,
            note: (host && host.note) || '读数还没取到（咽喉那一轮尚未跑）'
        };
    }
    selfCheck() { return accessSelfCheck(); }
    onChatChanged() {
        /* 换会话必须丢实例态：提示行与预览档（上一个会话的预览不能留着）。 */
        this._flash = '';
        this._flashBad = false;
        this._previewLevel = '';
        this.render();
    }
    destroy() { this._view = null; }
}