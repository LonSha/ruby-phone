/* ========================================================
 * caphealth-app.js — [v3.92.0 · 拓展计划 R-X8]
 *   宿主与能力健康中心 · 落盘与接线
 *
 * 【本件刻意不做的事（计划验收③的落点）】
 *   · **不自己检测**：本件不 fetch、不调模型、不写存储、不碰浏览器能力探针 ——
 *     观测一律由咽喉的取数口注入（判定内核零 import 零 IO）。
 *   · **不自己判**：四态怎么分、替代操作给什么，全由内核判；
 *     本件只把意图交给咽喉（applyCaphealthAction）—— 重判就是同一口径两份实现。
 *   · **不自己拼报告**：诊断报告文本的唯一实现在内核 capHealthReport，由咽喉调；
 *     本件只负责把它复制出去（剪贴板动作是用户显式点的，不是检测）。
 *   · **不缓存读数**：读数现取现画（缓存即第二个真源）。
 * ========================================================= */
'use strict';
import { CAPABILITY_IDS, capHealthSelfCheck, capSummaryLine } from '../../config/capability-health.js';
import { CaphealthView } from './caphealth-view.js';

export class CaphealthApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._flash = '';
        this._flashBad = false;
        this._report = '';
    }
    /* ---------- 读数：只取，不判 ---------- */
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.capHealthFace === 'function') ? vp.capHealthFace() : null;
        } catch (_e) { return null; }
    }
    /**
     * 唯一的动作入口（白名单只有一个：report）。
     * 「复制诊断报告」= 求文本 + 复制；文本由咽喉按**已判定**的读数拼，
     *   本件不现取任何观测（检测绝不因为「点了复制」而发生）。
     */
    async act(action) {
        const name = String(action || '');
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCaphealthAction !== 'function') {
            this._flash = '能力体检入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const token = face ? face.token : undefined;
        let r;
        try { r = await vp.applyCaphealthAction({ action: name, token: token }); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        if (!r || r.ok !== true) {
            this._flash = String((r && r.note) || '动作没有成功');
            this._flashBad = true;
            this.render();
            return r;
        }
        this._report = String(r.report || '');
        let copied = false;
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(this._report);
                copied = true;
            }
        } catch (_e) { copied = false; }
        this._flash = copied
            ? ('诊断报告已复制（' + String(r.note || '') + '）')
            : ('剪贴板不可用：报告已显示在下方，可手动选中复制（' + String(r.note || '') + '）');
        this._flashBad = false;
        this.render();
        return Object.assign({}, r, { copied: copied });
    }
    render() {
        if (!this._view) this._view = new CaphealthView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const self = capHealthSelfCheck();
        const summary = (host && host.summary) ? host.summary : null;
        const notice = (host && host.notice) ? host.notice : null;
        return {
            ids: CAPABILITY_IDS,
            summary: summary,
            summaryLine: summary ? summary.line : capSummaryLine(null, 0),
            rows: summary ? summary.rows.slice() : [],
            faceReadable: !!(host && host.readable),
            faceWhy: host ? String(host.why || '') : '能力面取数口不在位（咽喉未就绪）',
            hostVersion: host ? String(host.hostVersion || '') : '',
            /* 键名与咽喉缓存逐字对齐（`hostVersionText`）：本版实测抓到过一处错位 ——
             *   这里曾读 `hostVersionLine`，而咽喉写的是 `hostVersionText` ⇒
             *   宿主版本明明取到了，界面永远显示「还没取到」（不报错、只错读数）。 */
            hostVersionLine: (host && host.hostVersionText) ? String(host.hostVersionText) : '宿主版本还没取到',
            notice: notice,
            noticeLine: notice ? notice.line : '跨仓读数还没取到',
            report: this._report,
            selfCheck: self,
            zeroWrite: (host && host.writes === 0) ? true : false,
            flash: this._flash, flashBad: this._flashBad,
        };
    }
    selfCheck() { return capHealthSelfCheck(); }
    onChatChanged() {
        /* 换会话必须丢**实例态**：提示行与已生成的报告（上一段会话的报告不能留着）。 */
        this._flash = '';
        this._flashBad = false;
        this._report = '';
        this.render();
    }
    destroy() { this._view = null; }
}
