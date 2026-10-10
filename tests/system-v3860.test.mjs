/* ============================================================
 * tests/system-v3860.test.mjs — 拓展计划 R-X2 来源链与实体关系浏览器 [v3.86.0]
 * ------------------------------------------------------------
 * 本版把「散在各处的来源关系」收成**一张可看的图**。修前的实测处境（逐条核对，不是推演）：
 *   · 全局搜索能找到内容，但**没有任何一处**回答「这条是从哪来的、中途经过了谁」；
 *     一条通知、一份草稿、一条记忆各自成立，彼此之间的来源关系只活在代码里；
 *   · 上游被删 / 被撤回时，下游**静默消失**（用户以为本来就没有这个东西）；
 *   · 「本轮没读到这一类源」与「读了、这一类确实没有」在界面上**同形**，
 *     而两者的处置正好相反（前者等下次刷新，后者才叫真没有）；
 *   · 角色名被当成全局唯一 id ⇒ 同名异人在关系图上被拼成一个人，且**不报错**；
 *   · 跨会话 / 跨分支的记录混进同一张图 ⇒ 别段的内容从这个口子漏出来。
 *
 * 本套件守五件事：
 *   A 结构面：五类节点 / 四类边 / 三态 / 三张归因词表 / 十七个出口齐备；纯函数不摸宿主；
 *            不新增存储键（故不涉 keys 台账）；
 *   B 行为面：判据函数（负控制必须复用**同一份**）—— 跨段只报壳 / 拿不到身份判不同段 /
 *            「读不到」不许判撤 / 「读过但不在场」判撤并立墓碑 / 悬空边也传失效 /
 *            转述三平台归一条链 / 三态总述不同形 / 行面四态不同形 / 自等自证两侧都跑；
 *   C 接线面：咽喉真调内核（读真源码）、诊断协议面与搜索行面只读宿主缓存/内核出口、
 *            真跑内核链（照咽喉的取数口径复刻一遍）；
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

const M_PG = 'config/provenance-graph.js';
const D_DATA = 'apps/diagnose/diagnose-data.js';
const D_VIEW = 'apps/diagnose/diagnose-view.js';
const A_SEARCH = 'apps/search/search-view.js';
const A_SEARCH_APP = 'apps/search/search-app.js';
const IDX = 'index.js';
const S_DERIV = 'scripts/source-derivation-audit.mjs';

const PG = await mod(M_PG);

const SC = Object.freeze({ chatId: 'c1', branchKey: 'b1' });
const REF_TRADE = Object.freeze({ appId: 'traveldesk', kind: 'expense', id: 'e1' });

/* ================== 判据函数（负控制必须复用**同一份**） ================== */

/** R-X2-① 跨会话/跨分支的记录只报壳：kind 与原因可以带，**内容一个字都不带**。 */
function jCrossScopeShellOnly(m) {
    const g = m.buildProvenanceGraph({
        scope: SC,
        nodes: [
            { kind: 'event', sourceId: 'calendar:m1:work', label: '本段的事', scope: SC },
            { kind: 'event', sourceId: 'calendar:m2:work', label: '别段的事', scope: { chatId: 'c2', branchKey: 'b1' } }
        ],
        readSources: ['event']
    });
    if (g.counts.nodes !== 1) return { ok: false, why: '跨段记录必须只报壳，实测进图 ' + g.counts.nodes + ' 条' };
    if (g.counts.blocked !== 1) return { ok: false, why: '跨段记录必须记一条 blocked，实测 ' + g.counts.blocked };
    const b = g.blocked[0];
    if (b.reason !== m.PG_BLOCK_REASONS.CROSS_SCOPE) return { ok: false, why: '归因错：' + b.reason };
    if (b.kind !== 'event') return { ok: false, why: '壳里连 kind 都没了，读的人认不出被挡的是什么' };
    if (JSON.stringify(b).indexOf('别段的事') >= 0) return { ok: false, why: '跨段壳里带了内容（泄露）' };
    if (JSON.stringify(g.nodes).indexOf('别段的事') >= 0) return { ok: false, why: '跨段内容仍留在图里（泄露）' };
    return { ok: true, why: '' };
}

/** R-X2-② 拿不到会话身份即判「不是同一段」（fail-closed）；宁可多拦一条，不可漏一条。 */
function jFailClosedNoChatId(m) {
    const empty = { chatId: '', branchKey: '' };
    if (m.pgSameScope(empty, empty) !== false) return { ok: false, why: '空会话身份竟判同一段 ⇒ 隔离 fail-open' };
    const g = m.buildProvenanceGraph({
        scope: empty,
        nodes: [{ kind: 'event', sourceId: 'calendar:m1:work', label: '甲', scope: empty }],
        readSources: ['event']
    });
    if (g.counts.nodes !== 0) return { ok: false, why: '拿不到会话身份却把节点收进图里（fail-open）' };
    if (g.counts.blocked !== 1) return { ok: false, why: '应记一条跨段壳，实测 ' + g.counts.blocked };
    /* 反向：拿得到身份、且确实同段 ⇒ 必须进图（不然这套判据对任何输入都拦，是恒真）。 */
    const rec = m.buildProvenanceGraph({
        scope: SC,
        nodes: [{ kind: 'event', sourceId: 'calendar:m1:work', label: '甲', scope: SC }],
        readSources: ['event']
    });
    if (rec.counts.nodes !== 1) return { ok: false, why: '同段记录被误拦（判据恒假）' };
    return { ok: true, why: '' };
}

/** R-X2-③ 读不到 ≠ 没有：上游那类源本轮**没读**过 ⇒ 不判撤，只留悬空边。 */
function jNotReadIsNotGone(m) {
    const g = m.buildProvenanceGraph({
        scope: SC,
        nodes: [{ kind: 'material', label: '转述', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'n1' }, via: 'trade:missing' }],
        readSources: ['material']     /* 刻意**没有**声明读过 trade */
    });
    if (g.nodes.some((n) => n.tombstone === true)) return { ok: false, why: '没读过的源竟立了墓碑（把读不到当没有）' };
    const node = g.nodes.filter((n) => n.kind === 'material')[0];
    if (!node) return { ok: false, why: '素材节点没进图' };
    if (node.state === m.PG_STATES.withdrawn) return { ok: false, why: '上游那类源没读却判了撤回' };
    if (g.counts.dangling !== 1) return { ok: false, why: '该留一条悬空边，实测 ' + g.counts.dangling };
    if (!g.gaps.some((x) => x.source === 'trade' && x.reason === 'not-read')) {
        return { ok: false, why: '没读到的源必须记一条 not-read gap' };
    }
    return { ok: true, why: '' };
}

/** R-X2-④ 撤回判定只认**显式声明读过**的那一类源：图里有同 kind 的一条不算读过。 */
function jDeclaredReadBeatsReadSet(m) {
    const g = m.buildProvenanceGraph({
        scope: SC,
        nodes: [
            { kind: 'trade', label: '费用', scope: SC, ref: REF_TRADE },
            { kind: 'material', label: '转述', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'n1' }, via: 'trade:missing' }
        ],
        readSources: ['material']     /* 图里有 trade 的一条，但**没声明读过 trade** */
    });
    if (g.nodes.some((n) => n.tombstone === true)) return { ok: false, why: '只凭图里有同 kind 的一条就判了撤（拿部分当全部）' };
    const node = g.nodes.filter((n) => n.kind === 'material')[0];
    if (node.state === m.PG_STATES.withdrawn) return { ok: false, why: '下游被误判失效' };
    return { ok: true, why: '' };
}

/** R-X2-⑤ 上游那类源**读过**而那条不在图里 ⇒ 判撤 + 立墓碑（显示失效，不是静默消失）。 */
function jWithdrawnLeavesTombstone(m) {
    const g = m.buildProvenanceGraph({
        scope: SC,
        nodes: [{ kind: 'material', label: '转述', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'n1' }, via: 'trade:missing' }],
        readSources: ['material', 'trade']
    });
    const tomb = g.nodes.filter((n) => n.tombstone === true)[0];
    if (!tomb) return { ok: false, why: '上游读过却不在场 ⇒ 必须立墓碑（验收③）' };
    if (tomb.key !== 'trade:missing') return { ok: false, why: '墓碑 key 不对：' + tomb.key };
    if (tomb.ref !== null || tomb.durable !== false) return { ok: false, why: '墓碑不许假装还有靶心' };
    if (!tomb.refText) return { ok: false, why: '墓碑必须说清「它曾经是哪一类的哪一条」' };
    const node = g.nodes.filter((n) => n.kind === 'material')[0];
    if (node.state !== m.PG_STATES.withdrawn) return { ok: false, why: '下游未标失效' };
    if (node.withdrawnBy !== 'trade:missing') return { ok: false, why: '没带出是谁连累了它' };
    return { ok: true, why: '' };
}

/** R-X2-⑥ 撤回经**悬空边**也要传播：否则「上游撤回」退化成「莫名其妙悬空」。 */
function jWithdrawViaDangling(m) {
    const g = m.buildProvenanceGraph({
        scope: SC,
        nodes: [
            { kind: 'material', label: '中游', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'n2' }, via: 'trade:gone' },
            { kind: 'material', label: '下游', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'n3' }, via: 'novel:n2' }
        ],
        readSources: ['material', 'trade'],
        withdrawn: ['trade:gone']
    });
    const down = g.nodes.filter((n) => n.kind === 'material' && (n.ref && n.ref.id === 'n3'))[0];
    const mid = g.nodes.filter((n) => n.kind === 'material' && (n.ref && n.ref.id === 'n2'))[0];
    if (!mid || !down) return { ok: false, why: '两个素材节点没都进图' };
    if (mid.state !== m.PG_STATES.withdrawn) return { ok: false, why: '上游被撤，中游没标失效' };
    if (down.state !== m.PG_STATES.withdrawn) return { ok: false, why: '失效没沿悬空边传到下游（成了莫名悬空）' };
    return { ok: true, why: '' };
}

/** R-X2-⑦ 同一传闻三平台转述只算**一条**来源链（走 context-compose 的同一份口径）。 */
function jChainMergeThreePlatforms(m) {
    const mk = (id, platform) => ({ kind: 'material', label: '转述 ' + id, scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: id }, platform: platform, retellOf: 'weibo:n1' });
    const g = m.buildProvenanceGraph({
        scope: SC,
        nodes: [mk('a', 'weibo'), mk('b', 'lofter'), mk('c', 'pixiv')],
        readSources: ['material']
    });
    if (g.counts.retoldChains !== 1) return { ok: false, why: '三平台转述应归一条链，实测 ' + g.counts.retoldChains };
    const chain = Array.isArray(g.chains) ? g.chains[0] : null;
    if (!chain || chain.count !== 3) return { ok: false, why: '链里应含 3 条：' + JSON.stringify(chain) };
    return { ok: true, why: '' };
}

/** R-X2-⑧ 总述三态不许压平：未取数 / 零条 / N 条，三句话不同形。 */
function jSummaryTriad(m) {
    const none = m.pgSummaryLine(null);
    const zero = m.pgSummaryLine(m.buildProvenanceGraph({
        scope: SC, readSources: ['event', 'character', 'trade', 'material', 'floor']
    }));
    const some = m.pgSummaryLine(m.buildProvenanceGraph({
        scope: SC, nodes: [{ kind: 'event', sourceId: 'calendar:m1:work', scope: SC }], readSources: ['event']
    }));
    if (new Set([none, zero, some]).size !== 3) return { ok: false, why: '三态总述同形：' + JSON.stringify([none, zero, some]) };
    if (!/读不到/.test(none)) return { ok: false, why: '未取数须说读不到：' + none };
    if (!/本机还没有可展示的来源关系/.test(zero)) return { ok: false, why: '零条须与未取数不同形：' + zero };
    if (!/节点 1/.test(some)) return { ok: false, why: '有读数须报分列计数：' + some };
    return { ok: true, why: '' };
}

/** R-X2-⑨ 行面四态互不同形：没图 / 没身份 / 不在图 / 被隔离 / 命中，各说各的话。 */
function jRowFaceStates(m) {
    const g = m.buildProvenanceGraph({
        scope: SC, nodes: [{ kind: 'trade', label: '费用', scope: SC, ref: REF_TRADE }], readSources: ['trade']
    });
    const noGraph = m.pgRowFace(null, REF_TRADE);
    const noKey = m.pgRowFace(g, null);
    const miss = m.pgRowFace(g, { appId: 'traveldesk', kind: 'expense', id: 'zzz' });
    const hit = m.pgRowFace(g, REF_TRADE);
    if (noGraph.why !== 'no-graph') return { ok: false, why: '没图应报 no-graph：' + noGraph.why };
    if (noKey.why !== 'no-key') return { ok: false, why: '没身份应报 no-key：' + noKey.why };
    if (miss.why !== 'not-in-graph') return { ok: false, why: '不在图上应报 not-in-graph：' + miss.why };
    if (hit.found !== true || !hit.line) return { ok: false, why: '命中应给出 line：' + JSON.stringify(hit) };
    const gb = m.buildProvenanceGraph({
        scope: SC,
        nodes: [{ kind: 'trade', label: '别段费用', scope: SC, ref: REF_TRADE },
            { kind: 'trade', label: '别处', scope: { chatId: 'c9', branchKey: '' }, ref: { appId: 'traveldesk', kind: 'expense', id: 'e9' } }],
        readSources: ['trade']
    });
    const blocked = m.pgRowFace(gb, { appId: 'traveldesk', kind: 'expense', id: 'e9' });
    if (blocked.why !== 'blocked') return { ok: false, why: '被隔离的行应报 blocked：' + blocked.why };
    if (!blocked.note) return { ok: false, why: 'blocked 必须带原因' };
    if (JSON.stringify(blocked).indexOf('别处') >= 0) return { ok: false, why: 'blocked 壳里带了内容' };
    if (new Set([noGraph.why, noKey.why, miss.why, blocked.why, 'hit']).size !== 5) {
        return { ok: false, why: '四态与命中出现同形' };
    }
    return { ok: true, why: '' };
}

/** R-X2-⑩ 名实一致：角色不可长期定位 / 交易可跳 / 角色跳不过去但有替代定位。 */
function jIdentityHonest(m) {
    if (m.PG_NODE_KINDS.character.durable !== false) return { ok: false, why: '角色被标成了可长期定位（同名异人会串）' };
    for (const k of ['event', 'trade', 'material', 'floor']) {
        if (m.PG_NODE_KINDS[k].durable !== true) return { ok: false, why: k + ' 应可长期定位' };
    }
    if (m.pgRefOf({ name: '甲' }, 'character').durable === true) return { ok: false, why: '角色名竟判可长期定位' };
    if (m.pgRefOf({ ref: { appId: 'traveldesk', kind: 'expense', id: '' } }, 'trade').ok === true) {
        return { ok: false, why: '空 id 竟判成立（归一口径恒真）' };
    }
    const tradeNode = { kind: 'trade', durable: true, ref: { kind: 'expense', id: 'e1' } };
    const jump = m.pgJumpOf(tradeNode);
    if (jump.ok !== true || jump.appId !== 'traveldesk') return { ok: false, why: '交易应能跳到 traveldesk：' + JSON.stringify(jump) };
    const charJump = m.pgJumpOf({ kind: 'character', durable: false, ref: { kind: 'character', id: '甲' } });
    if (charJump.ok !== false) return { ok: false, why: '角色不该判可跳' };
    if (charJump.why !== m.PG_JUMP_REASONS.NOT_DURABLE) return { ok: false, why: '归因错：' + charJump.why };
    if (!charJump.alt) return { ok: false, why: '跳不过去必须给可执行的替代定位（验收②）' };
    return { ok: true, why: '' };
}

/** R-X2-⑪ 自检真 + 假两侧都跑（只跑通真的一侧 = 恒真判据也能全绿）。 */
function jSelfCheckBothSides(m) {
    const self = m.provenanceSelfCheck();
    if (!Array.isArray(self.problems)) return { ok: false, why: '自检没给 problems' };
    if (self.problems.length) return { ok: false, why: '自检报了问题：' + self.problems.join(' · ') };
    const t = m.PG_REF_REASONS, j = m.PG_JUMP_REASONS, b = m.PG_BLOCK_REASONS;
    if (new Set([t.NO_REF, t.BAD_SHAPE, t.NOT_DURABLE, t.TABLE_MISS]).size !== 4) return { ok: false, why: '身份归因词重复' };
    if (new Set([j.NO_REF, j.NOT_DURABLE, j.NO_APP_TARGET, j.KIND_NOT_REGISTERED]).size !== 4) return { ok: false, why: '跳转归因词重复' };
    if (new Set([b.CROSS_SCOPE, b.CROSS_SCOPE_EDGE, b.NOT_VISIBLE]).size !== 3) return { ok: false, why: '隔离归因词重复' };
    return { ok: true, why: '' };
}

const CRITERIA = [jCrossScopeShellOnly, jFailClosedNoChatId, jNotReadIsNotGone, jDeclaredReadBeatsReadSet,
    jWithdrawnLeavesTombstone, jWithdrawViaDangling, jChainMergeThreePlatforms, jSummaryTriad,
    jRowFaceStates, jIdentityHonest, jSelfCheckBothSides];

/* ================== A 结构面 ================== */

test('v3860 A1. 来源链真源在场：五类节点 / 四类边 / 三态 / 三张归因表 / 十七个出口齐备', () => {
    assert.ok(fs.existsSync(path.join(ROOT, M_PG)), '真源必须在场：' + M_PG);
    const src = read(M_PG);
    for (const name of ['PG_NODE_KINDS', 'PG_EDGE_KINDS', 'PG_STATES', 'PG_REF_REASONS', 'PG_JUMP_REASONS',
        'PG_BLOCK_REASONS', 'pgScopeOf', 'pgSameScope', 'pgKeyOf', 'pgRefOf', 'pgJumpOf', 'buildProvenanceGraph',
        'pgChainOf', 'pgNodeLine', 'pgSummaryLine', 'pgRowFace', 'provenanceSelfCheck']) {
        assert.ok(new RegExp('export (function |const )?' + name + '\\b').test(src),
            M_PG + ' 缺导出：' + name);
    }
    assert.equal(Object.keys(PG.PG_NODE_KINDS).length, 5, '五类节点：事件 / 角色 / 交易 / 素材 / 楼层');
    assert.equal(Object.keys(PG.PG_EDGE_KINDS).length, 4, '四类边：来源 / 派生 / 转述 / 引用');
    assert.equal(Object.keys(PG.PG_STATES).length, 3, '三态：live / withdrawn / dangling');
    for (const k of Object.keys(PG.PG_NODE_KINDS)) {
        const rec = PG.PG_NODE_KINDS[k];
        assert.ok(rec.label && rec.icon && typeof rec.durable === 'boolean', k + ' 登记不全');
    }
    /* 名实一致：只有角色是「不可长期定位」的那一类。 */
    assert.equal(PG.PG_NODE_KINDS.character.durable, false, '角色名不是全局唯一（同名异人）');
    /* 三态必须三个不同的字面量（不许两态同值）。 */
    assert.equal(new Set(Object.values(PG.PG_STATES)).size, 3, '三态出现同值');
    /* 四类边里「转述」与「来源」必须不同形（同一传闻三平台转述只算一条来源链）。 */
    assert.notEqual(PG.PG_EDGE_KINDS.retell.label, PG.PG_EDGE_KINDS.source.label);
});

test('v3860 A2. 本层是纯函数：不摸宿主、不写存储、不引第二份口径；派生面枚举面未命中', () => {
    const src = read(M_PG);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(',
        '.setItem(', 'storage.']) {
        assert.ok(!code.includes(bad), '本模块不许出现 ' + bad + '（不持存储、不带计时器、不碰 DOM）');
    }
    /* 引的四样都是既有唯一口径（取数门 / 靶心协议 / 转述链 / 可见性）。 */
    for (const imp of [
        "import { numOrNull } from './num-gate.js'",
        "import { normalizeOpenRef, kindAppOf, OPEN_REF_REASONS } from './open-ref.js'",
        "import { retellChains } from './context-compose.js'",
        "import { knowledgeCheck } from './social-knowledge-bridge.js'"
    ]) assert.ok(src.includes(imp), M_PG + ' 缺导入：' + imp);
    /* 可见性**不写第二份**：本件不许自己实现 visibleTo（那是 X5 的职责）。 */
    assert.ok(!code.includes('visibleTo'), '可见性判定必须转交 X5，不许写第二份');
    /* 派生面枚举面：本件不得在同一行同时出现「源身份字段 + 集合操作」
     *   （命中即须在 source-derivation LEDGER 登记 —— 实测未命中，此处就地复算守住）。 */
    const ops = ['.filter(', '.find(', '.findIndex(', '.some(', '.map(', '.flatMap(', '.reduce(', '.unshift(', '.push('];
    const hit = code.split(String.fromCharCode(10)).filter((l) => (l.includes('sourceId') || l.includes('sourceKey') || l.includes('commitmentSourceId'))
        && ops.some((o) => l.includes(o)));
    assert.deepEqual(hit, [], '若命中派生面枚举面，必须先在 ' + S_DERIV + ' 登记：\n' + hit.join('\n'));
});

/* ================== B 行为面 ================== */

test('v3860 B1. 十一条判据在同源上一次通过（跨段 / fail-closed / 读不到 / 声明读 / 墓碑 / 悬空传播 / 转述链 / 三态 / 行面 / 名实 / 自检）', () => {
    const failures = [];
    for (const fn of CRITERIA) {
        let r;
        try { r = fn(PG); } catch (e) { r = { ok: false, why: '判据抛错：' + String((e && e.message) || e) }; }
        if (!r || r.ok !== true) failures.push(fn.name + ' -> ' + String((r && r.why) || '无返回'));
    }
    assert.deepEqual(failures, [], '判据未全过：\n' + failures.join('\n'));
});

test('v3860 B2. 读不到 ≠ 没有：五类源全缺记五条 not-read gap；读了确实空不记 gap', () => {
    const all = PG.buildProvenanceGraph({ scope: SC });
    assert.equal(all.gaps.length, 5, '五类源全缺应有 5 条 gap，实测 ' + all.gaps.length);
    for (const g of all.gaps) assert.equal(g.reason, 'not-read', '缺源应记 not-read：' + g.reason);
    const readEmpty = PG.buildProvenanceGraph({ scope: SC, readSources: ['trade'] });
    assert.ok(!readEmpty.gaps.some((g) => g.source === 'trade'), '读了确实是空，却被记成没读到');
    assert.ok(readEmpty.gaps.some((g) => g.source === 'material'), '没读的源仍须记 gap');
});

test('v3860 B3. 未登记的 kind 记 gap、不硬塞进图（认不出就不猜）', () => {
    const g = PG.buildProvenanceGraph({
        scope: SC, nodes: [{ kind: 'unknown-thing', label: 'x', scope: SC }], readSources: ['event']
    });
    assert.equal(g.counts.nodes, 0, '未登记的 kind 不许进图');
    assert.ok(g.gaps.some((x) => x.reason === 'unknown-kind'), '未登记的 kind 必须记 unknown-kind gap');
});

test('v3860 B4. 按内容去重：同 key 的节点第二次出现直接跳过，绝不覆盖', () => {
    const g = PG.buildProvenanceGraph({
        scope: SC,
        nodes: [
            { kind: 'trade', label: '先来的', scope: SC, ref: REF_TRADE },
            { kind: 'trade', label: '后来的', scope: SC, ref: REF_TRADE }
        ],
        readSources: ['trade']
    });
    assert.equal(g.counts.nodes, 1, '同 key 应只留一条');
    assert.equal(g.nodes[0].label, '先来的', '后一条不许盖到前一条上（按内容去重、绝不覆盖）');
});

test('v3860 B5. 链回溯带环保护：互相转述不许把回溯打死', () => {
    const g = PG.buildProvenanceGraph({
        scope: SC,
        nodes: [
            { kind: 'material', label: 'A', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'a' }, via: 'novel:b' },
            { kind: 'material', label: 'B', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'b' }, via: 'novel:a' }
        ],
        readSources: ['material']
    });
    const c = PG.pgChainOf(g, 'novel:a');
    assert.equal(c.ok, true, '环上的链仍须能回溯：' + JSON.stringify(c));
    assert.ok(c.rows.every((r) => r.cycle !== true || r.key), '环标记必须落在具名节点上');
    assert.equal(PG.pgChainOf(g, 'novel:zzz').ok, false, '图里没有的节点须如实回报 no-such-node');
});

/* ================== C 接线面（真跑内核链 + 读真源码） ================== */

test('v3860 C1. 咽喉接线：导入 / 刷新 / 跳转 / 挂载四处都在', () => {
    const idx = read(IDX);
    const flat = idx.replace(/\s+/g, '');
    assert.ok(flat.includes("import{buildProvenanceGraph,pgSummaryLine,pgRowFace,provenanceSelfCheck}from'./config/provenance-graph.js'"),
        '咽喉必须引内核真源');
    assert.ok(flat.includes("functionrefreshProvenanceGraph()"), '刷新函数必须在场');
    assert.ok(idx.includes('applyProvenanceJump: applyProvenanceJump,'), '跳转必须挂上唯一出口');
    /* 五类取数各在一个独立 try/catch 里 —— 读不到就**不声明读过**（不 push 进 readSources）。 */
    for (const s of ['event', 'character', 'trade', 'material', 'floor']) {
        assert.ok(idx.includes("readSources.push('" + s + "')"), '五源须各声明一次读过：' + s);
    }
    assert.ok(idx.includes('_provenanceCache = graph;'), '读数必须挂到唯一缓存口');
    assert.ok(idx.includes('_provenanceLine = pgSummaryLine(graph);'), '总述必须同轮算好（视图不自算）');
    /* 跳转沿用 X2 的靶心载荷，不另造派发链。 */
    /* [v3.87.0 交棒改写] 派发侧收归到契约单源 makePhoneEvent（v2.41 纪律）：旧断言钉的是手写
     *   new CustomEvent('phone:openApp', ...) 形，那一形会让 v226 契约对账与 v241 手写字面量判据转红；
     *   本步修正后，断言改钉「契约单源 + 靶心载荷」这一实质。 */
    assert.ok(idx.includes("makePhoneEvent(PHONE_EVENTS.OPEN_APP,") && idx.includes("buildOpenDetail(jump.appId, null, jump.ref)"), '跳转必须走唯一一支笔（契约单源 + 靶心）');
});

test('v3860 C2. 刷新点排在日历早退之前 —— 否则与剧情时间无关的两类源永远看不到', () => {
    const idx = read(IDX);
    const at = idx.indexOf('async function checkCalendarScheduleReminders(');
    assert.ok(at > 0, '日历权威函数必须在场');
    const refreshAt = idx.indexOf('refreshProvenanceGraph();', at);
    const earlyAt = idx.indexOf('if (!storage) return;', at);
    assert.ok(refreshAt > 0, '刷新必须在这个函数里被调用');
    assert.ok(earlyAt > refreshAt, '刷新点必须排在早退之前（跟着早退会被一起吞掉）');
    assert.ok(!idx.includes('await refreshProvenanceGraph()'), '刷新不许 await（不挡日历链）');
});

test('v3860 C3. 诊断协议面纯渲染：只读宿主缓存与内核口径，不自己查图、不自己拼归因', () => {
    const data = read(D_DATA);
    assert.ok(data.includes('const provenanceFace = (() => {'), '诊断内核必须取这一面');
    assert.ok(data.includes('vp._provenanceCache'), '诊断面必须从宿主缓存取数');
    assert.ok(data.includes('vp._provenanceLine'), '诊断面必须读同轮算好的总述');
    assert.ok(data.includes("import { provenanceSelfCheck, pgSummaryLine, PG_NODE_KINDS, PG_EDGE_KINDS, PG_STATES, PG_BLOCK_REASONS } from '../../config/provenance-graph.js'"),
        '协议口径必须来自内核，不许在诊断内核里抄第二份');
    assert.ok(data.includes('provenanceFace, scheduleFace,'), '必须收进返回值（不挂上去就没人看得见）');
    assert.ok(data.includes('export function provenanceFaceText(face) {'), '面文案的唯一实现在内核文件里');
    /* 三态不许压平：未取数 / 图未跑 / 有读数，三种话不同形。 */
    assert.ok(data.includes('尚未取数'), '图未跑必须说「尚未取数」');
    assert.ok(data.includes('这不是「本机没有来源关系」'), '降级话必须点明「这不是没有来源关系」');
    const view = read(D_VIEW);
    assert.ok(view.includes('_provenanceHtml(pkg) {'), '诊断视图必须有这张卡');
    assert.ok(view.includes("this._provenanceHtml(pkg) + '</section>')"), '这张卡必须真被推进页面');
    assert.ok(!view.includes("from '../../config/provenance-graph.js'"), '视图不许直连内核（走 diagnose-data 的转发）');
});

test('v3860 C4. 搜索行面纯渲染：只在图上有这一条时才加一行，没图不说话', () => {
    const view = read(A_SEARCH);
    assert.ok(view.includes("import { pgRowFace } from '../../config/provenance-graph.js'"), '行面口径必须来自内核');
    assert.ok(view.includes('_provRowHtml(ref) {'), '行面读数必须由本件排版');
    assert.ok(view.includes("face.why === 'no-graph') return ''"), '图没跑就不说话（既不夸也不冤）');
    assert.ok(view.includes('来源链：'), '命中时须把来源链读数摆出来');
    assert.ok(view.includes('替代定位'), '跳不过去时须把替代定位一起摆出来');
    assert.ok(!view.includes('PG_STATES'), '视图不许自己判三态（那是内核的活）');
    const app = read(A_SEARCH_APP);
    assert.ok(app.includes('.gs-prov'), '样式缺：.gs-prov');
    assert.ok(app.includes('.gs-prov-warn'), '样式缺：.gs-prov-warn');
});

test('v3860 C5. 真跑内核链（照咽喉的取数口径复刻）：五源归一 + 名实 + 跳转', () => {
    /* 照 index.js 的 refreshProvenanceGraph 复刻一份取数口径（桩数据，不跑真页面）。 */
    const taken = ['event', 'character', 'trade', 'material', 'floor'];
    const nodes = [
        { kind: 'event', sourceId: 'calendar:m1:work', label: '取快递', scope: SC, via: 'calendar:m1', derived: true },
        { kind: 'character', name: '甲', label: '甲', scope: SC },
        { kind: 'trade', label: '车票', scope: SC, ref: REF_TRADE },
        { kind: 'material', label: '转述帖', scope: SC, ref: { appId: 'pixiv', kind: 'novel', id: 'n1' }, platform: 'weibo', retellOf: 'weibo:n1' },
        { kind: 'floor', floor: 12, label: '第 12 楼', scope: SC }
    ];
    const g = PG.buildProvenanceGraph({ nodes: nodes, readSources: taken, scope: SC, nowMs: Date.now() });
    assert.equal(g.counts.nodes, 5, '五源各一条应进图 5 条，实测 ' + g.counts.nodes);
    assert.equal(g.counts.gaps, 0, '五源都读了，不该有 gap');
    assert.equal(g.counts.notDurable, 1, '角色那条应被标「不可长期定位」（同名异人）');
    assert.equal(g.counts.derived, 1, '生活事件是派生读数，必须标出来');
    /* 角色那条：跳不过去，但必须带回可执行的替代定位。 */
    const charNode = g.nodes.filter((n) => n.kind === 'character')[0];
    const jj = PG.pgJumpOf(charNode);
    assert.equal(jj.ok, false);
    assert.ok(jj.alt, '替代定位必须在场（验收②）');
    /* 交易那条：能跳到 traveldesk 并落在这一条上。 */
    const tradeNode = g.nodes.filter((n) => n.kind === 'trade')[0];
    const tj = PG.pgJumpOf(tradeNode);
    assert.equal(tj.ok, true);
    assert.equal(tj.appId, 'traveldesk');
    assert.equal(tj.ref.id, 'e1');
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

test('v3860 D1. 撤回判定改用 readSet（图里有同 kind 的一条就算读过）⇒ 声明读判据必须转红', async () => {
    /* 破坏点选**与判据粒度严丝合缝**的那一处：本模块最该守的是「读不到 ≠ 没有」，
     *   把 declaredRead 换成 readSet 正是把「部分看见」当「看全了」的那一手。 */
    const neg = await negCopy(M_PG, (s) => {
        const anchor = 'if (!declaredRead.has(upKind)) continue;';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, 'if (!readSet.has(upKind)) continue;');
    });
    const r = jDeclaredReadBeatsReadSet(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
    assert.ok(/同 kind|部分|判了撤/.test(String(r.why)), '转红的理由必须指向被破坏的那条语义：' + r.why);
});

test('v3860 D2. 拿不到会话身份也判同一段（去掉 fail-closed）⇒ 隔离判据必须转红', async () => {
    const neg = await negCopy(M_PG, (s) => {
        const anchor = '    if (!x.chatId || !y.chatId) return false;\n';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = jFailClosedNoChatId(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3860 D3. 角色被标成可长期定位（同名异人串味）⇒ 名实一致判据必须转红', async () => {
    const neg = await negCopy(M_PG, (s) => {
        const anchor = "character: Object.freeze({ label: '角色', icon: '👤', durable: false,";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, "character: Object.freeze({ label: '角色', icon: '👤', durable: true,");
    });
    const r = jIdentityHonest(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3860 D4. 行面把「被隔离」与「不在图」压成一格 ⇒ 行面判据必须转红', async () => {
    const neg = await negCopy(M_PG, (s) => {
        const anchor = "        if (hit) return { found: false, why: 'blocked', node: null, line: '', chain: null, jump: null, note: String(hit.reason || ''), blockReason: String(hit.reason || '') };\n";
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '');
    });
    const r = jRowFaceStates(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3860 D5. 墓碑不立（上游读过却不在场时静默消失）⇒ 墓碑判据必须转红', async () => {
    const neg = await negCopy(M_PG, (s) => {
        const anchor = '            nodes.push(tomb);\n';
        assert.equal(s.split(anchor).length - 1, 1, '负控制锚点字面量必须恰中 1 次');
        return s.replace(anchor, '            if (false) nodes.push(tomb);\n');
    });
    const r = jWithdrawnLeavesTombstone(neg);
    assert.equal(r.ok, false, '破坏副本上该判据必须转红，实际未转红：' + JSON.stringify(r));
});

test('v3860 D6. 负控制自身可证伪：破坏副本必须真被加载且与原版不同源', async () => {
    /* 若破坏没落到副本上（或落到别处），前面的 D1~D5 就全是假绿。 */
    const neg = await negCopy(M_PG, (s) => s.replace(
        'export function pgSummaryLine(graph) {',
        'export function pgSummaryLine(graph) { if (!graph) return "来源链：负控制探针";'
    ));
    assert.equal(neg.pgSummaryLine(null), '来源链：负控制探针', '破坏副本必须真的被加载且可跑');
    assert.notEqual(neg.pgSummaryLine(null), PG.pgSummaryLine(null), '破坏副本不得与真源同源');
    /* 第二向：破坏副本里同款判据仍须可跑（不然测的是加载失败，不是判据）。 */
    const r = jCrossScopeShellOnly(neg);
    assert.equal(r.ok, true, '未触及的那条判据在破坏副本上仍须成立（否则破坏过界）：' + JSON.stringify(r));
});

/* ================== E 版本锚（下限形） ================== */

test('v3860 E1. 版本锚（下限形）：五源同源且不低于 3.86.0', () => {
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
    assert.ok(cmp(nums[0], '3.86.0') >= 0, '版本不得低于 3.86.0（本版是它的落地版）：' + nums[0]);
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
    /* 公告块与当版条目同源（App 内「本版更新」弹窗读的就是它）。 */
    const block = idx.slice(idx.indexOf('const ST_PHONE_CURRENT_UPDATE = {'));
    for (const it of entry.items) {
        assert.ok(block.includes(JSON.stringify(it)), '公告块缺当版条目：' + String(it).slice(0, 24));
    }
});
