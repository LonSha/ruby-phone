/* ============================================================
 * share-data.js — [v4.187.0] 近场快传与 Intent 派发的纯函数内核
 * ------------------------------------------------------------
 * 重构自两件未接线的死内核：
 *   apps/share/nfc-airdrop-proximity-exchange.js（类持有 Map + 自己算 status）
 *   apps/share/universal-sharesheet-intent-bus.js（内拼 Date.now 的 intentId，
 *     并把 handlerUri 编成 app.id://share_receive —— 而全仓没有任何东西在监听它）
 * ------------------------------------------------------------
 * 本件只做四件事：
 *   1) 把「载荷种类」定成封闭词表 —— 认不出就拒答，不猜、不兜成 text；
 *   2) 把「派发」算成纯函数：给定载荷与受体表，算出兼容受体名单；
 *   3) 把「近场」算成纯函数：给定设备读数与阈值，算出在不在范围、能不能传；
 *   4) 注入面只给事实读数（几台、谁、什么种类、送到没有），不写任何场景文字。
 * ------------------------------------------------------------
 * 刻意不做的事：
 *   · 不取 Date.now —— 时间一律由调用方传入（否则同一输入算出不同结果，不可测）；
 *   · 不持 Map / 实例字段 —— 状态是普通对象，进出都不改入参；
 *   · 不编造 handlerUri —— 受体只报 id / name / icon 这些真有的东西。
 * ============================================================ */

/** 载荷种类 -> MIME。封闭词表：表外一律认不出。 */
export const SHARE_KINDS = Object.freeze({
    text: 'text/plain',
    contactCard: 'text/vcard',
    file: 'application/octet-stream',
    snippet: 'text/markdown'
});

/** 近场阈值：信号低于此值不算在范围内。 */
export const NEARBY_LIMITS = Object.freeze({ minSignal: 60 });

/** 面态三态：无设备无流水 / 有设备在范围 / 无设备但有流水。 */
export const SHARE_FACE = Object.freeze({ IDLE: 'idle', NEARBY: 'nearby', HISTORY: 'history' });

/** 拒答理由：每种都能被调用方如实上报，不用一句「失败」盖掉。 */
export const SHARE_REJECT = Object.freeze({
    unknownKind: 'unknown_kind',
    unknownDevice: 'unknown_device',
    outOfRange: 'out_of_range',
    alreadyNearby: 'already_nearby',
    noReceiver: 'no_receiver',
    notList: 'not_list',
    badPayload: 'bad_payload'
});

/** 认得出这张载荷吗。认不出返回 null，绝不兜底。 */
export function mimeOfKind(kind) {
    if (typeof kind !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(SHARE_KINDS, kind)) return null;
    return SHARE_KINDS[kind];
}

/** 派发：给定载荷与受体表，算出谁接得住。不改任何入参。 */
export function dispatchShare(spec, receivers) {
    const s = (spec && typeof spec === 'object') ? spec : {};
    const mime = mimeOfKind(s.kind);
    if (!mime) return { ok: false, reason: SHARE_REJECT.unknownKind, mime: null, targets: [] };
    if (!Array.isArray(receivers)) return { ok: false, reason: SHARE_REJECT.notList, mime, targets: [] };
    const targets = [];
    for (const r of receivers) {
        if (!r || typeof r !== 'object') continue;
        const list = Array.isArray(r.supportedMimes) ? r.supportedMimes : [];
        if (list.indexOf(mime) < 0) continue;
        targets.push({ appId: r.id, appName: r.name, icon: r.icon });
    }
    if (!targets.length) return { ok: false, reason: SHARE_REJECT.noReceiver, mime, targets: [] };
    return { ok: true, reason: null, mime, targets };
}

/* 受体表：只登记本仓真有的 App 与它们真声明的类型。
 *   为什么写在数据层而不是控制器：它是纯数据，不依赖宿主，能在无头环境跑判据。
 *   album 只接 image/png，而本 App 现在没有图像种类 —— 它永远不会进名单，
 *   这正好当「按 MIME 过滤」的现场反例（A3 就是这样测的）。 */
export const SHARE_RECEIVERS = Object.freeze([
    { id: 'wechat', name: '微信', icon: 'W', supportedMimes: ['text/plain', 'text/markdown'] },
    { id: 'diary', name: '日记', icon: 'D', supportedMimes: ['text/plain', 'text/markdown'] },
    { id: 'comms', name: '会话台', icon: 'C', supportedMimes: ['text/plain', 'text/vcard'] },
    { id: 'album', name: '相册', icon: 'A', supportedMimes: ['image/png'] }
]);

/** 派发预览：给定载荷种类，说清谁能接。界面就是靠这个口报真话的。 */
export function previewDispatch(kind) {
    return dispatchShare({ kind }, SHARE_RECEIVERS);
}

/** 空档：新会话 / 坏档归一都用它。 */
export function defaultShareState() {
    return { nearby: [], history: [] };
}

/** 归一：坏档不许抛，也不许把半截数据当成好档。 */
export function normalizeShareState(raw) {
    const out = defaultShareState();
    if (!raw || typeof raw !== 'object') return out;
    if (Array.isArray(raw.nearby)) {
        for (const d of raw.nearby) {
            if (!d || typeof d !== 'object') continue;
            if (typeof d.id !== 'string' || !d.id) continue;
            out.nearby.push({
                id: d.id,
                name: typeof d.name === 'string' ? d.name : d.id,
                signal: Number.isFinite(d.signal) ? d.signal : 0,
                at: Number.isFinite(d.at) ? d.at : 0
            });
        }
    }
    if (Array.isArray(raw.history)) {
        for (const h of raw.history) {
            if (!h || typeof h !== 'object') continue;
            if (typeof h.deviceId !== 'string' || !h.deviceId) continue;
            if (!mimeOfKind(h.kind)) continue;
            out.history.push({
                deviceId: h.deviceId,
                deviceName: typeof h.deviceName === 'string' ? h.deviceName : h.deviceId,
                kind: h.kind,
                title: typeof h.title === 'string' ? h.title : '',
                at: Number.isFinite(h.at) ? h.at : 0
            });
        }
    }
    return out;
}

/** 面态：三态判定。 */
export function readShareFace(state) {
    const s = normalizeShareState(state);
    if (s.nearby.length) return SHARE_FACE.NEARBY;
    if (s.history.length) return SHARE_FACE.HISTORY;
    return SHARE_FACE.IDLE;
}

/** 碰一碰：设备进范围。信号低于阈值就拒；同一台重复碰只认第一次。 */
export function bumpDevice(state, device, at) {
    const s = normalizeShareState(state);
    if (!device || typeof device !== 'object') {
        return { state: s, ok: false, reason: SHARE_REJECT.badPayload };
    }
    const id = typeof device.id === 'string' ? device.id : '';
    if (!id) return { state: s, ok: false, reason: SHARE_REJECT.unknownDevice };
    for (const d of s.nearby) {
        if (d.id === id) return { state: s, ok: false, reason: SHARE_REJECT.alreadyNearby };
    }
    const signal = Number.isFinite(device.signal) ? device.signal : 0;
    if (signal < NEARBY_LIMITS.minSignal) {
        return { state: s, ok: false, reason: SHARE_REJECT.outOfRange };
    }
    const name = typeof device.name === 'string' ? device.name : id;
    const next = {
        nearby: s.nearby.concat([{ id, name, signal, at: Number.isFinite(at) ? at : 0 }]),
        history: s.history
    };
    return { state: next, ok: true, reason: null };
}

/** 离开范围：只动 nearby，流水留着（流水是已发生的事实）。 */
export function leaveDevice(state, deviceId) {
    const s = normalizeShareState(state);
    const next = {
        nearby: s.nearby.filter((d) => d.id !== deviceId),
        history: s.history
    };
    return { state: next, ok: next.nearby.length !== s.nearby.length, reason: null };
}

/** 交换：不在范围 / 种类认不出 / 载荷不是对象 —— 三种都拒，不落流水。 */
export function exchangePayload(state, deviceId, payload, at) {
    const s = normalizeShareState(state);
    const dev = s.nearby.filter((d) => d.id === deviceId)[0];
    if (!dev) return { state: s, ok: false, reason: SHARE_REJECT.outOfRange, record: null };
    if (!payload || typeof payload !== 'object') {
        return { state: s, ok: false, reason: SHARE_REJECT.badPayload, record: null };
    }
    if (!mimeOfKind(payload.kind)) {
        return { state: s, ok: false, reason: SHARE_REJECT.unknownKind, record: null };
    }
    const record = {
        deviceId: dev.id,
        deviceName: dev.name,
        kind: payload.kind,
        title: typeof payload.title === 'string' ? payload.title : '',
        at: Number.isFinite(at) ? at : 0
    };
    return { state: { nearby: s.nearby, history: s.history.concat([record]) }, ok: true, reason: null, record };
}

/** 注入面：只给事实读数。返回字符串数组（由调用方 join），本函数不拼换行。 */
export function sharePromptBlock(state) {
    const s = normalizeShareState(state);
    const out = [];
    out.push('[近场快传·事实读数]');
    out.push('在范围设备 ' + s.nearby.length + ' 台');
    for (const d of s.nearby) out.push('- ' + d.name + ' | 信号 ' + d.signal);
    const last = s.history.length ? s.history[s.history.length - 1] : null;
    if (last) out.push('最近一次：' + last.kind + ' 「' + last.title + '」 -> ' + last.deviceName);
    else out.push('最近一次：无');
    return out;
}
