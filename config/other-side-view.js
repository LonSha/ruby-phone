/* config/other-side-view.js — [R13-X9] 「别人的手机：借来看一眼」投影内核（纯函数，零写面）
 * 诚实边界：只投影「与你相关的那一屏」。他给你起的备注全仓无真源（contact.remark 是玩家
 * 给联系人设的备注，方向相反）→ 恒报 absent；他与别人的会话、他的 unread/blocked 均不投影。
 */
export const OTHER_SIDE_STATES = { READY: 'ready', NO_CONTACT: 'no-contact', NO_SOURCE: 'no-source' };
export const OTHER_SIDE_ORIGINS = {
  OTHER: 'other-side',      // 真源：他手机上的真实读数
  SELF: 'self-identity',    // 真源：你自己的微信身份（getUserInfo）
  ABSENT: 'absent',         // 全仓无真源，恒缺席
  NOT_OTHER: 'not-other-side' // 读数方向不成立（属「你」的读数），单列 withheld
};
export const OTHER_SIDE_REASONS = {
  NO_CONTACT: 'no-contact-selected', NO_WECHAT: 'wechat-source-missing',
  NO_MSG: 'no-messages', REMARK: 'remark-has-no-source', USER: 'user-info-missing'
};
const REASON_TEXT = {
  'no-contact-selected': '未选择联系人，无投影内容。',
  'wechat-source-missing': '微信数据源不可用，无法投影。',
  'no-messages': '他的手机上，你与他的对话是空的。',
  'remark-has-no-source': '他给你起的备注名，任何数据源都没有记录——造了就是假的。',
  'user-info-missing': '你自己的微信身份不可用，无法确定气泡方向。'
};

const sideOf = (from, selfName) => {
  if (!from || from === 'system') return '';
  if (from === 'me' || from === selfName) return 'left';   // 在他那边，你是「对方」
  return 'right';                                           // 具名发言人是他自己
};
const clip = (s, n) => (s ? String(s).slice(0, n) : '');

export function projectOtherSide({ source, contactName, chatId = '', messageLimit = 8 } = {}) {
  const input = { contactName: clip(contactName, 40), chatId: clip(chatId, 80), messageLimit };
  const st = OTHER_SIDE_STATES, rg = OTHER_SIDE_REASONS, og = OTHER_SIDE_ORIGINS;
  const out = {
    state: st.READY, reason: '', reasonText: '', contactName: clip(contactName, 40),
    chatId: clip(chatId, 80), self: '', selfName: '', selfAvatar: '',
    theirRemarkOfYou: { origin: og.ABSENT, value: null, reason: rg.REMARK, reasonText: REASON_TEXT[rg.REMARK] },
    conversation: [], bubbles: [], withheld: [], writesNothing: true
  };
  if (!contactName || !String(contactName).trim()) {
    out.state = st.NO_CONTACT; out.reason = rg.NO_CONTACT; out.reasonText = REASON_TEXT[rg.NO_CONTACT];
    out.input = input; return out;
  }
  if (!source || typeof source !== 'object') {
    out.state = st.NO_SOURCE; out.reason = rg.NO_WECHAT; out.reasonText = REASON_TEXT[rg.NO_WECHAT];
    out.input = input; return out;
  }
  const gi = typeof source.getUserInfo === 'function' ? source.getUserInfo() : null;
  if (gi && typeof gi === 'object') {
    out.selfName = clip(gi.name, 40) || '我';
    out.selfAvatar = clip(gi.avatar, 300) || '';
  }
  const getMsgs = typeof source.getMessages === 'function' ? source.getMessages : null;
  const directMsgs = source.data && source.data.messages && Array.isArray(source.data.messages[chatId])
    ? source.data.messages[chatId] : (source.messages && Array.isArray(source.messages[chatId]) ? source.messages[chatId] : null);
  const raw = directMsgs || (getMsgs && chatId ? getMsgs(chatId) : null);
  if (!raw || !Array.isArray(raw)) {
    out.state = st.NO_SOURCE; out.reason = rg.NO_WECHAT; out.reasonText = REASON_TEXT[rg.NO_WECHAT];
    out.input = input; return out;
  }
  if (raw.length === 0) {
    out.state = st.NO_SOURCE; out.reason = rg.NO_MSG; out.reasonText = REASON_TEXT[rg.NO_MSG];
    out.input = input; out.self = out.selfName; return out;
  }
  out.self = out.selfName;
  const msgs = raw.slice(-messageLimit);
  /* 真实字段（侦察确认）：from / content / time / date / type。非文本消息不造正文，
   * 按 type 如实标注占位（[图片] / [语音] …）；未知 type 标 [非文本消息]。 */
  const KIND = { image: '[图片]', voice: '[语音]', video: '[视频]', file: '[文件]', redpacket: '[红包]', transfer: '[转账]', sticker: '[表情]', card: '[名片]', location: '[位置]', system: '' };
  out.conversation = msgs.map((m) => {
    const type = clip(m.type || 'text', 20);
    const rawBody = clip(m.content !== undefined && m.content !== null ? m.content : (m.text || ''), 200);
    const body = rawBody || (type === 'text' ? '' : (KIND[type] !== undefined ? KIND[type] : '[非文本消息]'));
    return { from: clip(m.from, 60), text: body, at: clip(m.time || m.at || '', 40), date: clip(m.date || '', 40), type };
  });
  out.bubbles = out.conversation.map(m => { const s = sideOf(m.from, out.selfName); return { side: s, text: m.text, at: m.at, unplaced: s === '' }; });
  // 方向不成立、单列 withheld（不反转、不顶替）：
  out.withheld = [
    { field: 'unread', origin: og.NOT_OTHER, note: 'chat.unread 是「你」的未读数，在他的手机上无此读数' },
    { field: 'blocked', origin: og.NOT_OTHER, note: 'contact.blocked 是「你」的拉黑标记，不构成他的手机内容' },
    { field: 'otherConversations', origin: og.ABSENT, note: '他与别人的会话：无真源，造了就是假的' }
  ];
  out.input = input;
  return out;
}

export function otherSideSelfCheck() {
  const st = OTHER_SIDE_STATES, rg = OTHER_SIDE_REASONS, og = OTHER_SIDE_ORIGINS;
  const issues = [];
  const add = (issue) => { issues[issues.length] = issue; };
  if (Object.keys(st).length !== 3) add('三整页态不齐');
  if (Object.keys(og).length !== 4) add('四来源归属不齐');
  const p = projectOtherSide({ source: null, contactName: '' });
  if (p.state !== st.NO_CONTACT || p.theirRemarkOfYou.origin !== og.ABSENT) add('空输入态异常');
  const p2 = projectOtherSide({ source: { getUserInfo: () => ({ name: '林晚', avatar: 'a.png' }), getMessages: () => [{ from: 'me', content: '晚点回你', time: '21:04', type: 'text' }, { from: '阿澈', content: '好', time: '21:06', type: 'text' }] }, contactName: '阿澈', chatId: 'c1' });
  const sides = p2.bubbles.map(b => b.side).join(',');
  if (sides !== 'left,right') add('气泡反转判据失败: ' + sides);
  if (p2.withheld.length !== 3) add('withheld 应单列 3 条');
  if (p2.writesNothing !== true) add('writesNothing 必须为 true');
  return { ok: issues.length === 0, issues };
}

export default projectOtherSide;
