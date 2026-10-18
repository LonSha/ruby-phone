/* ============================================================
 * config/lore-import-contract.js — [v4.23.0 · 第四期 R4-X2 设定资料导入向导]
 * ------------------------------------------------------------
 * 【本件是纯契约:只搬上游读数、只翻人话,零 DOM 零存储零联网零时钟】
 *   上游负责分层判定 / 实体映射 / 逐条 diff / 幂等键 / 真写入;
 *   手机负责文件选择、逐段预览与确认交互(`audit: 跨仓分工`原文:
 *   上游持有事实与确认写入,手机持有交互与本地文稿)。
 *
 * 【它补的是哪一格(计划 R4-X2 原文)】
 *   「从手机选一份资料,逐段看分类、同名角色映射与冲突,确认导入;
 *     知道哪些是设定、哪些是前史,不把看过一本书当成角色经历过。」
 *   验收:完整长文含尾章事实、同名角色、混合规则与前史;逐段可改类、可取消;
 *        确认后能查询且重启保留;拒绝项不入库、重复提交不重复导入。
 *   不做:不抓取网络小说、不默认上传整本书、不新增事实数据库。
 *
 * 【修前实测的缺口(读码可复算,不是推演)】
 *   上游 **v3.327.0(M3-X5)** 起了分层导入面、**v3.339.0(M4-X1)** 把它闭合到
 *   真写入(`loreImportApply` 走 PrequelSystem owner),十二个 `loreImport*` 出口
 *   齐全;而本仓实测 `grep -RIn 'loreImport' apps config` **零命中** ——
 *   同一族的第十五例「建好不消费」。手机侧当时只有「导入为书读」一条路:
 *   那份资料进了书架,于是「世界观规则」与「前史事件」在读数上同形,
 *   而作者真正要的正是「哪几段是约束、哪几段是已经发生过的过去」。
 *
 * 【四条不可让步的口径(本面的全部价值就在这里)】
 *   1 **未判 ≠ 没有**:上游 `entityCandidates` 在没给已登记实体名单时给
 *     `checked:false`;`diffPreview` 在没给已确认事实时给 `confirmedChecked:false`。
 *     把「映射面未判」写成「无映射」、「冲突面未判」写成「无冲突」,是本仓
 *     治过多轮的错读数,且两者处置相反(前者去补依赖,后者可以放心导入)。
 *   2 **重复导入 ≠ 这次没写**:上游 `duplicate:true` 时回执是 `ok:true`,
 *     与 `nothing-to-apply`(真的没东西可落)处置相反。
 *   3 **截断 ≠ 空**:42 万字符资料尾部被 slice 掉是 `completeness.state='partial'`,
 *     处置是「用窗口解析逐段导入」;而「切不出段」是这份资料本身没内容。
 *   4 **计划 ≠ 落笔**:上游 `planApply` 的 `writesNothing` 恒 true(它只算不写),
 *     真写入只在 `loreImportApply`。把前者当落笔口会「以为导入了其实没有」。
 *
 * 【为什么另立一套面状态(不复用 memory-qa-contract 的那套)】
 *   五格基座同形,但本面多一格 `blocked`(读出来了、但这一份不可导入)。复用就要
 *   去改那一套的词表 —— 跨面改公共词表会波及无关面,而这两面本无契约关系。
 * ============================================================ */
'use strict';

/** 面状态六格(`unusable` 与 `blocked` 不同形:前者本机读不出,后者读得出但不能落)。 */
export const LORE_FACE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',   // 插件不在场:等装插件
    FACE_ABSENT: 'face-absent',       // 插件在场但没有导入面(旧版):等上游升级
    UNUSABLE: 'unusable',             // 出口在、调用抛错或回执畸形:本机读不出
    BLOCKED: 'blocked',               // 读出来了,但这一份不可导入(截断 / 空源)
    EMPTY: 'empty',                   // 读了、切了、确实没有段(真读数)
    OK: 'ok'
});

/** 派发相:有落笔口走完整旅程;只有预览口则**只能看不能落**(必须当面说清)。 */
export const LORE_OUTLETS = Object.freeze({
    FULL: 'parse+apply',        // 预览 + 落笔都有
    PREVIEW_ONLY: 'preview-only', // 只能看到计划,落不了(旧版插件)
    NONE: 'none'
});

/** 逐条判定五态词表(与上游 `ADMIT` 逐字同源;下游不许另立名)。 */
export const LORE_ADMIT = Object.freeze({
    ADD: 'add', SAME: 'same', CONFLICT: 'conflict',
    MAPPING: 'mapping-needs-confirm', DANGLING: 'dangling'
});

/** 旅程阶段(**顺序即界面顺序**;读数行与自检都以它为准)。 */
export const LORE_STAGES = Object.freeze(['parse', 'entities', 'preview', 'plan', 'apply', 'ledger']);

export const LORE_LIMITS = Object.freeze({
    rows: 80,       // 逐段表最多渲染几行(再多就只是把浏览器拖慢)
    snippet: 80,    // 段摘录上限(与上游 SNIPPET_MAX 同值,不自行加宽)
    candidates: 6   // 单个条目最多列几个同名候选
});

const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';

function winOf(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}
/** 安全取上游插件实例(宿主怪异 getter 一律降级成 null,绝不外抛)。 */
function pluginOf(win) {
    try {
        const w = winOf(win);
        if (!w) return null;
        const p = w[LONSHA_PLUGIN_GLOBAL];
        return (p && typeof p === 'object') ? p : null;
    } catch (_e) { return null; }
}
function txt(v) { return String(v == null ? '' : v).trim(); }
function raw(v) { return String(v == null ? '' : v); }
function arr(v) { return Array.isArray(v) ? v : []; }
/* [v4.23.0 · 自抓缺陷] 首版写作 readNum(v, d) 且体内是 Number(v) 加 isFinite ——
 *   weak-coercion 门实测报 W2b「族名弱形态」：名字在 num/floor/finite 族里、
 *   体内又没有类型判定，于是 没给 的四种形态一律穿成默认值。本件的默认值确实
 *   是有意的（不是要报 没给），但形态与全仓治过四轮的弱口径同形 —— 留着它，
 *   下一个写取数函数的人会照抄这一份。改走强形态：先看类型与空串，再取数。 */
function readNum(v, d) {
    if (typeof v !== 'number' && typeof v !== 'string') return d;
    if (typeof v === 'string' && !v.trim()) return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}
function bool(v) { return v === true; }

/**
 * 出口探测(**只认函数出口,不认自述**)。
 *   名字给多个时按序取第一个在场的 —— 上游同一件事偶有别名,但**调用口径不变**。
 */
function outletOf(win, names) {
    const p = pluginOf(win);
    if (!p) return { plugin: null, name: '', why: 'plugin-absent' };
    const list = Array.isArray(names) ? names : [names];
    for (const n of list) {
        try { if (typeof p[n] === 'function') return { plugin: p, name: n, why: '' }; }
        catch (_e) { /* 怪异 getter:如实当这一面读不出 */ }
    }
    return { plugin: p, name: '', why: 'face-absent' };
}

/**
  * 落笔面两口的在场探测(**出口名只在本件出现**)。
 *
 * 【为何必须收在这里】App 首版自己写 `typeof plugin.loreImportParse === 'function'`
 *   来算派发相 —— 于是同一个上游出口名在两处出现。名字写两处的后果不是报错:
 *   上游改名/加别名时,契约件那份跟着改、App 那份悄悄落空,派发相静默退化成
 *   「没有落笔口」——用户看见的是「只能看不能落」,而其实落笔口就在那儿。
 *   (与「同一口径只许一份实现」同族;本仓治过多轮。)
 */
export function loreOutletProbe(win) {
    return {
        hasParse: !!outletOf(win, 'loreImportParse').name,
        hasApply: !!outletOf(win, 'loreImportApply').name
    };
}
/** 派发相:严格判 true(宽松判会把 1 / 'yes' 读成「有出口」,用户会点到走不通的按钮)。 */
export function planLoreOutlet(hasParse, hasApply) {
    if (hasParse !== true) return LORE_OUTLETS.NONE;
    if (hasApply === true) return LORE_OUTLETS.FULL;
    return LORE_OUTLETS.PREVIEW_ONLY;
}

/** 缺席形态的恒定键面(读者不必再判 undefined)。 */
function blankParse(reason, state) {
    return {
        state: state || LORE_FACE_STATES.UNUSABLE, faceReason: reason,
        ok: false, source: { file: '', chars: 0, lines: 0, truncated: false },
        completeness: { state: 'unknown', totalChars: null, readChars: 0, truncated: null, nextCursor: null },
        sections: [], items: [], classes: {}, classRows: [], classTotal: 0, why: []
    };
}

/** 类目计数 → 有序行(数字仍是上游给的;**不做第二遍计数**)。 */
function classRowsOf(classes, items) {
    const src = (classes && typeof classes === 'object') ? classes : {};
    const label = {};
    for (const it of arr(items)) {
        const c = txt(it && it.cls);
        if (c && label[c] === undefined) label[c] = txt(it && it.clsLabel);
    }
    const rows = [];
    for (const k of Object.keys(src)) rows.push({ cls: k, count: readNum(src[k], 0), label: label[k] || '' });
    return rows;
}

/** 面自述(缺哪一格、缺了会怎样)。**只读、不抛。** */
export function readLoreDescribe(win) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        present: 0, total: 0, missing: [], classes: [], classLabels: [],
        classesExhaustive: false, settingVsHappenedSplit: false, maskFixedLength: false,
        secretBodyKeys: [], maxSourceChars: 0, offline: true, writesNothing: true
    };
    const o = outletOf(win, 'loreImportDescribe');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const d = o.plugin[o.name]();
        if (!d || typeof d !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        return {
            state: LORE_FACE_STATES.OK, faceReason: txt(d.reason),
            present: readNum(d.present, 0), total: readNum(d.total, 0),
            missing: arr(d.missing).map(txt).filter(Boolean),
            classes: arr(d.classes).map(txt).filter(Boolean),
            classLabels: arr(d.classLabels).map(txt),
            classesExhaustive: bool(d.classesExhaustive),
            settingVsHappenedSplit: bool(d.settingVsHappenedSplit),
            maskFixedLength: bool(d.maskFixedLength),
            secretBodyKeys: arr(d.secretBodyKeys).map(txt).filter(Boolean),
            maxSourceChars: readNum(d.maxSourceChars, 0),
            offline: d.offline !== false, writesNothing: d.writesNothing !== false
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 「逐段可改类」的选项(**选项表来自上游自述**,手机不另立一份类目表)。 */
export function pickableClassesOf(describe) {
    const d = (describe && typeof describe === 'object') ? describe : null;
    const keys = d ? arr(d.classes) : [];
    const labels = d ? arr(d.classLabels) : [];
    return keys.map(function (k, i) {
        /* 上游没给标签时**如实显示原始类名**,不自己编一个中文 —— 编出来就是第二份口径。 */
        return { cls: txt(k), label: txt(labels[i]) || txt(k) };
    }).filter(function (r) { return !!r.cls; });
}

/** 分层解析(**只读**)。 */
export function readLoreParse(win, source, opts) {
    const o = outletOf(win, 'loreImportParse');
    if (!o.plugin) return blankParse('plugin-absent', LORE_FACE_STATES.ENGINE_ABSENT);
    if (!o.name) return blankParse('face-absent', LORE_FACE_STATES.FACE_ABSENT);
    try {
        const r = o.plugin[o.name](source, opts || {});
        if (!r || typeof r !== 'object') return blankParse('malformed', LORE_FACE_STATES.UNUSABLE);
        /* [v4.23.0 · 自抓缺陷] 首版这里把「回执翻译」另写了一份，与 `readLoreParseFromRaw`
         *   各判一次截断 —— 于是窗口解析那一份把「还有下一段」读成「资料被截断」
         *   （两者处置相反：一个叫你换窗口读，一个叫你接着读）。现收成同一处。 */
        return readLoreParseFromRaw(r);
    } catch (_e) {
        return blankParse('thrown', LORE_FACE_STATES.UNUSABLE);
    }
}

/** 窗口解析(**长资料局部导入的正规入口**;窗口坐标原样搬运)。 */
export function readLoreParseWindow(win, source, opts) {
    const o = outletOf(win, 'loreImportParseWindow');
    if (!o.plugin) return Object.assign(blankParse('plugin-absent', LORE_FACE_STATES.ENGINE_ABSENT), { window: null });
    if (!o.name) return Object.assign(blankParse('window-unsupported', LORE_FACE_STATES.FACE_ABSENT), { window: null });
    try {
        const r = o.plugin[o.name](source, opts || {});
        if (!r || typeof r !== 'object') return Object.assign(blankParse('malformed', LORE_FACE_STATES.UNUSABLE), { window: null });
        const base = readLoreParseFromRaw(r);
        const w = (r.window && typeof r.window === 'object') ? r.window : null;
        return Object.assign(base, {
            /* 窗口即使只有一段也要把坐标带出去 —— 用户要看到「这次读的是全文哪一段」。 */
            window: w ? { from: readNum(w.from, 0), to: readNum(w.to, 0), chars: readNum(w.chars, 0), hasNext: bool(w.hasNext) } : null
        });
    } catch (_e) {
        return Object.assign(blankParse('thrown', LORE_FACE_STATES.UNUSABLE), { window: null });
    }
}
/** 把上游回执翻成恒定键面(parse / parseWindow 共用一处口径,不写两份)。 */
function readLoreParseFromRaw(r) {
    const comp = (r.completeness && typeof r.completeness === 'object') ? r.completeness : null;
    const srco = (r.source && typeof r.source === 'object') ? r.source : null;
    const items = arr(r.items);
    const why = arr(r.why).map(txt).filter(Boolean);
    /* ★ 真截断只有一种形：上游把源**切短了**（`source.truncated === true`）。
     *   首版把 `completeness.state === 'partial'` 也算作截断 —— 而窗口解析「还有下一段」
     *   同样是 partial（它的 `source.truncated` 是 false）。两者处置相反：
     *   截断 ⇒ 改用「选范围逐段读」；窗口读 ⇒ 接着选下一段范围。
     *   压平之后，用户按提示去点选范围时那一窗其实已经读进来了 —— 不报错，
     *   只是把一次正常的续读谎报成「资料被截断」。 */
    const hasWindow = !!(r.window && typeof r.window === 'object');
    const truncated = bool(srco && srco.truncated)
        || (bool(comp && comp.state === 'partial') && !hasWindow);
    let state;
    let faceReason;
    if (truncated) { state = LORE_FACE_STATES.BLOCKED; faceReason = 'source-truncated'; }
    else if (items.length) { state = LORE_FACE_STATES.OK; faceReason = 'ok'; }
    else if (why.indexOf('empty-source') >= 0) { state = LORE_FACE_STATES.BLOCKED; faceReason = 'empty-source'; }
    else { state = LORE_FACE_STATES.EMPTY; faceReason = 'no-sections'; }
    return {
        state, faceReason, ok: bool(r.ok),
        source: {
            file: srco ? txt(srco.file) : '', chars: srco ? readNum(srco.chars, 0) : 0,
            lines: srco ? readNum(srco.lines, 0) : 0, truncated: bool(srco && srco.truncated)
        },
        completeness: {
            state: comp ? txt(comp.state) : 'unknown',
            totalChars: comp ? (comp.totalChars === null || comp.totalChars === undefined ? null : readNum(comp.totalChars, 0)) : null,
            readChars: comp ? readNum(comp.readChars, 0) : 0,
            truncated: comp ? bool(comp.truncated) : null,
            nextCursor: comp ? (comp.nextCursor === null || comp.nextCursor === undefined ? null : readNum(comp.nextCursor, 0)) : null
        },
        sections: arr(r.sections).slice(), items: items.slice(),
        classes: (r.classes && typeof r.classes === 'object') ? Object.assign({}, r.classes) : {},
        classRows: classRowsOf(r.classes, items), classTotal: arr(r.sections).length, why
    };
}

/** 实体映射(**映射必须确认**;未给清单 ⇒ 未判,不报「无映射」)。 */
export function readLoreEntities(win, parsed, opts) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        checked: false, exact: 0, needsConfirm: 0, unresolved: 0, entries: [], why: []
    };
    const o = outletOf(win, 'loreImportEntities');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name](parsed, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        /* ★ checked:false 是**未判**,不是「零命中」——两者处置相反(去补清单 vs 可以导入)。 */
        return {
            state: bool(r.checked) ? LORE_FACE_STATES.OK : LORE_FACE_STATES.EMPTY,
            faceReason: bool(r.checked) ? 'checked' : 'not-checked',
            checked: bool(r.checked), exact: readNum(r.exact, 0), needsConfirm: readNum(r.needsConfirm, 0),
            unresolved: readNum(r.unresolved, 0),
            entries: arr(r.entries).map(function (e) {
                const x = (e && typeof e === 'object') ? e : {};
                return {
                    itemKey: txt(x.itemKey), verdict: txt(x.verdict), why: txt(x.why),
                    hits: arr(x.hits).slice(0, LORE_LIMITS.candidates).map(function (h) {
                        const y = (h && typeof h === 'object') ? h : {};
                        return { name: txt(y.name), owners: arr(y.owners).map(txt).filter(Boolean) };
                    })
                };
            }),
            why: arr(r.why).map(txt).filter(Boolean)
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 逐条 diff(**冲突默认不替用户决定**;未给已确认事实 ⇒ 冲突面报未判)。 */
export function readLorePreview(win, parsed, target, opts) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        verdict: 'blocked', add: 0, same: 0, conflict: 0, mapping: 0, dangling: 0,
        skipped: 0, total: 0, confirmedChecked: false, knownRefsChecked: false, entries: [], why: []
    };
    const o = outletOf(win, 'loreImportPreview');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name](parsed, target, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        const verdict = txt(r.verdict);
        return {
            state: LORE_FACE_STATES.OK, faceReason: verdict || 'unknown',
            verdict: verdict || 'unknown',
            add: readNum(r.add, 0), same: readNum(r.same, 0), conflict: readNum(r.conflict, 0),
            mapping: readNum(r.mapping, 0), dangling: readNum(r.dangling, 0), skipped: readNum(r.skipped, 0),
            total: readNum(r.total, 0),
            /* ★ 两个「未判」标志原样带出(档头口径 1);压平即错读数。 */
            confirmedChecked: bool(r.confirmedChecked), knownRefsChecked: bool(r.knownRefsChecked),
            entries: arr(r.entries).map(function (e) {
                const x = (e && typeof e === 'object') ? e : {};
                return {
                    key: txt(x.key), cls: txt(x.cls), title: txt(x.title),
                    action: txt(x.action), why: txt(x.why), sensitive: bool(x.sensitive)
                };
            }),
            why: arr(r.why).map(txt).filter(Boolean)
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 出导入计划(**只算不写**;`writesNothing` 恒 true 是真读数,不是缺陷)。 */
export function readLorePlan(win, parsed, preview, opts) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        ok: false, importId: '', duplicate: false, applied: [], count: 0, total: 0,
        skipped: [], reason: '', writesNothing: true, nextCursor: null
    };
    const o = outletOf(win, 'loreImportPlan');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name](parsed, preview, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        /* ★ duplicate 单列(档头口径 2):它与「没东西可落」处置相反。 */
        return {
            state: bool(r.ok) ? LORE_FACE_STATES.OK : LORE_FACE_STATES.BLOCKED,
            faceReason: txt(r.reason) || (bool(r.ok) ? 'ok' : 'plan-failed'),
            ok: bool(r.ok), importId: txt(r.importId), duplicate: bool(r.duplicate),
            applied: arr(r.applied).map(function (a) {
                const x = (a && typeof a === 'object') ? a : {};
                return { key: txt(x.key), cls: txt(x.cls), action: txt(x.action), sensitive: bool(x.sensitive) };
            }),
            count: readNum(r.count, 0), total: readNum(r.total, 0),
            skipped: arr(r.skipped).map(function (s) {
                const x = (s && typeof s === 'object') ? s : {};
                return { key: txt(x.key), why: txt(x.why) };
            }),
            reason: txt(r.reason), writesNothing: r.writesNothing !== false,
            nextCursor: (r.nextCursor === null || r.nextCursor === undefined) ? null : readNum(r.nextCursor, 0)
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 人工校订叠加(**零写**;规则痕迹与人工痕迹分列,上游已做)。 */
export function readLoreOverride(win, parsed, overrides, opts) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        ok: false, items: [], applied: 0, rejected: [], counts: {}, why: []
    };
    const o = outletOf(win, 'loreImportOverride');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name](parsed, overrides, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        return {
            state: LORE_FACE_STATES.OK, faceReason: bool(r.ok) ? 'ok' : 'partial',
            ok: bool(r.ok), items: arr(r.items).slice(), applied: readNum(r.applied, 0),
            rejected: arr(r.rejected).map(function (x) {
                const y = (x && typeof x === 'object') ? x : {};
                return { key: txt(y.key), why: txt(y.why), got: txt(y.got) };
            }),
            counts: (r.counts && typeof r.counts === 'object') ? Object.assign({}, r.counts) : {},
            why: arr(r.why).map(txt).filter(Boolean)
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 同名映射确认回填(**零写**;未确认的段不得静默合并)。 */
export function readLoreConfirmMapping(win, parsed, mapping, opts) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        checked: false, needsConfirm: [], resolved: [], unresolved: 0, mappingNeedsConfirm: [], why: []
    };
    const o = outletOf(win, 'loreImportConfirmMapping');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name](parsed, mapping, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        return {
            state: bool(r.checked) ? LORE_FACE_STATES.OK : LORE_FACE_STATES.EMPTY,
            faceReason: bool(r.checked) ? 'checked' : 'not-checked',
            checked: bool(r.checked),
            needsConfirm: arr(r.needsConfirm).map(function (x) {
                const y = (x && typeof x === 'object') ? x : {};
                return { itemKey: txt(y.itemKey), hits: arr(y.hits).slice(0, LORE_LIMITS.candidates).map(function (h) {
                    const z = (h && typeof h === 'object') ? h : {};
                    return { name: txt(z.name), owners: arr(z.owners).map(txt).filter(Boolean) };
                }), why: txt(y.why) };
            }),
            resolved: arr(r.resolved).map(function (x) {
                const y = (x && typeof x === 'object') ? x : {};
                return { itemKey: txt(y.itemKey), owner: txt(y.owner) };
            }),
            unresolved: readNum(r.unresolved, 0),
            mappingNeedsConfirm: arr(r.mappingNeedsConfirm).map(txt).filter(Boolean),
            why: arr(r.why).map(txt).filter(Boolean)
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 变更段(**源更新只重审变更段**;段序对不上按标题再对一次,标题也找不到仍计 removed)。 */
export function readLoreChanged(win, oldParsed, newParsed) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        added: [], removed: [], changed: [], same: [],
        counts: { added: 0, removed: 0, changed: 0, same: 0 }, oldChecked: false, why: []
    };
    const o = outletOf(win, 'loreImportChanged');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name](oldParsed, newParsed);
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        const c = (r.counts && typeof r.counts === 'object') ? r.counts : {};
        return {
            state: bool(r.oldChecked) ? LORE_FACE_STATES.OK : LORE_FACE_STATES.EMPTY,
            faceReason: bool(r.oldChecked) ? 'compared' : 'no-old-source',
            added: arr(r.added).slice(), removed: arr(r.removed).slice(),
            changed: arr(r.changed).slice(), same: arr(r.same).slice(),
            counts: { added: readNum(c.added, 0), removed: readNum(c.removed, 0), changed: readNum(c.changed, 0), same: readNum(c.same, 0) },
            oldChecked: bool(r.oldChecked), why: arr(r.why).map(txt).filter(Boolean)
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/**
 * 资料导入落笔(**真写入**;上游 `loreImportApply` 走 PrequelSystem owner)。
 *
 * 【本件只转交,不代替确认】上游要求「必须先预览」;未给 preview 时本件**不去调它**,
 *   直接如实报 `no-preview` —— 让上游自己拒一次与在这里就说清楚,后者对用户更有用。
 *
 * @returns {Promise<object>} 恒定键面 + `state`
 */
export async function readLoreApply(win, parsed, preview, opts) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        ok: false, reason: 'plugin-absent', importId: '', duplicate: false, selected: 0, applied: 0,
        verified: 0, persisted: null, readback: null, items: [], rejected: [],
        writes: 0, zeroWrite: true, stale: false, undo: null
    };
    /* ★ 缺件优先于流程前置:插件不在场 ⇒ 报「不在场」,不报「没预览」——
     *   两者处置相反(去装插件 vs 去过一遍预览),而后者听起来像用户少做了一步。
     *   与 readLoreParse / readLorePlan / readLoreDescribe 同序。 */
    const o = outletOf(win, 'loreImportApply');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent', reason: 'face-absent' });
    if (!preview) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.BLOCKED, faceReason: 'no-preview', reason: 'no-preview' });
    }
    try {
        const r = await o.plugin[o.name](parsed, preview, opts || {});
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'null-receipt', reason: 'null-receipt' });
        return {
            /* ★ 上游在 duplicate 时给 ok:true —— 落笔成功与「已落过」都算 ok,
             *   但两者在读数上必须分得开(靠 duplicate 那一格)。 */
            state: bool(r.ok) ? LORE_FACE_STATES.OK : LORE_FACE_STATES.BLOCKED,
            faceReason: txt(r.reason) || (bool(r.ok) ? 'ok' : 'rejected'),
            ok: bool(r.ok), reason: txt(r.reason), importId: txt(r.importId),
            duplicate: bool(r.duplicate), selected: readNum(r.selected, 0), applied: readNum(r.applied, 0),
            verified: readNum(r.verified, 0),
            /* 三态:true / false / null(null = 没尝试,「没试」与「试了失败」不同形)。 */
            persisted: (r.persisted === null || r.persisted === undefined) ? null : bool(r.persisted),
            readback: (r.readback === null || r.readback === undefined) ? null : bool(r.readback),
            items: arr(r.items).map(function (x) {
                const y = (x && typeof x === 'object') ? x : {};
                return { key: txt(y.key), cls: txt(y.cls), action: txt(y.action) };
            }),
            rejected: arr(r.rejected).map(function (x) {
                const y = (x && typeof x === 'object') ? x : {};
                return { key: txt(y.key), why: txt(y.why) };
            }),
            writes: readNum(r.writes, 0), zeroWrite: bool(r.zeroWrite), stale: bool(r.stale),
            undo: (r.undo && typeof r.undo === 'object') ? r.undo : null
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown', reason: 'thrown' });
    }
}

/** 导入账读数(**重开可查**的落点;只读)。 */
export function readLoreLedger(win) {
    const empty = {
        state: LORE_FACE_STATES.ENGINE_ABSENT, faceReason: 'plugin-absent',
        version: 0, seen: 0, chars: 0, decisions: 0, mappings: 0, lastApply: null
    };
    const o = outletOf(win, 'loreImportLedger');
    if (!o.plugin) return empty;
    if (!o.name) return Object.assign({}, empty, { state: LORE_FACE_STATES.FACE_ABSENT, faceReason: 'face-absent' });
    try {
        const r = o.plugin[o.name]();
        if (!r || typeof r !== 'object') return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'malformed' });
        return {
            state: LORE_FACE_STATES.OK, faceReason: 'ok',
            version: readNum(r.version, 0), seen: readNum(r.seen, 0), chars: readNum(r.chars, 0),
            decisions: readNum(r.decisions, 0), mappings: readNum(r.mappings, 0),
            lastApply: (r.lastApply && typeof r.lastApply === 'object') ? {
                importId: txt(r.lastApply.importId), applied: readNum(r.lastApply.applied, 0),
                verified: readNum(r.lastApply.verified, 0),
                readback: (r.lastApply.readback === null || r.lastApply.readback === undefined) ? null : bool(r.lastApply.readback)
            } : null
        };
    } catch (_e) {
        return Object.assign({}, empty, { state: LORE_FACE_STATES.UNUSABLE, faceReason: 'thrown' });
    }
}

/** 面状态的一句话归因(唯一实现;供诊断面与视图念出)。 */
export function loreFaceLine(face) {
    const f = (face && typeof face === 'object') ? face : { state: LORE_FACE_STATES.ENGINE_ABSENT };
    switch (f.state) {
        case LORE_FACE_STATES.OK: return '导入面在位';
        case LORE_FACE_STATES.EMPTY: return '读了、切了、确实没有可用段(真读数)';
        case LORE_FACE_STATES.BLOCKED: return '这一份不可导入(' + txt(f.faceReason) + ')';
        case LORE_FACE_STATES.FACE_ABSENT: return '本版插件没有导入面(等上游升级 v3.327+)—— 这不是「资料有问题」';
        case LORE_FACE_STATES.UNUSABLE: return '导入面读不出(' + txt(f.faceReason) + ')—— 这不是「资料有问题」';
        case LORE_FACE_STATES.ENGINE_ABSENT:
        default: return '记忆插件不在场 —— **不是**「这份资料导不进去」';
    }
}

/**
 * 逐条判定 → 上游 `ADMIT` 词表(**形状翻译,不重算**)。
 *
 * 【为什么需要翻译而不是直接抄 action】上游 `diffPreview` 每条给的是
 *   `action`(add / skip / replace / dangling)加一个 `why`(上游自己的词),
 *   而它**声明**对外的判定词表是 `ADMIT`(add / same / conflict /
 *   mapping-needs-confirm / dangling)。两者不是同一套字符串:把 `skip` 直接印给用户,
 *   用户在那一行上看不出「是同样的东西」还是「有冲突被挡」—— 而这两者处置相反。
 *
 * 【认不出的组合一律给空】不猜、不落回某一态;调用方据此显示「未判判定」。
 *   ★ 本件**不参与计数**:条数与各类目数以 `diffPreview` 的读数为准(同一口径一种实现)。
 */
export function admitOf(action, why) {
    const a = txt(action);
    const w = txt(why);
    if (w === 'mapping-needs-confirm') return LORE_ADMIT.MAPPING;
    if (w === 'already-same') return LORE_ADMIT.SAME;
    if (w === 'dangling-source') return LORE_ADMIT.DANGLING;
    if (w === 'confirmed-by-player' || w === 'undecided') return LORE_ADMIT.CONFLICT;
    if (w === 'target-absent' || (a === 'add' && !w)) return LORE_ADMIT.ADD;
    return '';
}

/** 逐条判定一行(**五态各句**;读不出的那一态也不许冒充任何一态)。 */
export function admitLineOf(verdict) {
    switch (txt(verdict)) {
        case LORE_ADMIT.ADD: return '可入(账里没有这一条)';
        case LORE_ADMIT.SAME: return '同值(已有一样的,不必再写)'; 
        case LORE_ADMIT.CONFLICT: return '冲突(默认不覆盖,要覆盖得显式列出)'; 
        case LORE_ADMIT.MAPPING: return '同名待认(未裁决不合并)'; 
        case LORE_ADMIT.DANGLING: return '来源悬空(来源账里没有这一处)'; 
        default: return '未判判定(' + txt(verdict) + ')—— 上游给的这一对组合本件认不出';
    }
}

/** 某阶段的一行读数(视图那一屏;**各态各句**,压平即错读数)。 */
export function loreStageLine(stage, read) {
    const r = (read && typeof read === 'object') ? read : null;
    const st = txt(stage);
    if (!r) return st + ':读不到';
    if (r.state === LORE_FACE_STATES.ENGINE_ABSENT) return st + ':插件不在场';
    if (r.state === LORE_FACE_STATES.FACE_ABSENT) return st + ':本版插件没有这一面';
    if (r.state === LORE_FACE_STATES.UNUSABLE) return st + ':读不出(' + txt(r.faceReason) + ')';
    if (st === 'parse') {
        if (r.state === LORE_FACE_STATES.BLOCKED && r.faceReason === 'source-truncated') {
            return '解析:资料被截断(' + readNum(r.completeness && r.completeness.readChars, 0) + '/'
                + (r.completeness && r.completeness.totalChars !== null ? readNum(r.completeness.totalChars, 0) : '?')
                + ' 字符)—— 请用「选范围逐段导入」,不要整篇硬导';
        }
        if (r.state === LORE_FACE_STATES.BLOCKED) return '解析:空源(这份资料没有正文)';
        if (r.state === LORE_FACE_STATES.EMPTY) return '解析:读了、切了、没有可用段';
        const cls = arr(r.classRows).map(function (x) { return (txt(x.label) || txt(x.cls)) + readNum(x.count, 0); }).join('/');
        /* ★ 窗口读必须说清「读的是全文件哪一段、还有没有下一段」:
         *   首版这一行只报段数 ⇒ 用「选范围逐段读」读了 4000/420000 字符的那一次,
         *   与「整篇读完了」在读数上**完全同形** —— 用户会以为尾章事实已经进来了。 */
        const w = (r.window && typeof r.window === 'object') ? r.window : null;
        let winLine = '';
        if (w) {
            const tot = (r.completeness && r.completeness.totalChars !== null && r.completeness.totalChars !== undefined)
                ? '/' + readNum(r.completeness.totalChars, 0) : '';
            winLine = ' ｜ 窗口 ' + readNum(w.from, 0) + '-' + readNum(w.to, 0) + tot
                + (bool(w.hasNext) ? ' · 还有下一段(读完请接着选范围)' : ' · 全文读完');
        }
        return '解析:段 ' + readNum(r.classTotal, 0) + ' · ' + cls + winLine;
    }
    if (st === 'entities') {
        if (!bool(r.checked)) return '映射:未判(没给已登记实体名单)—— 不是「没有同名」';
        return '映射:查了 ' + (readNum(r.exact, 0) + readNum(r.needsConfirm, 0) + readNum(r.unresolved, 0))
            + ' · 直接 ' + readNum(r.exact, 0) + ' · 待认 ' + readNum(r.needsConfirm, 0) + ' · 无命中 ' + readNum(r.unresolved, 0);
    }
    if (st === 'preview') {
        let s = '预览:' + txt(r.verdict) + ' · 可入 ' + readNum(r.add, 0) + ' · 同值 ' + readNum(r.same, 0)
            + ' · 冲突 ' + readNum(r.conflict, 0) + ' · 映射待认 ' + readNum(r.mapping, 0) + ' · 跳过 ' + readNum(r.skipped, 0);
        /* ★ 两个「未判」必须说出口(档头口径 1)。 */
        if (!bool(r.confirmedChecked)) s += ' ｜ 已确认面未判';
        if (!bool(r.knownRefsChecked)) s += ' ｜ 来源账未判';
        return s;
    }
    if (st === 'plan') {
        if (!bool(r.ok)) return '计划:出不来(' + txt(r.reason) + ')';
        if (bool(r.duplicate)) return '计划:这份资料已经落过了(幂等键 ' + txt(r.importId) + ')—— 不会重复导入';
        if (!readNum(r.count, 0)) return '计划:没有可落的段(全部被跳过)';
        return '计划:将落 ' + readNum(r.count, 0) + ' 段(共 ' + readNum(r.total, 0) + ')· 幂等键 ' + txt(r.importId) + ' · **只算不写**';
    }
    if (st === 'apply') {
        if (bool(r.duplicate)) return '落笔:重复提交 —— 一个字都没写(上游幂等)';
        if (!bool(r.ok)) return '落笔:没落成(' + txt(r.reason) + ')';
        const rb = (r.readback === null) ? '未尝试' : (bool(r.readback) ? '是' : '否');
        const pd = (r.persisted === null) ? '未尝试' : (bool(r.persisted) ? '是' : '否');
        return '落笔:已写 ' + readNum(r.applied, 0) + ' 段 · 核验 ' + readNum(r.verified, 0)
            + ' · 落盘 ' + pd + ' · 回读 ' + rb;
    }
    if (st === 'ledger') {
        if (!readNum(r.seen, 0)) return '导入账:还没落过任何资料(重开也是这个读数)';
        return '导入账:已落 ' + readNum(r.seen, 0) + ' 篇 · ' + readNum(r.chars, 0) + ' 字符'
            + ' · 人工决定 ' + readNum(r.decisions, 0) + ' 条(重启后仍在)';
    }
    return st + ':' + txt(r.state);
}

/** 全部阶段的一行读数(视图/诊断共用;缺哪一段就少一行,不补空行)。 */
export function loreJourneyLines(stageReads) {
    const m = (stageReads && typeof stageReads === 'object') ? stageReads : {};
    const out = [];
    for (const s of LORE_STAGES) if (m[s]) out.push(loreStageLine(s, m[s]));
    return out;
}

/** 判据自证(十四项)。 */
export function loreSelfCheck() {
    const problems = [];
    const states = Object.keys(LORE_FACE_STATES).map(function (k) { return LORE_FACE_STATES[k]; });
    if (new Set(states).size !== states.length) problems.push('面状态各格必须互不相同');
    if (LORE_FACE_STATES.UNUSABLE === LORE_FACE_STATES.BLOCKED) problems.push('「读不出」与「读得出但不能落」必须不同形');
    if (LORE_FACE_STATES.EMPTY === LORE_FACE_STATES.BLOCKED) problems.push('「确实没有段」与「空源」必须不同形');
    if (LORE_FACE_STATES.FACE_ABSENT === LORE_FACE_STATES.ENGINE_ABSENT) problems.push('「没有这一面」与「插件不在场」必须不同形');

    /* 一 派发相:严格判 true,三种组合三种结果。 */
    if (planLoreOutlet(true, true) !== LORE_OUTLETS.FULL) problems.push('两面都在应给完整旅程');
    if (planLoreOutlet(true, false) !== LORE_OUTLETS.PREVIEW_ONLY) problems.push('只有预览面应给「只能看不能落」');
    if (planLoreOutlet(false, true) !== LORE_OUTLETS.NONE) problems.push('没有解析面时落笔口无从谈起');
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        if (planLoreOutlet(bad, true) !== LORE_OUTLETS.NONE) problems.push('派发相必须严格判 true:' + String(bad));
    }
    /* 派发探测口与派发相同源(出口名只许在本件出现)。 */
    const pNone = loreOutletProbe(null);
    if (pNone.hasParse !== false || pNone.hasApply !== false) problems.push('没有插件时两个探测口都必须是 false');
    if (planLoreOutlet(pNone.hasParse, pNone.hasApply) !== LORE_OUTLETS.NONE) problems.push('没有插件时派发相必须是 none');
    const pBoth = loreOutletProbe({ LonShaMemory: { loreImportParse: function () {}, loreImportApply: function () {} } });
    if (planLoreOutlet(pBoth.hasParse, pBoth.hasApply) !== LORE_OUTLETS.FULL) problems.push('两面在场时派发相应是完整旅程');
    const pOnly = loreOutletProbe({ LonShaMemory: { loreImportParse: function () {} } });
    if (planLoreOutlet(pOnly.hasParse, pOnly.hasApply) !== LORE_OUTLETS.PREVIEW_ONLY) problems.push('只有解析面时应是「只能看不能落」');

    /* 二 「未判」与「没有」必须不同句(本面最贵的一对)。 */
    const notChecked = readLoreEntities(null, {}, {});
    if (notChecked.checked !== false) problems.push('没给清单时必须报未判');
    const l1 = loreStageLine('entities', Object.assign({}, notChecked, { state: LORE_FACE_STATES.OK }));
    const l2 = loreStageLine('entities', Object.assign({}, notChecked, { state: LORE_FACE_STATES.OK, checked: true }));
    if (l1 === l2) problems.push('「映射未判」与「查了零命中」必须不同句');
    if (l1.indexOf('未判') < 0) problems.push('未判必须写在读数里:' + l1);
    const pvNoFlag = { state: LORE_FACE_STATES.OK, verdict: 'ok', add: 3, same: 0, conflict: 0, mapping: 0, skipped: 0, confirmedChecked: false, knownRefsChecked: false };
    const pvChecked = Object.assign({}, pvNoFlag, { confirmedChecked: true, knownRefsChecked: true });
    const p1 = loreStageLine('preview', pvNoFlag);
    const p2 = loreStageLine('preview', pvChecked);
    if (p1 === p2) problems.push('「已确认面未判」与「无冲突」必须不同句');
    if (p1.indexOf('已确认面未判') < 0) problems.push('已确认面未判必须写在读数里:' + p1);

    /* 三 「重复导入」与「这次没写」不同句。 */
    const dup = { state: LORE_FACE_STATES.OK, ok: true, duplicate: true, count: 0, total: 4, importId: 'li_x', reason: 'duplicate-import' };
    const nothing = { state: LORE_FACE_STATES.OK, ok: true, duplicate: false, count: 0, total: 4, importId: 'li_y', reason: 'nothing-to-apply' };
    const d1 = loreStageLine('plan', dup);
    const d2 = loreStageLine('plan', nothing);
    if (d1 === d2) problems.push('「已落过」与「没东西可落」必须不同句');
    if (d1.indexOf('不会重复导入') < 0) problems.push('重复导入必须说清不会重复写:' + d1);
    const a1 = loreStageLine('apply', { state: LORE_FACE_STATES.OK, ok: true, duplicate: true, applied: 0, verified: 0, persisted: false, readback: false, reason: 'duplicate-import' });
    if (a1.indexOf('一个字都没写') < 0) problems.push('重复提交的落笔读数必须说清一个字都没写:' + a1);

    /* 四 「截断」与「空」不同句。 */
    const t1 = loreStageLine('parse', { state: LORE_FACE_STATES.BLOCKED, faceReason: 'source-truncated', completeness: { readChars: 400000, totalChars: 420000 } });
    const t2 = loreStageLine('parse', { state: LORE_FACE_STATES.BLOCKED, faceReason: 'empty-source' });
    const t3 = loreStageLine('parse', { state: LORE_FACE_STATES.EMPTY, faceReason: 'no-sections' });
    if (t1 === t2 || t2 === t3 || t1 === t3) problems.push('截断 / 空源 / 无可用段三者必须三句不同');
    if (t1.indexOf('选范围') < 0) problems.push('截断必须给出正确处置(选范围):' + t1);

    /* 四之二 窗口读与整篇读不同句(首版两者同形)。 */
    const wRead = {
        state: LORE_FACE_STATES.OK, classTotal: 2, classRows: [{ cls: 'setting-rule', count: 2, label: '' }],
        completeness: { totalChars: 420000, readChars: 4000 }, window: { from: 0, to: 4000, chars: 4000, hasNext: true }
    };
    const wLine = loreStageLine('parse', wRead);
    const nLine = loreStageLine('parse', Object.assign({}, wRead, { window: null }));
    if (wLine === nLine) problems.push('窗口读与整篇读必须不同句(否则用户看不出还有下一段):' + wLine);
    if (wLine.indexOf('还有下一段') < 0) problems.push('窗口读数必须说清还有下一段:' + wLine);
    if (wLine.indexOf('420000') < 0) problems.push('窗口读数必须给出全文件长度作分母:' + wLine);
    const wLast = loreStageLine('parse', Object.assign({}, wRead, { window: { from: 4000, to: 420000, chars: 416000, hasNext: false } }));
    if (wLast.indexOf('全文读完') < 0) problems.push('读到尾必须与「还有下一段」不同句:' + wLast);

    /* 四之三 逐条判定五态各句,且认不出的组合不许冒充任何一态。 */
    const five = [LORE_ADMIT.ADD, LORE_ADMIT.SAME, LORE_ADMIT.CONFLICT, LORE_ADMIT.MAPPING, LORE_ADMIT.DANGLING];
    const adm = five.map(admitLineOf);
    if (new Set(adm).size !== 5) problems.push('逐条判定五态必须各不相同:' + adm.join('|'));
    for (const l of adm) if (!l) problems.push('判定行不许为空');
    if (adm.indexOf(admitLineOf('whatever')) >= 0) problems.push('认不出的判定不许冒充任何一态');
    if (admitLineOf('whatever').indexOf('未判') < 0) problems.push('认不出的判定必须说未判');
    if (admitOf('skip', 'already-same') !== LORE_ADMIT.SAME) problems.push('同值必须译成 same');
    if (admitOf('skip', 'mapping-needs-confirm') !== LORE_ADMIT.MAPPING) problems.push('映射待认必须译成 mapping');
    if (admitOf('skip', 'undecided') !== LORE_ADMIT.CONFLICT) problems.push('未决冲突必须译成 conflict');
    if (admitOf('dangling', 'dangling-source') !== LORE_ADMIT.DANGLING) problems.push('来源悬空必须译成 dangling');
    if (admitOf('add', 'target-absent') !== LORE_ADMIT.ADD) problems.push('目标缺席必须译成 add');
    if (admitOf('', '') !== '') problems.push('认不出的组合必须如实给空(不许猜一态)');

    /* 五 「没尝试」与「试了失败」不同句。 */
    const nullTry = loreStageLine('apply', { state: LORE_FACE_STATES.OK, ok: true, duplicate: false, applied: 2, verified: 2, persisted: null, readback: null });
    const failed = loreStageLine('apply', { state: LORE_FACE_STATES.OK, ok: true, duplicate: false, applied: 2, verified: 2, persisted: false, readback: false });
    if (nullTry === failed) problems.push('「没尝试落盘」与「落盘失败」必须不同句');

    /* 六 类目行是**翻译**不是重算:计数之和必须等于段数(上游两者同源)。 */
    const rows = classRowsOf({ 'setting-rule': 2, 'backstory-event': 1 }, []);
    const sum = rows.reduce(function (a, x) { return a + readNum(x.count, 0); }, 0);
    if (sum !== 3) problems.push('类目行计数之和应等于上游给的段数');
    if (rows[0].cls !== 'setting-rule') problems.push('类目行必须保持上游给的顺序(不重排)');
    const withLabel = classRowsOf({ 'a': 1 }, [{ cls: 'a', clsLabel: '甲类' }]);
    if (withLabel[0].label !== '甲类') problems.push('标签优先取上游给的 clsLabel');
    const noLabel = classRowsOf({ 'zz': 1 }, []);
    if (noLabel[0].label !== '') problems.push('上游没给标签时不许自己编一个中文');

    /* 六之三 窗口读**不是**截断(本版自抓缺陷的判据落点)。
     *   两者上游都给 completeness.state='partial',但 source.truncated 只有真截断才是 true。
     *   压平的后果:一次正常的「接着读下一段」被谎报成「资料被截断」,用户被赶去
     *   重新点一个自己刚做过的动作 —— 不报错,只是把成功说成失败。 */
    const wTrunc = { ok: true, source: { file: 'f', chars: 4000, lines: 10, truncated: false }, completeness: { state: 'partial', totalChars: 420000, readChars: 4000, truncated: false, nextCursor: 4000 }, sections: [1], items: [1], classes: {}, window: { from: 0, to: 4000, chars: 4000, hasNext: true } };
    const wTruncRead = readLoreParseFromRaw(wTrunc);
    if (wTruncRead.state !== LORE_FACE_STATES.OK) problems.push('窗口读(还有下一段)应报 ok,不报截断:' + String(wTruncRead.state));
    if (wTruncRead.faceReason === 'source-truncated') problems.push('窗口读不得被读成 source-truncated');
    const realTrunc = { ok: false, source: { file: 'f', chars: 400000, lines: 9000, truncated: true }, completeness: { state: 'partial', totalChars: 420000, readChars: 400000, truncated: true, nextCursor: 400000 }, sections: [1], items: [1], classes: {}, why: ['source-truncated'] };
    const realRead = readLoreParseFromRaw(realTrunc);
    if (realRead.state !== LORE_FACE_STATES.BLOCKED || realRead.faceReason !== 'source-truncated') problems.push('真截断必须照样报截断(否则上一句是假绿)');
    if (loreStageLine('parse', wTruncRead) === loreStageLine('parse', realRead)) problems.push('「还有下一段」与「资料被截断」必须不同句');

    /* 七 空件与异常:如实报,不抛。 */
    if (readLoreParse(null, '', {}).state !== LORE_FACE_STATES.ENGINE_ABSENT) problems.push('插件不在场应报 engine-absent');
    if (readLoreDescribe(null).state !== LORE_FACE_STATES.ENGINE_ABSENT) problems.push('自述面缺席应报 engine-absent');
    if (loreStageLine('parse', null) !== 'parse:读不到') problems.push('空读数应读成「读不到」');
    if (arr(pickableClassesOf(null)).length !== 0) problems.push('没有自述时选项表应为空(不编一份类目表)');

    return { problems: problems, states: states.length, outlets: Object.keys(LORE_OUTLETS).length, stages: LORE_STAGES.length };
}

export default {
    LORE_FACE_STATES,
    LORE_OUTLETS,
    LORE_ADMIT,
    LORE_STAGES,
    LORE_LIMITS,
    planLoreOutlet,
    loreOutletProbe,
    admitOf,
    admitLineOf,
    readLoreDescribe,
    pickableClassesOf,
    readLoreParse,
    readLoreParseWindow,
    readLoreEntities,
    readLorePreview,
    readLorePlan,
    readLoreOverride,
    readLoreConfirmMapping,
    readLoreChanged,
    readLoreApply,
    readLoreLedger,
    loreFaceLine,
    loreStageLine,
    loreJourneyLines,
    loreSelfCheck
};
