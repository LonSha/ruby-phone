/* ============================================================
 * global-pinyin-search-deeplink-router.js — [v4.138.0 · V21-R4]
 * 全局搜索的拼音全拼首字母模糊穿透与深度深链直达 (Pinyin DeepLink Search Router)
 * ------------------------------------------------------------
 * 1. 拼音首字母模糊索引 (Pinyin Abbreviation Indexer)
 * 2. 深度穿透跨 App 数据源（微信消息、备忘录行、相册标签）
 * 3. 深链目标条目高亮直接定位 (DeepLink Route & Target Highlighter)
 * ============================================================ */
export function executePinyinGlobalSearch(query = "", searchIndex = []) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const results = [];

    for (const item of searchIndex) {
        const title = String(item.title || "").toLowerCase();
        const pinyin = String(item.pinyin || "").toLowerCase();
        const abbr = String(item.abbr || "").toLowerCase();
        const snippet = String(item.content || "").toLowerCase();

        let matched = false;
        let matchScore = 0;

        if (title.includes(q)) {
            matched = true;
            matchScore += 10;
        } else if (pinyin.includes(q)) {
            matched = true;
            matchScore += 7;
        } else if (abbr.includes(q)) {
            matched = true;
            matchScore += 5;
        } else if (snippet.includes(q)) {
            matched = true;
            matchScore += 3;
        }

        if (matched) {
            results.push({
                appId: item.appId || "system",
                targetId: item.targetId || item.id,
                title: item.title,
                snippet: item.content ? item.content.slice(0, 40) : "",
                deepLinkUri: `${item.appId}://view?id=${item.targetId || item.id}`,
                score: matchScore
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}
