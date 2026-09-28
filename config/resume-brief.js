/**
 * resume-brief.js — [v3.20.0] 续玩简报内核（计划二 F8 的手机侧内核）
 *
 * 【为什么需要它 / 修前实测后果】
 *   计划二 F8 原文：「隔几天回来能快速知道**上次停在哪里、眼下最相关的人和事、
 *   我有哪些可选行动**，并直接继续游玩。」
 *   实测本仓处境：这四样**每一样都已有真源**，但没有任何一处把它们收在同一个读数里 ——
 *     · 「停在哪里」→ 上游九账证据面（`readLonshaEvidence`）已逐条带**楼层与出处**；
 *     · 「未完成的约定」→ `config/commitment-flow.js` 已有五态（proposed/confirmed/
 *       rescheduled/fulfilled/cancelled）；
 *     · 「上游未了承诺 / 进行中的支线」→ `apps/plotline` 的 `promiseList` / `arcList` 已投影出人读行；
 *     · 「表格落后正文几楼」→ `config/update-gap.js` 已有锚点读数（**且已把「未知」与「0」判开**）。
 *   代价是用户回来时看到的是一堆**各自为政的页面**：日历说有两场约定、织光机说没有生活碎片、
 *   剧情线说有伏笔没回收 —— 而「我上次停在哪、现在该做什么」没有任何一处回答。
 *   更贵的是本仓反复治过的那类错读数：把「本机还没接上面」（等升级/等装插件）与
 *   「接上了、确实没有」（真读数）显示成同一句话。
 *
 * 【本模块只做三件事】
 *   ① **收**：把上面五面收成一份「分节的简报模型」（每节是若干**可回源**的行）；
 *   ② **判缺口**：哪一面读不到就如实记一条 gap，并让总述**不许给绿灯**；
 *   ③ **挡未来事实**：`floorCount` 之后的行一律**丢掉并计数**（回档/删楼后不得把未来当现在）。
 *
 * 【不做什么】
 *   · 不做取数：五份输入全部由**调用方**取好传进来（与 `evidenceFaceOf` 同一分工 ——
 *     取数留在调用方，口径只此一份；同一轮里不出现第二个取数点）。
 *   · 不生成建议行动的结论：计划原文「建议行动保持建议，不能把『可以去拜访』写成『已经拜访』」
 *     ⇒ 本模块只输出**入口**（`action`），不输出「你应该做什么」的祈使句。
 *   · 不读时钟、不读存储、不带计时器：`at` 与 `floorCount` 都由调用方给 ⇒ 本模块是纯函数，
 *     **手机上关掉也不会继续跑**（计划该节验收项之一）。
 *
 * 【三条口径纪律（每条都有判据钉住）】
 *   · **读不到 ≠ 空**：五面各自的缺席记进 `gaps`，与「面在、确实没有」分开（两者的处置相反：
 *     前者等装插件/等生成，后者等剧情推进）。
 *   · **零项就绪不给绿灯**：一行都没有时写「本机还没有可续的剧情」，**绝不写「全部就绪」**
 *     （那是把一个未发生的好消息当结论）。
 *   · **行必须可回源**：每行带 `source`（这一行是从哪一面读出来的）与 `floor`（能回正文时给整数，
 *     取不到时给 `null` —— **不许补 0**：0 是「第 0 楼」这个真实读数）。
 */
import { normalizeCommitments, TERMINAL } from './commitment-flow.js';
/* [v3.12.0 口径] 数值取值只许走**全仓唯一实现** —— 本仓为「`Number(null) === 0` 把『没给』
 *   读成『给了 0』」治过四轮，第五轮的门禁（`scripts/weak-coercion-audit.mjs`）判的正是
 *   「同族弱口径」与「本地自成一版的取值助手」两种形态。本模块一开始就按它写：
 *   不定义任何 `num(v)` / `numOrNull(v)` / `floorOrNull(v)` 形状的本地取值函数。 */
import { numOrNull } from './num-gate.js';

/** 五份输入面的键名（判据据此核对「每一面都有缺口登记位」——面名与 `gaps[].face` 一一对应）。 */
export const RESUME_FACES = Object.freeze(['commitments', 'worldProgress', 'evidence', 'storyClock', 'updateGap']);

/** 每节最多几行（简报不是列表页：超出的部分只报总数，不静默截断）。 */
const MAX_ROWS = 5;

const STATUS_TEXT = Object.freeze({
    proposed: '待确认', confirmed: '已确认', rescheduled: '已改期',
    fulfilled: '已完成', cancelled: '已取消',
    open: '未了', pending: '待办', imminent: '临近', overdue: '逾期',
    active: '进行中', paused: '已暂停', done: '已收束'
});

/** 状态文案：**认得才翻译，不认得就原样带出**（不把未知编成某个已知态）。 */
function statusText(s) {
    const k = String(s == null ? '' : s).trim();
    if (!k) return '';
    return STATUS_TEXT[k] || k;
}

function clip(v, n) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** 楼层归一：能当整数用就给整数，其余一律 `null`（**绝不补 0**）。
 *  ★ 具体实现走**全仓唯一取值门** `numOrNull`（本文件不自写数值助手）。

 *  为什么这里不写成 `Number(v)`：`Number(null) === 0`、`Number('') === 0`、`Number([]) === 0`
 *  —— 于是「楼层没给」会被读成「第 0 楼」。0 是**合法读数**（真的有个第 0 楼），
 *  两者塌成一态正是本仓最贵的那类错读数（v3.3.0 / v3.11.0 / v3.12.0 治过四轮）。 */
function floorOrNull(v) {
    const n = numOrNull(v);
    return (n !== null && Number.isInteger(n) && n >= 0) ? n : null;
}

/**
 * 续玩简报。
 *
 * @param {object} input 五份**已取好**的输入（缺项传 null / undefined 即「读不到」）：
 *   · `commitments`  —— `config/commitment-flow.js` 的 state（`{version, items}`）或 items 数组
 *   · `worldProgress`—— 上游 worldProg 承诺投影行 `{character, content, deadline, status}[]`
 *   · `arcs`         —— 上游支线投影行 `{title, clue, status}[]`（可选；不给即不建这一节）
 *   · `evidence`     —— `readLonshaEvidence()` / `evidenceFaceOf()` 的返回（含 state / items）
 *   · `storyClock`   —— `storyClock()` 的返回（含 text / present）
 *   · `updateGap`    —— `updateGapLine()` 的返回（`{state:'clear'|'behind'|'unknown'}`）
 *   · `floorCount`   —— 当前会话正文楼数（用于挡住「回档后带未来事实」）
 *   · `at`           —— 生成时点（毫秒）。**由调用方给** ⇒ 本模块不读时钟、可复算。
 * @returns {{ at:number|null, present:boolean, complete:boolean, headline:string,
 *             sections:Array<{key:string,label:string,rows:Array,more:number}>,
 *             gaps:Array<{face:string, reason:string}>,
 *             faceLedger:Array<{face:string, missing:boolean}>,
 *             dropped:{staleFloors:number}, floorCount:number|null }}
 */
export function resumeBrief(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const floorCount = floorOrNull(o.floorCount);
    const gaps = [];
    const dropped = { staleFloors: 0 };

    /* ── 面 1：上游九账证据面（「上次停在哪里」——逐条带楼层与出处） ── */
    let recentRows = [];
    {
        const ev = o.evidence;
        if (!ev || typeof ev !== 'object') {
            gaps.push({ face: 'evidence', reason: 'not-read' });
        } else if (ev.state === 'bridge-absent' || ev.state === 'face-absent') {
            gaps.push({ face: 'evidence', reason: String(ev.state) });
        } else if (ev.state === 'unusable') {
            gaps.push({ face: 'evidence', reason: 'unusable:' + String(ev.reason || '') });
        } else {
            const items = Array.isArray(ev.items) ? ev.items : [];
            for (const it of items) {
                if (!it || typeof it !== 'object') continue;
                const floor = floorOrNull(it.floor);
                /* ★ 挡未来事实：楼层已知且不小于当前正文长度 ⇒ 这条属于「回档后已不存在的那部分」，
                 *   丢掉并计数。**不静默丢**：计数进 dropped，总述里要说得出来。 */
                if (floor !== null && floorCount !== null && floor >= floorCount) { dropped.staleFloors += 1; continue; }
                recentRows.push({
                    text: clip(it.title || it.detail || '', 96) || '（无标题条目）',
                    source: '证据面 · ' + String(it.ledgerLabel || it.ledger || '未知账'),
                    floor,
                    /* 【为什么不做「跳到那一楼」】实测本仓**没有**主体滚动/跳楼的原语
                     *（全仓按字面量搜跳楼相关的三个命名族，命中数为 0），
                     *  所以本行只把楼层当**读数**带出，入口指回**拥有这一面的 App**
                     *（织光机 · 出处侧）。绝不写一个做不到的 action —— 那比没有入口更糟。
                     *  ★ 本条注释**刻意不写出那几个命名族的字面量**：本仓有门禁扫全仓事件名
                     *    与标识符字面量（`tests/system-v226.test.mjs` 的对账① 会把注释里的
                     *    出现也读成「契约外的使用」）。教训与 v3.19.0 那次同形 ——
                     *    **一个 token 字面量都不要留下，包括解释它的注释**。 */
                    action: { kind: 'app', app: 'timeweaver' }
                });
            }
            /* 面在、确实没有条目 ⇒ **不是** gap（真读数：等剧情推进），也不允许填占位句。 */
        }
    }

    /* ── 面 2：未完成的约定（本仓自己拥有状态的一族：五态里非终态即为「未完成」） ── */
    let openRows = [];
    {
        if (o.commitments === undefined || o.commitments === null) {
            gaps.push({ face: 'commitments', reason: 'not-read' });
        } else {
            const state = normalizeCommitments(o.commitments);
            for (const it of state.items) {
                if (TERMINAL.has(it.status)) continue;
                const when = it.dateKey ? '（' + it.dateKey + (it.time ? ' ' + it.time : '') + '）' : '（日期未记）';
                openRows.push({
                    text: clip(it.actor, 24) + '：' + clip(it.content, 72) + when
                        + (statusText(it.status) ? ' · ' + statusText(it.status) : ''),
                    source: '约定流程 · ' + (it.id || '无编号'),
                    floor: null,
                    action: { kind: 'app', app: 'calendar' }
                });
            }
        }
    }

    /* ── 面 3：上游未了承诺（跨仓面：投影行已由 plotline 归一，本模块不重解析上游形状） ── */
    let wantsRows = [];
    {
        if (o.worldProgress === undefined || o.worldProgress === null) {
            gaps.push({ face: 'worldProgress', reason: 'not-read' });
        } else {
            const rows = Array.isArray(o.worldProgress) ? o.worldProgress : [];
            for (const p of rows) {
                if (!p || typeof p !== 'object') continue;
                const st = statusText(p.status);
                wantsRows.push({
                    text: clip(p.character, 24) + '：' + clip(p.content, 72)
                        + (p.deadline ? ' · ' + clip(p.deadline, 16) : '') + (st ? ' · ' + st : ''),
                    source: '剧情线 · 上游承诺',
                    floor: null,
                    action: { kind: 'app', app: 'plotline' }
                });
            }
        }
    }

    /* ── 面 4：进行中的支线（可选面：不给就不建这一节，**不记 gap** —— 它不是必需输入） ── */
    let arcRows = [];
    if (o.arcs !== undefined && o.arcs !== null) {
        const rows = Array.isArray(o.arcs) ? o.arcs : [];
        for (const a of rows) {
            if (!a || typeof a !== 'object') continue;
            const st = statusText(a.status);
            arcRows.push({
                text: clip(a.title, 40) + (a.clue ? '：' + clip(a.clue, 64) : '') + (st ? ' · ' + st : ''),
                source: '剧情线 · 支线',
                floor: null,
                action: { kind: 'app', app: 'plotline' }
            });
        }
    }

    /* ── 面 5：表格落后正文几楼（本仓自己的锚点读数；三态**不许压平**） ── */
    let staleRows = [];
    {
        const g = o.updateGap;
        if (!g || typeof g !== 'object') {
            gaps.push({ face: 'updateGap', reason: 'not-read' });
        } else if (g.state === 'unknown') {
            /* 「锚点失效」≠「已追平」：前者要重建锚点，后者什么都不用做 ⇒ 记 gap，不建行。 */
            gaps.push({ face: 'updateGap', reason: 'unknown' });
        } else if (g.state === 'behind') {
            staleRows.push({ text: String(g.text || ('落后正文 ' + Number(g.count || 0) + ' 楼')), source: '表格更新锚点', floor: null, action: null });
        }
        /* state === 'clear' ⇒ 已追平：**不建行**（无事可做的行只是噪声）。 */
    }

    /* ── 面：剧情时刻（判读基准；三源全缺时如实记 gap） ── */
    {
        const sc = o.storyClock;
        if (sc === undefined || sc === null) gaps.push({ face: 'storyClock', reason: 'not-read' });
        else if (!sc.present) gaps.push({ face: 'storyClock', reason: String(sc.verdict || 'no-date') });
    }

    const cap = (rows) => ({ rows: rows.slice(0, MAX_ROWS), more: Math.max(0, rows.length - MAX_ROWS) });
    const sections = [];
    if (recentRows.length) sections.push({ key: 'recent', label: '上次停在哪里', ...cap(recentRows) });
    if (openRows.length) sections.push({ key: 'open', label: '未完成的约定', ...cap(openRows) });
    if (wantsRows.length) sections.push({ key: 'wants', label: '上游未了承诺', ...cap(wantsRows) });
    if (arcRows.length) sections.push({ key: 'arcs', label: '进行中的支线', ...cap(arcRows) });
    if (staleRows.length) sections.push({ key: 'stale', label: '待追赶的正文', ...cap(staleRows) });

    const total = sections.reduce((n, s) => n + s.rows.length, 0);
    const present = total > 0;
    const complete = present && gaps.length === 0 && dropped.staleFloors === 0;
    /* `at` 由调用方给：走唯一取值门（`Number(null)` 是 0 ⇒ 会把「没给时点」读成 1970 年）。 */
    const at = numOrNull(o.at);

    /* 总述：**唯一实现**在 `resumeBriefText()`（视图不得自拼第二份）。 */
    return {
        at,
        present,
        complete,
        headline: resumeBriefText({ present, gaps, dropped, total, complete }),
        sections,
        gaps,
        /* 逐面台账：面名取自 RESUME_FACES（**只此一份清单**），视图直接用它说清
         * 「哪几面没读到」——视图自己列一遍面名就是第二份实现，必然漂移。 */
        faceLedger: RESUME_FACES.map((face) => ({ face, missing: gaps.some((g) => g.face === face) })),
        dropped,
        floorCount
    };
}

/**
 * 一行总述（**唯一实现**：视图与诊断都走这里，不各自拼一份）。
 *
 * 三条纪律在本函数里落成文字：
 *   · 一行都没有 ⇒ 写「本机还没有可续的剧情」，**绝不写「全部就绪」**；
 *   · 有缺口 ⇒ 必须说出来（「不完整」），不许把「面读不到」藏起来；
 *   · 丢过行 ⇒ 必须说出来（「已挡下 N 条不可达楼层」）—— 回档后挡掉未来事实是**正确行为**，
 *     但**静默**挡掉会让用户以为「本来就只有这些」。
 */
export function resumeBriefText(r) {
    const o = (r && typeof r === 'object') ? r : {};
    const bits = [];
    if (!o.present) {
        bits.push('续玩简报：本机还没有可续的剧情');
        const miss = Array.isArray(o.gaps) ? o.gaps.length : 0;
        if (miss) bits.push(miss + ' 个输入面读不到');
        return bits.join(' · ');
    }
    bits.push('续玩简报：' + Number(o.total || 0) + ' 项可续');
    if (Array.isArray(o.gaps) && o.gaps.length) bits.push('不完整（' + o.gaps.length + ' 个输入面读不到）');
    const stale = Number(o.dropped && o.dropped.staleFloors) || 0;
    if (stale) bits.push('已挡下 ' + stale + ' 条不可达楼层');
    return bits.join(' · ');
}

export default { resumeBrief, resumeBriefText, RESUME_FACES };
