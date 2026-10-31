/* ============================================================
 * config/destructive-confirm.js — 销毁动作的**唯一**二次确认实现 [v4.105.0 · R13-O2]
 * ------------------------------------------------------------
 * 【本面治的欠债（修前实测处境）】
 *   本仓「清空 / 删除」类按钮此前有三种写法并存，第三种是**没有**：
 *     ① window.confirm('...')             —— 散在 9 个文件、文案各写一遍；
 *     ② this._showPhoneConfirm({...})     —— 只在设置页（7 处），别家拿不到；
 *     ③ 直接调 self.app.clearAll()        —— 19 个 App、40 个分支，点一下就没。
 *   第 ③ 种的后果不是崩溃，而是**一键到底**：改错能撤销（O2 声明面）这条主轴，
 *   在「删了回不来」的动作上此前是整片空白，而这类动作恰恰最不可逆。
 *
 * 【为什么不是「各 View 自己写一句 confirm」】
 *   本仓治过六次的形态正是「同一件事 N 份实现」：文案漂移、判定漂移、
 *   漏改一处就永久留一个无确认入口，而且没有任何门禁能从 N 份里看出漏了哪份。
 *   所以这里收成一个出口：View 只说「我要删什么」，文案与可撤销性由声明面给。
 *
 * 【文案为什么必须来自声明面而不是手写】
 *   用户看到的「此操作不可撤回」必须与 `config/undo-capability.js` 的声明**同源**。
 *   两处各写一遍必然漂移：声明改成 undo 了、文案还写着「不可撤回」，
 *   于是用户在一个真能恢复的动作上被吓住；反过来更糟 —— 声明是 irreversible、
 *   文案却写「可撤销」，用户放心点下去，东西没了。故本模块**只**读声明面。
 *
 * 【降级纪律】
 *   宿主没有 window.confirm（无头/桩环境）时**返回 false（不放行）**：
 *   「确认框弹不出来」不等于「用户同意了」。本仓在 resume-handoff / 备份恢复
 *   等处已确立同一口径：拿不到用户意志时，破坏性动作一律不执行。
 *   要放行必须显式传 `{ assumeConfirm: true }` —— 那是**测试**用的口子，
 *   产品路径一个都不许传（判据 C 组会查）。
 *
 * 【诚实边界】
 *   本模块只保证「点了会先问一句，且问的是这件事」；它**不**保证：
 *     · 用户读懂了文案（文案可读性无人能替）；
 *     · 确认之后的执行路径真的只删了它说的那部分（那归各 App 的删除实现）；
 *     · 二次确认能挡住「手滑 + 连点」—— 确认框弹在你手上，责任在你手上。
 * ============================================================ */
'use strict';

import { undoCapabilityOf } from './undo-capability.js';

/** 宿主是否有可用的原生确认框（仅用于自述，不参与判定）。 */
export function hasNativeConfirm() {
    try {
        return typeof window !== 'undefined' && typeof window.confirm === 'function';
    } catch (_e) { return false; }
}

/**
 * 组装「这句确认」要说什么。导出是为了让判据能**只验文案**（不弹框）。
 * @param {{appId:string, action:string, what?:string, count?:number, undoable?:boolean}} opts
 * @returns {{title:string, text:string, ok:boolean}}
 */
export function describeDestroy(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const appId = String(o.appId || '');
    const action = String(o.action || '删除');
    const what = String(o.what || '').trim();
    const cap = undoCapabilityOf(appId);
    const mode = String((cap && cap.mode) || 'irreversible');
    /* ★ 可撤销性只认**声明面**，不认调用方传进来的 undoable：
     *   调用方当然会说自己这次可撤销（它只想少弹一个框），而声明面是按磁盘复算过的。 */
    const recoverable = mode === 'undo';
    const n = Number(o.count);
    const countText = (Number.isFinite(n) && n > 0) ? ('（共 ' + String(n) + ' 项）') : '';
    const tail = recoverable
        ? '删除后会先进「设置 → 回收站」，在那里可以恢复。'
        : ('此操作不可撤回' + (what ? '：' : '。') + what);
    return {
        ok: true,
        title: '确认' + action,
        text: '确定要' + action + countText + '吗？' + String.fromCharCode(10) + String.fromCharCode(10) + tail,
        mode: mode,
        recoverable: recoverable,
    };
}

/**
 * 统一出口：问一句，返回用户是否同意。
 * 没有可用确认框 + 未显式 assumeConfirm ⇒ 一律 false（不放行）。
 * @param {{appId:string, action:string, what?:string, count?:number, assumeConfirm?:boolean}} opts
 * @returns {boolean}
 */
export function confirmDestroy(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const d = describeDestroy(o);
    if (!hasNativeConfirm()) {
        /* 无头/桩环境：assumeConfirm 是**测试专用**口子。产品路径传它 = 判据 C 组的事。 */
        return o.assumeConfirm === true;
    }
    try {
        return window.confirm(d.text) === true;
    } catch (_e) {
        /* 确认框自己抛 ⇒ 视同「没拿到同意」，不放行（fail-closed）。 */
        return false;
    }
}

export default { describeDestroy, confirmDestroy, hasNativeConfirm };