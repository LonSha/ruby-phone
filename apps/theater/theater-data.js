/**
 * 小剧场逻辑 — 适配自 jiuyi777/xiao-shouji theaterLogic.ts
 * 支持酒馆 {{random:...}}、世界书概率抽取、字数规则和续写拼接。
 */
export const THEATER_STYLES = {
  daily: '日常',
  romance: '暧昧',
  conflict: '吵架',
  dream: '梦境',
  suspense: '悬疑',
  random: '随机'
};

export function splitRandomOptions(block) {
  return String(block || '')
    .split(/[,，、\n]+/)
    .map((item) => item.replace(/^[\s\-[\]]+|[\s\-[\]]+$/g, '').trim())
    .filter(Boolean);
}

export function resolveTavernRandom(content, picker = Math.random) {
  return String(content || '').replace(/\{\{random:([\s\S]*?)\}\}/g, (_match, rawBlock) => {
    const options = splitRandomOptions(String(rawBlock || '').trim().replace(/^\[/, '').replace(/\]$/, ''));
    if (!options.length) return rawBlock;
    const index = Math.min(Math.max(Math.floor(picker() * options.length), 0), options.length - 1);
    return options[index];
  });
}

export function parseTheaterWordCount(text) {
  const normalized = String(text || '').trim()
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/，/g, ',');
  const match = normalized.match(/^(?:约\s*)?([1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\s*字?$/);
  const words = match ? Number(match[1].replace(/,/g, '')) : NaN;
  if (!Number.isSafeInteger(words) || words <= 0) {
    throw new Error('请输入有效字数，例如 1200');
  }
  return words;
}

export function buildTheaterLengthInstruction(length, customLengthText = '') {
  if (length === 'short') return '请生成约 200 到 600 字左右的小剧场。';
  if (length === 'medium') return '请生成约 400 到 800 字左右的小剧场。';
  if (length === 'long') return '请生成约 800 到 1500 字左右的小剧场。';
  return '请生成约 ' + parseTheaterWordCount(customLengthText) + ' 字左右的小剧场。';
}

export function appendTheaterContinuation(previous, next) {
  const body = String(previous || '').trim().replace(/\n\n（本次回复(?:已用到当前最大输出长度|达到长度上限)[^]*?）\s*$/, '');
  return body + (/[。！？.!?…”」』]$/.test(body) ? '\n\n' : '') + String(next || '').trim();
}

export function buildTheaterUserPrompt(input) {
  return [
    '请写成一个完整故事，不要只写片段或设定摘要。',
    input.theme && ('主题：' + input.theme),
    buildTheaterLengthInstruction(input.length, input.customLengthText),
    '角色：' + (input.actorNames || []).join('、'),
    input.style && input.style !== 'random' ? ('风格：' + (THEATER_STYLES[input.style] || input.style)) : '',
    input.rollResult && ('本次世界书随机结果：\n' + input.rollResult)
  ].filter(Boolean).join('\n\n');
}

export function buildTheaterContinuationPrompt(input) {
  return [
    '请从已有小剧场的最后一句自然续写后续。不要重写已有正文。',
    input.theme && ('原主题：' + input.theme),
    buildTheaterLengthInstruction(input.length, input.customLengthText).replace('小剧场', '后续'),
    '已有正文：\n' + String(input.previousContent || '').trim().slice(-8000)
  ].filter(Boolean).join('\n\n');
}

export function rollWorldBookEntries(entries, picker = Math.random) {
  return (entries || [])
    .filter((entry) => entry && entry.content)
    .slice(0, 8)
    .flatMap((entry) => {
      const probability = typeof entry.probability === 'number' ? entry.probability : 100;
      if (probability < 100 && picker() * 100 > probability) return [];
      const resolved = resolveTavernRandom(entry.content, picker).trim();
      if (!resolved) return [];
      return ['【' + (entry.comment || '世界书') + '】\n' + resolved.slice(0, 1200)];
    });
}

export class TheaterData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'theater_stories_v1';
    this.stories = [];
    this.draft = { theme: '', style: 'daily', length: 'medium', customLengthText: '1200', content: '' };
    this._load();
  }

  _load() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(data?.stories)) this.stories = data.stories;
      if (data?.draft) this.draft = Object.assign({}, this.draft, data.draft);
    } catch (e) {}
  }

  _save() {
    try { this.storage?.set?.(this.storageKey, { stories: this.stories, draft: this.draft }); } catch (e) {}
  }

  buildPrompt(isContinue = false) {
    const input = {
      theme: this.draft.theme,
      style: this.draft.style,
      length: this.draft.length,
      customLengthText: this.draft.customLengthText,
      actorNames: [this.draft.actor || '角色'],
      previousContent: this.draft.content,
      rollResult: this.draft.rollResult || ''
    };
    return isContinue ? buildTheaterContinuationPrompt(input) : buildTheaterUserPrompt(input);
  }

  saveCurrent() {
    const content = String(this.draft.content || '').trim();
    if (!content) return null;
    const story = {
      id: 'th-' + Date.now(),
      theme: this.draft.theme || '未命名主题',
      content,
      createdAt: Date.now()
    };
    this.stories.unshift(story);
    this._save();
    return story;
  }

  applyGenerated(text, isContinue = false) {
    const next = String(text || '').trim();
    if (!next) return;
    this.draft.content = isContinue ? appendTheaterContinuation(this.draft.content, next) : next;
    this._save();
  }

  /**
   * [v2.38.0] 世界书概率抽取：从已选（或全部可用）世界书中按概率随机抽取条目，
   *   写入 draft.rollResult（buildPrompt 已预留读取此字段的入口）。
   *   调用同文件 rollWorldBookEntries 纯函数：按 probability 过滤（默认 100%）、
   *   解析 {{random:...}} 宏、取前 8 条、每条截断 1200 字。
   *   返回 { ok, reason?, count? } —— 永不抛。
   */
  async rollWorldBook() {
    const manager = (typeof window !== 'undefined') ? window.VirtualPhone?.worldbookManager : null;
    if (!manager) return { ok: false, reason: 'no-manager' };
    const appKey = 'theater';
    if (!manager.getEnabled(appKey)) return { ok: false, reason: 'disabled' };
    const sel = manager.getSelectionState(appKey);
    let sources = [];
    try { sources = await manager.listAvailableWorldbooks({ includeEntries: true }); } catch (_e) { return { ok: false, reason: 'list-failed' }; }
    const allEntries = [];
    for (const src of (sources || [])) {
      const state = manager.getSourceEntrySelectionState(appKey, src);
      if (state.sourceSelected && state.selectedEntries.length > 0) {
        for (const e of state.selectedEntries) {
          if (e && e.content) allEntries.push({ content: e.content, comment: e.comment || src.name || '世界书', probability: 100 });
        }
      } else if (!sel.initialized || sel.ids.length === 0) {
        for (const e of (src.entries || [])) {
          if (e && e.content) allEntries.push({ content: e.content, comment: e.comment || src.name || '世界书', probability: 100 });
        }
      }
    }
    if (!allEntries.length) return { ok: false, reason: 'no-entries' };
    const rolled = rollWorldBookEntries(allEntries);
    if (!rolled.length) return { ok: false, reason: 'rolled-empty' };
    this.draft.rollResult = rolled.join('\n\n');
    this._save();
    return { ok: true, count: rolled.length };
  }

  clearRollResult() {
    this.draft.rollResult = '';
    this._save();
  }
}

export default TheaterData;