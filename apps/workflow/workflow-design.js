/* ========================================================
 * workflow-design.js -- [v4.04.0 . R3-X7] 可视化个人流程编排 . 设计段(排 / 存)
 * 内核是 config/workflow-designer.js(归一 / 拖排 / 条件 / 参数 / 组数 / 合成 / 读数);
 * 本件只做两件事:把用户在这台机器上点出来的东西攒成一份**草稿**,以及用户点头后把草稿交给咽喉。
 *
 * 【本件刻意不做的事】
 *   . **不执行任何脚本**:草稿是数据,能挑的动作只有 WD_ACTIONS 五条 -- 没有脚本框、没有自定义步骤;
 *   . **不写存储**:保存 / 改名 / 删一律转咽喉 `applyWorkflowDesignAction`(唯一写入口);本层零 storage 调用;
 *   . **不重判能不能跑**:合成出来的流程照样过运行器同一套判定(owner / 写步可写 / 上限 / dry-run / 幂等 / 跨段);
 *   . **不在本件判上限**:模板上限 / 步骤上限 / 参数上限 / 组数上限全走内核常量,本件不另写一份数字。
 * ========================================================= */
'use strict';
import {
    WD_ACTIONS, WD_ACTION_KEYS, WD_LIMITS, WD_DEFAULT_NAME,
    moveStep, bindParams, setBranch, setRepeat,
    composeFlow, templateLine,
} from '../../config/workflow-designer.js';

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const QUOTE = String.fromCharCode(34);
const QUOTE_ESC = AMP + 'quot;';

function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .split(AMP).join(AMP + 'amp;')
        .split(LT).join(AMP + 'lt;')
        .split(GT).join(AMP + 'gt;')
        .split(QUOTE).join(QUOTE_ESC);
}

function emptyDraft() {
    return { id: '', name: WD_DEFAULT_NAME, steps: [] };
}
function cloneDraft(d) {
    try { return JSON.parse(JSON.stringify(d)); } catch (_e) { return emptyDraft(); }
}

export class WorkflowDesign {
    constructor(app) {
        this.app = app || null;
        this._draft = emptyDraft();
        this._flash = '';
        this._flashBad = false;
        this._open = false;
    }
    /* ---------- 读数(只读;本件零 storage 调用) ---------- */
    /** 咽喉的设计读数口(动作清单 / 上限 / 已存模板 / 逐条设计读数)。 */
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.workflowDesignFace === 'function') ? vp.workflowDesignFace() : null;
        } catch (_e) { return null; }
    }
    draft() { return this._draft; }
    setOpen(on) { this._open = on === true; this._rerender(); return this._open; }
    /** 换会话必须丢**实例态**:草稿是这一段里排的东西,不是全局的。 */
    reset() { this._draft = emptyDraft(); this._flash = ''; this._flashBad = false; this._rerender(); }
    _note(text, bad) { this._flash = String(text || ''); this._flashBad = bad === true; }
    _rerender() { if (this.app && typeof this.app.render === 'function') this.app.render(); }
    /* ---------- 攒草稿(用户能改的四件事:顺序 / 条件 / 参数 / 组数,+ 增删) ---------- */
    newDraft() { this._draft = emptyDraft(); this._note('', false); this._rerender(); return this._draft; }
    /** 把一条已存模板载进草稿(**拷贝**,改动不直接落盘;保存才落盘)。 */
    load(id) {
        const h = this.host();
        const rows = (h && h.templates && Array.isArray(h.templates.templates)) ? h.templates.templates : [];
        const hit = rows.find((t) => t.id === String(id || ''));
        if (!hit) { this._note('没有这条模板', true); this._rerender(); return null; }
        this._draft = cloneDraft({ id: hit.id, name: hit.name, steps: hit.steps || [] });
        this._note('已载入「' + hit.name + '」到草稿(改动只在本机,保存才落盘)', false);
        this._rerender();
        return this._draft;
    }
    add(actionKey) {
        const act = WD_ACTIONS[String(actionKey || '')] || null;
        if (!act) { this._note('这个动作不在白名单里', true); this._rerender(); return false; }
        const d = this._draft;
        if (d.steps.length >= WD_LIMITS.steps) {
            this._note('草稿步数到顶(' + String(WD_LIMITS.steps) + '),先删一步', true);
            this._rerender();
            return false;
        }
        this._draft = { id: d.id, name: d.name, steps: d.steps.concat([{ action: act.key, repeat: 1, params: {}, when: null }]) };
        this._note('已加一步:' + act.label, false);
        this._rerender();
        return true;
    }
    move(from, to) {
        const r = moveStep(this._draft, from, to);
        if (!r.ok) { this._note('这一步挪不动(' + r.why + ')', true); this._rerender(); return false; }
        this._draft = r.template;
        this._note('已挪位', false);
        this._rerender();
        return true;
    }
    drop(index) {
        const i = Number(index);
        const d = this._draft;
        if (!(i >= 0 && i < d.steps.length)) { this._note('没有这一步', true); this._rerender(); return false; }
        const steps = d.steps.slice();
        steps.splice(i, 1);
        this._draft = { id: d.id, name: d.name, steps: steps };
        this._note('已删这一步', false);
        this._rerender();
        return true;
    }
    /** 设条件 / 取消条件。**设不全即拒**:半截条件等于把用户设的闸拆掉,那比不设更贵。 */
    branch(index, state, face) {
        const st = String(state || '');
        const r = (st === 'clear') ? setBranch(this._draft, index, null) : setBranch(this._draft, index, { state: st, face: face });
        if (!r.ok) { this._note('条件没设上(' + r.why + '):要么面名 + 态都给全,要么用取消条件', true); this._rerender(); return false; }
        this._draft = r.template;
        this._note(st === 'clear' ? '已取消这一步的条件' : ('条件已设:' + (st === 'present' ? '面在场才跑' : '面不在场才跑')), false);
        this._rerender();
        return true;
    }
    params(index, obj) {
        const r = bindParams(this._draft, index, obj || {});
        if (!r.ok && r.why) {
            this._note('参数没绑上(' + r.why + '):只认这个动作声明过的键', true);
            this._rerender();
            return false;
        }
        this._draft = r.template;
        this._note('参数已绑(整体替换:上一次的值不会缠住这一次)', false);
        this._rerender();
        return true;
    }
    repeat(index, count) {
        const r = setRepeat(this._draft, index, count);
        if (!r.ok) { this._note('组数没设上(' + r.why + '):写动作一律只跑一组,越界一律拒(不夹取)', true); this._rerender(); return false; }
        this._draft = r.template;
        this._note('组数已设', false);
        this._rerender();
        return true;
    }
    renameDraft(name) {
        const d = this._draft;
        const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, WD_LIMITS.nameMax);
        this._draft = { id: d.id, name: (s || WD_DEFAULT_NAME), steps: d.steps };
        this._rerender();
        return this._draft.name;
    }
    /* ---------- 设计动作(全部转咽喉;默认 dry-run 在这里被用户那一 下点头破掉) ---------- */
    async act(kind, extra) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyWorkflowDesignAction !== 'function') {
            this._note('设计入口不在位(咽喉未就绪)', true); this._rerender();
            return { ok: false, note: this._flash, reason: 'no-host' };
        }
        const h = this.host();
        const scope = h ? h.scope : null;
        const token = h ? h.token : null;
        let r;
        try {
            r = await vp.applyWorkflowDesignAction(Object.assign({ action: kind, scope: scope, token: token, confirm: true }, extra || {}));
        } catch (e) { r = { ok: false, note: '设计动作失败:' + String((e && e.message) || e) }; }
        const now = this.host();
        const same = !!now && now.token === token && JSON.stringify(now.scope) === JSON.stringify(scope);
        if (same) { this._note((r && r.note) || '', !(r && r.ok === true)); this._rerender(); }
        return r;
    }
    async saveDraft() {
        const d = this._draft;
        if (!d.steps.length) { this._note('草稿一步都没有,先加一步', true); this._rerender(); return { ok: false, note: this._flash }; }
        const r = await this.act('save', { id: d.id, template: { id: d.id, name: d.name, steps: d.steps } });
        if (r && r.ok && r.id) this._draft = { id: r.id, name: d.name, steps: d.steps };
        return r;
    }
    removeSaved(id) { return this.act('remove', { id: String(id || '') }); }
    renameSaved(id, name) { return this.act('rename', { id: String(id || ''), name: String(name == null ? '' : name) }); }
    /* ---------- 视图模型(渲染层只吃这一份) ---------- */
    vm() {
        const h = this.host();
        const tpl = (h && h.templates) ? h.templates : { readable: false, templates: [], dropped: 0 };
        const rows = Array.isArray(tpl.templates) ? tpl.templates : [];
        const d = this._draft;
        const comp = composeFlow(d);
        const actions = (h && Array.isArray(h.actionFaces) && h.actionFaces.length)
            ? h.actionFaces
            : WD_ACTION_KEYS.map((k) => ({ key: k, label: WD_ACTIONS[k].label, hint: WD_ACTIONS[k].hint, writes: WD_ACTIONS[k].writes, params: WD_ACTIONS[k].params.slice() }));
        return {
            open: this._open, flash: this._flash, flashBad: this._flashBad,
            scopeOk: !!h,
            limits: (h && h.limits) ? h.limits : WD_LIMITS,
            actions: actions,
            templatesReadable: tpl.readable !== false,
            templatesText: (tpl.readable === false)
                ? '模板台账**读不到**(读不到不等于一条都没有 -- 读不到时一律不覆盖)'
                : ('模板台账 ' + String(rows.length) + ' 条' + (tpl.dropped ? ('(另有 ' + String(tpl.dropped) + ' 条认不出)') : '')),
            saved: rows.map((t) => ({ id: t.id, name: t.name, line: templateLine(t) })),
            designs: (h && Array.isArray(h.designs)) ? h.designs : [],
            draftLine: templateLine(d), draftId: d.id, draftName: d.name,
            draftComposable: !!comp.flow, draftProblems: comp.problems.slice(),
            draftSteps: d.steps.map((s, i) => {
                const act = WD_ACTIONS[String(s.action || '')] || null;
                return {
                    index: i, action: String(s.action || ''),
                    actionLabel: act ? act.label : '认不出的动作',
                    writes: !!(act && act.writes), repeat: (s.repeat || 1),
                    when: s.when || null,
                    whenText: s.when ? (s.when.face + (s.when.state === 'present' ? '(在场才跑)' : '(缺席才跑)')) : '无条件(总会轮到)',
                    params: Object.assign({}, s.params || {}),
                    paramKeys: act ? act.params.slice() : [],
                    faces: act ? act.in.slice() : [],
                    stepOwner: act ? act.owner : '',
                };
            }),
        };
    }
}

/* ========================================================
 * 渲染层(纯 HTML 拼装 + 事件绑定;不写存储、不执行脚本)
 * ========================================================= */
export function designHtml(vm) {
    const v = vm || {};
    let h = '<div class="wfl-box wfl-design">';
    h += '<h3>个人流程编排(只排白名单动作:顺序 / 条件 / 参数 / 组数)</h3>';
    h += '<div class="wfl-sub">没有脚本框,也没有自定义步骤 -- 能挑的动作由内核钉死;这里排出来的是**数据**,跑起来照样过同一套判定</div>';
    h += '<div class="wfl-reads">' + esc(v.templatesText || '') + ' . ' +
        (v.scopeOk ? '设计口就绪(保存需点头)' : '设计口还没取到数(咽喉那一轮尚未跑)') + '</div>';
    if (v.flash) h += '<div class="wfl-flash' + (v.flashBad ? ' wfl-flash-bad' : '') + '">' + esc(v.flash) + '</div>';
    h += '<div class="wfl-acts">';
    for (const a of (v.actions || [])) {
        h += '<button class="wfl-btn' + (a.writes ? ' wfl-btn-run' : '') + '" data-wf-add="' + esc(a.key) + '" title="' + esc(a.hint || '') + '">+' +
            esc(a.label) + (a.writes ? ' . 写' : ' . 读') + '</button>';
    }
    h += '</div>';
    if (!v.scopeOk && !(v.draftSteps || []).length) return h + '</div>';
    h += '<div class="wfl-draft">';
    h += '<div class="wfl-draft-head"><span class="wfl-step-label">草稿 . ' + esc(v.draftLine || '') + '</span>';
    h += '<button class="wfl-btn" data-wf-dnew="1">新建空草稿</button></div>';
    h += '<div class="wfl-reads">草稿可合成:' + (v.draftComposable ? '是(合成后照样过运行器同一套判定)' : '否') +
        ((v.draftProblems || []).length ? (' . 待修 ' + esc(v.draftProblems.join(' / '))) : '') + '</div>';
    const steps = v.draftSteps || [];
    if (!steps.length) h += '<div class="wfl-flow-hint">草稿还是空的 -- 点上面任意动作加一步。</div>';
    for (const st of steps) {
        h += '<div class="wfl-step' + (st.writes ? ' wfl-step-write' : '') + '">';
        h += '<div class="wfl-step-head"><span class="wfl-step-label">' + String(st.index + 1) + '. ' + esc(st.actionLabel) + '</span>';
        h += '<button class="wfl-btn wfl-btn-mini" data-wf-move="' + String(st.index) + ':' + String(st.index - 1) + '"' + (st.index === 0 ? ' disabled' : '') + '>上移</button>';
        h += '<button class="wfl-btn wfl-btn-mini" data-wf-move="' + String(st.index) + ':' + String(st.index + 1) + '"' + (st.index === steps.length - 1 ? ' disabled' : '') + '>下移</button>';
        h += '<button class="wfl-btn wfl-btn-mini" data-wf-drop="' + String(st.index) + '">删</button></div>';
        h += '<div class="wfl-step-meta">owner ' + esc(st.stepOwner) + ' . ' + esc(st.whenText) + (st.writes ? ' . 写动作(一律只跑一组)' : '') + '</div>';
        h += '<div class="wfl-cond">条件:';
        if (st.faces.length) {
            h += '<select class="wfl-input wfl-input-sel" data-wf-face="' + String(st.index) + '">';
            for (const f of st.faces) h += '<option value="' + esc(f) + '"' + ((st.when && st.when.face === f) ? ' selected' : '') + '>' + esc(f) + '</option>';
            h += '</select>';
            h += '<button class="wfl-btn wfl-btn-mini" data-wf-when="' + String(st.index) + ':present">在场才跑</button>';
            h += '<button class="wfl-btn wfl-btn-mini" data-wf-when="' + String(st.index) + ':absent">缺席才跑</button>';
            h += '<button class="wfl-btn wfl-btn-mini" data-wf-when="' + String(st.index) + ':clear">取消条件</button>';
        } else {
            h += '<span class="wfl-flow-hint">这一步没有输入面,设不了条件</span>';
        }
        h += '</div>';
        if (st.paramKeys.length) {
            h += '<div class="wfl-params">参数:';
            for (const k of st.paramKeys) {
                h += '<span class="wfl-pkey">' + esc(k) + '</span>';
                h += '<input class="wfl-input" data-wf-param="' + String(st.index) + ':' + esc(k) + '" value="' + esc(st.params[k] || '') + '" placeholder="可留空" />';
            }
            h += '</div>';
        }
        if (!st.writes) {
            h += '<div class="wfl-repeat">组数:<input class="wfl-input wfl-input-num" data-wf-repeat="' + String(st.index) + '" value="' + String(st.repeat) + '" />';
            h += '<span class="wfl-flow-hint">(只读步可重复,上限 ' + String((v.limits || {}).repeat || 0) + ')</span></div>';
        }
        h += '</div>';
    }
    h += '<div class="wfl-save">';
    h += '<input class="wfl-input wfl-input-name" data-wf-name="1" value="' + esc(v.draftName || '') + '" placeholder="模板名" />';
    h += '<button class="wfl-btn wfl-btn-run" data-wf-save="1">确认保存到本机</button>';
    h += '</div>';
    const saved = v.saved || [];
    h += '<div class="wfl-saved"><div class="wfl-step-label">已存模板(' + String(saved.length) + ' / 上限 ' + String((v.limits || {}).templates || 0) + ')</div>';
    if (!saved.length) h += '<div class="wfl-flow-hint">还没有存过模板。</div>';
    for (const s of saved) {
        h += '<div class="wfl-saved-row"><span class="wfl-row-k">' + esc(s.line) + '</span>';
        h += '<button class="wfl-btn wfl-btn-mini" data-wf-load="' + esc(s.id) + '">载入</button>';
        h += '<input class="wfl-input wfl-input-name" data-wf-rname="' + esc(s.id) + '" value="' + esc(s.name) + '" />';
        h += '<button class="wfl-btn wfl-btn-mini" data-wf-rrename="' + esc(s.id) + '">改名</button>';
        h += '<button class="wfl-btn wfl-btn-mini" data-wf-remove="' + esc(s.id) + '">删</button>';
        h += '</div>';
    }
    h += '</div>';
    const designs = v.designs || [];
    if (designs.length) {
        h += '<div class="wfl-designs"><div class="wfl-step-label">设计读数(逐条模板:步 / 展开 / 写 / 条件)</div>';
        for (const d of designs) {
            h += '<div class="wfl-row"><span class="wfl-row-k">' + esc(d.name) + '</span><span class="wfl-row-v">' + esc(d.line) +
                ((d.problems || []).length ? (' . 待修 ' + esc(d.problems.join(' / '))) : '') + '</span></div>';
        }
        h += '</div>';
    }
    return h + '</div></div>';
}

/** 事件绑定:每一个按钮都只调设计段的方法,设计段再转咽喉。 */
export function bindDesign(el, design) {
    if (!el || !design) return;
    const on = function (sel, ev, fn) {
        el.querySelectorAll(sel).forEach(function (n) { n.addEventListener(ev, function () { fn(n); }); });
    };
    on('[data-wf-add]', 'click', function (n) { design.add(n.getAttribute('data-wf-add')); });
    on('[data-wf-dnew]', 'click', function () { design.newDraft(); });
    on('[data-wf-move]', 'click', function (n) {
        const p = String(n.getAttribute('data-wf-move')).split(':');
        design.move(Number(p[0]), Number(p[1]));
    });
    on('[data-wf-drop]', 'click', function (n) { design.drop(Number(n.getAttribute('data-wf-drop'))); });
    on('[data-wf-when]', 'click', function (n) {
        const p = String(n.getAttribute('data-wf-when')).split(':');
        const box = el.querySelector('[data-wf-face="' + p[0] + '"]');
        design.branch(Number(p[0]), p[1], box ? String(box.value || '') : '');
    });
    on('[data-wf-param]', 'change', function (n) {
        const p = String(n.getAttribute('data-wf-param')).split(':');
        const i = Number(p[0]);
        const obj = {};
        el.querySelectorAll('[data-wf-param^="' + String(i) + ':"]').forEach(function (m) {
            const parts = String(m.getAttribute('data-wf-param')).split(':');
            obj[parts.slice(1).join(':')] = String(m.value || '');
        });
        design.params(i, obj);
    });
    on('[data-wf-repeat]', 'change', function (n) { design.repeat(Number(n.getAttribute('data-wf-repeat')), Number(String(n.value || '1'))); });
    on('[data-wf-name]', 'input', function (n) { design.renameDraft(n.value); });
    on('[data-wf-save]', 'click', function () { design.saveDraft(); });
    on('[data-wf-load]', 'click', function (n) { design.load(n.getAttribute('data-wf-load')); });
    on('[data-wf-remove]', 'click', function (n) { design.removeSaved(n.getAttribute('data-wf-remove')); });
    on('[data-wf-rrename]', 'click', function (n) {
        const id = String(n.getAttribute('data-wf-rrename'));
        const box = el.querySelector('[data-wf-rname="' + id + '"]');
        design.renameSaved(id, box ? box.value : '');
    });
}
