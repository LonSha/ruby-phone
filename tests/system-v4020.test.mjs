/* ========================================================
 * tests/system-v4020.test.mjs — v4.02.0 · 第三期 E 包 R3-X4
 *   跨社媒同一事件的话题页与舆论演变（config/topic-echo.js）
 * --------------------------------------------------------
 * 五面：A 结构 / B 行为 / C 接线 / D 负控制 / E 版本锚。
 * 逐条对应计划原文四条验收：
 *   ① 一件事可在朋友圈/贴吧/小红书表现不同而核心事实一致（话题页按 rootEventId 聚拢）；
 *   ② 删除/辟谣影响后续草稿（debunk 传播标 stale）；
 *   ③ 私聊秘密不会自动变公共热帖（公开条目须用户确认）；
 *   ④ 发布仍逐目标确认（本版话题动作零 owner 调用）。
 * ======================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
const m = await import(pathToFileURL(join(ROOT, 'config/topic-echo.js')).href);

/* ---------- A 结构 ---------- */
test('A1 内核五面结构齐备：四类条目 / 上限 / 五出口', () => {
    assert.deepEqual(Object.keys(m.TOPIC_KINDS), ['publish', 'repost', 'comment', 'debunk']);
    assert.equal(m.TOPIC_LIMITS.entries, 120);
    assert.equal(m.TOPIC_LIMITS.perTopic, 40);
    for (const fn of ['normalizeTopicEntry', 'normalizeTopicBook', 'buildTopicPage', 'reactionFor', 'markDraftsDebunked', 'topicSelfCheck']) {
        assert.equal(typeof m[fn], 'function', '缺出口:' + fn);
    }
});
test('A2 内核自检通过（topicSelfCheck 零问题）', () => {
    const s = m.topicSelfCheck();
    assert.ok(s.ok, '自检问题:' + JSON.stringify(s.problems));
});
test('A3 内核只 import 转述链口径，不碰 storage / window / fetch', () => {
    const src = rd('config/topic-echo.js');
    const imports = src.match(/^import[\s\S]*?from\s*'[^']+';/gm) || [];
    assert.equal(imports.length, 1, '内核应只 import 一份（转述链口径）');
    assert.ok(imports[0].includes('./context-compose.js'), '应 import context-compose 的转述链');
    assert.ok(!/import[\s\S]*?from\s*['"][^'"]*storage['"]/.test(src));
    assert.ok(!/\bwindow\s*[.[]/.test(src));
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(src));
});

/* ---------- B 行为 ---------- */
test('B1 缺 rootEventId 必拒（话题页只收同源事件条目，不静默修）', () => {
    const r = m.normalizeTopicEntry({ kind: 'publish', platform: 'weibo', id: 'x', confirmed: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /rootEventId/);
});
test('B2 认不出的类别必拒；四类可收', () => {
    assert.equal(m.normalizeTopicEntry({ rootEventId: 'e1', kind: 'gossip', platform: 'weibo', id: 'x' }).ok, false);
    for (const kind of ['publish', 'repost', 'comment', 'debunk']) {
        const r = m.normalizeTopicEntry({ rootEventId: 'e1', kind, platform: 'weibo', id: 'i_' + kind, visibleTo: ['user'] });
        assert.ok(r.ok, kind + ' 应可收:' + r.reason);
    }
});
test('B3 公开条目未经用户确认必拒；私域不受此闸（验收③）', () => {
    const pub = m.normalizeTopicEntry({ rootEventId: 'e1', kind: 'publish', platform: 'weibo', id: 'p1', visibleTo: [] });
    assert.equal(pub.ok, false, '公开未确认不得落地');
    assert.match(pub.reason, /确认/);
    const pubOk = m.normalizeTopicEntry({ rootEventId: 'e1', kind: 'publish', platform: 'weibo', id: 'p2', visibleTo: [], confirmed: true });
    assert.ok(pubOk.ok, '公开已确认应可收');
    const priv = m.normalizeTopicEntry({ rootEventId: 'e1', kind: 'publish', platform: 'wechat', id: 'p3', visibleTo: ['user'] });
    assert.ok(priv.ok, '私域发布不受公开确认闸');
});
test('B4 评论类不落公开确认闸（评论不是「发布公开内容」）', () => {
    const c = m.normalizeTopicEntry({ rootEventId: 'e1', kind: 'comment', platform: 'weibo', id: 'c1', visibleTo: [] });
    assert.ok(c.ok, '评论不要求 confirmed');
});
test('B5 话题页按 rootEventId 聚拢并分类计数（验收①）', () => {
    const book = m.normalizeTopicBook([
        { rootEventId: 'e9', kind: 'publish', platform: 'weibo', id: 'a', confirmed: true, time: 1, text: '核心事实' },
        { rootEventId: 'e9', kind: 'repost', platform: 'xhs', id: 'b', confirmed: true, time: 2, text: '转述', origin: 'weibo:a' },
        { rootEventId: 'e9', kind: 'comment', platform: 'tieba', id: 'd', time: 4, text: '评论' },
        { rootEventId: 'e8', kind: 'publish', platform: 'weibo', id: 'z', confirmed: true, time: 5, text: '别的事件' },
    ]);
    const pg = m.buildTopicPage(book.entries, 'e9');
    assert.ok(pg.found);
    assert.equal(pg.byKind.publish, 1);
    assert.equal(pg.byKind.repost, 1);
    assert.equal(pg.byKind.comment, 1);
    assert.equal(pg.byKind.debunk, 0);
    assert.equal(pg.entries.length, 3, '别的事件不得混入');
    assert.deepEqual(pg.platforms, ['tieba', 'weibo', 'xhs']);
});
test('B6 同一事件被多平台转述不按平台数计信源（验收① 的读数纪律）', () => {
    const book = m.normalizeTopicBook([
        { rootEventId: 'e9', kind: 'publish', platform: 'weibo', id: 'a', confirmed: true, time: 1, text: '核心事实' },
        { rootEventId: 'e9', kind: 'repost', platform: 'xhs', id: 'b', confirmed: true, time: 2, text: '转述', origin: 'weibo:a' },
        { rootEventId: 'e9', kind: 'repost', platform: 'tieba', id: 'c', confirmed: true, time: 3, text: '再转述', origin: 'weibo:a' },
    ]);
    const pg = m.buildTopicPage(book.entries, 'e9');
    assert.equal(pg.platforms.length, 3, '三个平台都在场');
    assert.equal(pg.chains.retoldChains, 2, '两条转载应认成转述');
    const rc = m.reactionFor(pg, 'char:a', { knows: true });
    assert.ok(rc.ok);
    assert.equal(rc.sourcesCount, 1, '三平台一条来源链只算 1 个信源');
});
test('B7 不知情不编反应（「未看不能互动」同口径）', () => {
    const book = m.normalizeTopicBook([
        { rootEventId: 'e9', kind: 'publish', platform: 'weibo', id: 'a', confirmed: true, time: 1, text: '核心事实' },
    ]);
    const pg = m.buildTopicPage(book.entries, 'e9');
    const r = m.reactionFor(pg, 'char:b', { knows: false, knowsWhy: '未看到这条' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /不知情|未看/);
});
test('B8 辟谣传播：同话题草稿标 stale、别的话题不误伤、版本+1（验收②）', () => {
    const md = m.markDraftsDebunked([
        { key: 'k1', target: 'weibo', state: 'ready', version: 1, rootEventId: 'e9' },
        { key: 'k2', target: 'xhs', state: 'ready', version: 1, rootEventId: 'e8' },
    ], 'e9', '辟谣人');
    assert.equal(md.changed, 1);
    assert.equal(md.drafts[0].state, 'stale');
    assert.equal(md.drafts[0].debunkedBy, '辟谣人');
    assert.equal(md.drafts[0].version, 2);
    assert.equal(md.drafts[1].state, 'ready', '别的话题不得误伤');
});
test('B9 已辟谣话题不再生成新反应（旧条目仍在，可查证）', () => {
    const book = m.normalizeTopicBook([
        { rootEventId: 'e9', kind: 'publish', platform: 'weibo', id: 'a', confirmed: true, time: 1, text: '核心事实' },
        { rootEventId: 'e9', kind: 'debunk', platform: 'weibo', id: 'db', time: 2, text: '这条有误', by: '辟谣人' },
    ]);
    const pg = m.buildTopicPage(book.entries, 'e9');
    assert.equal(pg.debunked, true);
    assert.equal(pg.entries.length, 2, '辟谣不删旧条目');
    const r = m.reactionFor(pg, 'char:a', { knows: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /辟谣/);
});
test('B10 归一：读不出与空分开、上限最早先出、同键后到覆盖', () => {
    assert.equal(m.normalizeTopicBook(null).ok, false);
    assert.equal(m.normalizeTopicBook('{bad json').ok, false);
    const empty = m.normalizeTopicBook('[]');
    assert.ok(empty.ok);
    assert.equal(empty.entries.length, 0);
    const big = [];
    for (let i = 0; i < 130; i += 1) {
        big.push({ rootEventId: 'e' + i, kind: 'comment', platform: 'weibo', id: 'i' + i, time: i });
    }
    const nb = m.normalizeTopicBook(big);
    assert.equal(nb.entries.length, m.TOPIC_LIMITS.entries);
    assert.ok(!nb.entries.some((e) => e.id === 'i0'), '最早的应被裁掉');
    assert.ok(nb.entries.some((e) => e.id === 'i129'), '最新的应在场');
    const dup = m.normalizeTopicBook([
        { rootEventId: 'e1', kind: 'comment', platform: 'weibo', id: 'same', time: 1, text: '旧' },
        { rootEventId: 'e1', kind: 'comment', platform: 'weibo', id: 'same', time: 2, text: '新' },
    ]);
    assert.equal(dup.entries.length, 1);
    assert.equal(dup.entries[0].text, '新', '同键后到覆盖');
});

/* ---------- C 接线 ---------- */
test('C1 index.js 话题本键 + 八动作白名单 + 读写口回读', () => {
    const src = rd('index.js');
    assert.ok(src.includes("CW_TOPICS_KEY = 'cw_topics'"));
    for (const act of ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop', 'topic']) {
        assert.ok(src.includes("'" + act + "'"), '白名单缺动作:' + act);
    }
    assert.ok(src.includes('cwReadTopicsRaw'));
    assert.ok(src.includes('cwWriteTopics'));
    assert.ok(/cwWriteTopics[\s\S]{0,400}readback-mismatch/.test(src), '写后必须回读核对');
});
test('C2 取数口接话题读数 + topic 四子命令分流都在', () => {
    const src = rd('index.js');
    assert.ok(src.includes('topicSelfCheck: topicSelfCheckOf()'));
    assert.ok(src.includes('topics: (function ()'));
    for (const sub of ["tKind === 'record'", "tKind === 'page'", "tKind === 'react'", "tKind === 'debunk'"]) {
        assert.ok(src.includes(sub), '缺子命令:' + sub);
    }
});
test('C3 话题动作族零 owner 调用（发布仍逐目标确认）', () => {
    const src = rd('index.js');
    const start = src.indexOf("if (action === 'topic') {");
    assert.ok(start > 0);
    const end = src.indexOf("if (action === 'compose' || action === 'edit'", start);
    assert.ok(end > start);
    const block = src.slice(start, end);
    assert.ok(!block.includes('cwInvokeOwner'), '话题动作不得代发');
    assert.ok(!block.includes('cwPlanPublish'), '话题动作不得走发布计划');
});
test('C4 辟谣传播接到草稿本（markDraftsDebunked + cwWriteDrafts）', () => {
    const src = rd('index.js');
    assert.ok(/markDraftsDebunked\([\s\S]{0,200}cwWriteDrafts/.test(src));
});

test('C5 app 层话题交互:四方法 + vm 读数 + 换会话重置', () => {
    const src = rd('apps/creationdesk/creationdesk-app.js');
    for (const fn of ['setTopicEvent', 'setTopicPlatform', 'setTopicText', 'async topicAct']) {
        assert.ok(src.includes(fn), '缺方法:' + fn);
    }
    assert.ok(src.includes('topicsText'), 'vm 应透出话题本读数');
    assert.ok(src.includes('topicSelfCheck'), 'vm 应透出内核自检');
    /* 实例态在构造函数与 onChatChanged 各声明一次（换会话不得留上一个会话的话题） */
    /* 构造函数与 onChatChanged 各重置一次（换会话不得留上一个会话的话题）;
     *   setTopicEvent 里是交互赋值,不计入重置面。 */
    assert.equal(src.split("this._topicEvent = '';").length - 1, 2, '构造函数与 onChatChanged 应各重置一次');
});
test('C6 视图层话题段 + 四组绑定 + CSS 输入框', () => {
    const src = rd('apps/creationdesk/creationdesk-view.js');
    assert.ok(src.includes('_topics(vm)'), '应有话题段渲染');
    for (const a of ['data-cw-topic-event', 'data-cw-topic-platform', 'data-cw-topic-text', "querySelectorAll('[data-cw-topic]')"]) {
        assert.ok(src.includes(a), '缺绑定/元素:' + a);
    }
    const order = ['this._drafts(vm)', 'this._topics(vm)', 'this._plan(vm)'];
    const pos = order.map((x) => src.indexOf(x));
    assert.ok(pos[0] < pos[1] && pos[1] < pos[2], '组装序应为 drafts → topics → plan');
    const css = rd('apps/creationdesk/creationdesk.css');
    assert.ok(css.includes('.cwb-inp'), 'CSS 应有话题输入框样式');
});
/* ---------- D 负控制（真源码破坏 → 同款判据必转红） ---------- */
test('D1 负控制：破坏「公开须用户确认」，B3 判据必转红', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'v4020d1-'));
    cpSync(join(ROOT, 'config'), join(tmp, 'config'), { recursive: true });
    const tgt = join(tmp, 'config/topic-echo.js');
    let src = readFileSync(tgt, 'utf-8');
    const A = "        if ((kind === 'publish' || kind === 'repost') && isPublic && !confirmed) {";
    const B = "        if ((kind === 'publish' || kind === 'repost') && isPublic && false && !confirmed) {";
    assert.equal(src.split(A).length - 1, 1, '破坏锚点必须恰中 1 次');
    writeFileSync(tgt, src.replace(A, B));
    const mm = await import(pathToFileURL(tgt).href + '?t=' + Date.now());
    const pub = mm.normalizeTopicEntry({ rootEventId: 'e1', kind: 'publish', platform: 'weibo', id: 'p1', visibleTo: [] });
    assert.equal(pub.ok, true, '破坏后公开未确认条目应被放行 —— B3 判据必转红');
    rmSync(tmp, { recursive: true, force: true });
});

/* ---------- E 版本锚 ---------- */
test('E1 版本门：入口版本不低于 4.01.0（本版目标 v4.02.0）', () => {
    const src = rd('index.js');
    const mm = src.match(/ST_PHONE_VERSION = '(\d+)\.(\d+)\.(\d+)'/);
    assert.ok(mm, '入口应有版本常量');
    const v = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
    assert.ok(v[0] > 4 || (v[0] === 4 && (v[1] > 1 || (v[1] === 1))), '入口版本不得低于 4.01.0');
});