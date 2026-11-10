/* ============================================================
 * npc-social-graph-dynamic-moments.js — [v4.138.0 · V21-R15]
 * 社交朋友圈多 NPC 情感互动网络与自主演化评论场 (Dynamic Moments Social Graph)
 * ------------------------------------------------------------
 * 1. 多 NPC 基于好恶自主点赞与盖楼评论 (Autonomous Comment Battle)
 * 2. 朋友圈吃醋、互呛与抱团社交反应 (Social Rivalry & Teasing)
 * 3. 朋友圈动态向 NPC 记忆与心智反向沉淀 (Moments Memory Ingestion)
 * ============================================================ */

import { storyNowWallFallback } from '../../config/time-source.js';

/* [v4.140.0 · 批次 3 收口] 本文件原先 2 处裸 `Date.now()`，都是评论的
 *   「这句话什么时候说的」—— 会渲染成用户可见的时间文案，按
 *   `FIELD_CLOCKS.timestamp = 'story'` 属**剧情钟**。v4.139.0 时如实登记为
 *   「story 档待收口」，本版收掉。
 *
 * 为什么走 `storyNowWallFallback` 而不是 `storyNow`：调用方
 *   （`apps/wechat/moments-view.js`）把返回的 comments 直接塞进朋友圈评论列表，
 *   渲染侧按 timestamp 排序并算相对时间；`storyNow` 读不到时给 `null`（纪律：
 *   绝不补墙钟），会让排序与相对时间崩掉。故走唯一允许的显式降级出口。
 */
function storyNowOrWall(win) {
    return storyNowWallFallback(win).ms;
}

/**
 * @param {string} postContent 这条动态的正文
 * @param {Array<{name?:string, relation?:string}>} inSceneCharacters 在场角色
 * @param {object|null} win 宿主（`window`）；装配层透传，判据环境不传即显式降级
 */
export function generateMomentReactions(postContent = "", inSceneCharacters = [], win = null) {
    const comments = [];
    const likes = [];
    const now = storyNowOrWall(win);

    for (const char of inSceneCharacters) {
        const name = String(char.name || "NPC");
        const relation = String(char.relation || "friend");

        if (relation === "crush" || relation === "lover") {
            likes.push(name);
            comments.push({
                author: name,
                text: "...拍得真好看。下次、下次也带我一起去嘛！",
                timestamp: now
            });
        } else if (relation === "rival") {
            comments.push({
                author: name,
                text: "呵，这种无聊的地方有什么好炫耀的。",
                /* `+5000` 是「隔了几秒才阴阳一句」的**相对偏移**：建在同一个钟上，
                 *   否则剧情钟与墙钟混用会让这条评论排到别的评论前面。 */
                timestamp: now + 5000
            });
        } else {
            likes.push(name);
        }
    }

    return {
        postContent,
        likes,
        comments
    };
}
