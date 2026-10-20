/**
 * system-v3970.test.mjs — v3.97.0 · B 包手机侧三项（R3-X1 / R3-X2 / R3-O4）
 *
 * 【本版治的是什么】上游已交付、手机侧此前**零消费**的三件外供面：
 *   · phoneFactReceipt（上游 v3.314.0 M-X6）→ 手机事件成为可确认的剧情记忆（R3-X1）
 *   · memoryQaAnswer（上游 v3.322.0 M3-X1）+ memoryToolsEnvelope（**上游 v3.305.0** · 供给模块零改动）
 *     → 手机内有出处的往事问答（R3-X2）
 *   · 搜索从字面命中到找对那件事（R3-O4：人物/日期/类型组合筛选 + 中文词序容错 + 精确落点）
 *
 * 【本版做什么】新建三个**纯消费**契约模块，只搬不重算：
 *   · config/phone-fact-contract.js / config/memory-qa-contract.js / config/search-facets.js
 *   并把它们接到六个消费点（记忆取数层与视图 / 搜索两档 / 旅行记账 / 日历履约 / 宿主取数口）。
 *
 * 【四态不同形（本仓点名的形态纪律）】
 *   engine-absent（等装插件）· face-absent（等升级）· unusable（本机读不出）· empty（真读数：
 *   跑了、扫了、确实没有）· ok —— 五者必须分得开。压成一态会让用户把「插件不在场」
 *   读成「这条没入账」，而两者处置相反。本版所有缺席路径都给**恒定键面**（不是 undefined）。
 *
 * 【六面】
 *   A 结构面：三模块在位且只读 / 词表逐字对齐上游 / 面状态五态互异 / 上游全局名唯一
 *   B 行为面：五态不同形 / 未知不编 / 词序容错 / 未命中 at=-1 / 不拿 null 当 0 判掉
 *   C 接线面：六处消费点各自在场且用同一份口径（含「不给上游第二个人名装配点」）
 *   D 负控制：真源码副本定点破坏，同款判据必转红
 *   E 版本锚：五源同源（3.97.0）
 *
 * 负控制纪律：真源码破坏用副本（`.__neg__.js` 后缀），锚点 anchorOnce 断言恰中 1 次，
 *   assert.notEqual 确认破坏真发生，process.on('exit') 清理副本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const FACT_REL = 'config/phone-fact-contract.js';
const QA_REL = 'config/memory-qa-contract.js';
const FACET_REL = 'config/search-facets.js';
const ENTITY_REL = 'config/entity-candidates-contract.js';
const FACT = read(FACT_REL);
const QA = read(QA_REL);
const FACET = read(FACET_REL);
const ENTITY = read(ENTITY_REL);
const IDX = read('index.js');
const MEM_APP = read('apps/memory/memory-app.js');
const MEM_VIEW = read('apps/memory/memory-view.js');
const SEARCH_APP = read('apps/search/search-app.js');
const SEARCH_VIEW = read('apps/search/search-view.js');
const TRAVEL_VIEW = read('apps/traveldesk/traveldesk-view.js');
const CAL_APP = read('apps/calendar/calendar-app.js');

const F = await import(pathToFileURL(path.join(root, FACT_REL)).href);
const Q = await import(pathToFileURL(path.join(root, QA_REL)).href);
const S = await import(pathToFileURL(path.join(root, FACET_REL)).href);
const E = await import(pathToFileURL(path.join(root, ENTITY_REL)).href);
/** 去注释（判据纪律：注释里提过一次会冒充真调用 —— 本档多处断言必须先去注释）。 */
function stripComments(src) {
    return src.split('\n').map((l) => {
        const i = l.indexOf('//');
        return i >= 0 ? l.slice(0, i) : l;
    }).join('\n');
}

/* ══════════════════ 共用：真源码副本 + 定点破坏 ══════════════════ */
const NEG_FILES = [];
process.on('exit', () => { for (const f of NEG_FILES) { try { fs.unlinkSync(f); } catch (_e) { /* 已清理 */ } } });

/** 锚点恰中 1 次（0 次/多次都抛 —— 破坏写偏与「破坏写死成常量」都不许过）。 */
function anchorOnce(src, anchor, tag) {
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, `[${tag}] 锚点须恰中 1 次，实测 ${n}`);
    return n;
}

/** 真源码破坏 → 落副本（`.__neg__.js`）→ 返回副本的模块命名空间。 */
async function breakModule(rel, anchor, repl, tag) {
    const src = read(rel);
    anchorOnce(src, anchor, tag);
    const broken = src.replace(anchor, repl);
    assert.notEqual(broken, src, `[${tag}] 破坏必须真的改变源码`);
    const negRel = rel.replace(/\.js$/, '.__neg__.js');
    const negAbs = path.join(root, negRel);
    fs.writeFileSync(negAbs, broken);
    if (!NEG_FILES.includes(negAbs)) NEG_FILES.push(negAbs);
    return import(pathToFileURL(negAbs).href + '?v=' + Date.now() + '_' + tag);
}

/** 假宿主：只给上游两个全局名，绝不碰真 window。 */
const winWith = (plugin, bridge) => {
    const w = {};
    if (plugin !== undefined) w.LonShaMemory = plugin;
    if (bridge !== undefined) w.LonShaPhoneFactBridge = bridge;
    return w;
};

/* ══════════════════ A. 结构面 ══════════════════ */
test('A1 三模块在位于 check 链可达路径，且都是只读（不写 storage、不写任何键）', () => {
    for (const p of [FACT_REL, QA_REL, FACET_REL]) assert.ok(exists(p), p + ' 必须存在');
    for (const [name, src] of [[FACT_REL, FACT], [QA_REL, QA], [FACET_REL, FACET]]) {
        assert.ok(!/\.setItem\s*\(|indexedDB|localStorage\s*\.\s*set/.test(src),
            name + ' 不得写 storage（本层是纯消费层）');
        assert.ok(src.includes('writesNothing') || name === FACET_REL,
            name + ' 必须自述只读（writesNothing）');
    }
    // 三模块均无副作用导入（除唯一取值实现 num-gate）
    for (const [name, src] of [[FACT_REL, FACT], [QA_REL, QA]]) {
        assert.ok(!/^import /m.test(src), name + ' 不应有副作用导入');
    }
    assert.equal((FACET.match(/^import /gm) || []).length, 1, 'search-facets 只许导入全仓唯一取值实现');
    assert.ok(FACET.includes("from './num-gate.js'"), '数值取值必须走 num-gate（W1 门禁点名的那一族）');
});

test('A2 词表逐字对齐上游（四态/三类/三动作/桥三态/信封五态各不压平）', () => {
    assert.deepEqual([...F.PHONE_FACT_LIFECYCLE], ['accepted', 'rejected', 'pending', 'revoked']);
    assert.deepEqual([...F.PHONE_FACT_BRIDGE_STATES], ['absent', 'legacy', 'capable']);
    assert.deepEqual([...F.PHONE_FACT_EVENT_CLASSES], ['finance', 'calendar', 'story']);
    assert.deepEqual([...F.PHONE_FACT_EDIT_ACTIONS], ['edit', 'delete', 'retract']);
    assert.deepEqual([...Q.MEMORY_TOOLS_STATES], ['ok', 'empty', 'unknown', 'unavailable', 'partial']);
    // 恒定键面：上游登记表的 15 键 / 14 键，一字不差
    assert.equal(Q.MEMORY_QA_KEYS.length, 15);
    assert.ok(Q.MEMORY_QA_KEYS.includes('knownActors') && Q.MEMORY_QA_KEYS.includes('writesNothing'));
    assert.equal(Q.MEMORY_TOOLS_KEYS.length, 14);
    assert.ok(Q.MEMORY_TOOLS_KEYS.includes('stateLabel') && Q.MEMORY_TOOLS_KEYS.includes('revisionSource'));
});

test('A3 面状态五态互异（缺席 / 空 / 读不出 不许同形），且上游全局名唯一', () => {
    const f = Object.values(F.PHONE_FACT_FACE_STATES);
    const q = Object.values(Q.MEMORY_QA_FACE_STATES);
    assert.equal(new Set(f).size, f.length, '事实桥五态必须互异');
    assert.equal(new Set(q).size, q.length, '问答五态必须互异');
    for (const [k, v] of Object.entries(F.PHONE_FACT_FACE_STATES)) {
        assert.equal(Q.MEMORY_QA_FACE_STATES[k], v, `${k} 在两个模块里必须同词（否则同一处境两个说法）`);
    }
    assert.ok(FACT.includes("const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';"));
    assert.ok(QA.includes("const LONSHA_PLUGIN_GLOBAL = 'LonShaMemory';"));
    assert.ok(FACT.includes("const LONSHA_PHONE_BRIDGE_GLOBAL = 'LonShaPhoneFactBridge';"));
    /* [v3.97.0 · 自抓缺陷] 原判据写的是 `IDX.split(锚点).length === 1` —— 那个式子
     *   在**锚点 0 次命中**时同样成立（1===1），是一条空断言：装配点被整个删掉它也会绿。
     *   改成对**实际形态**计数（本仓槽位用 `key: value` 同形表驱动装配）。 */
    assert.equal((IDX.match(/phoneFactReceiptFor:\s*phoneFactReceiptFor/g) || []).length, 1,
        '宿主只许有一个取数口装配点（0 次=没挂上，2 次=第二份真源）');
});

/* ══════════════════ B. 行为面 ══════════════════ */
test('B1 问答：插件缺席 ⇒ engine-absent 且**恒定 15 键全在场**（不是「没查到」）', () => {
    const r = Q.readMemoryQaAnswer(winWith(undefined), '她答应过什么');
    assert.equal(r.state, Q.MEMORY_QA_FACE_STATES.ENGINE_ABSENT);
    for (const k of Q.MEMORY_QA_KEYS) assert.ok(k in r, '缺席也必须有键：' + k);
    assert.deepEqual(r.answer, []);
    assert.match(Q.memoryQaFaceLine(r), /不是/);
    // 有插件、但没这一口 ⇒ face-absent（与「插件不在场」不同形）
    const r2 = Q.readMemoryQaAnswer(winWith({}), '她答应过什么');
    assert.equal(r2.state, Q.MEMORY_QA_FACE_STATES.FACE_ABSENT);
    assert.notEqual(r.state, r2.state, '「等装插件」与「等升级」不得同形');
});

test('B2 问答：跑了、扫了、没命中 ⇒ empty + 缺口具名；有答案 ⇒ ok（原样搬运，不合成）', () => {
    const miss = Q.readMemoryQaAnswer(winWith({
        askMemoryQuestion: () => ({ version: 2, question: '她答应过什么', answer: [], refs: [], gaps: [{ kind: 'no-rows', why: '九账里没有可引用行' }], total: 0, knownActors: 3 })
    }), '她答应过什么');
    assert.equal(miss.state, Q.MEMORY_QA_FACE_STATES.EMPTY);
    assert.equal(miss.gaps.length, 1);
    assert.equal(miss.gaps[0].kind, 'no-rows', '缺口必须原样具名（不许替上游编）');
    assert.equal(miss.knownActors, 3, '上游缺席路径也给真读数，必须原样带出');

    const hit = Q.readMemoryQaAnswer(winWith({
        askMemoryQuestion: () => ({ version: 2, answer: [{ kind: 'fact', planId: 'p1', text: '她答应周三来', ref: 'f9', floor: 12, ledger: 'commitment' }], refs: [{ ref: 'f9', floor: 12 }], gaps: [], masked: 1, truncated: true, resourced: 2, total: 1 })
    }), '她答应过什么');
    assert.equal(hit.state, Q.MEMORY_QA_FACE_STATES.OK);
    assert.equal(hit.answer[0].text, '她答应周三来');
    assert.equal(hit.masked, 1);
    assert.equal(hit.truncated, true);
    assert.match(Q.memoryQaFaceLine(hit), /遮蔽 1/);
    // 上游缺席路径（version=0 + reason）⇒ engine-absent，**不是** empty
    const abs = Q.readMemoryQaAnswer(winWith({ askMemoryQuestion: () => ({ version: 0, reason: 'kernel-absent', gaps: [{ kind: 'module', why: '内核未加载' }] }) }), 'q');
    assert.equal(abs.state, Q.MEMORY_QA_FACE_STATES.ENGINE_ABSENT);
    assert.notEqual(abs.state, miss.state, '「内核不在场」与「扫了没命中」不得同形');
});

test('B3 记忆工具信封：五态原样搬运，unavailable 与 empty 处置相反不许压平', () => {
    const mk = (env) => Q.readMemoryToolsEnvelope(winWith({ queryEvidence: () => env }), {}, {});
    const un = mk({ state: 'unavailable', reason: 'module-absent', data: null, notes: ['结构化证据模块不在场'] });
    const em = mk({ state: 'empty', reason: 'no-rows', data: [], notes: [] });
    const pa = mk({ state: 'partial', data: { rows: [1] }, notes: ['范围被上限截断'] });
    assert.equal(un.state, Q.MEMORY_QA_FACE_STATES.ENGINE_ABSENT);
    assert.equal(un.faceReason, 'unavailable', '上游五态词必须保留（不许丢）');
    assert.equal(em.state, Q.MEMORY_QA_FACE_STATES.EMPTY);
    assert.equal(pa.state, Q.MEMORY_QA_FACE_STATES.OK);
    assert.notEqual(un.state, em.state, '「能力缺席」与「在场但真没有」不得同形');
    for (const r of [un, em, pa]) for (const k of Q.MEMORY_TOOLS_KEYS) assert.ok(k in r, '恒定键面缺 ' + k);
    assert.equal(un.data, null);
    assert.deepEqual(un.notes, ['结构化证据模块不在场'], '缺格成因必须带出');
    // 出口不在场 ⇒ face-absent（有插件、没这一口）
    const fa = Q.readMemoryToolsEnvelope(winWith({}), {}, {});
    assert.equal(fa.state, Q.MEMORY_QA_FACE_STATES.FACE_ABSENT);
    const desc = Q.readMemoryToolsDescribe(winWith({}));
    assert.equal(desc.state, Q.MEMORY_QA_FACE_STATES.FACE_ABSENT);
});

test('B4 事实桥：模块在而插件不在 ⇒ face-absent；两者都不在 ⇒ engine-absent', () => {
    const bothGone = F.readPhoneFactFace(winWith(undefined, undefined));
    const modOnly = F.readPhoneFactFace(winWith(undefined, {}));
    assert.equal(bothGone.state, F.PHONE_FACT_FACE_STATES.ENGINE_ABSENT);
    assert.equal(modOnly.state, F.PHONE_FACT_FACE_STATES.FACE_ABSENT);
    assert.notEqual(bothGone.state, modOnly.state, '「等装插件」与「等升级」不得同形');
    for (const r of [bothGone, modOnly]) {
        assert.deepEqual(r.counts, { accepted: 0, rejected: 0, pending: 0, revoked: 0 });
        assert.equal(r.writesNothing, true);
        assert.equal(r.rows.length, 0);
    }
    assert.match(F.phoneFactFaceLine(bothGone), /不是/);
    assert.notEqual(F.phoneFactFaceLine(bothGone), F.phoneFactFaceLine(modOnly));
    // 出口在 ⇒ ok，且 pending/rejected 不同形由上游自述面转发（不在此重算）
    const ok = F.readPhoneFactFace(winWith({ phoneFactBridgeState: () => ({ state: 'capable', detail: 'd' }) }));
    assert.equal(ok.state, F.PHONE_FACT_FACE_STATES.OK);
    assert.equal(ok.bridgeState, 'capable');
});

test('B5 事实回执：模块缺席时**既不报 accepted 也不报 rejected**；四态文案各不同形', () => {
    const absent = F.readPhoneFactReceipt(winWith({}), { eventId: 'e1' }, {});
    assert.equal(absent.state, F.PHONE_FACT_FACE_STATES.ENGINE_ABSENT);
    assert.equal(absent.lifecycle, null);
    assert.equal(absent.receipt, null);
    assert.match(absent.notes.join(' '), /不是/);
    // 上游桥模块不在场（ok:false + reason）⇒ 如实搬运，不当作被拒
    const modAbsent = F.readPhoneFactReceipt(winWith({ phoneFactBridgeHandle: () => ({ ok: false, reason: 'module-absent', notes: ['桥本体不在场'] }) }), { eventId: 'e1' }, {});
    assert.equal(modAbsent.state, F.PHONE_FACT_FACE_STATES.ENGINE_ABSENT);
    assert.equal(modAbsent.reason, 'module-absent');
    assert.equal(modAbsent.lifecycle, null, '不得把「读不到」写成任何生命周期态');
    // 正常回执原样搬运
    const ok = F.readPhoneFactReceipt(winWith({ phoneFactBridgeHandle: () => ({ ok: true, eventClass: 'finance', classKnown: true, guarded: true, guard: 'amount', receipt: { eventId: 'e1', state: 'accepted' }, lifecycle: { state: 'accepted' } }) }), { eventId: 'e1' }, {});
    assert.equal(ok.state, F.PHONE_FACT_FACE_STATES.OK);
    assert.equal(ok.receipt.state, 'accepted');
    assert.equal(ok.guard, 'amount');
    // 四态文案各不同形（pending 与 rejected 尤其不许同形）
    const texts = F.PHONE_FACT_LIFECYCLE.map((s) => F.phoneFactLifecycleText(s));
    assert.equal(new Set(texts).size, 4, '四态文案必须互异');
    assert.match(F.phoneFactLifecycleText('pending'), /确认/);
    assert.match(F.phoneFactLifecycleText('rejected'), /没有进入/);
    assert.match(F.phoneFactLifecycleText('什么鬼'), /未知状态/);
    // 空批（真读数）与「读不到」不同形
    const emptyBatch = F.readPhoneFactBatch(winWith({ phoneFactBridgeBatch: () => ({ ok: true, rows: [] }) }), [], {});
    assert.equal(emptyBatch.state, F.PHONE_FACT_FACE_STATES.EMPTY);
    assert.equal(emptyBatch.reason, 'no-facts');
    const goneBatch = F.readPhoneFactBatch(winWith({}), [], {});
    assert.equal(goneBatch.state, F.PHONE_FACT_FACE_STATES.ENGINE_ABSENT);
    assert.notEqual(emptyBatch.state, goneBatch.state, '「真没有」与「读不到」不得同形');
});

test('B6 事实装配：来源名与上游默认类提示逐字对上（对不上不写兜底类名）', () => {
    assert.equal(F.assemblePhoneFact('finance', { eventId: 'e1', amount: 12.5 }).source, 'finance-confirmed');
    assert.equal(F.assemblePhoneFact('calendar', { eventId: 'e2' }).source, 'calendar');
    assert.equal(F.assemblePhoneFact('story', { eventId: 'e3' }).source, 'story-event');
    const odd = F.assemblePhoneFact('mystery', { eventId: 'e4' });
    assert.equal(odd.source, 'mystery', '未登记的类不许被兜底成默认类（上游会如实报 classKnown:false）');
    const f = F.assemblePhoneFact('finance', { eventId: 'e5', rootEventId: '', summary: 's', amount: NaN });
    assert.equal(f.rootEventId, 'e5', '根事件号缺省回落自身');
    assert.ok(!('amount' in f), '非有限数不得当金额写进去（不拿 NaN 当读数）');
});

test('B7 搜索筛选：词序容错真在生效（对照组自证：includes 会漏）', () => {
    const body = '林安安还没还款';
    assert.equal(body.includes('还款 林安安'), false, '对照组：字面 includes 确实漏（否则本条没在测词序容错）');
    const cov = S.tokenCoverage(body, '还款 林安安');
    assert.equal(cov.hit, true, 'bigram 覆盖须命中：' + JSON.stringify(cov));
    assert.equal(S.tokenCoverage(body, '还款 周砚').hit, false, '认不出的人名不得命中');
    assert.deepEqual(S.bigramsOf('林安安'), ['林安', '安安']);
    assert.deepEqual(S.bigramsOf('账'), ['账'], '单字退化为单字集');
});

test('B8 搜索筛选：没抽出条件 ⇒ ok:false（不把「没听懂」当「全通过」）', () => {
    const empty = S.facetsOf('');
    assert.equal(empty.ok, false);
    assert.ok(empty.gaps.some((g) => g.kind === 'no-condition'));
    const notUnderstood = S.facetsOf('嗯嗯', { knownActors: ['林安安'] });
    assert.ok(notUnderstood.gaps.some((g) => g.kind === 'actor-unrecognized'), '认不出人名要具名，不按人名筛');
    assert.equal(notUnderstood.ok, true, '有关键词条件即 ok 真 —— 但「认不出谁」这件事必须同时具名（上面那条）');
    // [v3.97.0 · 自抓缺陷] 空问句原先撞上 `if (!q) return out` 早返回：**ok 恒为初始值**、也不给为什么。
    //   修后空问句与「没听懂」共用同一条出口（no-condition），判据在此锁住。
    assert.ok(empty.gaps.some((g) => g.kind === 'no-condition'), '空问句也必须说自己抽不出条件');
    const okOne = S.facetsOf('林安安 还款', { knownActors: ['林安安'] });
    assert.equal(okOne.person, '林安安');
    assert.equal(okOne.ok, true);
    // 最长优先（「林安安」先于「林安」）
    const longest = S.facetsOf('林安安借钱', { knownActors: ['林安', '林安安'] });
    assert.equal(longest.person, '林安安');
    // 相对指代不给区间
    const vague = S.facetsOf('上次 支出');
    assert.ok(vague.gaps.some((g) => g.kind === 'time-vague'));
    assert.equal(vague.from, null, '「上次」不许猜成任何区间');
});

test('B9 搜索筛选：时间读不出的行不因时间被筛掉；未命中落点是 -1 而不是 0', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    const f = S.facetsOf('昨天 林安安 还款', { knownActors: ['林安安'], now });
    assert.ok(f.from && f.to, '「昨天」须给区间');
    /* ★ [v4.32.0 · R5-O5 判据订正] 本条原先锁的是**闭区间**语义
     *   （`to = 今天` 且判定 `day > to` ⇒ 断言「今天的行必须在区间内」）。
     *   而「昨天还款把今天的行一起算进来」正是本版点名的缺陷形态：
     *   修后相对词给**闭开区间**（`toExcl = 今天零点`），今天落在区间外。
     *   ⇒ 判据改为：昨天的行在内、今天的行**在区间外且具名 `time`**。
     *   为什么不是「删掉这条」：闭开边界必须有人锁，否则下次改动会悄悄退回闭区间。
     * ★ 行要带 `sourceId: 'wallet'`：问句里的「还款」是财务触发词，类型条件
     *   （白名单）会先筛掉**源未登记**的行 —— 不带就量不到时间边界（量到的是 kind）。 */
    const today = S.matchFacets({ ts: now, sourceId: 'wallet', title: '', body: '林安安 还款' }, f);
    assert.equal(today.pass, false, '今天的行必须落在区间外（闭开上界）：' + JSON.stringify(today));
    assert.ok(today.reasons.includes('time'), '被时间筛掉必须**具名**，不许静默丢');
    const yest = S.matchFacets({ ts: now - 86400000, sourceId: 'wallet', title: '', body: '林安安 还款' }, f);
    assert.equal(yest.pass, true, '昨天的行必须在区间内：' + JSON.stringify(yest));
    const old = S.matchFacets({ ts: now - 10 * 86400000, sourceId: 'wallet', title: '', body: '林安安 还款' }, f);
    assert.ok(old.reasons.includes('time'), '十天前的行必须因时间被筛掉并**具名**');
    const noTs = S.matchFacets({ ts: null, createdAt: '', sourceId: 'wallet', title: '', body: '林安安 还款' }, f);
    assert.equal(noTs.reasons.includes('time'), false, '读不出时间的行不得被当 0 判掉');
    // 逐条各自可归因
    const applied = S.applyFacets([
        { sourceId: 'wallet', title: 'a', body: '林安安 还款' },
        { sourceId: 'wallet', title: 'b', body: '周砚 还款' }
    ], S.facetsOf('林安安 还款', { knownActors: ['林安安'] }));
    assert.equal(applied.kept, 1);
    assert.equal(applied.dropped, 1);
    assert.equal(applied.byReason.person, 1, '「因为人名不符被筛掉」必须可归因');
    // 精确落点
    const loc = S.locate('林安安还没还款', '还款');
    assert.equal(loc.hit, true);
    assert.equal(loc.at, 5);
    assert.equal(loc.match, '还款');
    const miss = S.locate('abc', 'zzz');
    assert.equal(miss.hit, false);
    assert.equal(miss.at, -1, '未命中必须 -1（0 是合法下标，与「没命中」同形）');
});

test('B10 出处归一：无 ref 且无楼层 ⇒ ok:false 且保留原因，不硬投', () => {
    const r = Q.qaRefOf({ kind: 'fact', text: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.why, 'no-ref-no-floor');
    assert.equal(r.appId, '');
    const ok = Q.qaRefOf({ ref: 'f9', floor: 12, ledger: 'commitment' });
    assert.equal(ok.ok, true);
    assert.equal(ok.appId, 'summdesk', 'memory kind 的归属在 config/open-ref.js 已登记');
    const floorOnly = Q.qaRefOf({ floor: 3 });
    assert.equal(floorOnly.ok, true);
    assert.equal(floorOnly.id, 'floor:3');
});

/* ══════════════════ C. 接线面 ══════════════════ */
test('C1 搜索两档共用同一份筛选口径（同步档 + 全历史档），且不重排相关性', () => {
    assert.equal((SEARCH_APP.match(/^    _filterByFacets\(result, kw\) \{$/gm) || []).length, 1,
        '筛选口径只许一份实现（0 处=没做筛选，2 处=第二份口径）');
    /* ★ [v4.32.0 · R5-O5 判据订正] 原判据把**调用点文本逐字**钉死
     *   （`this.engine.query(kw, scopeOpt)`）。R5-O5 在候选阶段多接了一格召回词
     *   （`Object.assign({}, scopeOpt, recallOpt)`），文本一变判据就红 ——
     *   而它本来要锁的是「快速档这一口**过了筛**」，不是「参数长什么样」。
     *   ⇒ 改锁**语义**：这一句里同时出现 `_filterByFacets(` 与 `engine.query(`，
     *     且这一口确实把召回词接上了（`recallOpt`）。 */
    assert.ok(/this\._filterByFacets\(this\.engine\.query\(kw,[^)]*\)/.test(SEARCH_APP), '快速档必须过筛');
    assert.ok(SEARCH_APP.includes('recallOpt'), '候选阶段必须接上主题词召回（R5-O5）');
    assert.ok(SEARCH_APP.includes('return self._filterByFacets(r, kw);'), '全历史档落地口必须过筛');
    assert.ok(SEARCH_APP.includes("import { facetsOf, applyFacets, recallTermsOf } from '../../config/search-facets.js';"));
    /* [v3.97.0 · 自抓缺陷] 原判据直接扫原文 —— 而本文件的注释里正在讲解「排序仍归引擎的
     *   scoreHit」，于是判据把**注释**当成了「本层在重算相关性」（又一次读注释当代码）。
     *   只扫去注释后的真码。 */
    const searchCode = SEARCH_APP.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/scoreHit/.test(searchCode), 'R3-O4 明文：不重算相关性、不新建索引');
    // 没听懂 ⇒ 不筛（把「没听懂」如实报成「未做筛选」）
    assert.ok(SEARCH_APP.includes('if (!f.ok) {'), 'ok:false 必须走「不筛」分支');
    assert.ok(SEARCH_VIEW.includes('_facetNote(r.facets)'), '视图必须把条件与筛掉读数显示出来');
});

test('C2 记忆视图：第六页「问往事」在位，四态各自成形', () => {
    assert.ok(MEM_VIEW.includes("id: 'ask'"), 'TABS 必须有 ask 页');
    assert.ok(MEM_VIEW.includes('_askHtml(') && MEM_VIEW.includes('_askFaceHtml('));
    assert.ok(MEM_VIEW.includes('#mem-ask-btn') && MEM_VIEW.includes('#mem-ask-q'));
    assert.ok(MEM_VIEW.includes('phoneFactFace()'), '事实面自述必须只读展示（不跑真查询）');
    assert.ok(MEM_VIEW.includes('_doAsk('), '提问入口必须接线');
});

test('C3 记忆取数层：不向上游再装配第二份人名清单（上游那一口是唯一装配点）', () => {
    assert.ok(MEM_APP.includes('askPast('), '取数层必须有一口 askPast');
    /* [v3.97.0 · 自抓缺陷] 原判据直接扫原文，把**注释里讲解这件事的那句话**也算成
     *   「传了 knownActors」（读注释当代码）。只扫**去注释后的真码**。 */
    const memCode = MEM_APP.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/knownActors\s*:/.test(memCode),
        '不得传 knownActors：上游 askMemoryQuestion 内部自有人名装配点，本层再装配一份就是第二个真源');
    assert.ok(!/_knownActorNames/.test(MEM_APP), '自装配人名的那段必须已删除');
    assert.ok(MEM_APP.includes('phoneFactReceipt(') && MEM_APP.includes('phoneFactBatch('));
    assert.ok(MEM_APP.includes('true') && MEM_APP.includes('sendPhoneEvent('), '写入侧转发口必须在位');
});

test('C4 三处真实场景闭环：记账提交 / 日历履约 / 宿主取数口（不要求记忆 App 打开过）', () => {
    /* [v3.97.0 · 自抓缺陷] 原判据按 `phoneFactReceiptFor('finance'` 找，实际调用写成
     *   `phoneFactReceiptFor?.('finance'`（可选链）——少一个字符就 0 命中，判据是假红。 */
    assert.ok(TRAVEL_VIEW.includes("phoneFactReceiptFor?.('finance'"), '付款闭环：提交后取回执');
    assert.ok(CAL_APP.includes("phoneFactReceiptFor?.('calendar'"), '履约闭环：完成后取回执');
    assert.ok(IDX.includes('function phoneFactReceiptFor('), '宿主必须有唯一取数口');
    assert.ok(IDX.includes('chatId'), '取数口须补会话号（否则上游记不进对的那一段）');
    assert.ok(IDX.includes("import { sendPhoneEvent } from './config/phone-fact-contract.js';"));
    // 取数口不得依赖记忆 App 实例（v3.96.0 刚治过「有效装配依赖是否打开过」同族形态）
    const fn = IDX.slice(IDX.indexOf('function phoneFactReceiptFor('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.ok(!/memoryApp|_memApp|memory-view/.test(body), '取数口不许经记忆 App 实例');
});

/* ══════════════════ D. 负控制 ══════════════════ */
test('D1 负控制：把未命中落点从 -1 改成 0 ⇒ 同款判据必须翻红', async () => {
    const neg = await breakModule(FACET_REL, "if (!b || !k) return { hit: false, at: -1, before: '', match: '', after: '' };",
        "if (!b || !k) return { hit: false, at: 0, before: '', match: '', after: '' };", 'd1');
    assert.notEqual(neg.locate('', 'zzz').at, -1, '破坏后必须不再是 -1（否则判据恒真=假绿）');
    assert.equal(S.locate('', 'zzz').at, -1, '原版上同判据必须真成立');
});

test('D2 负控制：把 pending 文案与 rejected 合并 ⇒ 四态不同形判据必须翻红', async () => {
    const neg = await breakModule(FACT_REL, "pending: '等待你确认（**还悬着**，不是被拒）',",
        "pending: '没有进入记忆（明确未入账）',", 'd2');
    assert.equal(neg.phoneFactLifecycleText('pending'), neg.phoneFactLifecycleText('rejected'),
        '破坏后两者必须同形（这正是本仓最贵的老账形态）');
    assert.notEqual(F.phoneFactLifecycleText('pending'), F.phoneFactLifecycleText('rejected'),
        '原版上两者必须不同形');
});

test('D3 负控制：把「没听懂 ⇒ 不筛」改成「全通过」⇒ 可判性判据必须翻红', async () => {
    const neg = await breakModule(FACET_REL, 'out.ok = !!(out.keyword || out.person || out.from || out.kinds.length);',
        'out.ok = true;   // [破坏] 没听懂也当全通过', 'd3');
    assert.equal(neg.facetsOf('').ok, true, '破坏后「没抽出条件」被谎报成 ok');
    assert.equal(S.facetsOf('').ok, false, '原版上必须真为 false');
});

/* ══════════════════ F. 上游实体映射面（R3-O1 续 · 同版第二批） ══════════════════
 * 治的欠债：上游 M3-O3（v3.317.0）把实体映射做成对外读面（resolveEntityAt /
 *   entityCandidatesFor），并在 open_face_registry.tsv 按 face=entityMapping 登记
 *   consumer=readEntityCandidates@1 —— 而手机侧此前**零消费**，「手机和主聊天采用同一份
 *   实体映射」在用户侧不成立（同名异人照样串台）。本面把接入钉住。
 * 本面判据与 B 面同规格：**五态不同形**、**多条候选不折成一条**、**观测缺失 ≠ 空**。
 * ══════════════════════════════════════════════════════════════════ */
test('F1 结构：消费层在位、只读自述、无副作用导入、上游全局名唯一收口', () => {
    assert.ok(exists(ENTITY_REL), ENTITY_REL + ' 必须存在');
    assert.ok(!/\.setItem\s*\(|indexedDB|localStorage\s*\.\s*set/.test(ENTITY), '消费层不得写 storage');
    assert.ok(ENTITY.includes('writesNothing'), '必须自述只读');
    assert.ok(!/^import /m.test(ENTITY), '不应有副作用导入');
    assert.equal((ENTITY.match(/LONSHA_PLUGIN_GLOBAL = 'LonShaMemory'/g) || []).length, 1,
        '上游全局名须唯一收口（两处各写一份探测=本仓治过的重复形态）');
    assert.ok(ENTITY.includes("face: 'entityMapping'"), '面标识须与上游登记表 face 同名');
});
test('F2 词表：五态互异且逐字；候选恒定键面逐字对齐上游映射体', () => {
    assert.deepEqual(Object.values(E.ENTITY_FACE_STATES),
        ['engine-absent', 'face-absent', 'unusable', 'empty', 'ok'], '五态须互异且逐字');
    assert.deepEqual([...E.ENTITY_CANDIDATE_KEYS], ['id', 'name', 'via', 'matchedAlias', 'blockedBy'],
        '候选键面必须与上游 index.js::entityCandidatesFor 的映射体逐字一致');
});
test('F3 ★★★ 行为：缺席 / 旧版 / 读不出 / 空 / 有候选 五态必须分得开', () => {
    const absent = E.readEntityCandidates(winWith(undefined), 'person', '甲', {});
    assert.equal(absent.state, E.ENTITY_FACE_STATES.ENGINE_ABSENT, '插件不在场 ⇒ engine-absent（等装插件）');
    assert.equal(absent.reason, 'plugin-absent', '必须具名归因');
    assert.deepEqual(absent.candidates, [], '缺席时给恒定键面（不是 undefined）');
    const old = E.readEntityCandidates(winWith({}), 'person', '甲', {});
    assert.equal(old.state, E.ENTITY_FACE_STATES.FACE_ABSENT, '插件在、本版没这一口 ⇒ face-absent（等升级）');
    const boom = E.readEntityCandidates(winWith({ entityCandidatesFor() { throw new Error('x'); } }), 'person', '甲', {});
    assert.equal(boom.state, E.ENTITY_FACE_STATES.UNUSABLE, '出口抛错 ⇒ unusable（本机读不出）');
    assert.equal(boom.reason, 'thrown', '必须说清是抛错');
    const mal = E.readEntityCandidates(winWith({ entityCandidatesFor() { return 'nope'; } }), 'person', '甲', {});
    assert.equal(mal.state, E.ENTITY_FACE_STATES.UNUSABLE, '返回畸形 ⇒ unusable');
    assert.equal(mal.reason, 'malformed', '必须说清是畸形而不是空');
    const empty = E.readEntityCandidates(winWith({ entityCandidatesFor() { return []; } }), 'person', '甲', {});
    assert.equal(empty.state, E.ENTITY_FACE_STATES.EMPTY, '真查过没有 ⇒ empty（真读数）');
    const hit = E.readEntityCandidates(winWith({ entityCandidatesFor() { return [{ id: 'a', name: '甲' }, { id: 'b', name: '甲' }]; } }), 'person', '甲', {});
    assert.equal(hit.state, E.ENTITY_FACE_STATES.OK, '有候选 ⇒ ok');
    /* ★ 多条候选**不折成一条** —— 上游这一面的存在理由就是「歧义不硬合并的前提是看得见候选」。 */
    assert.equal(hit.candidates.length, 2, '两条并列候选必须原样保留（折成一条=把「请选择」改回「静默算给第一个」）');
    /* 四态的 state 必须互异（压平任何两态就是把处置相反的处境显示成同一句话）。 */
    const states = [absent.state, old.state, boom.state, empty.state];
    assert.equal(new Set(states).size, 4, '缺席/旧版/读不出/空 四态必须互异，实测 ' + JSON.stringify(states));
});
test('F4 观测缺失 ≠ 空：四态的文案必须互异（不许都写成「没有这个人」）', () => {
    const line = (st, reason) => E.entityFaceLine({ state: st, reason: reason || '', candidates: [] });
    const lines = [line(E.ENTITY_FACE_STATES.ENGINE_ABSENT, 'plugin-absent'), line(E.ENTITY_FACE_STATES.FACE_ABSENT, 'face-absent'),
        line(E.ENTITY_FACE_STATES.UNUSABLE, 'thrown'), line(E.ENTITY_FACE_STATES.EMPTY, 'no-candidates')];
    assert.equal(new Set(lines).size, 4, '四条文案必须互异：' + JSON.stringify(lines));
    assert.ok(lines[3].includes('查过了'), '空态必须明确是「查过了」——否则与「还没查」同形');
    assert.ok(!lines[0].includes('没有这个人'), '插件缺席不得写成「查无此人」（等装插件 vs 确无此人，处置相反）');
    assert.ok(lines[2].includes('thrown') || lines[2].includes('读不出'), '读不出必须点名成因');
});
test('F5 接线：手机侧身份消歧真消费该面，且歧义判据把两侧合并（不取其一）', () => {
    const code = stripComments(read('apps/wechat/wechat-data.js'));
    assert.ok(/from '\.\.\/\.\.\/config\/entity-candidates-contract\.js'/.test(read('apps/wechat/wechat-data.js')),
        '必须从真源导入（不许本地再写一份探测）');
    assert.match(code, /readEntityCandidates\s*\(/, '必须有真调用点');
    assert.match(code, /ambiguous:\s*base\.ambiguous\s*===\s*true\s*\|\|\s*upCandidates\.length\s*>\s*1/,
        '歧义判据必须合并「本仓成员表多解」与「上游候选多于一条」——只取其一都会漏（本仓唯一、上游并列时照样串台）');
    assert.ok(code.includes('resolveGroupSpeakerIdentity'), '消费点必须是身份消歧这一条路径');
});
test('F6 负控制：把 empty 写成 ok ⇒ 五态不同形判据必须翻红', async () => {
    const neg = await breakModule(ENTITY_REL, "return faceRow(ENTITY_FACE_STATES.EMPTY, 'no-candidates');",
        "return faceRow(ENTITY_FACE_STATES.OK, 'no-candidates');", 'f6');
    const n = neg.readEntityCandidates(winWith({ entityCandidatesFor() { return []; } }), 'person', '甲', {});
    assert.equal(n.state, neg.ENTITY_FACE_STATES.OK, '破坏后「真查过、没有」被谎报成 ok（有货）');
    assert.equal(E.readEntityCandidates(winWith({ entityCandidatesFor() { return []; } }), 'person', '甲', {}).state,
        E.ENTITY_FACE_STATES.EMPTY, '原版上同判据必须真成立');
});
test('F7 负控制：把候选折成一条 ⇒ 「多条并列保留」判据必须翻红', async () => {
    const neg = await breakModule(ENTITY_REL, '{ candidates: candidates }',
        '{ candidates: candidates.slice(0, 1) }', 'f7');
    const n = neg.readEntityCandidates(winWith({ entityCandidatesFor() { return [{ id: 'a' }, { id: 'b' }]; } }), 'person', '甲', {});
    assert.equal(n.candidates.length, 1, '破坏后两条并列候选被折成一条');
    assert.equal(E.readEntityCandidates(winWith({ entityCandidatesFor() { return [{ id: 'a' }, { id: 'b' }]; } }), 'person', '甲', {}).candidates.length,
        2, '原版上两条必须都在');
});
/* ══════════════════ E. 版本锚 ══════════════════ */
test('E1 出生档落齐：3.97.0 在台账与迭代日志里不可抹（版本面已交棒当版档）', () => {
    /* ★ [v3.98.0 交棒] 本档是 v3.97.0 的**出生版本锚**：`.latest` / `.head` /
     *   入口常量都是**会随抬版前移**的当版读数 —— 拿它们硬锁 3.97.0 会让下一版
     *   一抬版就红（那是抬版仪式，不是缺陷）。本仓既有先例：历史档只锁
     *   「自己那一版在台账里仍在」与「迭代段还在」这两件不回退的事实，
     *   当前版本面交给当版档案（tests/system-v3980.test.mjs 的 E1）。 */
    const VER = '3.97.0';
    const ul = JSON.parse(read('update-log.json'));
    assert.ok(ul.versions[VER], '台账必须有该版条目（历史不可抹）');
    assert.ok(Array.isArray(ul.versions[VER].items) && ul.versions[VER].items.length >= 8, '该版条目数须齐（构建期守卫）');
    assert.ok(ul.versions[VER].items.some((it) => it.startsWith('【版本升至')), '该版必须带收尾条「版本升至 X（五源同源）」');
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 154 — v' + VER), '该版迭代段不可抹');
    /* 版本单调：入口常量必须是**不小于**该版的可数版本（下界形，不钉死当版）。 */
    const cur = (/const ST_PHONE_VERSION = '([^']+)'/.exec(IDX) || [])[1];
    const num = (v) => { const m = /^([0-9]+)[.]([0-9]+)[.]([0-9]+)$/.exec(String(v)); return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : NaN; };
    assert.ok(Number.isFinite(num(cur)), '入口版本常量必须可数：' + cur);
    assert.ok(num(cur) >= num(VER), '入口版本不得低于该版：' + cur);
    assert.equal(read('manifest.json').includes('"version": "' + cur + '"'), true, 'manifest 与入口同源（当版由当版档把守）');
    assert.equal(read('package.json').includes('"version": "' + cur + '"'), true, 'package.json 与入口同源');
});
