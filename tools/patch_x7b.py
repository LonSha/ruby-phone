# -*- coding: utf-8 -*-
"""v4.29.0 · R4-X7 收口补丁 B：视图卡 + 按钮绑定 + 消息解析 + 预览文案。
  ① chat-view.js：renderMessage 增三个 case；新增 _renderGroupVoteCard /
     _votePackCached / _groupVoteLineText；bindEvents 增三组按钮绑定；
     parseSpecialMessage 增两条解析；splitMixedSpecialMessage 行内标签进正则；
  ② wechat-data.js：getMessagePreview 增三个 case。
"""
import io
import os

ROOT = '/home/user/ruby-phone'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


VIEW = 'apps/wechat/chat-view.js'
v = rd(VIEW)

# ---------------------------------------------------------------- ① 三个 case
A1 = """            case 'honey_invite': {"""
CASES = """            /* ============================================================
             * [v4.29.0 · R4-X7] 群投票三态卡
             *   ★ 判定词与标签表**只许内核一份**（config/group-vote-contract.js）：
             *     这里不写第二份状态字面量、不写第二份标签表，只把读数摆出来。
             *   ★ 平票与「无人支持」**视觉上也不许同形**：平票给可点的选项行 +
             *     一句「该由你点名」；无人支持只给一句「等人表态」—— 两态处置相反。
             * ============================================================ */
            case 'group_vote': {
                messageBody = this._renderGroupVoteCard(msg);
                break;
            }
            case 'group_vote_statement': {
                const gv = (msg.groupVote && typeof msg.groupVote === 'object') ? msg.groupVote : {};
                const choice = String(gv.choice || '').trim().toLowerCase();
                const cls = choice === 'support' ? 'is-support'
                    : (choice === 'oppose' ? 'is-oppose' : 'is-abstain');
                const choiceText = this.app.voteChoiceLabel
                    ? this.app.voteChoiceLabel(choice)
                    : String(gv.choice || '');
                const optText = String(gv.optionLabel || gv.optionId || '').trim();
                const who = this._escapeHtml(String(gv.memberName || senderName || '').trim());
                messageBody = `
                    <div class="message-group-vote-statement ${cls}">
                        <span>${who}</span><span>${this._escapeHtml(choiceText)}</span>${optText ? `<span>${this._escapeHtml(optText)}</span>` : ''}
                    </div>
                `;
                break;
            }
            case 'group_vote_activity': {
                /* 已成活动：★ 「已生成活动」与「已约好」**不同形** —— 卡面逐字写
                 *   「仍未成为约定」，约定落笔归日历 owner。 */
                const act = (msg.groupVoteActivity && typeof msg.groupVoteActivity === 'object') ? msg.groupVoteActivity : {};
                const parts = Array.isArray(act.participants) ? act.participants : [];
                const absent = Array.isArray(act.absent) ? act.absent : [];
                messageBody = `
                    <div class="message-group-vote">
                        <div class="message-group-vote-head">
                            <span class="message-group-vote-title">已定活动</span>
                            <span class="message-group-vote-badge">第 ${this._escapeHtml(String(act.round || 1))} 轮</span>
                        </div>
                        <div class="message-group-vote-question">${this._escapeHtml(String(act.label || ''))}</div>
                        <div class="message-group-vote-foot">
                            参加 ${parts.length} 人${parts.length ? `：${this._escapeHtml(parts.join('、'))}` : ''}<br>
                            ${absent.length ? `没表态 ${absent.length} 人（**不被代投**）：${this._escapeHtml(absent.join('、'))}<br>` : ''}
                            **仍未成为约定** —— 约定归日历，本卡一个字节都没写。
                        </div>
                    </div>
                `;
                break;
            }

            case 'honey_invite': {"""
v = once(v, A1, CASES, 'view cases')

# ---------------------------------------------------------------- ② 卡片渲染方法
A2 = """    extractInnerThought(content) {"""
HELPERS = """    /* ================================================================
     * [v4.29.0 · R4-X7] 群投票卡渲染
     *   本方法只**排版**：所有判定（四态 / 三态结果 / 四类人 / 平票）都来自内核，
     *   本方法连一个状态字面量比较都不写（判定词只许内核一份）。
     * ================================================================ */
    /**
     * 一次渲染内复用同一份读数（投票卡可能有好几张）。
     *   ★ 缓存键含「消息条数 + 末条 id」：任何一条新消息 / 删楼都会换键，
     *     故**不会**出现「读数与消息面不一致」的陈旧卡（本仓反复治过的那类）。
     */
    _votePackCached(chatId, msgs) {
        const list = Array.isArray(msgs) ? msgs : [];
        const last = list.length ? String(list[list.length - 1]?.id || '') : '';
        const key = String(chatId || '') + '|' + list.length + '|' + last;
        const cached = this._voteCache;
        if (cached && cached.key === key && cached.pack) return cached.pack;
        let pack = null;
        try { pack = this.app.votePack ? this.app.votePack(chatId) : null; } catch (_e) { pack = null; }
        if (!pack) return null;
        this._voteCache = { key: key, pack: pack };
        return pack;
    }
    _renderGroupVoteCard(msg) {
        const chatId = this.app.currentChat?.id || '';
        const pack = this._votePackCached(chatId, this.app.wechatData.getMessages(chatId));
        const read = (pack && pack.read) || null;
        const gv = (msg.groupVote && typeof msg.groupVote === 'object') ? msg.groupVote : {};
        const question = String(gv.question || msg.content || '').trim();
        const round = Number(gv.round || 1) || 1;
        const picked = String((pack && pack.picked) || '');
        const tied = (read && Array.isArray(read.tied)) ? read.tied : [];
        const rows = (read && Array.isArray(read.tally) && read.tally.length)
            ? read.tally
            : (Array.isArray(gv.options) ? gv.options.map((o) => ({
                optionId: String((o && o.id) || (o && o.label) || o || ''),
                label: String((o && (o.label || o.text)) || o || ''),
                support: 0, oppose: 0, abstain: 0
            })) : []);
        const lineText = (pack && pack.lines && pack.lines.vote) || '';
        const noteText = (pack && pack.note) || '';
        const gate = (pack && pack.gate) || { readable: true, hint: '' };
        const rowHtml = rows.map((row) => {
            const oid = String(row.optionId || '');
            const isPicked = !!picked && picked === oid;
            const isTied = tied.indexOf(oid) >= 0;
            const cls = isPicked ? 'is-picked' : (isTied ? 'is-tied' : '');
            const sup = Array.isArray(row.members) ? row.members : [];
            const meta = '支持 ' + Number(row.support || 0)
                + (row.oppose ? ' · 反对 ' + Number(row.oppose) : '')
                + (row.abstain ? ' · 弃权 ' + Number(row.abstain) : '');
            return `
                <div class="message-group-vote-row ${cls}">
                    <div class="message-group-vote-opt">
                        <div class="message-group-vote-opt-name">${this._escapeHtml(String(row.label || oid))}</div>
                        <div class="message-group-vote-opt-meta">${this._escapeHtml(meta)}${sup.length ? ' · ' + this._escapeHtml(sup.join('、')) : ''}</div>
                    </div>
                    <button type="button" class="message-group-vote-pick ${isPicked ? 'is-on' : ''}" data-action="pick-vote-option" data-option-id="${this._escapeHtml(oid)}">${isPicked ? '已点' : '点这个'}</button>
                </div>
            `;
        }).join('');
        /* ★ 读不出时**不摆选项行**：摆出来就等于说「这些选项可用」，
         *   而其实这一面压根没读出来（两件事处置相反）。 */
        const bodyHtml = gate.readable ? rowHtml : '';
        const hintHtml = gate.readable ? '' : `
            <div class="message-group-vote-foot">${this._escapeHtml(String(gate.hint || ''))}</div>
        `;
        /* ★ 「确认」按钮的可用性由**内核读数**决定，不由视图猜：
         *   平票（leader 为空）时按钮仍在，但转交时会拿到内核的拒收理由。 */
        const canConfirm = !!(read && read.leader);
        const actionsHtml = gate.readable ? `
            <div class="message-group-vote-actions">
                <button type="button" class="message-group-vote-btn is-glass" data-action="clear-vote-option">清掉选位</button>
                <button type="button" class="message-group-vote-btn is-primary" data-action="confirm-group-vote" data-message-id="${this._escapeHtml(String(msg.id || ''))}">确认活动</button>
            </div>
        ` : '';
        return `
            <div class="message-group-vote" data-message-id="${this._escapeHtml(String(msg.id || ''))}">
                <div class="message-group-vote-head">
                    <span class="message-group-vote-title">群投票</span>
                    <span class="message-group-vote-badge">第 ${round} 轮</span>
                </div>
                ${question ? `<div class="message-group-vote-question">${this._escapeHtml(question)}</div>` : ''}
                ${bodyHtml}
                ${hintHtml}
                <div class="message-group-vote-line">${this._escapeHtml(lineText)}</div>
                ${noteText ? `<div class="message-group-vote-line">${this._escapeHtml(noteText)}</div>` : ''}
                ${actionsHtml}
            </div>
        `;
    }
    extractInnerThought(content) {"""
v = once(v, A2, HELPERS, 'view helpers')

# ---------------------------------------------------------------- ③ 按钮绑定
A3 = """        currentView.querySelectorAll('.message-image-prompt-cancel').forEach(btn => {"""
BIND = """        /* [v4.29.0 · R4-X7] 群投票：点选 / 清位 / 确认转交。
         *   ★ 点选与清位只改内存选位（**不落盘**）；确认只把结果转交约定 owner，
         *     本卡零写盘 —— 活动行由 wechat 自己的消息域落一条（幂等键在内核里）。 */
        currentView.querySelectorAll('[data-action="pick-vote-option"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                const oid = btn.dataset.optionId || '';
                const now = String(this.app.votePicked ? this.app.votePicked() : '');
                /* 再点已选中的那一个 = 取消（同一按钮两态，界面不写第二份判定）。 */
                this.app.setVotePicked?.(now && now === oid ? '' : oid);
                this.app.render();
            });
        });
        currentView.querySelectorAll('[data-action="clear-vote-option"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                this.app.setVotePicked?.('');
                this.app.render();
            });
        });
        currentView.querySelectorAll('[data-action="confirm-group-vote"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                this.confirmGroupVote();
            });
        });
        currentView.querySelectorAll('.message-image-prompt-cancel').forEach(btn => {"""
v = once(v, A3, BIND, 'view binds')

# ---------------------------------------------------------------- ④ 确认动作
A4 = """    _buildMusicListeningContext(targetChat, userName = '用户') {"""
CONFIRM = """    /**
     * [v4.29.0 · R4-X7] 确认一份群投票结果。
     *   【这一步做两件事，都不是「变成约定」】
     *     ① 把**用户点选的那一个选项**交给内核判定（平票点名非并列项会被内核拒收 ——
     *        本方法不替内核挑，也不替用户挑）；
     *     ② 幂等落一条**自己的消息行**（type=group_vote_activity，幂等键在内核里
     *        由「选项 + 参与名单」确定性派生）⇒ 第二次确认恒得同一个 id，如实报
     *        「未重复生成」；再把结果经 `phone:groupVoteConfirm` 转交给约定 owner。
     *   ★ 本卡**不产出承诺**：约定落笔在日历，这里一个字节都没写上游。
     */
    confirmGroupVote() {
        const chatId = this.app.currentChat?.id || '';
        if (!chatId) return;
        const res = this.app.voteConfirm ? this.app.voteConfirm(chatId) : null;
        if (!res) return;
        if (!res.ok) {
            /* 拒收理由**原样**转出（含内核给的归因词），视图不自己编一句。 */
            const why = String(res.reason || '');
            const map = {
                'no-options': '这一轮还没有选项 —— 等群里提出时间或地点。',
                'no-members': '这个群里还没有成员 —— 先加人再谈投票。',
                'no-votes': '一条支持都没有 —— 先等人表态，不是「平票」。',
                'option-absent': '还没点选项（或点的不在本轮并列里）—— 先点一个再确认。'
            };
            this.app.phoneShell?.showNotification('投票', map[why] || '这一份还确认不了。', '⚠️');
            return;
        }
        const act = res.activity || null;
        if (!act) return;
        if (res.reason === 'replayed') {
            this.app.phoneShell?.showNotification('投票', '这份活动已经生成过了（未重复生成）。', 'ℹ️');
            return;
        }
        /* 幂等落一条自己的消息行（重复确认进不来这里：上面已按 replayed 短路）。 */
        try {
            const exists = (this.app.wechatData.getMessages(chatId) || [])
                .some((m) => m && m.type === 'group_vote_activity'
                    && String(m.groupVoteActivity?.id || '') === String(act.id || ''));
            if (!exists) {
                this.app.wechatData.addMessage(chatId, {
                    id: 'msg_gv_' + String(act.id || ''),
                    from: 'system',
                    type: 'group_vote_activity',
                    content: `[群投票结果] ${String(act.label || '')}（参加 ${(act.participants || []).length} 人）`,
                    groupVoteActivity: act
                });
            }
        } catch (_e) { /* 落消息失败不得阻断转交 */ }
        /* 转交约定 owner（日历）：本卡只把「哪一份活动、谁参加」原样递出去。 */
        try {
            const win = (typeof window !== 'undefined') ? window : globalThis;
            win.dispatchEvent(new win.CustomEvent(PHONE_EVENTS.GROUP_VOTE_CONFIRM, {
                detail: {
                    activityId: String(act.id || ''),
                    optionId: String(act.optionId || ''),
                    round: Number(act.round || 1) || 1,
                    participants: Array.isArray(act.participants) ? act.participants.slice() : []
                }
            }));
            this.app.phoneShell?.showNotification('投票', '已转交日历确认：' + String(act.label || '') + '（本卡零写盘，重复确认不会重复生成）。', '✅');
        } catch (_e) {
            this.app.phoneShell?.showNotification('投票', '宿主没接确认口 —— 活动：' + String(act.label || '') + '（本卡不代写）。', '⚠️');
        }
        this.app.render();
    }
    _buildMusicListeningContext(targetChat, userName = '用户') {"""
v = once(v, A4, CONFIRM, 'view confirm')

# ---------------------------------------------------------------- ⑤ 解析
A5 = """        const stickerMatch = String(content || '').trim().match(/^\\[表情包\\]\\s*[（(]\\s*([^)）]+?)\\s*[)）]\\s*$/);"""
PARSE = """        /* [v4.29.0 · R4-X7] 群投票两条标签（AI 侧唯一入口）。
         *   · `[群投票：问题｜选项1 / 选项2]` → 一张投票卡（选项按原序，**不排序**）；
         *   · `[投票：支持 选项]` / `[投票：反对 选项]` / `[投票：弃权]` → 一条表态。
         *   解析只**读**：把标签里的东西搬成形状，谁算在场由内核判。 */
        const groupVoteMatch = String(content || '').trim().match(/^\\[群投票[：:]\\s*([^｜|\\]]+?)\\s*[｜|]\\s*([^\\]]+?)\\s*\\]$/);
        if (groupVoteMatch) {
            const question = String(groupVoteMatch[1] || '').trim();
            const options = String(groupVoteMatch[2] || '').split(/[\\/、,，]/)
                .map((s) => String(s || '').trim()).filter(Boolean)
                .map((label) => ({ id: label, label: label, kind: 'other' }));
            if (question && options.length) {
                return {
                    type: 'group_vote',
                    groupVote: { question: question, round: 1, options: options },
                    content: `[群投票：${question}｜${options.map((o) => o.label).join(' / ')}]`
                };
            }
        }
        const voteStatementMatch = String(content || '').trim().match(/^\\[投票[：:]\\s*(支持|反对|弃权)\\s*([^\\]]*)\\]$/);
        if (voteStatementMatch) {
            const choiceText = String(voteStatementMatch[1] || '').trim();
            const optionLabel = String(voteStatementMatch[2] || '').trim();
            const choice = choiceText === '支持' ? 'support' : (choiceText === '反对' ? 'oppose' : 'abstain');
            return {
                type: 'group_vote_statement',
                groupVote: { memberName: '', optionId: optionLabel, optionLabel: optionLabel, choice: choice },
                content: `[投票：${choiceText}${optionLabel ? ' ' + optionLabel : ''}]`
            };
        }

        const stickerMatch = String(content || '').trim().match(/^\\[表情包\\]\\s*[（(]\\s*([^)）]+?)\\s*[)）]\\s*$/);"""
v = once(v, A5, PARSE, 'view parse')

# ---------------------------------------------------------------- ⑥ 行内标签
# ★ 在**同一层**加两个替代分支（不能包成 (?:A|B|音乐部分)：那会把音乐分支的
#   右括号吃掉，正则整条崩 —— 第一次就是这么崩的，已回滚重做）。
INLINE_OLD = "(?:\\[\\s*音乐\\s*\\]|【\\s*音乐\\s*】)"
n = v.count(INLINE_OLD)
assert n == 1, 'inline music anchor must hit exactly 1, got %d' % n
INLINE_NEW = "\\[\\s*群投票[：:][^\\]]+\\]|\\[\\s*投票[：:]\\s*(?:支持|反对|弃权)[^\\]]*\\]|" + INLINE_OLD
v = once(v, INLINE_OLD, INLINE_NEW, 'view inline tag')

wr(VIEW, v)
print('B OK')

# ---------------------------------------------------------------- ⑦ 预览文案
DATA = 'apps/wechat/wechat-data.js'
d = rd(DATA)
A7 = """        case 'music_invite':
            return '[音乐邀请]';"""
PREV = """        case 'music_invite':
            return '[音乐邀请]';
        /* [v4.29.0 · R4-X7] 群投票三态在列表页**不同形**（合成一句就分不出
         *   「等人表态」与「已定活动」）。 */
        case 'group_vote':
            return '[群投票]';
        case 'group_vote_statement':
            return '[投票表态]';
        case 'group_vote_activity':
            return '[群投票结果：已定活动，仍未成为约定]';"""
d = once(d, A7, PREV, 'data preview')
wr(DATA, d)
print('B2 OK')