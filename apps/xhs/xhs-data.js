/**
 * 小红书 (XHS App) - 数据管理模块
 * 管理笔记流、评论、点赞与用户发布记录
 * 持久化保存在当前会话的 chatMetadata['ruby_phone'].xhs 中，防串味
 */

export class XhsData {
  constructor(storage) {
    this.storage = storage;
    this.storageKey = 'ruby_xhs_notes';
    this.notes = [];
    this.loadNotes();
  }

  loadNotes() {
    try {
      const raw = this.storage?.get?.(this.storageKey);
      if (raw) {
        this.notes = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } else {
        this.notes = this._getDefaultNotes();
      }
    } catch (e) {
      console.warn('[XhsData] 加载笔记失败:', e);
      this.notes = this._getDefaultNotes();
    }
  }

  saveNotes() {
    try {
      this.storage?.set?.(this.storageKey, this.notes);
    } catch (e) {
      console.warn('[XhsData] 保存笔记失败:', e);
    }
  }

  _getDefaultNotes() {
    return [
      {
        id: 'note_demo_1',
        title: '终于吃到这家排队两小时的舒芙蕾了🥞',
        content: '口感真的像云朵一样轻柔！甜而不腻，搭配苦咖啡刚刚好。和喜欢的人一起分享幸福感加倍✨', 
        author: '顾海棠',
        avatar: 'https://files.catbox.moe/r08d2g.jpg',
        cover: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&q=80',
        tags: ['探店', '下午茶', '甜品治愈一切'],
        likes: 128,
        isLiked: false,
        time: '2小时前',
        comments: [
          { author: '林梦漪', text: '看着好诱人呀，在哪个街区？', time: '1小时前' },
          { author: '顾海棠', text: '就在东方大厦后门转角那家！', time: '40分钟前' }
        ]
      },
      {
        id: 'note_demo_2',
        title: '今日OOTD｜慵懒日常与微醺夏夜🌿',
        content: '简简单单的丝质衬衫配阔腿裤，走在江风吹过的街道上很舒服。晚安，江城。',
        author: '景媛',
        avatar: 'https://files.catbox.moe/c3qnwf.jpg',
        cover: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=500&q=80',
        tags: ['OOTD', '穿搭', '夏日晚风'],
        likes: 342,
        isLiked: false,
        time: '昨天',
        comments: []
      }
    ];
  }

  getNotes() {
    return this.notes;
  }

  getNoteById(id) {
    return this.notes.find(n => n.id === id);
  }

  addNote(note) {
    const newNote = {
      id: 'note_' + Date.now(),
      title: note.title || '无题笔记',
      content: note.content || '',
      author: note.author || '我',
      avatar: note.avatar || '',
      cover: note.cover || '',
      tags: note.tags || [],
      likes: 0,
      isLiked: false,
      time: '刚刚',
      comments: []
    };
    this.notes.unshift(newNote);
    this.saveNotes();
    return newNote;
  }

  toggleLike(noteId) {
    const note = this.getNoteById(noteId);
    if (note) {
      note.isLiked = !note.isLiked;
      note.likes += note.isLiked ? 1 : -1;
      this.saveNotes();
      return note;
    }
    return null;
  }

  addComment(noteId, text, author = '我') {
    const note = this.getNoteById(noteId);
    if (note) {
      const cmt = {
        author,
        text,
        time: '刚刚'
      };
      note.comments.push(cmt);
      this.saveNotes();
      return cmt;
    }
    return null;
  }

  /**
   * 从 AI 输出中捕获笔记并自动收录
   */
  parseFromMessage(text) {
    const tagMatch = text.match(/<RED>([\s\S]*?)<\/RED>/i) || text.match(/<xhs>([\s\S]*?)<\/xhs>/i);
    if (!tagMatch) return null;
    try {
      const data = JSON.parse(tagMatch[1].trim());
      if (data && (data.title || data.content)) {
        return this.addNote(data);
      }
    } catch (e) {
      console.warn('[XhsData] 解析 AI 笔记标签失败:', e);
    }
    return null;
  }
}
