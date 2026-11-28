export function projectMomentReactions(postContent, inSceneCharacters, now) {
    const comments = [];
    const likes = [];

    for (const char of Array.isArray(inSceneCharacters) ? inSceneCharacters : []) {
        if (!char || typeof char !== 'object') continue;
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
