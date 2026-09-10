/**
 * 百度贴吧 (Tieba App) - 数据管理模块
 * 管理贴吧列表、帖子流与楼中楼互动
 * 持久化于当前会话的 chatMetadata['ruby_phone'].tieba 中
 */

export class TiebaData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'ruby_tieba_posts';
    this.bars = [
      { id: 'bar_jc', name: '江城生活吧', avatar: 'https://files.catbox.moe/r08d2g.jpg', follows: '12.8万', postsCount: '45.2万' },
      { id: 'bar_rz', name: '弱智吧', avatar: 'https://files.catbox.moe/c3qnwf.jpg', follows: '245万', postsCount: '890万' },
      { id: 'bar_uni', name: '青石大学吧', avatar: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=200&q=80', follows: '6.4万', postsCount: '18.9万' }
    ];
    this.posts = [];
    this.loadPosts();
  }

  loadPosts() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      if (raw) {
        this.posts = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } else {
        this.posts = this._getDefaultPosts();
      }
    } catch (e) {
      console.warn('[TiebaData] 读取帖子失败:', e);
      this.posts = this._getDefaultPosts();
    }
  }

  savePosts() {
    try {
      this.storage?.set?.(this.storageKey, this.posts);
    } catch (e) {
      console.warn('[TiebaData] 保存帖子失败:', e);
    }
  }

  _getDefaultPosts() {
    return [
      {
        id: 'post_1',
        barId: 'bar_jc',
        barName: '江城生活吧',
        title: '东方大厦这边的晚风真舒服，有人一起夜跑吗？',
        content: '刚下班，在江边吹风。感觉整座城市的霓虹都倒映在水里，心情突然放松下来了。顺便问问附近有什么好吃的夜宵摊推荐？',
        author: '江城夜归人',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80',
        time: '30分钟前',
        likes: 19,
        isLiked: false,
        replies: [
          { author: '顾海棠', text: '东门转角那家炒螺丝很地道，不过这个点可能要排队。', time: '20分钟前', floor: 2 },
          { author: '林梦落', text: '夜跑＋夜宵，这波热量直接守恒了属于是😂', time: '15分钟前', floor: 3 }
        ]
      },
      {
        id: 'post_2',
        barId: 'bar_rz',
        barName: '弱智吧',
        title: '既然熬夜对身体不好，那为什么我通宵通得这么精神？',
        content: '如题，感觉医学界对我隐瞒了人体的真实潜能。',
        author: '哲学大蒜',
        avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&q=80',
        time: '2小时前',
        likes: 88,
        isLiked: false,
        replies: [
          { author: '回光返照研究员', text: '手机没电前屏幕还会亮最后一下呢。', time: '1小时前', floor: 2 },
          { author: '熬夜冠军', text: '因为你的灵魂已经先你一步睡着了。', time: '50分钟前', floor: 3 }
        ]
      }
    ];
  }

  getPostsByBar(barId) {
    if (!barId || barId === 'all') return this.posts;
    return this.posts.filter(p => p.barId === barId);
  }

  getPostById(postId) {
    return this.posts.find(p => p.id === postId);
  }

  createPost(barId, title, content, author = '我') {
    const bar = this.bars.find(b => b.id === barId) || this.bars[0];
    const newPost = {
      id: 'post_' + Date.now(),
      barId: bar.id,
      barName: bar.name,
      title,
      content,
      author,
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80',
      time: '刚刚',
      likes: 0,
      isLiked: false,
      replies: []
    };
    this.posts.unshift(newPost);
    this.savePosts();
    return newPost;
  }

  addReply(postId, text, author = '我') {
    const post = this.getPostById(postId);
    if (post) {
      const floor = post.replies.length + 2;
      const reply = {
        author,
        text,
        time: '刚刚',
        floor
      };
      post.replies.push(reply);
      this.savePosts();
      return reply;
    }
    return null;
  }

  toggleLike(postId) {
    const post = this.getPostById(postId);
    if (post) {
      post.isLiked = !post.isLiked;
      post.likes += post.isLiked ? 1 : -1;
      this.savePosts();
      return post;
    }
    return null;
  }

  parseFromMessage(text) {
    const tagMatch = text.match(/<Tieba>([\s\S]*?)<\/Tieba>/i) || text.match(/<tieba>([\s\S]*?)<\/tieba>/i);
    if (!tagMatch) return null;
    try {
      const data = JSON.parse(tagMatch[1].trim());
      if (data && data.title) {
        return this.createPost(data.barId || 'bar_jc', data.title, data.content || '', data.author || '网友');
      }
    } catch (e) {
      console.warn('[TiebaData] 解析贴吧标签失败:', e);
    }
    return null;
  }
}
