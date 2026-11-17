/* ============================================================
 * tests/_chat_render_snapshot.mjs — 气泡渲染快照（R22-O1 行为等价口径）
 * ------------------------------------------------------------
 * 为什么需要：
 *   `apps/wechat/chat-view.js` 19981 行里抽 `chat-render-core.js` 时，「只搬不改」
 *   这句话必须能被机器验，而不是靠人看 diff 说「应该没变」。
 *   做法：**抽之前**先用同一批 fixture 跑一遍真实渲染方法，把结果按 sha256 落账；
 *   **抽之后**用同一批 fixture 再跑一遍，逐键比对 —— 任何一处输出变化都会被抓到。
 *
 * 口径边界（诚实写明）：
 *   · 这些是**纯字符串产出**的方法（气泡 HTML / 表情面板 HTML / 群投票卡 HTML），
 *     它们的输出就是 DOM 结构的字符串形态，比对字符串等价于比对结构。
 *   · 不覆盖事件绑定、异步写库、真实排版 —— 那些不在本次抽出的方法里。
 *   · `_escapeHtml` 走真 DOM（createElement + textContent→innerHTML），所以替身**必须真做转义**；
 *     第一版替身没做转义，结果四个不同输入同一个 hash（内容被吃掉却被当成等价）—— 已修。
 * ============================================================ */
import { createHash } from 'node:crypto';

export function sha256(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"', "'": '&#39;' };
function escapeLikeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** 装一个「够判」的 document 替身：唯一要求是 createElement 的转义行为与真 DOM 一致。 */
export function installSnapshotDom() {
  const saved = { document: globalThis.document, window: globalThis.window };
  if (!saved.window) globalThis.window = {};
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      let raw = '';
      const el = {
        style: {},
        classList: { add() {}, remove() {} },
        appendChild(c) { return c; },
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
      };
      Object.defineProperty(el, 'textContent', {
        get() { return raw; },
        set(v) { raw = String(v == null ? '' : v); },
        configurable: true,
      });
      Object.defineProperty(el, 'innerHTML', {
        get() { return escapeLikeHtml(raw); },
        set(v) { raw = String(v == null ? '' : v); },
        configurable: true,
      });
      return el;
    },
  };
  return () => {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  };
}

/** 造一个够用的视图壳：只提供被抽方法真正读到的宿主面。 */
export function makeSnapshotView(ChatView, options) {
  const themeId = (options && options.themeId) || 'default';
  const messages = [
    { id: 'm1', type: 'text', content: '你好呀', sender: 'A', timestamp: 1700000000000 },
    { id: 'm2', type: 'text', content: '我在[内心]（他其实有点紧张）。', sender: 'A', timestamp: 1700000060000 },
  ];
  const view = Object.create(ChatView.prototype);
  Object.assign(view, {
    /* renderEmojiPanel 读的三个视图态字段（真机上由构造/交互写入）：
     *   默认标签页 + 非选择模式 + 空选中集，覆盖的就是「刚打开表情面板」这条路径。 */
    emojiTab: 'default',
    customEmojiSelectionMode: false,
    selectedCustomEmojiIds: new Set(),
    app: {
      storage: { get: (k) => (k === 'rp22_chat_bubble_theme' ? themeId : null) },
      currentChat: { id: 'chat-snap' },
      wechatData: {
        getMessages: () => messages,
        /* 自定义表情/表情包是 parseEmoji 与 renderEmojiPanel 的必经读口：
         *   给空表，快照覆盖的就是「没有自定义表情」这条最常见路径。 */
        getCustomEmojis: () => [],
        getStickers: () => [],
      },
      votePollIdOfMessage: (_chatId, msgId) => (msgId === 'vote-1' ? 'poll-1' : ''),
      votePack: () => ({
        read: {
          tally: [
            { optionId: 'o-yes', label: '赞成', support: 3, oppose: 1, abstain: 0 },
            { optionId: 'o-no', label: '反对', support: 1, oppose: 2, abstain: 0 },
          ],
          tied: [],
        },
        picked: 'o-yes',
      }),
    },
  });
  /* renderEmojiPanel 开头会调这个同步口（真机上写 DOM）。
   *   它**留在 chat-view.js**，不参与本次抽取；这里置空只为让快照能取到产出。 */
  view._syncCustomEmojiSelectionWithData = () => {};
  return { view, messages };
}

/**
 * 采一批渲染输出。任何 fixture 抛错也如实记下来（`__error`），
 * 这样「抽前抽后都抛同样的错」也算等价证据，而不是把抛错悄悄当通过。
 */
export function captureChatRenderSnapshot(ChatView, options) {
  const restoreDom = installSnapshotDom();
  const out = {};
  const run = (key, fn) => {
    try { out[key] = sha256(fn()); }
    catch (e) { out[key] = '__error:' + sha256(String((e && e.message) || e)); }
  };

  try {
    const view = makeSnapshotView(ChatView, options).view;

    run('bubble.plain', () => view.renderTextMessageBubble('你好呀'));
    run('bubble.innerThought.single', () => view.renderTextMessageBubble('我在[内心]（他其实有点紧张）。'));
    run('bubble.innerThought.group', () => view.renderTextMessageBubble('我在[内心]（他其实有点紧张）。', { isGroupChat: true }));
    run('bubble.onlyInnerThought', () => view.renderTextMessageBubble('[内心]（只有内心，没有可见文字）'));
    run('bubble.emojiToken', () => view.renderTextMessageBubble('看图[狗头]和😀'));
    run('bubble.htmlEscape', () => view.renderTextMessageBubble('<b>不该被当标签</b> & 引号'));

    run('extractInnerThought.multi', () => JSON.stringify(view.extractInnerThought('a[内心]（x）b[内心]（y）')));
    run('extractInnerThought.none', () => JSON.stringify(view.extractInnerThought('没有内心戏')));

    run('emojiPanel', () => view.renderEmojiPanel());

    run('groupVoteCard.picked', () => view._renderGroupVoteCard({
      id: 'vote-1',
      type: 'group_vote',
      groupVote: { question: '周末去爬山吗？', round: 1, options: [{ id: 'o-yes', label: '赞成' }, { id: 'o-no', label: '反对' }] },
    }));
    run('groupVoteCard.packAbsent', () => {
      const v2 = makeSnapshotView(ChatView, options).view;
      v2.app.votePack = () => null;
      return v2._renderGroupVoteCard({ id: 'vote-2', type: 'group_vote', groupVote: { question: '换题？', options: [] } });
    });
    run('gatheringCard', () => view._renderGatheringCard({
      id: 'g-1',
      type: 'gathering',
      gathering: { title: '晚上八点老地方', place: '城南咖啡馆', time: '今晚 20:00', options: ['改到九点', '换地方'] },
    }));
  } finally {
    restoreDom();
  }

  return out;
}