/* ========================================================
 * diagdesk-data.js — [v3.47.0] 诊断案头 · 纯函数内核
 *
 * 数据层：本文件（纯函数）  落盘与接线：diagdesk-app.js  视图：diagdesk-view.js
 *
 * ── 源与立场差（素材缝合第 3 层第十一件 · 诊断与迁移三片同族）
 *   源是三台**自己动手的机器**：
 *     ① ST-MyriadKnots 的 preparation-diagnostic.js：十一步准备流水线，
 *        每一步失败都挂到**错误对象**上（WeakMap 旁路），错误名 / 错误码 /
 *        定位从堆栈里抠，失败原因是**按名字硬编的几行中文**；
 *     ② 同仓 qianshi-schema.js：六态词表（还没发生 / 进行中 / 已完成 / 已取消 /
 *        已发生 / 说不清）+ 增量四态（就绪 / 空 / 部分 / 待定），装载即校验、
 *        校验不过就抛，且「状态为空」与「状态就绪」要与条数互相成立；
 *     ③ st_bs_biotracker 的 scripts/state_migration.js：存档结构版本 1 → 2 → 3，
 *        缺栏位按「那时没有这个栏位」补默认值，**自订过的值一律不动**。
 *   本件是**案头** —— 只把这三种事**读成一张可对账的体检单**：
 *   总体判定 / 六态逐格计数 / 缺失栏位逐格列出 / 迁移逐版计划 / 流水线逐格计数 /
 *   逐处诊断 / 可复制的摘要文本（requestText）。
 *   本件**不挂错误对象、不改存档、不写宿主的任何字段**：它只回答
 *   「这份存档照上游的规矩读下来，会发生什么」。
 *
 * ── 五块不缝（源的整套动作，本件一律不接）──────────────
 *   ① 不往错误对象上挂旁路：源用 WeakMap 把步骤名挂在 Error 实例上；
 *   ② 不从堆栈里抠定位：源解析 stack 取文件 / 行 / 列；
 *   ③ 不往答案里编失败原因：源的技术细节是**按错误名硬编的几行中文**；
 *   ④ 不就地改存档：源的迁移函数直接写对象（本件只产计划，一个字段都不写）；
 *   ⑤ 不改写宿主的任何键：本件只写自己那三条会话键。
 *
 * ── 六条偏离（逐条对着源的静默失效）──────────────────
 *   ① **空不等于说不清**：源把读不出来与就是空画成同一画面；
 *   ② **说不清不等于没发生**：源把认不出的状态当还没发生落下去；
 *   ③ **缺栏位不等于 0**：源把缺栏位直接当 0 用（旧档里真 0 与没写同形）；
 *   ④ **自订值不许覆盖**：源只在仍等于旧内置值时才换（本件逐格报自订 / 内置）；
 *   ⑤ **迁移不许越版**：源逐版迁，一跳就是错（本件逐版列计划、断链即停）；
 *   ⑥ **条数与状态不许矛盾**：源在这里直接抛（本件逐格标矛盾、不抛）。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 版本栏读不出来 **不许**读成 1（另立一格「版本认不出来」）；
 *   · 状态认不出来 **不许**当还没发生（另立一格「说不清」）；
 *   · 状态为空而条数不为 0 **不许**当正常（逐格标矛盾）；
 *   · 缺栏位 **不许**读成 0（另立一格「没这个栏位」）；
 *   · 自订过的值 **不许**被迁移覆盖（另立一格「自订过」）；
 *   · 迁移链断了 **不许**静默跳版（在断点处停、逐格报为什么）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量、反斜杠与反引号：一切字符切分走 indexOf / slice；
 *   引号与尖括号一律走拼装形（String.fromCharCode）。
 * ======================================================== */
'use strict';
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const SLASH = String.fromCharCode(47);
const DASH = String.fromCharCode(45);

/* ══════════ 源清单（三片同族，本件取治理面） ══════════ */
export const DD_SOURCE_NOTE = 'ST-MyriadKnots 的准备阶段诊断片与迁识词表片、st_bs_biotracker 的存档迁移片同族';
export const DD_SOURCE_FILES = Object.freeze([
    { key: 'prep', file: 'src/v3/preparation-diagnostic.js', role: '十一步准备流水线 + 失败归因（挂错误对象 / 抠堆栈 / 硬编原因）', bytes: 3873, lines: 101 },
    { key: 'schema', file: 'src/v3/qianshi-schema.js', role: '六态词表 + 增量四态 + 装载即校验（不成立就抛）', bytes: 11389, lines: 150 },
    { key: 'migr', file: 'scripts/state_migration.js', role: '存档结构版本逐版迁移（缺栏位补默认 / 自订值不动）', bytes: 5351, lines: 128 }
]);

/* ══════════ 六态词表（键面取真源，一个不多一个不少） ══════════ */
export const DD_STATUSES = Object.freeze(['planned', 'inProgress', 'completed', 'cancelled', 'occurred', 'unknown']);
export const DD_STATUS_TEXT = Object.freeze({
    [DD_STATUSES[0]]: '还没发生',
    [DD_STATUSES[1]]: '进行中',
    [DD_STATUSES[2]]: '已完成',
    [DD_STATUSES[3]]: '已取消',
    [DD_STATUSES[4]]: '已发生',
    [DD_STATUSES[5]]: '说不清'
});
/* ══════════ 增量四态 ══════════ */
export const DD_DELTAS = Object.freeze(['ready', 'empty', 'partial', 'pending']);
export const DD_DELTA_TEXT = Object.freeze({
    [DD_DELTAS[0]]: '就绪',
    [DD_DELTAS[1]]: '空',
    [DD_DELTAS[2]]: '部分',
    [DD_DELTAS[3]]: '待定'
});
/* ══════════ 十一步准备流水线（键面取真源，顺序即真源顺序） ══════════ */
export const DD_FLOW = Object.freeze([
    'synchronizing', 'snapshotClone', 'sourceSelection', 'sourceSanitization',
    'timeSources', 'identityDirectory', 'qianshiCandidates', 'extractorEnvelope',
    'dependencySnapshot', 'rootCheck', 'extractorHandoff'
]);
export const DD_FLOW_TEXT = Object.freeze({
    synchronizing: '同步聊天',
    snapshotClone: '克隆快照',
    sourceSelection: '挑源头',
    sourceSanitization: '洗源头',
    timeSources: '时间源',
    identityDirectory: '身份册',
    qianshiCandidates: '候选条目',
    extractorEnvelope: '抽取信封',
    dependencySnapshot: '依赖快照',
    rootCheck: '根检查',
    extractorHandoff: '交棒'
});
/* ══════════ 受支持的结构版本（真源：1.0.0 到 1.0.5 缺栏位按 1 算） ══════════ */
export const DD_VERSIONS = Object.freeze([1, 2, 3]);
export const DD_VERSION_LATEST = 3;
export const DD_VERSION_TEXT = Object.freeze({
    1: '旧档（还没有结构版本这一栏）',
    2: '承载耐受与恢复期解绑后的档',
    3: '延产三栏已补的档'
});
/* ══════════ 字段类型与默认值（缺栏位补什么，逐型成一格） ══════════ */
export const DD_TYPES = Object.freeze(['string', 'number', 'boolean', 'list', 'object', 'any']);
export const DD_TYPE_TEXT = Object.freeze({
    string: '字串',
    number: '数字',
    boolean: '开关',
    list: '列表',
    object: '表',
    any: '任意'
});
export const DD_DEFAULT_TEXT = Object.freeze({
    string: '空字串',
    number: '0',
    boolean: '关',
    list: '空列表',
    object: '空表',
    any: '空'
});
/* ══════════ 栏位册（受支持的栏位、从哪版起、缺了补什么） ══════════ */
/* ★ 口径：这份体检单读的是**一份角色存档**（真源的 chat state 就是「一个角色一份「
 *   角色档案 + 角色运行时」」），不是「一张角色表里第几个角色」。
 *   故键面用中文原文（角色档案 / 角色运行时），逻辑键名（profiles / originalBio…）
 *   只在代码里用。
 */
export const DD_FIELDS = Object.freeze([
    { key: 'version', label: '结构版本', path: 'version', type: 'number', since: 1 },
    { key: 'profiles', label: '角色档案表', path: '角色档案', type: 'object', since: 1 },
    { key: 'bio', label: '生理读数表', path: '角色档案.生理读数', type: 'object', since: 1 },
    { key: 'breedTolerance', label: '承载耐受', path: '角色档案.生理读数.承载耐受', type: 'number', since: 1 },
    { key: 'recoveryDays', label: '产后恢复天数', path: '角色档案.生理读数.产后恢复天数', type: 'number', since: 1 },
    { key: 'originalBio', label: '孕期快照', path: '角色运行时.孕期快照', type: 'object', since: 1 },
    { key: 'fetuses', label: '胎数', path: '角色档案.孕期.胎数', type: 'list', since: 1 },
    { key: 'stage', label: '阶段', path: '角色档案.基础.阶段', type: 'string', since: 1 },
    { key: 'extensionCount', label: '延产次数', path: '角色档案.孕期.延产次数', type: 'number', since: 3 },
    { key: 'extensionUntilDays', label: '本次延产到期日', path: '角色档案.孕期.延产到期日', type: 'number', since: 3 },
    { key: 'uterineAtony', label: '子宫乏力级数', path: '角色档案.基础.子宫乏力级数', type: 'number', since: 3 }
]);
/* ══════════ 迁移链（逐版一步，一跳就是错） ══════════ */
export const DD_MIGRATIONS = Object.freeze([
    {
        from: 1, to: 2,
        note: '承载耐受与产后恢复天数解绑：内置值换新，自订值不动；不在产后恢复的角色按新公式重算天数',
        rules: ['tolerance', 'recoveryDays']
    },
    {
        from: 2, to: 3,
        note: '补上延产次数、本次延产到期日与子宫乏力级数三栏',
        rules: ['missingFill']
    }
]);
/* ══════════ 判定词表 ══════════ */
export const DD_VERDICTS = Object.freeze(['ok', 'warn', 'cant']);
export const DD_VERDICT_TEXT = Object.freeze({
    ok: '这一份读下来没有不合规矩的地方',
    warn: '这一份有几处要处置（逐条列在下面）',
    cant: '这一份读不完（关键几格认不出来，不敢当合格）'
});
/* ══════════ 迁移动作词表 ══════════ */
export const DD_ACTIONS = Object.freeze(['fill', 'now', 'keep', 'cant']);
export const DD_ACTION_TEXT = Object.freeze({
    fill: '补默认值',
    now: '换成新内置值',
    keep: '不动（自订过）',
    cant: '认不出来（不动）'
});
/* ══════════ 三项上限（只报不截） ══════════ */
export const DD_ROWS_MAX = 24;
export const DD_ROLES_MAX = 60;
export const DD_TEXT_MAX = 12000;
export const DD_LEDGER_MAX = 40;
export const DD_ROWS_SHOWN = 20;
export const DD_DEPTH_MAX = 12;

/* ══════════ 小工具（一切字符切分走 indexOf / slice，不写正则） ══════════ */
export function cleanText(v) {
    return (typeof v === 'string') ? v : '';
}
export function charCount(v) {
    return cleanText(v).length;
}
export function isPlain(v) {
    return (typeof v === 'object') && v !== null && !Array.isArray(v);
}
export function hasKey(o, k) {
    return isPlain(o) && Object.prototype.hasOwnProperty.call(o, k);
}
export function readPath(obj, path) {
    if (!path) return obj;
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i += 1) {
        const k = parts[i];
        if (!isPlain(cur) || !hasKey(cur, k)) return undefined;
        cur = cur[k];
    }
    return cur;
}
/** 强口径读整数：先看类型再逐位扫，空串 / null / 列表一律回 null（不塌成 0）。 */
export function intOf(v, lo, hi) {
    let s;
    if (typeof v === 'number') {
        if (!isFinite(v)) return null;
        s = String(v);
    } else if (typeof v === 'string') {
        s = v.trim();
    } else {
        return null;
    }
    if (s.length === 0) return null;
    let start = 0;
    if (s.charAt(0) === DASH) start = 1;
    if (start >= s.length) return null;
    for (let i = start; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if (c < 48 || c > 57) return null;
    }
    const n = parseInt(s, 10);
    if (!isFinite(n)) return null;
    const l = (typeof lo === 'number') ? lo : 0;
    const h = (typeof hi === 'number') ? hi : 100;
    return Math.max(l, Math.min(h, n));
}
/** 小数读法：只收有限数字（含小数），空串 / null 一律回 null。 */
export function numOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const s = v.trim();
        if (s.length === 0) return null;
        const n = Number(s);
        return isFinite(n) ? n : null;
    }
    return null;
}
/** 两值是否同值（1e-6 口径，与真源同）。 */
export function isClose(a, b) {
    const x = numOf(a);
    const y = numOf(b);
    if (x === null || y === null) return false;
    return Math.abs(x - y) < 1e-6;
}
/** 形状名（报词用，不写标识符形）。 */
export function shapeOf(v) {
    if (Array.isArray(v)) return 'list';
    if (isPlain(v)) return 'object';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'any';
}
export function shapeText(v) {
    return DD_TYPE_TEXT[shapeOf(v)] || DD_TYPE_TEXT.any;
}
/** 类型册自证：这个类型名在不在类型册里（不在就是声明写错了）。 */
export function typeInBook(type) {
    return DD_TYPES.indexOf(type) >= 0;
}
/** 默认值报词。 */
export function defaultText(type) {
    return DD_DEFAULT_TEXT[type] || DD_DEFAULT_TEXT.any;
}
/** 列表读法：不是列表一律回空列表（另由 shapeOf 报形状）。 */
export function listOf(v) {
    return Array.isArray(v) ? v : [];
}
/** 裁边：只报不截（回弹出的条数与留下的行）。 */
export function trimRows(rows, max) {
    const list = listOf(rows);
    const cap = (typeof max === 'number') ? max : DD_ROWS_MAX;
    if (list.length <= cap) return Object.freeze({ rows: list, dropped: 0, over: false });
    return Object.freeze({ rows: list.slice(0, cap), dropped: list.length - cap, over: true });
}
/** 嵌套读数（迭代式，不递归）：数到底有几层，超上限即早退。 */
export function depthOf(v) {
    let max = 0;
    const stack = [{ v: v, d: 1 }];
    while (stack.length > 0) {
        const cur = stack.pop();
        if (cur.d > max) max = cur.d;
        if (max > DD_DEPTH_MAX) return max;
        const node = cur.v;
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i += 1) stack.push({ v: node[i], d: cur.d + 1 });
        } else if (isPlain(node)) {
            const keys = Object.keys(node);
            for (let i = 0; i < keys.length; i += 1) stack.push({ v: node[keys[i]], d: cur.d + 1 });
        }
    }
    return max;
}
export function two(n) {
    const v = (typeof n === 'number' && isFinite(n)) ? n : 0;
    return v < 10 ? '0' + String(v) : String(v);
}
export function stampOf(ms) {
    const t = (typeof ms === 'number' && isFinite(ms)) ? ms : Date.now();
    const d = new Date(t);
    return String(d.getFullYear()) + DASH + two(d.getMonth() + 1) + DASH + two(d.getDate())
        + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

/* ══════════ 第一格：版本面（读不出来不许读成 1） ══════════ */
export function versionFace(archive) {
    const raw = isPlain(archive) ? archive.version : undefined;
    const present = hasKey(archive, 'version');
    const v = intOf(raw, 1, 99);
    const known = (v !== null) && DD_VERSIONS.indexOf(v) >= 0;
    let why;
    if (!present) why = '这份存档里没有结构版本这一栏（旧档：那时还没有这一栏）';
    else if (v === null) why = '结构版本这一栏读不出来（不是整数），不当作 1';
    else if (!known) why = '结构版本认不出来（读到的是 ' + String(v) + '，本件只认 1 / 2 / 3）';
    else why = '结构版本读到了第 ' + String(v) + ' 版';
    return Object.freeze({
        value: known ? v : null,
        raw: (typeof raw === 'undefined') ? null : raw,
        present: present,
        blank: !present,
        unrecognized: present && !known,
        withinRange: known,
        text: known ? DD_VERSION_TEXT[v] : '版本认不出来',
        why: why
    });
}

/* ══════════ 第二格：六态计数面（认不出的另立一格） ══════════ */
export function statusFace(list) {
    const rows = listOf(list);
    const counts = {};
    for (let i = 0; i < DD_STATUSES.length; i += 1) counts[DD_STATUSES[i]] = 0;
    let unrecognized = 0;
    let blank = 0;
    const classified = [];
    for (let i = 0; i < rows.length; i += 1) {
        const item = rows[i];
        const raw = isPlain(item) ? item.status : item;
        const name = (typeof raw === 'string' && raw.length > 0) ? raw : null;
        if (name === null) {
            blank += 1;
            counts[DD_STATUSES[5]] += 1;
            classified.push({ index: i, status: DD_STATUSES[5], known: false, why: '这一条没写状态，并入说不清（没当还没发生）' });
        } else if (DD_STATUSES.indexOf(name) >= 0) {
            if (name === DD_STATUSES[5]) unrecognized += 1;
            counts[name] += 1;
            classified.push({ index: i, status: name, known: true, why: '状态写明了：' + DD_STATUS_TEXT[name] });
        } else {
            unrecognized += 1;
            counts[DD_STATUSES[5]] += 1;
            classified.push({ index: i, status: DD_STATUSES[5], known: false, why: '状态认不出来（' + name + '），并入说不清' });
        }
    }
    const cells = [];
    for (let i = 0; i < DD_STATUSES.length; i += 1) {
        const k = DD_STATUSES[i];
        cells.push({ key: k, label: DD_STATUS_TEXT[k], count: counts[k] });
    }
    return Object.freeze({
        total: rows.length,
        cells: Object.freeze(cells),
        unrecognized: unrecognized,
        blank: blank,
        classified: Object.freeze(classified),
        shown: trimRows(classified, DD_ROWS_SHOWN)
    });
}

/* ══════════ 第三格：增量四态面（条数与状态要互相成立） ══════════ */
export function deltaFace(record) {
    const present = isPlain(record) || (typeof record === 'string');
    const raw = isPlain(record) ? record.status : record;
    const name = (typeof raw === 'string' && DD_DELTAS.indexOf(raw) >= 0) ? raw : null;
    if (!present) {
        return Object.freeze({ present: false, status: null, statusLabel: '没有这一栏', known: false,
            count: null, countKnown: false, conflict: false,
            why: '这份存档里没有增量这一栏（没有与认不出来不是一回事）' });
    }
    const events = isPlain(record) ? record.events : undefined;
    const countKnown = Array.isArray(events);
    const count = countKnown ? events.length : null;
    let conflict = false;
    let conflictWhy;
    if (name === null) {
        conflict = true;
        conflictWhy = '增量状态认不出来（不当作就绪，也不当作空）';
    } else if (!countKnown) {
        conflict = true;
        conflictWhy = '状态是' + DD_DELTA_TEXT[name] + '，但条数这一栏读不出来（不当作 0 条）';
    } else if (name === DD_DELTAS[1] && count > 0) {
        conflict = true;
        conflictWhy = '状态是空，却带着 ' + String(count) + ' 条 —— 两个读数互相不成立（真源在这里直接抛）';
    } else if (name === DD_DELTAS[0] && count === 0) {
        conflict = true;
        conflictWhy = '状态是就绪，却是 0 条 —— 两个读数互相不成立（真源在这里直接抛）';
    } else if (name === DD_DELTAS[3] && count > 0) {
        conflict = true;
        conflictWhy = '状态是待定，却带着 ' + String(count) + ' 条 —— 待定不该有已认下的条';
    } else if (name === DD_DELTAS[2] && count === 0) {
        conflict = true;
        conflictWhy = '状态是部分，却是 0 条 —— 部分该有认下的条';
    } else {
        conflictWhy = '状态与条数互相成立';
    }
    return Object.freeze({
        present: true,
        status: name,
        statusLabel: name === null ? '认不出来' : DD_DELTA_TEXT[name],
        known: name !== null,
        count: count,
        countKnown: countKnown,
        conflict: conflict,
        why: conflictWhy
    });
}

/* ══════════ 第四格：十一步流水线面（逐格计数，不合成一句） ══════════ */
export function pipelineFace(log) {
    const rows = listOf(log);
    const cells = [];
    for (let i = 0; i < DD_FLOW.length; i += 1) {
        const step = DD_FLOW[i];
        let known = 0;
        let failed = 0;
        for (let j = 0; j < rows.length; j += 1) {
            const entry = rows[j];
            if (!isPlain(entry)) continue;
            if (entry.step !== step) continue;
            if (entry.failed === true) failed += 1;
            else known += 1;
        }
        cells.push({
            step: step,
            label: DD_FLOW_TEXT[step],
            order: i + 1,
            known: known,
            failed: failed,
            text: failed > 0
                ? ('第 ' + String(i + 1) + ' 步失败 ' + String(failed) + ' 次')
                : (known > 0 ? ('第 ' + String(i + 1) + ' 步过了 ' + String(known) + ' 次') : '这一步没有回执')
        });
    }
    const detail = [];
    for (let j = 0; j < rows.length; j += 1) {
        const entry = rows[j];
        if (!isPlain(entry)) continue;
        const step = (typeof entry.step === 'string' && DD_FLOW.indexOf(entry.step) >= 0) ? entry.step : null;
        let why;
        if (step === null) why = '这一步不在十一步里（本件只认真源那十一步，不硬塞进某一格）';
        else if (entry.failed === true) why = '第 ' + String(DD_FLOW.indexOf(step) + 1) + ' 步失败，归到这一步名下';
        else why = '第 ' + String(DD_FLOW.indexOf(step) + 1) + ' 步有回执';
        detail.push({
            index: j,
            step: step,
            stepLabel: step === null ? '认不出的步骤' : DD_FLOW_TEXT[step],
            order: step === null ? 0 : (DD_FLOW.indexOf(step) + 1),
            known: step !== null,
            failed: entry.failed === true,
            name: (typeof entry.name === 'string' && entry.name.length > 0) ? entry.name : null,
            code: (typeof entry.code === 'string' || typeof entry.code === 'number') ? entry.code : null,
            detail: (typeof entry.detail === 'string' && entry.detail.length > 0) ? entry.detail : null,
            location: (typeof entry.location === 'string' && entry.location.length > 0) ? entry.location : null,
            why: why
        });
    }
    let unnamed = 0;
    for (let j = 0; j < detail.length; j += 1) if (detail[j].known === false) unnamed += 1;
    return Object.freeze({
        total: rows.length,
        cells: Object.freeze(cells),
        detail: Object.freeze(detail),
        unnamed: unnamed,
        shown: trimRows(detail, DD_ROWS_SHOWN)
    });
}

/* ══════════ 第五格：栏位体检面（缺栏位逐格列出，不塌成 0） ══════════ */
export function fieldFace(archive, version) {
    const ver = (typeof version === 'number') ? version : 1;
    const rows = [];
    for (let i = 0; i < DD_FIELDS.length; i += 1) {
        const f = DD_FIELDS[i];
        const holder = readPath(archive, f.path);
        const present = (typeof holder !== 'undefined');
        const supported = ver >= f.since;
        const typeKnown = typeInBook(f.type);
        let state;
        if (present) state = 'present';
        else if (supported) state = 'missing';
        else state = 'notYet';
        let why;
        if (state === 'present') why = '这一栏在场';
        else if (state === 'missing') why = '这一栏从第 ' + String(f.since) + ' 版起该有，这份里没有 —— 缺栏位不许读成 ' + defaultText(f.type);
        else why = '这一栏从第 ' + String(f.since) + ' 版起才有，这份是第 ' + String(ver) + ' 版，没有是对的';
        if (!typeKnown) why += '（这一栏声明的类型「' + String(f.type) + '」不在类型册里）';
        rows.push({
            key: f.key,
            label: f.label,
            type: f.type,
            typeKnown: typeKnown,
            typeText: DD_TYPE_TEXT[f.type],
            since: f.since,
            present: present,
            supported: supported,
            state: state,
            fill: defaultText(f.type),
            shape: present ? shapeOf(holder) : null,
            shapeText: present ? shapeText(holder) : null,
            why: why
        });
    }
    let missing = 0;
    let unknownTypes = 0;
    for (let i = 0; i < rows.length; i += 1) if (rows[i].state === 'missing') missing += 1;
    for (let i = 0; i < rows.length; i += 1) if (!rows[i].typeKnown) unknownTypes += 1;
    return Object.freeze({ version: ver, rows: Object.freeze(rows), missing: missing, unknownTypes: unknownTypes, shown: trimRows(rows, DD_ROWS_SHOWN) });
}

/* ══════════ 第六格：迁移计划面（逐版列，断链即停） ══════════ */
function tolerancePlan(archive) {
    const breed = readPath(archive, '角色档案.生理读数.承载耐受');
    const snapshot = readPath(archive, '角色运行时.孕期快照');
    const custom = hasKey(snapshot, '承载耐受');
    const inSnapshot = custom ? snapshot['承载耐受'] : undefined;
    const nowValue = 3;
    const legacyValue = 1;
    const value = numOf(custom ? inSnapshot : breed);
    let action;
    let why;
    if (custom && value === null) {
        action = 'cant';
        why = '孕期快照里有承载耐受这一栏，但读不出数字 —— 不动';
    } else if (!custom && value === null) {
        action = 'cant';
        why = '承载耐受这一栏读不出数字（缺栏位与自订同形）—— 不动';
    } else if (isClose(value, legacyValue)) {
        action = 'now';
        why = '仍等于旧内置值（' + String(legacyValue) + '）：视为没被自订过，换成新内置值（' + String(nowValue) + '）';
    } else if (isClose(value, nowValue)) {
        action = 'keep';
        why = '已经等于新内置值，不动';
    } else {
        action = 'keep';
        why = '与新旧两个内置值都不同（读到 ' + String(value) + '）：视为自订过，一律不动';
    }
    return { key: 'breedTolerance', label: '承载耐受', action: action, from: value, current: nowValue, legacy: legacyValue, why: why };
}
function recoveryPlan(archive) {
    const stage = readPath(archive, '角色档案.基础.阶段');
    const days = readPath(archive, '角色档案.生理读数.产后恢复天数');
    const snap = readPath(archive, '角色运行时.孕期快照');
    const inSnapshot = readPath(archive, '角色运行时.孕期快照.产后恢复天数');
    const recover = (typeof stage === 'string' && stage === '产后恢复');
    const value = numOf(days);
    let action;
    let why;
    if (recover) {
        action = 'keep';
        why = '这一位正在产后恢复：天数保留原值，不打断进行中的恢复';
    } else if (hasKey(snap, '产后恢复天数')) {
        action = 'keep';
        why = '孕期快照里还留着天数这一栏：不再从快照取（脱钩），但本件不删宿主的字段';
    } else if (value === null) {
        action = 'cant';
        why = '产后恢复天数读不出来，且不在产后恢复里 —— 不动（本件不替它算）';
    } else {
        action = 'now';
        why = '不在产后恢复里：按新公式重算（单胎口径），当前读数是 ' + String(value) + ' 天';
    }
    return { key: 'recoveryDays', label: '产后恢复天数', action: action, from: value, snapshot: (typeof inSnapshot === 'undefined') ? null : inSnapshot, why: why };
}
function missingFillPlan(archive, version) {
    const out = [];
    for (let i = 0; i < DD_FIELDS.length; i += 1) {
        const f = DD_FIELDS[i];
        if (f.since !== 3) continue;
        const holder = readPath(archive, f.path);
        const present = (typeof holder !== 'undefined');
        let action;
        let why;
        if (present) {
            action = 'keep';
            why = '这一栏已经在了（' + shapeText(holder) + '），不动';
        } else if (version !== null && version >= f.since) {
            action = 'cant';
            why = '这一栏从第 ' + String(f.since) + ' 版起该有，这份里没有 —— 缺栏位与真值 0 同形，本件不替它补';
        } else {
            action = 'fill';
            why = '第 ' + String(f.since) + ' 版起才有这一栏：这一份不可能处在延产期，补默认值（' + defaultText(f.type) + '）';
        }
        out.push({ key: f.key, label: f.label, action: action, type: f.type, typeText: DD_TYPE_TEXT[f.type],
            from: present ? holder : null, fill: defaultText(f.type), why: why });
    }
    return out;
}
export function migrationPlan(archive) {
    const v = versionFace(archive);
    if (!v.withinRange) {
        return Object.freeze({
            version: null,
            steps: Object.freeze([]),
            halted: true,
            why: '结构版本认不出来，迁移计划不敢往下排（一跳就是错）',
            actions: Object.freeze([]),
            shown: trimRows([], DD_ROWS_SHOWN)
        });
    }
    const steps = [];
    const actions = [];
    for (let i = 0; i < DD_MIGRATIONS.length; i += 1) {
        const m = DD_MIGRATIONS[i];
        if (v.value >= m.to) {
            steps.push({ from: m.from, to: m.to, needed: false, note: m.note, actions: Object.freeze([]) });
            continue;
        }
        const acts = [];
        if (m.rules.indexOf('tolerance') >= 0) acts.push(tolerancePlan(archive));
        if (m.rules.indexOf('recoveryDays') >= 0) acts.push(recoveryPlan(archive));
        if (m.rules.indexOf('missingFill') >= 0) {
            const fills = missingFillPlan(archive, v.value);
            for (let j = 0; j < fills.length; j += 1) acts.push(fills[j]);
        }
        for (let j = 0; j < acts.length; j += 1) actions.push(acts[j]);
        steps.push({ from: m.from, to: m.to, needed: true, note: m.note, actions: Object.freeze(acts) });
    }
    return Object.freeze({
        version: v.value,
        steps: Object.freeze(steps),
        halted: false,
        why: '第 ' + String(v.value) + ' 版到第 ' + String(DD_VERSION_LATEST) + ' 版，逐版排开（共 ' + String(steps.length) + ' 步）',
        actions: Object.freeze(actions),
        shown: trimRows(actions, DD_ROWS_SHOWN)
    });
}

/* ══════════ 汇总面（总体判定 + 逐条问题） ══════════ */
export function problemsOf(parts) {
    const out = [];
    const v = parts.version;
    if (v.blank) out.push('版本：这一份没有结构版本这一栏（旧档按第 1 版读，但本件把没这一栏单独报）');
    else if (v.unrecognized) out.push('版本：结构版本认不出来，不敢当合格');
    const d = parts.delta;
    if (d.conflict) out.push('增量：' + d.why);
    const f = parts.fields;
    for (let i = 0; i < f.rows.length; i += 1) {
        if (f.rows[i].state === 'missing') out.push('栏位：' + f.rows[i].label + ' 缺栏位（不许读成 ' + f.rows[i].fill + '）');
    }
    const s = parts.statuses;
    if (s.unrecognized > 0) out.push('状态：有 ' + String(s.unrecognized) + ' 条状态认不出来，已并入说不清（没当还没发生）');
    const p = parts.pipeline;
    if (p.unnamed > 0) out.push('流水线：有 ' + String(p.unnamed) + ' 条回执的步骤认不出来（没硬塞进某一格）');
    for (let i = 0; i < p.cells.length; i += 1) {
        if (p.cells[i].failed > 0) out.push('流水线：' + p.cells[i].label + ' 失败 ' + String(p.cells[i].failed) + ' 次');
    }
    const plan = parts.plan;
    if (plan.halted) out.push('迁移：' + plan.why);
    for (let i = 0; i < plan.actions.length; i += 1) {
        if (plan.actions[i].action === 'cant') out.push('迁移：' + plan.actions[i].label + ' 认不出来（' + plan.actions[i].why + '）');
    }
    return out;
}
export function verdictOf(parts) {
    if (parts.version.unrecognized) return 'cant';
    if (parts.delta.present !== false && parts.delta.known === false) return 'cant';
    if (parts.problems.length > 0) return 'warn';
    return 'ok';
}
export function summarize(input) {
    const src = isPlain(input) ? input : {};
    const archive = isPlain(src.archive) ? src.archive : {};
    const version = versionFace(archive);
    const statuses = statusFace(src.statuses);
    const delta = deltaFace(src.delta);
    const pipeline = pipelineFace(src.pipeline);
    const fields = fieldFace(archive, version.withinRange ? version.value : 1);
    const plan = migrationPlan(archive);
    const parts = { version: version, statuses: statuses, delta: delta, pipeline: pipeline, fields: fields, plan: plan, problems: [] };
    parts.problems = Object.freeze(problemsOf(parts));
    const verdict = verdictOf(parts);
    return Object.freeze({
        verdict: verdict,
        verdictLabel: DD_VERDICT_TEXT[verdict],
        version: version,
        statuses: statuses,
        delta: delta,
        pipeline: pipeline,
        fields: fields,
        plan: plan,
        problems: parts.problems,
        at: stampOf(src.now)
    });
}

/* ══════════ 可复制的摘要文本（本件唯一的产物） ══════════ */
export function requestText(summary, extra) {
    const s = (isPlain(summary)) ? summary : {};
    const lines = [];
    lines.push('照这份存档读下来的体检单');
    lines.push('判定：' + cleanText(s.verdictLabel));
    if (isPlain(s.version)) lines.push('结构版本：' + cleanText(s.version.text) + '（' + cleanText(s.version.why) + '）');
    if (isPlain(s.delta)) lines.push('增量：' + cleanText(s.delta.statusLabel) + ' / ' + String(s.delta.count) + ' 条（' + cleanText(s.delta.why) + '）');
    if (isPlain(s.fields)) lines.push('缺栏位：' + String(s.fields.missing) + ' 格');
    if (isPlain(s.statuses)) {
        const cells = listOf(s.statuses.cells);
        const bits = [];
        for (let i = 0; i < cells.length; i += 1) bits.push(cells[i].label + ' ' + String(cells[i].count));
        lines.push('状态逐格：' + bits.join(' / '));
    }
    if (isPlain(s.pipeline)) {
        const cells = listOf(s.pipeline.cells);
        const bits = [];
        for (let i = 0; i < cells.length; i += 1) bits.push(cells[i].label + '：' + cleanText(cells[i].text));
        lines.push('流水线逐格：' + bits.join(' / '));
    }
    if (isPlain(s.plan)) {
        if (s.plan.halted) lines.push('迁移计划：' + cleanText(s.plan.why));
        else {
            const steps = listOf(s.plan.steps);
            for (let i = 0; i < steps.length; i += 1) {
                const st = steps[i];
                lines.push('迁移第 ' + String(st.from) + ' 版到第 ' + String(st.to) + ' 版：' + (st.needed ? '要做' : '不用做'));
                const acts = listOf(st.actions);
                for (let j = 0; j < acts.length; j += 1) {
                    lines.push('  · ' + cleanText(acts[j].label) + '：' + cleanText(DD_ACTION_TEXT[acts[j].action]) + '（' + cleanText(acts[j].why) + '）');
                }
            }
        }
    }
    const probs = listOf(s.problems);
    if (probs.length === 0) lines.push('要处置的：没有');
    else {
        lines.push('要处置的：');
        for (let i = 0; i < probs.length; i += 1) lines.push('  · ' + cleanText(probs[i]));
    }
    const e = cleanText(extra);
    if (e.length > 0) lines.push('追加要求：' + e);
    const text = lines.join(String.fromCharCode(10));
    const over = text.length > DD_TEXT_MAX;
    return Object.freeze({
        text: over ? text.slice(0, DD_TEXT_MAX) : text,
        chars: text.length,
        over: over,
        overWhy: over ? ('摘要超上限（' + String(text.length) + ' / ' + String(DD_TEXT_MAX) + '）—— 本件只报不截') : ''
    });
}

/* ══════════ 收录面（贴什么进来，八个失败因逐因成立） ══════════ */
export const DD_INTAKE_WHYS = Object.freeze([
    'empty_input', 'too_long', 'empty', 'bad_json', 'no_object', 'no_fields', 'too_many', 'too_deep'
]);
export function intake(text, max) {
    const s = cleanText(text);
    const cap = (typeof max === 'number') ? max : DD_TEXT_MAX;
    if (s.trim().length === 0) return Object.freeze({ ok: false, why: 'empty_input', value: null });
    if (s.length > cap) return Object.freeze({ ok: false, why: 'too_long', value: null });
    let parsed;
    try {
        parsed = JSON.parse(s);
    } catch (e) {
        return Object.freeze({ ok: false, why: 'bad_json', value: null });
    }
    if (!isPlain(parsed)) return Object.freeze({ ok: false, why: 'no_object', value: null });
    const keys = Object.keys(parsed);
    if (keys.length === 0) return Object.freeze({ ok: false, why: 'empty', value: null });
    if (!hasKey(parsed, 'version') && !hasKey(parsed, '角色档案') && !hasKey(parsed, 'status') && !hasKey(parsed, 'statuses') && !hasKey(parsed, 'delta') && !hasKey(parsed, 'pipeline')) {
        return Object.freeze({ ok: false, why: 'no_fields', value: null });
    }
    if (depthOf(parsed) > DD_DEPTH_MAX) return Object.freeze({ ok: false, why: 'too_deep', value: null });
    if (keys.length > DD_ROLES_MAX) return Object.freeze({ ok: false, why: 'too_many', value: null });
    return Object.freeze({ ok: true, why: '', value: Object.freeze(parsed) });
}
