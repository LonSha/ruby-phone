/**
 * config/clipboard-dnd.js — 剪贴板与拖放的类型契约 [R26-X7]
 *
 * 立项时的空缺（原文）：跨 App 搬内容只能靠重打。验收口径：支持应用内拖放与
 * 剪贴板互转；类型不符给出**可读的拒绝理由**。
 *
 * 三条硬口径：
 *  ① **拒绝必须带理由**：`reject` 一定同时给出 `reason`（人话），不许只回 `false`
 *     —— 界面拿不到理由就只能显示「失败了」，用户不知道要换成什么。
 *  ② **接收面是白名单**：每个落点只收它声明过的类型；没有声明的落点直接拒（不是默认全收）。
 *  ③ **空载荷不算搬过去**：拖一个空文本过去也得拒，否则等于把旧内容清空了。
 */

/** 可搬运的五种载荷类型。 */
export const TRANSFER_KINDS = Object.freeze(['text', 'rich-text', 'image', 'files', 'message-ref']);

/** 落点白名单：每个落点声明自己收哪些类型（不在表里的落点一律拒）。 */
export const DROP_TARGETS = Object.freeze({
  'chat-input': Object.freeze(['text', 'rich-text', 'image', 'files', 'message-ref']),
  notes: Object.freeze(['text', 'rich-text', 'image']),
  calendar: Object.freeze(['text']),
  'file-manager': Object.freeze(['files', 'image']),
});

const KIND_LABELS = Object.freeze({
  text: '一段文字',
  'rich-text': '带格式的文字',
  image: '图片',
  files: '文件',
  'message-ref': '一条消息引用',
});

/** 载荷是不是「有东西」：文本非空、文件非空数组、其它非空。 */
function isEmptyPayload(kind, payload) {
  if (payload == null) return true;
  if (kind === 'text' || kind === 'rich-text') return String(payload).trim() === '';
  if (kind === 'files') return !Array.isArray(payload) || payload.length === 0;
  if (kind === 'message-ref') return typeof payload !== 'object' || payload === null || !payload.messageId;
  return false;
}

/**
 * 拖放裁定。
 * @param {{kind:string, payload:any, target:string}} input
 * @returns {{ok:boolean, action:'accept'|'reject', reason:string, target:string, kind:string}}
 */
export function planDrop(input = {}) {
  const kind = input.kind;
  const target = input.target;
  if (!TRANSFER_KINDS.includes(kind)) {
    throw new TypeError(`未知载荷类型：${kind}`);
  }
  const accepts = Object.prototype.hasOwnProperty.call(DROP_TARGETS, target) ? DROP_TARGETS[target] : null;
  const base = { ok: false, action: 'reject', target: target || '', kind };
  if (!accepts) {
    return { ...base, reason: `这里（${target || '未知位置'}）不能放东西` };
  }
  if (isEmptyPayload(kind, input.payload)) {
    return { ...base, reason: '拖过来的是空的，没有可放的内容' };
  }
  if (!accepts.includes(kind)) {
    const can = accepts.map((k) => KIND_LABELS[k] || k).join(' / ');
    return { ...base, reason: `这里只收 ${can}，你拖的是${KIND_LABELS[kind] || kind}` };
  }
  return { ok: true, action: 'accept', target, kind, reason: `可以放：${KIND_LABELS[kind] || kind}` };
}

/** 剪贴板 → 拖放载荷：识别消息引用（JSON）与纯文本，其余按文本处理。 */
export function sniffClipboard(text) {
  const raw = text == null ? '' : String(text);
  if (!raw.trim()) return { kind: null, payload: null, reason: '剪贴板是空的' };
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.messageId === 'string') {
        return { kind: 'message-ref', payload: obj, reason: '这是一条消息引用' };
      }
    } catch (_e) {
      /* 不是 JSON 就按纯文本走 —— 但绝不吞掉原文 */
    }
  }
  return { kind: 'text', payload: raw, reason: '按一段文字处理' };
}

export function dropText(result) {
  if (!result || typeof result !== 'object') return '拖放：没有裁定结果';
  if (result.action === 'accept') return `可以放下（${result.target}）：${result.reason}`;
  return `放不下（${result.target || '未知位置'}）：${result.reason}`;
}

export function clipboardDndSelfCheck() {
  const ok1 = planDrop({ kind: 'text', payload: 'hi', target: 'chat-input' });
  const badTarget = planDrop({ kind: 'text', payload: 'hi', target: 'nowhere' });
  const badKind = planDrop({ kind: 'files', payload: [{ name: 'a.txt' }], target: 'calendar' });
  const empty = planDrop({ kind: 'text', payload: '   ', target: 'notes' });
  const sniffed = sniffClipboard('{"messageId":"m1","text":"早"}');
  const plain = sniffClipboard('早');
  const emptyClip = sniffClipboard('');
  const ok =
    ok1.ok === true &&
    badTarget.ok === false &&
    badTarget.reason.includes('不能放东西') &&
    badKind.ok === false &&
    badKind.reason.includes('只收') &&
    empty.reason.includes('空的') &&
    sniffed.kind === 'message-ref' &&
    plain.kind === 'text' &&
    plain.payload === '早' &&
    emptyClip.kind === null &&
    dropText(badKind).includes('放不下');
  return { ok, bad: { badTarget, badKind, empty }, sample: dropText(badKind) };
}