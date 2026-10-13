p = 'index.js'
s = open(p, encoding='utf-8').read()
NL = chr(10)

# ---------- Patch 1: import ----------
old_i = "} from './config/creation-multi-draft.js';"
new_i = old_i + NL + """/* [v4.02.0 · E 包 R3-X4] 跨社媒同一事件的话题页与舆论演变（纯函数）。
 *   接在咽喉的理由与 R3-O8 同族：条目 / 知情状态 / 公开确认全由调用方给，
 *   内核不取数、不写存储、不发布。话题动作族只动「话题本」这一面，
 *   公开条目必须带用户确认标记才落地（私聊秘密不会自动变公共热帖）。 */
import {
    TOPIC_KINDS, TOPIC_LIMITS, normalizeTopicEntry, normalizeTopicBook,
    buildTopicPage, reactionFor, markDraftsDebunked, topicSelfCheck as topicSelfCheckOf,
} from './config/topic-echo.js';"""
assert s.count(old_i) == 1, 'i1=' + str(s.count(old_i))
s = s.replace(old_i, new_i)

# ---------- Patch 2: new key + whitelist ----------
old_k = "    const CW_DRAFTS_KEY = 'cw_drafts';"
new_k = old_k + NL + "    const CW_TOPICS_KEY = 'cw_topics'; /* [v4.02.0 · R3-X4] 话题本：跨社媒同事件条目（发布/转载/评论/辟谣，各带 rootEventId） */"
assert s.count(old_k) == 1, 'k1=' + str(s.count(old_k))
s = s.replace(old_k, new_k)
old_w = "    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop'];"
new_w = "    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop', 'topic'];"
assert s.count(old_w) == 1, 'w1=' + str(s.count(old_w))
s = s.replace(old_w, new_w)

# ---------- Patch 3: read/write ports AFTER cwWriteDrafts function ends ----------
old_d = "    function cwWriteDrafts(rows) {"
assert s.count(old_d) == 1, 'd0=' + str(s.count(old_d))
di = s.index(old_d)
# find the end of cwWriteDrafts: locate the next top-level function after it
end_marker = NL + "    function cwSplitRef"
ei = s.index(end_marker, di)
topic_ports = """    /* [v4.02.0 · R3-X4] 话题本读写口：与草稿本同范式（读不出返 null；写后回读核对行数）。 */
    function cwReadTopicsRaw() {
        try {
            const raw = storage.get(CW_TOPICS_KEY, '[]');
            return typeof raw === 'string' ? raw : JSON.stringify(raw || []);
        } catch (_e) { return null; }
    }
    function cwWriteTopics(entries) {
        try { storage.set(CW_TOPICS_KEY, JSON.stringify(entries)); } catch (_e) { return { ok: false, reason: 'write-failed', entries: entries }; }
        const nb = normalizeTopicBook(cwReadTopicsRaw());
        if (!nb.ok || nb.entries.length !== entries.length) return { ok: false, reason: 'readback-mismatch', entries: entries };
        return { ok: true, entries: nb.entries };
    }
"""
s = s[:ei] + topic_ports + s[ei:]

open(p, 'w', encoding='utf-8').write(s)
print('wiring 1/2 done')