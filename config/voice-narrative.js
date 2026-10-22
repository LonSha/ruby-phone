/* ============================================================
 * config/voice-narrative.js — [v4.53.0 · 第六期 R6-X5]
 *   「可演出的声音叙事：把文字、角色声线和场景音编成一场作品」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-X5）】
 *   「把创作场次拆为旁白/台词/停顿/环境音/音乐提示，作者编辑顺序和时机，
 *    绑定已有合法素材与声线；可预演、只重制一段、导出可重开的演出项目。」
 *
 * 【验收下限】
 *   ① 三角色五分钟场景可顺序演出、暂停、恢复；
 *   ② 替换一句台词只重制相应声部，不重跑全部媒体；
 *   ③ 无TTS服务或缺素材时可文字预演且明确缺失，不假报已生成音频。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不播放音频）】
 *   1 **createNarrative**：创建演出项目，含时间轴（cues 序列），
 *      每个 cue 带 type（narration/dialog/pause/ambience/music）、角色绑定与素材引用；
 *   2 **playbackStep**：给定当前播放位置和状态（playing/paused），
 *      推进到下一个 cue，返回当前 cue 信息与新状态；
 *   3 **replaceCue**：替换单个 cue（如换台词），只标记该 cue 的声部为 dirty，
 *      不标记其他 cue 为需重制；
 *   4 **textPreview**：无 TTS / 缺素材时生成文字预览，
 *      明确标注缺失项（missing），不假报已生成音频。
 *
 * 【口径纪律】
 *   · 素材引用是合法素材 id，不播放真实音频；
 *   · 缺素材时明确标 missing，不假报已生成；
 *   · 局部替换只标 dirty 该 cue，不重跑全部。
 * ============================================================ */
const VERSION = '4.53.0';
const FROZEN_WORDS = ['narrative', 'cue', 'playback', 'dirty', 'textPreview', 'missing'];

const CUE_TYPES = ['narration', 'dialog', 'pause', 'ambience', 'music'];
const PLAYBACK_STATES = ['idle', 'playing', 'paused', 'ended'];

/**
 * 创建一个演出项目
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.title
 * @param {Array<{cueId:string, type:string, actorId?:string, text?:string, durationMs:number, assetRef?:string}>} opts.cues - 时间轴
 * @returns {object} narrative project
 */
export function createNarrative(opts) {
  if (!opts || !opts.projectId || !opts.title) {
    throw new Error('createNarrative: projectId and title required');
  }
  if (!Array.isArray(opts.cues) || opts.cues.length === 0) {
    throw new Error('createNarrative: cues required');
  }
  // 校验 cue 类型
  for (const c of opts.cues) {
    if (!c.cueId || !CUE_TYPES.includes(c.type)) {
      throw new Error(`createNarrative: invalid cue ${JSON.stringify(c)}`);
    }
    if (typeof c.durationMs !== 'number' || c.durationMs < 0) {
      throw new Error(`createNarrative: cue ${c.cueId} needs durationMs >= 0`);
    }
  }
  return {
    projectId: opts.projectId,
    title: opts.title,
    cues: opts.cues.map((c) => ({ ...c, dirty: false })),
    currentIndex: 0,
    state: 'idle',
    totalDurationMs: opts.cues.reduce((sum, c) => sum + c.durationMs, 0),
  };
}

/**
 * 推进播放到下一个 cue
 * @param {object} project
 * @param {string} action - 'play' | 'pause' | 'resume' | 'stop'
 * @returns {object} { currentCue, state, nextIndex }
 */
export function playbackStep(project, action) {
  if (!project) throw new Error('playbackStep: project required');
  const validActions = ['play', 'pause', 'resume', 'stop', 'next'];
  if (!validActions.includes(action)) {
    throw new Error('playbackStep: invalid action');
  }

  if (action === 'play') {
    project.state = 'playing';
    project.currentIndex = 0;
    // play 返回第一个 cue
    if (project.cues.length === 0) {
      project.state = 'ended';
      return { currentCue: null, state: 'ended', nextIndex: 0 };
    }
    const cue = project.cues[0];
    project.currentIndex = 1;
    if (project.currentIndex >= project.cues.length) {
      project.state = 'ended';
    }
    return { currentCue: cue, state: project.state, nextIndex: project.currentIndex };
  } else if (action === 'pause') {
    if (project.state !== 'playing') {
      return { currentCue: null, state: project.state, nextIndex: project.currentIndex };
    }
    project.state = 'paused';
    return { currentCue: project.cues[project.currentIndex - 1] || null, state: 'paused', nextIndex: project.currentIndex };
  } else if (action === 'resume') {
    if (project.state !== 'paused') {
      return { currentCue: null, state: project.state, nextIndex: project.currentIndex };
    }
    project.state = 'playing';
    return { currentCue: project.cues[project.currentIndex - 1] || null, state: 'playing', nextIndex: project.currentIndex };
  } else if (action === 'stop') {
    project.state = 'ended';
    project.currentIndex = project.cues.length;
    return { currentCue: null, state: 'ended', nextIndex: project.currentIndex };
  } else if (action === 'next') {
    if (project.state === 'ended' || project.state === 'idle') {
      return { currentCue: null, state: project.state, nextIndex: project.currentIndex };
    }
    if (project.currentIndex >= project.cues.length) {
      project.state = 'ended';
      return { currentCue: null, state: 'ended', nextIndex: project.currentIndex };
    }
    const cue = project.cues[project.currentIndex];
    project.currentIndex++;
    if (project.currentIndex >= project.cues.length) {
      project.state = 'ended';
    }
    return { currentCue: cue, state: project.state, nextIndex: project.currentIndex };
  }

  return { currentCue: null, state: project.state, nextIndex: project.currentIndex };
}

/**
 * 替换单个 cue（如换台词）
 * 只标记被替换的 cue 为 dirty，其他 cue 不受影响
 * @param {object} project
 * @param {string} cueId - 要替换的 cue id
 * @param {object} newCue - 新的 cue 数据
 * @returns {object} { replaced: object, dirtyCount: number } 被替换的 cue + 总 dirty 数
 */
export function replaceCue(project, cueId, newCue) {
  if (!project || !cueId || !newCue) {
    throw new Error('replaceCue: project, cueId, newCue required');
  }
  if (!CUE_TYPES.includes(newCue.type)) {
    throw new Error('replaceCue: invalid cue type');
  }
  const idx = project.cues.findIndex((c) => c.cueId === cueId);
  if (idx === -1) {
    throw new Error(`replaceCue: cue ${cueId} not found`);
  }
  // 替换该 cue，标记 dirty
  project.cues[idx] = { ...newCue, cueId, dirty: true };
  // 只标记该 cue 为 dirty，其他 cue 不变
  const dirtyCount = project.cues.filter((c) => c.dirty).length;
  return { replaced: project.cues[idx], dirtyCount };
}

/**
 * 无 TTS / 缺素材时生成文字预览
 * 明确标注缺失项，不假报已生成音频
 * @param {object} project
 * @param {object} [availability] - { ttsAvailable?: boolean, assets?: { [assetRef]: boolean } }
 * @returns {{ lines: Array, missing: Array }} 文字预览行 + 缺失项列表
 */
export function textPreview(project, availability) {
  if (!project) throw new Error('textPreview: project required');
  const avail = availability || {};
  const lines = [];
  const missing = [];

  for (const cue of project.cues) {
    const line = {
      cueId: cue.cueId,
      type: cue.type,
      actorId: cue.actorId || null,
      text: cue.text || '',
      durationMs: cue.durationMs,
      hasAudio: false,
    };

    if (cue.type === 'pause') {
      line.text = `[停顿 ${cue.durationMs}ms]`;
      line.hasAudio = true; // 停顿不需要音频
    } else if (cue.type === 'narration' || cue.type === 'dialog') {
      // 需要 TTS 或预录音频
      if (cue.assetRef) {
        const assetOk = avail.assets && avail.assets[cue.assetRef];
        line.hasAudio = !!assetOk;
        if (!assetOk) {
          missing.push({ cueId: cue.cueId, reason: 'asset-missing', assetRef: cue.assetRef });
        }
      } else if (!avail.ttsAvailable) {
        line.hasAudio = false;
        missing.push({ cueId: cue.cueId, reason: 'tts-unavailable', actorId: cue.actorId });
      } else {
        line.hasAudio = true;
      }
    } else if (cue.type === 'ambience' || cue.type === 'music') {
      if (cue.assetRef) {
        const assetOk = avail.assets && avail.assets[cue.assetRef];
        line.hasAudio = !!assetOk;
        if (!assetOk) {
          missing.push({ cueId: cue.cueId, reason: 'asset-missing', assetRef: cue.assetRef });
        }
      } else {
        line.hasAudio = false;
        missing.push({ cueId: cue.cueId, reason: 'no-asset-ref' });
      }
    }

    lines.push(line);
  }

  return { lines, missing };
}

Object.freeze(Object.freeze({ VERSION, FROZEN_WORDS }));