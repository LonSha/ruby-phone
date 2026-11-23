/* ============================================================
 * call-data.js — [v4.188.0] 情境通话声场的纯函数内核
 * ------------------------------------------------------------
 * 重构自两件未接线的死内核：
 *   contextual-cellular-call-acoustic-modulator.js（environment.includes 七拼八凑判场景，
 *     自己写「窗外呼啸狂风与密集雨点打在玻璃上的噼啪声」这类叙事，还拼 directivePrompt）
 *   dynamic-context-call-soundscape.js（类持 activeCall、自己 Date.now、
 *     soundscapeProfiles[scenario] || HEAVY_RAIN_FLEEING 把认不出的场景悄悄换成默认，
 *     subtextIndicator 又把「急促的喘息声」写进描述）
 * ------------------------------------------------------------
 * 本件只做四件事：场景封闭词表 / 信号夹取记账 / 通话状态纯函数 / 注入只给数值读数。
 * 刻意不做：不取 Date.now（调用方传）、不持实例字段、不编任何叙事文字、不兜底默认场景。
 * ============================================================ */

/** 场景 -> 声学读数（全是数值/代码，没有一个中文字是叙事）。封闭词表：表外拒答。 */
export const CALL_SCENES = Object.freeze({
    quiet_room: Object.freeze({ lowPassHz: 8000, distortion: 0, echo: 'room_damped', panting: false, gainBackground: 0.05, gainVoice: 0.9 }),
    rain_fleeing: Object.freeze({ lowPassHz: 3500, distortion: 0.25, echo: 'open_field_damped', panting: true, gainBackground: 0.45, gainVoice: 0.85 }),
    night_drive: Object.freeze({ lowPassHz: 4200, distortion: 0.05, echo: 'cabin_enclosed', panting: false, gainBackground: 0.3, gainVoice: 0.85 }),
    confined_stealth: Object.freeze({ lowPassHz: 2200, distortion: 0, echo: 'whisper_suppression', panting: false, gainBackground: 0.1, gainVoice: 0.7 })
});

/** 信号档位上下界（0~5 格）。越界夹取并记账，不静默归零。 */
export const SIGNAL_LIMITS = Object.freeze({ min: 0, max: 5 });

/** 面态三态：空闲 / 通话中 / 已挂断（有过往）。 */
export const CALL_FACE = Object.freeze({ IDLE: 'idle', ACTIVE: 'active', HISTORY: 'history' });

/** 拒答理由。 */
export const CALL_REJECT = Object.freeze({
    unknownScene: 'unknown_scene',
    noActiveCall: 'no_active_call',
    notNumber: 'not_number',
    badPayload: 'bad_payload',
    alreadyActive: 'already_active'
});

/** 场景认得出吗。认不出返回 null，绝不兜底默认。 */
export function sceneProfile(scene) {
    if (typeof scene !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(CALL_SCENES, scene)) return null;
    return CALL_SCENES[scene];
}

/** 空档。 */
export function defaultCallState() {
    return { active: null, scene: 'quiet_room', signalBars: 5, history: [], notes: [] };
}

/** 归一：坏档不抛、半截数据当好档要丢。 */
export function normalizeCallState(raw) {
    const out = defaultCallState();
    if (!raw || typeof raw !== 'object') return out;
    if (sceneProfile(raw.scene)) out.scene = raw.scene;
    if (Number.isFinite(raw.signalBars)) {
        out.signalBars = Math.max(SIGNAL_LIMITS.min, Math.min(SIGNAL_LIMITS.max, raw.signalBars));
    }
    if (raw.active && typeof raw.active === 'object' && typeof raw.active.callId === 'string') {
        out.active = {
            callId: raw.active.callId,
            callerId: typeof raw.active.callerId === 'string' ? raw.active.callerId : '',
            callerName: typeof raw.active.callerName === 'string' ? raw.active.callerName : raw.active.callerId,
            scene: sceneProfile(raw.active.scene) ? raw.active.scene : 'quiet_room',
            at: Number.isFinite(raw.active.at) ? raw.active.at : 0
        };
    }
    if (Array.isArray(raw.history)) {
        for (const h of raw.history) {
            if (!h || typeof h !== 'object' || typeof h.callId !== 'string') continue;
            out.history.push({
                callId: h.callId,
                callerName: typeof h.callerName === 'string' ? h.callerName : '',
                scene: sceneProfile(h.scene) ? h.scene : 'quiet_room',
                at: Number.isFinite(h.at) ? h.at : 0,
                endedAt: Number.isFinite(h.endedAt) ? h.endedAt : 0
            });
        }
    }
    if (Array.isArray(raw.notes)) {
        for (const n of raw.notes) if (typeof n === 'string') out.notes.push(n);
    }
    return out;
}

/** 面态三态。 */
export function readCallFace(state) {
    const s = normalizeCallState(state);
    if (s.active) return CALL_FACE.ACTIVE;
    if (s.history.length) return CALL_FACE.HISTORY;
    return CALL_FACE.IDLE;
}

/** 信号夹取并记账（不静默归零）。 */
export function clampSignal(bars) {
    if (!Number.isFinite(bars)) return { ok: false, reason: CALL_REJECT.notNumber, bars: 0, note: '' };
    const n = Math.max(SIGNAL_LIMITS.min, Math.min(SIGNAL_LIMITS.max, bars));
    const note = n === bars ? '' : ('信号 ' + bars + ' 格越界，夹到 ' + n + ' 格');
    return { ok: true, reason: null, bars: n, note };
}

/** 发起通话：场景不认得就拒，不静默换默认；已有通话就拒，不叠第二通。 */
export function startCall(state, spec, at) {
    const s = normalizeCallState(state);
    if (s.active) return { state: s, ok: false, reason: CALL_REJECT.alreadyActive };
    if (!spec || typeof spec !== 'object') return { state: s, ok: false, reason: CALL_REJECT.badPayload };
    if (!sceneProfile(spec.scene)) return { state: s, ok: false, reason: CALL_REJECT.unknownScene };
    const sig = clampSignal(typeof spec.signalBars === 'number' ? spec.signalBars : SIGNAL_LIMITS.max);
    if (!sig.ok) return { state: s, ok: false, reason: sig.reason };
    const callId = typeof spec.callId === 'string' && spec.callId ? spec.callId : 'call_' + (Number.isFinite(at) ? at : 0);
    const active = {
        callId,
        callerId: typeof spec.callerId === 'string' ? spec.callerId : '',
        callerName: typeof spec.callerName === 'string' ? spec.callerName : (typeof spec.callerId === 'string' ? spec.callerId : ''),
        scene: spec.scene,
        at: Number.isFinite(at) ? at : 0
    };
    const notes = sig.note ? [sig.note] : [];
    return { state: { active, scene: spec.scene, signalBars: sig.bars, history: s.history, notes }, ok: true, reason: null };
}

/** 挂断：没有通话就拒；挂断事实进流水，不丢。 */
export function endCall(state, at) {
    const s = normalizeCallState(state);
    if (!s.active) return { state: s, ok: false, reason: CALL_REJECT.noActiveCall, ended: null };
    const ended = Object.assign({}, s.active, { endedAt: Number.isFinite(at) ? at : 0 });
    return {
        state: { active: null, scene: s.scene, signalBars: s.signalBars, history: s.history.concat([ended]), notes: [] },
        ok: true, reason: null, ended
    };
}

/** 调信号：夹取记账。 */
export function setSignal(state, bars) {
    const s = normalizeCallState(state);
    const sig = clampSignal(bars);
    if (!sig.ok) return { state: s, ok: false, reason: sig.reason };
    return { state: { active: s.active, scene: s.scene, signalBars: sig.bars, history: s.history, notes: sig.note ? [sig.note] : [] }, ok: true, reason: null, note: sig.note };
}

/** 注入面：只给事实读数（状态 / 场景代码 / 对象 / 信号 / 滤波数值）。零叙事。 */
export function callPromptBlock(state) {
    const s = normalizeCallState(state);
    const prof = sceneProfile(s.active ? s.active.scene : s.scene);
    const out = [];
    out.push('[情境通话·事实读数]');
    out.push('状态 ' + (s.active ? 'active' : 'idle'));
    if (s.active) out.push('对象 ' + s.active.callerName + ' | 场景 ' + s.active.scene);
    else out.push('场景 ' + s.scene + ' | 历史 ' + s.history.length + ' 通');
    out.push('信号 ' + s.signalBars + '/5 档');
    out.push('低通 ' + prof.lowPassHz + 'Hz | 失真 ' + prof.distortion + ' | 回声 ' + prof.echo);
    out.push('增益 背景 ' + prof.gainBackground + ' 人声 ' + prof.gainVoice + ' | panting ' + (prof.panting ? 'on' : 'off'));
    return out;
}
