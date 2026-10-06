/* ============================================================
 * branch-contrast.js — [v3.62.0 · X8 第一切片] 分支对照工作区内核
 *                                  （**只读**：选两分支 → 看语义变化）
 * ------------------------------------------------------------
 * 【为什么需要它 / 修前实测后果（不是整洁性偏好）】
 *   X8 原文：「把『上次停在哪→未了事项→相关证据→回到 App/出处』收成首页续玩卡。用户选两分支时
 *   呈现**角色状态、约定、财务和剧情时间的语义变化**；恢复前展示影响、缺面和会话身份，
 *   恢复只委托真实宿主/引擎 owner。**先完成只读导航，再推进受控恢复交接**。」
 *
 *   本仓实测：四样语义面**各有真源**，但没有任何一处把「选两分支 → 这四样各变成什么样」收成一条读数：
 *     · 「角色状态 / 约定 / 财务」→ 上游检查点的 payload 内容级对照（`checkpoint-content-contract.js`
 *       已把 `compareBranchCheckpointsDeep` 归一成恒定键面，但只给「键面 + 原始 deep」，
 *       **没有把 payload 映射成语义组**）；
 *     · 「剧情时间」→ `config/story-clock.js` 的 `floorCount` / 当前楼；
 *     · 「删楼影响」→ `config/rollback-preview.js` 的 `previewRollback`（只算不执行）；
 *     · 「上次停哪」→ `config/resume-brief.js` 的分节模型。
 *   代价：用户在两分支之间**无从比较**「换个分支，我的约定/钱/时间会变成什么」，
 *   只能各自打开一遍页面靠眼睛对 —— 而这四样恰好都是**语义化**的（约定五态、财务正负、
 *   时间锚点），靠肉眼对账最容易把「未知」读成「没有」。
 *
 * 【本模块只做三件事】
 *   ① **归组**：把上游 payload 的键面差异按**语义组**（character / commitment / finance /
 *      storyTime）归类，每组给出「A 有 B 无 / B 有 A 无 / 值变了」三类行，全部**可回源**
 *      （每行带原始键路径，UI 可点回出处）；
 *   ② **隔离**：**分支 A 的秘密不得进入 B 的读数** —— 每组的每一行都带 `owner`（来自哪一支），
 *      且 `cross=` 字段显式声明「这一行是否属于另一支的秘密面」；秘密面判定走**调用方给的口径**
 *      （`opts.secretKeys`），本模块不猜哪些键是秘密；
 *   ③ **三态**：未知（读不到）与空（真的没有）**必须不同形** —— 沿用本仓最贵的老账口径。
 *
 * 【不做什么（边界，防第二份真源）】
 *   · **不做取数**：上游出口、上层 payload、秘密口径全部由调用方给（与 `resume-brief.js` 同一分工）；
 *   · **不重算差异**：内容级差异的唯一实现在上游 `diffPayloadsDeep`（经
 *     `checkpoint-content-contract.js` 转发），本模块只把它的读数**归组**，不另写一份比对；
 *   · **不做恢复**：本模块**只读**，不含任何写面（`APPLY_STATES` 里 `applied` 恒为 `false`）；
 *     真正的恢复委托真实宿主/引擎 owner（X8 原文「恢复只委托真实宿主/引擎 owner」）；
 *   · **不读时钟、不读存储、不带计时器**：纯函数（`at` 由调用方给），可在合成输入上复算。
 * ============================================================ */
export const CONTRAST_VERSION = 1;

/** 语义组（X8 原文点名的四样；顺序固定，UI 可直接按此渲染）。 */
export const CONTRAST_GROUPS = Object.freeze(['character', 'commitment', 'finance', 'storyTime']);

/** 每组的**键面归属规则**（唯一真源：改这里即四组同时对齐）。
 *  刻意用前缀/关键词而非精确键名 —— 上游 payload 的键名随版本演进，
 *  精确键名清单会把「上游加了一个新键」变成「这个键从四组里消失了」。 */
export const GROUP_RULES = Object.freeze({
    character: { prefixes: ['char', 'character', 'person', 'npc', 'actor'], keywords: ['角色', '人物', 'npc'] },
    commitment: { prefixes: ['commit', 'promise', 'appoint', 'appointment', 'contract'], keywords: ['约定', '承诺', '约会', '履约'] },
    finance: { prefixes: ['finance', 'money', 'wallet', 'balance', 'account', 'currency', 'ledger'], keywords: ['财务', '余额', '账户', '钱', '流水'] },
    storyTime: { prefixes: ['clock', 'time', 'storyclock', 'timeline', 'day', 'date', 'floor'], keywords: ['时间', '剧情时间', '日历', '楼层'] }
});

/** 三态（本仓最贵的老账：缺席与空必须不同形）。 */
export const CONTRAST_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 恢复应用状态：本模块只读 ⇒ `applied` 恒 false，且带归因。 */
export const APPLY_STATES = Object.freeze({
    READ_ONLY: 'read-only',
    REFUSED_STALE: 'refused-stale',
    REFUSED_NO_OWNER: 'refused-no-owner',
    REFUSED_SAME_GENERATION: 'refused-same-generation'
});

/* ---------- 小工具（不引依赖：本仓零运行时依赖） ---------- */

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 取「最后一段键名」用于归组：`a.b.c` ⇒ `c`（大小写不敏感）。 */
function leafName(keyPath) {
    const s = String(keyPath == null ? '' : keyPath);
    const i = s.lastIndexOf('.');
    return (i >= 0 ? s.slice(i + 1) : s).toLowerCase();
}

/** 该键路径归入哪个语义组；归不进任何组时返回 null（如实：不硬塞）。 */
export function groupOfKey(keyPath) {
    const leaf = leafName(keyPath);
    if (!leaf) return null;
    for (const g of CONTRAST_GROUPS) {
        const rule = GROUP_RULES[g];
        for (const p of rule.prefixes) {
            if (leaf === p || leaf.startsWith(p)) return g;
        }
        for (const k of rule.keywords) {
            if (leaf.indexOf(k) >= 0) return g;
        }
    }
    return null;
}

/** 秘密面判定：`opts.secretKeys` 给的名单（前缀或全名），本模块**不猜**。
 *  名字匹配按「键路径的叶子名」比，与 `groupOfKey` 同口径。 */
function isSecretKey(keyPath, secretKeys) {
    if (!Array.isArray(secretKeys) || !secretKeys.length) return false;
    const leaf = leafName(keyPath);
    for (const s of secretKeys) {
        const t = String(s == null ? '' : s).toLowerCase();
        if (!t) continue;
        if (leaf === t || leaf.startsWith(t)) return true;
    }
    return false;
}

/** 值的人类可读摘要（只用于 UI 呈现，不做判定；深度截断防爆）。 */
function brief(v, depth = 0) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    const t = typeof v;
    if (t === 'string') return v.length > 40 ? (v.slice(0, 40) + '…') : v;
    if (t === 'number' || t === 'boolean') return String(v);
    if (Array.isArray(v)) return '[' + v.length + ' 项]';
    if (t === 'object') {
        if (depth >= 1) return '{…}';
        return '{' + Object.keys(v).length + ' 键}';
    }
    return String(v);
}

/**
 * 分支对照主入口（**纯函数**，只读）。
 *
 * @param {object} input
 *   · `win`        宿主窗口（用于取上游只读出口；缺省时引擎面归因缺席）
 *   · `chatId`     会话身份（同一代会话；X8 验收「读数来自同一代会话」）
 *   · `nameA` / `nameB`  两个分支检查点名（A 为基准）
 *   · `payloadA` / `payloadB`  调用方取好的两支 payload（缺省时走上游出口）
 *   · `secretKeys` 秘密键名单（调用方口径；**缺省＝不隔离**，并在 why 里明说）
 *   · `generation` 会话代际（X8 验收「旧异步写入被拒」的依据）
 *   · `at`         时间戳（由调用方给，本模块不读时钟）
 * @returns 恒定键面读数
 */
export function branchContrast(input = {}) {
    const o = isPlainObject(input) ? input : {};
    const nameA = String(o.nameA == null ? '' : o.nameA);
    const nameB = String(o.nameB == null ? '' : o.nameB);
    const secretKeys = Array.isArray(o.secretKeys) ? o.secretKeys : null;

    const out = {
        version: CONTRAST_VERSION,
        ts: (typeof o.at === 'number' ? o.at : 0),
        state: CONTRAST_STATES.OK,
        reason: '',
        applied: false,
        applyState: APPLY_STATES.READ_ONLY,
        applyHint: '本模块只读：恢复是**显式动作**，委托真实宿主/引擎 owner',
        names: { a: nameA, b: nameB },
        samePair: (nameA === nameB),
        sealed: !!(Array.isArray(o.secretKeysA) || Array.isArray(o.secretKeysB)),
        secretCount: (Array.isArray(o.secretKeysA) ? o.secretKeysA.length : 0)
            + (Array.isArray(o.secretKeysB) ? o.secretKeysB.length : 0),
        groups: null,
        unknownKeys: null,             // 归不进四组的键（如实单列，不硬塞）
        diffState: '',
        diffReason: '',
        why: ''
    };

    /* 同一对分支不构成对照（与上游「A≠B」同口径，早退并归因）。 */
    if (!nameA || !nameB) {
        out.state = CONTRAST_STATES.UNUSABLE;
        out.reason = 'missing-names';
        out.why = '缺分支名（A / B 都必填）⇒ 不给对照（不可测≠通过）';
        return out;
    }
    if (nameA === nameB) {
        out.state = CONTRAST_STATES.EMPTY;
        out.reason = 'same-pair';
        out.why = 'A 与 B 是同一支 ⇒ 对照无意义（这不是「没有差异」，是「比错了」）';
        return out;
    }

    /* 取内容级差异：优先用调用方给的 payload；否则走上游只读出口（唯一真源）。 */
    let deep = null;
    /* 【真缺陷修复（首跑 D2 抓到）】`deep-unavailable` 半成功时 `deep` 为 null，
     *   若直接落到 payload 分支会拿 undefined 去做 Object.keys ⇒ 抛错。
     *   故这里显式跟踪「差异是否来自 payload」：只有真的给了两支 payload 才走 payload 分支。 */
    const fromPayload = isPlainObject(o.payloadA) && isPlainObject(o.payloadB);
    if (fromPayload) {
        deep = null;   // payload 分支：差异由下面 keysOf 直接算，不冒充上游口径
    } else {
        let contract = null;
        try {
            /* 动态 import 在纯函数里不可用 ⇒ 由调用方注入（`o.readDiff`）。
             *   本模块**不自带** import：那会把「上游在不在」变成模块级副作用。 */
            if (typeof o.readDiff === 'function') contract = o.readDiff(o.win, nameA, nameB, o.chatId);
        } catch (_e) { contract = null; }
        if (!contract || typeof contract !== 'object') {
            out.state = CONTRAST_STATES.FACE_ABSENT;
            out.reason = 'no-diff-source';
            out.why = '既未给 payloadA/B，也未给 readDiff 注入 ⇒ 读不到差异（缺席，不是「无差异」）';
            out.unknownKeys = null;
            return out;
        }
        out.diffState = String(contract.state || '');
        out.diffReason = String(contract.reason || '');
        if (contract.state !== 'readable') {
            out.state = CONTRAST_STATES.ENGINE_ABSENT;
            out.reason = 'diff-unreadable:' + out.diffReason;
            out.why = '上游对照面读不到（' + out.diffReason + '）⇒ 由**上游**归因，本模块不重算';
            out.unknownKeys = null;
            return out;
        }
        deep = isPlainObject(contract.deep) ? contract.deep : null;
        if (!deep) {
            /* 上游 `deep-unavailable` 是半成功：键面照给、内容级没有 —— 不得与「内容一样」同形。 */
            out.state = CONTRAST_STATES.EMPTY;
            out.reason = 'deep-unavailable';
            out.why = '上游给到键面但**未下钻**内容级 ⇒ 本模块只能报「哪些键在/不在」，值级差异未知';
        }
    }

    /* 差异来源：上游 deep（changes/sets）或调用方 payload 直比。 */
    let onlyInA = [], onlyInB = [], shared = [], changes = [], sets = [];
    if (!fromPayload && deep) {
        onlyInA = Array.isArray(deep.onlyInA) ? deep.onlyInA : [];
        onlyInB = Array.isArray(deep.onlyInB) ? deep.onlyInB : [];
        shared = Array.isArray(deep.shared) ? deep.shared : [];
        changes = Array.isArray(deep.changes) ? deep.changes : [];
        sets = Array.isArray(deep.sets) ? deep.sets : [];
    } else {
        /* payload 直比：**只在真给了两支 payload 时**（`fromPayload`）。
         *   `deep-unavailable` 半成功时 `fromPayload=false` 且 `deep=null` ⇒ 这里是空集，
         *   由下面的 `state=empty + reason=deep-unavailable` 如实归因（不冒充「无差异」）。 */
        const A = isPlainObject(o.payloadA) ? o.payloadA : null;
        const B = isPlainObject(o.payloadB) ? o.payloadB : null;
        if (A && B) {
            const ka = Object.keys(A), kb = Object.keys(B);
            onlyInA = ka.filter((k) => !Object.prototype.hasOwnProperty.call(B, k));
            onlyInB = kb.filter((k) => !Object.prototype.hasOwnProperty.call(A, k));
            shared = ka.filter((k) => Object.prototype.hasOwnProperty.call(B, k));
            for (const k of shared) {
                const va = A[k], vb = B[k];
                const same = (va === vb) || (JSON.stringify(va) === JSON.stringify(vb));
                /* 值不同的才进 changes；相同的**不入面**（面只记变化，减少噪声）。 */
                if (!same) changes.push({ path: k, a: va, b: vb });
            }
        }
    }

    /* ---- 归组 ---- */
    const groups = {};
    for (const g of CONTRAST_GROUPS) {
        groups[g] = { id: g, rows: [], counts: { onlyA: 0, onlyB: 0, changed: 0 }, state: CONTRAST_STATES.EMPTY };
    }
    const unknown = [];

    const push = (keyPath, kind, payload) => {
        const g = groupOfKey(keyPath);
        const secret = isSecretKey(keyPath, secretKeys);
        const row = Object.assign({
            path: String(keyPath == null ? '' : keyPath),
            kind: kind,                      // onlyA / onlyB / changed
            group: g,
            secret: secret,
            /* owner：这一行**来自哪一支**。`both` = 两侧共有（值变）。 */
            owner: (kind === 'onlyA' ? 'a' : (kind === 'onlyB' ? 'b' : 'both'))
        }, payload || {});
        if (!g) { unknown.push(row); return; }
        groups[g].rows.push(row);
        if (kind === 'onlyA') groups[g].counts.onlyA++;
        else if (kind === 'onlyB') groups[g].counts.onlyB++;
        else groups[g].counts.changed++;
    };

    for (const k of onlyInA) push(k, 'onlyA', {});
    for (const k of onlyInB) push(k, 'onlyB', {});
    for (const c of changes) {
        const p = (isPlainObject(c) ? (c.path == null ? c.key : c.path) : c);
        push(p, 'changed', {
            a: brief(isPlainObject(c) ? c.a : undefined),
            b: brief(isPlainObject(c) ? c.b : undefined)
        });
    }
    /* sets：上游把「集合内容变了」单列（与 `changes` 分开）—— 归组后按 changed 计。 */
    for (const s of sets) {
        const p = (isPlainObject(s) ? (s.path == null ? s.key : s.path) : s);
        push(p, 'changed', { a: brief(isPlainObject(s) ? s.a : undefined), b: brief(isPlainObject(s) ? s.b : undefined) });
    }

    for (const g of CONTRAST_GROUPS) {
        const gg = groups[g];
        const n = gg.rows.length;
        gg.state = (n > 0) ? CONTRAST_STATES.OK : CONTRAST_STATES.EMPTY;
    }

    out.groups = groups;
    out.unknownKeys = unknown;
    out.totalRows = CONTRAST_GROUPS.reduce((a, g) => a + groups[g].rows.length, 0);
    out.unknownRows = unknown.length;

    /* 跨分支隔离判定：A 的秘密不得出现在 B（X8 核心验收点）。
     *   口径按支给：`secretKeysA` / `secretKeysB`；未给任一名单时**不判定**（未核对≠已通过）。 */
    out.crossLeak = countLeak(groups, o.secretKeysA, o.secretKeysB);

    if (out.totalRows === 0 && unknown.length === 0) {
        out.state = CONTRAST_STATES.EMPTY;
        out.reason = out.reason || 'no-difference';
        out.why = out.why || '两支在四组语义面上无差异（这是**真读数**：比过了、确实一样）';
    } else if (!out.why) {
        out.why = '四组语义面共 ' + out.totalRows + ' 行差异'
            + (unknown.length ? ('，另有 ' + unknown.length + ' 个键归不进四组（如实单列，不硬塞）') : '')
            + (out.sealed ? '' : '；**未给秘密口径 ⇒ 本次不做跨支隔离**（未隔离≠已隔离）');
    }
    return out;
}

/** 跨支泄漏判定（X8 核心验收点「分支 A 的秘密不进入 B」）。
 *
 *  【口径】泄漏 ＝ 某一行**只出现在 B 侧**（`owner==='b'`，即 A 里没有），
 *    且该行的键属于 **A 的秘密面**（`secretKeysA`）—— 这意味着「A 支才知道的秘密」
 *    出现在了 B 支的读数里。
 *  反之（`owner==='a'` 且键属于 `secretKeysB`）同样计一次。
 *
 *  【为什么不在这里猜】秘密名单由调用方按支给出（`secretKeysA` / `secretKeysB`）；
 *    未给任一名单时本函数**不判定**（`checked:false`），并如实说明
 *    「未核对≠已核对通过」——这正是本仓最贵的老账（缺席与空不同形）。
 *
 *  @returns {{checked:boolean, leaks:number, items:Array, why:string}}
 */
export function countLeak(groups, secretKeysA, secretKeysB) {
    const aList = Array.isArray(secretKeysA) ? secretKeysA : null;
    const bList = Array.isArray(secretKeysB) ? secretKeysB : null;
    const secretRows = [];
    for (const g of CONTRAST_GROUPS) {
        const grp = groups && groups[g];
        if (!grp) continue;
        for (const row of grp.rows) {
            if (!row.secret) continue;
            secretRows.push({ group: g, path: row.path, owner: row.owner });
        }
    }
    if (!aList && !bList) {
        return {
            checked: false,
            leaks: 0,
            items: secretRows,
            why: '未给任一支的秘密名单 ⇒ **未核对**跨支隔离（未核对≠已通过）'
        };
    }
    const items = [];
    for (const g of CONTRAST_GROUPS) {
        const grp = groups && groups[g];
        if (!grp) continue;
        for (const row of grp.rows) {
            /* B 侧独有 且 属于 A 的秘密面 ⇒ 泄漏 */
            if (row.owner === 'b' && isSecretKey(row.path, aList)) {
                items.push({ group: g, path: row.path, kind: 'a-secret-in-b', owner: row.owner });
            }
            /* A 侧独有 且 属于 B 的秘密面 ⇒ 泄漏 */
            if (row.owner === 'a' && isSecretKey(row.path, bList)) {
                items.push({ group: g, path: row.path, kind: 'b-secret-in-a', owner: row.owner });
            }
        }
    }
    return {
        checked: true,
        leaks: items.length,
        items: items,
        why: items.length ? ('检出 ' + items.length + ' 处跨支秘密泄漏') : '已核对：无跨支秘密泄漏'
    };
}

/** 单行文案（UI 直接渲染；三态各自成形，不得与「没有差异」同形）。 */
export function branchContrastLine(c) {
    if (!c || typeof c !== 'object') return '[对照] 读数不可用';
    if (c.state === CONTRAST_STATES.UNUSABLE) return '[对照] 不可比：' + (c.reason || '');
    if (c.state === CONTRAST_STATES.EMPTY && c.reason === 'same-pair') return '[对照] A 与 B 是同一支，比错了';
    if (c.state === CONTRAST_STATES.EMPTY && c.reason === 'deep-unavailable') {
        return '[对照] 上游只给到键面（未下钻内容级）：值级差异**未知**，不是「一样」';
    }
    if (c.state === CONTRAST_STATES.FACE_ABSENT || c.state === CONTRAST_STATES.ENGINE_ABSENT) {
        return '[对照] 读不到差异来源：' + (c.why || c.reason || '');
    }
    const parts = [];
    for (const g of CONTRAST_GROUPS) {
        const gg = c.groups && c.groups[g];
        const n = gg ? gg.rows.length : 0;
        parts.push(g + ':' + n);
    }
    return '[对照] ' + c.names.a + ' ↔ ' + c.names.b + ' — ' + parts.join(' / ')
        + (c.crossLeak && c.crossLeak.checked
            ? ('（已核对隔离：' + (c.crossLeak.leaks ? ('检出 ' + c.crossLeak.leaks + ' 处泄漏') : '无泄漏') + '）')
            : '（**未核对跨支隔离**：未给秘密口径）');
}

export default {
    branchContrast, branchContrastLine, groupOfKey, countLeak,
    CONTRAST_GROUPS, GROUP_RULES, CONTRAST_STATES, APPLY_STATES, CONTRAST_VERSION
};
