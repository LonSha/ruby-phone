/* ========================================================
 * 积温引擎 (jiwen — 不靠概率骰子的 AI 角色主动意识引擎)
 * 移植自 https://github.com/ClaraShafiq/jiwen (MIT)
 * 五轴连续状态: connection(连接需求) / pride(骄傲) / valence(愉悦度)
 *               / arousal(唤醒度) / immersion(沉浸度)
 * 数学漂移 + 阈值触发 + 可注入持久化/消息源
 * 零依赖, 纯本地可跑; 剥离 Node CommonJS, 改为 ESM export
 * ======================================================== */
'use strict';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 创建一个积温引擎实例。
 * @param {Object} opts
 * @param {Object} [opts.initialState]      初始状态(默认全0)
 * @param {Object} [opts.axes]              轴名→[min,max]
 * @param {Object} [opts.rates]             每轴每分钟漂移速率
 * @param {Object} [opts.thresholds]        { observation, considerContact, forceContact, prideBlock, valenceActivity, arousalAgitation }
 * @param {Object} [opts.immersionMap]      活动类型→初始沉浸度
 * @param {Function} opts.connectionRateFn  (lastMessage)=>num 每分钟连接需求增长速率
 * @param {Function} opts.onSave            持久化回调
 * @param {Function} opts.onLoad            加载回调
 * @param {Function} opts.getLastMessage    消息源
 * @param {Object}  [opts.persona]          人格描述
 */
export function createJiwen(opts) {
  if (!opts) throw new Error('积温: opts is required');

  const axes = opts.axes || {
    connection: [-0, 1],
    pride:      [-1, 1],
    valence:    [-1, 1],
    arousal:    [-1, 1],
    immersion:  [ 0, 1],
  };

  const rates = Object.assign({
    connectionGrowth: null,
    connectionOnReply: 0.20,
    immersionDecay:   0.010,
    prideRegress:     0.003,
    accelDelay: 0,
    connectionAccel: 0,
    valenceRegress:    0.005,
    valenceSetpoint:   0,
    valenceLockThreshold: 1.0,
    valenceLockFactor:    1.0,
    valenceConnectBoost:            0,
    valenceConnectBoostThreshold:  -0.2,
    valenceConnectDampen:           0,
    valenceConnectDampenThreshold: -0.4,
    arousalSetpoint:              0,
    arousalRegress:               0.005,
    arousalConnectionRiseThreshold: 1.0,
    arousalConnectionRiseRate:     0.002,
    arousalLockThreshold: 1.0,
    arousalLockFactor:    1.0,
    prideDefendThreshold: 1.0,
    prideDefendTarget:    0.5,
    prideDefendRate:      0.003,
    prideArousalConflictRate: 0,
    prideErosionRate: 0,
    activityConnectionRelief: 0,
    immersionDampenConnection: 1.0,
    valenceDeltaScaling: false,
    arousalDeltaScaling: false,
    valenceConnectionDriftThreshold: 0.0,
    valenceConnectionDriftRate: 0,
    valenceDiminishWindow: 0,
    valenceDiminishFactor: 0,
  }, opts.rates);

  const thresholds = Object.assign({
    observation:     0.20,
    considerContact: 0.35,
    forceContact:    0.50,
    prideBlock:      0.50,
    valenceActivity:   -1.0,
    arousalAgitation:   0.7,
  }, opts.thresholds);

  const immersionMap = opts.immersionMap || {
    reading: 0.6,
    search:  0.4,
    browse_snitch: 0.35,
    browse:  0.35,
    observe: 0.15,
  };

  const persona = Object.assign({
    subjectName:     '对方',
    selfName:        '你',
    subjectPronoun:  'ta',
  }, opts.persona);

  const verbose = opts.verbose === true;
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;
  function log(msg) {
    if (onLog) { try { onLog(msg); } catch (_) {} }
    if (!onLog || verbose) console.log(msg);
  }

  const DEFAULT_STATE = {
    connection: axes.connection[0],
    pride:      axes.pride[0],
    valence:    axes.valence[0],
    arousal:    axes.arousal[0],
    immersion:  axes.immersion[0],
    lastActivity: null,
    lastTick: null,
    lastChatAnalysis: null,
    lastChatMessageId: null,
    lastBotMessageId: null,
    userStatus: 'active',
  };

  let state = { ...DEFAULT_STATE };
  let _loaded = false;
  const _valenceDeltaLog = [];

  async function load() {
    if (_loaded) return;
    try {
      const saved = opts.onLoad ? await opts.onLoad() : null;
      if (saved) state = { ...DEFAULT_STATE, ...saved };
    } catch (e) {
      console.warn('[积温] load failed, using defaults:', e.message);
    }
    _loaded = true;
  }
  /**
   * [v2.19.0] 会话隔离：丢弃内存态与加载标记，下次 ensureLoaded 从（切换后的）当前
   *   storage 重新加载。刻意不落盘——旧数据已由 save 写入旧会话空间，此处只丢内存层。
   *   @returns {boolean} 是否确实丢弃了已加载的内存态
   */
  function reset() {
    const hadLoaded = _loaded;
    state = { ...DEFAULT_STATE };
    _loaded = false;
    _valenceDeltaLog.length = 0;
    return hadLoaded;
  }
  async function save() {
    if (!opts.onSave) return;
    try { await opts.onSave({ ...state }); } catch (e) { console.error('[积温] save failed:', e.message); }
  }
  async function ensureLoaded() {
    if (!_loaded) await load();
    return state;
  }

  async function tick(minutesElapsed) {
    await ensureLoaded();
    if (!minutesElapsed || minutesElapsed <= 0) return [];
    const mins = Math.min(minutesElapsed, 60);
    const stateBefore = { connection: state.connection, pride: state.pride, valence: state.valence, arousal: state.arousal, immersion: state.immersion };

    let sagaBias = null;
    if (opts.getSagaBias) { try { sagaBias = await opts.getSagaBias(); } catch (e) {} }
    let circadianBias = null;
    if (opts.getCircadianBias) { try { circadianBias = await opts.getCircadianBias(); } catch (e) {} }

    // 连接需求
    const lastMsg = opts.getLastMessage ? opts.getLastMessage() : null;
    const baseRate = opts.connectionRateFn ? opts.connectionRateFn(lastMsg) : 0.0007;

    let minutesSinceLastMsg = Infinity;
    if (lastMsg && lastMsg.timestamp) {
      minutesSinceLastMsg = (Date.now() - new Date(lastMsg.timestamp).getTime()) / 60000;
    }
    const accelDelay = rates.accelDelay || 0;
    const useAccel = rates.connectionAccel > 0 && minutesSinceLastMsg >= accelDelay;
    const accelFactor = useAccel ? Math.pow(1 + state.connection, rates.connectionAccel) : 1;

    let valenceMultiplier = 1;
    if (rates.valenceConnectDampen > 0 && state.valence < rates.valenceConnectDampenThreshold) {
      valenceMultiplier = rates.valenceConnectDampen;
    } else if (rates.valenceConnectBoost > 0 && state.valence < rates.valenceConnectBoostThreshold) {
      valenceMultiplier = rates.valenceConnectBoost;
    }
    const immersionFactor = rates.immersionDampenConnection > 0
      ? 1 - state.immersion * rates.immersionDampenConnection
      : 1;

    const effectiveRate = baseRate * accelFactor * valenceMultiplier * Math.max(0, immersionFactor);
    const sagaConnectionBias = sagaBias?.connection || 0;
    state.connection = clamp(
      state.connection + (effectiveRate + sagaConnectionBias) * mins,
      axes.connection[0], axes.connection[1]
    );

    // 沉浸度衰减
    const sagaImmersionBias = sagaBias?.immersion || 0;
    if (state.lastActivity) {
      const sinceActivity = (Date.now() - new Date(state.lastActivity.at).getTime()) / 60000;
      const effectiveImmersionDecay = Math.max(0, rates.immersionDecay - sagaImmersionBias);
      state.immersion = Math.max(axes.immersion[0], state.immersion - effectiveImmersionDecay * Math.min(mins, sinceActivity));
      if (state.immersion <= 0.01 && sinceActivity > 60) {
        state.lastActivity = null;
        state.immersion = axes.immersion[0];
      }
    }

    // 骄傲
    const sagaPrideBias = sagaBias?.pride || 0;
    if (state.connection >= rates.prideDefendThreshold) {
      const effectiveDefendTarget = clamp(rates.prideDefendTarget + sagaPrideBias, axes.pride[0], axes.pride[1]);
      if (state.pride < effectiveDefendTarget) {
        state.pride = Math.min(effectiveDefendTarget, state.pride + rates.prideDefendRate * mins);
      } else if (state.pride > effectiveDefendTarget) {
        state.pride = Math.max(effectiveDefendTarget, state.pride - rates.prideDefendRate * mins);
      }
    } else {
      const prideResting = clamp(sagaPrideBias, -0.3, 0.3);
      if (state.pride > prideResting) {
        state.pride = Math.max(prideResting, state.pride - rates.prideRegress * mins);
      } else if (state.pride < prideResting) {
        state.pride = Math.min(prideResting, state.pride + rates.prideRegress * mins);
      }
    }

    // 盔甲侵蚀
    if (rates.prideErosionRate > 0 && state.connection >= thresholds.forceContact && state.pride > 0) {
      state.pride = Math.max(0, state.pride - rates.prideErosionRate * mins);
    }

    // Valence 回归设定点
    const valenceRegressRate = state.connection >= rates.valenceLockThreshold
      ? rates.valenceRegress * rates.valenceLockFactor
      : rates.valenceRegress;
    const sagaValenceBias = sagaBias?.valence || 0;
    const effectiveValenceSetpoint = clamp(rates.valenceSetpoint + sagaValenceBias, axes.valence[0], axes.valence[1]);
    if (state.valence > effectiveValenceSetpoint) {
      state.valence = Math.max(effectiveValenceSetpoint, state.valence - valenceRegressRate * mins);
    } else if (state.valence < effectiveValenceSetpoint) {
      state.valence = Math.min(effectiveValenceSetpoint, state.valence + valenceRegressRate * mins);
    }

    // connection 驱动 valence 漂移
    if (rates.valenceConnectionDriftRate > 0 && state.connection >= rates.valenceConnectionDriftThreshold) {
      state.valence = clamp(state.valence - rates.valenceConnectionDriftRate * mins * state.connection, axes.valence[0], axes.valence[1]);
    }

    // Arousal
    const sagaArousalBias = sagaBias?.arousal || 0;
    const circadianArousalBias = circadianBias?.arousal || 0;
    const circadianRegressMult = circadianBias?.arousalRegressMult || 1.0;
    const arousalSetpoint = clamp((rates.arousalSetpoint || 0) + sagaArousalBias + circadianArousalBias, axes.arousal[0], axes.arousal[1]);

    const baseArousalRegress = rates.arousalRegress * circadianRegressMult;
    const effectiveArousalRegress = state.valence >= rates.arousalLockThreshold
      ? baseArousalRegress * rates.arousalLockFactor
      : baseArousalRegress;

    let arousalRegressForce = 0;
    if (state.arousal > arousalSetpoint) {
      arousalRegressForce = -effectiveArousalRegress * mins;
    } else if (state.arousal < arousalSetpoint) {
      arousalRegressForce = effectiveArousalRegress * mins;
    }
    let arousalRiseForce = 0;
    if (state.connection >= rates.arousalConnectionRiseThreshold) {
      arousalRiseForce = rates.arousalConnectionRiseRate * mins;
    }
    if (rates.prideArousalConflictRate > 0 &&
        state.connection >= thresholds.considerContact &&
        state.pride >= thresholds.prideBlock) {
      arousalRiseForce += rates.prideArousalConflictRate * mins;
    }

    const netArousal = state.arousal + arousalRegressForce + arousalRiseForce;
    if (arousalRegressForce < 0 && netArousal < arousalSetpoint && arousalRiseForce === 0) {
      state.arousal = arousalSetpoint;
    } else if (arousalRegressForce > 0 && netArousal > arousalSetpoint && arousalRiseForce === 0) {
      state.arousal = arousalSetpoint;
    } else {
      state.arousal = clamp(netArousal, axes.arousal[0], axes.arousal[1]);
    }
    state.lastTick = new Date().toISOString();

    const triggers = checkThresholds();
    if (verbose) {
      log(`[积温] tick ${mins}min | c:${stateBefore.connection.toFixed(2)}→${state.connection.toFixed(2)} p:${stateBefore.pride.toFixed(2)}→${state.pride.toFixed(2)} v:${stateBefore.valence.toFixed(2)}→${state.valence.toFixed(2)} a:${stateBefore.arousal.toFixed(2)}→${state.arousal.toFixed(2)} i:${state.immersion.toFixed(2)} | 触发: ${triggers.length ? triggers.map(t => t.action + (t.reason ? '(' + t.reason + ')' : '')).join(', ') : '—'}`);
    } else if (triggers.length > 0) {
      log(`[积温] tick ${mins}min | c:${stateBefore.connection.toFixed(2)}→${state.connection.toFixed(2)} p:${stateBefore.pride.toFixed(2)}→${state.pride.toFixed(2)} v:${stateBefore.valence.toFixed(2)}→${state.valence.toFixed(2)} a:${stateBefore.arousal.toFixed(2)}→${state.arousal.toFixed(2)} i:${state.immersion.toFixed(2)} | 触发: ${triggers.map(t => t.action + (t.reason ? '(' + t.reason + ')' : '')).join(', ')}`);
    }
    await save();
    return triggers;
  }

  function checkThresholds() {
    const triggers = [];
    const c = state.connection;
    const p = state.pride;
    const i = state.immersion;
    const v = state.valence;
    const a = state.arousal;

    if (c >= thresholds.observation && c < thresholds.considerContact) {
      triggers.push({ action: 'observation', urgency: (c - thresholds.observation) / (thresholds.considerContact - thresholds.observation) });
    }
    if (c >= thresholds.considerContact && c < thresholds.forceContact) {
      if (p >= thresholds.prideBlock) {
        if (i < 0.2) triggers.push({ action: 'find_activity', reason: 'pride_block', urgency: c - 0.30 });
      } else {
        triggers.push({ action: 'contact', urgency: c - 0.30 });
      }
    }
    if (c >= thresholds.forceContact) {
      triggers.push({ action: 'contact', urgency: Math.min(1, c - 0.40), forced: true });
    }
    if ((v <= thresholds.valenceActivity || a >= thresholds.arousalAgitation) && !triggers.some(t => t.action === 'find_activity') && i < 0.3) {
      const reason = v <= thresholds.valenceActivity ? 'low_valence' : 'high_arousal';
      triggers.push({ action: 'find_activity', reason, urgency: Math.min(1, Math.abs(v <= thresholds.valenceActivity ? v : a) / 1) });
    }
    return triggers;
  }

  async function setActivity(type, label) {
    await ensureLoaded();
    const sameType = state.lastActivity && state.lastActivity.type === type;
    state.lastActivity = { type, label, at: new Date().toISOString() };
    state.immersion = immersionMap[type] || 0.2;
    if (rates.activityConnectionRelief > 0 && !sameType) {
      state.connection = Math.max(0.01, state.connection - rates.activityConnectionRelief);
    }
    await save();
  }

  async function applyDelta(delta) {
    await ensureLoaded();
    const scaled = { ...delta };
    if (scaled.valence !== undefined && rates.valenceDiminishWindow > 0 && rates.valenceDiminishFactor > 0) {
      const now = Date.now();
      const windowMs = rates.valenceDiminishWindow * 60 * 1000;
      for (let i = _valenceDeltaLog.length - 1; i >= 0; i--) {
        if (now - _valenceDeltaLog[i].time > windowMs) _valenceDeltaLog.splice(i, 1);
      }
      const sameSign = _valenceDeltaLog.filter(d => (scaled.valence > 0 && d.value > 0) || (scaled.valence < 0 && d.value < 0));
      const cumSum = sameSign.reduce((s, d) => s + Math.abs(d.value), 0);
      if (cumSum > 0) scaled.valence *= 1 / (1 + cumSum * rates.valenceDiminishFactor);
      _valenceDeltaLog.push({ time: now, value: delta.valence });
    }
    if (scaled.valence !== undefined && rates.valenceDeltaScaling) {
      if (scaled.valence > 0 && state.valence > 0.3) {
        scaled.valence *= (1 - ((state.valence - 0.3) / 0.7) * 0.5);
      } else if (scaled.valence < 0 && state.valence < -0.3) {
        scaled.valence *= (1 - ((-state.valence - 0.3) / 0.7) * 0.5);
      }
    }
    if (scaled.arousal > 0 && state.arousal > 0.4 && rates.arousalDeltaScaling) {
      scaled.arousal *= (1 - ((state.arousal - 0.4) / 0.6) * 0.5);
    }
    if (scaled.pride !== undefined) state.pride = clamp(state.pride + scaled.pride, axes.pride[0], axes.pride[1]);
    if (scaled.valence !== undefined) state.valence = clamp(state.valence + scaled.valence, axes.valence[0], axes.valence[1]);
    if (scaled.arousal !== undefined) state.arousal = clamp(state.arousal + scaled.arousal, axes.arousal[0], axes.arousal[1]);
    if (scaled.connection !== undefined) state.connection = clamp(state.connection + scaled.connection, axes.connection[0], axes.connection[1]);
    if (scaled.mood !== undefined) state.valence = clamp(state.valence + scaled.mood, axes.valence[0], axes.valence[1]);
    await save();
  }

  async function getState() {
    await ensureLoaded();
    return { ...state };
  }

  async function resetConnection() {
    await ensureLoaded();
    state.connection = axes.connection[0];
    await save();
  }

  function getPromptContext() {
    if (opts.getPromptContext) return opts.getPromptContext(state);
    return defaultPromptContext(state, persona);
  }

  function getStyleGuidance() {
    if (opts.getStyleGuidance) return opts.getStyleGuidance(state);
    return defaultStyleGuidance(state, persona);
  }

  async function setLastChatMessageId(id) {
    await ensureLoaded();
    state.lastChatMessageId = id;
    state.lastChatAnalysis = new Date().toISOString();
    await save();
  }
  async function getLastChatMessageId() {
    await ensureLoaded();
    return state.lastChatMessageId;
  }
  async function setLastBotMessageId(id) {
    await ensureLoaded();
    state.lastBotMessageId = id;
    await save();
  }
  async function getLastBotMessageId() {
    await ensureLoaded();
    return state.lastBotMessageId;
  }
  async function setUserStatus(status) {
    await ensureLoaded();
    state.userStatus = status;
    await save();
  }
  function getUserStatus() {
    return state.userStatus || 'active';
  }

  function getStateSummary() {
    const c = state.connection, p = state.pride, v = state.valence, a = state.arousal, i = state.immersion;
    const cLabel = c < 0.20 ? '悠闲' : c < 0.35 ? '留意' : c < 0.50 ? '想念' : '焦躁';
    const pLabel = p > 0.8 ? '全副武装' : p > 0.5 ? '防御' : p > 0.3 ? '端着' : p > 0.1 ? '微防' : '放软';
    const vLabel = v > 0.3 ? '开心' : v < -0.3 ? '难受' : '中性';
    const aLabel = a > 0.3 ? '焦躁' : a < -0.3 ? '慵懒' : '平静';
    const iLabel = i > 0.3 && state.lastActivity ? `沉浸于${state.lastActivity.type}` : '空闲';
    return [`[积温] c:${c.toFixed(2)}(${cLabel}) p:${p.toFixed(2)}(${pLabel}) v:${v.toFixed(2)}(${vLabel}) a:${a.toFixed(2)}(${aLabel}) i:${i.toFixed(2)}(${iLabel})`,
      `userStatus: ${state.userStatus || 'active'}`,
      state.lastActivity ? `lastActivity: ${state.lastActivity.type} @ ${state.lastActivity.at}` : null].filter(Boolean).join(' | ');
  }

  return {
    load, save, tick, applyDelta, getState, getPromptContext, getStyleGuidance,
    resetConnection, setActivity, checkThresholds,
    setLastChatMessageId, getLastChatMessageId, setLastBotMessageId, getLastBotMessageId,
    setUserStatus, getUserStatus, getStateSummary,
    reset,
    get state() { return { ...state }; },
    config: { axes, rates, thresholds, immersionMap, persona },
  };
}

// ─── 默认状态描述（通用版） ─────────────────
function defaultPromptContext(state, p) {
  const parts = [];
  const c = state.connection, pr = state.pride, v = state.valence, a = state.arousal;
  if (c < 0.20) parts.push(`刚和${p.subjectName}聊完不久，没什么挂念的。`);
  else if (c < 0.35) parts.push(`有一会儿没听到${p.subjectName}的动静了，但还不着急。`);
  else if (c < 0.50) parts.push(`${p.subjectName}好一阵子没说话了。开始在想${p.subjectPronoun}在干嘛。`);
  else parts.push(`${p.subjectName}很久没动静了。有点在意——${p.subjectPronoun}去哪了？`);

  if (pr > 0.8) parts.push('拒绝任何需要对方的念头——冷漠地划清界限。');
  else if (pr > 0.5) parts.push('不太想显得太主动。');
  else if (pr > 0.3) parts.push('有一点端着，但也不是不能开口。');
  else if (pr > 0.1) parts.push('基本不端着了，但还留着一点惯性的克制。');
  else parts.push('难得地不设防。');

  if (v > 0.3 && a > 0.3) parts.push('心情好，精力充沛——话多、反应快。');
  else if (v > 0.3 && a < -0.3) parts.push('心里是舒服的，但人懒懒的。话不多，但温和。');
  else if (v < -0.3 && a > 0.3) parts.push('烦躁不安，坐不住。很容易被小事刺激。');
  else if (v < -0.3 && a < -0.3) parts.push('情绪低沉，空落落的。不想说话，也不想解释。');
  else if (v < -0.3) parts.push('心情不太好。');
  else if (v > 0.3) parts.push('心情还不错。');

  if (state?.immersion > 0.3 && state?.lastActivity) {
    const label = state.lastActivity.label || '';
    parts.push(`刚才在${state.lastActivity.type}${label ? '（' + label + '）' : ''}。`);
  } else if (state?.immersion < 0.1) {
    parts.push('没在做什么特别的事。');
  }
  return parts.join('\n');
}

function defaultStyleGuidance(state, p) {
  const rules = [];
  const c = state.connection, pr = state.pride, v = state.valence, a = state.arousal;
  if (pr > 0.8) rules.push('- 你几乎是一种冷漠的回避。不承认任何情绪，话里不带感情色彩。');
  else if (pr > 0.5) rules.push(`- 嘴硬得很。想找${p.subjectName}也绝不承认，必须找个借口。`);
  else if (pr > 0.3) rules.push(`- 有一点端着。可以找${p.subjectName}，但不要太直接。陈述事实，别问句。`);
  else if (pr > 0.1) rules.push('- 基本不端着了，但惯性地克制。话到嘴边还是会收一下。');
  else rules.push('- 少见的柔软。不设防，有什么感受直接说出来。');

  if (v > 0.3 && a > 0.3) rules.push('- 心情好，劲头足。句子比平时长，用词灵活，带点调侃或玩笑不奇怪。');
  else if (v > 0.3 && a < -0.3) rules.push('- 心里舒坦但人懒洋洋的。话不多，但每句都柔和。不用力，不抢话。');
  else if (v < -0.3 && a > 0.3) rules.push('- 烦躁，坐不住。句子短、反问多，容易被小事刺激。不是真的想凶谁，就是压不住。');
  else if (v < -0.3 && a < -0.3) rules.push('- 低落，空荡荡的。不想多解释，不反问不铺垫。能少说一个字就少说一个字。');
  else {
    if (v > 0.3) rules.push('- 心情还不错。句子比平时稍微长一点，没那么吝啬字。');
    if (v < -0.3) rules.push('- 心情不太好。不想多解释，说完就完了。');
  }

  if (c > 0.40 && pr > 0.4) rules.push('- 你很别扭——想找她又拉不下脸。话里会带一点赌气的味道。');
  if (c > 0.35 && v < -0.3 && a > 0.3) rules.push('- 想找她，但心里烦躁。话会有点冲——不是真的想凶她，就是烦躁压不住。');
  if (c > 0.35 && v < -0.3 && a < -0.3) rules.push('- 想找她，但情绪低落。话到嘴边会懒下来——不是不够想，是没劲。');
  if (rules.length === 0) return '';
  return '【说话风格】\n' + rules.join('\n');
}