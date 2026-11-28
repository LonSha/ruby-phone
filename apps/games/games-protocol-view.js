/* ========================================================
 * games-protocol-view.js — [v4.192.0] 游戏 AI 协议解析 · 视图
 * 纪律：_boundRoot === root 去重 / data-act 委派 / CSS 自注入 / 无 input 监听。
 * 界面是十三组试算格子：卧底发牌 / 卧底发言 / 卧底投票 / 卧底日志 /
 *   狼人匹配 / 狼人发言 / 狼人遗言 / 夜行动 / 夜步骤角色 / 投票决策 /
 *   公开发言日志 / 票型归并 / 场上状态消息 + JSON 输出。
 * ======================================================== */

const DEALER_SAMPLE = [
    '<玩家生成>',
    '玩家昵称：抽象仙人',
    '性格：嘴很硬，喜欢先划水再补刀',
    '---',
    '玩家昵称：深夜崩溃',
    '性格：话不多，但每句都带暗示',
    '</玩家生成>',
    '<游戏身份词>',
    '普通玩家身份词：传教士',
    '卧底玩家身份词：老汉推车',
    '</游戏身份词>'
].join('\n');

const SPEECH_SAMPLE = '<狼人杀发言>\n发言：我是好人，昨晚什么都没看到。\n</狼人杀发言>';

const NIGHT_SAMPLE = [
    '<狼人杀夜晚行动>',
    '目标：4号',
    '药剂：解药',
    '讨论：先出 4，明天再看 7',
    '理由：4 号票型最怪',
    '</狼人杀夜晚行动>'
].join('\n');

const VOTE_SAMPLE = [
    '<狼人杀投票>',
    '票型：1 -> 4，2 投 7，3 弃票，4 -> 4',
    '出局：4号',
    '理由：4 号发言矛盾',
    '</狼人杀投票>'
].join('\n');

const MATCH_SAMPLE = [
    '【 1 号 】',
    '姓名：青岚',
    '性别：女',
    '性格及语言风格：冷静，喜欢盘逻辑',
    '---',
    '【 2 号 】',
    '姓名：夜航',
    '性别：男',
    '性格及语言风格：话少但会抓矛盾'
].join('\n');

const UNDERCOVER_VOTE_SAMPLE = [
    '<谁是卧底投票>',
    '票型：1号 -> 3号，2号 投给 5号，3号 → 3号',
    '</谁是卧底投票>'
].join('\n');

import { viewText } from '../../config/view-text.js';
export class GamesProtocolView {
    constructor(app, shell) {
        this.app = app;
        this.shell = shell;
        this._root = null;
        this._boundRoot = null;
        this._flash = '';
    }

    _ensureCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            if (document.getElementById('games-protocol-css')) return;
            const link = document.createElement('link');
            link.id = 'games-protocol-css';
            link.rel = 'stylesheet';
            link.href = new URL('./games-protocol.css?v=1.0.0', import.meta.url).href;
            document.head.appendChild(link);
        } catch (_e) { /* 无头如实不注入 */ }
    }

    render() {
        this._ensureCss();
        const container = (this.shell && this.shell.getContentContainer) ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'gp-root';
        root.innerHTML = this._html();
        container.appendChild(root);
        this._root = root;
        this._bind(root);
    }

    refresh() {
        if (!this._root) { this.render(); return; }
        this._root.innerHTML = this._html();
    }

    _flashText(msg) { this._flash = msg || ''; this.refresh(); }

    _html() {
        const o = this.app.lastOut;
        const out = o ? viewText(JSON.stringify(o)) : '还没试算过';
        return '<div class="gp-head">'
            + '<div class="gp-title">游戏 AI 协议解析试算台</div>'
            + '<div class="gp-sub">同一段回包 => 同一份结构（内核纯函数，不取时钟不造随机）</div>'
            + '</div>'
            + '<div class="gp-grid">'
            + '<button type="button" data-act="dealer">卧底发牌回包</button>'
            + '<button type="button" data-act="ucspeech">卧底发言</button>'
            + '<button type="button" data-act="ucvotes">卧底投票</button>'
            + '<button type="button" data-act="uclog">卧底展示日志</button>'
            + '<button type="button" data-act="match">狼人匹配回包</button>'
            + '<button type="button" data-act="speech">狼人发言</button>'
            + '<button type="button" data-act="lastwords">狼人遗言</button>'
            + '<button type="button" data-act="night">夜晚行动回包</button>'
            + '<button type="button" data-act="nightactor">夜晚步骤→角色</button>'
            + '<button type="button" data-act="chatlog">公开发言日志</button>'
            + '<button type="button" data-act="vote">投票决策回包</button>'
            + '<button type="button" data-act="tally">票型归并</button>'
            + '<button type="button" data-act="statemsg">场上状态消息</button>'
            + '</div>'
            + (this._flash ? '<div class="gp-flash">' + viewText(this._flash) + '</div>' : '')
            + '<div class="gp-out">' + out + '</div>';
    }

    _bind(root) {
        if (this._boundRoot === root) return;
        this._boundRoot = root;
        root.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'dealer') {
                const r = this.app.dealer(DEALER_SAMPLE);
                this._flashText('解析 ' + r.players.length + ' 个玩家；身份词 '
                    + r.wordPair.civilian + ' / ' + r.wordPair.undercover);
            } else if (act === 'ucspeech') {
                const r = this.app.undercoverSpeech('<谁是卧底发言>\n我觉得 3 号像卧底\n</谁是卧底发言>');
                this._flashText('发言内容：' + r.text);
            } else if (act === 'ucvotes') {
                const r = this.app.undercoverVotes(UNDERCOVER_VOTE_SAMPLE);
                this._flashText('切出 ' + r.votes.length + ' 票：'
                    + r.votes.map(v => v.voterSeat + '→' + v.targetSeat).join(' / '));
            } else if (act === 'uclog') {
                const r = this.app.undercoverLog([
                    { round: 1, senderSeat: 1, senderName: '抽象仙人', content: '我先说' },
                    { round: 1, source: 'system', content: '游戏开始' },
                    { round: 2, senderSeat: 2, senderName: '深夜崩溃', content: '过' }
                ]);
                this._flashText('日志 ' + r.lines.length + ' 行，首行「' + r.lines[0] + '」');
            } else if (act === 'match') {
                const r = this.app.match(MATCH_SAMPLE);
                const s = r.sections[0];
                this._flashText(s
                    ? ('收 ' + r.sections.length + ' 段：' + s.seat + '号 ' + s.name + ' / ' + s.gender + ' / ' + s.personality)
                    : '一段都没收全（要 1~8 号且姓名性格齐全）');
            } else if (act === 'speech') {
                const r = this.app.speech(SPEECH_SAMPLE);
                this._flashText('发言：' + r.text);
            } else if (act === 'lastwords') {
                const r = this.app.lastWords('<狼人杀遗言>\n我真是好人，你们会后悔的\n</狼人杀遗言>');
                this._flashText('遗言：' + r.text);
            } else if (act === 'night') {
                const r = this.app.night(NIGHT_SAMPLE, 'witch');
                this._flashText('目标 ' + r.targetSeat + ' 号 / 药剂 ' + (r.usePotion || '无')
                    + ' / 讨论「' + r.discussion + '」');
            } else if (act === 'nightactor') {
                const r = this.app.nightActor('witch');
                this._flashText('夜晚步骤 witch => 角色「' + (r.actor || '空') + '」');
            } else if (act === 'vote') {
                const r = this.app.vote(VOTE_SAMPLE);
                this._flashText('切 ' + r.votes.length + ' 票，出局 ' + r.targetSeat + ' 号（弃票落 0）');
            } else if (act === 'chatlog') {
                const r = this.app.chatLog({
                    players: [{ seat: 1, name: '青岚' }, { seat: 2, name: '夜航' }],
                    chat: [
                        { day: 1, seat: 0, text: '天亮了' },
                        { day: 1, seat: 1, text: '我信 2 号' }
                    ]
                });
                this._flashText('日志 ' + r.lines.length + ' 行：' + r.lines.join(' | '));
            } else if (act === 'tally') {
                const r = this.app.tally([
                    { voterSeat: 1, targetSeat: 4 },
                    { voterSeat: 2, targetSeat: 4 },
                    { voterSeat: 3, targetSeat: 7 }
                ]);
                this._flashText('最高票 → ' + r.targetSeat + ' 号（平票会给 0）');
            } else if (act === 'statemsg') {
                const r = this.app.stateMessage({
                    day: 1,
                    userSeat: 1,
                    roleRevealMode: 'open',
                    players: [{ seat: 1, name: '青岚', status: '存活', isUser: true }]
                });
                this._flashText('消息 ' + r.text.length + ' 字（明牌/暗牌给不同规则句）');
            }
        });
    }
}

export default GamesProtocolView;