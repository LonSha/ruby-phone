/* ========================================================
 * object-picker.js — [v4.20.0 · 第四期 R4-O8] 流程编排的对象选择器 · 纯内核
 *
 * 【这一层解决的真缺口】
 *   流程编排已经能排顺序 / 设条件 / 绑参数 / 存模板,但界面把**内部键名**直接摊给用户:
 *   参数那一行写的是 note / title,条件下拉写的是 resume-face / settlement-draft。
 *   用户看得见的是机器话,于是「会替谁做什么」得靠猜。本层只补这一半:
 *   **给既有参数与既有输入面配上中文名、控件类型、候选对象与一句人话预览** ——
 *   动作表一条不加(加动作表来掩盖难用正是计划 R4-O8 明写不做的事)。
 *
 * 【四件产物】
 *   · 参数读数 stepParamsOf:每个键一行(中文名 / 现值 / 态 / 一句提示),表外键如实标出;
 *   · 输入面读数 opFaceOptions:resume-face 这类内部面名换成「续玩读数」;
 *   · 候选归一 normalizeOptions:候选来自宿主读数(已存模板等),去重去空,读不到与没有分开;
 *   · 会替谁做什么 flowPreviewOf:逐步骤一句人话,带条件与已填参数。
 *
 * 【四态互不同形(本仓最贵的老账)】
 *   filled              有值 —— 显示「已填:…」
 *   empty               没填且这个键本来就可留空 —— 显示「可留空」,不当缺陷
 *   candidates-missing  这个键声明了候选来源,但**候选读不到** ——
 *                       读不到 ≠ 一个都没有;这一态是提示,不是错,也不拦着用户手填
 *   unknown-key         草稿里出现了这个动作不承认的键 —— 明确要求重新选择(防御态)
 *
 * 【本层零副作用】不碰 DOM、不读 storage、不看时钟、不调 owner —— 与 workflow-designer 同分工,
 * 纯 ESM export,保证可在 node 里直接测。
 * ========================================================= */
'use strict';

import { WD_ACTIONS } from './workflow-designer.js';


/** 参数现值与候选标签的显示上限(超了截断,不换行塞爆那一行)。 */
export const OP_TEXT_MAX = 60;

/** 四种参数态(互不同形,不许压平)。 */
export const OP_PARAM_STATES = Object.freeze({
    filled: 'filled',
    empty: 'empty',
    candidatesMissing: 'candidates-missing',
    unknownKey: 'unknown-key',
});

/**
 * 输入面(condition 的 face)中文名。
 * 面名是 config/workflow.js 与 WD_ACTIONS 里的内部键,**不许在本表之外再造面**。
 */
export const OP_FACES = Object.freeze({
    'resume-face': '续玩读数',
    'brief': '续玩摘要',
    'settlement-draft': '结算草稿',
    'draft': '存档草稿',
    'notice': '系统通知',
    'ledger': '账本',
    'memo': '日历备忘',
});

/**
 * 参数登记表:动作键:参数键 → 中文名 / 控件 / 候选来源 / 一句提示。
 * 只有 WD_ACTIONS 声明过的键才会被查到;**表里没有的键不许顺手加**(加了就是幻影参数)。
 */
export const OP_PARAMS = Object.freeze({
    'save-draft:note': Object.freeze({
        label: '草稿备注', control: 'text', from: '',
        hint: '写进存档台草稿格的那句备注;留空就只存摘要',
    }),
    'notify:title': Object.freeze({
        label: '提醒标题', control: 'pick', from: 'templates',
        hint: '这条通知的标题;可以从已存模板名里点一个,也可以自己填;留空用默认标题',
    }),
    'add-memo:title': Object.freeze({
        label: '备忘标题', control: 'pick', from: 'templates',
        hint: '日历上这条备忘的标题;可以从已存模板名里点一个,也可以自己填;留空用动作名',
    }),
});

/** 只给键、不分动作时的兜底名(同一键在两个动作里叫法一致时用)。 */
const OP_PARAM_LABELS = Object.freeze({
    note: '备注',
    title: '标题',
});

/** 认不出的东西如实说认不出(不悄悄显示空,也不猜一个很像的名字)。 */
export const OP_UNKNOWN_LABEL = '认不出的参数';

/* ------ 小工具(零依赖,不新造轮子) ------ */
function opObj(v) {
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}
function opStr(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}
function opArr(v) {
    return Array.isArray(v) ? v : null;
}

/* --------- 1 中文名 --------- */
/**
 * 输入面中文名。认不出的面**原样回显并标认不出**,不猜(猜错比露键名更贵:
 * 用户会以为条件设在 A 上,实际设在 B 上)。
 */
export function opFaceLabel(face) {
    const k = opStr(face, 40);
    if (!k) return '未指定';
    const hit = OP_FACES[k];
    return hit ? hit : (k + '(认不出这个面)');
}

/**
 * 输入面候选(给条件下拉用)。faces 不是数组 ⇒ readable:false(读不到,不是没有)。
 * 返回 { readable, options:[{value,label}] } —— value 仍是内部键(绑定与判定都要它),
 * label 是给人看的中文名。
 */
export function opFaceOptions(faces) {
    const list = opArr(faces);
    if (!list) return { readable: false, options: [] };
    return {
        readable: true,
        options: normalizeOptions(list.map((f) => ({ value: f, label: opFaceLabel(f) }))) || [],
    };
}

/**
 * 参数中文名 / 控件 / 候选来源。先按「动作键:参数键」查,再按裸键兜底,
 * 都查不到 ⇒ known:false + 通用名(视图会把它当「要求重新选择」处理)。
 */
export function opParamMeta(actionKey, paramKey) {
    const a = opStr(actionKey, 40);
    const k = opStr(paramKey, 40);
    const exact = OP_PARAMS[a + ':' + k] || null;
    if (exact) {
        return { key: k, label: exact.label, control: exact.control, from: exact.from || '', hint: exact.hint, known: true };
    }
    const bare = OP_PARAM_LABELS[k] || '';
    return {
        key: k,
        label: bare || (k ? (k + '(' + OP_UNKNOWN_LABEL + ')') : OP_UNKNOWN_LABEL),
        control: 'text', from: '',
        hint: bare ? ('这个动作声明了这个键,但没给它配中文说明') : '',
        known: !!bare,
    };
}

/* --------- 2 候选归一 --------- */
/**
 * 候选归一。**读不到 ≠ 一个都没有**:raw 不是数组 ⇒ 返回 null(读不到);
 * 是数组(哪怕空)⇒ 返回数组。去空值、去重(按 value)、标签缺省用 value、超长截断。
 * 元素可以是裸值,也可以是 {value,label}。
 */
export function normalizeOptions(raw) {
    const list = opArr(raw);
    if (!list) return null;
    const seen = Object.create(null);
    const out = [];
    for (const it of list) {
        const o = opObj(it) || { value: it };
        const value = opStr(o.value, OP_TEXT_MAX);
        if (!value) continue;
        if (seen[value]) continue;
        seen[value] = true;
        const label = opStr(o.label, OP_TEXT_MAX) || value;
        out.push({ value: value, label: label });
    }
    return out;
}

/** 候选来源 → 一句人话(视图挂在参数行旁边,说明这个下拉里的东西是从哪来的)。 */
export function opSourceLabel(from) {
    const f = opStr(from, 20);
    if (f === 'templates') return '候选来自已存模板名';
    if (!f) return '';
    return '候选来自' + f;
}

/* --------- 3 参数读数(逐键一行) --------- */
/**
 * 一步的参数读数。act 省略时按 step.action 去 WD_ACTIONS 里取。
 * 三件东西分开:
 *   · declared —— 这个动作**声明**的键(顺序按表,稳定:视图行序不会随对象键序跳);
 *   · stored   —— 草稿里真存着的值(只有非空才算填了);
 *   · extra    —— 存着但动作不认的键(防御态:明确要求重新选择)。
 * 返回 { readable, rows, missing } —— readable:false 表示**取不到这个动作的参数表**(读不到,不是没有)。
 */
export function stepParamsOf(step, act, candidates) {
    const s = opObj(step) || {};
    const a = opObj(act) || (WD_ACTIONS[opStr(s.action, 40)] || null);
    const declared = a ? opArr(a.params) : null;
    if (!declared) return { readable: false, rows: [], missing: [] };
    const stored = opObj(s.params) || {};
    const cand = opObj(candidates) || {};
    const rows = [];
    const missing = [];
    for (const k of declared) {
        const meta = opParamMeta(a.key, k);
        const value = opStr(stored[k], OP_TEXT_MAX);
        /* 单一闸口:读不到与没有都由 normalizeOptions 一句话判(非数组 ⇒ 返回 null)。
           此处若再短路一次,那道闸就成了死代码 —— 用假数组打负控制也命不中它。 */
        const options = meta.from ? normalizeOptions(cand[meta.from]) : [];
        const noCand = !!meta.from && options === null;
        let state = value ? OP_PARAM_STATES.filled : OP_PARAM_STATES.empty;
        if (noCand) {
            state = OP_PARAM_STATES.candidatesMissing;
            missing.push({ key: k, why: OP_PARAM_STATES.candidatesMissing });
        }
        rows.push({
            key: k, label: meta.label, hint: meta.hint, control: meta.control,
            from: meta.from, sourceText: opSourceLabel(meta.from),
            value: value, options: options || [], state: state,
            known: meta.known,
            line: paramStateLine({ key: k, label: meta.label, value: value, state: state }),
        });
    }
    for (const k of Object.keys(stored)) {
        if (declared.indexOf(k) >= 0) continue;
        const value = opStr(stored[k], OP_TEXT_MAX);
        if (!value) continue;   /* 空值不算残留:空着没有任何可执行的后果 */
        const row = {
            key: k, label: opParamMeta(a.key, k).label, hint: '',
            control: 'text', from: '', sourceText: '',
            value: value, options: [], state: OP_PARAM_STATES.unknownKey, known: false,
        };
        row.line = paramStateLine(row);
        rows.push(row);
        missing.push({ key: k, why: OP_PARAM_STATES.unknownKey });
    }
    return { readable: true, rows: rows, missing: missing };
}

/** 一行参数的人话。四态各说各的,不许压成一句「未填」。 */
export function paramStateLine(row) {
    const r = opObj(row) || {};
    const st = opStr(r.state, 40);
    const v = opStr(r.value, OP_TEXT_MAX);
    const name = opStr(r.label, OP_TEXT_MAX) || '这一项';
    if (st === OP_PARAM_STATES.unknownKey) {
        return '「' + name + '」已经不在这个动作的可选范围了,请重新选择(或清掉)';
    }
    if (st === OP_PARAM_STATES.candidatesMissing) {
        return '「' + name + '」的候选读不到(读不到不等于一个都没有):先手填,读数回来再挑';
    }
    if (st === OP_PARAM_STATES.filled) return '已填:「' + v + '」';
    return '可留空';
}

/* --------- 4 会替谁做什么(逐步骤预览) --------- */
/**
 * 逐步骤一句人话:这一步替**这个项目**做什么 / 条件是什么 / 参数填了什么。
 * 认不出的动作**如实说认不出**(不渲染成一句看着正常的话 —— 那会让人以为这一步能跑)。
 */
export function flowPreviewOf(template, candidates) {
    const t = opObj(template) || {};
    const steps = opArr(t.steps);
    if (!steps) return { readable: false, rows: [], text: '草稿读不到,预览先不画', writes: 0 };
    const cand = opObj(candidates) || {};
    const rows = [];
    let writes = 0;
    for (let i = 0; i < steps.length; i += 1) {
        const s = opObj(steps[i]) || {};
        const act = WD_ACTIONS[opStr(s.action, 40)] || null;
        if (!act) {
            rows.push({
                index: i, actionLabel: '认不出的动作', writes: false,
                sentence: '第' + String(i + 1) + '步:这个动作认不出,跑不起来(先删掉这一步)',
            });
            continue;
        }
        const sp = stepParamsOf(s, act, cand);
        const filled = sp.rows.filter((r) => r.state === OP_PARAM_STATES.filled);
        const bad = sp.rows.filter((r) => r.state === OP_PARAM_STATES.unknownKey);
        const when = opObj(s.when);
        let sentence = '第' + String(i + 1) + '步:会' + act.label + ' —— ' + act.hint;
        if (when) {
            sentence += ' ;只在「' + opFaceLabel(when.face) + '」' +
                (opStr(when.state, 20) === 'present' ? '在场时跑' : '缺席时跑');
        }
        if (filled.length) {
            sentence += ' ;用到的:' + filled.map((r) => r.label + '「' + r.value + '」').join(' / ');
        }
        if (bad.length) {
            sentence += ' ;有 ' + String(bad.length) + ' 项要重新选择';
        }
        const rep = Number(s.repeat);
        if (rep > 1 && !act.writes) sentence += ' ;跑 ' + String(rep) + ' 组';
        if (act.writes) writes += 1;
        rows.push({ index: i, actionLabel: act.label, writes: !!act.writes, sentence: sentence });
    }
    const text = rows.length
        ? ('这条流程会替本项目做 ' + String(rows.length) + ' 步,其中写动作 ' + String(writes) + ' 步(写步骤逐项确认后才跑)')
        : '草稿还是空的,没得预览';
    return { readable: true, rows: rows, text: text, writes: writes };
}
