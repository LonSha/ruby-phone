/**
 * 对话整理格式化 (移植自 糯叽叽 nuojiji-tools md_writer/md_parser 的对话合并与标记算法)
 * 纯本地纯规则，零外部 API 依赖。
 * 核心规则：
 *   1. 5 分钟同一发言人连续消息合并为一个引用块（中间用空行分隔，避免刷屏式重复）
 *   2. 线上/线下标记：## 📱线上 / ## 📝线下（对应 iOS/App 在线模式与剧情注入的线下模式）
 *   3. 每条消息锚定「发言人 + 时间」，跨消息组连续时自然衔接
 */

// 5 分钟内视为同一对话片段
export const DIALOG_MERGE_WINDOW_MS = 5 * 60 * 1000;

/**
 * 将原始消息序列整理成规范的对话片段数组
 * @param {Array} messages 每条 { speaker, text, timestamp, mode? }
 * @param {Object} opts
 * @returns {Array} [{ speaker, texts: string[], startTime, endTime, mode }]
 */
export function mergeConversation(messages, opts = {}) {
  const windowMs = Number(opts.windowMs) || DIALOG_MERGE_WINDOW_MS;
  const list = (Array.isArray(messages) ? messages : []).filter(m => m && String(m.text || '').trim());
  if (!list.length) return [];
  const result = [];
  let cur = null;
  for (const m of list) {
    const ts = Number(m.timestamp) || 0;
    const speaker = String(m.speaker || '') || '未知';
    const mode = m.mode === 'offline' ? 'offline' : 'online';
    if (
      cur &&
      cur.speaker === speaker &&
      cur.mode === mode &&
      (!ts || !cur.endTime || (ts - cur.endTime) <= windowMs)
    ) {
      cur.texts.push(String(m.text || '').trim());
      if (ts) cur.endTime = Math.max(cur.endTime || 0, ts);
      continue;
    }
    cur = { speaker, texts: [String(m.text || '').trim()], startTime: ts, endTime: ts, mode };
    result.push(cur);
  }
  return result;
}

/**
 * 将对话片段渲染为文本块（糯叽叽风格：引用行 + 空行分隔）
 * @param {Array} merged mergeConversation 的结果
 * @param {Object} opts { withMarkers: 是否插入 ## 📱线上/📝线下 标记, withTime: 是否带 HH:MM }
 * @returns {string}
 */
export function formatConversationBlock(merged, opts = {}) {
  const withMarkers = opts.withMarkers !== false;
  const withTime = opts.withTime !== false;
  const parts = [];
  let lastMode = null;
  for (const seg of merged) {
    if (withMarkers && seg.mode !== lastMode) {
      lastMode = seg.mode;
      parts.push('## ' + (seg.mode === 'offline' ? '📝 线下' : '📱 线上'));
    }
    const time = withTime && seg.startTime ? ' ' + formatTimeLabel(seg.startTime) : '';
    parts.push('**' + seg.speaker + '**' + time);
    for (const t of seg.texts) {
      parts.push('> ' + t);
    }
  }
  return parts.join('\n');
}

/**
 * 把原始消息直接整理成可读对话文本（一键入口）
 * @param {Array} messages [{ speaker, text, timestamp?, mode? }]
 * @param {Object} opts
 * @returns {string}
 */
export function tidyConversation(messages, opts = {}) {
  const merged = mergeConversation(messages, opts);
  return formatConversationBlock(merged, opts);
}

function formatTimeLabel(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export default { mergeConversation, formatConversationBlock, tidyConversation, DIALOG_MERGE_WINDOW_MS };