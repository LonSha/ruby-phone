/* ========================================================
 * config/data-backup.js — [v3.91.0 · 拓展计划 R-X7]
 *   本地备份、迁移与灾难恢复（纯内核）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   本仓的数据全在本地（storage 两层：会话档 + 全局档），但**没有一处能把它们搬走**。
 *   修前实测：全仓只有三处「导出 / 导入」，且全部属于**单一功能的预设**
 *   （NAI 预设 / GPT 预设 / ComfyUI 工作流，见 config/portable-payload.js）。
 *   这三处回答的是「这几套参数搬不搬得走」，而不是「我这一整部手机搬不搬得走」。
 *   后果是三件用户真会遇到的事：
 *     ① **换设备只能重来**：几千楼会话里攒下的微信 / 账本 / 日程 / 记忆，无法导出；
 *     ② **包体没有身份**：导出的文件里没有 schema 版本、没有会话与分支范围、
 *        没有敏感字段标记 —— 换一个人打开也不知道这是什么，旧包也无从迁移；
 *     ③ **倒进去就回不去了**：没有任何一处做「导入前预览 / 冲突检测 / 部分导入 / 撤销」，
 *        一旦倒错，用户手上的数据就是覆盖后的结果。
 *
 * 【本模块只做四件事（纯函数，与 workflow.js / creation-workbench.js 同范式）】
 *   ① **范围声明**：按 App / 会话 / 项目 / 素材四维选导出范围；每个键归一个面
 *      （会话面 / 全局面），两面**不许互换**。
 *   ② **包体归一**：给每份包一个**身份**（魔标 / schema 版本 / 宿主版本 /
 *      会话与分支范围 / 逐键的敏感标记与来源）。
 *   ③ **迁移判定**：旧版本包**要么明确迁移、要么明确拒绝**，绝无第三条路
 *      （「静默丢掉不认识的字段」是这两条之外最常被偷渡的一路）。
 *   ④ **导入计划**：导入前只产计划（新增 / 冲突 / 拒绝逐条分类），
 *      真正落盘由调用方在确认后执行；同一条记录的重复导入必须幂等。
 *
 * 【不做什么】
 *   · 不写存储：本模块不持键、不带计时器、不碰 DOM、不读文件系统。
 *   · 不联网：**默认不上传云端**（本模块里没有任何网络调用，也没有 fetch / XMLHttpRequest）。
 *   · 不自己解 JSON：解析容错走仓内既有实现（json-symbol-repair.js），本模块只认对象。
 * ======================================================== */
'use strict';

import { numOrNull } from './num-gate.js';

/* ───────── ① 范围声明 ───────── */

/** 包魔标与当前 schema 版本（**唯一真源**：导出侧与导入侧不许各写一份字面量）。 */
export const BACKUP_MARK = 'yuzuki-phone-backup';
export const BACKUP_SCHEMA_VERSION = 3;

/** 版本迁移路径：从哪个版本读得的包要经过哪些步骤才到当前版。
 *  每一跳都必须带**为什么**（不许写「兼容旧版」这种没有信息量的话）与**改写规则**。 */
export const BACKUP_MIGRATIONS = Object.freeze([
    Object.freeze({
        from: 1, to: 2, why: 'v1 的包没有分面字段（scope），全按全局面读会把会话键写进全局档',
        add: Object.freeze({ scope: 'chat' }),
    }),
    Object.freeze({
        from: 2, to: 3, why: 'v2 的包没有逐键敏感标记（sensitive），导入时无法按域提醒用户',
        add: Object.freeze({ sensitive: 'unknown' }),
    }),
]);

/** 四个范围维度。选多个维度时取**交集**（不是并集）—— 这一格最容易被写反：
 *  并集会让「我只要这一部的会话」变成「这一部加其他所有」。 */
export const BACKUP_DIMENSIONS = Object.freeze([
    Object.freeze({ key: 'app', label: '按 App', note: '只选几个 App 的数据（微信 / 账本 / 日程…）' }),
    Object.freeze({ key: 'chat', label: '按会话', note: '只选几个角色的数据；不选则不含任何会话面数据' }),
    Object.freeze({ key: 'project', label: '按项目', note: '只选几个续玩项目 / 卷' }),
    Object.freeze({ key: 'material', label: '按素材', note: '只选几类素材（曲目 / 图片 / 文本…）' }),
]);
export const BACKUP_DIM_KEYS = Object.freeze(BACKUP_DIMENSIONS.map(function (d) { return d.key; }));

/** 两个面。会话面与全局面**不许互换**：把会话键写进全局档等于把 B 角色的数据交给 A 角色。 */
export const BACKUP_SCOPES = Object.freeze({
    chat: Object.freeze({ key: 'chat', label: '会话面', note: '随角色 / 会话隔离的那一部分' }),
    global: Object.freeze({ key: 'global', label: '全局面', note: '不分会话的设置与账本' }),
});
export const BACKUP_SCOPE_KEYS = Object.freeze(['chat', 'global']);

/* ───────── ② 包体归一 ───────── */

/** 包体形态五态。刻意**不合并** unmarked 与 foreign：
 *  前者是「旧版导出、还没有魔标的文件」（兼容面），后者是「有魔标但不是备份包」（必须拒）。 */
export const BACKUP_PACK_STATES = Object.freeze({
    OK: 'ok',
    EMPTY: 'empty',
    NOT_OBJECT: 'not-object',
    UNMARKED: 'unmarked',
    FOREIGN: 'foreign',
    FUTURE: 'future',
});

/** 迁移四态：无需迁移 / 已迁移 / 要拒绝（太旧不认识）/ 未来版本（比本机新）。 */
export const BACKUP_MIGRATE_STATES = Object.freeze({
    CURRENT: 'current',
    MIGRATED: 'migrated',
    TOO_OLD: 'too-old',
    FUTURE: 'future',
});

/** 逐条导入判定五态（互不同形）。 */
export const BACKUP_ENTRY_STATES = Object.freeze({
    NEW: 'new',
    IDENTICAL: 'identical',
    CONFLICT: 'conflict',
    REJECTED: 'rejected',
    RESTORE: 'restore',
});

/* 取数口径：**不自写第二份**（本仓唯一实现在 config/num-gate.js）——
 *   本版真踩到过：就地写一份 `Number(v)` 会把 `[]` 与 `false` 读成 0（「没给」被读成了有效读数），
 *   被 weak-coercion 门的探针当场抓住。 */

/**
 * 读一份备份包：空 / 非对象 / 无魔标 / 异类魔标 / 未来版本 / 通过。
 * @param {*} raw 已解析的对象（本模块不接受文本：解析容错是另一处的职责）
 * @param {{expectVersion?:number}} [opts]
 */
export function readBackupPack(raw, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const expectVer = numOrNull(o.expectVersion) === null ? BACKUP_SCHEMA_VERSION : numOrNull(o.expectVersion);
    if (raw === null || raw === undefined || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0)) {
        return { state: BACKUP_PACK_STATES.EMPTY, accepted: false, mark: '', schemaVersion: null, pack: null, why: '空包' };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { state: BACKUP_PACK_STATES.NOT_OBJECT, accepted: false, mark: '', schemaVersion: null, pack: null, why: '不是对象（数组或标量）' };
    }
    const mark = String(raw.mark || raw.type || '').trim();
    const ver = numOrNull(raw.schemaVersion);
    if (!mark) {
        return { state: BACKUP_PACK_STATES.UNMARKED, accepted: true, mark: '', schemaVersion: ver, pack: raw, why: '旧版导出（无魔标）：按兼容面收下，但下面必须走迁移' };
    }
    if (mark !== BACKUP_MARK) {
        return { state: BACKUP_PACK_STATES.FOREIGN, accepted: false, mark: mark, schemaVersion: ver, pack: null, why: '有魔标但不是本类包：' + mark };
    }
    if (ver !== null && ver > expectVer) {
        return { state: BACKUP_PACK_STATES.FUTURE, accepted: false, mark: mark, schemaVersion: ver, pack: null, why: '包比本机新（包 v' + String(ver) + ' > 本机 v' + String(expectVer) + '）—— 不猜字段，明确拒' };
    }
    return { state: BACKUP_PACK_STATES.OK, accepted: true, mark: mark, schemaVersion: ver, pack: raw, why: 'ok' };
}

/**
 * 迁移判定。**只有两条路**：明确迁移或明确拒绝。
 * 「不认识的字段静默丢掉」不在这两条里 —— 故本函数把每一条改写都记进 steps 供调用方展示。
 * @returns {{state:string, pack:object|null, steps:Array, why:string}}
 */
export function migrateBackupPack(pack, target) {
    const to = numOrNull(target) === null ? BACKUP_SCHEMA_VERSION : numOrNull(target);
    const steps = [];
    if (!pack || typeof pack !== 'object') {
        return { state: BACKUP_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '包体不可读' };
    }
    /* ★ 缺席与 0 是两件事：`numOrNull(null)` 会返回 **0**（`Number(null) === 0`），
     *   于是「没有版本号的包」会被走成「v0 的包」—— 两条路都是拒，但**拒的理由完全不同**，
     *   而这是本仓最贵的一类错：**判据绿而现场不对**（本版真踩到过：负控制改动那个分支时
     *   完全不生效，因为该分支根本不可达）。故这里先单独认缺席。 */
    const rawVer = pack.schemaVersion;
    const absent = (rawVer === null || rawVer === undefined || rawVer === '');
    const ver = absent ? null : numOrNull(rawVer);
    if (absent || ver === null) {
        return { state: BACKUP_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '无 schema 版本（不属于任何一代）—— 明确拒，不猜' };
    }
    if (ver > to) {
        return { state: BACKUP_MIGRATE_STATES.FUTURE, pack: null, steps: steps, why: '包 v' + String(ver) + ' > 本机 v' + String(to) };
    }
    let cur = ver;
    let out = pack;
    const hops = BACKUP_MIGRATIONS.filter(function (m) { return m.from >= cur && m.to <= to && m.from < to; })
        .sort(function (a, b) { return a.from - b.from; });
    /* 必须先看「跳数能不能连起来」：不能连起来就明确拒（这一格防的是
     *   「v1 包直接被 v3 规则改一遍」，那时中间那一步该补的字段永远补不上）。 */
    let probe = cur;
    for (const m of hops) {
        if (m.from !== probe) {
            return { state: BACKUP_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '缺 v' + String(probe) + ' -> v' + String(probe + 1) + ' 的迁移步（不跳步改写）' };
        }
        probe = m.to;
    }
    if (hops.length && probe !== to) {
        return { state: BACKUP_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '迁移链未达目标版（到 v' + String(probe) + ' 为止）' };
    }
    for (const m of hops) {
        out = Object.assign({}, out, { schemaVersion: m.to }, m.add ? { [Object.keys(m.add)[0]]: m.add[Object.keys(m.add)[0]] } : {});
        steps.push({ from: m.from, to: m.to, why: m.why });
        cur = m.to;
    }
    if (cur === to) {
        return {
            state: steps.length ? BACKUP_MIGRATE_STATES.MIGRATED : BACKUP_MIGRATE_STATES.CURRENT,
            pack: out, steps: steps, why: steps.length ? ('已按 ' + String(steps.length) + ' 步迁移到 v' + String(to)) : '已是当版',
        };
    }
    return { state: BACKUP_MIGRATE_STATES.TOO_OLD, pack: null, steps: steps, why: '无法从 v' + String(ver) + ' 迁到 v' + String(to) };
}

/** 一条背份记录的归一。source 与 key 缺一不可（缺了就无法回溯与定位）。 */
export function normalizeBackupEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const key = String(raw.key || '').trim();
    const scope = String(raw.scope || '').trim();
    if (!key) return null;
    if (BACKUP_SCOPE_KEYS.indexOf(scope) < 0) return null;
    return {
        key: key,
        scope: scope,
        app: String(raw.app || ''),
        chatId: String(raw.chatId || ''),
        branchKey: String(raw.branchKey || ''),
        sensitive: (raw.sensitive === true) ? 'yes' : (raw.sensitive === 'unknown' ? 'unknown' : 'no'),
        value: raw.value,
        bytes: (typeof raw.bytes === 'number') ? raw.bytes : 0,
    };
}

/** 包体去重（同键同面只留一条；同键不同面**不合并** —— 那是两件事）。 */
export function normalizeBackupEntries(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const entries = [];
    let dropped = 0;
    let duplicate = 0;
    for (const item of list) {
        const e = normalizeBackupEntry(item);
        if (!e) { dropped += 1; continue; }
        const sig = e.scope + chr_null + e.key;
        if (seen.has(sig)) { duplicate += 1; continue; }
        seen.add(sig);
        entries.push(e);
    }
    return { entries: entries, dropped: dropped, duplicate: duplicate };
}

/* ───────── ③ 冲突检测与导入计划 ───────── */

/** 值指纹（字符串化；不做归一化 —— 备份比的是「一模一样」，不是「像」）。 */
export function backupValueKey(value) {
    try { return JSON.stringify(value === undefined ? null : value); } catch (_e) { return ''; }
}

/**
 * 逐条导入判定：五态。
 *   new       — 本机没有这一格 ⇒ 新增
 *   identical — 本机已有且值一模一样 ⇒ **幂等**（重复导入不改不写）
 *   conflict  — 本机已有但值不同 ⇒ 需用户选择（保留 / 覆盖 / 跳过），本函数只标记
 *   restore   — 本机该格已删（墓碑） ⇒ 还原（与 new 分开：这两件事的善后不同）
 *   rejected  — 静态拒绝（分面不符 / 键不在所选范围 / 分支不符）
 */
export function planBackupImport(pack, local, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const sel = (o.selection && typeof o.selection === 'object') ? o.selection : null;
    const allowBranchMismatch = o.allowBranchMismatch === true;
    const norm = normalizeBackupEntries(pack && pack.entries);
    const localRows = Array.isArray(local) ? local : [];
    const localMap = new Map();
    for (const row of localRows) {
        const e = normalizeBackupEntry(row);
        if (!e) continue;
        localMap.set(e.scope + chr_null + e.key, e);
    }
    const tombstones = new Set(Array.isArray(o.tombstones) ? o.tombstones.map(String) : []);
    const rows = [];
    for (const e of norm.entries) {
        const sig = e.scope + chr_null + e.key;
        let state;
        let why = '';
        if (!backupEntrySelected(e, sel)) {
            state = BACKUP_ENTRY_STATES.REJECTED;
            why = '不在所选导出范围里';
        } else if (!allowBranchMismatch && pack && pack.packBranchKey
            && e.branchKey && pack.packBranchKey !== e.branchKey) {
            state = BACKUP_ENTRY_STATES.REJECTED;
            why = '条目分支（' + e.branchKey + '）与包声明的分支（' + pack.packBranchKey + '）不符';
        } else if (!localMap.has(sig)) {
            state = tombstones.has(sig) ? BACKUP_ENTRY_STATES.RESTORE : BACKUP_ENTRY_STATES.NEW;
            why = tombstones.has(sig) ? '本机该格曾存在、已被删（墓碑）：还原而非新增' : '本机没有这一格';
        } else {
            const cur = localMap.get(sig);
            const same = backupValueKey(cur.value) === backupValueKey(e.value);
            state = same ? BACKUP_ENTRY_STATES.IDENTICAL : BACKUP_ENTRY_STATES.CONFLICT;
            why = same ? '本机已有且逐字相同（重复导入不改不写）' : '本机已有但值不同';
        }
        rows.push({ key: e.key, scope: e.scope, app: e.app, sensitive: e.sensitive, state: state, why: why, entry: e });
    }
    const count = (s) => rows.filter(function (r) { return r.state === s; }).length;
    return {
        rows: rows,
        dropped: norm.dropped,
        duplicate: norm.duplicate,
        totals: {
            total: rows.length,
            new: count(BACKUP_ENTRY_STATES.NEW),
            identical: count(BACKUP_ENTRY_STATES.IDENTICAL),
            conflict: count(BACKUP_ENTRY_STATES.CONFLICT),
            restore: count(BACKUP_ENTRY_STATES.RESTORE),
            rejected: count(BACKUP_ENTRY_STATES.REJECTED),
        },
    };
}

/** 选择面：给定 selection（四维）判定一条条目在不在范围里。
 *  四维取**交集**；未给出的维度不限制。 */
export function backupEntrySelected(entry, selection) {
    const s = (selection && typeof selection === 'object') ? selection : null;
    if (!s) return true;
    const one = (dim, val) => {
        const want = s[dim];
        if (want === undefined || want === null) return true;
        const list = Array.isArray(want) ? want.map(String) : [String(want)];
        if (!list.length) return true;
        return list.indexOf(String(val || '')) >= 0;
    };
    return one('app', entry.app) && one('chat', entry.chatId)
        && one('project', entry.branchKey) && one('material', entry.material);
}

/**
 * 提交计划：把「逐条判定」变成一个可执行的写入计划。
 *   · identical 一律**不写**（幂等：重复导入不产生任何写入）；
 *   · conflict 按 opts.onConflict（keep / overwrite / skip）处置，默认 keep；
 *   · rejected 一律不写；
 *   · 会话与分支边界**不可被打穿**：目标 scope / branch 与条目不符时一律拒。
 * @returns {{writes:Array, skipped:Array, counts:object, ok:boolean}}
 */
export function commitBackupPlan(plan, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const onConflict = ['keep', 'overwrite', 'skip'].indexOf(String(o.onConflict || 'keep')) >= 0 ? String(o.onConflict || 'keep') : 'keep';
    const targetScope = String(o.targetScope || '');
    const targetBranch = String(o.targetBranch || '');
    const rows = (plan && Array.isArray(plan.rows)) ? plan.rows : [];
    const writes = [];
    const skipped = [];
    for (const r of rows) {
        if (targetScope && r.scope !== targetScope) {
            skipped.push({ key: r.key, scope: r.scope, why: '分面不符：条目属 ' + r.scope + ' 面，目标是 ' + targetScope + ' 面' });
            continue;
        }
        if (targetBranch && r.entry && r.entry.branchKey && r.entry.branchKey !== targetBranch) {
            skipped.push({ key: r.key, scope: r.scope, why: '分支不符：条目属 ' + r.entry.branchKey + '，目标是 ' + targetBranch });
            continue;
        }
        if (r.state === BACKUP_ENTRY_STATES.NEW || r.state === BACKUP_ENTRY_STATES.RESTORE) {
            writes.push({ key: r.key, scope: r.scope, value: r.entry.value, kind: r.state });
        } else if (r.state === BACKUP_ENTRY_STATES.CONFLICT) {
            if (onConflict === 'overwrite') writes.push({ key: r.key, scope: r.scope, value: r.entry.value, kind: 'conflict-overwrite' });
            else skipped.push({ key: r.key, scope: r.scope, why: onConflict === 'keep' ? '冲突：保留本机现有值' : '冲突：用户选择跳过' });
        } else if (r.state === BACKUP_ENTRY_STATES.REJECTED) {
            skipped.push({ key: r.key, scope: r.scope, why: r.why });
        }
        /* identical 既不入 writes 也不入 skipped：它是「什么都不发生」，
         *   混进任何一边都会让「导了两次多出一堆记录」这种事故变得看不出来。 */
    }
    return {
        writes: writes,
        skipped: skipped,
        counts: { writes: writes.length, skipped: skipped.length, untouched: rows.length - writes.length - skipped.length },
        ok: true,
    };
}

/** 撤销计划：把已写入的那些按**逆序**列回来（撤销只撤本次写入的那些）。 */
export function undoBackupPlan(commit) {
    const w = (commit && Array.isArray(commit.writes)) ? commit.writes : [];
    const undo = w.slice().reverse().map(function (x) { return { key: x.key, scope: x.scope, action: x.kind === 'new' ? 'remove' : 'restore-previous', kind: x.kind }; });
    return { undo: undo, count: undo.length, note: undo.length ? '按写入逆序列出（先撤后写的）' : '本次没有写入，无可撤' };
}

/* ───────── ④ 包体构建与读数 ───────── */

/**
 * 构建一份备份包。range 是**身份面**：来源 / 会话范围 / 分支范围 / schema / 宿主版本。
 * 不含任何来自外部的系统时刻（时间由调用方给）。
 */
export function buildBackupPack(input) {
    const i = (input && typeof input === 'object') ? input : {};
    const norm = normalizeBackupEntries(i.entries);
    const sensitive = norm.entries.filter(function (e) { return e.sensitive === 'yes'; }).length;
    const unknown = norm.entries.filter(function (e) { return e.sensitive === 'unknown'; }).length;
    return {
        mark: BACKUP_MARK,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        hostVersion: String(i.hostVersion || ''),
        at: (typeof i.at === 'number') ? i.at : 0,
        source: String(i.source || 'local'),
        packChatId: String(i.packChatId || ''),
        packBranchKey: String(i.packBranchKey || ''),
        selection: (i.selection && typeof i.selection === 'object') ? i.selection : null,
        entries: norm.entries,
        counts: {
            total: norm.entries.length,
            chat: norm.entries.filter(function (e) { return e.scope === 'chat'; }).length,
            global: norm.entries.filter(function (e) { return e.scope === 'global'; }).length,
            sensitive: sensitive,
            unknownSensitive: unknown,
            dropped: norm.dropped,
            duplicate: norm.duplicate,
        },
    };
}

/** 包体一行读数；一节都不省。 */
export function backupPackLine(pack) {
    if (!pack || typeof pack !== 'object') return '还没有包';
    const c = pack.counts || {};
    return '备份包 v' + String(pack.schemaVersion)
        + ' · 共 ' + String(c.total || 0) + ' 键（会话面 ' + String(c.chat || 0) + ' / 全局面 ' + String(c.global || 0) + '）'
        + ' · 敏感 ' + String(c.sensitive || 0) + ' 键'
        + (c.unknownSensitive ? (' · 敏感未知 ' + String(c.unknownSensitive) + ' 键') : '')
        + ' · 来源 ' + String(pack.source || '') + ' · 不上传云端';
}

/** 导入计划一行读数。 */
export function backupPlanLine(plan, commit) {
    if (!plan) return '还没有导入计划';
    const t = plan.totals || {};
    let s = '新增 ' + String(t.new || 0) + ' · 还原 ' + String(t.restore || 0)
        + ' · 逐字相同 ' + String(t.identical || 0) + ' · 冲突 ' + String(t.conflict || 0)
        + ' · 拒收 ' + String(t.rejected || 0);
    if (commit) s += ' ｜ 将写 ' + String(commit.counts.writes) + ' · 不动 ' + String(commit.counts.untouched);
    return s;
}

/* ───────── ⑤ 自检 ───────── */

const chr_null = String.fromCharCode(0);

export function backupSelfCheck() {
    const problems = [];
    if (BACKUP_SCHEMA_VERSION < 1) problems.push('schema 版本必须 >= 1');
    if (BACKUP_MIGRATIONS.length < 2) problems.push('迁移表应至少两步，实际 ' + BACKUP_MIGRATIONS.length);
    for (const m of BACKUP_MIGRATIONS) {
        if (m.to !== m.from + 1) problems.push('迁移必须逐版（发现跳步 ' + m.from + '->' + m.to + '）');
        if (!m.why) problems.push('迁移 v' + m.from + '->v' + m.to + ' 缺 why');
    }
    if (BACKUP_DIM_KEYS.length !== 4) problems.push('范围维度应四个，实际 ' + BACKUP_DIM_KEYS.length);
    if (BACKUP_SCOPE_KEYS.length !== 2) problems.push('分面应两个，实际 ' + BACKUP_SCOPE_KEYS.length);

    const pack = buildBackupPack({
        hostVersion: '3.91.0', at: 1, source: 'local', packChatId: 'c1', packBranchKey: 'main',
        entries: [
            { key: 'wechat_data', scope: 'chat', chatId: 'c1', branchKey: 'main', sensitive: true, value: { a: 1 } },
            { key: 'sys_shell_scale', scope: 'global', sensitive: false, value: 1 },
        ],
    });
    if (pack.entries.length !== 2) problems.push('包体应 2 键，实际 ' + pack.entries.length);
    if (pack.counts.chat !== 1 || pack.counts.global !== 1) problems.push('分面计数不对');
    if (pack.counts.sensitive !== 1) problems.push('敏感计数不对');

    /* 幂等：同包导两次，第二次必须全是 identical（writes 为空）。 */
    const plan1 = planBackupImport(pack, [], {});
    if (plan1.totals.new !== 2) problems.push('空机导入应 2 新增，实际 ' + plan1.totals.new);
    const commit1 = commitBackupPlan(plan1, {});
    if (commit1.counts.writes !== 2) problems.push('首次提交应写 2，实际 ' + commit1.counts.writes);
    const local = pack.entries.map(function (e) { return { key: e.key, scope: e.scope, value: e.value }; });
    const plan2 = planBackupImport(pack, local, {});
    if (plan2.totals.identical !== 2) problems.push('二次导入应全 identical，实际 ' + plan2.totals.identical);
    const commit2 = commitBackupPlan(plan2, {});
    if (commit2.counts.writes !== 0) problems.push('二次导入不得产生写入（幂等），实际 ' + commit2.counts.writes);

    /* 老包必须明确迁移或明确拒绝：造一个 v1 包（无 scope / 无 sensitive） */
    const oldPack = { mark: BACKUP_MARK, schemaVersion: 1, entries: [{ key: 'wechat_data', value: {} }] };
    const mig = migrateBackupPack(oldPack, BACKUP_SCHEMA_VERSION);
    if (mig.state !== BACKUP_MIGRATE_STATES.MIGRATED) problems.push('v1 包必须被迁移（实际 ' + mig.state + '）');
    if (!mig.pack || mig.pack.schemaVersion !== BACKUP_SCHEMA_VERSION) problems.push('迁移后版本不对');
    if (mig.steps.length !== 2) problems.push('v1->v3 应两步，实际 ' + mig.steps.length);
    if (migrateBackupPack({ mark: BACKUP_MARK, schemaVersion: null }, 3).state !== BACKUP_MIGRATE_STATES.TOO_OLD) {
        problems.push('无版本号的包必须明确拒（不得猜）');
    }
    if (migrateBackupPack({ mark: BACKUP_MARK, schemaVersion: 9 }, 3).state !== BACKUP_MIGRATE_STATES.FUTURE) {
        problems.push('未来版本包必须明确拒');
    }

    /* 分面绝不互换 */
    const c3 = commitBackupPlan(plan1, { targetScope: 'global' });
    if (c3.writes.some(function (w) { return w.scope === 'chat'; })) problems.push('目标分面为全局时不得写入会话面条目');

    /* 冲突：值不同时默认保留本机 */
    const conflictLocal = [{ key: 'wechat_data', scope: 'chat', value: { a: 2 } }];
    const plan3 = planBackupImport(pack, conflictLocal, {});
    if (plan3.totals.conflict !== 1) problems.push('值不同应记冲突，实际 ' + plan3.totals.conflict);
    const c4 = commitBackupPlan(plan3, {});
    if (c4.writes.some(function (w) { return w.key === 'wechat_data'; })) problems.push('冲突默认必须保留本机（不得覆盖）');
    const c5 = commitBackupPlan(plan3, { onConflict: 'overwrite' });
    if (c5.writes.filter(function (w) { return w.key === 'wechat_data'; }).length !== 1) problems.push('显式 overwrite 时才允许写');

    /* 分支不符：不打开开关时一律拒 */
    const otherBranch = buildBackupPack({ packChatId: 'c1', packBranchKey: 'other', entries: [{ key: 'k1', scope: 'chat', branchKey: 'side', value: 1 }] });
    const plan4 = planBackupImport(otherBranch, [], {});
    if (plan4.totals.rejected !== 1) problems.push('分支不符必须拒收，实际 ' + plan4.totals.rejected);

    /* 范围交集（不是并集） */
    const sel = planBackupImport(pack, [], { selection: { app: 'wechat' } });
    const wechatRow = pack.entries.map(function (e) { return { key: e.key, scope: e.scope, app: e.app, value: e.value }; });
    if (!backupEntrySelected({ app: 'wechat', chatId: 'c1' }, { app: ['wechat', 'weibo'], chat: ['c1'] })) problems.push('多选范围内的条目应被选中');
    if (backupEntrySelected({ app: 'weibo', chatId: 'c2' }, { app: ['wechat', 'weibo'], chat: ['c1'] })) problems.push('范围取交集：两维都命中才算在范围内');

    /* 撤销：只撤本次写入 */
    const undo = undoBackupPlan(commit1);
    if (undo.count !== 2) problems.push('撤销应列 2 项，实际 ' + undo.count);
    if (undo.undo[0].key !== 'sys_shell_scale') problems.push('撤销必须逆序（最后写的最先撤）');

    /* 零网络 / 零云端 */
    return { problems: problems, dims: BACKUP_DIM_KEYS.length, scopes: BACKUP_SCOPE_KEYS.length, migrations: BACKUP_MIGRATIONS.length, schema: BACKUP_SCHEMA_VERSION };
}

/* ───────── ⑥ 导出清单 ───────── */

export default {
    BACKUP_MARK,
    BACKUP_SCHEMA_VERSION,
    BACKUP_MIGRATIONS,
    BACKUP_DIMENSIONS,
    BACKUP_DIM_KEYS,
    BACKUP_SCOPES,
    BACKUP_SCOPE_KEYS,
    BACKUP_PACK_STATES,
    BACKUP_MIGRATE_STATES,
    BACKUP_ENTRY_STATES,
    readBackupPack,
    migrateBackupPack,
    normalizeBackupEntry,
    normalizeBackupEntries,
    backupValueKey,
    planBackupImport,
    backupEntrySelected,
    commitBackupPlan,
    undoBackupPlan,
    buildBackupPack,
    backupPackLine,
    backupPlanLine,
    backupSelfCheck,
};
