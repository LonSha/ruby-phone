/* ============================================================
 * tests/system-v4970.test.mjs — v4.97.0 中枢清账第三批次判据档（计划 R11-O3）
 * ------------------------------------------------------------
 * 本批次把三件 tier=zero 的纯内核接进产品面：
 *   ① config/district-network.js     → apps/place      （街区机会卡：登记 / 机会 / 到访 / 熟悉度）
 *   ② config/commission-pipeline.js  → apps/creationdesk（委托生命周期：五阶段 + 显式协商 + 取消留稿）
 *   ③ config/reading-studio.js       → apps/reading    （研读案卷：问题→挂书→摘录→观点→批注→草稿→改版）
 *
 * **本档钉住的四类真实缺陷**（都在接线时实测踩到，不是假想）：
 *   ① 写读不同名：到访记在 `'user'` 名下，而面读数按 `null` 去查 —— already-attended
 *      与熟悉度**永远读不回来**。台账里明明有记录，界面上永远是「未参加 / stranger」。
 *      这类缺陷最毒的地方是「每一步都返回 ok:true」，只有把写入与读取当同一件事断言才抓得住。
 *   ② 字段名不信：内核 normAnnotation 只认 `question` / `comment`，视图传 `text`；
 *      normStr(undefined) === ''，于是**批注行留下、内容为空**，r.ok 仍然是 true。
 *      「成功但没内容」是本仓反复治理的形态，本档必须钉住内容而不是只钉 ok。
 *   ③ 整段覆盖：内核 updateDraft 收到 sections 数组即整段替换，视图每次都传单节数组，
 *      于是「写得越多丢得越多」。判据要断言**第二节写完后第一节还在**。
 *   ④ 必填缺项：normExcerpt 必填 bookId，视图只传 text —— 返回 invalid_excerpt_payload，
 *      按钮按下去永远失败。负控制：补上 bookId 后必须成功。
 *
 * 判据分七面：
 *   A 键单一真源（三个键各一处字面量 + keys 门已登记 + App 走常量不拼串）
 *   B 街区链真实可用（校验器 / 登记 / 机会三态 / 到访与熟悉度 / 写读同名回归钉）
 *   C 委托链真实推进（五阶段 / 加需求显式协商 / 结算与取消留稿 / 读回台账）
 *   D 研读链真实落盘（挂书 / 摘录 / 观点 / 批注字段 / 草稿追加 / 改版政策）
 *   E 归因三态（读不到 ≠ 空台账，三条链各两句文案且不同形）
 *   F 接线自证（三 App 真 import 内核具名导出 + 视图真消费 App 方法 + 负控制）
 *   G 账本清账与内核独立可用（三件内核不在三张账本的冻结条目里 + 防清空负控制）
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlaceApp, PLACE_DISTRICT_KEY } from '../apps/place/place-app.js';
import { CreationdeskApp, CW_COMMISSION_KEY } from '../apps/creationdesk/creationdesk-app.js';
import { ReadingApp } from '../apps/reading/reading-app.js';
import {
    RS_STORAGE_KEY, createReadingDossier, linkBookToDossier, addExcerpt,
    addContrastingView, addAnnotation, updateDraft, handleBookVersionUpdate,
} from '../config/reading-studio.js';
import {
    createPlace, deriveOpportunities, recordVisit, getPlaceFamiliarity,
} from '../config/district-network.js';
import {
    COMMISSION_STAGES, createCommission, acceptBrief, submitDraft,
    proposeScopeChange, agreeScopeChange, acceptAndSettle, cancelCommission,
} from '../config/commission-pipeline.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const countOf = (src, lit) => src.split(lit).length - 1;

/** 内存存储：与真 PhoneStorage 同口径 —— 存的是**字符串**（回读必须解码，或由 App 自己 parse）。 */
function makeStorage(init = {}) {
    const map = new Map();
    for (const [k, v] of Object.entries(init)) map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    return {
        map,
        get(k) { return map.has(k) ? map.get(k) : null; },
        set(k, v) { map.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; },
    };
}
/** 三个壳：只要能让 App 构造起来（本档测数据面，不跑真 DOM）。 */
function makeShell() {
    const box = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], prompt: () => null, showNotification: () => {} };
    return { layerHost: () => box, screen: box, prompt: () => null, showNotification: () => {} };
}
/** 挂一个「有场景头」的假桥：place 链的机会判定要读 header.date / header.period。 */
function mountSceneHeader(date, period) {
    globalThis.window = {
        lonsha_memory_bridge_v1: { snapshot: { scene: { header: { date, period }, current: [], presence: [], visits: [] } } },
    };
}
/** 一周七天的时段表（供 place 链复用，避免每处都手抄）。 */
const WEEK = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TW_MON_AM = [{ day: '周一', slots: [{ start: '上午', label: '上午' }] }];

/* ══════════════════════════════════════════════════════════════
 * A 键单一真源
 * ══════════════════════════════════════════════════════════════ */
test('A1: 三个台账键各只有一个字面量（App 侧不许有第二份手写副本）', () => {
    assert.equal(PLACE_DISTRICT_KEY, 'place_district_v1');
    assert.equal(CW_COMMISSION_KEY, 'cw_commission_v1');
    assert.equal(RS_STORAGE_KEY, 'reading_studio_v1');
    /* place / creationdesk：键常量声明在 App 侧 ⇒ 字面量必须恰好 1 处。
     * reading：键常量声明在**内核**（config/reading-studio.js），App 只 import ⇒
     *   App 侧出现字面量反而是缺陷（等于绕开常量拼串）。两种形态都要判，不能只判前者。 */
    assert.equal(countOf(read('apps/place/place-app.js'), "'place_district_v1'"), 1,
        'place 键字面量在 place-app.js 里必须只有一处（PLACE_DISTRICT_KEY 声明处）');
    assert.equal(countOf(read('apps/creationdesk/creationdesk-app.js'), "'cw_commission_v1'"), 1,
        '委托键字面量在 creationdesk-app.js 里必须只有一处（CW_COMMISSION_KEY 声明处）');
    assert.equal(countOf(read('config/reading-studio.js'), "'reading_studio_v1'"), 1,
        '研读键字面量在 reading-studio.js 里必须只有一处（RS_STORAGE_KEY 声明处）');
    assert.equal(countOf(read('apps/reading/reading-app.js'), "'reading_studio_v1'"), 0,
        'reading-app.js 不得手写这个键（只许 import RS_STORAGE_KEY）');
});

test('A2: 两个新键都在 keys-audit 里登记（未登记的键会被 keys 门判红）', () => {
    const audit = read('scripts/keys-audit.mjs');
    for (const k of [PLACE_DISTRICT_KEY, CW_COMMISSION_KEY, RS_STORAGE_KEY]) {
        assert.ok(audit.includes("'" + k + "'"), 'keys-audit.mjs 必须登记 ' + k);
    }
    // 三个键都必须是会话隔离（随 chatId 变），否则换会话串味
    for (const k of [PLACE_DISTRICT_KEY, CW_COMMISSION_KEY, RS_STORAGE_KEY]) {
        const line = audit.split('\n').find((l) => l.includes("'" + k + "'"));
        assert.ok(/scope:\s*'chat'/.test(line), k + ' 必须是 scope:chat，实得 ' + line.trim().slice(0, 120));
    }
});

test('A3: 三个 App 读写都走键常量，不各自拼字符串（改键名只改一处）', () => {
    const plSrc = read('apps/place/place-app.js');
    assert.ok(/storage\.get\(PLACE_DISTRICT_KEY\)/.test(plSrc), '读街区台账必须走 PLACE_DISTRICT_KEY');
    assert.ok(/storage\.set\(PLACE_DISTRICT_KEY/.test(plSrc), '写街区台账必须走 PLACE_DISTRICT_KEY');
    const cwSrc = read('apps/creationdesk/creationdesk-app.js');
    assert.ok(/storage\.get\(CW_COMMISSION_KEY\)/.test(cwSrc), '读委托台账必须走 CW_COMMISSION_KEY');
    assert.ok(/storage\.set\(CW_COMMISSION_KEY/.test(cwSrc), '写委托台账必须走 CW_COMMISSION_KEY');
    const rdSrc = read('apps/reading/reading-app.js');
    assert.ok(/storage\.get\(RS_STORAGE_KEY\)/.test(rdSrc), '读研读台账必须走 RS_STORAGE_KEY');
    assert.ok(/storage\.set\(RS_STORAGE_KEY/.test(rdSrc), '写研读台账必须走 RS_STORAGE_KEY');
});

/* ══════════════════════════════════════════════════════════════
 * B 街区链：真实可用（这一面是本批最容易「看着对、其实读不回来」的地方）
 * ══════════════════════════════════════════════════════════════ */
test('B1: 登记前的四道校验各报各的原因（不合法的一个字节都不落盘）', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new PlaceApp(makeShell(), st);
    assert.equal(app.registerDistrictPlace('', '馆', TW_MON_AM).reason, 'missing-id-or-name');
    assert.equal(app.registerDistrictPlace('p1', '  ', TW_MON_AM).reason, 'missing-id-or-name');
    assert.equal(app.registerDistrictPlace('p1', '馆', []).reason, 'time-windows-required');
    assert.equal(app.registerDistrictPlace('p1', '馆', null).reason, 'time-windows-required');
    assert.equal(app.registerDistrictPlace('p1', '馆', [{ day: '', slots: [{ start: '上午' }] }]).reason, 'bad-time-window');
    assert.equal(app.registerDistrictPlace('p1', '馆', [{ day: '周一', slots: [] }]).reason, 'bad-time-window');
    assert.equal(st.map.has(PLACE_DISTRICT_KEY), false, '全部被拒时不得落盘');
    // 负控制：合法的那一条必须真的收下（否则上面六条可能只是「谁都收不下」）
    const ok = app.registerDistrictPlace('p1', '社区艺术馆', TW_MON_AM, ['org-a']);
    assert.equal(ok.ok, true, '合法登记必须成功');
    assert.equal(st.map.has(PLACE_DISTRICT_KEY), true, '合法登记必须落盘');
    // 同 id 重登记是冲突，不是覆盖（不静默改写作者已设的时间窗）
    assert.equal(app.registerDistrictPlace('p1', '改名', TW_MON_AM).reason, 'place-exists');
});

test('B2: 机会三态各归各位（active / already-attended / missed，不伪造已到场）', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new PlaceApp(makeShell(), st);
    app.registerDistrictPlace('p1', '社区艺术馆', TW_MON_AM);
    /* 事件由作者在设置里补设（内核不编事件）。用 getSettings/saveSettings 走真路径，
     *   不直接往 storage 里塞 JSON —— 否则测的是「我塞的字符串」而不是「App 读得出来」。 */
    app.saveSettings({ districtEvents: [{ placeId: 'p1', id: 'e1', label: '周一画展' }] });

    // ① 当天有窗、时段在窗内 ⇒ active
    mountSceneHeader('周一', '上午');
    let face = app.districtFace();
    assert.equal(face.ok, true);
    assert.equal(face.slotsKnown, true, '有场景头时 slotsKnown 必须为真');
    assert.equal(face.rows.length, 1, '应当有 1 行机会');
    assert.equal(face.rows[0].status, 'active', '开场时段必须 active，实得 ' + face.rows[0].status);

    // ② 时段不在窗内 ⇒ missed（错过就标错过，绝不假装已到场）
    mountSceneHeader('周一', '晚上');
    face = app.districtFace();
    assert.equal(face.rows[0].status, 'missed', '非营业时段必须 missed，实得 ' + face.rows[0].status);

    // ③ 非营业日 ⇒ 当天无窗，无事可标（空 rows，而不是硬塞一个 missed）
    mountSceneHeader('周日', '上午');
    assert.equal(app.districtFace().rows.length, 0, '非营业日不该有行（没有窗口就没有「错过」）');

    // ④ 记录到访后再看 ⇒ already-attended（这一条依赖 B3 的写读同名）
    mountSceneHeader('周一', '上午');
    assert.equal(app.recordDistrictVisit('p1', 'e1', ['cha_1']).ok, true);
    face = app.districtFace();
    assert.equal(face.rows[0].status, 'already-attended',
        '已到访过必须翻成 already-attended，实得 ' + face.rows[0].status);

    // 负控制：换一个事件 id，必须仍然是 active（否则「already-attended」可能是无条件成立）
    app.saveSettings({ districtEvents: [{ placeId: 'p1', id: 'e1', label: '周一画展' }, { placeId: 'p1', id: 'e2', label: '周二讲座' }] });
    face = app.districtFace();
    const row2 = face.rows.find((r) => r.label === '周二讲座');
    assert.ok(row2, '第二个事件必须出现在面里');
    assert.equal(row2.status, 'active', '没到访过的事件必须 active');
});

test('B3: 到访写读同名 —— 记在哪个用户名下，就必须按哪个用户名读回来', () => {
    /* 这条是本批修掉的真缺陷的回归钉。
     *   修前：recordDistrictVisit 写 `'user'`，districtFace 读 `null` ⇒
     *   台账里 visits 有记录、familiarity 也升了级，但界面永远显示「未参加 / stranger」。
     *   每一步都返回 ok:true，只有把「写入后读回」当同一件事断言才抓得住。 */
    const st = makeStorage();
    globalThis.window = {};
    const app = new PlaceApp(makeShell(), st);
    app.registerDistrictPlace('p1', '社区艺术馆', TW_MON_AM);
    app.saveSettings({ districtEvents: [{ placeId: 'p1', id: 'e1', label: '画展' }] });
    mountSceneHeader('周一', '上午');
    assert.equal(app.recordDistrictVisit('p1', 'e1', []).ok, true);

    // 台账侧：到访记录必须真落了盘，并且按 'user' 存
    const saved = JSON.parse(st.get(PLACE_DISTRICT_KEY));
    const visits = saved.places.p1.visits;
    assert.equal(visits.length, 1, '到访必须落盘 1 条，实得 ' + visits.length);
    assert.equal(visits[0].userId, 'user', '到访必须记在 user 名下（面读数也按这个名查）');

    // 面侧：同一次到访必须被读回来（写读同名）
    const row = app.districtFace().rows[0];
    assert.equal(row.status, 'already-attended', '同一次到访必须被面读回（写读不同名则永远 active）');
    assert.equal(row.familiarity, 'acquainted', '一次到访后熟悉度必须是 acquainted，实得 ' + row.familiarity);

    // 熟悉度升级链：第 3 次到访升 regular（内核判，App 不自己数）
    app.recordDistrictVisit('p1', 'e1', []);
    app.recordDistrictVisit('p1', 'e1', []);
    assert.equal(app.districtFace().rows[0].familiarity, 'regular',
        '三次到访后必须是 regular，实得 ' + app.districtFace().rows[0].familiarity);
});

test('B4: 到访的三种拒绝各报各的原因，且不改盘', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new PlaceApp(makeShell(), st);
    app.registerDistrictPlace('p1', '馆', TW_MON_AM);
    const before = st.get(PLACE_DISTRICT_KEY);
    assert.equal(app.recordDistrictVisit('p_none', 'e1', []).reason, 'place-unknown');
    assert.equal(app.recordDistrictVisit('p1', '  ', []).reason, 'event-missing');
    assert.equal(st.get(PLACE_DISTRICT_KEY), before, '拒绝时不得改盘');
    // 读不出时走 ledger-* 前缀（归因保留到底层原因）
    const noStore = new PlaceApp(makeShell(), null);
    assert.equal(noStore.recordDistrictVisit('p1', 'e1', []).reason, 'ledger-no_storage');
});

test('B5: 无场景头时如实说「机会只能标 missed」，不编一个时段顶替', () => {
    const st = makeStorage();
    globalThis.window = {};   // 没有桥
    const app = new PlaceApp(makeShell(), st);
    app.registerDistrictPlace('p1', '馆', TW_MON_AM);
    const face = app.districtFace();
    assert.equal(face.ok, true, '有台账就必须 ok（无场景头不是台账的错）');
    assert.equal(face.slotsKnown, false, '无场景头必须 slotsKnown:false');
    assert.ok(/未登记日期\/时段/.test(face.line), '文案必须说清是「缺场景头」，实得 ' + face.line);
    assert.ok(/missed/.test(face.line), '文案必须交代机会被标成什么，实得 ' + face.line);
});

/* ══════════════════════════════════════════════════════════════
 * C 委托链：五阶段真实推进
 * ══════════════════════════════════════════════════════════════ */
test('C1: 五阶段逐步推进，每一步都真写回台账（不是内存里转一圈）', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new CreationdeskApp(makeShell(), st);

    const c = app.createCommission({ title: '生日贺卡', client: '林小姐', requirements: ['水彩风格'], agreedFee: 100 });
    assert.equal(c.ok, true, '建委托必须成功');
    assert.equal(c.commission.stage, COMMISSION_STAGES.BRIEF);
    assert.equal(st.map.has(CW_COMMISSION_KEY), true, '建委托必须落盘');
    const cid = c.id;

    // brief → concept（付定金）
    const ab = app.acceptBrief(cid, 30);
    assert.equal(ab.ok, true);
    assert.equal(ab.commission.stage, COMMISSION_STAGES.CONCEPT);
    assert.equal(ab.commission.depositPaid, 30);
    assert.equal(app.commissionFace().rows[0].stage, COMMISSION_STAGES.CONCEPT,
        '阶段推进必须写回台账（内核返回新对象，App 必须接着）');

    // 交样稿
    assert.equal(app.submitDraft(cid, { draftId: 'd1', version: 'v1', content: '初稿' }).ok, true);
    assert.equal(app.commissionFace().rows[0].drafts, 1, '草稿数必须写回台账');

    // 提议加需求：显式协商，费不变、状态 pending
    const psc = app.proposeScopeChange(cid, { changeId: 'chg1', additionalRequirements: ['加烫金字'], feeDelta: 20 });
    assert.equal(psc.ok, true);
    assert.equal(psc.commission.stage, COMMISSION_STAGES.CHANGE_SCOPE);
    assert.equal(psc.commission.scopeChanges[0].status, 'pending', '提议阶段必须 pending（不许单方面加价）');
    const faceMid = app.commissionFace().rows[0];
    assert.equal(faceMid.agreedFee, 100, '提议阶段费不该变，实得 ' + faceMid.agreedFee);
    assert.equal(faceMid.pendingChanges, 1, '未决变更数必须为 1');
    assert.equal(faceMid.pendingList[0].changeId, 'chg1', '未决变更必须带 changeId（视图按它对号）');

    // 同意变更：费才涨
    const ag = app.agreeScopeChange(cid, 'chg1');
    assert.equal(ag.ok, true);
    assert.equal(ag.commission.stage, COMMISSION_STAGES.REVISION);
    assert.equal(ag.commission.agreedFee, 120, '同意后才许涨价，实得 ' + ag.commission.agreedFee);
    assert.deepEqual(ag.commission.requirements, ['水彩风格', '加烫金字'], '加的需求必须并进需求表');

    // 验收结算
    const settle = app.acceptAndSettle(cid, 5, '很满意');
    assert.equal(settle.ok, true);
    assert.equal(settle.commission.stage, COMMISSION_STAGES.ACCEPTANCE);
    assert.equal(settle.settlement.finalFee, 120);
    assert.equal(settle.settlement.remainingPaid, 90, '尾款 = 总价 - 定金，实得 ' + settle.settlement.remainingPaid);

    // 全程后重新建 App 读同一 storage ⇒ 账必须还在（落盘而不是实例内态）
    const app2 = new CreationdeskApp(makeShell(), st);
    const back = app2.commissionFace();
    assert.equal(back.count, 1, '换实例必须读得回这笔委托');
    assert.equal(back.rows[0].stage, COMMISSION_STAGES.ACCEPTANCE);
    assert.equal(back.rows[0].settlement.finalFee, 120, '结算数必须持久');
});

test('C2: 取消保留作者草稿（不许把半成品一起抹掉）', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new CreationdeskApp(makeShell(), st);
    const c = app.createCommission({ title: '插画' });
    app.acceptBrief(c.id, 20);
    app.submitDraft(c.id, { draftId: 'd1', content: '半成品' });
    const cx = app.cancelCommission(c.id, '进度不合');
    assert.equal(cx.ok, true);
    assert.equal(cx.commission.stage, COMMISSION_STAGES.CANCELLED);
    assert.equal(cx.settlement.isCancelled, true);
    assert.equal(cx.settlement.draftsPreservedCount, 1,
        '取消必须交代「保留了几份草稿」，实得 ' + cx.settlement.draftsPreservedCount);
    assert.equal(cx.commission.drafts.length, 1, '草稿本身必须还在');
    // 负控制：没交过草稿的那笔取消时必须是 0（否则「保留 1 份」可能是常数）
    const c2 = app.createCommission({ title: '另一笔' });
    assert.equal(app.cancelCommission(c2.id).settlement.draftsPreservedCount, 0);
});

test('C3: 步骤转交器的三道前置拒绝（空 id / 找不到 / 读不出），不向内核喂 undefined', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new CreationdeskApp(makeShell(), st);
    assert.equal(app.acceptBrief('').reason, 'missing-id');
    assert.equal(app.acceptBrief('comm_none').reason, 'commission-not-found');
    const noStore = new CreationdeskApp(makeShell(), null);
    assert.equal(noStore.acceptBrief('x').reason, 'ledger-no_storage');
    // 内核侧拒绝原因必须原样透出（不在 App 层改写）
    const c = app.createCommission({ title: 't' });
    app.acceptBrief(c.id);
    assert.equal(app.acceptBrief(c.id).reason, 'invalid_stage', '阶段不对必须透出内核原因');
});

/* ══════════════════════════════════════════════════════════════
 * D 研读链：真实落盘与字段保真
 * ══════════════════════════════════════════════════════════════ */
test('D1: 建卷 → 挂书 → 摘录 → 观点 → 批注 全链路落盘，内容字段必须保真', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new ReadingApp(makeShell(), st);

    const d = app.createReadingDossier({ researchQuestion: '两种教育观谁更适合县城' });
    assert.equal(d.ok, true);
    assert.equal(st.map.has(RS_STORAGE_KEY), true, '建卷必须落盘');
    const did = d.id;

    assert.equal(app.linkBookToDossier(did, { bookId: 'b1', title: '学记', version: 'v1' }).ok, true);
    const ex = app.addExcerptToDossier(did, { bookId: 'b1', verbatimText: '教学相长也' });
    assert.equal(ex.ok, true);
    assert.equal(ex.excerpt.bookTitle, '学记', '摘录必须自动补上书名（内核按已挂书目回填）');
    assert.equal(ex.excerpt.verbatimText, '教学相长也', '原文必须逐字保真');

    const vw = app.addContrastingViewToDossier(did, { claimText: '严格要求才是负责', stance: 'contra' });
    assert.equal(vw.ok, true);
    assert.equal(vw.view.claim, '严格要求才是负责', '观点正文必须保真（内核存 claim）');
    assert.equal(vw.view.stance, 'contra');

    /* 批注字段名回归钉：内核只认 question / comment。
     *   修前视图传 `text` ⇒ normStr(undefined) = '' ⇒ ok:true 但 comment 是空串。 */
    const an = app.addAnnotationToDossier(did, { comment: '这句话要对照第七章读' });
    assert.equal(an.ok, true);
    assert.equal(an.annotation.comment, '这句话要对照第七章读',
        '批注正文必须保真（传 text 会被静默吞成空串）');

    const face = app.readingStudioFace();
    const row = face.rows[0];
    assert.equal(row.books, 1);
    assert.equal(row.excerpts, 1);
    assert.equal(row.views, 1);
    assert.equal(row.annotations, 1);
    // 负控制：换实例读同一 storage，四项计数必须仍在（落盘而不是实例内态）
    const back = new ReadingApp(makeShell(), st).readingStudioFace();
    assert.equal(back.rows[0].annotations, 1, '批注必须持久（空串批注会在回读时现形）');
});

test('D2: 草稿是「追加一节」，不是「整段覆盖」——写完第二节第一节必须还在', () => {
    /* 内核 updateDraft 收到 sections 数组即**整段替换**（这是内核既有语义，本档不改它）。
     *   修前视图每次都传单节数组 ⇒ 写得越多丢得越多。追加语义由调用方保证。 */
    const st = makeStorage();
    globalThis.window = {};
    const app = new ReadingApp(makeShell(), st);
    const did = app.createReadingDossier({ researchQuestion: 'q' }).id;

    assert.equal(app.updateDossierDraft(did, { sections: [{ heading: '第一节', body: '先立论' }] }).ok, true);
    // 模拟视图的第二/第三次追加（读回已写节再 concat）
    const append = (heading, body) => {
        const cur = app._readStudioState().dossiers[did];
        const secs = (cur.draft.sections || []).concat([{ heading, body }]);
        return app.updateDossierDraft(did, { sections: secs });
    };
    assert.equal(append('第二节', '再举例').ok, true);
    assert.equal(append('第三节', '收束').ok, true);

    const saved = app._readStudioState().dossiers[did].draft.sections;
    assert.equal(saved.length, 3, '三节必须都在，实得 ' + saved.length);
    assert.equal(saved[0].heading, '第一节', '第一节不得被覆盖');
    assert.equal(saved[2].heading, '第三节');
    assert.equal(app.readingStudioFace().rows[0].draftSections, 3);
    // 反面对照：内核语义确实是替换（用来证明上面那条不是「谁都不会覆盖」）
    const kd = createReadingDossier({ researchQuestion: 'k' });
    const k1 = updateDraft(kd, { sections: [{ heading: 'A', body: 'a' }] }).dossier;
    const k2 = updateDraft(k1, { sections: [{ heading: 'B', body: 'b' }] }).dossier;
    assert.equal(k2.draft.sections.length, 1, '内核 updateDraft 是整段替换（调用方必须自己 concat）');
});

test('D3: 书改版按「绝不静默覆盖作者正文」政策标 stale，作者观点一条不动', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new ReadingApp(makeShell(), st);
    const did = app.createReadingDossier({ researchQuestion: 'q' }).id;
    app.linkBookToDossier(did, { bookId: 'b1', title: '学记', version: 'v1' });
    app.addExcerptToDossier(did, { bookId: 'b1', verbatimText: '教学相长也' });
    app.addExcerptToDossier(did, { bookId: 'b1', verbatimText: '玉不琢不成器' });
    app.addContrastingViewToDossier(did, { claimText: '我的主张', stance: 'pro' });

    const bu = app.handleBookVersionUpdate(did, 'b1', 'v2');
    assert.equal(bu.ok, true);
    assert.equal(bu.policy, 'preserve_views', '政策必须是 preserve_views');
    assert.equal(bu.staleExcerptsCount, 2, '两条摘录都该标 stale，实得 ' + bu.staleExcerptsCount);
    /* [v4.97.0] 这条断言原先写「待核实」，而 App 层实际文案是「待核验」——
     *   判定词必须与产品文案逐字对齐，否则判据自己先红。内核 staleReason 与 App
     *   的 note 都按「核验」措辞，这里统一钉 App 层的 note。 */
    assert.ok(/待核验/.test(bu.note || ''), '必须交代「待核验」，实得 ' + bu.note);

    const row = app.readingStudioFace().rows[0];
    assert.equal(row.staleExcerpts, 2);
    assert.equal(row.views, 1, '观点必须一条不动（标题里的「绝不覆盖」不是文案）');
    // 原文一字未改（stale 是标注，不是删除或改写）
    const saved = app._readStudioState().dossiers[did];
    assert.equal(saved.excerpts[0].verbatimText, '教学相长也', '原文必须逐字保真');
    // 负控制：不存在的书必须拒绝，而不是「标了 0 条就算成功」
    assert.equal(app.handleBookVersionUpdate(did, 'b_none', 'v9').reason, 'book_not_found');
});

test('D4: 摘录缺 bookId 必被内核拒（这条钉住视图为何必须补书目）', () => {
    const st = makeStorage();
    globalThis.window = {};
    const app = new ReadingApp(makeShell(), st);
    const did = app.createReadingDossier({ researchQuestion: 'q' }).id;
    /* 负控制先行：只传 text（缺 bookId）必须被拒 —— 这正是修前视图的调用形态。 */
    const bad = app.addExcerptToDossier(did, { text: '只有正文' });
    assert.equal(bad.ok, false, '缺 bookId 必须被拒');
    assert.equal(bad.reason, 'invalid_excerpt_payload');
    // 修好的形态：补上 bookId 就成功
    const good = app.addExcerptToDossier(did, { bookId: '未指明书目', verbatimText: '只有正文' });
    assert.equal(good.ok, true, '补上 bookId 必须成功');
    // 观点缺正文同理（claimText 是必填）
    assert.equal(app.addContrastingViewToDossier(did, {}).reason, 'invalid_view_payload');
});

/* ══════════════════════════════════════════════════════════════
 * E 归因三态：读不到 ≠ 空台账（三条链各两句，且不同形）
 * ══════════════════════════════════════════════════════════════ */
test('E1: 三条链的读失败各报各的原因（no_storage / bad_json / read_threw）', () => {
    globalThis.window = {};
    // no_storage
    assert.equal(new PlaceApp(makeShell(), null)._readDistrictState().why, 'no_storage');
    assert.equal(new CreationdeskApp(makeShell(), null)._readCommissionState().why, 'no_storage');
    assert.equal(new ReadingApp(makeShell(), null)._readStudioState().why, 'no_storage');
    // bad_json
    const bad = makeStorage();
    bad.map.set(PLACE_DISTRICT_KEY, '{不是JSON');
    assert.equal(new PlaceApp(makeShell(), bad)._readDistrictState().why, 'bad_json');
    const bad2 = makeStorage();
    bad2.map.set(CW_COMMISSION_KEY, '{不是JSON');
    assert.equal(new CreationdeskApp(makeShell(), bad2)._readCommissionState().why, 'bad_json');
    const bad3 = makeStorage();
    bad3.map.set(RS_STORAGE_KEY, '{不是JSON');
    assert.equal(new ReadingApp(makeShell(), bad3)._readStudioState().why, 'bad_json');
    // read_threw
    const threw = { get() { throw new Error('boom'); }, set() { return true; } };
    assert.equal(new PlaceApp(makeShell(), threw)._readDistrictState().why, 'read_threw');
    assert.equal(new CreationdeskApp(makeShell(), threw)._readCommissionState().why, 'read_threw');
    assert.equal(new ReadingApp(makeShell(), threw)._readStudioState().why, 'read_threw');
    // 读不出时一律拒绝写入（不在坏台账上硬加一条）
    assert.equal(new PlaceApp(makeShell(), bad).registerDistrictPlace('p', 'n', TW_MON_AM).reason, 'ledger-bad_json');
    assert.equal(new CreationdeskApp(makeShell(), bad2).createCommission({ title: 't' }).reason, 'ledger-bad_json');
    assert.equal(new ReadingApp(makeShell(), bad3).createReadingDossier({ researchQuestion: 'q' }).reason, 'ledger-bad_json');
});

test('E2: 空台账是可读的（ok:true + 0 条），与读不出分两句不同形的文案', () => {
    globalThis.window = {};
    /* [v4.97.0] 三条链的计数字段名不统一：place 用 placeCount，commission/reading 用
     *   count。原先这里写 `f.count ?? f.placeCount`，`??` 只对 null/undefined 回退，
     *   而 creationdesk 读不出时 count=null —— 于是 `null ?? undefined` 得 undefined，
     *   对 null 断言就炸。取法改成按字段存在性挑，null 是有效值不算空。 */
    const pickup = (f) => ('count' in f ? f.count : f.placeCount);
    const empty = makeStorage();
    const plEmpty = new PlaceApp(makeShell(), empty).districtFace();
    const cwEmpty = new CreationdeskApp(makeShell(), empty).commissionFace();
    const rdEmpty = new ReadingApp(makeShell(), empty).readingStudioFace();
    for (const [name, f] of [['place', plEmpty], ['commission', cwEmpty], ['reading', rdEmpty]]) {
        assert.equal(f.ok, true, name + ': 没建过 ≠ 读不出');
        assert.equal(pickup(f), 0, name + ': 空台账必须是 0 条');
        assert.equal(f.rows.length, 0);
    }
    // 读不出：ok:false + count/placeCount 为 null（不是 0 —— 0 会被当成「真的没有」）
    const plNo = new PlaceApp(makeShell(), null).districtFace();
    const cwNo = new CreationdeskApp(makeShell(), null).commissionFace();
    const rdNo = new ReadingApp(makeShell(), null).readingStudioFace();
    for (const [name, f] of [['place', plNo], ['commission', cwNo], ['reading', rdNo]]) {
        assert.equal(f.ok, false, name + ': 读不出必须 ok:false');
        assert.equal(pickup(f), null, name + ': 读不出时计数必须是 null，不许拍 0');
        assert.ok(/读不到/.test(f.line), name + ': 读不出文案必须说「读不到」，实得 ' + f.line);
        assert.ok(/不是「没有/.test(f.line), name + ': 必须明说「不是没有 X」，实得 ' + f.line);
    }
    // 两种文案必须不同形（否则用户无从分辨该重试还是该新建）
    assert.notEqual(plEmpty.line, plNo.line);
    assert.notEqual(cwEmpty.line, cwNo.line);
    assert.notEqual(rdEmpty.line, rdNo.line);
});

test('E3: 三条链的写盘拒绝也归因（write_refused / no_api 不许冒充成功）', () => {
    globalThis.window = {};
    /* storage.set 返回 false 的宿主（配额满 / 只读会话）：必须报 write_refused，
     *   不许把「没写进去」当成功交出去。 */
    const refuse = { get() { return null; }, set() { return false; } };
    assert.equal(new PlaceApp(makeShell(), refuse).registerDistrictPlace('p', 'n', TW_MON_AM).reason, 'write-write_refused');
    assert.equal(new CreationdeskApp(makeShell(), refuse).createCommission({ title: 't' }).reason, 'write-write_refused');
    assert.equal(new ReadingApp(makeShell(), refuse).createReadingDossier({ researchQuestion: 'q' }).reason, 'write-write_refused');
    // set 抛错同为写失败，但不许把异常抛给界面
    const throws = { get() { return null; }, set() { throw new Error('quota'); } };
    assert.equal(new PlaceApp(makeShell(), throws).registerDistrictPlace('p', 'n', TW_MON_AM).reason, 'write-write_threw');
    // 有读无写的宿主：no_api
    const readOnly = { get() { return null; } };
    assert.equal(new CreationdeskApp(makeShell(), readOnly).createCommission({ title: 't' }).reason, 'write-no_api');
});

/* ══════════════════════════════════════════════════════════════
 * F 接线自证：真 import + 真消费（源码面）
 * ══════════════════════════════════════════════════════════════ */
test('F1: 三个 App 都真 import 了对应内核的具名导出（漏一行会被 catch 吞掉）', () => {
    const plSrc = read('apps/place/place-app.js');
    const plImp = plSrc.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/district-network\.js'/);
    assert.ok(plImp, 'place-app.js 必须从 config/district-network.js 具名导入');
    for (const n of ['createPlace', 'deriveOpportunities', 'recordVisit', 'getPlaceFamiliarity']) {
        assert.ok(new RegExp('\\b' + n + '\\b').test(plImp[0]), '导入列表必须含 ' + n);
    }
    const cwSrc = read('apps/creationdesk/creationdesk-app.js');
    const cwImp = cwSrc.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/commission-pipeline\.js'/);
    assert.ok(cwImp, 'creationdesk-app.js 必须从 config/commission-pipeline.js 具名导入');
    for (const n of ['createCommission', 'acceptBrief', 'submitDraft', 'proposeScopeChange', 'agreeScopeChange', 'acceptAndSettle', 'cancelCommission']) {
        // 导入侧一律加了 kern 前缀别名，故按 `as kernXxx` 判
        assert.ok(new RegExp('\\bas\\s+kern' + n.charAt(0).toUpperCase() + n.slice(1) + '\\b').test(cwImp[0]),
            '导入列表必须含 ' + n + ' 的别名');
    }
    const rdSrc = read('apps/reading/reading-app.js');
    const rdImp = rdSrc.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/reading-studio\.js'/);
    assert.ok(rdImp, 'reading-app.js 必须从 config/reading-studio.js 具名导入');
    for (const n of ['RS_STORAGE_KEY', 'createReadingDossier', 'linkBookToDossier', 'addExcerpt', 'addContrastingView', 'addAnnotation', 'updateDraft', 'handleBookVersionUpdate']) {
        assert.ok(new RegExp('\\b' + n + '\\b').test(rdImp[0]), '导入列表必须含 ' + n);
    }
    // 负控制：把导入名挖掉，正则必须看得见（否则本条是自我实现）
    const broken = plSrc.replace(/(\bimport\s*\{[^}]*\b)(createPlace\b)/, '$1');
    assert.notEqual(broken, plSrc, '负控制必须真的改到源码');
    const brokenImp = broken.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/district-network\.js'/);
    assert.ok(brokenImp, '挖掉后 import 语句本体必须还在（测的是列表项，不是整句）');
    assert.ok(!/\bcreatePlace\b/.test(brokenImp[0]), '挖掉后判据必须看得见');
});

test('F2: 三个视图都真消费了 App 的接线方法（不然方法级账本会把它们记成死方法）', () => {
    /* 本仓既有形态：App 侧加了方法、视图没挂，method-consumption 门就把方法记成「等级死」。
     *   本批实测踩到过（addAnnotationToDossier / updateDossierDraft 首版零消费）。
     *   判据直接看源码里有没有 `app.<方法>` 这种调用点。 */
    const plView = read('apps/place/place-view.js');
    for (const m of ['districtFace', 'registerDistrictPlace', 'recordDistrictVisit']) {
        assert.ok(new RegExp('app\\.' + m + '\\b').test(plView) || new RegExp('this\\.app\\.' + m + '\\b').test(plView),
            'place-view.js 必须真调用 ' + m);
    }
    const cwView = read('apps/creationdesk/creationdesk-view.js');
    for (const m of ['commissionFace', 'createCommission', 'acceptBrief', 'submitDraft', 'proposeScopeChange', 'agreeScopeChange', 'acceptAndSettle', 'cancelCommission']) {
        assert.ok(new RegExp('app\\.' + m + '\\b').test(cwView), 'creationdesk-view.js 必须真调用 ' + m);
    }
    const rdView = read('apps/reading/reading-view.js');
    for (const m of ['readingStudioFace', 'createReadingDossier', 'linkBookToDossier', 'addExcerptToDossier', 'addContrastingViewToDossier', 'addAnnotationToDossier', 'updateDossierDraft', 'handleBookVersionUpdate']) {
        assert.ok(new RegExp('app\\.' + m + '\\b').test(rdView), 'reading-view.js 必须真调用 ' + m);
    }
    // 负控制：随便挑一个不存在的名字，同一正则必须看不见（证明不是「怎么查都有」）
    assert.ok(!/app\.thisMethodDoesNotExist\b/.test(plView));
});

test('F3: 视图绑定挂在 _bind 里且有容器级能力探测（桩容器不许拖垮整页）', () => {
    /* 历史教训：裸调 querySelectorAll 在桩容器上会抛 TypeError 并拖垮整页渲染。
     *   三个视图的新绑定都必须走 q()/qa() 这类带探测的取法。 */
    const plView = read('apps/place/place-view.js');
    assert.ok(/pl-district-add/.test(plView) && /pl-district-save/.test(plView), '街区卡的两个表单按钮必须存在');
    assert.ok(/pl-district-go/.test(plView), '到访按钮必须存在');
    const cwView = read('apps/creationdesk/creationdesk-view.js');
    assert.ok(/data-cw-cact/.test(cwView), '委托动作按钮必须以 data-cw-cact 标注');
    assert.ok(/data-cw-cagree/.test(cwView), '同意变更按钮必须带 changeId 标注');
    const rdView = read('apps/reading/reading-view.js');
    for (const sel of ['data-rd-studio-exc', 'data-rd-studio-view', 'data-rd-studio-note', 'data-rd-studio-draft', 'data-rd-studio-bump']) {
        assert.ok(rdView.includes(sel), '研读案卷的动作按钮必须存在：' + sel);
    }
    // 探测式取法：新绑定段里不该出现裸 document.querySelectorAll
    const districtBind = plView.slice(plView.indexOf('pl-district-add'));
    assert.ok(!/^\s*document\.querySelectorAll/m.test(districtBind.slice(0, 4000)),
        '街区绑定不得裸调 document.querySelectorAll（桩容器会抛错）');
});

/* ══════════════════════════════════════════════════════════════
 * G 账本清账与内核独立可用
 * ══════════════════════════════════════════════════════════════ */
test('G1: 三件内核已不在三张账本的冻结条目里（本批处置的必须清零）', () => {
    const RELS = ['config/district-network.js', 'config/commission-pipeline.js', 'config/reading-studio.js'];
    // ① 死导出账本：字段 file
    const de = JSON.parse(read('scripts/dead-export-baseline.json')).entries;
    assert.ok(Array.isArray(de) && de.length > 0, '死导出账本必须可读且非空（空账本会让本条空转）');
    assert.equal(de.filter((e) => !e || typeof e.file !== 'string').length, 0, '每条都必须有 file 字段');
    for (const rel of RELS) {
        assert.equal(de.filter((e) => e && e.file === rel).length, 0, '死导出账本里不得再有 ' + rel);
    }
    // ② 绑定级死账本：字段 file
    const bd = JSON.parse(read('scripts/bind-dead-baseline.json')).entries;
    assert.ok(Array.isArray(bd) && bd.length > 0, '绑定账本必须可读且非空');
    for (const rel of RELS) {
        assert.equal(bd.filter((e) => e && e.file === rel).length, 0, '绑定账本里不得再有 ' + rel);
    }
    // ③ 模块账本：字段 rel（注意不是 file/module —— 写成 file 会恒 false 而假绿）
    const dm = JSON.parse(read('scripts/dead-module-baseline.json')).entries;
    assert.ok(Array.isArray(dm) && dm.length > 0, '模块账本必须可读且非空');
    assert.equal(dm.filter((e) => !e || typeof e.rel !== 'string').length, 0, '每条都必须有 rel 字段');
    for (const rel of RELS) {
        assert.equal(dm.filter((e) => e && e.rel === rel).length, 0, '模块账本里不得再有 ' + rel);
    }
    // 负控制 ①：三件内核在源码里必须真被 product 侧 import（不是只从账本里删掉）
    for (const rel of RELS) {
        const name = rel.split('/').pop();
        const importers = ['apps/place/place-app.js', 'apps/creationdesk/creationdesk-app.js', 'apps/reading/reading-app.js'];
        const hit = importers.some((f) => read(f).includes('config/' + name));
        assert.equal(hit, true, rel + ' 必须被某个 App 真 import（否则清账只是把记录抹了）');
    }
    // 负控制 ②：账本里其它条目必须还在（防止「清账=清空」这种假通过）
    assert.ok(dm.length > 50, '模块账本不该被清空，实得 ' + dm.length + ' 条');
    assert.ok(de.length > 50, '死导出账本不该被清空，实得 ' + de.length + ' 条');
    assert.ok(bd.length > 80, '绑定账本不该被清空，实得 ' + bd.length + ' 条');
});

test('G2: 三件内核仍是 tier=product（清账后不许被降级回去）', () => {
    /* 上一条判「不在冻结条目里」，但「不在」有两种原因：真接进了产品面，
     *   或者被从账本里删了却没接线。这条从反面钉住：三件都必须以 product 身份出现。 */
    const dm = JSON.parse(read('scripts/dead-module-baseline.json')).entries;
    const zeroRels = dm.filter((e) => e && e.tier === 'zero').map((e) => e.rel);
    for (const rel of ['config/district-network.js', 'config/commission-pipeline.js', 'config/reading-studio.js']) {
        assert.equal(zeroRels.includes(rel), false, rel + ' 不得再是 tier=zero');
    }
    // 反面对照：zero 档必须仍有条目（否则「不在 zero 里」可能因为 zero 档整个空了）
    assert.ok(zeroRels.length > 0, 'zero 档不该被清空（实得 ' + zeroRels.length + ' 件）');
});

test('G3: 内核纯函数仍可独立使用（App 只是消费者，不是唯一入口）', () => {
    /* 若 App 侧把内核语义重写了一遍，本档与内核单测就各测各的。
     *   这条用内核自己的口径再走一遍最短路径，确认两边读的是同一份语义。 */
    // district：熟悉度升级链
    const p = createPlace({ placeId: 'x', name: 'X', timeWindows: TW_MON_AM });
    assert.equal(getPlaceFamiliarity(p, 'u'), 'stranger');
    recordVisit(p, 'u', 'e1', []);
    assert.equal(getPlaceFamiliarity(p, 'u'), 'acquainted');
    recordVisit(p, 'u', 'e2', []);
    recordVisit(p, 'u', 'e3', []);
    assert.equal(getPlaceFamiliarity(p, 'u'), 'regular');
    assert.equal(deriveOpportunities(p, '周一', '上午', [{ id: 'e1', label: 'l' }], 'u')[0].status, 'already-attended');
    assert.equal(deriveOpportunities(p, '周一', '深夜', [{ id: 'e1', label: 'l' }], 'u')[0].status, 'missed');
    // commission：显式协商加价
    const c0 = createCommission({ title: 'T', agreedFee: 100 });
    const c1 = acceptBrief(c0, 30).commission;
    const c2 = submitDraft(c1, { draftId: 'd', content: 'x' }).commission;
    const c3 = proposeScopeChange(c2, { changeId: 'g', additionalRequirements: ['r'], feeDelta: 20 }).commission;
    const c4 = agreeScopeChange(c3, 'g').commission;
    assert.equal(c4.agreedFee, 120);
    assert.equal(acceptAndSettle(c4, 4, 'ok').settlement.remainingPaid, 90);
    assert.equal(cancelCommission(c4, 'stop').settlement.draftsPreservedCount, 1);
    // reading：改版政策
    let d = createReadingDossier({ researchQuestion: 'q' });
    d = linkBookToDossier(d, { bookId: 'b', title: 'B', version: 'v1' }).dossier;
    d = addExcerpt(d, { bookId: 'b', text: 'para' }).dossier;
    d = addContrastingView(d, { claimText: 'claim' }).dossier;
    d = addAnnotation(d, { comment: 'note' }).dossier;
    d = updateDraft(d, { sections: [{ heading: 'h', body: 'b' }] }).dossier;
    const upd = handleBookVersionUpdate(d, 'b', 'v2');
    assert.equal(upd.staleExcerptsCount, 1);
    assert.equal(upd.dossier.contrastingViews.length, 1, '改版不得动作者观点');
});
