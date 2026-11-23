/* ============================================================
 * tests/apps-bilibili-v4.test.mjs — B站「照现实重写」的行为判据
 * ------------------------------------------------------------
 * 这一版把 B站 从「搜索框 + 两张横卡」做成「页签 + 双列流 + 播放页 +
 * 动态/消息/我的/搜索/UP主页」，代码从 317 行涨到 ~3400 行。篇幅不是成绩，
 * 判据才是 —— 本文件钉的是**用户真能做出的那些动作**，不是实现细节：
 *   A 数据层：分区取数 / 三连与关注 / 硬币不足如实拒绝 / 历史去重 /
 *     弹幕与评论（含回复）/ 持久化闭环 / 消息可点开；
 *   B 视图层：每页都画得出来且标签闭合 / 每个 data-act 都有处理分支 /
 *     动作真改数据 / 宿主读不到（querySelector 返回 null）时不许抛；
 *   C 控制器：AI 标签入库、换会话不串味、昵称只写一次不覆盖用户改名。
 * 【为什么标签闭合也判】模板字符串里少一个 `</div>` 在浏览器里会被自动纠正，
 *   于是「看起来没坏」；但在真机上它会把后续节点吃进错误层级（弹层盖不住、
 *   滚动容器错位）。这一条最便宜，也最容易在长篇模板里失守。
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
        this.style = {};
        this.dataset = {};
        this._attrs = new Map();
        this._handlers = new Map();
    }
    addEventListener(t, h) { this._handlers.set(t, h); }
    removeEventListener(t) { this._handlers.delete(t); }
    setAttribute(k, v) { this._attrs.set(String(k), String(v)); }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
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
        set(k, v) { map.set(k, v); },
        remove(k) { map.delete(k); }
    };
};
const fakeEl = (attrs) => ({
    getAttribute: (k) => {
        const name = String(k).indexOf('data-') === 0 ? String(k).slice(5) : String(k);
        return (name in attrs) ? String(attrs[name]) : null;
    }
});
/** 打开播放页并**停掉计时器**：判据只关心画出来的样子与数据；
 *  留着 1s 的播放计时会让测试进程永远不退出（真机上它由离开页面/播完停止）。 */
const openVideo = (app, bvid) => {
    app.view._openVideo(bvid);
    app.view._stopTick();
};
/* 播放页的 1s 计时器在真机上由「离开页面 / 播完 / 图层被移除」停下；
 *  夹具没有真 DOM（isConnected 不存在），所以测试自己收尾：每条判据后统一停表，
 *  否则计时器会把整个测试进程钉在事件循环里不退出。 */
const VIEWS = [];
const mkApp = (shell, storage) => {
    const app = new BiliApp(shell, storage);
    VIEWS.push(app.view);
    return app;
};
afterEach(() => {
    for (const v of VIEWS.splice(0)) {
        try { if (v && typeof v._stopTick === 'function') v._stopTick(); } catch (_e) { /* 收尾尽力 */ }
    }
});

/* 宿主窗口：测试环境可能重复 import，每次都重设成干净的一份。 */
function freshWindow(extra) {
    const w = Object.assign({
        VirtualPhone: {},
        dispatchEvent() {},
        addEventListener() {}
    }, extra || {});
    global.window = w;
    global.document = { createElement: (t) => new El(t), querySelector: () => null };
    return w;
}
freshWindow();

const { BiliData, fmtCount, fmtDur, isBilibiliEntryUrl, normalizeBilibiliEntries, parseBilibiliPayload } =
    await import('../apps/bilibili/bili-data.js');
const { BiliApp } = await import('../apps/bilibili/bili-app.js');

/* ---------- 共用夹具 ---------- */
function seeded() {
    const storage = makeStorage();
    const data = new BiliData(storage);
    data.ensureSeeded();
    return { storage, data };
}

/* ============================================================
 * A. 数据层
 * ============================================================ */
test('A1 构造期不 seed（新会话必须是真空档），ensureSeeded 后才有内容', () => {
    const data = new BiliData(makeStorage());
    assert.equal(data.entries.length, 0);
    data.ensureSeeded();
    assert.ok(data.entries.length >= 16, '至少 16 条：' + data.entries.length);
    assert.equal(data.ensureSeeded(), false, '已有内容时不再重抽');
});

test('A2 页签与分区取数：直播置首、推荐/热门/最新各按自己的口径', () => {
    const { data } = seeded();
    const tabs = data.getTabs();
    assert.equal(tabs[0], '直播');
    assert.ok(tabs.includes('推荐') && tabs.includes('热门'));

    const live = data.getFeed('直播');
    assert.ok(live.length > 0);
    assert.ok(live.every((e) => e.live === true));

    const hot = data.getFeed('热门');
    assert.ok(hot.length > 1);
    for (let i = 1; i < hot.length; i += 1) assert.ok(hot[i - 1].play >= hot[i].play, '热门必须按播放降序');

    const fresh = data.getFeed('最新');
    for (let i = 1; i < fresh.length; i += 1) assert.ok(fresh[i - 1].timestamp >= fresh[i].timestamp, '最新必须按时间降序');

    const life = data.getFeed('生活');
    assert.ok(life.length > 0);
    assert.ok(life.every((e) => e.tname === '生活'), '分区页签只出本分区');
});

test('A3 三连：赞/币/藏对称可撤销；硬币不足如实拒绝而不是静默成功', () => {
    const { data } = seeded();
    const id = data.entries[0].bvid;
    const e = data.getEntry(id);
    /* getEntry 返回的是**活引用**，toggle 会原地改 like；先拍快照再断言，
     *  否则「期望值」跟着实现一起动，判据等于没判。 */
    const like0 = e.like;
    const l1 = data.toggleLike(id);
    assert.deepEqual([l1.on, l1.count], [true, like0 + 1]);
    const l2 = data.toggleLike(id);
    assert.deepEqual([l2.on, l2.count], [false, like0]);

    const c1 = data.toggleCoin(id);
    assert.equal(c1.ok, true);
    assert.equal(c1.on, true);
    assert.equal(c1.coins, 87);
    const c2 = data.toggleCoin(id);
    assert.deepEqual([c2.on, c2.coins], [false, 88]);

    const f1 = data.toggleFav(id);
    assert.equal(f1.on, true);
    assert.equal(f1.favoriteName, '默认收藏夹');
    assert.ok(data.getUser().favored.includes(id), 'favored 是跨夹并集，用于卡片状态');
    const f2 = data.toggleFav(id);
    assert.equal(f2.on, false);
    assert.ok(!data.getUser().favored.includes(id));

    /* 把硬币花光，再投必须拒绝且不记账 */
    data.getUser().coin = 0;
    const before = data.getEntry(id).coin;
    const fail = data.toggleCoin(id);
    assert.equal(fail.ok, false);
    assert.equal(fail.reason, 'no-coin');
    assert.equal(data.getEntry(id).coin, before, '被拒绝时不许改计数');
});

test('A4 硬币进经验并抬等级：level 与 exp/expMax 自洽', () => {
    const { data } = seeded();
    const id = data.entries[0].bvid;
    const u = data.getUser();
    u.exp = 790;
    u.level = 4;
    data.toggleCoin(id);
    const st = data.stats();
    assert.equal(st.exp, 800);
    assert.equal(st.level, 5, '800/200+1 = 5');
    assert.equal(st.expMax, 1000, 'expMax 必须跟着等级走，不能是常数');
});

test('A5 关注 / 动态：没关注就是空态，关注后才出现该 UP 的投稿', () => {
    const { data } = seeded();
    const e = data.entries.find((x) => !x.live);
    const mid = e.upMid;
    assert.deepEqual(data.getDynamics(), { followed: [], items: [] });

    const r = data.toggleFollow(mid);
    assert.equal(r.on, true);
    const dyn = data.getDynamics();
    assert.ok(dyn.items.length > 0);
    assert.ok(dyn.items.every((x) => x.upMid === mid));

    data.toggleFollow(mid);
    assert.equal(data.getDynamics().items.length, 0, '取消关注后动态必须清空（不编造）');
});

test('A6 历史：同一视频只留一条最新、带进度与文案；可单删可清空', () => {
    const { data } = seeded();
    const id = data.entries[0].bvid;
    data.addHistory(id, 10);
    data.addHistory(id, 42);
    const h = data.getHistory();
    assert.equal(h.length, 1);
    assert.equal(h[0].pos, 42);
    assert.ok(h[0].atText, '历史必须带可读时间');

    assert.equal(data.removeHistory(id), true);
    assert.equal(data.getHistory().length, 0);
    data.addHistory(id, 1);
    data.clearHistory();
    assert.equal(data.getHistory().length, 0);
});

test('A7 弹幕与评论：长度上限、回复挂到父评论、评论点赞可撤销', () => {
    const { data } = seeded();
    const id = data.entries[0].bvid;
    const e = data.getEntry(id);
    const dm0 = e.danmakuCount;
    assert.equal(data.addDanmaku(id, ''), null, '空弹幕不许写');
    const dm = data.addDanmaku(id, '一'.repeat(80));
    assert.ok(dm);
    assert.equal(dm.text.length, 40, '弹幕按 40 字截断');
    assert.equal(e.danmakuCount, dm0 + 1);

    const parent = e.comments[0];
    const reply0 = e.comments[0].replies.length;
    const c = data.addComment(id, '回复测试', parent.id);
    assert.ok(c);
    assert.equal(e.comments[0].replies.length, reply0 + 1);
    assert.equal(e.comments[0].replies[reply0].text, '回复测试');

    const likes0 = parent.likes;
    const l1 = data.likeComment(id, parent.id);
    assert.deepEqual([l1.liked, l1.likes], [true, likes0 + 1]);
    const l2 = data.likeComment(id, parent.id);
    assert.deepEqual([l2.liked, l2.likes], [false, likes0]);
});

test('A8 搜索：标题/UP/标签都能命中；空词不出结果；历史去重且可清', () => {
    const { data } = seeded();
    const e = data.entries.find((x) => !x.live);
    assert.ok(data.search(e.upName).length > 0);
    assert.ok(data.search(e.title.slice(0, 4)).length > 0);
    assert.deepEqual(data.search('   '), []);

    data.addSearchHistory('夜航');
    data.addSearchHistory('夜航');
    data.addSearchHistory('料理');
    assert.deepEqual(data.getSearchHistory(), ['料理', '夜航']);
    data.clearSearchHistory();
    assert.deepEqual(data.getSearchHistory(), []);
});

test('A9 持久化闭环：换实例读得回，且落盘是对象不是裸数组', () => {
    const { storage, data } = seeded();
    const id = data.entries[0].bvid;
    data.toggleCoin(id);
    data.toggleFollow(data.entries[0].upMid);
    data.addHistory(id, 7);
    const saved = storage.get('bili_entries_v1');
    assert.equal(Array.isArray(saved), false, 'bili_entries_v1 在 NOT_BARE_ARRAY 名单里：裸数组会丢字符串键');
    assert.ok(saved && typeof saved === 'object');
    assert.ok(Array.isArray(saved.entries) && saved.user);

    const again = new BiliData(storage);
    assert.equal(again.getUser().coin, 87);
    assert.equal(again.getUser().following.length, 1);
    assert.equal(again.getHistory()[0].pos, 7);
});

test('A10 收藏夹：同名不许重复建；新建后可指定收进去', () => {
    const { data } = seeded();
    assert.equal(data.createFavorite(''), null);
    assert.equal(data.createFavorite('默认收藏夹'), null, '同名必须拒绝');
    const fav = data.createFavorite('夜里看');
    assert.ok(fav && fav.id);
    const id = data.entries[0].bvid;
    const r = data.toggleFav(id, fav.id);
    assert.equal(r.favoriteName, '夜里看');
    const mine = data.getFavorites().find((f) => f.id === fav.id);
    assert.ok(mine, '新建的收藏夹必须出现在列表里');
    assert.deepEqual(mine.videos.map((v) => v.bvid), [id], '收进去的那条要能反查回条目');
    assert.equal(mine.count, 1);
});

test('A11 时间：同一条内容重复取数时间戳稳定；相对文案跟着剧情钟走', () => {
    const { data } = seeded();
    const snap = new Map(data.entries.map((e) => [e.bvid, e.timestamp]));
    const sig = (list) => list.map((e) => e.bvid + ':' + e.timestamp).join('|');
    /* 注意口径：`entries` 是「本会话已有的那批」，`getFeed('推荐')` 会按分区
     *  补足展示条数，两者条数不必相等 —— 只判**同一条**的发布时刻不许漂。 */
    const f1 = data.getFeed('推荐');
    const f2 = data.getFeed('推荐');
    assert.equal(sig(f1), sig(f2), '同一个时钟下重复取数，顺序与时刻都要稳定');
    for (const e of f1) {
        if (snap.has(e.bvid)) assert.equal(e.timestamp, snap.get(e.bvid), e.bvid + ' 的发布时刻漂了');
    }
    assert.ok(data.entries.every((e) => e.timestamp > 0 && e.timestamp < Date.now() + 1000));
    assert.ok(data.entries.every((e) => typeof e.pubText === 'string' && e.pubText.length > 0));
});

test('A12 导出纯函数：计数口径 / 时长 / 本 App 地址判定 / 标签解析', () => {
    assert.equal(fmtCount(12800), '1.3万');
    assert.equal(fmtCount(1280000), '128万');
    assert.equal(fmtCount(0), '0');
    assert.equal(fmtDur(3661), '1:01:01');
    assert.equal(fmtDur(59), '0:59');
    assert.equal(isBilibiliEntryUrl('phone://bilibili/video/BV1xx'), true);
    assert.equal(isBilibiliEntryUrl('https://m.bilibili.com/video/BV1xx'), true);
    assert.equal(isBilibiliEntryUrl('https://example.com/x'), false);

    const payload = parseBilibiliPayload(JSON.stringify({ videos: [{ title: 'T', up: 'U', duration: '3:20', play: '12.8万' }] }), 'q');
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].play, 128000);
    const norm = normalizeBilibiliEntries([{ title: 'A', up: 'B' }], 'q');
    assert.equal(norm.length, 1);
    assert.ok(norm[0].bvid && norm[0].durationText);
});

test('A13 模型标签：<Bilibili>/<Bili> 都能入库，一条消息多个标签也算', () => {
    const { data } = seeded();
    const n0 = data.entries.length;
    const added = data.parseFromMessage(
        '前文<Bilibili>{"videos":[{"title":"甲","up":"UP甲"}]}</Bilibili>中间'
        + '<Bili>[{"title":"乙","up":"UP乙"}]</Bili>后文'
    );
    assert.equal(added.length, 2);
    assert.equal(data.entries.length, n0 + 2);
    assert.ok(data.entries.some((e) => e.title === '甲'));
    assert.ok(data.entries.some((e) => e.title === '乙'));
    assert.deepEqual(data.parseFromMessage('没有标签的普通消息'), []);
});

/* ============================================================
 * B. 视图层
 * ============================================================ */
function tagBalance(html) {
    const bad = [];
    for (const tag of ['div', 'button', 'span', 'article', 'nav', 'p', 'h1']) {
        const open = (html.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length;
        const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
        if (open !== close) bad.push(tag + ':' + open + '/' + close);
    }
    return bad;
}
const KNOWN_ACTS = new Set(['back', 'home', 'nav', 'search', 'message', 'tab', 'refresh', 'space', 'open',
    'toggle', 'seek', 'like', 'coin', 'fav', 'later', 'share', 'share-close', 'share-copy', 'follow',
    'dm-send', 'cmt-send', 'cmt-like', 'cmt-reply', 'cmt-cancel', 'cmt-expand', 'search-go', 'hot',
    'hist-clear-q', 'hist-del', 'hist-clear', 'shelf', 'shelf-tab', 'fav-all', 'fav-new', 'fav-cancel',
    'fav-create']);

test('B1 每一页都画得出来、标签闭合、data-act 都有处理分支', () => {
    const storage = makeStorage();
    const screen = new El('div');
    const app = mkApp({ screen }, storage);
    app.render();

    const seen = new Set();
    const check = (name) => {
        const html = screen.innerHTML;
        assert.deepEqual(tagBalance(html), [], name + ' 标签不闭合');
        const re = /data-act="([^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) seen.add(m[1]);
        assert.ok(html.length > 200, name + ' 画出来是空的');
    };

    const view = app.view;
    const e = app.data.entries.find((x) => !x.live);
    check('home');
    openVideo(app, e.bvid); check('video');
    view._act('space', fakeEl({ mid: e.upMid })); check('space');
    view._act('nav', fakeEl({ nav: 'dynamic' })); check('dynamic');
    view._act('nav', fakeEl({ nav: 'message' })); check('message');
    view._act('nav', fakeEl({ nav: 'mine' })); check('mine');
    view._act('shelf', fakeEl({ tab: '历史' })); check('shelf-history');
    view._act('shelf', fakeEl({ tab: '收藏' })); check('shelf-fav');
    view._act('shelf', fakeEl({ tab: '稍后再看' })); check('shelf-later');
    view._act('search', fakeEl({})); check('search');
    view._doSearch(e.upName); check('search-result');
    view._act('nav', fakeEl({ nav: 'publish' })); check('publish');

    const unknown = [...seen].filter((a) => !KNOWN_ACTS.has(a));
    assert.deepEqual(unknown, [], '这些 data-act 在界面上点得到、代码里没人接');
});

test('B2 播放页动作：点赞/投币/收藏/稍后再看/关注都真改数据', () => {
    const storage = makeStorage();
    const screen = new El('div');
    const app = mkApp({ screen }, storage);
    app.render();
    const e = app.data.entries.find((x) => !x.live);
    openVideo(app, e.bvid);

    const like0 = app.data.getEntry(e.bvid).like;
    app.view._act('like', fakeEl({ bvid: e.bvid }));
    assert.equal(app.data.getEntry(e.bvid).like, like0 + 1);

    const coin0 = app.data.getEntry(e.bvid).coin;
    app.view._act('coin', fakeEl({ bvid: e.bvid }));
    assert.equal(app.data.getEntry(e.bvid).coin, coin0 + 1);

    app.view._act('fav', fakeEl({ bvid: e.bvid }));
    assert.ok(app.data.getUser().favored.includes(e.bvid));
    app.view._act('later', fakeEl({ bvid: e.bvid }));
    assert.ok(app.data.getUser().watchLater.includes(e.bvid));
    app.view._act('follow', fakeEl({ mid: e.upMid }));
    assert.ok(app.data.getUser().following.includes(e.upMid));
    app.view._act('dm-send', fakeEl({}));
    app.view._act('cmt-send', fakeEl({}));
});

test('B3 收藏夹过滤：点某个夹子只显示那一夹，且有「全部收藏夹」出口', () => {
    const storage = makeStorage();
    const screen = new El('div');
    const app = mkApp({ screen }, storage);
    app.render();
    const e = app.data.entries.find((x) => !x.live);
    const fav = app.data.createFavorite('只看这一夹');
    app.data.toggleFav(e.bvid, fav.id);
    app.view._act('shelf', fakeEl({ tab: '收藏', fid: fav.id }));
    assert.ok(screen.innerHTML.includes('只看这一夹'));
    assert.ok(screen.innerHTML.includes('全部收藏夹'));
    app.view._act('fav-all', fakeEl({}));
    assert.ok(screen.innerHTML.includes('默认收藏夹'));
});

test('B4 宿主读不到 DOM 时不许抛（querySelector 全 null）', () => {
    const app = mkApp({ screen: new El('div') }, makeStorage());
    const view = app.view;
    app.render();
    assert.doesNotThrow(() => view._toast('提示'));
    assert.doesNotThrow(() => view._patchPlayer());
    assert.doesNotThrow(() => view._patchActs());
    assert.doesNotThrow(() => view._patchComments());
    assert.doesNotThrow(() => view._patchProgress());
    assert.doesNotThrow(() => view._seekTo(null));
    assert.doesNotThrow(() => view._copy('phone://bilibili/x'));
    assert.doesNotThrow(() => view.render(null));
});

test('B5 条目被换掉后打开播放页会如实回首页，不留空白播放器', () => {
    const app = mkApp({ screen: new El('div') }, makeStorage());
    app.render();
    const e = app.data.entries.find((x) => !x.live);
    openVideo(app, e.bvid);
    app.data.entries = [];
    app.view._paint();
    assert.equal(app.view.page, 'home');
    assert.ok(app.view.container.innerHTML.includes('data-page="home"'));
});

/* ============================================================
 * C. 控制器
 * ============================================================ */
test('C1 AI 标签入库：注册一次、只在真带标签时才动数据', () => {
    const listeners = [];
    freshWindow({
        SillyTavern: {
            getContext: () => ({
                name1: '林深',
                eventSource: { on: (evt, fn) => listeners.push({ evt, fn }) },
                event_types: { MESSAGE_RECEIVED: 'message_received' }
            })
        }
    });
    const screen = new El('div');
    const app = mkApp({ screen }, makeStorage());
    assert.equal(listeners.length, 1, '构造期只注册一个监听');

    app.render();
    const n0 = app.data.entries.length;
    const fn = listeners[0].fn;
    fn({ message: { mes: '随便聊两句，没有标签。' } });
    assert.equal(app.data.entries.length, n0, '没有标签就不许刷新内容');

    fn({ message: { mes: '<Bilibili>{"videos":[{"title":"从聊天里来的","up":"聊天UP"}]}</Bilibili>' } });
    assert.ok(app.data.entries.some((e) => e.title === '从聊天里来的'));
    assert.ok(screen.innerHTML.includes('从聊天里来的'), '入库后界面要重绘');
    freshWindow();
});

test('C2 换会话：只重建数据层、不重建实例；用户改名不被宿主称呼覆盖', () => {
    freshWindow({ SillyTavern: { getContext: () => ({ name1: '林深' }) } });
    const storage = makeStorage();
    const app = mkApp({ screen: new El('div') }, storage);
    app.render();
    const view = app.view;
    assert.equal(app.data.getUser().name, '林深', '装配期先把宿主称呼写进昵称');
    app.data.setUserName('自己起的名字');
    /* 同一会话重开 App：改名已经在存档里，宿主称呼不许再盖回来。 */
    const again = mkApp({ screen: new El('div') }, storage);
    assert.equal(again.data.getUser().name, '自己起的名字', '用户改名后不再被宿主称呼覆盖');
    storage.map.clear();
    app.onChatChanged();
    assert.equal(app.view, view, '实例与视图必须保留（否则监听器会累积）');
    assert.equal(app.data.entries.length, 0, '新会话是空档');
    freshWindow();
});

test('C3 控制器持有的两处接线不许退化（v2.24 同款判据）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(root, 'apps/bilibili/bili-app.js'), 'utf8');
    assert.match(src, /onChatChanged\s*\(\s*\)\s*\{/);
    assert.ok(src.includes('this.data = new BiliData(this.storage);'));
    assert.match(src, /this\.view = new \w+View\(this\)/);
    const view = fs.readFileSync(path.join(root, 'apps/bilibili/bili-view.js'), 'utf8');
    assert.match(view, /this\.app\.data/, '视图必须经 this.app.data 动态引用数据层');
});
