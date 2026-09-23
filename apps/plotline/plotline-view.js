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
        const html = [
            '<div class="pn-root">',
            '  <header class="pn-header">',
            '    <button class="pn-nav" id="pn-home"><i class="fa-solid fa-chevron-left"></i></button>',
            '    <h2>剧情线</h2>',
            '    <button class="pn-nav" id="pn-refresh"><i class="fa-solid fa-rotate"></i></button>',
            '  </header>',
            '  <div class="pn-body">',
            this._reasonCard(face),
            this._stageCard(face, stage),
            this._promiseCard(face, promises),
            this._arcCard(face, arcs),
            this._knowledgeCard(face, knowledge),
            this._parallelCard(face, (pkg && pkg.parallels) || []),
            this._secretCard(face, (pkg && pkg.secrets) || []),
            this._echoCard(face, (pkg && pkg.recallEchoes) || [], (pkg && pkg.echoLives) || []),
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
    _knowledgeCard(face, knowledge) {
        const ready = face.reason === 'ready';
        let body;
        if (!ready) {
            body = '<div class="pn-empty">' + this._esc(face.reason === 'empty' ? '还没有认知记录' : '读不到认知') + '</div>';
        } else if (!knowledge.length) {
            body = '<div class="pn-empty">还没有角色认知记录</div>';
        } else {
            body = knowledge.map((k) => [
                '<div class="pn-know">',
                '  <div class="pn-know-name">' + this._esc(k.character) + '</div>',
                (k.known.length ? '  <div class="pn-know-line"><span class="pn-know-tag ok">已知</span> ' + this._esc(k.known.join('；')) + '</div>' : ''),
                (k.unaware.length ? '  <div class="pn-know-line"><span class="pn-know-tag blind">未意识到</span> ' + this._esc(k.unaware.join('；')) + '</div>' : ''),
                '</div>'
            ].join('\n')).join('\n');
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
        q('#pn-inject')?.addEventListener('click', () => {
            try { this.app.saveSettings({ injectToPrompt: !this.app.getSettings().injectToPrompt }); } catch (_e) {}
            this._draw();
        });
        q('#pn-maxInject')?.addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(20, Number(e?.target?.value) || 10));
            try { this.app.saveSettings({ maxInject: v }); } catch (_e) {}
            this._draw();
        });
    }
}
