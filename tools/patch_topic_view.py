p = 'apps/creationdesk/creationdesk-view.js'
s = open(p, encoding='utf-8').read()

# ---------- 1. 新段 _topics（插在 _html 之前） ----------
old_h = "    _html(vm) {"
new_h = """    /** [v4.02.0 · R3-X4] 话题页段：同一事件在各平台的条目聚拢、分类计数、辟谣态。
     *   公开条目必须用户确认才落（私聊秘密不会自动变公共热帖）。 */
    _topics(vm) {
        let h = '<div class="cwb-box"><h3>话题页(同一事件 → 各平台发布/转载/评论/辟谣,核心事实一致)</h3>';
        const tp = vm.topics || {};
        h += '<div class="cwb-note">' + esc(vm.topicsText || '') + ' · 上限 ' + String(tp.limit || 0) + ' 条</div>';
        h += '<div class="cwb-acts">';
        h += '<input class="cwb-inp" data-cw-topic-event type="text" placeholder="事件键 rootEventId" value="' + esc(vm.topicEvent || '') + '">';
        h += '<input class="cwb-inp" data-cw-topic-platform type="text" placeholder="平台(weibo / xhs / tieba / wechat)" value="' + esc(vm.topicPlatform || '') + '">';
        h += '</div>';
        h += '<textarea class="cwb-note-area" data-cw-topic-text rows="3" placeholder="这条要说什么(核心事实 / 转载 / 评论 / 辟谣说明)">' + esc(vm.topicText || '') + '</textarea>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-topic="page">看话题页(只读)</button>';
        h += '<button class="cwb-btn" data-cw-topic="record" data-cw-topic-kind="publish">记一条发布(公开需确认)</button>';
        h += '<button class="cwb-btn" data-cw-topic="record" data-cw-topic-kind="repost">记一条转载</button>';
        h += '<button class="cwb-btn" data-cw-topic="record" data-cw-topic-kind="comment">记一条评论</button>';
        h += '<button class="cwb-btn" data-cw-topic="debunk">记辟谣(同话题草稿转「已被辟谣」)</button>';
        h += '</div>';
        h += '<div class="cwb-note">辟谣只标「已被辟谣」,**不删旧条目**(撤回≠消失);未标确认的公开条目一律拒收</div>';
        const pg = vm.topicPage;
        if (pg && pg.byKind) {
            h += '<div class="cwb-row"><span class="cwb-row-v">' + esc(pg.summary || '') + '</span></div>';
            h += '<div class="cwb-note">发布 ' + String(pg.byKind.publish || 0) + ' · 转载 ' + String(pg.byKind.repost || 0)
                + ' · 评论 ' + String(pg.byKind.comment || 0) + ' · 辟谣 ' + String(pg.byKind.debunk || 0)
                + (pg.debunked ? (' · 已辟谣(' + esc(pg.debunkedBy || '') + ')') : '') + '</div>';
        }
        h += '</div>';
        return h;
    }
    _html(vm) {"""
assert s.count(old_h) == 1, 'h1=' + str(s.count(old_h))
s = s.replace(old_h, new_h)

# ---------- 2. 组装序：drafts 之后、plan 之前 ----------
old_a = """        h += this._drafts(vm);
        h += this._plan(vm);"""
new_a = """        h += this._drafts(vm);
        h += this._topics(vm);
        h += this._plan(vm);"""
assert s.count(old_a) == 1, 'a1=' + str(s.count(old_a))
s = s.replace(old_a, new_a)

# ---------- 3. 头部读数行加话题本 ----------
old_head = "        h += '<div class=\"cwb-note\">' + esc(vm.draftsText || '') + '</div>';"
if s.count(old_head) == 1:
    s = s.replace(old_head, old_head + "\n        h += '<div class=\"cwb-note\">' + esc(vm.topicsText || '') + '</div>';")
else:
    print('WARN head draft line not found, count=' + str(s.count(old_head)))

# ---------- 4. 绑定：四组 ----------
old_b = "        el.querySelectorAll('[data-cw-draft]').forEach(function (b) {"
assert s.count(old_b) == 1, 'b1=' + str(s.count(old_b))
new_b = """        const tEvent = el.querySelector('[data-cw-topic-event]');
        if (tEvent) tEvent.addEventListener('input', function () { self.app.setTopicEvent(tEvent.value); });
        const tPlat = el.querySelector('[data-cw-topic-platform]');
        if (tPlat) tPlat.addEventListener('input', function () { self.app.setTopicPlatform(tPlat.value); });
        const tText = el.querySelector('[data-cw-topic-text]');
        if (tText) tText.addEventListener('input', function () { self.app.setTopicText(tText.value); });
        el.querySelectorAll('[data-cw-topic]').forEach(function (b) {
            b.addEventListener('click', function () {
                const sub = b.getAttribute('data-cw-topic');
                const kind = b.getAttribute('data-cw-topic-kind') || 'publish';
                self.app.topicAct(sub, { kind: kind, confirmed: true, actor: 'user', knows: true });
            });
        });
        el.querySelectorAll('[data-cw-draft]').forEach(function (b) {"""
s = s.replace(old_b, new_b)

open(p, 'w', encoding='utf-8').write(s)
print('view topic layer done')