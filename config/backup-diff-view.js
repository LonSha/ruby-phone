/* ========================================================
 * config/backup-diff-view.js
 * RubyPhone v4.156.0 · R21-X8 备份恢复前的可读差异预览（唯一桥）
 *
 * 【为什么要有这座桥】
 *   计划 R21-X8 的验收语：「预览显示『将恢复 14 个 app、覆盖 3 个现有数据』后再点确认；
 *   对照：取消预览后存档字节级不变。」
 *
 *   修前的真实处境：`apps/backupdesk` 能备份能恢复，`config/recovery-hub.js` 的
 *   `computeSnapshotDiff(snapshot, currentDataMap)` 也早就在算逐键差异
 *   （返回 `{ diffCount, added, modified, removed }`，键是 `chat::k` / `global::k` 形态）。
 *   但玩家在点「确认恢复」之前，**看不到会变成什么样** —— 只有一个键数，
 *   看到 137 个键跟看到「14 个 app、覆盖 3 个现有数据」完全是两回事。
 *   最便宜的补法是最坏的：在视图里现拼一句话。它会把「会覆盖」与「会新增」
 *   说成同一件事 —— 而覆盖是**不可逆**的，新增只是多出来。两者必须分开说。
 *
 * 【本桥只做一件事：翻形状（内核判，桥不重判）】
 *   差异的**算**归 `computeSnapshotDiff`（已有唯一真源）。本桥输入就是它的返回，
 *   不重算、不 import 它、不碰快照与存储 —— 因为重算一次就会有两份口径，
 *   哪天内核改了键形，桥这边静默变成另一个人话。
 *   故本桥**零 IO、零 import 存储层、零写路径**（验收语的对照半边「取消预览后
 *   存档字节级不变」靠的就是这一点：本桥根本没有写的能力）。
 *
 * 【它做实三件内核不做的加工】
 *   ① **键 → 人话**：`wechat_data` → 「微信」之类，未登记的键如实给原键名；
 *   ② **按 app 归并**：把 N 个键归到 M 个 app 上（验收语要的就是 app 数不是键数）；
 *   ③ **覆盖/新增分开说**：覆盖（modified）与新增（added）分别计数、分别列名，
 *      再补一句「移除」（removed = 快照里有而当前没有 ⇒ 恢复后会被写回来）。
 *
 * 【四态分形（本仓最贵的老账：缺席与空必须不同形）】
 *   · 没给差异（diff 读不到）              ⇒ `unavailable`（明说读不到，不当成「没变化」）
 *   · 差异形状不对（不是那个四键对象）      ⇒ `unavailable`（形状不对就不猜）
 *   · 差异算出来了且真零变化              ⇒ `no-change`（**真读数**：恢复也不会变什么）
 *   · 差异算出来了且有变化                ⇒ `preview{...}`
 *   压平 `no-change` 与 `unavailable` 会让「这一下不改变任何东西」和
 *   「我压根没读到」长得一样 —— 前者可以放心点，后者点下去是盲的。
 * ============================================================ */
'use strict';

import { numOrNull } from './num-gate.js';

/** 三态面（闭集）。 */
export const DIFF_FACES = Object.freeze({
    UNAVAILABLE: 'unavailable',
    NO_CHANGE: 'no-change',
    PREVIEW: 'preview'
});

/** 归因码（闭集）。 */
export const DIFF_REASONS = Object.freeze({
    no_diff: '差异没传进来（不是「没变化」）',
    bad_shape: '差异形状不对 —— 不是内核那个四键对象',
    empty: '算得出来，且真的一点都不会变',
    ok: '有变化，预览如下'
});

/** 上限：只影响**列名**条数，不影响计数（计数必须准，列表可以截）。 */
export const DIFF_LIMITS = Object.freeze({
    maxNamesPerBucket: 8,
    maxAppsListed: 12
});

/**
 * 存储键 → 人话 app 名（闭集映射）。
 * 未登记的键**如实给原键名**，不编一个像中文的名字 ——
 * 编了名字的后果是玩家按名字以为是另一个 app，点确认后发现改的不是那个。
 */
export const DIFF_KEY_APP = Object.freeze({
    wechat_data: '微信',
    wechat_moments: '朋友圈',
    wechat_read_cursor: '微信（已读）',
    call_log: '通话',
    sms_data: '短信',
    album_data: '相册',
    music_data: '音乐',
    diary_data: '日记',
    calendar_data: '日程',
    clock_data: '时钟',
    accounting_data: '账本',
    asset_data: '资产',
    piggy_data: '存钱罐',
    task_data: '任务',
    checkin_data: '打卡',
    location_data: '位置',
    poker_data: '扑克',
    block_data: '拉黑',
    bilibili_data: '哔哩哔哩',
    darknet_data: '暗网',
    comms_data: '通讯录',
    chars_data: '角色',
    sys_shell_scale: '系统（缩放）',
    sys_theme: '系统（主题）',
    sys_wallpaper: '系统（壁纸）',
    sys_dark_mode: '系统（深色）',
    sys_dnd: '系统（勿扰）',
    battery_thermo_state: '系统（电量）',
    silence_told_cursor: '系统（静音解释）',
    backup_ledger: '备份台账',
    usage_stats: '使用统计'
});

/**
 * 把内核的键形（`chat::k` / `global::k` / 裸 `k`）拆成面与键。
 * @param {string} full
 * @returns {{scope:string, key:string, full:string}}
 */
export function splitDiffKey(full) {
    const s = String(full == null ? '' : full);
    const at = s.indexOf('::');
    if (at > 0) {
        const scope = s.slice(0, at);
        return { scope, key: s.slice(at + 2), full: s };
    }
    return { scope: '', key: s, full: s };
}

/**
 * 单个键 → 人话名。未登记如实给原键名（**不编名字**）。
 * @param {string} full `chat::wechat_data` 这类键
 * @returns {{app:string, key:string, scope:string, labelled:boolean, full:string}}
 */
export function diffKeyLabel(full) {
    const sp = splitDiffKey(full);
    const named = DIFF_KEY_APP[sp.key];
    return {
        app: named || sp.key,
        key: sp.key,
        scope: sp.scope,
        labelled: !!named,
        full: sp.full
    };
}

/**
 * 主入口：把内核算好的差异翻成人可读的预览。
 *
 * @param {object} input
 *   · `diff`   —— `computeSnapshotDiff()` 的返回（**必填**；缺即 unavailable）
 *   · `label`  —— 这份快照的名字（可选，只用于文案）
 *   · `limits` —— 覆盖列表上限（可选）
 * @returns {{face:string, reason:string, label:string, counts:object,
 *             apps:Array, buckets:object, names:object, line:string, writesNothing:boolean}}
 */
export function backupDiffPreview(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const out = {
        face: DIFF_FACES.UNAVAILABLE,
        reason: 'no_diff',
        label: String(o.label || ''),
        counts: { added: 0, modified: 0, removed: 0, total: 0 },
        apps: [],
        appsTotal: 0,
        buckets: { added: [], modified: [], removed: [] },
        names: { added: [], modified: [], removed: [] },
        line: '',
        writesNothing: true
    };

    /* ① 差异没传进来 ⇒ unavailable。**不许**当成「没变化」。 */
    if (o.diff === undefined || o.diff === null) {
        out.face = DIFF_FACES.UNAVAILABLE;
        out.reason = 'no_diff';
        out.line = diffNote(out);
        return out;
    }
    if (typeof o.diff !== 'object') {
        out.face = DIFF_FACES.UNAVAILABLE;
        out.reason = 'bad_shape';
        out.line = diffNote(out);
        return out;
    }

    /* ② 形状必须真的是那个四键对象。三个数组缺任何一个都算形状不对 ——
     *    只认 diffCount 一个数字就往下走，会把「只有计数没有名单」的情况
     *    当成「有名单但是空的」，等于把读残了画成没变化。 */
    const hasArr = (v) => Array.isArray(v);
    if (!hasArr(o.diff.added) || !hasArr(o.diff.modified) || !hasArr(o.diff.removed)) {
        out.face = DIFF_FACES.UNAVAILABLE;
        out.reason = 'bad_shape';
        out.line = diffNote(out);
        return out;
    }

    const lim = Object.assign({}, DIFF_LIMITS, (o.limits && typeof o.limits === 'object') ? o.limits : {});
    const maxNames = Math.max(1, Math.floor(numOrNull(lim.maxNamesPerBucket) || DIFF_LIMITS.maxNamesPerBucket));
    const maxApps = Math.max(1, Math.floor(numOrNull(lim.maxAppsListed) || DIFF_LIMITS.maxAppsListed));

    const groups = { added: o.diff.added, modified: o.diff.modified, removed: o.diff.removed };
    const appMap = new Map();
    for (const bucket of ['added', 'modified', 'removed']) {
        for (const full of groups[bucket]) {
            const lb = diffKeyLabel(full);
            out.buckets[bucket].push(full);
            if (out.names[bucket].length < maxNames) out.names[bucket].push(lb.app);
            if (!appMap.has(lb.app)) appMap.set(lb.app, { app: lb.app, added: 0, modified: 0, removed: 0, keys: [] });
            const row = appMap.get(lb.app);
            row[bucket] += 1;
            row.keys.push(lb.full);
        }
    }

    const total = out.buckets.added.length + out.buckets.modified.length + out.buckets.removed.length;
    out.counts = {
        added: out.buckets.added.length,
        modified: out.buckets.modified.length,
        removed: out.buckets.removed.length,
        total
    };
    /* 计数与列表分开：计数必须准（截断不许污染它），列表可以截。
     *   这里治的是一个真缺陷：原先 apps 既当计数又当列表，超过上限时
     *   文案会把「18 个 app」报成「12 个 app」—— 玩家按 12 个的量点确认，
     *   实际却动了 18 个。计数不准的话，这个预览比没有更坏。 */
    const appRows = Array.from(appMap.values())
        .sort((a, b) => (b.added + b.modified + b.removed) - (a.added + a.modified + a.removed));
    out.appsTotal = appRows.length;
    out.apps = appRows.slice(0, maxApps);

    /* ③ 真零变化 ⇒ no-change（**真读数**）。这一态与 unavailable 必须不同形。 */
    if (total === 0) {
        out.face = DIFF_FACES.NO_CHANGE;
        out.reason = 'empty';
        out.line = diffNote(out);
        return out;
    }

    out.face = DIFF_FACES.PREVIEW;
    out.reason = 'ok';
    out.line = diffNote(out);
    return out;
}

/**
 * 一行文案（**唯一实现**：视图、诊断面、日志都走这里）。
 * 三种面必须三种不同形：读不到 / 什么都不变 / 有变化。
 * @param {object} r `backupDiffPreview` 的返回
 * @returns {string}
 */
export function diffNote(r) {
    const o = (r && typeof r === 'object') ? r : {};
    const c = (o.counts && typeof o.counts === 'object') ? o.counts : { added: 0, modified: 0, removed: 0, total: 0 };
    /* 用 appsTotal（全量计数），不用 apps.length（可能被截断）。 */
    const appCount = (numOrNull(o.appsTotal) !== null) ? o.appsTotal : (Array.isArray(o.apps) ? o.apps.length : 0);
    const head = o.label ? ('「' + o.label + '」：') : '';
    switch (o.face) {
        case DIFF_FACES.PREVIEW: {
            const parts = [];
            /* 覆盖是**不可逆**的，必须单独先说出来（这是本桥最重要的一句）。 */
            if (c.modified > 0) parts.push('覆盖 ' + c.modified + ' 项现有数据');
            if (c.added > 0) parts.push('新增 ' + c.added + ' 项');
            if (c.removed > 0) parts.push('写回 ' + c.removed + ' 项已删除的');
            return head + '将恢复 ' + appCount + ' 个 app、' + parts.join('、')
                + '（共 ' + c.total + ' 项；确认前存档不会变）';
        }
        case DIFF_FACES.NO_CHANGE:
            return head + '恢复不会改变任何数据 —— 与现状逐键相同';
        case DIFF_FACES.UNAVAILABLE:
        default:
            return head + '差异预览读不到：' + String(DIFF_REASONS[String(o.reason || '')] || o.reason || '未知原因');
    }
}

/**
 * 选择性恢复的默认勾选建议：**只勾新增，不默勾覆盖**。
 *   理由：新增是「多出来」，覆盖是「拿掉你现在的」—— 后者必须玩家自己明确点。
 *   这不是本桥替玩家做决定，而是不让一个默认全选把不可逆操作变成一次误触。
 * @param {object} r `backupDiffPreview` 的返回
 * @returns {Array<string>} 默认勾选的键（full 形）
 */
export function diffDefaultSelection(r) {
    const o = (r && typeof r === 'object') ? r : {};
    if (o.face !== DIFF_FACES.PREVIEW) return [];
    const b = (o.buckets && typeof o.buckets === 'object') ? o.buckets : {};
    return Array.isArray(b.added) ? b.added.slice() : [];
}

/**
 * 结构自检：面表闭集、三态分形、**覆盖与新增分开说**、app 归并、键映射诚实、纯读。
 * 零依赖可独立跑。
 * @returns {{ok:boolean, bad:string[], faces:string[], sample:string}}
 */
export function backupDiffPreviewSelfCheck() {
    const bad = [];
    const faces = Object.values(DIFF_FACES);
    if (new Set(faces).size !== faces.length) bad.push('面表有重复项');
    if (faces.length !== 3) bad.push('面表不是三态（实际 ' + faces.length + '）');

    /* ① 读不到 ⇒ unavailable，且不许与 no-change 同形 */
    const none = backupDiffPreview({ label: '早八点' });
    if (none.face !== DIFF_FACES.UNAVAILABLE) bad.push('没给差异未归 unavailable（被当成没变化了）');
    if (none.reason !== 'no_diff') bad.push('没给差异的归因不对：' + none.reason);

    /* ② 形状不对 ⇒ unavailable（只有 diffCount 没有名单不许硬走） */
    const badShape = backupDiffPreview({ diff: { diffCount: 3 } });
    if (badShape.face !== DIFF_FACES.UNAVAILABLE) bad.push('形状不对未归 unavailable');
    if (badShape.reason !== 'bad_shape') bad.push('形状不对的归因不对：' + badShape.reason);

    /* ③ 真零变化 ⇒ no-change（**真读数**） */
    const empty = backupDiffPreview({ diff: { diffCount: 0, added: [], modified: [], removed: [] } });
    if (empty.face !== DIFF_FACES.NO_CHANGE) bad.push('真零变化未归 no-change');
    if (empty.reason !== 'empty') bad.push('真零变化的归因不对：' + empty.reason);
    if (empty.face === none.face) bad.push('读不到与零变化同形 —— 两种处置被压平了');

    /* ④ 验收语原句：「将恢复 14 个 app、覆盖 3 个现有数据」 */
    const added = [];
    const modified = [];
    const removed = [];
    const appKeys = ['wechat_data', 'album_data', 'music_data', 'diary_data', 'calendar_data',
        'accounting_data', 'asset_data', 'piggy_data', 'task_data', 'checkin_data',
        'location_data', 'poker_data', 'block_data', 'bilibili_data'];
    for (const k of appKeys) added.push('chat::' + k);
    for (const k of ['sys_theme', 'sys_wallpaper', 'sys_dark_mode']) modified.push('global::' + k);
    for (const k of ['call_log']) removed.push('chat::' + k);
    const pv = backupDiffPreview({ diff: { diffCount: 18, added, modified, removed }, label: '早八点' });
    if (pv.face !== DIFF_FACES.PREVIEW) bad.push('有变化未归 preview');
    if (pv.counts.added !== 14) bad.push('新增计数不对：' + pv.counts.added);
    if (pv.counts.modified !== 3) bad.push('覆盖计数不对：' + pv.counts.modified);
    if (pv.counts.removed !== 1) bad.push('移除计数不对：' + pv.counts.removed);
    if (pv.counts.total !== 18) bad.push('总数不对：' + pv.counts.total);
    if (pv.appsTotal !== 18) bad.push('app 归并数不对（应 18 个不同的 app）：' + pv.appsTotal);
    if (!/18 个 app/.test(pv.line)) bad.push('文案里的 app 数不是全量计数：' + pv.line);

    /* ⑤ **覆盖与新增必须分开说**（验收语的核心：覆盖是不可逆的） */
    if (!/覆盖 /.test(pv.line)) bad.push('文案未说「覆盖」：' + pv.line);
    if (!/新增 /.test(pv.line)) bad.push('文案未说「新增」：' + pv.line);
    if (!/将恢复 \d+ 个 app/.test(pv.line)) bad.push('文案未说 app 数：' + pv.line);
    if (pv.line.indexOf('覆盖') > pv.line.indexOf('新增')) bad.push('「覆盖」排在了「新增」后面 —— 不可逆的事必须先说');
    if (!/确认前存档不会变/.test(pv.line)) bad.push('文案未重申「确认前不改盘」：' + pv.line);

    /* ⑥ 键映射诚实：未登记的键如实给原键名，不编名字 */
    const unk = diffKeyLabel('chat::some_new_app_data');
    if (unk.app !== 'some_new_app_data') bad.push('未登记键被编了名字：' + unk.app);
    if (unk.labelled !== false) bad.push('未登记键竟标成已登记');
    const known = diffKeyLabel('chat::wechat_data');
    if (known.app !== '微信') bad.push('已登记键未映射成人话：' + known.app);
    if (known.scope !== 'chat') bad.push('分面拆错：' + known.scope);
    if (known.labelled !== true) bad.push('已登记键未标 labelled');

    /* ⑦ 默认只勾新增，不默勾覆盖（不可逆操作不许一次误触完成） */
    const sel = diffDefaultSelection(pv);
    if (sel.length !== pv.counts.added) bad.push('默认勾选数不等于新增数：' + sel.length);
    for (const full of modified) {
        if (sel.indexOf(full) >= 0) bad.push('默认勾选里出现了覆盖项：' + full);
    }
    const selEmpty = diffDefaultSelection(empty);
    if (selEmpty.length !== 0) bad.push('零变化的默认勾选竟非空');

    /* ⑧ 列表截断但计数必须准（截列表不截计数） */
    const manyAdded = [];
    for (let i = 0; i < 30; i += 1) manyAdded.push('chat::app' + i + '_data');
    const capped = backupDiffPreview({ diff: { added: manyAdded, modified: [], removed: [] }, limits: { maxNamesPerBucket: 5, maxAppsListed: 4 } });
    if (capped.counts.added !== 30) bad.push('截断影响了计数：' + capped.counts.added);
    if (capped.names.added.length !== 5) bad.push('名字列表未按上限截断：' + capped.names.added.length);
    if (capped.apps.length !== 4) bad.push('app 列表未按上限截断：' + capped.apps.length);
    /* 截列表不截计数：30 个 app 被截成 4 条列表，计数必须仍是 30。 */
    if (capped.appsTotal !== 30) bad.push('截断污染了 app 计数：' + capped.appsTotal);
    if (!/30 个 app/.test(capped.line)) bad.push('截断后文案的 app 数错了：' + capped.line);

    /* ⑨ 纯读：本桥不许出现任何写路径（验收语「取消预览后存档字节级不变」就靠这条） */
    const src = String(backupDiffPreview.toString()) + String(diffNote.toString())
        + String(diffKeyLabel.toString()) + String(diffDefaultSelection.toString());
    if (/storage\s*\.\s*set|localStorage|sessionStorage/.test(src)) bad.push('本桥出现了写存储路径');
    if (/restoreSnapshot|restoreSnapshotKeys|writeReceipt/.test(src)) bad.push('本桥出现了恢复写入口');
    if (pv.writesNothing !== true) bad.push('writesNothing 未标 true');

    return {
        ok: bad.length === 0,
        bad,
        faces,
        sample: diffNote(pv)
    };
}
