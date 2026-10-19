# -*- coding: utf-8 -*-
"""v4.29.0 · R4-X7 收口补丁 A：微信链路接线（App 出口 + 消息解析 + 视图卡 + 样式）
  ① apps/wechat/wechat-app.js：导入并实例化 GroupVote、增十个投票出口、
     换会话作废点选、追加投票卡样式；
  ② apps/wechat/chat-view.js：renderMessage 增三个 case（投票 / 表态 / 已成活动）、
     按钮绑定（点选 / 清位 / 确认转交）、parseSpecialMessage 增两条解析、
     splitMixedSpecialMessage 行内标签进正则、消息预览文案；
  ③ apps/wechat/wechat-data.js：getMessagePreview 增三个 case。
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


# ============================================================ ① wechat-app.js
APP = 'apps/wechat/wechat-app.js'
a = rd(APP)

A1 = "import { ImageCropper } from '../settings/image-cropper.js';\n"
NEW_IMP = ("""/* [v4.29.0 · R4-X7] 群聊投票接线件（取数 / 持起点 / 落点形状）。
 *   判定词与标签表**只许内核一份**（config/group-vote-contract.js），本件只转发。 */
import { GroupVote } from './group-vote.js';
""")
a = once(a, A1, A1 + NEW_IMP, 'app import')

A2 = "        this.momentsView = new MomentsView(this);\n"
a = once(a, A2, A2 + ("        /* [v4.29.0 · R4-X7] 群聊投票面：只持「用户点了哪个选项」，读数一律现取。 */\n"
                      "        this.groupVote = new GroupVote(this);\n"), 'app ctor')

# 换会话作废点选（openChat 里换聊天时）
A3 = ("            if (String(this.currentChat?.id || '') !== String(chatId || '')) {\n"
      "                this.chatView?.resetTransientInputPanels?.();\n"
      "            }\n")
a = once(a, A3, ("            if (String(this.currentChat?.id || '') !== String(chatId || '')) {\n"
                 "                this.chatView?.resetTransientInputPanels?.();\n"
                 "                /* [v4.29.0 · R4-X7] 换会话作废「点了哪个选项」—— 上一个群的选位\n"
                 "                 *   拿到这个群来用会把 A 群的共识当成 B 群的结果（读数本来就不缓存）。 */\n"
                 "                try { this.groupVote?.resetScene?.(); } catch (_e) { }\n"
                 "            }\n"), 'app openChat reset')

# 十个出口：追加在类尾（showAddFriendMenu 之后）
A4 = """    // 🔥 新增：显示添加菜单（替代 showAddMenu）
    showAddFriendMenu() {
        this.currentView = 'contacts';
        this.render(); // 先渲染通讯录视图
        setTimeout(() => {
            this.contactsView.showAddFriendPage(); // 再打开添加好友页面
        }, 50);
    }
}"""
NEW_EXITS = """    // 🔥 新增：显示添加菜单（替代 showAddMenu）
    showAddFriendMenu() {
        this.currentView = 'contacts';
        this.render(); // 先渲染通讯录视图
        setTimeout(() => {
            this.contactsView.showAddFriendPage(); // 再打开添加好友页面
        }, 50);
    }
    /* ================================================================
     * [v4.29.0 · R4-X7] 群聊投票面出口（十个）
     *   与 plotline/archive 两件同规格：本层只转发，**不重判任何一格**。
     *   本层一个字节都不落盘：表决结果要变成约定得用户显式转交、落点在约定 owner。
     * ================================================================ */
    /** 一次取齐（读数 + 计数 + 确认 + 两行读数 + 门 + 选位）。 */
    votePack(chatId, opts) {
        const id = String(chatId == null ? (this.currentChat?.id || '') : chatId);
        try { return this.groupVote.pack(id, opts || {}); }
        catch (_e) { return this.groupVote.pack(id, {}); }
    }
    /** 主读数（四态分形）。 */
    voteRead(chatId, opts) {
        const id = String(chatId == null ? (this.currentChat?.id || '') : chatId);
        try { return this.groupVote.tally(id, opts || {}); }
        catch (_e) { return this.groupVote.tally(id, {}); }
    }
    /** 用户点选的选项（'' = 还没点）。 */
    votePicked() {
        try { return this.groupVote.picked; } catch (_e) { return ''; }
    }
    /** 设为要点的那一个；空值即清空（**不回落成票最多的那个**）。 */
    setVotePicked(optionId) {
        try { return this.groupVote.setPicked(optionId); } catch (_e) { return ''; }
    }
    /** 这一面能不能读（判定词只许内核一份，本层只转发）。 */
    voteGate(read) {
        try { return this.groupVote.gate(read); } catch (_e) { return this.groupVote.gate(null); }
    }
    /** 读数的一句说明（'' = 没有要说的）。 */
    voteNote(read) {
        try { return this.groupVote.note(read); } catch (_e) { return ''; }
    }
    /** 三态表态的 id 列表与标签（界面文案的唯一出处 = 内核表）。 */
    voteChoiceIds() {
        try { return this.groupVote.choiceIds(); } catch (_e) { return []; }
    }
    voteChoiceLabel(c) {
        try { return this.groupVote.choiceLabel(c); } catch (_e) { return String(c == null ? '' : c); }
    }
    /** 四类人的 id 列表与标签（缺席不被代投 / 表外不计票 两格在界面上的唯一出处）。 */
    voteBucketIds() {
        try { return this.groupVote.memberBucketIds(); } catch (_e) { return []; }
    }
    voteBucketLabel(b) {
        try { return this.groupVote.memberBucketLabel(b); } catch (_e) { return String(b == null ? '' : b); }
    }
    /** 确认一份活动（幂等）：只把结果转交给约定 owner，**本层零写盘**。 */
    voteConfirm(chatId, optionId) {
        const id = String(chatId == null ? (this.currentChat?.id || '') : chatId);
        try { return this.groupVote.confirm(id, optionId); }
        catch (_e) { return this.groupVote.confirm(id, ''); }
    }
    /** 自检：转发内核十条口径真跑。 */
    voteSelfCheck() {
        try { return this.groupVote.selfCheck(); } catch (_e) { return { problems: ['selfcheck-threw'] }; }
    }
}"""
a = once(a, A4, NEW_EXITS, 'app exits')

# 样式：追加在 .message-music-card-ended 之后
A5 = """.message-music-card-ended {
    flex: 0 0 auto;
    font-size: 11px;
    color: rgba(255,255,255,0.66) !important;
    text-shadow: 0 1px 3px rgba(0,0,0,0.72);
}"""
NEW_CSS = A5 + """

/* ========================================
   [v4.29.0 · R4-X7] 群聊投票卡
   平票与「无人支持」在**视觉上也不许同形**：前者给可点的选项行，
   后者只给一句「等人表态」—— 两态处置相反（你来挑 / 等大家回）。
   ======================================== */
.message-group-vote {
    width: clamp(200px, 62vw, 248px);
    max-width: calc(100vw - 120px);
    background: #fff;
    border-radius: 10px;
    padding: 10px 11px 9px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    font-size: 12px;
    color: #111;
}
.message-left .message-group-vote { border-top-left-radius: 3px; }
.message-right .message-group-vote { border-top-right-radius: 3px; }
.message-group-vote-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}
.message-group-vote-title { font-size: 12px; font-weight: 600; color: #111; }
.message-group-vote-badge {
    font-size: 10px;
    color: #8a8a8a;
    background: rgba(0,0,0,0.04);
    border-radius: 999px;
    padding: 1px 7px;
}
.message-group-vote-question {
    font-size: 13px;
    font-weight: 600;
    color: #111;
    line-height: 1.4;
    margin-bottom: 7px;
    word-break: break-word;
}
.message-group-vote-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 7px;
    border-radius: 7px;
    background: rgba(0,0,0,0.03);
    margin-bottom: 5px;
}
.message-group-vote-row.is-picked { background: rgba(7,193,96,0.10); }
.message-group-vote-row.is-tied { background: rgba(255,152,0,0.12); }
.message-group-vote-opt { flex: 1; min-width: 0; }
.message-group-vote-opt-name {
    font-size: 12px;
    color: #111;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.message-group-vote-opt-meta { font-size: 10px; color: #8a8a8a; margin-top: 1px; }
.message-group-vote-pick {
    flex: 0 0 auto;
    height: 24px;
    padding: 0 10px;
    border: none;
    border-radius: 999px;
    background: #07c160;
    color: #fff;
    font-size: 11px;
    cursor: pointer;
}
.message-group-vote-pick.is-on { background: rgba(0,0,0,0.08); color: #444; }
.message-group-vote-foot {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 0.5px solid rgba(0,0,0,0.06);
    font-size: 10px;
    color: #8a8a8a;
    line-height: 1.5;
}
.message-group-vote-actions { display: flex; gap: 6px; margin-top: 7px; }
.message-group-vote-btn {
    flex: 1;
    height: 28px;
    border: none;
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
}
.message-group-vote-btn.is-glass { background: rgba(0,0,0,0.05); color: #444; }
.message-group-vote-btn.is-primary { background: #07c160; color: #fff; font-weight: 600; }
.message-group-vote-btn:disabled { opacity: 0.5; cursor: default; }
.message-group-vote-line {
    margin-top: 6px;
    font-size: 10px;
    color: #9a9a9a;
    line-height: 1.5;
    word-break: break-word;
}
.message-group-vote-statement {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(0,0,0,0.04);
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    color: #444;
}
.message-group-vote-statement.is-support { background: rgba(7,193,96,0.12); color: #07883f; }
.message-group-vote-statement.is-oppose { background: rgba(244,67,54,0.12); color: #c62828; }
.message-group-vote-statement.is-abstain { background: rgba(0,0,0,0.05); color: #757575; }"""
a = once(a, A5, NEW_CSS, 'app css')
wr(APP, a)
print('A OK')
