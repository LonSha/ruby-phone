/* ============================================================
 * tests/apps-tieba-v4.test.mjs — 贴吧「照现实重写」的行为判据
 * ------------------------------------------------------------
 * 上一版 215 行：一张帖子卡流 + 两个 `style.display` 弹窗，用户真能做的动作只有
 * 「点开 / 回复 / 点赞 / 发帖」。这一版把贴吧做成首页（搜索 + 吧 chip + 卡流）、
 * 详情（1 楼 + 楼层 + 底部回复栏）、搜索三页，判据就必须钉住这些动作：
 *   A 数据层：吧过滤 / 本地搜索 / 发帖 / 楼层号 / 点赞对称 / 裸数组落盘 / 标签入库；
 *   B 视图层：三页都画得出且标签闭合 / 每个 data-act 都有分支 / 动作真改数据 /
 *     空标题不发帖 / 空回复不写楼层 / 用户文本必须转义；
 *   C 控制器：AI 标签只在真带标签时动数据、换会话只重建数据层、接线不许退化。
 * 【为什么单独钉转义】旧版把 AI 给的标题直接拼进 innerHTML：标题里写一行
 *   `<img src=x onerror=...>` 就是一次注入，而界面上「看起来只是标题多了点东西」。
 * ============================================================ */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- 最小 DOM 替身（够判，不假装浏览器） ---------- */
class El {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.innerHTML = '';
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.hidden = false;
        this.style = {};
        this.dataset = {};
        this._attrs = new Map();
    }
    addEventListener() {}
    removeEventListener() {}
    setAttribute(k, v) { this._attrs.set(String(k), String(v)); }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
    removeAttribute(k) { this._attrs.delete(String(k)); }
    appendChild(c) { this.children = this.children || []; this.children.push(c); return c; }
    remove() { this._removed = true; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
}

const makeStorage = () => {
    const map = new Map();
    return {
        map,
        get(k) { return map.has(k) ? map.get(k) : null; },
        set(k, v) { map.set(k, v); }
    };
};

/** `data-act` 的假元素：属性按名字给（不带 `data-` 前缀）。 */
const fakeEl = (attrs) => ({
    getAttribute: (k) => {
        const name = String(k).indexOf('data-') === 0 ? String(k).slice(5) : String(k);
        return (name in attrs) ? String(attrs[name]) : null;
    }
});

/* 宿主窗口：测试环境可能重复 import，每次都重设成干净的一份。 */
function freshWindow(extra) {
    const w = Object.assign({
        VirtualPhone: {},
        dispatchEvent() {},
        addEventListener() {}
    }, extra || {});
    w.CustomEvent = class CustomEvent {
        constructor(type) { this.type = type; }
    };
    global.window = w;
    global.document = { createElement: (t) => new El(t), querySelector: () => null };
    return w;
}
freshWindow();

const { TiebaData } = await import('../apps/tieba/tieba-data.js');
const { TiebaApp } = await import('../apps/tieba/tieba-app.js');

/* 收尾：视图的 toast 有 1.6s 定时器，不清掉会把测试进程拖住。 */
const VIEWS = [];
const mkApp = (shell, storage) => {
    const app = new TiebaApp(shell, storage);
    VIEWS.push(app.view);
    return app;
};
afterEach(() => {
    for (const v of VIEWS.splice(0)) {
        try { if (v && v._toastTimer) clearTimeout(v._toastTimer); } catch (_e) { /* 收尾尽力 */ }
    }
});

const seeded = () => {
    const storage = makeStorage();
    const data = new TiebaData(storage);
    return { storage, data };
};

/* ============================================================
 * A. 数据层
 * ============================================================ */
test('A1 构造：三个吧 + 三条样本帖，字段齐全', () => {
    const { data } = seeded();
    assert.equal(data.getBars().length, 3);
    assert.equal(data.posts.length, 3);
    for (const p of data.posts) {
        assert.ok(p.id && p.barId && p.barName && p.title, '字段缺失: ' + JSON.stringify(p).slice(0, 60));
        assert.ok(Array.isArray(p.replies));
        assert.equal(p.isLiked, false);
    }
    assert.ok(data.posts.every((p) => p.barId === 'bar_jc' || p.barId === 'bar_rz' || p.barId === 'bar_uni'));
});

test('A2 按吧取帖：all 给全部，指定吧只给本吧，未知吧给空（不回退成全部）', () => {
    const { data } = seeded();
    assert.equal(data.getPostsByBar('all').length, 3);
    const jc = data.getPostsByBar('bar_jc');
    assert.equal(jc.length, 1);
    assert.ok(jc.every((p) => p.barId === 'bar_jc'));
    assert.deepEqual(data.getPostsByBar('bar_nope'), []);
    assert.equal(data.getBar('bar_rz').name, '弱智吧');
    assert.equal(data.getBar('bar_nope'), null);
});

test('A3 搜索：标题 / 正文 / 作者 / 吧名都命中；空词不出结果', () => {
    const { data } = seeded();
    assert.ok(data.searchPosts('夜跑').length >= 1, '标题应命中');
    assert.ok(data.searchPosts('霓虹').length >= 1, '正文应命中');
    assert.ok(data.searchPosts('哲学大蒜').length >= 1, '作者应命中');
    assert.ok(data.searchPosts('弱智吧').length >= 1, '吧名应命中');
    assert.deepEqual(data.searchPosts('   '), [], '空词不许把全量假装成搜索结果');
    assert.deepEqual(data.searchPosts('这套词不存在'), []);
});

test('A4 发帖：进列表头部、带默认时间与吧名、能落盘', () => {
    const { data, storage } = seeded();
    const p = data.createPost('bar_uni', '  测试标题  ', '正文内容', '我');
    assert.ok(p && p.id);
    assert.equal(p.title, '测试标题', '标题要去首尾空白');
    assert.equal(p.barId, 'bar_uni');
    assert.equal(p.barName, '青石大学吧', '吧名要按 barId 反查，不能沿用上一个吧');
    assert.equal(p.time, '刚刚');
    assert.equal(p.likes, 0);
    assert.equal(data.posts[0].id, p.id, '新帖必须在最前面');
    assert.equal(storage.get('ruby_tieba_posts')[0].id, p.id, '必须真落盘');
    assert.equal(data.createPost('bar_jc', '   ', '空标题'), null, '空标题不许造出帖子');
});

test('A5 楼层：回复从 2 楼起、号数不回收、空回复不写', () => {
    const { data } = seeded();
    const post = data.posts[0];
    const before = post.replies.length;
    const r = data.addReply(post.id, '  新回复  ', '我');
    assert.ok(r);
    assert.equal(r.floor, before + 2, '1 楼是楼主，回复从 2 楼起');
    assert.equal(post.replies.length, before + 1);
    assert.equal(data.addReply(post.id, '   '), null, '空回复不许写');
    assert.equal(data.addReply('post_nope', '有内容'), null, '帖子不在就明确不写');
});

test('A6 点赞：对称可撤销，计数不掉到负数', () => {
    const { data } = seeded();
    const post = data.posts[0];
    const base = post.likes;
    const on = data.toggleLike(post.id);
    assert.deepEqual([on.on, on.count], [true, base + 1]);
    const off = data.toggleLike(post.id);
    assert.deepEqual([off.on, off.count], [false, base]);
    post.likes = 0;
    post.isLiked = false;
    data.toggleLike(post.id);
    const again = data.toggleLike(post.id);
    assert.equal(again.count >= 0, true, '计数不许为负');
    assert.equal(data.toggleLike('post_nope'), null);
});

test('A7 持久化：新实例读得回；落盘是裸数组（entry-integrity 点名要这个形状）', () => {
    const { data, storage } = seeded();
    data.createPost('bar_rz', '落盘测试', '正文');
    const again = new TiebaData(storage);
    assert.ok(again.posts.some((p) => p.title === '落盘测试'));
    const raw = storage.get('ruby_tieba_posts');
    assert.equal(Array.isArray(raw), true, 'ruby_tieba_posts 必须是数组');
});

test('A8 模型标签：<Tieba> 与 <Tie> 都入库、一条消息多个标签逐个进、坏 JSON 静默忽略', () => {
    const { data } = seeded();
    const n0 = data.posts.length;
    const added = data.parseFromMessage(
        '前文<Tieba>{"title":"甲帖","content":"甲正文","author":"UP甲"}</Tieba>中间'
        + '<Tie>{"title":"乙帖","barId":"bar_rz"}</Tie>后文'
    );
    assert.equal(added.length, 2);
    assert.equal(data.posts.length, n0 + 2);
    assert.ok(data.posts.some((p) => p.title === '甲帖'));
    assert.equal(data.posts.find((p) => p.title === '乙帖').barName, '弱智吧', 'barId 要解析成吧名');
    assert.deepEqual(data.parseFromMessage('没有标签'), []);
    const broken = data.parseFromMessage('<Tieba>{这不是 JSON}</Tieba>');
    assert.deepEqual(broken, [], '坏 JSON 不许造帖');
    assert.equal(data.posts.length, n0 + 2, '坏 JSON 不许改数据');
});

test('A9 统计：帖数 / 回复数 / 吧数都数得出来', () => {
    const { data } = seeded();
    const st = data.stats();
    assert.equal(st.posts, data.posts.length);
    assert.equal(st.bars, 3);
    const replies = data.posts.reduce((s, p) => s + p.replies.length, 0);
    assert.equal(st.replies, replies);
});

/* ============================================================
 * B. 视图层
 * ============================================================ */
const KNOWN_ACTS = new Set(['back', 'chip', 'open', 'like', 'search', 'search-clear',
    'compose', 'compose-close', 'compose-send', 'reply-send',
    /* v4.207.0 底栏：两个新动作。登记在这里才算「点得到且有人接」—— 本门禁
     * 只认渲染出来的 data-act，视图层写了 case 但页面没画出来也算漏。 */
    'nav', 'enter-bar']);

function tagBalance(html) {
    const bad = [];
    for (const tag of ['div', 'button', 'span', 'article', 'nav', 'p', 'h1', 'h2', 'h3', 'section', 'header', 'label', 'select', 'textarea']) {
        const open = (html.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length;
        const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
        if (open !== close) bad.push(tag + ':' + open + '/' + close);
    }
    return bad;
}

test('B1 三页都画得出来、标签闭合、data-act 都有处理分支', () => {
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    app.render();
    const seen = new Set();
    const check = (name) => {
        const html = screen.innerHTML;
        assert.deepEqual(tagBalance(html), [], name + ' 标签不闭合');
        assert.ok(html.length > 200, name + ' 画出来是空的');
        const re = /data-act="([^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) seen.add(m[1]);
    };
    const view = app.view;
    check('home');
    const post = app.data.posts[0];
    view._act('open', fakeEl({ post: post.id }));
    check('detail');
    view._act('back', fakeEl({}));
    view.keyword = '夜跑';
    view._act('search', fakeEl({}));
    check('search');
    view.keyword = '这套词不存在';
    view._act('search', fakeEl({}));
    check('search-empty');
    /* v4.207.0：底栏两个新一级面也必须真画一遍 —— 否则「nav」这个动作虽然
     * 在 KNOWN_ACTS 里，页面上的 bars / me 从未被渲染过，等于没验。 */
    view._act('nav', fakeEl({ nav: 'bars' }));
    check('bars');
    view._act('nav', fakeEl({ nav: 'me' }));
    check('me');
    view._act('nav', fakeEl({ nav: 'home' }));
    check('home-again');
    check('sheet');
    const unknown = [...seen].filter((a) => !KNOWN_ACTS.has(a));
    assert.deepEqual(unknown, [], '这些 data-act 点得到、代码里没人接');
});

test('B2 空态：找不到的吧给空，不假装有内容；帖子被删后详情如实说「不在了」', () => {
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    app.render();
    app.view._act('chip', fakeEl({ bar: 'bar_nope' }));
    assert.ok(screen.innerHTML.includes('还没有帖子'), '空吧必须有空态');
    app.view._act('back', fakeEl({}));
    app.view._act('open', fakeEl({ post: 'post_nope' }));
    assert.ok(screen.innerHTML.includes('data-page="home"'), '打不存在的帖不许跳走');
});

test('B3 点赞动作真改数据（卡片上的点赞键）', () => {
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    app.render();
    const post = app.data.posts[0];
    const base = post.likes;
    app.view._act('like', fakeEl({ post: post.id }));
    assert.equal(app.data.getPostById(post.id).likes, base + 1);
    assert.equal(app.data.getPostById(post.id).isLiked, true);
    assert.ok(screen.innerHTML.includes('is-on'), '点赞后界面要有选中态');
    app.view._act('like', fakeEl({ post: post.id }));
    assert.equal(app.data.getPostById(post.id).likes, base);
});

test('B4 发帖：空标题一条都不发；有标题才发，并跳回首页', () => {
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    app.render();
    const n0 = app.data.posts.length;
    const view = app.view;
    const fields = {
        '[data-role="bar"]': { value: 'bar_rz' },
        '[data-role="title"]': { value: '   ' },
        '[data-role="content"]': { value: '正文' }
    };
    view._q = (sel) => (sel in fields ? fields[sel] : null);
    view._act('compose-send', fakeEl({}));
    assert.equal(app.data.posts.length, n0, '空标题不许发出去');
    fields['[data-role="title"]'].value = '  真的发一帖  ';
    view._act('compose-send', fakeEl({}));
    assert.equal(app.data.posts.length, n0 + 1);
    assert.equal(app.data.posts[0].title, '真的发一帖');
    assert.equal(app.data.posts[0].barId, 'bar_rz', '发帖要落在选中的吧');
    assert.equal(view.page, 'home');
});

test('B5 回复：空回复不写楼层；有内容楼层号 +1 并留在详情页', () => {
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    app.render();
    const post = app.data.posts[0];
    const view = app.view;
    view._act('open', fakeEl({ post: post.id }));
    const n0 = post.replies.length;
    const fields = { '[data-role="reply"]': { value: '   ' } };
    view._q = (sel) => (sel in fields ? fields[sel] : null);
    view._act('reply-send', fakeEl({ post: post.id }));
    assert.equal(post.replies.length, n0, '空回复不许占楼层');
    fields['[data-role="reply"]'].value = '这层是我盖的';
    view._act('reply-send', fakeEl({ post: post.id }));
    assert.equal(post.replies.length, n0 + 1);
    assert.equal(post.replies[n0].floor, n0 + 2);
    assert.equal(view.page, 'detail', '回复后要留在详情页');
});

test('B6 用户文本必须转义：标题里写标签不许变成 DOM', () => {
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    app.render();
    app.data.createPost('bar_jc', '<img src=x onerror=alert(1)>', '<script>bad()</script>', '<b>作者</b>');
    app.view._paint();
    const html = screen.innerHTML;
    assert.equal(html.includes('<img src=x'), false, '标题里的 <img 不许原样进 DOM');
    assert.equal(html.includes('<script>bad()'), false, '正文里的 <script> 不许原样进 DOM');
    assert.equal(html.includes('&lt;img'), true, '转义后应该看得到实体');
});

test('B7 宿主读不到 DOM 时不许抛（querySelector 全 null）', () => {
    const app = mkApp({ screen: new El('div') }, makeStorage());
    const view = app.view;
    app.render();
    assert.doesNotThrow(() => view._toast('提示'));
    assert.doesNotThrow(() => view._openCompose());
    assert.doesNotThrow(() => view._closeCompose());
    assert.doesNotThrow(() => view._sendPost());
    assert.doesNotThrow(() => view._sendReply(app.data.posts[0].id));
    assert.doesNotThrow(() => view._paint());
    assert.doesNotThrow(() => view.render(null));
});

/* ============================================================
 * C. 控制器
 * ============================================================ */
test('C1 AI 标签入库：注册一次、只在真带标签时才动数据', () => {
    const listeners = [];
    freshWindow({
        SillyTavern: {
            getContext: () => ({
                eventSource: { on: (evt, fn) => listeners.push({ evt, fn }) },
                event_types: { MESSAGE_RECEIVED: 'message_received' }
            })
        }
    });
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    assert.equal(listeners.length, 1, '构造期只注册一个监听');
    app.render();
    const n0 = app.data.posts.length;
    const fn = listeners[0].fn;
    fn({ message: { mes: '随便聊两句，贴吧没有标签。' } });
    assert.equal(app.data.posts.length, n0, '没有标签就不许动数据');
    fn({ message: { mes: '<Tieba>{"title":"从聊天里来的"}</Tieba>' } });
    assert.ok(app.data.posts.some((p) => p.title === '从聊天里来的'));
    assert.ok(screen.innerHTML.includes('从聊天里来的'), '入库后界面要重绘');
    freshWindow();
});

test('C2 换会话：只重建数据层、不重建实例；视图经 this.app.data 取新数据', () => {
    const storage = makeStorage();
    const app = mkApp({ screen: new El('div') }, storage);
    app.render();
    const view = app.view;
    const oldData = app.data;
    oldData.createPost('bar_jc', '旧会话的帖子', '');
    storage.map.clear();
    app.onChatChanged();
    assert.equal(app.view, view, '实例与视图必须保留（否则监听器会累积）');
    assert.notEqual(app.data, oldData, '数据层必须是新的一份');
    assert.equal(app.data.posts.some((p) => p.title === '旧会话的帖子'), false, '新会话不许串味');
    assert.equal(app.data.posts.length, 3, '新会话要回到样本帖');
});

test('C3 控制器接线不许退化（v2.23 同款判据）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'apps/tieba/tieba-app.js'), 'utf8');
    assert.match(src, /onChatChanged\s*\(\s*\)\s*\{/);
    assert.ok(src.includes('this.data = new TiebaData(this.storage);'));
    assert.match(src, /this\.view = new \w+View\(this\)/);
    const view = fs.readFileSync(path.join(root, 'apps/tieba/tieba-view.js'), 'utf8');
    assert.match(view, /this\.app\.data/, '视图必须经 this.app.data 动态引用数据层');
});