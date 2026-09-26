/**
 * tests/system-v323.test.mjs — R1-E 九账证据面 + R1-C 投影新鲜度归因（下游消费侧）[v3.6.0]
 *
 * 上游 lonsha 在两版里各外供了一面，下游此前**全库零消费**：
 *   · v3.214.0（R1-E）把九本账收成一份可查对账面（引用键 + 出处楼层）写进 `snapshot.evidence`；
 *   · v3.213.0（R1-C）给投影加导出期新鲜度守卫，被扣下的原因写进 `snapshot.meta.projectionFreshness`。
 * 前者是「建好不消费」的第九例（用户点「证据」看到的是空壳）；
 * 后者是**已经发生的错读数** —— 该字段缺席时 `fieldTypes.projection.present` 同样为 false，
 * 于是 `readProjection()` 一律报 `no-projection-face`（文案「需记忆插件 v3.212+」），
 * 把「有面但被守卫扣下（**重发一轮就好**）」谎报成「本版没这面（只能等升级）」。两者处置相反。
 *
 * ★ 本套件的取值形状来自**真跑取证**（不是推演）：
 *   · 证据面空读数 = `{total:9, counts:{ok:0,empty:0,absent:9}, items:0}` 且逐账 `state:'absent'`；
 *   · 上游两条兜底（module-unavailable / thrown）**同形**（连 summary.total 都是 0），
 *     归因只能看顶层 `reason` —— 拿计数去猜必猜错；
 *   · `finiteFloor(null) === null`（上游刻意不把「楼层未知」塌成「第 0 楼」）。
 *
 * 写法约定（沿用 v321/v322 实测教训）：本文件**零反斜杠**。
 *   正则字面量里的反斜杠在这个工具链里会被吞掉一层，导致替换静默不发生、
 *   整份套件跑在空壳上还报绿。故一律用 includes / split 计数。
 *
 * 覆盖：
 *   A 真源出口面（五态齐名 / 恒定键面 / 三态分流逐态可达 / 楼层契约 / 缺席两因可分 / 行文案 / 不抛）
 *   B 接线面（诊断两张卡挂进 render / 投影卡当场纠正 / 搜索源只在 ok 建条目 / 织光机出处侧）
 *   C 负控制（真源码破坏 → 破坏副本上重跑同款真判据）
 *   D 版本锚
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const WB_SRC = read('config/world-bridge.js');
const DD_SRC = read('apps/diagnose/diagnose-data.js');
const DV_SRC = read('apps/diagnose/diagnose-view.js');
const GSE_SRC = read('apps/memory/global-search-engine.js');
const TWC_SRC = read('apps/timeweaver/timeweaver-collector.js');
const TWV_SRC = read('apps/timeweaver/timeweaver-view.js');
const AUDIT_SRC = read('scripts/bridge-contract-audit.mjs');

/** 镜像仓：世界桥有相对 import（config/*），搬单文件会断路径 ⇒ 按真仓结构建镜像。 */
const MIRROR = mkdtempSync(path.join(os.tmpdir(), 'v323-mir-'));
(function copyTree(src, dst) {
    for (const e of readdirSync(src, { withFileTypes: true })) {
        if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
        const sp = path.join(src, e.name), dp = path.join(dst, e.name);
        if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copyTree(sp, dp); }
        else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* 跳过读不到的 */ } }
    }
})(ROOT, MIRROR);
const WB = await import(pathToFileURL(path.join(MIRROR, 'config', 'world-bridge.js')).href);
const DD = await import(pathToFileURL(path.join(MIRROR, 'apps', 'diagnose', 'diagnose-data.js')).href);

/** 造一份挂上 lonsha 桥的 window（推送型：snapshot 是对象） */
const mkWin = (snap) => ({ lonsha_memory_bridge_v1: { snapshot: snap } });
const snapWith = (evidence, meta) => Object.assign({ pluginVersion: '3.214.0' }, { evidence }, meta ? { meta } : {});

/* 上游证据面的真值形状（探针实测） */
const LEDGER = (id, label, state, extra) => Object.assign({
    id, label, apiGlobal: 'LonShaX', apiState: state, state,
    reason: state === 'absent' ? 'module-unavailable' : '', count: 0, truncated: false, items: []
}, extra || {});
const ITEM = (over) => Object.assign({
    ref: 'seed:sp_1', ledger: 'seed', ledgerLabel: '伏笔', title: '门后的光', detail: '正文',
    status: 'open', floor: 3, updatedFloor: 7, source: 'seedLedger', revision: 2
}, over || {});

/** 九账齐备、其中 seed 有条目 */
function okFace() {
    const ledgers = {};
    const ids = [['seed', '伏笔'], ['commitment', '约定'], ['parallel', '平行事实'], ['secret', '秘密'],
        ['recall-echo', '前文回扣'], ['echo', '回声'], ['fact-version', '事实版本'],
        ['event-completeness', '事件完整性'], ['repair', '修复闭环']];
    for (const [id, label] of ids) {
        ledgers[id] = (id === 'seed')
            ? LEDGER(id, label, 'ok', { count: 2, items: [ITEM(), ITEM({ ref: 'seed:sp_2', title: '旧钥匙', floor: null })] })
            : LEDGER(id, label, 'ok', { count: 0 });
    }
    return {
        version: 2, at: 1700000000000, ledgers,
        summary: { total: 9, counts: { ok: 9, empty: 0, absent: 0 }, items: 2 },
        selfConsistent: true, reason: ''
    };
}
/** 九账全缺席（模块未挂上）—— 上游真值：summary.total 也是 0 */
const DEAD_FACE = {
    version: 0, at: 0, ledgers: {},
    summary: { total: 0, counts: { ok: 0, empty: 0, absent: 0 }, items: 0 },
    selfConsistent: false, reason: 'module-unavailable'
};
/** 九账都在位、但一条条目也没有（真读数） */
const EMPTY_FACE = {
    version: 2, at: 1700000000000, ledgers: {},
    summary: { total: 9, counts: { ok: 0, empty: 9, absent: 0 }, items: 0 },
    selfConsistent: true, reason: ''
};
/** 逐账缺席、但**顶层没有兜底原因** ⇒ 真走三态分流那条分支（上面 DEAD_FACE 走的是上游兜底早返回）。
 *  这一条是负控制的必需夹具：破坏分流判据时，只有这条面才会改变结果。 */
const ALL_ABSENT_FACE = {
    version: 2, at: 1,
    ledgers: { seed: LEDGER('seed', '伏笔', 'absent', { reason: 'no-state' }) },
    summary: { total: 9, counts: { ok: 0, empty: 0, absent: 1 }, items: 0 },
    selfConsistent: true, reason: ''
};

const EKEYS = ['state', 'reason', 'version', 'at', 'total', 'okCount', 'emptyCount', 'absentCount',
    'itemCount', 'selfConsistent', 'ledgers', 'items', 'absentReasons'].sort();
const FKEYS = ['present', 'dropped', 'reason', 'from', 'to'].sort();

/* ══════════ A 真源出口面 ══════════ */
test('v323 A1. ★★★ 五态常量齐名 + 恒定键面（缺席面与有值面逐键相同）', () => {
    assert.deepEqual(Object.keys(WB.default.EVIDENCE_STATES).sort(),
        ['BRIDGE_ABSENT', 'EMPTY', 'FACE_ABSENT', 'OK', 'UNUSABLE'], '五态齐名');
    assert.ok(WB_SRC.includes('const EVIDENCE_STATES = Object.freeze('), '状态表冻结（单一真源）');
    const absent = WB.readLonshaEvidence({});
    assert.equal(absent.state, 'bridge-absent');
    assert.deepEqual(Object.keys(absent).sort(), EKEYS, '缺席面键面恒定');
    const ok = WB.evidenceFaceOf(snapWith(okFace()));
    assert.equal(ok.state, 'ok');
    assert.deepEqual(Object.keys(ok).sort(), EKEYS, '★ 有值面键面必须与缺席面逐键相同（读者不必再判 undefined）');
    /* 纯函数读面与取数式读面**同形**：同一面的两个入口不得各有各的键面 */
    assert.deepEqual(Object.keys(WB.evidenceFaceOf(null)).sort(), EKEYS, '空入参也恒定');
});

test('v323 A2. ★★★★ 三态分流逐态可达：ok / empty / unusable 三者不得同形（处置方向相反）', () => {
    const ok = WB.evidenceFaceOf(snapWith(okFace()));
    assert.equal(ok.state, 'ok', '有条目 ⇒ ok');
    assert.equal(ok.itemCount, 2, '条目数如实');
    assert.ok(ok.ledgers.length >= 9, '逐账读数都要在');

    /* 九账在位、确实没条目 ⇒ empty（真读数，等剧情推进） */
    const e = WB.evidenceFaceOf(snapWith(EMPTY_FACE));
    assert.equal(e.state, 'empty', '★ 账在位、无条目 ⇒ empty，不是 unusable');
    assert.equal(e.reason, 'no-items');
    assert.equal(e.itemCount, 0);

    /* 一本账也读不到 ⇒ unusable（本机读不出，等上游修/宿主）—— 与 empty **相反**
     *   注意用 ALL_ABSENT_FACE（逐账缺席、顶层无兜底原因）才真走三态分流那条分支；
     *   带顶层 reason 的面会先被上游兜底判据接住，走不到分流 —— 负控制 N1 同理。 */
    const u = WB.evidenceFaceOf(snapWith(ALL_ABSENT_FACE));
    assert.equal(u.state, 'unusable', '★ 一本账也读不到 ⇒ unusable');
    assert.equal(u.reason, 'no-state', '归因取自缺席账（逐账真因）');
    assert.notEqual(u.state, e.state, '★ unusable 与 empty 不得同形（前者等上游修，后者等剧情推进）');
    /* 上游兜底那两态（顶层 reason 短路）也要在自己的口径上正确 */
    const dead = WB.evidenceFaceOf(snapWith(DEAD_FACE));
    assert.equal(dead.state, 'unusable', '上游模块兜底 ⇒ unusable');
    assert.equal(dead.reason, 'module-unavailable', '归因取自顶层 reason（两条兜底同形，不能看计数）');
    /* 上游两条兜底**同形**：summary 连 total 都是 0 —— 归因只能看 reason */
    const thrown = Object.assign({}, DEAD_FACE, { reason: 'thrown' });
    const u2 = WB.evidenceFaceOf(snapWith(thrown));
    assert.equal(u2.reason, 'thrown', '第二条兜底如实带自己的原因（不合并成第一种）');
    assert.equal(u2.total, dead.total, '（两条兜底的计数确实同形 —— 这就是为什么判据必须看 reason）');
});

test('v323 A3. ★★★★ 楼层契约：取不到即 null，绝不写 0（0 是「第 0 楼」这个真实读数）', () => {
    const ok = WB.evidenceFaceOf(snapWith(okFace()));
    const withFloor = ok.items.find((it) => it.ref === 'seed:sp_1');
    const noFloor = ok.items.find((it) => it.ref === 'seed:sp_2');
    assert.equal(withFloor.floor, 3, '真楼层原样');
    assert.equal(noFloor.floor, null, '★ 楼层缺失 ⇒ null，不得塌成 0');
    assert.notEqual(noFloor.floor, 0, '★ 绝不写 0（上游 finiteFloor(null) === null 就是为这个）');
    assert.ok(WB_SRC.includes('it.floor === undefined ? null : it.floor'), '楼层归一写法在场（单一真源）');
    /* 视图与搜索源两侧都不许把 null 渲染成 0 */
    assert.ok(GSE_SRC.includes("it.floor === null || it.floor === undefined"), '搜索源须显式挡 null（不出该段，不写 0）');
    assert.ok(TWV_SRC.includes('it.floor === null || it.floor === undefined'), '织光机视图须显式挡 null（显示「—」，不写 0）');
});

test('v323 A4. ★★★ 缺席两因如实带出：账「读不到」与账「没条目」不得合并成一态', () => {
    const ledgers = {
        seed: LEDGER('seed', '伏笔', 'absent', { reason: 'module-unavailable' }),
        commitment: LEDGER('commitment', '约定', 'empty')
    };
    const face = {
        version: 2, at: 1, ledgers,
        summary: { total: 9, counts: { ok: 0, empty: 1, absent: 1 }, items: 0 },
        selfConsistent: true, reason: ''
    };
    const r = WB.evidenceFaceOf(snapWith(face));
    assert.equal(r.state, 'empty', '有账被真读到（empty 那本）⇒ 不是 unusable');
    const seed = r.ledgers.find((L) => L.id === 'seed');
    const com = r.ledgers.find((L) => L.id === 'commitment');
    assert.equal(seed.state, 'absent');
    assert.equal(seed.reason, 'module-unavailable', '缺席账的归因如实带出');
    assert.equal(com.state, 'empty');
    assert.equal(com.reason, '', '在位但空的账**不带缺席归因**（两因不得合并）');
    assert.equal(r.absentReasons.length, 1, '缺席清单只收真缺席那本');
    assert.equal(r.absentReasons[0].id, 'seed');
    /* 多因时给 mixed，而不是谎报成因里的第一个 */
    const multi = WB.evidenceFaceOf(snapWith({
        version: 2, at: 1,
        ledgers: { seed: LEDGER('seed', '伏笔', 'absent', { reason: 'module-unavailable' }),
            commitment: LEDGER('commitment', '约定', 'absent', { reason: 'no-state' }) },
        summary: { total: 9, counts: { ok: 0, empty: 0, absent: 2 }, items: 0 },
        selfConsistent: true, reason: ''
    }));
    assert.equal(multi.state, 'unusable');
    assert.equal(multi.reason, 'mixed', '★ 多因 ⇒ mixed（不许挑一个当全部）');
});

test('v323 A5. ★★ 行文案五态各有各的话；旧版没这面与「读不出」措辞不同', () => {
    const bridge = WB.evidenceFaceLine(WB.readLonshaEvidence({}));
    const faceAbsent = WB.evidenceFaceLine(WB.evidenceFaceOf(snapWith(undefined)));
    const unusable = WB.evidenceFaceLine(WB.evidenceFaceOf(snapWith(ALL_ABSENT_FACE)));
    const empty = WB.evidenceFaceLine(WB.evidenceFaceOf(snapWith(EMPTY_FACE)));
    const ok = WB.evidenceFaceLine(WB.evidenceFaceOf(snapWith(okFace())));
    for (const [name, line] of [['bridge', bridge], ['face-absent', faceAbsent], ['unusable', unusable], ['empty', empty], ['ok', ok]]) {
        assert.equal(typeof line, 'string');
        assert.ok(line.startsWith('证据：'), '五态都以「证据：」起头：' + name);
    }
    const all = [bridge, faceAbsent, unusable, empty, ok];
    assert.equal(new Set(all).size, 5, '★ 五态五句，不得有任意两句同形');
    assert.ok(faceAbsent.includes('本版没有这一面'), '旧版没这面 ⇒ 如实说版本需求');
    assert.ok(unusable.includes('一本也读不到'), '读不出 ⇒ 如实说读不出');
    assert.ok(unusable.includes('不是「账里没有条目」'), '读不出必须与「账里没条目」区分');
    assert.ok(empty.includes('都在位'), '空读数 ⇒ 如实说账在位');
    assert.ok(ok.includes('条目 2'), '有值时带条目数');
    /* evidenceLine(win) 是取数式入口，走同一份文案实现 */
    assert.equal(typeof WB.evidenceLine({}), 'string');
    assert.ok(WB.evidenceLine({}).startsWith('证据：'), '取数式入口文案同规格');
});

test('v323 A6. ★★ 新鲜度归因：四键恒定 / 未知原因如实输出原值 / 不抛', () => {
    const miss = WB.readProjectionFreshness(null);
    assert.deepEqual(Object.keys(miss).sort(), FKEYS, '键面恒定');
    assert.equal(miss.present, false, '没给这份归因 ⇒ present:false');
    assert.equal(miss.dropped, false);
    assert.equal(WB.projectionFreshnessText(miss), '', '没扣下 ⇒ 空串（不出噪声）');
    for (const bad of [null, undefined, 42, 'x', [], { meta: null }, { meta: { projectionFreshness: 'x' } }]) {
        let threw = false;
        try { WB.readProjectionFreshness(bad); } catch (_e) { threw = true; }
        assert.equal(threw, false, '畸形入参不得外抛：' + JSON.stringify(bad));
    }
    const conv = WB.readProjectionFreshness({ meta: { projectionFreshness: { dropped: true, reason: 'stale-conversation', from: 'chatA', to: 'chatB' } } });
    assert.equal(conv.present, true);
    assert.equal(conv.dropped, true);
    assert.equal(conv.reason, 'stale-conversation');
    assert.equal(conv.from, 'chatA');
    assert.equal(conv.to, 'chatB');
    assert.ok(WB.projectionFreshnessText(conv).includes('另一个会话'), '会话不符 ⇒ 说「另一个会话」');
    const rev = WB.readProjectionFreshness({ meta: { projectionFreshness: { dropped: true, reason: 'stale-revision', from: 3, to: 9 } } });
    assert.ok(WB.projectionFreshnessText(rev).includes('上一代'), '代数不符 ⇒ 说「上一代」');
    assert.notEqual(WB.projectionFreshnessText(conv), WB.projectionFreshnessText(rev), '两因两句话（不得同形）');
    /* 未知原因：如实输出原值，不静默兜底成某个具体结论 */
    const unk = WB.readProjectionFreshness({ meta: { projectionFreshness: { dropped: true, reason: 'brand-new-reason', from: 1, to: 2 } } });
    const txt = WB.projectionFreshnessText(unk);
    assert.ok(txt.includes('brand-new-reason'), '★ 未知原因必须原样带出（静默兜底会把将来的新原因显示成旧结论）');
    assert.equal(txt.includes('另一个会话'), false, '未知原因不得被说成某一个已知原因');
});

/* ══════════ B 接线面 ══════════ */
test('v323 B1. ★★★ 诊断两张卡挂进 render；投影卡在「被扣下」时当场纠正那句错归因', () => {
    assert.ok(DV_SRC.includes('_evidenceHtml(pkg) {'), '九账证据面卡片方法在场');
    assert.ok(DV_SRC.includes('_freshnessHtml(pkg) {'), '投影新鲜度归因卡片方法在场');
    assert.ok(DV_SRC.includes('<h3>九账证据面</h3>'), '证据面卡片标题在 render 里');
    assert.ok(DV_SRC.includes('<h3>投影新鲜度归因</h3>'), '新鲜度卡片标题在 render 里');
    assert.ok(DV_SRC.includes('this._evidenceHtml(pkg)'), '证据面须真接进 render');
    assert.ok(DV_SRC.includes('this._freshnessHtml(pkg)'), '新鲜度面须真接进 render');
    /* 当场纠正：投影卡原样显示的上游文案若在本轮不成立，必须紧接着纠正 */
    assert.ok(DV_SRC.includes('上面这句话在本轮'), '投影卡须有当场纠正块');
    assert.ok(DV_SRC.includes('这不是「本版没这面」'), '纠正句须点明与「本版没这面」的区别');
    assert.ok(DV_SRC.includes('fresh.dropped === true'), '纠正块以 dropped 为条件');
    /* 卡片只用既有 dg-* 类（无需新 CSS） */
    const css = read('apps/diagnose/diagnose.css');
    for (const cls of ['dg-row', 'dg-chip', 'dg-table', 'dg-sub', 'dg-note', 'dg-name', 'dg-bad']) {
        assert.ok(css.includes('.' + cls), '卡片用的类必须真在样式表里：' + cls);
    }
    /* 归因面在总述首行可见（那是用户能处理的事） */
    assert.ok(DD_SRC.includes('p.freshness && p.freshness.dropped === true'), '总述首行须收「投影被扣下」这条坏消息');
    assert.ok(DD_SRC.includes("ev.state === 'unusable'"), '总述首行须收「九账一本也读不到」（但不收「账里没条目」那条真读数）');
    assert.equal(DD_SRC.includes("ev.state === 'empty'"), false, '★ 「账里没条目」是真读数，不得塞进坏消息首行（会稀释「需要用户做的事」）');
});

test('v323 B2. ★★★ 两个消费面只经真源归一，不自己解 snap.evidence（同口径不得抄第二份）', () => {
    /* 消费点在场 */
    assert.ok(DD_SRC.includes('evidenceFaceOf(snapshot)'), '诊断内核经纯函数读（已握快照，不额外取数）');
    assert.ok(DD_SRC.includes('readProjectionFreshness(snapshot)'), '诊断内核经纯函数读新鲜度归因');
    assert.ok(GSE_SRC.includes('evidenceFaceOf(snap)'), '搜索源经同一纯函数归一');
    /* 谁也不许自己摸 raw 面 —— 那正是 J1/J4 与「7 份 probeBridge」的同形教训。
     * 断言只看**代码行**（注释里逐字写着「不自己解 snap.evidence」，那正是要留的文档），
     * 否则就成了本仓明令禁止的文本包含式假红。 */
    const codeLinesWith = (src, needle) => src.split(String.fromCharCode(10)).filter((ln) => {
        if (!ln.includes(needle)) return false;
        const t = ln.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    });
    assert.equal(codeLinesWith(GSE_SRC, 'snap.evidence').length, 0, '★ 搜索源不得在代码里自己解 snap.evidence');
    assert.equal(codeLinesWith(DD_SRC, 'snapshot.evidence').length, 0, '★ 诊断内核不得在代码里自己解 snapshot.evidence');
    assert.ok(GSE_SRC.includes('不在这里自己解'), '注释里须写明口径（文档也是防线）');
    assert.ok(GSE_SRC.includes('face.state !== \'ok\''), '搜索源只在 ok 建条目');
    /* 织光机出处侧：无现成快照 ⇒ 走取数式出口 */
    assert.ok(TWC_SRC.includes('readLonshaEvidence(win)'), '织光机走取数式出口');
    assert.ok(TWC_SRC.includes("r.state === 'bridge-absent' || r.state === 'face-absent'"), '缺席两态不建卡（不刷噪声）');
    assert.ok(TWC_SRC.includes('_(evidence)Block'.replace(/[()]/g, '')) || TWV_SRC.includes('_evidenceBlock(m)'), '织光机视图有出处侧卡片');
    assert.ok(TWV_SRC.includes('this._evidenceBlock(m)'), '出处侧卡片须真接进 render');
    assert.ok(TWC_SRC.includes('evidence,') || TWC_SRC.includes('evidence'), '出处侧面须挂在 narrative 上');
    /* 三面并列、互不顶替：不并入 empty 判定（本机没碎片 ≠ 上游没条目） */
    assert.ok(TWC_SRC.includes('不并入 empty 判定'), '须写明为何不并入 empty 判定');
});

test('v323 B3. ★★★ 第九道门 J12 常驻守在场：出口在场与真被消费分别判', () => {
    assert.ok(AUDIT_SRC.includes("const EVIDENCE_READER = 'readLonshaEvidence';"), 'J12 证据面取数式出口名在场');
    assert.ok(AUDIT_SRC.includes("const EVIDENCE_FACE_READER = 'evidenceFaceOf';"), 'J12 证据面纯函数出口名在场');
    assert.ok(AUDIT_SRC.includes("const FRESHNESS_READER = 'readProjectionFreshness';"), 'J12 新鲜度出口名在场');
    assert.ok(AUDIT_SRC.includes('const EVIDENCE_MIN_CONSUMERS = 3;'), '证据面下限按实测三个业务面写死');
    assert.ok(AUDIT_SRC.includes('const FRESHNESS_MIN_CONSUMERS = 1;'), '新鲜度面下限按实测一个业务面写死');
    assert.ok(AUDIT_SRC.includes('corrupt = 1;') && AUDIT_SRC.includes('fail = 1;'), '两种故障分别报（出口被删 / 没人读）');
    assert.ok(AUDIT_SRC.includes('missingExports.push('), '缺出口逐个点名（合成一条会互相顶替）');
    /* 按文件去重而不是按调用次数 —— 否则同一业务面数两遍会掩盖另一面归零 */
    assert.ok(AUDIT_SRC.includes('evidenceConsumerFiles.length'), 'J12 按去重文件数计');
    assert.ok(AUDIT_SRC.includes('按文件去重'), '口径在注释与输出里都写明');
});

/* ══════════ C 负控制（真源码破坏 → 破坏副本上重跑同款真判据） ══════════ */
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

/** 真源码破坏：锚点须恰中 1 次，破坏后副本上重跑同款判据 */
function withBrokenBridge(anchor, replacement, fn) {
    assert.equal(WB_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次：' + anchor.slice(0, 44));
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v323-neg-'));
    (function copy(src, dst) {
        for (const e of readdirSync(src, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
            const sp = path.join(src, e.name), dp = path.join(dst, e.name);
            if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copy(sp, dp); }
            else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* 跳过读不到的 */ } }
        }
    })(ROOT, dir);
    const broken = WB_SRC.replace(anchor, replacement);
    assert.notEqual(broken, WB_SRC, '破坏必须真发生');
    writeFileSync(path.join(dir, 'config', 'world-bridge.js'), broken);
    return import(pathToFileURL(path.join(dir, 'config', 'world-bridge.js')).href + '?brk=' + Date.now()).then(fn);
}

test('v323 N1. ★★★★ 破坏「unusable 与 empty 分流」⇒ A2 同款判据必须转红', async () => {
    await withBrokenBridge('        else if (okCount + emptyCount === 0 && absentCount > 0) {',
        '        else if (false) {', async (M) => {
        const u = M.evidenceFaceOf(snapWith(ALL_ABSENT_FACE));
        assert.throws(() => assert.equal(u.state, 'unusable', '一本账也读不到 ⇒ unusable'), isAssertionFailure,
            'A2 同款判据在破坏副本上必须抛');
        assert.equal(u.state, 'empty', '（破坏已生效：读不出被谎报成「账在位、没条目」）');
        assert.equal(M.evidenceFaceLine(u).includes('一本也读不到'), false, '（行文案也跟着说谎 —— 两种处置相反的处境被压成一态）');
    });
});

test('v323 N2. ★★★★ 破坏「楼层缺失不写 0」⇒ A3 同款判据必须转红', async () => {
    await withBrokenBridge('                    floor: (it.floor === undefined ? null : it.floor),',
        '                    floor: Number(it.floor) || 0,', async (M) => {
        const ok = M.evidenceFaceOf(snapWith(okFace()));
        const noFloor = ok.items.find((it) => it.ref === 'seed:sp_2');
        assert.throws(() => assert.equal(noFloor.floor, null, '楼层缺失 ⇒ null'), isAssertionFailure,
            'A3 同款判据在破坏副本上必须抛');
        assert.equal(noFloor.floor, 0, '（破坏已生效：楼层未知被塌成「第 0 楼」）');
    });
});

test('v323 N3. ★★★ 破坏「缺席账带出真归因」⇒ A4 同款判据必须转红', async () => {
    await withBrokenBridge("                reason: (st === 'absent' ? (reason || 'absent') : ''),",
        "                reason: '',", async (M) => {
        const ledgers = { seed: LEDGER('seed', '伏笔', 'absent', { reason: 'module-unavailable' }) };
        const face = { version: 2, at: 1, ledgers,
            summary: { total: 9, counts: { ok: 0, empty: 0, absent: 1 }, items: 0 }, selfConsistent: true, reason: '' };
        const r = M.evidenceFaceOf(snapWith(face));
        assert.throws(() => assert.equal(r.ledgers[0].reason, 'module-unavailable', '缺席账的归因如实带出'), isAssertionFailure,
            'A4 同款判据在破坏副本上必须抛');
        assert.equal(r.ledgers[0].reason, '', '（破坏已生效：缺席原因被抹掉 —— 用户无从知道该等谁）');
    });
});

test('v323 N4. ★★★★ 破坏「未知原因如实输出原值」⇒ A6 同款判据必须转红', async () => {
    await withBrokenBridge("    return FRESHNESS_TEXT[f.reason] || ('投影已被新鲜度守卫扣下（原因 ' + String(f.reason || '未知') + '）');",
        "    return FRESHNESS_TEXT[f.reason] || FRESHNESS_TEXT['stale-conversation'];", async (M) => {
        const unk = M.readProjectionFreshness({ meta: { projectionFreshness: { dropped: true, reason: 'brand-new-reason', from: 1, to: 2 } } });
        const txt = M.projectionFreshnessText(unk);
        assert.throws(() => assert.ok(txt.includes('brand-new-reason'), '未知原因必须原样带出'), isAssertionFailure,
            'A6 同款判据在破坏副本上必须抛');
        assert.ok(txt.includes('另一个会话'), '（破坏已生效：将来的新原因被静默显示成某个已知旧结论）');
    });
});

/* ══════════ D 版本锚 ══════════ */
test('v323 D1. ★ 本套件只在 3.6.0 及以后成立', () => {
    const idx = read('index.js');
    const line = idx.split(String.fromCharCode(10)).find((x) => x.startsWith('const ST_PHONE_VERSION')) || '';
    const ver = line.split(String.fromCharCode(39))[1];
    assert.ok(ver, '入口版本常量在场');
    const [maj, min, pat] = ver.split('.').map(Number);
    assert.ok(maj > 3 || (maj === 3 && (min > 6 || (min === 6 && pat >= 0))), '本套件只在 3.6.0 及以后成立；当前 ' + ver);
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    assert.equal(JSON.parse(read('update-log.json')).latest, ver, 'update-log.latest 同源');
});
