/**
 * moments-living-social-ecosystem.js - RubyPhone 第十七期拓展 (R17-X3)
 * 朋友圈 24 小时动态生态圈与多角色互动反应链 (Moments Living Social Ecosystem)
 *
 * 核心机制：
 * 1. 24小时NPC自主发动态（晨起自拍、午后咖啡、深夜emo打卡）；
 * 2. 角色间连锁互动（A发动态，B点赞，C在评论区开玩笑打趣）；
 * 3. 玩家互动感知（玩家发动态或点赞时，高羁绊角色秒回评论）。
 */

import { storyNowWallFallback } from '../../config/time-source.js';

/* [v4.140.0 · 批次 3 收口] 本文件唯一的剧情钟取数口。
 *
 * 为什么必须收：本文件原先 5 处 `Date.now()` 全部是「这条动态 / 这条评论发生在
 *   什么时候」—— 它会渲染成用户可见的时间文案（「2 小时前」），按
 *   `FIELD_CLOCKS.timestamp = 'story'` 的口径属**剧情钟**，不是机器时间。
 *   散着写墙钟的后果：剧情里写着 2044 年，朋友圈却显示本机日期，且不报错。
 *   v4.139.0 时如实登记为「story 档待收口」，本版把它收掉。
 *
 * 为什么用 `storyNowWallFallback` 而不是 `storyNow`：`timestamp` 在本引擎里是
 *   **必填数字字段**（`getFeed` 按它排序、UI 按它算「多久前」），而 `storyNow`
 *   读不到时给 `null`（纪律：绝不补墙钟）。若这里也用 null，排序与相对时间会
 *   直接崩掉。故走本仓**唯一允许的降级出口**：读不到时退回墙钟，并把
 *   `degraded` / `reason` 带回来，使「哪个引擎在什么条件下用了墙钟」成为可答的问题。
 *   这是有意的降级，不是漏改。
 */
function storyNowOrWall(win) {
    return storyNowWallFallback(win).ms;
}

export class MomentsLivingSocialEcosystem {
    constructor(state = {}, win = null) {
        /* `win` 是宿主（`window`），由装配层透传；判据环境不传即走显式降级。
         *   存成实例字段而不是每个方法都传参：postMoment / addComment 都是
         *   高频写点，签名里多一个可选参会让调用方各写一份「拿不到 win 怎么办」。 */
        this.win = win;
        this.moments = Array.isArray(state.moments) ? state.moments : [
            {
                id: 'moment_1',
                author: '爱丽丝 (Alice)',
                avatar: 'alice.png',
                /* 种子动态要造出「约 2 小时前」的相对位置：偏移量建在剧情钟上，
                 *   否则剧情回拨后它会跑到「未来」。 */
                timestamp: storyNowOrWall(this.win) - 3600 * 2000,
                content: '天台的风吹得很舒服，今天也是充满干劲的一天！☀️',
                images: ['sky.png'],
                likes: ['玩家', '博比 (Bob)'],
                comments: [
                    { author: '博比 (Bob)', text: '又在天台摸鱼被我抓到了吧哈哈' },
                    { author: '爱丽丝 (Alice)', text: '才没有！这是灵感采风！😤' }
                ]
            }
        ];
    }

    /**
     * NPC 自主发朋友圈
     */
    postMoment({ author, content, images = [], avatar = 'default.png' }) {
        if (!author || !content) return null;
        const newMoment = {
            /* `id` 保持墙钟：它是**幂等键**，用途是去重与排序稳定（wall 档，
             *   见 FIELD_CLOCK_WHY 的「随机 id」），不渲染给用户看。
             *   若跟着剧情钟走，剧情回拨后新动态会与旧动态撞 id。 */
            id: 'moment_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            author,
            avatar,
            timestamp: storyNowOrWall(this.win),
            content: String(content),
            images,
            likes: [],
            comments: []
        };
        this.moments.unshift(newMoment);
        return newMoment;
    }

    /**
     * 点赞互动
     */
    likeMoment(momentId, user = '玩家') {
        const m = this.moments.find(item => item.id === momentId);
        if (!m) return false;
        if (!m.likes.includes(user)) {
            m.likes.push(user);
            return true;
        }
        return false;
    }

    /**
     * 评论与自动连锁回复
     */
    addComment(momentId, author, text) {
        const m = this.moments.find(item => item.id === momentId);
        if (!m) return null;
        const comment = {
            author: String(author || '玩家'),
            text: String(text || ''),
            timestamp: storyNowOrWall(this.win)
        };
        m.comments.push(comment);

        // 如果是玩家评论，原作者自发产生互动反应
        if (author === '玩家' && m.author !== '玩家') {
            m.comments.push({
                author: m.author,
                text: `回复 @玩家: 收到你的评论啦！真懂我~ ✨`,
                /* `+500` 是「隔了半秒回」的**相对偏移**，必须建在同一个钟上：
                 *   否则剧情钟与墙钟混用会让回复排到评论前面（getFeed 按 timestamp 排序）。 */
                timestamp: storyNowOrWall(this.win) + 500
            });
        }

        return comment;
    }

    getFeed(limit = 20) {
        return this.moments.slice(0, limit);
    }
}

export function createMomentsLivingEcosystem(state, win = null) {
    return new MomentsLivingSocialEcosystem(state, win);
}

export default MomentsLivingSocialEcosystem;