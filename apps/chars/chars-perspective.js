/* ========================================================
 * chars-perspective.js — [v4.26.0 · 第四期 R4-X5] 群像页的
 *   「角色信息差与证词对照」接线件
 *
 * 【为什么单独一件，而不是塞进 chars-data.js】
 *   chars-data.js 的立身之本是「快照角色状态表的投影内核」（纯函数、零 perspective 概念），
 *   它自 v2.51.0 以来一个字节都没碰过视角面。本件消费的是**另一条上游通路**
 *   （`LonShaMemory.perspectiveContrast` / `testimonyBoard`），且要**两路出口 + 模式闸 + 版式**——
 *   塞进 data 会让那个文件同时持两种口径（本仓治过多次的「一份文件两套账」）。
 *   故单开一件：归因与口径**全部**转手 config/perspective-contrast-contract.js（同一口径只许一份实现），
 *   本件只做「取数 + 交给内核 + 把读数摆成手机能渲染的形状」。
 *
 * 【本件只做三件事（不重算任何上游口径）】
 *   1 **取数**：从只读桥（`window.LonShaMemory`）取两人对照读数与证词板读数；
 *   2 **模式闸**：作者 / 角色模式**显式选择**，切换只影响**呈现**、不改任何账
 *      （验收第 ③ 条「作者比较不改变知识账」）；
 *   3 **落点形状**：并排对照卡 + 证词卡 + 窄屏逐人切换的版式判定（验收第 ④ 条）。
 *
 * 【边界（如实登记，不装）】
 *   · 本件**不判**哪个名字是真名（那是上游 identity 口径；本件只按面过滤并如实计数）；
 *   · 本件**不合成**信息差分数（上游 contrast 刻意不给，本仓也不给）；
 *   · 本件**不裁真相**（四态与三档原样端出，不投票）；
 *   · 上游不在就如实报缺席，**不退回本地猜一份对照**。
 * ======================================================== */
'use strict';
import {
    readPerspectiveContrast, readTestimonyBoard, readTestimonyRevoke,
    planPerspectiveMode, gateContrastByMode, visibleAtFace, layoutOf,
    perspectiveModePromptBlock, contrastLine, testimonyLine,
    pcxSelfCheck, PCX_MODES, PCX_STATES, PCX_IDENTITY_VIEWS
} from '../../config/perspective-contrast-contract.js';

export class CharsPerspective {
    constructor(app) {
        this.app = app;
        /** 角色模式下「当前角色」是谁（视图中由用户显式选择；不在构造期猜测） */
        this._current = '';
        /** 证词面身份视图（未揭穿 / 已揭穿 / 全呈；默认未揭穿 = 验收第 ② 条） */
        this._face = PCX_IDENTITY_VIEWS[0];
    }
    _win() {
        try { return this.app && typeof this.app._win === 'function' ? this.app._win() : ((typeof window !== 'undefined') ? window : globalThis); }
        catch (_e) { return globalThis; }
    }
    /** 当前模式（**显式选择**；默认作者）——读不到设置时如实按作者处置并报读不出。 */
    mode() {
        let raw = '';
        try { raw = String(this.app?.getSettings?.().perspectiveMode || ''); } catch (_e) { raw = ''; }
        return planPerspectiveMode(raw);
    }
    /** 切换模式（**只改呈现**：本方法零写上游、零写账）。 */
    setMode(mode) {
        /* ★ 合法性判定**不在这里再判一遍**：转手内核 planPerspectiveMode（同一口径只许一份实现）；
         *   自己写一份白名单，就会出现「内核改了、接线层还认旧值」的两套账。 */
        const plan = planPerspectiveMode(mode);
        if (!plan.ok) return { ok: false, reason: plan.reason };
        try { this.app?.saveSettings?.({ perspectiveMode: plan.mode }); } catch (_e) { /* 不抛 */ }
        return { ok: true, mode: plan.mode };
    }
    /**
     * 模式取值清单（**界面选项的唯一出处**）。
     *   ★ 视图不许再写第二份 `'author' / 'character'` 字面量：改一处即全仓同改。
     */
    modeIds() { return [PCX_MODES.AUTHOR, PCX_MODES.CHARACTER]; }
    /** 身份视图取值清单（**界面选项的唯一出处**；同上，视图不写第二份）。 */
    faceIds() { return PCX_IDENTITY_VIEWS.slice(); }
    /** 当前角色（角色模式下的「我」；作者模式忽略）。空串表示未选。 */
    current() { return String(this._current || ''); }
    setCurrent(name) { this._current = String(name == null ? '' : name).trim().slice(0, 40); return this._current; }
    /** 身份视图（未揭穿 / 已揭穿 / 全呈）。 */
    face() { return String(this._face || 'surface'); }
    setFace(face) {
        const f = String(face || '').toLowerCase();
        /* ★ 取值清单走内核 PCX_IDENTITY_VIEWS：接线层**不写第二份**面名清单。 */
        if (PCX_IDENTITY_VIEWS.indexOf(f) < 0) return { ok: false, reason: 'face-invalid' };
        this._face = f;
        return { ok: true, face: f };
    }
    /**
     * 并排对照读数（原样透传内核；本件不重判）。
     * @param {string} a 左侧角色（角色模式下 = 正在扮演的人）
     * @param {string} b 右侧角色
     */
    contrast(a, b, opts) {
        return readPerspectiveContrast(this._win(), a, b, opts || {});
    }
    /** 对照一行读数（视图借用；判定全在内核 contrastLine）。 */
    contrastLineOf(read) { return contrastLine(read); }
    /** 模式闸：把对照裁成该模式可呈现的形状（输入一个字节不动）。 */
    gated(read) { return gateContrastByMode(this.mode().mode, read); }
    /** 证词面读数（只读；四态与三档原样端出）。 */
    testimony(opts) { return readTestimonyBoard(this._win(), opts || {}); }
    /** 证词一行读数（视图借用）。 */
    testimonyLineOf(read) { return testimonyLine(read); }
    /**
     * 撤回一条证据 ⇒ 重算争议状态。
     *   ★ 本件只**搬**上游的重算结果：撤到无独立支持 ⇒ undecided / withdrawn，
     *     不退化成 contested（不静默留一个没人能举证的争议）。
     *   ★ 撤回是**上游的账**动作；手机端不发撤回（那是上游的控制面），
     *     本方法只在用户点「核对撤回后状态」时把上游给的读数摆出来。
     */
    revoke(dropped, opts) { return readTestimonyRevoke(this._win(), dropped, opts || {}); }
    /** 按身份面过滤一块板（未揭穿视图挡掉 revealed，如实计数；不判真名）。 */
    visible(board) { return visibleAtFace(board, this.face()); }
    /** 版式（窄屏逐人切换 / 宽屏并排；宽度读不出 ⇒ 按窄屏保守处置）。 */
    layout(width) { return layoutOf(width); }
    /**
     * 生成侧块（**模式闸下的上下文**）。
     *   ★ 角色模式：对方独有的事实**一条都不进块**（验收第 ③ 条与「不做全知正文」纪律的落点）；
     *   ★ 作者模式：给全知对照（读数，不是账）；
     *   ★ 模式非法 / 读数不 OK ⇒ 返回 ''（不给块，不拿猜的模式喂全知正文）。
     */
    promptBlock(read, opts) {
        return perspectiveModePromptBlock(this.mode().mode, read, Object.assign({ current: this.current() }, opts || {}));
    }
    /**
     * 一次取齐「模式 + 对照 + 证词 + 版式」（视图用它，保证同一份读数上的四面同源）。
     * @param {string} a @param {string} b
     * @param {{width?:number, at?:number, event?:string}} [opts]
     */
    pack(a, b, opts = {}) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const read = this.contrast(a, b, o);
        const tb = this.testimony(o);
        const boards = (tb.state === PCX_STATES.OK) ? (tb.boards || []).map((bd) => {
            const vis = this.visible(bd);
            return { board: bd, visible: vis };
        }) : [];
        return {
            mode: this.mode(),
            face: this.face(),
            current: this.current(),
            read: read,
            contrastLine: contrastLine(read),
            gated: gateContrastByMode(this.mode().mode, read),
            tb: tb,
            testimonyLine: testimonyLine(tb),
            boards: boards,
            layout: layoutOf(o.width)
        };
    }
    /**
     * 换会话作废现场（与全仓「换会话作废现场」同规）。
     *   ★ 必须作废的是**场景态**：`_current`（上一会话选中的角色名）与 `_face`（上一会话看过的身份面）——
     不清就会把上一个会话选中的角色名带进新会话的**角色模式生成块**（不报错，只是错上下文）；
   ★ **不清** `perspectiveMode`：那是随会话隔离的**设置**（存在 `chars_` 键里），不是现场读数。
     */
    resetScene() {
        this._current = '';
        this._face = PCX_IDENTITY_VIEWS[0];
        return { ok: true, current: this._current, face: this._face };
    }
    /** 自检（纯转发内核；本件不另立一份口径）。 */
    selfCheck() {
        try {
            const r = pcxSelfCheck();
            return { problems: Array.isArray(r && r.problems) ? r.problems : [] };
        } catch (_e) { return { problems: ['selfcheck-threw'] }; }
    }
}
export default CharsPerspective;