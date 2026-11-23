/* ========================================================
 * RubyPhone — SillyTavern 虚拟智能手机 UI
 * 作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
/* ============================================================
 * apps/bilibili/bili-data.js — B站数据层（v4.160.0 照现实重写）
 * ------------------------------------------------------------
 * 为什么要重写：旧实现只有 167 行、两个写死的「兜底条目」，首页只有
 *   搜索框 + 两张横卡。现实里的 B站 是**分区页签 + 双列瀑布流 + 播放页
 *   （弹幕/三连/评论）+ 动态 + 我的 + 搜索 + UP 主页**。旧数据结构缺字段
 *   （没有时长、没有分区、没有三连计数、没有评论树），界面就不可能对。
 *
 * 【存储：单键】只写 `bili_entries_v1` 一个键（会话隔离，见
 *   config/storage.js 的 /^bili_/ 与 scripts/keys-audit.mjs 的登记）。
 *   为什么不再拆键：键越多，「换会话只重建一部分」的串味面越大；B站 的
 *   用户态（硬币/关注/历史/收藏）与内容本来就是同一次会话的同一份账。
 *
 * 【三个时间字段的归属（config/time-source.js 的闭集纪律）】
 *   · `timestamp`（story 档）—— 视频在**角色世界里**发布的那一刻。用户可见，
 *     走 `storyNowWallFallback()`；剧情钟读不到时显式降级并在 reason 留档。
 *   · `at`（wall 档）—— 观看历史的审计流水，必须单调，剧情回拨不许让它倒退。
 *   · `atText` —— 由 `at` 派生的展示文案（「今天 12:30」）。它不是时刻字段，
 *     是已经算好的字符串；存文案是为了避免「渲染时再取一次钟」而漂移。
 *   本文件**不出现**裸 `Date.now()`：墙钟唯一出口是 time-source 的 wallNow()。
 *
 * 【不猜纪律】读不到就如实空着：
 *   · 没关注任何 UP主 ⇒ 动态页空态，不编造「关注的 UP 更新了」；
 *   · 分区里没条目 ⇒ 空态「这个分区今天没刷到」，不拿别的分区顶替；
 *   · AI 给的字段缺失 ⇒ 补默认值并写明补的是什么，不假装有数据。
 * ============================================================ */
import { storyNowWallFallback, wallNow } from '../../config/time-source.js';
/* 数值口径**全仓唯一实现**：不在这里再写一份弱口径。weak-coercion 门 W2b 的
 * 判据是「族名函数体内出现 Number( 且非纯转发」——本文件的 numOr 只做转发 + 兜默认值，
 * 这样 `null` / `''` / `[]` / `true` 仍按「没给」处理，不会被读成 0。 */
import { numOrNull } from '../../config/num-gate.js';

/* [v4.190.0] 文本 / 计数 / 时间 / 标识 的纯函数一律取自唯一内核 bili-format.js，
 *   本文件不再保留第二份实现（判据 system-v4190 的 C2 逐条钉住这一点）。 */
import {
    hash32 as fmtHash32, b62 as fmtB62, makeBvid, makeMid, seededInt,
    compactText, parseCount, fmtCount, fmtDur, parseDur,
    timeAgo, wallStampText, makeLocalBilibiliUrl, isBilibiliEntryUrl
} from './bili-format.js';

/* [v4.191.0] 修 v4.190.0 抽取时漏掉的本地别名：本文件有 48 处 `numOr(...)` 与
 *   16 处 `hash32(...)` 调用，而内核给的名字是 numOrNull / fmtHash32。
 *   numOr 只做转发 + 兜默认值（不自己写 Number() 弱口径，口径全在 num-gate）。 */
const hash32 = fmtHash32;
const numOr = (value, fallback = 0) => {
    const n = numOrNull(value);
    return n == null ? fallback : n;
};

/* ---------- 0. 常量 ---------- */
const STORAGE_KEY = 'bili_entries_v1';
const MAX_ENTRIES = 24;          // 一批最多留多少条
const SEED_BATCH = 16;           // 每次刷新抽多少条
const COIN_START = 88;           // 新会话初始硬币
const COIN_DAILY = 2;            // 每日登录赠送
const EXP_PER_COIN = 10;
const LEVEL_STEP = 200;


/* 分区 → 图标（没有封面图时的程序化封面要用它）。
 * 现实 B站 每个分区都有自己的视觉气质，这里用图标 + 渐变色块表达，
 * 而不是塞一张假图片（假图片一眼就假，色块至少是诚实的占位）。 */
const TNAME_EMOJI = {
    生活: '🌃', 动画: '🎬', 番剧: '📺', 美食: '🍜', 科技: '🔧', 数码: '📱',
    知识: '📚', 音乐: '🎧', 动物: '🐈', 体育: '🏀', 运动: '⚽', 汽车: '🚗',
    时尚: '👕', 鬼畜: '🔁', 影视: '🎥', 舞蹈: '💃', 直播: '📡', 游戏: '🎮', 娱乐: '🎪'
};

/* ---------- 1. 基础纯函数 ---------- */

/* ---------- 2. 内容池 ---------- */
/* 【为什么是池而不是噪声拼串】噪声拼出来的标题读一眼就假。这里每个分区给
 *   成句的标题 + 简介 + 弹幕 + 评论，抽签只负责组合，句子本身是人写的。
 *   UP 主名一律是虚构的（不搬真实 UP 主），避免把编的内容挂到真人名下。 */

const UP_POOL = [
    { name: '夜航影像', sign: '拍点安静的，剪点慢的', fans: 1420000 },
    { name: '拆机老李', sign: '手机 / 电脑 / 拆开看看再说', fans: 863000 },
    { name: '半糖料理', sign: '一个人也要好好吃饭', fans: 2210000 },
    { name: '观星指南', sign: '把夜空讲慢一点', fans: 674000 },
    { name: '动画区小满', sign: '只聊看完还想再看一遍的', fans: 1180000 },
    { name: '十一点之后', sign: '深夜城市观察员', fans: 396000 },
    { name: '手工的房间', sign: '用手做点用不上的东西', fans: 908000 },
    { name: '老周修表', sign: '修表和它周边的故事', fans: 512000 },
    { name: '一介考据', sign: '抠细节，不抬杠', fans: 733000 },
    { name: '天台风大', sign: '在楼顶唱歌的人', fans: 265000 },
    { name: '猫在隔壁', sign: '记录一只不太亲人的猫', fans: 3040000 },
    { name: '逐步健身', sign: '慢慢来，别伤着', fans: 587000 },
    { name: '国道以南', sign: '开旧车走远路', fans: 421000 },
    { name: '白衬衫实验室', sign: '衣服这件小事', fans: 189000 },
    { name: '野球场灯下', sign: '周二晚上八点，老地方', fans: 96000 },
    { name: '泡面番研究所', sign: '三分钟讲一部番', fans: 812000 }
];

const VIDEO_SEEDS = [
    {
        up: 0, tname: '生活', dur: 842,
        title: '凌晨两点，我去吃了那家开了二十七年的面馆',
        desc: '老板说这个点来的都是熟人。我坐了一个小时，听完了他讲的三个故事。',
        tags: ['生活', '深夜', '城市记录'],
        danmaku: ['这个氛围绝了', '前面别走，后面有细节', '老板好像我舅舅', '一个人吃面也挺好', '这段没有配乐更好', '看完饿了'],
        comments: [
            ['不睡觉的鱼', '二十七年的招牌都磨白了，这种店越来越少了。', 1286],
            ['已阅', '凌晨两点的城市是另一座城市。', 402],
            ['想吃火锅', '我家楼下也有一家，去年关了。', 190]
        ]
    },
    {
        up: 4, tname: '动画', dur: 1064,
        title: '十年后再看这部番，我哭的地方完全变了',
        desc: '小时候觉得那是热血，现在看全是告别。逐帧聊第三集的走廊长镜头。',
        tags: ['动画', '番剧点评', '长镜头'],
        danmaku: ['第三集真的封神', '这个转场我截了十几张', '原来不止我一个', '年龄越大越不敢重看', 'BGM 一起就顶不住'],
        comments: [
            ['三分钟热度', '以前看的是主角，现在看的是那些没说出口的配角。', 2301],
            ['键盘上的猫', '走廊那个镜头，光从左边进来的时候我直接破防。', 875]
        ]
    },
    {
        up: 2, tname: '美食', dur: 731,
        title: '把一块豆腐做出肉味，我试了七次',
        desc: '第七次的版本终于对了。配方在简介，失败了别怪我，火候真的很看锅。',
        tags: ['美食', '家常菜', '厨房实验'],
        danmaku: ['第七次才成功，真实', '这个声音好听', '我照着做了，糊了', '火候真的玄学', '豆腐居然能这样'],
        comments: [
            ['半夜刷视频的人', '第三次就成功的人请不要在这条下面说话。', 1664],
            ['明天再说吧', '看完就去厨房，结果只剩半块豆腐。', 233]
        ]
    },
    {
        up: 1, tname: '科技', dur: 918,
        title: '把十年前的旧手机改成一台桌面时钟',
        desc: '拆机、换电池、写一个只显示时间的页面。成本 43 块，用了三个月还没坏。',
        tags: ['科技', '数码', '旧物改造'],
        danmaku: ['这电池居然还有货', '成本 43 我信了', '我抽屉里也有一台', '这个屏保想要', '动手能力太强了'],
        comments: [
            ['路过的一条狗', '旧手机最好的归宿不是卖掉，是让它继续亮着。', 908],
            ['这名字好难取', '求壁纸，看着好舒服。', 121]
        ]
    },
    {
        up: 5, tname: '生活', dur: 612,
        title: '在这座城市，晚上十一点之后才开始的生活',
        desc: '夜班司机、24 小时洗衣店、便利店的热柜。三段不打扰的观察。',
        tags: ['生活', '城市', '观察'],
        danmaku: ['洗衣店那段好安静', '这城市原来有另一套时间', '司机师傅好会讲', '突然想去走走'],
        comments: [
            ['一整个大无语', '我在洗衣店待过一整夜，看着滚筒转真的会放空。', 542]
        ]
    },
    {
        up: 6, tname: '生活', dur: 1042,
        title: '我用一个月，给出租屋做了一个完整的工作台',
        desc: '三十平米，不砸墙、不改水电。所有东西都能拆走，房东来看过也没话说。',
        tags: ['生活', '手工', '出租屋改造'],
        danmaku: ['这个收纳我学会了', '不砸墙这条太重要', '房东看了想加租', '尺寸求一下', '木头味道好香'],
        comments: [
            ['前排出售瓜子', '这才是可复制的生活改造，不是那种花了三万。', 3120],
            ['半夜还在刷', '请问桌面进深 60 够不够放显示器？', 66]
        ]
    },
    {
        up: 7, tname: '知识', dur: 1487,
        title: '机械表为什么贵：拆开一块 1958 年的表看结构',
        desc: '摆轮、游丝、擒纵。慢动作下你能看到它每秒被拦住五次。',
        tags: ['知识', '机械', '慢动作'],
        danmaku: ['这个擒纵声好听', '每秒五次，记住了', '手艺人真的难', '镜头太干净了', '看完想买表又不敢'],
        comments: [
            ['先把作业写完', '我爷爷留下的那块，走时还准。', 771]
        ]
    },
    {
        up: 8, tname: '知识', dur: 1233,
        title: '为什么你总觉得时间越过越快？从心理学到物理学',
        desc: '不聊玄学，只讲三种被实验支持的解释，以及一个能立刻做的对照实验。',
        tags: ['知识', '心理', '科普'],
        danmaku: ['这个知识点第一次听', '原来是记忆密度', '讲得好清楚', '记笔记了', '所以要多出门'],
        comments: [
            ['三分钟热度', '新鲜感密度这个说法救了我，最近总觉得日子被压缩了。', 1893],
            ['已阅', '最后那个对照实验我做了一周，真的有效。', 310]
        ]
    },
    {
        up: 3, tname: '科技', dur: 809,
        title: '在城市里能看见多少颗星：一次不打灯的实测',
        desc: '同一个天顶，四个地点，四种光污染。肉眼能数出来的数比你想的少。',
        tags: ['科技', '天文', '光污染'],
        danmaku: ['我家只看得见三颗', '这个对比太直观了', '原来郊区差这么多', '想去露营了'],
        comments: [
            ['观星的小孩', '小时候在乡下能看见银河，现在回不去了。', 1420]
        ]
    },
    {
        up: 9, tname: '音乐', dur: 274,
        title: '用八个玻璃杯敲出一首歌的和声',
        desc: '调水量调到第五个小时才开始录。频谱在视频最后十秒。',
        tags: ['音乐', '翻奏', '手工'],
        danmaku: ['这个音准离谱', '水杯调音是真的难', '听哭了', '循环第五遍', '求谱'],
        comments: [
            ['想吃火锅', '明明是很简单的旋律，为什么这么抓人。', 986]
        ]
    },
    {
        up: 10, tname: '动物', dur: 587,
        title: '我家猫在我生病那天，做了件很反常的事',
        desc: '它平时不亲人。那天它在我门口趴了一整晚，第二天又恢复原样。',
        tags: ['动物', '猫', '日常'],
        danmaku: ['它什么都懂', '我家狗也这样', '禁止感动我', '这个呼噜声'],
        comments: [
            ['不睡觉的鱼', '猫表达关心的方式真的很克制。', 4210],
            ['键盘上的猫', '我发烧的时候它也是这样，平时根本不理我。', 1330]
        ]
    },
    {
        up: 11, tname: '体育', dur: 934,
        title: '每天二十分钟，第九十天我把记录做成了对比',
        desc: '没有花里胡哨的动作，只有四个基础动作和一张日历。数据都在最后。',
        tags: ['健身', '自律', '记录'],
        danmaku: ['不是速成，好评', '90 天真的能看出差别', '动作标准很重要', '我也开始了'],
        comments: [
            ['明天再说吧', '这种不卖课程的健身视频太少了。', 762]
        ]
    },
    {
        up: 12, tname: '汽车', dur: 1421,
        title: '开着二十万公里的老车，跑完两千公里国道',
        desc: '不为了测评，只是想看看它还能不能。中途换了两次胎，其它没出问题。',
        tags: ['汽车', '自驾', '老车'],
        danmaku: ['老车才敢这么跑', '这段路我走过', '风景不错', '机油要带够'],
        comments: [
            ['一整个大无语', '我爸那台也快二十万了，看完想带它出趟远门。', 512]
        ]
    },
    {
        up: 13, tname: '时尚', dur: 486,
        title: '一件白衬衫的七种穿法，通勤也能用',
        desc: '不买新衣服，只用现有的裤子和外套。重点是肩线和袖口的处理。',
        tags: ['时尚', '通勤', '穿搭'],
        danmaku: ['第三种最适合我', '袖口这个细节学到了', '终于有不花钱的穿搭了'],
        comments: [
            ['这名字好难取', '衣柜里三件白衬衫，从来没穿对过。', 288]
        ]
    },
    {
        up: 14, tname: '运动', dur: 702,
        title: '野球场上的第一百个夜晚',
        desc: '一个人投篮，一个人收拾。第一百天的时候终于有人加入了。',
        tags: ['运动', '篮球', '记录'],
        danmaku: ['这个孤独感好真实', '第一百天有人加入太好了', '球场灯一亮就想投'],
        comments: [
            ['路过的一条狗', '一个人练球的日子其实挺好的。', 640]
        ]
    },
    {
        up: 15, tname: '番剧', dur: 1452,
        title: '这部番的第八集，值得单独拿出来聊',
        desc: '一整集只在一个房间里，两个角色，三场对话。分镜几乎不动。',
        tags: ['番剧', '分镜', '剧本'],
        danmaku: ['第八集真的是全剧最高', '台词密度太大了', '这个静止镜头好大胆'],
        comments: [
            ['先把作业写完', '这种省钱拍法反而成了最强的一集。', 1103]
        ]
    },
    {
        up: 4, tname: '鬼畜', dur: 196,
        title: '当全网的梗被塞进同一段旋律',
        desc: '四十个片段，两分半，节奏卡得刚好。戴耳机效果更好。',
        tags: ['鬼畜', '调音', '剪辑'],
        danmaku: ['这个卡点太爽了', '第八个笑死', '循环十遍', '耳机党狂喜', '作者是懂节奏的'],
        comments: [
            ['半夜刷视频的人', '第 1 分 08 秒那个转场我看了五遍。', 2033]
        ]
    },
    {
        up: 1, tname: '数码', dur: 1130,
        title: '关机七十二小时：把它彻底关掉之后会发生什么',
        desc: '不看不回不响。三天之后，我记下来的变化比预想的要多。',
        tags: ['数码', '生活实验', '手机'],
        danmaku: ['我做不到三天', '第二天就开始手痒', '这个实验值得试试'],
        comments: [
            ['已阅', '第三天之后反而有点不想开机了。', 1434]
        ]
    },
    {
        up: 5, tname: '影视', dur: 1567,
        title: '这个镜头只有四秒，但导演准备了三年',
        desc: '一场雨、一条巷子、一次回头。拆解它为什么让人记这么久。',
        tags: ['影视', '镜头', '拉片'],
        danmaku: ['四秒记了十年', '原来光是这样打的', '这个回头绝了', '拉片区真好看'],
        comments: [
            ['三分钟热度', '雨的方向是反的，这个细节我第一次注意到。', 1780]
        ]
    },
    {
        up: 3, tname: '舞蹈', dur: 238,
        title: '在三十八度的天台，跳完这支舞',
        desc: '一遍过，没有补拍。头发糊在脸上也不用重来。',
        tags: ['舞蹈', '天台', '一镜到底'],
        danmaku: ['一镜到底好评', '这个天太热了吧', '呼吸声都听得见'],
        comments: [
            ['前排出售瓜子', '不补拍才有的那个劲儿。', 902]
        ]
    },
    {
        up: 8, tname: '知识', dur: 1876,
        title: '一段被误传了三十年的说法，最早出自哪里',
        desc: '查到第五手资料才对上号。过程有点枯燥，但结论值得一说。',
        tags: ['知识', '考据', '文献'],
        danmaku: ['考据区精神可嘉', '我也一直在找这个源头', '第五手资料太真实了'],
        comments: [
            ['这名字好难取', '看完才知道自己转的不是原文。', 660]
        ]
    },
    {
        up: 6, tname: '生活', dur: 528,
        title: '给自己做一把用不上的椅子',
        desc: '尺寸错了，坐不了人。但它现在是最好的花架。',
        tags: ['生活', '木工', '手工'],
        danmaku: ['花架这个结局我接受', '失败作品也有归处', '木头纹理好看'],
        comments: [
            ['不睡觉的鱼', '用不上就对了，这句话好放松。', 1240]
        ]
    },
    {
        up: 0, tname: '影视', dur: 1345,
        title: '把同一场戏的三版剪辑放在一起看',
        desc: '同一批素材，三种节奏，观众的情绪落点完全不同。',
        tags: ['影视', '剪辑', '对比'],
        danmaku: ['第二版明显紧', '节奏就是情绪', '这个对比太直观了'],
        comments: [
            ['半夜还在刷', '第三版那个停顿，把整个意思都改了。', 811]
        ]
    }
];

/* 直播条目：直播卡的时长/人气口径与点播不同，单独给一小池，
 * 不拿点播视频冒充直播。 */
const LIVE_SEEDS = [
    { up: 2, title: '凌晨的厨房：边做边聊', viewers: 3651, game: '虚拟主播' },
    { up: 15, title: '通宵补番，进来随便聊', viewers: 1208, game: '杂谈' },
    { up: 11, title: '一起做二十分钟基础训练', viewers: 842, game: '健身' }
];

const SEARCH_HOT = [
    '新番第八集', '旧手机改造', '凌晨的面馆', '一个人旅行', '机械表拆解',
    '出租屋改造', '玻璃杯和声', '九十天健身', '老车国道', '光污染实测'
];

const DANMAKU_COLORS = ['#FFFFFF', '#FFFFFF', '#FF8C9E', '#7FE0FF', '#FFD970'];

/* 内容时间轴的「现在」：剧情钟优先，读不到时 time-source 显式降级到墙钟。
 *   这一个不属于 bili-format.js：它读宿主环境，不是纯函数。 */
function storyNowMs() {
    const s = storyNowWallFallback(hostWin());
    return numOr(s && s.ms, 0) || wallNow();
}

function hostWin() {
    return (typeof window !== 'undefined' && window) ? window : globalThis;
}

/* ---------- 3. 归一化 ---------- */

/* [v4.190.0] 保留旧导出名：实现已下沉到 bili-format.js（唯一内核）。 */
export { isBilibiliEntryUrl } from './bili-format.js';


/** 弹幕归一：允许字符串数组（旧格式）或 {t,text,color} 对象数组。 */
function normalizeDanmaku(list, seed, durSec) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    const maxT = Math.max(30, numOr(durSec, 60));
    for (let i = 0; i < arr.length; i += 1) {
        const it = arr[i];
        const obj = (it && typeof it === 'object') ? it : { text: it };
        const text = compactText(obj.text, 40);
        if (!text) continue;
        const t = Number(obj.t);
        out.push({
            t: Number.isFinite(t) && t >= 0 ? Math.round(t) : ((i + 1) / (arr.length + 1)) * maxT * 0.85,
            text,
            color: compactText(obj.color) || DANMAKU_COLORS[hash32(seed + '|d' + i) % DANMAKU_COLORS.length]
        });
    }
    return out.slice(0, 40);
}

/** 评论归一：允许 ['用户名','内容',赞] / 对象 / 旧格式 {userName,content,likedCount}。 */
function normalizeComments(list, seed, nowMs) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (let i = 0; i < arr.length; i += 1) {
        const raw = arr[i];
        let user = '';
        let text = '';
        let likes = 0;
        let replies = [];
        if (Array.isArray(raw)) {
            user = compactText(raw[0]);
            text = compactText(raw[1]);
            likes = parseCount(raw[2]);
        } else if (raw && typeof raw === 'object') {
            user = compactText(raw.user || raw.userName || raw.name);
            text = compactText(raw.text || raw.content);
            likes = parseCount(raw.likes != null ? raw.likes : raw.likedCount);
            if (Array.isArray(raw.replies)) {
                replies = raw.replies.slice(0, 3).map((r, ri) => ({
                    id: 'r-' + hash32(seed + '|r' + i + '_' + ri).toString(36),
                    user: compactText((r && (r.user || r.userName)) || '网友'),
                    text: compactText((r && (r.text || r.content)) || '', 160),
                    timeText: compactText(r && (r.timeText || r.time)) || ''
                })).filter((r) => r.text);
            }
        }
        if (!text) continue;
        const ageMin = seededInt(seed + '|c' + i, 3, 60 * 24 * 6);
        out.push({
            id: 'c-' + hash32(seed + '|c' + i).toString(36),
            user: user || '路过的观众',
            text: compactText(text, 300),
            likes,
            liked: false,
            timeText: timeAgo(nowMs - ageMin * 60000, nowMs),
            replies
        });
    }
    return out.slice(0, 20);
}

/**
 * 条目归一化（保留旧导出名与旧参数位）。
 * @param {Array} entries 原始条目（AI 给的 / 内容池生成的 / 旧存档）
 * @param {string} query 搜索词（本地地址兜底与默认标题）
 * @param {number} now 内容时间轴的「现在」（毫秒）；缺省取剧情钟
 */
export function normalizeBilibiliEntries(entries, query, now = storyNowMs()) {
    const list = Array.isArray(entries) ? entries : [];
    const nowMs = numOr(now, 0) || storyNowMs();
    return list.map((raw, index) => {
        const entry = (raw && typeof raw === 'object') ? raw : {};
        const title = compactText(entry.title, 120) || (String(query || '日常') + '｜刷到的 B站视频');
        const upName = compactText(entry.upName || entry.up || entry.author, 40) || '匿名UP';
        const upMid = compactText(entry.upMid) || makeMid(upName);
        const seed = title + '@' + upName;
        const bvid = compactText(entry.bvid) || makeBvid(seed);
        const durSec = parseDur(entry.duration != null ? entry.duration : entry.dur)
            || seededInt(seed, 120, 1500);
        const rawUrl = compactText(entry.url);
        const url = isBilibiliEntryUrl(rawUrl) ? rawUrl : makeLocalBilibiliUrl(query || title, index);
        const tname = compactText(entry.tname || entry.category, 12) || '生活';
        const pubTs = Number(entry.timestamp);
        // 发布时刻：内容时间轴（story 档）。AI 没给就按哈希在「过去 1 小时 ~ 20 天」
        // 里落一个，保证同一 bvid 每次读到同一时刻（不会因为重渲染而跳）。
        const timestamp = Number.isFinite(pubTs) && pubTs > 0
            ? Math.round(pubTs)
            : (nowMs - seededInt(seed, 1, 20 * 24) * 3600000);
        const play = parseCount(entry.play != null ? entry.play : (entry.playCount != null ? entry.playCount : entry.views))
            || seededInt(seed + '|p', 8000, 3200000);
        const danmakuCount = parseCount(entry.danmakuCount != null ? entry.danmakuCount : entry.danmakuNum)
            || Math.round(play * (0.008 + (hash32(seed + '|dc') % 100) / 4000));
        const like = parseCount(entry.like != null ? entry.like : entry.likeCount)
            || Math.round(play * (0.03 + (hash32(seed + '|lk') % 100) / 3000));
        return {
            id: bvid,
            bvid,
            aid: String(entry.aid || (hash32('aid|' + seed) % 900000000)),
            title,
            subtitle: compactText(entry.subtitle, 60),
            cover: compactText(entry.cover),
            tone: hash32(seed + '|tone') % 8,
            temoji: compactText(entry.temoji) || TNAME_EMOJI[tname] || '🎬',
            tname,
            duration: durSec,
            durationText: fmtDur(durSec),
            upName,
            upMid,
            upFace: compactText(entry.upFace),
            upSign: compactText(entry.upSign, 60),
            upFans: parseCount(entry.upFans) || seededInt(upMid, 5000, 3000000),
            timestamp,
            pubText: timeAgo(timestamp, nowMs),
            play,
            danmakuCount,
            like,
            coin: parseCount(entry.coin != null ? entry.coin : entry.coinCount)
                || Math.round(like * (0.15 + (hash32(seed + '|cn') % 100) / 800)),
            fav: parseCount(entry.fav != null ? entry.fav : entry.favCount)
                || Math.round(like * (0.2 + (hash32(seed + '|fv') % 100) / 700)),
            share: parseCount(entry.share != null ? entry.share : entry.shareCount) || Math.round(like * 0.06),
            reply: parseCount(entry.reply != null ? entry.reply : entry.commentCount) || Math.round(like * 0.05),
            desc: compactText(entry.desc != null ? entry.desc : entry.description, 600)
                || '一条像从手机里刷到的 B站视频。',
            tags: (Array.isArray(entry.tags) ? entry.tags : []).map((t) => compactText(t, 12)).filter(Boolean).slice(0, 8),
            danmaku: normalizeDanmaku(entry.danmaku, seed, durSec),
            comments: normalizeComments(entry.comments, seed, nowMs),
            url,
            live: Boolean(entry.live),
            viewers: parseCount(entry.viewers),
            source: compactText(entry.source) || 'generated'
        };
    }).filter((e) => e.title && isBilibiliEntryUrl(e.url)).slice(0, MAX_ENTRIES);
}

/**
 * 生成一批「像从手机里刷到的」B站条目（保留旧导出名）。
 * @param {string} query 关键词
 * @param {number} now 内容时间轴「现在」
 */
export function buildFallbackBilibiliPayload(query, now = storyNowMs()) {
    const clean = compactText(query, 24) || '今晚会刷到的';
    const nowMs = numOr(now, 0) || storyNowMs();
    const seedBase = clean + '|' + Math.floor(nowMs / 60000);

    const pool = VIDEO_SEEDS.slice();
    const picked = [];
    let cursor = hash32(seedBase);
    // 注意：不能写 `picked.length < Math.min(SEED_BATCH, pool.length)` —— pool 会随
    // splice 缩短，那个条件在 picked=12 / pool=12 时就会假掉，于是 16 条只能抽到 12 条
    // （实测：15 条内容 = 12 视频 + 3 直播）。正确条件是「还没抽够，且池里还有」。
    while (picked.length < SEED_BATCH && pool.length > 0) {
        cursor = hash32(String(cursor) + '|' + picked.length);
        const idx = cursor % pool.length;
        picked.push(pool.splice(idx, 1)[0]);
    }

    const rawEntries = picked.map((tpl) => {
        const up = UP_POOL[tpl.up % UP_POOL.length];
        const seed = clean + '|' + tpl.title;
        const ageHour = seededInt(seed + '|age', 1, 20 * 24);
        return {
            title: tpl.title,
            upName: up.name,
            upSign: up.sign,
            upFans: up.fans,
            tname: tpl.tname,
            duration: tpl.dur,
            timestamp: nowMs - ageHour * 3600000,
            desc: tpl.desc,
            tags: tpl.tags,
            danmaku: tpl.danmaku,
            comments: tpl.comments
        };
    });

    const liveEntries = LIVE_SEEDS.map((tpl) => {
        const up = UP_POOL[tpl.up % UP_POOL.length];
        const seed = clean + '|live|' + tpl.title;
        return {
            title: tpl.title,
            upName: up.name,
            upSign: up.sign,
            upFans: up.fans,
            tname: '直播',
            duration: 0,
            viewers: tpl.viewers,
            timestamp: nowMs - seededInt(seed + '|age', 1, 6) * 3600000,
            desc: '正在直播：' + tpl.game,
            tags: ['直播', tpl.game],
            danmaku: ['主播晚上好', '刚进来', '这个点还有人在'],
            comments: [],
            live: true
        };
    });

    const entries = normalizeBilibiliEntries(rawEntries.concat(liveEntries), clean, nowMs);
    return {
        summary: '刷到 ' + entries.length + ' 条和「' + clean + '」有关的 B站内容。',
        entries
    };
}

/**
 * 解析模型返回的 JSON（保留旧导出名）。支持：
 *   { summary, entries:[...] } / { videos:[...] } / 裸数组
 * 解析不出可用条目时回落到兜底批次（产品既有约定：宁可给一批可刷的，
 * 也不给一片空白；summary 会如实说明这是兜底）。
 */
export function parseBilibiliPayload(raw, query, now = storyNowMs()) {
    const nowMs = numOr(now, 0) || storyNowMs();
    const text = String(raw == null ? '' : raw).trim();
    if (text) {
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed)
                ? parsed
                : (parsed && (Array.isArray(parsed.entries) ? parsed.entries
                    : (Array.isArray(parsed.videos) ? parsed.videos : null)));
            if (list && list.length) {
                const entries = normalizeBilibiliEntries(list, query, nowMs)
                    .map((e) => Object.assign({}, e, { source: 'model' }));
                if (entries.length) {
                    return {
                        summary: compactText(parsed && parsed.summary)
                            || ('AI 推来 ' + entries.length + ' 条和「' + compactText(query) + '」有关的 B站内容。'),
                        entries
                    };
                }
            }
        } catch (_e) { /* 非 JSON：落到兜底 */ }
    }
    return buildFallbackBilibiliPayload(query, nowMs);
}

/* ---------- 4. 数据层 ---------- */

const DEFAULT_USER = () => ({
    name: '',
    face: '',
    mid: '39000128',
    /* level 与 exp 必须自洽：level = floor(exp / LEVEL_STEP) + 1（上限 Lv6）。
     *   600 / 200 + 1 = 4 —— 「一个用了有一阵子的账号」而不是「Lv4 却只有 0 经验」。
     *   上一版把 exp 写成 320 却把 level 写死 4，我的页上就是「Lv4 320/200」这种
     *   自相矛盾的读数（探针当场抓到），所以起始值必须按公式反推。 */
    level: 4,
    exp: 600,
    coin: COIN_START,
    sign: '这个人很懒，什么都没写',
    following: [],
    liked: [],
    coined: [],
    favored: [],
    history: [],
    watchLater: [],
    favorites: [{ id: 'fav-default', name: '默认收藏夹', bvids: [], at: 0 }],
    lastCoinDay: ''
});

export class BiliData {
    constructor(storage) {
        this.storage = storage;
        this.storageKey = STORAGE_KEY;
        this.query = '';
        this.summary = '';
        this.entries = [];
        this.user = DEFAULT_USER();
        this.searchHistory = [];
        this.activeTab = 'recommend';
        this._load();
    }

    /* ---------- 持久化 ---------- */

    _load() {
        try {
            const raw = this.storage && typeof this.storage.get === 'function'
                ? this.storage.get(this.storageKey) : null;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!data || typeof data !== 'object') return;
            // 旧档（只有 query/summary/entries）也走这条：缺失字段补默认，不整份丢弃
            this.query = compactText(data.query);
            this.summary = compactText(data.summary, 200);
            this.entries = Array.isArray(data.entries) ? data.entries : [];
            this.searchHistory = (Array.isArray(data.searchHistory) ? data.searchHistory : [])
                .map((q) => compactText(q, 24)).filter(Boolean).slice(0, 12);
            this.activeTab = compactText(data.activeTab) || 'recommend';
            if (data.user && typeof data.user === 'object') {
                const base = DEFAULT_USER();
                const u = data.user;
                const arr = (v) => (Array.isArray(v) ? v : []);
                this.user = {
                    name: compactText(u.name),
                    face: compactText(u.face),
                    mid: compactText(u.mid) || base.mid,
                    level: Math.max(0, Math.min(6, Math.round(numOr(u.level, base.level)))),
                    exp: Math.max(0, Math.round(numOr(u.exp, base.exp))),
                    coin: Math.max(0, Math.round(numOr(u.coin, base.coin))),
                    sign: compactText(u.sign, 40) || base.sign,
                    following: arr(u.following).map((x) => compactText(x)).filter(Boolean),
                    liked: arr(u.liked).map((x) => compactText(x)).filter(Boolean),
                    coined: arr(u.coined).map((x) => compactText(x)).filter(Boolean),
                    favored: arr(u.favored).map((x) => compactText(x)).filter(Boolean),
                    history: arr(u.history).filter((h) => h && compactText(h.bvid)).map((h) => ({
                        bvid: compactText(h.bvid),
                        pos: Math.max(0, Math.round(numOr(h.pos, 0))),
                        at: Math.max(0, Math.round(numOr(h.at, 0))),
                        atText: compactText(h.atText)
                    })).slice(0, 60),
                    watchLater: arr(u.watchLater).map((x) => compactText(x)).filter(Boolean),
                    favorites: (arr(u.favorites).length ? arr(u.favorites) : base.favorites).map((f, fi) => ({
                        id: compactText(f && f.id) || ('fav-' + fi),
                        name: compactText(f && f.name, 20) || ('收藏夹 ' + (fi + 1)),
                        bvids: arr(f && f.bvids).map((x) => compactText(x)).filter(Boolean),
                        at: Math.max(0, Math.round(numOr(f && f.at, 0)))
                    })),
                    lastCoinDay: compactText(u.lastCoinDay)
                };
                /* 旧档修复：只补不降。旧版本把 level 写死 4 却只给 320 经验，
                 * 于是「Lv4 320/800」这种账读起来像坏档。这里把经验抬到该等级的
                 * 下限（4 级 ⇒ 600），等级本身不动 —— 用户的等级不该因为一次升级而掉。 */
                const floorExp = Math.max(0, (this.user.level - 1) * LEVEL_STEP);
                if (this.user.exp < floorExp) this.user.exp = floorExp;
            }
        } catch (_e) { /* 坏档当空档，下一次写入自然修复 */ }
    }

    _save() {
        try {
            if (!this.storage || typeof this.storage.set !== 'function') return false;
            // 写入的是对象（不是裸数组）：bili_entries_v1 被 entry-integrity 的
            // NOT_BARE_ARRAY 列为「数组落盘会丢字符串键」的键，必须是对象。
            this.storage.set(this.storageKey, {
                query: this.query,
                summary: this.summary,
                entries: this.entries,
                user: this.user,
                searchHistory: this.searchHistory,
                activeTab: this.activeTab,
                updatedAt: wallNow()
            });
            return true;
        } catch (_e) {
            return false;
        }
    }

    /* ---------- 内容写入 ---------- */

    /** 首次打开补一批内容（构造函数里不做：换会话空档必须真的是空档）。 */
    ensureSeeded() {
        if (Array.isArray(this.entries) && this.entries.length > 0) return false;
        this.refresh(this.query || '');
        return true;
    }

    /** 刷新一批。按 bvid 与旧条目合并，保住用户已经点过的赞/币/收藏。 */
    refresh(query) {
        const clean = compactText(query, 24);
        const payload = buildFallbackBilibiliPayload(clean);
        const oldByBvid = new Map();
        for (const e of (Array.isArray(this.entries) ? this.entries : [])) {
            const key = compactText(e && e.bvid);
            if (key) oldByBvid.set(key, e);
        }
        this.entries = payload.entries.map((e) => {
            const old = oldByBvid.get(e.bvid);
            if (!old) return e;
            // 只保留「会随观看变化」的量：统计与用户互动。标题/简介以新批为准。
            return Object.assign({}, e, {
                play: Math.max(numOr(e.play, 0), numOr(old.play, 0)),
                danmakuCount: Math.max(numOr(e.danmakuCount, 0), numOr(old.danmakuCount, 0)),
                like: Math.max(numOr(e.like, 0), numOr(old.like, 0)),
                coin: Math.max(numOr(e.coin, 0), numOr(old.coin, 0)),
                fav: Math.max(numOr(e.fav, 0), numOr(old.fav, 0)),
                reply: Math.max(numOr(e.reply, 0), numOr(old.reply, 0)),
                comments: (Array.isArray(old.comments) && old.comments.length) ? old.comments : e.comments,
                danmaku: (Array.isArray(old.danmaku) && old.danmaku.length) ? old.danmaku : e.danmaku
            });
        });
        this.query = clean;
        this.summary = payload.summary;
        this._save();
        return payload;
    }

    /** 模型文本入库（旧方法名保留）。 */
    ingestModelText(raw, query) {
        const payload = parseBilibiliPayload(raw, query || this.query);
        this.query = compactText(query) || this.query;
        this.summary = payload.summary;
        this.entries = payload.entries;
        this._save();
        return payload;
    }

    /**
     * AI 标签解析：`<Bilibili>{...}</Bilibili>` / `<Bili>{...}</Bili>`。
     * 支持一条消息里多个标签，也支持标签内是数组。
     * @returns {Array} 新增（或更新）的条目；没有标签返回 []
     */
    parseFromMessage(text) {
        const raw = String(text == null ? '' : text);
        const re = /<(Bilibili|Bili|bilibili|bili)>([\s\S]*?)<\/\1>/gi;
        const chunks = [];
        let m = re.exec(raw);
        while (m) {
            const inner = String(m[2] || '').trim();
            if (inner) chunks.push(inner);
            m = re.exec(raw);
        }
        if (!chunks.length) return [];
        const added = [];
        for (const chunk of chunks) {
            const payload = parseBilibiliPayload(chunk, this.query);
            for (const e of payload.entries) {
                const exist = this.entries.findIndex((x) => x && x.bvid === e.bvid);
                if (exist >= 0) {
                    this.entries[exist] = Object.assign({}, this.entries[exist], e, { source: 'model' });
                    added.push(this.entries[exist]);
                } else {
                    this.entries.unshift(Object.assign({}, e, { source: 'model' }));
                    added.push(this.entries[0]);
                }
            }
        }
        this.entries = this.entries.slice(0, MAX_ENTRIES);
        this._save();
        return added;
    }

    /* ---------- 读取 ---------- */

    getEntry(bvid) {
        const key = compactText(bvid);
        if (!key) return null;
        return this.entries.find((e) => e && e.bvid === key) || null;
    }

    getUser() {
        return this.user;
    }

    /** 首页/分区的取数口。tab 是界面上的中文页签名（推荐 / 热门 / 追番 …）。 */
    getFeed(tab) {
        const t = compactText(tab) || '推荐';
        const all = Array.isArray(this.entries) ? this.entries : [];
        const nowMs = storyNowMs();
        let list = all;
        if (t === '直播') {
            list = all.filter((e) => e && e.live);
        } else if (t === '热门') {
            list = all.filter((e) => e && !e.live).slice().sort((a, b) => numOr(b.play, 0) - numOr(a.play, 0));
        } else if (t === '最新') {
            list = all.filter((e) => e && !e.live).slice().sort((a, b) => numOr(b.timestamp, 0) - numOr(a.timestamp, 0));
        } else if (t === '推荐') {
            // 打散：同一批内容每次进来顺序稳定（用 bvid 哈希），但不像时间线那样整齐
            list = all.filter((e) => e && !e.live)
                .slice().sort((a, b) => hash32('f|' + a.bvid) - hash32('f|' + b.bvid));
        } else {
            const map = {
                追番: ['番剧', '国创', '动画'],
                影视: ['影视', '电影'],
                动画: ['动画'],
                游戏: ['游戏'],
                知识: ['知识'],
                科技: ['科技', '数码'],
                生活: ['生活'],
                美食: ['美食'],
                音乐: ['音乐'],
                舞蹈: ['舞蹈'],
                鬼畜: ['鬼畜'],
                动物: ['动物'],
                时尚: ['时尚'],
                汽车: ['汽车'],
                运动: ['运动', '体育'],
                娱乐: ['娱乐', '影视']
            };
            const names = map[t] || [t];
            list = all.filter((e) => e && names.indexOf(e.tname) >= 0);
        }
        // 相对时间文案每次取数重算（数据里存 timestamp，避免「昨天」第二天还写昨天）
        return list.map((e) => Object.assign({}, e, { pubText: timeAgo(e.timestamp, nowMs) }));
    }

    /** 首页顶部分区（与真机一致：直播在最前）。 */
    getTabs() {
        return ['直播', '推荐', '热门', '追番', '影视', '动画', '游戏', '知识', '科技', '生活', '美食', '音乐', '舞蹈', '鬼畜', '动物', '时尚', '汽车', '运动', '娱乐'];
    }

    search(keyword) {
        const kw = compactText(keyword, 24);
        if (!kw) return [];
        const low = kw.toLowerCase();
        const nowMs = storyNowMs();
        return this.entries.filter((e) => {
            if (!e) return false;
            const hay = [e.title, e.upName, e.desc, (e.tags || []).join(' '), e.tname].join(' ').toLowerCase();
            return hay.indexOf(low) >= 0;
        }).map((e) => Object.assign({}, e, { pubText: timeAgo(e.timestamp, nowMs) }));
    }

    getUpInfo(mid) {
        const key = compactText(mid);
        const works = this.entries.filter((e) => e && e.upMid === key);
        if (!works.length) return null;
        const first = works[0];
        return {
            mid: key,
            name: first.upName,
            face: first.upFace,
            sign: first.upSign || '这个 UP 主还没写签名',
            fans: Math.max.apply(null, works.map((w) => numOr(w.upFans, 0))),
            works: works.slice(),
            followed: this.user.following.indexOf(key) >= 0
        };
    }

    /** 动态页：只认真实关注关系（没关注就空着，不编造「关注的 UP 更新了」）。 */
    getDynamics() {
        const nowMs = storyNowMs();
        const followed = Array.isArray(this.user.following) ? this.user.following : [];
        if (!followed.length) return { followed: [], items: [] };
        const items = this.entries
            .filter((e) => e && followed.indexOf(e.upMid) >= 0)
            .slice()
            .sort((a, b) => numOr(b.timestamp, 0) - numOr(a.timestamp, 0))
            .map((e) => Object.assign({}, e, { pubText: timeAgo(e.timestamp, nowMs) }));
        return { followed: followed.slice(), items };
    }

    getHistory() {
        const nowMs = wallNow();
        return (this.user.history || []).map((h) => {
            const e = this.getEntry(h.bvid);
            if (!e) return null;
            return {
                bvid: e.bvid,
                title: e.title,
                upName: e.upName,
                durationText: e.durationText,
                duration: e.duration,
                tone: e.tone,
                temoji: e.temoji,
                pos: h.pos,
                atText: h.atText || wallStampText(h.at, nowMs)
            };
        }).filter(Boolean);
    }

    getWatchLater() {
        return (this.user.watchLater || []).map((bvid) => this.getEntry(bvid)).filter(Boolean);
    }

    getFavorites() {
        return (this.user.favorites || []).map((f) => ({
            id: f.id,
            name: f.name,
            count: (f.bvids || []).length,
            videos: (f.bvids || []).map((bvid) => this.getEntry(bvid)).filter(Boolean)
        }));
    }

    getSearchHistory() {
        return this.searchHistory.slice();
    }

    /** 热搜：固定池（不伪造热度排名，只给一组可点的词）。 */
    getHotSearch() {
        return SEARCH_HOT.slice();
    }

    getMessages() {
        const nowMs = storyNowMs();
        const out = [];
        for (const e of this.entries) {
            for (const c of (e.comments || [])) {
                for (const r of (c.replies || [])) {
                    out.push({
                        id: 'msg-' + c.id + '-' + r.id,
                        kind: 'reply',
                        user: r.user || '网友',
                        text: r.text,
                        videoTitle: e.title,
                        bvid: e.bvid,
                        timeText: r.timeText || timeAgo(nowMs - 3600000, nowMs)
                    });
                }
            }
        }
        out.push({
            id: 'msg-sys-1',
            kind: 'system',
            user: '哔哩哔哩小助手',
            text: '你的账号已在当前设备登录。',
            videoTitle: '',
            bvid: '',
            timeText: '刚刚'
        });
        return out.slice(0, 30);
    }

    /** 经验 → 等级（1–6）。只在真的越线时才抬级，降级不自动发生（现实也不掉级）。 */
    _syncLevel() {
        const lv = Math.max(1, Math.min(6, Math.floor(numOr(this.user.exp, 0) / LEVEL_STEP) + 1));
        if (lv > this.user.level) this.user.level = lv;
    }

    stats() {
        const entries = Array.isArray(this.entries) ? this.entries : [];
        return {
            total: entries.length,
            following: (this.user.following || []).length,
            history: (this.user.history || []).length,
            favorites: (this.user.favorites || []).reduce((n, f) => n + ((f.bvids || []).length), 0),
            watchLater: (this.user.watchLater || []).length,
            coin: this.user.coin,
            level: this.user.level,
            exp: this.user.exp,
            // 本级所需经验：等级就是阈值，不要拿同一个常数冒充「当前上限」
            expMax: LEVEL_STEP * Math.max(1, this.user.level)
        };
    }

    /* ---------- 用户态变更 ---------- */

    setUserName(name) {
        const n = compactText(name, 20);
        if (!n) return false;
        this.user.name = n;
        this._save();
        return true;
    }

    setTab(tab) {
        const t = compactText(tab);
        if (!t) return;
        this.activeTab = t;
        this._save();
    }

    /** 每日硬币：现实里登录会送。按「墙钟自然日」只补一次。 */
    ensureDailyCoin() {
        const d = new Date(wallNow());
        const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        if (this.user.lastCoinDay === key) return 0;
        this.user.lastCoinDay = key;
        this.user.coin = Math.min(9999, numOr(this.user.coin, 0) + COIN_DAILY);
        this._save();
        return COIN_DAILY;
    }

    toggleLike(bvid) {
        const e = this.getEntry(bvid);
        if (!e) return null;
        const idx = this.user.liked.indexOf(e.bvid);
        const on = idx < 0;
        if (on) { this.user.liked.push(e.bvid); e.like = numOr(e.like, 0) + 1; }
        else { this.user.liked.splice(idx, 1); e.like = Math.max(0, numOr(e.like, 0) - 1); }
        this._save();
        return { on, count: e.like };
    }

    /** 投币：一枚硬币一次。硬币不足如实拒绝（不静默成功）。 */
    toggleCoin(bvid) {
        const e = this.getEntry(bvid);
        if (!e) return { ok: false, reason: 'no-entry' };
        const idx = this.user.coined.indexOf(e.bvid);
        if (idx >= 0) {
            this.user.coined.splice(idx, 1);
            this.user.coin = Math.min(9999, numOr(this.user.coin, 0) + 1);
            e.coin = Math.max(0, numOr(e.coin, 0) - 1);
            this._save();
            return { ok: true, on: false, count: e.coin, coins: this.user.coin };
        }
        if (numOr(this.user.coin, 0) <= 0) {
            return { ok: false, reason: 'no-coin', coins: 0 };
        }
        this.user.coin -= 1;
        this.user.coined.push(e.bvid);
        this.user.exp = Math.min(999999, numOr(this.user.exp, 0) + EXP_PER_COIN);
        this._syncLevel();
        e.coin = numOr(e.coin, 0) + 1;
        this._save();
        return { ok: true, on: true, count: e.coin, coins: this.user.coin };
    }

    /** 收藏：默认收进第一个收藏夹；传入 fid 可指定。 */
    toggleFav(bvid, fid) {
        const e = this.getEntry(bvid);
        if (!e) return null;
        const targetId = compactText(fid) || (this.user.favorites[0] && this.user.favorites[0].id);
        const fav = this.user.favorites.find((f) => f.id === targetId) || this.user.favorites[0];
        if (!fav) return null;
        const idx = fav.bvids.indexOf(e.bvid);
        const on = idx < 0;
        if (on) fav.bvids.push(e.bvid);
        else fav.bvids.splice(idx, 1);
        // favored 是跨收藏夹的并集，用作卡片上的「已收藏」状态
        const anyFav = this.user.favorites.some((f) => (f.bvids || []).indexOf(e.bvid) >= 0);
        if (anyFav) {
            if (this.user.favored.indexOf(e.bvid) < 0) this.user.favored.push(e.bvid);
        } else {
            this.user.favored = this.user.favored.filter((x) => x !== e.bvid);
        }
        e.fav = on ? (numOr(e.fav, 0) + 1) : Math.max(0, numOr(e.fav, 0) - 1);
        this._save();
        return { on, count: e.fav, favoriteName: fav.name };
    }

    createFavorite(name) {
        const n = compactText(name, 20);
        if (!n) return null;
        if (this.user.favorites.some((f) => f.name === n)) return null;
        const fav = {
            id: 'fav-' + hash32('fav|' + n + '|' + this.user.favorites.length).toString(36),
            name: n,
            bvids: [],
            at: wallNow()
        };
        this.user.favorites.push(fav);
        this._save();
        return fav;
    }

    toggleFollow(mid) {
        const info = this.getUpInfo(mid);
        if (!info) return null;
        const idx = this.user.following.indexOf(info.mid);
        const on = idx < 0;
        if (on) this.user.following.push(info.mid);
        else this.user.following.splice(idx, 1);
        this._save();
        return { on, name: info.name, count: this.user.following.length };
    }

    toggleWatchLater(bvid) {
        const e = this.getEntry(bvid);
        if (!e) return null;
        const idx = this.user.watchLater.indexOf(e.bvid);
        const on = idx < 0;
        if (on) this.user.watchLater.unshift(e.bvid);
        else this.user.watchLater.splice(idx, 1);
        this._save();
        return { on, count: this.user.watchLater.length };
    }

    /** 记一条观看历史（同一视频只留最新一条，进度更新）。 */
    addHistory(bvid, pos) {
        const e = this.getEntry(bvid);
        if (!e) return null;
        const at = wallNow();
        const rec = {
            bvid: e.bvid,
            pos: Math.max(0, Math.round(numOr(pos, 0))),
            at,
            atText: wallStampText(at, at)
        };
        this.user.history = [rec].concat((this.user.history || []).filter((h) => h.bvid !== e.bvid)).slice(0, 60);
        this._save();
        return rec;
    }

    clearHistory() {
        this.user.history = [];
        this._save();
    }

    removeHistory(bvid) {
        const key = compactText(bvid);
        if (!key) return false;
        const before = (this.user.history || []).length;
        this.user.history = (this.user.history || []).filter((h) => h.bvid !== key);
        this._save();
        return this.user.history.length !== before;
    }

    /** 发弹幕：写入该条目的弹幕列表并返回新弹幕（界面上会立刻飘一条）。
     *  超长就是**截断**，不加省略号：弹幕飘过去时尾巴挂「...」会被当成内容。 */
    addDanmaku(bvid, text) {
        const e = this.getEntry(bvid);
        const t = compactText(text).slice(0, 40);
        if (!e || !t) return null;
        const d = { t: 0, text: t, color: '#FFFFFF', self: true };
        e.danmaku = (Array.isArray(e.danmaku) ? e.danmaku : []).concat([d]).slice(-60);
        e.danmakuCount = numOr(e.danmakuCount, 0) + 1;
        this._save();
        return d;
    }

    addComment(bvid, text, replyTo) {
        const e = this.getEntry(bvid);
        const t = compactText(text, 300);
        if (!e || !t) return null;
        const nowMs = storyNowMs();
        const c = {
            id: 'c-' + hash32('new|' + e.bvid + '|' + t + '|' + nowMs).toString(36),
            user: this.user.name || '我',
            text: t,
            likes: 0,
            liked: false,
            timeText: '刚刚',
            replies: [],
            mine: true
        };
        if (!Array.isArray(e.comments)) e.comments = [];
        const targetId = compactText(replyTo);
        if (targetId) {
            const parent = e.comments.find((x) => x.id === targetId);
            if (parent) {
                if (!Array.isArray(parent.replies)) parent.replies = [];
                parent.replies.push({ id: 'r-' + c.id, user: c.user, text: t, timeText: '刚刚' });
                e.reply = numOr(e.reply, 0) + 1;
                this._save();
                return c;
            }
        }
        e.comments.unshift(c);
        e.reply = numOr(e.reply, 0) + 1;
        this._save();
        return c;
    }

    likeComment(bvid, cid) {
        const e = this.getEntry(bvid);
        if (!e) return null;
        const c = (e.comments || []).find((x) => x.id === compactText(cid));
        if (!c) return null;
        c.liked = !c.liked;
        c.likes = Math.max(0, numOr(c.likes, 0) + (c.liked ? 1 : -1));
        this._save();
        return { liked: c.liked, likes: c.likes };
    }

    addSearchHistory(keyword) {
        const kw = compactText(keyword, 24);
        if (!kw) return [];
        this.searchHistory = [kw].concat(this.searchHistory.filter((x) => x !== kw)).slice(0, 12);
        this._save();
        return this.searchHistory.slice();
    }

    clearSearchHistory() {
        this.searchHistory = [];
        this._save();
    }
}

export default BiliData;