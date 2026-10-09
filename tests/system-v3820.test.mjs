/* ============================================================
 * tests/system-v3820.test.mjs — B 清单八件：写作面的可验收面 [v3.82.0]
 * ------------------------------------------------------------
 * 本版把附件 B 清单的八笔（B1 氛围池 / B2 关系七级 / B3 判定归脚本 /
 * B4 平行线 / B5 状态字段 / B6 二级摘要 / B7 只记事实拼表 / B8 人工纠错四通道）
 * 从「卡侧的写法偏好」变成**仓内可验收的判据**：
 *
 *   修前的处境（逐条实测的缺口）：
 *     · 环境描写与人物内心**没有任何可点的真源**：副模型只能从训练里最顺手的那批
 *       意象里挑（那批恰恰最油），而「她心里五味杂陈」这类**叙述语言**无处可拦；
 *     · 关系只有卡里写死的静态设定，手机侧读到两百条消息也落不出一句「关系处境」；
 *     · 判定若交给模型，得到的不是随机而是**倾向**（骰子替叙事服务，做法影响不了胜率）；
 *     · 不在场的那条线要么不记（于是它永远不会有下文），要么被塞进本场注入面
 *       （于是角色说出他不可能知道的事）；
 *     · 记忆层**只进不出**：抽错了没有任何人工处置口。
 *
 * 本套件守五件事：
 *   A 结构面：八份真源在场、导出面齐备、唯一消费口（craft-cards）把八张卡收成一面；
 *   B 行为面：每份真源的**真功能**断言（三态互不同形是贯穿全部八笔的主判据）；
 *   C 接线面：真跑诊断内核的 `collectDiagnose`，`craftFace` 必须真被取到并给出八张卡；
 *   D 负控制：**真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据**（每份真源一条）；
 *   E 版本锚（下限形，不锚死当版）。
 *
 * 分工：本套件回答「接线对不对、判据会不会真红」；门的读数由
 * `node scripts/check-file.mjs` 汇总（读不到即 exit 2 拒判）。
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

const M_AMBIENCE = 'config/ambience-pool.js';
const M_RELATION = 'config/relation-tier.js';
const M_SCENE = 'config/scene-rules.js';
const M_STATE = 'config/state-fields.js';
const M_DIGEST = 'config/archive-digest.js';
const M_CORRECTION = 'config/memory-correction.js';
const M_CARDS = 'config/craft-cards.js';
const A_DIAG = 'apps/diagnose/diagnose-data.js';

const AMB = await mod(M_AMBIENCE);
const REL = await mod(M_RELATION);
const SCN = await mod(M_SCENE);
const ST = await mod(M_STATE);
const DG = await mod(M_DIGEST);
const COR = await mod(M_CORRECTION);
const CARDS = await mod(M_CARDS);

/* ══════════════════ 判据函数（负控制必须复用**同一份**） ══════════════════ */

/** B1-① 池子规模与形状：十类、每类六条、每条都带「用在 / 写法」。 */
function jAmbienceShape(m) {
    const kinds = m.AMBIENCE_KINDS || [];
    if (kinds.length !== 10) return { ok: false, why: '类数不是 10：' + kinds.length };
    let total = 0;
    for (const k of kinds) {
        const items = m.AMBIENCE_POOL[k.id] || [];
        if (items.length < 6) return { ok: false, why: '类 ' + k.id + ' 条目不足：' + items.length };
        for (const it of items) {
            if (!it.id || !it.label) return { ok: false, why: k.id + ' 有条目缺 id/label' };
            if (!it.used || !it.how) return { ok: false, why: k.id + '·' + it.id + ' 缺「用在」或「写法」' };
        }
        total += items.length;
    }
    if (m.ambienceCount() !== total) return { ok: false, why: '规模读数与真表不符：' + m.ambienceCount() + ' vs ' + total };
    return { ok: true, why: '' };
}

/** B1-② 三态互不同形：picked / filtered / exhausted 各占一格。 */
function jAmbienceTriad(m) {
    const picked = m.pickAmbience({ kind: 'weather' });
    const filtered = m.pickAmbience({ kind: 'weather', exclude: (m.AMBIENCE_POOL.weather || []).map((x) => 'weather:' + x.id) });
    const span = m.ambienceSpan();
    const all = (m.AMBIENCE_POOL.weather || []).map((x) => x.id);
    for (const id of all) span.mark({ kind: 'weather', id: id });
    const exhausted = m.pickAmbience({ kind: 'weather', usedInScene: span.keys() });
    const states = [picked.state, filtered.state, exhausted.state];
    if (new Set(states).size !== 3) return { ok: false, why: '三态塌成一格：' + JSON.stringify(states) };
    if (!picked.pick || !picked.pick.how) return { ok: false, why: 'picked 没带回条目本体' };
    if (filtered.pick !== null) return { ok: false, why: 'filtered 不该带条目' };
    return { ok: true, why: '' };
}

/** B2-① 七级主判据是承压兑现率，**不是条数**：两千条但从没接过难处 ⇒ 不进「朋友」。 */
function jRelationNotByVolume(m) {
    const talker = m.buildRelation({
        name: '话多但不接',
        readings: { messages: 2000, helped: 0, shrugged: 0, sentByMe: 1000, sentByThem: 1000, spanDays: 200 }
    });
    if (talker.state !== 'graded') return { ok: false, why: '读数充足却没给级：' + JSON.stringify(talker) };
    if (talker.tier.level >= 3) return { ok: false, why: '聊得多就当朋友（级 ' + talker.tier.level + '）—— 主判据没落在承压上' };
    const stander = m.buildRelation({
        name: '接过三次',
        readings: { messages: 40, helped: 3, shrugged: 0, sentByMe: 20, sentByThem: 20, spanDays: 30 }
    });
    if (stander.tier.level <= talker.tier.level) return { ok: false, why: '接过三次的人不该比两千条的人低' };
    return { ok: true, why: '' };
}

/** B2-② 三态互不同形：graded / thin / absent，且 thin **不给级**。 */
function jRelationTriad(m) {
    const absent = m.buildRelation({ name: '' });
    const thin = m.buildRelation({ name: '刚认识', readings: { messages: 1, helped: 0 } });
    const graded = m.buildRelation({ name: '老友', readings: { messages: 50, helped: 3, shrugged: 0, spanDays: 60 } });
    const states = [absent.state, thin.state, graded.state];
    if (new Set(states).size !== 3) return { ok: false, why: '三态塌成一格：' + JSON.stringify(states) };
    if (thin.tier !== null) return { ok: false, why: 'thin 不该给级（会把「刚认识」压成低等级）' };
    if (!graded.tier) return { ok: false, why: 'graded 必须带级' };
    if (m.relationLine(thin) === m.relationLine(graded)) return { ok: false, why: '两态的一行读数同形' };
    return { ok: true, why: '' };
}

/** B2-③ 信任落点**只在受检验时换**，且必须有读数。 */
function jTrustOnlyOnChallenge(m) {
    const base = { point: 'counted-on' };
    const noReading = m.reviewTrust(base, { challenge: 'kept-secret', fulfilled: false });
    if (noReading.changed) return { ok: false, why: '没有读数就换了落点（把「我觉得」写成了「发生过」）' };
    if (noReading.reason !== 'unobserved') return { ok: false, why: '未观测的处置没报出来：' + noReading.reason };
    const unknown = m.reviewTrust(base, { challenge: '随口聊了两句', observed: true, fulfilled: true });
    if (unknown.changed) return { ok: false, why: '非检验项也改了落点（落点会因闲聊漂移）' };
    const real = m.reviewTrust(base, { challenge: 'kept-secret', observed: true, fulfilled: false });
    if (!real.changed || real.point === base.point) return { ok: false, why: '受检验且失约却不换落点' };
    return { ok: true, why: '' };
}

/** B3-① 四落点缺一即拒判：不许「只写成功那一版」就摇骰。 */
function jRollNeedsAllOutcomes(m) {
    const partial = m.rollCheck({
        difficulty: 'normal',
        outcomes: { crit: 'a', success: 'b', fail: 'c' },
        rng: () => 0.9
    });
    if (partial.state !== 'awaiting-difficulty') return { ok: false, why: '缺落点仍被受理：' + partial.state };
    const bad = m.rollCheck({ difficulty: '随口说个数', outcomes: {}, rng: () => 0.5 });
    if (bad.state !== 'invalid') return { ok: false, why: '不合法难度未被单列：' + bad.state };
    if (partial.state === bad.state) return { ok: false, why: '「缺落点」与「难度不合法」同形' };
    return { ok: true, why: '' };
}

/** B3-② 骰子归脚本：同 seed 必得同落点，且「做法修正」真进裁决。 */
function jRollDeterministic(m) {
    const input = {
        difficulty: 'normal',
        outcomes: { crit: 'a', success: 'b', fail: 'c', 'crit-fail': 'd' },
        rng: () => 0.3
    };
    const r1 = m.rollCheck(input);
    const r2 = m.rollCheck(input);
    if (r1.state !== 'resolved' || r2.state !== 'resolved') return { ok: false, why: '就绪输入没摇出结果' };
    if (r1.outcome !== r2.outcome || r1.roll !== r2.roll) return { ok: false, why: '同 seed 两次不同（骰子不可复算）' };
    const boosted = m.rollCheck(Object.assign({}, input, { bonus: 40 }));
    if (boosted.total !== boosted.roll + 40) return { ok: false, why: '做法修正没进裁决' };
    /* 逐档单调：同一 roll 下，难度越高越不该给同一个落点 */
    const easy = m.rollCheck({ difficulty: 'easy', outcomes: { crit: 'a', success: 'b', fail: 'c', 'crit-fail': 'd' }, rng: () => 0.3 });
    const brutal = m.rollCheck({ difficulty: 'brutal', outcomes: { crit: 'a', success: 'b', fail: 'c', 'crit-fail': 'd' }, rng: () => 0.3 });
    if (easy.outcome === brutal.outcome) return { ok: false, why: '同 roll 下极易与极难给同一落点（难度没进裁决）' };
    return { ok: true, why: '' };
}

/** B4 平行线：不在场的线**照样在**，但泄漏进注入面必须点名。 */
function jParallelNoLeak(m) {
    const lines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const clean = m.splitLines(lines, ['a']);
    if (clean.visible.length !== 1) return { ok: false, why: '在场判定错：' + clean.visible.length };
    if (clean.parallel.length !== 2) return { ok: false, why: '平行线未被留下（「不在场所以不记」是那条最贵的错）' };
    if (clean.leaks.length !== 0) return { ok: false, why: '没注入也报泄漏' };
    const leaky = m.splitLines(lines, ['a'], ['b']);
    if (leaky.leaks.length !== 1) return { ok: false, why: '被塞进注入面的平行线没被点名' };
    if (!/泄漏/.test(m.parallelLine(leaky))) return { ok: false, why: '一行读数没说泄漏' };
    return { ok: true, why: '' };
}

/** B5-① 五格三态：set / empty / absent 互不同形。 */
function jFieldTriad(m) {
    const none = m.readStateFields({});
    if (none.counts.absent !== 5) return { ok: false, why: '缺格没报 absent：' + JSON.stringify(none.counts) };
    const partly = m.readStateFields({ doing: '抽烟', want: '' });
    const row = (r, id) => r.rows.find((x) => x.id === id);
    if (row(partly, 'doing').state !== 'set') return { ok: false, why: '有值那格没报 set' };
    if (row(partly, 'want').state !== 'empty') return { ok: false, why: '空值那格被读成 absent（「被问过、答案是空」不是「没被要求」）' };
    if (row(partly, 'afraid').state !== 'absent') return { ok: false, why: '不在的格没报 absent' };
    if (m.stateFieldsLine(partly) === m.stateFieldsLine(none)) return { ok: false, why: '两态的一行读数同形' };
    return { ok: true, why: '' };
}

/** B7 拼表规则：推断键整行剔除；混流行保留事实部分并如实报非事实键。 */
function jFactOnlyRows(m) {
    const r = m.factOnlyRows([
        { who: '她', did: '把伞留下了' },
        { thought: '她其实很喜欢他' },
        { who: '她', note: '顺手记的一句' },
        { who: '', did: '' }
    ]);
    /* 四行输入：① 纯事实保留；② 纯推断整行剔除；③ 混流行**保留事实部分**（who）并把 note 报出来；
     *   ④ 全空剔除 ⇒ 结果表应为 2 行（初版夹具写 1 行，是判据自己算错了行数）。 */
    if (r.rows.length !== 2) return { ok: false, why: '事实行数不对：' + r.rows.length };
    if (!r.dropped.some((d) => d.reason === 'inference')) return { ok: false, why: '推断行没被剔除' };
    if (!r.dropped.some((d) => d.reason === 'nonfact' && d.partial === true)) {
        return { ok: false, why: '混流行应保留事实部分并如实报非事实键' };
    }
    if (!r.dropped.some((d) => d.reason === 'empty')) return { ok: false, why: '空行没被剔除' };
    if (r.rows.some((row) => row.thought || row.note || row.mood)) return { ok: false, why: '推断键或非事实键仍留在结果里' };
    return { ok: true, why: '' };
}

/** B6 二级摘要：档案够 ⇒ 第二级**只读档案**；不够 ⇒ 如实降级且说清。 */
function jTwoStage(m) {
    const raw = '很长的原文'.repeat(50);
    const two = m.planTwoStage({ raw: raw, archive: [{ kind: 'event', text: '她把伞留在了门口', who: '她' }] });
    if (two.state !== 'two-stage') return { ok: false, why: '档案够却没走两级：' + JSON.stringify(two) };
    if (two.stage2Input.includes('很长的原文')) return { ok: false, why: '第二级仍能读到原文（分级等于没做）' };
    if (!two.stage2Input.includes('她把伞留在了门口')) return { ok: false, why: '第二级没拿到档案正文' };
    const flat = m.planTwoStage({ raw: raw, archive: [] });
    if (flat.state !== 'flattened') return { ok: false, why: '档案不足没降级：' + flat.state };
    if (flat.stage2Input !== raw) return { ok: false, why: '降级时第二级拿到的不是原文（那是谎言）' };
    const refused = m.planTwoStage({ raw: '', archive: [] });
    if (refused.state !== 'refused') return { ok: false, why: '原文不在却仍给分级' };
    if (new Set([two.state, flat.state, refused.state]).size !== 3) return { ok: false, why: '三态塌成一格' };
    return { ok: true, why: '' };
}

/** B6-② 叙述语言：档案条文本体带叙述语言必须拒收（「谁在心里想」不许进事实表）。 */
function jNarrationRejected(m) {
    const bad = m.checkArchiveItem({ kind: 'event', text: '她心里一沉，把伞收了起来', who: '她' });
    if (bad.ok) return { ok: false, why: '带叙述语言的条目进了档案' };
    const noFact = m.checkArchiveItem({ kind: 'event', text: '她很难过' });
    if (noFact.ok) return { ok: false, why: '只有情绪、没有事实字段的条目进了档案' };
    const good = m.checkArchiveItem({ kind: 'event', text: '她把伞留在了门口', who: '她', when: '周三' });
    if (!good.ok) return { ok: false, why: '正常事实条目被拒：' + good.why };
    const scan = m.scanNarration('她心里一沉，又看了一眼门口');
    if (scan.count !== 1) return { ok: false, why: '正文叙述语言扫描没命中：' + scan.count };
    return { ok: true, why: '' };
}

/** B8 四通道互不同形，且人工补的条目不许被 remove 悄悄带走。 */
function jCorrectionChannels(m) {
    const rows = [{ id: 'a', text: '她说她不去' }];
    const rm = m.applyCorrection(rows, { channel: 'remove', target: 'a' });
    if (rm.state !== 'applied' || rm.rows.length !== 0) return { ok: false, why: '删掉没生效' };
    const one = m.applyCorrection(rows, { channel: 'recompute-one', target: 'a' });
    if (one.state !== 'applied') return { ok: false, why: '单独重算没生效：' + one.why };
    if (one.changed.length !== 1) return { ok: false, why: '单独重算动了不止一条：' + one.changed.length };
    const batch = m.applyCorrection([{ id: 'a' }, { id: 'b' }], { channel: 'recompute', target: 'a', batch: ['a', 'b'] });
    if (batch.changed.length !== 2) return { ok: false, why: '重算没覆盖整批：' + batch.changed.length };
    const add = m.applyCorrection(rows, { channel: 'append', text: '她其实是去接人了' });
    if (add.state !== 'applied' || add.rows.length !== 2) return { ok: false, why: '加上没生效' };
    if (add.rows[1].source !== m.HUMAN_SOURCE) return { ok: false, why: '人工补的条目没标来源（下次会被自动条目顶掉）' };
    const dup = m.applyCorrection(rows, { channel: 'append', text: '她说她不去' });
    if (dup.state !== 'noop') return { ok: false, why: '重复补没报 noop：' + dup.state };
    const bad = m.applyCorrection(rows, { channel: '改一改', target: 'a' });
    if (bad.state !== 'refused') return { ok: false, why: '不认识的通道没被拒收' };
    if (new Set([rm.state, dup.state, bad.state]).size !== 3) return { ok: false, why: 'applied/noop/refused 三态塌了一格' };
    /* 人工补的条目不许被 remove 通道悄悄带走 */
    const guard = m.applyCorrection(add.rows, { channel: 'remove', target: add.rows[1].id });
    if (guard.state !== 'refused') return { ok: false, why: '人工条目被 remove 顺手删掉了（必须显式确认）' };
    return { ok: true, why: '' };
}

/** 唯一消费口：八张卡都必须给出真读数。 */
function jCraftCards(m) {
    const faces = m.craftFaces();
    if (faces.length !== 8) return { ok: false, why: '卡片数不是 8：' + faces.length };
    for (const f of faces) {
        if (!f.id || !f.line) return { ok: false, why: '卡片缺 id/line：' + JSON.stringify(f) };
        if (typeof f.line === 'string' && /无读数|未知/.test(f.line)) {
            return { ok: false, why: '卡片 ' + f.id + ' 没给出活读数：' + f.line };
        }
    }
    if (!/8 张卡/.test(m.craftLine(faces))) return { ok: false, why: '总读数没报张数：' + m.craftLine(faces) };
    return { ok: true, why: '' };
}

/* ══════════════════ A 结构面 ══════════════════ */

test('v3820 A1. 八份真源在场，导出面齐备（缺一项即该笔未落地）', () => {
    const wants = [
        [M_AMBIENCE, ['AMBIENCE_KINDS', 'AMBIENCE_POOL', 'ambienceCount', 'pickAmbience', 'ambienceSpan', 'ambienceLine']],
        [M_RELATION, ['RELATION_TIERS', 'AFFECTION_TONES', 'TRUST_CHALLENGES', 'tierOf', 'affectionTone', 'reviewTrust', 'buildRelation', 'relationLine']],
        [M_SCENE, ['OUTCOMES', 'DIFFICULTY_LINES', 'rollD100', 'setDifficulty', 'rollCheck', 'rollLine', 'linePresence', 'splitLines', 'parallelLine']],
        [M_STATE, ['STATE_FIELDS', 'FACT_KEYS', 'INFERENCE_KEYS', 'fieldState', 'readStateFields', 'stateFieldsLine', 'factOnlyRows', 'factRowsLine']],
        [M_DIGEST, ['ARCHIVE_KINDS', 'NARRATION_MARKERS', 'ARCHIVE_FACT_FIELDS', 'checkArchiveItem', 'checkArchive', 'scanNarration', 'planTwoStage', 'twoStageLine']],
        [M_CORRECTION, ['CORRECTION_CHANNELS', 'HUMAN_SOURCE', 'applyCorrection', 'applyCorrections', 'correctionLine']],
        [M_CARDS, ['craftFaces', 'craftLine']]
    ];
    for (const [rel, names] of wants) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), '真源必须在场：' + rel);
        const src = read(rel);
        for (const name of names) {
            assert.match(src, new RegExp('export (function |const )?' + name + '\\b'), rel + ' 缺导出：' + name);
        }
    }
});

test('v3820 A2. 唯一消费口把八张卡收成一面，且诊断内核真读它', () => {
    const cards = read(M_CARDS);
    /* 八张卡必须**转出**给调用方的能力面（不新造第二份实现）：每一份真源都要在卡面上出现一次 */
    for (const rel of [M_AMBIENCE, M_RELATION, M_SCENE, M_STATE, M_DIGEST, M_CORRECTION]) {
        assert.ok(cards.includes("'" + rel.replace('config/', './')) + "'" || cards.includes(rel.replace('config/', './')),
            '唯一消费口必须引用真源：' + rel);
    }
    const diag = read(A_DIAG);
    assert.match(diag, /import \{ craftFaces, craftLine \} from '\.\.\/\.\.\/config\/craft-cards\.js'/,
        '诊断内核必须引用唯一消费口（否则就是「内核建好了、产品端零消费」）');
    assert.match(diag, /const craftFace = \(\(\) => \{/, '诊断内核必须真取这一面');
    assert.match(diag, /export function craftFaceText\(/, '必须有一行读数出口（视图不自拼）');
});

test('v3820 A3. 三态纪律贯穿八笔（每份真源都有各自的三态常量或分支）', () => {
    const triads = [
        [M_AMBIENCE, ['picked', 'filtered', 'exhausted']],
        [M_RELATION, ['graded', 'thin', 'absent']],
        [M_SCENE, ['resolved', 'awaiting-difficulty', 'invalid']],
        [M_STATE, ['set', 'empty', 'absent']],
        [M_DIGEST, ['two-stage', 'flattened', 'refused']],
        [M_CORRECTION, ['applied', 'noop', 'refused']]
    ];
    for (const [rel, states] of triads) {
        const src = read(rel);
        for (const s of states) {
            assert.ok(src.includes("'" + s + "'"), rel + ' 缺三态之一：' + s);
        }
    }
});

/* ══════════════════ B 行为面 ══════════════════ */

test('v3820 B1. B1 氛围池：十类六十条且每条带「用在 / 写法」；三态互不同形', () => {
    const a = jAmbienceShape(AMB);
    assert.equal(a.ok, true, 'B1 形状判据不成立：' + a.why);
    const b = jAmbienceTriad(AMB);
    assert.equal(b.ok, true, 'B1 三态判据不成立：' + b.why);
});

test('v3820 B2. B2 关系七级：承压兑现率是主判据（不是条数）；三态与信任落点', () => {
    for (const [name, fn] of [['不按条数给级', jRelationNotByVolume], ['三态互不同形', jRelationTriad],
        ['落点只受检验时换', jTrustOnlyOnChallenge]]) {
        const r = fn(REL);
        assert.equal(r.ok, true, 'B2 判据「' + name + '」不成立：' + r.why);
    }
});

test('v3820 B3. B3/B4 判定：四落点缺一即拒判、同 seed 可复算；平行线不泄漏', () => {
    const a = jRollNeedsAllOutcomes(SCN);
    assert.equal(a.ok, true, 'B3 落点判据不成立：' + a.why);
    const b = jRollDeterministic(SCN);
    assert.equal(b.ok, true, 'B3 可复算判据不成立：' + b.why);
    const c = jParallelNoLeak(SCN);
    assert.equal(c.ok, true, 'B4 平行线判据不成立：' + c.why);
});

test('v3820 B4. B5/B7 状态字段三态：set / empty / absent；事实表只留可核事实', () => {
    const a = jFieldTriad(ST);
    assert.equal(a.ok, true, 'B5 判据不成立：' + a.why);
    const b = jFactOnlyRows(ST);
    assert.equal(b.ok, true, 'B7 判据不成立：' + b.why);
});

test('v3820 B5. B6 二级摘要：档案够则第二级只读档案；叙述语言不许进档案', () => {
    const a = jTwoStage(DG);
    assert.equal(a.ok, true, 'B6 分级判据不成立：' + a.why);
    const b = jNarrationRejected(DG);
    assert.equal(b.ok, true, 'B6 叙述语言判据不成立：' + b.why);
});

test('v3820 B6. B8 人工纠错四通道：方向不同、三态互不同形、人工条目受保护', () => {
    const r = jCorrectionChannels(COR);
    assert.equal(r.ok, true, 'B8 判据不成立：' + r.why);
});

test('v3820 B7. 唯一消费口：八张卡都给出活读数（不是「已加载」这种空话）', () => {
    const r = jCraftCards(CARDS);
    assert.equal(r.ok, true, '消费口判据不成立：' + r.why);
});

/* ══════════════════ C 接线面（真跑产品路径） ══════════════════ */

test('v3820 C1. 真跑 collectDiagnose：craftFace 与八张卡必须真被取到', async () => {
    const DIAG = await mod(A_DIAG);
    const ctx = DIAG.collectDiagnose({}, { get: () => null, set: () => {} });
    assert.ok(ctx && typeof ctx === 'object', '诊断内核必须返回读数包');
    const face = ctx.craftFace;
    assert.ok(face, 'craftFace 必须真的被取到（null 即接线断了）');
    assert.equal(face.ok, true, '写作面自检必须通过：' + JSON.stringify(face.problems));
    assert.equal(Array.isArray(face.cards) && face.cards.length, 8, '八张卡必须都在：' + (face.cards || []).length);
    const text = DIAG.craftFaceText(face);
    assert.match(text, /8 张卡/, '一行读数必须真说出来：' + text);
    /* 三态：面缺席时必须说「读不到」，不许显示成「八张卡都在」 */
    assert.match(DIAG.craftFaceText(null), /读不到/, '面缺席必须说读不到');
    assert.notEqual(DIAG.craftFaceText(null), text, '缺席态与就绪态的一行读数不许同形');
});

/* ══════════════════ D 负控制（真源码破坏 → 破坏副本 → 同款判据） ══════════════════ */
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

test('v3820 D1. 氛围池：把「本场已用尽」并进「被排除」（exhausted 塌成 filtered）⇒ 三态判据必须转红', async () => {
    const neg = await negCopy(M_AMBIENCE, (s) => {
        const anchor = "return { state: 'exhausted', pick: null,";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "return { state: 'filtered', pick: null,");
    });
    const good = jAmbienceTriad(AMB);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jAmbienceTriad(neg);
    assert.equal(broke.ok, false, '三态塌成一格之后判据必须转红');
});

test('v3820 D2. 关系：把「条数」当成主判据（聊得多就给到朋友以上）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_RELATION, (s) => {
        const anchor = 'if ((msgs || 0) >= 10) level = 2;';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'if ((msgs || 0) >= 10) level = 4;');
    });
    const good = jRelationNotByVolume(REL);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jRelationNotByVolume(neg);
    assert.equal(broke.ok, false, '条数成了主判据之后判据必须转红');
});

test('v3820 D3. 关系：让落点在非检验项上也换（未经检验即改写）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_RELATION, (s) => {
        const anchor = "if (!known) return { point: prev, changed: false, reason: 'unknown-challenge' };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'if (!known) return { point: prev + "-drift", changed: true, reason: "challenged" };');
    });
    const good = jTrustOnlyOnChallenge(REL);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jTrustOnlyOnChallenge(neg);
    assert.equal(broke.ok, false, '落点可被闲聊改写之后判据必须转红');
});

test('v3820 D4. 判定：缺落点也照样摇（拒判退化成纵容）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_SCENE, (s) => {
        const anchor = 'return { ok: false, difficulty: key, need: line.need, outcomes: out, why: ';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'return { ok: true, difficulty: key, need: line.need, outcomes: Object.assign({ crit: "?", success: "?", fail: "?", "crit-fail": "?" }, out), why: ');
    });
    const good = jRollNeedsAllOutcomes(SCN);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jRollNeedsAllOutcomes(neg);
    assert.equal(broke.ok, false, '缺落点被纵容之后判据必须转红');
});

test('v3820 D5. 平行线：把不在场的线也当在场（parallel 塌成 present）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_SCENE, (s) => {
        const anchor = ": { presence: 'parallel', why: '本场不在场：只记状态，不进注入' };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, ": { presence: 'present', why: '' };");
    });
    const good = jParallelNoLeak(SCN);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jParallelNoLeak(neg);
    assert.equal(broke.ok, false, '平行线被当在场之后判据必须转红');
});

test('v3820 D6. 状态字段：把「不在」并进「空」（absent 塌成 empty）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_STATE, (s) => {
        const anchor = "return { state: 'absent', value: '', why: '这一格不在（模型没被要求过）' };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "return { state: 'empty', value: '', why: '这一格为空（是读数：被问过，答案是没有）' };");
    });
    const good = jFieldTriad(ST);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jFieldTriad(neg);
    assert.equal(broke.ok, false, 'absent 塌成 empty 之后判据必须转红');
});

test('v3820 D7. 事实表：让推断行也留下（只剔键不剔行）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_STATE, (s) => {
        const anchor = "if (inference) { dropped.push({ row: row, reason: 'inference', key: inference }); continue; }";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "if (inference) { dropped.push({ row: row, reason: 'inference', key: inference }); out.push(kept); continue; }");
    });
    const good = jFactOnlyRows(ST);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jFactOnlyRows(neg);
    assert.equal(broke.ok, false, '推断行被留下之后判据必须转红');
});

test('v3820 D8. 二级摘要：档案不足仍报两级（flattened 塌成 two-stage）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_DIGEST, (s) => {
        const anchor = "            state: 'flattened', stage2Input: raw, archive: checked.items || [],";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "            state: 'two-stage', stage2Input: raw, archive: checked.items || [],");
    });
    const good = jTwoStage(DG);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jTwoStage(neg);
    assert.equal(broke.ok, false, '降级被伪装成两级之后判据必须转红');
});

test('v3820 D9. 纠错：让「没变化」也报成「已生效」（noop 塌成 applied）⇒ 判据必须转红', async () => {
    const neg = await negCopy(M_CORRECTION, (s) => {
        const anchor = "            return { state: 'noop', rows: list, changed: [], channel: channel, why: '同内容已在表里（不重复补）' };";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "            return { state: 'applied', rows: list, changed: [], channel: channel, why: '' };");
    });
    const good = jCorrectionChannels(COR);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jCorrectionChannels(neg);
    assert.equal(broke.ok, false, 'noop 被报成 applied 之后判据必须转红');
});

test('v3820 D10. 唯一消费口：让某张卡不给读数（内核面塌一张）⇒ 消费口判据必须转红', async () => {
    const neg = await negCopy(M_CARDS, (s) => {
        const anchor = "        { id: 'narration', label: '叙述语言扫描', rows: scanNarration('她心里一沉').count, kinds: 0, line: '叙述语言：命中 ' + scanNarration('她心里一沉').count + ' 处' }";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "        { id: 'narration', label: '叙述语言扫描', rows: 1, kinds: 0, line: '叙述语言：无读数（neg）' }");
    });
    const good = jCraftCards(CARDS);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jCraftCards(neg);
    assert.equal(broke.ok, false, '卡片不给读数之后消费口判据必须转红');
});

/* ══════════════════ E 版本锚（下限形） ══════════════════ */

test('v3820 E1. 版本锚（下限形）：五源同源且不低于 3.82.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read('index.js');
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
    assert.ok(cmp(nums[0], '3.82.0') >= 0, '版本不得低于 3.82.0（本版是它的接线版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
});