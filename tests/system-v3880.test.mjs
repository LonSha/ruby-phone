/* ============================================================
 * tests/system-v3880.test.mjs — 拓展计划 R-X4 跨项目续玩工作台 [v3.88.0]
 * ------------------------------------------------------------
 * 本版把上游的分卷接续包与本仓的续玩读数接成一条用户能走的路。修前的实测处境：
 *   · 上游 lonsha-memory-plugin 已有分卷与选择性接续（volume-continuation.js +
 *     memory-organs.js 的 applyVolumeContinuation / revokeVolumeContinuation），
 *     而本仓**不知道『项目』是什么**（projectId 按字面量搜命中数 0）；
 *   · 续玩简报 / 分支对照 / 受控恢复交接 三件都已在场，但三件各自只答一段，
 *     没有一处把『我要接着玩哪一部、带到哪儿、缺什么』一次说清；
 *   · 最贵的三种错读数在本面各自本可能发生：
 *     ①「没选项目」被画成「没有作品」；②「清单读不到」被画成「零个项目」；
 *     ③「同名角色」按名字合并成一个人（不报错）。
 *
 * 本套件守五件事：
 *   A 结构面：三态 / 三级操作 / 五个冲突类 / 六面清单齐备；纯函数不摸宿主、不写存储；
 *            归一只有一份（存档包 → 项目行）；不新增存储键（复用 archive_face 一格）；
 *   B 行为面：十三条判据（负控制复用**同一份**）—— 三态不同形 / 没选不泄漏 /
 *            读不到≠空 / 同名不合并 / 无身份 fail-closed / 跳段不混算 /
 *            在飞旧回信拦恢复 / 无 owner 即 held / 缺面与可选面不同形 /
 *            0 楼是合法停点 / 恢复四态不同形且旧世代不当作已恢复 / 存档包归一 / 自检；
 *   C 接线面：咽喉真调内核（读真源码 + 真跑取数口径）、存档台是唯一取数源、
 *            诊断与存档台视图纯渲染；
 *   D 负控制：真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据；
 *   E 版本锚（下限形）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mod = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const NL = String.fromCharCode(10);
const DQ = String.fromCharCode(34);
const BS = String.fromCharCode(92);

const M_RW = 'config/resume-workbench.js';
const A_APP = 'apps/archive/archive-app.js';
const A_VIEW = 'apps/archive/archive-view.js';
const A_CSS = 'apps/archive/archive.css';
const IDX = 'index.js';
const D_DATA = 'apps/diagnose/diagnose-data.js';
const D_VIEW = 'apps/diagnose/diagnose-view.js';
const P_CSS = 'phone.css';
const KEYS = 'scripts/keys-audit.mjs';

const RW = await mod(M_RW);
const AR = await mod(A_APP);

/** 干净入参（与内核自检用的那一份同形；判据与自检刻意同源）。 */
const BASE = {
    chatId: 'chat-1', branchKey: 'main',
    selected: { projectId: 'proj-A', volume: 'v1', chapter: 'c2', title: '红楼梦' },
    projects: [{ projectId: 'proj-A', volume: 'v1', chapter: 'c2', title: '红楼梦', lastFloor: 300 }],
    notifications: [{ floor: 301, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', title: '未回的信' }],
    characters: [{ name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', floor: 299 }],
    branches: [], materials: [],
    storyClock: { label: '春分' }, finance: { rows: 3, label: '$' },
    inFlight: [], precheck: { state: 'ok' }, owner: { apply: () => {} }, epoch: 7
};
function fix(over) { return Object.assign({}, BASE, over || {}); }
function work(over) { return RW.buildResumeWorkbench(fix(over)); }
/** 同一份工厂，但对象由调用方给（负控制要在**破坏副本**上跑同款判据，那时 RW 不能写死）。 */
function m2(m, over) { return m.buildResumeWorkbench(fix(over)); }

/* ================== 判据函数（负控制必须复用**同一份**） ================== */

/** R-X4-① 三态互不同形：状态词 / 文案 / 总括行三样都不许两两相同；三态各归其位。 */
function jThreeStatesDistinct(m) {
    const a = m.buildResumeWorkbench(fix({ selected: null }));
    const b = m.buildResumeWorkbench(fix({ projects: null }));
    const c = m.buildResumeWorkbench(fix());
    const states = [a.state, b.state, c.state];
    if (new Set(states).size !== 3) return { ok: false, why: '三态状态词同形：' + states.join(' / ') };
    const labels = [a.stateText, b.stateText, c.stateText];
    if (new Set(labels).size !== 3) return { ok: false, why: '三态文案同形：' + labels.join(' / ') };
    const lines = [m.rwSummaryLine(a), m.rwSummaryLine(b), m.rwSummaryLine(c)];
    if (new Set(lines).size !== 3) return { ok: false, why: '三态总括行同形：' + lines.join(' | ') };
    if (a.state !== m.RW_PROJECT_STATES.NO_SELECTION) return { ok: false, why: '没选项目应判 no-selection，实测 ' + a.state };
    if (b.state !== m.RW_PROJECT_STATES.UNREADABLE) return { ok: false, why: '清单读不到应判 unreadable，实测 ' + b.state };
    if (c.state !== m.RW_PROJECT_STATES.READY) return { ok: false, why: '有钱入参应判 ready，实测 ' + c.state };
    if (String(lines[0]).indexOf('尚未选择项目') < 0) return { ok: false, why: '没选项目的行面未点名『尚未选择项目』：' + lines[0] };
    if (String(lines[1]).indexOf('读不到') < 0) return { ok: false, why: '清单读不到的行面未说『读不到』：' + lines[1] };
    return { ok: true, why: '' };
}

/** R-X4-② 没选项目 ⇒ 什么都不产（fail-closed）：**不是**『读出来是空的』。 */
function jNoSelectionLeaksNothing(m) {
    const a = m.buildResumeWorkbench(fix({ selected: null }));
    if ((a.projects || []).length) return { ok: false, why: '没选项目竟产出了项目行' };
    if ((a.characters || []).length) return { ok: false, why: '没选项目竟产出了角色读数' };
    if ((a.sections || []).length) return { ok: false, why: '没选项目竟产出了分节读数' };
    if (a.impact.openItems !== 0) return { ok: false, why: '没选项目仍算了未了事项数' };
    if (a.impact.lastFloor !== null) return { ok: false, why: '没选项目仍报了停点' };
    if (a.canDraft !== false) return { ok: false, why: '没选项目竟给了接续草稿' };
    if (a.canRestore !== false) return { ok: false, why: '没选项目竟给了恢复' };
    if (!a.restore || a.restore.held !== true) return { ok: false, why: '没选项目时恢复必须 held' };
    if (a.restore.requested !== false) return { ok: false, why: '没选项目却声称发过请求' };
    return { ok: true, why: '' };
}
/** R-X4-③ 读不到 ≠ 没有：清单 / 四行面 / 在飞回信三处的 null 与 [] 不许同形。 */
function jUnreadableNotZero(m) {
    const b = m.buildResumeWorkbench(fix({ projects: null }));
    const e = m.buildResumeWorkbench(fix({ projects: [] }));
    if (b.state !== m.RW_PROJECT_STATES.UNREADABLE) return { ok: false, why: '清单 null 应判 unreadable' };
    if (e.state !== m.RW_PROJECT_STATES.READY) return { ok: false, why: '清单 [] 仍是 ready（只是选不中）' };
    if (b.listReadable !== false) return { ok: false, why: '清单 null 时 listReadable 应为 false' };
    if (e.listReadable !== true) return { ok: false, why: '清单 [] 时 listReadable 应为 true' };
    if (m.rwSummaryLine(b) === m.rwSummaryLine(e)) return { ok: false, why: '读不到与空清单同形' };
    if (!(b.gaps || []).some((g) => g.face === '项目清单')) return { ok: false, why: '清单读不到必须记 gap' };
    const n = m.buildResumeWorkbench(fix({ notifications: null }));
    const z = m.buildResumeWorkbench(fix({ notifications: [] }));
    if (!(n.gaps || []).some((g) => g.face === '未了事项' && g.reason === m.RW_REASONS.FACE_UNREADABLE)) { return { ok: false, why: '行面 null 必须记 face-unreadable' }; }
    if ((z.gaps || []).some((g) => g.face === '未了事项')) return { ok: false, why: '行面 [] 不得记 gap（真没有不是读不到）' };
    const ns = (n.sections || []).filter((s) => s.face === 'commitments')[0];
    const zs = (z.sections || []).filter((s) => s.face === 'commitments')[0];
    if (!ns || ns.state !== 'unreadable') return { ok: false, why: '读不到的分节状态应为 unreadable，实测 ' + JSON.stringify(ns) };
    if (!zs || zs.state !== 'ok' || zs.count !== 0) return { ok: false, why: '空的分节状态应为 ok 且 count 为 0，实测 ' + JSON.stringify(zs) };
    return { ok: true, why: '' };
}

/** R-X4-④ 同名角色不同宇宙：**不合并**，且必须报冲突（拿名字当键会合成一个且不报错）。 */
function jSameNameNotMerged(m) {
    const s = m.buildResumeWorkbench(fix({
        characters: [
            { name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', floor: 10 },
            { name: '林黛玉', universe: 'u2', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', floor: 20 }
        ]
    }));
    if (s.characters.length !== 2) return { ok: false, why: '同名异宇宙被合并成了 ' + s.characters.length + ' 个' };
    if (s.characters[0].key === s.characters[1].key) return { ok: false, why: '两个同名角色的身份键相同（拿名字当键了）' };
    if (s.characters[0].key.indexOf('u1') < 0 || s.characters[1].key.indexOf('u2') < 0) return { ok: false, why: '角色键未含宇宙段' };
    const kinds = (s.conflicts || []).map((x) => x.kind);
    if (kinds.filter((k) => k === m.RW_CONFLICT_KINDS.SAME_NAME).length !== 1) return { ok: false, why: '同名异宇宙必须且只报一条冲突：' + JSON.stringify(kinds) };
    const one = m.buildResumeWorkbench(fix({
        characters: [
            { name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', floor: 10 },
            { name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', floor: 20 }
        ]
    }));
    if (one.characters.length !== 1) return { ok: false, why: '同宇宙同名应归一为 1 个，实测 ' + one.characters.length };
    return { ok: true, why: '' };
}

/** R-X4-⑤ 拿不到会话身份 ⇒ 什么都进不了读数（fail-closed，不得当成『全都在本段』）。 */
function jNoIdentityFailClosed(m) {
    const noId = m.buildResumeWorkbench(fix({ chatId: '', selected: { projectId: 'proj-A', volume: 'v1', chapter: 'c2' } }));
    if (noId.impact.openItems !== 0) return { ok: false, why: '拿不到会话身份时不得把行算进本段，实测 ' + noId.impact.openItems };
    if ((noId.conflicts || []).filter((x) => x.kind === m.RW_CONFLICT_KINDS.UNIDENTIFIABLE).length < 1) return { ok: false, why: '身份缺项必须报冲突' };
    if (!(noId.gaps || []).some((g) => g.face === '会话身份')) return { ok: false, why: '身份缺项必须记 gap' };
    const yes = m.buildResumeWorkbench(fix());
    if (yes.impact.openItems !== 1) return { ok: false, why: '有身份时未了事项应进读数，实测 ' + yes.impact.openItems };
    return { ok: true, why: '' };
}

/** R-X4-⑥ 跟项目 / 跟段的行不混算：各自计冲突，不进本段读数。 */
function jCrossScopeNotMixed(m) {
    const mixed = m.buildResumeWorkbench(fix({
        notifications: [
            { floor: 302, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', title: 'A 的' },
            { floor: 302, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-B', title: 'B 的' },
            { floor: 302, chatId: 'chat-2', branchKey: 'main', projectId: 'proj-A', title: '别段的' },
            { floor: 302, chatId: 'chat-1', branchKey: 'side', projectId: 'proj-A', title: '别分支的' }
        ]
    }));
    if (mixed.impact.openItems !== 1) return { ok: false, why: '跟项目/跟段/跟分支的行不得进本段读数，实测 ' + mixed.impact.openItems };
    const kinds = (mixed.conflicts || []).map((x) => x.kind);
    if (kinds.indexOf(m.RW_CONFLICT_KINDS.PROJECT_MISMATCH) < 0) return { ok: false, why: '跟项目必须报冲突' };
    if (kinds.indexOf(m.RW_CONFLICT_KINDS.CROSS_SCOPE) < 0) return { ok: false, why: '跟段（另会话/另分支）必须报冲突' };
    if (mixed.impact.lastFloor !== 302) return { ok: false, why: '停点应取本段那一条，实测 ' + String(mixed.impact.lastFloor) };
    return { ok: true, why: '' };
}
/** R-X4-⑦ 在飞旧回信 ⇒ 恢复 held（不能只看预检 ok 就放行）。 */
function jStaleInFlightBlocksRestore(m) {
    const s = m.buildResumeWorkbench(fix({ inFlight: [{ domain: 'x' }], precheck: { state: 'ok' } }));
    if (s.canRestore !== false) return { ok: false, why: '有在飞旧回信时不得给恢复' };
    if (!s.restore || s.restore.held !== true) return { ok: false, why: '有在飞旧回信时恢复必须 held' };
    if (s.restore.reason === m.RW_REASONS.OK) return { ok: false, why: '有在飞旧回信时必须点名归因' };
    const kinds = (s.conflicts || []).map((x) => x.kind);
    if (kinds.indexOf(m.RW_CONFLICT_KINDS.STALE_IN_FLIGHT) < 0) return { ok: false, why: '在飞旧回信必须报冲突' };
    /* 反向：干净入参必须可恢复（否则这条判据是恒假的）。 */
    const ok = m.buildResumeWorkbench(fix());
    if (ok.canRestore !== true) return { ok: false, why: '干净入参必须可恢复（否则门关成谁都不可恢复）' };
    return { ok: true, why: '' };
}

/** R-X4-⑧ 没有真实 owner ⇒ 恢复 held；且恢复结果不得当作已恢复。 */
function jNoOwnerHeld(m) {
    const n = m.buildResumeWorkbench(fix({ owner: null }));
    if (n.canRestore !== false) return { ok: false, why: '没有 owner 时不得给恢复' };
    if (!n.restore || n.restore.held !== true) return { ok: false, why: '没有 owner 时恢复必须 held' };
    if (n.restore.reason !== m.RW_REASONS.NO_OWNER) return { ok: false, why: '无 owner 归因错：' + String(n.restore.reason) };
    const shape = m.buildResumeWorkbench(fix({ owner: { notApply: true } }));
    if (shape.canRestore !== false) return { ok: false, why: 'owner 没有 apply 时不得当作真实执行体' };
    const r = m.rwRestoreOutcome(n, { ok: true }, { state: 'ok', at: 7 });
    if (r.applied !== false || r.state !== 'held') return { ok: false, why: 'owner 没执行却当成了：' + JSON.stringify(r) };
    /* 反向：真有 owner 必须可恢复。 */
    if (m.buildResumeWorkbench(fix()).canRestore !== true) return { ok: false, why: '真有 owner 却不可恢复' };
    return { ok: true, why: '' };
}

/** R-X4-⑨ 缺面与可选面不同形：缺面记 gap、null 记 unreadable、[] 不记；财务是可选面。 */
function jMissingVsOptionalFace(m) {
    const miss = fix(); delete miss.notifications;
    const a = m.buildResumeWorkbench(miss);
    const b = m.buildResumeWorkbench(fix({ notifications: null }));
    const c = m.buildResumeWorkbench(fix({ notifications: [] }));
    const pick = (w) => (w.sections || []).filter((s) => s.face === 'commitments')[0] || {};
    const sa = pick(a), sb = pick(b), sc = pick(c);
    if (sa.state !== 'missing') return { ok: false, why: '缺面应记 missing，实测 ' + String(sa.state) };
    if (sb.state !== 'unreadable') return { ok: false, why: 'null 应记 unreadable，实测 ' + String(sb.state) };
    if (sc.state !== 'ok' || sc.count !== 0) return { ok: false, why: '真没有应记 ok 且 count 0，实测 ' + JSON.stringify(sc) };
    if (!(a.gaps || []).some((g) => g.face === '未了事项' && g.reason === m.RW_REASONS.FACE_MISSING)) return { ok: false, why: '缺面必须记 face-not-provided' };
    if (!(b.gaps || []).some((g) => g.face === '未了事项' && g.reason === m.RW_REASONS.FACE_UNREADABLE)) return { ok: false, why: 'null 面必须记 face-unreadable' };
    if ((c.gaps || []).some((g) => g.face === '未了事项')) return { ok: false, why: '[] 不得记 gap（真没有不是读不到）' };
    /* 财务是可选面：不给就是不给，不记 gap；剧情时间不是可选面。 */
    if (m.buildResumeWorkbench(fix({ finance: undefined })).gaps.some((g) => g.face === '财务')) return { ok: false, why: '财务是可选面，不给不得记 gap' };
    if (!(m.buildResumeWorkbench(fix({ storyClock: null })).gaps || []).some((g) => g.face === '剧情时间')) return { ok: false, why: '剧情时间缺面必须记 gap' };
    return { ok: true, why: '' };
}

/** R-X4-⑩ 接续草稿必含缺口行，且草稿不平替已恢复。 */
function jDraftCarriesGaps(m) {
    const d = m.rwDraftOf(m.buildResumeWorkbench(fix({ storyClock: null, owner: null })));
    if (d.empty !== false) return { ok: false, why: '有读数时草稿不得为空' };
    if (!d.title) return { ok: false, why: '草稿必须有标题' };
    if (!(d.gaps || []).length) return { ok: false, why: '草稿必含缺口行（缺面不许静默省略）' };
    if (!(d.gaps || []).some((g) => String(g).indexOf('剧情时间') >= 0)) return { ok: false, why: '缺口行未点名缺的那一面' };
    if (d.lines.some((l) => l.indexOf('读不到') >= 0) === false) return { ok: false, why: '行面必须把缺面画成读不到' };
    if (String(d.notice).indexOf('未发起恢复') < 0) return { ok: false, why: '不可恢复时草稿必须点明未发起恢复' };
    if (String(m.rwDraftOf(m.buildResumeWorkbench(fix())).notice) !== '') return { ok: false, why: '可恢复时不得挂未发起恢复' };
    if (m.rwDraftOf(null).empty !== true) return { ok: false, why: '无读数时草稿必须为空' };
    return { ok: true, why: '' };
}

/** R-X4-⑪ 旧世代归因：读不出即 stale；四态不同形且旧世代不当作已恢复。 */
function jStaleEpochRejected(m) {
    if (m.rwStaleReason(7, 7) !== '') return { ok: false, why: '同世代不得判 stale' };
    if (m.rwStaleReason(7, 6) === '') return { ok: false, why: '旧世代必须判 stale' };
    if (m.rwStaleReason(null, 6) === '') return { ok: false, why: '世代读不出必须判 stale（不可判定 > 保守）' };
    if (m.rwStaleReason(7, null) === '') return { ok: false, why: '回读世代读不出必须判 stale' };
    const ok = m.buildResumeWorkbench(fix());
    const held = m.rwRestoreOutcome(m.buildResumeWorkbench(fix({ owner: null })), { ok: true }, { state: 'ok', at: 7 });
    const done = m.rwRestoreOutcome(ok, { ok: true }, { state: 'ok', at: 7 });
    const part = m.rwRestoreOutcome(ok, { ok: true }, { state: 'mismatch', at: 7 });
    const stale = m.rwRestoreOutcome(ok, { ok: true }, { state: 'ok', at: 6 });
    const seen = {};
    [held.state, done.state, part.state, stale.state].forEach((x) => { seen[x] = 1; });
    if (Object.keys(seen).length !== 4) return { ok: false, why: '恢复四态不许同形：' + JSON.stringify(Object.keys(seen)) };
    if (stale.applied !== false) return { ok: false, why: '旧世代回读不得当作已恢复' };
    if (stale.stale !== true) return { ok: false, why: '旧世代必须标 stale' };
    if (done.applied !== true || done.state !== 'done') return { ok: false, why: '干净回读必须判 done' };
    const ur = m.rwRestoreOutcome(ok, { ok: true }, { state: 'unreadable', at: 7 });
    if (ur.state !== 'partial' || String(ur.why).indexOf('不是') < 0) return { ok: false, why: '回读取不到必须与一致分开：' + String(ur.why) };
    return { ok: true, why: '' };
}

/** R-X4-⑫ 0 楼是合法停点：0 与「没记录」不同形。 */
function jZeroFloorIsAStop(m) {
    const bare = { characters: [], branches: [], materials: [], finance: undefined, storyClock: null };
    const one = [{ floor: 0, chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A' }];
    const f0 = m.buildResumeWorkbench(fix(Object.assign({}, bare, { notifications: one })));
    const fn = m.buildResumeWorkbench(fix(Object.assign({}, bare, { notifications: [] })));
    if (f0.impact.lastFloor !== 0) return { ok: false, why: '0 楼是合法停点，实测 ' + String(f0.impact.lastFloor) };
    if (fn.impact.lastFloor !== null) return { ok: false, why: '没有停点必须记 null，不得补 0' };
    if (f0.impact.lastFloor === fn.impact.lastFloor) return { ok: false, why: '0 楼与没记录同形' };
    if (m.rwDraftOf(f0).impact.lastFloor !== 0) return { ok: false, why: '草稿必须把 0 楼如实报出来' };
    if (m.rwDraftOf(fn).impact.lastFloor !== null) return { ok: false, why: '没记录时草稿不得补 0' };
    return { ok: true, why: '' };
}

/** R-X4-⑬ 存档包归一（項目清单取数面的唯一口径）：认得出 / 认不出两态不同形。 */
function jPackNormalized(m) {
    const one = m.rwProjectsFromPack({ projectId: 'proj-A', projectTitle: '红楼梦', volumeId: 'v2', floorEnd: 420 });
    if (one.length !== 1) return { ok: false, why: '上游接续包形态必须归一为 1 个项目行' };
    if (one[0].title !== '红楼梦') return { ok: false, why: '项目标题必须取 projectTitle' };
    if (one[0].volume !== 'v2') return { ok: false, why: '卷必须取 volumeId' };
    if (one[0].lastFloor !== 420) return { ok: false, why: '停点必须取 floorEnd' };
    /* 认不出：三种都必须给空清单（不硬塞一行）。 */
    if (m.rwProjectsFromPack({ raw: '{}', at: 1 }).length !== 0) return { ok: false, why: '不含项目身份的包必须给空清单' };
    if (m.rwProjectsFromPack(null).length !== 0) return { ok: false, why: '非对象必须给空清单' };
    if (m.rwProjectsFromPack([]).length !== 0) return { ok: false, why: '数组不是包，必须给空清单' };
    /* 两套礼规都收；id 也能当项目身份；0 楼合法。 */
    const byId = m.rwProjectsFromPack({ id: 'p2', title: 't', floorEnd: 0 });
    if (byId.length !== 1 || byId[0].projectId !== 'p2') return { ok: false, why: '上游以 id 为身份的包必须认得出' };
    if (byId[0].lastFloor !== 0) return { ok: false, why: 'floorEnd 为 0 时不得扣成 null' };
    return { ok: true, why: '' };
}

const CRITERIA = [jThreeStatesDistinct, jNoSelectionLeaksNothing, jUnreadableNotZero, jSameNameNotMerged,
    jNoIdentityFailClosed, jCrossScopeNotMixed, jStaleInFlightBlocksRestore, jNoOwnerHeld,
    jMissingVsOptionalFace, jDraftCarriesGaps, jStaleEpochRejected, jZeroFloorIsAStop, jPackNormalized];
/* ================== A 结构面 ================== */

test('v3880 A1. 真源在场：三态 / 三级操作 / 五类冲突 / 六面清单齐备；复用 X4 那一格', () => {
    assert.ok(fs.existsSync(path.join(ROOT, M_RW)), '真源必须在场：' + M_RW);
    const src = read(M_RW);
    for (const name of ['RW_VERSION', 'RW_PROJECT_STATES', 'RW_STATE_LABELS', 'RW_LEVELS', 'RW_CONFLICT_KINDS',
        'RW_CONFLICT_LABELS', 'RW_REASONS', 'RW_REASON_TEXT', 'RW_SECTION_FACES', 'buildResumeWorkbench',
        'rwProjectsFromPack', 'rwDraftOf', 'rwStaleReason', 'rwRestoreOutcome', 'rwLevelLine', 'rwSummaryLine',
        'resumeWorkbenchSelfCheck']) {
        assert.ok(new RegExp('export (const|function) ' + name + '\\b').test(src), M_RW + ' 缺导出：' + name);
    }
    assert.equal(Object.keys(RW.RW_PROJECT_STATES).length, 3, '三态：未选 / 读不到 / 已选中');
    assert.equal(new Set(Object.values(RW.RW_PROJECT_STATES)).size, 3, '三态值出现同值');
    assert.equal(new Set(Object.values(RW.RW_STATE_LABELS)).size, 3, '三态文案不得同形');
    assert.equal(Object.keys(RW.RW_LEVELS).length, 3, '三级操作：只读 / 草稿 / 恢复');
    assert.equal(RW.RW_LEVELS.read.writes, false, '只读不写');
    assert.equal(RW.RW_LEVELS.draft.writes, false, '草稿仍不写存储');
    assert.equal(RW.RW_LEVELS.restore.writes, true, '恢复声明会动数据');
    assert.equal(Object.keys(RW.RW_CONFLICT_KINDS).length, 5, '五类冲突');
    assert.equal(new Set(Object.values(RW.RW_CONFLICT_KINDS)).size, 5, '冲突类别出现同值');
    assert.equal(RW.RW_SECTION_FACES.length, 6, '六面清单');
    assert.deepEqual(RW.RW_SECTION_FACES, ['commitments', 'characters', 'branches', 'evidence', 'storyClock', 'finance']);
    assert.equal(Object.keys(RW.RW_REASONS).length, 10, '归因词表十条');
    assert.equal(new Set(Object.values(RW.RW_CONFLICT_LABELS)).size, 5, '冲突中文不得同形');
    /* 复用 X4 已登记的那一格（archive_face 的 lastSelected），不另开键。 */
    for (const k of ['archive_pack', 'archive_face', 'archive_draft', 'archive_ledger']) {
        assert.ok(read(KEYS).includes("key: '" + k + "'"), '存储键必须在 keys 台账里：' + k);
    }
    assert.ok(read('config/storage.js').includes('/^archive_/'), '四键必须在 storage 前缀表里');
    const QD = String.fromCharCode(39);
    assert.ok(!read(KEYS).includes('key: ' + QD + 'resume'), '本版不许新增 resume_* 存储键');
});

test('v3880 A2. 本层是纯函数：不摸宿主、不写存储、只有一份归一；派生面枚举面未命中', () => {
    const src = read(M_RW);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(',
        '.setItem(', 'storage.', 'VirtualPhone', 'window.', 'storage.set']) {
        assert.ok(!code.includes(bad), '本模块不许出现 ' + bad + '（纯函数：不持存储、不带计时器、不碰 DOM）');
    }
    assert.ok(src.includes("import { numOrNull } from './num-gate.js'"), M_RW + ' 必须走唯一数值门 num-gate');
    /* 归一只有一份：存档台与咽喉都只 import，不各写一套字段礼规。 */
    const app = read(A_APP);
    const idx = read(IDX);
    assert.ok(app.includes("import { rwProjectsFromPack } from '../../config/resume-workbench.js'"), '存档台必须 import 归一真源');
    assert.ok(idx.includes('rwProjectsFromPack'), '咽喉必须用同一份归一');
    /* 存档包字段礼规只有一份，写在外面那份唯一归一里；本条的待检文本只剥块注释，
     * 并把「当版条目公告块」整段剔除 —— 那是描述文字，不是字段礼规的实现。这
     * 一剔除本身带负控制：不剔除时必须命中（见下一条断言）。 */
    const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
    const ANNOUNCE = 'const ST_PHONE_CURRENT_UPDATE = {';
    const stripAnnounce = (t) => {
        const i = t.indexOf(ANNOUNCE);
        if (i < 0) return t;
        const j = t.indexOf('};', i);
        return j < 0 ? t.slice(0, i) : t.slice(0, i) + t.slice(j);
    };
    /* [v3.89.0 交棒] 原句以「公告散文里恰有该字面量」为前提：抬版换条目即红，而它要证的
     *   只是「剔除器真的会剔」。改为自证式负控制（不绑任何一版的公告内容）。 */
    for (const f of [A_APP, IDX]) {
        const c = stripAnnounce(stripComments(read(f)));
        for (const lit of ['projectTitle', 'floorEnd']) {
            assert.ok(!c.includes(lit), f + ' 不得自己再写一套字段礼规（命中 ' + lit + '）');
        }
    }
    /* [v3.89.0 交棒] 原句把「公告散文里恰有该字面量」当前提 —— 抬版换了条目就红，
     *   而它想证的其实只是「剔除器真的会剔」。改写为**自证**：拿一段自带该字面量的
     *   合成文本验证剔除器确实剔除（不绑任何一版的公告内容）。 */
    const synth = ANNOUNCE + '"projectTitle"};';
    assert.ok(synth.includes('projectTitle'), '负控制前提：合成文本未剔除时确实含该字面量');
    assert.ok(!stripAnnounce(synth).includes('projectTitle'),
        '负控制：剔除器必须把公告块里那一段剔掉');
    /* 派生面枚举面：同一行不得同时出现「源身份字段 + 集合操作」。 */
    const ops = ['.filter(', '.find(', '.map(', '.flatMap(', '.reduce(', '.push(', '.unshift('];
    const hit = code.split(String.fromCharCode(10)).filter((l) => (l.includes('sourceId') || l.includes('sourceKey'))
        && ops.some((o) => l.includes(o)));
    assert.deepEqual(hit, [], '若命中派生面枚举面，必须先登记：\n' + hit.join('\n'));
});

/* ================== B 行为面 ================== */

test('v3880 B1. 十三条判据在同源上一次通过（三态 / 没选不泄漏 / 读不到 / 同名 / 身份 / 跨段 / 在飞 / owner / 缺面 / 草稿 / 世代 / 0 楼 / 包归一）', () => {
    const failures = [];
    for (const fn of CRITERIA) {
        let r;
        try { r = fn(RW); } catch (e) { r = { ok: false, why: '判据抛错：' + String((e && e.message) || e) }; }
        if (!r || r.ok !== true) failures.push(fn.name + ' -> ' + String((r && r.why) || '无返回'));
    }
    assert.deepEqual(failures, [], '判据未全过：\n' + failures.join('\n'));
});

test('v3880 B2. 真跑全链：选中项目 → 三级操作 → 草稿 → 真实 owner → 回读 → 完成', () => {
    const w = work();
    assert.equal(w.state, RW.RW_PROJECT_STATES.READY);
    assert.equal(w.listReadable, true, '清单读得到必须标 true');
    assert.equal(w.project.projectId, 'proj-A', '选中项必须对上清单里那一条');
    assert.equal(w.impact.openItems, 1, '本段未了事项应 1 条');
    assert.equal(w.impact.characters, 1, '角色应 1 个');
    assert.equal(w.impact.lastFloor, 301, '停点应取最大楼层 301，实测 ' + String(w.impact.lastFloor));
    assert.equal(w.canDraft, true, '有选中项就能出草稿');
    assert.equal(w.canRestore, true, '干净入参应可恢复');
    assert.equal(w.levels.length, 3, '三级操作都要在读数里');
    for (const l of w.levels) assert.equal(l.available, true, '干净入参三级都可用：' + l.key);
    const draft = RW.rwDraftOf(w);
    assert.equal(draft.empty, false);
    assert.ok(draft.title.indexOf('红楼梦') >= 0, '草稿标题必须带作品名：' + draft.title);
    assert.ok(draft.lines.some((l) => l.indexOf('最近停点：第 300 楼') >= 0), '草稿必须写出選中项目自己那一行的停点');
    const out = RW.rwRestoreOutcome(w, { ok: true }, { state: 'ok', at: 7 });
    assert.equal(out.state, 'done');
    assert.equal(out.applied, true);
    assert.equal(w.epoch, 7, '世代号必须原样带上（回读比对靠它）');
});

test('v3880 B3. 选中的项目不在清单里：仍为 ready 但 canDraft=false，且点名归因（不硬塞一行）', () => {
    const w = m2(RW, { projects: [{ projectId: 'other', title: '别的作品' }] });
    assert.equal(w.state, RW.RW_PROJECT_STATES.READY, '清单读得到就不是 unreadable（只是选不中）');
    assert.equal(w.canDraft, false, '认不出选中项就不给草稿');
    assert.equal(w.canRestore, false, '认不出选中项就不给恢复');
    assert.equal(w.project, null, '认不出选中项就不得硬塞一个 project（不拿清单第一项顶上）');
    assert.equal(w.impact.openItems, 1, '行本身属于选中的项目，仍应计进本段（拦的是草稿与恢复）');
    assert.ok(w.gaps.some((g) => g.face === '选中的项目' && g.reason === RW.RW_REASONS.NOT_IN_LIST), '必须点名 project-not-in-list');
    assert.equal(RW.rwDraftOf(w).title, '《（未选中）》接续草稿', '认不出时草稿标题不得冒充作品名');
});

test('v3880 B4. 清单去重（**绝不覆盖**）：同项目同卷章只留一行，换卷则是另一行', () => {
    const w = m2(RW, { projects: [
        { projectId: 'p', volume: 'v1', chapter: 'c1', title: '一' },
        { projectId: 'p', volume: 'v1', chapter: 'c1', title: '一的重复' },
        { projectId: 'p', volume: 'v2', chapter: 'c1', title: '二' }] });
    assert.equal(w.projectCount, 2, '同三元组只算一行，实测 ' + String(w.projectCount));
    assert.equal(w.projects[0].title, '一', '归一应保留先出现的那一行');
    const bad = m2(RW, { projects: [{ title: '没有身份' }, 5, null] });
    assert.equal(bad.projectCount, 0, '缺 projectId 的行必须丢掉（认不出就不硬塞）');
});

test('v3880 B5. 脚色身份键刻意不带卷章：同一人换卷出现仍是同一人', () => {
    const w = m2(RW, { characters: [
        { name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', chapter: 'c2' },
        { name: '林黛玉', universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A', chapter: 'c9' }] });
    assert.equal(w.characters.length, 1, '同一部作品内换卷章仍是同一人，实测 ' + w.characters.length);
    assert.ok(w.characters[0].key.indexOf('|u1|') >= 0, '键必须含宇宙段：' + w.characters[0].key);
    assert.ok(w.characters[0].key.indexOf('c2') < 0, '键不得把卷章拼进去');
    const unnamed = m2(RW, { characters: [{ universe: 'u1', chatId: 'chat-1', branchKey: 'main', projectId: 'proj-A' }] });
    assert.equal(unnamed.characters.length, 0, '没名字的角色认不出，不硬塞');
    assert.ok(unnamed.conflicts.some((c) => c.kind === RW.RW_CONFLICT_KINDS.UNIDENTIFIABLE), '没名字必须报身份缺项');
});


test('v3880 B6. 存档台三种“没清单”不同形：存储抛异常 ≠ 原文读不懂 ≠ 认得出但无身份', async () => {
    const mk = (store) => { const a = new AR.ArchiveApp(null, store); a.render = () => {}; a.probe(); return a; };
    const box = (mem) => ({ get: (k, d) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d), set: (k, v) => { mem[k] = v; return true; } });
    const threw = mk({ get: () => { throw new Error('boom'); }, set: () => true });
    assert.equal(threw.projectsReadable(), false, '读这一格抛了异常 ⇒ 清单读不到');
    assert.equal(threw.projectsWhy(), 'read_threw', '归因必须是 read_threw');
    assert.equal(threw.projectCount(), null, '读不到时条数必须是 null（不画 0）');
    const malMem = { archive_pack: JSON.stringify({ raw: 'not json at all', at: 1 }) };
    const mal = mk(box(malMem));
    assert.equal(mal.faceOf(), 'ok', '包本身收下了（对账面是 ok）');
    assert.equal(mal.projectsReadable(), false, '原文读不懂 ⇒ 清单同样读不到（不是「没有项目」）');
    assert.equal(mal.projectsWhy(), 'payload-unreadable', '归因必须与 read_threw 不同形');
    const noIdMem = { archive_pack: JSON.stringify({ raw: JSON.stringify({ version: 3, contains: ['chats'] }), at: 1 }) };
    const noId = mk(box(noIdMem));
    assert.equal(noId.projectsReadable(), true, '认得出这份包 ⇒ 清单读得到（只是空）');
    assert.equal(noId.projectsWhy(), '', '读得到时归因必须为空字符串');
    assert.equal(noId.projectCount(), 0, '不带项目身份 ⇒ 空清单（不硬塞一行）');
    const none = mk(box({}));
    assert.equal(none.faceOf(), 'empty', '还没收过包是另一态');
    assert.equal(none.projectsReadable(), true, '还没收过包 ⇒ 空清单（与读不到不同形）');
    assert.notEqual(String(threw.faceOf()) + '/' + String(threw.projectsWhy()), String(none.faceOf()) + '/' + String(none.projectsWhy()), '抛异常与还没收过包不得同形');
});
/* ================== C 接线面（真跑内核链 + 读真源码） ================== */

test('v3880 C1. 咽喉接线：导入 / 取数 / 动作 / 挂载四处都在，且写入口只有咽喉一处', () => {
    const idx = read(IDX);
    assert.ok(idx.includes("from './config/resume-workbench.js';"), '咽喉必须引内核真源');
    for (const s of ['buildResumeWorkbench', 'rwSummaryLine', 'rwDraftOf', 'rwLevelLine', 'rwProjectsFromPack',
        'resumeWorkbenchSelfCheck', 'RW_LEVELS']) {
        assert.ok(idx.includes(s), '咽喉导入缺 ：' + s);
    }
    assert.ok(idx.includes('function refreshResumeWorkbench() {'), '取数函数必须在场');
    assert.ok(idx.includes('function applyResumeRestore(req) {'), '恢复动作函数必须在场');
    assert.ok(idx.includes('applyResumeRestore: applyResumeRestore,'), '恢复入口必须挂上唯一出口');
    assert.ok(idx.includes('resumeWorkbenchFace: function ()'), '只读读数口必须挂上（视图与诊断读这一份）');
    /* 存储写入口：本版一个都不新增（恢复委托 owner，咽喉不自己写主档）。 */
    for (const f of [A_VIEW, D_DATA, D_VIEW]) {
        const c = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!c.includes('storage.set'), f + ' 不得自己写存储（写入口只能走咽喉）');
    }
});

test('v3880 C2. 刷新点排在日历早退之前 —— 否则与剧情时间无关的选中项永远看不到', () => {
    const idx = read(IDX);
    const at = idx.indexOf('async function checkCalendarScheduleReminders(');
    assert.ok(at > 0, '日历权威函数必须在场');
    const refreshAt = idx.indexOf('refreshResumeWorkbench();', at);
    const earlyAt = idx.indexOf('if (!storage) return;', at);
    assert.ok(refreshAt > 0, '刷新必须在这个函数里被调用');
    assert.ok(earlyAt > refreshAt, '刷新点必须排在早退之前（跟着早退会被一起吞掉）');
    assert.ok(!idx.includes('await refreshResumeWorkbench()'), '刷新不许 await（不挡日历链）');
});

test('v3880 C3. 存档台是唯一取数源：项目清单从自己那一格来，选中项与对账面同一次落笔', () => {
    const src = read(A_APP);
    assert.ok(src.includes("import { rwProjectsFromPack } from '../../config/resume-workbench.js'"), '存档台必须走唯一归一');
    assert.ok(src.includes('this._proj = rwProjectsFromPack(box.value);'), '清单必须走归一（不自己拆字段）');
    assert.ok(src.includes("projectsWhy() {"), '读不到必须有归因口（视图不自己猜）');
    assert.equal(src.split('lastSelected: this._sel ?').length - 1, 1, '选中项必须与对账面同一次落笔（一处）');
    assert.equal(src.split('_writeJSON(AR_FACE_KEY').length - 1, 1, '对账面写入只能一处');
    /* 一张表面：读不到归因端只能给三种值。 */
    const why = /projectsWhy\(\) \{[\s\S]{0,400}?\n    \}/.exec(src);
    assert.ok(why, 'projectsWhy 必须在场');
    for (const v of ['read_threw', 'payload-unreadable']) assert.ok(why[0].includes(v), '归因端缺：' + v);
});

test('v3880 C4. 诊断与存档台视图纯渲染：结论由内核给，视图不自己算', () => {
    const av = read(A_VIEW);
    assert.ok(av.includes('_projectBlock() {'), '项目块必须由本件排版');
    assert.ok(av.includes('app.projectsReadable()'), '读得到与否必须问 app（视图不自己猜）');
    assert.ok(av.includes('app.projectsWhy()'), '读不到归因必须走 app');
    assert.ok(av.includes('data-act="pick_project"') && av.includes('data-act="clear_project"'), '两个动作按钮必须在场');
    assert.ok(av.includes('app.selectProject('), '选中动作必须交给 app');
    assert.ok(!av.includes('resume-workbench.js'), '视图不许直连内核');
    assert.ok(av.includes('不是「没有项目」，是取数失败'), '读不到时必须与「没有项目」分开');
    const dv = read(D_VIEW);
    assert.ok(dv.includes('_resumeWorkbenchHtml(pkg) {'), '诊断视图必须有这张卡');
    assert.ok(dv.includes('resumeWorkbenchFaceText(face)'), '本卡文案必须走 diagnose-data 的唯一实现');
    assert.ok(!dv.includes('resume-workbench.js'), '视图不许直连内核');
    assert.ok(dv.includes('this._resumeWorkbenchHtml(pkg)'), '卡必须挂到渲染链上');
});

test('v3880 C5. 真跑取数口径：项目清单三种读数不同形（读不到 / 认得出但无身份 / 认得出且有项目）', async () => {
    /* 照 index.js 的 refreshResumeWorkbench 复刻一份清单读取口径（桩 storage，不跑真页面）。 */
    const readList = (raw) => {
        if (raw === undefined || raw === null) return null;
        const bag = (typeof raw === 'string') ? (() => { try { return JSON.parse(raw); } catch (_e) { return undefined; } })() : raw;
        if (bag === undefined) return null;
        if (Array.isArray(bag)) { const out = []; for (const x of bag) out.push(...RW.rwProjectsFromPack(x)); return out; }
        if (bag && typeof bag === 'object') {
            let inner = bag;
            if (typeof bag.raw === 'string' && bag.raw.length) { try { inner = JSON.parse(bag.raw); } catch (_e) { inner = null; } }
            return inner ? RW.rwProjectsFromPack(inner) : [];
        }
        return [];
    };
    const notRead = readList(undefined);
    const noIdentity = readList(JSON.stringify({ version: 3, contains: ['chats'] }));
    const one = readList(JSON.stringify({ raw: JSON.stringify({ projectId: 'proj-A', projectTitle: '红楼梦', floorEnd: 12 }) }));
    assert.equal(notRead, null, '读不到必须给 null');
    assert.deepEqual(noIdentity, [], '认得出但不带身份必须给空表');
    assert.equal(one.length, 1, '认得出必须给一行');
    const sel = { projectId: 'proj-A' };
    const w1 = m2(RW, { projects: notRead, selected: sel });
    const w2 = m2(RW, { projects: noIdentity, selected: sel });
    const w3 = m2(RW, { projects: one, selected: sel });
    assert.equal(w1.state, RW.RW_PROJECT_STATES.UNREADABLE);
    assert.equal(w2.state, RW.RW_PROJECT_STATES.READY, '空表仍是 ready（只是选不中）');
    assert.equal(w3.state, RW.RW_PROJECT_STATES.READY);
    const t = [RW.rwSummaryLine(w1), RW.rwSummaryLine(w2), RW.rwSummaryLine(w3)];
    assert.equal(new Set(t).size, 3, '三种读数必须互不同形\n' + t.join('\n'));
    assert.equal(readList('{oops'), null, '坏 JSON 必须归为「读不到」');
    /* 真跑存档台：提交一份包 → 选中 → 选不在清单里的（必须拒）。 */
    const mem = {};
    const storage = { get: (k, d) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d), set: (k, v) => { mem[k] = v; return Promise.resolve(true); } };
    const app = new AR.ArchiveApp(null, storage);
    app.render = () => {};
    app.probe();
    assert.equal(app.projectsReadable(), true, '没收过包时清单读得到（只是空）');
    app.ingestPack(JSON.stringify({ version: 3, contains: ['chats'], projectId: 'proj-A', projectTitle: '红楼梦', floorEnd: 420 }));
    assert.equal(app.projectCount(), 1, '收下包后应归一出 1 个项目行');
    assert.equal(app.selectProject('proj-A').ok, true, '清单里真有的那一个必须选得上');
    assert.equal(app.selectedId(), 'proj-A');
    const no = app.selectProject('proj-Z');
    assert.equal(no.ok, false, '不在清单里的项目必须拒（不当成选好了）');
    assert.equal(no.why, 'not-in-list', '拒的归因必须是 not-in-list');
    const app2 = new AR.ArchiveApp(null, storage);
    app2.render = () => {};
    app2.probe();
    assert.equal(app2.selectedId(), 'proj-A', '选中项必须从自己那一格读得回来');
});

/* ================== D 负控制（真源码破坏 → 破坏副本 → 同款判据） ================== */

const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});

/** 负向探针的外层必须包 try/catch：破坏变体可能直接抛（如取消了提前返回，空清单往下走就拿 null.length）。
 *  —— 抛出与判错同算「判据转红」：两者都证明该判据能感知这一处破坏。
 *  不包外层的直接调用会让抛逃逸成「后续断言静默漏跑」（假通过 / 假失败）。 */
function runNeg(fn, m) {
    try { return fn(m) || { ok: false, why: '无返回' }; }
    catch (e) { return { ok: false, why: '破坏变体上直接抛：' + String((e && e.message) || e) }; }
}

test('v3880 D1. 清单读不到也当成读得到（read 三态压平）⇒ 读不到判据必须转红', async () => {
    const neg = await negCopy(M_RW, (s) => {
        const anchor = 'const listReadable = rawList !== null;';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, 'const listReadable = true;');
    });
    const r = runNeg(jUnreadableNotZero, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3880 D2. 身份缺项不再拦（认不出也当成本段）⇒ fail-closed 判据必须转红', async () => {
    const neg = await negCopy(M_RW, (s) => {
        const anchor = "    if (!identityKnown) return { in: false, why: 'identity-unknown' };\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = runNeg(jNoIdentityFailClosed, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3880 D3. 角色身份键退化成名字（同名异宇宙被合并）⇒ 同名不合并判据必须转红', async () => {
    const neg = await negCopy(M_RW, (s) => {
        const anchor = "    return String(pk || '') + '|' + universe + '|' + name;";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '    return name;');
    });
    const r = runNeg(jSameNameNotMerged, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3880 D4. 在飞旧回信不再拦恢复（预检 ok 就放行）⇒ 在飞拦恢复判据必须转红', async () => {
    const neg = await negCopy(M_RW, (s) => {
        const anchor = 'const canRestore = !!(matched && hasOwner && !blocked && !hasStale);';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, 'const canRestore = !!(matched && hasOwner && !blocked);');
    });
    const r = runNeg(jStaleInFlightBlocksRestore, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3880 D5. 跨段行不再拦（别段的行混进本段）⇒ 跨段不混算判据必须转红', async () => {
    const neg = await negCopy(M_RW, (s) => {
        const anchor = "    if (!rwSameScope(row, sel)) return { in: false, why: 'cross-scope' };\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = runNeg(jCrossScopeNotMixed, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3880 D6. 0 楼被当成「没记录」（楼层归一放宽）⇒ 0 楼合法停点判据必须转红', async () => {
    const neg = await negCopy(M_RW, (s) => {
        const anchor = 'return (n !== null && Number.isInteger(n) && n >= 0) ? n : null;';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, 'return (n !== null && Number.isInteger(n) && n > 0) ? n : null;');
    });
    const r = runNeg(jZeroFloorIsAStop, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

/* [v3.88.0 · R-X4] 读持不到的规矩：三种「没清单」不同形。 */
function jArchiveThreeUnreadableShapes(m) {
    const box = (mem) => ({ get: (k, d) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d), set: (k, v) => { mem[k] = v; return true; } });
    const mk = (store) => { const a = new m.ArchiveApp(null, store); a.render = () => {}; a.probe(); return a; };
    const threw = mk({ get: () => { throw new Error('boom'); }, set: () => true });
    if (threw.projectsReadable() !== false) return { ok: false, why: '存储抛异常时清单必须读不到' };
    if (threw.projectsWhy() !== 'read_threw') return { ok: false, why: '归因必须是 read_threw：' + String(threw.projectsWhy()) };
    if (threw.projectCount() !== null) return { ok: false, why: '读不到时条数必须是 null（不画 0）' };
    const mal = mk(box({ archive_pack: JSON.stringify({ raw: 'not json at all', at: 1 }) }));
    if (mal.projectsReadable() !== false) return { ok: false, why: '原文读不懂时清单必须读不到' };
    if (mal.projectsWhy() !== 'payload-unreadable') return { ok: false, why: '归因必须与 read_threw 不同形：' + String(mal.projectsWhy()) };
    const noId = mk(box({ archive_pack: JSON.stringify({ raw: JSON.stringify({ version: 3, contains: ['chats'] }), at: 1 }) }));
    if (noId.projectsReadable() !== true || noId.projectCount() !== 0) return { ok: false, why: '不带身份应是“读得到且空”' };
    return { ok: true, why: '' };
}

test('v3880 D8. 存储抛异常被当成“还没收过包”（取敷前置跟随）⇒ 三形判据必须转红', async () => {
    const neg = await negCopy(A_APP, (s) => {
        const anchor = "        if (this._why === 'read_threw') return;\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = runNeg(jArchiveThreeUnreadableShapes, neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});
test('v3880 D7. 负控制自身可证伪：破坏副本必须真被加载且与原版不同源', async () => {
    const neg = await negCopy(M_RW, (s) => s.replace(
        'export function resumeWorkbenchSelfCheck() {',
        'export function resumeWorkbenchSelfCheck() { return { problems: [\'\u8d1f\u63a7\u5236\u63a2\u9488\'] };'
    ));
    const got = neg.resumeWorkbenchSelfCheck();
    assert.equal(got.problems.length, 1, '破坏副本必须真的被加载且可跑');
    assert.notEqual(JSON.stringify(got), JSON.stringify(RW.resumeWorkbenchSelfCheck()), '破坏副本不得与真源同源');
    /* 第二向：未触及的那条判据在破坏副本上仍须成立（否则破坏过界）。 */
    const r = runNeg(jThreeStatesDistinct, neg);
    assert.equal(r.ok, true, '未触及的那条判据在破坏副本上仍须成立（否则破坏过界）：' + JSON.stringify(r));
});

/* ================== E 版本锚（下限形） ================== */

test('v3880 E1. 版本锚（下限形）：五源同源且不低于 3.88.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read(IDX);
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
    assert.ok(m, 'index.js 必须仍有版本常量');
    const nums = [man.version, pkg.version, m[1], log.latest, log.head].map(String);
    assert.equal(new Set(nums).size, 1, '五源版本必须同源：' + nums.join(' / '));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
        return 0;
    };
    assert.ok(cmp(nums[0], '3.88.0') >= 0, '版本不得低于 3.88.0（本版是它的落地版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
    assert.ok(Array.isArray(entry.items) && entry.items.length >= 8,
        '当版条目数下限 8（计划交付至少八条）：' + (entry.items || []).length);
    for (const it of entry.items) {
        const s = String(it);
        assert.equal(s.indexOf('【'), 0, '条目须以【前缀】起：' + s.slice(0, 20));
        assert.ok(!/[\[\]\\]/.test(s), '条目内不许出现方括号与反斜杠：' + s.slice(0, 24));
        assert.ok(!s.includes(String.fromCharCode(34)), '条目内不许出现双引号：' + s.slice(0, 24));
    }
    const block = idx.slice(idx.indexOf('const ST_PHONE_CURRENT_UPDATE = {'));
    for (const it of entry.items) {
        assert.ok(block.includes(JSON.stringify(it)), '公告块缺当版条目：' + String(it).slice(0, 24));
    }
    /* [v3.89.0 交棒] 原句把上一版专有词（**v3.88.0 复校**）当复校锚 —— 抬版即红，
     *   且把本层这件事偷换成上一版那件事。改写为**下限形**：复校标记必须是当版，
     *   且不得低于本套件成立的那一版（同仓 v3171 E1 的同款形态锚）。 */
    const bnd = read('docs/runtime-verification-boundary.md');
    assert.ok(bnd.includes('v' + man.version + ' 复校'), '边界文档复校标记未跟当版');
    const mV = /v([0-9]+\.[0-9]+\.[0-9]+) 复校/.exec(bnd);
    assert.ok(mV, '边界文档必须仍有复校标记');
    assert.ok(cmp(mV[1], '3.88.0') >= 0, '复校标记不得低于 3.88.0：' + mV[1]);
});

