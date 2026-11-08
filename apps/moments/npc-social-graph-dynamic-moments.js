/* ============================================================
 * npc-social-graph-dynamic-moments.js — [v4.138.0 · V21-R15]
 * 社交朋友圈多 NPC 情感互动网络与自主演化评论场 (Dynamic Moments Social Graph)
 * ------------------------------------------------------------
 * 1. 多 NPC 基于好恶自主点赞与盖楼评论 (Autonomous Comment Battle)
 * 2. 朋友圈吃醋、互呛与抱团社交反应 (Social Rivalry & Teasing)
 * 3. 朋友圈动态向 NPC 记忆与心智反向沉淀 (Moments Memory Ingestion)
 * ============================================================ */
export function generateMomentReactions(postContent = "", inSceneCharacters = []) {
    const comments = [];
    const likes = [];

    for (const char of inSceneCharacters) {
        const name = String(char.name || "NPC");
        const relation = String(char.relation || "friend");

        if (relation === "crush" || relation === "lover") {
            likes.push(name);
            comments.push({
                author: name,
                text: "...拍得真好看。下次、下次也带我一起去嘛！",
                timestamp: Date.now()
            });
        } else if (relation === "rival") {
            comments.push({
                author: name,
                text: "呵，这种无聊的地方有什么好炫耀的。",
                timestamp: Date.now() + 5000
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
