p = 'apps/creationdesk/creationdesk-app.js'
lines = open(p, encoding='utf-8').read().split(chr(10))
NL = chr(10)

# ---------- 1. vm 去重 + 话题读数：行号版 ----------
# 重复块：1-indexed 169..174 -> index 168..173
b = 168
assert lines[b].strip().startswith('drafts: (host && host.drafts)'), lines[b]
assert lines[b + 5].strip() == 'multiTargets: this._multiTargets.slice(),', lines[b + 5]
assert lines[b - 1].strip() == 'multiTargets: this._multiTargets.slice(),', lines[b - 1]
del lines[b:b + 6]
# 现在只剩一份；在 multiTargets 行后插入话题读数
idx2 = [i for i, ln in enumerate(lines) if ln.strip() == 'multiTargets: this._multiTargets.slice(),']
assert len(idx2) == 1, idx2
k = idx2[0]
topics_block = [
    '            /* [v4.02.0 · R3-X4] 话题本读数与话题交互态 */',
    "            topics: (host && host.topics) || { readable: false, reason: '', count: 0, rejected: 0, dropped: 0, kinds: 4, limit: 0 },",
    '            topicsText: (host && host.topics)',
    '                ? (host.topics.readable',
    "                    ? ('话题本 ' + String(host.topics.count) + ' 条（认不出 ' + String(host.topics.rejected) + ' 条）')",
    "                    : ('话题本**读不到**（不是「没话题」—— 这两件事处置相反）：' + String(host.topics.reason || '')))",
    "                : '话题本**读不到**（不是「没话题」）',",
    '            topicSelfCheck: (host && host.topicSelfCheck) || null,',
    '            topicEvent: this._topicEvent,',
    '            topicPlatform: this._topicPlatform,',
    '            topicText: this._topicText,',
    '            topicPage: this._topicPage,',
]
lines = lines[:k + 1] + topics_block + lines[k + 1:]

s = NL.join(lines)

# ---------- 2. 构造函数实例态 ----------
old_c = """        this._multiTargets = [];
        this._flash = '';
        this._flashBad = false;
    }"""
new_c = """        this._multiTargets = [];
        /* [v4.02.0 · R3-X4] 话题交互态：事件键 / 平台 / 文本 / 最近一次话题页读数 */
        this._topicEvent = '';
        this._topicPlatform = '';
        this._topicText = '';
        this._topicPage = null;
        this._flash = '';
        this._flashBad = false;
    }"""
assert s.count(old_c) == 1, 'c1=' + str(s.count(old_c))
s = s.replace(old_c, new_c)

# ---------- 3. onChatChanged 重置 ----------
old_r = """        this._multiTargets = [];
        this._flash = '';
        this._flashBad = false;
        this.render();"""
new_r = """        this._multiTargets = [];
        this._topicEvent = '';
        this._topicPlatform = '';
        this._topicText = '';
        this._topicPage = null;
        this._flash = '';
        this._flashBad = false;
        this.render();"""
assert s.count(old_r) == 1, 'r1=' + str(s.count(old_r))
s = s.replace(old_r, new_r)

# ---------- 4. 话题交互方法 ----------
old_m = "    async act(action) {"
assert s.count(old_m) == 1, 'm1=' + str(s.count(old_m))
new_m = """    /* ---------- [v4.02.0 · R3-X4] 话题页交互 ---------- */
    setTopicEvent(id) { this._topicEvent = String(id || '').trim(); this.render(); return this._topicEvent; }
    setTopicPlatform(pl) { this._topicPlatform = String(pl || '').trim(); return this._topicPlatform; }
    setTopicText(t) { this._topicText = String(t || ''); return this._topicText; }
    /**
     * 话题动作统一入口（与 draftAct 同范式：只转咽喉，不直连、不发布）。
     * @param {string} sub record / page / react / debunk
     * @param {object} [extra] 额外参数（如 actor / knows / kind / confirmed）
     */
    async topicAct(sub, extra) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            this._flash = '创作工作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const ex = (extra && typeof extra === 'object') ? extra : {};
        const payload = {
            action: 'topic',
            topic: sub,
            rootEventId: this._topicEvent,
            platform: this._topicPlatform,
            text: this._topicText,
            kind: ex.kind || 'publish',
            confirmed: ex.confirmed === true,
            actor: ex.actor || '',
            knows: ex.knows === true,
            knowsWhy: ex.knowsWhy || '',
            scope: face && face.scope,
            token: face && face.token,
        };
        if (sub === 'record' || sub === 'debunk') {
            payload.id = String(this._topicPlatform || 'local') + '_' + String(Date.now().toString(36));
            payload.by = 'user';
        }
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        if (r && r.ok === true && r.page) this._topicPage = r.page;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    async act(action) {"""
s = s.replace(old_m, new_m)

open(p, 'w', encoding='utf-8').write(s)
print('app topic layer done')