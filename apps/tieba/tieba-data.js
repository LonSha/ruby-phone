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
 * apps/tieba/tieba-data.js — 贴吧数据层（v4.161.0）
 * ------------------------------------------------------------
 * 这一层只管「吧 / 帖子 / 楼层 / 点赞」这几张表，不碰 DOM、不读宿主。
 * 三条口径写在这里，因为它们是**数据契约**而不是画法：
 *   ① 落盘形状：`ruby_tieba_posts` 存的是**裸数组**（entry-integrity 的
 *      bareArrayProducers 点名要这个形状，别改成对象，改了老档就读不回来）；
 *   ② 楼层号：1 楼是楼主帖，回复从 2 楼起，号数是 `replies.length + 2`，
 *      删帖不回收号段（贴吧真机也不回收，跳号是正常的）；
 *   ③ 模型标签：`<Tieba>…</Tieba>` / `<Tie>` 都可能出现，一条消息里出现多个
 *      就逐个入库，返回**数组**（上一版只取第一个，后面几个标签静默丢掉）。
 * ============================================================ */
const STORAGE_KEY = 'ruby_tieba_posts';

/** 文本归一：去首尾空白、压缩空格；`max > 0` 时截断（不补省略号，画的时候再补）。 */
function cut(value, max = 0) {
    const text = String(value == null ? '' : value).trim().replace(/[ \t\r\n]+/g, ' ');
    if (max > 0 && text.length > max) return text.slice(0, max);
    return text;
}

/** 稳定小哈希：只用于给头像挑色调与生成 id，不参与任何判定。 */
function hash32(input) {
    const s = String(input == null ? '' : input);
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** 楼层归一：旧档里可能只有 {author,text,time}，缺 floor 就按顺序补。 */
function normalizeReply(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const text = cut(raw.text != null ? raw.text : raw.content, 400);
    if (!text) return null;
    const floor = Number(raw.floor);
    return {
        id: cut(raw.id) || 'r-' + hash32('tieba|r|' + index + '|' + text),
        author: cut(raw.author) || '吧友',
        text,
        time: cut(raw.time) || '',
        floor: Number.isFinite(floor) && floor > 0 ? Math.round(floor) : index + 2
    };
}

/** 帖子归一：字段缺了就补默认，别让模板层到处写 `|| ''`。 */
function normalizePost(raw, fallbackBar) {
    if (!raw || typeof raw !== 'object') return null;
    const title = cut(raw.title, 120);
    if (!title) return null;
    const replies = (Array.isArray(raw.replies) ? raw.replies : [])
        .map((r, i) => normalizeReply(r, i))
        .filter(Boolean);
    const likes = Number(raw.likes);
    const author = cut(raw.author) || '匿名吧友';
    return {
        id: cut(raw.id) || 'post_' + hash32('tieba|' + title + '|' + author),
        barId: cut(raw.barId) || (fallbackBar && fallbackBar.id) || 'bar_jc',
        barName: cut(raw.barName) || (fallbackBar && fallbackBar.name) || '江城生活吧',
        title,
        content: cut(raw.content, 2000),
        author,
        avatar: cut(raw.avatar),
        time: cut(raw.time) || '刚刚',
        likes: Number.isFinite(likes) && likes > 0 ? Math.round(likes) : 0,
        isLiked: raw.isLiked === true,
        replies
    };
}

export class TiebaData {
    constructor(storage) {
        this.storage = storage;
        this.storageKey = STORAGE_KEY;
        /* 三个吧是**虚构**样本：不搬真实吧名与真实人数，避免把现实里的吧当作
         * 剧情道具。人数只用于展示，不进任何计算。 */
        this.bars = [
            { id: 'bar_jc', name: '江城生活吧', follows: '12.8万', postsCount: '45.2万' },
            { id: 'bar_rz', name: '弱智吧', follows: '245万', postsCount: '890万' },
            { id: 'bar_uni', name: '青石大学吧', follows: '6.4万', postsCount: '18.9万' }
        ];
        this.posts = [];
        this.loadPosts();
    }

    /* ---------- 1. 存取 ---------- */

    loadPosts() {
        try {
            const raw = this.storage?.get?.(this.storageKey);
            const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(list) && list.length) {
                this.posts = list.map((p) => normalizePost(p)).filter(Boolean);
            } else {
                this.posts = this._getDefaultPosts().map((p) => normalizePost(p)).filter(Boolean);
            }
        } catch (e) {
            console.warn('[TiebaData] 读取帖子失败:', e && e.message);
            this.posts = this._getDefaultPosts().map((p) => normalizePost(p)).filter(Boolean);
        }
    }

    savePosts() {
        try {
            this.storage?.set?.(this.storageKey, this.posts);
        } catch (e) {
            console.warn('[TiebaData] 保存帖子失败:', e && e.message);
        }
    }

    _getDefaultPosts() {
        return [
            {
                id: 'post_1',
                barId: 'bar_jc',
                barName: '江城生活吧',
                title: '东方大厦这边的晚风真舒服，有人一起夜跑吗？',
                content: '刚下班，在江边吹风。感觉整座城市的霓虹都倒映在水里，心情突然放松下来了。顺便问问附近有什么好吃的夜宵摊推荐？',
                author: '江城夜归人',
                time: '30分钟前',
                likes: 19,
                isLiked: false,
                replies: [
                    { author: '顾海棠', text: '东门转角那家炒螺丝很地道，不过这个点可能要排队。', time: '20分钟前', floor: 2 },
                    { author: '林梦落', text: '夜跑＋夜宵，这波热量直接守恒了属于是。', time: '15分钟前', floor: 3 }
                ]
            },
            {
                id: 'post_2',
                barId: 'bar_rz',
                barName: '弱智吧',
                title: '既然熬夜对身体不好，那为什么我通宵通得这么精神？',
                content: '如题，感觉医学界对我隐瞒了人体的真实潜能。',
                author: '哲学大蒜',
                time: '2小时前',
                likes: 88,
                isLiked: false,
                replies: [
                    { author: '回光返照研究员', text: '手机没电前屏幕还会亮最后一下呢。', time: '1小时前', floor: 2 },
                    { author: '熬夜冠军', text: '因为你的灵魂已经先你一步睡着了。', time: '50分钟前', floor: 3 }
                ]
            },
            {
                id: 'post_3',
                barId: 'bar_uni',
                barName: '青石大学吧',
                title: '图书馆四楼靠窗的位置到底是谁在长期占座？',
                content: '连续一周了，早上八点到那儿就是一件外套加一本《线性代数》，人一直不出现。',
                author: '三食堂常客',
                time: '昨天 21:40',
                likes: 34,
                isLiked: false,
                replies: [
                    { author: '考研第三年', text: '经典占座，建议找管理员贴条。', time: '昨天 22:05', floor: 2 }
                ]
            }
        ];
    }

    /* ---------- 2. 读 ---------- */

    getBars() {
        return this.bars.map((b) => ({ ...b }));
    }

    getBar(barId) {
        return this.bars.find((b) => b.id === barId) || null;
    }

    /** 按吧取帖子：`all`/空 → 全部；找不到的吧 → 空数组（不静默回退成「全部」）。 */
    getPostsByBar(barId) {
        if (!barId || barId === 'all') return this.posts.slice();
        return this.posts.filter((p) => p.barId === barId);
    }

    getPostById(postId) {
        return this.posts.find((p) => p.id === postId) || null;
    }

    /** 本地搜索：标题 / 正文 / 作者 / 吧名；空词不出结果（不把「全量」假装成搜索结果）。 */
    searchPosts(keyword) {
        const q = cut(keyword).toLowerCase();
        if (!q) return [];
        return this.posts.filter((p) => (
            p.title.toLowerCase().indexOf(q) >= 0
            || p.content.toLowerCase().indexOf(q) >= 0
            || p.author.toLowerCase().indexOf(q) >= 0
            || p.barName.toLowerCase().indexOf(q) >= 0
        ));
    }

    /** 统计：只数得出来的东西（帖子 / 回复 / 吧）。 */
    stats() {
        const replies = this.posts.reduce((sum, p) => sum + p.replies.length, 0);
        return { posts: this.posts.length, replies, bars: this.bars.length };
    }

    /* ---------- 3. 写 ---------- */

    createPost(barId, title, content, author = '我') {
        const bar = this.getBar(barId) || this.bars[0];
        const post = normalizePost({
            id: '',
            barId: bar.id,
            barName: bar.name,
            title,
            content,
            author,
            time: '刚刚',
            likes: 0,
            isLiked: false,
            replies: []
        }, bar);
        if (!post) return null;
        this.posts.unshift(post);
        this.savePosts();
        return post;
    }

    /** 回帖：返回新楼层（含楼层号）；帖子不存在或正文为空返回 null。 */
    addReply(postId, text, author = '我') {
        const post = this.getPostById(postId);
        const body = cut(text, 400);
        if (!post || !body) return null;
        const reply = {
            id: 'r-' + hash32('tieba|r|' + post.id + '|' + post.replies.length + '|' + body),
            author: cut(author) || '我',
            text: body,
            time: '刚刚',
            floor: post.replies.length + 2
        };
        post.replies.push(reply);
        this.savePosts();
        return reply;
    }

    /** 点赞：对称可撤销，计数不许掉到负数。 */
    toggleLike(postId) {
        const post = this.getPostById(postId);
        if (!post) return null;
        post.isLiked = !post.isLiked;
        post.likes = Math.max(0, post.likes + (post.isLiked ? 1 : -1));
        this.savePosts();
        return { on: post.isLiked, count: post.likes, title: post.title };
    }

    /* ---------- 4. 模型标签入库 ---------- */

    /**
     * 解析一条消息里的 `<Tieba>{...}</Tieba>` / `<Tie>{...}</Tie>`。
     * 返回**新帖数组**（解析不出就是空数组，调用方据此决定要不要重绘）。
     */
    parseFromMessage(text) {
        const src = String(text == null ? '' : text);
        const out = [];
        const re = /<tie(?:ba)?>([\s\S]*?)<\/tie(?:ba)?>/gi;
        let m;
        while ((m = re.exec(src)) !== null) {
            let payload = null;
            try {
                payload = JSON.parse(String(m[1] || '').trim());
            } catch (_e) {
                payload = null;
            }
            if (!payload) continue;
            const list = Array.isArray(payload) ? payload : [payload];
            for (const item of list) {
                if (!item || typeof item !== 'object') continue;
                const created = this.createPost(
                    cut(item.barId) || 'bar_jc',
                    cut(item.title, 120),
                    cut(item.content, 2000),
                    cut(item.author) || '网友'
                );
                if (created) out.push(created);
            }
        }
        return out;
    }
}

export default TiebaData;