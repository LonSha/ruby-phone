/* smoke3350.mjs — Pixiv App 无头冒烟（不碰 DOM；只走数据层 + App 层）。
 * 读数为「A…Z」逐项打印，全绿才算端到端通。
 * 用法：node tools/smoke3350.mjs
 */
import { readFileSync } from 'node:fs';
import {
    PIXIV_LIMITS, PIXIV_BUILT_IN_AUTHORS, PIXIV_WRITING_STYLES, PIXIV_REASONS,
    PIXIV_PURITY_RULE, parseCommentsBlock,
} from '../apps/pixiv/pixiv-data.js';
import * as DAT from '../apps/pixiv/pixiv-data.js';
import { PixivApp } from '../apps/pixiv/pixiv-app.js';

let bad = 0;
const say = (k, v) => { console.log(k + ' ' + (typeof v === 'string' ? v : JSON.stringify(v))); };
const must = (cond, k, v) => { if (!cond) { bad += 1; say('✗ ' + k, v); } else say('✓ ' + k, v); };

/** 内存 storage（与 PhoneStorage 的 get/set 同形）。 */
function memStorage() {
    const m = new Map();
    return {
        get: (k) => (m.has(k) ? m.get(k) : null),
        set: (k, v) => { m.set(k, v); },
        _dump: () => [...m.keys()],
    };
}

const st = memStorage();
const app = new PixivApp(null, st);

/* A 冷启动：脸面 / 内置池 */
app.probe();
must(app.faceReason() === PIXIV_REASONS.empty, 'A 冷启动脸面=empty', app.faceReason());
must(app.authorsAll().length === PIXIV_BUILT_IN_AUTHORS.length, 'A 内置池 9 位', app.authorsAll().length);
must(app.authorsActive().length === 8, 'A 活跃 8 / 非活跃 1', [app.authorsActive().length, app.readings().inactiveAuthors]);

/* B 建作品 + 收一章 */
const r1 = app.createNovel({ title: '雪の日の電車', synopsis: '冬の海へ向かう話', tagLine: '純愛 日常' });
must(r1.ok === true, 'B 建作品 ok', r1);
const nid = r1.id;
const r2 = app.ingestChapter(nid, '窓の外は雪だった。彼女は静かに笑った。' + 'あ'.repeat(400), { title: '第 1 話 雪' });
must(r2.ok === true && r2.num === 1, 'B 收第 1 話', r2);
const r3 = app.ingestChapter(nid, '春が来た。' + 'い'.repeat(600), { title: '第 2 話 春' });
must(r3.ok === true && r3.num === 2, 'B 收第 2 話', r3);
must(app.nextNumOf(nid) === 3, 'B 下一話号=3', app.nextNumOf(nid));

/* C 心数确定性 + 自洽 */
const h1 = app.heartsOf(nid);
const h2 = app.heartsOf(nid);
must(JSON.stringify(h1) === JSON.stringify(h2), 'C 心数两次读数一致', h1);
must(h1.consistent === true, 'C 缓存==逐章最高', h1);

/* D 续章滑窗 */
const ctx = app.prevContextOf(nid, 3);
must(ctx.fullCount === 2 && ctx.digestCount === 0, 'D 滑窗 2 全文 0 摘要', { f: ctx.fullCount, d: ctx.digestCount });

/* E 评论三态 */
let cf = app.commentCountOf(nid, 1);
must(cf.face === 'not_read', 'E 未读=not_read', cf);
app.ingestComments(nid, 1, null, true);
cf = app.commentCountOf(nid, 1);
must(cf.face === 'failed', 'E 失败=failed（不是 not_read）', cf);
app.ingestComments(nid, 1, [
    { id: 'c1', author: '読者A', content: 'いい話でした' },
    { id: 'c2', author: '読者B', content: '泣いた', replyToCommentId: 'c1' },
]);
cf = app.commentCountOf(nid, 1);
must(cf.face === 'read' && cf.count === 2, 'E 读过=read/2 条', cf);

/* F 我的评论 + 父指针防悬空 */
const ac = app.addComment(nid, 1, 'ありがとう', 'c2');
must(ac.ok === true && ac.rehomed === false, 'F 回 c2（深度 2 < 上限 3）', ac);
const deep = app.addComment(nid, 1, 'さらに', ac.rehomed ? 'c2' : 'c2');
must(deep.ok === true, 'F 再回一条', deep);
const tree = app.commentTreeOf(nid, 1);
must(tree.orphans === 0, 'F 无孤儿', { o: tree.orphans, t: tree.truncated });

/* G 逐章点赞 */
const liked = app.toggleChapterLike(nid, 1);
must(liked.ok === true && liked.liked === true, 'G 点心', liked);
const unliked = app.toggleChapterLike(nid, 1);
must(unliked.ok === true && unliked.liked === false, 'G 取消点心', unliked);
must(app.chapterAt(nid, 1).likeBoost === 0, 'G likeBoost 不为负', app.chapterAt(nid, 1).likeBoost);

/* H reroll：章对象整体换新 + 评论清零 */
const before = app.chapterAt(nid, 1);
const rr = app.ingestChapter(nid, '書き直した第 1 話。' + 'う'.repeat(200), { mode: 'reroll', chapterNum: 1 });
must(rr.ok === true && rr.commentsCleared === true, 'H reroll 评论清零', rr);
must(rr.identity.comparable === true && rr.identity.sameObject === false, 'H 身份面：非同一对象', rr.identity);
must(app.chapterAt(nid, 1) !== before, 'H 章对象确实换新', true);

/* I 互动四本账 */
app.toggleFavorite(nid);
app.toggleFollowing(nid);
app.toggleFollowAuthor(PIXIV_BUILT_IN_AUTHORS[0].id);
const sub = app.subscribeTag('純愛');
must(sub.ok === true, 'I 订阅 tag', sub);
const store = app.stored();
must(store.favoritedNovelIds.length === 1 && store.followingNovelIds.length === 1
    && store.followedAuthorIds.length === 1 && store.subscribedTags.length === 1, 'I 四本账各 1', {
    f: store.favoritedNovelIds.length, g: store.followingNovelIds.length,
    a: store.followedAuthorIds.length, t: store.subscribedTags.length,
});

/* J 插画登记：零地址字段 */
const il = app.ingestIllust({ prompt: '雪夜の電車', size: '1024x1024', count: 2 });
must(il.ok === true, 'J 登记插画', il);
const item = app.illustById(il.id);
const keys = Object.keys(item).sort().join(',');
must(keys.indexOf('url') < 0 && keys.indexOf('blob') < 0 && keys.indexOf('data') < 0, 'J 登记条零地址字段', keys);
must(item.drawnBy.length > 0, 'J 记了「谁画的」', item.drawnBy);

/* K 生成要求（只产文本，不发请求） */
const pb = app.copyPrompt('chapter', { novel: app.novelById(nid), chapterNum: 3 });
must(pb.ok === true && pb.text.indexOf('本 App 不会自己去调模型') >= 0, 'K 续章要求文本', pb.text.slice(0, 40));
const pi = app.copyPrompt('illust', { prompt: '海', count: 1 });
must(pi.ok === true && pi.text.indexOf('登记回本 App 的插画登记面') >= 0, 'K 出图要求文本', pi.text.slice(0, 40));

/* L 正文净化：白名单 + 计数 */
const s1 = app.sanitize('<details class="tl"><summary>訳</summary>中文</details>');
must(s1.html.indexOf('<details') >= 0 && s1.droppedTags === 0, 'L 白名单放行', s1);
const s2 = app.sanitize('<script>alert(1)</script>');
/* 开闭两个标签各计一次（本件的口径就是**逐标签计**，不逞「一对算一个」） */
must(s2.droppedTags === 2 && s2.html.indexOf('<script') < 0, 'L 非白名单逐标签挡下并计数', s2);
const s3 = app.sanitize('<details class="evil">x</details>');
must(s3.droppedAttrs === 1, 'L 非法属性只计 1 次', s3);

/* M 段落渲染 */
const paras = app.paragraphsOf(nid, 2);
must(paras.length >= 1 && typeof paras[0].html === 'string', 'M 段落渲染', paras.length);

/* M2 设置键确实落盘（冷启动不写；改一次设置就该出现第三条键） */
app.patchSettings({ maxInjectLines: 6 });
must(st.get('pixiv_settings') !== null, 'M2 改设置后 settings 键出现', st._dump().sort());

/* N 检索 / 分月 / tag */
must(app.search('雪').length >= 1, 'N 本地检索命中', app.search('雪').length);
must(app.byMonth().length >= 1, 'N 分月', app.byMonth().length);
must(app.tagFeed('純愛').length >= 1, 'N tag 过滤', app.tagFeed('純愛').length);

/* O 上限裁剪如实回报（此前已订阅 1 个，故再塞 N+2 个会丢 3 个） */
const exp = [];
for (let i = 0; i < PIXIV_LIMITS.maxSubscribedTags + 2; i++) {
    const r = app.subscribeTag('t' + i);
    if (r.dropped) exp.push(r.dropped);
}
must(exp.length === 3 && exp.every((x) => x === 1), 'O 订阅超限逐条回报丢 1', exp.length);
must(app.stored().subscribedTags.length === PIXIV_LIMITS.maxSubscribedTags, 'O 订阅池 = 上限', app.stored().subscribedTags.length);

/* P 落盘三条键 + 跨实例可读 */
const keysUsed = st._dump().sort();
must(keysUsed.length === 3
    && keysUsed.indexOf('pixiv_settings') >= 0
    && keysUsed.indexOf('pixiv_content') >= 0
    && keysUsed.indexOf('pixiv_store') >= 0, 'P 只落三条会话键', keysUsed);
const app2 = new PixivApp(null, st);
app2.probe();
must(app2.novelsAll().length === 1, 'P 第二个实例读得到同一份', app2.novelsAll().length);
must(app2.stored().followedAuthorIds.length === 1, 'P 互动账也读得到', app2.stored().followedAuthorIds.length);

/* Q 自建作者只落非内置（内置不重复落盘） */
app.addAuthor({ name: '自建写手', type: 'doufan_writer'.replace('doufan', 'dou'), bio: 'テスト' });
const app3 = new PixivApp(null, st);
app3.probe();
must(app3.authorsAll().length === PIXIV_BUILT_IN_AUTHORS.length + 1, 'Q 自建 +1', app3.authorsAll().length);
const contentRaw = JSON.parse(st.get('pixiv_content'));
must(contentRaw.authors.length === 1, 'Q 落盘的作者只有自建那 1 位', contentRaw.authors.length);

/* R 文风库：加 / 启停 / 删 */
const st1 = app3.addStyle('我的文风', '短句，留白');
must(st1.ok === true, 'R 加文风', st1);
const tg = app3.toggleStyle(st1.id);
must(tg.ok === true && tg.enabled === false && tg.enabledCount === PIXIV_WRITING_STYLES.length, 'R 关掉后只剩内置开着', tg);
const rm = app3.removeStyle(st1.id);
must(rm.ok === true, 'R 删自建文风', rm);
const rmBuiltIn = app3.removeStyle(PIXIV_WRITING_STYLES[0].id);
must(rmBuiltIn.ok === false, 'R 内置不许删', rmBuiltIn.error);

/* S 完成态：短篇本就没有「完结连载」这回事（**拒绝**才是对的）+ 连载能标 */
const coShort = app3.setCompleted(nid, true);
must(coShort.ok === false, 'S 短篇没有「完结连载」这回事', coShort.error);
const serial = app3.createNovel({ title: '長編', isSerial: true, tagLine: '群像' });
app3.ingestChapter(serial.id, '第一話。' + 'か'.repeat(100));
const coSer = app3.setCompleted(serial.id, true);
must(coSer.ok === true && coSer.completed === true, 'S 连载能标完结', coSer);
const pos = app3.positionOf(nid, 1, false);
must(pos.kind === 'opening', 'S 第 1 話=开篇', pos);

/* V 挑选面：三个读数分开 + 给视图的是数组（缺陷②的守） */
const recList = app.recommendAuthors(3, '', 7);
must(Array.isArray(recList), 'V recommendAuthors 给数组（视图可迭代）', Array.isArray(recList));
must(recList.length === 3, 'V 挑出 3 位', recList.length);
const recFace = app.recommendFace(3, '', 7);
must(recFace.picked.length === recList.length
    && typeof recFace.considered === 'number' && typeof recFace.matched === 'number',
    'V recommendFace 三读数分开', { p: recFace.picked.length, c: recFace.considered, m: recFace.matched });
must(JSON.stringify(app.recommendAuthors(3, '', 7)) === JSON.stringify(recList), 'V 同 seed 定序一致');

/* W 视图契约：不再拿对象当数组，假面清干净 */
const viewSrc = readFileSync(new URL('../apps/pixiv/pixiv-view.js', import.meta.url), 'utf8');
must(viewSrc.indexOf('app.recommendAuthors(') >= 0 && viewSrc.indexOf('app.recommendFace(') < 0,
    'W 视图只消费数组形态（recommendFace 不进视图）');
must(viewSrc.indexOf('pxv-cmt-again') < 0 && viewSrc.indexOf('this._open = this._open') < 0,
    'W 假按钮与废语句都清掉了');
must(viewSrc.indexOf('pxv-cmt-ingest') >= 0 && viewSrc.indexOf('ingestCommentsText') >= 0,
    'W 回填通道在视图里有入口');

/* X 评论回填：解析器 + 端到端 */
const pb2 = parseCommentsBlock('---COMMENT---\nAUTHOR: 読者A\nいい話でした\n---COMMENT---\nREPLY: 1\n泣いた\n---COMMENT---\nAUTHOR: 空\n');
must(pb2.items.length === 2 && pb2.skipped === 1 && pb2.blocks === 3,
    'X 解析 2 条 / 空块 1 / 共 3 块', { i: pb2.items.length, s: pb2.skipped, b: pb2.blocks });
must(pb2.items[1].replyToCommentId === pb2.items[0].id, 'X REPLY 序号挂到本次第 1 条', pb2.items[1].replyToCommentId);
const rIn = app.ingestCommentsText(nid, 2, '---COMMENT---\nAUTHOR: 路人\n面白かった\n');
must(rIn.ok === true && rIn.added === 1, 'X 文本回填进 App', rIn);
const emptyIn = app.ingestCommentsText(nid, 2, '   ');
must(emptyIn.ok === false, 'X 空文本被拒（不是静默成功）', emptyIn.error);

/* Y 坏章号：不许静默补号、不许错配、不许撞号（真缺陷④的守） */
const badNum = app3.createNovel({ title: '坏号篇', tagLine: '测试' });
app3.ingestChapter(badNum.id, '正常一話。' + 'あ'.repeat(80), { title: '正常' });
must(app3.chapterAt(badNum.id, 1).num === 1, 'Y 正常章号保真', app3.chapterAt(badNum.id, 1).num);
// 直接往盘上塞一条坏号章（模拟外源数据），再重建实例读回
const rawBox = JSON.parse(st.get('pixiv_content'));
const badNovel = rawBox.novels.filter((x) => x.id === badNum.id)[0];
badNovel.chapters.push({ num: 'nope', content: '坏号的一話。', hearts: 77 });
st.set('pixiv_content', JSON.stringify(rawBox));
const app4 = new PixivApp(null, st);
app4.probe();
const chs = app4.chaptersOf(badNum.id);
must(chs.length === 2, 'Y 坏号章条数如实（不被静默丢掉）', chs.length);
must(chs.filter((c) => c.num === null).length === 1, 'Y 坏号即 null（不补成位置号）', chs.map((c) => c.num));
must(app4.chapterAt(badNum.id, 1) !== null, 'Y 好章仍按号查得到', !!app4.chapterAt(badNum.id, 1));
const numSet = chs.map((c) => c.num).filter((x) => x !== null);
must(new Set(numSet).size === numSet.length, 'Y 无同号章（补号撞号是旧形态）', numSet);
must(chs.filter((c) => c.num === null)[0].hearts === 77, 'Y 显式给的心数保住（0 也算给过）', chs.filter((c) => c.num === null)[0].hearts);
must(app4.statsOf(badNum.id).countableChapters === 1, 'Y 可数章与总条数分开报', app4.statsOf(badNum.id).countableChapters);

/* T 认源：坏 storage */
const badApp = new PixivApp(null, {
    get: () => { throw new Error('boom'); },
    set: () => { throw new Error('boom'); },
});
badApp.probe();
must(badApp.faceReason() === PIXIV_REASONS.storage_absent, 'T 坏 storage=storage_absent', badApp.faceReason());
must(badApp.projection() === null, 'T 投影为 null', badApp.projection());

/* U 设置面：语言白名单 / 字号夹紧 */
badApp.patchSettings({ language: 'nope', fontSize: 99 });
must(badApp.settings.language === 'jp-cn' && badApp.settings.fontSize === 24, 'U 坏值走白名单/夹紧', {
    l: badApp.settings.language, f: badApp.settings.fontSize,
});

/* Z 首轮测试自红暴露的三处产品缺陷（修掉后必须留在硬门禁里） */
must(DAT.normalizeChapter({ num: 0, content: 'x' }, 0).num === 0, 'Z 章号 0 是合法的（不许抬成 1）',
    DAT.normalizeChapter({ num: 0, content: 'x' }, 0).num);
must(DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num === 0, 'Z 负数抬到下界 0',
    DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num);
const cycTree = DAT.buildCommentTree([
    { id: 'a', content: '1', replyToCommentId: 'b' },
    { id: 'b', content: '2', replyToCommentId: 'a' },
], 3);
must(cycTree.roots.length >= 1, 'Z 互指环不许从树上消失（各自当根）', cycTree.roots.length);
must(cycTree.cycleRoots >= 1, 'Z 环内节点必须如实计数', cycTree.cycleRoots);
const draftApp = new PixivApp(null, memStorage());
draftApp.probe();
const draft = draftApp.createNovel({ title: '草稿篇', tagLine: '純愛' });
must(draftApp.novelsAll().length === 1, 'Z 自建草稿建完就看得见（不许被可见集吞掉）',
    draftApp.novelsAll().length);
must(draftApp.novelsAll()[0].id === draft.id, 'Z 看得见的正是刚建的那篇',
    draftApp.novelsAll()[0].id);
const jpText = draftApp.copyPrompt('chapter', {
    novel: draftApp.novelById(draft.id), chapterNum: 1, language: 'jp-cn',
});
must(jpText.text.indexOf(PIXIV_PURITY_RULE.slice(0, 24)) >= 0,
    'Z 日语要求文本必须真含纯度规则（算了没人读 = 规则不存在）', jpText.text.slice(0, 60));

console.log(bad === 0 ? '\nSMOKE-3350 ALL GREEN' : ('\nSMOKE-3350 FAILED: ' + bad));
process.exit(bad === 0 ? 0 : 1);