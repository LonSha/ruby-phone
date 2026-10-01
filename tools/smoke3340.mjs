// v3.34.0 老福特无头冒烟：不碰 DOM，只压数据层 + App 的写路径与读数。
import { LofterApp } from '../apps/lofter/lofter-app.js';

// ★ 假 storage 必须**模拟会话隔离**（真实里由 config/storage.js 的 `^lofter_/` 前缀负责）：
//   不隔离的话「换会话」这一步永远读得到同一份数据，冒烟会把自己的夹具假设当成产品缺陷
//   （v3.33.0 那处「夹具假设座位顺序」同型）。
let session = 's1';
const mem = new Map();
const storage = {
    get: (k) => { const kk = session + '::' + k; return mem.has(kk) ? mem.get(kk) : null; },
    set: (k, v) => { mem.set(session + '::' + k, v); },
};

const app = new LofterApp(null, storage);
app.probe();
console.log('1 空态 face =', app.faceReason(), '| 作者池', app.authorsAll().length, '活跃', app.authorsActive().length);
if (app.faceReason() !== 'empty') throw new Error('空态 face 应为 empty，实为 ' + app.faceReason());

// 走一次「收下短文」
const batch = `some preamble
---LOF---
TAG: [N1]
TYPE: short
TITLE: 雨里的那家店
SUMMARY: 他们在旧书店撞上。
TAGS: #宿命 #错过
CONTENT: 雨下了一整夜，伞骨断了三根。他把书往怀里一抱，没说话。
HAS_IMAGES: false
IMAGE_COUNT: 0
COMMENT_1: 路人甲|我看哭了
COMMENT_2: 路人乙|刀味很足
---LOF---
TAG: [N2]
TITLE: 无关紧要的一天
TAGS: #日常
CONTENT: 他买了两盒草莓，一盒放冰箱，一盒放在她门口，然后就走了。
COMMENT_1: 温宁睡不着|这糖是真甜
---LOF---
TAG: [N9]
TITLE: 不存在的作者
CONTENT: 这一块该被丢掉，因为池里没有第 9 号作者。
CONTENT2: xx
`;
const r1 = app.ingestBatch(batch);
console.log('2 ingestBatch =', JSON.stringify(r1));
if (!r1.ok || r1.added !== 2) throw new Error('应只收下 2 篇（N9 越界必须被丢），实为 ' + r1.added);

const arts = app.articlesAll();
console.log('3 文章', arts.length, '| 第一篇标题', arts[0].title, '| 评论', app.commentsOf(arts[0].id).length);

// 统计序关系（心 >= 收藏 >= 评论）
for (const a of arts) {
    const s = a.stats;
    if (!(s.hearts >= s.favorites && s.favorites >= s.comments)) {
        throw new Error('序关系破了: ' + JSON.stringify(s));
    }
}
console.log('4 统计序关系 心>=收藏>=评论 恒成立 ✓');

// 打开 + 互动
const id0 = arts[0].id;
app.openArticle(id0);
console.log('5 足迹', app.stored().myFootprintArticleIds.length, '| 当前', app.currentId() === id0);
app.toggleLike(id0); app.toggleFavorite(id0); app.toggleReadLater(id0);
const fl = app.flagsOf(id0);
console.log('6 四态', JSON.stringify(fl));
if (!(fl.liked && fl.favorited && fl.readLater && fl.footprint)) throw new Error('四态应全 true');

// 评论：楼中楼 + 深度上限改挂
const c1 = app.addComment(id0, '第一条');
const c2 = app.addComment(id0, '回第一条', app.commentsOf(id0)[0].id);
const c3 = app.addComment(id0, '再回一层', app.commentsOf(id0)[1].id);
console.log('7 评论三条 =', JSON.stringify([c1, c2, c3]));
const rows = app.commentRows(id0);
console.log('8 楼中楼（depth） =', rows.map((n) => n.id + '@' + n.depth).join(' '));
if (Math.max(...rows.map((n) => n.depth)) > 3) throw new Error('评论深度超上限 3');

// 自指数据不许死循环
const cyc = [{ id: 'a', replyToCommentId: 'b' }, { id: 'b', replyToCommentId: 'a' }];
const t0 = Date.now();
const top = app.commentCountOf(id0);
console.log('9 commentCountFace =', JSON.stringify(top), '| 自指上溯（应瞬时返回）');
const { topAncestorId } = await import('../apps/lofter/lofter-data.js');
const ta = topAncestorId(cyc, 'a');
console.log('10 topAncestorId(自指) =', ta, '用时', Date.now() - t0, 'ms');

// 合集 + 续章
const rc = app.createCollection({ name: '雾港来信', description: '慢火' });
console.log('11 createCollection =', JSON.stringify(rc));
if (!rc.ok) throw new Error('建合集失败');
const ch1 = app.ingestChapter(rc.id, '第一章的正文，写得长一点好过门。');
const ch2 = app.ingestChapter(rc.id, '第二章的正文，也写得长一点。');
console.log('12 续章 =', JSON.stringify([ch1, ch2]));
if (ch1.chapterNum !== 1 || ch2.chapterNum !== 2) throw new Error('章号应从 1 起递增，实为 ' + ch1.chapterNum + '/' + ch2.chapterNum);
if (ch1.position !== 'opening' || ch2.position !== 'ongoing') throw new Error('章节定位错: ' + ch1.position + '/' + ch2.position);

// 文风库
console.log('13 文风', app.styleList().length, '款');
const rs = app.addStyle('我自己的', '写得慢一点。');
if (!rs.ok) throw new Error('加文风失败');
const dup = app.addStyle('刀子暴击', 'x');
console.log('14 重名拒绝 =', JSON.stringify(dup));
if (dup.ok) throw new Error('重名应被拒');
const delBi = app.removeStyle('lof_style_knife');
console.log('15 删内置 =', JSON.stringify(delBi));
if (delBi.ok) throw new Error('内置款不该能删');
const tog = app.toggleStyle('lof_style_knife');
console.log('16 关内置 =', JSON.stringify(tog));
if (!tog.ok || tog.enabled !== false) throw new Error('关内置失败');

// 订阅 tag 上界
for (let i = 0; i < 45; i++) app.subscribeTag('t' + i);
console.log('17 订阅 tag 数 =', app.stored().subscribedTags.length, '（上限 40）');
if (app.stored().subscribedTags.length !== 40) throw new Error('tag 上界失效');

// 搜索 + 分月
app.setTab('search');
console.log('18 搜索「雨」=', app.search('雨').length, '| 月份组', app.byMonth().length);

// 设置回写不丢文风
app.patchSettings({ chapterLength: 'long' });
console.log('19 改篇幅后文风仍', app.styleList().length, '款 | 篇幅', app.settings.chapterLength);

// 提示词块（两条通道）
const p1 = app.promptShortText('drabble', '重逢', 2, () => 0);
console.log('20 短文提示词长度', p1.length);
const p2 = app.promptChapterText(rc.id);
console.log('21 续章提示词 ok=', p2.ok, 'num=', p2.num, 'position=', p2.position);
const p3 = app.promptCommentText(id0, '写得好', true);
console.log('22 评论提示词 ok=', p3.ok);

// 换会话：假 storage 切会话（真实里是 config/storage.js 按 chatId 拼前缀）
app.setTab('follow');
session = 's2';
app.onChatChanged();
console.log('23 换会话后 face=', app.faceReason(), '| 文章', app.articlesAll().length, '| 关注', app.stored().followedAuthorIds.length, '| tab', app.tab());
if (app.faceReason() !== 'empty') throw new Error('换会话应回到空态，实为 ' + app.faceReason());
if (app.articlesAll().length !== 0) throw new Error('换会话应清空内容');
if (app.tab() !== 'home') throw new Error('换会话应把面收回首页');
// 切回来，账还在（会话隔离是双向的）
session = 's1';
app.probe();
console.log('24 切回原会话：文章', app.articlesAll().length, '| 关注', app.stored().followedAuthorIds.length);
if (app.articlesAll().length !== 4) throw new Error('切回后应还在（4 篇），实为 ' + app.articlesAll().length);

console.log('\n全部无头冒烟通过。');
