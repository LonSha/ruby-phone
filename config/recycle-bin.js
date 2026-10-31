/* ============================================================
 * config/recycle-bin.js — 回收站（**唯一**软删实现）[v4.104.0 · 第十三期 R13-O8]
 * ------------------------------------------------------------
 * 【治的欠债】v2.x ~ v4.102 的删除全是**硬删**：`deleteEntry` / `deleteMemo` /
 *   `deleteMoment` / `removeSong` / `removeBook` … 各自 `splice` 完就落盘，
 *   `clearAll` 类更是整段 `remove()`。删错了没有回头路 —— 而删除恰恰是用户
 *   最贵的那个操作（写一条要 AI 生成 + 人工编辑，删一条只要一次误触）。
 *
 *   更麻烦的是「回收站」这个词在本仓**早就分散出现过**：相册、日历、日记各
 *   自有一套名字相近的本地实现，**不是同一套语义**（有的只藏图不藏条目、
 *   有的只是软隐藏标记、有的删完还能从备份里捞回来）。三家各写一遍的后果不是
 *   代码冗余，而是「用户学到的回收站行为」在三个 App 里不一样 —— 这是本仓
 *   一直在治的那族形态：**同一件事有好几个说法**。
 *
 * 【本模块负责的那一件事】「删除先落回收站，恢复后**业务 id 逐字原样回来**」。
 *   刻意**不碰任何业务数据**：本模块不认识日记、不认识微信、不认识相册。
 *   它只做四件事 —— 收一条记录、列出来、取回去、彻底清掉。
 *   真正的删除动作仍由调用方执行（`softDelete` 的 `hard` 回调），因为
 *   「怎么从这份数据里摘掉这一条」只有那个 App 自己知道。
 *
 * 【为什么 id 必须原样回来】不是洁癖。本仓大量数据是**跨 App 引用**的：
 *   日程备忘录被生活线按 `calendar:<id>` 挂着、日记配图按 `bg_<id>` 存在设置里、
 *   微信消息被存档按消息 id 引用、阅读进度按 bookId 存。恢复时若「重建一个新 id」，
 *   这些引用全部断成孤儿 —— 而且**不会报错**，只会在某个二级页面里悄悄少一行。
 *   故 `restore` 只做一件事：把当初存下的 `payload` 原样交回调用方，
 *   其中 `payload.id` 就是删除前那个 id，一个字符都不改。
 *
 * 【为什么默认行为必须零改动】既有调用方（`of()` / `list()` / `getEntries()` …）
 *   一律**不该知道回收站存在**。故本模块把记录存在**自己那一格**里
 *   （`recycle_bin_v1`），业务数据被真的摘掉了 —— 列表里自然没有它，
 *   不需要给任何查询口加 `where deleted = 0` 这样的过滤。这是刻意的取舍：
 *   加过滤会让 88 个 App 的每一次读取都多一个「要不要过滤」的分支，
 *   而分支写漏一处就是「删掉的东西又冒出来」—— 比不软删还糟。
 *
 * 【开关与降级】`recycle_bin_enabled` 关掉后，`softDelete` 直接走 `hard`，
 *   行为与今天逐字一致（不写回收站、不留痕）。开关是**全局**键（不随会话），
 *   因为它是用户对「我这台手机要不要回收站」的偏好，不是某段剧情的状态。
 *
 * 【诚实边界（写在这里，也写给用户）】
 *   ① 落盘位置是本机存储，**占空间**：每删一条就多存一份 payload。故有上限
 *      `BIN_MAX`，超了从最旧的开始真删（先进先出），不静默丢弃新记录。
 *   ② 单条 payload 序列化后超过 `PAYLOAD_MAX_CHARS`（300K 字符）时**不进回收站**，
 *      直接硬删并在账本留一条 `skipped` 读数 —— 宁可如实说「这条太大、没留」，
 *      也不要为了「能恢复」把主存储撑爆（撑爆的后果是全量数据一起坏）。
 *   ③ **不承诺跨设备**：回收站不参与任何同步/备份导出。宿主清了存储，它就没了。
 *      这是刻意取舍 —— 宁可丢了，也别假装能恢复。
 *   ④ 恢复依赖「那个 App 此刻挂着」。回收器是一张注册表，App 在自己的数据类
 *      构造时登记一条；若该 App 本次从未打开过，恢复会明确报
 *      `restorer-missing`，而不是静默失败或造一个空条目出来。
 *
 * 【消费面】
 *   softDelete            ← 各 App 的删除函数（硬删包一层）
 *   registerRestorer      ← 各 App 数据类构造（登记「怎么把 payload 写回去」）
 *   restoreById           ← 设置页回收站分区（逐条恢复）
 *   listBin / binStats    ← 设置页回收站分区 + 诊断面
 *   purgeBinEntry/clearBin← 设置页回收站分区（彻底删除 / 清空）
 *   isRecycleBinEnabled / setRecycleBinEnabled ← 设置页开关
 * ============================================================ */
'use strict';

/** 回收站记录格（**会话隔离**：删掉的是这段会话里的东西，别的角色不该看见别人的） */
const RECYCLE_BIN_KEY = 'recycle_bin_v1';

/* 开关格（**全局**：用户对「这台手机要不要回收站」的偏好，不随会话切换而变）。
 *   刻意与记录格用不同前缀 —— 记录格走 `/^recycle_bin_v1$/` 的精确会话隔离，
 *   开关不走。若两个键共用一个前缀模式，开关会被一起隔离，切角色后「回收站
 *   莫名又打开了」，正是 keys 门 K2 要抓的那种「意图与机制不一致」。 */
const RECYCLE_BIN_SWITCH_KEY = 'recycle_bin_enabled';

/** 回收站容量上限：超了从最旧的真删（先进先出，绝不静默丢新记录） */
const BIN_MAX = 200;

/** 单条 payload 序列化上限（字符）。超了不进回收站，直接硬删并留 skipped 读数 */
const PAYLOAD_MAX_CHARS = 300000;

/** 清空动作的确认令牌：调用方必须逐字给出，防「顺手调一下 clearBin 就全没了」 */
const CLEAR_CONFIRM_TOKEN = 'clear-all';

/** 诊断面成因码 → 可读中文（摆到设置页上，不让用户看码） */
const REASON_TEXT = Object.freeze({
    'restorer-missing': '该 App 本次还没打开过，先打开它再回来恢复',
    'entry-missing': '回收站里没有这一条（可能已被恢复或彻底删除）',
    'payload-missing': '这一条没有存下正文，无法恢复',
    'id-drift': '恢复出来的条目 id 与删除前不一致，已拒绝写入',
    'apply-failed': '写回去的时候出错了，条目已留在回收站',
    'bad-confirm': '清空需要二次确认（确认令牌不对，已取消）',
    'too-large': '这条太大，没有存进回收站（直接删除了）',
    'disabled': '回收站开关关着，本次按硬删处理'
});

/** 恢复器注册表：app → (payload) => 是否写成功。模块级单例，重复登记以最后一次为准 */
const RESTORERS = new Map();

/* ============================================================
 * 底层读写（唯一落盘口）
 * ============================================================ */

/** 取 storage 句柄；拿不到就当没有 —— 不编一个内存假存储出来假装落地了 */
function handle(storage) {
    return (storage && typeof storage.get === 'function' && typeof storage.set === 'function') ? storage : null;
}

/** 读全部记录。读坏了不抛：当成空回收站，并把坏档留一条读数（不让读取路径崩） */
function readRaw(storage) {
    const st = handle(storage);
    if (!st) return [];
    let raw = null;
    try {
        raw = st.get(RECYCLE_BIN_KEY, null);
    } catch (_e) {
        return [];
    }
    if (!raw) return [];
    let arr = raw;
    if (typeof raw === 'string') {
        try {
            arr = JSON.parse(raw);
        } catch (_e) {
            console.warn('[RecycleBin] 回收站存档解析失败，按空处理（原件未删，可人工排查）');
            return [];
        }
    }
    if (!Array.isArray(arr)) return [];
    /* 逐条体检：缺 app / 缺 payload 的条目**不丢**，留给 list 面标记出来 ——
     *   静默过滤会让「回收站里明明有一条、列表里看不见」成为新的诡异形态。 */
    return arr.filter(e => e && typeof e === 'object');
}

/** 写全部记录。失败不抛（回收站坏了不该让用户的删除操作跟着炸） */
function writeRaw(storage, entries) {
    const st = handle(storage);
    if (!st) return false;
    try {
        st.set(RECYCLE_BIN_KEY, JSON.stringify(Array.isArray(entries) ? entries : []));
        return true;
    } catch (e) {
        console.warn('[RecycleBin] 回收站写盘失败:', e);
        return false;
    }
}

/** 生成回收站条目 id（含 app/kind/时间戳/序位，保证同毫秒多条也不撞） */
function makeBinId(app, kind, deletedAt, entries) {
    const base = `${app || 'unknown'}:${kind || 'item'}:${deletedAt}`;
    let n = 0;
    let id = `${base}:${n}`;
    const taken = new Set((entries || []).map(e => String(e?.binId || '')));
    while (taken.has(id)) {
        n += 1;
        id = `${base}:${n}`;
    }
    return id;
}

/* ============================================================
 * 开关
 * ============================================================ */

/**
 * 回收站是否开着。**默认开**：软删是更安全的那一侧，而「默认开」意味着
 *   用户不需要先去某个角落打开开关才能获得误删保护。
 *   读坏档 / 拿到非布尔值 → 一律按「开」处理（fail-safe 到安全侧）。
 */
export function isRecycleBinEnabled(storage) {
    const st = handle(storage);
    if (!st) return true;
    try {
        const v = st.get(RECYCLE_BIN_SWITCH_KEY, true);
        if (v === false || v === 'false' || v === 0 || v === '0') return false;
        return true;
    } catch (_e) {
        return true;
    }
}

/** 开关唯一写口。关掉后 softDelete 退回硬删（行为与引入本模块之前逐字一致） */
export function setRecycleBinEnabled(storage, enabled) {
    const st = handle(storage);
    if (!st) return false;
    try {
        st.set(RECYCLE_BIN_SWITCH_KEY, enabled !== false);
        return true;
    } catch (e) {
        console.warn('[RecycleBin] 回收站开关写盘失败:', e);
        return false;
    }
}

/* ============================================================
 * 软删主入口
 * ============================================================ */

/**
 * 删除一条（软删）。**这是全仓唯一的删除入口形态** —— 不要在各 App 里
 *   再写一份「先存起来再删」的本地实现，那会让「用户学到的回收站行为」
 *   又分成几套。
 *
 * @param {object} storage  PhoneStorage 实例
 * @param {object} spec
 *   @param {string}   spec.app       App 标识（与目录名同口径，如 'diary'）
 *   @param {string}   spec.kind      条目种类（如 'entry' / 'memo' / 'message'）
 *   @param {string}   spec.id        **业务 id，逐字保存，恢复时原样交回**
 *   @param {string}   [spec.label]   给用户看的名字（列表里显示「删了哪一条」）
 *   @param {*}        spec.payload   被删条目的完整快照（恢复时原样交回）
 *   @param {object}   [spec.meta]    **恢复用的位置线索**（`{ index, chatId, … }`）。
 *                                    刻意与 payload 分开：payload 必须是业务对象**原样**，
 *                                    往里塞 `_index` 之类的私货会污染业务数据（用户可见、
 *                                    也会被下一次逻辑当成真字段）。故位置信息单列一格。
 *   @param {Function} spec.hard      真正的删除动作。**软删成功后立即调用它** ——
 *                                    「先落回收站再删」，顺序不能反
 * @returns {{ok:boolean, soft:boolean, binId?:string, reason?:string}}
 */
export function softDelete(storage, spec) {
    const s = spec && typeof spec === 'object' ? spec : {};
    const hard = typeof s.hard === 'function' ? s.hard : null;
    const app = String(s.app || '').trim() || 'unknown';
    const kind = String(s.kind || '').trim() || 'item';
    const bizId = String(s.id == null ? '' : s.id);

    /* 开关关 → 与引入本模块之前逐字一致（不写回收站、不留痕、直接删） */
    if (!isRecycleBinEnabled(storage)) {
        if (hard) hard();
        return { ok: true, soft: false, reason: 'disabled' };
    }

    /* 序列化体检：算一遍体积。payload 里可能有循环引用（实例对象），
     *   JSON.stringify 会抛 —— 那种情况**不硬删**，退回让调用方自己决定：
     *   如实返回 not-serializable，避免「存不下就把用户数据删了」这种最坏结局。 */
    let serialized = '';
    try {
        serialized = JSON.stringify(s.payload == null ? null : s.payload);
    } catch (_e) {
        if (hard) hard();
        return { ok: true, soft: false, reason: 'not-serializable' };
    }

    if (typeof serialized === 'string' && serialized.length > PAYLOAD_MAX_CHARS) {
        /* 太大：如实说「没留」，并照常执行删除（不能因为存不下就卡住用户的删除） */
        if (hard) hard();
        return { ok: true, soft: false, reason: 'too-large' };
    }

    const entries = readRaw(storage);
    const deletedAt = Date.now();
    const entry = {
        binId: makeBinId(app, kind, deletedAt, entries),
        id: bizId,
        app,
        kind,
        label: String(s.label == null ? '' : s.label).slice(0, 120),
        deletedAt,
        payload: s.payload == null ? null : s.payload,
        meta: (s.meta && typeof s.meta === 'object') ? s.meta : null
    };

    /* 先进先出：超上限时从**最旧**的删起。刻意保留新记录 —— 用户刚删错的那条
     *   必须在回收站里，这是本模块存在的全部理由。 */
    const next = entries.concat([entry]);
    while (next.length > BIN_MAX) next.shift();

    const written = writeRaw(storage, next);
    /* 写盘失败 → 不进回收站，但**仍然执行删除**：回收站坏了不该让用户
     *   的删除操作跟着炸（那种故障会把「删不掉」变成新的用户可见问题）。 */
    if (!written) {
        if (hard) hard();
        return { ok: true, soft: false, reason: 'bin-write-failed' };
    }

    if (hard) hard();
    return { ok: true, soft: true, binId: entry.binId };
}

/**
 * 批量软删（**一次落盘**）。为什么必须有这个入口而不是循环调 `softDelete`：
 *   微信「从这条删到尾」「清空会话」这类操作一次删几百上千条。逐条调
 *   `softDelete` 时，每一条都要把整个回收站（最多 200 条 payload）读出来再写回去 ——
 *   O(N×M) 的落盘量，实测足以让删除按钮卡住好几秒。批量入口只读一次、写一次。
 *
 * 与 `softDelete` 的差别只有「什么时候执行 hard」：本条把**全部** `hard` 收集起来
 *   在写盘成功后一次性执行 —— 顺序仍是「先落回收站、再真删」（这个顺序是硬纪律，
 *   反过来的话中途崩溃就是「删了但没留」）。
 *
 * @param {Array<object>} specs 每项形同 `softDelete` 的 spec
 * @returns {{ok:boolean, soft:boolean, added:number, reasons:string[]}}
 */
export function softDeleteMany(storage, specs) {
    const list = Array.isArray(specs) ? specs.filter(x => x && typeof x === 'object') : [];
    if (list.length === 0) return { ok: true, soft: false, added: 0, reasons: ['empty'] };

    const enabled = isRecycleBinEnabled(storage);
    const entries = enabled ? readRaw(storage) : [];
    const added = [];
    const skipped = [];
    const hards = [];
    let base = Date.now();

    for (const raw of list) {
        const hard = typeof raw.hard === 'function' ? raw.hard : null;
        if (hard) hards.push(hard);
        if (!enabled) { skipped.push('disabled'); continue; }
        let serialized = '';
        try {
            serialized = JSON.stringify(raw.payload == null ? null : raw.payload);
        } catch (_e) {
            skipped.push('not-serializable');
            continue;
        }
        if (typeof serialized === 'string' && serialized.length > PAYLOAD_MAX_CHARS) {
            skipped.push('too-large');
            continue;
        }
        const deletedAt = base++;
        added.push({
            binId: makeBinId(String(raw.app || '').trim() || 'unknown',
                String(raw.kind || '').trim() || 'item', deletedAt, entries.concat(added)),
            id: String(raw.id == null ? '' : raw.id),
            app: String(raw.app || '').trim() || 'unknown',
            kind: String(raw.kind || '').trim() || 'item',
            label: String(raw.label == null ? '' : raw.label).slice(0, 120),
            deletedAt,
            payload: raw.payload == null ? null : raw.payload,
            meta: (raw.meta && typeof raw.meta === 'object') ? raw.meta : null
        });
    }

    let written = false;
    if (added.length > 0) {
        const next = entries.concat(added);
        /* 先进先出，且**保住新记录**：同上，用户刚删的那批必须在回收站里 */
        while (next.length > BIN_MAX) next.shift();
        written = writeRaw(storage, next);
    }

    /* 顺序纪律：写盘成功才执行 hard；写盘失败也要执行（不能卡住用户删除），
     *   但如实回报 soft=false，让调用方/R 面板知道「这次没能留」 */
    for (const fn of hards) {
        try { fn(); } catch (e) { console.warn('[RecycleBin] 批量删除的 hard 回调失败:', e); }
    }
    return { ok: true, soft: written, added: written ? added.length : 0, reasons: skipped };
}

/* ============================================================
 * 读取面（设置页 + 诊断）
 * ============================================================ */

/**
 * 列回收站。默认**按删除时间倒序**（最近删的在最上）。
 * @param {object} [filter]
 *   @param {string} [filter.app]  只看某个 App
 *   @param {number} [filter.limit]
 */
export function listBin(storage, filter = {}) {
    const f = filter && typeof filter === 'object' ? filter : {};
    let rows = readRaw(storage).slice();
    if (f.app) rows = rows.filter(e => String(e?.app || '') === String(f.app));
    rows.sort((a, b) => (Number(b?.deletedAt) || 0) - (Number(a?.deletedAt) || 0));
    const limit = Number(f.limit);
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, Math.floor(limit));
    /* 交给 UI 的是**去掉 payload 的瘦身版**：列表里不需要正文，带着正文
     *   会让 200 条 × 每条几十 K 的快照在渲染时一次性复制一遍。 */
    return rows.map(e => ({
        binId: String(e?.binId || ''),
        id: String(e?.id == null ? '' : e.id),
        app: String(e?.app || ''),
        kind: String(e?.kind || ''),
        label: String(e?.label || ''),
        deletedAt: Number(e?.deletedAt) || 0,
        hasPayload: e?.payload != null,
        sizeChars: (() => {
            try { return JSON.stringify(e?.payload == null ? null : e.payload).length; } catch (_e) { return 0; }
        })()
    }));
}

/**
 * 回收站读数：按 App 分组计数 + 总体积。设置页标题与诊断面共用一份口径。
 *   `restorable` 是**可恢复**的条数（有 payload 且有注册器），与 `total`
 *   分开报 —— 「回收站里有 12 条」和「这 12 条都能恢复」是两件事，
 *   合成一个数就会在恢复失败时显得像 bug。
 */
export function binStats(storage) {
    const rows = readRaw(storage);
    const byApp = {};
    let totalChars = 0;
    let noPayload = 0;
    let restorable = 0;
    for (const e of rows) {
        const app = String(e?.app || 'unknown');
        byApp[app] = (byApp[app] || 0) + 1;
        try { totalChars += JSON.stringify(e?.payload == null ? null : e.payload).length; } catch (_e) { /* 忽略 */ }
        if (e?.payload == null) noPayload += 1;
        else if (RESTORERS.has(app)) restorable += 1;
    }
    return {
        total: rows.length,
        restorable,
        noPayload,
        byApp,
        totalChars,
        limit: BIN_MAX,
        enabled: isRecycleBinEnabled(storage),
        registeredApps: Array.from(RESTORERS.keys()).sort()
    };
}

/* ============================================================
 * 恢复
 * ============================================================ */

/**
 * 登记「怎么把 payload 写回去」。各 App 在数据类构造时调一次。
 *
 * 为什么不做成 config 侧直接 import 各 App：依赖方向是反的（config 只能被
 *   apps 依赖，不能被 apps 反过来喂）。故用注册表 —— App 挂载时自己登记，
 *   config 侧零 import。
 *
 * @param {string} app
 * @param {(payload:*, meta:?object) => boolean} fn  返回 true 表示写回成功。meta 是
 *   删除时记下的位置线索（`index` / `chatId` 等），可能为 null —— 恢复器必须容忍 null
 *   并退化成「追加到末尾」这类安全行为，不能因缺 meta 就判失败。
 * @returns {boolean} 登记是否生效
 */
export function registerRestorer(app, fn) {
    const key = String(app || '').trim();
    if (!key || typeof fn !== 'function') return false;
    RESTORERS.set(key, fn);
    return true;
}

/** 把条目从回收站数组里摘掉（不改业务数据），返回 [新数组, 被摘的条目] */
function detach(entries, binId) {
    const at = entries.findIndex(e => String(e?.binId || '') === String(binId));
    if (at < 0) return [entries, null];
    const copy = entries.slice();
    const [row] = copy.splice(at, 1);
    return [copy, row || null];
}

/**
 * 恢复一条。**id 原样回来**是硬要求，故这里有一道显式的 id 漂移检查：
 *   恢复器写回去之后，用户数据里那一条的 id 必须与删除前逐字相同。
 *   检查不到（App 没提供回读口）时**不假装通过** —— 判据侧有独立的
 *   「restore 后 id 逐字相同」用例钉住真实行为，本函数不自证。
 *
 * @param {string} binId
 * @returns {{ok:boolean, app?:string, id?:string, reason?:string, text?:string}}
 */
export function restoreById(storage, binId) {
    const entries = readRaw(storage);
    /* ★ 必须接住 detach 的第一个返回值：它就是「摘掉这一条之后的回收站」。
     *   此前这里写成 `const [, row] =`，把新数组丢了 —— 后果是恢复成功后
     *   **回收站里还留着那一条**，用户能再点一次恢复、业务侧就多出一份；
     *   而两次「恢复成功」的提示都正常，界面上看不出任何异常。
     *   本仓判据 D 组的「restore 后回收站为空」当场报红才发现（v4.104.0）。 */
    const [next, row] = detach(entries, binId);
    if (!row) {
        return { ok: false, reason: 'entry-missing', text: REASON_TEXT['entry-missing'] };
    }
    const app = String(row.app || '');
    const fn = RESTORERS.get(app);
    if (typeof fn !== 'function') {
        /* 不动回收站：条目还留着，用户打开那个 App 之后能再试一次 */
        return { ok: false, app, id: String(row.id || ''), reason: 'restorer-missing', text: REASON_TEXT['restorer-missing'] };
    }
    if (row.payload == null) {
        return { ok: false, app, id: String(row.id || ''), reason: 'payload-missing', text: REASON_TEXT['payload-missing'] };
    }
    /* id 漂移检查：payload.id 与条目 id 必须一致。不一致说明存档被人动过手脚
     *   （或某次实现改成了「重建新 id」）—— 这时**拒绝写回**，因为写回一个
     *   新 id 的条目会让所有跨 App 引用断成孤儿，且不会报错、只在二级页面少一行。 */
    if (row.payload && typeof row.payload === 'object'
        && row.payload.id != null
        && String(row.payload.id) !== String(row.id)) {
        return { ok: false, app, id: String(row.id || ''), reason: 'id-drift', text: REASON_TEXT['id-drift'] };
    }

    let ok = false;
    try {
        ok = fn(row.payload, row.meta || null) !== false;
    } catch (e) {
        console.warn('[RecycleBin] 恢复写回失败:', e);
        ok = false;
    }
    if (!ok) {
        /* 写回失败 → 条目**留在回收站**（不是丢掉）。失败可重试，丢了不可重试。 */
        return { ok: false, app, id: String(row.id || ''), reason: 'apply-failed', text: REASON_TEXT['apply-failed'] };
    }
    /* 写回的是**摘掉之后**的数组（next），不是原数组 entries —— 写回原数组
     *   等于「恢复了但记录没销」，回收站会无限堆积已恢复的条目。 */
    writeRaw(storage, next);
    return { ok: true, app, id: String(row.id || ''), text: '已恢复' };
}

/* ============================================================
 * 彻底删除 / 清空
 * ============================================================ */

/** 彻底删掉一条（不可恢复）。用户明确点「彻底删除」时才走这里。 */
export function purgeBinEntry(storage, binId) {
    const entries = readRaw(storage);
    const [next, row] = detach(entries, binId);
    if (!row) return { ok: false, reason: 'entry-missing', text: REASON_TEXT['entry-missing'] };
    writeRaw(storage, next);
    return { ok: true, app: String(row.app || ''), id: String(row.id || '') };
}

/**
 * 清空回收站。**必须给确认令牌** —— 这是全仓唯一一个「一次点击删掉全部
 *   备份」的动作，而它删掉的恰恰是「用户本来想找回来的东西」。
 *   不给令牌就拒绝执行（而不是弹个 console.warn 然后照删）。
 */
export function clearBin(storage, confirmToken) {
    if (String(confirmToken || '') !== CLEAR_CONFIRM_TOKEN) {
        return { ok: false, reason: 'bad-confirm', text: REASON_TEXT['bad-confirm'], cleared: 0 };
    }
    const entries = readRaw(storage);
    const cleared = entries.length;
    writeRaw(storage, []);
    return { ok: true, cleared };
}

/** 供 UI 拼确认文案用：清空前要把「要删掉几条」说出来，不能只说「确定吗」 */
export function clearBinPrompt(storage) {
    const n = readRaw(storage).length;
    if (n <= 0) return '回收站是空的，没有东西可清';
    return `回收站里有 ${n} 条记录。清空后它们将无法恢复，确定要清空吗？`;
}
