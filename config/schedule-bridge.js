/* ========================================================
 * config/schedule-bridge.js — [v3.67.0 · 拓展计划 X3 第一切片] 统一日程提醒协议（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   本仓有四套「到点了该提醒什么」的判定，各自只在自己那一格里跑：
 *     · 日历备忘 —— `calendar-app.checkScheduleReminders()` 比**前后两个剧情时刻**，
 *                   命中即 `showNotification('线上日程提示', …)`，幂等键形如
 *                   `calendar-reminder:<dateKey>:<memoId>:<time>`；
 *     · 纪念日   —— `annidate-app.checkAlerts()` 拿**现实时间**判四类（当天 / 前一天 /
 *                   周年 / 周年前一天），幂等键是「距纪元第 N 天」的数字串；
 *     · 周期预警 —— `periodmath-app.tickAlerts()` 拿**现实时间**判 0–3 天窗口，
 *                   幂等键是 `YYYY-MM-DD`；
 *     · 约定     —— `commitment-flow` 有 confirmed / rescheduled 的日期与地点，
 *                   但**判「今天到期」这件事根本没人做**（它只被投影进日历条目）。
 *   三套幂等键三种形态、两种时间基，而没有任何一处回答同一个问题：
 *   「今天该提醒我什么，各自算准了吗」。代价是两类错读数：
 *     ① **时间基混用**：把周期预测按剧情日推进（或反之）—— 同一件事落在两根时间轴
 *        的「同一天」上，用户看到的是错日期的提醒，且**不报错**；
 *     ② **形态不可比**：三个源的键不同形，「谁提醒过、谁没提醒过」无法对账，
 *        于是「取消来源后撤回提醒」这类账根本无处可查。
 *
 * 【本模块的分工（与 config/resume-brief.js 同一范式：只收、只归一、不取数）】
 *   ① **收**：四源的**已判定结果**由调用方取好传进来。算法仍各自只有一份，
 *      本模块**绝不重算**（重算一份就是第二份真源，两处必然漂移）；
 *   ② **判时间基**：每行必须标明落在**剧情时间**还是**现实时间**；剧情基的行在
 *      「剧情时刻读不出」时**一律不产行**（缺剧情钟不拿今天顶替 —— 这是 X3 验收项）；
 *   ③ **归一幂等键**：`<source>:<sourceId>:<dayKey>` 一支笔，三种历史形态在此收口，
 *      使「谁提醒过」第一次可对账（撤回提醒时也才有键可撤）；
 *   ④ **分标事实与预测**：`certainty` 把「剧情 / 用户既定的事实」与「健康预测」
 *      分开（X3 原文：健康预测与剧情既定事实分开标识）。
 *
 * 【不做什么（不是遗漏，是纪律）】
 *   · **不落账、不弹窗、不写存储**：本模块是纯函数，只产建议行；真正投递由调用方
 *     决定，且必须走通知咽喉才吃得到免打扰与落账；
 *   · **不重算算法**：`matchReminders` / `alertGate` / `getReminderDueMemo` 只此一份；
 *   · **不声称已跳到**：`canOpen` 只在**真有一条可用靶心**时为真，且要经
 *     `config/open-ref.js` 归一 —— 「有 sourceId」不等于「点得回去」。
 * ======================================================== */
'use strict';
import { numOrNull } from './num-gate.js';
import { buildOpenRef, normalizeOpenRef, refStr } from './open-ref.js';

/** 时间基：一条提醒落在哪根时间轴上。**不得混用**（X3 原文硬要求）。 */
export const SCHEDULE_TIME_BASES = Object.freeze({ STORY: 'story', REAL: 'real' });

/** 确定性：剧情 / 用户既定的事实，与健康预测分开标识（X3 原文硬要求）。 */
export const SCHEDULE_CERTAINTY = Object.freeze({ FACT: 'fact', PREDICTION: 'prediction' });

/** 投递责任：谁负责把这一行变成一次真通知。
 *   · `self`   —— 该源**已有自己的投递通道**（如日历的那个弹窗），本层只记账不重复投；
 *   · `bridge` —— 该源此前**没有任何投递通道**（只有案头按钮或干脆没有），由本层投。
 *
 *  ★ 为什么必须把这件事写进登记表而不是在调用点临时判断：
 *    同一个源若既被它自己投一次、又被本层投一次，用户会**收到两条一模一样的提醒**，
 *    而两条的 senderKey 不同 ⇒ 通知中心里不合并、看起来像两件事。
 *    这是「时间基不得混用」之外，X3 最容易踩的第二个静默错读数形态。 */
export const SCHEDULE_DELIVERY = Object.freeze({ SELF: 'self', BRIDGE: 'bridge' });

/**
 * 四源登记表。每源钉死三件事：**时间基**、**能不能点回原条目**、**谁负责投递**。
 *   `openable: false` 时必须写明 `why`（判据要求：不许留空口「不支持」）。
 *   投递责任必须与真源实测一致（判据逐源核对调用点，不采信本表自述）。
 */
export const SCHEDULE_SOURCES = Object.freeze({
    'calendar-memo': Object.freeze({
        label: '日历备忘', timeBasis: 'story', certainty: 'fact', kind: '', openable: false,
        deliver: 'self',
        why: '日历条目尚无跨 App 定位口（X2 只接了六个内容桶）'
    }),
    commitment: Object.freeze({
        label: '约定', timeBasis: 'story', certainty: 'fact', kind: '', openable: false,
        deliver: 'bridge',
        why: '约定由日历 App 持有，尚无 openRef 通道'
    }),
    anniversary: Object.freeze({
        label: '纪念日', timeBasis: 'real', certainty: 'fact', kind: 'item', openable: true, why: '',
        deliver: 'bridge'
    }),
    cycle: Object.freeze({
        label: '周期预警', timeBasis: 'real', certainty: 'prediction', kind: '', openable: false,
        deliver: 'bridge',
        why: '这是预测不是既定事实，且周期案头无 openRef 通道'
    })
});

/** 源归因词表（判据按此表逐词核，防随口新词）。 */
export const SCHEDULE_REASONS = Object.freeze({
    OK: '',
    'not-read': '这一源本机没取数（不是「没有到期项」，是「没人去读」）',
    'story-missing': '这一源按剧情时间判，而剧情时刻读不出 —— 不拿今天顶替',
    'story-granularity': '剧情日期只给到月日，无法与日历日对齐',
    'no-open-ref': '该源尚无跨 App 定位口',
    'ref-invalid': '靶心未通过 open-ref 归一'
});

/**
 * 日历日键（本地日期串 `YYYY-MM-DD`）—— **全仓唯一实现**。
 *
 * 为什么必须收口：本仓历史上有两种同义写法各自长在自己的 App 里
 *   （`Math.floor(dayStartOf(now) / 86400000)` 的数字串 与 `YYYY-MM-DD` 串）。
 *   两者语义相同（同一日历日唯一），形态不同 ⇒ 幂等键不可比 ⇒ 对不了账。
 *   本函数是那个「一支笔」：新键一律走它；历史两处的收敛见本迭代段如实登记。
 *
 * @param ms 毫秒时间戳（取不到即 ''，**不猜今天**）
 */
export function dayKeyOf(ms) {
    const n = numOrNull(ms);
    if (n === null || n <= 0) return '';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (v) => (v < 10 ? '0' : '') + v;
    return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * 剧情日期 → 日历日键（**只认年月日齐全**的写法）。
 *   只给月日（`3月15日`）时返回 '' —— 那是「粒度不足以对齐日历日」，
 *   不是「剧情没有日期」，调用方据此给出**可分辨**的归因（见 `story.why`）。
 */
export function storyDayKeyOf(date) {
    const m = String(date == null ? '' : date).trim().match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
    if (!m) return '';
    const y = Number(m[1]), mo = Number(m[2]), dd = Number(m[3]);
    if (!(mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31)) return '';
    return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}

/** 幂等键：`<source>:<sourceId>:<dayKey>`。三者任一缺失即 ''（不产半截键）。 */
export function idemKeyOf(source, sourceId, dayKey) {
    const s = refStr(source), i = refStr(sourceId), d = refStr(dayKey);
    if (!s || !i || !d) return '';
    return s + ':' + i + ':' + d;
}

function listOf(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.items)) return v.items;
    return [];
}

function text(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

/** 造一行建议（唯一的产行出口：所有源都必须经此，形状不可能各家自定）。 */
function rowOf(source, sourceId, dayKey, title, detail, refRaw) {
    const reg = SCHEDULE_SOURCES[source] || {};
    let ref = null;
    let openWhy = reg.openable ? '' : SCHEDULE_REASONS['no-open-ref'];
    if (reg.openable && refRaw) {
        const norm = normalizeOpenRef(refRaw);
        if (norm.ok) ref = { appId: norm.appId, kind: norm.kind, id: norm.id };
        else openWhy = SCHEDULE_REASONS['ref-invalid'] + '（' + norm.why + '）';
    } else if (reg.openable && !refRaw) {
        openWhy = SCHEDULE_REASONS['ref-invalid'] + '（无靶心）';
    }
    return {
        source: refStr(source),
        sourceId: refStr(sourceId),
        timeBasis: refStr(reg.timeBasis) || 'real',
        certainty: refStr(reg.certainty) || 'fact',
        /* 谁负责投递（登记表是唯一真源；行上带一份是为了让投递点不必再查表）。 */
        deliver: reg.deliver === SCHEDULE_DELIVERY.BRIDGE ? SCHEDULE_DELIVERY.BRIDGE : SCHEDULE_DELIVERY.SELF,
        label: refStr(reg.label),
        dayKey: refStr(dayKey),
        title: text(title, 80),
        detail: text(detail, 200),
        idemKey: idemKeyOf(source, sourceId, dayKey),
        /* ★ 不声称：canOpen 只表示「有一条经归一的靶心」，**不表示已经跳过去**。 */
        canOpen: !!ref,
        openWhy: openWhy,
        ref: ref
    };
}

/**
 * 四源归一（本模块的唯一出口）。
 *
 * @param {object} [o]
 *   · `nowMs`             现实时间（**唯一现实时间取数口**，由调用方给；取不到即缺）
 *   · `storyClock`        `config/story-clock.js` 的 `storyClock()` 结果（可缺）
 *   · `anniversaryMatches` 纪念日源的四类命中（**已由 annidate 判好**；`undefined` = 没读）
 *   · `cycleAlert`        周期源的门结果（**已由 periodmath 判好**；`undefined` = 没读）
 *   · `calendarDue`       日历备忘的到期项（**已由 calendarData 判好**；`undefined` = 没读）
 *   · `commitments`       约定 state / items（`undefined` = 没读）
 * @returns {{at:number, story:object, real:object, rows:Array, counts:object, gaps:Array, read:object}}
 */
export function buildScheduleAdvice(o = {}) {
    const src = (o && typeof o === 'object') ? o : {};
    const nowMs = numOrNull(src.nowMs);
    const realDayKey = dayKeyOf(nowMs);
    const real = { nowMs: nowMs, dayKey: realDayKey, valid: !!realDayKey };

    const sc = (src.storyClock && typeof src.storyClock === 'object') ? src.storyClock : null;
    const storyDate = sc ? String(sc.primaryDate || '') : '';
    const storyDayKey = storyDayKeyOf(storyDate);
    const storyWhy = !sc ? 'story-missing'
        : (!storyDate ? 'story-missing' : (!storyDayKey ? 'story-granularity' : ''));
    const story = {
        present: sc ? numOrNull(sc.present) : null,
        date: storyDate,
        dayKey: storyDayKey,
        conflict: !!(sc && sc.conflict === true),
        missing: storyWhy !== '',
        why: storyWhy
    };

    const rows = [];
    const gaps = [];
    const read = { 'calendar-memo': false, commitment: false, anniversary: false, cycle: false };

    /* ── 源 ①：纪念日（现实时间基 / 既定事实 / 可点回原条目） ── */
    if (src.anniversaryMatches === undefined) {
        gaps.push({ source: 'anniversary', reason: SCHEDULE_REASONS['not-read'] });
    } else {
        read.anniversary = true;
        for (const it of listOf(src.anniversaryMatches)) {
            const id = text(it && it.id, 80);
            if (!id) continue;
            /* ★ 靶心走同一支笔：源侧 id 与 App 侧 openRef 认的是同一个 id。 */
            const refRaw = buildOpenRef('item', id, 'annidate');
            rows.push(rowOf('anniversary', id, realDayKey, text(it.title, 80) || '纪念日', text(it.text, 200), refRaw));
        }
    }

    /* ── 源 ②：周期预警（现实时间基 / **预测** / 不可点回） ── */
    if (src.cycleAlert === undefined) {
        gaps.push({ source: 'cycle', reason: SCHEDULE_REASONS['not-read'] });
    } else {
        read.cycle = true;
        const gate = (src.cycleAlert && typeof src.cycleAlert === 'object') ? src.cycleAlert : null;
        if (gate && gate.alert === true) {
            const st = (gate.status && typeof gate.status === 'object') ? gate.status : {};
            /* 源给的门键优先（它是「当日已警过」的判据源），缺则用本机现实日键。 */
            const dk = text(gate.key, 32) || realDayKey;
            rows.push(rowOf('cycle', 'predicted-start', dk, '周期临近（预测）',
                text(st.text, 120) || '临近预警窗口', null));
        }
    }

    /* ── 源 ③：日历备忘（**剧情时间基** —— 剧情时刻读不出时一律不产行） ── */
    if (src.calendarDue === undefined) {
        gaps.push({ source: 'calendar-memo', reason: SCHEDULE_REASONS['not-read'] });
    } else {
        read['calendar-memo'] = true;
        const due = (src.calendarDue && typeof src.calendarDue === 'object') ? src.calendarDue : null;
        if (due && due.skipped !== true) {
            const memo = (due.memo && typeof due.memo === 'object') ? due.memo : {};
            const id = text(memo.id, 80) || text(due.memoId, 80);
            if (id) {
                if (story.missing) {
                    /* ★ 缺剧情钟不拿今天顶替：这一行**不产**，只记可分辨的归因。 */
                    gaps.push({ source: 'calendar-memo', reason: story.why === 'story-granularity' ? SCHEDULE_REASONS['story-granularity'] : SCHEDULE_REASONS['story-missing'] });
                } else {
                    const dk = storyDayKey;
                    rows.push(rowOf('calendar-memo', id, dk, text(due.title, 80) || text(memo.title, 80) || '线上日程',
                        text(due.time, 16) + ' ' + (text(due.title, 80) || text(memo.title, 80)), null));
                }
            }
        }
    }

    /* ── 源 ④：约定（**剧情时间基** —— 本切片之前「判到期」这件事根本没人做） ── */
    if (src.commitments === undefined) {
        gaps.push({ source: 'commitment', reason: SCHEDULE_REASONS['not-read'] });
    } else {
        read.commitment = true;
        const items = listOf(src.commitments);
        if (story.missing) {
            const hasLive = items.some((it) => {
                const st = text(it && it.status, 20);
                return st === 'confirmed' || st === 'rescheduled';
            });
            /* 只有在「确实有活着的约定要判」时才记这条缺口（无约定不算缺口）。 */
            if (hasLive) gaps.push({ source: 'commitment', reason: story.why === 'story-granularity' ? SCHEDULE_REASONS['story-granularity'] : SCHEDULE_REASONS['story-missing'] });
        } else {
            for (const it of items) {
                const st = text(it && it.status, 20);
                if (st !== 'confirmed' && st !== 'rescheduled') continue;
                const id = text(it && it.id, 80);
                if (!id) continue;
                const dk = storyDayKeyOf(text(it.dateKey, 32));
                if (dk !== storyDayKey) continue;   /* 不是今天到期的，不产行 */
                const who = text(it.with, 40) ? text(it.actor, 40) + '与' + text(it.with, 40) : text(it.actor, 40);
                const tail = [text(it.time, 16), text(it.place, 80)].filter(Boolean).join(' ');
                rows.push(rowOf('commitment', id, dk, text(it.content, 80) || '约定',
                    (who ? who + '：' : '') + text(it.content, 120) + (tail ? '（' + tail + '）' : ''), null));
            }
        }
    }

    const bySource = {};
    const byBasis = {};
    const byCertainty = {};
    for (const r of rows) {
        bySource[r.source] = (bySource[r.source] || 0) + 1;
        byBasis[r.timeBasis] = (byBasis[r.timeBasis] || 0) + 1;
        byCertainty[r.certainty] = (byCertainty[r.certainty] || 0) + 1;
    }
    /* 键唯一性自检：同一幂等键出现两次 ⇒ 两源撞车或同源重复产行（落账前必须知道）。 */
    const keys = rows.map((r) => r.idemKey);
    const dupes = [];
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] && keys.indexOf(keys[i]) !== i && dupes.indexOf(keys[i]) < 0) dupes.push(keys[i]);
    }
    return {
        at: Date.now(),
        story: story,
        real: real,
        rows: rows,
        counts: { total: rows.length, bySource: bySource, byBasis: byBasis, byCertainty: byCertainty, duplicateKeys: dupes },
        gaps: gaps,
        read: read
    };
}

/** 一行总述（供诊断中心 / 视图；与 `buildScheduleAdvice` 的分工同 story-clock 那对）。 */
export function scheduleAdviceLine(adv) {
    const a = (adv && typeof adv === 'object') ? adv : buildScheduleAdvice({});
    const c = a.counts || { total: 0, byBasis: {}, byCertainty: {} };
    const basis = SCHEDULE_TIME_BASES;
    const storyN = (c.byBasis && c.byBasis[basis.STORY]) || 0;
    const realN = (c.byBasis && c.byBasis[basis.REAL]) || 0;
    const predN = (c.byCertainty && c.byCertainty[SCHEDULE_CERTAINTY.PREDICTION]) || 0;
    const gaps = Array.isArray(a.gaps) ? a.gaps.length : 0;
    return {
        total: c.total || 0,
        story: storyN,
        real: realN,
        prediction: predN,
        gaps: gaps,
        detail: '剧情基 ' + storyN + ' · 现实基 ' + realN + '（其中预测 ' + predN + '）· 缺口 ' + gaps,
        storyDate: (a.story && a.story.date) || '',
        storyMissing: !!(a.story && a.story.missing)
    };
}

/** 表自检（供门禁 / 诊断调用；磁盘侧由测试独立复算）。 */
export function scheduleBridgeSelfCheck() {
    const problems = [];
    const bases = Object.keys(SCHEDULE_TIME_BASES).map((k) => SCHEDULE_TIME_BASES[k]);
    for (const [name, reg] of Object.entries(SCHEDULE_SOURCES)) {
        if (!name) problems.push('源名称为空');
        if (!reg || typeof reg !== 'object') { problems.push(name + ' 登记项不是对象'); continue; }
        if (bases.indexOf(reg.timeBasis) < 0) problems.push(name + ' 的时间基未登记：' + reg.timeBasis);
        if (reg.certainty !== SCHEDULE_CERTAINTY.FACT && reg.certainty !== SCHEDULE_CERTAINTY.PREDICTION) problems.push(name + ' 的确定性未登记：' + reg.certainty);
        /* 投递责任必须登记：漏登会退化成默认 `self`，于是**没人投**且不报错
         *   （「到点了什么都收不到」是本层最贵的静默形态）。 */
        if (reg.deliver !== SCHEDULE_DELIVERY.SELF && reg.deliver !== SCHEDULE_DELIVERY.BRIDGE) problems.push(name + ' 的投递责任未登记：' + reg.deliver);
        if (!reg.label) problems.push(name + ' 缺 label');
        /* 「不可点回」必须写明理由（否则会退化成一句无信息量的「不支持」）。 */
        if (reg.openable === false && !reg.why) problems.push(name + ' 不可点回却没有写明理由');
        if (reg.openable === true && reg.why) problems.push(name + ' 可点回却写了不可点回的理由');
    }
    /* 幂等键一支笔的自证：同一三元组两次必同键、换任一维必换键。 */
    const k1 = idemKeyOf('anniversary', 'a1', '2026-10-08');
    const k2 = idemKeyOf('anniversary', 'a1', '2026-10-08');
    const k3 = idemKeyOf('anniversary', 'a1', '2026-10-09');
    if (!k1 || k1 !== k2) problems.push('幂等键不稳定');
    if (k1 === k3) problems.push('幂等键未随日键变化');
    if (idemKeyOf('', 'a1', '2026-10-08') || idemKeyOf('anniversary', '', '2026-10-08') || idemKeyOf('anniversary', 'a1', '')) problems.push('幂等键允许半截键');
    /* 剧情日键与现实日键都是「日历日」形，两者可逐字比（这是时间基可对齐的前提）。 */
    if (storyDayKeyOf('2026-10-08') !== '2026-10-08') problems.push('剧情日键归一不正确');
    if (storyDayKeyOf('3月15日') !== '') problems.push('月日粒度未被判为粒度不足');
    if (dayKeyOf(0) !== '' || dayKeyOf(null) !== '') problems.push('缺时间时未如实返回空键');
    return { problems: problems };
}

/* ========================================================
 * 第二件协议物：**提醒账本**（谁提醒过、谁被撤回）
 * --------------------------------------------------------
 * X3 原文的三条要求在这里落地：
 *   「重复计算同一来源事件**按幂等键更新**」→ `diffScheduleLedger` 用 `idemKey` 判重，
 *      同键复算一律算 `replay`（不重投）；
 *   「取消来源后**撤回**对应提醒」→ 账本里 `delivered` 但本轮不再出现的条目转
 *      `withdrawn`（**不删账**：删掉就查不出「提醒过又撤了」这件事）；
 *   「剧情既定事实与健康预测分开标识」→ 账本逐条留 `timeBasis` / `certainty`。
 *
 * ★ 撤回有一道**必须**的门：只对「这一源本轮真读过」的源生效。
 *   源本轮没读（`read[source] !== true`）时它缺席**不是**「被取消了」，
 *   而是「没人去看」—— 拿没读当取消会把提醒静默撤光，正是 X3 验收里
 *   「缺剧情钟不拿今天顶替」同一族错读数（把「不知道」当成「没有」）。
 * ======================================================== */
export const SCHEDULE_LEDGER_VERSION = 1;
/** 账本有界：遥测本身不得成为新的增长源（与 sys_notifs / remindedKeys 同规格）。 */
export const SCHEDULE_LEDGER_LIMIT = 240;
export const SCHEDULE_LEDGER_STATES = Object.freeze({ DELIVERED: 'delivered', WITHDRAWN: 'withdrawn' });
/** 撤回归因（判据按此表逐词核，防随口新词）。 */
export const SCHEDULE_WITHDRAW_REASONS = Object.freeze({
    'source-rewound': '剧情时间回退了：那条未来的提醒还没发生，先撤掉',
    'source-rescheduled': '同一来源改期到另一天：旧日期那条不再成立',
    'source-gone': '这一源本轮真读过，而这条不再出现（来源被取消或删除）'
});

/** 账本归一：无幂等键的条目一律不收（半截键不许进账 —— 进了就永远撤不掉）。 */
export function normalizeScheduleLedger(raw) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const items = Array.isArray(src.entries) ? src.entries : (Array.isArray(raw) ? raw : []);
    const seen = new Set();
    const entries = [];
    for (const it of items) {
        const rec = (it && typeof it === 'object') ? it : {};
        const key = refStr(rec.idemKey);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const state = rec.state === SCHEDULE_LEDGER_STATES.WITHDRAWN
            ? SCHEDULE_LEDGER_STATES.WITHDRAWN : SCHEDULE_LEDGER_STATES.DELIVERED;
        entries.push({
            idemKey: key,
            source: refStr(rec.source),
            sourceId: refStr(rec.sourceId),
            dayKey: refStr(rec.dayKey),
            timeBasis: refStr(rec.timeBasis),
            certainty: refStr(rec.certainty),
            title: text(rec.title, 80),
            /* 投递当时**剧情时刻的日键**。有了它才判得出「剧情时间回退了」：
             *   只比对条目自身的 dayKey 与今天，会把「来源删了」误判成「回档」
             *   （两者处置都是撤回，但用户要能分清是哪种）。 */
            atStoryDay: refStr(rec.atStoryDay),
            state: state,
            firstAt: numOrNull(rec.firstAt) || 0,
            lastAt: numOrNull(rec.lastAt) || 0,
            why: refStr(rec.why)
        });
    }
    return { version: SCHEDULE_LEDGER_VERSION, entries: entries.slice(-SCHEDULE_LEDGER_LIMIT) };
}

/**
 * 对账：把「本轮该提醒什么」与「账本里提醒过什么」比一遍，只算不写。
 * @returns {{notify:Array, replay:Array, withdraw:Array, skippedNoKey:Array, liveKeys:Array, unchanged:number}}
 */
export function diffScheduleLedger(advice, ledger) {
    const adv = (advice && typeof advice === 'object') ? advice : {};
    const rows = listOf(adv.rows);
    const read = (adv.read && typeof adv.read === 'object') ? adv.read : {};
    /* 本轮剧情时刻日键（读不出即 ''）：回档判据的真源是**它**与账本里投递时的日键之差。
     *   取不到就一律不判回档（宁可归因粗一档，也不拿「不知道」当「回退了」）。 */
    const storyDay = refStr(adv.story && adv.story.dayKey);
    const led = normalizeScheduleLedger(ledger);
    const delivered = new Set();
    for (const e of led.entries) {
        if (e.state === SCHEDULE_LEDGER_STATES.DELIVERED) delivered.add(e.idemKey);
    }
    const liveKeys = new Set();
    /* ★ 「这一源的这一条现在还活着吗」必须按**本轮行**建索引 —— 账本只能回答「过去投过什么」。
     *   修前实测：拿账本建索引时，改期这一支永远取到**旧键**，于是「改期」与「取消」
     *   被判成同一个归因（两条归因同形 ⇒ 用户分不清约定是改期了还是被取消了）。 */
    const liveBySourceId = new Map();
    const notify = [];
    const replay = [];
    const skippedNoKey = [];
    for (const r of rows) {
        const rec = (r && typeof r === 'object') ? r : {};
        const key = refStr(rec.idemKey);
        if (!key) {
            /* 键缺失即「算不出该不该再提醒」—— 不投、不记账，但必须留痕（不静默吞）。 */
            skippedNoKey.push({ source: refStr(rec.source), sourceId: refStr(rec.sourceId), why: 'idem-key-missing' });
            continue;
        }
        liveKeys.add(key);
        const pair = refStr(rec.source) + ':' + refStr(rec.sourceId);
        if (rec.source && rec.sourceId) liveBySourceId.set(pair, key);
        if (delivered.has(key)) { replay.push(key); continue; }
        notify.push(rec);
    }
    const withdraw = [];
    for (const e of led.entries) {
        if (e.state !== SCHEDULE_LEDGER_STATES.DELIVERED) continue;
        if (liveKeys.has(e.idemKey)) continue;
        /* ★ 撤回门：源本轮没读 ⇒ 缺席不算取消（见本段头注的错读数形态）。 */
        if (read[e.source] !== true) continue;
        const swapped = (e.source && e.sourceId) ? liveBySourceId.get(e.source + ':' + e.sourceId) : '';
        /* ★ 回档判据：**投递当时的剧情日**晚于**现在**的剧情日 ⇒ 剧情时间回退了。
         *   只对剧情基的行判（现实基行的日期不随回档变化 —— 拿它判会把周期预测也撤掉，
         *   那是把两条时间轴混用，X3 原文第一条硬要求就是不得混用）。 */
        const rewound = (e.timeBasis === 'story') && !!storyDay && !!e.atStoryDay && e.atStoryDay > storyDay;
        const reason = rewound
            ? SCHEDULE_WITHDRAW_REASONS['source-rewound']
            : ((swapped && liveKeys.has(swapped))
                ? SCHEDULE_WITHDRAW_REASONS['source-rescheduled']
                : SCHEDULE_WITHDRAW_REASONS['source-gone']);
        withdraw.push({ idemKey: e.idemKey, source: e.source, sourceId: e.sourceId, dayKey: e.dayKey, why: reason });
    }
    return { notify: notify, replay: replay, withdraw: withdraw, skippedNoKey: skippedNoKey, liveKeys: Array.from(liveKeys), unchanged: replay.length };
}

/** 落账：把一次对账的决定写进账本（纯函数，返回新账本；投递本身由调用方做）。
 *  第三个入参 `atStoryDay` 是**投递当时的剧情日键**（读不出即 ''）——
 *  它是将来判「剧情时间回退了」的唯一依据（见 `diffScheduleLedger` 的回档判据）。 */
export function applyScheduleLedger(ledger, decision, nowMs, atStoryDay) {
    const led = normalizeScheduleLedger(ledger);
    const d = (decision && typeof decision === 'object') ? decision : {};
    const at = numOrNull(nowMs) || Date.now();
    const storyDay = refStr(atStoryDay) || refStr(d.storyDay);
    const map = new Map();
    for (const e of led.entries) map.set(e.idemKey, e);
    for (const r of listOf(d.notify)) {
        const rec = (r && typeof r === 'object') ? r : {};
        const key = refStr(rec.idemKey);
        if (!key) continue;
        map.set(key, {
            idemKey: key,
            source: refStr(rec.source),
            sourceId: refStr(rec.sourceId),
            dayKey: refStr(rec.dayKey),
            timeBasis: refStr(rec.timeBasis),
            certainty: refStr(rec.certainty),
            title: text(rec.title, 80),
            atStoryDay: storyDay,
            state: SCHEDULE_LEDGER_STATES.DELIVERED,
            firstAt: at, lastAt: at, why: ''
        });
    }
    for (const w of listOf(d.withdraw)) {
        const rec = (w && typeof w === 'object') ? w : {};
        const key = refStr(rec.idemKey);
        const prev = map.get(key);
        /* 没投过的不撤回：不凭「缺席」凭空造一笔账出来。 */
        if (!prev) continue;
        prev.state = SCHEDULE_LEDGER_STATES.WITHDRAWN;
        prev.lastAt = at;
        prev.why = refStr(rec.why);
    }
    return normalizeScheduleLedger({ entries: Array.from(map.values()) });
}

/* ========================================================
 * 第三件协议物：**投递载荷**（把一行建议变成一次真通知所需的全部字段）
 * ========================================================
 * 这些字段此前散在各源里各写一遍（日历那处写了 title / message / senderKey / name /
 *   content / timeText / avatarText / avatarBg / avatarColor 九个），本层把它收成一支笔：
 *   哪条通道、键长什么样、气泡长什么样，全部只此一份。
 */

/** 稳定投递键：`schedule:<source>:<sourceId>:<dayKey>`。
 *  为什么不直接拿 `idemKey` 当 senderKey：日历那条现役键形如
 *  `calendar-reminder:<dateKey>:<memoId>:<time>`，两种形态在通知中心的**合并语义**不同
 *  （同键热更新 vs 新增一条），混用会让「同一条提醒」在某次刷新后变成两条。 */
export function scheduleSenderKey(row) {
    const r = (row && typeof row === 'object') ? row : {};
    return 'schedule:' + refStr(r.source) + ':' + refStr(r.sourceId) + ':' + refStr(r.dayKey);
}

/**
 * 拆投递面：本层只投 `deliver === 'bridge'` 的行，`self` 的行**只记账不投**
 * （那个源自己的通道已经投过了，再投一次用户会收到两条）。
 * @returns {{deliver:Array, recordOnly:Array, skippedNoKey:Array}}
 */
export function scheduleDeliveryPlan(rows) {
    const list = listOf(rows);
    const deliver = [];
    const recordOnly = [];
    const skippedNoKey = [];
    for (const it of list) {
        const r = (it && typeof it === 'object') ? it : {};
        if (!refStr(r.idemKey)) { skippedNoKey.push(r); continue; }
        if (r.deliver === SCHEDULE_DELIVERY.BRIDGE) deliver.push(r);
        else recordOnly.push(r);
    }
    return { deliver: deliver, recordOnly: recordOnly, skippedNoKey: skippedNoKey };
}

/** 一行建议 → 一次真通知的载荷（**唯一实现**，投递点不得自己拼一遍）。 */
export function scheduleNoticeOf(row) {
    const r = (row && typeof row === 'object') ? row : {};
    const title = refStr(r.title) || refStr(r.label) || '日程提醒';
    const detail = refStr(r.detail);
    const message = detail || title;
    const source = refStr(r.source);
    const icon = source === 'anniversary' ? '💗' : (source === 'cycle' ? '🩸' : (source === 'commitment' ? '🤝' : '📅'));
    /* 靶心那条 App 必须在**归一后**才用（`canOpen` 就是它的结论），
     *   否则「有 id」会被当成「点得回去」，横幅点击会把用户丢到别人的首屏。 */
    const appId = (r.canOpen === true && r.ref) ? refStr(r.ref.appId) : '';
    return {
        title: refStr(r.label) ? refStr(r.label) + '提醒' : '日程提醒',
        message: message,
        icon: icon,
        senderKey: scheduleSenderKey(r),
        appId: appId,
        meta: {
            appId: appId,
            name: title,
            content: message,
            timeText: refStr(r.dayKey),
            idemKey: refStr(r.idemKey),
            source: source,
            certainty: refStr(r.certainty),
            timeBasis: refStr(r.timeBasis)
        }
    };
}

/** 账本侧自检（与 `scheduleBridgeSelfCheck` 同规格：跑真场景、报可读问题）。 */
export function scheduleLedgerSelfCheck() {
    const problems = [];
    const row = (source, id, dk) => ({
        source: source, sourceId: id, timeBasis: 'story', certainty: 'fact',
        label: source, dayKey: dk, title: 't', detail: 'd',
        idemKey: idemKeyOf(source, id, dk), canOpen: false, openWhy: '', ref: null
    });
    const adv = (rows, read) => ({ rows: rows, read: read, counts: { total: rows.length }, gaps: [] });
    const empty = { version: SCHEDULE_LEDGER_VERSION, entries: [] };
    /* ① 首次投递 → 全进 notify；同一份再对一次账 → 全进 replay（幂等，不重投）。 */
    const a1 = diffScheduleLedger(adv([row('anniversary', 'a1', '2026-10-08')], { anniversary: true }), empty);
    if (a1.notify.length !== 1) problems.push('首轮对账未投出新行');
    if (a1.replay.length !== 0) problems.push('首轮对账把空账本判成了重放');
    const led1 = applyScheduleLedger(empty, a1, 1000);
    if (led1.entries.length !== 1) problems.push('落账条数与投递数不一致');
    if (led1.entries[0].state !== SCHEDULE_LEDGER_STATES.DELIVERED) problems.push('落账状态未置为 delivered');
    const a2 = diffScheduleLedger(adv([row('anniversary', 'a1', '2026-10-08')], { anniversary: true }), led1);
    if (a2.notify.length !== 0 || a2.replay.length !== 1) problems.push('同键复算未被幂等挡住（会重复弹同一条提醒）');
    /* ② 源本轮**没读** ⇒ 缺席**不许**撤回（把「不知道」当「没有」是本仓最贵的反向错读数）。 */
    const a3 = diffScheduleLedger(adv([], { anniversary: false }), led1);
    if (a3.withdraw.length !== 0) problems.push('源未取数时把缺席当成了取消（撤回门失效）');
    /* ③ 源本轮读过且这条不再出现 ⇒ 撤回，且归因是「取消」而非「改期」。 */
    const a4 = diffScheduleLedger(adv([], { anniversary: true }), led1);
    if (a4.withdraw.length !== 1) problems.push('来源取消后未撤回提醒');
    else if (a4.withdraw[0].why !== SCHEDULE_WITHDRAW_REASONS['source-gone']) problems.push('撤回归因未分辨「取消」与「改期」');
    const led2 = applyScheduleLedger(led1, a4, 2000);
    if (led2.entries[0].state !== SCHEDULE_LEDGER_STATES.WITHDRAWN) problems.push('撤回未落账（查不出「提醒过又撤了」）');
    if (led2.entries.length !== 1) problems.push('撤回把账删了（应留痕，不删账）');
    /* ④ 同一来源改期 ⇒ 旧键撤回归因为「改期」，新键投出。
     *   这一支必须**自建账本**：拿 `led1`（里面是 anniversary:a1）当输入考的是「换源」，
     *   考不出「同源换日键」—— 用错前置会让归因判据变成恒真（本仓最贵形态）。 */
    const ledR = { version: SCHEDULE_LEDGER_VERSION, entries: [
        { idemKey: idemKeyOf('commitment', 'c1', '2026-10-08'), source: 'commitment', sourceId: 'c1', dayKey: '2026-10-08', state: 'delivered' }
    ] };
    const a5 = diffScheduleLedger(adv([row('commitment', 'c1', '2026-10-09')], { commitment: true }), ledR);
    if (a5.notify.length !== 1 || a5.withdraw.length !== 1) problems.push('改期未做到「旧键撤回 + 新键投出」');
    else if (a5.withdraw[0].why !== SCHEDULE_WITHDRAW_REASONS['source-rescheduled']) problems.push('改期未按改期归因（与取消同形则用户分不清）');
    /* ④b 反向自证：同一份账本，换**换源**的输入 ⇒ 归因必须是「取消」而非「改期」
     *   （两条归因若在任何输入上同形，④ 的断言就没有判别力）。 */
    const a5b = diffScheduleLedger(adv([row('anniversary', 'a9', '2026-10-09')], { commitment: true }), ledR);
    if (a5b.withdraw.length !== 1 || a5b.withdraw[0].why !== SCHEDULE_WITHDRAW_REASONS['source-gone']) problems.push('换源与改期未分辨（两条归因同形 ⇒ 用户分不清改期还是取消）');
    /* ⑤ 键缺失的行不入账、也不静默吞。 */
    const a6 = diffScheduleLedger(adv([{ source: 'cycle', sourceId: '', idemKey: '' }], { cycle: true }), empty);
    if (a6.notify.length !== 0 || a6.skippedNoKey.length !== 1) problems.push('无幂等键的行未被拦住（不许投、但必须留痕）');
    /* ⑥ 回档：账本里那条是「剧情日 2026-10-10 投出的」，本轮剧情日退到 10-05 ⇒ 归因为回退。
     *   反向自证（同一份账本、把该条换成**现实基**）⇒ 归因**必须不是**回退：
     *     现实基的日期不随剧情回档变化，拿它判回退就是把两条时间轴混用（X3 第一条硬要求）。 */
    const ledS = { version: SCHEDULE_LEDGER_VERSION, entries: [
        { idemKey: idemKeyOf('calendar-memo', 'm1', '2026-10-10'), source: 'calendar-memo', sourceId: 'm1', dayKey: '2026-10-10', timeBasis: 'story', atStoryDay: '2026-10-10', state: 'delivered' }
    ] };
    const advS = (rows, st) => ({ rows: rows, read: { 'calendar-memo': true }, story: st, counts: { total: rows.length }, gaps: [] });
    const a7 = diffScheduleLedger(advS([], { dayKey: '2026-10-05' }), ledS);
    if (a7.withdraw.length !== 1) problems.push('剧情时间回退后未撤回未来提醒');
    else if (a7.withdraw[0].why !== SCHEDULE_WITHDRAW_REASONS['source-rewound']) problems.push('回档未按回档归因（与取消/改期同形则用户分不清）');
    const ledReal = { version: SCHEDULE_LEDGER_VERSION, entries: [
        { idemKey: idemKeyOf('cycle', 'x1', '2026-10-10'), source: 'cycle', sourceId: 'x1', dayKey: '2026-10-10', timeBasis: 'real', atStoryDay: '2026-10-10', state: 'delivered' }
    ] };
    const a7b = diffScheduleLedger({ rows: [], read: { cycle: true }, story: { dayKey: '2026-10-05' }, counts: { total: 0 }, gaps: [] }, ledReal);
    if (a7b.withdraw.length !== 1) problems.push('现实基那条未被撤回（撤回门按源核）');
    else if (a7b.withdraw[0].why === SCHEDULE_WITHDRAW_REASONS['source-rewound']) problems.push('拿现实基的行判了回档（两条时间轴被混用）');
    /* ⑥b 剧情钟读不出（`story.dayKey` 为空）⇒ 一律不判回档（不拿「不知道」当「回退了」）。 */
    const a7c = diffScheduleLedger(advS([], { dayKey: '' }), ledS);
    if (a7c.withdraw[0].why === SCHEDULE_WITHDRAW_REASONS['source-rewound']) problems.push('剧情钟读不出时仍判了回档（把「读不到」当成「回退了」）');
    /* ⑦ 投递面：`self` 的源只记账不投、`bridge` 的源要投 —— 两个方向都要自证，
     *   只考一侧时（例如只考「bridge 被投了」）一个「全都投」的实现也会全绿，
     *   而那正是「用户收到两条一样的提醒」的那条路。 */
    const rowsMix = [
        Object.assign(rowOf('calendar-memo', 'm1', '2026-10-08', 't', 'd', null), {}),
        rowOf('anniversary', 'a1', '2026-10-08', 't', 'd', null)
    ];
    const plan = scheduleDeliveryPlan(rowsMix);
    if (plan.deliver.length !== 1 || plan.deliver[0].source !== 'anniversary') problems.push('投递面：bridge 源未被投（或投错了源）');
    if (plan.recordOnly.length !== 1 || plan.recordOnly[0].source !== 'calendar-memo') problems.push('投递面：self 源被重复投了（用户会收到两条一样的提醒）');
    if (scheduleDeliveryPlan([{ source: 'cycle', idemKey: '' }]).skippedNoKey.length !== 1) problems.push('投递面：无幂等键的行未被拦住');
    /* ⑧ 载荷：无靶心时 appId 必须为空（否则横幅点击会把用户丢到别人的首屏）。 */
    const n1 = scheduleNoticeOf(rowOf('cycle', 'x1', '2026-10-08', 't', 'd', null));
    if (n1.appId !== '' || n1.meta.appId !== '') problems.push('载荷：无靶心的行仍带了 appId（点击会落到别的 App）');
    if (!n1.senderKey || n1.senderKey.indexOf('schedule:cycle:x1:') !== 0) problems.push('载荷：投递键未按稳定键形生成');
    if (scheduleNoticeOf(rowOf('cycle', 'x1', '2026-10-08', 't', 'd', null)).senderKey !== n1.senderKey) problems.push('载荷：同一条两算得出两个投递键（会合并失败）');
    const withRef = rowOf('anniversary', 'a2', '2026-10-08', 't', 'd', buildOpenRef('item', 'a2', 'annidate'));
    if (scheduleNoticeOf(withRef).appId !== 'annidate') problems.push('载荷：有靶心时未把 App 带进落账（通知中心的 App 归属会缺）');
    return { problems: problems };
}
