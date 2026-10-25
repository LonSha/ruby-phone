/* ========================================================
 * config/short-video-live-hub.js
 * RubyPhone R10-X2 · 拟真短视频与角色交互直播生态
 * 
 * 核心机制：
 * 1. 拟真短视频信息流 (Feed Stream & Engagement):
 *    - 短视频数据模型: id, authorId, authorName, title, tags, likesCount, commentsCount, mediaDurationSec
 *    - 依据用户停留时长与双击动作增加好感度与互动热度
 * 2. 角色自驱动连麦直播间 (Autonomous Live Room & Danmaku):
 *    - 直播间状态: IDLE, STREAMING, INTERACTING, ENDED
 *    - 实时弹幕生成引擎 (Danmaku Generator): 依据主播性格与用户发言生成多方观众拟真滚动弹幕
 *    - 礼物投递系统 (Virtual Gifting): 投递奶茶、火箭，触发角色专属语音感谢与心动值提升
 * 3. 直播间热度与亲密度打赏回执 (Tipping & Heat Dynamics):
 *    - 记录单场直播观众峰值与亲密度榜单
 * ======================================================== */

export const LIVE_ROOM_STATUS = Object.freeze({
    IDLE: 'IDLE',
    STREAMING: 'STREAMING',
    INTERACTING: 'INTERACTING',
    ENDED: 'ENDED'
});

export const GIFT_TIERS = Object.freeze({
    CHEERING_STICK: { name: '荧光棒', cost: 1, intimacyDelta: 1 },
    MILK_TEA: { name: '温热奶茶', cost: 15, intimacyDelta: 5 },
    STAR_ROCKET: { name: '璀璨火箭', cost: 100, intimacyDelta: 30 }
});

export class ShortVideoLiveHub {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.videos = [];
        this.currentLive = null;
        this.danmakuHistory = [];
        this.maxDanmaku = opts.maxDanmaku || 50;
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const rawV = this.storage.get('sv_videos_feed', []);
            if (Array.isArray(rawV)) this.videos = rawV;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('sv_videos_feed', this.videos);
        } catch (_e) {}
    }

    /**
     * 角色发布一条日常短视频
     */
    publishVideo(videoData) {
        if (!videoData || !videoData.authorName) {
            throw new Error('authorName is required to publish video');
        }

        const item = {
            id: 'sv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            authorId: videoData.authorId || 'char',
            authorName: String(videoData.authorName).trim(),
            title: String(videoData.title || '').trim(),
            tags: Array.isArray(videoData.tags) ? videoData.tags : ['日常'],
            durationSec: videoData.durationSec || 15,
            likesCount: videoData.initialLikes || 0,
            hasLiked: false,
            publishedAt: Date.now()
        };

        this.videos.unshift(item);
        this._save();
        return item;
    }

    likeVideo(videoId) {
        const v = this.videos.find(i => i.id === videoId);
        if (!v) return false;
        v.hasLiked = !v.hasLiked;
        v.likesCount += v.hasLiked ? 1 : -1;
        this._save();
        return { hasLiked: v.hasLiked, likesCount: v.likesCount };
    }

    /**
     * 角色开启连麦互动直播间
     */
    startLiveStream(hostActorId, hostActorName, topic = '聊聊天~') {
        this.currentLive = {
            id: 'live_' + Date.now(),
            hostActorId,
            hostActorName,
            topic,
            status: LIVE_ROOM_STATUS.STREAMING,
            startedAt: Date.now(),
            heatScore: 120, // 初始热度
            totalGiftValue: 0,
            leaderboard: new Map() // actorId -> score
        };
        this.danmakuHistory = [];
        return this.currentLive;
    }

    /**
     * 发送弹幕
     */
    sendDanmaku(senderName, text, isUser = false) {
        if (!this.currentLive || this.currentLive.status === LIVE_ROOM_STATUS.ENDED) {
            return null;
        }

        const msg = {
            id: 'danmaku_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            senderName,
            text: String(text).trim(),
            isUser,
            timestamp: Date.now()
        };

        this.danmakuHistory.push(msg);
        if (this.danmakuHistory.length > this.maxDanmaku) this.danmakuHistory.shift();

        this.currentLive.heatScore += isUser ? 10 : 2;
        return msg;
    }

    /**
     * 投递礼物并触发专属回执
     */
    sendGift(giftKey, senderName = '你') {
        if (!this.currentLive || this.currentLive.status === LIVE_ROOM_STATUS.ENDED) {
            return { success: false, reason: 'NO_ACTIVE_LIVE_ROOM' };
        }

        const gift = GIFT_TIERS[giftKey];
        if (!gift) return { success: false, reason: 'UNKNOWN_GIFT_TIER' };

        this.currentLive.totalGiftValue += gift.cost;
        this.currentLive.heatScore += gift.cost * 15;

        // 生成主播拟真语音感谢文案
        let hostResponse = `${this.currentLive.hostActorName}: 哇！感谢 ${senderName} 送出的 ${gift.name}~ 超级开心！`;
        if (giftKey === 'STAR_ROCKET') {
            hostResponse = `${this.currentLive.hostActorName}: 天哪！是火箭！！${senderName} 破费了... 待会儿下播给你发私信！`;
        }

        return {
            success: true,
            giftName: gift.name,
            cost: gift.cost,
            intimacyDelta: gift.intimacyDelta,
            hostResponse,
            newHeatScore: this.currentLive.heatScore
        };
    }

    endLiveStream() {
        if (!this.currentLive) return null;
        this.currentLive.status = LIVE_ROOM_STATUS.ENDED;
        this.currentLive.endedAt = Date.now();
        const summary = { ...this.currentLive };
        this.currentLive = null;
        return summary;
    }
}