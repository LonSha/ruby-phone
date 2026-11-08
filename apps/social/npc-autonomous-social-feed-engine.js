/* ============================================================
 * npc-autonomous-social-feed-engine.js — NPC离线生活动态与朋友圈自主演化引擎
 * [v4.140.0 · 昼夜作息自主发圈、互动点赞链与拟真社交时间流]
 * ============================================================ */

export class NPCAutonomousSocialFeedEngine {
    constructor(options = {}) {
        this.options = Object.assign({
            maxFeedLength: 80,
            enableAutoComments: true
        }, options);
        
        this.feedPosts = []; // [ { id, author, content, timePeriod, likes: [], comments: [], postedAt } ]
    }

    generateAutonomousPost(npcName, timePeriod = "night", moodTag = "reflective", customText = null) {
        if (!npcName) return null;

        const periodPools = {
            morning: [
                "晨光透过窗帘缝隙洒在桌角，新磨的黑咖啡有些烫嘴。",
                "街角早点铺的热气，总让人觉得人间尚有温度。",
                "闹钟响了三次才按掉，今天也是兵荒马乱的开头。"
            ],
            afternoon: [
                "午后的阳光晒得人发懒，梧桐树影斑驳了一地。",
                "耳机里循环着同一首歌，忽然想起某个很远的名字。",
                "窗外飞过一群鸽子，风里已经有了换季的凉意。"
            ],
            night: [
                "深夜的城市终于安静下来，台灯的微光格外温暖。",
                "关掉手机屏幕前的胡思乱想，终究化成一声轻叹。",
                "翻看旧相册到凌晨两点，有些记忆永远鲜活如初。"
            ]
        };

        const textList = periodPools[timePeriod] || periodPools.night;
        const chosenText = customText || textList[Math.floor(Math.random() * textList.length)];

        const post = {
            id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            author: String(npcName).trim(),
            content: chosenText,
            timePeriod,
            moodTag,
            likes: [],
            comments: [],
            postedAt: Date.now()
        };

        this.feedPosts.unshift(post);
        if (this.feedPosts.length > this.options.maxFeedLength) {
            this.feedPosts.pop();
        }
        return post;
    }

    interactWithPost(postId, actorName, actionType = "like", commentText = "") {
        const post = this.feedPosts.find(p => p.id === postId);
        if (!post) return null;

        if (actionType === "like") {
            if (!post.likes.includes(actorName)) {
                post.likes.push(actorName);
            }
        } else if (actionType === "comment" && commentText) {
            post.comments.push({
                id: `c_${Date.now()}`,
                author: actorName,
                text: String(commentText).trim(),
                timestamp: Date.now()
            });
        }

        return {
            postId,
            likesCount: post.likes.length,
            commentsCount: post.comments.length,
            post
        };
    }

    exportState() {
        return { feedPosts: this.feedPosts };
    }

    hydrateState(state) {
        if (!state) return;
        if (Array.isArray(state.feedPosts)) this.feedPosts = [...state.feedPosts];
    }
}
if (typeof globalThis !== "undefined") { globalThis.NPCAutonomousSocialFeedEngine = NPCAutonomousSocialFeedEngine; }
if (typeof window !== "undefined") { window.NPCAutonomousSocialFeedEngine = NPCAutonomousSocialFeedEngine; }
if (typeof module !== "undefined" && module.exports) { module.exports = NPCAutonomousSocialFeedEngine; }
export default NPCAutonomousSocialFeedEngine;