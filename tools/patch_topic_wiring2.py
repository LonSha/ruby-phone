p = 'index.js'
s = open(p, encoding='utf-8').read()
NL = chr(10)

# ---------- Patch A: refreshCreationdesk 话题读数 ----------
old_a = """                multiSelfCheck: cmdSelfCheckOf(),"""
new_a = """                multiSelfCheck: cmdSelfCheckOf(),
                /* [v4.02.0 · R3-X4] 话题本读数：读不出与空分开；被拒条目如实计数。 */
                topics: (function () {
                    const tb = normalizeTopicBook(cwReadTopicsRaw());
                    return {
                        readable: tb.ok, reason: tb.reason,
                        count: tb.entries.length, rejected: tb.rejected, dropped: tb.dropped,
                        kinds: Object.keys(TOPIC_KINDS).length,
                        limit: TOPIC_LIMITS.entries,
                    };
                })(),
                topicSelfCheck: topicSelfCheckOf(),"""
assert s.count(old_a) == 1, 'a1=' + str(s.count(old_a))
s = s.replace(old_a, new_a)

# ---------- Patch B: topic 动作族分流（挂在草稿本四动作分支之前） ----------
old_b = "            if (action === 'compose' || action === 'edit' || action === 'redo' || action === 'drop') {"
new_b = """            /* ══════ [v4.02.0 · R3-X4] 话题动作族：只动话题本与草稿本状态，一律不发布 ══════
             *   · record：落一条话题条目（publish/repost/comment/debunk 四类，必须带 rootEventId；
             *     公开条目必须 confirmed===true 才收——「公开范围由用户确认」的闸在内核 normalizeTopicEntry）；
             *   · page：按 rootEventId 聚话题页（发布/转载/评论/辟谣分类计数 + 转述链 + 辟谣态）；
             *   · react：按角色知情态生成反应（不知情不编反应；信源数按来源链计不按平台数计）；
             *   · debunk：辟谣落地 + 同话题草稿标 stale（旧条目不删，撤回≠消失）。 */
            if (action === 'topic') {
                const tKind = String(p.topic || p.sub || '').trim();
                if (!tKind) return { ok: false, note: '话题动作缺子命令（record / page / react / debunk）', kind: 'no-topic-sub' };
                if (tKind === 'record') {
                    const n = normalizeTopicEntry({
                        rootEventId: p.rootEventId, kind: p.kind, platform: p.platform, id: p.id,
                        text: p.text, by: p.by, visibleTo: p.visibleTo, confirmed: p.confirmed,
                        origin: p.origin, time: Date.now(),
                    });
                    if (!n.ok) return { ok: false, note: '条目被拒：' + n.reason, kind: 'topic-entry-rejected' };
                    const nb = normalizeTopicBook(cwReadTopicsRaw());
                    if (!nb.ok && nb.entries.length) return { ok: false, note: '话题本读不出：' + nb.reason, kind: 'topic-book-unreadable' };
                    /* 同键后到覆盖：先撤旧行再落新行 */
                    const rows = nb.entries.filter(function (e) { return e.key !== n.entry.key; });
                    rows.push(n.entry);
                    const w = cwWriteTopics(rows);
                    refreshCreationdesk();
                    return w.ok
                        ? { ok: true, kind: 'topic-recorded', note: '已记录 ' + TOPIC_KINDS[n.entry.kind].label + '（rootEventId ' + n.entry.rootEventId + '）' + (n.entry.isPublic ? '（公开，用户已确认）' : ''), entry: n.entry, count: rows.length }
                        : { ok: false, kind: w.reason, note: '话题本落盘失败（不得当作已记录）' };
                }
                if (tKind === 'page') {
                    const rid = String(p.rootEventId || '').trim();
                    if (!rid) return { ok: false, note: '缺 rootEventId，建不了话题页', kind: 'no-root-event' };
                    const nb = normalizeTopicBook(cwReadTopicsRaw());
                    const pg = buildTopicPage(nb.entries, rid);
                    if (!pg.found) return { ok: false, note: '话题页建不起来：' + pg.reason, kind: 'no-topic-page' };
                    return { ok: true, kind: 'topic-page', note: pg.summary, page: { byKind: pg.byKind, platforms: pg.platforms, debunked: pg.debunked, debunkedBy: pg.debunkedBy, count: pg.entries.length, chains: pg.chains, summary: pg.summary } };
                }
                if (tKind === 'react') {
                    const nb = normalizeTopicBook(cwReadTopicsRaw());
                    const pg = buildTopicPage(nb.entries, String(p.rootEventId || '').trim());
                    const rc = reactionFor(pg, String(p.actor || ''), { knows: p.knows === true, knowsWhy: String(p.knowsWhy || '') });
                    if (!rc.ok) return { ok: false, note: '不生成反应：' + rc.reason, kind: 'no-reaction' };
                    return { ok: true, kind: 'topic-reaction', note: rc.text, sourcesCount: rc.sourcesCount };
                }
                if (tKind === 'debunk') {
                    const n = normalizeTopicEntry({
                        rootEventId: p.rootEventId, kind: 'debunk', platform: p.platform, id: p.id,
                        text: p.text, by: p.by, time: Date.now(),
                    });
                    if (!n.ok) return { ok: false, note: '辟谣条目被拒：' + n.reason, kind: 'topic-entry-rejected' };
                    const nb = normalizeTopicBook(cwReadTopicsRaw());
                    const rows = nb.entries.filter(function (e) { return e.key !== n.entry.key; });
                    rows.push(n.entry);
                    const w = cwWriteTopics(rows);
                    if (!w.ok) return { ok: false, kind: w.reason, note: '话题本落盘失败（不得当作已辟谣）' };
                    /* 辟谣传播：同话题草稿全部标 stale（文字保留、不得当作现状继续发布） */
                    const bookNorm2 = normalizeDraftBook(cwReadDraftsRaw());
                    const md = markDraftsDebunked(bookNorm2.drafts, n.entry.rootEventId, n.entry.by || '辟谣人');
                    let staleNote = '';
                    if (md.changed > 0) {
                        const w2 = cwWriteDrafts(md.drafts);
                        staleNote = w2.ok ? ('；同话题草稿 ' + String(md.changed) + ' 份已标「已被辟谣」') : '；草稿标记失败（辟谣已落地）';
                    }
                    refreshCreationdesk();
                    return { ok: true, kind: 'topic-debunked', note: '已记录辟谣（rootEventId ' + n.entry.rootEventId + '）' + staleNote, changed: md.changed };
                }
                return { ok: false, note: '不认识的话题子命令：' + tKind, kind: 'bad-topic-sub' };
            }
            if (action === 'compose' || action === 'edit' || action === 'redo' || action === 'drop') {"""
assert s.count(old_b) == 1, 'b1=' + str(s.count(old_b))
s = s.replace(old_b, new_b)

open(p, 'w', encoding='utf-8').write(s)
print('wiring 2/2 done')