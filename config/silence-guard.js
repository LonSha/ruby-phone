/* ============================================================
 * config/silence-guard.js — 沉默降级告警面（三类沉默各一句话）[v3.4.2 · F-5]
 * ------------------------------------------------------------
 * 【治的欠债】本仓所有上游读数面都有各自的「坏消息」出口（桥未连接、投影缺席、
 *   注入被裁……），但**有一类坏消息没有任何出口：什么都没发生**。三类具体形态：
 *     ① 桥在、快照也读得到，但**久未更新** —— 每张卡都显示「就绪」，而数据停在半小时前；
 *     ② 注入读数**连续多轮停在 pending** —— 每轮都是「还没结束」，没有一轮落地；
 *     ③ 投影**长期 empty** —— 上游管线在跑，但每轮都没装成，读数看着「正常」。
 *   三种都不是报错，页面上没有任何一行是红的 —— 这正是它们危险的原因：
 *   **沉默的降级与沉默的正常，在读数上长得一模一样。**
 *
 * 【口径纪律（与 diagnose-data.js 的三条同规格，外加一条本模块特有的）】
 *   ① 只读：只读诊断中心已经取好的那包读数（`pkg`），不自己摸桥、不自己取快照；
 *   ② 不抛：任一段抛错一律降级为空告警表（诊断面自己坏掉不能连坐主流程）；
 *   ③ 不猜：判不出来就说「判不出来」（阈值未达 ⇒ 不给告警，也不给「一切正常」的结论）；
 *   ④ **本模块的台账不是读数缓存**（这条要说清楚，否则会被下面那条纪律误伤）：
 *      诊断中心有一条「不缓存读数，每次 render 现取」的铁律 —— 它的目的是**不让页面上
 *      出现陈旧读数**。而「连续 N 轮」这件事**在原理上就需要跨轮记忆**：
 *      单次 render 看不到「上一轮是什么」。故这里的台账**只记计数与轮次身份**、
 *      不记任何读数内容；页面显示的值仍然来自当次 `pkg`。
 *      ⇒ 台账既不产生陈旧读数，也不构成第二份真源。
 *
 * 【刻意不做的事（不是遗漏，是纪律）】
 *   · **不弹窗**：诊断页是「你想看的时候去看」的地方；把这三类沉默做成弹窗＝把
 *     「安静地降级」换成「吵闹地降级」，而用户对它无能为力（这是上游或宿主的事）。
 *     故只进诊断页，且只给一句话 + 证据，不给行动号召。
 *   · 不自动重启 / 不重试 / 不修上游：本模块只回答「是不是沉默了」。
 *   · 不设「一切正常」的绿灯结论：判据是「没到阈值」⇒ 输出空表，而不是输出「健康」。
 * ============================================================ */
'use strict';

/* ── 阈值（一张显式表；调它即调判据，须同步套件）── */
export const SILENCE_THRESHOLDS = Object.freeze({
    snapshotStaleMs: 5 * 60 * 1000,   // ① 快照超过 5 分钟没更新
    pendingStreak: 3,                 // ② 注入连续 3 轮 pending
    emptyStreak: 3                    // ③ 投影连续 3 轮 empty（在跑但没装成）
});

/* ── 台账：模块级、按宿主窗口弱引用。只存「计数 + 轮次身份」，不存读数内容。 ── */
const LEDGERS = new WeakMap();

function hostWindow(win) {
    if (win && typeof win === 'object') return win;
    return (typeof window !== 'undefined') ? window : null;
}

/** 取（或建）某宿主的台账。拿不到宿主窗口时返回 null（如实放弃记账，不抛）。 */
function ledgerOf(w, create) {
    if (!w || typeof w !== 'object') return null;
    let L = LEDGERS.get(w);
    if (!L) {
        if (!create) return null;
        L = {
            /* 注入 pending 连续轮数：以「注入读数里的 round」为轮次身份去重，
             *   同一轮被 render 多次不会重复计数（否则开关一次诊断页就凑够阈值）。
             *   round 取不到时退回「outcome 变化才计数」。 */
            pending: { streak: 0, lastRound: null, lastOutcome: null },
            /* 投影 empty 连续轮数：以「快照导出时刻」为轮次身份去重（同一次导出多次 render 只算一轮）。 */
            empty: { streak: 0, lastRoundKey: null, lastRunAsEmpty: null },
            cycles: 0
        };
        LEDGERS.set(w, L);
    }
    return L;
}

/** 测试/诊断用：读台账快照（只读投影，不含读数内容）。 */
export function silenceLedgerFace(win) {
    const L = ledgerOf(hostWindow(win), false);
    if (!L) return { cycles: 0, pendingStreak: 0, pendingLastRound: null, emptyStreak: 0, emptyLastRoundKey: null };
    return {
        cycles: L.cycles,
        pendingStreak: L.pending.streak,
        pendingLastRound: L.pending.lastRound,
        emptyStreak: L.empty.streak,
        emptyLastRoundKey: L.empty.lastRoundKey
    };
}

/** 测试/诊断用：清台账（不在产品路径上调用）。 */
export function resetSilenceLedger(win) {
    const w = hostWindow(win);
    if (w && typeof w === 'object') LEDGERS.delete(w);
}

/**
 * 记一轮读数（由诊断中心在每次取数后调用一次）。只更新计数与轮次身份。
 * @param {object} win 宿主窗口
 * @param {object} pkg collectDiagnose 的返回包
 */
export function noteSilenceCycle(win, pkg) {
    try {
        const L = ledgerOf(hostWindow(win), true);
        if (!L) return;
        const p = pkg || {};
        L.cycles += 1;

        /* ② 注入 pending：轮次身份优先用 round，退化用 outcome 变化 */
        const inj = p.injection || null;
        const outcome = inj ? String(inj.outcome === undefined ? '' : inj.outcome) : null;
        const round = (inj && inj.round !== undefined && inj.round !== null) ? String(inj.round) : null;
        const pend = L.pending;
        const sameRoundAsBefore = (round !== null && round === pend.lastRound);
        if (!sameRoundAsBefore) {
            if (outcome === 'pending') pend.streak += 1;
            else pend.streak = 0;                 // 离开 pending 即清零（含 completed/aborted/无读数）
            pend.lastRound = round;
            pend.lastOutcome = outcome;
        } else if (outcome !== 'pending') {
            pend.streak = 0;                      // 同一轮内变成非 pending（结束落地）⇒ 清零
            pend.lastOutcome = outcome;
        }

        /* ③ 投影 empty：轮次身份用**快照导出时刻**（同一次导出多次 render 只算一轮） */
        const emptyL = L.empty;
        const runAsEmpty = isEmptyProjection(p.projection);
        const snapAt = readSnapshotAt(p);
        const roundKey = (snapAt !== null)
            ? String(snapAt)
            /* 拿不到导出时刻时按「每两轮算一轮」的保守口径 ——
             *   宁可晚报警，不可因为多开关几次诊断页就把阈值凑满（噪声报警会被读者学会忽略）。 */
            : 'cycle:' + Math.floor(L.cycles / 2);
        if (roundKey !== emptyL.lastRoundKey || (emptyL.lastRunAsEmpty !== null && emptyL.lastRunAsEmpty !== runAsEmpty)) {
            if (runAsEmpty) emptyL.streak += 1;
            else emptyL.streak = 0;
            emptyL.lastRoundKey = roundKey;
            emptyL.lastRunAsEmpty = runAsEmpty;
        }
    } catch (_e) { /* 记账失败不影响读数面 */ }
}

/** 投影「在跑但没装成」：reason=ready（管线跑过）且 available=false，或 items 全空 */
function isEmptyProjection(pj) {
    try {
        if (!pj || typeof pj !== 'object') return false;
        if (pj.reason !== 'ready') return false;               // 只有「跑过」才谈空
        const avail = pj.sourceLedger && pj.sourceLedger.available === true;
        if (avail !== true) return true;                        // 管线跑了但不可用 ⇒ 空
        const vis = pj.visibility || {};
        const ids = Object.keys(vis);
        if (ids.length === 0) return true;                      // 一个投影都没装 ⇒ 空
        return ids.every((id) => vis[id] === 'withheld');       // 全部缺席 ⇒ 空
    } catch (_e) { return false; }
}

/* ── 三类沉默的**告警标识**（单一真源）+ 文案表 ──
 * 为什么要有 ID 常量而不是在各处手写字符串：① 调用方（诊断卡 / 控制器 / 套件）
 *   需要按 id 分辨三类，手写字符串就是「同一口径抄 N 份」的种子；
 *   ② 键形本身有纪律 —— 本仓真源的归因常量一律**连字符形**
 *   （`no-clock-face` / `engine-absent` / `pipeline-absent`），而下划线形是另一套形状；
 *   两套形状并存正是 v2.98 那条缺陷（表的键与真源常量值不同形 ⇒ 查不到、静默走兜底、
 *   多种处境显示成同一句话）。故本模块一律连字符形，且文案表用**计算键**引用常量
 *   （第九道门 J7 直接判这个：`*_TEXT` 表不得手写键）。 */
export const SILENCE_ALERT_IDS = Object.freeze({
    staleSnapshot: 'stale-snapshot',
    pendingStreak: 'pending-streak',
    projectionEmpty: 'projection-empty'
});

/* ── 三类沉默的文案（每类一句话；未知一律如实说判不出来，不给结论） ── */
const ALERT_TEXT = Object.freeze({
    [SILENCE_ALERT_IDS.staleSnapshot]: '上游桥在，但快照已超过 %s 分钟没有更新 —— 页面上的每个数字都停在那一刻。',
    [SILENCE_ALERT_IDS.pendingStreak]: '上游注入读数连续 %s 轮停在「进行中」—— 没有任何一轮落地成结局。',
    [SILENCE_ALERT_IDS.projectionEmpty]: '上游投影管线在跑，但连续 %s 轮没有装成任何一项 —— 看起来「正常」的空，和「没跑」是两回事。'
});

/**
 * 算这一轮的三类沉默告警（纯读 + 只读台账；不写任何宿主状态）。
 * @param {object} win
 * @param {object} pkg collectDiagnose 的返回包
 * @returns {Array<{id:string, text:string, evidence:object}>}
 */
export function silenceAlerts(win, pkg) {
    const out = [];
    try {
        const w = hostWindow(win);
        const p = pkg || {};

        /* ① 快照陈旧：桥在（探针说自己挂上了）且快照给了 exportedAt，且距今超阈值 */
        const probe = p.probeSelf || null;
        const snapAt = readSnapshotAt(p);
        if (probe && probe.mounted === true && snapAt !== null) {
            const ageMs = Date.now() - snapAt;
            if (ageMs >= SILENCE_THRESHOLDS.snapshotStaleMs) {
                const mins = Math.floor(ageMs / 60000);
                out.push({
                    id: SILENCE_ALERT_IDS.staleSnapshot,
                    text: ALERT_TEXT[SILENCE_ALERT_IDS.staleSnapshot].replace('%s', String(mins)),
                    evidence: { ageMs, exportedAt: snapAt, thresholdMs: SILENCE_THRESHOLDS.snapshotStaleMs }
                });
            }
        }

        /* ② 注入连续 pending：计数来自台账（跨轮记忆），读数来自当次 pkg */
        const L = ledgerOf(w, false);
        const inj = p.injection || null;
        if (L && inj && String(inj.outcome || '') === 'pending' && L.pending.streak >= SILENCE_THRESHOLDS.pendingStreak) {
            out.push({
                id: SILENCE_ALERT_IDS.pendingStreak,
                text: ALERT_TEXT[SILENCE_ALERT_IDS.pendingStreak].replace('%s', String(L.pending.streak)),
                evidence: { streak: L.pending.streak, round: L.pending.lastRound, threshold: SILENCE_THRESHOLDS.pendingStreak }
            });
        }

        /* ③ 投影长期 empty（同样的跨轮计数口径） */
        if (L && isEmptyProjection(p.projection) && L.empty.streak >= SILENCE_THRESHOLDS.emptyStreak) {
            out.push({
                id: SILENCE_ALERT_IDS.projectionEmpty,
                text: ALERT_TEXT[SILENCE_ALERT_IDS.projectionEmpty].replace('%s', String(L.empty.streak)),
                evidence: { streak: L.empty.streak, at: L.empty.lastRoundKey, threshold: SILENCE_THRESHOLDS.emptyStreak }
            });
        }
        return out;
    } catch (_e) {
        /* 不抛：诊断面自己坏掉不得连坐。
         * ★ 但这条纪律有个**必须留痕的自伤面**（本版真踩过）：一旦内部出错，返回的是
         *   **空表**，而空表与「三类都不沉默」同形 —— 即**沉默检测器自己沉默地失败了**。
         *   实测踩法：把 id 常量与文案表键改成两套形状后忘了同步取值处，`ALERT_TEXT[...]`
         *   取到 undefined、`.replace` 抛 TypeError，被这里吞掉 ⇒ 告警永远为空、页面永远「正常」。
         *   故套件必须有一组**正向可观测**的判据（B2/B3/B5 会真造场景并要求真报警），
         *   只判「不抛」是不够的 —— 只判不抛等于给这条静默留了后门。 */
        return out;
    }
}

/** 快照导出时刻（毫秒）。拿不到一律 null（不猜、不用 render 时刻冒充）。
 *  ★ 刻意**不依赖 probeSelf**：读「快照是什么时候导出的」与「桥挂没挂上」是两件事，
 *   首版把它挂在 `if (!probe) return null` 后面 ⇒ 没有 probe 自述的包一律拿不到时刻，
 *   连带让「投影 empty 连续轮数」退化成按 render 次数估算（探针实测暴露出这一耦合：
 *   同一场景下本应第 3 轮报警，实际第 4 轮才报）。两者各自独立判定，「能不能判」由调用点决定。 */
function readSnapshotAt(p) {
    try {
        if (p.snapshotAt !== undefined && p.snapshotAt !== null) {
            const n = Number(p.snapshotAt);
            return Number.isFinite(n) ? n : null;
        }
        /* 退路：同一份快照里的投影导出时刻（上游 envelope 的 generatedAt） */
        const pj = p.projection || null;
        if (pj && typeof pj === 'object' && pj.generatedAt !== undefined && pj.generatedAt !== null) {
            const n = Number(pj.generatedAt);
            return Number.isFinite(n) ? n : null;
        }
        return null;
    } catch (_e) { return null; }
}

/** 一句话总述（与 diagnose-data.summarizeDiagnose 同规格：有坏消息先说坏消息） */
export function silenceSummary(alerts) {
    const list = Array.isArray(alerts) ? alerts : [];
    if (list.length === 0) return '';
    return list.map((a) => a.text).join(' ');
}