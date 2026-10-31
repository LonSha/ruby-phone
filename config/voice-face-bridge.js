/* ============================================================
 * config/voice-face-bridge.js — [v4.102.0 · R13-O3]
 *   「声音叙事」桥：把 voice-narrative 的纯函数接到相册的音频面
 * ------------------------------------------------------------
 * 【为什么需要这一层（R13-O3 的 A 类决策）】
 *   `config/voice-narrative.js` 自 v4.53.0 起就有完整的演出能力：
 *     把旁白/台词/停顿/环境音/音乐提示编成时间轴 → 顺序演出、暂停、恢复
 *     → 换一句台词只标该 cue 为 dirty，不重跑全部媒体
 *     → 无 TTS 时给文字预演并明确标缺失。
 *   但产品端零 import，只在 tests/system-v4530.test.mjs 里被消费。
 *   R13-O3 判 A 类：它的能力只差一页。
 *
 * 【本桥最重要的一条：**不假装有音频**】
 *   内核 `textPreview` 在缺 TTS / 缺素材时把每一项标成 `hasAudio:false`
 *   并把原因记进 `missing`。本桥不改这个结论、也不美化它：
 *   · 没有 TTS 就整段标「文字预演」；
 *   · 没有素材的环境音/音乐标「缺素材」，不写成「静音处理」；
 *   · 停顿真的不需要音频，所以它是唯一 `hasAudio:true` 的非语音 cue —— 这点照抄内核。
 *
 * 【本桥补的那一格：进度与「已重制」的记账】
 *   内核 `replaceCue` 只把被换的 cue 标 dirty，不负责清 dirty，也不记「谁重制过」。
 *   桥补两件事：
 *     ① `markRendered(run, cueId)` —— 把某条 cue 的 dirty 清掉（= 这条重制完了）；
 *     ② `dirtyRows(run)` —— 只列 dirty 的那几条，供视图说「要重制 N 段」。
 *   也就是说「只重制一段」在界面上是**看得见的一段**，不是一句承诺。
 *
 * 【诚实边界】
 *   · 本桥不调用 TTS、不播音频、不读也不写 storage：它只产出**文字**；
 *   · 示例场景是**一个例子**，不是内容库；
 *   · 桥只保证「能力有了一页」，不保证这一页好听。
 * ============================================================ */
import {
  createNarrative,
  playbackStep,
  replaceCue,
  textPreview,
} from './voice-narrative.js';

const TYPE_LABEL = {
  narration: '旁白',
  dialog: '台词',
  pause: '停顿',
  ambience: '环境音',
  music: '音乐',
};

const MISSING_LABEL = {
  'tts-unavailable': '没有 TTS：只能文字预演',
  'asset-missing': '素材不在库里',
  'no-asset-ref': '没指定素材',
};

/** 内置示例：三角色、约五分钟。内容刻意做成日常一夜，不做成剧情大片。 */
export function sampleNarrative() {
  return createNarrative({
    projectId: 'sample-night-bus',
    title: '末班车',
    cues: [
      { cueId: 'q01', type: 'ambience', assetRef: 'amb_street_night', durationMs: 20000 },
      { cueId: 'q02', type: 'narration', text: '十一点四十，站牌下只剩两个人。', durationMs: 18000 },
      { cueId: 'q03', type: 'dialog', actorId: 'lin', text: '你也等这趟？', durationMs: 12000 },
      { cueId: 'q04', type: 'dialog', actorId: 'zhou', text: '嗯。等了三趟都没停。', durationMs: 16000 },
      { cueId: 'q05', type: 'pause', durationMs: 6000 },
      { cueId: 'q06', type: 'music', assetRef: 'bgm_low_strings', durationMs: 40000 },
      { cueId: 'q07', type: 'narration', text: '风把广告牌吹得咔哒响。', durationMs: 18000 },
      { cueId: 'q08', type: 'dialog', actorId: 'lin', text: '我读中学那会儿，这条线还是双层的。', durationMs: 24000 },
      { cueId: 'q09', type: 'dialog', actorId: 'zhou', text: '双层？我怎么没见过。', durationMs: 14000 },
      { cueId: 'q10', type: 'dialog', actorId: 'chen', text: '因为最后一辆，就是被你们俩赶上的那辆。', durationMs: 26000 },
      { cueId: 'q11', type: 'pause', durationMs: 8000 },
      { cueId: 'q12', type: 'narration', text: '车来了。玻璃上全是雾。', durationMs: 22000 },
      { cueId: 'q13', type: 'ambience', assetRef: 'amb_bus_door', durationMs: 16000 },
      { cueId: 'q14', type: 'music', assetRef: null, durationMs: 24000 },
      { cueId: 'q15', type: 'narration', text: '没有人再说话。', durationMs: 26000 },
    ],
  });
}

export function startSampleRun() {
  return { project: sampleNarrative(), rendered: [] };
}

function guard(run) {
  const r = (run && typeof run === 'object') ? run : {};
  if (!r.project) return null;
  return r;
}

/**
 * 文字预演：把整条时间轴翻成可读行。
 * availability 由调用方给（本桥不探测 TTS —— 探测属于宿主，不属于翻译层）。
 * 不给 availability 时按「没有 TTS、库里没素材」处理，也就是最保守的那一种。
 */
export function previewRows(run, availability) {
  const r = guard(run);
  if (!r) return { rows: [], missing: [], summary: '这一场还没开始' };
  const avail = availability && typeof availability === 'object'
    ? availability
    : { ttsAvailable: false, assets: {} };
  const out = textPreview(r.project, avail) || { lines: [], missing: [] };
  const missById = new Map();
  for (const m of (out.missing || [])) {
    if (!missById.has(m.cueId)) missById.set(m.cueId, []);
    missById.get(m.cueId).push(MISSING_LABEL[m.reason] || String(m.reason || '缺席'));
  }
  const rows = (out.lines || []).map((line) => ({
    cueId: line.cueId,
    type: line.type,
    typeLabel: TYPE_LABEL[line.type] || line.type,
    actorId: line.actorId || '',
    text: String(line.text || ''),
    durationMs: Number(line.durationMs || 0),
    hasAudio: !!line.hasAudio,
    why: (missById.get(line.cueId) || []).join('、'),
  }));
  const total = rows.reduce((s, x) => s + x.durationMs, 0);
  const withAudio = rows.filter((x) => x.hasAudio).length;
  return {
    rows,
    missing: Array.isArray(out.missing) ? out.missing.slice() : [],
    /* 一句话说清「这一页现在是文字，不是音频」——不写成「已生成」。 */
    summary: withAudio + '/' + rows.length + ' 项有音频 · 全长 ' + fmtDuration(total) + ' · 其余为文字预演',
  };
}

/** 播放控制：把内核的 action 透传，返回人话。 */
export function stepAndRead(run, action) {
  const r = guard(run);
  if (!r) return { ok: false, state: 'idle', text: '这一场还没开始', cueId: '' };
  const res = playbackStep(r.project, action);
  const label = { play: '从头开始', pause: '暂停', resume: '继续', stop: '停下', next: '下一段' }[action] || action;
  if (!res || !res.currentCue) {
    return {
      ok: action === 'stop',
      state: String((res && res.state) || r.project.state || 'idle'),
      text: label + '：' + (res && res.state === 'ended' ? '到结尾了' : '没有可演的一段'),
      cueId: '',
    };
  }
  return {
    ok: true,
    state: String(res.state || ''),
    text: label + '：' + cueLabel(res.currentCue),
    cueId: res.currentCue.cueId,
  };
}

function cueLabel(cue) {
  const t = TYPE_LABEL[cue.type] || cue.type;
  const who = cue.actorId ? '（' + cue.actorId + '）' : '';
  const body = cue.text ? '「' + cue.text + '」' : '';
  return t + who + body;
}

/**
 * 换一句台词：只把这一条标 dirty（内核行为），并在桥这层记账「这次动过谁」。
 * @returns {{ ok:boolean, dirtyCount:number, replaced:object|null }}
 */
export function replaceLineAndRead(run, cueId, text) {
  const r = guard(run);
  if (!r) return { ok: false, dirtyCount: 0, replaced: null, why: '这一场还没开始' };
  const idx = (r.project.cues || []).findIndex((c) => c.cueId === cueId);
  if (idx === -1) return { ok: false, dirtyCount: 0, replaced: null, why: '没有这一段' };
  const old = r.project.cues[idx];
  if (old.type !== 'dialog' && old.type !== 'narration') {
    return { ok: false, dirtyCount: 0, replaced: null, why: '只有旁白与台词能换词' };
  }
  const next = { ...old, text: String(text == null ? '' : text) };
  /* 内核会拒绝「type 非法」的新 cue，也会拒绝找不到的 cueId；
   * 这里类型没变，所以不会抛 —— 但仍包一层，因为「内核哪天加了校验」不该炸穿视图。 */
  let res;
  try {
    res = replaceCue(r.project, cueId, next);
  } catch (e) {
    return { ok: false, dirtyCount: 0, replaced: null, why: String((e && e.message) || '换不了这一句') };
  }
  return {
    ok: true,
    dirtyCount: Number((res && res.dirtyCount) || 0),
    replaced: (res && res.replaced) || null,
  };
}

/** 已重制（清 dirty）。内核不管这件事，桥把它做成一个明确的动作。 */
export function markRendered(run, cueId) {
  const r = guard(run);
  if (!r) return { ok: false, dirtyCount: 0 };
  const cue = (r.project.cues || []).find((c) => c.cueId === cueId);
  if (!cue) return { ok: false, dirtyCount: 0 };
  cue.dirty = false;
  if (!r.rendered.includes(cueId)) r.rendered.push(cueId);
  return { ok: true, dirtyCount: dirtyRows(run).length };
}

/** 还欠重制的那几条（界面上要说得出口的数字）。 */
export function dirtyRows(run) {
  const r = guard(run);
  if (!r) return [];
  return (r.project.cues || []).filter((c) => c.dirty).map((c) => ({
    cueId: c.cueId,
    typeLabel: TYPE_LABEL[c.type] || c.type,
    text: String(c.text || ''),
  }));
}

/** 这一场的一句话状态。 */
export function runStatus(run) {
  const r = (run && typeof run === 'object') ? run : {};
  if (!r.project) return { state: 'idle', text: '还没开始' };
  const stateText = { idle: '未开始', playing: '演出中', paused: '已暂停', ended: '演完了' }[r.project.state] || String(r.project.state);
  const n = dirtyRows(run).length;
  return {
    state: String(r.project.state || 'idle'),
    text: stateText + (n ? ' · 待重制 ' + n + ' 段' : ''),
  };
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const m = Math.floor(total / 60000);
  const s = Math.round((total % 60000) / 1000);
  return m ? (m + ' 分 ' + s + ' 秒') : (s + ' 秒');
}