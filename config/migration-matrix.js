/**
 * config/migration-matrix.js — 存储迁移兼容矩阵 [R26-O6]
 *
 * 【要解决的问题】config/storage.js 有 schema v2 与迁移台账，但「哪版数据能升到哪版」
 * 从来没有矩阵。没有矩阵就只能靠「能读就算好」，而那正是静默降级。
 *
 * 【纪律】
 *   ① MIGRATION_EDGES 是唯一真源：没登记的边一律拒载，不造边、不试跑；
 *   ② 证据先于矩阵：归属证据（chatKey/cardKey/savedChatKey/savedCardKey）不齐就不迁，
 *      且既不当 allow 也不当拒绝，而是 need-evidence（欠哪些逐个点名）；
 *   ③ 旧键只搬家不销毁：archiveKeys 一律 legacy_backup:<kind>:<oldKey>；
 *   ④ 迁移必须报数：migrationCounts 给出动几组/归档几键/跳几条/拒几条，
 *      并与 archiveKeys 对拍（allow 时归档键数必须相等，否则计划自相矛盾，不许执行）。
 *
 * 【报数的出处】Dream fish 的启动迁移会打一行
 *   「🧩 [事件盒] 自动合并 X 组，重指向 Y 条」
 *   迁移只喊「升了」无法对账；必须报数。但源的 safeCall 把失败只 console.error，
 *   属静默降级，本模块不照抄：计不自洽一律 consistent=false 并点名。
 *
 * 【三态】verdict 闭集：noop / allow / skip / need-evidence / refuse。
 *   缺证据是 need-evidence，不是 refuse —— 这两者混同就成了「不迁」的借口。
 */

/** 旧键归档前缀（唯一真源）。 */
export const LEGACY_PREFIX = 'legacy_backup:';

/** 归属证据字段（闭集）。少一项就不迁。 */
export const EVIDENCE_FIELDS = ['chatKey', 'cardKey', 'savedChatKey', 'savedCardKey'];

/** 迁移边（唯一真源）。steps 是可执行顺序，不是注释。 */
export const MIGRATION_EDGES = [
    {
        from: 1,
        to: 2,
        why: '1 代把聊天与角色卡挂在同一组键上，2 代按 (chat, card) 隔离；逐字段可映射，不丢信息',
        steps: ['retain-legacy', 'write-isolated', 'advance-ledger']
    }
];

function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
}

/** 旧键归档名：不动原值语义，只换前缀。缺 kind 要如实写 unknown，不许猜。 */
export function archiveKeyOf(kind, oldKey) {
    const k = str(kind) || 'unknown';
    return LEGACY_PREFIX + k + ':' + str(oldKey);
}

/** 幂等键：同一次迁移只能真跑一次。换聊天必须重算。 */
export function idempotencyKeyOf(chatKey, cardKey, from, to) {
    return 'mig:' + Number(from) + '>' + Number(to) + '@' + str(chatKey) + '#' + str(cardKey);
}

/** 查边。没登记就是 null —— 不许造边。 */
export function edgeOf(from, to, edges) {
    const list = Array.isArray(edges) ? edges : MIGRATION_EDGES;
    const f = Number(from);
    const t = Number(to);
    for (const e of list) {
        if (Number(e.from) === f && Number(e.to) === t) return e;
    }
    return null;
}

/** 出迁移计划。纯函数：不改任何存储，只给裁决。 */
export function planMigration(input) {
    const i = input && typeof input === 'object' ? input : {};
    const face = i.face && typeof i.face === 'object' ? i.face : {};
    const ev = i.evidence && typeof i.evidence === 'object' ? i.evidence : {};
    const out = { verdict: 'refuse', reason: '', needs: [], steps: [], idempotencyKey: '', archiveKeys: [] };
    const state = str(face.state);
    const from = Number(face.version) || 0;
    const to = Number(face.current) || 0;

    if (state === 'current') { out.verdict = 'noop'; out.reason = 'current'; return out; }
    if (state === 'unknown') {
        /* 账本缺失/损坏：无从判断它是什么代。不许猜（猜错就是静默降级）。 */
        out.reason = 'unknown-schema';
        out.needs = ['migration-ledger'];
        return out;
    }
    if (state === 'future') {
        /* 更新版插件写的档：按当前口径读可能误读。必须说出来，不许「能读就算好」。 */
        out.reason = 'future-schema';
        out.needs = ['downgrade-path-unavailable'];
        return out;
    }

    /* ---- legacy：先证据后矩阵 ---- */
    const missing = EVIDENCE_FIELDS.filter(function (f) { return !str(ev[f]); });
    if (missing.length) {
        out.verdict = 'need-evidence';
        out.reason = 'evidence:missing';
        out.needs = missing.slice();
        return out;
    }
    /* ① 归属证据：当前聊天必须与档内自述一致 */
    if (str(ev.savedChatKey) !== str(ev.chatKey)) {
        out.reason = 'evidence:chat-mismatch';
        out.needs = ['this-chat-owns-it'];
        return out;
    }
    /* ② 角色卡证据：过渡命名 `character-file:<文件>` 与 `character:/avatar:<id>`
     *    指向同一张卡，所以**两个方向都算同一张**（只认命名过渡；不是「随便不同也放行」）。 */
    const savedCard = str(ev.savedCardKey);
    const liveCard = str(ev.cardKey);
    const isFileKey = function (v) { return v.startsWith('character-file:'); };
    const isLiveKey = function (v) { return /^(character:|avatar:)/.test(v); };
    const transitional = (isFileKey(savedCard) && isLiveKey(liveCard)) || (isLiveKey(savedCard) && isFileKey(liveCard));
    if (!transitional && savedCard !== liveCard) {
        out.reason = 'evidence:card-mismatch';
        out.needs = ['card-ownership'];
        return out;
    }

    const key = idempotencyKeyOf(ev.chatKey, ev.cardKey, from, to);
    out.idempotencyKey = key;
    const done = Array.isArray(i.migratedChats) ? i.migratedChats.map(str) : [];
    if (done.indexOf(key) >= 0) { out.verdict = 'skip'; out.reason = 'already-migrated'; return out; }

    const edge = edgeOf(from, to, i.edges);
    if (!edge) {
        out.reason = 'no-edge';
        out.needs = ['edge:' + from + '>' + to];
        return out;
    }

    out.verdict = 'allow';
    out.reason = 'edge-ok';
    out.steps = Array.isArray(edge.steps) ? edge.steps.slice() : [];
    out.archiveKeys = [archiveKeyOf('card', ev.cardKey), archiveKeyOf('chat', ev.chatKey)];
    return out;
}

/** 矩阵面（诊断卡用）：每一对「from→to」的裁决文字，逐格可见。 */
export function matrixRows(face, edges) {
    const f = face && typeof face === 'object' ? face : {};
    const cur = Number(f.current) || 2;
    const rows = [];
    for (let from = 1; from < cur; from += 1) {
        const e = edgeOf(from, cur, edges);
        rows.push({
            label: from + ' → ' + cur,
            value: e ? ('可升 · ' + e.why) : '**未登记边：拒载**（不许静默降级）'
        });
        const back = edgeOf(cur, from, edges);
        if (!back) rows.push({ label: cur + ' → ' + from, value: '反向降级：无路径，拒载' });
    }
    rows.push({ label: '同代', value: 'noop（不写盘）' });
    return rows;
}

/**
 * 迁移报数（缝自 Dream fish 的「自动合并 X 组，重指向 Y 条」）。
 *
 * 为什么要：迁移只说「升了」无法对账。必须说动了几组、归档几键、跳过几条、拒载几条。
 * 自洽校验（不许自证）：allow 时归档键数必须等于 archiveKeys.length，
 *   否则 consistent=false（计划自相矛盾，不许执行）。
 */
export function migrationCounts(plan) {
    const p = plan && typeof plan === 'object' ? plan : null;
    const out = { moved: 0, archived: 0, skipped: 0, refused: 0, noop: 0, consistent: true, bad: [] };
    if (!p) {
        out.consistent = false;
        out.bad.push('no-plan');
        return out;
    }
    const archived = Array.isArray(p.archiveKeys) ? p.archiveKeys.length : 0;
    switch (p.verdict) {
        case 'allow':
            out.moved = 1;
            out.archived = archived;
            if (archived === 0) {
                out.consistent = false;
                out.bad.push('allow-without-archive-keys');
            }
            break;
        case 'skip':
            out.skipped = 1;
            break;
        case 'noop':
            out.noop = 1;
            break;
        case 'need-evidence':
        case 'refuse':
            out.refused = 1;
            break;
        default:
            out.consistent = false;
            out.bad.push('unknown-verdict:' + String(p.verdict));
    }
    return out;
}

/** 一行报数文案（诊断卡与日志共用）。 */
export function migrationCountsText(plan) {
    const c = migrationCounts(plan);
    const head = '迁移报数：动 ' + c.moved + ' 组（归档 ' + c.archived + ' 键） · 跳 ' + c.skipped + ' · 拒 ' + c.refused + ' · 同代 ' + c.noop;
    if (!c.consistent) return head + ' · **自洽校验失败：' + c.bad.join('、') + '**';
    return head;
}

/** 一句话读数。 */
export function migrationFaceText(plan) {
    const p = plan && typeof plan === 'object' ? plan : null;
    if (!p) return '迁移矩阵：没有计划（没量过）';
    const head = {
        noop: '迁移矩阵：已是当前代，什么都不用做',
        allow: '迁移矩阵：可升 —— 按计划执行 ' + (p.steps || []).join(' → '),
        skip: '迁移矩阵：这条幂等键已迁过（不重跑）',
        'need-evidence': '迁移矩阵：**缺证据，不迁** —— 欠 ' + (p.needs || []).join('、'),
        refuse: '迁移矩阵：**拒载** —— ' + (p.reason || 'unknown')
    }[p.verdict] || ('迁移矩阵：未知结论 ' + String(p.verdict));
    return head;
}

/** 自检：只验纯逻辑，不碰宿主。 */
export function migrationMatrixSelfCheck() {
    const bad = [];
    const ev = { chatKey: 'c1', cardKey: 'character:c1', savedChatKey: 'c1', savedCardKey: 'character-file:c1' };
    const legacy = { state: 'legacy', version: 1, current: 2 };

    for (const e of MIGRATION_EDGES) {
        if (!(Number(e.from) < Number(e.to))) bad.push('边方向错误：' + e.from + '>' + e.to);
        if (!Array.isArray(e.steps) || !e.steps.length) bad.push('边缺步骤：' + e.from + '>' + e.to);
    }

    const allow = planMigration({ face: legacy, evidence: ev });
    if (allow.verdict !== 'allow') bad.push('完整证据却不 allow：' + allow.verdict);
    const cnt = migrationCounts(allow);
    if (!cnt.consistent) bad.push('allow 的计不自洽：' + cnt.bad.join('、'));
    if (cnt.archived !== allow.archiveKeys.length) bad.push('归档计数与 archiveKeys 不等');
    for (const k of allow.archiveKeys) if (!k.startsWith(LEGACY_PREFIX)) bad.push('归档键缺前缀：' + k);

    const cases = [
        [{ face: { state: 'current', version: 2, current: 2 }, evidence: ev }, 'noop'],
        [{ face: { state: 'future', version: 3, current: 2 }, evidence: ev }, 'refuse'],
        [{ face: { state: 'unknown', version: 0, current: 2 }, evidence: ev }, 'refuse'],
        [{ face: legacy, evidence: { chatKey: 'c1' } }, 'need-evidence']
    ];
    for (const [inp, want] of cases) {
        const got = planMigration(inp).verdict;
        if (got !== want) bad.push('裁决不符：' + want + ' vs ' + got);
    }

    const rows = matrixRows({ current: 2 });
    if (!rows.length) bad.push('矩阵面为空');
    for (const r of rows) if (!/可升|拒载|noop/.test(String(r.value))) bad.push('矩阵格无结论：' + r.label);

    return { ok: bad.length === 0, bad: bad };
}
