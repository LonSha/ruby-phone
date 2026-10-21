/* ============================================================
 * tests/system-v4450.test.mjs -- [v4.45.0 · 第五期 R5-O1 取材板真正交给草稿或下一次主聊天]
 *
 * 验收口径（计划原文 R5-O1）：
 *   「选择『加入创作草稿』或『用于下一次主聊天』，预览内容后交给原 owner；
 *     成功显示目标与可打开结果，失败保留选择并允许重试。
 *     发送主聊天必须另行显式确认，取材板不自行生成或发消息。」
 *   验收旅程：「正常取材→选两条→交给草稿→打开目标看到来源和内容；主聊天预览不发送，
 *     确认后实际请求含材料；连点不重复插入；目标缺席不报成功。」
 *   不做：「不把返回对象、toast 或自检绿灯当交接；不自动发布。」
 *
 * 【本件治的缺陷形态（读码可复算，不是报错）】
 *   `creationdesk-view.js:316-318` 的按钮只调 `boardHandoff()`；
 *   `creationdesk-app.js:315-318` 返回 `this._board.handoff()` —— 那份读数里只有
 *   `handoff: { composeOwner: 'context-compose', budgetOwner: 'injection-router',
 *               draftOwner: 'creation-pipeline' }`，**三个字符串**。
 *   谁都没被调用、一个字节都没落笔，而按钮点下去界面看起来像交过去了。
 *   计划原文点名：「owner 字符串不是实际交接」——本仓反复治过的「看起来没坏但显示不对」。
 *
 * 【本件判什么（六组）】
 *   A 口径：契约件纯函数零副作用 / 五态与两去向唯一出处 / 两套来源词表不冒充 /
 *          上限唯一出处 / 视图与 App 不自持第二份状态表
 *   B 契约件内核：合法归一 / 四态拒收（非对象·缺去向·去向不认识·一条没选）/
 *               认不出出处**整单拒收**（不静默丢那一条）/ 引用集幂等键 /
 *               去重限量 / 正文可回源 / 五态互不同形 / 自检真跑
 *   C 两键读写件：登记→读回→取用即清 / 同一份再登记报 replayed 不重复插 /
 *               超上限丢最旧 / 坏存储降级不抛 / 自检真跑
 *   D 宿主落笔：草稿落进既有草稿本（写后回读）/ 重复不双插 / 主聊天只登记不发送 /
 *               目标缺席不报成功 / 缺材料整单拒收
 *   E 接线：视图两个真去向按钮 + 预览按钮 / App 经宿主出口 / 样式双侧投递 /
 *          不做面可判（无发布、无网络、无自动生成）
 *   F 负控制 + 版本锚：真源码副本定点破坏 ⇒ 同款判据必转红；六源同源
 *
 * 【为什么负控制破坏副本而不是原仓】见 tests/system-v4120.test.mjs 档头（同规）。
 * 【为什么「登记」与「已发送」必须分开判】把登记读成已发是本项最该防的谎报。
 * ========================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KERNEL_REL = 'config/material-board-handoff.js';
const STORE_REL = 'apps/creationdesk/board-chat-store.js';
const APP_REL = 'apps/creationdesk/creationdesk-app.js';
const VIEW_REL = 'apps/creationdesk/creationdesk-view.js';
const HOST_REL = 'index.js';
const NL = '\n';
const countOf = (s, sub) => s.split(sub).length - 1;
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL).filter((l) => !/^\s*\/\//.test(l)).join(NL);

const K = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);
const ST = await import(pathToFileURL(path.join(ROOT, STORE_REL)).href);

const kernelSrc = read(KERNEL_REL);
const kernelCode = stripComments(kernelSrc);
const storeSrc = read(STORE_REL);
const appSrc = read(APP_REL);
const viewSrc = read(VIEW_REL);
const hostSrc = read(HOST_REL);

/** 内存假存储（与真 `storage` 同形的三出口）。 */
function mkStorage(seed = {}) {
    const bag = new Map(Object.entries(seed));
    return {
        _bag: bag,
        get: (k, d) => (bag.has(k) ? bag.get(k) : (d === undefined ? null : d)),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); }
    };
}

const ITEM = (id, extra = {}) => Object.assign({
    id: id, source: 'continuity', facet: 'sharedPast', facetLabel: '共同往事',
    title: '第 ' + id + ' 条', floor: 10
}, extra);

/* ══════════ A ── 口径 ══════════ */
test('A1 契约件是纯函数：零 DOM / 零存储 / 零网络 / 零时钟', () => {
    for (const bad of ['document', 'window', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest',
        'setTimeout', 'setInterval', 'querySelector', 'Date.now', 'Math.random']) {
        assert.equal(kernelCode.indexOf(bad), -1, '交接契约件不得出现：' + bad);
    }
    assert.equal(kernelCode.indexOf('storage'), -1, '契约件不得摸存储（落笔是 owner 的事）');
});

test('A2 五态与两去向的唯一出处：视图与 App 不自持第二份状态表', () => {
    for (const s of ['drafted', 'replayed', 'pending', 'failed', 'unreceived']) {
        assert.equal(kernelCode.split("'" + s + "'").length - 1, 1,
            '状态字面量必须只出现一次（唯一出处）：' + s);
    }
    /* 视图一个状态字面量都不许有（它只转发）。 */
    const viewCode = stripComments(viewSrc);
    for (const s of ['drafted', 'replayed', 'unreceived']) {
        assert.equal(viewCode.indexOf("'" + s + "'"), -1, '视图不得自持状态字面量：' + s);
    }
    /* App 侧只许引用契约件常量。**靶子收窄到交接状态**：
     *   `creationdesk-app.js` 是 600 行的既有 App，里面有一处 `r.state === 'saved'`
     *   （编辑缓冲的保存回执，与取材板交接无关）—— 拿裸 `state === '` 当靶子会把它判红。 */
    const appCode = stripComments(appSrc);
    for (const s of ['drafted', 'replayed', 'pending', 'unreceived']) {
        assert.equal(appCode.indexOf("'" + s + "'"), -1, 'App 不得自持交接状态字面量：' + s);
    }
    assert.ok(appCode.indexOf('MBH_STATES') >= 0 || appCode.indexOf('board-chat-store') >= 0
        || appCode.indexOf('material-board-handoff') >= 0, 'App 必须委派契约件 / 读写件');
});

test('A3 ★ 两套来源词表不冒充：记忆事实不是 App 内容', () => {
    /* 取材板来源（记忆事实）与 creation-pipeline 的 App 内容来源**不同字**。 */
    const appSources = ['musicdesk', 'stickerdesk', 'soundkit', 'pixiv', 'lofter', 'magazine', 'pvdesk', 'doujin'];
    assert.equal(appSources.indexOf(K.MBH_DRAFT_SOURCE), -1,
        '草稿来源标识不得冒用 App 内容来源：' + K.MBH_DRAFT_SOURCE);
    /* 宿主落草稿时必须如实带这个标识（拿记忆来源名冒充 App 内容会让同一问题出现两套答案）。 */
    const hostCode = stripComments(hostSrc);
    assert.ok(hostCode.indexOf('MBH_DRAFT_SOURCE') >= 0, '宿主落草稿必须带本板的来源标识');
    assert.ok(hostCode.indexOf('sourceKind') >= 0 || kernelCode.indexOf('memory-fact') >= 0,
        '必须如实标注这是记忆事实（不是 App 内容）');
});

test('A4 上限与键名的唯一出处：视图不自己拟条数，键命中 ^cw_', () => {
    const L = K.MBH_LIMITS;
    for (const f of ['items', 'title', 'note', 'tags', 'pending', 'key']) {
        assert.ok(Number(L[f]) > 0, '上限表缺项：' + f);
    }
    for (const k of Object.values(K.MBH_KEYS)) {
        assert.ok(/^cw_/.test(k), '键必须命中 ^cw_（随会话隔离）：' + k);
    }
    /* 视图不得把条数上限当数用（应问契约件 / App）。 */
    assert.equal(new RegExp('(?<![\\w"=])' + L.items + '(?![\\w"])').test(stripComments(viewSrc)), false,
        '视图不得出现材料条数上限数字（应问契约件）');
});

/* ══════════ B ── 契约件内核 ══════════ */
test('B1 合法归一：引用形如 <来源>:<id>、去重限量、正文可回源', () => {
    const n = K.normalizeHandoff({
        target: 'draft', task: 'reunion', asOf: 120,
        items: [ITEM('f1'), ITEM('f2'), ITEM('f2')]
    });
    assert.equal(n.ok, true);
    assert.equal(n.target, 'draft');
    assert.deepEqual(n.refs, ['continuity:f1', 'continuity:f2'], '引用去重且形如 <来源>:<id>');
    assert.equal(n.items.length, 2, '同一引用不得重复收');
    assert.ok(n.note.indexOf('continuity') >= 0, '正文必须可回源（带出处）');
    assert.ok(n.key.indexOf('mbh:draft:') === 0, '幂等键必须由去向 + 任务 + 引用集派生');
    /* 超上限截断（不无限搬）。 */
    const many = K.normalizeHandoff({
        target: 'chat',
        items: Array.from({ length: K.MBH_LIMITS.items + 8 }, (_, i) => ITEM('m' + i))
    });
    assert.equal(many.items.length, K.MBH_LIMITS.items, '材料条数必须限量');
});

test('B2 四态拒收各带归因词：非对象 / 缺去向 / 去向不认识 / 一条没选', () => {
    const R = K.MBH_REASONS;
    assert.equal(K.normalizeHandoff(null).why, R.NOT_OBJECT);
    assert.equal(K.normalizeHandoff('x').why, R.NOT_OBJECT);
    assert.equal(K.normalizeHandoff({ items: [ITEM('a')] }).why, R.NO_TARGET);
    assert.equal(K.normalizeHandoff({ target: 'publish', items: [ITEM('a')] }).why, R.BAD_TARGET);
    assert.equal(K.normalizeHandoff({ target: 'draft', items: [] }).why, R.NO_PICK);
    const words = [R.NOT_OBJECT, R.NO_TARGET, R.BAD_TARGET, R.NO_PICK, R.NO_REF];
    assert.equal(new Set(words).size, words.length, '归因词必须互不同形');
    for (const w of words) assert.ok(String(w).length > 0, '归因词不得为空');
});

test('B3 ★ 认不出出处**整单拒收**且被拒者具名（不许静默丢那一条）', () => {
    const r = K.normalizeHandoff({
        target: 'draft',
        items: [ITEM('ok1'), { source: 'lore', title: '没有 id 的那条' }]
    });
    assert.equal(r.ok, false, '选中里有没有出处的必须整单拒收（丢一条而报成功就是谎报）');
    assert.equal(r.why, K.MBH_REASONS.NO_REF);
    assert.ok(Array.isArray(r.unrefused) && r.unrefused.length >= 1, '被拒的那一条要具名');
});

test('B4 幂等键按引用集派生：同一份选定恒同键，与「点了几次」无关', () => {
    const a = K.normalizeHandoff({ target: 'draft', task: 'meet', items: [ITEM('x'), ITEM('y')] });
    const b = K.normalizeHandoff({ target: 'draft', task: 'meet', items: [ITEM('y'), ITEM('x')] });
    assert.equal(a.key, b.key, '同一份选定（顺序不同）必须恒同键');
    const c = K.normalizeHandoff({ target: 'chat', task: 'meet', items: [ITEM('x'), ITEM('y')] });
    assert.notEqual(a.key, c.key, '去向不同必须不同键（两条路各落各的）');
    const d = K.normalizeHandoff({ target: 'draft', task: 'meet', items: [ITEM('x')] });
    assert.notEqual(a.key, d.key, '选定不同必须不同键');
});

test('B5 五态读数互不同形，且三处关键口径必须明说', () => {
    const S = K.MBH_STATES;
    const lines = [
        K.handoffLine({ state: S.DRAFTED, count: 2 }),
        K.handoffLine({ state: S.REPLAYED }),
        K.handoffLine({ state: S.PENDING, count: 2 }),
        K.handoffLine({ state: S.FAILED, why: K.MBH_REASONS.NO_PICK }),
        K.handoffLine({ state: S.UNRECEIVED })
    ];
    assert.equal(new Set(lines).size, lines.length, '五态读数不得有同形的');
    assert.ok(lines[0].indexOf('已加入创作草稿') >= 0, 'drafted 必须明说已加入草稿');
    assert.ok(lines[2].indexOf('还没发送') >= 0, 'pending 必须明说**还没发送**（登记 ≠ 已发）');
    assert.ok(lines[4].indexOf('没有接收者') >= 0, 'unreceived 必须明说没有接收者');
    assert.ok(lines[3].indexOf('留着') >= 0, 'failed 必须点明选择与内容都留着（可重试）');
});

test('B6 契约件自检真跑（不是写「已检查」）：无 problems 且覆盖面在场', () => {
    const r = K.mbhSelfCheck();
    assert.deepEqual(r.problems, [], '契约件自检不得有问题：' + JSON.stringify(r.problems));
    assert.equal(r.states, 5, '五态必须在场');
    assert.equal(r.targets, 2, '两个去向必须在场');
    assert.ok(r.reasons >= 5, '归因词表必须在场');
    /* 纯函数被破坏时自检必须报（真跑一遍入参不变）。 */
    const input = { target: 'draft', items: [ITEM('z')] };
    const snapshot = JSON.stringify(input);
    K.normalizeHandoff(input);
    assert.equal(JSON.stringify(input), snapshot, '归一不得改入参');
});

/* ══════════ C ── 两键读写件 ══════════ */
test('C1 登记 → 读回 → 取用即清（一次登记只喂一次下一次请求）', () => {
    const st = mkStorage();
    const r = ST.receiveHandoff(st, { target: 'chat', task: 'reunion', items: [ITEM('f1')] });
    assert.equal(r.state, K.MBH_STATES.PENDING);
    assert.ok(r.ok, '登记成功');
    const p = ST.pendingHandoff(st);
    assert.equal(p.count, 1);
    assert.equal(p.sent, false, '**登记 ≠ 已发送**：刚登记时 sent 必须是 false');
    const c = ST.consumeHandoff(st);
    assert.equal(c.count, 1, '取用拿到登记');
    assert.equal(ST.pendingHandoff(st), null, '取用后必须清');
    assert.equal(ST.consumeHandoff(st), null, '再取用不得凭空造一份');
});

test('C2 ★ 同一份再登记只报 replayed 且不重复插（连点不重复插入）', () => {
    const st = mkStorage();
    ST.receiveHandoff(st, { target: 'chat', items: [ITEM('f1')] });
    const again = ST.receiveHandoff(st, { target: 'chat', items: [ITEM('f1')] });
    assert.equal(again.state, K.MBH_STATES.REPLAYED);
    assert.equal(ST.appliedKeys(st).length, 1, '台账必须只记一条（幂等键）');
});

test('C3 台账：超上限丢最旧（不静默截断新记录）', () => {
    const st = mkStorage();
    const max = K.MBH_LIMITS.pending;
    for (let i = 0; i < max + 5; i++) {
        ST.receiveHandoff(st, { target: 'chat', items: [ITEM('z' + i)] });
    }
    const keys = ST.appliedKeys(st);
    assert.equal(keys.length, max, '登记必须限量');
    assert.ok(keys[keys.length - 1].indexOf('z' + (max + 4)) >= 0, '最新一条必须在（不得把新记录截掉）');
});

test('C4 坏存储：出口一律降级不抛，且**登记失败不许当成功**', () => {
    const broken = {
        get: () => { throw new Error('x'); },
        set: () => { throw new Error('x'); },
        remove: () => { throw new Error('x'); }
    };
    assert.doesNotThrow(() => {
        assert.equal(ST.pendingHandoff(broken), null);
        assert.equal(ST.consumeHandoff(broken), null);
        assert.deepEqual(ST.appliedKeys(broken), []);
        assert.equal(ST.isApplied(broken, 'k'), false);
        assert.equal(ST.markSent(broken, 'k'), false);
        /* ★ 写不进去必须如实报 failed —— 报 pending 就是「写失败了还说登记好了」。 */
        assert.equal(ST.receiveHandoff(broken, { target: 'chat', items: [ITEM('a')] }).state,
            K.MBH_STATES.FAILED, '坏存储时登记必须如实报 failed');
    });
});

test('C5 两键读写件自检真跑：无 problems 且键在场', () => {
    const r = ST.boardChatStoreSelfCheck();
    assert.deepEqual(r.problems, [], '两键读写自检不得有问题：' + JSON.stringify(r.problems));
    assert.equal(r.keys, 1);
});

/* ══════════ D ── 宿主落笔 ══════════ */
test('D1 ★ 宿主是真落笔方：board 动作在场、走既有草稿写口、写后回读', () => {
    const code = stripComments(hostSrc);
    assert.ok(code.indexOf("action === 'board'") >= 0, '宿主必须有 board 动作分支（修前零消费）');
    assert.ok(code.indexOf("'board'") >= 0 && /CW_ACTION_KEYS = \[[^\]]*'board'/.test(hostSrc),
        'board 必须在动作白名单里（不在白名单则永远走不到）');
    assert.ok(code.indexOf('cwWriteDrafts(') >= 0, '草稿落笔必须走既有写口（不许另写一份）');
    assert.ok(code.indexOf('mbhReceive(storage') >= 0, '主聊天那条必须走两键读写件登记');
    /* 追加不动首项（v4.01.0 判据锁「白名单应以 plan 开头」）。 */
    assert.ok(/CW_ACTION_KEYS = \['plan'/.test(hostSrc), '白名单首项必须仍是 plan（只追加）');
});

test('D2 ★ 主聊天那条只登记、不发送：宿主不构造任何请求', () => {
    const code = stripComments(hostSrc);
    const i = code.indexOf("action === 'board'");
    assert.ok(i > 0, 'board 分支必须在场');
    const block = code.slice(i, i + 3000);
    for (const bad of ['fetch(', 'XMLHttpRequest', 'generateContent', 'sendMessage', 'addMoment']) {
        assert.equal(block.indexOf(bad), -1, 'board 分支不得构造请求 / 发布：' + bad);
    }
    assert.ok(block.indexOf('mbhReceive') >= 0, '主聊天那条只到「登记」');
});

test('D3 ★ 取用与留痕分开：boardChatTake 只取用，markSent 归真发出去之后', () => {
    const code = stripComments(hostSrc);
    assert.ok(code.indexOf('boardChatTake') >= 0, '必须给出主聊天侧取用口');
    assert.ok(code.indexOf('mbhConsume(storage)') >= 0, '取用必须走两键读写件');
    assert.ok(code.indexOf('boardChatMarkSent') >= 0, '必须给出留痕口（真发出去之后）');
    /* 取用口**不得**顺手写 sent（把「带上了」显示成「发出去了」）。 */
    const i = code.indexOf('function boardChatTake');
    const block = code.slice(i, i + 900);
    assert.equal(block.indexOf('markSent'), -1, '取用口不得顺手留痕（取用 ≠ 已发送）');
    assert.ok(block.indexOf('还没发送') >= 0, '取用读数必须明说还没发送');
});

test('D4 ★ 目标缺席不报成功：入口不在位时如实报没有接收者', () => {
    const appCode = stripComments(appSrc);
    const i = appCode.indexOf('async boardCommit');
    assert.ok(i > 0, 'App 必须提供 boardCommit');
    const block = appCode.slice(i, i + 1600);
    assert.ok(block.indexOf('MBH_STATES.UNRECEIVED') >= 0, '入口不在位必须报 unreceived（引用常量，不写字面量）');
    assert.ok(block.indexOf('没有接收者') >= 0, '必须如实说没有接收者（不许报成功）');
    /* 失败**不清选择**（用户改完能重试）。 */
    assert.equal(/boardCommit[\s\S]{0,1600}?clearPicked\(\)/.test(appCode), false,
        '交接失败不得清掉用户的选择（要能重试）');
});

test('D5 视图预览不落笔：预览按钮只调读数，不调落笔口', () => {
    const code = stripComments(viewSrc);
    const i = code.indexOf("querySelectorAll('[data-cw-bhandoff]')");
    assert.ok(i > 0, '预览按钮绑定必须在场');
    const block = code.slice(i, i + 500);
    assert.ok(block.indexOf('boardHandoff()') >= 0, '预览按钮走读数口');
    assert.equal(block.indexOf('boardCommit'), -1, '预览按钮不得调落笔口（预览 ≠ 落笔）');
    assert.ok(block.indexOf('setBoardPreview') >= 0, '预览必须把结果端出来给用户看');
});

/* ══════════ E ── 接线（视图 / App / 样式 / 不做面） ══════════ */
test('E1 视图：两个真去向按钮 + 预览按钮 + 取消按钮同屏', () => {
    const code = stripComments(viewSrc);
    assert.ok(code.indexOf('data-cw-bcommit') >= 0, '两个真去向按钮必须在场');
    assert.ok(code.indexOf('data-cw-bhandoff') >= 0, '预览按钮必须在场（计划原文：预览内容后交给 owner）');
    assert.ok(code.indexOf('data-cw-bcancel') >= 0, '取消按钮必须在场（取消不新建）');
    /* 主聊天那条必须先显式确认（计划原文：发送主聊天必须另行显式确认）。 */
    const i = code.indexOf("querySelectorAll('[data-cw-bcommit]')");
    const block = code.slice(i, i + 900);
    assert.ok(block.indexOf('confirm') >= 0, '主聊天那条必须先弹确认');
    assert.ok(block.indexOf('不发送') >= 0, '确认文案必须说清「只登记，不发送」');
    /* 两处落点读数如实分列。 */
    assert.ok(code.indexOf('还没发送') >= 0, '落点读数必须明说还没发送');
});

test('E2 App：去向表与标签来自契约件（不写第二份）', () => {
    const code = stripComments(appSrc);
    assert.ok(code.indexOf('boardTargetIds') >= 0, 'App 必须提供去向 id 出口');
    assert.ok(code.indexOf('handoffTargetIds') >= 0 || code.indexOf('material-board-handoff') >= 0,
        '去向表必须来自契约件');
    assert.equal(/boardTargetLabel\(t\)\s*\{\s*return\s*'/.test(code), false,
        'App 不得自持第二份去向标签表');
});

test('E3 样式双侧投递：creationdesk.css（link 加载面）与 phone.css（运行时投递面）都在场', () => {
    const deskCss = read('apps/creationdesk/creationdesk.css');
    const bundle = read('phone.css');
    for (const cls of ['.cwb-btn-warn', '.cwb-st-ok']) {
        assert.ok(deskCss.indexOf(cls) >= 0, 'creationdesk.css 缺样式：' + cls);
        assert.ok(bundle.indexOf(cls) >= 0, 'phone.css 缺样式（运行时投递面）：' + cls);
    }
    assert.equal(countOf(bundle, '.cwb-btn-warn {'), 1, 'phone.css 里该块只该有一份');
});

test('E4 不做面在代码上可判：不自动发布、不生成、不发消息、不新建草稿库', () => {
    const all = stripComments(kernelSrc + storeSrc + appSrc + viewSrc);
    for (const bad of ['addMoment', 'publishUserPost', 'createNovel', 'generateContent']) {
        assert.equal(all.indexOf(bad), -1, '取材板交接不得自动发布 / 生成：' + bad);
    }
    const banned = [
        ['fetch(', /(?<![\w.$])fetch\s*\(/],
        ['XMLHttpRequest', /(?<![\w.$])XMLHttpRequest(?![\w$])/],
        ['WebSocket', /(?<![\w.$])WebSocket(?![\w$])/],
        ['EventSource', /(?<![\w.$])EventSource(?![\w$])/],
        ['postMessage', /(?<![\w.$])postMessage(?![\w$])/]
    ];
    for (const [name, re] of banned) {
        assert.equal(re.test(all), false, '不得另建跨 App 消息总线：' + name);
    }
    /* 不新建草稿库：本版只落**既有** cw_drafts 那一格（键表里只有一个键）。 */
    assert.equal(Object.keys(K.MBH_KEYS).length, 1, '本项只该新开一个键（待用登记）');
    assert.ok(hostSrc.indexOf('cwWriteDrafts') >= 0, '草稿必须落既有那一格');
});

/* ══════════ F ── 负控制 + 版本锚 ══════════ */
const temps = [];
function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4450_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'apps', 'creationdesk'), path.join(dir, 'apps', 'creationdesk'));
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});
/** 定点破坏真源码副本：锚点必须恰中 1 次（失配即 abort，防「破坏没发生也算红」）。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeMirror();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}
const loadAt = async (dir, rel, tag) =>
    await import(pathToFileURL(path.join(dir, rel)).href + '?' + tag + '=' + Date.now());

test('F0 ★★★ 阳性对照：未破坏时下列各条判据必须全为真', () => {
    assert.equal(K.normalizeHandoff({ items: [ITEM('a')] }).why, K.MBH_REASONS.NO_TARGET,
        '原版：缺去向按 NO_TARGET 拒收');
    assert.equal(K.normalizeHandoff({ target: 'draft', items: [ITEM('a')] }).ok, true,
        '原版：合法交接单被收下');
    const st = mkStorage();
    ST.receiveHandoff(st, { target: 'chat', items: [ITEM('a')] });
    ST.receiveHandoff(st, { target: 'chat', items: [ITEM('a')] });
    assert.equal(ST.appliedKeys(st).length, 1, '原版：同一份再登记只记一条');
    assert.ok(ST.pendingHandoff(st).sent === false, '原版：登记后 sent 恒 false');
    assert.ok(K.handoffLine({ state: K.MBH_STATES.PENDING, count: 1 }).indexOf('还没发送') >= 0,
        '原版：pending 明说还没发送');
});

test('F1 ★★★ 破坏「缺去向的拒收」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "    if (!target) return Object.assign({}, empty, { why: MBH_REASONS.NO_TARGET });",
        "    if (false) return Object.assign({}, empty, { why: MBH_REASONS.NO_TARGET });");
    const k2 = await loadAt(dir, KERNEL_REL, 'f1');
    assert.notEqual(k2.normalizeHandoff({ items: [ITEM('a')] }).why, K.MBH_REASONS.NO_TARGET,
        '破坏副本：同款判据必转红（缺去向不再按 NO_TARGET 拒收）');
    /* 破坏后仍不许凭空落草稿（草稿是 owner 的事，本层只归一）。 */
    assert.equal(k2.normalizeHandoff({ items: [ITEM('a')] }).ok, false, '破坏副本：仍不许报收下');
});

test('F2 ★★★ 破坏「同一份再登记报 replayed」⇒ 同款判据必转红（重复插入）', async () => {
    const dir = breakCopy(STORE_REL,
        "    if (rows.some((r) => String((r && r.key) || '') === norm.key)) {",
        "    if (false && rows.some((r) => String((r && r.key) || '') === norm.key)) {");
    const s2 = await loadAt(dir, STORE_REL, 'f2');
    const st = mkStorage();
    s2.receiveHandoff(st, { target: 'chat', items: [ITEM('a')] });
    const again = s2.receiveHandoff(st, { target: 'chat', items: [ITEM('a')] });
    assert.notEqual(again.state, K.MBH_STATES.REPLAYED,
        '破坏副本：同款判据必转红（同一份被当成新登记）');
    /* ★ 真观测面是**登记行数**（不是 appliedKeys —— 它按 key 去重，两条同键也只算一条；
     *   拿它当靶子会让破坏生效而判据不动，那就是假绿）。 */
    const rows = JSON.parse(st.get(K.MBH_KEYS.pending, '{"rows":[]}')).rows;
    assert.equal(rows.length, 2, '破坏副本：登记本里出现了两行（连点会重复插）');
});

test('F3 ★★★ 破坏「坏存储时登记如实报 failed」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(STORE_REL,
        "    if (!writeJson(storage, MBH_KEYS.pending, { rows: kept })) {",
        "    if (false) {");
    const s2 = await loadAt(dir, STORE_REL, 'f3');
    const broken = {
        get: () => { throw new Error('x'); },
        set: () => { throw new Error('x'); },
        remove: () => { throw new Error('x'); }
    };
    const r = s2.receiveHandoff(broken, { target: 'chat', items: [ITEM('a')] });
    assert.notEqual(r.state, K.MBH_STATES.FAILED,
        '破坏副本：同款判据必转红（写失败被当成登记成功）');
    assert.equal(r.state, K.MBH_STATES.PENDING, '破坏副本：写不进去也报 pending（这就是那条谎报）');
});

test('F4 ★★★ 破坏「pending 明说还没发送」⇒ 同款判据必转红', async () => {
    const dir = breakCopy(KERNEL_REL,
        "            return '已登记为**下一次主聊天**要带的材料：' + String(n) + ' 条（**还没发送** —— 发送要你在主聊天里另行确认）';",
        "            return '已登记为**下一次主聊天**要带的材料：' + String(n) + ' 条（已发送）';");
    const k2 = await loadAt(dir, KERNEL_REL, 'f4');
    const line = k2.handoffLine({ state: k2.MBH_STATES.PENDING, count: 1 });
    assert.equal(line.indexOf('还没发送') >= 0, false, '破坏副本：同款判据必转红（读数把登记说成已发）');
    assert.ok(line.indexOf('已发送') >= 0, '破坏副本：谎报又回来了');
    /* 原版必须没有这句（对照）。 */
    assert.equal(K.handoffLine({ state: K.MBH_STATES.PENDING, count: 1 }).indexOf('（已发送）'), -1,
        '原版不得把登记读成已发送');
});

test('F5 版本锚：六源同源（不锁死具体版本值，但必须一致且当版条目在场）', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idxVer = (read(HOST_REL).match(/ST_PHONE_VERSION = '([^']+)'/) || [])[1];
    const ledger = JSON.parse(read('tests/audit/status-ledger.json'));
    const vers = [pkg.version, manifest.version, log.latest, idxVer, ledger.version];
    assert.equal(new Set(vers).size, 1, '五源版本必须一致：' + JSON.stringify(vers));
    assert.equal(log.head, log.latest, 'update-log 的 head 必须跟上 latest');
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, log.latest), '当版条目必须在 versions 里');
    /* 迭代段在场且条目数达标。 */
    const iter = read('tools/iter204_seg.md');
    assert.ok(countOf(iter, '- 【') >= 8, '迭代段条目数不足（须 ≥ 8）');
});

test('F6 ★ 历史套件的版本锚不再被抬版连带转红（沿用 v4.44.0 接管口径）', () => {
    /* 本版抬版时同样会带动历史套件的「当版内容」锚 —— 那些已由 v4.44.0 的
     * `tools/takeover_v4440_anchors.py` 改成锁自己那一版；本判据守住这个不变量。
     *   ★ 判的是**组合**：把 `ver` 动态绑到 `pkg.version`、又拿它索引当版条目。
     *     v4.44.0 那种「一致性用 `cur`、内容用 `ver` 字面量」的写法是**正确接管**，
     *     首版把 v4440 也列进 own 表就误判了它（判据过严）。 */
    const own = {
        v4330: '4.33.0', v4360: '4.36.0', v4400: '4.40.0'
    };
    for (const [suite, ver] of Object.entries(own)) {
        const src = read('tests/system-' + suite + '.test.mjs');
        const code = stripComments(src);
        const dynBound = code.indexOf('const ver = pkg.version') >= 0;
        if (dynBound) {
            assert.ok(code.indexOf('log.versions[ver]') < 0 && code.indexOf('ul.versions[ver]') < 0,
                suite + ' 不得拿 pkg.version 去索引当版条目（抬版连带转红的根因）');
        }
        assert.ok(code.indexOf("versions['" + ver + "']") >= 0 || code.indexOf("ver = '" + ver + "'") >= 0,
            suite + ' 必须锁自己那一版：' + ver);
        assert.ok(code.indexOf('pkg.version') >= 0, suite + ' 仍必须断言五源一致（跟随当前版）');
    }
    /* v4.44.0 接管**别的**套件时用的形态（cur 跟随当前版、ver 锁字面量）——
     *   核 v4430 那条：它才是被接管的那一条（v4440 自己的版本锚不在接管面上）。
     *   ★ 这里的 `log.versions[ver]` 索引的是**字面量 ver**（= 自己那一版），无害；
     *     真正的红线是「拿 `pkg.version` 去索引当版条目」，故只判 `cur` 与字面量各就各位。 */
    const v4430 = stripComments(read('tests/system-v4430.test.mjs'));
    assert.ok(v4430.indexOf('const cur = pkg.version') >= 0, 'v4430 一致性必须跟随当前版');
    assert.ok(v4430.indexOf("const ver = '4.43.0'") >= 0, 'v4430 当版内容必须锁自己那一版');
    assert.equal(v4430.indexOf('log.versions[cur]'), -1, 'v4430 不得拿 cur（当前版）索引当版条目');
});
