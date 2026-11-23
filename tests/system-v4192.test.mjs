// SYS-V4192 phone / games / diagnose 三件的「文本与协议归一面」抽取验收
// 为什么只抽这一面：三件的源都是 600~3800 行的类/模块，里面绝大多数代码在动
//   this.state / win / storage / API 冷却（通话与短信的运行时态、狼人杀对局推进、
//   诊断的 1880 行 collectDiagnose），那是有副作用的编排，不能也不该在
//   「纯函数内核 + 控制器 + 视图 + 样式」四件套纪律下整只搬过来。
//   本件只把「给定一段文本/一个取值 ⇒ 给定一个结论」的归一面抽出来，判据因此只审两件事：
//   抽出来的内核是不是**真的纯**，以及源类是不是**真的转调**（实现不再留在编排面）。
// 实现纪律：本档不用正则，一律 indexOf（生成链会吃反斜杠，与 v4186~v4191 同一条）。
// 口径纪律：断言一律按**实测**写，不按概念写 —— parseWerewolfSpeech 的
//   `^发言` 替换**不带 m 标志**（标签内容首字符是 \n 时剥不掉「发言：」），
//   parseWerewolfVoteDecision 的票型切分按「N->M」紧凑形（提示词给的正是紧凑形），
//   这两条都是源实现的真实行为，判据负责把它钉住而不是把它改漂亮。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const PT = await import('../apps/phone/phone-text-core.js');
const GP = await import('../apps/games/games-protocol-core.js');
const DR = await import('../apps/diagnose/diagnose-reason-core.js');

const PHONE_SRC = 'apps/phone/phone-view.js';
const GAMES_SRC = 'apps/games/games-app.js';
const DIAG_SRC = 'apps/diagnose/diagnose-data.js';

const CORE_FILES = [
    'apps/phone/phone-text-core.js',
    'apps/games/games-protocol-core.js',
    'apps/diagnose/diagnose-reason-core.js'
];

const SIDE_EFFECT_TOKENS = [
    'localStorage', 'sessionStorage', 'window.', 'document.',
    'fetch(', 'new Audio', 'XMLHttpRequest',
    'setInterval', 'setTimeout', 'requestAnimationFrame',
    'storage.set(', 'new Date('
];

/* ══════════ A 组 · 三个内核的纯度 ══════════ */
test('A1 三个内核源码面零副作用、零类', () => {
    for (const f of CORE_FILES) {
        const raw = read(f);
        /* 纪律自述写在注释里（「不取 Date.now / Math.random」），
           故副作用词一律只审**代码面**（去注释行后），注释里说明不算。 */
        const s = raw.split(NL).filter((l) => l.trim().indexOf('*') !== 0 && l.trim().indexOf('//') !== 0 && l.trim().indexOf('/*') !== 0).join(NL);
        assert.equal(s.indexOf('Math.random'), -1, f + ' 不许自己取随机源');
        assert.equal(s.indexOf('Date.now'), -1, f + ' 不许自己读系统时钟');
        for (const bad of SIDE_EFFECT_TOKENS) {
            assert.equal(s.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.equal(s.indexOf('class '), -1, f + ' 内核不许有类');
        /* 只审代码面（去注释行后）不许持实例状态 —— 注释里说明「把 this. 去掉」不算。 */
        const codeOnly = s.split(NL).filter((l) => l.trim().indexOf('*') !== 0 && l.trim().indexOf('//') !== 0 && l.trim().indexOf('/*') !== 0).join(NL);
        assert.equal(codeOnly.indexOf('this.'), -1, f + ' 代码面不许持实例状态');
        /* 内核不许自己去取 import.meta.url（URL 解析由调用方给 base）。 */
        assert.equal(s.indexOf('import.meta.url'), -1, f + ' 内核不许自己取 import.meta.url');
    }
});

test('A2 通话文本归一：清洗 / 兜底 / 短信切分 / 缓存键 / 头像', () => {
    assert.deepEqual(PT.cleanCallAiResponse('', '阿茶'), ['...'], '空回复给 [...]，界面上永远有东西可显示');
    assert.deepEqual(PT.cleanCallAiResponse(null, '阿茶'), ['...'], 'null 与空串同口径');
    assert.deepEqual(
        PT.cleanCallAiResponse('<Call>---阿茶---' + NL + '<Call>在吗？' + NL + '</Phone>' + NL + '在吗？' + NL + '|||</Call>', '阿茶'),
        ['在吗？'],
        '<Call> 优先、姓名行剥除、残留标签剥除、||| 剥除、按行拆并去重'
    );
    assert.deepEqual(PT.cleanCallAiResponse('在吗' + NL + '在吗'), ['在吗'], '重复行去重');
    assert.equal(PT.cleanCallRejectReason('', '阿茶'), '阿茶 暂时不方便接听。', '读不出给对方名兜底句');
    assert.equal(PT.cleanCallRejectReason(''), '对方暂时不方便接听。', '无名时给对方兜底句');
    assert.equal(PT.cleanCallRejectReason('<Call>[拒绝电话]：阿茶：我在开会</Call>', '阿茶'), '我在开会', '剥标签与姓名头');

    const sms = PT.parseSmsAiResponse('<短信>' + NL + '[姓名]' + NL + '内容：晚点回你' + NL + '发送时间：2024年3月5日 21:30' + NL + '</短信>', '阿茶');
    assert.equal(sms.length, 1);
    assert.equal(sms[0].sender, '阿茶', '[姓名] 走 fallbackSender');
    assert.equal(sms[0].text, '晚点回你');
    assert.equal(sms[0].date, '2024年03月05日', '日期补零成 YYYY年MM月DD日');
    assert.equal(sms[0].time, '21:30', '时间补零成 HH:mm');
    assert.deepEqual(PT.parseSmsAiResponse('', '阿茶'), [], '空回包给空数组');
    assert.equal(PT.parseSmsAiResponse('没有标签的一行', '阿茶').length, 0, '缺 [发送方] 或缺内容都不出条目');

    assert.equal(
        PT.buildCallTtsCacheKey({ bubbleId: 'b', caller: 'c', provider: 'p', voice: 'v', text: 't' }),
        'b' + String.fromCharCode(31) + 'c' + String.fromCharCode(31) + 'p' + String.fromCharCode(31) + 'v' + String.fromCharCode(31) + 't',
        '五段用 US 分隔（文本自带空格不会串味）'
    );

    assert.equal(PT.normalizeWechatAvatarPath('👤'), '', '占位符不当成地址');
    assert.equal(PT.normalizeWechatAvatarPath('apps/wechat/avatars/male3.png'), 'avatars/male3.png', '三段前缀从长到短剥');
    assert.equal(PT.normalizeWechatAvatarPath('wechat/avatars/male3.png'), 'avatars/male3.png');
    assert.equal(PT.normalizeWechatAvatarPath('avatars/female12.png'), 'avatars/female12.png');
    assert.equal(PT.normalizeWechatAvatarPath('https://x/a.png'), 'https://x/a.png', '绝对地址原样放行');
    assert.equal(PT.normalizeWechatAvatarPath('/a/b.png'), '/a/b.png', '站根路径原样放行');
    assert.equal(PT.normalizeWechatAvatarPath('data:image/png;base64,AA'), 'data:image/png;base64,AA', 'data URL 原样放行');
    assert.equal(PT.normalizeWechatAvatarPath('blob:xx'), 'blob:xx', 'blob URL 原样放行');
    assert.equal(PT.normalizeWechatAvatarPath('male3'), 'avatars/male3.png', '自动头像命名补 .png');
    assert.equal(PT.normalizeWechatAvatarPath('a b.png'), '', '含空格不放行');
    assert.equal(PT.normalizeWechatAvatarPath('../secret.png'), '', '目录穿越不放行');
    assert.equal(PT.normalizeWechatAvatarPath(''), '', '空串不放行');

    assert.equal(PT.normalizeTtsGender('male'), 'male');
    assert.equal(PT.normalizeTtsGender('M'), 'male');
    assert.equal(PT.normalizeTtsGender('男'), 'male');
    assert.equal(PT.normalizeTtsGender('female'), 'female');
    assert.equal(PT.normalizeTtsGender('F'), 'female');
    assert.equal(PT.normalizeTtsGender('女'), 'female');
    assert.equal(PT.normalizeTtsGender('other'), '', '不猜性别');
    assert.equal(PT.normalizeTtsGender(''), '');
    assert.deepEqual(PT.TTS_GENDERS, ['male', 'female'], '性别表就两档');
    assert.equal(PT.TTS_CACHE_KEY_SEPARATOR, String.fromCharCode(31), '分隔符是 US');
    assert.equal(PT.AVATAR_PLACEHOLDER, String.fromCodePoint(0x1F464), '占位符是人形图标');
});

test('A3 谁是卧底协议解析：发牌 / 发言 / 投票 / 公开展示日志', () => {
    const d = GP.parseUndercoverDealerResult(
        '<玩家生成>' + NL + '玩家昵称：甲' + NL + '性格：嘴硬' + NL + '---' + NL
        + '玩家昵称：乙' + NL + '性格：话少' + NL + '</玩家生成>' + NL
        + '<游戏身份词>' + NL + '普通玩家身份词：A' + NL + '卧底玩家身份词：B' + NL + '</游戏身份词>'
    );
    assert.equal(d.players.length, 2, '按 --- 切段，两段都收');
    assert.equal(d.players[0].name, '甲');
    assert.equal(d.players[0].personality, '嘴硬');
    assert.equal(d.wordPair.civilian, 'A');
    assert.equal(d.wordPair.undercover, 'B');
    assert.equal(GP.parseUndercoverDealerResult('').players.length, 0, '空回包给空列表');

    assert.equal(GP.parseUndercoverSpeech('<谁是卧底发言>' + NL + '我觉得3号像' + NL + '</谁是卧底发言>'), '我觉得3号像');
    assert.equal(GP.parseUndercoverSpeech(''), '');

    const uv = GP.parseUndercoverVotes('<谁是卧底投票>' + NL + '票型：1号 -> 3号，2号 投给 5号，3号 → 3号' + NL + '</谁是卧底投票>');
    assert.equal(uv.length, 3, '三种连接词都认');
    assert.equal(uv[0].voterSeat, 1);
    assert.equal(uv[0].targetSeat, 3);
    assert.equal(uv[2].voterSeat, 3);
    const dup = GP.parseUndercoverVotes('<谁是卧底投票>' + NL + '票型：1->2，1->3' + NL + '</谁是卧底投票>');
    assert.equal(dup.length, 1, '同一投票人去重，只认第一次');
    assert.deepEqual(GP.parseUndercoverVotes(''), []);

    const ul = GP.formatUndercoverPublicLog([
        { round: 1, senderSeat: 1, senderName: '甲', content: '我先说' },
        { round: 1, source: 'system', content: '开始' },
        { round: 2, senderSeat: 2, senderName: '乙', content: '过' }
    ]);
    assert.equal(ul[0], '【第1轮】', '首轮用【第N轮】');
    assert.equal(ul[1], '1号 甲：我先说');
    assert.equal(ul[2], '系统：开始', 'system 走「系统：」前缀');
    assert.equal(ul[3], '----- 第2轮 -----', '换轮用分隔线');
    assert.equal(ul[4], '2号 乙：过');
    assert.deepEqual(GP.formatUndercoverPublicLog([]), [], '空日志给空数组');
});

test('A4 狼人杀协议解析：匹配 / 发言 / 遗言 / 夜晚 / 投票', () => {
    const m = GP.parseWerewolfMatch('【 1 号 】' + NL + '姓名：青岚' + NL + '性别：女' + NL + '性格及语言风格：冷静');
    assert.equal(m.length, 1);
    assert.equal(m[0].seat, 1);
    assert.equal(m[0].name, '青岚');
    assert.equal(m[0].gender, '女');
    assert.equal(m[0].personality, '冷静');
    /* 只收 1~8 号且三样齐全的。 */
    assert.equal(GP.parseWerewolfMatch('【 9 号 】' + NL + '姓名：X' + NL + '性别：男' + NL + '性格及语言风格：Y').length, 0, '9 号不收');
    assert.equal(GP.parseWerewolfMatch('【 1 号 】' + NL + '姓名：X' + NL + '性别：男').length, 0, '缺性格不收');

    /* ★ 真实口径：`^发言` 替换不带 m 标志，标签内容取出后首字符是 \n，故剥不掉。 */
    assert.equal(GP.parseWerewolfSpeech('<狼人杀发言>' + NL + '发言：我是好人' + NL + '</狼人杀发言>'), '发言：我是好人', '标签内容带前导 \\n 时剥不掉「发言：」（源实现逐字一致）');
    assert.equal(GP.parseWerewolfSpeech('发言：我是好人'), '我是好人', '裸输入能剥');
    assert.equal(GP.parseWerewolfSpeech('<狼人杀发言>我是好人</狼人杀发言>'), '我是好人', '无「发言：」前缀时原样');
    assert.equal(GP.parseWerewolfSpeech(''), '');

    assert.equal(GP.parseWerewolfLastWords('<狼人杀遗言>' + NL + '我会后悔的' + NL + '</狼人杀遗言>'), '我会后悔的');
    assert.equal(GP.parseWerewolfLastWords(''), '');

    const nd = GP.parseWerewolfNightDecision(
        '<狼人杀夜晚行动>' + NL + '目标：4号' + NL + '药剂：解药' + NL + '讨论：先出4' + NL + '理由：票型怪' + NL + '</狼人杀夜晚行动>',
        'witch'
    );
    assert.equal(nd.targetSeat, 4, '目标走数字抽取');
    assert.equal(nd.usePotion, 'antidote', '女巫步解药归一成 antidote');
    assert.equal(nd.discussion, '先出4');
    assert.equal(nd.reason, '票型怪');
    const ndSeer = GP.parseWerewolfNightDecision('<狼人杀夜晚行动>' + NL + '目标：4号' + NL + '药剂：解药' + NL + '</狼人杀夜晚行动>', 'seer');
    assert.equal(ndSeer.usePotion, '', '非女巫步一律不认药剂');

    assert.equal(GP.normalizeWerewolfPotion('解药', 'witch'), 'antidote');
    assert.equal(GP.normalizeWerewolfPotion('救', 'witch'), 'antidote');
    assert.equal(GP.normalizeWerewolfPotion('antidote', 'witch'), 'antidote');
    assert.equal(GP.normalizeWerewolfPotion('毒药', 'witch'), 'poison');
    assert.equal(GP.normalizeWerewolfPotion('毒', 'witch'), 'poison');
    assert.equal(GP.normalizeWerewolfPotion('poison', 'witch'), 'poison');
    assert.equal(GP.normalizeWerewolfPotion('毒药', 'seer'), '', '非 witch 步一律空串');
    assert.equal(GP.normalizeWerewolfPotion('', 'witch'), '');
    assert.equal(GP.werewolfNightActors('guard'), '守卫');
    assert.equal(GP.werewolfNightActors('werewolf'), '狼人');
    assert.equal(GP.werewolfNightActors('seer'), '预言家');
    assert.equal(GP.werewolfNightActors('witch'), '女巫');
    assert.equal(GP.werewolfNightActors('zzz'), '', '认不出给空串');

    /* ★ 真实口径：票型切分按紧凑形（提示词给的正是 `2->3，3->0，4->3`）。 */
    const vd = GP.parseWerewolfVoteDecision(
        '<狼人杀投票>' + NL + '票型：1->4，2->7，3->0' + NL + '出局：4号' + NL + '理由：矛盾' + NL + '</狼人杀投票>'
    );
    assert.equal(vd.votes.length, 3, '紧凑形三票全切出');
    assert.equal(vd.votes[0].voterSeat, 1);
    assert.equal(vd.votes[0].targetSeat, 4);
    assert.equal(vd.votes[2].targetSeat, 0, '弃票落 0');
    assert.equal(vd.targetSeat, 4);
    assert.equal(vd.reason, '矛盾');
    assert.deepEqual(GP.parseWerewolfVoteDecision('').votes, [], '空回包给空票型');
});

test('A5 狼人杀协议解析：票型归并 / 兜底 / 日志 / 消息 / 补位 / 归档', () => {
    assert.equal(GP.resolveWerewolfVoteTarget([{ targetSeat: 4 }, { targetSeat: 4 }, { targetSeat: 7 }]), 4, '最高票唯一才放逐');
    assert.equal(GP.resolveWerewolfVoteTarget([{ targetSeat: 4 }, { targetSeat: 7 }]), 0, '平票一律 0，不硬挑一个');
    assert.equal(GP.resolveWerewolfVoteTarget([{ targetSeat: 4 }, { targetSeat: 4 }]), 4);
    assert.equal(GP.resolveWerewolfVoteTarget([]), 0, '无票给 0');
    assert.equal(GP.resolveWerewolfVoteTarget([{ targetSeat: 0 }, { targetSeat: 0 }]), 0, '全弃票给 0');

    assert.equal(GP.fallbackWerewolfVoteTarget([{ seat: 1 }, { seat: 2 }], { targetSeat: 2 }), 2, '用户投的目标还在桌上就照投');
    assert.equal(GP.fallbackWerewolfVoteTarget([{ seat: 1 }, { seat: 2 }], null), 2, '无用户票放逐最高号');
    assert.equal(GP.fallbackWerewolfVoteTarget([{ seat: 1 }, { seat: 2 }], { targetSeat: 9 }), 2, '用户票的目标已不在桌上，回落最高号');
    assert.equal(GP.fallbackWerewolfVoteTarget([], null), 0, '桌上无人给 0');
    assert.equal(GP.fallbackWerewolfVoteTarget([{ seat: 1, empty: true }, { seat: 2 }], null), 2, '空位不算桌上');

    const cl = GP.formatWerewolfPublicChatLog({
        players: [{ seat: 1, name: '青岚' }, { seat: 2, name: '夜航' }],
        chat: [{ day: 1, seat: 0, text: '天亮了' }, { day: 1, seat: 1, text: '我信2号' }]
    });
    assert.equal(cl[0], '第1天 系统：天亮了', 'seat 0 走系统前缀');
    assert.equal(cl[1], '第1天 1号 青岚：我信2号', '有名字拼「N号 名字：」');
    assert.deepEqual(GP.formatWerewolfPublicChatLog({}), [], '空场给空日志');

    const vh = GP.formatWerewolfVoteHistory({ voteHistory: [{ day: 1, text: '4号出局' }] });
    assert.equal(vh[0], '第1天 4号出局', '优先 voteHistory');
    const vh2 = GP.formatWerewolfVoteHistory({
        replayLog: [
            { type: 'vote', visibility: 'public', day: 2, text: '7号出局' },
            { type: 'vote', visibility: 'private', day: 2, text: '看不见' },
            { type: 'speech', visibility: 'public', day: 2, text: '不是票' }
        ]
    });
    assert.deepEqual(vh2, ['第2天 7号出局'], '无 voteHistory 时从 replayLog 滤公开投票');
    assert.deepEqual(GP.formatWerewolfVoteHistory({}), [], '两处都没有给空数组');
    assert.deepEqual(GP.formatWerewolfVoteHistory({ voteHistory: [{ day: 1, text: '   ' }] }), [], '空文本行丢');

    const sm = GP.formatWerewolfPublicStateMessage({ day: 1, userSeat: 1, roleRevealMode: 'hidden', players: [] });
    assert.notEqual(sm.indexOf('暗牌模式'), -1, '暗牌给暗牌规则句');
    assert.notEqual(GP.formatWerewolfPublicStateMessage({ day: 1, userSeat: 1, roleRevealMode: 'open', players: [] }).indexOf('明牌模式'), -1, '明牌给明牌规则句');

    const st = GP.formatWerewolfSpeechTaskMessage({
        speaker: { seat: 1, name: '青岚' },
        speakerPrivateRole: '狼人',
        players: [{ seat: 1, name: '青岚', role: '狼人', alive: true }, { seat: 2, name: '夜航', role: '狼人', alive: true }]
    });
    assert.notEqual(st.indexOf('狼人同伴：1号 青岚、2号 夜航'), -1, '同伴名单按座位升序拼');

    /* 首日白天多一句「禁止凭空声称查杀/金水/刀口」（day===1 即首日，不需要 isFirstDay 标志）。 */
    const firstDay = GP.formatWerewolfPublicLogMessage({ day: 1, publicLog: ['第1天 1号 甲：过'] });
    assert.notEqual(firstDay.indexOf('首日白天'), -1, '首日给禁言句');
    assert.notEqual(firstDay.indexOf('- 第1天 1号 甲：过'), -1, '公开日志按行铺开');
    const laterDay = GP.formatWerewolfPublicLogMessage({ day: 3, publicLog: [] });
    assert.equal(laterDay.indexOf('首日白天'), -1, '非首日不给禁言句');
    assert.notEqual(laterDay.indexOf('- 暂无'), -1, '无公开日志给占位');

    const fp = GP.buildWerewolfFallbackPlayers([3, 4], [{ seat: 3, name: '已有' }]);
    assert.equal(fp.length, 2, '两个空位都补');
    assert.equal(fp[0].name, '已有', '已生成的照用');
    assert.equal(fp[1].id, 'ai_4', '没生成的按 ai_<seat> 造');
    assert.deepEqual(GP.buildWerewolfFallbackPlayers([], []), [], '无空位给空');

    /* 归档按「第 N 天公开记录」出消息：发言从 chat 归集、投票从 voteHistory/replayLog 归集，
       且 1..currentDay 每天都出一条（没内容的那天给「暂无」占位）。 */
    const rec = GP.buildWerewolfPublicRecordMessages({
        day: 2,
        players: [{ seat: 1, name: '青岚' }],
        chat: [{ day: 1, seat: 1, text: '我信2号' }, { day: 2, seat: 0, text: '天亮了' }],
        voteHistory: [{ day: 2, text: '4号出局' }]
    });
    assert.equal(rec.length, 2, '1~currentDay 每天一条');
    assert.notEqual(rec[1].content.indexOf('【第 2 天公开记录】'), -1, '归档消息带天序标题');
    assert.notEqual(rec[1].content.indexOf('4号出局'), -1, '归档带当天投票结果');
    assert.notEqual(rec[0].content.indexOf('1号 青岚：我信2号'), -1, '发言按天归集');
    assert.notEqual(rec[1].content.indexOf('系统：天亮了'), -1, 'seat 0 归到系统公告');
    const emptyRec = GP.buildWerewolfPublicRecordMessages({ day: 1 });
    assert.equal(emptyRec.length, 1, '当天无内容也出一条（占位，不出空档）');
    assert.notEqual(emptyRec[0].content.indexOf('- 暂无'), -1, '无内容给暂无占位');
    /* day 缺省按 1 天算，故 {} 也会出一条占位（口径：不因为没内容就跳过某天）。 */
    assert.equal(GP.buildWerewolfPublicRecordMessages({}).length, 1, 'day 缺省按 1 天算');
});

/* ══════════ A' 组 · 诊断归因内核 ══════════ */
test('A6 诊断归因五表六函数：键形冻结、未知取值不静默兜底', () => {
    assert.equal(DR.fieldReasonText('value'), '有值');
    assert.equal(DR.fieldReasonText('declared-null'), DR.FIELD_REASON_TEXT['declared-null'], '带连字符字面量键形冻结');
    assert.equal(DR.fieldReasonText('absent'), DR.FIELD_REASON_TEXT['absent'], 'absent 键形冻结');
    assert.equal(DR.fieldReasonText('zzz-unknown'), 'zzz-unknown', '未命中如实输出原值，不兜底');
    assert.equal(DR.fieldReasonText(''), '未知', '空串给未知');
    assert.equal(DR.fieldReasonText(null), '未知', 'null 给未知');
    assert.equal(DR.fieldReasonText(undefined), '未知', 'undefined 给未知');

    assert.equal(DR.bridgeReasonText('engine-empty'), '引擎在位但返回空');
    assert.equal(DR.bridgeReasonText('zzz'), 'zzz', '未命中如实输出');

    assert.notEqual(DR.projAbsentText('no-provider').indexOf('压根没接'), -1, '投影缺席按 no-provider 分档');
    assert.equal(DR.projAbsentText('zzz'), 'zzz');

    assert.equal(DR.sourceStateText('engine-absent'), '记忆引擎未就位（桥在，引擎不在）');
    assert.equal(DR.sourceStateText('zzz'), 'zzz');

    assert.equal(DR.schemaStateText('current'), '当前代');
    assert.equal(DR.schemaStateText('legacy'), '旧档（本方法只上报，不做迁移）');
    assert.equal(DR.schemaStateText('zzz'), 'zzz', '未命中如实输出原值');
    assert.equal(DR.SCHEMA_STATES.current, '当前代', '表与函数同口径');

    assert.equal(DR.storageFaceLine({ ok: false, reason: 'x' }), '存档健康：读不到（x）', '读不出给理由');
    assert.equal(
        DR.storageFaceLine({
            ok: true,
            chat: { ok: true, schema: { state: 'current' }, ledger: { count: 3 } },
            global: { ok: false }
        }),
        '本会话档：当前代 · 已搬 3 条键 ／ 全局档：读不到',
        '本会话档与全局档分列，一边读不出不说成两边都读不出'
    );
    assert.notEqual(DR.storageFaceLine({ ok: true, chat: { ok: true, schema: { state: 'legacy' }, ledger: { count: 0 } }, global: { ok: true } }).indexOf('旧档'), -1, '旧档也走同一行');
});

/* ══════════ B 组 · 源类真的转调了 ══════════ */
test('B1 phone-view.js 六个方法体已转调内核', () => {
    const s = read(PHONE_SRC);
    const calls = [
        '_ptcCleanCallAiResponse(', '_ptcCleanCallRejectReason(', '_ptcParseSmsAiResponse(',
        '_ptcBuildCallTtsCacheKey(', '_ptcNormalizeWechatAvatarPath(', '_ptcNormalizeTtsGender('
    ];
    for (const c of calls) {
        assert.notEqual(s.indexOf(c), -1, PHONE_SRC + ' 必须转调 ' + c);
        assert.notEqual(s.indexOf(NL + '        return ' + c), -1, PHONE_SRC + ' 的 ' + c + ' 必须是方法体一行转调');
    }
    /* _normalizeWechatAvatarPath 保留 import.meta.url 作第二参（内核不自己取 URL）。 */
    assert.notEqual(s.indexOf('return _ptcNormalizeWechatAvatarPath(value, import.meta.url);'), -1, '头像归一的 baseUrl 由视图给');
    /* 旧实现标志必须消失。 */
    assert.equal(s.indexOf("const callMatch = cleaned.match(/<Call>([\\s\\S]*?)<\\/Call>/i);"), -1, '通话清洗实现不许再留在源类');
    assert.equal(s.indexOf("if (raw === 'male' || raw === 'm' || raw === '男') return 'male';"), -1, 'TTS 性别归一不许再留在源类');
});

test('B2 games-app.js 二十一个方法体已转调内核', () => {
    const s = read(GAMES_SRC);
    const calls = [
        '_gpFormatUndercoverPublicLog(', '_gpParseUndercoverDealerResult(', '_gpParseUndercoverSpeech(',
        '_gpParseUndercoverVotes(', '_gpParseWerewolfNightDecision(', '_gpExtractNightField(',
        '_gpParseWerewolfVoteDecision(', '_gpResolveWerewolfVoteTarget(', '_gpFormatWerewolfPublicChatLog(',
        '_gpBuildWerewolfPublicRecordMessages(', '_gpFormatWerewolfVoteHistory(', '_gpFallbackWerewolfVoteTarget(',
        '_gpParseWerewolfLastWords(', '_gpFormatWerewolfPublicStateMessage(', '_gpFormatWerewolfPublicLogMessage(',
        '_gpFormatWerewolfSpeechTaskMessage(', '_gpParseWerewolfSpeech(', '_gpBuildWerewolfFallbackPlayers(',
        '_gpParseWerewolfMatch(', '_gpExtractLabeledField(', '_gpNormalizeWerewolfPotion('
    ];
    assert.equal(calls.length, 21, '本版转调面就是 21 个方法');
    for (const c of calls) {
        assert.notEqual(s.indexOf(c), -1, GAMES_SRC + ' 必须转调 ' + c);
        assert.notEqual(s.indexOf(NL + '        return ' + c), -1, GAMES_SRC + ' 的 ' + c + ' 必须是方法体一行转调');
    }
    /* _fallbackWerewolfVoteTarget / _formatWerewolfSpeechTaskMessage 保留一行取数后转调。 */
    assert.notEqual(s.indexOf('return _gpFallbackWerewolfVoteTarget(state?.players || [], userVote);'), -1, '兜底投票先取桌上玩家');
    assert.notEqual(s.indexOf('return _gpFormatWerewolfSpeechTaskMessage({ ...context, players: state?.players || [] });'), -1, '发言任务消息补玩家表');
    /* 旧实现标志必须消失。 */
    assert.equal(s.indexOf("const counts = new Map();"), -1, '票型归并不许再留在源类');
    assert.equal(s.indexOf("if (/解药|救|antidote/i.test(value)) return 'antidote';"), -1, '药剂归一不许再留在源类');
    /* import 段用别名（_gp 前缀）引入内核函数。 */
    assert.notEqual(s.indexOf('parseWerewolfVoteDecision as _gpParseWerewolfVoteDecision'), -1, '必须用别名引入内核函数');
    assert.notEqual(s.indexOf("} from './games-protocol-core.js';"), -1, '必须从同目录内核引入');
});

test('B3 diagnose-data.js 六函数五表改为 import + 再导出，实现不再留在本文件', () => {
    const s = read(DIAG_SRC);
    assert.notEqual(s.indexOf('fieldReasonText, bridgeReasonText, projAbsentText,'), -1, 'import 段必须点到六函数');
    /* 再导出块必须同时覆盖六函数与五张表（既有 import 面零影响）。
       定位方式：从「内核 import 段之后」找第一个 `export { ... } from './diagnose-reason-core.js'`，
       不拿全文第一个 export { 充数（那个是 R24-O5 的媒体缓存再导出，同名不同物）。 */
    /* 再导出块的定位锚：`FIELD_REASON_TEXT, BRIDGE_REASON_TEXT,` 这一行只可能出现在
       归因再导出块里（import 段不点表名，别处的 export { 也不点这两张表）。 */
    const tableAnchor = s.indexOf('FIELD_REASON_TEXT, BRIDGE_REASON_TEXT,');
    assert.notEqual(tableAnchor, -1, '再导出块必须点到五张表');
    const blockStart = s.lastIndexOf('export {', tableAnchor);
    assert.notEqual(blockStart, -1, '再导出块必须保留');
    const blockEnd = s.indexOf('} from', blockStart);
    assert.notEqual(blockEnd, -1, '再导出块必须指回内核');
    assert.notEqual(s.slice(blockEnd, blockEnd + 60).indexOf('./diagnose-reason-core.js'), -1, '再导出必须指回 diagnose-reason-core.js');
    const block = s.slice(blockStart, blockEnd);
    for (const name of ['FIELD_REASON_TEXT', 'BRIDGE_REASON_TEXT', 'PROJ_ABSENT_TEXT', 'SOURCE_STATE_TEXT', 'SCHEMA_STATES']) {
        assert.notEqual(block.indexOf(name), -1, '再导出块必须覆盖表 ' + name);
    }
    for (const name of ['fieldReasonText', 'bridgeReasonText', 'projAbsentText', 'sourceStateText', 'schemaStateText', 'storageFaceLine']) {
        assert.notEqual(block.indexOf(name), -1, '再导出块必须覆盖函数 ' + name);
    }
    /* 旧实现标志必须消失。 */
    assert.equal(s.indexOf('const FIELD_REASON_TEXT = {'), -1, '字段归因表不许再留在源文件');
    assert.equal(s.indexOf('const SCHEMA_STATES = {'), -1, 'schema 表不许再留在源文件');
    assert.equal(s.indexOf('function storageFaceLine('), -1, '存档健康行不许再留在源文件');
    /* 关键口径（未知取值如实输出）必须留在内核而不是被兜底改掉。 */
    const core = read('apps/diagnose/diagnose-reason-core.js');
    assert.notEqual(core.indexOf('String(key)'), -1, '内核必须对未命中键如实输出原值');
});

/* ══════════ C 组 · 三个控制器 ══════════ */
test('C1 三个控制器：试算口全部走 _record 与 writeReceipt', () => {
    const specs = [
        { file: 'apps/phone/phone-text-app.js', cls: 'PhoneTextApp', key: 'phone_text_v1', ports: ['call(', 'reject(', 'sms(', 'cacheKey(', 'avatar(', 'ttsGender(', 'constants('] },
        { file: 'apps/games/games-protocol-app.js', cls: 'GamesProtocolApp', key: 'games_protocol_v1', ports: ['dealer(', 'undercoverSpeech(', 'undercoverVotes(', 'undercoverLog(', 'match(', 'speech(', 'lastWords(', 'night(', 'nightActor(', 'vote(', 'chatLog(', 'voteHistory(', 'records(', 'tally(', 'voteFallback(', 'stateMessage(', 'logMessage(', 'speechTask(', 'fallbackPlayers('] },
        { file: 'apps/diagnose/diagnose-reason-app.js', cls: 'DiagnoseReasonApp', key: 'diagnose_reason_v1', ports: ['field(', 'bridge(', 'proj(', 'source(', 'schema(', 'storage('] }
    ];
    for (const spec of specs) {
        const s = read(spec.file);
        assert.notEqual(s.indexOf('export class ' + spec.cls), -1, spec.file + ' 必须导出 ' + spec.cls);
        assert.notEqual(s.indexOf("import { writeReceipt } from '../../config/write-receipt.js';"), -1, spec.file + ' 落盘只走 writeReceipt');
        assert.equal(s.indexOf('storage.set('), -1, spec.file + ' 不许直写存储');
        assert.notEqual(s.indexOf('this._record('), -1, spec.file + ' 试算必须留快照');
        assert.notEqual(s.indexOf('this._saveSnapshot()'), -1, spec.file + ' 快照必须落盘');
        assert.notEqual(s.indexOf("'" + spec.key + "'"), -1, spec.file + ' 必须真用会话键 ' + spec.key);
        for (const p of spec.ports) {
            assert.notEqual(s.indexOf(p), -1, spec.file + ' 必须提供试算口 ' + p);
        }
        /* 控制器只做编排，不许自己造随机 / 自己读时钟 / 碰 DOM。 */
        assert.equal(s.indexOf('Date.now'), -1, spec.file + ' 不许自己读时钟');
        assert.equal(s.indexOf('Math.random'), -1, spec.file + ' 不许自己取随机');
        assert.equal(s.indexOf('document.'), -1, spec.file + ' 不许碰 DOM');
    }
});

/* ══════════ D 组 · 三个视图与样式 ══════════ */
test('D1 三个视图：_boundRoot 去重 + data-act 委派 + CSS 自注入', () => {
    const specs = [
        { file: 'apps/phone/phone-text-view.js', css: 'apps/phone/phone-text.css', root: '.pt-root', cssId: 'phone-text-css', acts: ['call', 'reject', 'sms', 'cachekey', 'avatar', 'ttsgender', 'constants'] },
        { file: 'apps/games/games-protocol-view.js', css: 'apps/games/games-protocol.css', root: '.gp-root', cssId: 'games-protocol-css', acts: ['dealer', 'ucspeech', 'ucvotes', 'uclog', 'match', 'speech', 'lastwords', 'night', 'nightactor', 'vote', 'chatlog', 'tally', 'statemsg'] },
        { file: 'apps/diagnose/diagnose-reason-view.js', css: 'apps/diagnose/diagnose-reason.css', root: '.dr-root', cssId: 'diagnose-reason-css', acts: ['field', 'bridge', 'proj', 'source', 'schema', 'storage', 'unknown'] }
    ];
    for (const spec of specs) {
        const s = read(spec.file);
        assert.notEqual(s.indexOf('this._boundRoot === root'), -1, spec.file + ' 必须按 root 去重绑定');
        assert.notEqual(s.indexOf('[data-act]'), -1, spec.file + ' 必须用 data-act 委派');
        assert.equal(s.indexOf("addEventListener('input'"), -1, spec.file + ' 视图不许监听 input');
        for (const act of spec.acts) {
            assert.notEqual(s.indexOf('data-act="' + act + '"'), -1, spec.file + ' 必须提供 ' + act + ' 试算按钮');
        }
        const css = read(spec.css);
        assert.notEqual(css.indexOf(spec.root), -1, spec.css + ' 必须挂自己的根类');
        /* 选择器面不许碰外壳（注释里提到不算，只看非注释行）。 */
        const cssRules = css.split(NL).filter((l) => l.trim() && l.trim().indexOf('/*') !== 0 && l.trim().indexOf('*') !== 0 && l.trim().indexOf('//') !== 0).join(NL);
        assert.equal(cssRules.indexOf('.phone-screen'), -1, spec.css + ' 选择器不许碰外壳');
    }
});

/* ══════════ E 组 · 五处接线 ══════════ */
test('E1 三个新 App 的五处接线全部在场', () => {
    const apps = read('config/apps.js');
    assert.notEqual(apps.indexOf("id: 'phonetext'"), -1, 'apps.js 必须登记 phonetext');
    assert.notEqual(apps.indexOf('defaultIcon: DEFAULT_APP_ICONS.phone'), -1, '图标须落到 phone 家族');
    assert.notEqual(apps.indexOf("id: 'gamesprotocol'"), -1, 'apps.js 必须登记 gamesprotocol');
    assert.notEqual(apps.indexOf('defaultIcon: DEFAULT_APP_ICONS.games'), -1, '图标须落到 games 家族');
    assert.notEqual(apps.indexOf("id: 'diagnosereason'"), -1, 'apps.js 必须登记 diagnosereason');
    assert.notEqual(apps.indexOf('defaultIcon: DEFAULT_APP_ICONS.diagnose'), -1, '图标须落到 diagnose 家族');

    const routes = read('config/app-lazy-routes.js');
    for (const [id, module, key, cls] of [
        ['phonetext', './apps/phone/phone-text-app.js', 'phoneTextApp', 'PhoneTextApp'],
        ['gamesprotocol', './apps/games/games-protocol-app.js', 'gamesProtocolApp', 'GamesProtocolApp'],
        ['diagnosereason', './apps/diagnose/diagnose-reason-app.js', 'diagnoseReasonApp', 'DiagnoseReasonApp']
    ]) {
        assert.notEqual(routes.indexOf('id: "' + id + '"'), -1, '懒路由必须登记 ' + id);
        assert.notEqual(routes.indexOf('module: "' + module + '"'), -1, '懒路由模块路径须指向 ' + module);
        assert.notEqual(routes.indexOf('key: "' + key + '"'), -1, '懒路由须给单例键 ' + key);
        assert.notEqual(routes.indexOf('cls: "' + cls + '"'), -1, '懒路由须给类名 ' + cls);
    }

    const storage = read('config/storage.js');
    for (const prefix of ['/^phone_text_/', '/^games_protocol_/', '/^diagnose_reason_/']) {
        assert.notEqual(storage.indexOf(prefix), -1, '会话前缀必须命中 CHAT_DATA_PATTERNS: ' + prefix);
    }

    const keys = read('scripts/keys-audit.mjs');
    for (const k of ['phone_text_v1', 'games_protocol_v1', 'diagnose_reason_v1']) {
        const at = keys.indexOf("key: '" + k + "'");
        assert.notEqual(at, -1, '新键必须登记: ' + k);
        assert.notEqual(keys.slice(at, at + 300).indexOf("scope: 'chat'"), -1, k + ' 登记必须是 chat 作用域');
    }

    const index = read('index.js');
    for (const k of ['phoneTextApp', 'gamesProtocolApp', 'diagnoseReasonApp']) {
        assert.notEqual(index.indexOf("'" + k + "'"), -1, '有 destroy 出口必须进重绑表: ' + k);
    }
});

test('E2 三个会话键真的被各自控制器使用（登记了不许是死键）', () => {
    const specs = [
        { app: 'apps/phone/phone-text-app.js', key: 'phone_text_v1' },
        { app: 'apps/games/games-protocol-app.js', key: 'games_protocol_v1' },
        { app: 'apps/diagnose/diagnose-reason-app.js', key: 'diagnose_reason_v1' }
    ];
    for (const spec of specs) {
        const s = read(spec.app);
        assert.notEqual(s.indexOf("'" + spec.key + "'"), -1, spec.app + ' 必须真用 ' + spec.key);
    }
});

/* ══════════ V 组 · 版本锚 ══════════ */
test('V1 五源版本号抬到 4.192.0', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, '4.192.0', 'package.json 须为 4.192.0');
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.version, '4.192.0', 'manifest.json 须为 4.192.0');
    const log = JSON.parse(read('update-log.json'));
    assert.equal(log.latest, '4.192.0', 'update-log latest 须为 4.192.0');
    assert.equal(log.head, '4.192.0', 'update-log head 须为 4.192.0');
    assert.ok(log.versions && log.versions['4.192.0'], 'update-log 必须有 4.192.0 条目');
    const entry = log.versions['4.192.0'];
    assert.equal(entry.version, '4.192.0');
    assert.ok(Array.isArray(entry.items) && entry.items.length >= 5, '4.192.0 条目至少 5 条');
    const joined = entry.items.join(' ');
    for (const token of ['phone-text-core.js', 'games-protocol-core.js', 'diagnose-reason-core.js']) {
        assert.notEqual(joined.indexOf(token), -1, '4.192.0 条目须提到 ' + token);
    }
    const idx = read('index.js');
    assert.notEqual(idx.indexOf("ST_PHONE_VERSION = '4.192.0'"), -1, 'index.js 版本真值须为 4.192.0');
    assert.notEqual(idx.indexOf('phone-text-core.js'), -1, 'index.js 更新公告须提到新内核');
});
