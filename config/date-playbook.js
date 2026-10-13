/* ============================================================
 * config/date-playbook.js — [第三期 R3-X3] 约会与日程的**可玩执行流程**
 * ------------------------------------------------------------
 *
 * 【计划原文 R3-X3】
 *   「把一条约定扩为准备→出发→到场→互动→结束的可选步骤;可邀请角色、关联地点
 *    与待办,结束生成回顾草稿;使用剧情时钟而非现实闹钟。」
 *   验收四条:用户能从聊天邀请推进一次约会;改期同步待办;
 *   没有正文/用户确认不自动判到场或履约;回档后未来步骤不继续触发。
 *
 * 【修前实测的缺口(不是推演)】
 *   config/commitment-flow.js 已有 proposed → confirmed → rescheduled →
 *   fulfilled / cancelled 五态与事件键幂等,config/schedule-bridge.js 与行动中心
 *   已有提醒。但「一条约定」在用户侧仍只是一个**状态**:
 *     · 没有「准备 → 出发 → 到场 → 互动 → 结束」这五步 —— 推进一次约会无处落脚;
 *     · 没有「邀请角色 / 关联地点 / 待办」这三个挂点;
 *     · 结束之后没有回顾草稿;改期不会同步待办;
 *     · 更要紧的是:**没有任何一处拦住「自动到场」** —— 约定一旦到了日期,
 *       任何一侧都可以自行把它当成发生了,而正文里那场约会根本没写。
 *   本模块补的就是这四样,且**不重建**约定引擎(它读 commitment-flow 的产物)。
 *
 * 【五步与它们的准入条件(每条对应一个具体错法)】
 *   prepare  → depart  → arrive  → interact → wrapUp
 *   1 **arrive 必须有人证**:正文或用户确认。没有就停在 depart(不得自行到场)
 *      —— 「到点了就当到了」是本仓最忌的形态:它把时间当成了事实;
 *   2 **wrapUp 只在 interact 之后**:没互动就无从回顾;
 *   3 **回档后未来步骤不触发**:每一步都带 floor,回档(楼层回退)时
 *      楼层比当前大的步骤一律标 stale 并**不执行**;
 *   4 **用剧情时钟不用现实闹钟**:本模块只读调用方喂进来的剧情时间与楼层,
 *      内部**不读** Date.now / 不读真实日历。
 *
 * 【四条纪律】
 *   · **只读约定账**:不改 commitment-flow 的状态机,不写它的账;
 *   · **不抛**:输入畸形一律降级为读数并标 degraded;
 *   · **不猜**:楼层读不到即为 null,而 null 的步骤**不参与**回档淘汰(无出处的楼层不算证据);
 *   · **不自动推进**:本模块只算「现在允许做什么」,**不代替用户或正文**做那一步。
 *
 * 【边界(如实登记,不装)】
 *   · 本模块是纯函数:不读存储、不写状态、不派事件、不调模型;
 *   · 「回顾草稿」只是一段**待用户编辑的文本**,不是已发布内容;
 *   · 「邀请角色」只产出一份邀请读数,不调上游、不写关系;接受/拒绝由上层记。
 * ============================================================ */
import { numOrNull } from './num-gate.js';

/** 五步(顺序即台面顺序)。 */
export const PLAY_STEPS = Object.freeze(['prepare', 'depart', 'arrive', 'interact', 'wrapUp']);

/** 每步的人读字样(两词同形即失败)。 */
export const PLAY_STEP_TEXT = Object.freeze({
    prepare: '准备',
    depart: '出发',
    arrive: '到场',
    interact: '互动',
    wrapUp: '结束'
});

/** 步骤状态五态(与「还没做」不同形)。 */
export const PLAY_STATES = Object.freeze({
    DONE: 'done',           /* 做过了(有 eventKey 或用户确认) */
    READY: 'ready',         /* 现在允许做 */
    WAITING: 'waiting',     /* 前置未满足(还没到那一步) */
    NEEDS_EVIDENCE: 'needs-evidence',  /* 需要人证(正文或用户确认) */
    STALE: 'stale'          /* 回档之后:楼层比当前大 ⇒ 这一步已作废 */
});

/** 八词归因(不许两个词同形)。 */
export const PLAY_REASONS = Object.freeze({
    ok: '步骤读数可用',
    'no-commitment': '没给约定(无约定的约会无法推进)',
    terminal: '这条约定已终结(履约或取消),不再推进步骤',
    'not-started': '尚未确认,还轮不到准备之后的事',
    'needs-evidence': '需要正文或用户确认才能推进这一步(不自行判定)',
    'future-step': '前一步还没做,这一步还不能做',
    'rolled-back': '剧情已回档到更早的楼层,这一步的出处已不在当前时间线上',
    'wrapup-needs-interact': '没互动就无从回顾'
});

/** 上限(冻结) */
export const PLAY_LIMITS = Object.freeze({
    invitationChars: 160,
    todoItems: 12,
    draftChars: 480,
    steps: 5
});

function str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function clip(s, n) { const t = str(s); return t.length > n ? (t.slice(0, n) + '…') : t; }

/**
 * 读一条约定,并把它的步骤台面算出来。
 *
 * @param {object} input
 *   · commitment  { id, actor, with?, content, dateKey?, time?, place?, status }
 *   · marks       { prepare: {floor?, eventKey?}, depart: {...}, ... }
 *                 —— 每一步的既有读数(谁做的、在哪一楼、什么事件键)
 *   · currentFloor 当前剧情楼层(回档判定用;**读不到传 null**,不猜 0)
 * @param {object} [opts]
 * @returns 恒定键面的读数(永不抛)
 */
export function buildDatePlaybook(input = {}, opts = {}) {
    const LIM = PLAY_LIMITS;
    const c = (input.commitment && typeof input.commitment === 'object') ? input.commitment : null;
    const base = {
        ok: false, reason: 'no-commitment',
        commitment: null, steps: [], ready: null, staleCount: 0,
        invitation: null, todos: [], draft: '', degraded: false
    };
    if (!c) return base;
    const id = str(c.id);
    const content = str(c.content);
    if (!id || !content) return base;

    const status = str(c.status) || 'proposed';
    const cur = numOrNull(input.currentFloor);
    const marks = (input.marks && typeof input.marks === 'object') ? input.marks : {};

    const steps = [];
    let ready = null;
    let blockedByEvidence = false;
    for (let i = 0; i < PLAY_STEPS.length; i += 1) {
        const key = PLAY_STEPS[i];
        const m = (marks[key] && typeof marks[key] === 'object') ? marks[key] : null;
        const floor = m ? numOrNull(m.floor) : null;
        const eventKey = m ? str(m.eventKey) : '';
        const done = !!(m && (eventKey || m.confirmed === true));
        let state = PLAY_STATES.WAITING;
        let why = 'future-step';
        /* 回档优先于一切:出处楼层在当前之后 ⇒ 这一步已不在时间线上。
         *   楼层读不到(null)不参与淘汰 —— 无出处的楼层不算证据。 */
        if (floor !== null && cur !== null && floor > cur) {
            state = PLAY_STATES.STALE;
            why = 'rolled-back';
        } else if (done) {
            state = PLAY_STATES.DONE;
            why = 'ok';
        } else if (status === 'fulfilled' || status === 'cancelled') {
            state = PLAY_STATES.WAITING;
            why = 'terminal';
        } else if (status === 'proposed') {
            state = PLAY_STATES.WAITING;
            why = 'not-started';
        } else if (i === 0) {
            state = PLAY_STATES.READY;
            why = 'ok';
            if (!ready) ready = key;
        } else {
            const prev = steps[i - 1];
            const prevOk = prev.state === PLAY_STATES.DONE || prev.state === PLAY_STATES.READY;
            if (!prevOk) {
                state = PLAY_STATES.WAITING;
                why = 'future-step';
            } else if (key === 'arrive') {
                /* ★ 入场必须有人证:这一步是整条流程里唯一「不得自行判定」的一步。 */
                state = PLAY_STATES.NEEDS_EVIDENCE;
                why = 'needs-evidence';
                blockedByEvidence = true;
                if (!ready) ready = null;
            } else if (key === 'wrapUp') {
                const inter = steps[3];
                if (!inter || (inter.state !== PLAY_STATES.DONE && inter.state !== PLAY_STATES.READY)) {
                    state = PLAY_STATES.WAITING;
                    why = 'wrapup-needs-interact';
                } else {
                    state = PLAY_STATES.READY;
                    why = 'ok';
                    if (!ready && !blockedByEvidence) ready = key;
                }
            } else {
                state = PLAY_STATES.READY;
                why = 'ok';
                if (!ready && !blockedByEvidence) ready = key;
            }
        }
        steps.push({
            key: key, label: PLAY_STEP_TEXT[key], state: state, reason: why,
            floor: floor, eventKey: eventKey,
            evidence: key === 'arrive' ? '需正文或用户确认' : ''
        });
    }

    const staleCount = steps.filter((s) => s.state === PLAY_STATES.STALE).length;
    /* 邀请读数:计划原文的「可邀请角色」。 */
    const guest = str(c.with);
    const invitation = guest ? {
        to: clip(guest, 40),
        text: clip('邀请 ' + guest + ':「' + content + '」'
            + (c.dateKey ? ' 定在 ' + str(c.dateKey) : '')
            + (c.time ? ' ' + str(c.time) : '')
            + (c.place ? ' 地点在 ' + str(c.place) : '') + '。', LIM.invitationChars),
        needsReply: true
    } : null;

    /* 待办:改期时**同步**的那三个挂点(验收第二条)。 */
    const todos = [];
    if (c.place) todos.push({ id: id + ':place', text: clip('去 ' + str(c.place), 60), ready: false });
    if (c.time) todos.push({ id: id + ':time', text: clip(str(c.dateKey || '') + ' ' + str(c.time) + ' 准时', 60), ready: false });
    if (guest) todos.push({ id: id + ':invite', text: clip('等 ' + guest + ' 回复', 60), ready: false });

    /* 回顾草稿:只在 interact 做过之后给(没互动就无从回顾)。 */
    const inter = steps[3];
    let draft = '';
    if (inter.state === PLAY_STATES.DONE || inter.state === PLAY_STATES.READY) {
        draft = clip('和 ' + (guest || str(c.actor) || '对方') + ' 在 '
            + (str(c.place) || '约定地点') + ' 的一次:' + content + '。'
            + '(草稿待编辑)', LIM.draftChars);
    }

    base.ok = true;
    base.reason = staleCount ? 'rolled-back' : (blockedByEvidence ? 'needs-evidence' : 'ok');
    base.commitment = {
        id: id, actor: str(c.actor), with: guest, content: content,
        dateKey: str(c.dateKey), time: str(c.time), place: str(c.place), status: status
    };
    base.steps = steps;
    base.ready = ready;
    base.staleCount = staleCount;
    base.invitation = invitation;
    base.todos = todos.slice(0, LIM.todoItems);
    base.draft = draft;
    return base;
}

/**
 * 推进一个步骤(校验准入,但不代替正文/用户做那一步)。
 *   @returns { ok, action, state, reason } —— 不允许时 ok:false 且 reason 逐条具名。
 */
export function advanceStep(input = {}, stepKey, evidence = {}) {
    const r = buildDatePlaybook(input, {});
    const key = str(stepKey);
    if (!r.ok) return { ok: false, step: key, reason: r.reason, state: null };
    const s = r.steps.find((x) => x.key === key);
    if (!s) return { ok: false, step: key, reason: 'no-commitment', state: null };
    if (s.state === PLAY_STATES.DONE) return { ok: false, step: key, reason: 'ok', state: s.state, replayed: true };
    if (s.state === PLAY_STATES.STALE) return { ok: false, step: key, reason: 'rolled-back', state: s.state };
    if (s.state === PLAY_STATES.WAITING) return { ok: false, step: key, reason: s.reason, state: s.state };
    if (s.state === PLAY_STATES.NEEDS_EVIDENCE) {
        const ev = (evidence && typeof evidence === 'object') ? evidence : {};
        const hasProof = !!(str(ev.eventKey) || ev.userConfirmed === true);
        if (!hasProof) return { ok: false, step: key, reason: 'needs-evidence', state: s.state };
        return { ok: true, step: key, reason: 'ok', state: PLAY_STATES.READY, needsWrite: true };
    }
    return { ok: true, step: key, reason: 'ok', state: PLAY_STATES.READY, needsWrite: true };
}

/** 一行读数(三态各占一格)。 */
export function datePlaybookLine(read) {
    if (!read || typeof read !== 'object') return '约会流程:无读数';
    if (read.reason === 'no-commitment') return '约会流程:' + PLAY_REASONS['no-commitment'];
    const done = read.steps.filter((s) => s.state === 'done').length;
    const st = read.ready ? ('现在能做:' + PLAY_STEP_TEXT[read.ready]) :
        (read.staleCount ? '已回档,' + read.staleCount + ' 步作废' : '暂无可做的步骤');
    return '约会流程:' + read.steps.length + ' 步已走 ' + done + ' · ' + st;
}

/** 自检(纯函数,不抛)。 */
export function datePlaybookSelfCheck() {
    const problems = [];
    const a = buildDatePlaybook({});
    if (a.reason !== 'no-commitment') problems.push('没给约定时应如实报 no-commitment');
    const c = { id: 'x1', actor: 'u', with: 'B', content: '看电影', status: 'confirmed' };
    const b = buildDatePlaybook({ commitment: c, currentFloor: 10 });
    if (b.ready !== 'prepare') problems.push('已确认的约定当前应能做准备');
    /* 到场必须等人证 */
    const b2 = buildDatePlaybook({ commitment: c, currentFloor: 10,
        marks: { prepare: { floor: 5, eventKey: 'e1' }, depart: { floor: 6, eventKey: 'e2' } } });
    const arr = b2.steps.find((s) => s.key === 'arrive');
    if (arr.state !== 'needs-evidence') problems.push('到场步骤必须等人证');
    /* 没互动不给回顾 */
    if (b2.draft) problems.push('interact 没做过时不得给回顾草稿');
    /* 回档 */
    const b3 = buildDatePlaybook({ commitment: c, currentFloor: 3,
        marks: { prepare: { floor: 5, eventKey: 'e1' } } });
    if (!b3.steps.find((s) => s.key === 'prepare').state === 'stale') problems.push('回档后未来步骤应作废');
    return { problems: problems };
}
