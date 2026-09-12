/* ========================================================
 *  查手机 (Peek) — 适配自 jiuyi777/xiao-shouji peekLogic.ts
 *  从 RubyPhone 已有 App 数据汇总角色手机痕迹：微信/日记/相册/日历/小红书/音乐
 *  有真实数据用真实数据；空缺时生成标记为「推测痕迹」的占位，不伪装成已发生
 *  微信对话框体经 tidyConversation 整理（5分钟同发言人合并，来自糯叽叽 nuojiji 对话算法）
 * ======================================================== */
import { tidyConversation } from '../../config/dialog-format.js';

const SECTION_TITLES = {
  chats: '最近聊天',
  diaries: '日记',
  gallery: '相册',
  calendar: '日历',
  xiaohongshu: '小红书',
  music: '音乐',
  douyin: '抖音',
  weibo: '微博',
  bilibili: 'B站',
  douban: '豆瓣',
  daily: '角色日报'
};

function compactText(value, max = 64) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function formatDateLabel(time) {
  const date = new Date(Number(time) || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hour + ':' + minute;
}

function joinItems(items) {
  return items.filter(Boolean).join('；');
}
function formatCount(count) {
  if (count >= 10000) return (count / 10000).toFixed(count >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(count);
}

function seedFromName(name) {
  return String(name || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function pickGenerated(name, values) {
  const list = values || [];
  if (!list.length) return '';
  return list[Math.abs(seedFromName(name)) % list.length];
}

function describeWechatMessage(message) {
  if (!message) return '消息';
  const type = String(message.type || 'text');
  const content = String(message.content || '').trim();
  if (message.recalled) return '撤回了一条消息';
  if (type === 'voice' || type === 'call_text') return compactText(content || '语音', 42);
  if (type === 'image' || type === 'image_prompt') return compactText(content || '图片', 42);
  if (type === 'sticker') return compactText(message.keyword || content || '表情', 42);
  if (type === 'transfer') {
    const amount = Number(message.amount || 0).toFixed(2);
    const status = message.status === 'received' ? '已收款' : (message.status === 'refunded' ? '已退回' : '');
    return '[转账]¥' + amount + (status ? '（' + status + '）' : '');
  }
  if (type === 'redpacket') return compactText('[红包]' + (message.wish || message.content || ''), 42);
  if (type === 'gift') return compactText('[礼物]' + (message.giftName || content || ''), 42);
  if (type === 'location') return compactText(content || '位置', 42);
  return compactText(content || '文字消息', 42);
}

function generatedDetails(id, characterName) {
  const name = characterName || '角色';
  const map = {
    chats: [
      { id: 'generated-chat-1', title: '微信', subtitle: '12分钟前', body: name + '还没回完这段聊天。对方问 TA 到家没有，又补了一句「伞不用急着还」。', generated: true },
      { id: 'generated-chat-2', title: '微信', subtitle: '昨晚', body: '对方发来一张排班表，说上次落下的东西还放在柜台后面。\n' + name + '只回了一个「我明天路过」。', generated: true }
    ],
    diaries: [
      { id: 'generated-diary-1', title: name + '的凌晨日记', subtitle: '今天 01:18', body: '今天没有写太多。只是记下一个时间、一个没打出去的电话，还有一句后来删掉的话。', generated: true }
    ],
    gallery: [
      { id: 'generated-photo-1', title: '窗边光线', subtitle: '最近项目', body: name + '手机相册里的一张窗边照片，画面里有半杯没喝完的水。', generated: true },
      { id: 'generated-photo-2', title: '街角招牌', subtitle: '最近项目', body: '夜里拍的，招牌有一点过曝，像是走得很急时随手留下。', generated: true }
    ],
    calendar: [
      { id: 'generated-calendar-1', title: pickGenerated(name, ['傍晚去旧书店', '周末整理旧物', '晚上回一通电话']), subtitle: '角色日历', body: name + '给这个日程留了提醒，但没有写完整备注。', generated: true }
    ],
    xiaohongshu: [
      { id: 'generated-xhs-1', title: name + '的草稿', subtitle: '未发布笔记', body: '草稿只写了一半，像是在记录一个路口、一场雨和一个没有明说的人。', generated: true }
    ],
    music: [
      { id: 'generated-music-1', title: '循环中的歌', subtitle: '最近播放', body: name + '的播放器停在这首歌，进度条没有播完。', generated: true }
    ]
  };
  return map[id] || [];
}

function generatedSection(id, characterName) {
  const items = generatedDetails(id, characterName);
  return {
    id,
    title: SECTION_TITLES[id],
    count: 0,
    generated: true,
    items,
    description: joinItems(items.slice(0, 2).map((item) => item.title + '：' + compactText(item.body, 50)))
  };
}

export class PeekData {
  constructor(storage) {
    this.storage = storage;
    this.selectedName = '';
    this.autoInject = false;
  }

  _phone() {
    return (typeof window !== 'undefined' && window.VirtualPhone) ? window.VirtualPhone : {};
  }

  listCharacters() {
    const names = new Set();
    const phone = this._phone();
    try {
      const wechat = phone.wechatApp?.wechatData;
      if (wechat) {
        (wechat.getContacts?.() || []).forEach((c) => { if (c?.name) names.add(String(c.name).trim()); });
        (wechat.getChatList?.() || []).forEach((c) => {
          if (c?.type !== 'group' && c?.name) names.add(String(c.name).trim());
        });
      }
    } catch (e) {}
    try {
      const diary = phone.diaryApp?.data || phone.diaryApp?.diaryData;
      (diary?.getEntries?.() || []).forEach((e) => { if (e?.author) names.add(String(e.author).trim()); });
    } catch (e) {}
    try {
      const ctx = window.SillyTavern?.getContext?.();
      const charName = ctx?.name2 || ctx?.characters?.[ctx.characterId]?.name;
      if (charName) names.add(String(charName).trim());
    } catch (e) {}
    return [...names].filter(Boolean);
  }

  getSelectedName() {
    const names = this.listCharacters();
    if (this.selectedName && names.includes(this.selectedName)) return this.selectedName;
    this.selectedName = names[0] || '';
    return this.selectedName;
  }

  setSelectedName(name) {
    this.selectedName = String(name || '').trim();
  }

  _sameName(a, b) {
    return String(a || '').trim() === String(b || '').trim();
  }

  _buildChats(name) {
    const phone = this._phone();
    const wechat = phone.wechatApp?.wechatData;
    if (!wechat) return generatedSection('chats', name);
    const chats = (wechat.getChatList?.() || []).filter((chat) => chat?.type !== 'group' && this._sameName(chat.name, name));
    const items = chats.slice(0, 6).map((chat) => {
      const messages = (wechat.getMessages?.(chat.id) || [])
        .filter((m) => m && m.isTimeMarker !== true && m.type !== 'time_marker')
        .slice(-6);
      const latest = messages[messages.length - 1];
      const dialogText = tidyConversation(messages.map((m) => ({
        speaker: this._sameName(m.from, name) ? name : (m.from || '对方'),
        text: describeWechatMessage(m),
        timestamp: Number(m.timestamp) || 0
      })), { withMarkers: false, withTime: true });
      const body = dialogText || '这个会话还没有留下消息。';
      return {
        id: chat.id,
        title: chat.name || '微信',
        subtitle: latest ? (latest.time || formatDateLabel(latest.timestamp)) : '还没有消息',
        body
      };
    });
    if (!items.length) return generatedSection('chats', name);
    return {
      id: 'chats',
      title: SECTION_TITLES.chats,
      count: items.length,
      generated: false,
      items,
      description: joinItems(items.slice(0, 3).map((item) => item.title + ' ' + compactText(item.body, 42)))
    };
  }

  _buildDiaries(name) {
    const phone = this._phone();
    const diary = phone.diaryApp?.data || phone.diaryApp?.diaryData;
    const entries = (diary?.getEntries?.() || [])
      .filter((entry) => this._sameName(entry.author, name))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 8);
    const items = entries.map((entry) => ({
      id: entry.id,
      title: entry.title || compactText(entry.content, 18) || '日记',
      subtitle: entry.date || formatDateLabel(entry.createdAt),
      body: entry.content || '还没有正文'
    }));
    if (!items.length) return generatedSection('diaries', name);
    return {
      id: 'diaries',
      title: SECTION_TITLES.diaries,
      count: items.length,
      generated: false,
      items,
      description: joinItems(items.slice(0, 3).map((item) => item.title + '：' + compactText(item.body, 56)))
    };
  }

  _buildGallery(name) {
    const phone = this._phone();
    const album = phone.albumApp?.data || phone.albumApp?.albumData;
    const images = (album?.getImages?.() || album?.getMedia?.() || []).slice(0, 12);
    const items = images.map((img, index) => ({
      id: img.path || img.src || ('photo-' + index),
      title: img.filename || img.title || '照片',
      subtitle: img.sourceLabel || img.album || '相册',
      body: img.note || img.description || '没有描述',
      imageUrl: img.src || img.path || img.url
    }));
    if (!items.length) return generatedSection('gallery', name);
    return {
      id: 'gallery',
      title: SECTION_TITLES.gallery,
      count: items.length,
      generated: false,
      items,
      description: joinItems(items.slice(0, 3).map((item) => item.title))
    };
  }

  _buildCalendar(name) {
    const phone = this._phone();
    const calendar = phone.calendarApp?.data || phone.calendarApp?.calendarData;
    const memos = (calendar?.getMemos?.() || []).slice(-8).reverse();
    const items = memos.map((memo) => ({
      id: memo.id || memo.date,
      title: memo.title || memo.content || '日程',
      subtitle: memo.date || '',
      body: memo.content || memo.note || '没有备注'
    }));
    if (!items.length) return generatedSection('calendar', name);
    return {
      id: 'calendar',
      title: SECTION_TITLES.calendar,
      count: items.length,
      generated: false,
      items,
      description: joinItems(items.slice(0, 3).map((item) => (item.subtitle || '') + ' ' + item.title))
    };
  }

  _buildXiaohongshu(name) {
    const phone = this._phone();
    const xhs = phone.xhsApp?.data || phone.xhsApp?.xhsData;
    const notes = (xhs?.getNotes?.() || []).filter((note) => this._sameName(note.author, name)).slice(0, 8);
    const items = notes.map((note) => ({
      id: note.id,
      title: note.title || '笔记',
      subtitle: note.time || note.author || '',
      body: note.content || '没有正文',
      imageUrl: note.cover || note.imageUrl,
      meta: Array.isArray(note.tags) ? note.tags.join('、') : ''
    }));
    if (!items.length) return generatedSection('xiaohongshu', name);
    return {
      id: 'xiaohongshu',
      title: SECTION_TITLES.xiaohongshu,
      count: items.length,
      generated: false,
      items,
      description: joinItems(items.slice(0, 3).map((item) => item.title + '：' + compactText(item.body, 52)))
    };
  }

  _buildDouyin(name) {
    const phone = this._phone();
    const videoItems = [];
    const seen = new Set();
    const pushVideo = (v) => {
      if (!v || !v.title) return;
      const key = v.title;
      if (seen.has(key)) return;
      seen.add(key);
      videoItems.push(v);
    };
    // 来源1: 小红书本人笔记 → 抖音作品
    try {
      const xhs = phone.xhsApp?.data || phone.xhsApp?.xhsData;
      (xhs?.getNotes?.() || []).filter((note) => this._sameName(note.author, name)).slice(0, 6).forEach((note, i) => {
        pushVideo({
          id: 'dy-' + (note.id || i),
          title: note.title || '短视频',
          videoDescription: note.content || '',
          createdAt: note.time || formatDateLabel(note.timestamp),
          likeCount: 320 + ((seedFromName(note.title || '视频') * 7) % 9800),
          commentCount: 12 + ((seedFromName(note.title || '视频') * 3) % 300),
          saveCount: 8 + ((seedFromName(note.title || '视频') * 5) % 500),
          coverIcon: note.cover || note.imageUrl || '',
          tone: ['ivory', 'mist', 'blush', 'graphite'][i % 4],
          comments: []
        });
      });
    } catch (e) {}
    // 来源2: 相册照片 → 作品(无封面用 emoji 占位)
    try {
      const album = phone.albumApp?.data || phone.albumApp?.albumData;
      (album?.getImages?.() || album?.getMedia?.() || []).slice(0, 7).forEach((img, i) => {
        pushVideo({
          id: 'dy-album-' + (img.path || i),
          title: img.note || img.title || img.filename || '随手拍',
          videoDescription: img.description || '记录这一刻。',
          createdAt: formatDateLabel(img.timestamp) || '刚刚',
          likeCount: 90 + ((seedFromName(img.title || img.filename || 'x') * 5) % 3000),
          commentCount: 5 + ((seedFromName(img.title || img.filename || 'x') * 2) % 120),
          saveCount: 3 + ((seedFromName(img.title || img.filename || 'x') * 3) % 180),
          coverIcon: img.src || img.path || img.url || '',
          tone: ['ivory', 'mist', 'blush', 'graphite'][(i + 2) % 4],
          comments: []
        });
      });
    } catch (e) {}
    // 来源3: 微博本人帖子 → 收藏/喜欢
    try {
      const weibo = phone.weiboApp?.data || phone.weiboApp?.weiboData;
      const posts = (weibo?.getPosts?.() || []).filter((p) => this._sameName(p.author, name)).slice(0, 4);
      posts.forEach((p, i) => {
        pushVideo({
          id: 'dy-wb-' + (p.id || i),
          title: p.title || compactText(p.content || '微博', 24),
          videoDescription: p.content || '',
          createdAt: p.time || formatDateLabel(p.timestamp),
          likeCount: 40 + ((seedFromName(p.title || 'w') * 3) % 800),
          commentCount: 2 + ((seedFromName(p.title || 'w') * 2) % 60),
          saveCount: 1 + ((seedFromName(p.title || 'w') * 2) % 40),
          coverIcon: '',
          tone: ['ivory', 'mist', 'blush', 'graphite'][(i + 1) % 4],
          comments: []
        });
      });
    } catch (e) {}
    if (!videoItems.length) {
      // 无真实痕迹 → 生成可辨识的推测作品(标记 generated)
      for (let i = 0; i < 4; i++) {
        videoItems.push({
          id: 'dy-guess-' + i,
          title: ['随手记录的一天', '和 TA 的回味', '深夜小片段', '今天的小确幸'][i % 4] + '（推测）',
          videoDescription: '这是一段留在 ' + name + ' 抖音里的短视频，具体内容有待剧情发展。',
          createdAt: '',
          likeCount: 58,
          commentCount: 6,
          saveCount: 4,
          coverIcon: '',
          tone: ['ivory', 'mist', 'blush', 'graphite'][i % 4],
          comments: []
        });
      }
    }
    // 拆成 works / saved / liked
    const works = videoItems.filter((_, i) => i % 3 !== 1);
    const savedVideos = videoItems.filter((_, i) => i % 3 === 1);
    const likedVideos = videoItems.filter((_, i) => i % 3 === 2);
    return {
      id: 'douyin',
      title: SECTION_TITLES.douyin,
      count: videoItems.length,
      generated: !videoItems.some((v) => !v.id.startsWith('dy-guess-')),
      items: videoItems.map((v) => ({
        id: v.id,
        title: v.title,
        subtitle: '❤ ' + (v.likeCount || 0) + '  💬 ' + (v.commentCount || 0),
        body: v.videoDescription || '',
        imageUrl: v.coverIcon || '',
        meta: v.tone
      })),
      douyin: {
        profile: {
          name: name,
          handle: 'douyin号：' + name.split('').slice(0, 4).join('_'),
          bio: '记录生活，分享快乐。',
          followingCount: 128,
          followerCount: 3560,
          likesTotal: 18420
        },
        works,
        savedVideos,
        likedVideos
      },
      description: joinItems(videoItems.slice(0, 4).map((v) => v.title))
    };
  }
  _buildMusic(name) {
    const phone = this._phone();
    const music = phone.musicApp?.musicData;
    const playlist = (music?.getPlaylist?.() || []).slice(0, 8);
    const current = music?.getCurrentSong?.();
    const items = [];
    if (current) {
      items.push({
        id: 'current',
        title: current.name || '正在播放',
        subtitle: current.artist || '最近播放',
        body: name + '的播放器停在这首歌。'
      });
    }
    playlist.forEach((song, index) => {
      items.push({
        id: song.id || ('song-' + index),
        title: song.name || '歌曲',
        subtitle: song.artist || '',
        body: '留在歌单里的一首歌。'
      });
    });
    const unique = [];
    const seen = new Set();
    for (const item of items) {
      const key = item.title + '|' + item.subtitle;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    if (!unique.length) return generatedSection('music', name);
    return {
      id: 'music',
      title: SECTION_TITLES.music,
      count: unique.length,
      generated: false,
      items: unique.slice(0, 10),
      description: joinItems(unique.slice(0, 4).map((item) => item.title))
    };
  }
  _buildWeibo(name) {
    const phone = this._phone();
    const weibo = phone.weiboApp?.data || phone.weiboApp?.weiboData;
    const myPosts = [];
    const seen = new Set();
    const pushPost = (p) => {
      if (!p || !p.body && !p.content) return;
      const key = String(p.body || p.content || '').slice(0, 24);
      if (seen.has(key)) return;
      seen.add(key);
      myPosts.push({
        id: p.id || ('wb-' + myPosts.length),
        authorName: name,
        authorBadge: '',
        body: p.body || p.content || '',
        mediaIcon: '',
        tone: ['mist', 'ivory', 'blush'][myPosts.length % 3],
        repostCount: ((seedFromName(key) || 1) * 3) % 90,
        commentCount: ((seedFromName(key) || 1) * 2) % 200,
        likeCount: ((seedFromName(key) || 1) * 5) % 1200,
        comments: []
      });
    };
    try {
      (weibo?.getUserPosts?.() || []).forEach(pushPost);
    } catch (e) {}
    try {
      (weibo?.getRecommendPosts?.() || []).filter(() => true).slice(0, 2).forEach(pushPost);
    } catch (e) {}
    if (!myPosts.length) {
      myPosts.push(...[0, 1, 2].map((i) => ({
        id: 'wb-guess-' + i,
        authorName: name,
        authorBadge: '',
        body: ['今天也晒了太阳', '刚看完一部剧，后劲很大', '深夜碎碎念'] [i] + '（推测）',
        mediaIcon: '',
        tone: ['mist', 'ivory', 'blush'][i],
        repostCount: 3, commentCount: 5, likeCount: 40,
        comments: []
      })));
    }
    // 微博热搜(他人)
    const hotSearches = [];
    try {
      (weibo?.getHotSearches?.() || []).slice(0, 8).forEach((h, i) => {
        hotSearches.push({
          id: 'wb-hot-' + i,
          title: h.title || h.tag || '',
          hot: h.hot || h.tag || ''
        });
      });
    } catch (e) {}
    return {
      id: 'weibo',
      title: SECTION_TITLES.weibo,
      count: myPosts.length,
      generated: !myPosts.some((p) => !p.id.startsWith('wb-guess-')),
      items: myPosts.map((p) => ({
        id: p.id,
        title: p.body.slice(0, 20),
        subtitle: '🔁 ' + p.repostCount + '  ❤ ' + p.likeCount,
        body: p.body,
        meta: p.tone
      })),
      weibo: { myPosts, hotSearches },
      description: joinItems(myPosts.slice(0, 3).map((p) => p.body.slice(0, 24)))
    };
  }
  _buildBilibili(name) {
    const phone = this._phone();
    const bili = phone.biliApp?.data || phone.biliApp?.biliData;
    const entries = (bili?.entries || bili?.getEntries?.() || []).slice(0, 8);
    const videos = entries.map((e, i) => ({
      id: e.id || ('bv-' + i),
      title: e.title || '视频',
      author: e.up || e.author || 'UP主',
      bvid: e.bvid || e.url || '',
      coverIcon: e.cover || e.pic || '',
      playCount: 100000 + ((seedFromName(e.title || 'v') * 77) % 9000000),
      danmakuCount: 500 + ((seedFromName(e.title || 'v') * 13) % 80000),
      time: e.publishTime || e.time || ''
    }));
    if (!videos.length) {
      for (let i = 0; i < 4; i++) {
        videos.push({
          id: 'bv-guess-' + i,
          title: ['深夜刷到的甜剧', '猫咪混剪', '游戏实况', '美食探店'][i] + '（推测）',
          author: '某UP主',
          bvid: '',
          coverIcon: '',
          playCount: 60000,
          danmakuCount: 800,
          time: ''
        });
      }
    }
    return {
      id: 'bilibili',
      title: SECTION_TITLES.bilibili,
      count: videos.length,
      generated: !videos.some((v) => !v.id.startsWith('bv-guess-')),
      items: videos.map((v) => ({
        id: v.id,
        title: v.title,
        subtitle: v.author + ' · 👀 ' + formatCount(v.playCount),
        body: 'B站观看记录。',
        imageUrl: v.coverIcon || '',
        meta: v.bvid
      })),
      bilibili: { videos },
      description: joinItems(videos.slice(0, 4).map((v) => v.title))
    };
  }
  _buildDouban(name) {
    const phone = this._phone();
    const activities = [];
    const music = phone.musicApp?.musicData;
    try {
      const current = music?.getCurrentSong?.();
      if (current) activities.push({ id: 'db-music', type: 'listened', title: '在听 · ' + (current.name || '歌'), content: '此刻耳机里放着这首歌。' });
    } catch (e) {}
    try {
      const diary = phone.diaryApp?.data || phone.diaryApp?.diaryData;
      (diary?.getEntries?.() || []).filter((en) => this._sameName(en.author, name)).slice(0, 2).forEach((en, i) => {
        activities.push({ id: 'db-diary-' + i, type: 'diary', title: en.title || '日记', content: en.content || '' });
      });
    } catch (e) {}
    try {
      const reading = phone.readingApp?.data || phone.readingApp?.readingData;
      (reading?.getBooks?.() || reading?.getHistory?.() || []).slice(0, 2).forEach((b, i) => {
        activities.push({ id: 'db-book-' + i, type: 'book_review', title: '在读 · ' + (b.title || '书'), content: b.note || b.description || '看到一半。' });
      });
    } catch (e) {}
    if (!activities.length) {
      activities.push(
        { id: 'db-guess-1', type: 'diary', title: '想去看海（推测）', content: '收藏了很久的一个念想。' },
        { id: 'db-guess-2', type: 'want_watch', title: '想看 · 一部老电影（推测）', content: '在待看清单里躺了很久。' }
      );
    }
    return {
      id: 'douban',
      title: SECTION_TITLES.douban,
      count: activities.length,
      generated: !activities.some((a) => !a.id.startsWith('db-guess-')),
      items: activities.map((a) => ({
        id: a.id,
        title: a.title,
        subtitle: a.type,
        body: a.content || '',
        meta: a.type
      })),
      douban: { activities },
      description: joinItems(activities.slice(0, 3).map((a) => a.title))
    };
  }
  _buildDaily(name) {
    // 借鉴 dwell-on-something 12-日报 机制：版块化报纸 + 末尾夹一张便条
    // 数据源全部为本会话已有痕迹（微信/日记/微博/小红书/日历），纯模板格式化，零 LLM
    const phone = this._phone();
    const now = new Date();
    const today = now.getDate();
    // 版块1: 今日聊天
    const chatLines = [];
    try {
      const wechat = phone.wechatApp?.wechatData;
      (wechat?.getChatList?.() || []).filter((c) => c?.type !== 'group' && this._sameName(c.name, name)).slice(0, 4).forEach((chat) => {
        const msgs = (wechat?.getMessages?.(chat.id) || []).filter((m) => m && m.isTimeMarker !== true && Number(m.timestamp) && new Date(m.timestamp).getDate() === today);
        if (msgs.length) {
          chatLines.push('· 和 ' + chat.name + ' 聊了 ' + msgs.length + ' 条：' + compactText(describeWechatMessage(msgs[msgs.length - 1]), 40));
        }
      });
    } catch (e) {}
    // 版块2: 日记
    const diaryLines = [];
    try {
      const diary = phone.diaryApp?.data || phone.diaryApp?.diaryData;
      (diary?.getEntries?.() || []).filter((en) => this._sameName(en.author, name)).slice(-2).forEach((en) => {
        diaryLines.push('· 《' + (en.title || compactText(en.content, 12) || '无题') + '》' + compactText(en.content || '', 46));
      });
    } catch (e) {}
    // 版块3: 社交动态
    const socialLines = [];
    try {
      const xhs = phone.xhsApp?.data || phone.xhsApp?.xhsData;
      (xhs?.getNotes?.() || []).filter((n) => this._sameName(n.author, name)).slice(-2).forEach((n) => {
        socialLines.push('· 小红书 · ' + (n.title || '笔记') + '：' + compactText(n.content || '', 40));
      });
    } catch (e) {}
    try {
      const weibo = phone.weiboApp?.data || phone.weiboApp?.weiboData;
      (weibo?.getUserPosts?.() || []).slice(-2).forEach((p) => {
        socialLines.push('· 微博 · ' + compactText(p.body || p.content || '', 44));
      });
    } catch (e) {}
    // 版块4: 今日日程
    const calLines = [];
    try {
      const calendar = phone.calendarApp?.data || phone.calendarApp?.calendarData;
      (calendar?.getMemos?.() || []).filter((memo) => memo && String(memo.date || '').includes(String(now.getMonth() + 1) + '月' + today + '日')).forEach((memo) => {
        calLines.push('· ' + (memo.title || memo.content || '日程'));
      });
    } catch (e) {}
    // 版块定义: 每个版块配一句"这一版怎么写"(EXTRA 思想, 但这里用于注入模板说明)
    const sections = [];
    if (chatLines.length) sections.push({ name: '今日聊天', extra: '记录今天和谁说了话', lines: chatLines });
    if (diaryLines.length) sections.push({ name: '今日日记', extra: '角色自己写的日子', lines: diaryLines });
    if (socialLines.length) sections.push({ name: '今日动态', extra: '在社交平台留下的痕迹', lines: socialLines });
    if (calLines.length) sections.push({ name: '今日日程', extra: '日历上排了的事', lines: calLines });
    if (!sections.length) {
      return generatedSection('daily', name);
    }
    // 便条: 从日记/最新动态提炼角色口吻一句话
    let note = '今天也是平静的一天。';
    if (diaryLines.length) {
      note = '（翻到日记，好像昨天也在想这件事。）';
    }
    // 报纸文本
    const dateStr = (now.getMonth() + 1) + '月' + today + '日';
    const head = '== ' + name + ' 的角色日报 · ' + dateStr + ' ==\n';
    const body = sections.map((s) => (
      '【' + s.name + '】' + (s.extra ? '(' + s.extra + ')' : '') + '\n' + s.lines.join('\n')
    )).join('\n\n');
    const noteBlock = '— 便条 —\n' + note;
    const full = head + '\n' + body + '\n\n' + noteBlock;
    return {
      id: 'daily',
      title: SECTION_TITLES.daily,
      count: sections.length,
      generated: false,
      items: sections.map((s) => ({ id: s.name, title: s.name, subtitle: s.lines.length + ' 条', body: s.lines.join('；'), meta: s.extra })),
      daily: { dateStr, sections, note, full },
      description: dateStr + ' · ' + sections.map((s) => s.name).join('/')
    };
  }
  buildViewModel() {
    const names = this.listCharacters();
    const selected = this.getSelectedName();
    if (!selected) {
      return {
        characters: names,
        selectedName: '',
        sections: Object.keys(SECTION_TITLES).map((id) => ({
          id,
          title: SECTION_TITLES[id],
          count: 0,
          generated: false,
          items: [],
          description: '导入角色或先和人聊天后，再来看 TA 的手机。'
        }))
      };
    }
    return {
      characters: names,
      selectedName: selected,
      sections: [
        this._buildChats(selected),
        this._buildDiaries(selected),
        this._buildGallery(selected),
        this._buildCalendar(selected),
        this._buildXiaohongshu(selected),
        this._buildMusic(selected),
        this._buildDouyin(selected),
        this._buildWeibo(selected),
        this._buildBilibili(selected),
        this._buildDouban(selected),
        this._buildDaily(selected)
      ]
    };
  }

  buildPromptDirective() {
    const view = this.buildViewModel();
    if (!view.selectedName) return '';
    const lines = ['【查手机】以下是 ' + view.selectedName + ' 手机里能被看到的痕迹。引用时须自然，不得把推测痕迹当成硬事实。'];
    for (const section of view.sections) {
      const mark = section.generated ? '（推测）' : '';
      const bits = (section.items || []).slice(0, 2).map((item) => compactText(item.title + '：' + item.body, 80));
      if (!bits.length) continue;
      lines.push('- ' + section.title + mark + '：' + bits.join('；'));
    }
    return lines.join('\n');
  }
}

export default PeekData;
