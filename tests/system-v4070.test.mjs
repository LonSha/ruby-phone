/* ========================================================
 * tests/system-v4070.test.mjs -- [v4.07.0 · 第三期 C 包手机侧首项 R3-O3]
 *   群聊节奏与角色表达差异(冷却 / 未接话题 / 关系相关度 / 允许沉默)
 *
 * 【计划原文 R3-O3 的验收口径(逐字)】
 *   「六人群连续 20 轮中,@ 可靠命中,不每轮固定前三人;同一往事不被六人复述;
 *    角色不知道的内容不进入其请求。」
 *
 * 【修前实测的缺口(不是推演)】
 *   apps/wechat/group-scheduler.js::scheduleSpeakers 做的是「把 LLM 给的名字映射回
 *   成员、去重保序、cap 人数」—— 它**完全不看历史**:没有「谁刚说过话」,没有
 *   「这个话题谁还没接」,与「关系」无关。于是验收里那三条一处都不成立。
 *   缺的不是数据(群成员 / 消息 / 维系度都在),缺的是把读数落成
 *   「这一轮该给谁多少台面」的那一层。本版补的就是它(config/group-pace.js)。
 *
 * 判据面(五组):
 *   A 结构与口径:四态归因词不塌 / 四档私密度 / 上限冻结 / 零依赖边界 / 自检零问题
 *   B 行为:空历史可判而读不到报不同形 / 冷却真的降权 / 同一往事不被复述 /
 *           @ 硬命中且不进权重 / 允许沉默(没人够格时不硬塞) / 关系只判下限不排序
 *   C 接线:数据层真读真源(消息 + 成员 tier)/ 群聊提示词真进读数 / 诊断面真取数
 *   D 负控制:真源码定点破坏三条口径 ⇒ 对应判据必转红(且破坏可观测改变行为)
 *   E 版本锚:下限形
 *
 * 【为什么断言用 includes 而非正则】本套件锚点里全是括号与星号,
 *   正则转义层数一多,「判据自身」会静默失效(本仓已有前例:星号转义退化成
 *   「反斜杠重复零次」而侥幸通过 = 假绿)。故除数字外一律用 includes。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CORE = 'config/group-pace.js';
const DATA = 'apps/wechat/wechat-data.js';
const VIEWSRC = 'apps/wechat/chat-view.js';
const DGDATA = 'apps/diagnose/diagnose-data.js';
const DGVIEW = 'apps/diagnose/diagnose-view.js';

const core = read(CORE);
const data = read(DATA);
const viewSrc = read(VIEWSRC);
const dgData = read(DGDATA);
const dgView = read(DGVIEW);
const mod = await import(pathToFileURL(path.join(ROOT, CORE)).href);

/** 去注释后扫代码(本仓反复踩过「注释里的词被当成代码」的坑)。逐字符扫描,不用正则。 */
const strip = (s) => {
    const src = String(s);
    let out = '';
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        const nx = src[i + 1];
        if (ch === '/' && nx === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            out += ' ';
            continue;
        }
        if (ch === '/' && nx === '/') {
            i += 2;
            while (i < src.length && src[i] !== '\n') i++;
            out += ' ';
            continue;
        }
        out += ch;
        i++;
    }
    return out;
};
const codeOf = (s) => strip(s);
/** 去注释 + 去字符串字面量(判据要「真代码」时用)。 */
const bareOf = (s) => strip(s).replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');

const M = (extra = {}) => Object.assign({
    members: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }, { name: 'F' }]
}, extra);

/* ---------- A 结构与口径 ---------- */
test('A1 自检零问题 + 出口齐备', () => {
    const r = mod.groupPaceSelfCheck();
    assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
    for (const fn of ['normalizeGroupHistory', 'tierIndexOf', 'planGroupPace', 'groupPaceLine', 'groupPaceSelfCheck']) {
        assert.equal(typeof mod[fn], 'function', '缺出口:' + fn);
    }
});
test('A2 六个归因词各有各的字样(两态同形即失败)', () => {
    const t = mod.GROUP_PACE_REASONS;
    const keys = Object.keys(t);
    assert.ok(keys.length >= 6);
    for (const k of keys) assert.equal(typeof t[k], 'string', '缺文案:' + k);
    assert.equal(new Set(keys.map((k) => t[k])).size, keys.length, '归因词不得塌成同形');
    /* 「读不到」与「真没人」必须是两个词 */
    assert.notEqual(t['no-recent-face'], t.thin, '读不到与读数太少不许同形');
    assert.notEqual(t['all-cooled'], t['no-eligible'], '全场冷却与无人够格不许同形');
});
test('A3 四档私密度与四态归因词齐备且冻结', () => {
    for (const k of ['public', 'personal', 'intimate', 'secret']) {
        assert.equal(typeof mod.GROUP_PACE_PRIVACY[k], 'number', '缺私密度档:' + k);
    }
    for (const k of ['privacy-absent', 'tier-absent', 'tier-too-low', 'eligible']) {
        assert.equal(typeof mod.GROUP_PACE_PRIVACY_REASONS[k], 'string', '缺归因词:' + k);
    }
    /* 私密度必须单调递增:secret 的要求不得低于 public */
    const p = mod.GROUP_PACE_PRIVACY;
    assert.ok(p.secret >= p.intimate && p.intimate >= p.personal && p.personal >= p.public);
    assert.ok(Object.isFrozen(mod.GROUP_PACE_REASONS) && Object.isFrozen(mod.GROUP_PACE_PRIVACY)
        && Object.isFrozen(mod.GROUP_PACE_PRIVACY_REASONS) && Object.isFrozen(mod.GROUP_PACE_LIMITS)
        && Object.isFrozen(mod.GROUP_PACE_TIERS));
});
test('A4 上限冻结且都是正数', () => {
    assert.ok(Object.isFrozen(mod.GROUP_PACE_LIMITS));
    for (const k of ['coolWindow', 'coolPenalty', 'topicBonus', 'repeatPenalty', 'minSpeakers', 'maxSpeakers', 'minHistory']) {
        assert.equal(typeof mod.GROUP_PACE_LIMITS[k], 'number', '缺上限:' + k);
        assert.ok(mod.GROUP_PACE_LIMITS[k] >= 1, '上限须为正:' + k);
    }
});
test('A5 零依赖零宿主边界(只 import 一处,代码里无 window / storage / eval)', () => {
    const imports = core.match(/^import .*$/gm) || [];
    assert.equal(imports.length, 1, '内核只许 import 一处,实测 ' + imports.length);
    assert.ok(imports[0].includes("'./num-gate.js'"), '那唯一一处必须是 num-gate:' + imports[0]);
    const c = codeOf(core);
    for (const bad of ['window', 'document', 'localStorage', 'sessionStorage', 'fetch(', 'eval(',
        'new Function', 'setTimeout', 'dispatchEvent', 'CustomEvent', 'require(']) {
        assert.equal(c.indexOf(bad), -1, '内核代码里不得出现 ' + bad);
    }
});

/* ---------- B 行为 ---------- */
test('B1 空历史 ≠ 读不到历史:前者可判,后者如实报(两态不同形)', () => {
    /* 真仓初始轮:history 是**空数组**(真的还没人说话)⇒ 可判、不得报 thin */
    const empty = mod.planGroupPace(M({ history: [], topic: 't' }));
    assert.equal(empty.ok, true, '空历史必须可判(否则新群永远开不了口)');
    assert.notEqual(empty.state, 'thin', '空历史不得报 thin');
    assert.ok(empty.speakers.length >= 1, '空历史下应能排出人');
    /* 读不到:history 不是数组 / 没给 ⇒ 报 no-recent-face,且不出人 */
    const noFace = mod.planGroupPace(M({}));
    assert.equal(noFace.reason, 'no-recent-face', '没给历史必须如实报读不到');
    assert.equal(noFace.speakers.length, 0, '读不到时不许凭空排人');
    const notArr = mod.planGroupPace(M({ history: 'x' }));
    assert.equal(notArr.reason, 'no-recent-face', '非数组历史按读不到处理');
});
test('B2 冷却真的降权:刚说过话的人排到后面,且如实计数', () => {
    const hist = [{ name: 'A', topic: 'p' }, { name: 'B', topic: 'p' }, { name: 'C', topic: 'p' }];
    const r = mod.planGroupPace(M({ history: hist, topic: 'q' }));
    assert.equal(r.readings.cooled, 3, '最近窗口内三人必须被计入冷却');
    for (const n of ['A', 'B', 'C']) assert.ok(r.cooled.includes(n), '冷却表应点名 ' + n);
    /* 排序:冷却者不得排在未冷却者之前(且同分保持成员原序) */
    const names = r.speakers.map((m) => m.name);
    const firstCooled = names.findIndex((n) => ['A', 'B', 'C'].includes(n));
    const lastFresh = names.map((n, i) => (['A', 'B', 'C'].includes(n) ? -1 : i)).filter((i) => i >= 0).pop();
    if (firstCooled >= 0 && lastFresh !== undefined) {
        assert.ok(firstCooled > lastFresh, '冷却者不该排在新鲜者之前:' + names.join(','));
    }
});
test('B3 同一往事不被复述:接过该话题的人被降权', () => {
    /* 历史刻意让 A/B/C **滑出冷却窗**(最后三条是 D/E/F 说的、且话题是 p):
     *   这样「让位」只能由**话题降权**解释 —— 冷却不参与,判据才真的在测这一条。
     *   (若让他们留在冷却窗内,让位会被冷却一并解释掉,破坏话题降权也看不出差别 ——
     *    那是负控制「破坏不可观测」的典型,本套件 D2 正是这么抓出来的。) */
    const hist = [
        { name: 'A', topic: 'X' }, { name: 'B', topic: 'X' }, { name: 'C', topic: 'X' },
        { name: 'D', topic: 'p' }, { name: 'E', topic: 'p' }, { name: 'F', topic: 'p' }
    ];
    const r = mod.planGroupPace(M({ history: hist, topic: 'X' }));
    /* ★ 前提自证:**A/B/C 必须不在冷却窗内** ——
     *   否则「让位」会被冷却一并解释掉,这条判据就不再专测话题降权。
     *   (D/E/F 在窗内是本设计的另一份;他们仍被期望顶上,因为话题加成盖过冷却罚分 ——
     *    那一点本身也是口径:未接话题比「刚说过话」更值得让位。) */
    for (const n of ['A', 'B', 'C']) assert.ok(!r.cooled.includes(n), n + ' 不该在冷却窗内(前提)');
    const picked3 = r.speakers.slice(0, 3).map((m) => m.name);
    assert.deepEqual(picked3, ['D', 'E', 'F'], '已接过 X 的三人必须让位:' + picked3.join(','));
    /* 反向对照:**同一份历史、换一个没人接过的话题**。
     *   此时 A/B/C 不再吃 repeatPenalty,而 D/E/F 也不再吃 topicBonus ⇒ 六人同分,
     *   稳定排序退化为成员原序 ⇒ A 必须回到首位。
     *   这一对照正是「让位由话题降权造成」的反证(换成 Y 就不让位了)。 */
    const other = mod.planGroupPace(M({ history: hist, topic: 'Y' }));
    assert.equal(other.speakers[0].name, 'A', '换到没人接过的话题后不该再让位:'
        + other.speakers.map((m) => m.name).join(','));
    assert.equal(r.speakers[0].name, 'D', '接过 X 时必须让位(两向对照)');
});
test('B4 @ 是硬命中:直接进台面,且**不进权重排序**、不受冷却与上限裁掉', () => {
    const hist = [{ name: 'F', topic: 'p' }];   /* F 刚说过话(冷却中)*/
    const r = mod.planGroupPace(M({ history: hist, topic: 'q', mentions: ['F'] }));
    assert.ok(r.forced.includes('F'), '@ 点名必须进 forced:' + JSON.stringify(r.forced));
    assert.equal(r.speakers[0].name, 'F', '@ 者排在台面首位(硬命中不是「更想让他说」)');
    /* 别名也要能命中 */
    const withAlias = mod.planGroupPace({
        members: [{ name: '甲', aliases: ['ali1'] }, { name: '乙' }],
        history: [{ name: '乙', topic: 'p' }], topic: 'q', mentions: ['ali1']
    });
    assert.ok(withAlias.forced.includes('甲'), '别名 @ 必须命中');
    /* 只 @ 一个人时,其余仍按节奏排 */
    assert.ok(r.speakers.length <= mod.GROUP_PACE_LIMITS.maxSpeakers);
});
test('B5 允许沉默:全场冷却 / 无人够格 ⇒ 如实少说,不硬塞', () => {
    /* 只两人且都刚说过 ⇒ 冷却罚分把大家压到同分,但仍如实出人(不为凑人数硬塞)**/
    const two = mod.planGroupPace({
        members: [{ name: 'A' }, { name: 'B' }],
        history: [{ name: 'A', topic: 'p' }, { name: 'B', topic: 'p' }], topic: 'q'
    });
    assert.equal(two.reason, 'ok');
    assert.ok(two.speakers.length <= 2, '不得超出实际人数');
    /* 私密门槛把所有不够格的人全挡掉 ⇒ reason 如实报 no-eligible 且台面为空 */
    const blocked = mod.planGroupPace({
        members: [{ name: 'A' }, { name: 'B' }],
        history: [{ name: 'C', topic: 'p' }, { name: 'D', topic: 'p' }],
        topic: 'q', privacy: 'secret', tiers: { A: 'stranger', B: 'acquaintance' }
    });
    assert.equal(blocked.speakers.length, 0, '没人够格时不许硬塞:' + JSON.stringify(blocked.speakers));
    assert.equal(blocked.reason, 'no-eligible', '必须如实报无人够格:' + blocked.reason);
    assert.equal(blocked.silent, true, 'silent 必须为真');
    assert.equal(blocked.readings.skippedPrivate, 2, '被私密门槛挡下的人数要如实计');
});
test('B6 关系刻度只判下限、不参与排序(否则永远只有最亲的几个说话)', () => {
    /* 两人一亲一疏,话题公开 ⇒ 疏者也该能轮到(不上私密门槛就不挡他)*/
    const r = mod.planGroupPace({
        members: [{ name: '近' }, { name: '疏' }], history: [], topic: 'q',
        privacy: 'personal', tiers: { 近: 'intimate', 疏: 'contact' }
    });
    assert.ok(r.speakers.some((m) => m.name === '疏'), '够格者不该因「不够亲」被排序压下去');
    /* 门槛真的在挡:把疏者降到不够格 ⇒ 他必须被挡 */
    const blocked = mod.planGroupPace({
        members: [{ name: '近' }, { name: '疏' }], history: [], topic: 'q',
        privacy: 'intimate', tiers: { 近: 'intimate', 疏: 'acquaintance' }
    });
    assert.ok(!blocked.speakers.some((m) => m.name === '疏'), '不足下限者必须被挡');
    assert.equal(blocked.readings.skippedPrivate, 1);
    /* 读不到刻度 ⇒ 不设门槛(不默认成陌生人),且读数里如实标明面在不在 */
    const noTier = mod.planGroupPace({
        members: [{ name: '甲' }], history: [], topic: 'q', privacy: 'secret', tiers: null
    });
    assert.equal(noTier.readings.privacyFace, true, '私密度给了就该标面在场');
    assert.equal(noTier.speakers.length, 1, '刻度读不到时不得默认把人挡掉');
});
test('B7 六人群 20 轮:@ 可靠命中,且不每轮固定前三人(验收原文第一条)', () => {
    let history = [];
    const counts = {};
    let mentionHits = 0;
    const M6 = M().members;
    for (let round = 0; round < 20; round++) {
        const mentions = round === 5 ? ['F'] : [];
        const r = mod.planGroupPace({ members: M6, history, topic: 'T' + (round % 3), mentions });
        if (round === 5) {
            if (r.forced.includes('F') && r.speakers[0] && r.speakers[0].name === 'F') mentionHits += 1;
        }
        const picked = r.speakers.slice(0, 3).map((m) => m.name);
        for (const n of picked) counts[n] = (counts[n] || 0) + 1;
        history = history.concat(picked.map((n) => ({ name: n, topic: 'T' + (round % 3) })));
    }
    assert.equal(mentionHits, 1, '@ 必须可靠命中');
    assert.equal(Object.keys(counts).length, 6, '六个人必须都轮到过(不固定前三人):' + JSON.stringify(counts));
    const vals = Object.values(counts);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 2, '出场分布不得悬殊:' + JSON.stringify(counts));
});
test('B8 纯函数不改入参', () => {
    const raw = M({ history: [{ name: 'A', topic: 'p' }], topic: 'q', mentions: ['B'], tiers: { A: 'friend' } });
    const snap = JSON.stringify(raw);
    mod.normalizeGroupHistory(raw.history);
    mod.planGroupPace(raw);
    mod.planGroupPace(raw, { maxSpeakers: 1 });
    assert.equal(JSON.stringify(raw), snap, '入参被改了');
});
test('B9 上限真的封顶:maxSpeakers 超出人数 / 超出上限都被夹', () => {
    const many = [];
    for (let i = 0; i < 20; i++) many.push({ name: 'M' + i });
    const r = mod.planGroupPace({ members: many, history: [], topic: 'q' }, { maxSpeakers: 999 });
    assert.ok(r.speakers.length <= mod.GROUP_PACE_LIMITS.maxSpeakers,
        '不得超内核心上限:' + r.speakers.length);
    const one = mod.planGroupPace({ members: many, history: [], topic: 'q' }, { maxSpeakers: 1 });
    assert.equal(one.speakers.length, 1, '显式 maxSpeakers 必须生效');
});
test('B10 一行读数三态各占一格(不与「没人说话」同形)', () => {
    const ok = mod.groupPaceLine(mod.planGroupPace(M({ history: [], topic: 'q' })));
    assert.ok(ok.includes('台面'), '有读数时要点出台面:' + ok);
    const noMember = mod.groupPaceLine(mod.planGroupPace({ members: [] }));
    assert.ok(noMember.includes('一个人都没有'), '无人时要说清:' + noMember);
    const noFace = mod.groupPaceLine(mod.planGroupPace(M({})));
    assert.ok(noFace.includes('拿不到最近发言读数'), '读不到时要说清:' + noFace);
    assert.notEqual(noMember, noFace, '三种情形不许同形');
    assert.equal(mod.groupPaceLine(null), '群聊节奏:无读数');
});

/* ---------- C 接线 ---------- */
test('C1 数据层:真读消息与成员 tier,读不到保持 null(不用空数组顶替)', () => {
    assert.ok(data.includes('groupPaceReadings(chatId, opts = {})'), '必须真读真源');
    assert.ok(data.includes('this.getMessages(chatId)'), '历史必须来自真消息面');
    assert.ok(data.includes('GROUP_PACE_LIMITS.coolWindow'), '取多少条要跟内核上限走(不自己拟一个)');
    const i = data.indexOf('groupPaceReadings(chatId');
    const body = data.slice(i, i + 2000);
    assert.ok(body.includes('base.history = null'), '读不到必须保持 null');
    assert.ok(body.includes("tiers[String(m.name)] = t"), '关系刻度从成员行读');
    assert.ok(body.includes('anyTier ? tiers : null'), '一个都读不到时必须是 null 而不是空对象');
});
test('C2 数据层:planGroupPace 是唯一出口且永不抛', () => {
    assert.ok(data.includes('planGroupPace(chatId, opts = {})'), '缺数据层出口');
    const i = data.indexOf('planGroupPace(chatId, opts = {})');
    const body = data.slice(i, i + 900);
    assert.ok(body.includes('} catch (_e) {'), '必须兜异常');
    assert.ok(body.includes("reason: 'thrown'"), '异常时必须如实报 thrown 而不假装没人说话');
    assert.ok(body.includes('r.line = groupPaceLine(r)'), '一行读数由内核产出(本层不自拼)');
    /* 只许一处调内核:两处就是两份口径 */
    assert.equal((codeOf(data).split('planGroupPace({').length - 1), 1, '内核只许一处调用点');
});
test('C3 群聊提示词真进了节奏读数(读不到就不进,不附假的)', () => {
    assert.ok(viewSrc.includes('planGroupPace(targetChat?.id'), 'chat-view 必须消费数据层出口');
    assert.ok(viewSrc.includes('群聊节奏'), '必须把读数落进系统提示词');
    const i = viewSrc.indexOf('planGroupPace(targetChat?.id');
    const body = viewSrc.slice(i, i + 1400);
    assert.ok(body.includes('catch (_e) {'), '取数失败必须兜住');
    assert.ok(body.includes('pace && pace.line'), '只在真有读数时才追加');
    /* 私密度不由本层从正文推断(推出来的私密度会把不该说的话放给不该说的人):
     *   本层只从 `targetChat` 上**已存的字段**取,不得去 messages 里找关键词。 */
    const vi = viewSrc.indexOf('planGroupPace(targetChat?.id');
    const vbody = viewSrc.slice(vi, vi + 1400);
    assert.equal(/privacy:\s*targetChat\?\.pacePrivacy/.test(vbody), true,
        '私密度必须从会话已存字段读:' + vbody.slice(0, 300));
    assert.equal(vbody.includes('messages.find'), false, '不得从正文里找私密度');
});
test('C4 诊断面:真取数卡 + 一行读数出口(纯函数面必须有可见出口)', () => {
    assert.ok(dgData.includes('groupPaceSelfCheck()'), '诊断数据层必须调内核自检');
    assert.ok(dgData.includes('groupPaceFace'), '必须成卡');
    assert.ok(dgData.includes('export function groupPaceFaceText'), '必须有一行读数出口');
    assert.ok(dgView.includes('_groupPaceHtml(pkg)'), '视图层必须渲染这张卡');
    assert.ok(dgView.includes('this._groupPaceHtml(pkg)'), '卡必须真被挂进渲染');
    /* 四态归因词要在卡里露出来(否则那张表是死的) */
    assert.ok(dgData.includes('privacyReasons'), '私密度归因词必须在读数里');
    assert.ok(dgView.includes('face.privacyReasons'), '视图要渲染它');
});

/* ---------- D 负控制(真源码定点破坏) ---------- */
const brokenFile = (name, src) => {
    const p = path.join(ROOT, 'config', name);
    fs.writeFileSync(p, src, 'utf-8');
    return p;
};
/** 破坏必须恰中 1 次;不唯一 / 不存在一律抛(不许静默改成「差不多」的东西)。 */
function breakOnce(from, to) {
    const n = core.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰中 1 次,实际 ' + n + ':' + String(from).slice(0, 70));
    return core.replace(from, to);
}
test('D1 破坏「空历史可判」⇒ 对应判据必转红', async () => {
    /* 破坏「读不到」的判定,让它对空数组也成立 —— 这一刀正落在
     *   「空历史 ≠ 读不到历史」这条口径上。 */
    const bad = breakOnce('if (!hist.face) {', 'if (!hist.face || hist.order.length < LIM.minHistory) {');
    const p = brokenFile('__broken_v4070_d1.mjs', bad);
    try {
        const m = await import(p + '?d1=' + Date.now());
        const r = m.planGroupPace(M({ history: [], topic: 't' }));
        assert.equal(r.state, 'thin', '破坏副本:空历史被误判成读不到');
        assert.equal(r.ok, false);
        /* 原版同一输入、同款判据必须真(否则上面是空转) */
        assert.equal(mod.planGroupPace(M({ history: [], topic: 't' })).ok, true);
    } finally { fs.unlinkSync(p); }
});
test('D2 破坏「同一往事降权」⇒ 对应判据必转红', async () => {
    const bad = breakOnce('if (input.topic && hist.order.length) {', 'if (false) {');
    const p = brokenFile('__broken_v4070_d2.mjs', bad);
    try {
        const m = await import(p + '?d2=' + Date.now());
        /* 刻意用**表述同一件往事**的那份历史(冷却不参与),让破坏真的可观测:
         *   破坏后话题加减全失效 ⇒ 六人同分 ⇒ 退回成员原序 ⇒ A 重新居首。 */
        const hist = [
            { name: 'A', topic: 'X' }, { name: 'B', topic: 'X' }, { name: 'C', topic: 'X' },
            { name: 'D', topic: 'p' }, { name: 'E', topic: 'p' }, { name: 'F', topic: 'p' }
        ];
        const picked = m.planGroupPace(M({ history: hist, topic: 'X' })).speakers.slice(0, 3).map((x) => x.name);
        assert.notDeepEqual(picked, ['D', 'E', 'F'], '破坏副本:已接过话题者不再让位');
        assert.deepEqual(picked, ['A', 'B', 'C'], '破坏副本应退回成员原序(可观测改变行为)');
        assert.deepEqual(mod.planGroupPace(M({ history: hist, topic: 'X' })).speakers.slice(0, 3).map((x) => x.name),
            ['D', 'E', 'F'], '原版必须让位');
    } finally { fs.unlinkSync(p); }
});
test('D3 破坏「@ 硬命中」⇒ 对应判据必转红', async () => {
    const bad = breakOnce('if (hit) forced.push(m); else rest.push(m);', 'if (false) forced.push(m); else rest.push(m);');
    const p = brokenFile('__broken_v4070_d3.mjs', bad);
    try {
        const m = await import(p + '?d3=' + Date.now());
        const r = m.planGroupPace(M({ history: [{ name: 'F', topic: 'p' }], topic: 'q', mentions: ['F'] }));
        assert.equal(r.forced.length, 0, '破坏副本:@ 不再硬命中');
        assert.equal(r.speakers[0].name !== 'F', true, '破坏副本:@ 者不再居首');
        assert.ok(mod.planGroupPace(M({ history: [{ name: 'F', topic: 'p' }], topic: 'q', mentions: ['F'] })).forced.includes('F'));
    } finally { fs.unlinkSync(p); }
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本锚:入口不得低于 4.06.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 6), '入口版本不得低于 4.06.0,实测 ' + v.join('.'));
});
