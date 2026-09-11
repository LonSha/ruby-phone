/**
 * B站生成与解析 — 适配自 jiuyi777/xiao-shouji bilibiliLogic.ts
 * 不抓真实网页；只保存 B站或 phone://bilibili/ 模拟条目。
 */
export function isBilibiliEntryUrl(url) {
  const raw = String(url || '').trim();
  if (raw.startsWith('phone://bilibili/')) return true;
  try {
    const parsed = new URL(raw);
    return parsed.hostname === 'www.bilibili.com'
      || parsed.hostname === 'bilibili.com'
      || parsed.hostname === 'search.bilibili.com';
  } catch (e) {
    return false;
  }
}

function compactText(value, max = 0) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return max > 0 && text.length > max ? text.slice(0, max) + '...' : text;
}

function makeLocalBilibiliUrl(seed, index) {
  const slug = encodeURIComponent((String(seed || 'bilibili').trim() || 'bilibili').replace(/\s+/g, '-'));
  return 'phone://bilibili/' + slug + '-' + (index + 1);
}

export function normalizeBilibiliEntries(entries, query, now = Date.now()) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const rawUrl = compactText(entry.url);
      const url = isBilibiliEntryUrl(rawUrl) ? rawUrl : makeLocalBilibiliUrl(query || entry.title || 'entry', index);
      const comments = Array.isArray(entry.comments) ? entry.comments : [];
      return {
        id: compactText(entry.id) || ('bili-' + now + '-' + index),
        title: compactText(entry.title) || ((query || '日常') + '｜刷到的 B站视频'),
        upName: compactText(entry.upName) || '匿名UP',
        cover: compactText(entry.cover),
        url,
        description: compactText(entry.description) || '一条像从手机里刷到的 B站视频条目。',
        tags: (Array.isArray(entry.tags) ? entry.tags : []).map((tag) => compactText(tag)).filter(Boolean).slice(0, 8),
        playCount: compactText(entry.playCount) || '1.2万',
        danmakuCount: compactText(entry.danmakuCount) || '233',
        danmaku: (Array.isArray(entry.danmaku) ? entry.danmaku : []).map((item) => compactText(item)).filter(Boolean).slice(0, 8),
        comments: comments.map((comment, commentIndex) => ({
          id: compactText(comment.id) || ('bili-comment-' + now + '-' + index + '-' + commentIndex),
          userName: compactText(comment.userName) || '路过的观众',
          content: compactText(comment.content),
          likedCount: compactText(comment.likedCount) || '0'
        })).filter((comment) => comment.content).slice(0, 8),
        createdAt: now,
        favorite: Boolean(entry.favorite),
        source: entry.source || 'generated'
      };
    })
    .filter((entry) => entry.title && isBilibiliEntryUrl(entry.url))
    .slice(0, 8);
}

export function buildFallbackBilibiliPayload(query, now = Date.now()) {
  const clean = String(query || '').trim() || '最近刷到的事';
  const rawEntries = [
    {
      title: clean + '｜生活区突然刷到的 12 分钟',
      upName: '手机里的生活区UP',
      url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(clean),
      description: '像是随手记录的一段日常，标题不大声，但评论区很会补细节。',
      tags: ['生活', '日常', '手机记录'],
      playCount: '12.8万',
      danmakuCount: '1832',
      danmaku: ['这个氛围对了', '前面别走，后面有细节', '像真的刷到过'],
      comments: [
        { userName: '半夜还在刷', content: '这种生活区视频就是会让人突然安静下来。', likedCount: '128' }
      ]
    },
    {
      title: clean + ' 的弹幕怎么都这么懂',
      upName: '弹幕观察员',
      url: makeLocalBilibiliUrl(clean, 1),
      description: '剪了几个像网友边看边吐槽的瞬间，弹幕比视频还会讲故事。',
      tags: ['弹幕', '剪辑', '评论区'],
      playCount: '4.6万',
      danmakuCount: '906',
      danmaku: ['哈哈哈哈这里', '别说了我也这样', '暂停看评论']
    }
  ];
  return {
    summary: '刷到 ' + rawEntries.length + ' 条和「' + clean + '」有关的 B站视频。',
    entries: normalizeBilibiliEntries(rawEntries, clean, now)
  };
}

export function parseBilibiliPayload(raw, query, now = Date.now()) {
  try {
    const parsed = JSON.parse(raw);
    const modelEntries = Array.isArray(parsed.entries)
      ? parsed.entries.filter((entry) => {
          const url = compactText(entry.url);
          return !url || isBilibiliEntryUrl(url);
        })
      : [];
    const entries = normalizeBilibiliEntries(modelEntries, query, now)
      .map((entry) => Object.assign({}, entry, { source: 'model' }));
    if (entries.length > 0) {
      return {
        summary: compactText(parsed.summary) || ('刷到 ' + entries.length + ' 条和「' + query + '」有关的 B站视频。'),
        entries
      };
    }
  } catch (e) {}
  return buildFallbackBilibiliPayload(query, now);
}

export class BiliData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'bili_entries_v1';
    this.query = '';
    this.entries = [];
    this.summary = '';
    this._load();
  }

  _load() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (data && Array.isArray(data.entries)) {
        this.entries = data.entries;
        this.summary = data.summary || '';
        this.query = data.query || '';
      }
    } catch (e) {}
  }

  _save() {
    try {
      this.storage?.set?.(this.storageKey, {
        query: this.query,
        summary: this.summary,
        entries: this.entries
      });
    } catch (e) {}
  }

  refresh(query) {
    const payload = buildFallbackBilibiliPayload(query);
    this.query = query;
    this.summary = payload.summary;
    this.entries = payload.entries;
    this._save();
    return payload;
  }

  ingestModelText(raw, query) {
    const payload = parseBilibiliPayload(raw, query || this.query);
    this.query = query || this.query;
    this.summary = payload.summary;
    this.entries = payload.entries;
    this._save();
    return payload;
  }
}

export default BiliData;