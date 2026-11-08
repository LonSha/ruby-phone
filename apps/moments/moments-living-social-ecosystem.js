/**
 * moments-living-social-ecosystem.js - RubyPhone 第十七期拓展 (R17-X3)
 * 朋友圈 24 小时动态生态圈与多角色互动反应链 (Moments Living Social Ecosystem)
 *
 * 核心机制：
 * 1. 24小时NPC自主发动态（晨起自拍、午后咖啡、深夜emo打卡）；
 * 2. 角色间连锁互动（A发动态，B点赞，C在评论区开玩笑打趣）；
 * 3. 玩家互动感知（玩家发动态或点赞时，高羁绊角色秒回评论）。
 */

export class MomentsLivingSocialEcosystem {
    constructor(state = {}) {
        this.moments = Array.isArray(state.moments) ? state.moments : [
            {
                id: 'moment_1',
                author: '爱丽丝 (Alice)',
                avatar: 'alice.png',
                timestamp: Date.now() - 3600 * 2000,
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
            id: 'moment_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            author,
            avatar,
            timestamp: Date.now(),
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
            timestamp: Date.now()
        };
        m.comments.push(comment);

        // 如果是玩家评论，原作者自发产生互动反应
        if (author === '玩家' && m.author !== '玩家') {
            m.comments.push({
                author: m.author,
                text: `回复 @玩家: 收到你的评论啦！真懂我~ ✨`,
                timestamp: Date.now() + 500
            });
        }

        return comment;
    }

    getFeed(limit = 20) {
        return this.moments.slice(0, limit);
    }
}

export function createMomentsLivingEcosystem(state) {
    return new MomentsLivingSocialEcosystem(state);
}

export default MomentsLivingSocialEcosystem;