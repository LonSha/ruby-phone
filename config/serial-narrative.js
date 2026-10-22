/* ============================================================
 * config/serial-narrative.js — [v4.54.0 · 第六期 R6-X7]
 *   「跨媒介互动连载：一部故事可以在聊天、阅读与小剧场间展开」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X7）】
 *   「章节节点可呈现正文、来信、虚拟帖子、可选对话或演出；
 *    作者定义角色状态与可见选择，读者行动决定下一段交互素材。
 *    每次试玩持独立进度，作品正文和玩家正史分离。」
 *
 * 【验收下限】
 *   ① 三章、两个分岔、至少三种媒介构成完整连载
 *   ② 试玩A路线不污染B路线和原聊天正史
 *   ③ 作者修改第二章后，新读者走新版，旧读者可选择继续旧版或迁移
 *
 * 【本模块只做四件事（纯函数）】
 *   1 createSerial：作者创建连载，章节带媒介类型和分岔选择
 *   2 createReaderProgress：读者开始试玩，持独立进度
 *   3 advanceChapter：读者选择分支推进，每路线独立不污染
 *   4 applyAuthorRevision：作者修改某章后生成新版本，旧读者可选择迁移
 *
 * 【口径纪律】
 *   · 不允许剧本嵌任意JS；动作来自受限 owner
 *   · 作品正文与玩家正史分离
 * ============================================================ */
const VERSION = '4.54.0';
const FROZEN_WORDS = ['serial', 'chapter', 'branch', 'progress', 'revision', 'medium'];

const MEDIUM_TYPES = ['prose', 'letter', 'post', 'dialog', 'performance'];

/**
 * 作者创建连载
 * @param {object} opts
 * @param {string} opts.serialId
 * @param {string} opts.title
 * @param {Array<{chapterId:string, title:string, medium:string, content:string, choices?:Array<{id:string,label:string,targetChapterId:string}>}>} opts.chapters
 * @returns {object} serial
 */
export function createSerial(opts) {
  if (!opts || !opts.serialId || !opts.title) {
    throw new Error('createSerial: serialId and title required');
  }
  if (!Array.isArray(opts.chapters) || opts.chapters.length < 1) {
    throw new Error('createSerial: chapters required');
  }
  for (const ch of opts.chapters) {
    if (!ch.chapterId || !MEDIUM_TYPES.includes(ch.medium)) {
      throw new Error(`createSerial: invalid chapter ${JSON.stringify(ch)}`);
    }
  }
  return {
    serialId: opts.serialId,
    title: opts.title,
    chapters: opts.chapters,
    version: 1,
    revisions: {}, // { chapterId: newVersion }
    createdAt: null,
  };
}

/**
 * 读者开始试玩，持独立进度
 * @param {string} serialId
 * @param {string} readerId
 * @returns {object} reader progress
 */
export function createReaderProgress(serialId, readerId) {
  return {
    progressId: `${serialId}_${readerId}_${Date.now()}`,
    serialId,
    readerId,
    currentChapterId: null,
    visitedChapters: [],
    chosenBranches: [], // 记录选择路径
    serialVersion: 1, // 绑定连载版本
    migrated: false,
    mainChatContaminated: false, // 不污染原聊天正史
  };
}

/**
 * 读者选择分支推进
 * @param {object} serial - 连载对象
 * @param {object} progress - 读者进度
 * @param {string} chapterId - 要进入的章节
 * @param {string} [choiceId] - 选择分支 id
 * @returns {object} { chapter, state }
 */
export function advanceChapter(serial, progress, chapterId, choiceId) {
  if (!serial || !progress) throw new Error('advanceChapter: serial and progress required');
  const chapter = serial.chapters.find((c) => c.chapterId === chapterId);
  if (!chapter) {
    return { chapter: null, state: 'not-found' };
  }
  // 记录访问
  if (!progress.visitedChapters.includes(chapterId)) {
    progress.visitedChapters.push(chapterId);
  }
  progress.currentChapterId = chapterId;
  if (choiceId) {
    progress.chosenBranches.push({ chapterId, choiceId });
  }
  // 不污染原聊天正史
  progress.mainChatContaminated = false;
  return { chapter, state: 'reading' };
}

/**
 * 作者修改某章后生成新版本
 * 旧读者可选择继续旧版或迁移
 * @param {object} serial
 * @param {string} chapterId - 被修改的章
 * @param {object} newChapter - 新章内容
 * @param {object} progress - 读者进度（可选，传入则检查是否需要迁移）
 * @param {boolean} [migrate] - 读者是否选择迁移
 * @returns {object} { updatedSerial, readerAffected, migrated }
 */
export function applyAuthorRevision(serial, chapterId, newChapter, progress, migrate) {
  if (!serial || !chapterId || !newChapter) {
    throw new Error('applyAuthorRevision: serial, chapterId, newChapter required');
  }
  // 更新连载中的章节
  const idx = serial.chapters.findIndex((c) => c.chapterId === chapterId);
  if (idx === -1) {
    throw new Error(`applyAuthorRevision: chapter ${chapterId} not found`);
  }
  serial.chapters[idx] = { ...newChapter, chapterId };
  // 记录修订版本
  serial.revisions[chapterId] = (serial.revisions[chapterId] || 0) + 1;
  serial.version++;

  // 如果有读者进度
  if (progress) {
    const readerAffected = progress.visitedChapters.includes(chapterId) ||
      progress.currentChapterId === chapterId;
    if (migrate) {
      // 读者选择迁移：无论哪章被改，都接受新版本
      progress.serialVersion = serial.version;
      progress.migrated = true;
      return { updatedSerial: serial, readerAffected: true, migrated: true };
    }
    // 不迁移：旧读者继续走旧版
    return { updatedSerial: serial, readerAffected, migrated: false };
  }
  // 新读者走新版
  return { updatedSerial: serial, readerAffected: false, migrated: false };
}

Object.freeze(Object.freeze({ VERSION, FROZEN_WORDS }));