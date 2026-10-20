/* ========================================================
 * plotline-view.js — [v2.49.0] 剧情线视图
 *
 * 【这一面存在的理由】上游记忆插件把「大纲 + 世界推进」外供到只读桥快照上，
 *   而手机端此前零消费——于是「剧情走到哪一步了」「有哪些承诺还没兑现」
 *   「哪些支线还在推进」在手机上完全答不出。本视图把四块投影摆出来
 *   （当前大纲 / 承诺 / 支线 / 认知），并把**读不到的原因**一并摆出来
 *   （五态归因），而不是显示一个和「世界是空的」同形的空页。
 *
 * 只读：数据全部来自 this.app.projection()（内部只读桥，不写任何状态）。
 * 结构：_esc + _draw + _bind（与 place-view 同风格）。
 * ============================================================ */
'use strict';
import { PROMISE_STATUS, ARC_STATUS } from './plotline-data.js';
export class PlotlineView {
    constructor(app) {
        this.app = app;
        this.container = null;
        /** 最近一次渲染用的读数包（供绑定回调判断是否可用） */
        this._pkg = null;
    }
    render(container) {
        if (!container) return;
        this.container = container;
        this._draw();
    }
    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '\x26quot;');
    }
    _statusLabel(map, s) {
        return map[s] || s || '未知';
    }
    _draw() {
        let pkg = null;
        try { pkg = this.app.projection(); } catch (_e) { pkg = null; }
        this._pkg = pkg;
        const face = (pkg && pkg.face) || { reason: 'bridge-absent', text: '剧情线不可读', state: 'absent' };
        const stage = (pkg && pkg.stage) || { title: '', goal: '', tempo: '', nodes: [], hasStage: false };
        const promises = (pkg && pkg.promises) || [];
        const arcs = (pkg && pkg.arcs) || [];
        const knowledge = (pkg && pkg.knowledge) || [];
        const boundaries = (pkg && pkg.boundaries) || [];
        const src = (pkg && pkg.src) || null;
        const html = [
            '<div class="pn-root">',
            '  <header class="pn-header">',
            '    <button class="pn-nav" id="pn-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>剧情线</h2>',
            '    <button class="pn-nav" id="pn-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="pn-body">',
            this._reasonCard(face),
            this._sourceCard(src),
            this._stageCard(face, stage),
            this._promiseCard(face, promises),
            this._arcCard(face, arcs),
            this._knowledgeCard(face, knowledge, boundaries),
            this._parallelCard(face, (pkg && pkg.parallels) || []),
            this._secretCard(face, (pkg && pkg.secrets) || []),
            this._echoCard(face, (pkg && pkg.recallEchoes) || [], (pkg && pkg.echoLives) || []),
            this._boardCard(),
            this._goalCard(),
            this._settingsCard(),
            '  </div>',
            '</div>'
        ].join('\n');
        try { this.container.innerHTML = html; } catch (_e) { /* 宿主容器不可用：不抛 */ }
        this._bind();
    }
    /** 归因卡：读不到时**先说读不到**（五态分开），不与「世界是空的」同形 */
    _reasonCard(face) {
        const tone = face.reason === 'ready' ? 'ok' : (face.reason === 'empty' ? 'warn' : 'off');
        const hint = {
            'ready': '剧情线由记忆插件的大纲与世界推进面提供（只读）。',
            'empty': '这个会话还没有大纲或世界推进记录——剧情推进后会自动长出来。',
            'no-plot-face': '记忆插件在，但这一版快照没有大纲/世界推进面：需要插件较新版本。',
            'no-snapshot': '桥已装好，但还没有产出过快照：等一次生成（或先聊一楼）即可。',
            'bridge-absent': '未检测到 LonSha 记忆插件；装上后本页自动可用。'
        }[face.reason] || '未知归因（如实显示原值，不吞）';
        return [
            '<div class="pn-card pn-reason pn-reason-' + tone + '">',
            '  <div class="pn-reason-head">' + this._esc(face.text || face.reason) + '</div>',
            '  <div class="pn-reason-hint">' + this._esc(hint) + '</div>',
            '</div>'
        ].join('\n');
    }
    /** 来源卡（[v3.0.1]）：把「这份读数是哪一次的」贴出来（投影契约的归属面）。
     *  与归因卡分工：归因卡说「读不读得到」（五态），本卡说「读到的那份是谁的」；
     *  两者可同时成立（例如「大纲面读到了，但那份读数已过期 / 未绑定会话」）。 */
    _sourceCard(src) {
        if (!src) return '';
        const tone = src.usable === true ? (src.stale === true ? 'warn' : 'ok') : 'off';
        return [
            '<div class="pn-card pn-src pn-src-' + tone + '">',
            '  <div class="pn-card-title">数据来源</div>',
            '  <div class="pn-src-line">' + this._esc(src.line) + '</div>',
            '</div>'
        ].join('\n');
    }
    _stageCard(face, stage) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有大纲（记忆插件会随剧情建立阶段）' : '读不到大纲') + '</div>';
        } else if (!stage.hasStage) {
            body = '<div class="pn-empty">大纲面在，但还没有当前阶段</div>';
        } else {
            body = [
                '<div class="pn-stage">',
                '  <div class="pn-stage-title">' + this._esc(stage.title || '未命名阶段') + '</div>',
                (stage.goal ? '  <div class="pn-stage-goal">目标：' + this._esc(stage.goal) + '</div>' : ''),
                (stage.tempo ? '  <div class="pn-stage-tempo">节奏：' + this._esc(stage.tempo) + '</div>' : ''),
                (stage.nodes.length ? '  <div class="pn-nodes">' + stage.nodes.map((n, i) => [
                    '  <div class="pn-node">',
                    '    <span class="pn-node-n">' + (i + 1) + '</span>',
                    '    <div class="pn-node-body"><div class="pn-node-title">' + this._esc(n.title || '节点') + '</div>'
                    + (n.goal ? '<div class="pn-node-goal">' + this._esc(n.goal) + '</div>' : '') + '</div>',
                    '  </div>'
                ].join('\n')).join('\n') + '</div>' : ''),
                '</div>'
            ].filter(Boolean).join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">当前大纲</div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _promiseCard(face, promises) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有承诺记录' : '读不到承诺') + '</div>';
        } else if (!promises.length) {
            body = '<div class="pn-empty">还没有承诺记录（角色做出约定后会自动入账）</div>';
        } else {
            const open = promises.filter((p) => p.status === 'open').length;
            body = '<div class="pn-sub">未兑现 ' + open + ' / 共 ' + promises.length + '</div>' + promises.map((p) => [
                '<div class="pn-item pn-item-' + (p.status === 'open' ? 'open' : (p.status === 'done' ? 'done' : 'other')) + '">',
                '  <div class="pn-item-main">' + (p.character ? '<span class="pn-item-who">' + this._esc(p.character) + '</span>' : '') + '<span class="pn-item-text">' + this._esc(p.content) + '</span></div>',
                '  <div class="pn-item-meta">' + this._statusLabel(PROMISE_STATUS, p.status) + (p.deadline ? ' · ' + this._esc(p.deadline) : '') + '</div>',
                '</div>'
            ].join('\n')).join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">承诺账<span class="pn-count">' + (ready ? promises.length + ' 条' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _arcCard(face, arcs) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有支线记录' : '读不到支线') + '</div>';
        } else if (!arcs.length) {
            body = '<div class="pn-empty">还没有支线记录</div>';
        } else {
            body = arcs.map((a) => [
                '<div class="pn-item pn-item-' + (a.status === 'active' ? 'active' : (a.status === 'closed' ? 'done' : 'other')) + '">',
                '  <div class="pn-item-main"><span class="pn-item-text">' + this._esc(a.title || '支线') + '</span></div>',
                (a.clue ? '  <div class="pn-item-clue">线索：' + this._esc(a.clue) + '</div>' : ''),
                '  <div class="pn-item-meta">' + this._statusLabel(ARC_STATUS, a.status) + '</div>',
                '</div>'
            ].join('\n')).join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">支线<span class="pn-count">' + (ready ? arcs.length + ' 条' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    _knowledgeCard(face, knowledge, boundaries) {
        const ready = face.reason === 'ready';
        const bmap = new Map((Array.isArray(boundaries) ? boundaries : []).map((b) => [b.character, b]));
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有认知记录' : '读不到认知') + '</div>';
        } else if (!knowledge.length) {
            body = '<div class="pn-empty">还没有角色认知记录</div>';
        } else {
            body = knowledge.map((k) => {
                /* [v3.10.0 · G-3] 边界格：账里**一条认知记录都没有**的角色，
                 *   与「有记录但没有本条事实」的角色必须长得不一样。
                 *   前者显示「账里未记录」——那是**无从分辨**，不是「他不知道」。 */
                const b = bmap.get(k.character);
                const unrecorded = b && b.boundary === 'unrecorded';
                return [
                    '<div class="pn-know">',
                    '  <div class="pn-know-name">' + this._esc(k.character) + '</div>',
                    (unrecorded ? '  <div class="pn-know-line"><span class="pn-know-tag other">账里未记录</span> 这位角色在认知账里没有任何记录 —— 不是「他不知道」，是「无从分辨」</div>' : ''),
                    (k.known.length ? '  <div class="pn-know-line"><span class="pn-know-tag ok">已知</span> ' + this._esc(k.known.join('；')) + '</div>' : ''),
                    (k.unaware.length ? '  <div class="pn-know-line"><span class="pn-know-tag blind">未意识到</span> ' + this._esc(k.unaware.join('；')) + '</div>' : ''),
                    (b && b.recorded && !k.unaware.length ? '  <div class="pn-know-line"><span class="pn-know-tag other">未记录不知情</span> 账里没有本条不知情记录，不等于他知道</div>' : ''),
                    '</div>'
                ].join('\n');
            }).join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">角色认知<span class="pn-count">' + (ready ? knowledge.length + ' 位' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    /**
     * [v2.86] 平行事实卡：别处正在发生的事。
     * overheard（已传开）显事实；hidden（暗线）**只显地点+标题，不显事实正文**——
     * 这张卡是玩家可见面，暗线事实直接摆出来等于剧透。
     */
    _parallelCard(face, parallels) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有平行事件' : '读不到平行事件') + '</div>';
        } else if (!parallels.length) {
            body = '<div class="pn-empty">别处暂时风平浪静</div>';
        } else {
            body = parallels.map((p) => {
                if (p.audience === 'overheard') {
                    return '<div class="pn-parallel"><span class="pn-know-tag ok">已传开</span> '
                        + this._esc(p.title) + '（' + this._esc(p.place) + '）：' + this._esc(p.fact) + '</div>';
                }
                return '<div class="pn-parallel"><span class="pn-know-tag blind">暗线</span> '
                    + this._esc(p.title) + '（' + this._esc(p.place) + '）</div>';
            }).join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">别处正在发生<span class="pn-count">' + (ready ? parallels.length + ' 件' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    /**
     * [v2.86] 秘密卡：**只显持有者与推进度，绝不显秘密内容**（内容只进生成侧 promptBlock）。
     */
    _secretCard(face, secrets) {
        const ready = face.reason === 'ready';
        const open = secrets.filter((x) => x.status === 'sealed' || x.status === 'advancing');
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有秘密' : '读不到秘密') + '</div>';
        } else if (!open.length) {
            body = '<div class="pn-empty">暂无未揭露的秘密</div>';
        } else {
            body = open.map((x) => '<div class="pn-secret"><span class="pn-know-tag blind">未揭露</span> '
                + this._esc(x.keeper) + ' 守着（进度 ' + x.progress + '%）</div>').join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">秘密<span class="pn-count">' + (ready ? open.length + ' 桩' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    /**
     * [v2.87] 回声卡：前文回扣候选 + 角色生活回声（合并一张卡）。
     * 回扣候选显 detail/kind/floor（回扣本身就是玩家应看到的「旧细节新意义」）；
     * 生活回声只显角色与模式（fields/os 氛围本体只进生成侧）。
     */
    _echoCard(face, recallEchoes, echoLives) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有回扣与回声' : '读不到回扣与回声') + '</div>';
        } else if (!recallEchoes.length && !echoLives.length) {
            body = '<div class="pn-empty">暂无回扣候选与生活回声</div>';
        } else {
            const echoLines = recallEchoes.slice(0, 3).map((e) => {
                const kindTag = { clue: '线索', item: '物品', behavior: '行为', quote: '原话' }[e.kind] || '细节';
                return '<div class="pn-echo"><span class="pn-know-tag ok">可回扣</span> '
                    + '〔' + this._esc(kindTag) + '〕' + this._esc(e.detail)
                    + (e.floor != null ? '（第' + e.floor + '楼）' : '') + '</div>';
            });
            const lifeLines = echoLives.slice(0, 3).map((x) => {
                const modeTag = {
                    askbox: '提问箱', pocket: '口袋小物', fridge: '冰箱留言', parcel: '快递包裹',
                    draft: '未发草稿', science: '乱科普', clip: '迷情剪辑', tabloid: '谣言小报',
                    scene: '名场面回放', misunderstand: '今日误会', trash: '垃圾桶残留'
                }[x.mode] || x.mode;
                return '<div class="pn-echo"><span class="pn-know-tag blind">回声</span> '
                    + this._esc(x.char) + '：' + this._esc(modeTag) + '</div>';
            });
            body = echoLines.concat(lifeLines).join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">前文回声<span class="pn-count">' + (ready ? (recallEchoes.length + echoLives.length) + ' 条' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    /**
     * [v4.38.0 · R5-X2] 目标树（纯计划模式）。
     *
     * 【这一面治的欠债】手机侧已有「线索与未完事项板」，它能列**账里有什么**，
     *   但没有任何一格能表达**用户自己的目标与前置条件**。于是用户想把
     *   「搬家」拆成「签约 → 取钥匙 → 搬东西」时只能在聊天里自己记。
     *
     * 【两条纪律】
     *   ① **勾选只表达计划**：那一句由契约件一处判（`planVsFact`），视图不自己拼 ——
     *      自己拼就会把「你勾了」与「这件事发生了」压成同一句，而那正是本项要治的。
     *   ② **受阻与缺数据分形**：前置没完成 ⇒ 「先做那一件」；前置没记过 ⇒
     *      「判不了顺序」。两句话都由契约件出，本卡只排版。
     */
    _goalCard() {
        const read = (fn, dft) => { try { return fn() ?? dft; } catch (_e) { return dft; } };
        const name = String(this._goalName || '');
        const pack = name ? read(() => this.app.goalPack?.(name), null) : null;
        const one = (pack && pack.one) || null;
        const planCount = Number((pack && pack.planCount) || 0);
        const self = (pack && pack.self) || { problems: [] };
        const rows = (one && Array.isArray(one.rows)) ? one.rows : [];
        const rowHtml = rows.length
            ? rows.map((r) => '<div class="pn-goal-row" style="--depth:' + String(r.depth || 1) + '">' +
                this._esc(String((r && r.line) || '')) + '</div>').join('')
            : '<span class="pn-hint">' + (name ? '这一条还没有展开的行' : '先写一个目标名') + '</span>';
        const body = one
            ? '    <div class="pn-goal-face">' + this._esc(String(one.gate || '')) + '</div>' +
              '    <div class="pn-goal-pv">' + this._esc(String(one.planVsFact || '')) + '</div>'
            : '    <div class="pn-goal-face">目标树：先在上面写一个目标（例如「搬家」）</div>' +
              '    <div class="pn-goal-pv">判不了（还没有选中的目标）</div>';
        const selfWarn = (Array.isArray(self.problems) && self.problems.length)
            ? '<div class="pn-goal-selfwarn">自检有问题：' + this._esc(self.problems.join(' | ')) + '</div>'
            : '';
        return [
            '  <div class="pn-card pn-goal-card">',
            '  <div class="pn-card-title">目标树（计划）<span class="pn-count">' + planCount + ' 条已勾</span></div>',
            '  <div class="pn-goal-input"><input id="pn-goal-name" placeholder="例如：搬家 / 签约" value="' + this._esc(name) + '" /><button id="pn-goal-look">看这一条</button></div>',
            '  <div class="pn-hint">勾选只表达**你的计划**；事实达成要由证据/确认产生（两件事分开记）。</div>',
            body,
            '  <div class="pn-goal-rows"><div class="pn-goal-rows-title">展开（最多三层）</div>' + rowHtml + '</div>',
            '  <div class="pn-goal-actions">',
            '    <button id="pn-goal-done" class="pn-goal-mini">在计划里勾上</button>',
            '    <button id="pn-goal-undo" class="pn-goal-mini">取消勾选</button>',
            '  </div>',
            selfWarn,
            '  <div id="pn-goal-note" class="pn-goal-note">' + (this._goalNote ? '<span class="pn-goal-note-text">' + this._esc(String(this._goalNote)) + '</span>' : '') + '</div>',
            '  </div>'
        ].join('\n');
    }
    /** 看一条目标（只转交取数，不改任何状态）。 */
    _goalLookup() {
        const el = this.container.querySelector('#pn-goal-name');
        const v = String(el?.value || '').trim();
        this._goalName = v;
        this._goalNote = v ? '' : '先写一个目标名（空名读不出树）';
        this._paintGoal();
    }
    /** 勾 / 取消勾（**只在本机**；控制器负责说清「只是计划」）。 */
    _goalToggle(done) {
        const el = this.container.querySelector('#pn-goal-name');
        const name = String(this._goalName || el?.value || '').trim();
        if (!name) { this._goalNote = '先写一个目标名'; this._paintGoal(); return; }
        this._goalName = name;
        let res = null;
        try { res = this.app.goalPlanToggle?.(name, done) || null; } catch (_e) { res = null; }
        if (!res) { this._goalNote = '计划口读不出：本版 App 未接线（不是「勾上了」）'; this._paintGoal(); return; }
        this._goalNote = String(res.note || '');
        this._paintGoal();
    }
    /** 目标树整块重画（面 / 计划对事实 / 展开 / 勾数 / 回话一并）。
     *   ★ 不新建 `document.createElement`：本仓视图只操作**自己的容器**
     *   （`document` 在 TH 沙箱与测试里都可能不可用，且视图直摸 document 是既有纪律外的事）。
     *   做法：把整块 HTML 作为字符串塞进一个临时容器元素的 innerHTML，再取首元素替换。 */
    _paintGoal() {
        const host = this.container.querySelector('.pn-goal-card');
        if (!host || !host.parentNode) return;
        const box = this.container.ownerDocument?.createElement?.('div') || null;
        if (!box) { host.innerHTML = this._goalCardInner(); return; }
        box.innerHTML = this._goalCard();
        const next = box.firstElementChild;
        if (next) host.parentNode.replaceChild(next, host);
    }
    /** 目标卡**内层**（没有外层 `.pn-goal-card` 时用于原地重画）。 */
    _goalCardInner() {
        const full = this._goalCard();
        const i = full.indexOf('>');
        const j = full.lastIndexOf('</div>');
        return (i >= 0 && j > i) ? full.slice(i + 1, j) : full;
    }

    /**
     * [v4.27.0 · R4-X6] 因果线索与未完事项板。
     *
     * 【这一面治的欠债】上游因果面（v3.323.0）早已交付，而手机侧零消费 ⇒
     *   「未结约定 / 已解决伏笔 / 仅推测因果」在界面上**同形**（都是「一条记录」），
     *   而三者处置相反：第一条要去做、第二条不必再提、第三条**不能当事实**。
     *   本卡把三者的**区分**做成可见的（四收口逐格 + 推测边单列 + 单列文案）。
     *
     * 【三条不做】不排序不评分（不写「重要度」）；不把推测边并入已确认边；
     *   不替用户标已解决（这里**一个写口都没有**，只有读与「去哪个 App」的声明）。
     */
    _boardCard() {
        let pkg = null;
        try { pkg = this.app.boardPack(); } catch (_e) { pkg = null; }
        const b = (pkg && pkg.board) || null;
        const lines = (pkg && pkg.lines) || {};
        /* 归因优先：读不到就先说读不到（五态分开），不与「没有线索」同形。 */
        /* ★ 归因**只由内核判**（走 App 出口）：本卡不写第二份状态判定词。
         *   自己写的话，内核改名那天这些比较会静默落空 ⇒ 走进 else ⇒
         *   「插件没装」被显示成「没有线索」，而两个处置正好相反。 */
        const gate = (() => {
            try { return this.app.boardGate(b); }
            catch (_e) { return { readable: false, hint: '因果板不可读' }; }
        })();
        let body;
        if (!gate.readable) {
            body = '<div class="pn-empty">' + this._esc(gate.hint) + '</div>';
        } else {
            const closure = b.closure || {};
            /* 四收口 id 与顺序**从 App 出口读**（视图不写第二份顺序表）。 */
            const ids = (() => {
                try { return this.app.boardClosureIds(); } catch (_e) { return []; }
            })();
            const closureHtml = ids.map((key) => {
                const list = (closure[key] || []).map((id) => this._nodeLine(b, id));
                return [
                    '<div class="pn-cb-group">',
                    '  <div class="pn-cb-group-title">' + this._esc(this.app.boardClosureLabel(key))
                    + '<span class="pn-count">' + list.length + '</span></div>',
                    '  ' + (list.length ? list.join('\n') : '<div class="pn-empty">没有</div>'),
                    '</div>'
                ].join('\n');
            }).join('\n');
            const confirmed = (b.edges || []).map((e) => this._edgeLine(e, false));
            const spec = (b.speculative || []).map((e) => this._edgeLine(e, true));
            const todos = ((pkg && pkg.todos && pkg.todos.todos) || []).map((t) => this._nodeLine(b, t.id, t));
            const trace = (pkg && pkg.trace) || null;
            body = [
                '<div class="pn-cb-line">' + this._esc(lines.board || '') + '</div>',
                '<div class="pn-cb-line">' + this._esc(lines.todos || '') + '</div>',
                closureHtml,
                '<div class="pn-cb-group">',
                '  <div class="pn-cb-group-title">已确认边<span class="pn-count">' + confirmed.length + '</span></div>',
                '  ' + (confirmed.length ? confirmed.join('\n') : '<div class="pn-empty">没有</div>'),
                '</div>',
                /* ★ 推测边**永远单列**，并逐条带上「不当事实」的标记：它是本卡最重要的一格。 */
                '<div class="pn-cb-group pn-cb-spec">',
                '  <div class="pn-cb-group-title">仅推测（不当事实）<span class="pn-count">' + spec.length + '</span></div>',
                '  ' + (spec.length ? spec.join('\n') : '<div class="pn-empty">没有</div>'),
                '</div>',
                '<div class="pn-cb-group">',
                '  <div class="pn-cb-group-title">未结待办<span class="pn-count">' + todos.length + '</span></div>',
                '  ' + (todos.length ? todos.join('\n') : '<div class="pn-empty">没有</div>'),
                '</div>',
                '<div class="pn-cb-trace">' + this._esc(lines.trace || '') + '</div>',
                this._tracePathHtml(trace)
            ].join('\n');
        }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">线索与未完事项<span class="pn-count">'
            + (gate.readable && b.counts && b.counts.nodes ? b.counts.nodes + ' 个节点' : '—') + '</span></div>',
            '  ' + body,
            '</div>'
        ].join('\n');
    }
    /** 一条节点：类别 / 标签 / 收口 / 三个动作（追这条线 · 回源 · 去行动） */
    _nodeLine(b, id, alt) {
        const node = this._nodeOf(b, id) || alt || null;
        if (!node) return '';
        const kind = node.kind || '';
        const act = kind ? this.app.boardActionFor(kind) : null;
        const closure = node.closure || this._closureOf(b, id);
        return [
            '<div class="pn-cb-node">',
            '  <div class="pn-cb-node-main">'
            + (kind ? '<span class="pn-cb-kind">' + this._esc(this.app.boardKindLabel(kind)) + '</span>' : '')
            + '<span class="pn-cb-text">' + this._esc(node.label || node.id || '') + '</span>'
            + (closure ? '<span class="pn-cb-closure">' + this._esc(this.app.boardClosureLabel(closure)) + '</span>' : '')
            + '</div>',
            (node.floor != null ? '  <div class="pn-item-meta">第' + this._esc(node.floor) + '楼</div>' : ''),
            '  <div class="pn-cb-acts">',
            '    <button class="pn-cb-btn" data-pb-focus="' + this._esc(node.id) + '">追这条线</button>',
            (node.ref
                ? '    <button class="pn-cb-btn" data-pb-src="' + this._esc(node.ref) + '" data-pb-node="' + this._esc(node.id) + '">回源</button>'
                : '    <button class="pn-cb-btn" disabled title="这条没有回源凭证">无回源凭证</button>'),
            (act ? '    <button class="pn-cb-btn" data-pb-act="' + this._esc(kind) + '" data-pb-ref="' + this._esc(node.ref || '') + '">' + this._esc(act.label) + '</button>' : ''),
            '  </div>',
            '</div>'
        ].join('\n');
    }
    /** 一条边（`speculative=true` 时逐条标「不当事实」） */
    _edgeLine(e, speculative) {
        return [
            '<div class="pn-cb-edge' + (speculative ? ' pn-cb-edge-spec' : '') + '">',
            '  <span class="pn-cb-edge-from">' + this._esc(e.from) + '</span>',
            '  <span class="pn-cb-edge-arrow">→</span>',
            '  <span class="pn-cb-edge-to">' + this._esc(e.to) + '</span>',
            (speculative ? '<span class="pn-cb-warn">仅推测 · 不当事实</span>' : ''),
            (e.label ? '<span class="pn-cb-edge-label">' + this._esc(e.label) + '</span>' : ''),
            '</div>'
        ].join('\n');
    }
    /** 追溯链（「追这条线」的读数；没选起点时如实显示归因，不画一条假链） */
    _tracePathHtml(trace) {
        if (!trace) return '';
        /* ★ 「起点不在图里」这句说明**由内核给**（视图不写第二份判定词）。
         *   读不出时给空串，由内核的 ok 位决定要不要继续画链。 */
        const note = (() => {
            try { return this.app.boardTraceNote(trace); }
            catch (_e) { return ''; }
        })();
        if (note) return '<div class="pn-cb-trace-note">' + this._esc(note) + '</div>';
        if (!trace.ok) return '';
        const path = (trace.path || []).map((x) => this._esc(x)).join(' ← ');
        return [
            '<div class="pn-cb-trace-path">' + (path || '（空链）') + '</div>',
            ((trace.roots || []).length ? '<div class="pn-cb-trace-note">源头：' + this._esc((trace.roots || []).join('、')) + '</div>' : ''),
            (trace.cycles ? '<div class="pn-cb-trace-note">回环 ' + trace.cycles + ' 处（已截断，不无限展开）</div>' : '')
        ].join('\n');
    }
    _nodeOf(b, id) {
        const list = (b && b.nodes) || [];
        for (const n of list) if (n && n.id === id) return n;
        return null;
    }
    _closureOf(b, id) {
        const c = (b && b.closure) || {};
        /* 遍历顺序同样从 App 出口读（不写第二份收口序）。 */
        const keys = (() => {
            try { return this.app.boardClosureIds(); } catch (_e) { return []; }
        })();
        for (const k of keys) {
            if ((c[k] || []).indexOf(id) >= 0) return k;
        }
        return '';
    }
    _settingsCard() {
        let s = {};
        try { s = this.app.getSettings(); } catch (_e) { s = {}; }
        return [
            '<div class="pn-card">',
            '  <div class="pn-card-title">设置</div>',
            '  <div class="pn-row"><span class="pn-label">注入到生成（让正文节奏与剧情线一致）</span>',
            '    <button class="pn-switch ' + (s.injectToPrompt ? 'on' : '') + '" id="pn-inject">' + (s.injectToPrompt ? '开' : '关') + '</button></div>',
            '  <div class="pn-row"><span class="pn-label">最多注入 ' + this._esc(s.maxInject) + ' 行</span>',
            '    <input type="range" class="pn-range" id="pn-maxInject" min="1" max="20" value="' + this._esc(s.maxInject) + '"></div>',
            '</div>'
        ].join('\n');
    }
    _bind() {
        const el = this.container;
        if (!el || typeof el.querySelector !== 'function') return;
        const q = (sel) => { try { return el.querySelector(sel); } catch (_e) { return null; } };
        const win = (() => { try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; } })();
        q('#pn-home')?.addEventListener('click', () => {
            try { win.dispatchEvent(new win.CustomEvent('phone:goHome')); } catch (_e) { /* 宿主无事件：忽略 */ }
        });
        q('#pn-refresh')?.addEventListener('click', () => this._draw());
        /* [v4.38.0 · R5-X2] 目标树三处点选（**只读或本机**动作，不写任何事实）：
         *   看一条 / 在计划里勾上 / 取消勾选。 */
        q('#pn-goal-look')?.addEventListener('click', () => this._goalLookup());
        q('#pn-goal-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._goalLookup(); });
        q('#pn-goal-done')?.addEventListener('click', () => this._goalToggle(true));
        q('#pn-goal-undo')?.addEventListener('click', () => this._goalToggle(false));
        q('#pn-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#pn-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 10));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
        /* [v4.27.0 · R4-X6] 因果板的三个动作：追这条线 / 回源 / 去行动。
         *   起点是**用户显式点选**（不默认挑一条）；回源把上游给的凭证**原样**派发；
         *   行动走 App 的 boardActionFor（App 名只有内核那一份，这里不写第二份）。
         *   ★ 循环变量刻意叫 btn 而不是 el —— 外层 const el 是容器，
         *     同名遮蔽会让整段循环头落进 TDZ（本仓 v4.26.0 真踩过：绑定永不生效且不报错）。 */
        const all = (sel) => {
            try { return (el && el.querySelectorAll) ? Array.from(el.querySelectorAll(sel)) : []; }
            catch (_e) { return []; }
        };
        for (const btn of all('[data-pb-focus]')) {
            btn.addEventListener('click', () => {
                try { this.app.setBoardFocus(btn.getAttribute('data-pb-focus') || ''); } catch (_e) { /* 忽略 */ }
                this._draw();
            });
        }
        for (const btn of all('[data-pb-src]')) {
            btn.addEventListener('click', () => {
                const ref = btn.getAttribute('data-pb-src') || '';
                const id = btn.getAttribute('data-pb-node') || '';
                if (!ref) { win.toastr?.warn('这条没有回源凭证', '剧情线'); return; }
                try { win.dispatchEvent(new win.CustomEvent('phone:causalSource', { detail: { ref, id } })); }
                catch (_e) { win.toastr?.info('回源凭证：' + ref, '剧情线'); }
            });
        }
        for (const btn of all('[data-pb-act]')) {
            btn.addEventListener('click', () => {
                const act = (() => {
                    try { return this.app.boardActionFor(btn.getAttribute('data-pb-act') || ''); }
                    catch (_e) { return null; }
                })();
                /* 未知类别**不猜去处**：如实说这条线没有可去的 App（不硬投到某个页面）。 */
                if (!act) { win.toastr?.warn('这条线没有可去的页面', '剧情线'); return; }
                try {
                    win.dispatchEvent(new win.CustomEvent('phone:openApp', {
                        detail: { appId: act.app, ref: { kind: 'causal', ref: btn.getAttribute('data-pb-ref') || '' } }
                    }));
                } catch (_e) { win.toastr?.error('打开 ' + act.app + ' 失败', '剧情线'); }
            });
        }
    }
}
