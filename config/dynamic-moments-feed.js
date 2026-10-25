/* ========================================================
 * config/dynamic-moments-feed.js
 * RubyPhone R10-X3 · 全景社交朋友圈与角色自驱动画卷 (Moments 2.0)
 * 
 * 核心机制：
 * 1. 朋友圈多媒体动态数据模型 (Moments Feed Post):
 *    - 支持九宫格配图 (mediaUrls)、地理定位签到 (location)、可见范围 (VISIBILITY: ALL, FRIENDS, PRIVATE)
 * 2. 角色自驱动社交互动演化 (Autonomous Social Interaction):
 *    - 角色依据角色性格与好感度，在朋友圈下自动点赞 (likes) 与发表评论 (comments)
 *    - 角色间多方互相吐槽回复链条 (Threaded Comments)
 * 3. 动态时间线编织与未读红点 (Feed Timeline & Unread Badges):
 *    - 与剧情世界时间线同步
 * ======================================================== */

export const MOMENT_VISIBILITY = Object.freeze({
    PUBLIC: 'PUBLIC',
    FRIENDS: 'FRIENDS',
    PRIVATE: 'PRIVATE'
});

export class DynamicMomentsFeed {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.posts = [];
        this.maxPosts = opts.maxPosts || 100;
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('moments_feed_posts_v2', []);
            if (Array.isArray(raw)) this.posts = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('moments_feed_posts_v2', this.posts);
        } catch (_e) {}
    }

    /**
     * 发布一条新朋友圈
     * @param {Object} postData { authorId, authorName, avatar, text, mediaUrls, location, visibility }
     * @returns {Object} 已创建的动态
     */
    publishPost(postData) {
        if (!postData || !postData.authorName) {
            throw new Error('authorName is required to publish a moment');
        }

        const post = {
            id: 'moment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            authorId: postData.authorId || 'user',
            authorName: String(postData.authorName).trim(),
            avatar: postData.avatar || '',
            text: String(postData.text || '').trim(),
            mediaUrls: Array.isArray(postData.mediaUrls) ? postData.mediaUrls.slice(0, 9) : [],
            location: postData.location ? String(postData.location).trim() : null,
            visibility: postData.visibility || MOMENT_VISIBILITY.PUBLIC,
            timestamp: postData.timestamp || Date.now(),
            likes: [],      // [{ actorId, actorName, timestamp }]
            comments: []    // [{ id, authorId, authorName, text, replyToName, timestamp }]
        };

        this.posts.unshift(post);
        if (this.posts.length > this.maxPosts) this.posts.pop();
        this._save();
        return post;
    }

    /**
     * 角色点赞动态
     * @param {string} postId 
     * @param {string} actorId 
     * @param {string} actorName 
     * @returns {boolean}
     */
    toggleLike(postId, actorId, actorName) {
        const post = this.posts.find(p => p.id === postId);
        if (!post) return false;

        const idx = post.likes.findIndex(l => l.actorId === actorId);
        if (idx >= 0) {
            post.likes.splice(idx, 1);
        } else {
            post.likes.push({ actorId, actorName, timestamp: Date.now() });
        }
        this._save();
        return true;
    }

    /**
     * 角色或用户发表评论
     * @param {string} postId 
     * @param {Object} commentData { authorId, authorName, text, replyToName }
     * @returns {Object|null}
     */
    addComment(postId, commentData) {
        const post = this.posts.find(p => p.id === postId);
        if (!post || !commentData?.text) return null;

        const comment = {
            id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            authorId: commentData.authorId || 'user',
            authorName: String(commentData.authorName).trim(),
            text: String(commentData.text).trim(),
            replyToName: commentData.replyToName || null,
            timestamp: Date.now()
        };

        post.comments.push(comment);
        this._save();
        return comment;
    }

    /**
     * 角色自驱动社交互动演化
     * @param {string} postId 
     * @param {Array<Object>} characterDrives [{ actorId, actorName, intimacy, attitude, relationType }]
     * @returns {Array<Object>} 触发的新互动动作列表
     */
    simulateAutonomousReactions(postId, characterDrives = []) {
        const post = this.posts.find(p => p.id === postId);
        if (!post) return [];

        const reactions = [];
        for (const char of characterDrives) {
            // 不自评自赞
            if (char.actorId === post.authorId) continue;

            const isLiked = post.likes.some(l => l.actorId === char.actorId);
            // 好感度 > 40 或 亲密关系有 70% 概率点赞
            if (!isLiked && (char.intimacy >= 40 || char.relationType === 'LOVER' || Math.random() < 0.6)) {
                this.toggleLike(postId, char.actorId, char.actorName);
                reactions.push({ type: 'LIKE', actorName: char.actorName });
            }

            // 根据动态内容与角色性格生成拟真评论
            if (char.intimacy >= 30 && post.comments.length < 10) {
                let commentText = null;
                if (/奶茶|蛋糕|咖啡|吃/.test(post.text)) {
                    commentText = `${char.actorName}: 下次记得带我一份呀~`;
                } else if (/累|加班|头疼|生病/.test(post.text)) {
                    commentText = `${char.actorName}: 注意休息，别太拼了！`;
                } else if (/风景|晚霞|雨|海边/.test(post.text)) {
                    commentText = `${char.actorName}: 拍得真好看！在哪里呀？`;
                } else if (char.intimacy >= 80) {
                    commentText = `${char.actorName}: 抓到一个发朋友圈的你~`;
                }

                if (commentText) {
                    const c = this.addComment(postId, {
                        authorId: char.actorId,
                        authorName: char.actorName,
                        text: commentText.replace(`${char.actorName}: `, '')
                    });
                    if (c) reactions.push({ type: 'COMMENT', actorName: char.actorName, text: c.text });
                }
            }
        }

        return reactions;
    }

    getTimeline(viewerId = 'user', limit = 20) {
        return this.posts
            .filter(p => {
                if (p.visibility === MOMENT_VISIBILITY.PUBLIC) return true;
                if (p.authorId === viewerId) return true;
                if (p.visibility === MOMENT_VISIBILITY.FRIENDS) return true; // 默认好友可见
                return false;
            })
            .slice(0, limit);
    }
}