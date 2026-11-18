/* ========================================================
 * config/data-growth.js — R25-O6 数据增长治理（占用 / 排序 / 清理差异预览）
 * --------------------------------------------------------
 * 【为什么需要这一层】本仓的存储是「键面」：`chatMetadata` 一层 + `extensionSettings`
 *   一层，键名各 App 自取。于是「手机越用越胖」这件事，此前**没有任何地方答得出**
 *   三个最基本的问题：① 到底是谁占的？② 现在最大的是哪几个？③ 清掉某类东西
 *   能省多少、会失去什么？没有这三问，「清理」就只能靠猜，而猜着删数据是本仓
 *   最不能犯的错（删错一条消息比占 1MB 严重得多）。
 *
 * 【本层的定位：只算，不删】
 *   · 内核不 import 任何存储模块、不出现 `setItem` / `writeReceipt` / `storage.set`；
 *   · 一切读数由调用方以 `entries`（键 + 层 + 原始串）喂进来 —— 本层不认识存储；
 *   · 清理只有**差异预览**（`applied:false` / `dryRun:true`），执行的权力不在内核里。
 *   这条边界是刻意的：占用统计要读全量键面，是「最容易被顺手写成顺手清一清」的地方。
 *
 * 【四条不塌的口径（每条都有判据钉着）】
 *   ① 读不出 ≠ 没数据：`readable:false` 一律 `unknown` + 具体理由，绝不画「占用 0 字节」。
 *      理由：`0 字节`会被读成「这台手机是空的」，而真相是「这次没读到」——处置相反。
 *   ② 归属不明单独成桶：家族名不在已知 App id 里、也没有登记过别名的键，进 `unmapped`，
 *      **不摊进任何 App**。否则任何一家都可能被算高（用户据此删东西就删错了对象）。
 *   ③ 字节口径是 **UTF-8 实际字节**，不是 `String.length`：中文一个字 3 字节，
 *      `.length` 会把「微信里几千条中文消息」少算三倍，那正好是占用最大的地方。
 *   ④ 预览必须写「会失去什么」，且 `applied` 恒为 `false`：只有数字没有代价的预览，
 *      会让人以为「清理是免费的」；而快照清掉之后，时光机就回不到那些时刻了。
 *
 * 【已知边界（如实写在头注里，不留给读者猜）】
 *   · 清理策略是**闭集**（`CLEAN_POLICIES`）：本版只认「旧快照裁剪」与「使用统计重置」。
 *     别的键族即使很大，也只会出现在占用榜上，不会变成一条可执行的清理项 ——
 *     因为本版没有为它们写过「删了会失去什么」这句话，没写过就不许删。
 *   · 增长趋势只在**同一会话内**可比：本层不落盘基线（落基线要写盘，而写盘正是
 *     这一层不该有的权力）。跨轮丢了基线就如实说 `unknown`，不拿 0 当基线。
 * ======================================================== */

/** 面状态：算得出 / 算不出（二态，不设「大概」）。本层只产出这两个值，故不外导出。 */
const STATE_OK = 'ok';
const STATE_UNKNOWN = 'unknown';

/** `unknown` 的理由码（闭集：视图文案与判据都对着它说话）。 */
export const GROWTH_REASONS = Object.freeze({
    NO_STORAGE: 'no-storage',
    KEY_FACE_UNREADABLE: 'key-face-unreadable',
    NO_KEYS: 'no-keys',
    NO_BASELINE: 'no-baseline'
});

/** 归属不明桶的 id 与中文名（**单独成行**，不摊进任何 App）。 */
export const UNMAPPED = 'unmapped';
export const UNMAPPED_LABEL = '未归属（没有登记过的键族）';

/** 字节口径说明（视图直接展示，避免「多少字节」被读成「多少字」）。 */
export const BYTE_BASIS = 'UTF-8 实际字节（中文一个字 3 字节；不是 String.length）';

/** 使用统计的键（与 config/usage-tracker.js 的 USAGE_KEY 同一件事）。 */
export const USAGE_KEY = 'usage_stats_v1';

/** 清旧快照时保留最近几个（含最新的那个）。 */
export const SNAPSHOT_KEEP = 3;

/**
 * 键族 → App id 的别名表（**只收能指出出处的**）。
 * 出处逐个写明，因为这些映射一旦写错，占用就会被算到别人头上：
 *   rh_    → backupdesk（RH_KEY 定义在 apps/backupdesk/backupdesk-app.js）
 *   share_ → backupdesk（SHARE_KEY 同上）
 *   usage_ → usage（SETTINGS_KEY / PARADIGM_KEY / usage_stats_v1 都在 usage-app / usage-tracker）
 *   calendar_memos → calendar（family 为 calendar，恰好等于 App id，无需别名）
 * 其余一律进 `unmapped` —— 宁可少算一家，不许算错一家。
 */
export const KEY_ALIASES = Object.freeze({
    rh: 'backupdesk',
    share: 'backupdesk',
    usage: 'usage'
});

/**
 * 清理策略闭集。
 * 每条必须自带 `loss`（删了会失去什么）与 `recoverable`（删了能不能再长回来）。
 * **没有 `loss` 的策略不许存在** —— 判据扫这一段。
 */
export const CLEAN_POLICIES = Object.freeze([
    Object.freeze({
        id: 'snapshot-prune',
        label: '裁掉旧恢复点（保留最近 ' + SNAPSHOT_KEEP + ' 个）',
        loss: '被裁掉的那些时刻**再也回放不到**：时光机的时刻表里会少掉它们，且恢复点存的是键面原文，删了不会自己长回来。',
        recoverable: false
    }),
    Object.freeze({
        id: 'usage-history',
        label: '重置使用统计（整键清零）',
        loss: '洞察里的全部使用记录消失：连续天数、每天时长、最常用 App 的排行都从「还没有记录」重新开始。',
        recoverable: false
    })
]);

/** 字节口径：UTF-8 实际字节（手写编码，不依赖 TextEncoder 是否存在）。 */
export function bytesOfText(text) {
    const s = (text === null || text === undefined) ? '' : String(text);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
            /* 代理对：两个 16 位码元合起来是一个 4 字节码位 */
            const d = s.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i += 1; } else n += 3;
        } else n += 3;
    }
    return n;
}

/** 一个已落盘值的字节数（对象按 JSON 序列化算 —— 与它真正占的字节同一件事）。 */
export function bytesOfValue(raw) {
    if (raw === undefined) return 0;
    if (typeof raw === 'string') return bytesOfText(raw);
    try { return bytesOfText(JSON.stringify(raw)); } catch (_e) { return 0; }
}

/** 键族：第一个 `_` 之前的那一段；没有 `_` 就用整键。 */
export function familyOf(key) {
    const k = String(key === null || key === undefined ? '' : key);
    const i = k.indexOf('_');
    return i > 0 ? k.slice(0, i) : k;
}

/**
 * 键 → App id。
 * @param {string} key 存储键
 * @param {object} opts `{ knownIds: string[] }`（App id 真源由调用方注入，内核不 import apps.js ——
 *   那会为了一个显示名把整张图标表拉进纯函数层）
 * @returns {string} App id，或 `UNMAPPED`（**不许回落成任何一个具体 App**）
 */
export function appOfKey(key, opts = {}) {
    const fam = familyOf(key);
    const known = Array.isArray(opts.knownIds) ? opts.knownIds : [];
    if (known.indexOf(fam) >= 0) return fam;
    const alias = KEY_ALIASES[fam];
    if (alias) return alias;
    return UNMAPPED;
}

/**
 * 占用测量（纯函数）。
 * @param {Array<{key:string, layer:string, bytes?:number, raw?:any, failed?:boolean}>} entries
 *   调用方已经读过的键面。`failed:true` 表示这个键**读失败**（不是空值）——
 *   它照样计入条数，但字节按 0 记，并在 `unreadableKeys` 里点名，不许伪装成 0 字节的正常键。
 * @param {object} opts `{ readable:boolean, why:string, knownIds:string[], labels:object, basis:string }`
 * @returns {{state:string, reason:string, text:string, rows:Array, unmapped:object, totalBytes:number,
 *   totalKeys:number, basis:string, unreadableKeys:string[]}}
 */
export function measureOccupancy(entries, opts = {}) {
    const readable = opts.readable !== false;
    const why = String(opts.why || '');
    const knownIds = Array.isArray(opts.knownIds) ? opts.knownIds : [];
    const labels = (opts.labels && typeof opts.labels === 'object') ? opts.labels : {};
    const list = Array.isArray(entries) ? entries : [];

    if (!readable) {
        return {
            state: STATE_UNKNOWN, reason: GROWTH_REASONS.KEY_FACE_UNREADABLE,
            text: '键面读不到（' + (why || '宿主未就绪') + '）—— 这是「这次没读到」，不是「手机上没数据」',
            rows: [], unmapped: { id: UNMAPPED, label: UNMAPPED_LABEL, bytes: 0, count: 0, keys: [] },
            totalBytes: 0, totalKeys: 0, basis: BYTE_BASIS, unreadableKeys: []
        };
    }

    const byApp = new Map();
    const unmappedKeys = [];
    const unreadableKeys = [];
    let totalBytes = 0;
    let totalKeys = 0;
    for (const e of list) {
        const key = String((e && e.key) || '');
        if (!key) continue;
        totalKeys += 1;
        const failed = !!(e && e.failed);
        const given = (e && typeof e.bytes === 'number') ? e.bytes : null;
        const bytes = failed ? 0 : (given === null ? bytesOfValue(e ? e.raw : undefined) : given);
        if (failed) unreadableKeys.push(key);
        totalBytes += bytes;
        const app = appOfKey(key, { knownIds });
        if (app === UNMAPPED) {
            unmappedKeys.push({ key, family: familyOf(key), layer: String((e && e.layer) || ''), bytes });
            continue;
        }
        const cur = byApp.get(app) || { id: app, label: labels[app] || app, bytes: 0, count: 0, families: new Set() };
        cur.bytes += bytes;
        cur.count += 1;
        cur.families.add(familyOf(key));
        byApp.set(app, cur);
    }

    const rows = Array.from(byApp.values())
        .map((r) => ({ id: r.id, label: r.label, bytes: r.bytes, count: r.count, families: Array.from(r.families).sort() }))
        .sort((a, b) => (b.bytes - a.bytes) || a.id.localeCompare(b.id));

    unmappedKeys.sort((a, b) => (b.bytes - a.bytes) || a.key.localeCompare(b.key));
    const unmapped = {
        id: UNMAPPED, label: UNMAPPED_LABEL,
        bytes: unmappedKeys.reduce((a, x) => a + x.bytes, 0),
        count: unmappedKeys.length,
        keys: unmappedKeys.slice(0, 8)
    };

    const empty = totalKeys === 0;
    return {
        state: STATE_OK,
        reason: empty ? GROWTH_REASONS.NO_KEYS : '',
        text: empty
            ? '键面读到了，但一条键都没有 —— 这是「确实空」，不是「读不到」'
            : ('共 ' + totalKeys + ' 条键 / ' + totalBytes + ' 字节 · ' + rows.length + ' 个 App 有落盘数据'
                + (unmapped.count ? (' · 另有 ' + unmapped.count + ' 条键归属不明（单列，不摊进任何 App）') : '')),
        rows, unmapped, totalBytes, totalKeys, basis: BYTE_BASIS, unreadableKeys
    };
}

/**
 * 两次测量之间的增长（只比同一个会话里的两次，跨轮没有基线就如实说没有）。
 * @returns {{state:string, reason:string, text:string, rows:Array}}
 */
export function growthBetween(prev, next) {
    if (!prev || prev.state !== 'ok' || !next || next.state !== 'ok') {
        return { state: 'unknown', reason: GROWTH_REASONS.NO_BASELINE, text: '还没有可比的基线（同一个会话里测量两次才有增长读数）', rows: [] };
    }
    const before = new Map((prev.rows || []).map((r) => [r.id, r.bytes]));
    const ids = new Set([...before.keys(), ...(next.rows || []).map((r) => r.id)]);
    const rows = [];
    for (const id of ids) {
        const a = before.has(id) ? before.get(id) : null;
        const nb = (next.rows || []).find((r) => r.id === id);
        const b = nb ? nb.bytes : null;
        if (a === null && b === null) continue;
        rows.push({ id, label: (nb && nb.label) || id, before: a, after: b, delta: (b || 0) - (a || 0) });
    }
    rows.sort((x, y) => (y.delta - x.delta) || x.id.localeCompare(y.id));
    const net = (next.totalBytes || 0) - (prev.totalBytes || 0);
    return {
        state: STATE_OK, reason: '', rows,
        text: '两次测量之间：合计 ' + (net >= 0 ? '+' : '') + net + ' 字节'
            + (rows.length ? ('，变动最大的是 ' + rows[0].label + '（' + (rows[0].delta >= 0 ? '+' : '') + rows[0].delta + ' 字节）') : '，各 App 无变动')
    };
}

/**
 * 清理差异预览（**只预览，不执行**）。
 * @param {object} measured `measureOccupancy` 的返回值
 * @param {object} snapshots 快照台账面 `{ readable:boolean, why?:string, moments:Array<{at:number, bytes:number}> }`
 *   `moments` 由调用方按「新→旧」给；本层只按 `SNAPSHOT_KEEP` 切一刀。
 * @returns {{applied:boolean, dryRun:boolean, items:Array, totalBytes:number, text:string, note:string}}
 */
export function previewCleanup(measured, snapshots = {}) {
    const items = [];

    /* ① 旧快照裁剪：保留最近 SNAPSHOT_KEEP 个，其余可裁。 */
    const snapReadable = snapshots && snapshots.readable === true;
    const moments = Array.isArray(snapshots && snapshots.moments) ? snapshots.moments : [];
    const policy1 = CLEAN_POLICIES.find((p) => p.id === 'snapshot-prune');
    if (!snapReadable) {
        items.push({
            id: policy1.id, label: policy1.label, policyId: policy1.id,
            available: false, reason: 'snapshot-ledger-unreadable',
            count: 0, bytes: 0,
            loss: policy1.loss, recoverable: policy1.recoverable,
            text: '快照台账读不到（' + String((snapshots && snapshots.why) || '未取到') + '）—— 不评这一项，不拿 0 顶替'
        });
    } else {
        const prunable = moments.slice(SNAPSHOT_KEEP);
        items.push({
            id: policy1.id, label: policy1.label, policyId: policy1.id,
            available: true, reason: prunable.length ? '' : 'nothing-to-prune',
            count: prunable.length,
            bytes: prunable.reduce((a, x) => a + (Number(x && x.bytes) || 0), 0),
            keep: Math.min(moments.length, SNAPSHOT_KEEP),
            loss: policy1.loss, recoverable: policy1.recoverable,
            text: prunable.length
                ? ('可裁 ' + prunable.length + ' 个旧恢复点（保留最近 ' + Math.min(moments.length, SNAPSHOT_KEEP) + ' 个），可释放 '
                    + prunable.reduce((a, x) => a + (Number(x && x.bytes) || 0), 0) + ' 字节')
                : ('恢复点共 ' + moments.length + ' 个，没有超过保留数的 —— 这一项现在没有可裁的')
        });
    }

    /* ② 使用统计重置：整键大小。 */
    const policy2 = CLEAN_POLICIES.find((p) => p.id === 'usage-history');
    const statsBytes = Number(snapshots && snapshots.usageBytes);
    const statsKnown = Number.isFinite(statsBytes) && statsBytes >= 0;
    items.push({
        id: policy2.id, label: policy2.label, policyId: policy2.id,
        available: statsKnown && (measured ? measured.state === 'ok' : false),
        reason: (statsKnown && measured && measured.state === 'ok') ? (statsBytes > 0 ? '' : 'nothing-to-clear') : 'usage-stats-unreadable',
        count: statsKnown && statsBytes > 0 ? 1 : 0,
        bytes: statsKnown ? statsBytes : 0,
        loss: policy2.loss, recoverable: policy2.recoverable,
        text: !statsKnown
            ? '使用统计读不到 —— 不评这一项，不拿 0 顶替'
            : (statsBytes > 0
                ? ('可重置 1 条统计键，可释放 ' + statsBytes + ' 字节')
                : '使用统计键是空的，没有可清的内容')
    });

    const totalBytes = items.reduce((a, x) => a + (x.bytes || 0), 0);
    return {
        applied: false,
        dryRun: true,
        items,
        totalBytes,
        text: totalBytes
            ? ('按当前策略最多可释放 ' + totalBytes + ' 字节（只预览，未执行）')
            : '按当前策略没有可释放的字节（这不等于「已经清理过」）',
        note: '本层只做差异预览：`applied` 恒为 false —— 清不清、何时清，由用户按下按钮后另行决定。'
    };
}

/** 面级一句话（视图结论行与判据共用，不各写一份）。 */
export function faceTextOf(measured, preview, growth) {
    const m = measured || {};
    if (m.state === 'unknown') return m.text || '占用算不出（这是「没读到」，不是「没有数据」）';
    const head = m.text || '';
    const tail = preview && preview.totalBytes ? (' · ' + preview.text) : '';
    const g = (growth && growth.state === 'ok') ? (' · ' + growth.text) : '';
    return head + tail + g;
}

/**
 * 读回对拍：屏上显示的数字与内核算出的数字是否一致。
 * ★ `unknown` 与 `same` 不是一回事：没有测量 / 没有回读，一律 unknown，不许说成「一致」。
 */
export function judgeGrowthApplied(measured, seen) {
    if (!measured || measured.state !== 'ok') return { state: 'unknown', reason: 'no-measurement', text: '还没测量过，无从对拍' };
    if (!seen || typeof seen !== 'object') return { state: 'unknown', reason: 'no-readback', text: '界面没有回读到数字，不能判定一致' };
    const total = Number(seen.totalBytes);
    const rows = Number(seen.rows);
    if (!Number.isFinite(total) || !Number.isFinite(rows)) {
        return { state: 'unknown', reason: 'readback-not-numeric', text: '回读到的不是数字（界面可能没画出来），不能判定一致' };
    }
    const same = total === measured.totalBytes && rows === measured.rows.length;
    return {
        state: same ? 'same' : 'mismatch',
        reason: same ? '' : 'readback-differs',
        text: same
            ? ('屏上数字与内核一致：' + total + ' 字节 / ' + rows + ' 行')
            : ('屏上 ' + total + ' 字节 / ' + rows + ' 行，内核 ' + measured.totalBytes + ' 字节 / ' + measured.rows.length + ' 行 —— 不一致')
    };
}
